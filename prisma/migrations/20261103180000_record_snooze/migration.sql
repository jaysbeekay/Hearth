-- #354: Contracts, Warranties (products) and Vehicles can be snoozed: out of
-- Needs attention and Reminders until `snoozedUntil`, while the record's
-- dates still match `snoozedFor`. `snoozedById` names who snoozed it.
--
-- Hand-written from `prisma migrate diff`: the diff also wants to drop the
-- document search FTS5 shadow tables and rebuild these tables, which would
-- drop the FTS5 sync triggers (see the Document model). Plain ADD COLUMNs
-- keep the tables, and the triggers, in place; SQLite allows a REFERENCES
-- clause on an added column whose default is NULL.

-- AlterTable
ALTER TABLE "contracts" ADD COLUMN "snoozedUntil" DATETIME;
ALTER TABLE "contracts" ADD COLUMN "snoozedFor" TEXT;
ALTER TABLE "contracts" ADD COLUMN "snoozedById" TEXT REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "products" ADD COLUMN "snoozedUntil" DATETIME;
ALTER TABLE "products" ADD COLUMN "snoozedFor" TEXT;
ALTER TABLE "products" ADD COLUMN "snoozedById" TEXT REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "vehicles" ADD COLUMN "snoozedUntil" DATETIME;
ALTER TABLE "vehicles" ADD COLUMN "snoozedFor" TEXT;
ALTER TABLE "vehicles" ADD COLUMN "snoozedById" TEXT REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
