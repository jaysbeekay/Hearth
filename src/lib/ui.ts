// #411 — the shared UI rules, as class strings. This module is the one
// place a card, pill, banner, filter chip or page width is decided; the
// components in src/components/ui.tsx and buttonStyles.ts build on it.
//
// The rules (see the issue for the audit behind them):
// - Type: five sizes (text-2xl/xl/base/sm/xs = 24/20/16/14/12) and two
//   weights (400 and font-medium). Sentence case, no upper-casing or letter tracking.
// - Shape: rounded-lg everywhere; rounded-full only for the FAB and dots.
//   1px borders, dashed only for the file drop zone. No card shadows; menus
//   and dialogs use shadow-overlay.
// - Spacing: steps 1/2/3/4/6/8. Cards are p-4; sections space-y-6.
//
// Pure and free of runtime imports, so server and client components (and
// statusTone.ts) share it.

function join(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

// The few class groups a caller's extra classes may override. Tailwind
// decides between two classes of one group by stylesheet order, not by the
// order in the class string, so an override has to replace the base class
// instead of sitting beside it.
const GROUPS: RegExp[] = [
  /^(inline-flex|flex|block|inline-block|hidden|grid)$/,
  /^justify-/,
  /^items-/,
  /^gap-/,
  /^px-/,
  /^py-/,
  /^p-/,
  /^h-/,
  /^w-/,
  /^text-(xs|sm|base|lg|xl|2xl)$/,
  /^text-(foreground|muted|accent|accent-foreground|danger|danger-foreground|warning|success)$/,
];

/** Base classes plus extras, where an extra replaces a base class of the same group. */
export function mergeClasses(base: string, extra?: string | false | null): string {
  if (!extra) return base;
  const extras = extra.split(/\s+/).filter(Boolean);
  const overridden = GROUPS.filter((g) => extras.some((x) => g.test(x)));
  const kept = base.split(/\s+/).filter((b) => b && !overridden.some((g) => g.test(b)));
  return [...kept, ...extras].join(" ");
}

// ---- Card -----------------------------------------------------------------

const CARD = "rounded-lg border border-border bg-surface";

/**
 * A card's classes. `padding: "none"` is for cards whose rows carry their
 * own padding (a divided list, a table, a map).
 */
export function cardClass(extra?: string, { padding = "default" }: { padding?: "default" | "none" } = {}) {
  return mergeClasses(join(CARD, padding === "default" && "p-4"), extra);
}

/** An empty list or "nothing here yet" box: a quiet card, not a dashed one. */
export function emptyStateClass(extra?: string) {
  return mergeClasses("rounded-lg border border-border p-6 text-center text-sm text-muted", extra);
}

// ---- Pill -----------------------------------------------------------------

/**
 * A pill's tone. danger/warning are for Due states (statusTone.ts decides
 * which), success for confirmations ("Connected", "Enabled"), accent for a
 * count or "new", neutral for everything else.
 */
export type PillTone = "danger" | "warning" | "success" | "accent" | "neutral";

const PILL_BASE = "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-2 py-0.5 text-xs font-medium";

const PILL_TONE = new Map<PillTone, string>([
  ["danger", "bg-danger/10 text-danger"],
  ["warning", "bg-warning/10 text-warning"],
  ["success", "bg-success/10 text-success"],
  ["accent", "bg-accent/10 text-accent"],
  ["neutral", "bg-muted/10 text-muted"],
]);

export function pillClass(tone: PillTone = "neutral", extra?: string) {
  return mergeClasses(join(PILL_BASE, PILL_TONE.get(tone) ?? ""), extra);
}

/** Text that lines up with pills but has no tint (a `later` date). */
export const plainPillClass = "inline-flex shrink-0 items-center gap-1 whitespace-nowrap py-0.5 text-xs font-medium text-muted";

// ---- Banner ---------------------------------------------------------------

/**
 * A banner's tone: danger/warning for something that needs acting on,
 * success for a confirmation, accent for a tip or a suggestion, neutral for
 * information, plain for a banner on the page background that shouldn't be
 * tinted.
 */
export type BannerTone = "danger" | "warning" | "success" | "accent" | "neutral" | "plain";

const BANNER_TONE = new Map<BannerTone, string>([
  ["danger", "border-danger/30 bg-danger/10 text-danger"],
  ["warning", "border-warning/30 bg-warning/10 text-warning"],
  ["success", "border-success/30 bg-success/10 text-success"],
  ["accent", "border-accent/30 bg-accent/5 text-foreground"],
  ["neutral", "border-border bg-muted/10 text-foreground"],
  ["plain", "border-border bg-surface text-foreground"],
]);

/** Only the border, tint and text colour, for a banner with its own layout. */
export function bannerToneClass(tone: BannerTone) {
  return BANNER_TONE.get(tone) ?? "";
}

export function bannerClass(tone: BannerTone = "neutral", extra?: string) {
  return mergeClasses(join("rounded-lg border px-4 py-3 text-sm", BANNER_TONE.get(tone) ?? ""), extra);
}

// ---- Filter chip ----------------------------------------------------------

/**
 * A filter chip looks like a small secondary button, so it reads as
 * something to press and not as a status pill. The selected chip takes the
 * accent border and text. 36px visual, 44px hit area (see buttonStyles.ts).
 */
/** A chip's shape without its colours, for a chip that takes a status tone. */
export const chipShapeClass =
  "relative inline-flex h-9 shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap rounded-lg border px-3 text-sm font-medium transition-colors after:absolute after:inset-x-0 after:-inset-y-1 after:content-['']";

export function chipClass(selected: boolean, extra?: string) {
  return mergeClasses(
    join(chipShapeClass, selected ? "border-accent bg-accent/10 text-accent" : "border-border bg-surface text-foreground hover:bg-hover-surface"),
    extra,
  );
}

// ---- Overlay --------------------------------------------------------------

/** A dialog, sheet or dropdown menu panel: the one place shadow-overlay is used. */
export function overlayClass(extra?: string) {
  return mergeClasses("rounded-lg border border-border bg-surface shadow-overlay", extra);
}

// ---- Form controls --------------------------------------------------------

/** Text inputs and selects: one 36px control. Textareas keep their own height. */
export const inputClass =
  "h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-accent";

/** A textarea: the input look at its own height. */
export const textareaClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-accent";

/** A select inside SelectWrapper, which draws the chevron in the pr-8 gap. */
export const selectClass = `${inputClass} appearance-none pr-8`;

// ---- Page width -----------------------------------------------------------

/**
 * The page widths: lists and the dashboard, a record's detail page, forms
 * and settings, and the signed-out auth pages.
 */
export type PageWidth = "list" | "detail" | "form" | "auth";

const PAGE_WIDTH = new Map<PageWidth, string>([
  ["list", "max-w-5xl"],
  ["detail", "max-w-3xl"],
  ["form", "max-w-2xl"],
  ["auth", "max-w-sm"],
]);

export function pageShellClass(width: PageWidth, extra?: string) {
  return mergeClasses(join("w-full space-y-6", PAGE_WIDTH.get(width) ?? ""), extra);
}
