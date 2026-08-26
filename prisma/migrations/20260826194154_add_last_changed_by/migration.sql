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
    "updatedById" TEXT,
    "propertyId" TEXT,
    "vehicleId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "contracts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "contracts_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "contracts_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "contracts_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_contracts" ("billingFrequency", "category", "contactEmail", "contactName", "contactPhone", "contractNumber", "cost", "createdAt", "createdById", "currency", "endDate", "extractionConfirmedAt", "extractionPending", "id", "isTaxDeductible", "notes", "noticePeriodDays", "propertyId", "provider", "reminderDaysBefore", "renewalType", "startDate", "status", "title", "updatedAt", "vehicleId") SELECT "billingFrequency", "category", "contactEmail", "contactName", "contactPhone", "contractNumber", "cost", "createdAt", "createdById", "currency", "endDate", "extractionConfirmedAt", "extractionPending", "id", "isTaxDeductible", "notes", "noticePeriodDays", "propertyId", "provider", "reminderDaysBefore", "renewalType", "startDate", "status", "title", "updatedAt", "vehicleId" FROM "contracts";
DROP TABLE "contracts";
ALTER TABLE "new_contracts" RENAME TO "contracts";
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
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "inventory_items_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "inventory_items_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_inventory_items" ("brand", "category", "createdAt", "createdById", "currency", "id", "label", "location", "model", "notes", "purchaseDate", "purchasePrice", "serialNumber", "updatedAt") SELECT "brand", "category", "createdAt", "createdById", "currency", "id", "label", "location", "model", "notes", "purchaseDate", "purchasePrice", "serialNumber", "updatedAt" FROM "inventory_items";
DROP TABLE "inventory_items";
ALTER TABLE "new_inventory_items" RENAME TO "inventory_items";
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
    "updatedById" TEXT,
    "propertyId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "products_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "products_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "products_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_products" ("barcode", "createdAt", "createdById", "currency", "description", "extractionConfirmedAt", "extractionPending", "id", "manufacturer", "model", "notes", "price", "propertyId", "purchaseDate", "reminderDaysBefore", "serialNumber", "updatedAt", "vendor", "warrantyEndDate") SELECT "barcode", "createdAt", "createdById", "currency", "description", "extractionConfirmedAt", "extractionPending", "id", "manufacturer", "model", "notes", "price", "propertyId", "purchaseDate", "reminderDaysBefore", "serialNumber", "updatedAt", "vendor", "warrantyEndDate" FROM "products";
DROP TABLE "products";
ALTER TABLE "new_products" RENAME TO "products";
CREATE TABLE "new_properties" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT NOT NULL,
    "street" TEXT,
    "suburb" TEXT,
    "state" TEXT,
    "postcode" TEXT,
    "country" TEXT,
    "lat" REAL,
    "lng" REAL,
    "notes" TEXT,
    "isRented" BOOLEAN NOT NULL DEFAULT false,
    "occupancyStatus" TEXT NOT NULL DEFAULT 'OWNER_OCCUPIED',
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "properties_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "properties_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_properties" ("country", "createdAt", "createdById", "id", "isRented", "label", "lat", "lng", "notes", "occupancyStatus", "postcode", "state", "street", "suburb", "updatedAt") SELECT "country", "createdAt", "createdById", "id", "isRented", "label", "lat", "lng", "notes", "occupancyStatus", "postcode", "state", "street", "suburb", "updatedAt" FROM "properties";
DROP TABLE "properties";
ALTER TABLE "new_properties" RENAME TO "properties";
CREATE TABLE "new_trips" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "destination" TEXT,
    "startDate" DATETIME,
    "endDate" DATETIME,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "trips_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "trips_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_trips" ("createdAt", "createdById", "destination", "endDate", "id", "notes", "startDate", "title", "updatedAt") SELECT "createdAt", "createdById", "destination", "endDate", "id", "notes", "startDate", "title", "updatedAt" FROM "trips";
DROP TABLE "trips";
ALTER TABLE "new_trips" RENAME TO "trips";
CREATE TABLE "new_vehicles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT NOT NULL,
    "make" TEXT,
    "model" TEXT,
    "year" INTEGER,
    "colour" TEXT,
    "licensePlate" TEXT,
    "vin" TEXT,
    "regoExpiry" DATETIME,
    "insuranceExpiry" DATETIME,
    "reminderDaysBefore" TEXT DEFAULT '30,14,7,1',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "vehicles_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "vehicles_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_vehicles" ("colour", "createdAt", "createdById", "id", "insuranceExpiry", "label", "licensePlate", "make", "model", "notes", "regoExpiry", "reminderDaysBefore", "updatedAt", "vin", "year") SELECT "colour", "createdAt", "createdById", "id", "insuranceExpiry", "label", "licensePlate", "make", "model", "notes", "regoExpiry", "reminderDaysBefore", "updatedAt", "vin", "year" FROM "vehicles";
DROP TABLE "vehicles";
ALTER TABLE "new_vehicles" RENAME TO "vehicles";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
