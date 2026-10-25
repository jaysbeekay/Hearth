import { prisma } from "@/lib/prisma";
import { getAviationStackConfig } from "@/lib/appSettings";
import { saveTripSegmentFlightData } from "@/lib/commands/trips";

const STALE_MS = 15 * 60 * 1000; // 15 minutes

export const FLIGHT_STATUS_LABELS: Record<string, string> = {
  scheduled: "Scheduled",
  active: "In Air",
  landed: "Landed",
  cancelled: "Cancelled",
  incident: "Incident",
  diverted: "Diverted",
  unknown: "Unknown",
};

export function flightStatusColour(status: string | null | undefined): string {
  switch (status) {
    case "active":
      return "text-accent bg-accent/10 border-accent/20";
    case "landed":
      return "text-success bg-success/10 border-success/20";
    case "cancelled":
    case "incident":
      return "text-danger bg-danger/10 border-danger/20";
    case "diverted":
      return "text-warning bg-warning/10 border-warning/20";
    default:
      return "text-muted bg-muted/10 border-border";
  }
}

/** Returns whether a segment should have its flight status refreshed on page load. */
export function shouldAutoRefresh(segment: {
  type: string;
  startDate: Date | null;
  flightNumber: string | null;
  flightStatusAt: Date | null;
}): boolean {
  if (segment.type !== "FLIGHT") return false;
  if (!segment.flightNumber) return false;
  if (!segment.startDate) return false;

  const now = Date.now();
  const dep = segment.startDate.getTime();
  const THREE_HOURS = 3 * 60 * 60 * 1000;
  const FORTY_EIGHT_HOURS = 48 * 60 * 60 * 1000;

  // Only refresh during the window: 48 h before departure to 3 h after
  const inWindow = dep - now < FORTY_EIGHT_HOURS && now - dep < THREE_HOURS;
  if (!inWindow) return false;

  // Only if stale
  const lastFetch = segment.flightStatusAt?.getTime() ?? 0;
  return now - lastFetch > STALE_MS;
}

interface AviationStackFlight {
  flight_status?: string;
  departure?: {
    iata?: string;
    scheduled?: string;
    estimated?: string;
    actual?: string;
    terminal?: string;
    gate?: string;
    delay?: number | null;
  };
  arrival?: {
    iata?: string;
    scheduled?: string;
    estimated?: string;
    actual?: string;
    terminal?: string;
    gate?: string;
    delay?: number | null;
  };
}

interface AviationStackResponse {
  data?: AviationStackFlight[];
  error?: { code: string; message: string };
}

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export async function refreshFlightStatus(segmentId: string): Promise<void> {
  const segment = await prisma.tripSegment.findUnique({ where: { id: segmentId } });
  if (!segment || segment.type !== "FLIGHT" || !segment.flightNumber) return;

  const { apiKey } = await getAviationStackConfig();
  if (!apiKey) return;

  const flightDate = segment.startDate
    ? segment.startDate.toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  const flightIata = segment.flightNumber.toUpperCase().replace(/\s+/g, "");

  // AviationStack free plan uses HTTP; paid plans support HTTPS.
  // Attempt HTTPS first; if it fails the user should upgrade to the Basic plan.
  const url =
    `https://api.aviationstack.com/v1/flights` +
    `?access_key=${encodeURIComponent(apiKey)}` +
    `&flight_iata=${encodeURIComponent(flightIata)}` +
    `&flight_date=${encodeURIComponent(flightDate)}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return;

    const body = (await res.json()) as AviationStackResponse;
    if (!body.data?.length) return;

    const flight = body.data[0];
    const dep = flight.departure ?? {};
    const arr = flight.arrival ?? {};

    await saveTripSegmentFlightData(segmentId, {
      flightStatus: flight.flight_status ?? null,
      scheduledDep: parseDate(dep.scheduled),
      scheduledArr: parseDate(arr.scheduled),
      estimatedDep: parseDate(dep.estimated),
      estimatedArr: parseDate(arr.estimated),
      actualDep: parseDate(dep.actual),
      actualArr: parseDate(arr.actual),
      depTerminal: dep.terminal ?? null,
      depGate: dep.gate ?? null,
      arrTerminal: arr.terminal ?? null,
      arrGate: arr.gate ?? null,
      departureIata: dep.iata,
      arrivalIata: arr.iata,
      flightStatusAt: new Date(),
    });
  } catch {
    // Network error — update timestamp to avoid hammering the API
    await saveTripSegmentFlightData(segmentId, { flightStatusAt: new Date() }).catch(() => {});
  }
}
