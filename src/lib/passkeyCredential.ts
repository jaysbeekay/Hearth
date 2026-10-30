import type { WebAuthnCredential } from "@simplewebauthn/server";
import { isoUint8Array } from "@simplewebauthn/server/helpers";

// The one place that maps a PasskeyCredential row to and from
// @simplewebauthn's credential shape (#376). The row format is the one the
// 9.x routes wrote, and 14.x reads it unchanged, so passkeys registered before
// the upgrade keep signing in without a data migration:
//
// - credentialId: base64url, no padding. 9.x stored
//   Buffer.from(credentialID).toString("base64url"); 14.x hands back the same
//   string as credential.id, and browsers send it as the assertion's id.
// - publicKey: the raw COSE public key bytes, unchanged between versions.
// - counter: the authenticator's signature counter, unchanged.
// - transports: a JSON array of transport strings, or null.

export type StoredPasskey = {
  credentialId: string;
  publicKey: Uint8Array<ArrayBuffer>;
  counter: number;
  transports: string | null;
};

/** Parse the stored transports JSON, ignoring anything malformed. */
export function parseTransports(json: string | null): string[] | undefined {
  if (!json) return undefined;
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return undefined;
    const transports = parsed.filter((t): t is string => typeof t === "string");
    return transports.length > 0 ? transports : undefined;
  } catch {
    return undefined;
  }
}

/** A stored row as the credential verifyAuthenticationResponse expects. */
export function toWebAuthnCredential(row: StoredPasskey): WebAuthnCredential {
  return {
    id: row.credentialId,
    publicKey: new Uint8Array(row.publicKey),
    counter: row.counter,
    transports: parseTransports(row.transports),
  };
}

/** A newly verified credential as the columns to store, in the 9.x format. */
export function toStoredPasskey(
  credential: WebAuthnCredential,
  transports: readonly string[] | undefined,
): StoredPasskey {
  return {
    credentialId: credential.id,
    publicKey: Buffer.from(credential.publicKey),
    counter: credential.counter,
    transports: transports && transports.length > 0 ? JSON.stringify(transports) : null,
  };
}

/**
 * The WebAuthn user handle for a Hearth user: the UTF-8 bytes of the user id.
 * 9.x took userID as a string and the browser UTF-8 encoded it; 14.x takes
 * bytes, so encode the same way to keep new passkeys on the handle the
 * existing ones carry.
 */
export function webAuthnUserId(userId: string): Uint8Array<ArrayBuffer> {
  return isoUint8Array.fromUTF8String(userId);
}
