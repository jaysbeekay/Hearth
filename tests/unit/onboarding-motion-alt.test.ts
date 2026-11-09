import { afterEach, describe, expect, it, vi } from "vitest";
import { onboardingComplete, onboardingSteps } from "@/lib/onboarding";
import { prefersReducedMotion, scrollBehavior } from "@/lib/reducedMotion";
import { documentPreviewAlt } from "@/lib/documents/documentList";

// #617 — onboarding's ending, reduced motion, and the preview image's alt text.

describe("onboarding checklist", () => {
  const base = { enabledModuleCount: 0, memberCount: 1, remindersConfigured: false, modulesReviewed: false };

  it("is not complete while any step is left", () => {
    expect(onboardingComplete(onboardingSteps(base))).toBe(false);
    expect(onboardingComplete(onboardingSteps({ ...base, memberCount: 2, remindersConfigured: true }))).toBe(false);
  });

  it("is complete once every step is done", () => {
    const steps = onboardingSteps({ ...base, memberCount: 2, remindersConfigured: true, enabledModuleCount: 1 });
    expect(steps.every((s) => s.done)).toBe(true);
    expect(onboardingComplete(steps)).toBe(true);
  });

  it("counts reviewing modules without enabling any as done (#345)", () => {
    const steps = onboardingSteps({ ...base, memberCount: 2, remindersConfigured: true, modulesReviewed: true });
    expect(onboardingComplete(steps)).toBe(true);
  });
});

describe("reduced motion", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubMatchMedia(reduce: boolean) {
    vi.stubGlobal("window", {
      matchMedia: (query: string) => ({ matches: reduce && query === "(prefers-reduced-motion: reduce)" }),
    });
  }

  it("scrolls instantly when the viewer asks for reduced motion", () => {
    stubMatchMedia(true);
    expect(prefersReducedMotion()).toBe(true);
    expect(scrollBehavior()).toBe("auto");
  });

  it("scrolls smoothly otherwise", () => {
    stubMatchMedia(false);
    expect(prefersReducedMotion()).toBe(false);
    expect(scrollBehavior()).toBe("smooth");
  });

  it("assumes full motion where there is no window", () => {
    expect(prefersReducedMotion()).toBe(false);
  });
});

describe("document preview alt text", () => {
  it("names the Document's type and its record, not the filename", () => {
    expect(documentPreviewAlt({ typeLabel: "Invoice", ownerName: "Family hatch" })).toBe(
      "Preview of invoice for Family hatch",
    );
  });

  it("falls back to 'document' with no type or Other, and drops a missing record", () => {
    expect(documentPreviewAlt({ typeLabel: null, ownerName: "Home insurance" })).toBe("Preview of document for Home insurance");
    expect(documentPreviewAlt({ typeLabel: "Photo" })).toBe("Preview of photo");
    expect(documentPreviewAlt({ typeLabel: "Other", ownerName: "Laptop" })).toBe("Preview of document for Laptop");
    expect(documentPreviewAlt({ ownerName: "  " })).toBe("Preview of document");
  });
});
