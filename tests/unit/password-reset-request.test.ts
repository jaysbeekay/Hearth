import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, createTestUser } from "../helpers/testDb";
import { requestPasswordReset } from "@/lib/actions/auth";
import { sendPasswordResetEmail } from "@/lib/notifications/email";
import { consumeRateLimit } from "@/lib/rateLimit";
import { setAppSetting } from "@/lib/appSettings";

// A reset request always answers with the same generic message, so a failed
// send used to leave no trace anywhere. Every outcome is now recorded in the
// admin-only security log, and a failed send carries the SMTP error.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }));
vi.mock("next-auth", () => ({ AuthError: class AuthError extends Error {}, CredentialsSignin: class CredentialsSignin extends Error {} }));
vi.mock("@/lib/notifications/email", () => ({
  sendPasswordResetEmail: vi.fn(),
  sendInvitationEmail: vi.fn(),
}));
vi.mock("@/lib/rateLimit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rateLimit")>()),
  consumeRateLimit: vi.fn(() => ({ allowed: true, retryAfterSeconds: 0 })),
}));

const db = setupTestDb();
const GENERIC = { success: "If that email exists, we've sent a password reset link." };
let email: string;

beforeEach(async () => {
  vi.mocked(sendPasswordResetEmail).mockReset();
  await db.prisma.securityEventLog.deleteMany();
  await setAppSetting("smtp.host", "smtp.example.com");
  await setAppSetting("smtp.user", "login@example.org");
  email = (await createTestUser()).email;
});

function form(value: string) {
  const fd = new FormData();
  fd.set("email", value);
  return fd;
}

const events = () => db.prisma.securityEventLog.findMany({ orderBy: { createdAt: "asc" } });

describe("requestPasswordReset", () => {
  it("logs a failed send with the SMTP error, without changing the response", async () => {
    vi.mocked(sendPasswordResetEmail).mockRejectedValueOnce(new Error("Invalid login: 535 Authentication failed"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await requestPasswordReset(null, form(email))).toEqual(GENERIC);

    const [event] = await events();
    expect(event.type).toBe("PASSWORD_RESET_EMAIL_FAILED");
    expect(event.email).toBe(email);
    expect(event.detail).toBe("Invalid login: 535 Authentication failed");
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("logs a successful send", async () => {
    expect(await requestPasswordReset(null, form(email))).toEqual(GENERIC);

    expect(sendPasswordResetEmail).toHaveBeenCalledWith(email, expect.stringContaining("/reset-password/"));
    const [event] = await events();
    expect(event.type).toBe("PASSWORD_RESET_REQUESTED");
    expect(event.detail).toMatch(/Reset email/);
  });

  it("notes the throttle once, on the request that uses up the last slot", async () => {
    vi.mocked(consumeRateLimit).mockReturnValueOnce({ allowed: true, remaining: 0, retryAfterSeconds: 60 });
    expect(await requestPasswordReset(null, form(email))).toEqual(GENERIC);
    expect((await events()).map((e) => e.detail?.slice(0, 9))).toEqual(["Throttled", "Reset ema"]);
  });

  it("neither sends nor logs a refused request", async () => {
    vi.mocked(consumeRateLimit).mockReturnValueOnce({ allowed: false, remaining: 0, retryAfterSeconds: 60 });

    expect(await requestPasswordReset(null, form(email))).toEqual(GENERIC);

    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
    expect(await events()).toEqual([]);
  });

  it("logs that nothing was sent when SMTP isn't configured, and makes no token", async () => {
    await setAppSetting("smtp.host", "");

    expect(await requestPasswordReset(null, form(email))).toEqual(GENERIC);

    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
    expect(await db.prisma.passwordResetToken.count()).toBe(0);
    const [event] = await events();
    expect(event.detail).toBe("SMTP is not configured; nothing sent");
  });

  it("says when the link points at localhost because APP_URL is unset", async () => {
    const saved = { APP_URL: process.env.APP_URL, RENDER_EXTERNAL_URL: process.env.RENDER_EXTERNAL_URL };
    delete process.env.APP_URL;
    delete process.env.RENDER_EXTERNAL_URL;
    try {
      await requestPasswordReset(null, form(email));
      expect((await events())[0].detail).toMatch(/APP_URL is not set/);
      process.env.APP_URL = "https://hearth.example.com";
      await db.prisma.securityEventLog.deleteMany();
      await requestPasswordReset(null, form(email));
      expect((await events())[0].detail).toBe("Reset email handed to the SMTP server");
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("rejects an over-long email before doing anything", async () => {
    const result = await requestPasswordReset(null, form(`${"a".repeat(250)}@example.com`));
    expect(result).toHaveProperty("error");
    expect(await events()).toEqual([]);
  });

  it("logs a request for an unknown email and sends nothing", async () => {
    expect(await requestPasswordReset(null, form("nobody@example.com"))).toEqual(GENERIC);

    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
    const [event] = await events();
    expect(event.type).toBe("PASSWORD_RESET_REQUESTED");
    expect(event.email).toBe("nobody@example.com");
    expect(event.detail).toBe("No account with this email; nothing sent");
  });
});
