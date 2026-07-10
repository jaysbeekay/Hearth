"use client";

import { useActionState, useEffect, useRef } from "react";
import { Upload } from "lucide-react";
import type { ActionState } from "@/lib/actions/products";
import { SubmitButton } from "@/components/SubmitButton";
import { FormMessage } from "@/components/FormMessage";
import { SelectWrapper } from "@/components/SelectWrapper";

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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SelectWrapper>
          <select name="kind" defaultValue="OTHER" className="rounded-lg border border-border bg-background px-3 h-9 text-sm outline-none focus:border-accent appearance-none pr-8">
            <option value="INVOICE">Invoice</option>
            <option value="PHOTO">Photo</option>
            <option value="MANUAL">Manual</option>
            <option value="OTHER">Other</option>
          </select>
        </SelectWrapper>
        <input
          type="file"
          name="file"
          required
          accept=".pdf,.doc,.docx,image/*"
          className="flex-1 text-sm"
        />
        <SubmitButton className="shrink-0">
          <Upload size={16} className="mr-2" />
          Upload
        </SubmitButton>
      </div>
      <FormMessage error={state?.error} success={state?.success} />
    </form>
  );
}
