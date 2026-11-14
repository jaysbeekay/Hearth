"use server";

import { auth } from "@/lib/auth";
import { isSmtpConfigured, isNtfyConfigured } from "@/lib/appSettings";
import { sendReminderEmail, sendTestEmail } from "@/lib/notifications/email";
import { sendNtfyReminder, sendTestNtfy } from "@/lib/notifications/ntfy";
import { sendTestPush } from "@/lib/notifications/push";
import { prisma } from "@/lib/prisma";
import { loadDueRecord } from "@/lib/loadDueRecords";
import { env, isAppUrlConfigured } from "@/lib/env";
import type { ReminderInput, TestPreview, VehicleReminderField } from "@/lib/notifications/reminderContent";
import { getNotificationLogsByOwner, toSentLogRow } from "@/lib/notifications/logs";
import {
  dayToDate,
  nextReminderPreview,
  type ReminderChannel,
} from "@/lib/notifications/reminderSchedule";

export type TestReminderTarget =
  | { kind: "contract" | "warranty" | "tenancy"; id: string }
  | { kind: "vehicle"; id: string; field: VehicleReminderField };

// The reminder this record would actually send, so a test proves the
// wording and the link back to the record (#352), not just the channel.
// It previews the Reminder schedule (#387): the next Due entry and
// threshold that would really go out, counted in household days, and says
// plainly when none ever will. Household-wide lookup: any member may test
// any record's reminder.
async function reminderForTarget(
  target: TestReminderTarget,
  channels: ReminderChannel[],
): Promise<Omit<ReminderInput, "dateFormat"> | null> {
  const appUrl = isAppUrlConfigured() ? env.appUrl : null;
  // #674 — the same loader the scheduler reads, so a test Reminder exists
  // exactly when a real one could: not in Trash, module on, current Tenancy.
  const { context: ctx, record: loaded } = await loadDueRecord(target);
  if (!loaded) return null;
  const logs = (await getNotificationLogsByOwner(loaded.ownerType, [loaded.id])).get(loaded.id) ?? [];
  const field = target.kind === "vehicle" ? target.field : undefined;
  const p = nextReminderPreview(loaded.record, ctx, logs.map(toSentLogRow), { field, channels });
  if (!p) return null;
  const testPreview: TestPreview = p.when.kind === "on" ? { kind: "on", date: dayToDate(p.when.day) } : p.when;
  const test = { daysRemaining: p.daysRemaining, appUrl, test: true, testPreview };

  switch (loaded.kind) {
    case "contract": {
      const c = loaded.row;
      if (!c.endDate) return null;
      return {
        kind: "contract",
        id: c.id,
        title: c.title,
        detail: c.provider,
        endDate: c.endDate,
        notice:
          p.entry.field === "noticeDeadline"
            ? { cancelBy: dayToDate(p.entry.date), noticePeriodDays: c.noticePeriodDays! }
            : undefined,
        ...test,
      };
    }
    case "warranty": {
      const product = loaded.row;
      if (!product.warrantyEndDate) return null;
      return {
        kind: "warranty",
        id: product.id,
        title: product.description,
        detail: product.manufacturer ?? product.vendor ?? "",
        endDate: product.warrantyEndDate,
        ...test,
      };
    }
    case "tenancy": {
      const { propertyId, propertyLabel, tenancy } = loaded.row;
      return {
        kind: "tenancy",
        id: tenancy.id,
        propertyId,
        title: propertyLabel,
        detail: tenancy.tenantName ?? "",
        endDate: dayToDate(p.entry.date),
        ...test,
      };
    }
    case "vehicle": {
      if (target.kind !== "vehicle") return null;
      const v = loaded.row;
      const date = v[target.field];
      if (!date) return null;
      return { kind: "vehicle", id: v.id, title: v.label, vehicleField: target.field, endDate: date, ...test };
    }
  }
}

export type ActionState = { error?: string; success?: string } | null;

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Not signed in");
  if (session.user.role === "READONLY") throw new Error("Your account has read-only access.");
  return session.user;
}

/**
 * Sends a one-off test reminder via every currently configured channel, so a
 * user looking at a record's reminder-health block (#201) can verify
 * delivery actually works rather than just that it's configured. Deliberately
 * generic (not owner-scoped) — it exercises the exact same senders
 * (sendTestEmail/sendTestNtfy) Settings' own test buttons already use, just
 * exposed here too since AC requires triggering it from a record detail page.
 */
export async function sendTestReminder(target?: TestReminderTarget): Promise<ActionState> {
  const user = await requireUser();
  if (!user.email) return { error: "Your account has no email address to send a test to." };

  const [emailEnabled, ntfyEnabled, pushDevices] = await Promise.all([
    isSmtpConfigured(),
    isNtfyConfigured(),
    // #375 — a test goes to the tester's own devices only.
    prisma.pushSubscription.count({ where: { userId: user.id } }),
  ]);
  const pushEnabled = pushDevices > 0;
  if (!emailEnabled && !ntfyEnabled && !pushEnabled) {
    return { error: "No delivery channel is configured yet — turn on push on this device, or set up email or ntfy in Settings." };
  }

  const sent: string[] = [];
  const failed: string[] = [];

  // From a record's page: send that record's real reminder, marked [Test].
  const channels: ReminderChannel[] = [
    ...(emailEnabled ? (["EMAIL"] as const) : []),
    ...(ntfyEnabled ? (["NTFY"] as const) : []),
    ...(pushEnabled ? (["PUSH"] as const) : []),
  ];
  const reminder = target ? await reminderForTarget(target, channels) : null;
  const dateFormat = reminder
    ? (await prisma.user.findUnique({ where: { id: user.id }, select: { dateFormat: true } }))?.dateFormat
    : null;

  if (emailEnabled) {
    try {
      if (reminder) await sendReminderEmail(user.email, { ...reminder, dateFormat });
      else await sendTestEmail(user.email);
      sent.push(`email to ${user.email}`);
    } catch (error) {
      failed.push(error instanceof Error ? error.message : "email failed");
    }
  }
  if (ntfyEnabled) {
    try {
      if (reminder) await sendNtfyReminder({ ...reminder, dateFormat });
      else await sendTestNtfy();
      sent.push("ntfy");
    } catch (error) {
      failed.push(error instanceof Error ? error.message : "ntfy failed");
    }
  }
  if (pushEnabled) {
    try {
      const delivered = await sendTestPush(user.id, reminder ?? undefined);
      sent.push(`push to ${delivered} ${delivered === 1 ? "device" : "devices"}`);
    } catch (error) {
      failed.push(error instanceof Error ? error.message : "push failed");
    }
  }

  if (sent.length > 0 && failed.length === 0) return { success: `Test reminder sent via ${sent.join(" and ")}.` };
  if (sent.length > 0) return { success: `Sent via ${sent.join(" and ")} — but failed: ${failed.join("; ")}` };
  return { error: failed.join("; ") || "Failed to send test reminder." };
}

/**
 * #375 — the "Turn on reminders" screen's Test button for one channel, so a
 * member checks each channel on its own: an email to their own address, or a
 * message on the household's ntfy topic. Push has its own (sendPushTest).
 */
export async function sendChannelTest(channel: "EMAIL" | "NTFY"): Promise<ActionState> {
  const user = await requireUser();
  if (channel !== "EMAIL" && channel !== "NTFY") return { error: "Unknown reminder channel." };
  if (channel === "EMAIL") {
    if (!user.email) return { error: "Your account has no email address to send a test to." };
    if (!(await isSmtpConfigured())) return { error: "Email isn't set up for the household." };
    try {
      await sendTestEmail(user.email);
      return { success: `Test email sent to ${user.email}.` };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Couldn't send the test email." };
    }
  }
  if (!(await isNtfyConfigured())) return { error: "ntfy isn't set up for the household." };
  try {
    await sendTestNtfy();
    return { success: "Test notification sent to the household's ntfy topic." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Couldn't send the test notification." };
  }
}
