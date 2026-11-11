import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// #616: the phone shell takes its colours from the web app's tokens. Every
// colour in style.css is a token from its :root or dark block, and none of the
// shell's old violet/beige/navy palette survives in its files.

const shellDir = path.join(__dirname, "..", "..", "ios-shell", "www");
const read = (file: string) => readFileSync(path.join(shellDir, file), "utf8");

const OLD_PALETTE = [
  "#533afd",
  "#3b2adb",
  "#a391ff",
  "#f7f4ee",
  "#fffdf9",
  "#e9e1d2",
  "#061b31",
  "#5f5649",
  "#a16000",
  "#fff4d8",
  "#0b7a36",
  "#a8103f",
  "#161746",
  "#202359",
  "#272a68",
  "#39334a",
  "#eef0fa",
  "#c8c1b4",
  "#ffd36b",
  "#15be53",
  "#ffa6c0",
  "83, 58, 253",
  "163, 145, 255",
  "6, 27, 49",
];

const COLOUR_LITERAL = /#[0-9a-f]{3,8}\b|\brgba?\(/i;

/** The stylesheet with its comments (an issue number like #616 isn't a colour) and token blocks cut out. */
function outsideTokenBlocks(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^:root\s*\{[\s\S]*?\n\}/m, "")
    .replace(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{[\s\S]*?\}\s*\}/, "");
}

/** Every declaration value (after a property's colon) that holds a colour literal. */
function colourLiterals(css: string): string[] {
  const values = [...css.matchAll(/:\s*([^;{}]+);/g)].map((m) => m[1].trim());
  return values.filter((value) => COLOUR_LITERAL.test(value));
}

function oldPaletteHits(text: string): string[] {
  const lower = text.toLowerCase();
  return OLD_PALETTE.filter((colour) => lower.includes(colour));
}

describe("phone shell palette", () => {
  it("has no colour literals in style.css outside the token blocks", () => {
    expect(colourLiterals(outsideTokenBlocks(read("style.css")))).toEqual([]);
  });

  it.each(readdirSync(shellDir).filter((file) => /\.(svg|js|html|css)$/.test(file)))(
    "%s has none of the old palette",
    (file) => {
      expect(oldPaletteHits(read(file))).toEqual([]);
    },
  );

  it("catches the old violet icon and a stray colour outside the tokens", () => {
    expect(oldPaletteHits('<rect fill="#533AFD"/>')).toEqual(["#533afd"]);
    expect(colourLiterals(outsideTokenBlocks(":root {\n  --accent: #1e5bb6;\n}\n\n.x {\n  color: #fff;\n}\n"))).toEqual([
      "#fff",
    ]);
    expect(colourLiterals(outsideTokenBlocks(":root {\n  --accent: #1e5bb6;\n}\n"))).toEqual([]);
  });
});
