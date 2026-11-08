import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { setupTestDb, createTestUser, setModuleEnabled } from "../helpers/testDb";
import { detailTitle, recordMetadata, recordName } from "@/lib/recordTitles";

// #558 (WCAG 2.4.2): every page under (app) names itself in the browser tab,
// instead of falling back to the root layout's bare "Hearth".

const appDir = path.join(__dirname, "..", "..", "src", "app", "(app)");

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return pages(full);
    return name === "page.tsx" ? [full] : [];
  });
}

// Pages that only redirect elsewhere never render, so they need no title.
const REDIRECT_ONLY = [path.join("settings", "app", "page.tsx"), path.join("settings", "webhooks", "page.tsx")];

describe("page titles", () => {
  it("every rendered page exports metadata or generateMetadata", () => {
    const missing = pages(appDir)
      .map((file) => ({ rel: path.relative(appDir, file), text: readFileSync(file, "utf8") }))
      .filter(({ rel }) => !REDIRECT_ONLY.includes(rel))
      .filter(({ text }) => !/export (const metadata\b|async function generateMetadata\b)/.test(text))
      .map(({ rel }) => rel);
    expect(missing).toEqual([]);
  });

  it("the redirect-only exceptions still only redirect", () => {
    for (const rel of REDIRECT_ONLY) {
      expect(readFileSync(path.join(appDir, rel), "utf8")).toMatch(/redirect\(/);
    }
  });
});

describe("recordName", () => {
  const db = setupTestDb();

  it("names a record and builds its titles", async () => {
    const user = await createTestUser();
    const contract = await db.prisma.contract.create({
      data: { title: "  Netflix ", provider: "Netflix", category: "SUBSCRIPTION", createdById: user.id },
    });
    expect(await recordName("contract", contract.id)).toBe("Netflix");
    expect(await recordMetadata("contract", contract.id, detailTitle("contract"), "Contract")).toEqual({
      title: "Netflix · Contracts",
    });
    expect(await recordMetadata("contract", "missing", detailTitle("contract"), "Contract")).toEqual({
      title: "Contract",
    });
  });

  it("gives no name for a record in a disabled module", async () => {
    const user = await createTestUser();
    const trip = await db.prisma.trip.create({ data: { title: "Japan", createdById: user.id } });
    await setModuleEnabled("TRAVEL", true);
    expect(await recordName("trip", trip.id)).toBe("Japan");
    await setModuleEnabled("TRAVEL", false);
    expect(await recordName("trip", trip.id)).toBeNull();
    expect(await recordMetadata("trip", trip.id, (name) => `Edit ${name}`, "Edit trip")).toEqual({ title: "Edit trip" });
  });
});
