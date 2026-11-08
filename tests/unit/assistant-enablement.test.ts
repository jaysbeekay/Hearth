// The AI assistant is opt-in per household: off unless the first admin ticks
// it at setup or an admin turns it on in Settings, and /api/chat refuses to
// reach any provider while it's off. Households that already had a provider
// saved are switched on by the migration so nothing disappears for them.
import { readFileSync } from "fs";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { setupTestDb, createTestUser } from "../helpers/testDb";
import { auth, signIn } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { setupAdmin } from "@/lib/actions/auth";
import { setAssistantEnabled } from "@/lib/actions/chatSettings";
import { getAssistantAvailability, isAssistantEnabled } from "@/lib/assistant/enablement";
import { setAppSetting } from "@/lib/appSettings";
import { POST as chatPost } from "@/app/api/chat/route";

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

const setupFields = { name: "Ada", email: "ada@example.com", password: "correct-horse" };

describe("assistant at first-run setup", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stays off when the box is left unticked", async () => {
    await setupAdmin(null, form(setupFields));
    expect(await isAssistantEnabled()).toBe(false);
    expect(vi.mocked(signIn).mock.calls[0][1]).toMatchObject({ redirectTo: "/dashboard" });
  });

  it("turns on when ticked and sends the admin on to choose a provider", async () => {
    await setupAdmin(null, form({ ...setupFields, assistant: "on" }));
    expect(await isAssistantEnabled()).toBe(true);
    expect(vi.mocked(signIn).mock.calls[0][1]).toMatchObject({
      redirectTo: "/settings/ai?welcome=assistant",
    });
  });
});

describe("assistant switch in Settings", () => {
  it("is admin-only", async () => {
    const member = await createTestUser({ role: "MEMBER" });
    vi.mocked(auth).mockResolvedValue({ user: { id: member.id, role: "MEMBER" }, expires: "" } as never);
    await expect(setAssistantEnabled(null, form({ enabled: "true" }))).rejects.toThrow();
    expect(await isAssistantEnabled()).toBe(false);
  });

  it("turns on and off, keeping the saved provider", async () => {
    const admin = await createTestUser({ role: "ADMIN" });
    vi.mocked(auth).mockResolvedValue({ user: { id: admin.id, role: "ADMIN" }, expires: "" } as never);
    await setAppSetting("chat.provider", "OLLAMA");

    await setAssistantEnabled(null, form({ enabled: "true" }));
    expect(await getAssistantAvailability()).toEqual({ enabled: true, configured: true, available: true });

    await setAssistantEnabled(null, form({ enabled: "false" }));
    expect(await getAssistantAvailability()).toEqual({ enabled: false, configured: true, available: false });
  });
});

describe("/api/chat while the assistant is off", () => {
  it("refuses before creating a thread or calling a provider", async () => {
    const member = await createTestUser({ role: "MEMBER" });
    vi.mocked(auth).mockResolvedValue({ user: { id: member.id, role: "MEMBER" }, expires: "" } as never);
    await setAppSetting("chat.provider", "OLLAMA");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const res = await chatPost(
      new NextRequest("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "What renews next month?" }),
      }),
    );

    expect(res.status).toBe(404);
    expect(await prisma.chatThread.count()).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("migration for existing households", () => {
  const sql = readFileSync(
    path.join(process.cwd(), "prisma/migrations/20261108120000_assistant_enabled_setting/migration.sql"),
    "utf8",
  );

  it("turns the assistant on where a provider was already saved", async () => {
    await setAppSetting("chat.provider", "ANTHROPIC");
    await prisma.$executeRawUnsafe(sql);
    expect(await isAssistantEnabled()).toBe(true);
  });

  it("leaves it off where none was", async () => {
    await prisma.$executeRawUnsafe(sql);
    expect(await isAssistantEnabled()).toBe(false);
  });
});
