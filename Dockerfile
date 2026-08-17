# syntax=docker/dockerfile:1
# Mawahib NestJS API — multi-stage production image (Node 22 + Prisma).
# Secrets are never baked in; pass runtime env via Railway / docker run --env-file.

# -----------------------------------------------------------------------------
# Stage 1: install + build
# -----------------------------------------------------------------------------
# Node 22: @supabase/supabase-js requires native WebSocket (Node 22+).
FROM node:22-bookworm-slim AS builder

WORKDIR /app

RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY prisma ./prisma/

# Placeholder only for `prisma generate` (no network DB access at build time).
ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/mawahib_build?schema=public"

RUN npm ci

COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src/

RUN npx prisma generate \
  && npm run build

# -----------------------------------------------------------------------------
# Stage 2: production runtime
# -----------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
# Railway injects PORT; local default matches Nest env schema.
ENV PORT=3000

RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nestjs

COPY package.json package-lock.json ./
COPY prisma ./prisma/

# Production deps only (@prisma/client). Prisma CLI is copied from the builder
# so Railway Pre-Deploy `npx prisma migrate deploy` works without a start-hook.
RUN npm ci --omit=dev \
  && chown -R nestjs:nodejs /app

COPY --from=builder --chown=nestjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nestjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder --chown=nestjs:nodejs /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist

USER nestjs

# Document default; Railway maps the injected PORT automatically.
EXPOSE 3000

# Equivalent to `npm run start:prod` without requiring npm at runtime.
CMD ["node", "dist/main"]
