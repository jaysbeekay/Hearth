import { NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { clientAddress, consumeRateLimit } from "@/lib/rateLimit";
import { parseTransports, webAuthnUserId } from "@/lib/passkeyCredential";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export async function POST() {
  // Each challenge writes a row; unauthenticated issuance is the one that
  // needs a bound, so key it by client address.
  const { headers } = await import("next/headers");
  const challengeThrottle = consumeRateLimit(
    "passkeyChallenge",
    clientAddress(await headers()),
  );
  if (!challengeThrottle.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(challengeThrottle.retryAfterSeconds) } },
    );
  }

  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    include: { passkeys: { select: { credentialId: true, transports: true } } },
  });

  const rpId = new URL(env.appUrl).hostname;

  const options = await generateRegistrationOptions({
    rpName: "Hearth",
    rpID: rpId,
    userID: webAuthnUserId(user.id),
    userName: user.email,
    userDisplayName: user.name,
    attestationType: "none",
    excludeCredentials: user.passkeys.map((pk) => ({
      id: pk.credentialId,
      transports: parseTransports(pk.transports),
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  await prisma.passkeyChallenge.upsert({
    where: { challenge: options.challenge },
    create: {
      userId: user.id,
      challenge: options.challenge,
      type: "registration",
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    },
    update: {},
  });

  return NextResponse.json(options);
}
