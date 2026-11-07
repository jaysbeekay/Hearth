-- #398: Documents of every kind get their text extracted for Search, not
-- only Contracts' and Products'. Plain ADD COLUMNs, so none of these tables
-- is rebuilt and their #314 triggers survive; only each table's update
-- trigger is replaced, so it carries extractedText into document_search_fts.
--
-- extractionStatus is nullable with no default on purpose: every row that
-- existed before this migration is left NULL, which is what the
-- DOCUMENT_TEXT_BACKFILL job looks for. New rows always get a status.

-- vehicle_item_documents (VEHICLE_ITEM)
ALTER TABLE "vehicle_item_documents" ADD COLUMN "extractedText" TEXT;
ALTER TABLE "vehicle_item_documents" ADD COLUMN "extractionStatus" TEXT;
DROP TRIGGER "fts_vehicle_item_documents_au";
CREATE TRIGGER "fts_vehicle_item_documents_au" AFTER UPDATE OF "filename", "extractedText" ON "vehicle_item_documents" BEGIN
  UPDATE "document_search_fts" SET filename = NEW."filename", extractedText = NEW."extractedText"
  WHERE kind = 'VEHICLE_ITEM' AND docId = NEW."id";
END;

-- trip_segment_documents (TRIP_SEGMENT)
ALTER TABLE "trip_segment_documents" ADD COLUMN "extractedText" TEXT;
ALTER TABLE "trip_segment_documents" ADD COLUMN "extractionStatus" TEXT;
DROP TRIGGER "fts_trip_segment_documents_au";
CREATE TRIGGER "fts_trip_segment_documents_au" AFTER UPDATE OF "filename", "extractedText" ON "trip_segment_documents" BEGIN
  UPDATE "document_search_fts" SET filename = NEW."filename", extractedText = NEW."extractedText"
  WHERE kind = 'TRIP_SEGMENT' AND docId = NEW."id";
END;

-- rental_statement_documents (RENTAL_STATEMENT)
ALTER TABLE "rental_statement_documents" ADD COLUMN "extractedText" TEXT;
ALTER TABLE "rental_statement_documents" ADD COLUMN "extractionStatus" TEXT;
DROP TRIGGER "fts_rental_statement_documents_au";
CREATE TRIGGER "fts_rental_statement_documents_au" AFTER UPDATE OF "filename", "extractedText" ON "rental_statement_documents" BEGIN
  UPDATE "document_search_fts" SET filename = NEW."filename", extractedText = NEW."extractedText"
  WHERE kind = 'RENTAL_STATEMENT' AND docId = NEW."id";
END;

-- home_item_documents (HOME_ITEM)
ALTER TABLE "home_item_documents" ADD COLUMN "extractedText" TEXT;
ALTER TABLE "home_item_documents" ADD COLUMN "extractionStatus" TEXT;
DROP TRIGGER "fts_home_item_documents_au";
CREATE TRIGGER "fts_home_item_documents_au" AFTER UPDATE OF "filename", "extractedText" ON "home_item_documents" BEGIN
  UPDATE "document_search_fts" SET filename = NEW."filename", extractedText = NEW."extractedText"
  WHERE kind = 'HOME_ITEM' AND docId = NEW."id";
END;

-- trade_documents (TRADE)
ALTER TABLE "trade_documents" ADD COLUMN "extractedText" TEXT;
ALTER TABLE "trade_documents" ADD COLUMN "extractionStatus" TEXT;
DROP TRIGGER "fts_trade_documents_au";
CREATE TRIGGER "fts_trade_documents_au" AFTER UPDATE OF "filename", "extractedText" ON "trade_documents" BEGIN
  UPDATE "document_search_fts" SET filename = NEW."filename", extractedText = NEW."extractedText"
  WHERE kind = 'TRADE' AND docId = NEW."id";
END;
