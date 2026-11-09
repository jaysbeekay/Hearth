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
  const kindOf = (value: string) => value.split(";")[0];

  it("serves a PDF inline only when asked", () => {
    expect(contentDisposition("application/pdf", "a.pdf", true)).toBe(
      "inline; filename=\"a.pdf\"; filename*=UTF-8''a.pdf",
    );
    expect(kindOf(contentDisposition("application/pdf", "a.pdf", false))).toBe("attachment");
  });

  it("never serves another type inline", () => {
    expect(kindOf(contentDisposition("text/html", "x.html", true))).toBe("attachment");
    expect(kindOf(contentDisposition("image/svg+xml", "x.svg", true))).toBe("attachment");
  });

  it("can't be broken out of by quotes or line breaks in the filename", () => {
    expect(contentDisposition("application/pdf", 'a"b\r\nc.pdf', true)).toBe(
      "inline; filename=\"a_b__c.pdf\"; filename*=UTF-8''a%22b__c.pdf",
    );
  });

  // A header value can't hold a character above U+00FF: the route used to 500.
  it("sends a non-Latin-1 name as UTF-8, with an ASCII fallback", () => {
    const value = contentDisposition("application/pdf", "John’s – 日本 (1).pdf", false);
    expect(value).toMatch(/^[\x20-\x7e]*$/);
    expect(() => new Headers({ "content-disposition": value })).not.toThrow();
    expect(value).toContain('filename="John_s _ __ (1).pdf"');
    expect(value).toContain("filename*=UTF-8''John%E2%80%99s%20%E2%80%93%20%E6%97%A5%E6%9C%AC%20%281%29.pdf");
  });

  it("falls back to the ASCII name for a name UTF-8 can't encode", () => {
    expect(contentDisposition("application/pdf", "bad\uD800.pdf", false)).toBe('attachment; filename="bad_.pdf"');
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
