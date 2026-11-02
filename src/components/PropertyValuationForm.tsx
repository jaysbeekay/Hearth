"use client";

import { useActionState, useId } from "react";
import { Plus } from "lucide-react";
import type { ActionState } from "@/lib/actions/auth";
import { CurrencySelect } from "@/components/CurrencySelect";
import { FormMessage } from "@/components/FormMessage";
import { SubmitButton } from "@/components/SubmitButton";
import { makeOfflineAwareAction } from "@/lib/offlineQueue";
import { DateInput } from "@/components/DateInput";
import { inputClass } from "@/lib/ui";

export function PropertyValuationForm({
  action,
  propertyId,
  defaultCurrency,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  propertyId: string;
  defaultCurrency?: string;
}) {
  const offlineAwareAction = makeOfflineAwareAction(
    action,
    () => ({
      label: "Add property valuation",
      entity: "propertyValuation",
      operation: "create",
      parentId: propertyId,
    }),
    { success: "Saved offline — will sync when you reconnect." },
  );

  const [state, formAction] = useActionState<ActionState, FormData>(offlineAwareAction, null);
  const fieldId = useId();

  return (
    <form action={formAction} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${fieldId}-valuedAt`} className="mb-1 block text-xs text-muted">Date</label>
          <DateInput
            id={`${fieldId}-valuedAt`}
            name="valuedAt"
            required
            defaultValue={state?.values?.valuedAt ?? new Date().toISOString().slice(0, 10)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor={`${fieldId}-value`} className="mb-1 block text-xs text-muted">Estimated value</label>
          <input
            id={`${fieldId}-value`}
            type="number"
            name="value"
            required
            step="1"
            min="0"
            defaultValue={state?.values?.value}
            placeholder="e.g. 750000"
            className={inputClass}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${fieldId}-currency`} className="mb-1 block text-xs text-muted">Currency</label>
          <CurrencySelect id={`${fieldId}-currency`} name="currency" defaultValue={state?.values?.currency ?? defaultCurrency} />
        </div>
        <div>
          <label htmlFor={`${fieldId}-source`} className="mb-1 block text-xs text-muted">Source (optional)</label>
          <input
            id={`${fieldId}-source`}
            type="text"
            name="source"
            defaultValue={state?.values?.source}
            placeholder="e.g. CoreLogic, agent appraisal"
            className={inputClass}
          />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs text-muted">Notes (optional)</label>
        <input
          type="text"
          name="notes"
          defaultValue={state?.values?.notes}
          placeholder="Any additional context"
          className={inputClass}
        />
      </div>
      <FormMessage attempt={state} error={state?.error} success={state?.success} />
      {/* #285 — capture-time disclosure that this isn't private storage. */}
      <p className="text-xs text-muted">Visible to your whole household once saved.</p>
      <SubmitButton variant="secondary">
        <Plus size={16} />
        Save valuation
      </SubmitButton>
    </form>
  );
}
