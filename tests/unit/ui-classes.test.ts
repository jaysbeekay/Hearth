import { describe, expect, it } from "vitest";
import { bannerClass, cardClass, mergeClasses, pageShellClass, pillClass } from "@/lib/ui";
import { buttonClass } from "@/lib/buttonStyles";

// #411 — the shared UI class helpers.

const tokens = (s: string) => s.split(/\s+/);

describe("mergeClasses", () => {
  it("lets an extra class replace a base class of the same group", () => {
    const out = tokens(mergeClasses("flex justify-center px-3 text-sm text-foreground", "justify-between text-danger"));
    expect(out).toContain("justify-between");
    expect(out).not.toContain("justify-center");
    expect(out).toContain("text-danger");
    expect(out).not.toContain("text-foreground");
    // Size and colour are separate groups.
    expect(out).toContain("text-sm");
  });

  it("keeps base classes the extras don't touch", () => {
    expect(mergeClasses("rounded-lg border p-4", "space-y-4")).toBe("rounded-lg border p-4 space-y-4");
    expect(mergeClasses("rounded-lg border", undefined)).toBe("rounded-lg border");
  });
});

describe("buttonClass", () => {
  it("is one 36px size with a 44px hit area for every variant", () => {
    for (const variant of ["primary", "secondary", "quiet", "danger"] as const) {
      const out = tokens(buttonClass(variant));
      expect(out).toContain("h-9");
      expect(out).toContain("after:-inset-y-1");
      expect(out).toContain("rounded-lg");
    }
    expect(tokens(buttonClass("quiet", { iconOnly: true }))).toEqual(expect.arrayContaining(["w-9", "after:-inset-1"]));
  });

  it("only primary and danger are filled", () => {
    expect(buttonClass("primary")).toContain("bg-accent ");
    expect(buttonClass("danger")).toContain("bg-danger ");
    expect(buttonClass("secondary")).not.toMatch(/\bbg-(accent|danger)\b/);
    expect(buttonClass("quiet")).not.toMatch(/\bbg-(accent|danger)\b/);
  });

  it("hides on phones without a display-class clash", () => {
    const out = tokens(buttonClass("secondary", { className: "max-sm:hidden" }));
    expect(out).toContain("max-sm:hidden");
    expect(out).toContain("inline-flex");
  });
});

describe("cards, pills, banners and page widths", () => {
  it("cards are p-4 unless they ask for no padding", () => {
    expect(tokens(cardClass())).toContain("p-4");
    expect(tokens(cardClass(undefined, { padding: "none" }))).not.toContain("p-4");
  });

  it("use rounded-lg and no shadows", () => {
    for (const cls of [cardClass(), pillClass("danger"), bannerClass("warning")]) {
      expect(tokens(cls)).toContain("rounded-lg");
      expect(cls).not.toMatch(/\bshadow/);
    }
  });

  it("maps each page kind to its width", () => {
    expect(pageShellClass("list")).toContain("max-w-5xl");
    expect(pageShellClass("detail")).toContain("max-w-3xl");
    expect(pageShellClass("form")).toContain("max-w-2xl");
    expect(pageShellClass("auth")).toContain("max-w-sm");
  });
});

describe("the class rules hold across src", () => {
  // The grep from #411's acceptance criteria, so drift fails a test.
  it("uses no off-scale radius, shadow, weight, size, case or icon size", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== "generated") walk(p);
        } else if (/\.(tsx?|css)$/.test(e.name)) files.push(p);
      }
    };
    walk(path.join(process.cwd(), "src"));
    const banned =
      /rounded-xl|rounded-md|shadow-(md|lg|xl|stripe)|font-(semibold|bold)|text-(lg|3xl)|text-\[\d+px\]|uppercase|size=\{(?!16\}|20\})\d+\}/;
    const hits = files.flatMap((f) =>
      fs
        .readFileSync(f, "utf8")
        .split("\n")
        .map((line, i) => ({ line, at: `${path.relative(process.cwd(), f)}:${i + 1}` }))
        .filter(({ line }) => banned.test(line))
        .map(({ at, line }) => `${at}: ${line.trim()}`),
    );
    expect(hits).toEqual([]);
  });
});
