# Public demo image (#553): a released Hearth image with a sample household
# baked into /app/data.
#
# The demo hosts (Fly.io, Render free) run it with no volume, so every
# machine start, idle wake-up and redeploy begins from this seed again.
# The nightly "Demo deploy" workflow rebuilds it, which also moves the
# seed's dates along so the Due list always has overdue and due-soon entries.
# Nothing here changes the public image: the demo-only parts live in this
# file and scripts/demo, never in the app (DEMO_MODE stays gone).
#
# Build from the repo root, with the source at the same version as the base
# image so the seed and the migrations match:
#   docker build -f docker/demo/Dockerfile \
#     --build-arg HEARTH_IMAGE=jaysbeekay/hearth:vX.Y.Z \
#     --secret id=demo_admin_password,env=DEMO_ADMIN_PASSWORD .
ARG HEARTH_IMAGE=jaysbeekay/hearth:latest

FROM node:26-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS seed
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npx prisma generate
ARG DEMO_MEMBER_PASSWORD=hearth-demo
# The maintainer's password comes in as a build secret, so it never lands in
# an image layer or the build history. Without it the admin login is random
# and unusable, which is fine for a demo.
RUN --mount=type=secret,id=demo_admin_password \
    mkdir -p /seed/uploads && touch /seed/app.db && \
    DATABASE_URL=file:/seed/app.db npx prisma migrate deploy && \
    DEMO_ADMIN_PASSWORD="$(cat /run/secrets/demo_admin_password 2>/dev/null || true)" \
    DEMO_MEMBER_PASSWORD="$DEMO_MEMBER_PASSWORD" \
    DATABASE_URL=file:/seed/app.db UPLOADS_DIR=/seed/uploads \
    npx tsx scripts/demo/seed-cli.ts

FROM ${HEARTH_IMAGE}
COPY --chown=node:node --from=seed /seed/ /app/data/
