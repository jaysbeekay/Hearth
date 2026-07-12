import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Trash2, Plus, Wrench, Sparkles, Hammer, Tag, Home, TrendingUp, AlertTriangle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { deleteProperty, deleteHomeItem, addItemDocument } from "@/lib/actions/home";
import { addPropertyValuation, deletePropertyValuation } from "@/lib/actions/wealth";
import { ConfirmForm } from "@/components/ConfirmForm";
import { DetailOverflowMenu } from "@/components/DetailOverflowMenu";
import { DocumentUploadForm } from "@/components/DocumentUploadForm";
import { HomeItemDocumentList } from "@/components/HomeItemDocumentList";
import { RecordMeta } from "@/components/RecordMeta";
import { PropertyMap } from "@/components/PropertyMap";
import { HOME_ITEM_TYPE_LABELS, formatCurrency, formatDate } from "@/lib/utils";
import { CurrencySelect } from "@/components/CurrencySelect";
import { getUserPreferences } from "@/lib/userPreferences";

const ITEM_ICONS: Record<string, LucideIcon> = {
  MAINTENANCE: Wrench,
  IMPROVEMENT: Sparkles,
  REPAIR: Hammer,
  OTHER: Tag,
};

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function isValuationStale(valuedAt: Date) {
  return Date.now() - valuedAt.getTime() > ONE_YEAR_MS;
}

export default async function PropertyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireModuleEnabled("HOME");

  const { id } = await params;
  const [property, { dateFormat, preferredCurrency }] = await Promise.all([
    prisma.property.findUnique({
      where: { id },
      include: {
        createdBy: true,
        items: { include: { documents: { orderBy: { uploadedAt: "desc" } } } },
        valuations: { orderBy: { valuedAt: "desc" } },
      },
    }),
    getUserPreferences(),
  ]);
  if (!property) notFound();

  const latestValuation = property.valuations[0] ?? null;
  const valuationStale = !latestValuation || isValuationStale(latestValuation.valuedAt);

  const items = [...property.items].sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return b.date.getTime() - a.date.getTime();
  });

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href="/home" className="text-sm text-foreground/60 hover:text-foreground">
          ← Back to home
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-foreground/60">{property.address || "No address set"}</p>
          <h1 className="text-2xl font-semibold">{property.label}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/home/${property.id}/edit`}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5"
          >
            <Pencil size={16} />
            Edit
          </Link>
          <DetailOverflowMenu>
            <ConfirmForm
              action={deleteProperty.bind(null, property.id)}
              confirmText="Delete this property and all its items and documents? This cannot be undone."
              className="flex w-full items-center gap-2 px-4 py-2 text-sm text-danger hover:bg-danger/10"
            >
              <Trash2 size={16} />
              Delete
            </ConfirmForm>
          </DetailOverflowMenu>
        </div>
      </div>

      {property.lat != null && property.lng != null && (
        <PropertyMap lat={property.lat} lng={property.lng} label={property.label} />
      )}

      {property.notes && (
        <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
          <h2 className="mb-2 font-medium">Notes</h2>
          <p className="whitespace-pre-wrap text-sm text-foreground/80">{property.notes}</p>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Maintenance &amp; improvements</h2>
          <Link
            href={`/home/${property.id}/items/new`}
            className="flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
          >
            <Plus size={16} />
            Add item
          </Link>
        </div>

        {items.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-foreground/60">
            No items yet. Add a maintenance, improvement, or repair record to start tracking.
          </p>
        ) : (
          <div className="space-y-3">
            {items.map((item) => {
              const Icon = ITEM_ICONS[item.type] ?? Tag;
              return (
                <div
                  key={item.id}
                  className="rounded-xl border border-border bg-surface p-4 md:p-6"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <Icon size={20} className="mt-0.5 shrink-0 text-foreground/50" />
                      <div className="min-w-0">
                        <p className="text-sm text-foreground/60">
                          {HOME_ITEM_TYPE_LABELS[item.type] ?? item.type}
                        </p>
                        <p className="flex flex-wrap items-center gap-2 font-medium">
                          {item.title}
                          {item.isTaxDeductible && (
                            <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-normal text-success">
                              Tax deductible
                            </span>
                          )}
                        </p>
                        {item.provider && (
                          <p className="text-sm text-foreground/70">{item.provider}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/home/${property.id}/items/${item.id}/edit`}
                        className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5"
                      >
                        <Pencil size={16} />
                        Edit
                      </Link>
                      <ConfirmForm
                        action={deleteHomeItem.bind(null, property.id, item.id)}
                        confirmText={`Delete "${item.title}" and its documents?`}
                        className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-danger hover:bg-danger/10"
                      >
                        <Trash2 size={16} />
                        Delete
                      </ConfirmForm>
                    </div>
                  </div>

                  <dl className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3">
                    <Detail label="Date" value={formatDate(item.date, dateFormat)} />
                    <Detail
                      label="Cost"
                      value={item.cost != null ? formatCurrency(item.cost, item.currency) : "—"}
                    />
                  </dl>

                  {item.notes && (
                    <p className="mt-4 whitespace-pre-wrap text-sm text-foreground/80">
                      {item.notes}
                    </p>
                  )}

                  <div className="mt-4 border-t border-border pt-4">
                    <h3 className="mb-2 text-sm font-medium">Documents</h3>
                    <HomeItemDocumentList documents={item.documents} dateFormat={dateFormat} />
                    <div className="mt-3">
                      <DocumentUploadForm action={addItemDocument.bind(null, item.id)} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Property valuations */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp size={18} className="text-foreground/50" />
            <h2 className="font-medium">Property valuations</h2>
          </div>
        </div>

        {valuationStale && (
          <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            <AlertTriangle size={16} className="shrink-0" />
            {latestValuation
              ? "Valuation is over 12 months old — consider updating."
              : "No valuation recorded yet — add one to include this property in your net worth."}
          </div>
        )}

        {property.valuations.length > 0 && (
          <div className="rounded-xl border border-border bg-surface divide-y divide-border">
            {property.valuations.map((v) => (
              <div key={v.id} className="flex items-center justify-between gap-4 p-4">
                <div>
                  <p className="font-medium tabular-nums">{formatCurrency(v.value, v.currency)}</p>
                  <p className="text-xs text-foreground/50">
                    {formatDate(v.valuedAt, dateFormat)}{v.source ? ` · ${v.source}` : ""}
                  </p>
                  {v.notes && <p className="mt-0.5 text-xs text-foreground/60">{v.notes}</p>}
                </div>
                <ConfirmForm
                  action={deletePropertyValuation.bind(null, property.id, v.id)}
                  confirmText="Remove this valuation? This can't be undone."
                  ariaLabel={`Remove valuation from ${formatDate(v.valuedAt, dateFormat)}`}
                  className="rounded-lg border border-border p-2 text-danger hover:bg-danger/10"
                >
                  <Trash2 size={14} />
                </ConfirmForm>
              </div>
            ))}
          </div>
        )}

        <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
          <h3 className="mb-3 text-sm font-medium">Add valuation</h3>
          <form action={addPropertyValuation.bind(null, property.id)} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-foreground/60">Date</label>
                <input
                  type="date"
                  name="valuedAt"
                  required
                  defaultValue={new Date().toISOString().slice(0, 10)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-foreground/60">Estimated value</label>
                <input
                  type="number"
                  name="value"
                  required
                  step="1"
                  min="0"
                  placeholder="e.g. 750000"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-foreground/60">Currency</label>
                <CurrencySelect name="currency" defaultValue={preferredCurrency} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-foreground/60">Source (optional)</label>
                <input
                  type="text"
                  name="source"
                  placeholder="e.g. CoreLogic, agent appraisal"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs text-foreground/60">Notes (optional)</label>
              <input
                type="text"
                name="notes"
                placeholder="Any additional context"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <button
              type="submit"
              className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
            >
              <Plus size={16} />
              Save valuation
            </button>
          </form>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Home size={18} className="text-foreground/50" />
            <h2 className="font-medium">Rental tracking</h2>
          </div>
          {property.isRented ? (
            <Link
              href={`/home/${property.id}/rental`}
              className="text-sm font-medium text-accent hover:underline"
            >
              View rental overview →
            </Link>
          ) : (
            <Link
              href={`/home/${property.id}/rental`}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5"
            >
              Set up rental tracking
            </Link>
          )}
        </div>
        {property.isRented && (
          <p className="mt-2 text-sm text-foreground/60">
            This property is rented — track statements and reconcile rent income.
          </p>
        )}
      </div>

      <RecordMeta
        createdByName={property.createdBy.name}
        createdAt={property.createdAt}
        updatedAt={property.updatedAt}
        dateFormat={dateFormat}
      />
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-foreground/50">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}
