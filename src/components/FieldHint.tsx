"use client";

import { useLayoutEffect, useRef } from "react";
import { addDescribedBy, dropDescribedBy } from "@/lib/describedBy";

/**
 * The control with id `controlId`, looked for first inside the Field that
 * holds the hint (so a repeated id elsewhere on the page can't be picked up
 * instead), then in the whole document.
 */
function findControl(field: Element | null, controlId: string): HTMLElement | null {
  const scoped = field
    ? Array.from(field.querySelectorAll<HTMLElement>("[id]")).find((el) => el.id === controlId)
    : undefined;
  return scoped ?? document.getElementById(controlId);
}

/**
 * #615 — a Field's hint, linked to its control so a screen reader reads it
 * with the field. Field takes any children (a bare input, a wrapper, a
 * custom widget), so the hint's id is added to the control's
 * aria-describedby after render, after whatever ids it already has.
 *
 * The Field is watched, and the link checked again on each change, for two
 * cases:
 * - React replaces the control (a keyed select remounted on a new value):
 *   the new node gets the hint id and the old node loses it.
 * - React rewrites the attribute: when a control's own aria-describedby
 *   prop changes, React sets the whole attribute to the new value (DateInput
 *   switches it to its date echo's id once a full date is typed), which
 *   drops ids added outside React. The hint id is put back. An error or
 *   auto-fill id dropped that way is not — a known gap.
 */
export function FieldHint({ id, controlId, children }: { id: string; controlId: string; children: React.ReactNode }) {
  const hintRef = useRef<HTMLParagraphElement>(null);

  useLayoutEffect(() => {
    const field = hintRef.current?.closest("[data-field]") ?? null;
    let control: HTMLElement | null = null;

    const link = () => {
      const current = findControl(field, controlId);
      if (current !== control) {
        if (control) dropDescribedBy(control, id);
        control = current;
      }
      if (!control) return;
      const value = control.getAttribute("aria-describedby");
      const next = addDescribedBy(value, id);
      if (next !== value) control.setAttribute("aria-describedby", next);
    };
    link();

    const observer = new MutationObserver(link);
    // Without a Field around the hint, only the control itself can be watched.
    const target = field ?? control;
    if (target) {
      observer.observe(target, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["aria-describedby", "id"],
      });
    }
    return () => {
      observer.disconnect();
      if (control) dropDescribedBy(control, id);
    };
  }, [id, controlId]);

  return (
    <p ref={hintRef} id={id} className="text-xs text-muted">
      {children}
    </p>
  );
}
