# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is a privacy-conscious self-hoster: someone comfortable
running Docker/self-hosted services, who runs Hearth as their household's own
server rather than trusting a cloud SaaS with financial and personal data.
They administer the household (invite members, configure integrations,
enable modules) and use the app day-to-day alongside the other household
members they invite — access is household-wide, not per-user siloed. There is
no public sign-up; new users are admin-invited only.

## Product Purpose

Hearth tracks the paperwork and assets of running a household in one place:
contracts and warranties (always on), and opt-in modules for Travel, Home,
Vehicles, Inventory, and Wealth. It surfaces what's expiring, what it costs,
and what needs attention, and reminds the household by email/push before
things lapse. Success is a household that stops losing track of renewal
dates, warranty coverage, and where a given document lives.

## Positioning

Hearth is an all-in-one household system of record: one app spanning
contracts, warranties, travel, home maintenance, vehicles, inventory, and
wealth, replacing the scatter of single-purpose trackers and spreadsheets a
household would otherwise juggle. It's also self-hosted with AI-assisted
convenience layered on top without giving up that privacy: documents are
extracted locally first (text/OCR/heuristics), only escalating to a
bring-your-own-key cloud provider when needed, and the optional AI assistant
answers questions over the household's own data without ever writing to it.

## Operating Context

- Self-hosted via Docker Compose; one instance serves one household.
- Documents (PDFs, images, Word files) are uploaded and either attached
  directly to a record or land in an "inbox" for later review/attachment.
  Uploading auto-fills fields (provider, dates, cost, etc.) via a three-stage
  extraction pipeline: text extraction → regex/heuristic field extraction →
  optional bring-your-own-key cloud AI.
- Reminders fire via email (SMTP) and/or push (ntfy) on a configurable
  per-record threshold schedule; an external cron can also trigger checks.
- Offline support: previously-visited pages remain readable when the server
  is unreachable, and writes made offline are queued and synced on
  reconnect.
- Native app shells exist for iOS and Android (Capacitor), but they are thin
  WebView wrappers pointed at the user's own server — the design language is
  the web app's, not a distinct native one.
- A read-only MCP server lets an LLM agent query contract data (list,
  search, upcoming renewals, spend summary) — no write tools.

## Capabilities and Constraints

- Always-on: Contracts and Products (warranties). Opt-in per household:
  Travel, Home, Vehicles, Inventory, Wealth — toggled in Settings, data is
  retained (not deleted) when a module is disabled.
- Roles are ADMIN / MEMBER, gating admin-only actions (user management,
  webhooks, backups, module toggles) — not data visibility. Everyone in the
  household sees the same records.
- Auth: credentials + JWT session (NextAuth), optional WebAuthn passkeys and
  optional TOTP as independent second factors.
- Wealth module prices (equities/crypto) are live-fetched (Yahoo
  Finance/CoinGecko) and cached; cost basis is computed FIFO from trade
  history, not stored.
- Encrypted-at-rest: user AI provider API keys and offsite DB backups, both
  gated on a single `ENCRYPTION_KEY` being configured.
- Almost every optional feature (email, push, MCP, cron, Ollama fallback,
  barcode lookup, encryption/backups) is gated by the presence of its env
  var rather than a separate feature flag.

## Brand Commitments

Existing mark: a white flame on `#533afd` purple (`public/icon.svg`,
carried through the Android/iOS app icons and splash screens). Palette is a
warm oat/stone neutral background with deep-navy text in light mode, and an
indigo background with a lighter violet accent in dark mode (`globals.css`
design tokens). No tagline, testimonial, or additional accessibility
requirement beyond WCAG-conscious contrast (a general commitment, tracked
per-token as issues surface — see recent `--danger` contrast fix) is
currently binding.

## Evidence on Hand

Real product screenshots exist at `docs/screenshots/*.png`, referenced from
README's Screenshots section, covering: dashboard, contracts list/detail,
documents, travel list/trip detail, vehicles list/detail, home list/property
detail, spend, assistant, and several settings pages. These are kept in sync
with the actual UI (see CLAUDE.md's screenshot-regeneration policy) and can
be treated as ground truth for current visual state — not fabricated
marketing evidence. No testimonials, case studies, or usage-data claims
exist and none should be invented.

## Product Principles

- Self-hosted and privacy-first by default: features that need to leave the
  server (cloud AI, offsite backups) are opt-in, bring-your-own-key/config,
  and clearly gated rather than assumed.
- Household-wide, not per-user: shared visibility is the default; roles gate
  administration, not data access.
- One system of record over several single-purpose tools: adding a module
  should feel like turning on a light switch in the same house, not
  bolting on a separate app.
- Reduce data-entry friction without sacrificing control: auto-fill from
  documents, but the user always reviews before saving — nothing is
  auto-committed from an extraction or an AI response.
- Don't make the optional heavy: modules, integrations, and AI features stay
  invisible/inert until explicitly configured or enabled.

## Accessibility & Inclusion

No project-specific accessibility requirement beyond general WCAG-conscious
practice has been established (e.g. the recent `--danger` token contrast
fix to meet AA at the sizes it's actually used at). Treat future contrast/
focus/touch-target issues the same way: fix to meet WCAG AA as they're
found, rather than as a standing formal requirement.
