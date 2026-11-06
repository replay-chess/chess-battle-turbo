# Build context: the repo root (deploy-oci.yml `context: .`), so the workspace packages the socket depends on
# (@repo/db, @repo/game-core, @repo/contracts) are part of the image (phase-02 plan 6.9, 7.11).

# Stage 1: Dependencies
FROM node:22-alpine AS deps
# openssl: Prisma detects linux-musl-arm64-openssl-3.0.x from it (risk R-01)
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# Copy workspace files
COPY pnpm-workspace.yaml ./
COPY package.json pnpm-lock.yaml ./
COPY apps/web-socket/package.json ./apps/web-socket/
COPY packages/typescript-config ./packages/typescript-config
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/db/package.json ./packages/db/
COPY packages/game-core/package.json ./packages/game-core/
COPY packages/chess-fixtures/package.json ./packages/chess-fixtures/

# Install the socket server and its workspace dependencies only
RUN pnpm install --frozen-lockfile --filter "web-socket..."

# Stage 2: Builder
FROM node:22-alpine AS builder
RUN apk add --no-cache openssl
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web-socket/node_modules ./apps/web-socket/node_modules
COPY --from=deps /app/packages ./packages

# Copy source code (the packages' sources over their installed node_modules)
COPY packages/contracts ./packages/contracts
COPY packages/db ./packages/db
COPY packages/game-core ./packages/game-core
COPY packages/chess-fixtures ./packages/chess-fixtures
COPY apps/web-socket ./apps/web-socket
COPY pnpm-workspace.yaml package.json ./

# Generate the Prisma client for this platform ("native" = linux-musl-arm64-openssl-3.0.x on the A1 box)
RUN pnpm --filter @repo/db generate

# Set working directory to websocket app
WORKDIR /app/apps/web-socket

# Bundle with esbuild (scripts/build.mjs): dist/index.cjs (the server; @repo/* bundled, npm deps external, the
# generated Prisma client required from ../../../packages/db/generated/prisma) and dist/cli/internal.js (the ops
# signing CLI the deploy workflow runs with `docker compose exec`).
RUN pnpm build

# Stage 3: Runner
FROM node:22-alpine AS runner
RUN apk add --no-cache openssl
WORKDIR /app

ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nodejs

# Copy root node_modules (for hoisted dependencies in monorepo)
COPY --from=deps /app/node_modules ./node_modules

# Copy app-specific node_modules
COPY --from=deps /app/apps/web-socket/node_modules ./apps/web-socket/node_modules

# Workspace packages with their node_modules and the generated Prisma client + query engine
# (packages/db/generated/prisma)
COPY --from=builder /app/packages ./packages

# Copy the bundles and package.json ("type": "module": dist/cli/internal.js is ESM, dist/index.cjs CommonJS)
COPY --from=builder /app/apps/web-socket/dist ./apps/web-socket/dist
COPY --from=builder /app/apps/web-socket/package.json ./apps/web-socket/package.json

# The game journal (phase-02 plan 7.6): the compose volume ws_journal mounts here. A fresh named volume copies this
# directory's owner, so the non-root user can write it.
RUN mkdir -p /data/journal && chown -R nodejs:nodejs /data/journal
ENV JOURNAL_DIR=/data/journal

# Set working directory to websocket app
WORKDIR /app/apps/web-socket

# Switch to non-root user
USER nodejs

EXPOSE 3002

ENV PORT=3002

# SIGTERM → drain (≤ 20 s; compose stop_grace_period 30 s). Node is PID 1 and handles the signal itself.
CMD ["node", "dist/index.cjs"]
