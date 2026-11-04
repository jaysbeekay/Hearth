-- #380: additive Item Document stage. Legacy rows and files are retained.
CREATE TABLE "item_documents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "itemId" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "sourceDocumentId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'OTHER',
    "extractedText" TEXT,
    "extractionStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "sha256" TEXT,
    "category" TEXT,
    "isImportant" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" DATETIME,
    "supersedesId" TEXT,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "item_documents_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "item_documents_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "item_documents" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "item_documents_sourceKind_sourceDocumentId_key" ON "item_documents"("sourceKind", "sourceDocumentId");
CREATE UNIQUE INDEX "item_documents_supersedesId_key" ON "item_documents"("supersedesId");
CREATE INDEX "item_documents_itemId_idx" ON "item_documents"("itemId");
CREATE INDEX "item_documents_deletedAt_idx" ON "item_documents"("deletedAt");

-- A separate staging FTS table avoids duplicate results in the live search.
-- Search switches to this index only when Item becomes the canonical record.
CREATE VIRTUAL TABLE "item_document_search_fts" USING fts5(
    itemId UNINDEXED,
    docId UNINDEXED,
    filename,
    extractedText,
    tokenize = 'trigram'
);
CREATE TRIGGER "fts_item_documents_ai" AFTER INSERT ON "item_documents" BEGIN
    INSERT INTO "item_document_search_fts" (itemId, docId, filename, extractedText)
    VALUES (NEW."itemId", NEW."id", NEW."filename", NEW."extractedText");
END;
CREATE TRIGGER "fts_item_documents_au" AFTER UPDATE OF "itemId", "filename", "extractedText" ON "item_documents" BEGIN
    UPDATE "item_document_search_fts"
    SET itemId = NEW."itemId", filename = NEW."filename", extractedText = NEW."extractedText"
    WHERE docId = NEW."id";
END;
CREATE TRIGGER "fts_item_documents_ad" AFTER DELETE ON "item_documents" BEGIN
    DELETE FROM "item_document_search_fts" WHERE docId = OLD."id";
END;
