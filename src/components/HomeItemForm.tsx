"use client";

import { useActionState, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { Upload } from "lucide-react";
import type { HomeItemModel } from "@/generated/prisma/models";
import type { ActionState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";
import { FormMessage } from "@/components/FormMessage";
import { HOME_ITEM_TYPES } from "@/lib/validation/home";
import { HOME_ITEM_TYPE_LABELS } from "@/lib/utils";
import { SelectWrapper, selectClass } from "@/components/SelectWrapper";

function toDateInputValue(date: Date | null | undefined) {
  if (!date) return "";
  return new Date(date).toISOString().slice(0, 10);
}

type ExtractedFields = Partial<Record<"type" | "title" | "provider" | "date" | "cost", string>>;

export function HomeItemForm({
  action,
  item,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  item?: HomeItemModel;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, null);
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);

  const typeRef = useRef<HTMLSelectElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const providerRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const costRef = useRef<HTMLInputElement>(null);

  function applyExtractedFields(fields: ExtractedFields) {
    if (fields.type && typeRef.current) typeRef.current.value = fields.type;
    if (fields.title && titleRef.current && !titleRef.current.value) {
      titleRef.current.value = fields.title;
    }
    if (fields.provider && providerRef.current) providerRef.current.value = fields.provider;
    if (fields.date && dateRef.current) dateRef.current.value = fields.date;
    if (fields.cost && costRef.current) costRef.current.value = fields.cost;
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setScanning(true);
    setScanMessage(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/home/extract", { method: "POST", body });
      if (!res.ok) throw new Error("Extraction failed");

      const { fields } = (await res.json()) as { fields: ExtractedFields };
      if (Object.keys(fields).length === 0) {
        setScanMessage("Couldn't detect any fields from this document — fill them in manually.");
      } else {
        applyExtractedFields(fields);
        setScanMessage("Fields populated from the document — review before saving.");
      }
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
          <label htmlFor="file" className="flex items-center gap-2 text-sm font-medium">
            <Upload size={16} />
            Upload a receipt or invoice to auto-fill fields (optional)
          </label>
          <input
            type="file"
            id="file"
            name="file"
            accept=".pdf,.doc,.docx,image/*"
            onChange={handleFileChange}
            className="text-sm"
          />
          {scanning && <p className="text-sm text-foreground/60">Scanning document…</p>}
          {!scanning && scanMessage && (
            <p className="text-sm text-foreground/60">{scanMessage}</p>
          )}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Type" htmlFor="type">
          <SelectWrapper>
            <select
              ref={typeRef}
              id="type"
              name="type"
              required
              defaultValue={state?.values?.type ?? item?.type ?? HOME_ITEM_TYPES[0]}
              className={selectClass}
            >
              {HOME_ITEM_TYPES.map((value) => (
                <option key={value} value={value}>
                  {HOME_ITEM_TYPE_LABELS[value]}
                </option>
              ))}
            </select>
          </SelectWrapper>
        </Field>

        <Field label="Title" htmlFor="title">
          <input
            ref={titleRef}
            id="title"
            name="title"
            required
            defaultValue={state?.values?.title ?? item?.title}
            placeholder="e.g. Alarm ethernet module install"
            className={inputClass}
          />
        </Field>

        <Field label="Provider" htmlFor="provider">
          <input
            ref={providerRef}
            id="provider"
            name="provider"
            defaultValue={state?.values?.provider ?? item?.provider ?? ""}
            placeholder="e.g. Securitywise"
            className={inputClass}
          />
        </Field>

        <Field label="Date" htmlFor="date">
          <input
            ref={dateRef}
            id="date"
            name="date"
            type="date"
            defaultValue={state?.values?.date ?? toDateInputValue(item?.date)}
            className={inputClass}
          />
        </Field>

        <Field label="Cost" htmlFor="cost">
          <input
            ref={costRef}
            id="cost"
            name="cost"
            type="number"
            min={0}
            step="0.01"
            defaultValue={state?.values?.cost ?? item?.cost ?? ""}
            className={inputClass}
          />
        </Field>

        <Field label="Currency" htmlFor="currency">
          <input
            id="currency"
            name="currency"
            defaultValue={state?.values?.currency ?? item?.currency ?? "AUD"}
            maxLength={10}
            className={inputClass}
          />
        </Field>
      </div>

      <div className="flex items-center gap-2">
        <input
          id="isTaxDeductible"
          name="isTaxDeductible"
          type="checkbox"
          defaultChecked={
            state?.values?.isTaxDeductible != null
              ? state.values.isTaxDeductible === "on"
              : (item?.isTaxDeductible ?? false)
          }
          className="size-4 rounded border-border accent-accent"
        />
        <label htmlFor="isTaxDeductible" className="text-sm">
          Tax deductible
        </label>
      </div>

      <Field label="Notes" htmlFor="notes">
        <textarea
          id="notes"
          name="notes"
          rows={4}
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
