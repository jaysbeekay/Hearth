"use client";

import { useActionState, useEffect, useRef } from "react";
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

  useEffect(() => {
    if (state?.success) {
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <SelectWrapper>
        <select name="kind" defaultValue="OTHER" className="rounded-lg border border-border bg-background px-3 h-9 text-sm outline-none focus:border-accent appearance-none pr-8">
          <option value="INVOICE">Invoice</option>
          <option value="PHOTO">Photo</option>
          <option value="MANUAL">Manual</option>
          <option value="OTHER">Other</option>
        </select>
      </SelectWrapper>
      <SelectWrapper>
        <select
          name="documentCategory"
          defaultValue="OTHER"
          aria-label="Document type"
          className="h-9 rounded-lg border border-border bg-background px-3 pr-8 text-sm outline-none appearance-none focus:border-accent"
        >
          {DOCUMENT_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {DOCUMENT_CATEGORY_LABELS[category]}
            </option>
          ))}
        </select>
      </SelectWrapper>
      <FileDropZone name="file" required />
      <SubmitButton>
        <Upload size={16} className="mr-2" />
        Upload
      </SubmitButton>
      <FormMessage error={state?.error} success={state?.success} />
    </form>
  );
}
