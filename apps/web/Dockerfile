# syntax=docker/dockerfile:1
# Stage 1: Dependencies
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# Copy workspace files
COPY pnpm-workspace.yaml ./
COPY package.json pnpm-lock.yaml ./
COPY apps/web/package.json ./apps/web/
COPY packages/typescript-config ./packages/typescript-config
COPY packages/eslint-config ./packages/eslint-config
COPY packages/ui ./packages/ui

# Install dependencies
RUN pnpm install --frozen-lockfile

# Stage 2: Builder
FROM node:22-alpine AS builder
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/packages ./packages

# Copy source code
COPY . .

# Set working directory to web app
WORKDIR /app/apps/web

# Install OpenSSL for Prisma
RUN apk add --no-cache openssl

# Generate Prisma Client
# Prisma will auto-detect the correct binary for Alpine Linux (linux-musl)
RUN npx prisma generate

# Standalone output is what the runner stage copies
ENV USE_STANDALONE=true
ENV NODE_ENV=production

# The build reads the full production env (NEXT_PUBLIC_* values are inlined,
# pages that query the DB are prerendered) from a BuildKit secret, so no
# secret ends up in an image layer:
#   docker build --secret id=buildenv,src=.env ...
RUN --mount=type=secret,id=buildenv,required=true \
    set -a && . /run/secrets/buildenv && set +a && pnpm build

# Stage 3: Runner
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy necessary files
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public
COPY --from=builder /app/apps/web/app/generated ./apps/web/app/generated
# Blog posts are read from disk at request time (lib/blog.ts)
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/content ./apps/web/content

# Switch to non-root user
USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Start the application
CMD ["node", "apps/web/server.js"]

