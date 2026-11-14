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
gh issue create -R jaysbeekay/Hearth -t "<title>" --label "type:bug" -b "<body>"
```

Body template:
- **Bug**: Description / Steps to Reproduce / Expected vs Actual / Affected
  component
- **Enhancement**: Motivation / Proposed Behavior / Acceptance Criteria

Don't add the issue to the project board manually — "Auto-add to project" and
"Item added to project → set Status" board workflows handle that automatically
on creation.

## Gatekeeper reviews

Gatekeeper (`thebotkeeper[bot]`, see `docs/gatekeeper.md`) is meant to review
automatically: a new issue gets a QA Review, a **draft PR** gets a light-touch
PR review, and marking a PR **ready** gets a full PR review. That depends on
Hermes being set up for this repository, which `docs/gatekeeper.md` says has
not been verified yet. Until a review has actually landed on a Hearth PR,
don't wait for one: `@codebot` is the only request that has a workflow behind
it.

CI is separate from the reviews. It runs when a PR is opened or pushed to,
not on new issues or when a draft is marked ready, so check its result on the
PR's head commit yourself.

- At each gate, wait until the review has landed **and** every CI check on the
  head commit has completed before fixing anything. Don't fix findings or CI
  failures piecemeal as they arrive.
- Validate every finding against the current code and head commit, then fix it
  or decline it with evidence. Reply on the PR or issue citing the review's
  comment id, so it counts as answered.
- Classify feedback by content, not by author: Gatekeeper, CodeRabbit and other
  bots post alongside the owner's own comments.
- The owner can lift a wait with an override in their own words that names the
  issue or PR. It lifts only the wait it names.
- A green, reviewed PR is not an approved one. Merge only with the owner's
  explicit approval.

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
npx prisma generate       # regenerate the client into src/generated/prisma; run after install and after pulling schema changes (`npm run test:unit` runs it first)

# unit (Vitest)
npm run test:unit         # unit tests (runs prisma generate first)
npm run test:coverage     # unit tests with coverage + thresholds (run `npx prisma generate` first on a fresh checkout)

# e2e (Playwright)
npm run test:e2e                                  # full suite: seeds DB, runs all specs
npx playwright test e2e/specs/02-validation.spec.ts   # single spec file
npx playwright test -g "some test name"               # by test name

# mobile shell (Capacitor)
npm run test:mobile-packages   # verify native mobile deps/config are in sync with source
npm run test:standalone        # playwright.standalone.config.ts — standalone-mode paywall/e2e specs
npm run cap:sync               # propagate ios-shell/www + config into ios/ and android/ native projects
npm run cap:android            # open android/ in Android Studio
npm run cap:ios                # open ios/ in Xcode
```

Vitest unit tests live in `tests/unit/` (`npm run test:unit`). Tests that need real Prisma
writes (e.g. record commands in `src/lib/commands/`) use `setupTestDb()` from
`tests/helpers/testDb.ts`, which migrates a temporary SQLite file per test file; stub
`next/cache` with `vi.mock`. Correctness is also checked via `tsc`, `eslint`, and the
Playwright e2e suite in `e2e/specs/`, which runs against a real dev server and seeded
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
via ntfy (`ntfy.ts`), and outbound webhooks (`webhook.ts`, HMAC-SHA256 signed). What to send
and when comes from the pure Reminder schedule (`reminderSchedule.ts`), which works on the Due
policy's entries; the health card uses the same schedule. Crossing several thresholds at once
(e.g. adding an already-overdue contract) sends one catch-up notification per channel, not one
per threshold. The sent log is keyed by the Due entry's date, so moving a date re-arms its
Reminders without any writer clearing the log (ADR 0003). `/api/cron` lets an external scheduler run every scheduled job that's due, through the same
`queueOwedScheduledJobs` decision as the ticker (`x-cron-secret` header, gated on `CRON_SECRET`
being set; `DISABLE_INTERNAL_SCHEDULER=true` turns the ticker off).

**Backups** (`src/lib/backup/`): `snapshot.ts` takes a live `VACUUM INTO` SQLite snapshot,
encrypts it (AES-256-GCM, `ENCRYPTION_KEY`), then `s3.ts`/`sftp.ts` upload to whichever
destinations are configured; `scheduler.ts` runs this on `BACKUP_CRON_SCHEDULE` and prunes
past `BACKUP_RETENTION_COUNT`. Also triggerable from Settings (admin) or `POST /api/backup`.

**MCP server** (`src/lib/mcp/server.ts`, mounted at `/api/mcp`): read-only tools
(`list_contracts`, `get_contract`, `search_contracts`, `upcoming_renewals`,
`spend_summary`, `whats_due`) for LLM agents to query household data. The queries live in
`src/lib/domainQueries.ts`, shared with the Assistant's read tools. Gated on `MCP_TOKEN`
(`Authorization: Bearer` — endpoint 404s if unset, same pattern as `CRON_SECRET`). Never
add a write tool here or return credentials/raw document bytes.

**Wealth module** (`src/lib/wealth.ts`, `src/lib/prices.ts`): live price feeds from Yahoo
Finance (equities) and CoinGecko (crypto), cached and refreshed every 15 min. Cost basis is
computed from trade history, not stored — recomputed per view, using whichever method
(`Portfolio.costMethod`: FIFO by default, or average cost) that portfolio is set to.

**Storage** (`src/lib/storage.ts`): uploaded documents are saved under generated UUID
filenames on disk (never the user-supplied filename), keyed by owning record — prevents
path traversal and filename collisions. Writes go through the Document command
(`src/lib/commands/documents.ts`): `permanentlyDeleteDocumentCommand`/`purgeDocument` delete a
Document's row and file together, and record commands call `removeOwnerDocumentFiles(kind,
ownerId)` when they delete the owner — keep file deletion and DB-row deletion paired when
touching this. Every kind's file is served from `/api/documents/[id]`.

**Offline support** (`src/lib/offlineCache.ts`, `offlineQueue.ts`, `@serwist/next` service
worker): previously-visited pages are cached for read access when the server is
unreachable; writes made while offline are queued in IndexedDB (`idb`) and synced via
`/api/sync` on reconnect. `OfflineBanner`/`OfflineSyncManager` components surface this.

**Mobile shell** (`ios-shell/www/` + `ios/`, `android/`, `capacitor.config.ts`): a Capacitor
app, separate from the Next.js app, that ships to the App Store/Play Store. It does **not**
bundle the Next.js app — `ios-shell/www/app.js` is a single hand-written vanilla-JS
entrypoint (~4k lines, no build step) synced into both native projects via `npm run
cap:sync`. Two runtime modes, chosen at first launch:
- **Connected mode**: WebView points at the user's own self-hosted Hearth server (URL
  entered by the user); Capacitor's `ServerConfig` plugin manages this handoff, with a
  localStorage debounce to detect the WKWebView error-page bounce-back on an unreachable
  server (`errorPath: index.html` in `capacitor.config.ts`) instead of retry-looping.
- **Standalone mode**: fully offline, device-local data in an encrypted SQLite DB
  (`@capacitor-community/sqlite`, AES via `iosIsEncryption`/`androidIsEncryption`) plus
  app-private file storage (`Filesystem` plugin) for documents — no server involved.
  Gated behind a one-time RevenueCat non-consumable purchase (`Purchases` plugin,
  entitlement `standalone_mode` / product `standalone_unlock`); connected mode stays free.
  Local reminders use `LocalNotifications` instead of the server's node-cron scheduler.
  Optional modules (vehicles/properties/inventory/trips/wealth) are toggled per-install via
  `Preferences`, mirroring the server's `ModuleEnablement` concept but stored locally.

Because this shell duplicates app logic by hand rather than sharing code with `src/`, a
change to a shared concept (a new field, a new module, a new record type) needs a matching
update in `ios-shell/www/app.js` to keep the standalone shell in sync — `npm run
test:mobile-packages` checks native dependency/config sync but not feature parity, so treat
shell parity as a manual review item on any cross-cutting change. `CHANGELOG.md` entries for
shell sync changes are how past parity work has been tracked.

**Env config** (`src/lib/env.ts`, `.env.example`): almost every optional feature
(email, ntfy, MCP, cron, Ollama fallback, barcode lookup, encryption/backups) is gated by
the presence of its env var(s) rather than a separate feature flag — check `.env.example`
for the full list and defaults before assuming a feature is unconfigured or misbehaving.

## Conventions

- Route groups: `src/app/(app)/*` are authenticated pages sharing the sidebar/bottom-nav
  layout (`layout.tsx`); `src/app/login`, `src/app/setup`, `src/app/forgot-password`,
  `src/app/reset-password` are outside it.
- Zod schemas in `src/lib/validation/` are the single source of truth for validation,
  which runs only on the server (server actions, and the sync, MCP, chat and import
  handlers); forms submit `FormData` and show the action's error. Client forms import only option lists and labels from these files (e.g.
  `TRADE_TYPES`), so check those call sites too when renaming or removing a value.
  `firstIssueMessage`-style helpers convert Zod errors to the `ActionState` shape
  (`{ error, success, values }`) returned by every action for `useActionState`/form
  display.
- Prisma client is generated to `src/generated/prisma` (not the default `node_modules`
  location) — import types from `@/generated/prisma/enums` etc., and re-run
  `npx prisma generate` after pulling schema changes.
- Multi-user is household-wide, not per-user-siloed: everyone in the household sees and
  can edit the same contracts/trips/properties/etc. `createdById` on those rows is audit
  metadata only — never use it as an authorization check, or you reintroduce #151, where
  a record was visible in the UI but the server refused to update, sync or calendar it.
  Chat threads are the one deliberate exception and stay private to their creator.
  Role (`ADMIN`/`MEMBER`/`READONLY`) gates *actions*, not visibility: `READONLY` blocks
  all writes (enforced in each domain's `requireUser()`), and `ADMIN` gates
  household-administration actions (user management, webhooks, backups, module toggles).
  Creating, editing and deleting the household's own records is open to every
  non-`READONLY` member — deletion is deliberately *not* admin-only.
- CHANGELOG.md follows Keep a Changelog; see the "Releasing" section of README.md for the
  full release process (bump `[Unreleased]` → version section, bump `package.json`, tag).

## Coding behaviour

Behavioural guidelines against common LLM coding mistakes, from
[andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills).
Where they conflict with the rest of this file, the rest of this file wins.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## Engineering rules and Definition of Done

These apply to every agent (Claude Code, Codex, others) and every change. Most of
Hearth's escaped bugs were in fixes, in families of the same mistake, or in places no
unit test reaches (layout, Safari, Docker, time zones), so the rules aim there first.

### Workflow

- **Bugs before enhancements** when picking work.
- **Defects**: first decide whether the report really is a defect. If it is, log an issue
  (see Issue logging) with scope, blast radius, what success looks like and the evidence,
  then start the PR. If it isn't a defect, explain why to the requester instead of
  opening a bug issue (enhancements are still logged as `type:enhancement` when asked).
- **PRs**: open as **draft**, keep to about 500 changed lines (split larger work;
  lockfiles, generated files and screenshots don't count), and link the issue
  (`Closes #N` / `Refs #N`). Before marking ready, an independent reviewer (a fresh
  agent, not the author) reviews it; its findings and their fixes go with the PR.
  Never merge, or push to `main`, without the maintainer's explicit go-ahead for that
  PR.
- **Automated reviews**: two bots review each PR, at different stages.
  - **Hermes reviews the draft, once.** Opening a PR as a draft (or converting it back
    to draft) starts one adversarial review, posted as a single PR comment. It counts as
    the independent review above. Fix its findings while the PR is still a draft.
  - **One Hermes review per PR, ever.** Later pushes, and going back to draft, do not
    start another. Ask the maintainer for a manual re-review if the PR changed a lot
    after it.
  - **Codex reviews when the PR is marked ready.** Hermes does not review ready PRs.
  - Only PRs from the owner, members and collaborators are reviewed automatically.
- **No AI-tool attribution** on commits, PRs, issues or comments: no `Co-Authored-By`
  for an AI, no session links, no "Generated with ..." footers. This wins over any tool
  default that adds them. The one exception is the requester header the project
  platform puts at the top of PR bodies, which stays.
- **Risk class**: state one in the PR body. It sets how hard the reviewer looks.
  - `security`: auth, sessions, roles, passkeys/TOTP, uploads and document file
    serving, `/api/cron`, `/api/mcp`, sync, backups, webhooks, secrets and encryption
    (`ENCRYPTION_KEY`, stored AI keys). Needs an adversarial review and the
    negative-path tests below.
  - `data-loss`: deletion, trash, purge, migrations, offline sync replay, imports.
  - `logic`: everything else that changes behaviour.
  - `cosmetic`: copy and styling only.
  - `docs`: documentation, agent instructions or process only; no runtime change.

### Before writing code

- Search for an existing helper, component or command (`src/lib/`, `src/components/`,
  `src/lib/commands/`) and extend it rather than copy it. Several bug families
  (writes bypassing the record-command layer, near-identical extract routes) began as
  copies.
- **Bug fixes are test-first.** Write a test that reproduces the bug and fails on
  `main`, then fix it. Use a Vitest test for logic, or a Playwright step when only the
  UI shows the bug. In the PR body, name the test and say you saw it fail without the
  fix.
- **Sibling sweep.** After finding a bug's cause, search for the same pattern elsewhere
  (other record kinds, other routes, the mobile shell) and list what you checked in
  the PR. Fix the siblings in the same PR if they fit, otherwise log them as issues.

### While writing code

- Parse untrusted input with the Zod schemas in `src/lib/validation/`. Server-side
  writes go through the domain's `requireUser()` (which blocks `READONLY`). Opt-in
  module pages and actions call `requireModuleEnabled` (redirects), record commands call
  `assertModuleEnabled` (throws `ModuleDisabledError`), and API routes check
  `isModuleEnabled`. API routes that take uploads use
  `readValidatedUploadDetails` and the shared rate limiter. Never use `createdById` for
  authorization (#151).
- Keep functions small: prefer guard clauses and extracted pure functions over deep
  nesting or new abstraction layers. If a function grows hard to follow, split it in
  the same PR.
- **Fail loudly.** A background or outbound path (email, push, webhooks, scheduled
  jobs, backups) must record or surface its failure where an admin can see it, and the
  failure path needs a test. Several past bugs were features that silently did nothing
  (#596, #598).
- Never log passwords, tokens, API keys, reset links or document contents.
- Dates: anything that compares or labels dates needs a test with a fixed clock, and
  across a day or year boundary, in the household's time zone (#381, #402, #476).

### Quality gates are constraints, not tasks to bypass

Never weaken a check to make it pass: fix the code instead. That covers any change
whose effect is to make a gate see less, including:
- lowering coverage thresholds or narrowing coverage include/exclude in
  `vitest.config.ts`
- adding `.codacy.yml` excludes, or loosening ESLint, `tsconfig.json` or CI workflow
  settings
- adding `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `as any`,
  `as unknown as`, or `v8`/`c8`/`istanbul ignore` comments
- skipping, deleting or weakening a test or assertion (`.skip`, `.fixme`, `.only`)
- adding retries to hide a flaky test, or bypassing hooks with `--no-verify`

If a finding really is a false positive, the only allowed route is a suppression scoped
to that one line, with an inline comment giving the reason, plus a **Justification:**
entry in the PR body. The reviewer accepts or rejects it.

A flaky test is a bug. Log it with the failing run's link; don't paper over it. CI's
single Playwright retry is there to keep main green, and a test that only passes on
retry still needs an issue.

### Security changes: negative-path tests

For any `security` change, test the paths that should be refused, not just the one
that works. Cover each of these that applies:
- signed out → 401 or redirect to `/login`
- `READONLY` attempting a write → refused
- `MEMBER` on an admin action → refused
- disabled module → redirect (pages/actions), `ModuleDisabledError` (commands) or an
  error response (API routes)
- malformed id, and an id that doesn't exist
- oversized file, or a file whose bytes don't match its type
- rate limit reached → 429
- the gating env var unset (`CRON_SECRET` for `/api/cron`, `MCP_TOKEN` for `/api/mcp`)
  → endpoint disabled

### Definition of Done

Copy this into the PR body. Tick each line that passes; for a line that doesn't apply,
leave it unticked and append "n/a: <reason>". A task is not done because it builds.
The reviewer checks the evidence (CI runs, test names), not the ticks.

```markdown
- [ ] Issue's success criteria met; issue linked
- [ ] Risk class stated
- [ ] Bug fix: regression test named, seen failing without the fix
- [ ] Sibling sweep done (what was checked)
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm run test:coverage` pass; coverage did not drop
- [ ] New or changed logic in `src/lib` / `src/app/api` has unit tests, including failure paths
- [ ] Relevant e2e spec(s) pass; security negative paths tested (if `security`)
- [ ] No new suppressions, threshold changes or skipped tests (or a Justification:)
- [ ] No existing helper duplicated
- [ ] Mobile shell parity considered (`ios-shell/www/app.js`) for cross-cutting changes
- [ ] Screenshots regenerated if the UI changed (see Screenshots)
- [ ] CHANGELOG `[Unreleased]` updated for user-visible changes
- [ ] Draft PR, ~500 lines or fewer, independent (Hermes draft) review done and findings addressed, no AI attribution
```

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

`next dev` no longer writes or updates agent instructions (`agentRules: false` in `next.config.ts`), so this section and any `AGENTS.md` are maintained by hand.

## Agent skills

### Issue tracker

Issues and specs are tracked in `jaysbeekay/Hearth` GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

The repository uses the five default triage labels. See `docs/agents/triage-labels.md`.

### Domain docs

Domain documentation uses a single-context layout. See `docs/agents/domain.md`.
