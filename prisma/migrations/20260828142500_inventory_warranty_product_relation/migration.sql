-- #241: turn InventoryItem.warrantyProductId into a real FK to products,
-- so a deleted Product clears the link (SetNull) instead of leaving a
-- silently-orphaned reference. SQLite has no ALTER TABLE ADD CONSTRAINT, so
-- this rebuilds inventory_items only.
--
-- Hand-written rather than `prisma migrate diff` output verbatim: this repo
-- has document search FTS5 shadow tables (document_search_fts_*) that must
-- never be dropped/recreated by a migration (see the Document model comment
-- in schema.prisma) and the raw diff includes unrelated DropIndex
-- statements for home_items/vehicle_items that predate this change and are
-- out of scope here.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_inventory_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'OTHER',
    "brand" TEXT,
    "model" TEXT,
    "serialNumber" TEXT,
    "purchaseDate" DATETIME,
    "purchasePrice" REAL,
    "currency" TEXT NOT NULL DEFAULT 'AUD',
    "location" TEXT,
    "warrantyRegistered" BOOLEAN NOT NULL DEFAULT false,
    "warrantyExtended" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "warrantyProductId" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "inventory_items_warrantyProductId_fkey" FOREIGN KEY ("warrantyProductId") REFERENCES "products" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "inventory_items_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "inventory_items_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- Any existing warrantyProductId that doesn't point to a real product row
-- (the field was a free-text input before this migration) is cleared
-- instead of failing the FK check during copy.
INSERT INTO "new_inventory_items"
  ("id", "label", "category", "brand", "model", "serialNumber", "purchaseDate", "purchasePrice", "currency", "location", "warrantyRegistered", "warrantyExtended", "notes", "warrantyProductId", "createdById", "updatedById", "deletedAt", "createdAt", "updatedAt")
SELECT
  i."id", i."label", i."category", i."brand", i."model", i."serialNumber", i."purchaseDate", i."purchasePrice", i."currency", i."location", i."warrantyRegistered", i."warrantyExtended", i."notes",
  CASE WHEN p."id" IS NOT NULL THEN i."warrantyProductId" ELSE NULL END,
  i."createdById", i."updatedById", i."deletedAt", i."createdAt", i."updatedAt"
FROM "inventory_items" i
LEFT JOIN "products" p ON p."id" = i."warrantyProductId";

DROP TABLE "inventory_items";
ALTER TABLE "new_inventory_items" RENAME TO "inventory_items";
CREATE INDEX "inventory_items_warrantyProductId_idx" ON "inventory_items"("warrantyProductId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
