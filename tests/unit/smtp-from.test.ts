import { describe, expect, it } from "vitest";
import { isQualifiedSmtpFrom, resolveSmtpFrom, smtpFromAddress } from "@/lib/smtpFrom";

// The old default From, no-reply@localhost, was rejected by real SMTP servers
// ("504 5.5.2 need fully-qualified address"), so no email got through.

describe("smtpFromAddress", () => {
  it("reads the address from a display-name form or a bare address", () => {
    expect(smtpFromAddress("Hearth <hearth@example.com>")).toBe("hearth@example.com");
    expect(smtpFromAddress(" hearth@example.com ")).toBe("hearth@example.com");
    expect(smtpFromAddress("Hearth")).toBe("");
  });
});

describe("isQualifiedSmtpFrom", () => {
  it.each([
    ["Hearth <no-reply@localhost>", false],
    ["no-reply@hearth.localhost", false],
    ["hearth@mailserver", false],
    ["", false],
    ["Hearth <hearth@example.com>", true],
    ["appsupport@cjak.com.au", true],
  ])("%s → %s", (value, expected) => {
    expect(isQualifiedSmtpFrom(value)).toBe(expected);
  });
});

describe("resolveSmtpFrom", () => {
  it("keeps a qualified From", () => {
    expect(resolveSmtpFrom("Hearth <hearth@example.com>", "login@example.org")).toBe("Hearth <hearth@example.com>");
  });

  it("falls back to the username when From is blank or unqualified", () => {
    expect(resolveSmtpFrom("Hearth <no-reply@localhost>", "login@example.org")).toBe("Hearth <login@example.org>");
    expect(resolveSmtpFrom("", "login@example.org")).toBe("Hearth <login@example.org>");
  });

  it("leaves it alone when the username isn't an address either", () => {
    expect(resolveSmtpFrom("Hearth <no-reply@localhost>", "apikey")).toBe("Hearth <no-reply@localhost>");
  });
});
