"use client";

import { Timestamp } from "@/components/Timestamp";
import { useEffect, useRef, useState } from "react";
import { FileText, X, Loader2, AlertTriangle, Copy } from "lucide-react";
import Link from "next/link";
import {
  classifyInboxDocument,
  discardInboxDocument,
  keepInboxDocumentSeparate,
  attachInboxDocumentAsVersion,
} from "@/lib/actions/import";
import { CATEGORY_LABELS, humanFileSize } from "@/lib/utils";
import { INVENTORY_ITEM_CATEGORIES } from "@/lib/validation/inventory";
import { showToast } from "@/components/Toast";
import { useCanWrite } from "@/components/CanWriteProvider";
import { LinkedToField } from "@/components/LinkedToField";
import { extractionMessage, isAiExtractionSource } from "@/lib/autoFillHighlight";

export type InboxDocumentStatus =
  | "NEEDS_CLASSIFICATION"
  | "NEEDS_REVIEW"
  | "EXTRACTION_FAILED"
  | "POSSIBLE_DUPLICATE";

export interface DuplicateMatch {
  kind: string;
  filename: string;
  ownerHref: string | null;
  ownerId: string | null;
  docId: string;
}

const STATUS_LABELS: Record<InboxDocumentStatus, string> = {
  NEEDS_CLASSIFICATION: "Not classified",
  NEEDS_REVIEW: "Ready to file",
  EXTRACTION_FAILED: "Extraction failed",
  POSSIBLE_DUPLICATE: "Possible duplicate",
};

const KIND_LABELS: Record<string, string> = {
  CONTRACT: "a contract",
  PRODUCT: "a warranty",
  TRIP_SEGMENT: "a trip",
  RENTAL_STATEMENT: "a rental statement",
  HOME_ITEM: "a maintenance record",
  VEHICLE_ITEM: "a service record",
  INVENTORY_ITEM: "an inventory item",
  TRADE: "a wealth trade",
  INBOX: "another unfiled document",
};

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

type EntityType = "CONTRACT" | "PRODUCT" | "INVENTORY";

const STATUS_LABEL_MAP = new Map<string, string>(Object.entries(STATUS_LABELS));
const KIND_LABEL_MAP = new Map<string, string>(Object.entries(KIND_LABELS));
const GUESSED_TYPE_LABELS = new Map<string, string>([
  ["CONTRACT", "contract"],
  ["PRODUCT", "product"],
  ["INVENTORY", "inventory item"],
]);

function ReadOnlyInboxList({ docs, dateFormat }: { docs: InboxDocSummary[]; dateFormat?: string }) {
  return (
    <ul className="space-y-3">
      {docs.map((doc) => (
        <li key={doc.id} className="space-y-1 rounded-xl border border-border bg-surface p-4">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <a href={doc.downloadHref} className="flex min-w-0 items-center gap-2 hover:underline">
              <FileText size={16} className="shrink-0 text-muted" />
              <span className="min-w-0 truncate text-sm font-medium">{doc.filename}</span>
            </a>
            {/* #403 — let long "via email from" addresses wrap instead of
                overflowing the card. */}
            <span className="min-w-0 text-xs break-words text-muted">
              {humanFileSize(doc.size)} · <Timestamp value={doc.uploadedAt} dateFormat={dateFormat} />
              {doc.fromAddress && ` · via email from ${doc.fromAddress}`}
            </span>
          </div>
          <p className="text-xs text-muted">
            {STATUS_LABEL_MAP.get(doc.status) ?? doc.status}
            {doc.guessedType && ` · looks like a ${GUESSED_TYPE_LABELS.get(doc.guessedType) ?? "record"}`}
          </p>
          {doc.duplicateOf.length > 0 && (
            <ul className="space-y-0.5 text-xs">
              {doc.duplicateOf.map((match) => (
                <li key={match.docId} className="text-muted">
                  Matches {KIND_LABEL_MAP.get(match.kind) ?? match.kind}:{" "}
                  {match.ownerHref ? (
                    <Link href={match.ownerHref} className="font-medium text-accent hover:underline">
                      {match.filename}
                    </Link>
                  ) : (
                    <span className="font-medium text-foreground">{match.filename}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

export interface InboxDocSummary {
  id: string;
  filename: string;
  size: number;
  uploadedAt: string;
  downloadHref: string;
  // Set for documents ingested by email (#195) — never for web uploads.
  fromAddress?: string | null;
  guessedType?: EntityType | null;
  status: InboxDocumentStatus;
  duplicateOf: DuplicateMatch[];
}
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

interface RowState {
  status: "scanning" | "ready" | "saving" | "error";
  type: EntityType;
  error?: string;
  scanMessage?: string;
  source?: ExtractionSource;
  contract: ContractFields;
  // #327 — link a filed policy/warranty to a home or vehicle during review.
  // Kept outside ContractFields/ProductFields since it's a user selection,
  // not an extracted field (appendReviewFields only tracks the latter).
  contractPropertyId: string;
  contractVehicleId: string;
  product: ProductFields;
  productPropertyId: string;
  inventory: InventoryFields;
  contractAutoFilled: Partial<Record<keyof ContractFields, boolean>>;
  productAutoFilled: Partial<Record<keyof ProductFields, boolean>>;
  inventoryAutoFilled: Partial<Record<keyof InventoryFields, boolean>>;
}

function emptyRowState(initialType: EntityType = "CONTRACT"): RowState {
  return {
    status: "scanning",
    type: initialType,
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
}

// Heuristic hits get the accent color, AI-suggested values (BYOK/local LLM)
// get neutral grey instead — same distinction as ContractForm's markAutoFilled,
// so a reviewer can tell pattern-matched fields from model-inferred ones
// at a glance (#172).
function fieldClass(autoFilled?: boolean, isAi?: boolean) {
  if (!autoFilled) return "rounded-md border px-2 py-1.5 text-sm outline-none focus:border-accent border-border bg-background";
  return `rounded-md border px-2 py-1.5 text-sm outline-none focus:border-accent ${
    isAi ? "border-foreground/60 bg-foreground/5 ring-2 ring-foreground/60" : "border-accent/40 bg-accent/5 ring-1 ring-accent/40"
  }`;
}

function appendReviewFields(
  formData: FormData,
  fields: ContractFields | ProductFields | InventoryFields,
  autoFilled: Partial<Record<string, boolean>>,
  source: ExtractionSource | undefined,
) {
  const effectiveSource = source ?? "none";
  const reviewFields = Object.entries(autoFilled)
    .filter(([, used]) => used)
    .map(([fieldName]) => ({
      fieldName,
      value: fields[fieldName as keyof typeof fields] ?? "",
      source: effectiveSource,
      confidence: effectiveSource === "none" ? 0 : effectiveSource === "heuristic" ? 0.7 : 0.85,
    }));
  if (reviewFields.length > 0) {
    formData.append("extractionReviewFields", JSON.stringify(reviewFields));
  }
}

// #199 — lets a household with many pending documents jump straight to e.g.
// "possible duplicate" instead of scanning past everything else.
function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-medium ${
        active
          ? "border-accent bg-accent/10 text-accent"
          : "border-border bg-surface text-muted hover:bg-hover"
      }`}
    >
      {label} ({count})
    </button>
  );
}

const ROW_FIELD_WRAPPER = "space-y-0.5";
const ROW_FIELD_LABEL = "flex items-center gap-1 text-[11px] font-medium text-muted";

function RowField({
  label,
  htmlFor,
  autoFilled,
  isAi,
  children,
}: {
  label: string;
  htmlFor: string;
  autoFilled?: boolean;
  isAi?: boolean;
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
            <span
              aria-hidden="true"
              className={`rounded px-1 py-0.5 text-[9px] font-medium ${
                isAi ? "bg-muted/10 text-muted" : "bg-accent/10 text-accent"
              }`}
            >
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
  properties = [],
  vehicles = [],
  homeEnabled = false,
  vehiclesEnabled = false,
}: {
  docs: InboxDocSummary[];
  dateFormat?: string;
  inventoryEnabled: boolean;
  properties?: { id: string; label: string }[];
  vehicles?: { id: string; label: string }[];
  homeEnabled?: boolean;
  vehiclesEnabled?: boolean;
}) {
  const [visibleIds, setVisibleIds] = useState(() => docs.map((d) => d.id));
  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(docs.map((d) => [d.id, emptyRowState(d.guessedType ?? "CONTRACT")])),
  );
  const [statusFilter, setStatusFilter] = useState<InboxDocumentStatus | "ALL">("ALL");
  // Rows the user explicitly chose "keep as separate" for this session —
  // the server row's status flips too (keepInboxDocumentSeparate), but this
  // client component doesn't re-fetch props on that revalidatePath, so the
  // duplicate panel needs its own override to switch to the classify form
  // immediately instead of waiting for the next full page load.
  const [keptSeparate, setKeptSeparate] = useState<Set<string>>(new Set());
  const [attaching, setAttaching] = useState<Set<string>>(new Set());
  const canWrite = useCanWrite();
  // The pre-fill scan runs once, on mount, with the first render's values:
  // re-running when `docs` or `scan` change identity would rescan every row
  // and overwrite what the member has typed. A ref makes that explicit.
  const initialScan = useRef({ docs, canWrite, scan });

  useEffect(() => {
    const { docs, canWrite, scan } = initialScan.current;
    // A read-only member can't file anything, so there's nothing to pre-fill.
    if (!canWrite) return;
    // Deferred one tick so the initial scan (which sets state) isn't a
    // direct call from the effect body — rows already start in "scanning"
    // via emptyRowState(), this just kicks off the actual fetches. Scans
    // with the email-ingestion type guess when there is one (#195), instead
    // of always defaulting to Contract.
    queueMicrotask(() => {
      for (const doc of docs) {
        scan(doc.id, doc.guessedType ?? "CONTRACT", doc.filename);
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
        source,
        contract: {
          title: fields.title ?? filename.replace(/\.[^.]+$/, ""),
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
        source,
        product: {
          description: fields.description ?? filename.replace(/\.[^.]+$/, ""),
          manufacturer: fields.manufacturer ?? "",
          price: fields.price ?? "",
          purchaseDate: fields.purchaseDate ?? "",
          warrantyEndDate: fields.warrantyEndDate ?? "",
        },
        productAutoFilled: {
          description: Boolean(fields.description),
          manufacturer: Boolean(fields.manufacturer),
          price: Boolean(fields.price),
          purchaseDate: Boolean(fields.purchaseDate),
          warrantyEndDate: Boolean(fields.warrantyEndDate),
        },
      });
    } else {
      updateRow(id, {
        status: "ready",
        scanMessage,
        source,
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
      fields.append("startDate", row.contract.startDate);
      fields.append("endDate", row.contract.endDate);
      if (row.contractPropertyId) fields.append("propertyId", row.contractPropertyId);
      if (row.contractVehicleId) fields.append("vehicleId", row.contractVehicleId);
      fields.append("extractionUsed", Object.values(row.contractAutoFilled).some(Boolean) ? "1" : "0");
      fields.append("confirmExtraction", "0");
      appendReviewFields(fields, row.contract, row.contractAutoFilled, row.source);
    } else if (row.type === "PRODUCT") {
      fields.append("description", row.product.description);
      fields.append("manufacturer", row.product.manufacturer);
      fields.append("price", row.product.price);
      fields.append("purchaseDate", row.product.purchaseDate);
      fields.append("warrantyEndDate", row.product.warrantyEndDate);
      if (row.productPropertyId) fields.append("propertyId", row.productPropertyId);
      fields.append("extractionUsed", Object.values(row.productAutoFilled).some(Boolean) ? "1" : "0");
      fields.append("confirmExtraction", "0");
      appendReviewFields(fields, row.product, row.productAutoFilled, row.source);
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

  async function keepSeparate(doc: InboxDocSummary) {
    const result = await keepInboxDocumentSeparate(doc.id);
    if (result.error) {
      showToast(`${doc.filename}: ${result.error}`, "error");
    } else {
      setKeptSeparate((prev) => new Set(prev).add(doc.id));
    }
  }

  async function attachAsVersion(doc: InboxDocSummary, match: DuplicateMatch) {
    if (!match.ownerId) return;
    const targetKind = match.kind as "CONTRACT" | "PRODUCT" | "INVENTORY_ITEM";
    setAttaching((prev) => new Set(prev).add(doc.id));
    const result = await attachInboxDocumentAsVersion(doc.id, targetKind, match.ownerId, match.docId);
    setAttaching((prev) => {
      const next = new Set(prev);
      next.delete(doc.id);
      return next;
    });
    if (result.error) {
      showToast(`${doc.filename}: ${result.error}`, "error");
    } else {
      showToast(`Attached ${doc.filename} as a new version`);
      setVisibleIds((prev) => prev.filter((id) => id !== doc.id));
    }
  }

  const remainingDocs = docs.filter((d) => visibleIds.includes(d.id));
  const visibleDocs = remainingDocs.filter(
    (d) => statusFilter === "ALL" || d.status === statusFilter,
  );

  if (remainingDocs.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted">
        Nothing in the Inbox.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {remainingDocs.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <FilterChip
            label="All"
            count={remainingDocs.length}
            active={statusFilter === "ALL"}
            onClick={() => setStatusFilter("ALL")}
          />
          {(Object.keys(STATUS_LABELS) as InboxDocumentStatus[]).map((s) => {
            const count = remainingDocs.filter((d) => d.status === s).length;
            if (count === 0) return null;
            return (
              <FilterChip
                key={s}
                label={STATUS_LABELS[s]}
                count={count}
                active={statusFilter === s}
                onClick={() => setStatusFilter(s)}
              />
            );
          })}
        </div>
      )}

      {visibleDocs.length === 0 && (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">
          No documents match this filter.
        </p>
      )}

      {/* #400 — read-only members see what's waiting, and can filter it, as
          plain text: no classify fields, Save or Discard. */}
      {!canWrite && visibleDocs.length > 0 && <ReadOnlyInboxList docs={visibleDocs} dateFormat={dateFormat} />}

      {canWrite && visibleDocs.map((doc) => {
        const row = rows[doc.id];
        if (!row) return null;
        const rowIsAi = row.source != null && isAiExtractionSource(row.source);
        // Title/description/label always fall back to the filename, and
        // category always has a select default — provider is the only field
        // across all three entity types that can genuinely be missing at
        // save time (#171).
        const missingRequired =
          row.type === "CONTRACT" && !row.contract.provider.trim() ? ["Provider"] : [];
        const isDuplicatePending = doc.status === "POSSIBLE_DUPLICATE" && !keptSeparate.has(doc.id);
        const isAttaching = attaching.has(doc.id);
        return (
          <div key={doc.id} className="rounded-xl border border-border bg-surface p-4">
            {/* #403 — header and type select shared one flex line; at 390px
                the shrink-0 "via email from …" metadata slid under the select.
                Stack them below sm and let the metadata wrap instead. */}
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-2">
                <a href={doc.downloadHref} className="flex min-w-0 items-center gap-2 hover:underline">
                  <FileText size={16} className="shrink-0 text-muted" />
                  <span className="min-w-0 truncate text-sm font-medium">{doc.filename}</span>
                </a>
                <span className="min-w-0 text-xs break-words text-muted">
                  {humanFileSize(doc.size)} · <Timestamp value={doc.uploadedAt} dateFormat={dateFormat} />
                  {doc.fromAddress && ` · via email from ${doc.fromAddress}`}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <select
                  aria-label={`File ${doc.filename} as`}
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
                  <option value="PRODUCT">Warranty</option>
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

            {isDuplicatePending && (
              <div className="space-y-2 rounded-lg border border-warning/30 bg-warning/10 p-3">
                <p className="flex items-center gap-1.5 text-sm font-medium text-warning">
                  <Copy size={14} />
                  This file looks identical to something already saved.
                </p>
                <ul className="space-y-1 text-sm">
                  {doc.duplicateOf.map((match) => (
                    <li key={match.docId} className="flex flex-wrap items-center gap-2">
                      <span className="text-muted">
                        Matches {KIND_LABELS[match.kind] ?? match.kind}:{" "}
                      </span>
                      {match.ownerHref ? (
                        <Link href={match.ownerHref} className="font-medium text-accent hover:underline">
                          {match.filename}
                        </Link>
                      ) : (
                        <span className="font-medium">{match.filename}</span>
                      )}
                      {match.ownerHref && match.ownerId && (
                        <button
                          type="button"
                          disabled={isAttaching}
                          onClick={() => attachAsVersion(doc, match)}
                          className="rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-hover disabled:opacity-60"
                        >
                          {isAttaching ? "Attaching…" : "Attach as new version"}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => keepSeparate(doc)}
                    className="rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-hover"
                  >
                    Keep as separate document
                  </button>
                </div>
              </div>
            )}

            {!isDuplicatePending && row.status === "scanning" && (
              <p role="status" className="flex items-center gap-2 text-sm text-muted">
                <Loader2 size={14} className="animate-spin" /> Scanning…
              </p>
            )}

            {!isDuplicatePending && row.scanMessage && row.status !== "scanning" && (
              <p role="status" aria-live="polite" className="mb-2 text-xs text-muted">
                {row.scanMessage}
              </p>
            )}

            {!isDuplicatePending && row.status !== "scanning" && missingRequired.length > 0 && (
              <p className="mb-2 flex items-center gap-1 text-xs font-medium text-warning">
                <AlertTriangle size={12} />
                Missing required: {missingRequired.join(", ")}
              </p>
            )}

            {!isDuplicatePending &&
              (row.status === "ready" || row.status === "saving" || row.status === "error") &&
              row.type === "CONTRACT" && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <RowField label="Title" htmlFor={`${doc.id}-title`} autoFilled={row.contractAutoFilled.title} isAi={rowIsAi}>
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
                      className={fieldClass(row.contractAutoFilled.title, rowIsAi)}
                    />
                  </RowField>
                  <RowField label="Provider" htmlFor={`${doc.id}-provider`} autoFilled={row.contractAutoFilled.provider} isAi={rowIsAi}>
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
                      className={fieldClass(row.contractAutoFilled.provider, rowIsAi)}
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
                  <RowField label="Cost" htmlFor={`${doc.id}-cost`} autoFilled={row.contractAutoFilled.cost} isAi={rowIsAi}>
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
                      className={fieldClass(row.contractAutoFilled.cost, rowIsAi)}
                    />
                  </RowField>
                  <RowField label="Start date" htmlFor={`${doc.id}-startDate`} autoFilled={row.contractAutoFilled.startDate} isAi={rowIsAi}>
                    <input
                      id={`${doc.id}-startDate`}
                      type="date"
                      value={row.contract.startDate}
                      disabled={row.status === "saving"}
                      onChange={(e) =>
                        updateRow(doc.id, {
                          contract: { ...row.contract, startDate: e.target.value },
                          contractAutoFilled: { ...row.contractAutoFilled, startDate: false },
                        })
                      }
                      className={fieldClass(row.contractAutoFilled.startDate, rowIsAi)}
                    />
                  </RowField>
                  <RowField label="End date" htmlFor={`${doc.id}-endDate`} autoFilled={row.contractAutoFilled.endDate} isAi={rowIsAi}>
                    <input
                      id={`${doc.id}-endDate`}
                      type="date"
                      value={row.contract.endDate}
                      disabled={row.status === "saving"}
                      onChange={(e) =>
                        updateRow(doc.id, {
                          contract: { ...row.contract, endDate: e.target.value },
                          contractAutoFilled: { ...row.contractAutoFilled, endDate: false },
                        })
                      }
                      className={fieldClass(row.contractAutoFilled.endDate, rowIsAi)}
                    />
                  </RowField>
                  <LinkedToField
                    id={`${doc.id}-contractLink`}
                    properties={properties}
                    vehicles={vehicles}
                    homeEnabled={homeEnabled}
                    vehiclesEnabled={vehiclesEnabled}
                    recordNoun="contract"
                    disabled={row.status === "saving"}
                    onChange={({ propertyId, vehicleId }) =>
                      updateRow(doc.id, { contractPropertyId: propertyId, contractVehicleId: vehicleId })
                    }
                    hintLinksInNewTab
                    wrapperClassName={ROW_FIELD_WRAPPER}
                    labelClassName={ROW_FIELD_LABEL}
                    selectClassName={fieldClass(false)}
                  />
                </div>
              )}

            {!isDuplicatePending &&
              (row.status === "ready" || row.status === "saving" || row.status === "error") &&
              row.type === "PRODUCT" && (
                <div className="grid gap-2 sm:grid-cols-3">
                  <RowField label="Description" htmlFor={`${doc.id}-description`} autoFilled={row.productAutoFilled.description} isAi={rowIsAi}>
                    <input
                      id={`${doc.id}-description`}
                      value={row.product.description}
                      disabled={row.status === "saving"}
                      onChange={(e) =>
                        updateRow(doc.id, {
                          product: { ...row.product, description: e.target.value },
                          productAutoFilled: { ...row.productAutoFilled, description: false },
                        })
                      }
                      className={fieldClass(row.productAutoFilled.description, rowIsAi)}
                    />
                  </RowField>
                  <RowField label="Manufacturer" htmlFor={`${doc.id}-manufacturer`} autoFilled={row.productAutoFilled.manufacturer} isAi={rowIsAi}>
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
                      className={fieldClass(row.productAutoFilled.manufacturer, rowIsAi)}
                    />
                  </RowField>
                  <RowField label="Price" htmlFor={`${doc.id}-price`} autoFilled={row.productAutoFilled.price} isAi={rowIsAi}>
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
                      className={fieldClass(row.productAutoFilled.price, rowIsAi)}
                    />
                  </RowField>
                  <RowField label="Purchase date" htmlFor={`${doc.id}-purchaseDate`} autoFilled={row.productAutoFilled.purchaseDate} isAi={rowIsAi}>
                    <input
                      id={`${doc.id}-purchaseDate`}
                      type="date"
                      value={row.product.purchaseDate}
                      disabled={row.status === "saving"}
                      onChange={(e) =>
                        updateRow(doc.id, {
                          product: { ...row.product, purchaseDate: e.target.value },
                          productAutoFilled: { ...row.productAutoFilled, purchaseDate: false },
                        })
                      }
                      className={fieldClass(row.productAutoFilled.purchaseDate, rowIsAi)}
                    />
                  </RowField>
                  <RowField label="Warranty end date" htmlFor={`${doc.id}-warrantyEndDate`} autoFilled={row.productAutoFilled.warrantyEndDate} isAi={rowIsAi}>
                    <input
                      id={`${doc.id}-warrantyEndDate`}
                      type="date"
                      value={row.product.warrantyEndDate}
                      disabled={row.status === "saving"}
                      onChange={(e) =>
                        updateRow(doc.id, {
                          product: { ...row.product, warrantyEndDate: e.target.value },
                          productAutoFilled: { ...row.productAutoFilled, warrantyEndDate: false },
                        })
                      }
                      className={fieldClass(row.productAutoFilled.warrantyEndDate, rowIsAi)}
                    />
                  </RowField>
                  <LinkedToField
                    id={`${doc.id}-productLink`}
                    properties={properties}
                    homeEnabled={homeEnabled}
                    recordNoun="warranty"
                    disabled={row.status === "saving"}
                    onChange={({ propertyId }) => updateRow(doc.id, { productPropertyId: propertyId })}
                    hintLinksInNewTab
                    wrapperClassName={ROW_FIELD_WRAPPER}
                    labelClassName={ROW_FIELD_LABEL}
                    selectClassName={fieldClass(false)}
                  />
                </div>
              )}

            {!isDuplicatePending &&
              (row.status === "ready" || row.status === "saving" || row.status === "error") &&
              row.type === "INVENTORY" && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <RowField label="Label" htmlFor={`${doc.id}-label`} autoFilled={row.inventoryAutoFilled.label} isAi={rowIsAi}>
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
                      className={fieldClass(row.inventoryAutoFilled.label, rowIsAi)}
                    />
                  </RowField>
                  <RowField label="Brand" htmlFor={`${doc.id}-brand`} autoFilled={row.inventoryAutoFilled.brand} isAi={rowIsAi}>
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
                      className={fieldClass(row.inventoryAutoFilled.brand, rowIsAi)}
                    />
                  </RowField>
                  <RowField label="Category" htmlFor={`${doc.id}-inv-category`} autoFilled={row.inventoryAutoFilled.category} isAi={rowIsAi}>
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
                      className={fieldClass(row.inventoryAutoFilled.category, rowIsAi)}
                    >
                      {INVENTORY_ITEM_CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>
                          {INVENTORY_CATEGORY_LABELS[cat] ?? cat}
                        </option>
                      ))}
                    </select>
                  </RowField>
                  <RowField label="Purchase price" htmlFor={`${doc.id}-purchasePrice`} autoFilled={row.inventoryAutoFilled.purchasePrice} isAi={rowIsAi}>
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
                      className={fieldClass(row.inventoryAutoFilled.purchasePrice, rowIsAi)}
                    />
                  </RowField>
                </div>
              )}

            {!isDuplicatePending && row.error && (
              <p className="mt-2 text-xs text-danger">{row.error}</p>
            )}

            {!isDuplicatePending && (row.status === "ready" || row.status === "error") && (
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
