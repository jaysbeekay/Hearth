import { createProduct } from "@/lib/actions/products";
import { ProductForm } from "@/components/ProductForm";
import { getUserPreferences } from "@/lib/userPreferences";

export default async function NewProductPage() {
  const { preferredCurrency } = await getUserPreferences();

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Add a product</h1>
        <p className="text-sm text-foreground/60">
          Capture the purchase details so you never miss a warranty deadline.
        </p>
      </div>
      <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <ProductForm action={createProduct} defaultCurrency={preferredCurrency} />
      </div>
    </div>
  );
}
