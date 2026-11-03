import { BackLink } from "@/components/BackLink";
import { buttonClass } from "@/lib/ui";
import Link from "next/link";
import { Banner } from "@/components/ui/Banner";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { itemCutoverReadiness } from "@/lib/items/cutoverReadiness";
import { auth } from "@/lib/auth";
import { canWrite } from "@/lib/readOnly";
import { isModuleEnabled } from "@/lib/modules/enablement";
import { getUserPreferences } from "@/lib/userPreferences";
import { formatDate } from "@/lib/utils";
import { DocumentUploadForm } from "@/components/DocumentUploadForm";
import { addItemDocumentAction } from "@/lib/actions/items";

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  if (process.env.ITEMS_PREVIEW !== "1" || !(await itemCutoverReadiness()).ready) redirect("/products");
  const { id } = await params;
  const item = await prisma.item.findUnique({ where: { id }, include: { warranty: true, legacyInventories: true, documents: { where: { deletedAt: null }, orderBy: { uploadedAt: "desc" } } } });
  if (!item || item.deletedAt) notFound();
  const [session, inventoryEnabled, { dateFormat }] = await Promise.all([auth(), isModuleEnabled("INVENTORY"), getUserPreferences()]);
  // #445 review: an inventory-only Item can only be edited, or take a new
  // Document, through the INVENTORY module; a Product-backed one always can.
  const writable = canWrite(session) && (Boolean(item.legacyProductId) || (inventoryEnabled && item.legacyInventories.length > 0));
  return <div className="mx-auto max-w-3xl space-y-6 p-6">
    <BackLink href="/items" label="Items" />
    <header className="flex items-start justify-between gap-4"><div><h1 className="text-2xl font-medium">{item.description}</h1>{item.manufacturer && <p className="text-muted">{item.manufacturer}</p>}</div>{writable && <Link href={`/items/${id}/edit`} className={buttonClass("secondary")}>Edit</Link>}</header>
    {item.mergeConflictFields && <Banner tone="warning">This Item combines {item.legacyInventories.length} inventory record{item.legacyInventories.length === 1 ? "" : "s"} with a warranty record. Some source fields differ; review the details before public cutover.</Banner>}
    {item.warranty && <section><h2 className="font-medium">Warranty</h2><p>{item.warranty.endDate ? `Ends ${formatDate(item.warranty.endDate, dateFormat)}` : "No end date recorded"}</p></section>}
    <section className="space-y-3"><h2 className="font-medium">Documents</h2>{item.documents.length === 0 ? <p className="text-muted">None yet.</p> : <ul className="mt-2 space-y-2">
      {item.documents.map((doc) => <li key={doc.id}><a className="underline" href={`/api/items/documents/${doc.id}`}>{doc.filename}</a>{doc.isImportant && <span className="ml-2 text-sm">★</span>}</li>)}
    </ul>}{writable && <DocumentUploadForm action={addItemDocumentAction.bind(null, id)} />}</section>
  </div>;
}
