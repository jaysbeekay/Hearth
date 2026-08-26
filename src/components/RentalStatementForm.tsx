"use client";

import { useActionState, useRef, useState } from "react";
import { Upload } from "lucide-react";
import type { RentalStatementModel } from "@/generated/prisma/models";
import type { ActionState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";
import { FormMessage } from "@/components/FormMessage";
import { Field } from "@/components/FormField";
import { inputClass } from "@/components/SelectWrapper";
import { CurrencySelect } from "@/components/CurrencySelect";
import { FileDropZone } from "@/components/FileDropZone";
import { applyIfEmpty, extractionMessage } from "@/lib/autoFillHighlight";
import { makeOfflineAwareAction } from "@/lib/offlineQueue";
import { DateInput } from "@/components/DateInput";

function toDateInputValue(date: Date | null | undefined) {
  if (!date) return "";
  return new Date(date).toISOString().slice(0, 10);
}

type ExtractedFields = Partial<
  Record<
    | "periodStart"
    | "periodEnd"
    | "statementDate"
    | "grossRent"
    | "managementFee"
    | "otherDeductions"
    | "netAmount",
    string
  >
>;

export function RentalStatementForm({
  action,
  statement,
  propertyId,
  defaultCurrency,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  statement?: RentalStatementModel;
  propertyId?: string;
  defaultCurrency?: string;
}) {
  const offlineAwareAction = makeOfflineAwareAction(
    action,
    () => ({
      label: statement ? "Update rental statement" : "Add rental statement",
      entity: "rentalStatement",
      operation: statement ? "update" : "create",
      entityId: statement?.id,
      parentId: statement?.propertyId ?? propertyId,
      baseUpdatedAt: statement?.updatedAt?.toISOString(),
    }),
    { success: "Saved offline — will sync when you reconnect." },
  );

  const [state, formAction] = useActionState<ActionState, FormData>(offlineAwareAction, null);
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);

  const periodStartRef = useRef<HTMLInputElement>(null);
  const periodEndRef = useRef<HTMLInputElement>(null);
  const statementDateRef = useRef<HTMLInputElement>(null);
  const grossRentRef = useRef<HTMLInputElement>(null);
  const managementFeeRef = useRef<HTMLInputElement>(null);
  const otherDeductionsRef = useRef<HTMLInputElement>(null);
  const netAmountRef = useRef<HTMLInputElement>(null);

  function applyExtractedFields(fields: ExtractedFields) {
    applyIfEmpty(periodStartRef.current, fields.periodStart);
    applyIfEmpty(periodEndRef.current, fields.periodEnd);
    applyIfEmpty(statementDateRef.current, fields.statementDate);
    applyIfEmpty(grossRentRef.current, fields.grossRent);
    applyIfEmpty(managementFeeRef.current, fields.managementFee);
    applyIfEmpty(otherDeductionsRef.current, fields.otherDeductions);
    applyIfEmpty(netAmountRef.current, fields.netAmount);
  }

  async function handleFileChange(file: File | null) {
    if (!file) return;

    setScanning(true);
    setScanMessage(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/home/rental-extract", { method: "POST", body });
      if (!res.ok) throw new Error("Extraction failed");

      const { fields, source } = (await res.json()) as {
        fields: ExtractedFields;
        source: "byok" | "heuristic" | "llm" | "none";
      };
      const filledCount = Object.keys(fields).length;
      if (filledCount > 0) applyExtractedFields(fields);
      setScanMessage(extractionMessage(source, filledCount));
    } catch {
      setScanMessage(
        "Couldn't scan this document. You can still attach it and fill in fields manually.",
      );
    } finally {
      setScanning(false);
    }
  }

  return (
    <form action={formAction} className="space-y-6">
      {!statement && (
        <div className="space-y-2 rounded-lg border border-dashed border-border p-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Upload size={16} />
            Save time: upload a rental statement or invoice and Hearth fills in the details
          </p>
          <FileDropZone name="file" onFileSelected={handleFileChange} />
          {scanning && (
            <p role="status" aria-live="polite" className="text-sm text-muted">
              Scanning document…
            </p>
          )}
          {!scanning && scanMessage && (
            <p role="status" aria-live="polite" className="text-sm text-muted">
              {scanMessage}
            </p>
          )}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Period start" htmlFor="periodStart">
          <DateInput
            ref={periodStartRef}
            id="periodStart"
            name="periodStart"
            defaultValue={
            state?.values?.periodStart ?? toDateInputValue(statement?.periodStart)
            }
            className={inputClass}
          />
        </Field>

        <Field label="Period end" htmlFor="periodEnd">
          <DateInput
            ref={periodEndRef}
            id="periodEnd"
            name="periodEnd"
            defaultValue={
            state?.values?.periodEnd ?? toDateInputValue(statement?.periodEnd)
            }
            className={inputClass}
          />
        </Field>

        <Field label="Statement date" htmlFor="statementDate">
          <DateInput
            ref={statementDateRef}
            id="statementDate"
            name="statementDate"
            defaultValue={
            state?.values?.statementDate ?? toDateInputValue(statement?.statementDate)
            }
            className={inputClass}
          />
        </Field>

        <Field label="Currency" htmlFor="currency">
          <CurrencySelect
            name="currency"
            defaultValue={state?.values?.currency ?? statement?.currency ?? defaultCurrency}
          />
        </Field>

        <Field label="Gross rent" htmlFor="grossRent">
          <input
            ref={grossRentRef}
            id="grossRent"
            name="grossRent"
            type="number"
            min={0}
            step="0.01"
            defaultValue={state?.values?.grossRent ?? statement?.grossRent ?? ""}
            className={inputClass}
          />
        </Field>

        <Field label="Management fee" htmlFor="managementFee">
          <input
            ref={managementFeeRef}
            id="managementFee"
            name="managementFee"
            type="number"
            min={0}
            step="0.01"
            defaultValue={state?.values?.managementFee ?? statement?.managementFee ?? ""}
            className={inputClass}
          />
        </Field>

        <Field label="Other deductions" htmlFor="otherDeductions">
          <input
            ref={otherDeductionsRef}
            id="otherDeductions"
            name="otherDeductions"
            type="number"
            min={0}
            step="0.01"
            defaultValue={
              state?.values?.otherDeductions ?? statement?.otherDeductions ?? ""
            }
            className={inputClass}
          />
        </Field>

        <Field label="Net amount (paid to you)" htmlFor="netAmount">
          <input
            ref={netAmountRef}
            id="netAmount"
            name="netAmount"
            type="number"
            step="0.01"
            defaultValue={state?.values?.netAmount ?? statement?.netAmount ?? ""}
            className={inputClass}
          />
        </Field>
      </div>

      <Field label="Notes" htmlFor="notes">
        <textarea
          id="notes"
          name="notes"
          rows={3}
          defaultValue={state?.values?.notes ?? statement?.notes ?? ""}
          className={inputClass}
        />
      </Field>

      <FormMessage error={state?.error} success={state?.success} />

      <div className="flex justify-end gap-3">
        <SubmitButton>{statement ? "Save changes" : "Add statement"}</SubmitButton>
      </div>
    </form>
  );
}