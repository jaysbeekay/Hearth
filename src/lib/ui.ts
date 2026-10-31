// #411 — the shared UI rules: the one place each card, pill, banner, button,
// input, overlay and page-width class string is decided. Components
// (Card, Pill, Banner, PageShell, SubmitButton) render these; anything
// that can't be one of those components (a <Link>, a <summary>, a <label>)
// takes the class string from here instead of re-declaring it.
//
// The rules, from the issue:
// - Type: five sizes (text-2xl/xl/base/sm/xs) and two weights (400/500),
//   sentence case, tabular-nums set once on body.
// - Shape: rounded-lg everywhere except rounded-full for the FAB and dots;
//   1px borders; dashed only for the file drop zone; no card shadows, one
//   shadow-overlay for dialogs and menus.
// - Spacing: steps 1/2/3/4/6/8. Card padding p-4.
// - Buttons: primary / secondary / quiet / danger at one size, 36px visual
//   with a 44px hit area. At most one primary per page, row actions are
//   secondary, filled danger only inside confirm dialogs.
// - Icons: lucide at 16px in content, 20px in navigation.
// - Motion: transition-colors on hover, plus spinners.
//
// Pure and free of runtime imports beyond cn, so server and client
// components share it.

import { cn } from "@/lib/utils";

// ── Card ────────────────────────────────────────────────────────────────

const CARD_BASE = "rounded-lg border border-border bg-surface";

export interface CardOptions {
  /** `none` for a card whose rows carry their own padding (divide-y lists, tables). */
  padding?: "default" | "none";
  /** A card that is itself a link: the border takes the accent on hover. */
  interactive?: boolean;
}

/** The classes for a card: surface, 1px border, rounded-lg, p-4. No shadow. */
export function cardClass({ padding = "default", interactive = false }: CardOptions = {}, className?: string) {
  return cn(
    CARD_BASE,
    padding === "default" && "p-4",
    interactive && "transition-colors hover:border-accent/50",
    className,
  );
}

/** A dialog panel or popover menu: the one place shadow-overlay is used. */
export function overlayClass(className?: string) {
  return cn(CARD_BASE, "shadow-overlay", className);
}

/** A bottom sheet on mobile: flush to the bottom edge, only the top corners rounded. */
export function sheetClass(className?: string) {
  return cn("w-full rounded-t-lg border-t border-border bg-surface shadow-overlay", className);
}

/** The centred dialog panel (Dialog's default). */
export function dialogPanelClass(className?: string) {
  return overlayClass(cn("w-full max-w-sm p-4", className));
}

/** An empty state: a plain bordered box of muted, centred text. */
export function emptyStateClass(className?: string) {
  return cn("rounded-lg border border-border p-6 text-center text-sm text-muted", className);
}

// ── Pill ────────────────────────────────────────────────────────────────

export type PillTone = "danger" | "warning" | "success" | "accent" | "neutral" | "plain";

const PILL_BASE = "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg py-0.5 text-xs font-medium";

const PILL_TONE: Record<PillTone, string> = {
  danger: "px-2 bg-danger/10 text-danger",
  warning: "px-2 bg-warning/10 text-warning",
  success: "px-2 bg-success/10 text-success",
  accent: "px-2 bg-accent/10 text-accent",
  neutral: "px-2 bg-muted/10 text-muted",
  // No tint and no side padding: plain text that lines up with the pills.
  plain: "text-muted",
};

/** A status pill. Pills are for states; filter chips are secondary buttons. */
export function pillClass(tone: PillTone = "neutral", className?: string) {
  return cn(PILL_BASE, PILL_TONE[tone], className);
}

// ── Banner ──────────────────────────────────────────────────────────────

export type BannerTone = "danger" | "warning" | "success" | "neutral" | "plain";

const BANNER_TONE: Record<BannerTone, string> = {
  danger: "border-danger/30 bg-danger/10 text-danger",
  warning: "border-warning/30 bg-warning/10 text-warning",
  success: "border-success/30 bg-success/10 text-success",
  neutral: "border-border bg-muted/10 text-foreground",
  plain: "border-border bg-surface text-foreground",
};

/** Just the border, tint and text colour of a banner in a tone. */
export function bannerToneClass(tone: BannerTone) {
  return BANNER_TONE[tone];
}

/** A banner: a 1px tinted box of running text, rounded-lg, px-4 py-3. */
export function bannerClass(tone: BannerTone = "neutral", className?: string) {
  return cn("rounded-lg border px-4 py-3 text-sm", BANNER_TONE[tone], className);
}

// ── Button ──────────────────────────────────────────────────────────────

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

// h-9 is the 36px visual; the ::before pseudo-element reaches 4px past every
// edge, so the hit area is at least 44px tall (and 44px wide for an icon
// button) without the button looking any bigger.
const BUTTON_BASE =
  "relative inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors before:absolute before:-inset-1 before:content-[''] disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:pointer-events-none aria-disabled:opacity-60";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-foreground hover:bg-accent/90",
  secondary: "border border-border bg-surface hover:bg-hover-surface",
  quiet: "hover:bg-hover",
  danger: "bg-danger text-danger-foreground hover:bg-danger/90",
};

export interface ButtonOptions {
  /** A square 36px button holding one icon (give it an aria-label). */
  icon?: boolean;
  /**
   * A destructive action that isn't the confirm button of a dialog (a row's
   * "Delete"): a secondary or quiet button with danger text. Filled danger
   * is only for the confirm button inside a confirm dialog.
   */
  destructive?: boolean;
  /** Greys a link-as-button out while offline. */
  online?: boolean;
}

export function buttonClass(
  variant: ButtonVariant = "secondary",
  { icon = false, destructive = false, online = true }: ButtonOptions = {},
  className?: string,
) {
  return cn(
    BUTTON_BASE,
    BUTTON_VARIANT[variant],
    icon && "w-9 px-0",
    destructive && "text-danger",
    !online && "pointer-events-none opacity-40",
    className,
  );
}

/**
 * A filter chip: a secondary button (not a pill) that stays pressed while
 * its filter is on. Pair it with aria-pressed.
 */
export function chipClass(active: boolean, className?: string) {
  return cn(
    BUTTON_BASE,
    "border",
    active ? "border-accent bg-accent/10 text-accent" : "border-border bg-surface text-muted hover:bg-hover-surface",
    className,
  );
}

/** A row inside a popover menu (Export, the overflow menu). */
export function menuItemClass({ destructive = false }: { destructive?: boolean } = {}, className?: string) {
  return cn(
    "flex min-h-11 w-full items-center gap-2 px-4 text-left text-sm transition-colors hover:bg-hover",
    destructive && "text-danger",
    className,
  );
}

// ── Form controls ───────────────────────────────────────────────────────

/** The one input / select / textarea look: 36px tall, rounded-lg, 1px border. */
export const inputClass =
  "h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-accent disabled:opacity-60";

/** A textarea: the input look without the fixed height. */
export const textareaClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-accent disabled:opacity-60";

// ── Page widths ─────────────────────────────────────────────────────────

export type PageWidth = "list" | "detail" | "form" | "auth";

const PAGE_WIDTH: Record<PageWidth, string> = {
  list: "max-w-5xl",
  detail: "max-w-3xl",
  form: "max-w-2xl",
  auth: "max-w-sm",
};

/** The page column: list/dashboard 5xl, detail 3xl, form and settings 2xl, auth sm. */
export function pageShellClass(width: PageWidth, className?: string) {
  return cn("w-full space-y-6", PAGE_WIDTH[width], className);
}
