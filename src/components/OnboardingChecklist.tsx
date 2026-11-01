"use client";

import Link from "next/link";
import { Check, Circle, FileUp, Plus, X } from "lucide-react";
import { MODULE_REGISTRY } from "@/lib/modules/registry";
import { useDismissible } from "@/lib/useDismissible";
import { buttonClass, cardClass } from "@/lib/ui";

const DISMISS_KEY = "hearth:onboarding-checklist-dismissed";
// #345 — set when the "Review optional modules" step is followed, so a
// household that deliberately wants no optional modules can still complete
// the step (it used to require enabling at least one).
const MODULES_REVIEWED_KEY = "hearth:onboarding-modules-reviewed";

const secondaryOnAccentClass = buttonClass("secondary");

export function OnboardingChecklist({
  enabledModules,
  memberCount,
  remindersConfigured,
}: {
  enabledModules: string[];
  memberCount: number;
  remindersConfigured: boolean;
}) {
  const [dismissed, dismiss] = useDismissible(DISMISS_KEY);
  const [modulesReviewed, markModulesReviewed] = useDismissible(MODULES_REVIEWED_KEY);

  if (dismissed) return null;

  const steps = [
    { label: "Invite a household member", href: "/settings/users", done: memberCount > 1 },
    { label: "Set up reminders", href: "/settings/app", done: remindersConfigured },
    {
      label: "Review optional modules",
      href: "/settings/modules",
      done: enabledModules.length > 0 || modulesReviewed,
      onClick: markModulesReviewed,
    },
  ];

  return (
    <section className={cardClass({}, "relative space-y-4 text-center")}>
      <button
        type="button"
        aria-label="Dismiss getting-started checklist"
        onClick={dismiss}
        className={buttonClass("quiet", { icon: true }, "absolute right-2 top-2 text-muted")}
      >
        <X size={16} />
      </button>

      <div className="space-y-1">
        <h2 className="text-base font-medium">Add your first document</h2>
        <p className="mx-auto max-w-md text-sm text-muted">
          Drop in a PDF and Hearth fills in the details for you — review and save in seconds.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Link href="/import" className={buttonClass("primary")}>
          <FileUp size={16} />
          Upload a document
        </Link>
        <Link href="/contracts/new" className={secondaryOnAccentClass}>
          <Plus size={16} />
          Add a record manually
        </Link>
        {enabledModules.map((key) => {
          const mod = MODULE_REGISTRY[key as keyof typeof MODULE_REGISTRY];
          if (!mod) return null;
          const Icon = mod.icon;
          return (
            <Link key={key} href={mod.href} className={secondaryOnAccentClass}>
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
              onClick={"onClick" in step ? step.onClick : undefined}
              className={cardClass({ padding: "none", interactive: true }, "flex min-h-11 items-center gap-2 px-3 py-2 text-sm")}
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
