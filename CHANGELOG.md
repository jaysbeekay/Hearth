# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/), starting at `0.1.0`.

## [Unreleased]

### Added

- **Important flag, completeness filters, and search filter chips**
  (#205, #207, #208). Documents on a contract or product can be starred
  Important for quick retrieval later. The Contracts and Products list
  pages gained filter chips for Expiring soon, Expired, Needs review, and
  Missing document. Global search gained matching filter chips (plus
  Important), so a record can be found by state even without remembering
  its name.
- **Inbox duplicate detection and status filters** (#199, #206). Documents
  in the inbox are now tagged Needs classification, Needs review, Extraction
  failed, or Possible duplicate, with filter chips to jump straight to any
  of them. A likely duplicate (identical file content to something already
  filed) shows what it matches, with options to attach it as a new version,
  keep it as a separate document, or discard it. A contract's document list
  now groups re-uploads into a version history instead of listing them as
  unrelated files.
- **Never lose an upload** (#203). If a document can't be attached to a
  new contract or product for some reason, it's saved to the Documents
  inbox instead of silently disappearing, with a banner on the record
  pointing there. Global search now also finds documents still sitting in
  the inbox.
- **Reminder health** (#201). Contract, product, and vehicle detail pages
  show a Reminder health card — whether a reminder is enabled, the next
  reminder date, thresholds, delivery channel and status, last sent, last
  failure, and a "Send test reminder" action. The dashboard's needs-attention
  queue now also surfaces records with a failed reminder delivery.
- **Extraction confirmation** (#200). When a document scan auto-fills
  critical fields on a contract or product, saving without confirming them
  marks the record "Needs review" and holds its reminders until confirmed —
  either by checking "these look correct" on the form, or via a standalone
  "Confirm details" action on the detail page and dashboard.
- **Email ingestion** (#195). Configure an IMAP mailbox in Settings → System
  settings and forward or email a document to it — Hearth polls it on a
  schedule, guesses what type of document each attachment is (Contract,
  Product, or Inventory item) from the same heuristics already used for
  manual uploads, and drops it in the Documents inbox pre-classified for
  review. Nothing is ever filed without a human confirming it first;
  attachments are validated by content (not the claimed MIME type), same as
  every other upload path (#165).

## [0.15.0] - 2026-08-01

### Added

- **Dashboard is now a "needs attention" queue** (#170). The four separate
  expiring/expired card grids (contracts, warranties) plus the vehicle
  section are replaced by one urgency-sorted list, each row already carrying
  its next action (upload document / renew / mark cancelled) instead of
  leaving that to the reader. Stat cards link through to pre-filtered
  Contracts/Products lists rather than sitting inert.
- **Document inbox is a first-class workflow** (#171). `/documents` and
  `/documents/inbox` share an Inbox/Filed/All tab strip, so unfiled uploads
  read as one workflow instead of a side area reachable only via a small
  pill. Inbox rows also flag a contract missing its provider before you try
  to save it.
- **Mobile capture is a primary action** (#173). Documents is promoted into
  the primary bottom-nav slot (over Calendar), and a persistent one-tap
  upload FAB is reachable from any page — hidden on `/import` itself and on
  `/new`/`/edit` form routes, where it would otherwise cover the submit
  button.
- **Detail pages surface what needs doing** (#176). Contract and product
  detail pages show a status banner when the record is overdue or expiring
  within 30 days, with the renew/upload action already picked out.
- **Sparse lists get a summary and a real empty state** (#177). Contracts and
  Products list pages show an at-a-glance strip (expiring soon / expired /
  added this week), and the empty state offers "Add" and "Upload a document"
  actions instead of plain text.
- **Help & FAQ menu** (#191). A new `/help` page answers common questions
  (modules, invites, roles, AI extraction and privacy, notifications,
  backups, passkeys/TOTP, offline mode, troubleshooting), linked from the
  sidebar, mobile drawer, and bottom-nav "More" sheet next to Settings.

### Changed

- **Settings reorganized into user-facing categories** (#175). `/settings/app`
  is grouped into Notifications / AI and privacy / Advanced system settings;
  the `/settings/household` hub shows status summaries (member count, backup
  destination, webhook count, module count, notification status) instead of
  bare links; backup destination configuration is consolidated into
  `/settings/backups` rather than split across two pages.
- **Document extraction messaging is honest about confidence** (#172).
  Low-confidence results no longer contradict themselves; auto-filled fields
  are now visually distinguished as heuristic-matched (accent) vs
  AI-suggested (info), in both the contract form and the inbox review UI. A
  privacy notice now appears when a cloud AI provider is selected for
  extraction or the Assistant, naming which provider documents/data are sent
  to.

### Fixed

- **The dev-mode build-indicator badge no longer leaks into the app or its
  screenshots** (#178). It served no purpose in this UI and previously
  overlapped the sidebar account email in every published screenshot; it's
  now disabled at the Next.js config level rather than worked around per
  capture.

## [0.14.0] - 2026-07-31

### Breaking Changes

- **Existing iCal feed URLs stop working and must be regenerated** (#163).
  Feed tokens are now stored as a SHA-256 hash, so the plaintext values the
  migration found can't be converted and are cleared. Each user regenerates a
  feed from Settings; the new URL is shown once, at generation, and can't be
  displayed again.
- **Outstanding password-reset and invitation links are invalidated** by the
  same migration (#164) — those tokens are hashed now too. Affected users
  request a new link; the old ones expire within hours/days regardless.
- **Changing a password now signs out every session for that account**,
  including the one making the change (#168). That's the point: an attacker
  holding a stolen session is evicted. Users are redirected to /login with an
  explanation.
- **The Android app no longer connects over plain HTTP**, except to
  `localhost`, `*.local` and `*.home.arpa` (#166). Reaching a server by bare
  LAN IP over `http://` — e.g. `http://192.168.1.50:3000` — now fails, because
  Android's network security config can only allow-list domain suffixes, not
  IP ranges. Serve Hearth over HTTPS (a reverse proxy with a real certificate,
  a mesh VPN such as Tailscale, or a private CA imported from the connect
  screen), or reach it by an mDNS `.local` name. iOS already enforced this via
  App Transport Security. Android cloud backup and device-to-device transfer
  are also disabled now, so the stored server address, session cookie and any
  imported client certificate can't leave the device.

### Fixed

- **Household records are now genuinely household-wide** (#151). Several paths
  still enforced per-user ownership through `createdById`, so a member could
  see a record in the UI and then be refused when acting on it:
  - Editing or attaching a document to an inventory item created by another
    member returned "Item not found."
  - The calendar and the iCal feed only listed rows the viewing user had
    created, so each member saw a different, silently incomplete calendar.
  - Offline edits replayed through `/api/sync` were rejected for contracts,
    products, inventory items, properties, portfolios and holdings created by
    anyone else — the record synced fine for its creator and failed for
    everyone else.
  - Trade documents 404'd for members who didn't create the portfolio.

  `createdById` is retained on these rows purely as audit metadata and is no
  longer consulted for authorization. Chat threads remain private to their
  creator, unchanged.

- **The iCal feed was unreachable by actual calendar clients** (#163).
  `/api/ical` wasn't listed as a public path, so any request without a session
  — i.e. every calendar app — was redirected to `/login` instead of receiving
  the feed.

### Security

- **The container no longer runs as root** (#160). The app process runs as the
  unprivileged `node` user (uid 1000). The entrypoint still starts as root
  purely to adopt ownership of `/app/data` — earlier images ran everything as
  root, so an existing deployment's `./data` is root-owned on the host and
  would otherwise become unreadable on upgrade — then drops privileges with
  `su-exec` before running migrations or the server. That adoption is
  automatic and one-time; no action is needed on upgrade. Operators who prefer
  the container never to hold root can set `user: "1000:1000"` in
  `docker-compose.yml`, having first run `sudo chown -R 1000:1000 ./data`.
- **Base image and GitHub Actions are pinned by digest** (#160). `node:22-alpine`
  is now referenced by its multi-arch index digest, and all 12 workflow actions
  by commit SHA rather than a moving tag — whoever can move a tag can otherwise
  change what CI runs.
- **High-severity Snyk findings now block CI** (#160). Every step in the Snyk
  workflow carried `continue-on-error: true`, so it reported findings but could
  never fail. Dependency, code and container scans now gate on high severity;
  `monitor` and IaC steps stay non-blocking since they publish state rather
  than assert anything. The job is skipped entirely when `SNYK_TOKEN` isn't
  configured, so forks don't get a permanently red check.
- **Published images carry an SBOM and SLSA build provenance** (#160), via
  buildx's native attestations — inspect with
  `docker buildx imagetools inspect jaysbeekay/hearth:latest`.
- **Debug APKs are no longer published** (#160). A tagged build with no signing
  secrets configured used to fall back to attaching the *debug* APK to the
  public GitHub Release — an artifact signed with the universal Android debug
  key, which anyone can modify and re-sign, and built debuggable. Tagged builds
  without signing configured now fail loudly instead, and debug APKs are built
  only on manual `workflow_dispatch` runs.
- **Rate limiting, where there was none** (#155). Failed sign-ins, TOTP codes,
  recovery codes, password-reset requests and passkey challenge issuance are
  now throttled, along with the cost-bearing document-extraction and chat
  endpoints. Auth limits count failures only, keyed by account *and* client
  address, so guessing at one account can't lock out the household and a
  shared NAT egress doesn't either. In-memory and dependency-free: counters
  reset on restart and aren't shared across replicas, which is the right
  trade for a single-container deployment but is worth knowing.
- **Uploads are validated by content, not by the type the client claims**
  (#165). `file.type` is caller-controlled, and it decided whether a file was
  accepted, which extraction pipeline ran over it, and what Content-Type it
  was served back with. Leading bytes are now sniffed at both choke points —
  every `save*` in storage.ts and all eight extract routes. `/api/sync` also
  gained an aggregate body cap and a 200-operation limit; the per-file 15MB
  cap never bounded a request carrying many files.
- **Administrator-configurable outbound destinations are checked** (#167).
  Webhook, ntfy and Ollama URLs are validated before each request against the
  two things that are never legitimate from this app: a non-HTTP(S) scheme,
  and the cloud instance-metadata addresses (`169.254.169.254` and the
  equivalents for ECS, Alibaba, Oracle and AWS IPv6), including their
  IPv4-mapped IPv6 spellings in both dotted and hex form.

  Everything else is permitted, deliberately. Bare IP addresses and local
  hostnames are supported destinations, not suspicious ones —
  `http://192.168.1.50:8123`, `https://homeassistant.local:8123`,
  `http://ntfy:80`, `http://host.docker.internal:11434` and
  `http://localhost:11434` all work, as do link-local/APIPA and
  carrier-grade-NAT addresses. A hostname that doesn't resolve is also
  allowed through rather than refused: `.local` names need mDNS the runtime
  image doesn't have, and a service may simply be down when its webhook is
  saved. Operators with no local integrations can set
  `BLOCK_PRIVATE_NETWORK_TARGETS=true` to refuse local destinations too.
- **`importTrades` validated its input at compile time only** (#162). It took
  a `ParsedTrade[]` straight from the client with no runtime check, so NaN or
  Infinity units/prices reached the database and poisoned every downstream
  FIFO cost-basis calculation, and `type` was cast to an enum it was never
  checked against. It's now parsed with Zod, with finite-number and row-count
  limits. Chat history sent to the provider is capped at the most recent 60
  messages rather than the entire thread, and CSV imports are bounded at 5000
  rows.
- **Sessions are revalidated against the database on every read** (#168).
  Previously the role was copied into the JWT at sign-in and never revisited,
  so a demoted account kept admin rights — and a deleted account kept working
  entirely — until its token expired. A `sessionVersion` counter on User,
  bumped on password and role changes, invalidates outstanding tokens.
- Password-reset, invitation and iCal tokens are stored as SHA-256 hashes
  rather than in the clear, and are now 256-bit random values instead of
  UUIDs (#163, #164).
- Webhook signing secrets are encrypted at rest with `ENCRYPTION_KEY` (#164).
  Rows written before a key was configured keep working and are upgraded by a
  startup backfill once one is set.
- A missing `ENCRYPTION_KEY` now warns loudly at startup in production, and a
  malformed one fails fast at boot instead of at the first decrypt (#164).
- `NTFY_TOPIC` no longer defaults to `hearth-changeme-a1b2c3` in
  docker-compose (#164). Topics on the public ntfy.sh instance are
  world-readable, so a shared default meant anyone who guessed it received the
  household's reminders. Push stays off until a topic is set.
- The iCal feed sends `Cache-Control: no-store` and `Referrer-Policy:
  no-referrer`, keeping its token out of shared caches and Referer headers
  (#163).
- The unauthenticated redirect no longer copies the original query string onto
  `/login`, which had echoed bearer tokens into the login page's URL and
  history (#163).
- Added Content-Security-Policy (nonce-based, with `strict-dynamic`),
  `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
  `Permissions-Policy` and — on HTTPS requests only — HSTS to every response
  (#159). Served from `src/proxy.ts`, which now supplies its own
  unauthenticated redirect: NextAuth skips its `authorized` callback's redirect
  once a handler is present.
- First-run setup can be gated behind a new optional `SETUP_TOKEN` env var
  (#169). Until the first account exists, `/setup` is reachable by anyone who
  can reach the server, and whoever submits it first becomes the
  administrator; setting `SETUP_TOKEN` closes that window. The "no existing
  users" check also moved inside the write transaction, so two simultaneous
  requests can no longer both create an admin.
- `APP_URL` is now checked at startup and logs a warning in production when it
  isn't HTTPS (#166).
- Two published screenshots (`settings-totp-setup.png`,
  `settings-totp-codes.png`) exposed a scannable TOTP QR code, its manual
  secret, and eight recovery codes (#178). Both came from a throwaway
  scratch database, so nothing real was exposed, but they're regenerated
  with the QR, secret and codes all redacted, and without the development
  overlay that appeared on every screenshot in the set.

### Changed

- **One user-facing name per section** (#174). The warranties area called
  itself "Products" in its page title, heading and the Documents filter while
  the navigation said "Warranties"; it now says "Warranties" everywhere. The
  `/products` route, the Prisma model and the component names are unchanged —
  renaming those would break bookmarks and stored offline queues for no user
  benefit.
- **Date fields show the household's date format** (#174). A native date input
  is drawn by the platform and always uses the *browser's* locale, so a
  household set to DD/MM/YYYY still saw `07/29/2026` in every form while the
  rest of the app showed `29 Jul 2026`. Date fields now echo the chosen value
  underneath in the household's own format. The picker itself still follows
  the browser — that isn't something an attribute or CSS can change — but what
  you picked is no longer ambiguous.
- **Amounts show their currency code where a view can mix currencies** (#174).
  `Intl` already spells out non-local currencies, but the household's own
  currency collapsed to a bare `$`, which doesn't say which dollar it is. The
  Wealth pages and /spend — the views that can genuinely show several
  currencies at once — now render `AUD 1,234.50` rather than `$1,234.50`.
- Vercel no longer attempts to build this repository. `vercel.json` sets
  `git.deploymentEnabled: false`, and the README explains why serverless
  hosting isn't a target: the SQLite database, uploaded documents,
  `node-cron` schedulers and the `pdftotext`/`tesseract` extraction pipeline
  all need a long-lived process with its own disk. The deployment had been
  failing on every pull request — including ones that changed nothing but
  PNG files — which made the whole checks list easy to ignore.
- **`jaysbeekay/hearth:latest` on Docker Hub now only moves on a real
  release.** `docker-publish.yml` previously also ran on every push to
  `main` and tagged that build `latest`, so self-hosters pulling `:latest`
  got whatever had most recently merged — including in-progress or
  breaking work — rather than what a tagged version and its CHANGELOG
  entry actually describe. The workflow now runs only on a `vX.Y.Z` tag
  push (or a manual dispatch against one), tagging the image both `latest`
  and `vX.Y.Z` together.

- Setup screen's module checklist now lists Travel last, after Wealth, instead
  of first (#119). Also added a permanently-checked, disabled "Document
  management" row above the optional modules, clarifying that contract/
  warranty/document tracking is always included and isn't one of the
  toggleable modules — it isn't submitted as part of the form.

## [0.13.0] - 2026-07-30

### Breaking Changes

- **`Property.address` (a single free-text string) is replaced by structured
  `street`/`suburb`/`state`/`postcode`/`country` fields** (#128). Existing
  addresses are preserved by the migration — the full original text is
  copied into the new `street` field rather than parsed into the other
  parts, since address formats vary too much by country to split reliably.
  Re-pick a property's address via the autocomplete to populate the other
  fields precisely. Anything reading `property.address` directly (custom
  scripts, direct DB queries) will need to switch to the new fields or the
  new `formatPropertyAddress()` helper (`src/lib/utils.ts`).
- **AI document extraction and AI Assistant provider/API key/model are now
  household-wide settings, not per-user.** Previously each household member
  configured their own BYOK provider independently; now there is one shared
  configuration for the whole household, managed on System settings
  (`/settings/app`) by an admin, the same way SMTP/S3/Ollama/etc. already
  work. A migration copies any existing per-user configuration into the new
  household-wide setting (preferring an admin's config if more than one
  member had configured one) before dropping the now-unused `User` columns
  (`aiProvider`, `aiApiKeyEncrypted`, `aiModel`, `chatProvider`,
  `chatApiKeyEncrypted`, `chatModel`). Non-admin members can no longer
  configure their own provider/key — ask a household admin instead.
- **`INSURANCE` and `REGISTRATION` removed as vehicle item types** (#144) —
  redundant now that a vehicle can link directly to an insurance Contract
  (#143), with proper renewal/billing/reminder tracking. Existing
  `VehicleItem` rows of those two types are **automatically recoded to
  `OTHER`** by the migration, with the original type preserved as a
  `[Insurance]`/`[Registration]` prefix in the record's notes so nothing is
  silently relabeled without a trace. Any external tooling or exports that
  depended on those two type values will need to be updated.

### Added

- **Vehicles can now link to a Contract** (#143) — a new optional "Vehicle"
  field on the contract form (shown only when the Vehicles module is
  enabled and at least one vehicle exists), and a "Contracts & warranties
  linked to this vehicle" section on the vehicle detail page, mirroring the
  existing Property↔Contract linking (#114).
- A shared `BackLink` component, added to every "add a record" page that
  was missing a way back to the record/list it was launched from (#145):
  contracts/new, products/new, vehicles/new, vehicles/[id]/items/new,
  home/new, home/[id]/items/new, travel/new, and
  travel/[id]/segments/new.
- A warning next to the SMTP/ntfy/Ollama "Test connection" buttons in
  System settings clarifying they test the currently *saved* settings, not
  unsaved form edits (#122).
- A new **Household & System** page (`/settings/household`, admin-only)
  gathering every household-wide settings entry point (Manage household
  members, Database backups, Webhooks, Modules, System settings) in one
  place, separate from the personal Settings page.
- **Property occupancy status** (#129) — a new "Occupancy status" field
  (Owner-occupied / Rented / Vacant / Other) on the property form, settable
  at creation time instead of only discoverable via the separate rental
  tracking flow. Selecting "Rented" shows a prompt linking to rental
  tracking setup (or to the existing overview, if already set up) — this
  is additive and doesn't change how `isRented`/rental agreements work.
- **Local filesystem backup destination, and backups now use a single
  destination picker** (#137) — System settings now has one "Backup
  destination" dropdown (Local filesystem / S3-compatible storage / SFTP)
  instead of three independently-configurable sections; choosing a
  destination reveals only that destination's configuration fields, and
  only the chosen destination runs. OneDrive (also requested in #137)
  needs an OAuth-based upload flow and is deferred as a follow-up — #137
  stays open to track it.
- Preview/quick-view for product documents (#142) — previewable documents
  (images, PDFs) on a product's detail page now open in the same inline
  preview modal the Documents page already has, instead of only
  downloading/opening in a new tab. The shared modal was extracted into
  `src/components/DocumentPreviewModal.tsx` so both pages use one
  implementation.
- A worked ntfy.sh example in `docker-compose.yml`/README (#138): a
  concrete example topic with a note that public ntfy.sh topics are
  guessable and should be unguessable or token-protected, plus a
  commented-out self-hosted `binwiederhier/ntfy` service block.
- **Expiring invitation email for new household members** (#126) — with SMTP
  configured, adding a household member now sends a single-use invitation
  link (expires in 48 hours) instead of the admin choosing a password
  directly; the new member sets their own password on `/accept-invitation`.
  Without SMTP configured, admin-set passwords still work exactly as
  before. Reuses the existing password-reset token model with a new
  `purpose` field (`RESET`/`INVITE`) rather than a parallel table.
- **Optional "Sign in with GitHub"** (#116) — set `GITHUB_CLIENT_ID`/
  `GITHUB_CLIENT_SECRET` to show a GitHub sign-in button on the login page.
  Sign-up stays invite-only: a GitHub sign-in only succeeds for an email
  that already has an admin-invited Hearth account, matched by verified
  email — it never auto-creates an account. Existing TOTP/passkey
  second-factor and role model are unaffected, since GitHub sign-in is
  just a different way to establish the same session.

### Changed

- Property address is now entered as separate Street/Suburb/State/Postcode/
  Country fields instead of one free-text field (#128), still driven by the
  same OpenStreetMap autocomplete — picking a suggestion now populates all
  five fields. The Label field auto-fills from the suburb when left blank
  and a suggestion is picked (only if Label is still empty, so it never
  overwrites something you've already typed).
- The property map now loads tiles from CARTO's free basemap service
  instead of OpenStreetMap's own raw tile server, which its usage policy
  reserves for light/evaluation use rather than production embedding
  (#130). OpenStreetMap attribution is unchanged.
- Settings is now clearly split into two screens: the main Settings page
  (`/settings`) holds only settings that affect your own account —
  Profile, Notifications, Preferences, Security, iCal feed, Change
  password — while everything shared by the whole household lives on the
  new Household & System page and its sub-pages (#121).
- AI document extraction and AI Assistant settings moved from the personal
  Settings page to System settings (`/settings/app`), reflecting that
  they're now household-wide and admin-managed (see Breaking Changes
  above). Saving no longer requires re-entering the API key on every
  save — like every other secret in System settings, it's only
  overwritten when a new value is actually submitted.
- The AI document extraction and AI Assistant provider settings now show
  a persistent "Leave blank to use the default: `<model>`" hint under the
  Model field, instead of relying solely on a placeholder that disappears
  on focus and never confirms which model is actually in effect once
  saved (#123).
- Sidebar, mobile nav drawer, and bottom-nav "More" sheet now group nav
  items into "Modules" (Contracts, Warranties, plus enabled optional
  modules) and "Tools" (Documents, Assistant, Calendar, Spending)
  sections, with Dashboard standing alone above both (#125). The
  "Assistant" nav item is now hidden entirely for users who haven't
  configured an AI provider, instead of linking to a page that can't do
  anything (#135).
- Vehicle detail page: make/model/year/license plate moved out of an
  unlabeled subtitle above the page heading into the same labeled details
  card as Colour/VIN/Rego expiry/Insurance expiry (#146).
- `ContractForm`'s main field grid is now grouped under a "Contract /
  policy details" heading, matching the existing "Contact details
  (optional)" section directly below it (#133).
- Settings preferences and notification forms now surface a specific,
  visible error when a save fails, instead of silently discarding the
  whole submission on any single invalid field (#120). `FormMessage` now
  toasts on error as well as success, so an inline validation error (e.g.
  switching AI provider without an API key) is no longer easy to miss
  (#124).
- Product form: "Warranty end date" now auto-suggests 12 months after
  "Purchase date" when left blank, using the same auto-fill highlight
  styling as AI-extracted fields — only fills in if you haven't already
  entered your own warranty end date (#131).
- The dashboard's "Est. monthly spend" tile now shows a visible warning
  banner (not just a small `*` footnote) when contracts billed in a
  currency without a usable exchange rate are excluded from the total,
  and logs a server-side warning naming the affected currencies so it's
  diagnosable from logs (#132).

### Fixed

- **Contract, product, vehicle, travel, property, and wealth exports
  (CSV/PDF) only included records the current user personally created**,
  contradicting the app's household-wide data model — every other query
  for these entities has no such filter. A household member who didn't
  create the records they were exporting got a blank or near-empty file.
  Removed the filter from all 6 export routes (#140).
- Settings crashed with a raw, unhandled Prisma error if the signed-in
  user's account had been deleted elsewhere (JWT sessions don't
  re-validate against the database). Now redirects to `/login` instead
  (#141).
- Settings save actions for SMTP/ntfy/Ollama/barcode/S3/SFTP/schedule/
  flight-status had no error handling around their writes, so a
  misconfigured `ENCRYPTION_KEY` surfaced as a generic, unreadable Server
  Components error instead of a specific message (#118).
- Contracts' filter toolbar (search box, category/status selects, Filter
  button) used three different height rules and didn't visually line up.
  Standardized to one consistent height. The Products list toolbar had the
  identical mismatch and was fixed at the same time (#127).
- Barcode lookup failures (rate-limited, unreachable, not found) all
  looked identical — a silent no-op with no indication why. `lookupBarcode()`
  now returns a specific reason, surfaced as a specific message on the
  product form (#139). Keyless lookups already worked via UPCitemdb's
  rate-limited trial endpoint; this only improves diagnosability of
  failures, since the underlying "no API key required" behavior was
  already correct.

## [0.12.1] - 2026-07-29

### Fixed

- **The AI Assistant's own description text (Settings and the Assistant page
  header) still said it was strictly read-only** — stale since #68 shipped
  guarded write proposals. Updated both to describe the confirm-before-write
  behavior instead. Found during a routine screenshot-accuracy audit.
- Regenerated `docs/screenshots/settings-ai.png`, `spend.png`, and
  `assistant.png`, which were stale in ways beyond copy: `settings-ai.png`
  predated the current side-by-side desktop grid layout for the two AI
  cards, and `spend.png` still showed "Home"/"Home tax deductible" column
  headers from before the #114 rename.

## [0.12.0] - 2026-07-29

### Added

- **Contracts and Products (warranties) can now be linked directly to a
  Property** (#114) — a new optional Property field on both forms (shown
  only when the Property module is enabled), and a "Contracts & warranties
  linked to this property" section on the Property detail page listing
  everything linked to it. This is separate from the existing
  rental-agreement-to-contract link, which is specifically for the lease
  itself — a contract can now be tied to a property regardless of whether
  there's a rental agreement at all.

### Changed

- **The "Home" module is now labelled "Property"** throughout the UI (#114)
  — the underlying data model was already called `Property`
  (`prisma/schema.prisma`), so this just fixes the user-facing naming
  mismatch that was causing confusion. Updated: the module registry label,
  the property list page's heading ("Home" → "Properties"), the quick-add
  menu item, search result groups, the /spend table column header, the
  calendar event-type label, the documents type filter, and a few
  module-disabled API error messages. The `ModuleKey` enum value (`HOME`)
  and the `/home` route path are unchanged — renaming those would need a
  data migration and would break existing bookmarks for a purely cosmetic
  win, so that's left for a separate, explicit decision if ever wanted.

## [0.11.2] - 2026-07-29

### Added

- **A left-side navigation drawer, reachable by a left-edge swipe or a new
  menu button in the mobile top bar** (#112) — shows the full nav list
  (everything `Sidebar` shows on desktop, plus Settings) from any page, not
  just the bottom nav's 4 primary items or its "More" sheet. The edge-swipe
  only starts tracking a touch that begins within 24px of the screen's left
  edge and only opens past a deliberate drag threshold, so it can't be
  triggered from a mid-screen touch and doesn't collide with
  `SwipeableListItem`'s left-drag-to-reveal (opposite direction). Whether the
  OS's own back-gesture intercepts a touch in that same edge zone before this
  handler sees it depends on the platform/WebView and isn't verifiable
  without a real device — the visible menu button is the reliable fallback
  either way, and existing bottom-nav/tap navigation is unchanged.

### Fixed

- **The native app shell's pre-login "connect to your server" screen now
  matches the current design system's danger color** (#103) — its
  `--danger` token had drifted from `src/app/globals.css` after a rebrand
  pass updated one file and not the other. The web `/login` and `/setup`
  pages were already visually identical and needed no change.
- **Android: the on-screen keyboard now resizes the layout instead of
  panning/scrolling it** (#109) — added
  `android:windowSoftInputMode="adjustResize"` to `MainActivity`. Not
  verified against a real Android device/emulator in this environment.

### Closed

- **#91** (mobile-centric navigation) closed as substantially satisfied by
  the bottom-sheet overflow menu and touch-target work (#92), swipe-to-delete
  on contracts (#94), and this release's navigation drawer (#112).

## [0.11.1] - 2026-07-29

### Fixed

- **Mobile top bar and bottom nav now respect the device's safe-area insets**
  (#104, #105) — on Android edge-to-edge layouts they no longer overlap the
  status bar or get hidden behind the gesture bar, matching the pattern the
  "More" sheet already used.
- **The "← Back to contracts" link's arrow is now a properly flex-aligned
  icon** instead of a bare text glyph that could sit off-baseline (#110).

### Changed

- **The contract detail page's "Cancel"/"Reactivate" button is now labelled
  "Mark as cancelled"/"Mark as active"**, with a clearer confirmation message,
  so it reads unambiguously as a reversible status change rather than the
  permanent "Delete" action tucked in the overflow menu (#111).
- **The Dashboard's Documents section no longer shows "Uploaded this week"**
  (#107) — considered low-value clutter; "Needs review" and "Total documents"
  remain.
- **Dashboard stat tiles are now clickable** where there's a sensible
  destination (#106) — Active contracts, Est. monthly spend, Products
  tracked, Needs review, Total documents, and Vehicles needing attention all
  link through to the relevant filtered view. Tiles with no direct filter
  support (e.g. the 30-day-expiry counts) are left non-interactive rather
  than linking somewhere misleading.
- **The Dashboard's four contracts/warranties sub-sections are now grouped
  under a single "Contracts & Warranties" heading** (#108), matching the
  existing "Documents" section pattern.

## [0.11.0] - 2026-07-27

### Added

- **Records created while offline can now be edited or discarded before they
  sync** (#64). Contracts, Products, Vehicles, Travel, Home, and Inventory
  list pages now show a "Pending sync" card for anything created while
  offline — editing it updates the same queued entry in place instead of
  creating a duplicate, and discarding it removes the queued entry (and any
  staged files) entirely, with no server request ever sent. Wealth/portfolios
  doesn't have an equivalent list-client wrapper yet, so it's not covered by
  this pass.
- **The AI Assistant now streams its replies token-by-token** instead of
  waiting for the full answer (#67), across all five providers (Anthropic,
  OpenAI, Gemini, Ollama, OpenRouter) — each now parses its own streaming
  wire format (SSE or newline-delimited JSON) via a shared stream reader.
  Tool-calling rounds now also surface a brief "Checking …" status while a
  tool runs. Verified against each provider's documented wire format with
  synthetic fixtures, and end-to-end against a local mock streaming server;
  live testing against the real cloud providers wasn't possible in this
  environment (no outbound access/API keys), so keep an eye out for
  provider-specific streaming quirks in the wild.
- **The AI Assistant can now propose creating or updating a contract or
  product** (#68) — for Contracts and Products, the two always-on domains;
  Trips/Vehicles/Properties/Inventory aren't covered yet, but the same
  pattern (guarded `propose_*` tools + a confirm/cancel card) extends
  directly. A proposal never writes anything by itself: the model calls a
  `propose_create_*`/`propose_update_*` tool, which validates the fields
  against the same Zod schema the real form uses and returns them for
  display — the actual write only happens if the user explicitly confirms it
  in a card shown under the assistant's reply, via the same validated,
  `requireUser()`-gated action every form already uses. READONLY-role users
  never see these tools offered at all, and a write attempt is rejected even
  if one somehow reached them.
- **The overflow ("⋮") menu's mobile bottom-sheet redesign now extends to
  touch gestures** (#91 continued): contract cards on the Contracts list can
  be swiped left to reveal a quick Delete action (still routed through the
  same confirmation dialog used everywhere else) — a touch-only accelerator
  alongside the existing tap-through-to-detail-page path, not a replacement
  for it. Swipe-to-go-back wasn't added deliberately — modern mobile browsers
  already provide it natively, and a custom implementation would conflict
  with that. Other list pages don't have the swipe action yet; the pattern
  (`SwipeableListItem`) is reusable for them as a follow-up.

## [0.10.3] - 2026-07-27

### Added

- **The external MCP server (`/api/mcp`) now exposes products, trips, vehicles,
  properties, inventory, and net worth**, matching the breadth of read-only
  data the in-app AI Assistant already has — previously it only covered
  contracts. Six new tools: `list_products`, `list_trips`, `list_vehicles`,
  `list_properties`, `list_inventory_items`, and `net_worth`. Module-gated
  tools (everything but contracts/products) are only listed when the
  corresponding optional module (Travel, Vehicles, Home, Inventory, Wealth) is
  enabled for the household, mirroring the Assistant's behavior. Still
  strictly read-only — no new write capability.

### Changed

- The Assistant's chat tools and the MCP server's tools now share the same
  underlying Prisma query/serialization functions (`src/lib/domainQueries.ts`)
  instead of each re-deriving the same queries independently.

## [0.10.2] - 2026-07-27

### Changed

- **The overflow ("⋮") menu on detail pages (Contracts, Products, Vehicles,
  Inventory, Home, Travel) now opens as a full-width bottom sheet on mobile**
  instead of a small anchored dropdown, making its actions easier to hit with
  a thumb. Desktop keeps the existing dropdown. The menu's trigger button, and
  the mobile search/sign-out buttons in the top bar, were also enlarged to a
  44×44px minimum touch target.

## [0.10.1] - 2026-07-27

### Fixed

- **Pages required horizontal scrolling on mobile phone screens.** Two
  causes: the `/spend` page's "Actuals by financial year" table had no
  `overflow-x-auto` wrapper, and the detail-field grid used on Contracts,
  Products, Vehicles, Inventory, Home, Home rental, Travel, Wealth holdings,
  and Settings (Profile) didn't let a long unbroken value (a long email
  address, policy number, etc.) wrap or shrink, forcing the whole page wider
  than the screen. Both fixed; content now wraps or scrolls within its own
  container instead of the page.

## [0.10.0] - 2026-07-27

### Changed

- **Products now track Brand, Model, and Description separately**, matching
  how most retail invoices itemise a purchase. The previous single "Product
  name" field is now "Description" (e.g. "6kg Vented Dryer"); "Manufacturer"
  is now labelled "Brand"; and there's a new "Model" field (e.g. a model
  number/code). Existing products keep their data — the old name value
  becomes the new description. Search, exports, calendar/iCal feeds,
  warranty-reminder notifications, and the AI Assistant's product tool all
  updated to match.

## [0.9.1] - 2026-07-27

### Fixed

- **Spend and Wealth totals no longer silently sum different currencies as if
  they were the same currency.** The `/spend` page's summary tiles and
  monthly/yearly/category timelines, the dashboard's "Est. monthly spend"
  stat, and `getNetWorth()`'s share/property/inventory totals now convert
  amounts to a common currency using live exchange rates before aggregating,
  instead of adding raw numbers together (or, for the dashboard, silently
  excluding non-matching-currency contracts). Falls back to excluding an
  amount (with a small caveat note) only if a live rate genuinely can't be
  fetched.
- **Live equity price fetching for the Wealth module was silently broken** —
  `yahoo-finance2` v3 requires instantiating its default export
  (`new YahooFinance()`) rather than calling methods on it directly, so every
  price/historical-price request was failing and being swallowed by existing
  error handling. Fixed in `src/lib/prices.ts` (and used correctly in the new
  FX-rate module above).

Bump to 0.9.1.

### Added

- **Region setting** (Settings > Preferences) — a new per-user "Region" field
  controls number formatting conventions (decimal/thousands separators,
  currency symbol placement) throughout the app, independent of the existing
  date format, default currency, and timezone fields. This is a
  regionalisation-only change (part of #81); it does not add a language
  picker or translate any UI text — English strings are unchanged regardless
  of region. Defaults to the existing Australian convention, so behavior is
  unchanged for anyone who doesn't touch the new setting.

## [0.8.2] - 2026-07-25

### Fixed

- **Wealth module was scoped to whoever created each record, not the whole
  household** — a household member could only see the portfolios, holdings,
  and net worth they personally added, unlike every other module (Contracts,
  Trips, Vehicles, Home) which is already shared household-wide. Portfolios,
  holdings, trades, property valuations, and the `/spend` page's contract and
  home/vehicle spend totals are now visible and editable by every household
  member, matching the app's documented "household-wide, not per-user"
  data model.

## [0.8.1] - 2026-07-21

### Removed

- **Public demo mode**, added in 0.8.0. It was only ever intended for
  personal use running a sample instance on a personal website, not as a
  general self-hosting feature — since `DEMO_MODE` was a runtime toggle,
  anyone pulling the published Docker image could have turned it on
  themselves. Removed entirely rather than just left undocumented, so the
  capability doesn't exist in the image at all.

## [0.8.0] - 2026-07-21

### Added

- **AI chat assistant** — a new "Assistant" section where a household member
  can ask natural-language questions about their own contracts, warranties,
  trips, vehicles, home, inventory, and wealth, backed by their choice of
  Anthropic, OpenAI, Google Gemini, OpenRouter, or a local Ollama endpoint.
  It's read-only (it can look things up, but never creates, edits, or
  deletes anything) and uses its own independent BYOK provider/key/model
  settings, separate from the existing document-extraction AI settings.
- **Public demo mode** (`DEMO_MODE=true`) for running a separate, publicly
  reachable instance that lets visitors try the app with a single shared
  account (no signup) and realistic sample data, reset automatically every
  hour. Ships with its own `docker-compose.demo.yml` and a Caddy
  reverse-proxy example for running it alongside a real instance.

## [0.7.0] - 2026-07-15

### Added

- **Full offline support across every module** — offline entry, editing, and
  deletion now work for every household record type (previously only
  Contracts, Products, and Vehicles), including file/photo attachments
  staged locally and synced automatically on reconnect. Documents can also
  be explicitly downloaded for offline viewing (and deleted while offline),
  with a Settings panel to review and manage what's stored on-device.
- Conflict detection for offline edits — if a record changed elsewhere
  while you were editing it offline, the sync is flagged for review instead
  of silently overwriting the newer change.
- A unified Documents view across all modules, with search, filtering, and
  inline preview.
- Search now matches document content (extracted/OCR'd text), not just
  filenames and titles.
- AI-extraction confidence indicators and auto-filled-field highlighting
  when a document's fields are pre-filled.
- A first-run activation checklist and upload-first entry flow for new
  households.
- Document-count and last-updated metadata on list cards and detail pages.
- `PRIVACY.md`, documenting what data the app handles and exactly what each
  optional integration sends and where.
- CI now builds a signed Android App Bundle (`.aab`) for Play Store
  submission, alongside the existing debug/release APKs.

### Changed

- Warmer household color palette (new `info` token, warm-neutral retint).
- The Android and iOS app identifiers both changed to `com.hearth.app`
  (from `com.jaysbeekay.contracts`) for consistency between platforms.

### Fixed

- A corrupted iOS Xcode project reference that could crash project loading.
- A wrong `Certificate` import in the Android mTLS client-cert manager that
  broke compilation.
- Several moderate-severity transitive dependency vulnerabilities.

## [0.6.0] - 2026-07-11

### Added

- **Two-factor authentication (TOTP)** — optional authenticator-app-based 2FA,
  gated on `ENCRYPTION_KEY` being configured. Settings > Security walks through
  QR-code setup, confirms with a 6-digit code, and shows 8 one-time recovery
  codes for account recovery. Login prompts for a code (or a recovery code)
  after the password step when enabled.
- **Password reset via email** — "Forgot your password?" on the login page
  (shown only when SMTP is configured) sends a single-use, 1-hour link.
  Responses are identical whether or not the email matches an account, to
  avoid leaking which addresses have accounts.
- **Property address autocomplete + map** — property addresses now autocomplete
  against OpenStreetMap (via a server-side proxy), and the property detail page
  shows a Leaflet map when a location has been picked.
- **Link rental agreements to contracts** — a Rental-category contract can be
  linked to a property's rental agreement, surfacing tenant, lease dates, and
  rent on both records.
- **Ollama and OpenRouter as BYOK AI providers** — alongside Anthropic, Gemini,
  and OpenAI, for document field extraction. Ollama uses the existing
  system-wide connection instead of a per-user API key.
- **Read-only household role** — a third role (alongside Admin and Member)
  that can view all data but is blocked from creating, editing, or deleting
  records; admins manage member roles from Settings > Household members.
- **Yearly spend view + category breakdown** — the Spend page gains a
  Monthly/Yearly toggle and a per-category spend breakdown.
- **Currency dropdown** — currency fields across all forms are now a searchable
  dropdown of ~20 common currencies instead of free text.
- **Connection test buttons** — SMTP, ntfy, and Ollama settings each get a
  "test connection" button that reports success or failure inline.
- **Per-user preferences** — date format, default currency, and timezone are
  now configurable per user and applied throughout the app (lists, detail
  pages, exports).

### Changed

- Settings moved to the bottom of the sidebar, alongside sign-out.
- The `WARRANTY` contract category was removed from the "add contract" form
  (existing warranty contracts are unaffected).

### Fixed

- A blocked mutation (e.g. a read-only user attempting to save) no longer
  crashes to a raw browser error page — it now shows a friendly in-app message
  with a way back to the dashboard.

## [0.5.0] - 2026-07-05

### Added

- **Wealth module** — opt-in portfolio tracker and net worth dashboard. Track
  share, ETF, and crypto portfolios; add holdings and record buy/sell/split
  trades with attached documents. Live price feeds via Yahoo Finance (equities:
  ASX, NYSE, NASDAQ, LSE, TSX, etc.) and CoinGecko (crypto), cached with
  15-min/5-min TTLs and auto-refreshed every 15 minutes by a background cron.
  FIFO cost basis — BUY accumulates units and cost (including fees), SELL
  reduces proportionally, SPLIT adds units only — with unrealised gain/loss
  and gain% shown per holding and per portfolio.
- **CSV broker import** — upload a brokerage export and the app auto-detects
  CommSec, SelfWealth, Stake, or generic format, shows a preview of parsed
  rows, and imports on confirm. CommSec tickers get `.AX` suffix automatically;
  SelfWealth and Stake use the exchange/market field.
- **Net worth dashboard** — `/wealth` combines portfolio market value,
  property valuations (HOME module), and inventory items at purchase price
  (INVENTORY module) into a unified net worth figure with an inline SVG donut
  breakdown by asset class and a top-holdings grid.
- **Property valuations** — new section on each HOME property detail page to
  record estimated values (date, amount, currency, source, notes). An amber
  warning appears when no valuation exists or the latest is over 12 months old,
  and the most recent valuation feeds into the net worth calculation.
- **Wealth export** — download all portfolio trades as CSV or PDF from
  `/api/export/wealth`.

## [0.4.0] - 2026-07-04

### Added

- **Vehicles module** — track cars, motorbikes, and other vehicles with make,
  model, year, colour, licence plate, and VIN. Log service history, repairs,
  registration, roadworthy checks, insurance, and modifications against each
  vehicle with provider, date, cost, and attachable receipt/invoice. AI-assisted
  field extraction pre-fills record details from uploaded documents. Configurable
  expiry-date reminders for registration and insurance lapses — same
  threshold/channel system (email, ntfy, webhook) as contracts.
- **Offline write queue** — while offline, create and edit contracts, products,
  and vehicles; changes are queued in IndexedDB and replayed automatically
  via `/api/sync` when connectivity is restored. An amber/green sync strip
  shows queue status and lets you retry manually.
- **Android native wrapper** (`android/`) — thin Capacitor shell matching the
  iOS wrapper: server URL entry, camera permissions for barcode scanning, and
  full mTLS client-certificate support via a custom `BridgeWebViewClient`
  subclass that intercepts TLS challenges and responds with the imported PKCS12
  credential.

## [0.3.0] - 2026-07-03

### Added

- **Passkeys / WebAuthn** — register Face ID, Touch ID, or a security key as
  an alternative to your password from **Settings → Security**. Passkeys are
  per-user and opt-in; passwords continue to work as normal. Signing in with a
  passkey appears as a second button on the login page below the email/password
  form. Requires `APP_URL` to be set to the correct origin (its hostname
  becomes the WebAuthn Relying Party ID).
- **Offline read cache** — a service worker (via `@serwist/next`) caches
  navigation responses and RSC payloads using NetworkFirst strategies, so
  previously-visited pages are still browsable when your home server is
  unreachable. Each list page (contracts, products, travel, home) also
  persists the fetched data to IndexedDB on every successful load. When
  connectivity is lost an amber banner appears at the top of the screen and
  "Add" buttons are disabled until you reconnect.

## [0.2.1] - 2026-07-01

### Added

- **DB-backed application settings** — SMTP, ntfy push, Ollama, barcode
  lookup, S3/SFTP backup destinations, and cron schedules are now
  configurable from Settings > System in the admin UI, with no Docker
  restart required. Sensitive values (passwords, tokens, keys) are
  encrypted at rest with AES-256-GCM when `ENCRYPTION_KEY` is set.
  Environment variables remain as fallbacks for zero-migration upgrades.
- **Rental tracking** on Home properties — record rental agreements with
  weekly rent, tenant name, lease dates, and bond amount, then import
  monthly property-manager statements via file upload with AI-assisted
  extraction and automatic reconciliation against expected rent. Supports
  REIWA Form 1AA lease extraction.

## [0.2.0] - 2026-07-01

### Added

- **Opt-in module system** — admins choose which modules to enable at
  first-run setup and can toggle them on/off later from Settings > Modules.
  Nav items and all routes for disabled modules are hidden and redirect to
  the dashboard.
- **Travel module** — TripIt-style itinerary tracker with Flight, Lodging,
  and Activity segment types. Supports AI-assisted field extraction from
  uploaded confirmation documents (mirroring the existing Contract flow),
  manual entry, and per-segment document storage with authenticated download.
- **Home module** — property and maintenance/improvement/repair tracker.
  Track multiple properties with address, notes, and a full item history
  including provider, date, cost, and supporting documents. AI-assisted
  field extraction from uploaded invoices is supported.
- **Tax-deductible tracking** on home items — mark individual items as tax
  deductible and see a summary of tax-deductible spend broken down by AU
  financial year (1 Jul–30 Jun) on the Home list page.
- **Playwright e2e test suite** (28 tests) covering regression, module-toggle
  gating, Travel CRUD, upload security, and authorisation, running
  automatically on every push and pull request via GitHub Actions.

### Fixed

- Document upload body-size limits now consistently allow up to 15 MB across
  both Server Actions and API routes (previously the Server Action limit was
  1 MB, causing uploads over that size to hard-crash rather than show a
  friendly validation error).
- Heuristic field extraction: `findCost` no longer over-matches on the word
  "fee"; `findCompanyLine` skips lines containing dollar amounts or GST/total
  keywords so tax-summary lines are not mistaken for a company name.

## [0.1.0] - 2026-06-27

### Added

- Contract and product/warranty tracking with CRUD, list views, and expiry
  badges.
- Reminder notifications via email (SMTP) and push (ntfy) on configurable
  per-item thresholds, plus signed webhook delivery for integrations like
  Home Assistant or an MCP agent.
- Dashboard overview of upcoming expirations.
- Multi-user households with an admin setup flow and Auth.js-based
  authentication.
- Bring-your-own-key AI field extraction (Anthropic, Gemini, or OpenAI) to
  auto-fill contract/product details from an uploaded document; keys are
  encrypted at rest (AES-256-GCM).
- Barcode scanning for product entry.
- Read-only MCP server for querying contracts and products from an LLM.
- Encrypted offsite database backups to S3 and/or SFTP.
- Native iOS wrapper app (Capacitor) with mTLS client-certificate support.
- Self-hosting via Docker / docker-compose, with an nginx + mTLS
  access-lockdown guide.
