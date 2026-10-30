-- #388: Reminders for a Tenancy's lease end.
--
-- A Tenancy gets its own Reminder thresholds; null means the household
-- default, which every existing Tenancy keeps. The new TENANCY value of
-- NotificationOwnerType needs no SQL: SQLite stores Prisma enums as TEXT.
--
-- Hand-written: `prisma migrate diff` also wants to drop the document search
-- FTS5 shadow tables, which must stay (see the Document model).
ALTER TABLE "rental_agreements" ADD COLUMN "reminderDaysBefore" TEXT;
