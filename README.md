# Hearth

A self-hostable household management app. Track contracts and warranties, plan
trips, log home maintenance, and manage rental properties — all in one place,
with optional reminders before anything expires.

## Quick start

```bash
docker compose up -d
```

Open `http://localhost:3000` — you'll be sent to `/setup` to create the first admin account.

**Minimum required environment variables:**

| Variable | Description |
|---|---|
| `DATABASE_URL` | SQLite path — defaults to `file:/data/app.db` inside the container |
| `AUTH_SECRET` | Session signing key — generate with `openssl rand -base64 32` |

Everything else is optional. Set `SMTP_*` to enable email reminders, `NTFY_*` for push notifications, `OLLAMA_BASE_URL` for local AI extraction, and `S3_*` / `SFTP_*` for offsite backups. See the full reference below and `.env.example` for all available variables.

## Features

**Contracts & warranties**
- Track contracts (insurance, telecom, subscriptions, loans, rentals, and more)
  with provider, dates, cost, billing frequency, renewal type, and contact details
- Track product warranties with manufacturer, vendor, serial number, purchase date,
  and price — attach an invoice or product photo
- Scan a product's barcode (UPC/EAN) to auto-fill name and brand from an online database
- Attach documents (PDF/images/Word) to contracts or products — uploading a document
  auto-fills fields like provider, dates, and cost via AI/heuristic extraction
- Configurable reminder thresholds per contract/product (e.g. 30/14/7/1 days before expiry)
- Reminders via email (SMTP) and/or push notifications ([ntfy](https://ntfy.sh))

**Travel** *(opt-in module)*
- Plan trips as itineraries with flight, lodging, and activity segments
- Upload booking confirmations — AI extraction pre-fills confirmation codes, dates, locations, and costs
- Shared household-wide so all members can view each other's trips

**Home** *(opt-in module)*
- Track properties and log maintenance, repairs, and improvements against each one
- Attach receipts/invoices and record costs, providers, and dates
- Manage rental agreements and track rental income statements per property

**Wealth** *(opt-in module)*
- Track share, ETF, and crypto portfolios — full CRUD for portfolios, holdings, and trades with document attachments
- Live price feeds via Yahoo Finance (equities — ASX, NYSE, NASDAQ, LSE, TSX, etc.) and CoinGecko (crypto); prices are cached and auto-refreshed every 15 minutes
- FIFO cost basis calculation; unrealised gain/loss and gain% shown per holding and per portfolio
- Import trades from a broker CSV — auto-detects CommSec, SelfWealth, Stake, and generic formats; preview before confirming
- Net worth dashboard combining portfolio value, property valuations (HOME module), and inventory items (INVENTORY module) with a live donut breakdown
- Property valuations: record estimated values against each HOME property; staleness warning after 12 months

**Vehicles** *(opt-in module)*
- Track cars with make, model, year, licence plate, VIN, and registration/insurance expiry dates
- Log service history, repairs, registration, roadworthy checks, and modifications against each vehicle
- Attach receipts/invoices to any record
- Configurable reminders before rego or insurance lapses — same threshold/channel system as contracts
- AI extraction pre-fills service record details when you upload a receipt or invoice

**Passkeys**
- Register Face ID, Touch ID, or a security key as an alternative to your password from **Settings → Security**
- Passkeys are per-user and opt-in — passwords continue to work normally
- Signing in with a passkey appears as a second button on the login page
- Requires `APP_URL` to be set to the correct hostname (used as the WebAuthn Relying Party ID)

**Platform**
- Optional bring-your-own-key AI extraction (Claude/Gemini/OpenAI) per user for higher accuracy
- DB-backed system settings — configure SMTP, ntfy, Ollama, S3/SFTP backup, and more from the UI
- Offsite database backups to S3-compatible storage or SFTP on a configurable schedule
- Dashboard with active/expiring/expired counts and estimated monthly spend
- Multi-user/household accounts — everyone sees the same data
- Admin-invite-only (no public sign-up) since this stores sensitive household data — with SMTP configured, adding a member sends a 48-hour expiring invitation link to set their own password, instead of the admin choosing one
- Optional "Sign in with GitHub" on the login page (`GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`) — still only works for an email with an existing admin-invited account, it doesn't bypass the invite-only model
- Mobile-friendly responsive UI, installable as a PWA ("Add to Home Screen")
- **Offline read cache** — a service worker caches previously-visited pages so they're still browsable when your home server is unreachable; an amber banner appears and writes are queued locally and synced automatically when you reconnect. Records created offline show up immediately as a "Pending sync" card on their list page — editable or discardable before they've synced (Contracts, Products, Vehicles, Travel, Home, Inventory)
- **AI Assistant** (bring-your-own-key chat) streams its replies as they're generated and can propose creating/updating a contract or product — you review and confirm before anything is saved
- SQLite storage — a single file, easy to back up, no separate database service
- Opt-in modules: enable Travel, Home, Vehicles, Inventory, and/or Wealth at first-run setup, or toggle from Settings later

## Screenshots

*(Sample data shown — not a real account.)*

| Dashboard | Contracts |
| --- | --- |
| ![Dashboard](docs/screenshots/dashboard.png) | ![Contracts list](docs/screenshots/contracts-list.png) |

| Contract detail | Travel — trips |
| --- | --- |
| ![Contract detail](docs/screenshots/contract-detail.png) | ![Travel list](docs/screenshots/travel-list.png) |

| Trip detail | Vehicles |
| --- | --- |
| ![Trip detail](docs/screenshots/trip-detail.png) | ![Vehicles list](docs/screenshots/vehicles-list.png) |

| Vehicle detail | Property list |
| --- | --- |
| ![Vehicle detail](docs/screenshots/vehicle-detail.png) | ![Property list](docs/screenshots/home-list.png) |

| Property detail — map | Settings — modules |
| --- | --- |
| ![Property detail](docs/screenshots/property-detail.png) | ![Settings — modules](docs/screenshots/settings-modules.png) |

| Spend — yearly view | Contract — linked rental agreement |
| --- | --- |
| ![Spend](docs/screenshots/spend.png) | ![Contract rental link](docs/screenshots/contract-rental-link.png) |

| Settings — personal account | Settings — household & system |
| --- | --- |
| ![Settings — personal](docs/screenshots/settings-personal.png) | ![Settings — household & system](docs/screenshots/settings-household-system.png) |

| Settings — household members | Settings — AI provider |
| --- | --- |
| ![Settings — household](docs/screenshots/settings-household.png) | ![Settings — AI](docs/screenshots/settings-ai.png) |

| Two-factor setup | Two-factor recovery codes |
| --- | --- |
| ![TOTP setup](docs/screenshots/settings-totp-setup.png) | ![TOTP recovery codes](docs/screenshots/settings-totp-codes.png) |

| Forgot password | Upload documents |
| --- | --- |
| ![Forgot password](docs/screenshots/forgot-password.png) | ![Upload documents](docs/screenshots/import.png) |

| Documents | AI Assistant |
| --- | --- |
| ![Documents](docs/screenshots/documents.png) | ![Assistant](docs/screenshots/assistant.png) |

## Tech stack

Next.js (App Router) + TypeScript, Prisma 7 (SQLite via `@prisma/adapter-libsql`),
NextAuth v5 (credentials + JWT sessions), Tailwind CSS v4, Zod, node-cron.

## Running locally

Requires Node.js 22+.

```bash
npm install
cp .env.example .env
# generate a secret and put it in .env as AUTH_SECRET
openssl rand -base64 32

npx prisma migrate deploy
npm run dev
```

Open <http://localhost:3000> — you'll be sent to `/setup` to create the first
(admin) account. Additional household members can be added from Settings once
you're signed in.

## Self-hosting with Docker

```bash
cp .env.example .env
# edit .env: set AUTH_SECRET (required), and optionally SMTP_*/NTFY_* for reminders
docker compose pull
docker compose up -d
```

This pulls the prebuilt image from
[Docker Hub](https://hub.docker.com/r/jaysbeekay/hearth), runs pending
Prisma migrations automatically on container start, and serves the app on
port 3000. The SQLite database (`data/app.db`) and uploaded documents
(`data/uploads/`) live in `./data` on the host, mounted into the container —
back up that directory to back up everything.

[`docker-compose.yml`](docker-compose.yml):

```yaml
services:
  app:
    image: jaysbeekay/hearth:latest
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: file:./data/app.db
      UPLOADS_DIR: ./data/uploads
      AUTH_SECRET: ${AUTH_SECRET}
      APP_URL: ${APP_URL:-http://localhost:3000}
      AUTH_TRUST_HOST: ${AUTH_TRUST_HOST:-}
      REMINDER_DEFAULT_DAYS: ${REMINDER_DEFAULT_DAYS:-30,14,7,1}
      REMINDER_CRON_SCHEDULE: ${REMINDER_CRON_SCHEDULE:-0 8 * * *}
      SMTP_HOST: ${SMTP_HOST:-}
      SMTP_PORT: ${SMTP_PORT:-587}
      SMTP_SECURE: ${SMTP_SECURE:-false}
      SMTP_USER: ${SMTP_USER:-}
      SMTP_PASSWORD: ${SMTP_PASSWORD:-}
      SMTP_FROM: ${SMTP_FROM:-Hearth <no-reply@localhost>}
      # Push notifications via ntfy.sh (or a self-hosted instance — see the
      # commented-out "ntfy" service below). Topics on the public ntfy.sh
      # instance are unauthenticated by default and guessable by anyone who
      # knows the name, so pick something long/unguessable (e.g.
      # "hearth-a1b2c3d4e5"), not something like "family-reminders". Set
      # NTFY_TOKEN if your topic is access-controlled.
      NTFY_URL: ${NTFY_URL:-https://ntfy.sh}
      NTFY_TOPIC: ${NTFY_TOPIC:-hearth-changeme-a1b2c3}
      NTFY_TOKEN: ${NTFY_TOKEN:-}
      CRON_SECRET: ${CRON_SECRET:-}
      MCP_TOKEN: ${MCP_TOKEN:-}
      OLLAMA_BASE_URL: ${OLLAMA_BASE_URL:-}
      OLLAMA_MODEL: ${OLLAMA_MODEL:-}
      BARCODE_LOOKUP_ENABLED: ${BARCODE_LOOKUP_ENABLED:-}
      BARCODE_LOOKUP_API_KEY: ${BARCODE_LOOKUP_API_KEY:-}
      ENCRYPTION_KEY: ${ENCRYPTION_KEY:-}
      BACKUP_CRON_SCHEDULE: ${BACKUP_CRON_SCHEDULE:-0 3 * * *}
      BACKUP_RETENTION_COUNT: ${BACKUP_RETENTION_COUNT:-7}
      BACKUP_S3_ENDPOINT: ${BACKUP_S3_ENDPOINT:-}
      BACKUP_S3_REGION: ${BACKUP_S3_REGION:-auto}
      BACKUP_S3_BUCKET: ${BACKUP_S3_BUCKET:-}
      BACKUP_S3_ACCESS_KEY_ID: ${BACKUP_S3_ACCESS_KEY_ID:-}
      BACKUP_S3_SECRET_ACCESS_KEY: ${BACKUP_S3_SECRET_ACCESS_KEY:-}
      BACKUP_S3_FORCE_PATH_STYLE: ${BACKUP_S3_FORCE_PATH_STYLE:-false}
      BACKUP_SFTP_HOST: ${BACKUP_SFTP_HOST:-}
      BACKUP_SFTP_PORT: ${BACKUP_SFTP_PORT:-22}
      BACKUP_SFTP_USERNAME: ${BACKUP_SFTP_USERNAME:-}
      BACKUP_SFTP_PASSWORD: ${BACKUP_SFTP_PASSWORD:-}
      BACKUP_SFTP_PRIVATE_KEY: ${BACKUP_SFTP_PRIVATE_KEY:-}
      BACKUP_SFTP_REMOTE_PATH: ${BACKUP_SFTP_REMOTE_PATH:-/backups}
      # Local backups land inside ./data, which is already mounted below —
      # no separate volume needed for this destination to be persisted.
      BACKUP_LOCAL_PATH: ${BACKUP_LOCAL_PATH:-}
    volumes:
      - ./data:/app/data
    restart: unless-stopped

  # Optional: self-host ntfy instead of relying on the public ntfy.sh
  # instance. Uncomment this service, set NTFY_URL: http://ntfy:80 above,
  # and subscribe to your topic in the ntfy app pointed at this server
  # instead of ntfy.sh.
  # ntfy:
  #   image: binwiederhier/ntfy
  #   command: serve
  #   ports:
  #     - "8080:80"
  #   volumes:
  #     - ./data/ntfy:/var/cache/ntfy
  #   restart: unless-stopped
```

Values not set in `.env` fall back to the defaults shown above (most
features simply stay disabled until configured).

The image is built and pushed to Docker Hub automatically by
[`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml)
on every push to `main` (tagged `latest`) and on `v*` tags — that same
workflow also pushes this README to Docker Hub as the repository's
overview, so the two stay in sync. To build from source instead of
pulling, run `docker build -t jaysbeekay/hearth:local .` and change
`image:` in `docker-compose.yml` to that tag.

## Locking down access with nginx + mTLS

Since this app stores sensitive personal/financial data, you can put it
behind nginx with mutual TLS (mTLS): nginx terminates HTTPS and requires
every client to present a certificate signed by your own private CA, so
anyone without an issued certificate is rejected before the request ever
reaches the app — there's no app-level login page to even attack.

An example nginx server block is in
[`deploy/nginx/hearth-mtls.conf.example`](deploy/nginx/hearth-mtls.conf.example).
It expects the app reachable at `127.0.0.1:3000`, so bind the container's
port to localhost only in `docker-compose.yml` rather than publishing it
on all interfaces:

```yaml
    ports:
      - "127.0.0.1:3000:3000"
```

(If nginx runs in a different container/host than Docker, instead put
the app on a shared Docker network and remove the host port mapping
entirely, proxying to the service name instead of `127.0.0.1`.)

**1. Create a private CA** (once) — this signs client certificates, and is
separate from your server's TLS certificate (e.g. from Let's Encrypt):

```bash
openssl genrsa -out ca.key 4096
openssl req -x509 -new -nodes -key ca.key -sha256 -days 3650 \
  -subj "/CN=Hearth Client CA" -out client-ca.crt
```

Copy `client-ca.crt` to the path referenced by `ssl_client_certificate` in
the nginx config. Keep `ca.key` somewhere safe and offline — it's what
lets you issue new client certificates later.

**2. Issue a client certificate** for each person/device allowed to connect:

```bash
openssl genrsa -out client.key 4096
openssl req -new -key client.key -subj "/CN=your-name" -out client.csr
openssl x509 -req -in client.csr -CA client-ca.crt -CAkey ca.key \
  -CAcreateserial -out client.crt -days 825 -sha256

# Bundle into a .p12 to import into a browser or OS keychain
openssl pkcs12 -export -out client.p12 -inkey client.key -in client.crt \
  -certfile client-ca.crt
```

Import `client.p12` into the browser/device that should have access (it
will prompt for the certificate when visiting the site). Revoking access
for a device is just not reissuing/renewing its certificate, or maintaining
a CRL if you need to revoke before expiry.

**3. Set these env vars** so the app behaves correctly behind a reverse
proxy:

```bash
APP_URL=https://hearth.example.com
AUTH_TRUST_HOST=true   # required so NextAuth trusts the proxied Host header
```

## Querying contracts from an LLM (MCP)

The app can expose a read-only [MCP](https://modelcontextprotocol.io) server
at `/api/mcp` so a local LLM agent — e.g. [Ollama](https://ollama.com) running
a tool-calling model like Hermes — can answer questions about your household
data in natural language ("what's renewing this month?", "how much am I
spending on insurance?", "what's my net worth?").

It's disabled by default. Set `MCP_TOKEN` in `.env` (any random string, e.g.
from `openssl rand -base64 32`) to enable it — requests must send it as
`Authorization: Bearer <token>`. Leaving it unset makes the endpoint 404,
same as `CRON_SECRET`/`/api/cron`.

The server is read-only — no tool ever modifies data or returns account
credentials or uploaded document file contents (only document metadata:
filename, type, size). Contracts and products are always exposed; the rest
mirror whichever optional modules (Travel, Vehicles, Home, Inventory, Wealth)
this household has enabled, same as the in-app AI Assistant — disable a
module and its tool disappears on the next connection.

| Tool | Purpose |
| --- | --- |
| `list_contracts` | List contracts, optionally filtered by status and/or category. |
| `get_contract` | Full details for one contract by id, including document metadata. |
| `search_contracts` | Case-insensitive search across title, provider, contract number, and notes. |
| `upcoming_renewals` | Active contracts ending within N days (default 30), soonest first. |
| `spend_summary` | Estimated total and per-category monthly spend across active contracts. |
| `list_products` | List tracked products/purchases and warranty status, optionally filtered by search text. |
| `list_trips` *(Travel)* | List trips with segment count, optionally only ones that haven't ended yet. |
| `list_vehicles` *(Vehicles)* | List vehicles with rego/insurance expiry, optionally only ones needing attention. |
| `list_properties` *(Home)* | List properties with rental status, current tenant, and latest valuation. |
| `list_inventory_items` *(Inventory)* | List catalogued household items, optionally filtered by search text. |
| `net_worth` *(Wealth)* | Household net worth: share/crypto, property, and inventory value, with per-holding gain/loss. |

Point your MCP client at `http://<host>:3000/api/mcp` with the bearer token.
For a tool that speaks MCP-over-HTTP directly, a config block looks like:

```json
{
  "mcpServers": {
    "hearth": {
      "url": "http://<host>:3000/api/mcp",
      "headers": { "Authorization": "Bearer <your MCP_TOKEN>" }
    }
  }
}
```

If your agent only speaks stdio-based MCP servers (common for local
Ollama tool-calling setups), bridge it with
[`mcp-remote`](https://github.com/geelen/mcp-remote) instead:

```json
{
  "mcpServers": {
    "hearth": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "http://<host>:3000/api/mcp",
        "--header",
        "Authorization: Bearer <your MCP_TOKEN>"
      ]
    }
  }
}
```

Adjust the exact syntax for whatever client/agent you're running — the
endpoint itself is a standard streamable-HTTP MCP server, so anything that
speaks MCP over HTTP (or can be bridged to it) will work.

## Auto-filling fields from a document

When adding a new contract, you can upload a document first (PDF or photo of
a bill/policy/lease) and the form fields — provider, contract/policy number,
start/end dates, cost, billing frequency, contact details — fill in
automatically. Review and correct anything before saving; the document is
attached to the contract once you do.

The same applies when adding a new product: upload its invoice and fields
like product name, manufacturer, vendor, serial number, purchase date, and
price fill in automatically. A separate photo upload (no auto-fill) is also
available so you can keep a picture of the item itself.

Extraction runs entirely locally, in two stages:

1. **Text extraction**: PDFs with a text layer are read directly
   (`pdftotext`); scanned PDFs and photos are rasterized and OCR'd
   (`pdftoppm` + `tesseract`). Word docs (`.doc`/`.docx`) are attached as-is
   without auto-fill — there's no plain-text layer to extract from those
   formats the same way.
2. **Field extraction**: regex/label heuristics try to pick out dates,
   amounts, account/policy numbers, and contact details from the extracted
   text. If too few fields are found — e.g. a messy scan or unusual layout —
   and `OLLAMA_BASE_URL`/`OLLAMA_MODEL` are set, the text is sent to your
   Ollama server with a prompt asking it to return the same fields as JSON,
   and any fields it finds fill in the gaps.

The Ollama fallback is optional and off by default (heuristics-only). If
your app container can't resolve `localhost` to your host machine's Ollama
instance, point `OLLAMA_BASE_URL` at the host's LAN IP or
`http://host.docker.internal:11434` instead. No document text or extracted
fields are ever sent anywhere else — only to the Ollama server you configure,
or to a cloud AI provider you've explicitly opted into below.

## Bring your own AI key

Each user can optionally connect their own API key for a cloud AI provider —
Anthropic Claude, Google Gemini, or OpenAI — from **Settings → AI document
extraction**. When configured, it's used as a third extraction stage: if the
local heuristics can't confidently parse an uploaded document, the document's
raw bytes (PDF or photo, not the OCR'd text) are sent directly to your chosen
provider's API using your key, which generally extracts fields far more
accurately than local OCR + heuristics, especially for unusual layouts. This
takes priority over the Ollama fallback when both are configured. As with the
existing auto-fill flow, extracted fields are only suggestions — you still
review and correct them before saving.

This requires the server to have `ENCRYPTION_KEY` set (see below); each user's
key is encrypted at rest (AES-256-GCM) and is never displayed back after
saving. Leave it unset to hide this section entirely and keep extraction
fully local/self-hosted. Word docs (`.doc`/`.docx`) aren't supported by this
path either, for the same reason local OCR skips them.

## Barcode scanning for products

When adding a new product, you can tap the scan icon next to the Barcode
field to scan its UPC/EAN barcode with your device's camera instead of typing
it in. Scanning happens entirely client-side using [ZXing](https://github.com/zxing-js/library)
— no image or video ever leaves your browser. Scanning requires a secure
context (HTTPS or `localhost`), so it won't work over plain HTTP on a LAN
address; the barcode can still be typed in manually in that case.

The barcode is always saved with the product once scanned (or typed). Looking
it up online to auto-fill the product's name and manufacturer is a separate,
opt-in step: set `BARCODE_LOOKUP_ENABLED=true` to enable it. When enabled, the
scanned number is sent to [UPCitemdb](https://www.upcitemdb.com)'s free,
keyless trial endpoint (rate-limited per IP) to look up the product; set
`BARCODE_LOOKUP_API_KEY` (from a paid UPCitemdb plan) to use their
higher-limit endpoint instead. Leaving lookup disabled still lets you scan
and save the barcode — it just won't auto-fill anything from it.

## Database backups

The app can automatically back up its SQLite database offsite, encrypted,
on a schedule. Each backup:

1. Takes a consistent point-in-time snapshot of the live database using
   SQLite's `VACUUM INTO` — the app keeps running normally throughout, and
   nothing is locked or paused.
2. Encrypts the snapshot with AES-256-GCM using `ENCRYPTION_KEY` (the same
   key used for "bring your own AI key", see above) before it ever leaves
   the server.
3. Uploads the encrypted file to a single active destination — **S3-
   compatible object storage** (AWS S3, Backblaze B2, Cloudflare R2, MinIO,
   etc.), **SFTP**, or a **local filesystem path** — chosen from a
   "Backup destination" dropdown in Settings → System settings. Only one
   destination runs at a time; switching the dropdown doesn't discard the
   other destinations' previously-saved credentials, it just makes them
   inactive.
4. Prunes older backups at the active destination beyond
   `BACKUP_RETENTION_COUNT`.

Backups stay fully disabled until `ENCRYPTION_KEY` is set — there's no way
to write an unencrypted backup, even locally. With encryption configured,
pick a destination and fill in its fields in Settings → System settings
(`BACKUP_S3_*`, `BACKUP_SFTP_*`, `BACKUP_LOCAL_PATH` env vars just
pre-populate those fields, they don't select the destination). See
[`.env.example`](.env.example) for the full list of backup-related
variables and their defaults.

Backups run on `BACKUP_CRON_SCHEDULE` (default daily at 03:00) via the
same built-in scheduler used for reminders, can be triggered manually from
**Settings → Database backups** (admin only), or triggered externally via
`POST /api/backup` with header `x-cron-secret: <CRON_SECRET>` (same secret
as `/api/cron`; leaving `CRON_SECRET` unset disables both endpoints).
Recent backup runs (destination, status, size, any error) are shown on
that same Settings page.

To restore: decrypt the downloaded file with AES-256-GCM using
`ENCRYPTION_KEY` (the first 12 bytes are the IV, the next 16 are the auth
tag, the rest is the encrypted SQLite database), then replace `data/app.db`
with the decrypted file while the app is stopped.

## Webhooks

The app can notify other platforms — e.g. [Home Assistant](https://www.home-assistant.io)
or an MCP agent — when a contract or product warranty is approaching expiry,
on the same schedule and thresholds as email/push reminders. Manage
endpoints from **Settings → Webhooks** (admin only): add a URL, optionally
set a signing secret, enable/disable, send a test delivery, and review the
last 10 deliveries (success/failure, HTTP status, timestamp).

Each delivery is a `POST` with a JSON body and these headers:

| Header | Purpose |
| --- | --- |
| `X-Webhook-Event` | The event name (see below). |
| `X-Webhook-Signature` | `sha256=<hex>`, an HMAC-SHA256 of the raw request body using the endpoint's signing secret. Only sent if a secret is configured. |

Verify it by recomputing the HMAC over the exact request body with your
secret and comparing to the header. Three events exist:

- **`contract.expiring`** / **`warranty.expiring`** — sent once per
  contract/product per threshold crossed (same dedup behavior as
  email/push: adding something already past several thresholds sends one
  catch-up delivery, not one per threshold). Body:

  ```json
  {
    "event": "contract.expiring",
    "kind": "contract",
    "id": "...",
    "title": "...",
    "detail": "...",
    "daysRemaining": 7,
    "endDate": "2026-07-03",
    "url": "http://<host>:3000/contracts/..."
  }
  ```

- **`webhook.test`** — sent by the "Send test" button on the Settings page:

  ```json
  { "event": "webhook.test", "message": "This is a test notification from Hearth.", "sentAt": "..." }
  ```

For Home Assistant, point the URL at a
[webhook trigger](https://www.home-assistant.io/docs/automation/trigger/#webhook-trigger)
(`/api/webhook/<id>`) and branch the automation on `trigger.json.event`.
For an MCP-based agent like Hermes, pair this with the read-only MCP server
above — the webhook tells the agent something is expiring, and `/api/mcp`
lets it look up the details and answer follow-up questions.

If an endpoint is unreachable or returns a non-2xx status, that delivery
is logged as failed and retried the next time the threshold check runs
(same retry semantics as email) — other enabled endpoints still receive
the same event.

## Configuration

All configuration is via environment variables — see [`.env.example`](.env.example)
for the full list with defaults. Notable ones:

| Variable | Purpose |
| --- | --- |
| `AUTH_SECRET` | Required. Signs session JWTs. Generate with `openssl rand -base64 32`. |
| `APP_URL` | The public URL of the app (e.g. `https://hearth.example.com`). Required for passkeys — its hostname becomes the WebAuthn Relying Party ID. Also used in webhook `url` fields and reminder links. |
| `DATABASE_URL` | SQLite file path, e.g. `file:./data/app.db`. |
| `SMTP_HOST` / `SMTP_USER` | Set both to enable email reminders. |
| `NTFY_TOPIC` | Set to enable push reminders via ntfy. |
| `REMINDER_CRON_SCHEDULE` | When the built-in scheduler checks for expiring contracts (cron syntax, default daily at 08:00). |
| `CRON_SECRET` | Optional. If set, enables `POST /api/cron` (with header `x-cron-secret`) so an external scheduler can trigger the check instead of/alongside the built-in one. |
| `AUTH_TRUST_HOST` | Set to `true` when running behind a reverse proxy (e.g. nginx) — see "Locking down access with nginx + mTLS" above. |
| `MCP_TOKEN` | Optional. If set, enables `GET/POST /api/mcp`, a read-only MCP server for querying contracts from an LLM agent — see "Querying contracts from an LLM (MCP)" above. |
| `OLLAMA_BASE_URL` / `OLLAMA_MODEL` | Optional. Set both to enable the local-LLM fallback for document auto-fill when heuristics can't confidently parse a scan — see "Auto-filling fields from a document" above. |
| `BARCODE_LOOKUP_ENABLED` | Optional. Set to `true` to look up a scanned product barcode online and auto-fill its name/manufacturer — see "Barcode scanning for products" above. |
| `BARCODE_LOOKUP_API_KEY` | Optional. A paid UPCitemdb API key for higher-limit barcode lookups, instead of the free keyless trial endpoint. |
| `ENCRYPTION_KEY` | Optional. Generate with `openssl rand -base64 32`. Set to enable users bringing their own AI provider key for document extraction, and a prerequisite for offsite database backups — see "Bring your own AI key" and "Database backups" above. |
| `SETUP_TOKEN` | Optional. Generate with `openssl rand -hex 16`. If set, the first-run setup screen also asks for this value, so a server that's reachable before you've created your account can't be claimed by someone else — see "Security notes" below. Ignored once setup is complete. |
| `BACKUP_CRON_SCHEDULE` / `BACKUP_RETENTION_COUNT` | Optional. Schedule (cron syntax, default daily at 03:00) and how many backups to keep per destination (default 7). |
| `BACKUP_S3_*` | Optional. Pre-populates the S3-compatible backup fields (`BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`, plus `BACKUP_S3_ENDPOINT`/`BACKUP_S3_REGION`/`BACKUP_S3_FORCE_PATH_STYLE` for non-AWS providers) — still requires picking "S3-compatible storage" in Settings → System settings' backup destination dropdown to activate it. See "Database backups" above. |
| `BACKUP_SFTP_*` | Optional. Pre-populates the SFTP backup fields (`BACKUP_SFTP_HOST`, `BACKUP_SFTP_USERNAME`, plus `BACKUP_SFTP_PASSWORD` or `BACKUP_SFTP_PRIVATE_KEY`) — still requires picking "SFTP" in the backup destination dropdown to activate it. See "Database backups" above. |
| `BACKUP_LOCAL_PATH` | Optional. Pre-populates the local-filesystem backup path — still requires picking "Local filesystem" in the backup destination dropdown to activate it. See "Database backups" above. |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | Optional. Set both to show a "Sign in with GitHub" button on the login page. Sign-up stays invite-only — GitHub sign-in only works for an email that already has an admin-invited Hearth account. |

If neither email nor ntfy is configured, the scheduler runs but sends nothing
(no errors).

## Notifications

Each contract and product has its own comma-separated list of reminder
thresholds (days before expiry, default `30,14,7,1`). Once a day (or on
whatever schedule you configure), the app checks all active contracts with an
end date and all products with a warranty end date, and sends a reminder on
each configured channel for the soonest threshold that's been crossed and not
already notified — so adding a contract or product that's already past
several thresholds only sends one catch-up reminder per channel, not one per
threshold.

## Security notes

- New users can only be created by an existing admin (Settings → Users) —
  there's no public registration, since this app stores sensitive personal
  and financial data.
- **First-run setup is a race you can lose.** Until the first account exists,
  `/setup` is reachable by anyone who can reach the server, and whoever
  submits it first becomes the administrator. If the server will be exposed
  before you've registered, set `SETUP_TOKEN` to a random string first — the
  setup screen will then also ask for it. Once an account exists, `/setup`
  redirects away permanently.
- Uploaded documents are stored under generated UUID filenames, never the
  user-supplied name, to prevent path traversal.
- Email/ntfy reminder text is sanitized against header injection.
- Every response carries a nonce-based Content-Security-Policy plus `nosniff`,
  `X-Frame-Options: DENY` and `Referrer-Policy: no-referrer`. HSTS is added
  only when the request already arrived over TLS, so a plain-HTTP LAN
  deployment isn't pinned to an HTTPS endpoint that doesn't exist.
- **Run it over HTTPS.** Session cookies, uploaded documents and invitation
  links all travel in cleartext otherwise. The app logs a warning at startup
  if `APP_URL` isn't HTTPS in production, and the mobile shells refuse plain
  HTTP for anything but `localhost`, `*.local` and `*.home.arpa` — a bare LAN
  IP over `http://` won't connect. Use a reverse proxy with a real
  certificate, a mesh VPN such as Tailscale, or import a private CA from the
  app's connect screen.

See [`PRIVACY.md`](PRIVACY.md) for what data the app handles and where it
goes for each optional integration.

## Releasing

Releases follow [Semantic Versioning](https://semver.org/), starting at
`0.1.0`, and are tracked in [`CHANGELOG.md`](./CHANGELOG.md) under
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) conventions.

To cut a release:

1. Move the relevant entries from `## [Unreleased]` in `CHANGELOG.md` into a
   new `## [x.y.z] - YYYY-MM-DD` section (bump major for breaking changes,
   minor for features, patch for fixes), and bump `"version"` in
   `package.json` to match. Merge this to `main`.
2. Cut the tag, either:
   - locally: `git tag vx.y.z && git push origin vx.y.z`, or
   - from GitHub Actions: run `release.yml` manually (Actions → Create
     GitHub Release → Run workflow) against `main` with `version` set to
     `x.y.z`. This creates the tag for you, which is useful when a local
     push to the tag isn't possible (e.g. restricted environments).

Cutting the tag creates `release.yml`'s GitHub Release, named `vx.y.z` with
the body pulled from the matching `CHANGELOG.md` section so each release
captures the functionality that shipped in it.

`docker-publish.yml` builds and pushes the image to Docker Hub as
[`jaysbeekay/hearth`](https://hub.docker.com/r/jaysbeekay/hearth),
tagged `latest` on every push to `main` and `vx.y.z` on a real tag push. If
the tag was cut via `release.yml`'s manual dispatch instead of a tag push,
also run `docker-publish.yml` manually against the new tag to get the
`vx.y.z` image tag.

## License

Private/personal project — no license specified.
