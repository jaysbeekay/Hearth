"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import {
  createContractFromAssistant,
  updateContractFromAssistant,
} from "@/lib/actions/contracts";
import { createProductFromAssistant, updateProductFromAssistant } from "@/lib/actions/products";
import { formatDate, type DateFormat } from "@/lib/utils";
import { useDateFormat } from "@/components/DateFormatProvider";
import { buttonClass } from "@/lib/buttonStyles";
import { Banner } from "@/components/ui";

export interface ProposedAction {
  id: string;
  entity: "contract" | "product";
  operation: "create" | "update";
  entityId?: string;
  // An update's record name, looked up when the proposal was made: an
  // update's data holds only the changing fields, so may have no title.
  label?: string;
  // A create's full record, or an update's changing fields only (#420).
  data: Record<string, unknown>;
  // How to show a field whose raw value is an id: a linked Property or
  // Vehicle's name. Display only; never sent to the action.
  displayValues?: Record<string, string>;
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
  reminderDaysBefore: "Reminder thresholds",
  isTaxDeductible: "Tax deductible",
  manufacturer: "Brand",
  model: "Model",
  vendor: "Vendor",
  serialNumber: "Serial number",
  barcode: "Barcode",
  purchaseDate: "Purchase date",
  warrantyEndDate: "Warranty end date",
  price: "Price",
  propertyId: "Property",
  vehicleId: "Vehicle",
};

// The SSE turns Dates into ISO strings; show these as calendar dates.
const DATE_FIELDS = new Set(["startDate", "endDate", "purchaseDate", "warrantyEndDate"]);

function formatValue(
  key: string,
  value: unknown,
  displayValues: Map<string, string>,
  dateFormat: DateFormat,
): string {
  const display = displayValues.get(key);
  if (display !== undefined) return display;
  if (value instanceof Date) return formatDate(value, dateFormat);
  if (DATE_FIELDS.has(key) && typeof value === "string") return formatDate(value, dateFormat);
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
  const dateFormat = useDateFormat();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);

  async function handleConfirm() {
    setWorking(true);
    setError(null);
    let result: { success: true } | { success: false; error: string };
    try {
      result =
        action.entity === "contract"
          ? action.operation === "create"
            ? await createContractFromAssistant(action.data)
            : await updateContractFromAssistant(action.entityId!, action.data)
          : action.operation === "create"
            ? await createProductFromAssistant(action.data)
            : await updateProductFromAssistant(action.entityId!, action.data);
    } catch {
      // The action threw (signed out, read-only, server unreachable): keep
      // the card open so the user can see it failed and try again.
      setError("Couldn't save that change. Try again.");
      return;
    } finally {
      setWorking(false);
    }

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

  // An update lists exactly the fields it changes; nothing else is sent.
  const entries = Object.entries(action.data).filter(([, v]) => v != null && v !== "");
  const displayValues = new Map(Object.entries(action.displayValues ?? {}));
  const titleValue = action.operation === "update" && action.label
    ? action.label
    : ((action.data.title ?? action.data.description) as string | undefined);

  return (
    <Banner tone="accent" className="mt-2">
      <p className="mb-2 font-medium">
        {action.operation === "create" ? "Create" : "Update"} {action.entity}
        {titleValue ? `: ${titleValue}` : ""}
      </p>
      <dl className="mb-3 grid grid-cols-1 gap-x-4 gap-y-0.5 text-xs text-muted sm:grid-cols-2">
        {entries.map(([key, value]) => (
          <div key={key} className="flex gap-1">
            <dt className="shrink-0 font-medium">{FIELD_LABELS[key] ?? key}:</dt>
            <dd className="truncate">{formatValue(key, value, displayValues, dateFormat)}</dd>
          </div>
        ))}
      </dl>
      {error && (
        <p role="alert" className="mb-2 text-xs text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleConfirm}
          disabled={working}
          className={buttonClass("primary")}
        >
          <Check size={16} />
          {working ? "Saving…" : "Confirm"}
        </button>
        <button
          type="button"
          onClick={handleCancel}
          disabled={working}
          className={buttonClass("secondary")}
        >
          <X size={16} />
          Cancel
        </button>
      </div>
    </Banner>
  );
}
