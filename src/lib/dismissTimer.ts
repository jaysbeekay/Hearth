// #618 (WCAG 2.2.1) — a toast's auto-dismiss timer that pauses while the
// toast is hovered or has keyboard focus, and resumes with the time that was
// left once both end. Kept free of React/DOM so it can be unit tested with
// fake timers.

export type HoldReason = "hover" | "focus";

export interface DismissTimer {
  /** Pause the countdown for this reason (idempotent). */
  hold: (reason: HoldReason) => void;
  /** Drop this reason; the countdown resumes once no reason is left. */
  release: (reason: HoldReason) => void;
  /** Stop for good, e.g. when the toast is dismissed by hand or unmounts. */
  cancel: () => void;
}

export function createDismissTimer(durationMs: number, onExpire: () => void): DismissTimer {
  const holds = new Set<HoldReason>();
  let remaining = durationMs;
  let startedAt = 0;
  let handle: ReturnType<typeof setTimeout> | null = null;
  let done = false;

  const start = () => {
    if (done || handle !== null) return;
    startedAt = Date.now();
    handle = setTimeout(() => {
      handle = null;
      done = true;
      onExpire();
    }, remaining);
  };

  const stop = () => {
    if (handle === null) return;
    clearTimeout(handle);
    handle = null;
    remaining = Math.max(0, remaining - (Date.now() - startedAt));
  };

  start();

  return {
    hold: (reason) => {
      holds.add(reason);
      stop();
    },
    release: (reason) => {
      holds.delete(reason);
      if (holds.size === 0) start();
    },
    cancel: () => {
      done = true;
      if (handle !== null) clearTimeout(handle);
      handle = null;
    },
  };
}
