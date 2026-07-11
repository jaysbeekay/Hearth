"use client";

import { useActionState, useRef, useState } from "react";
import { Upload } from "lucide-react";
import type { RentalAgreementModel } from "@/generated/prisma/models";
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
  Record<"weeklyRent" | "tenantName" | "leaseStart" | "leaseEnd" | "bondAmount", string>
>;

export function RentalAgreementForm({
  action,
  agreement,
  defaultCurrency,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  agreement?: RentalAgreementModel;
  defaultCurrency?: string;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, null);
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);

  const weeklyRentRef = useRef<HTMLInputElement>(null);
  const tenantNameRef = useRef<HTMLInputElement>(null);
  const leaseStartRef = useRef<HTMLInputElement>(null);
  const leaseEndRef = useRef<HTMLInputElement>(null);
  const bondAmountRef = useRef<HTMLInputElement>(null);

  function applyExtractedFields(fields: ExtractedFields) {
    if (fields.weeklyRent && weeklyRentRef.current) weeklyRentRef.current.value = fields.weeklyRent;
    if (fields.tenantName && tenantNameRef.current) tenantNameRef.current.value = fields.tenantName;
    if (fields.leaseStart && leaseStartRef.current) leaseStartRef.current.value = fields.leaseStart;
    if (fields.leaseEnd && leaseEndRef.current) leaseEndRef.current.value = fields.leaseEnd;
    if (fields.bondAmount && bondAmountRef.current) bondAmountRef.current.value = fields.bondAmount;
  }

  async function handleFileChange(file: File | null) {
    if (!file) return;

    setScanning(true);
    setScanMessage(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/home/lease-extract", { method: "POST", body });
      if (!res.ok) throw new Error("Extraction failed");

      const { fields } = (await res.json()) as { fields: ExtractedFields };
      if (Object.keys(fields).length === 0) {
        setScanMessage("Couldn't detect any fields from this document — fill them in manually.");
      } else {
        applyExtractedFields(fields);
        setScanMessage("Fields populated from the lease — review before saving.");
      }
    } catch {
      setScanMessage("Couldn't scan this document. You can still fill in the fields manually.");
    } finally {
      setScanning(false);
    }
  }

  return (
    <form action={formAction} className="space-y-6">
      {!agreement && (
        <div className="space-y-2 rounded-lg border border-dashed border-border p-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Upload size={16} />
            Upload lease agreement to auto-fill fields (optional)
          </p>
          <FileDropZone name="leaseFile" onFileSelected={handleFileChange} />
          {scanning && (
            <p role="status" aria-live="polite" className="text-sm text-foreground/60">
              Scanning lease document…
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
        <Field label="Weekly rent *" htmlFor="weeklyRent">
          <input
            ref={weeklyRentRef}
            id="weeklyRent"
            name="weeklyRent"
            type="number"
            min={0}
            step="0.01"
            required
            defaultValue={state?.values?.weeklyRent ?? agreement?.weeklyRent ?? ""}
            placeholder="e.g. 650"
            className={inputClass}
          />
        </Field>

        <Field label="Management fee (%)" htmlFor="managementFeePercent">
          <input
            id="managementFeePercent"
            name="managementFeePercent"
            type="number"
            min={0}
            max={100}
            step="0.01"
            defaultValue={
              state?.values?.managementFeePercent ?? agreement?.managementFeePercent ?? ""
            }
            placeholder="e.g. 8.5"
            className={inputClass}
          />
        </Field>

        <Field label="Tenant name" htmlFor="tenantName">
          <input
            ref={tenantNameRef}
            id="tenantName"
            name="tenantName"
            defaultValue={state?.values?.tenantName ?? agreement?.tenantName ?? ""}
            placeholder="e.g. Smith family"
            className={inputClass}
          />
        </Field>

        <Field label="Bond amount" htmlFor="bondAmount">
          <input
            ref={bondAmountRef}
            id="bondAmount"
            name="bondAmount"
            type="number"
            min={0}
            step="0.01"
            defaultValue={state?.values?.bondAmount ?? agreement?.bondAmount ?? ""}
            placeholder="e.g. 2600"
            className={inputClass}
          />
        </Field>

        <Field label="Lease start" htmlFor="leaseStart">
          <input
            ref={leaseStartRef}
            id="leaseStart"
            name="leaseStart"
            type="date"
            defaultValue={state?.values?.leaseStart ?? toDateInputValue(agreement?.leaseStart)}
            className={inputClass}
          />
        </Field>

        <Field label="Lease end" htmlFor="leaseEnd">
          <input
            ref={leaseEndRef}
            id="leaseEnd"
            name="leaseEnd"
            type="date"
            defaultValue={state?.values?.leaseEnd ?? toDateInputValue(agreement?.leaseEnd)}
            className={inputClass}
          />
        </Field>

        <Field label="Currency" htmlFor="currency">
          <CurrencySelect
            name="currency"
            defaultValue={state?.values?.currency ?? agreement?.currency ?? defaultCurrency}
          />
        </Field>
      </div>

      <Field label="Notes" htmlFor="notes">
        <textarea
          id="notes"
          name="notes"
          rows={3}
          defaultValue={state?.values?.notes ?? agreement?.notes ?? ""}
          className={inputClass}
        />
      </Field>

      <FormMessage error={state?.error} success={state?.success} />

      <div className="flex justify-end gap-3">
        <SubmitButton>{agreement ? "Save changes" : "Add agreement"}</SubmitButton>
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
