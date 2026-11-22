import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, createTestUser, setModuleEnabled } from "../helpers/testDb";
import { loadDueRecord, loadDueRecords, type LoadedDueRecord } from "@/lib/loadDueRecords";
import { reminderPlan } from "@/lib/notifications/reminderSchedule";
import { plannedReminderRecords } from "@/lib/notifications/reminderRecords";
import type { DueContext } from "@/lib/duePolicy";

// #674 — the one loader every Due caller reads, against a real migrated
// database: what it leaves out (Trash, Archived, modules off, Cancelled,
// history), and what it hands the Due policy (Covers, Needs review).

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const db = setupTestDb();
let createdById: string;

const context: DueContext = { today: "2026-11-01", defaultReminderDays: "30,7" };
const day = (d: string) => new Date(`${d}T00:00:00Z`);

beforeEach(async () => {
  createdById = (await createTestUser()).id;
  await setModuleEnabled("VEHICLES", true);
  await setModuleEnabled("HOME", true);
});

function contract(data: Record<string, unknown> = {}) {
  return db.prisma.contract.create({
    data: {
      title: "Phone plan",
      category: "OTHER",
      provider: "Telco",
      createdById,
      endDate: day("2026-11-10"),
      renewalType: "MANUAL_RENEWAL",
      ...data,
    } as Parameters<typeof db.prisma.contract.create>[0]["data"],
  });
}

async function load(kinds?: LoadedDueRecord["kind"][]) {
  const { records } = await loadDueRecords({ context, kinds });
  return records;
}
const ids = (records: LoadedDueRecord[]) => records.map((r) => `${r.kind}:${r.id}`).sort();
const fields = (record: LoadedDueRecord | null | undefined) => record?.entries.map((e) => e.field) ?? [];

describe("loadDueRecords", () => {
  it("loads each kind as a Due record with its entries", async () => {
    const c = await contract();
    const p = await db.prisma.product.create({
      data: { description: "Fridge", createdById, warrantyEndDate: day("2026-11-20") },
    });
    const v = await db.prisma.vehicle.create({ data: { label: "Car", createdById, regoExpiry: day("2026-11-15") } });
    const property = await db.prisma.property.create({ data: { label: "Flat", createdById, isRented: true } });
    const t = await db.prisma.rentalAgreement.create({
      data: { propertyId: property.id, tenantName: "Sam", weeklyRent: 600, leaseEnd: day("2026-11-25") },
    });

    const records = await load();
    expect(ids(records)).toEqual(
      [`contract:${c.id}`, `warranty:${p.id}`, `vehicle:${v.id}`, `tenancy:${t.id}`].sort(),
    );
    const byKind = Object.fromEntries(records.map((r) => [r.kind, r]));
    expect(fields(byKind.contract)).toEqual(["endDate"]);
    expect(fields(byKind.warranty)).toEqual(["warrantyEndDate"]);
    expect(fields(byKind.vehicle)).toEqual(["regoExpiry"]);
    expect(fields(byKind.tenancy)).toEqual(["leaseEnd"]);
    expect(byKind.tenancy.ownerType).toBe("TENANCY");
    expect(byKind.tenancy.kind === "tenancy" && byKind.tenancy.row.propertyId).toBe(property.id);
  });

  it("loads only the kinds asked for", async () => {
    const c = await contract();
    await db.prisma.vehicle.create({ data: { label: "Car", createdById, regoExpiry: day("2026-11-15") } });
    expect(ids(await load(["contract"]))).toEqual([`contract:${c.id}`]);
  });

  it("leaves out records in Trash, Cancelled Contracts and Archived Vehicles and Properties", async () => {
    await contract({ deletedAt: new Date() });
    await contract({ status: "CANCELLED" });
    await db.prisma.product.create({
      data: { description: "Old TV", createdById, warrantyEndDate: day("2026-11-20"), deletedAt: new Date() },
    });
    await db.prisma.vehicle.create({
      data: { label: "Sold car", createdById, regoExpiry: day("2026-11-15"), archivedAt: new Date() },
    });
    await db.prisma.vehicle.create({
      data: { label: "Binned car", createdById, regoExpiry: day("2026-11-15"), deletedAt: new Date() },
    });
    const sold = await db.prisma.property.create({
      data: { label: "Sold flat", createdById, isRented: true, archivedAt: new Date() },
    });
    await db.prisma.rentalAgreement.create({
      data: { propertyId: sold.id, tenantName: "Sam", weeklyRent: 600, leaseEnd: day("2026-11-25") },
    });

    expect(await load()).toEqual([]);
  });

  it("leaves out Vehicles while Vehicles is off and Tenancies while Home is off", async () => {
    await db.prisma.vehicle.create({ data: { label: "Car", createdById, regoExpiry: day("2026-11-15") } });
    const property = await db.prisma.property.create({ data: { label: "Flat", createdById, isRented: true } });
    await db.prisma.rentalAgreement.create({
      data: { propertyId: property.id, tenantName: "Sam", weeklyRent: 600, leaseEnd: day("2026-11-25") },
    });
    await setModuleEnabled("VEHICLES", false);
    await setModuleEnabled("HOME", false);

    expect(await load()).toEqual([]);
  });

  it("keeps an auto-renewing Contract with no end date, ready for a Cost review (ADR 0005)", async () => {
    const c = await contract({ endDate: null, renewalType: "AUTO_RENEW", cost: 15, billingFrequency: "MONTHLY" });
    const [loaded] = await load(["contract"]);
    expect(loaded.id).toBe(c.id);
    expect(loaded.entries).toEqual([]);
  });

  it("leaves a Vehicle date out while a linked Contract Covers it", async () => {
    const v = await db.prisma.vehicle.create({
      data: { label: "Car", createdById, regoExpiry: day("2026-11-15"), insuranceExpiry: day("2026-11-12") },
    });
    await contract({ category: "CAR_INSURANCE", vehicleId: v.id, endDate: day("2026-11-12") });
    const vehicle = (await load(["vehicle"]))[0];
    expect(fields(vehicle)).toEqual(["regoExpiry"]);
  });

  it("leaves a Tenancy's lease end out while its linked Contract Covers it", async () => {
    const property = await db.prisma.property.create({ data: { label: "Flat", createdById, isRented: true } });
    const lease = await contract({ title: "Flat lease", endDate: day("2026-11-25") });
    await db.prisma.rentalAgreement.create({
      data: { propertyId: property.id, contractId: lease.id, tenantName: "Sam", weeklyRent: 600, leaseEnd: day("2026-11-25") },
    });
    const tenancy = (await load(["tenancy"]))[0];
    expect(tenancy.entries).toEqual([]);
  });

  it("carries Needs review into the record, so its Reminders are held", async () => {
    await contract({ extractionPending: true });
    const [loaded] = await load(["contract"]);
    expect(fields(loaded)).toEqual(["endDate"]);
    const plan = reminderPlan(loaded.record, context, []);
    expect(plan.held).toBe(true);
    expect(plan.entries).toEqual([]);
  });
});

describe("loadDueRecord", () => {
  it("returns an Archived Vehicle and a Cancelled Contract with no Due entries", async () => {
    const v = await db.prisma.vehicle.create({
      data: { label: "Sold car", createdById, regoExpiry: day("2026-11-15"), archivedAt: new Date() },
    });
    const c = await contract({ status: "CANCELLED" });

    const vehicle = (await loadDueRecord({ kind: "vehicle", id: v.id }, { context })).record;
    expect(vehicle?.id).toBe(v.id);
    expect(vehicle?.entries).toEqual([]);
    const cancelled = (await loadDueRecord({ kind: "contract", id: c.id }, { context })).record;
    expect(cancelled?.id).toBe(c.id);
    expect(cancelled?.entries).toEqual([]);
  });

  it("returns null in Trash, when missing, or with the module off", async () => {
    const binned = await contract({ deletedAt: new Date() });
    const v = await db.prisma.vehicle.create({ data: { label: "Car", createdById, regoExpiry: day("2026-11-15") } });

    expect((await loadDueRecord({ kind: "contract", id: binned.id }, { context })).record).toBeNull();
    expect((await loadDueRecord({ kind: "warranty", id: "missing" }, { context })).record).toBeNull();
    expect((await loadDueRecord({ kind: "vehicle", id: v.id }, { context })).record?.id).toBe(v.id);
    await setModuleEnabled("VEHICLES", false);
    expect((await loadDueRecord({ kind: "vehicle", id: v.id }, { context })).record).toBeNull();
  });

  it("returns a Tenancy only while it is its Property's current one", async () => {
    const property = await db.prisma.property.create({ data: { label: "Flat", createdById, isRented: true } });
    const old = await db.prisma.rentalAgreement.create({
      data: { propertyId: property.id, tenantName: "Ann", weeklyRent: 500, leaseStart: day("2025-01-01"), leaseEnd: day("2025-12-31") },
    });
    const current = await db.prisma.rentalAgreement.create({
      data: { propertyId: property.id, tenantName: "Sam", weeklyRent: 600, leaseStart: day("2026-01-01"), leaseEnd: day("2026-11-25") },
    });

    expect((await loadDueRecord({ kind: "tenancy", id: current.id }, { context })).record?.id).toBe(current.id);
    expect((await loadDueRecord({ kind: "tenancy", id: old.id }, { context })).record).toBeNull();
  });

  it("hands back the context it used", async () => {
    const c = await contract();
    expect((await loadDueRecord({ kind: "contract", id: c.id }, { context })).context).toBe(context);
  });
});

describe("Reminders with the Vehicles module off (#674)", () => {
  it("plans no Vehicle Reminders", async () => {
    await db.prisma.vehicle.create({ data: { label: "Car", createdById, regoExpiry: day("2026-11-05") } });
    await setModuleEnabled("VEHICLES", false);
    const planned = await plannedReminderRecords(context);
    expect(planned.map((p) => p.ownerType)).not.toContain("VEHICLE");
  });
});
