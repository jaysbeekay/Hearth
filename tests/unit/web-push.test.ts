import { beforeEach, describe, expect, it, vi } from "vitest";
import webpush from "web-push";
import { setupTestDb, createTestUser } from "../helpers/testDb";
import { getVapidKeys, sendPushReminder, sendTestPush } from "@/lib/notifications/push";
import { buildPushReminder } from "@/lib/notifications/reminderContent";
import { channelList } from "@/lib/notifications/channels";
import { pushSubscriptionSchema } from "@/lib/validation/push";

// #375 — Web Push as a Reminder channel, against a real migrated database.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
// No DNS in unit tests; the guard itself is covered by its own tests.
vi.mock("@/lib/net/outbound", () => ({ assertSafeOutboundUrl: vi.fn(async (u: string) => new URL(u)) }));
vi.mock("web-push", async (importOriginal) => {
  const actual = (await importOriginal()) as { default: typeof webpush };
  return { default: { ...actual.default, sendNotification: vi.fn() } };
});

const db = setupTestDb();
const send = vi.mocked(webpush.sendNotification);

const reminder = {
  kind: "contract" as const,
  id: "c1",
  title: "Home insurance",
  detail: "Insurer",
  daysRemaining: 14,
  endDate: new Date("2026-12-01T00:00:00.000Z"),
  appUrl: "https://hearth.example",
};

function subscribe(userId: string, endpoint: string) {
  return db.prisma.pushSubscription.create({ data: { userId, endpoint, p256dh: "p".repeat(20), auth: "a".repeat(10) } });
}

beforeEach(() => {
  send.mockReset();
});

describe("buildPushReminder", () => {
  it("links to the record by path, so it opens on the app's own origin", () => {
    const push = buildPushReminder(reminder);
    expect(push.url).toBe("/contracts/c1");
    expect(push.title).toContain("Home insurance");
    expect(push.body).not.toContain("hearth.example");
  });

  it("opens a Tenancy's Property and leaves the tenant's name out", () => {
    const push = buildPushReminder({ ...reminder, kind: "tenancy", id: "t1", propertyId: "p1", detail: "Jane Tenant" });
    expect(push.url).toBe("/home/p1");
    expect(`${push.title} ${push.body}`).not.toContain("Jane Tenant");
  });
});

describe("VAPID keys", () => {
  it("are generated once and reused", async () => {
    const first = await getVapidKeys();
    const second = await getVapidKeys();
    expect(second).toEqual(first);
    expect(first.publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
  });
});

describe("sending", () => {
  it("drops a subscription the push service says is gone, and records success on the rest", async () => {
    const user = await createTestUser();
    const gone = await subscribe(user.id, "https://push.example/gone");
    const ok = await subscribe(user.id, "https://push.example/ok");
    send.mockImplementation(async (sub) => {
      if (sub.endpoint === gone.endpoint) throw Object.assign(new Error("Gone"), { statusCode: 410 });
      return { statusCode: 201, body: "", headers: {} };
    });

    expect(await sendPushReminder(reminder)).toBe(1);
    expect(await db.prisma.pushSubscription.findUnique({ where: { id: gone.id } })).toBeNull();
    expect((await db.prisma.pushSubscription.findUniqueOrThrow({ where: { id: ok.id } })).lastSuccessAt).not.toBeNull();
    const payload = JSON.parse(String(send.mock.calls.find(([s]) => s.endpoint === ok.endpoint)![1]));
    expect(payload.url).toBe("/contracts/c1");
  });

  it("throws only when no device got it, keeping the error on the device", async () => {
    const user = await createTestUser();
    const sub = await subscribe(user.id, "https://push.example/down");
    send.mockRejectedValue(Object.assign(new Error("Server error"), { statusCode: 500 }));

    await expect(sendPushReminder(reminder)).rejects.toThrow("Server error");
    const row = await db.prisma.pushSubscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(row.lastError).toBe("Server error");
    expect(row.lastFailureAt).not.toBeNull();
  });

  it("sends a test only to the tester's own devices", async () => {
    const me = await createTestUser();
    const other = await createTestUser();
    await subscribe(me.id, "https://push.example/mine");
    await subscribe(other.id, "https://push.example/theirs");
    send.mockResolvedValue({ statusCode: 201, body: "", headers: {} });

    expect(await sendTestPush(me.id)).toBe(1);
    expect(send.mock.calls.map(([s]) => s.endpoint)).toEqual(["https://push.example/mine"]);
  });

  it("fails clearly with no devices", async () => {
    await expect(sendPushReminder(reminder)).rejects.toThrow("No devices");
  });
});

describe("channels and validation", () => {
  it("lists PUSH as a channel once a device has push on", () => {
    expect(channelList({ email: false, ntfy: false, webhook: false, push: true })).toEqual(["PUSH"]);
  });

  it("accepts a browser subscription and rejects a plain-http endpoint", () => {
    const keys = { p256dh: "B".repeat(87), auth: "A".repeat(22) };
    expect(pushSubscriptionSchema.safeParse({ endpoint: "https://fcm.googleapis.com/fcm/send/x", keys }).success).toBe(true);
    expect(pushSubscriptionSchema.safeParse({ endpoint: "http://10.0.0.1/x", keys }).success).toBe(false);
  });
});
