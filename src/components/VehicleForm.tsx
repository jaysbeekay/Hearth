"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { VehicleModel } from "@/generated/prisma/models";
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
import { inputClass } from "@/components/SelectWrapper";

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
    router.push("/vehicles");
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
            required
            defaultValue={effectiveValues?.label ?? vehicle?.label}
            placeholder="e.g. Family Corolla"
            className={inputClass}
          />
        </Field>

        <Field label="Licence plate" htmlFor="licensePlate">
          <input
            id="licensePlate"
            name="licensePlate"
            defaultValue={effectiveValues?.licensePlate ?? vehicle?.licensePlate ?? ""}
            placeholder="e.g. ABC123"
            className={inputClass}
          />
        </Field>

        <Field label="Make" htmlFor="make">
          <input
            id="make"
            name="make"
            defaultValue={effectiveValues?.make ?? vehicle?.make ?? ""}
            placeholder="e.g. Toyota"
            className={inputClass}
          />
        </Field>

        <Field label="Model" htmlFor="model">
          <input
            id="model"
            name="model"
            defaultValue={effectiveValues?.model ?? vehicle?.model ?? ""}
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
            defaultValue={effectiveValues?.year ?? vehicle?.year ?? ""}
            placeholder="e.g. 2019"
            className={inputClass}
          />
        </Field>

        <Field label="Colour" htmlFor="colour">
          <input
            id="colour"
            name="colour"
            defaultValue={effectiveValues?.colour ?? vehicle?.colour ?? ""}
            placeholder="e.g. White"
            className={inputClass}
          />
        </Field>

        <Field label="VIN" htmlFor="vin">
          <input
            id="vin"
            name="vin"
            defaultValue={effectiveValues?.vin ?? vehicle?.vin ?? ""}
            placeholder="17-character vehicle identifier"
            className={inputClass}
          />
        </Field>

        <Field label="Rego expiry" htmlFor="regoExpiry">
          <input
            id="regoExpiry"
            name="regoExpiry"
            type="date"
            defaultValue={effectiveValues?.regoExpiry ?? toDateInputValue(vehicle?.regoExpiry)}
            className={inputClass}
          />
        </Field>

        <Field label="Insurance expiry" htmlFor="insuranceExpiry">
          <input
            id="insuranceExpiry"
            name="insuranceExpiry"
            type="date"
            defaultValue={
              effectiveValues?.insuranceExpiry ?? toDateInputValue(vehicle?.insuranceExpiry)
            }
            className={inputClass}
          />
        </Field>

        <Field label="Reminder days before" htmlFor="reminderDaysBefore">
          <input
            id="reminderDaysBefore"
            name="reminderDaysBefore"
            defaultValue={
              effectiveValues?.reminderDaysBefore ?? vehicle?.reminderDaysBefore ?? "30,14,7,1"
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
          defaultValue={effectiveValues?.notes ?? vehicle?.notes ?? ""}
          className={inputClass}
        />
      </Field>

      <FormMessage error={state?.error} success={state?.success} />

      <div className="flex justify-end gap-3">
        <SubmitButton>{pendingOp || vehicle ? "Save changes" : "Add vehicle"}</SubmitButton>
      </div>
    </form>
  );
}