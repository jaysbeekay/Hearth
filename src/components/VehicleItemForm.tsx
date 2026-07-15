"use client";

import { useActionState, useRef, useState } from "react";
import { Upload } from "lucide-react";
import type { VehicleItemModel } from "@/generated/prisma/models";
import type { ActionState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";
import { FormMessage } from "@/components/FormMessage";
import { VEHICLE_ITEM_TYPES } from "@/lib/validation/vehicles";
import { VEHICLE_ITEM_TYPE_LABELS } from "@/lib/utils";
import { SelectWrapper, selectClass } from "@/components/SelectWrapper";
import { CurrencySelect } from "@/components/CurrencySelect";
import { FileDropZone } from "@/components/FileDropZone";
import { makeOfflineAwareAction } from "@/lib/offlineQueue";
import { markAutoFilled, extractionMessage } from "@/lib/autoFillHighlight";

function toDateInputValue(date: Date | null | undefined) {
  if (!date) return "";
  return new Date(date).toISOString().slice(0, 10);
}

type ExtractedFields = Partial<Record<"type" | "title" | "provider" | "date" | "cost", string>>;

export function VehicleItemForm({
  action,
  item,
  vehicleId,
  defaultCurrency,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  item?: VehicleItemModel;
  vehicleId?: string;
  defaultCurrency?: string;
}) {
  const offlineAwareAction = makeOfflineAwareAction(
    action,
    () => ({
      label: item ? `Update record: ${item.title}` : "Add vehicle record",
      entity: "vehicleItem",
      operation: item ? "update" : "create",
      entityId: item?.id,
      parentId: item?.vehicleId ?? vehicleId,
      baseUpdatedAt: item?.updatedAt?.toISOString(),
    }),
    { success: "Saved offline — will sync when you reconnect." },
  );

  const [state, formAction] = useActionState<ActionState, FormData>(offlineAwareAction, null);
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);

  const typeRef = useRef<HTMLSelectElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const providerRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const costRef = useRef<HTMLInputElement>(null);

  function applyExtractedFields(fields: ExtractedFields) {
    if (fields.type && typeRef.current) {
      typeRef.current.value = fields.type;
      markAutoFilled(typeRef.current);
    }
    if (fields.title && titleRef.current && !titleRef.current.value) {
      titleRef.current.value = fields.title;
      markAutoFilled(titleRef.current);
    }
    if (fields.provider && providerRef.current) {
      providerRef.current.value = fields.provider;
      markAutoFilled(providerRef.current);
    }
    if (fields.date && dateRef.current) {
      dateRef.current.value = fields.date;
      markAutoFilled(dateRef.current);
    }
    if (fields.cost && costRef.current) {
      costRef.current.value = fields.cost;
      markAutoFilled(costRef.current);
    }
  }

  async function handleFileChange(file: File | null) {
    if (!file) return;

    setScanning(true);
    setScanMessage(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/vehicles/extract", { method: "POST", body });
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
      {!item && (
        <div className="space-y-2 rounded-lg border border-dashed border-border p-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Upload size={16} />
            Save time: upload a receipt or invoice and Hearth fills in the details
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
        <Field label="Type" htmlFor="type">
          <SelectWrapper>
            <select
              ref={typeRef}
              id="type"
              name="type"
              required
              defaultValue={state?.values?.type ?? item?.type ?? VEHICLE_ITEM_TYPES[0]}
              className={selectClass}
            >
              {VEHICLE_ITEM_TYPES.map((value) => (
                <option key={value} value={value}>
                  {VEHICLE_ITEM_TYPE_LABELS[value]}
                </option>
              ))}
            </select>
          </SelectWrapper>
        </Field>

        <Field label="Title" htmlFor="title">
          <input
            ref={titleRef}
            id="title"
            name="title"
            required
            defaultValue={state?.values?.title ?? item?.title}
            placeholder="e.g. 60,000 km service"
            className={inputClass}
          />
        </Field>

        <Field label="Provider" htmlFor="provider">
          <input
            ref={providerRef}
            id="provider"
            name="provider"
            defaultValue={state?.values?.provider ?? item?.provider ?? ""}
            placeholder="e.g. City Toyota"
            className={inputClass}
          />
        </Field>

        <Field label="Date" htmlFor="date">
          <input
            ref={dateRef}
            id="date"
            name="date"
            type="date"
            defaultValue={state?.values?.date ?? toDateInputValue(item?.date)}
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
            defaultValue={state?.values?.cost ?? item?.cost ?? ""}
            className={inputClass}
          />
        </Field>

        <Field label="Currency" htmlFor="currency">
          <CurrencySelect
            name="currency"
            defaultValue={state?.values?.currency ?? item?.currency ?? defaultCurrency}
          />
        </Field>
      </div>

      <Field label="Notes" htmlFor="notes">
        <textarea
          id="notes"
          name="notes"
          rows={4}
          defaultValue={state?.values?.notes ?? item?.notes ?? ""}
          className={inputClass}
        />
      </Field>

      <FormMessage error={state?.error} success={state?.success} />

      <div className="flex justify-end gap-3">
        <SubmitButton>{item ? "Save changes" : "Add record"}</SubmitButton>
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
