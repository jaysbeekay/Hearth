import { getNotificationLogsByOwner, toSentLogRow } from "@/lib/notifications/logs";
import { dayToDate, reminderPlan, type ReminderPlan } from "@/lib/notifications/reminderSchedule";
import type { ReminderInput } from "@/lib/notifications/reminderContent";
import { loadDueRecords, type LoadedDueRecord } from "@/lib/loadDueRecords";
import type { DueContext, DueEntry, VehicleDueField } from "@/lib/duePolicy";
import type { NotificationOwnerType } from "@/generated/prisma/enums";

/** A Reminder's wording inputs, before the channel adds a date format and link base. */
export type ReminderContent = Omit<ReminderInput, "dateFormat" | "appUrl">;

/** One household record that can get Reminders: its Reminder plan, and what each of its Reminders says. */
export interface PlannedReminderRecord {
  ownerType: NotificationOwnerType;
  ownerId: string;
  plan: ReminderPlan;
  content: (entry: DueEntry) => ReminderContent;
}

/**
 * Every record that can get Reminders, with its Reminder plan for `ctx`
 * (#387). The scheduler sends from it; #375's device schedule lists the
 * days ahead from it, so the two can't disagree about which records remind.
 */
export async function plannedReminderRecords(ctx: DueContext): Promise<PlannedReminderRecord[]> {
  // The loader only narrows candidates (#674). The Due policy and the
  // schedule decide: past dates, auto-renewing end dates and records that
  // Need review get nothing.
  const { records: loaded } = await loadDueRecords({ context: ctx });
  const logs = new Map(
    await Promise.all(
      (["CONTRACT", "PRODUCT", "VEHICLE", "TENANCY"] as const).map(
        async (ownerType) =>
          [
            ownerType,
            await getNotificationLogsByOwner(
              ownerType,
              loaded.filter((r) => r.ownerType === ownerType).map((r) => r.id),
            ),
          ] as const,
      ),
    ),
  );

  return loaded.map((loadedRecord) => {
    const sentLog = (logs.get(loadedRecord.ownerType)?.get(loadedRecord.id) ?? []).map(toSentLogRow);
    return {
      ownerType: loadedRecord.ownerType,
      ownerId: loadedRecord.id,
      plan: reminderPlan(loadedRecord.record, ctx, sentLog),
      content: reminderContent(loadedRecord),
    };
  });
}

/** What each of a record's Reminders says. */
function reminderContent(loaded: LoadedDueRecord): (entry: DueEntry) => ReminderContent {
  switch (loaded.kind) {
    case "contract": {
      const contract = loaded.row;
      return (entry) => ({
        kind: "contract",
        id: contract.id,
        title: contract.title,
        detail: contract.provider,
        daysRemaining: entry.daysLeft,
        endDate: contract.endDate!,
        // #351 — a notice-deadline Reminder is about the last day to give notice.
        notice:
          entry.field === "noticeDeadline"
            ? {
                cancelBy: dayToDate(entry.date),
                noticePeriodDays: contract.noticePeriodDays!,
              }
            : undefined,
      });
    }
    case "warranty": {
      const product = loaded.row;
      return (entry) => ({
        kind: "warranty",
        id: product.id,
        title: product.description,
        detail: product.manufacturer ?? product.vendor ?? "",
        daysRemaining: entry.daysLeft,
        endDate: product.warrantyEndDate!,
      });
    }
    case "vehicle": {
      const vehicle = loaded.row;
      return (entry) => {
        const field = entry.field as VehicleDueField;
        // #352 — vehicles have their own wording and /vehicles link.
        return {
          kind: "vehicle",
          id: vehicle.id,
          title: vehicle.label,
          vehicleField: field,
          daysRemaining: entry.daysLeft,
          endDate: vehicle[field]!,
        };
      };
    }
    case "tenancy": {
      // #388 — a Tenancy's Reminder links to its Property, since a Tenancy has no page of its own.
      const { propertyId, propertyLabel, tenancy } = loaded.row;
      return (entry) => ({
        kind: "tenancy",
        id: tenancy.id,
        propertyId,
        title: propertyLabel,
        detail: tenancy.tenantName ?? "",
        daysRemaining: entry.daysLeft,
        endDate: dayToDate(entry.date),
      });
    }
  }
}
