import { createECDH, randomBytes } from "node:crypto";
import net from "node:net";
import webpush from "web-push";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, createTestUser } from "../helpers/testDb";
import { auth } from "@/lib/auth";
import { safeFetch } from "@/lib/net/outbound";
import {
  assertPushEndpoint,
  getVapidKeys,
  getVapidPublicKey,
  resetPushCaches,
  sendPushReminder,
  sendTestPush,
  validVapidSubject,
} from "@/lib/notifications/push";
import { buildPushReminder } from "@/lib/notifications/reminderContent";
import { channelList } from "@/lib/notifications/channels";
import { getHouseholdReminderHealth } from "@/lib/notifications/health";
import { runExpirationCheck } from "@/lib/notifications/scheduler";
import { refreshPushSubscription, removePushSubscription, savePushSubscription, sendPushTest } from "@/lib/actions/push";
import { createContractCommand } from "@/lib/commands/contracts";
import { contractSchema } from "@/lib/validation/contract";
import { pushSubscriptionSchema } from "@/lib/validation/push";
import { notificationTarget } from "@/lib/pushNotificationUrl";

// #375 — Web Push as a Reminder channel, against a real migrated database.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }));
// No network in unit tests. The real address guard runs for IP literals (no
// DNS needed); a name is passed through. Sends go to a stub.
vi.mock("@/lib/net/outbound", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/net/outbound")>();
  return {
    ...actual,
    assertSafeOutboundUrl: vi.fn(async (raw: string, options?: { allowLocal?: boolean }) => {
      const host = new URL(raw).hostname.replace(/^\[|\]$/g, "");
      return net.isIP(host) ? actual.assertSafeOutboundUrl(raw, options) : new URL(raw);
    }),
    safeFetch: vi.fn(),
  };
});

const db = setupTestDb();
const send = vi.mocked(safeFetch);

// A real browser-shaped key pair, so payloads really get encrypted.
const keys = { p256dh: createECDH("prime256v1").generateKeys().toString("base64url"), auth: randomBytes(16).toString("base64url") };

function status(code: number, body = "") {
  return { response: new Response(null, { status: code }), body };
}

const reminder = {
  kind: "contract" as const,
  id: "c1",
  title: "Home insurance",
  detail: "Insurer",
  daysRemaining: 14,
  endDate: new Date("2026-12-01T00:00:00.000Z"),
  appUrl: "https://hearth.example",
};

function subscribe(userId: string, endpoint: string, extra: { lastSuccessAt?: Date; lastFailureAt?: Date } = {}) {
  return db.prisma.pushSubscription.create({ data: { userId, endpoint, ...keys, ...extra } });
}

function signedInAs(id: string, role = "MEMBER") {
  vi.mocked(auth).mockResolvedValue({ user: { id, role } } as never);
}

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

beforeEach(() => {
  send.mockReset();
  vi.mocked(auth).mockReset();
  resetPushCaches();
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
  it("are generated once and reused, even when asked for at the same time", async () => {
    const [first, second] = await Promise.all([getVapidKeys(), getVapidKeys()]);
    expect(second).toEqual(first);
    resetPushCaches();
    expect(await getVapidKeys()).toEqual(first);
    expect(first.publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    expect(await db.prisma.appSetting.count({ where: { key: { startsWith: "push.vapid" } } })).toBe(2);
  });

  it("are never replaced when the private key won't decrypt", async () => {
    await db.prisma.appSetting.createMany({
      data: [
        { key: "push.vapidPublicKey", value: "old-public", encrypted: false },
        { key: "push.vapidPrivateKey", value: "not.a.ciphertext", encrypted: true },
      ],
    });
    await expect(getVapidKeys()).rejects.toThrow("can't be decrypted");
    expect(await getVapidPublicKey()).toBeNull();
    const stored = await db.prisma.appSetting.findUniqueOrThrow({ where: { key: "push.vapidPublicKey" } });
    expect(stored.value).toBe("old-public");
  });

  it("only accepts a mailto: or https: VAPID_SUBJECT", () => {
    expect(validVapidSubject("mailto:me@example.com")).toBe("mailto:me@example.com");
    expect(validVapidSubject("https://hearth.example")).toBe("https://hearth.example");
    expect(validVapidSubject("me@example.com")).toBeNull();
    expect(validVapidSubject("http://hearth.example")).toBeNull();
  });
});

describe("push endpoints", () => {
  it("refuses the server's own network and metadata hosts, whatever BLOCK_PRIVATE_NETWORK_TARGETS says", async () => {
    await expect(assertPushEndpoint("https://10.0.0.5:8443/x")).rejects.toThrow();
    await expect(assertPushEndpoint("https://127.0.0.1/x")).rejects.toThrow();
    await expect(assertPushEndpoint("https://169.254.169.254/x")).rejects.toThrow();
    await expect(assertPushEndpoint("http://142.250.0.1/x")).rejects.toThrow();
    await expect(assertPushEndpoint("https://142.250.0.1/x")).resolves.toBeUndefined();
  });

  it("validates the browser's subscription, keys included", () => {
    expect(pushSubscriptionSchema.safeParse({ endpoint: "https://fcm.googleapis.com/fcm/send/x", keys }).success).toBe(true);
    expect(pushSubscriptionSchema.safeParse({ endpoint: "http://10.0.0.1/x", keys }).success).toBe(false);
    expect(pushSubscriptionSchema.safeParse({ endpoint: "https://fcm.googleapis.com/x", keys: { ...keys, p256dh: "B".repeat(20) } }).success).toBe(false);
    expect(pushSubscriptionSchema.safeParse({ endpoint: "https://fcm.googleapis.com/x", keys: { ...keys, auth: "A".repeat(10) } }).success).toBe(false);
  });
});

describe("sending", () => {
  afterEach(() => vi.restoreAllMocks());

  it("drops a subscription the push service says is gone, and records success on the rest", async () => {
    const user = await createTestUser();
    const gone = await subscribe(user.id, "https://push.example/gone");
    const ok = await subscribe(user.id, "https://push.example/ok");
    send.mockImplementation(async (url) => (url === gone.endpoint ? status(410) : status(201)));

    expect(await sendPushReminder(reminder)).toBe(1);
    expect(await db.prisma.pushSubscription.findUnique({ where: { id: gone.id } })).toBeNull();
    expect((await db.prisma.pushSubscription.findUniqueOrThrow({ where: { id: ok.id } })).lastSuccessAt).not.toBeNull();
    const [, init, options] = send.mock.calls.find(([url]) => url === ok.endpoint)!;
    // No redirects, a total timeout, a body cap, and never the local network.
    expect(init).toMatchObject({ method: "POST", redirect: "manual" });
    expect(options).toMatchObject({ allowLocal: false, timeoutMs: 10_000 });
    expect(init?.body).toBeInstanceOf(Uint8Array);
  });

  it("tells each device which member its Reminder is for, so the browser can check", async () => {
    const a = await createTestUser();
    const b = await createTestUser();
    await subscribe(a.id, "https://push.example/a");
    await subscribe(b.id, "https://push.example/b");
    send.mockImplementation(async () => status(201));
    const details = vi.spyOn(webpush, "generateRequestDetails");

    expect(await sendPushReminder(reminder)).toBe(2);
    const sent = Object.fromEntries(
      details.mock.calls.map(([sub, payload]) => [sub.endpoint, JSON.parse(String(payload)) as { userId?: string }]),
    );
    expect(sent["https://push.example/a"].userId).toBe(a.id);
    expect(sent["https://push.example/b"].userId).toBe(b.id);
  });

  it("throws a generic error only when no device got it, keeping the detail on the device", async () => {
    const user = await createTestUser();
    const sub = await subscribe(user.id, "https://push.example/down");
    send.mockResolvedValue(status(500, "upstream exploded"));

    await expect(sendPushReminder(reminder)).rejects.toThrow("The device's push service didn't accept it.");
    const row = await db.prisma.pushSubscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(row.lastError).toBe("500: upstream exploded");
    expect(row.lastFailureAt).not.toBeNull();
  });

  it("keeps when a run of failures began, and drops a device failing for 30 days", async () => {
    const user = await createTestUser();
    const since = daysAgo(5);
    const recent = await subscribe(user.id, "https://push.example/recent", { lastSuccessAt: daysAgo(40), lastFailureAt: since });
    const dead = await subscribe(user.id, "https://push.example/dead", { lastSuccessAt: daysAgo(60), lastFailureAt: daysAgo(31) });
    const ok = await subscribe(user.id, "https://push.example/ok", { lastSuccessAt: daysAgo(90) });
    send.mockImplementation(async (url) => (url === ok.endpoint ? status(201) : status(403)));

    expect(await sendPushReminder(reminder)).toBe(1);
    expect((await db.prisma.pushSubscription.findUniqueOrThrow({ where: { id: recent.id } })).lastFailureAt).toEqual(since);
    expect(await db.prisma.pushSubscription.findUnique({ where: { id: dead.id } })).toBeNull();
  });

  it("still counts a delivery when the device was removed mid-send", async () => {
    const user = await createTestUser();
    const sub = await subscribe(user.id, "https://push.example/removed");
    send.mockImplementation(async () => {
      await db.prisma.pushSubscription.delete({ where: { id: sub.id } });
      return status(201);
    });
    expect(await sendPushReminder(reminder)).toBe(1);
  });

  it("never sends to an endpoint on the server's own network", async () => {
    const user = await createTestUser();
    const sub = await subscribe(user.id, "https://192.168.1.1/x");
    await expect(sendPushReminder(reminder)).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
    // Push's own wording, not the BLOCK_PRIVATE_NETWORK_TARGETS one.
    const row = await db.prisma.pushSubscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(row.lastError).toBe("The push endpoint isn't a public address (it's private, local or cloud metadata).");
  });

  it("sends a test only to the tester's own devices", async () => {
    const me = await createTestUser();
    const other = await createTestUser();
    await subscribe(me.id, "https://push.example/mine");
    await subscribe(other.id, "https://push.example/theirs");
    send.mockResolvedValue(status(201));

    expect(await sendTestPush(me.id)).toBe(1);
    expect(send.mock.calls.map(([url]) => url)).toEqual(["https://push.example/mine"]);
  });

  it("keeps the admin-only key error out of what a member sees", async () => {
    const user = await createTestUser();
    await subscribe(user.id, "https://push.example/mine");
    await db.prisma.appSetting.create({ data: { key: "push.vapidPublicKey", value: "half-a-pair" } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(sendTestPush(user.id)).rejects.toThrow("Push isn't available on this server right now.");
    spy.mockRestore();
  });

  it("fails clearly with no devices", async () => {
    await expect(sendPushReminder(reminder)).rejects.toThrow("No devices");
  });
});

describe("actions", () => {
  it("answer a signed-out caller with an error instead of throwing", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect(await savePushSubscription({ endpoint: "https://push.example/x", keys })).toEqual({ error: expect.any(String) });
    expect(await removePushSubscription({ endpoint: "https://push.example/x" })).toEqual({ error: expect.any(String) });
    expect(await sendPushTest()).toEqual({ error: expect.any(String) });
    expect(await refreshPushSubscription({ endpoint: "https://push.example/x", keys })).toEqual({ registered: false });
  });

  it("let a read-only member turn push on for their own device", async () => {
    const reader = await createTestUser({ role: "READONLY" });
    signedInAs(reader.id, "READONLY");
    expect(await savePushSubscription({ endpoint: "https://push.example/reader", keys })).toEqual({ success: expect.any(String) });
    expect(await db.prisma.pushSubscription.count({ where: { userId: reader.id } })).toBe(1);
  });

  it("refuse an endpoint on the server's own network", async () => {
    const me = await createTestUser();
    signedInAs(me.id);
    expect(await savePushSubscription({ endpoint: "https://10.1.2.3/x", keys })).toEqual({ error: expect.any(String) });
    expect(await db.prisma.pushSubscription.count()).toBe(0);
  });

  it("move a device to another member only when it's really the same browser (same keys)", async () => {
    const a = await createTestUser();
    const b = await createTestUser();
    await subscribe(a.id, "https://push.example/shared");
    signedInAs(b.id);

    const otherKeys = { p256dh: createECDH("prime256v1").generateKeys().toString("base64url"), auth: randomBytes(16).toString("base64url") };
    expect(await savePushSubscription({ endpoint: "https://push.example/shared", keys: otherKeys })).toEqual({ error: expect.any(String) });
    expect((await db.prisma.pushSubscription.findFirstOrThrow()).userId).toBe(a.id);

    expect(await savePushSubscription({ endpoint: "https://push.example/shared", keys })).toEqual({ success: expect.any(String) });
    expect((await db.prisma.pushSubscription.findFirstOrThrow()).userId).toBe(b.id);
  });

  it("drop the subscription this browser replaced, but only the caller's", async () => {
    const me = await createTestUser();
    const other = await createTestUser();
    await subscribe(me.id, "https://push.example/old");
    await subscribe(other.id, "https://push.example/theirs");
    signedInAs(me.id);

    await savePushSubscription({ endpoint: "https://push.example/new", keys, previousEndpoint: "https://push.example/old" });
    await savePushSubscription({ endpoint: "https://push.example/new2", keys, previousEndpoint: "https://push.example/theirs" });
    const left = (await db.prisma.pushSubscription.findMany()).map((r) => r.endpoint).sort();
    expect(left).toEqual(["https://push.example/new", "https://push.example/new2", "https://push.example/theirs"]);
  });

  it("refresh only the caller's existing row, never re-adding or taking one over", async () => {
    const me = await createTestUser();
    const other = await createTestUser();
    await subscribe(other.id, "https://push.example/theirs");
    await subscribe(me.id, "https://push.example/mine");
    signedInAs(me.id);

    expect(await refreshPushSubscription({ endpoint: "https://push.example/theirs", keys })).toEqual({ registered: false });
    expect(await refreshPushSubscription({ endpoint: "https://push.example/gone", keys })).toEqual({ registered: false });
    expect(await refreshPushSubscription({ endpoint: "https://push.example/mine", keys, deviceLabel: "Chrome on macOS" })).toEqual({ registered: true });

    const rows = await db.prisma.pushSubscription.findMany({ orderBy: { endpoint: "asc" } });
    expect(rows.map((r) => [r.endpoint, r.userId, r.deviceLabel])).toEqual([
      ["https://push.example/mine", me.id, "Chrome on macOS"],
      ["https://push.example/theirs", other.id, null],
    ]);
  });

  it("remove only the caller's own row", async () => {
    const me = await createTestUser();
    const other = await createTestUser();
    await subscribe(other.id, "https://push.example/theirs");
    signedInAs(me.id);
    await removePushSubscription({ endpoint: "https://push.example/theirs" });
    expect(await db.prisma.pushSubscription.count()).toBe(1);
  });
});

describe("the scheduler and health", () => {
  async function dueContract(actorId: string) {
    const end = new Date();
    end.setUTCHours(0, 0, 0, 0);
    end.setUTCDate(end.getUTCDate() + 10);
    const start = new Date(end);
    start.setUTCFullYear(start.getUTCFullYear() - 1);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    return createContractCommand(
      contractSchema.parse({
        title: "Home insurance",
        category: "HOME_INSURANCE",
        provider: "Acme",
        renewalType: "MANUAL_RENEWAL",
        startDate: iso(start),
        endDate: iso(end),
        reminderDaysBefore: "14",
      }),
      actorId,
    );
  }

  it("logs PUSH as SENT when any device got it, and FAILED when none did", async () => {
    const user = await createTestUser();
    await db.prisma.appSetting.create({ data: { key: "household.timezone", value: "UTC" } });
    const contract = await dueContract(user.id);
    await subscribe(user.id, "https://push.example/ok");
    await subscribe(user.id, "https://push.example/down");
    send.mockImplementation(async (url) => (url === "https://push.example/ok" ? status(201) : status(500)));

    await runExpirationCheck();
    const logs = await db.prisma.notificationLog.findMany({ where: { ownerId: contract.id, channel: "PUSH" } });
    expect(logs.map((l) => l.status)).toEqual(["SENT"]);

    const health = await getHouseholdReminderHealth();
    expect(health.channels.push).toBe(true);
    expect(health.pushDevices).toEqual({ total: 2, failing: 1 });

    await db.prisma.notificationLog.deleteMany();
    send.mockResolvedValue(status(500));
    await runExpirationCheck();
    const failed = await db.prisma.notificationLog.findMany({ where: { ownerId: contract.id, channel: "PUSH" } });
    expect(failed.map((l) => l.status)).toEqual(["FAILED"]);
  });

  it("lists PUSH as a channel once a device has push on", () => {
    expect(channelList({ email: false, ntfy: false, webhook: false, push: true })).toEqual(["PUSH"]);
  });
});

describe("notificationTarget", () => {
  const origin = "https://hearth.example";
  it("opens a path on the app's own origin", () => {
    expect(notificationTarget("/contracts/c1", origin)).toBe("https://hearth.example/contracts/c1");
  });

  it("opens the dashboard for anything else", () => {
    for (const url of ["https://evil.example/x", "//evil.example/x", "javascript:alert(1)", "http://[", 42, null, ""]) {
      expect(notificationTarget(url, origin)).toBe("https://hearth.example/dashboard");
    }
  });
});
