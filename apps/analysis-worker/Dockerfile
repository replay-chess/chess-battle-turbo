# The analysis worker image (phase-03 plan §7.8, task C1). Build context: the repo root, like the socket image
# (deploy-oci.yml `context: .`), so the workspace packages the worker bundles are in the context.
#
#   docker build -f apps/analysis-worker/Dockerfile -t replay-chess-analysis-worker .
#
# arm64 only: the OCI Ampere A1 boxes. Stage 1 builds native Stockfish 18 from the pinned tag with profile-guided
# optimisation for ARMv8.2 + dot product (`make profile-build ARCH=armv8-dotprod COMP=gcc`); the NNUE nets are
# embedded in the binary. The binary is GPLv3: the image stays private (running it as a service is not distribution,
# P3-Q9) and NOTICE + /usr/local/share/doc/stockfish record the source tag, commit, net hashes and the licence text
# (LIC-3) in case the image is ever shared.

ARG NODE_IMAGE=node:24-bookworm-slim

# ── Stage 1: Stockfish 18 ──────────────────────────────────────────────────────────────────────────────────────
FROM debian:bookworm-slim AS stockfish
ARG SF_TAG=sf_18
ARG SF_COMMIT=cb3d4ee9b47d0c5aae855b12379378ea1439675c
ARG SF_ARCH=armv8-dotprod
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential git ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch "${SF_TAG}" https://github.com/official-stockfish/Stockfish.git /sf \
 && test "$(git -C /sf rev-parse HEAD)" = "${SF_COMMIT}"
WORKDIR /sf/src
# `profile-build` downloads the default nets (`make net`, sha256-checked by the Makefile), compiles with profiling,
# runs `bench`, and recompiles with the profile.
RUN make -j"$(nproc)" profile-build ARCH="${SF_ARCH}" COMP=gcc && strip stockfish
# Build record: tag, commit, arch, nets (name + sha256), binary sha256, and the build id the worker stores in
# game_analyses.engine ("sf18-armv8dp-<first 8 hex of the big net>").
RUN set -eu; \
    big="$(sed -n 's/^#define EvalFileDefaultNameBig "\(nn-[0-9a-f]*\.nnue\)"/\1/p' evaluate.h)"; \
    small="$(sed -n 's/^#define EvalFileDefaultNameSmall "\(nn-[0-9a-f]*\.nnue\)"/\1/p' evaluate.h)"; \
    test -n "$big" && test -n "$small"; \
    mkdir -p /out/doc; \
    cp stockfish /out/stockfish; \
    printf 'sf18-armv8dp-%s\n' "$(echo "$big" | cut -c4-11)" > /out/stockfish.build-id; \
    { echo "source: https://github.com/official-stockfish/Stockfish tag ${SF_TAG} commit ${SF_COMMIT}"; \
      echo "build: make profile-build ARCH=${SF_ARCH} COMP=gcc ($(gcc --version | head -1))"; \
      echo "net big: $big sha256 $(sha256sum "$big" | cut -d' ' -f1)"; \
      echo "net small: $small sha256 $(sha256sum "$small" | cut -d' ' -f1)"; \
      echo "binary sha256: $(sha256sum stockfish | cut -d' ' -f1)"; \
      echo "build id: $(cat /out/stockfish.build-id)"; } > /out/doc/BUILD_INFO; \
    cp ../Copying.txt ../AUTHORS /out/doc/; \
    /out/stockfish bench 16 1 13 > /dev/null 2>&1

# ── Stage 2: workspace dependencies (the worker and the packages it bundles) ───────────────────────────────────
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/analysis-worker/package.json ./apps/analysis-worker/
COPY packages/typescript-config ./packages/typescript-config
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/analytics/package.json ./packages/analytics/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/db/package.json ./packages/db/
COPY packages/chess-analysis/package.json ./packages/chess-analysis/
COPY packages/chess-fixtures/package.json ./packages/chess-fixtures/
# P4: the import library and the rules package it replays with (both bundled into dist/)
COPY packages/chess-import/package.json ./packages/chess-import/
COPY packages/game-core/package.json ./packages/game-core/
RUN pnpm install --frozen-lockfile --filter "analysis-worker..."

# ── Stage 2b: production dependencies for the runtime image ────────────────────────────────────────────────────
FROM deps AS prod-deps
RUN rm -rf node_modules apps/analysis-worker/node_modules packages/*/node_modules \
 && pnpm install --frozen-lockfile --prod --filter "analysis-worker..."

# ── Stage 3: bundle ─────────────────────────────────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS builder
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/analysis-worker/node_modules ./apps/analysis-worker/node_modules
COPY --from=deps /app/packages ./packages
COPY packages/analytics ./packages/analytics
COPY packages/contracts ./packages/contracts
COPY packages/db ./packages/db
COPY packages/chess-analysis ./packages/chess-analysis
COPY packages/chess-fixtures ./packages/chess-fixtures
COPY packages/chess-import ./packages/chess-import
COPY packages/game-core ./packages/game-core
COPY apps/analysis-worker ./apps/analysis-worker
COPY pnpm-workspace.yaml package.json ./
# @repo/db's enqueue builders use Prisma.sql from the generated client (no query engine is ever started).
RUN pnpm --filter @repo/db generate
WORKDIR /app/apps/analysis-worker
# dist/main.cjs (the worker) and dist/bench.cjs (the C1 bench); @repo/* bundled, npm dependencies external.
RUN pnpm build

# ── Stage 4: runtime ────────────────────────────────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS runner
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=stockfish /out/stockfish /out/stockfish.build-id /usr/local/bin/
COPY --from=stockfish /out/doc /usr/local/share/doc/stockfish
# Production npm dependencies only (the workspace packages are bundled into dist/), plus the generated Prisma client
# that dist/ requires at a relative path (packages/db/generated/prisma, resolving @prisma/client from packages/db).
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/analysis-worker/node_modules ./apps/analysis-worker/node_modules
COPY --from=prod-deps /app/packages ./packages
COPY --from=builder /app/packages/db/generated ./packages/db/generated
COPY --from=builder /app/apps/analysis-worker/dist ./apps/analysis-worker/dist
COPY apps/analysis-worker/package.json apps/analysis-worker/NOTICE apps/analysis-worker/README.md ./apps/analysis-worker/
# The eval cache volume (compose `worker_evalcache`); a fresh named volume copies this directory's owner.
RUN mkdir -p /data/evalcache && chown -R node:node /data/evalcache
WORKDIR /app/apps/analysis-worker
USER node
ENV ENGINE_PATH=/usr/local/bin/stockfish \
    EVAL_CACHE_PATH=/data/evalcache/evals.sqlite \
    PORT=3003
EXPOSE 3003
# SIGTERM → stop claiming, release the running job at its next checkpoint, exit (compose stop_grace_period 30 s).
CMD ["node", "dist/main.cjs"]
