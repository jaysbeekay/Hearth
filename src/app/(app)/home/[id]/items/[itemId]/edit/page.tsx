import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { updateHomeItem } from "@/lib/actions/home";
import { HomeItemForm } from "@/components/HomeItemForm";

export default async function EditHomeItemPage({
  params,
}: {
  params: Promise<{ id: string; itemId: string }>;
}) {
  await requireModuleEnabled("HOME");

  const { id, itemId } = await params;
  const item = await prisma.homeItem.findUnique({ where: { id: itemId } });
  if (!item || item.propertyId !== id) notFound();

  const boundAction = updateHomeItem.bind(null, id, itemId);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Edit item</h1>
        <p className="text-sm text-muted">{item.title}</p>
      </div>
      <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <HomeItemForm action={boundAction} item={item} />
      </div>
    </div>
  );
}
