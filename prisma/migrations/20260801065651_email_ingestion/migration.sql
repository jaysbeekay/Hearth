-- CreateTable
CREATE TABLE "processed_email_messages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "messageId" TEXT NOT NULL,
    "processedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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
    "uploadedById" TEXT,
    "source" TEXT NOT NULL DEFAULT 'WEB',
    "fromAddress" TEXT,
    "guessedType" TEXT,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inbox_documents_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_inbox_documents" ("extractedText", "filename", "id", "mimeType", "size", "storedName", "uploadedAt", "uploadedById") SELECT "extractedText", "filename", "id", "mimeType", "size", "storedName", "uploadedAt", "uploadedById" FROM "inbox_documents";
DROP TABLE "inbox_documents";
ALTER TABLE "new_inbox_documents" RENAME TO "inbox_documents";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "processed_email_messages_messageId_key" ON "processed_email_messages"("messageId");
