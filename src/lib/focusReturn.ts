"use client";

// #646 — where keyboard focus goes back to after a confirm dialog or an
// in-place action (Delete, Archive) has run. It goes back to the button that
// started it while that button is still on the page, as before (#57). When the
// action removed that button's row, it goes to, in order:
//   1. the next row's own control (its "More actions" button) in the same list
//   2. otherwise the previous row's
//   3. otherwise (the list is now empty) the list's Add button or heading; for
//      a list inside a row (a segment's Documents), that row's control; for a
//      list inside another list (a record's Documents card), that one's
//   4. as a last resort <main>, matching the Toast fallback (#618)
// so a keyboard or screen-reader user isn't dropped onto <body>.
//
// Pages opt in with data attributes, so no list has to know about focus:
//   data-focus-list           on the element that holds the list, its heading
//                             and its Add button; it should stay on the page
//                             when the list is empty
//   data-focus-row            on each row in that list
//   data-focus-row-target     (optional) the element in a row to focus, or a
//                             wrapper whose first control is; by default the
//                             row's "More actions" button, else its first
//                             focusable control
//   data-focus-list-fallback  (optional) what to focus once the list is empty;
//                             by default its first control outside the rows,
//                             else its heading

const ROW = "[data-focus-row]";
const LIST = "[data-focus-list]";
const ROW_TARGET = "[data-focus-row-target]";
const LIST_FALLBACK = "[data-focus-list-fallback]";
// Set on DetailOverflowMenu's own button.
const MENU_BUTTON = "[data-overflow-menu-button]";
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const HEADING = "h1, h2, h3, h4, h5, h6";

// The longest we watch the page for: a row that should be removed has this
// long to leave after the action resolves (a slow revalidation), and a target
// that is re-rendered away within it is followed. Any click or key press by
// the user ends the watch sooner.
const WAIT_MS = 30_000;

export type FocusOrigin = {
  /** The button that opened the dialog or ran the action. */
  trigger: HTMLElement | null;
  /** The "More actions" button of the menu the trigger sits in, if any. */
  menuButton: HTMLElement | null;
  row: HTMLElement | null;
  list: HTMLElement | null;
  /** The row the list itself sits in, e.g. the segment a Document list belongs to. */
  outerRow: HTMLElement | null;
  /** The list the list itself sits in, e.g. a record's Documents card. */
  outerList: HTMLElement | null;
  /** The row's position among its list's rows when captured. */
  index: number;
};

/**
 * Records where an action started, while it is still on the page: a trigger
 * inside a DetailOverflowMenu may sit in a portaled sheet, so its row is found
 * from the menu's own button rather than from the trigger.
 */
export function captureFocusOrigin(trigger: HTMLElement | null, menuButton: HTMLElement | null = null): FocusOrigin {
  const anchor = menuButton ?? trigger;
  const row = anchor?.closest<HTMLElement>(ROW) ?? null;
  const list = (row ?? anchor)?.closest<HTMLElement>(LIST) ?? null;
  const index = row && list ? rowsOf(list).indexOf(row) : -1;
  const outerRow = list?.parentElement?.closest<HTMLElement>(ROW) ?? null;
  const outerList = list?.parentElement?.closest<HTMLElement>(LIST) ?? null;
  return { trigger, menuButton, row, list, outerRow, outerList, index };
}

let stopPending: (() => void) | null = null;

/**
 * Gives focus back after the action that `origin` describes.
 *
 * Without `removed`, focus goes back at once: to the trigger, or the nearest
 * thing still there. If what it lands on is then re-rendered away (a status
 * change that drops the row after all), focus follows to a neighbour.
 *
 * With `removed` (a delete or archive that succeeded, so the row is on its way
 * out), focus moves once the row has actually left the page — after the
 * server action's revalidation re-render, not before — and only if focus was
 * lost with it. Until then it stays where the closing menu or dialog left it,
 * normally the row's ⋮ button, rather than moving onto the doomed row.
 */
export function returnFocus(origin: FocusOrigin, { removed = false }: { removed?: boolean } = {}): void {
  stopPending?.();
  let placed: HTMLElement | null = null;

  const place = () => {
    placed = pickTarget(origin);
    if (placed) focusElement(placed);
  };

  // Returns true once there's nothing left to watch for.
  const step = (): boolean => {
    if (removed && origin.row?.isConnected) return false;
    if (!placed) {
      if (removed && !focusLost() && document.activeElement !== origin.trigger) {
        // Focus already went somewhere on purpose (e.g. into the toast).
        return true;
      }
      place();
      return false;
    }
    if (document.activeElement === placed) return false;
    // It hasn't taken focus yet (a closing dialog still had the page inert,
    // or it was disabled while the action ran), or it was re-rendered away.
    if (focusLost()) {
      place();
      return false;
    }
    // Focus is somewhere else on purpose: stop.
    return true;
  };

  if (typeof MutationObserver === "undefined") {
    step();
    return;
  }
  const observer = new MutationObserver(() => {
    if (step()) stop();
    else armOnceFocused();
  });
  // The user doing anything at all — clicking text, a link, pressing a key —
  // means focus is theirs again. Only listened for once focus has landed: a
  // key pressed while the row is still leaving and focus is lost would
  // otherwise cancel the hand-off and leave focus on <body>.
  let armed = false;
  const armOnceFocused = () => {
    if (armed || !placed || document.activeElement !== placed) return;
    armed = true;
    document.addEventListener("pointerdown", stop, true);
    document.addEventListener("keydown", stop, true);
  };
  const timer = window.setTimeout(() => {
    stop();
    // The row never left: it's evidently staying, so its own control is a
    // safe place for focus that would otherwise be lost.
    if (!placed && focusLost()) {
      const target = pickTarget(origin);
      if (target) focusElement(target);
    }
  }, WAIT_MS);
  function stop() {
    observer.disconnect();
    window.clearTimeout(timer);
    document.removeEventListener("pointerdown", stop, true);
    document.removeEventListener("keydown", stop, true);
    if (stopPending === stop) stopPending = null;
  }
  stopPending = stop;
  if (step()) {
    stop();
    return;
  }
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["inert", "disabled"] });
  armOnceFocused();
}

function focusLost(): boolean {
  const active = document.activeElement;
  return !active || active === document.body || active === document.documentElement;
}

function pickTarget(origin: FocusOrigin): HTMLElement | null {
  const { trigger, menuButton, row, list, outerRow, outerList, index } = origin;
  // Not isFocusable: a trigger is often disabled only while its action runs.
  if (trigger && isVisible(trigger)) return trigger;
  if (menuButton && isFocusable(menuButton)) return menuButton;
  if (row?.isConnected) {
    const own = rowTarget(row);
    if (own) return own;
  }
  if (list?.isConnected) {
    const rows = rowsOf(list);
    if (index >= 0) {
      // The row is gone, so the one after it now sits at its index.
      const neighbour = (rows[index] && rowTarget(rows[index])) ?? (rows[index - 1] && rowTarget(rows[index - 1]));
      if (neighbour) return neighbour;
    }
    const fallback = listFallback(list);
    if (fallback) return fallback;
  }
  // The list is empty, or went with its last row.
  const outer =
    (outerRow?.isConnected ? rowTarget(outerRow) : null) ?? (outerList?.isConnected ? listFallback(outerList) : null);
  if (outer) return outer;
  return document.querySelector<HTMLElement>("main");
}

function rowsOf(list: HTMLElement): HTMLElement[] {
  // Only this list's own rows, not those of a list nested inside one.
  return Array.from(list.querySelectorAll<HTMLElement>(ROW)).filter((row) => row.parentElement?.closest(LIST) === list);
}

function rowTarget(row: HTMLElement): HTMLElement | null {
  const explicit = row.querySelector<HTMLElement>(ROW_TARGET);
  if (explicit && isFocusable(explicit)) {
    if (explicit.matches(FOCUSABLE) || explicit.hasAttribute("tabindex")) return explicit;
    // A wrapper: the first control inside it.
    const inner = Array.from(explicit.querySelectorAll<HTMLElement>(FOCUSABLE)).find(isFocusable);
    if (inner) return inner;
  }
  const menu = Array.from(row.querySelectorAll<HTMLElement>(MENU_BUTTON)).find(isFocusable);
  if (menu) return menu;
  return Array.from(row.querySelectorAll<HTMLElement>(FOCUSABLE)).find(isFocusable) ?? null;
}

function listFallback(list: HTMLElement): HTMLElement | null {
  const explicit = list.querySelector<HTMLElement>(LIST_FALLBACK);
  if (explicit && isVisible(explicit)) return explicit;
  const control = Array.from(list.querySelectorAll<HTMLElement>(FOCUSABLE)).find(
    (el) => !el.closest(ROW) && isFocusable(el),
  );
  if (control) return control;
  return Array.from(list.querySelectorAll<HTMLElement>(HEADING)).find((el) => !el.closest(ROW) && isVisible(el)) ?? null;
}

function isVisible(el: HTMLElement): boolean {
  return el.isConnected && el.getClientRects().length > 0;
}

function isFocusable(el: HTMLElement): boolean {
  return isVisible(el) && !(el as HTMLButtonElement).disabled;
}

function focusElement(el: HTMLElement) {
  if (el.matches(FOCUSABLE)) {
    el.focus();
    return;
  }
  // A heading, row label or <main> isn't focusable by default; -1 keeps it out
  // of the Tab order. Like the Toast's fallback (#618), don't scroll to it.
  if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
  el.focus({ preventScroll: true });
}
