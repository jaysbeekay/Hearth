-- #240: next-service-due reminder for vehicles, reusing the existing
-- reminderDaysBefore threshold config already used by regoExpiry/insuranceExpiry.
ALTER TABLE "vehicles" ADD COLUMN "nextServiceDue" DATETIME;
