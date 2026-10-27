import { afterEach, describe, expect, it } from "vitest";
import { dueEntries, renderDueLabel, type DueLabel } from "@/lib/duePolicy";
import { formatDueLabel } from "@/lib/dueLabel";
import { REGION_OPTIONS, displayTimeZone, formatDate, formatTimestamp } from "@/lib/utils";

// #422 — Due labels and calendar dates follow the viewer's Preferences, and a
// calendar date stored at UTC midnight stays that calendar day whatever the
// process timezone.

const TODAY = "2026-10-24";

// Every label key, with a date this year, a date next year, and today where it applies.
const DATED: { key: Extract<DueLabel, { date: string }>["key"]; text: string }[] = [
  { key: "cancelBy", text: "Cancel by" },
  { key: "renews", text: "Renews" },
  { key: "expires", text: "Expires" },
  { key: "ends", text: "Ends" },
  { key: "regoDue", text: "Rego due" },
  { key: "insuranceDue", text: "Insurance due" },
  { key: "serviceDue", text: "Service due" },
  { key: "leaseEnds", text: "Lease ends" },
  { key: "ended", text: "Ended" },
  { key: "lapsed", text: "Lapsed" },
];

const label = (labelParts: DueLabel, dateFormat?: string, region?: string) =>
  formatDueLabel({ labelParts }, { dateFormat, region });

describe("Due labels in the viewer's date format", () => {
  it.each(DATED)("$key reads in each date format", ({ key, text }) => {
    const thisYear: DueLabel = { key, date: "2026-11-03", today: TODAY };
    const nextYear: DueLabel = { key, date: "2027-02-14", today: TODAY };

    expect(label(thisYear, "DD/MM/YYYY")).toBe(`${text} 3 Nov`);
    expect(label(nextYear, "DD/MM/YYYY")).toBe(`${text} 14 Feb 2027`);
    expect(label(thisYear, "MM/DD/YYYY")).toBe(`${text} Nov 3`);
    expect(label(nextYear, "MM/DD/YYYY")).toBe(`${text} Feb 14, 2027`);
    expect(label(thisYear, "YYYY-MM-DD")).toBe(`${text} 2026-11-03`);
    expect(label(nextYear, "YYYY-MM-DD")).toBe(`${text} 2027-02-14`);
  });

  it("upcoming dates say today on the day, in every format", () => {
    for (const dateFormat of ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"]) {
      expect(label({ key: "cancelBy", date: TODAY, today: TODAY }, dateFormat)).toBe("Cancel by today");
      expect(label({ key: "leaseEnds", date: TODAY, today: TODAY }, dateFormat)).toBe("Lease ends today");
    }
  });

  it("day-count labels read the same in every date format", () => {
    for (const dateFormat of ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"]) {
      expect(label({ key: "expiredAgo", days: 5 }, dateFormat)).toBe("Expired 5 days ago");
      expect(label({ key: "expiredAgo", days: 1 }, dateFormat)).toBe("Expired yesterday");
      expect(label({ key: "regoExpiredAgo", days: 3 }, dateFormat)).toBe("Rego expired 3 days ago");
      expect(label({ key: "insuranceExpiredAgo", days: 1 }, dateFormat)).toBe("Insurance expired yesterday");
      expect(label({ key: "serviceOverdue", days: 1 }, dateFormat)).toBe("Service overdue by 1 day");
      expect(label({ key: "serviceOverdue", days: 9 }, dateFormat)).toBe("Service overdue by 9 days");
      expect(label({ key: "needsNewEndDate" }, dateFormat)).toBe("Needs new end date");
      expect(label({ key: "leaseEnded" }, dateFormat)).toBe("Lease ended — set the new lease end");
    }
  });

  it("an unknown or missing date format falls back to the default DD/MM/YYYY", () => {
    const parts: DueLabel = { key: "cancelBy", date: "2026-11-03", today: TODAY };
    expect(label(parts)).toBe("Cancel by 3 Nov");
    expect(label(parts, "nonsense")).toBe("Cancel by 3 Nov");
  });

  it("the default format matches the policy's plain label", () => {
    const entries = dueEntries(
      { kind: "vehicle", regoExpiry: "2026-11-03", insuranceExpiry: "2026-10-20", nextServiceDue: "2027-01-05" },
      { today: TODAY, defaultReminderDays: "30" },
    );
    for (const entry of entries) {
      expect(formatDueLabel(entry, { dateFormat: "DD/MM/YYYY", region: "en-AU" })).toBe(entry.label);
      expect(renderDueLabel(entry.labelParts)).toBe(entry.label);
    }
    expect(entries.map((e) => formatDueLabel(e, { dateFormat: "MM/DD/YYYY", region: "en-US" }))).toEqual([
      "Insurance expired 4 days ago",
      "Rego due Nov 3",
      "Service due Jan 5, 2027",
    ]);
  });
});

describe("Due labels in the viewer's region", () => {
  it.each(REGION_OPTIONS.map((region) => [region]))("%s keeps the date format's English month names", (region) => {
    const parts: DueLabel = { key: "expires", date: "2026-11-03", today: TODAY };
    expect(label(parts, "DD/MM/YYYY", region)).toBe("Expires 3 Nov");
    expect(label(parts, "MM/DD/YYYY", region)).toBe("Expires Nov 3");
    expect(label(parts, "YYYY-MM-DD", region)).toBe("Expires 2026-11-03");
  });

  it.each(REGION_OPTIONS.map((region) => [region]))("%s writes day counts in its number style", (region) => {
    const days = 1234;
    const count = days.toLocaleString(region);
    expect(label({ key: "expiredAgo", days }, "DD/MM/YYYY", region)).toBe(`Expired ${count} days ago`);
    expect(label({ key: "serviceOverdue", days }, "MM/DD/YYYY", region)).toBe(`Service overdue by ${count} days`);
  });

  it("separates thousands by region", () => {
    expect(label({ key: "expiredAgo", days: 1234 }, "DD/MM/YYYY", "en-AU")).toBe("Expired 1,234 days ago");
    expect(label({ key: "expiredAgo", days: 1234 }, "DD/MM/YYYY", "de-DE")).toBe("Expired 1.234 days ago");
    // An unknown region falls back to the default, en-AU.
    expect(label({ key: "expiredAgo", days: 1234 }, "DD/MM/YYYY", "xx-XX")).toBe("Expired 1,234 days ago");
  });
});

describe("calendar dates and timestamps across timezones", () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it.each([["America/New_York"], ["Pacific/Auckland"], ["UTC"]])(
    "a calendar date stored at UTC midnight keeps its day under TZ=%s",
    (tz) => {
      process.env.TZ = tz;
      const stored = new Date("2026-12-01T00:00:00.000Z");
      expect(formatDate(stored, "DD/MM/YYYY")).toBe("1 Dec 2026");
      expect(formatDate(stored, "MM/DD/YYYY")).toBe("Dec 1, 2026");
      expect(formatDate(stored, "YYYY-MM-DD")).toBe("2026-12-01");
      // Strings, as a client component receives them, too.
      expect(formatDate("2026-12-01T00:00:00.000Z", "DD/MM/YYYY")).toBe("1 Dec 2026");
      expect(formatDate("2026-01-01", "MM/DD/YYYY")).toBe("Jan 1, 2026");
    },
  );

  it("the process zone really does shift a local-time reading (the bug this guards)", () => {
    process.env.TZ = "America/New_York";
    expect(new Date("2026-12-01T00:00:00.000Z").getDate()).toBe(30);
    process.env.TZ = "Pacific/Auckland";
    expect(new Date("2026-12-31T12:00:00.000Z").getFullYear()).toBe(2027);
  });

  it("formatDate shows a dash for a missing or invalid date", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate("not a date")).toBe("—");
    expect(formatTimestamp(undefined, "DD/MM/YYYY", "UTC")).toBe("—");
  });

  it("a timestamp reads in the viewer's timezone, whatever the process zone", () => {
    process.env.TZ = "America/New_York";
    // 20:00 UTC on 3 Nov is already 4 Nov in Sydney and Auckland.
    const uploadedAt = new Date("2026-11-03T20:00:00.000Z");
    expect(formatTimestamp(uploadedAt, "DD/MM/YYYY", "Australia/Sydney")).toBe("4 Nov 2026");
    expect(formatTimestamp(uploadedAt, "MM/DD/YYYY", "Pacific/Auckland")).toBe("Nov 4, 2026");
    expect(formatTimestamp(uploadedAt, "YYYY-MM-DD", "Pacific/Auckland")).toBe("2026-11-04");
    expect(formatTimestamp(uploadedAt, "DD/MM/YYYY", "America/Los_Angeles")).toBe("3 Nov 2026");
    expect(formatTimestamp(uploadedAt, "YYYY-MM-DD", "UTC")).toBe("2026-11-03");
  });

  it("a timestamp with no valid viewer zone falls back to the process zone", () => {
    const uploadedAt = new Date("2026-11-03T20:00:00.000Z");
    process.env.TZ = "Pacific/Auckland";
    expect(formatTimestamp(uploadedAt, "DD/MM/YYYY", null)).toBe("4 Nov 2026");
    process.env.TZ = "America/New_York";
    expect(formatTimestamp(uploadedAt, "DD/MM/YYYY", "Not/AZone")).toBe("3 Nov 2026");
  });

  it("the viewer's chosen timezone wins, and the UTC default defers to the household's", () => {
    expect(displayTimeZone("Europe/Paris", "Australia/Sydney")).toBe("Europe/Paris");
    expect(displayTimeZone("UTC", "Australia/Sydney")).toBe("Australia/Sydney");
    expect(displayTimeZone(null, "Australia/Sydney")).toBe("Australia/Sydney");
    expect(displayTimeZone("Not/AZone", "Australia/Sydney")).toBe("Australia/Sydney");
  });
});
