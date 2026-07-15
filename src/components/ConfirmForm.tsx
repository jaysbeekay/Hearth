"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { showToast } from "@/components/Toast";
import { useHasMounted } from "@/lib/useHasMounted";
import { enqueueOperation } from "@/lib/offlineQueue";

export function ConfirmForm({
  action,
  confirmText,
  children,
  className,
  ariaLabel,
  successMessage = "Removed.",
  offline,
}: {
  action: () => Promise<unknown>;
  confirmText: string;
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
  const mounted = useHasMounted();
  const triggerRef = useRef<HTMLButtonElement>(null);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, pending]);

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
      {mounted &&
        open &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={() => !pending && close()}
          >
            <div
              role="alertdialog"
              aria-modal="true"
              aria-describedby="confirm-dialog-text"
              className="w-full max-w-sm rounded-xl border border-border bg-surface p-5 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <p id="confirm-dialog-text" className="text-sm text-foreground">
                {confirmText}
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={close}
                  className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/5"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  autoFocus
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
                  className="rounded-lg bg-danger px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  {pending ? "Working…" : "Confirm"}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
