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
  aiEgressProxy: {
    url: optional("AI_EGRESS_PROXY_URL"),
  },
  emailIngest: {
    host: optional("EMAIL_INGEST_HOST"),
    port: Number(optional("EMAIL_INGEST_PORT", "993")),
    secure: optional("EMAIL_INGEST_SECURE", "true") === "true",
    user: optional("EMAIL_INGEST_USER"),
    pass: optional("EMAIL_INGEST_PASSWORD"),
    mailbox: optional("EMAIL_INGEST_MAILBOX", "INBOX"),
    cron: optional("EMAIL_INGEST_CRON_SCHEDULE", "*/10 * * * *"),
  },
  barcodeLookup: {
    enabled: optional("BARCODE_LOOKUP_ENABLED", "false") === "true",
    apiKey: optional("BARCODE_LOOKUP_API_KEY"),
  },
  encryptionKey: optional("ENCRYPTION_KEY"),
  setupToken: optional("SETUP_TOKEN"),
  github: {
    clientId: optional("GITHUB_CLIENT_ID"),
    clientSecret: optional("GITHUB_CLIENT_SECRET"),
  },
  githubFeedback: {
    token: optional("GITHUB_FEEDBACK_TOKEN"),
    repository: optional("GITHUB_FEEDBACK_REPOSITORY"),
  },
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
    local: {
      path: optional("BACKUP_LOCAL_PATH"),
    },
  },
};

export const isProduction = () => process.env.NODE_ENV === "production";

// Loopback and LAN-only names are the one place plain HTTP is defensible — the
// traffic never crosses an untrusted network. Anything else carrying session
// cookies and household documents needs TLS.
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

export function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    LOCAL_HOSTNAMES.has(host) || host.endsWith(".local") || host.endsWith(".home.arpa")
  );
}

// True when APP_URL is safe to hand out in emails, invitation links, WebAuthn
// relying-party config and iCal URLs — i.e. HTTPS, or plain HTTP somewhere the
// traffic can't be intercepted.
export const isAppUrlSecure = () => {
  try {
    const parsed = new URL(env.appUrl);
    return parsed.protocol === "https:" || isLocalHostname(parsed.hostname);
  } catch {
    return false;
  }
};

export const isEmailConfigured = () => Boolean(env.smtp.host && env.smtp.user);
export const isNtfyConfigured = () => Boolean(env.ntfy.url && env.ntfy.topic);
export const isOllamaConfigured = () => Boolean(env.ollama.baseUrl && env.ollama.model);
// Routes outbound AI-provider calls (document extraction + chat assistant)
// through a local agent-firewall proxy — e.g. Pipelock — instead of calling
// the provider directly. See "Routing AI traffic through an agent firewall"
// in the README.
export const isAiEgressProxyConfigured = () => env.aiEgressProxy.url.length > 0;
export const isBarcodeLookupConfigured = () => env.barcodeLookup.enabled;
export const isEncryptionConfigured = () => env.encryptionKey.length > 0;
// When set, first-run setup additionally requires this token, so a server that
// is reachable before anyone has registered can't be claimed by a passer-by.
export const isSetupTokenRequired = () => env.setupToken.length > 0;
export const isGithubOAuthConfigured = () =>
  Boolean(env.github.clientId && env.github.clientSecret);

export const isGithubFeedbackConfigured = () =>
  Boolean(
    env.githubFeedback.token &&
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.githubFeedback.repository),
  );

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
