import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { deleteInventoryItem, addInventoryItemDocument } from "@/lib/actions/inventory";
import { ConfirmForm } from "@/components/ConfirmForm";
import { DocumentUploadForm } from "@/components/DocumentUploadForm";
import { InventoryItemDocumentList } from "@/components/InventoryItemDocumentList";
import { formatCurrency, formatDate } from "@/lib/utils";
import { getUserPreferences } from "@/lib/userPreferences";

export const metadata: Metadata = { title: "Inventory Item" };

const CATEGORY_LABELS: Record<string, string> = {
  APPLIANCE: "Appliance",
  ELECTRONICS: "Electronics",
  FURNITURE: "Furniture",
  TOOL: "Tool",
  CLOTHING: "Clothing",
  SPORTING: "Sporting",
  BOOK: "Book",
  MEDIA: "Media",
  OTHER: "Other",
};

export default async function InventoryItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireModuleEnabled("INVENTORY");

  const { id } = await params;
  const [item, { dateFormat }] = await Promise.all([
    prisma.inventoryItem.findUnique({
      where: { id },
      include: {
        createdBy: true,
        documents: { orderBy: { uploadedAt: "desc" } },
      },
    }),
    getUserPreferences(),
  ]);
  if (!item) notFound();

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Link href="/inventory" className="text-sm text-foreground/60 hover:text-foreground">
          ← Back to inventory
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted">{CATEGORY_LABELS[item.category] ?? item.category}</p>
          <h1 className="text-2xl font-semibold">{item.label}</h1>
          {(item.brand || item.model) && (
            <p className="text-muted">{[item.brand, item.model].filter(Boolean).join(" · ")}</p>
          )}
        </div>
        <div className="flex gap-2">
          <Link
            href={`/inventory/${id}/edit`}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/5"
          >
            <Pencil size={14} />
            Edit
          </Link>
          <ConfirmForm
            action={deleteInventoryItem.bind(null, id)}
            confirmText="Delete this item and all its documents?"
            className="flex items-center gap-1.5 rounded-lg border border-danger/40 px-3 py-1.5 text-sm text-danger hover:bg-danger/5"
          >
            <Trash2 size={14} />
            Delete
          </ConfirmForm>
        </div>
      </div>

      <section className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <dl className="grid grid-cols-2 gap-4 text-sm">
          {item.serialNumber && (
            <div>
              <dt className="text-xs text-muted">Serial number</dt>
              <dd className="font-medium font-mono">{item.serialNumber}</dd>
            </div>
          )}
          {item.location && (
            <div>
              <dt className="text-xs text-muted">Location</dt>
              <dd className="font-medium">{item.location}</dd>
            </div>
          )}
          {item.purchaseDate && (
            <div>
              <dt className="text-xs text-muted">Purchased</dt>
              <dd className="font-medium">{formatDate(item.purchaseDate, dateFormat)}</dd>
            </div>
          )}
          {item.purchasePrice != null && (
            <div>
              <dt className="text-xs text-muted">Purchase price</dt>
              <dd className="font-medium">{formatCurrency(item.purchasePrice, item.currency)}</dd>
            </div>
          )}
        </dl>
        {item.notes && (
          <p className="mt-4 whitespace-pre-wrap text-sm text-foreground/70">{item.notes}</p>
        )}
      </section>

      <section className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <h2 className="mb-3 font-medium">Documents</h2>
        <InventoryItemDocumentList documents={item.documents} dateFormat={dateFormat} />
        <div className="mt-4 border-t border-border pt-4">
          <DocumentUploadForm action={addInventoryItemDocument.bind(null, id)} />
        </div>
      </section>
    </div>
  );
}
