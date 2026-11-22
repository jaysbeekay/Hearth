import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

// #473 review — package.json overrides next-auth's / @auth/core's optional
// @simplewebauthn peer (^9) to Hearth's 14.x. That is only safe while no
// code imports next-auth's own WebAuthn/Passkey code, which was written for 9.x.
// Passkeys are a credentials provider calling @simplewebauthn/server directly.

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "generated" ? [] : sourceFiles(full);
    return /\.(ts|tsx|js|mjs)$/.test(name) ? [full] : [];
  });
}

const FORBIDDEN = [
  /["']next-auth\/providers\/(webauthn|passkey)["']/,
  /["']@auth\/core\/providers\/(webauthn|passkey)["']/,
  /["']next-auth\/webauthn["']/,
  /["']next-auth\/react["'][^\n]*\bsignIn\b[^\n]*webauthn/,
];

describe("next-auth's WebAuthn code stays unused (#376 override)", () => {
  it("no source file imports next-auth's WebAuthn or Passkey provider", () => {
    const offenders = sourceFiles(path.join(process.cwd(), "src")).filter((file) => {
      const text = readFileSync(file, "utf8");
      return FORBIDDEN.some((pattern) => pattern.test(text));
    });
    expect(offenders).toEqual([]);
  });

  it("the override is the documented one, pinned to the installed major", () => {
    const pkg = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
    expect(pkg.overrides["@simplewebauthn/server"]).toBe("$@simplewebauthn/server");
    expect(pkg.overrides["@simplewebauthn/browser"]).toBe("$@simplewebauthn/browser");
    expect(String(pkg.dependencies["@simplewebauthn/server"])).toMatch(/^\^?14\./);
  });
});
