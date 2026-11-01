import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { inputClass, reviewFieldClass } from "@/lib/ui";
import { bannerRepeatsBadge, type DueEntry } from "@/lib/dueRecords";

// #406 — the consistency pass, checked against the source so a new form or
// select can't drift back.

const root = path.join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return pages(full);
    return name === "page.tsx" ? [path.relative(root, full)] : [];
  });
}

const formPages = pages(path.join(root, "src", "app", "(app)")).filter((p) =>
  /[/\\](new|edit|renew)[/\\]page\.tsx$/.test(p),
);

describe("forms", () => {
  it("finds the add and edit pages", () => {
    expect(formPages.length).toBeGreaterThan(20);
  });

  it("gives every add and edit page a Cancel that goes where its BackLink goes", () => {
    const missing = formPages.filter((p) => {
      const text = read(p);
      const back = text.match(/<BackLink href=(\{`[^`]*`\}|"[^"]*")/)?.[1];
      return !back || !text.includes(`cancelHref=${back}`);
    });
    expect(missing).toEqual([]);
  });

  it("renders Cancel beside Save in every form those pages use", () => {
    const forms = new Set(
      formPages.flatMap((p) => [...read(p).matchAll(/<([A-Z]\w*Form) cancelHref=/g)].map((m) => m[1])),
    );
    const missing = [...forms].filter((f) => !read(`src/components/${f}.tsx`).includes("<FormActions cancelHref={cancelHref}>"));
    expect(missing).toEqual([]);
  });
});

describe("selects", () => {
  it("styles every native select with the shared input look", () => {
    const dir = path.join(root, "src", "components");
    const unstyled = readdirSync(dir)
      .filter((f) => f.endsWith(".tsx"))
      .flatMap((f) =>
        // The opening tag runs to the first <option or {, which is where its
        // children start; a className set to anything but the shared helpers fails.
        [...read(`src/components/${f}`).matchAll(/<select\b[\s\S]*?(?=<option|\n\s*\{)/g)]
          .filter((m) => !/className=\{(selectClass|inputClass|fieldClass\(|selectClassName|pillClass\()/.test(m[0]))
          .map(() => f),
      );
    expect(unstyled).toEqual([]);
  });

  it("builds Import and Inbox review fields from the shared input look", () => {
    expect(reviewFieldClass("none")).toBe(inputClass);
    for (const fill of ["extracted", "ai"] as const) {
      expect(reviewFieldClass(fill)).toMatch(/\bh-9\b.*\bpx-3\b/);
    }
  });
});

// #405 — plainer record pages.
describe("record pages", () => {
  const entry = (field: string, date: string, state: string) =>
    ({ field, date, state, daysLeft: 10, label: "", labelParts: {} }) as unknown as DueEntry;

  it("drops the header badge only while the banner states the same entry", () => {
    const soon = entry("endDate", "2026-11-11", "due-soon");
    const later = entry("endDate", "2027-11-11", "later");
    expect(bannerRepeatsBadge(soon, [soon])).toBe(true);
    expect(bannerRepeatsBadge(later, [later])).toBe(false);
    expect(bannerRepeatsBadge(soon, [entry("noticeDate", "2026-11-01", "due-soon"), later])).toBe(false);
    expect(bannerRepeatsBadge(null, [soon])).toBe(false);
  });

  it("puts every destructive record action in a ⋮ menu, not a red button on the page", () => {
    const app = path.join(root, "src", "app", "(app)");
    const offenders = pages(app)
      .filter((p) => !p.includes(`${path.sep}settings${path.sep}`))
      .filter((p) => /buttonClass\([^)]*destructive: true/.test(read(p)));
    expect(offenders).toEqual([]);
  });

  it("gives entry rows one quiet Add document instead of an upload form each", () => {
    const rowPages = [
      "src/app/(app)/travel/[id]/page.tsx",
      "src/app/(app)/home/[id]/page.tsx",
      "src/app/(app)/home/[id]/rental/page.tsx",
      "src/app/(app)/vehicles/[id]/page.tsx",
      "src/app/(app)/wealth/portfolios/[id]/holdings/[hId]/page.tsx",
    ];
    for (const p of rowPages) {
      expect(read(p), p).not.toContain("DocumentUploadForm");
      expect(read(p), p).toContain("<AddDocumentButton");
    }
  });
});
