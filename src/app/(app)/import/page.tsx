import type { Metadata } from "next";
import { ImportClient } from "@/components/ImportClient";

export const metadata: Metadata = { title: "Upload documents" };

export default function ImportPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Upload documents</h1>
        <p className="text-sm text-muted">
          Drop in a document — or several at once if you're migrating existing paperwork.
          Hearth scans each one, you confirm whether it's a contract or product, review the
          details, and save.
        </p>
      </div>
      <ImportClient />
    </div>
  );
}
