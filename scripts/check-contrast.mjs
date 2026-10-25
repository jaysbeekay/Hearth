#!/usr/bin/env node
// Contrast check for the colour tokens in src/app/globals.css (#408).
//
// Parses the light (`:root`) and dark (`prefers-color-scheme: dark`) token
// blocks and checks every text pairing the UI uses against WCAG 2.x:
//   - text tokens on background and surface: >= 4.5:1
//   - each semantic colour on its own 10% tint (pills and banners), with the
//     tint composited over both surface and background: >= 4.5:1
//   - accent-foreground on accent, danger-foreground on danger: >= 4.5:1
//   - borders against background and surface: >= 1.4:1 (non-text, visible)
//
// Run directly (`node scripts/check-contrast.mjs`) for a table, or through
// `npm run test:unit` (tests/unit/contrast.test.ts), which fails on any miss.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const TEXT_MIN = 4.5;
const BORDER_MIN = 1.4;
const TINT_ALPHA = 0.1;

const TEXT_TOKENS = ["foreground", "muted", "accent", "danger", "warning", "success"];
const SEMANTIC_TOKENS = ["muted", "accent", "danger", "warning", "success"];
const GROUNDS = ["background", "surface"];

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

function luminance([r, g, b]) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

function mix(fg, bg, alpha) {
  return fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)));
}

function parseBlock(block) {
  const tokens = {};
  for (const m of block.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{3,6})\s*;/g)) {
    tokens[m[1]] = hexToRgb(m[2]);
  }
  return tokens;
}

/** Extracts the light and dark hex tokens from globals.css source. */
export function parseThemes(css) {
  const light = css.match(/^:root\s*\{([\s\S]*?)\n\}/m);
  const dark = css.match(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([\s\S]*?)\}/);
  if (!light || !dark) throw new Error("Couldn't find the :root and dark token blocks in globals.css");
  const lightTokens = parseBlock(light[1]);
  // Dark mode only overrides what changes, so start from the light set.
  return { light: lightTokens, dark: { ...lightTokens, ...parseBlock(dark[1]) } };
}

/** Returns one row per checked pairing, per theme. */
export function checkContrast(css) {
  const themes = parseThemes(css);
  const rows = [];
  for (const [theme, t] of Object.entries(themes)) {
    const need = (name) => {
      if (!t[name]) throw new Error(`Missing --${name} in the ${theme} theme`);
      return t[name];
    };
    const add = (pair, ratio, min) => rows.push({ theme, pair, ratio, min, pass: ratio >= min });

    for (const text of TEXT_TOKENS) {
      for (const ground of GROUNDS) {
        add(`${text} on ${ground}`, contrast(need(text), need(ground)), TEXT_MIN);
      }
    }
    for (const tone of SEMANTIC_TOKENS) {
      for (const ground of GROUNDS) {
        const tint = mix(need(tone), need(ground), TINT_ALPHA);
        add(`${tone} on ${tone}/10 over ${ground}`, contrast(need(tone), tint), TEXT_MIN);
      }
    }
    add("accent-foreground on accent", contrast(need("accent-foreground"), need("accent")), TEXT_MIN);
    add("danger-foreground on danger", contrast(need("danger-foreground"), need("danger")), TEXT_MIN);
    for (const ground of GROUNDS) {
      add(`border on ${ground}`, contrast(need("border"), need(ground)), BORDER_MIN);
    }
  }
  return rows;
}

export function readGlobalsCss() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return readFileSync(path.join(here, "..", "src", "app", "globals.css"), "utf8");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const rows = checkContrast(readGlobalsCss());
  const width = Math.max(...rows.map((r) => r.pair.length));
  for (const r of rows) {
    console.log(
      `${r.pass ? "ok  " : "FAIL"} ${r.theme.padEnd(5)} ${r.pair.padEnd(width)} ${r.ratio.toFixed(2).padStart(5)}:1 (min ${r.min})`,
    );
  }
  const failed = rows.filter((r) => !r.pass);
  console.log(failed.length ? `\n${failed.length} pairing(s) below minimum` : `\nAll ${rows.length} pairings pass`);
  process.exit(failed.length ? 1 : 0);
}
