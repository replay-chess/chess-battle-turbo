# analysis-worker

The Replay Chess analysis worker (phase-03 plan §8.12, work package C). One Node process that claims `jobs` rows,
grades finished games with native Stockfish 18 at the frozen engine profile `sf18-v1`, and writes the results to Neon
over HTTP. On dev it runs as a compose service on the OCI dev VM next to the socket server, inside a `cpu.idle`
cgroup slice (P3-D8). It never runs on prod in phase 3.

## Layout

| Path | What |
|---|---|
| `src/main.ts` | Process entry: env guards, boot, SIGTERM/SIGINT |
| `src/boot.ts` | Wiring: eval cache (+ first-boot seed) → engine → HTTP :3003 → boot batch (reap + DAILY_PLAN) → drain loop |
| `src/config/env.ts`, `faults.ts` | The environment (§7.9) and the boot guards; the `WORKER_FAULT` / kick `fault` grammar |
| `src/db/client.ts` | `neon()` over HTTP (Neon) or `pg` (CI, local Docker); one immediate retry of a transient failure |
| `src/queue/claim.ts` | The claim (`priority DESC, "fairSeq", "runAt"`, `FOR UPDATE SKIP LOCKED`, payload `v` ≤ `PAYLOAD_V_MAX`) |
| `src/queue/outcome.ts` | Done, fail (back-off 30 s / 2 min / 10 min), release (SIGTERM), heartbeat, the lock guard, the reaper statement |
| `src/queue/reaper.ts`, `heartbeat.ts` | Reaped jobs → `analysis:failed {worker_stalled}`; the 30 s heartbeat that returns the job's priority |
| `src/scheduler/scheduler.ts` | Drain → sleep until `min(nextRunAt)` (cap 24 h) or a kick; zero queries while idle |
| `src/scheduler/recurring/`, `daily-plan.ts` | The HOUSEKEEPING slices and DAILY_PLAN (P3-D22): one file per slice, listed in `recurring/index.ts` |
| `src/jobs/` | The handler contract (+ `onFailed` hook), the runner (payload version, heartbeat, failure outcome), HOUSEKEEPING (one batch: plan + slice statements + DONE), LEGEND_COMPARE; `index.ts` lists the handlers |
| `src/pipeline/analyze-game.ts` | ANALYZE_GAME (§8.12): load → guards/SKIPPED → resume or regrade → pass 1 (cache → engine, checkpoint every 10 plies) → pass 2 (≤ 6 positions, ≤ 60 s) → grade + texts (CA) → final batch → banded events → telemetry; the test faults |
| `src/pipeline/sql-store.ts`, `store.ts`, `types.ts` | Every pipeline statement: load (1), checkpoint (1 batch), final batch (≤ 10 statements), skip, LEGEND_COMPARE, `analysis:batch` counts |
| `src/pipeline/positions.ts`, `search.ts` | Per-position search plan (history since the last irreversible move, terminal evals, cache inputs); cache → lag pause → engine |
| `src/pipeline/progress.ts`, `batch-events.ts` | `analysis:progress` frames (2 plies / 300 ms, ≤ 8 plies, spliceable from the last checkpoint); `analysis:batch` per member per 60 s |
| `src/pipeline/legend.ts`, `openings.ts` | Legend facts (the web's historical-name rule) and divergence positions; the book set + opening names (one statement per process) |
| `src/pipeline/final-batch/` | The P5 extension point: statements that ride in the final batch (P3 ships none) |
| `src/obs/posthog.ts`, `telemetry.ts` | PostHog server events (registry-validated, PII-guarded, batched 5 s); Sentry transactions/spans/metrics and the cron monitor |
| `src/smoke.ts`, `scripts/smoke.ts` | The post-deploy real-engine smoke (§12.8), `dist/smoke.cjs` in the image |
| `src/http/server.ts` | `POST /internal/analysis/kick` and `GET /internal/metrics` (HMAC only), `GET /health`, `GET /ready` |
| `src/engine/` | The UCI driver, the 1-process pool (restart + retry once, nice 19, `engine_crash` fault), `FakeEngine` (ENGINE=fake) |
| `src/cache/` | Eval cache: E1 LRU (200k) → E2 SQLite; exact `(engine, nodes, multipv)` match, seed rows at ply < 20, bypass rules |
| `src/socket/` | Signed `/internal/emit` client (member rooms only), the `/internal/load` probe and the lag pause |
| `scripts/bench.ts` | Task C1: `stockfish bench` + a cold 60-ply sample at the sf18-v1 budget |
| `scripts/seed-evalcache.ts` | Builds `evalcache-seed-v1.sqlite` from `lichess_db_eval.jsonl.zst` (owner's laptop) |
| `scripts/upload-evalcache-seed.ts` | Uploads the seed file to R2 (owner-run) |
| `Dockerfile`, `NOTICE` | The arm64 image with Stockfish 18 built from `sf_18` (`armv8-dotprod`, PGO); third-party notices |

## Running it locally

The worker reads only the environment it is given (no dotenv). Use the gitignored `.env.local-dev` (APP_ENV=dev,
role `replay_worker` on the Neon `dev` branch, `WS_INTERNAL_URL=http://localhost:3002`, telemetry blank) and a
native Stockfish 18:

```sh
cd apps/analysis-worker
set -a; source .env.local-dev; set +a
pnpm dev                # tsx src/main.ts on :3003
```

Then the smoke against it (resets the seeded `smoke-26` game, enqueues it at USER_OPENED, kicks, polls to DONE):

```sh
set -a; source .env.local-dev; set +a
pnpm exec tsx scripts/smoke.ts
```

`ENGINE=fake` is accepted only with `APP_ENV=test` (CI's e2e worker, from source against Docker Postgres).
`WORKER_FAULT` only with `APP_ENV` dev or test. Every worker that runs at the same time needs its own `WORKER_ID`:
the reaper treats `<WORKER_ID>-<8-char boot id>` rows of an earlier boot as orphans once their heartbeat is 45 s old
(`ORPHAN_STALE_SEC`). Without `WORKER_ID` a worker is `<APP_ENV>-<host>`, so a laptop and the dev VM
(`WORKER_ID=dev-worker`) never collide by accident; if two live workers do share an id, neither reaps the other's
beating jobs and the later one logs "another live worker shares WORKER_ID …" (Sentry).

## Fault injection (dev and test only)

One grammar (`src/config/faults.ts`, `KickFault` in `@repo/contracts/internal/kick`) for two hooks:

| Fault | Effect |
|---|---|
| `fail_at_ply:<n>` | the ANALYZE_GAME run fails (retryable) when it reaches ply n: back-off, `analysis:failed {retryable: true}` |
| `stall_at_ply:<n>` | the run stops heart-beating at ply n: the A2 stall rule (90 s) shows `failed`, the reaper takes it at 3 min |
| `engine_crash:<n>` | the engine process is killed before each of the next n searches: the pool restarts it and retries once |
| `hold_queue` | the worker claims nothing (the review shows `queued` with real data) until a `test` kick without it |
| `pause_at:<phase>:<ms>` | the run waits ms when it enters the phase (`writing`, …) |

- **Env hook** `WORKER_FAULT=<fault>`: every run of this process, `APP_ENV` dev or test only; the worker refuses to
  boot with it anywhere else (`config/env.ts`).
- **Kick hook**: a signed kick body `{v:1, reason:"test", watch:"<gameRef>", fault:"<fault>"}` applies the fault once
  to that game, `APP_ENV=test` only (CI's e2e worker; the e2e specs tagged `@worker-faults`). On the Neon dev branch
  the worker is `APP_ENV=dev` and ignores kick faults; use the env hook there.

Locally: `WORKER_FAULT=stall_at_ply:20 pnpm dev` (with `.env.local-dev`), finish a game, watch the review.

A real process crash (owner test T11) needs no hook: on the dev box,
`docker compose exec analysis-worker sh -c 'kill -9 -1'` kills node (the service runs with `init: true`, so tini is
PID 1 and node its child; `kill -9 1` would hit the init, which the kernel protects). tini exits 137, the restart policy
starts a new container, and its boot reaps the orphaned job (`worker_stalled`, retryable). `docker kill` is a manual
stop and does not restart it (plan R14).

## Tests

```sh
pnpm --filter analysis-worker test          # unit (the *.int.test.ts files skip without TEST_DATABASE_URL)
TEST_DATABASE_URL=postgresql://…@localhost:…/replay \
TEST_WORKER_DATABASE_URL=postgresql://replay_worker:…@localhost:…/replay \
pnpm --filter analysis-worker test:int      # claim / reaper / outcome / plan / boot / pipeline SQL / slices / smoke /
                                            # telemetry (PostHog + Sentry sink) against a migrated Postgres
```

Each integration file gets private copies of `jobs`, `game_analyses`, `shares` and the two limiter tables
(`src/testing/pg.ts`), so the claim, the reaper, the prunes and the regrade sweep never touch another suite's rows.

## Deploy (dev box only; task C7)

`.github/workflows/deploy-oci.yml` builds `ghcr.io/<owner>/replay-chess-analysis-worker:<sha>` on pushes to `dev`
only (Blacksmith arm runner) and writes `COMPOSE_PROFILES=worker`, `WORKER_IMAGE` and `.env.worker` (secret
`WORKER_DEV_ENV_FILE`) into the dev bundle; the prod bundle gets none of them, so `main` never starts a worker.
`deploy/oci/docker-compose.yml` runs it in profile `worker` with `cgroup_parent: worker-idle.slice` (created by
`deploy/oci/setup-server.sh --worker-slice`), `cpus: "0.75"`, 1 GB, the `worker_evalcache` volume, the `/ready`
healthcheck and `stop_grace_period: 30s`. Caddy answers 401 to unsigned `/internal/analysis/*` and `/internal/metrics`
and proxies the signed ones to `analysis-worker:3003`, only where the stack runs the `worker` profile (one Caddyfile
for both boxes; elsewhere both paths answer 404: `deploy/oci/check-caddy-routes.sh`, run in CI). The image must stay
private (`NOTICE`): the workflow fails the deploy unless GHCR reports the package private. After `up -d` the workflow waits for the healthcheck (≤ 120 s),
checks `cpu.idle = 1`, then runs `docker compose exec -T analysis-worker node dist/smoke.cjs`.

The integration tests refuse any non-local host. With `TEST_WORKER_DATABASE_URL` (role `replay_worker` from
`packages/db/scripts/roles/replay_worker.sql`) every worker statement runs as the worker's role, which proves its grants.

## Engine profile `sf18-v1` and the C1 bench

The profile lives in `@repo/chess-analysis/version` (pass 1 = 120k nodes MultiPV 2 on every position; pass 2 = 1M
nodes MultiPV 3 on ≤ 6 positions, stopped at 60 s; Threads 1, Hash 64). The worker refuses an `ENGINE_PROFILE`,
`ENGINE_THREADS` or `ENGINE_HASH_MB` that differs from it.

**Status: frozen provisionally at 120k (stage A).** The acceptance gate (§8.13: ≥ 60 games/hour on the dev VM at
0.75 core with the socket's loop-lag p99 < 50 ms) runs on the dev VM in stage B:

```sh
docker compose exec analysis-worker node dist/bench.cjs --compare 80000 --out /tmp/bench.json
```

If it fails, pass 1 drops to 80k before any golden is recorded (GRADING_VERSION stays 1).

Local numbers (cold cache, one 60-ply game, wall clock):

| Where | `stockfish bench` nps | Pass 1 (61 × 120k) | Pass 2 (6 × 1M) | Total | Games/hour | Pass 1 at 80k → games/hour |
|---|---|---|---|---|---|---|
| Apple M4 Max, native (`ARCH=apple-silicon`, clang), 1 thread | 1,864,373 | 4.26 s, depth p50 15 | 3.15 s | 7.40 s | 486 | 581 |
| This image on the M4 (Docker linux/arm64, `--cpus 0.75`, `armv8-dotprod` gcc PGO) | 1,064,250 | 8.13 s, depth p50 15 | 5.59 s | 13.72 s | 262 | 357 |
| Dev VM (Ampere A1, 0.75 core, this image) | pending (stage B) | | | | | |

Measured 2026-11-11 (`scripts/bench.ts`, cold cache, sample = lichess.org/0E2JOKCO plies 1–60). The M4 rows are an
upper bound: an Ampere A1 core is slower per thread, so the dev VM should land between the plan's estimate (16–27 s
per game → 130–220 games/hour) and this image's 262; the 60 games/hour gate keeps a wide margin either way. The raw
JSON is kept with the phase-3 build logs (`wpc-bench-native-mac.json`, `wpc-bench-docker-075.json`).

The image builds in 102 s on the M4 with a warm base-image cache (the Stockfish profile-build step is 42 s of it on
14 cores); a 2-vCPU arm64 runner should stay well under the 10-minute acceptance limit (measured in stage B by
`deploy-oci.yml`). The image is 1.09 GB uncompressed: Stockfish with its embedded nets is 108 MB, and most of the
337 MB of production `node_modules` is Prisma (`@repo/db`'s enqueue builders use `Prisma.sql`).

### Determinism

Every engine search starts with `ucinewgame` + `isready` (`src/pipeline/search.ts`), not one per game: with a warm
hash a resumed run graded 14–24 % of the plies differently from an uninterrupted one (`CA/README.md` "Eval cache and
label stability"). Cost on the M4 (native, 3 games / 293 plies, cache off): 30.5 s → 31.7 s (+4 %). The Pass 1 column
above predates the change; the dev-VM bench in stage B measures the profile with it.

## Imports: rules settled in the Phase 4 fix round (FIX-1)

The register is `docs/decisions.md` ("Readings settled in the Phase 4 fix round"); the worker follows these:

- **Lichess paging (FX-1).** A non-initial read whose 1,000-game stream comes back full pages on in the same run with
  `until = oldest createdAt − 1` (same `since`), up to IMPORT_MAX_GAMES for the run: nothing between two syncs is lost,
  and past the run's newest 2,000 the "newest N" rule of a first import applies (`src/import/reading.ts`).
- **Lichess correspondence (FX-2).** Every non-initial read ends with one `perfType=correspondence` stream over the
  import window, so a game still running at a sync is imported once it finishes (the known-game filter drops the rest).
- **Purge of a shared game (FX-3).** `import_purge_batch()` (migration `20261113000100_m4p_purge_survivors`) keeps the
  opponent's surviving game with its queued analysis (the job moves to them) and deletes the departing member's share
  links and legend comparisons of it.
- **Parked imports (FIX-1).** The boot batch (unless IMPORT_PAUSED) and the daily HOUSEKEEPING sweep release runs parked
  WAITING_FOR_MEMBERSHIP for users who are members now (`releaseParkedImportsStatement`, the web fan-out's backstop).
- **First review telemetry (FX-6).** The analysis of an INITIAL run's newest game records `import.review_ready_ms`
  (commit − run `startedAt`) and the PostHog event `review_ready_after_import` (`src/pipeline/final-batch/p04-import.ts`).
- **Tests never call the providers.** With APP_ENV=test an unset CHESSCOM_API_BASE / LICHESS_BASE_URL is a closed
  loopback port; the P3 full-worker int tests boot with IMPORT_PAUSED=on; `ImportWorld.close()` turns its accounts'
  auto-import off. Sentry events, spans and breadcrumbs drop provider usernames (`workerSentryRedaction`).

## Runbook (dev box: `ssh -i ~/.ssh/oci_deploy deploy@<dev ip>`, then `cd /opt/replay-chess`)

Read-only checks first. The SQL below runs as the branch owner on the Neon **dev** branch (`DIRECT_URL` of
withered-cake-82837167 / dev), never on production and never the old project. Every write asks the owner first
(CLAUDE.md rule 5).

**Where things stand**

```sh
docker compose ps analysis-worker                      # healthy? (the /ready healthcheck)
docker compose logs --since 30m analysis-worker        # one JSON line per event: claim, job done/failed, reap
docker compose exec -T analysis-worker node -e "fetch('http://127.0.0.1:3003/ready').then(r=>r.text()).then(console.log)"
```

```sql
-- The queue by kind and status, and what is due now.
SELECT kind, status, count(*), min("runAt") AS next_run FROM jobs GROUP BY 1, 2 ORDER BY 1, 2;
-- RUNNING rows: who holds them and how old the heartbeat is.
SELECT id, kind, "lockedBy", attempts, now() AT TIME ZONE 'UTC' - "heartbeatAt" AS beat_age FROM jobs WHERE status = 'RUNNING';
-- The last failures (lastError is "<code>: <message>", never PII).
SELECT id, kind, status, attempts, "lastError", "finishedAt" FROM jobs WHERE "lastError" IS NOT NULL ORDER BY id DESC LIMIT 20;
```

**A stuck queue** (QUEUED rows due for minutes, nothing RUNNING)

1. The worker sleeps until a kick or its next `runAt`. A lost kick is healed by A1/A2 (a review that is opened kicks
   again after 30 s) and by the daily cron backstop. Kick it by hand with the signed ops path: `docker compose exec -T
   analysis-worker node dist/smoke.cjs` enqueues and kicks the smoke game, which drains the whole queue behind it.
2. Still nothing: `hold_queue` left on? Check the container env for `WORKER_FAULT` (dev only) and restart without it.
3. Rows due but never claimed: a payload `v` above this build's `PAYLOAD_V_MAX` waits for a newer image by design
   (FEA §9). `SELECT id, kind, payload->>'v' FROM jobs WHERE status = 'QUEUED' AND "runAt" <= now() AT TIME ZONE 'UTC';`
4. RUNNING rows with an old heartbeat: the reaper takes them at the next drain (boot, or the end of any drain). A
   restart (`docker compose restart analysis-worker`) reaps an earlier boot's rows at boot once their heartbeat is 45 s
   old, and the members get `analysis:failed {worker_stalled, retryable}`.

**An engine crash loop** (`engine_failed` in the logs, analyses failing at the same ply)

1. `docker compose logs analysis-worker | grep -i engine`: a crash restarts the process and retries the search once;
   two in a row fail the job (`engine_failed`, retryable with back-off, FAILED after 4 attempts).
2. Check the binary and the profile: `docker compose exec -T analysis-worker /usr/local/bin/stockfish bench 16 1 6`
   must finish; the worker refuses to boot with an `ENGINE_*` value that differs from `sf18-v1`.
3. Memory: the container has 1 GB (`mem_limit`); `docker stats analysis-worker`. An OOM kill shows as exit 137.
4. One position kills it every time: find the game (`lastError` + the `gameId` of the failing job) and keep the FEN for
   a Stockfish report; the game stays FAILED with **Retry Analysis** for its members. If it must stop retrying,
   set that job FAILED (owner confirmation): `UPDATE jobs SET status = 'FAILED', "finishedAt" = now() AT TIME ZONE
   'UTC' WHERE id = <id> AND status = 'QUEUED';`
5. Roll the image back (below) if a new build started it.

**Reseeding the eval cache** (a corrupt `evals.sqlite`, a new seed file, or a profile change)

1. The cache is a speed-up only: deleting it never changes a grade (every search starts from `ucinewgame`).
2. `docker compose stop analysis-worker` (SIGTERM releases the running job without counting the attempt).
3. `docker run --rm -v replay-chess_worker_evalcache:/data alpine rm -f /data/evals.sqlite /data/evals.sqlite-wal
   /data/evals.sqlite-shm` (the compose volume `worker_evalcache`; check the name with `docker volume ls`).
4. A new seed: build and upload it (below), set `EVAL_CACHE_SEED_URL` in `WORKER_DEV_ENV_FILE`, redeploy.
5. `docker compose up -d analysis-worker`: the first boot downloads and merges the seed (`EVAL_CACHE_SEED_URL`) when
   the cache has none; the boot log says how many rows it merged.

**Rollback** (plan §14.3, FEA §9)

| What | How to undo | Notes |
|---|---|---|
| Review UI and archive | Turn `review-v3` off (PostHog dev): `reviewHref()` points at `/analysis` again (until H4) | After H4, revert the deletion commit on `dev`. Vercel Hobby rolls back only to the previous deployment |
| Worker image | Set `WORKER_IMAGE` in the dev bundle to the previous tag (`ghcr.io/replay-chess/replay-chess-analysis-worker:<sha>`) and re-run the deploy | An older worker claims only the kinds and payload versions it knows (`kind::text = ANY`, `payload.v ≤ PAYLOAD_V_MAX`): newer jobs wait, nothing crashes; every enum value in use shipped in M3 |
| Schema M3 | Nothing to undo (expand-only); stop writing | Old code ignores the new columns |
| Grading constants | Bump `GRADING_VERSION` with the previous constants (`CA/README.md` "Version bump procedure"): the regrade sweep re-grades from the stored arrays, engine-free | Every analysis carries `version` |
| Shares | Turn `review-share` off: no new links. A link already out is revoked from its share page (A11 DELETE purges the page and the image at once) | A bulk revoke script (`--all-review`) is not built in P3; a manual bulk `revokedAt` update needs the owner's confirmation and stays cached up to 1 h (ISR) |
| Legacy `/analysis` | H3 is reversible: `analysis-redirect` off. H4 (deleting the legacy code) is the only irreversible step and waits ≥ 1 dev release and ≥ 3 days | P3-D30 |
| Stop the worker | `docker compose stop analysis-worker`, or remove `COMPOSE_PROFILES=worker` from the dev bundle and redeploy | Games then stay QUEUED; reviews show "Waiting for the engine" and the archive keeps working |

## Eval cache seed

```sh
# owner's laptop, once: build from the Lichess CC0 eval dump (EPDs on the openings lines, knodes ≥ 120)
pnpm --filter analysis-worker seed:evalcache --input ~/Downloads/lichess_db_eval.jsonl.zst --out evalcache-seed-v1.sqlite
# upload to R2 (dry run without --yes)
R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… R2_BUCKET=replay-chess-media \
  pnpm --filter analysis-worker upload:evalcache --file evalcache-seed-v1.sqlite --yes
```

Then set `EVAL_CACHE_SEED_URL` in the worker env; the worker downloads and merges it at its next boot when the cache
has no seed yet.
