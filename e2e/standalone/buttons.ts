import type { Page } from "@playwright/test";

// #630: the web app's Buttons rule (src/lib/ui.ts, #411) in the phone shell —
// at most one primary (filled accent) button per screen. Returns the label of
// every visible button on the screen whose background is the accent colour.
export async function filledPrimaryButtons(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.background = "var(--accent)";
    document.body.append(probe);
    const accent = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const labels: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("button")) {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if ((rect.width === 0 && rect.height === 0) || style.visibility === "hidden") continue;
      if (style.backgroundColor === accent) labels.push((el.textContent ?? "").trim());
    }
    return labels;
  });
}

// A destructive action outside a confirm dialog, as buttonClass("secondary",
// { destructive: true }): no fill, the control border, danger text.
export async function destructiveButtonStyle(page: Page, selector: string) {
  return page.locator(selector).first().evaluate((el) => {
    const probe = document.createElement("div");
    probe.style.color = "var(--danger)";
    probe.style.borderColor = "var(--border-control)";
    document.body.append(probe);
    const tokens = getComputedStyle(probe);
    const want = { danger: tokens.color, borderControl: tokens.borderColor };
    probe.remove();
    const style = getComputedStyle(el);
    return {
      transparent: style.backgroundColor === "rgba(0, 0, 0, 0)",
      dangerText: style.color === want.danger,
      controlBorder: style.borderTopWidth === "1px" && style.borderTopColor === want.borderControl,
    };
  });
}
