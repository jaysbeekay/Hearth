"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";

// #210 — shared detail field row, replacing the byte-identical `Detail`
// function that was copy-pasted across every record detail page. Consistent
// long-value wrapping everywhere, plus an optional copy-to-clipboard action
// for identifiers people need to quote verbatim (policy numbers, VINs,
// confirmation codes) rather than retype from a cramped mobile screen.
export function DetailField({
  label,
  value,
  copyable = false,
}: {
  label: string;
  value: string;
  copyable?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const isEmpty = value === "—" || value.trim() === "";

  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="flex items-center gap-1 text-sm font-medium">
        <span className="min-w-0 break-words">{value}</span>
        {copyable && !isEmpty && (
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(value).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
            aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
            className="shrink-0 rounded p-1 text-muted hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
        )}
      </dd>
    </div>
  );
}
