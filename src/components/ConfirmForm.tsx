"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { showToast } from "@/components/Toast";
import { deleteOperation, enqueueOperation, OfflineQueueRefusedError } from "@/lib/offlineQueue";
import { Dialog } from "@/components/Dialog";
import { buttonClass } from "@/lib/ui";

export function ConfirmForm({
  action,
  confirmText,
  actionLabel = "Confirm",
  children,
  className,
  ariaLabel,
  successMessage,
  offline,
  undo,
}: {
  action: () => Promise<unknown>;
  confirmText: string;
  // #298: names the actual destructive verb + object ("Remove Alex")
  // instead of a generic "Confirm" that doesn't say what pressing it does.
  // Ignored when `undo` is set: a trash-backed delete always says
  // "Delete" (#362).
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
  // `kind` is the Document kind, for the "document" entity.
  offline?: { entity: string; entityId: string; label: string; parentId?: string; kind?: string };
  // #371 — for trash-backed deletes: the success toast offers Undo, which
  // calls the matching restore action. #362 — the confirm button then says
  // "Delete" and the toast "Moved to Recently deleted.", whatever the record. `href` is where to go back to when
  // the delete navigated away (deleting from a record's own detail page).
  undo?: { action: () => Promise<unknown>; href?: string };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  const confirmLabel = undo ? "Delete" : actionLabel;
  const doneMessage = successMessage ?? (undo ? "Moved to Recently deleted." : "Removed.");
  const destructive = /\b(delete|remove|trash|discard|permanently)\b/i.test(confirmLabel);

  function showDoneToast() {
    if (!doneMessage) return;
    if (!undo) {
      showToast(doneMessage);
      return;
    }
    showToast(doneMessage, "success", {
      action: {
        label: "Undo",
        onClick: async () => {
          try {
            const result = await undo.action();
            const error = (result as { error?: string } | undefined)?.error;
            if (error) {
              showToast(error, "error");
              return;
            }
            showToast("Restored.");
            if (undo.href) router.push(undo.href);
            else router.refresh();
          } catch {
            showToast("Couldn't restore it — find it in Settings → Recently deleted.", "error");
          }
        },
      },
    });
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
        {destructive && !/household/i.test(confirmText) && (
          <p className="mt-2 text-xs text-muted">
            This affects shared household data for everyone with access.
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={close}
            className={`${buttonClass("secondary")} disabled:opacity-50`}
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
                  const opId = await enqueueOperation({
                    label: offline.label,
                    entity: offline.entity,
                    operation: "delete",
                    entityId: offline.entityId,
                    parentId: offline.parentId,
                    kind: offline.kind,
                  });
                  window.dispatchEvent(new Event("offline-queued"));
                  // Nothing has reached the server yet, so undoing just
                  // drops the queued delete.
                  showToast("Delete queued — will sync when you reconnect.", "success", {
                    action: opId
                      ? {
                          label: "Undo",
                          onClick: async () => {
                            await deleteOperation(opId);
                            window.dispatchEvent(new Event("offline-queued"));
                            showToast("Delete cancelled.");
                          },
                        }
                      : undefined,
                  });
                  close();
                  return;
                }
                const result = await action();
                // Actions report expected failures as { error } rather
                // than throwing; show it instead of the success toast.
                const failure = (result as { error?: string } | undefined)?.error;
                if (failure) showToast(failure, "error");
                else showDoneToast();
                close();
              } catch (err) {
                // Server actions that redirect() throw a special signal
                // Next.js's router handles itself — anything else is a
                // real failure worth surfacing.
                const digest = (err as { digest?: string })?.digest;
                if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) {
                  // A delete from a record's own page redirects away; the
                  // toast container lives in the layout, so it survives.
                  showDoneToast();
                  throw err;
                }
                showToast(
                  err instanceof OfflineQueueRefusedError ? err.message : "Something went wrong. Please try again.",
                  "error",
                );
              } finally {
                setPending(false);
              }
            }}
            className={buttonClass("danger")}
          >
            {pending ? "Working…" : confirmLabel}
          </button>
        </div>
      </Dialog>
    </>
  );
}
