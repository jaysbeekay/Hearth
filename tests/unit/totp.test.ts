import { describe, expect, it } from "vitest";
import * as OTPAuth from "otpauth";
import {
  buildTotpUri,
  consumeRecoveryCode,
  generateRecoveryCodes,
  hashRecoveryCodes,
  verifyTotpCode,
} from "@/lib/totp";

describe("TOTP and recovery codes", () => {
  const secret = "JBSWY3DPEHPK3PXP";

  it("builds a provisioning URI and verifies the current code", () => {
    const uri = buildTotpUri(secret, "user@example.com");
    expect(uri).toContain("otpauth://totp");
    const code = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) }).generate();
    expect(verifyTotpCode(secret, code)).toBe(true);
    expect(verifyTotpCode(secret, "000000")).toBe(false);
  });

  it("consumes recovery codes exactly once", async () => {
    const codes = generateRecoveryCodes();
    const hashes = await hashRecoveryCodes(codes);
    const remaining = await consumeRecoveryCode(codes[0], hashes);
    expect(remaining).not.toBeNull();
    await expect(consumeRecoveryCode(codes[0], remaining!)).resolves.toBeNull();
  });
});
