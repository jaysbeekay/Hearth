// The SMTP form refuses a new From address servers would reject, but a From
// saved before that check existed must not block saving the rest of the form.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, createTestUser } from "../helpers/testDb";
import { auth } from "@/lib/auth";
import { saveSmtpSettings } from "@/lib/actions/app-settings";
import { getSmtpConfig, setAppSetting } from "@/lib/appSettings";
import { sendTestEmail } from "@/lib/notifications/email";
import { env } from "@/lib/env";

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

  it("refuses to send with no From at all, with an error that says why", async () => {
    // A SendGrid-style username isn't an address, and no From is set.
    await setAppSetting("smtp.host", "smtp.example.com");
    await setAppSetting("smtp.user", "apikey");
    await expect(sendTestEmail("a@example.com")).rejects.toThrow(/No From address/);
  });

  it("falls back to an unqualified SMTP_FROM from .env rather than sending with no From", async () => {
    // A lenient relay may still accept no-reply@localhost; a null sender never works.
    const saved = env.smtp.from;
    env.smtp.from = "Hearth <no-reply@localhost>";
    try {
      await setAppSetting("smtp.user", "apikey");
      const smtp = await getSmtpConfig();
      expect(smtp.configuredFrom).toBe("");
      expect(smtp.from).toBe("Hearth <no-reply@localhost>");
    } finally {
      env.smtp.from = saved;
    }
  });
});
