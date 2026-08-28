import { prisma } from "@/lib/prisma";
import { getAviationStackConfig } from "@/lib/appSettings";

const EARTH_RADIUS_KM = 6371;

/** Great-circle (haversine) distance between two lat/lng points, in km. */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

interface AviationStackAirport {
  latitude?: string | number;
  longitude?: string | number;
}
interface AviationStackAirportsResponse {
  data?: AviationStackAirport[];
}

// #326 review: computeSegmentDistance runs on every trip-detail page view
// for any segment still missing a distance — without this, a typo'd or
// unrecognized IATA code (or a transient AviationStack outage) would
// re-fetch on *every* page view forever, an unbounded quota burn on a
// free-tier key. A successful lookup is cached permanently (airport
// coordinates don't change); a failed one is retried at most once per TTL.
const NEGATIVE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type CachedAirport = { lat: number | null; lng: number | null; createdAt: Date } | null;
type CacheDecision =
  | { action: "use"; coord: { lat: number; lng: number } }
  | { action: "skip" } // negative cache still within TTL — don't hit the network
  | { action: "fetch" }; // no cache row, or a negative one past its TTL

/**
 * Pure decision logic for getAirportCoordinate's cache check — pulled out
 * so the caching behavior (the part #326's review flagged as the actual
 * risk) is directly unit-testable without mocking Prisma or fetch.
 */
export function airportCacheDecision(cached: CachedAirport, now: number = Date.now()): CacheDecision {
  if (!cached) return { action: "fetch" };
  if (cached.lat != null && cached.lng != null) return { action: "use", coord: { lat: cached.lat, lng: cached.lng } };
  if (now - cached.createdAt.getTime() < NEGATIVE_CACHE_TTL_MS) return { action: "skip" };
  return { action: "fetch" };
}

// #326 review: Number.isFinite(200) is true — an out-of-range coordinate
// from a malformed API response would otherwise pass validation and get
// permanently cached, silently corrupting every distance computed from it.
export function isValidCoordinate(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

/**
 * Airport coordinates never change, so a successful lookup is a permanent
 * cache — each IATA code is looked up via AviationStack at most once, ever,
 * across every household's flight segments. A failed lookup is cached too
 * (null lat/lng), re-attempted at most once per NEGATIVE_CACHE_TTL_MS.
 */
async function getAirportCoordinate(iata: string, apiKey: string): Promise<{ lat: number; lng: number } | null> {
  const cached = await prisma.airportCoordinate.findUnique({ where: { iata } });
  const decision = airportCacheDecision(cached);
  if (decision.action === "use") return decision.coord;
  if (decision.action === "skip") return null;

  let lat: number | null = null;
  let lng: number | null = null;
  try {
    const url =
      `https://api.aviationstack.com/v1/airports` +
      `?access_key=${encodeURIComponent(apiKey)}` +
      `&iata_code=${encodeURIComponent(iata)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (res.ok) {
      const body = (await res.json()) as AviationStackAirportsResponse;
      const airport = body.data?.[0];
      const rawLat = Number(airport?.latitude);
      const rawLng = Number(airport?.longitude);
      if (airport && isValidCoordinate(rawLat, rawLng)) {
        lat = rawLat;
        lng = rawLng;
      }
    }
  } catch {
    // Network/timeout error — fall through and cache a negative result
    // below, same as an unresolved IATA code, so this doesn't retry every
    // page view either.
  }

  await prisma.airportCoordinate
    .upsert({
      where: { iata },
      create: { iata, lat, lng },
      update: { lat, lng, createdAt: new Date() },
    })
    .catch(() => {});
  return lat != null && lng != null ? { lat, lng } : null;
}

export interface DistanceSummary {
  totalKm: number;
  byYear: { year: number; km: number }[];
}

// #13 — grouped by the flight's own startDate (not the trip's), so a trip
// spanning New Year's Eve splits its segments into the years they actually
// happened in.
export function buildDistanceSummary(
  segments: { startDate: Date | null; distanceKm: number | null }[],
): DistanceSummary {
  const withDistance = segments.filter(
    (s): s is { startDate: Date | null; distanceKm: number } => s.distanceKm != null,
  );
  const totalKm = withDistance.reduce((sum, s) => sum + s.distanceKm, 0);

  const kmByYear = new Map<number, number>();
  for (const s of withDistance) {
    const year = s.startDate?.getFullYear();
    if (year == null) continue;
    kmByYear.set(year, (kmByYear.get(year) ?? 0) + s.distanceKm);
  }
  const byYear = [...kmByYear.entries()]
    .sort(([a], [b]) => b - a)
    .map(([year, km]) => ({ year, km }));

  return { totalKm, byYear };
}

/**
 * Computes and caches a FLIGHT segment's great-circle distance, once both
 * IATA codes are known. A no-op if AviationStack isn't configured, the
 * segment isn't a flight, either airport is unknown, or distance is already
 * cached — never re-fetches or re-computes once distanceKm is set.
 */
export async function computeSegmentDistance(segmentId: string): Promise<void> {
  const segment = await prisma.tripSegment.findUnique({ where: { id: segmentId } });
  if (!segment || segment.type !== "FLIGHT") return;
  if (segment.distanceKm != null) return;
  if (!segment.departureIata || !segment.arrivalIata) return;

  const { apiKey } = await getAviationStackConfig();
  if (!apiKey) return;

  const [dep, arr] = await Promise.all([
    getAirportCoordinate(segment.departureIata, apiKey),
    getAirportCoordinate(segment.arrivalIata, apiKey),
  ]);
  if (!dep || !arr) return;

  await prisma.tripSegment
    .update({ where: { id: segmentId }, data: { distanceKm: haversineKm(dep, arr) } })
    .catch(() => {});
}
