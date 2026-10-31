"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { ActionState } from "@/lib/actions/contracts";
import { SubmitButton } from "@/components/SubmitButton";
import { FormMessage } from "@/components/FormMessage";
import { Field } from "@/components/FormField";
import { FileDropZone } from "@/components/FileDropZone";
import { DateInput } from "@/components/DateInput";
import { SelectWrapper, inputClass, selectClass } from "@/components/SelectWrapper";
import { extractionMessage, isAiExtractionSource, markAutoFilled, type ExtractionSource } from "@/lib/autoFillHighlight";

type RenewField = "startDate" | "endDate" | "cost";
type RenewValues = Map<RenewField, string>;
const RENEW_FIELDS: RenewField[] = ["startDate", "endDate", "cost"];

function asRenewField(key: string): RenewField | undefined {
  return RENEW_FIELDS.find((field) => field === key);
}

// #353 — the Renew form: the next Term's dates and cost, pre-filled from the
// current Term, plus an optional Document for the new Term. Choosing a
// Document scans it, and what the scan finds replaces a pre-filled guess,
// but never a value the person has already changed.
export function ContractRenewForm({
  action,
  defaults,
  baseUpdatedAt,
  costHint,
  cancelHref,
  today,
  termDocuments,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  defaults: { startDate: string; endDate: string; cost: string };
  /** The household's today (YYYY-MM-DD), to warn about an end date that has already passed. */
  today: string;
  /** The choice of paperwork for the Term being kept, when there's more than one candidate. */
  termDocuments?: { options: { id: string; filename: string }[]; defaultId: string };
  baseUpdatedAt: string;
  /** What the cost is in, which carries over unchanged (e.g. "AUD, billed annually"). */
  costHint: string;
  cancelHref: string;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, null);
  // The values the fields were last mounted with. A scan remounts them (the
  // `version` key) with new defaults, since DateInput is uncontrolled.
  const [values, setValues] = useState<RenewValues>(
    () =>
      new Map<RenewField, string>([
        ["startDate", defaults.startDate],
        ["endDate", defaults.endDate],
        ["cost", defaults.cost],
      ]),
  );
  const [version, setVersion] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const highlight = useRef<{ fields: RenewField[]; source: "heuristic" | "ai" } | null>(null);
  const startDateRef = useRef<HTMLInputElement>(null);
  const endDateRef = useRef<HTMLInputElement>(null);
  const costRef = useRef<HTMLInputElement>(null);

  // A failed submit hands back what was sent; show that rather than the pre-fill.
  const shown = new Map(values);
  for (const [key, value] of Object.entries(state?.values ?? {})) {
    const field = asRenewField(key);
    if (field) shown.set(field, value);
  }
  // The end date as typed, for the "already passed" warning. Null until the
  // person edits it, so the shown value (pre-fill, scan or failed submit) applies.
  const [typedEndDate, setTypedEndDate] = useState<string | null>(null);
  const endDate = typedEndDate ?? shown.get("endDate") ?? "";
  const endDatePassed = endDate !== "" && endDate < today;
  const termDocumentDefault = state?.values?.termDocumentId ?? termDocuments?.defaultId ?? "";

  // Marks what a scan filled in, once the fields have remounted with it.
  useEffect(() => {
    const pending = highlight.current;
    if (!pending) return;
    highlight.current = null;
    const fieldRefs = new Map([
      ["startDate", startDateRef],
      ["endDate", endDateRef],
      ["cost", costRef],
    ]);
    for (const field of pending.fields) markAutoFilled(fieldRefs.get(field)?.current, pending.source);
  }, [version]);

  async function handleFileChange(file: File | null) {
    if (!file) return;
    setScanning(true);
    setScanMessage(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/documents/extract", { method: "POST", body });
      if (!res.ok) throw new Error("Extraction failed");
      const { fields, source } = (await res.json()) as {
        fields: Partial<Record<string, string>>;
        source: ExtractionSource;
      };
      const found = new Map<RenewField, string>();
      for (const [key, value] of Object.entries(fields)) {
        const field = asRenewField(key);
        if (field && value) found.set(field, value);
      }
      const fieldRefs = new Map([
        ["startDate", startDateRef],
        ["endDate", endDateRef],
        ["cost", costRef],
      ]);
      const next: RenewValues = new Map();
      const replaced: RenewField[] = [];
      for (const field of RENEW_FIELDS) {
        const now = fieldRefs.get(field)?.current?.value ?? "";
        const fromScan = found.get(field);
        // Only replace what's still the pre-filled guess.
        if (fromScan && now === (shown.get(field) ?? "")) {
          next.set(field, fromScan);
          replaced.push(field);
        } else {
          next.set(field, now);
        }
      }
      if (replaced.length > 0) {
        highlight.current = { fields: replaced, source: isAiExtractionSource(source) ? "ai" : "heuristic" };
        setTypedEndDate(null);
        setValues(next);
        setVersion((v) => v + 1);
      }
      setScanMessage(extractionMessage(source, found.size));
    } catch {
      setScanMessage("Couldn't scan this document. You can still attach it and fill in the dates yourself.");
    } finally {
      setScanning(false);
    }
  }

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="baseUpdatedAt" value={baseUpdatedAt} />

      <div key={version} className="grid gap-4 md:grid-cols-2">
        <Field label="New start date" htmlFor="startDate">
          <DateInput
            ref={startDateRef}
            id="startDate"
            name="startDate"
            defaultValue={shown.get("startDate") ?? ""}
            className={inputClass}
          />
        </Field>
        <Field label="New end date" htmlFor="endDate" required>
          <DateInput
            ref={endDateRef}
            id="endDate"
            name="endDate"
            required
            defaultValue={shown.get("endDate") ?? ""}
            onChange={(event) => {
              setTypedEndDate(event.target.value);
            }}
            aria-describedby={endDatePassed ? "endDatePassed" : undefined}
            className={inputClass}
          />
          {endDatePassed && (
            <p id="endDatePassed" className="text-xs text-warning">
              This date has already passed, so the contract will still need attention after renewing.
            </p>
          )}
        </Field>
        <Field label="New cost" htmlFor="cost" hint={costHint}>
          <input
            ref={costRef}
            id="cost"
            name="cost"
            type="number"
            min={0}
            step="0.01"
            defaultValue={shown.get("cost") ?? ""}
            className={inputClass}
          />
        </Field>
        {termDocuments && (
          <Field
            label="Paperwork for the term being kept"
            htmlFor="termDocumentId"
            hint="Linked to the current term under Previous terms."
          >
            <SelectWrapper>
              <select
                id="termDocumentId"
                name="termDocumentId"
                defaultValue={termDocumentDefault}
                className={selectClass}
              >
                {termDocuments.options.map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.filename}
                  </option>
                ))}
                <option value="">None</option>
              </select>
            </SelectWrapper>
          </Field>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">New document (optional)</p>
        <FileDropZone
          name="file"
          onFileSelected={handleFileChange}
          label="Drop in the renewal notice or new policy to fill in the dates"
        />
        {scanning && (
          <p role="status" aria-live="polite" className="text-sm text-muted">
            Scanning document…
          </p>
        )}
        {!scanning && scanMessage && (
          <p role="status" aria-live="polite" className="text-sm text-muted">
            {scanMessage}
          </p>
        )}
      </div>

      <FormMessage error={state?.error} success={state?.success} />

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingText="Renewing…">Renew</SubmitButton>
        <Link href={cancelHref} className="text-sm text-muted hover:underline">
          Cancel
        </Link>
      </div>
    </form>
  );
}
