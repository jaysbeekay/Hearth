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

  // #250 — each of reminders/backups/email-ingest used to get its own
  // cron.schedule(actualCronString, runDirectly) registered once at boot,
  // with the schedule string baked in from whatever Settings said at that
  // moment: changing it later, or enabling/disabling backups or email
  // ingestion, needed a restart to take effect. Nothing stopped two
  // instances of the app running the same job concurrently either — there
  // was no lease, just whichever process's timer fired.
  //
  // Both problems share one fix: instead of registering a schedule at boot,
  // check every minute whether each job's *currently configured* schedule
  // matches right now (cron.createTask(...).match() — doesn't start a real
  // timer, just evaluates the pattern against a date), and if so enqueue it
  // onto the same DB-leased BackgroundJob queue price refresh and OCR
  // already use (src/lib/jobs/runner.ts) — one enqueue per due job, guarded
  // against a previous run of the same type still being PENDING/RUNNING.
  // The lease in claimJob() is what actually prevents two instances from
  // running the same job at once; this loop only decides when to ask.
  const globalForCron = globalThis as unknown as {
    __jobTickerStarted?: boolean;
    __jobProcessorStarted?: boolean;
  };

  const cron = await import("node-cron");
  const { enqueueJobUnlessPending, runPendingJobs } = await import("@/lib/jobs/runner");
  const { cronDue } = await import("@/lib/jobs/cronDue");

  if (!globalForCron.__jobTickerStarted) {
    globalForCron.__jobTickerStarted = true;

    cron.schedule("* * * * *", async () => {
      try {
        const {
          getReminderConfig,
          isBackupConfigured,
          getBackupScheduleConfig,
          isEmailIngestionConfigured,
          getEmailIngestConfig,
        } = await import("@/lib/appSettings");
        const now = new Date();

        const { cron: reminderCron } = await getReminderConfig();
        if (cronDue(reminderCron, now)) await enqueueJobUnlessPending("REMINDER_CHECK");

        if (await isBackupConfigured()) {
          const { cron: backupCron } = await getBackupScheduleConfig();
          if (cronDue(backupCron, now)) await enqueueJobUnlessPending("BACKUP_RUN");
        }

        if (await isEmailIngestionConfigured()) {
          const { cron: emailIngestCron } = await getEmailIngestConfig();
          if (cronDue(emailIngestCron, now)) await enqueueJobUnlessPending("EMAIL_INGEST");
        }

        // Not user-configurable, so this could stay a fixed cron.schedule of
        // its own — folded in here anyway so every scheduled job goes
        // through the exact same enqueue path.
        if (cronDue("*/15 * * * *", now)) await enqueueJobUnlessPending("PRICE_REFRESH");
      } catch (error) {
        console.error("[jobs] scheduled-job ticker failed:", error);
      }
    });

    console.log("[jobs] scheduled-job ticker started (checks every minute)");
  }

  if (!globalForCron.__jobProcessorStarted) {
    globalForCron.__jobProcessorStarted = true;

    // The other half of "manual/API and scheduled triggers share the same
    // lease and execution path" (#250's acceptance criteria): POST /api/cron
    // already calls runPendingJobs() directly, but until now nothing called
    // it on its own — a household with no external cron hitting that
    // endpoint would have queued jobs (enqueueJobUnlessPending above,
    // or the existing price-refresh/OCR queuing) sit PENDING forever.
    cron.schedule("*/20 * * * * *", () => {
      runPendingJobs().catch((error) => {
        console.error("[jobs] scheduled job processing failed:", error);
      });
    });

    console.log("[jobs] job processor started (checks every 20s)");
  }
}
