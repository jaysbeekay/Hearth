import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, createTestUser } from "../helpers/testDb";
import { auth } from "@/lib/auth";
import { isNtfyConfigured, isSmtpConfigured } from "@/lib/appSettings";
import { sendTestEmail } from "@/lib/notifications/email";
import { sendTestNtfy } from "@/lib/notifications/ntfy";
import { sendChannelTest } from "@/lib/actions/reminders";
import { ownPushDevices } from "@/lib/notifications/push";
import { hashToken } from "@/lib/crypto";

// #375 part 3 — the "Turn on reminders" screen tests one channel at a time,
// and lists the member's own devices without their endpoint URLs.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/appSettings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/appSettings")>()),
  isSmtpConfigured: vi.fn(),
  isNtfyConfigured: vi.fn(),
}));
vi.mock("@/lib/notifications/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notifications/email")>()),
  sendTestEmail: vi.fn(),
}));
vi.mock("@/lib/notifications/ntfy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notifications/ntfy")>()),
  sendTestNtfy: vi.fn(),
}));

const db = setupTestDb();

function signedInAs(role: "ADMIN" | "MEMBER" | "READONLY", email: string | null = "me@example.com") {
  vi.mocked(auth).mockResolvedValue({ user: { id: "u1", role, email } } as never);
}

beforeEach(() => {
  vi.mocked(sendTestEmail).mockReset();
  vi.mocked(sendTestNtfy).mockReset();
  vi.mocked(isSmtpConfigured).mockResolvedValue(true);
  vi.mocked(isNtfyConfigured).mockResolvedValue(true);
});

describe("sendChannelTest", () => {
  it("emails the member's own address", async () => {
    signedInAs("MEMBER");
    expect(await sendChannelTest("EMAIL")).toEqual({ success: "Test email sent to me@example.com." });
    expect(sendTestEmail).toHaveBeenCalledWith("me@example.com");
    expect(sendTestNtfy).not.toHaveBeenCalled();
  });

  it("sends to ntfy only", async () => {
    signedInAs("MEMBER");
    expect(await sendChannelTest("NTFY")).toEqual({ success: expect.stringContaining("ntfy") });
    expect(sendTestNtfy).toHaveBeenCalledOnce();
    expect(sendTestEmail).not.toHaveBeenCalled();
  });

  it("says when the channel isn't set up, without sending", async () => {
    signedInAs("ADMIN");
    vi.mocked(isSmtpConfigured).mockResolvedValue(false);
    vi.mocked(isNtfyConfigured).mockResolvedValue(false);
    expect(await sendChannelTest("EMAIL")).toEqual({ error: "Email isn't set up for the household yet." });
    expect(await sendChannelTest("NTFY")).toEqual({ error: "ntfy isn't set up for the household yet." });
    expect(sendTestEmail).not.toHaveBeenCalled();
    expect(sendTestNtfy).not.toHaveBeenCalled();
  });

  it("reports a failed send", async () => {
    signedInAs("MEMBER");
    vi.mocked(sendTestNtfy).mockRejectedValue(new Error("ntfy answered 403"));
    expect(await sendChannelTest("NTFY")).toEqual({ error: "ntfy answered 403" });
  });

  it("refuses an unknown channel and read-only members", async () => {
    signedInAs("MEMBER");
    expect(await sendChannelTest("WEBHOOK" as never)).toEqual({ error: "Unknown reminder channel." });
    signedInAs("READONLY");
    await expect(sendChannelTest("EMAIL")).rejects.toThrow("read-only");
    expect(sendTestEmail).not.toHaveBeenCalled();
  });

  it("needs an email address for an email test", async () => {
    signedInAs("MEMBER", null);
    expect(await sendChannelTest("EMAIL")).toEqual({ error: "Your account has no email address to send a test to." });
  });
});

describe("ownPushDevices", () => {
  it("lists only the member's devices, with endpoint hashes instead of URLs", async () => {
    const me = await createTestUser();
    const other = await createTestUser();
    const keys = { p256dh: "B".repeat(87), auth: "A".repeat(22) };
    await db.prisma.pushSubscription.create({ data: { userId: me.id, endpoint: "https://push.example/mine", deviceLabel: "Chrome on Android", ...keys } });
    await db.prisma.pushSubscription.create({ data: { userId: other.id, endpoint: "https://push.example/theirs", ...keys } });

    const devices = await ownPushDevices(me.id);
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({ deviceLabel: "Chrome on Android", endpointHash: hashToken("https://push.example/mine") });
    expect(devices[0]).not.toHaveProperty("endpoint");
  });
});
