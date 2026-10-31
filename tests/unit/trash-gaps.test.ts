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
import { createContract, updateContract } from "@/lib/actions/contracts";
import { createProduct, updateProduct } from "@/lib/actions/products";
import { importContract, importProduct } from "@/lib/actions/import";
import { runTool } from "@/lib/chat/tools";
import { revalidatePath } from "next/cache";
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
    ).rejects.toThrow("That warranty doesn't exist or has been deleted.");
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
      "That property doesn't exist or has been deleted.",
    );
    await expect(createContractCommand(contractInput({ vehicleId: vehicle.id }), actorId)).rejects.toThrow(
      "That vehicle doesn't exist or has been deleted.",
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
      error: "That property doesn't exist or has been deleted.",
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
      { id: "op-1", success: false, error: "That property doesn't exist or has been deleted." },
      { id: "op-2", success: false, error: "That vehicle doesn't exist or has been deleted." },
      { id: "op-3", success: false, error: "That property doesn't exist or has been deleted." },
      { id: "op-4", success: false, error: "That property doesn't exist or has been deleted." },
    ]);
    expect(await db.prisma.contract.count()).toBe(1);
    expect(await db.prisma.product.count()).toBe(1);
    expect((await db.prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).propertyId).toBeNull();
    expect((await db.prisma.product.findUniqueOrThrow({ where: { id: product.id } })).propertyId).toBeNull();
  });
});

describe("review fixes for #446 / #447", () => {
  const contractForm = { title: "Insurance", category: "HOME_INSURANCE", provider: "InsureCo", renewalType: "MANUAL_RENEWAL" };
  const PROPERTY_TRASHED = "That property doesn't exist or has been deleted.";

  it("refuses switching a live link to a Property in Trash", async () => {
    const a = await newProperty("A");
    const b = await newProperty("B");
    const contract = await createContractCommand(contractInput({ propertyId: a.id }), actorId);
    await deletePropertyCommand(b.id);
    await expect(updateContractCommand(contract.id, { propertyId: b.id }, actorId)).rejects.toThrow(PROPERTY_TRASHED);
    expect((await db.prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).propertyId).toBe(a.id);
  });

  it("clears an existing link to a Property in Trash", async () => {
    const property = await newProperty();
    const contract = await createContractCommand(contractInput({ propertyId: property.id }), actorId);
    const product = await createProductCommand(productInput({ propertyId: property.id }), actorId);
    await deletePropertyCommand(property.id);
    await updateContractCommand(contract.id, { propertyId: null }, actorId);
    await updateProductCommand(product.id, { propertyId: null }, actorId);
    expect((await db.prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).propertyId).toBeNull();
    expect((await db.prisma.product.findUniqueOrThrow({ where: { id: product.id } })).propertyId).toBeNull();
  });

  it("the edit forms keep what was entered when the new link is refused", async () => {
    const property = await newProperty();
    await deletePropertyCommand(property.id);
    const contract = await createContractCommand(contractInput(), actorId);
    const product = await createProductCommand(productInput(), actorId);

    const contractResult = await updateContract(
      contract.id,
      null,
      formData({ ...contractForm, title: "Edited insurance", propertyId: property.id }),
    );
    expect(contractResult).toMatchObject({
      error: PROPERTY_TRASHED,
      values: { title: "Edited insurance", propertyId: property.id },
    });
    const productResult = await updateProduct(
      product.id,
      null,
      formData({ description: "Edited dishwasher", propertyId: property.id }),
    );
    expect(productResult).toMatchObject({
      error: PROPERTY_TRASHED,
      values: { description: "Edited dishwasher", propertyId: property.id },
    });
    expect((await db.prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).title).toBe("Insurance");
    expect((await db.prisma.product.findUniqueOrThrow({ where: { id: product.id } })).description).toBe("Dishwasher");
  });

  it("the Warranty create form reports the refused link with the values entered", async () => {
    const property = await newProperty();
    await deletePropertyCommand(property.id);
    const result = await createProduct(null, formData({ description: "Oven", propertyId: property.id }));
    expect(result).toMatchObject({ error: PROPERTY_TRASHED, values: { description: "Oven", propertyId: property.id } });
    expect(await db.prisma.product.count()).toBe(0);
  });

  it("import reports the refused link as an error", async () => {
    const property = await newProperty();
    await deletePropertyCommand(property.id);
    expect(await importContract(formData({ ...contractForm, propertyId: property.id }))).toEqual({ error: PROPERTY_TRASHED });
    expect(await importProduct(formData({ description: "Oven", propertyId: property.id }))).toEqual({ error: PROPERTY_TRASHED });
    expect(await db.prisma.contract.count()).toBe(0);
    expect(await db.prisma.product.count()).toBe(0);
  });

  it("refuses a Warranty's new Property link while the Properties module is off", async () => {
    const property = await newProperty();
    const product = await createProductCommand(productInput(), actorId);
    await setModuleEnabled("HOME", false);
    const off = "The Properties module is off, so this can't be linked to a property.";
    await expect(createProductCommand(productInput({ propertyId: property.id }), actorId)).rejects.toThrow(off);
    await expect(updateProductCommand(product.id, { propertyId: property.id }, actorId)).rejects.toThrow(off);
  });

  it("keeps an existing Vehicle link while the Vehicles module is off", async () => {
    const vehicle = await createVehicleCommand({ label: "Car" }, actorId);
    const contract = await createContractCommand(contractInput({ vehicleId: vehicle.id }), actorId);
    await setModuleEnabled("VEHICLES", false);
    await updateContractCommand(contract.id, { title: "Car insurance", vehicleId: vehicle.id }, actorId);
    expect(await db.prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).toMatchObject({
      title: "Car insurance",
      vehicleId: vehicle.id,
    });
  });

  it("reports a stale edit as stale before checking its links", async () => {
    const property = await newProperty();
    await deletePropertyCommand(property.id);
    const contract = await createContractCommand(contractInput(), actorId);
    const product = await createProductCommand(productInput(), actorId);
    const warranty = await createProductCommand(productInput({ description: "Old TV" }), actorId);
    await deleteProductCommand(warranty.id);
    const item = await newItem();
    const stale = new Date(Date.now() - 60_000);

    await expect(
      updateContractCommand(contract.id, { propertyId: property.id }, actorId, { baseUpdatedAt: stale }),
    ).rejects.toBeInstanceOf(StaleEditError);
    await expect(
      updateProductCommand(product.id, { propertyId: property.id }, actorId, { baseUpdatedAt: stale }),
    ).rejects.toBeInstanceOf(StaleEditError);
    await expect(
      updateInventoryItemCommand(item.id, { warrantyProductId: warranty.id }, actorId, { baseUpdatedAt: stale }),
    ).rejects.toBeInstanceOf(StaleEditError);
    await expect(
      updateInventoryItemCommand(item.id, { label: "x" }, actorId, { baseUpdatedAt: "not a date" }),
    ).rejects.toBeInstanceOf(StaleEditError);

    // The same through a sync replay.
    const { results } = await replay([
      {
        id: "op-stale",
        entity: "contract",
        operation: "update",
        entityId: contract.id,
        baseUpdatedAt: stale.toISOString(),
        formValues: { ...contractForm, propertyId: property.id },
      },
    ]);
    expect(results[0]).toMatchObject({ success: false, error: new StaleEditError().message });
  });

  it("the inventory edit form keeps what was entered when a new warranty link is refused", async () => {
    const warranty = await createProductCommand(productInput({ description: "Old TV" }), actorId);
    await deleteProductCommand(warranty.id);
    const item = await newItem();
    const result = await updateInventoryItem(
      item.id,
      null,
      formData({ label: "Edited drill", category: "TOOL", warrantyProductId: warranty.id }),
    );
    expect(result).toMatchObject({
      error: "That warranty doesn't exist or has been deleted.",
      values: { label: "Edited drill", warrantyProductId: warranty.id },
    });
  });

  it("an inventory update revalidates the Warranty pages it links to and from", async () => {
    const first = await createProductCommand(productInput(), actorId);
    const second = await createProductCommand(productInput({ description: "Fridge" }), actorId);
    const item = await newItem({ warrantyProductId: first.id });
    vi.mocked(revalidatePath).mockClear();
    const updated = await updateInventoryItemCommand(item.id, { warrantyProductId: second.id }, actorId);
    expect(updated.warrantyProductId).toBe(second.id);
    const paths = vi.mocked(revalidatePath).mock.calls.map(([path]) => path);
    expect(paths).toEqual(
      expect.arrayContaining(["/inventory", `/inventory/${item.id}`, "/products", `/products/${first.id}`, `/products/${second.id}`]),
    );
  });

  it("a sync delete of a missing item reports the same message as an update", async () => {
    const { results } = await replay([{ id: "op-del", entity: "inventoryItem", operation: "delete", entityId: "missing" }]);
    expect(results).toEqual([{ id: "op-del", success: false, error: "Inventory item not found" }]);
  });

  it("an Assistant update proposal only checks the links it newly sets", async () => {
    const ctx = { userId: actorId, role: "MEMBER" as const, enabledModules: new Set<never>() };
    const kept = await newProperty("Kept");
    const trashed = await newProperty("Trashed");
    const contract = await createContractCommand(contractInput({ propertyId: kept.id }), actorId);
    await deletePropertyCommand(kept.id);
    await deletePropertyCommand(trashed.id);
    const propose = async (input: Record<string, unknown>) =>
      JSON.parse(await runTool("propose_update_contract", { contractId: contract.id, ...input }, ctx)) as {
        proposed?: boolean;
        error?: string;
      };
    expect(await propose({ title: "Renamed", propertyId: kept.id })).toMatchObject({ proposed: true });
    expect(await propose({ propertyId: trashed.id })).toEqual({ error: PROPERTY_TRASHED });
  });
});
