import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { inputClass, reviewFieldClass } from "@/lib/ui";

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
          .filter((m) => !/className=\{(selectClass|inputClass|fieldClass\(|selectClassName)/.test(m[0]))
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
    const sources = readdirSync(path.join(root, "src", "components"))
      .filter((name) => name.endsWith(".tsx"))
      .map((name) => read(path.join("src", "components", name)));
    const missing = sources
      .flatMap((source) => source.match(/<FormMessage error=\{\w+\?\.error\}[^>]*>/g) ?? [])
      .filter((tag) => !tag.includes("attempt="));
    expect(missing).toEqual([]);
  });
});
