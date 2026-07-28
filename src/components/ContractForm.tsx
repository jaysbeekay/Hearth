"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Upload } from "lucide-react";
import type { ContractModel } from "@/generated/prisma/models";
import type { ActionState } from "@/lib/actions/contracts";
import { SubmitButton } from "@/components/SubmitButton";
import { FormMessage } from "@/components/FormMessage";
import { Field } from "@/components/FormField";
import {
  BILLING_LABELS,
  CATEGORY_LABELS,
  RENEWAL_LABELS,
} from "@/lib/utils";
import { SelectWrapper, inputClass, selectClass } from "@/components/SelectWrapper";
import { CurrencySelect } from "@/components/CurrencySelect";
import { FileDropZone } from "@/components/FileDropZone";
import {
  makeOfflineAwareAction,
  getOperationById,
  updateOperationFormValues,
  serializeFormData,
  type QueuedOperation,
} from "@/lib/offlineQueue";
import { markAutoFilled, extractionMessage } from "@/lib/autoFillHighlight";

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
  defaultCurrency,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  contract?: ContractModel;
  defaultCurrency?: string;
}) {
  const offlineAwareAction = makeOfflineAwareAction(
    action,
    () => ({
      label: contract ? `Update contract: ${contract.title}` : "Add contract",
      entity: "contract",
      operation: contract ? "update" : "create",
      entityId: contract?.id,
      baseUpdatedAt: contract?.updatedAt?.toISOString(),
    }),
    { success: "Saved offline — will sync when you reconnect." },
  );

  const [state, formAction] = useActionState<ActionState, FormData>(offlineAwareAction, null);
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);

  // Editing a record that was created offline and hasn't synced yet — there's
  // no server-side row to update, so submitting rewrites the queued
  // operation's formValues in place instead of calling the real action.
  const router = useRouter();
  const pendingOpId = useSearchParams().get("pendingOpId");
  // undefined = still loading from IndexedDB (only relevant when pendingOpId
  // is set) — the field defaultValues below must not mount until this
  // resolves, since defaultValue only takes effect on an input's first mount.
  const [pendingOp, setPendingOp] = useState<QueuedOperation | null | undefined>(
    pendingOpId ? undefined : null,
  );
  useEffect(() => {
    if (!pendingOpId) return;
    getOperationById(pendingOpId).then((op) => setPendingOp(op ?? null));
  }, [pendingOpId]);
  const effectiveValues = state?.values ?? pendingOp?.formValues;

  async function handlePendingSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!pendingOp) return;
    const { values } = serializeFormData(new FormData(e.currentTarget));
    await updateOperationFormValues(pendingOp.id, values);
    router.push("/contracts");
  }

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
      markAutoFilled(titleRef.current);
    }
    if (fields.provider && providerRef.current) {
      providerRef.current.value = fields.provider;
      markAutoFilled(providerRef.current);
    }
    if (fields.contractNumber && contractNumberRef.current) {
      contractNumberRef.current.value = fields.contractNumber;
      markAutoFilled(contractNumberRef.current);
    }
    if (fields.startDate && startDateRef.current) {
      startDateRef.current.value = fields.startDate;
      markAutoFilled(startDateRef.current);
    }
    if (fields.endDate && endDateRef.current) {
      endDateRef.current.value = fields.endDate;
      markAutoFilled(endDateRef.current);
    }
    if (fields.cost && costRef.current) {
      costRef.current.value = fields.cost;
      markAutoFilled(costRef.current);
    }
    if (fields.billingFrequency && billingFrequencyRef.current) {
      billingFrequencyRef.current.value = fields.billingFrequency;
      markAutoFilled(billingFrequencyRef.current);
    }
    if (fields.contactName && contactNameRef.current) {
      contactNameRef.current.value = fields.contactName;
      markAutoFilled(contactNameRef.current);
    }
    if (fields.contactPhone && contactPhoneRef.current) {
      contactPhoneRef.current.value = fields.contactPhone;
      markAutoFilled(contactPhoneRef.current);
    }
    if (fields.contactEmail && contactEmailRef.current) {
      contactEmailRef.current.value = fields.contactEmail;
      markAutoFilled(contactEmailRef.current);
    }
  }

  async function handleFileChange(file: File | null) {
    if (!file) return;

    setScanning(true);
    setScanMessage(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/documents/extract", { method: "POST", body });
      if (!res.ok) throw new Error("Extraction failed");

      const { fields, source } = (await res.json()) as {
        fields: ExtractedFields;
        source: "byok" | "heuristic" | "llm" | "none";
      };
      const filledCount = Object.keys(fields).length;
      if (filledCount > 0) applyExtractedFields(fields);
      setScanMessage(extractionMessage(source, filledCount));
    } catch {
      setScanMessage("Couldn't scan this document. You can still attach it and fill in fields manually.");
    } finally {
      setScanning(false);
    }
  }

  if (pendingOp === undefined) {
    return <p className="text-sm text-muted">Loading…</p>;
  }

  return (
    <form
      {...(pendingOp ? { onSubmit: handlePendingSubmit } : { action: formAction })}
      className="space-y-6"
    >
      {pendingOp && (
        <p className="rounded-lg border border-dashed border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-700 dark:text-amber-400">
          Editing an offline entry that hasn&apos;t synced yet — saving updates it in place.
        </p>
      )}
      {!contract && (
        <div className="space-y-2 rounded-lg border border-dashed border-border p-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Upload size={16} />
            Save time: drop in the contract PDF and Hearth fills the form for you
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
        <Field label="Title" htmlFor="title" required>
          <input
            ref={titleRef}
            id="title"
            name="title"
            required
            defaultValue={effectiveValues?.title ?? contract?.title}
            placeholder="e.g. Apartment lease - 12 Main St"
            className={inputClass}
          />
        </Field>

        <Field label="Category" htmlFor="category" required>
          <SelectWrapper>
            <select
              id="category"
              name="category"
              required
              defaultValue={effectiveValues?.category ?? contract?.category ?? "OTHER"}
              className={selectClass}
            >
              {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </SelectWrapper>
        </Field>

        <Field label="Provider / Company" htmlFor="provider" required>
          <input
            ref={providerRef}
            id="provider"
            name="provider"
            required
            defaultValue={effectiveValues?.provider ?? contract?.provider}
            placeholder="e.g. Allianz, Acme Realty"
            className={inputClass}
          />
        </Field>

        <Field label="Contract / policy number" htmlFor="contractNumber">
          <input
            ref={contractNumberRef}
            id="contractNumber"
            name="contractNumber"
            defaultValue={effectiveValues?.contractNumber ?? contract?.contractNumber ?? ""}
            className={inputClass}
          />
        </Field>

        <Field label="Start date" htmlFor="startDate">
          <input
            ref={startDateRef}
            id="startDate"
            name="startDate"
            type="date"
            defaultValue={effectiveValues?.startDate ?? toDateInputValue(contract?.startDate)}
            className={inputClass}
          />
        </Field>

        <Field label="End date" htmlFor="endDate">
          <input
            ref={endDateRef}
            id="endDate"
            name="endDate"
            type="date"
            defaultValue={effectiveValues?.endDate ?? toDateInputValue(contract?.endDate)}
            className={inputClass}
          />
        </Field>

        <Field label="Renewal type" htmlFor="renewalType">
          <SelectWrapper>
            <select
              id="renewalType"
              name="renewalType"
              defaultValue={effectiveValues?.renewalType ?? contract?.renewalType ?? "MANUAL_RENEWAL"}
              className={selectClass}
            >
              {Object.entries(RENEWAL_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </SelectWrapper>
        </Field>

        <Field label="Notice period (days)" htmlFor="noticePeriodDays">
          <input
            id="noticePeriodDays"
            name="noticePeriodDays"
            type="number"
            min={0}
            defaultValue={effectiveValues?.noticePeriodDays ?? contract?.noticePeriodDays ?? ""}
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
            defaultValue={effectiveValues?.cost ?? contract?.cost ?? ""}
            className={inputClass}
          />
        </Field>

        <Field label="Currency" htmlFor="currency">
          <CurrencySelect
            name="currency"
            defaultValue={effectiveValues?.currency ?? contract?.currency ?? defaultCurrency}
          />
        </Field>

        <Field label="Billing frequency" htmlFor="billingFrequency">
          <SelectWrapper>
            <select
              ref={billingFrequencyRef}
              id="billingFrequency"
              name="billingFrequency"
              defaultValue={effectiveValues?.billingFrequency ?? contract?.billingFrequency ?? ""}
              className={selectClass}
            >
              <option value="">Not set</option>
              {Object.entries(BILLING_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </SelectWrapper>
        </Field>

        {contract && (
          <Field label="Status" htmlFor="status">
            <SelectWrapper>
              <select
                id="status"
                name="status"
                defaultValue={effectiveValues?.status ?? contract.status}
                className={selectClass}
              >
                <option value="ACTIVE">Active</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </SelectWrapper>
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
              defaultValue={effectiveValues?.contactName ?? contract?.contactName ?? ""}
              className={inputClass}
            />
          </Field>
          <Field label="Contact phone" htmlFor="contactPhone">
            <input
              ref={contactPhoneRef}
              id="contactPhone"
              name="contactPhone"
              defaultValue={effectiveValues?.contactPhone ?? contract?.contactPhone ?? ""}
              className={inputClass}
            />
          </Field>
          <Field label="Contact email" htmlFor="contactEmail">
            <input
              ref={contactEmailRef}
              id="contactEmail"
              name="contactEmail"
              type="email"
              defaultValue={effectiveValues?.contactEmail ?? contract?.contactEmail ?? ""}
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
          defaultValue={effectiveValues?.notes ?? contract?.notes ?? ""}
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
          defaultValue={effectiveValues?.reminderDaysBefore ?? contract?.reminderDaysBefore ?? ""}
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
            effectiveValues?.isTaxDeductible === "on"
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
        <SubmitButton>
          {pendingOp ? "Save changes" : contract ? "Save changes" : "Add contract"}
        </SubmitButton>
      </div>
    </form>
  );
}