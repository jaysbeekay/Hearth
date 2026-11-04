import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, createTestUser } from "../helpers/testDb";
import { createContractCommand } from "@/lib/commands/contracts";
import * as contractCommands from "@/lib/commands/contracts";
import { contractSchema } from "@/lib/validation/contract";
import { confirmAllExtractions } from "@/lib/actions/review";
import { auth } from "@/lib/auth";

// #358 — "Confirm all" on the Quick check screen against a real database:
// each record is confirmed on its own, a failure doesn't stop the rest, and
// a record changed since the page loaded is refused, not overwritten.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const db = setupTestDb();
let actorId: string;

beforeEach(async () => {
  const user = await createTestUser();
  actorId = user.id;
  vi.mocked(auth).mockResolvedValue({ user: { ...user, role: "MEMBER" }, expires: "" } as never);
});

async function pendingContract(title: string, startDate: string) {
  const contract = await createContractCommand(
    contractSchema.parse({
      title,
      category: "OTHER",
      provider: "Provider",
      renewalType: "MANUAL_RENEWAL",
      startDate,
      endDate: "2027-06-01",
    }),
    actorId,
    { extractionPending: true },
  );
  await db.prisma.extractionReviewField.create({
    data: { ownerType: "CONTRACT", ownerId: contract.id, contractId: contract.id, fieldName: "endDate", value: "2027-06-01", source: "ocr" },
  });
  return contract;
}

function form(rows: { id: string; title: string; endDate: string; version: string }[]) {
  const fd = new FormData();
  for (const row of rows) {
    fd.append("record", `CONTRACT:${row.id}`);
    fd.set(`CONTRACT:${row.id}:label`, row.title);
    fd.set(`CONTRACT:${row.id}:version`, row.version);
    fd.set(`CONTRACT:${row.id}:reviewField:endDate`, row.endDate);
  }
  return fd;
}

const pending = async (id: string) => (await db.prisma.contract.findUniqueOrThrow({ where: { id } })).extractionPending;

describe("Confirm all", () => {
  it("confirms the valid records and keeps the invalid one waiting, saying which", async () => {
    const a = await pendingContract("Gym", "2026-01-01");
    const b = await pendingContract("Phone", "2026-01-01");
    const c = await pendingContract("Power", "2026-01-01");

    const result = await confirmAllExtractions(
      null,
      form([
        { id: a.id, title: "Gym", endDate: "2027-07-01", version: a.updatedAt.toISOString() },
        // Ends before it starts.
        { id: b.id, title: "Phone", endDate: "2025-01-01", version: b.updatedAt.toISOString() },
        { id: c.id, title: "Power", endDate: "2027-08-01", version: c.updatedAt.toISOString() },
      ]),
    );

    expect(result?.error).toMatch(/^2 confirmed\. Fix this one and confirm again: Phone: /);
    expect(await pending(a.id)).toBe(false);
    expect(await pending(b.id)).toBe(true);
    expect(await pending(c.id)).toBe(false);

    // Confirming again only touches what's still waiting.
    const fresh = await db.prisma.contract.findUniqueOrThrow({ where: { id: b.id } });
    const retry = await confirmAllExtractions(
      null,
      form([{ id: b.id, title: "Phone", endDate: "2027-09-01", version: fresh.updatedAt.toISOString() }]),
    );
    expect(retry).toEqual({ success: "1 record confirmed." });
    expect(await pending(b.id)).toBe(false);
  });

  it("refuses a record someone edited after the page loaded, keeping their edit", async () => {
    const a = await pendingContract("Gym", "2026-01-01");
    const loaded = a.updatedAt.toISOString();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await db.prisma.contract.update({ where: { id: a.id }, data: { endDate: new Date("2027-12-31T00:00:00.000Z") } });

    const result = await confirmAllExtractions(null, form([{ id: a.id, title: "Gym", endDate: "2027-07-01", version: loaded }]));

    expect(result?.error).toMatch(/Gym: someone changed it since this page loaded/);
    const row = await db.prisma.contract.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.endDate).toEqual(new Date("2027-12-31T00:00:00.000Z"));
    expect(row.extractionPending).toBe(true);
  });

  it("carries on past an unexpected failure and reports it", async () => {
    const a = await pendingContract("Gym", "2026-01-01");
    const b = await pendingContract("Phone", "2026-01-01");
    const confirm = vi.spyOn(contractCommands, "confirmContractExtractionCommand");
    confirm.mockRejectedValueOnce(new Error("database is locked"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await confirmAllExtractions(
      null,
      form([
        { id: a.id, title: "Gym", endDate: "2027-07-01", version: a.updatedAt.toISOString() },
        { id: b.id, title: "Phone", endDate: "2027-07-01", version: b.updatedAt.toISOString() },
      ]),
    );

    expect(result?.error).toBe("1 confirmed. Fix this one and confirm again: Gym: couldn't be confirmed, please try again");
    expect(await pending(a.id)).toBe(true);
    expect(await pending(b.id)).toBe(false);
    confirm.mockRestore();
  });
});
