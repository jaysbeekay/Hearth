# Pinned by digest, not just by tag: `node:26-alpine` is a moving target, so an
# unpinned build is not reproducible and silently picks up whatever the tag
# points at that day. This is the multi-arch index digest, so buildx still
# selects the right architecture.
#
# To update: docker buildx imagetools inspect node:26-alpine
FROM node:26-alpine@sha256:233761595746769ebfdb6090f44fc7cdf818ae0ce62d2b37e0367723b9823e36 AS base
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
# npx/npm write caches under $HOME — point it at the app user's own home so
# nothing tries to write to /root after privileges are dropped.
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
    apk add --no-cache tesseract-ocr tesseract-ocr-data-eng poppler-utils su-exec

# The base image's globally-installed npm (needed at runtime for `npx prisma
# migrate deploy` in docker-entrypoint.sh) vendors its own copies of tar,
# brace-expansion, etc. — periodically ahead of CVE fixes in whatever npm
# shipped with the base image. Upgrading npm itself pulls in patched
# vendored deps without touching anything in package-lock.json.
RUN npm install -g npm@latest

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
