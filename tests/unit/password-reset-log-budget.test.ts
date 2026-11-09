// Anyone can request a password reset without signing in, so a flood of
// requests must not write unbounded Security-log rows and push real sign-in
// failures off the 100-row Settings > Security list. Uses the real limiter.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { headers } from "next/headers";
import { setupTestDb } from "../helpers/testDb";
import { requestPasswordReset } from "@/lib/actions/auth";
import { RATE_LIMITS, resetRateLimit } from "@/lib/rateLimit";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }));
vi.mock("next-auth", () => ({ AuthError: class AuthError extends Error {}, CredentialsSignin: class CredentialsSignin extends Error {} }));
vi.mock("@/lib/notifications/email", () => ({ sendPasswordResetEmail: vi.fn(), sendInvitationEmail: vi.fn() }));

const db = setupTestDb();

function from(address: string) {
  vi.mocked(headers).mockResolvedValue(new Headers({ "x-forwarded-for": address }) as never);
}

function form(email: string) {
  const data = new FormData();
  data.set("email", email);
  return data;
}

const resetRows = () => db.prisma.securityEventLog.findMany({ where: { type: "PASSWORD_RESET_REQUESTED" } });

beforeEach(async () => {
  await db.prisma.securityEventLog.deleteMany();
  resetRateLimit("passwordResetLog", "all");
});

describe("password reset logging volume", () => {
  it("logs one throttle row per address, not one per refused request", async () => {
    resetRateLimit("passwordReset", "203.0.113.9");
    from("203.0.113.9");
    for (let i = 0; i < 20; i++) await requestPasswordReset(null, form(`nobody${i}@example.com`));

    const rows = await resetRows();
    expect(rows).toHaveLength(RATE_LIMITS.passwordReset.limit + 1);
    expect(rows.filter((r) => r.detail?.startsWith("Throttled"))).toHaveLength(1);
  });

  it("caps rows across rotating addresses and keeps earlier sign-in failures in view", async () => {
    await db.prisma.securityEventLog.create({ data: { type: "LOGIN_FAILED", email: "victim@example.com" } });
    for (let i = 0; i < 150; i++) {
      from(`198.51.100.${i}`);
      await requestPasswordReset(null, form(`nobody${i}@example.com`));
    }

    const rows = await resetRows();
    expect(rows).toHaveLength(RATE_LIMITS.passwordResetLog.limit);
    expect(rows.some((r) => r.detail?.includes("logging them is paused"))).toBe(true);
    const page = await db.prisma.securityEventLog.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
    expect(page.some((r) => r.type === "LOGIN_FAILED")).toBe(true);
  });
});
