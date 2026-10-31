import Link from "next/link";
import { createProduct } from "@/lib/actions/products";
import { ProductForm } from "@/components/ProductForm";
import { getUserPreferences } from "@/lib/userPreferences";
import { getEnabledModuleKeys } from "@/lib/modules/enablement";
import { prisma } from "@/lib/prisma";
import { isBarcodeLookupConfigured } from "@/lib/appSettings";
import { BackLink } from "@/components/BackLink";
import { auth } from "@/lib/auth";
import { redirectIfReadOnly } from "@/lib/readOnly";
import { Card } from "@/components/ui/Card";
import { PageShell } from "@/components/ui/PageShell";

export default async function NewProductPage() {
  redirectIfReadOnly(await auth(), "/products");
  const [{ preferredCurrency }, enabledModules, barcodeLookupEnabled] = await Promise.all([
    getUserPreferences(),
    getEnabledModuleKeys(),
    isBarcodeLookupConfigured(),
  ]);
  const properties = enabledModules.has("HOME")
    ? await prisma.property.findMany({ where: { deletedAt: null, archivedAt: null }, select: { id: true, label: true }, orderBy: { label: "asc" } })
    : [];

  return (
    <PageShell width="form">
      <BackLink href="/products" label="Warranties" />
      <div>
        <h1 className="text-2xl font-medium">Add a warranty</h1>
        <p className="text-sm text-muted">
          Capture the purchase details so you never miss a warranty deadline.
        </p>
        <p className="mt-1 text-xs text-muted">
          Warranties cover things you&apos;ve bought. Looking for insurance, a phone plan or
          another recurring cost instead? Try{" "}
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
      <Card>
        <ProductForm
          action={createProduct}
          defaultCurrency={preferredCurrency}
          properties={properties}
          homeEnabled={enabledModules.has("HOME")}
          barcodeLookupEnabled={barcodeLookupEnabled}
        />
      </Card>
    </PageShell>
  );
}
