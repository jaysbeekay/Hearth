"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { showToast } from "@/components/Toast";
import { deleteOperation, enqueueOperation } from "@/lib/offlineQueue";
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
  undo,
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
  // `kind` is the Document kind, for the "document" entity.
  offline?: { entity: string; entityId: string; label: string; parentId?: string; kind?: string };
  // #371 — for trash-backed deletes: the success toast offers Undo, which
  // calls the matching restore action. `href` is where to go back to when
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

  const destructive = /\b(delete|remove|trash|discard|permanently)\b/i.test(actionLabel);

  function showDoneToast() {
    if (!successMessage) return;
    if (!undo) {
      showToast(successMessage);
      return;
    }
    showToast(successMessage, "success", {
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
            showToast("Couldn't restore it — find it in Settings → Trash.", "error");
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
