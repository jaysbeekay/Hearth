"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { formToTripInput, formToTripSegmentInput } from "@/lib/formMappers";
import { prisma } from "@/lib/prisma";
import { fullFormUpdate } from "@/lib/validation/fullFormUpdate";
import { tripSchema, tripSegmentSchema } from "@/lib/validation/travel";
import { addDocumentCommand } from "@/lib/commands/documents";
import {
  createTripCommand,
  updateTripCommand,
  deleteTripCommand,
  restoreTripCommand,
  permanentlyDeleteTripCommand,
  createTripSegmentCommand,
  updateTripSegmentCommand,
  deleteTripSegmentCommand,
  restoreTripSegmentCommand,
  permanentlyDeleteTripSegmentCommand,
} from "@/lib/commands/trips";
import { RecordNotFoundError, RecordValidationError, StaleEditError } from "@/lib/commands/shared";
import { formDataToStringValues } from "@/lib/form-state";
import { isModuleEnabled } from "@/lib/modules/enablement";
import type { ActionState } from "@/lib/actions/auth";
import { describeUploadRejection } from "@/lib/uploadValidation";

const TRIP_FORM_FIELDS = ["title", "destination", "startDate", "endDate", "notes"];

const TRIP_SEGMENT_FORM_FIELDS = [
  "type",
  "title",
  "provider",
  "confirmationCode",
  "startDate",
  "endDate",
  "location",
  "cost",
  "currency",
  "notes",
  "flightNumber",
  "departureIata",
  "arrivalIata",
];

function firstIssueMessage(error: { issues: { message: string }[] }) {
  return error.issues[0]?.message ?? "Invalid input";
}

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Not signed in");
  if (!(await isModuleEnabled("TRAVEL"))) throw new Error("Travel module is disabled");
  if (session.user.role === "READONLY") throw new Error("Your account has read-only access.");
  return session.user;
}

// Turns a command's not-found / stale-edit error into the ActionState the
// form shows; anything else is unexpected and rethrown. (requireUser has
// already refused a disabled Travel module, so the command's
// ModuleDisabledError can't reach here.)
function commandError(error: unknown, notFound: string): ActionState {
  if (error instanceof RecordNotFoundError) return { error: notFound };
  // RecordValidationError: a segment restore refused while its Trip is in
  // Trash.
  if (error instanceof StaleEditError || error instanceof RecordValidationError) return { error: error.message };
  throw error;
}

export async function createTrip(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();

  const parsed = tripSchema.safeParse(formToTripInput(formData));
  if (!parsed.success) {
    return {
      error: firstIssueMessage(parsed.error),
      values: formDataToStringValues(formData, TRIP_FORM_FIELDS),
    };
  }

  let tripId: string;
  try {
    tripId = (await createTripCommand(parsed.data, user.id)).id;
  } catch (error) {
    return commandError(error, "Trip not found.");
  }
  redirect(`/travel/${tripId}`);
}

export async function updateTrip(
  tripId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();

  const parsed = tripSchema.safeParse(formToTripInput(formData));
  if (!parsed.success) {
    return {
      error: firstIssueMessage(parsed.error),
      values: formDataToStringValues(formData, TRIP_FORM_FIELDS),
    };
  }

  try {
    await updateTripCommand(tripId, fullFormUpdate(tripSchema, parsed.data, formData), user.id);
  } catch (error) {
    return commandError(error, "Trip not found.");
  }
  redirect(`/travel/${tripId}`);
}

// #287 — soft-delete: see the equivalent comment on deleteContract (contracts.ts).
export async function deleteTrip(tripId: string): Promise<ActionState> {
  await requireUser();
  try {
    await deleteTripCommand(tripId);
  } catch (error) {
    return commandError(error, "Trip not found.");
  }
  redirect("/travel");
}

export async function restoreTrip(tripId: string): Promise<ActionState> {
  await requireUser();
  try {
    await restoreTripCommand(tripId);
  } catch (error) {
    return commandError(error, "Trip not found.");
  }
  return { success: "Restored." };
}

export async function permanentlyDeleteTrip(tripId: string): Promise<ActionState> {
  await requireUser();
  try {
    await permanentlyDeleteTripCommand(tripId);
  } catch (error) {
    return commandError(error, "Trip not found.");
  }
  return { success: "Deleted permanently." };
}

export async function addTripSegment(
  tripId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();

  const parsed = tripSegmentSchema.safeParse(formToTripSegmentInput(formData));
  if (!parsed.success) {
    return {
      error: firstIssueMessage(parsed.error),
      values: formDataToStringValues(formData, TRIP_SEGMENT_FORM_FIELDS),
    };
  }

  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    const rejection = await describeUploadRejection(file);
    if (rejection) return { error: rejection };
  }

  let segmentId: string;
  try {
    segmentId = (await createTripSegmentCommand(tripId, parsed.data)).id;
  } catch (error) {
    return commandError(error, "Trip not found.");
  }

  if (file instanceof File && file.size > 0) {
    await addDocumentCommand("TRIP_SEGMENT", segmentId, { file });
  }

  redirect(`/travel/${tripId}`);
}

export async function updateTripSegment(
  tripId: string,
  segmentId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();

  const parsed = tripSegmentSchema.safeParse(formToTripSegmentInput(formData));
  if (!parsed.success) {
    return {
      error: firstIssueMessage(parsed.error),
      values: formDataToStringValues(formData, TRIP_SEGMENT_FORM_FIELDS),
    };
  }

  try {
    await updateTripSegmentCommand(segmentId, fullFormUpdate(tripSegmentSchema, parsed.data, formData), { tripId });
  } catch (error) {
    return commandError(error, "Segment not found.");
  }
  redirect(`/travel/${tripId}`);
}

// #427 — moves the segment to Trash.
export async function deleteTripSegment(tripId: string, segmentId: string): Promise<ActionState> {
  await requireUser();
  try {
    await deleteTripSegmentCommand(segmentId, { tripId });
  } catch (error) {
    return commandError(error, "Segment not found.");
  }
  return { success: "Segment deleted." };
}

export async function restoreTripSegment(segmentId: string): Promise<ActionState> {
  await requireUser();
  try {
    await restoreTripSegmentCommand(segmentId);
  } catch (error) {
    return commandError(error, "Segment not found.");
  }
  return { success: "Restored." };
}

export async function permanentlyDeleteTripSegment(segmentId: string): Promise<ActionState> {
  await requireUser();
  try {
    await permanentlyDeleteTripSegmentCommand(segmentId);
  } catch (error) {
    return commandError(error, "Segment not found.");
  }
  return { success: "Deleted permanently." };
}

export async function refreshFlightStatusAction(
  segmentId: string,
  tripId: string,
): Promise<ActionState> {
  await requireUser();

  const segment = await prisma.tripSegment.findUnique({ where: { id: segmentId } });
  if (!segment || segment.deletedAt || segment.tripId !== tripId) return { error: "Segment not found." };
  if (segment.type !== "FLIGHT") return { error: "Not a flight segment." };
  if (!segment.flightNumber) return { error: "No flight number set." };

  const { refreshFlightStatus } = await import("@/lib/integrations/flightStatus");
  await refreshFlightStatus(segmentId);

  revalidatePath(`/travel/${tripId}`);
  return { success: "Flight status refreshed." };
}
