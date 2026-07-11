import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";

const WEBHOOK_TIMEOUT_MS = 10_000;

type Endpoint = { id: string; url: string; secret: string | null };

function sign(secret: string, body: string) {
  return `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
}

async function deliver(endpoint: Endpoint, event: string, body: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Webhook-Event": event,
  };
  if (endpoint.secret) headers["X-Webhook-Signature"] = sign(endpoint.secret, body);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

  let success = false;
  let statusCode: number | null = null;
  let message: string | null = null;

  try {
    const res = await fetch(endpoint.url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });
    statusCode = res.status;
    success = res.ok;
    if (!success) message = `HTTP ${res.status}`;
  } catch (error) {
    message = error instanceof Error ? error.message : "Request failed";
  } finally {
    clearTimeout(timeout);
  }

  await prisma.webhookLog.create({
    data: { endpointId: endpoint.id, event, success, statusCode, message },
  });

  return success;
}

export async function getEnabledWebhookEndpoints() {
  return prisma.webhookEndpoint.findMany({ where: { enabled: true } });
}

export async function sendExpiryWebhooks(opts: {
  kind: "contract" | "warranty";
  id: string;
  title: string;
  detail: string;
  daysRemaining: number;
  endDate: Date;
}) {
  const endpoints = await getEnabledWebhookEndpoints();
  if (endpoints.length === 0) return;

  const event = opts.kind === "contract" ? "contract.expiring" : "warranty.expiring";
  const body = JSON.stringify({
    event,
    kind: opts.kind,
    id: opts.id,
    title: opts.title,
    detail: opts.detail,
    daysRemaining: opts.daysRemaining,
    endDate: opts.endDate.toISOString().slice(0, 10),
    url: `${env.appUrl.replace(/\/$/, "")}/${opts.kind === "contract" ? "contracts" : "products"}/${opts.id}`,
  });

  const results = await Promise.all(endpoints.map((endpoint) => deliver(endpoint, event, body)));
  if (results.some((ok) => !ok)) {
    throw new Error("one or more webhook deliveries failed");
  }
}

export async function sendTestWebhook(endpoint: Endpoint) {
  const body = JSON.stringify({
    event: "webhook.test",
    message: "This is a test notification from Hearth.",
    sentAt: new Date().toISOString(),
  });
  return deliver(endpoint, "webhook.test", body);
}
