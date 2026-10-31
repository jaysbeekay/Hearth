import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { setupTestDb, createTestUser, setModuleEnabled } from "../helpers/testDb";
import { auth } from "@/lib/auth";
import { hashToken } from "@/lib/crypto";
import {
  createVehicleCommand,
  archiveVehicleCommand,
} from "@/lib/commands/vehicles";
import {
  createPropertyCommand,
  createTenancyCommand,
  archivePropertyCommand,
  unarchivePropertyCommand,
  deletePropertyCommand,
  restorePropertyCommand,
  createPropertyValuationCommand,
} from "@/lib/commands/home";
import { archiveVehicle, unarchiveVehicle } from "@/lib/actions/vehicles";
import { archiveProperty } from "@/lib/actions/home";
import { propertySchema, rentalAgreementSchema } from "@/lib/validation/home";
import { getCurrentTenancies } from "@/lib/tenancies";
import { getNetWorth } from "@/lib/wealth";
import { GET as icalFeed } from "@/app/api/ical/route";
import type { ModuleKey } from "@/lib/modules/registry";

// #355 — the places an Archived Vehicle or Property must stay out of, beyond
// the commands and the scheduler (archive.test.ts): the iCal feed, net worth
// and the Wealth warning, a Property in Trash, and a READONLY member.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), notFound: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
// No network: a currency other than the net-worth one simply has no rate.
vi.mock("@/lib/fx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/fx")>();
  return { ...actual, refreshFxRates: vi.fn(async () => undefined), getFxRateMap: vi.fn(async () => new Map()) };
});

const db = setupTestDb();
let actorId: string;

beforeEach(async () => {
  vi.clearAllMocks();
  actorId = (await createTestUser()).id;
  vi.mocked(auth).mockResolvedValue({ user: { id: actorId, role: "MEMBER" } } as never);
  await setModuleEnabled("VEHICLES", true);
  await setModuleEnabled("HOME", true);
  await db.prisma.appSetting.create({ data: { key: "household.timezone", value: "UTC", updatedAt: new Date() } });
});

function daysFromNow(n: number) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

async function rentedProperty(label: string, leaseEndInDays: number) {
  const property = await createPropertyCommand(propertySchema.parse({ label, occupancyStatus: "RENTED" }), actorId);
  const tenancy = await createTenancyCommand(
    property.id,
    rentalAgreementSchema.parse({
      weeklyRent: 500,
      tenantName: "Sam Lee",
      leaseEnd: daysFromNow(leaseEndInDays).toISOString().slice(0, 10),
    }),
    actorId,
  );
  return { property, tenancy };
}

describe("the iCal feed", () => {
  it("leaves out an Archived Vehicle's dates and an Archived Property's lease end", async () => {
    await db.prisma.user.update({ where: { id: actorId }, data: { icalTokenHash: hashToken("ical-test-token") } });
    const kept = await createVehicleCommand({ label: "Daily car", regoExpiry: daysFromNow(20) }, actorId);
    const sold = await createVehicleCommand({ label: "Sold car", regoExpiry: daysFromNow(20) }, actorId);
    await rentedProperty("Kept flat", 40);
    const soldFlat = await rentedProperty("Sold flat", 40);

    const feed = async () => {
      const res = await icalFeed(new NextRequest("http://localhost/api/ical?token=ical-test-token"));
      expect(res.status).toBe(200);
      return res.text();
    };
    const before = await feed();
    for (const text of ["Daily car rego expires", "Sold car rego expires", "Kept flat lease ends", "Sold flat lease ends"]) {
      expect(before).toContain(text);
    }

    await archiveVehicleCommand(sold.id, actorId);
    await archivePropertyCommand(soldFlat.property.id, actorId);
    const after = await feed();
    expect(after).toContain("Daily car rego expires");
    expect(after).toContain("Kept flat lease ends");
    expect(after).not.toContain("Sold car");
    expect(after).not.toContain("Sold flat");
    expect(kept.id).toBeTruthy();
  });
});

describe("net worth", () => {
  const modules = new Set<ModuleKey>(["HOME", "WEALTH"]);

  it("leaves out an Archived Property's valuation, its missing exchange rate and its stale warning", async () => {
    const active = await createPropertyCommand(propertySchema.parse({ label: "Kept house" }), actorId);
    await createPropertyValuationCommand(active.id, { value: 800_000, currency: "AUD", valuedAt: new Date() } as never);
    // Sold: a valuation in a currency with no rate, and it is a year old.
    const sold = await createPropertyCommand(propertySchema.parse({ label: "Sold house" }), actorId);
    await createPropertyValuationCommand(sold.id, {
      value: 500_000,
      currency: "ZZZ",
      valuedAt: new Date(Date.now() - 2 * 365 * 86_400_000),
    } as never);

    const before = await getNetWorth(modules);
    expect(before.excluded.properties).toBe(1);
    expect(before.propertyStale).toBe(true);

    await archivePropertyCommand(sold.id, actorId);
    const after = await getNetWorth(modules);
    expect(after.propertyValue).toBe(800_000);
    expect(after.excluded.properties).toBe(0);
    // The Wealth page's "valuation is out of date" warning follows propertyStale.
    expect(after.propertyStale).toBe(false);

    await unarchivePropertyCommand(sold.id, actorId);
    expect((await getNetWorth(modules)).excluded.properties).toBe(1);
  });
});

describe("an Archived Property in Trash", () => {
  it("stays out of Reminders through a Trash round trip, and only an unarchive brings its Tenancy back", async () => {
    const { property } = await rentedProperty("Sold flat", 40);
    await archivePropertyCommand(property.id, actorId);
    await deletePropertyCommand(property.id);
    expect(await getCurrentTenancies()).toEqual([]);

    await restorePropertyCommand(property.id);
    expect(await getCurrentTenancies()).toEqual([]);

    await unarchivePropertyCommand(property.id, actorId);
    expect((await getCurrentTenancies()).map((t) => t.propertyLabel)).toEqual(["Sold flat"]);
  });
});

describe("a READONLY member", () => {
  it("can't archive or restore a Vehicle or Property", async () => {
    const vehicle = await createVehicleCommand({ label: "Old ute" }, actorId);
    const property = await createPropertyCommand(propertySchema.parse({ label: "Flat" }), actorId);
    vi.mocked(auth).mockResolvedValue({ user: { id: actorId, role: "READONLY" } } as never);

    await expect(archiveVehicle(vehicle.id)).rejects.toThrow("read-only access");
    await expect(unarchiveVehicle(vehicle.id)).rejects.toThrow("read-only access");
    await expect(archiveProperty(property.id)).rejects.toThrow("read-only access");
    expect((await db.prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).archivedAt).toBeNull();
    expect((await db.prisma.property.findUniqueOrThrow({ where: { id: property.id } })).archivedAt).toBeNull();
  });
});
