import { statusPillClass, statusTone, type RecordStatus } from "@/lib/statusTone";

// #412 — a record's status as a pill, in the tone statusTone gives it: the
// one place a status pill's look is decided. A `later` date reads as plain
// muted text, without a pill.
export function StatusPill({ status, children }: { status: RecordStatus; children: React.ReactNode }) {
  return <span className={statusPillClass(statusTone(status))}>{children}</span>;
}
