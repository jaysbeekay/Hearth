// The Property-module server actions turn their command's errors into the
// ActionState the forms show (#390): which record wasn't found, a stale
// edit, and why a Contract can't be linked to a Tenancy.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, createTestUser, setModuleEnabled } from "../helpers/testDb";
import { auth } from "@/lib/auth";
import {
  updateProperty,
  deleteProperty,
  restoreHomeItem,
  updateHomeItem,
  deleteHomeItem,
  createRentalAgreement,
  deleteRentalAgreement,
  setRentalAgreementContract,
  setPropertyRented,
  updateRentalStatement,
  deleteRentalStatement,
} from "@/lib/actions/home";
import { createPropertyValuation, deletePropertyValuation } from "@/lib/actions/wealth";
import {
  createPropertyCommand,
  createMaintenanceRecordCommand,
  createTenancyCommand,
  createRentalStatementCommand,
  deletePropertyCommand,
} from "@/lib/commands/home";
import { propertySchema, homeItemSchema, rentalAgreementSchema, rentalStatementSchema } from "@/lib/validation/home";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
// The actions redirect() after a successful save; a no-op lets them return.
vi.mock("next/navigation", () => ({ redirect: vi.fn(), notFound: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const db = setupTestDb();

let actorId: string;
let propertyId: string;

beforeEach(async () => {
  vi.clearAllMocks();
  actorId = (await createTestUser()).id;
  vi.mocked(auth).mockResolvedValue({ user: { id: actorId, role: "MEMBER" } } as never);
  await setModuleEnabled("HOME", true);
  propertyId = (await createPropertyCommand(propertySchema.parse({ label: "Unit 4" }), actorId)).id;
});

function formData(values: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.append(key, value);
  return fd;
}

const rentalContract = (title: string, extra: { deletedAt?: Date; category?: "RENTAL" | "OTHER" } = {}) =>
  db.prisma.contract.create({
    data: { title, category: extra.category ?? "RENTAL", provider: "Agent", createdById: actorId, deletedAt: extra.deletedAt },
  });

const newTenancy = (weeklyRent = 500) =>
  createTenancyCommand(propertyId, rentalAgreementSchema.parse({ weeklyRent }), actorId);

describe("linking a Contract to a Tenancy", () => {
  it("links and unlinks", async () => {
    const tenancy = await newTenancy();
    const lease = await rentalContract("Head lease");
    expect(await setRentalAgreementContract(propertyId, tenancy.id, formData({ contractId: lease.id }))).toEqual({
      success: "Contract linked.",
    });
    expect(await setRentalAgreementContract(propertyId, tenancy.id, formData({ contractId: "" }))).toEqual({
      success: "Contract unlinked.",
    });
  });

  it("says the agreement wasn't found for a missing or out-of-scope Tenancy", async () => {
    const lease = await rentalContract("Head lease");
    expect(await setRentalAgreementContract(propertyId, "missing", formData({ contractId: lease.id }))).toEqual({
      error: "Agreement not found.",
    });
    const tenancy = await newTenancy();
    expect(await setRentalAgreementContract("other-property", tenancy.id, formData({ contractId: lease.id }))).toEqual({
      error: "Agreement not found.",
    });
  });

  it("says the Contract wasn't found when it's missing or in Trash", async () => {
    const tenancy = await newTenancy();
    const trashed = await rentalContract("Old lease", { deletedAt: new Date() });
    expect(await setRentalAgreementContract(propertyId, tenancy.id, formData({ contractId: "missing" }))).toEqual({
      error: "Contract not found.",
    });
    expect(await setRentalAgreementContract(propertyId, tenancy.id, formData({ contractId: trashed.id }))).toEqual({
      error: "Contract not found.",
    });
  });

  it("refuses a non-Rental Contract and one linked to another Tenancy", async () => {
    const first = await newTenancy();
    const second = await newTenancy(650);
    const lease = await rentalContract("Head lease");
    const phone = await rentalContract("Mobile", { category: "OTHER" });

    expect(await setRentalAgreementContract(propertyId, first.id, formData({ contractId: phone.id }))).toEqual({
      error: "Only Rental-category contracts can be linked.",
    });
    await setRentalAgreementContract(propertyId, first.id, formData({ contractId: lease.id }));
    expect(await setRentalAgreementContract(propertyId, second.id, formData({ contractId: lease.id }))).toEqual({
      error: "That contract is already linked to another tenancy.",
    });
  });
});

describe("not-found errors", () => {
  it("maps each record's not-found to its form's message", async () => {
    expect(await updateProperty("missing", null, formData({ label: "x" }))).toEqual({ error: "Property not found." });
    expect(await deleteProperty("missing")).toEqual({ error: "Property not found." });
    expect(await setPropertyRented("missing", true)).toEqual({ error: "Property not found." });
    expect(await updateHomeItem(propertyId, "missing", null, formData({ type: "REPAIR", title: "x" }))).toEqual({
      error: "Item not found.",
    });
    expect(await deleteHomeItem(propertyId, "missing")).toEqual({ error: "Item not found." });
    expect(await restoreHomeItem("missing")).toEqual({ error: "Item not found." });
    expect(await createRentalAgreement("missing", null, formData({ weeklyRent: "500" }))).toEqual({
      error: "Property not found.",
    });
    expect(await deleteRentalAgreement(propertyId, "missing")).toEqual({ error: "Agreement not found." });
    expect(await updateRentalStatement(propertyId, "missing", null, formData({ grossRent: "1" }))).toEqual({
      error: "Statement not found.",
    });
    expect(await deleteRentalStatement(propertyId, "missing")).toEqual({ error: "Statement not found." });
    expect(
      await createPropertyValuation("missing", null, formData({ valuedAt: "2026-01-01", value: "1" })),
    ).toEqual({ error: "Property not found." });
    expect(await deletePropertyValuation(propertyId, "missing")).toEqual({ error: "Valuation not found." });
  });

  it("scopes a Rental statement to the Property in the URL", async () => {
    const statement = await createRentalStatementCommand(propertyId, rentalStatementSchema.parse({ grossRent: 100 }));
    expect(await deleteRentalStatement("other-property", statement.id)).toEqual({ error: "Statement not found." });
    expect(await db.prisma.rentalStatement.count()).toBe(1);
  });

  it("treats an edit under a Property in Trash as not found", async () => {
    const item = await createMaintenanceRecordCommand(propertyId, homeItemSchema.parse({ type: "REPAIR", title: "Tap" }));
    await deletePropertyCommand(propertyId);
    expect(await updateHomeItem(propertyId, item.id, null, formData({ type: "REPAIR", title: "Tap washer" }))).toEqual({
      error: "Item not found.",
    });
    expect(await updateProperty(propertyId, null, formData({ label: "Renamed" }))).toEqual({
      error: "Property not found.",
    });
  });
});
