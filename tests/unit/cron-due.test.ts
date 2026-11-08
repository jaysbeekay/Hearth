import { describe, expect, it } from "vitest";
import { cronDue, cronOwed, nextCronMinute } from "@/lib/jobs/cronDue";

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

describe("nextCronMinute", () => {
  it("finds the first matching minute after the given one", () => {
    expect(nextCronMinute("0 8 * * *", new Date(2026, 10, 6, 7, 30, 12))).toEqual(new Date(2026, 10, 6, 8, 0, 0));
    // Not the minute the last run was queued in.
    expect(nextCronMinute("0 8 * * *", new Date(2026, 10, 6, 8, 0, 0, 50))).toEqual(new Date(2026, 10, 7, 8, 0, 0));
  });

  it("is null for an invalid pattern or one with no time in the window", () => {
    expect(nextCronMinute("not a cron pattern", new Date())).toBeNull();
    expect(nextCronMinute("0 8 1 1 *", new Date(2026, 10, 6))).toBeNull();
  });
});

describe("cronOwed — a run the server slept through still happens", () => {
  const lastRun = new Date(2026, 10, 5, 8, 0, 0, 40);

  it("isn't owed before the next scheduled time", () => {
    expect(cronOwed("0 8 * * *", lastRun, new Date(2026, 10, 6, 7, 59, 0))).toBe(false);
  });

  it("is owed in the scheduled minute, even a few seconds late", () => {
    expect(cronOwed("0 8 * * *", lastRun, new Date(2026, 10, 6, 8, 0, 3))).toBe(true);
    expect(cronDue("0 8 * * *", new Date(2026, 10, 6, 8, 0, 3))).toBe(false);
  });

  it("is still owed hours or days after a missed time", () => {
    expect(cronOwed("0 8 * * *", lastRun, new Date(2026, 10, 6, 14, 41, 0))).toBe(true);
    expect(cronOwed("0 8 * * *", lastRun, new Date(2026, 10, 8, 9, 0, 0))).toBe(true);
  });

  it("isn't owed again once a caught-up run is on record", () => {
    const caughtUp = new Date(2026, 10, 6, 14, 41, 5);
    expect(cronOwed("0 8 * * *", caughtUp, new Date(2026, 10, 6, 20, 0, 0))).toBe(false);
    expect(cronOwed("0 8 * * *", caughtUp, new Date(2026, 10, 7, 8, 0, 0))).toBe(true);
  });

  it("with no run on record, owes one the schedule wanted in the last day", () => {
    expect(cronOwed("0 8 * * *", null, new Date(2026, 10, 6, 9, 0, 0))).toBe(true);
    expect(cronOwed("0 8 * * 1", null, new Date(2026, 10, 6, 9, 0, 0))).toBe(false); // 6 Nov 2026 is a Friday
  });

  it("falls back to the exact match for a schedule with no time in the next week", () => {
    const monthly = "0 8 1 * *";
    const last = new Date(2026, 9, 1, 8, 0, 0, 10);
    expect(cronOwed(monthly, last, new Date(2026, 10, 1, 8, 0, 0))).toBe(true);
    expect(cronOwed(monthly, last, new Date(2026, 10, 1, 9, 0, 0))).toBe(false);
  });

  it("is never owed for an invalid pattern", () => {
    expect(cronOwed("not a cron pattern", null, new Date())).toBe(false);
  });
});
