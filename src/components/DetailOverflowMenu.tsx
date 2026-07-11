"use client";

import { useEffect, useRef, useState } from "react";
import { MoreVertical } from "lucide-react";

export function DetailOverflowMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="More actions"
        aria-expanded={open}
        className="rounded-lg border border-border p-2 hover:bg-black/5 dark:hover:bg-white/5"
      >
        <MoreVertical size={16} />
      </button>
      {open && (
        <div
          className="absolute right-0 z-10 mt-1 w-48 overflow-hidden rounded-lg border border-border bg-surface shadow-md"
        >
          {children}
        </div>
      )}
    </div>
  );
}
