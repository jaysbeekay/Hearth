"use client";

import { useRef, useState } from "react";

const REVEAL_WIDTH = 88; // px width of the revealed action panel
const DRAG_THRESHOLD = 40; // px of leftward drag before it counts as "open"

// Swipe-left-to-reveal a quick action (e.g. delete) on a list row, without
// replacing the existing tap-to-open-detail-page / detail-page-menu paths —
// this is an accelerator for touch users, not the only way to reach the
// action, so nothing here is keyboard-inaccessible. Only responds to touch
// pointers; mouse users keep clicking through to the detail page as before.
// `revealAction` is rendered as-is in the revealed panel — pass the same
// ConfirmForm-wrapped delete button already used elsewhere, so the
// confirmation dialog stays consistent across the app.
export function SwipeableListItem({
  children,
  revealAction,
}: {
  children: React.ReactNode;
  revealAction: React.ReactNode;
}) {
  const [dragX, setDragX] = useState(0);
  const [open, setOpen] = useState(false);
  const startX = useRef<number | null>(null);
  const dragging = useRef(false);

  function handlePointerDown(e: React.PointerEvent) {
    if (e.pointerType !== "touch") return;
    startX.current = e.clientX;
    dragging.current = true;
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!dragging.current || startX.current == null) return;
    const delta = e.clientX - startX.current;
    const base = open ? -REVEAL_WIDTH : 0;
    setDragX(Math.min(0, Math.max(-REVEAL_WIDTH, base + delta)));
  }

  function handlePointerUp() {
    if (!dragging.current) return;
    dragging.current = false;
    startX.current = null;
    const shouldOpen = dragX <= -DRAG_THRESHOLD;
    setOpen(shouldOpen);
    setDragX(shouldOpen ? -REVEAL_WIDTH : 0);
  }

  return (
    <div
      className={`relative overflow-hidden rounded-lg md:overflow-visible ${open ? "z-40" : ""}`}
    >
      {/*
       * The bottom nav and mobile upload FAB are `fixed` with `z-30`, which
       * paints above any normal-flow row regardless of scroll position —
       * for a row scrolled near the bottom of the viewport, that put this
       * revealed action visually on screen but behind the FAB, so a real
       * tap (and this component's own e2e test) landed on the FAB's link
       * instead. `z-40` on the wrapper while open lifts the whole row (and
       * this action) above both, without exceeding the z-50 confirm dialog
       * that `revealAction`'s click opens.
       */}
      <div
        className="absolute inset-y-0 right-0 flex items-stretch md:hidden"
        style={{ width: REVEAL_WIDTH }}
      >
        {revealAction}
      </div>
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{ transform: `translateX(${dragX}px)` }}
        className="relative touch-pan-y bg-background transition-transform duration-150 ease-out"
      >
        {children}
      </div>
    </div>
  );
}
