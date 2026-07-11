import { createContract } from "@/lib/actions/contracts";
import { ContractForm } from "@/components/ContractForm";
import { getUserPreferences } from "@/lib/userPreferences";

export default async function NewContractPage() {
  const { preferredCurrency } = await getUserPreferences();

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Add a contract</h1>
        <p className="text-sm text-foreground/60">
          Capture the key details so you never miss a renewal or cancellation deadline.
        </p>
      </div>
      <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <ContractForm action={createContract} defaultCurrency={preferredCurrency} />
      </div>
    </div>
  );
}
