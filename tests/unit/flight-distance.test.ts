import { describe, expect, it } from "vitest";
import { haversineKm, buildDistanceSummary } from "@/lib/integrations/flightDistance";

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
