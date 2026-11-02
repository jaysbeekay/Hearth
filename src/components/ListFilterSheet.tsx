"use client";

import { useId, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { buttonClass, sheetClass } from "@/lib/ui";

/**
 * #365 — below `md`, a list's selects and filter chips move behind one
 * "Filters" button that opens a bottom sheet, so the first record is on the
 * first screen. `active` is how many filters are on, shown on the button.
 */
export function ListFilterSheet({
  active,
  children,
}: {
  active: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const titleId = useId();

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); }}
        aria-haspopup="dialog"
        className={buttonClass("secondary", {}, "md:hidden")}
      >
        <SlidersHorizontal size={16} aria-hidden />
        {active > 0 ? `Filters (${active})` : "Filters"}
      </button>
      <Dialog
        open={open}
        onClose={() => { setOpen(false); }}
        labelledBy={titleId}
        backdropClassName="fixed inset-0 z-50 flex items-end bg-black/40 md:hidden"
        panelClassName={sheetClass(
          "max-h-[90dvh] space-y-4 overflow-y-auto p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]",
        )}
      >
        <h2 id={titleId} className="font-medium">
          Filters
        </h2>
        {children}
        <div className="flex justify-end">
          <button type="button" onClick={() => { setOpen(false); }} className={buttonClass("primary")}>
            Done
          </button>
        </div>
      </Dialog>
    </>
  );
}
