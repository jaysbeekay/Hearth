# One-click deployment: PikaPods, Render and Vercel

Investigation for [#477](https://github.com/jaysbeekay/Hearth/issues/477).
Provider facts were checked against their own documentation on
**2026-10-30**. Prices and limits change, so re-check the linked pages before
relying on a number here.

## Summary

| Target | Recommendation | In one line |
|---|---|---|
| **PikaPods** | **Go with changes** | It runs the published Docker image with a persistent volume, which is exactly what Hearth already is, so no code changes are required. This PR adds a health endpoint and documents the volume and env vars. Hearth is now AGPL-3.0, which allows self-hosting, so the licence is no longer a blocker. Applying is for the owner. |
| **Render** | **Go** (Blueprint and button added in this PR) | A paid web service with a persistent disk runs the same Docker image unchanged, at about $25.25/month on the default 2 GB instance, or about $7.25 on 512 MB for households that rarely scan documents. Prices are from Render's pricing page; check it before relying on them. The free tier is out: it can't have a disk and sleeps after 15 minutes. With a disk there's one instance and a short outage on each deploy, which is fine for a household. |
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
| "a license that allows self-hosting" | **Yes.** Hearth is licensed AGPL-3.0-only (see `LICENSE`), which allows anyone to run it. |
| Not heavy on CPU or bandwidth by design | Yes: one household. OCR is bursty but short. |
| No risk of abuse or affecting other pods (proxies, VPNs) | Yes. |
| Actively developed, with security issues addressed | Yes. |
| "Not compete with the author's own paid hosting service, unless alternative hosting options are actively promoted." | Yes: there is no paid Hearth hosting. |

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
  the server can read its database, and `503 {"status":"unavailable"}`
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

## Render

### What it is

Render is a general-purpose cloud platform. A household deploys its own
copy with the "Deploy to Render" button, which reads a `render.yaml`
Blueprint from this repository. There's no catalogue to apply to, so unlike
PikaPods this can ship now. This PR adds the Blueprint and the README button.
The button only works once a release that includes `/api/health` is
published (the first release after v0.19.2): the Blueprint pulls `:latest`,
and Render's health check fails on any image without that route.

### Against each runtime assumption

| Assumption | Works as-is? | Notes |
|---|---|---|
| SQLite on local disk | **Yes, on a paid instance with a disk** | "You can attach a persistent disk to a paid Render web service". Free instances can't. "Only filesystem changes under this path are preserved across deploys and restarts!" ([Disks](https://render.com/docs/disks)). So the disk is mounted at `/app/data`, the path the image and `docker-compose.yml` already use. "All disks are encrypted at rest, and so are their automatic daily snapshots." |
| Documents on local disk | **Yes** | Same disk: `/app/data/uploads`. |
| `node-cron` schedulers | **Yes, on a paid instance** | A paid web service keeps running, so the in-process ticker works and no Render Cron Job is needed. A Free web service spins down after "15 minutes without receiving any inbound traffic", and waking takes "about one minute" ([Free instances](https://render.com/docs/free)). While it sleeps, nothing runs: no reminders, backups or price refresh. |
| Render Cron Jobs → `/api/cron` | **Not needed; limited if used** | A cron job is a separate service with "a minimum monthly charge of $1", and "You can't add a disk to a cron job service" ([Cron Jobs](https://render.com/docs/cronjobs), [Disks](https://render.com/docs/disks)). It could only `curl` the web service's `/api/cron`, which today runs reminders only. That's [#481](https://github.com/jaysbeekay/Hearth/issues/481). It only matters for a sleeping free instance, and that can't keep data anyway. |
| `pdftotext` / `pdftoppm` / `tesseract` | **Yes** | They're in the Docker image. Render requires images "built for the `linux/amd64` platform" ([Deploy a prebuilt image](https://render.com/docs/deploying-an-image)), which is what's published today. |
| Secrets, `APP_URL`, passkeys | **Yes** | `generateValue: true` sets "a randomized, base64-encoded, 256-bit value" once ([Blueprint spec](https://render.com/docs/blueprint-spec#generating-random-secrets)). That is exactly the format `ENCRYPTION_KEY` needs (32 bytes, base64) and works for `AUTH_SECRET` and `SETUP_TOKEN` too. `APP_URL` isn't asked for: when it's unset, Hearth uses Render's `RENDER_EXTERNAL_URL`, "the service's full `onrender.com` URL" ([Environment variables](https://render.com/docs/environment-variables)). For a custom domain, set `APP_URL` in the Environment page *before anyone registers a passkey*, because passkeys are bound to the hostname. TLS ends at Render's load balancer, which forwards plain HTTP ([Web services](https://render.com/docs/web-services)). **Whether Render sets `X-Forwarded-Proto` is unknown**: its docs don't say. If it doesn't, Hearth won't send HSTS or `upgrade-insecure-requests`; Render redirects HTTP to HTTPS itself either way. |
| Health checks | **Yes** | `healthCheckPath: /api/health`. Render stops routing to an instance that fails checks for 15 seconds, and restarts it after 60 seconds ([Health checks](https://render.com/docs/health-checks)). |
| Deploys and scaling | **Single instance, brief downtime** | "Adding a disk to a service prevents zero-downtime deploys": Render stops the old instance before starting the new one. A disk is accessible by only one instance, so there's no horizontal scaling ([Disks](https://render.com/docs/disks)). Neither matters for one household: Hearth is a single-instance app anyway, and a deploy is a short outage. |
| Updates | **Manual** | "Image-backed services do not automatically redeploy whenever a new image is associated with their assigned tag." The household reads `CHANGELOG.md`, then clicks *Manual Deploy → Deploy latest reference*, or calls the service's deploy hook ([Deploy a prebuilt image](https://render.com/docs/deploying-an-image)). Migrations run automatically on start, as in Docker. To control upgrades, pin a release: in the service's Settings, change the image URL to `docker.io/jaysbeekay/hearth:vX.Y.Z`, and change it to the next tag when you choose to upgrade. |
| Memory | **2 GB by default; 512 MB is a cheaper option** | Measured natively on macOS, not in the container (Docker wasn't available), so treat these as estimates. The production server used about 275 MB RSS idle and about 350 MB after serving pages. OCR of a 6-page image-only PDF ran `pdftoppm` (peak about 46 MB) and then one `tesseract` per page, each peaking at about 108 MB. Server plus OCR comes to roughly 460 MB, which leaves too little headroom in 512 MB, so the Blueprint uses `1c-2g`. A household that rarely scans documents can switch to `0.5c-512mb` in Settings, and switch back if Render restarts the service for memory. |

### What the Blueprint sets up

[`render.yaml`](../../render.yaml) defines one web service:

- **Image**: `docker.io/jaysbeekay/hearth:latest` (`runtime: image`), so
  Render doesn't rebuild from source. The Blueprint was validated against
  Render's published JSON schema
  (`https://render.com/schema/render.yaml.json`) on 2026-10-30, and
  `tests/unit/render-blueprint.test.ts` keeps it in step with the image's
  paths.
- **Plan**: `1c-2g`, one instance (see Memory above).
- **Disk**: `hearth-data`, 1 GB, mounted at `/app/data`. It can grow later
  but never shrink.
- **Health check**: `/api/health`.
- **Env vars**: `PORT=3000`, `HOSTNAME=0.0.0.0` (the image sets it already;
  repeated as a precaution), `DATABASE_URL=file:./data/app.db` and
  `UPLOADS_DIR=./data/uploads`. `AUTH_SECRET`, `ENCRYPTION_KEY` and
  `SETUP_TOKEN` are generated by Render. `TZ` is prompted, because Render's
  servers run on UTC. `APP_URL` is left unset, so Render's URL is used.
  Everything else (`SMTP_*`, `NTFY_*`, backups…) is added afterwards in the
  service's Environment page.
- **Region**: not set, so Render's default, Oregon, applies. Render's regions
  are Oregon, Ohio, Virginia, Frankfurt and Singapore
  ([Regions](https://render.com/docs/regions)), and "You can't modify this
  value after creation" ([Blueprint spec](https://render.com/docs/blueprint-spec)).
  A household that wants Frankfurt or Singapore forks the repo, adds
  `region:` to `render.yaml`, and deploys from the fork.

### Cost to a household

Render's docs pages don't state prices. These figures come from the pricing
page, [render.com/pricing](https://render.com/pricing), as read on
2026-10-30. They couldn't be checked against the docs, so check the pricing
page before relying on them.

- The Hobby workspace is "$0/month + compute", "For individuals building
  personal projects and prototypes", with "5 GB of bandwidth included" (then
  $0.15 per GB).
- Compute: "Less than 1 CPU | $7/month | 512 MB RAM | 0.5c-512mb", or "1 CPU
  | $25/month | 2 GB RAM | 1c-2g".
- Persistent disks: "$0.25 per GB per month".

So the Blueprint as written costs about **$25.25/month** (2 GB instance and
a 1 GB disk), or about $7.25 on the 512 MB instance. The free
instance isn't an option: it can't have a disk, so every restart or
spin-down would erase the household's data.

### Data custody

- **Where the data lives**: in the chosen Render region. Oregon is the
  default; Frankfurt and Singapore are the non-US options.
- **Who can read it**: as with PikaPods, the database and documents are
  unencrypted inside the container, and the generated `ENCRYPTION_KEY` sits in
  Render's env settings. Render encrypts the disk at rest, which protects
  against a lost drive, not against the platform.
- **Backups**: Render snapshots the disk every 24 hours and keeps snapshots
  for seven days. A restore reverts the whole disk, and Render advises
  against relying on snapshots to recover a database
  ([Disks](https://render.com/docs/disks)). Turn on Hearth's own encrypted
  backups to S3 or SFTP as well.
- **Getting it out**: Render supports SCP or `magic-wormhole` from the
  service's shell ([Disks](https://render.com/docs/disks)). Copy `app.db` and
  `uploads/` into `./data` on any Docker host to move.

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
Turso Developer), against a few dollars on PikaPods or $7.25–$25.25 on Render.

### Data custody

The household's data would be split across three accounts: the database at
Turso, documents in Vercel Blob, and the code and env vars (including
`ENCRYPTION_KEY`) at Vercel. Functions default to the `iad1` (US East)
region ([Runtimes](https://vercel.com/docs/functions/runtimes)). Leaving means exporting from two services and converting a Turso
database back into a SQLite file. Compare "copy one `data/` directory", which
is what Docker, PikaPods and Render give you.

## Side by side

| | PikaPods | Render | Vercel |
|---|---|---|---|
| Runs Hearth unchanged | Yes | Yes (paid instance + disk) | No |
| Monthly cost, one household | Configurator-priced; $1/pod minimum, "from $1.80"; size not yet agreed | About $25.25 (2 GB + 1 GB disk, the default); about $7.25 on 512 MB. From the pricing page, not the docs | $0 on Hobby but unreliable; about $25 to make it work |
| Free option | $5 welcome credit | None that keeps data | Hobby, with once-a-day cron and Blob cut-offs |
| Where data lives | EU (Germany, Finland) or US | Oregon by default; Ohio, Virginia, Frankfurt, Singapore | US East by default; split across Vercel and Turso |
| Host's own backups | Best effort, plus optional encrypted Restic | Daily disk snapshots, kept 7 days | Turso PITR (1–10 days); Blob none stated |
| Moving out | SFTP the `data/` folder | SCP / magic-wormhole the `data/` folder | Export from two services, convert the database |
| Updates | PikaPods rolls out stable releases | Household clicks "Deploy latest reference" | The button copies the repo into the household's account; upstream releases need a manual sync |
| Who must act | Owner: application | Owner: cut a release; then the README button | Not viable yet |

All three hosts can technically read the household's data, as any host can.
Hearth's own encrypted backups to the household's S3 or SFTP storage are the
way to keep a copy the host can't read.

## Security notes

These apply to any hosted instance:

- **Claim the instance straight away, or set `SETUP_TOKEN`.** A new pod is
  reachable on the public internet at once. Until the first account exists,
  whoever submits `/setup` first becomes the administrator. With
  `SETUP_TOKEN` set, setup also asks for the token. The Render Blueprint
  generates one; copy it from the service's Environment page.
- **Set `ENCRYPTION_KEY`.** Without it, SMTP, ntfy and backup credentials,
  AI keys and TOTP secrets sit in the database in the clear, and backups stay
  off. Keep a copy somewhere other than the host: a backup can't be decrypted
  without it.
- **Set `APP_URL` before adding passkeys.** The URL's host is the passkey
  relying-party ID. Moving from `*.pikapod.net` or `*.onrender.com` to a
  custom domain later means everyone re-registers their passkeys. Pick the
  final domain first. On Render, an unset `APP_URL` falls back to the
  service's `onrender.com` URL.
- **Consider the IP allowlist.** PikaPods' firewall can restrict a pod to
  listed IPs ([Firewall](https://docs.pikapods.com/manage/firewall)). That's
  the hosted equivalent of the README's nginx + mTLS setup, which isn't
  available on PikaPods. Remember that home IPs change. Render's `ipAllowList`
  is for "Scale and Enterprise workspaces only"
  ([Blueprint spec](https://render.com/docs/blueprint-spec)), so a Hobby
  Render instance is open to the internet and relies on Hearth's own login,
  TOTP and passkeys.
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

1. **Cut a release after merging.** The Render Blueprint pulls
   `jaysbeekay/hearth:latest` and health-checks `/api/health`, which only
   exists from this PR on. Until a release containing it is published,
   Render's health check gets a 404 and the deploy fails. After that release,
   a test deploy from the README button confirms the end-to-end flow. That
   needs a Render account and costs a few cents for a short test.
2. **Licence: done.** Hearth is AGPL-3.0-only. Note for the PikaPods
   conversation: the AGPL allows a paid host to run Hearth, but a host that
   modifies it must publish those changes. Running the published image
   unmodified needs nothing further.
3. **Apply to PikaPods.** Suggest Hearth on PikaPods' feedback page and email
   `hello@pikapods.com`. Send the image name, port `3000`, volume `/app/data`,
   health check `/api/health`, and the env-var table above. Ask them to
   generate the secrets per pod, confirm the CPU architecture and the uid the
   container runs as, and agree a recommended pod size. Ask about the revenue
   share.
4. **Keep releases PikaPods-friendly.** Tag stable releases (`vX.Y.Z`) as now,
   and call out breaking changes in `CHANGELOG.md` early: PikaPods emails
   users a week before rolling those out.
5. **Once listed, add the PikaPods link** to README's "Deploy" section. It
   currently says the listing is pending.
6. **Vercel dashboard (optional).** Commit 9daf161 noted that fully removing
   the Vercel integration is a dashboard action. If the Vercel project still
   exists, disconnect or delete it. No Vercel project is needed for anything
   in this document.
7. **Triage the follow-ups** below. Only #478 matters for PikaPods, and none
   block Render. The rest only matter if serverless hosting becomes a goal.

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
- Render: [pricing](https://render.com/pricing) ·
  [Persistent disks](https://render.com/docs/disks) ·
  [Free instances](https://render.com/docs/free) ·
  [Blueprint spec](https://render.com/docs/blueprint-spec) ·
  [Blueprint JSON schema](https://render.com/schema/render.yaml.json) ·
  [Deploy to Render button](https://render.com/docs/deploy-to-render) ·
  [Deploy a prebuilt image](https://render.com/docs/deploying-an-image) ·
  [Web services](https://render.com/docs/web-services) ·
  [Health checks](https://render.com/docs/health-checks) ·
  [Cron Jobs](https://render.com/docs/cronjobs) ·
  [Regions](https://render.com/docs/regions) ·
  [Environment variables](https://render.com/docs/environment-variables)
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
