import { describe, expect, it } from "vitest";
import { setupTestDb, createTestUser } from "../helpers/testDb";
import { propertyLinkTargets, vehicleLinkTargets } from "@/lib/linkTargets";

// #489: the Contract and Warranty edit forms offer only live Properties and
// Vehicles, plus the record's current link if that one is in Trash.

const db = setupTestDb();

async function seed() {
  const createdById = (await createTestUser()).id;
  const trashed = new Date();
  const [liveHome, trashedHome, archivedHome] = await Promise.all([
    db.prisma.property.create({ data: { label: "Beach house", createdById } }),
    db.prisma.property.create({ data: { label: "Old flat", createdById, deletedAt: trashed } }),
    db.prisma.property.create({ data: { label: "Sold unit", createdById, archivedAt: trashed } }),
  ]);
  const [liveCar, trashedCar] = await Promise.all([
    db.prisma.vehicle.create({ data: { label: "Hatchback", createdById } }),
    db.prisma.vehicle.create({ data: { label: "Ute", createdById, deletedAt: trashed } }),
  ]);
  return { liveHome, trashedHome, archivedHome, liveCar, trashedCar };
}

describe("link targets on the edit forms", () => {
  it("are the live records when the current link is live", async () => {
    const { liveHome, archivedHome } = await seed();
    expect(await propertyLinkTargets(liveHome.id)).toEqual([
      { id: liveHome.id, label: "Beach house" },
      { id: archivedHome.id, label: "Sold unit" },
    ]);
  });

  it("leave out records in Trash but keep Archived ones", async () => {
    const { liveHome, archivedHome, liveCar } = await seed();
    expect(await propertyLinkTargets(null)).toEqual([
      { id: liveHome.id, label: "Beach house" },
      { id: archivedHome.id, label: "Sold unit" },
    ]);
    expect(await vehicleLinkTargets(undefined)).toEqual([{ id: liveCar.id, label: "Hatchback" }]);
  });

  it("keep the current link when it is in Trash, marked as such, but no other record in Trash", async () => {
    const { liveHome, trashedHome, archivedHome, trashedCar, liveCar } = await seed();
    const createdById = (await db.prisma.user.findFirstOrThrow()).id;
    await db.prisma.property.create({ data: { label: "Another old flat", createdById, deletedAt: new Date() } });
    expect(await propertyLinkTargets(trashedHome.id)).toEqual([
      { id: liveHome.id, label: "Beach house" },
      { id: trashedHome.id, label: "Old flat (in Trash)" },
      { id: archivedHome.id, label: "Sold unit" },
    ]);
    expect(await vehicleLinkTargets(trashedCar.id)).toEqual([
      { id: liveCar.id, label: "Hatchback" },
      { id: trashedCar.id, label: "Ute (in Trash)" },
    ]);
  });
});
