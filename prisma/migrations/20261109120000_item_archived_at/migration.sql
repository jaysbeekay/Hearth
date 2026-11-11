-- #380: Items gain the Archived state Property and Vehicle already have
-- (#355). Additive and nullable; legacy Products and InventoryItems had no
-- archive column, so there is nothing to backfill.

ALTER TABLE "items" ADD COLUMN "archivedAt" DATETIME;
