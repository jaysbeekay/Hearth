"use client";

import { useId, useRef, useState } from "react";
import { Upload, FileText, X, Check, Loader2 } from "lucide-react";
import { importContract, importProduct } from "@/lib/actions/import";
import { CATEGORY_LABELS } from "@/lib/utils";
import { showToast } from "@/components/Toast";

type EntityType = "CONTRACT" | "PRODUCT";
type RowStatus = "scanning" | "ready" | "saving" | "saved" | "error";

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

interface Row {
  id: string;
  file: File;
  type: EntityType;
  status: RowStatus;
  error?: string;
  href?: string;
  contract: ContractFields;
  product: ProductFields;
}

let nextId = 0;

async function extract(type: EntityType, file: File) {
  const body = new FormData();
  body.append("file", file);
  const url = type === "CONTRACT" ? "/api/documents/extract" : "/api/products/extract";
  const res = await fetch(url, { method: "POST", body });
  if (!res.ok) return {};
  const { fields } = (await res.json()) as { fields: Record<string, string> };
  return fields;
}

export function ImportClient() {
  const [rows, setRows] = useState<Row[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  function updateRow(id: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  async function scanRow(id: string, type: EntityType, file: File) {
    updateRow(id, { status: "scanning" });
    const fields = await extract(type, file);
    if (type === "CONTRACT") {
      updateRow(id, {
        status: "ready",
        contract: {
          title: fields.title ?? file.name.replace(/\.[^.]+$/, ""),
          provider: fields.provider ?? "",
          category: "OTHER",
          cost: fields.cost ?? "",
        },
      });
    } else {
      updateRow(id, {
        status: "ready",
        product: {
          name: fields.name ?? file.name.replace(/\.[^.]+$/, ""),
          manufacturer: fields.manufacturer ?? "",
          price: fields.price ?? "",
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
        contract: { title: "", provider: "", category: "OTHER", cost: "" },
        product: { name: "", manufacturer: "", price: "" },
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
      result = await importContract(formData);
    } else {
      formData.append("name", row.product.name);
      formData.append("manufacturer", row.product.manufacturer);
      formData.append("price", row.product.price);
      result = await importProduct(formData);
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
        className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-8 text-center transition ${
          dragOver ? "border-accent bg-accent/5" : "border-border hover:border-accent/50"
        }`}
      >
        <Upload size={22} className="text-muted" />
        <p className="text-sm font-medium">Drag multiple files here or click to browse</p>
        <p className="text-xs text-muted">Each one is scanned and added to the queue below</p>
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
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
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

                {(row.status === "ready" || row.status === "saving" || row.status === "error") &&
                  row.type === "CONTRACT" && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <input
                        value={row.contract.title}
                        disabled={row.status === "saving"}
                        onChange={(e) =>
                          updateRow(row.id, { contract: { ...row.contract, title: e.target.value } })
                        }
                        placeholder="Title"
                        className="rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-accent"
                      />
                      <input
                        value={row.contract.provider}
                        disabled={row.status === "saving"}
                        onChange={(e) =>
                          updateRow(row.id, {
                            contract: { ...row.contract, provider: e.target.value },
                          })
                        }
                        placeholder="Provider"
                        className="rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-accent"
                      />
                      <select
                        value={row.contract.category}
                        disabled={row.status === "saving"}
                        onChange={(e) =>
                          updateRow(row.id, {
                            contract: { ...row.contract, category: e.target.value },
                          })
                        }
                        className="rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-accent"
                      >
                        {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <input
                        value={row.contract.cost}
                        disabled={row.status === "saving"}
                        onChange={(e) =>
                          updateRow(row.id, { contract: { ...row.contract, cost: e.target.value } })
                        }
                        placeholder="Cost"
                        inputMode="decimal"
                        className="rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-accent"
                      />
                    </div>
                  )}

                {(row.status === "ready" || row.status === "saving" || row.status === "error") &&
                  row.type === "PRODUCT" && (
                    <div className="grid gap-2 sm:grid-cols-3">
                      <input
                        value={row.product.name}
                        disabled={row.status === "saving"}
                        onChange={(e) =>
                          updateRow(row.id, { product: { ...row.product, name: e.target.value } })
                        }
                        placeholder="Name"
                        className="rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-accent"
                      />
                      <input
                        value={row.product.manufacturer}
                        disabled={row.status === "saving"}
                        onChange={(e) =>
                          updateRow(row.id, {
                            product: { ...row.product, manufacturer: e.target.value },
                          })
                        }
                        placeholder="Manufacturer"
                        className="rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-accent"
                      />
                      <input
                        value={row.product.price}
                        disabled={row.status === "saving"}
                        onChange={(e) =>
                          updateRow(row.id, { product: { ...row.product, price: e.target.value } })
                        }
                        placeholder="Price"
                        inputMode="decimal"
                        className="rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-accent"
                      />
                    </div>
                  )}

                {row.error && <p className="mt-2 text-xs text-danger">{row.error}</p>}

                {(row.status === "ready" || row.status === "error") && (
                  <button
                    type="button"
                    onClick={() => saveRow(row)}
                    className="mt-3 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5"
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
