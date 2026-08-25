import { beforeEach, describe, expect, it } from "vitest";
import { decryptBuffer, decryptSecret, encryptBuffer, encryptSecret } from "@/lib/crypto";

beforeEach(() => {
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});

describe("crypto primitives", () => {
  it("round-trips secrets", () => {
    const encrypted = encryptSecret("sensitive value");
    expect(decryptSecret(encrypted)).toBe("sensitive value");
  });

  it("round-trips binary buffers", () => {
    const input = Buffer.from([0, 1, 2, 255, 254]);
    expect(decryptBuffer(encryptBuffer(input))).toEqual(input);
  });

  it("rejects tampered ciphertext and auth tags", () => {
    const encrypted = encryptSecret("sensitive value").split(".");
    encrypted[1] = Buffer.alloc(16, 1).toString("base64");
    expect(() => decryptSecret(encrypted.join("."))).toThrow();
  });

  it("rejects an invalid encryption key", () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(8).toString("base64");
    expect(() => encryptSecret("value")).toThrow(/ENCRYPTION_KEY must be set/);
  });
});
