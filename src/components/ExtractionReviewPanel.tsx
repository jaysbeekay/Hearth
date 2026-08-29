"use client";

import { useActionState } from "react";
import { AlertCircle } from "lucide-react";
import type { ActionState } from "@/lib/actions/auth";
import { FormMessage } from "@/components/FormMessage";
import { SubmitButton } from "@/components/SubmitButton";
import { inputClass } from "@/components/SelectWrapper";
import { isAiExtractionSource, type ExtractionSource } from "@/lib/autoFillHighlight";

export interface ReviewFieldSpec {
  fieldName: string;
  currentValue: string;
  source: string;
  confidence: number | null;
}

const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  provider: "Provider",
  cost: "Cost",
  startDate: "Start date",
  endDate: "End date",
  description: "Description",
  manufacturer: "Manufacturer",
  price: "Price",
  purchaseDate: "Purchase date",
  warrantyEndDate: "Warranty end date",
};

const DATE_FIELDS = new Set(["startDate", "endDate", "purchaseDate", "warrantyEndDate"]);
const NUMBER_FIELDS = new Set(["cost", "price"]);

function inputTypeFor(fieldName: string): string {
  if (DATE_FIELDS.has(fieldName)) return "date";
  if (NUMBER_FIELDS.has(fieldName)) return "number";
  return "text";
}

function sourceLabel(source: string): string {
  if (isAiExtractionSource(source as ExtractionSource)) return "AI";
  if (source === "heuristic") return "Pattern match";
  if (source === "none" || source === "unknown") return "Manually entered";
  return source;
}

// #331 — replaces the one-click "Confirm details" with a per-field review:
// each auto-filled field shows its current value (read from the live
// record, so a manual edit already made is what's shown — see
// getPendingExtractionReview), its source, and its confidence, and can be
// corrected right here before confirming. Reminders stay paused
// (extractionPending) until this is submitted.
export function ExtractionReviewPanel({
  fields,
  action,
}: {
  fields: ReviewFieldSpec[];
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, null);

  return (
    <form
      action={formAction}
      className="space-y-3 rounded-xl border border-info/30 bg-info/10 p-4 md:p-6"
    >
      <p className="flex items-center gap-2 text-sm font-medium text-info">
        <AlertCircle size={16} className="shrink-0" aria-hidden />
        Needs review — {fields.length} field{fields.length === 1 ? "" : "s"} were filled in
        automatically. Reminders are on hold until you confirm them.
      </p>

      <div className="space-y-3">
        {fields.map((field) => (
          <div key={field.fieldName} className="grid gap-1 sm:grid-cols-[auto_1fr] sm:items-center sm:gap-3">
            <label htmlFor={`reviewField:${field.fieldName}`} className="text-sm font-medium text-foreground">
              {FIELD_LABELS[field.fieldName] ?? field.fieldName}
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id={`reviewField:${field.fieldName}`}
                name={`reviewField:${field.fieldName}`}
                type={inputTypeFor(field.fieldName)}
                step={NUMBER_FIELDS.has(field.fieldName) ? "0.01" : undefined}
                defaultValue={field.currentValue}
                className={`${inputClass} max-w-xs`}
              />
              <span className="rounded bg-current/10 px-1.5 py-0.5 text-[10px] font-medium text-info">
                {sourceLabel(field.source)}
              </span>
              {field.confidence != null && (
                <span className="text-[10px] text-muted">
                  {Math.round(field.confidence * 100)}% confidence
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <SubmitButton variant="secondary" pendingText="Confirming…">
          Confirm reviewed details
        </SubmitButton>
        <FormMessage error={state?.error} success={state?.success} />
      </div>
    </form>
  );
}
