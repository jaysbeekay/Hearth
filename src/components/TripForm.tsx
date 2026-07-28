"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { TripModel } from "@/generated/prisma/models";
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
    router.push("/travel");
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
        <Field label="Title" htmlFor="title" required>
          <input
            id="title"
            name="title"
            required
            defaultValue={effectiveValues?.title ?? trip?.title}
            placeholder="e.g. Japan trip 2026"
            className={inputClass}
          />
        </Field>

        <Field label="Destination" htmlFor="destination">
          <input
            id="destination"
            name="destination"
            defaultValue={effectiveValues?.destination ?? trip?.destination ?? ""}
            placeholder="e.g. Tokyo, Japan"
            className={inputClass}
          />
        </Field>

        <Field label="Start date" htmlFor="startDate">
          <input
            id="startDate"
            name="startDate"
            type="date"
            defaultValue={effectiveValues?.startDate ?? toDateInputValue(trip?.startDate)}
            className={inputClass}
          />
        </Field>

        <Field label="End date" htmlFor="endDate">
          <input
            id="endDate"
            name="endDate"
            type="date"
            defaultValue={effectiveValues?.endDate ?? toDateInputValue(trip?.endDate)}
            className={inputClass}
          />
        </Field>
      </div>

      <Field label="Notes" htmlFor="notes">
        <textarea
          id="notes"
          name="notes"
          rows={4}
          defaultValue={effectiveValues?.notes ?? trip?.notes ?? ""}
          className={inputClass}
        />
      </Field>

      <FormMessage error={state?.error} success={state?.success} />

      <div className="flex justify-end gap-3">
        <SubmitButton>{pendingOp || trip ? "Save changes" : "Add trip"}</SubmitButton>
      </div>
    </form>
  );
}