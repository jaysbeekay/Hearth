import { Fragment } from "react";
import Link from "next/link";
import { AlertCircle, Ban, Car, FileText, BellOff } from "lucide-react";
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
  system: BellOff,
};

// Every genuinely urgent thing in the household — contracts, warranties,
// vehicles, and the "you have no reminders configured" gap — combined into
// one list sorted by urgency, with the next action already decided rather
// than left for the user to figure out (#170).
export function NeedsAttentionQueue({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">
        Nothing needs attention right now.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {items.map((item) => {
        const Icon = KIND_ICON[item.kind];
        const row = (
          <li className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-3 shadow-stripe md:flex-nowrap">
            <Icon size={18} className="shrink-0 text-foreground/50" aria-hidden />

            <Link href={item.href} className="min-w-0 flex-1 hover:underline">
              <p className="truncate text-sm font-medium">{item.title}</p>
              {item.subtitle && (
                <p className="truncate text-xs text-foreground/60">{item.subtitle}</p>
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

            {item.days != null && <ExpiryBadge days={item.days} />}
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
                  ariaLabel={`Mark ${item.title} as cancelled`}
                  className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground/70 hover:bg-black/5 dark:hover:bg-white/5"
                >
                  <Ban size={12} />
                  Cancel
                </ConfirmForm>
              )}
              <Link
                href={item.action.href}
                className="inline-flex items-center rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:opacity-90"
              >
                {item.action.label}
              </Link>
            </div>
          </li>
        );

        if (item.kind === "system") {
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
