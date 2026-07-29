"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { addMonths } from "date-fns";
import { ScanBarcode, Upload } from "lucide-react";
import type { ProductModel } from "@/generated/prisma/models";
import type { ActionState } from "@/lib/actions/products";
import { SubmitButton } from "@/components/SubmitButton";
import { FormMessage } from "@/components/FormMessage";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { CurrencySelect } from "@/components/CurrencySelect";
import { FileDropZone } from "@/components/FileDropZone";
import {
  makeOfflineAwareAction,
  getOperationById,
  updateOperationFormValues,
  serializeFormData,
  type QueuedOperation,
} from "@/lib/offlineQueue";
import { Field } from "@/components/FormField";
import { SelectWrapper, inputClass, selectClass } from "@/components/SelectWrapper";
import { markAutoFilled, extractionMessage } from "@/lib/autoFillHighlight";

function toDateInputValue(date: Date | null | undefined) {
  if (!date) return "";
  return new Date(date).toISOString().slice(0, 10);
}

type ExtractedFields = Partial<
  Record<"description" | "manufacturer" | "model" | "vendor" | "serialNumber" | "purchaseDate" | "price", string>
>;

export function ProductForm({
  action,
  product,
  defaultCurrency,
  properties = [],
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  product?: ProductModel;
  defaultCurrency?: string;
  properties?: { id: string; label: string }[];
}) {
  const offlineAwareAction = makeOfflineAwareAction(
    action,
    () => ({
      label: product ? `Update product: ${product.description}` : "Add product",
      entity: "product",
      operation: product ? "update" : "create",
      entityId: product?.id,
      baseUpdatedAt: product?.updatedAt?.toISOString(),
    }),
    { success: "Saved offline — will sync when you reconnect." },
  );

  const [state, formAction] = useActionState<ActionState, FormData>(offlineAwareAction, null);
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupMessage, setLookupMessage] = useState<string | null>(null);

  const router = useRouter();
  const pendingOpId = useSearchParams().get("pendingOpId");
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
    router.push("/products");
  }

  const descriptionRef = useRef<HTMLInputElement>(null);
  const manufacturerRef = useRef<HTMLInputElement>(null);
  const modelRef = useRef<HTMLInputElement>(null);
  const vendorRef = useRef<HTMLInputElement>(null);
  const serialNumberRef = useRef<HTMLInputElement>(null);
  const barcodeRef = useRef<HTMLInputElement>(null);
  const purchaseDateRef = useRef<HTMLInputElement>(null);
  const warrantyEndDateRef = useRef<HTMLInputElement>(null);
  const priceRef = useRef<HTMLInputElement>(null);

  function suggestWarrantyEndDate() {
    const warrantyEndDateInput = warrantyEndDateRef.current;
    if (!purchaseDateRef.current?.value || !warrantyEndDateInput || warrantyEndDateInput.value) return;
    const purchaseDate = new Date(purchaseDateRef.current.value);
    if (Number.isNaN(purchaseDate.getTime())) return;
    warrantyEndDateInput.value = toDateInputValue(addMonths(purchaseDate, 12));
    markAutoFilled(warrantyEndDateInput);
  }

  function applyExtractedFields(fields: ExtractedFields) {
    if (fields.description && descriptionRef.current && !descriptionRef.current.value) {
      descriptionRef.current.value = fields.description;
      markAutoFilled(descriptionRef.current);
    }
    if (fields.manufacturer && manufacturerRef.current) {
      manufacturerRef.current.value = fields.manufacturer;
      markAutoFilled(manufacturerRef.current);
    }
    if (fields.model && modelRef.current) {
      modelRef.current.value = fields.model;
      markAutoFilled(modelRef.current);
    }
    if (fields.vendor && vendorRef.current) {
      vendorRef.current.value = fields.vendor;
      markAutoFilled(vendorRef.current);
    }
    if (fields.serialNumber && serialNumberRef.current) {
      serialNumberRef.current.value = fields.serialNumber;
      markAutoFilled(serialNumberRef.current);
    }
    if (fields.purchaseDate && purchaseDateRef.current) {
      purchaseDateRef.current.value = fields.purchaseDate;
      markAutoFilled(purchaseDateRef.current);
      suggestWarrantyEndDate();
    }
    if (fields.price && priceRef.current) {
      priceRef.current.value = fields.price;
      markAutoFilled(priceRef.current);
    }
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

      const { fields, source } = (await res.json()) as {
        fields: ExtractedFields;
        source: "byok" | "heuristic" | "llm" | "none";
      };
      const filledCount = Object.keys(fields).length;
      if (filledCount > 0) applyExtractedFields(fields);
      setScanMessage(extractionMessage(source, filledCount));
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

      const { fields, found, reason } = (await res.json()) as {
        fields: ExtractedFields;
        found: boolean;
        reason?: "not_found" | "rate_limited" | "network_error";
      };
      if (found) {
        applyExtractedFields(fields);
        setLookupMessage("Fields populated from the barcode — review before saving.");
      } else if (reason === "rate_limited") {
        setLookupMessage(
          "Barcode lookup is rate-limited right now — try again shortly, or fill in details manually.",
        );
      } else if (reason === "network_error") {
        setLookupMessage("Couldn't reach the barcode lookup service. Fill in remaining details manually.");
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
      {!product && (
        <div className="space-y-4">
          <div className="space-y-2 rounded-lg border border-dashed border-border p-4">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Upload size={16} />
              Save time: upload an invoice and Hearth fills in the details
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
        <Field label="Description" htmlFor="description" required>
          <input
            ref={descriptionRef}
            id="description"
            name="description"
            required
            defaultValue={effectiveValues?.description ?? product?.description}
            placeholder="e.g. 65-inch QLED TV"
            className={inputClass}
          />
        </Field>

        <Field label="Brand" htmlFor="manufacturer">
          <input
            ref={manufacturerRef}
            id="manufacturer"
            name="manufacturer"
            defaultValue={effectiveValues?.manufacturer ?? product?.manufacturer ?? ""}
            placeholder="e.g. Samsung"
            className={inputClass}
          />
        </Field>

        <Field label="Model" htmlFor="model">
          <input
            ref={modelRef}
            id="model"
            name="model"
            defaultValue={effectiveValues?.model ?? product?.model ?? ""}
            placeholder="e.g. QN65Q80"
            className={inputClass}
          />
        </Field>

        <Field label="Vendor / retailer" htmlFor="vendor">
          <input
            ref={vendorRef}
            id="vendor"
            name="vendor"
            defaultValue={effectiveValues?.vendor ?? product?.vendor ?? ""}
            placeholder="e.g. JB Hi-Fi"
            className={inputClass}
          />
        </Field>

        <Field label="Serial number" htmlFor="serialNumber">
          <input
            ref={serialNumberRef}
            id="serialNumber"
            name="serialNumber"
            defaultValue={effectiveValues?.serialNumber ?? product?.serialNumber ?? ""}
            className={inputClass}
          />
        </Field>

        <Field label="Barcode (UPC/EAN)" htmlFor="barcode">
          <div className="flex gap-2">
            <input
              ref={barcodeRef}
              id="barcode"
              name="barcode"
              defaultValue={effectiveValues?.barcode ?? product?.barcode ?? ""}
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
            defaultValue={effectiveValues?.purchaseDate ?? toDateInputValue(product?.purchaseDate)}
            onChange={suggestWarrantyEndDate}
            className={inputClass}
          />
        </Field>

        <Field label="Warranty end date" htmlFor="warrantyEndDate">
          <input
            ref={warrantyEndDateRef}
            id="warrantyEndDate"
            name="warrantyEndDate"
            type="date"
            defaultValue={
              effectiveValues?.warrantyEndDate ?? toDateInputValue(product?.warrantyEndDate)
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
            defaultValue={effectiveValues?.price ?? product?.price ?? ""}
            className={inputClass}
          />
        </Field>

        <Field label="Currency" htmlFor="currency">
          <CurrencySelect
            name="currency"
            defaultValue={effectiveValues?.currency ?? product?.currency ?? defaultCurrency}
          />
        </Field>

        {properties.length > 0 && (
          <Field label="Property" htmlFor="propertyId">
            <SelectWrapper>
              <select
                id="propertyId"
                name="propertyId"
                defaultValue={effectiveValues?.propertyId ?? product?.propertyId ?? ""}
                className={selectClass}
              >
                <option value="">Not linked to a property</option>
                {properties.map((property) => (
                  <option key={property.id} value={property.id}>
                    {property.label}
                  </option>
                ))}
              </select>
            </SelectWrapper>
          </Field>
        )}
      </div>

      <Field label="Notes" htmlFor="notes">
        <textarea
          id="notes"
          name="notes"
          rows={4}
          defaultValue={effectiveValues?.notes ?? product?.notes ?? ""}
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
          defaultValue={effectiveValues?.reminderDaysBefore ?? product?.reminderDaysBefore ?? ""}
          placeholder="30,14,7,1"
          className={inputClass}
        />
      </Field>

      <FormMessage error={state?.error} success={state?.success} />

      <div className="flex justify-end gap-3">
        <SubmitButton>{pendingOp || product ? "Save changes" : "Add product"}</SubmitButton>
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
