"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { addMonths } from "date-fns";
import { ScanBarcode, Upload } from "lucide-react";
import type { ProductModel } from "@/generated/prisma/models";
import type { ActionState } from "@/lib/actions/products";
import { SubmitButton } from "@/components/SubmitButton";
import { FormActions } from "@/components/FormActions";
import { ReminderThresholdsField, hasOwnThresholds } from "@/components/ReminderThresholdsField";
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
import { FormSection, hasAnyValue } from "@/components/FormSection";
import { inputClass, textareaClass, selectClass } from "@/components/SelectWrapper";
import { LinkedToField } from "@/components/LinkedToField";
import { applyIfEmpty, markAutoFilled, extractionMessage } from "@/lib/autoFillHighlight";
import { DateInput } from "@/components/DateInput";
import { bannerClass, buttonClass } from "@/lib/ui";
import { Card } from "@/components/ui/Card";

function toDateInputValue(date: Date | null | undefined) {
  if (!date) return "";
  return new Date(date).toISOString().slice(0, 10);
}

type ExtractedFields = Partial<
  Record<"description" | "manufacturer" | "model" | "vendor" | "serialNumber" | "purchaseDate" | "price", string>
>;

export function ProductForm({
  action,
  cancelHref,
  defaultReminderDays,
  product,
  defaultCurrency,
  properties = [],
  homeEnabled = false,
  barcodeLookupEnabled = false,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  /** Where Cancel goes: the same place as the page's BackLink. */
  cancelHref: string;
  /** #360 — the household's default Reminder thresholds, for the presets. */
  defaultReminderDays: string;
  product?: ProductModel;
  defaultCurrency?: string;
  properties?: { id: string; label: string }[];
  homeEnabled?: boolean;
  /** #349 — only offer "Look up barcode" when the server can do it. */
  barcodeLookupEnabled?: boolean;
}) {
  const offlineAwareAction = makeOfflineAwareAction(
    action,
    () => ({
      label: product ? `Update warranty: ${product.description}` : "Add warranty",
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
  // #200: same pattern as ContractForm — see extractionFieldsFromForm in
  // src/lib/actions/products.ts. Both invoice scan and barcode lookup can
  // populate critical fields, so both count as "extraction used".
  const [extractionUsed, setExtractionUsed] = useState(false);
  const [confirmExtraction, setConfirmExtraction] = useState(false);

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
    applyIfEmpty(descriptionRef.current, fields.description);
    applyIfEmpty(manufacturerRef.current, fields.manufacturer);
    applyIfEmpty(modelRef.current, fields.model);
    applyIfEmpty(vendorRef.current, fields.vendor);
    applyIfEmpty(serialNumberRef.current, fields.serialNumber);
    if (fields.purchaseDate && purchaseDateRef.current && !purchaseDateRef.current.value) {
      purchaseDateRef.current.value = fields.purchaseDate;
      markAutoFilled(purchaseDateRef.current);
      suggestWarrantyEndDate();
    }
    applyIfEmpty(priceRef.current, fields.price);
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

      const { fields, source, textUnavailable } = (await res.json()) as {
        fields: ExtractedFields;
        source: "byok" | "heuristic" | "llm" | "none";
        textUnavailable?: boolean;
      };
      const filledCount = Object.keys(fields).length;
      if (filledCount > 0) {
        applyExtractedFields(fields);
        setExtractionUsed(true);
      }
      setScanMessage(extractionMessage(source, filledCount, textUnavailable));
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
        setExtractionUsed(true);
        setLookupMessage("Fields populated from the barcode — review before saving.");
      } else if (reason === "rate_limited") {
        setLookupMessage(
          "Barcode lookup is rate-limited right now — try again shortly, or fill in details manually.",
        );
      } else if (reason === "network_error") {
        setLookupMessage("Couldn't reach the barcode lookup service. Fill in remaining details manually.");
      } else {
        setLookupMessage("Nothing found for this barcode.");
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
    if (!product && barcodeLookupEnabled) handleBarcodeLookup(code);
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
        <p className={bannerClass("warning")}>
          Editing an offline entry that hasn&apos;t synced yet — saving updates it in place.
        </p>
      )}
      {!product && (
        <div>
          <Card className="space-y-2">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Upload size={16} />
              Save time: upload an invoice and Hearth fills in the details
            </p>
            <FileDropZone name="invoiceFile" onFileSelected={handleFileChange} />
            {scanning && (
              <p role="status" aria-live="polite" className="text-sm text-muted">
                Scanning invoice…
              </p>
            )}
            {!scanning && scanMessage && (
              <p role="status" aria-live="polite" className="text-sm text-muted">
                {scanMessage}
              </p>
            )}
          </Card>
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

        <Field label="Purchase date" htmlFor="purchaseDate">
          <DateInput
            ref={purchaseDateRef}
            id="purchaseDate"
            name="purchaseDate"
            defaultValue={effectiveValues?.purchaseDate ?? toDateInputValue(product?.purchaseDate)}
            onChange={suggestWarrantyEndDate}
            className={inputClass}
          />
        </Field>

        <Field label="Warranty end date" htmlFor="warrantyEndDate">
          <DateInput
            ref={warrantyEndDateRef}
            id="warrantyEndDate"
            name="warrantyEndDate"
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
      </div>

      {/* #361 — the dates and price that drive Reminders and Spend stay above. */}
      <FormSection
        title="More details"
        hint="Model, serial, retailer, notes"
        defaultOpen={hasAnyValue([
          effectiveValues?.model ?? product?.model,
          effectiveValues?.vendor ?? product?.vendor,
          effectiveValues?.serialNumber ?? product?.serialNumber,
          effectiveValues?.barcode ?? product?.barcode,
          effectiveValues?.propertyId ?? product?.propertyId,
          effectiveValues?.notes ?? product?.notes,
        ])}
      >
        <div className="grid gap-4 md:grid-cols-2">
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
                className={buttonClass("secondary")}
              >
                <ScanBarcode size={16} />
              </button>
            </div>
            {!product && barcodeLookupEnabled && (
              <button
                type="button"
                onClick={() => handleBarcodeLookup()}
                disabled={lookingUp}
                className="mt-1 text-xs font-medium text-accent hover:underline disabled:opacity-50"
              >
                {lookingUp ? "Looking up…" : "Look up barcode"}
              </button>
            )}
            {lookupMessage && <p className="mt-1 text-sm text-muted">{lookupMessage}</p>}
          </Field>

          <LinkedToField
            id="linkedTo"
            properties={properties}
            homeEnabled={homeEnabled}
            recordNoun="warranty"
            defaultValue={{ propertyId: effectiveValues?.propertyId ?? product?.propertyId ?? "" }}
            withHiddenInputs
            selectClassName={selectClass}
            chevron
          />
        </div>
        <Field label="Notes" htmlFor="notes">
          <textarea
            id="notes"
            name="notes"
            rows={4}
            defaultValue={effectiveValues?.notes ?? product?.notes ?? ""}
            className={textareaClass}
          />
        </Field>
        {!product && (
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Upload size={16} />
              Photo of the product (optional)
            </p>
            <FileDropZone
              name="photoFile"
              accept="image/*"
              label="Drag a photo here or click to browse"
              hint="JPG, PNG, or WEBP — up to 15MB"
            />
          </div>
        )}
      </FormSection>

      <FormSection
        title="Reminders"
        hint="Household default unless changed"
        defaultOpen={hasOwnThresholds(
          effectiveValues?.reminderDaysBefore ?? product?.reminderDaysBefore,
          defaultReminderDays,
        )}
      >
        <ReminderThresholdsField
          defaultValue={effectiveValues?.reminderDaysBefore ?? product?.reminderDaysBefore ?? ""}
          householdDefault={defaultReminderDays}
          before="the warranty ends"
          srOnlyLegend
        />
      </FormSection>

      {extractionUsed && (
        <div className={bannerClass("neutral", "flex items-start gap-2")}>
          <input
            id="confirmExtractionCheckbox"
            type="checkbox"
            checked={confirmExtraction}
            onChange={(e) => setConfirmExtraction(e.target.checked)}
            className="mt-0.5 size-4 rounded border-border accent-accent"
          />
          <label htmlFor="confirmExtractionCheckbox" className="text-sm">
            I&apos;ve checked the highlighted fields above and they&apos;re correct. Leave this
            unchecked to save anyway — the record will be marked{" "}
            <span className="font-medium">Needs review</span> and reminders will be held until
            it&apos;s confirmed.
          </label>
        </div>
      )}
      <input type="hidden" name="extractionUsed" value={extractionUsed ? "1" : "0"} />
      <input type="hidden" name="confirmExtraction" value={confirmExtraction ? "1" : "0"} />

      <FormMessage attempt={state} error={state?.error} success={state?.success} />

      <FormActions cancelHref={cancelHref}>
        <SubmitButton>{pendingOp || product ? "Save changes" : "Add warranty"}</SubmitButton>
      </FormActions>

      {scannerOpen && (
        <BarcodeScanner
          onDetected={handleBarcodeDetected}
          onClose={() => setScannerOpen(false)}
        />
      )}
    </form>
  );
}
