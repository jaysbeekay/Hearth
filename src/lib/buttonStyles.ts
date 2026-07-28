import { cn } from "@/lib/utils";

// Plain class-string helpers, deliberately not in SubmitButton.tsx: that
// file is "use client" (needs useFormStatus), which would make every export
// client-only and unusable from Server Components that just want the class
// string (e.g. settings/page.tsx rendering a plain <button>).

export const buttonVariants = {
  primary: "bg-accent text-accent-foreground hover:opacity-90",
  danger: "bg-danger text-white hover:opacity-90",
  secondary:
    "bg-transparent border border-border hover:bg-black/5 dark:hover:bg-white/5",
};

// min-h-11 (44px) meets the touch-target guideline on every consumer below —
// full-size buttons and links alike, since none of them override height.

// Shared with SubmitButton (real <button type="submit"> elements) so
// <Link>-as-button "add record" affordances, and any type="button" element
// styled the same way, use one visual definition instead of re-declaring it
// per call site.
export function linkButtonClass(
  variant: keyof typeof buttonVariants = "primary",
  { online = true }: { online?: boolean } = {},
) {
  return cn(
    "flex min-h-11 items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium",
    buttonVariants[variant],
    !online && "pointer-events-none opacity-40",
  );
}

// Compact bordered buttons (inline row actions: "Save", "Cancel", "Copy",
// "Revoke token") — smaller horizontal padding than the full button family
// above, but still 44px tall so the smaller footprint doesn't cost touch
// accuracy.
export const compactButtonVariants = {
  secondary: "border-border hover:bg-black/5 dark:hover:bg-white/5",
  danger: "border-border text-danger hover:bg-danger/5",
};

export function compactButtonClass(
  variant: keyof typeof compactButtonVariants = "secondary",
) {
  return cn(
    "inline-flex min-h-11 items-center justify-center rounded-lg border px-3 text-sm font-medium",
    compactButtonVariants[variant],
  );
}

// List-page toolbar: the "Export ▾" <details> trigger and its "Filter"
// sibling share this look (bordered, no fill) across every list page.
export const toolbarButtonClass =
  "flex min-h-11 cursor-pointer list-none items-center justify-center gap-1 rounded-lg border border-border px-3 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5";

// Rows inside the "Export" <details> dropdown (CSV/PDF download links).
export const exportMenuItemClass =
  "flex min-h-11 items-center px-4 text-sm hover:bg-black/5 dark:hover:bg-white/5";
