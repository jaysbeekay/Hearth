import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, createTestUser } from "../helpers/testDb";
import { auth, signOut } from "@/lib/auth";
import { removePushDevice, removePushSubscription, savePushSubscription } from "@/lib/actions/push";
import bcrypt from "bcryptjs";
import { changePassword, logout, resetPassword } from "@/lib/actions/auth";
import { hashToken } from "@/lib/crypto";
import { endpointHash } from "@/lib/pushClient";

// #375 part 2 — each member manages only their own devices, and signing out
// takes this device's subscription with it.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }));
vi.mock("next-auth", () => ({ AuthError: class AuthError extends Error {}, CredentialsSignin: class CredentialsSignin extends Error {} }));
vi.mock("@/lib/net/outbound", () => ({ assertSafeOutboundUrl: vi.fn(async (u: string) => new URL(u)) }));

const db = setupTestDb();
const keys = { p256dh: "B".repeat(87), auth: "A".repeat(22) };

async function signedInAs(id: string) {
  vi.mocked(auth).mockResolvedValue({ user: { id, role: "MEMBER" } } as never);
}

function subscribe(userId: string, endpoint: string) {
  return db.prisma.pushSubscription.create({ data: { userId, endpoint, p256dh: keys.p256dh, auth: keys.auth } });
}

beforeEach(() => {
  vi.mocked(signOut).mockReset();
});

describe("push devices", () => {
  it("moves a device to whoever turns push on there last", async () => {
    const a = await createTestUser();
    const b = await createTestUser();
    await subscribe(a.id, "https://push.example/shared");
    await signedInAs(b.id);

    expect(await savePushSubscription({ endpoint: "https://push.example/shared", keys })).toEqual({
      success: expect.any(String),
    });
    const rows = await db.prisma.pushSubscription.findMany();
    expect(rows.map((r) => r.userId)).toEqual([b.id]);
  });

  it("removes only the caller's own devices", async () => {
    const me = await createTestUser();
    const other = await createTestUser();
    const mine = await subscribe(me.id, "https://push.example/mine");
    const theirs = await subscribe(other.id, "https://push.example/theirs");
    await signedInAs(me.id);

    expect(await removePushDevice({ id: theirs.id })).toEqual({ error: "That device is already gone." });
    await removePushSubscription({ endpoint: theirs.endpoint });
    expect(await db.prisma.pushSubscription.count({ where: { id: theirs.id } })).toBe(1);

    expect(await removePushDevice({ id: mine.id })).toEqual({ success: "Device removed." });
    expect(await db.prisma.pushSubscription.count({ where: { id: mine.id } })).toBe(0);
  });

  it("drops this device's subscription on sign-out, and nobody else's", async () => {
    const me = await createTestUser();
    const other = await createTestUser();
    await subscribe(me.id, "https://push.example/this-browser");
    await subscribe(me.id, "https://push.example/my-phone");
    await subscribe(other.id, "https://push.example/theirs");
    await signedInAs(me.id);

    await logout("https://push.example/this-browser");
    await logout("https://push.example/theirs");

    const left = (await db.prisma.pushSubscription.findMany()).map((r) => r.endpoint).sort();
    expect(left).toEqual(["https://push.example/my-phone", "https://push.example/theirs"]);
    expect(signOut).toHaveBeenCalledTimes(2);
  });

  it("ignores a sign-out with no session, or a missing or oversize endpoint", async () => {
    const me = await createTestUser();
    await subscribe(me.id, "https://push.example/this-browser");

    vi.mocked(auth).mockResolvedValue(null as never);
    await logout("https://push.example/this-browser");
    await signedInAs(me.id);
    await logout(undefined);
    await logout(`https://push.example/${"x".repeat(2100)}`);
    await logout(42 as never);

    expect(await db.prisma.pushSubscription.count()).toBe(1);
    expect(signOut).toHaveBeenCalledTimes(4);
  });

  it("still signs out when dropping the push subscription fails", async () => {
    const me = await createTestUser();
    await signedInAs(me.id);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const deleteMany = vi.spyOn(db.prisma.pushSubscription, "deleteMany").mockRejectedValueOnce(new Error("database is locked"));

    await logout("https://push.example/this-browser");
    expect(signOut).toHaveBeenCalledTimes(1);
    deleteMany.mockRestore();
    spy.mockRestore();
  });

  it("stops push on every device of a member whose password changes or is reset", async () => {
    const me = await createTestUser();
    const other = await createTestUser();
    await db.prisma.user.update({ where: { id: me.id }, data: { passwordHash: await bcrypt.hash("old-long-password-1", 4) } });
    await subscribe(me.id, "https://push.example/laptop");
    await subscribe(me.id, "https://push.example/phone");
    await subscribe(other.id, "https://push.example/theirs");
    await signedInAs(me.id);

    const fd = new FormData();
    fd.set("currentPassword", "old-long-password-1");
    fd.set("newPassword", "new-long-password-2");
    await changePassword(null, fd);
    expect((await db.prisma.pushSubscription.findMany()).map((r) => r.endpoint)).toEqual(["https://push.example/theirs"]);

    await subscribe(other.id, "https://push.example/theirs-too");
    await db.prisma.passwordResetToken.create({
      data: { tokenHash: hashToken("reset-1"), userId: other.id, purpose: "RESET", expiresAt: new Date(Date.now() + 3_600_000) },
    });
    const reset = new FormData();
    reset.set("password", "a-new-long-password-1");
    expect(await resetPassword("reset-1", null, reset)).toEqual({ success: expect.any(String) });
    expect(await db.prisma.pushSubscription.count()).toBe(0);
  });

  it("refuses an invalid device id", async () => {
    const me = await createTestUser();
    const mine = await subscribe(me.id, "https://push.example/mine");
    await signedInAs(me.id);
    expect(await removePushDevice({})).toEqual({ error: "Invalid device." });
    expect(await removePushDevice({ id: 42 })).toEqual({ error: "Invalid device." });
    expect(await db.prisma.pushSubscription.count({ where: { id: mine.id } })).toBe(1);
  });

  it("answers a signed-out caller with an error", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect(await removePushDevice({ id: "x" })).toEqual({ error: expect.any(String) });
  });

  it("hashes an endpoint the same way in the browser as for the Settings list", async () => {
    const endpoint = "https://fcm.googleapis.com/fcm/send/abc";
    expect(await endpointHash(endpoint)).toBe(hashToken(endpoint));
  });
});
