import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { TrashHint } from "@/components/TrashHint";

// #514 review — an empty Contracts or Warranties list says how many of its
// records are in Trash, so it doesn't read as "the household has none".
const render = (count: number) =>
  renderToStaticMarkup(createElement(TrashHint, { count, singular: "contract", plural: "contracts" }));

describe("TrashHint", () => {
  it("renders nothing when Trash holds none", () => {
    expect(render(0)).toBe("");
  });

  it("counts and links to Trash", () => {
    expect(render(1)).toContain("1 contract is in");
    expect(render(3)).toContain("3 contracts are in");
    expect(render(3)).toContain('href="/settings/trash"');
    expect(render(3)).toContain("and can be restored.");
  });

  it("is shown under the empty Contracts and Warranties lists, not under a filtered one", () => {
    const root = path.join(__dirname, "..", "..");
    for (const name of ["ContractListClient", "ProductListClient"]) {
      const source = readFileSync(path.join(root, "src", "components", `${name}.tsx`), "utf8");
      expect(source).toMatch(/\{!filtered && <TrashHint count=\{trashCount\}/);
    }
  });
});
