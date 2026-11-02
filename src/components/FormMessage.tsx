"use client";

import { useEffect, useRef } from "react";
import { showToast } from "@/components/Toast";
import { bannerClass } from "@/lib/ui";

/**
 * Whether a message should be announced (toast or scroll) again: it's a
 * different message, or the same one from a new submission. `attempt` is the
 * action's returned state, a new object per submission, so failing twice
 * with the same error still brings the second failure into view.
 */
export function isNewMessage(
  message: string,
  attempt: unknown,
  last: { message: string | null; attempt: unknown },
): boolean {
  return message !== last.message || (attempt !== undefined && attempt !== last.attempt);
}

// A stable key per submission, so a repeated error is a new alert node and
// screen readers announce it again (an unchanged role="alert" isn't re-read).
const attemptIds = new WeakMap<object, number>();
let nextAttemptId = 0;
function attemptKey(attempt: unknown): string {
  if (typeof attempt !== "object" || attempt === null) return "0";
  let id = attemptIds.get(attempt);
  if (id === undefined) {
    id = ++nextAttemptId;
    attemptIds.set(attempt, id);
  }
  return String(id);
}

export function FormMessage({
  error,
  success,
  attempt,
}: {
  error?: string | null;
  success?: string | null;
  /** The action state the message came from; a new object per submission. */
  attempt?: unknown;
}) {
  const last = useRef<{ message: string | null; attempt: unknown }>({ message: null, attempt: undefined });
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (success && isNewMessage(success, attempt, last.current)) {
      showToast(success);
      last.current = { message: success, attempt };
    } else if (error && isNewMessage(error, attempt, last.current)) {
      // #406 — an error is shown once, in this banner, not also as a toast.
      // The banner sits at the foot of the form, so bring it into view.
      errorRef.current?.scrollIntoView?.({ block: "center" });
      last.current = { message: error, attempt };
    }
  }, [success, error, attempt]);

  if (!error && !success) return null;

  if (error) {
    return (
      <p key={attemptKey(attempt)} ref={errorRef} role="alert" className={bannerClass("danger")}>
        {error}
      </p>
    );
  }

  return <p className={bannerClass("success")}>{success}</p>;
}
