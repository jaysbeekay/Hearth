"use client";

import { useActionState, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { Upload } from "lucide-react";
import type { TripSegmentModel } from "@/generated/prisma/models";
import type { ActionState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";
import { FormMessage } from "@/components/FormMessage";
import { TRIP_SEGMENT_TYPES } from "@/lib/validation/travel";
import { TRIP_SEGMENT_TYPE_LABELS } from "@/lib/utils";
import { SelectWrapper, selectClass } from "@/components/SelectWrapper";

type SegmentType = (typeof TRIP_SEGMENT_TYPES)[number];

function toDateInputValue(date: Date | null | undefined) {
  if (!date) return "";
  return new Date(date).toISOString().slice(0, 10);
}

type ExtractedFields = Partial<
  Record<
    | "type"
    | "title"
    | "provider"
    | "confirmationCode"
    | "startDate"
    | "endDate"
    | "location"
    | "cost"
    | "flightNumber"
    | "departureIata"
    | "arrivalIata",
    string
  >
>;

export function TripSegmentForm({
  action,
  segment,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  segment?: TripSegmentModel;
}) {
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);

  const [selectedType, setSelectedType] = useState<SegmentType>(
    segment?.type ?? TRIP_SEGMENT_TYPES[0],
  );

  const [state, formAction] = useActionState<ActionState, FormData>(action, null);

  const typeRef = useRef<HTMLSelectElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const providerRef = useRef<HTMLInputElement>(null);
  const confirmationCodeRef = useRef<HTMLInputElement>(null);
  const startDateRef = useRef<HTMLInputElement>(null);
  const endDateRef = useRef<HTMLInputElement>(null);
  const locationRef = useRef<HTMLInputElement>(null);
  const costRef = useRef<HTMLInputElement>(null);
  const flightNumberRef = useRef<HTMLInputElement>(null);
  const departureIataRef = useRef<HTMLInputElement>(null);
  const arrivalIataRef = useRef<HTMLInputElement>(null);

  function applyExtractedFields(fields: ExtractedFields) {
    if (fields.type && typeRef.current) {
      typeRef.current.value = fields.type;
      setSelectedType(fields.type as SegmentType);
    }
    if (fields.title && titleRef.current && !titleRef.current.value) {
      titleRef.current.value = fields.title;
    }
    if (fields.provider && providerRef.current) providerRef.current.value = fields.provider;
    if (fields.confirmationCode && confirmationCodeRef.current) {
      confirmationCodeRef.current.value = fields.confirmationCode;
    }
    if (fields.startDate && startDateRef.current) startDateRef.current.value = fields.startDate;
    if (fields.endDate && endDateRef.current) endDateRef.current.value = fields.endDate;
    if (fields.location && locationRef.current) locationRef.current.value = fields.location;
    if (fields.cost && costRef.current) costRef.current.value = fields.cost;
    if (fields.flightNumber && flightNumberRef.current)
      flightNumberRef.current.value = fields.flightNumber;
    if (fields.departureIata && departureIataRef.current)
      departureIataRef.current.value = fields.departureIata;
    if (fields.arrivalIata && arrivalIataRef.current)
      arrivalIataRef.current.value = fields.arrivalIata;
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setScanning(true);
    setScanMessage(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/travel/extract", { method: "POST", body });
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
      {!segment && (
        <div className="space-y-2 rounded-lg border border-dashed border-border p-4">
          <label htmlFor="file" className="flex items-center gap-2 text-sm font-medium">
            <Upload size={16} />
            Upload a document to auto-fill fields (optional)
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
              defaultValue={selectedType}
              onChange={(e) => setSelectedType(e.target.value as SegmentType)}
              className={selectClass}
            >
              {TRIP_SEGMENT_TYPES.map((value) => (
                <option key={value} value={value}>
                  {TRIP_SEGMENT_TYPE_LABELS[value]}
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
            defaultValue={state?.values?.title ?? segment?.title}
            placeholder="e.g. QF12 Sydney to Tokyo"
            className={inputClass}
          />
        </Field>

        <Field label="Provider" htmlFor="provider">
          <input
            ref={providerRef}
            id="provider"
            name="provider"
            defaultValue={state?.values?.provider ?? segment?.provider ?? ""}
            placeholder="e.g. Qantas, Hilton"
            className={inputClass}
          />
        </Field>

        <Field label="Confirmation code" htmlFor="confirmationCode">
          <input
            ref={confirmationCodeRef}
            id="confirmationCode"
            name="confirmationCode"
            defaultValue={state?.values?.confirmationCode ?? segment?.confirmationCode ?? ""}
            className={inputClass}
          />
        </Field>

        <Field label="Start date" htmlFor="startDate">
          <input
            ref={startDateRef}
            id="startDate"
            name="startDate"
            type="date"
            defaultValue={state?.values?.startDate ?? toDateInputValue(segment?.startDate)}
            className={inputClass}
          />
        </Field>

        <Field label="End date" htmlFor="endDate">
          <input
            ref={endDateRef}
            id="endDate"
            name="endDate"
            type="date"
            defaultValue={state?.values?.endDate ?? toDateInputValue(segment?.endDate)}
            className={inputClass}
          />
        </Field>

        <Field label="Location" htmlFor="location">
          <input
            ref={locationRef}
            id="location"
            name="location"
            defaultValue={state?.values?.location ?? segment?.location ?? ""}
            placeholder="e.g. Narita International Airport"
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
            defaultValue={state?.values?.cost ?? segment?.cost ?? ""}
            className={inputClass}
          />
        </Field>

        <Field label="Currency" htmlFor="currency">
          <input
            id="currency"
            name="currency"
            defaultValue={state?.values?.currency ?? segment?.currency ?? "AUD"}
            maxLength={10}
            className={inputClass}
          />
        </Field>

        {selectedType === "FLIGHT" && (
          <>
            <Field label="Flight number" htmlFor="flightNumber">
              <input
                ref={flightNumberRef}
                id="flightNumber"
                name="flightNumber"
                defaultValue={state?.values?.flightNumber ?? segment?.flightNumber ?? ""}
                placeholder="e.g. QF12"
                className={inputClass}
              />
            </Field>

            <Field label="Departure airport (IATA)" htmlFor="departureIata">
              <input
                ref={departureIataRef}
                id="departureIata"
                name="departureIata"
                defaultValue={state?.values?.departureIata ?? segment?.departureIata ?? ""}
                placeholder="e.g. SYD"
                maxLength={4}
                className={inputClass}
              />
            </Field>

            <Field label="Arrival airport (IATA)" htmlFor="arrivalIata">
              <input
                ref={arrivalIataRef}
                id="arrivalIata"
                name="arrivalIata"
                defaultValue={state?.values?.arrivalIata ?? segment?.arrivalIata ?? ""}
                placeholder="e.g. NRT"
                maxLength={4}
                className={inputClass}
              />
            </Field>
          </>
        )}
      </div>

      <Field label="Notes" htmlFor="notes">
        <textarea
          id="notes"
          name="notes"
          rows={4}
          defaultValue={state?.values?.notes ?? segment?.notes ?? ""}
          className={inputClass}
        />
      </Field>

      <FormMessage error={state?.error} success={state?.success} />

      <div className="flex justify-end gap-3">
        <SubmitButton>{segment ? "Save changes" : "Add segment"}</SubmitButton>
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
