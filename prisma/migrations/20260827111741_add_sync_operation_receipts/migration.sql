-- CreateTable
CREATE TABLE "sync_operation_receipts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "opId" TEXT NOT NULL,
    "success" BOOLEAN,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "sync_operation_receipts_userId_opId_key" ON "sync_operation_receipts"("userId", "opId");
