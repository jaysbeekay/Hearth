/*
  Warnings:

  - You are about to drop the column `aiApiKeyEncrypted` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `aiModel` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `aiProvider` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `chatApiKeyEncrypted` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `chatModel` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `chatProvider` on the `users` table. All the data in the column will be lost.

*/

-- Preserve any existing per-user AI document-extraction / AI Assistant
-- config by copying it into the household-wide app_settings store before
-- the columns are dropped below. If more than one user had configured
-- these, an ADMIN's config wins (falling back to the earliest-created
-- user otherwise) since only one config can apply household-wide going
-- forward.
INSERT INTO "app_settings" ("key", "value", "encrypted", "updatedAt")
SELECT 'ai.provider', "aiProvider", 0, CURRENT_TIMESTAMP FROM "users"
WHERE "aiProvider" IS NOT NULL
ORDER BY (CASE WHEN "role" = 'ADMIN' THEN 0 ELSE 1 END), "createdAt" ASC
LIMIT 1;

INSERT INTO "app_settings" ("key", "value", "encrypted", "updatedAt")
SELECT 'ai.apiKey', "aiApiKeyEncrypted", 1, CURRENT_TIMESTAMP FROM "users"
WHERE "aiProvider" IS NOT NULL AND "aiApiKeyEncrypted" IS NOT NULL
ORDER BY (CASE WHEN "role" = 'ADMIN' THEN 0 ELSE 1 END), "createdAt" ASC
LIMIT 1;

INSERT INTO "app_settings" ("key", "value", "encrypted", "updatedAt")
SELECT 'ai.model', "aiModel", 0, CURRENT_TIMESTAMP FROM "users"
WHERE "aiProvider" IS NOT NULL AND "aiModel" IS NOT NULL
ORDER BY (CASE WHEN "role" = 'ADMIN' THEN 0 ELSE 1 END), "createdAt" ASC
LIMIT 1;

INSERT INTO "app_settings" ("key", "value", "encrypted", "updatedAt")
SELECT 'chat.provider', "chatProvider", 0, CURRENT_TIMESTAMP FROM "users"
WHERE "chatProvider" IS NOT NULL
ORDER BY (CASE WHEN "role" = 'ADMIN' THEN 0 ELSE 1 END), "createdAt" ASC
LIMIT 1;

INSERT INTO "app_settings" ("key", "value", "encrypted", "updatedAt")
SELECT 'chat.apiKey', "chatApiKeyEncrypted", 1, CURRENT_TIMESTAMP FROM "users"
WHERE "chatProvider" IS NOT NULL AND "chatApiKeyEncrypted" IS NOT NULL
ORDER BY (CASE WHEN "role" = 'ADMIN' THEN 0 ELSE 1 END), "createdAt" ASC
LIMIT 1;

INSERT INTO "app_settings" ("key", "value", "encrypted", "updatedAt")
SELECT 'chat.model', "chatModel", 0, CURRENT_TIMESTAMP FROM "users"
WHERE "chatProvider" IS NOT NULL AND "chatModel" IS NOT NULL
ORDER BY (CASE WHEN "role" = 'ADMIN' THEN 0 ELSE 1 END), "createdAt" ASC
LIMIT 1;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "emailReminders" BOOLEAN NOT NULL DEFAULT true,
    "icalToken" TEXT,
    "dateFormat" TEXT NOT NULL DEFAULT 'DD/MM/YYYY',
    "preferredCurrency" TEXT NOT NULL DEFAULT 'AUD',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "region" TEXT NOT NULL DEFAULT 'en-AU',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totpSecret" TEXT,
    "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "totpRecoveryCodes" TEXT
);
INSERT INTO "new_users" ("createdAt", "dateFormat", "email", "emailReminders", "icalToken", "id", "name", "passwordHash", "preferredCurrency", "region", "role", "timezone", "totpEnabled", "totpRecoveryCodes", "totpSecret") SELECT "createdAt", "dateFormat", "email", "emailReminders", "icalToken", "id", "name", "passwordHash", "preferredCurrency", "region", "role", "timezone", "totpEnabled", "totpRecoveryCodes", "totpSecret" FROM "users";
DROP TABLE "users";
ALTER TABLE "new_users" RENAME TO "users";
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "users_icalToken_key" ON "users"("icalToken");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
