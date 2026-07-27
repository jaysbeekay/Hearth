"use client";

import { useEffect, useRef, useState } from "react";
import { MoreVertical, X } from "lucide-react";

export function DetailOverflowMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-11 w-11 items-center justify-center rounded-lg border border-border hover:bg-black/5 dark:hover:bg-white/5"
      >
        <MoreVertical size={16} />
      </button>

      {open && (
        <>
          {/* Desktop: dropdown anchored to the trigger button. */}
          <div
            role="menu"
            className="absolute right-0 z-10 mt-1 hidden w-48 overflow-hidden rounded-lg border border-border bg-surface shadow-md md:block"
          >
            {children}
          </div>

          {/* Mobile: bottom sheet, matching BottomNav's "More" pattern —
              easier to hit with a thumb than a small anchored dropdown. */}
          <div
            className="fixed inset-0 z-40 flex items-end bg-black/40 md:hidden"
            onClick={() => setOpen(false)}
          >
            <div
              role="menu"
              className="w-full rounded-t-2xl border-t border-border bg-surface p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-1 flex items-center justify-end px-2 pt-1">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/5"
                >
                  <X size={18} />
                </button>
              </div>
              {children}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
