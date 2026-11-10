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
  const { enqueueJobUnlessPending, createJobTick } = await import("@/lib/jobs/runner");
  const { queueOwedScheduledJobs } = await import("@/lib/jobs/owed");
  const { JOB_PRIORITY } = await import("@/lib/jobs/priority");

  // #481 — for an install that triggers its scheduled jobs from outside
  // (POST /api/cron): the in-process ticker stays off. The job processor
  // below still runs, to work through whatever those calls queue (including
  // the document text backfill, which each call queues when it's due).
  const tickerEnabled = process.env.DISABLE_INTERNAL_SCHEDULER?.toLowerCase() !== "true";
  if (!tickerEnabled) {
    console.log("[jobs] DISABLE_INTERNAL_SCHEDULER is set; scheduled jobs run only from POST /api/cron");
  }

  if (tickerEnabled && !globalForCron.__jobTickerStarted) {
    globalForCron.__jobTickerStarted = true;

    // #398 — the document text backfill: once at startup, so an upgrade
    // starts catching up straight away, then hourly in its own try, so a
    // server that sleeps at night still gets to it and a failure in the
    // other steps never skips it. Once nothing is left each run is one quick
    // look; while Documents are waiting it queues its own next batch. It's a
    // singleton, so a run already queued makes these a no-op.
    const enqueueBackfill = () =>
      enqueueJobUnlessPending("DOCUMENT_TEXT_BACKFILL", {}, { priority: JOB_PRIORITY.BACKGROUND }).catch((error: unknown) => {
        console.error("[jobs] couldn't queue the document text backfill:", error);
      });
    void enqueueBackfill();

    // What's owed is decided in queueOwedScheduledJobs, which POST /api/cron
    // calls too (#481), so the two can't drift apart.
    cron.schedule("* * * * *", async () => {
      try {
        await queueOwedScheduledJobs();
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
    //
    // #432 — createJobTick skips a tick while the previous one is still
    // running (for up to the job lease), so ticks don't pile up behind a
    // slow database, and logs a failed run.
    const tick = createJobTick();
    cron.schedule("*/20 * * * * *", () => {
      void tick();
    });

    console.log("[jobs] job processor started (checks every 20s)");
  }
}
