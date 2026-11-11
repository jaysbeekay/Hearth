// The dashboard's getting-started checklist (OnboardingChecklist), kept pure
// so which steps are done, and when the checklist is finished, can be tested.

export type OnboardingStepKey = "members" | "reminders" | "modules";

export interface OnboardingStep {
  key: OnboardingStepKey;
  label: string;
  href: string;
  done: boolean;
}

export function onboardingSteps({
  enabledModuleCount,
  memberCount,
  remindersConfigured,
  modulesReviewed,
}: {
  enabledModuleCount: number;
  memberCount: number;
  remindersConfigured: boolean;
  /** #345 — set once the modules step is followed, so choosing no optional modules still completes it. */
  modulesReviewed: boolean;
}): OnboardingStep[] {
  return [
    { key: "members", label: "Invite a household member", href: "/settings/users", done: memberCount > 1 },
    { key: "reminders", label: "Turn on reminders", href: "/reminders", done: remindersConfigured },
    {
      key: "modules",
      label: "Review optional modules",
      href: "/settings/modules",
      done: enabledModuleCount > 0 || modulesReviewed,
    },
  ];
}

/** #617 — every step done: the checklist shows "You're set up" instead. */
export function onboardingComplete(steps: OnboardingStep[]): boolean {
  return steps.every((step) => step.done);
}
