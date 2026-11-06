# Public demo instance

A public demo of Hearth (#553), seeded with a fictional household and reset
every night. It runs on two hosts at once from the same image:

| Host | Where | Cost | Idle behaviour |
|---|---|---|---|
| Fly.io | Johannesburg (`jnb`) | about US$6.70/month for a 1 GB machine left running at Fly's lowest regional price (`jnb` costs more), less when it stops on idle | Stops after a few idle minutes and starts again on the next request, in a few seconds |
| Render | Frankfurt | free (512 MB, so OCR of a large scanned upload may restart it, which also resets it) | Spins down after 15 minutes idle and takes about a minute to wake |

Prices come from each host's pricing page. Check them before relying on them.

## How it works

- **Seed.** `scripts/demo/seed.ts` writes one household through the app's own
  record commands: two users, every module on, about 10 Contracts and 8
  Warranties, 3 Trips, 2 Properties (one rented), 2 Vehicles, 11 Inventory
  items, 2 portfolios with trades, and 2 PDFs. All dates are offsets from the
  day it runs, so the Due list always has overdue and due-soon entries.
- **Image.** `docker/demo/Dockerfile` runs the seed at build time and copies
  the database and uploads into `/app/data` of a released Hearth image.
  Nothing demo-specific is added to the public image.
- **Reset.** Neither host has a volume. Every start, idle wake-up and deploy
  begins from the seed baked into the image, so visitors' changes never last.
  Sign-ins end at each new image too: the users are re-created with new IDs,
  and a session whose user no longer exists is rejected.
- **Nightly redeploy.** `.github/workflows/demo-deploy.yml` runs at 00:30 UTC,
  and again whenever a release's Docker image is published (once turned on,
  see step 6 below). It builds the demo
  image from the latest release, boots it once as a smoke test, pushes it to
  `ghcr.io/jaysbeekay/hearth-demo`, then deploys it to Fly.io and Render. The
  rebuild moves the seed's dates on to the new day. Until a release includes
  the demo files, it builds from `main` instead and says so in the run's
  warnings.

## Logins

| Who | Email | Password |
|---|---|---|
| Visitors (`MEMBER`) | `demo@example.com` | `hearth-demo` |
| Maintainer (`ADMIN`) | `admin@example.com` | the `DEMO_ADMIN_PASSWORD` secret; unusable if it isn't set |

Visitors are never `ADMIN`, so they can't reach users, backups, webhooks or
module settings. A visitor can still change the shared demo password or add
a passkey or TOTP to it, which locks other visitors out until the next reset.

## One-time setup

### 1. Make the image public

After the first workflow run, open the `hearth-demo` package on GitHub (your
profile > Packages > hearth-demo > Package settings) and set its visibility to
**Public**, so Fly.io and Render can pull it without credentials.

### 2. Fly.io

1. Create a Fly.io account and add a payment method.
2. Create an access token in the Fly.io dashboard that can create and deploy
   apps in your organisation. An app-scoped deploy token isn't enough for the
   first run, because the app doesn't exist yet.
3. Add it to the repo as the Actions secret `FLY_API_TOKEN`.
4. Optional: set the repo variable `FLY_DEMO_APP` if `hearth-demo` is taken
   (Fly app names are global), and `FLY_ORG` if the app should live outside
   your personal organisation.

The workflow creates the app on its first run, sets a fresh `AUTH_SECRET` on
every deploy, and serves it at `https://<app>.fly.dev`.

### 3. Render

1. In Render's dashboard choose **New > Blueprint**, connect this repository,
   and set the **Blueprint Path** to `docker/demo/render.yaml`. That creates
   the free `hearth-demo` web service in Frankfurt with a generated
   `AUTH_SECRET`.
2. In the service's **Settings > Deploy Hook**, copy the URL.
3. Add it to the repo as the Actions secret `RENDER_DEPLOY_HOOK_URL`.

### 4. Maintainer login (optional)

Add the Actions secret `DEMO_ADMIN_PASSWORD`. It is passed to the image
build as a BuildKit secret, so the password itself is never stored in the
image. Its bcrypt hash is, though, and the image is public, so use a long
random password (for example `openssl rand -base64 24`) that you use nowhere
else.

### 5. First deploy

Run **Actions > Demo deploy > Run workflow**. A host whose secret isn't set
is skipped, and the run's summary says which ones it deployed. On each host,
check that:

- the landing page goes to the login page, not first-run setup;
- `demo@example.com` / `hearth-demo` signs in and the Due list has overdue
  and due-soon entries;
- after a restart (Fly.io: `flyctl machine restart`; Render: restart the
  service from its dashboard), a record you added is gone.

To roll back, run the workflow again with an older tag as `ref`, or redeploy
an earlier `ghcr.io/jaysbeekay/hearth-demo:<date>-<sha>` image from the
host's dashboard.

### 6. Turn on the nightly reset

Once the first deploy checks out, add the repo variable `DEMO_DEPLOY_AUTO`
with the value `true`. Until then the nightly and release-triggered runs
are skipped, and only manual runs deploy.

## Run the seed locally

Always against a scratch database, never your real `/data`:

```bash
mkdir -p /tmp/hearth-demo/uploads && touch /tmp/hearth-demo/app.db
DATABASE_URL=file:/tmp/hearth-demo/app.db npx prisma migrate deploy
DATABASE_URL=file:/tmp/hearth-demo/app.db UPLOADS_DIR=/tmp/hearth-demo/uploads \
  npx tsx scripts/demo/seed-cli.ts
```

The script refuses a database that already has users, so it can't seed over
a real household. To build and run the demo image itself:

```bash
docker build -f docker/demo/Dockerfile --build-arg HEARTH_IMAGE=jaysbeekay/hearth:vX.Y.Z -t hearth-demo .
docker run --rm -p 3000:3000 -e AUTH_SECRET="$(openssl rand -base64 32)" hearth-demo
```

Use the release tag that matches your checkout, so the seed and the image's
migrations agree.
