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
// `updatedAt`. A record in Trash counts as not found. The write only lands
// if the record still has the `updatedAt` it was read with, so a Snooze can
// never restore an older `updatedAt` over a concurrent edit or key itself to
// dates that edit just replaced; it re-reads and tries again instead.
const SNOOZE_WRITE_ATTEMPTS = 3;

type Snoozable = { updatedAt: Date; deletedAt: Date | null };

async function writeSnoozeWith<Row extends Snoozable>(
  kind: SnoozeKind,
  read: () => Promise<Row | null>,
  keyOf: (row: Row) => string,
  write: (updatedAt: Date, data: SnoozeData & { updatedAt: Date }) => Promise<{ count: number }>,
  data: (key: string) => SnoozeData,
) {
  for (let attempt = 0; attempt < SNOOZE_WRITE_ATTEMPTS; attempt++) {
    const row = await read();
    if (!row || row.deletedAt) throw new RecordNotFoundError(NOT_FOUND[kind]);
    const { count } = await write(row.updatedAt, { ...data(keyOf(row)), updatedAt: row.updatedAt });
    if (count === 1) return;
  }
  throw new RecordValidationError("This record was just changed by someone else. Please try again.");
}

async function writeSnooze(kind: SnoozeKind, id: string, data: (key: string) => SnoozeData) {
  switch (kind) {
    case "contract":
      return writeSnoozeWith(
        kind,
        () => prisma.contract.findUnique({ where: { id } }),
        (row) => snoozeKey({ kind, ...row }),
        (updatedAt, next) => prisma.contract.updateMany({ where: { id, updatedAt, deletedAt: null }, data: next }),
        data,
      );
    case "warranty":
      return writeSnoozeWith(
        kind,
        () => prisma.product.findUnique({ where: { id } }),
        (row) => snoozeKey({ kind, ...row }),
        (updatedAt, next) => prisma.product.updateMany({ where: { id, updatedAt, deletedAt: null }, data: next }),
        data,
      );
    case "vehicle":
      await assertModuleEnabled("VEHICLES");
      return writeSnoozeWith(
        kind,
        () => prisma.vehicle.findUnique({ where: { id } }),
        (row) => snoozeKey({ kind, ...row }),
        (updatedAt, next) => prisma.vehicle.updateMany({ where: { id, updatedAt, deletedAt: null }, data: next }),
        data,
      );
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
