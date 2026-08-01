"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  setAppSetting,
  getOllamaConfig,
  isSmtpConfigured,
  isNtfyConfigured,
  getEmailIngestConfig,
  isEmailIngestionConfigured,
} from "@/lib/appSettings";
import { sendTestEmail } from "@/lib/notifications/email";
import { sendTestNtfy } from "@/lib/notifications/ntfy";
import type { ActionState } from "@/lib/actions/auth";

export async function requireAdmin() {
  const session = await auth();
  if (session?.user.role !== "ADMIN") redirect("/settings");
  return session;
}

export async function saveSmtpSettings(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  try {
    await setAppSetting("smtp.host", formData.get("smtpHost") as string);
    await setAppSetting("smtp.port", formData.get("smtpPort") as string);
    await setAppSetting("smtp.secure", formData.get("smtpSecure") === "on" ? "true" : "false");
    await setAppSetting("smtp.user", formData.get("smtpUser") as string);
    await setAppSetting("smtp.from", formData.get("smtpFrom") as string);

    // Sensitive: only overwrite if a new value was submitted
    const newPass = (formData.get("smtpPassword") as string) || "";
    if (newPass) await setAppSetting("smtp.password", newPass);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to save email settings." };
  }

  revalidatePath("/settings/app");
  return { success: "Email settings saved." };
}

export async function saveNtfySettings(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  try {
    await setAppSetting("ntfy.url", formData.get("ntfyUrl") as string);
    await setAppSetting("ntfy.topic", formData.get("ntfyTopic") as string);

    const newToken = (formData.get("ntfyToken") as string) || "";
    if (newToken) await setAppSetting("ntfy.token", newToken);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to save push notification settings." };
  }

  revalidatePath("/settings/app");
  return { success: "Push notification settings saved." };
}

export async function saveEmailIngestSettings(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  try {
    await setAppSetting("emailIngest.host", formData.get("emailIngestHost") as string);
    await setAppSetting("emailIngest.port", formData.get("emailIngestPort") as string);
    await setAppSetting(
      "emailIngest.secure",
      formData.get("emailIngestSecure") === "on" ? "true" : "false",
    );
    await setAppSetting("emailIngest.user", formData.get("emailIngestUser") as string);
    await setAppSetting("emailIngest.mailbox", formData.get("emailIngestMailbox") as string);

    // Sensitive: only overwrite if a new value was submitted
    const newPass = (formData.get("emailIngestPassword") as string) || "";
    if (newPass) await setAppSetting("emailIngest.password", newPass);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Failed to save email ingestion settings.",
    };
  }

  revalidatePath("/settings/app");
  return { success: "Email ingestion settings saved." };
}

export async function saveOllamaSettings(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  try {
    await setAppSetting("ollama.baseUrl", formData.get("ollamaBaseUrl") as string);
    await setAppSetting("ollama.model", formData.get("ollamaModel") as string);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to save Ollama settings." };
  }

  revalidatePath("/settings/app");
  return { success: "Ollama settings saved." };
}

export async function saveBarcodeSettings(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  try {
    await setAppSetting(
      "barcode.enabled",
      formData.get("barcodeEnabled") === "on" ? "true" : "false",
    );

    const newKey = (formData.get("barcodeApiKey") as string) || "";
    if (newKey) await setAppSetting("barcode.apiKey", newKey);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to save barcode lookup settings." };
  }

  revalidatePath("/settings/app");
  return { success: "Barcode lookup settings saved." };
}

// A single explicit destination choice — an admin picks one from a dropdown,
// and only that destination's fields are persisted.
export async function saveBackupDestination(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const destination = (formData.get("destination") as string) || "NONE";

  try {
    await setAppSetting("backup.destination", destination === "NONE" ? "" : destination);

    if (destination === "LOCAL") {
      await setAppSetting("backup.local.path", formData.get("localPath") as string);
    } else if (destination === "S3") {
      await setAppSetting("backup.s3.endpoint", formData.get("s3Endpoint") as string);
      await setAppSetting("backup.s3.region", formData.get("s3Region") as string);
      await setAppSetting("backup.s3.bucket", formData.get("s3Bucket") as string);
      await setAppSetting("backup.s3.accessKeyId", formData.get("s3AccessKeyId") as string);
      await setAppSetting(
        "backup.s3.forcePathStyle",
        formData.get("s3ForcePathStyle") === "on" ? "true" : "false",
      );

      const newSecret = (formData.get("s3SecretAccessKey") as string) || "";
      if (newSecret) await setAppSetting("backup.s3.secretAccessKey", newSecret);
    } else if (destination === "SFTP") {
      await setAppSetting("backup.sftp.host", formData.get("sftpHost") as string);
      await setAppSetting("backup.sftp.port", formData.get("sftpPort") as string);
      await setAppSetting("backup.sftp.username", formData.get("sftpUsername") as string);
      await setAppSetting("backup.sftp.remotePath", formData.get("sftpRemotePath") as string);

      const newPassword = (formData.get("sftpPassword") as string) || "";
      if (newPassword) await setAppSetting("backup.sftp.password", newPassword);

      const newKey = (formData.get("sftpPrivateKey") as string) || "";
      if (newKey) await setAppSetting("backup.sftp.privateKey", newKey);
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to save backup settings." };
  }

  revalidatePath("/settings/app");
  revalidatePath("/settings/backups");
  return { success: "Backup destination saved." };
}

export async function saveScheduleSettings(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  try {
    await setAppSetting("reminder.cron", formData.get("reminderCron") as string);
    await setAppSetting("backup.cron", formData.get("backupCron") as string);
    await setAppSetting("backup.retentionCount", formData.get("retentionCount") as string);
    await setAppSetting("reminder.defaultDays", formData.get("reminderDefaultDays") as string);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to save schedule settings." };
  }

  revalidatePath("/settings/app");
  return { success: "Schedule settings saved. Restart the server for cron changes to take effect." };
}

// Clears a single sensitive setting (e.g. remove a password / token entirely)
export async function clearAppSetting(key: string): Promise<ActionState> {
  await requireAdmin();

  const CLEARABLE = new Set([
    "smtp.password",
    "ntfy.token",
    "barcode.apiKey",
    "backup.s3.secretAccessKey",
    "backup.sftp.password",
    "backup.sftp.privateKey",
    "aviationstack.apiKey",
  ]);
  if (!CLEARABLE.has(key)) return { error: "Cannot clear that setting." };

  try {
    await setAppSetting(key, ""); // empty string → deletes the row
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to clear setting." };
  }

  revalidatePath("/settings/app");
  return { success: "Setting cleared." };
}

export async function saveAviationStackSettings(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  try {
    const newKey = (formData.get("aviationstackApiKey") as string) || "";
    if (newKey) await setAppSetting("aviationstack.apiKey", newKey);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to save flight status settings." };
  }

  revalidatePath("/settings/app");
  return { success: "Flight status settings saved." };
}

export async function testSmtpSettings(): Promise<ActionState> {
  const session = await requireAdmin();
  if (!session?.user.email) {
    return { error: "Your account has no email address to send a test to." };
  }
  if (!(await isSmtpConfigured())) {
    return { error: "SMTP isn't configured yet — save settings first." };
  }

  try {
    await sendTestEmail(session.user.email);
    return { success: `Test email sent to ${session.user.email}.` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to send test email." };
  }
}

export async function testNtfySettings(): Promise<ActionState> {
  await requireAdmin();
  if (!(await isNtfyConfigured())) {
    return { error: "ntfy isn't configured yet — save settings first." };
  }

  try {
    await sendTestNtfy();
    return { success: "Test notification sent." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to send test notification." };
  }
}

export async function testEmailIngestConnection(): Promise<ActionState> {
  await requireAdmin();
  if (!(await isEmailIngestionConfigured())) {
    return { error: "Email ingestion isn't configured yet — save settings first." };
  }

  const config = await getEmailIngestConfig();
  const { ImapFlow } = await import("imapflow");
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    logger: false,
  });

  try {
    await client.connect();
    await client.getMailboxLock(config.mailbox).then((lock) => lock.release());
    return { success: `Connected to ${config.host} and opened "${config.mailbox}".` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to connect." };
  } finally {
    await client.logout().catch(() => client.close());
  }
}

export async function testOllamaConnection(): Promise<ActionState> {
  await requireAdmin();

  const ollama = await getOllamaConfig();
  if (!ollama.baseUrl) return { error: "No Ollama base URL configured." };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${ollama.baseUrl.replace(/\/$/, "")}/api/tags`, {
      signal: controller.signal,
    });
    if (!res.ok) return { error: `Ollama responded with HTTP ${res.status}.` };

    const data = (await res.json()) as { models?: { name: string }[] };
    const names = data.models?.map((m) => m.name) ?? [];
    if (ollama.model && names.length > 0 && !names.some((n) => n === ollama.model || n.startsWith(`${ollama.model}:`))) {
      return {
        success: `Connected, but model "${ollama.model}" wasn't found. Available: ${
          names.slice(0, 5).join(", ") || "none"
        }.`,
      };
    }
    return { success: `Connected — ${names.length} model${names.length === 1 ? "" : "s"} available.` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Connection failed." };
  } finally {
    clearTimeout(timeout);
  }
}
