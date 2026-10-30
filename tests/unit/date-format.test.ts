import { afterEach, describe, expect, it } from "vitest";
import { dueEntries, renderDueLabel, type DueLabel } from "@/lib/duePolicy";
import { formatDueLabel } from "@/lib/dueLabel";
import { displayTimeZone, formatDate, formatTimestamp } from "@/lib/utils";

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

const label = (labelParts: DueLabel, dateFormat?: string) => formatDueLabel({ labelParts }, { dateFormat });

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
      expect(formatDueLabel(entry, { dateFormat: "DD/MM/YYYY" })).toBe(entry.label);
      expect(renderDueLabel(entry.labelParts)).toBe(entry.label);
    }
    expect(entries.map((e) => formatDueLabel(e, { dateFormat: "MM/DD/YYYY" }))).toEqual([
      "Insurance expired 4 days ago",
      "Rego due Nov 3",
      "Service due Jan 5, 2027",
    ]);
  });
});

describe("Due labels never depend on the runtime's locale data", () => {
  it("writes day counts as plain digits, whatever the Region", () => {
    // Region only styles money; a label reads the same on server and browser.
    expect(label({ key: "expiredAgo", days: 1234 }, "DD/MM/YYYY")).toBe("Expired 1234 days ago");
    expect(label({ key: "serviceOverdue", days: 1234 }, "MM/DD/YYYY")).toBe("Service overdue by 1234 days");
  });

  it("uses the same English month as the date fields (Sep, never ICU's Sept)", () => {
    const parts: DueLabel = { key: "expires", date: "2026-09-03", today: TODAY };
    expect(label(parts, "DD/MM/YYYY")).toBe("Expires 3 Sep");
    expect(formatDate("2026-09-03T00:00:00.000Z", "DD/MM/YYYY")).toBe("3 Sep 2026");
    expect(label(parts, "MM/DD/YYYY")).toBe("Expires Sep 3");
    expect(formatDate("2026-09-03T00:00:00.000Z", "MM/DD/YYYY")).toBe("Sep 3, 2026");
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

  it("a timestamp with no valid viewer zone reads in UTC, whatever the process zone", () => {
    // The server and the browser run in different zones; both must agree.
    const uploadedAt = new Date("2026-11-03T20:00:00.000Z");
    for (const tz of ["Pacific/Auckland", "America/New_York"]) {
      process.env.TZ = tz;
      expect(formatTimestamp(uploadedAt, "DD/MM/YYYY", null)).toBe("3 Nov 2026");
      expect(formatTimestamp(uploadedAt, "DD/MM/YYYY", "Not/AZone")).toBe("3 Nov 2026");
    }
  });

  it("formats every month from the shared table, in every date format", () => {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    months.forEach((month, i) => {
      const mm = String(i + 1).padStart(2, "0");
      const stored = new Date(`2026-${mm}-15T00:00:00.000Z`);
      expect(formatDate(stored, "DD/MM/YYYY")).toBe(`15 ${month} 2026`);
      expect(formatDate(stored, "MM/DD/YYYY")).toBe(`${month} 15, 2026`);
      expect(formatDate(stored, "YYYY-MM-DD")).toBe(`2026-${mm}-15`);
      expect(formatTimestamp(stored, "DD/MM/YYYY", "Australia/Sydney")).toBe(`15 ${month} 2026`);
      expect(formatTimestamp(stored, "MM/DD/YYYY", "Australia/Sydney")).toBe(`${month} 15, 2026`);
      expect(formatTimestamp(stored, "YYYY-MM-DD", "Australia/Sydney")).toBe(`2026-${mm}-15`);
    });
  });

  it("pads ISO dates and timestamps", () => {
    expect(formatDate(new Date("2026-03-05T00:00:00.000Z"), "YYYY-MM-DD")).toBe("2026-03-05");
    expect(formatTimestamp(new Date("2026-03-05T12:00:00.000Z"), "YYYY-MM-DD", "Europe/London")).toBe("2026-03-05");
  });

  it("the viewer's chosen timezone wins; Household default and the legacy UTC default defer", () => {
    expect(displayTimeZone("Europe/Paris", "Australia/Sydney")).toBe("Europe/Paris");
    // "" is the explicit Household default choice.
    expect(displayTimeZone("", "Australia/Sydney")).toBe("Australia/Sydney");
    // "UTC" is the column default every member who never chose still has.
    expect(displayTimeZone("UTC", "Australia/Sydney")).toBe("Australia/Sydney");
    // A deliberate UTC choice is stored as Etc/UTC, and honoured.
    expect(displayTimeZone("Etc/UTC", "Australia/Sydney")).toBe("Etc/UTC");
    expect(displayTimeZone(null, "Australia/Sydney")).toBe("Australia/Sydney");
    expect(displayTimeZone("Not/AZone", "Australia/Sydney")).toBe("Australia/Sydney");
  });
});
