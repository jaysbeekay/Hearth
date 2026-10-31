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

Until both are set, an `@codebot` comment still gets the 👀 reaction but the send step fails.

**GitHub App:** install `thebotkeeper` on jaysbeekay/Hearth (its Configure page → Repository
access).

**Hermes (server side):**

- Allow `jaysbeekay/Hearth` on the webhook route and in the `post-guard` hook.
- Add Hearth to whatever starts the automatic reviews for jaysbeekay/sure, so draft PRs are
  reviewed without an `@codebot` comment.
- Hearth is Next.js/TypeScript, not Rails. Its checks are `npx tsc --noEmit`, `npm run lint`,
  `npm run test:unit` and the Playwright e2e suite.

## Checking it works

Open a throwaway draft PR and wait for a "PR Review - Light" comment from `thebotkeeper[bot]`. Then
comment `@codebot review` on it and confirm the 👀 reaction and a green **CodeBot** run under
Actions.
