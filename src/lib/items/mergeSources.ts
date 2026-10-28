/** Resolve legacy Product and InventoryItem values before the Item migration. */
export type LegacyItemFields = {
  description?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  purchaseDate?: Date | null;
  price?: number | null;
  currency?: string | null;
  notes?: string | null;
};

export type InventoryItemSource = LegacyItemFields & {
  id: string;
  createdAt: Date;
  deletedAt?: Date | null;
};

export type ProductSource = LegacyItemFields & {
  id: string;
  deletedAt?: Date | null;
};

export type ItemMergeResult = {
  fields: LegacyItemFields;
  inventoryItemIds: string[];
  deletedAt: Date | null;
  conflicts: Array<keyof LegacyItemFields>;
};

const fieldNames = ["description", "manufacturer", "model", "serialNumber", "purchaseDate", "price", "currency", "notes"] as const;

function present(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "";
}

function equal(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

/**
 * Earlier InventoryItem values win when several point at one Product. Every
 * different nonblank value is flagged so migration review can inspect it.
 * The caller moves documents from all returned source ids, including Trash.
 */
export function mergeItemSources(product: ProductSource, inventoryItems: InventoryItemSource[]): ItemMergeResult {
  const sorted = [...inventoryItems].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  const fields: LegacyItemFields = {};
  const conflicts = new Set<keyof LegacyItemFields>();

  for (const name of fieldNames) {
    const values = [...sorted.map((item) => item[name]), product[name]].filter(present);
    if (values.length > 1 && values.some((value) => !equal(value, values[0]))) conflicts.add(name);
    if (values.length > 0) {
      // All fields share the Inventory-first rule. Price and currency are
      // checked together by the migration audit before committing a merge.
      (fields as Record<string, unknown>)[name] = values[0];
    }
  }

  const deletedAt = [product.deletedAt, ...sorted.map((item) => item.deletedAt)]
    .filter((date): date is Date => date instanceof Date)
    .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

  return { fields, inventoryItemIds: sorted.map((item) => item.id), deletedAt, conflicts: [...conflicts] };
}
