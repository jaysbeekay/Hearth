# Repo instructions for Claude Code

## Screenshots

`docs/screenshots/*.png` (referenced from README.md's "## Screenshots" section)
must stay in sync with the UI. Whenever a change in this session materially
alters the visual appearance of a page that already has a screenshot (layout,
new fields/sections, restyling), or adds a page worth documenting, regenerate
the affected screenshot(s) before considering the change complete:

1. Spin up an isolated scratch SQLite DB + `next dev` instance — fresh DB,
   `npx prisma migrate deploy`, seed via the app's own setup/login flow, never
   the real `/data` DB.
2. Use Playwright (`playwright-core`, launched with `executablePath:
   process.env.PW_CHROMIUM_PATH || "/opt/pw-browsers/chromium"`) to drive the
   flow and capture the relevant page(s) at 1280x900.
3. Visually check each screenshot with the Read tool before replacing the
   existing file — don't trust the script ran correctly without looking.
4. Update `README.md`'s Screenshots table if a new page was added.
5. Clean up the scratch DB, dev server process, and any scratch scripts —
   nothing scratch should be committed.
6. This still respects the standing rule: don't push to `main` without
   explicit user confirmation for that specific push.

Skip this for changes that don't affect page appearance (pure backend logic,
copy-only tweaks with no layout impact, etc.) — use judgement.

## Issue logging

When I give you raw feedback, classify it as `type:bug` or `type:enhancement`,
then create it:

```
gh issue create -R jaysbeekay/jaysbeekay -t "<title>" --label "type:bug" -b "<body>"
```

Body template:
- **Bug**: Description / Steps to Reproduce / Expected vs Actual / Affected
  component
- **Enhancement**: Motivation / Proposed Behavior / Acceptance Criteria

Don't add the issue to the project board manually — "Auto-add to project" and
"Item added to project → set Status" board workflows handle that automatically
on creation.

## What this is

Hearth is a self-hostable household management app (contracts/warranties, and opt-in
Travel/Home/Vehicles/Inventory/Wealth modules) built with Next.js App Router + TypeScript,
Prisma 7 (SQLite via `@prisma/adapter-libsql`), NextAuth v5 (credentials + JWT), Tailwind
CSS v4, Zod, node-cron. It's designed to be run by one household, storing sensitive
personal/financial data — auth-gating and input validation matter everywhere.

## Commands

```bash
npm run dev              # start dev server
npm run build             # next build --webpack
npm run lint              # eslint
npx tsc --noEmit          # type-check (no dedicated script; run directly)
npx prisma migrate dev    # create/apply a migration after editing prisma/schema.prisma
npx prisma generate       # regenerate the client into src/generated/prisma (postinstall does this too)

# e2e (Playwright)
npm run test:e2e                                  # full suite: seeds DB, runs all specs
npx playwright test e2e/specs/02-validation.spec.ts   # single spec file
npx playwright test -g "some test name"               # by test name
```

There is no unit test runner configured — correctness is checked via `tsc`, `eslint`, and
the Playwright e2e suite in `e2e/specs/`, which runs against a real dev server and seeded
SQLite DB (`e2e/prepare-db.ts`, `e2e/setup/seed.setup.ts`).

## Architecture

**Server Actions are the primary write path.** Almost all mutations live in
`src/lib/actions/*.ts` (`"use server"`), one file per domain (contracts, products, home,
trips, vehicles, wealth, backup, webhook, passkeys, app-settings, ai, modules, ical,
import). Each action: calls `auth()` to get the session (throws/redirects if absent),
validates `FormData` against a Zod schema from `src/lib/validation/`, does the Prisma
write, and `revalidatePath`s the affected route. `src/app/api/*` route handlers exist
mainly for things actions can't do — file-serving, MCP, cron/backup triggers, CSV/iCal
export, search, geocoding, and document AI-extraction/inbox endpoints called from client
components.

**Auth**: `src/lib/auth.config.ts` defines the shared NextAuth config (JWT session
strategy, role on the session user, `PUBLIC_PATHS` for unauthenticated routes:
`/login`, `/setup`, `/forgot-password`, `/reset-password`, `/api/cron`, `/api/mcp`).
`src/lib/auth.ts` wires in the credentials provider, password reset, and TOTP
(`src/lib/totp.ts`). No public sign-up — new users are admin-invited only (Settings →
Users). Passkeys (WebAuthn via `@simplewebauthn`) are an optional second factor per user,
gated on `APP_URL` being set (used as the Relying Party ID); TOTP is a separate optional
second factor, both independent from passkeys.

**Opt-in modules**: TRAVEL, HOME, VEHICLES, INVENTORY, WEALTH are enabled/disabled per
household via the `ModuleEnablement` table. `src/lib/modules/registry.ts` is the single
source of truth for module metadata (label, icon, href); `src/lib/modules/enablement.ts`
provides `requireModuleEnabled(key)` — call this at the top of any page/action that
belongs to an opt-in module so a disabled module 404s/redirects instead of silently
leaking data. Contracts and Products are always-on (not gated by a module).

**Document AI-extraction pipeline** (`src/lib/documents/`, `src/lib/ai/`) has three
escalating stages, tried in order until enough fields are found:
1. Text extraction (`textExtraction.ts`): `pdftotext` for text-layer PDFs, `pdftoppm` +
   `tesseract` OCR for scans/photos. `.doc`/`.docx` skip straight to attach-only.
2. Regex/heuristic field extraction (`fieldExtraction.ts` + per-domain files like
   `invoiceFieldExtraction.ts`, `leaseAgreementExtraction.ts`, `tripFieldExtraction.ts`,
   etc.), optionally falling back to a local Ollama model if too few fields are found.
3. Bring-your-own-key cloud AI
   (`src/lib/ai/providers/{anthropic,gemini,openai,openrouter,ollama}.ts`, dispatched via
   `src/lib/ai/extract.ts`), sending raw document bytes directly to the user's own
   configured provider/key — only used if stages 1–2 come up short. Each provider
   implements the same `ProviderCall` signature (`providers/types.ts`). User API keys are
   encrypted at rest with `ENCRYPTION_KEY` (`src/lib/crypto.ts`, AES-256-GCM) — this same
   key also gates offsite DB backup encryption.

Documents can also arrive un-linked via the "inbox" (`src/app/(app)/documents/inbox`,
`src/app/api/documents/inbox/`) — uploaded first, extracted/reviewed later, then attached
to a record (`InboxReviewClient.tsx`).

**Notifications** (`src/lib/notifications/`): a single `scheduler.ts` (node-cron, schedule
from `REMINDER_CRON_SCHEDULE`) checks contracts/products/vehicles for crossed reminder
thresholds and fans out to whichever channels are configured — email (`email.ts`), push
via ntfy (`ntfy.ts`), and outbound webhooks (`webhook.ts`, HMAC-SHA256 signed). Threshold
dedup logic lives in `thresholds.ts` — crossing several thresholds at once (e.g. adding an
already-overdue contract) sends one catch-up notification per channel, not one per
threshold. `/api/cron` lets an external scheduler trigger the same check
(`x-cron-secret` header, gated on `CRON_SECRET` being set).

**Backups** (`src/lib/backup/`): `snapshot.ts` takes a live `VACUUM INTO` SQLite snapshot,
encrypts it (AES-256-GCM, `ENCRYPTION_KEY`), then `s3.ts`/`sftp.ts` upload to whichever
destinations are configured; `scheduler.ts` runs this on `BACKUP_CRON_SCHEDULE` and prunes
past `BACKUP_RETENTION_COUNT`. Also triggerable from Settings (admin) or `POST /api/backup`.

**MCP server** (`src/lib/mcp/server.ts`, mounted at `/api/mcp`): read-only tools
(`list_contracts`, `get_contract`, `search_contracts`, `upcoming_renewals`,
`spend_summary`) for LLM agents to query contract data. Gated on `MCP_TOKEN`
(`Authorization: Bearer` — endpoint 404s if unset, same pattern as `CRON_SECRET`). Never
add a write tool here or return credentials/raw document bytes.

**Wealth module** (`src/lib/wealth.ts`, `src/lib/prices.ts`): live price feeds from Yahoo
Finance (equities) and CoinGecko (crypto), cached and refreshed every 15 min. FIFO cost
basis is computed from trade history, not stored — recomputed per view.

**Storage** (`src/lib/storage.ts`): uploaded documents are saved under generated UUID
filenames on disk (never the user-supplied filename), keyed by owning record — prevents
path traversal and filename collisions. `deleteContractDir`/`deleteDocument` clean up on
record/document deletion; keep file deletion and DB-row deletion paired when touching this.

**Offline support** (`src/lib/offlineCache.ts`, `offlineQueue.ts`, `@serwist/next` service
worker): previously-visited pages are cached for read access when the server is
unreachable; writes made while offline are queued in IndexedDB (`idb`) and synced via
`/api/sync` on reconnect. `OfflineBanner`/`OfflineSyncManager` components surface this.

**Env config** (`src/lib/env.ts`, `.env.example`): almost every optional feature
(email, ntfy, MCP, cron, Ollama fallback, barcode lookup, encryption/backups) is gated by
the presence of its env var(s) rather than a separate feature flag — check `.env.example`
for the full list and defaults before assuming a feature is unconfigured or misbehaving.

## Conventions

- Route groups: `src/app/(app)/*` are authenticated pages sharing the sidebar/bottom-nav
  layout (`layout.tsx`); `src/app/login`, `src/app/setup`, `src/app/forgot-password`,
  `src/app/reset-password` are outside it.
- Zod schemas in `src/lib/validation/` are the single source of truth for both server
  action validation and (via `@hookform/resolvers`) client-side form validation — update
  both call sites' expectations when changing a schema, not just the server action.
  `firstIssueMessage`-style helpers convert Zod errors to the `ActionState` shape
  (`{ error, success, values }`) returned by every action for `useActionState`/form
  display.
- Prisma client is generated to `src/generated/prisma` (not the default `node_modules`
  location) — import types from `@/generated/prisma/enums` etc., and re-run
  `npx prisma generate` after pulling schema changes.
- Multi-user is household-wide, not per-user-siloed: everyone in the household sees the
  same contracts/trips/properties/etc. Role (`ADMIN`/`MEMBER`) gates admin-only actions
  (user management, webhooks, backups, module toggles), not data visibility.
- CHANGELOG.md follows Keep a Changelog; see the "Releasing" section of README.md for the
  full release process (bump `[Unreleased]` → version section, bump `package.json`, tag).
