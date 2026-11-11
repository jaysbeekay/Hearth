// #617 — honour the OS "reduce motion" setting for motion we start from
// script. CSS transitions use Tailwind's `motion-reduce:` variant instead.

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Whether the viewer asked for reduced motion. False where there's no window (SSR). */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** The `behavior` for a script-driven scroll: instant under reduced motion. */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? "auto" : "smooth";
}
