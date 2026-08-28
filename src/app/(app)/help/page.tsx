import type { Metadata } from "next";
import { FeedbackForm } from "@/components/FeedbackForm";
import { isGithubFeedbackConfigured } from "@/lib/env";

export const metadata: Metadata = { title: "Help" };

interface FaqEntry {
  q: string;
  a: string;
}

interface FaqSection {
  heading: string;
  entries: FaqEntry[];
}

const FAQ_SECTIONS: FaqSection[] = [
  {
    heading: "Getting started",
    entries: [
      {
        q: "What are modules, and can I turn them on or off later?",
        a: "Travel, Property, Vehicles, Inventory, and Wealth are optional modules you can enable at first-run setup or any time afterward from Settings → Household & System → Modules. Disabling a module hides it from navigation but keeps its data intact — nothing is deleted. Contracts, Warranties, and Documents are always on and aren't gated by a module toggle.",
      },
      {
        q: "How do I invite another household member?",
        a: "From Settings → Household & System → Manage household members. If email (SMTP) is configured, they get a 48-hour expiring invite link to set their own password. Otherwise, you set a temporary password for them directly. There's no public sign-up — every account is admin-invited.",
      },
      {
        q: "What's the difference between Admin, Member, and Read-only roles?",
        a: "Everyone in the household sees the same contracts, trips, properties, and other records — role doesn't affect visibility. It gates actions: Read-only blocks all writes, Member can create/edit/delete the household's own records, and Admin additionally gates household-administration actions like managing users, webhooks, backups, and module toggles.",
      },
      {
        q: "Is anything I add private to me, or can every household member see it?",
        a: "Every contract, warranty, document, trip, property, vehicle, inventory item, and wealth record is visible to the whole household — there's no per-record or per-person privacy setting. The one exception is Assistant chat conversations, which stay private to whoever started them. If you're uploading something sensitive (a payslip, a passport scan), keep in mind everyone with a household account can see it.",
      },
    ],
  },
  {
    heading: "Documents & AI extraction",
    entries: [
      {
        q: "How does auto-fill work when I upload a document?",
        a: "Hearth tries three escalating stages until enough fields are found: text extraction from the document, then regex/heuristic field matching, and finally — only if the first two come up short and you've configured one — your own bring-your-own-key cloud AI provider.",
      },
      {
        q: "What do the different highlight colors on auto-filled fields mean?",
        a: "An accent-colored highlight means the field was matched by the built-in heuristics. A blue/info-colored highlight means it was suggested by AI. Either way, always review highlighted fields before saving — auto-fill is a starting point, not a guarantee.",
      },
      {
        q: "Is my document sent anywhere when using AI extraction?",
        a: "Only if you've configured a cloud AI provider yourself (Settings → System settings → AI document extraction). In that case, the document is sent directly to that provider using your own API key. Without one configured, extraction stays local — either the built-in heuristics or an optional local Ollama server you point at.",
      },
      {
        q: "What happens to a document I upload without attaching it to a record?",
        a: "It lands in your inbox (Documents → Inbox tab) so you can review, classify, and file it later instead of losing it.",
      },
    ],
  },
  {
    heading: "Notifications & reminders",
    entries: [
      {
        q: "How do expiry reminders work?",
        a: "A scheduled check compares your contracts, warranties, and vehicles against configurable thresholds (30/14/7/1 days by default) and sends a notification through whichever channels you've set up — email, push via ntfy, and/or outbound webhooks.",
      },
      {
        q: "I added a contract that's already overdue — will I get spammed with notifications?",
        a: "No. Crossing several thresholds at once (for example, adding a contract that's already 20 days overdue) sends one catch-up notification per channel, not one per threshold.",
      },
      {
        q: "Can I trigger the reminder check from an external scheduler instead?",
        a: "Yes — POST to /api/cron with the x-cron-secret header, if CRON_SECRET is configured.",
      },
    ],
  },
  {
    heading: "Backups",
    entries: [
      {
        q: "Where can backups be stored?",
        a: "S3-compatible storage (AWS S3, Backblaze B2, Cloudflare R2, MinIO, etc.), SFTP, or a local filesystem path. Only one destination is active at a time, chosen in Settings → Household & System → Database backups.",
      },
      {
        q: "Are backups encrypted?",
        a: "Yes — every backup is encrypted (AES-256-GCM) before upload. This requires an encryption key to be configured on the server; without one, offsite backups stay disabled.",
      },
      {
        q: "How often do backups run, and how many are kept?",
        a: "Both are configurable — a cron schedule for how often, and a retention count for how many recent backups to keep before older ones are pruned.",
      },
    ],
  },
  {
    heading: "Security",
    entries: [
      {
        q: "What's the difference between passkeys and two-factor authentication (TOTP)?",
        a: "They're independent, optional, per-user second factors — you can use either, both, or neither. Passkeys (Face ID, Touch ID, or a security key) require the server's URL to be configured. TOTP works with any standard authenticator app (Google Authenticator, 1Password, Authy, etc.) and doesn't have that requirement.",
      },
      {
        q: "I lost access to my authenticator app — how do I sign in?",
        a: "Use one of the one-time recovery codes shown when you first enabled two-factor authentication. Each code works once. If you no longer have those either, ask your household admin for help.",
      },
      {
        q: "How do I reset a forgotten password?",
        a: "If email (SMTP) is configured for your household, use \"Forgot password\" on the sign-in page. If it isn't configured, ask your household admin to set a new password for you from Settings → Users.",
      },
      {
        q: "Can I create my own account?",
        a: "No — sign-up is invite-only. An admin adds you from Settings → Users, or (if GitHub sign-in is enabled) you can sign in with GitHub once an admin has already invited your email address.",
      },
    ],
  },
  {
    heading: "Offline mode",
    entries: [
      {
        q: "Does this work without a connection to my home server?",
        a: "Pages you've already visited stay browsable for reading. Any writes you make while offline are queued locally and synced automatically once you reconnect.",
      },
      {
        q: "Where do my offline edits show up before they sync?",
        a: "As a \"Pending sync\" card on the relevant list page (Contracts, Products, Vehicles, Travel, Property, Inventory) — you can still edit or discard them before they've synced.",
      },
    ],
  },
  {
    heading: "Troubleshooting",
    entries: [
      {
        q: "A module I enabled isn't showing up in navigation.",
        a: "Double-check it's actually enabled in Settings → Household & System → Modules — toggling it there is what adds it to the sidebar/bottom nav. Contracts, Warranties, and Documents are always visible and aren't affected by module toggles.",
      },
      {
        q: "The Assistant isn't in my navigation.",
        a: "It only appears once a chat AI provider is configured for the household, in Settings → System settings → AI Assistant.",
      },
      {
        q: "A record another household member added doesn't show up for me.",
        a: "Contracts, trips, properties, and similar records are household-wide — every member sees and can edit the same data, regardless of who created it. If something seems to be missing, try refreshing first; this isn't expected behavior for this app's data model.",
      },
    ],
  },
];

export default function HelpPage() {
  return (
    <div className="max-w-3xl space-y-10">
      <div>
        <h1 className="text-2xl font-semibold">Help &amp; FAQ</h1>
        <p className="mt-1 text-sm text-muted">
          Answers to common questions about using Hearth. For the full user
          manual — setup, self-hosting, and every feature in more depth —
          see the{" "}
          <a
            href="https://github.com/jaysbeekay/Hearth#readme"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            README on GitHub
          </a>
          . Can&apos;t find what you need? Send us feedback below.
        </p>
      </div>

      {FAQ_SECTIONS.map((section) => (
        <div key={section.heading} className="space-y-4">
          <h2 className="border-b border-border pb-2 text-sm font-semibold uppercase tracking-wide text-muted">
            {section.heading}
          </h2>
          <div className="space-y-2">
            {section.entries.map((entry) => (
              <details
                key={entry.q}
                className="group rounded-xl border border-border bg-surface p-4 open:pb-4"
              >
                <summary className="cursor-pointer list-none text-sm font-medium marker:content-none">
                  <span className="flex items-center justify-between gap-3">
                    {entry.q}
                    <span className="text-muted transition group-open:rotate-45">+</span>
                  </span>
                </summary>
                <p className="mt-2 text-sm text-foreground/70">{entry.a}</p>
              </details>
            ))}
          </div>
        </div>
      ))}

      <section className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <div className="mb-4">
          <h2 className="font-medium">Share feedback</h2>
          <p className="mt-1 text-sm text-muted">
            Report a bug, describe an issue, or suggest an enhancement.
            Submissions are added to the GitHub review queue for the Hearth
            team.
          </p>
        </div>
        <FeedbackForm configured={isGithubFeedbackConfigured()} />
      </section>
    </div>
  );
}
