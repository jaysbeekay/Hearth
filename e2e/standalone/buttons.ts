import type { Page } from "@playwright/test";

// #630: the web app's Buttons rule (src/lib/ui.ts, #411) in the phone shell —
// at most one primary (filled) button per screen. A button counts as filled
// when its background is the accent or the danger colour. Returns the label of
// every visible filled button.
export async function filledPrimaryButtons(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const probe = document.createElement("div");
    document.body.append(probe);
    const fills = ["--accent", "--danger"].map((token) => {
      probe.style.background = `var(${token})`;
      return getComputedStyle(probe).backgroundColor;
    });
    probe.remove();
    const labels: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("button")) {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if ((rect.width === 0 && rect.height === 0) || style.visibility === "hidden") continue;
      if (fills.includes(style.backgroundColor)) labels.push((el.textContent ?? "").trim());
    }
    return labels;
  });
}

/**
 * The first match's background, text and border colours, each named by the
 * token it equals ("surface", "danger", ...), "transparent", or the raw
 * computed colour when it matches no token.
 */
export async function colourLook(page: Page, selector: string) {
  return page.locator(selector).first().evaluate((el) => {
    const probe = document.createElement("div");
    document.body.append(probe);
    const tokens = ["surface", "background", "accent", "accent-foreground", "danger", "danger-soft", "warning", "warning-soft", "border-control", "foreground", "muted"];
    const byColour = new Map<string, string>();
    for (const token of tokens) {
      probe.style.backgroundColor = `var(--${token})`;
      const colour = getComputedStyle(probe).backgroundColor;
      if (!byColour.has(colour)) byColour.set(colour, token);
    }
    probe.remove();
    const name = (colour: string) => (colour === "rgba(0, 0, 0, 0)" ? "transparent" : (byColour.get(colour) ?? colour));
    const style = getComputedStyle(el);
    return {
      fill: name(style.backgroundColor),
      text: name(style.color),
      border: style.borderTopWidth === "0px" ? "none" : name(style.borderTopColor),
    };
  });
}
