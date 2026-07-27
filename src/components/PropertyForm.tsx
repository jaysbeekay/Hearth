"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { PropertyModel } from "@/generated/prisma/models";
import type { ActionState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";
import { FormMessage } from "@/components/FormMessage";
import {
  makeOfflineAwareAction,
  getOperationById,
  updateOperationFormValues,
  serializeFormData,
  type QueuedOperation,
} from "@/lib/offlineQueue";

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
  const offlineAwareAction = makeOfflineAwareAction(
    action,
    () => ({
      label: property ? `Update property: ${property.label}` : "Add property",
      entity: "property",
      operation: property ? "update" : "create",
      entityId: property?.id,
      baseUpdatedAt: property?.updatedAt?.toISOString(),
    }),
    { success: "Saved offline — will sync when you reconnect." },
  );

  const [state, formAction] = useActionState<ActionState, FormData>(offlineAwareAction, null);

  const router = useRouter();
  const pendingOpId = useSearchParams().get("pendingOpId");
  const [pendingOp, setPendingOp] = useState<QueuedOperation | null | undefined>(
    pendingOpId ? undefined : null,
  );
  useEffect(() => {
    if (!pendingOpId) return;
    getOperationById(pendingOpId).then((op) => setPendingOp(op ?? null));
  }, [pendingOpId]);
  const effectiveValues = state?.values ?? pendingOp?.formValues;

  async function handlePendingSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!pendingOp) return;
    const { values } = serializeFormData(new FormData(e.currentTarget));
    await updateOperationFormValues(pendingOp.id, values);
    router.push("/home");
  }

  if (pendingOp === undefined) {
    return <p className="text-sm text-muted">Loading…</p>;
  }

  return (
    <form
      {...(pendingOp ? { onSubmit: handlePendingSubmit } : { action: formAction })}
      className="space-y-6"
    >
      {pendingOp && (
        <p className="rounded-lg border border-dashed border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-700 dark:text-amber-400">
          Editing an offline entry that hasn&apos;t synced yet — saving updates it in place.
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Label" htmlFor="label">
          <input
            id="label"
            name="label"
            required
            defaultValue={effectiveValues?.label ?? property?.label}
            placeholder="e.g. Main residence"
            className={inputClass}
          />
        </Field>

        <Field label="Address" htmlFor="address">
          <AddressField
            initialAddress={effectiveValues?.address ?? property?.address ?? ""}
            initialLat={
              effectiveValues?.lat != null ? Number(effectiveValues.lat) : (property?.lat ?? null)
            }
            initialLng={
              effectiveValues?.lng != null ? Number(effectiveValues.lng) : (property?.lng ?? null)
            }
          />
        </Field>
      </div>

      <Field label="Notes" htmlFor="notes">
        <textarea
          id="notes"
          name="notes"
          rows={4}
          defaultValue={effectiveValues?.notes ?? property?.notes ?? ""}
          className={inputClass}
        />
      </Field>

      <FormMessage error={state?.error} success={state?.success} />

      <div className="flex justify-end gap-3">
        <SubmitButton>{pendingOp || property ? "Save changes" : "Add property"}</SubmitButton>
      </div>
    </form>
  );
}

// Split out so its address/lat/lng state initializes fresh from whatever the
// parent already resolved (contract, in-progress edit, or a queued offline
// op) — this component only mounts once that's known, so plain useState
// initializers are correct without an extra effect to re-sync them later.
function AddressField({
  initialAddress,
  initialLat,
  initialLng,
}: {
  initialAddress: string;
  initialLat: number | null;
  initialLng: number | null;
}) {
  const [address, setAddress] = useState(initialAddress);
  const [lat, setLat] = useState<number | null>(initialLat);
  const [lng, setLng] = useState<number | null>(initialLng);
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

  const visibleSuggestions = address.trim().length >= 3 ? suggestions : [];

  return (
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
      {showSuggestions && visibleSuggestions.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface shadow-md">
          {visibleSuggestions.map((s) => (
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
