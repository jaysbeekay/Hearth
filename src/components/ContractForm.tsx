"use client";

import { useActionState, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { Upload } from "lucide-react";
import type { ContractModel } from "@/generated/prisma/models";
import type { ActionState } from "@/lib/actions/contracts";
import { SubmitButton } from "@/components/SubmitButton";
import { FormMessage } from "@/components/FormMessage";
import {
  BILLING_LABELS,
  CATEGORY_LABELS,
  RENEWAL_LABELS,
} from "@/lib/utils";
import { enqueueOperation, serializeFormData } from "@/lib/offlineQueue";

function toDateInputValue(date: Date | null | undefined) {
  if (!date) return "";
  return new Date(date).toISOString().slice(0, 10);
}

type ExtractedFields = Partial<
  Record<
    | "title"
    | "provider"
    | "contractNumber"
    | "startDate"
    | "endDate"
    | "cost"
    | "billingFrequency"
    | "contactName"
    | "contactPhone"
    | "contactEmail",
    string
  >
>;

export function ContractForm({
  action,
  contract,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  contract?: ContractModel;
}) {
  const offlineAwareAction = async (
    prevState: ActionState,
    formData: FormData,
  ): Promise<ActionState> => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      await enqueueOperation({
        label: contract ? `Update contract: ${contract.title}` : "Add contract",
        entity: "contract",
        operation: contract ? "update" : "create",
        entityId: contract?.id,
        formValues: serializeFormData(formData),
      });
      window.dispatchEvent(new Event("offline-queued"));
      return { success: "Saved offline — will sync when you reconnect." };
    }
    return action(prevState, formData);
  };

  const [state, formAction] = useActionState<ActionState, FormData>(offlineAwareAction, null);
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);

  const titleRef = useRef<HTMLInputElement>(null);
  const providerRef = useRef<HTMLInputElement>(null);
  const contractNumberRef = useRef<HTMLInputElement>(null);
  const startDateRef = useRef<HTMLInputElement>(null);
  const endDateRef = useRef<HTMLInputElement>(null);
  const costRef = useRef<HTMLInputElement>(null);
  const billingFrequencyRef = useRef<HTMLSelectElement>(null);
  const contactNameRef = useRef<HTMLInputElement>(null);
  const contactPhoneRef = useRef<HTMLInputElement>(null);
  const contactEmailRef = useRef<HTMLInputElement>(null);

  function applyExtractedFields(fields: ExtractedFields) {
    if (fields.title && titleRef.current && !titleRef.current.value) {
      titleRef.current.value = fields.title;
    }
    if (fields.provider && providerRef.current) providerRef.current.value = fields.provider;
    if (fields.contractNumber && contractNumberRef.current) {
      contractNumberRef.current.value = fields.contractNumber;
    }
    if (fields.startDate && startDateRef.current) startDateRef.current.value = fields.startDate;
    if (fields.endDate && endDateRef.current) endDateRef.current.value = fields.endDate;
    if (fields.cost && costRef.current) costRef.current.value = fields.cost;
    if (fields.billingFrequency && billingFrequencyRef.current) {
      billingFrequencyRef.current.value = fields.billingFrequency;
    }
    if (fields.contactName && contactNameRef.current) {
      contactNameRef.current.value = fields.contactName;
    }
    if (fields.contactPhone && contactPhoneRef.current) {
      contactPhoneRef.current.value = fields.contactPhone;
    }
    if (fields.contactEmail && contactEmailRef.current) {
      contactEmailRef.current.value = fields.contactEmail;
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setScanning(true);
    setScanMessage(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/documents/extract", { method: "POST", body });
      if (!res.ok) throw new Error("Extraction failed");

      const { fields } = (await res.json()) as { fields: ExtractedFields };
      if (Object.keys(fields).length === 0) {
        setScanMessage("Couldn't detect any fields from this document — fill them in manually.");
      } else {
        applyExtractedFields(fields);
        setScanMessage("Fields populated from the document — review before saving.");
      }
    } catch {
      setScanMessage("Couldn't scan this document. You can still attach it and fill in fields manually.");
    } finally {
      setScanning(false);
    }
  }

  return (
    <form action={formAction} className="space-y-6">
      {!contract && (
        <div className="space-y-2 rounded-lg border border-dashed border-border p-4">
          <label htmlFor="file" className="flex items-center gap-2 text-sm font-medium">
            <Upload size={16} />
            Upload a document to auto-fill fields (optional)
          </label>
          <input
            type="file"
            id="file"
            name="file"
            accept=".pdf,.doc,.docx,image/*"
            onChange={handleFileChange}
            className="text-sm"
          />
          {scanning && <p className="text-sm text-foreground/60">Scanning document…</p>}
          {!scanning && scanMessage && (
            <p className="text-sm text-foreground/60">{scanMessage}</p>
          )}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Title" htmlFor="title">
          <input
            ref={titleRef}
            id="title"
            name="title"
            required
            defaultValue={state?.values?.title ?? contract?.title}
            placeholder="e.g. Apartment lease - 12 Main St"
            className={inputClass}
          />
        </Field>

        <Field label="Category" htmlFor="category">
          <select
            id="category"
            name="category"
            required
            defaultValue={state?.values?.category ?? contract?.category ?? "OTHER"}
            className={inputClass}
          >
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Provider / Company" htmlFor="provider">
          <input
            ref={providerRef}
            id="provider"
            name="provider"
            required
            defaultValue={state?.values?.provider ?? contract?.provider}
            placeholder="e.g. Allianz, Acme Realty"
            className={inputClass}
          />
        </Field>

        <Field label="Contract / policy number" htmlFor="contractNumber">
          <input
            ref={contractNumberRef}
            id="contractNumber"
            name="contractNumber"
            defaultValue={state?.values?.contractNumber ?? contract?.contractNumber ?? ""}
            className={inputClass}
          />
        </Field>

        <Field label="Start date" htmlFor="startDate">
          <input
            ref={startDateRef}
            id="startDate"
            name="startDate"
            type="date"
            defaultValue={state?.values?.startDate ?? toDateInputValue(contract?.startDate)}
            className={inputClass}
          />
        </Field>

        <Field label="End date" htmlFor="endDate">
          <input
            ref={endDateRef}
            id="endDate"
            name="endDate"
            type="date"
            defaultValue={state?.values?.endDate ?? toDateInputValue(contract?.endDate)}
            className={inputClass}
          />
        </Field>

        <Field label="Renewal type" htmlFor="renewalType">
          <select
            id="renewalType"
            name="renewalType"
            defaultValue={state?.values?.renewalType ?? contract?.renewalType ?? "MANUAL_RENEWAL"}
            className={inputClass}
          >
            {Object.entries(RENEWAL_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Notice period (days)" htmlFor="noticePeriodDays">
          <input
            id="noticePeriodDays"
            name="noticePeriodDays"
            type="number"
            min={0}
            defaultValue={state?.values?.noticePeriodDays ?? contract?.noticePeriodDays ?? ""}
            placeholder="e.g. 30"
            className={inputClass}
          />
        </Field>

        <Field label="Cost" htmlFor="cost">
          <input
            ref={costRef}
            id="cost"
            name="cost"
            type="number"
            min={0}
            step="0.01"
            defaultValue={state?.values?.cost ?? contract?.cost ?? ""}
            className={inputClass}
          />
        </Field>

        <Field label="Currency" htmlFor="currency">
          <input
            id="currency"
            name="currency"
            defaultValue={state?.values?.currency ?? contract?.currency ?? "AUD"}
            maxLength={10}
            className={inputClass}
          />
        </Field>

        <Field label="Billing frequency" htmlFor="billingFrequency">
          <select
            ref={billingFrequencyRef}
            id="billingFrequency"
            name="billingFrequency"
            defaultValue={state?.values?.billingFrequency ?? contract?.billingFrequency ?? ""}
            className={inputClass}
          >
            <option value="">Not set</option>
            {Object.entries(BILLING_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>

        {contract && (
          <Field label="Status" htmlFor="status">
            <select
              id="status"
              name="status"
              defaultValue={state?.values?.status ?? contract.status}
              className={inputClass}
            >
              <option value="ACTIVE">Active</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </Field>
        )}
      </div>

      <fieldset className="space-y-4 rounded-lg border border-border p-4">
        <legend className="px-1 text-sm font-medium text-foreground/70">
          Contact details (optional)
        </legend>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Contact name" htmlFor="contactName">
            <input
              ref={contactNameRef}
              id="contactName"
              name="contactName"
              defaultValue={state?.values?.contactName ?? contract?.contactName ?? ""}
              className={inputClass}
            />
          </Field>
          <Field label="Contact phone" htmlFor="contactPhone">
            <input
              ref={contactPhoneRef}
              id="contactPhone"
              name="contactPhone"
              defaultValue={state?.values?.contactPhone ?? contract?.contactPhone ?? ""}
              className={inputClass}
            />
          </Field>
          <Field label="Contact email" htmlFor="contactEmail">
            <input
              ref={contactEmailRef}
              id="contactEmail"
              name="contactEmail"
              type="email"
              defaultValue={state?.values?.contactEmail ?? contract?.contactEmail ?? ""}
              className={inputClass}
            />
          </Field>
        </div>
      </fieldset>

      <Field label="Notes" htmlFor="notes">
        <textarea
          id="notes"
          name="notes"
          rows={4}
          defaultValue={state?.values?.notes ?? contract?.notes ?? ""}
          className={inputClass}
        />
      </Field>

      <Field
        label="Remind me before expiry (days, comma-separated)"
        htmlFor="reminderDaysBefore"
      >
        <input
          id="reminderDaysBefore"
          name="reminderDaysBefore"
          defaultValue={state?.values?.reminderDaysBefore ?? contract?.reminderDaysBefore ?? ""}
          placeholder="30,14,7,1"
          className={inputClass}
        />
      </Field>

      <div className="flex items-center gap-2">
        <input
          id="isTaxDeductible"
          name="isTaxDeductible"
          type="checkbox"
          defaultChecked={
            state?.values?.isTaxDeductible === "on"
              ? true
              : contract?.isTaxDeductible ?? false
          }
          className="size-4 rounded border-border accent-accent"
        />
        <label htmlFor="isTaxDeductible" className="text-sm">
          Tax deductible
        </label>
      </div>

      <FormMessage error={state?.error} success={state?.success} />

      <div className="flex justify-end gap-3">
        <SubmitButton>{contract ? "Save changes" : "Add contract"}</SubmitButton>
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
