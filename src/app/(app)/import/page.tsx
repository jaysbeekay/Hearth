import type { Metadata } from "next";
import { ImportClient } from "@/components/ImportClient";

export const metadata: Metadata = { title: "Bulk import" };

export default function ImportPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Bulk import</h1>
        <p className="text-sm text-muted">
          Migrating existing paperwork? Drop in multiple PDFs at once — each one is scanned,
          you assign it as a contract or product, review the details, and save.
        </p>
      </div>
      <ImportClient />
    </div>
  );
}
