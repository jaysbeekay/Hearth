import { z } from "zod";

export const INVENTORY_ITEM_CATEGORIES = [
  "APPLIANCE",
  "ELECTRONICS",
  "FURNITURE",
  "TOOL",
  "CLOTHING",
  "SPORTING",
  "BOOK",
  "MEDIA",
  "OTHER",
] as const;

const emptyToUndefined = (val: unknown) =>
  val == null || (typeof val === "string" && val.trim() === "") ? undefined : val;

export const inventoryItemSchema = z.object({
  label: z.string().trim().min(1, "Label is required").max(200),
  category: z.enum(INVENTORY_ITEM_CATEGORIES).default("OTHER"),
  brand: z.preprocess(emptyToUndefined, z.string().trim().max(100).optional()),
  model: z.preprocess(emptyToUndefined, z.string().trim().max(100).optional()),
  serialNumber: z.preprocess(emptyToUndefined, z.string().trim().max(100).optional()),
  purchaseDate: z.preprocess(emptyToUndefined, z.coerce.date().optional()),
  purchasePrice: z.preprocess(emptyToUndefined, z.coerce.number().min(0).optional()),
  currency: z.string().trim().min(1).max(10).default("AUD"),
  location: z.preprocess(emptyToUndefined, z.string().trim().max(100).optional()),
  notes: z.preprocess(emptyToUndefined, z.string().trim().max(5000).optional()),
});

export type InventoryItemInput = z.infer<typeof inventoryItemSchema>;
