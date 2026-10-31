import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { updateProduct } from "@/lib/actions/products";
import { ProductForm } from "@/components/ProductForm";
import { isModuleEnabled } from "@/lib/modules/enablement";
import { auth } from "@/lib/auth";
import { redirectIfReadOnly } from "@/lib/readOnly";
import { BackLink } from "@/components/BackLink";

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
    <div className="max-w-3xl space-y-6">
      <BackLink href={`/products/${product.id}`} label={product.description} />
      <div>
        <h1 className="text-2xl font-medium">Edit warranty</h1>
        <p className="text-sm text-muted">{product.description}</p>
      </div>
      <div className="rounded-lg border border-border bg-surface p-4 md:p-6">
        <ProductForm
          action={boundAction}
          product={product}
          properties={properties}
          homeEnabled={homeEnabled}
        />
      </div>
    </div>
  );
}
