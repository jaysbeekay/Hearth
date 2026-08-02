import Link from "next/link";
import { AlertTriangle } from "lucide-react";

// Shown once, right after creating a record, when the file the user
// attached couldn't be saved directly to it (#203) — driven by the
// ?docFallback= query param the create actions append on that path. Never
// silently drops the upload: "inbox" means it's safe in the Household
// Inbox for the user to file manually; "failed" is the genuine last-resort
// case where even that didn't work.
export function DocFallbackBanner({ docFallback }: { docFallback?: string }) {
  if (docFallback !== "inbox" && docFallback !== "failed") return null;

  return (
    <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
      {docFallback === "inbox" ? (
        <p>
          This record saved, but your document couldn&apos;t be attached automatically — we saved it
          to the{" "}
          <Link href="/documents/inbox" className="font-medium underline">
            Documents inbox
          </Link>{" "}
          instead. File it from there whenever you&apos;re ready.
        </p>
      ) : (
        <p>This record saved, but we couldn&apos;t save your document. Please try uploading it again below.</p>
      )}
    </div>
  );
}
