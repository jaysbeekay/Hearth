import { prisma } from "@/lib/prisma";
import { env, isEncryptionConfigured } from "@/lib/env";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

// Keys whose values are encrypted at rest using ENCRYPTION_KEY.
const ENCRYPTED_KEYS = new Set([
  "smtp.password",
  "ntfy.token",
  "barcode.apiKey",
  "backup.s3.secretAccessKey",
  "backup.sftp.password",
  "backup.sftp.privateKey",
  "aviationstack.apiKey",
]);

async function readSetting(key: string): Promise<string | null> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key } });
    if (!row?.value) return null;
    if (row.encrypted) {
      try {
        return decryptSecret(row.value);
      } catch {
        return null;
      }
    }
    return row.value;
  } catch {
    return null;
  }
}

// Reads one setting: DB value takes priority, falls back to `fallback`.
export async function getAppSetting(key: string, fallback = ""): Promise<string> {
  const val = await readSetting(key);
  return val ?? fallback;
}

// Batch-reads multiple settings in a single query.
export async function getAppSettings(
  keys: string[],
  fallbacks: Record<string, string> = {},
): Promise<Record<string, string>> {
  let rows: { key: string; value: string | null; encrypted: boolean }[] = [];
  try {
    rows = await prisma.appSetting.findMany({ where: { key: { in: keys } } });
  } catch {
    // DB unavailable — fall back to env vars
  }
  const map: Record<string, string> = {};
  for (const row of rows) {
    if (!row.value) continue;
    if (row.encrypted) {
      try {
        map[row.key] = decryptSecret(row.value);
      } catch {
        // corrupt — skip
      }
    } else {
      map[row.key] = row.value;
    }
  }
  return Object.fromEntries(keys.map((k) => [k, map[k] ?? fallbacks[k] ?? ""]));
}

// Writes one setting. Empty string deletes the row (reverts to env-var fallback).
export async function setAppSetting(key: string, value: string): Promise<void> {
  if (!value) {
    await prisma.appSetting.deleteMany({ where: { key } });
    return;
  }
  const shouldEncrypt = ENCRYPTED_KEYS.has(key) && isEncryptionConfigured();
  const storedValue = shouldEncrypt ? encryptSecret(value) : value;
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value: storedValue, encrypted: shouldEncrypt },
    update: { value: storedValue, encrypted: shouldEncrypt },
  });
}

// Returns whether a key currently has a value stored in the DB.
export async function isAppSettingSet(key: string): Promise<boolean> {
  const row = await prisma.appSetting.findUnique({ where: { key }, select: { value: true } });
  return Boolean(row?.value);
}

// ─── Typed config getters ─────────────────────────────────────────────────────

export async function getSmtpConfig() {
  const s = await getAppSettings(
    ["smtp.host", "smtp.port", "smtp.secure", "smtp.user", "smtp.password", "smtp.from"],
    {
      "smtp.host": env.smtp.host,
      "smtp.port": String(env.smtp.port),
      "smtp.secure": String(env.smtp.secure),
      "smtp.user": env.smtp.user,
      "smtp.password": env.smtp.pass,
      "smtp.from": env.smtp.from,
    },
  );
  return {
    host: s["smtp.host"],
    port: Number(s["smtp.port"]) || 587,
    secure: s["smtp.secure"] === "true",
    user: s["smtp.user"],
    pass: s["smtp.password"],
    from: s["smtp.from"] || "Hearth <no-reply@localhost>",
  };
}

export async function isSmtpConfigured(): Promise<boolean> {
  const cfg = await getSmtpConfig();
  return Boolean(cfg.host && cfg.user);
}

export async function getNtfyConfig() {
  const s = await getAppSettings(
    ["ntfy.url", "ntfy.topic", "ntfy.token"],
    { "ntfy.url": env.ntfy.url, "ntfy.topic": env.ntfy.topic, "ntfy.token": env.ntfy.token },
  );
  return {
    url: s["ntfy.url"] || "https://ntfy.sh",
    topic: s["ntfy.topic"],
    token: s["ntfy.token"],
  };
}

export async function isNtfyConfigured(): Promise<boolean> {
  const cfg = await getNtfyConfig();
  return Boolean(cfg.url && cfg.topic);
}

export async function getOllamaConfig() {
  const s = await getAppSettings(
    ["ollama.baseUrl", "ollama.model"],
    { "ollama.baseUrl": env.ollama.baseUrl, "ollama.model": env.ollama.model },
  );
  return { baseUrl: s["ollama.baseUrl"], model: s["ollama.model"] };
}

export async function isOllamaConfigured(): Promise<boolean> {
  const cfg = await getOllamaConfig();
  return Boolean(cfg.baseUrl && cfg.model);
}

export async function getBarcodeConfig() {
  const s = await getAppSettings(
    ["barcode.enabled", "barcode.apiKey"],
    {
      "barcode.enabled": String(env.barcodeLookup.enabled),
      "barcode.apiKey": env.barcodeLookup.apiKey,
    },
  );
  return { enabled: s["barcode.enabled"] === "true", apiKey: s["barcode.apiKey"] };
}

export async function isBarcodeLookupConfigured(): Promise<boolean> {
  const cfg = await getBarcodeConfig();
  return cfg.enabled;
}

export async function getS3Config() {
  const s = await getAppSettings(
    [
      "backup.s3.endpoint",
      "backup.s3.region",
      "backup.s3.bucket",
      "backup.s3.accessKeyId",
      "backup.s3.secretAccessKey",
      "backup.s3.forcePathStyle",
    ],
    {
      "backup.s3.endpoint": env.backup.s3.endpoint,
      "backup.s3.region": env.backup.s3.region,
      "backup.s3.bucket": env.backup.s3.bucket,
      "backup.s3.accessKeyId": env.backup.s3.accessKeyId,
      "backup.s3.secretAccessKey": env.backup.s3.secretAccessKey,
      "backup.s3.forcePathStyle": String(env.backup.s3.forcePathStyle),
    },
  );
  return {
    endpoint: s["backup.s3.endpoint"],
    region: s["backup.s3.region"] || "auto",
    bucket: s["backup.s3.bucket"],
    accessKeyId: s["backup.s3.accessKeyId"],
    secretAccessKey: s["backup.s3.secretAccessKey"],
    forcePathStyle: s["backup.s3.forcePathStyle"] === "true",
  };
}

export async function isS3BackupConfigured(): Promise<boolean> {
  const cfg = await getS3Config();
  return Boolean(cfg.bucket && cfg.accessKeyId && cfg.secretAccessKey);
}

export async function getSftpConfig() {
  const s = await getAppSettings(
    [
      "backup.sftp.host",
      "backup.sftp.port",
      "backup.sftp.username",
      "backup.sftp.password",
      "backup.sftp.privateKey",
      "backup.sftp.remotePath",
    ],
    {
      "backup.sftp.host": env.backup.sftp.host,
      "backup.sftp.port": String(env.backup.sftp.port),
      "backup.sftp.username": env.backup.sftp.username,
      "backup.sftp.password": env.backup.sftp.password,
      "backup.sftp.privateKey": env.backup.sftp.privateKey,
      "backup.sftp.remotePath": env.backup.sftp.remotePath,
    },
  );
  return {
    host: s["backup.sftp.host"],
    port: Number(s["backup.sftp.port"]) || 22,
    username: s["backup.sftp.username"],
    password: s["backup.sftp.password"],
    privateKey: s["backup.sftp.privateKey"],
    remotePath: s["backup.sftp.remotePath"] || "/backups",
  };
}

export async function isSftpBackupConfigured(): Promise<boolean> {
  const cfg = await getSftpConfig();
  return Boolean(cfg.host && cfg.username && (cfg.password || cfg.privateKey));
}

export async function getBackupScheduleConfig() {
  const s = await getAppSettings(
    ["backup.cron", "backup.retentionCount"],
    {
      "backup.cron": env.backup.cron,
      "backup.retentionCount": String(env.backup.retentionCount),
    },
  );
  return {
    cron: s["backup.cron"] || "0 3 * * *",
    retentionCount: Number(s["backup.retentionCount"]) || 7,
  };
}

export async function getReminderConfig() {
  const s = await getAppSettings(
    ["reminder.cron", "reminder.defaultDays"],
    { "reminder.cron": env.reminderCron, "reminder.defaultDays": env.reminderDefaultDays },
  );
  return {
    cron: s["reminder.cron"] || "0 8 * * *",
    defaultDays: s["reminder.defaultDays"] || "30,14,7,1",
  };
}

export async function getAviationStackConfig() {
  const apiKey = await readSetting("aviationstack.apiKey") ?? "";
  return { apiKey };
}

export async function isAviationStackConfigured(): Promise<boolean> {
  const { apiKey } = await getAviationStackConfig();
  return Boolean(apiKey);
}

export async function isBackupConfigured(): Promise<boolean> {
  return isEncryptionConfigured() && (await isS3BackupConfigured() || await isSftpBackupConfigured());
}
