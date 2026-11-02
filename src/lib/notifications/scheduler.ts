import { prisma } from "@/lib/prisma";
import { getReminderConfig, getHouseholdToday } from "@/lib/appSettings";
import { sendReminderEmail } from "@/lib/notifications/email";
import { sendNtfyReminder } from "@/lib/notifications/ntfy";
import { sendExpiryWebhooks } from "@/lib/notifications/webhook";
import { activeChannels, channelList } from "@/lib/notifications/channels";
import { getNotificationLogsByOwner, recordNotificationOutcome, toSentLogRow } from "@/lib/notifications/logs";
import { dayToDate, reminderPlan, type ReminderChannel, type ReminderPlan } from "@/lib/notifications/reminderSchedule";
import { getCurrentTenancies } from "@/lib/tenancies";
import { purgeExpiredTrash } from "@/lib/trash";
import { purgeExpiredSyncReceipts } from "@/lib/syncReceipts";
import { reconcileDocumentStore } from "@/lib/documentStore";
import "@/lib/storage"; // registers each domain's reconcile target as a module side effect
import type { NotificationOwnerType } from "@/generated/prisma/enums";
import { env, isAppUrlConfigured } from "@/lib/env";
import type { ReminderInput } from "@/lib/notifications/reminderContent";
import type { DueEntry, VehicleDueField } from "@/lib/duePolicy";

type ReminderContent = Omit<ReminderInput, "dateFormat" | "appUrl">;

export async function runExpirationCheck(now: Date = new Date()) {
  // #287 — no dedicated job runner exists yet (#250), so Trash's 30-day
  // purge piggybacks on this already-scheduled daily tick rather than
  // needing its own cron. Independent of reminder channels being
  // configured, so it still runs for households with none set up.
  await purgeExpiredTrash().catch((error) => {
    console.error("[trash] purge failed:", error);
  });
  // #249 — same opportunistic-purge reasoning as Trash above.
  await purgeExpiredSyncReceipts().catch((error) => {
    console.error("[sync] receipt purge failed:", error);
  });
  // #251 — same reasoning again: no dedicated job runner yet (#250), so the
  // document-store reconciliation sweep piggybacks on this tick too.
  await reconcileDocumentStore().catch((error) => {
    console.error("[documentStore] reconciliation failed:", error);
  });

  const { defaultDays } = await getReminderConfig();
  // Email counts only when someone gets reminder emails; the health cards
  // read the same list (activeChannels).
  const active = await activeChannels();
  const channels = channelList(active);
  if (channels.length === 0) {
    return { checked: 0, sent: 0 };
  }

  // #352 — each email uses its recipient's own date format; ntfy and
  // webhooks are household-wide, so they use the first admin's.
  const recipients = active.emailRecipients;
  const householdDateFormat =
    (
      await prisma.user.findFirst({
        where: { role: "ADMIN" },
        orderBy: { createdAt: "asc" },
        select: { dateFormat: true },
      })
    )?.dateFormat ?? null;
  // Only link to records when APP_URL is really configured — env.appUrl
  // falls back to localhost, which would be a broken link in an email.
  const appUrl = isAppUrlConfigured() ? env.appUrl : null;

  async function deliver(channel: ReminderChannel, input: ReminderContent) {
    if (channel === "EMAIL") {
      await Promise.all(
        recipients.map((r) => sendReminderEmail(r.email, { ...input, dateFormat: r.dateFormat, appUrl })),
      );
    } else if (channel === "NTFY") {
      await sendNtfyReminder({ ...input, dateFormat: householdDateFormat, appUrl });
    } else {
      await sendExpiryWebhooks({ ...input, dateFormat: householdDateFormat, appUrl });
    }
  }

  // Day counts are in the household's day (ADR 0002), not the server's.
  const ctx = { today: await getHouseholdToday(now), defaultReminderDays: defaultDays };
  let sentCount = 0;

  // One loop for every record kind (#387): the Reminder schedule decides
  // what goes out; this only delivers it and logs the outcome against the
  // Due entry's date.
  async function remind(
    ownerType: NotificationOwnerType,
    ownerId: string,
    plan: ReminderPlan,
    content: (entry: DueEntry) => ReminderContent,
  ) {
    for (const { entry, schedule } of plan.entries) {
      for (const channel of channels) {
        const thresholdDays = schedule[channel].sendNow;
        if (thresholdDays == null) continue;
        const key = { ownerType, ownerId, field: entry.field, dueDate: dayToDate(entry.date), channel, thresholdDays };
        try {
          await deliver(channel, content(entry));
          await recordNotificationOutcome({ ...key, status: "SENT" });
          sentCount += 1;
        } catch (error) {
          console.error(
            `[notifications] failed to send ${channel} reminder for ${ownerType.toLowerCase()} ${ownerId} (${entry.field}):`,
            error,
          );
          await recordNotificationOutcome({
            ...key,
            status: "FAILED",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }

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
    await remind("CONTRACT", contract.id, plan, (entry) => ({
      kind: "contract",
      id: contract.id,
      title: contract.title,
      detail: contract.provider,
      daysRemaining: entry.daysLeft,
      endDate: contract.endDate!,
      // #351 — a notice-deadline Reminder is about the last day to give notice.
      notice:
        entry.field === "noticeDeadline"
          ? { cancelBy: dayToDate(entry.date), noticePeriodDays: contract.noticePeriodDays! }
          : undefined,
    }));
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
    await remind("PRODUCT", product.id, plan, (entry) => ({
      kind: "warranty",
      id: product.id,
      title: product.description,
      detail: product.manufacturer ?? product.vendor ?? "",
      daysRemaining: entry.daysLeft,
      endDate: product.warrantyEndDate!,
    }));
  }

  const vehicles = await prisma.vehicle.findMany({
    where: {
      OR: [{ regoExpiry: { not: null } }, { insuranceExpiry: { not: null } }, { nextServiceDue: { not: null } }],
      deletedAt: null,
      // #355 — an Archived Vehicle gets no Reminders.
      archivedAt: null,
    },
  });
  const vehicleLogs = await getNotificationLogsByOwner(
    "VEHICLE",
    vehicles.map((v) => v.id),
  );
  for (const vehicle of vehicles) {
    const sentLog = (vehicleLogs.get(vehicle.id) ?? []).map(toSentLogRow);
    // Rego, insurance and service are separate entries with their own Reminders.
    const plan = reminderPlan({ kind: "vehicle", ...vehicle }, ctx, sentLog);
    await remind("VEHICLE", vehicle.id, plan, (entry) => {
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
    const plan = reminderPlan({ kind: "tenancy", ...tenancy }, ctx, sentLog);
    await remind("TENANCY", tenancy.id, plan, (entry) => ({
      kind: "tenancy",
      id: tenancy.id,
      propertyId,
      title: propertyLabel,
      detail: tenancy.tenantName ?? "",
      daysRemaining: entry.daysLeft,
      endDate: dayToDate(entry.date),
    }));
  }

  return {
    checked: contracts.length + products.length + vehicles.length + tenancies.length,
    sent: sentCount,
  };
}
