/*
  Warnings:

  - You are about to drop the `product_notification_logs` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `vehicle_notification_logs` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `contractId` on the `notification_logs` table. All the data in the column will be lost.
  - Added the required column `ownerId` to the `notification_logs` table without a default value. This is not possible if the table is not empty.
  - Added the required column `ownerType` to the `notification_logs` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "product_notification_logs_productId_channel_thresholdDays_key";

-- DropIndex
DROP INDEX "vehicle_notification_logs_vehicleId_channel_thresholdDays_field_key";

-- AlterTable
ALTER TABLE "inbox_documents" ADD COLUMN "sha256" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_documents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contractId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "extractedText" TEXT,
    "sha256" TEXT,
    "isImportant" BOOLEAN NOT NULL DEFAULT false,
    "supersedesId" TEXT,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "documents_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "documents_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "documents" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_documents" ("contractId", "extractedText", "filename", "id", "mimeType", "size", "storedName", "uploadedAt") SELECT "contractId", "extractedText", "filename", "id", "mimeType", "size", "storedName", "uploadedAt" FROM "documents";
DROP TABLE "documents";
ALTER TABLE "new_documents" RENAME TO "documents";
CREATE UNIQUE INDEX "documents_supersedesId_key" ON "documents"("supersedesId");
CREATE INDEX "documents_sha256_idx" ON "documents"("sha256");
CREATE TABLE "new_home_item_documents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "homeItemId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT,
    "isImportant" BOOLEAN NOT NULL DEFAULT false,
    "supersedesId" TEXT,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "home_item_documents_homeItemId_fkey" FOREIGN KEY ("homeItemId") REFERENCES "home_items" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "home_item_documents_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "home_item_documents" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_home_item_documents" ("filename", "homeItemId", "id", "mimeType", "size", "storedName", "uploadedAt") SELECT "filename", "homeItemId", "id", "mimeType", "size", "storedName", "uploadedAt" FROM "home_item_documents";
DROP TABLE "home_item_documents";
ALTER TABLE "new_home_item_documents" RENAME TO "home_item_documents";
CREATE UNIQUE INDEX "home_item_documents_supersedesId_key" ON "home_item_documents"("supersedesId");
CREATE INDEX "home_item_documents_sha256_idx" ON "home_item_documents"("sha256");
CREATE TABLE "new_inventory_item_documents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "inventoryItemId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT,
    "isImportant" BOOLEAN NOT NULL DEFAULT false,
    "supersedesId" TEXT,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventory_item_documents_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "inventory_item_documents_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "inventory_item_documents" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_inventory_item_documents" ("filename", "id", "inventoryItemId", "mimeType", "size", "storedName", "uploadedAt") SELECT "filename", "id", "inventoryItemId", "mimeType", "size", "storedName", "uploadedAt" FROM "inventory_item_documents";
DROP TABLE "inventory_item_documents";
ALTER TABLE "new_inventory_item_documents" RENAME TO "inventory_item_documents";
CREATE UNIQUE INDEX "inventory_item_documents_supersedesId_key" ON "inventory_item_documents"("supersedesId");
CREATE INDEX "inventory_item_documents_sha256_idx" ON "inventory_item_documents"("sha256");
CREATE TABLE "new_notification_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "field" TEXT NOT NULL DEFAULT '',
    "channel" TEXT NOT NULL,
    "thresholdDays" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "error" TEXT,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Data migration: fold all three legacy notification-log tables into the
-- unified, polymorphic one, preserving every existing row (all as SENT,
-- since only successful sends were ever logged before this migration).
INSERT INTO "new_notification_logs" ("id", "ownerType", "ownerId", "field", "channel", "thresholdDays", "status", "sentAt")
  SELECT "id", 'CONTRACT', "contractId", '', "channel", "thresholdDays", 'SENT', "sentAt" FROM "notification_logs";
INSERT INTO "new_notification_logs" ("id", "ownerType", "ownerId", "field", "channel", "thresholdDays", "status", "sentAt")
  SELECT "id", 'PRODUCT', "productId", '', "channel", "thresholdDays", 'SENT', "sentAt" FROM "product_notification_logs";
INSERT INTO "new_notification_logs" ("id", "ownerType", "ownerId", "field", "channel", "thresholdDays", "status", "sentAt")
  SELECT "id", 'VEHICLE', "vehicleId", "field", "channel", "thresholdDays", 'SENT', "sentAt" FROM "vehicle_notification_logs";
DROP TABLE "notification_logs";
ALTER TABLE "new_notification_logs" RENAME TO "notification_logs";
CREATE INDEX "notification_logs_ownerType_ownerId_idx" ON "notification_logs"("ownerType", "ownerId");
CREATE UNIQUE INDEX "notification_logs_ownerType_ownerId_field_channel_thresholdDays_key" ON "notification_logs"("ownerType", "ownerId", "field", "channel", "thresholdDays");

-- Now safe to drop the legacy tables — their data has been copied above.
DROP TABLE "product_notification_logs";
DROP TABLE "vehicle_notification_logs";
CREATE TABLE "new_product_documents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'OTHER',
    "extractedText" TEXT,
    "sha256" TEXT,
    "isImportant" BOOLEAN NOT NULL DEFAULT false,
    "supersedesId" TEXT,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "product_documents_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "product_documents_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "product_documents" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_product_documents" ("extractedText", "filename", "id", "kind", "mimeType", "productId", "size", "storedName", "uploadedAt") SELECT "extractedText", "filename", "id", "kind", "mimeType", "productId", "size", "storedName", "uploadedAt" FROM "product_documents";
DROP TABLE "product_documents";
ALTER TABLE "new_product_documents" RENAME TO "product_documents";
CREATE UNIQUE INDEX "product_documents_supersedesId_key" ON "product_documents"("supersedesId");
CREATE INDEX "product_documents_sha256_idx" ON "product_documents"("sha256");
CREATE TABLE "new_rental_statement_documents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rentalStatementId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT,
    "isImportant" BOOLEAN NOT NULL DEFAULT false,
    "supersedesId" TEXT,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "rental_statement_documents_rentalStatementId_fkey" FOREIGN KEY ("rentalStatementId") REFERENCES "rental_statements" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "rental_statement_documents_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "rental_statement_documents" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_rental_statement_documents" ("filename", "id", "mimeType", "rentalStatementId", "size", "storedName", "uploadedAt") SELECT "filename", "id", "mimeType", "rentalStatementId", "size", "storedName", "uploadedAt" FROM "rental_statement_documents";
DROP TABLE "rental_statement_documents";
ALTER TABLE "new_rental_statement_documents" RENAME TO "rental_statement_documents";
CREATE UNIQUE INDEX "rental_statement_documents_supersedesId_key" ON "rental_statement_documents"("supersedesId");
CREATE INDEX "rental_statement_documents_sha256_idx" ON "rental_statement_documents"("sha256");
CREATE TABLE "new_trade_documents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tradeId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT,
    "isImportant" BOOLEAN NOT NULL DEFAULT false,
    "supersedesId" TEXT,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "trade_documents_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "trades" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "trade_documents_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "trade_documents" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_trade_documents" ("filename", "id", "mimeType", "size", "storedName", "tradeId", "uploadedAt") SELECT "filename", "id", "mimeType", "size", "storedName", "tradeId", "uploadedAt" FROM "trade_documents";
DROP TABLE "trade_documents";
ALTER TABLE "new_trade_documents" RENAME TO "trade_documents";
CREATE UNIQUE INDEX "trade_documents_supersedesId_key" ON "trade_documents"("supersedesId");
CREATE INDEX "trade_documents_sha256_idx" ON "trade_documents"("sha256");
CREATE TABLE "new_trip_segment_documents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tripSegmentId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT,
    "isImportant" BOOLEAN NOT NULL DEFAULT false,
    "supersedesId" TEXT,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "trip_segment_documents_tripSegmentId_fkey" FOREIGN KEY ("tripSegmentId") REFERENCES "trip_segments" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "trip_segment_documents_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "trip_segment_documents" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_trip_segment_documents" ("filename", "id", "mimeType", "size", "storedName", "tripSegmentId", "uploadedAt") SELECT "filename", "id", "mimeType", "size", "storedName", "tripSegmentId", "uploadedAt" FROM "trip_segment_documents";
DROP TABLE "trip_segment_documents";
ALTER TABLE "new_trip_segment_documents" RENAME TO "trip_segment_documents";
CREATE UNIQUE INDEX "trip_segment_documents_supersedesId_key" ON "trip_segment_documents"("supersedesId");
CREATE INDEX "trip_segment_documents_sha256_idx" ON "trip_segment_documents"("sha256");
CREATE TABLE "new_vehicle_item_documents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vehicleItemId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT,
    "isImportant" BOOLEAN NOT NULL DEFAULT false,
    "supersedesId" TEXT,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "vehicle_item_documents_vehicleItemId_fkey" FOREIGN KEY ("vehicleItemId") REFERENCES "vehicle_items" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "vehicle_item_documents_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "vehicle_item_documents" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_vehicle_item_documents" ("filename", "id", "mimeType", "size", "storedName", "uploadedAt", "vehicleItemId") SELECT "filename", "id", "mimeType", "size", "storedName", "uploadedAt", "vehicleItemId" FROM "vehicle_item_documents";
DROP TABLE "vehicle_item_documents";
ALTER TABLE "new_vehicle_item_documents" RENAME TO "vehicle_item_documents";
CREATE UNIQUE INDEX "vehicle_item_documents_supersedesId_key" ON "vehicle_item_documents"("supersedesId");
CREATE INDEX "vehicle_item_documents_sha256_idx" ON "vehicle_item_documents"("sha256");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "inbox_documents_sha256_idx" ON "inbox_documents"("sha256");
