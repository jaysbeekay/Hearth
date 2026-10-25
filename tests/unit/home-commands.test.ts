import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, createTestUser, setModuleEnabled } from "../helpers/testDb";
import {
  createPropertyCommand,
  updatePropertyCommand,
  setPropertyRentedCommand,
  deletePropertyCommand,
  restorePropertyCommand,
  permanentlyDeletePropertyCommand,
  purgeProperty,
  createMaintenanceRecordCommand,
  updateMaintenanceRecordCommand,
  deleteMaintenanceRecordCommand,
  restoreMaintenanceRecordCommand,
  permanentlyDeleteMaintenanceRecordCommand,
  createTenancyCommand,
  updateTenancyCommand,
  linkTenancyContractCommand,
  permanentlyDeleteTenancyCommand,
  createRentalStatementCommand,
  updateRentalStatementCommand,
  permanentlyDeleteRentalStatementCommand,
  createPropertyValuationCommand,
  deletePropertyValuationCommand,
  TenancyContractLinkError,
} from "@/lib/commands/home";
import { RecordNotFoundError, StaleEditError } from "@/lib/commands/shared";
import { ModuleDisabledError } from "@/lib/modules/enablement";
import { fullFormUpdate } from "@/lib/validation/fullFormUpdate";
import {
  propertySchema,
  homeItemSchema,
  rentalAgreementSchema,
  rentalStatementSchema,
} from "@/lib/validation/home";
import { purgeExpiredTrash, TRASH_RETENTION_DAYS } from "@/lib/trash";
import { revalidatePath } from "next/cache";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const db = setupTestDb();

let actorId: string;

beforeEach(async () => {
  vi.clearAllMocks();
  actorId = (await createTestUser()).id;
  await setModuleEnabled("HOME", true);
});

async function exists(p: string) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

// Puts a file where storage.ts keeps a Maintenance record's (or Rental
// statement's) Documents, plus the row pointing at it, so permanent delete
// has something real to clean up.
// `deletedAt` puts the Document itself in Trash.
async function attachHomeItemFile(homeItemId: string, deletedAt: Date | null = null) {
  const dir = path.join(db.uploadsDir, "home-items", homeItemId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "stored.pdf"), "%PDF-1.4 test");
  await db.prisma.homeItemDocument.create({
    data: {
      homeItemId,
      filename: "invoice.pdf",
      storedName: "stored.pdf",
      mimeType: "application/pdf",
      size: 13,
      deletedAt,
    },
  });
  return dir;
}

async function attachStatementFile(rentalStatementId: string) {
  const dir = path.join(db.uploadsDir, "rental-statements", rentalStatementId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "stored.pdf"), "%PDF-1.4 test");
  await db.prisma.rentalStatementDocument.create({
    data: { rentalStatementId, filename: "statement.pdf", storedName: "stored.pdf", mimeType: "application/pdf", size: 13 },
  });
  return dir;
}

const propertyInput = (label = "Beach house") => propertySchema.parse({ label });
const itemInput = (title = "Gutter clean") => homeItemSchema.parse({ type: "MAINTENANCE", title });
const tenancyInput = (weeklyRent = 550) => rentalAgreementSchema.parse({ weeklyRent });
const statementInput = (grossRent = 2200) => rentalStatementSchema.parse({ grossRent });

describe("Property commands", () => {
  it("creates a Property with the actor as creator and revalidates the list", async () => {
    const property = await createPropertyCommand(propertyInput(), actorId);
    expect(await db.prisma.property.findUniqueOrThrow({ where: { id: property.id } })).toMatchObject({
      label: "Beach house",
      createdById: actorId,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/home");
  });

  it("applies a partial patch, leaving other fields alone", async () => {
    const property = await createPropertyCommand(
      propertySchema.parse({ label: "Flat", suburb: "Fitzroy", postcode: "3065" }),
      actorId,
    );
    const editor = await createTestUser();
    await updatePropertyCommand(property.id, { postcode: "3068" }, editor.id);
    expect(await db.prisma.property.findUniqueOrThrow({ where: { id: property.id } })).toMatchObject({
      label: "Flat",
      suburb: "Fitzroy",
      postcode: "3068",
      updatedById: editor.id,
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/home/${property.id}`);
  });

  it("clears fields a full edit form submitted blank", async () => {
    const property = await createPropertyCommand(
      propertySchema.parse({ label: "Flat", suburb: "Fitzroy", notes: "Corner block" }),
      actorId,
    );
    const form = { label: "Flat", suburb: "", notes: "" };
    await updatePropertyCommand(property.id, fullFormUpdate(propertySchema, propertySchema.parse(form), form), actorId);
    expect(await db.prisma.property.findUniqueOrThrow({ where: { id: property.id } })).toMatchObject({
      label: "Flat",
      suburb: null,
      notes: null,
    });
  });

  it("turns rental tracking on and off", async () => {
    const property = await createPropertyCommand(propertyInput(), actorId);
    await setPropertyRentedCommand(property.id, true, actorId);
    expect((await db.prisma.property.findUniqueOrThrow({ where: { id: property.id } })).isRented).toBe(true);
    await setPropertyRentedCommand(property.id, false, actorId);
    expect((await db.prisma.property.findUniqueOrThrow({ where: { id: property.id } })).isRented).toBe(false);
  });

  it("soft deletes to Trash and restores", async () => {
    const property = await createPropertyCommand(propertyInput(), actorId);
    await deletePropertyCommand(property.id);
    expect((await db.prisma.property.findUniqueOrThrow({ where: { id: property.id } })).deletedAt).toBeInstanceOf(Date);
    expect(revalidatePath).toHaveBeenCalledWith("/settings/trash");

    await restorePropertyCommand(property.id);
    expect((await db.prisma.property.findUniqueOrThrow({ where: { id: property.id } })).deletedAt).toBeNull();
  });

  it("permanently deletes the Property, everything under it and their files", async () => {
    const property = await createPropertyCommand(propertyInput(), actorId);
    const item = await createMaintenanceRecordCommand(property.id, itemInput());
    const statement = await createRentalStatementCommand(property.id, statementInput());
    await createTenancyCommand(property.id, tenancyInput(), actorId);
    await createPropertyValuationCommand(property.id, { valuedAt: new Date(), value: 900_000, currency: "AUD" });
    const itemDir = await attachHomeItemFile(item.id);
    const statementDir = await attachStatementFile(statement.id);

    await permanentlyDeletePropertyCommand(property.id);

    expect(await db.prisma.property.findUnique({ where: { id: property.id } })).toBeNull();
    expect(await db.prisma.homeItem.count()).toBe(0);
    expect(await db.prisma.rentalStatement.count()).toBe(0);
    expect(await db.prisma.rentalAgreement.count()).toBe(0);
    expect(await db.prisma.propertyValuation.count()).toBe(0);
    expect(await db.prisma.homeItemDocument.count()).toBe(0);
    expect(await db.prisma.rentalStatementDocument.count()).toBe(0);
    expect(await exists(itemDir)).toBe(false);
    expect(await exists(statementDir)).toBe(false);
  });

  it("removes the file of a Document already in Trash on permanent delete", async () => {
    const property = await createPropertyCommand(propertyInput(), actorId);
    const item = await createMaintenanceRecordCommand(property.id, itemInput());
    const dir = await attachHomeItemFile(item.id, new Date());

    await permanentlyDeletePropertyCommand(property.id);

    expect(await db.prisma.homeItemDocument.count()).toBe(0);
    expect(await exists(path.join(dir, "stored.pdf"))).toBe(false);
  });

  it("purges for Trash retention even with the module off, files included", async () => {
    const property = await createPropertyCommand(propertyInput(), actorId);
    const item = await createMaintenanceRecordCommand(property.id, itemInput());
    const statement = await createRentalStatementCommand(property.id, statementInput());
    const itemDir = await attachHomeItemFile(item.id);
    const statementDir = await attachStatementFile(statement.id);
    await setModuleEnabled("HOME", false);

    await purgeProperty(property.id);

    expect(await db.prisma.property.findUnique({ where: { id: property.id } })).toBeNull();
    expect(await exists(itemDir)).toBe(false);
    expect(await exists(statementDir)).toBe(false);
  });

  it("Trash retention purges an expired Property and its files, and keeps a recent one", async () => {
    const expired = await createPropertyCommand(propertyInput("Expired"), actorId);
    const recent = await createPropertyCommand(propertyInput("Recent"), actorId);
    const item = await createMaintenanceRecordCommand(expired.id, itemInput());
    const dir = await attachHomeItemFile(item.id);
    const longAgo = new Date(Date.now() - (TRASH_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000);
    await db.prisma.property.update({ where: { id: expired.id }, data: { deletedAt: longAgo } });
    await db.prisma.property.update({ where: { id: recent.id }, data: { deletedAt: new Date() } });

    await purgeExpiredTrash();

    expect(await db.prisma.property.findUnique({ where: { id: expired.id } })).toBeNull();
    expect(await db.prisma.homeItem.count()).toBe(0);
    expect(await exists(dir)).toBe(false);
    expect(await db.prisma.property.findUnique({ where: { id: recent.id } })).not.toBeNull();
  });

  it("refuses writes under a Property in Trash until it's restored", async () => {
    const property = await createPropertyCommand(propertyInput(), actorId);
    const item = await createMaintenanceRecordCommand(property.id, itemInput());
    const tenancy = await createTenancyCommand(property.id, tenancyInput(), actorId);
    const statement = await createRentalStatementCommand(property.id, statementInput());
    await deletePropertyCommand(property.id);

    const writes = [
      () => updatePropertyCommand(property.id, { label: "Renamed" }, actorId),
      () => setPropertyRentedCommand(property.id, false, actorId),
      () => createMaintenanceRecordCommand(property.id, itemInput("Offline")),
      () => updateMaintenanceRecordCommand(item.id, { title: "Renamed" }),
      () => createTenancyCommand(property.id, tenancyInput(), actorId),
      () => updateTenancyCommand(tenancy.id, { weeklyRent: 1 }),
      () => linkTenancyContractCommand(tenancy.id, null),
      () => createRentalStatementCommand(property.id, statementInput()),
      () => updateRentalStatementCommand(statement.id, { grossRent: 1 }),
      () => createPropertyValuationCommand(property.id, { valuedAt: new Date(), value: 1, currency: "AUD" }),
    ];
    for (const write of writes) {
      await expect(write()).rejects.toBeInstanceOf(RecordNotFoundError);
    }
    expect(await db.prisma.homeItem.count()).toBe(1);
    expect(await db.prisma.rentalAgreement.count()).toBe(1);
    expect(await db.prisma.rentalStatement.count()).toBe(1);
    expect(await db.prisma.propertyValuation.count()).toBe(0);

    await restorePropertyCommand(property.id);
    await updateMaintenanceRecordCommand(item.id, { title: "Renamed" });
    expect((await db.prisma.homeItem.findUniqueOrThrow({ where: { id: item.id } })).title).toBe("Renamed");
  });

  it("refuses a stale edit and accepts a current one", async () => {
    const property = await createPropertyCommand(propertyInput(), actorId);
    const loadedAt = property.updatedAt.toISOString();

    await tick();
    await updatePropertyCommand(property.id, { notes: "First" }, actorId);

    await expect(
      updatePropertyCommand(property.id, { notes: "Second" }, actorId, { baseUpdatedAt: loadedAt }),
    ).rejects.toBeInstanceOf(StaleEditError);
    expect((await db.prisma.property.findUniqueOrThrow({ where: { id: property.id } })).notes).toBe("First");

    const current = await db.prisma.property.findUniqueOrThrow({ where: { id: property.id } });
    await updatePropertyCommand(property.id, { notes: "Second" }, actorId, { baseUpdatedAt: current.updatedAt });
    expect((await db.prisma.property.findUniqueOrThrow({ where: { id: property.id } })).notes).toBe("Second");
  });

  it("reports a missing Property as not found", async () => {
    await expect(updatePropertyCommand("missing", { label: "x" }, actorId)).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(deletePropertyCommand("missing")).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(createMaintenanceRecordCommand("missing", itemInput())).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(createTenancyCommand("missing", tenancyInput(), actorId)).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(createRentalStatementCommand("missing", statementInput())).rejects.toBeInstanceOf(RecordNotFoundError);
  });
});

describe("Maintenance record commands", () => {
  let propertyId: string;

  beforeEach(async () => {
    propertyId = (await createPropertyCommand(propertyInput(), actorId)).id;
  });

  it("creates a Maintenance record on its Property", async () => {
    const item = await createMaintenanceRecordCommand(
      propertyId,
      homeItemSchema.parse({ type: "REPAIR", title: "Hot water", cost: 1400, isTaxDeductible: true }),
    );
    expect(await db.prisma.homeItem.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({
      propertyId,
      title: "Hot water",
      cost: 1400,
      isTaxDeductible: true,
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/home/${propertyId}`);
  });

  it("applies a partial patch, clears blanked fields and enforces the Property scope", async () => {
    const item = await createMaintenanceRecordCommand(
      propertyId,
      homeItemSchema.parse({ type: "REPAIR", title: "Roof", provider: "Acme", cost: 300 }),
    );
    await updateMaintenanceRecordCommand(item.id, { cost: 450 }, { propertyId });
    expect(await db.prisma.homeItem.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({
      title: "Roof",
      provider: "Acme",
      cost: 450,
    });

    const form = { type: "REPAIR", title: "Roof", provider: "", cost: "" };
    await updateMaintenanceRecordCommand(item.id, fullFormUpdate(homeItemSchema, homeItemSchema.parse(form), form));
    expect(await db.prisma.homeItem.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({
      provider: null,
      cost: null,
    });

    const other = await createPropertyCommand(propertyInput("Other"), actorId);
    await expect(
      updateMaintenanceRecordCommand(item.id, { cost: 1 }, { propertyId: other.id }),
    ).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(deleteMaintenanceRecordCommand(item.id, { propertyId: other.id })).rejects.toBeInstanceOf(
      RecordNotFoundError,
    );
  });

  it("refuses a stale edit", async () => {
    const item = await createMaintenanceRecordCommand(propertyId, itemInput());
    const loadedAt = item.updatedAt.toISOString();
    await tick();
    await updateMaintenanceRecordCommand(item.id, { title: "Gutters and downpipes" });
    await expect(
      updateMaintenanceRecordCommand(item.id, { title: "Gutters only" }, { baseUpdatedAt: loadedAt }),
    ).rejects.toBeInstanceOf(StaleEditError);
    expect((await db.prisma.homeItem.findUniqueOrThrow({ where: { id: item.id } })).title).toBe("Gutters and downpipes");
  });

  it("soft deletes to Trash and restores", async () => {
    const item = await createMaintenanceRecordCommand(propertyId, itemInput());
    await deleteMaintenanceRecordCommand(item.id, { propertyId });
    expect((await db.prisma.homeItem.findUniqueOrThrow({ where: { id: item.id } })).deletedAt).toBeInstanceOf(Date);
    await expect(updateMaintenanceRecordCommand(item.id, { title: "While in Trash" })).rejects.toBeInstanceOf(
      RecordNotFoundError,
    );
    await restoreMaintenanceRecordCommand(item.id);
    expect((await db.prisma.homeItem.findUniqueOrThrow({ where: { id: item.id } })).deletedAt).toBeNull();
  });

  it("permanently deletes the Maintenance record with its Documents and files", async () => {
    const item = await createMaintenanceRecordCommand(propertyId, itemInput());
    const dir = await attachHomeItemFile(item.id);

    await permanentlyDeleteMaintenanceRecordCommand(item.id);

    expect(await db.prisma.homeItem.findUnique({ where: { id: item.id } })).toBeNull();
    expect(await db.prisma.homeItemDocument.count()).toBe(0);
    expect(await exists(dir)).toBe(false);
    expect(await db.prisma.property.findUnique({ where: { id: propertyId } })).not.toBeNull();
  });
});

describe("Tenancy commands", () => {
  let propertyId: string;

  beforeEach(async () => {
    propertyId = (await createPropertyCommand(propertyInput(), actorId)).id;
  });

  it("creates a Tenancy and turns rental tracking on", async () => {
    const tenancy = await createTenancyCommand(
      propertyId,
      rentalAgreementSchema.parse({ tenantName: "Sam", weeklyRent: 600, bondAmount: 2400 }), actorId,
    );
    expect(await db.prisma.rentalAgreement.findUniqueOrThrow({ where: { id: tenancy.id } })).toMatchObject({
      propertyId,
      tenantName: "Sam",
      weeklyRent: 600,
    });
    expect((await db.prisma.property.findUniqueOrThrow({ where: { id: propertyId } })).isRented).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith(`/home/${propertyId}/rental`);
  });

  it("applies a partial patch, clears blanked fields and enforces the Property scope", async () => {
    const tenancy = await createTenancyCommand(
      propertyId,
      rentalAgreementSchema.parse({ tenantName: "Sam", weeklyRent: 600, notes: "Pets ok" }), actorId,
    );
    await updateTenancyCommand(tenancy.id, { weeklyRent: 650 }, { propertyId });
    expect(await db.prisma.rentalAgreement.findUniqueOrThrow({ where: { id: tenancy.id } })).toMatchObject({
      tenantName: "Sam",
      weeklyRent: 650,
      notes: "Pets ok",
    });

    const form = { tenantName: "", weeklyRent: "650", notes: "" };
    await updateTenancyCommand(
      tenancy.id,
      fullFormUpdate(rentalAgreementSchema, rentalAgreementSchema.parse(form), form),
    );
    expect(await db.prisma.rentalAgreement.findUniqueOrThrow({ where: { id: tenancy.id } })).toMatchObject({
      tenantName: null,
      notes: null,
      weeklyRent: 650,
    });

    const other = await createPropertyCommand(propertyInput("Other"), actorId);
    await expect(updateTenancyCommand(tenancy.id, { weeklyRent: 1 }, { propertyId: other.id })).rejects.toBeInstanceOf(
      RecordNotFoundError,
    );
  });

  it("links only a Rental-category Contract, and unlinks", async () => {
    const tenancy = await createTenancyCommand(propertyId, tenancyInput(), actorId);
    const lease = await db.prisma.contract.create({
      data: { title: "Head lease", category: "RENTAL", provider: "Agent", createdById: actorId },
    });
    const phone = await db.prisma.contract.create({
      data: { title: "Mobile", category: "OTHER", provider: "Telco", createdById: actorId },
    });

    await expect(linkTenancyContractCommand(tenancy.id, phone.id)).rejects.toMatchObject({
      name: "TenancyContractLinkError",
      problem: "wrong-category",
    });
    await expect(linkTenancyContractCommand(tenancy.id, "missing")).rejects.toMatchObject({ problem: "not-found" });
    await expect(linkTenancyContractCommand("missing", lease.id)).rejects.toBeInstanceOf(RecordNotFoundError);

    await linkTenancyContractCommand(tenancy.id, lease.id, { propertyId });
    expect((await db.prisma.rentalAgreement.findUniqueOrThrow({ where: { id: tenancy.id } })).contractId).toBe(lease.id);
    expect(revalidatePath).toHaveBeenCalledWith(`/contracts/${lease.id}`);

    await linkTenancyContractCommand(tenancy.id, null);
    expect((await db.prisma.rentalAgreement.findUniqueOrThrow({ where: { id: tenancy.id } })).contractId).toBeNull();
  });

  it("won't link a Contract already linked to another Tenancy, or one in Trash", async () => {
    const first = await createTenancyCommand(propertyId, tenancyInput(), actorId);
    const second = await createTenancyCommand(propertyId, tenancyInput(700), actorId);
    const lease = await db.prisma.contract.create({
      data: { title: "Head lease", category: "RENTAL", provider: "Agent", createdById: actorId },
    });
    const trashed = await db.prisma.contract.create({
      data: { title: "Old lease", category: "RENTAL", provider: "Agent", createdById: actorId, deletedAt: new Date() },
    });
    await linkTenancyContractCommand(first.id, lease.id);

    const taken = linkTenancyContractCommand(second.id, lease.id);
    await expect(taken).rejects.toBeInstanceOf(TenancyContractLinkError);
    await expect(taken).rejects.toMatchObject({
      problem: "already-linked",
      message: "That contract is already linked to another tenancy.",
    });
    await expect(linkTenancyContractCommand(second.id, trashed.id)).rejects.toMatchObject({ problem: "not-found" });
    expect((await db.prisma.rentalAgreement.findUniqueOrThrow({ where: { id: second.id } })).contractId).toBeNull();

    // Re-linking the same Tenancy to its own Contract isn't a conflict.
    await linkTenancyContractCommand(first.id, lease.id);
    expect((await db.prisma.rentalAgreement.findUniqueOrThrow({ where: { id: first.id } })).contractId).toBe(lease.id);
  });

  it("records who turned rental tracking on when a Tenancy is added", async () => {
    const editor = await createTestUser();
    await createTenancyCommand(propertyId, tenancyInput(), editor.id);
    expect((await db.prisma.property.findUniqueOrThrow({ where: { id: propertyId } })).updatedById).toBe(editor.id);
  });

  it("deletes a Tenancy for good, leaving its linked Contract", async () => {
    const tenancy = await createTenancyCommand(propertyId, tenancyInput(), actorId);
    const lease = await db.prisma.contract.create({
      data: { title: "Head lease", category: "RENTAL", provider: "Agent", createdById: actorId },
    });
    await linkTenancyContractCommand(tenancy.id, lease.id);

    await expect(permanentlyDeleteTenancyCommand(tenancy.id, { propertyId: "other" })).rejects.toBeInstanceOf(
      RecordNotFoundError,
    );
    await permanentlyDeleteTenancyCommand(tenancy.id, { propertyId });

    expect(await db.prisma.rentalAgreement.findUnique({ where: { id: tenancy.id } })).toBeNull();
    expect(await db.prisma.contract.findUnique({ where: { id: lease.id } })).not.toBeNull();
  });
});

describe("Rental statement commands", () => {
  let propertyId: string;

  beforeEach(async () => {
    propertyId = (await createPropertyCommand(propertyInput(), actorId)).id;
  });

  it("creates a Rental statement on its Property", async () => {
    const statement = await createRentalStatementCommand(
      propertyId,
      rentalStatementSchema.parse({ grossRent: 2400, managementFee: 180, netAmount: 2220 }),
    );
    expect(await db.prisma.rentalStatement.findUniqueOrThrow({ where: { id: statement.id } })).toMatchObject({
      propertyId,
      grossRent: 2400,
      netAmount: 2220,
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/home/${propertyId}/rental`);
  });

  it("applies a partial patch, clears blanked fields and enforces the Property scope", async () => {
    const statement = await createRentalStatementCommand(
      propertyId,
      rentalStatementSchema.parse({ grossRent: 2400, managementFee: 180, notes: "March" }),
    );
    await updateRentalStatementCommand(statement.id, { managementFee: 200 }, { propertyId });
    expect(await db.prisma.rentalStatement.findUniqueOrThrow({ where: { id: statement.id } })).toMatchObject({
      grossRent: 2400,
      managementFee: 200,
      notes: "March",
    });

    const form = { grossRent: "2400", managementFee: "", notes: "" };
    await updateRentalStatementCommand(
      statement.id,
      fullFormUpdate(rentalStatementSchema, rentalStatementSchema.parse(form), form),
    );
    expect(await db.prisma.rentalStatement.findUniqueOrThrow({ where: { id: statement.id } })).toMatchObject({
      grossRent: 2400,
      managementFee: null,
      notes: null,
    });

    await expect(
      updateRentalStatementCommand(statement.id, { grossRent: 1 }, { propertyId: "other" }),
    ).rejects.toBeInstanceOf(RecordNotFoundError);
  });

  it("refuses a stale edit", async () => {
    const statement = await createRentalStatementCommand(propertyId, statementInput());
    const loadedAt = statement.updatedAt.toISOString();
    await tick();
    await updateRentalStatementCommand(statement.id, { notes: "Checked" });
    await expect(
      updateRentalStatementCommand(statement.id, { notes: "Overwritten" }, { baseUpdatedAt: loadedAt }),
    ).rejects.toBeInstanceOf(StaleEditError);
    expect((await db.prisma.rentalStatement.findUniqueOrThrow({ where: { id: statement.id } })).notes).toBe("Checked");
  });

  it("deletes a Rental statement for good, with its Documents and files", async () => {
    const statement = await createRentalStatementCommand(propertyId, statementInput());
    const dir = await attachStatementFile(statement.id);

    await permanentlyDeleteRentalStatementCommand(statement.id, { propertyId });

    expect(await db.prisma.rentalStatement.findUnique({ where: { id: statement.id } })).toBeNull();
    expect(await db.prisma.rentalStatementDocument.count()).toBe(0);
    expect(await exists(dir)).toBe(false);
  });
});

describe("Property valuation commands", () => {
  it("creates and deletes a valuation, scoped to its Property", async () => {
    const property = await createPropertyCommand(propertyInput(), actorId);
    const valuation = await createPropertyValuationCommand(property.id, {
      valuedAt: new Date("2026-06-01T00:00:00Z"),
      value: 1_200_000,
      currency: "AUD",
      source: "Agent appraisal",
    });
    expect(await db.prisma.propertyValuation.findUniqueOrThrow({ where: { id: valuation.id } })).toMatchObject({
      propertyId: property.id,
      value: 1_200_000,
    });

    await expect(deletePropertyValuationCommand(valuation.id, { propertyId: "other" })).rejects.toBeInstanceOf(
      RecordNotFoundError,
    );
    await deletePropertyValuationCommand(valuation.id, { propertyId: property.id });
    expect(await db.prisma.propertyValuation.count()).toBe(0);
    expect(revalidatePath).toHaveBeenCalledWith(`/home/${property.id}`);
  });

  it("won't value a missing Property", async () => {
    await expect(
      createPropertyValuationCommand("missing", { valuedAt: new Date(), value: 1, currency: "AUD" }),
    ).rejects.toBeInstanceOf(RecordNotFoundError);
  });
});

describe("Property module gate", () => {
  it("rejects every write when the Property module is disabled", async () => {
    const property = await createPropertyCommand(propertyInput(), actorId);
    const item = await createMaintenanceRecordCommand(property.id, itemInput());
    const tenancy = await createTenancyCommand(property.id, tenancyInput(), actorId);
    const statement = await createRentalStatementCommand(property.id, statementInput());
    const valuation = await createPropertyValuationCommand(property.id, { valuedAt: new Date(), value: 1, currency: "AUD" });
    await setModuleEnabled("HOME", false);

    const writes = [
      () => createPropertyCommand(propertyInput("Another"), actorId),
      () => updatePropertyCommand(property.id, { label: "Renamed" }, actorId),
      () => setPropertyRentedCommand(property.id, false, actorId),
      () => deletePropertyCommand(property.id),
      () => restorePropertyCommand(property.id),
      () => permanentlyDeletePropertyCommand(property.id),
      () => createMaintenanceRecordCommand(property.id, itemInput("Another")),
      () => updateMaintenanceRecordCommand(item.id, { title: "Renamed" }),
      () => deleteMaintenanceRecordCommand(item.id),
      () => restoreMaintenanceRecordCommand(item.id),
      () => permanentlyDeleteMaintenanceRecordCommand(item.id),
      () => createTenancyCommand(property.id, tenancyInput(), actorId),
      () => updateTenancyCommand(tenancy.id, { weeklyRent: 1 }),
      () => linkTenancyContractCommand(tenancy.id, null),
      () => permanentlyDeleteTenancyCommand(tenancy.id),
      () => createRentalStatementCommand(property.id, statementInput()),
      () => updateRentalStatementCommand(statement.id, { grossRent: 1 }),
      () => permanentlyDeleteRentalStatementCommand(statement.id),
      () => createPropertyValuationCommand(property.id, { valuedAt: new Date(), value: 2, currency: "AUD" }),
      () => deletePropertyValuationCommand(valuation.id),
    ];
    for (const write of writes) {
      await expect(write()).rejects.toBeInstanceOf(ModuleDisabledError);
    }
    expect(await db.prisma.property.count()).toBe(1);
    expect(await db.prisma.property.findUniqueOrThrow({ where: { id: property.id } })).toMatchObject({
      label: "Beach house",
      isRented: true,
      deletedAt: null,
    });
    expect(await db.prisma.homeItem.count()).toBe(1);
    expect(await db.prisma.rentalAgreement.count()).toBe(1);
    expect(await db.prisma.rentalStatement.count()).toBe(1);
    expect(await db.prisma.propertyValuation.count()).toBe(1);
  });
});

// The offline sync handler goes through the same commands; check the wiring.
describe("sync entities for Properties", () => {
  it("creates, refuses a stale update, and soft deletes through the commands", async () => {
    const { ENTITY_SYNC_CONFIGS } = await import("@/app/api/sync/entityHandlers");
    const sync = ENTITY_SYNC_CONFIGS.property;
    const { id } = await sync.create!(propertyInput("Synced house"), { userId: actorId });
    const loaded = await db.prisma.property.findUniqueOrThrow({ where: { id } });

    await tick();
    await sync.update!(id, { notes: "Offline edit" }, { userId: actorId, baseUpdatedAt: loaded.updatedAt.toISOString() });
    await expect(
      sync.update!(id, { notes: "Second" }, { userId: actorId, baseUpdatedAt: loaded.updatedAt.toISOString() }),
    ).rejects.toThrow("changed elsewhere");

    const item = await ENTITY_SYNC_CONFIGS.homeItem.create!(itemInput("Offline repair"), { userId: actorId, parentId: id });
    const tenancy = await ENTITY_SYNC_CONFIGS.rentalAgreement.create!(tenancyInput(), { userId: actorId, parentId: id });
    const statement = await ENTITY_SYNC_CONFIGS.rentalStatement.create!(statementInput(), { userId: actorId, parentId: id });
    const valuation = await ENTITY_SYNC_CONFIGS.propertyValuation.create!(
      { valuedAt: new Date(), value: 5, currency: "AUD" },
      { userId: actorId, parentId: id },
    );
    expect((await db.prisma.homeItem.findUniqueOrThrow({ where: { id: item.id } })).propertyId).toBe(id);
    expect((await db.prisma.rentalAgreement.findUniqueOrThrow({ where: { id: tenancy.id } })).propertyId).toBe(id);
    expect((await db.prisma.rentalStatement.findUniqueOrThrow({ where: { id: statement.id } })).propertyId).toBe(id);
    expect((await db.prisma.propertyValuation.findUniqueOrThrow({ where: { id: valuation.id } })).propertyId).toBe(id);

    await expect(
      ENTITY_SYNC_CONFIGS.homeItem.update!(item.id, { title: "x" }, { userId: actorId, parentId: "other" }),
    ).rejects.toThrow("not found");

    await sync.remove!(id, { userId: actorId });
    const row = await db.prisma.property.findUniqueOrThrow({ where: { id } });
    expect(row.notes).toBe("Offline edit");
    expect(row.deletedAt).toBeInstanceOf(Date);
  });
});
