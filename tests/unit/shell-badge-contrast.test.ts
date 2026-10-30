import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { contrast } from "../../scripts/check-contrast.mjs";

// #412 — the standalone shell's badges (ios-shell/www/style.css) follow the
// same rule as the web app's pills: neutral unless Overdue (danger) or Due
// soon (warning), and every badge's text >= 4.5:1 on its tint in both
// themes, on a card, on the page, and inside a card of its own tone.

type Rgba = [number, number, number, number];

const css = readFileSync(path.join(__dirname, "..", "..", "ios-shell", "www", "style.css"), "utf8");

function parseBlock(block: string): Map<string, Rgba> {
  const tokens = new Map<string, Rgba>();
  for (const m of block.matchAll(/--([a-z-]+):\s*([^;]+);/g)) {
    const [, name, value] = m;
    const hex = value.match(/^#([0-9a-f]{6})$/i);
    if (hex) {
      const n = parseInt(hex[1], 16);
      tokens.set(name, [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1]);
      continue;
    }
    const rgba = value.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/);
    if (rgba) tokens.set(name, [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), Number(rgba[4])]);
  }
  return tokens;
}

const light = parseBlock(css.match(/^:root\s*\{([\s\S]*?)\n\}/m)![1]);
const dark = new Map([
  ...light,
  ...parseBlock(css.match(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([\s\S]*?)\}/)![1]),
]);

function over([r, g, b, a]: Rgba, under: number[]): number[] {
  return [r, g, b].map((c, i) => Math.round(c * a + under[i] * (1 - a)));
}

function rgb(tokens: Map<string, Rgba>, name: string): number[] {
  const t = tokens.get(name);
  if (!t) throw new Error(`Missing --${name} in the shell's style.css`);
  return t.slice(0, 3);
}

const rows: { name: string; ratio: number }[] = [];
for (const [theme, tokens] of [
  ["light", light],
  ["dark", dark],
] as const) {
  for (const tone of ["muted", "warning", "danger"]) {
    const text = rgb(tokens, tone);
    const tint = tokens.get(`${tone}-soft`)!;
    for (const ground of ["background", "surface", "surface-raised"]) {
      const base = rgb(tokens, ground);
      rows.push({ name: `${theme}: ${tone} badge over ${ground}`, ratio: contrast(text, over(tint, base)) });
    }
    if (tone !== "muted") {
      // A badge inside a .warning-card / .danger-card, whose tint replaces the
      // card's own background over the page.
      const card = over(tint, rgb(tokens, "background"));
      rows.push({ name: `${theme}: ${tone} badge in a ${tone} card`, ratio: contrast(text, over(tint, card)) });
    }
  }
}

describe("standalone shell badge contrast", () => {
  it.each(rows.map((r) => [r.name, r.ratio] as const))("%s", (_name, ratio) => {
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("makes the plain badge neutral, not the accent colour", () => {
    const badge = css.match(/\n\.badge \{\n  display:([\s\S]*?)\}/)![1];
    expect(badge).toContain("color: var(--muted)");
    expect(badge).toContain("background: var(--muted-soft)");
  });
});
