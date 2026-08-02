-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_inbox_documents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "filename" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "extractedText" TEXT,
    "sha256" TEXT,
    "uploadedById" TEXT,
    "source" TEXT NOT NULL DEFAULT 'WEB',
    "fromAddress" TEXT,
    "guessedType" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEEDS_CLASSIFICATION',
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inbox_documents_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_inbox_documents" ("extractedText", "filename", "fromAddress", "guessedType", "id", "mimeType", "sha256", "size", "source", "storedName", "uploadedAt", "uploadedById") SELECT "extractedText", "filename", "fromAddress", "guessedType", "id", "mimeType", "sha256", "size", "source", "storedName", "uploadedAt", "uploadedById" FROM "inbox_documents";
DROP TABLE "inbox_documents";
ALTER TABLE "new_inbox_documents" RENAME TO "inbox_documents";
CREATE INDEX "inbox_documents_sha256_idx" ON "inbox_documents"("sha256");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
