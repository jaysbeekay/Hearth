import { cn } from "@/lib/utils";

// Plain class-string helpers, deliberately not in SubmitButton.tsx: that
// file is "use client" (needs useFormStatus), which would make every export
// client-only and unusable from Server Components that just want the class
// string (e.g. settings/page.tsx rendering a plain <button>).
//
// #411 — one button set at one size:
// - primary: the page's one main action. At most one per page.
// - secondary: every other action, row actions included.
// - quiet: no border, for icon buttons and low-weight actions (Cancel).
// - danger: filled red, only for the confirm button inside a confirm dialog.
//   A Delete that opens the dialog is secondary (or quiet) with text-danger.
// 36px visual height with a 44px hit area: the ::after box reaches 4px above
// and below the button, so touch targets meet the guideline without making
// every button look tall.

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

export const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-foreground hover:bg-accent/90",
  secondary: "border border-border bg-surface text-foreground hover:bg-hover-surface",
  quiet: "text-foreground hover:bg-hover",
  danger: "bg-danger text-danger-foreground hover:bg-danger/90",
};

const BUTTON_BASE =
  "relative inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors after:absolute after:content-[''] disabled:cursor-not-allowed disabled:opacity-60";

export function buttonClass(
  variant: ButtonVariant = "secondary",
  {
    online = true,
    iconOnly = false,
    className,
  }: { online?: boolean; iconOnly?: boolean; className?: string } = {},
) {
  return cn(
    BUTTON_BASE,
    iconOnly ? "w-9 after:-inset-1" : "px-3 after:inset-x-0 after:-inset-y-1",
    buttonVariants[variant],
    !online && "pointer-events-none opacity-40",
    className,
  );
}

// Rows inside the "Export" <details> dropdown (CSV/PDF download links) and
// other overlay menus: full-width, 44px rows.
export const exportMenuItemClass = "flex min-h-11 items-center px-4 text-sm transition-colors hover:bg-hover";
