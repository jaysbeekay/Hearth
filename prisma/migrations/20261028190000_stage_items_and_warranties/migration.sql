-- #380 additive stage: legacy Product and InventoryItem tables remain intact.
CREATE TABLE "items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "description" TEXT NOT NULL,
    "manufacturer" TEXT,
    "model" TEXT,
    "vendor" TEXT,
    "serialNumber" TEXT,
    "barcode" TEXT,
    "purchaseDate" DATETIME,
    "price" REAL,
    "currency" TEXT NOT NULL DEFAULT 'AUD',
    "category" TEXT,
    "location" TEXT,
    "propertyId" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "legacyProductId" TEXT,
    "mergeConflictFields" TEXT
);

CREATE UNIQUE INDEX "items_legacyProductId_key" ON "items"("legacyProductId");

CREATE TABLE "warranties" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "itemId" TEXT NOT NULL,
    "endDate" DATETIME,
    "reminderDaysBefore" TEXT,
    "registered" BOOLEAN NOT NULL DEFAULT false,
    "extended" BOOLEAN NOT NULL DEFAULT false,
    "legacyProductId" TEXT,
    CONSTRAINT "warranties_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "warranties_itemId_key" ON "warranties"("itemId");
CREATE UNIQUE INDEX "warranties_legacyProductId_key" ON "warranties"("legacyProductId");

CREATE TABLE "item_legacy_inventories" (
    "inventoryItemId" TEXT NOT NULL PRIMARY KEY,
    "itemId" TEXT NOT NULL,
    CONSTRAINT "item_legacy_inventories_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "item_legacy_inventories_itemId_idx" ON "item_legacy_inventories"("itemId");
