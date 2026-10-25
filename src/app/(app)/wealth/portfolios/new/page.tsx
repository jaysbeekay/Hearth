import type { Metadata } from "next";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { createPortfolio } from "@/lib/actions/wealth";
import { PortfolioForm } from "@/components/PortfolioForm";
import { getUserPreferences } from "@/lib/userPreferences";
import { auth } from "@/lib/auth";
import { redirectIfReadOnly } from "@/lib/readOnly";
import { BackLink } from "@/components/BackLink";

export const metadata: Metadata = { title: "New Portfolio" };

export default async function NewPortfolioPage() {
  await requireModuleEnabled("WEALTH");
  redirectIfReadOnly(await auth(), "/wealth/portfolios");
  const { preferredCurrency } = await getUserPreferences();

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <BackLink href="/wealth" label="Wealth" />
        <h1 className="mt-1 text-2xl font-semibold">New portfolio</h1>
      </div>
      <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <PortfolioForm action={createPortfolio} defaultCurrency={preferredCurrency} />
      </div>
    </div>
  );
}
