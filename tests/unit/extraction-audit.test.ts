// Auto-fill confirmations are recorded in the admin-only Security log
// (AUTOFILL_CONFIRMED) instead of being shown on the record page.
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, createTestUser } from "../helpers/testDb";
import { createContractCommand, confirmContractExtractionCommand } from "@/lib/commands/contracts";
import { createProductCommand, confirmProductExtractionCommand } from "@/lib/commands/products";
import {
  extractionConfirmedDetail,
  fieldLabel,
  logExtractionConfirmedFromForm,
} from "@/lib/documents/extractionAudit";
import { autoFilledFieldNamesFromForm } from "@/lib/documents/extractionConfirmation";
import { contractSchema } from "@/lib/validation/contract";
import { productSchema } from "@/lib/validation/product";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const db = setupTestDb();

let actor: { id: string; email: string };

beforeEach(async () => {
  actor = await createTestUser({ email: "reviewer@example.test" });
});

const newContract = (title = "Gym") =>
  createContractCommand(
    contractSchema.parse({
      title,
      category: "SUBSCRIPTION",
      provider: "FitCo",
      renewalType: "MANUAL_RENEWAL",
      endDate: "2027-06-01",
    }),
    actor.id,
    { extractionPending: true },
  );

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

function form(entries: [string, string][]) {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

const auditEvents = () =>
  db.prisma.securityEventLog.findMany({ where: { type: "AUTOFILL_CONFIRMED" }, orderBy: { createdAt: "asc" } });

describe("the Security log line", () => {
  it("names the record and the auto-filled fields in words", () => {
    expect(fieldLabel("warrantyEndDate")).toBe("Warranty end date");
    expect(fieldLabel("title")).toBe("Title");
    expect(extractionConfirmedDetail("CONTRACT", "Gym", ["title", "endDate", "title"])).toBe(
      'Contract "Gym" · auto-filled: Title, End date',
    );
    expect(extractionConfirmedDetail("PRODUCT", "TV", [])).toBe('Warranty "TV"');
  });
});

describe("Confirm details", () => {
  it("logs who confirmed a Contract and which fields were pending", async () => {
    const contract = await newContract();
    await addPendingFields("CONTRACT", contract.id, ["endDate", "cost"]);
    await confirmContractExtractionCommand(contract.id, {}, actor.id);

    const [event, ...rest] = await auditEvents();
    expect(rest).toHaveLength(0);
    expect(event).toMatchObject({
      userId: actor.id,
      email: "reviewer@example.test",
      detail: 'Contract "Gym" · auto-filled: End date, Cost',
    });
    // The record still carries the confirmation, for Needs review.
    const saved = await db.prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(saved.extractionPending).toBe(false);
    expect(saved.extractionConfirmedAt).toBeInstanceOf(Date);
  });

  it("names a Warranty by its description, after the reviewer's correction", async () => {
    const product = await createProductCommand(productSchema.parse({ description: "TV" }), actor.id, {
      extractionPending: true,
    });
    await addPendingFields("PRODUCT", product.id, ["description"]);
    await confirmProductExtractionCommand(product.id, () => ({ description: "OLED TV" }), actor.id);

    const [event] = await auditEvents();
    expect(event.detail).toBe('Warranty "OLED TV" · auto-filled: Description');
  });

  it("logs nothing when the record was already confirmed", async () => {
    const contract = await newContract();
    await addPendingFields("CONTRACT", contract.id, ["endDate"]);
    await confirmContractExtractionCommand(contract.id, {}, actor.id);
    await confirmContractExtractionCommand(contract.id, {}, actor.id);
    expect(await auditEvents()).toHaveLength(1);
  });

  it("logs nothing when the confirmation is refused", async () => {
    const contract = await newContract();
    await expect(
      confirmContractExtractionCommand(contract.id, {}, actor.id, { baseUpdatedAt: "2000-01-01T00:00:00.000Z" }),
    ).rejects.toThrow();
    expect(await auditEvents()).toHaveLength(0);
  });
});

describe("saving a scanned form", () => {
  const scanned = JSON.stringify([
    { fieldName: "provider", value: "FitCo", source: "heuristic" },
    { fieldName: "endDate", value: "2027-06-01", source: "heuristic" },
  ]);

  it("reads the auto-filled field names the form sent", () => {
    expect(autoFilledFieldNamesFromForm(form([["extractionReviewFields", scanned]]))).toEqual(["provider", "endDate"]);
    expect(autoFilledFieldNamesFromForm(form([["extractionReviewFields", "not json"]]))).toEqual([]);
    expect(autoFilledFieldNamesFromForm(form([]))).toEqual([]);
  });

  it("logs a Save after a scan, which is the review", async () => {
    const contract = await newContract();
    await logExtractionConfirmedFromForm(
      "CONTRACT",
      contract.id,
      actor.id,
      form([["extractionUsed", "1"], ["confirmExtraction", "1"], ["extractionReviewFields", scanned]]),
    );
    const [event] = await auditEvents();
    expect(event.detail).toBe('Contract "Gym" · auto-filled: Provider, End date');
  });

  it("logs nothing for Save for later review or a save with no scan", async () => {
    const contract = await newContract();
    for (const entries of [
      [["extractionUsed", "1"], ["confirmExtraction", "1"], ["confirmExtraction", "0"]],
      [["confirmExtraction", "1"]],
    ] as [string, string][][]) {
      await logExtractionConfirmedFromForm("CONTRACT", contract.id, actor.id, form(entries));
    }
    expect(await auditEvents()).toHaveLength(0);
  });
});

describe("backfill migration", () => {
  it("copies confirmations already saved into the log, with the reviewer when one was recorded", async () => {
    const confirmedAt = new Date("2026-11-08T09:00:00.000Z");
    const reviewed = await newContract("Reviewed");
    await addPendingFields("CONTRACT", reviewed.id, ["title", "cost"]);
    await db.prisma.extractionReviewField.updateMany({
      where: { ownerId: reviewed.id },
      data: { reviewedAt: confirmedAt, reviewedById: actor.id },
    });
    await db.prisma.contract.update({ where: { id: reviewed.id }, data: { extractionConfirmedAt: confirmedAt } });
    // Two reviewers: no single person to name.
    const other = await createTestUser();
    const mixed = await newContract("Mixed reviewers");
    await addPendingFields("CONTRACT", mixed.id, ["title", "cost"]);
    await db.prisma.extractionReviewField.updateMany({
      where: { ownerId: mixed.id },
      data: { reviewedAt: confirmedAt, reviewedById: actor.id },
    });
    await db.prisma.extractionReviewField.updateMany({
      where: { ownerId: mixed.id, fieldName: "cost" },
      data: { reviewedById: other.id },
    });
    await db.prisma.contract.update({ where: { id: mixed.id }, data: { extractionConfirmedAt: confirmedAt } });
    // Reviewed earlier, confirmed later by someone else's Save: not the reviewer's confirmation.
    const later = await newContract("Later save");
    await addPendingFields("CONTRACT", later.id, ["title"]);
    await db.prisma.extractionReviewField.updateMany({
      where: { ownerId: later.id },
      data: { reviewedAt: new Date("2026-11-01T09:00:00.000Z"), reviewedById: actor.id },
    });
    await db.prisma.contract.update({ where: { id: later.id }, data: { extractionConfirmedAt: confirmedAt } });
    const unknown = await newContract("Saved confirmed");
    await db.prisma.contract.update({ where: { id: unknown.id }, data: { extractionConfirmedAt: confirmedAt } });
    await newContract("Never confirmed");

    const sql = readFileSync(
      path.join(process.cwd(), "prisma/migrations/20261108140000_autofill_confirmed_audit/migration.sql"),
      "utf8",
    );
    for (const statement of sql.replace(/^\s*--.*$/gm, "").split(";").map((s) => s.trim()).filter(Boolean)) {
      await db.prisma.$executeRawUnsafe(statement);
    }

    const events = await db.prisma.securityEventLog.findMany({ where: { type: "AUTOFILL_CONFIRMED" }, orderBy: { detail: "asc" } });
    expect(events).toHaveLength(4);
    const byDetail = (title: string) => events.find((e) => e.detail?.startsWith(`Contract "${title}"`));
    expect(byDetail("Mixed reviewers")).toMatchObject({ userId: null, email: null });
    expect(byDetail("Later save")).toMatchObject({ userId: null, email: null });
    expect(byDetail("Reviewed")).toMatchObject({
      userId: actor.id,
      email: "reviewer@example.test",
      detail: 'Contract "Reviewed" · confirmed before this log',
      createdAt: confirmedAt,
    });
    expect(byDetail("Saved confirmed")).toMatchObject({ userId: null, email: null });
  });
});
