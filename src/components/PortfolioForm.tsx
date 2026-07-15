"use client";

import { useActionState } from "react";
import type { PortfolioModel } from "@/generated/prisma/models";
import type { ActionState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";
import { FormMessage } from "@/components/FormMessage";
import { CurrencySelect } from "@/components/CurrencySelect";
import { makeOfflineAwareAction } from "@/lib/offlineQueue";

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
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
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
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="currency">Base currency</label>
        <CurrencySelect
          name="currency"
          defaultValue={state?.values?.currency ?? portfolio?.currency ?? defaultCurrency}
        />
      </div>

      <SubmitButton>{portfolio ? "Save changes" : "Create portfolio"}</SubmitButton>
    </form>
  );
}
