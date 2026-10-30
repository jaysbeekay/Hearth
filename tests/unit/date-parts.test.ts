import { afterEach, describe, expect, it } from "vitest";
import { isoDay, longMonthName, shortMonthName, zonedDayParts } from "@/lib/dateParts";
import { financialYearLabel } from "@/lib/utils";
import { buildMonthlyTimeline, buildYearlyTimeline } from "@/lib/spend";
import {
  EXPLICIT_UTC_TIME_ZONE,
  HOUSEHOLD_DEFAULT_USER_TIME_ZONE,
  USER_TIMEZONE_OPTIONS,
  isUserTimeZoneOption,
  userTimeZoneChoice,
} from "@/lib/timezones";

// #422 — date building blocks that never depend on the runtime's locale data
// or process timezone, and the places that bucket calendar dates by month.

const originalTz = process.env.TZ;
afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe("the shared month table", () => {
  it("names every month in English, short and long", () => {
    expect(shortMonthName(9)).toBe("Sep");
    expect(longMonthName(9)).toBe("September");
    expect(shortMonthName(1)).toBe("Jan");
    expect(longMonthName(12)).toBe("December");
  });

  it("is empty outside 1–12 rather than wrapping round", () => {
    for (const month of [0, -1, 13, 1.5, Number.NaN]) {
      expect(longMonthName(month)).toBe("");
      expect(shortMonthName(month)).toBe("");
    }
  });
});

describe("zoned day parts", () => {
  it("reads the day in the given zone, whatever the process zone", () => {
    const moment = new Date("2026-12-31T20:00:00.000Z");
    for (const tz of ["America/New_York", "Pacific/Auckland"]) {
      process.env.TZ = tz;
      expect(zonedDayParts(moment, "Australia/Sydney")).toEqual({ year: 2027, month: 1, day: 1 });
      expect(zonedDayParts(moment, "America/Los_Angeles")).toEqual({ year: 2026, month: 12, day: 31 });
      expect(zonedDayParts(moment, "Not/AZone")).toEqual({ year: 2026, month: 12, day: 31 });
    }
  });

  it("writes an ISO day padded", () => {
    expect(isoDay({ year: 2026, month: 3, day: 5 })).toBe("2026-03-05");
  });
});

describe("Preferences timezone choices", () => {
  it("leads with Household default, then UTC as Etc/UTC; plain UTC is not offered", () => {
    expect(USER_TIMEZONE_OPTIONS.slice(0, 2)).toEqual([HOUSEHOLD_DEFAULT_USER_TIME_ZONE, EXPLICIT_UTC_TIME_ZONE]);
    expect(USER_TIMEZONE_OPTIONS).not.toContain("UTC");
    expect(isUserTimeZoneOption("")).toBe(true);
    expect(isUserTimeZoneOption("Etc/UTC")).toBe(true);
    expect(isUserTimeZoneOption("Europe/Paris")).toBe(true);
    expect(isUserTimeZoneOption("UTC")).toBe(false);
    expect(isUserTimeZoneOption("Mars/Olympus")).toBe(false);
    expect(isUserTimeZoneOption(null)).toBe(false);
  });

  it("shows a stored legacy UTC (never chosen) as Household default", () => {
    expect(userTimeZoneChoice("UTC")).toBe("");
    expect(userTimeZoneChoice("")).toBe("");
    expect(userTimeZoneChoice(null)).toBe("");
    expect(userTimeZoneChoice("Etc/UTC")).toBe("Etc/UTC");
    expect(userTimeZoneChoice("Europe/Paris")).toBe("Europe/Paris");
  });
});

describe("financial year of a calendar date", () => {
  it.each([["America/Los_Angeles"], ["Pacific/Auckland"], ["UTC"]])("reads the stored day under TZ=%s", (tz) => {
    process.env.TZ = tz;
    expect(financialYearLabel(new Date("2026-07-01T00:00:00.000Z"))).toBe("FY2026–27");
    expect(financialYearLabel(new Date("2026-06-30T00:00:00.000Z"))).toBe("FY2025–26");
    expect(financialYearLabel(new Date("2027-01-01T00:00:00.000Z"))).toBe("FY2026–27");
  });
});

describe("spend timelines bucket calendar dates in UTC", () => {
  const contract = (startDate: string, endDate: string | null) => ({
    cost: 10,
    currency: "AUD",
    billingFrequency: "MONTHLY",
    startDate: new Date(`${startDate}T00:00:00.000Z`),
    endDate: endDate ? new Date(`${endDate}T00:00:00.000Z`) : null,
  });
  const now = new Date("2026-10-15T00:00:00.000Z");

  it.each([["Pacific/Auckland"], ["America/New_York"], ["UTC"]])("months under TZ=%s", (tz) => {
    process.env.TZ = tz;
    // Starts and ends on the 1st: Sep and Oct are in, Aug and Nov aren't.
    const buckets = buildMonthlyTimeline([contract("2026-09-01", "2026-10-01")], 4, "AUD", new Map(), now);
    expect(buckets).toEqual([
      { month: "Jul 2026", total: 0 },
      { month: "Aug 2026", total: 0 },
      { month: "Sep 2026", total: 10 },
      { month: "Oct 2026", total: 10 },
    ]);
  });

  it.each([["Pacific/Auckland"], ["America/New_York"]])("years under TZ=%s", (tz) => {
    process.env.TZ = tz;
    // Starts 1 Jan 2026: none of 2025, all twelve months of 2026.
    const buckets = buildYearlyTimeline([contract("2026-01-01", null)], 2, "AUD", new Map(), now);
    expect(buckets).toEqual([
      { year: "2025", total: 0 },
      { year: "2026", total: 120 },
    ]);
  });
});
