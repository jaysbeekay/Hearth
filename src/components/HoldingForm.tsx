"use client";

import { useActionState } from "react";
import type { HoldingModel } from "@/generated/prisma/models";
import type { ActionState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";
import { FormActions } from "@/components/FormActions";
import { FormMessage } from "@/components/FormMessage";
import { Field } from "@/components/FormField";
import { ASSET_CLASSES, ASSET_CLASS_LABELS } from "@/lib/validation/wealth";
import { SelectWrapper, inputClass, selectClass } from "@/components/SelectWrapper";
import { makeOfflineAwareAction } from "@/lib/offlineQueue";
import { cn } from "@/lib/utils";

const COMMON_EXCHANGES = ["ASX", "NYSE", "NASDAQ", "LSE", "TSX", "CRYPTO", "OTHER"];

export function HoldingForm({
  action,
  cancelHref,
  holding,
  portfolioId,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  /** Where Cancel goes: the same place as the page's BackLink. */
  cancelHref: string;
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
      baseUpdatedAt: holding?.updatedAt?.toISOString(),
    }),
    { success: "Saved offline — will sync when you reconnect." },
  );

  const [state, formAction] = useActionState<ActionState, FormData>(offlineAwareAction, null);

  return (
    <form action={formAction} className="space-y-4">
      <FormMessage attempt={state} error={state?.error} field={state?.field} success={state?.success} />

      <Field label="Ticker symbol" htmlFor="ticker" required hint="ASX: append .AX (e.g. CBA.AX) · Crypto: set the asset class to Crypto and use the CoinGecko ID (e.g. bitcoin) or symbol (e.g. BTC)">
        <input
          id="ticker"
          name="ticker"
          type="text"
          required
          defaultValue={state?.values?.ticker ?? holding?.ticker ?? ""}
          placeholder="e.g. CBA.AX, AAPL, bitcoin"
          className={cn(inputClass, "font-mono")}
        />
      </Field>

      <Field label="Display name" htmlFor="name">
        <input
          id="name"
          name="name"
          type="text"
          defaultValue={state?.values?.name ?? holding?.name ?? ""}
          placeholder="e.g. Commonwealth Bank of Australia"
          className={inputClass}
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Asset class" htmlFor="assetClass">
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
        </Field>

        <Field label="Exchange" htmlFor="exchange">
          <SelectWrapper>
            <select
              id="exchange"
              name="exchange"
              defaultValue={state?.values?.exchange ?? (holding ? holding.exchange ?? "" : "ASX")}
              className={selectClass}
            >
              <option value="">— Select —</option>
              {/* An exchange outside the common list (e.g. from an import)
                  stays selectable, or saving would post it blank (#413). */}
              {holding?.exchange && !COMMON_EXCHANGES.includes(holding.exchange) && (
                <option value={holding.exchange}>{holding.exchange}</option>
              )}
              {COMMON_EXCHANGES.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </SelectWrapper>
        </Field>
      </div>

      {/* #285 — capture-time disclosure that this isn't private storage. */}
      {!holding && <p className="text-xs text-muted">Visible to your whole household once saved.</p>}

      <FormActions cancelHref={cancelHref}>
        <SubmitButton>{holding ? "Save changes" : "Add holding"}</SubmitButton>
      </FormActions>
    </form>
  );
}
