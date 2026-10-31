import Link from "next/link";
import { BellRing, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Timestamp } from "@/components/Timestamp";
import type { HouseholdReminderHealth } from "@/lib/notifications/health";
import { Card } from "@/components/ui/Card";
import { bannerClass } from "@/lib/ui";

function channelSummary(channels: HouseholdReminderHealth["channels"]) {
  const active = [
    channels.email && "Email",
    channels.ntfy && "ntfy",
    channels.webhook && "Webhook",
  ].filter(Boolean);
  return active.length > 0 ? active.join(" + ") : "None configured";
}

// Household-wide rollup of the per-record ReminderHealthCard signals (#292)
// — confirms "reminders are actually working" from one place, and surfaces
// which soon-to-expire records have no working path to a delivered
// reminder, without opening each one individually.
export function HouseholdReminderHealthCard({
  health,
  appUrlConfigured = true,
}: {
  health: HouseholdReminderHealth;
  /** #352 — without APP_URL, reminders can't link back to the record. */
  appUrlConfigured?: boolean;
}) {
  return (
    <Card className="space-y-4">
      <div>
        <h3 className="flex items-center gap-2 font-medium">
          <BellRing size={16} className="text-muted" aria-hidden />
          Reminder delivery health
        </h3>
        <p className="mt-0.5 text-xs text-muted">
          Household-wide view of whether reminders are actually reaching a channel.
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <div className="min-w-0">
          <dt className="text-xs text-muted">Delivery channel</dt>
          <dd className="text-sm font-medium">{channelSummary(health.channels)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted">Status</dt>
          <dd className="flex items-center gap-1.5 text-sm font-medium">
            {health.deliveryReady ? (
              <>
                <CheckCircle2 size={16} className="text-success" aria-hidden />
                Ready
              </>
            ) : (
              <>
                <AlertTriangle size={16} className="text-muted" aria-hidden />
                Not configured
              </>
            )}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted">Last activity</dt>
          <dd className="text-sm font-medium">
            {health.lastActivityAt ? <Timestamp value={health.lastActivityAt} /> : "Never"}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted">Sent (30 days)</dt>
          <dd className="text-sm font-medium">{health.recentSent}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted">Failed (30 days)</dt>
          <dd className={`text-sm font-medium ${health.recentFailed > 0 ? "text-danger" : ""}`}>
            {health.recentFailed}
          </dd>
        </div>
      </dl>

      {health.deliveryReady && !appUrlConfigured && (
        <p className={bannerClass("neutral", "flex items-start gap-2")}>
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
          Reminders can&apos;t link to the record they&apos;re about until the server&apos;s
          APP_URL is set to the address you open Hearth on.
        </p>
      )}

      {!health.deliveryReady ? (
        <p className={bannerClass("neutral", "flex items-start gap-2")}>
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
          No delivery channel configured — every record that comes due has no working reminder
          coverage until email, ntfy, or a webhook is set up above.
        </p>
      ) : health.uncovered.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">
            {health.uncovered.length} record{health.uncovered.length === 1 ? "" : "s"} due within
            90 days {health.uncovered.length === 1 ? "has" : "have"} no working reminder coverage:
          </p>
          <ul className="space-y-1">
            {health.uncovered.map((item, i) => (
              <li key={i} className="flex items-center justify-between gap-2 text-sm">
                <Link href={item.href} className="min-w-0 truncate text-accent hover:underline">
                  {item.title}
                </Link>
                <span className="shrink-0 text-xs text-muted">{item.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-sm text-success">
          <CheckCircle2 size={16} aria-hidden />
          Every record due within 90 days has working reminder coverage.
        </p>
      )}
    </Card>
  );
}
