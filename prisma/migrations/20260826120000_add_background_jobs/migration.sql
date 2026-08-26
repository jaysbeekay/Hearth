CREATE TABLE "background_jobs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "type" TEXT NOT NULL,
  "payload" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leasedUntil" DATETIME,
  "startedAt" DATETIME,
  "finishedAt" DATETIME,
  "lastError" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "background_jobs_status_availableAt_idx" ON "background_jobs"("status", "availableAt");
