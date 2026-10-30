# One-click deployment: PikaPods and Vercel

Investigation for [#477](https://github.com/jaysbeekay/Hearth/issues/477).
Provider facts were checked against their own documentation on
**2026-10-30**. Prices and limits change, so re-check the linked pages before
relying on a number here.

## Summary

| Target | Recommendation | In one line |
|---|---|---|
| **PikaPods** | **Go with changes** | It runs the published Docker image with a persistent volume, which is exactly what Hearth already is, so no code changes are required. This PR adds a health endpoint and documents the volume and env vars. The blocker is a licence: PikaPods lists apps with "a license that allows self-hosting", and Hearth has none. Choosing one, and applying, are for the owner. |
| **Vercel** | **No-go** for now | Every one of Hearth's runtime assumptions breaks on serverless. Making it work is four separate pieces of work and a different data-custody story. `git.deploymentEnabled: false` stays. |

## What Hearth assumes at runtime

These are the assumptions each target is checked against. All of them hold in
the Docker image today.

1. **Database**: a SQLite file on local disk (`DATABASE_URL=file:./data/app.db`,
   i.e. `/app/data/app.db` in the container), opened through
   `@prisma/adapter-libsql` (`src/lib/prisma.ts`). Built-in backups take a
   `VACUUM INTO` snapshot (`src/lib/backup/snapshot.ts`), and document search
   uses FTS5 virtual tables kept in sync by triggers.
2. **Documents**: uploaded files are written under `UPLOADS_DIR`
   (`/app/data/uploads`), named by generated UUIDs (`src/lib/storage.ts`). They
   are not encrypted at rest by Hearth. Uploads can be up to 15 MB
   (`MAX_UPLOAD_BYTES`).
3. **Scheduled work**: `src/instrumentation.ts` starts an in-process
   `node-cron` ticker every minute. It queues reminders, backups, email
   ingestion and a 15-minute price refresh. A processor drains the queue every
   20 seconds, which also carries OCR. `POST /api/cron` with an
   `x-cron-secret` header is an external trigger, but only for the reminder
   check.
4. **Document extraction**: `src/lib/documents/textExtraction.ts` shells out to
   `pdftotext`, `pdftoppm` and `tesseract`, which the Dockerfile installs from
   Alpine packages. If a binary is missing, the error is caught and treated as
   "no text found".
5. **Secrets and URL**: `AUTH_SECRET` is required. `ENCRYPTION_KEY` encrypts
   stored credentials and TOTP secrets, and gates backups. `APP_URL` is used in
   emailed links and is the passkey (WebAuthn) relying-party ID.
   `SETUP_TOKEN` optionally guards first-run setup.

## PikaPods

### What it is

PikaPods hosts open-source apps from their Docker images. Each app runs as a
"pod" that the household sizes with CPU, memory and storage sliders, in an EU
or a US region. PikaPods handles TLS, updates and monitoring, and offers
optional backups.

### How an app gets listed

There is no self-service submission form. PikaPods' FAQ says users "can
suggest or vote for" an app on its feedback page, and lists rough criteria
([Apps & Updates FAQ](https://docs.pikapods.com/faq/apps)). Hearth's fit
against each one:

| PikaPods criterion (quoted) | Hearth |
|---|---|
| A web application using "one HTTPS port only" | Yes: port 3000, plain HTTP behind their TLS proxy. |
| "an official (or semi-official) Docker image available" | Yes: `jaysbeekay/hearth` on Docker Hub, published per release tag. |
| "a license that allows self-hosting" | **No, not yet.** There's no `LICENSE` file, and README says "Private/personal project — no license specified." Without a licence, nobody else has the right to run the code, PikaPods included. The owner must choose one first. |
| Not heavy on CPU or bandwidth by design | Yes: one household. OCR is bursty but short. |
| No risk of abuse or affecting other pods (proxies, VPNs) | Yes. |
| Actively developed, with security issues addressed | Yes. |

The homepage advertises a "20% revenue share with project authors where
possible" ([pikapods.com](https://www.pikapods.com/)). Other projects say the
same: linkding's acknowledgements and Karakeep's install docs both mention
PikaPods sharing revenue with their maintainers. The terms are agreed with
PikaPods directly. The FAQ gives `hello@pikapods.com` as the contact.

### Against each runtime assumption

| Assumption | Works as-is? | Notes |
|---|---|---|
| SQLite on local disk | **Yes** | "Volumes live outside your pod and persist across updates and configuration changes" ([Files](https://docs.pikapods.com/manage/files)). Mount the volume at `/app/data`. |
| Documents on local disk | **Yes** | Same volume: `/app/data/uploads`. |
| `node-cron` schedulers | **Yes** | A pod is a long-running container, so the in-process ticker runs. |
| `pdftotext` / `pdftoppm` / `tesseract` | **Yes** | They're installed in the image PikaPods would run. |
| Secrets, `APP_URL`, passkeys | **Yes** | Env vars are set per pod. TLS ends at PikaPods' proxy, which sets `X-Forwarded-Proto` ([Technical FAQ](https://docs.pikapods.com/faq/technical)), so Hearth's HTTPS detection, HSTS and `upgrade-insecure-requests` behave as they do behind nginx. `APP_URL` must be the pod's `https://…pikapod.net` URL, or the custom domain. |
| Email reminders | **Needs an external SMTP provider** | "Currently PikaPods doesn't offer email sending services", and port 25 is blocked. Use a provider on port 465 or 587 (`SMTP_*`). ntfy push and webhooks are unaffected. |
| Health checks | **Added in this PR** | PikaPods' control panel "will always be allowed to run automated health checks on your pod" ([Firewall](https://docs.pikapods.com/manage/firewall)). Hearth had no health URL, so this PR adds `GET /api/health`. |
| CPU architecture | **Unknown** | PikaPods' docs don't say. The image is published for linux/amd64 only today. [#478](https://github.com/jaysbeekay/Hearth/issues/478) adds arm64 in case it's needed. |
| File ownership | **Should work, unconfirmed** | The entrypoint starts as root, adopts `/app/data` for uid 1000, then drops privileges. If PikaPods runs the container as a fixed non-root uid instead, the volume must be writable by that uid. The entrypoint detects this and prints the fix. Confirm with PikaPods during onboarding. |

### What PikaPods would need from us

- **Image**: `jaysbeekay/hearth`. Pin release tags (`vX.Y.Z`) rather than
  `latest`. PikaPods only rolls out "a stable release (as defined by the
  project)" that has been available for 48 hours, and emails users a week
  before breaking changes ([Apps & Updates FAQ](https://docs.pikapods.com/faq/apps)).
  Hearth's releases are tagged and changelogged, and migrations run
  automatically on start, so this fits.
- **Port**: `3000`.
- **Volume**: one, mounted at `/app/data`. It holds the database, documents,
  and local backups if those are enabled.
- **Health check**: `GET /api/health`. It returns `200 {"status":"ok"}` when
  the server and database answer, and `503 {"status":"unavailable"}`
  otherwise. It is public and returns nothing else.
- **Env vars**:

  | Variable | Value | Notes |
  |---|---|---|
  | `DATABASE_URL` | `file:./data/app.db` | Fixed. |
  | `UPLOADS_DIR` | `./data/uploads` | Fixed. |
  | `AUTH_SECRET` | generated per pod | Required. `openssl rand -base64 32`. |
  | `ENCRYPTION_KEY` | generated per pod | Strongly recommended. Same format. Needed for backups and encrypted credentials. |
  | `APP_URL` | the pod's `https://` URL | Required for passkeys and emailed links. |
  | `SETUP_TOKEN` | generated per pod | Strongly recommended (see Security). |
  | `TZ` | household's IANA zone | PikaPods servers run on UTC. |
  | `SMTP_*`, `NTFY_*`, `BACKUP_*`, others | optional | As in `.env.example`. |

  If PikaPods can generate per-pod random values, ask for `AUTH_SECRET`,
  `ENCRYPTION_KEY` and `SETUP_TOKEN` to be generated that way. They should
  never share a default.

### Cost to a household

PikaPods bills by allocated resources, by the hour. The docs don't publish
per-unit rates; the price is shown in the pod configurator.

- "Run the finest Open Source apps from just $1.80/month" and "Start free with
  $5 welcome credit" ([pikapods.com](https://www.pikapods.com/)).
- "There is also a minimum charge of $1 per pod per month, no matter the
  state." A stopped pod is charged for storage only
  ([Billing & Account FAQ](https://docs.pikapods.com/faq/account)).
- Optional offsite backups go to the household's own storage. The docs quote
  Backblaze B2 at "$6/TB/month" with 10 GB free
  ([Backup](https://docs.pikapods.com/manage/backup)).
- Email reminders need a separate SMTP provider, which may cost extra.

We haven't measured the smallest pod size Hearth runs well on, so we can't
give a monthly figure. Next.js plus on-demand OCR is heavier than the
cheapest apps in the catalog. Expect a few dollars a month, not cents, and
agree the recommended size with PikaPods.

### Data custody

- **Where the data lives**: in the chosen region. EU pods run in Hetzner data
  centres in Germany and Finland; US pods in Boston and Atlanta
  ([Technical FAQ](https://docs.pikapods.com/faq/technical)).
- **Who can read it**: Hearth stores the database and documents unencrypted
  on the volume. Only stored credentials and TOTP secrets are encrypted, with
  `ENCRYPTION_KEY`, and that key is itself an env var PikaPods holds. So
  PikaPods (and its infrastructure provider) can technically read everything,
  as with any managed host. That's the trade for not running a server
  yourself.
- **Getting it out**: SFTP access to the pod's files can be turned on in pod
  settings ([Files](https://docs.pikapods.com/manage/files)). The household
  can download `app.db` and `uploads/` at any time and move to a self-hosted
  Docker install by copying them into `./data`.
- **Backups**: PikaPods' own server backups are "only offered on a best-effort
  basis and not guaranteed", and they don't stop apps while copying, so "apps
  with their own database may not get a complete backup". Its incremental
  backups are encrypted with a password only the household holds
  ([Backup](https://docs.pikapods.com/manage/backup)). A file-level copy of a
  live SQLite database can be inconsistent, so we recommend also turning on
  Hearth's own backups (Settings → System). They take a consistent
  `VACUUM INTO` snapshot, encrypted with `ENCRYPTION_KEY`. Pointing a local
  backup at a path inside `/app/data` means PikaPods' file backups then pick
  up a consistent copy.

## Vercel

### What changed since 9daf161

Commit 9daf161 turned Vercel deploys off because Hearth "cannot run on Vercel
as architected". The four blockers it named still stand. Two newer Vercel
features were checked to see whether either opens a path:

- **Container runtime (beta)**. Vercel can now build a `Dockerfile`, which
  would bring the OCR binaries along. But the container is served as a
  request-driven function that "scales automatically with traffic" and scales
  down after five minutes without traffic. The guide describes no persistent
  disk, and the related Daemons feature (long-running workers) "do[es] not
  support … persistent local storage" during the beta
  ([Running Docker on Vercel](https://vercel.com/kb/guide/docker)). The
  database and documents would still vanish, and the in-process scheduler
  would still stop when the instance scales down.
- **Private Vercel Blob** and the Deploy Button's `stores` parameter can
  provision a private Blob store during deploy
  ([Deploy Button source](https://vercel.com/docs/deploy-button/source)). This
  solves storage only, and only after Hearth gains a storage abstraction.

Neither is a supported, working path today, so `vercel.json` keeps
`git.deploymentEnabled: false`.

### Against each runtime assumption

| Assumption | Works as-is? | What it would take |
|---|---|---|
| SQLite on local disk | **No** | "Vercel functions have a read-only filesystem with writable `/tmp` scratch space up to 500 MB" ([Runtimes](https://vercel.com/docs/functions/runtimes#file-system-support)). Scratch space isn't a shared, durable disk. The database would have to move to remote libSQL (Turso). `@prisma/adapter-libsql` supports this with a `libsql://` URL and an auth token. But Prisma's Turso page advises applying migrations with `prisma migrate diff` and the Turso CLI rather than `migrate deploy` ([Prisma + Turso](https://www.prisma.io/docs/orm/overview/databases/turso)). `VACUUM INTO` can't write a local snapshot from a remote database, and the FTS5 search migrations need checking against Turso: it lists FTS5 as built-in ([Turso extensions](https://docs.turso.tech/extensions)), but we haven't tested it. → [#482](https://github.com/jaysbeekay/Hearth/issues/482) |
| Documents on local disk | **No** | Needs a storage driver for Vercel Blob (private) or S3. Separately, "The maximum payload size for the request body or the response body of a Vercel Function is **4.5 MB**" ([Functions limits](https://vercel.com/docs/functions/limitations)), while Hearth accepts 15 MB uploads. So uploads would have to go straight from the browser to the store. → [#479](https://github.com/jaysbeekay/Hearth/issues/479) |
| `node-cron` schedulers | **No** | No process stays alive to run the ticker. Vercel Cron would have to call `/api/cron`, but Vercel sends a `GET` with `Authorization: Bearer <CRON_SECRET>` ([Managing Cron Jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs)). Hearth's endpoint only takes `POST` with `x-cron-secret`, and only runs reminders. On Hobby, "Cron jobs can only run once per day" and may fire anywhere within the hour ([Cron usage & pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing)), so the 15-minute price refresh and 20-second queue processor can't be reproduced there. → [#481](https://github.com/jaysbeekay/Hearth/issues/481) |
| `pdftotext` / `pdftoppm` / `tesseract` | **No** (Next.js build) | Not present in the Node.js runtime. Extraction would fall back to the household's own AI key, or attach-only. The container runtime could ship them, but brings the problems above. → [#480](https://github.com/jaysbeekay/Hearth/issues/480) |
| Secrets, `APP_URL`, passkeys | **Partly** | The Deploy Button can prompt for required env vars (`env`, `envDescription`, `envLink`), but "You cannot pass environment variable values using this parameter", and defaults must never be secrets ([Deploy Button env vars](https://vercel.com/docs/deploy-button/environment-variables)). So every household would generate `AUTH_SECRET` and `ENCRYPTION_KEY` by hand. `APP_URL` isn't known until after the first deploy. |
| Function duration | **Mostly** | Hobby functions run for at most 300 s ([Functions limits](https://vercel.com/docs/functions/limitations)). That's enough for a page, but a long OCR job or a large backup must fit or be split. |

### Cost to a household

- **Vercel Hobby**: free, but "restricts users to non-commercial, personal use
  only". It includes 4 active CPU-hours, 360 GB-hours of provisioned memory
  and 1,000,000 function invocations a month. Going over pauses the feature
  until 30 days have passed ([Hobby plan](https://vercel.com/docs/plans/hobby)).
  A household's own instance counts as personal use, but the once-a-day cron
  limit applies.
- **Vercel Pro**: "Developer seats cost $20 per user / month"
  ([Hobby plan, Upgrading to Pro](https://vercel.com/docs/plans/hobby#upgrading-to-pro)),
  plus usage beyond the included credit.
- **Vercel Blob on Hobby**: 1 GB storage, 10,000 simple and 2,000 advanced
  operations, and 10 GB data transfer a month. Beyond those, "you will not be
  able to access Vercel Blob if limits are exceeded … you will have to wait
  until 30 days have passed" ([Blob pricing](https://vercel.com/docs/vercel-blob/usage-and-pricing)).
  A household that scans its paperwork could hit 1 GB, and then lose access
  to every document for a month.
- **Turso**: Free plan $0 with 5 GB storage and 1 day of point-in-time
  restore. Developer plan $4.99/month with 9 GB and 10 days
  ([Turso pricing](https://turso.tech/pricing)).

So a Vercel deployment is free to start but could stop working in ways a
household won't expect. Making it reliable costs about $25/month (Pro plus
Turso Developer), against a few dollars on PikaPods.

### Data custody

The household's data would be split across three accounts: the database at
Turso, documents in Vercel Blob, and the code and env vars (including
`ENCRYPTION_KEY`) at Vercel. Functions default to the `iad1` (US East)
region ([Runtimes](https://vercel.com/docs/functions/runtimes)). Leaving means exporting from two services and converting a Turso
database back into a SQLite file. Compare "copy one `data/` directory", which
is what Docker and PikaPods give you.

## Security notes

These apply to any hosted instance, PikaPods especially:

- **Claim the instance straight away, or set `SETUP_TOKEN`.** A new pod is
  reachable on the public internet at once. Until the first account exists,
  whoever submits `/setup` first becomes the administrator. With
  `SETUP_TOKEN` set, setup also asks for the token.
- **Set `ENCRYPTION_KEY`.** Without it, SMTP, ntfy and backup credentials,
  AI keys and TOTP secrets sit in the database in the clear, and backups stay
  off. Keep a copy somewhere other than the host: a backup can't be decrypted
  without it.
- **Set `APP_URL` before adding passkeys.** The URL's host is the passkey
  relying-party ID. Moving from `*.pikapod.net` to a custom domain later means
  everyone re-registers their passkeys. Pick the final domain first.
- **Consider the IP allowlist.** PikaPods' firewall can restrict a pod to
  listed IPs ([Firewall](https://docs.pikapods.com/manage/firewall)). That's
  the hosted equivalent of the README's nginx + mTLS setup, which isn't
  available on PikaPods. Remember that home IPs change.
- **`/api/health` is public by design.** It returns only
  `{"status":"ok"}` or `{"status":"unavailable"}`: no version, no error text,
  and nothing about the household.
- **The host can read your data.** See Data custody above. Hearth doesn't
  encrypt the database or documents at rest; the volume is in the host's
  hands.
- **Vercel-specific, should it ever be revisited**: the Blob store must be
  private, preview deployments must not share production's database or env
  vars, and `/api/cron` must compare `CRON_SECRET` in constant time.

## What the owner needs to do

Only the repository owner can do these:

1. **Choose a licence.** PikaPods requires "a license that allows
   self-hosting", and Hearth currently has none. Add a `LICENSE` file and
   update README's "License" section. Which licence is the owner's call: it
   decides whether hosts like PikaPods may run Hearth commercially, and on
   what terms.
2. **Apply to PikaPods.** Suggest Hearth on PikaPods' feedback page and email
   `hello@pikapods.com`. Send the image name, port `3000`, volume `/app/data`,
   health check `/api/health`, and the env-var table above. Ask them to
   generate the secrets per pod, confirm the CPU architecture and the uid the
   container runs as, and agree a recommended pod size. Ask about the revenue
   share.
3. **Keep releases PikaPods-friendly.** Tag stable releases (`vX.Y.Z`) as now,
   and call out breaking changes in `CHANGELOG.md` early: PikaPods emails
   users a week before rolling those out.
4. **Once listed, add the PikaPods link** to README's "Deploy" section. It
   currently says the listing is pending.
5. **Vercel dashboard (optional).** Commit 9daf161 noted that fully removing
   the Vercel integration is a dashboard action. If the Vercel project still
   exists, disconnect or delete it. No Vercel project is needed for anything
   in this document.
6. **Triage the follow-ups** below. Only #478 matters for PikaPods; the rest
   only matter if serverless hosting becomes a goal.

## Follow-up issues

| Issue | Needed for |
|---|---|
| [#478](https://github.com/jaysbeekay/Hearth/issues/478) Publish a linux/arm64 image alongside amd64 | PikaPods only if it runs ARM nodes; ARM self-hosters regardless |
| [#479](https://github.com/jaysbeekay/Hearth/issues/479) Pluggable document storage: local disk or S3-compatible / Vercel Blob | Vercel / any serverless host |
| [#480](https://github.com/jaysbeekay/Hearth/issues/480) Degrade document extraction gracefully when the binaries are missing | Vercel; also non-Docker installs |
| [#481](https://github.com/jaysbeekay/Hearth/issues/481) Run every scheduled job from `/api/cron`, and accept Vercel Cron's request shape | Vercel / any scale-to-zero host |
| [#482](https://github.com/jaysbeekay/Hearth/issues/482) Support a remote libSQL database (Turso) | Vercel / any serverless host |

Vercel becomes a candidate again only when #479, #481 and #482 have all
landed. #480 is needed for a good experience there too.

## Sources

All checked 2026-10-30.

- PikaPods: [homepage](https://www.pikapods.com/) ·
  [Apps & Updates FAQ](https://docs.pikapods.com/faq/apps) ·
  [Billing & Account FAQ](https://docs.pikapods.com/faq/account) ·
  [Technical FAQ](https://docs.pikapods.com/faq/technical) ·
  [Files](https://docs.pikapods.com/manage/files) ·
  [Backup](https://docs.pikapods.com/manage/backup) ·
  [Firewall](https://docs.pikapods.com/manage/firewall) ·
  [Custom domains](https://docs.pikapods.com/manage/custom-domains) ·
  [Getting started](https://docs.pikapods.com/manage/getting-started/)
- Vercel: [Functions limits](https://vercel.com/docs/functions/limitations) ·
  [Runtimes](https://vercel.com/docs/functions/runtimes) ·
  [Running Docker on Vercel](https://vercel.com/kb/guide/docker) ·
  [Cron usage & pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing) ·
  [Managing Cron Jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs) ·
  [Deploy Button source](https://vercel.com/docs/deploy-button/source) ·
  [Deploy Button env vars](https://vercel.com/docs/deploy-button/environment-variables) ·
  [Blob pricing](https://vercel.com/docs/vercel-blob/usage-and-pricing) ·
  [Private Blob storage](https://vercel.com/docs/vercel-blob/private-storage) ·
  [Hobby plan](https://vercel.com/docs/plans/hobby)
- Turso / Prisma: [Turso pricing](https://turso.tech/pricing) ·
  [Turso extensions](https://docs.turso.tech/extensions) ·
  [Prisma + Turso](https://www.prisma.io/docs/orm/overview/databases/turso)
- Revenue-share examples: [linkding acknowledgements](https://linkding.link/acknowledgements/) ·
  [Karakeep on PikaPods](https://docs.karakeep.app/installation/pikapods)
