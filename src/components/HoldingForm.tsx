"use client";

import { useActionState } from "react";
import type { HoldingModel } from "@/generated/prisma/models";
import type { ActionState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";
import { FormMessage } from "@/components/FormMessage";
import { ASSET_CLASSES, ASSET_CLASS_LABELS } from "@/lib/validation/wealth";

const COMMON_EXCHANGES = ["ASX", "NYSE", "NASDAQ", "LSE", "TSX", "CRYPTO", "OTHER"];

export function HoldingForm({
  action,
  holding,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  holding?: HoldingModel;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, null);

  return (
    <form action={formAction} className="space-y-5">
      <FormMessage error={state?.error} success={state?.success} />

      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="ticker">
          Ticker symbol <span className="text-danger">*</span>
        </label>
        <input
          id="ticker"
          name="ticker"
          type="text"
          required
          defaultValue={state?.values?.ticker ?? holding?.ticker ?? ""}
          placeholder="e.g. CBA.AX, AAPL, bitcoin"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm uppercase outline-none focus:border-accent"
        />
        <p className="mt-1 text-xs text-foreground/50">
          ASX: append .AX (e.g. CBA.AX) · Crypto: use CoinGecko ID (e.g. bitcoin)
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="name">Display name</label>
        <input
          id="name"
          name="name"
          type="text"
          defaultValue={state?.values?.name ?? holding?.name ?? ""}
          placeholder="e.g. Commonwealth Bank of Australia"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1" htmlFor="assetClass">Asset class</label>
          <select
            id="assetClass"
            name="assetClass"
            defaultValue={state?.values?.assetClass ?? holding?.assetClass ?? "SHARE"}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
          >
            {ASSET_CLASSES.map((c) => (
              <option key={c} value={c}>{ASSET_CLASS_LABELS[c]}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1" htmlFor="exchange">Exchange</label>
          <select
            id="exchange"
            name="exchange"
            defaultValue={state?.values?.exchange ?? holding?.exchange ?? "ASX"}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
          >
            <option value="">— Select —</option>
            {COMMON_EXCHANGES.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>
      </div>

      <SubmitButton>{holding ? "Save changes" : "Add holding"}</SubmitButton>
    </form>
  );
}
