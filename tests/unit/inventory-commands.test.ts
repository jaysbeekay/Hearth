// #471: Inventory create, delete, restore and permanent delete go through
// record commands, from the server actions, import, offline sync and Trash
// retention alike.
import { mkdir, writeFile, access, utimes } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { setupTestDb, createTestUser, setModuleEnabled } from "../helpers/testDb";
import {
  createInventoryItemCommand,
  deleteInventoryItemCommand,
  restoreInventoryItemCommand,
  permanentlyDeleteInventoryItemCommand,
  purgeInventoryItem,
  ItemNotInTrashError,
} from "@/lib/commands/inventory";
import { createProductCommand, deleteProductCommand } from "@/lib/commands/products";
import { RecordNotFoundError, RecordValidationError } from "@/lib/commands/shared";
import { ModuleDisabledError } from "@/lib/modules/enablement";
import {
  createInventoryItem,
  deleteInventoryItem,
  restoreInventoryItem,
  permanentlyDeleteInventoryItem,
} from "@/lib/actions/inventory";
import { importInventoryItem } from "@/lib/actions/import";
import { purgeExpiredTrash, TRASH_RETENTION_DAYS } from "@/lib/trash";
import { productSchema } from "@/lib/validation/product";
import { inventoryItemSchema } from "@/lib/validation/inventory";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { removeOwnerDocumentFiles } from "@/lib/commands/documents";
import { reconcileDocumentStore } from "@/lib/documentStore";
import "@/lib/storage"; // registers each kind's reconcile target
import { purgeLegacyInventoryStage, syncLegacyInventory } from "@/lib/items/syncLegacyItem";
import { syncLegacyDocument } from "@/lib/items/syncLegacyDocument";
import { itemCutoverReadiness } from "@/lib/items/cutoverReadiness";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/commands/documents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/commands/documents")>();
  return { ...actual, removeOwnerDocumentFiles: vi.fn(actual.removeOwnerDocumentFiles) };
});
vi.mock("@/lib/items/syncLegacyItem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/items/syncLegacyItem")>();
  return {
    ...actual,
    purgeLegacyInventoryStage: vi.fn(actual.purgeLegacyInventoryStage),
    syncLegacyInventory: vi.fn(actual.syncLegacyInventory),
  };
});
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
  await setModuleEnabled("INVENTORY", true);
});

const WARRANTY_REFUSED = "That warranty doesn't exist or has been deleted.";

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

const itemInput = (extra: Record<string, unknown> = {}) =>
  inventoryItemSchema.parse({ label: "Drill", category: "TOOL", ...extra });

async function trashedWarranty() {
  const warranty = await createProductCommand(productSchema.parse({ description: "Old TV" }), actorId);
  await deleteProductCommand(warranty.id);
  return warranty;
}

async function exists(p: string) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function attachFile(inventoryItemId: string) {
  const dir = path.join(db.uploadsDir, "inventory-items", inventoryItemId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "stored.pdf"), "%PDF-1.4 test");
  await db.prisma.inventoryItemDocument.create({
    data: { inventoryItemId, filename: "receipt.pdf", storedName: "stored.pdf", mimeType: "application/pdf", size: 13 },
  });
  return dir;
}

const row = (id: string) => db.prisma.inventoryItem.findUnique({ where: { id } });

describe("Inventory create command", () => {
  it("creates an item linked to a live warranty and revalidates its pages", async () => {
    const warranty = await createProductCommand(productSchema.parse({ description: "Drill" }), actorId);
    const item = await createInventoryItemCommand(itemInput({ warrantyProductId: warranty.id }), actorId);
    expect(item).toMatchObject({ label: "Drill", createdById: actorId, warrantyProductId: warranty.id });
    const paths = vi.mocked(revalidatePath).mock.calls.map(([p]) => p);
    expect(paths).toEqual(expect.arrayContaining(["/inventory", `/inventory/${item.id}`, `/products/${warranty.id}`]));
  });

  it("refuses a link to a warranty in Trash or missing, and writes nothing", async () => {
    const warranty = await trashedWarranty();
    await expect(createInventoryItemCommand(itemInput({ warrantyProductId: warranty.id }), actorId)).rejects.toThrow(
      WARRANTY_REFUSED,
    );
    await expect(
      createInventoryItemCommand(itemInput({ warrantyProductId: "missing" }), actorId),
    ).rejects.toBeInstanceOf(RecordValidationError);
    expect(await db.prisma.inventoryItem.count()).toBe(0);
  });

  it("is refused while the Inventory module is off", async () => {
    await setModuleEnabled("INVENTORY", false);
    await expect(createInventoryItemCommand(itemInput(), actorId)).rejects.toBeInstanceOf(ModuleDisabledError);
  });

  it("the create form reports the refused link with the values entered", async () => {
    const warranty = await trashedWarranty();
    const result = await createInventoryItem(
      null,
      formData({ label: "Drill", category: "TOOL", warrantyProductId: warranty.id }),
    );
    expect(result).toMatchObject({ error: WARRANTY_REFUSED, values: { label: "Drill", warrantyProductId: warranty.id } });
    expect(await db.prisma.inventoryItem.count()).toBe(0);
  });

  it("the create form saves an item with no warranty", async () => {
    await expect(createInventoryItem(null, formData({ label: "Drill", category: "TOOL" }))).rejects.toThrow(
      /^REDIRECT \/inventory\//,
    );
    expect(await db.prisma.inventoryItem.count()).toBe(1);
  });

  it("import creates the item through the command", async () => {
    // Import's form has no warranty field, so it can't link one at all; the
    // command's own revalidation of the new item's page shows it was used.
    const result = await importInventoryItem(formData({ label: "Drill", warrantyProductId: "ignored" }));
    expect(result).toMatchObject({ success: "Saved" });
    const item = await db.prisma.inventoryItem.findUniqueOrThrow({ where: { id: result.id } });
    expect(item).toMatchObject({ createdById: actorId, warrantyProductId: null });
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith(`/inventory/${item.id}`);
  });

  it("a sync replay can't create an item linked to a warranty in Trash", async () => {
    const warranty = await trashedWarranty();
    const { results } = await replay([
      { id: "op-1", entity: "inventoryItem", operation: "create", formValues: { label: "Drill", warrantyProductId: warranty.id } },
      { id: "op-2", entity: "inventoryItem", operation: "create", formValues: { label: "Saw" } },
    ]);
    expect(results).toEqual([
      { id: "op-1", success: false, error: WARRANTY_REFUSED },
      expect.objectContaining({ id: "op-2", success: true }),
    ]);
    expect((await db.prisma.inventoryItem.findMany()).map((i) => i.label)).toEqual(["Saw"]);
  });
});

describe("Inventory delete and restore commands", () => {
  it("moves an item to Trash and revalidates the Trash page", async () => {
    const item = await createInventoryItemCommand(itemInput(), actorId);
    await deleteInventoryItemCommand(item.id);
    expect((await row(item.id))?.deletedAt).toBeInstanceOf(Date);
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/settings/trash");
  });

  it("deleting an item already in Trash keeps its original Trash date", async () => {
    const deletedAt = new Date("2026-10-01T00:00:00Z");
    const item = await db.prisma.inventoryItem.create({ data: { label: "Drill", createdById: actorId, deletedAt } });
    await deleteInventoryItemCommand(item.id);
    expect((await row(item.id))?.deletedAt).toEqual(deletedAt);
    expect(await deleteInventoryItem(item.id).catch((e: Error) => e.message)).toBe("REDIRECT /inventory");
    expect((await row(item.id))?.deletedAt).toEqual(deletedAt);
  });

  it("a replayed sync delete of an item in Trash succeeds without resetting its Trash date", async () => {
    const deletedAt = new Date("2026-10-01T00:00:00Z");
    const item = await db.prisma.inventoryItem.create({ data: { label: "Drill", createdById: actorId, deletedAt } });
    const { results } = await replay([{ id: "op-del", entity: "inventoryItem", operation: "delete", entityId: item.id }]);
    expect(results).toEqual([{ id: "op-del", success: true }]);
    expect((await row(item.id))?.deletedAt).toEqual(deletedAt);
  });

  it("reports a missing item as not found", async () => {
    await expect(deleteInventoryItemCommand("missing")).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(restoreInventoryItemCommand("missing")).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(permanentlyDeleteInventoryItemCommand("missing")).rejects.toBeInstanceOf(RecordNotFoundError);
    expect(await deleteInventoryItem("missing")).toEqual({ error: "Item not found." });
    expect(await restoreInventoryItem("missing")).toEqual({ error: "Item not found." });
    expect(await permanentlyDeleteInventoryItem("missing")).toEqual({ error: "Item not found." });
  });

  it("restore brings the item back and revalidates its page", async () => {
    const item = await db.prisma.inventoryItem.create({
      data: { label: "Drill", createdById: actorId, deletedAt: new Date() },
    });
    expect(await restoreInventoryItem(item.id)).toEqual({ success: "Restored." });
    expect((await row(item.id))?.deletedAt).toBeNull();
    const paths = vi.mocked(revalidatePath).mock.calls.map(([p]) => p);
    expect(paths).toEqual(expect.arrayContaining(["/inventory", `/inventory/${item.id}`, "/settings/trash"]));
  });
});

describe("Inventory permanent delete", () => {
  it("removes the item, its Document rows and its files", async () => {
    const item = await db.prisma.inventoryItem.create({
      data: { label: "Drill", createdById: actorId, deletedAt: new Date() },
    });
    const dir = await attachFile(item.id);
    expect(await permanentlyDeleteInventoryItem(item.id)).toEqual({ success: "Deleted permanently." });
    expect(await row(item.id)).toBeNull();
    expect(await db.prisma.inventoryItemDocument.count({ where: { inventoryItemId: item.id } })).toBe(0);
    expect(await exists(dir)).toBe(false);
  });

  it("Trash retention purges an expired item and its files", async () => {
    const expired = new Date(Date.now() - (TRASH_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000);
    const item = await db.prisma.inventoryItem.create({ data: { label: "Drill", createdById: actorId, deletedAt: expired } });
    const kept = await db.prisma.inventoryItem.create({ data: { label: "Saw", createdById: actorId, deletedAt: new Date() } });
    const dir = await attachFile(item.id);
    await purgeExpiredTrash();
    expect(await row(item.id)).toBeNull();
    expect(await exists(dir)).toBe(false);
    expect(await row(kept.id)).not.toBeNull();
  });

  it("a file-removal failure after the row is gone reports a pending cleanup, and the files are swept later", async () => {
    // Row first, then files, as every purge does (#251, #413): if removing
    // the files fails, the item is already gone, so the action says it was
    // deleted and its files are pending, and the document-store
    // reconciliation (run by the scheduler) removes them once they're stale.
    const item = await db.prisma.inventoryItem.create({
      data: { label: "Drill", createdById: actorId, deletedAt: new Date() },
    });
    const dir = await attachFile(item.id);
    vi.mocked(removeOwnerDocumentFiles).mockRejectedValueOnce(new Error("EACCES"));

    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await permanentlyDeleteInventoryItem(item.id)).toEqual({
      success: "Deleted permanently. Its files will be cleaned up shortly.",
    });
    expect(await row(item.id)).toBeNull();
    expect(await exists(path.join(dir, "stored.pdf"))).toBe(true);

    const old = new Date(Date.now() - 60 * 60 * 1000);
    await utimes(path.join(dir, "stored.pdf"), old, old);
    const report = await reconcileDocumentStore();
    expect(report.orphanedFilesRemoved).toBeGreaterThanOrEqual(1);
    expect(await exists(path.join(dir, "stored.pdf"))).toBe(false);
  });

  it("Trash retention carries on past an item whose files couldn't be removed", async () => {
    const expired = new Date(Date.now() - (TRASH_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000);
    const first = await db.prisma.inventoryItem.create({ data: { label: "Drill", createdById: actorId, deletedAt: expired } });
    const second = await db.prisma.inventoryItem.create({ data: { label: "Saw", createdById: actorId, deletedAt: expired } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(removeOwnerDocumentFiles).mockRejectedValueOnce(new Error("EACCES"));
    await purgeExpiredTrash();
    expect(await row(first.id)).toBeNull();
    expect(await row(second.id)).toBeNull();
  });

  it("refuses to purge an item that was restored, and leaves its row and files", async () => {
    // Trash retention lists expired items, then purges them one by one; a
    // restore can land in between (#522 review).
    const item = await db.prisma.inventoryItem.create({ data: { label: "Drill", createdById: actorId } });
    const dir = await attachFile(item.id);
    await expect(purgeInventoryItem(item.id)).rejects.toBeInstanceOf(ItemNotInTrashError);
    expect(await permanentlyDeleteInventoryItem(item.id)).toEqual({
      error: "That item has been restored, so it wasn't deleted.",
    });
    expect(await row(item.id)).not.toBeNull();
    expect(await db.prisma.inventoryItemDocument.count({ where: { inventoryItemId: item.id } })).toBe(1);
    expect(await exists(path.join(dir, "stored.pdf"))).toBe(true);
  });

  it("a retention purge leaves an item deleted again since its cutoff", async () => {
    const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const item = await db.prisma.inventoryItem.create({
      data: { label: "Drill", createdById: actorId, deletedAt: new Date() },
    });
    expect(await purgeInventoryItem(item.id, { deletedBefore: cutoff })).toBe(false);
    expect(await row(item.id)).not.toBeNull();
  });

  it("a second purge of the same item reports it not found", async () => {
    const item = await db.prisma.inventoryItem.create({
      data: { label: "Drill", createdById: actorId, deletedAt: new Date() },
    });
    expect(await purgeInventoryItem(item.id)).toBe(true);
    await expect(purgeInventoryItem(item.id)).rejects.toBeInstanceOf(RecordNotFoundError);
    expect(await permanentlyDeleteInventoryItem(item.id)).toEqual({ error: "Item not found." });
  });
});

// #380 × #471: the staged Item mirror lives inside the Inventory record
// commands, so every writer (form, import, sync, Trash) keeps the stage in
// step exactly once per write.
describe("Inventory commands keep the staged Item mirror in step (#380)", () => {
  const link = (inventoryItemId: string) =>
    db.prisma.itemLegacyInventory.findUnique({ where: { inventoryItemId }, include: { item: true } });

  it("create, update, delete and restore each mirror the item", async () => {
    const item = await createInventoryItemCommand(itemInput(), actorId);
    const staged = await link(item.id);
    expect(staged?.item).toMatchObject({ description: "Drill", deletedAt: null });

    const { updateInventoryItemCommand } = await import("@/lib/commands/inventory");
    await updateInventoryItemCommand(item.id, { label: "Cordless drill" }, actorId);
    expect((await link(item.id))?.item.description).toBe("Cordless drill");

    await deleteInventoryItemCommand(item.id);
    expect((await link(item.id))?.item.deletedAt).not.toBeNull();
    await restoreInventoryItemCommand(item.id);
    expect((await link(item.id))?.item.deletedAt).toBeNull();
    expect(await db.prisma.itemLegacyInventory.count()).toBe(1);
    expect((await itemCutoverReadiness()).problems).toEqual([]);
    expect(revalidatePath).toHaveBeenCalledWith("/items");
  });

  it("import and a sync replay mirror the items they create", async () => {
    const imported = await importInventoryItem(formData({ label: "Ladder" }));
    expect(imported).toMatchObject({ success: "Saved" });
    const { results } = await replay([
      { id: "op-1", entity: "inventoryItem", operation: "create", formValues: { label: "Saw" } },
    ]);
    expect(results).toEqual([expect.objectContaining({ id: "op-1", success: true })]);
    const items = await db.prisma.inventoryItem.findMany();
    expect(items.map((i) => i.label).sort()).toEqual(["Ladder", "Saw"]);
    for (const source of items) expect(await link(source.id)).not.toBeNull();
    expect((await itemCutoverReadiness()).problems).toEqual([]);
  });

  it("a permanent delete retires the staged item and its staged Documents", async () => {
    const item = await createInventoryItemCommand(itemInput(), actorId);
    await attachFile(item.id);
    const doc = await db.prisma.inventoryItemDocument.findFirstOrThrow({ where: { inventoryItemId: item.id } });
    await syncLegacyDocument("INVENTORY_ITEM", doc.id);
    expect(await db.prisma.itemDocument.count()).toBe(1);
    await deleteInventoryItemCommand(item.id);

    expect(await permanentlyDeleteInventoryItem(item.id)).toEqual({ success: "Deleted permanently." });
    expect(await link(item.id)).toBeNull();
    expect(await db.prisma.item.count()).toBe(0);
    expect(await db.prisma.itemDocument.count()).toBe(0);
    expect((await itemCutoverReadiness()).problems).toEqual([]);
  });

  it("a failed stage retirement doesn't fail the purge, and Trash retention repairs the stage", async () => {
    const item = await createInventoryItemCommand(itemInput(), actorId);
    await deleteInventoryItemCommand(item.id);
    vi.mocked(purgeLegacyInventoryStage).mockRejectedValueOnce(new Error("disk full"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await permanentlyDeleteInventoryItem(item.id)).toEqual({ success: "Deleted permanently." });
    expect(await row(item.id)).toBeNull();
    expect(error).toHaveBeenCalled();
    expect((await itemCutoverReadiness()).ready).toBe(false);

    await purgeExpiredTrash();
    expect(await db.prisma.itemLegacyInventory.count()).toBe(0);
    expect((await itemCutoverReadiness()).problems).toEqual([]);
    error.mockRestore();
  });

  it("a failing mirror rolls the legacy write back, so the two never disagree", async () => {
    const item = await createInventoryItemCommand(itemInput(), actorId);
    vi.mocked(syncLegacyInventory).mockRejectedValueOnce(new Error("mirror failed"));
    await expect(deleteInventoryItemCommand(item.id)).rejects.toThrow("mirror failed");
    expect((await row(item.id))?.deletedAt).toBeNull();
  });
});
