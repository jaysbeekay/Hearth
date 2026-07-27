"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import {
  createContractFromAssistant,
  updateContractFromAssistant,
} from "@/lib/actions/contracts";
import { createProductFromAssistant, updateProductFromAssistant } from "@/lib/actions/products";

export interface ProposedAction {
  id: string;
  entity: "contract" | "product";
  operation: "create" | "update";
  entityId?: string;
  data: Record<string, unknown>;
}

const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  description: "Description",
  category: "Category",
  provider: "Provider",
  contractNumber: "Contract number",
  startDate: "Start date",
  endDate: "End date",
  renewalType: "Renewal type",
  noticePeriodDays: "Notice period (days)",
  cost: "Cost",
  currency: "Currency",
  billingFrequency: "Billing frequency",
  status: "Status",
  contactName: "Contact name",
  contactPhone: "Contact phone",
  contactEmail: "Contact email",
  notes: "Notes",
  reminderDaysBefore: "Reminder days",
  isTaxDeductible: "Tax deductible",
  manufacturer: "Brand",
  model: "Model",
  vendor: "Vendor",
  serialNumber: "Serial number",
  barcode: "Barcode",
  purchaseDate: "Purchase date",
  warrantyEndDate: "Warranty end date",
  price: "Price",
};

function formatValue(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

// Never writes to the database itself — the guarded-write tool that produced
// this proposal (src/lib/chat/tools.ts) already validated the fields, but
// the actual create/update only happens here, once the user explicitly
// confirms, via the same *FromAssistant server actions the real forms use
// (same requireUser()/Zod-schema gate, so a READONLY user's confirm click
// still fails cleanly even if a proposal somehow reached them).
export function ProposedActionCard({
  action,
  onResolved,
}: {
  action: ProposedAction;
  onResolved: (result: { success: boolean; message: string }) => void;
}) {
  const [working, setWorking] = useState(false);
  const [resolved, setResolved] = useState(false);

  async function handleConfirm() {
    setWorking(true);
    const result =
      action.entity === "contract"
        ? action.operation === "create"
          ? await createContractFromAssistant(action.data)
          : await updateContractFromAssistant(action.entityId!, action.data)
        : action.operation === "create"
          ? await createProductFromAssistant(action.data)
          : await updateProductFromAssistant(action.entityId!, action.data);

    setWorking(false);
    setResolved(true);
    onResolved(
      result.success
        ? {
            success: true,
            message: `${action.operation === "create" ? "Created" : "Updated"} the ${action.entity} successfully.`,
          }
        : { success: false, message: result.error },
    );
  }

  function handleCancel() {
    setResolved(true);
    onResolved({ success: false, message: "Cancelled — nothing was saved." });
  }

  if (resolved) return null;

  const entries = Object.entries(action.data).filter(([, v]) => v != null && v !== "");
  const titleValue = (action.data.title ?? action.data.description) as string | undefined;

  return (
    <div className="mt-2 rounded-xl border border-accent/30 bg-accent/5 p-3 text-sm">
      <p className="mb-2 font-medium">
        {action.operation === "create" ? "Create" : "Update"} {action.entity}
        {titleValue ? `: ${titleValue}` : ""}
      </p>
      <dl className="mb-3 grid grid-cols-1 gap-x-4 gap-y-0.5 text-xs text-foreground/70 sm:grid-cols-2">
        {entries.map(([key, value]) => (
          <div key={key} className="flex gap-1">
            <dt className="shrink-0 font-medium">{FIELD_LABELS[key] ?? key}:</dt>
            <dd className="truncate">{formatValue(value)}</dd>
          </div>
        ))}
      </dl>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleConfirm}
          disabled={working}
          className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:opacity-90 disabled:opacity-50"
        >
          <Check size={14} />
          {working ? "Saving…" : "Confirm"}
        </button>
        <button
          type="button"
          onClick={handleCancel}
          disabled={working}
          className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
        >
          <X size={14} />
          Cancel
        </button>
      </div>
    </div>
  );
}
