"use client";

import { useActionState } from "react";
import type { PortfolioModel } from "@/generated/prisma/models";
import type { ActionState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";
import { FormMessage } from "@/components/FormMessage";
import { SelectWrapper, selectClass } from "@/components/SelectWrapper";

const COMMON_CURRENCIES = ["AUD", "USD", "EUR", "GBP", "JPY", "NZD", "CAD", "HKD", "SGD"];

export function PortfolioForm({
  action,
  portfolio,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  portfolio?: PortfolioModel;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, null);

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
        <SelectWrapper>
          <select
            id="currency"
            name="currency"
            defaultValue={state?.values?.currency ?? portfolio?.currency ?? "AUD"}
            className={selectClass}
          >
            {COMMON_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </SelectWrapper>
      </div>

      <SubmitButton>{portfolio ? "Save changes" : "Create portfolio"}</SubmitButton>
    </form>
  );
}
