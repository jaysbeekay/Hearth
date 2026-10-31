import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { updateProduct } from "@/lib/actions/products";
import { ProductForm } from "@/components/ProductForm";
import { isModuleEnabled } from "@/lib/modules/enablement";
import { auth } from "@/lib/auth";
import { redirectIfReadOnly } from "@/lib/readOnly";
import { BackLink } from "@/components/BackLink";
import { Card } from "@/components/ui/Card";
import { PageShell } from "@/components/ui/PageShell";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirectIfReadOnly(await auth(), `/products/${id}`);
  const [product, homeEnabled] = await Promise.all([
    prisma.product.findUnique({ where: { id } }),
    isModuleEnabled("HOME"),
  ]);
  if (!product || product.deletedAt) notFound();

  const properties = homeEnabled
    ? await prisma.property.findMany({ select: { id: true, label: true }, orderBy: { label: "asc" } })
    : [];

  const boundAction = updateProduct.bind(null, product.id);

  return (
    <PageShell width="form">
      <BackLink href={`/products/${product.id}`} label={product.description} />
      <div>
        <h1 className="text-2xl font-medium">Edit warranty</h1>
        <p className="text-sm text-muted">{product.description}</p>
      </div>
      <Card>
        <ProductForm
          action={boundAction}
          product={product}
          properties={properties}
          homeEnabled={homeEnabled}
        />
      </Card>
    </PageShell>
  );
}
