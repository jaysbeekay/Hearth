"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableIn(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null,
  );
}

// Shared by every hand-rolled dialog/sheet/dropdown in the app (#297):
// - sets initial focus inside the container when it opens
// - traps Tab/Shift+Tab so it cycles within the container instead of
//   escaping into the obscured page
// - marks every other top-level element `inert` so Tab, a screen reader's
//   virtual cursor, and browser find-in-page can't reach content behind the
//   overlay — restored when the trap deactivates
// - returns focus to whatever was focused before the trap activated
//
// `container` only needs to be a real ancestor of the overlay's focusable
// content — it does not need to be portaled to <body>, since "every other
// top-level element" is computed relative to container's own root, not
// document.body specifically.
export function useFocusTrap(containerRef: React.RefObject<HTMLElement | null>, active: boolean) {
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;
    // Some callers (e.g. DetailOverflowMenu) keep a desktop-dropdown and a
    // mobile-sheet variant both mounted at once, toggled by a CSS media
    // query rather than by React — only one is ever actually on screen.
    // getClientRects() is empty for `display: none` regardless of the
    // container's own position scheme (unlike offsetParent, which is also
    // null for `position: fixed` elements like this app's dialog backdrops,
    // making it useless as a visibility check here). Skip entirely for the
    // CSS-hidden one so its trap doesn't inert the sibling that IS visible.
    if (container.getClientRects().length === 0) return;

    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;

    const root = container.getRootNode() as Document | ShadowRoot;
    const rootChildren = root === document ? document.body.children : root.children;
    const invertedSiblings: HTMLElement[] = [];
    for (const el of Array.from(rootChildren)) {
      if (!(el instanceof HTMLElement)) continue;
      if (el.contains(container) || el.hasAttribute("inert")) continue;
      el.setAttribute("inert", "");
      invertedSiblings.push(el);
    }

    const items = focusableIn(container);
    if (items.length > 0) {
      items[0].focus();
    } else {
      container.setAttribute("tabindex", "-1");
      container.focus();
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const current = focusableIn(container!);
      if (current.length === 0) return;
      const first = current[0];
      const last = current[current.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      for (const el of invertedSiblings) el.removeAttribute("inert");
      previouslyFocusedRef.current?.focus();
    };
  }, [active, containerRef]);
}
