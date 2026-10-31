-- #355: Vehicles and Properties can be Archived (the household no longer has
-- them) with an `archivedAt` column. Archived is not Trash: the record stays
-- visible, keeps its Documents, and just stops being Due.
--
-- Hand-written from `prisma migrate diff`: the diff also wants to drop the
-- document search FTS5 shadow tables, which must stay (see the Document
-- model). The two ADD COLUMNs don't rebuild their tables, so the FTS5 sync
-- triggers stay in place.

-- AlterTable
ALTER TABLE "vehicles" ADD COLUMN "archivedAt" DATETIME;

-- AlterTable
ALTER TABLE "properties" ADD COLUMN "archivedAt" DATETIME;
