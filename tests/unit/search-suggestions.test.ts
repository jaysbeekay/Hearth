import { describe, expect, it } from "vitest";
import { formatRecentParam, parseRecentParam, pushRecent, RECENT_LIMIT } from "@/lib/recentRecords";
import { attentionSuggestions, orderRecent } from "@/lib/searchSuggestions";
import type { AttentionItem } from "@/lib/needsAttention";
import type { SearchResult } from "@/app/api/search/route";

// #366 — what Search shows before anything is typed.
describe("recent records", () => {
  it("puts the latest first, without a duplicate, and keeps five", () => {
    let list = parseRecentParam("");
    for (const id of ["a", "b", "c", "d", "e", "f"]) list = pushRecent(list, { kind: "contract", id });
    expect(list.map((r) => r.id)).toEqual(["f", "e", "d", "c", "b"]);
    list = pushRecent(list, { kind: "contract", id: "c" });
    expect(list.map((r) => r.id)).toEqual(["c", "f", "e", "d", "b"]);
    expect(list).toHaveLength(RECENT_LIMIT);
  });

  it("keeps the same id under a different kind apart", () => {
    const list = pushRecent([{ kind: "contract", id: "x" }], { kind: "warranty", id: "x" });
    expect(list).toHaveLength(2);
  });

  it("round-trips the recent= parameter and ignores anything malformed", () => {
    const list = [
      { kind: "contract" as const, id: "c1" },
      { kind: "vehicle" as const, id: "v1" },
    ];
    expect(parseRecentParam(formatRecentParam(list))).toEqual(list);
    expect(parseRecentParam("user:u1,contract:../etc,contract,trip:t1,trip:t1")).toEqual([{ kind: "trip", id: "t1" }]);
    expect(parseRecentParam("contract:1,contract:2,contract:3,contract:4,contract:5,contract:6")).toHaveLength(RECENT_LIMIT);
  });
});

describe("search suggestions", () => {
  it("orders found records as viewed and drops ones not found", () => {
    const found: SearchResult[] = [
      { id: "w1", title: "Fridge", href: "/products/w1", group: "warranty" },
      { id: "c1", title: "Car insurance", href: "/contracts/c1", group: "contract" },
    ];
    const ordered = orderRecent(
      [
        { kind: "contract", id: "c1" },
        { kind: "contract", id: "gone" },
        { kind: "warranty", id: "w1" },
      ],
      found,
    );
    expect(ordered.map((r) => r.title)).toEqual(["Car insurance", "Fridge"]);
  });

  it("takes the first three Due rows and says when each is due", () => {
    const entry = {
      field: "endDate",
      date: "2026-10-30",
      daysLeft: -3,
      state: "overdue",
      label: "Expired 3 days ago",
      labelParts: { key: "expiredAgo", days: 3 },
    } as unknown as AttentionItem["entry"];
    const items: AttentionItem[] = ["a", "b", "c", "d"].map((id) => ({
      id,
      kind: "contract",
      group: "due",
      title: `Contract ${id}`,
      subtitle: id === "a" ? "Acme" : undefined,
      entry,
      href: `/contracts/${id}`,
    }));
    const suggestions = attentionSuggestions(items, { dateFormat: "DD/MM/YYYY" });
    expect(suggestions.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(suggestions[0].subtitle).toMatch(/^Expired 3 days ago · Acme$/);
    expect(suggestions[1].subtitle).toBe("Expired 3 days ago");
  });
});
