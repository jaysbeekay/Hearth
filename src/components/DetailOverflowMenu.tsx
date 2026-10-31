"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { MoreVertical, X } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { buttonClass, overlayClass } from "@/lib/ui";

// #355 — an item that acts in place (Archive) rather than navigating away
// calls this to close the menu; one that is a link or opens a dialog already
// leaves it.
const CloseMenuContext = createContext<() => void>(() => undefined);
export function useCloseOverflowMenu() {
  return useContext(CloseMenuContext);
}

// Also the list pages' ⋮ menu below `md` (#369), where `label` names it
// "More list actions" so it reads differently from a record's own menu.
export function DetailOverflowMenu({
  children,
  label = "More actions",
}: {
  children: React.ReactNode;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  // Desktop dropdown isn't a modal overlay (no backdrop, closes on any
  // outside click) so it doesn't go through the shared Dialog primitive —
  // but it still needs the same "Tab can't escape into the page" guarantee
  // the mobile sheet gets from Dialog, hence the trap applied directly here.
  useFocusTrap(dropdownRef, open);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const closeMenu = () => {
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={buttonClass("secondary", { icon: true })}
      >
        <MoreVertical size={16} />
      </button>

      {open && (
        <>
          {/* Desktop: dropdown anchored to the trigger button. Not "menu"
              role/semantics (#297) — these are plain action buttons/links,
              not true ARIA menuitems with arrow-key navigation, so "dialog"
              is the honest role. */}
          <div
            ref={dropdownRef}
            role="dialog"
            aria-label={label}
            className={overlayClass("absolute right-0 z-10 mt-1 hidden w-48 overflow-hidden md:block")}
          >
            <CloseMenuContext.Provider value={closeMenu}>{children}</CloseMenuContext.Provider>
          </div>

          {/* Mobile: bottom sheet, matching BottomNav's "More" pattern —
              easier to hit with a thumb than a small anchored dropdown. */}
          <Dialog
            open={open}
            onClose={() => setOpen(false)}
            label={label}
            backdropClassName="fixed inset-0 z-40 flex items-end bg-black/40 md:hidden"
            panelClassName="w-full rounded-t-lg border-t border-border bg-surface p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]"
          >
            <>
              <div className="mb-1 flex items-center justify-end px-2 pt-1">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-hover"
                >
                  <X size={20} />
                </button>
              </div>
              <CloseMenuContext.Provider value={closeMenu}>{children}</CloseMenuContext.Provider>
            </>
          </Dialog>
        </>
      )}
    </div>
  );
}
