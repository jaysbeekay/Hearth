"use client";

import { useActionState, useRef, useState } from "react";
import { Upload } from "lucide-react";
import type { TripSegmentModel } from "@/generated/prisma/models";
import type { ActionState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";
import { FormMessage } from "@/components/FormMessage";
import { TRIP_SEGMENT_TYPES } from "@/lib/validation/travel";
import { TRIP_SEGMENT_TYPE_LABELS } from "@/lib/utils";
import { SelectWrapper, selectClass } from "@/components/SelectWrapper";
import { CurrencySelect } from "@/components/CurrencySelect";
import { FileDropZone } from "@/components/FileDropZone";
import { markAutoFilled, extractionMessage } from "@/lib/autoFillHighlight";
import { makeOfflineAwareAction } from "@/lib/offlineQueue";

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
  tripId,
  defaultCurrency,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  segment?: TripSegmentModel;
  tripId?: string;
  defaultCurrency?: string;
}) {
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);

  const [selectedType, setSelectedType] = useState<SegmentType>(
    segment?.type ?? TRIP_SEGMENT_TYPES[0],
  );

  const offlineAwareAction = makeOfflineAwareAction(
    action,
    () => ({
      label: segment ? `Update segment: ${segment.title}` : "Add trip segment",
      entity: "tripSegment",
      operation: segment ? "update" : "create",
      entityId: segment?.id,
      parentId: segment?.tripId ?? tripId,
    }),
    { success: "Saved offline — will sync when you reconnect." },
  );

  const [state, formAction] = useActionState<ActionState, FormData>(offlineAwareAction, null);

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
      markAutoFilled(typeRef.current);
    }
    if (fields.title && titleRef.current && !titleRef.current.value) {
      titleRef.current.value = fields.title;
      markAutoFilled(titleRef.current);
    }
    if (fields.provider && providerRef.current) {
      providerRef.current.value = fields.provider;
      markAutoFilled(providerRef.current);
    }
    if (fields.confirmationCode && confirmationCodeRef.current) {
      confirmationCodeRef.current.value = fields.confirmationCode;
      markAutoFilled(confirmationCodeRef.current);
    }
    if (fields.startDate && startDateRef.current) {
      startDateRef.current.value = fields.startDate;
      markAutoFilled(startDateRef.current);
    }
    if (fields.endDate && endDateRef.current) {
      endDateRef.current.value = fields.endDate;
      markAutoFilled(endDateRef.current);
    }
    if (fields.location && locationRef.current) {
      locationRef.current.value = fields.location;
      markAutoFilled(locationRef.current);
    }
    if (fields.cost && costRef.current) {
      costRef.current.value = fields.cost;
      markAutoFilled(costRef.current);
    }
    if (fields.flightNumber && flightNumberRef.current) {
      flightNumberRef.current.value = fields.flightNumber;
      markAutoFilled(flightNumberRef.current);
    }
    if (fields.departureIata && departureIataRef.current) {
      departureIataRef.current.value = fields.departureIata;
      markAutoFilled(departureIataRef.current);
    }
    if (fields.arrivalIata && arrivalIataRef.current) {
      arrivalIataRef.current.value = fields.arrivalIata;
      markAutoFilled(arrivalIataRef.current);
    }
  }

  async function handleFileChange(file: File | null) {
    if (!file) return;

    setScanning(true);
    setScanMessage(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/travel/extract", { method: "POST", body });
      if (!res.ok) throw new Error("Extraction failed");

      const { fields, source } = (await res.json()) as {
        fields: ExtractedFields;
        source: "byok" | "heuristic" | "llm" | "none";
      };
      const filledCount = Object.keys(fields).length;
      if (filledCount > 0) applyExtractedFields(fields);
      setScanMessage(extractionMessage(source, filledCount));
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
          <p className="flex items-center gap-2 text-sm font-medium">
            <Upload size={16} />
            Save time: upload a document and Hearth fills in the details
          </p>
          <FileDropZone name="file" onFileSelected={handleFileChange} />
          {scanning && (
            <p role="status" aria-live="polite" className="text-sm text-foreground/60">
              Scanning document…
            </p>
          )}
          {!scanning && scanMessage && (
            <p role="status" aria-live="polite" className="text-sm text-foreground/60">
              {scanMessage}
            </p>
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
          <CurrencySelect
            name="currency"
            defaultValue={state?.values?.currency ?? segment?.currency ?? defaultCurrency}
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
