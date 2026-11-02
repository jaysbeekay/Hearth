import { describe, expect, it } from "vitest";
import { isPublicPath } from "@/lib/auth.config";

// PUBLIC_PATHS match the exact path or a sub-path, never a bare string
// prefix (#477), so a new route that merely starts with a public name stays
// behind the login.

describe("isPublicPath", () => {
  it.each([
    "/login",
    "/setup",
    "/forgot-password",
    "/reset-password/0123456789abcdef",
    "/accept-invitation/0123456789abcdef",
    "/api/cron",
    "/api/mcp",
    "/api/ical",
    "/api/health",
  ])("treats %s as public", (pathname) => {
    expect(isPublicPath(pathname)).toBe(true);
  });

  it.each([
    "/api/healthz",
    "/api/health-admin",
    "/setupx",
    "/login-history",
    "/api/cronjobs",
    "/api/mcp-admin",
    "/api/icalendar",
    "/reset-passwords",
    "/",
    "/contracts",
    "/api/documents/abc",
  ])("keeps %s behind the login", (pathname) => {
    expect(isPublicPath(pathname)).toBe(false);
  });
});
