"use server";

import { auth } from "@/lib/auth";
import { isSmtpConfigured, isNtfyConfigured } from "@/lib/appSettings";
import { sendTestEmail } from "@/lib/notifications/email";
import { sendTestNtfy } from "@/lib/notifications/ntfy";

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
export async function sendTestReminder(): Promise<ActionState> {
  const user = await requireUser();
  if (!user.email) return { error: "Your account has no email address to send a test to." };

  const [emailEnabled, ntfyEnabled] = await Promise.all([isSmtpConfigured(), isNtfyConfigured()]);
  if (!emailEnabled && !ntfyEnabled) {
    return { error: "No delivery channel is configured yet — set up email or ntfy in Settings." };
  }

  const sent: string[] = [];
  const failed: string[] = [];

  if (emailEnabled) {
    try {
      await sendTestEmail(user.email);
      sent.push(`email to ${user.email}`);
    } catch (error) {
      failed.push(error instanceof Error ? error.message : "email failed");
    }
  }
  if (ntfyEnabled) {
    try {
      await sendTestNtfy();
      sent.push("ntfy");
    } catch (error) {
      failed.push(error instanceof Error ? error.message : "ntfy failed");
    }
  }

  if (sent.length > 0 && failed.length === 0) return { success: `Test reminder sent via ${sent.join(" and ")}.` };
  if (sent.length > 0) return { success: `Sent via ${sent.join(" and ")} — but failed: ${failed.join("; ")}` };
  return { error: failed.join("; ") || "Failed to send test reminder." };
}
