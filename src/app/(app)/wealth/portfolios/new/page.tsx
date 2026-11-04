import type { Metadata } from "next";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { createPortfolio } from "@/lib/actions/wealth";
import { PortfolioForm } from "@/components/PortfolioForm";
import { getUserPreferences } from "@/lib/userPreferences";
import { auth } from "@/lib/auth";
import { redirectIfReadOnly } from "@/lib/readOnly";
import { BackLink } from "@/components/BackLink";
import { Card } from "@/components/ui/Card";
import { PageShell } from "@/components/ui/PageShell";

export const metadata: Metadata = { title: "Add portfolio" };

export default async function NewPortfolioPage() {
  await requireModuleEnabled("WEALTH");
  redirectIfReadOnly(await auth(), "/wealth/portfolios");
  const { preferredCurrency } = await getUserPreferences();

  return (
    <PageShell width="form">
      <div>
        <BackLink href="/wealth" label="Wealth" />
        <h1 className="mt-1 text-2xl font-medium">Add portfolio</h1>
      </div>
      <Card>
        <PortfolioForm cancelHref="/wealth" action={createPortfolio} defaultCurrency={preferredCurrency} />
      </Card>
    </PageShell>
  );
}
