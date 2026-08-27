import { BellOff, BellRing, AlertTriangle, CheckCircle2 } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { TestConnectionButton } from "@/components/TestConnectionButton";
import { sendTestReminder } from "@/lib/actions/reminders";
import type { ReminderHealth } from "@/lib/notifications/health";

const CHANNEL_LABELS: Record<string, string> = { EMAIL: "email", NTFY: "ntfy", WEBHOOK: "webhook" };

function channelSummary(channels: ReminderHealth["channels"]) {
  const active = [
    channels.email && "Email",
    channels.ntfy && "ntfy",
    channels.webhook && "Webhook",
  ].filter(Boolean);
  return active.length > 0 ? active.join(" + ") : "None configured";
}

// The reminder-health block shown on contract/product/vehicle detail pages
// and (in summary form) the dashboard — answers "will this actually remind
// me" and "did the last attempt work", not just "is a date set" (#201).
export function ReminderHealthCard({
  title = "Reminder health",
  health,
  dateFormat,
}: {
  title?: string;
  health: ReminderHealth;
  dateFormat?: string | null;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-medium">
          {health.enabled ? (
            <BellRing size={16} className="text-muted" aria-hidden />
          ) : (
            <BellOff size={16} className="text-muted" aria-hidden />
          )}
          {title}
        </h2>
        <TestConnectionButton action={sendTestReminder} label="Send test reminder" />
      </div>

      <dl className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <div className="min-w-0">
          <dt className="text-xs text-muted">Enabled</dt>
          <dd className="text-sm font-medium">{health.enabled ? "Yes" : "No"}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted">Next reminder</dt>
          <dd className="text-sm font-medium">
            {health.nextReminderDate ? formatDate(health.nextReminderDate, dateFormat) : "—"}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted">Thresholds</dt>
          <dd className="text-sm font-medium">
            {health.thresholds.length > 0 ? health.thresholds.map((t) => `${t}d`).join(", ") : "—"}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted">Delivery channel</dt>
          <dd className="text-sm font-medium">{channelSummary(health.channels)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted">Delivery status</dt>
          <dd className="flex items-center gap-1.5 text-sm font-medium">
            {health.deliveryReady ? (
              <>
                <CheckCircle2 size={14} className="text-success" aria-hidden />
                Ready
              </>
            ) : (
              <>
                <AlertTriangle size={14} className="text-warning" aria-hidden />
                Not configured
              </>
            )}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted">Last sent</dt>
          <dd className="text-sm font-medium">
            {health.lastSent
              ? `${formatDate(health.lastSent.sentAt, dateFormat)} (${CHANNEL_LABELS[health.lastSent.channel] ?? health.lastSent.channel})`
              : "Never"}
          </dd>
        </div>
        {health.lastFailure && (
          <div className="col-span-2 min-w-0 md:col-span-3">
            <dt className="text-xs text-danger">Last failure</dt>
            <dd className="text-sm font-medium text-danger">
              {formatDate(health.lastFailure.sentAt, dateFormat)} via{" "}
              {CHANNEL_LABELS[health.lastFailure.channel] ?? health.lastFailure.channel}
              {health.lastFailure.error ? ` — ${health.lastFailure.error}` : ""}
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}
