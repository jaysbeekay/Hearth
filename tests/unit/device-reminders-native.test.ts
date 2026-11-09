import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeviceReminder } from "@/lib/notifications/deviceReminders";

// #375 part 3b — scheduling on the phone, with the native plugin mocked:
// a failed schedule keeps what was there, and a sign-out while a sync is
// out wins over its late answer.

const plugin = {
  createChannel: vi.fn(async () => {}),
  schedule: vi.fn<(arg: unknown) => Promise<void>>(async () => {}),
  cancel: vi.fn<(arg: unknown) => Promise<void>>(async () => {}),
  getPending: vi.fn<() => Promise<{ notifications: { id: number; extra?: unknown }[] }>>(async () => ({ notifications: [] })),
};

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true, isPluginAvailable: () => true },
  registerPlugin: () => plugin,
}));

const fetchReminders = vi.fn<() => Promise<{ reminders: DeviceReminder[] } | { error: string }>>();
vi.mock("@/lib/actions/deviceReminders", () => ({ getDeviceReminders: () => fetchReminders() }));
vi.mock("@/components/PushDeviceToggle", () => ({ PushDeviceToggle: () => null }));

const native = await import("@/lib/nativeReminders");
const { syncDeviceReminders } = await import("@/components/DeviceReminderToggle");

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
/** The plugin's schedule and cancel calls, in order, as "schedule:<id>" / "cancel:<id>". */
const nativeLog: string[] = [];
const ofIds = (arg: unknown) => (arg as { notifications: { id: number }[] }).notifications.map((n) => n.id);
function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
}
const cancelledIds = () =>
  plugin.cancel.mock.calls.flatMap(([arg]) => (arg as { notifications: { id: number }[] }).notifications.map((n) => n.id));

beforeEach(async () => {
  store.clear();
  nativeLog.length = 0;
  vi.clearAllMocks();
  plugin.schedule.mockImplementation(async (arg) => void nativeLog.push(...ofIds(arg).map((i) => `schedule:${i}`)));
  plugin.cancel.mockImplementation(async (arg) => void nativeLog.push(...ofIds(arg).map((i) => `cancel:${i}`)));
});

describe("scheduleDeviceReminders", () => {
  it("cancels only the Reminders no longer wanted, and schedules the rest over the old", async () => {
    await native.scheduleDeviceReminders("u1", [reminder("a", 2), reminder("b", 3)], native.startDeviceReminderSync());
    vi.clearAllMocks();

    const count = await native.scheduleDeviceReminders("u1", [reminder("b", 3), reminder("c", 4)], native.startDeviceReminderSync());
    expect(count).toBe(2);
    expect(cancelledIds()).toEqual([id("a")]);
    expect(scheduledIds(0)).toEqual([id("b"), id("c")]);
    expect(JSON.parse(store.get("hearth.deviceReminders.ids")!)).toEqual([id("b"), id("c")]);
    expect(native.deviceRemindersUser()).toBe("u1");
  });

  it("keeps what was scheduled when the native schedule fails, and can still cancel it all", async () => {
    await native.scheduleDeviceReminders("u1", [reminder("a", 2), reminder("b", 3)], native.startDeviceReminderSync());
    vi.clearAllMocks();
    plugin.schedule.mockRejectedValueOnce(new Error("permission revoked"));

    await expect(
      native.scheduleDeviceReminders("u1", [reminder("a", 2), reminder("b", 3), reminder("c", 4)], native.startDeviceReminderSync()),
    ).rejects.toThrow("permission revoked");
    // a and b are still wanted, so they were never cancelled.
    expect(plugin.cancel).not.toHaveBeenCalled();

    await native.cancelDeviceReminders();
    expect(cancelledIds().sort()).toEqual([id("a"), id("b"), id("c")].sort());
  });

  it("doesn't schedule a sync that a sign-out overtook", async () => {
    store.set("hearth.deviceReminders.user", "u0");
    const startedAt = native.startDeviceReminderSync();
    await native.cancelDeviceReminders(); // signed out while the fetch was out
    await expect(native.scheduleDeviceReminders("u1", [reminder("a", 2)], startedAt)).rejects.toBeInstanceOf(
      native.DeviceRemindersSuperseded,
    );
    expect(plugin.schedule).not.toHaveBeenCalled();
    expect(native.deviceRemindersUser()).toBe("u0");
  });

  it("cancels a schedule that a sign-out interrupted, once it's done", async () => {
    const gate = deferred();
    plugin.schedule.mockImplementationOnce(async (arg) => {
      await gate.promise;
      nativeLog.push(...ofIds(arg).map((i) => `schedule:${i}`));
    });
    const pending = native.scheduleDeviceReminders("u1", [reminder("a", 2)], native.startDeviceReminderSync());
    await vi.waitFor(() => expect(plugin.schedule).toHaveBeenCalled());

    const signOut = native.cancelDeviceReminders();
    gate.release();
    await expect(pending).rejects.toBeInstanceOf(native.DeviceRemindersSuperseded);
    await signOut;
    expect(nativeLog).toEqual([`schedule:${id("a")}`, `cancel:${id("a")}`]);
    expect(store.has("hearth.deviceReminders.ids")).toBe(false);
    expect(native.deviceRemindersUser()).toBeNull();
  });

  it("keeps a newer sync's Reminders when an older one's schedule was interrupted", async () => {
    const gate = deferred();
    plugin.schedule.mockImplementationOnce(async (arg) => {
      await gate.promise;
      nativeLog.push(...ofIds(arg).map((i) => `schedule:${i}`));
    });
    const first = native.scheduleDeviceReminders("u1", [reminder("a", 2)], native.startDeviceReminderSync());
    await vi.waitFor(() => expect(plugin.schedule).toHaveBeenCalled());

    // Turn off, then Notify this phone again, while the first is still scheduling.
    const off = native.turnOffDeviceReminders();
    const again = native.scheduleDeviceReminders("u1", [reminder("a", 2)], native.startDeviceReminderSync());
    gate.release();
    await expect(first).rejects.toBeInstanceOf(native.DeviceRemindersSuperseded);
    await off;
    expect(await again).toBe(1);

    expect(nativeLog.at(-1)).toBe(`schedule:${id("a")}`);
    expect(JSON.parse(store.get("hearth.deviceReminders.ids")!)).toEqual([id("a")]);
  });

  it("runs overlapping syncs one at a time, and keeps the one started last", async () => {
    const gate = deferred();
    plugin.schedule.mockImplementationOnce(async (arg) => {
      await gate.promise;
      nativeLog.push(...ofIds(arg).map((i) => `schedule:${i}`));
    });
    const older = native.startDeviceReminderSync();
    const newer = native.startDeviceReminderSync();
    // The newer fetch came back first.
    const second = native.scheduleDeviceReminders("u1", [reminder("b", 3)], newer);
    await vi.waitFor(() => expect(plugin.schedule).toHaveBeenCalledTimes(1));
    const first = native.scheduleDeviceReminders("u1", [reminder("a", 2)], older);
    await Promise.resolve();
    expect(plugin.schedule).toHaveBeenCalledTimes(1); // waits its turn

    gate.release();
    expect(await second).toBe(1);
    await expect(first).rejects.toBeInstanceOf(native.DeviceRemindersSuperseded);
    expect(nativeLog).toEqual([`schedule:${id("b")}`]);

    await native.cancelDeviceReminders();
    expect(cancelledIds()).toEqual([id("b")]);
  });

  it("tracks every id when two syncs schedule back to back", async () => {
    const one = native.scheduleDeviceReminders("u1", [reminder("a", 2)], native.startDeviceReminderSync());
    const two = native.scheduleDeviceReminders("u1", [reminder("b", 3)], native.startDeviceReminderSync());
    await Promise.all([one, two]);
    await native.cancelDeviceReminders();
    // a was replaced by two's sync, b by the sign-out: nothing of theirs is left.
    expect(nativeLog).toEqual([`schedule:${id("a")}`, `cancel:${id("a")}`, `schedule:${id("b")}`, `cancel:${id("b")}`]);
  });

  it("keeps the ids for the next cancel when a cancel fails", async () => {
    await native.scheduleDeviceReminders("u1", [reminder("a", 2)], native.startDeviceReminderSync());
    plugin.cancel.mockRejectedValueOnce(new Error("plugin gone"));
    await expect(native.turnOffDeviceReminders()).rejects.toThrow("plugin gone");
    expect(native.deviceRemindersUser()).toBe("u1"); // still scheduled, so still on
    await native.cancelDeviceReminders();
    expect(nativeLog.at(-1)).toBe(`cancel:${id("a")}`);
  });
});

describe("cancelDeviceReminders without storage", () => {
  it("still cancels this page's pending Reminders by their tag, and only those", async () => {
    plugin.getPending.mockResolvedValueOnce({
      notifications: [
        { id: 11, extra: { source: "hearth-server", url: "/contracts/c1" } },
        { id: 12, extra: { source: "standalone" } },
        { id: 13 },
      ],
    });
    // Nothing stored: the ids were never written, or storage was cleared.
    await native.cancelDeviceReminders();
    expect(cancelledIds()).toEqual([11]);
  });

  it("falls back to the stored ids when the plugin can't list pending ones", async () => {
    await native.scheduleDeviceReminders("u1", [reminder("a", 2)], native.startDeviceReminderSync());
    vi.clearAllMocks();
    plugin.getPending.mockRejectedValueOnce(new Error("not implemented"));
    await native.cancelDeviceReminders();
    expect(cancelledIds()).toEqual([id("a")]);
  });
});

describe("scheduleDeviceReminders without storage", () => {
  afterEach(() => {
    store.set = Map.prototype.set;
  });

  it("cancels a tagged Reminder no longer wanted even though its id was never stored", async () => {
    plugin.getPending.mockResolvedValueOnce({
      notifications: [
        { id: id("old"), extra: { source: "hearth-server" } },
        { id: 12, extra: { source: "standalone" } },
      ],
    });
    await native.scheduleDeviceReminders("u1", [reminder("a", 2)], native.startDeviceReminderSync());
    expect(nativeLog).toEqual([`cancel:${id("old")}`, `schedule:${id("a")}`]);
  });

  it("refuses, and cancels what it scheduled, when storage can't remember they're on", async () => {
    store.set = () => {
      throw new Error("QuotaExceededError");
    };
    await expect(
      native.scheduleDeviceReminders("u1", [reminder("a", 2)], native.startDeviceReminderSync()),
    ).rejects.toBeInstanceOf(native.DeviceRemindersStorageUnavailable);
    expect(nativeLog).toEqual([`schedule:${id("a")}`, `cancel:${id("a")}`]);
    expect(native.deviceRemindersUser()).toBeNull();
  });

  it("shows the storage error from Notify this phone", async () => {
    store.set = () => {
      throw new Error("QuotaExceededError");
    };
    fetchReminders.mockResolvedValueOnce({ reminders: [reminder("a", 2)] });
    await expect(syncDeviceReminders("u1")).rejects.toThrow("app storage isn't available");
  });
});

describe("claimDeviceReminders", () => {
  it("keeps the same member's Reminders, and cancels nothing", async () => {
    store.set("hearth.deviceReminders.user", "u1");
    expect(native.claimDeviceReminders("u1")).toBe(true);
    await native.cancelDeviceReminders().catch(() => {}); // flush the queue
    expect(plugin.getPending).toHaveBeenCalledTimes(1); // only the flush's
  });

  it("turns off another member's", async () => {
    await native.scheduleDeviceReminders("u0", [reminder("a", 2)], native.startDeviceReminderSync());
    expect(native.claimDeviceReminders("u1")).toBe(false);
    await vi.waitFor(() => expect(cancelledIds()).toEqual([id("a")]));
    expect(native.deviceRemindersUser()).toBeNull();
  });

  it("cancels tagged Reminders that nothing remembers, on another member's sign-in", async () => {
    // Scheduled for u0, then storage was cleared: no owner, no ids.
    plugin.getPending.mockResolvedValueOnce({
      notifications: [
        { id: 11, extra: { source: "hearth-server" } },
        { id: 12, extra: { source: "standalone" } },
      ],
    });
    expect(native.claimDeviceReminders("u1")).toBe(false);
    await vi.waitFor(() => expect(cancelledIds()).toEqual([11]));
  });
});

describe("syncDeviceReminders", () => {
  it("loses to a sign-out that happens while its fetch is out", async () => {
    const gate = deferred();
    fetchReminders.mockImplementationOnce(async () => {
      await gate.promise;
      return { reminders: [reminder("a", 2)] };
    });
    const pending = syncDeviceReminders("u1");
    await native.cancelDeviceReminders();
    gate.release();
    await expect(pending).rejects.toBeInstanceOf(native.DeviceRemindersSuperseded);
    expect(plugin.schedule).not.toHaveBeenCalled();
  });

  it("returns the server's error without touching the phone", async () => {
    fetchReminders.mockResolvedValueOnce({ error: "You're signed out." });
    expect(await syncDeviceReminders("u1")).toEqual({ error: "You're signed out." });
    expect(plugin.schedule).not.toHaveBeenCalled();
  });
});

describe("keepDeviceRemindersCurrent", () => {
  const listeners = new Set<() => void>();
  const doc = {
    visibilityState: "visible",
    addEventListener: (_: string, fn: () => void) => void listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => void listeners.delete(fn),
  };
  vi.stubGlobal("document", doc);
  const MIN = 60 * 1000;

  beforeEach(() => {
    vi.useFakeTimers();
    listeners.clear();
    store.set("hearth.deviceReminders.user", "u1");
  });
  afterEach(() => vi.useRealTimers());

  it("retries a failed sync after a minute, then two, and goes back to a minute after a success", async () => {
    const sync = vi
      .fn<() => Promise<{ error?: string } | null>>()
      .mockResolvedValueOnce({ error: "offline" })
      .mockRejectedValueOnce(new Error("permission revoked"))
      .mockResolvedValueOnce({ success: "ok" } as { error?: string })
      .mockResolvedValue({ error: "offline" });
    const stop = native.keepDeviceRemindersCurrent("u1", sync);
    await vi.advanceTimersByTimeAsync(0);
    expect(sync).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(MIN - 1);
    expect(sync).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sync).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(2 * MIN - 1);
    expect(sync).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(sync).toHaveBeenCalledTimes(3); // succeeds

    // A failure an hour later retries after a minute again.
    await vi.advanceTimersByTimeAsync(native.RESYNC_MS);
    listeners.forEach((fn) => fn());
    expect(sync).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(MIN);
    expect(sync).toHaveBeenCalledTimes(5);
    stop();
  });

  it("keeps Reminders turned on mid-session current, without waiting for a restart", async () => {
    // App opened with nothing on here: the claim fails, but the keeper is set
    // up anyway (DeviceReminderSync) and does nothing until they're on.
    store.delete("hearth.deviceReminders.user");
    expect(native.claimDeviceReminders("u1")).toBe(false);
    const sync = vi.fn(async () => null);
    const stop = native.keepDeviceRemindersCurrent("u1", sync);
    await vi.advanceTimersByTimeAsync(0);
    listeners.forEach((fn) => fn());
    expect(sync).not.toHaveBeenCalled();

    // "Notify this phone" schedules once and marks them on for u1...
    await native.scheduleDeviceReminders("u1", [reminder("a", 2)], native.startDeviceReminderSync());
    // ...and the next return to the app syncs them.
    listeners.forEach((fn) => fn());
    expect(sync).toHaveBeenCalledTimes(1);
    stop();
  });

  it("syncs again when the app comes back into view, at most hourly", async () => {
    const sync = vi.fn(async () => null);
    const stop = native.keepDeviceRemindersCurrent("u1", sync);
    await vi.advanceTimersByTimeAsync(0);
    listeners.forEach((fn) => fn());
    expect(sync).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(native.RESYNC_MS);
    listeners.forEach((fn) => fn());
    expect(sync).toHaveBeenCalledTimes(2);
    stop();
    expect(listeners.size).toBe(0);
  });

  it("doesn't retry a sync that a cancel or newer sync overtook, but syncs on the next view", async () => {
    const sync = vi.fn(async () => {
      throw new native.DeviceRemindersSuperseded();
    });
    const stop = native.keepDeviceRemindersCurrent("u1", sync);
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(sync).toHaveBeenCalledTimes(1);
    listeners.forEach((fn) => fn());
    expect(sync).toHaveBeenCalledTimes(2);
    stop();
  });

  it("doesn't sync on every return to the app while backing off", async () => {
    const sync = vi.fn(async () => ({ error: "offline" }));
    const stop = native.keepDeviceRemindersCurrent("u1", sync);
    await vi.advanceTimersByTimeAsync(MIN - 1);
    listeners.forEach((fn) => fn());
    listeners.forEach((fn) => fn());
    expect(sync).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sync).toHaveBeenCalledTimes(2);
    stop();
  });

  it("can't switch them back on with a retry that fires while Turn off waits its turn", async () => {
    fetchReminders.mockResolvedValueOnce({ error: "offline" }).mockResolvedValue({ reminders: [reminder("a", 2)] });
    const stop = native.keepDeviceRemindersCurrent("u1", () => syncDeviceReminders("u1"));
    await vi.advanceTimersByTimeAsync(0); // failed: retry in a minute

    // An earlier schedule is still going, so Turn off's cancel waits behind it.
    const gate = deferred();
    plugin.schedule.mockImplementationOnce(async () => gate.promise);
    const earlier = native.scheduleDeviceReminders("u1", [reminder("b", 3)], native.startDeviceReminderSync());
    await vi.waitFor(() => expect(plugin.schedule).toHaveBeenCalled());
    const off = native.turnOffDeviceReminders();
    await vi.advanceTimersByTimeAsync(MIN); // the retry fires now
    gate.release();
    await expect(earlier).rejects.toBeInstanceOf(native.DeviceRemindersSuperseded);
    await off;
    await vi.advanceTimersByTimeAsync(native.RESYNC_MS);

    expect(fetchReminders).toHaveBeenCalledTimes(1);
    expect(plugin.schedule).toHaveBeenCalledTimes(1);
    expect(native.deviceRemindersUser()).toBeNull();
    stop();
  });

  it("stops retrying once stopped, or once turned off here", async () => {
    const sync = vi.fn(async () => ({ error: "offline" }));
    const stop = native.keepDeviceRemindersCurrent("u1", sync);
    await vi.advanceTimersByTimeAsync(0);
    stop();
    await vi.advanceTimersByTimeAsync(native.RESYNC_MS);
    expect(sync).toHaveBeenCalledTimes(1);

    const stop2 = native.keepDeviceRemindersCurrent("u1", sync);
    await vi.advanceTimersByTimeAsync(0);
    store.delete("hearth.deviceReminders.user");
    await vi.advanceTimersByTimeAsync(native.RESYNC_MS);
    expect(sync).toHaveBeenCalledTimes(2);
    stop2();
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
    // In any order: the soonest are kept, not the first sent.
    const out = native.notificationsFor([...ahead].reverse().concat(today), now);
    expect(out).toHaveLength(native.DEVICE_REMINDER_LIMIT);
    expect(out[0].id).toBe(id("k0"));
  });
});
