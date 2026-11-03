import Link from "next/link";
import { SETTINGS_TABS, type SettingsTabKey } from "@/lib/routeLabels";
import { cn } from "@/lib/utils";

// #363 — the two Settings tabs: My account (only your own account) and
// Household (shared by everyone; admin-only sections greyed for members).
export function SettingsTabs({ active }: { active: SettingsTabKey }) {
  return (
    <nav aria-label="Settings" className="flex gap-1 border-b border-border">
      {SETTINGS_TABS.map((tab) => {
        const current = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={current ? "page" : undefined}
            className={cn(
              "-mb-px flex min-h-11 items-center border-b-2 px-3 text-sm font-medium transition-colors",
              current ? "border-accent text-accent" : "border-transparent text-muted hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
