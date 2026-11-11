import { describe, expect, it } from "vitest";
import { envSmtpFromFallback, isQualifiedSmtpFrom, resolveSmtpFrom, smtpFromAddress, smtpFromWarning } from "@/lib/smtpFrom";

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
    ["hearth@example.com (Hearth)", true],
    ["a@b..com", false],
    ["a@b.com,c", false],
    ["Hearth <a@b.com>, Other <c@d.com>", false],
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
    expect(resolveSmtpFrom("", "apikey")).toBe("");
  });
});

describe("envSmtpFromFallback", () => {
  it("ignores the old unqualified default left in .env files", () => {
    expect(envSmtpFromFallback("Hearth <no-reply@localhost>")).toBe("");
    expect(envSmtpFromFallback("Hearth <hearth@example.com>")).toBe("Hearth <hearth@example.com>");
  });
});

describe("smtpFromWarning", () => {
  const host = "smtp.example.com";

  it("says nothing before SMTP is set up, or when the From is fine", () => {
    expect(smtpFromWarning({ host: "", from: "", sentFrom: "" })).toBeNull();
    expect(smtpFromWarning({ host, from: "", sentFrom: "Hearth <login@example.org>" })).toBeNull();
    expect(smtpFromWarning({ host, from: "a@example.com", sentFrom: "a@example.com" })).toBeNull();
  });

  it("says which address is used instead of an unqualified From", () => {
    expect(smtpFromWarning({ host, from: "x@localhost", sentFrom: "Hearth <login@example.org>" })).toMatch(
      /sends as Hearth <login@example.org> instead/,
    );
  });

  it("warns when there is no usable From at all", () => {
    expect(smtpFromWarning({ host, from: "x@localhost", sentFrom: "x@localhost" })).toMatch(/will reject/);
    // Blank From with a SendGrid-style "apikey" username.
    expect(smtpFromWarning({ host, from: "", sentFrom: "" })).toMatch(/Set a From address/);
  });
});
