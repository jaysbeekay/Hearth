-- SPIKE #493 (not for merge): per-device backup tokens and the ciphertext blobs they upload.
CREATE TABLE "device_backup_tokens" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME,
    "revokedAt" DATETIME
);

CREATE TABLE "device_backups" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenId" TEXT NOT NULL,
    "storageName" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "exportedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "device_backups_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "device_backup_tokens" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "device_backup_tokens_tokenHash_key" ON "device_backup_tokens"("tokenHash");
CREATE UNIQUE INDEX "device_backups_storageName_key" ON "device_backups"("storageName");
CREATE INDEX "device_backups_tokenId_createdAt_idx" ON "device_backups"("tokenId", "createdAt");
