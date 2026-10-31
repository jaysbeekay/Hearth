import { Fragment } from "react";
import Link from "next/link";
import { AlertCircle, Ban, Car, FileText, BellOff, Home, Inbox } from "lucide-react";
import { setContractStatus } from "@/lib/actions/contracts";
import { ConfirmForm } from "@/components/ConfirmForm";
import { ExpiryBadge } from "@/components/ExpiryBadge";
import { StatusPill } from "@/components/StatusPill";
import { DismissibleRow } from "@/components/DismissibleRow";
import type { AttentionItem } from "@/lib/needsAttention";
import { buttonClass } from "@/lib/buttonStyles";
import { Card } from "@/components/ui";
import { emptyStateClass } from "@/lib/ui";

// Same key NotificationNudgeBanner used, so a household that already
// dismissed that banner doesn't see the equivalent queue row reappear.
const REMINDER_NUDGE_DISMISS_KEY = "hearth:notification-nudge-dismissed";

const KIND_ICON: Record<AttentionItem["kind"], React.ComponentType<{ size?: number; className?: string }>> = {
  contract: FileText,
  warranty: FileText,
  vehicle: Car,
  property: Home,
  system: BellOff,
};

// Everything in the household that needs acting on, split into what's Due
// (a Due entry inside its due-soon window or overdue, most pressing first)
// and Housekeeping (records to
// tidy and setup gaps) so a deadline is never buried under tidying (#357).
export function NeedsAttentionQueue({
  due,
  housekeeping,
  canWrite = true,
}: {
  due: AttentionItem[];
  housekeeping: AttentionItem[];
  /** False for a READONLY member: rows stay links to the record, without their action buttons (#400). */
  canWrite?: boolean;
}) {
  return (
    <div className="space-y-6">
      <section className="space-y-2" aria-labelledby="attention-due">
        <h3 id="attention-due" className="text-sm font-medium">
          Due <span className="font-normal text-muted">({due.length})</span>
        </h3>
        {due.length === 0 ? (
          <p className={emptyStateClass()}>
            Nothing due.
          </p>
        ) : (
          <AttentionList items={due} canWrite={canWrite} />
        )}
      </section>

      {housekeeping.length > 0 && (
        <section className="space-y-2" aria-labelledby="attention-housekeeping">
          <h3 id="attention-housekeeping" className="text-sm font-medium">
            Housekeeping <span className="font-normal text-muted">({housekeeping.length})</span>
          </h3>
          <AttentionList items={housekeeping} canWrite={canWrite} />
        </section>
      )}
    </div>
  );
}

function AttentionList({ items, canWrite }: { items: AttentionItem[]; canWrite: boolean }) {
  return (
    <ul className="space-y-2">
      {items.map((item) => {
        const Icon = item.id === "inbox" ? Inbox : KIND_ICON[item.kind];
        const row = (
          <Card as="li" className="flex flex-wrap items-center gap-3 md:flex-nowrap">
            <Icon size={16} className="shrink-0 text-muted" aria-hidden />

            <Link href={item.href} className="min-w-0 flex-1 hover:underline">
              <p className="truncate text-sm font-medium">{item.title}</p>
              {item.subtitle && (
                <p className="truncate text-xs text-muted">{item.subtitle}</p>
              )}
            </Link>

            {/* Zero-content, full-width flex item: forces the badge and
                action buttons below onto a new line on narrow screens,
                without touching Link's own min-w-0/truncate sizing — wrapping
                Icon+Link in a flex div to carry that basis-full instead grows
                the whole row past the viewport, since it breaks the
                min-content chain truncate relies on to shrink. Collapses to
                nothing at md, where the row is single-line anyway. */}
            <div className="basis-full md:hidden" aria-hidden />

            {item.entry && <ExpiryBadge entry={item.entry} />}
            {item.noDocument && (
              <StatusPill status="housekeeping">No document</StatusPill>
            )}
            {item.badge && (
              // #412 — Housekeeping (Needs review, Not configured, Reminder
              // failed) is neutral, as on the detail banner: colour is kept
              // for Overdue and Due soon.
              <StatusPill status={item.badge === "Needs review" ? "needs-review" : "housekeeping"}>
                <AlertCircle size={16} aria-hidden />
                {item.badge}
              </StatusPill>
            )}

            {canWrite && (
              <div className="flex shrink-0 items-center gap-2">
                {item.canMarkCancelled && (
                  <ConfirmForm
                    action={setContractStatus.bind(null, item.id, "CANCELLED")}
                    confirmText="Mark this contract as cancelled? This just changes its status — it won't delete the contract or its documents."
                    actionLabel="Mark as cancelled"
                    ariaLabel={`Mark ${item.title} as cancelled`}
                    className={buttonClass("secondary", { className: "text-muted" })}
                  >
                    <Ban size={16} />
                    Cancel
                  </ConfirmForm>
                )}
                {item.action && (
                  <Link
                    href={item.action.href}
                    className={buttonClass("primary")}
                  >
                    {item.action.label}
                  </Link>
                )}
              </div>
            )}
          </Card>
        );

        if (item.id === "system-reminders") {
          return (
            <DismissibleRow key={item.id} dismissKey={REMINDER_NUDGE_DISMISS_KEY}>
              {row}
            </DismissibleRow>
          );
        }
        // A plain fragment, not a <div> — <ul> can only contain <li> directly,
        // and a wrapping element here would break that.
        return <Fragment key={`${item.kind}-${item.id}`}>{row}</Fragment>;
      })}
    </ul>
  );
}
