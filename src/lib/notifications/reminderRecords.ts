import { prisma } from "@/lib/prisma";
import { getNotificationLogsByOwner, toSentLogRow } from "@/lib/notifications/logs";
import { dayToDate, reminderPlan, type ReminderPlan } from "@/lib/notifications/reminderSchedule";
import type { ReminderInput } from "@/lib/notifications/reminderContent";
import { getCurrentTenancies } from "@/lib/tenancies";
import { COVERING_CONTRACTS } from "@/lib/covers";
import { tenancyDueRecord, vehicleDueRecord } from "@/lib/dueRecords";
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
  const records: PlannedReminderRecord[] = [];

  // The queries only narrow candidates. The Due policy and the schedule
  // decide: past dates, auto-renewing end dates and records that Need
  // review get nothing.
  const contracts = await prisma.contract.findMany({
    where: { status: "ACTIVE", endDate: { not: null }, deletedAt: null },
  });
  const contractLogs = await getNotificationLogsByOwner(
    "CONTRACT",
    contracts.map((c) => c.id),
  );
  for (const contract of contracts) {
    const sentLog = (contractLogs.get(contract.id) ?? []).map(toSentLogRow);
    const plan = reminderPlan({ kind: "contract", ...contract }, ctx, sentLog);
    records.push({
      ownerType: "CONTRACT",
      ownerId: contract.id,
      plan,
      content: (entry) => ({
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
      }),
    });
  }

  const products = await prisma.product.findMany({
    where: { warrantyEndDate: { not: null }, deletedAt: null },
  });
  const productLogs = await getNotificationLogsByOwner(
    "PRODUCT",
    products.map((p) => p.id),
  );
  for (const product of products) {
    const sentLog = (productLogs.get(product.id) ?? []).map(toSentLogRow);
    const plan = reminderPlan({ kind: "warranty", ...product }, ctx, sentLog);
    records.push({
      ownerType: "PRODUCT",
      ownerId: product.id,
      plan,
      content: (entry) => ({
        kind: "warranty",
        id: product.id,
        title: product.description,
        detail: product.manufacturer ?? product.vendor ?? "",
        daysRemaining: entry.daysLeft,
        endDate: product.warrantyEndDate!,
      }),
    });
  }

  const vehicles = await prisma.vehicle.findMany({
    where: {
      OR: [{ regoExpiry: { not: null } }, { insuranceExpiry: { not: null } }, { nextServiceDue: { not: null } }],
      deletedAt: null,
      // #355 — an Archived Vehicle gets no Reminders.
      archivedAt: null,
    },
    include: { contracts: COVERING_CONTRACTS },
  });
  const vehicleLogs = await getNotificationLogsByOwner(
    "VEHICLE",
    vehicles.map((v) => v.id),
  );
  for (const vehicle of vehicles) {
    const sentLog = (vehicleLogs.get(vehicle.id) ?? []).map(toSentLogRow);
    // Rego, insurance and service are separate entries with their own Reminders.
    const plan = reminderPlan(vehicleDueRecord(vehicle), ctx, sentLog);
    records.push({
      ownerType: "VEHICLE",
      ownerId: vehicle.id,
      plan,
      content: (entry) => {
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
      },
    });
  }

  // #388 — a rented Property's current Tenancy, for its lease end. Its
  // Reminder links to the Property, since a Tenancy has no page of its own.
  const tenancies = await getCurrentTenancies();
  const tenancyLogs = await getNotificationLogsByOwner(
    "TENANCY",
    tenancies.map((t) => t.tenancy.id),
  );
  for (const { propertyId, propertyLabel, tenancy } of tenancies) {
    const sentLog = (tenancyLogs.get(tenancy.id) ?? []).map(toSentLogRow);
    const plan = reminderPlan(tenancyDueRecord(tenancy), ctx, sentLog);
    records.push({
      ownerType: "TENANCY",
      ownerId: tenancy.id,
      plan,
      content: (entry) => ({
        kind: "tenancy",
        id: tenancy.id,
        propertyId,
        title: propertyLabel,
        detail: tenancy.tenantName ?? "",
        daysRemaining: entry.daysLeft,
        endDate: dayToDate(entry.date),
      }),
    });
  }

  return records;
}
