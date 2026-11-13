import { describe, expect, it } from "vitest";
import {
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
} from "@simplewebauthn/server";
import {
  parseTransports,
  sanitizeTransports,
  SUPPORTED_ALGORITHM_IDS,
  toStoredPasskey,
  toWebAuthnCredential,
  webAuthnUserId,
  type StoredPasskey,
} from "@/lib/passkeyCredential";
import {
  ORIGIN,
  RP_ID,
  UP,
  authenticationResponse,
  makeAuthenticator,
  newChallenge,
  registrationResponse,
  v9Row,
} from "../helpers/softAuthenticator";

// #376 — passkeys registered under @simplewebauthn 9.x must keep signing in
// under 14.x with no data migration. These tests build real ES256 assertions
// with a software authenticator and verify them against rows in the exact
// format the 9.x routes wrote.

const USER_ID = "cmuser0000000000000000000";

function verifyAssertion(
  row: StoredPasskey,
  response: AuthenticationResponseJSON,
  challenge: string,
) {
  return verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
    credential: toWebAuthnCredential(row),
  });
}

describe("passkey credentials stored by @simplewebauthn 9.x", () => {
  it("still verify a sign-in under 14.x and advance the counter", async () => {
    const auth = makeAuthenticator();
    const row = v9Row(auth, 5);
    const challenge = newChallenge();

    const result = await verifyAssertion(
      row,
      authenticationResponse(auth, challenge, { counter: 6 }),
      challenge,
    );

    expect(result.verified).toBe(true);
    expect(result.authenticationInfo.credentialID).toBe(row.credentialId);
    expect(result.authenticationInfo.newCounter).toBe(6);
  });

  it("verify with a zero counter, as platform passkeys report", async () => {
    const auth = makeAuthenticator();
    const challenge = newChallenge();
    const result = await verifyAssertion(
      v9Row(auth, 0),
      authenticationResponse(auth, challenge, { counter: 0 }),
      challenge,
    );
    expect(result.verified).toBe(true);
  });

  it("reject an assertion signed by a different key", async () => {
    const auth = makeAuthenticator();
    const challenge = newChallenge();
    const result = await verifyAssertion(
      v9Row(auth, 0),
      authenticationResponse(auth, challenge, { signWith: makeAuthenticator().privateKey }),
      challenge,
    );
    expect(result.verified).toBe(false);
  });

  it("reject a counter that went backwards (cloned authenticator)", async () => {
    const auth = makeAuthenticator();
    const challenge = newChallenge();
    await expect(
      verifyAssertion(v9Row(auth, 10), authenticationResponse(auth, challenge, { counter: 4 }), challenge),
    ).rejects.toThrow(/counter/i);
  });

  it("reject an assertion for a different challenge", async () => {
    const auth = makeAuthenticator();
    await expect(
      verifyAssertion(v9Row(auth, 0), authenticationResponse(auth, newChallenge()), newChallenge()),
    ).rejects.toThrow(/challenge/i);
  });

  it("reject an assertion from a different origin", async () => {
    const auth = makeAuthenticator();
    const challenge = newChallenge();
    await expect(
      verifyAssertion(
        v9Row(auth, 0),
        authenticationResponse(auth, challenge, { origin: "https://evil.example" }),
        challenge,
      ),
    ).rejects.toThrow(/origin/i);
  });

  it("reject an assertion for a different RP ID", async () => {
    const auth = makeAuthenticator();
    const challenge = newChallenge();
    await expect(
      verifyAssertion(
        v9Row(auth, 0),
        authenticationResponse(auth, challenge, { rpId: "evil.example" }),
        challenge,
      ),
    ).rejects.toThrow(/RP ID/i);
  });

  it("reject an assertion without user verification", async () => {
    const auth = makeAuthenticator();
    const challenge = newChallenge();
    await expect(
      verifyAssertion(v9Row(auth, 0), authenticationResponse(auth, challenge, { flags: UP }), challenge),
    ).rejects.toThrow(/verif/i);
  });
});

describe("passkeys registered under 14.x", () => {
  it("store the same columns 9.x wrote, and sign in from them", async () => {
    const auth = makeAuthenticator();
    const regChallenge = newChallenge();
    const response = registrationResponse(auth, regChallenge);

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: regChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      supportedAlgorithmIDs: SUPPORTED_ALGORITHM_IDS,
    });
    expect(verification.verified).toBe(true);
    const stored = toStoredPasskey(
      verification.registrationInfo!.credential,
      response.response.transports,
    );

    // Byte-for-byte what the 9.x route would have stored for this credential.
    expect(stored).toEqual(v9Row(auth, 0));

    const challenge = newChallenge();
    const result = await verifyAssertion(stored, authenticationResponse(auth, challenge), challenge);
    expect(result.verified).toBe(true);
  });
});

describe("passkeyCredential helpers", () => {
  it("parseTransports keeps known transports and drops malformed data", () => {
    expect(parseTransports(null)).toBeUndefined();
    expect(parseTransports("")).toBeUndefined();
    expect(parseTransports("not json")).toBeUndefined();
    expect(parseTransports('{"a":1}')).toBeUndefined();
    expect(parseTransports("[]")).toBeUndefined();
    expect(parseTransports('["bogus"]')).toBeUndefined();
    expect(parseTransports('["usb", 3, "carrier-pigeon", "nfc"]')).toEqual(["usb", "nfc"]);
  });

  it("sanitizeTransports keeps only the WebAuthn transports, at most 8", () => {
    expect(
      sanitizeTransports(["ble", "cable", "hybrid", "internal", "nfc", "smart-card", "usb", "x"]),
    ).toEqual(["ble", "cable", "hybrid", "internal", "nfc", "smart-card", "usb"]);
    expect(sanitizeTransports(Array(20).fill("usb"))).toHaveLength(8);
  });

  it("toStoredPasskey stores unknown or no transports as null", () => {
    const credential = { id: "abc", publicKey: new Uint8Array([1, 2, 3]), counter: 0 };
    expect(toStoredPasskey(credential, []).transports).toBeNull();
    expect(toStoredPasskey(credential, undefined).transports).toBeNull();
    expect(toStoredPasskey(credential, ["<script>"]).transports).toBeNull();
    expect(toStoredPasskey(credential, ["usb", "junk"]).transports).toBe('["usb"]');
  });

  it("webAuthnUserId matches the 9.x user handle (UTF-8 of the user id)", () => {
    expect(Buffer.from(webAuthnUserId(USER_ID))).toEqual(Buffer.from(USER_ID, "utf8"));
  });

  it("offers the 9.x algorithm list: EdDSA, ES256, RS256", () => {
    expect(SUPPORTED_ALGORITHM_IDS).toEqual([-8, -7, -257]);
  });
});
