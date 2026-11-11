-- #398: Documents of every kind get their text extracted for Search, not
-- only Contracts' and Products'. Plain ADD COLUMNs, so none of these tables
-- is rebuilt and their #314 triggers survive; only each table's update
-- trigger is replaced, so it carries extractedText into document_search_fts.
--
-- extractionStatus is nullable with no default on purpose: every row that
-- existed before this migration is left NULL, which is what the
-- DOCUMENT_TEXT_BACKFILL job looks for. New rows always get a status.
--
-- These _au triggers are now the canonical definitions for their tables
-- (the #314 ones in 20260828000000_add_document_search_fts are superseded).
-- A later migration that rebuilds one of these tables must re-create this
-- version, with "extractedText"; e2e/prepare-db.ts checks for it.
--
-- Rolling back below this release: an older build ignores the new columns,
-- but drop these _au triggers (or restore the #314 ones) before dropping
-- extractedText, and expect its queued DOCUMENT_TEXT_BACKFILL and
-- OCR_DOCUMENT jobs for these kinds to end FAILED (README → Searching inside
-- documents).

-- vehicle_item_documents (VEHICLE_ITEM)
ALTER TABLE "vehicle_item_documents" ADD COLUMN "extractedText" TEXT;
ALTER TABLE "vehicle_item_documents" ADD COLUMN "extractionStatus" TEXT;
DROP TRIGGER IF EXISTS "fts_vehicle_item_documents_au";
CREATE TRIGGER "fts_vehicle_item_documents_au" AFTER UPDATE OF "filename", "extractedText" ON "vehicle_item_documents" BEGIN
  UPDATE "document_search_fts" SET filename = NEW."filename", extractedText = NEW."extractedText"
  WHERE kind = 'VEHICLE_ITEM' AND docId = NEW."id";
END;

-- trip_segment_documents (TRIP_SEGMENT)
ALTER TABLE "trip_segment_documents" ADD COLUMN "extractedText" TEXT;
ALTER TABLE "trip_segment_documents" ADD COLUMN "extractionStatus" TEXT;
DROP TRIGGER IF EXISTS "fts_trip_segment_documents_au";
CREATE TRIGGER "fts_trip_segment_documents_au" AFTER UPDATE OF "filename", "extractedText" ON "trip_segment_documents" BEGIN
  UPDATE "document_search_fts" SET filename = NEW."filename", extractedText = NEW."extractedText"
  WHERE kind = 'TRIP_SEGMENT' AND docId = NEW."id";
END;

-- rental_statement_documents (RENTAL_STATEMENT)
ALTER TABLE "rental_statement_documents" ADD COLUMN "extractedText" TEXT;
ALTER TABLE "rental_statement_documents" ADD COLUMN "extractionStatus" TEXT;
DROP TRIGGER IF EXISTS "fts_rental_statement_documents_au";
CREATE TRIGGER "fts_rental_statement_documents_au" AFTER UPDATE OF "filename", "extractedText" ON "rental_statement_documents" BEGIN
  UPDATE "document_search_fts" SET filename = NEW."filename", extractedText = NEW."extractedText"
  WHERE kind = 'RENTAL_STATEMENT' AND docId = NEW."id";
END;

-- home_item_documents (HOME_ITEM)
ALTER TABLE "home_item_documents" ADD COLUMN "extractedText" TEXT;
ALTER TABLE "home_item_documents" ADD COLUMN "extractionStatus" TEXT;
DROP TRIGGER IF EXISTS "fts_home_item_documents_au";
CREATE TRIGGER "fts_home_item_documents_au" AFTER UPDATE OF "filename", "extractedText" ON "home_item_documents" BEGIN
  UPDATE "document_search_fts" SET filename = NEW."filename", extractedText = NEW."extractedText"
  WHERE kind = 'HOME_ITEM' AND docId = NEW."id";
END;

-- trade_documents (TRADE)
ALTER TABLE "trade_documents" ADD COLUMN "extractedText" TEXT;
ALTER TABLE "trade_documents" ADD COLUMN "extractionStatus" TEXT;
DROP TRIGGER IF EXISTS "fts_trade_documents_au";
CREATE TRIGGER "fts_trade_documents_au" AFTER UPDATE OF "filename", "extractedText" ON "trade_documents" BEGIN
  UPDATE "document_search_fts" SET filename = NEW."filename", extractedText = NEW."extractedText"
  WHERE kind = 'TRADE' AND docId = NEW."id";
END;

-- The backfill looks rows up by status (#398 review).
CREATE INDEX "vehicle_item_documents_extractionStatus_idx" ON "vehicle_item_documents"("extractionStatus");
CREATE INDEX "trip_segment_documents_extractionStatus_idx" ON "trip_segment_documents"("extractionStatus");
CREATE INDEX "rental_statement_documents_extractionStatus_idx" ON "rental_statement_documents"("extractionStatus");
CREATE INDEX "home_item_documents_extractionStatus_idx" ON "home_item_documents"("extractionStatus");
CREATE INDEX "trade_documents_extractionStatus_idx" ON "trade_documents"("extractionStatus");

-- Job priority (#398 review): the backfill's jobs run below everything else,
-- so catching up on old Documents never delays a Reminder check or backup.
ALTER TABLE "background_jobs" ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0;
