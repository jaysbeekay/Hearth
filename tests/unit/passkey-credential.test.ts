import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import {
  parseTransports,
  toStoredPasskey,
  toWebAuthnCredential,
  webAuthnUserId,
  type StoredPasskey,
} from "@/lib/passkeyCredential";

// #376 — passkeys registered under @simplewebauthn 9.x must keep signing in
// under 14.x with no data migration. These tests build real ES256 assertions
// with a software authenticator and verify them against rows in the exact
// format the 9.x routes wrote.

const RP_ID = "localhost";
const ORIGIN = "http://localhost:3000";
const USER_ID = "cmuser0000000000000000000";

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest();

// --- Minimal CBOR encoder: just enough for a COSE key and an attestation object.
function cborHead(major: number, length: number): Buffer {
  if (length < 24) return Buffer.from([(major << 5) | length]);
  if (length < 256) return Buffer.from([(major << 5) | 24, length]);
  return Buffer.from([(major << 5) | 25, length >> 8, length & 0xff]);
}
type Cbor = number | string | Uint8Array | Map<Cbor, Cbor>;
function cbor(value: Cbor): Buffer {
  if (typeof value === "number") {
    return value >= 0 ? cborHead(0, value) : cborHead(1, -1 - value);
  }
  if (typeof value === "string") {
    const bytes = Buffer.from(value, "utf8");
    return Buffer.concat([cborHead(3, bytes.length), bytes]);
  }
  if (value instanceof Uint8Array) {
    return Buffer.concat([cborHead(2, value.length), value]);
  }
  const parts = [cborHead(5, value.size)];
  for (const [k, v] of value) parts.push(cbor(k), cbor(v));
  return Buffer.concat(parts);
}

/** A software ES256 authenticator holding one credential. */
function makeAuthenticator() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const cosePublicKey = cbor(
    new Map<Cbor, Cbor>([
      [1, 2], // kty: EC2
      [3, -7], // alg: ES256
      [-1, 1], // crv: P-256
      [-2, Buffer.from(jwk.x!, "base64url")],
      [-3, Buffer.from(jwk.y!, "base64url")],
    ]),
  );
  return { rawId: randomBytes(16), privateKey, cosePublicKey };
}

function counterBytes(counter: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(counter);
  return buf;
}

function clientData(type: string, challenge: string): Buffer {
  return Buffer.from(JSON.stringify({ type, challenge, origin: ORIGIN, crossOrigin: false }));
}

function registrationResponse(
  auth: ReturnType<typeof makeAuthenticator>,
  challenge: string,
): RegistrationResponseJSON {
  const idLength = Buffer.alloc(2);
  idLength.writeUInt16BE(auth.rawId.length);
  const authData = Buffer.concat([
    sha256(RP_ID),
    Buffer.from([0x45]), // UP | UV | AT
    counterBytes(0),
    Buffer.alloc(16), // AAGUID
    idLength,
    auth.rawId,
    auth.cosePublicKey,
  ]);
  const attestationObject = cbor(
    new Map<Cbor, Cbor>([
      ["fmt", "none"],
      ["attStmt", new Map()],
      ["authData", authData],
    ]),
  );
  return {
    id: b64url(auth.rawId),
    rawId: b64url(auth.rawId),
    type: "public-key",
    clientExtensionResults: {},
    response: {
      clientDataJSON: b64url(clientData("webauthn.create", challenge)),
      attestationObject: b64url(attestationObject),
      transports: ["internal", "hybrid"],
    },
  };
}

function authenticationResponse(
  rawId: Uint8Array,
  privateKey: KeyObject,
  challenge: string,
  counter: number,
): AuthenticationResponseJSON {
  const authData = Buffer.concat([sha256(RP_ID), Buffer.from([0x05]), counterBytes(counter)]);
  const clientDataJSON = clientData("webauthn.get", challenge);
  const signature = sign("sha256", Buffer.concat([authData, sha256(clientDataJSON)]), privateKey);
  return {
    id: b64url(rawId),
    rawId: b64url(rawId),
    type: "public-key",
    clientExtensionResults: {},
    response: {
      authenticatorData: b64url(authData),
      clientDataJSON: b64url(clientDataJSON),
      signature: b64url(signature),
      userHandle: b64url(Buffer.from(USER_ID, "utf8")),
    },
  };
}

/** A row exactly as the 9.x register/verify route stored it. */
function v9Row(auth: ReturnType<typeof makeAuthenticator>, counter: number): StoredPasskey {
  return {
    credentialId: Buffer.from(auth.rawId).toString("base64url"),
    publicKey: Buffer.from(auth.cosePublicKey),
    counter,
    transports: JSON.stringify(["internal", "hybrid"]),
  };
}

function verifyAssertion(row: StoredPasskey, response: AuthenticationResponseJSON, challenge: string) {
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
    const challenge = b64url(randomBytes(32));

    const result = await verifyAssertion(
      row,
      authenticationResponse(auth.rawId, auth.privateKey, challenge, 6),
      challenge,
    );

    expect(result.verified).toBe(true);
    expect(result.authenticationInfo.credentialID).toBe(row.credentialId);
    expect(result.authenticationInfo.newCounter).toBe(6);
  });

  it("verify with a zero counter, as platform passkeys report", async () => {
    const auth = makeAuthenticator();
    const challenge = b64url(randomBytes(32));
    const result = await verifyAssertion(
      v9Row(auth, 0),
      authenticationResponse(auth.rawId, auth.privateKey, challenge, 0),
      challenge,
    );
    expect(result.verified).toBe(true);
  });

  it("reject an assertion signed by a different key", async () => {
    const auth = makeAuthenticator();
    const other = makeAuthenticator();
    const challenge = b64url(randomBytes(32));
    const result = await verifyAssertion(
      v9Row(auth, 0),
      authenticationResponse(auth.rawId, other.privateKey, challenge, 1),
      challenge,
    );
    expect(result.verified).toBe(false);
  });

  it("reject a counter that went backwards (cloned authenticator)", async () => {
    const auth = makeAuthenticator();
    const challenge = b64url(randomBytes(32));
    await expect(
      verifyAssertion(
        v9Row(auth, 10),
        authenticationResponse(auth.rawId, auth.privateKey, challenge, 4),
        challenge,
      ),
    ).rejects.toThrow(/counter/i);
  });
});

describe("passkeys registered under 14.x", () => {
  it("store the same columns 9.x wrote, and sign in from them", async () => {
    const auth = makeAuthenticator();
    const regChallenge = b64url(randomBytes(32));
    const response = registrationResponse(auth, regChallenge);

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: regChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
    });
    expect(verification.verified).toBe(true);
    const stored = toStoredPasskey(
      verification.registrationInfo!.credential,
      response.response.transports,
    );

    // Byte-for-byte what the 9.x route would have stored for this credential.
    expect(stored).toEqual(v9Row(auth, 0));

    const challenge = b64url(randomBytes(32));
    const result = await verifyAssertion(
      stored,
      authenticationResponse(auth.rawId, auth.privateKey, challenge, 1),
      challenge,
    );
    expect(result.verified).toBe(true);
  });
});

describe("passkeyCredential helpers", () => {
  it("parseTransports keeps strings and drops malformed data", () => {
    expect(parseTransports(null)).toBeUndefined();
    expect(parseTransports("")).toBeUndefined();
    expect(parseTransports("not json")).toBeUndefined();
    expect(parseTransports('{"a":1}')).toBeUndefined();
    expect(parseTransports("[]")).toBeUndefined();
    expect(parseTransports('["usb", 3, "nfc"]')).toEqual(["usb", "nfc"]);
  });

  it("toStoredPasskey stores no transports as null", () => {
    const stored = toStoredPasskey(
      { id: "abc", publicKey: new Uint8Array([1, 2, 3]), counter: 0 },
      [],
    );
    expect(stored.transports).toBeNull();
    expect(toStoredPasskey({ id: "abc", publicKey: new Uint8Array(), counter: 0 }, undefined).transports).toBeNull();
  });

  it("webAuthnUserId matches the 9.x user handle (UTF-8 of the user id)", () => {
    expect(Buffer.from(webAuthnUserId(USER_ID))).toEqual(Buffer.from(USER_ID, "utf8"));
  });
});
