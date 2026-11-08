import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeviceReminder } from "@/lib/notifications/deviceReminders";

// #375 part 3b — scheduling on the phone, with the native plugin mocked:
// a failed schedule keeps what was there, and a sign-out while a sync is
// out wins over its late answer.

const plugin = {
  createChannel: vi.fn(async () => {}),
  schedule: vi.fn<(arg: unknown) => Promise<void>>(async () => {}),
  cancel: vi.fn<(arg: unknown) => Promise<void>>(async () => {}),
};

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true, isPluginAvailable: () => true },
  registerPlugin: () => plugin,
}));

const native = await import("@/lib/nativeReminders");

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});

function reminder(key: string, daysAhead: number): DeviceReminder {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { key, day, title: key, body: "b", url: "/contracts/c1" };
}

const id = (key: string) => native.notificationId(`server:${key}`);
const scheduledIds = (call: number) =>
  (plugin.schedule.mock.calls[call][0] as { notifications: { id: number }[] }).notifications.map((n) => n.id);
const cancelledIds = () =>
  plugin.cancel.mock.calls.flatMap(([arg]) => (arg as { notifications: { id: number }[] }).notifications.map((n) => n.id));

beforeEach(async () => {
  store.clear();
  vi.clearAllMocks();
});

describe("scheduleDeviceReminders", () => {
  it("cancels only the Reminders no longer wanted, and schedules the rest over the old", async () => {
    await native.scheduleDeviceReminders("u1", [reminder("a", 2), reminder("b", 3)], native.deviceRemindersGeneration());
    vi.clearAllMocks();

    const count = await native.scheduleDeviceReminders("u1", [reminder("b", 3), reminder("c", 4)], native.deviceRemindersGeneration());
    expect(count).toBe(2);
    expect(cancelledIds()).toEqual([id("a")]);
    expect(scheduledIds(0)).toEqual([id("b"), id("c")]);
    expect(JSON.parse(store.get("hearth.deviceReminders.ids")!)).toEqual([id("b"), id("c")]);
    expect(native.deviceRemindersUser()).toBe("u1");
  });

  it("keeps what was scheduled when the native schedule fails, and can still cancel it all", async () => {
    await native.scheduleDeviceReminders("u1", [reminder("a", 2), reminder("b", 3)], native.deviceRemindersGeneration());
    vi.clearAllMocks();
    plugin.schedule.mockRejectedValueOnce(new Error("permission revoked"));

    await expect(
      native.scheduleDeviceReminders("u1", [reminder("a", 2), reminder("b", 3), reminder("c", 4)], native.deviceRemindersGeneration()),
    ).rejects.toThrow("permission revoked");
    // a and b are still wanted, so they were never cancelled.
    expect(plugin.cancel).not.toHaveBeenCalled();

    await native.cancelDeviceReminders();
    expect(cancelledIds().sort()).toEqual([id("a"), id("b"), id("c")].sort());
  });

  it("doesn't schedule a sync that a sign-out overtook", async () => {
    const startedAt = native.deviceRemindersGeneration();
    await native.cancelDeviceReminders(); // signed out while the fetch was out
    await expect(native.scheduleDeviceReminders("u1", [reminder("a", 2)], startedAt)).rejects.toBeInstanceOf(
      native.DeviceRemindersSuperseded,
    );
    expect(plugin.schedule).not.toHaveBeenCalled();
    expect(native.deviceRemindersUser()).toBeNull();
  });

  it("takes back a schedule that a sign-out interrupted", async () => {
    let release!: () => void;
    plugin.schedule.mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)));
    const pending = native.scheduleDeviceReminders("u1", [reminder("a", 2)], native.deviceRemindersGeneration());
    await vi.waitFor(() => expect(plugin.schedule).toHaveBeenCalled());

    await native.cancelDeviceReminders();
    release();
    await expect(pending).rejects.toBeInstanceOf(native.DeviceRemindersSuperseded);
    expect(cancelledIds()).toContain(id("a"));
    expect(store.has("hearth.deviceReminders.ids")).toBe(false);
    expect(native.deviceRemindersUser()).toBeNull();
  });
});

describe("notificationsFor", () => {
  it("keeps the soonest 60 after dropping times gone by", () => {
    const now = new Date(2026, 11, 17, 10, 0, 0);
    const today = { key: "today", day: "2026-12-17", title: "t", body: "b", url: "/" };
    const ahead = Array.from({ length: 70 }, (_, i) => {
      const d = new Date(2026, 11, 18 + i);
      const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      return { key: `k${i}`, day, title: "t", body: "b", url: "/" };
    });
    const out = native.notificationsFor([today, ...ahead], now);
    expect(out).toHaveLength(native.DEVICE_REMINDER_LIMIT);
    expect(out[0].id).toBe(id("k0"));
  });
});
