-- #374: links that serve one Document without a session, for sharing it.
-- Only a new table: no existing table is rebuilt, so the FTS5 shadow tables
-- and triggers stay as they are. (`prisma migrate diff` also lists drops for
-- those shadow tables; they're deliberately left out here.) The two new
-- SecurityEventType values need no SQL: SQLite stores enums as TEXT.

-- CreateTable
CREATE TABLE "document_share_links" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "createdById" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    "openCount" INTEGER NOT NULL DEFAULT 0,
    "lastOpenedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_share_links_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "document_share_links_tokenHash_key" ON "document_share_links"("tokenHash");

-- CreateIndex
CREATE INDEX "document_share_links_documentId_idx" ON "document_share_links"("documentId");

-- CreateIndex
CREATE INDEX "document_share_links_expiresAt_idx" ON "document_share_links"("expiresAt");
