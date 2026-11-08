import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, createTestUser } from "../helpers/testDb";
import { requestPasswordReset } from "@/lib/actions/auth";
import { sendPasswordResetEmail } from "@/lib/notifications/email";
import { consumeRateLimit } from "@/lib/rateLimit";

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

  it("logs a throttled request and sends nothing", async () => {
    vi.mocked(consumeRateLimit).mockReturnValueOnce({ allowed: false, remaining: 0, retryAfterSeconds: 60 });

    expect(await requestPasswordReset(null, form(email))).toEqual(GENERIC);

    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
    const [event] = await events();
    expect(event.type).toBe("PASSWORD_RESET_REQUESTED");
    expect(event.detail).toMatch(/^Throttled/);
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
