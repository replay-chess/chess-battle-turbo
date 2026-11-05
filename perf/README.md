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
