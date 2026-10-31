"use client";

import { useState } from "react";
import { Dialog } from "@/components/Dialog";
import { IcalTokenSection } from "@/components/IcalTokenSection";
import { compactButtonClass } from "@/lib/buttonStyles";

// #368 — the Upcoming page's one obvious next step is getting these dates
// into the calendar people already use. Same feed controls as Settings →
// Calendar feed, opened in place.
export function CalendarSubscribeButton({ hasToken, appUrl }: { hasToken: boolean; appUrl: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`shrink-0 ${compactButtonClass()}`}>
        Subscribe in your calendar
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        labelledBy="calendar-feed-heading"
        panelClassName="w-full max-w-lg rounded-lg border border-border bg-surface p-5 shadow-overlay"
      >
        <IcalTokenSection hasToken={hasToken} appUrl={appUrl} embedded />
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={() => setOpen(false)} className={compactButtonClass()}>
            Done
          </button>
        </div>
      </Dialog>
    </>
  );
}
