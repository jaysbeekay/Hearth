-- Rename products.name -> products.description (preserving data) and add
-- products.model as a new nullable column.
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_products" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "description" TEXT NOT NULL,
    "manufacturer" TEXT,
    "model" TEXT,
    "vendor" TEXT,
    "serialNumber" TEXT,
    "barcode" TEXT,
    "purchaseDate" DATETIME,
    "warrantyEndDate" DATETIME,
    "price" REAL,
    "currency" TEXT NOT NULL DEFAULT 'AUD',
    "notes" TEXT,
    "reminderDaysBefore" TEXT DEFAULT '30,14,7,1',
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "products_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_products" ("barcode", "createdAt", "createdById", "currency", "description", "id", "manufacturer", "notes", "price", "purchaseDate", "reminderDaysBefore", "serialNumber", "updatedAt", "vendor", "warrantyEndDate") SELECT "barcode", "createdAt", "createdById", "currency", "name", "id", "manufacturer", "notes", "price", "purchaseDate", "reminderDaysBefore", "serialNumber", "updatedAt", "vendor", "warrantyEndDate" FROM "products";
DROP TABLE "products";
ALTER TABLE "new_products" RENAME TO "products";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
