"use client";

import { useActionState, useState } from "react";
import { Trash2 } from "lucide-react";
import { removeChatSettings, saveChatSettings, type ActionState } from "@/lib/actions/chatSettings";
import { testOllamaConnection } from "@/lib/actions/app-settings";
import {
  AI_PROVIDER_LABELS,
  AI_PROVIDERS_WITHOUT_API_KEY,
  type AiProviderId,
} from "@/lib/ai/types";
import { CHAT_PROVIDER_DEFAULT_MODELS } from "@/lib/ai/chat/types";
import { SubmitButton } from "@/components/SubmitButton";
import { FormMessage } from "@/components/FormMessage";
import { ConfirmForm } from "@/components/ConfirmForm";
import { SelectWrapper, selectClass } from "@/components/SelectWrapper";
import { TestConnectionButton } from "@/components/TestConnectionButton";

const inputClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent";

export function ChatSettingsForm({
  provider,
  model,
}: {
  provider: AiProviderId | null;
  model: string | null;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(saveChatSettings, null);
  const configured = Boolean(provider);
  const [selected, setSelected] = useState<AiProviderId>(provider ?? "ANTHROPIC");
  const needsApiKey = !AI_PROVIDERS_WITHOUT_API_KEY.includes(selected);

  return (
    <div className="space-y-4">
      <form action={formAction} className="space-y-3">
        <div className="space-y-1">
          <label htmlFor="chatProvider" className="text-sm font-medium">
            Provider
          </label>
          <SelectWrapper>
            <select
              id="chatProvider"
              name="provider"
              defaultValue={selected}
              onChange={(e) => setSelected(e.target.value as AiProviderId)}
              className={selectClass}
            >
              {Object.entries(AI_PROVIDER_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </SelectWrapper>
        </div>

        {needsApiKey ? (
          <div className="space-y-1">
            <label htmlFor="chatApiKey" className="text-sm font-medium">
              API key
            </label>
            <input
              id="chatApiKey"
              name="apiKey"
              type="password"
              required
              autoComplete="off"
              placeholder={configured ? "Enter a new key to replace the saved one" : "sk-..."}
              className={inputClass}
            />
          </div>
        ) : (
          <p className="text-xs text-foreground/50">
            No API key needed — Ollama uses the base URL configured in{" "}
            <a href="/settings/app" className="text-accent hover:underline">
              System settings
            </a>
            .
          </p>
        )}

        <div className="space-y-1">
          <label htmlFor="chatModel" className="text-sm font-medium">
            Model <span className="text-foreground/50">(optional)</span>
          </label>
          <input
            id="chatModel"
            name="model"
            defaultValue={model ?? ""}
            placeholder={CHAT_PROVIDER_DEFAULT_MODELS[selected]}
            className={inputClass}
          />
        </div>

        <FormMessage error={state?.error} success={state?.success} />
        <div className="flex items-center justify-between">
          {selected === "OLLAMA" ? (
            <TestConnectionButton action={testOllamaConnection} label="Test connection" />
          ) : (
            <span />
          )}
          <SubmitButton>{configured ? "Update" : "Save"}</SubmitButton>
        </div>
      </form>

      {configured && (
        <ConfirmForm
          action={removeChatSettings}
          confirmText="Remove your saved assistant provider settings? The assistant will be unavailable until you configure one again."
          className="inline-flex items-center gap-2 text-sm text-foreground/50 hover:text-danger"
        >
          <Trash2 size={14} />
          Remove
        </ConfirmForm>
      )}
    </div>
  );
}
