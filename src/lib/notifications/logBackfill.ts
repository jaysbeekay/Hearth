// One-off backfill for the date-keyed sent-Reminder log (#387, ADR 0003).
//
// The migration (20261025090000_date_keyed_notification_log) adds
// `notification_logs.dueDate` as null on every existing row, which means
// stale: kept as history, never counted. This then stamps a row with the
// record's current date for that entry only if the row was sent inside
// that threshold's window for that date (no earlier than the date minus
// the threshold, and not after the date). So the upgrade sends nothing new
// for Reminders already sent, while a row left over from an earlier date —
// such as last year's rego, the cause of #382 — stays stale and lets the
// new date's Reminders go out.
//
// It needs the Due policy (notice deadlines, the household timezone), which
// SQL can't express cleanly, so it runs in TypeScript the first time the
// log is read after the upgrade (getNotificationLogsByOwner), before the
// scheduler or the health card decide anything. An AppSetting marker makes
// it run once per database; it only ever touches rows with no date.

import { prisma } from "@/lib/prisma";
import { getHouseholdTimeZone, isAppSettingSet, setAppSetting } from "@/lib/appSettings";
import { addDays, householdDay, noticeApplies, type CalendarDay } from "@/lib/duePolicy";
import { dateToDay, dayToDate } from "@/lib/notifications/reminderSchedule";

const MARKER_KEY = "notifications.logDatesBackfilledAt";
const VEHICLE_FIELDS = ["regoExpiry", "insuranceExpiry", "nextServiceDue"] as const;

let pending: Promise<void> | null = null;

/** Runs the backfill once per database (and once per process at most). */
export function ensureNotificationLogBackfill(): Promise<void> {
  pending ??= (async () => {
    if (await isAppSettingSet(MARKER_KEY)) return;
    await backfillNotificationLogDates();
    await setAppSetting(MARKER_KEY, new Date().toISOString());
  })().catch((error) => {
    pending = null;
    throw error;
  });
  return pending;
}

type Target = { field: string; date: CalendarDay } | null;

/**
 * Stamps undated rows that are still in their threshold's window for the
 * record's current date. Returns how many rows were stamped. Exported for
 * tests; the app calls ensureNotificationLogBackfill.
 */
export async function backfillNotificationLogDates(): Promise<number> {
  const rows = await prisma.notificationLog.findMany({ where: { dueDate: null } });
  if (rows.length === 0) return 0;
  const timeZone = await getHouseholdTimeZone();

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
    const sentDay = householdDay(row.sentAt, timeZone);
    let target: Target = null;

    if (row.ownerType === "CONTRACT") {
      const c = contractById.get(row.ownerId);
      if (c?.endDate) {
        const end = dateToDay(c.endDate);
        // The old scheduler counted down to the notice deadline while it
        // was ahead (#351) and logged those rows with no field, so a row
        // sent on or before the deadline is a notice-deadline Reminder.
        const deadline = noticeApplies(c) ? addDays(end, -c.noticePeriodDays!) : null;
        target =
          deadline && sentDay <= deadline ? { field: "noticeDeadline", date: deadline } : { field: "endDate", date: end };
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
    const inWindow = addDays(target.date, -row.thresholdDays) <= sentDay && sentDay <= target.date;
    if (!inWindow) continue;

    try {
      await prisma.notificationLog.update({
        where: { id: row.id },
        data: { field: target.field, dueDate: dayToDate(target.date) },
      });
      stamped += 1;
    } catch (error) {
      // A dated row already holds this key: leave this one as stale history.
      console.warn(`[notifications] left log row ${row.id} undated:`, error);
    }
  }
  return stamped;
}
