import { requireModuleEnabled } from "@/lib/modules/enablement";
import { createProperty } from "@/lib/actions/home";
import { PropertyForm } from "@/components/PropertyForm";
import { BackLink } from "@/components/BackLink";
import { auth } from "@/lib/auth";
import { redirectIfReadOnly } from "@/lib/readOnly";
import { Card, PageShell } from "@/components/ui";

export default async function NewPropertyPage() {
  await requireModuleEnabled("HOME");
  redirectIfReadOnly(await auth(), "/home");

  return (
    <PageShell width="form">
      <BackLink href="/home" label="Properties" />
      <div>
        <h1 className="text-2xl font-medium">Add a property</h1>
        <p className="text-sm text-muted">
          Track maintenance, improvements, and repairs for this property.
        </p>
      </div>
      <Card>
        <PropertyForm action={createProperty} />
      </Card>
    </PageShell>
  );
}
