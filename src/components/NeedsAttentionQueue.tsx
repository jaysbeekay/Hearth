import { Fragment } from "react";
import Link from "next/link";
import { AlertCircle, Ban, Car, FileText, BellOff, Home, Inbox } from "lucide-react";
import { setContractStatus } from "@/lib/actions/contracts";
import { ConfirmForm } from "@/components/ConfirmForm";
import { ExpiryBadge } from "@/components/ExpiryBadge";
import { DismissibleRow } from "@/components/DismissibleRow";
import type { AttentionItem } from "@/lib/needsAttention";

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
}: {
  due: AttentionItem[];
  housekeeping: AttentionItem[];
}) {
  return (
    <div className="space-y-6">
      <section className="space-y-2" aria-labelledby="attention-due">
        <h3 id="attention-due" className="text-sm font-semibold">
          Due <span className="font-normal text-muted">({due.length})</span>
        </h3>
        {due.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted">
            Nothing due.
          </p>
        ) : (
          <AttentionList items={due} />
        )}
      </section>

      {housekeeping.length > 0 && (
        <section className="space-y-2" aria-labelledby="attention-housekeeping">
          <h3 id="attention-housekeeping" className="text-sm font-semibold">
            Housekeeping <span className="font-normal text-muted">({housekeeping.length})</span>
          </h3>
          <AttentionList items={housekeeping} />
        </section>
      )}
    </div>
  );
}

function AttentionList({ items }: { items: AttentionItem[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item) => {
        const Icon = item.id === "inbox" ? Inbox : KIND_ICON[item.kind];
        const row = (
          <li className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-3 md:flex-nowrap">
            <Icon size={18} className="shrink-0 text-muted" aria-hidden />

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
              <span className="inline-flex items-center rounded-md bg-muted/10 px-2.5 py-1 text-xs font-medium text-muted">
                No document
              </span>
            )}
            {item.badge && (
              <span className="inline-flex items-center gap-1 rounded-md bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning">
                <AlertCircle size={12} />
                {item.badge}
              </span>
            )}

            <div className="flex shrink-0 items-center gap-2">
              {item.canMarkCancelled && (
                <ConfirmForm
                  action={setContractStatus.bind(null, item.id, "CANCELLED")}
                  confirmText="Mark this contract as cancelled? This just changes its status — it won't delete the contract or its documents."
                  actionLabel="Mark as cancelled"
                  ariaLabel={`Mark ${item.title} as cancelled`}
                  className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted hover:bg-hover"
                >
                  <Ban size={12} />
                  Cancel
                </ConfirmForm>
              )}
              {item.action && (
                <Link
                  href={item.action.href}
                  className="inline-flex items-center rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:opacity-90"
                >
                  {item.action.label}
                </Link>
              )}
            </div>
          </li>
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
