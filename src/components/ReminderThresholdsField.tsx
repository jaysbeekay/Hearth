"use client";

import { useId, useState } from "react";
import { chipClass, inputClass } from "@/lib/ui";
import { parseThresholds } from "@/lib/notifications/thresholds";

type Preset = "default" | "week" | "day" | "custom";

// What each preset stores. "default" stores nothing of the record's own, so
// the household default applies (and follows it if an admin changes it).
const PRESET_VALUES = new Map<Exclude<Preset, "custom">, string>([
  ["default", ""],
  ["week", "7"],
  ["day", "1"],
]);

/** The preset a stored value reads as; anything else stays Custom, verbatim. */
export function presetFor(stored: string | null | undefined): Preset {
  const value = stored?.trim() ?? "";
  if (value === "") return "default";
  if (value === "7") return "week";
  if (value === "1") return "day";
  return "custom";
}

/** "30, 14, 7 and 1 days" / "1 day" — the thresholds a value resolves to, in words. */
export function describeThresholds(days: number[]): string {
  if (days.length === 0) return "no days";
  const sorted = [...days].sort((a, b) => b - a);
  const list =
    sorted.length === 1 ? `${sorted[0]}` : `${sorted.slice(0, -1).join(", ")} and ${sorted[sorted.length - 1]}`;
  return `${list} ${sorted.length === 1 && sorted[0] === 1 ? "day" : "days"}`;
}

/** The hint under the presets: the effective thresholds and the due-soon window they set. */
export function thresholdsHint(value: string, householdDefault: string, before: string): string {
  const days = parseThresholds(value, householdDefault).filter(Number.isInteger);
  if (days.length === 0) return "No Reminders will be sent.";
  const windowDays = Math.max(...days);
  return `Reminders ${describeThresholds(days)} before ${before} · shows in Needs attention from ${windowDays} ${
    windowDays === 1 ? "day" : "days"
  } out.`;
}

/**
 * #360 — Reminder thresholds as presets instead of a free-text field whose
 * default was only a placeholder. "Custom…" reveals the comma-separated
 * field; the hint always says what will actually happen. Submits
 * `reminderDaysBefore` exactly as the old text input did, so stored values
 * round-trip unchanged.
 */
export function ReminderThresholdsField({
  defaultValue,
  householdDefault,
  before = "the date",
}: {
  defaultValue: string | null | undefined;
  /** The household's default thresholds, which apply when a record has none of its own. */
  householdDefault: string;
  /** What the Reminders come before, for the hint ("the end date", "the lease end"). */
  before?: string;
}) {
  const id = useId();
  const [preset, setPreset] = useState<Preset>(() => presetFor(defaultValue));
  const [custom, setCustom] = useState(() => (presetFor(defaultValue) === "custom" ? (defaultValue ?? "") : ""));
  const value = preset === "custom" ? custom : (PRESET_VALUES.get(preset) ?? "");
  const defaultLabel = `Default · ${parseThresholds(householdDefault).sort((a, b) => b - a).join("/")}`;

  const options: { preset: Preset; label: string }[] = [
    { preset: "default", label: defaultLabel },
    { preset: "week", label: "1 week before" },
    { preset: "day", label: "1 day before" },
    { preset: "custom", label: "Custom…" },
  ];

  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-sm font-medium">Reminders</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const checked = preset === option.preset;
          return (
            <label key={option.preset} className={chipClass(checked, "cursor-pointer has-[:focus-visible]:ring-2")}>
              <input
                type="radio"
                name={`${id}-preset`}
                value={option.preset}
                checked={checked}
                onChange={() => setPreset(option.preset)}
                className="sr-only"
              />
              {option.label}
            </label>
          );
        })}
      </div>
      {preset === "custom" ? (
        <div>
          <label htmlFor="reminderDaysBefore" className="sr-only">
            Reminder thresholds (days before, comma-separated)
          </label>
          <input
            id="reminderDaysBefore"
            name="reminderDaysBefore"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="e.g. 60,30,7"
            inputMode="numeric"
            aria-describedby={`${id}-hint`}
            className={inputClass}
          />
        </div>
      ) : (
        <input type="hidden" id="reminderDaysBefore" name="reminderDaysBefore" value={value} />
      )}
      <p id={`${id}-hint`} className="text-xs text-muted">
        {thresholdsHint(value, householdDefault, before)}
        {preset === "custom" && " Days before, comma-separated."}
      </p>
    </fieldset>
  );
}
