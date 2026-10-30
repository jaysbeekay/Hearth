-- #427: Trip segments, Rental statements, Trades, Tenancies and Property
-- valuations go to Trash (a `deletedAt` column) instead of being deleted
-- outright, and Tenancies gain an `updatedAt` for the stale-edit check.
--
-- Hand-written from `prisma migrate diff`: the diff also wants to drop the
-- document search FTS5 shadow tables, which must stay (see the Document
-- model), and two existing deletedAt indexes outside this change. The four
-- ADD COLUMNs don't rebuild their tables, so the FTS5 sync triggers on the
-- Document tables stay in place.

-- AlterTable
ALTER TABLE "trip_segments" ADD COLUMN "deletedAt" DATETIME;

-- AlterTable
ALTER TABLE "rental_statements" ADD COLUMN "deletedAt" DATETIME;

-- AlterTable
ALTER TABLE "trades" ADD COLUMN "deletedAt" DATETIME;

-- AlterTable
ALTER TABLE "property_valuations" ADD COLUMN "deletedAt" DATETIME;

-- RedefineTables: SQLite can't ADD COLUMN a NOT NULL column without a
-- constant default, so rental_agreements is rebuilt. It has no Documents and
-- no FTS5 triggers. Existing Tenancies take their createdAt as updatedAt.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_rental_agreements" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "propertyId" TEXT NOT NULL,
    "contractId" TEXT,
    "tenantName" TEXT,
    "weeklyRent" REAL NOT NULL,
    "managementFeePercent" REAL,
    "leaseStart" DATETIME,
    "leaseEnd" DATETIME,
    "bondAmount" REAL,
    "currency" TEXT NOT NULL DEFAULT 'AUD',
    "notes" TEXT,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "rental_agreements_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "rental_agreements_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_rental_agreements" ("bondAmount", "contractId", "createdAt", "currency", "id", "leaseEnd", "leaseStart", "managementFeePercent", "notes", "propertyId", "tenantName", "weeklyRent", "updatedAt") SELECT "bondAmount", "contractId", "createdAt", "currency", "id", "leaseEnd", "leaseStart", "managementFeePercent", "notes", "propertyId", "tenantName", "weeklyRent", "createdAt" FROM "rental_agreements";
DROP TABLE "rental_agreements";
ALTER TABLE "new_rental_agreements" RENAME TO "rental_agreements";
CREATE UNIQUE INDEX "rental_agreements_contractId_key" ON "rental_agreements"("contractId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
