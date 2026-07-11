"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { vehicleSchema, vehicleItemSchema } from "@/lib/validation/vehicles";
import {
  ALLOWED_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  deleteVehicleItemDir,
  deleteVehicleItemDocument as deleteVehicleItemDocumentFile,
  saveVehicleItemDocument,
} from "@/lib/storage";
import { formDataToStringValues } from "@/lib/form-state";
import { isModuleEnabled } from "@/lib/modules/enablement";
import type { ActionState } from "@/lib/actions/auth";

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

async function attachVehicleItemDocument(vehicleItemId: string, file: File): Promise<ActionState | null> {
  if (file.size > MAX_UPLOAD_BYTES) return { error: "File is too large (15MB max)." };
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return { error: "Unsupported file type. Use PDF, Word, or image files." };
  }

  const { storedName, size } = await saveVehicleItemDocument(vehicleItemId, file);
  await prisma.vehicleItemDocument.create({
    data: {
      vehicleItemId,
      filename: file.name.slice(0, 255),
      storedName,
      mimeType: file.type,
      size,
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

  const vehicle = await prisma.vehicle.create({
    data: { ...parsed.data, createdById: user.id },
  });

  revalidatePath("/vehicles");
  redirect(`/vehicles/${vehicle.id}`);
}

export async function updateVehicle(
  vehicleId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();

  const parsed = vehicleSchema.safeParse(formToVehicleInput(formData));
  if (!parsed.success) {
    return {
      error: firstIssueMessage(parsed.error),
      values: formDataToStringValues(formData, VEHICLE_FORM_FIELDS),
    };
  }

  const existing = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
  if (!existing) return { error: "Vehicle not found." };

  await prisma.vehicle.update({ where: { id: vehicleId }, data: parsed.data });

  revalidatePath("/vehicles");
  revalidatePath(`/vehicles/${vehicleId}`);
  redirect(`/vehicles/${vehicleId}`);
}

export async function deleteVehicle(vehicleId: string): Promise<ActionState> {
  await requireUser();

  const existing = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
    include: { items: { select: { id: true } } },
  });
  if (!existing) return { error: "Vehicle not found." };

  for (const item of existing.items) {
    await deleteVehicleItemDir(item.id);
  }

  await prisma.vehicle.delete({ where: { id: vehicleId } });

  revalidatePath("/vehicles");
  redirect("/vehicles");
}

export async function addVehicleItem(
  vehicleId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();

  const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
  if (!vehicle) return { error: "Vehicle not found." };

  const parsed = vehicleItemSchema.safeParse(formToVehicleItemInput(formData));
  if (!parsed.success) {
    return {
      error: firstIssueMessage(parsed.error),
      values: formDataToStringValues(formData, VEHICLE_ITEM_FORM_FIELDS),
    };
  }

  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_UPLOAD_BYTES) return { error: "File is too large (15MB max)." };
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return { error: "Unsupported file type. Use PDF, Word, or image files." };
    }
  }

  const item = await prisma.vehicleItem.create({
    data: { ...parsed.data, vehicleId },
  });

  if (file instanceof File && file.size > 0) {
    await attachVehicleItemDocument(item.id, file);
  }

  revalidatePath(`/vehicles/${vehicleId}`);
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

  const existing = await prisma.vehicleItem.findUnique({ where: { id: itemId } });
  if (!existing || existing.vehicleId !== vehicleId) return { error: "Item not found." };

  await prisma.vehicleItem.update({ where: { id: itemId }, data: parsed.data });

  revalidatePath(`/vehicles/${vehicleId}`);
  redirect(`/vehicles/${vehicleId}`);
}

export async function deleteVehicleItem(vehicleId: string, itemId: string): Promise<ActionState> {
  await requireUser();

  const existing = await prisma.vehicleItem.findUnique({ where: { id: itemId } });
  if (!existing || existing.vehicleId !== vehicleId) return { error: "Item not found." };

  await prisma.vehicleItem.delete({ where: { id: itemId } });
  await deleteVehicleItemDir(itemId);

  revalidatePath(`/vehicles/${vehicleId}`);
  return { success: "Item removed." };
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

  const error = await attachVehicleItemDocument(itemId, file);
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

  await prisma.vehicleItemDocument.delete({ where: { id: documentId } });
  await deleteVehicleItemDocumentFile(itemId, doc.storedName);

  if (item) revalidatePath(`/vehicles/${item.vehicleId}`);
  return { success: "Document removed." };
}
