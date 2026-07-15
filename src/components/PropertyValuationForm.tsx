"use client";

import { useActionState } from "react";
import { Plus } from "lucide-react";
import type { ActionState } from "@/lib/actions/auth";
import { CurrencySelect } from "@/components/CurrencySelect";
import { FormMessage } from "@/components/FormMessage";
import { makeOfflineAwareAction } from "@/lib/offlineQueue";

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

  return (
    <form action={formAction} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs text-foreground/60">Date</label>
          <input
            type="date"
            name="valuedAt"
            required
            defaultValue={state?.values?.valuedAt ?? new Date().toISOString().slice(0, 10)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-foreground/60">Estimated value</label>
          <input
            type="number"
            name="value"
            required
            step="1"
            min="0"
            defaultValue={state?.values?.value}
            placeholder="e.g. 750000"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs text-foreground/60">Currency</label>
          <CurrencySelect name="currency" defaultValue={state?.values?.currency ?? defaultCurrency} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-foreground/60">Source (optional)</label>
          <input
            type="text"
            name="source"
            defaultValue={state?.values?.source}
            placeholder="e.g. CoreLogic, agent appraisal"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs text-foreground/60">Notes (optional)</label>
        <input
          type="text"
          name="notes"
          defaultValue={state?.values?.notes}
          placeholder="Any additional context"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </div>
      <FormMessage error={state?.error} success={state?.success} />
      <button
        type="submit"
        className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
      >
        <Plus size={16} />
        Save valuation
      </button>
    </form>
  );
}
