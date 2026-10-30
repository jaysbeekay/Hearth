import {
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import {
  SUPPORTED_ALGORITHM_IDS,
  toStoredPasskey,
  toWebAuthnCredential,
  webAuthnUserId,
  type StoredPasskey,
} from "@/lib/passkeyCredential";

// Server side of passkey sign-in and registration (#376). Kept out of
// auth.ts and the route handlers so the challenge and credential checks can
// be unit tested against a real database.

function relyingParty() {
  return { origin: env.appUrl, rpId: new URL(env.appUrl).hostname };
}

/**
 * Atomically use up an authentication challenge. Deleting it before the
 * signature is checked means a challenge is good for exactly one attempt:
 * a failed attempt, or a concurrent replay of a successful one, can't use it
 * again.
 */
async function consumeAuthenticationChallenge(challenge: string): Promise<boolean> {
  const { count } = await prisma.passkeyChallenge.deleteMany({
    where: { challenge, type: "authentication", expiresAt: { gt: new Date() } },
  });
  return count === 1;
}

export type PasskeySignInInput = {
  credentialId?: unknown;
  assertionJSON?: unknown;
  challenge?: unknown;
};

/** The passkey credentials provider's authorize: the user, or null. */
export async function authorizePasskey(input: PasskeySignInInput | undefined) {
  if (
    typeof input?.credentialId !== "string" ||
    typeof input.assertionJSON !== "string" ||
    typeof input.challenge !== "string"
  ) {
    return null;
  }

  let assertion: AuthenticationResponseJSON;
  try {
    assertion = JSON.parse(input.assertionJSON);
  } catch {
    return null;
  }
  // The row is looked up by credentialId, so it must be the credential that
  // actually signed.
  if (assertion?.id !== input.credentialId) return null;

  if (!(await consumeAuthenticationChallenge(input.challenge))) return null;

  const passkeyCredential = await prisma.passkeyCredential.findUnique({
    where: { credentialId: input.credentialId },
    include: { user: true },
  });
  if (!passkeyCredential) return null;

  // A discoverable credential returns the user handle it was registered
  // with; when it's there it must be this row's user.
  const userHandle = assertion.response?.userHandle;
  if (
    userHandle &&
    !Buffer.from(userHandle, "base64url").equals(Buffer.from(webAuthnUserId(passkeyCredential.userId)))
  ) {
    return null;
  }

  const { origin, rpId } = relyingParty();
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: assertion,
      expectedChallenge: input.challenge,
      expectedOrigin: origin,
      expectedRPID: rpId,
      credential: toWebAuthnCredential(passkeyCredential),
    });
  } catch {
    return null;
  }
  if (!verification.verified) return null;

  await prisma.passkeyCredential.update({
    where: { id: passkeyCredential.id },
    data: { counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() },
  });

  return {
    id: passkeyCredential.user.id,
    name: passkeyCredential.user.name,
    email: passkeyCredential.user.email,
    role: passkeyCredential.user.role,
  };
}

export type RegistrationResult =
  | { ok: true; stored: StoredPasskey }
  | { ok: false; status: number; error: string };

/**
 * Verify a registration against any of the user's unexpired registration
 * challenges, not just the newest, so starting "Add passkey" in two tabs
 * doesn't fail the first. The challenge that matched is deleted whatever the
 * outcome, so it can't be used twice.
 */
export async function verifyPasskeyRegistration(
  userId: string,
  response: RegistrationResponseJSON,
): Promise<RegistrationResult> {
  const pending = await prisma.passkeyChallenge.findMany({
    where: { userId, type: "registration", expiresAt: { gt: new Date() } },
    select: { challenge: true },
  });
  if (pending.length === 0) {
    return { ok: false, status: 400, error: "Challenge not found or expired." };
  }
  const challenges = new Set(pending.map((c) => c.challenge));
  // Set from inside the expectedChallenge callback.
  const matched: { challenge: string | null } = { challenge: null };

  const { origin, rpId } = relyingParty();
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: (challenge) => {
        if (!challenges.has(challenge)) return false;
        matched.challenge = challenge;
        return true;
      },
      expectedOrigin: origin,
      expectedRPID: rpId,
      supportedAlgorithmIDs: SUPPORTED_ALGORITHM_IDS,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Verification failed";
    return { ok: false, status: 400, error: message };
  } finally {
    if (matched.challenge) {
      await prisma.passkeyChallenge.deleteMany({
        where: { userId, type: "registration", challenge: matched.challenge },
      });
    }
  }

  if (!verification.verified || !verification.registrationInfo) {
    return { ok: false, status: 400, error: "Verification failed." };
  }
  return {
    ok: true,
    stored: toStoredPasskey(verification.registrationInfo.credential, response.response?.transports),
  };
}
