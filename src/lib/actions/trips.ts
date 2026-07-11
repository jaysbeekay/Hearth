"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { tripSchema, tripSegmentSchema } from "@/lib/validation/travel";
import {
  ALLOWED_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  deleteTripSegmentDir,
  deleteTripSegmentDocument as deleteTripSegmentDocumentFile,
  saveTripSegmentDocument,
} from "@/lib/storage";
import { formDataToStringValues } from "@/lib/form-state";
import { isModuleEnabled } from "@/lib/modules/enablement";
import type { ActionState } from "@/lib/actions/auth";

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

async function attachSegmentDocument(
  tripSegmentId: string,
  file: File,
): Promise<ActionState | null> {
  if (file.size > MAX_UPLOAD_BYTES) return { error: "File is too large (15MB max)." };
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return { error: "Unsupported file type. Use PDF, Word, or image files." };
  }

  const { storedName, size } = await saveTripSegmentDocument(tripSegmentId, file);
  await prisma.tripSegmentDocument.create({
    data: {
      tripSegmentId,
      filename: file.name.slice(0, 255),
      storedName,
      mimeType: file.type,
      size,
    },
  });
  return null;
}

function formToTripInput(formData: FormData) {
  return {
    title: formData.get("title"),
    destination: formData.get("destination"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    notes: formData.get("notes"),
  };
}

function formToTripSegmentInput(formData: FormData) {
  return {
    type: formData.get("type"),
    title: formData.get("title"),
    provider: formData.get("provider"),
    confirmationCode: formData.get("confirmationCode"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    location: formData.get("location"),
    cost: formData.get("cost"),
    currency: formData.get("currency") || "AUD",
    notes: formData.get("notes"),
    flightNumber: formData.get("flightNumber"),
    departureIata: formData.get("departureIata"),
    arrivalIata: formData.get("arrivalIata"),
  };
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

  const trip = await prisma.trip.create({
    data: { ...parsed.data, createdById: user.id },
  });

  revalidatePath("/travel");
  redirect(`/travel/${trip.id}`);
}

export async function updateTrip(
  tripId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();

  const parsed = tripSchema.safeParse(formToTripInput(formData));
  if (!parsed.success) {
    return {
      error: firstIssueMessage(parsed.error),
      values: formDataToStringValues(formData, TRIP_FORM_FIELDS),
    };
  }

  const existing = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!existing) return { error: "Trip not found." };

  await prisma.trip.update({ where: { id: tripId }, data: parsed.data });

  revalidatePath("/travel");
  revalidatePath(`/travel/${tripId}`);
  redirect(`/travel/${tripId}`);
}

export async function deleteTrip(tripId: string): Promise<ActionState> {
  await requireUser();

  const existing = await prisma.trip.findUnique({
    where: { id: tripId },
    include: { segments: { select: { id: true } } },
  });
  if (!existing) return { error: "Trip not found." };

  // Cascade removes the DB rows but not the uploaded files — clean those up first.
  for (const segment of existing.segments) {
    await deleteTripSegmentDir(segment.id);
  }

  await prisma.trip.delete({ where: { id: tripId } });

  revalidatePath("/travel");
  redirect("/travel");
}

export async function addTripSegment(
  tripId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();

  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!trip) return { error: "Trip not found." };

  const parsed = tripSegmentSchema.safeParse(formToTripSegmentInput(formData));
  if (!parsed.success) {
    return {
      error: firstIssueMessage(parsed.error),
      values: formDataToStringValues(formData, TRIP_SEGMENT_FORM_FIELDS),
    };
  }

  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_UPLOAD_BYTES) return { error: "File is too large (15MB max)." };
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return { error: "Unsupported file type. Use PDF, Word, or image files." };
    }
  }

  const segment = await prisma.tripSegment.create({
    data: { ...parsed.data, tripId },
  });

  if (file instanceof File && file.size > 0) {
    await attachSegmentDocument(segment.id, file);
  }

  revalidatePath(`/travel/${tripId}`);
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

  const existing = await prisma.tripSegment.findUnique({ where: { id: segmentId } });
  if (!existing || existing.tripId !== tripId) return { error: "Segment not found." };

  await prisma.tripSegment.update({ where: { id: segmentId }, data: parsed.data });

  revalidatePath(`/travel/${tripId}`);
  redirect(`/travel/${tripId}`);
}

export async function deleteTripSegment(tripId: string, segmentId: string): Promise<ActionState> {
  await requireUser();

  const existing = await prisma.tripSegment.findUnique({ where: { id: segmentId } });
  if (!existing || existing.tripId !== tripId) return { error: "Segment not found." };

  await prisma.tripSegment.delete({ where: { id: segmentId } });
  await deleteTripSegmentDir(segmentId);

  revalidatePath(`/travel/${tripId}`);
  return { success: "Segment removed." };
}

export async function addSegmentDocument(
  segmentId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file to upload." };
  }

  const segment = await prisma.tripSegment.findUnique({ where: { id: segmentId } });
  if (!segment) return { error: "Segment not found." };

  const error = await attachSegmentDocument(segmentId, file);
  if (error) return error;

  revalidatePath(`/travel/${segment.tripId}`);
  return { success: "Document uploaded." };
}

export async function deleteSegmentDocumentAction(
  segmentId: string,
  documentId: string,
): Promise<ActionState> {
  await requireUser();

  const doc = await prisma.tripSegmentDocument.findUnique({ where: { id: documentId } });
  if (!doc || doc.tripSegmentId !== segmentId) {
    return { error: "Document not found." };
  }

  const segment = await prisma.tripSegment.findUnique({ where: { id: segmentId } });

  await prisma.tripSegmentDocument.delete({ where: { id: documentId } });
  await deleteTripSegmentDocumentFile(segmentId, doc.storedName);

  if (segment) revalidatePath(`/travel/${segment.tripId}`);
  return { success: "Document removed." };
}

export async function refreshFlightStatusAction(
  segmentId: string,
  tripId: string,
): Promise<ActionState> {
  await requireUser();

  const segment = await prisma.tripSegment.findUnique({ where: { id: segmentId } });
  if (!segment || segment.tripId !== tripId) return { error: "Segment not found." };
  if (segment.type !== "FLIGHT") return { error: "Not a flight segment." };
  if (!segment.flightNumber) return { error: "No flight number set." };

  const { refreshFlightStatus } = await import("@/lib/integrations/flightStatus");
  await refreshFlightStatus(segmentId);

  revalidatePath(`/travel/${tripId}`);
  return { success: "Flight status refreshed." };
}
