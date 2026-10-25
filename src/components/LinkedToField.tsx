"use client";

import { useState } from "react";
import Link from "next/link";
import { SelectWrapper } from "@/components/SelectWrapper";

export type LinkOption = { id: string; label: string };
export type LinkValue = { propertyId: string; vehicleId: string };

const BOTH = "both";

function encode({ propertyId, vehicleId }: LinkValue): string {
  if (propertyId && vehicleId) return BOTH;
  if (propertyId) return `property:${propertyId}`;
  if (vehicleId) return `vehicle:${vehicleId}`;
  return "";
}

function decode(value: string, initial: LinkValue): LinkValue {
  if (value === BOTH) return initial;
  const [kind, id] = value.split(":");
  return {
    propertyId: kind === "property" ? id : "",
    vehicleId: kind === "vehicle" ? id : "",
  };
}

// The one "what is this for?" control (#370) shared by the contract form,
// warranty form, Upload and the Inbox: a single select grouped by Homes /
// Vehicles. A module that's on but has nothing in it gets an "add one" hint;
// with neither module on, the field isn't rendered at all.
//
// In a plain <form> it posts `propertyId`/`vehicleId` hidden inputs (pass
// `withHiddenInputs`); in the client-side review lists it reports changes
// through `onChange` instead.
export function LinkedToField({
  id,
  label = "Linked to",
  properties,
  vehicles = [],
  homeEnabled,
  vehiclesEnabled = false,
  recordNoun,
  defaultValue = {},
  onChange,
  withHiddenInputs = false,
  disabled,
  chevron = false,
  hintLinksInNewTab = false,
  wrapperClassName = "space-y-1",
  labelClassName = "text-sm font-medium",
  selectClassName,
}: {
  id: string;
  label?: string;
  properties: LinkOption[];
  vehicles?: LinkOption[];
  homeEnabled: boolean;
  vehiclesEnabled?: boolean;
  /** "contract", "warranty" — used in the empty-module hints. */
  recordNoun: string;
  defaultValue?: Partial<LinkValue>;
  onChange?: (value: LinkValue) => void;
  withHiddenInputs?: boolean;
  disabled?: boolean;
  /** Wrap in SelectWrapper's chevron — for selects styled with `appearance-none`. */
  chevron?: boolean;
  /** In a review list with unsaved rows, following a hint mustn't lose them. */
  hintLinksInNewTab?: boolean;
  wrapperClassName?: string;
  labelClassName?: string;
  selectClassName: string;
}) {
  const initial: LinkValue = {
    propertyId: defaultValue.propertyId ?? "",
    vehicleId: defaultValue.vehicleId ?? "",
  };
  const [value, setValue] = useState<LinkValue>(initial);

  if (!homeEnabled && !vehiclesEnabled) return null;

  const showProperties = homeEnabled && properties.length > 0;
  const showVehicles = vehiclesEnabled && vehicles.length > 0;
  const propertyLabel = properties.find((p) => p.id === initial.propertyId)?.label;
  const vehicleLabel = vehicles.find((v) => v.id === initial.vehicleId)?.label;
  // The current link must stay selectable even when its list isn't shown
  // (its module is off) or doesn't include it, or the select would show
  // "Nothing" and choosing anything else would drop it unseen (#413).
  const initialValue = encode(initial);
  const initialShown =
    (showProperties && properties.some((p) => `property:${p.id}` === initialValue)) ||
    (showVehicles && vehicles.some((v) => `vehicle:${v.id}` === initialValue));
  const initialMissing = initialValue !== "" && initialValue !== BOTH && !initialShown;

  const hintLinkProps = hintLinksInNewTab ? { target: "_blank", rel: "noopener" } : {};

  const select = (
    <select
      id={id}
      value={encode(value)}
      disabled={disabled}
      onChange={(e) => {
        const next = decode(e.target.value, initial);
        setValue(next);
        onChange?.(next);
      }}
      className={selectClassName}
    >
      <option value="">Nothing</option>
      {/* Older contracts could be linked to a home and a vehicle at once;
          keep that pairing selectable so saving doesn't drop one of them. */}
      {initial.propertyId && initial.vehicleId && (
        <option value={BOTH}>
          {propertyLabel ?? "Property"} + {vehicleLabel ?? "vehicle"}
        </option>
      )}
      {initialMissing && (
        <option value={initialValue}>
          {initial.propertyId ? (propertyLabel ?? "Current property") : (vehicleLabel ?? "Current vehicle")}
        </option>
      )}
      {showProperties && (
        <optgroup label="Properties">
          {properties.map((p) => (
            <option key={p.id} value={`property:${p.id}`}>
              {p.label}
            </option>
          ))}
        </optgroup>
      )}
      {showVehicles && (
        <optgroup label="Vehicles">
          {vehicles.map((v) => (
            <option key={v.id} value={`vehicle:${v.id}`}>
              {v.label}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );

  return (
    <div className={wrapperClassName}>
      {(showProperties || showVehicles) && (
        <>
          <label htmlFor={id} className={labelClassName}>
            {label}
          </label>
          {chevron ? <SelectWrapper>{select}</SelectWrapper> : select}
        </>
      )}
      {homeEnabled && properties.length === 0 && (
        <p className="text-xs text-muted">
          No homes yet —{" "}
          <Link href="/home/new" className="text-accent hover:underline" {...hintLinkProps}>
            add one
          </Link>{" "}
          to link this {recordNoun} to a home.
        </p>
      )}
      {vehiclesEnabled && vehicles.length === 0 && (
        <p className="text-xs text-muted">
          No vehicles yet —{" "}
          <Link href="/vehicles/new" className="text-accent hover:underline" {...hintLinkProps}>
            add one
          </Link>{" "}
          to link this {recordNoun} to a vehicle.
        </p>
      )}
      {withHiddenInputs && (
        <>
          <input type="hidden" name="propertyId" value={value.propertyId} />
          {vehiclesEnabled && <input type="hidden" name="vehicleId" value={value.vehicleId} />}
        </>
      )}
    </div>
  );
}
