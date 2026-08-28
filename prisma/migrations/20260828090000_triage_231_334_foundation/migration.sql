-- Additive foundation for issue range #231-#334.
-- Keep this migration ALTER-only for existing document tables so FTS5 triggers
-- created by 20260828000000_add_document_search_fts are not dropped.

ALTER TABLE "documents" ADD COLUMN "category" TEXT;
ALTER TABLE "documents" ADD COLUMN "deletedAt" DATETIME;

ALTER TABLE "product_documents" ADD COLUMN "category" TEXT;
ALTER TABLE "product_documents" ADD COLUMN "deletedAt" DATETIME;

ALTER TABLE "home_items" ADD COLUMN "deletedAt" DATETIME;

ALTER TABLE "home_item_documents" ADD COLUMN "category" TEXT;
ALTER TABLE "home_item_documents" ADD COLUMN "deletedAt" DATETIME;

ALTER TABLE "vehicle_items" ADD COLUMN "deletedAt" DATETIME;

ALTER TABLE "vehicle_item_documents" ADD COLUMN "category" TEXT;
ALTER TABLE "vehicle_item_documents" ADD COLUMN "deletedAt" DATETIME;

ALTER TABLE "inventory_items" ADD COLUMN "warrantyRegistered" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "inventory_items" ADD COLUMN "warrantyExtended" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "inventory_items" ADD COLUMN "warrantyProductId" TEXT;

ALTER TABLE "inventory_item_documents" ADD COLUMN "category" TEXT;
ALTER TABLE "inventory_item_documents" ADD COLUMN "deletedAt" DATETIME;

CREATE TABLE "extraction_review_fields" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "ownerType" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "contractId" TEXT,
  "productId" TEXT,
  "fieldName" TEXT NOT NULL,
  "value" TEXT,
  "source" TEXT NOT NULL,
  "confidence" REAL,
  "reviewedAt" DATETIME,
  "reviewedById" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "extraction_review_fields_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "extraction_review_fields_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "extraction_review_fields_ownerType_ownerId_fieldName_key" ON "extraction_review_fields"("ownerType", "ownerId", "fieldName");
CREATE INDEX "extraction_review_fields_contractId_idx" ON "extraction_review_fields"("contractId");
CREATE INDEX "extraction_review_fields_productId_idx" ON "extraction_review_fields"("productId");
CREATE INDEX "extraction_review_fields_ownerType_ownerId_idx" ON "extraction_review_fields"("ownerType", "ownerId");

CREATE INDEX "documents_category_idx" ON "documents"("category");
CREATE INDEX "documents_deletedAt_idx" ON "documents"("deletedAt");
CREATE INDEX "product_documents_category_idx" ON "product_documents"("category");
CREATE INDEX "product_documents_deletedAt_idx" ON "product_documents"("deletedAt");
CREATE INDEX "home_items_deletedAt_idx" ON "home_items"("deletedAt");
CREATE INDEX "home_item_documents_category_idx" ON "home_item_documents"("category");
CREATE INDEX "home_item_documents_deletedAt_idx" ON "home_item_documents"("deletedAt");
CREATE INDEX "vehicle_items_deletedAt_idx" ON "vehicle_items"("deletedAt");
CREATE INDEX "vehicle_item_documents_category_idx" ON "vehicle_item_documents"("category");
CREATE INDEX "vehicle_item_documents_deletedAt_idx" ON "vehicle_item_documents"("deletedAt");
CREATE INDEX "inventory_items_warrantyProductId_idx" ON "inventory_items"("warrantyProductId");
CREATE INDEX "inventory_item_documents_category_idx" ON "inventory_item_documents"("category");
CREATE INDEX "inventory_item_documents_deletedAt_idx" ON "inventory_item_documents"("deletedAt");
