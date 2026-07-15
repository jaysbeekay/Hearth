"use client";

import { useActionState, useRef, useState } from "react";
import { Upload } from "lucide-react";
import type { InventoryItemModel } from "@/generated/prisma/models";
import type { ActionState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";
import { FormMessage } from "@/components/FormMessage";
import { INVENTORY_ITEM_CATEGORIES } from "@/lib/validation/inventory";
import { SelectWrapper, selectClass } from "@/components/SelectWrapper";
import { FileDropZone } from "@/components/FileDropZone";
import { markAutoFilled, extractionMessage } from "@/lib/autoFillHighlight";
import { makeOfflineAwareAction } from "@/lib/offlineQueue";

const CATEGORY_LABELS: Record<string, string> = {
  APPLIANCE: "Appliance",
  ELECTRONICS: "Electronics",
  FURNITURE: "Furniture",
  TOOL: "Tool",
  CLOTHING: "Clothing",
  SPORTING: "Sporting",
  BOOK: "Book",
  MEDIA: "Media",
  OTHER: "Other",
};

function toDateInputValue(date: Date | null | undefined) {
  if (!date) return "";
  return new Date(date).toISOString().slice(0, 10);
}

type ExtractedFields = Partial<Record<"category" | "label" | "brand" | "model" | "serialNumber" | "purchaseDate" | "purchasePrice", string>>;

export function InventoryItemForm({
  action,
  item,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  item?: InventoryItemModel;
}) {
  const offlineAwareAction = makeOfflineAwareAction(
    action,
    () => ({
      label: item ? `Update item: ${item.label}` : "Add inventory item",
      entity: "inventoryItem",
      operation: item ? "update" : "create",
      entityId: item?.id,
    }),
    { success: "Saved offline — will sync when you reconnect." },
  );

  const [state, formAction] = useActionState<ActionState, FormData>(offlineAwareAction, null);
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);

  const categoryRef = useRef<HTMLSelectElement>(null);
  const labelRef = useRef<HTMLInputElement>(null);
  const brandRef = useRef<HTMLInputElement>(null);
  const modelRef = useRef<HTMLInputElement>(null);
  const serialNumberRef = useRef<HTMLInputElement>(null);
  const purchaseDateRef = useRef<HTMLInputElement>(null);
  const purchasePriceRef = useRef<HTMLInputElement>(null);

  function applyExtractedFields(fields: ExtractedFields) {
    if (fields.category && categoryRef.current) {
      categoryRef.current.value = fields.category;
      markAutoFilled(categoryRef.current);
    }
    if (fields.label && labelRef.current && !labelRef.current.value) {
      labelRef.current.value = fields.label;
      markAutoFilled(labelRef.current);
    }
    if (fields.brand && brandRef.current) {
      brandRef.current.value = fields.brand;
      markAutoFilled(brandRef.current);
    }
    if (fields.model && modelRef.current) {
      modelRef.current.value = fields.model;
      markAutoFilled(modelRef.current);
    }
    if (fields.serialNumber && serialNumberRef.current) {
      serialNumberRef.current.value = fields.serialNumber;
      markAutoFilled(serialNumberRef.current);
    }
    if (fields.purchaseDate && purchaseDateRef.current) {
      purchaseDateRef.current.value = fields.purchaseDate;
      markAutoFilled(purchaseDateRef.current);
    }
    if (fields.purchasePrice && purchasePriceRef.current) {
      purchasePriceRef.current.value = fields.purchasePrice;
      markAutoFilled(purchasePriceRef.current);
    }
  }

  async function handleFileChange(file: File | null) {
    if (!file) return;

    setScanning(true);
    setScanMessage(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/inventory/extract", { method: "POST", body });
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

  return (
    <form action={formAction} className="space-y-6">
      {!item && (
        <div className="space-y-2 rounded-lg border border-dashed border-border p-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Upload size={16} />
            Save time: upload a receipt or invoice and Hearth fills in the details
          </p>
          <FileDropZone
            name="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx"
            onFileSelected={handleFileChange}
          />
          {scanning && (
            <p role="status" aria-live="polite" className="text-xs text-muted animate-pulse">
              Scanning document…
            </p>
          )}
          {scanMessage && (
            <p role="status" aria-live="polite" className="text-xs text-foreground/70">
              {scanMessage}
            </p>
          )}
        </div>
      )}

      <Field label="Label *" htmlFor="label">
        <input
          ref={labelRef}
          id="label"
          name="label"
          required
          defaultValue={state?.values?.label ?? item?.label ?? ""}
          placeholder="e.g. KitchenAid Stand Mixer"
          className={inputClass}
        />
      </Field>

      <Field label="Category" htmlFor="category">
        <SelectWrapper>
          <select
            ref={categoryRef}
            id="category"
            name="category"
            defaultValue={state?.values?.category ?? item?.category ?? "OTHER"}
            className={selectClass}
          >
            {INVENTORY_ITEM_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {CATEGORY_LABELS[cat] ?? cat}
              </option>
            ))}
          </select>
        </SelectWrapper>
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Brand / Manufacturer" htmlFor="brand">
          <input
            ref={brandRef}
            id="brand"
            name="brand"
            defaultValue={state?.values?.brand ?? item?.brand ?? ""}
            className={inputClass}
          />
        </Field>

        <Field label="Model" htmlFor="model">
          <input
            ref={modelRef}
            id="model"
            name="model"
            defaultValue={state?.values?.model ?? item?.model ?? ""}
            className={inputClass}
          />
        </Field>
      </div>

      <Field label="Serial Number" htmlFor="serialNumber">
        <input
          ref={serialNumberRef}
          id="serialNumber"
          name="serialNumber"
          defaultValue={state?.values?.serialNumber ?? item?.serialNumber ?? ""}
          className={inputClass}
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Purchase Date" htmlFor="purchaseDate">
          <input
            ref={purchaseDateRef}
            id="purchaseDate"
            name="purchaseDate"
            type="date"
            defaultValue={state?.values?.purchaseDate ?? toDateInputValue(item?.purchaseDate)}
            className={inputClass}
          />
        </Field>

        <Field label="Purchase Price" htmlFor="purchasePrice">
          <input
            ref={purchasePriceRef}
            id="purchasePrice"
            name="purchasePrice"
            type="number"
            step="0.01"
            min="0"
            defaultValue={state?.values?.purchasePrice ?? item?.purchasePrice?.toString() ?? ""}
            placeholder="0.00"
            className={inputClass}
          />
        </Field>
      </div>

      <Field label="Location" htmlFor="location">
        <input
          id="location"
          name="location"
          defaultValue={state?.values?.location ?? item?.location ?? ""}
          placeholder="e.g. Kitchen, Garage"
          className={inputClass}
        />
      </Field>

      <Field label="Notes" htmlFor="notes">
        <textarea
          id="notes"
          name="notes"
          rows={3}
          defaultValue={state?.values?.notes ?? item?.notes ?? ""}
          className={inputClass}
        />
      </Field>

      <FormMessage error={state?.error} success={state?.success} />

      <div className="flex justify-end gap-3">
        <SubmitButton>{item ? "Save changes" : "Add item"}</SubmitButton>
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
