-- #13: cached great-circle distance per flight segment, plus a permanent
-- IATA-code -> coordinate cache (airport coordinates never change, so each
-- code is looked up via AviationStack at most once across every household).
-- lat/lng are nullable: a null row is a negative-cache entry (the code
-- didn't resolve), so a bad/typo'd IATA code doesn't re-fetch on every
-- page view — see flightDistance.ts's NEGATIVE_CACHE_TTL_MS.
ALTER TABLE "trip_segments" ADD COLUMN "distanceKm" REAL;

CREATE TABLE "airport_coordinates" (
    "iata" TEXT NOT NULL PRIMARY KEY,
    "lat" REAL,
    "lng" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
