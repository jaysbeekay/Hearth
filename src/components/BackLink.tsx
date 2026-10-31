import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/**
 * The one back link (#362). `label` is the destination's name as the user
 * sees it elsewhere: the nav label for a list page ("Contracts",
 * "Warranties", "Settings") or the record's own name for a detail page.
 * The component adds "Back to", so every back link reads the same way.
 */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center gap-1 text-sm text-muted hover:text-foreground"
    >
      <ArrowLeft size={16} aria-hidden />
      Back to {label}
    </Link>
  );
}
