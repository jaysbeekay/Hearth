import Link from "next/link";

// Shared tab strip connecting /documents and /documents/inbox, so the two
// routes read as one workflow (upload → inbox → filed) instead of a page
// with a disconnected "Needs review" pill bolted on (#171).
function tabClass(active: boolean) {
  return `border-b-2 px-1 pb-2 text-sm font-medium ${
    active ? "border-accent text-accent" : "border-transparent text-muted hover:text-foreground"
  }`;
}

export function DocumentsTabs({
  active,
  inboxCount,
  filedCount,
  allCount,
}: {
  active: "inbox" | "filed" | "all";
  inboxCount: number;
  filedCount: number;
  allCount: number;
}) {
  return (
    <div className="flex gap-6 border-b border-border">
      <Link href="/documents/inbox" className={tabClass(active === "inbox")}>
        Inbox {inboxCount > 0 && `(${inboxCount})`}
      </Link>
      <Link href="/documents" className={tabClass(active === "filed")}>
        Filed ({filedCount})
      </Link>
      <Link href="/documents?view=all" className={tabClass(active === "all")}>
        All ({allCount})
      </Link>
    </div>
  );
}
