"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { PropertyModel } from "@/generated/prisma/models";
import type { ActionState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";
import { FormMessage } from "@/components/FormMessage";

interface GeocodeSuggestion {
  display_name: string;
  lat: number;
  lng: number;
}

export function PropertyForm({
  action,
  property,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  property?: PropertyModel;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, null);

  const [address, setAddress] = useState(state?.values?.address ?? property?.address ?? "");
  const [lat, setLat] = useState<number | null>(property?.lat ?? null);
  const [lng, setLng] = useState<number | null>(property?.lng ?? null);
  const [suggestions, setSuggestions] = useState<GeocodeSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextLookup = useRef(false);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (skipNextLookup.current) {
      skipNextLookup.current = false;
      return;
    }

    if (address.trim().length < 3) {
      setSuggestions([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(address)}`);
        if (!res.ok) return;
        const results = (await res.json()) as GeocodeSuggestion[];
        setSuggestions(results);
        setShowSuggestions(true);
      } catch {
        // Silently ignore lookup failures — address stays free-text.
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [address]);

  function selectSuggestion(s: GeocodeSuggestion) {
    skipNextLookup.current = true;
    setAddress(s.display_name);
    setLat(s.lat);
    setLng(s.lng);
    setSuggestions([]);
    setShowSuggestions(false);
  }

  function handleAddressChange(value: string) {
    setAddress(value);
    setLat(null);
    setLng(null);
  }

  return (
    <form action={formAction} className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Label" htmlFor="label">
          <input
            id="label"
            name="label"
            required
            defaultValue={state?.values?.label ?? property?.label}
            placeholder="e.g. Main residence"
            className={inputClass}
          />
        </Field>

        <Field label="Address" htmlFor="address">
          <div className="relative">
            <input
              id="address"
              name="address"
              value={address}
              onChange={(e) => handleAddressChange(e.target.value)}
              onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              placeholder="e.g. 35C Clarence Street"
              autoComplete="off"
              className={inputClass}
            />
            <input type="hidden" name="lat" value={lat ?? ""} />
            <input type="hidden" name="lng" value={lng ?? ""} />
            {showSuggestions && suggestions.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface shadow-md">
                {suggestions.map((s) => (
                  <li key={`${s.lat},${s.lng}`}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => selectSuggestion(s)}
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/5"
                    >
                      {s.display_name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Field>
      </div>

      <Field label="Notes" htmlFor="notes">
        <textarea
          id="notes"
          name="notes"
          rows={4}
          defaultValue={state?.values?.notes ?? property?.notes ?? ""}
          className={inputClass}
        />
      </Field>

      <FormMessage error={state?.error} success={state?.success} />

      <div className="flex justify-end gap-3">
        <SubmitButton>{property ? "Save changes" : "Add property"}</SubmitButton>
      </div>
    </form>
  );
}

const inputClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent";

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}
