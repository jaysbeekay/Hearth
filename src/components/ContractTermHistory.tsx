import { FileText } from "lucide-react";
import { DocumentLink } from "@/components/DocumentLink";
import { documentFileHref } from "@/lib/documents/kinds";
import { formatTermCost, formatTermCostChange, termCostChange, type TermCost } from "@/lib/contractTerms";
import { formatDate } from "@/lib/utils";

export interface HistoryTerm extends TermCost {
  id: string;
  startDate: Date | null;
  endDate: Date | null;
  document: { id: string; filename: string; mimeType: string; size: number; deletedAt: Date | null } | null;
}

// #353 — a Contract's earlier Terms, newest first: each one's dates, cost,
// how its cost compares with the Term before it, and its Document. Shown
// only once the Contract has been renewed.
export function ContractTermHistory({
  terms,
  dateFormat,
  region,
}: {
  /** Newest first. */
  terms: HistoryTerm[];
  dateFormat?: string | null;
  region?: string;
}) {
  if (terms.length === 0) return null;
  return (
    <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
      <h2 className="mb-3 font-medium">Previous terms</h2>
      <ul className="divide-y divide-border">
        {terms.map((term, index) => {
          const change = termCostChange(term, terms.at(index + 1));
          const document = term.document && !term.document.deletedAt ? term.document : null;
          return (
            <li key={term.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 text-sm">
              <span className="font-medium">
                {formatDate(term.startDate, dateFormat)} – {formatDate(term.endDate, dateFormat)}
              </span>
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>{formatTermCost(term, region)}</span>
                {change != null && <span className="text-muted">{formatTermCostChange(change)}</span>}
                {document && (
                  <DocumentLink
                    href={documentFileHref(document.id)}
                    filename={document.filename}
                    mimeType={document.mimeType}
                    size={document.size}
                    className="inline-flex min-w-0 items-center gap-1 text-accent hover:underline"
                  >
                    <FileText size={14} className="shrink-0" />
                    <span className="max-w-48 truncate">{document.filename}</span>
                  </DocumentLink>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
