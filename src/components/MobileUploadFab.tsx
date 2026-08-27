"use client";

import { useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Camera, Upload, Loader2 } from "lucide-react";
import { saveToInbox } from "@/lib/actions/import";
import { showToast } from "@/components/Toast";

// A persistent one-tap capture action on mobile, since photographing and
// uploading a receipt/document is a primary, frequent action for this app,
// not something that should require digging through "More" first (#173).
// Hidden on /import itself since the user is already there, and on every
// /new and /edit form route — those routes end in a fixed-position submit
// button at roughly this same screen position, which the FAB would cover.
//
// #299: the main FAB opens the rear camera directly (accept + capture on a
// hidden input) rather than routing through the generic /import queue,
// which offered no camera affordance and defaulted every capture to an
// untyped "Contract". A captured photo instead goes straight to the Inbox
// via saveToInbox — the same guessedType heuristic email-ingested documents
// already get (computeInboxIntake) — so it's typed before it's ever filed,
// not silently mis-typed. "Choose file" stays a tap away for anyone who
// wants the bulk/desktop-style queue instead.
export function MobileUploadFab() {
  const pathname = usePathname();
  const router = useRouter();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  if (pathname.startsWith("/import")) return null;
  if (pathname.endsWith("/new") || pathname.endsWith("/edit")) return null;

  async function handleCapture(file: File) {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const result = await saveToInbox(formData);
      if (result.error) {
        showToast(result.error, "error");
      } else {
        showToast("Saved to your Inbox for review.");
        router.refresh();
      }
    } catch {
      showToast("Couldn't upload that photo. Try again.", "error");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="fixed right-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-30 flex flex-col items-end gap-2 md:hidden">
      <Link
        href="/import"
        aria-label="Choose a file to upload"
        className="flex h-11 items-center gap-2 rounded-full bg-surface px-4 text-sm font-medium text-foreground shadow-lg ring-1 ring-border hover:bg-black/5 dark:hover:bg-white/5"
      >
        <Upload size={16} />
        Choose file
      </Link>

      <label
        htmlFor={inputId}
        aria-label="Take a photo to upload"
        aria-disabled={uploading}
        className="flex size-14 cursor-pointer items-center justify-center rounded-full bg-accent text-accent-foreground shadow-lg hover:opacity-90 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent"
      >
        {uploading ? <Loader2 size={24} className="animate-spin" /> : <Camera size={24} />}
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept="image/*"
          capture="environment"
          disabled={uploading}
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleCapture(file);
          }}
        />
      </label>
    </div>
  );
}
