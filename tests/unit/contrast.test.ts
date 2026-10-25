import { describe, expect, it } from "vitest";
import { checkContrast, parseThemes, readGlobalsCss } from "../../scripts/check-contrast.mjs";

// #408: every text token pairing in globals.css stays >= 4.5:1 and borders
// stay visible (>= 1.4:1), in both themes.
describe("colour token contrast", () => {
  const rows = checkContrast(readGlobalsCss());

  it("checks both themes", () => {
    expect(new Set(rows.map((r) => r.theme))).toEqual(new Set(["light", "dark"]));
  });

  it.each(rows.map((r) => [`${r.theme}: ${r.pair}`, r] as const))("%s", (_name, row) => {
    expect(row.ratio).toBeGreaterThanOrEqual(row.min);
  });
});

describe("token parser", () => {
  const css = (darkDanger: string) => `:root {
  --background: #f6f6f4;
  --surface: #ffffff;
  --danger: #b02218;
  --hover-surface: color-mix(in srgb, var(--danger) 5%, var(--surface));
}

@media (prefers-color-scheme: dark) {
  :root {
    --background: #141414;
    --danger: ${darkDanger};
  }
}
`;

  it("reads hex values and solid color-mix tokens", () => {
    const { light, dark } = parseThemes(css("#ff8b80"));
    expect(dark.danger).toEqual([255, 139, 128]);
    // The dark theme's mix uses the dark danger over the inherited surface.
    expect(light["hover-surface"]).not.toEqual(dark["hover-surface"]);
  });

  it.each(["rgb(255, 139, 128)", "#ff8b80cc"])("throws on an unparseable dark override: %s", (value) => {
    expect(() => parseThemes(css(value))).toThrow(/--danger in the dark token block/);
  });
});
