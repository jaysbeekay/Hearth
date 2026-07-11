import type { Metadata } from "next";
import Link from "next/link";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { createPortfolio } from "@/lib/actions/wealth";
import { PortfolioForm } from "@/components/PortfolioForm";
import { getUserPreferences } from "@/lib/userPreferences";

export const metadata: Metadata = { title: "New Portfolio" };

export default async function NewPortfolioPage() {
  await requireModuleEnabled("WEALTH");
  const { preferredCurrency } = await getUserPreferences();

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <Link href="/wealth" className="text-sm text-foreground/60 hover:text-foreground">← Back to wealth</Link>
        <h1 className="mt-1 text-2xl font-semibold">New portfolio</h1>
      </div>
      <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <PortfolioForm action={createPortfolio} defaultCurrency={preferredCurrency} />
      </div>
    </div>
  );
}
