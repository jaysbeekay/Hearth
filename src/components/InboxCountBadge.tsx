import { cn } from "@/lib/utils";

// How many Documents are waiting in the Inbox, shown beside Documents in the
// sidebar and on the bottom bar (#369, #407). Nothing renders when the
// Inbox is empty. The number itself is hidden from screen readers; the link
// carries it in its name instead, via inboxLinkLabel, so it reads
// "Documents, 3 in Inbox".
export function InboxCountBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) {
    return null;
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        "rounded-full bg-accent px-1.5 text-xs font-medium leading-4 tabular-nums text-accent-foreground",
        className,
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

/** The accessible name for a link showing an InboxCountBadge, or undefined to keep its text. */
export function inboxLinkLabel(label: string, count: number): string | undefined {
  return count > 0 ? `${label}, ${count} in Inbox` : undefined;
}
