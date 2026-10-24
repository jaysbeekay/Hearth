-- #396: every Document kind can be moved to Trash and carry a Document type.
-- Trip segment, Rental statement and Trade Documents were the three kinds
-- without these columns. Plain ADD COLUMN (no table rebuild), so the FTS5
-- sync triggers from 20260828000000_add_document_search_fts stay in place.

-- AlterTable
ALTER TABLE "trip_segment_documents" ADD COLUMN "category" TEXT;
ALTER TABLE "trip_segment_documents" ADD COLUMN "deletedAt" DATETIME;

-- AlterTable
ALTER TABLE "rental_statement_documents" ADD COLUMN "category" TEXT;
ALTER TABLE "rental_statement_documents" ADD COLUMN "deletedAt" DATETIME;

-- AlterTable
ALTER TABLE "trade_documents" ADD COLUMN "category" TEXT;
ALTER TABLE "trade_documents" ADD COLUMN "deletedAt" DATETIME;

-- CreateIndex
CREATE INDEX "trip_segment_documents_category_idx" ON "trip_segment_documents"("category");

-- CreateIndex
CREATE INDEX "trip_segment_documents_deletedAt_idx" ON "trip_segment_documents"("deletedAt");

-- CreateIndex
CREATE INDEX "rental_statement_documents_category_idx" ON "rental_statement_documents"("category");

-- CreateIndex
CREATE INDEX "rental_statement_documents_deletedAt_idx" ON "rental_statement_documents"("deletedAt");

-- CreateIndex
CREATE INDEX "trade_documents_category_idx" ON "trade_documents"("category");

-- CreateIndex
CREATE INDEX "trade_documents_deletedAt_idx" ON "trade_documents"("deletedAt");
