"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useHasMounted } from "@/lib/useHasMounted";
import { useFocusTrap } from "@/lib/useFocusTrap";

// Shared modal/sheet primitive (#297) — every hand-rolled overlay in the app
// (ConfirmForm, MobileNavDrawer, BottomNav's "More" sheet,
// DetailOverflowMenu's mobile sheet) used to reimplement its own portal,
// backdrop, and Escape handling with no focus trap, no initial focus, and no
// focus restore. This centralizes that behavior; callers only supply the
// panel's own visual chrome (centered card vs bottom sheet vs side drawer)
// via `panelClassName`.
export function Dialog({
  open,
  onClose,
  label,
  labelledBy,
  describedBy,
  role = "dialog",
  panelClassName = "w-full max-w-sm rounded-xl border border-border bg-surface p-5 shadow-xl",
  backdropClassName = "fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4",
  disableClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label?: string;
  labelledBy?: string;
  describedBy?: string;
  role?: "dialog" | "alertdialog";
  panelClassName?: string;
  backdropClassName?: string;
  // Suppresses Escape/backdrop-click close — for a confirm dialog mid-submit.
  disableClose?: boolean;
  children: React.ReactNode;
}) {
  const mounted = useHasMounted();
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, open);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !disableClose) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, disableClose, onClose]);

  if (!mounted || !open) return null;

  return createPortal(
    <div className={backdropClassName} onClick={() => !disableClose && onClose()}>
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-label={label}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        className={panelClassName}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
