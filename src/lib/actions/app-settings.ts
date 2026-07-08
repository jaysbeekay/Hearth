"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { setAppSetting, isAppSettingSet } from "@/lib/appSettings";
import type { ActionState } from "@/lib/actions/auth";

async function requireAdmin() {
  const session = await auth();
  if (session?.user.role !== "ADMIN") redirect("/settings");
}

export async function saveSmtpSettings(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  await setAppSetting("smtp.host", formData.get("smtpHost") as string);
  await setAppSetting("smtp.port", formData.get("smtpPort") as string);
  await setAppSetting("smtp.secure", formData.get("smtpSecure") === "on" ? "true" : "false");
  await setAppSetting("smtp.user", formData.get("smtpUser") as string);
  await setAppSetting("smtp.from", formData.get("smtpFrom") as string);

  // Sensitive: only overwrite if a new value was submitted
  const newPass = (formData.get("smtpPassword") as string) || "";
  if (newPass) await setAppSetting("smtp.password", newPass);

  revalidatePath("/settings/app");
  return { success: "Email settings saved." };
}

export async function saveNtfySettings(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  await setAppSetting("ntfy.url", formData.get("ntfyUrl") as string);
  await setAppSetting("ntfy.topic", formData.get("ntfyTopic") as string);

  const newToken = (formData.get("ntfyToken") as string) || "";
  if (newToken) await setAppSetting("ntfy.token", newToken);

  revalidatePath("/settings/app");
  return { success: "Push notification settings saved." };
}

export async function saveOllamaSettings(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  await setAppSetting("ollama.baseUrl", formData.get("ollamaBaseUrl") as string);
  await setAppSetting("ollama.model", formData.get("ollamaModel") as string);

  revalidatePath("/settings/app");
  return { success: "Ollama settings saved." };
}

export async function saveBarcodeSettings(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  await setAppSetting(
    "barcode.enabled",
    formData.get("barcodeEnabled") === "on" ? "true" : "false",
  );

  const newKey = (formData.get("barcodeApiKey") as string) || "";
  if (newKey) await setAppSetting("barcode.apiKey", newKey);

  revalidatePath("/settings/app");
  return { success: "Barcode lookup settings saved." };
}

export async function saveS3Settings(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

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

  revalidatePath("/settings/app");
  revalidatePath("/settings/backups");
  return { success: "S3 backup settings saved." };
}

export async function saveSftpSettings(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  await setAppSetting("backup.sftp.host", formData.get("sftpHost") as string);
  await setAppSetting("backup.sftp.port", formData.get("sftpPort") as string);
  await setAppSetting("backup.sftp.username", formData.get("sftpUsername") as string);
  await setAppSetting("backup.sftp.remotePath", formData.get("sftpRemotePath") as string);

  const newPassword = (formData.get("sftpPassword") as string) || "";
  if (newPassword) await setAppSetting("backup.sftp.password", newPassword);

  const newKey = (formData.get("sftpPrivateKey") as string) || "";
  if (newKey) await setAppSetting("backup.sftp.privateKey", newKey);

  revalidatePath("/settings/app");
  revalidatePath("/settings/backups");
  return { success: "SFTP backup settings saved." };
}

export async function saveScheduleSettings(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  await setAppSetting("reminder.cron", formData.get("reminderCron") as string);
  await setAppSetting("backup.cron", formData.get("backupCron") as string);
  await setAppSetting("backup.retentionCount", formData.get("retentionCount") as string);
  await setAppSetting("reminder.defaultDays", formData.get("reminderDefaultDays") as string);

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

  await setAppSetting(key, ""); // empty string → deletes the row
  revalidatePath("/settings/app");
  return { success: "Setting cleared." };
}

export async function saveAviationStackSettings(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  const newKey = (formData.get("aviationstackApiKey") as string) || "";
  if (newKey) await setAppSetting("aviationstack.apiKey", newKey);

  revalidatePath("/settings/app");
  return { success: "Flight status settings saved." };
}
