"use client";

import { useId, useRef, useState } from "react";
import { Upload, FileText, X, Check, Loader2 } from "lucide-react";
import { importContract, importProduct, importInventoryItem, saveToInbox } from "@/lib/actions/import";
import { CATEGORY_LABELS } from "@/lib/utils";
import { INVENTORY_ITEM_CATEGORIES } from "@/lib/validation/inventory";
import { showToast } from "@/components/Toast";
import { extractionMessage } from "@/lib/autoFillHighlight";
import { buttonVariants, compactButtonClass } from "@/lib/buttonStyles";
import { cn } from "@/lib/utils";

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

interface Row {
  id: string;
  file: File;
  type: EntityType;
  status: RowStatus;
  error?: string;
  href?: string;
  scanMessage?: string;
  // Set once at scan time (matches ContractForm/ProductForm's own
  // extractionUsed flag) so the created record is held for review until the
  // user confirms it on its detail page — see extractionFieldsFromForm.
  extractionUsed: boolean;
  contract: ContractFields;
  product: ProductFields;
  inventory: InventoryFields;
  contractAutoFilled: Partial<Record<keyof ContractFields, boolean>>;
  productAutoFilled: Partial<Record<keyof ProductFields, boolean>>;
  inventoryAutoFilled: Partial<Record<keyof InventoryFields, boolean>>;
}

const EXTRACT_URLS: Partial<Record<EntityType, string>> = {
  CONTRACT: "/api/documents/extract",
  PRODUCT: "/api/products/extract",
  INVENTORY: "/api/inventory/extract",
};

let nextId = 0;

async function extract(type: EntityType, file: File) {
  const url = EXTRACT_URLS[type];
  if (!url) return { fields: {} as Record<string, string>, source: "none" as ExtractionSource };
  const body = new FormData();
  body.append("file", file);
  const res = await fetch(url, { method: "POST", body });
  if (!res.ok) return { fields: {} as Record<string, string>, source: "none" as ExtractionSource };
  const data = (await res.json()) as { fields: Record<string, string>; source?: ExtractionSource };
  return { fields: data.fields, source: data.source ?? "none" };
}

function fieldClass(autoFilled?: boolean) {
  return `rounded-md border px-2 py-1.5 text-sm outline-none focus:border-accent ${
    autoFilled ? "border-accent/40 bg-accent/5 ring-1 ring-accent/40" : "border-border bg-background"
  }`;
}

export function ImportClient({ enabledModules = [] }: { enabledModules?: string[] }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const inventoryEnabled = enabledModules.includes("INVENTORY");

  function updateRow(id: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  async function scanRow(id: string, type: EntityType, file: File) {
    if (type === "INBOX") {
      updateRow(id, { status: "ready", scanMessage: undefined });
      return;
    }
    updateRow(id, { status: "scanning" });
    const { fields, source } = await extract(type, file);
    const filledCount = Object.keys(fields).length;
    const scanMessage = extractionMessage(source, filledCount);
    const extractionUsed = filledCount > 0;
    if (type === "CONTRACT") {
      updateRow(id, {
        status: "ready",
        scanMessage,
        extractionUsed,
        contract: {
          title: fields.title ?? file.name.replace(/\.[^.]+$/, ""),
          provider: fields.provider ?? "",
          category: "OTHER",
          cost: fields.cost ?? "",
          startDate: fields.startDate ?? "",
          endDate: fields.endDate ?? "",
        },
        contractAutoFilled: {
          title: Boolean(fields.title),
          provider: Boolean(fields.provider),
          cost: Boolean(fields.cost),
          startDate: Boolean(fields.startDate),
          endDate: Boolean(fields.endDate),
        },
      });
    } else if (type === "PRODUCT") {
      updateRow(id, {
        status: "ready",
        scanMessage,
        extractionUsed,
        product: {
          description: fields.description ?? file.name.replace(/\.[^.]+$/, ""),
          manufacturer: fields.manufacturer ?? "",
          price: fields.price ?? "",
          purchaseDate: fields.purchaseDate ?? "",
          warrantyEndDate: "",
        },
        productAutoFilled: {
          description: Boolean(fields.description),
          manufacturer: Boolean(fields.manufacturer),
          price: Boolean(fields.price),
          purchaseDate: Boolean(fields.purchaseDate),
        },
      });
    } else {
      updateRow(id, {
        status: "ready",
        scanMessage,
        inventory: {
          label: fields.label ?? file.name.replace(/\.[^.]+$/, ""),
          category: fields.category ?? "OTHER",
          brand: fields.brand ?? "",
          purchasePrice: fields.purchasePrice ?? "",
        },
        inventoryAutoFilled: {
          label: Boolean(fields.label),
          category: Boolean(fields.category),
          brand: Boolean(fields.brand),
          purchasePrice: Boolean(fields.purchasePrice),
        },
      });
    }
  }

  function addFiles(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      const id = `row-${nextId++}`;
      const row: Row = {
        id,
        file,
        type: "CONTRACT",
        status: "scanning",
        extractionUsed: false,
        contract: { title: "", provider: "", category: "OTHER", cost: "", startDate: "", endDate: "" },
        product: { description: "", manufacturer: "", price: "", purchaseDate: "", warrantyEndDate: "" },
        inventory: { label: "", category: "OTHER", brand: "", purchasePrice: "" },
        contractAutoFilled: {},
        productAutoFilled: {},
        inventoryAutoFilled: {},
      };
      setRows((prev) => [...prev, row]);
      scanRow(id, "CONTRACT", file);
    }
  }

  function removeRow(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  async function saveRow(row: Row) {
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
      formData.append("extractionUsed", row.extractionUsed ? "1" : "0");
      formData.append("confirmExtraction", "0");
      result = await importContract(formData);
    } else if (row.type === "PRODUCT") {
      formData.append("description", row.product.description);
      formData.append("manufacturer", row.product.manufacturer);
      formData.append("price", row.product.price);
      formData.append("purchaseDate", row.product.purchaseDate);
      formData.append("warrantyEndDate", row.product.warrantyEndDate);
      formData.append("extractionUsed", row.extractionUsed ? "1" : "0");
      formData.append("confirmExtraction", "0");
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
    } else {
      updateRow(row.id, { status: "saved", href: result.href });
      showToast(`Saved ${row.file.name}`);
    }
  }

  async function saveAll() {
    for (const row of rows) {
      if (row.status === "ready" || row.status === "error") {
        await saveRow(row);
      }
    }
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
        className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-8 text-center transition has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent has-[:focus-visible]:outline-offset-2 ${
          dragOver ? "border-accent bg-accent/5" : "border-border hover:border-accent/50"
        }`}
      >
        <Upload size={22} className="text-muted" />
        <p className="text-sm font-medium">Drag a file here or click to browse</p>
        <p className="text-xs text-muted">Drop in more than one at a time if you have several — each is scanned and added to the queue below</p>
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
                className={cn(
                  "inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition",
                  buttonVariants.primary,
                )}
              >
                Save all ({readyCount})
              </button>
            )}
          </div>

          <div className="space-y-3">
            {rows.map((row) => (
              <div key={row.id} className="rounded-xl border border-border bg-surface p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <FileText size={16} className="shrink-0 text-muted" />
                    <span className="min-w-0 truncate text-sm font-medium">{row.file.name}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {row.status === "saved" ? (
                      <span className="flex items-center gap-1 text-xs text-success">
                        <Check size={14} /> Saved
                      </span>
                    ) : (
                      <>
                        <select
                          value={row.type}
                          disabled={row.status === "scanning" || row.status === "saving"}
                          onChange={(e) => {
                            const type = e.target.value as EntityType;
                            updateRow(row.id, { type });
                            scanRow(row.id, type, row.file);
                          }}
                          className="rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-accent"
                        >
                          <option value="CONTRACT">Contract</option>
                          <option value="PRODUCT">Product</option>
                          {inventoryEnabled && <option value="INVENTORY">Inventory item</option>}
                          <option value="INBOX">Not sure yet</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => removeRow(row.id)}
                          aria-label={`Remove ${row.file.name} from queue`}
                          className="rounded p-1 text-muted hover:text-danger"
                        >
                          <X size={14} />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {row.status === "scanning" && (
                  <p role="status" className="flex items-center gap-2 text-sm text-muted">
                    <Loader2 size={14} className="animate-spin" /> Scanning…
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
                          onChange={(e) =>
                            updateRow(row.id, {
                              contract: { ...row.contract, title: e.target.value },
                              contractAutoFilled: { ...row.contractAutoFilled, title: false },
                            })
                          }
                          className={fieldClass(row.contractAutoFilled.title)}
                        />
                      </RowField>
                      <RowField label="Provider" htmlFor={`${row.id}-provider`} autoFilled={row.contractAutoFilled.provider}>
                        <input
                          id={`${row.id}-provider`}
                          value={row.contract.provider}
                          disabled={row.status === "saving"}
                          onChange={(e) =>
                            updateRow(row.id, {
                              contract: { ...row.contract, provider: e.target.value },
                              contractAutoFilled: { ...row.contractAutoFilled, provider: false },
                            })
                          }
                          className={fieldClass(row.contractAutoFilled.provider)}
                        />
                      </RowField>
                      <RowField label="Category" htmlFor={`${row.id}-category`}>
                        <select
                          id={`${row.id}-category`}
                          value={row.contract.category}
                          disabled={row.status === "saving"}
                          onChange={(e) =>
                            updateRow(row.id, {
                              contract: { ...row.contract, category: e.target.value },
                            })
                          }
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
                          onChange={(e) =>
                            updateRow(row.id, {
                              contract: { ...row.contract, cost: e.target.value },
                              contractAutoFilled: { ...row.contractAutoFilled, cost: false },
                            })
                          }
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
                          onChange={(e) =>
                            updateRow(row.id, {
                              contract: { ...row.contract, startDate: e.target.value },
                              contractAutoFilled: { ...row.contractAutoFilled, startDate: false },
                            })
                          }
                          className={fieldClass(row.contractAutoFilled.startDate)}
                        />
                      </RowField>
                      <RowField label="End date" htmlFor={`${row.id}-endDate`} autoFilled={row.contractAutoFilled.endDate}>
                        <input
                          id={`${row.id}-endDate`}
                          type="date"
                          value={row.contract.endDate}
                          disabled={row.status === "saving"}
                          onChange={(e) =>
                            updateRow(row.id, {
                              contract: { ...row.contract, endDate: e.target.value },
                              contractAutoFilled: { ...row.contractAutoFilled, endDate: false },
                            })
                          }
                          className={fieldClass(row.contractAutoFilled.endDate)}
                        />
                      </RowField>
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
                          onChange={(e) =>
                            updateRow(row.id, {
                              product: { ...row.product, description: e.target.value },
                              productAutoFilled: { ...row.productAutoFilled, description: false },
                            })
                          }
                          className={fieldClass(row.productAutoFilled.description)}
                        />
                      </RowField>
                      <RowField label="Manufacturer" htmlFor={`${row.id}-manufacturer`} autoFilled={row.productAutoFilled.manufacturer}>
                        <input
                          id={`${row.id}-manufacturer`}
                          value={row.product.manufacturer}
                          disabled={row.status === "saving"}
                          onChange={(e) =>
                            updateRow(row.id, {
                              product: { ...row.product, manufacturer: e.target.value },
                              productAutoFilled: { ...row.productAutoFilled, manufacturer: false },
                            })
                          }
                          className={fieldClass(row.productAutoFilled.manufacturer)}
                        />
                      </RowField>
                      <RowField label="Price" htmlFor={`${row.id}-price`} autoFilled={row.productAutoFilled.price}>
                        <input
                          id={`${row.id}-price`}
                          value={row.product.price}
                          disabled={row.status === "saving"}
                          onChange={(e) =>
                            updateRow(row.id, {
                              product: { ...row.product, price: e.target.value },
                              productAutoFilled: { ...row.productAutoFilled, price: false },
                            })
                          }
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
                          onChange={(e) =>
                            updateRow(row.id, {
                              product: { ...row.product, purchaseDate: e.target.value },
                              productAutoFilled: { ...row.productAutoFilled, purchaseDate: false },
                            })
                          }
                          className={fieldClass(row.productAutoFilled.purchaseDate)}
                        />
                      </RowField>
                      <RowField label="Warranty end date" htmlFor={`${row.id}-warrantyEndDate`}>
                        <input
                          id={`${row.id}-warrantyEndDate`}
                          type="date"
                          value={row.product.warrantyEndDate}
                          disabled={row.status === "saving"}
                          onChange={(e) =>
                            updateRow(row.id, {
                              product: { ...row.product, warrantyEndDate: e.target.value },
                            })
                          }
                          className={fieldClass(false)}
                        />
                      </RowField>
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
                          onChange={(e) =>
                            updateRow(row.id, {
                              inventory: { ...row.inventory, label: e.target.value },
                              inventoryAutoFilled: { ...row.inventoryAutoFilled, label: false },
                            })
                          }
                          className={fieldClass(row.inventoryAutoFilled.label)}
                        />
                      </RowField>
                      <RowField label="Brand" htmlFor={`${row.id}-brand`} autoFilled={row.inventoryAutoFilled.brand}>
                        <input
                          id={`${row.id}-brand`}
                          value={row.inventory.brand}
                          disabled={row.status === "saving"}
                          onChange={(e) =>
                            updateRow(row.id, {
                              inventory: { ...row.inventory, brand: e.target.value },
                              inventoryAutoFilled: { ...row.inventoryAutoFilled, brand: false },
                            })
                          }
                          className={fieldClass(row.inventoryAutoFilled.brand)}
                        />
                      </RowField>
                      <RowField label="Category" htmlFor={`${row.id}-inv-category`} autoFilled={row.inventoryAutoFilled.category}>
                        <select
                          id={`${row.id}-inv-category`}
                          value={row.inventory.category}
                          disabled={row.status === "saving"}
                          onChange={(e) =>
                            updateRow(row.id, {
                              inventory: { ...row.inventory, category: e.target.value },
                              inventoryAutoFilled: { ...row.inventoryAutoFilled, category: false },
                            })
                          }
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
                          onChange={(e) =>
                            updateRow(row.id, {
                              inventory: { ...row.inventory, purchasePrice: e.target.value },
                              inventoryAutoFilled: { ...row.inventoryAutoFilled, purchasePrice: false },
                            })
                          }
                          inputMode="decimal"
                          className={fieldClass(row.inventoryAutoFilled.purchasePrice)}
                        />
                      </RowField>
                    </div>
                  )}

                {(row.status === "ready" || row.status === "saving" || row.status === "error") &&
                  row.type === "INBOX" && (
                    <p className="text-sm text-muted">
                      Saved to your inbox as-is — classify it as a contract, product, or other
                      record later from{" "}
                      <a href="/documents/inbox" className="text-accent hover:underline">
                        Needs review
                      </a>
                      .
                    </p>
                  )}

                {row.error && <p className="mt-2 text-xs text-danger">{row.error}</p>}

                {(row.status === "ready" || row.status === "error") && (
                  <button
                    type="button"
                    onClick={() => saveRow(row)}
                    className={`mt-3 ${compactButtonClass()}`}
                  >
                    Save
                  </button>
                )}
                {row.status === "saved" && row.href && (
                  <a href={row.href} className="mt-2 inline-block text-xs text-accent hover:underline">
                    View →
                  </a>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

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
    <div className="space-y-0.5">
      <label htmlFor={htmlFor} className="flex items-center gap-1 text-[11px] font-medium text-muted">
        {label}
        {autoFilled && (
          <>
            {/* #290: a colour tint/ring alone doesn't reach a screen reader
                or a colour-blind reviewer — this badge and the sr-only text
                that follows it do. */}
            <span aria-hidden="true" className="rounded bg-accent/10 px-1 py-0.5 text-[9px] font-medium text-accent">
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
