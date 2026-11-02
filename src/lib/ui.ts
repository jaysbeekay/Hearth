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
// components share it. Lookups go through Maps rather than indexing a plain
// object by a variable key, as lib/statusTone did before.

import { cn } from "@/lib/utils";

// Tailwind decides between two classes of one group by stylesheet order, not
// by their order in the class string, so a caller's extra class has to
// replace the base class of its group rather than sit beside it (a
// "max-sm:hidden" is fine, a bare "hidden" next to "inline-flex" is not).
// Ported from #504.
const CLASS_GROUPS: RegExp[] = [
  /^(inline-flex|flex|block|inline-block|hidden|grid)$/,
  /^justify-/,
  /^items-/,
  /^gap-/,
  /^px-/,
  /^py-/,
  /^p-/,
  /^h-/,
  /^w-/,
  /^text-(xs|sm|base|xl|2xl)$/,
  /^text-(foreground|muted|accent|accent-foreground|danger|danger-foreground|warning|success)$/,
];

/** Base classes plus extras, where an extra replaces a base class of the same group. */
export function mergeClasses(base: string, extra?: string | false | null): string {
  if (!extra) return base;
  const extras = extra.split(/\s+/).filter(Boolean);
  const overridden = CLASS_GROUPS.filter((g) => extras.some((x) => g.test(x)));
  const kept = base.split(/\s+/).filter((b) => b && !overridden.some((g) => g.test(b)));
  return [...kept, ...extras].join(" ");
}

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
  return mergeClasses(
    cn(
      CARD_BASE,
      padding === "default" && "p-4",
      interactive && "transition-colors hover:border-accent/50",
    ),
    className,
  );
}

/** A dialog panel or popover menu: the one place shadow-overlay is used. */
export function overlayClass(className?: string) {
  return mergeClasses(cn(CARD_BASE, "shadow-overlay"), className);
}

/** A bottom sheet on mobile: flush to the bottom edge, only the top corners rounded. */
export function sheetClass(className?: string) {
  return mergeClasses(cn("w-full rounded-t-lg border-t border-border bg-surface shadow-overlay"), className);
}

/** The centred dialog panel (Dialog's default). */
export function dialogPanelClass(className?: string) {
  return mergeClasses(overlayClass("w-full max-w-sm p-4"), className);
}

/** An empty state: a plain bordered box of muted, centred text. */
export function emptyStateClass(className?: string) {
  return mergeClasses(cn("rounded-lg border border-border p-6 text-center text-sm text-muted"), className);
}

// ── Pill ────────────────────────────────────────────────────────────────

export type PillTone = "danger" | "warning" | "success" | "accent" | "neutral" | "plain";

const PILL_BASE = "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg py-0.5 text-xs font-medium";

const PILL_TONE = new Map<PillTone, string>([
  ["danger", "px-2 bg-danger/10 text-danger"],
  ["warning", "px-2 bg-warning/10 text-warning"],
  ["success", "px-2 bg-success/10 text-success"],
  ["accent", "px-2 bg-accent/10 text-accent"],
  ["neutral", "px-2 bg-muted/10 text-muted"],
  // No tint and no side padding: plain text that lines up with the pills.
  ["plain", "text-muted"],
]);

/** A status pill. Pills are for states; filter chips are secondary buttons. */
export function pillClass(tone: PillTone = "neutral", className?: string) {
  return mergeClasses(cn(PILL_BASE, PILL_TONE.get(tone)), className);
}

// ── Banner ──────────────────────────────────────────────────────────────

export type BannerTone = "danger" | "warning" | "success" | "neutral" | "plain";

const BANNER_TONE = new Map<BannerTone, string>([
  ["danger", "border-danger/30 bg-danger/10 text-danger"],
  ["warning", "border-warning/30 bg-warning/10 text-warning"],
  ["success", "border-success/30 bg-success/10 text-success"],
  ["neutral", "border-border bg-muted/10 text-foreground"],
  ["plain", "border-border bg-surface text-foreground"],
]);

/** Just the border, tint and text colour of a banner in a tone. */
export function bannerToneClass(tone: BannerTone) {
  return BANNER_TONE.get(tone) ?? "";
}

/** A banner: a 1px tinted box of running text, rounded-lg, px-4 py-3. */
export function bannerClass(tone: BannerTone = "neutral", className?: string) {
  return mergeClasses(cn("rounded-lg border px-4 py-3 text-sm", BANNER_TONE.get(tone)), className);
}

// ── Button ──────────────────────────────────────────────────────────────

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

// min-h-9 is the 36px visual (a label too long for its row wraps onto a
// second line rather than running off-screen); the ::before pseudo-element reaches 4px past every
// edge, so the hit area is at least 44px tall (and 44px wide for an icon
// button) without the button looking any bigger. ::before is placed from the
// padding box, so a bordered button reaches 5px past its 1px border.
const BUTTON_BASE =
  "relative inline-flex min-h-9 max-w-full cursor-pointer items-center justify-center gap-2 rounded-lg px-3 py-1 text-center text-sm font-medium transition-colors before:absolute before:content-[''] disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:pointer-events-none aria-disabled:opacity-60";

const HIT_AREA = "before:-inset-1";
const HIT_AREA_BORDERED = "before:-inset-[5px]";

const BUTTON_VARIANT = new Map<ButtonVariant, string>([
  ["primary", `${HIT_AREA} bg-accent text-accent-foreground hover:bg-accent/90`],
  ["secondary", `${HIT_AREA_BORDERED} border border-border bg-surface hover:bg-hover-surface`],
  ["quiet", `${HIT_AREA} hover:bg-hover`],
  ["danger", `${HIT_AREA} bg-danger text-danger-foreground hover:bg-danger/90`],
]);

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
  return mergeClasses(
    cn(
      BUTTON_BASE,
      BUTTON_VARIANT.get(variant),
      icon && "w-9 shrink-0 px-0",
      destructive && "text-danger",
      !online && "pointer-events-none opacity-40",
    ),
    className,
  );
}

/**
 * A filter chip: a secondary button (not a pill) that stays pressed while
 * its filter is on. Pair it with aria-pressed.
 */
export function chipClass(active: boolean, className?: string) {
  return mergeClasses(
    cn(
      BUTTON_BASE,
      HIT_AREA_BORDERED,
      "border",
      active ? "border-accent bg-accent/10 text-accent" : "border-border bg-surface text-muted hover:bg-hover-surface",
    ),
    className,
  );
}

/**
 * A secondary-shaped button that carries a status tone (a summary count of
 * Overdue records that filters the list to them).
 */
export function toneButtonClass(tone: BannerTone, className?: string) {
  return mergeClasses(cn(BUTTON_BASE, HIT_AREA_BORDERED, "border", BANNER_TONE.get(tone)), className);
}

/** A row inside a popover menu (Export, the overflow menu). */
export function menuItemClass({ destructive = false }: { destructive?: boolean } = {}, className?: string) {
  return mergeClasses(
    cn(
      "flex min-h-11 w-full items-center gap-2 px-4 text-left text-sm transition-colors hover:bg-hover",
      destructive && "text-danger",
    ),
    className,
  );
}

// ── Form controls ───────────────────────────────────────────────────────

const INPUT_SHAPE =
  "h-9 w-full rounded-lg border px-3 text-sm outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent disabled:opacity-60";

/** The one input / select / textarea look: 36px tall, rounded-lg, 1px border. */
export const inputClass = cn(INPUT_SHAPE, "border-border bg-background");

/**
 * #406 — a field on an Import / Inbox review row: the input look, tinted
 * when extraction filled it in (accent for heuristics, foreground for AI) so
 * the user knows which values to check.
 */
export function reviewFieldClass(fill: "none" | "extracted" | "ai" = "none") {
  if (fill === "ai") return cn(INPUT_SHAPE, "border-foreground/60 bg-foreground/5 ring-2 ring-foreground/60");
  if (fill === "extracted") return cn(INPUT_SHAPE, "border-accent/40 bg-accent/5 ring-1 ring-accent/40");
  return inputClass;
}

/** A native select: the input look, with room for SelectWrapper's chevron. */
export const selectClass = cn(inputClass, "appearance-none pr-8");

/** A textarea: the input look without the fixed height. */
export const textareaClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent disabled:opacity-60";

// ── Page widths ─────────────────────────────────────────────────────────

export type PageWidth = "list" | "detail" | "form" | "auth";

const PAGE_WIDTH = new Map<PageWidth, string>([
  ["list", "max-w-5xl"],
  ["detail", "max-w-3xl"],
  ["form", "max-w-2xl"],
  ["auth", "max-w-sm"],
]);

/** The page column: list/dashboard 5xl, detail 3xl, form and settings 2xl, auth sm. */
export function pageShellClass(width: PageWidth, className?: string) {
  return mergeClasses(cn("w-full space-y-6", PAGE_WIDTH.get(width)), className);
}

// ── Links ───────────────────────────────────────────────────────────────

/**
 * A link inside running text: underlined, since the accent alone is too
 * close in lightness to muted text to tell it apart (WCAG 1.4.1).
 */
export const inlineLinkClass = "text-accent underline underline-offset-2";
