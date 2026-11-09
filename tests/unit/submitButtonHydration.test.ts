import { createElement, type ComponentProps } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The calendar feed's token is shown once, in client state; a native
// (pre-hydration) submit would mint a new token and reload the page without
// ever showing it (#609). Server-rendered HTML is what the browser shows
// before hydration, so it must carry `disabled` for that button.
vi.mock("@/lib/actions/ical", () => ({
  generateIcalToken: vi.fn(),
  revokeIcalToken: vi.fn(),
}));

const { SubmitButton } = await import("@/components/SubmitButton");
const { IcalTokenSection } = await import("@/components/IcalTokenSection");

// children go in createElement's third argument (react/no-children-prop),
// which its typing doesn't count towards the required `children` prop.
type SubmitButtonProps = ComponentProps<typeof SubmitButton>;

// The opening <button ...> tag of the button labelled `label`, found by plain
// text search so the label is never read as a pattern.
function buttonTag(html: string, label: string): string {
  const end = html.indexOf(`>${label}</button>`);
  expect(end, `a "${label}" button is rendered`).toBeGreaterThan(-1);
  const start = html.lastIndexOf("<button", end);
  expect(start, `a "${label}" button is rendered`).toBeGreaterThan(-1);
  return html.slice(start, end + 1);
}

describe("SubmitButton before hydration", () => {
  it("is disabled in server-rendered HTML when disabledUntilHydrated is set", () => {
    const html = renderToString(
      createElement("form", null, createElement(SubmitButton, { disabledUntilHydrated: true } as SubmitButtonProps, "Go")),
    );
    expect(buttonTag(html, "Go")).toMatch(/\sdisabled=""(\s|>)/);
  });

  it("stays enabled by default, so other forms are unchanged", () => {
    const html = renderToString(createElement("form", null, createElement(SubmitButton, {} as SubmitButtonProps, "Go")));
    expect(buttonTag(html, "Go")).not.toMatch(/\sdisabled(=|\s|>)/);
  });
});

describe("IcalTokenSection before hydration", () => {
  it("server-renders the Create calendar feed button disabled", () => {
    const html = renderToString(createElement(IcalTokenSection, { hasToken: false, appUrl: "https://hearth.test" }));
    expect(buttonTag(html, "Create calendar feed")).toMatch(/\sdisabled=""(\s|>)/);
    // Without JavaScript the button never enables, so say why.
    expect(html).toContain("Calendar feeds need JavaScript turned on.");
  });

  it("server-renders the Generate new URL button disabled", () => {
    const html = renderToString(createElement(IcalTokenSection, { hasToken: true, appUrl: "https://hearth.test" }));
    expect(buttonTag(html, "Generate new URL")).toMatch(/\sdisabled=""(\s|>)/);
  });
});
