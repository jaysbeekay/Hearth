# Pinned by digest, not just by tag: `node:26-alpine` is a moving target, so an
# unpinned build is not reproducible and silently picks up whatever the tag
# points at that day. This is the multi-arch index digest, so buildx still
# selects the right architecture.
#
# To update: docker buildx imagetools inspect node:26-alpine
FROM node:26-alpine@sha256:2d984a15c9b54fd0aeb608b8e0d0d83529eb34d2966db27a1fb4f1edc3d298a3 AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# Separate prod-only install so devDependencies (typescript, eslint, tailwind
# build tooling, etc.) never end up in the runtime image — they're not needed
# at runtime and are a common source of flagged vulnerabilities that don't
# actually affect a running container.
FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Some tooling (e.g. prisma's engine cache) writes under $HOME — point it at
# the app user's own home so nothing tries to write to /root after
# privileges are dropped.
ENV HOME=/home/node

# Upgrade already-installed OS packages to their latest patched versions
# (the base image's apk index can lag behind by the time this builds), then
# install tesseract-ocr + poppler-utils, which power document OCR/text-
# extraction for the "auto-fill from document" feature (see src/lib/documents).
#
# su-exec drops from root to the app user in docker-entrypoint.sh — see the
# comment there for why the entrypoint starts as root.
RUN apk update && \
    apk upgrade --no-cache && \
    apk add --no-cache tesseract-ocr tesseract-ocr-data-eng poppler-utils su-exec && \
    # giflib's CVE-2026-26740 (HIGH, #336): the fixed 5.2.2-r2 build hasn't
    # been backported to the v3.24 stable repo as of 2026-08-29 — only
    # edge/main has it — so the `apk upgrade` above can't clear it no matter
    # how often this image is rebuilt. giflib itself isn't installed
    # directly; leptonica (tesseract-ocr's dependency) links libgif.so.7, and
    # edge's build keeps that soname unchanged, so pulling just this one
    # package from edge is a safe drop-in. Re-check whether this is still
    # needed next time the base image is bumped.
    apk add --no-cache --repository=https://dl-cdn.alpinelinux.org/alpine/edge/main 'giflib=5.2.2-r2'

# The base image ships a full npm CLI under /usr/local/lib/node_modules/npm,
# bundled with npm's own vendored dependencies (tar, brace-expansion,
# ip-address, undici, etc. — at whatever versions happened to ship with
# whichever npm release "latest" resolves to at build time). Those are
# unrelated to this project's package-lock.json, so a CVE in them can't be
# fixed by any override here, and chasing npm's "latest" tag doesn't reliably
# clear them either — npm's own release still lags fixes for some of its
# vendored deps (#225). docker-entrypoint.sh calls the local prisma binary
# directly rather than going through npx, so nothing at runtime needs npm —
# strip it from the image outright rather than continuing to chase versions.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY docker-entrypoint.sh ./docker-entrypoint.sh

# `node` (uid/gid 1000) ships with the base image. The application code is
# owned by it but the app never writes there — only /app/data, the SQLite
# database and uploaded documents.
RUN chmod +x docker-entrypoint.sh && \
    mkdir -p /app/data && \
    chown -R node:node /app

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
