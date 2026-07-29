# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/), starting at `0.1.0`.

## [Unreleased]

### Breaking Changes

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

### Changed

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
