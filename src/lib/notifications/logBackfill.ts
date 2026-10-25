// One-off backfill for the date-keyed sent-Reminder log (#387, ADR 0003).
//
// The migration (20261025090000_date_keyed_notification_log) adds
// `notification_logs.dueDate` as null on every existing row, which means
// stale: kept as history, never counted. This then stamps a row with the
// record's current date for that entry only if the row was sent inside
// that threshold's window for that date, counted the way the old scheduler
// counted it (see oldDaysLeft). So the upgrade sends nothing new
// for Reminders already sent, while a row left over from an earlier date —
// such as last year's rego, the cause of #382 — stays stale and lets the
// new date's Reminders go out.
//
// It needs the notice rule and the old server-local day count, which
// SQL can't express cleanly, so it runs in TypeScript the first time the
// log is read after the upgrade (getNotificationLogsByOwner), before the
// scheduler or the health card decide anything. An AppSetting marker makes
// it run once per database; it only ever touches rows with no date.

import { prisma } from "@/lib/prisma";
import { isAppSettingSet, setAppSetting } from "@/lib/appSettings";
import { addDays, daysBetween, householdDay, noticeApplies, serverTimeZone, type CalendarDay } from "@/lib/duePolicy";
import { dateToDay, dayToDate } from "@/lib/notifications/reminderSchedule";

const MARKER_KEY = "notifications.logDatesBackfilledAt";
const VEHICLE_FIELDS = ["regoExpiry", "insuranceExpiry", "nextServiceDue"] as const;

let pending: Promise<void> | null = null;

/** Runs the backfill once per database (and once per process at most). */
export function ensureNotificationLogBackfill(): Promise<void> {
  pending ??= (async () => {
    if (await isAppSettingSet(MARKER_KEY)) return;
    // If this throws, the marker isn't set and the next read tries again.
    // That's safe: a re-run only ever touches rows that are still undated.
    await backfillNotificationLogDates();
    await setAppSetting(MARKER_KEY, new Date().toISOString());
  })().catch((error) => {
    pending = null;
    throw error;
  });
  return pending;
}

/** Forgets this process's backfill run. Tests only. */
export function resetNotificationLogBackfillForTests(): void {
  pending = null;
}

type Target = { field: string; date: CalendarDay } | null;

/**
 * Days left from `sentAt` to `date`, exactly as the pre-#387 scheduler (and
 * contractTiming) counted them: the server-local calendar day of the stored
 * UTC-midnight date minus the server-local calendar day of the moment. West
 * of UTC the stored date's local day is the day before, so the old
 * scheduler sent each threshold a day early; this keeps that count, so a row
 * it sent still lands inside its window.
 */
function oldDaysLeft(date: CalendarDay, sentAt: Date, serverZone: string): number {
  return daysBetween(householdDay(sentAt, serverZone), householdDay(dayToDate(date), serverZone));
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

/**
 * Stamps undated rows that are still in their threshold's window for the
 * record's current date. Returns how many rows were stamped. Exported for
 * tests; the app calls ensureNotificationLogBackfill.
 *
 * `serverTimeZone` is the zone the old scheduler counted days in: the
 * server's own (TZ), not the household's.
 */
export async function backfillNotificationLogDates(
  options: { serverTimeZone?: string } = {},
): Promise<number> {
  const rows = await prisma.notificationLog.findMany({ where: { dueDate: null } });
  if (rows.length === 0) return 0;
  const serverZone = options.serverTimeZone ?? serverTimeZone(process.env.TZ);

  const idsOf = (type: string) => [...new Set(rows.filter((r) => r.ownerType === type).map((r) => r.ownerId))];
  // Trashed records too: a restored record should keep its sent Reminders.
  const [contracts, products, vehicles] = await Promise.all([
    prisma.contract.findMany({
      where: { id: { in: idsOf("CONTRACT") } },
      select: { id: true, endDate: true, noticePeriodDays: true, renewalType: true },
    }),
    prisma.product.findMany({ where: { id: { in: idsOf("PRODUCT") } }, select: { id: true, warrantyEndDate: true } }),
    prisma.vehicle.findMany({
      where: { id: { in: idsOf("VEHICLE") } },
      select: { id: true, regoExpiry: true, insuranceExpiry: true, nextServiceDue: true },
    }),
  ]);
  const contractById = new Map(contracts.map((c) => [c.id, c]));
  const productById = new Map(products.map((p) => [p.id, p]));
  const vehicleById = new Map(vehicles.map((v) => [v.id, v]));

  let stamped = 0;
  for (const row of rows) {
    const daysLeft = (date: CalendarDay) => oldDaysLeft(date, row.sentAt, serverZone);
    let target: Target = null;

    if (row.ownerType === "CONTRACT") {
      const c = contractById.get(row.ownerId);
      if (c?.endDate) {
        const end = dateToDay(c.endDate);
        // The old scheduler counted down to the notice deadline while it
        // was ahead (#351) and logged those rows with no field, so a row
        // sent while it was still counting to the deadline is a
        // notice-deadline Reminder.
        const deadline = noticeApplies(c) ? addDays(end, -c.noticePeriodDays!) : null;
        target =
          deadline && daysLeft(deadline) >= 0
            ? { field: "noticeDeadline", date: deadline }
            : { field: "endDate", date: end };
      }
    } else if (row.ownerType === "PRODUCT") {
      const p = productById.get(row.ownerId);
      if (p?.warrantyEndDate) target = { field: "warrantyEndDate", date: dateToDay(p.warrantyEndDate) };
    } else if (row.ownerType === "VEHICLE") {
      const v = vehicleById.get(row.ownerId);
      const field = VEHICLE_FIELDS.find((f) => f === row.field);
      const date = v && field ? v[field] : null;
      if (field && date) target = { field, date: dateToDay(date) };
    }

    if (!target) continue;
    // The old scheduler sent a threshold while 0 ≤ days left ≤ threshold.
    const left = daysLeft(target.date);
    if (left < 0 || left > row.thresholdDays) continue;

    try {
      await prisma.notificationLog.update({
        where: { id: row.id },
        data: { field: target.field, dueDate: dayToDate(target.date) },
      });
      stamped += 1;
    } catch (error) {
      // A dated row already holds this key: leave this one as stale history.
      // Anything else is a real failure, so the run (and its marker) stops.
      if (!isUniqueViolation(error)) throw error;
      console.warn(`[notifications] left log row ${row.id} undated: a dated row already holds its key`);
    }
  }
  return stamped;
}
