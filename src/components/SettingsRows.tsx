import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { SettingsDisclosureClient } from "@/components/SettingsDisclosure";
import { Pill } from "@/components/ui/Pill";
import { cardClass, dimmedClass } from "@/lib/ui";
import { RowLabel, RowSummary, rowClass } from "@/components/settingsRowParts";

// My account and Household settings share one look: a list of rows, each
// with an icon, a label and a one-line status. A row either opens its own
// page (SettingsLinkRow) or drops down in place to edit (SettingsDisclosure).

/** The rows of a settings screen. */
export function SettingsRowList({ children }: { children: React.ReactNode }) {
  return <ul className="flex flex-col gap-2">{children}</ul>;
}

/** A row that opens its own page. Members see an admin-only one greyed out. */
export function SettingsLinkRow({
  href,
  icon,
  label,
  summary,
  locked = false,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  summary?: string;
  /** Greyed out with "Admin only" instead of a link. */
  locked?: boolean;
}) {
  return (
    <li>
      {locked ? (
        <div aria-disabled="true" className={cardClass({ padding: "none" }, `${rowClass} text-muted ${dimmedClass}`)}>
          <RowLabel icon={icon} label={label} />
          <Pill>Admin only</Pill>
        </div>
      ) : (
        <Link href={href} className={cardClass({ padding: "none", interactive: true }, rowClass)}>
          <RowLabel icon={icon} label={label} />
          <span className="flex min-w-0 items-center gap-2">
            <RowSummary summary={summary} />
            <ChevronRight size={16} aria-hidden className="shrink-0 text-muted" />
          </span>
        </Link>
      )}
    </li>
  );
}

/**
 * A row that drops down in place to show its settings (see
 * SettingsDisclosureClient). The icon is rendered here, on the server, since
 * a component can't be passed to a client component.
 */
export function SettingsDisclosure({
  icon: Icon,
  label,
  ...props
}: {
  /** The URL fragment that opens it, and its DOM id. */
  id: string;
  icon: LucideIcon;
  label: string;
  summary?: string;
  children: React.ReactNode;
}) {
  return (
    <SettingsDisclosureClient
      {...props}
      label={<RowLabel icon={Icon} label={label} />}
    />
  );
}
