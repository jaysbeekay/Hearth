"use client";

import { useActionState, useEffect, useRef } from "react";
import { Upload } from "lucide-react";
import type { ActionState } from "@/lib/actions/contracts";
import { SubmitButton } from "@/components/SubmitButton";
import { FormMessage } from "@/components/FormMessage";
import { FileDropZone } from "@/components/FileDropZone";

export function DocumentUploadForm({
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
      <FileDropZone name="file" required />
      <SubmitButton>
        <Upload size={16} className="mr-2" />
        Upload
      </SubmitButton>
      <FormMessage error={state?.error} success={state?.success} />
    </form>
  );
}
