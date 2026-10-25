"use client";

import { isChipActive, writeListFilters, type ListFilters, type ToggleableFilter } from "@/lib/recordFilters";

// #395 — the list filter chip row shared by Contracts, Warranties and
// Vehicles. A chip marked `onlyWhenActive` isn't offered on that list but
// can arrive in a link, so it shows (pressed) only while it's on, which keeps
// every filter in the URL visible and removable.
export function ListFilterChips({
  filters,
  chips,
  onToggle,
}: {
  filters: ListFilters;
  chips: { chip: ToggleableFilter; label: string; onlyWhenActive?: boolean }[];
  onToggle: (chip: ToggleableFilter) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2 text-sm">
      {chips.map(({ chip, label, onlyWhenActive }) => {
        const active = isChipActive(filters, chip);
        if (onlyWhenActive && !active) return null;
        return (
          <button
            key={chip}
            type="button"
            onClick={() => {
              onToggle(chip);
            }}
            aria-pressed={active}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              active
                ? "border-accent bg-accent/10 text-accent"
                : "border-border bg-surface text-muted hover:bg-hover"
            }`}
          >
            {label}
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
