import { beforeEach, describe, expect, it } from "vitest";
import cron from "node-cron";
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

describe("cronOwed — schedule edits", () => {
  beforeEach(() => resetCronOwedScans());
  const lastRun = new Date(2026, 10, 6, 20, 0, 5);
  const editedAt = new Date(2026, 10, 7, 10, 0, 30);

  it("starts a schedule edited in Settings from the edit, not from the last run", async () => {
    expect(await cronOwed("BACKUP_RUN", "0 20 * * *", lastRun, new Date(2026, 10, 7, 10, 0, 0))).toBe(false);
    // Changed to 08:00 at 10:00: today's 08:00 was never asked for.
    const after = { lastSchedule: "0 20 * * *", savedAt: editedAt };
    expect(await cronOwed("BACKUP_RUN", "0 8 * * *", lastRun, new Date(2026, 10, 7, 10, 1, 0), after)).toBe(false);
    expect(await cronOwed("BACKUP_RUN", "0 8 * * *", lastRun, new Date(2026, 10, 8, 8, 0, 2), after)).toBe(true);
  });

  it("still starts from the edit after a restart", async () => {
    const after = { lastSchedule: "0 20 * * *", savedAt: editedAt };
    // A fresh process: nothing scanned yet, so only the DB tells it about the edit.
    expect(await cronOwed("BACKUP_RUN", "0 8 * * *", lastRun, new Date(2026, 10, 7, 11, 0, 0), after)).toBe(false);
    resetCronOwedScans();
    // Down across the new 08:00: it's still owed when the server is back.
    expect(await cronOwed("BACKUP_RUN", "0 8 * * *", lastRun, new Date(2026, 10, 8, 9, 30, 0), after)).toBe(true);
  });

  it("doesn't run at once when a job is switched back on after months off", async () => {
    const lastBackup = new Date(2026, 5, 1, 3, 0, 5);
    const reEnabled = new Date(2026, 10, 7, 15, 0, 0);
    expect(await cronOwed("BACKUP_RUN", "0 3 * * *", lastBackup, new Date(2026, 10, 7, 15, 1, 0), { savedAt: reEnabled })).toBe(false);
    expect(await cronOwed("BACKUP_RUN", "0 3 * * *", lastBackup, new Date(2026, 10, 8, 3, 0, 1), { savedAt: reEnabled })).toBe(true);
  });

  it("starts an env schedule changed across a restart from the first check under it", async () => {
    // Last queued under 20:00; the env var now says 08:00 and nothing was saved in Settings.
    const changed = { lastSchedule: "0 20 * * *" };
    expect(await cronOwed("BACKUP_RUN", "0 8 * * *", lastRun, new Date(2026, 10, 7, 10, 0, 0), changed)).toBe(false);
    expect(await cronOwed("BACKUP_RUN", "0 8 * * *", lastRun, new Date(2026, 10, 7, 10, 1, 0), changed)).toBe(false);
    expect(await cronOwed("BACKUP_RUN", "0 8 * * *", lastRun, new Date(2026, 10, 8, 8, 0, 2), changed)).toBe(true);
  });

  it("ignores a save stamped while the clock was ahead", async () => {
    const now = new Date(2026, 10, 7, 9, 0, 0);
    expect(await cronOwed("BACKUP_RUN", "0 8 * * *", lastRun, now, { savedAt: new Date(2026, 11, 1) })).toBe(true);
  });

  it("runs a 6-field env schedule in its minute, whatever its seconds field", async () => {
    expect(await cronOwed("BACKUP_RUN", "30 0 8 * * *", lastRun, new Date(2026, 10, 7, 8, 0, 4))).toBe(true);
    expect(await cronOwed("BACKUP_RUN", "30 0 8 * * *", lastRun, new Date(2026, 10, 7, 7, 59, 0))).toBe(false);
  });
});

describe("cronOwed — clock trouble and memory", () => {
  beforeEach(() => resetCronOwedScans());

  it("doesn't let a run stamped while the clock was ahead hold off later runs", async () => {
    const now = new Date(2026, 10, 8, 8, 0, 5);
    const stampedAhead = new Date(2026, 11, 20, 8, 0, 3);
    expect(await cronOwed("REMINDER_CHECK", "0 8 * * *", stampedAhead, now)).toBe(true);
  });

  it("doesn't grow node-cron's task registry tick after tick", async () => {
    const now = new Date(2026, 10, 8, 9, 0, 0);
    const ranToday = new Date(2026, 10, 8, 8, 0, 5);
    await cronOwed("REMINDER_CHECK", "0 8 * * *", ranToday, now);
    cronDue("0 8 * * *", now);
    const before = cron.getTasks().size;
    for (let i = 1; i <= 200; i += 1) {
      await cronOwed("REMINDER_CHECK", "0 8 * * *", ranToday, new Date(now.getTime() + i * 60_000));
      cronDue("0 8 * * *", now);
      cronDue("not a cron pattern", now);
    }
    expect(cron.getTasks().size).toBe(before);
  });

  it("keeps a bounded number of tasks however many schedules it sees", async () => {
    const before = cron.getTasks().size;
    const now = new Date(2026, 10, 8, 9, 0, 0);
    for (let minute = 0; minute < 60; minute += 1) {
      await cronOwed(`JOB_${minute}`, `${minute} 8 * * *`, new Date(2026, 10, 8, 8, 59, 0), now);
      cronDue(`${minute} 9 * * *`, now);
    }
    // 20 patterns kept, three tasks each at most.
    expect(cron.getTasks().size - before).toBeLessThanOrEqual(60);
  });

  it("scans again when the last run moves back, as it does to retry a failure", async () => {
    const yesterday = new Date(2026, 10, 7, 8, 0, 4);
    const failedToday = new Date(2026, 10, 8, 8, 0, 4);
    expect(await cronOwed("REMINDER_CHECK", "0 8 * * *", failedToday, new Date(2026, 10, 8, 9, 0, 0))).toBe(false);
    // The failure stops counting: yesterday's run is the last one again, so today's 08:00 is owed.
    expect(await cronOwed("REMINDER_CHECK", "0 8 * * *", yesterday, new Date(2026, 10, 8, 9, 1, 0))).toBe(true);
  });
});
