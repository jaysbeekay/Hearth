import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { RecordNotFoundError, RecordValidationError } from "@/lib/commands/shared";
import { assertModuleEnabled } from "@/lib/modules/enablement";
import { dayToDate } from "@/lib/notifications/reminderSchedule";
import { addDays, daysBetween, type CalendarDay } from "@/lib/duePolicy";
import { MAX_SNOOZE_DAYS, snoozeKey, type SnoozeKind } from "@/lib/snooze";

// #354 — Snooze and Unsnooze, for a Contract, Warranty or Vehicle. A Snooze
// isn't an edit to the record: it leaves `updatedAt` (and so any open edit
// form's stale check) and `updatedById` alone, and records who Snoozed it
// in `snoozedById` instead.

const NOT_FOUND: Record<SnoozeKind, string> = { contract: "Contract", warranty: "Warranty", vehicle: "Vehicle" };

function listPath(kind: SnoozeKind) {
  switch (kind) {
    case "contract":
      return "/contracts";
    case "warranty":
      return "/products";
    case "vehicle":
      return "/vehicles";
  }
}

function revalidate(kind: SnoozeKind, id: string) {
  revalidatePath(`${listPath(kind)}/${id}`);
  revalidatePath(listPath(kind));
  revalidatePath("/dashboard");
  revalidatePath("/calendar");
}

type SnoozeData = { snoozedUntil: Date | null; snoozedFor: string | null; snoozedById: string | null };

// Reads the live record's Snooze key and writes `data` without moving
// `updatedAt`. A record in Trash counts as not found.
async function writeSnooze(kind: SnoozeKind, id: string, data: (key: string) => SnoozeData) {
  switch (kind) {
    case "contract": {
      const row = await prisma.contract.findUnique({ where: { id } });
      if (!row || row.deletedAt) throw new RecordNotFoundError(NOT_FOUND[kind]);
      const key = snoozeKey({ kind, ...row });
      await prisma.contract.update({ where: { id }, data: { ...data(key), updatedAt: row.updatedAt } });
      return;
    }
    case "warranty": {
      const row = await prisma.product.findUnique({ where: { id } });
      if (!row || row.deletedAt) throw new RecordNotFoundError(NOT_FOUND[kind]);
      const key = snoozeKey({ kind, ...row });
      await prisma.product.update({ where: { id }, data: { ...data(key), updatedAt: row.updatedAt } });
      return;
    }
    case "vehicle": {
      await assertModuleEnabled("VEHICLES");
      const row = await prisma.vehicle.findUnique({ where: { id } });
      if (!row || row.deletedAt) throw new RecordNotFoundError(NOT_FOUND[kind]);
      const key = snoozeKey({ kind, ...row });
      await prisma.vehicle.update({ where: { id }, data: { ...data(key), updatedAt: row.updatedAt } });
      return;
    }
  }
}

/** Snoozes the record until `until`, the day it comes back (tomorrow at the earliest). */
export async function snoozeRecordCommand(
  kind: SnoozeKind,
  id: string,
  until: CalendarDay,
  today: CalendarDay,
  actorId: string,
) {
  const days = daysBetween(today, until);
  if (days < 1) throw new RecordValidationError("Choose a day after today.");
  if (days > MAX_SNOOZE_DAYS) {
    throw new RecordValidationError(`A snooze can run for a year at most (until ${addDays(today, MAX_SNOOZE_DAYS)}).`);
  }
  await writeSnooze(kind, id, (key) => ({ snoozedUntil: dayToDate(until), snoozedFor: key, snoozedById: actorId }));
  revalidate(kind, id);
}

export async function unsnoozeRecordCommand(kind: SnoozeKind, id: string) {
  await writeSnooze(kind, id, () => ({ snoozedUntil: null, snoozedFor: null, snoozedById: null }));
  revalidate(kind, id);
}
