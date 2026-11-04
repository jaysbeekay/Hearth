// #534: a permanent delete only removes a record that's still in Trash, and
// the check is in the delete's own where clause. A restore that lands between
// the purge's read (or Trash retention's listing) and its delete leaves the
// restored record, its Documents and their files alone. #522 pinned this for
// Inventory; these pin every other purge.
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, createTestUser, setModuleEnabled } from "../helpers/testDb";
import { purgeContract, permanentlyDeleteContractCommand } from "@/lib/commands/contracts";
import { purgeProduct } from "@/lib/commands/products";
import { purgeVehicle, purgeServiceRecord } from "@/lib/commands/vehicles";
import { purgeTrip, purgeTripSegment } from "@/lib/commands/trips";
import {
  purgeProperty,
  purgeMaintenanceRecord,
  purgeTenancy,
  purgeRentalStatement,
  purgePropertyValuation,
} from "@/lib/commands/home";
import { purgeTrade } from "@/lib/commands/wealth";
import { purgeDocument, permanentlyDeleteDocumentCommand, DocumentNotInTrashError } from "@/lib/commands/documents";
import { RecordNotFoundError, RecordNotInTrashError } from "@/lib/commands/shared";
import { permanentlyDeleteContract } from "@/lib/actions/contracts";
import { purgeExpiredTrash, TRASH_RETENTION_DAYS } from "@/lib/trash";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
}));

const db = setupTestDb();

let actorId: string;

// Past Trash retention's window, so retention picks it up.
const expiredAt = () => new Date(Date.now() - (TRASH_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000);

beforeEach(async () => {
  vi.restoreAllMocks();
  actorId = (await createTestUser()).id;
  vi.mocked(auth).mockResolvedValue({ user: { id: actorId, role: "MEMBER" } } as never);
  for (const key of ["HOME", "VEHICLES", "TRAVEL", "WEALTH"] as const) await setModuleEnabled(key, true);
});

const exists = (p: string) =>
  access(p).then(
    () => true,
    () => false,
  );

async function attachContractFile(contractId: string, deletedAt: Date | null = null) {
  const dir = path.join(db.uploadsDir, contractId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "stored.pdf"), "%PDF-1.4 test");
  const doc = await db.prisma.document.create({
    data: { contractId, filename: "policy.pdf", storedName: "stored.pdf", mimeType: "application/pdf", size: 13, deletedAt },
  });
  return { doc, file: path.join(dir, "stored.pdf") };
}

const newContract = (deletedAt: Date | null) =>
  db.prisma.contract.create({
    data: { title: "Insurance", category: "HOME_INSURANCE", provider: "InsureCo", createdById: actorId, deletedAt },
  });

// One entry per purge: makes a record of that type (with any parent it
// needs, live) and says how to purge it and find its row again.
interface Case {
  name: string;
  create: (deletedAt: Date | null) => Promise<{ id: string }>;
  purge: (id: string, options?: { deletedBefore?: Date }) => Promise<unknown>;
  row: (id: string) => Promise<{ deletedAt: Date | null } | null>;
}

const parentVehicle = () => db.prisma.vehicle.create({ data: { label: "Car", createdById: actorId } });
const parentTrip = () => db.prisma.trip.create({ data: { title: "Holiday", createdById: actorId } });
const parentProperty = () => db.prisma.property.create({ data: { label: "House", createdById: actorId } });
const parentHolding = async () => {
  const portfolio = await db.prisma.portfolio.create({ data: { name: "Shares", createdById: actorId } });
  return db.prisma.holding.create({ data: { portfolioId: portfolio.id, ticker: "VAS" } });
};

const cases: Case[] = [
  {
    name: "Contract",
    create: newContract,
    purge: purgeContract,
    row: (id) => db.prisma.contract.findUnique({ where: { id } }),
  },
  {
    name: "Product",
    create: (deletedAt) => db.prisma.product.create({ data: { description: "Dishwasher", createdById: actorId, deletedAt } }),
    purge: purgeProduct,
    row: (id) => db.prisma.product.findUnique({ where: { id } }),
  },
  {
    name: "Vehicle",
    create: (deletedAt) => db.prisma.vehicle.create({ data: { label: "Car", createdById: actorId, deletedAt } }),
    purge: purgeVehicle,
    row: (id) => db.prisma.vehicle.findUnique({ where: { id } }),
  },
  {
    name: "Service record",
    create: async (deletedAt) =>
      db.prisma.vehicleItem.create({
        data: { vehicleId: (await parentVehicle()).id, type: "SERVICE", title: "Oil change", deletedAt },
      }),
    purge: purgeServiceRecord,
    row: (id) => db.prisma.vehicleItem.findUnique({ where: { id } }),
  },
  {
    name: "Trip",
    create: (deletedAt) => db.prisma.trip.create({ data: { title: "Holiday", createdById: actorId, deletedAt } }),
    purge: purgeTrip,
    row: (id) => db.prisma.trip.findUnique({ where: { id } }),
  },
  {
    name: "Trip segment",
    create: async (deletedAt) =>
      db.prisma.tripSegment.create({ data: { tripId: (await parentTrip()).id, type: "FLIGHT", title: "JNB-SYD", deletedAt } }),
    purge: purgeTripSegment,
    row: (id) => db.prisma.tripSegment.findUnique({ where: { id } }),
  },
  {
    name: "Property",
    create: (deletedAt) => db.prisma.property.create({ data: { label: "House", createdById: actorId, deletedAt } }),
    purge: purgeProperty,
    row: (id) => db.prisma.property.findUnique({ where: { id } }),
  },
  {
    name: "Maintenance record",
    create: async (deletedAt) =>
      db.prisma.homeItem.create({
        data: { propertyId: (await parentProperty()).id, type: "MAINTENANCE", title: "Gutters", deletedAt },
      }),
    purge: purgeMaintenanceRecord,
    row: (id) => db.prisma.homeItem.findUnique({ where: { id } }),
  },
  {
    name: "Tenancy",
    create: async (deletedAt) =>
      db.prisma.rentalAgreement.create({ data: { propertyId: (await parentProperty()).id, weeklyRent: 500, deletedAt } }),
    purge: purgeTenancy,
    row: (id) => db.prisma.rentalAgreement.findUnique({ where: { id } }),
  },
  {
    name: "Rental statement",
    create: async (deletedAt) =>
      db.prisma.rentalStatement.create({ data: { propertyId: (await parentProperty()).id, deletedAt } }),
    purge: purgeRentalStatement,
    row: (id) => db.prisma.rentalStatement.findUnique({ where: { id } }),
  },
  {
    name: "Property valuation",
    create: async (deletedAt) =>
      db.prisma.propertyValuation.create({
        data: { propertyId: (await parentProperty()).id, valuedAt: new Date(), value: 750000, deletedAt },
      }),
    purge: purgePropertyValuation,
    row: (id) => db.prisma.propertyValuation.findUnique({ where: { id } }),
  },
  {
    name: "Trade",
    create: async (deletedAt) =>
      db.prisma.trade.create({
        data: { holdingId: (await parentHolding()).id, type: "BUY", date: new Date(), units: 10, pricePerUnit: 100, deletedAt },
      }),
    purge: purgeTrade,
    row: (id) => db.prisma.trade.findUnique({ where: { id } }),
  },
];

describe.each(cases)("$name purge (#534)", ({ create, purge, row }) => {
  it("purges a record in Trash", async () => {
    const record = await create(new Date());
    await purge(record.id);
    expect(await row(record.id)).toBeNull();
  });

  it("refuses a record restored before the purge ran, and leaves it live", async () => {
    const record = await create(new Date());
    // The restore lands after the person clicked "Delete permanently" (or
    // after retention listed it), before the purge's delete.
    await restore(record.id, row);
    await expect(purge(record.id)).rejects.toBeInstanceOf(RecordNotInTrashError);
    expect(await row(record.id)).toMatchObject({ deletedAt: null });
  });

  it("with a retention cutoff, leaves a record restored and deleted again since it", async () => {
    // Expired, then restored and deleted again: back in Trash, with a new window.
    const record = await create(expiredAt());
    await restore(record.id, row);
    await redelete(record.id);
    await expect(purge(record.id, { deletedBefore: expiredAt() })).rejects.toBeInstanceOf(RecordNotInTrashError);
    expect((await row(record.id))?.deletedAt).not.toBeNull();
  });

  it("reports a second purge as not found", async () => {
    const record = await create(new Date());
    await purge(record.id);
    await expect(purge(record.id)).rejects.toBeInstanceOf(RecordNotFoundError);
  });
});

const trashTables = () =>
  [
    db.prisma.contract,
    db.prisma.product,
    db.prisma.vehicle,
    db.prisma.vehicleItem,
    db.prisma.trip,
    db.prisma.tripSegment,
    db.prisma.property,
    db.prisma.homeItem,
    db.prisma.rentalAgreement,
    db.prisma.rentalStatement,
    db.prisma.propertyValuation,
    db.prisma.trade,
  ] as unknown as { updateMany: (args: object) => Promise<{ count: number }> }[];

// Restores straight on the row, the way a restore from another tab lands:
// whichever table holds `id`, set its deletedAt back to null.
async function restore(id: string, row: Case["row"]) {
  for (const table of trashTables()) await table.updateMany({ where: { id }, data: { deletedAt: null } });
  expect(await row(id)).toMatchObject({ deletedAt: null });
}

// Moves it to Trash again, now: a new Trash window.
async function redelete(id: string) {
  for (const table of trashTables()) await table.updateMany({ where: { id }, data: { deletedAt: new Date() } });
}

describe("Contract purge keeps a restored Contract's Documents and files (#534)", () => {
  it("a restore before the purge's delete wins", async () => {
    const contract = await newContract(new Date());
    const { file } = await attachContractFile(contract.id);
    await db.prisma.contract.update({ where: { id: contract.id }, data: { deletedAt: null } });
    await expect(permanentlyDeleteContractCommand(contract.id)).rejects.toBeInstanceOf(RecordNotInTrashError);
    expect(await db.prisma.contract.findUnique({ where: { id: contract.id } })).toMatchObject({ deletedAt: null });
    expect(await db.prisma.document.count({ where: { contractId: contract.id } })).toBe(1);
    expect(await exists(file)).toBe(true);
  });

  it("the server action reports the refusal to the person", async () => {
    const contract = await newContract(null);
    expect(await permanentlyDeleteContract(contract.id)).toEqual({
      error: "That contract has been restored, so it wasn't deleted.",
    });
    expect(await db.prisma.contract.findUnique({ where: { id: contract.id } })).not.toBeNull();
  });
});

describe("Document purge (#534)", () => {
  it("refuses a Document restored before the purge, keeping its row and file", async () => {
    const contract = await newContract(null);
    const { doc, file } = await attachContractFile(contract.id, new Date());
    await db.prisma.document.update({ where: { id: doc.id }, data: { deletedAt: null } });
    await expect(purgeDocument("CONTRACT", doc.id)).rejects.toBeInstanceOf(DocumentNotInTrashError);
    await expect(permanentlyDeleteDocumentCommand("CONTRACT", doc.id)).rejects.toBeInstanceOf(DocumentNotInTrashError);
    expect(await db.prisma.document.findUnique({ where: { id: doc.id } })).not.toBeNull();
    expect(await exists(file)).toBe(true);
  });

  it("purges a Document in Trash with its file", async () => {
    const contract = await newContract(null);
    const { doc, file } = await attachContractFile(contract.id, new Date());
    await purgeDocument("CONTRACT", doc.id);
    expect(await db.prisma.document.findUnique({ where: { id: doc.id } })).toBeNull();
    expect(await exists(file)).toBe(false);
  });
});

describe("Trash retention with a restore mid-run (#534)", () => {
  it("skips a Contract restored after it was listed, and still purges the rest", async () => {
    const restored = await newContract(expiredAt());
    const { file } = await attachContractFile(restored.id);
    const other = await newContract(expiredAt());
    const realFindMany = prisma.contract.findMany.bind(prisma.contract);
    vi.spyOn(prisma.contract, "findMany").mockImplementationOnce((async (args: Parameters<typeof realFindMany>[0]) => {
      const listed = await realFindMany(args);
      await db.prisma.contract.update({ where: { id: restored.id }, data: { deletedAt: null } });
      return listed;
    }) as never);

    await purgeExpiredTrash();

    expect(await db.prisma.contract.findUnique({ where: { id: restored.id } })).toMatchObject({ deletedAt: null });
    expect(await db.prisma.document.count({ where: { contractId: restored.id } })).toBe(1);
    expect(await exists(file)).toBe(true);
    expect(await db.prisma.contract.findUnique({ where: { id: other.id } })).toBeNull();
  });

  it("skips a Document restored after it was listed", async () => {
    const contract = await newContract(null);
    const { doc, file } = await attachContractFile(contract.id, expiredAt());
    const realFindMany = prisma.document.findMany.bind(prisma.document);
    vi.spyOn(prisma.document, "findMany").mockImplementationOnce((async (args: Parameters<typeof realFindMany>[0]) => {
      const listed = await realFindMany(args);
      await db.prisma.document.update({ where: { id: doc.id }, data: { deletedAt: null } });
      return listed;
    }) as never);

    await purgeExpiredTrash();

    expect(await db.prisma.document.findUnique({ where: { id: doc.id } })).toMatchObject({ deletedAt: null });
    expect(await exists(file)).toBe(true);
  });
});
