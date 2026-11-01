// Extraction review, Confirm details and Contract status go through the
// Contract and Product commands (#393, ADR 0003).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, createTestUser, setModuleEnabled } from "../helpers/testDb";
import {
  createContractCommand,
  updateContractCommand,
  confirmContractExtractionCommand,
  deleteContractCommand,
  restoreContractCommand,
} from "@/lib/commands/contracts";
import {
  createProductCommand,
  updateProductCommand,
  confirmProductExtractionCommand,
  deleteProductCommand,
} from "@/lib/commands/products";
import { RecordNotFoundError, StaleEditError } from "@/lib/commands/shared";
import {
  setContractStatus,
  confirmContractExtraction,
  reviewContractExtraction,
  updateContractFromAssistant,
  createContractFromAssistant,
} from "@/lib/actions/contracts";
import {
  confirmProductExtraction,
  reviewProductExtraction,
  createProductFromAssistant,
  updateProductFromAssistant,
} from "@/lib/actions/products";
import { contractSchema } from "@/lib/validation/contract";
import { productSchema } from "@/lib/validation/product";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
}));

const db = setupTestDb();

let actorId: string;

beforeEach(async () => {
  vi.clearAllMocks();
  actorId = (await createTestUser()).id;
  signInAs("MEMBER");
});

function signInAs(role: "ADMIN" | "MEMBER" | "READONLY") {
  vi.mocked(auth).mockResolvedValue({ user: { id: actorId, role } } as never);
}

function formData(values: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.append(key, value);
  return fd;
}

const newContract = (extra: Record<string, unknown> = {}) =>
  createContractCommand(
    contractSchema.parse({
      title: "Gym",
      category: "SUBSCRIPTION",
      provider: "FitCo",
      renewalType: "MANUAL_RENEWAL",
      endDate: "2027-06-01",
      isTaxDeductible: true,
      ...extra,
    }),
    actorId,
    { extractionPending: true },
  );

const newProduct = () =>
  createProductCommand(productSchema.parse({ description: "TV", warrantyEndDate: "2027-01-01" }), actorId, {
    extractionPending: true,
  });

async function addPendingFields(ownerType: "CONTRACT" | "PRODUCT", ownerId: string, fieldNames: string[]) {
  for (const fieldName of fieldNames) {
    await db.prisma.extractionReviewField.create({
      data: {
        ownerType,
        ownerId,
        contractId: ownerType === "CONTRACT" ? ownerId : null,
        productId: ownerType === "PRODUCT" ? ownerId : null,
        fieldName,
        value: "x",
        source: "ocr",
      },
    });
  }
}

const reviewFields = (ownerId: string) =>
  db.prisma.extractionReviewField.findMany({ where: { ownerId }, orderBy: { fieldName: "asc" } });

describe("extraction review", () => {
  it("applies the corrections, clears Needs review and marks the fields reviewed", async () => {
    const contract = await newContract();
    await addPendingFields("CONTRACT", contract.id, ["endDate", "title"]);

    expect(
      await reviewContractExtraction(
        contract.id,
        null,
        formData({
          "reviewField:endDate": "2027-08-15",
          "reviewField:title": "Gym membership",
          // Not a pending field, so it isn't written.
          "reviewField:provider": "Someone else",
        }),
      ),
    ).toEqual({ success: "Details confirmed." });

    const saved = await db.prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(saved.endDate?.toISOString().slice(0, 10)).toBe("2027-08-15");
    expect(saved.title).toBe("Gym membership");
    expect(saved.provider).toBe("FitCo");
    expect(saved.extractionPending).toBe(false);
    expect(saved.extractionConfirmedAt).not.toBeNull();
    expect(saved.updatedById).toBe(actorId);
    const fields = await reviewFields(contract.id);
    expect(fields.every((f) => f.reviewedAt !== null && f.reviewedById === actorId)).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith(`/contracts/${contract.id}`);
  });

  it("is atomic: if marking the fields reviewed fails, the Contract isn't changed", async () => {
    const contract = await newContract();
    await addPendingFields("CONTRACT", contract.id, ["endDate"]);
    const realTransaction = prisma.$transaction.bind(prisma) as (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
    vi.spyOn(prisma, "$transaction").mockImplementationOnce(((fn: (tx: unknown) => Promise<unknown>) =>
      realTransaction((tx) =>
        fn(
          new Proxy(tx as object, {
            get(target, key) {
              if (key === "extractionReviewField") {
                return { updateMany: () => Promise.reject(new Error("boom")) };
              }
              return Reflect.get(target, key);
            },
          }),
        ),
      )) as never);

    await expect(
      confirmContractExtractionCommand(contract.id, { endDate: new Date("2027-08-15") }, actorId),
    ).rejects.toThrow("boom");

    const saved = await db.prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(saved.endDate?.toISOString().slice(0, 10)).toBe("2027-06-01");
    expect(saved.extractionPending).toBe(true);
    expect((await reviewFields(contract.id))[0].reviewedAt).toBeNull();
  });

  it("clears a blank optional field but refuses a blank title or a bad date", async () => {
    const contract = await newContract({ cost: 50 });
    await addPendingFields("CONTRACT", contract.id, ["cost", "title", "startDate"]);

    expect(await reviewContractExtraction(contract.id, null, formData({ "reviewField:title": " " }))).toEqual({
      error: "Title is required",
    });
    expect(
      await reviewContractExtraction(contract.id, null, formData({ "reviewField:startDate": "not a date" })),
    ).toEqual({ error: "Start date isn't a valid date" });
    // Nothing was confirmed by the refused submissions.
    expect((await db.prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).extractionPending).toBe(true);

    await reviewContractExtraction(contract.id, null, formData({ "reviewField:cost": "" }));
    const saved = await db.prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(saved.cost).toBeNull();
    expect(saved.extractionPending).toBe(false);
  });

  it("Confirm details clears Needs review without changing the values", async () => {
    const contract = await newContract();
    await addPendingFields("CONTRACT", contract.id, ["endDate"]);
    expect(await confirmContractExtraction(contract.id)).toEqual({ success: "Details confirmed." });
    const saved = await db.prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(saved.extractionPending).toBe(false);
    expect(saved.endDate?.toISOString().slice(0, 10)).toBe("2027-06-01");
    expect((await reviewFields(contract.id))[0].reviewedAt).not.toBeNull();
  });

  it("works the same for a Product", async () => {
    const product = await newProduct();
    await addPendingFields("PRODUCT", product.id, ["warrantyEndDate"]);
    expect(
      await reviewProductExtraction(product.id, null, formData({ "reviewField:warrantyEndDate": "2028-03-01" })),
    ).toEqual({ success: "Details confirmed." });
    const saved = await db.prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(saved.warrantyEndDate?.toISOString().slice(0, 10)).toBe("2028-03-01");
    expect(saved.extractionPending).toBe(false);
    expect((await reviewFields(product.id))[0].reviewedById).toBe(actorId);

    const other = await newProduct();
    expect(await confirmProductExtraction(other.id)).toEqual({ success: "Details confirmed." });
    expect((await db.prisma.product.findUniqueOrThrow({ where: { id: other.id } })).extractionPending).toBe(false);
  });
});

describe("Contract status", () => {
  it("persists a cancel and revalidates the same paths as any update", async () => {
    const contract = await newContract();
    expect(await setContractStatus(contract.id, "CANCELLED")).toEqual({ success: "Contract cancelled." });
    const saved = await db.prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(saved.status).toBe("CANCELLED");
    expect(saved.updatedById).toBe(actorId);
    // Only the status changed.
    expect(saved.isTaxDeductible).toBe(true);
    expect(saved.extractionPending).toBe(true);
    for (const path of ["/contracts", `/contracts/${contract.id}`, "/dashboard"]) {
      expect(revalidatePath).toHaveBeenCalledWith(path);
    }
  });

  it("cancels then reactivates", async () => {
    const contract = await newContract();
    await setContractStatus(contract.id, "CANCELLED");
    expect(await setContractStatus(contract.id, "ACTIVE")).toEqual({ success: "Contract reactivated." });
    expect((await db.prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).status).toBe("ACTIVE");
  });

  it("refuses a status that isn't one", async () => {
    const contract = await newContract();
    expect(await setContractStatus(contract.id, "EXPIRED" as never)).toEqual({ error: "Invalid status." });
    expect((await db.prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).status).toBe("ACTIVE");
  });
});

describe("a record in Trash", () => {
  it("refuses updates, status changes and review on a trashed Contract", async () => {
    const contract = await newContract();
    await addPendingFields("CONTRACT", contract.id, ["endDate"]);
    await deleteContractCommand(contract.id);

    await expect(updateContractCommand(contract.id, { title: "x" }, actorId)).rejects.toBeInstanceOf(
      RecordNotFoundError,
    );
    expect(await setContractStatus(contract.id, "CANCELLED")).toEqual({ error: "Contract not found." });
    expect(await confirmContractExtraction(contract.id)).toEqual({ error: "Contract not found." });
    expect(
      await reviewContractExtraction(contract.id, null, formData({ "reviewField:endDate": "2030-01-01" })),
    ).toEqual({ error: "Contract not found." });

    const saved = await db.prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(saved.status).toBe("ACTIVE");
    expect(saved.extractionPending).toBe(true);
    expect((await reviewFields(contract.id))[0].reviewedAt).toBeNull();

    // Restoring it makes it writable again.
    await restoreContractCommand(contract.id);
    expect(await setContractStatus(contract.id, "CANCELLED")).toEqual({ success: "Contract cancelled." });
  });

  it("refuses updates and review on a trashed Product", async () => {
    const product = await newProduct();
    await deleteProductCommand(product.id);
    await expect(updateProductCommand(product.id, { description: "x" }, actorId)).rejects.toBeInstanceOf(
      RecordNotFoundError,
    );
    await expect(confirmProductExtractionCommand(product.id, {}, actorId)).rejects.toBeInstanceOf(
      RecordNotFoundError,
    );
    expect(await confirmProductExtraction(product.id)).toEqual({ error: "Warranty not found." });
  });
});

describe("the server actions", () => {
  it("refuse a READONLY member", async () => {
    const contract = await newContract();
    const product = await newProduct();
    signInAs("READONLY");
    await expect(setContractStatus(contract.id, "CANCELLED")).rejects.toThrow("read-only");
    await expect(confirmContractExtraction(contract.id)).rejects.toThrow("read-only");
    await expect(reviewContractExtraction(contract.id, null, formData({}))).rejects.toThrow("read-only");
    await expect(confirmProductExtraction(product.id)).rejects.toThrow("read-only");
    await expect(reviewProductExtraction(product.id, null, formData({}))).rejects.toThrow("read-only");
    const saved = await db.prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(saved.status).toBe("ACTIVE");
    expect(saved.extractionPending).toBe(true);
  });

  it("map a missing record through commandError", async () => {
    expect(await setContractStatus("missing", "CANCELLED")).toEqual({ error: "Contract not found." });
    expect(await confirmContractExtraction("missing")).toEqual({ error: "Contract not found." });
    expect(await confirmProductExtraction("missing")).toEqual({ error: "Warranty not found." });
    expect(await updateContractFromAssistant("missing", { title: "x", category: "OTHER", provider: "y", renewalType: "FIXED_TERM" })).toEqual({
      success: false,
      error: "Contract not found.",
    });
  });

  it("the update command still refuses a stale edit", async () => {
    const contract = await newContract();
    // An explicit earlier base, so the first update's own updatedAt can't
    // land in the same millisecond as it.
    const base = new Date(Date.now() - 60_000);
    await db.prisma.contract.update({ where: { id: contract.id }, data: { updatedAt: base } });
    await updateContractCommand(contract.id, { title: "First" }, actorId, { baseUpdatedAt: base });
    await expect(
      updateContractCommand(contract.id, { title: "Second" }, actorId, { baseUpdatedAt: base }),
    ).rejects.toBeInstanceOf(StaleEditError);
    expect((await db.prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).title).toBe("First");
  });
});

describe("the Assistant's actions", () => {
  const contractData = { title: "Gym", category: "SUBSCRIPTION", provider: "FitCo", renewalType: "FIXED_TERM" };

  it("report an unexpected failure generically and log it", async () => {
    const contract = await newContract();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(new Error("disk I/O error at /secret/path"));
    expect(await updateContractFromAssistant(contract.id, contractData)).toEqual({
      success: false,
      error: "Couldn't save that change.",
    });
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it("refuse a link to a Property or Vehicle that's missing or in Trash", async () => {
    const contract = await newContract();
    await setModuleEnabled("HOME", true);
    expect(await updateContractFromAssistant(contract.id, { ...contractData, propertyId: "nope" })).toEqual({
      success: false,
      error: "That property doesn't exist or has been deleted.",
    });
    await setModuleEnabled("VEHICLES", true);
    const vehicle = await db.prisma.vehicle.create({
      data: { label: "Ute", createdById: actorId, deletedAt: new Date() },
    });
    expect(await createContractFromAssistant({ ...contractData, vehicleId: vehicle.id })).toEqual({
      success: false,
      error: "That vehicle doesn't exist or has been deleted.",
    });
    expect(await createProductFromAssistant({ description: "TV", propertyId: "nope" })).toEqual({
      success: false,
      error: "That property doesn't exist or has been deleted.",
    });
    expect(await updateProductFromAssistant((await newProduct()).id, { description: "TV", propertyId: "nope" })).toEqual({
      success: false,
      error: "That property doesn't exist or has been deleted.",
    });
    expect((await db.prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).propertyId).toBeNull();
  });

  it("still link to a live Property", async () => {
    await setModuleEnabled("HOME", true);
    const property = await db.prisma.property.create({ data: { label: "Home", createdById: actorId } });
    const result = await createContractFromAssistant({ ...contractData, propertyId: property.id });
    expect(result.success).toBe(true);
  });
});

describe("review checks", () => {
  it("refuses an end date before the start date, against the saved start date", async () => {
    const contract = await newContract({ startDate: "2026-01-01" });
    await addPendingFields("CONTRACT", contract.id, ["endDate"]);
    expect(
      await reviewContractExtraction(contract.id, null, formData({ "reviewField:endDate": "2025-12-01" })),
    ).toEqual({ error: "End date can't be before the start date." });
    const saved = await db.prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(saved.endDate?.toISOString().slice(0, 10)).toBe("2027-06-01");
    expect(saved.extractionPending).toBe(true);
    expect((await reviewFields(contract.id))[0].reviewedAt).toBeNull();
  });

  it("refuses a warranty end before the purchase date", async () => {
    const product = await createProductCommand(
      productSchema.parse({ description: "TV", purchaseDate: "2026-05-01" }),
      actorId,
      { extractionPending: true },
    );
    await addPendingFields("PRODUCT", product.id, ["warrantyEndDate"]);
    expect(
      await reviewProductExtraction(product.id, null, formData({ "reviewField:warrantyEndDate": "2026-04-01" })),
    ).toEqual({ error: "Warranty end date can't be before the purchase date." });
    expect((await db.prisma.product.findUniqueOrThrow({ where: { id: product.id } })).extractionPending).toBe(true);
  });

  it("refuses an over-long title with the form's message instead of cutting it short", async () => {
    const contract = await newContract();
    await addPendingFields("CONTRACT", contract.id, ["title"]);
    const formMessage = contractSchema.shape.title.safeParse("x".repeat(201)).error?.issues[0]?.message;
    expect(formMessage).toBeTruthy();
    expect(
      await reviewContractExtraction(contract.id, null, formData({ "reviewField:title": "x".repeat(201) })),
    ).toEqual({ error: formMessage });
    expect((await db.prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).title).toBe("Gym");
  });

  it("works out the corrections from the fields pending inside the transaction", async () => {
    const contract = await newContract();
    await addPendingFields("CONTRACT", contract.id, ["endDate", "title"]);
    await db.prisma.extractionReviewField.updateMany({
      where: { ownerId: contract.id, fieldName: "title" },
      data: { reviewedAt: new Date() },
    });
    const seen: string[][] = [];
    await confirmContractExtractionCommand(
      contract.id,
      (pending) => {
        seen.push([...pending].sort());
        return {};
      },
      actorId,
    );
    expect(seen).toEqual([["endDate"]]);
  });
});
