"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
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
import { Field } from "@/components/FormField";
import { SelectWrapper, inputClass, selectClass } from "@/components/SelectWrapper";
import { OCCUPANCY_STATUSES } from "@/lib/validation/home";
import { OCCUPANCY_STATUS_LABELS } from "@/lib/utils";

interface GeocodeSuggestion {
  display_name: string;
  lat: number;
  lng: number;
  street: string;
  suburb: string;
  state: string;
  postcode: string;
  country: string;
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

  const labelRef = useRef<HTMLInputElement>(null);
  const [occupancyStatus, setOccupancyStatus] = useState(
    effectiveValues?.occupancyStatus ?? property?.occupancyStatus ?? "OWNER_OCCUPIED",
  );

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
        <Field label="Label" htmlFor="label" required>
          <input
            id="label"
            name="label"
            ref={labelRef}
            required
            defaultValue={effectiveValues?.label ?? property?.label}
            placeholder="e.g. Main residence"
            className={inputClass}
          />
        </Field>

        <Field label="Occupancy status" htmlFor="occupancyStatus">
          <SelectWrapper>
            <select
              id="occupancyStatus"
              name="occupancyStatus"
              value={occupancyStatus}
              onChange={(e) => setOccupancyStatus(e.target.value)}
              className={selectClass}
            >
              {OCCUPANCY_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {OCCUPANCY_STATUS_LABELS[value]}
                </option>
              ))}
            </select>
          </SelectWrapper>
        </Field>
      </div>

      {occupancyStatus === "RENTED" && (
        <p className="rounded-lg border border-dashed border-border bg-black/5 px-4 py-2 text-sm text-foreground/70 dark:bg-white/5">
          {property ? (
            property.isRented ? (
              <>
                Rental tracking is already set up for this property —{" "}
                <Link href={`/home/${property.id}/rental`} className="text-accent hover:underline">
                  view it
                </Link>
                .
              </>
            ) : (
              <>
                Rental tracking (agreements, statements, rent reconciliation) isn&apos;t set up yet
                for this property —{" "}
                <Link href={`/home/${property.id}/rental`} className="text-accent hover:underline">
                  set it up
                </Link>
                .
              </>
            )
          ) : (
            "You'll be able to set up rental tracking (agreements, statements) once this property is saved."
          )}
        </p>
      )}

      <AddressFields
        labelRef={labelRef}
        initialStreet={effectiveValues?.street ?? property?.street ?? ""}
        initialSuburb={effectiveValues?.suburb ?? property?.suburb ?? ""}
        initialState={effectiveValues?.state ?? property?.state ?? ""}
        initialPostcode={effectiveValues?.postcode ?? property?.postcode ?? ""}
        initialCountry={effectiveValues?.country ?? property?.country ?? ""}
        initialLat={
          effectiveValues?.lat != null ? Number(effectiveValues.lat) : (property?.lat ?? null)
        }
        initialLng={
          effectiveValues?.lng != null ? Number(effectiveValues.lng) : (property?.lng ?? null)
        }
      />

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
function AddressFields({
  labelRef,
  initialStreet,
  initialSuburb,
  initialState,
  initialPostcode,
  initialCountry,
  initialLat,
  initialLng,
}: {
  labelRef: React.RefObject<HTMLInputElement | null>;
  initialStreet: string;
  initialSuburb: string;
  initialState: string;
  initialPostcode: string;
  initialCountry: string;
  initialLat: number | null;
  initialLng: number | null;
}) {
  const [street, setStreet] = useState(initialStreet);
  const [suburb, setSuburb] = useState(initialSuburb);
  const [state, setState] = useState(initialState);
  const [postcode, setPostcode] = useState(initialPostcode);
  const [country, setCountry] = useState(initialCountry);
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

    if (street.trim().length < 3) {
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(street)}`);
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
  }, [street]);

  function selectSuggestion(s: GeocodeSuggestion) {
    skipNextLookup.current = true;
    setStreet(s.street || s.display_name);
    setSuburb(s.suburb);
    setState(s.state);
    setPostcode(s.postcode);
    setCountry(s.country);
    setLat(s.lat);
    setLng(s.lng);
    setSuggestions([]);
    setShowSuggestions(false);

    if (labelRef.current && !labelRef.current.value && s.suburb) {
      labelRef.current.value = s.suburb;
    }
  }

  function handleStreetChange(value: string) {
    setStreet(value);
    setLat(null);
    setLng(null);
  }

  const visibleSuggestions = street.trim().length >= 3 ? suggestions : [];

  return (
    <div className="space-y-4">
      <Field label="Street" htmlFor="street">
        <div className="relative">
          <input
            id="street"
            name="street"
            value={street}
            onChange={(e) => handleStreetChange(e.target.value)}
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
      </Field>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Suburb" htmlFor="suburb">
          <input
            id="suburb"
            name="suburb"
            value={suburb}
            onChange={(e) => setSuburb(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="State" htmlFor="state">
          <input
            id="state"
            name="state"
            value={state}
            onChange={(e) => setState(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Postcode" htmlFor="postcode">
          <input
            id="postcode"
            name="postcode"
            value={postcode}
            onChange={(e) => setPostcode(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Country" htmlFor="country">
          <input
            id="country"
            name="country"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>
    </div>
  );
}
