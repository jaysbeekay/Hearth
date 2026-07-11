"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Upload, FileText, X } from "lucide-react";
import { cn, humanFileSize } from "@/lib/utils";
import { MAX_UPLOAD_BYTES } from "@/lib/uploadLimits";

export function FileDropZone({
  name = "file",
  accept = ".pdf,.doc,.docx,image/*",
  required,
  onFileSelected,
  label = "Drag a file here or click to browse",
  hint = "PDF, Word, or image — up to 15MB",
}: {
  name?: string;
  accept?: string;
  required?: boolean;
  onFileSelected?: (file: File | null) => void;
  label?: string;
  hint?: string;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  function applyFile(f: File) {
    if (f.size > MAX_UPLOAD_BYTES) {
      setError("File is too large (15MB max).");
      setFile(null);
      onFileSelected?.(null);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setError(null);
    setFile(f);
    onFileSelected?.(f);

    // Keep the actual <input type="file"> in sync via DataTransfer so a
    // drag-and-drop drop still submits under `name` like a normal file pick.
    const dt = new DataTransfer();
    dt.items.add(f);
    if (inputRef.current) inputRef.current.files = dt.files;
  }

  function clearFile() {
    setFile(null);
    setError(null);
    onFileSelected?.(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  // Native form.reset() clears the underlying <input> but not our own
  // React state (filename/error), so sync explicitly.
  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;
    const onFormReset = () => {
      setFile(null);
      setError(null);
      onFileSelected?.(null);
    };
    form.addEventListener("reset", onFormReset);
    return () => form.removeEventListener("reset", onFormReset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-2">
      <label
        htmlFor={inputId}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) applyFile(f);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-6 text-center transition",
          dragOver ? "border-accent bg-accent/5" : "border-border hover:border-accent/50",
        )}
      >
        <Upload size={20} className="text-muted" />
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted">{hint}</p>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          name={name}
          accept={accept}
          required={required && !file}
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) applyFile(f);
          }}
        />
      </label>
      {file && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
          <FileText size={16} className="shrink-0 text-muted" />
          <span className="min-w-0 flex-1 truncate">{file.name}</span>
          <span className="shrink-0 text-xs text-muted">{humanFileSize(file.size)}</span>
          <button
            type="button"
            onClick={clearFile}
            aria-label={`Remove ${file.name}`}
            className="shrink-0 rounded p-1 text-muted hover:text-danger"
          >
            <X size={14} />
          </button>
        </div>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
