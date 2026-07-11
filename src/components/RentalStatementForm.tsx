"use client";

import { useActionState, useRef, useState } from "react";
import { Upload } from "lucide-react";
import type { RentalStatementModel } from "@/generated/prisma/models";
import type { ActionState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";
import { FormMessage } from "@/components/FormMessage";
import { CurrencySelect } from "@/components/CurrencySelect";
import { FileDropZone } from "@/components/FileDropZone";

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
  defaultCurrency,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  statement?: RentalStatementModel;
  defaultCurrency?: string;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, null);
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
    if (fields.periodStart && periodStartRef.current)
      periodStartRef.current.value = fields.periodStart;
    if (fields.periodEnd && periodEndRef.current)
      periodEndRef.current.value = fields.periodEnd;
    if (fields.statementDate && statementDateRef.current)
      statementDateRef.current.value = fields.statementDate;
    if (fields.grossRent && grossRentRef.current)
      grossRentRef.current.value = fields.grossRent;
    if (fields.managementFee && managementFeeRef.current)
      managementFeeRef.current.value = fields.managementFee;
    if (fields.otherDeductions && otherDeductionsRef.current)
      otherDeductionsRef.current.value = fields.otherDeductions;
    if (fields.netAmount && netAmountRef.current)
      netAmountRef.current.value = fields.netAmount;
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

      const { fields } = (await res.json()) as { fields: ExtractedFields };
      if (Object.keys(fields).length === 0) {
        setScanMessage("Couldn't detect any fields from this document — fill them in manually.");
      } else {
        applyExtractedFields(fields);
        setScanMessage("Fields populated from the document — review before saving.");
      }
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
            <p role="status" aria-live="polite" className="text-sm text-foreground/60">
              Scanning document…
            </p>
          )}
          {!scanning && scanMessage && (
            <p role="status" aria-live="polite" className="text-sm text-foreground/60">
              {scanMessage}
            </p>
          )}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Period start" htmlFor="periodStart">
          <input
            ref={periodStartRef}
            id="periodStart"
            name="periodStart"
            type="date"
            defaultValue={
              state?.values?.periodStart ?? toDateInputValue(statement?.periodStart)
            }
            className={inputClass}
          />
        </Field>

        <Field label="Period end" htmlFor="periodEnd">
          <input
            ref={periodEndRef}
            id="periodEnd"
            name="periodEnd"
            type="date"
            defaultValue={
              state?.values?.periodEnd ?? toDateInputValue(statement?.periodEnd)
            }
            className={inputClass}
          />
        </Field>

        <Field label="Statement date" htmlFor="statementDate">
          <input
            ref={statementDateRef}
            id="statementDate"
            name="statementDate"
            type="date"
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

const inputClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent";

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}
