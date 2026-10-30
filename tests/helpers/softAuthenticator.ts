// A software ES256 WebAuthn authenticator for unit tests (#376): builds real
// signed registration and authentication responses, so the passkey code is
// tested against @simplewebauthn's actual verification rather than mocks.
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import type { StoredPasskey } from "@/lib/passkeyCredential";

export const RP_ID = "localhost";
export const ORIGIN = "http://localhost:3000";

export const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
export const newChallenge = () => b64url(randomBytes(32));
const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest();

// Authenticator data flags.
export const UP = 0x01;
export const UV = 0x04;
const AT = 0x40;

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

export type SoftAuthenticator = {
  rawId: Buffer;
  privateKey: KeyObject;
  cosePublicKey: Buffer;
};

export function makeAuthenticator(): SoftAuthenticator {
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

function clientData(type: string, challenge: string, origin: string): Buffer {
  return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
}

export function registrationResponse(
  auth: SoftAuthenticator,
  challenge: string,
  transports: string[] = ["internal", "hybrid"],
): RegistrationResponseJSON {
  const idLength = Buffer.alloc(2);
  idLength.writeUInt16BE(auth.rawId.length);
  const authData = Buffer.concat([
    sha256(RP_ID),
    Buffer.from([UP | UV | AT]),
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
      clientDataJSON: b64url(clientData("webauthn.create", challenge, ORIGIN)),
      attestationObject: b64url(attestationObject),
      transports: transports as RegistrationResponseJSON["response"]["transports"],
    },
  };
}

export type AssertionOptions = {
  counter?: number;
  flags?: number;
  origin?: string;
  rpId?: string;
  userHandle?: string;
  signWith?: KeyObject;
};

export function authenticationResponse(
  auth: SoftAuthenticator,
  challenge: string,
  options: AssertionOptions = {},
): AuthenticationResponseJSON {
  const authData = Buffer.concat([
    sha256(options.rpId ?? RP_ID),
    Buffer.from([options.flags ?? UP | UV]),
    counterBytes(options.counter ?? 1),
  ]);
  const clientDataJSON = clientData("webauthn.get", challenge, options.origin ?? ORIGIN);
  const signature = sign(
    "sha256",
    Buffer.concat([authData, sha256(clientDataJSON)]),
    options.signWith ?? auth.privateKey,
  );
  return {
    id: b64url(auth.rawId),
    rawId: b64url(auth.rawId),
    type: "public-key",
    clientExtensionResults: {},
    response: {
      authenticatorData: b64url(authData),
      clientDataJSON: b64url(clientDataJSON),
      signature: b64url(signature),
      ...(options.userHandle === undefined
        ? {}
        : { userHandle: b64url(Buffer.from(options.userHandle, "utf8")) }),
    },
  };
}

/** A row exactly as the 9.x register/verify route stored it. */
export function v9Row(auth: SoftAuthenticator, counter: number): StoredPasskey {
  return {
    credentialId: Buffer.from(auth.rawId).toString("base64url"),
    publicKey: Buffer.from(auth.cosePublicKey),
    counter,
    transports: JSON.stringify(["internal", "hybrid"]),
  };
}
