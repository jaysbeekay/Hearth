import { prisma } from "@/lib/prisma";
import { isSmtpConfigured, isNtfyConfigured, getReminderConfig } from "@/lib/appSettings";
import { sendReminderEmail } from "@/lib/notifications/email";
import { sendNtfyReminder } from "@/lib/notifications/ntfy";
import { sendExpiryWebhooks, getEnabledWebhookEndpoints } from "@/lib/notifications/webhook";
import { parseThresholds } from "@/lib/notifications/thresholds";
import { getNotificationLogsByOwner, recordNotificationOutcome } from "@/lib/notifications/logs";
import type { NotificationChannel } from "@/generated/prisma/enums";

function daysRemaining(endDate: Date, now: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  const startOfEnd = Date.UTC(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
  const startOfNow = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((startOfEnd - startOfNow) / msPerDay);
}

export async function runExpirationCheck(now: Date = new Date()) {
  const { defaultDays } = await getReminderConfig();
  const emailEnabled = await isSmtpConfigured();
  const ntfyEnabled = await isNtfyConfigured();
  const webhookEnabled = (await getEnabledWebhookEndpoints()).length > 0;
  if (!emailEnabled && !ntfyEnabled && !webhookEnabled) {
    return { checked: 0, sent: 0 };
  }

  const contracts = await prisma.contract.findMany({
    where: { status: "ACTIVE", endDate: { not: null }, extractionPending: false },
  });
  const contractLogs = await getNotificationLogsByOwner(
    "CONTRACT",
    contracts.map((c) => c.id),
  );

  const recipientEmails = emailEnabled
    ? (
        await prisma.user.findMany({
          where: { emailReminders: true },
          select: { email: true },
        })
      ).map((u) => u.email)
    : [];

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
        if (channel === "EMAIL") {
          await Promise.all(
            recipientEmails.map((to) =>
              sendReminderEmail({
                to,
                kind: "contract",
                title: contract.title,
                detail: contract.provider,
                daysRemaining: remaining,
                endDate: contract.endDate as Date,
              }),
            ),
          );
        } else if (channel === "NTFY") {
          await sendNtfyReminder({
            kind: "contract",
            title: contract.title,
            detail: contract.provider,
            daysRemaining: remaining,
            endDate: contract.endDate,
          });
        } else {
          await sendExpiryWebhooks({
            kind: "contract",
            id: contract.id,
            title: contract.title,
            detail: contract.provider,
            daysRemaining: remaining,
            endDate: contract.endDate as Date,
          });
        }

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
    where: { warrantyEndDate: { not: null }, extractionPending: false },
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
        if (channel === "EMAIL") {
          await Promise.all(
            recipientEmails.map((to) =>
              sendReminderEmail({
                to,
                kind: "warranty",
                title: product.description,
                detail,
                daysRemaining: remaining,
                endDate: product.warrantyEndDate as Date,
              }),
            ),
          );
        } else if (channel === "NTFY") {
          await sendNtfyReminder({
            kind: "warranty",
            title: product.description,
            detail,
            daysRemaining: remaining,
            endDate: product.warrantyEndDate,
          });
        } else {
          await sendExpiryWebhooks({
            kind: "warranty",
            id: product.id,
            title: product.description,
            detail,
            daysRemaining: remaining,
            endDate: product.warrantyEndDate as Date,
          });
        }

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
    where: { OR: [{ regoExpiry: { not: null } }, { insuranceExpiry: { not: null } }] },
  });
  const vehicleLogs = await getNotificationLogsByOwner(
    "VEHICLE",
    vehicles.map((v) => v.id),
  );

  for (const vehicle of vehicles) {
    const expiries: { field: string; date: Date | null; detail: string }[] = [
      { field: "regoExpiry", date: vehicle.regoExpiry, detail: "Registration expires in" },
      { field: "insuranceExpiry", date: vehicle.insuranceExpiry, detail: "Insurance expires in" },
    ];

    for (const { field, date, detail } of expiries) {
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
        const title = `Vehicle: ${vehicle.label}`;
        const notifDetail = `${detail} ${remaining} day${remaining === 1 ? "" : "s"}`;

        try {
          if (channel === "EMAIL") {
            await Promise.all(
              recipientEmails.map((to) =>
                sendReminderEmail({
                  to,
                  kind: "contract",
                  title,
                  detail: notifDetail,
                  daysRemaining: remaining,
                  endDate: date,
                }),
              ),
            );
          } else if (channel === "NTFY") {
            await sendNtfyReminder({
              kind: "contract",
              title,
              detail: notifDetail,
              daysRemaining: remaining,
              endDate: date,
            });
          } else {
            await sendExpiryWebhooks({
              kind: "contract",
              id: vehicle.id,
              title,
              detail: notifDetail,
              daysRemaining: remaining,
              endDate: date,
            });
          }

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
