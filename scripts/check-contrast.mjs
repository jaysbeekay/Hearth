#!/usr/bin/env node
// Contrast check for the colour tokens in src/app/globals.css (#408).
//
// Parses the light (`:root`) and dark (`prefers-color-scheme: dark`) token
// blocks and checks every text pairing the UI uses against WCAG 2.x:
//   - text tokens on background and surface: >= 4.5:1
//   - each semantic colour on its own 10% tint (pills and banners), with the
//     tint composited over both surface and background: >= 4.5:1
//   - the same tint stacked twice (a tinted control inside a tinted banner),
//     over both surface and background: >= 4.5:1
//   - text tokens on the solid hover-surface: >= 4.5:1
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

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
// color-mix(in srgb, var(--a) N%, var(--b)): a solid mix of two other tokens.
const SOLID_MIX = /^color-mix\(in srgb,\s*var\(--([a-z-]+)\)\s+(\d+(?:\.\d+)?)%,\s*var\(--([a-z-]+)\)\)$/;
// color-mix(in srgb, var(--a) N%, transparent): a translucent overlay, which
// has no fixed colour of its own to check.
const TRANSLUCENT_MIX = /^color-mix\(in srgb,\s*var\(--[a-z-]+\)\s+\d+(?:\.\d+)?%,\s*transparent\)$/;
// Tokens that aren't colours at all.
const isNonColourToken = (name) => name.startsWith("font-") || name.endsWith("-shadow");

/**
 * Parses every `--name: value;` declaration in a token block. A colour token
 * whose value isn't a 3/6-digit hex or a recognised color-mix throws, so an
 * rgb() or 8-digit-hex override can't silently fall back to the light value.
 */
function parseBlock(block, label) {
  const tokens = {};
  for (const line of block.split("\n")) {
    const m = line.match(/^\s*--([a-z0-9-]+):\s*(.*?)\s*;?\s*$/);
    if (!m) continue;
    const [, name, value] = m;
    if (isNonColourToken(name) || TRANSLUCENT_MIX.test(value)) continue;
    if (HEX.test(value)) {
      tokens[name] = hexToRgb(value);
      continue;
    }
    const mixed = value.match(SOLID_MIX);
    if (mixed) {
      tokens[name] = { mix: [mixed[1], Number(mixed[2]) / 100, mixed[3]] };
      continue;
    }
    throw new Error(`Can't parse --${name} in the ${label} token block: "${value}"`);
  }
  return tokens;
}

function resolveMixes(tokens, label) {
  /** @type {Record<string, number[]>} */
  const out = {};
  const resolve = (name, seen = []) => {
    if (out[name]) return out[name];
    const t = tokens[name];
    if (!t) throw new Error(`Missing --${name} in the ${label} theme`);
    if (Array.isArray(t)) return (out[name] = t);
    if (seen.includes(name)) throw new Error(`--${name} refers to itself in the ${label} theme`);
    const [a, alpha, b] = t.mix;
    return (out[name] = mix(resolve(a, [...seen, name]), resolve(b, [...seen, name]), alpha));
  };
  for (const name of Object.keys(tokens)) resolve(name);
  return out;
}

/**
 * Extracts the light and dark colour tokens from globals.css source.
 * @param {string} css
 * @returns {{ light: Record<string, number[]>, dark: Record<string, number[]> }}
 */
export function parseThemes(css) {
  const light = css.match(/^:root\s*\{([\s\S]*?)\n\}/m);
  const dark = css.match(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([\s\S]*?)\}/);
  if (!light || !dark) throw new Error("Couldn't find the :root and dark token blocks in globals.css");
  const lightTokens = parseBlock(light[1], "light");
  // Dark mode only overrides what changes, so start from the light set. Mixes
  // resolve after the merge, so a light-only mix uses the dark inputs.
  const darkTokens = { ...lightTokens, ...parseBlock(dark[1], "dark") };
  return { light: resolveMixes(lightTokens, "light"), dark: resolveMixes(darkTokens, "dark") };
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
        // A tinted control inside a tinted banner stacks the two tints.
        const stacked = mix(need(tone), tint, TINT_ALPHA);
        add(`${tone} on ${tone}/10 over ${tone}/10 over ${ground}`, contrast(need(tone), stacked), TEXT_MIN);
      }
    }
    for (const text of TEXT_TOKENS) {
      add(`${text} on hover-surface`, contrast(need(text), need("hover-surface")), TEXT_MIN);
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
