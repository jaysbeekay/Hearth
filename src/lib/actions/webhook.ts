"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { encodeWebhookSecret } from "@/lib/webhookSecret";
import { auth } from "@/lib/auth";
import { webhookEndpointSchema } from "@/lib/validation/webhook";
import { sendTestWebhook } from "@/lib/notifications/webhook";
import { formDataToStringValues } from "@/lib/form-state";
import { assertSafeOutboundUrl, UnsafeOutboundUrlError } from "@/lib/net/outbound";
import type { ActionState } from "@/lib/actions/auth";

// Secret is intentionally excluded — never echo it back to the form.
const WEBHOOK_FORM_FIELDS = ["name", "url"];

export async function createWebhookEndpoint(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await auth();
  if (session?.user.role !== "ADMIN") {
    return { error: "Only admins can add webhook endpoints." };
  }

  const parsed = webhookEndpointSchema.safeParse({
    name: formData.get("name"),
    url: formData.get("url"),
    secret: formData.get("secret") || undefined,
  });
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Invalid input",
      values: formDataToStringValues(formData, WEBHOOK_FORM_FIELDS),
    };
  }

  // Catches the two things that are never valid — a non-HTTP(S) scheme and a
  // cloud metadata address — as an explainable form error rather than a
  // delivery that quietly fails later. A host that simply isn't resolvable
  // right now is fine to save: the target service may be offline, or be a
  // .local name this container can't resolve. Delivery re-checks anyway.
  try {
    await assertSafeOutboundUrl(parsed.data.url);
  } catch (error) {
    if (error instanceof UnsafeOutboundUrlError) {
      return {
        error: error.message,
        values: formDataToStringValues(formData, WEBHOOK_FORM_FIELDS),
      };
    }
    throw error;
  }

  await prisma.webhookEndpoint.create({
    data: {
      name: parsed.data.name,
      url: parsed.data.url,
      ...encodeWebhookSecret(parsed.data.secret ?? null),
      createdById: session.user.id,
    },
  });

  revalidatePath("/settings/webhooks");
  return { success: `${parsed.data.name} was added.` };
}

export async function deleteWebhookEndpoint(endpointId: string): Promise<ActionState> {
  const session = await auth();
  if (session?.user.role !== "ADMIN") {
    return { error: "Only admins can remove webhook endpoints." };
  }

  await prisma.webhookEndpoint.delete({ where: { id: endpointId } });
  revalidatePath("/settings/webhooks");
  return { success: "Webhook removed." };
}

export async function toggleWebhookEndpoint(endpointId: string, enabled: boolean): Promise<ActionState> {
  const session = await auth();
  if (session?.user.role !== "ADMIN") {
    return { error: "Only admins can change webhook endpoints." };
  }

  await prisma.webhookEndpoint.update({ where: { id: endpointId }, data: { enabled } });
  revalidatePath("/settings/webhooks");
  return { success: enabled ? "Webhook enabled." : "Webhook disabled." };
}

export async function sendTestWebhookAction(endpointId: string): Promise<ActionState> {
  const session = await auth();
  if (session?.user.role !== "ADMIN") {
    return { error: "Only admins can test webhook endpoints." };
  }

  const endpoint = await prisma.webhookEndpoint.findUnique({ where: { id: endpointId } });
  if (!endpoint) return { error: "Webhook not found." };

  const success = await sendTestWebhook(endpoint);
  revalidatePath("/settings/webhooks");
  return success
    ? { success: "Test webhook delivered." }
    : { error: "Test webhook failed — check the recent deliveries log below." };
}
