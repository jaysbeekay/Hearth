"use client";

import { useActionState } from "react";
import { updateUserPreferences, type ActionState } from "@/lib/actions/auth";
import { DATE_FORMAT_OPTIONS, DATE_FORMAT_LABELS, REGION_OPTIONS, REGION_LABELS } from "@/lib/utils";
import { TIMEZONE_OPTIONS } from "@/lib/timezones";
import { CurrencySelect } from "@/components/CurrencySelect";
import { SelectWrapper, selectClass } from "@/components/SelectWrapper";
import { FormMessage } from "@/components/FormMessage";
import { compactButtonClass } from "@/lib/buttonStyles";

export function PreferencesForm({
  dateFormat,
  preferredCurrency,
  timezone,
  region,
}: {
  dateFormat: string;
  preferredCurrency: string;
  timezone: string;
  region: string;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(updateUserPreferences, null);

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-4">
      <div className="space-y-1">
        <label htmlFor="dateFormat" className="text-sm font-medium">
          Date format
        </label>
        <SelectWrapper>
          <select id="dateFormat" name="dateFormat" defaultValue={dateFormat} className={selectClass}>
            {DATE_FORMAT_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {DATE_FORMAT_LABELS[value]}
              </option>
            ))}
          </select>
        </SelectWrapper>
      </div>
      <div className="space-y-1">
        <label htmlFor="preferredCurrency" className="text-sm font-medium">
          Default currency
        </label>
        <CurrencySelect id="preferredCurrency" name="preferredCurrency" defaultValue={preferredCurrency} />
      </div>
      <div className="space-y-1">
        <label htmlFor="timezone" className="text-sm font-medium">
          Timezone
        </label>
        <SelectWrapper>
          <select id="timezone" name="timezone" defaultValue={timezone} className={selectClass}>
            {TIMEZONE_OPTIONS.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </SelectWrapper>
      </div>
      <div className="space-y-1">
        <label htmlFor="region" className="text-sm font-medium">
          Region
        </label>
        <SelectWrapper>
          <select id="region" name="region" defaultValue={region} className={selectClass}>
            {REGION_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {REGION_LABELS[value]}
              </option>
            ))}
          </select>
        </SelectWrapper>
      </div>
      <div className="sm:col-span-4 space-y-2">
        <FormMessage error={state?.error} success={state?.success} />
        <button type="submit" className={compactButtonClass()}>
          Save preferences
        </button>
      </div>
    </form>
  );
}
