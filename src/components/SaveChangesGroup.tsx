"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass, cardClass } from "@/lib/ui";

// #363 — one "Save changes" per Settings tab instead of a Save button on
// every form. Each settings form keeps its own server action and messages;
// it marks itself with `data-save-group` and renders <GroupedSubmit> where
// its own button used to be. Inside a SaveChangesGroup that button goes
// away, the group notices which marked forms were edited, and its sticky
// bar submits each of them. Forms that are actions rather than settings
// (change password, add a webhook) aren't marked and keep their buttons.
//
// A section only counts as saved once its own action comes back without an
// error, and only for the values it sent: an edit made while the save was
// in flight keeps the section unsaved, and a rejected or failed save leaves
// it unsaved so "Save changes" can retry it.

type ActionResult = { error?: string } | null | undefined;

interface SaveGroupApi {
  settled: (form: HTMLFormElement, ok: boolean) => void;
}

const SaveGroup = createContext<SaveGroupApi | null>(null);

/**
 * The form's own Save button, except inside a SaveChangesGroup, where it
 * renders nothing visible and tells the group how the form's save went.
 * `state` is the form's useActionState state.
 */
export function GroupedSubmit({
  children,
  state,
  show = true,
}: {
  children: React.ReactNode;
  state: ActionResult;
  /** False hides the standalone button (nothing to save yet). */
  show?: boolean;
}) {
  const group = useContext(SaveGroup);
  const { pending } = useFormStatus();
  const ref = useRef<HTMLSpanElement>(null);
  const wasPending = useRef(false);

  useEffect(() => {
    // The action finished: report it with the state it returned, which
    // arrives in the same render that clears `pending`.
    if (wasPending.current && !pending && group) {
      const form = ref.current?.closest("form");
      if (form) group.settled(form, !state?.error);
    }
    wasPending.current = pending;
  }, [pending, state, group]);

  if (group) return <span ref={ref} hidden />;
  if (!show) return null;
  return <SubmitButton variant="secondary">{children}</SubmitButton>;
}

interface FormEntry {
  /** Bumped on every edit. */
  edits: number;
  /** `edits` as of the last successful save. */
  saved: number;
  /** `edits` as of the save in flight, if any. */
  inFlight: number | null;
  failed: boolean;
}

function groupForm(target: EventTarget | null): HTMLFormElement | null {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLFormElement>("form[data-save-group]");
}

function formIsEdited(form: HTMLFormElement): boolean {
  return [...form.elements].some((el) => {
    if (el instanceof HTMLInputElement) {
      if (el.type === "hidden") return false;
      if (el.type === "checkbox" || el.type === "radio") return el.checked !== el.defaultChecked;
      return el.value !== el.defaultValue;
    }
    if (el instanceof HTMLTextAreaElement) return el.value !== el.defaultValue;
    if (el instanceof HTMLSelectElement) return [...el.options].some((o) => o.selected !== o.defaultSelected);
    return false;
  });
}

type Entries = ReadonlyMap<HTMLFormElement, FormEntry>;

const NEW_ENTRY: FormEntry = { edits: 0, saved: 0, inFlight: null, failed: false };

function update(entries: Entries, form: HTMLFormElement, change: (entry: FormEntry) => FormEntry | null): Entries {
  const next = change(entries.get(form) ?? NEW_ENTRY);
  if (!next) return entries;
  return new Map(entries).set(form, next);
}

export function SaveChangesGroup({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [entries, setEntries] = useState<Entries>(() => new Map());

  const markEdited = useCallback((event: Event) => {
    const form = groupForm(event.target);
    if (!form) return;
    setEntries((current) => update(current, form, (e) => ({ ...e, edits: e.edits + 1 })));
  }, []);

  const markSubmitting = useCallback((event: Event) => {
    const form = groupForm(event.target);
    if (!form) return;
    setEntries((current) => update(current, form, (e) => ({ ...e, inFlight: e.edits })));
  }, []);

  const api = useMemo<SaveGroupApi>(
    () => ({
      settled: (form, ok) => {
        setEntries((current) =>
          update(current, form, (e) =>
            e.inFlight === null
              ? null
              : {
                  ...e,
                  saved: ok ? Math.max(e.saved, e.inFlight) : e.saved,
                  failed: !ok,
                  inFlight: null,
                },
          ),
        );
      },
    }),
    [],
  );

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    // An edit made before the page hydrated fired no event we heard, so
    // look for fields that already differ from what the server rendered.
    const edited = [...root.querySelectorAll<HTMLFormElement>("form[data-save-group]")].filter(formIsEdited);
    if (edited.length > 0) {
      setEntries((current) =>
        edited.reduce((acc, form) => update(acc, form, (e) => ({ ...e, edits: e.edits + 1 })), current),
      );
    }
    root.addEventListener("input", markEdited);
    root.addEventListener("change", markEdited);
    root.addEventListener("submit", markSubmitting);
    return () => {
      root.removeEventListener("input", markEdited);
      root.removeEventListener("change", markEdited);
      root.removeEventListener("submit", markSubmitting);
    };
  }, [markEdited, markSubmitting]);

  const live = [...entries].filter(([form]) => form.isConnected);
  const dirty = live.filter(([, e]) => e.edits > e.saved).map(([form]) => form);
  const saving = live.some(([, e]) => e.inFlight !== null);
  const failed = live.some(([, e]) => e.failed && e.edits > e.saved);

  function saveAll() {
    // In page order, so the messages appear top to bottom. A form that
    // fails its own validation (a required field left empty) isn't sent.
    const forms = [...dirty].sort((a, b) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
    );
    for (const form of forms) {
      if (!form.checkValidity()) {
        form.reportValidity();
        continue;
      }
      form.requestSubmit();
    }
  }

  const count = dirty.length;
  let status: string;
  if (saving) status = "Saving…";
  else if (failed) status = "Some changes weren't saved. Check the messages above, then try again.";
  else if (count === 0) status = "No unsaved changes.";
  else if (count === 1) status = "You have unsaved changes.";
  else status = `You have unsaved changes in ${count} sections.`;

  return (
    <SaveGroup.Provider value={api}>
      <div ref={ref} className="space-y-6">
        {children}
        <div
          role="region"
          aria-label="Unsaved changes"
          className={cardClass(
            {},
            // Above the mobile bottom nav; near the bottom edge on desktop.
            "sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 flex items-center justify-between gap-3 md:bottom-4",
          )}
        >
          <p className="text-sm text-muted" aria-live="polite">
            {status}
          </p>
          <button
            type="button"
            onClick={saveAll}
            disabled={saving || count === 0}
            className={buttonClass("primary")}
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </SaveGroup.Provider>
  );
}
