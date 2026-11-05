"use client";

import { useState } from "react";
import { AlertTriangle, Check, X } from "lucide-react";
import {
  createContractFromAssistant,
  updateContractFromAssistant,
} from "@/lib/actions/contracts";
import { createProductFromAssistant, updateProductFromAssistant } from "@/lib/actions/products";
import { formatDate, type DateFormat } from "@/lib/utils";
import { useDateFormat } from "@/components/DateFormatProvider";
import { bannerClass, buttonClass, cardClass } from "@/lib/ui";
import { FREE_TEXT_FIELDS } from "@/lib/chat/proposalReview";

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
  // #530 — an update's current value for each field it changes, and
  // warnings by field (src/lib/chat/proposalReview.ts). Display only.
  currentValues?: Record<string, unknown>;
  warnings?: Record<string, string[]>;
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
  const noDisplayValues = new Map<string, string>();
  const warnings = action.warnings ?? {};
  const flaggedCount = entries.filter(([key]) => (warnings[key]?.length ?? 0) > 0).length;
  const hasFreeText = entries.some(([key]) => FREE_TEXT_FIELDS.has(key));

  return (
    <div className={cardClass({}, "mt-2 text-sm")}>
      <p className="mb-2 font-medium">
        {action.operation === "create" ? "Create" : "Update"} {action.entity}
        {titleValue ? `: ${titleValue}` : ""}
      </p>
      {flaggedCount > 0 && (
        <p role="status" className={bannerClass("warning", "mb-2 flex items-start gap-1.5 px-3 py-2 text-xs")}>
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
          {flaggedCount === 1 ? "1 field needs" : `${flaggedCount} fields need`} a closer look before you
          confirm.
        </p>
      )}
      {hasFreeText && (
        <p className="mb-2 text-xs text-muted">
          Shaded text was written by the Assistant. Read it in full before you confirm.
        </p>
      )}
      <dl className="mb-3 grid grid-cols-1 gap-x-4 gap-y-1 text-xs text-muted sm:grid-cols-2">
        {entries.map(([key, value]) => {
          const freeText = FREE_TEXT_FIELDS.has(key);
          // The tool sends a current link as its label, and a blank field as null.
          const current = action.currentValues?.[key];
          return (
            <div key={key} className={freeText ? "flex min-w-0 flex-wrap gap-x-1 sm:col-span-2" : "flex min-w-0 flex-wrap gap-x-1"}>
              <dt className="shrink-0 font-medium">{FIELD_LABELS[key] ?? key}:</dt>
              <dd
                className={
                  freeText
                    ? "min-w-0 basis-full whitespace-pre-wrap break-words rounded bg-muted/10 px-1.5 py-0.5 text-foreground"
                    : "min-w-0 flex-1 truncate"
                }
              >
                {formatValue(key, value, displayValues, dateFormat)}
              </dd>
              {current !== undefined && (
                <dd className="basis-full break-words">
                  Now: {current === null ? "(blank)" : formatValue(key, current, noDisplayValues, dateFormat)}
                </dd>
              )}
              {(warnings[key] ?? []).map((warning) => (
                <dd key={warning} className="flex basis-full items-start gap-1 text-warning">
                  <AlertTriangle size={16} className="shrink-0" aria-hidden />
                  {warning}
                </dd>
              ))}
            </div>
          );
        })}
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
    </div>
  );
}
