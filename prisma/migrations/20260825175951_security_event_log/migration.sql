-- CreateTable
CREATE TABLE "security_event_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT,
    "detail" TEXT,
    "address" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "security_event_logs_createdAt_idx" ON "security_event_logs"("createdAt");
