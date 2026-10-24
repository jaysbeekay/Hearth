import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { dueEntries, householdDay, isDue, resolveTimeZone, type DueEntry, type DueRecord } from "@/lib/duePolicy";

// The shared cases (ADR 0002): the standalone shell runs this same file
// against its own port (#386), so every Due rule is pinned there rather
// than in one-off assertions here.
interface DueCase {
  name: string;
  now?: string;
  timezone?: string;
  defaultReminderDays?: string;
  record: DueRecord;
  expected: DueEntry[];
}

const fixture = JSON.parse(
  readFileSync(path.resolve(__dirname, "../fixtures/due-policy-cases.json"), "utf8"),
) as { defaults: Required<Pick<DueCase, "now" | "timezone" | "defaultReminderDays">>; cases: DueCase[] };

describe("Due policy shared cases", () => {
  it.each(fixture.cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const { now, timezone, defaultReminderDays } = { ...fixture.defaults, ...c };
    const today = householdDay(new Date(now), timezone);
    expect(dueEntries(c.record, { today, defaultReminderDays })).toEqual(c.expected);
  });

  it("covers every record kind and state", () => {
    const kinds = new Set(fixture.cases.map((c) => c.record.kind));
    const states = new Set(fixture.cases.flatMap((c) => c.expected.map((e) => e.state)));
    expect([...kinds].sort()).toEqual(["contract", "tenancy", "vehicle", "warranty"]);
    expect([...states].sort()).toEqual(["due-soon", "ended", "lapsed", "later", "needs-new-end-date", "overdue"]);
  });
});

describe("household day helpers", () => {
  it("resolveTimeZone takes the first valid zone, else UTC", () => {
    expect(resolveTimeZone("", "Australia/Perth")).toBe("Australia/Perth");
    expect(resolveTimeZone("Not/AZone", undefined)).toBe("UTC");
    expect(resolveTimeZone("Europe/Paris", "Australia/Perth")).toBe("Europe/Paris");
  });

  it("householdDay follows the zone across midnight, including daylight saving", () => {
    // 13:30 UTC is 00:30 the next day in Sydney under daylight saving (UTC+11)...
    expect(householdDay(new Date("2026-10-24T13:30:00Z"), "Australia/Sydney")).toBe("2026-10-25");
    // ...but only 23:30 in winter (UTC+10).
    expect(householdDay(new Date("2026-06-24T13:30:00Z"), "Australia/Sydney")).toBe("2026-06-24");
  });

  it("isDue is only due soon or overdue", () => {
    const entry = (state: DueEntry["state"]): DueEntry => ({
      field: "endDate",
      date: "2026-10-24",
      daysLeft: 0,
      state,
      label: "",
    });
    expect(isDue(entry("due-soon"))).toBe(true);
    expect(isDue(entry("overdue"))).toBe(true);
    for (const state of ["later", "ended", "lapsed", "needs-new-end-date"] as const) {
      expect(isDue(entry(state))).toBe(false);
    }
  });

  it("an auto-renewing Contract's end date is never Due", () => {
    const record = (endDate: string): DueRecord => ({
      kind: "contract",
      endDate,
      noticePeriodDays: null,
      renewalType: "AUTO_RENEW",
      status: "ACTIVE",
    });
    const ctx = { today: "2026-10-24", defaultReminderDays: "30,14,7,1" };
    for (const endDate of ["2026-10-24", "2026-10-29", "2026-10-04"]) {
      expect(dueEntries(record(endDate), ctx).some(isDue)).toBe(false);
    }
  });
});
