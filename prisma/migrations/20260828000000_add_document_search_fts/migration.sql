-- #314: unified FTS5 index across all 9 document tables, replacing the
-- per-table `contains` (substring) scans in /api/search/route.ts with one
-- ranked, indexed query.
--
-- Standalone (not `content=`) table: content is drawn from 9 tables with 9
-- distinct string (cuid) primary keys, not one shared integer rowid, so
-- FTS5's external-content mode (which requires exactly that) doesn't apply.
--
-- `tokenize = 'trigram'`, not the default unicode61/porter: the existing
-- search is genuine leading-wildcard substring matching (e.g. a filename
-- fragment mid-word). A word tokenizer would only match whole tokens and
-- silently drop matches the current implementation finds today. Trigram
-- ships inside SQLite's fts5.c itself since 3.34, reconstructs substring
-- matching when the query is passed as a quoted phrase.
--
-- kind/ownerId/docId are UNINDEXED: identity/plumbing columns, not text to
-- search, and keeping them out of the trigram index avoids nonsense matches
-- against cuids while still allowing them in a plain WHERE clause and
-- keeping them out of bm25()'s positional weight arguments.
CREATE VIRTUAL TABLE "document_search_fts" USING fts5(
  kind UNINDEXED,
  ownerId UNINDEXED,
  docId UNINDEXED,
  filename,
  extractedText,
  tokenize = 'trigram'
);

-- Sync via triggers, not application-level upserts: document rows are also
-- removed by SQLite's own FK cascade when a parent record (Contract,
-- Product, ...) is hard-deleted by src/lib/trash.ts's purge — a path no
-- application code touches, so an upsert-at-every-call-site approach
-- (48 call sites across 12 files, no existing shared choke point) cannot
-- cover it. Triggers fire for cascades and updateMany/deleteMany alike, in
-- the same transaction as the write that caused them.
--
-- NOTE: if a future schema.prisma change to any of these 9 models forces
-- Prisma's SQLite RedefineTables fallback (CREATE new_X / copy / DROP TABLE
-- X / rename X), DROP TABLE silently drops any trigger defined on it, and
-- Prisma has no model-level awareness that these triggers exist, so it will
-- not recreate them. The new migration must re-create the affected table's
-- three triggers verbatim, or e2e/prepare-db.ts's trigger-existence check
-- will fail CI.

-- documents (CONTRACT) — has extractedText
CREATE TRIGGER "fts_documents_ai" AFTER INSERT ON "documents" BEGIN
  INSERT INTO "document_search_fts" (kind, ownerId, docId, filename, extractedText)
  VALUES ('CONTRACT', NEW."contractId", NEW."id", NEW."filename", NEW."extractedText");
END;
CREATE TRIGGER "fts_documents_au" AFTER UPDATE OF "filename", "extractedText" ON "documents" BEGIN
  UPDATE "document_search_fts" SET filename = NEW."filename", extractedText = NEW."extractedText"
  WHERE kind = 'CONTRACT' AND docId = NEW."id";
END;
CREATE TRIGGER "fts_documents_ad" AFTER DELETE ON "documents" BEGIN
  DELETE FROM "document_search_fts" WHERE kind = 'CONTRACT' AND docId = OLD."id";
END;

-- inbox_documents (INBOX) — has extractedText, no owner column
CREATE TRIGGER "fts_inbox_documents_ai" AFTER INSERT ON "inbox_documents" BEGIN
  INSERT INTO "document_search_fts" (kind, ownerId, docId, filename, extractedText)
  VALUES ('INBOX', NULL, NEW."id", NEW."filename", NEW."extractedText");
END;
CREATE TRIGGER "fts_inbox_documents_au" AFTER UPDATE OF "filename", "extractedText" ON "inbox_documents" BEGIN
  UPDATE "document_search_fts" SET filename = NEW."filename", extractedText = NEW."extractedText"
  WHERE kind = 'INBOX' AND docId = NEW."id";
END;
CREATE TRIGGER "fts_inbox_documents_ad" AFTER DELETE ON "inbox_documents" BEGIN
  DELETE FROM "document_search_fts" WHERE kind = 'INBOX' AND docId = OLD."id";
END;

-- product_documents (PRODUCT) — has extractedText
CREATE TRIGGER "fts_product_documents_ai" AFTER INSERT ON "product_documents" BEGIN
  INSERT INTO "document_search_fts" (kind, ownerId, docId, filename, extractedText)
  VALUES ('PRODUCT', NEW."productId", NEW."id", NEW."filename", NEW."extractedText");
END;
CREATE TRIGGER "fts_product_documents_au" AFTER UPDATE OF "filename", "extractedText" ON "product_documents" BEGIN
  UPDATE "document_search_fts" SET filename = NEW."filename", extractedText = NEW."extractedText"
  WHERE kind = 'PRODUCT' AND docId = NEW."id";
END;
CREATE TRIGGER "fts_product_documents_ad" AFTER DELETE ON "product_documents" BEGIN
  DELETE FROM "document_search_fts" WHERE kind = 'PRODUCT' AND docId = OLD."id";
END;

-- trip_segment_documents (TRIP_SEGMENT) — no extractedText column
CREATE TRIGGER "fts_trip_segment_documents_ai" AFTER INSERT ON "trip_segment_documents" BEGIN
  INSERT INTO "document_search_fts" (kind, ownerId, docId, filename, extractedText)
  VALUES ('TRIP_SEGMENT', NEW."tripSegmentId", NEW."id", NEW."filename", NULL);
END;
CREATE TRIGGER "fts_trip_segment_documents_au" AFTER UPDATE OF "filename" ON "trip_segment_documents" BEGIN
  UPDATE "document_search_fts" SET filename = NEW."filename"
  WHERE kind = 'TRIP_SEGMENT' AND docId = NEW."id";
END;
CREATE TRIGGER "fts_trip_segment_documents_ad" AFTER DELETE ON "trip_segment_documents" BEGIN
  DELETE FROM "document_search_fts" WHERE kind = 'TRIP_SEGMENT' AND docId = OLD."id";
END;

-- rental_statement_documents (RENTAL_STATEMENT) — no extractedText column
CREATE TRIGGER "fts_rental_statement_documents_ai" AFTER INSERT ON "rental_statement_documents" BEGIN
  INSERT INTO "document_search_fts" (kind, ownerId, docId, filename, extractedText)
  VALUES ('RENTAL_STATEMENT', NEW."rentalStatementId", NEW."id", NEW."filename", NULL);
END;
CREATE TRIGGER "fts_rental_statement_documents_au" AFTER UPDATE OF "filename" ON "rental_statement_documents" BEGIN
  UPDATE "document_search_fts" SET filename = NEW."filename"
  WHERE kind = 'RENTAL_STATEMENT' AND docId = NEW."id";
END;
CREATE TRIGGER "fts_rental_statement_documents_ad" AFTER DELETE ON "rental_statement_documents" BEGIN
  DELETE FROM "document_search_fts" WHERE kind = 'RENTAL_STATEMENT' AND docId = OLD."id";
END;

-- home_item_documents (HOME_ITEM) — no extractedText column
CREATE TRIGGER "fts_home_item_documents_ai" AFTER INSERT ON "home_item_documents" BEGIN
  INSERT INTO "document_search_fts" (kind, ownerId, docId, filename, extractedText)
  VALUES ('HOME_ITEM', NEW."homeItemId", NEW."id", NEW."filename", NULL);
END;
CREATE TRIGGER "fts_home_item_documents_au" AFTER UPDATE OF "filename" ON "home_item_documents" BEGIN
  UPDATE "document_search_fts" SET filename = NEW."filename"
  WHERE kind = 'HOME_ITEM' AND docId = NEW."id";
END;
CREATE TRIGGER "fts_home_item_documents_ad" AFTER DELETE ON "home_item_documents" BEGIN
  DELETE FROM "document_search_fts" WHERE kind = 'HOME_ITEM' AND docId = OLD."id";
END;

-- vehicle_item_documents (VEHICLE_ITEM) — no extractedText column
CREATE TRIGGER "fts_vehicle_item_documents_ai" AFTER INSERT ON "vehicle_item_documents" BEGIN
  INSERT INTO "document_search_fts" (kind, ownerId, docId, filename, extractedText)
  VALUES ('VEHICLE_ITEM', NEW."vehicleItemId", NEW."id", NEW."filename", NULL);
END;
CREATE TRIGGER "fts_vehicle_item_documents_au" AFTER UPDATE OF "filename" ON "vehicle_item_documents" BEGIN
  UPDATE "document_search_fts" SET filename = NEW."filename"
  WHERE kind = 'VEHICLE_ITEM' AND docId = NEW."id";
END;
CREATE TRIGGER "fts_vehicle_item_documents_ad" AFTER DELETE ON "vehicle_item_documents" BEGIN
  DELETE FROM "document_search_fts" WHERE kind = 'VEHICLE_ITEM' AND docId = OLD."id";
END;

-- inventory_item_documents (INVENTORY_ITEM) — no extractedText column
CREATE TRIGGER "fts_inventory_item_documents_ai" AFTER INSERT ON "inventory_item_documents" BEGIN
  INSERT INTO "document_search_fts" (kind, ownerId, docId, filename, extractedText)
  VALUES ('INVENTORY_ITEM', NEW."inventoryItemId", NEW."id", NEW."filename", NULL);
END;
CREATE TRIGGER "fts_inventory_item_documents_au" AFTER UPDATE OF "filename" ON "inventory_item_documents" BEGIN
  UPDATE "document_search_fts" SET filename = NEW."filename"
  WHERE kind = 'INVENTORY_ITEM' AND docId = NEW."id";
END;
CREATE TRIGGER "fts_inventory_item_documents_ad" AFTER DELETE ON "inventory_item_documents" BEGIN
  DELETE FROM "document_search_fts" WHERE kind = 'INVENTORY_ITEM' AND docId = OLD."id";
END;

-- trade_documents (TRADE) — no extractedText column
CREATE TRIGGER "fts_trade_documents_ai" AFTER INSERT ON "trade_documents" BEGIN
  INSERT INTO "document_search_fts" (kind, ownerId, docId, filename, extractedText)
  VALUES ('TRADE', NEW."tradeId", NEW."id", NEW."filename", NULL);
END;
CREATE TRIGGER "fts_trade_documents_au" AFTER UPDATE OF "filename" ON "trade_documents" BEGIN
  UPDATE "document_search_fts" SET filename = NEW."filename"
  WHERE kind = 'TRADE' AND docId = NEW."id";
END;
CREATE TRIGGER "fts_trade_documents_ad" AFTER DELETE ON "trade_documents" BEGIN
  DELETE FROM "document_search_fts" WHERE kind = 'TRADE' AND docId = OLD."id";
END;

-- Backfill: populate the FTS table from every row that existed before this
-- migration. Runs automatically on every environment via the existing
-- `prisma migrate deploy` call in docker-entrypoint.sh — no separate ops
-- step. A fresh install has empty source tables, so this is a no-op there.
INSERT INTO "document_search_fts" (kind, ownerId, docId, filename, extractedText)
SELECT 'CONTRACT', "contractId", "id", "filename", "extractedText" FROM "documents";

INSERT INTO "document_search_fts" (kind, ownerId, docId, filename, extractedText)
SELECT 'INBOX', NULL, "id", "filename", "extractedText" FROM "inbox_documents";

INSERT INTO "document_search_fts" (kind, ownerId, docId, filename, extractedText)
SELECT 'PRODUCT', "productId", "id", "filename", "extractedText" FROM "product_documents";

INSERT INTO "document_search_fts" (kind, ownerId, docId, filename, extractedText)
SELECT 'TRIP_SEGMENT', "tripSegmentId", "id", "filename", NULL FROM "trip_segment_documents";

INSERT INTO "document_search_fts" (kind, ownerId, docId, filename, extractedText)
SELECT 'RENTAL_STATEMENT', "rentalStatementId", "id", "filename", NULL FROM "rental_statement_documents";

INSERT INTO "document_search_fts" (kind, ownerId, docId, filename, extractedText)
SELECT 'HOME_ITEM', "homeItemId", "id", "filename", NULL FROM "home_item_documents";

INSERT INTO "document_search_fts" (kind, ownerId, docId, filename, extractedText)
SELECT 'VEHICLE_ITEM', "vehicleItemId", "id", "filename", NULL FROM "vehicle_item_documents";

INSERT INTO "document_search_fts" (kind, ownerId, docId, filename, extractedText)
SELECT 'INVENTORY_ITEM', "inventoryItemId", "id", "filename", NULL FROM "inventory_item_documents";

INSERT INTO "document_search_fts" (kind, ownerId, docId, filename, extractedText)
SELECT 'TRADE', "tradeId", "id", "filename", NULL FROM "trade_documents";
