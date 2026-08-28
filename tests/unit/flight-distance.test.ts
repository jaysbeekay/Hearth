import { describe, expect, it } from "vitest";
import {
  haversineKm,
  buildDistanceSummary,
  airportCacheDecision,
  isValidCoordinate,
} from "@/lib/integrations/flightDistance";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

describe("haversineKm (#13)", () => {
  it("returns 0 for identical points", () => {
    expect(haversineKm({ lat: 40.6413, lng: -73.7781 }, { lat: 40.6413, lng: -73.7781 })).toBe(0);
  });

  it("matches the well-known JFK–LHR great-circle distance (~5,555 km)", () => {
    const jfk = { lat: 40.6413, lng: -73.7781 };
    const lhr = { lat: 51.47, lng: -0.4543 };
    expect(haversineKm(jfk, lhr)).toBeGreaterThan(5500);
    expect(haversineKm(jfk, lhr)).toBeLessThan(5600);
  });

  it("is symmetric regardless of argument order", () => {
    const a = { lat: -33.9461, lng: 151.1772 };
    const b = { lat: 33.9425, lng: -118.4081 };
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 6);
  });
});

describe("buildDistanceSummary (#13)", () => {
  it("sums only segments with a known distance, ignoring nulls", () => {
    const summary = buildDistanceSummary([
      { startDate: new Date("2026-03-01"), distanceKm: 1000 },
      { startDate: new Date("2026-06-01"), distanceKm: 2000 },
      { startDate: new Date("2026-09-01"), distanceKm: null },
    ]);
    expect(summary.totalKm).toBe(3000);
  });

  it("groups by the segment's own startDate year, newest first", () => {
    const summary = buildDistanceSummary([
      { startDate: new Date("2025-12-31"), distanceKm: 500 },
      { startDate: new Date("2026-01-01"), distanceKm: 700 },
      { startDate: new Date("2026-06-15"), distanceKm: 300 },
    ]);
    expect(summary.byYear).toEqual([
      { year: 2026, km: 1000 },
      { year: 2025, km: 500 },
    ]);
  });

  it("excludes a distance from the per-year breakdown when startDate is unset, but still counts it in the total", () => {
    const summary = buildDistanceSummary([{ startDate: null, distanceKm: 400 }]);
    expect(summary.totalKm).toBe(400);
    expect(summary.byYear).toEqual([]);
  });

  it("returns a zero summary for no segments", () => {
    expect(buildDistanceSummary([])).toEqual({ totalKm: 0, byYear: [] });
  });
});

// #326 review: the actual quota-burn risk lives in this caching decision,
// not in the network/DB plumbing around it — extracted as a pure function
// specifically so it's directly testable without mocking Prisma or fetch.
describe("airportCacheDecision (#13, #326 review)", () => {
  it("fetches fresh when there's no cache row at all", () => {
    expect(airportCacheDecision(null)).toEqual({ action: "fetch" });
  });

  it("uses a successful (positive) cache hit regardless of age", () => {
    const veryOld = new Date(Date.now() - 1000 * SEVEN_DAYS_MS);
    expect(airportCacheDecision({ lat: 40.6413, lng: -73.7781, createdAt: veryOld })).toEqual({
      action: "use",
      coord: { lat: 40.6413, lng: -73.7781 },
    });
  });

  it("skips the network call for a negative-cache row still within the TTL", () => {
    const now = 1_000_000_000_000;
    const justCached = new Date(now - 1000);
    expect(airportCacheDecision({ lat: null, lng: null, createdAt: justCached }, now)).toEqual({ action: "skip" });
  });

  it("retries a negative-cache row once its TTL has expired — this is the fix for the review's blocking finding: a permanently-bad IATA code is retried at most once per 7 days, not on every page view", () => {
    const now = 1_000_000_000_000;
    const expired = new Date(now - SEVEN_DAYS_MS - 1);
    expect(airportCacheDecision({ lat: null, lng: null, createdAt: expired }, now)).toEqual({ action: "fetch" });
  });

  it("treats the TTL boundary as exclusive (exactly at the TTL age retries, not skips)", () => {
    const now = 1_000_000_000_000;
    const exactlyAtTtl = new Date(now - SEVEN_DAYS_MS);
    expect(airportCacheDecision({ lat: null, lng: null, createdAt: exactlyAtTtl }, now)).toEqual({ action: "fetch" });
  });
});

// #326 review: Number.isFinite(200) is true, so a malformed API response
// carrying an out-of-range coordinate would previously pass validation and
// get permanently cached, silently corrupting every distance computed from it.
describe("isValidCoordinate (#13, #326 review)", () => {
  it("accepts real-world coordinates", () => {
    expect(isValidCoordinate(40.6413, -73.7781)).toBe(true);
    expect(isValidCoordinate(-90, -180)).toBe(true);
    expect(isValidCoordinate(90, 180)).toBe(true);
  });

  it("rejects out-of-range latitude/longitude that Number.isFinite alone would accept", () => {
    expect(isValidCoordinate(200, 5)).toBe(false);
    expect(isValidCoordinate(-400, 5)).toBe(false);
    expect(isValidCoordinate(40, 500)).toBe(false);
  });

  it("rejects non-finite values", () => {
    expect(isValidCoordinate(NaN, 5)).toBe(false);
    expect(isValidCoordinate(40, Infinity)).toBe(false);
  });
});
