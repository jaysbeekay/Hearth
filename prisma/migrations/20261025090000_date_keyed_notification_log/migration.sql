-- #387 / ADR 0003: key the sent-Reminder log by the Due entry date it was
-- sent for, so moving a date resets its Reminders without any writer
-- clearing the log.
--
-- Existing rows get a null dueDate here, which means stale: kept as history,
-- never counted. Stamping the rows still inside their threshold's window
-- with the record's current date needs the Due policy (notice deadlines,
-- the household timezone), so that backfill runs once in TypeScript on
-- first use after the upgrade: src/lib/notifications/logBackfill.ts.
--
-- Hand-written: `prisma migrate diff` also wants to drop the document search
-- FTS5 shadow tables, which must stay (see the Document model).
ALTER TABLE "notification_logs" ADD COLUMN "dueDate" DATETIME;

DROP INDEX "notification_logs_ownerType_ownerId_field_channel_thresholdDays_key";
CREATE UNIQUE INDEX "notification_logs_ownerType_ownerId_field_channel_thresholdDays_dueDate_key" ON "notification_logs"("ownerType", "ownerId", "field", "channel", "thresholdDays", "dueDate");
