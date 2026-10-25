// Help page FAQ (#362). Wherever an answer names a page, a tab or a
// Settings section, it's written in [[double brackets]], as one label or a
// " → " path ("[[Settings → Household & System → Modules]]"). The Help page
// shows those in bold, and tests/unit/help-faq-labels.test.ts checks every
// one against the real labels in nav-items.ts and src/lib/routeLabels.ts,
// so a renamed page can't leave Help pointing at something that's gone.

export interface FaqEntry {
  q: string;
  a: string;
}

export interface FaqSection {
  heading: string;
  entries: FaqEntry[];
}

export const FAQ_SECTIONS: FaqSection[] = [
  {
    heading: "Getting started",
    entries: [
      {
        q: "What are modules, and can I turn them on or off later?",
        a: "[[Travel]], [[Properties]], [[Vehicles]], [[Inventory]] and [[Wealth]] are optional modules you can turn on at first-run setup or any time afterwards from [[Settings → Household & System → Modules]]. Turning a module off hides it from navigation but keeps its data — nothing is deleted. [[Contracts]], [[Warranties]] and [[Documents]] are always on.",
      },
      {
        q: "How do I invite another household member?",
        a: "From [[Settings → Household & System → Household members]]. If email (SMTP) is configured, they get an invite link that expires after 48 hours and set their own password. Otherwise, you set a temporary password for them directly. There's no public sign-up — every account is invited by an admin.",
      },
      {
        q: "What's the difference between Admin, Member, and Read-only roles?",
        a: "Everyone in the household sees the same contracts, trips, properties and other records — role doesn't affect what you can see. It decides what you can do: Read-only can't change anything, Member can add, edit and delete the household's records, and Admin can also manage household members, webhooks, backups and modules.",
      },
      {
        q: "Is anything I add private to me, or can every household member see it?",
        a: "Every contract, warranty, document, trip, property, vehicle, inventory item and wealth record is visible to the whole household — there's no per-record or per-person privacy setting. The one exception is [[Assistant]] conversations, which stay private to whoever started them. If you're uploading something sensitive (a payslip, a passport scan), keep in mind everyone with a household account can see it.",
      },
    ],
  },
  {
    heading: "Documents & AI extraction",
    entries: [
      {
        q: "How does auto-fill work when I upload a document?",
        a: "Hearth tries three stages in turn until enough fields are found: reading the text of the document, then matching fields with built-in rules, and finally — only if the first two come up short and you've configured one — your own cloud AI provider, using your own API key.",
      },
      {
        q: "What do the different highlight colours on auto-filled fields mean?",
        a: "An accent-coloured highlight means the field was matched by the built-in rules. A blue highlight means it was suggested by AI. Either way, check highlighted fields before saving — auto-fill is a starting point, not a guarantee.",
      },
      {
        q: "Is my document sent anywhere when using AI extraction?",
        a: "Only if you've configured a cloud AI provider yourself, in [[Settings → Household & System → System settings → AI document extraction]]. In that case, the document is sent directly to that provider using your own API key. Without one, extraction stays local — either the built-in rules or an optional local Ollama server you point at.",
      },
      {
        q: "What happens to a document I upload without attaching it to a record?",
        a: "It goes to [[Documents → Inbox]], so you can review it and attach it to a record later instead of losing it.",
      },
    ],
  },
  {
    heading: "Reminders",
    entries: [
      {
        q: "How do reminders work?",
        a: "A scheduled check compares your contracts, warranties and vehicles against their reminder thresholds (30, 14, 7 and 1 days before by default) and sends a reminder through whichever channels are set up — email, push via ntfy, and/or outbound webhooks.",
      },
      {
        q: "I added a contract that's already overdue — will I get a flood of reminders?",
        a: "No. Crossing several reminder thresholds at once (for example, adding a contract that's already 20 days overdue) sends one catch-up reminder per channel, not one per threshold.",
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
        a: "S3-compatible storage (AWS S3, Backblaze B2, Cloudflare R2, MinIO, etc.), SFTP, or a local folder on the server. Only one destination is active at a time, chosen in [[Settings → Household & System → Backups]].",
      },
      {
        q: "Are backups encrypted?",
        a: "Yes — every backup is encrypted (AES-256-GCM) before upload. This needs an encryption key configured on the server; without one, offsite backups stay off.",
      },
      {
        q: "How often do backups run, and how many are kept?",
        a: "Both are configurable — a schedule for how often, and how many recent backups to keep before older ones are removed.",
      },
    ],
  },
  {
    heading: "Security",
    entries: [
      {
        q: "What's the difference between passkeys and two-factor authentication (TOTP)?",
        a: "They're separate, optional second factors for each person — you can use either, both, or neither. Passkeys (Face ID, Touch ID, or a security key) need the server's URL to be configured, and are managed in [[Settings → Passkeys]]. TOTP works with any standard authenticator app (Google Authenticator, 1Password, Authy, etc.) and doesn't need that.",
      },
      {
        q: "I lost access to my authenticator app — how do I sign in?",
        a: "Use one of the one-time recovery codes shown when you first turned on two-factor authentication. Each code works once. If you no longer have those either, ask your household admin for help.",
      },
      {
        q: "How do I reset a forgotten password?",
        a: "If email (SMTP) is configured for your household, use \"Forgot your password?\" on the sign-in page. If it isn't, ask your household admin to set a new password for you from [[Settings → Household & System → Household members]].",
      },
      {
        q: "Can I create my own account?",
        a: "No — accounts are invite-only. An admin adds you from [[Settings → Household & System → Household members]], or (if GitHub sign-in is enabled) you can sign in with GitHub once an admin has invited your email address.",
      },
    ],
  },
  {
    heading: "Offline mode",
    entries: [
      {
        q: "Does this work without a connection to my home server?",
        a: "Pages you've already visited stay readable. Anything you change while offline is saved on your device and synced automatically once you reconnect.",
      },
      {
        q: "Where do my offline edits show up before they sync?",
        a: "As a \"Pending sync\" card on the matching list page ([[Contracts]], [[Warranties]], [[Vehicles]], [[Travel]] or [[Properties]]) — you can still edit or discard them before they've synced.",
      },
    ],
  },
  {
    heading: "Troubleshooting",
    entries: [
      {
        q: "A module I turned on isn't showing up in navigation.",
        a: "Check it's actually on in [[Settings → Household & System → Modules]] — turning it on there is what adds it to the navigation. [[Contracts]], [[Warranties]] and [[Documents]] are always shown.",
      },
      {
        q: "The Assistant isn't in my navigation.",
        a: "[[Assistant]] only appears once a chat AI provider is configured for the household, in [[Settings → Household & System → System settings → AI Assistant]].",
      },
      {
        q: "A record another household member added doesn't show up for me.",
        a: "Contracts, trips, properties and other records belong to the whole household — every member sees and can edit the same records, whoever added them. If something seems to be missing, try refreshing first; it isn't expected.",
      },
    ],
  },
];

/** Splits an answer into plain text (even indices) and [[label]] references (odd indices). */
export function splitFaqAnswer(answer: string): string[] {
  return answer.split(/\[\[(.+?)\]\]/);
}

/** Every [[label]] or [[path → to → page]] an answer references, each as its path segments. */
export function faqReferences(answer: string): string[][] {
  return splitFaqAnswer(answer)
    .filter((_, i) => i % 2 === 1)
    .map((ref) => ref.split(" → "));
}
