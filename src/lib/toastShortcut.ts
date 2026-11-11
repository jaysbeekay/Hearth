// #631 (WCAG 2.2.1) — the keyboard shortcut that moves focus into the newest
// toast, so its action (e.g. Undo) can be reached before it times out.
// Alt+T is the convention Sonner uses. It's matched on `code`, not `key`, so
// Option+T on a Mac (which types "†") still counts. Kept free of React/DOM
// so it can be unit tested.

export const TOAST_SHORTCUT_LABEL = "Alt+T";

export interface ShortcutKey {
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/** Whether a keydown is the toast shortcut: Alt+T and no other modifier. */
export function isToastShortcut(e: ShortcutKey): boolean {
  return e.code === "KeyT" && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
}

/** The screen-reader-only hint an action toast carries. */
export function toastShortcutHint(actionLabel: string): string {
  return `Press ${TOAST_SHORTCUT_LABEL} to reach ${actionLabel}.`;
}
