import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getEmailIngestConfig, isAppSettingSet } from "@/lib/appSettings";
import { saveEmailIngestSettings, testEmailIngestConnection } from "@/lib/actions/app-settings";
import { EmailIngestForm } from "@/components/AppSettingsForms";
import { SaveChangesGroup } from "@/components/SaveChangesGroup";
import { BackLink } from "@/components/BackLink";
import { SETTINGS_ROUTES, settingsBackLink } from "@/lib/routeLabels";
import { Card } from "@/components/ui/Card";
import { PageShell } from "@/components/ui/PageShell";
import { sectionHeadingClass } from "@/lib/ui";

export const metadata: Metadata = { title: SETTINGS_ROUTES.ingestion.label };

export default async function IngestionSettingsPage() {
  const session = await auth();
  if (session?.user.role !== "ADMIN") redirect("/settings");

  const [emailIngest, emailIngestPasswordIsSet] = await Promise.all([
    getEmailIngestConfig(),
    isAppSettingSet("emailIngest.password"),
  ]);

  return (
    <PageShell width="form">
      <div>
        <BackLink {...settingsBackLink(SETTINGS_ROUTES.ingestion)} />
        <h1 className="text-2xl font-medium">{SETTINGS_ROUTES.ingestion.label}</h1>
        <p className="mt-1 text-sm text-muted">Ways for documents to reach the Inbox without opening Hearth.</p>
      </div>

      <SaveChangesGroup>
        <Card as="section" className="space-y-4">
          <div>
            <h2 className={sectionHeadingClass()}>Email ingestion</h2>
            <p className="text-xs text-muted mt-0.5">
              Forward or email a document to this mailbox and Hearth periodically checks it,
              guesses what type of document it is, and drops it in your Inbox for you to
              confirm — the sender is never trusted, so nothing is ever filed automatically.
            </p>
          </div>
          <EmailIngestForm
            action={saveEmailIngestSettings}
            testAction={testEmailIngestConnection}
            current={{
              host: emailIngest.host,
              port: emailIngest.port,
              secure: emailIngest.secure,
              user: emailIngest.user,
              mailbox: emailIngest.mailbox,
              passwordIsSet: emailIngestPasswordIsSet,
            }}
          />
        </Card>
      </SaveChangesGroup>
    </PageShell>
  );
}
