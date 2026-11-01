import { BellOff, BellRing, AlertTriangle, CheckCircle2, ChevronDown } from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import { Timestamp } from "@/components/Timestamp";
import { TestConnectionButton } from "@/components/TestConnectionButton";
import { WriteOnly } from "@/components/CanWriteProvider";
import { sendTestReminder, type TestReminderTarget } from "@/lib/actions/reminders";
import type { ReminderHealth } from "@/lib/notifications/health";
import { Card } from "@/components/ui/Card";
import {
  channelLabel,
  channelSummary,
  reminderSummary,
  type ReminderTone,
} from "@/lib/notifications/reminderSummary";

/** One dated thing a card reports on: a record's single date, or one of a Vehicle's three. */
export interface ReminderHealthEntry {
  /**
   * Shown before the line when a card covers several dates ("Registration"),
   * and then required: it's each row's key. A single-date card leaves it out.
   */
  label?: string;
  health: ReminderHealth;
  /** #352 — the record whose real reminder "Send test reminder" sends. */
  testTarget?: TestReminderTarget;
}

const TONE_TEXT = new Map<ReminderTone, string>([
  ["neutral", "text-foreground"],
  ["warning", "text-warning"],
  ["danger", "text-danger"],
]);

function HealthGrid({ health, dateFormat }: { health: ReminderHealth; dateFormat?: string | null }) {
  return (
    <dl className="grid grid-cols-2 gap-4 md:grid-cols-3">
      <div className="min-w-0">
        <dt className="text-xs text-muted">Enabled</dt>
        <dd className="text-sm font-medium">
          {/* #387 — a record that Needs review holds its Reminders until it's confirmed. */}
          {health.onHold ? "On hold until reviewed" : health.enabled ? "Yes" : "No"}
        </dd>
      </div>
      <div className="min-w-0">
        <dt className="text-xs text-muted">Next reminder</dt>
        <dd className="text-sm font-medium">
          {health.nextReminder?.kind === "next-check"
            ? "On the next check"
            : health.nextReminder
              ? formatDate(health.nextReminder.date, dateFormat)
              : "—"}
        </dd>
      </div>
      <div className="min-w-0">
        <dt className="text-xs text-muted">Thresholds</dt>
        <dd className="text-sm font-medium">
          {health.thresholds.length > 0 ? health.thresholds.map((t) => `${t}d`).join(", ") : "—"}
        </dd>
      </div>
      <div className="min-w-0">
        <dt className="text-xs text-muted">Last sent</dt>
        <dd className="text-sm font-medium">
          {health.lastSent ? (
            <>
              <Timestamp value={health.lastSent.sentAt} /> ({channelLabel(health.lastSent.channel)})
            </>
          ) : (
            "Never"
          )}
        </dd>
      </div>
      {health.lastFailure && (
        <div className="col-span-2 min-w-0 md:col-span-3">
          <dt className="text-xs text-danger">Last failure</dt>
          <dd className="text-sm font-medium text-danger">
            <Timestamp value={health.lastFailure.sentAt} /> via {channelLabel(health.lastFailure.channel)}
            {health.lastFailure.error ? ` — ${health.lastFailure.error}` : ""}
          </dd>
        </div>
      )}
    </dl>
  );
}

// The reminder-health block on contract, warranty, tenancy and vehicle
// detail pages — answers "will this actually remind me" and "did the last
// attempt work", not just "is a date set" (#201). #360: one line per date,
// with the household's delivery set-up said once; the full read-out and
// "Send test reminder" open on click.
export function ReminderHealthCard({
  title = "Reminder health",
  health,
  testTarget,
  entries: givenEntries,
  dateFormat,
}: {
  title?: string;
  /** A single-date card's health; or pass `entries` for several dates. */
  health?: ReminderHealth;
  testTarget?: TestReminderTarget;
  entries?: ReminderHealthEntry[];
  dateFormat?: string | null;
}) {
  const entries = givenEntries ?? (health ? [{ health, testTarget }] : []);
  if (entries.length === 0) return null;
  // Delivery is household-wide: every entry shares the same channels.
  const { channels, deliveryReady } = entries[0].health;
  const anyEnabled = entries.some((e) => e.health.enabled);

  return (
    <Card>
      <details className="group">
        <summary className="flex cursor-pointer list-none items-start justify-between gap-3 [&::-webkit-details-marker]:hidden">
          <div className="min-w-0 space-y-1">
            <h2 className="flex items-center gap-2 font-medium">
              {anyEnabled ? (
                <BellRing size={16} className="text-muted" aria-hidden />
              ) : (
                <BellOff size={16} className="text-muted" aria-hidden />
              )}
              {title}
            </h2>
            {!deliveryReady && (
              <p className="flex items-center gap-1.5 text-sm text-warning">
                <AlertTriangle size={16} className="shrink-0" aria-hidden />
                Reminders can&apos;t be delivered yet — an admin needs to set up email or push.
              </p>
            )}
            <ul className="space-y-0.5">
              {entries.map((entry) => {
                const { tone, text } = reminderSummary(entry.health, dateFormat);
                return (
                  <li key={entry.label ?? "only"} className={cn("text-sm", TONE_TEXT.get(tone))}>
                    {entry.label && <span className="font-medium">{entry.label}: </span>}
                    {text}
                  </li>
                );
              })}
            </ul>
          </div>
          <span className="flex shrink-0 items-center gap-1 text-xs text-muted">
            Details
            <ChevronDown size={16} className="transition-transform group-open:rotate-180" aria-hidden />
          </span>
        </summary>

        <div className="mt-4 space-y-4 border-t border-border pt-4">
          <dl className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <div className="min-w-0">
              <dt className="text-xs text-muted">Delivery channel</dt>
              <dd className="text-sm font-medium">{channelSummary(channels)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted">Delivery status</dt>
              <dd className="flex items-center gap-1.5 text-sm font-medium">
                {deliveryReady ? (
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
          </dl>
          {entries.map((entry) => (
            <section key={entry.label ?? "only"} className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                {entry.label ? <h3 className="text-sm font-medium">{entry.label}</h3> : <span />}
                {/* #400 — sending one is a write, so read-only members see only the read-out. */}
                <WriteOnly>
                  <TestConnectionButton
                    action={
                      entry.testTarget ? sendTestReminder.bind(null, entry.testTarget) : () => sendTestReminder()
                    }
                    label={entry.label ? `Send test reminder for ${entry.label}` : "Send test reminder"}
                  />
                </WriteOnly>
              </div>
              <HealthGrid health={entry.health} dateFormat={dateFormat} />
            </section>
          ))}
        </div>
      </details>
    </Card>
  );
}
