// #363 / #525 review — members can now open the Household tab and see the
// admin-only sections greyed out, but greying is only the UI. Each Household
// settings action must refuse a member (or read-only user) on the server and
// write nothing, so a direct POST of the action can't change shared settings.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, createTestUser } from "../helpers/testDb";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import * as appSettings from "@/lib/actions/app-settings";
import { saveAiSettings, removeAiSettings } from "@/lib/actions/ai";
import { saveChatSettings, removeChatSettings } from "@/lib/actions/chatSettings";
import {
  createWebhookEndpoint,
  deleteWebhookEndpoint,
  toggleWebhookEndpoint,
  sendTestWebhookAction,
} from "@/lib/actions/webhook";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
// requireAdmin() redirects non-admins; make that observable instead of a no-op.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT ${to}`);
  }),
  notFound: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

setupTestDb();

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

// Every value valid, so nothing but the role check could stop the write.
const writes: [string, () => Promise<unknown>][] = [
  ["saveSmtpSettings", () => appSettings.saveSmtpSettings(null, form({ smtpHost: "smtp.example.test", smtpPort: "587", smtpFrom: "a@example.test" }))],
  ["saveNtfySettings", () => appSettings.saveNtfySettings(null, form({ ntfyUrl: "https://ntfy.sh", ntfyTopic: "member-topic" }))],
  ["saveEmailIngestSettings", () => appSettings.saveEmailIngestSettings(null, form({ emailIngestHost: "imap.example.test", emailIngestPort: "993" }))],
  ["saveOllamaSettings", () => appSettings.saveOllamaSettings(null, form({ ollamaBaseUrl: "http://localhost:11434", ollamaModel: "m" }))],
  ["saveBarcodeSettings", () => appSettings.saveBarcodeSettings(null, form({ barcodeApiKey: "k" }))],
  ["saveBackupDestination", () => appSettings.saveBackupDestination(null, form({ backupDestination: "local", backupLocalPath: "/tmp/x" }))],
  ["saveReminderSchedule", () => appSettings.saveReminderSchedule(null, form({ reminderCron: "0 9 * * *", reminderDefaultDays: "30,7" }))],
  ["saveBackupSchedule", () => appSettings.saveBackupSchedule(null, form({ backupCron: "0 3 * * *", retentionCount: "5" }))],
  ["saveHouseholdTimeZone", () => appSettings.saveHouseholdTimeZone(null, form({ householdTimeZone: "Africa/Johannesburg" }))],
  ["clearAppSetting", () => appSettings.clearAppSetting("ntfy.token")],
  ["saveAviationStackSettings", () => appSettings.saveAviationStackSettings(null, form({ aviationstackApiKey: "k" }))],
  ["saveAiSettings", () => saveAiSettings(null, form({ provider: "OLLAMA", model: "m" }))],
  ["removeAiSettings", () => removeAiSettings()],
  ["saveChatSettings", () => saveChatSettings(null, form({ provider: "OLLAMA", model: "m" }))],
  ["removeChatSettings", () => removeChatSettings()],
  ["createWebhookEndpoint", () => createWebhookEndpoint(null, form({ name: "Member hook", url: "https://example.test/hook" }))],
];

async function counts() {
  return {
    settings: await prisma.appSetting.count(),
    webhooks: await prisma.webhookEndpoint.count(),
    enabledWebhooks: await prisma.webhookEndpoint.count({ where: { enabled: true } }),
  };
}

describe.each(["MEMBER", "READONLY"] as const)("a %s calling a Household settings action directly", (role) => {
  let endpointId: string;

  beforeEach(async () => {
    const admin = await createTestUser({ role: "ADMIN" });
    const user = await createTestUser({ role });
    vi.mocked(auth).mockResolvedValue({ user: { id: user.id, role }, expires: "" } as never);
    // Existing household settings a member must not be able to change.
    await prisma.appSetting.upsert({
      where: { key: "household.timezone" },
      create: { key: "household.timezone", value: "Australia/Perth" },
      update: { value: "Australia/Perth" },
    });
    await prisma.appSetting.upsert({
      where: { key: "ntfy.token" },
      create: { key: "ntfy.token", value: "admin-token" },
      update: { value: "admin-token" },
    });
    const endpoint = await prisma.webhookEndpoint.create({
      data: { name: "Admin hook", url: "https://example.test/admin", enabled: true, createdById: admin.id },
    });
    endpointId = endpoint.id;
  });

  it.each(writes)("%s is refused and writes nothing", async (_name, call) => {
    const before = await counts();
    const outcome = await call().then(
      (result) => ({ result }),
      (error: unknown) => ({ error: String(error) }),
    );
    // Either requireAdmin's redirect or an explicit { error }.
    if ("error" in outcome) expect(outcome.error).toContain("REDIRECT /settings");
    else expect(outcome.result).toMatchObject({ error: expect.any(String) });
    expect(await counts()).toEqual(before);
    const tz = await prisma.appSetting.findUnique({ where: { key: "household.timezone" } });
    expect(tz?.value).toBe("Australia/Perth");
  });

  it("can't delete, disable or fire an existing webhook", async () => {
    for (const call of [
      () => deleteWebhookEndpoint(endpointId),
      () => toggleWebhookEndpoint(endpointId, false),
      () => sendTestWebhookAction(endpointId),
    ]) {
      const outcome = await call().then(
        (result) => ({ result }),
        (error: unknown) => ({ error: String(error) }),
      );
      if ("error" in outcome) expect(outcome.error).toContain("REDIRECT /settings");
      else expect(outcome.result).toMatchObject({ error: expect.any(String) });
    }
    await prisma.appSetting.upsert({
      where: { key: "ntfy.token" },
      create: { key: "ntfy.token", value: "admin-token" },
      update: { value: "admin-token" },
    });
    const endpoint = await prisma.webhookEndpoint.findUnique({ where: { id: endpointId } });
    expect(endpoint?.enabled).toBe(true);
    expect(await prisma.webhookLog.count()).toBe(0);
  });
});
