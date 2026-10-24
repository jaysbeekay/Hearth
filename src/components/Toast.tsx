"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

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
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, detail.action ? DURATION_WITH_ACTION_MS : DURATION_MS);
    };
    window.addEventListener(TOAST_EVENT, onToast);
    return () => window.removeEventListener(TOAST_EVENT, onToast);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6 md:items-end md:pr-6"
    >
      {toasts.map((toast) => {
        const Icon = ICONS[toast.variant ?? "success"];
        return (
          <div
            key={toast.id}
            className={cn(
              "flex w-full max-w-sm items-center gap-2 rounded-lg border bg-surface px-4 py-3 text-sm shadow-stripe",
              TONE_CLASSES[toast.variant ?? "success"],
            )}
          >
            <Icon size={16} className="shrink-0" />
            <span className="flex-1 text-foreground">{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                onClick={() => {
                  dismiss(toast.id);
                  toast.action!.onClick();
                }}
                className="shrink-0 rounded-md px-2 py-1 font-medium text-accent hover:bg-accent/10"
              >
                {toast.action.label}
              </button>
            )}
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss"
              className="-mr-1 shrink-0 rounded-md p-1 text-muted hover:text-foreground"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
