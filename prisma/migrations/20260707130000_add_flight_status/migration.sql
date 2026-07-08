-- AlterTable: add flight-status tracking fields to trip_segments
ALTER TABLE "trip_segments" ADD COLUMN "flightNumber"   TEXT;
ALTER TABLE "trip_segments" ADD COLUMN "departureIata"  TEXT;
ALTER TABLE "trip_segments" ADD COLUMN "arrivalIata"    TEXT;
ALTER TABLE "trip_segments" ADD COLUMN "flightStatus"   TEXT;
ALTER TABLE "trip_segments" ADD COLUMN "scheduledDep"   DATETIME;
ALTER TABLE "trip_segments" ADD COLUMN "scheduledArr"   DATETIME;
ALTER TABLE "trip_segments" ADD COLUMN "estimatedDep"   DATETIME;
ALTER TABLE "trip_segments" ADD COLUMN "estimatedArr"   DATETIME;
ALTER TABLE "trip_segments" ADD COLUMN "actualDep"      DATETIME;
ALTER TABLE "trip_segments" ADD COLUMN "actualArr"      DATETIME;
ALTER TABLE "trip_segments" ADD COLUMN "depTerminal"    TEXT;
ALTER TABLE "trip_segments" ADD COLUMN "depGate"        TEXT;
ALTER TABLE "trip_segments" ADD COLUMN "arrTerminal"    TEXT;
ALTER TABLE "trip_segments" ADD COLUMN "arrGate"        TEXT;
ALTER TABLE "trip_segments" ADD COLUMN "flightStatusAt" DATETIME;
