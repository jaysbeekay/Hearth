// The SMTP form refuses a new From address servers would reject, but a From
// saved before that check existed must not block saving the rest of the form.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, createTestUser } from "../helpers/testDb";
import { auth } from "@/lib/auth";
import { saveSmtpSettings } from "@/lib/actions/app-settings";
import { getSmtpConfig, setAppSetting } from "@/lib/appSettings";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT ${to}`);
  }),
  notFound: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const db = setupTestDb();

beforeEach(async () => {
  await db.prisma.appSetting.deleteMany();
  const admin = await createTestUser({ role: "ADMIN" });
  vi.mocked(auth).mockResolvedValue({ user: { id: admin.id, email: admin.email, role: "ADMIN" } } as never);
});

function form(from: string) {
  const data = new FormData();
  data.set("smtpHost", "smtp.example.com");
  data.set("smtpPort", "587");
  data.set("smtpUser", "login@example.org");
  data.set("smtpFrom", from);
  return data;
}

describe("saveSmtpSettings From address", () => {
  it("refuses a new unqualified From and saves nothing", async () => {
    const result = await saveSmtpSettings(null, form("Hearth <no-reply@localhost>"));
    expect(result).toMatchObject({ field: "smtpFrom" });
    expect((await getSmtpConfig()).host).not.toBe("smtp.example.com");
  });

  it("accepts a qualified From", async () => {
    expect(await saveSmtpSettings(null, form("Hearth <hearth@example.com>"))).toEqual({ success: "Email settings saved." });
    expect((await getSmtpConfig()).from).toBe("Hearth <hearth@example.com>");
  });

  it("accepts a blank From, which then sends as the username", async () => {
    expect(await saveSmtpSettings(null, form(""))).toEqual({ success: "Email settings saved." });
    const smtp = await getSmtpConfig();
    expect(smtp.configuredFrom).toBe("");
    expect(smtp.from).toBe("Hearth <login@example.org>");
  });

  it("still saves the rest of the form when an old unqualified From comes back unchanged", async () => {
    await setAppSetting("smtp.from", "Hearth <no-reply@localhost>");
    expect(await saveSmtpSettings(null, form("Hearth <no-reply@localhost>"))).toEqual({ success: "Email settings saved." });
    expect((await getSmtpConfig()).host).toBe("smtp.example.com");
  });
});
