// #384 — the same record shows the same Due state everywhere: on the lists
// (their `?due=` filters and each card's badge), on the dashboard's Needs
// attention, in Search, in Upcoming and in the detail-page banner. Each of
// those asks the Due policy through the functions exercised here, against
// one set of fixture records in a real (temporary) database.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { setupTestDb, createTestUser, setModuleEnabled } from "../helpers/testDb";
import { getDueContext } from "@/lib/appSettings";
import { addDays, type DueContext, type DueState } from "@/lib/duePolicy";
import { bannerEntries, contractDue, headlineEntry, vehicleDue, warrantyDue } from "@/lib/dueRecords";
import { contractDueCounts, contractDueFilter, vehicleDueFilter, warrantyDueCounts, warrantyDueFilter } from "@/lib/listDue";
import { buildContractAttentionItems, buildVehicleAttentionItems, buildWarrantyAttentionItems } from "@/lib/needsAttention";
import { getCalendarEvents } from "@/lib/calendarEvents";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "test-user" } })) }));

const db = setupTestDb({ resetBetweenTests: false });
const { GET } = await import("@/app/api/search/route");

let ctx: DueContext;

/** A stored calendar date `days` from the household's today. */
function day(days: number): Date {
  return new Date(`${addDays(ctx.today, days)}T00:00:00.000Z`);
}

type ContractFixture = {
  title: string;
  endIn: number;
  renewalType?: "MANUAL_RENEWAL" | "FIXED_TERM" | "AUTO_RENEW";
  noticePeriodDays?: number;
  reminderDaysBefore?: string;
  status?: "ACTIVE" | "CANCELLED";
  /** The state every screen should show, or null for "has no Due entry at all". */
  state: DueState | null;
};

const CONTRACTS: ContractFixture[] = [
  { title: "Manual, past end", endIn: -3, state: "overdue" },
  { title: "Manual, ends today", endIn: 0, state: "due-soon" },
  { title: "Manual, inside its own 60-day window", endIn: 50, reminderDaysBefore: "60", state: "due-soon" },
  { title: "Manual, outside the default window", endIn: 50, state: "later" },
  { title: "Fixed term, past end", endIn: -3, renewalType: "FIXED_TERM", state: "ended" },
  { title: "Auto-renew, past end", endIn: -3, renewalType: "AUTO_RENEW", state: "needs-new-end-date" },
  { title: "Auto-renew, notice soon", endIn: 40, renewalType: "AUTO_RENEW", noticePeriodDays: 30, state: "due-soon" },
  { title: "Auto-renew, ends soon", endIn: 5, renewalType: "AUTO_RENEW", state: "later" },
  { title: "Cancelled, ends soon", endIn: 5, status: "CANCELLED", state: null },
];

const WARRANTIES: { description: string; endIn: number; state: DueState }[] = [
  { description: "Lapsed warranty", endIn: -1, state: "lapsed" },
  { description: "Warranty ending soon", endIn: 10, state: "due-soon" },
  { description: "Warranty ending later", endIn: 100, state: "later" },
];

beforeAll(async () => {
  ctx = await getDueContext();
  const { id: createdById } = await createTestUser();
  await setModuleEnabled("VEHICLES", true);
  for (const c of CONTRACTS) {
    await db.prisma.contract.create({
      data: {
        title: c.title,
        category: "OTHER",
        provider: "Provider",
        createdById,
        endDate: day(c.endIn),
        renewalType: c.renewalType ?? "MANUAL_RENEWAL",
        noticePeriodDays: c.noticePeriodDays ?? null,
        reminderDaysBefore: c.reminderDaysBefore ?? null,
        status: c.status ?? "ACTIVE",
      },
    });
  }
  for (const w of WARRANTIES) {
    await db.prisma.product.create({ data: { description: w.description, createdById, warrantyEndDate: day(w.endIn) } });
  }
  await db.prisma.vehicle.create({
    data: { label: "Car", createdById, regoExpiry: day(-2), insuranceExpiry: day(200), nextServiceDue: day(5) },
  });
}, 120_000);

async function searchTitles(group: string, due: "soon" | "overdue" | "lapsed"): Promise<string[]> {
  const res = await GET(new NextRequest(`http://localhost/api/search?due=${due}`));
  const body = (await res.json()) as { groups: Record<string, { title: string }[]> };
  return (body.groups[group] ?? []).map((r) => r.title).sort();
}

const titlesWith = (states: DueState[]) =>
  CONTRACTS.filter((c) => c.state && states.includes(c.state))
    .map((c) => c.title)
    .sort();

describe("Contracts show one state everywhere", () => {
  it("each card's badge and banner show the expected state", async () => {
    const rows = await db.prisma.contract.findMany();
    for (const row of rows) {
      const expected = CONTRACTS.find((c) => c.title === row.title)!.state;
      const entries = contractDue(row, ctx);
      expect(headlineEntry(entries)?.state ?? null, row.title).toBe(expected);
      const banner = bannerEntries(entries).map((e) => e.state);
      const bannerExpected = expected && ["overdue", "due-soon", "needs-new-end-date"].includes(expected) ? [expected] : [];
      expect(banner, row.title).toEqual(bannerExpected);
    }
  });

  it("the list filters, their counts, Search and the dashboard agree", async () => {
    const all = await db.prisma.contract.findMany({ include: { _count: { select: { documents: true } } } });
    const list = async (due: "soon" | "overdue") => {
      const f = contractDueFilter(due, ctx);
      return (await db.prisma.contract.findMany({ where: f.where })).filter(f.matches).map((r) => r.title).sort();
    };
    const attention = buildContractAttentionItems(all, ctx);
    const dashboard = (states: DueState[]) =>
      attention.filter((i) => i.entry && states.includes(i.entry.state)).map((i) => i.title).sort();

    const soon = titlesWith(["due-soon"]);
    const overdue = titlesWith(["overdue"]);
    expect(await list("soon")).toEqual(soon);
    expect(await searchTitles("Contracts", "soon")).toEqual(soon);
    expect(dashboard(["due-soon"])).toEqual(soon);

    expect(await list("overdue")).toEqual(overdue);
    expect(await searchTitles("Contracts", "overdue")).toEqual(overdue);
    expect(dashboard(["overdue"])).toEqual(overdue);

    expect(await contractDueCounts(ctx)).toEqual({ dueSoon: soon.length, overdue: overdue.length });

    // The auto-renewing Contract past its end date is Housekeeping, nowhere Due.
    const housekeeping = attention.filter((i) => i.group === "housekeeping").map((i) => i.title);
    expect(housekeeping).toEqual(titlesWith(["needs-new-end-date"]));
    expect(attention.filter((i) => i.group === "due").map((i) => i.title).sort()).toEqual(titlesWith(["due-soon", "overdue"]));
  });

  it("Upcoming shows only what's ahead, in the same state, and never Cancelled Contracts", async () => {
    const events = await getCalendarEvents(new Set(["VEHICLES"]), ctx, addDays(ctx.today, 90));
    const contractEvents = events.filter((e) => e.kind === "contract" && e.entry);
    for (const event of contractEvents) {
      const expected = CONTRACTS.find((c) => c.title === event.title)!.state;
      expect(event.entry!.state, event.title).toBe(expected);
    }
    expect(contractEvents.map((e) => e.title).sort()).toEqual(titlesWith(["due-soon", "later"]));
    expect(events.every((e) => e.date >= ctx.today)).toBe(true);
    expect(events.some((e) => e.title === "Cancelled, ends soon")).toBe(false);
  });
});

describe("Warranties show one state everywhere", () => {
  it("lists, counts, Search, the dashboard, Upcoming and banners agree", async () => {
    const all = await db.prisma.product.findMany({ include: { _count: { select: { documents: true } } } });
    for (const row of all) {
      const expected = WARRANTIES.find((w) => w.description === row.description)!.state;
      expect(headlineEntry(warrantyDue(row, ctx))?.state, row.description).toBe(expected);
    }
    const soon = WARRANTIES.filter((w) => w.state === "due-soon").map((w) => w.description);
    const lapsed = WARRANTIES.filter((w) => w.state === "lapsed").map((w) => w.description);

    const f = warrantyDueFilter("soon", ctx);
    expect((await db.prisma.product.findMany({ where: f.where })).filter(f.matches).map((r) => r.description)).toEqual(soon);
    expect(await searchTitles("Products", "soon")).toEqual(soon);
    // A Lapsed Warranty is never Due, so `?due=overdue` never selects one;
    // the Warranties list's Lapsed chip is `?due=lapsed`.
    expect(await searchTitles("Products", "overdue")).toEqual([]);
    expect(await searchTitles("Products", "lapsed")).toEqual(lapsed);
    const lapsedFilter = warrantyDueFilter("lapsed", ctx);
    expect(
      (await db.prisma.product.findMany({ where: lapsedFilter.where })).filter(lapsedFilter.matches).map((r) => r.description),
    ).toEqual(lapsed);
    expect(await warrantyDueCounts(ctx)).toEqual({ dueSoon: soon.length, lapsed: lapsed.length });

    // Lapsed Warranties leave Needs attention.
    expect(buildWarrantyAttentionItems(all, ctx).map((i) => i.title)).toEqual(soon);

    const events = await getCalendarEvents(new Set(), ctx, addDays(ctx.today, 30));
    expect(events.filter((e) => e.kind === "warranty").map((e) => [e.title, e.entry?.state])).toEqual([
      ["Warranty ending soon", "due-soon"],
    ]);
  });
});

describe("A Vehicle's Due entries show one state each, everywhere", () => {
  it("lists, Search, the dashboard, Upcoming and the banner agree", async () => {
    const [vehicle] = await db.prisma.vehicle.findMany();
    const states = Object.fromEntries(vehicleDue(vehicle, ctx).map((e) => [e.field, e.state]));
    expect(states).toEqual({ regoExpiry: "overdue", nextServiceDue: "due-soon", insuranceExpiry: "later" });

    expect(bannerEntries(vehicleDue(vehicle, ctx)).map((e) => [e.field, e.state])).toEqual([
      ["regoExpiry", "overdue"],
      ["nextServiceDue", "due-soon"],
    ]);
    expect(buildVehicleAttentionItems([vehicle], ctx).map((i) => [i.entry?.field, i.entry?.state])).toEqual([
      ["regoExpiry", "overdue"],
      ["nextServiceDue", "due-soon"],
    ]);
    for (const due of ["soon", "overdue"] as const) {
      const f = vehicleDueFilter(due, ctx);
      expect((await db.prisma.vehicle.findMany({ where: f.where })).filter(f.matches)).toHaveLength(1);
      expect(await searchTitles("Vehicles", due)).toEqual(["Car"]);
    }

    const events = await getCalendarEvents(new Set(["VEHICLES"]), ctx, addDays(ctx.today, 30));
    expect(events.filter((e) => e.kind === "vehicle").map((e) => [e.entry?.field, e.entry?.state])).toEqual([
      ["nextServiceDue", "due-soon"],
    ]);
  });
});
