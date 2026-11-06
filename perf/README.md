# Perf Environment

Dedicated performance testing environment for Chess Battle Turbo.

## Phase results and `compare.ts` (phase-01 plan §12.8, §12.9; CT X18)

k6 runs only against the dev deployment (or a local build), never production. Every phase commits its k6 summaries as data:

- `perf/results/p<NN>-<scenario>-<sha>.json`: the summary of one run (`RESULT_FILE`, or `k6 run --summary-export=…`). Phase 1's scenario is `me` (`perf/k6/src/scenarios/me.ts`: `GET /api/me` p95 < 150 ms cold, 304 rate > 95 % with `If-None-Match`).
- `perf/compare.ts`: compares the newest result of the current phase with the newest of an earlier phase for the shared scenarios (`me`, `api-read-mix`, `ws-ramp`, `train-session`) and fails on a regression above 15 % in p95/p99 duration, failure rate, `ws_connecting` or iteration time. The first phase that runs a scenario has nothing to compare and passes.

```sh
cd perf/k6 && pnpm run build
# me.ts mints its own Clerk session tokens through the DEVELOPMENT instance's Backend API
CLERK_SECRET_KEY=sk_test_… ME_USER_EMAILS=<E2E user emails> \
  RESULT_FILE=../results/p01-me-$(git rev-parse --short HEAD).json k6 run dist/me.js
cd ../.. && pnpm exec tsx perf/compare.ts --phase 1          # or --current a.json --baseline b.json
```

The dev deployment answers bursts from scripts with the Vercel Security Checkpoint (403 `x-vercel-mitigated: challenge`). Set `VERCEL_AUTOMATION_BYPASS_SECRET` (Vercel → Deployment Protection → Protection Bypass for Automation) before a k6 run against it.

## Phase 2: socket protocol v2 (phase-02 plan §9.6, §12.8)

`perf/k6/src/lib/protocol-v2.ts` speaks protocol v2 (engine.io 4 + socket.io with `auth: {token, proto: 2}` in the CONNECT packet, acked commands `42<id>[…]` → `43<id>[ack]`) over `k6/websockets`, which needs a k6 build that ships `k6/websockets` (tested with `grafana/k6:latest` = v2.3.0; v1.2.3 and older only have `k6/experimental/websockets`). Each game is a fixture game (`G-THREEFOLD`: initial position, 5+0, no study) between two seats of one VU; White's socket keeps the board, the side to move plays a random legal move every `moveEveryMs` and resigns after `maxPlies`. `ws_move_duration` = `game:move` → ack.

Tokens are never minted inside k6. `perf/k6/setup/v2-manifest.ts` creates the games through the app's writers and mints one token per seat with the target server's `SOCKET_TOKEN_SECRET`; tokens live 15 minutes, so mint right before the run. The manifest (`setup/v2-manifest.json`, mode 600) is gitignored and never printed.

```sh
cd apps/web && set -a && . ./.env.test && set +a && cd ../../perf/k6 && node esbuild.config.mjs
npx tsx setup/v2-manifest.ts --games 25 --ws ws://host.docker.internal:3002 --env test --out setup/v2-manifest.json
docker run --rm --add-host=host.docker.internal:host-gateway -v "$PWD":/k6 -v "$PWD/../results":/results -w /k6/dist \
  grafana/k6:latest run ws-ramp.js -e SMOKE=1 -e MANIFEST=../setup/v2-manifest.json \
  --summary-export /results/p02-ws-smoke-local-$(git rev-parse --short HEAD).json
```

| Scenario | Where | Load | Gates (client) | Server gates (read from `/internal/metrics` and Sentry) |
|---|---|---|---|---|
| `ws-ramp.js -e SMOKE=1` | local socket (:3002, `APP_ENV=test`) | 25 games = 50 sockets, joins spread over 7.5 s, 1 move/s, 12 plies | connections > 99 %, completion > 95 %, move RTT p95 < 100 ms | — |
| `ws-ramp.js` | dev OCI box from a GitHub runner, once per phase, after the Neon split (owner, stage B) | 250 → 2,000 sockets (125 → 1,000 games), 1 move / 5 s per game, 15 min | connections > 99 % and move RTT p95 < 250 ms (`abortOnFail`) | `ws.move_latency_ms` p95 < 5 ms, `ws.loop_lag_ms` p99 < 20 ms, RSS < 1 GB, 0 `ws.persist.fail`, ≤ 1 checkpoint per 10 plies per game |
| `ws-games.js` | any | `GAMES` games, 1 move / `MOVE_EVERY_MS` | move RTT p95 < `RTT_MS` + 50 ms | — |

For the dev-box run, mint the manifest with `--env dev --ws wss://ws-dev.80-225-200-210.sslip.io` and the dev socket's `SOCKET_TOKEN_SECRET` (owner), record Vercel usage and Neon CU-h before and after through their usage APIs, and commit the summary as `perf/results/p02-ws-ramp-<sha>.json`.

**Results**

| Date | Run | Result |
|---|---|---|
| 2026-11-06 | `p02-ws-smoke-local-a8798c9.json`: local smoke, uncommitted P2 tree on a8798c9, socket on this machine against the Neon dev branch (`connection_limit=3`) | 50/50 sockets, 25/25 games, 300 moves; move RTT avg 2.4 ms, p95 5 ms, max 8 ms; connect p95 6 ms. **Pass.** |
| 2026-11-06 | same, all 25 games joining at once (no stagger) | 7/25 joins failed `internal`: the socket's game load exceeded its 8 s budget with 50 first joins queued on a 3-connection pool to Neon (WP-D follow-up: coalesce or widen the pool before the dev-box ramp; a deploy restore is the same burst). |

## Infrastructure (legacy perf environment)

| Component | URL / Address |
|-----------|---------------|
| **Web App** | https://chess-battle-perf.vercel.app |
| **WebSocket** | wss://ws-perf.playchess.tech |
| **EC2** | 3.94.8.101 (t3.medium, Ubuntu 24.04) |
| **Neon DB** | chess_battle_perf (project: royal-math-49660639) |

## Scripts

| Script | Description |
|--------|-------------|
| `setup-ec2.sh` | Full EC2 setup from scratch (Node, pnpm, Nginx, SSL, systemd) |
| `deploy-ec2.sh` | Pull latest code, rebuild, restart WS service |
| `seed-perf-db.sh` | Run migrations + seed reference data from prod |
| `cleanup-perf-db.sh` | Reset transient data between test runs |
| `status.sh` | Check health of all perf components |
| `ssh-ec2.sh` | Quick SSH into EC2 |
| `logs-ec2.sh` | Tail WS server logs (pass line count as arg) |

## Quick Start

```bash
cd perf

# 1. Copy and fill in environment
cp .env.example .env

# 2. First-time setup (skip if already done)
bash setup-ec2.sh       # EC2 + Nginx + SSL
bash seed-perf-db.sh    # DB migrations + reference data

# 3. Check everything is healthy
bash status.sh

# 4. After code changes
bash deploy-ec2.sh

# 5. Between test runs
bash cleanup-perf-db.sh

# 6. Debugging
bash logs-ec2.sh 100
bash ssh-ec2.sh
```

## Vercel Perf App

Deployed as a separate Vercel project pointing to the perf DB and WS server.
Environment variables set in Vercel dashboard:

- `DATABASE_URL` -> perf Neon pooler URL
- `DIRECT_URL` -> perf Neon direct URL
- `NEXT_PUBLIC_WEBSOCKET_URL` -> `wss://ws-perf.playchess.tech`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` -> same dev Clerk instance
- `CLERK_SECRET_KEY` -> same dev Clerk instance
