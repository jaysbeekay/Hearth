"use client";

import { useEffect, useState } from "react";
import { FileText, X, Loader2 } from "lucide-react";
import { classifyInboxDocument, discardInboxDocument } from "@/lib/actions/import";
import { CATEGORY_LABELS, humanFileSize, formatDate } from "@/lib/utils";
import { INVENTORY_ITEM_CATEGORIES } from "@/lib/validation/inventory";
import { showToast } from "@/components/Toast";
import { extractionMessage } from "@/lib/autoFillHighlight";

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

export interface InboxDocSummary {
  id: string;
  filename: string;
  size: number;
  uploadedAt: string;
  downloadHref: string;
}

type EntityType = "CONTRACT" | "PRODUCT" | "INVENTORY";
type ExtractionSource = "byok" | "heuristic" | "llm" | "none";

interface ContractFields {
  title: string;
  provider: string;
  category: string;
  cost: string;
}
interface ProductFields {
  name: string;
  manufacturer: string;
  price: string;
}
interface InventoryFields {
  label: string;
  category: string;
  brand: string;
  purchasePrice: string;
}

interface RowState {
  status: "scanning" | "ready" | "saving" | "error";
  type: EntityType;
  error?: string;
  scanMessage?: string;
  contract: ContractFields;
  product: ProductFields;
  inventory: InventoryFields;
  contractAutoFilled: Partial<Record<keyof ContractFields, boolean>>;
  productAutoFilled: Partial<Record<keyof ProductFields, boolean>>;
  inventoryAutoFilled: Partial<Record<keyof InventoryFields, boolean>>;
}

function emptyRowState(): RowState {
  return {
    status: "scanning",
    type: "CONTRACT",
    contract: { title: "", provider: "", category: "OTHER", cost: "" },
    product: { name: "", manufacturer: "", price: "" },
    inventory: { label: "", category: "OTHER", brand: "", purchasePrice: "" },
    contractAutoFilled: {},
    productAutoFilled: {},
    inventoryAutoFilled: {},
  };
}

function fieldClass(autoFilled?: boolean) {
  return `rounded-md border px-2 py-1.5 text-sm outline-none focus:border-accent ${
    autoFilled ? "border-accent/40 bg-accent/5 ring-1 ring-accent/40" : "border-border bg-background"
  }`;
}

function RowField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-0.5">
      <label htmlFor={htmlFor} className="block text-[11px] font-medium text-muted">
        {label}
      </label>
      {children}
    </div>
  );
}

async function previewFields(docId: string, type: EntityType, filename: string) {
  const res = await fetch(`/api/documents/inbox/${docId}/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target: type }),
  });
  if (!res.ok) return { fields: {} as Record<string, string>, source: "none" as ExtractionSource };
  const data = (await res.json()) as { fields: Record<string, string>; source?: ExtractionSource };
  return { fields: data.fields, source: data.source ?? "none", fallbackName: filename.replace(/\.[^.]+$/, "") };
}

export function InboxReviewClient({
  docs,
  dateFormat,
  inventoryEnabled,
}: {
  docs: InboxDocSummary[];
  dateFormat?: string;
  inventoryEnabled: boolean;
}) {
  const [visibleIds, setVisibleIds] = useState(() => docs.map((d) => d.id));
  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(docs.map((d) => [d.id, emptyRowState()])),
  );

  useEffect(() => {
    // Deferred one tick so the initial scan (which sets state) isn't a
    // direct call from the effect body — rows already start in "scanning"
    // via emptyRowState(), this just kicks off the actual fetches.
    queueMicrotask(() => {
      for (const doc of docs) {
        scan(doc.id, "CONTRACT", doc.filename);
      }
    });
  }, []);

  function updateRow(id: string, patch: Partial<RowState>) {
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  async function scan(id: string, type: EntityType, filename: string) {
    updateRow(id, { status: "scanning" });
    const { fields, source } = await previewFields(id, type, filename);
    const filledCount = Object.keys(fields).length;
    const scanMessage = extractionMessage(source, filledCount);
    if (type === "CONTRACT") {
      updateRow(id, {
        status: "ready",
        scanMessage,
        contract: {
          title: fields.title ?? filename.replace(/\.[^.]+$/, ""),
          provider: fields.provider ?? "",
          category: "OTHER",
          cost: fields.cost ?? "",
        },
        contractAutoFilled: {
          title: Boolean(fields.title),
          provider: Boolean(fields.provider),
          cost: Boolean(fields.cost),
        },
      });
    } else if (type === "PRODUCT") {
      updateRow(id, {
        status: "ready",
        scanMessage,
        product: {
          name: fields.name ?? filename.replace(/\.[^.]+$/, ""),
          manufacturer: fields.manufacturer ?? "",
          price: fields.price ?? "",
        },
        productAutoFilled: {
          name: Boolean(fields.name),
          manufacturer: Boolean(fields.manufacturer),
          price: Boolean(fields.price),
        },
      });
    } else {
      updateRow(id, {
        status: "ready",
        scanMessage,
        inventory: {
          label: fields.label ?? filename.replace(/\.[^.]+$/, ""),
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

  async function classify(doc: InboxDocSummary) {
    const row = rows[doc.id];
    updateRow(doc.id, { status: "saving", error: undefined });
    const fields = new FormData();
    if (row.type === "CONTRACT") {
      fields.append("title", row.contract.title);
      fields.append("provider", row.contract.provider);
      fields.append("category", row.contract.category);
      fields.append("renewalType", "MANUAL_RENEWAL");
      fields.append("cost", row.contract.cost);
    } else if (row.type === "PRODUCT") {
      fields.append("name", row.product.name);
      fields.append("manufacturer", row.product.manufacturer);
      fields.append("price", row.product.price);
    } else {
      fields.append("label", row.inventory.label);
      fields.append("category", row.inventory.category);
      fields.append("brand", row.inventory.brand);
      fields.append("purchasePrice", row.inventory.purchasePrice);
    }

    const result = await classifyInboxDocument(doc.id, row.type, fields);
    if (result.error) {
      updateRow(doc.id, { status: "error", error: result.error });
      showToast(`${doc.filename}: ${result.error}`, "error");
    } else {
      showToast(`Filed ${doc.filename}`);
      setVisibleIds((prev) => prev.filter((id) => id !== doc.id));
    }
  }

  async function discard(doc: InboxDocSummary) {
    const result = await discardInboxDocument(doc.id);
    if (result.error) {
      showToast(`${doc.filename}: ${result.error}`, "error");
    } else {
      showToast(`Discarded ${doc.filename}`);
      setVisibleIds((prev) => prev.filter((id) => id !== doc.id));
    }
  }

  const visibleDocs = docs.filter((d) => visibleIds.includes(d.id));

  if (visibleDocs.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted">
        Nothing needs review — every uploaded document has been filed.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {visibleDocs.map((doc) => {
        const row = rows[doc.id];
        if (!row) return null;
        return (
          <div key={doc.id} className="rounded-xl border border-border bg-surface p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <a href={doc.downloadHref} className="flex min-w-0 items-center gap-2 hover:underline">
                  <FileText size={16} className="shrink-0 text-muted" />
                  <span className="min-w-0 truncate text-sm font-medium">{doc.filename}</span>
                </a>
                <span className="shrink-0 text-xs text-muted">
                  {humanFileSize(doc.size)} · {formatDate(new Date(doc.uploadedAt), dateFormat)}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <select
                  value={row.type}
                  disabled={row.status === "scanning" || row.status === "saving"}
                  onChange={(e) => {
                    const type = e.target.value as EntityType;
                    updateRow(doc.id, { type });
                    scan(doc.id, type, doc.filename);
                  }}
                  className="rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-accent"
                >
                  <option value="CONTRACT">Contract</option>
                  <option value="PRODUCT">Product</option>
                  {inventoryEnabled && <option value="INVENTORY">Inventory item</option>}
                </select>
                <button
                  type="button"
                  onClick={() => discard(doc)}
                  aria-label={`Discard ${doc.filename}`}
                  className="rounded p-1 text-muted hover:text-danger"
                >
                  <X size={14} />
                </button>
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
                  <RowField label="Title" htmlFor={`${doc.id}-title`}>
                    <input
                      id={`${doc.id}-title`}
                      value={row.contract.title}
                      disabled={row.status === "saving"}
                      onChange={(e) =>
                        updateRow(doc.id, {
                          contract: { ...row.contract, title: e.target.value },
                          contractAutoFilled: { ...row.contractAutoFilled, title: false },
                        })
                      }
                      className={fieldClass(row.contractAutoFilled.title)}
                    />
                  </RowField>
                  <RowField label="Provider" htmlFor={`${doc.id}-provider`}>
                    <input
                      id={`${doc.id}-provider`}
                      value={row.contract.provider}
                      disabled={row.status === "saving"}
                      onChange={(e) =>
                        updateRow(doc.id, {
                          contract: { ...row.contract, provider: e.target.value },
                          contractAutoFilled: { ...row.contractAutoFilled, provider: false },
                        })
                      }
                      className={fieldClass(row.contractAutoFilled.provider)}
                    />
                  </RowField>
                  <RowField label="Category" htmlFor={`${doc.id}-category`}>
                    <select
                      id={`${doc.id}-category`}
                      value={row.contract.category}
                      disabled={row.status === "saving"}
                      onChange={(e) =>
                        updateRow(doc.id, { contract: { ...row.contract, category: e.target.value } })
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
                  <RowField label="Cost" htmlFor={`${doc.id}-cost`}>
                    <input
                      id={`${doc.id}-cost`}
                      value={row.contract.cost}
                      disabled={row.status === "saving"}
                      onChange={(e) =>
                        updateRow(doc.id, {
                          contract: { ...row.contract, cost: e.target.value },
                          contractAutoFilled: { ...row.contractAutoFilled, cost: false },
                        })
                      }
                      inputMode="decimal"
                      className={fieldClass(row.contractAutoFilled.cost)}
                    />
                  </RowField>
                </div>
              )}

            {(row.status === "ready" || row.status === "saving" || row.status === "error") &&
              row.type === "PRODUCT" && (
                <div className="grid gap-2 sm:grid-cols-3">
                  <RowField label="Name" htmlFor={`${doc.id}-name`}>
                    <input
                      id={`${doc.id}-name`}
                      value={row.product.name}
                      disabled={row.status === "saving"}
                      onChange={(e) =>
                        updateRow(doc.id, {
                          product: { ...row.product, name: e.target.value },
                          productAutoFilled: { ...row.productAutoFilled, name: false },
                        })
                      }
                      className={fieldClass(row.productAutoFilled.name)}
                    />
                  </RowField>
                  <RowField label="Manufacturer" htmlFor={`${doc.id}-manufacturer`}>
                    <input
                      id={`${doc.id}-manufacturer`}
                      value={row.product.manufacturer}
                      disabled={row.status === "saving"}
                      onChange={(e) =>
                        updateRow(doc.id, {
                          product: { ...row.product, manufacturer: e.target.value },
                          productAutoFilled: { ...row.productAutoFilled, manufacturer: false },
                        })
                      }
                      className={fieldClass(row.productAutoFilled.manufacturer)}
                    />
                  </RowField>
                  <RowField label="Price" htmlFor={`${doc.id}-price`}>
                    <input
                      id={`${doc.id}-price`}
                      value={row.product.price}
                      disabled={row.status === "saving"}
                      onChange={(e) =>
                        updateRow(doc.id, {
                          product: { ...row.product, price: e.target.value },
                          productAutoFilled: { ...row.productAutoFilled, price: false },
                        })
                      }
                      inputMode="decimal"
                      className={fieldClass(row.productAutoFilled.price)}
                    />
                  </RowField>
                </div>
              )}

            {(row.status === "ready" || row.status === "saving" || row.status === "error") &&
              row.type === "INVENTORY" && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <RowField label="Label" htmlFor={`${doc.id}-label`}>
                    <input
                      id={`${doc.id}-label`}
                      value={row.inventory.label}
                      disabled={row.status === "saving"}
                      onChange={(e) =>
                        updateRow(doc.id, {
                          inventory: { ...row.inventory, label: e.target.value },
                          inventoryAutoFilled: { ...row.inventoryAutoFilled, label: false },
                        })
                      }
                      className={fieldClass(row.inventoryAutoFilled.label)}
                    />
                  </RowField>
                  <RowField label="Brand" htmlFor={`${doc.id}-brand`}>
                    <input
                      id={`${doc.id}-brand`}
                      value={row.inventory.brand}
                      disabled={row.status === "saving"}
                      onChange={(e) =>
                        updateRow(doc.id, {
                          inventory: { ...row.inventory, brand: e.target.value },
                          inventoryAutoFilled: { ...row.inventoryAutoFilled, brand: false },
                        })
                      }
                      className={fieldClass(row.inventoryAutoFilled.brand)}
                    />
                  </RowField>
                  <RowField label="Category" htmlFor={`${doc.id}-inv-category`}>
                    <select
                      id={`${doc.id}-inv-category`}
                      value={row.inventory.category}
                      disabled={row.status === "saving"}
                      onChange={(e) =>
                        updateRow(doc.id, {
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
                  <RowField label="Purchase price" htmlFor={`${doc.id}-purchasePrice`}>
                    <input
                      id={`${doc.id}-purchasePrice`}
                      value={row.inventory.purchasePrice}
                      disabled={row.status === "saving"}
                      onChange={(e) =>
                        updateRow(doc.id, {
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

            {row.error && <p className="mt-2 text-xs text-danger">{row.error}</p>}

            {(row.status === "ready" || row.status === "error") && (
              <button
                type="button"
                onClick={() => classify(doc)}
                className="mt-3 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90"
              >
                Save
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
