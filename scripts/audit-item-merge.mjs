#!/usr/bin/env node
// Read-only inventory for the Product + InventoryItem migration (#380).
// Pass a local SQLite copy explicitly; never connect to the live app by default.
import { createClient } from "@libsql/client";
import { stat } from "node:fs/promises";

const databasePath = process.argv[2];
if (!databasePath || !databasePath.startsWith("/") || process.argv.length !== 3) {
  console.error("Usage: node scripts/audit-item-merge.mjs /absolute/path/to/copy.db");
  process.exit(2);
}
const file = await stat(databasePath).catch(() => null);
if (!file?.isFile()) {
  console.error("The database copy must be an existing local file.");
  process.exit(2);
}

const client = createClient({ url: `file:${databasePath}` });
const count = async (sql) => Number((await client.execute(sql)).rows[0].count);

try {
  const result = {
    products: await count("SELECT COUNT(*) AS count FROM products"),
    inventoryItems: await count("SELECT COUNT(*) AS count FROM inventory_items"),
    linkedItems: await count("SELECT COUNT(*) AS count FROM inventory_items WHERE warrantyProductId IS NOT NULL"),
    unlinkedItems: await count("SELECT COUNT(*) AS count FROM inventory_items WHERE warrantyProductId IS NULL"),
    productsWithMultipleLinkedItems: await count(`
      SELECT COUNT(*) AS count FROM (
        SELECT warrantyProductId FROM inventory_items
        WHERE warrantyProductId IS NOT NULL
        GROUP BY warrantyProductId HAVING COUNT(*) > 1
      )`),
    conflictingLinkedFields: {},
    linkedTrashStateDisagreements: await count(`
      SELECT COUNT(*) AS count FROM inventory_items i
      JOIN products p ON p.id = i.warrantyProductId
      WHERE (i.deletedAt IS NULL) != (p.deletedAt IS NULL)`),
    productDocuments: await count("SELECT COUNT(*) AS count FROM product_documents"),
    inventoryDocuments: await count("SELECT COUNT(*) AS count FROM inventory_item_documents"),
    trashedProductDocuments: await count("SELECT COUNT(*) AS count FROM product_documents WHERE deletedAt IS NOT NULL"),
    trashedInventoryDocuments: await count("SELECT COUNT(*) AS count FROM inventory_item_documents WHERE deletedAt IS NOT NULL"),
  };

  // Only count conflicts where Inventory has a value: it is the chosen winner.
  // A Product value still needs explicit preservation or audit before removal.
  const pairs = {
    description: ["label", "description"],
    manufacturer: ["brand", "manufacturer"],
    model: ["model", "model"],
    serialNumber: ["serialNumber", "serialNumber"],
    purchaseDate: ["purchaseDate", "purchaseDate"],
    price: ["purchasePrice", "price"],
    currency: ["currency", "currency"],
    notes: ["notes", "notes"],
  };
  for (const [name, [inventory, product]] of Object.entries(pairs)) {
    result.conflictingLinkedFields[name] = await count(`
      SELECT COUNT(*) AS count FROM inventory_items i
      JOIN products p ON p.id = i.warrantyProductId
      WHERE i."${inventory}" IS NOT NULL AND i."${inventory}" != ''
        AND p."${product}" IS NOT NULL AND p."${product}" != ''
        AND i."${inventory}" != p."${product}"`);
  }

  console.log(JSON.stringify(result, null, 2));
} finally {
  client.close();
}
