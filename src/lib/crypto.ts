import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { env } from "@/lib/env";

const ALGORITHM = "aes-256-gcm";

// ── Bearer-style tokens (iCal feeds, password resets, invitations) ──────────
//
// These are stored as a hash so a database snapshot — or an offsite backup
// taken before ENCRYPTION_KEY was configured — doesn't hand over working
// tokens. They're high-entropy random values, not user-chosen passwords, so a
// single fast hash is the right primitive: there's nothing to brute-force, and
// a slow KDF would only tax every calendar poll.

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function getKey(): Buffer {
  const key = Buffer.from(env.encryptionKey, "base64");
  if (key.length !== 32) {
    throw new Error(
      "ENCRYPTION_KEY must be set to a base64-encoded 32-byte key (openssl rand -base64 32).",
    );
  }
  return key;
}

// Stored as iv.authTag.ciphertext, each base64-encoded, so the value is a
// single opaque string that fits the existing String? column.
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map((buf) => buf.toString("base64")).join(".");
}

export function decryptSecret(encrypted: string): string {
  const [ivB64, authTagB64, ciphertextB64] = encrypted.split(".");
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

// Stored as iv || authTag || ciphertext, concatenated raw, for larger binary
// payloads (e.g. database backups) where base64 string overhead is wasteful.
export function encryptBuffer(plaintext: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]);
}

export function decryptBuffer(encrypted: Buffer): Buffer {
  const iv = encrypted.subarray(0, 12);
  const authTag = encrypted.subarray(12, 28);
  const ciphertext = encrypted.subarray(28);
  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
