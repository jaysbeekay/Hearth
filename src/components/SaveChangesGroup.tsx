"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass, cardClass } from "@/lib/ui";

// #363 — one "Save changes" per Settings tab instead of a Save button on
// every form. Each settings form keeps its own server action and messages;
// it marks itself with `data-save-group` and renders <GroupedSubmit> where
// its own button used to be. Inside a SaveChangesGroup that button goes
// away, the group notices which marked forms differ from what was last
// saved, and its sticky bar submits each of them. Forms that are actions
// rather than settings (change password, add a webhook) aren't marked and
// keep their buttons.
//
// A section counts as unsaved while its values differ from the last values
// that saved successfully, so undoing an edit clears it, a rejected or
// failed save leaves it unsaved for "Save changes" to retry, and an edit
// made while a save was in flight stays unsaved.

type ActionResult = { error?: string } | null | undefined;

interface SaveGroupApi {
  settled: (form: HTMLFormElement, ok: boolean) => void;
}

const SaveGroup = createContext<SaveGroupApi | null>(null);

/**
 * The form's own Save button, except inside a SaveChangesGroup, where it
 * renders no visible button and tells the group how the form's save went.
 * `state` is the form's useActionState state.
 */
export function GroupedSubmit({
  children,
  state,
  show = true,
}: {
  children: React.ReactNode;
  state: ActionResult;
  /** False means the form has nothing to save yet: no button, and the group skips it. */
  show?: boolean;
}) {
  const group = useContext(SaveGroup);
  const { pending } = useFormStatus();
  const ref = useRef<HTMLButtonElement>(null);
  const wasPending = useRef(false);

  useEffect(() => {
    // The action finished: report it with the state it returned, which
    // arrives in the same render that clears `pending`.
    if (wasPending.current && !pending && group) {
      const form = ref.current?.form;
      if (form) group.settled(form, !state?.error);
    }
    wasPending.current = pending;
  }, [pending, state, group]);

  if (group) {
    // Kept so Enter in a text field still saves this section on its own;
    // invisible, since the sticky bar is the page's Save button.
    return (
      <button
        ref={ref}
        type="submit"
        tabIndex={-1}
        aria-hidden="true"
        disabled={!show}
        data-save-idle={show ? undefined : ""}
        className="sr-only"
      >
        {children}
      </button>
    );
  }
  if (!show) return null;
  return <SubmitButton variant="secondary">{children}</SubmitButton>;
}

type Mode = "current" | "default";

/**
 * The form's values as one comparable string. Empty values are left out, so
 * a field that appears later (an API key box) only counts once it's filled,
 * and a password box the form clears after saving doesn't read as an edit.
 * "default" reads what the server rendered, for edits made before hydration.
 */
function snapshot(form: HTMLFormElement, mode: Mode = "current"): string {
  const pairs: string[] = [];
  for (const el of form.elements) {
    if (el instanceof HTMLInputElement) {
      if (!el.name || el.disabled || el.type === "file" || el.type === "submit" || el.type === "button") continue;
      if (el.type === "checkbox" || el.type === "radio") {
        if (mode === "default" ? el.defaultChecked : el.checked) pairs.push(`${el.name}=${el.value}`);
        continue;
      }
      // A hidden input's value is its default too, so a component that
      // drives one (the schedule picker) says what it started from.
      const initial = el.type === "hidden" ? (el.dataset.defaultValue ?? el.value) : el.defaultValue;
      const value = mode === "default" ? initial : el.value;
      if (value !== "") pairs.push(`${el.name}=${value}`);
    } else if (el instanceof HTMLTextAreaElement) {
      if (!el.name || el.disabled) continue;
      const value = mode === "default" ? el.defaultValue : el.value;
      if (value !== "") pairs.push(`${el.name}=${value}`);
    } else if (el instanceof HTMLSelectElement) {
      if (!el.name || el.disabled) continue;
      // React may set a select's starting value without marking the option
      // as `selected` in the markup; then the value at mount is the default.
      const marked = [...el.options].some((o) => o.defaultSelected);
      for (const option of el.options) {
        const selected = mode === "default" && marked ? option.defaultSelected : option.selected;
        if (selected && option.value !== "") pairs.push(`${el.name}=${option.value}`);
      }
    }
  }
  return JSON.stringify(pairs);
}

/**
 * Puts what a failed save sent back into the form: React resets a form's
 * uncontrolled fields after its action returns, even with an error, which
 * would otherwise throw away what was typed.
 */
function restore(form: HTMLFormElement, sent: FormData) {
  for (const el of form.elements) {
    if (el instanceof HTMLInputElement) {
      if (!el.name || ["hidden", "file", "submit", "button"].includes(el.type)) continue;
      if (el.type === "checkbox" || el.type === "radio") el.checked = sent.getAll(el.name).includes(el.value);
      else el.value = String(sent.get(el.name) ?? "");
    } else if (el instanceof HTMLTextAreaElement) {
      if (el.name) el.value = String(sent.get(el.name) ?? "");
    } else if (el instanceof HTMLSelectElement && el.name) {
      const values = sent.getAll(el.name);
      for (const option of el.options) option.selected = values.includes(option.value);
    }
  }
}

interface FormEntry {
  /** The values as of the last successful save (or as the page loaded). */
  baseline: string;
  /** The values sent by the save in flight, if any. */
  inFlight: string | null;
  /** Bumped on every edit, to tell whether one happened during a save. */
  edits: number;
  editsAtSubmit: number;
  failed: boolean;
}

type Entries = ReadonlyMap<HTMLFormElement, FormEntry>;

function groupForm(target: EventTarget | null): HTMLFormElement | null {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLFormElement>("form[data-save-group]");
}

function newEntry(form: HTMLFormElement): FormEntry {
  return { baseline: snapshot(form, "default"), inFlight: null, edits: 0, editsAtSubmit: 0, failed: false };
}

function update(
  entries: Entries,
  form: HTMLFormElement,
  change: (entry: FormEntry) => FormEntry | null,
  fresh?: FormEntry,
): Entries {
  const existing = entries.get(form) ?? fresh;
  if (!existing) return entries;
  const next = change(existing);
  if (!next) return entries;
  return new Map(entries).set(form, next);
}

export function SaveChangesGroup({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [entries, setEntries] = useState<Entries>(() => new Map());
  // Bumped when a form's values change without an edit we track (React
  // resetting a form after its action), so the bar re-reads them.
  const [, setVersion] = useState(0);
  // What each in-flight save sent, to put back if it fails. Only read in
  // event handlers and effects, never while rendering.
  const sentData = useRef(new Map<HTMLFormElement, FormData>());
  const bump = useCallback(() => {
    setVersion((v) => v + 1);
  }, []);

  const markEdited = useCallback((event: Event) => {
    const form = groupForm(event.target);
    if (!form) return;
    const fresh = newEntry(form);
    setEntries((current) =>
      update(current, form, (e) => ({ ...e, edits: e.edits + 1, failed: false }), fresh),
    );
    // This listener runs before React handles the same event, so a value a
    // component derives from it (the schedule picker's hidden cron) isn't in
    // the DOM yet; look again once React has committed it.
    setTimeout(bump, 0);
  }, [bump]);

  const markSubmitting = useCallback((event: Event) => {
    const form = groupForm(event.target);
    if (!form) return;
    const sent = snapshot(form);
    sentData.current.set(form, new FormData(form));
    // No edits while it saves: React resets the form when the action
    // returns, which would silently drop anything typed in the meantime.
    form.inert = true;
    const fresh = newEntry(form);
    setEntries((current) =>
      update(current, form, (e) => ({ ...e, inFlight: sent, editsAtSubmit: e.edits }), fresh),
    );
  }, []);

  const markReset = useCallback(() => {
    setTimeout(bump, 0);
  }, [bump]);

  const api = useMemo<SaveGroupApi>(
    () => ({
      settled: (form, ok) => {
        form.inert = false;
        const sent = sentData.current.get(form);
        sentData.current.delete(form);
        if (!ok && sent) {
          restore(form, sent);
          // And again in case React's reset lands after this.
          setTimeout(() => {
            restore(form, sent);
            bump();
          }, 0);
        }
        // Read now: after a success React has reset the form to its new defaults.
        const after = snapshot(form);
        setEntries((current) =>
          update(current, form, (e) => {
            if (e.inFlight === null) return null;
            if (!ok) return { ...e, inFlight: null, failed: true };
            // With no edit during the save, what's on screen now is what was
            // saved (as the server echoed it back); otherwise it's the values sent.
            const baseline = e.edits === e.editsAtSubmit ? after : e.inFlight;
            return { ...e, baseline, inFlight: null, failed: false };
          }),
        );
      },
    }),
    [bump],
  );

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    // Baselines from what the server rendered, so an edit made before the
    // page hydrated still counts.
    // Read now, not inside the state update, which can run after an edit.
    const initial = [...root.querySelectorAll<HTMLFormElement>("form[data-save-group]")].map(
      (form) => [form, newEntry(form)] as const,
    );
    setEntries((current) => {
      const next = new Map(current);
      for (const [form, entry] of initial) if (!next.has(form)) next.set(form, entry);
      return next;
    });
    root.addEventListener("input", markEdited);
    root.addEventListener("change", markEdited);
    root.addEventListener("submit", markSubmitting);
    root.addEventListener("reset", markReset);
    return () => {
      root.removeEventListener("input", markEdited);
      root.removeEventListener("change", markEdited);
      root.removeEventListener("submit", markSubmitting);
      root.removeEventListener("reset", markReset);
    };
  }, [markEdited, markSubmitting, markReset]);

  const live = [...entries].filter(([form]) => form.isConnected && !form.querySelector("[data-save-idle]"));
  const dirty = live.filter(([form, e]) => snapshot(form) !== e.baseline).map(([form]) => form);
  const saving = live.some(([, e]) => e.inFlight !== null);
  const failed = live.some(([, e]) => e.failed);

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
