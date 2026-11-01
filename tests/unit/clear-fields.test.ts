// #413: clearing an optional field on an edit form clears it. Every record
// type's full-form update, online (the server action) and offline (the sync
// handler), turns a submitted-but-blank field into null; partial patches
// still leave untouched fields alone. Also covers the atomic stale-edit
// check and the purge order, from the same issue.
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, createTestUser, setModuleEnabled } from "../helpers/testDb";
import { auth } from "@/lib/auth";
import { clearNotificationLogs } from "@/lib/notifications/logs";
import { ENTITY_SYNC_CONFIGS, parseSyncFormValues } from "@/app/api/sync/entityHandlers";
import { updateContract } from "@/lib/actions/contracts";
import { updateProduct } from "@/lib/actions/products";
import { updateVehicle, updateVehicleItem } from "@/lib/actions/vehicles";
import { updateTrip, updateTripSegment } from "@/lib/actions/trips";
import {
  updateProperty,
  updateHomeItem,
  updateRentalAgreement,
  updateRentalStatement,
} from "@/lib/actions/home";
import { updateInventoryItem } from "@/lib/actions/inventory";
import { updatePortfolio, updateHolding, updateTrade } from "@/lib/actions/wealth";
import { updateContractCommand, purgeContract } from "@/lib/commands/contracts";
import { purgeProduct } from "@/lib/commands/products";
import { updateVehicleCommand, permanentlyDeleteVehicleCommand } from "@/lib/commands/vehicles";
import { RecordNotFoundError, StaleEditError } from "@/lib/commands/shared";
import { fullFormUpdate } from "@/lib/validation/fullFormUpdate";
import { contractSchema } from "@/lib/validation/contract";
import EditInventoryItemPage from "@/app/(app)/inventory/[id]/edit/page";
import { InventoryItemForm } from "@/components/InventoryItemForm";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
// The actions redirect() after a successful save; a no-op lets them return.
vi.mock("next/navigation", () => ({ redirect: vi.fn(), notFound: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/notifications/logs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notifications/logs")>();
  return { ...actual, clearNotificationLogs: vi.fn(actual.clearNotificationLogs) };
});

const db = setupTestDb();
const p = db.prisma;

let actorId: string;

beforeEach(async () => {
  vi.clearAllMocks();
  actorId = (await createTestUser()).id;
  vi.mocked(auth).mockResolvedValue({ user: { id: actorId, role: "MEMBER" } } as never);
  for (const key of ["TRAVEL", "HOME", "VEHICLES", "INVENTORY", "WEALTH"] as const) {
    await setModuleEnabled(key, true);
  }
});

function formData(values: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.append(key, value);
  return fd;
}

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

interface Seeded {
  id: string;
  parentId?: string;
}

interface ClearCase {
  name: string;
  entity: string;
  seed: () => Promise<Seeded>;
  // The edit form's full submission, with the fields being cleared sent as "".
  form: (seeded: Seeded) => Record<string, string>;
  action: (seeded: Seeded, fd: FormData) => Promise<unknown>;
  read: (id: string) => Promise<Record<string, unknown>>;
  cleared: string[];
  kept: Record<string, unknown>;
}

async function seedProperty() {
  return p.property.create({ data: { label: "12 Main St", street: "12 Main St", notes: "Corner block", createdById: actorId } });
}

async function seedHolding() {
  const portfolio = await p.portfolio.create({ data: { name: "Shares", createdById: actorId } });
  return p.holding.create({ data: { portfolioId: portfolio.id, ticker: "VAS", name: "Vanguard", exchange: "ASX" } });
}

const cases: ClearCase[] = [
  {
    name: "Contract",
    entity: "contract",
    seed: async () => {
      const property = await seedProperty();
      const vehicle = await p.vehicle.create({ data: { label: "Hatch", createdById: actorId } });
      const c = await p.contract.create({
        data: {
          title: "Internet",
          category: "TELECOM",
          provider: "Telco",
          renewalType: "AUTO_RENEW",
          contractNumber: "C-1",
          endDate: day("2027-01-01"),
          cost: 80,
          billingFrequency: "MONTHLY",
          notes: "Old notes",
          reminderDaysBefore: "30,7",
          propertyId: property.id,
          vehicleId: vehicle.id,
          createdById: actorId,
        },
      });
      return { id: c.id };
    },
    form: () => ({
      title: "Internet",
      category: "TELECOM",
      provider: "Telco",
      contractNumber: "",
      startDate: "",
      endDate: "",
      renewalType: "AUTO_RENEW",
      noticePeriodDays: "",
      cost: "",
      currency: "AUD",
      billingFrequency: "",
      status: "ACTIVE",
      contactName: "",
      contactPhone: "",
      contactEmail: "",
      notes: "",
      reminderDaysBefore: "",
      // LinkedToField's hidden inputs, as the form posts them with both the
      // Home and Vehicles modules on and "Nothing" chosen.
      propertyId: "",
      vehicleId: "",
    }),
    action: ({ id }, fd) => updateContract(id, null, fd),
    read: (id) => p.contract.findUniqueOrThrow({ where: { id } }),
    cleared: ["contractNumber", "endDate", "cost", "billingFrequency", "notes", "reminderDaysBefore", "propertyId", "vehicleId"],
    kept: { title: "Internet", provider: "Telco" },
  },
  {
    name: "Product",
    entity: "product",
    seed: async () => {
      const product = await p.product.create({
        data: {
          description: "Fridge",
          manufacturer: "Acme",
          warrantyEndDate: day("2028-05-01"),
          price: 1200,
          notes: "Kitchen",
          reminderDaysBefore: "30",
          createdById: actorId,
        },
      });
      return { id: product.id };
    },
    form: () => ({
      description: "Fridge",
      manufacturer: "Acme",
      model: "",
      vendor: "",
      serialNumber: "",
      barcode: "",
      purchaseDate: "",
      warrantyEndDate: "",
      price: "",
      currency: "AUD",
      notes: "",
      reminderDaysBefore: "",
      propertyId: "",
    }),
    action: ({ id }, fd) => updateProduct(id, null, fd),
    read: (id) => p.product.findUniqueOrThrow({ where: { id } }),
    cleared: ["warrantyEndDate", "price", "notes", "reminderDaysBefore"],
    kept: { description: "Fridge", manufacturer: "Acme" },
  },
  {
    name: "Vehicle",
    entity: "vehicle",
    seed: async () => {
      const v = await p.vehicle.create({
        data: {
          label: "Family car",
          make: "Toyota",
          licensePlate: "ABC123",
          regoExpiry: day("2027-03-01"),
          reminderDaysBefore: "14",
          createdById: actorId,
        },
      });
      return { id: v.id };
    },
    form: () => ({
      label: "Family car",
      make: "Toyota",
      model: "",
      year: "",
      colour: "",
      licensePlate: "",
      vin: "",
      regoExpiry: "",
      insuranceExpiry: "",
      nextServiceDue: "",
      reminderDaysBefore: "",
      notes: "",
    }),
    action: ({ id }, fd) => updateVehicle(id, null, fd),
    read: (id) => p.vehicle.findUniqueOrThrow({ where: { id } }),
    cleared: ["licensePlate", "regoExpiry", "reminderDaysBefore"],
    kept: { label: "Family car", make: "Toyota" },
  },
  {
    name: "Service record",
    entity: "vehicleItem",
    seed: async () => {
      const v = await p.vehicle.create({ data: { label: "Ute", createdById: actorId } });
      const item = await p.vehicleItem.create({
        data: { vehicleId: v.id, type: "SERVICE", title: "Oil change", provider: "Garage", date: day("2026-01-10"), cost: 250 },
      });
      return { id: item.id, parentId: v.id };
    },
    form: () => ({ type: "SERVICE", title: "Oil change", provider: "", date: "", cost: "", currency: "AUD", notes: "" }),
    action: ({ id, parentId }, fd) => updateVehicleItem(parentId!, id, null, fd),
    read: (id) => p.vehicleItem.findUniqueOrThrow({ where: { id } }),
    cleared: ["provider", "date", "cost"],
    kept: { title: "Oil change" },
  },
  {
    name: "Property",
    entity: "property",
    seed: async () => ({ id: (await seedProperty()).id }),
    form: () => ({
      label: "12 Main St",
      street: "",
      suburb: "",
      state: "",
      postcode: "",
      country: "",
      lat: "",
      lng: "",
      notes: "",
      occupancyStatus: "OWNER_OCCUPIED",
    }),
    action: ({ id }, fd) => updateProperty(id, null, fd),
    read: (id) => p.property.findUniqueOrThrow({ where: { id } }),
    cleared: ["street", "notes"],
    kept: { label: "12 Main St" },
  },
  {
    name: "Maintenance record",
    entity: "homeItem",
    seed: async () => {
      const property = await seedProperty();
      const item = await p.homeItem.create({
        data: { propertyId: property.id, type: "MAINTENANCE", title: "Gutters", provider: "Gutter Co", cost: 300 },
      });
      return { id: item.id, parentId: property.id };
    },
    form: () => ({ type: "MAINTENANCE", title: "Gutters", provider: "", date: "", cost: "", currency: "AUD", notes: "" }),
    action: ({ id, parentId }, fd) => updateHomeItem(parentId!, id, null, fd),
    read: (id) => p.homeItem.findUniqueOrThrow({ where: { id } }),
    cleared: ["provider", "cost"],
    kept: { title: "Gutters" },
  },
  {
    name: "Tenancy",
    entity: "rentalAgreement",
    seed: async () => {
      const property = await seedProperty();
      const agreement = await p.rentalAgreement.create({
        data: { propertyId: property.id, weeklyRent: 600, tenantName: "Sam", leaseEnd: day("2027-06-30"), bondAmount: 2400 },
      });
      return { id: agreement.id, parentId: property.id };
    },
    form: () => ({
      tenantName: "",
      weeklyRent: "600",
      managementFeePercent: "",
      leaseStart: "",
      leaseEnd: "",
      bondAmount: "",
      currency: "AUD",
      notes: "",
    }),
    action: ({ id, parentId }, fd) => updateRentalAgreement(parentId!, id, null, fd),
    read: (id) => p.rentalAgreement.findUniqueOrThrow({ where: { id } }),
    cleared: ["tenantName", "leaseEnd", "bondAmount"],
    kept: { weeklyRent: 600 },
  },
  {
    name: "Rental statement",
    entity: "rentalStatement",
    seed: async () => {
      const property = await seedProperty();
      const statement = await p.rentalStatement.create({
        data: { propertyId: property.id, periodEnd: day("2026-03-31"), grossRent: 2600, notes: "March" },
      });
      return { id: statement.id, parentId: property.id };
    },
    form: () => ({
      periodStart: "",
      periodEnd: "",
      statementDate: "",
      grossRent: "",
      managementFee: "",
      otherDeductions: "",
      netAmount: "",
      currency: "AUD",
      notes: "",
    }),
    action: ({ id, parentId }, fd) => updateRentalStatement(parentId!, id, null, fd),
    read: (id) => p.rentalStatement.findUniqueOrThrow({ where: { id } }),
    cleared: ["periodEnd", "grossRent", "notes"],
    kept: { currency: "AUD" },
  },
  {
    name: "Trip",
    entity: "trip",
    seed: async () => {
      const trip = await p.trip.create({
        data: { title: "Japan", destination: "Tokyo", startDate: day("2027-04-01"), endDate: day("2027-04-14"), createdById: actorId },
      });
      return { id: trip.id };
    },
    form: () => ({ title: "Japan", destination: "", startDate: "2027-04-01", endDate: "", notes: "" }),
    action: ({ id }, fd) => updateTrip(id, null, fd),
    read: (id) => p.trip.findUniqueOrThrow({ where: { id } }),
    cleared: ["destination", "endDate"],
    kept: { title: "Japan", startDate: day("2027-04-01") },
  },
  {
    name: "Trip segment",
    entity: "tripSegment",
    seed: async () => {
      const trip = await p.trip.create({ data: { title: "Japan", createdById: actorId } });
      const segment = await p.tripSegment.create({
        data: { tripId: trip.id, type: "FLIGHT", title: "SYD-HND", confirmationCode: "XYZ", cost: 900, flightNumber: "QF25" },
      });
      return { id: segment.id, parentId: trip.id };
    },
    form: () => ({
      type: "FLIGHT",
      title: "SYD-HND",
      provider: "",
      confirmationCode: "",
      startDate: "",
      endDate: "",
      location: "",
      cost: "",
      currency: "AUD",
      notes: "",
      flightNumber: "",
      departureIata: "",
      arrivalIata: "",
    }),
    action: ({ id, parentId }, fd) => updateTripSegment(parentId!, id, null, fd),
    read: (id) => p.tripSegment.findUniqueOrThrow({ where: { id } }),
    cleared: ["confirmationCode", "cost", "flightNumber"],
    kept: { title: "SYD-HND" },
  },
  {
    name: "Inventory item",
    entity: "inventoryItem",
    seed: async () => {
      const warranty = await p.product.create({ data: { description: "TV warranty", createdById: actorId } });
      const item = await p.inventoryItem.create({
        data: { label: "TV", location: "Lounge", purchasePrice: 1500, warrantyProductId: warranty.id, createdById: actorId },
      });
      return { id: item.id };
    },
    form: () => ({
      label: "TV",
      category: "ELECTRONICS",
      brand: "",
      model: "",
      serialNumber: "",
      purchaseDate: "",
      purchasePrice: "",
      currency: "AUD",
      location: "",
      notes: "",
      warrantyProductId: "",
    }),
    action: ({ id }, fd) => updateInventoryItem(id, null, fd),
    read: (id) => p.inventoryItem.findUniqueOrThrow({ where: { id } }),
    cleared: ["location", "purchasePrice", "warrantyProductId"],
    kept: { label: "TV" },
  },
  {
    name: "Portfolio",
    entity: "portfolio",
    seed: async () => {
      const portfolio = await p.portfolio.create({ data: { name: "Super", description: "Retirement", createdById: actorId } });
      return { id: portfolio.id };
    },
    form: () => ({ name: "Super", description: "", currency: "AUD", costMethod: "FIFO" }),
    action: ({ id }, fd) => updatePortfolio(id, null, fd),
    read: (id) => p.portfolio.findUniqueOrThrow({ where: { id } }),
    cleared: ["description"],
    kept: { name: "Super" },
  },
  {
    name: "Holding",
    entity: "holding",
    seed: async () => {
      const holding = await seedHolding();
      return { id: holding.id, parentId: holding.portfolioId };
    },
    form: () => ({ ticker: "VAS", name: "", assetClass: "ETF", exchange: "" }),
    action: ({ id, parentId }, fd) => updateHolding(parentId!, id, null, fd),
    read: (id) => p.holding.findUniqueOrThrow({ where: { id } }),
    cleared: ["name", "exchange"],
    kept: { ticker: "VAS" },
  },
  {
    name: "Trade",
    entity: "trade",
    seed: async () => {
      const holding = await seedHolding();
      const trade = await p.trade.create({
        data: { holdingId: holding.id, type: "BUY", date: day("2026-02-01"), units: 10, pricePerUnit: 100, fees: 9.5, fxRate: 1.5, notes: "First buy" },
      });
      return { id: trade.id, parentId: holding.id };
    },
    form: () => ({
      type: "BUY",
      date: "2026-02-01",
      units: "10",
      pricePerUnit: "100",
      fees: "",
      currency: "AUD",
      fxRate: "",
      notes: "",
    }),
    action: ({ id, parentId }, fd) => updateTrade(parentId!, id, null, fd),
    read: (id) => p.trade.findUniqueOrThrow({ where: { id } }),
    cleared: ["fees", "fxRate", "notes"],
    kept: { units: 10, pricePerUnit: 100 },
  },
];

async function expectCleared(c: ClearCase, id: string) {
  const row = await c.read(id);
  for (const field of c.cleared) {
    expect({ field, value: new Map(Object.entries(row)).get(field) }).toEqual({ field, value: null });
  }
  expect(row).toMatchObject(c.kept);
}

describe.each(cases)("clearing fields on a $name", (c) => {
  it("clears blanked fields through the edit form's server action", async () => {
    const seeded = await c.seed();
    const result = await c.action(seeded, formData(c.form(seeded)));
    expect(result).toBeUndefined(); // undefined = redirected after a successful save
    await expectCleared(c, seeded.id);
  });

  it("clears blanked fields through an offline sync update", async () => {
    const seeded = await c.seed();
    const config = new Map(Object.entries(ENTITY_SYNC_CONFIGS)).get(c.entity)!;
    const data = parseSyncFormValues(config, "update", c.form(seeded));
    await config.update!(seeded.id, data, { userId: actorId, parentId: seeded.parentId });
    await expectCleared(c, seeded.id);
  });
});

describe("full-form updates vs partial patches", () => {
  async function seedContract() {
    return p.contract.create({
      data: {
        title: "Insurance",
        category: "CAR_INSURANCE",
        provider: "Insurer",
        renewalType: "MANUAL_RENEWAL",
        endDate: day("2027-01-01"),
        cost: 1000,
        notes: "Keep",
        createdById: actorId,
      },
    });
  }

  it("a partial patch leaves fields it doesn't name, or names as undefined, alone", async () => {
    const contract = await seedContract();
    await updateContractCommand(contract.id, { notes: "Changed", endDate: undefined }, actorId);
    const row = await p.contract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(row).toMatchObject({ notes: "Changed", endDate: day("2027-01-01"), cost: 1000 });
  });

  it("leaves a field alone when the form didn't render it at all", async () => {
    const property = await seedProperty();
    const vehicle = await p.vehicle.create({ data: { label: "Car", createdById: actorId } });
    const contract = await p.contract.create({
      data: {
        title: "Rego",
        category: "OTHER",
        provider: "Roads",
        renewalType: "MANUAL_RENEWAL",
        propertyId: property.id,
        vehicleId: vehicle.id,
        createdById: actorId,
      },
    });
    // With the Vehicles module off, the form has no vehicleId input.
    const fd = formData({ title: "Rego", category: "OTHER", provider: "Roads", renewalType: "MANUAL_RENEWAL", propertyId: "" });
    await updateContract(contract.id, null, fd);
    const row = await p.contract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(row.propertyId).toBeNull();
    expect(row.vehicleId).toBe(vehicle.id);
  });

  it("a blank cost clears to null, not 0, and a bad value is still rejected", async () => {
    const contract = await seedContract();
    const base = { title: "Insurance", category: "CAR_INSURANCE", provider: "Insurer", renewalType: "MANUAL_RENEWAL" };
    expect(await updateContract(contract.id, null, formData({ ...base, cost: "-5" }))).toMatchObject({
      error: expect.any(String),
    });
    expect((await p.contract.findUniqueOrThrow({ where: { id: contract.id } })).cost).toBe(1000);
    await updateContract(contract.id, null, formData({ ...base, cost: "" }));
    expect((await p.contract.findUniqueOrThrow({ where: { id: contract.id } })).cost).toBeNull();
  });

  it("a required field submitted blank is still rejected", async () => {
    const contract = await seedContract();
    const result = await updateContract(
      contract.id,
      null,
      formData({ title: "", category: "CAR_INSURANCE", provider: "Insurer", renewalType: "MANUAL_RENEWAL" }),
    );
    expect(result).toMatchObject({ error: "Title is required" });
    expect((await p.contract.findUniqueOrThrow({ where: { id: contract.id } })).title).toBe("Insurance");
  });

  it("fullFormUpdate only nulls schema fields the submission carried", () => {
    const parsed = contractSchema.parse({ title: "T", category: "OTHER", provider: "P", renewalType: "FIXED_TERM", notes: "" });
    const patch = fullFormUpdate(contractSchema, parsed, { title: "T", notes: "", file: "", endDate: "" });
    expect(patch).toMatchObject({ title: "T", notes: null, endDate: null });
    expect(Object.keys(patch)).not.toContain("file");
    expect(Object.keys(patch)).not.toContain("vehicleId");
  });
});

describe("atomic stale-edit check", () => {
  it("of two concurrent edits from the same base, one wins and the other is stale", async () => {
    const vehicle = await p.vehicle.create({ data: { label: "Car", createdById: actorId } });
    const base = vehicle.updatedAt.toISOString();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const results = await Promise.allSettled([
      updateVehicleCommand(vehicle.id, { colour: "Red" }, actorId, { baseUpdatedAt: base }),
      updateVehicleCommand(vehicle.id, { colour: "Blue" }, actorId, { baseUpdatedAt: base }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(StaleEditError);
    const winner = results[0].status === "fulfilled" ? "Red" : "Blue";
    expect((await p.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).colour).toBe(winner);
  });

  it("applies to the sync handlers that write directly too", async () => {
    const trip = await p.trip.create({ data: { title: "Trip", createdById: actorId } });
    const base = trip.updatedAt.toISOString();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const update = ENTITY_SYNC_CONFIGS.trip.update!;
    const results = await Promise.allSettled([
      update(trip.id, { title: "One" }, { userId: actorId, baseUpdatedAt: base }),
      update(trip.id, { title: "Two" }, { userId: actorId, baseUpdatedAt: base }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected?.reason).toBeInstanceOf(StaleEditError);
  });

  it("a Contract edit from an old base is refused through the sync command path", async () => {
    const contract = await p.contract.create({
      data: { title: "C", category: "OTHER", provider: "P", renewalType: "FIXED_TERM", createdById: actorId },
    });
    const base = contract.updatedAt.toISOString();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await updateContractCommand(contract.id, { notes: "Elsewhere" }, actorId);
    await expect(
      ENTITY_SYNC_CONFIGS.contract.update!(contract.id, { notes: "Offline" }, { userId: actorId, baseUpdatedAt: base }),
    ).rejects.toBeInstanceOf(StaleEditError);
    expect((await p.contract.findUniqueOrThrow({ where: { id: contract.id } })).notes).toBe("Elsewhere");
  });

  it("a missing record is still not-found, not stale", async () => {
    await expect(
      updateVehicleCommand("missing", { colour: "Red" }, actorId, { baseUpdatedAt: new Date().toISOString() }),
    ).rejects.toBeInstanceOf(RecordNotFoundError);
  });
});

describe("purge order", () => {
  async function exists(target: string) {
    try {
      await access(target);
      return true;
    } catch {
      return false;
    }
  }

  async function putFile(dir: string) {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "stored.pdf"), "%PDF-1.4 test");
  }

  beforeEach(() => {
    vi.mocked(clearNotificationLogs).mockRejectedValueOnce(new Error("log cleanup failed"));
  });

  it("a Vehicle's files are gone even when clearing its Reminder log throws", async () => {
    const vehicle = await p.vehicle.create({ data: { label: "Car", createdById: actorId } });
    const item = await p.vehicleItem.create({ data: { vehicleId: vehicle.id, type: "SERVICE", title: "Service" } });
    const dir = path.join(db.uploadsDir, "vehicle-items", item.id);
    await putFile(dir);
    await expect(permanentlyDeleteVehicleCommand(vehicle.id)).rejects.toThrow("log cleanup failed");
    expect(await p.vehicle.findUnique({ where: { id: vehicle.id } })).toBeNull();
    expect(await exists(dir)).toBe(false);
  });

  it("a Contract's files are gone even when clearing its Reminder log throws", async () => {
    const contract = await p.contract.create({
      data: { title: "C", category: "OTHER", provider: "P", renewalType: "FIXED_TERM", createdById: actorId },
    });
    const dir = path.join(db.uploadsDir, contract.id);
    await putFile(dir);
    await expect(purgeContract(contract.id)).rejects.toThrow("log cleanup failed");
    expect(await p.contract.findUnique({ where: { id: contract.id } })).toBeNull();
    expect(await exists(dir)).toBe(false);
  });

  it("a Product's files are gone even when clearing its Reminder log throws", async () => {
    const product = await p.product.create({ data: { description: "Fridge", createdById: actorId } });
    const dir = path.join(db.uploadsDir, "products", product.id);
    await putFile(dir);
    await expect(purgeProduct(product.id)).rejects.toThrow("log cleanup failed");
    expect(await p.product.findUnique({ where: { id: product.id } })).toBeNull();
    expect(await exists(dir)).toBe(false);
  });
});

describe("an Inventory item linked to a warranty in Trash", () => {
  async function seedLinked() {
    const warranty = await p.product.create({
      data: { description: "Dishwasher warranty", deletedAt: new Date(), createdById: actorId },
    });
    const item = await p.inventoryItem.create({
      data: { label: "Dishwasher", warrantyProductId: warranty.id, createdById: actorId },
    });
    return { warranty, item };
  }

  // Finds the InventoryItemForm element in the page's rendered tree.
  function findFormProps(node: unknown): { products: { id: string; description: string }[] } | undefined {
    if (!node || typeof node !== "object") return undefined;
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = findFormProps(child);
        if (found) return found;
      }
      return undefined;
    }
    const element = node as { type?: unknown; props?: { children?: unknown } };
    if (element.type === InventoryItemForm) return element.props as never;
    return findFormProps(element.props?.children);
  }

  it("the edit page still offers the trashed warranty, marked as in Trash", async () => {
    const { warranty, item } = await seedLinked();
    await p.product.create({ data: { description: "Other trashed", deletedAt: new Date(), createdById: actorId } });
    const page = await EditInventoryItemPage({ params: Promise.resolve({ id: item.id }) });
    const props = findFormProps(page);
    expect(props?.products).toEqual([{ id: warranty.id, description: "Dishwasher warranty (deleted)" }]);
  });

  const editForm = (warrantyProductId: string) => ({
    label: "Dishwasher",
    category: "APPLIANCE",
    brand: "",
    model: "",
    serialNumber: "",
    purchaseDate: "",
    purchasePrice: "",
    currency: "AUD",
    location: "Kitchen",
    notes: "",
    warrantyProductId,
  });

  it("saving the edit form online keeps the link", async () => {
    const { warranty, item } = await seedLinked();
    await updateInventoryItem(item.id, null, formData(editForm(warranty.id)));
    const row = await p.inventoryItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(row).toMatchObject({ warrantyProductId: warranty.id, location: "Kitchen" });
  });

  it("saving the edit form offline keeps the link", async () => {
    const { warranty, item } = await seedLinked();
    const config = ENTITY_SYNC_CONFIGS.inventoryItem;
    await config.update!(item.id, parseSyncFormValues(config, "update", editForm(warranty.id)), { userId: actorId });
    const row = await p.inventoryItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(row).toMatchObject({ warrantyProductId: warranty.id, location: "Kitchen" });
  });
});

// Offline ops replay the same form mapper as the online action, so
// checkboxes and the actions' fallbacks behave the same in both paths.
describe("offline sync parses formValues like the online form", () => {
  const parse = (entity: string, values: Record<string, string>, operation: "create" | "update" = "create") =>
    parseSyncFormValues(new Map(Object.entries(ENTITY_SYNC_CONFIGS)).get(entity)!, operation, values) as Record<
      string,
      unknown
    >;

  const contract = { title: "T", category: "OTHER", provider: "P", renewalType: "FIXED_TERM" };
  const homeItem = { type: "REPAIR", title: "Roof" };
  const inventory = { label: "Drill" };

  it("a ticked checkbox is true and an unticked one false", () => {
    expect(parse("contract", { ...contract, isTaxDeductible: "on" }).isTaxDeductible).toBe(true);
    expect(parse("contract", contract).isTaxDeductible).toBe(false);
    expect(parse("homeItem", { ...homeItem, isTaxDeductible: "on" }).isTaxDeductible).toBe(true);
    expect(parse("homeItem", homeItem).isTaxDeductible).toBe(false);
    expect(parse("inventoryItem", { ...inventory, warrantyRegistered: "on", warrantyExtended: "on" })).toMatchObject({
      warrantyRegistered: true,
      warrantyExtended: true,
    });
    expect(parse("inventoryItem", inventory)).toMatchObject({ warrantyRegistered: false, warrantyExtended: false });
    // Only "on" counts as ticked; z.coerce.boolean() alone would read "false" as true.
    expect(parse("inventoryItem", { ...inventory, warrantyRegistered: "false" }).warrantyRegistered).toBe(false);
  });

  it("unticking a checkbox offline clears it on the record", async () => {
    const property = await seedProperty();
    const item = await p.homeItem.create({
      data: { propertyId: property.id, type: "REPAIR", title: "Roof", isTaxDeductible: true },
    });
    const config = ENTITY_SYNC_CONFIGS.homeItem;
    await config.update!(item.id, parseSyncFormValues(config, "update", { ...homeItem, currency: "AUD" }), {
      userId: actorId,
      parentId: property.id,
    });
    expect((await p.homeItem.findUniqueOrThrow({ where: { id: item.id } })).isTaxDeductible).toBe(false);
  });

  it("applies the online action's fallbacks", () => {
    expect(parse("contract", { ...contract, currency: "" }).currency).toBe("AUD");
    expect(parse("contract", contract).status).toBe("ACTIVE");
    expect(parse("product", { description: "TV" }).currency).toBe("AUD");
    expect(parse("vehicleItem", { type: "SERVICE", title: "Oil" }).currency).toBe("AUD");
    expect(parse("tripSegment", { type: "ACTIVITY", title: "Tour" }).currency).toBe("AUD");
    expect(parse("rentalStatement", {}).currency).toBe("AUD");
    expect(parse("inventoryItem", { ...inventory, category: "" }).category).toBe("OTHER");
    expect(parse("portfolio", { name: "Super", costMethod: "" })).toMatchObject({ currency: "AUD", costMethod: "FIFO" });
    expect(parse("holding", { ticker: "vas", assetClass: "" })).toMatchObject({ ticker: "VAS", assetClass: "SHARE" });
    expect(parse("trade", { type: "BUY", date: "2026-01-01", units: "1", pricePerUnit: "1" }).currency).toBe("AUD");
    expect(parse("property", { label: "Home", occupancyStatus: "" }).occupancyStatus).toBe("OWNER_OCCUPIED");
    expect(parse("propertyValuation", { valuedAt: "2026-01-01", value: "1" }).currency).toBe("AUD");
  });

  it("an offline create with a ticked checkbox succeeds", async () => {
    const config = ENTITY_SYNC_CONFIGS.contract;
    const { id } = await config.create!(parseSyncFormValues(config, "create", { ...contract, isTaxDeductible: "on" }), {
      userId: actorId,
    });
    expect((await p.contract.findUniqueOrThrow({ where: { id } })).isTaxDeductible).toBe(true);
  });
});
