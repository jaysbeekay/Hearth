import { requireModuleEnabled } from "@/lib/modules/enablement";
import { createProperty } from "@/lib/actions/home";
import { PropertyForm } from "@/components/PropertyForm";
import { BackLink } from "@/components/BackLink";
import { auth } from "@/lib/auth";
import { redirectIfReadOnly } from "@/lib/readOnly";

export default async function NewPropertyPage() {
  await requireModuleEnabled("HOME");
  redirectIfReadOnly(await auth(), "/home");

  return (
    <div className="max-w-3xl space-y-6">
      <BackLink href="/home" label="Properties" />
      <div>
        <h1 className="text-2xl font-medium">Add a property</h1>
        <p className="text-sm text-muted">
          Track maintenance, improvements, and repairs for this property.
        </p>
      </div>
      <div className="rounded-lg border border-border bg-surface p-4 md:p-6">
        <PropertyForm action={createProperty} />
      </div>
    </div>
  );
}
