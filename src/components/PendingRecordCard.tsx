"use client";

import Link from "next/link";
import { Clock, Trash2 } from "lucide-react";
import { deleteOperation, type QueuedOperation } from "@/lib/offlineQueue";

export function PendingRecordCard({
  op,
  title,
  subtitle,
  editHref,
  onDeleted,
}: {
  op: QueuedOperation;
  title: string;
  subtitle?: string;
  editHref: string;
  onDeleted: () => void;
}) {
  async function handleDelete() {
    if (!confirm(`Discard "${title}"? It hasn't synced yet, so nothing on the server is affected.`)) {
      return;
    }
    await deleteOperation(op.id);
    onDeleted();
  }

  return (
    <div className="min-w-0 rounded-lg border border-dashed border-border bg-surface p-4">
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
        <Clock size={12} />
        Pending sync
      </span>
      <p className="mt-1.5 truncate font-medium">{title}</p>
      {subtitle && <p className="truncate text-sm text-muted">{subtitle}</p>}

      <div className="mt-3 flex items-center gap-4 text-sm">
        <Link href={editHref} className="font-medium text-accent hover:underline">
          Edit
        </Link>
        <button
          type="button"
          onClick={handleDelete}
          className="flex items-center gap-1 text-danger hover:underline"
        >
          <Trash2 size={14} />
          Discard
        </button>
      </div>
    </div>
  );
}
