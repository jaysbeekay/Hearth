"use client";

import { useActionState } from "react";
import Link from "next/link";
import { confirmAllExtractions } from "@/lib/actions/review";
import type { ActionState } from "@/lib/actions/auth";
import type { ReviewFieldSpec } from "@/components/ExtractionReviewPanel";
import { FormMessage } from "@/components/FormMessage";
import { SubmitButton } from "@/components/SubmitButton";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { inputClass } from "@/lib/ui";

export interface QuickCheckRecord {
  kind: "CONTRACT" | "PRODUCT";
  id: string;
  title: string;
  subtitle?: string;
  href: string;
  fields: ReviewFieldSpec[];
}

const FIELD_LABELS = new Map([
  ["title", "Title"],
  ["provider", "Provider"],
  ["cost", "Cost"],
  ["startDate", "Start date"],
  ["endDate", "End date"],
  ["description", "Description"],
  ["manufacturer", "Manufacturer"],
  ["price", "Price"],
  ["purchaseDate", "Purchase date"],
  ["warrantyEndDate", "Warranty end date"],
]);
const DATE_FIELDS = new Set(["startDate", "endDate", "purchaseDate", "warrantyEndDate"]);
const NUMBER_FIELDS = new Set(["cost", "price"]);

// #358 — every record waiting for a check, its auto-filled fields editable
// in place, and one "Confirm all".
export function QuickCheckForm({ records, canWrite }: { records: QuickCheckRecord[]; canWrite: boolean }) {
  const [state, formAction] = useActionState<ActionState, FormData>(confirmAllExtractions, null);

  return (
    <form action={formAction} className="space-y-3">
      {records.map((record) => {
        const prefix = `${record.kind}:${record.id}:`;
        return (
          <Card as="section" key={prefix} aria-label={record.title} className="space-y-3">
            <input type="hidden" name="record" value={`${record.kind}:${record.id}`} />
            <input type="hidden" name={`${prefix}label`} value={record.title} />
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <Link href={record.href} className="block truncate text-sm font-medium hover:underline">
                  {record.title}
                </Link>
                {record.subtitle && <p className="truncate text-xs text-muted">{record.subtitle}</p>}
              </div>
              <Pill>{record.kind === "CONTRACT" ? "Contract" : "Warranty"}</Pill>
            </div>
            {record.fields.length === 0 ? (
              <p className="text-sm text-muted">Nothing left to check on its own: confirming keeps it as it is.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {record.fields.map((field) => {
                  const id = `${prefix}reviewField:${field.fieldName}`;
                  return (
                    <div key={field.fieldName} className="space-y-0.5">
                      <label htmlFor={id} className="text-xs font-medium text-muted">
                        {FIELD_LABELS.get(field.fieldName) ?? field.fieldName}
                      </label>
                      <input
                        id={id}
                        name={id}
                        type={DATE_FIELDS.has(field.fieldName) ? "date" : NUMBER_FIELDS.has(field.fieldName) ? "number" : "text"}
                        step={NUMBER_FIELDS.has(field.fieldName) ? "0.01" : undefined}
                        defaultValue={field.currentValue}
                        disabled={!canWrite}
                        className={inputClass}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        );
      })}
      {canWrite && (
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton pendingText="Confirming…">Confirm all ({records.length})</SubmitButton>
          <FormMessage attempt={state} error={state?.error} success={state?.success} />
        </div>
      )}
    </form>
  );
}
