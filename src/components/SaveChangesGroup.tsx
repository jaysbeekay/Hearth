"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass, cardClass } from "@/lib/ui";

// #363 — one "Save changes" per Settings tab instead of a Save button on
// every form. Each settings form keeps its own server action and messages;
// it marks itself with `data-save-group` and renders <GroupedSubmit> where
// its own button used to be. Inside a SaveChangesGroup that button goes
// away, the group notices which marked forms were edited, and its sticky
// bar submits each of them. Forms that are actions rather than settings
// (change password, add a webhook) aren't marked and keep their buttons.

const InSaveGroup = createContext(false);

/** The form's own Save button, except inside a SaveChangesGroup. */
export function GroupedSubmit({ children }: { children: React.ReactNode }) {
  const grouped = useContext(InSaveGroup);
  if (grouped) return null;
  return <SubmitButton variant="secondary">{children}</SubmitButton>;
}

function groupForm(target: EventTarget | null): HTMLFormElement | null {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLFormElement>("form[data-save-group]");
}

export function SaveChangesGroup({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [dirty, setDirty] = useState<HTMLFormElement[]>([]);

  const markDirty = useCallback((event: Event) => {
    const form = groupForm(event.target);
    if (!form) return;
    setDirty((current) => (current.includes(form) ? current : [...current, form]));
  }, []);

  const markSaved = useCallback((event: Event) => {
    const form = groupForm(event.target);
    if (!form) return;
    setDirty((current) => current.filter((f) => f !== form));
  }, []);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.addEventListener("input", markDirty);
    root.addEventListener("change", markDirty);
    root.addEventListener("submit", markSaved);
    return () => {
      root.removeEventListener("input", markDirty);
      root.removeEventListener("change", markDirty);
      root.removeEventListener("submit", markSaved);
    };
  }, [markDirty, markSaved]);

  function saveAll() {
    // In page order, so the messages appear top to bottom. A form that
    // fails its own validation (a required field left empty) stays dirty.
    const forms = dirty
      .filter((form) => form.isConnected)
      .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    const stillDirty = forms.filter((form) => {
      if (!form.checkValidity()) {
        form.reportValidity();
        return true;
      }
      form.requestSubmit();
      return false;
    });
    setDirty(stillDirty);
  }

  const count = dirty.length;

  return (
    <InSaveGroup.Provider value={true}>
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
            {count === 0
              ? "No unsaved changes."
              : count === 1
                ? "You have unsaved changes."
                : `You have unsaved changes in ${count} sections.`}
          </p>
          <button
            type="button"
            onClick={saveAll}
            disabled={count === 0}
            className={buttonClass("primary")}
          >
            Save changes
          </button>
        </div>
      </div>
    </InSaveGroup.Provider>
  );
}
