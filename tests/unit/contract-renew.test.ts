// #353 — Renew adds a Contract's next Term through the Contract command
// (ADR 0003), keeping the current one as a ContractTerm row.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, createTestUser } from "../helpers/testDb";
import {
  createContractCommand,
  renewContractCommand,
  deleteContractCommand,
  permanentlyDeleteContractCommand,
} from "@/lib/commands/contracts";
import { deleteDocumentCommand, permanentlyDeleteDocumentCommand } from "@/lib/commands/documents";
import { RecordNotFoundError, RecordValidationError, StaleEditError } from "@/lib/commands/shared";
import { renewContract } from "@/lib/actions/contracts";
import { contractSchema, contractRenewalSchema } from "@/lib/validation/contract";
import { contractDue } from "@/lib/dueRecords";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
}));
// Scanning an uploaded PDF isn't what's under test here.
vi.mock("@/lib/documents/queueExtraction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/documents/queueExtraction")>();
  return { ...actual, queueDocumentExtraction: vi.fn() };
});

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

function day(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

const newContract = (extra: Record<string, unknown> = {}) =>
  createContractCommand(
    contractSchema.parse({
      title: "Home insurance",
      category: "HOME_INSURANCE",
      provider: "Acme",
      renewalType: "MANUAL_RENEWAL",
      startDate: "2025-07-01",
      endDate: "2026-06-30",
      cost: 1200,
      billingFrequency: "ANNUALLY",
      ...extra,
    }),
    actorId,
  );

async function addDocument(contractId: string, filename: string, uploadedAt: Date) {
  return db.prisma.document.create({
    data: { contractId, filename, storedName: `${filename}.bin`, mimeType: "application/pdf", size: 10, uploadedAt },
  });
}

function formData(values: Record<string, string | File>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.append(key, value);
  return fd;
}

describe("renewContractCommand", () => {
  it("keeps the current Term as history and makes the new one current", async () => {
    const contract = await newContract();
    const doc = await addDocument(contract.id, "policy-2025.pdf", new Date("2025-07-01T10:00:00Z"));

    const { termId } = await renewContractCommand(
      contract.id,
      { startDate: day("2026-07-01"), endDate: day("2027-06-30"), cost: 1344 },
      actorId,
    );

    const renewed = await db.prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(renewed).toMatchObject({
      startDate: day("2026-07-01"),
      endDate: day("2027-06-30"),
      cost: 1344,
      currency: "AUD",
      billingFrequency: "ANNUALLY",
      updatedById: actorId,
    });
    const term = await db.prisma.contractTerm.findUniqueOrThrow({ where: { id: termId } });
    expect(term).toMatchObject({
      contractId: contract.id,
      startDate: day("2025-07-01"),
      endDate: day("2026-06-30"),
      cost: 1200,
      currency: "AUD",
      billingFrequency: "ANNUALLY",
      documentId: doc.id,
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/contracts/${contract.id}`);
  });

  it("clears a blank start date or cost on the new Term", async () => {
    const contract = await newContract();
    await renewContractCommand(contract.id, { endDate: day("2027-06-30") }, actorId);
    const renewed = await db.prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(renewed.startDate).toBeNull();
    expect(renewed.cost).toBeNull();
  });

  it("links each Term to the newest Document no earlier Term has", async () => {
    const contract = await newContract();
    const first = await addDocument(contract.id, "policy-2025.pdf", new Date("2025-07-01T10:00:00Z"));
    await renewContractCommand(contract.id, { endDate: day("2027-06-30") }, actorId);
    // Renewed again with no new Document: nothing new to link.
    await renewContractCommand(contract.id, { endDate: day("2028-06-30") }, actorId);
    const second = await addDocument(contract.id, "policy-2027.pdf", new Date("2027-07-01T10:00:00Z"));
    const trashed = await addDocument(contract.id, "draft.pdf", new Date("2027-08-01T10:00:00Z"));
    await db.prisma.document.update({ where: { id: trashed.id }, data: { deletedAt: new Date() } });
    await renewContractCommand(contract.id, { endDate: day("2029-06-30") }, actorId);

    const terms = await db.prisma.contractTerm.findMany({
      where: { contractId: contract.id },
      orderBy: { createdAt: "asc" },
    });
    expect(terms.map((t) => t.documentId)).toEqual([first.id, null, second.id]);
    expect(terms.map((t) => t.endDate)).toEqual([day("2026-06-30"), day("2027-06-30"), day("2028-06-30")]);
  });

  it("refuses a new end date that isn't after the current one", async () => {
    const contract = await newContract();
    await expect(renewContractCommand(contract.id, { endDate: day("2026-06-30") }, actorId)).rejects.toThrow(
      RecordValidationError,
    );
    expect(await db.prisma.contractTerm.count()).toBe(0);
  });

  it("refuses an end date before the new start date", async () => {
    const contract = await newContract();
    await expect(
      renewContractCommand(contract.id, { startDate: day("2027-07-01"), endDate: day("2027-06-30") }, actorId),
    ).rejects.toThrow("End date can't be before the start date.");
    expect(await db.prisma.contractTerm.count()).toBe(0);
  });

  it("renews a Contract that had no end date", async () => {
    const contract = await newContract({ endDate: undefined, startDate: undefined });
    await renewContractCommand(contract.id, { endDate: day("2027-06-30") }, actorId);
    const term = await db.prisma.contractTerm.findFirstOrThrow({ where: { contractId: contract.id } });
    expect(term.endDate).toBeNull();
  });

  it("refuses a Cancelled Contract", async () => {
    const contract = await newContract({ status: "CANCELLED" });
    await expect(renewContractCommand(contract.id, { endDate: day("2027-06-30") }, actorId)).rejects.toThrow(
      "Mark it as active first",
    );
  });

  it("refuses a Contract in Trash as not found", async () => {
    const contract = await newContract();
    await deleteContractCommand(contract.id);
    await expect(renewContractCommand(contract.id, { endDate: day("2027-06-30") }, actorId)).rejects.toThrow(
      RecordNotFoundError,
    );
  });

  it("refuses a stale renewal and adds no Term, so a double submit can't add two", async () => {
    const contract = await newContract();
    const base = contract.updatedAt.toISOString();
    await renewContractCommand(contract.id, { endDate: day("2027-06-30") }, actorId, { baseUpdatedAt: base });
    await expect(
      renewContractCommand(contract.id, { endDate: day("2028-06-30") }, actorId, { baseUpdatedAt: base }),
    ).rejects.toThrow(StaleEditError);
    expect(await db.prisma.contractTerm.count({ where: { contractId: contract.id } })).toBe(1);
    const current = await db.prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(current.endDate).toEqual(day("2027-06-30"));
  });

  it("takes an auto-renewing Contract out of Housekeeping once its new end date is set", async () => {
    const contract = await newContract({ renewalType: "AUTO_RENEW" });
    const ctx = { today: "2026-08-01", defaultReminderDays: "30,14,7,1" };
    const before = await db.prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(contractDue(before, ctx).map((e) => e.state)).toEqual(["needs-new-end-date"]);
    await renewContractCommand(contract.id, { endDate: day("2027-06-30") }, actorId);
    const after = await db.prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(contractDue(after, ctx).map((e) => e.state)).toEqual(["later"]);
  });

  it("deletes a Contract's Terms with it, and keeps a Term whose Document is deleted", async () => {
    const contract = await newContract();
    const doc = await addDocument(contract.id, "policy.pdf", new Date("2025-07-01T10:00:00Z"));
    await renewContractCommand(contract.id, { endDate: day("2027-06-30") }, actorId);

    await deleteDocumentCommand("CONTRACT", doc.id);
    await permanentlyDeleteDocumentCommand("CONTRACT", doc.id);
    const term = await db.prisma.contractTerm.findFirstOrThrow({ where: { contractId: contract.id } });
    expect(term.documentId).toBeNull();

    await permanentlyDeleteContractCommand(contract.id);
    expect(await db.prisma.contractTerm.count()).toBe(0);
  });
});

describe("contractRenewalSchema", () => {
  it("needs an end date", () => {
    const parsed = contractRenewalSchema.safeParse({ startDate: "2026-07-01", endDate: "", cost: "" });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe("Enter the new end date.");
  });

  it("checks the dates are in order", () => {
    const parsed = contractRenewalSchema.safeParse({ startDate: "2027-07-01", endDate: "2027-06-30" });
    expect(parsed.error?.issues[0]?.message).toBe("End date can't be before the start date.");
  });

  it("reads blank start date and cost as not given", () => {
    const parsed = contractRenewalSchema.parse({ startDate: "", endDate: "2027-06-30", cost: "" });
    expect(parsed).toEqual({ endDate: day("2027-06-30") });
  });
});

describe("renewContract action", () => {
  it("renews, attaches the new Document and goes back to the Contract", async () => {
    const contract = await newContract();
    const old = await addDocument(contract.id, "policy-2025.pdf", new Date("2025-07-01T10:00:00Z"));
    const file = new File(["%PDF-1.4\n% renewal\n"], "policy-2026.pdf", { type: "application/pdf" });

    await expect(
      renewContract(
        contract.id,
        null,
        formData({
          startDate: "2026-07-01",
          endDate: "2027-06-30",
          cost: "1344",
          baseUpdatedAt: contract.updatedAt.toISOString(),
          file,
        }),
      ),
    ).rejects.toThrow(`REDIRECT /contracts/${contract.id}`);

    const term = await db.prisma.contractTerm.findFirstOrThrow({ where: { contractId: contract.id } });
    expect(term).toMatchObject({ cost: 1200, documentId: old.id });
    const docs = await db.prisma.document.findMany({ where: { contractId: contract.id }, orderBy: { uploadedAt: "asc" } });
    expect(docs.map((d) => d.filename)).toEqual(["policy-2025.pdf", "policy-2026.pdf"]);
    const renewed = await db.prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(renewed.cost).toBe(1344);
  });

  it("hands back the form's values with a validation error", async () => {
    const contract = await newContract();
    const state = await renewContract(contract.id, null, formData({ startDate: "2026-07-01", endDate: "", cost: "5" }));
    expect(state).toEqual({
      error: "Enter the new end date.",
      values: { startDate: "2026-07-01", endDate: "", cost: "5" },
    });
  });

  it("reports a command's refusal as the form's error", async () => {
    const contract = await newContract();
    const state = await renewContract(contract.id, null, formData({ endDate: "2026-01-01" }));
    expect(state?.error).toBe("The new end date must be after the current one.");
    expect(await db.prisma.contractTerm.count()).toBe(0);
  });

  it("refuses an unsupported file before renewing", async () => {
    const contract = await newContract();
    const file = new File(["MZ"], "virus.exe", { type: "application/x-msdownload" });
    const state = await renewContract(contract.id, null, formData({ endDate: "2027-06-30", file }));
    expect(state?.error).toBeTruthy();
    expect(await db.prisma.contractTerm.count()).toBe(0);
  });

  it("is refused for a read-only member", async () => {
    const contract = await newContract();
    signInAs("READONLY");
    await expect(renewContract(contract.id, null, formData({ endDate: "2027-06-30" }))).rejects.toThrow(
      "read-only",
    );
    expect(await db.prisma.contractTerm.count()).toBe(0);
  });
});
