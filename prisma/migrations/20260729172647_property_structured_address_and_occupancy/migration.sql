/*
  Warnings:

  - You are about to drop the column `address` on the `properties` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "properties_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
-- Best-effort migration: the old free-text `address` is copied in full into
-- the new `street` field rather than parsed into suburb/state/postcode/
-- country, since those vary too much by country/format to split reliably.
-- Nothing is lost — users can re-pick their address via the geocode
-- autocomplete to populate the new structured fields precisely.
-- occupancyStatus is backfilled from the existing isRented flag so already-
-- rented properties don't regress to showing as "Owner-occupied".
INSERT INTO "new_properties" ("createdAt", "createdById", "id", "isRented", "occupancyStatus", "label", "street", "lat", "lng", "notes", "updatedAt")
SELECT "createdAt", "createdById", "id", "isRented",
  CASE WHEN "isRented" THEN 'RENTED' ELSE 'OWNER_OCCUPIED' END,
  "label", "address", "lat", "lng", "notes", "updatedAt"
FROM "properties";
DROP TABLE "properties";
ALTER TABLE "new_properties" RENAME TO "properties";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
