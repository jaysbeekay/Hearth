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

/**
 * Airport coordinates never change, so this is a permanent cache — each
 * IATA code is looked up via AviationStack at most once, ever, across every
 * household's flight segments (a real quota concern on the free tier).
 */
async function getAirportCoordinate(iata: string, apiKey: string): Promise<{ lat: number; lng: number } | null> {
  const cached = await prisma.airportCoordinate.findUnique({ where: { iata } });
  if (cached) return { lat: cached.lat, lng: cached.lng };

  try {
    const url =
      `https://api.aviationstack.com/v1/airports` +
      `?access_key=${encodeURIComponent(apiKey)}` +
      `&iata_code=${encodeURIComponent(iata)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;

    const body = (await res.json()) as AviationStackAirportsResponse;
    const airport = body.data?.[0];
    const lat = Number(airport?.latitude);
    const lng = Number(airport?.longitude);
    if (!airport || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    await prisma.airportCoordinate
      .upsert({ where: { iata }, create: { iata, lat, lng }, update: { lat, lng } })
      .catch(() => {});
    return { lat, lng };
  } catch {
    return null;
  }
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
