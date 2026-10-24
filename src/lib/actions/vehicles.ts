"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { vehicleSchema, vehicleItemSchema } from "@/lib/validation/vehicles";
import {
  deleteVehicleItemDocument as deleteVehicleItemDocumentFile,
  saveVehicleItemDocument,
} from "@/lib/storage";
import { formDataToStringValues } from "@/lib/form-state";
import { isModuleEnabled, ModuleDisabledError } from "@/lib/modules/enablement";
import {
  createVehicleCommand,
  updateVehicleCommand,
  deleteVehicleCommand,
  restoreVehicleCommand,
  permanentlyDeleteVehicleCommand,
  createServiceRecordCommand,
  updateServiceRecordCommand,
  deleteServiceRecordCommand,
  restoreServiceRecordCommand,
  permanentlyDeleteServiceRecordCommand,
} from "@/lib/commands/vehicles";
import { RecordNotFoundError, StaleEditError } from "@/lib/commands/shared";
import type { ActionState } from "@/lib/actions/auth";
import { describeUploadRejection } from "@/lib/uploadValidation";
import { parseDocumentCategory } from "@/lib/documents/categories";

const VEHICLE_FORM_FIELDS = [
  "label",
  "make",
  "model",
  "year",
  "colour",
  "licensePlate",
  "vin",
  "regoExpiry",
  "insuranceExpiry",
  "nextServiceDue",
  "reminderDaysBefore",
  "notes",
];

const VEHICLE_ITEM_FORM_FIELDS = [
  "type",
  "title",
  "provider",
  "date",
  "cost",
  "currency",
  "notes",
];

function firstIssueMessage(error: { issues: { message: string }[] }) {
  return error.issues[0]?.message ?? "Invalid input";
}

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Not signed in");
  if (!(await isModuleEnabled("VEHICLES"))) throw new Error("Vehicles module is disabled");
  if (session.user.role === "READONLY") throw new Error("Your account has read-only access.");
  return session.user;
}

async function attachVehicleItemDocument(
  vehicleItemId: string,
  file: File,
  category: string | null = null,
): Promise<ActionState | null> {
  const rejection = await describeUploadRejection(file);
  if (rejection) return { error: rejection };

  const { storedName, size, sha256, mimeType } = await saveVehicleItemDocument(vehicleItemId, file);
  await prisma.vehicleItemDocument.create({
    data: {
      vehicleItemId,
      filename: file.name.slice(0, 255),
      storedName,
      mimeType,
      size,
      sha256,
      category,
    },
  });
  return null;
}

function formToVehicleInput(formData: FormData) {
  return {
    label: formData.get("label"),
    make: formData.get("make"),
    model: formData.get("model"),
    year: formData.get("year"),
    colour: formData.get("colour"),
    licensePlate: formData.get("licensePlate"),
    vin: formData.get("vin"),
    regoExpiry: formData.get("regoExpiry"),
    insuranceExpiry: formData.get("insuranceExpiry"),
    nextServiceDue: formData.get("nextServiceDue"),
    reminderDaysBefore: formData.get("reminderDaysBefore"),
    notes: formData.get("notes"),
  };
}

function formToVehicleItemInput(formData: FormData) {
  return {
    type: formData.get("type"),
    title: formData.get("title"),
    provider: formData.get("provider"),
    date: formData.get("date"),
    cost: formData.get("cost"),
    currency: formData.get("currency") || "AUD",
    notes: formData.get("notes"),
  };
}

// Turns a command's not-found / stale-edit / module-disabled error into the
// ActionState the form shows; anything else is unexpected and rethrown.
function commandError(error: unknown, notFound: string): ActionState {
  if (error instanceof RecordNotFoundError) return { error: notFound };
  if (error instanceof StaleEditError || error instanceof ModuleDisabledError) return { error: error.message };
  throw error;
}

export async function createVehicle(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();

  const parsed = vehicleSchema.safeParse(formToVehicleInput(formData));
  if (!parsed.success) {
    return {
      error: firstIssueMessage(parsed.error),
      values: formDataToStringValues(formData, VEHICLE_FORM_FIELDS),
    };
  }

  let vehicleId: string;
  try {
    vehicleId = (await createVehicleCommand(parsed.data, user.id)).id;
  } catch (error) {
    return commandError(error, "Vehicle not found.");
  }
  redirect(`/vehicles/${vehicleId}`);
}

export async function updateVehicle(
  vehicleId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();

  const parsed = vehicleSchema.safeParse(formToVehicleInput(formData));
  if (!parsed.success) {
    return {
      error: firstIssueMessage(parsed.error),
      values: formDataToStringValues(formData, VEHICLE_FORM_FIELDS),
    };
  }

  try {
    await updateVehicleCommand(vehicleId, parsed.data, user.id);
  } catch (error) {
    return commandError(error, "Vehicle not found.");
  }
  redirect(`/vehicles/${vehicleId}`);
}

// #287 — soft-delete: see the equivalent comment on deleteContract (contracts.ts).
export async function deleteVehicle(vehicleId: string): Promise<ActionState> {
  await requireUser();
  try {
    await deleteVehicleCommand(vehicleId);
  } catch (error) {
    return commandError(error, "Vehicle not found.");
  }
  redirect("/vehicles");
}

export async function restoreVehicle(vehicleId: string): Promise<ActionState> {
  await requireUser();
  try {
    await restoreVehicleCommand(vehicleId);
  } catch (error) {
    return commandError(error, "Vehicle not found.");
  }
  return { success: "Restored." };
}

export async function permanentlyDeleteVehicle(vehicleId: string): Promise<ActionState> {
  await requireUser();
  try {
    await permanentlyDeleteVehicleCommand(vehicleId);
  } catch (error) {
    return commandError(error, "Vehicle not found.");
  }
  return { success: "Deleted permanently." };
}

export async function addVehicleItem(
  vehicleId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();

  const parsed = vehicleItemSchema.safeParse(formToVehicleItemInput(formData));
  if (!parsed.success) {
    return {
      error: firstIssueMessage(parsed.error),
      values: formDataToStringValues(formData, VEHICLE_ITEM_FORM_FIELDS),
    };
  }

  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    const rejection = await describeUploadRejection(file);
    if (rejection) return { error: rejection };
  }

  let itemId: string;
  try {
    itemId = (await createServiceRecordCommand(vehicleId, parsed.data)).id;
  } catch (error) {
    return commandError(error, "Vehicle not found.");
  }

  if (file instanceof File && file.size > 0) {
    await attachVehicleItemDocument(itemId, file, parseDocumentCategory(formData.get("documentCategory")));
    revalidatePath(`/vehicles/${vehicleId}`);
  }

  redirect(`/vehicles/${vehicleId}`);
}

export async function updateVehicleItem(
  vehicleId: string,
  itemId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();

  const parsed = vehicleItemSchema.safeParse(formToVehicleItemInput(formData));
  if (!parsed.success) {
    return {
      error: firstIssueMessage(parsed.error),
      values: formDataToStringValues(formData, VEHICLE_ITEM_FORM_FIELDS),
    };
  }

  try {
    await updateServiceRecordCommand(itemId, parsed.data, { vehicleId });
  } catch (error) {
    return commandError(error, "Item not found.");
  }
  redirect(`/vehicles/${vehicleId}`);
}

export async function deleteVehicleItem(vehicleId: string, itemId: string): Promise<ActionState> {
  await requireUser();
  try {
    await deleteServiceRecordCommand(itemId, { vehicleId });
  } catch (error) {
    return commandError(error, "Item not found.");
  }
  return { success: "Item moved to Trash." };
}

export async function restoreVehicleItem(itemId: string): Promise<ActionState> {
  await requireUser();
  try {
    await restoreServiceRecordCommand(itemId);
  } catch (error) {
    return commandError(error, "Item not found.");
  }
  return { success: "Restored." };
}

export async function permanentlyDeleteVehicleItem(itemId: string): Promise<ActionState> {
  await requireUser();
  try {
    await permanentlyDeleteServiceRecordCommand(itemId);
  } catch (error) {
    return commandError(error, "Item not found.");
  }
  return { success: "Deleted permanently." };
}

export async function addVehicleItemDocument(
  itemId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file to upload." };
  }

  const item = await prisma.vehicleItem.findUnique({ where: { id: itemId } });
  if (!item) return { error: "Item not found." };

  const error = await attachVehicleItemDocument(itemId, file, parseDocumentCategory(formData.get("documentCategory")));
  if (error) return error;

  revalidatePath(`/vehicles/${item.vehicleId}`);
  return { success: "Document uploaded." };
}

export async function deleteVehicleItemDocumentAction(
  itemId: string,
  documentId: string,
): Promise<ActionState> {
  await requireUser();

  const doc = await prisma.vehicleItemDocument.findUnique({ where: { id: documentId } });
  if (!doc || doc.vehicleItemId !== itemId) {
    return { error: "Document not found." };
  }

  const item = await prisma.vehicleItem.findUnique({ where: { id: itemId } });

  await prisma.vehicleItemDocument.update({ where: { id: documentId }, data: { deletedAt: new Date() } });

  if (item) revalidatePath(`/vehicles/${item.vehicleId}`);
  revalidatePath("/settings/trash");
  return { success: "Document moved to Trash." };
}

export async function restoreVehicleItemDocument(documentId: string): Promise<ActionState> {
  await requireUser();

  const doc = await prisma.vehicleItemDocument.findUnique({ where: { id: documentId } });
  if (!doc) return { error: "Document not found." };
  const item = await prisma.vehicleItem.findUnique({ where: { id: doc.vehicleItemId } });

  await prisma.vehicleItemDocument.update({ where: { id: documentId }, data: { deletedAt: null } });
  if (item) revalidatePath(`/vehicles/${item.vehicleId}`);
  revalidatePath("/documents");
  revalidatePath("/settings/trash");
  return { success: "Restored." };
}

export async function permanentlyDeleteVehicleItemDocument(documentId: string): Promise<ActionState> {
  await requireUser();

  const doc = await prisma.vehicleItemDocument.findUnique({ where: { id: documentId } });
  if (!doc) return { error: "Document not found." };
  const item = await prisma.vehicleItem.findUnique({ where: { id: doc.vehicleItemId } });

  await prisma.vehicleItemDocument.delete({ where: { id: documentId } });
  await deleteVehicleItemDocumentFile(doc.vehicleItemId, doc.storedName);
  if (item) revalidatePath(`/vehicles/${item.vehicleId}`);
  revalidatePath("/documents");
  revalidatePath("/settings/trash");
  return { success: "Deleted permanently." };
}
