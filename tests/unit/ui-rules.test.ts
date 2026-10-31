import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buttonClass, cardClass, pillClass, bannerClass, pageShellClass, mergeClasses } from "@/lib/ui";

// #411 — the shared UI rules, checked against the source so a new page
// can't quietly bring back a second radius, a bold weight or a hand-rolled
// card. lib/ui.ts is the one place these class strings are allowed.

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "generated" ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

const src = path.join(__dirname, "..", "..", "src");
const files = sourceFiles(src).map((file) => ({ file: path.relative(src, file), text: readFileSync(file, "utf8") }));
const UI_FILE = path.join("lib", "ui.ts");

/** Every quoted or template string in a file, so the checks only look at class-like text. */
function strings(text: string): string[] {
  return [...text.matchAll(/"([^"\n]*)"|`([^`]*)`/g)].map((m) => m[1] ?? m[2]);
}

function offenders(test: (s: string) => boolean, { skip = [UI_FILE] }: { skip?: string[] } = {}) {
  return files
    .filter((f) => !skip.includes(f.file))
    .flatMap((f) => strings(f.text).filter(test).map((s) => `${f.file}: ${s}`));
}

describe("type, shape and motion", () => {
  it("uses one radius, two weights, five sizes and sentence case", () => {
    const banned = /\b(rounded-xl|rounded-md|shadow-(md|lg|xl|stripe)|font-(semibold|bold)|text-(lg|3xl)|text-\[\d+px\]|uppercase)\b/;
    expect(offenders((s) => banned.test(s), { skip: [] })).toEqual([]);
  });

  it("sets no letter-spacing", () => {
    expect(offenders((s) => /\btracking-(tight|tighter|wide|wider|widest)\b/.test(s), { skip: [] })).toEqual([]);
  });

  it("uses only transition-colors for motion", () => {
    expect(offenders((s) => /\btransition-(all|opacity|shadow)\b|\btransition(?=\s|$)/.test(s), { skip: [] })).toEqual([]);
  });
});

describe("icons", () => {
  it("are lucide at 16px in content or 20px in navigation", () => {
    const sizes = files.flatMap((f) =>
      [...f.text.matchAll(/size=\{(\d+)\}/g)].map((m) => ({ file: f.file, size: Number(m[1]) })),
    );
    expect(sizes.filter((s) => s.size !== 16 && s.size !== 20)).toEqual([]);
  });
});

describe("components own their class strings", () => {
  it("has no card class strings outside lib/ui", () => {
    expect(offenders((s) => /\bbg-surface\b/.test(s) && /\bborder-border\b/.test(s) && /\brounded-lg\b/.test(s))).toEqual([]);
  });

  it("has no pill class strings outside lib/ui", () => {
    expect(
      offenders((s) => /\bbg-(danger|warning|success|accent|muted)\/10\b/.test(s) && /\btext-xs\b/.test(s) && /\brounded-/.test(s)),
    ).toEqual([]);
  });

  it("has no banner class strings outside lib/ui", () => {
    expect(offenders((s) => /\bborder-(danger|warning|success)\/\d+\b/.test(s) && /\brounded-lg\b/.test(s))).toEqual([]);
  });

  it("has no filled accent buttons outside lib/ui", () => {
    // rounded-full is the FAB and count dots, not a button.
    const filled = (s: string) =>
      /\bbg-accent\b(?!\/)/.test(s) && /\btext-accent-foreground\b/.test(s) && /\b(px|py)-/.test(s) && !/\brounded-full\b/.test(s);
    expect(offenders(filled)).toEqual([]);
  });

  it("keeps dashed borders for the file drop zones", () => {
    const dashed = files.filter((f) => /\bborder-dashed\b/.test(f.text)).map((f) => f.file);
    expect(dashed.sort()).toEqual(
      ["components/FileDropZone.tsx", "components/ImportClient.tsx", "components/WealthImportClient.tsx"].map((f) =>
        f.split("/").join(path.sep),
      ),
    );
  });
});

describe("lib/ui", () => {
  it("gives every button one 36px height with a 44px hit area", () => {
    for (const variant of ["primary", "secondary", "quiet", "danger"] as const) {
      const cls = buttonClass(variant);
      expect(cls).toContain("h-9");
      // ::before sits on the padding box: 4px out, or 5px past a 1px border.
      expect(cls).toContain(variant === "secondary" ? "before:-inset-[5px]" : "before:-inset-1");
      expect(cls).toContain("rounded-lg");
    }
    expect(buttonClass("secondary", { icon: true })).toContain("w-9");
  });

  it("gives cards p-4 and no shadow", () => {
    expect(cardClass()).toContain("p-4");
    expect(cardClass()).not.toMatch(/shadow/);
    expect(cardClass({ padding: "none" })).not.toMatch(/\bp-4\b/);
  });

  it("rounds pills and banners like everything else", () => {
    expect(pillClass("danger")).toContain("rounded-lg");
    expect(bannerClass("warning")).toContain("rounded-lg");
  });

  it("sets the page widths from the issue", () => {
    expect(pageShellClass("list")).toContain("max-w-5xl");
    expect(pageShellClass("detail")).toContain("max-w-3xl");
    expect(pageShellClass("form")).toContain("max-w-2xl");
    expect(pageShellClass("auth")).toContain("max-w-sm");
  });
});

describe("mergeClasses", () => {
  it("lets an extra class replace the base class of its group", () => {
    expect(mergeClasses("inline-flex h-9 px-3 text-sm", "hidden")).toBe("h-9 px-3 text-sm hidden");
    expect(mergeClasses("rounded-lg p-4", "p-0")).toBe("rounded-lg p-0");
    expect(buttonClass("secondary", {}, "w-full").split(" ")).toContain("w-full");
    expect(buttonClass("secondary", { icon: true }, "w-full").split(" ")).not.toContain("w-9");
  });

  it("leaves responsive and state variants alongside the base", () => {
    const cls = buttonClass("secondary", {}, "max-sm:hidden sm:w-auto");
    expect(cls).toContain("inline-flex");
    expect(cls).toContain("max-sm:hidden");
    expect(cardClass({}, "md:p-6")).toContain("p-4");
  });
});
