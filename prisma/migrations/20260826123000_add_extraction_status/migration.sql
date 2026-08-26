ALTER TABLE "documents" ADD COLUMN "extractionStatus" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "product_documents" ADD COLUMN "extractionStatus" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "inbox_documents" ADD COLUMN "extractionStatus" TEXT NOT NULL DEFAULT 'PENDING';
