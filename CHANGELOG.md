# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/), starting at `0.1.0`.

## [Unreleased]

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
