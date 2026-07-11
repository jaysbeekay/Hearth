import Link from "next/link";
import { createProduct } from "@/lib/actions/products";
import { ProductForm } from "@/components/ProductForm";
import { getUserPreferences } from "@/lib/userPreferences";
import { getEnabledModuleKeys } from "@/lib/modules/enablement";

export default async function NewProductPage() {
  const [{ preferredCurrency }, enabledModules] = await Promise.all([
    getUserPreferences(),
    getEnabledModuleKeys(),
  ]);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Add a product</h1>
        <p className="text-sm text-foreground/60">
          Capture the purchase details so you never miss a warranty deadline.
        </p>
        <p className="mt-1 text-xs text-muted">
          Products are things with a warranty. Looking for an ongoing bill or subscription
          instead? Try{" "}
          <Link href="/contracts/new" className="text-accent hover:underline">
            add a contract
          </Link>
          .
          {enabledModules.has("INVENTORY") && (
            <>
              {" "}
              Just cataloguing what you own?{" "}
              <Link href="/inventory/new" className="text-accent hover:underline">
                Add to inventory
              </Link>
              .
            </>
          )}
        </p>
      </div>
      <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <ProductForm action={createProduct} defaultCurrency={preferredCurrency} />
      </div>
    </div>
  );
}
