import { prisma } from "@/lib/prisma";
import { isModuleEnabled } from "@/lib/modules/enablement";
import { JOB_PRIORITY } from "@/lib/jobs/priority";
import { enqueueJobUnlessPending, queueScheduledJob, type JobType } from "@/lib/jobs/runner";

/** A price refresh is owed once the last one was queued this long ago. */
const PRICE_REFRESH_EVERY_MS = 15 * 60_000;

/**
 * #481 — one place that decides which scheduled jobs are owed right now and
 * queues them. The in-process ticker (src/instrumentation.ts) calls it every
 * minute and POST /api/cron calls it on each external trigger, so the two
 * can't drift apart. It only enqueues; the job runner's lease runs each job.
 * Each type is a singleton while pending, so two callers at once (two
 * processes, a tick and a request) queue it once.
 *
 * Returns the types this call queued.
 */
export async function queueOwedScheduledJobs(now: Date = new Date()): Promise<JobType[]> {
  const queued: JobType[] = [];
  const note = (type: JobType, job: unknown) => {
    if (job) queued.push(type);
  };

  try {
    // Like the jobs below, a backfill hour the server slept through still runs.
    note(
      "DOCUMENT_TEXT_BACKFILL",
      await queueScheduledJob("DOCUMENT_TEXT_BACKFILL", "17 * * * *", now, { priority: JOB_PRIORITY.BACKGROUND }),
    );
  } catch (error) {
    console.error("[jobs] couldn't queue the document text backfill:", error);
  }

  try {
    const {
      getReminderConfig,
      isBackupConfigured,
      getBackupScheduleConfig,
      isEmailIngestionConfigured,
      getEmailIngestConfig,
      settingsSavedAt,
    } = await import("@/lib/appSettings");
    // Reminders, backups and email ingestion run when their schedule's next
    // time after their last run has come, not only inside the scheduled
    // second: node-cron skips a tick the process was asleep or blocked for,
    // which used to lose that day's Reminder check. A schedule starts no
    // earlier than its settings' last save, so an edit or switching a job
    // back on doesn't run it straight away.
    const owed = async (type: "REMINDER_CHECK" | "BACKUP_RUN" | "EMAIL_INGEST", pattern: string, settingsPrefix: string) => {
      note(type, await queueScheduledJob(type, pattern, now, { savedAt: await settingsSavedAt(settingsPrefix) }));
    };

    const { cron: reminderCron } = await getReminderConfig();
    await owed("REMINDER_CHECK", reminderCron, "reminder.");

    if (await isBackupConfigured()) {
      const { cron: backupCron } = await getBackupScheduleConfig();
      await owed("BACKUP_RUN", backupCron, "backup.");
    }

    if (await isEmailIngestionConfigured()) {
      const { cron: emailIngestCron } = await getEmailIngestConfig();
      await owed("EMAIL_INGEST", emailIngestCron, "emailIngest.");
    }

    // Not user-configurable, and only worth running for a household that has
    // Wealth on. Owed by age rather than by a cron minute, so a missed
    // minute is caught up on the next check. A failed run counts too: it's
    // tried again after the same interval.
    if (await isModuleEnabled("WEALTH")) {
      const last = await prisma.backgroundJob.findFirst({
        // A run stamped while the clock was ahead mustn't hold every run off.
        where: { type: "PRICE_REFRESH", createdAt: { lte: now } },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      if (!last || now.getTime() - last.createdAt.getTime() >= PRICE_REFRESH_EVERY_MS) {
        note("PRICE_REFRESH", await enqueueJobUnlessPending("PRICE_REFRESH"));
      }
    }
  } catch (error) {
    console.error("[jobs] scheduled-job check failed:", error);
  }

  return queued;
}
