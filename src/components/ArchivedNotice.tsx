import Link from "next/link";
import { StatusPill } from "@/components/StatusPill";
import { formatDate } from "@/lib/utils";

// #355 — the note at the top of an Archived Vehicle's or Property's page.
// `children` is the Restore button, for a member who can write.
export function ArchivedNotice({
  archivedAt,
  dateFormat,
  effect,
  activeContracts = [],
  children,
}: {
  archivedAt: Date;
  dateFormat?: string;
  /** What stops, as a full sentence: "Reminders and Needs attention no longer include its rego…". */
  effect?: string;
  /** Contracts still Active and linked to it: archiving doesn't end them. */
  activeContracts?: { id: string; title: string }[];
  children?: React.ReactNode;
}) {
  return (
    <div
      data-testid="archived-notice"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/10 px-4 py-3 text-sm"
    >
      <div className="space-y-1">
        <p className="flex flex-wrap items-center gap-2">
          <StatusPill status="archived">Archived</StatusPill>
          <span className="text-muted">
            Archived on {formatDate(archivedAt, dateFormat)}.{effect ? ` ${effect}` : ""}
          </span>
        </p>
        {activeContracts.length > 0 && (
          <p className="text-muted" data-testid="archived-linked-contracts">
            {activeContracts.length} active {activeContracts.length === 1 ? "contract is" : "contracts are"} still
            linked:{" "}
            {activeContracts.map((contract, index) => (
              <span key={contract.id}>
                {index > 0 && ", "}
                <Link href={`/contracts/${contract.id}`} className="text-accent hover:underline">
                  {contract.title}
                </Link>
              </span>
            ))}
            . Cancel {activeContracts.length === 1 ? "it" : "them"} if {activeContracts.length === 1 ? "it" : "they"}{" "}
            ended too.
          </p>
        )}
      </div>
      {children}
    </div>
  );
}
