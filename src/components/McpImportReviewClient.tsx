"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { approveMcpImports, rejectMcpImports, type ImportReviewResult } from "@/lib/actions/mcpImports";
import { formatDate } from "@/lib/utils";
import { useDateFormat } from "@/components/DateFormatProvider";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { Banner } from "@/components/ui/Banner";
import { Timestamp } from "@/components/Timestamp";
import { buttonClass, emptyStateClass, inlineLinkClass } from "@/lib/ui";

// Documents → Imports (#529): records an MCP agent proposed, waiting for a
// household member. Every field is shown in full, so a reviewer sees exactly
// what would be saved, including free text the agent wrote.

export interface ImportProposalView {
  id: string;
  kind: "CONTRACT" | "PRODUCT" | "INVENTORY_ITEM";
  summary: string;
  tokenLabel: string;
  createdAt: string;
  data: Record<string, unknown>;
  duplicates: { href: string; label: string }[];
}

const KIND_LABELS: Record<ImportProposalView["kind"], string> = {
  CONTRACT: "Contract",
  PRODUCT: "Product",
  INVENTORY_ITEM: "Inventory item",
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T/;

const LABEL_OVERRIDES = new Map<string, string>([
  ["isTaxDeductible", "Tax deductible"],
  ["noticePeriodDays", "Notice period (days)"],
  ["reminderDaysBefore", "Reminder thresholds (days)"],
]);

function fieldLabel(key: string): string {
  const override = LABEL_OVERRIDES.get(key);
  if (override) return override;
  const spaced = key.replace(/([A-Z])/g, " $1").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function displayValue(value: unknown, dateFormat: string): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" && ISO_DATE.test(value)) return formatDate(value, dateFormat);
  if (Array.isArray(value)) return value.join(", ");
  // Enum values (HOME_INSURANCE, AUTO_RENEW) read as words.
  if (typeof value === "string" && /^[A-Z][A-Z_]*$/.test(value) && value.length > 3) {
    const words = value.replace(/_/g, " ").toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
  }
  return String(value);
}

function resultMessage(verb: string, result: ImportReviewResult): string {
  const parts = [];
  if (result.ok > 0) parts.push(`${verb} ${result.ok}.`);
  for (const failure of result.failed) parts.push(failure.error);
  return parts.join(" ");
}

export function McpImportReviewClient({
  proposals,
  canWrite,
}: {
  proposals: ImportProposalView[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const dateFormat = useDateFormat();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  if (proposals.length === 0) {
    return (
      <p className={emptyStateClass()}>
        Nothing waiting. Records an MCP agent proposes for import appear here for you to approve.
      </p>
    );
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function review(ids: string[], approve: boolean) {
    startTransition(async () => {
      const result = approve ? await approveMcpImports(ids) : await rejectMcpImports(ids);
      setMessage({
        tone: result.failed.length > 0 ? "danger" : "success",
        text: resultMessage(approve ? "Imported" : "Rejected", result),
      });
      setSelected(new Set());
      router.refresh();
    });
  }

  const allSelected = selected.size === proposals.length;
  const selectedIds = [...selected];

  return (
    <div className="space-y-3">
      {message && (
        <Banner tone={message.tone} role="status">
          {message.text}
        </Banner>
      )}

      {canWrite && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="mr-auto flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => {
                setSelected(allSelected ? new Set() : new Set(proposals.map((p) => p.id)));
              }}
            />
            Select all
          </label>
          <button
            type="button"
            className={buttonClass("secondary")}
            disabled={pending || selected.size === 0}
            onClick={() => {
              review(selectedIds, true);
            }}
          >
            Approve selected ({selected.size})
          </button>
          <button
            type="button"
            className={buttonClass("danger")}
            disabled={pending || selected.size === 0}
            onClick={() => {
              review(selectedIds, false);
            }}
          >
            Reject selected
          </button>
        </div>
      )}

      <ul className="space-y-3">
        {proposals.map((proposal) => (
          <Card as="li" key={proposal.id} className="space-y-3">
            <div className="flex flex-wrap items-start gap-3">
              {canWrite && (
                <input
                  type="checkbox"
                  className="mt-1"
                  aria-label={`Select ${proposal.summary}`}
                  checked={selected.has(proposal.id)}
                  onChange={() => {
                    toggle(proposal.id);
                  }}
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill>{KIND_LABELS[proposal.kind]}</Pill>
                  <span className="font-medium">{proposal.summary || "(untitled)"}</span>
                </div>
                <p className="text-xs text-muted">
                  Proposed by MCP token “{proposal.tokenLabel}” on <Timestamp value={proposal.createdAt} />
                </p>
              </div>
              {canWrite && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={buttonClass("secondary")}
                    disabled={pending}
                    onClick={() => {
                      review([proposal.id], true);
                    }}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className={buttonClass("quiet")}
                    disabled={pending}
                    onClick={() => {
                      review([proposal.id], false);
                    }}
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>

            {proposal.duplicates.length > 0 && (
              <Banner tone="warning">
                Possible duplicate of{" "}
                {proposal.duplicates.map((dup, index) => (
                  <span key={dup.href}>
                    {index > 0 && ", "}
                    <Link href={dup.href} className={inlineLinkClass}>
                      {dup.label}
                    </Link>
                  </span>
                ))}
                . Approving creates a new record; nothing is merged.
              </Banner>
            )}

            <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[12rem_1fr]">
              {Object.entries(proposal.data)
                .filter(([, value]) => value !== undefined && value !== null && value !== "")
                .map(([key, value]) => (
                  <div key={key} className="contents">
                    <dt className="text-muted">{fieldLabel(key)}</dt>
                    <dd className="whitespace-pre-wrap break-words">{displayValue(value, dateFormat)}</dd>
                  </div>
                ))}
            </dl>
          </Card>
        ))}
      </ul>
    </div>
  );
}
