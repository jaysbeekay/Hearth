import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { inputClass, reviewFieldClass } from "@/lib/ui";
import { bannerRepeatsBadge, type DueEntry } from "@/lib/dueRecords";

// #406 — the consistency pass, checked against the source so a new form or
// select can't drift back.

const root = path.join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

// Every .tsx file under src/, as repo-relative paths, so a check covers
// src/app and src/components/ui as well as the top-level components.
function tsxFiles(dir: string): string[] {
  return readdirSync(path.join(root, dir)).flatMap((name) => {
    const rel = path.join(dir, name);
    if (statSync(path.join(root, rel)).isDirectory()) return name === "generated" ? [] : tsxFiles(rel);
    return name.endsWith(".tsx") ? [rel] : [];
  });
}

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

describe("verbs", () => {
  it('says "Add …", not "New …", for a page or button that adds a record', () => {
    const offenders = tsxFiles("src/app").filter((f) => /<h1[^>]*>New |^\s+New [a-z]+\s*$/m.test(read(f)));
    expect(offenders).toEqual([]);
  });
});

describe("selects", () => {
  it("styles every native select with the shared input look", () => {
    const unstyled = tsxFiles("src")
      .flatMap((f) =>
        // The opening tag runs to the first <option or {, which is where its
        // children start; a className set to anything but the shared helpers fails.
        [...read(f).matchAll(/<select\b[\s\S]*?(?=<option|\n\s*\{)/g)]
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

describe("FormMessage on a repeated failure (#514 review)", () => {
  it("announces the same error again when it comes from a new submission", async () => {
    const { isNewMessage } = await import("@/components/FormMessage");
    const first = { error: "Title is required" };
    const second = { error: "Title is required" };
    const last = { message: "Title is required", attempt: first };
    expect(isNewMessage("Title is required", first, last)).toBe(false);
    expect(isNewMessage("Title is required", second, last)).toBe(true);
    expect(isNewMessage("Another error", first, last)).toBe(true);
    // Without an attempt, only a different message counts.
    expect(isNewMessage("Title is required", undefined, { message: "Title is required", attempt: undefined })).toBe(false);
  });

  it("every action-state FormMessage passes its state as the attempt", () => {
    const tags = tsxFiles("src").flatMap((f) => read(f).match(/<FormMessage\s[^>]*\berror=\{[^}]*\}[^>]*>/g) ?? []);
    // Guard against the pattern going stale and matching nothing.
    expect(tags.length).toBeGreaterThan(10);
    expect(tags.filter((tag) => !tag.includes("attempt="))).toEqual([]);
  });
});

// #406 — a validation error is shown once, next to its field.
describe("field errors", () => {
  it("names the field of the first issue, from a real schema", async () => {
    const { issueState } = await import("@/lib/validation/issues");
    const { tripSchema } = await import("@/lib/validation/travel");
    const parsed = tripSchema.safeParse({ title: "Trip", startDate: "2026-09-10", endDate: "2026-09-01" });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(issueState(parsed.error)).toEqual({ error: "End date can't be before the start date.", field: "endDate" });
  });

  it("leaves a whole-form issue, or no issue, without a field", async () => {
    const { issueState } = await import("@/lib/validation/issues");
    expect(issueState({ issues: [{ message: "Pick one", path: [] }] })).toEqual({ error: "Pick one" });
    expect(issueState({ issues: [{ message: "Bad row", path: [0, "title"] }] })).toEqual({ error: "Bad row" });
    expect(issueState({ issues: [] })).toEqual({ error: "Invalid input" });
  });

  it("returns Zod failures through issueState in every record action", () => {
    const dir = path.join(root, "src", "lib", "actions");
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith(".ts"))
      // The Assistant's tool results ({ success: false, error }) aren't a
      // form, so they keep the message alone.
      .filter((f) =>
        /(?<!success: false, )\berror: (firstIssueMessage\(|parsed\.error\.issues\[0\])/.test(read(`src/lib/actions/${f}`)),
      );
    expect(offenders).toEqual([]);
  });

  it("passes the action's field to FormMessage wherever a form uses Field", () => {
    const missing = tsxFiles("src/components").filter((f) => {
      const text = read(f);
      return (
        text.includes('from "@/components/FormField"') &&
        /<FormMessage attempt=\{state\} error=\{state\?\.error\}/.test(text) &&
        !text.includes("field={state?.field}")
      );
    });
    expect(missing).toEqual([]);
  });

  it("passes field only to forms that have a Field to show it in", () => {
    const pointless = tsxFiles("src/components").filter(
      (f) => read(f).includes("field={state?.field}") && !read(f).includes('from "@/components/FormField"'),
    );
    expect(pointless).toEqual([]);
  });
});
