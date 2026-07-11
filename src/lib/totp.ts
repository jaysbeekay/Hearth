import { randomBytes } from "crypto";
import * as OTPAuth from "otpauth";
import bcrypt from "bcryptjs";

const ISSUER = "Hearth";
const RECOVERY_CODE_COUNT = 8;

export function generateTotpSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

export function buildTotpUri(secretBase32: string, email: string): string {
  const totp = new OTPAuth.TOTP({
    issuer: ISSUER,
    label: email,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
  return totp.toString();
}

export function verifyTotpCode(secretBase32: string, code: string): boolean {
  const totp = new OTPAuth.TOTP({
    issuer: ISSUER,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
  return totp.validate({ token: code.trim(), window: 1 }) !== null;
}

function generateRecoveryCode(): string {
  const bytes = randomBytes(5);
  const raw = bytes.toString("hex").toUpperCase();
  return `${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
}

export function generateRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
}

export async function hashRecoveryCodes(codes: string[]): Promise<string> {
  const hashes = await Promise.all(codes.map((code) => bcrypt.hash(code, 10)));
  return JSON.stringify(hashes);
}

// Returns the remaining hashes (JSON) with the matched one removed, or null if no match.
export async function consumeRecoveryCode(
  code: string,
  hashesJson: string,
): Promise<string | null> {
  let hashes: string[];
  try {
    hashes = JSON.parse(hashesJson);
  } catch {
    return null;
  }

  for (let i = 0; i < hashes.length; i++) {
    if (await bcrypt.compare(code.trim(), hashes[i])) {
      const remaining = [...hashes.slice(0, i), ...hashes.slice(i + 1)];
      return JSON.stringify(remaining);
    }
  }
  return null;
}
