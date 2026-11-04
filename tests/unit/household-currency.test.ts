// #453 — the household currency setting: admins save it (ISO 4217 only),
// clearing it falls back to the first admin's preferred currency, and a new
// member starts with it as their own preferred currency.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, createTestUser } from "../helpers/testDb";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { saveHouseholdCurrency } from "@/lib/actions/app-settings";
import { createUser } from "@/lib/actions/auth";
import { getHouseholdCurrency } from "@/lib/appSettings";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT ${to}`);
  }),
  notFound: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }));
vi.mock("next-auth", () => ({ AuthError: class AuthError extends Error {}, CredentialsSignin: class CredentialsSignin extends Error {} }));

setupTestDb();

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe("household currency", () => {
  beforeEach(async () => {
    const admin = await createTestUser({ role: "ADMIN" });
    await prisma.user.update({ where: { id: admin.id }, data: { preferredCurrency: "NZD" } });
    vi.mocked(auth).mockResolvedValue({ user: { id: admin.id, role: "ADMIN" }, expires: "" } as never);
  });

  it("falls back to the first admin's preferred currency until one is set", async () => {
    expect(await getHouseholdCurrency()).toBe("NZD");
  });

  it("saves an ISO 4217 code in upper case", async () => {
    expect(await saveHouseholdCurrency(null, form({ householdCurrency: "zar" }))).toMatchObject({ success: expect.any(String) });
    expect(await getHouseholdCurrency()).toBe("ZAR");
  });

  it("refuses a code that isn't ISO 4217 and keeps the saved one", async () => {
    await saveHouseholdCurrency(null, form({ householdCurrency: "ZAR" }));
    expect(await saveHouseholdCurrency(null, form({ householdCurrency: "XYZ" }))).toMatchObject({ error: expect.any(String) });
    expect(await getHouseholdCurrency()).toBe("ZAR");
  });

  it("refuses an ISO code the currency selects don't offer", async () => {
    expect(await saveHouseholdCurrency(null, form({ householdCurrency: "ISK" }))).toMatchObject({ error: expect.any(String) });
    expect(await getHouseholdCurrency()).toBe("NZD");
  });

  it("clears back to the first admin's currency when saved empty", async () => {
    await saveHouseholdCurrency(null, form({ householdCurrency: "ZAR" }));
    await saveHouseholdCurrency(null, form({ householdCurrency: "" }));
    expect(await prisma.appSetting.findUnique({ where: { key: "household.currency" } })).toBeNull();
    expect(await getHouseholdCurrency()).toBe("NZD");
  });

  it("gives a new member the household currency as their preferred currency", async () => {
    await saveHouseholdCurrency(null, form({ householdCurrency: "ZAR" }));
    const result = await createUser(
      null,
      form({ name: "New member", email: "new-member@example.test", password: "a-long-password", role: "MEMBER" }),
    );
    expect(result).toMatchObject({ success: expect.any(String) });
    const user = await prisma.user.findUnique({ where: { email: "new-member@example.test" } });
    expect(user?.preferredCurrency).toBe("ZAR");
  });
});
