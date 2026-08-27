-- AlterTable
ALTER TABLE "background_jobs" ADD COLUMN "activeDedupeKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "background_jobs_activeDedupeKey_key" ON "background_jobs"("activeDedupeKey");
