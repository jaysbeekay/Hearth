"use client";

import { useActionState } from "react";
import type { PortfolioModel } from "@/generated/prisma/models";
import type { ActionState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";
import { FormMessage } from "@/components/FormMessage";
import { SelectWrapper, inputClass, selectClass } from "@/components/SelectWrapper";
import { CurrencySelect } from "@/components/CurrencySelect";
import { makeOfflineAwareAction } from "@/lib/offlineQueue";
import { COST_METHODS, COST_METHOD_LABELS } from "@/lib/validation/wealth";

export function PortfolioForm({
  action,
  portfolio,
  defaultCurrency,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  portfolio?: PortfolioModel;
  defaultCurrency?: string;
}) {
  const offlineAwareAction = makeOfflineAwareAction(
    action,
    () => ({
      label: portfolio ? `Update portfolio: ${portfolio.name}` : "Add portfolio",
      entity: "portfolio",
      operation: portfolio ? "update" : "create",
      entityId: portfolio?.id,
      baseUpdatedAt: portfolio?.updatedAt?.toISOString(),
    }),
    { success: "Saved offline — will sync when you reconnect." },
  );

  const [state, formAction] = useActionState<ActionState, FormData>(offlineAwareAction, null);

  return (
    <form action={formAction} className="space-y-5">
      <FormMessage error={state?.error} success={state?.success} />

      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="name">Portfolio name <span className="text-danger">*</span></label>
        <input
          id="name"
          name="name"
          type="text"
          required
          defaultValue={state?.values?.name ?? portfolio?.name ?? ""}
          placeholder="e.g. CommSec Shares"
          className={inputClass}
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="description">Description</label>
        <input
          id="description"
          name="description"
          type="text"
          defaultValue={state?.values?.description ?? portfolio?.description ?? ""}
          placeholder="Optional description"
          className={inputClass}
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="currency">Base currency</label>
        <CurrencySelect
          name="currency"
          defaultValue={state?.values?.currency ?? portfolio?.currency ?? defaultCurrency}
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="costMethod">Cost basis method</label>
        <SelectWrapper>
          <select
            id="costMethod"
            name="costMethod"
            defaultValue={state?.values?.costMethod ?? portfolio?.costMethod ?? "FIFO"}
            className={selectClass}
          >
            {COST_METHODS.map((m) => (
              <option key={m} value={m}>{COST_METHOD_LABELS[m]}</option>
            ))}
          </select>
        </SelectWrapper>
        <p className="mt-1 text-xs text-muted">
          Determines how gains/losses are calculated when units are sold. Changing this
          recalculates cost basis for existing trades — check it matches how you report
          capital gains.
        </p>
      </div>

      <SubmitButton>{portfolio ? "Save changes" : "Create portfolio"}</SubmitButton>
    </form>
  );
}
