import { pageShellClass, type PageWidth } from "@/lib/ui";

// #411 — the page column. list and dashboard max-w-5xl, detail max-w-3xl,
// form and settings max-w-2xl, auth max-w-sm; sections space-y-6.
export function PageShell({
  width,
  className,
  ...props
}: { width: PageWidth } & React.HTMLAttributes<HTMLDivElement>) {
  return <div className={pageShellClass(width, className)} {...props} />;
}
