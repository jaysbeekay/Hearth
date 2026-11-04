"use server";

import { auth } from "@/lib/auth";
import { getHouseholdToday } from "@/lib/appSettings";
import { snoozeRecordCommand, unsnoozeRecordCommand } from "@/lib/commands/snooze";
import { RecordNotFoundError, RecordValidationError } from "@/lib/commands/shared";
import { ModuleDisabledError } from "@/lib/modules/enablement";
import { addDays, calendarDayOf, formatDueDate } from "@/lib/duePolicy";
import { snoozeSchema, unsnoozeSchema } from "@/lib/validation/snooze";
import type { ActionState } from "@/lib/actions/auth";

// #354 — Snooze ("remind me later") a Due Contract, Warranty or Vehicle, and
// Unsnooze it. Open to every member who can edit records; READONLY can't.

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Not signed in");
  if (session.user.role === "READONLY") throw new Error("Your account has read-only access.");
  return session.user;
}

function fields(formData: FormData) {
  const value = (key: string) => {
    const v = formData.get(key);
    return typeof v === "string" && v !== "" ? v : undefined;
  };
  return { kind: value("kind"), id: value("id"), days: value("days"), until: value("until") };
}

function commandError(error: unknown): ActionState {
  if (error instanceof RecordNotFoundError) return { error: "That record no longer exists." };
  if (error instanceof RecordValidationError || error instanceof ModuleDisabledError) return { error: error.message };
  throw error;
}

export async function snoozeRecord(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = snoozeSchema.safeParse(fields(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { kind, id, days, until: chosen } = parsed.data;

  const today = await getHouseholdToday();
  const until = days != null ? addDays(today, days) : calendarDayOf(chosen);
  if (!until) return { error: "Choose a date." };
  try {
    await snoozeRecordCommand(kind, id, until, today, user.id);
  } catch (error) {
    return commandError(error);
  }
  return { success: `Snoozed until ${formatDueDate(until, today)}.` };
}

export async function unsnoozeRecord(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const parsed = unsnoozeSchema.safeParse(fields(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  try {
    await unsnoozeRecordCommand(parsed.data.kind, parsed.data.id);
  } catch (error) {
    return commandError(error);
  }
  return { success: "Snooze ended." };
}
