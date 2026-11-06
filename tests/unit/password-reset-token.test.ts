import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, createTestUser } from "../helpers/testDb";
import { hashToken } from "@/lib/crypto";
import { resetPassword, acceptInvitation } from "@/lib/actions/auth";
import { signIn } from "@/lib/auth";

// #372 — a reset or invitation link signs you in after setting the password
// (unless two-factor is on), so the link itself has to be strictly one-time:
// used or expired links are refused, two requests racing on one link can't
// both succeed, and every earlier session is signed out.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }));
vi.mock("next-auth", () => ({ AuthError: class AuthError extends Error {}, CredentialsSignin: class CredentialsSignin extends Error {} }));

const db = setupTestDb();
const HOUR = 60 * 60 * 1000;
let userId: string;

beforeEach(async () => {
  vi.mocked(signIn).mockReset();
  userId = (await createTestUser()).id;
});

async function link(raw: string, purpose: "RESET" | "INVITE", opts: { expiresAt?: Date; usedAt?: Date } = {}) {
  await db.prisma.passwordResetToken.create({
    data: {
      tokenHash: hashToken(raw),
      userId,
      purpose,
      expiresAt: opts.expiresAt ?? new Date(Date.now() + HOUR),
      usedAt: opts.usedAt ?? null,
    },
  });
  return raw;
}

function password(value = "a-new-long-password-1") {
  const fd = new FormData();
  fd.set("password", value);
  return fd;
}

const user = () => db.prisma.user.findUniqueOrThrow({ where: { id: userId } });

describe("password reset links", () => {
  it("set the password and sign out earlier sessions, without signing the user in", async () => {
    const token = await link("reset-ok", "RESET");
    const before = await user();

    expect(await resetPassword(token, null, password())).toEqual({ success: "Password updated. You can now sign in." });

    const after = await user();
    expect(after.passwordHash).not.toBe(before.passwordHash);
    expect(after.sessionVersion).toBe(before.sessionVersion + 1);
    expect(signIn).not.toHaveBeenCalled();
    expect(await resetPassword(token, null, password())).toEqual({ error: "This reset link is invalid or has expired." });
  });

  it("refuse a used or expired link without touching the account", async () => {
    const used = await link("reset-used", "RESET", { usedAt: new Date() });
    const expired = await link("reset-expired", "RESET", { expiresAt: new Date(Date.now() - 1000) });
    const before = await user();

    expect(await resetPassword(used, null, password())).toEqual({ error: "This reset link is invalid or has expired." });
    expect(await resetPassword(expired, null, password())).toEqual({ error: "This reset link is invalid or has expired." });

    expect(await user()).toEqual(before);
    expect(signIn).not.toHaveBeenCalled();
  });

  it("let only one of two requests racing on the same link set a password", async () => {
    const token = await link("reset-race", "RESET");
    const before = await user();

    const results = await Promise.all([
      resetPassword(token, null, password("first-long-password-1")),
      resetPassword(token, null, password("second-long-password-2")),
    ]);

    expect(results.filter((r) => r?.success)).toHaveLength(1);
    expect(results.filter((r) => r?.error)).toHaveLength(1);
    expect((await user()).sessionVersion).toBe(before.sessionVersion + 1);
  });

  it("don't sign in an account with two-factor on either", async () => {
    await db.prisma.user.update({ where: { id: userId }, data: { totpEnabled: true } });
    const token = await link("reset-totp", "RESET");

    expect(await resetPassword(token, null, password())).toEqual({ success: "Password updated. You can now sign in." });
    expect(signIn).not.toHaveBeenCalled();
  });

  it("can't be used as an invitation, and an invitation can't be used twice", async () => {
    const reset = await link("reset-as-invite", "RESET");
    expect(await acceptInvitation(reset, null, password())).toEqual({ error: "This invitation link is invalid or has expired." });

    const invite = await link("invite-once", "INVITE");
    expect((await acceptInvitation(invite, null, password()))?.success).toBeTruthy();
    expect(await acceptInvitation(invite, null, password())).toEqual({ error: "This invitation link is invalid or has expired." });
  });
});
