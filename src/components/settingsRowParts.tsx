import type { LucideIcon } from "lucide-react";

// Shared by SettingsRows (server) and SettingsDisclosure (client): a plain
// module, so both get the real values rather than a client reference.

// min-h-11 (44px) keeps each row comfortably tappable on mobile.
export const rowClass = "flex min-h-11 items-center justify-between gap-3 px-3 py-2 text-sm font-medium";

export function RowLabel({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <span className="flex items-center gap-3">
      <Icon size={20} aria-hidden />
      {label}
    </span>
  );
}

export function RowSummary({ summary }: { summary?: string }) {
  return summary ? <span className="min-w-0 truncate text-right text-xs font-normal text-muted">{summary}</span> : null;
}

