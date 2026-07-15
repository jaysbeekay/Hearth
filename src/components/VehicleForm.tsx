"use client";

import { useActionState } from "react";
import type { VehicleModel } from "@/generated/prisma/models";
import type { ActionState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";
import { FormMessage } from "@/components/FormMessage";
import { makeOfflineAwareAction } from "@/lib/offlineQueue";

function toDateInputValue(date: Date | null | undefined) {
  if (!date) return "";
  return new Date(date).toISOString().slice(0, 10);
}

export function VehicleForm({
  action,
  vehicle,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  vehicle?: VehicleModel;
}) {
  const offlineAwareAction = makeOfflineAwareAction(
    action,
    () => ({
      label: vehicle ? `Update vehicle: ${vehicle.label}` : "Add vehicle",
      entity: "vehicle",
      operation: vehicle ? "update" : "create",
      entityId: vehicle?.id,
      baseUpdatedAt: vehicle?.updatedAt?.toISOString(),
    }),
    { success: "Saved offline — will sync when you reconnect." },
  );

  const [state, formAction] = useActionState<ActionState, FormData>(offlineAwareAction, null);

  return (
    <form action={formAction} className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Label *" htmlFor="label">
          <input
            id="label"
            name="label"
            required
            defaultValue={state?.values?.label ?? vehicle?.label}
            placeholder="e.g. Family Corolla"
            className={inputClass}
          />
        </Field>

        <Field label="Licence plate" htmlFor="licensePlate">
          <input
            id="licensePlate"
            name="licensePlate"
            defaultValue={state?.values?.licensePlate ?? vehicle?.licensePlate ?? ""}
            placeholder="e.g. ABC123"
            className={inputClass}
          />
        </Field>

        <Field label="Make" htmlFor="make">
          <input
            id="make"
            name="make"
            defaultValue={state?.values?.make ?? vehicle?.make ?? ""}
            placeholder="e.g. Toyota"
            className={inputClass}
          />
        </Field>

        <Field label="Model" htmlFor="model">
          <input
            id="model"
            name="model"
            defaultValue={state?.values?.model ?? vehicle?.model ?? ""}
            placeholder="e.g. Corolla"
            className={inputClass}
          />
        </Field>

        <Field label="Year" htmlFor="year">
          <input
            id="year"
            name="year"
            type="number"
            min={1886}
            max={2100}
            defaultValue={state?.values?.year ?? vehicle?.year ?? ""}
            placeholder="e.g. 2019"
            className={inputClass}
          />
        </Field>

        <Field label="Colour" htmlFor="colour">
          <input
            id="colour"
            name="colour"
            defaultValue={state?.values?.colour ?? vehicle?.colour ?? ""}
            placeholder="e.g. White"
            className={inputClass}
          />
        </Field>

        <Field label="VIN" htmlFor="vin">
          <input
            id="vin"
            name="vin"
            defaultValue={state?.values?.vin ?? vehicle?.vin ?? ""}
            placeholder="17-character vehicle identifier"
            className={inputClass}
          />
        </Field>

        <Field label="Rego expiry" htmlFor="regoExpiry">
          <input
            id="regoExpiry"
            name="regoExpiry"
            type="date"
            defaultValue={state?.values?.regoExpiry ?? toDateInputValue(vehicle?.regoExpiry)}
            className={inputClass}
          />
        </Field>

        <Field label="Insurance expiry" htmlFor="insuranceExpiry">
          <input
            id="insuranceExpiry"
            name="insuranceExpiry"
            type="date"
            defaultValue={
              state?.values?.insuranceExpiry ?? toDateInputValue(vehicle?.insuranceExpiry)
            }
            className={inputClass}
          />
        </Field>

        <Field label="Reminder days before" htmlFor="reminderDaysBefore">
          <input
            id="reminderDaysBefore"
            name="reminderDaysBefore"
            defaultValue={
              state?.values?.reminderDaysBefore ?? vehicle?.reminderDaysBefore ?? "30,14,7,1"
            }
            placeholder="e.g. 30,14,7,1"
            className={inputClass}
          />
        </Field>
      </div>

      <Field label="Notes" htmlFor="notes">
        <textarea
          id="notes"
          name="notes"
          rows={4}
          defaultValue={state?.values?.notes ?? vehicle?.notes ?? ""}
          className={inputClass}
        />
      </Field>

      <FormMessage error={state?.error} success={state?.success} />

      <div className="flex justify-end gap-3">
        <SubmitButton>{vehicle ? "Save changes" : "Add vehicle"}</SubmitButton>
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
