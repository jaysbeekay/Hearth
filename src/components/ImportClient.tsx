"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, FileText, X, Check, Loader2 } from "lucide-react";
import { importContract, importProduct, importInventoryItem, saveToInbox } from "@/lib/actions/import";
import { CATEGORY_LABELS } from "@/lib/utils";
import { INVENTORY_ITEM_CATEGORIES } from "@/lib/validation/inventory";
import { showToast } from "@/components/Toast";
import { LinkedToField } from "@/components/LinkedToField";
import { extractionMessage } from "@/lib/autoFillHighlight";
import { extractionReviewedOnSave } from "@/lib/documents/extractionConfirmation";
import { buttonClass, pillClass, inputClass, inlineLinkClass, reviewFieldClass } from "@/lib/ui";
import { Card } from "@/components/ui/Card";

const INVENTORY_CATEGORY_LABELS: Record<string, string> = {
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

type EntityType = "CONTRACT" | "PRODUCT" | "INVENTORY" | "INBOX";
type RowStatus = "scanning" | "ready" | "saving" | "saved" | "error";
type ExtractionSource = "byok" | "heuristic" | "llm" | "none";

interface ContractFields {
  title: string;
  provider: string;
  category: string;
  cost: string;
  startDate: string;
  endDate: string;
}

interface ProductFields {
  description: string;
  manufacturer: string;
  price: string;
  purchaseDate: string;
  warrantyEndDate: string;
}

interface InventoryFields {
  label: string;
  category: string;
  brand: string;
  purchasePrice: string;
}

interface BulkPatch {
  type: EntityType | "";
  category: string;
  /** "property:<id>", "vehicle:<id>", "none:" to clear, or "" for no change. */
  link: string;
}

const EMPTY_BULK: BulkPatch = { type: "", category: "", link: "" };

interface Row {
  id: string;
  file: File;
  type: EntityType;
  status: RowStatus;
  error?: string;
  href?: string;
  scanMessage?: string;
  source: ExtractionSource;
  // Set once at scan time (matches ContractForm/ProductForm's own
  // extractionUsed flag) so the created record is held for review until the
  // user confirms it on its detail page — see extractionFieldsFromForm.
  extractionUsed: boolean;
  // #359 — the person changed a field or link on this row before saving.
  edited?: boolean;
  // #358 — the one scan's source and message for each type the row could be
  // filed as, so switching type never scans again.
  sources: Partial<Record<EntityType, ExtractionSource>>;
  scanMessages: Partial<Record<EntityType, string>>;
  /** #358 — ticked for "Apply to selected". */
  selected?: boolean;
  /** Bumped by "Apply to selected" so the (uncontrolled) Linked to field shows the new link. */
  linkVersion: number;
  /** Set once saved, for the review screen. */
  recordId?: string;
  contract: ContractFields;
  // #327 — link a filed policy/warranty to a home or vehicle during review,
  // instead of only being settable later via Edit. Kept outside
  // ContractFields/ProductFields since it's a user selection, not an
  // extracted field (appendReviewFields only tracks the latter).
  contractPropertyId: string;
  contractVehicleId: string;
  product: ProductFields;
  productPropertyId: string;
  inventory: InventoryFields;
  contractAutoFilled: Partial<Record<keyof ContractFields, boolean>>;
  productAutoFilled: Partial<Record<keyof ProductFields, boolean>>;
  inventoryAutoFilled: Partial<Record<keyof InventoryFields, boolean>>;
}

let nextId = 0;

type ScanResult = { fields: Record<string, string>; source: ExtractionSource };

interface ImportScan {
  guessedType: "CONTRACT" | "PRODUCT" | "INVENTORY" | null;
  results: Partial<Record<"CONTRACT" | "PRODUCT" | "INVENTORY", ScanResult>>;
  textUnavailable: boolean;
}

// #358 — one scan per file: its type is guessed and fields come back for
// every type it could be filed as (src/lib/documents/importExtraction.ts).
async function scanFile(file: File): Promise<ImportScan | null> {
  const body = new FormData();
  body.append("file", file);
  try {
    const res = await fetch("/api/import/extract", { method: "POST", body });
    if (!res.ok) return null;
    return (await res.json()) as ImportScan;
  } catch {
    return null;
  }
}

/** Where "Save all" goes when some records were saved with details to check (#358). */
export function reviewScreenHref(added: number) {
  return `/review?added=${added}`;
}

/** The row filed as `type`: that type's scan source, message and auto-filled state (#358). */
function withType(row: Row, type: EntityType): Row {
  const autoFilled =
    type === "CONTRACT"
      ? row.contractAutoFilled
      : type === "PRODUCT"
        ? row.productAutoFilled
        : type === "INVENTORY"
          ? row.inventoryAutoFilled
          : {};
  return {
    ...row,
    type,
    source: type === "INBOX" ? "none" : (row.sources[type] ?? "none"),
    extractionUsed: Object.values(autoFilled).some(Boolean),
    scanMessage: type === "INBOX" ? undefined : row.scanMessages[type],
  };
}

/** Whether a saved row's record is held for a quick check (it was saved unconfirmed). */
function needsCheck(row: Row) {
  if (row.type === "CONTRACT") return row.extractionUsed && !confirmedOnSave(row, row.contractAutoFilled);
  if (row.type === "PRODUCT") return row.extractionUsed && !confirmedOnSave(row, row.productAutoFilled);
  return false;
}

function confirmedOnSave(row: Row, autoFilled: Partial<Record<string, boolean>>) {
  return extractionReviewedOnSave({
    edited: row.edited === true,
    source: row.source,
    autoFilledCount: Object.values(autoFilled).filter(Boolean).length,
  });
}

function fieldClass(autoFilled?: boolean) {
  return reviewFieldClass(autoFilled ? "extracted" : "none");
}

function appendReviewFields(
  formData: FormData,
  fields: ContractFields | ProductFields | InventoryFields,
  autoFilled: Partial<Record<string, boolean>>,
  source: ExtractionSource,
) {
  const reviewFields = Object.entries(autoFilled)
    .filter(([, used]) => used)
    .map(([fieldName]) => ({
      fieldName,
      value: fields[fieldName as keyof typeof fields] ?? "",
      source,
      confidence: source === "none" ? 0 : source === "heuristic" ? 0.7 : 0.85,
    }));
  if (reviewFields.length > 0) {
    formData.append("extractionReviewFields", JSON.stringify(reviewFields));
  }
}

export function ImportClient({
  enabledModules = [],
  properties = [],
  vehicles = [],
}: {
  enabledModules?: string[];
  properties?: { id: string; label: string }[];
  vehicles?: { id: string; label: string }[];
}) {
  const homeEnabled = enabledModules.includes("HOME");
  const vehiclesEnabled = enabledModules.includes("VEHICLES");
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [bulk, setBulk] = useState<BulkPatch>(EMPTY_BULK);
  const [dragOver, setDragOver] = useState(false);
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const inventoryEnabled = enabledModules.includes("INVENTORY");

  function updateRow(id: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  // #359 — a change the person made to a row (not the scan filling it in):
  // a row someone has worked on saves as reviewed.
  function editRow(id: string, patch: Partial<Row>) {
    updateRow(id, { ...patch, edited: true });
  }

  async function scanRow(id: string, file: File) {
    updateRow(id, { status: "scanning" });
    const scan = await scanFile(file);
    const baseName = file.name.replace(/\.[^.]+$/, "");
    const empty: ScanResult = { fields: {}, source: "none" };
    const c = scan?.results.CONTRACT ?? empty;
    const p = scan?.results.PRODUCT ?? empty;
    const inv = scan?.results.INVENTORY ?? empty;
    const textUnavailable = scan?.textUnavailable === true;
    const message = (r: ScanResult) => extractionMessage(r.source, Object.keys(r.fields).length, textUnavailable);
    const guessed = scan?.guessedType === "INVENTORY" && !inventoryEnabled ? "PRODUCT" : scan?.guessedType;
    const type: EntityType = guessed ?? "CONTRACT";
    const sources = { CONTRACT: c.source, PRODUCT: p.source, INVENTORY: inv.source };
    const scanMessages = { CONTRACT: message(c), PRODUCT: message(p), INVENTORY: message(inv) };
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const next: Row = {
          ...r,
          status: "ready",
          sources,
          scanMessages,
          contract: {
            title: c.fields.title ?? baseName,
            provider: c.fields.provider ?? "",
            category: "OTHER",
            cost: c.fields.cost ?? "",
            startDate: c.fields.startDate ?? "",
            endDate: c.fields.endDate ?? "",
          },
          contractAutoFilled: {
            title: Boolean(c.fields.title),
            provider: Boolean(c.fields.provider),
            cost: Boolean(c.fields.cost),
            startDate: Boolean(c.fields.startDate),
            endDate: Boolean(c.fields.endDate),
          },
          product: {
            description: p.fields.description ?? baseName,
            manufacturer: p.fields.manufacturer ?? "",
            price: p.fields.price ?? "",
            purchaseDate: p.fields.purchaseDate ?? "",
            warrantyEndDate: "",
          },
          productAutoFilled: {
            description: Boolean(p.fields.description),
            manufacturer: Boolean(p.fields.manufacturer),
            price: Boolean(p.fields.price),
            purchaseDate: Boolean(p.fields.purchaseDate),
          },
          inventory: {
            label: inv.fields.label ?? baseName,
            category: inv.fields.category ?? "OTHER",
            brand: inv.fields.brand ?? "",
            purchasePrice: inv.fields.purchasePrice ?? "",
          },
          inventoryAutoFilled: {
            label: Boolean(inv.fields.label),
            category: Boolean(inv.fields.category),
            brand: Boolean(inv.fields.brand),
            purchasePrice: Boolean(inv.fields.purchasePrice),
          },
        };
        return withType(next, type);
      }),
    );
  }

  function addFiles(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      const id = `row-${nextId++}`;
      const row: Row = {
        id,
        file,
        type: "CONTRACT",
        status: "scanning",
        source: "none",
        extractionUsed: false,
        sources: {},
        scanMessages: {},
        linkVersion: 0,
        contract: { title: "", provider: "", category: "OTHER", cost: "", startDate: "", endDate: "" },
        contractPropertyId: "",
        contractVehicleId: "",
        product: { description: "", manufacturer: "", price: "", purchaseDate: "", warrantyEndDate: "" },
        productPropertyId: "",
        inventory: { label: "", category: "OTHER", brand: "", purchasePrice: "" },
        contractAutoFilled: {},
        productAutoFilled: {},
        inventoryAutoFilled: {},
      };
      setRows((prev) => [...prev, row]);
      scanRow(id, file);
    }
  }

  function removeRow(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  // `quiet`: Save all reports once at the end instead of a toast per file.
  async function saveRow(row: Row, quiet = false): Promise<boolean> {
    updateRow(row.id, { status: "saving", error: undefined });
    const formData = new FormData();
    formData.append("file", row.file);
    let result;
    if (row.type === "CONTRACT") {
      formData.append("title", row.contract.title);
      formData.append("provider", row.contract.provider);
      formData.append("category", row.contract.category);
      formData.append("renewalType", "MANUAL_RENEWAL");
      formData.append("cost", row.contract.cost);
      formData.append("startDate", row.contract.startDate);
      formData.append("endDate", row.contract.endDate);
      if (row.contractPropertyId) formData.append("propertyId", row.contractPropertyId);
      if (row.contractVehicleId) formData.append("vehicleId", row.contractVehicleId);
      formData.append("extractionUsed", row.extractionUsed ? "1" : "0");
      formData.append("confirmExtraction", confirmedOnSave(row, row.contractAutoFilled) ? "1" : "0");
      appendReviewFields(formData, row.contract, row.contractAutoFilled, row.source);
      result = await importContract(formData);
    } else if (row.type === "PRODUCT") {
      formData.append("description", row.product.description);
      formData.append("manufacturer", row.product.manufacturer);
      formData.append("price", row.product.price);
      formData.append("purchaseDate", row.product.purchaseDate);
      formData.append("warrantyEndDate", row.product.warrantyEndDate);
      if (row.productPropertyId) formData.append("propertyId", row.productPropertyId);
      formData.append("extractionUsed", row.extractionUsed ? "1" : "0");
      formData.append("confirmExtraction", confirmedOnSave(row, row.productAutoFilled) ? "1" : "0");
      appendReviewFields(formData, row.product, row.productAutoFilled, row.source);
      result = await importProduct(formData);
    } else if (row.type === "INVENTORY") {
      formData.append("label", row.inventory.label);
      formData.append("category", row.inventory.category);
      formData.append("brand", row.inventory.brand);
      formData.append("purchasePrice", row.inventory.purchasePrice);
      result = await importInventoryItem(formData);
    } else {
      result = await saveToInbox(formData);
    }
    if (result.error) {
      updateRow(row.id, { status: "error", error: result.error });
      showToast(`${row.file.name}: ${result.error}`, "error");
      return false;
    }
    updateRow(row.id, { status: "saved", href: result.href, recordId: result.id });
    if (!quiet) showToast(`Saved ${row.file.name}`);
    return true;
  }

  // #358 — saves every ready row, then lands on the one review screen when
  // any record was saved with details to check; otherwise just says so.
  async function saveAll() {
    let added = 0;
    let toCheck = 0;
    for (const row of rows) {
      if (row.status === "ready" || row.status === "error") {
        if (await saveRow(row, true)) {
          added += 1;
          if (needsCheck(row)) toCheck += 1;
        }
      }
    }
    if (toCheck > 0) {
      router.push(reviewScreenHref(added));
    } else if (added > 0) {
      showToast(`${added} ${added === 1 ? "record" : "records"} added.`);
    }
  }

  // #358 — "Apply to selected": a type, Contract category or link set on
  // every ticked row at once. It isn't a review of the row's scanned
  // details, so it doesn't count as an edit (#359).
  const pendingRows = rows.filter((r) => r.status === "ready" || r.status === "error");
  const selectedRows = pendingRows.filter((r) => r.selected);
  function applyToSelected() {
    setRows((prev) =>
      prev.map((r) => {
        if (!r.selected || !(r.status === "ready" || r.status === "error")) return r;
        let next = bulk.type ? withType(r, bulk.type) : r;
        if (bulk.category) next = { ...next, contract: { ...next.contract, category: bulk.category } };
        if (bulk.link) {
          const [kind, id] = bulk.link.split(":");
          const propertyId = kind === "property" ? id : "";
          const vehicleId = kind === "vehicle" ? id : "";
          next = {
            ...next,
            contractPropertyId: propertyId,
            contractVehicleId: vehicleId,
            productPropertyId: propertyId,
            linkVersion: next.linkVersion + 1,
          };
        }
        return next;
      }),
    );
    showToast(`Applied to ${selectedRows.length} ${selectedRows.length === 1 ? "file" : "files"}.`);
  }

  const readyCount = rows.filter((r) => r.status === "ready").length;

  return (
    <div className="space-y-6">
      <label
        htmlFor={inputId}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed p-8 text-center transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent has-[:focus-visible]:outline-offset-2 ${
          dragOver ? "border-accent bg-accent/5" : "border-border hover:border-accent/50"
        }`}
      >
        <Upload size={20} className="text-muted" />
        <p className="text-sm font-medium">Drag a file here or click to browse</p>
        <p className="text-xs text-muted">Drop in more than one at a time if you have several — each is scanned and added to the list below</p>
        {/* #285 — capture-time disclosure that this isn't private storage. */}
        <p className="text-xs text-muted">Visible to your whole household once saved.</p>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          multiple
          accept=".pdf,.doc,.docx,image/*"
          className="sr-only"
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </label>

      {rows.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted">
              {rows.length} {rows.length === 1 ? "file" : "files"} queued
            </p>
            {readyCount > 1 && (
              <button
                type="button"
                onClick={saveAll}
                className={buttonClass("primary")}
              >
                Save all ({readyCount})
              </button>
            )}
          </div>

          {pendingRows.length > 1 && (
            <Card className="space-y-3" aria-label="Apply to selected files">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={selectedRows.length === pendingRows.length}
                    onChange={(e) => {
                      const selected = e.target.checked;
                      setRows((prev) =>
                        prev.map((r) => (r.status === "ready" || r.status === "error" ? { ...r, selected } : r)),
                      );
                    }}
                  />
                  Select all ({selectedRows.length} of {pendingRows.length} selected)
                </label>
              </div>
              <div className="grid gap-2 sm:grid-cols-4 sm:items-end">
                <div className={ROW_FIELD_WRAPPER}>
                  <label htmlFor={`${inputId}-bulk-type`} className={ROW_FIELD_LABEL}>
                    File as
                  </label>
                  <select
                    id={`${inputId}-bulk-type`}
                    value={bulk.type}
                    onChange={(e) => setBulk({ ...bulk, type: e.target.value as BulkPatch["type"] })}
                    className={fieldClass(false)}
                  >
                    <option value="">No change</option>
                    <option value="CONTRACT">Contract</option>
                    <option value="PRODUCT">Warranty</option>
                    {inventoryEnabled && <option value="INVENTORY">Inventory item</option>}
                    <option value="INBOX">Save to review later</option>
                  </select>
                </div>
                <div className={ROW_FIELD_WRAPPER}>
                  <label htmlFor={`${inputId}-bulk-category`} className={ROW_FIELD_LABEL}>
                    Contract category
                  </label>
                  <select
                    id={`${inputId}-bulk-category`}
                    value={bulk.category}
                    onChange={(e) => setBulk({ ...bulk, category: e.target.value })}
                    className={fieldClass(false)}
                  >
                    <option value="">No change</option>
                    {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                {(homeEnabled || vehiclesEnabled) && (properties.length > 0 || vehicles.length > 0) && (
                  <div className={ROW_FIELD_WRAPPER}>
                    <label htmlFor={`${inputId}-bulk-link`} className={ROW_FIELD_LABEL}>
                      Linked to
                    </label>
                    <select
                      id={`${inputId}-bulk-link`}
                      value={bulk.link}
                      onChange={(e) => setBulk({ ...bulk, link: e.target.value })}
                      className={fieldClass(false)}
                    >
                      <option value="">No change</option>
                      <option value="none:">Nothing</option>
                      {homeEnabled &&
                        properties.map((p) => (
                          <option key={p.id} value={`property:${p.id}`}>
                            {p.label}
                          </option>
                        ))}
                      {vehiclesEnabled &&
                        vehicles.map((v) => (
                          <option key={v.id} value={`vehicle:${v.id}`}>
                            {v.label}
                          </option>
                        ))}
                    </select>
                  </div>
                )}
                <button
                  type="button"
                  onClick={applyToSelected}
                  disabled={selectedRows.length === 0 || (!bulk.type && !bulk.category && !bulk.link)}
                  className={`${buttonClass("secondary")} disabled:opacity-50`}
                >
                  Apply to selected
                </button>
              </div>
            </Card>
          )}

          <div className="space-y-3">
            {rows.map((row) => (
              <Card key={row.id}>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    {pendingRows.length > 1 && (row.status === "ready" || row.status === "error") && (
                      <input
                        type="checkbox"
                        checked={row.selected === true}
                        onChange={(e) => updateRow(row.id, { selected: e.target.checked })}
                        aria-label={`Select ${row.file.name}`}
                      />
                    )}
                    <FileText size={16} className="shrink-0 text-muted" />
                    <span className="min-w-0 truncate text-sm font-medium">{row.file.name}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {row.status === "saved" ? (
                      <span className="flex items-center gap-1 text-xs text-success">
                        <Check size={16} /> Saved
                      </span>
                    ) : (
                      <>
                        <select
                          aria-label={`File ${row.file.name} as`}
                          value={row.type}
                          disabled={row.status === "scanning" || row.status === "saving"}
                          onChange={(e) => {
                            // #358 — the scan already covered every type.
                            const type = e.target.value as EntityType;
                            setRows((prev) => prev.map((r) => (r.id === row.id ? withType(r, type) : r)));
                          }}
                          className={inputClass}
                        >
                          <option value="CONTRACT">Contract</option>
                          <option value="PRODUCT">Warranty</option>
                          {inventoryEnabled && <option value="INVENTORY">Inventory item</option>}
                          <option value="INBOX">Save to review later</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => removeRow(row.id)}
                          aria-label={`Remove ${row.file.name} from queue`}
                          className={buttonClass("quiet", { icon: true }, "text-muted hover:text-danger")}
                        >
                          <X size={16} />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {row.status === "scanning" && (
                  <p role="status" className="flex items-center gap-2 text-sm text-muted">
                    <Loader2 size={16} className="animate-spin" /> Scanning…
                  </p>
                )}

                {row.scanMessage && row.status !== "scanning" && (
                  <p role="status" aria-live="polite" className="mb-2 text-xs text-muted">
                    {row.scanMessage}
                  </p>
                )}

                {(row.status === "ready" || row.status === "saving" || row.status === "error") &&
                  row.type === "CONTRACT" && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <RowField label="Title" htmlFor={`${row.id}-title`} autoFilled={row.contractAutoFilled.title}>
                        <input
                          id={`${row.id}-title`}
                          value={row.contract.title}
                          disabled={row.status === "saving"}
                          onChange={(e) => {
                            editRow(row.id, {
                              contract: { ...row.contract, title: e.target.value },
                              contractAutoFilled: { ...row.contractAutoFilled, title: false },
                            });
                          }}
                          className={fieldClass(row.contractAutoFilled.title)}
                        />
                      </RowField>
                      <RowField label="Provider" htmlFor={`${row.id}-provider`} autoFilled={row.contractAutoFilled.provider}>
                        <input
                          id={`${row.id}-provider`}
                          value={row.contract.provider}
                          disabled={row.status === "saving"}
                          onChange={(e) => {
                            editRow(row.id, {
                              contract: { ...row.contract, provider: e.target.value },
                              contractAutoFilled: { ...row.contractAutoFilled, provider: false },
                            });
                          }}
                          className={fieldClass(row.contractAutoFilled.provider)}
                        />
                      </RowField>
                      <RowField label="Category" htmlFor={`${row.id}-category`}>
                        <select
                          id={`${row.id}-category`}
                          value={row.contract.category}
                          disabled={row.status === "saving"}
                          onChange={(e) => {
                            editRow(row.id, {
                              contract: { ...row.contract, category: e.target.value },
                            });
                          }}
                          className={fieldClass(false)}
                        >
                          {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </RowField>
                      <RowField label="Cost" htmlFor={`${row.id}-cost`} autoFilled={row.contractAutoFilled.cost}>
                        <input
                          id={`${row.id}-cost`}
                          value={row.contract.cost}
                          disabled={row.status === "saving"}
                          onChange={(e) => {
                            editRow(row.id, {
                              contract: { ...row.contract, cost: e.target.value },
                              contractAutoFilled: { ...row.contractAutoFilled, cost: false },
                            });
                          }}
                          inputMode="decimal"
                          className={fieldClass(row.contractAutoFilled.cost)}
                        />
                      </RowField>
                      <RowField label="Start date" htmlFor={`${row.id}-startDate`} autoFilled={row.contractAutoFilled.startDate}>
                        <input
                          id={`${row.id}-startDate`}
                          type="date"
                          value={row.contract.startDate}
                          disabled={row.status === "saving"}
                          onChange={(e) => {
                            editRow(row.id, {
                              contract: { ...row.contract, startDate: e.target.value },
                              contractAutoFilled: { ...row.contractAutoFilled, startDate: false },
                            });
                          }}
                          className={fieldClass(row.contractAutoFilled.startDate)}
                        />
                      </RowField>
                      <RowField label="End date" htmlFor={`${row.id}-endDate`} autoFilled={row.contractAutoFilled.endDate}>
                        <input
                          id={`${row.id}-endDate`}
                          type="date"
                          value={row.contract.endDate}
                          disabled={row.status === "saving"}
                          onChange={(e) => {
                            editRow(row.id, {
                              contract: { ...row.contract, endDate: e.target.value },
                              contractAutoFilled: { ...row.contractAutoFilled, endDate: false },
                            });
                          }}
                          className={fieldClass(row.contractAutoFilled.endDate)}
                        />
                      </RowField>
                      <LinkedToField
                        key={`${row.id}-contractLink-${row.linkVersion}`}
                        defaultValue={{ propertyId: row.contractPropertyId, vehicleId: row.contractVehicleId }}
                        id={`${row.id}-contractLink`}
                        properties={properties}
                        vehicles={vehicles}
                        homeEnabled={homeEnabled}
                        vehiclesEnabled={vehiclesEnabled}
                        recordNoun="contract"
                        disabled={row.status === "saving"}
                        onChange={({ propertyId, vehicleId }) => {
                          editRow(row.id, { contractPropertyId: propertyId, contractVehicleId: vehicleId });
                        }}
                        hintLinksInNewTab
                        wrapperClassName={ROW_FIELD_WRAPPER}
                        labelClassName={ROW_FIELD_LABEL}
                        selectClassName={fieldClass(false)}
                      />
                    </div>
                  )}

                {(row.status === "ready" || row.status === "saving" || row.status === "error") &&
                  row.type === "PRODUCT" && (
                    <div className="grid gap-2 sm:grid-cols-3">
                      <RowField label="Description" htmlFor={`${row.id}-description`} autoFilled={row.productAutoFilled.description}>
                        <input
                          id={`${row.id}-description`}
                          value={row.product.description}
                          disabled={row.status === "saving"}
                          onChange={(e) => {
                            editRow(row.id, {
                              product: { ...row.product, description: e.target.value },
                              productAutoFilled: { ...row.productAutoFilled, description: false },
                            });
                          }}
                          className={fieldClass(row.productAutoFilled.description)}
                        />
                      </RowField>
                      <RowField label="Manufacturer" htmlFor={`${row.id}-manufacturer`} autoFilled={row.productAutoFilled.manufacturer}>
                        <input
                          id={`${row.id}-manufacturer`}
                          value={row.product.manufacturer}
                          disabled={row.status === "saving"}
                          onChange={(e) => {
                            editRow(row.id, {
                              product: { ...row.product, manufacturer: e.target.value },
                              productAutoFilled: { ...row.productAutoFilled, manufacturer: false },
                            });
                          }}
                          className={fieldClass(row.productAutoFilled.manufacturer)}
                        />
                      </RowField>
                      <RowField label="Price" htmlFor={`${row.id}-price`} autoFilled={row.productAutoFilled.price}>
                        <input
                          id={`${row.id}-price`}
                          value={row.product.price}
                          disabled={row.status === "saving"}
                          onChange={(e) => {
                            editRow(row.id, {
                              product: { ...row.product, price: e.target.value },
                              productAutoFilled: { ...row.productAutoFilled, price: false },
                            });
                          }}
                          inputMode="decimal"
                          className={fieldClass(row.productAutoFilled.price)}
                        />
                      </RowField>
                      <RowField label="Purchase date" htmlFor={`${row.id}-purchaseDate`} autoFilled={row.productAutoFilled.purchaseDate}>
                        <input
                          id={`${row.id}-purchaseDate`}
                          type="date"
                          value={row.product.purchaseDate}
                          disabled={row.status === "saving"}
                          onChange={(e) => {
                            editRow(row.id, {
                              product: { ...row.product, purchaseDate: e.target.value },
                              productAutoFilled: { ...row.productAutoFilled, purchaseDate: false },
                            });
                          }}
                          className={fieldClass(row.productAutoFilled.purchaseDate)}
                        />
                      </RowField>
                      <RowField label="Warranty end date" htmlFor={`${row.id}-warrantyEndDate`}>
                        <input
                          id={`${row.id}-warrantyEndDate`}
                          type="date"
                          value={row.product.warrantyEndDate}
                          disabled={row.status === "saving"}
                          onChange={(e) => {
                            editRow(row.id, {
                              product: { ...row.product, warrantyEndDate: e.target.value },
                            });
                          }}
                          className={fieldClass(false)}
                        />
                      </RowField>
                      <LinkedToField
                        key={`${row.id}-productLink-${row.linkVersion}`}
                        defaultValue={{ propertyId: row.productPropertyId }}
                        id={`${row.id}-productLink`}
                        properties={properties}
                        homeEnabled={homeEnabled}
                        recordNoun="warranty"
                        disabled={row.status === "saving"}
                        onChange={({ propertyId }) => {
                          editRow(row.id, { productPropertyId: propertyId });
                        }}
                        hintLinksInNewTab
                        wrapperClassName={ROW_FIELD_WRAPPER}
                        labelClassName={ROW_FIELD_LABEL}
                        selectClassName={fieldClass(false)}
                      />
                    </div>
                  )}

                {(row.status === "ready" || row.status === "saving" || row.status === "error") &&
                  row.type === "INVENTORY" && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <RowField label="Label" htmlFor={`${row.id}-label`} autoFilled={row.inventoryAutoFilled.label}>
                        <input
                          id={`${row.id}-label`}
                          value={row.inventory.label}
                          disabled={row.status === "saving"}
                          onChange={(e) => {
                            editRow(row.id, {
                              inventory: { ...row.inventory, label: e.target.value },
                              inventoryAutoFilled: { ...row.inventoryAutoFilled, label: false },
                            });
                          }}
                          className={fieldClass(row.inventoryAutoFilled.label)}
                        />
                      </RowField>
                      <RowField label="Brand" htmlFor={`${row.id}-brand`} autoFilled={row.inventoryAutoFilled.brand}>
                        <input
                          id={`${row.id}-brand`}
                          value={row.inventory.brand}
                          disabled={row.status === "saving"}
                          onChange={(e) => {
                            editRow(row.id, {
                              inventory: { ...row.inventory, brand: e.target.value },
                              inventoryAutoFilled: { ...row.inventoryAutoFilled, brand: false },
                            });
                          }}
                          className={fieldClass(row.inventoryAutoFilled.brand)}
                        />
                      </RowField>
                      <RowField label="Category" htmlFor={`${row.id}-inv-category`} autoFilled={row.inventoryAutoFilled.category}>
                        <select
                          id={`${row.id}-inv-category`}
                          value={row.inventory.category}
                          disabled={row.status === "saving"}
                          onChange={(e) => {
                            editRow(row.id, {
                              inventory: { ...row.inventory, category: e.target.value },
                              inventoryAutoFilled: { ...row.inventoryAutoFilled, category: false },
                            });
                          }}
                          className={fieldClass(row.inventoryAutoFilled.category)}
                        >
                          {INVENTORY_ITEM_CATEGORIES.map((cat) => (
                            <option key={cat} value={cat}>
                              {INVENTORY_CATEGORY_LABELS[cat] ?? cat}
                            </option>
                          ))}
                        </select>
                      </RowField>
                      <RowField label="Purchase price" htmlFor={`${row.id}-purchasePrice`} autoFilled={row.inventoryAutoFilled.purchasePrice}>
                        <input
                          id={`${row.id}-purchasePrice`}
                          value={row.inventory.purchasePrice}
                          disabled={row.status === "saving"}
                          onChange={(e) => {
                            editRow(row.id, {
                              inventory: { ...row.inventory, purchasePrice: e.target.value },
                              inventoryAutoFilled: { ...row.inventoryAutoFilled, purchasePrice: false },
                            });
                          }}
                          inputMode="decimal"
                          className={fieldClass(row.inventoryAutoFilled.purchasePrice)}
                        />
                      </RowField>
                    </div>
                  )}

                {(row.status === "ready" || row.status === "saving" || row.status === "error") &&
                  row.type === "INBOX" && (
                    <p className="text-sm text-muted">
                      Saved to the Inbox as-is — say whether it&apos;s a contract, warranty or other
                      record later from{" "}
                      <a href="/documents/inbox" className={inlineLinkClass}>
                        Inbox
                      </a>
                      .
                    </p>
                  )}

                {row.error && <p className="mt-2 text-xs text-danger">{row.error}</p>}

                {(row.status === "ready" || row.status === "error") && (
                  <button
                    type="button"
                    onClick={() => saveRow(row)}
                    className={`mt-3 ${buttonClass("secondary")}`}
                  >
                    Save
                  </button>
                )}
                {row.status === "saved" && row.href && (
                  <a href={row.href} className="mt-2 inline-block text-xs text-accent hover:underline">
                    View →
                  </a>
                )}
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const ROW_FIELD_WRAPPER = "space-y-0.5";
const ROW_FIELD_LABEL = "flex items-center gap-1 text-xs font-medium text-muted";

function RowField({
  label,
  htmlFor,
  autoFilled,
  children,
}: {
  label: string;
  htmlFor: string;
  autoFilled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={ROW_FIELD_WRAPPER}>
      <label htmlFor={htmlFor} className={ROW_FIELD_LABEL}>
        {label}
        {autoFilled && (
          <>
            {/* #290: a colour tint/ring alone doesn't reach a screen reader
                or a colour-blind reviewer — this badge and the sr-only text
                that follows it do. */}
            <span aria-hidden="true" className={pillClass("accent")}>
              Auto
            </span>
            <span className="sr-only">(auto-filled from document — review before saving)</span>
          </>
        )}
      </label>
      {children}
    </div>
  );
}
