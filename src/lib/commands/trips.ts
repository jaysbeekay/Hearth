import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { removeOwnerDocumentFiles } from "@/lib/commands/documents";
import { assertModuleEnabled } from "@/lib/modules/enablement";
import { updateUnlessStale, RecordNotFoundError, type UpdateOptions } from "@/lib/commands/shared";
import type { ClearablePatch } from "@/lib/validation/fullFormUpdate";
import type { TripInput, TripSegmentInput } from "@/lib/validation/travel";
import type { TripSegment } from "@/generated/prisma/client";

// Record commands for Trips and Trip segments (#391, ADR 0003). Every write
// to `trip` / `tripSegment` goes through here: server actions, the offline
// sync handler, Trash retention and the flight-status / distance lookups.
// Callers own sign-in, role checks and Zod parsing; these own the module
// gate, the write, file cleanup and revalidation.
//
// Trips have no Reminders, so there's no sent-Reminder log to clear.

// ── Trip ────────────────────────────────────────────────────────────────────

function revalidateTripLists() {
  revalidatePath("/travel");
  revalidatePath("/dashboard");
}

async function findTrip(id: string) {
  const trip = await prisma.trip.findUnique({ where: { id } });
  if (!trip) throw new RecordNotFoundError("Trip");
  return trip;
}

export async function createTripCommand(input: TripInput, actorId: string) {
  await assertModuleEnabled("TRAVEL");
  const trip = await prisma.trip.create({ data: { ...input, createdById: actorId } });
  revalidateTripLists();
  return trip;
}

// Partial patch: keys left out (or undefined) are not written, and a `null`
// clears the field. A full edit form sends fullFormUpdate()'s patch, where
// every field it submitted blank is `null` (#413).
export async function updateTripCommand(
  id: string,
  patch: ClearablePatch<TripInput>,
  actorId: string,
  options: UpdateOptions = {},
) {
  await assertModuleEnabled("TRAVEL");
  await findTrip(id);
  await updateUnlessStale(options.baseUpdatedAt, (guard) =>
    prisma.trip.updateMany({ where: { id, ...guard }, data: { ...patch, updatedById: actorId } }),
  );
  revalidateTripLists();
  revalidatePath(`/travel/${id}`);
  return findTrip(id);
}

// #287 — soft delete: moves the Trip to Trash. Its segments and their files
// stay intact so restoreTripCommand brings it back as it was.
export async function deleteTripCommand(id: string) {
  await assertModuleEnabled("TRAVEL");
  await findTrip(id);
  await prisma.trip.update({ where: { id }, data: { deletedAt: new Date() } });
  revalidateTripLists();
  revalidatePath("/settings/trash");
}

export async function restoreTripCommand(id: string) {
  await assertModuleEnabled("TRAVEL");
  await findTrip(id);
  await prisma.trip.update({ where: { id }, data: { deletedAt: null } });
  revalidateTripLists();
  revalidatePath(`/travel/${id}`);
  revalidatePath("/settings/trash");
}

export async function permanentlyDeleteTripCommand(id: string) {
  await assertModuleEnabled("TRAVEL");
  await purgeTrip(id);
  revalidateTripLists();
  revalidatePath("/settings/trash");
}

// The row-and-files part of a permanent delete, with no module gate and no
// revalidation. Only for Trash retention (src/lib/trash.ts), which runs from
// a page render (where revalidatePath can't be called) and from the
// scheduler, and purges expired records whether or not the module is on.
export async function purgeTrip(id: string) {
  const existing = await prisma.trip.findUnique({
    where: { id },
    include: { segments: { select: { id: true } } },
  });
  if (!existing) throw new RecordNotFoundError("Trip");
  // The row delete cascades to segments and their Document rows (Trash
  // ones included); their files on disk aren't FK-linked, so they're
  // removed straight after, leaving no files without a row.
  await prisma.trip.delete({ where: { id } });
  for (const segment of existing.segments) {
    await removeOwnerDocumentFiles("TRIP_SEGMENT", segment.id);
  }
}

// ── Trip segment ────────────────────────────────────────────────────────────

export interface TripSegmentScope {
  // When given, the segment must belong to this Trip, otherwise it's
  // reported as not found (the URL-scoped check the forms rely on).
  tripId?: string;
}

async function findTripSegment(id: string, scope: TripSegmentScope = {}) {
  const segment = await prisma.tripSegment.findUnique({ where: { id } });
  if (!segment || (scope.tripId !== undefined && segment.tripId !== scope.tripId)) {
    throw new RecordNotFoundError("Segment");
  }
  return segment;
}

export async function createTripSegmentCommand(tripId: string, input: TripSegmentInput) {
  await assertModuleEnabled("TRAVEL");
  await findTrip(tripId);
  const segment = await prisma.tripSegment.create({ data: { ...input, tripId } });
  revalidatePath(`/travel/${tripId}`);
  return segment;
}

// Partial patch, as for updateTripCommand.
export async function updateTripSegmentCommand(
  id: string,
  patch: ClearablePatch<TripSegmentInput>,
  options: UpdateOptions & TripSegmentScope = {},
) {
  await assertModuleEnabled("TRAVEL");
  const existing = await findTripSegment(id, options);
  await updateUnlessStale(options.baseUpdatedAt, (guard) =>
    prisma.tripSegment.updateMany({ where: { id, ...guard }, data: patch }),
  );
  revalidatePath(`/travel/${existing.tripId}`);
  return findTripSegment(id);
}

// Segments have no Trash of their own (no deletedAt column): deleting one is
// permanent and takes its Documents and their files with it. A whole Trip
// is what goes to Trash.
export async function permanentlyDeleteTripSegmentCommand(id: string, scope: TripSegmentScope = {}) {
  await assertModuleEnabled("TRAVEL");
  const existing = await findTripSegment(id, scope);
  // Cascades to the segment's Document rows; then the files go.
  await prisma.tripSegment.delete({ where: { id } });
  await removeOwnerDocumentFiles("TRIP_SEGMENT", id);
  revalidatePath(`/travel/${existing.tripId}`);
}

// ── Flight lookups ──────────────────────────────────────────────────────────

// What the AviationStack lookups (src/lib/integrations/flightStatus.ts and
// flightDistance.ts) store on a FLIGHT segment. The airport codes are also
// on the segment form, so the lookup only fills them in while they're
// blank and never overwrites what the user typed; the rest aren't on the
// form at all.
export type TripSegmentFlightData = Partial<
  Pick<
    TripSegment,
    | "flightStatus"
    | "scheduledDep"
    | "scheduledArr"
    | "estimatedDep"
    | "estimatedArr"
    | "actualDep"
    | "actualArr"
    | "depTerminal"
    | "depGate"
    | "arrTerminal"
    | "arrGate"
    | "departureIata"
    | "arrivalIata"
    | "flightStatusAt"
    | "distanceKm"
  >
>;

// A narrow write for the lookups' results, with no module gate and no
// revalidation: the Trip page runs the lookups while it renders (where
// revalidatePath can't be called), and that page, like the refresh action
// that also calls it, has already checked the Travel module. Not a general
// segment update: user edits go through updateTripSegmentCommand.
//
// It keeps the segment's updatedAt as it was. updatedAt is what the stale
// check compares an offline edit's base against, and a lookup's result
// isn't an edit, so it mustn't make a queued edit look stale. The write is
// guarded on that same updatedAt: if a user edit lands between the read and
// the write, nothing is written (the next lookup tries again). Returns
// whether the data was saved.
export async function saveTripSegmentFlightData(id: string, data: TripSegmentFlightData): Promise<boolean> {
  const current = await prisma.tripSegment.findUnique({
    where: { id },
    select: { updatedAt: true, departureIata: true, arrivalIata: true },
  });
  if (!current) throw new RecordNotFoundError("Segment");
  const { departureIata, arrivalIata, ...rest } = data;
  const { count } = await prisma.tripSegment.updateMany({
    where: { id, updatedAt: current.updatedAt },
    data: {
      ...rest,
      ...(current.departureIata == null && departureIata ? { departureIata } : {}),
      ...(current.arrivalIata == null && arrivalIata ? { arrivalIata } : {}),
      updatedAt: current.updatedAt,
    },
  });
  return count > 0;
}
