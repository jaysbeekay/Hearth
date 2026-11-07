import { describe, expect, it, vi } from "vitest";
import { setupTestDb, createTestUser } from "../helpers/testDb";
import { getHouseholdToday } from "@/lib/appSettings";
import { addDays } from "@/lib/duePolicy";
import { deviceReminderSchedule, upcomingReminderDays } from "@/lib/notifications/deviceReminders";
import { notificationId, notificationsFor, safeReminderPath } from "@/lib/nativeReminders";
import type { ReminderPlan } from "@/lib/notifications/reminderSchedule";
import type { DueEntry } from "@/lib/duePolicy";

// #375 part 3b — the phone app schedules the household's Reminders on the
// device, since its WebView has no Web Push.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const db = setupTestDb();

function plan(date: string, thresholds: number[]): ReminderPlan {
  const entry = { field: "endDate", date } as DueEntry;
  return { held: false, snoozedUntil: null, thresholds, entries: [{ entry, schedule: {} as never }] };
}

describe("upcomingReminderDays", () => {
  it("gives each threshold's day from today to the horizon, with no catch-up", () => {
    const days = upcomingReminderDays(plan("2026-12-31", [30, 14, 7, 1]), "2026-12-17", 10);
    // 30 days before (Dec 1) has passed; 1 day before (Dec 30) is past the horizon (Dec 27).
    expect(days.map((d) => [d.thresholdDays, d.day])).toEqual([
      [14, "2026-12-17"],
      [7, "2026-12-24"],
    ]);
  });

  it("gives nothing for a held or Snoozed record", () => {
    expect(upcomingReminderDays({ ...plan("2026-12-31", [7]), entries: [] }, "2026-12-01", 120)).toEqual([]);
  });
});

describe("deviceReminderSchedule", () => {
  it("lists the household's Reminders ahead, soonest first, worded like push", async () => {
    const owner = await createTestUser();
    const viewer = await createTestUser();
    const today = await getHouseholdToday();
    const endDate = new Date(`${addDays(today, 20)}T00:00:00.000Z`);
    const contract = await db.prisma.contract.create({
      data: { title: "Broadband", provider: "Fibre Co", category: "OTHER", endDate, createdById: owner.id },
    });

    const reminders = await deviceReminderSchedule(viewer.id);
    // Default thresholds 30,14,7,1: 30 has passed, so 14, 7 and 1 days before.
    expect(reminders.map((r) => r.day)).toEqual([addDays(today, 6), addDays(today, 13), addDays(today, 19)]);
    expect(reminders[0]).toMatchObject({
      key: `CONTRACT:${contract.id}:endDate:${addDays(today, 20)}:14`,
      url: `/contracts/${contract.id}`,
    });
    // Each counts from the day it shows, not from today.
    expect(reminders[0].title).toMatch(/^Broadband: .*in 14 days$/);
    expect(reminders[1].title).toMatch(/in 7 days$/);
    expect(reminders[2].title).toMatch(/tomorrow|in 1 day$/);
    expect(reminders[0].body).toContain("Fibre Co");
  });
});

describe("phone app notifications", () => {
  it("schedules each Reminder at 9am local on its day, dropping times gone by", () => {
    const now = new Date(2026, 11, 17, 10, 0, 0);
    const base = { title: "t", body: "b", url: "/contracts/c1" };
    const out = notificationsFor(
      [
        { ...base, key: "a", day: "2026-12-17" },
        { ...base, key: "b", day: "2026-12-18" },
      ],
      now,
    );
    expect(out).toHaveLength(1);
    expect(out[0].schedule?.at).toEqual(new Date(2026, 11, 18, 9, 0, 0));
    expect(out[0].extra).toEqual({ source: "hearth-server", url: "/contracts/c1" });
    expect(out[0].id).toBe(notificationId("server:b"));
  });

  it("makes stable, positive 31-bit ids", () => {
    const id = notificationId("server:CONTRACT:c1:endDate:2026-12-31:7");
    expect(id).toBe(notificationId("server:CONTRACT:c1:endDate:2026-12-31:7"));
    expect(id).not.toBe(notificationId("server:CONTRACT:c1:endDate:2026-12-31:14"));
    expect(id).toBeGreaterThan(0);
    expect(id).toBeLessThanOrEqual(0x7fffffff);
  });

  it("opens only paths on this server", () => {
    expect(safeReminderPath("/vehicles/v1")).toBe("/vehicles/v1");
    for (const bad of ["https://evil.example/", "//evil.example", "/\\evil.example", "javascript:alert(1)", 42, undefined]) {
      expect(safeReminderPath(bad)).toBeNull();
    }
  });
});
