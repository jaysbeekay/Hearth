import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CreateWebhookForm } from "@/components/CreateWebhookForm";
import { WebhookActions } from "@/components/WebhookActions";
import { formatDate } from "@/lib/utils";
import { getUserPreferences } from "@/lib/userPreferences";

export const metadata: Metadata = { title: "Webhooks" };

export default async function WebhooksPage() {
  const session = await auth();
  if (session?.user.role !== "ADMIN") {
    redirect("/settings");
  }

  const [endpoints, logs, { dateFormat }] = await Promise.all([
    prisma.webhookEndpoint.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.webhookLog.findMany({
      orderBy: { sentAt: "desc" },
      take: 10,
      include: { endpoint: { select: { name: true } } },
    }),
    getUserPreferences(),
  ]);

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">Webhooks</h1>
      <p className="text-sm text-foreground/60">
        Notify other platforms (e.g. Home Assistant, or an MCP agent like Hermes) when a
        contract or product warranty is approaching expiry. Each endpoint receives the same
        reminders as email/push, at the thresholds set on each contract or product.
      </p>

      <section className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <h2 className="mb-3 font-medium">Endpoints</h2>
        {endpoints.length === 0 ? (
          <p className="text-sm text-foreground/60">No webhook endpoints configured yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {endpoints.map((endpoint) => (
              <li key={endpoint.id} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {endpoint.name}{" "}
                    <span className={endpoint.enabled ? "text-success" : "text-foreground/50"}>
                      · {endpoint.enabled ? "Enabled" : "Disabled"}
                    </span>
                  </p>
                  <p className="truncate text-xs text-foreground/50">{endpoint.url}</p>
                </div>
                <WebhookActions
                  endpointId={endpoint.id}
                  enabled={endpoint.enabled}
                  name={endpoint.name}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <h2 className="mb-3 font-medium">Add a webhook endpoint</h2>
        <CreateWebhookForm />
      </section>

      <section className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <h2 className="mb-3 font-medium">Recent deliveries</h2>
        {logs.length === 0 ? (
          <p className="text-sm text-foreground/60">No deliveries yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {logs.map((log) => (
              <li key={log.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                <div>
                  <p className="font-medium">
                    {log.endpoint.name} · {log.event}{" "}
                    <span className={log.success ? "text-success" : "text-danger"}>
                      · {log.success ? "OK" : "Failed"}
                    </span>
                  </p>
                  <p className="text-xs text-foreground/50">
                    {formatDate(log.sentAt, dateFormat)}
                    {log.statusCode ? ` · HTTP ${log.statusCode}` : ""}
                    {log.message ? ` · ${log.message}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
