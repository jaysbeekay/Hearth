"use server";

import { auth } from "@/lib/auth";
import { isSmtpConfigured, isNtfyConfigured, getReminderConfig, getHouseholdToday } from "@/lib/appSettings";
import { sendReminderEmail, sendTestEmail } from "@/lib/notifications/email";
import { sendNtfyReminder, sendTestNtfy } from "@/lib/notifications/ntfy";
import { prisma } from "@/lib/prisma";
import { env, isAppUrlConfigured } from "@/lib/env";
import type { ReminderInput, TestPreview, VehicleReminderField } from "@/lib/notifications/reminderContent";
import { getNotificationLogsByOwner, toSentLogRow } from "@/lib/notifications/logs";
import {
  dayToDate,
  nextReminderPreview,
  type NextReminderPreview,
  type ReminderChannel,
} from "@/lib/notifications/reminderSchedule";
import type { NotificationOwnerType } from "@/generated/prisma/enums";

export type TestReminderTarget =
  | { kind: "contract" | "warranty"; id: string }
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
  const [{ defaultDays }, today] = await Promise.all([getReminderConfig(), getHouseholdToday()]);
  const ctx = { today, defaultReminderDays: defaultDays };

  async function preview(
    ownerType: NotificationOwnerType,
    id: string,
    record: Parameters<typeof nextReminderPreview>[0],
    field?: string,
  ) {
    const logs = (await getNotificationLogsByOwner(ownerType, [id])).get(id) ?? [];
    return nextReminderPreview(record, ctx, logs.map(toSentLogRow), { field, channels });
  }
  function testFields(p: NextReminderPreview) {
    const testPreview: TestPreview = p.when.kind === "on" ? { kind: "on", date: dayToDate(p.when.day) } : p.when;
    return { daysRemaining: p.daysRemaining, appUrl, test: true, testPreview };
  }

  if (target.kind === "contract") {
    const c = await prisma.contract.findFirst({ where: { id: target.id, deletedAt: null } });
    if (!c?.endDate) return null;
    const p = await preview("CONTRACT", c.id, { kind: "contract", ...c });
    if (!p) return null;
    return {
      kind: "contract",
      id: c.id,
      title: c.title,
      detail: c.provider,
      endDate: c.endDate,
      // #351 — a notice-deadline Reminder is about the last day to give notice.
      notice:
        p.entry.field === "noticeDeadline"
          ? { cancelBy: dayToDate(p.entry.date), noticePeriodDays: c.noticePeriodDays! }
          : undefined,
      ...testFields(p),
    };
  }
  if (target.kind === "warranty") {
    const product = await prisma.product.findFirst({ where: { id: target.id, deletedAt: null } });
    if (!product?.warrantyEndDate) return null;
    const p = await preview("PRODUCT", product.id, { kind: "warranty", ...product });
    if (!p) return null;
    return {
      kind: "warranty",
      id: product.id,
      title: product.description,
      detail: product.manufacturer ?? product.vendor ?? "",
      endDate: product.warrantyEndDate,
      ...testFields(p),
    };
  }
  if (target.kind !== "vehicle") return null;
  const v = await prisma.vehicle.findFirst({ where: { id: target.id, deletedAt: null } });
  const date = v?.[target.field];
  if (!v || !date) return null;
  const p = await preview("VEHICLE", v.id, { kind: "vehicle", ...v }, target.field);
  if (!p) return null;
  return { kind: "vehicle", id: v.id, title: v.label, vehicleField: target.field, endDate: date, ...testFields(p) };
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

  const [emailEnabled, ntfyEnabled] = await Promise.all([isSmtpConfigured(), isNtfyConfigured()]);
  if (!emailEnabled && !ntfyEnabled) {
    return { error: "No delivery channel is configured yet — set up email or ntfy in Settings." };
  }

  const sent: string[] = [];
  const failed: string[] = [];

  // From a record's page: send that record's real reminder, marked [Test].
  const channels: ReminderChannel[] = [
    ...(emailEnabled ? (["EMAIL"] as const) : []),
    ...(ntfyEnabled ? (["NTFY"] as const) : []),
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

  if (sent.length > 0 && failed.length === 0) return { success: `Test reminder sent via ${sent.join(" and ")}.` };
  if (sent.length > 0) return { success: `Sent via ${sent.join(" and ")} — but failed: ${failed.join("; ")}` };
  return { error: failed.join("; ") || "Failed to send test reminder." };
}
