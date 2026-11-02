# Gatekeeper reviews

Gatekeeper is the self-hosted review bot (Hermes, `pr-gatekeeper` and `qa-issue-review` profiles)
that also reviews jaysbeekay/sure. It posts as the GitHub App `thebotkeeper[bot]`:

- **Draft PR** → a light-touch "PR Review - Light" (direction and material findings only).
- **PR marked ready** → a full PR review.
- **New issue** → a "QA Review" of the issue and its plan.
- **`@codebot …` comment by the owner** → an on-demand review of that issue or PR.

## What lives where

| Piece | Where | Notes |
|---|---|---|
| Automatic draft, ready and issue reviews | Hermes, on the server | Nothing in this repository triggers them. Hermes acts on events for repositories it is set up for. |
| `@codebot` requests | `.github/workflows/codebot.yml` | Owner-only. Reacts 👀, then sends an HMAC-signed payload to Hermes. Same payload shape as jaysbeekay/sure's `main.yml`, so Hermes' prompt templates read it unchanged. |
| Board moves after reviews | `.github/workflows/project-status.yml` | Optional, see `docs/project-status.md`. |

## Setup

**Repository secrets** (Settings → Secrets and variables → Actions → Secrets):

- `CODEBOT_SECRET`: the HMAC secret Hermes' webhook route verifies.
- `AI_WEBHOOK_URL`: the Hermes webhook URL.

Until both are set, the CodeBot run fails at its first step (it never signs with an empty key).

**GitHub App:** install `thebotkeeper` on jaysbeekay/Hearth (its Configure page → Repository
access).

**Hermes (server side):**

- Allow `jaysbeekay/Hearth` on the webhook route and in the `post-guard` hook.
- Add Hearth to whatever starts the automatic reviews for jaysbeekay/sure, so draft PRs are
  reviewed without an `@codebot` comment.
- The route must verify `X-Webhook-Signature-V2` (HMAC-SHA256 of `<timestamp>.<body>` with
  `CODEBOT_SECRET`), reject a stale `X-Webhook-Timestamp`, deduplicate on `X-Request-ID`
  (`curl --retry` can deliver a request more than once), accept only repositories it is set up
  for, and treat the quoted comment text as data, never as instructions for a privileged token.
- Hearth is Next.js/TypeScript, not Rails. Its checks are `npx tsc --noEmit`, `npm run lint`,
  `npm run test:unit` and the Playwright e2e suite.

## Checking it works

Open a throwaway draft PR and wait for a "PR Review - Light" comment from `thebotkeeper[bot]`. Then
comment `@codebot review` on it and confirm the 👀 reaction and a green **CodeBot** run under
Actions.

## Turning it off

Fastest first:

1. **Stop `@codebot` requests:** Actions → **CodeBot** → ⋯ → **Disable workflow**. Or delete the
   `AI_WEBHOOK_URL` secret, which makes the send step fail without reaching Hermes.
2. **Stop the board moves:** disable **Project status** the same way, or delete `PROJECT_TOKEN`.
3. **Stop the automatic reviews:** remove `jaysbeekay/Hearth` from the Hermes allowlist and the
   `post-guard` hook, or remove Hearth from the thebotkeeper App's repository access.
4. **Rotate:** if `CODEBOT_SECRET` may have leaked, change it in Hearth's secrets and on the
   Hermes route together.

## Before relying on it

CI cannot show that Hermes enforces the checks above. Run these once on a throwaway PR and
record the result:

- an owner `@codebot review` (expect the 👀 reaction, a green run, and a review);
- the same comment from a non-owner account (expect the workflow to be skipped);
- a PR from a fork (expect no `@codebot` effect and no secrets exposed);
- a replayed request, a wrong signature and a stale timestamp sent straight to the route
  (expect all three rejected).
