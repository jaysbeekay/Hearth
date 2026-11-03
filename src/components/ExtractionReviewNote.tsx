"use client";

import { useFormStatus } from "react-dom";
import { bannerClass, buttonClass, pillClass } from "@/lib/ui";

/**
 * #359 — shown above Save once a scan has filled fields in. Pressing Save is
 * the review, so the record saves confirmed with live reminders; "Save for
 * later review" is the opt-out, which keeps the record marked Needs review
 * with reminders held (its "0" overrides the form's hidden "1", see
 * extractionFieldsFromForm).
 */
export function ExtractionReviewNote({ fields }: { fields: AutoFilledField[] }) {
  const { pending } = useFormStatus();
  const fieldLabels = fields.map((field) => field.label);
  const count = fieldLabels.length;
  return (
    <div className={bannerClass("neutral", "space-y-2")}>
      <p>
        {count > 0
          ? `${count} ${count === 1 ? "field was" : "fields were"} auto-filled from the document.`
          : "Fields were auto-filled from the document."}{" "}
        Check the highlighted fields: saving confirms them.
      </p>
      {count > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Auto-filled fields">
          {fieldLabels.map((label) => (
            <li key={label} className={pillClass("accent")}>
              {label}
            </li>
          ))}
        </ul>
      )}
      <input type="hidden" name="confirmExtraction" value="1" />
      {/* Provenance for the per-field review panel (#331), used only if the
          record is saved for later review. */}
      <input
        type="hidden"
        name="extractionReviewFields"
        value={JSON.stringify(
          fields.map(({ fieldName, value, source }) => ({
            fieldName,
            value,
            source,
            confidence: source === "heuristic" ? 0.7 : 0.85,
          })),
        )}
      />
      <button
        type="submit"
        name="confirmExtraction"
        value="0"
        disabled={pending}
        className={buttonClass("quiet", {}, "-mx-2 px-2 text-sm text-muted underline underline-offset-2")}
      >
        Save for later review
      </button>
    </div>
  );
}

export interface AutoFilledField {
  fieldName: string;
  label: string;
  value: string;
  source: "heuristic" | "byok" | "llm";
}

/**
 * The fields a scan filled in (markAutoFilled tags each one), in form order,
 * with their visible label and the value the scan put there.
 */
export function autoFilledFields(
  form: HTMLFormElement | null | undefined,
  source: "heuristic" | "byok" | "llm",
): AutoFilledField[] {
  if (!form) return [];
  const fields: AutoFilledField[] = [];
  for (const el of form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    "[aria-describedby*='autofill-desc-']",
  )) {
    const label = el.id ? form.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
    const text = label?.textContent?.replace(/\s*\*\s*$/, "").trim();
    if (!text || !el.name || fields.some((field) => field.fieldName === el.name)) continue;
    fields.push({ fieldName: el.name, label: text, value: el.value, source });
  }
  return fields;
}
