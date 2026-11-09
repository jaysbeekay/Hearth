"use client";

import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { CheckCircle2, XCircle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonClass } from "@/lib/ui";
import { createDismissTimer, type DismissTimer } from "@/lib/dismissTimer";

const TOAST_EVENT = "hearth:toast";
type ToastVariant = "success" | "error" | "info";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastEventDetail {
  message: string;
  variant?: ToastVariant;
  action?: ToastAction;
}

interface Toast extends ToastEventDetail {
  id: number;
}

let nextId = 0;

// #371 — an optional action (e.g. Undo after a delete) keeps the toast up
// for longer, so there's time to reach it.
const DURATION_MS = 4000;
const DURATION_WITH_ACTION_MS = 8000;

export function showToast(
  message: string,
  variant: ToastVariant = "success",
  options: { action?: ToastAction } = {},
) {
  window.dispatchEvent(
    new CustomEvent<ToastEventDetail>(TOAST_EVENT, { detail: { message, variant, action: options.action } }),
  );
}

const ICONS: Record<ToastVariant, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
};

const TONE_CLASSES: Record<ToastVariant, string> = {
  success: "border-success/30 text-success",
  error: "border-danger/30 text-danger",
  info: "border-border text-foreground",
};

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id));

  useEffect(() => {
    const onToast = (e: Event) => {
      const detail = (e as CustomEvent<ToastEventDetail>).detail;
      const id = nextId++;
      setToasts((prev) => [...prev, { id, ...detail }]);
    };
    window.addEventListener(TOAST_EVENT, onToast);
    return () => window.removeEventListener(TOAST_EVENT, onToast);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="toast-stack fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6 md:items-end md:pr-6"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
      ))}
    </div>
  );
}

// #618 (WCAG 2.2.1) — the auto-dismiss countdown pauses while the pointer is
// over the toast or focus is inside it, and resumes with the time left.
function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const timerRef = useRef<DismissTimer | null>(null);
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  const duration = toast.action ? DURATION_WITH_ACTION_MS : DURATION_MS;
  useEffect(() => {
    const timer = createDismissTimer(duration, () => {
      onDismissRef.current();
    });
    timerRef.current = timer;
    return () => {
      timer.cancel();
      timerRef.current = null;
    };
  }, [duration]);

  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    // Focus moving between the toast's own buttons isn't leaving it.
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
    timerRef.current?.release("focus");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onDismiss();
    }
  };

  const Icon = ICONS[toast.variant ?? "success"];
  return (
    <div
      onPointerEnter={() => {
        timerRef.current?.hold("hover");
      }}
      onPointerLeave={() => {
        timerRef.current?.release("hover");
      }}
      onFocus={() => {
        timerRef.current?.hold("focus");
      }}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      className={cn(
        "flex w-full max-w-sm items-center gap-2 rounded-lg border bg-surface px-4 py-3 text-sm shadow-overlay",
        TONE_CLASSES[toast.variant ?? "success"],
      )}
    >
      <Icon size={16} className="shrink-0" />
      <span className="flex-1 text-foreground">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            onDismiss();
            toast.action!.onClick();
          }}
          className={buttonClass("quiet", {}, "text-accent")}
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="-mr-1 shrink-0 rounded-lg p-1 text-muted hover:text-foreground"
      >
        <X size={16} />
      </button>
    </div>
  );
}
