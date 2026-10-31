import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Trash2, Home, Package } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { addDocumentAction } from "@/lib/actions/documents";
import { documentFileHref } from "@/lib/documents/kinds";
import {
  deleteProduct,
  confirmProductExtraction,
  reviewProductExtraction,
  restoreProduct,
} from "@/lib/actions/products";
import { getPendingExtractionReview } from "@/lib/documents/extractionReview";
import { ExpiryBadge } from "@/components/ExpiryBadge";
import { ConfirmForm } from "@/components/ConfirmForm";
import { DetailOverflowMenu } from "@/components/DetailOverflowMenu";
import { DetailStatusBanner } from "@/components/DetailStatusBanner";
import { ExtractionReviewPanel } from "@/components/ExtractionReviewPanel";
import { DetailField as Detail } from "@/components/DetailField";
import { ProductDocumentUploadForm } from "@/components/ProductDocumentUploadForm";
import { DocumentList } from "@/components/DocumentList";
import { getTrashedVersionLinks } from "@/lib/documents/trashedVersionLinks";
import { RecordMeta } from "@/components/RecordMeta";
import { ReminderHealthCard } from "@/components/ReminderHealthCard";
import { getReminderHealth } from "@/lib/notifications/health";
import { DocFallbackBanner } from "@/components/DocFallbackBanner";
import { formatCurrency, formatDate } from "@/lib/utils";
import { getDueContext } from "@/lib/appSettings";
import { headlineEntry, warrantyDue } from "@/lib/dueRecords";
import { getUserPreferences } from "@/lib/userPreferences";
import { getHouseholdMemberCount } from "@/lib/household";
import { auth } from "@/lib/auth";
import { canWrite as sessionCanWrite } from "@/lib/readOnly";
import { BackLink } from "@/components/BackLink";
import { buttonClass } from "@/lib/buttonStyles";
import { Card } from "@/components/ui";
import { cardClass } from "@/lib/ui";

export default async function ProductDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ docFallback?: string }>;
}) {
  const { id } = await params;
  const canWrite = sessionCanWrite(await auth());
  const { docFallback } = await searchParams;
  const [product, { dateFormat, region }, memberCount, due] = await Promise.all([
    prisma.product.findUnique({
      where: { id },
      include: {
        documents: { where: { deletedAt: null }, orderBy: { uploadedAt: "desc" } },
        createdBy: true,
        updatedBy: true,
        property: true,
        warrantyForItems: { where: { deletedAt: null }, select: { id: true, label: true } },
      },
    }),
    getUserPreferences(),
    getHouseholdMemberCount(),
    getDueContext(),
  ]);
  if (!product || product.deletedAt) notFound();
  const trashedLinks = await getTrashedVersionLinks("PRODUCT", [product.id]);

  const pendingReview = product.extractionPending
    ? await getPendingExtractionReview("PRODUCT", product.id)
    : [];

  // #384 — from the Due policy: due soon, later, or Lapsed (never Expired).
  const dueEntries = warrantyDue(product, due);
  const boundUpload = addDocumentAction.bind(null, "PRODUCT", product.id);
  const reminderHealth = await getReminderHealth({
    ownerType: "PRODUCT",
    ownerId: product.id,
    record: { kind: "warranty", ...product },
  });
  const photo = product.documents.find(
    (doc) => doc.kind === "PHOTO" && doc.mimeType.startsWith("image/"),
  );

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <BackLink href="/products" label="Warranties" />
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted">
            {product.manufacturer ?? product.vendor ?? "Warranty"}
          </p>
          <h1 className="text-2xl font-medium">{product.description}</h1>
          {product.vendor && <p className="text-muted">{product.vendor}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExpiryBadge entry={headlineEntry(dueEntries)} empty="No warranty end date" />
          {canWrite && (
            <>
              <Link
                href={`/products/${product.id}/edit`}
                className={buttonClass("secondary")}
              >
                <Pencil size={16} />
                Edit
              </Link>
              <DetailOverflowMenu>
                <ConfirmForm
                  action={deleteProduct.bind(null, product.id)}
                  undo={{ action: restoreProduct.bind(null, product.id), href: `/products/${product.id}` }}
                  confirmText="Move this warranty to Trash? Its documents are kept, and you can restore it within 30 days from Settings → Trash."
                  className="flex w-full items-center gap-2 px-4 py-2 text-sm text-danger hover:bg-danger/10"
                  offline={{ entity: "product", entityId: product.id, label: `Delete warranty: ${product.description}` }}
                >
                  <Trash2 size={16} />
                  Delete
                </ConfirmForm>
              </DetailOverflowMenu>
            </>
          )}
        </div>
      </div>

      {photo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={documentFileHref(photo.id)}
          alt={product.description}
          className="max-h-80 w-full rounded-lg border border-border object-contain"
        />
      )}

      <DocFallbackBanner docFallback={docFallback} />

      <DetailStatusBanner
        entries={dueEntries}
        hasDocuments={product.documents.length > 0}
        documentsHref="#documents"
        editHref={`/products/${product.id}/edit`}
        renewLabel="Review warranty"
        needsReview={
          product.extractionPending && pendingReview.length === 0
            ? { onConfirm: confirmProductExtraction.bind(null, product.id) }
            : undefined
        }
      />

      {pendingReview.length > 0 && (
        <ExtractionReviewPanel fields={pendingReview} action={reviewProductExtraction.bind(null, product.id)} />
      )}

      <Card>
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
      </Card>

      {product.warrantyEndDate && (
        <ReminderHealthCard
          health={reminderHealth}
          dateFormat={dateFormat}
          testTarget={{ kind: "warranty", id: product.id }}
        />
      )}

      {(product.property || product.warrantyForItems.length > 0) && (
        <Card>
          <h2 className="mb-3 font-medium">Linked to</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {product.property && (
              <Link
                href={`/home/${product.property.id}`}
                className={cardClass("flex items-center gap-3 transition-colors hover:bg-hover-surface")}
              >
                <Home size={16} className="text-muted" />
                <span>
                  <span className="block text-sm font-medium">{product.property.label}</span>
                  <span className="block text-xs text-muted">Property</span>
                </span>
              </Link>
            )}
            {product.warrantyForItems.map((invItem) => (
              <Link
                key={invItem.id}
                href={`/inventory/${invItem.id}`}
                className={cardClass("flex items-center gap-3 transition-colors hover:bg-hover-surface")}
              >
                <Package size={16} className="text-muted" />
                <span>
                  <span className="block text-sm font-medium">{invItem.label}</span>
                  <span className="block text-xs text-muted">Inventory item — warranty registered here</span>
                </span>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {product.notes && (
        <Card>
          <h2 className="mb-2 font-medium">Notes</h2>
          <p className="whitespace-pre-wrap text-sm text-foreground">{product.notes}</p>
        </Card>
      )}

      <Card id="documents" className="scroll-mt-20">
        <h2 className="mb-3 font-medium">Documents</h2>
        <DocumentList kind="PRODUCT" ownerId={product.id} documents={product.documents} trashedLinks={trashedLinks.get(product.id)} />
        {canWrite && (
          <div className="mt-4 border-t border-border pt-4">
            <ProductDocumentUploadForm action={boundUpload} />
          </div>
        )}
      </Card>

      <RecordMeta
        createdByName={product.createdBy.name}
        updatedByName={product.updatedBy?.name}
        createdAt={product.createdAt}
        updatedAt={product.updatedAt}
        extractionConfirmedAt={product.extractionConfirmedAt}
        memberCount={memberCount}
      />
    </div>
  );
}
