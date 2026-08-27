-- AlterTable
ALTER TABLE "contracts" ADD COLUMN "deletedAt" DATETIME;

-- AlterTable
ALTER TABLE "inventory_items" ADD COLUMN "deletedAt" DATETIME;

-- AlterTable
ALTER TABLE "products" ADD COLUMN "deletedAt" DATETIME;

-- AlterTable
ALTER TABLE "properties" ADD COLUMN "deletedAt" DATETIME;

-- AlterTable
ALTER TABLE "trips" ADD COLUMN "deletedAt" DATETIME;

-- AlterTable
ALTER TABLE "vehicles" ADD COLUMN "deletedAt" DATETIME;
