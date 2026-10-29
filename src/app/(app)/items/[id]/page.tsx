import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { itemCutoverReadiness } from "@/lib/items/cutoverReadiness";
import { auth } from "@/lib/auth";
import { canWrite } from "@/lib/readOnly";

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  if (process.env.ITEMS_PREVIEW !== "1" || !(await itemCutoverReadiness()).ready) redirect("/products");
  const { id } = await params;
  const item = await prisma.item.findUnique({ where: { id }, include: { warranty: true, legacyInventories: true, documents: { where: { deletedAt: null }, orderBy: { uploadedAt: "desc" } } } });
  if (!item || item.deletedAt) notFound();
  const writable = canWrite(await auth());
  return <main className="mx-auto max-w-3xl space-y-6 p-6">
    <Link href="/items" className="text-sm text-muted">← Items</Link>
    <header className="flex items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold">{item.description}</h1>{item.manufacturer && <p className="text-muted">{item.manufacturer}</p>}</div>{writable && <Link href={`/items/${id}/edit`} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-hover">Edit</Link>}</header>
    {item.mergeConflictFields && <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">This Item combines {item.legacyInventories.length} inventory record{item.legacyInventories.length === 1 ? "" : "s"} with a warranty record. Some source fields differ; review the details before public cutover.</p>}
    {item.warranty && <section><h2 className="font-medium">Warranty</h2><p>{item.warranty.endDate ? `Ends ${item.warranty.endDate.toLocaleDateString()}` : "No end date recorded"}</p></section>}
    <section><h2 className="font-medium">Documents</h2>{item.documents.length === 0 ? <p className="text-muted">None yet.</p> : <ul className="mt-2 space-y-2">
      {item.documents.map((doc) => <li key={doc.id}><a className="underline" href={`/api/items/documents/${doc.id}`}>{doc.filename}</a>{doc.isImportant && <span className="ml-2 text-sm">★</span>}</li>)}
    </ul>}</section>
  </main>;
}
