import Link from "next/link";

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="text-sm text-foreground/60 hover:text-foreground">
      ← {label}
    </Link>
  );
}
