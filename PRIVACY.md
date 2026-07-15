# Privacy Policy

Hearth is self-hosted software: you (or whoever administers your instance) run
the server, own the database, and control every integration it talks to.
There is no Hearth-operated backend — the developer never receives, stores,
or has access to any data you enter into your instance.

This policy describes what data the app (web, Android, and iOS) handles and
where it goes. It applies to the software as distributed; if your household's
administrator has modified it, ask them directly.

## Data stored on your own server

Everything you enter — contracts, warranties, trips, vehicles, properties,
inventory items, wealth portfolios, uploaded documents/photos, notes, and
account credentials (passwords are hashed; passkeys and TOTP secrets are
stored per standard WebAuthn/TOTP practice) — is stored in your instance's
own SQLite database and local file storage. None of it is transmitted to the
developer or to any Hearth-operated service, because no such service exists.

## The Android/iOS app specifically

The mobile apps are a thin native wrapper: on first launch they ask for your
self-hosted server's URL, store it in the device's native app-private
storage (Android SharedPreferences / iOS UserDefaults), and then load your
server's own web app in a WebView. From that point on, the mobile app has no
separate data collection of its own — everything below about the web app
applies equally inside it. If you enable mTLS client-certificate lockdown,
the imported certificate is stored in Android's app-private storage or the
iOS Keychain, never transmitted anywhere except to your own server during
the TLS handshake.

## Optional integrations (all off by default, admin/user-configured)

Each of these only activates if you explicitly configure it. When enabled,
here's exactly what leaves your server and where it goes:

| Feature | What's sent | Where |
| --- | --- | --- |
| Email reminders | Reminder subject/body (contract or warranty details) | Your configured SMTP server |
| Push reminders | Reminder text | Your configured [ntfy](https://ntfy.sh) server/topic |
| Local AI document extraction | Extracted document text | Your own self-hosted Ollama server |
| Bring-your-own-key AI extraction | Raw document bytes (PDF/photo) | Anthropic, Google, or OpenAI — whichever you configure, using your own API key |
| Barcode lookup | Scanned UPC/EAN number | [UPCitemdb](https://www.upcitemdb.com) |
| Property address lookup | Address text you type | [OpenStreetMap Nominatim](https://nominatim.org) |
| Wealth price feeds | Ticker symbols / crypto IDs (no account or holding-size data) | Yahoo Finance, CoinGecko |
| Flight status | Flight number | AviationStack (requires an admin-configured API key) |
| Offsite database backups | Full database snapshot, AES-256-GCM encrypted before it leaves the server | Your configured S3-compatible storage and/or SFTP destination |
| Webhooks | Expiry event details (title, dates) | Endpoints you configure (e.g. Home Assistant) |
| MCP server | Read-only contract queries from an LLM agent you run | Only reachable on your own network, and only if you set an access token |

Barcode scanning itself (reading the code from your camera) happens entirely
on-device — nothing is sent anywhere unless barcode lookup is separately
enabled.

## What's never collected

Hearth has no analytics, telemetry, crash reporting, advertising, or
tracking SDKs of any kind, on any platform.

## Your responsibility as administrator

If you self-host a public-facing instance for other people, you are the data
controller for their information — this document describes what the
*software* does, not your obligations under applicable privacy law (e.g.
GDPR) for the humans using your instance. See [Security
notes](README.md#security-notes) for the access-control measures the app
itself provides (admin-invite-only accounts, mTLS lockdown, path-traversal
protection on uploads).

## Changes to this policy

Any change to what data this software sends where will be reflected in this
file and in `CHANGELOG.md`.
