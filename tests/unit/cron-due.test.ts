import { beforeEach, describe, expect, it } from "vitest";
import { cronDue, cronOwed, resetCronOwedScans } from "@/lib/jobs/cronDue";

describe("cronDue (#250)", () => {
  it("matches a pattern against a point in time without needing a running timer", () => {
    expect(cronDue("0 8 * * *", new Date(2026, 7, 27, 8, 0, 0))).toBe(true);
    expect(cronDue("0 8 * * *", new Date(2026, 7, 27, 8, 1, 0))).toBe(false);
    expect(cronDue("0 8 * * *", new Date(2026, 7, 27, 9, 0, 0))).toBe(false);
  });

  it("re-evaluates against whatever pattern is passed in, not a cached one", () => {
    const at = new Date(2026, 7, 27, 3, 0, 0);
    expect(cronDue("0 3 * * *", at)).toBe(true);
    // A different pattern checked against the same instant reflects the
    // *new* value immediately — this is the whole point: no restart needed
    // to pick up a schedule changed in Settings.
    expect(cronDue("0 9 * * *", at)).toBe(false);
  });

  it("returns false for an invalid pattern instead of throwing", () => {
    expect(cronDue("not a cron pattern", new Date())).toBe(false);
  });
});

describe("cronOwed — a run the server slept through still happens", () => {
  beforeEach(() => resetCronOwedScans());
  const owed = (pattern: string, lastRun: Date | null, now: Date) => cronOwed("REMINDER_CHECK", pattern, lastRun, now);
  const lastRun = new Date(2026, 10, 5, 8, 0, 0, 40);

  it("isn't owed before the next scheduled time", async () => {
    expect(await owed("0 8 * * *", lastRun, new Date(2026, 10, 6, 7, 59, 0))).toBe(false);
  });

  it("is owed in the scheduled minute, even a few seconds late", async () => {
    expect(await owed("0 8 * * *", lastRun, new Date(2026, 10, 6, 8, 0, 3))).toBe(true);
    expect(cronDue("0 8 * * *", new Date(2026, 10, 6, 8, 0, 3))).toBe(false);
  });

  it("is still owed hours or days after a missed time", async () => {
    expect(await owed("0 8 * * *", lastRun, new Date(2026, 10, 6, 14, 41, 0))).toBe(true);
    resetCronOwedScans();
    expect(await owed("0 8 * * *", lastRun, new Date(2026, 10, 8, 9, 0, 0))).toBe(true);
  });

  it("isn't owed again once a caught-up run is on record", async () => {
    const caughtUp = new Date(2026, 10, 6, 14, 41, 5);
    expect(await owed("0 8 * * *", caughtUp, new Date(2026, 10, 6, 20, 0, 0))).toBe(false);
    expect(await owed("0 8 * * *", caughtUp, new Date(2026, 10, 7, 8, 0, 0))).toBe(true);
  });

  it("catches a time that falls between two ticks after a sleep", async () => {
    // The tick before the sleep scanned up to 07:30; the next one is at 09:15.
    expect(await owed("0 8 * * *", lastRun, new Date(2026, 10, 6, 7, 30, 0))).toBe(false);
    expect(await owed("0 8 * * *", lastRun, new Date(2026, 10, 6, 9, 15, 0))).toBe(true);
  });

  it("recovers a monthly run missed during a long downtime", async () => {
    const monthly = "0 8 1 * *";
    const lastMonthly = new Date(2026, 9, 1, 8, 0, 0, 10);
    expect(await owed(monthly, lastMonthly, new Date(2026, 9, 20, 12, 0, 0))).toBe(false);
    resetCronOwedScans();
    // Down from 30 Oct to 12 Nov: the 1 Nov run is still owed when it's back.
    expect(await owed(monthly, lastMonthly, new Date(2026, 10, 12, 9, 0, 0))).toBe(true);
  });

  it("recovers a yearly run missed by months", async () => {
    const yearly = "0 8 1 1 *";
    expect(await owed(yearly, new Date(2026, 0, 1, 8, 0, 0, 10), new Date(2026, 11, 31, 23, 0, 0))).toBe(false);
    resetCronOwedScans();
    expect(await owed(yearly, new Date(2026, 0, 1, 8, 0, 0, 10), new Date(2027, 2, 1, 9, 0, 0))).toBe(true);
  });

  it("with no run on record, owes one the schedule wanted in the last day", async () => {
    expect(await owed("0 8 * * *", null, new Date(2026, 10, 6, 9, 0, 0))).toBe(true);
    expect(await owed("0 8 * * 1", null, new Date(2026, 10, 6, 9, 0, 0))).toBe(false); // 6 Nov 2026 is a Friday
  });

  it("is never owed for an invalid pattern", async () => {
    expect(await owed("not a cron pattern", null, new Date())).toBe(false);
  });
});
