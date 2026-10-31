import type { Metadata } from "next";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { createPortfolio } from "@/lib/actions/wealth";
import { PortfolioForm } from "@/components/PortfolioForm";
import { getUserPreferences } from "@/lib/userPreferences";
import { auth } from "@/lib/auth";
import { redirectIfReadOnly } from "@/lib/readOnly";
import { BackLink } from "@/components/BackLink";
import { Card, PageShell } from "@/components/ui";

export const metadata: Metadata = { title: "New Portfolio" };

export default async function NewPortfolioPage() {
  await requireModuleEnabled("WEALTH");
  redirectIfReadOnly(await auth(), "/wealth/portfolios");
  const { preferredCurrency } = await getUserPreferences();

  return (
    <PageShell width="form">
      <div>
        <BackLink href="/wealth" label="Wealth" />
        <h1 className="mt-1 text-2xl font-medium">New portfolio</h1>
      </div>
      <Card>
        <PortfolioForm action={createPortfolio} defaultCurrency={preferredCurrency} />
      </Card>
    </PageShell>
  );
}
