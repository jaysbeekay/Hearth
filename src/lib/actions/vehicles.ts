"use server";

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { formToVehicleInput, formToVehicleItemInput } from "@/lib/formMappers";
import { vehicleSchema, vehicleItemSchema } from "@/lib/validation/vehicles";
import { fullFormUpdate } from "@/lib/validation/fullFormUpdate";
import { addDocumentCommand } from "@/lib/commands/documents";
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
import { RecordNotFoundError, RecordValidationError, StaleEditError } from "@/lib/commands/shared";
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

// Turns a command's not-found / stale-edit / module-disabled error into the
// ActionState the form shows; anything else is unexpected and rethrown.
function commandError(error: unknown, notFound: string): ActionState {
  if (error instanceof RecordNotFoundError) return { error: notFound };
  if (
    error instanceof StaleEditError ||
    error instanceof ModuleDisabledError ||
    error instanceof RecordValidationError
  ) {
    return { error: error.message };
  }
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
    await updateVehicleCommand(vehicleId, fullFormUpdate(vehicleSchema, parsed.data, formData), user.id);
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
    await addDocumentCommand("VEHICLE_ITEM", itemId, {
      file,
      category: parseDocumentCategory(formData.get("documentCategory")),
    });
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
    await updateServiceRecordCommand(itemId, fullFormUpdate(vehicleItemSchema, parsed.data, formData), { vehicleId });
  } catch (error) {
    return commandError(error, "Service record not found.");
  }
  redirect(`/vehicles/${vehicleId}`);
}

export async function deleteVehicleItem(vehicleId: string, itemId: string): Promise<ActionState> {
  await requireUser();
  try {
    await deleteServiceRecordCommand(itemId, { vehicleId });
  } catch (error) {
    return commandError(error, "Service record not found.");
  }
  return { success: "Service record moved to Trash." };
}

export async function restoreVehicleItem(itemId: string): Promise<ActionState> {
  await requireUser();
  try {
    await restoreServiceRecordCommand(itemId);
  } catch (error) {
    return commandError(error, "Service record not found.");
  }
  return { success: "Restored." };
}

export async function permanentlyDeleteVehicleItem(itemId: string): Promise<ActionState> {
  await requireUser();
  try {
    await permanentlyDeleteServiceRecordCommand(itemId);
  } catch (error) {
    return commandError(error, "Service record not found.");
  }
  return { success: "Deleted permanently." };
}

