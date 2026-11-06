import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, createTestUser } from "../helpers/testDb";
import { auth, signOut } from "@/lib/auth";
import { removePushDevice, removePushSubscription, savePushSubscription } from "@/lib/actions/push";
import { logout } from "@/lib/actions/auth";

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
});
