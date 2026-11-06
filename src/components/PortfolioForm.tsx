"use client";

import { useActionState } from "react";
import type { PortfolioModel } from "@/generated/prisma/models";
import type { ActionState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";
import { FormActions } from "@/components/FormActions";
import { FormMessage } from "@/components/FormMessage";
import { Field } from "@/components/FormField";
import { SelectWrapper, inputClass, selectClass } from "@/components/SelectWrapper";
import { CurrencySelect } from "@/components/CurrencySelect";
import { makeOfflineAwareAction } from "@/lib/offlineQueue";
import { COST_METHODS, COST_METHOD_LABELS } from "@/lib/validation/wealth";

export function PortfolioForm({
  action,
  cancelHref,
  portfolio,
  defaultCurrency,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  /** Where Cancel goes: the same place as the page's BackLink. */
  cancelHref: string;
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
    <form action={formAction} className="space-y-4">
      <FormMessage attempt={state} error={state?.error} field={state?.field} success={state?.success} />

      <Field label="Portfolio name" htmlFor="name" required>
        <input
          id="name"
          name="name"
          type="text"
          required
          defaultValue={state?.values?.name ?? portfolio?.name ?? ""}
          placeholder="e.g. CommSec Shares"
          className={inputClass}
        />
      </Field>

      <Field label="Description" htmlFor="description">
        <input
          id="description"
          name="description"
          type="text"
          defaultValue={state?.values?.description ?? portfolio?.description ?? ""}
          placeholder="Optional description"
          className={inputClass}
        />
      </Field>

      <Field label="Base currency" htmlFor="currency">
        <CurrencySelect
          name="currency"
          defaultValue={state?.values?.currency ?? portfolio?.currency ?? defaultCurrency}
        />
      </Field>

      <Field label="Cost basis method" htmlFor="costMethod">
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
        <p className="text-xs text-muted">
          Determines how gains/losses are calculated when units are sold. Changing this
          recalculates cost basis for existing trades — check it matches how you report
          capital gains.
        </p>
      </Field>

      {/* #285 — capture-time disclosure that this isn't private storage. */}
      {!portfolio && <p className="text-xs text-muted">Visible to your whole household once saved.</p>}

      <FormActions cancelHref={cancelHref}>
        <SubmitButton>{portfolio ? "Save changes" : "Add portfolio"}</SubmitButton>
      </FormActions>
    </form>
  );
}
