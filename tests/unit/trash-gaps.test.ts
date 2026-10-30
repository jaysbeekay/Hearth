// #446: an Inventory item in Trash can't be edited, and its update goes
// through a record command. #447: a Contract or Product write can't link a
// Property or Vehicle that's in Trash (or whose module is off), whichever
// caller it comes from, offline sync replays included.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { setupTestDb, createTestUser, setModuleEnabled } from "../helpers/testDb";
import { updateInventoryItemCommand } from "@/lib/commands/inventory";
import { createContractCommand, updateContractCommand } from "@/lib/commands/contracts";
import { createProductCommand, updateProductCommand, deleteProductCommand } from "@/lib/commands/products";
import { createPropertyCommand, deletePropertyCommand, restorePropertyCommand } from "@/lib/commands/home";
import { createVehicleCommand, deleteVehicleCommand } from "@/lib/commands/vehicles";
import { RecordNotFoundError, RecordValidationError, StaleEditError } from "@/lib/commands/shared";
import { ModuleDisabledError } from "@/lib/modules/enablement";
import { updateInventoryItem } from "@/lib/actions/inventory";
import { createContract } from "@/lib/actions/contracts";
import { contractSchema } from "@/lib/validation/contract";
import { productSchema } from "@/lib/validation/product";
import { propertySchema } from "@/lib/validation/home";
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

beforeEach(async () => {
  vi.clearAllMocks();
  actorId = (await createTestUser()).id;
  vi.mocked(auth).mockResolvedValue({ user: { id: actorId, role: "MEMBER" } } as never);
  for (const key of ["INVENTORY", "HOME", "VEHICLES"] as const) await setModuleEnabled(key, true);
});

function formData(values: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.append(key, value);
  return fd;
}

async function replay(operations: object[]) {
  const { POST } = await import("@/app/api/sync/route");
  const body = new FormData();
  body.append("operations", JSON.stringify(operations));
  const response = await POST(new NextRequest("http://localhost/api/sync", { method: "POST", body }));
  return (await response.json()) as { results: { id: string; success: boolean; error?: string }[] };
}

const newItem = (extra: Record<string, unknown> = {}) =>
  db.prisma.inventoryItem.create({ data: { label: "Drill", createdById: actorId, ...extra } });

const contractInput = (extra: Record<string, unknown> = {}) =>
  contractSchema.parse({ title: "Insurance", category: "HOME_INSURANCE", provider: "InsureCo", renewalType: "MANUAL_RENEWAL", ...extra });

const productInput = (extra: Record<string, unknown> = {}) =>
  productSchema.parse({ description: "Dishwasher", ...extra });

const newProperty = (label = "House") => createPropertyCommand(propertySchema.parse({ label }), actorId);

describe("Inventory item update command (#446)", () => {
  it("updates a live item and records who changed it", async () => {
    const item = await newItem();
    const updated = await updateInventoryItemCommand(item.id, { label: "Cordless drill", brand: null }, actorId);
    expect(updated.label).toBe("Cordless drill");
    expect(updated.updatedById).toBe(actorId);
  });

  it("refuses an item in Trash as not found, and leaves it as it was", async () => {
    const item = await newItem({ deletedAt: new Date() });
    await expect(updateInventoryItemCommand(item.id, { label: "Edited" }, actorId)).rejects.toBeInstanceOf(
      RecordNotFoundError,
    );
    await expect(updateInventoryItemCommand("missing", { label: "Edited" }, actorId)).rejects.toBeInstanceOf(
      RecordNotFoundError,
    );
    expect((await db.prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).label).toBe("Drill");
  });

  it("refuses a stale edit", async () => {
    const item = await newItem();
    await updateInventoryItemCommand(item.id, { label: "First" }, actorId, { baseUpdatedAt: item.updatedAt });
    await expect(
      updateInventoryItemCommand(item.id, { label: "Second" }, actorId, { baseUpdatedAt: item.updatedAt }),
    ).rejects.toBeInstanceOf(StaleEditError);
    expect((await db.prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).label).toBe("First");
  });

  it("is refused while the Inventory module is off", async () => {
    const item = await newItem();
    await setModuleEnabled("INVENTORY", false);
    await expect(updateInventoryItemCommand(item.id, { label: "Edited" }, actorId)).rejects.toBeInstanceOf(
      ModuleDisabledError,
    );
  });

  it("refuses a new link to a warranty in Trash, but keeps one the item already has", async () => {
    const live = await createProductCommand(productInput(), actorId);
    const trashed = await createProductCommand(productInput({ description: "Old TV" }), actorId);
    await deleteProductCommand(trashed.id);
    const item = await newItem({ warrantyProductId: live.id });

    await expect(
      updateInventoryItemCommand(item.id, { warrantyProductId: trashed.id }, actorId),
    ).rejects.toThrow("That warranty doesn't exist or is in Trash.");
    await expect(updateInventoryItemCommand(item.id, { warrantyProductId: "missing" }, actorId)).rejects.toBeInstanceOf(
      RecordValidationError,
    );

    await deleteProductCommand(live.id);
    const updated = await updateInventoryItemCommand(item.id, { label: "Edited", warrantyProductId: live.id }, actorId);
    expect(updated).toMatchObject({ label: "Edited", warrantyProductId: live.id });
  });

  it("the edit form's action reports an item in Trash as not found", async () => {
    const item = await newItem({ deletedAt: new Date() });
    const result = await updateInventoryItem(item.id, null, formData({ label: "Edited", category: "TOOL" }));
    expect(result).toEqual({ error: "Item not found." });
    expect((await db.prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).label).toBe("Drill");
  });

  it("the edit form's action saves a live item", async () => {
    const item = await newItem();
    await expect(updateInventoryItem(item.id, null, formData({ label: "Edited", category: "TOOL" }))).rejects.toThrow(
      `REDIRECT /inventory/${item.id}`,
    );
    expect((await db.prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).label).toBe("Edited");
  });

  it("a sync replay can't edit an item in Trash", async () => {
    const item = await newItem({ deletedAt: new Date() });
    const live = await newItem({ label: "Saw" });
    const { results } = await replay([
      { id: "op-1", entity: "inventoryItem", operation: "update", entityId: item.id, formValues: { label: "Edited" } },
      { id: "op-2", entity: "inventoryItem", operation: "update", entityId: live.id, formValues: { label: "Mitre saw" } },
    ]);
    expect(results).toEqual([
      { id: "op-1", success: false, error: "Inventory item not found" },
      { id: "op-2", success: true },
    ]);
    expect((await db.prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).label).toBe("Drill");
    expect((await db.prisma.inventoryItem.findUniqueOrThrow({ where: { id: live.id } })).updatedById).toBe(actorId);
  });
});

describe("Contract and Product links to records in Trash (#447)", () => {
  it("the commands refuse a create or update linking a Property or Vehicle in Trash", async () => {
    const property = await newProperty();
    const vehicle = await createVehicleCommand({ label: "Car" }, actorId);
    await deletePropertyCommand(property.id);
    await deleteVehicleCommand(vehicle.id);
    const contract = await createContractCommand(contractInput(), actorId);
    const product = await createProductCommand(productInput(), actorId);

    await expect(createContractCommand(contractInput({ propertyId: property.id }), actorId)).rejects.toThrow(
      "That property doesn't exist or is in Trash.",
    );
    await expect(createContractCommand(contractInput({ vehicleId: vehicle.id }), actorId)).rejects.toThrow(
      "That vehicle doesn't exist or is in Trash.",
    );
    await expect(updateContractCommand(contract.id, { propertyId: property.id }, actorId)).rejects.toBeInstanceOf(
      RecordValidationError,
    );
    await expect(createProductCommand(productInput({ propertyId: property.id }), actorId)).rejects.toBeInstanceOf(
      RecordValidationError,
    );
    await expect(updateProductCommand(product.id, { propertyId: property.id }, actorId)).rejects.toBeInstanceOf(
      RecordValidationError,
    );
    expect(await db.prisma.contract.count()).toBe(1);
    expect(await db.prisma.product.count()).toBe(1);
    expect((await db.prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).propertyId).toBeNull();

    await restorePropertyCommand(property.id);
    await updateContractCommand(contract.id, { propertyId: property.id }, actorId);
    expect((await db.prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).propertyId).toBe(property.id);
  });

  it("refuses a new link while the linked record's module is off", async () => {
    const vehicle = await createVehicleCommand({ label: "Car" }, actorId);
    await setModuleEnabled("VEHICLES", false);
    await expect(createContractCommand(contractInput({ vehicleId: vehicle.id }), actorId)).rejects.toThrow(
      "The Vehicles module is off, so this can't be linked to a vehicle.",
    );
  });

  it("keeps a link the record already has when the rest of it is edited", async () => {
    const property = await newProperty();
    const contract = await createContractCommand(contractInput({ propertyId: property.id }), actorId);
    const product = await createProductCommand(productInput({ propertyId: property.id }), actorId);
    await deletePropertyCommand(property.id);

    // The edit form resubmits the current link (#413), so it mustn't block the edit.
    await updateContractCommand(contract.id, { title: "Home insurance", propertyId: property.id }, actorId);
    await updateProductCommand(product.id, { description: "Fridge", propertyId: property.id }, actorId);
    expect(await db.prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).toMatchObject({
      title: "Home insurance",
      propertyId: property.id,
    });
    expect((await db.prisma.product.findUniqueOrThrow({ where: { id: product.id } })).description).toBe("Fridge");
  });

  it("the create form reports the refused link with the values entered", async () => {
    const property = await newProperty();
    await deletePropertyCommand(property.id);
    const result = await createContract(
      null,
      formData({ title: "Insurance", category: "HOME_INSURANCE", provider: "InsureCo", renewalType: "MANUAL_RENEWAL", propertyId: property.id }),
    );
    expect(result).toMatchObject({
      error: "That property doesn't exist or is in Trash.",
      values: { title: "Insurance", propertyId: property.id },
    });
    expect(await db.prisma.contract.count()).toBe(0);
  });

  it("a sync replay can't link a Contract or Product to a record moved to Trash", async () => {
    const property = await newProperty();
    const vehicle = await createVehicleCommand({ label: "Car" }, actorId);
    const contract = await createContractCommand(contractInput(), actorId);
    const product = await createProductCommand(productInput(), actorId);
    await deletePropertyCommand(property.id);
    await deleteVehicleCommand(vehicle.id);

    const contractForm = { title: "Insurance", category: "HOME_INSURANCE", provider: "InsureCo", renewalType: "MANUAL_RENEWAL" };
    const { results } = await replay([
      { id: "op-1", entity: "contract", operation: "update", entityId: contract.id, formValues: { ...contractForm, propertyId: property.id } },
      { id: "op-2", entity: "contract", operation: "create", formValues: { ...contractForm, vehicleId: vehicle.id } },
      { id: "op-3", entity: "product", operation: "update", entityId: product.id, formValues: { description: "Dishwasher", propertyId: property.id } },
      { id: "op-4", entity: "product", operation: "create", formValues: { description: "Oven", propertyId: property.id } },
    ]);
    expect(results).toEqual([
      { id: "op-1", success: false, error: "That property doesn't exist or is in Trash." },
      { id: "op-2", success: false, error: "That vehicle doesn't exist or is in Trash." },
      { id: "op-3", success: false, error: "That property doesn't exist or is in Trash." },
      { id: "op-4", success: false, error: "That property doesn't exist or is in Trash." },
    ]);
    expect(await db.prisma.contract.count()).toBe(1);
    expect(await db.prisma.product.count()).toBe(1);
    expect((await db.prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).propertyId).toBeNull();
    expect((await db.prisma.product.findUniqueOrThrow({ where: { id: product.id } })).propertyId).toBeNull();
  });
});
