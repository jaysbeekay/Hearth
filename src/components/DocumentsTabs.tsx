import Link from "next/link";
import { Upload } from "lucide-react";
import { TakePhotoButton } from "@/components/TakePhotoButton";
import { DOCUMENTS_TABS } from "@/lib/routeLabels";
import { buttonClass } from "@/lib/ui";

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
      <Link href={DOCUMENTS_TABS.inbox.href} className={tabClass(active === "inbox")}>
        {DOCUMENTS_TABS.inbox.label} {inboxCount > 0 && `(${inboxCount})`}
      </Link>
      <Link href={DOCUMENTS_TABS.filed.href} className={tabClass(active === "filed")}>
        {DOCUMENTS_TABS.filed.label} ({filedCount})
      </Link>
      <Link href={DOCUMENTS_TABS.all.href} className={tabClass(active === "all")}>
        {DOCUMENTS_TABS.all.label} ({allCount})
      </Link>
    </div>
  );
}

// Header actions shared by every Documents tab (#401): Upload opens the
// /import queue, and on phones Take photo saves a camera shot to the Inbox.
// In the page flow rather than floating, so they never cover a row.
export function DocumentsUploadActions() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <TakePhotoButton />
      <Link href="/import" className={`${buttonClass("secondary")} gap-2`}>
        <Upload size={16} />
        Upload
      </Link>
    </div>
  );
}
