import { describe, expect, it } from "vitest";
import type { Contract, Product } from "@/generated/prisma/client";
import {
  buildContractAttentionItems,
  buildInboxItem,
  buildMissingInfoItems,
  buildReminderNudgeItem,
  buildWarrantyAttentionItems,
  groupAttentionItems,
  type AttentionItem,
} from "@/lib/needsAttention";

const DAY = 86_400_000;

function inDays(days: number): Date {
  return new Date(Date.now() + days * DAY);
}

function contract(id: string, endInDays: number, documents = 0) {
  return {
    id,
    title: `Contract ${id}`,
    provider: "Provider",
    endDate: inDays(endInDays),
    renewalType: "MANUAL_RENEWAL",
    noticePeriodDays: null,
    _count: { documents },
  } as unknown as Contract & { _count: { documents: number } };
}

function warranty(id: string, endInDays: number) {
  return {
    id,
    description: `Warranty ${id}`,
    manufacturer: null,
    warrantyEndDate: inDays(endInDays),
    _count: { documents: 0 },
  } as unknown as Product & { _count: { documents: number } };
}

function dueItem(id: string, days: number): AttentionItem {
  return { id, kind: "contract", group: "due", title: id, days, href: `/contracts/${id}` };
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
      ...buildMissingInfoItems(2, 1),
      buildReminderNudgeItem(),
    ]);
    expect(due).toEqual([]);
  });
});

describe("attention item actions", () => {
  it("never makes uploading a document the main action", () => {
    const items = [
      ...buildContractAttentionItems([contract("a", 5), contract("b", -3, 2)]),
      ...buildWarrantyAttentionItems([warranty("w", 10)]),
    ];
    for (const item of items) {
      expect(item.action?.label ?? "").not.toMatch(/upload/i);
    }
    expect(items.find((i) => i.id === "a")?.noDocument).toBe(true);
    expect(items.find((i) => i.id === "b")?.noDocument).toBe(false);
  });

  it("gives an expiring warranty no action button", () => {
    const [item] = buildWarrantyAttentionItems([warranty("w", 10)]);
    expect(item.group).toBe("due");
    expect(item.action).toBeUndefined();
  });
});

describe("housekeeping builders", () => {
  it("only adds Inbox and missing-info rows when there's something to tidy", () => {
    expect(buildInboxItem(0)).toEqual([]);
    expect(buildMissingInfoItems(0, 0)).toEqual([]);
    expect(buildInboxItem(1)[0].title).toBe("1 document waiting in your Inbox");
    expect(buildMissingInfoItems(3, 0)[0].title).toBe("3 contracts are missing key details");
  });
});
