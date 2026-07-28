"use client";

import { useActionState } from "react";
import type { TripModel } from "@/generated/prisma/models";
import type { ActionState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";
import { FormMessage } from "@/components/FormMessage";
import { Field } from "@/components/FormField";
import { inputClass } from "@/components/SelectWrapper";
import { makeOfflineAwareAction } from "@/lib/offlineQueue";

function toDateInputValue(date: Date | null | undefined) {
  if (!date) return "";
  return new Date(date).toISOString().slice(0, 10);
}

export function TripForm({
  action,
  trip,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  trip?: TripModel;
}) {
  const offlineAwareAction = makeOfflineAwareAction(
    action,
    () => ({
      label: trip ? `Update trip: ${trip.title}` : "Add trip",
      entity: "trip",
      operation: trip ? "update" : "create",
      entityId: trip?.id,
      baseUpdatedAt: trip?.updatedAt?.toISOString(),
    }),
    { success: "Saved offline — will sync when you reconnect." },
  );

  const [state, formAction] = useActionState<ActionState, FormData>(offlineAwareAction, null);

  return (
    <form action={formAction} className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Title" htmlFor="title" required>
          <input
            id="title"
            name="title"
            required
            defaultValue={state?.values?.title ?? trip?.title}
            placeholder="e.g. Japan trip 2026"
            className={inputClass}
          />
        </Field>

        <Field label="Destination" htmlFor="destination">
          <input
            id="destination"
            name="destination"
            defaultValue={state?.values?.destination ?? trip?.destination ?? ""}
            placeholder="e.g. Tokyo, Japan"
            className={inputClass}
          />
        </Field>

        <Field label="Start date" htmlFor="startDate">
          <input
            id="startDate"
            name="startDate"
            type="date"
            defaultValue={state?.values?.startDate ?? toDateInputValue(trip?.startDate)}
            className={inputClass}
          />
        </Field>

        <Field label="End date" htmlFor="endDate">
          <input
            id="endDate"
            name="endDate"
            type="date"
            defaultValue={state?.values?.endDate ?? toDateInputValue(trip?.endDate)}
            className={inputClass}
          />
        </Field>
      </div>

      <Field label="Notes" htmlFor="notes">
        <textarea
          id="notes"
          name="notes"
          rows={4}
          defaultValue={state?.values?.notes ?? trip?.notes ?? ""}
          className={inputClass}
        />
      </Field>

      <FormMessage error={state?.error} success={state?.success} />

      <div className="flex justify-end gap-3">
        <SubmitButton>{trip ? "Save changes" : "Add trip"}</SubmitButton>
      </div>
    </form>
  );
}