"use client";

import { useActionState, useState } from "react";
import { testSmtpSettings, testNtfySettings, testOllamaConnection } from "@/lib/actions/app-settings";
import type { ActionState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";
import { FormMessage } from "@/components/FormMessage";
import { Field } from "@/components/FormField";
import { SelectWrapper, inputClass, selectClass } from "@/components/SelectWrapper";
import { TestConnectionButton } from "@/components/TestConnectionButton";
import { BACKUP_DESTINATION_LABELS, type BackupDestinationChoice } from "@/lib/backupDestination";

const checkboxClass = "size-4 rounded border-border accent-accent";

function SensitiveField({ id, name, isSet }: { id: string; name: string; isSet: boolean }) {
  return (
    <input
      type="password"
      id={id}
      name={name}
      placeholder={isSet ? "••••••••  (leave blank to keep)" : "Enter value"}
      autoComplete="off"
      className={inputClass}
    />
  );
}

// ─── SMTP ────────────────────────────────────────────────────────────────────

export function SmtpForm({
  action,
  current,
}: {
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  current: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    from: string;
    passwordIsSet: boolean;
  };
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, null);
  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="SMTP host" htmlFor="smtpHost">
          <input id="smtpHost" name="smtpHost" defaultValue={current.host} placeholder="mail.example.com" className={inputClass} />
        </Field>
        <Field label="Port" htmlFor="smtpPort">
          <input id="smtpPort" name="smtpPort" type="number" defaultValue={current.port || 587} className={inputClass} />
        </Field>
        <Field label="Username" htmlFor="smtpUser">
          <input id="smtpUser" name="smtpUser" defaultValue={current.user} placeholder="user@example.com" className={inputClass} />
        </Field>
        <Field label="Password" htmlFor="smtpPassword">
          <SensitiveField id="smtpPassword" name="smtpPassword" isSet={current.passwordIsSet} />
        </Field>
        <Field label="From address" htmlFor="smtpFrom">
          <input id="smtpFrom" name="smtpFrom" defaultValue={current.from} placeholder="App <no-reply@example.com>" className={inputClass} />
        </Field>
        <Field label="" htmlFor="smtpSecure" hint="Enable for port 465 (implicit TLS)">
          <div className="flex items-center gap-2 pt-1">
            <input id="smtpSecure" name="smtpSecure" type="checkbox" defaultChecked={current.secure} className={checkboxClass} />
            <label htmlFor="smtpSecure" className="text-sm">Use TLS</label>
          </div>
        </Field>
      </div>
      <FormMessage error={state?.error} success={state?.success} />
      {current.host && current.user && (
        <p className="text-xs text-muted">
          Testing sends against the saved settings — save your changes first if you just edited them.
        </p>
      )}
      <div className="flex items-center justify-between">
        {current.host && current.user ? (
          <TestConnectionButton action={testSmtpSettings} label="Send test email" />
        ) : (
          <span />
        )}
        <SubmitButton>Save email settings</SubmitButton>
      </div>
    </form>
  );
}

// ─── Email ingestion ─────────────────────────────────────────────────────────

export function EmailIngestForm({
  action,
  testAction,
  current,
}: {
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  testAction: () => Promise<ActionState>;
  current: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    mailbox: string;
    passwordIsSet: boolean;
  };
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, null);
  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="IMAP host" htmlFor="emailIngestHost">
          <input id="emailIngestHost" name="emailIngestHost" defaultValue={current.host} placeholder="imap.example.com" className={inputClass} />
        </Field>
        <Field label="Port" htmlFor="emailIngestPort">
          <input id="emailIngestPort" name="emailIngestPort" type="number" defaultValue={current.port || 993} className={inputClass} />
        </Field>
        <Field label="Username" htmlFor="emailIngestUser">
          <input id="emailIngestUser" name="emailIngestUser" defaultValue={current.user} placeholder="documents@example.com" className={inputClass} />
        </Field>
        <Field label="Password" htmlFor="emailIngestPassword">
          <SensitiveField id="emailIngestPassword" name="emailIngestPassword" isSet={current.passwordIsSet} />
        </Field>
        <Field label="Mailbox folder" htmlFor="emailIngestMailbox">
          <input id="emailIngestMailbox" name="emailIngestMailbox" defaultValue={current.mailbox || "INBOX"} placeholder="INBOX" className={inputClass} />
        </Field>
        <Field label="" htmlFor="emailIngestSecure" hint="Enable for implicit TLS (typically port 993)">
          <div className="flex items-center gap-2 pt-1">
            <input id="emailIngestSecure" name="emailIngestSecure" type="checkbox" defaultChecked={current.secure} className={checkboxClass} />
            <label htmlFor="emailIngestSecure" className="text-sm">Use TLS</label>
          </div>
        </Field>
      </div>
      <FormMessage error={state?.error} success={state?.success} />
      {current.host && current.user && (
        <p className="text-xs text-muted">
          Testing connects against the saved settings — save your changes first if you just edited
          them.
        </p>
      )}
      <div className="flex items-center justify-between">
        {current.host && current.user ? (
          <TestConnectionButton action={testAction} label="Test connection" />
        ) : (
          <span />
        )}
        <SubmitButton>Save email ingestion settings</SubmitButton>
      </div>
    </form>
  );
}

// ─── ntfy ────────────────────────────────────────────────────────────────────

export function NtfyForm({
  action,
  current,
}: {
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  current: { url: string; topic: string; tokenIsSet: boolean };
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, null);
  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="ntfy server URL" htmlFor="ntfyUrl" hint="Default: https://ntfy.sh">
          <input id="ntfyUrl" name="ntfyUrl" defaultValue={current.url} placeholder="https://ntfy.sh" className={inputClass} />
        </Field>
        <Field label="Topic" htmlFor="ntfyTopic">
          <input id="ntfyTopic" name="ntfyTopic" defaultValue={current.topic} placeholder="my-secret-topic" className={inputClass} />
        </Field>
        <Field label="Access token" htmlFor="ntfyToken" hint="Optional — required for private topics">
          <SensitiveField id="ntfyToken" name="ntfyToken" isSet={current.tokenIsSet} />
        </Field>
      </div>
      <FormMessage error={state?.error} success={state?.success} />
      {current.url && current.topic && (
        <p className="text-xs text-muted">
          Testing sends against the saved settings — save your changes first if you just edited them.
        </p>
      )}
      <div className="flex items-center justify-between">
        {current.url && current.topic ? (
          <TestConnectionButton action={testNtfySettings} label="Send test notification" />
        ) : (
          <span />
        )}
        <SubmitButton>Save ntfy settings</SubmitButton>
      </div>
    </form>
  );
}

// ─── Ollama ──────────────────────────────────────────────────────────────────

export function OllamaForm({
  action,
  current,
}: {
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  current: { baseUrl: string; model: string };
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, null);
  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Ollama base URL" htmlFor="ollamaBaseUrl">
          <input id="ollamaBaseUrl" name="ollamaBaseUrl" defaultValue={current.baseUrl} placeholder="http://localhost:11434" className={inputClass} />
        </Field>
        <Field label="Model" htmlFor="ollamaModel">
          <input id="ollamaModel" name="ollamaModel" defaultValue={current.model} placeholder="llama3" className={inputClass} />
        </Field>
      </div>
      <FormMessage error={state?.error} success={state?.success} />
      {current.baseUrl && (
        <p className="text-xs text-muted">
          Testing connects using the saved settings — save your changes first if you just edited them.
        </p>
      )}
      <div className="flex items-center justify-between">
        {current.baseUrl ? (
          <TestConnectionButton action={testOllamaConnection} label="Test connection" />
        ) : (
          <span />
        )}
        <SubmitButton>Save Ollama settings</SubmitButton>
      </div>
    </form>
  );
}

// ─── Barcode ─────────────────────────────────────────────────────────────────

export function BarcodeForm({
  action,
  current,
}: {
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  current: { enabled: boolean; apiKeyIsSet: boolean };
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, null);
  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="" htmlFor="barcodeEnabled">
          <div className="flex items-center gap-2 pt-1">
            <input id="barcodeEnabled" name="barcodeEnabled" type="checkbox" defaultChecked={current.enabled} className={checkboxClass} />
            <label htmlFor="barcodeEnabled" className="text-sm">Enable barcode lookup</label>
          </div>
        </Field>
        <Field label="UPCitemdb API key" htmlFor="barcodeApiKey" hint="Optional — uses rate-limited free tier if unset">
          <SensitiveField id="barcodeApiKey" name="barcodeApiKey" isSet={current.apiKeyIsSet} />
        </Field>
      </div>
      <FormMessage error={state?.error} success={state?.success} />
      <div className="flex justify-end">
        <SubmitButton>Save barcode settings</SubmitButton>
      </div>
    </form>
  );
}

// ─── Backup destination ──────────────────────────────────────────────────────
// A single destination is active at a time (not "every configured
// destination runs"), selected from this dropdown. Switching the selection
// doesn't discard the other destinations' previously-saved credentials —
// they're just inactive until selected again.

export function BackupDestinationForm({
  action,
  current,
}: {
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  current: {
    destination: BackupDestinationChoice;
    local: { path: string };
    s3: {
      endpoint: string;
      region: string;
      bucket: string;
      accessKeyId: string;
      forcePathStyle: boolean;
      secretKeyIsSet: boolean;
    };
    sftp: {
      host: string;
      port: number;
      username: string;
      remotePath: string;
      passwordIsSet: boolean;
      privateKeyIsSet: boolean;
    };
  };
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, null);
  const [destination, setDestination] = useState<BackupDestinationChoice>(current.destination);

  return (
    <form action={formAction} className="space-y-4">
      <Field label="Backup destination" htmlFor="destination">
        <SelectWrapper>
          <select
            id="destination"
            name="destination"
            value={destination}
            onChange={(e) => setDestination(e.target.value as BackupDestinationChoice)}
            className={selectClass}
          >
            {(Object.keys(BACKUP_DESTINATION_LABELS) as BackupDestinationChoice[]).map((value) => (
              <option key={value} value={value}>
                {BACKUP_DESTINATION_LABELS[value]}
              </option>
            ))}
          </select>
        </SelectWrapper>
      </Field>

      {destination === "LOCAL" && (
        <Field
          label="Backup directory"
          htmlFor="localPath"
          hint="Point this at a path inside your existing data volume (e.g. ./data/backups) so it's covered by whatever you already back up."
        >
          <input id="localPath" name="localPath" defaultValue={current.local.path} placeholder="./data/backups" className={inputClass} />
        </Field>
      )}

      {destination === "S3" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Endpoint" htmlFor="s3Endpoint" hint="Leave blank for AWS S3">
            <input id="s3Endpoint" name="s3Endpoint" defaultValue={current.s3.endpoint} placeholder="https://s3.example.com" className={inputClass} />
          </Field>
          <Field label="Region" htmlFor="s3Region">
            <input id="s3Region" name="s3Region" defaultValue={current.s3.region} placeholder="auto" className={inputClass} />
          </Field>
          <Field label="Bucket" htmlFor="s3Bucket">
            <input id="s3Bucket" name="s3Bucket" defaultValue={current.s3.bucket} placeholder="my-backups" className={inputClass} />
          </Field>
          <Field label="Access key ID" htmlFor="s3AccessKeyId">
            <input id="s3AccessKeyId" name="s3AccessKeyId" defaultValue={current.s3.accessKeyId} className={inputClass} />
          </Field>
          <Field label="Secret access key" htmlFor="s3SecretAccessKey">
            <SensitiveField id="s3SecretAccessKey" name="s3SecretAccessKey" isSet={current.s3.secretKeyIsSet} />
          </Field>
          <Field label="" htmlFor="s3ForcePathStyle">
            <div className="flex items-center gap-2 pt-1">
              <input id="s3ForcePathStyle" name="s3ForcePathStyle" type="checkbox" defaultChecked={current.s3.forcePathStyle} className={checkboxClass} />
              <label htmlFor="s3ForcePathStyle" className="text-sm">Force path-style URLs</label>
            </div>
          </Field>
        </div>
      )}

      {destination === "SFTP" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Host" htmlFor="sftpHost">
            <input id="sftpHost" name="sftpHost" defaultValue={current.sftp.host} placeholder="sftp.example.com" className={inputClass} />
          </Field>
          <Field label="Port" htmlFor="sftpPort">
            <input id="sftpPort" name="sftpPort" type="number" defaultValue={current.sftp.port || 22} className={inputClass} />
          </Field>
          <Field label="Username" htmlFor="sftpUsername">
            <input id="sftpUsername" name="sftpUsername" defaultValue={current.sftp.username} className={inputClass} />
          </Field>
          <Field label="Remote path" htmlFor="sftpRemotePath">
            <input id="sftpRemotePath" name="sftpRemotePath" defaultValue={current.sftp.remotePath} placeholder="/backups" className={inputClass} />
          </Field>
          <Field label="Password" htmlFor="sftpPassword" hint="Use password or private key, or both">
            <SensitiveField id="sftpPassword" name="sftpPassword" isSet={current.sftp.passwordIsSet} />
          </Field>
          <Field label="Private key (PEM)" htmlFor="sftpPrivateKey">
            <SensitiveField id="sftpPrivateKey" name="sftpPrivateKey" isSet={current.sftp.privateKeyIsSet} />
          </Field>
        </div>
      )}

      <FormMessage error={state?.error} success={state?.success} />
      <div className="flex justify-end">
        <SubmitButton>Save backup destination</SubmitButton>
      </div>
    </form>
  );
}

// ─── Schedules ───────────────────────────────────────────────────────────────

export function ScheduleForm({
  action,
  current,
}: {
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  current: {
    reminderCron: string;
    reminderDefaultDays: string;
    backupCron: string;
    retentionCount: number;
  };
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, null);
  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Reminder cron" htmlFor="reminderCron" hint="When to send expiry reminders (cron syntax)">
          <input id="reminderCron" name="reminderCron" defaultValue={current.reminderCron} placeholder="0 8 * * *" className={inputClass} />
        </Field>
        <Field label="Default reminder days" htmlFor="reminderDefaultDays" hint="Comma-separated days before expiry, e.g. 30,14,7,1">
          <input id="reminderDefaultDays" name="reminderDefaultDays" defaultValue={current.reminderDefaultDays} placeholder="30,14,7,1" className={inputClass} />
        </Field>
        <Field label="Backup cron" htmlFor="backupCron" hint="When to run automatic backups">
          <input id="backupCron" name="backupCron" defaultValue={current.backupCron} placeholder="0 3 * * *" className={inputClass} />
        </Field>
        <Field label="Backup retention" htmlFor="retentionCount" hint="Number of backups to keep per destination">
          <input id="retentionCount" name="retentionCount" type="number" min={1} defaultValue={current.retentionCount} className={inputClass} />
        </Field>
      </div>
      <p className="text-xs text-warning">
        Cron schedule changes take effect after the next server restart.
      </p>
      <FormMessage error={state?.error} success={state?.success} />
      <div className="flex justify-end">
        <SubmitButton>Save schedule settings</SubmitButton>
      </div>
    </form>
  );
}

// ─── AviationStack ────────────────────────────────────────────────────────────

export function AviationStackForm({
  action,
  isKeySet,
}: {
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  isKeySet: boolean;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, null);
  return (
    <form action={formAction} className="space-y-4">
      <Field
        label="API key"
        htmlFor="aviationstackApiKey"
        hint="Free plan uses HTTP endpoints only (100 req/month). Basic plan ($9.99/mo) enables HTTPS and 1 000 req/month — recommended for use behind a reverse proxy."
      >
        <SensitiveField id="aviationstackApiKey" name="aviationstackApiKey" isSet={isKeySet} />
      </Field>
      <FormMessage error={state?.error} success={state?.success} />
      <div className="flex justify-end">
        <SubmitButton>Save</SubmitButton>
      </div>
    </form>
  );
}
