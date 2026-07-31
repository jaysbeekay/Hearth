export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { env, isProduction, isAppUrlSecure, isEncryptionConfigured } = await import(
    "@/lib/env"
  );

  // ENCRYPTION_KEY guards BYOK AI keys, SMTP/ntfy/backup credentials, TOTP
  // secrets and webhook signing secrets. Without it those sit in the database
  // in the clear, and any offsite backup would leave the server unencrypted.
  if (isProduction() && !isEncryptionConfigured()) {
    console.warn(
      "[security] ENCRYPTION_KEY is not set. Integration credentials and TOTP secrets " +
        "will be stored unencrypted, and database backups stay disabled. Generate one " +
        "with: openssl rand -base64 32",
    );
  } else if (isEncryptionConfigured()) {
    // Fail fast on a malformed key rather than at the first decrypt.
    if (Buffer.from(env.encryptionKey, "base64").length !== 32) {
      throw new Error(
        "ENCRYPTION_KEY must be a base64-encoded 32-byte key (openssl rand -base64 32).",
      );
    }

    // Upgrade any webhook secrets stored before a key was configured.
    const { backfillWebhookSecrets } = await import("@/lib/webhookSecret");
    await backfillWebhookSecrets().catch((error) => {
      console.error("[security] webhook secret backfill failed:", error);
    });
  }

  // Hearth holds household documents, credentials and financial data. Served
  // over plain HTTP on anything but loopback or a LAN-only name, every session
  // cookie and document is readable in transit — worth shouting about at boot
  // rather than leaving to be discovered.
  if (isProduction() && !isAppUrlSecure()) {
    console.warn(
      `[security] APP_URL is "${env.appUrl}" — not HTTPS. Session cookies, documents and ` +
        "invitation links will travel in cleartext. Put Hearth behind a reverse proxy with " +
        "TLS, or use a mesh VPN, before exposing it beyond localhost.",
    );
  }

  const globalForCron = globalThis as unknown as {
    __reminderCronStarted?: boolean;
    __backupCronStarted?: boolean;
    __priceCronStarted?: boolean;
  };

  const cron = await import("node-cron");
  const { getReminderConfig, isBackupConfigured, getBackupScheduleConfig } = await import(
    "@/lib/appSettings"
  );

  if (!globalForCron.__reminderCronStarted) {
    globalForCron.__reminderCronStarted = true;

    const { runExpirationCheck } = await import("@/lib/notifications/scheduler");
    const { cron: reminderCron } = await getReminderConfig();
    cron.schedule(reminderCron, () => {
      runExpirationCheck().catch((error) => {
        console.error("[notifications] scheduled expiration check failed:", error);
      });
    });

    console.log(`[notifications] reminder scheduler started (cron: "${reminderCron}")`);
  }

  if (!globalForCron.__backupCronStarted && (await isBackupConfigured())) {
    globalForCron.__backupCronStarted = true;

    const { runBackup } = await import("@/lib/backup/scheduler");
    const { cron: backupCron } = await getBackupScheduleConfig();
    cron.schedule(backupCron, () => {
      runBackup().catch((error) => {
        console.error("[backup] scheduled backup failed:", error);
      });
    });

    console.log(`[backup] scheduler started (cron: "${backupCron}")`);
  }

  if (!globalForCron.__priceCronStarted) {
    globalForCron.__priceCronStarted = true;

    const { refreshAllPortfolioPrices } = await import("@/lib/prices");
    // Every 15 minutes — refreshAllPortfolioPrices skips tickers whose cache is still fresh
    cron.schedule("*/15 * * * *", () => {
      refreshAllPortfolioPrices().catch((error) => {
        console.error("[prices] scheduled refresh failed:", error);
      });
    });

    console.log("[prices] price refresh scheduler started (every 15 min)");
  }
}
