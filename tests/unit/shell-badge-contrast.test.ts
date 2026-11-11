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

// A token is a hex colour, or (#616) a translucent tint of another token:
// color-mix(in srgb, var(--x) N%, transparent), resolved once the theme's
// tokens are merged so a dark tint uses the dark colour.
type Raw = { hex: number[] } | { of: string; alpha: number };

function parseBlock(block: string): Map<string, Raw> {
  const tokens = new Map<string, Raw>();
  for (const m of block.matchAll(/--([a-z-]+):\s*([^;]+);/g)) {
    const [, name, value] = m;
    const hex = value.match(/^#([0-9a-f]{6})$/i);
    if (hex) {
      const n = parseInt(hex[1], 16);
      tokens.set(name, { hex: [(n >> 16) & 255, (n >> 8) & 255, n & 255] });
      continue;
    }
    const tint = value.match(/^color-mix\(in srgb,\s*var\(--([a-z-]+)\)\s+([\d.]+)%,\s*transparent\)$/);
    if (tint) tokens.set(name, { of: tint[1], alpha: Number(tint[2]) / 100 });
  }
  return tokens;
}

function resolve(raw: Map<string, Raw>): Map<string, Rgba> {
  const out = new Map<string, Rgba>();
  for (const [name, t] of raw) {
    if ("hex" in t) {
      out.set(name, [t.hex[0], t.hex[1], t.hex[2], 1]);
      continue;
    }
    const base = raw.get(t.of);
    if (!base || !("hex" in base)) throw new Error(`--${name} tints --${t.of}, which isn't a hex colour`);
    out.set(name, [base.hex[0], base.hex[1], base.hex[2], t.alpha]);
  }
  return out;
}

const lightRaw = parseBlock(css.match(/^:root\s*\{([\s\S]*?)\n\}/m)![1]);
const light = resolve(lightRaw);
const dark = resolve(
  new Map([
    ...lightRaw,
    ...parseBlock(css.match(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([\s\S]*?)\}/)![1]),
  ]),
);

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
    for (const ground of ["background", "surface"]) {
      const base = rgb(tokens, ground);
      rows.push({ name: `${theme}: ${tone} badge over ${ground}`, ratio: contrast(text, over(tint, base)) });
    }
  }
  // A .warning-card / .danger-card's tint replaces the card's own background,
  // so it sits over whatever is behind the card: the page, or a section card.
  // Its badges (its own tone, or a neutral one beside it) and its muted
  // .card-meta text sit on that tint.
  const muted = rgb(tokens, "muted");
  const mutedSoft = tokens.get("muted-soft")!;
  for (const cardTone of ["warning", "danger"]) {
    const cardText = rgb(tokens, cardTone);
    const cardTint = tokens.get(`${cardTone}-soft`)!;
    for (const ground of ["background", "surface"]) {
      const card = over(cardTint, rgb(tokens, ground));
      const where = `in a ${cardTone} card over ${ground}`;
      rows.push({ name: `${theme}: ${cardTone} badge ${where}`, ratio: contrast(cardText, over(cardTint, card)) });
      rows.push({ name: `${theme}: muted badge ${where}`, ratio: contrast(muted, over(mutedSoft, card)) });
      rows.push({ name: `${theme}: muted text ${where}`, ratio: contrast(muted, card) });
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
