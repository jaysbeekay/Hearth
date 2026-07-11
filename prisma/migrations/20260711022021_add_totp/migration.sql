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
    "aiProvider" TEXT,
    "aiApiKeyEncrypted" TEXT,
    "aiModel" TEXT,
    "icalToken" TEXT,
    "dateFormat" TEXT NOT NULL DEFAULT 'DD/MM/YYYY',
    "preferredCurrency" TEXT NOT NULL DEFAULT 'AUD',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totpSecret" TEXT,
    "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "totpRecoveryCodes" TEXT
);
INSERT INTO "new_users" ("aiApiKeyEncrypted", "aiModel", "aiProvider", "createdAt", "dateFormat", "email", "emailReminders", "icalToken", "id", "name", "passwordHash", "preferredCurrency", "role", "timezone") SELECT "aiApiKeyEncrypted", "aiModel", "aiProvider", "createdAt", "dateFormat", "email", "emailReminders", "icalToken", "id", "name", "passwordHash", "preferredCurrency", "role", "timezone" FROM "users";
DROP TABLE "users";
ALTER TABLE "new_users" RENAME TO "users";
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "users_icalToken_key" ON "users"("icalToken");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
