-- The `icalToken` and `password_reset_tokens.token` columns now hold a SHA-256
-- hash rather than the token itself. SQLite has no built-in SHA-256, so the
-- existing plaintext values can't be converted in place — and they shouldn't
-- be kept anyway: they were stored in the clear, so moving to hashed storage
-- has to invalidate them.
--
--  * iCal tokens are cleared. Existing calendar subscriptions stop resolving
--    and each user regenerates a feed URL from Settings. Unavoidable: the new
--    scheme shows the token once at generation and can't reproduce an old one.
--  * Outstanding password-reset and invitation links are deleted. They expire
--    within hours/days anyway; affected users request a new one.

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
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
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
INSERT INTO "new_users" ("createdAt", "dateFormat", "email", "emailReminders", "icalToken", "id", "name", "passwordHash", "preferredCurrency", "region", "role", "timezone", "totpEnabled", "totpRecoveryCodes", "totpSecret") SELECT "createdAt", "dateFormat", "email", "emailReminders", NULL, "id", "name", "passwordHash", "preferredCurrency", "region", "role", "timezone", "totpEnabled", "totpRecoveryCodes", "totpSecret" FROM "users";
DROP TABLE "users";
ALTER TABLE "new_users" RENAME TO "users";
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "users_icalToken_key" ON "users"("icalToken");
CREATE TABLE "new_webhook_endpoints" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT,
    "secretEncrypted" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "webhook_endpoints_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_webhook_endpoints" ("createdAt", "createdById", "enabled", "id", "name", "secret", "url") SELECT "createdAt", "createdById", "enabled", "id", "name", "secret", "url" FROM "webhook_endpoints";
DROP TABLE "webhook_endpoints";
ALTER TABLE "new_webhook_endpoints" RENAME TO "webhook_endpoints";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Plaintext reset/invite tokens can't be rehashed; drop them so no stale
-- plaintext value is ever compared against a hash.
DELETE FROM "password_reset_tokens";
