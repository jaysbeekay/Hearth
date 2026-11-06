import { describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { setupTestDb } from "../helpers/testDb";
import { seedDemo, DemoSeedRefusedError, DEMO_MEMBER_EMAIL, DEMO_ADMIN_EMAIL } from "../../scripts/demo/seed";
import { whatsDue } from "@/lib/domainQueries";
import { MODULE_KEYS } from "@/lib/modules/registry";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
// The seed's trades would otherwise look up historical prices online.
vi.mock("@/lib/prices", () => ({ fetchHistoricalPrice: vi.fn(async () => null) }));

const db = setupTestDb();
const passwords = { memberPassword: "member-pass-1", adminPassword: "admin-pass-1" };

describe("demo seed (#553)", () => {
  it("fills every module of an empty database", async () => {
    await seedDemo(passwords);
    const p = db.prisma;

    const member = await p.user.findUniqueOrThrow({ where: { email: DEMO_MEMBER_EMAIL } });
    const admin = await p.user.findUniqueOrThrow({ where: { email: DEMO_ADMIN_EMAIL } });
    expect(member.role).toBe("MEMBER");
    expect(admin.role).toBe("ADMIN");
    expect(await bcrypt.compare(passwords.memberPassword, member.passwordHash)).toBe(true);

    const enabled = await p.moduleEnablement.findMany({ where: { enabled: true } });
    expect(enabled.map((m) => m.key).sort()).toEqual([...MODULE_KEYS].sort());

    expect(await p.contract.count()).toBe(11);
    expect(await p.contractTerm.count()).toBe(1);
    expect(await p.product.count()).toBe(8);
    expect(await p.document.count()).toBe(1);
    expect(await p.productDocument.count()).toBe(1);
    expect(await p.trip.count()).toBe(3);
    expect(await p.tripSegment.count()).toBe(11);
    expect(await p.property.count()).toBe(2);
    expect(await p.homeItem.count()).toBe(4);
    expect(await p.rentalAgreement.count()).toBe(1);
    expect(await p.rentalStatement.count()).toBe(3);
    expect(await p.propertyValuation.count()).toBe(5);
    expect(await p.vehicle.count()).toBe(2);
    expect(await p.vehicleItem.count()).toBe(4);
    expect(await p.inventoryItem.count()).toBe(11);
    expect(await p.portfolio.count()).toBe(2);
    expect(await p.holding.count()).toBe(4);
    expect(await p.trade.count()).toBe(8);
  });

  it("gives the Due list overdue and due-soon entries on any day", async () => {
    await seedDemo(passwords);
    const states = new Set((await whatsDue(new Set(MODULE_KEYS), 30)).map((item) => item.state));
    expect(states).toContain("overdue");
    expect(states).toContain("due-soon");
  });

  it("makes the seeded documents searchable", async () => {
    await seedDemo(passwords);
    const rows = await db.prisma.$queryRawUnsafe<{ n: number }[]>(
      "SELECT count(*) AS n FROM document_search_fts WHERE document_search_fts MATCH 'Banksia'",
    );
    expect(Number(rows[0].n)).toBe(1);
  });

  it("refuses a database that already has users, without writing anything", async () => {
    await seedDemo(passwords);
    const p = db.prisma;
    const counts = () => Promise.all([p.user.count(), p.contract.count(), p.document.count(), p.trade.count()]);
    const before = await counts();
    await expect(seedDemo(passwords)).rejects.toBeInstanceOf(DemoSeedRefusedError);
    expect(await counts()).toEqual(before);
  });
});
