"use client";

import { useRef, useState } from "react";
import { showToast } from "@/components/Toast";
import { enqueueOperation } from "@/lib/offlineQueue";
import { buttonVariants, compactButtonClass } from "@/lib/buttonStyles";
import { cn } from "@/lib/utils";
import { Dialog } from "@/components/Dialog";

export function ConfirmForm({
  action,
  confirmText,
  actionLabel = "Confirm",
  children,
  className,
  ariaLabel,
  successMessage = "Removed.",
  offline,
}: {
  action: () => Promise<unknown>;
  confirmText: string;
  // #298: names the actual destructive verb + object ("Delete contract",
  // "Remove Alex") instead of a generic "Confirm" that doesn't say what
  // pressing it does.
  actionLabel?: string;
  children: React.ReactNode;
  className?: string;
  ariaLabel?: string;
  successMessage?: string;
  // When provided, offline confirmation queues a delete instead of calling
  // `action` (which would fail with no connection) — only wire this up for
  // entities with an offline sync handler (see entityHandlers.ts). parentId
  // is needed for entities scoped under a parent record, e.g. a document
  // delete needs its owning contract/product/item id for the ownership check.
  offline?: { entity: string; entityId: string; label: string; parentId?: string };
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={className}
        aria-label={ariaLabel}
        onClick={() => setOpen(true)}
      >
        {children}
      </button>
      <Dialog
        open={open}
        onClose={close}
        disableClose={pending}
        role="alertdialog"
        describedBy="confirm-dialog-text"
      >
        <p id="confirm-dialog-text" className="text-sm text-foreground">
          {confirmText}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={close}
            className={`${compactButtonClass()} disabled:opacity-50`}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={async () => {
              setPending(true);
              try {
                if (offline && typeof navigator !== "undefined" && !navigator.onLine) {
                  await enqueueOperation({
                    label: offline.label,
                    entity: offline.entity,
                    operation: "delete",
                    entityId: offline.entityId,
                    parentId: offline.parentId,
                  });
                  window.dispatchEvent(new Event("offline-queued"));
                  showToast("Delete queued — will sync when you reconnect.");
                  close();
                  return;
                }
                await action();
                if (successMessage) showToast(successMessage);
                close();
              } catch (err) {
                // Server actions that redirect() throw a special signal
                // Next.js's router handles itself — anything else is a
                // real failure worth surfacing.
                const digest = (err as { digest?: string })?.digest;
                if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) {
                  throw err;
                }
                showToast("Something went wrong. Please try again.", "error");
              } finally {
                setPending(false);
              }
            }}
            className={cn(
              "inline-flex min-h-11 items-center justify-center rounded-lg px-3 text-sm font-medium disabled:opacity-50",
              buttonVariants.danger,
            )}
          >
            {pending ? "Working…" : actionLabel}
          </button>
        </div>
      </Dialog>
    </>
  );
}
