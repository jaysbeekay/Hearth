# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/), starting at `0.1.0`.

## [Unreleased]

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
