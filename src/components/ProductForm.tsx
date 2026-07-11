"use client";

import { useActionState, useRef, useState } from "react";
import { ScanBarcode, Upload } from "lucide-react";
import type { ProductModel } from "@/generated/prisma/models";
import type { ActionState } from "@/lib/actions/products";
import { SubmitButton } from "@/components/SubmitButton";
import { FormMessage } from "@/components/FormMessage";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { CurrencySelect } from "@/components/CurrencySelect";
import { FileDropZone } from "@/components/FileDropZone";
import { enqueueOperation, serializeFormData } from "@/lib/offlineQueue";

function toDateInputValue(date: Date | null | undefined) {
  if (!date) return "";
  return new Date(date).toISOString().slice(0, 10);
}

type ExtractedFields = Partial<
  Record<"name" | "manufacturer" | "vendor" | "serialNumber" | "purchaseDate" | "price", string>
>;

export function ProductForm({
  action,
  product,
  defaultCurrency,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  product?: ProductModel;
  defaultCurrency?: string;
}) {
  const offlineAwareAction = async (
    prevState: ActionState,
    formData: FormData,
  ): Promise<ActionState> => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      await enqueueOperation({
        label: product ? `Update product: ${product.name}` : "Add product",
        entity: "product",
        operation: product ? "update" : "create",
        entityId: product?.id,
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
  const [scannerOpen, setScannerOpen] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupMessage, setLookupMessage] = useState<string | null>(null);

  const nameRef = useRef<HTMLInputElement>(null);
  const manufacturerRef = useRef<HTMLInputElement>(null);
  const vendorRef = useRef<HTMLInputElement>(null);
  const serialNumberRef = useRef<HTMLInputElement>(null);
  const barcodeRef = useRef<HTMLInputElement>(null);
  const purchaseDateRef = useRef<HTMLInputElement>(null);
  const priceRef = useRef<HTMLInputElement>(null);

  function applyExtractedFields(fields: ExtractedFields) {
    if (fields.name && nameRef.current && !nameRef.current.value) {
      nameRef.current.value = fields.name;
    }
    if (fields.manufacturer && manufacturerRef.current) {
      manufacturerRef.current.value = fields.manufacturer;
    }
    if (fields.vendor && vendorRef.current) vendorRef.current.value = fields.vendor;
    if (fields.serialNumber && serialNumberRef.current) {
      serialNumberRef.current.value = fields.serialNumber;
    }
    if (fields.purchaseDate && purchaseDateRef.current) {
      purchaseDateRef.current.value = fields.purchaseDate;
    }
    if (fields.price && priceRef.current) priceRef.current.value = fields.price;
  }

  async function handleFileChange(file: File | null) {
    if (!file) return;

    setScanning(true);
    setScanMessage(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/products/extract", { method: "POST", body });
      if (!res.ok) throw new Error("Extraction failed");

      const { fields } = (await res.json()) as { fields: ExtractedFields };
      if (Object.keys(fields).length === 0) {
        setScanMessage("Couldn't detect any fields from this invoice — fill them in manually.");
      } else {
        applyExtractedFields(fields);
        setScanMessage("Fields populated from the invoice — review before saving.");
      }
    } catch {
      setScanMessage("Couldn't scan this invoice. You can still attach it and fill in fields manually.");
    } finally {
      setScanning(false);
    }
  }

  async function handleBarcodeLookup(codeOverride?: string) {
    const code = (codeOverride ?? barcodeRef.current?.value ?? "").trim();
    if (!code) return;

    setLookingUp(true);
    setLookupMessage(null);
    try {
      const res = await fetch(`/api/products/barcode?code=${encodeURIComponent(code)}`);
      if (res.status === 404) {
        setLookupMessage("Barcode saved. Automatic lookup isn't enabled on this server.");
        return;
      }
      if (!res.ok) {
        setLookupMessage("Couldn't look up this barcode. Fill in remaining details manually.");
        return;
      }

      const { fields, found } = (await res.json()) as { fields: ExtractedFields; found: boolean };
      if (found) {
        applyExtractedFields(fields);
        setLookupMessage("Fields populated from the barcode — review before saving.");
      } else {
        setLookupMessage("No product info found for this barcode.");
      }
    } catch {
      setLookupMessage("Couldn't look up this barcode. Fill in remaining details manually.");
    } finally {
      setLookingUp(false);
    }
  }

  function handleBarcodeDetected(code: string) {
    if (barcodeRef.current) barcodeRef.current.value = code;
    setScannerOpen(false);
    if (!product) handleBarcodeLookup(code);
  }

  return (
    <form action={formAction} className="space-y-6">
      {!product && (
        <div className="space-y-4">
          <div className="space-y-2 rounded-lg border border-dashed border-border p-4">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Upload size={16} />
              Upload an invoice to auto-fill fields (optional)
            </p>
            <FileDropZone name="invoiceFile" onFileSelected={handleFileChange} />
            {scanning && (
              <p role="status" aria-live="polite" className="text-sm text-foreground/60">
                Scanning invoice…
              </p>
            )}
            {!scanning && scanMessage && (
              <p role="status" aria-live="polite" className="text-sm text-foreground/60">
                {scanMessage}
              </p>
            )}
          </div>

          <div className="space-y-2 rounded-lg border border-dashed border-border p-4">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Upload size={16} />
              Upload a photo of the product (optional)
            </p>
            <FileDropZone name="photoFile" accept="image/*" label="Drag a photo here or click to browse" hint="JPG, PNG, or WEBP — up to 15MB" />
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Product name" htmlFor="name">
          <input
            ref={nameRef}
            id="name"
            name="name"
            required
            defaultValue={state?.values?.name ?? product?.name}
            placeholder="e.g. Samsung 65-inch QLED TV"
            className={inputClass}
          />
        </Field>

        <Field label="Manufacturer" htmlFor="manufacturer">
          <input
            ref={manufacturerRef}
            id="manufacturer"
            name="manufacturer"
            defaultValue={state?.values?.manufacturer ?? product?.manufacturer ?? ""}
            placeholder="e.g. Samsung"
            className={inputClass}
          />
        </Field>

        <Field label="Vendor / retailer" htmlFor="vendor">
          <input
            ref={vendorRef}
            id="vendor"
            name="vendor"
            defaultValue={state?.values?.vendor ?? product?.vendor ?? ""}
            placeholder="e.g. JB Hi-Fi"
            className={inputClass}
          />
        </Field>

        <Field label="Serial number" htmlFor="serialNumber">
          <input
            ref={serialNumberRef}
            id="serialNumber"
            name="serialNumber"
            defaultValue={state?.values?.serialNumber ?? product?.serialNumber ?? ""}
            className={inputClass}
          />
        </Field>

        <Field label="Barcode (UPC/EAN)" htmlFor="barcode">
          <div className="flex gap-2">
            <input
              ref={barcodeRef}
              id="barcode"
              name="barcode"
              defaultValue={state?.values?.barcode ?? product?.barcode ?? ""}
              placeholder="e.g. 9310036001234"
              className={inputClass}
            />
            <button
              type="button"
              onClick={() => setScannerOpen(true)}
              aria-label="Scan barcode"
              title="Scan barcode"
              className="flex items-center justify-center rounded-lg border border-border px-3 hover:bg-black/5 dark:hover:bg-white/5"
            >
              <ScanBarcode size={16} />
            </button>
          </div>
          {!product && (
            <button
              type="button"
              onClick={() => handleBarcodeLookup()}
              disabled={lookingUp}
              className="mt-1 text-xs font-medium text-accent hover:underline disabled:opacity-50"
            >
              {lookingUp ? "Looking up…" : "Look up product info"}
            </button>
          )}
          {lookupMessage && <p className="mt-1 text-sm text-foreground/60">{lookupMessage}</p>}
        </Field>

        <Field label="Purchase date" htmlFor="purchaseDate">
          <input
            ref={purchaseDateRef}
            id="purchaseDate"
            name="purchaseDate"
            type="date"
            defaultValue={state?.values?.purchaseDate ?? toDateInputValue(product?.purchaseDate)}
            className={inputClass}
          />
        </Field>

        <Field label="Warranty end date" htmlFor="warrantyEndDate">
          <input
            id="warrantyEndDate"
            name="warrantyEndDate"
            type="date"
            defaultValue={
              state?.values?.warrantyEndDate ?? toDateInputValue(product?.warrantyEndDate)
            }
            className={inputClass}
          />
        </Field>

        <Field label="Price" htmlFor="price">
          <input
            ref={priceRef}
            id="price"
            name="price"
            type="number"
            min={0}
            step="0.01"
            defaultValue={state?.values?.price ?? product?.price ?? ""}
            className={inputClass}
          />
        </Field>

        <Field label="Currency" htmlFor="currency">
          <CurrencySelect
            name="currency"
            defaultValue={state?.values?.currency ?? product?.currency ?? defaultCurrency}
          />
        </Field>
      </div>

      <Field label="Notes" htmlFor="notes">
        <textarea
          id="notes"
          name="notes"
          rows={4}
          defaultValue={state?.values?.notes ?? product?.notes ?? ""}
          className={inputClass}
        />
      </Field>

      <Field
        label="Remind me before warranty expiry (days, comma-separated)"
        htmlFor="reminderDaysBefore"
      >
        <input
          id="reminderDaysBefore"
          name="reminderDaysBefore"
          defaultValue={state?.values?.reminderDaysBefore ?? product?.reminderDaysBefore ?? ""}
          placeholder="30,14,7,1"
          className={inputClass}
        />
      </Field>

      <FormMessage error={state?.error} success={state?.success} />

      <div className="flex justify-end gap-3">
        <SubmitButton>{product ? "Save changes" : "Add product"}</SubmitButton>
      </div>

      {scannerOpen && (
        <BarcodeScanner
          onDetected={handleBarcodeDetected}
          onClose={() => setScannerOpen(false)}
        />
      )}
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
