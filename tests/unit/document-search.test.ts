import { describe, expect, it } from "vitest";
import { escapeFtsMatchQuery, hitDocIds, hitOwnerIds, sortByHitRank } from "@/lib/documents/documentSearch";
import type { DocumentSearchHit } from "@/lib/documents/documentSearch";

describe("escapeFtsMatchQuery (#314)", () => {
  it("wraps an ordinary query in a phrase literal", () => {
    expect(escapeFtsMatchQuery("invoice")).toBe('"invoice"');
  });

  it("doubles embedded double-quotes rather than letting them close the phrase early", () => {
    expect(escapeFtsMatchQuery('say "hello"')).toBe('"say ""hello"""');
  });

  it("neutralizes FTS5 syntax characters instead of throwing", () => {
    // A bare "-", "*", ":" or a bareword boolean operator is FTS5 query
    // syntax, not literal text, when unescaped — wrapping in a phrase
    // literal makes all of it inert.
    expect(escapeFtsMatchQuery("2024-invoice")).toBe('"2024-invoice"');
    expect(escapeFtsMatchQuery("AND OR NOT")).toBe('"AND OR NOT"');
    expect(escapeFtsMatchQuery("*wildcard*")).toBe('"*wildcard*"');
  });

  it("handles empty and whitespace-only input without throwing", () => {
    expect(escapeFtsMatchQuery("")).toBe('""');
    expect(escapeFtsMatchQuery("   ")).toBe('"   "');
  });
});

describe("hitOwnerIds / hitDocIds (#314)", () => {
  const hits: DocumentSearchHit[] = [
    { kind: "CONTRACT", docId: "d1", ownerId: "c1", filename: "a.pdf" },
    { kind: "CONTRACT", docId: "d2", ownerId: "c1", filename: "b.pdf" },
    { kind: "CONTRACT", docId: "d3", ownerId: "c2", filename: "c.pdf" },
    { kind: "PRODUCT", docId: "d4", ownerId: "p1", filename: "d.pdf" },
    { kind: "INBOX", docId: "d5", ownerId: null, filename: "e.pdf" },
  ];

  it("returns distinct owner ids for a kind, ignoring other kinds and null owners", () => {
    expect(hitOwnerIds(hits, "CONTRACT")).toEqual(["c1", "c2"]);
    expect(hitOwnerIds(hits, "PRODUCT")).toEqual(["p1"]);
    expect(hitOwnerIds(hits, "INBOX")).toEqual([]);
  });

  it("returns every doc id for a kind, in original (rank) order", () => {
    expect(hitDocIds(hits, "CONTRACT")).toEqual(["d1", "d2", "d3"]);
    expect(hitDocIds(hits, "VEHICLE_ITEM")).toEqual([]);
  });
});

describe("sortByHitRank (#314)", () => {
  const hits: DocumentSearchHit[] = [
    { kind: "CONTRACT", docId: "d3", ownerId: "c1", filename: "third.pdf" },
    { kind: "CONTRACT", docId: "d1", ownerId: "c1", filename: "first.pdf" },
    { kind: "CONTRACT", docId: "d2", ownerId: "c1", filename: "second.pdf" },
  ];

  it("re-sorts resolved rows back into FTS rank order, not their DB order", () => {
    const rows = [{ id: "d1" }, { id: "d2" }, { id: "d3" }];
    expect(sortByHitRank(rows, hits).map((r) => r.id)).toEqual(["d3", "d1", "d2"]);
  });

  it("preserves the relative rank order of survivors when some hits were dropped by owner-liveness resolution", () => {
    // d2 was dropped (e.g. its owner was soft-deleted) — d3 and d1 must
    // still come back in their original rank order, not DB order.
    const rows = [{ id: "d1" }, { id: "d3" }];
    expect(sortByHitRank(rows, hits).map((r) => r.id)).toEqual(["d3", "d1"]);
  });

  it("places a row with no matching hit last, without throwing", () => {
    const rows = [{ id: "unknown" }, { id: "d1" }];
    expect(sortByHitRank(rows, hits).map((r) => r.id)).toEqual(["d1", "unknown"]);
  });
});
