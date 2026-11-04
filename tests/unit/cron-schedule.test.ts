import { describe, expect, it } from "vitest";
import {
  describeSchedule,
  parseSchedule,
  cronTimeOfDay,
  parseScheduleTime,
  scheduleToCron,
} from "@/lib/cronSchedule";

// #363 — Settings shows schedules as "Daily at 08:00" / "Weekly on Monday"
// and only falls back to a raw cron string for anything else.
describe("cron schedules in plain language", () => {
  it("reads a daily or weekly cron string, and writes the same string back", () => {
    expect(parseSchedule("0 8 * * *")).toEqual({ kind: "daily", hour: 8, minute: 0 });
    expect(parseSchedule("30 3 * * 1")).toEqual({ kind: "weekly", day: 1, hour: 3, minute: 30 });
    for (const cron of ["0 8 * * *", "30 3 * * 1", "5 23 * * 0"]) {
      expect(scheduleToCron(parseSchedule(cron))).toBe(cron);
    }
  });

  it("treats 7 as Sunday and tolerates extra spaces", () => {
    expect(parseSchedule("0  9 * *  7")).toEqual({ kind: "weekly", day: 0, hour: 9, minute: 0 });
  });

  it("keeps anything else as an advanced cron string", () => {
    for (const cron of ["*/15 * * * *", "0 8 1 * *", "0 8 * * 1-5", "0 24 * * *", "61 8 * * *", "nonsense"]) {
      expect(parseSchedule(cron)).toEqual({ kind: "advanced", cron });
    }
    expect(scheduleToCron({ kind: "advanced", cron: "  0 */6 * * * " })).toBe("0 */6 * * *");
  });

  it("describes each kind for the Household summary", () => {
    expect(describeSchedule("0 8 * * *")).toBe("Daily at 08:00");
    expect(describeSchedule("30 3 * * 1")).toBe("Weekly on Monday at 03:30");
    expect(describeSchedule("0 */6 * * *")).toBe("Custom (0 */6 * * *)");
  });

  it("parses a time of day and rejects anything else", () => {
    expect(parseScheduleTime("08:05")).toEqual({ hour: 8, minute: 5 });
    expect(parseScheduleTime("24:00")).toBeNull();
    expect(parseScheduleTime("")).toBeNull();
  });
});

// #525 review — switching an Advanced schedule back to Daily/Weekly keeps
// the time (and first weekday) it already ran at, rather than resetting.
describe("cronTimeOfDay", () => {
  it("keeps the time and first weekday of a compound cron", () => {
    expect(cronTimeOfDay("15 6 * * 1-5")).toEqual({ hour: 6, minute: 15, day: 1 });
    expect(cronTimeOfDay("0 22 * * 2,4")).toEqual({ hour: 22, minute: 0, day: 2 });
    expect(cronTimeOfDay("30 9 1 * *")).toEqual({ hour: 9, minute: 30, day: null });
    expect(cronTimeOfDay("0 8 * * 7")).toEqual({ hour: 8, minute: 0, day: 0 });
  });

  it("gives nothing when there isn't one time of day to keep", () => {
    for (const cron of ["*/15 * * * *", "0 */6 * * *", "0 8,20 * * *", "0 8 * *", "0 0 8 * * *", "99 8 * * *", "0 24 * * *"]) {
      expect(cronTimeOfDay(cron)).toBeNull();
    }
  });
});
