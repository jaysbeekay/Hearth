"use client";

import { useActionState, useState, useEffect, useRef } from "react";
import type { TradeModel } from "@/generated/prisma/models";
import type { ActionState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";
import { FormMessage } from "@/components/FormMessage";
import { TRADE_TYPES, TRADE_TYPE_LABELS } from "@/lib/validation/wealth";
import { SelectWrapper, selectClass } from "@/components/SelectWrapper";
import { CurrencySelect } from "@/components/CurrencySelect";
import { FileDropZone } from "@/components/FileDropZone";
import { makeOfflineAwareAction } from "@/lib/offlineQueue";

function toDateInputValue(date: Date | null | undefined) {
  if (!date) return "";
  return new Date(date).toISOString().slice(0, 10);
}

export function TradeForm({
  action,
  trade,
  ticker,
  holdingId,
  defaultCurrency,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  trade?: TradeModel;
  ticker?: string;
  holdingId?: string;
  defaultCurrency?: string;
}) {
  const offlineAwareAction = makeOfflineAwareAction(
    action,
    () => ({
      label: trade ? `Update trade: ${ticker ?? ""}` : `Add trade: ${ticker ?? ""}`,
      entity: "trade",
      operation: trade ? "update" : "create",
      entityId: trade?.id,
      parentId: trade?.holdingId ?? holdingId,
    }),
    { success: "Saved offline — will sync when you reconnect." },
  );

  const [state, formAction] = useActionState<ActionState, FormData>(offlineAwareAction, null);

  const [selectedDate, setSelectedDate] = useState(
    state?.values?.date ?? toDateInputValue(trade?.date) ?? "",
  );
  const [marketPrice, setMarketPrice] = useState<number | null>(null);
  const [priceHintLoading, setPriceHintLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const priceInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!ticker || !selectedDate) {
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setPriceHintLoading(true);
      try {
        const res = await fetch(
          `/api/wealth/price?ticker=${encodeURIComponent(ticker)}&date=${encodeURIComponent(selectedDate)}`,
        );
        const data = (await res.json()) as { price: number | null };
        setMarketPrice(data.price ?? null);
      } catch {
        setMarketPrice(null);
      } finally {
        setPriceHintLoading(false);
      }
    }, 600);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [ticker, selectedDate]);

  function applyMarketPrice() {
    if (marketPrice == null || !priceInputRef.current) return;
    priceInputRef.current.value = marketPrice.toFixed(4);
  }

  return (
    <form action={formAction} className="space-y-5">
      <FormMessage error={state?.error} success={state?.success} />

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1" htmlFor="type">Type <span className="text-danger">*</span></label>
          <SelectWrapper>
            <select
              id="type"
              name="type"
              defaultValue={state?.values?.type ?? trade?.type ?? "BUY"}
              className={selectClass}
            >
              {TRADE_TYPES.map((t) => (
                <option key={t} value={t}>{TRADE_TYPE_LABELS[t]}</option>
              ))}
            </select>
          </SelectWrapper>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1" htmlFor="date">Trade date <span className="text-danger">*</span></label>
          <input
            id="date"
            name="date"
            type="date"
            required
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1" htmlFor="units">Units <span className="text-danger">*</span></label>
          <input
            id="units"
            name="units"
            type="number"
            step="any"
            min="0"
            required
            defaultValue={state?.values?.units ?? trade?.units ?? ""}
            placeholder="e.g. 100"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1" htmlFor="pricePerUnit">
            Price per unit <span className="text-danger">*</span>
          </label>
          <input
            ref={priceInputRef}
            id="pricePerUnit"
            name="pricePerUnit"
            type="number"
            step="any"
            min="0"
            required
            defaultValue={state?.values?.pricePerUnit ?? trade?.pricePerUnit ?? ""}
            placeholder="e.g. 98.50"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
          />
          {ticker && selectedDate && (
            <div className="mt-1 flex items-center gap-2 text-xs text-foreground/50">
              {priceHintLoading ? (
                <span>Fetching market price…</span>
              ) : marketPrice != null ? (
                <>
                  <span>Market close {selectedDate}: {marketPrice.toFixed(4)}</span>
                  <button
                    type="button"
                    onClick={applyMarketPrice}
                    className="text-accent hover:underline"
                  >
                    Use
                  </button>
                </>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1" htmlFor="fees">Brokerage / fees</label>
          <input
            id="fees"
            name="fees"
            type="number"
            step="any"
            min="0"
            defaultValue={state?.values?.fees ?? (trade?.fees != null ? String(trade.fees) : "")}
            placeholder="e.g. 9.99"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1" htmlFor="currency">Currency</label>
          <CurrencySelect
            name="currency"
            defaultValue={state?.values?.currency ?? trade?.currency ?? defaultCurrency}
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="fxRate">FX rate to AUD (if non-AUD)</label>
        <input
          id="fxRate"
          name="fxRate"
          type="number"
          step="any"
          min="0"
          defaultValue={state?.values?.fxRate ?? (trade?.fxRate != null ? String(trade.fxRate) : "")}
          placeholder="Leave blank for AUD trades"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="notes">Notes</label>
        <textarea
          id="notes"
          name="notes"
          rows={2}
          defaultValue={state?.values?.notes ?? trade?.notes ?? ""}
          placeholder="Optional notes"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </div>

      <div>
        <p className="block text-sm font-medium mb-1">Attach document (optional)</p>
        <FileDropZone name="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx" />
        <p className="mt-1 text-xs text-foreground/40">PDF, image, or Word — max 15MB</p>
      </div>

      <SubmitButton>{trade ? "Save changes" : "Add trade"}</SubmitButton>
    </form>
  );
}
