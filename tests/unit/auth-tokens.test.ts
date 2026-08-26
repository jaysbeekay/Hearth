import { describe, expect, it } from "vitest";
import { buildConfiguredAppUrl, isUsableOneTimeToken } from "@/lib/authTokens";

describe("auth flow token invariants", () => {
  const future = new Date("2030-01-01T00:00:00Z");
  const now = new Date("2029-01-01T00:00:00Z");

  it("requires the expected purpose, unused state, and non-expired timestamp", () => {
    expect(isUsableOneTimeToken({ purpose: "RESET", expectedPurpose: "RESET", usedAt: null, expiresAt: future, now })).toBe(true);
    expect(isUsableOneTimeToken({ purpose: "INVITE", expectedPurpose: "RESET", usedAt: null, expiresAt: future, now })).toBe(false);
    expect(isUsableOneTimeToken({ purpose: "RESET", expectedPurpose: "RESET", usedAt: new Date(), expiresAt: future, now })).toBe(false);
    expect(isUsableOneTimeToken({ purpose: "RESET", expectedPurpose: "RESET", usedAt: null, expiresAt: now, now: new Date(now.getTime() + 1) })).toBe(false);
  });

  it("does not build invitation/reset links when APP_URL is absent", () => {
    expect(buildConfiguredAppUrl(undefined, "/accept-invitation/token")).toBeNull();
    expect(buildConfiguredAppUrl("https://hearth.example/", "/accept-invitation/token")).toBe("https://hearth.example/accept-invitation/token");
  });
});
