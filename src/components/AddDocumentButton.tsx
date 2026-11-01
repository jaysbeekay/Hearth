"use client";

import { useActionState, useEffect, useRef } from "react";
import { Upload } from "lucide-react";
import type { ActionState } from "@/lib/actions/contracts";
import { useCanWrite } from "@/components/CanWriteProvider";
import { showToast } from "@/components/Toast";
import { MAX_UPLOAD_BYTES } from "@/lib/uploadLimits";
import { buttonClass } from "@/lib/ui";

/**
 * #405 — the one "Add document" control on an entry row (a Trip segment,
 * Service or Maintenance record, Rental statement or Trade): a quiet text
 * button that opens the file picker and uploads the file as soon as it's
 * chosen. The Document lands untyped; its type is picked afterwards on its
 * row in the Document list. A record page keeps its single drop zone.
 */
export function AddDocumentButton({
  action,
  recordName,
  accept = ".pdf,.doc,.docx,image/*",
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  /** The entry's name, so each row's button has its own accessible name. */
  recordName: string;
  accept?: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, null);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const canWrite = useCanWrite();

  useEffect(() => {
    if (state?.success) {
      showToast(state.success);
      formRef.current?.reset();
    } else if (state?.error) {
      showToast(state.error, "error");
    }
  }, [state]);

  if (!canWrite) return null;

  return (
    <form ref={formRef} action={formAction}>
      <input
        ref={inputRef}
        type="file"
        name="file"
        accept={accept}
        hidden
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          if (!file) return;
          if (file.size > MAX_UPLOAD_BYTES) {
            showToast("File is too large (15MB max).", "error");
            e.currentTarget.value = "";
            return;
          }
          formRef.current?.requestSubmit();
        }}
      />
      <button
        type="button"
        disabled={pending}
        onClick={() => inputRef.current?.click()}
        aria-label={`Add document to ${recordName}`}
        className={buttonClass("quiet")}
      >
        <Upload size={16} aria-hidden />
        {pending ? "Uploading…" : "Add document"}
      </button>
    </form>
  );
}
