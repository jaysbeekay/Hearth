import { prisma } from "@/lib/prisma";
import { refreshAllPortfolioPrices } from "@/lib/prices";
import { extractSearchableText } from "@/lib/documents/textExtraction";
import { readDocument, readProductDocument, readInboxDocument } from "@/lib/storage";

export type JobType = "PRICE_REFRESH" | "OCR_DOCUMENT";
const LEASE_MS = 5 * 60_000;
const MAX_ATTEMPTS = 3;

export async function enqueueJob(type: JobType, payload: Record<string, unknown> = {}) {
  return prisma.backgroundJob.create({ data: { type, payload: JSON.stringify(payload) } });
}

async function claimJob() {
  const now = new Date();
  const candidate = await prisma.backgroundJob.findFirst({
    where: { OR: [{ status: "PENDING", availableAt: { lte: now } }, { status: "RUNNING", leasedUntil: { lt: now } }], attempts: { lt: MAX_ATTEMPTS } },
    orderBy: { createdAt: "asc" },
  });
  if (!candidate) return null;
  const leasedUntil = new Date(now.getTime() + LEASE_MS);
  const result = await prisma.backgroundJob.updateMany({
    where: { id: candidate.id, OR: [{ status: "PENDING" }, { status: "RUNNING", leasedUntil: { lt: now } }] },
    data: { status: "RUNNING", attempts: { increment: 1 }, leasedUntil, startedAt: now },
  });
  return result.count === 1 ? { ...candidate, leasedUntil } : null;
}

export async function runOneJob() {
  const job = await claimJob();
  if (!job) return false;
  try {
    if (job.type === "PRICE_REFRESH") await refreshAllPortfolioPrices();
    else if (job.type === "OCR_DOCUMENT") await processOcr(JSON.parse(job.payload));
    else throw new Error(`Unsupported job type: ${job.type}`);
    await prisma.backgroundJob.update({ where: { id: job.id }, data: { status: "DONE", finishedAt: new Date(), leasedUntil: null } });
  } catch (error) {
    await prisma.backgroundJob.update({ where: { id: job.id }, data: { status: job.attempts + 1 >= MAX_ATTEMPTS ? "FAILED" : "PENDING", availableAt: new Date(Date.now() + 30_000), leasedUntil: null, lastError: error instanceof Error ? error.message : "Unknown error" } });
  }
  return true;
}

async function processOcr(payload: { kind: "contract" | "product" | "inbox"; id: string; ownerId?: string; storedName: string; mimeType: string }) {
  const buffer = payload.kind === "contract" ? await readDocument(payload.ownerId!, payload.storedName) : payload.kind === "product" ? await readProductDocument(payload.ownerId!, payload.storedName) : await readInboxDocument(payload.storedName);
  const text = await extractSearchableText(buffer, payload.mimeType);
  if (payload.kind === "contract") await prisma.document.update({ where: { id: payload.id }, data: { extractedText: text, extractionStatus: text ? "COMPLETED" : "FAILED" } });
  else if (payload.kind === "product") await prisma.productDocument.update({ where: { id: payload.id }, data: { extractedText: text, extractionStatus: text ? "COMPLETED" : "FAILED" } });
  else await prisma.inboxDocument.update({ where: { id: payload.id }, data: { extractedText: text, extractionStatus: text ? "COMPLETED" : "FAILED" } });
}

export async function runPendingJobs(limit = 4) {
  for (let i = 0; i < limit; i += 1) {
    if (!(await runOneJob())) break;
  }
}
