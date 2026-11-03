"use client";

import { useId, useRef, useState } from "react";
import { BellOff } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { DateInput } from "@/components/DateInput";
import { useDateFormat } from "@/components/DateFormatProvider";
import { useCanWrite } from "@/components/CanWriteProvider";
import { showToast } from "@/components/Toast";
import { snoozeRecord, unsnoozeRecord } from "@/lib/actions/snooze";
import { SNOOZE_PRESETS, type SnoozeKind } from "@/lib/snooze";
import { bannerClass, buttonClass, inputClass } from "@/lib/ui";
import { formatDate } from "@/lib/utils";

// #354 — "I know, remind me later": takes a Due Contract, Warranty or
// Vehicle out of Needs attention and pauses its Reminders until a chosen
// day. Changing the record's dates (renewing it) ends the Snooze.
export function SnoozeButton({
  kind,
  recordId,
  title,
  className,
}: {
  kind: SnoozeKind;
  recordId: string;
  /** The record's name, for the dialog and the button's accessible name. */
  title: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  const textId = useId();
  const dateId = useId();

  function close() {
    setOpen(false);
    setError(null);
    triggerRef.current?.focus();
  }

  async function submit(formData: FormData) {
    setPending(true);
    setError(null);
    try {
      const result = await snoozeRecord(null, formData);
      if (result?.error) {
        setError(result.error);
        return;
      }
      showToast(result?.success ?? "Snoozed.");
      close();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Snooze ${title}`}
        className={className ?? buttonClass("secondary")}
      >
        <BellOff size={16} aria-hidden />
        Snooze
      </button>
      <Dialog open={open} onClose={close} disableClose={pending} labelledBy={headingId} describedBy={textId}>
        <h2 id={headingId} className="text-sm font-medium">
          Snooze {title}
        </h2>
        <p id={textId} className="mt-1 text-sm text-muted">
          It leaves Needs attention and its reminders pause until then. Renewing it or changing its dates ends the
          snooze.
        </p>
        <form action={submit} className="mt-4 space-y-4">
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="id" value={recordId} />
          <div className="flex flex-wrap gap-2">
            {SNOOZE_PRESETS.map((preset) => (
              <button
                key={preset.days}
                type="submit"
                name="days"
                value={preset.days}
                disabled={pending}
                className={`${buttonClass("secondary")} disabled:opacity-50`}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="space-y-1">
            <label htmlFor={dateId} className="text-xs text-muted">
              Or until a date
            </label>
            <div className="flex flex-wrap items-start gap-2">
              <div className="min-w-0 flex-1">
                <DateInput id={dateId} name="until" className={inputClass} />
              </div>
              <button
                type="submit"
                disabled={pending}
                className={`${buttonClass("primary")} disabled:opacity-50`}
              >
                Snooze until date
              </button>
            </div>
          </div>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={close}
              disabled={pending}
              className={`${buttonClass("quiet")} disabled:opacity-50`}
            >
              Cancel
            </button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

/**
 * #354 — what a Snoozed record's detail page shows in place of its Due
 * banners: until when, who Snoozed it, and Unsnooze for writers.
 */
export function SnoozedNotice({
  kind,
  recordId,
  until,
  byName,
}: {
  kind: SnoozeKind;
  recordId: string;
  /** The day the record comes back, as YYYY-MM-DD. */
  until: string;
  byName?: string | null;
}) {
  const canWrite = useCanWrite();
  const dateFormat = useDateFormat();
  const [pending, setPending] = useState(false);
  const when = formatDate(`${until}T00:00:00.000Z`, dateFormat);

  async function unsnooze() {
    setPending(true);
    try {
      const formData = new FormData();
      formData.set("kind", kind);
      formData.set("id", recordId);
      const result = await unsnoozeRecord(null, formData);
      showToast(result?.error ?? result?.success ?? "Snooze ended.", result?.error ? "error" : "success");
    } catch {
      showToast("Something went wrong. Please try again.", "error");
    } finally {
      setPending(false);
    }
  }

  return (
    <div role="status" className={bannerClass("neutral", "flex flex-wrap items-center justify-between gap-3")}>
      <p className="flex items-center gap-2 text-sm font-medium">
        <BellOff size={16} className="shrink-0" aria-hidden />
        <span>
          Snoozed{byName ? ` by ${byName}` : ""} until {when}. Its reminders resume then.
        </span>
      </p>
      {canWrite && (
        <button
          type="button"
          onClick={unsnooze}
          disabled={pending}
          className={`${buttonClass("secondary")} disabled:opacity-50`}
        >
          {pending ? "Working…" : "Unsnooze"}
        </button>
      )}
    </div>
  );
}
