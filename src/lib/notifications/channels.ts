import { prisma } from "@/lib/prisma";
import { isSmtpConfigured, isNtfyConfigured } from "@/lib/appSettings";
import { getEnabledWebhookEndpoints } from "@/lib/notifications/webhook";
import type { ReminderChannel } from "@/lib/notifications/reminderSchedule";

export interface ActiveChannels {
  /** SMTP is configured AND at least one member gets reminder emails. */
  email: boolean;
  ntfy: boolean;
  webhook: boolean;
  /** Members who get reminder emails; empty unless SMTP is configured. */
  emailRecipients: { email: string; dateFormat: string | null }[];
}

/**
 * The Reminder channels that will actually deliver on a check. The scheduler
 * sends on these and the health cards report them, so a card can't say a
 * Reminder goes "on the next check" through a channel the scheduler skips.
 * Email counts only when SMTP is configured and someone has reminder emails
 * turned on.
 */
export async function activeChannels(): Promise<ActiveChannels> {
  const [smtp, ntfy, webhookEndpoints] = await Promise.all([
    isSmtpConfigured(),
    isNtfyConfigured(),
    getEnabledWebhookEndpoints(),
  ]);
  const emailRecipients = smtp
    ? await prisma.user.findMany({ where: { emailReminders: true }, select: { email: true, dateFormat: true } })
    : [];
  return { email: emailRecipients.length > 0, ntfy, webhook: webhookEndpoints.length > 0, emailRecipients };
}

/** The active channels as the Reminder schedule names them. */
export function channelList(channels: Pick<ActiveChannels, "email" | "ntfy" | "webhook">): ReminderChannel[] {
  return [
    ...(channels.email ? (["EMAIL"] as const) : []),
    ...(channels.ntfy ? (["NTFY"] as const) : []),
    ...(channels.webhook ? (["WEBHOOK"] as const) : []),
  ];
}
