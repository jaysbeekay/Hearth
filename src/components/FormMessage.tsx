"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { showToast } from "@/components/Toast";
import { bannerClass } from "@/lib/ui";

/**
 * The control named `field` in `form`, or null. A radio group gives its first
 * input; a hidden input (a widget that posts its value that way) gives the
 * first visible control in the same Field, which is what the user fixes.
 */
export function fieldControl(form: HTMLFormElement | null, field: string): HTMLElement | null {
  const item = form?.elements.namedItem(field);
  if (!item) return null;
  const first = item instanceof RadioNodeList ? item[0] : item;
  if (!(first instanceof HTMLElement)) return null;
  if (first instanceof HTMLInputElement && first.type === "hidden") {
    return (
      first.closest("[data-field]")?.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea") ?? first
    );
  }
  return first;
}

/**
 * Where an error for `field` goes: the empty slot of the Field that holds
 * the control, or null when the form has no such control or the control
 * isn't inside a Field (the error then stays in the banner).
 */
export function fieldErrorSlot(form: HTMLFormElement | null, field: string): HTMLElement | null {
  return fieldControl(form, field)?.closest("[data-field]")?.querySelector<HTMLElement>(":scope > [data-field-error]") ?? null;
}

/**
 * Whether a message should be announced (toast or scroll) again: it's a
 * different message, or the same one from a new submission. `attempt` is the
 * action's returned state, a new object per submission, so failing twice
 * with the same error still brings the second failure into view. A caller
 * that omits it gets each distinct message once: pass a fresh `attempt`
 * wherever a repeated identical error must show again.
 */
export function isNewMessage(
  message: string,
  attempt: unknown,
  last: { message: string | null; attempt: unknown },
): boolean {
  return message !== last.message || (attempt !== undefined && attempt !== last.attempt);
}

export function FormMessage({
  error,
  success,
  field,
  attempt,
}: {
  error?: string | null;
  success?: string | null;
  /**
   * #406 — the form control `error` is about (the action state's `field`).
   * When it sits in a Field, the error is shown under it instead of in the
   * banner, and the control is marked invalid.
   */
  field?: string;
  /** The action state the message came from; a new object per submission. */
  attempt?: unknown;
}) {
  const last = useRef<{ message: string | null; attempt: unknown }>({ message: null, attempt: undefined });
  const errorRef = useRef<HTMLParagraphElement>(null);
  const errorId = useId();
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  // A new key per submission, so a repeated error is a new alert node and
  // screen readers announce it again (an unchanged role="alert" isn't re-read).
  // Adjusted during render from the previous attempt, as React recommends,
  // rather than kept in module state.
  const [seenAttempt, setSeenAttempt] = useState(attempt);
  const [alertKey, setAlertKey] = useState(0);
  if (attempt !== seenAttempt) {
    setSeenAttempt(attempt);
    setAlertKey((key) => key + 1);
  }

  // Find the field's slot before paint, so the error never flashes in the
  // banner first, and mark the control invalid while the error stands. The
  // error node (the banner, or a slot already in use) is inside the form,
  // so it's how the form is found. It runs again on each submission, in
  // case the form re-rendered its fields.
  useLayoutEffect(() => {
    const form = errorRef.current?.closest("form") ?? null;
    const target = error && field ? fieldErrorSlot(form, field) : null;
    // Syncing with the DOM the form rendered, which only exists after render.
    setSlot(target);
    const control = target && field ? fieldControl(form, field) : null;
    if (!control) return;
    const describedBy = control.getAttribute("aria-describedby");
    control.setAttribute("aria-invalid", "true");
    control.setAttribute("aria-describedby", describedBy ? `${describedBy} ${errorId}` : errorId);
    return () => {
      control.removeAttribute("aria-invalid");
      if (describedBy) control.setAttribute("aria-describedby", describedBy);
      else control.removeAttribute("aria-describedby");
    };
  }, [error, field, errorId, attempt]);

  useEffect(() => {
    if (success && isNewMessage(success, attempt, last.current)) {
      showToast(success);
      last.current = { message: success, attempt };
    } else if (error && isNewMessage(error, attempt, last.current)) {
      // #406 — an error is shown once, under its field or in this banner,
      // never also as a toast. Either may be off screen, so bring it into view.
      // Wait a frame: the layout effect above may still move the error from
      // the banner into the field's slot, and the scroll has to find it there.
      requestAnimationFrame(() => {
        const node = errorRef.current;
        node?.scrollIntoView({ block: "center" });
        if (field && node?.parentElement?.hasAttribute("data-field-error")) {
          fieldControl(node.closest("form"), field)?.focus({ preventScroll: true });
        }
      });
      last.current = { message: error, attempt };
    }
  }, [success, error, attempt, field]);

  if (!error && !success) return null;

  if (error && slot) {
    return createPortal(
      <p key={alertKey} id={errorId} ref={errorRef} role="alert" className="text-xs text-danger">
        {error}
      </p>,
      slot,
    );
  }

  if (error) {
    return (
      <p key={alertKey} ref={errorRef} role="alert" className={bannerClass("danger")}>
        {error}
      </p>
    );
  }

  return <p className={bannerClass("success")}>{success}</p>;
}
