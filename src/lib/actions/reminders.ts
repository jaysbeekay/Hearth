"use server";

import { auth } from "@/lib/auth";
import { isSmtpConfigured, isNtfyConfigured } from "@/lib/appSettings";
import { sendReminderEmail, sendTestEmail } from "@/lib/notifications/email";
import { sendNtfyReminder, sendTestNtfy } from "@/lib/notifications/ntfy";
import { prisma } from "@/lib/prisma";
import { env, isAppUrlConfigured } from "@/lib/env";
import type { ReminderInput, VehicleReminderField } from "@/lib/notifications/reminderContent";
import { contractTiming } from "@/lib/contractTiming";

export type TestReminderTarget =
  | { kind: "contract" | "warranty"; id: string }
  | { kind: "vehicle"; id: string; field: VehicleReminderField };

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysUntil(date: Date): number {
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const end = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.max(0, Math.round((end - start) / MS_PER_DAY));
}

// The reminder this record would actually send, so a test proves the
// wording and the link back to the record (#352), not just the channel.
// Household-wide lookup: any member may test any record's reminder.
async function reminderForTarget(target: TestReminderTarget): Promise<Omit<ReminderInput, "dateFormat"> | null> {
  const appUrl = isAppUrlConfigured() ? env.appUrl : null;
  if (target.kind === "contract") {
    const c = await prisma.contract.findFirst({ where: { id: target.id, deletedAt: null } });
    if (!c?.endDate) return null;
    // #351 — preview the notice-deadline reminder while that deadline is ahead.
    const timing = contractTiming(c);
    const notice =
      timing.cancelBy && timing.beforeCancelBy
        ? { cancelBy: timing.cancelBy, noticePeriodDays: c.noticePeriodDays! }
        : undefined;
    return {
      kind: "contract",
      id: c.id,
      title: c.title,
      detail: c.provider,
      endDate: c.endDate,
      notice,
      daysRemaining: daysUntil(notice ? notice.cancelBy : c.endDate),
      appUrl,
      test: true,
    };
  }
  if (target.kind === "warranty") {
    const p = await prisma.product.findFirst({ where: { id: target.id, deletedAt: null } });
    if (!p?.warrantyEndDate) return null;
    return { kind: "warranty", id: p.id, title: p.description, detail: p.manufacturer ?? p.vendor ?? "", endDate: p.warrantyEndDate, daysRemaining: daysUntil(p.warrantyEndDate), appUrl, test: true };
  }
  if (target.kind !== "vehicle") return null;
  const v = await prisma.vehicle.findFirst({ where: { id: target.id, deletedAt: null } });
  const date = v?.[target.field];
  if (!v || !date) return null;
  return { kind: "vehicle", id: v.id, title: v.label, vehicleField: target.field, endDate: date, daysRemaining: daysUntil(date), appUrl, test: true };
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
  const reminder = target ? await reminderForTarget(target) : null;
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
