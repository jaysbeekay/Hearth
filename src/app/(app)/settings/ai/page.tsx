import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getOllamaConfig, getAppSetting, isAppSettingSet, isOllamaConfigured } from "@/lib/appSettings";
import { getExtractionCapabilities } from "@/lib/documents/textExtraction";
import { ExtractionCapabilitiesCard } from "@/components/ExtractionCapabilitiesCard";
import { saveOllamaSettings } from "@/lib/actions/app-settings";
import { OllamaForm } from "@/components/AppSettingsForms";
import { AiSettingsForm } from "@/components/AiSettingsForm";
import { ChatSettingsForm } from "@/components/ChatSettingsForm";
import { SaveChangesGroup } from "@/components/SaveChangesGroup";
import type { AiProviderId } from "@/lib/ai/types";
import { BackLink } from "@/components/BackLink";
import { SETTINGS_ROUTES, settingsBackLink } from "@/lib/routeLabels";
import { Card } from "@/components/ui/Card";
import { PageShell } from "@/components/ui/PageShell";

export const metadata: Metadata = { title: SETTINGS_ROUTES.ai.label };

// #363 — the AI half of the old System settings page: what reads uploaded
// documents locally, and the optional local and cloud AI that can help.
export default async function AiSettingsPage() {
  const session = await auth();
  if (session?.user.role !== "ADMIN") redirect("/settings");

  const [
    ollama,
    aiProvider,
    aiModel,
    chatProvider,
    chatModel,
    aiApiKeyIsSet,
    chatApiKeyIsSet,
    extractionCapabilities,
    ollamaConfigured,
  ] = await Promise.all([
    getOllamaConfig(),
    getAppSetting("ai.provider"),
    getAppSetting("ai.model"),
    getAppSetting("chat.provider"),
    getAppSetting("chat.model"),
    isAppSettingSet("ai.apiKey"),
    isAppSettingSet("chat.apiKey"),
    getExtractionCapabilities(),
    isOllamaConfigured(),
  ]);

  return (
    <PageShell width="form">
      <div>
        <BackLink {...settingsBackLink(SETTINGS_ROUTES.ai)} />
        <h1 className="text-2xl font-medium">{SETTINGS_ROUTES.ai.label}</h1>
        <p className="mt-1 text-sm text-muted">
          Hearth reads documents on this server first. Nothing goes to a cloud AI unless you add
          a key here.
        </p>
      </div>

      <Card as="section" className="space-y-4">
        <div>
          <h2 className="font-medium">Document text extraction</h2>
          <p className="text-xs text-muted mt-0.5">
            Local tools this server uses to read uploaded documents before any AI is involved
          </p>
        </div>
        <ExtractionCapabilitiesCard
          capabilities={extractionCapabilities}
          aiKeySet={aiApiKeyIsSet && Boolean(aiProvider)}
          ollamaConfigured={ollamaConfigured}
        />
      </Card>

      <SaveChangesGroup>
        <Card as="section" className="space-y-4">
          <div>
            <h2 className="font-medium">Local AI (Ollama)</h2>
            <p className="text-xs text-muted mt-0.5">Used as a fallback extraction backend when no cloud AI key is set</p>
          </div>
          <OllamaForm action={saveOllamaSettings} current={{ baseUrl: ollama.baseUrl, model: ollama.model }} />
        </Card>

        <Card as="section" className="space-y-4">
          <div>
            <h2 className="font-medium">AI document extraction</h2>
            <p className="text-xs text-muted mt-0.5">
              Bring your own API key to send uploaded documents to a cloud AI provider for
              higher-accuracy field extraction, shared by the whole household. Leave this unset to
              keep using the built-in local extraction only.
            </p>
          </div>
          <AiSettingsForm
            provider={(aiProvider || null) as AiProviderId | null}
            model={aiModel || null}
            apiKeyIsSet={aiApiKeyIsSet}
          />
        </Card>

        <Card as="section" className="space-y-4">
          <div>
            <h2 className="font-medium">AI Assistant</h2>
            <p className="text-xs text-muted mt-0.5">
              Bring your own API key to enable an assistant that can answer questions using the
              household&apos;s own data — contracts, warranties, trips, vehicles, properties,
              inventory and wealth. It can also propose creating or updating a contract or warranty, but
              nothing is ever written without the requesting member&apos;s explicit confirmation
              first. Configure a different provider/model here than document extraction if you like
              — the two are independent.
            </p>
          </div>
          <ChatSettingsForm
            provider={(chatProvider || null) as AiProviderId | null}
            model={chatModel || null}
            apiKeyIsSet={chatApiKeyIsSet}
          />
        </Card>
      </SaveChangesGroup>
    </PageShell>
  );
}
