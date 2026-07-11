"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Circle, Plus, Sparkles, X } from "lucide-react";
import { MODULE_REGISTRY } from "@/lib/modules/registry";

const DISMISS_KEY = "hearth:onboarding-checklist-dismissed";

export function OnboardingChecklist({
  enabledModules,
  memberCount,
  remindersConfigured,
}: {
  enabledModules: string[];
  memberCount: number;
  remindersConfigured: boolean;
}) {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
  }, []);

  if (dismissed) return null;

  const steps = [
    { label: "Invite a household member", href: "/settings/users", done: memberCount > 1 },
    { label: "Set up reminders", href: "/settings/app", done: remindersConfigured },
    { label: "Enable the modules you need", href: "/settings/modules", done: enabledModules.length > 0 },
  ];

  return (
    <section className="relative space-y-4 rounded-xl border border-dashed border-accent/40 bg-accent/5 p-6 text-center md:p-10">
      <button
        type="button"
        aria-label="Dismiss getting-started checklist"
        onClick={() => {
          localStorage.setItem(DISMISS_KEY, "1");
          setDismissed(true);
        }}
        className="absolute right-3 top-3 rounded-md p-1 text-muted hover:bg-black/5 dark:hover:bg-white/5"
      >
        <X size={14} />
      </button>

      <Sparkles className="mx-auto text-accent" size={28} />
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Add your first document</h2>
        <p className="mx-auto max-w-md text-sm text-muted">
          Drop in a PDF and Hearth fills in the details for you — review and save in seconds.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Link
          href="/contracts/new"
          className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
        >
          <Plus size={16} />
          Add a contract
        </Link>
        <Link
          href="/products/new"
          className="flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5"
        >
          <Plus size={16} />
          Add a warranty
        </Link>
        {enabledModules.map((key) => {
          const mod = MODULE_REGISTRY[key as keyof typeof MODULE_REGISTRY];
          if (!mod) return null;
          const Icon = mod.icon;
          return (
            <Link
              key={key}
              href={mod.href}
              className="flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5"
            >
              <Icon size={16} />
              {mod.label}
            </Link>
          );
        })}
      </div>

      <ul className="mx-auto max-w-sm space-y-2 text-left">
        {steps.map((step) => (
          <li key={step.label}>
            <Link
              href={step.href}
              className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm hover:border-accent/50"
            >
              {step.done ? (
                <Check size={16} className="shrink-0 text-success" />
              ) : (
                <Circle size={16} className="shrink-0 text-muted" />
              )}
              <span className={step.done ? "text-muted line-through" : ""}>{step.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
