"use client";

import { useLayoutEffect } from "react";
import { addDescribedBy, dropDescribedBy } from "@/lib/describedBy";

/**
 * #615 — a Field's hint, linked to its control so a screen reader reads it
 * with the field. Field takes any children (a bare input, a wrapper, a
 * custom widget), so the link is added to the control with the hint's id
 * after render, appended to whatever aria-describedby it already has. A
 * control that rewrites its own aria-describedby on re-render (DateInput's
 * date echo) is watched, and the hint id put back.
 */
export function FieldHint({ id, controlId, children }: { id: string; controlId: string; children: React.ReactNode }) {
  useLayoutEffect(() => {
    const control = document.getElementById(controlId);
    if (!control) return;
    const link = () => {
      const value = control.getAttribute("aria-describedby");
      const next = addDescribedBy(value, id);
      if (next !== value) control.setAttribute("aria-describedby", next);
    };
    link();
    const observer = new MutationObserver(link);
    observer.observe(control, { attributes: true, attributeFilter: ["aria-describedby"] });
    return () => {
      observer.disconnect();
      dropDescribedBy(control, id);
    };
  }, [id, controlId]);

  return (
    <p id={id} className="text-xs text-muted">
      {children}
    </p>
  );
}
