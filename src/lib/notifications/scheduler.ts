import { prisma } from "@/lib/prisma";
import { purgeStaleShareLinks } from "@/lib/documents/shareLinks";
import { getReminderConfig, getHouseholdToday } from "@/lib/appSettings";
import { sendReminderEmail } from "@/lib/notifications/email";
import { sendNtfyReminder } from "@/lib/notifications/ntfy";
import { sendExpiryWebhooks } from "@/lib/notifications/webhook";
import { sendPushReminder } from "@/lib/notifications/push";
import { activeChannels, channelList } from "@/lib/notifications/channels";
import { recordNotificationOutcome } from "@/lib/notifications/logs";
import { plannedReminderRecords, type ReminderContent } from "@/lib/notifications/reminderRecords";
import { dayToDate, type ReminderChannel, type ReminderPlan } from "@/lib/notifications/reminderSchedule";
import { purgeExpiredTrash } from "@/lib/trash";
import { purgeExpiredSyncReceipts } from "@/lib/syncReceipts";
import { reconcileDocumentStore } from "@/lib/documentStore";
import "@/lib/storage"; // registers each domain's reconcile target as a module side effect
import type { NotificationOwnerType } from "@/generated/prisma/enums";
import type { DueEntry } from "@/lib/duePolicy";
import { env, isAppUrlConfigured } from "@/lib/env";

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
  // #374 — expired and revoked share links, a day after they stop working.
  await purgeStaleShareLinks(now).catch((error) => {
    console.error("[share] link purge failed:", error);
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
    } else if (channel === "PUSH") {
      // #375 — every subscribed device, each in its owner's date format.
      await sendPushReminder({ ...input, appUrl });
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

  const records = await plannedReminderRecords(ctx);
  for (const { ownerType, ownerId, plan, content } of records) {
    await remind(ownerType, ownerId, plan, content);
  }

  return {
    checked: records.length,
    sent: sentCount,
  };
}
