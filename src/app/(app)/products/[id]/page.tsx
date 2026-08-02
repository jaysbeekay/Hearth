import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { prisma } from "@/lib/prisma";
import {
  addProductDocument,
  deleteProduct,
  confirmProductExtraction,
} from "@/lib/actions/products";
import { ExpiryBadge } from "@/components/ExpiryBadge";
import { ConfirmForm } from "@/components/ConfirmForm";
import { DetailOverflowMenu } from "@/components/DetailOverflowMenu";
import { DetailStatusBanner } from "@/components/DetailStatusBanner";
import { DetailField as Detail } from "@/components/DetailField";
import { ProductDocumentUploadForm } from "@/components/ProductDocumentUploadForm";
import { ProductDocumentList } from "@/components/ProductDocumentList";
import { RecordMeta } from "@/components/RecordMeta";
import { ReminderHealthCard } from "@/components/ReminderHealthCard";
import { getReminderHealth } from "@/lib/notifications/health";
import { DocFallbackBanner } from "@/components/DocFallbackBanner";
import { daysUntil, formatCurrency, formatDate } from "@/lib/utils";
import { getUserPreferences } from "@/lib/userPreferences";

export default async function ProductDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ docFallback?: string }>;
}) {
  const { id } = await params;
  const { docFallback } = await searchParams;
  const [product, { dateFormat, region }] = await Promise.all([
    prisma.product.findUnique({
      where: { id },
      include: { documents: { orderBy: { uploadedAt: "desc" } }, createdBy: true },
    }),
    getUserPreferences(),
  ]);
  if (!product) notFound();

  const days = daysUntil(product.warrantyEndDate);
  const boundUpload = addProductDocument.bind(null, product.id);
  const reminderHealth = await getReminderHealth({
    ownerType: "PRODUCT",
    ownerId: product.id,
    targetDate: product.warrantyEndDate,
    reminderDaysBefore: product.reminderDaysBefore,
  });
  const photo = product.documents.find(
    (doc) => doc.kind === "PHOTO" && doc.mimeType.startsWith("image/"),
  );

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href="/products" className="text-sm text-foreground/60 hover:text-foreground">
          ← Back to products
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-foreground/60">
            {product.manufacturer ?? product.vendor ?? "Product"}
          </p>
          <h1 className="text-2xl font-semibold">{product.description}</h1>
          {product.vendor && <p className="text-foreground/70">{product.vendor}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExpiryBadge days={days} />
          <Link
            href={`/products/${product.id}/edit`}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5"
          >
            <Pencil size={16} />
            Edit
          </Link>
          <DetailOverflowMenu>
            <ConfirmForm
              action={deleteProduct.bind(null, product.id)}
              confirmText="Delete this warranty and all its documents? This cannot be undone."
              className="flex w-full items-center gap-2 px-4 py-2 text-sm text-danger hover:bg-danger/10"
              offline={{ entity: "product", entityId: product.id, label: `Delete product: ${product.description}` }}
            >
              <Trash2 size={16} />
              Delete
            </ConfirmForm>
          </DetailOverflowMenu>
        </div>
      </div>

      {photo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/products/documents/${photo.id}`}
          alt={product.description}
          className="max-h-80 w-full rounded-xl border border-border object-contain"
        />
      )}

      <DocFallbackBanner docFallback={docFallback} />

      <DetailStatusBanner
        days={days}
        hasDocuments={product.documents.length > 0}
        documentsHref="#documents"
        editHref={`/products/${product.id}/edit`}
        renewLabel="Review warranty"
        needsReview={
          product.extractionPending
            ? { onConfirm: confirmProductExtraction.bind(null, product.id) }
            : undefined
        }
      />

      <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <dl className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <Detail label="Brand" value={product.manufacturer ?? "—"} />
          <Detail label="Model" value={product.model ?? "—"} />
          <Detail label="Vendor / retailer" value={product.vendor ?? "—"} />
          <Detail label="Serial number" value={product.serialNumber ?? "—"} copyable />
          <Detail label="Barcode" value={product.barcode ?? "—"} copyable />
          <Detail label="Purchase date" value={formatDate(product.purchaseDate, dateFormat)} />
          <Detail label="Warranty end date" value={formatDate(product.warrantyEndDate, dateFormat)} />
          <Detail
            label="Price"
            value={product.price != null ? formatCurrency(product.price, product.currency, undefined, region) : "—"}
          />
        </dl>
      </div>

      {product.warrantyEndDate && (
        <ReminderHealthCard health={reminderHealth} dateFormat={dateFormat} />
      )}

      {product.notes && (
        <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
          <h2 className="mb-2 font-medium">Notes</h2>
          <p className="whitespace-pre-wrap text-sm text-foreground/80">{product.notes}</p>
        </div>
      )}

      <div id="documents" className="scroll-mt-20 rounded-xl border border-border bg-surface p-4 md:p-6">
        <h2 className="mb-3 font-medium">Documents</h2>
        <ProductDocumentList documents={product.documents} dateFormat={dateFormat} />
        <div className="mt-4 border-t border-border pt-4">
          <ProductDocumentUploadForm action={boundUpload} />
        </div>
      </div>

      <RecordMeta
        createdByName={product.createdBy.name}
        createdAt={product.createdAt}
        updatedAt={product.updatedAt}
        dateFormat={dateFormat}
        extractionConfirmedAt={product.extractionConfirmedAt}
      />
    </div>
  );
}
