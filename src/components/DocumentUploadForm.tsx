"use client";

import { useActionState, useEffect, useId, useRef } from "react";
import { Upload } from "lucide-react";
import type { ActionState } from "@/lib/actions/contracts";
import { SubmitButton } from "@/components/SubmitButton";
import { FormMessage } from "@/components/FormMessage";
import { FileDropZone } from "@/components/FileDropZone";
import { SelectWrapper, selectClass } from "@/components/SelectWrapper";
import { DOCUMENT_CATEGORIES, DOCUMENT_CATEGORY_LABELS } from "@/lib/documents/categories";
import { useCanWrite } from "@/components/CanWriteProvider";

export function DocumentUploadForm({
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

  // Read-only members can't write, so they get no form (#400).
  const canWrite = useCanWrite();
  if (!canWrite) return null;

  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <div className="space-y-1">
        <label htmlFor={selectId} className="text-sm font-medium">
          Document type
        </label>
        <SelectWrapper>
          {/* #403 — shared selectClass (w-full) so the select fills the
              wrapper and the chevron sits on the control, not the card. */}
          <select
            id={selectId}
            name="documentCategory"
            defaultValue="OTHER"
            className={selectClass}
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
