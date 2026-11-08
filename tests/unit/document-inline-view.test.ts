import { describe, expect, it } from "vitest";
import {
  contentDisposition,
  INLINE_VIEW_CSP,
  inlineViewHref,
  isInlineViewRequest,
} from "@/lib/documents/inlineView";

const params = (q: string) => new URLSearchParams(q);

describe("inlineViewHref", () => {
  it("adds inline=1 to a file URL", () => {
    expect(inlineViewHref("/api/documents/abc")).toBe("/api/documents/abc?inline=1");
    expect(inlineViewHref("/api/documents/abc?v=2")).toBe("/api/documents/abc?v=2&inline=1");
  });
});

describe("isInlineViewRequest", () => {
  it("matches the two file routes with inline=1 only", () => {
    expect(isInlineViewRequest("/api/documents/abc", params("inline=1"))).toBe(true);
    expect(isInlineViewRequest("/api/documents/inbox/abc", params("inline=1"))).toBe(true);
    expect(isInlineViewRequest("/api/documents/abc", params(""))).toBe(false);
    expect(isInlineViewRequest("/api/documents/abc", params("inline=true"))).toBe(false);
    expect(isInlineViewRequest("/api/documents/abc/extraction-status", params("inline=1"))).toBe(false);
    expect(isInlineViewRequest("/contracts/abc", params("inline=1"))).toBe(false);
  });
});

describe("contentDisposition", () => {
  it("serves a PDF inline only when asked", () => {
    expect(contentDisposition("application/pdf", "a.pdf", true)).toBe('inline; filename="a.pdf"');
    expect(contentDisposition("application/pdf", "a.pdf", false)).toBe('attachment; filename="a.pdf"');
  });

  it("never serves another type inline", () => {
    expect(contentDisposition("text/html", "x.html", true)).toBe('attachment; filename="x.html"');
    expect(contentDisposition("image/svg+xml", "x.svg", true)).toBe('attachment; filename="x.svg"');
  });

  it("strips quotes and line breaks from the filename", () => {
    expect(contentDisposition("application/pdf", 'a"b\r\nc.pdf', true)).toBe('inline; filename="a_b__c.pdf"');
  });
});

describe("INLINE_VIEW_CSP", () => {
  it("allows only same-origin framing and the file itself as the plugin", () => {
    expect(INLINE_VIEW_CSP).toContain("default-src 'none'");
    expect(INLINE_VIEW_CSP).toContain("object-src 'self'");
    expect(INLINE_VIEW_CSP).toContain("frame-ancestors 'self'");
    expect(INLINE_VIEW_CSP).not.toContain("script-src");
  });
});
