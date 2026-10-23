import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { decodeWebhookSecret } from "@/lib/webhookSecret";
import { assertSafeOutboundUrl, UnsafeOutboundUrlError } from "@/lib/net/outbound";
import { buildReminderWebhookBody, type ReminderInput } from "@/lib/notifications/reminderContent";

const WEBHOOK_TIMEOUT_MS = 10_000;

type Endpoint = { id: string; url: string; secret: string | null; secretEncrypted: boolean };

function sign(secret: string, body: string) {
  return `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
}

async function deliver(endpoint: Endpoint, event: string, body: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Webhook-Event": event,
  };
  const secret = decodeWebhookSecret(endpoint);
  if (secret) headers["X-Webhook-Signature"] = sign(secret, body);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

  let success = false;
  let statusCode: number | null = null;
  let message: string | null = null;

  try {
    // Re-checked at delivery time, not just when the endpoint was saved: the
    // hostname's DNS answer can change after the fact.
    await assertSafeOutboundUrl(endpoint.url);

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
    message =
      error instanceof UnsafeOutboundUrlError
        ? `Refused to deliver: ${error.message}`
        : error instanceof Error
          ? error.message
          : "Request failed";
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

export async function sendExpiryWebhooks(input: ReminderInput) {
  const endpoints = await getEnabledWebhookEndpoints();
  if (endpoints.length === 0) return;

  // #352 — vehicles get their own `vehicle.expiring` event and /vehicles
  // link (they used to go out as `contract.expiring` with a /contracts URL),
  // and `url` is null rather than a localhost guess when APP_URL is unset.
  const payload = buildReminderWebhookBody(input);
  const event = String(payload.event);
  const body = JSON.stringify(payload);

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
