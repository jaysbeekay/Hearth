import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Field } from "@/components/FormField";
import { FormMessage } from "@/components/FormMessage";
import { addDescribedBy, removeDescribedBy, fieldHintId } from "@/lib/describedBy";

// #615 — a Field's hint is linked to its control, and field errors are
// announced with an "Error:" prefix. The DOM linking itself is covered by
// e2e/specs/02-validation.spec.ts; these check the id rules and markup.

describe("addDescribedBy / removeDescribedBy", () => {
  it("appends an id, or puts it first when asked", () => {
    expect(addDescribedBy(null, "hint")).toBe("hint");
    expect(addDescribedBy("a", "hint")).toBe("a hint");
    expect(addDescribedBy("a hint", "err", true)).toBe("err a hint");
  });

  it("keeps an id already present where it is, and tidies whitespace", () => {
    expect(addDescribedBy("  err   hint ", "hint")).toBe("err hint");
    expect(addDescribedBy("err hint", "err", true)).toBe("err hint");
  });

  it("removes only its own id, and nothing is left as null", () => {
    expect(removeDescribedBy("err a hint", "err")).toBe("a hint");
    expect(removeDescribedBy("hint", "hint")).toBeNull();
    expect(removeDescribedBy(null, "hint")).toBeNull();
  });

  it("gives an error and a hint, error first, whatever order they arrive in", () => {
    const hinted = addDescribedBy(null, fieldHintId("cost"));
    const withError = addDescribedBy(hinted, "err", true);
    expect(withError).toBe("err cost-hint");
    expect(removeDescribedBy(withError, "err")).toBe("cost-hint");
  });
});

describe("Field", () => {
  const control = createElement("input", { id: "cost", name: "cost" });
  const field = (props: { label: string; htmlFor: string; hint?: string }) =>
    createElement(Field, props as Parameters<typeof Field>[0], control);

  it("gives the hint an id derived from the control's id", () => {
    const html = renderToStaticMarkup(field({ label: "Cost", htmlFor: "cost", hint: "Per month" }));
    expect(fieldHintId("cost")).toBe("cost-hint");
    expect(html).toContain('<p id="cost-hint" class="text-xs text-muted">Per month</p>');
  });

  it("renders no hint id when there is no hint", () => {
    const html = renderToStaticMarkup(field({ label: "Cost", htmlFor: "cost" }));
    expect(html).not.toContain("cost-hint");
    expect(html).not.toContain("aria-describedby");
  });
});

describe("FormMessage", () => {
  it("starts an error's screen-reader text with Error:", () => {
    const html = renderToStaticMarkup(createElement(FormMessage, { error: "Cost can't be negative." }));
    expect(html).toMatch(/role="alert"[^>]*><span class="sr-only">Error: <\/span>Cost can&#x27;t be negative\.<\/p>/);
  });

  it("leaves a success message unprefixed", () => {
    const html = renderToStaticMarkup(createElement(FormMessage, { success: "Saved." }));
    expect(html).not.toContain("Error:");
  });
});
