# Pinned by digest, not just by tag: `node:26-alpine` is a moving target, so an
# unpinned build is not reproducible and silently picks up whatever the tag
# points at that day. This is the multi-arch index digest, so buildx still
# selects the right architecture.
#
# To update: docker buildx imagetools inspect node:26-alpine
FROM node:26-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# The runner ships Next's standalone output (.next/standalone), which already
# holds the traced subset of node_modules the server needs. The one thing it
# can't hold is the Prisma CLI that docker-entrypoint.sh runs for `prisma
# migrate deploy`, so that gets its own small install from docker/migrate —
# rather than copying the root project's whole production node_modules
# (~280 MiB compressed of build tooling, mobile packages and Next itself) into
# the image just to reach one binary (#518).
FROM base AS migrate-deps
WORKDIR /opt/migrate
COPY docker/migrate/package.json docker/migrate/package-lock.json ./
RUN npm ci --omit=dev

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build
# npm installs both the glibc and musl builds of sharp's and libsql's native
# binaries, and the trace copies glibc ones into the standalone output. They
# can never load on Alpine (musl), so drop them rather than ship ~12 MiB of
# dead weight. The musl builds are kept (libsql's via
# outputFileTracingIncludes in next.config.ts).
RUN rm -rf .next/standalone/node_modules/@img/sharp-linux-* \
    .next/standalone/node_modules/@img/sharp-libvips-linux-* \
    .next/standalone/node_modules/@libsql/linux-*-gnu

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
RUN apk upgrade --no-cache && \
    apk add --no-cache tesseract-ocr tesseract-ocr-data-eng poppler-utils su-exec && \
    # giflib's CVE-2026-26740 (HIGH, #336): the fixed 5.2.2-r2 build hasn't
    # been backported to the v3.24 stable repo as of 2026-08-29 — only
    # edge/main has it — so the `apk upgrade` above can't clear it no matter
    # how often this image is rebuilt. giflib itself isn't installed
    # directly; leptonica (tesseract-ocr's dependency) links libgif.so.7, and
    # edge's build keeps that soname unchanged, so pulling just this one
    # package from edge is a safe drop-in. Re-check whether this is still
    # needed next time the base image is bumped.
    apk add --no-cache --repository=https://dl-cdn.alpinelinux.org/alpine/edge/main 'giflib=5.2.2-r2' && \
    # Same situation for zlib's CVE-2026-4738 (CRITICAL) and musl's
    # CVE-2026-107891 (HIGH): as of 2026-11-06 the fixes (zlib 1.4-r0, musl
    # 1.2.6-r6) are only in edge/main, and v3.24 still ships 1.3.2-r1 and
    # 1.2.6-r3. Both keep their sonames (libz.so.1, libc.musl-*.so.1), and
    # musl is the same upstream release with the patch applied. Drop these
    # pins once v3.24 has the fixed builds.
    apk add --no-cache --repository=https://dl-cdn.alpinelinux.org/alpine/edge/main 'zlib=1.4-r0' 'musl=1.2.6-r6'

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

COPY --from=migrate-deps /opt/migrate/node_modules /opt/migrate/node_modules
COPY docker/migrate/prisma.config.ts /opt/migrate/prisma.config.ts

# Ownership is set as each file is copied. A `chown -R node:node /app` after the
# copies rewrote every file into a new layer just to change its owner, which
# doubled the size of the image (#518). The app never writes outside
# /app/data, but Next keeps a runtime cache under .next, so the app files stay
# owned by `node` (uid/gid 1000, shipped with the base image) as before.
COPY --chown=node:node --from=builder /app/prisma ./prisma
COPY --chown=node:node --from=builder /app/public ./public
COPY --chown=node:node --from=builder /app/.next/standalone ./
COPY --chown=node:node --from=builder /app/.next/static ./.next/static
COPY --chown=node:node --chmod=755 docker-entrypoint.sh ./docker-entrypoint.sh
RUN install -d -o node -g node /app/data

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
