"use client";

import {
  isChipActive,
  writeListFilters,
  type ListFilterCounts,
  type ListFilters,
  type ToggleableFilter,
} from "@/lib/recordFilters";
import { chipClass } from "@/lib/ui";
import { cn } from "@/lib/utils";

// #395 — the list filter chip row shared by Contracts, Warranties and
// Vehicles. A chip marked `onlyWhenActive` isn't offered on that list but
// can arrive in a link, so it shows (pressed) only while it's on, which keeps
// every filter in the URL visible and removable.
//
// #365 — with `counts`, each chip carries its household-wide count
// ("Due soon · 1"), replacing the separate summary strip, and a chip with
// nothing to show is muted (still pressable, so it can be turned off).
export function ListFilterChips({
  filters,
  chips,
  counts,
  onToggle,
  className,
}: {
  filters: ListFilters;
  chips: { chip: ToggleableFilter; label: string; onlyWhenActive?: boolean }[];
  counts?: ListFilterCounts;
  onToggle: (chip: ToggleableFilter) => void;
  className?: string;
}) {
  const countByChip = new Map<string, number | undefined>(Object.entries(counts ?? {}));
  return (
    <div className={cn("flex flex-wrap gap-2 text-sm", className)}>
      {chips.map(({ chip, label, onlyWhenActive }) => {
        const active = isChipActive(filters, chip);
        if (onlyWhenActive && !active) return null;
        const count = counts ? countByChip.get(chip) : undefined;
        return (
          <button
            key={chip}
            type="button"
            onClick={() => {
              onToggle(chip);
            }}
            aria-pressed={active}
            className={chipClass(active, count === 0 && !active ? "opacity-60" : undefined)}
          >
            {count === undefined ? label : `${label} · ${count}`}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Hidden inputs that carry the active filter chips through a list's
 * `<form method="GET">`, so submitting a search keeps them.
 */
export function ListFilterHiddenInputs({ filters }: { filters: ListFilters }) {
  return (
    <>
      {[...writeListFilters(new URLSearchParams(), filters).entries()].map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
    </>
  );
}
