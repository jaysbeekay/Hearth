-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_contracts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "contractNumber" TEXT,
    "startDate" DATETIME,
    "endDate" DATETIME,
    "renewalType" TEXT NOT NULL DEFAULT 'MANUAL_RENEWAL',
    "noticePeriodDays" INTEGER,
    "cost" REAL,
    "currency" TEXT NOT NULL DEFAULT 'AUD',
    "billingFrequency" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "contactName" TEXT,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "notes" TEXT,
    "reminderDaysBefore" TEXT DEFAULT '30,14,7,1',
    "isTaxDeductible" BOOLEAN NOT NULL DEFAULT false,
    "extractionPending" BOOLEAN NOT NULL DEFAULT false,
    "extractionConfirmedAt" DATETIME,
    "createdById" TEXT NOT NULL,
    "propertyId" TEXT,
    "vehicleId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "contracts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "contracts_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "contracts_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_contracts" ("billingFrequency", "category", "contactEmail", "contactName", "contactPhone", "contractNumber", "cost", "createdAt", "createdById", "currency", "endDate", "id", "isTaxDeductible", "notes", "noticePeriodDays", "propertyId", "provider", "reminderDaysBefore", "renewalType", "startDate", "status", "title", "updatedAt", "vehicleId") SELECT "billingFrequency", "category", "contactEmail", "contactName", "contactPhone", "contractNumber", "cost", "createdAt", "createdById", "currency", "endDate", "id", "isTaxDeductible", "notes", "noticePeriodDays", "propertyId", "provider", "reminderDaysBefore", "renewalType", "startDate", "status", "title", "updatedAt", "vehicleId" FROM "contracts";
DROP TABLE "contracts";
ALTER TABLE "new_contracts" RENAME TO "contracts";
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
    "extractionPending" BOOLEAN NOT NULL DEFAULT false,
    "extractionConfirmedAt" DATETIME,
    "createdById" TEXT NOT NULL,
    "propertyId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "products_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "products_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_products" ("barcode", "createdAt", "createdById", "currency", "description", "id", "manufacturer", "model", "notes", "price", "propertyId", "purchaseDate", "reminderDaysBefore", "serialNumber", "updatedAt", "vendor", "warrantyEndDate") SELECT "barcode", "createdAt", "createdById", "currency", "description", "id", "manufacturer", "model", "notes", "price", "propertyId", "purchaseDate", "reminderDaysBefore", "serialNumber", "updatedAt", "vendor", "warrantyEndDate" FROM "products";
DROP TABLE "products";
ALTER TABLE "new_products" RENAME TO "products";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
