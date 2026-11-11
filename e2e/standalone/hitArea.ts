import type { Page } from "@playwright/test";

// #616: every interactive element in the phone shell has a hit area of at
// least 44x44px. An element's hit area is its border box, widened by an
// absolutely placed ::before or ::after (placed from the padding box, as the
// web app's buttons do). Returns one line per visible element that falls short.
const INTERACTIVE = [
  "button",
  "summary",
  "select",
  "input:not([type=checkbox]):not([type=hidden])",
  ".checkbox-row",
  ".nav-item",
  ".tab",
  ".chip",
  ".subtle-button",
  ".inline-copy",
  ".link-button",
].join(",");

export async function tooSmallHitAreas(page: Page): Promise<string[]> {
  return page.evaluate((selector) => {
    const misses: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      // Not rendered (a hidden screen, or the header's hidden Back button).
      if ((rect.width === 0 && rect.height === 0) || style.visibility === "hidden") continue;
      let [left, top, right, bottom] = [rect.left, rect.top, rect.right, rect.bottom];
      for (const pseudo of ["::before", "::after"]) {
        const p = getComputedStyle(el, pseudo);
        if (p.content === "none" || p.position !== "absolute") continue;
        const padTop = rect.top + parseFloat(style.borderTopWidth);
        const padLeft = rect.left + parseFloat(style.borderLeftWidth);
        const shiftY = p.transform !== "none" ? new DOMMatrix(p.transform).m42 : 0;
        const pTop = padTop + parseFloat(p.top) + shiftY;
        const pLeft = padLeft + parseFloat(p.left);
        left = Math.min(left, pLeft);
        top = Math.min(top, pTop);
        right = Math.max(right, pLeft + parseFloat(p.width));
        bottom = Math.max(bottom, pTop + parseFloat(p.height));
      }
      const width = right - left;
      const height = bottom - top;
      if (width < 43.5 || height < 43.5) {
        const label = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30);
        misses.push(`${el.tagName.toLowerCase()}.${el.className} "${label}" ${Math.round(width)}x${Math.round(height)}`);
      }
    }
    return misses;
  }, INTERACTIVE);
}
