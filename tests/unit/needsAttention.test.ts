import { describe, expect, it } from "vitest";
import {
  buildContractAttentionItems,
  buildInboxItem,
  buildMissingDetailsItems,
  buildReminderFailureItems,
  buildReminderNudgeItem,
  buildTenancyAttentionItems,
  buildVehicleAttentionItems,
  buildWarrantyAttentionItems,
  groupAttentionItems,
  type AttentionItem,
} from "@/lib/needsAttention";
import { addDays, type DueContext, type DueEntry } from "@/lib/duePolicy";

const TODAY = "2026-10-25";
const ctx: DueContext = { today: TODAY, defaultReminderDays: "30,14,7,1" };

/** A stored calendar date `days` from the household's today. */
function inDays(days: number): Date {
  return new Date(`${addDays(TODAY, days)}T00:00:00.000Z`);
}

function contract(
  id: string,
  endInDays: number | null,
  extra: Partial<{ documents: number; renewalType: string; noticePeriodDays: number | null; status: string; reminderDaysBefore: string | null }> = {},
) {
  return {
    id,
    title: `Contract ${id}`,
    provider: "Provider",
    endDate: endInDays == null ? null : inDays(endInDays),
    renewalType: extra.renewalType ?? "MANUAL_RENEWAL",
    noticePeriodDays: extra.noticePeriodDays ?? null,
    status: extra.status ?? "ACTIVE",
    reminderDaysBefore: extra.reminderDaysBefore ?? null,
    _count: { documents: extra.documents ?? 0 },
  };
}

function warranty(id: string, endInDays: number) {
  return {
    id,
    description: `Warranty ${id}`,
    manufacturer: null,
    warrantyEndDate: inDays(endInDays),
    reminderDaysBefore: null,
    _count: { documents: 0 },
  };
}

function dueItem(id: string, daysLeft: number): AttentionItem {
  const entry: DueEntry = {
    field: "endDate",
    date: addDays(TODAY, daysLeft),
    daysLeft,
    state: daysLeft < 0 ? "overdue" : "due-soon",
    label: id,
    labelParts: { key: "needsNewEndDate" },
  };
  return { id, kind: "contract", group: "due", title: id, entry, href: `/contracts/${id}` };
}

describe("groupAttentionItems", () => {
  it("puts the soonest real deadline first, whatever housekeeping exists", () => {
    const { due, housekeeping } = groupAttentionItems([
      buildReminderNudgeItem(),
      ...buildInboxItem(3),
      dueItem("in-20", 20),
      dueItem("overdue-2", -2),
      dueItem("in-1", 1),
      dueItem("overdue-10", -10),
    ]);

    expect(due.map((i) => i.id)).toEqual(["overdue-10", "overdue-2", "in-1", "in-20"]);
    expect(housekeeping.map((i) => i.id)).toEqual(["system-reminders", "inbox"]);
  });

  it("keeps undated items out of Due", () => {
    const { due } = groupAttentionItems([
      ...buildMissingDetailsItems({ contracts: 2, warranties: 1 }),
      buildReminderNudgeItem(),
    ]);
    expect(due).toEqual([]);
  });
});

describe("attention item actions", () => {
  it("never makes uploading a document the main action", () => {
    const items = [
      ...buildContractAttentionItems([contract("a", 5), contract("b", -3, { documents: 2 })], ctx),
      ...buildWarrantyAttentionItems([warranty("w", 10)], ctx),
    ];
    for (const item of items) {
      expect(item.action?.label ?? "").not.toMatch(/upload/i);
    }
    expect(items.find((i) => i.id === "a")?.noDocument).toBe(true);
    expect(items.find((i) => i.id === "b")?.noDocument).toBe(false);
  });

  it("gives an expiring warranty no action button", () => {
    const [item] = buildWarrantyAttentionItems([warranty("w", 10)], ctx);
    expect(item.group).toBe("due");
    expect(item.action).toBeUndefined();
  });
});

describe("Due rows follow the Due policy (#384)", () => {
  it("only an Expired manual-renewal Contract is overdue and can be marked cancelled", () => {
    const items = buildContractAttentionItems(
      [
        contract("manual", -3),
        contract("fixed", -3, { renewalType: "FIXED_TERM" }),
        contract("cancelled", 5, { status: "CANCELLED" }),
      ],
      ctx,
    );
    expect(items.map((i) => i.id)).toEqual(["manual"]);
    expect(items[0].entry?.state).toBe("overdue");
    expect(items[0].canMarkCancelled).toBe(true);
  });

  it("an auto-renewing Contract past its end date is Housekeeping, not Due", () => {
    const [item] = buildContractAttentionItems([contract("auto", -3, { renewalType: "AUTO_RENEW" })], ctx);
    expect(item.group).toBe("housekeeping");
    expect(item.entry?.state).toBe("needs-new-end-date");
    expect(item.action?.label).toBe("Set the new end date");
    expect(item.canMarkCancelled).toBeUndefined();
  });

  it("a fixed-term Contract ending soon is Due but offers nothing to renew", () => {
    const [item] = buildContractAttentionItems([contract("fixed", 5, { renewalType: "FIXED_TERM" })], ctx);
    expect(item.group).toBe("due");
    expect(item.entry).toMatchObject({ state: "due-soon" });
    expect(item.action).toBeUndefined();
    expect(item.canMarkCancelled).toBe(false);
  });

  it("an auto-renewing Contract's end date is never Due", () => {
    expect(buildContractAttentionItems([contract("auto", 5, { renewalType: "AUTO_RENEW" })], ctx)).toEqual([]);
  });

  it("uses each record's due-soon window, not a fixed 30 days", () => {
    const items = buildContractAttentionItems(
      [contract("wide", 50, { reminderDaysBefore: "60" }), contract("narrow", 10, { reminderDaysBefore: "7" })],
      ctx,
    );
    expect(items.map((i) => i.id)).toEqual(["wide"]);
  });

  it("a date of today is due soon, not overdue", () => {
    const [item] = buildContractAttentionItems([contract("today", 0)], ctx);
    expect(item.entry).toMatchObject({ state: "due-soon", label: "Expires today" });
  });

  it("a Lapsed Warranty leaves the queue", () => {
    expect(buildWarrantyAttentionItems([warranty("lapsed", -1)], ctx)).toEqual([]);
  });

  it("gives a Vehicle one row per Due entry, each with its own state", () => {
    const items = buildVehicleAttentionItems(
      [
        {
          id: "v",
          label: "Car",
          regoExpiry: inDays(-2),
          insuranceExpiry: inDays(90),
          nextServiceDue: inDays(5),
          reminderDaysBefore: null,
        },
      ],
      ctx,
    );
    expect(items.map((i) => [i.entry?.field, i.entry?.state, i.action?.label])).toEqual([
      ["regoExpiry", "overdue", "Renew registration"],
      ["nextServiceDue", "due-soon", "Book service"],
    ]);
  });

  it("a Tenancy's lease end is Due, then Housekeeping once it passes", () => {
    const tenancy = (agreementId: string, leaseEnd: Date) => ({
      propertyId: "p",
      propertyLabel: "Flat",
      agreementId,
      tenantName: "Sam",
      leaseEnd,
    });
    const items = buildTenancyAttentionItems([tenancy("soon", inDays(10)), tenancy("ended", inDays(-1))], ctx);
    expect(items.map((i) => [i.id, i.group])).toEqual([
      ["lease-soon", "due"],
      ["lease-ended-ended", "housekeeping"],
    ]);
    expect(items[1].entry?.label).toBe("Lease ended — set the new lease end");
  });

  it("a Tenancy's own Reminder thresholds set its due-soon window (#388)", () => {
    const lease = { propertyId: "p", propertyLabel: "Flat", agreementId: "a", tenantName: null, leaseEnd: inDays(50) };
    expect(buildTenancyAttentionItems([lease], ctx)).toEqual([]);
    expect(buildTenancyAttentionItems([{ ...lease, reminderDaysBefore: "60,30" }], ctx).map((i) => i.group)).toEqual([
      "due",
    ]);
  });
});

describe("Reminder failure rows", () => {
  it("a failed lease Reminder links to its Property (#388)", () => {
    const lease = { propertyId: "p1", propertyLabel: "Flat", agreementId: "t1", tenantName: null, leaseEnd: inDays(10) };
    const items = buildReminderFailureItems(
      [{ ownerType: "TENANCY", ownerId: "t1", error: "HTTP 500" }],
      [],
      [],
      [],
      [lease],
    );
    expect(items).toEqual([
      expect.objectContaining({
        id: "failed-tenancy-t1",
        title: "Flat",
        subtitle: "Lease reminder delivery failed: HTTP 500",
        href: "/home/p1",
        badge: "Reminder failed",
      }),
    ]);
  });
});

describe("housekeeping builders", () => {
  it("only adds Inbox and missing-info rows when there's something to tidy", () => {
    expect(buildInboxItem(0)).toEqual([]);
    expect(buildMissingDetailsItems({ contracts: 0, warranties: 0, vehicles: 0 })).toEqual([]);
    expect(buildInboxItem(1)[0].title).toBe("1 document waiting in your Inbox");
    const [row] = buildMissingDetailsItems({ contracts: 3, warranties: 0 });
    expect(row.title).toBe("3 contracts are missing key details");
    expect(row.href).toBe("/contracts?missing=details");
    expect(row.action?.href).toBe("/contracts?missing=details");
    expect(buildMissingDetailsItems({ contracts: 0, warranties: 0, vehicles: 1 })[0].href).toBe(
      "/vehicles?missing=details",
    );
  });
});
