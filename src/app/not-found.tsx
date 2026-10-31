import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass } from "@/lib/buttonStyles";
import { PageShell } from "@/components/ui";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12">
      <PageShell width="auth" className="text-center">
        <div className="flex flex-col items-center gap-2">
          <h1 className="text-2xl font-medium">Page not found</h1>
          <p className="text-sm text-muted">
            The page you&apos;re looking for doesn&apos;t exist or may have moved.
          </p>
        </div>
        <Link
          href="/"
          className={buttonClass("primary")}
        >
          Back to Hearth
        </Link>
      </PageShell>
    </div>
  );
}
