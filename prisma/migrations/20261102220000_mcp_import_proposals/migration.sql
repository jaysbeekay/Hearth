-- #529: records proposed for import over MCP, held until a household member
-- approves them. Hand-written from `prisma migrate diff`: the diff also wants
-- to drop the document search FTS5 shadow tables, which must stay (see the
-- Document model).

-- CreateTable
CREATE TABLE "mcp_import_proposals" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "tokenLabel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "recordId" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "mcp_import_proposals_status_createdAt_idx" ON "mcp_import_proposals"("status", "createdAt");
