import { prisma } from "@/lib/prisma";
import { isSmtpConfigured, isNtfyConfigured, getReminderConfig } from "@/lib/appSettings";
import { sendReminderEmail } from "@/lib/notifications/email";
import { sendNtfyReminder } from "@/lib/notifications/ntfy";
import { sendExpiryWebhooks, getEnabledWebhookEndpoints } from "@/lib/notifications/webhook";
import { parseThresholds } from "@/lib/notifications/thresholds";
import { getNotificationLogsByOwner, recordNotificationOutcome } from "@/lib/notifications/logs";
import { purgeExpiredTrash } from "@/lib/trash";
import { purgeExpiredSyncReceipts } from "@/lib/syncReceipts";
import { reconcileDocumentStore } from "@/lib/documentStore";
import "@/lib/storage"; // registers each domain's reconcile target as a module side effect
import type { NotificationChannel } from "@/generated/prisma/enums";
import { env, isAppUrlConfigured } from "@/lib/env";
import type { ReminderInput, VehicleReminderField } from "@/lib/notifications/reminderContent";

function daysRemaining(endDate: Date, now: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  const startOfEnd = Date.UTC(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
  const startOfNow = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((startOfEnd - startOfNow) / msPerDay);
}

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
  const emailEnabled = await isSmtpConfigured();
  const ntfyEnabled = await isNtfyConfigured();
  const webhookEnabled = (await getEnabledWebhookEndpoints()).length > 0;
  if (!emailEnabled && !ntfyEnabled && !webhookEnabled) {
    return { checked: 0, sent: 0 };
  }

  const contracts = await prisma.contract.findMany({
    where: { status: "ACTIVE", endDate: { not: null }, extractionPending: false, deletedAt: null },
  });
  const contractLogs = await getNotificationLogsByOwner(
    "CONTRACT",
    contracts.map((c) => c.id),
  );

  // #352 — each email uses its recipient's own date format; ntfy and
  // webhooks are household-wide, so they use the first admin's.
  const recipients = emailEnabled
    ? await prisma.user.findMany({
        where: { emailReminders: true },
        select: { email: true, dateFormat: true },
      })
    : [];
  const recipientEmails = recipients.map((r) => r.email);
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

  async function deliver(channel: NotificationChannel, input: Omit<ReminderInput, "dateFormat" | "appUrl">) {
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

  let sentCount = 0;

  for (const contract of contracts) {
    if (!contract.endDate) continue;
    const remaining = daysRemaining(contract.endDate, now);
    if (remaining < 0) continue;

    const thresholds = parseThresholds(contract.reminderDaysBefore, defaultDays);
    const dueThresholds = thresholds.filter((t) => remaining <= t);
    if (dueThresholds.length === 0) continue;

    const channels: NotificationChannel[] = [
      ...(emailEnabled && recipientEmails.length > 0 ? (["EMAIL"] as const) : []),
      ...(ntfyEnabled ? (["NTFY"] as const) : []),
      ...(webhookEnabled ? (["WEBHOOK"] as const) : []),
    ];

    for (const channel of channels) {
      const loggedThresholds = new Set(
        (contractLogs.get(contract.id) ?? [])
          .filter((n) => n.channel === channel && n.status === "SENT")
          .map((n) => n.thresholdDays),
      );
      const unlogged = dueThresholds.filter((t) => !loggedThresholds.has(t));
      if (unlogged.length === 0) continue;

      const threshold = Math.min(...unlogged);

      try {
        await deliver(channel, {
          kind: "contract",
          id: contract.id,
          title: contract.title,
          detail: contract.provider,
          daysRemaining: remaining,
          endDate: contract.endDate,
        });

        await recordNotificationOutcome({
          ownerType: "CONTRACT",
          ownerId: contract.id,
          channel,
          thresholdDays: threshold,
          status: "SENT",
        });
        sentCount += 1;
      } catch (error) {
        console.error(
          `[notifications] failed to send ${channel} reminder for contract ${contract.id}:`,
          error,
        );
        await recordNotificationOutcome({
          ownerType: "CONTRACT",
          ownerId: contract.id,
          channel,
          thresholdDays: threshold,
          status: "FAILED",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const products = await prisma.product.findMany({
    where: { warrantyEndDate: { not: null }, extractionPending: false, deletedAt: null },
  });
  const productLogs = await getNotificationLogsByOwner(
    "PRODUCT",
    products.map((p) => p.id),
  );

  for (const product of products) {
    if (!product.warrantyEndDate) continue;
    const remaining = daysRemaining(product.warrantyEndDate, now);
    if (remaining < 0) continue;

    const thresholds = parseThresholds(product.reminderDaysBefore, defaultDays);
    const dueThresholds = thresholds.filter((t) => remaining <= t);
    if (dueThresholds.length === 0) continue;

    const channels: NotificationChannel[] = [
      ...(emailEnabled && recipientEmails.length > 0 ? (["EMAIL"] as const) : []),
      ...(ntfyEnabled ? (["NTFY"] as const) : []),
      ...(webhookEnabled ? (["WEBHOOK"] as const) : []),
    ];

    for (const channel of channels) {
      const loggedThresholds = new Set(
        (productLogs.get(product.id) ?? [])
          .filter((n) => n.channel === channel && n.status === "SENT")
          .map((n) => n.thresholdDays),
      );
      const unlogged = dueThresholds.filter((t) => !loggedThresholds.has(t));
      if (unlogged.length === 0) continue;

      const threshold = Math.min(...unlogged);
      const detail = product.manufacturer ?? product.vendor ?? "";

      try {
        await deliver(channel, {
          kind: "warranty",
          id: product.id,
          title: product.description,
          detail,
          daysRemaining: remaining,
          endDate: product.warrantyEndDate,
        });

        await recordNotificationOutcome({
          ownerType: "PRODUCT",
          ownerId: product.id,
          channel,
          thresholdDays: threshold,
          status: "SENT",
        });
        sentCount += 1;
      } catch (error) {
        console.error(
          `[notifications] failed to send ${channel} reminder for product ${product.id}:`,
          error,
        );
        await recordNotificationOutcome({
          ownerType: "PRODUCT",
          ownerId: product.id,
          channel,
          thresholdDays: threshold,
          status: "FAILED",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const vehicles = await prisma.vehicle.findMany({
    where: {
      OR: [{ regoExpiry: { not: null } }, { insuranceExpiry: { not: null } }, { nextServiceDue: { not: null } }],
      deletedAt: null,
    },
  });
  const vehicleLogs = await getNotificationLogsByOwner(
    "VEHICLE",
    vehicles.map((v) => v.id),
  );

  for (const vehicle of vehicles) {
    const expiries: { field: VehicleReminderField; date: Date | null }[] = [
      { field: "regoExpiry", date: vehicle.regoExpiry },
      { field: "insuranceExpiry", date: vehicle.insuranceExpiry },
      { field: "nextServiceDue", date: vehicle.nextServiceDue },
    ];

    for (const { field, date } of expiries) {
      if (!date) continue;
      const remaining = daysRemaining(date, now);
      if (remaining < 0) continue;

      const thresholds = parseThresholds(vehicle.reminderDaysBefore, defaultDays);
      const dueThresholds = thresholds.filter((t) => remaining <= t);
      if (dueThresholds.length === 0) continue;

      const channels: NotificationChannel[] = [
        ...(emailEnabled && recipientEmails.length > 0 ? (["EMAIL"] as const) : []),
        ...(ntfyEnabled ? (["NTFY"] as const) : []),
        ...(webhookEnabled ? (["WEBHOOK"] as const) : []),
      ];

      for (const channel of channels) {
        const loggedThresholds = new Set(
          (vehicleLogs.get(vehicle.id) ?? [])
            .filter((n) => n.channel === channel && n.field === field && n.status === "SENT")
            .map((n) => n.thresholdDays),
        );
        const unlogged = dueThresholds.filter((t) => !loggedThresholds.has(t));
        if (unlogged.length === 0) continue;

        const threshold = Math.min(...unlogged);

        try {
          // #352 — vehicles used to be sent as kind "contract", so the email
          // said "Your contract" and the webhook linked to /contracts/<id>.
          await deliver(channel, {
            kind: "vehicle",
            id: vehicle.id,
            title: vehicle.label,
            vehicleField: field,
            daysRemaining: remaining,
            endDate: date,
          });

          await recordNotificationOutcome({
            ownerType: "VEHICLE",
            ownerId: vehicle.id,
            field,
            channel,
            thresholdDays: threshold,
            status: "SENT",
          });
          sentCount += 1;
        } catch (error) {
          console.error(
            `[notifications] failed to send ${channel} reminder for vehicle ${vehicle.id} (${field}):`,
            error,
          );
          await recordNotificationOutcome({
            ownerType: "VEHICLE",
            ownerId: vehicle.id,
            field,
            channel,
            thresholdDays: threshold,
            status: "FAILED",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }

  return { checked: contracts.length + products.length + vehicles.length, sent: sentCount };
}
