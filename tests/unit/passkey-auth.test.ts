import { describe, expect, it } from "vitest";
import { setupTestDb, createTestUser } from "../helpers/testDb";
import {
  ORIGIN,
  authenticationResponse,
  makeAuthenticator,
  newChallenge,
  registrationResponse,
  v9Row,
  type SoftAuthenticator,
} from "../helpers/softAuthenticator";

// #376 — the passkey sign-in and registration checks, against a real database.
// env reads APP_URL when it's first imported; pin it to the helper's origin.
process.env.APP_URL = ORIGIN;
const { authorizePasskey, verifyPasskeyRegistration } = await import("@/lib/passkeyAuth");

const db = setupTestDb();

async function seedPasskey(auth: SoftAuthenticator, counter = 0) {
  const user = await createTestUser();
  await db.prisma.passkeyCredential.create({ data: { userId: user.id, ...v9Row(auth, counter) } });
  return user;
}

async function seedChallenge(type: "authentication" | "registration", userId: string | null = null) {
  const challenge = newChallenge();
  await db.prisma.passkeyChallenge.create({
    data: { userId, challenge, type, expiresAt: new Date(Date.now() + 60_000) },
  });
  return challenge;
}

function signInInput(auth: SoftAuthenticator, challenge: string, options = {}) {
  const assertion = authenticationResponse(auth, challenge, options);
  return { credentialId: assertion.id, assertionJSON: JSON.stringify(assertion), challenge };
}

describe("authorizePasskey", () => {
  it("signs in with a 9.x-format passkey and records the use", async () => {
    const auth = makeAuthenticator();
    const user = await seedPasskey(auth, 3);
    const challenge = await seedChallenge("authentication");

    const result = await authorizePasskey(signInInput(auth, challenge, { counter: 4, userHandle: user.id }));

    expect(result?.id).toBe(user.id);
    const row = await db.prisma.passkeyCredential.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.counter).toBe(4);
    expect(row.lastUsedAt).not.toBeNull();
    expect(await db.prisma.passkeyChallenge.count()).toBe(0);
  });

  it("refuses to replay a challenge that already signed someone in", async () => {
    const auth = makeAuthenticator();
    await seedPasskey(auth);
    const challenge = await seedChallenge("authentication");
    const input = signInInput(auth, challenge, { counter: 1 });

    expect(await authorizePasskey(input)).not.toBeNull();
    expect(await authorizePasskey(input)).toBeNull();
  });

  it("uses up the challenge on a failed attempt, so it can't be retried", async () => {
    const auth = makeAuthenticator();
    await seedPasskey(auth);
    const challenge = await seedChallenge("authentication");

    const forged = signInInput(auth, challenge, { signWith: makeAuthenticator().privateKey });
    expect(await authorizePasskey(forged)).toBeNull();
    expect(await db.prisma.passkeyChallenge.count()).toBe(0);

    // The genuine assertion for that challenge is now refused too.
    expect(await authorizePasskey(signInInput(auth, challenge))).toBeNull();
  });

  it("lets only one of two concurrent attempts use a challenge", async () => {
    const auth = makeAuthenticator();
    await seedPasskey(auth);
    const challenge = await seedChallenge("authentication");
    const input = signInInput(auth, challenge, { counter: 1 });

    const results = await Promise.all([authorizePasskey(input), authorizePasskey(input)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("refuses an expired or registration challenge", async () => {
    const auth = makeAuthenticator();
    const user = await seedPasskey(auth);
    const expired = newChallenge();
    await db.prisma.passkeyChallenge.create({
      data: { challenge: expired, type: "authentication", expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await authorizePasskey(signInInput(auth, expired))).toBeNull();

    const registration = await seedChallenge("registration", user.id);
    expect(await authorizePasskey(signInInput(auth, registration))).toBeNull();
  });

  it("refuses when credentialId isn't the credential that signed", async () => {
    const auth = makeAuthenticator();
    const other = makeAuthenticator();
    await seedPasskey(auth);
    await seedPasskey(other);
    const challenge = await seedChallenge("authentication");

    const input = signInInput(auth, challenge);
    expect(await authorizePasskey({ ...input, credentialId: v9Row(other, 0).credentialId })).toBeNull();
  });

  it("refuses a user handle that belongs to someone else", async () => {
    const auth = makeAuthenticator();
    await seedPasskey(auth);
    const someoneElse = await createTestUser();
    const challenge = await seedChallenge("authentication");

    expect(await authorizePasskey(signInInput(auth, challenge, { userHandle: someoneElse.id }))).toBeNull();
  });

  it("refuses malformed input and unknown credentials", async () => {
    expect(await authorizePasskey(undefined)).toBeNull();
    expect(await authorizePasskey({ credentialId: "x", assertionJSON: "{", challenge: "c" })).toBeNull();
    const challenge = await seedChallenge("authentication");
    expect(await authorizePasskey(signInInput(makeAuthenticator(), challenge))).toBeNull();
  });
});

describe("verifyPasskeyRegistration", () => {
  it("accepts any unexpired challenge of the user's, so two tabs both work", async () => {
    const user = await createTestUser();
    const first = await seedChallenge("registration", user.id);
    const second = await seedChallenge("registration", user.id);

    const a = makeAuthenticator();
    const resultA = await verifyPasskeyRegistration(user.id, registrationResponse(a, first));
    expect(resultA).toEqual({ ok: true, stored: v9Row(a, 0) });

    const b = makeAuthenticator();
    const resultB = await verifyPasskeyRegistration(user.id, registrationResponse(b, second));
    expect(resultB.ok).toBe(true);
    expect(await db.prisma.passkeyChallenge.count()).toBe(0);
  });

  it("deletes the matched challenge even when verification fails", async () => {
    const user = await createTestUser();
    const challenge = await seedChallenge("registration", user.id);
    const response = registrationResponse(makeAuthenticator(), challenge);
    response.response.attestationObject = "AAAA";

    const result = await verifyPasskeyRegistration(user.id, response);
    expect(result.ok).toBe(false);
    expect(await db.prisma.passkeyChallenge.count()).toBe(0);
  });

  it("refuses a challenge issued to another user", async () => {
    const user = await createTestUser();
    const other = await createTestUser();
    await seedChallenge("registration", user.id);
    const othersChallenge = await seedChallenge("registration", other.id);

    const result = await verifyPasskeyRegistration(user.id, registrationResponse(makeAuthenticator(), othersChallenge));
    expect(result.ok).toBe(false);
    expect(await db.prisma.passkeyChallenge.count({ where: { userId: other.id } })).toBe(1);
  });

  it("refuses when the user has no pending challenge", async () => {
    const user = await createTestUser();
    const result = await verifyPasskeyRegistration(user.id, registrationResponse(makeAuthenticator(), newChallenge()));
    expect(result).toEqual({ ok: false, status: 400, error: "Challenge not found or expired." });
  });

  it("drops unknown transports before storing", async () => {
    const user = await createTestUser();
    const challenge = await seedChallenge("registration", user.id);
    const result = await verifyPasskeyRegistration(
      user.id,
      registrationResponse(makeAuthenticator(), challenge, ["usb", "telepathy"]),
    );
    expect(result.ok && result.stored.transports).toBe('["usb"]');
  });
});
