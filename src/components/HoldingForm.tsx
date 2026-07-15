"use client";

import { useActionState } from "react";
import type { HoldingModel } from "@/generated/prisma/models";
import type { ActionState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";
import { FormMessage } from "@/components/FormMessage";
import { ASSET_CLASSES, ASSET_CLASS_LABELS } from "@/lib/validation/wealth";
import { SelectWrapper, selectClass } from "@/components/SelectWrapper";
import { makeOfflineAwareAction } from "@/lib/offlineQueue";

const COMMON_EXCHANGES = ["ASX", "NYSE", "NASDAQ", "LSE", "TSX", "CRYPTO", "OTHER"];

export function HoldingForm({
  action,
  holding,
  portfolioId,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  holding?: HoldingModel;
  portfolioId?: string;
}) {
  const offlineAwareAction = makeOfflineAwareAction(
    action,
    () => ({
      label: holding ? `Update holding: ${holding.ticker}` : "Add holding",
      entity: "holding",
      operation: holding ? "update" : "create",
      entityId: holding?.id,
      parentId: holding?.portfolioId ?? portfolioId,
    }),
    { success: "Saved offline — will sync when you reconnect." },
  );

  const [state, formAction] = useActionState<ActionState, FormData>(offlineAwareAction, null);

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
          <SelectWrapper>
            <select
              id="assetClass"
              name="assetClass"
              defaultValue={state?.values?.assetClass ?? holding?.assetClass ?? "SHARE"}
              className={selectClass}
            >
              {ASSET_CLASSES.map((c) => (
                <option key={c} value={c}>{ASSET_CLASS_LABELS[c]}</option>
              ))}
            </select>
          </SelectWrapper>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1" htmlFor="exchange">Exchange</label>
          <SelectWrapper>
            <select
              id="exchange"
              name="exchange"
              defaultValue={state?.values?.exchange ?? holding?.exchange ?? "ASX"}
              className={selectClass}
            >
              <option value="">— Select —</option>
              {COMMON_EXCHANGES.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </SelectWrapper>
        </div>
      </div>

      <SubmitButton>{holding ? "Save changes" : "Add holding"}</SubmitButton>
    </form>
  );
}
