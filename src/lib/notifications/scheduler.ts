import { prisma } from "@/lib/prisma";
import { isSmtpConfigured, isNtfyConfigured, getReminderConfig } from "@/lib/appSettings";
import { sendReminderEmail } from "@/lib/notifications/email";
import { sendNtfyReminder } from "@/lib/notifications/ntfy";
import { sendExpiryWebhooks, getEnabledWebhookEndpoints } from "@/lib/notifications/webhook";
import { parseThresholds } from "@/lib/notifications/thresholds";
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
    where: { status: "ACTIVE", endDate: { not: null } },
    include: { notifications: true },
  });

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
        contract.notifications
          .filter((n) => n.channel === channel)
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

        await prisma.notificationLog.create({
          data: { contractId: contract.id, channel, thresholdDays: threshold },
        });
        sentCount += 1;
      } catch (error) {
        console.error(
          `[notifications] failed to send ${channel} reminder for contract ${contract.id}:`,
          error,
        );
      }
    }
  }

  const products = await prisma.product.findMany({
    where: { warrantyEndDate: { not: null } },
    include: { notifications: true },
  });

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
        product.notifications
          .filter((n) => n.channel === channel)
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
                title: product.name,
                detail,
                daysRemaining: remaining,
                endDate: product.warrantyEndDate as Date,
              }),
            ),
          );
        } else if (channel === "NTFY") {
          await sendNtfyReminder({
            kind: "warranty",
            title: product.name,
            detail,
            daysRemaining: remaining,
            endDate: product.warrantyEndDate,
          });
        } else {
          await sendExpiryWebhooks({
            kind: "warranty",
            id: product.id,
            title: product.name,
            detail,
            daysRemaining: remaining,
            endDate: product.warrantyEndDate as Date,
          });
        }

        await prisma.productNotificationLog.create({
          data: { productId: product.id, channel, thresholdDays: threshold },
        });
        sentCount += 1;
      } catch (error) {
        console.error(
          `[notifications] failed to send ${channel} reminder for product ${product.id}:`,
          error,
        );
      }
    }
  }

  const vehicles = await prisma.vehicle.findMany({
    where: { OR: [{ regoExpiry: { not: null } }, { insuranceExpiry: { not: null } }] },
    include: { notificationLogs: true },
  });

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
          vehicle.notificationLogs
            .filter((n) => n.channel === channel && n.field === field)
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

          await prisma.vehicleNotificationLog.create({
            data: { vehicleId: vehicle.id, channel, thresholdDays: threshold, field },
          });
          sentCount += 1;
        } catch (error) {
          console.error(
            `[notifications] failed to send ${channel} reminder for vehicle ${vehicle.id} (${field}):`,
            error,
          );
        }
      }
    }
  }

  return { checked: contracts.length + products.length + vehicles.length, sent: sentCount };
}
