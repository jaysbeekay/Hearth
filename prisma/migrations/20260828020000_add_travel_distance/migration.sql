-- #13: cached great-circle distance per flight segment, plus a permanent
-- IATA-code -> coordinate cache (airport coordinates never change, so each
-- code is looked up via AviationStack at most once across every household).
ALTER TABLE "trip_segments" ADD COLUMN "distanceKm" REAL;

CREATE TABLE "airport_coordinates" (
    "iata" TEXT NOT NULL PRIMARY KEY,
    "lat" REAL NOT NULL,
    "lng" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
