-- #353: earlier Terms of a Contract, kept as history when it's renewed.
-- Only a new table: no existing table is rebuilt, so the FTS5 shadow tables
-- and triggers from 20260828000000_add_document_search_fts stay as they are.
-- (`prisma migrate diff` also lists drops for those shadow tables and for two
-- hand-made indexes; they're deliberately left out here.)

-- CreateTable
CREATE TABLE "contract_terms" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contractId" TEXT NOT NULL,
    "startDate" DATETIME,
    "endDate" DATETIME,
    "cost" REAL,
    "currency" TEXT NOT NULL DEFAULT 'AUD',
    "billingFrequency" TEXT,
    "documentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "contract_terms_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "contract_terms_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "contract_terms_contractId_idx" ON "contract_terms"("contractId");

-- CreateIndex
CREATE INDEX "contract_terms_documentId_idx" ON "contract_terms"("documentId");
