// #471: Inventory create, delete, restore and permanent delete go through
// record commands, from the server actions, import, offline sync and Trash
// retention alike.
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { setupTestDb, createTestUser, setModuleEnabled } from "../helpers/testDb";
import {
  createInventoryItemCommand,
  deleteInventoryItemCommand,
  restoreInventoryItemCommand,
  permanentlyDeleteInventoryItemCommand,
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
});
