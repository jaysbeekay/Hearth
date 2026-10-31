"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore } from "lucide-react";
import { showToast } from "@/components/Toast";
import type { ActionState } from "@/lib/actions/auth";

type Result = ActionState;

// #355 — Archive and Restore for a Vehicle or Property the household no
// longer has. Archive isn't Trash, so there's no confirm dialog: it changes
// nothing but the record's standing, and the toast offers Undo. Online only,
// like the other actions that aren't queued for offline sync.
export function ArchiveButton({
  mode,
  action,
  undo,
  noun,
  className,
}: {
  mode: "archive" | "restore";
  action: () => Promise<Result>;
  /** Archive only: puts the record back, for the toast's Undo. */
  undo?: () => Promise<Result>;
  /** "vehicle" or "property", for the messages. */
  noun: string;
  className?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function run() {
    setPending(true);
    try {
      const result = await action();
      if (result?.error) {
        showToast(result.error, "error");
        return;
      }
      if (mode === "archive" && undo) {
        showToast("Archived.", "success", {
          action: {
            label: "Undo",
            onClick: async () => {
              try {
                const undone = await undo();
                if (undone?.error) {
                  showToast(undone.error, "error");
                  return;
                }
                showToast("Restored.");
                router.refresh();
              } catch {
                showToast(`Couldn't restore the ${noun}. Try again from its page.`, "error");
              }
            },
          },
        });
      } else {
        showToast(mode === "archive" ? "Archived." : "Restored.");
      }
      router.refresh();
    } catch {
      showToast(
        `Couldn't ${mode === "archive" ? "archive" : "restore"} the ${noun}. Check your connection and try again.`,
        "error",
      );
    } finally {
      setPending(false);
    }
  }

  const Icon = mode === "archive" ? Archive : ArchiveRestore;
  return (
    <button type="button" disabled={pending} onClick={() => {
        run().catch(() => undefined);
      }} className={className}>
      <Icon size={16} />
      {mode === "archive" ? "Archive" : "Restore"}
    </button>
  );
}
