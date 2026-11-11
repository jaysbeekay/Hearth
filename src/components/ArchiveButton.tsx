"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore } from "lucide-react";
import { showToast } from "@/components/Toast";
import { useCloseOverflowMenu, useOverflowMenuButton } from "@/components/DetailOverflowMenu";
import { captureFocusOrigin, returnFocus, type FocusOrigin } from "@/lib/focusReturn";
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
  const closeMenu = useCloseOverflowMenu();
  const menuButtonRef = useOverflowMenuButton();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState(false);

  // #646 — the button closes with the menu, and Archive or Restore can take
  // the record out of the list it was in, so focus is handed on rather than
  // left on <body>.
  async function run(origin: FocusOrigin) {
    setPending(true);
    try {
      const result = await action();
      if (result?.error) {
        showToast(result.error, "error");
        returnFocus(origin);
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
      returnFocus(origin, { removed: true });
    } catch {
      returnFocus(origin);
      showToast(
        `Couldn't ${mode === "archive" ? "archive" : "restore"} the ${noun}. Check your connection and try again.`,
        "error",
      );
    } finally {
      setPending(false);
    }
  }

  function handleClick() {
    const origin = captureFocusOrigin(buttonRef.current, menuButtonRef?.current ?? null);
    closeMenu();
    run(origin).catch(() => undefined);
  }

  const Icon = mode === "archive" ? Archive : ArchiveRestore;
  return (
    <button ref={buttonRef} type="button" disabled={pending} onClick={handleClick} className={className}>
      <Icon size={16} />
      {mode === "archive" ? "Archive" : "Restore"}
    </button>
  );
}
