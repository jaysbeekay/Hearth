/*
  Warnings:

  - You are about to alter the column `isTaxDeductible` on the `contracts` table. The data in that column could be lost. The data in that column will be cast from `Int` to `Boolean`.

*/
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
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "contracts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_contracts" ("billingFrequency", "category", "contactEmail", "contactName", "contactPhone", "contractNumber", "cost", "createdAt", "createdById", "currency", "endDate", "id", "isTaxDeductible", "notes", "noticePeriodDays", "provider", "reminderDaysBefore", "renewalType", "startDate", "status", "title", "updatedAt") SELECT "billingFrequency", "category", "contactEmail", "contactName", "contactPhone", "contractNumber", "cost", "createdAt", "createdById", "currency", "endDate", "id", "isTaxDeductible", "notes", "noticePeriodDays", "provider", "reminderDaysBefore", "renewalType", "startDate", "status", "title", "updatedAt" FROM "contracts";
DROP TABLE "contracts";
ALTER TABLE "new_contracts" RENAME TO "contracts";
CREATE TABLE "new_users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "emailReminders" BOOLEAN NOT NULL DEFAULT true,
    "aiProvider" TEXT,
    "aiApiKeyEncrypted" TEXT,
    "aiModel" TEXT,
    "icalToken" TEXT,
    "dateFormat" TEXT NOT NULL DEFAULT 'DD/MM/YYYY',
    "preferredCurrency" TEXT NOT NULL DEFAULT 'AUD',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_users" ("aiApiKeyEncrypted", "aiModel", "aiProvider", "createdAt", "email", "emailReminders", "icalToken", "id", "name", "passwordHash", "role") SELECT "aiApiKeyEncrypted", "aiModel", "aiProvider", "createdAt", "email", "emailReminders", "icalToken", "id", "name", "passwordHash", "role" FROM "users";
DROP TABLE "users";
ALTER TABLE "new_users" RENAME TO "users";
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "users_icalToken_key" ON "users"("icalToken");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
