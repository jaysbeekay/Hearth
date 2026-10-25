// #395 — Search's "Expiring soon" / overdue filters use the same Contract
// Due filter as the Contracts list (src/lib/listDue.ts), so a notice
// deadline counts, and Cancelled Contracts stay out.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { setupTestDb, createTestUser } from "../helpers/testDb";
import { contractDueFilter } from "@/lib/listDue";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "test-user" } })) }));

const db = setupTestDb();
const { GET } = await import("@/app/api/search/route");

let userId: string;
beforeEach(async () => {
  userId = (await createTestUser()).id;
});

function inDays(days: number) {
  return new Date(Date.now() + days * 86_400_000);
}

async function contract(title: string, data: Record<string, unknown>) {
  return db.prisma.contract.create({
    data: { title, category: "OTHER", provider: "Provider", createdById: userId, ...data },
  });
}

async function contractTitles(query: string): Promise<string[]> {
  const res = await GET(new NextRequest(`http://localhost/api/search?${query}`));
  const body = (await res.json()) as { groups: Record<string, { title: string }[]> };
  return (body.groups.Contracts ?? []).map((r) => r.title).sort();
}

describe("Search Due filters match the Contracts list", () => {
  beforeEach(async () => {
    // Notice deadline in 10 days, end date in 60: due soon.
    await contract("notice soon", { endDate: inDays(60), renewalType: "AUTO_RENEW", noticePeriodDays: 50 });
    await contract("ends soon", { endDate: inDays(10) });
    await contract("ends later", { endDate: inDays(60) });
    await contract("ends soon, cancelled", { endDate: inDays(10), status: "CANCELLED" });
    await contract("ended", { endDate: inDays(-5) });
    await contract("ended, cancelled", { endDate: inDays(-5), status: "CANCELLED" });
  });

  async function listTitles(due: "soon" | "overdue") {
    const f = contractDueFilter(due);
    const rows = await db.prisma.contract.findMany({ where: f.where });
    return rows.filter(f.matches).map((r) => r.title).sort();
  }

  it("?due=soon counts to the notice deadline", async () => {
    expect(await contractTitles("due=soon")).toEqual(["ends soon", "notice soon"]);
    expect(await contractTitles("due=soon")).toEqual(await listTitles("soon"));
  });

  it("the old filter=expiring gives the same result", async () => {
    expect(await contractTitles("filter=expiring")).toEqual(await listTitles("soon"));
  });

  it("?due=overdue leaves Cancelled Contracts out", async () => {
    expect(await contractTitles("due=overdue")).toEqual(["ended"]);
    expect(await contractTitles("due=overdue")).toEqual(await listTitles("overdue"));
  });
});
