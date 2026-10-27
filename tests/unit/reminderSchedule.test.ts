import { describe, expect, it } from "vitest";
import { addDays, householdDay, type CalendarDay } from "@/lib/duePolicy";
import {
  liveFailures,
  nextReminderPreview,
  REMINDER_CHANNELS,
  reminderPlan,
  reminderSchedule,
  reminderThresholds,
  type ReminderRecord,
  type SentLogRow,
} from "@/lib/notifications/reminderSchedule";

// The Reminder schedule (#387) is pure, so every rule is pinned here
// without a database: each row is a record, the household's today and the
// sent log, and what each Reminder entry should do on this check.

const DEFAULT_DAYS = "30,14,7,1";

function plan(record: ReminderRecord & { extractionPending?: boolean }, today: CalendarDay, sent: SentLogRow[] = []) {
  return reminderPlan(record, { today, defaultReminderDays: DEFAULT_DAYS }, sent);
}

function sent(field: string, dueDate: CalendarDay | null, thresholdDays: number, extra: Partial<SentLogRow> = {}): SentLogRow {
  return { field, dueDate, thresholdDays, channel: "EMAIL", status: "SENT", ...extra };
}

const warranty = (warrantyEndDate: string, reminderDaysBefore?: string): ReminderRecord => ({
  kind: "warranty",
  warrantyEndDate,
  reminderDaysBefore,
});

const contract = (
  endDate: string,
  renewalType: string,
  noticePeriodDays: number | null = null,
  status = "ACTIVE",
): ReminderRecord => ({ kind: "contract", endDate, renewalType, noticePeriodDays, status });

const vehicle = (dates: { regoExpiry?: string; insuranceExpiry?: string; nextServiceDue?: string }): ReminderRecord => ({
  kind: "vehicle",
  regoExpiry: dates.regoExpiry ?? null,
  insuranceExpiry: dates.insuranceExpiry ?? null,
  nextServiceDue: dates.nextServiceDue ?? null,
});

interface Case {
  name: string;
  record: ReminderRecord & { extractionPending?: boolean };
  today: CalendarDay;
  sent?: SentLogRow[];
  /** Per Reminder entry, what the email channel does. */
  expected: { field: string; sendNow: number | null; nextReminderOn: CalendarDay | null }[];
}

const cases: Case[] = [
  {
    name: "a Warranty outside its window waits for its first threshold",
    record: warranty("2026-12-10"),
    today: "2026-10-25",
    expected: [{ field: "warrantyEndDate", sendNow: null, nextReminderOn: "2026-11-10" }],
  },
  {
    name: "crossing a threshold sends it",
    record: warranty("2026-11-24"),
    today: "2026-10-25",
    expected: [{ field: "warrantyEndDate", sendNow: 30, nextReminderOn: "2026-10-25" }],
  },
  {
    name: "a sent threshold waits for the next one",
    record: warranty("2026-11-24"),
    today: "2026-10-30",
    sent: [sent("warrantyEndDate", "2026-11-24", 30)],
    expected: [{ field: "warrantyEndDate", sendNow: null, nextReminderOn: "2026-11-10" }],
  },
  {
    name: "several thresholds crossed at once send one catch-up: the most urgent",
    record: warranty("2026-10-30"),
    today: "2026-10-25",
    expected: [{ field: "warrantyEndDate", sendNow: 7, nextReminderOn: "2026-10-25" }],
  },
  {
    name: "after the catch-up, the thresholds it passed over never send",
    record: warranty("2026-10-30"),
    today: "2026-10-26",
    sent: [sent("warrantyEndDate", "2026-10-30", 7)],
    expected: [{ field: "warrantyEndDate", sendNow: null, nextReminderOn: "2026-10-29" }],
  },
  {
    name: "a failed send isn't sent, so it's retried",
    record: warranty("2026-11-24"),
    today: "2026-10-26",
    sent: [sent("warrantyEndDate", "2026-11-24", 30, { status: "FAILED" })],
    expected: [{ field: "warrantyEndDate", sendNow: 30, nextReminderOn: "2026-10-26" }],
  },
  {
    name: "another channel's send doesn't count for this one",
    record: warranty("2026-11-24"),
    today: "2026-10-26",
    sent: [sent("warrantyEndDate", "2026-11-24", 30, { channel: "NTFY" })],
    expected: [{ field: "warrantyEndDate", sendNow: 30, nextReminderOn: "2026-10-26" }],
  },
  {
    name: "a stale undated row doesn't count",
    record: warranty("2026-11-24"),
    today: "2026-10-26",
    sent: [sent("warrantyEndDate", null, 30)],
    expected: [{ field: "warrantyEndDate", sendNow: 30, nextReminderOn: "2026-10-26" }],
  },
  {
    name: "renewed rego fires again: last year's row is for another date",
    record: vehicle({ regoExpiry: "2027-11-01" }),
    today: "2027-10-26",
    sent: [sent("regoExpiry", "2026-11-01", 7)],
    expected: [{ field: "regoExpiry", sendNow: 7, nextReminderOn: "2027-10-26" }],
  },
  {
    name: "unrenewed rego with the same row stays sent",
    record: vehicle({ regoExpiry: "2026-11-01" }),
    today: "2026-10-26",
    sent: [sent("regoExpiry", "2026-11-01", 7)],
    expected: [{ field: "regoExpiry", sendNow: null, nextReminderOn: "2026-10-31" }],
  },
  {
    name: "a Vehicle's dates each get their own Reminders",
    record: vehicle({ regoExpiry: "2026-10-30", insuranceExpiry: "2026-11-14", nextServiceDue: "2027-03-01" }),
    today: "2026-10-25",
    sent: [sent("insuranceExpiry", "2026-11-14", 30)],
    expected: [
      { field: "regoExpiry", sendNow: 7, nextReminderOn: "2026-10-25" },
      { field: "insuranceExpiry", sendNow: null, nextReminderOn: "2026-10-31" },
      { field: "nextServiceDue", sendNow: null, nextReminderOn: "2027-01-30" },
    ],
  },
  {
    name: "a Contract with a notice period reminds about the notice deadline while it's ahead",
    record: contract("2026-12-30", "MANUAL_RENEWAL", 30),
    today: "2026-11-24",
    expected: [{ field: "noticeDeadline", sendNow: 7, nextReminderOn: "2026-11-24" }],
  },
  {
    name: "a manual-renewal Contract reminds about its end date once the notice deadline has passed",
    record: contract("2026-12-30", "MANUAL_RENEWAL", 30),
    today: "2026-12-05",
    sent: [sent("noticeDeadline", "2026-11-30", 1)],
    expected: [{ field: "endDate", sendNow: 30, nextReminderOn: "2026-12-05" }],
  },
  {
    name: "an auto-renewing Contract reminds about its notice deadline",
    record: contract("2026-12-30", "AUTO_RENEW", 30),
    today: "2026-11-01",
    expected: [{ field: "noticeDeadline", sendNow: 30, nextReminderOn: "2026-11-01" }],
  },
  {
    name: "an auto-renewing Contract whose notice deadline has passed gets no Reminder",
    record: contract("2026-12-30", "AUTO_RENEW", 30),
    today: "2026-12-05",
    expected: [],
  },
  {
    name: "an auto-renewing Contract's end date never reminds",
    record: contract("2026-10-28", "AUTO_RENEW"),
    today: "2026-10-25",
    expected: [],
  },
  {
    name: "a fixed-term Contract reminds about its end date (and ignores a notice period)",
    record: contract("2026-11-01", "FIXED_TERM", 30),
    today: "2026-10-25",
    expected: [{ field: "endDate", sendNow: 7, nextReminderOn: "2026-10-25" }],
  },
  {
    name: "the day itself still reminds",
    record: warranty("2026-10-25"),
    today: "2026-10-25",
    sent: [sent("warrantyEndDate", "2026-10-25", 1)],
    expected: [{ field: "warrantyEndDate", sendNow: null, nextReminderOn: null }],
  },
  { name: "no Reminders past the date: an Expired Contract", record: contract("2026-10-20", "MANUAL_RENEWAL"), today: "2026-10-25", expected: [] },
  { name: "no Reminders past the date: an Ended Contract", record: contract("2026-10-20", "FIXED_TERM"), today: "2026-10-25", expected: [] },
  { name: "no Reminders past the date: a Lapsed Warranty", record: warranty("2026-10-24"), today: "2026-10-25", expected: [] },
  { name: "no Reminders past the date: overdue rego", record: vehicle({ regoExpiry: "2026-10-01" }), today: "2026-10-25", expected: [] },
  {
    name: "no Reminders for an auto-renewing Contract that needs a new end date",
    record: contract("2026-10-01", "AUTO_RENEW"),
    today: "2026-10-25",
    expected: [],
  },
  {
    name: "no Reminders for a Cancelled Contract",
    record: contract("2026-10-28", "MANUAL_RENEWAL", null, "CANCELLED"),
    today: "2026-10-25",
    expected: [],
  },
  {
    name: "no Reminders while a record Needs review",
    record: { ...warranty("2026-10-28"), extractionPending: true },
    today: "2026-10-25",
    expected: [],
  },
  {
    name: "a record's own thresholds replace the household default",
    record: warranty("2026-11-24", "60, 3"),
    today: "2026-10-25",
    sent: [sent("warrantyEndDate", "2026-11-24", 60)],
    expected: [{ field: "warrantyEndDate", sendNow: null, nextReminderOn: "2026-11-21" }],
  },
];

describe("Reminder schedule", () => {
  it.each(cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const result = plan(c.record, c.today, c.sent);
    expect(result.entries.map((e) => ({ field: e.entry.field, ...e.schedule.EMAIL }))).toEqual(c.expected);
  });

  it("the #381 case: unsent past thresholds mean the next check, never a past day", () => {
    // No channel configured, so nothing has ever been sent; the 30-day
    // threshold (12 Oct) is long gone.
    const result = plan(contract("2026-11-11", "MANUAL_RENEWAL"), "2026-10-24");
    expect(result.entries[0].schedule.EMAIL).toEqual({ sendNow: 30, nextReminderOn: "2026-10-24" });
    // Once that catch-up is sent, the next is the 14-day threshold, 28 Oct.
    const after = plan(contract("2026-11-11", "MANUAL_RENEWAL"), "2026-10-24", [sent("endDate", "2026-11-11", 30)]);
    expect(after.entries[0].schedule.EMAIL).toEqual({ sendNow: null, nextReminderOn: "2026-10-28" });
  });

  it("never gives a Next reminder in the past, on any day, whatever was sent", () => {
    const end = "2026-12-01";
    const logs: SentLogRow[] = [];
    for (let day = "2026-09-01"; day <= "2026-12-05"; day = addDays(day, 1)) {
      for (const record of [warranty(end), contract(end, "MANUAL_RENEWAL", 10), vehicle({ regoExpiry: end })]) {
        for (const { schedule } of plan(record, day, logs).entries) {
          for (const channel of REMINDER_CHANNELS) {
            const next = schedule[channel].nextReminderOn;
            if (next != null) expect(next >= day).toBe(true);
          }
        }
      }
      // Pretend every warranty send succeeds, to walk the whole series.
      const w = plan(warranty(end), day, logs).entries[0];
      if (w?.schedule.EMAIL.sendNow != null) logs.push(sent("warrantyEndDate", end, w.schedule.EMAIL.sendNow));
    }
    // Walking the series sends each threshold once, in order.
    expect(logs.map((l) => l.thresholdDays)).toEqual([30, 14, 7, 1]);
  });

  it("counts days in the household's timezone", () => {
    // 14:00 UTC on 24 Oct is already 25 Oct in Sydney.
    const now = new Date("2026-10-24T14:00:00Z");
    const record = warranty("2026-11-24");

    const sydney = plan(record, householdDay(now, "Australia/Sydney"));
    expect(sydney.entries[0].entry.daysLeft).toBe(30);
    expect(sydney.entries[0].schedule.EMAIL.sendNow).toBe(30);

    const utc = plan(record, householdDay(now, "UTC"));
    expect(utc.entries[0].entry.daysLeft).toBe(31);
    expect(utc.entries[0].schedule.EMAIL).toEqual({ sendNow: null, nextReminderOn: "2026-10-25" });
  });

  it("gives every channel its own schedule", () => {
    const result = plan(warranty("2026-11-24"), "2026-10-26", [sent("warrantyEndDate", "2026-11-24", 30)]);
    const { schedule } = result.entries[0];
    expect(schedule.EMAIL.sendNow).toBeNull();
    expect(schedule.NTFY.sendNow).toBe(30);
    expect(schedule.WEBHOOK.sendNow).toBe(30);
  });

  it("does nothing without thresholds", () => {
    const entry = {
      field: "warrantyEndDate" as const,
      date: "2026-10-30",
      daysLeft: 5,
      state: "due-soon" as const,
      label: "",
      labelParts: { key: "ends" as const, date: "2026-10-30", today: "2026-10-25" },
    };
    expect(reminderSchedule(entry, [], [], "2026-10-25").EMAIL).toEqual({ sendNow: null, nextReminderOn: null });
  });

  it("takes whole-day thresholds, falling back to the household default", () => {
    expect(reminderThresholds("14, 7, nope, 1.5", DEFAULT_DAYS)).toEqual([7, 14]);
    expect(reminderThresholds("nope", DEFAULT_DAYS)).toEqual([1, 7, 14, 30]);
    expect(reminderThresholds(null, "10,5")).toEqual([5, 10]);
  });
});

// "Send test reminder" previews what the schedule would really send (#387 review).
describe("nextReminderPreview", () => {
  const ctx = (today: CalendarDay) => ({ today, defaultReminderDays: DEFAULT_DAYS });
  const preview = (record: ReminderRecord & { extractionPending?: boolean }, today: CalendarDay, log: SentLogRow[] = [], field?: string) =>
    nextReminderPreview(record, ctx(today), log, { field, channels: ["EMAIL"] });

  it("a pending catch-up goes on the next check, with today's day count", () => {
    expect(preview(warranty("2026-11-01"), "2026-10-25")).toMatchObject({
      entry: { field: "warrantyEndDate", date: "2026-11-01" },
      daysRemaining: 7,
      when: { kind: "next-check" },
    });
  });

  it("otherwise the next threshold's day, with the count it will carry then", () => {
    expect(preview(warranty("2026-12-10"), "2026-10-25")).toMatchObject({
      daysRemaining: 30,
      when: { kind: "on", day: "2026-11-10" },
    });
    expect(preview(warranty("2026-11-01"), "2026-10-25", [sent("warrantyEndDate", "2026-11-01", 7)])).toMatchObject({
      daysRemaining: 1,
      when: { kind: "on", day: "2026-10-31" },
    });
  });

  it("previews the notice deadline while it's ahead", () => {
    expect(preview(contract("2026-12-30", "MANUAL_RENEWAL", 30), "2026-11-20")).toMatchObject({
      entry: { field: "noticeDeadline", date: "2026-11-30" },
      daysRemaining: 10,
      when: { kind: "next-check" },
    });
  });

  it("counts in the household's day, not UTC's", () => {
    // 14:00 UTC is already 26 Oct in Sydney: 6 days to 1 Nov, not 7.
    const today = householdDay(new Date("2026-10-25T14:00:00Z"), "Australia/Sydney");
    expect(preview(warranty("2026-11-01"), today)?.daysRemaining).toBe(6);
  });

  it("says plainly that an auto-renewing Contract's end date never gets a Reminder", () => {
    const p = preview(contract("2026-11-10", "AUTO_RENEW", 30), "2026-10-25");
    expect(p).toMatchObject({ entry: { field: "endDate" }, when: { kind: "none" } });
    expect(p?.when.kind === "none" && p.when.reason).toMatch(/renews automatically/);
  });

  it("says why for a passed date, a held record, no thresholds and all sent", () => {
    const reason = (p: ReturnType<typeof preview>) => (p?.when.kind === "none" ? p.when.reason : null);
    expect(reason(preview(warranty("2026-10-01"), "2026-10-25"))).toMatch(/passed/);
    expect(reason(preview({ ...warranty("2026-11-01"), extractionPending: true }, "2026-10-25"))).toMatch(/needs review/);
    expect(
      reason(nextReminderPreview(warranty("2026-11-01"), { today: "2026-10-25", defaultReminderDays: "" }, [], { channels: ["EMAIL"] })),
    ).toMatch(/no reminder thresholds/);
    expect(reason(preview(warranty("2026-11-01"), "2026-10-31", [sent("warrantyEndDate", "2026-11-01", 1)]))).toMatch(
      /already been sent/,
    );
  });

  it("narrows a Vehicle to the date being tested", () => {
    const v = vehicle({ regoExpiry: "2026-11-01", insuranceExpiry: "2026-12-10" });
    expect(preview(v, "2026-10-25", [], "insuranceExpiry")).toMatchObject({
      entry: { field: "insuranceExpiry" },
      when: { kind: "on", day: "2026-11-10" },
    });
  });

  it("is null for a record with no date", () => {
    expect(preview(vehicle({}), "2026-10-25", [], "regoExpiry")).toBeNull();
  });
});

describe("liveFailures", () => {
  const row = (channel: string, thresholdDays: number, status: "SENT" | "FAILED", sentAt: string, dueDate = "2026-11-30") => ({
    ownerType: "VEHICLE",
    ownerId: "v1",
    field: "regoExpiry",
    channel,
    thresholdDays,
    status,
    dueDate: new Date(`${dueDate}T00:00:00Z`),
    sentAt: new Date(sentAt),
  });

  it("drops a failure once a later threshold sends on the same channel and date", () => {
    const failed = row("WEBHOOK", 7, "FAILED", "2026-11-28T09:00:00Z");
    expect(liveFailures([failed, row("WEBHOOK", 1, "SENT", "2026-11-29T09:00:00Z")])).toEqual([]);
  });

  it("keeps it when the send was earlier, on another channel, or for another date", () => {
    const failed = row("WEBHOOK", 7, "FAILED", "2026-11-28T09:00:00Z");
    expect(liveFailures([failed, row("WEBHOOK", 30, "SENT", "2026-10-31T09:00:00Z")])).toEqual([failed]);
    expect(liveFailures([failed, row("EMAIL", 1, "SENT", "2026-11-29T09:00:00Z")])).toEqual([failed]);
    expect(liveFailures([failed, row("WEBHOOK", 1, "SENT", "2026-11-29T09:00:00Z", "2027-11-30")])).toEqual([failed]);
  });
});
