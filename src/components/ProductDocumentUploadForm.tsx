"use client";

import { useActionState, useEffect, useId, useRef } from "react";
import { Upload } from "lucide-react";
import type { ActionState } from "@/lib/actions/products";
import { SubmitButton } from "@/components/SubmitButton";
import { FormMessage } from "@/components/FormMessage";
import { SelectWrapper } from "@/components/SelectWrapper";
import { FileDropZone } from "@/components/FileDropZone";
import { DOCUMENT_CATEGORIES, DOCUMENT_CATEGORY_LABELS } from "@/lib/documents/categories";

export function ProductDocumentUploadForm({
  action,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, null);
  const formRef = useRef<HTMLFormElement>(null);
  const selectId = useId();

  useEffect(() => {
    if (state?.success) {
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      {/* #350 — one labelled select. This used to be two unlabelled
          selects both reading "Other" (a warranty-only "kind" plus the
          shared document type); the kind is now derived server-side from
          the type chosen here (addDocumentAction). */}
      <div className="space-y-1">
        <label htmlFor={selectId} className="text-sm font-medium">
          Document type
        </label>
        <SelectWrapper>
          <select
            id={selectId}
            name="documentCategory"
            defaultValue="OTHER"
            className="h-9 rounded-lg border border-border bg-background px-3 pr-8 text-sm outline-none appearance-none focus:border-accent"
          >
            {DOCUMENT_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {DOCUMENT_CATEGORY_LABELS[category]}
              </option>
            ))}
          </select>
        </SelectWrapper>
      </div>
      <FileDropZone name="file" required />
      <SubmitButton>
        <Upload size={16} className="mr-2" />
        Upload
      </SubmitButton>
      <FormMessage error={state?.error} success={state?.success} />
    </form>
  );
}
