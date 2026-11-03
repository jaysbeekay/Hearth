import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getBarcodeConfig, isAppSettingSet } from "@/lib/appSettings";
import { saveBarcodeSettings, saveAviationStackSettings } from "@/lib/actions/app-settings";
import { BarcodeForm, AviationStackForm } from "@/components/AppSettingsForms";
import { CreateWebhookForm } from "@/components/CreateWebhookForm";
import { WebhookActions } from "@/components/WebhookActions";
import { SaveChangesGroup } from "@/components/SaveChangesGroup";
import { formatTimestamp } from "@/lib/utils";
import { getUserPreferences } from "@/lib/userPreferences";
import { BackLink } from "@/components/BackLink";
import { SETTINGS_ROUTES, settingsBackLink } from "@/lib/routeLabels";
import { Card } from "@/components/ui/Card";
import { PageShell } from "@/components/ui/PageShell";
import { inlineLinkClass } from "@/lib/ui";

export const metadata: Metadata = { title: SETTINGS_ROUTES.integrations.label };

// #363 — outside services Hearth talks to: barcode and flight lookups (from
// the old System settings page) and outbound webhooks (the old Webhooks page).
export default async function IntegrationsSettingsPage() {
  const session = await auth();
  if (session?.user.role !== "ADMIN") redirect("/settings");

  const [barcode, barcodeApiKeyIsSet, aviationKeyIsSet, endpoints, logs, { dateFormat, displayTimeZone }] =
    await Promise.all([
      getBarcodeConfig(),
      isAppSettingSet("barcode.apiKey"),
      isAppSettingSet("aviationstack.apiKey"),
      prisma.webhookEndpoint.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.webhookLog.findMany({
        orderBy: { sentAt: "desc" },
        take: 10,
        include: { endpoint: { select: { name: true } } },
      }),
      getUserPreferences(),
    ]);

  return (
    <PageShell width="form">
      <div>
        <BackLink {...settingsBackLink(SETTINGS_ROUTES.integrations)} />
        <h1 className="text-2xl font-medium">{SETTINGS_ROUTES.integrations.label}</h1>
        <p className="mt-1 text-sm text-muted">Outside services Hearth can look things up in or notify.</p>
      </div>

      <SaveChangesGroup>
        <Card as="section" className="space-y-4">
          <div>
            <h2 className="font-medium">Barcode lookup</h2>
            <p className="text-xs text-muted mt-0.5">Looks up a scanned barcode when adding a warranty</p>
          </div>
          <BarcodeForm
            action={saveBarcodeSettings}
            current={{ enabled: barcode.enabled, apiKeyIsSet: barcodeApiKeyIsSet }}
          />
        </Card>

        <Card as="section" className="space-y-4">
          <div>
            <h2 className="font-medium">Flight status (AviationStack)</h2>
            <p className="text-xs text-muted mt-0.5">
              Real-time flight status, gate, and delay data for Travel module flights.{" "}
              <a
                href="https://aviationstack.com/signup/free"
                target="_blank"
                rel="noopener noreferrer"
                className={inlineLinkClass}
              >
                Get a free API key at aviationstack.com
              </a>
            </p>
          </div>
          <AviationStackForm action={saveAviationStackSettings} isKeySet={aviationKeyIsSet} />
        </Card>
      </SaveChangesGroup>

      <section className="space-y-4">
        <div>
          <h2 className="font-medium">Webhooks</h2>
          <p className="mt-0.5 text-sm text-muted">
            Notify other platforms (e.g. Home Assistant, or an MCP agent like Hermes) when a
            contract or warranty is coming due. Each endpoint receives the same reminders as
            email/push, at the reminder thresholds set on each contract or warranty.
          </p>
        </div>

        <Card as="section">
          <h3 className="mb-3 font-medium">Endpoints</h3>
          {endpoints.length === 0 ? (
            <p className="text-sm text-muted">No webhook endpoints configured yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {endpoints.map((endpoint) => (
                <li key={endpoint.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {endpoint.name}{" "}
                      <span className={endpoint.enabled ? "text-success" : "text-muted"}>
                        · {endpoint.enabled ? "Enabled" : "Disabled"}
                      </span>
                    </p>
                    <p className="truncate text-xs text-muted">{endpoint.url}</p>
                  </div>
                  <WebhookActions endpointId={endpoint.id} enabled={endpoint.enabled} name={endpoint.name} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card as="section">
          <h3 className="mb-3 font-medium">Add a webhook endpoint</h3>
          <CreateWebhookForm />
        </Card>

        <Card as="section">
          <h3 className="mb-3 font-medium">Recent deliveries</h3>
          {logs.length === 0 ? (
            <p className="text-sm text-muted">No deliveries yet.</p>
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
                    <p className="text-xs text-muted">
                      {formatTimestamp(log.sentAt, dateFormat, displayTimeZone)}
                      {log.statusCode ? ` · HTTP ${log.statusCode}` : ""}
                      {log.message ? ` · ${log.message}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </PageShell>
  );
}
