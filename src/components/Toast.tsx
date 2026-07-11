"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

const TOAST_EVENT = "hearth:toast";
type ToastVariant = "success" | "error" | "info";

interface ToastEventDetail {
  message: string;
  variant?: ToastVariant;
}

interface Toast extends ToastEventDetail {
  id: number;
}

let nextId = 0;

export function showToast(message: string, variant: ToastVariant = "success") {
  window.dispatchEvent(new CustomEvent<ToastEventDetail>(TOAST_EVENT, { detail: { message, variant } }));
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

  useEffect(() => {
    const onToast = (e: Event) => {
      const detail = (e as CustomEvent<ToastEventDetail>).detail;
      const id = nextId++;
      setToasts((prev) => [...prev, { id, ...detail }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4000);
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
            <span className="text-foreground">{toast.message}</span>
          </div>
        );
      })}
    </div>
  );
}
