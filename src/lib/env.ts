function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const env = {
  appUrl: optional("APP_URL", "http://localhost:3000"),
  uploadsDir: optional("UPLOADS_DIR", "./data/uploads"),
  reminderDefaultDays: optional("REMINDER_DEFAULT_DAYS", "30,14,7,1"),
  reminderCron: optional("REMINDER_CRON_SCHEDULE", "0 8 * * *"),
  smtp: {
    host: optional("SMTP_HOST"),
    port: Number(optional("SMTP_PORT", "587")),
    secure: optional("SMTP_SECURE", "false") === "true",
    user: optional("SMTP_USER"),
    pass: optional("SMTP_PASSWORD"),
    from: optional("SMTP_FROM", "Hearth <no-reply@localhost>"),
  },
  ntfy: {
    url: optional("NTFY_URL", "https://ntfy.sh"),
    topic: optional("NTFY_TOPIC"),
    token: optional("NTFY_TOKEN"),
  },
  ollama: {
    baseUrl: optional("OLLAMA_BASE_URL"),
    model: optional("OLLAMA_MODEL"),
  },
  barcodeLookup: {
    enabled: optional("BARCODE_LOOKUP_ENABLED", "false") === "true",
    apiKey: optional("BARCODE_LOOKUP_API_KEY"),
  },
  encryptionKey: optional("ENCRYPTION_KEY"),
  demoMode: optional("DEMO_MODE", "false") === "true",
  backup: {
    cron: optional("BACKUP_CRON_SCHEDULE", "0 3 * * *"),
    retentionCount: Number(optional("BACKUP_RETENTION_COUNT", "7")),
    s3: {
      endpoint: optional("BACKUP_S3_ENDPOINT"),
      region: optional("BACKUP_S3_REGION", "auto"),
      bucket: optional("BACKUP_S3_BUCKET"),
      accessKeyId: optional("BACKUP_S3_ACCESS_KEY_ID"),
      secretAccessKey: optional("BACKUP_S3_SECRET_ACCESS_KEY"),
      forcePathStyle: optional("BACKUP_S3_FORCE_PATH_STYLE", "false") === "true",
    },
    sftp: {
      host: optional("BACKUP_SFTP_HOST"),
      port: Number(optional("BACKUP_SFTP_PORT", "22")),
      username: optional("BACKUP_SFTP_USERNAME"),
      password: optional("BACKUP_SFTP_PASSWORD"),
      privateKey: optional("BACKUP_SFTP_PRIVATE_KEY"),
      remotePath: optional("BACKUP_SFTP_REMOTE_PATH", "/backups"),
    },
  },
};

export const isEmailConfigured = () => Boolean(env.smtp.host && env.smtp.user);
export const isNtfyConfigured = () => Boolean(env.ntfy.url && env.ntfy.topic);
export const isOllamaConfigured = () => Boolean(env.ollama.baseUrl && env.ollama.model);
export const isBarcodeLookupConfigured = () => env.barcodeLookup.enabled;
export const isEncryptionConfigured = () => env.encryptionKey.length > 0;
export const isDemoMode = () => env.demoMode;

export const isS3BackupConfigured = () =>
  Boolean(env.backup.s3.bucket && env.backup.s3.accessKeyId && env.backup.s3.secretAccessKey);
export const isSftpBackupConfigured = () =>
  Boolean(
    env.backup.sftp.host &&
      env.backup.sftp.username &&
      (env.backup.sftp.password || env.backup.sftp.privateKey),
  );
// Backups are only enabled once ENCRYPTION_KEY is set, so an offsite backup
// can never leave the server unencrypted.
export const isBackupConfigured = () =>
  isEncryptionConfigured() && (isS3BackupConfigured() || isSftpBackupConfigured());
