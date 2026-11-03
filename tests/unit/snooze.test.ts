import { describe, expect, it } from "vitest";
import { activeSnoozeUntil, snoozeKey } from "@/lib/snooze";
import { reminderPlan, nextReminderPreview } from "@/lib/notifications/reminderSchedule";
import {
  buildContractAttentionItems,
  buildVehicleAttentionItems,
  buildWarrantyAttentionItems,
} from "@/lib/needsAttention";
import { addDays, type DueContext } from "@/lib/duePolicy";

const TODAY = "2026-10-25";
const ctx: DueContext = { today: TODAY, defaultReminderDays: "30,14,7,1" };
const inDays = (days: number) => new Date(`${addDays(TODAY, days)}T00:00:00.000Z`);

const contractRow = {
  kind: "contract" as const,
  endDate: inDays(5),
  noticePeriodDays: null,
  renewalType: "MANUAL_RENEWAL",
  status: "ACTIVE",
  reminderDaysBefore: null,
};

function snoozed<T extends Parameters<typeof snoozeKey>[0]>(record: T, untilInDays: number) {
  return { ...record, snoozedUntil: inDays(untilInDays), snoozedFor: snoozeKey(record) };
}

describe("activeSnoozeUntil", () => {
  it("runs until its day, then the record is back", () => {
    expect(activeSnoozeUntil(snoozed(contractRow, 7), TODAY)).toBe(addDays(TODAY, 7));
    expect(activeSnoozeUntil(snoozed(contractRow, 7), addDays(TODAY, 6))).toBe(addDays(TODAY, 7));
    expect(activeSnoozeUntil(snoozed(contractRow, 7), addDays(TODAY, 7))).toBeNull();
  });

  it("ends when the date it was set against moves (a renewal or an edit)", () => {
    const record = snoozed(contractRow, 30);
    expect(activeSnoozeUntil({ ...record, endDate: inDays(370) }, TODAY)).toBeNull();
    expect(activeSnoozeUntil({ ...record, noticePeriodDays: 30 }, TODAY)).toBeNull();
  });

  it("ends when any of a Vehicle's dates moves", () => {
    const vehicle = {
      kind: "vehicle" as const,
      regoExpiry: inDays(3),
      insuranceExpiry: inDays(90),
      nextServiceDue: null,
    };
    const record = snoozed(vehicle, 30);
    expect(activeSnoozeUntil(record, TODAY)).toBe(addDays(TODAY, 30));
    expect(activeSnoozeUntil({ ...record, regoExpiry: inDays(368) }, TODAY)).toBeNull();
    expect(activeSnoozeUntil({ ...record, nextServiceDue: inDays(60) }, TODAY)).toBeNull();
  });

  it("is off with no Snooze set", () => {
    expect(activeSnoozeUntil(contractRow, TODAY)).toBeNull();
    expect(activeSnoozeUntil({ ...contractRow, snoozedUntil: inDays(7), snoozedFor: null }, TODAY)).toBeNull();
  });
});

describe("Reminders while Snoozed", () => {
  it("holds a Snoozed record's Reminders and says until when", () => {
    const plan = reminderPlan(snoozed(contractRow, 7), ctx, []);
    expect(plan.entries).toEqual([]);
    expect(plan.snoozedUntil).toBe(addDays(TODAY, 7));
    expect(plan.held).toBe(false);
  });

  it("sends again once the Snooze ends", () => {
    const later = { ...ctx, today: addDays(TODAY, 2) };
    const record = { ...snoozed(contractRow, 2) };
    expect(reminderPlan(record, later, []).entries).toHaveLength(1);
  });

  it("gives the reason in the test-reminder preview", () => {
    const preview = nextReminderPreview(snoozed(contractRow, 7), ctx, [], { channels: ["EMAIL"] });
    expect(preview?.when).toEqual({ kind: "none", reason: "it's snoozed, so its reminders wait until 1 Nov." });
  });
});

describe("Needs attention while Snoozed", () => {
  const contract = {
    id: "c",
    title: "Contract",
    provider: "Provider",
    ...contractRow,
    snoozedUntil: null as Date | null,
    snoozedFor: null as string | null,
    _count: { documents: 0 },
  };

  it("offers Snooze on a Due row, and drops the row while Snoozed", () => {
    expect(buildContractAttentionItems([contract], ctx)[0].snooze).toEqual({ kind: "contract", recordId: "c" });
    expect(buildContractAttentionItems([{ ...contract, ...snoozed(contractRow, 7) }], ctx)).toEqual([]);
  });

  it("drops a Snoozed Warranty", () => {
    const warranty = {
      id: "w",
      description: "Warranty",
      manufacturer: null,
      warrantyEndDate: inDays(5),
      reminderDaysBefore: null,
      _count: { documents: 0 },
    };
    const key = snoozeKey({ kind: "warranty", ...warranty });
    expect(buildWarrantyAttentionItems([{ ...warranty, snoozedUntil: null, snoozedFor: null }], ctx)).toHaveLength(1);
    expect(buildWarrantyAttentionItems([{ ...warranty, snoozedUntil: inDays(7), snoozedFor: key }], ctx)).toEqual([]);
  });

  it("drops every row of a Snoozed Vehicle", () => {
    const vehicle = {
      id: "v",
      label: "Car",
      archivedAt: null,
      regoExpiry: inDays(-2),
      insuranceExpiry: inDays(90),
      nextServiceDue: inDays(5),
      reminderDaysBefore: null,
      contracts: [],
    };
    const key = snoozeKey({ kind: "vehicle", ...vehicle });
    expect(buildVehicleAttentionItems([{ ...vehicle, snoozedUntil: null, snoozedFor: null }], ctx)).toHaveLength(2);
    expect(buildVehicleAttentionItems([{ ...vehicle, snoozedUntil: inDays(7), snoozedFor: key }], ctx)).toEqual([]);
  });
});
