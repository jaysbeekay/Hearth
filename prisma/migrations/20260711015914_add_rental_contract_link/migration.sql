-- RedefineTables
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "rental_agreements_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "rental_agreements_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_rental_agreements" ("bondAmount", "createdAt", "currency", "id", "leaseEnd", "leaseStart", "managementFeePercent", "notes", "propertyId", "tenantName", "weeklyRent") SELECT "bondAmount", "createdAt", "currency", "id", "leaseEnd", "leaseStart", "managementFeePercent", "notes", "propertyId", "tenantName", "weeklyRent" FROM "rental_agreements";
DROP TABLE "rental_agreements";
ALTER TABLE "new_rental_agreements" RENAME TO "rental_agreements";
CREATE UNIQUE INDEX "rental_agreements_contractId_key" ON "rental_agreements"("contractId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
