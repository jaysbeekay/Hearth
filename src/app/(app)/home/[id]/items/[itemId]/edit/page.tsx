import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { updateHomeItem } from "@/lib/actions/home";
import { HomeItemForm } from "@/components/HomeItemForm";
import { auth } from "@/lib/auth";
import { redirectIfReadOnly } from "@/lib/readOnly";
import { BackLink } from "@/components/BackLink";
import { Card } from "@/components/ui";

export default async function EditHomeItemPage({
  params,
}: {
  params: Promise<{ id: string; itemId: string }>;
}) {
  await requireModuleEnabled("HOME");

  const { id, itemId } = await params;
  redirectIfReadOnly(await auth(), `/home/${id}`);
  const item = await prisma.homeItem.findUnique({
    where: { id: itemId },
    include: { property: { select: { label: true } } },
  });
  if (!item || item.propertyId !== id) notFound();

  const boundAction = updateHomeItem.bind(null, id, itemId);

  return (
    <div className="max-w-3xl space-y-6">
      <BackLink href={`/home/${id}`} label={item.property.label} />
      <div>
        <h1 className="text-2xl font-medium">Edit maintenance record</h1>
        <p className="text-sm text-muted">{item.title}</p>
      </div>
      <Card>
        <HomeItemForm action={boundAction} item={item} />
      </Card>
    </div>
  );
}
