import type { Metadata } from "next";
import Link from "next/link";
import { FileQuestion } from "lucide-react";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="flex flex-col items-center gap-2">
          <FileQuestion size={32} className="text-accent" />
          <h1 className="text-2xl font-semibold">Page not found</h1>
          <p className="text-sm text-foreground/60">
            The page you&apos;re looking for doesn&apos;t exist or may have moved.
          </p>
        </div>
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
        >
          Back to Hearth
        </Link>
      </div>
    </div>
  );
}
