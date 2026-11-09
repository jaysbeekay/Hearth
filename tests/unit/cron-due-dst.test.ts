// node-cron reads the process timezone once, when it's first used, so this
// file sets TZ before anything imports it (each test file runs on its own).
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.TZ = "America/New_York";
});

import { cronOwed, resetCronOwedScans } from "@/lib/jobs/cronDue";

describe("cronOwed across daylight saving (America/New_York)", () => {
  beforeEach(() => resetCronOwedScans());

  it("runs a time the clocks sprang over, just after the jump", async () => {
    // 8 Mar 2026: 02:00 EST jumps to 03:00 EDT, so 02:30 never happens.
    const lastRun = new Date("2026-03-07T07:30:05Z"); // 02:30 EST on 7 Mar
    expect(await cronOwed("BACKUP_RUN", "30 2 * * *", lastRun, new Date("2026-03-08T06:59:00Z"))).toBe(false);
    expect(await cronOwed("BACKUP_RUN", "30 2 * * *", lastRun, new Date("2026-03-08T07:00:00Z"))).toBe(true);
  });

  it("runs once, not twice, in an hour the clocks fell back over", async () => {
    // 1 Nov 2026: 01:00–01:59 happens in EDT and again in EST.
    const ranAt = new Date("2026-11-01T05:30:10Z"); // 01:30 EDT
    expect(await cronOwed("BACKUP_RUN", "30 1 * * *", ranAt, new Date("2026-11-01T07:00:00Z"))).toBe(false);
    expect(await cronOwed("BACKUP_RUN", "30 1 * * *", ranAt, new Date("2026-11-02T06:30:00Z"))).toBe(true);
  });

  it("doesn't run again in the repeated hour after a catch-up earlier in it", async () => {
    // Down across 01:30 EDT, back at 01:10 EST: the catch-up covers 01:30 EST too.
    const caughtUp = new Date("2026-11-01T06:10:02Z"); // 01:10 EST
    expect(await cronOwed("BACKUP_RUN", "30 1 * * *", caughtUp, new Date("2026-11-01T06:30:00Z"))).toBe(false);
    expect(await cronOwed("BACKUP_RUN", "30 1 * * *", caughtUp, new Date("2026-11-02T06:30:00Z"))).toBe(true);
  });
});
