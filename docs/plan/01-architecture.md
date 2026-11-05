# Replay Chess: target system architecture

Status: **final plan, revision 2**, 2026-11-02. Branch `dev` (HEAD `0848b76`, Phase 0 done). Scope: the whole coaching product in the **13-phase numbering** of `SP/plan/allocation.md` (P1–P13). Revision 1 used the 10 phases of `docs/implementation-plan.md`; the crosswalk is in §6.1.

**What revision 2 changed.** It applies every finding about this file in the five critiques (`SP/plan/critique-{coverage,consistency,feasibility,testing,api-perf}.md`). The disposition of each finding (applied, where, or rejected and why) is in Appendix C. The biggest changes:

1. **One canonical name per contract** (§0.3). Every plan, phase spec and work package uses the names there. Where the critiques disagreed with each other, §0.3 says which ruling wins and why. The final phase specs already written into `docs/plan/` (P2, P5, P7) agree with §0.3.
2. **Production worker on its own 2-OCPU VM** (P13 D7). Co-location with the socket server is a **dev-box** arrangement only. "Stage B" (resizing the prod box) is deleted, because the Always Free pool is full once the worker VM exists. A paid "Stage C" needs an owner decision (§1.8).
3. **No fixed hourly wake.** `HOURLY_TICK` is gone. A daily `HOUSEKEEPING` run ends with `DAILY_PLAN`, which writes the next 26 hours of timed job rows. The worker arms one timer for the earliest `runAt` it already knows, and an idle worker sends no query. Fixed Neon wakes drop from 24 a day to 1 (§1.10.3, §2).
4. **Every internal hop is HMAC-signed from P2** (`x-rc-kid`, `x-rc-ts`, `x-rc-sig`), with per-caller keys and per-caller event allow-lists, plus a Caddy pre-check that refuses unsigned requests before Node (§3.2.4).
5. **Dev and E2E move to their own Neon project in P1**, and production gets a nightly `pg_dump` to R2 from P1 (the P13 worker job replaces it later). Until then a busy dev week can suspend production's compute (§4.1).
6. **Cache rules cannot leak per-user data**: six named tiers, no `max-age > 0` on any per-user response, public routes read no session, and sign-out clears the browser HTTP cache (§1.6.6).
7. **The testing strategy is rewritten** around the plumbing that makes the phase tests run and gate: one runner, CI e2e on `dev` (nightly and after each dev deploy), the paywall on, leased personas, server-time control, telemetry sinks, a design-state coverage manifest and a test-hook registry (§5).

**Where this file sits in the plan set.**

| File | What it fixes |
|---|---|
| `docs/plan/01-architecture.md` (this file) | System shape: services, transport, jobs, security, privacy, telemetry, flags, environments, release, testing strategy, and the canonical names (§0.3) |
| `docs/plan/02-data-model.md` | The schema ledger by migration (M1–M13), indexes, JSON registry, growth, migrations, seeds, the old-prod copy |
| `docs/plan/03-api-design.md` | API conventions and the endpoint, socket, SSE, webhook and cron catalogue |
| `docs/plan/04-client-data-layer.md` | How the UI talks to the APIs: `api()`, query keys, TanStack Query, realtime, outbox, offline |
| `docs/plan/05-optimization.md` | SLOs and how each is measured, DB, caching, payloads, bundles, observability, backlog |
| `docs/plan/06-codebase-audit.md` | Today's code: findings by severity with `file:line`, keep/rework/remove, and the phase that fixes each finding |
| `docs/plan/07-design-coverage.md` | Every v3 board → phase → feature, the corrections from the coverage critique, and the 105 flow-map edges |
| `docs/plan/phase-NN-*.md` | The build spec of each phase. A phase spec is authoritative for its own migrations, routes and work packages; this file is authoritative for names that cross phases |

**Paths.** Relative to the repo root `/Users/rohitpandit/open_source/chess-battle-turbo` unless they start with `/`. Shorthands (one table for every plan file): `REPO` = repo root; `WEB` = `apps/web`; `WS` = `apps/web-socket`; `WK` = `apps/analysis-worker` (created in P3); `PKG` = `packages`; `CT` = `packages/contracts/src` (imported as `@repo/contracts/{http,socket,internal}/<file>`); `DB` = `packages/db`; `TRN` = `packages/chess-training`; `CA` = `packages/chess-analysis`; `CF` = `packages/chess-fixtures`; `DOM` = `packages/domain` (created by P9); `SP` = the planning session's scratchpad, archived scratch inputs that are not in the repo and may no longer exist (see [99-open-decisions.md](99-open-decisions.md) A12); `DR` = `SP/design-ref/project/v2` (boards `*.dc.html`, named by board, for example `V3ReviewAnalysing`); `DS` = `SP/design-ref/ds/project`.

Inputs: `docs/implementation-plan.md`, `CLAUDE.md`, the inventories (`SP/plan/inv-{pub,play-a,play-b,rct-a,rct-b,acct,sys,research}.md`), the audits (`SP/plan/audit-{api,db,client,socket,quality}.md`), the critiques, and the code. The API catalogue, the full Prisma schema and the per-screen contracts belong to the sibling plans; this document fixes the **system shape** they must fit.

Tags: **[V]** = a fact to verify before relying on it (vendor limits that change, unbenchmarked numbers; the open list is in §7.2). **[OD]** = an owner decision (§7).

---

## Contents

- [0. Decisions at a glance](#0-decisions-at-a-glance)
- [1. System](#1-system)
- [2. Background jobs and schedules](#2-background-jobs-and-schedules)
- [3. Cross-cutting concerns](#3-cross-cutting-concerns)
- [4. Environments and release process](#4-environments-and-release-process)
- [5. Testing strategy](#5-testing-strategy)
- [6. Build order (13-phase numbering)](#6-build-order-13-phase-numbering)
- [7. Owner decisions](#7-owner-decisions)
- [Appendix A. Environment variables per service](#appendix-a-environment-variables-per-service)
- [Appendix B. New and changed files](#appendix-b-new-and-changed-files)
- [Appendix C. Critique dispositions (revision 2)](#appendix-c-critique-dispositions-revision-2)

---

## 0. Decisions at a glance

### 0.1 The architecture in twelve lines

1. **Four runtimes.** Vercel runs the Next.js app (RSC pages, route handlers, edge middleware, one daily cron). OCI A1 runs Caddy and the Socket.io game server, plus a **new analysis worker** with native arm64 Stockfish. Neon Postgres is the only system of record. Cloudflare R2 holds media, puzzle shards, the browser engine, exports and encrypted backups.
2. **Per-move and per-second traffic never touches Vercel.** The socket server owns live games and writes checkpoints and the finish straight to Neon (B4, CR-17). The worker owns engine work, imports and scheduled jobs. Vercel serves pages, member APIs, the coach stream, billing and webhooks.
3. **Topology.** Production: the socket box (1 OCPU / 6 GB, 132.226.190.10) runs Caddy + socket; the worker gets **its own 2-OCPU / 12-GB VM** on the VCN (P13 D7). Dev: one 1-OCPU box (80.225.200.210) co-locates socket + Caddy + worker, with the worker in a `cpu.idle` cgroup slice, capped at 0.75 CPU, pausing on socket event-loop lag (§1.8). After D7 the Always Free A1 pool is full (4/4 OCPU), so any further capacity is a paid "Stage C" owner decision.
4. **The job queue is a Postgres table** claimed with `FOR UPDATE SKIP LOCKED` in a single-statement `UPDATE … RETURNING`, which works through Neon's PgBouncer pooler. The worker is **woken by signed HTTP kicks**, never by polling Neon (§1.10).
5. **Scheduler: the worker, with next-due job rows.** Vercel Hobby cron runs once a day, so it carries one backstop route (`/api/cron/daily`). Everything timed (trial reminder, release-hour pushes, reminders, weekly rolls, backups, housekeeping, tournament reminders) is a future-dated job row. A daily `HOUSEKEEPING` + `DAILY_PLAN` run writes the next 26 hours of rows; the worker arms one timer for the earliest `runAt` and sends no query while idle (CR-10, §2).
6. **The UI talks to the backend over five channels with fixed roles:** RSC loaders for first paint, JSON route handlers through one typed client and TanStack Query, Socket.io v2 for live games and per-user push, SSE (`fetch` streaming) for the coach, and immutable CDN files for catalogues, puzzle shards and the engine (§1.6). No screen polls while its socket is connected.
7. **The LLM never decides chess.** `claude-sonnet-5-5` answers coach questions on Vercel through a tool loop whose engine tools call the worker. `claude-haiku-5-5` writes review summaries and captions in the worker. A deterministic verifier checks every sentence before it is shown. Prompt caching is laid out tools → system → game facts → question, all on the 5-minute TTL until traffic justifies the 1-hour one (§1.11).
8. **Authorisation is decided by the database, accelerated by claims.** Middleware redirects pages from a Clerk session claim (zero DB reads). Every API route re-checks membership and resource ownership from the DB through one route wrapper. Socket commands are authorised from a signed handshake token, never from payload ids (§3.1).
9. **Every service-to-service call is signed** with HMAC over timestamp, method, path and body hash, with per-caller key ids and per-caller allow-lists, from P2 on; Caddy drops unsigned internal requests. Provider webhooks are signature-verified and deduplicated by event id. User socket tokens use their own secret (§3.2, CR-16).
10. **Privacy by construction.** No PII in telemetry. Account deletion anonymises shared games and deletes private rows in one transaction, then an outbox job cleans up Dodo, Clerk, R2 and PostHog. Backups are encrypted and kept at most 30 days, which is what the deletion copy promises (§3.3). No per-user HTTP response is cacheable for longer than one request, and sign-out clears the browser cache (CR-20, CR-21).
11. **Release path:** feature branch → PR into `dev` (CI gates) → auto-deploy to the dev environment → post-deploy smoke → release PR `dev` → `main` with the full device × zoom matrix, an owner-approved `prisma migrate deploy` on production, then deploy. Expand-only migrations ship before code; contract migrations ship a release later with explicit owner confirmation; enum values are written one release after they ship (§4).
12. **Testing:** `node:test` via `tsx` for unit and integration (Docker Postgres in CI), contract tests from the shared zod schemas, Playwright e2e on `dev` in CI (smoke per PR, full suite and the 40-project device × zoom matrix nightly against a CI-local build, smoke after every dev deploy) with the paywall on, leased personas, server-time control, automated telemetry and console guards, a design-state coverage manifest, visual regression, k6 against dev, and a chess-correctness corpus with expected grades (§5).

### 0.2 Conflicts between the inputs, and what this document decides

Revision 2 keeps the revision-1 numbering so references still resolve. Rows marked **(r2)** changed; §0.3 holds the cross-plan names.

| # | Topic | Inputs say | Decision here | Why |
|---|---|---|---|---|
| X1 **(r2)** | Where the analysis worker runs | Revision 1: co-located on both boxes with a "Stage B" resize. Allocation §1.5, optimization D11, P3 §0.1, P13 D7: its own VM | **Production: its own 2-OCPU / 12-GB A1 VM** (`10.42.0.30` on the VCN), reached through the socket box's Caddy. **Dev: co-located** on the dev box under a `cpu.idle` cgroup slice (§1.8.2). Stage B deleted | After D7 the free pool is 4/4 OCPU (prod 1 + worker 2 + dev 1); a prod resize is impossible without paying (feasibility F-OCI-1) |
| X2 | Socket server database access | `audit-db` §5.3, `inv-acct` §1.4: via the web app's internal API. `audit-api` F-09, `inv-play-a` §2.1, `audit-quality` SEC-02: direct | **Direct**, through `DB/src/live/*` with a restricted Postgres role (`replay_realtime`), checkpoints (≤ 10 per game), a local journal and an outbox (B4). Exception: tournament pairing/start/finalize through web internal routes (CR-17) | Every Vercel hop from Mumbai costs an invocation and ~250 ms. Validation lives in shared packages (`game-core`), not route handlers |
| X3 **(r2)** | Event and room names | dot case and `g:`/`u:` rooms (revision 1); colon case and `game:`/`user:` rooms (B20, P2–P13) | **Colon case, P2 rooms** (CR-13, CR-14) | B20 is binding and P2 shipped it |
| X4 | Review progress room | `inv-rct-a` §2.5: a `review:<ref>` room with its own room token | **Push to the two players' `user:{ref}` rooms** | Reviews are private to players; the user room already exists and is authenticated |
| X5 **(r2)** | Engine budget | 120k (`inv-rct-a`), 150k (`inv-rct-b` J4, revision 1), 250k (`inv-research` R-CMP-02), 1M (plan §3) nodes per position | **P3-D9** (pass 1 = 120k MultiPV 2 on every ply; pass 2 = 1M MultiPV 3 on at most 6 candidates), frozen by the C1 bench on the A1 (CR-34) | One budget for every game keeps labels comparable; P3 owns the benchmark |
| X6 | Per-ply `MoveEval` vs packed analysis | Plan §3: `MoveEval` rows. `audit-db` §11.5 and `inv-rct-a` §2.6: packed per game | **Packed `GameAnalysis` row plus `Mistake` rows** | 1.6 KB vs 21.6 KB per game against Neon's storage cap |
| X7 | Lichess puzzle corpus | Plan §5, `inv-research` §9: Neon table. `inv-rct-b` D5, `audit-db`: R2 shards | **R2 shards** (`media.playchess.tech/puzzles/v1/…`) | Zero Neon storage, CDN-cached, immutable |
| X8 | Vercel function region | `inv-play-a` §2.5: `bom1`. `audit-api` F-31, `audit-db` §5.3, `inv-rct-b` §5.2: `iad1` | **`iad1`**, pinned in `WEB/vercel.json` | Neon is in AWS us-east-1; RSC pages make several queries each |
| X9 | Bot games | `audit-quality` SEC-07: server bot play. `inv-play-a` §2.4, `inv-play-b` §3.3, `audit-socket` §17.11: client-run | **Client-run, unrated**, adjudicated on completion (P2 §7.1.4: replay, legality, claim check) | Forging a bot game only affects the forger's own coaching data |
| X10 | Trial reminder runner | Plan §1.5: Vercel daily cron | **A `TRIAL_ENDING` notification sent by a future-dated `NOTIFY_DISPATCH` job at `trialEndsAt − 48 h` (P10)**, with the daily cron as a backstop that enqueues a missed one | Exact timing, no daily scan |
| X11 **(r2)** | Coach fair-use cap | Plan §7: 200 a day; research: 30 a day + 300 a month; revision 1: 150 a month; P7 rev 1: 300 | **CR-33**: member 30/day, 150/month, $1.50/month; trial 10/day, 40/trial, $0.40; one file `CT/limits.ts` | 300 Sonnet questions can cost $2–4 a month against $4.99; trialists could burn the full ceiling |
| X12 **(r2)** | Migrations on Neon | CLAUDE.md rule 1: `db push`. CLAUDE.md environments section and `audit-db` §4.2: `migrate deploy` | **CR-35**: `migrate deploy` on every Neon branch; no `db push` on any Neon branch [OD D5: reword rule 1] | `db push` writes no history and drops hand-written partial indexes and `UNLOGGED` storage |
| X13 | `ts-fsrs` v6 needs Node ≥ 24 | Repo targets Node 22 (`package.json` engines, `WS/Dockerfile:2`) | **Every runtime on Node 24 LTS** (Vercel setting [V], Docker images, CI) before P5 | FSRS grading runs on Vercel and in the worker |
| X14 | PostHog `distinct_id` | `inv-pub` §1.11: Clerk user id. `inv-acct` §1.6: `User.referenceId` | **`User.referenceId` everywhere**, with a one-time `alias` for existing persons | Our id; the worker knows it without a Clerk lookup |
| X15 | Weakness profile minimum | Plan §6: 10 games. `V3WeaknessInsufficient`, `inv-rct-b` D8: 20 | **20 for the full profile, Preliminary from 5** | The design is authoritative |
| X16 **(r2)** | Socket token secret | Today one `INTERNAL_API_SECRET` signs user tokens and authorises services (`audit-socket` S6) | **`SOCKET_TOKEN_SECRET` for user tokens; `INTERNAL_API_SECRET` re-purposed as the HMAC key set for services** (CR-16, CR-26) | A leaked user-token verifier must not let anyone act as a service |
| X17 | WebSocket URL env name | Plan: `NEXT_PUBLIC_WS_URL`; code: `NEXT_PUBLIC_WEBSOCKET_URL` (`WEB/app/game/[gameId]/GamePageContent.tsx:391`) | **Keep `NEXT_PUBLIC_WEBSOCKET_URL`** | Matches the code and the e2e workflow |
| X18 | Socket token for non-members | `inv-play-a` §2.2: 402 for non-members. `inv-pub` §1.8: tokens for any signed-in user | **Any signed-in user gets a token carrying `ent`.** A socket with `ent` in the past may only join its own `user:` room; game, queue, arena and spectate commands answer `not_member`. `entitlement:changed` updates `ent` on live sockets | Checkout-return and onboarding screens need push before the membership exists |
| X19 **(r2)** | Recurring schedule | Revision 1 and consistency R-05: an `HOURLY_TICK`. Feasibility F-NEON-2: daily planner. api-perf AP-08: next-due jobs | **CR-10** (daily `HOUSEKEEPING` + `DAILY_PLAN`, next-due timer, no tick) | 24 fixed wakes a day ≈ 15 % of the Free CU-h cap, even with zero members online |
| X20 **(r2)** | Internal auth | P2 rev 1 and P3: static `x-internal-token`; consistency R-08: keep it. Revision 1, P4, P9, P12, P13: HMAC | **CR-16** (HMAC from P2) | Replay protection; per-caller allow-lists stop a leaked web key from posing as the worker and vice versa |
| X21 **(r2)** | Dev database | Revision 1 and P13 D16: split dev to its own project at launch | **Split in P1 (1B·H10)**: Free project `replay-chess-dev`, autoscaling max 0.5 CU (§4.1) | Until then dev, E2E, k6 and the P3–P12 worker spend production's 100 CU-h (audit-db DB-01, api-perf AP-01) |
| X22 **(r2)** | PGN storage | data-model D1: not stored. P2 B3: stored once | **Stored for games played here; rebuilt from `moves` for imports** | feasibility F-NEON-4 |

### 0.3 Canonical names and rulings (binding for every plan)

**Rule of precedence.** (1) Allocation binding decisions B1–B26, unless a row below records a deliberate, owner-visible deviation. (2) The rows below. (3) The first phase that ships a thing fixes its name and shape. (4) The data-model decides column types only where no earlier phase fixed them. Where two critiques disagreed, the "Why" column says which one won.

**Contracts and names**

| # | Topic | Canonical | Replaces (do not use) | Why / source |
|---|---|---|---|---|
| CR-01 | Game columns | P2's M2 names (`phase-02` §6.2): `games."whitePlayerId"`, `"blackPlayerId"`, `"endMethod" GameEndMethod` (+ `OTHER` for imports), `outcome GameWinner {WHITE BLACK DRAW NONE}`, `fen`, `"rematchOfId"`, `"completedAt"` (game end time), `moves` + `"moveClocksMs"` + `"plyCount"`, `pgn` (platform games only); M2 also adds the display snapshot `whiteName…blackTitle`, `source GameSource {REPLAY CHESSCOM LICHESS}`, `"externalId"`, `"externalUrl"`, `GameMode.IMPORTED` | `whiteUserId`, `endReason`, `GameOutcome`, `WHITE_WIN`, `finalFen`, `games."playedAt"`, `parentGameId`, `GameMove` rows | consistency R-01; P2 shipped these |
| CR-02 | Per-member game row | `GamePlayer` (`game_players`), PK `(gameId, userId)` + unique `(gameId, color)`; per-member end time **`game_players."endedAt"`**; archive and Home index **`game_players_userId_endedAt_gameId_idx (userId, endedAt DESC, gameId DESC)`**; wire DTOs may call the value `playedAt` | `game_players."playedAt"`, `(userId, playedAt…)`, PK `(gameId, color)` | consistency R-01 wins over api-perf AP-07's rename: one column either way, and seven phases already use `endedAt` (P2 Appendix A) |
| CR-03 | Later columns on games / game_players | M3 `games."ecoCode"`, `"openingName"`, `game_players."ecoCode"`, analysis outputs on `game_players` and `games."analysisStatus"` (there is **no** `game_players."analysisStatus"`); M4 `game_players."linkedAccountId"`; M6 `game_players.stats`, `"errorThemes"`, `errorLog`, `errorThemeN`, `weaknessInputsV`; M8 `games."seriesNo"`; M9 `game_players_h2h_idx`; M12 `games."tournamentPositionOrder"`, `game_players."tournamentPoints"`, `"tournamentFire"` | "from DM M2" | consistency R-01 |
| CR-04 | Live-game sweep index | partial **`games_open_idx ON games (status) WHERE status IN ('WAITING_FOR_OPPONENT','IN_PROGRESS')`** | `games_status_lastMoveAt_idx` (breaks HOT updates on every checkpoint) | api-perf AP-07, P2 §6.3 |
| CR-05 | Tables that exist (and do not) | `TrainingCard`/`TrainingAttempt` (`training_cards`/`training_attempts`, P5); one `Report` (`reports`, P5) with `targetType`, extended by P10; `Share` (P3); `AuditLog` (`audit_logs`, **M4**); `CoachUsageDay`, `CoachSpendDay` (P7); `UserSettings` (P9, `consent` kept); `SupportRequest` (P11); `ImportRun` + `Job IMPORT_SYNC` (P4); `DataExportJob` + `Job EXPORT_BUILD` (P10); ratings as `PlayerRating` + `GamePlayer.rating{Before,After,Delta}` | `ReviewCard`, `ReviewLog`, `KeyMoment`/`key_moments`, `UserReport`, `TrainingReport`, `ShareLink`, `SharedPosition`, `TournamentPairing`, `TournamentInvite`, `AdminActivity`, `admin_audit_log`, `CoachUsage`, `PlayerStats`, `RatingEvent`, `rating_events`, `PositionCollection`, `daily_plans`, `user_streaks` | consistency R-02, R-04 |
| CR-06 | Key moments | `PlayerReview.content.moments[]` (≤ 3). Bank ↔ moment link = `MistakeOccurrence (gameId, ply)`; the per-review opt-out = `player_reviews.progress.bankOptOut` | a `key_moments` table | P3-D3, api-perf §1, P5 rev 2 |
| CR-07 | Time zone | `User.timeZone String @default("UTC") @db.VarChar(64)`, **created in M4 (P4)** | `timezone`, "P1 M1b", "P5 if absent" | consistency R-03 |
| CR-08 | Job columns and index | `Job.fairSeq Int @default(0)` (M3); `Job."lastKickAt" timestamp(3)` (M3); `jobs_ready_idx ON jobs (priority DESC, "fairSeq", "runAt") WHERE status = 'QUEUED'` | `(priority, "runAt")` | consistency R-05, api-perf AP-09 |
| CR-09 | Job priorities | **Higher runs first.** Named constants `JOB_PRIORITY` in `DB/src/jobs.ts` (P3): `USER_OPENED 100`, `IMPORT_SYNC_MANUAL 100`, `GAME_ENDED 80`, `IMPORT_SYNC_INITIAL 60`, `REVIEW_BATCH 60`, `IMPORT_NEWEST 50`, `WEAKNESS 20`, `IMPORT_PURGE 20`, `IMPORT_SYNC_DAILY 15`, `BACKLOG 10`, `HOUSEKEEPING 0`. No literal priority anywhere (ESLint ban) | the 0/1/5/8 lower-first scale; `PRIORITY.LIVE_END`; `WK/src/queue/priority.ts`; `CO/src/jobs.ts` | P3-D7, consistency R-05 (api-perf's module name loses to the file P3 owns) |
| CR-10 | Recurring work | **No `HOURLY_TICK`.** `HOUSEKEEPING` runs once a day (21:00 UTC); its last step is `DAILY_PLAN`, which inserts the next 26 h of future-dated rows (per-zone notification pushes, weekly digests and the weekly weakness roll, DST recomputation, `BACKUP`, tournament starting reminders) with `dedupeKey`s. A web write that changes the next 26 h enqueues its own row. The worker keeps `nextRunAt` in memory, set from each kick's `runAt` and from the `min("runAt")` it reads at the end of a drain (Neon is already awake); an idle worker sends **no query**. The reaper runs at boot and at the end of each drain | `HOURLY_TICK`, `TRAIN_RELEASE` kind, `FSRS_OPTIMIZE` kind, `node-cron`, "every 15 min / 30 s / 1 min" timers | feasibility F-NEON-2 and api-perf AP-08 win over consistency R-05 item 3: the tick costs ≈ 15 CU-h a month (15 % of the Free cap) and P3 never built it |
| CR-11 | JobKind ledger | M3 `CREATE TYPE`: `ANALYZE_GAME REVIEW_TEXT LEGEND_COMPARE IMPORT_SYNC IMPORT_PURGE RECOMPUTE_WEAKNESS EXPORT_BUILD ACCOUNT_PURGE DODO_CUSTOMER_SYNC HOUSEKEEPING DAILY_PLAN`; m5a `EXTRACT_MISTAKES`; m10a `MILESTONES_EVALUATE NOTIFY_DISPATCH NOTIFY_REMINDERS NOTIFY_WEEKLY MEMBERSHIP_PAUSE_EDGE R2_SWEEP`; m12a `TOURNAMENT_STARTING`; m13a `BACKUP`. Each `ADD VALUE` in its own file, written one release after it ships (§4.7) | `IMPORT_ACCOUNT`, `WEAKNESS_RECOMPUTE`, `WEAKNESS_WEEKLY`, `TRIAL_REMINDER` (a `NOTIFY_*` row), `PROFILE_STATS`, `TOURNAMENT_FINALIZE`, `HOURLY_TICK`, dotted `notify.dispatch` | consistency R-05 with CR-10 applied |
| CR-12 | Worker endpoints | `POST /internal/analysis/kick` body `{ v: 1, kinds?: JobKind[], runAt?: ISO }`; `POST /engine/analyse`; app directory `apps/analysis-worker` | `/internal/wake`, `/worker/wake`, `/worker/engine/analyse`, `apps/worker` | P3-D12, consistency R-05 |
| CR-13 | Socket rooms | `game:{ref}`, `spectate:{ref}`, `user:{ref}`, `tournament:{slug}`, built only by `ROOM` in `CT/socket/rooms.ts` (P2). ESLint bans room string literals elsewhere | `g:`, `g:{ref}:w`, `u:`, `t:` | P2 §7.4.3, R-07 |
| CR-14 | Socket event names | `domain:event` in colon case; the only server→client registry is `CT/socket/registry.ts` (P2) with schemas in `socket/{game,user,tournament,queue,system}.ts`. Game room: `game:snapshot`, `game:phase`, `study:ready`, `move:applied` (no `fen`; ≤ 200 B), `clock:sync`, `presence:update`, `draw:*`, `game:ended` (immediate), `game:result` (after persistence), `rematch:*`, `spectators:update`, `game:error`, `server:restarting`. User room: `session:hello {bootId, useq, serverNow}` (connect), `analysis:queued\|progress\|writing\|done\|failed`, `analysis:batch` (coalesced backlog), `import:progress\|finished`, `weakness:progress\|ready`, `bank:due_changed`, `mistakes:added`, `entitlement:changed` (absorbs `membership:updated`), `review:text_ready`, `queue:matched`, `queue:moved`, `blocks:changed`, `presence:state` (P10 watcher), `notify:new` (P10), `export:ready`; tournament room: `tournament:updated`, `tournament:search_ended` (+ P12 list); all sockets: `system:notice` | dot case (`analysis.progress`), `game.over`, `notice`, `bank:due`, `match:found`, `notification:new`, `membership:updated`, `game:over` | B20, P2 §7.4.5, R-07, AP-10 |
| CR-15 | Fan-out to sockets | `POST /internal/emit` with exactly one body: `{ v: 1, targets: ({ room } \| { userRef })[] ≤ 50, event, data, dedupeKey? }` (zod `.strict()`); empty rooms are skipped before the parse | `{room, event, data}`, `rooms[]`, `/internal/notify` | P2 §7.5, R-07 |
| CR-16 | Internal auth | **HMAC on every internal hop from P2**: `x-rc-kid`, `x-rc-ts` (±60 s), `x-rc-sig = base64url(HMAC-SHA256(key[kid], ts\nMETHOD\npath\nsha256hex(body)))`, a 2-minute replay set, timing-safe compare, helper `CT/internal/auth.ts`, sender `WEB/lib/internal/fetch.ts` (`internalFetch()`). Keys: one env var **`INTERNAL_API_SECRET`** holding a key set `kid:base64[,kid:base64]` (first signs); kids `web`, `wk`, `ops`, `ws`; each kid has a path and event allow-list (the worker may emit only `analysis:*`, `import:*`, `weakness:*`, `bank:*`, `mistakes:*`, `review:*`, `games:changed`, `export:ready`). Caddy refuses unsigned `/internal/*` and `/engine/*` before Node. User socket tokens use the separate `SOCKET_TOKEN_SECRET` | static `x-internal-token`, `INTERNAL_HMAC_SECRET`, `RC_INTERNAL_KEYS`, `INTERNAL_API_TOKEN` | feasibility SEC-4 and api-perf AP-44 win over consistency R-08 (a shared static bearer has no replay protection and lets one leak forge `entitlement:changed`); R-08's "one helper, one env name" is kept. Owner sign-off: P2 Q17 |
| CR-17 | Live-game persistence | **B4:** the socket server writes Neon directly through `DB/src/live/*`; the finish is `finishGame()` in `DB/src/live/finish.ts`, one data-modifying CTE that P3, P9 and P12 append named fragments to. **Deliberate exception:** tournament pairing, start, finalize and reminders go through `/api/internal/tournaments/*` on web (P12 D12-4), signed with HMAC | internal web routes INT-1…8 for live writes; `WS/src/persistence/finishGame.ts`; `DOM/games/finishLiveGame.ts` | R-10, R-11 |
| CR-18 | Error codes | One ledger, `CT/http/codes.ts` (`ERROR_STATUS`, each code exactly one status; `CONFLICT_REASONS`, `FORBIDDEN_REASONS`, `SUBSCRIPTION_REASONS` append-only). Statuses: `validation_failed` 400, `invalid_json` 400, `unauthorized` 401, `subscription_required` 402 (`reason ∈ trial_available, trial_used, expired, payment_failed, paused`), `payment_update_required` 402, `forbidden` 403, `reverification_required` 403, `not_found` 404, `conflict` 409, `in_flight` 409, `gone` 410, `precondition_failed` 412, `payload_too_large` 413, `idempotency_key_reused` 422, `illegal_moves` 422, `illegal_position` 422, `upgrade_required` 426, `rate_limited` 429 (`details.source`), `fair_use_limit` 429, `internal` 500, `upstream_unavailable` 502 (`details.kind ∈ timeout, error, refresh`, `details.provider`), `maintenance` 503, `not_configured` 503 | `membership_ended`, `origin_mismatch`, `upstream_timeout`, `upstream_error`, `refresh_failed`, `upstream_rate_limited`, `unauthenticated`, `fair_use`, `bad_request`, `unsupported_media_type`, `CT/http/errors.ts` | consistency R-06 |
| CR-19 | Rate limits | P1's fixed window `{ bucket, limit, windowSec, by, store: "burst" \| "durable" }`. `burst` = the `UNLOGGED rate_limit_buckets` table, **only for windows ≤ 60 s** (it empties when Neon scales to zero). `durable` = counted from the route's own source rows (`reports`, `shares`, `training_sessions`, `data_export_jobs`, `notifications`…) or from the LOGGED `rate_limit_windows (key, count, resetAt)`. A spec with `windowSec > 300` and `store: "burst"` fails at module load. Email and coach budgets never live in the UNLOGGED table | "Postgres token bucket", "burst / refill" | P1-09, R-13, api-perf AP-11, feasibility F-NEON-3 |
| CR-20 | HTTP cache tiers | Six names, implemented in P1's wrapper: `public-immutable` (hashed or versioned URLs), `public-static` (ISR/CDN, tag-purged), `public-short` (CDN ≤ 60 s), `private-etag` (`private, no-cache` + **strong** ETag), `no-store`, `sse`. `public-*` only with `auth: "public"` and **no session read** (module-load assertion). **No per-user response has `max-age > 0`.** Downloads (PGN, invoice, export) are `private, no-store` + `Content-Disposition: attachment`. A route that needs public data plus per-viewer bits splits into a public path and a `no-store` `/me` path | T0–T3, NS, "T1 private immutable", weak `W/` ETags | api-perf AP-03, AP-04, AP-22 |
| CR-21 | Sign-out on a shared device | `signOutEverywhere()`: flush the outbox → `POST /api/session/clear` (`204`, `Clear-Site-Data: "cache"`) → clear TanStack, IndexedDB `u:<userRef>:*` and the user's SW cache → `clerk.signOut()` | — | api-perf AP-04, AP-34, feasibility 10.4 |
| CR-22 | Client HTTP | One `api()` (P1 §7.12, `WEB/lib/api/client.ts`): header **`x-rc-build`**, no `ifNoneMatch` option (304s are transparent browser revalidation), zod parse only through `devSchema()` in dev and test | `x-client-build`, `{ notModified: true }` | api-perf AP-12, AP-21 |
| CR-23 | Review API | `/api/review/[ref]/*`, page `/review/[ref]`; status `GET /api/review/[ref]/status` with `qk.review.status(ref)` | `/api/reviews/{gameRef}`, `/api/games/:ref/review`, `qk.games.status` | B21, P3-D1, R-15 |
| CR-24 | GET purity | A GET never enqueues engine work or calls a provider. Allowed GET side effects are registered in the route registry (`sideEffects: ["daily_plan" \| "legend_facts" \| "kick_cas"]`); the wrapper throws in dev and test on any other write. Re-kicks are a compare-and-set on `jobs."lastKickAt"` (≤ 1 per job per 30 s). The review **RSC page** (not the JSON GET, never a prefetch) may lazily enqueue `REVIEW_TEXT` (P7 D24) | GET enqueue at priority 100, `?refresh=billing`, hover-prefetch that enqueues | api-perf AP-09, AP-31 |
| CR-25 | Billing snapshot writes | Compare-and-set in **P1 F4b**: `users."subscriptionSourceAt"` (provider event time, never `now()`), `UPDATE … WHERE "subscriptionSourceAt" IS NULL OR "subscriptionSourceAt" <= $eventTime AND ROW(…) IS DISTINCT FROM ROW(…)`. Billing refresh is `POST /api/billing/refresh`; the 6-hour heal moves to the daily `membership-reconcile` cron task | read → decide → write; refresh by GET | audit-db DB-07, api-perf AP-06, AP-31 |
| CR-26 | Env var names | `INTERNAL_API_SECRET` (key set), `SOCKET_TOKEN_SECRET`, `ANALYSIS_WORKER_URL`, `WS_INTERNAL_URL`, `WEB_APP_URL` (OCI services), `NEXT_PUBLIC_SITE_URL` (+ optional `NEXT_PUBLIC_SHARE_ORIGIN`), `NEXT_PUBLIC_WEBSOCKET_URL`, `NEXT_PUBLIC_ENGINE_BASE_URL`, `HASH_PEPPER` (emails), `RATE_LIMIT_IP_PEPPER`, `LINK_TOKEN_KEYS` (only if the Lichess token is stored, §2.3.2), `NEXT_PUBLIC_POSTHOG_KEY` / `POSTHOG_PROJECT_KEY` / `POSTHOG_FEATURE_FLAGS_KEY` / `POSTHOG_PERSONAL_API_KEY` / `POSTHOG_HOST`, `SENTRY_DSN` per service, `ENGINE_PATH`, `R2_PRIVATE_BUCKET`, `APP_ENV`, `ALLOW_TEST_HOOKS`, `E2E_TEST_TOKEN`; GitHub secrets `WS_ENV_FILE`, `WS_DEV_ENV_FILE`, `WORKER_ENV_FILE`, `WORKER_DEV_ENV_FILE` | `WORKER_URL`, `WORKER_BASE_URL`, `WORKER_INTERNAL_URL`, `APP_URL`, `NEXT_PUBLIC_WS_URL`, `TRIAL_LEDGER_PEPPER`, `EMAIL_HASH_PEPPER`, `TOKEN_ENC_KEY`, `LINKED_ACCOUNT_KEY`, `LINK_TOKEN_KEY`, `POSTHOG_KEY`, `POSTHOG_FLAGS_KEY`, `SENTRY_DSN_WORKER`, `STOCKFISH_PATH`, `WK_ENV_FILE`, `INTERNAL_ROUTE_PATHS` | consistency R-09 (with CR-16's key-set format) |
| CR-27 | Test-hook gating | `isNonProd()` (`APP_ENV ∈ {dev, test}`) **and** `ALLOW_TEST_HOOKS=1` **and**, for request hooks, `x-e2e-token == E2E_TEST_TOKEN`. Never `VERCEL_ENV`, because `replay-chess-dev` deploys as `target: production`. `APP_ENV` is required at boot | `VERCEL_ENV !== "production"`, "`APP_ENV=dev` only" | feasibility fix #3, SEC-5, testing X12 |
| CR-28 | Packages and modules | `PKG/contracts/src/{http,socket,internal}/*` (`exports` `./http/*` from P1, `./socket/*` and `./internal/*` from P2); `DB/src/live/*` (P2); `DB/src/jobs.ts` (P3); `packages/domain` created by **P9**; `PKG/chess-training` (P5) with weakness baselines at `PKG/chess-training/baselines/v1.json` (P6); drift gate `scripts/db/check-drift.ts` + `DB/prisma/protected-indexes.txt` (P2); one parameterised Glicko-2 module `PKG/game-core/src/rating/glicko2.ts` with presets (`TRAINING`: τ 0.5, RD floor 50 for P5; `PLAY`: τ 0.75, RD floor 45 for P9); one R2 presign helper `WEB/lib/r2/presign.ts` on `aws4fetch` | `packages/game-protocol`, `packages/internal-auth`, `packages/protocol`, `CT/http/errors.ts`, `WEB/lib/storage/r2-presign.ts`, `@aws-sdk/s3-request-presigner` on web | R-10, R-12, feasibility fix #11 |
| CR-29 | Feature flags | Allocation §1.6 names plus `review-share`, `review-lapsed-read`, `analysis-live-prewarm` (P3), `admin-v3` (P12), `csp-enforce`; P11's `public-v3` is deploy-scoped, `auth-v3` is the Edge Config key `replay-ops.flags.auth_custom_flows`, consent is the env var `NEXT_PUBLIC_CONSENT_BAR` | `new-shell`, `mistake-bank`, `puzzles`, Edge Config `consent_bar` | R-14 |
| CR-30 | Client storage | IndexedDB outbox `rc-outbox`, keys `u:<userRef>:<stream>`; offline snapshots `rc-offline`; SW page cache `rc-pages:u:<userRef>` | `rc-train-outbox`, one shared `rc-pages` | R-16, AP-34 |
| CR-31 | Wire enums | Lowercase in request bodies (`"daily" \| "bank" \| "puzzles" \| "weakness" \| "openings"`); Postgres values stay uppercase | `{kind:'OPENINGS'}` | R-17 |
| CR-32 | Telemetry names | `area_object_action`; one owner per event (P2 `engine_init`, P5 `train_session_*`, P3 `legend_compare_opened`, P4 `checkout_start_failed`, P2 `server_restart_notice_shown`); registry `packages/analytics/src/events/<area>.ts` (P1) | `engine_load` | R-18, testing X6 |
| CR-33 | Coach limits | One file `CT/limits.ts` (`COACH_LIMITS`): member 30 a day, **150 a month**, $1.50 model cost a month; trial 10 a day, 40 over the trial, $0.40; burst 5 per 60 s for everyone; global daily breaker `max($5, $0.08 × entitledMembers)` recomputed daily | 300 a month; $25 a day flat | P7 D6, feasibility F-LLM-3/4 |
| CR-34 | Engine and eval cache | Worker profile **P3-D9** (pass 1 = 120k nodes MultiPV 2; pass 2 = 1M nodes MultiPV 3 on candidates), frozen by the C1 `stockfish bench` on the A1; eval cache = SQLite (`better-sqlite3`, fallback `node:sqlite`); browser engine served from R2 through `NEXT_PUBLIC_ENGINE_BASE_URL` with a same-origin worker shim, GPL `COPYING` + `SOURCE.txt` next to it (P2) | `sf18-v1` 150k/1.5M (revision 1), LMDB, engine files only under `public/workers/` | feasibility §6, LIC-2, P2 §0.2 |
| CR-35 | Neon procedure | **No `prisma db push` and no `prisma migrate dev` against any Neon branch.** `migrate deploy` on dev and prod; `migrate dev` / `migrate diff` only against a local Docker Postgres shadow. CLAUDE.md rule 1 still says `db push` for shared databases: amending it is owner decision D5; until the owner amends it, phase work still never runs `db push` on a branch that holds hand-written partial indexes, and every destructive command first asks "This command may reset/drop your database. Are you sure?" (rule 5) | "`db push` while iterating" | consistency R-20, data-model D23 |
| CR-36 | Phase order | P8 starts after P5 merges (or splits: catalogue/SEO after P3, lessons and the opening drill after P5); P11 depends on P7 and P10; between P10 and P12 the first to merge creates `TournamentParticipant.displayName`, `reverification_required`, the R2 presign helper and the new `Notification` kinds, the second reuses them (`IF NOT EXISTS`) | allocation §0 calendar | R-19 |
| CR-37 | Game-over card slots | P3 owns the coach line (template `PlayerReview.content.summary[0]`) and P7 swaps in the verified LLM sentence on `review:text_ready`; P5 owns the Mistake Bank line from `analysis:done.bankAdded`; P3 adds "Replay from move N" to the legend block | "no change" in P5 and P7 | coverage C-01, C-02, C-03 (07-design-coverage §3) |

**Facts verified on 2026-11-02 that the plans rely on** (feasibility §1, api-perf method): Vercel Hobby with Fluid compute allows 300 s functions (we cap the coach at 60 s); Hobby cron runs at most once a day (a more frequent expression fails the deploy); Hobby pauses a feature for up to 30 days when a quota is exceeded; Vercel request cancellation is opt-in per function (`supportsCancellation`); `replay-chess-dev` deploys with `target: production`; Neon Free closes idle connections when the compute suspends after 5 minutes and keeps one manual snapshot; the Lichess opening explorer (`explorer.lichess.org`) now requires OAuth; the repository is public (MIT) and `k8s/secrets.yaml` in `dev` HEAD holds a `sk_test_` Clerk key; `playchess.tech` expires on 2027-02-02 with auto-renew off.

## 1. System

### 1.1 Context diagram

```
                                     ┌──────────────────────────── Browsers ─────────────────────────────┐
                                     │ desktop 1440×900 / 1280×800 · iPad L 1194×834 · iPad P 834×1194    │
                                     │ iPhone 393×852 · Android 412×915 · PWA (service worker, IndexedDB) │
                                     │ zoom 80–150 % · Stockfish WASM worker (bot, practice, what-if only)│
                                     └───┬──────────────┬───────────────────┬──────────────┬─────────────┘
              HTTPS: RSC, JSON, SSE      │              │ WSS (Socket.io v2) │ HTTPS (CDN)  │ redirects
                                         ▼              │                   ▼              ▼
 ┌──────────────── Vercel (Hobby today; Pro before charging [OD D1]; iad1) ┐  ┌─────────── Cloudflare ────────────┐
 │ Edge middleware: Clerk session, claim paywall, CSP nonce, request id,  │  │ DNS for playchess.tech (DNS only) │
 │   scanner early-return; catalogue APIs excluded from the Clerk matcher │  │ R2: media.playchess.tech (public: │
 │ RSC pages ((marketing) ISR · (app) dynamic · (admin))                  │  │   media, puzzles/v1, engine/sf18-*)│
 │ Route handlers /api/*: me, games, review, train, weakness, coach SSE,  │  │ R2 private: exports, backups,     │
 │   accounts, import, billing, settings, admin, internal, webhooks       │  │   avatar uploads                  │
 │ Cron: /api/cron/daily (09:00 UTC backstop)                             │  │ Email Routing (inbound hello@)    │
 │ Proxies: /ingest → PostHog, /monitoring → Sentry                       │  └───────────────▲────────────────────┘
 └──┬──────────┬──────────┬──────────┬───────────┬─────────────┬─────────┘                  │ S3 API (worker)
    │ Prisma   │ Clerk    │ Dodo     │ Anthropic │ HMAC HTTPS  │ HMAC HTTPS                  │
    │ pooled   │ BAPI     │ API      │ (Sonnet)  │ /internal/  │ /engine/analyse,            │
    ▼          ▼          ▼          ▼           │ emit        │ /internal/analysis/kick     │
 ┌────────┐ ┌───────┐ ┌───────┐ ┌──────────┐     ▼             ▼                             │
 │ Neon   │ │ Clerk │ │ Dodo  │ │ Claude   │  ┌──── OCI prod socket box (ap-mumbai-1) 132.226.190.10, 1 OCPU / 6 GB ───┐
 │Postgres│ │       │ │Paymnts│ │ API      │  │ Caddy :443 ws-chess.playchess.tech (refuses unsigned /internal/*, /engine/*)│
 │us-east-1│ └───┬───┘ └───┬───┘ └────▲─────┘  │   /socket.io/*                         → websocket:3002                 │
 │        │     │webhook  │webhook    │        │   /internal/emit (HMAC)                → websocket:3002                 │
 │ prod   │     ▼ (svix)  ▼ (std-wh)  │        │   /engine/*, /internal/analysis/* (HMAC) → 10.42.0.30:3003 (worker VM)  │
 │ project│   /api/webhook/clerk ,    │        │   /health, /ready                       → public, no data                │
 │        │   /api/webhook/dodo-payments       │ websocket (Node 24): LiveSession registry, matchmaking queue (P9),      │
 │        │◄──────────────────────────┼────────┤   arena (P12), user rooms, ndjson journal /data/journal, outbox → Neon  │
 │        │  pooled, ~200 ms RTT      │        └──────────────────────────┬──────────────────────────────────────────────┘
 │        │                           │                                   │ VCN 10.42.0.0/24 (HMAC)
 │        │                           │        ┌──── OCI prod worker VM 10.42.0.30, 2 OCPU / 12 GB (P13 D7) ─────────────┐
 │        │◄──────────────────────────┼────────┤ worker (Node 24 + stockfish arm64): queue, next-due timer, importers,   │
 │        │                           └────────┤   2 engine lanes, eval cache (SQLite /data/evalcache), Haiku review   │
 └────────┘                                    │   text, notifications (Resend, web-push), backups (pg_dump → R2)       │
                                               └──┬───────────────┬──────────────┬──────────────────────────────────────┘
                                                  │ HTTPS serial  │ HTTPS ndjson │ HTTPS
                                                  ▼               ▼              ▼
                                           api.chess.com     lichess.org     Resend · FCM/APNs/Mozilla push
 Dev: ONE box 80.225.200.210 (wss://ws-dev.80-225-200-210.sslip.io) runs Caddy + websocket + worker (worker in a
 cpu.idle slice, ≤ 0.75 CPU), pointed at the Neon dev project (P1 1B·H10), Clerk dev, Dodo test, Anthropic dev workspace.
 Telemetry: Sentry (web, socket, worker projects), PostHog (one project, app_env property), UptimeRobot on /api/health,
 /health, /ready (prod and dev, from P1). CI/CD: GitHub Actions + GHCR (arm64 images).
```

### 1.2 Deployment units

| Unit | Runtime | Host | Deploys from | Instances |
|---|---|---|---|---|
| `web` (`apps/web`) | Next.js 15, React 19, Node 24 (Fluid compute) + edge middleware | Vercel project `replay-chess` (prod, branch `main`, created at go-live in P13) and `replay-chess-dev` (branch `dev`, deploys with `target: production`, protected by Vercel Authentication + an automation bypass secret, §3.2.1) | Vercel Git integration (dev) / `release-prod.yml` (prod) | Serverless, region `iad1` |
| `websocket` (`apps/web-socket`) | Node 24, Socket.io 4.8 | Docker on the socket box of each environment | `.github/workflows/deploy-oci.yml` | Exactly one per environment (the matchmaking queue and live sessions are in memory) |
| `worker` (`apps/analysis-worker`, P3) | Node 24, Fastify, native Stockfish 18 arm64 | **prod: its own VM** `10.42.0.30` (2 OCPU / 12 GB, P13); **dev: the dev box** | same workflow, second image; `deploy/oci/worker/docker-compose.yml` for prod | Exactly one per environment (provider rate limits are enforced in process, §2.3.2) |
| `caddy` | Caddy 2 | Docker on each socket box | same workflow | one |
| Postgres | Neon, PG 17 | prod: project `withered-cake-82837167`, branch `production` (Free until P13, then **Launch** [OD D2]); dev and E2E: **Free project `replay-chess-dev`** from P1 (1B·H10), autoscaling max 0.5 CU | `prisma migrate deploy` (§4.6) | one primary compute per branch |
| Object storage | Cloudflare R2 | buckets in §1.12.2 | scripts and services | — |

### 1.3 Service responsibilities and boundaries

| Service | Owns (writes) | Reads | Must never | Secrets it holds |
|---|---|---|---|---|
| **web** | Users (Clerk webhook and `/api/me` upsert), onboarding, preferences, consent, billing fields and `webhook_events`, `linked_accounts` and `import_runs`, game creation for bot games (and friend challenges until P9), bot-game checkpoint and completion, training cards and attempts (FSRS grading), coach threads, messages and usage, shares, reports, admin content, `audit_logs`, `rate_limit_buckets`/`rate_limit_windows`, `idempotency_keys`, `jobs` (enqueue only), notification preferences, push subscriptions, tournament pairing/start/finalize (P12 internal routes) | Everything it serves | Run engine searches (other than calling `/engine/analyse`), hold a socket connection, run work longer than the request (beyond `after()`), poll the database on a timer, cache a per-user response | Clerk secret and webhook secret, Dodo API and webhook keys, Anthropic web key, `SOCKET_TOKEN_SECRET` (sign), `INTERNAL_API_SECRET` (kid `web`), `CRON_SECRET`, `HASH_PEPPER`, `RATE_LIMIT_IP_PEPPER`, R2 keys (avatars, exports read), PostHog keys, Sentry auth token (build) |
| **websocket** | Live game state in memory; `games` live columns from creation (matchmaking, rematch) through the finish CTE (`DB/src/live/*`); `game_players` rows of live games; ratings (P9, inside the finish); `jobs` (`ANALYZE_GAME` inside the finish CTE) | Game rows for restore, user display data for pairing, tournament config (pushed by web) | Call Dodo, Clerk or Anthropic; trust a user id from a payload; emit engine evaluations of a live game | `DATABASE_URL` (`replay_realtime`), `SOCKET_TOKEN_SECRET` (verify), `INTERNAL_API_SECRET` (kids `ws`, verifies `web`/`wk`/`ops`), `WEB_APP_URL`, Sentry DSN |
| **worker** | `jobs` (claim, heartbeat, complete), `game_analyses`, `player_reviews`, `mistakes`, `mistake_occurrences`, new `BANK` training cards, imported `games`/`game_players`, `import_cursors`, `weakness_snapshots`, review text, `notifications` delivery state, account-deletion step state, export files, backups | Games, analysis inputs, users' notification settings and time zones | Serve end users directly (no Clerk); call Dodo or Clerk (deletion steps that need them call back into web, §2.3.8); write billing fields | `DATABASE_URL` (`replay_worker`), `BACKUP_DATABASE_URL` (read-only `replay_backup`), Anthropic worker key, Resend key, VAPID private key, R2 keys (backups write-scoped, exports write), `INTERNAL_API_SECRET` (kid `wk`), `BACKUP_AGE_RECIPIENT` (public key only), Sentry DSN, PostHog project key |
| **caddy** | TLS certificates | — | Proxy any path not listed in §1.8.1; pass an unsigned `/internal/*` or `/engine/*` request | none |
| **Neon** | system of record | — | Be reached by browsers; be polled by a timer | — |

**The boundary rule.** A table has one writer service per column group (§1.4). When a second service needs a change, it either enqueues a job for the owner or calls the owner's signed internal endpoint. Shared rules (move legality, clocks, time-control classes, grading formulas, FSRS, entitlement) live in packages, so every service computes the same answer.

### 1.4 Write-ownership matrix (tables named as in 02-data-model)

| Table group | web | websocket | worker |
|---|---|---|---|
| `users` profile, onboarding, prefs, `"timeZone"` (M4) | W | — | — |
| `users` billing fields (compare-and-set on `"subscriptionSourceAt"`, CR-25), `webhook_events`, `trial_ledger` | W | — | — |
| `users."gamesVersion"` (bump) | W (bot complete, purge) | W (finish CTE) | W (analysis batch, import chunk) |
| `linked_accounts`, `import_runs` (link, unlink, user-visible state) | W | — | W (cursor, sync status, counters) |
| `games` create (bot; friend until P9), bot checkpoint and completion | W | — | — |
| `games` create (matchmaking, rematch, P9 challenges via the socket), live columns, `moves`/`moveClocksMs`/`pgn` at finish | — | W | — |
| `games` create (tournament pairing, P12) | W (`/api/internal/tournaments/*`) | — | — |
| `games`/`game_players` create (imported) | — | — | W |
| `games."analysisStatus"` | W (request) | W (enqueue in the finish) | W (progress, done) |
| `game_analyses`, `player_reviews`, `mistakes`, `mistake_occurrences` | — | — | W |
| `training_cards` create from mistakes (`BANK`) | — | — | W (inside the analysis batch, P5 J1) |
| `training_cards` grade, `training_attempts`, `training_days`, `theme_mastery`, `training_sessions` | W | — | — |
| `weakness_snapshots` | — | — | W |
| `coach_threads`, `coach_messages`, `coach_usage_days`, `coach_spend_days` | W | — | W (review-text spend rows only) |
| `player_ratings`, `game_players.rating*` | — | W (finish, P9) | — |
| `tournaments` config; pairing, start, finalize | W | W (live arena state in memory; scoring fragment inside `finishGame()`) | — |
| `jobs` | W (enqueue, `lastKickAt` CAS) | W (enqueue) | W (all) |
| `notifications`, `push_subscriptions` | W (prefs, subscribe, producers) | — | W (delivery) |
| `account_deletions` | W (create in the delete transaction) | — | W (steps) |
| `audit_logs`, `rate_limit_buckets`, `rate_limit_windows`, `idempotency_keys`, `reports`, `shares` | W | — | W (`audit_logs` for backfills only) |

Defence in depth: each service connects with its own Postgres role (§1.12.1) whose `GRANT`s match this matrix, so a bug in the socket server cannot update billing columns.

### 1.5 Communication paths (every edge)

| # | From → to | Transport | Authentication | Payload | Timeout, retry | Frequency |
|---|---|---|---|---|---|---|
| E1 | Browser → web pages | HTTPS (RSC) | Clerk session cookie | — | browser default | per navigation |
| E2 | Browser → web `/api/*` | HTTPS JSON | Clerk session; mutations require `Sec-Fetch-Site: same-origin` or `Origin` = app origin (§3.2.6) | zod contracts (`CT/http/*`); header `x-rc-build` | 15 s client timeout; GET retried twice on 5xx or network, never on 4xx | per interaction |
| E3 | Browser → web `POST /api/coach/messages` | HTTPS, `text/event-stream` response | Clerk session | question + context ref + `clientId` | first verified sentence by 20 s, whole answer by 45 s, `maxDuration = 60`, `supportsCancellation: true` (§4.3); Stop also sends a `stop` beacon | per question |
| E4 | Browser ↔ websocket | WSS, Socket.io v2, `proto: 2` | signed socket token v2 `{sub, env, ent, role, exp, kid, v: 2}` (15 min), minted from Clerk session claims without a DB read where possible, refreshed lazily at handshake | `CT/socket/*` | ack timeout 5 s; reconnect 0.5–5 s with jitter; `session:hello {bootId, useq}` decides whether to resync | live games; one user channel per tab |
| E5 | Browser → R2 / CDN | HTTPS GET | none (public, immutable) | media, puzzle shards, engine glue + WASM (`application/wasm`, CORS for the app origins) | — | cached |
| E6 | web → Neon | Postgres over TLS, pooled | `replay_app` role | Prisma | `connect_timeout=15`, `statement_timeout=15s` (role) | per request |
| E7 | websocket → Neon | Postgres, pooled (`connection_limit=3`) | `replay_realtime` | checkpoint `UPDATE`, finish CTE | 8 s per statement; Neon-suspend errors (`P1017`, `P1001`, `57P01`, `08006`, `08003`) retried once at once on a fresh connection, counted as `ws.persist.reconnect`; then outbox backoff 1–60 s; `SELECT 1` prewarm when a game leaves `waiting` | ≤ 10 checkpoints per game, phase change, finish |
| E8 | worker → Neon | Neon HTTP driver for the analysis batch (`sql.transaction([...])`, P3-D11); `pg` pool (`pool.on('error')`, `idleTimeoutMillis: 60_000`) for claims; direct host only for `pg_dump` | `replay_worker`; `replay_backup` | claim, batch writes | 60 s (role); one retry on suspend errors for idempotent statements; never idle in a transaction | while draining |
| E9 | web → worker `/internal/analysis/kick` | HTTPS via the socket box Caddy (prod) | HMAC (kid `web`) | `{ v: 1, kinds?, runAt? }` | 2 s, no retry, sent in `after()`; a re-kick only when the `lastKickAt` CAS returns a row (CR-24) | after each enqueue |
| E10 | web → worker `/engine/analyse` | HTTPS via Caddy | HMAC (kid `web`) | `{fen, moves?, multipv ≤ 3, nodes ≤ 400000}` | 2.5 s, one retry on connect error | coach tool calls |
| E11 | web → websocket `/internal/emit` | HTTPS via Caddy | HMAC (kid `web`, event allow-list) | CR-15 body | 2 s, 2 retries in `after()` | entitlement changes, challenge accepted, notices, `notify:new` |
| E12 | worker → websocket `/internal/emit`; websocket → worker `/internal/analysis/kick` and `/internal/live/ply` | prod: HTTP over the VCN (`10.42.0.30` ↔ the socket box); dev: the Docker network (`http://worker:3003`, `http://websocket:3002`) | HMAC (kids `wk` / `ws`) | progress batches, kicks, live plies for prewarm | 1 s | per finish, per ply (prewarm, flag), per progress batch |
| E13 | worker → web `/api/internal/*`; websocket → web `/api/internal/tournaments/*` (P12) | HTTPS | HMAC (kids `wk`, `ws`) | account-purge steps that need Clerk or Dodo; tournament pairing, start, finalize | 10 s, job retries | rare |
| E14 | Dodo → web `/api/webhook/dodo-payments` | HTTPS | Standard Webhooks signature | subscription snapshot | provider retries | billing events |
| E15 | Clerk → web `/api/webhook/clerk` | HTTPS | Svix signature | `user.*`, `session.revoked` | provider retries | account events |
| E16 | Vercel Cron → web `/api/cron/daily` | HTTPS | `Authorization: Bearer $CRON_SECRET` | — | `maxDuration = 60` | daily 09:00 UTC |
| E17 | web → Anthropic | HTTPS streaming | workspace key `replay-<env>-web` | Messages API | SDK retries 2; 20 s first-sentence and 45 s total deadlines | coach |
| E18 | worker → Anthropic | HTTPS | workspace key `replay-<env>-worker` | Messages API, structured output; Batches for weekly summaries | SDK retries 2 | per analysed game, weekly |
| E19 | worker → Chess.com / Lichess | HTTPS, **one request at a time per provider** | none (Chess.com); Lichess token only during the initial import if P4 keeps it in memory (§2.3.2) | archives JSON, ndjson stream | Chess.com 20 s; Lichess stream idle 60 s; 429 → 60 s then exponential to 15 min | import jobs; also the web → worker Chess.com lookup fallback on 429/403 from Vercel's shared IPs |
| E20 | worker → Resend, web-push | HTTPS | API key; VAPID | email, push | 10 s, job retries | notifications |
| E21 | worker → R2; GitHub Actions → R2 (P1 interim backup) | S3 API | bucket-scoped Object R/W tokens | backups (age-encrypted), exports | multipart, retries | nightly, on demand |
| E22 | GitHub Actions → OCI | SSH (`deploy` user, key) + the signing CLI (`docker compose exec websocket node dist/cli/internal.js broadcast --in 30`, kid `ops`) | key | compose bundle | — | per deploy |
### 1.6 How the UI communicates with the backend

#### 1.6.1 Channels and when to use each

| Channel | Use it for | Never for | Implementation |
|---|---|---|---|
| **RSC loader** (server component calls a `server-only` service function) | First paint of every screen: viewer and shell, Home, Review, Train hub, Bank, Weakness, Profile, Games archive, settings | Anything after the first paint that the user triggers | `getViewer()` (React `cache()`), then `lib/data/*.ts` loaders; TanStack Query is seeded with `HydrationBoundary`, so the client does not refetch on mount |
| **JSON route handler** | Mutations; client refetch after a mutation or on focus; infinite lists; fallbacks while the socket is down; anything the socket server, worker, tests or k6 also call | Per-move traffic, matchmaking, progress polling while a socket is connected | `lib/api/route.ts` wrapper on the server, `lib/api/client.ts` + TanStack Query v5 on the client, shared zod contracts |
| **Socket.io v2** | Live games, matchmaking, tournament arena, and **per-user push** (`user:{ref}`): analysis and import progress, entitlement changes, due-card counts, notices, session revocation | Data that a page needs for first paint; anything a non-member could abuse to read data | One connection per tab via `RealtimeProvider`, connected lazily, reused across client navigations |
| **SSE over `fetch`** | Coach answers (sentence events after verification) | Anything bidirectional | `WEB/lib/sse.ts` parser + `AbortController`; resumable by message id |
| **Immutable CDN files** | Openings and legends catalogue JSON, puzzle shards, lesson audio, engine WASM (R2), share OG images | Per-user data | Content-hashed or versioned paths, `Cache-Control: public, max-age=31536000, immutable` |

**Rule of thumb for a new feature:** first paint is RSC; a user action is a route handler; something that changes without the user acting is a socket event (with an ETag-guarded HTTP fallback); a long model answer is SSE.

#### 1.6.2 Response envelope and error codes (shared by every new route)

- Success: `{ data, meta? }`. Lists return `meta.nextCursor`; counts (`meta.counts`, `meta.total`) only on page 1 or with `limit=0`, never on later pages (api-perf AP-38). HTTP status carries success.
- Error: `{ error: { code, message, details?, retryAfterSec?, requestId } }`. `details` holds zod issues as `[{ path, message }]` and registered `reason`s; it never contains `error.message` from an exception (`audit-api` F-12).
- The closed code list is the CR-18 ledger in `CT/http/codes.ts` (`ERROR_STATUS`; `codes.test.ts` asserts one status per code). Phases add codes and reasons there, never in route files.
- Every response carries `x-request-id` (set in middleware, echoed by the wrapper, tagged in Sentry), so the "Event ID" on `V3Error500` ties the browser, the route and the trace together.

#### 1.6.3 Client-side behaviour by status (installed once in `QueryProvider`)

| Status / code | Client reaction | Design state |
|---|---|---|
| 401 `unauthorized` | Outside a game: session-expired modal. In a game: silent `session.reload()`, retry once, then a chip | `V3SessionExpired` (modal, `in_game_refresh`) |
| 402 `subscription_required` `reason ∈ trial_available, trial_used` | `router.push(paywallUrl())` | `V3PaywallHard` / pricing `reason=required` |
| 402 `subscription_required` `reason ∈ expired, payment_failed, paused` | Renew sheet, or `/pricing?reason=ended`, depending on owner decision **B26** (lapsed read-only access; must be decided before P3, coverage C-21) | `V3PaymentFailed` `expired`, `V3PaywallSoft`, `V3CoachPaywall` |
| 402 `payment_update_required` | Link to the Dodo portal (`POST /api/billing/portal`) | `V3PaymentFailed` grace, last day |
| 426 `upgrade_required` | Show the update chip; deferred during a game | `V3PwaUpdate` (`in_game`) |
| 429 `rate_limited` / `fair_use_limit` | Typed error; inline countdown from `retryAfterSec`; mutations never auto-retry except the outbox | `V3RateLimited`, `V3CoachRateLimit` |
| 503 `maintenance` | Notice store; banner or page | `V3Maintenance` (`page`, `in_game`) |
| 5xx, network | Toast with Retry; queries retry twice with backoff | `V3Error500` (`retrying`, `failed_again`) |

#### 1.6.4 Version skew (PWA clients run old bundles)

- Every request sends **`x-rc-build: <git sha>`** (CR-22). The wrapper compares it with `MIN_CLIENT_BUILD` (an Edge Config value, §3.5.1). An older client gets 426 `upgrade_required` only for routes whose contract changed incompatibly, so most old clients keep working.
- API changes are additive by default: new optional fields, new endpoints. A breaking change gets a new path (`/api/v2/...`) or a version field, and is caught by the OpenAPI diff in CI (§5.3.1).
- The socket handshake carries `proto` and `build`. The server answers an unsupported `proto` with `connect_error { message: "upgrade_required" }`. The v1 handlers stay behind `proto` until the P2 parity gate and one release after it.
- Versioned payloads: journal records, job payloads, `jobs.progress`, SSE frames and JSON columns carry `v`; readers ignore an unknown newer `v` instead of crashing, so a rollback cannot brick a reader (§4.7).

#### 1.6.5 Realtime event catalogue (summary; schemas live in `CT/socket/registry.ts`)

| Event (server → client) | Room | Emitted by | Consumers |
|---|---|---|---|
| `game:snapshot`, `game:phase`, `study:ready`, `move:applied`, `clock:sync`, `presence:update`, `draw:offered\|declined\|cancelled`, `game:ended`, `game:result`, `rematch:*`, `spectators:update`, `game:error` | `game:{ref}` (spectators get a one-ply-late subset on `spectate:{ref}`) | websocket | game screen (55 `V3Game` states, P2 §4.3) |
| `server:restarting` | every game and spectate room | websocket (drain) | in-game restart chip |
| `session:hello {bootId, useq, serverNow}` | the connecting socket | websocket | reconnect resync decision (refetch only on a `bootId` change or a `useq` gap) |
| `queue:matched`, `queue:moved` | `user:{ref}` | websocket (P9) | `V3Queue`, `V3MatchFound` |
| `tournament:updated`, `tournament:search_ended` (+ P12's list) | `tournament:{slug}` and `user:{ref}` | websocket (P12) | tournament lobby and arena |
| `analysis:queued\|progress\|writing\|done\|failed` | `user:{whiteRef}`, `user:{blackRef}` | worker via `/internal/emit` | `V3ReviewAnalysing`, the game-over card, Home recent games. **`analysis:progress` only for jobs with priority ≥ `JOB_PRIORITY.GAME_ENDED`** (somebody is waiting); `analysis:done` carries `bank: { added, plies, due }` |
| `analysis:batch {done, total, bankAdded, bankDue}` | `user:{ref}` | worker, coalesced ≤ 1 per user per 60 s | backlog progress (no per-game events for backlog bands) |
| `import:progress {…, analysed}`, `import:finished` | `user:{ref}` | worker | Home `import_running`, onboarding done, Settings › Connected |
| `weakness:progress`, `weakness:ready` | `user:{ref}` | worker | `V3WeaknessComputing` |
| `bank:due_changed`, `mistakes:added` | `user:{ref}` | web (after grading, other tabs), worker (backfill only, ≤ 1 per 60 s) | nav badge, Train hub |
| `review:text_ready` | `user:{ref}` | worker (P7) | review and game-over coach line swap |
| `entitlement:changed` (DTO in the payload, `subscriptionUpdatedAt`) | `user:{ref}` | web (Dodo webhook) via websocket | `setQueryData`; `router.refresh()` only in the visible tab and only when the gate decision changes |
| `blocks:changed`, `presence:state`, `notify:new`, `export:ready` | `user:{ref}` | web / worker (P10) | profile, inbox, settings |
| `system:notice` (`restart`, `maintenance_scheduled`, `maintenance_active`, `resolved`) | all sockets | websocket, web (Edge Config change) | `V3Maintenance` banner, in-game chip |
| `session:revoked` | `user:{ref}` | web (Clerk `session.revoked` webhook) | `V3SessionExpired` |

Every game-room event carries a per-room `seq`, and every user-room event carries the per-user `useq`, so a client that sees a gap fetches a snapshot. The socket server drops an emit early when the target room has no sockets.

#### 1.6.6 Caching tiers (declared per route in the wrapper; CR-20)

| Tier | Header | Applies to | Invalidation |
|---|---|---|---|
| `public-immutable` | `public, max-age=31536000, immutable` | content-hashed or versioned URLs: engine files, puzzle shards, lesson audio, catalogue JSON snapshots | new URL |
| `public-static` | `public, s-maxage=86400, stale-while-revalidate=604800` (pages: ISR) | catalogues, legends, openings, lessons metadata, How we grade, the weakness baseline table, `GET /api/openings` (P1 A4 becomes `auth: "public"`, tag `openings`) | `revalidateTag()` / `invalidateByTag()` from admin writes |
| `public-short` | `public, s-maxage=60` | public projections that change often: `GET /api/players/{u}` (public part only), public search, tournament lists (P12) | TTL; tag purge on edits |
| `private-etag` | `private, no-cache` + **strong** `ETag`; 304 costs one probe statement or none | `/api/me`, due counts, analysis status, a completed review, membership, coach threads, practice context, legend comparison | socket events invalidate or patch the query cache; the ETag comes from a version column (`gamesVersion`, `statsVersion`, `bankVersion`, `analysisVersion`) where one exists |
| `no-store` | `private, no-store` | mutations, `/me` sub-resources with per-viewer bits (`/api/players/{u}/me`), downloads (`Content-Disposition: attachment`: PGN, invoice, export), live snapshots | — |
| `sse` | `text/event-stream`, `no-cache, no-transform` | coach streams | — |

Rules: a `public-*` tier only with `auth: "public"` and no session read (the wrapper throws at module load otherwise, and a registry test fails any non-public route that declares one); no per-user response has `max-age > 0`; `(app)` documents stay `private, no-store` so Back after sign-out does not restore another user's page from bfcache; OG images are served only through shares (`/r/{code}/opengraph-image?v=…`, `public, max-age=3600` for browsers, `s-maxage=31536000` + `Vercel-Cache-Tag: share:{code}` for the CDN, purged on revoke). The service worker never caches `/api/*` (`NetworkOnly`); its page cache is per user (`rc-pages:u:<ref>`) and is skipped when no Clerk session cookie is present. Sign-out clears the browser HTTP cache with `Clear-Site-Data: "cache"` (CR-21).

#### 1.6.7 API performance architecture (how the APIs are kept fast and cheap)

| Lever | Rule | Effect |
|---|---|---|
| Push, not poll | Matchmaking, arena pairing, analysis, import and entitlement progress arrive over the socket. HTTP polling is only a fallback (backoff, `If-None-Match`, visible tabs only, stops after `stopAfterMs` and when the socket reconnects; the badge fallback is on focus or ≥ 10 min, never 5 min) | Removes the 1 Hz `match-status` loop (`WEB/lib/hooks/useMatchmaking.ts:30`) and the 2–4 s `find-match` loop: about 60 invocations and 400 queries per searching minute (`audit-api` §5.3) |
| RSC first, same code path | Pages call service functions directly; no internal HTTP hop. Route handlers wrap the same functions | One code path, no double fetch, no spinner chain (`audit-client` #14) |
| One query budget per screen | Each screen's first paint has a statement budget recorded in its phase spec §9.2 and checked by an integration test that counts statements | No N+1; no surprise waterfalls |
| Region pinning | Vercel `iad1` next to Neon `us-east-1`; OCI writes batched because of the ~200 ms Mumbai RTT | ~1–2 ms per query from Vercel |
| Batch from OCI | The socket server checkpoints at most 10 times per game and finishes in one CTE; the worker writes one HTTP batch per analysed game (set-based statements, no `RETURNING` hand-off) and one multi-row upsert per import chunk | 80 single-statement writes would be 16 s of RTT per game (`audit-db` §5.3) |
| Lean payloads | Packed analysis, `move:applied` ≤ 200 B (no `fen`), explicit `select` everywhere, cursor pagination capped at 50, counts on page 1 only | Smaller bytes on Neon egress (5 GB a month on Free) and on phones |
| Conditional requests | Strong ETags on `private-etag` routes, computed from version columns already on the viewer row | Focus refetches are nearly free |
| Idempotency and optimism | `Idempotency-Key` on creates (games, imports, checkout, coach `clientId`), `clientAttemptId` on grades; the UI advances optimistically (draw/rematch offers, ready, Sync now) | Safe retries; no double charges or double games |
| GET purity | GETs never enqueue or call providers (CR-24) | No engine work or Dodo calls from prefetches and focus refetches |
| Cold-start discipline | Heavy SDKs only in their routes (Anthropic only in coach, Dodo only in billing); TanStack Query and `api()` not in the marketing layouts | Smaller functions and bundles |
| Neon wake discipline | No timer touches Neon (CR-10); crawlers hit ISR or the CDN; scanners get a 404 from middleware without Clerk | Fixed wakes: 1 a day |
| Rate limits where they pay | P1 fixed window; burst windows in the UNLOGGED table, long windows durable (CR-19); Vercel Firewall rules (3 on Hobby) for anonymous public routes; `EDGE_DOC_LIMIT` on `/api/openings*` and `/api/positions*` until a Firewall rule exists | No limiter on hot paths; no reset on scale-to-zero |

Latency targets (p95, warm): `GET /api/me` ≤ 150 ms; review read ≤ 250 ms; train attempt write ≤ 200 ms (≤ 300 ms while an analysis of the same user commits); RSC TTFB for `/home`, `/train`, `/review/[ref]` ≤ 400 ms; coach first verified sentence ≤ 4 s; socket move round trip (receive → broadcast) ≤ 50 ms on the box, ≤ 150 ms as seen by k6. How each is measured, without depending on analytics consent, is in 05-optimization §2 (server-side truth first; PostHog keeps funnels, not SLOs).
### 1.7 Key flows

#### 1.7.1 App boot (signed-in member, any `(app)` route)

```
Browser ──GET /home──► middleware (edge): Clerk JWT verify (no network), claims {rc:{ent,onb,role}}
                       ├─ not signed in → redirectToSignIn
                       ├─ !onb → /onboarding?redirect_url=… ; !ent → /pricing?reason=required (allowlist §3.1.4)
                       └─ sets x-request-id, CSP nonce
        ◄── RSC: (app)/layout.tsx → getViewer() = 1 indexed select (users by clerk id, entitlement cols, prefs, flags)
                 → ShellState + socket token (signed in-process, no extra request) + PostHog bootstrap flags
                 → page loader(s) in Promise.all → HTML streamed with Suspense skeletons (V3Skeletons)
Browser: RealtimeProvider connects lazily (first subscriber) → WSS handshake {token, proto:2, build}
```

Cost per boot: 1 function invocation, 1–6 queries, 0 third-party calls. Today it is 3–5 invocations, 1 Clerk Backend call, 1–2 Dodo calls and 2 writes (`audit-api` §5.1).

#### 1.7.2 Live game finishes → analysis → review

```
websocket: game ends (mate/flag/resign/draw…) → emits game:ended to game:{ref} at once
   → finishGame() (DB/src/live/finish.ts): ONE data-modifying CTE, idempotent on status:
     UPDATE games SET status='COMPLETED', "endMethod", outcome, moves, "moveClocksMs", "plyCount", fen, pgn,
                      "completedAt" … WHERE id=$1 AND status='IN_PROGRESS'
     UPDATE game_players SET result, "endedAt"=$endedAt (P9 fragment: ratings; P12 fragment: tournament points)
     UPDATE users SET "gamesVersion" = "gamesVersion" + 1 (both members), stats
     INSERT INTO jobs (kind 'ANALYZE_GAME', priority JOB_PRIORITY.GAME_ENDED, "dedupeKey" 'analyze:<gameId>')
       ON CONFLICT DO NOTHING
   → game:result; POST /internal/analysis/kick (HMAC, kid ws)
worker: claim (SKIP LOCKED) → load game → per position: eval cache hit? (prewarmed during play) else
        stockfish `go nodes 120000` MultiPV 2 → classify (CA) → every 2 plies or 300 ms, ONLY for priority ≥ 80:
        POST /internal/emit {targets:[{userRef:white},{userRef:black}], event:'analysis:progress', data}
      → pass 2 (1M nodes MultiPV 3) on ≤ 6 candidates → template review text → P5 J1 bank rows
      → ONE Neon HTTP batch (sql.transaction([...])): game_analyses, player_reviews, mistakes (set-based, natural
        keys), mistake_occurrences, training_cards (BANK), games."analysisStatus"='DONE', users."gamesVersion"+1
      → analysis:done {gameRef, analysisVersion, bank:{added, plies, due}}; for priority ≥ 80 also enqueue REVIEW_TEXT
Browser (V3ReviewAnalysing): badges from progress deltas → on done: GET /api/review/[ref] (private-etag)
        → auto-advance to V3ReviewSummary. Socket down: GET /api/review/[ref]/status with If-None-Match on a
        fallback interval (visible tab, stops after 3 min). The game-over card shows the coach line (P3 template,
        P7 swap on review:text_ready) and the Mistake Bank line (P5, from analysis:done.bank).
```

Backlog games (imports at `IMPORT_NEWEST`/`BACKLOG`) send no per-game progress: the worker emits one coalesced `analysis:batch` per user at most every 60 s, and `import:progress` carries `analysed` (api-perf AP-10).
#### 1.7.3 Bot or legend-practice game (client-run)

`POST /api/games {mode:"bot" or "legend_bot", …}` (Idempotency-Key) creates the row (untimed practice from a position is not saved, `inv-play-b` §3.3) and returns the snapshot. The browser runs chess.js and Stockfish WASM, autosaves to `localStorage` (`rc:bot:<ref>`), checkpoints with `sendBeacon('/api/games/<ref>/checkpoint')` on `pagehide`, and finishes with `POST /api/games/<ref>/complete {pgn}`. The route replays the PGN from the stored start FEN with chess.js, rejects illegal games (422), stores moves and result with `rated = false`, and enqueues `ANALYZE_GAME` at `JOB_PRIORITY.GAME_ENDED` (`inv-play-b` §3.3; adjudication rules in P2 §7.1.4). Two Vercel invocations per game plus beacons.

#### 1.7.4 Import (Chess.com example)

```
POST /api/accounts/chesscom {handle}  → validate ^[A-Za-z0-9_-]{3,25}$, upsert linked_accounts + import_runs,
   INSERT jobs (IMPORT_SYNC, JOB_PRIORITY.IMPORT_SYNC_INITIAL, dedupeKey 'import:<accountId>:initial')
   → after(): POST /internal/analysis/kick
   (the web-side profile lookup falls back to the worker on 429/403 from Vercel's shared egress IPs, §2.3.2)
worker IMPORT_SYNC: provider gate (one Chess.com request at a time, process-wide) →
   GET /pub/player/{u}/games/archives (If-None-Match) → each new or current month, newest first:
   GET /pub/player/{u}/games/{YYYY}/{MM} (If-None-Match, UA with contact) → parse →
   INSERT INTO games … ON CONFLICT (source, "externalId") DO UPDATE SET … RETURNING id, (xmax = 0) AS created
   (an opponent's earlier import of the same game must still produce this member's game_players row, P4 §8)
   → INSERT game_players … ON CONFLICT DO NOTHING (100-game chunks) → users."gamesVersion"+1 → import:progress
   → enqueue ANALYZE_GAME: newest at JOB_PRIORITY.IMPORT_NEWEST, the rest at BACKLOG (fairSeq interleaves users)
   → import_cursors (etag, lastModified, lastGameAt) → import:finished → enqueue the next daily sync row
```

Imports run only for entitled users; a non-member's run waits in `WAITING_FOR_MEMBERSHIP` and the Dodo webhook releases it. Capacity rule recommended to P4 (feasibility F-OCI-3): trialists get their newest 20 games analysed eagerly and the rest when opened; after the first paid charge the backlog is released at `BACKLOG` priority, spread over 7 days.

#### 1.7.5 Coach question (SSE)

```
Browser POST /api/coach/messages {threadRef?, context:{scope:'game', gameRef}, ply, text, clientId}
web (Node, maxDuration 60, supportsCancellation: true):
  route wrapper: member; participant of gameRef; burst 5 per 60 s (burst store)
  1. quota READ (CT/limits.ts COACH_LIMITS; trial caps for trialists) → 429 fair_use_limit
  2. ONE statement that must COMPLETE before any model call: insert the user message
     ON CONFLICT ("userId","clientId") DO NOTHING, plus the one-in-flight partial unique index → 409 in_flight
     (a double tap or a retry after a dropped response can never start two paid calls)
  3. load facts: game_analyses (PK) + player_reviews + thread tail (20) → CoachContext (words, not numbers)
  4. anthropic.messages.stream(claude-sonnet-5-5, tools, system, game facts, question)
       tool_use analyse_position / play_moves → POST /engine/analyse (HMAC, 2.5 s) → tool_result
       text deltas → sentence splitter → verifier (CA/verify) → SSE `sentence` (verified only)
       failure → regenerate once (SSE `retract`) → else SSE `fallback` (engine line, no VERIFIED tag)
       first verified sentence by 20 s, whole answer by 45 s, `: ping` every 15 s
  5. persist the assistant message (+ tokens, cache reads, cost, firstSentenceMs) → charge at `done` → SSE `done {quota}`
Stop: the client aborts the fetch AND sends navigator.sendBeacon('/api/coach/messages/{ref}/stop') (sets ABORTING;
  the stream loop checks it with its mid-stream UPDATE). With supportsCancellation, request.signal fires → upstream
  aborted ≤ 200 ms → status ABORTED; cost is always recorded, an abort is not counted against the question quota (P7 D5).
```

#### 1.7.6 Checkout with the 7-day trial

```
POST /api/checkout {plan, returnPath, source} → trial-eligible? (users.trialStartedAt null AND no trial_ledger hit)
   → dodo.checkoutSessions.create({…, subscription_data:{trial_period_days:7}}) → {checkoutUrl}
Browser → Dodo hosted checkout → /checkout/activating (V3CheckoutActivating)
Dodo → POST /api/webhook/dodo-payments: verify signature → INSERT webhook_events(provider,'dodo',webhook-id)
   ON CONFLICT DO NOTHING (duplicate → 200) → applySubscriptionSnapshot(user, snap, {eventTime}):
     UPDATE users SET … , "subscriptionSourceAt" = $eventTime, "subscriptionUpdatedAt" = now()
     WHERE id = $id AND ("subscriptionSourceAt" IS NULL OR "subscriptionSourceAt" <= $eventTime)
       AND ROW(status, periodEnd, cancelAtPeriodEnd, plan, interval) IS DISTINCT FROM ROW($…)   (CR-25, P1 F4b)
   → syncClerkClaims (publicMetadata.rc.ent, entUntil) → after(): POST /internal/emit entitlement:changed
   → first trialing snapshot: set trialStartedAt/trialEndsAt; P10: enqueue the TRIAL_ENDING notification
     (NOTIFY_DISPATCH, runAt = trialEndsAt − 48 h, dedupeKey 'trial-reminder:<subscriptionId>') → kick
   → release WAITING_FOR_MEMBERSHIP imports
Activating page: listens for entitlement:changed; fallback GET /api/billing/activation 2 s → 4 s → 8 s (its Dodo
   call is rate-limited and writes only a newer snapshot); `rc_act` cookie (HMAC, 120 s) bridges the claim refresh.
API-sourced snapshots (activation, POST /api/billing/refresh, the daily reconcile) use Dodo's own updated_at as
   $eventTime, never now(), so a later webhook is never mistaken for a stale one.
```

#### 1.7.7 Training grade

The runner validates moves locally against the stored solution, advances immediately, and posts `POST /api/train/attempts {attempts:[{clientAttemptId, cardRef, grade, elapsedMs, hintsUsed, reviewedAt}]}` with `keepalive: true` from the IndexedDB outbox `rc-outbox` (key `u:<userRef>:attempts`). The route runs one set-based statement batch (conditional card update on `reps`, attempt insert `ON CONFLICT (clientAttemptId) DO NOTHING`, day and mastery upserts) and returns small patches (next interval, streak). Other tabs receive `bank:due_changed`. P5 §7.3 has the exact statements and the lock-contention test against a concurrent analysis commit.
#### 1.7.8 Account deletion

`DELETE /api/me {confirm}` with Clerk step-up reverification → one transaction (trial ledger hash, `account_deletions` outbox row, anonymise shared games to the `DELETED_USER` row, delete private rows, delete the user) → `ACCOUNT_PURGE` job → external steps with per-step state (§2.3.8, §3.3.4).

### 1.8 The OCI boxes: topology and CPU budget

#### 1.8.1 Containers and routes

**Dev box** (80.225.200.210, 1 OCPU / 6 GB): `deploy/oci/docker-compose.yml` runs websocket, caddy and worker.

```yaml
# deploy/oci/docker-compose.yml (dev box)
services:
  websocket:
    image: ${WS_IMAGE}
    env_file: .env.websocket
    environment: [NODE_ENV=production, PORT=3002, NODE_OPTIONS=--max-old-space-size=1024]
    cpu_shares: 1024              # cgroup v2 weight ≈ 39
    mem_limit: 1536m
    stop_grace_period: 45s        # drain → flush journal → io.close()
    volumes: [journal:/data/journal]
    healthcheck: { test: ["CMD","wget","-q","--spider","http://127.0.0.1:3002/ready"], interval: 15s, retries: 3, start_period: 20s }
    restart: unless-stopped
  worker:
    image: ${WORKER_IMAGE}
    env_file: .env.worker
    environment: [NODE_ENV=production, PORT=3003, ENGINE_THREADS=1, ENGINE_HASH_MB=64, ENGINE_POOL=1, BACKUP_ENABLED=false]
    cgroup_parent: worker-idle.slice   # systemd slice with CPUWeight=idle → cpu.idle=1 (§1.8.2)
    cpus: "0.75"                  # CFS quota
    mem_limit: 2048m
    stop_grace_period: 30s        # finish the current position, checkpoint, release the job
    volumes: [evalcache:/data/evalcache, tmp:/data/tmp]
    healthcheck: { test: ["CMD","wget","-q","--spider","http://127.0.0.1:3003/ready"], interval: 30s, retries: 3 }
    restart: unless-stopped
  caddy:
    image: caddy:2-alpine@sha256:<pinned>
    cpu_shares: 512
    mem_limit: 128m
    ports: ["80:80", "443:443", "443:443/udp"]
    volumes: [./Caddyfile:/etc/caddy/Caddyfile:ro, caddy_data:/data, caddy_config:/config]
volumes: { journal: {}, evalcache: {}, tmp: {}, caddy_data: {}, caddy_config: {} }
```

**Production** (P13 D7): the socket box (132.226.190.10, 1 OCPU / 6 GB) runs `deploy/oci/docker-compose.yml` with websocket + caddy only; the worker VM (`10.42.0.30`, 2 OCPU / 12 GB, `ENGINE_POOL=2`, `BACKUP_ENABLED=true`) runs `deploy/oci/worker/docker-compose.yml` with the worker alone. The worker listens only on the VCN; the security list allows 3003 from the socket box only.

```
# deploy/oci/Caddyfile (target; {$WORKER_UPSTREAM} = worker:3003 on dev, 10.42.0.30:3003 on prod)
{$WS_HOST} {
  request_body { max_size 64KB }
  @unsigned { path /internal/* /engine/*
              not header X-Rc-Sig * }
  handle @unsigned { respond 401 }                          # unsigned junk never reaches Node (feasibility SEC-8)
  @blocked path /internal/broadcast /internal/drain /internal/metrics
  handle @blocked { respond 404 }                           # reachable only via docker compose exec + the signing CLI
  @socket path /socket.io/*
  handle @socket { reverse_proxy websocket:3002 }
  @wsInternal path /internal/emit /internal/tournament-event
  handle @wsInternal { reverse_proxy websocket:3002 }       # HMAC + kid allow-list checked in the app
  @worker path /engine/* /internal/analysis/* /internal/live/* /internal/provider/*
  handle @worker { reverse_proxy {$WORKER_UPSTREAM} }       # HMAC checked in the app
  @health path /health /ready
  handle @health { reverse_proxy websocket:3002 }
  handle { respond 404 }
}
```

Today every path is proxied to the socket server (`deploy/oci/Caddyfile:7-9`), which is how `/internal/tournament-event` became public (`audit-socket` F-06). The allowlist above closes that class of bug. `/internal/tournament-event` is a legacy alias until P12.

#### 1.8.2 Dev box CPU budget (co-location)

An A1 OCPU is one physical Ampere core with no SMT.

| Consumer | CPU policy | Expected CPU | Memory |
|---|---|---|---|
| websocket | cgroup weight ≈ 39 (`cpu_shares` 1024), uncapped | 2–10 % at dev scale | ≤ 1.5 GB |
| caddy | weight ≈ 20 (512) | TLS for sockets, < 3 % | 128 MB |
| worker orchestrator (Node) + stockfish child | inside `worker-idle.slice` (`CPUWeight=idle` → `cpu.idle=1`, systemd ≥ 252, kernel ≥ 5.15; Ubuntu 24.04 has systemd 255 and kernel 6.8), container cap 0.75 | whatever is left, at most 0.75 of the core | ≈ 400 MB + 64 MB hash |
| eval cache (SQLite file) | — | — | page cache, file capped at 4 GB on `/data/evalcache` |
| OS, Docker, sshd, unattended upgrades | — | — | ≈ 700 MB |
| **Total** | | | ≈ 3.5–4.5 GB of 6 GB |

**Why the clocks stay safe.** Under cgroup v2, CPU is first shared between container cgroups by `cpu.weight`; a task's own `SCHED_IDLE` policy only orders tasks *inside* its cgroup, so revision 1's "weight 3 against 1024" reasoning described the wrong mechanism (feasibility F-OCI-2). The protection is the slice: a cgroup with `cpu.idle=1` gets CPU only when no non-idle cgroup wants it, and a waking socket event preempts it at once. The CFS cap (`cpus: 0.75`) keeps a quarter of every 100 ms period free for TLS and GC bursts. Verify on the box: `cat /sys/fs/cgroup/worker-idle.slice/cpu.idle` → `1` [V1], then run the k6 `ws-ramp-colocated` scenario with a backfill running and watch `ws.loop_lag_ms` p99 (P3 R3 tests this, not the scheduler weight). Fallback if the slice cannot be made to work: `cpus: "0.5"` with `nice 10`.

**Belt and braces: the lag pause.** The worker reads `GET http://websocket:3002/internal/load` (Docker network, no Neon) once a second: `{loopLagP99Ms, liveGames, sockets, draining}`. Between positions it waits while `loopLagP99Ms > 40` or `draining = true`, and drops live prewarm work while `liveGames > PREWARM_MAX_GAMES` (default 30). Searches are bounded by nodes, so a pause changes wall time but never the result.

The dev box is also where one-off engine work runs: `stockfish bench` for each new image, the bot-strength calibration and eval-cache seeding experiments.

**Interactive lane.** Coach tool calls (`/engine/analyse`, ≤ 400k nodes, MultiPV ≤ 3) jump ahead of batch work at the next position boundary, so they wait at most one batch search plus their own search (≤ 0.7 s). Results go into the eval cache and an in-memory LRU of about 3,000 positions.

#### 1.8.3 Production worker VM and capacity (Stage C is paid)

- Shape: A1 Flex 2 OCPU / 12 GB in ap-mumbai-1 (P13 D7). Free-tier arithmetic: prod socket 1 OCPU + worker 2 OCPU + dev 1 OCPU = **4/4 OCPU**, 24 GB, boot volumes 3 × 50 GB of the 200 GB. Nothing on Oracle costs money, but nothing more is free either. Creating the VM may hit "out of host capacity"; P13 retries off-peak for up to 48 h. Option [OD]: create it in P3 while capacity exists and run the **dev** worker there until P13 (honest clock tests on the dev socket box, at the cost of a dev/prod VM swap at launch).
- Layout: `ENGINE_POOL=2` (two Stockfish processes, `Threads=1` each, so results stay deterministic); one I/O lane loop.
- **Stage C (paid, owner decision D3).** Triggers (any one, sustained 3 days): queue wait p95 for priority ≥ `GAME_ENDED` above 120 s; backlog (priority ≤ `IMPORT_NEWEST`) older than 24 h; worker CPU throttled more than 50 % of periods at peak. Cheaper levers first: lower the eager backfill (trialists newest 20), skip pass 1 for Lichess games that carry `%eval`, turn prewarm off, P3-D9's 80k pass-1 fallback. Paid options: OCI PAYG A1 1 OCPU / 6 GB ≈ $14 a month [V7]. CLAUDE.md says nothing on Oracle should cost money, so any spend is the owner's call.

#### 1.8.4 Idle reclamation and the tenancy

Oracle may reclaim Always Free instances that stay idle for 7 days (95th-percentile CPU under 20 %, with network and memory also low for A1) [V]. A quiet dev box qualifies. **P1 owner task:** upgrade the tenancy to Pay-As-You-Go with a $1 budget alert and compartment quotas capping A1 at 4 OCPU / 24 GB (Always Free resources stay free; the quota makes an accidental paid shape impossible). Add an UptimeRobot monitor on `wss://ws-dev…/health` in P1 so a reclaimed box is noticed the same day (`audit-socket` F-17). Keep `deploy/oci/setup-server.sh` able to rebuild a box in under 30 minutes. Do not burn CPU on purpose to dodge the rule.

#### 1.8.5 Hardening

SSH key-only for `deploy` (no passwords, no root login), security list open on 22/80/443 only (plus 3003 from the socket box to the worker VM), `unattended-upgrades`, Docker log rotation (10 MB × 3), `.env.*` files mode 600, images pinned by digest, no database credentials in the compose file. The legacy EC2, nginx and Docker Hub artefacts in `WS/deploy/*` and `WS/docker-compose.yml` are deleted (`audit-socket` F-35).

### 1.9 Analysis worker internals

#### 1.9.1 Modules (`apps/analysis-worker/src/`)

| Module | Responsibility |
|---|---|
| `index.ts` | Boot: read config (`APP_ENV` required), open the DB pool (2 connections, `pool.on('error')`, `idleTimeoutMillis: 60_000`), start HTTP, run the reaper, ensure today's `HOUSEKEEPING` row exists, read `min("runAt")`, start the drain loop, handle `SIGTERM` |
| `http/server.ts` (Fastify) | `POST /internal/analysis/kick`, `POST /internal/live/ply` (prewarm, flag `analysis-live-prewarm`), `POST /engine/analyse`, `POST /internal/provider/chesscom/lookup` (the web lookup fallback), `GET /health`, `GET /ready`, `GET /internal/metrics`; HMAC verification and kid allow-lists from `CT/internal/auth.ts` |
| `queue/claim.ts`, `queue/heartbeat.ts`, `queue/complete.ts`, `queue/reaper.ts` | §1.10 |
| `scheduler/timer.ts` | The next-due timer: holds `nextRunAt` in memory (set by kicks that carry `runAt` and by the `min("runAt")` read at the end of each drain); arms one `setTimeout` capped at 24 h; **sends no query while idle** |
| `scheduler/recurring/<kind>.ts` (one file per recurring kind) | `DAILY_PLAN` inserts the next 26 h of rows; each recurring handler enqueues its successor in its final batch |
| `engine/uci.ts`, `engine/pool.ts`, `engine/profile.ts` | UCI driver, process pool with batch and interactive lanes, the P3-D9 profile |
| `cache/evalCache.ts` | SQLite store (`better-sqlite3`, fallback `node:sqlite`) keyed by `engineId:nodes:multipv:epd` (§1.9.3) |
| `handlers/<kind>.ts` | One file per job kind (§2.2) |
| `importers/chesscom.ts`, `importers/lichess.ts`, `importers/providerGate.ts` | Provider clients and the one-request-at-a-time gate with 429 back-off |
| `llm/client.ts`, `llm/reviewText.ts`, `llm/batch.ts` | Anthropic SDK client (worker key), structured review text, weekly summaries through Message Batches |
| `notify/socket.ts` | `POST /internal/emit` (CR-15) with batching (300 ms) and the priority-band rule (`analysis:progress` only for priority ≥ `GAME_ENDED`; `analysis:batch` ≤ 1 per user per 60 s) |
| `notify/email.ts`, `notify/push.ts` | Resend and `web-push` |
| `backup/pgdump.ts` | `pg_dump --format=custom` → `age` → R2 multipart (§2.3.9); disabled when `BACKUP_ENABLED=false` (dev) |

`WK/NOTICE` records the Stockfish source tag and NNUE hash (LIC-3). Grading and classifier constants come from documentation and the research notes under the clean-room rule in `packages/*/CLEANROOM.md`; nobody implementing them opens AGPL source (lila, lichess-puzzler) during the work, and CI runs `license-checker --failOn "AGPL;GPL"` over production npm dependencies with `stockfish` allow-listed as a separate asset (LIC-4).

#### 1.9.2 Engine build and identity

- `WK/Dockerfile` stage 1 builds Stockfish from the pinned tag (`sf_18`, or the exact release the WASM build matches) with `make -j profile-build ARCH=armv8-dotprod COMP=gcc` on the GitHub `ubuntu-24.04-arm` runner (free for a public repo [V11]; Ampere Altra supports dot-product instructions [V: `lscpu` flags on the box]). The NNUE network is embedded; its SHA-256 is recorded at build.
- Stage 2: `node:24-bookworm-slim` with `age` and `postgresql-client-17` from the PGDG apt repository (for `pg_dump`; it must match the server major version).
- `engineId = "sf18-armv8dp-<net8>"` and the profile id from P3-D9 are stored on every `GameAnalysis` with `classifierVersion` from `CA`.
- `stockfish bench` runs on the dev box after each new image reaches dev (never on the prod worker during the day); the worker reports nodes per second of real searches (`worker.engine.nps`), the input to the throughput maths below.

#### 1.9.3 Determinism and the eval cache

- Every position search starts clean: `ucinewgame`, `isready`, `position fen <FEN after the last irreversible move> moves <plies since then>` (so repetition history is present), `go nodes N`, `Threads=1`, `Hash=64`. Same input, same output.
- Cache key: `engineId:nodes:multipv:epd`, value `{cpWhite?, mateWhite?, bestUci, pvUci, depth}`; evals stored from White's point of view.
- **Bypass the cache** when the position is repetition-sensitive: the same EPD occurred earlier in the game, or the half-move clock is 90 or more.
- **Determinism caveat (testing X13):** with the cache on and one `ucinewgame` per game, hash contents depend on search order, and a resumed run starts cold. Goldens therefore run with `EVAL_CACHE=off`, a fresh engine process per game, `Threads 1` and no resume; a nightly label-stability check runs the same 10 games warm and with a forced crash and resume at ply 20 (labels identical on ≥ 98 % of plies and every key moment, accuracy within ±0.5). If it fails, graded positions bypass the cache.
- Size cap 4 GB, LRU eviction by `lastHitAt`. The cache is per box and costs nothing in Neon.

#### 1.9.4 Passes (P3-D9; the C1 bench may change the node counts, not the structure)

| Pass | Positions | Budget | When |
|---|---|---|---|
| Prewarm (optional, flag `analysis-live-prewarm`) | each new position of a live socket game, posted to `/internal/live/ply` | pass-1 budget, eval cache only | during play, only when the batch lane is idle and `liveGames ≤ PREWARM_MAX_GAMES`; results are never sent to clients |
| 1 | every ply from `startPly` (legend prefixes are not analysed) | 120k nodes, MultiPV 2 | after the game; mostly cache hits when prewarmed |
| 2 | at most 6: the member's inaccuracy/mistake/blunder/miss candidates and brilliant/great candidates | 1M nodes (more for mate lines), MultiPV 3 | after pass 1; runs the puzzle-uniqueness test and builds lines |
| Review text | summary and moment captions: template in P3, Haiku in P7 (`REVIEW_TEXT`, I/O lane) | ≈ 1.5k in / 400 out tokens | eagerly for games at priority ≥ `GAME_ENDED`; lazily on first page open for imported games |

Games that already carry Lichess `%eval` skip pass 1 but still run the classifier and pass 2.

#### 1.9.5 Throughput (re-computed from the measured `nps` after the C1 bench)

`games per hour = 3600 × nps_effective × lanes / nodes_per_game`. For an 80-ply game: pass 1 = 80 × 120k = 9.6M nodes, pass 2 ≈ 6 × 1M = 6M, total ≈ 16M nodes.

| Assumption | Dev box (0.75 core, 1 lane) | Prod worker VM (2 cores, 2 lanes) |
|---|---|---|
| Single-thread NNUE on one A1 core | 0.6–1.0 Mnps [V: bench] | same per process |
| Effective nps per lane | 0.45–0.75 M | 0.6–1.0 M |
| Seconds per 80-ply game, cold | 21–36 s | 16–27 s, two games at once |
| Games per hour | 100–170 | 270–450 |
| Time to summary after a socket game, prewarmed (pass 2 + text) | ≈ 10–15 s | ≈ 7–11 s |

**Per-member backfill cost (feasibility F-OCI-3).** One new member's eager backfill under P4 D4-09 (newest 50 plus the next 150) is ≈ 200 × 16–27 s ≈ 0.9–1.5 lane-hours, about half an hour of the whole prod worker. At 20 sign-ups a day that is 10–15 worker-hours a day before any played games, so the worker saturates around 30–40 sign-ups a day with no free headroom left. Hence the trialist rule in §1.7.4 and the Stage C triggers in §1.8.3. The design copy "Badges and the coach appear as each move is graded, usually in under 10 seconds" (`V3ReviewSummary`) holds for prewarmed socket games; imported and bot games start cold, and the analysing screen shows real progress.

#### 1.9.6 Failure and resume

- The worker checkpoints graded plies and pass-1 results into `jobs.progress` (with `v`) every 10 plies, so a crash resumes where it stopped. An older worker image claims only the kinds it knows and restarts a job whose `progress.v` is newer.
- Engine crash or `bestmove` missing within 10 s → restart the process, retry the position once, then fail the job with `ENGINE_FAILED`.
- Retries: attempts 1–3 with back-off 30 s, 2 min, 10 min; the fourth failure is terminal (`analysis:failed {retryable:false}`, `V3ReviewFailed`). A member's "Retry" (`POST /api/review/[ref]/analyse`) re-enqueues with `attempts = 0` at `JOB_PRIORITY.USER_OPENED`.
- `SIGTERM`: stop claiming, finish the current position, checkpoint, set the job back to `QUEUED` with `runAt = now()`, exit within 30 s.

### 1.10 Job queue in Postgres

#### 1.10.1 Table (`jobs`; P3 owns the migration, 02-data-model §5 M3)

```prisma
enum JobKind {   // M3 CREATE TYPE; later values each in their own ADD VALUE file (CR-11)
  ANALYZE_GAME REVIEW_TEXT LEGEND_COMPARE IMPORT_SYNC IMPORT_PURGE RECOMPUTE_WEAKNESS
  EXPORT_BUILD ACCOUNT_PURGE DODO_CUSTOMER_SYNC HOUSEKEEPING DAILY_PLAN
  // m5a EXTRACT_MISTAKES · m10a MILESTONES_EVALUATE NOTIFY_DISPATCH NOTIFY_REMINDERS NOTIFY_WEEKLY
  // MEMBERSHIP_PAUSE_EDGE R2_SWEEP · m12a TOURNAMENT_STARTING · m13a BACKUP
}
enum JobStatus { QUEUED RUNNING DONE FAILED CANCELLED WAITING }
model Job {
  id          BigInt    @id @default(autoincrement())
  kind        JobKind
  status      JobStatus @default(QUEUED)
  priority    Int       @default(0) @db.SmallInt   // JOB_PRIORITY.* only (CR-9); higher runs first
  fairSeq     Int       @default(0)                 // per-user sequence inside a batch; interleaves users at equal priority
  userId      BigInt?                                // fairness, cancellation on account deletion, metrics
  dedupeKey   String?   @unique                      // 'analyze:<gameId>', 'trial-reminder:<subId>', 'cron:HOUSEKEEPING:2026-11-02'
  payload     Json                                   // zod-validated per kind with `v` (CT/internal/jobs.ts)
  progress    Json?                                  // checkpoint with `v`, for resume and the status endpoint
  runAt       DateTime  @default(now())
  lastKickAt  DateTime?                              // re-kick compare-and-set (CR-24)
  attempts    Int       @default(0) @db.SmallInt
  maxAttempts Int       @default(4) @db.SmallInt
  lockedBy    String?                                // '<env>-worker-<bootId>'
  lockedAt    DateTime?
  heartbeatAt DateTime?
  lastError   String?                                // code + short message, never PII
  createdAt   DateTime  @default(now())
  finishedAt  DateTime?
  @@map("jobs")
}
```

Fast-growing sets (`JobKind`, notification kinds, audit actions, report targets) may instead be `text` + a zod enum, with raw SQL using `kind = ANY($2::text[])`; that removes the enum rollback hazard (§4.7). P3 decides for `JobKind` in M3; whichever form ships, the two-release rule applies to Postgres enums.

Raw-SQL indexes in the migration (Prisma cannot express partial indexes; names go into `DB/prisma/protected-indexes.txt`):

```sql
CREATE INDEX jobs_ready_idx   ON jobs (priority DESC, "fairSeq", "runAt") WHERE status = 'QUEUED';
CREATE INDEX jobs_running_idx ON jobs ("heartbeatAt") WHERE status = 'RUNNING';
CREATE INDEX jobs_user_idx    ON jobs ("userId", kind) WHERE status IN ('QUEUED','RUNNING','WAITING');
```

#### 1.10.2 Claim, heartbeat, complete

```sql
-- claim (one statement, safe through PgBouncer transaction mode)
UPDATE jobs SET status='RUNNING', "lockedBy"=$1, "lockedAt"=now(), "heartbeatAt"=now(), attempts=attempts+1
WHERE id = (
  SELECT id FROM jobs
  WHERE status='QUEUED' AND "runAt" <= now() AND kind = ANY($2::"JobKind"[])
  ORDER BY priority DESC, "fairSeq", "runAt"
  LIMIT 1 FOR UPDATE SKIP LOCKED)
RETURNING id, kind, payload, progress, attempts, "userId";

-- heartbeat every 30 s while running
UPDATE jobs SET "heartbeatAt"=now(), progress=$2 WHERE id=$1 AND "lockedBy"=$3;

-- complete or fail
UPDATE jobs SET status='DONE', "finishedAt"=now(), progress=$2 WHERE id=$1 AND "lockedBy"=$3;
UPDATE jobs SET status = CASE WHEN attempts >= "maxAttempts" THEN 'FAILED' ELSE 'QUEUED' END,
       "runAt" = now() + ($4 * interval '1 second'), "lastError"=$2, "lockedBy"=NULL
WHERE id=$1 AND "lockedBy"=$3;

-- end of a drain, in the same round trip as the last write: arm the next-due timer
SELECT min("runAt") FROM jobs WHERE status='QUEUED';

-- reaper (at worker boot and at the end of each drain; no timer)
UPDATE jobs SET status='QUEUED', "lockedBy"=NULL, "runAt"=now()
WHERE status='RUNNING' AND "heartbeatAt" < now() - interval '3 minutes';

-- re-kick compare-and-set (web, from status reads; at most one kick per job per 30 s however many tabs poll)
UPDATE jobs SET "lastKickAt" = now()
WHERE "dedupeKey" = $k AND status = 'QUEUED' AND "runAt" < now() - interval '30 seconds'
  AND ("lastKickAt" IS NULL OR "lastKickAt" < now() - interval '30 seconds')
RETURNING id;   -- kick only when a row comes back
```

- `$2` (the kinds a lane may claim) keeps the engine lane on engine kinds and lets I/O kinds (imports, email, LLM text) run concurrently in an I/O-only loop in the same process. Dev: one engine loop + one I/O loop; prod: two engine loops + one I/O loop.
- Back-off `$4` per kind: analysis 30/120/600 s; import 60/300/900 s plus provider `Retry-After`; email 60/600/3600 s.
- Enqueue is always `INSERT … ON CONFLICT ("dedupeKey") DO NOTHING`, or `DO UPDATE SET "runAt" = LEAST(jobs."runAt", EXCLUDED."runAt"), priority = GREATEST(jobs.priority, EXCLUDED.priority)` when a member starts waiting on a backlog job, so the job jumps the queue. Every enqueue is followed by a kick in `after()` carrying the earliest `runAt` it wrote.

#### 1.10.3 Waking without polling (Neon compute hours)

Neon suspends a compute after 5 minutes without queries; a worker that polled every few seconds would keep production awake all month (0.25 CU × 720 h = 180 CU-h against the Free plan's 100). `LISTEN/NOTIFY` does not work through the pooler. So:

1. **Whoever enqueues also kicks**: web sends `POST /internal/analysis/kick` in `after()`; the socket server sends it after the finish CTE; the worker kicks itself.
2. The worker drains until no claimable job is left, reads `min("runAt")` in the same round trip as its last write (Neon is awake anyway), runs the reaper, arms **one** timer for that time (capped at 24 h) and stops querying. A kick carrying an earlier `runAt` re-arms it; any kick starts a drain.
3. **Recurring work is future-dated rows** (CR-10): `HOUSEKEEPING` once a day at 21:00 UTC ends with `DAILY_PLAN`, which writes the next 26 hours of timed rows (per-zone release pushes and reminders, weekly digests and weakness rolls on their day, DST recomputation, `BACKUP`, `TOURNAMENT_STARTING` at `startsAt − 5 min`); each recurring handler also enqueues its own successor. A web write that affects the next 26 h (a reminder-time change, a tournament created or moved) enqueues its row itself and kicks.
4. Self-healing for a lost kick: status reads (`GET /api/review/[ref]/status`, `GET /api/import/...`) run the `lastKickAt` compare-and-set and kick only when it returns a row. The Vercel daily cron re-kicks and alerts if the last `HOUSEKEEPING` finished more than 26 hours ago. A crashed worker restarts (Docker `restart: unless-stopped`) and reaps at boot.
5. A unit test boots the worker with a fake clock and a mocked DB for 24 simulated idle hours and asserts ≤ 5 DB round trips (the timer-audit gate, 05-optimization §9).

#### 1.10.4 Priorities and fairness

| `JOB_PRIORITY` | Value | Who | Examples |
|---|---|---|---|
| `USER_OPENED`, `IMPORT_SYNC_MANUAL` | 100 | A member is looking at the screen | "Analyse this game" on an imported game, Retry, lazily generated review text, "Sync now" |
| `GAME_ENDED` | 80 | A game just ended on our platform | `ANALYZE_GAME` from the socket finish or bot completion |
| `IMPORT_SYNC_INITIAL`, `REVIEW_BATCH` | 60 | Start of an import; P10 review batches | first page of `IMPORT_SYNC` after linking |
| `IMPORT_NEWEST` | 50 | Newest imported games | backfill head |
| `WEAKNESS`, `IMPORT_PURGE` | 20 | Weakness inputs; purges | `RECOMPUTE_WEAKNESS` |
| `IMPORT_SYNC_DAILY` | 15 | Daily sync | `IMPORT_SYNC` re-enqueued for 03:00 local |
| `BACKLOG` | 10 | Backlog | imported games beyond the eager head; `EXTRACT_MISTAKES` backfill |
| `HOUSEKEEPING` | 0 | Housekeeping | `HOUSEKEEPING`, `DAILY_PLAN`, `R2_SWEEP` |

`fairSeq` is set at enqueue to `n` for the user's n-th job in that batch, so at equal priority the claim order is every user's first job, then every user's second job, and so on. One member's 200-game import cannot hold up another member's first review.

#### 1.10.5 Observability

`GET /internal/metrics` and Sentry metrics: `worker.queue.depth{kind,band}`, `worker.queue.oldest_s{band}`, `worker.queue.wait_ms{kind}` (claim time − max(createdAt, runAt)), `worker.job.duration_ms{kind}`, `worker.job.fail{kind,code}`, `worker.engine.nps`, `worker.engine.throttled_pct`, `worker.cache.hit_ratio`, `worker.llm.tokens{model,kind}`, `worker.llm.cost_micro_usd{kind}`, `import.games{provider}`, `import.rate_limited{provider}`. The admin dashboard (`V4AdminDashboard`) reads a summary through `GET /api/admin/jobs/summary`.

### 1.11 LLM layer

#### 1.11.1 Where each model runs

| Use | Model | Runs in | Why there |
|---|---|---|---|
| Coach chat, explain-this-move follow-ups, what-if | `claude-sonnet-5-5` | web, `POST /api/coach/messages` (`runtime = "nodejs"`, `maxDuration = 60`) | Needs the Clerk session, membership and quotas; streaming is I/O-bound, so Fluid compute bills little Active CPU |
| Review summary, key-moment ask/why text, plan-chip feedback | `claude-haiku-5-5` | worker, `REVIEW_TEXT` | Runs after the engine passes; no user waiting for most imported games |
| Legend-compare narration | `claude-haiku-5-5` | worker | Same pipeline (`inv-play-b` §3.9) |
| Weekly progress summary (optional) | `claude-haiku-5-5` via Message Batches (50 % price) | worker, `NOTIFY_WEEKLY` (P10) | Nobody waits for it |

The default model in the Claude API reference is `claude-opus-5-5`; the plan names Sonnet 5.5 and Haiku 5.5 for cost, so this follows the plan.

#### 1.11.2 Request settings (current API constraints for these models)

| Setting | Sonnet 5.5 (coach) | Haiku 5.5 (review text) |
|---|---|---|
| Call | `client.messages.stream(...)` with `.finalMessage()` for persistence | `client.messages.parse(...)` with `output_config.format` (zod → JSON schema) |
| Thinking | omit (adaptive by default). `{type:"disabled"}` returns 400 on Sonnet 5.5; use `output_config.effort: "low"` for chat | omit; effort `low` |
| Sampling | none (`temperature` and friends return 400 on the `2026-10-21` API version) | none |
| Tools | `strict: true`, `tool_choice: {type:"auto"}` (forced `any`/`tool` returns 400 on Sonnet 5.5), `eager_input_streaming: true` with schema validation of every parsed tool input | none |
| `max_tokens` | ≈ 1,500 per answer | ≈ 1,200 |
| Refusals | check `stop_reason === "refusal"` before reading content; server-side `fallbacks: "default"` with beta `server-side-fallback-2026-07-01` (Claude API only); otherwise the engine-line fallback | no server-side fallback on Haiku 5.5: template text |
| Prefill | none (400 on these models) | none |
| Timeouts | first verified sentence by 20 s, whole answer by 45 s (P7), then the engine-line fallback | SDK default; job retries |

#### 1.11.3 Grounding (the coach never computes chess itself)

- **Facts in, words out.** A `CoachContext` packet built by code from `GameAnalysis`, `Mistake` rows and chess.js: explicit piece lists, the move's judgement, evals as fixed words keyed to Win% ("clearly better", "winning"), the best line in SAN, motifs from the PV walker, the opening name only from the ECO table, and `allowedMoves` (`inv-research` §13.3).
- **Tools** (all read-only, strict schemas): `analyse_position {fen, multipv 1..3}` → worker `/engine/analyse`; `play_moves {fen, moves ≤ 8}` → chess.js then analyse; `square_facts {fen, squares ≤ 6}`; `legal_moves {fen, square?}`; `game_ply {ply}`. Loop capped at 3 rounds and 20 s. A move the user plays on the board is pre-run through `play_moves` before the model call, so the common what-if needs no tool round.
- **Verifier** (`packages/chess-analysis/src/verify/*`, shared with the worker): every sentence is checked for move existence and legality in order, piece-on-square claims, attack and defence relations, material claims, severity words, opening names and numbers (V1–V8 in `inv-rct-a` §2.4.4). Only verified sentences are streamed; one regenerate with the failures listed; then a template fallback without the VERIFIED tag.
- **Untrusted text.** Imported PGN headers (player and event names from Chess.com or Lichess) are data: only whitelisted header fields enter the prompt, control characters are stripped, each field is cut to 40 characters, and they sit inside a delimited facts block. The user's question is the only free text, and it goes in the user turn. Model output is rendered as plain text (React text nodes), never as HTML.

#### 1.11.4 Prompt layout and caching

Render order is tools → system → messages, and the cache is a byte-exact prefix match.

| Block | Content | Cache | Shared by |
|---|---|---|---|
| Tools | fixed, sorted list | inside the system breakpoint | every coach request |
| System | frozen coach rules (≈ 1.5–2.5k tokens), no timestamps, no user data | `cache_control {type:"ephemeral"}` (**5 minutes by default**); `ttl:"1h"` only when `COACH_SYSTEM_CACHE_TTL=1h` is set, once coach traffic reaches a p50 of ≥ 4 requests an hour (1-hour entries must come before 5-minute ones) | every member |
| Game facts | the per-game compact ply list, key moments, header (≈ 2–3k tokens), serialised with sorted keys | `cache_control {type:"ephemeral"}` (5 min) | one member's review session |
| History | earlier turns, append-only (never edited) | top-level automatic caching | the thread |
| Per-turn facts + question | volatile | not cached | — |

Why 5 minutes (feasibility F-LLM-2): writing ≈ 2.5k tokens at the 1-hour rate (2×) costs ≈ $0.01, while sending them uncached costs ≈ $0.005 and a cache read ≈ $0.0005; the 1-hour TTL pays off only with ≥ 3 requests an hour sharing the prefix, and at launch most hours have fewer. Minimum cacheable prefix is 512 tokens. `usage.cache_read_input_tokens` and `usage.cache_creation.ephemeral_1h_input_tokens` are logged on every call; a thread with zero reads raises a Sentry warning (a silent invalidator such as unsorted JSON).

#### 1.11.5 Answer reuse

- "Explain 19.Qd2" for a key moment answers from the stored, verified `PlayerReview.content.moments[].why` with no model call.
- Suggested-question chips are cached per `(gameId, ply, chipKey, color, classifierVersion, promptVersion)` in the Next data cache (clean answers only); `POST /api/coach/hint` carries no `Cache-Control` (browsers do not reuse POST responses).
- Only typed and what-if questions always reach the model.

#### 1.11.6 Keys, workspaces and spend limits

Four Anthropic workspaces with their own keys: `replay-prod-web`, `replay-prod-worker`, `replay-dev` (both dev services, low monthly spend limit), and `replay-ci` (nightly live-model smoke only, with a cost guard on the nightly run). Workspace spend limits are the hard backstop (set to about 2× expected spend); the per-member counters below are the product limit.

#### 1.11.7 Cost guards (numbers from `CT/limits.ts`, CR-33)

| Guard | Mechanism | Member | Trial |
|---|---|---|---|
| One question at a time | partial unique index (one `STREAMING` message per user) + the `(userId, clientId)` insert before any model call → 409 `in_flight` | on | on |
| Burst | `burst` store, 5 per 60 s | 5 / 60 s | 5 / 60 s |
| Daily cap | `coach_usage_days.questions` (read before the stream, charged at `done`) | 30 | 10 |
| Period cap | sum over the month / over the trial (one indexed range query) | 150 a month | 40 over the trial |
| Cost ceiling | `sum(costMicroUsd)` per member per period | $1.50 a month | $0.40 over the trial |
| Global circuit breaker | today's org-wide spend from `coach_spend_days` (cached 60 s per instance) above `max($5, $0.08 × entitledMembers)` (recomputed daily) → the coach answers with the engine-line fallback and alerts | — | — |
| Charging (P7 D5) | cost is always recorded; a `done` answer counts against the quota; failures, fallbacks and aborts do not. With `supportsCancellation` off an abort cannot be detected, so D5 depends on §4.3's `vercel.json` | — | — |

Cost model (Sonnet 5.5 at $2 / $10 per MTok, cache reads $0.20; Haiku 5.5 at $0.10 / $0.50, feasibility F-LLM-1): first question ≈ $0.012–0.019, follow-up ≈ $0.004–0.009; review text ≈ $0.00035 a game. A typical member (30 questions, 15 analysed games a month) costs ≈ $0.25–0.45 a month; at the 150-question cap the worst case is ≈ $1.05–2.10, which is why the cost ceiling exists. The UI shows the remaining count before anything is typed (`V3CoachRateLimit`, "3 LEFT TODAY"). Provisioned memory for coach streams (≈ 110 GB-h a month at 150 DAU, about 30 % of Hobby's 360 GB-h) counts toward the P13 Pro decision, not as a Hobby fit.
#### 1.11.8 Text to speech (optional, later)

Now: legend positions keep their pre-recorded audio; coach answers can be read by the browser's `speechSynthesis` (free) behind flag `coach-voice`. Later [OD: provider]: the worker generates audio **only from verified text**, converts notation to words ("Nf3" → "knight f3"), caches it in R2 by `sha256(voice, model, text)` under `media.playchess.tech/tts/…`, caps concurrency at 5, and never autoplays during a timed game (`inv-research` §13.11).

### 1.12 Storage

#### 1.12.1 Neon Postgres

- **Projects.** Production: `withered-cake-82837167`, branch `production`. Dev and E2E: the Free project `replay-chess-dev` from P1 (1B·H10), autoscaling max 0.5 CU; CI uses Docker Postgres 17 and never Neon. CLAUDE.md's environments table is updated by the owner when the split happens; until then phase specs say "the Neon dev branch (CLAUDE.md)" and never hard-code branch ids.
- Endpoints: Vercel and both OCI services use the **pooled** host (PgBouncer, transaction mode); the worker's analysis batch uses the Neon HTTP driver (P3-D11). Migrations and `pg_dump` use the **direct** host. Vercel pooled URL: `sslmode=require&channel_binding=require&connection_limit=5&pool_timeout=15&connect_timeout=15`; OCI services: pool size 2–3.
- **Pools must expect Neon to close their connections** (feasibility F-OCI-4, api-perf AP-18). Neon suspends after 5 minutes without queries and closes idle connections; `node-postgres` emits `error` on an idle client, and with no listener the process crashes, which for the socket server would drop every live game about 5 minutes after the database goes quiet. Rules: `pool.on('error', log)`; `idleTimeoutMillis: 60_000` (close before Neon does); classify `P1017`, `P1001`, `57P01`, `08006`, `08003`, `ECONNRESET` as transient and retry idempotent statements once on a fresh connection; never leave a transaction idle (it counts as active and keeps the compute awake). Resilience test: suspend the dev compute mid-game through the Neon API, play on, finish, and check the game persisted (P2 §12, P3 §12).
- Roles (created once per branch by the owner, not in Prisma migrations; `audit-db` §5.4):

| Role | Used by | Grants | Role settings |
|---|---|---|---|
| `neondb_owner` | `prisma migrate deploy` only (CI job with owner approval) | owner | — |
| `replay_app` | web | DML on the web tables in §1.4; `INSERT` on `jobs`, `UPDATE ("lastKickAt")` on `jobs` | `statement_timeout 15s`, `idle_in_transaction_session_timeout 30s`, `lock_timeout 5s` |
| `replay_realtime` | websocket | DML on `games` live columns, `game_players`, `player_ratings`; `INSERT` on jobs; `SELECT` on users' display columns (`id, "referenceId", name, "profilePictureUrl", role, "gamesVersion"`), `UPDATE ("gamesVersion", stats)` on users | `statement_timeout 8s`, same idle and lock limits |
| `replay_worker` | worker | DML on its tables in §1.4; full DML on `jobs` | `statement_timeout 60s` |
| `replay_backup` | nightly dump | `SELECT` on all tables, no DML | `statement_timeout 0` for dump sessions only |

  No runtime role can `DROP`, `TRUNCATE` or `ALTER`, so a mistaken `migrate dev` with a runtime URL fails instead of resetting the database (the 2026-03-08 failure mode in CLAUDE.md).
- **UNLOGGED tables hold only state that is safe to lose** (`rate_limit_buckets`, burst windows ≤ 60 s). Anything that must persist through a scale-to-zero (daily and monthly budgets, email caps, long rate windows) lives in logged tables (CR-19).
- Extensions: `pg_stat_statements` (diagnostics), `pg_trgm` (catalogue search). No partitioning.
- Plan: the Free plan's 100 CU-hours a month cannot keep a production compute awake for a month of real use. Production moves to **Neon Launch** before charging customers, ≈ $15–25 a month with a spending alert, the instant-restore window set to **7 days** explicitly ($0.20 per GB-month), scale-to-zero left on [OD D2].

#### 1.12.2 Cloudflare R2

| Bucket | Access | Content | Lifecycle |
|---|---|---|---|
| `replay-media` (custom domain `media.playchess.tech`) | public read, immutable paths; served with `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; img-src 'self'` (Cloudflare Transform Rule) | legend media, puzzle shards `puzzles/v1/{theme}/{band}.json`, the browser engine `engine/sf18-<hash>/` (glue `.js` + `.wasm` with `Content-Type: application/wasm`, CORS for the app origins, `COPYING`, `SOURCE.txt`), lesson audio, catalogue JSON snapshots, pre-sized avatars and legend portraits (256 px WebP, rendered `unoptimized`) | versioned paths; old versions deleted by the build script |
| `replay-uploads` | private; presigned PUT from web (`WEB/lib/r2/presign.ts`, `aws4fetch`, signed `content-type` ∈ webp/png/jpeg), public read through `media` after processing | `avatars/{userRef}/…` | deleted on account purge |
| `replay-exports` | private; presigned GET (7 days) | `exports/{userRef}/{jobId}.zip` | R2 lifecycle: delete after 7 days |
| `replay-backups` | private; an **Object R/W token scoped to this bucket** for the writer plus an **R2 bucket lock** retention rule of 14 days [V6], so a compromised worker cannot delete backups (R2 has no write-only token) | `neon/{env}/{YYYY-MM-DD}.dump.age` | 14 daily + 2 weekly (≤ 30 days, §3.3.5); size check alerts above 6 GB in total |
| `replay-dev-*` | same, dev | — | shorter |

#### 1.12.3 Local disk on OCI

`/data/journal` (socket ndjson journal with a version byte per record, deleted 1 h after a successful finish), `/data/evalcache` (SQLite, ≤ 4 GB, worker host), `/data/tmp` (import parsing scratch). Nothing on local disk is a system of record; losing it costs only cache warmth.

#### 1.12.4 Edge Config and browser storage

- Vercel Edge Config store `replay-ops` holds the operational switches in §3.5.1 (Hobby: 100k reads a month; 60 s memo per isolate; the read count is in the weekly ops report).
- Browser: `localStorage` only for per-device conveniences (`rc:prefs:v1`, `rc:dismissed:v1`, `rc:bot:<ref>`), `sessionStorage` for coach drafts, IndexedDB for the training outbox (`rc-outbox`, keys `u:<userRef>:<stream>`) and the offline snapshots (`rc-offline`), both cleared for the user at sign-out. Entitlement and user data are never persisted in the browser (`audit-client` #12).

### 1.13 Capacity and cost budget

#### 1.13.1 Platform allowances (verified 2026-11-02 unless marked [V])

| Platform | Allowance relevant here | Source |
|---|---|---|
| Vercel Hobby | 1M CDN requests; 100 GB Fast Data Transfer; 10 GB Fast Origin Transfer; 1M function invocations; 4 h Fluid Active CPU; 360 GB-h provisioned memory; **5,000 image transformations** and 300k image cache reads; **100k Edge Config reads, 100 writes**; **Speed Insights 10,000 events per 30 days, team-wide**; 50k Web Analytics events; runtime logs kept **1 hour**; 3 WAF custom rules; 100 deployments a day; functions up to 300 s with Fluid. **Exceeding a limit pauses that feature until 30 days have passed** | vercel.com/docs/plans/hobby (2026-09-14), functions limitations (2026-08-24) |
| Vercel Hobby cron | at most once a day, precision ±59 min; a more frequent expression fails the deploy; 100 cron jobs per project | cron usage page (2026-07-15) |
| Vercel Hobby licence | personal, non-commercial use only; the live site already charges grandfathered $8 members | `audit-quality` PLAT-01 [OD D1] |
| Vercel deployment protection on Hobby | Vercel Authentication for preview **and production** deployments, plus protection exceptions; password protection is Pro | docs; `replay-chess-dev` has SSO and password protection off today |
| Neon Free | 100 CU-h a month **per project**, autoscaling to 2 CU, scale to zero after 5 min (cannot be disabled), 1 GB storage per project, 5 GB egress, 6 h restore window, **1 manual snapshot**, 10 branches; idle connections closed at suspend | neon.com docs (compute lifecycle, plans) |
| Neon Launch | $0.106 per CU-h, $0.35 per GB-month, instant restore up to 7 days at $0.20 per GB-month, 100 snapshots, scale-to-zero optional, no minimum | Neon pricing |
| OCI Always Free | 4 OCPU / 24 GB A1 pool, 200 GB block storage, 10 TB egress a month [V]; PAYG A1 beyond the pool ≈ $0.01 per OCPU-h + $0.0015 per GB-h [V7] | CLAUDE.md; OCI price list |
| Cloudflare R2 free | 10 GB storage, 1M Class A and 10M Class B operations a month, free egress [V] | — |
| PostHog free | 1M product events a month [V] | — |
| Sentry Developer | limited errors, spans and replays; few cron and uptime monitors; custom metrics availability and quota for the v10 SDKs [V4] (fallback: the worker's `/internal/metrics` read by `ops-weekly.yml`) | — |
| Resend free | 100 emails a day, 3,000 a month [V]; P10 reserves 20 of 90 a day for transactional email | — |
| GitHub Actions | free standard and `ubuntu-24.04-arm` runners **for a public repo**; a private repo would exceed 2,000 minutes with the nightly matrix [V11] | GitHub docs |

#### 1.13.2 Per active member per month (after the redesign)

| Resource | Estimate | Basis |
|---|---|---|
| Vercel invocations | ≈ 1,000–1,300 | 300 dynamic RSC renders and prefetches, 400–500 training writes (20 a day, some batched), 30 coach, 50 `me`/refresh, 40 socket tokens, 50 review and status reads, 100 misc |
| Vercel Active CPU | ≈ 15–25 s | ≈ 15 ms average per invocation |
| Neon storage growth | ≈ 0.4 MB a month (≈ 4.4 MB a year for a typical member, 02-data-model §10) | measured row sizes, PGN included for platform games |
| OCI worker CPU | ≈ 5–8 min | 15–20 analysed games × 16–27 s |
| Anthropic | ≈ $0.25–0.45 typical, ≤ $1.50 by guard | §1.11.7 |
| PostHog events | ≈ 600–900 | consent-gated client events plus server events |

So Hobby's 1M invocations and 4 h CPU carry roughly 700–900 active members, after which Pro is needed anyway; the licence needs Pro before the first charge [OD D1].

#### 1.13.3 Scale triggers and quota guards

| Signal | Threshold | Action |
|---|---|---|
| **Any Hobby quota on `replay-chess-dev`** | **60 %** of the monthly allowance | **Hard stop for test traffic** (nightly deployed runs, k6) until the cycle resets; a pause at 100 % would block development for up to 30 days (feasibility F-VER-2). Checked weekly by `ops-weekly.yml` from P1 |
| Vercel invocations (prod) | > 70 % by day 20 | Find the top routes; batch or move to socket push; Pro [OD D1] |
| Neon CU-h (either project) | > 50 % pro-rata (weekly report from P1) | Look for a timer or a test run waking the DB; Launch [OD D2] |
| Neon storage | > 700 MB | Check retention jobs; prune imported unanalysed games; Launch |
| Worker queue | the Stage C triggers in §1.8.3 | Cheaper levers first, then Stage C [OD D3] |
| Socket | loop lag p99 > 50 ms at peak, or > 2,000 concurrent sockets | Profile; move the socket to a bigger paid shape [OD D3] |
| Anthropic | daily spend > 80 % of the breaker | Alert; review caps |
| R2 | > 7 GB | Prune old puzzle versions and TTS; check backup sizes |
| Speed Insights | `sampleRate={0.2}` on Hobby; PostHog web vitals are the primary field source | — |
| Edge Config reads | counter in the weekly ops report; 60 s memo per isolate (P11 D10) | — |

---

## 2. Background jobs and schedules

### 2.1 Choosing the scheduler

| Option | Timing | Cost | Fit |
|---|---|---|---|
| **Vercel Cron on Hobby** | At most once a day, ±59 min; runs on the production deployment of each project (so also on `replay-chess-dev`) | One invocation per run | Too coarse for "day 5 at the sign-up hour" or 08:00-local pushes. Good as a once-a-day backstop |
| **Worker: future-dated job rows + one in-memory timer** (chosen, CR-10) | Seconds-precise; a job runs when its `runAt` arrives | Free (OCI); wakes Neon only when a row is due | Fits every timed job. Recurring work is rows that enqueue their successor, planned a day ahead by `DAILY_PLAN` |
| A fixed `HOURLY_TICK` (revision 1) | Hourly | 24 wakes a day ≈ 2 h awake ≈ 15 CU-h a month, even with nothing to do | **Rejected** (feasibility F-NEON-2, api-perf AP-08) |
| `node-cron` inside a service | Precise | Free | Wakes Neon on every schedule; schedules live outside the database. **Rejected** |
| Neon `pg_cron` | Runs only while the compute is awake | Keeps the compute awake | **Rejected** |
| GitHub Actions `schedule` | Best effort | Free for a public repo | CI work only: nightly test matrix, weekly k6, `ops-weekly.yml`, the P1 interim production backup |

**Decision.** The worker is the scheduler for all product jobs. Vercel Cron carries exactly one route, `GET /api/cron/daily` at `0 9 * * *` UTC, whose tasks are files in `WEB/lib/cron/tasks/<task>.ts` run in an ordered array (one file per task so phases do not edit one shared route, feasibility §7):

1. `membership-reconcile`: reconciles non-terminal subscriptions with Dodo, 50 per run, and heals snapshots older than 6 h (this replaces P1's auto-refresh-on-read; the write uses the CR-25 compare-and-set with Dodo's `updated_at`);
2. `trial-reminder-backstop`: enqueues any `TRIAL_ENDING` notification that should exist but doesn't (trial ending in 12–72 h, no `trialReminderSentAt`, no queued row), then kicks the worker (P10);
3. `worker-heartbeat`: if the last `HOUSEKEEPING` finished more than 26 hours ago, kicks the worker and sends a Sentry alert;
4. `checkout-cleanup`: clears `pendingCheckout*` older than 24 h.

The route is authenticated with `Authorization: Bearer $CRON_SECRET`, sets `maxDuration = 60`, and is idempotent. Pruning `rate_limit_buckets` and `idempotency_keys` moved to the worker's `HOUSEKEEPING` (P3).

### 2.2 Job catalogue

Lanes: **E** = engine lane (one Stockfish process on dev, two on the prod worker VM); **I** = I/O lane (network and SQL; concurrent with the engine lane, at most 4 jobs at once). Priorities are `JOB_PRIORITY` names (CR-9).

| Kind (migration) | Trigger | When | Lane | Priority | `dedupeKey` | Idempotency | Retries | Writes and events |
|---|---|---|---|---|---|---|---|---|
| `ANALYZE_GAME` (M3) | socket finish CTE; bot `complete`; import; member "Analyse" or "Retry" (`POST /api/review/[ref]/analyse`) | now | E | `GAME_ENDED` (platform), `USER_OPENED`, `IMPORT_NEWEST` / `BACKLOG` (imports) | `analyze:<gameId>` | `ON CONFLICT DO NOTHING`; result in one HTTP batch guarded by `analysisStatus <> 'DONE' OR analysisVersion < $v` | 4 (30 s, 2 min, 10 min) | `game_analyses`, `player_reviews`, `mistakes`, `mistake_occurrences`, `BANK` cards; `analysis:*`; enqueues `REVIEW_TEXT` (priority ≥ `GAME_ENDED`), `RECOMPUTE_WEAKNESS` (debounced) |
| `REVIEW_TEXT` (M3, built in P7) | `ANALYZE_GAME` completion at priority ≥ `GAME_ENDED`; the review RSC page, lazily (never a prefetch or the JSON GET) | now | I | `GAME_ENDED` / `USER_OPENED` | `reviewtext:<gameId>:<color>:<promptVersion>` | upsert by key | 3, then the P3 template stays | `player_reviews` text; `review:text_ready` |
| `LEGEND_COMPARE` (M3) | **`POST /api/review/[ref]/legend/compute`** only (never a GET or a hover prefetch) | now | E | `USER_OPENED` | `compare:<gameId>:<color>` | key | 3 | comparison row; `compare:*` |
| `IMPORT_SYNC` (M3, built in P4) | link; "Sync now" (≤ 1 per 10 min per account); daily auto-sync | link: now; auto: 03:00 local + 0–30 min jitter | I + provider gate | `IMPORT_SYNC_INITIAL`, `IMPORT_SYNC_MANUAL`, `IMPORT_SYNC_DAILY` | `import:<accountId>:initial`, `…:<YYYY-MM-DD>`, `…:manual:<10-min slot>` | `(source, "externalId")` unique; cursor in `import_cursors`; resumes from `progress` | 5 (honours `Retry-After`) | `games`, `game_players`, `import_cursors`, `import_runs`; `import:progress {…, analysed}`, `import:finished`; enqueues `ANALYZE_GAME`; enqueues tomorrow's sync |
| `IMPORT_PURGE` (M3) | unlink with "delete imported games" | now | I | `IMPORT_PURGE` | `importpurge:<accountId>` | batched deletes by id | 5 | deletes imported games and derived rows; `gamesVersion` + 1 |
| `RECOMPUTE_WEAKNESS` (M3, built in P6) | analysis finished for the member (debounced 10 min); import batch finished; "Retry" (once per 10 min) | `runAt = now() + 10 min`, pushed back on each new trigger while queued | I | `WEAKNESS` / `USER_OPENED` | `weakness:<userId>` | new snapshot row, flips `isCurrent` in one transaction | 3 | `weakness_snapshots`; `weakness:progress`, `weakness:ready` |
| `EXTRACT_MISTAKES` (m5a, P5) | the P5 backfill; an `EXTRACT_VERSION` bump | now | E | `BACKLOG` | `extract:<gameId>:<userId>:v<n>` | natural-key statements | 3 | bank rows; coalesced `mistakes:added` ≤ 1 per user per 60 s |
| `HOUSEKEEPING` (M3) | its own successor | daily 21:00 UTC (≈ 02:30 IST) | I | `HOUSEKEEPING` | `cron:HOUSEKEEPING:<date>` | each rule is a batched, idempotent statement | next day | retention rules (§3.3.5), reaper, `rate_limit_buckets` and `idempotency_keys` prune, training hygiene (P5), coach retention (P7); **last step runs `DAILY_PLAN`**; Sentry cron check-in |
| `DAILY_PLAN` (M3) | end of `HOUSEKEEPING`; worker boot if today's plan is missing | daily | I | `HOUSEKEEPING` | `cron:DAILY_PLAN:<date>` | every row it writes has a `dedupeKey` | next day | inserts the next 26 h of timed rows (below) |
| `NOTIFY_DISPATCH` (m10a, P10) | a producer inserts `notifications` rows and enqueues/kicks; `TRIAL_ENDING` at `trialEndsAt − 48 h` | now, or quiet-hours end | I | `GAME_ENDED` for transactional, `HOUSEKEEPING` for digests | `notify:<notificationId>` | `notifications.status` transitions | 4; push 410 → delete the subscription | `notifications` status; PostHog `notification_sent`. Woken by the producer and drained until empty; **no 30 s poll** |
| `NOTIFY_REMINDERS` (m10a, P10) | `DAILY_PLAN`, one row per distinct `reminderUtcMinute` with due members; settings changes inside 26 h | timed | I | `HOUSEKEEPING` | `remind:<utcMinute>:<date>` | key | 3 | `notifications` rows for members who opted in, have due cards and have not trained today (this is also the 08:00-local release push; P5 itself uses a client timer and adds no job) |
| `NOTIFY_WEEKLY` (m10a, P10) | `DAILY_PLAN` on each zone's Sunday | weekly | I | `HOUSEKEEPING` | `weekly:<tz>:<isoWeek>` | key | 3 | weekly digest (Haiku through Message Batches, optional), weakness week roll (P6) |
| `MILESTONES_EVALUATE`, `MEMBERSHIP_PAUSE_EDGE`, `R2_SWEEP` (m10a, P10) | producers; `DAILY_PLAN` for the sweep | timed | I | `HOUSEKEEPING` | per kind | key | 3 | milestones, pause edges, orphaned uploads |
| `ACCOUNT_PURGE` (M3, built in P10) | `DELETE /api/me` commit; Clerk `user.deleted` webhook | now | I | `GAME_ENDED` | `purge:<accountDeletionId>` | per-step state in `account_deletions.steps` | 10 per step (1 min → 6 h); **Dodo cancel failure alerts at once** | external clean-up (§2.3.8) |
| `EXPORT_BUILD` (M3, built in P10) | `POST /api/me/export` (durable limit 1 a day) | now | I | `USER_OPENED` | `export:<userId>:<date>` | key | 3 | R2 object + email link (7-day presigned URL); `export:ready` |
| `DODO_CUSTOMER_SYNC` (M3) | billing edge cases that need a background Dodo call (via web internal route) | now | I | `IMPORT_SYNC_INITIAL` | `dodo:<userId>:<reason>` | key | 5 | — |
| `TOURNAMENT_STARTING` (m12a, P12) | tournament created or moved (enqueued by web); `DAILY_PLAN` backstop | `startsAt − 5 min` | I | `GAME_ENDED` | `tstart:<tournamentId>:<startsAt>` | key | 3 | `notifications`; arena reminders. Pairing, start and finalize themselves run on the socket server and web internal routes (CR-17) |
| `BACKUP` (m13a, P13) | `DAILY_PLAN` | daily 20:00 UTC | I (`nice 19`) | `HOUSEKEEPING` | `cron:BACKUP:<date>` | key | 3 (15 min), then alert | R2 object; Sentry check-in. `BACKUP_ENABLED=false` on dev (a nightly dump costs egress) |

**Rows `DAILY_PLAN` writes** (each with its `dedupeKey`, so a re-run is a no-op): `NOTIFY_REMINDERS` per distinct reminder minute in the window; `NOTIFY_WEEKLY` per zone whose Sunday falls in the window; the DST recomputation for zones whose offset changes in the window (P10); `BACKUP` (prod); `R2_SWEEP` weekly; `TOURNAMENT_STARTING` backstops for tournaments starting in the window; tomorrow's `HOUSEKEEPING` (its successor). A monthly FSRS parameter optimisation is **not** scheduled; default parameters apply until a later phase decides otherwise.

**Timers that are not jobs (socket server, in memory, restored on boot):** clocks, first-move windows, study countdowns, disconnect grace, draw-offer cooldowns, rematch expiry, matchmaking pairing ticks (1 s per non-empty pool, no DB), arena timers (P12). Tournament schedules are loaded at boot and pushed by web on change, with an hourly re-sync **served from the Vercel data cache**, never a DB query every 60 s (P12 D12-10). They live where the live state lives and are rebuilt from the journal and the database after a restart.

### 2.3 The jobs the product depends on

#### 2.3.1 Analysis

Covered in §1.9. Contract with the UI: `GET /api/review/[ref]/status` returns `{status: "none"|"queued"|"running"|"writing"|"done"|"failed", progress:{done,total}, etaSec?}`, and `GET /api/review/[ref]` returns the full review once `done` (`private-etag`; TanStack keeps it with `staleTime: Infinity`). Neither GET enqueues (CR-24): the client's `POST /api/review/[ref]/analyse` is the only enqueue from an open review. `etaSec` is `queuePosition × medianDuration(kind)` from the last hour's jobs ("Waiting for the engine · about 20 s").

#### 2.3.2 Import sync

- **Provider gate.** One in-process mutex per provider, because each environment runs exactly one worker. If a second worker is ever added, the gate moves to a `provider_leases(provider, holder, expiresAt)` row claimed with a conditional update.
- **Chess.com**: `GET /pub/player/{u}/games/archives` with `If-None-Match`; then the current month and any month newer than the cursor, newest first, one request at a time; User-Agent `ReplayChess/1.0 (+https://playchess.tech; hello@playchess.tech)`; handle validated with `^[A-Za-z0-9_-]{3,25}$` and `encodeURIComponent`; each account at most once every 12 hours. **Lookup fallback (feasibility F-API-1):** the web lookup at link time runs from Vercel's shared egress IPs and may get 429 or 403; it then calls the worker's `POST /internal/provider/chesscom/lookup` (HMAC), which goes through the same one-at-a-time gate (one IP, one User-Agent); both sides cache the answer 600 s; `import.lookup_source{web|worker}` is recorded. The confirm step's newest-month call uses the same fallback.
- **Lichess**: OAuth PKCE (S256) through web. **Recommended (feasibility F-API-3; P4 decides):** use the scope-less token only for the initial import (60 games/s for own games instead of 20 anonymous), then call `DELETE /api/token`; daily syncs run anonymously (a day's games at 20/s take under a second); store only `lichessUserId` and `verifiedAt`. That removes the stored ciphertext, `LINK_TOKEN_KEYS`, key rotation, the re-encryption job, the `lichess_revoke` purge step and most `RELINK_REQUIRED` paths; a full re-import asks for OAuth again. If P4 keeps a stored token, it is sealed with the worker's X25519 public key (libsodium `crypto_box_seal`) so web holds only the public key, under the one name `LINK_TOKEN_KEYS`. Export: ndjson with `since=<cursor+1>&clocks&evals&opening&accuracy&division&pgnInJson`.
- **Writes.** `INSERT … ON CONFLICT (source, "externalId") DO UPDATE … RETURNING id, (xmax = 0) AS created`, then `game_players` in 100-game chunks, so a game an opponent already imported still gets this member's row (P4 §8; revision 1's `DO NOTHING` form silently skipped it). `import:progress` is throttled to one per second per user.
- **Entitlement.** The handler re-checks entitlement at start; a lapsed member's job moves to `WAITING`, and the next entitled billing snapshot sets it back to `QUEUED`.
- **Daily auto-sync** is the job enqueuing itself for the next 03:00 local. A member who hasn't opened the app for 30 days drops to a weekly sync; one who lapses stops syncing.
- **Terms (feasibility F-API-4).** The Chess.com terms review (P4 OD-2) is a P13 preflight blocker; until it is done, Chess.com avatars are not hotlinked (initials instead) and provider names are plain text.

#### 2.3.3 Weakness snapshot

- Inputs: the member's analysed games in scope, `mistakes`, and the per-game `game_players.stats`/`"errorThemes"` columns P6 adds in M6 (so the denominator needs no per-ply scan).
- Computation: SQL aggregates by theme, phase, clock bucket, opening (ECO) and piece, joined in TypeScript with the static rating-band baseline in `PKG/chess-training/baselines/v1.json` (built offline from the Lichess CC0 dump).
- States: fewer than 5 analysed games → `insufficient`; 5–19 → `preliminary`; 20 and more → full (X15). While a recompute runs, the previous snapshot stays current, and the screen shows `computing` with `weakness:progress`.
- Weekly history: the week roll is a `NOTIFY_WEEKLY`-day row per zone written by `DAILY_PLAN`, not a tick slice. Older weeks are kept for 12 weeks (§3.3.5).

#### 2.3.4 Trial reminder (day 5)

1. The Dodo webhook applies the first trialing snapshot and stores `trialStartedAt` and `trialEndsAt` (Phase 0 fields, `WEB/prisma/schema.prisma:47-48`).
2. In the same request (P10) it inserts a `TRIAL_ENDING` notification and a `NOTIFY_DISPATCH` row with `runAt = trialEndsAt − 48 h`, `dedupeKey = trial-reminder:<subscriptionId>`, and kicks the worker.
3. At run time the handler re-reads the subscription fields. It **skips** when the subscription is no longer trialing, is set to cancel at period end, or `trialReminderSentAt` is set. It also skips, and logs, when fewer than 12 hours remain before the charge.
4. Otherwise it sends the email through Resend from `hello@playchess.tech`: plan, price, charge date in the member's time zone (`User.timeZone`, M4), a one-click link to `/settings/membership?modal=cancel`, and "Cancel before <date> and you won't be charged". Transactional email never waits behind a digest (20 of the 90 daily sends are reserved). Then it sets `trialReminderSentAt`.
5. The daily cron backstop catches webhooks that arrived late or rows that were lost (§2.1).
6. Tests: unit tests for the skip rules and the date maths across time zones and DST; an e2e test in Dodo test mode that checks the row's `runAt`.

#### 2.3.5 FSRS due computation and release

- **Due is a column, not a batch.** Grading happens on web (`POST /api/train/attempts`, §1.7.7) with `ts-fsrs` (`TRN`): `scheduler.next(card, reviewedAt, grade)` gives the new `due`; when the interval is at least a day, `due` is snapped to the member's release hour in `User.timeZone` (08:00 by default). New bank cards are created by the worker in `NEW` state, available at once, and capped at 5 new a day by the session builder.
- **Counts are read, not stored.** "6 due" is an index scan on `training_cards (userId, deck, due)`. The day's plan is materialised lazily into `training_days.plan` on the first read of the local day (the only GET with a registered write, `daily_plan`).
- **Release.** No job. The Train hub and badge refresh at the release hour with a client timer in visible tabs (P5 §5.2); the optional 08:00 push is P10's `NOTIFY_REMINDERS` row.
- **Offline replay.** Attempts carry `reviewedAt`; the server applies a batch in `reviewedAt` order with `now = reviewedAt`, and conflicts (a card graded in another tab) are dropped by the conditional update on `reps`.

#### 2.3.6 Notifications

`notifications` rows are created by producers (P10 reminders, P12 tournament reminders, the trial reminder, weekly digests) with a `dedupeKey`; `NOTIFY_DISPATCH` sends them through web-push (VAPID; the private key lives only on the worker) or Resend, respects quiet hours, deletes push subscriptions on HTTP 410 or after 3 failures, and records `sent`/`failed`. The daily Resend budget is counted from `notifications` (`status = 'SENT' AND "sentAt" >= <UTC midnight>`, partial index on `sentAt` where `SENT`), never from the UNLOGGED bucket table (feasibility F-NEON-3). Opening a push goes through `POST /api/push/clicked` with a signed id.

#### 2.3.7 Housekeeping

The retention rules in §3.3.5 run as batched statements (`WHERE id IN (SELECT id … LIMIT 1000)` loops) so locks and WAL stay small, plus: expire friend invites past `expiresAt`, cancel `IN_PROGRESS` games with no ply for 24 h that the socket server does not report live, delete empty dead games older than 30 days, delete `DONE` jobs older than 7 days and `FAILED` older than 30, prune `rate_limit_buckets` (2 h), `rate_limit_windows` (expired) and `idempotency_keys` (24 h). Then `DAILY_PLAN`.

#### 2.3.8 Account purge (external steps)

Steps, each with `{status, attempts, lastError, doneAt}` in `account_deletions.steps`:

| Step | Executed by | Why there |
|---|---|---|
| `dodo_cancel` (cancel now, per the delete copy) | web `POST /api/internal/account-purge/:id/dodo` (HMAC, kid `wk`), called by the worker | the Dodo key stays on web |
| `clerk_delete` | web `POST /api/internal/account-purge/:id/clerk` | the Clerk secret stays on web |
| `lichess_revoke` | worker (`DELETE https://lichess.org/api/token`) | **only if** P4 keeps a stored token (§2.3.2) |
| `r2_delete` (`avatars/{ref}/*`, `exports/{ref}/*`) | worker | R2 keys |
| `posthog_delete` (person delete) | worker (PostHog personal API key, scoped) | — |
| `confirmation_email` (to the address captured before deletion, then discarded) | worker | Resend |

A Dodo cancel that keeps failing pages the owner immediately, because the person could still be charged; the runbook is `docs/runbooks/account-deletion.md`. Trial-ledger rows for deleted members are hashed with the same `HASH_PEPPER` the trial check reads (CR-26), so a deleted member who signs up again does not get a second trial. Owner option (feasibility §9): a 24 h undo window before `ACCOUNT_PURGE` runs.

#### 2.3.9 Backups

- **From P1 (interim, `audit-db` DB-02):** a GitHub Actions workflow `backup-prod.yml` runs nightly `pg_dump --no-owner --format=custom` of the **live production database**, encrypts it with `age` to the owner's public key, and uploads it to `r2://replay-backups/neon/prod/<date>.dump.age` (or an encrypted Actions artifact kept 14 days), plus a weekly restore check into a throwaway Neon branch of the dev project. Until this exists, the only copy of production outside Neon's 6-hour window is `/tmp/chess_battle_data_fixed.sql`.
- **From P13:** the worker's `BACKUP` job replaces it: `pg_dump --format=custom --no-owner` over the direct URL with the read-only `replay_backup` role, piped through `age -r $BACKUP_AGE_RECIPIENT` (the private key is kept offline by the owner), uploaded with multipart. It records size and duration, fails loudly if the size drops more than 30 % from the previous day, and alerts above 6 GB of backups in total. Disabled on dev.
- Before every production migration, the release workflow takes Neon's manual snapshot (the Free plan keeps **one**, so the previous snapshot is deleted first; Launch keeps 100). Quarterly restore drill: restore the latest dump into a scratch branch, run the smoke suite, delete the branch.

### 2.4 Neon wake budget

| Source | Wakes a day | Awake time (each wake keeps the compute up ≈ 5 min after the last query) |
|---|---|---|
| `HOUSEKEEPING` + `DAILY_PLAN` (with `BACKUP` in the same evening window on prod) | 1–2 | ≈ 10 min |
| Vercel daily cron | 1 | ≈ 5 min |
| Timed rows (`NOTIFY_REMINDERS` per reminder minute, weekly digests, trial reminders, daily syncs at 03:00 local, tournament reminders) | only when a member has something due; clustered by time zone | mostly inside existing wakes |
| User traffic, games, analysis | demand-driven | the bulk once members are active |

A quiet day costs about 2–5 wakes instead of revision 1's 24+ (≈ 15 CU-h a month saved). Nothing else runs on a timer against Neon: no hourly tick, no 60 s tournament scheduler query, no 30 s dispatch poll, no 5-minute badge poll (the badge fallback is on focus or ≥ 10 min). Crawlers hit ISR pages and the CDN; scanners are answered by middleware. The socket server holds a pooled connection but sends no keep-alive queries, and treats the close at suspend as a transient error (§1.12.1).

### 2.5 Failure handling and runbooks

- `FAILED` jobs stay 30 days and appear in the admin jobs view (`GET /api/admin/jobs?status=FAILED`), with `POST /api/admin/jobs/:id/retry` (admin, audit-logged).
- Immediate alerts (Sentry issue alert → owner email): any final failure of `ACCOUNT_PURGE` (Dodo step), the trial reminder, `BACKUP`; the `HOUSEKEEPING` check-in missed by more than 2 h; queue oldest priority ≥ `GAME_ENDED` older than 10 min.
- Aggregated alerts: analysis failure rate > 5 % per hour; import `rate_limited` > 20 per hour per provider.
- Runbooks in `docs/runbooks/`: `worker-down.md`, `queue-backlog.md` (cheaper levers, then Stage C), `socket-restart.md`, `account-deletion.md`, `restore-from-backup.md`, `rotate-secrets.md`, `neon-quota.md`, `rollback.md` (includes the service-worker kill switch, §4.7).

---

## 3. Cross-cutting concerns

### 3.1 Authorisation model

#### 3.1.1 Actors and states

| Actor | How it is identified | Notes |
|---|---|---|
| Anonymous visitor | no session | marketing, catalogues, public profiles, invite previews, shared review pages |
| Signed-in non-member | Clerk session; `memberState = none` | onboarding, pricing, settings › account, membership, connected accounts (link only), delete account, export |
| Member | `memberState ∈ {trial, active, cancelling, grace}` → `entitled = true` | everything in the product |
| Lapsed member | `memberState = lapsed` (had a plan or trial, not entitled) | like a non-member, plus read-only past reviews if approved [OD] |
| Admin | `users.role = ADMIN` (DB is the source of truth, mirrored to the Clerk claim) | admin screens and APIs; bypasses the paywall (as `WEB/lib/auth/require-subscription.ts:42` does today) |
| Socket server, worker, cron | HMAC key set, `CRON_SECRET` | `/api/internal/*`, `/internal/*` on OCI, `/api/cron/*` |
| Provider webhooks | Dodo Standard Webhooks, Clerk Svix | `/api/webhook/*` |

`memberState` is derived in one pure function in `WEB/lib/billing/entitlement-rules.ts`, which already has the tested rules (`isEntitled`, `:56-74`). Two corrections: `active` must also respect `currentPeriodEnd + 3 days` (today `:59` returns true for `active` regardless), and snapshots whose `product_id` is not in the catalogue are refused (`audit-quality` SEC-18).

#### 3.1.2 Enforcement layers

| Layer | Where | Decides | Data source | Failure mode |
|---|---|---|---|---|
| L1 Edge middleware | `WEB/middleware.ts` (rewritten) | Page redirects only: sign-in, onboarding, paywall, admin area; default-deny for non-GET `/api/*` from a foreign origin | Clerk session claims `rc = {ent, onb, role, until}` from `publicMetadata` (custom session token, < 200 bytes) | Stale claim for up to the token lifetime (≈ 60 s) [V]; the `rc_act` cookie bridges checkout return (`inv-pub` §1.2) |
| L2 Server layout | `app/(app)/layout.tsx`, `app/(admin)/admin/layout.tsx` | Same decisions as L1, authoritative for pages | `getViewer()`: 1 indexed select | redirects |
| L3 Route wrapper | `WEB/lib/api/route.ts`: `auth: "public" or "user" or "member" or "member_or_lapsed_read" or "admin" or "internal" or "cron" or "webhook"` | Authoritative for every API | `getViewer()` + DB | 401, 402 (with code), 403 |
| L4 Resource guard | resolvers passed to the wrapper: `participantOf(gameRef)`, `ownerOf(cardRef)`, `threadOwner(threadRef)`, `hostOf(tournamentRef)` | Row-level access | one indexed select, usually joined into the main query | 404 for non-participants (hides existence, as `analysis/[gameId]/route.ts:167-174` does) |
| L5 Socket commands | `WS/` handshake middleware + per-command checks | Identity from the token `sub` only; player-of-game for moves, draws, resign, rematch; `ent` true at handshake to start, join, queue or spectate (a socket whose `ent` is in the past may only join its own `user:` room, X18); `env` must match | signed token; in-memory session | `{ok:false, code}` ack; flood → disconnect |
| L6 Database roles | §1.12.1 | Which service can touch which tables | Postgres grants | permission error, alert |

Middleware is a convenience; L2–L5 are the security boundary.

#### 3.1.3 Resource rules

| Resource or action | Anonymous | Signed-in non-member | Member | Lapsed | Admin |
|---|---|---|---|---|---|
| Marketing, catalogue, How we grade, blog, legal | read | read | read | read | read |
| Public profile `/@user` (if the profile is public) | read (noindex) | read | read | read | read |
| Shared review page `/r/<code>` (owner created it, not revoked or expired) | read summary (no coach, no engine panel) | same | same | same | same |
| Start any game, join a challenge, queue, join a tournament | — | — (402) | yes | — (402 `subscription_required`, reason `expired`) | yes |
| Make moves, offer draws, resign in a live game | — | — | players of that game only (token `sub`) | finishes a game already in progress | players only |
| Spectate a live game | — | — | if the game is public (tournament, or both players public) [OD] | — | yes |
| Read a review | — | — | players of that game | players, if read-only access is approved [OD] | yes (support) |
| Request analysis, coach, bank, puzzles, weakness, lessons | — | — | own data | — | yes |
| Link a Chess.com or Lichess account | — | yes (onboarding) | yes | yes | — |
| Run an import | — | waits for membership | yes | stopped | — |
| Settings, account, membership, export, delete | — | yes | yes | yes | yes |
| Admin CRUD (positions, legends, lessons, tournaments, jobs, users) | — | — | — | — | yes, audit-logged; deletes need Clerk reverification within 10 min |
| `/api/internal/*`, OCI `/internal/*`, `/engine/*` | HMAC only | | | | |

Membership that expires during a live game does not end the game; the socket checks `ent` at handshake and when creating or joining, not on every move.

#### 3.1.4 Middleware route classes (replaces `WEB/middleware.ts:16-37`)

Route classes are data in `WEB/lib/routes/classes/<area>.ts`; the middleware code is frozen after P1 so concurrent phases add a file instead of editing it (feasibility §7).

- **Public:** `/`, `/pricing`, `/how-we-grade`, `/legends(.*)`, `/openings(.*)`, `/learn(.*)` except lesson players, `/blog(.*)`, legal and company pages, `/sign-in(.*)`, `/sign-up(.*)`, `/reset-password`, `/sso-callback`, sitemaps, `/robots.txt`, `/manifest.json`, `/@:user` → `/u/[u]` and `/p/[u]`, `/s/:code`, `/r/:code`, `/join/:code` previews.
- **Signed-in, any membership:** `/onboarding(.*)`, `/checkout(.*)`, `/settings/account`, `/settings/membership`, `/settings/connected`, `/profile/edit`.
- **Member:** every other `(app)` route.
- **Admin:** `/admin(.*)` (claim `role = ADMIN`, then L2).
- **Skip Clerk (matcher exclusions):** `/api/webhook/(.*)`, `/api/internal/(.*)`, `/api/cron/(.*)`, `/api/scraper/(.*)`, the public catalogue APIs `/api/(legends|openings|positions)(.*)` (P8 CAT-1…6 read no session; every request through middleware is an extra edge invocation), `monitoring`, `ingest`, static assets.
- **Scanner early-return:** paths matching `\.(php|env|git|aspx?)$|^/wp-` get a static 404 before any Clerk work (or a Vercel Firewall rule once one of the 3 Hobby rules is free). The root `not-found.tsx` is static with a `useAuth()` island for the signed-in variant, so a probe never costs a dynamic render (api-perf AP-33).
- Middleware stamps `x-request-id` and `x-mw-start: <epoch ms>` on the forwarded request; the route wrapper records `api.mw_lag_ms = handlerStart − mwStart` (05-optimization §2).

### 3.2 Security

#### 3.2.1 Fix first (P1 hotfix lane, before more members arrive)

| # | Problem | Evidence | Fix |
|---|---|---|---|
| S-P0-1 | Clerk secret key committed to a **public** repository | `k8s/secrets.yaml:12` (repo visibility PUBLIC, still in `dev` HEAD) | **Rotate first**, in the Clerk instance that issued it; then delete `k8s/`, the root `docker-compose.yml` build argument, `build-and-push.sh`, `WEB/Dockerfile`; gitleaks in CI with a full-history baseline (`--log-opts=--all`). A history rewrite is optional; the rotation is what matters |
| S-P0-2 | Six admin write APIs unauthenticated | `WEB/app/api/legends/create/route.ts:26`, `legends/[id]/route.ts:27,191`, `chess-positions/create/route.ts:44`, `chess-positions/[id]/route.ts:167,348` | `requireAdmin()` on each now; move to `/api/admin/*` with the wrapper (P12) |
| S-P0-3 | Any signed-in user can end any game | `WEB/app/api/chess/game-over/route.ts:50-58`; also `game-state`, `move` | Internal-only plus a conditional transition now; deleted when the socket writes directly (P2) |
| S-P0-4 | PII and enumeration | `WEB/app/api/user/email/[email]/route.ts`, `user/[referenceId]/route.ts` | Delete both; `GET /api/me` |
| S-P0-5 | Socket identity optional; `accept_draw` unchecked | `WS/utils/socketAuth.ts:72-73,126-129`; `WS/GameSession.ts:487-493` | `SOCKET_AUTH_REQUIRED=true` on both boxes, then remove the flag (P2); player and pending-offer checks |
| S-P0-6 | Socket `/internal/tournament-event` public | `WS/index.ts:42`; `deploy/oci/Caddyfile:7-9` | Signed calls only; Caddy allowlist and unsigned pre-check (§1.8.1); HMAC everywhere in P2 |
| S-P0-7 | `PERF_AUTH_BYPASS` has no production fence | `WEB/lib/auth/resolve-user.ts:82`, `require-subscription.ts:41`, `turbo.json:4` | Throw at module load unless `isNonProd() && ALLOW_TEST_HOOKS=1` (CR-27); require `x-perf-token`; k6 only against dev |
| S-P0-8 | Public game data, including move history and trace headers | `WEB/app/api/chess/game-by-ref/[gameReferenceId]/route.ts` | Participant-only browser route; internal route for the socket until v2 |
| S-P0-9 | `CLAUDE.md` in the public repo maps the attack surface | pushed to `origin/dev`: registrar and its account email, "auto-renew OFF, expires 2027-02-02", server IPs, dev URLs, SSH user, Neon ids | Move the Environments and accounts sections to a gitignored `CLAUDE.local.md` (Claude Code loads it) and keep only the rules in `CLAUDE.md` [OD D18]. Nothing there is a secret, but together it maps the targets and an expiring domain |
| S-P0-10 | The dev environment is a free public copy of the paid product | open Clerk dev sign-up; Dodo test mode accepts public test cards; the coach and worker are reachable; `ssoProtection: null` on `replay-chess-dev` | Turn on **Vercel Authentication** for `replay-chess-dev` (available on Hobby for production deployments) with a **Protection Bypass for Automation** secret; E2E, k6 and OCI → web calls send `x-vercel-protection-bypass`; the Dodo test and Clerk dev webhook URLs carry `?x-vercel-protection-bypass=…` [V2]. Fallback: a middleware dev gate with a signed cookie plus Clerk restricted sign-up on the dev instance [V3]. `X-Robots-Tag: noindex` on dev |
| S-P0-11 | The domain expires on 2027-02-02 with auto-renew off | CLAUDE.md "Environments" (registrar Hostinger) | **Renew now**, turn on auto-renew and the registrar lock, enable 2FA on the registrar account; optionally transfer to Cloudflare Registrar. A lapse takes down the live site, the Clerk production instance (bound to the domain) and Email Routing [OD D17] |
| S-P0-12 | The image optimizer accepts any host | `apps/web/next.config.js:76` (`hostname: "**"`) | Allowlist (Clerk images, `media.playchess.tech`); pre-sized avatars and portraits rendered `unoptimized` (5,000 transformations a month on Hobby) |

#### 3.2.2 OWASP Top 10 (2021) mapped to controls

| Risk | Controls in this architecture |
|---|---|
| A01 Broken access control | §3.1 layers; route wrapper default `auth` is required (no default), lint rule fails a route file without `route({ auth })`; authz matrix tests per route (§5.3.3); 404 masking for non-participants; HMAC on internal paths; Caddy path allowlist |
| A02 Cryptographic failures | TLS everywhere (HSTS preload already in `WEB/next.config.js:101-128`); no stored Lichess token by default (§2.3.2; if kept, sealed with the worker's public key); backups encrypted with `age`; secrets never in `NEXT_PUBLIC_*`; Neon `sslmode=require&channel_binding=require` |
| A03 Injection | Prisma parameterised queries; `$queryRaw` only as tagged templates (lint bans `$queryRawUnsafe`); zod on every input (path, query, body, socket payload, job payload); FEN and UCI validated (`Fen`, `Uci` schemas); coach output rendered as text; JSON-LD through `safeJsonLd` (`WEB/lib/seo.ts`) |
| A04 Insecure design | Threat model per feature in its PR template (who can call it, what it costs, what it reveals); rate limits and quotas on costly routes (coach, import, Chess.com lookup, export, delete, checkout); idempotency keys; one active rated game per user |
| A05 Security misconfiguration | CSP (§3.2.5); `poweredByHeader: false`; image optimizer allowlist instead of `hostname: "**"` (`WEB/next.config.js:73`); service worker `NetworkOnly` for `/api/*`; socket CORS fails closed when `ALLOWED_ORIGINS` is unset (`WS/index.ts:83-89`); `DODO_PAYMENTS_WEBHOOK_KEY` checked at boot instead of the `!` at `webhook/dodo-payments/route.ts:34`; Vercel deployment protection on preview deployments |
| A06 Vulnerable components | Dependabot (npm weekly grouped, GitHub Actions monthly); `pnpm audit --prod` in CI (fail on high); actions pinned by commit SHA; base images pinned by digest; Stockfish built from a pinned tag |
| A07 Identification and authentication failures | Clerk (bot protection on sign-up, `form_password_pwned` checks); step-up reverification for account deletion and admin deletes; session lifetime and inactivity settings [OD]; socket tokens 15 min with `env` claim; `session.revoked` webhook pushes `session:revoked` |
| A08 Software and data integrity failures | Webhook signatures with timestamp tolerance and event-id dedupe; HMAC on internal calls; GHCR images by commit SHA; `--frozen-lockfile`; the bot-game PGN replayed server-side; server-authoritative moves in live games |
| A09 Logging and monitoring failures | `logger.error` calls `Sentry.captureException` (fixes `WEB/lib/logger.ts:42-52`); `audit_logs`; `webhook_events`; alerts (§3.4.4) |
| A10 SSRF | No user-supplied URLs are fetched; Chess.com handles validated and encoded; Lichess URLs are fixed; image optimizer allowlist; OG images render only from share loaders, never from a raw ref or FEN |

LLM-specific (OWASP LLM Top 10): prompt injection cannot escalate because the tools are read-only chess functions with strict schemas and no secrets or PII are in context; output handling is plain text plus the verifier; model denial of wallet is bounded by the cost guards (§1.11.7); untrusted PGN headers are sanitised (§1.11.3).

#### 3.2.3 Secrets management

- **Where they live.** Vercel env vars per project and environment, marked Sensitive; OCI secrets in GitHub Actions secrets (`WS_ENV_FILE`, `WS_DEV_ENV_FILE`, `WORKER_ENV_FILE`, `WORKER_DEV_ENV_FILE`) written to `/opt/replay-chess/.env.*` with mode 600 at deploy; local values in gitignored `.env.development.local` and `.env.test` (CLAUDE.md). Names are the CR-26 list; nothing else is created.
- **One set per environment.** Dev and production never share a key (Clerk dev vs prod, Dodo test vs live, Anthropic workspaces, Neon roles, `INTERNAL_API_SECRET` key sets, `SOCKET_TOKEN_SECRET`, `HASH_PEPPER`, VAPID). The socket token's `env` claim makes a dev token useless on prod.
- **Rotation.** `INTERNAL_API_SECRET` and `SOCKET_TOKEN_SECRET` are key sets with ids, so rotation is: add the new key, deploy everywhere, switch signing (the first key signs), remove the old key after 24 h. Rotate every 180 days and at once after any exposure; `docs/runbooks/rotate-secrets.md`. `HASH_PEPPER` is never rotated (the trial ledger depends on it); it is backed up offline by the owner.
- **Gates.** gitleaks on every PR with the full-history baseline; a CI check that no `NEXT_PUBLIC_` variable name contains `SECRET`, `KEY` (except publishable keys on an allowlist) or `TOKEN`; `turbo.json` `globalEnv` lists every variable the build reads (`audit-quality` B-03); ESLint bans importing `CT/internal/auth` in client code.

#### 3.2.4 Webhook and internal-call verification

| Caller | Verification | Replay protection | Dedupe |
|---|---|---|---|
| Dodo → `/api/webhook/dodo-payments` | Standard Webhooks (`webhook-id`, `webhook-timestamp`, `webhook-signature`) via `@dodopayments/nextjs`; snapshots whose `product_id` is not in the catalogue are refused (`e2e-fixture` is accepted only when `APP_ENV ∈ {dev, test}`) | timestamp tolerance (library default) | `INSERT INTO webhook_events(provider, "eventId", type, "payloadHash", "receivedAt") … ON CONFLICT DO NOTHING` before processing; duplicate → 200; the snapshot write is the CR-25 compare-and-set |
| Clerk → `/api/webhook/clerk` | Svix (`svix-id`, `svix-timestamp`, `svix-signature`) via `verifyWebhook` from `@clerk/nextjs/webhooks` | Svix tolerance | same table, provider `clerk` |
| Vercel Cron → `/api/cron/daily` | `Authorization: Bearer $CRON_SECRET`, timing-safe compare | idempotent handler | — |
| Service ↔ service (all `/api/internal/*`, OCI `/internal/*`, `/engine/*`) | CR-16: `x-rc-kid`, `x-rc-ts` (unix seconds), `x-rc-sig = base64url(HMAC-SHA256(key[kid], ts + "\n" + METHOD + "\n" + path + "\n" + sha256hex(rawBody)))`, constant-time compare (`CT/internal/auth.ts`), **from P2**. Each kid has a path allow-list and, on `/internal/emit`, an event allow-list; Caddy refuses a request without `X-Rc-Sig` before Node | reject if `abs(now − ts) > 60 s`; receivers keep a 2-minute in-memory replay set; mutating internal routes are idempotent by resource id | `/internal/emit` remembers `dedupeKey` for 60 s |
| Scraper → `/api/scraper/positions/import` | API key, made timing-safe (today `WEB/lib/auth/api-key.ts:40` uses `!==`) | — | upsert by FEN |

The static `x-internal-token` survives only inside the socket server's v1 code path (`WS/src/v1/`, behind `PROTOCOL_V1=on`) and is deleted with it. Webhook handlers answer 2xx quickly and push slow work into `after()` or a job. A handler error returns 5xx so the provider retries; every handler is idempotent.

#### 3.2.5 Content Security Policy and headers

Two policies, because a nonce makes a page dynamic in Next.js, and the marketing pages must stay static or ISR for the Hobby budget:

```
# App, onboarding, admin and auth routes (dynamic; nonce generated in middleware, read by next/script)
default-src 'self';
script-src 'self' 'nonce-{NONCE}' 'strict-dynamic' 'wasm-unsafe-eval' https://clerk.playchess.tech https://challenges.cloudflare.com https://media.playchess.tech;   # engine glue importScripts()ed by the same-origin worker shim
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https://img.clerk.com https://media.playchess.tech;   # no images.chesscomfiles.com until the Chess.com terms review (F-API-4)
font-src 'self';
connect-src 'self' https://clerk.playchess.tech wss://ws-chess.playchess.tech https://media.playchess.tech;
media-src 'self' https://media.playchess.tech;
worker-src 'self' blob:;
frame-src https://challenges.cloudflare.com;
object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests;
report-to csp-endpoint;          # Sentry's CSP report URL for the web project

# Marketing and catalogue routes (static or ISR; no nonce)
script-src 'self' 'unsafe-inline' https://clerk.playchess.tech https://challenges.cloudflare.com;
(other directives identical)
```

- Dev swaps `clerk.playchess.tech` for the dev instance's `*.clerk.accounts.dev` host and the socket host for `wss://ws-dev.80-225-200-210.sslip.io`.
- PostHog (`/ingest`), Sentry (`/monitoring`) and Vercel Analytics (`/_vercel/…`) are same-origin, so they need no entries. Google Analytics is removed (PostHog covers it) or added behind consent with its hosts.
- `'wasm-unsafe-eval'` is needed for Stockfish WASM; COEP is not set (threaded WASM is not used, `inv-research` §6.6).
- Roll-out: `Content-Security-Policy-Report-Only` for one week on dev and prod, then enforce behind flag `csp-enforce` (§3.5).
- Other headers: keep XFO DENY, nosniff, Referrer-Policy, Permissions-Policy and HSTS (`WEB/next.config.js:101-128`); add `Cross-Origin-Opener-Policy: same-origin-allow-popups`, `Cross-Origin-Resource-Policy: same-site` on `/workers/*`, and `poweredByHeader: false`.

#### 3.2.6 CORS, CSRF and abuse

- API routes are same-origin; no CORS headers are added. Middleware rejects a mutating `/api/*` request unless `Sec-Fetch-Site: same-origin` or `Origin` equals the app origin (webhooks, internal and cron routes are exempt) → 403 `forbidden`. `same-site` is **not** enough, because `media.playchess.tech` (user avatars) is same-site (feasibility SEC-9).
- The socket server checks `Origin` in `allowRequest` and fails closed when `ALLOWED_ORIGINS` is unset (`audit-socket` F-33). The post-deploy check (§4.3) handshakes from the real dev origin, which catches a wrong `ALLOWED_ORIGINS`.
- Rate limits: P1's fixed-window limiter on authenticated costly routes (CR-19: burst windows in the UNLOGGED table, long windows durable); Vercel Firewall custom rules (3 on Hobby) for anonymous abuse: public search and catalogue JSON per IP, `/sign-*` bursts, scanner paths; until a Firewall rule exists, P1's in-isolate `EDGE_DOC_LIMIT` is **on** for `/api/openings*` and `/api/positions*` (`audit-quality` SEC-09). Clerk bot protection on sign-up; BotID basic checks on checkout [V].
- Socket: per-socket token buckets (20 events/s burst, 10/s sustained for all commands, plus per-command limits, P2 §7.4.8), zod on every payload in dev and test builds and the server always, `maxHttpBufferSize` 16 KB. **Handshake limits per user** (the token `sub`): ≤ 10 open sockets and ≤ 20 handshakes a minute; per IP only as a flood guard (≤ 500 sockets, ≤ 300 handshakes a minute), suspended for 120 s after boot (the restore window), because Indian mobile carriers and campus networks put thousands of users behind a few CGNAT addresses (api-perf AP-17).
- Bot checkpoint (`POST /api/games/[ref]/checkpoint`): bucket `bot-checkpoint` 60 per 60 s per user, `moves ≤ 400`, `rev > stored + 64` → 422, suffix-only replay from the stored `fen` (api-perf AP-32).

### 3.3 Privacy

#### 3.3.1 Personal data inventory

| Data | Where | Why | Shared with |
|---|---|---|---|
| Email, name, avatar | `users` (synced from Clerk) | account, receipts, reminders | Clerk, Resend (email only), Dodo (billing email) |
| Date of birth | `users.dateOfBirth` (exists) | no current purpose | **drop the column** unless an age gate needs it [OD] |
| Clerk user id, our `referenceId` | `users` | identity | PostHog (`referenceId` only), Sentry (`referenceId` only) |
| Chess.com handle, Lichess username (no stored token by default) | `linked_accounts`, `import_cursors` | import | Chess.com, Lichess (requests on the user's behalf) |
| Games, moves, clocks | `games` (`moves`, `moveClocksMs`, `pgn`), `game_players` | the product | opponents (shared games), the worker |
| Reviews, mistakes, cards, weakness profile | analysis tables | the product | Anthropic receives chess facts only (no names, no emails) |
| Coach messages | `coach_messages` (free text may contain anything the user types) | the product | Anthropic (the question text), API terms: inputs not used for training [V: current commercial terms] |
| Billing status, Dodo customer id | `users` | entitlement | Dodo holds the card; we never see card data |
| Time zone, preferences, consent record, push endpoints | `users."timeZone"`, `user_settings` (`prefs`, `consent`), `push_subscriptions` | features, legal proof of consent | push services (endpoint only) |
| IP address, user agent | not stored by us; Vercel and Cloudflare logs; Sentry with `sendDefaultPii: false` | security | Vercel, Cloudflare |
| Hashed email and hashed handles | `trial_ledger` | one trial per person, surviving deletion (disclosed in the privacy policy) [OD] | — |

Processors to list on `/privacy` (CLAUDE.md Phase 0 already adds PostHog): Vercel, Neon, Oracle Cloud, Cloudflare (DNS, R2, email routing), Clerk, Dodo Payments, Anthropic, PostHog, Sentry, Resend, Google (OAuth sign-in), plus Chess.com and Lichess as sources.

#### 3.3.2 Minimisation rules

- Telemetry never carries email, name, FEN, PGN, coach text or free-text notes; ids are `referenceId` only.
- Sentry: `sendDefaultPii: false` everywhere (today `true` at `WEB/instrumentation-client.ts:31`, `WEB/sentry.server.config.ts:20`, `WEB/sentry.edge.config.ts:21`, `WS/instrument.ts:10`); a `beforeSend` scrubber strips `authorization`, cookies and query strings with `token`.
- Prompts: chess facts and the user's question; the opponent's name only as a display label when the user asks about "my opponent" (truncated, sanitised).
- Logs on OCI: no request bodies; user id and game ref only.

#### 3.3.3 Consent

- Strictly necessary without consent: Clerk session cookies, the `rc_consent` cookie, the service worker, error capture without PII and without Replay [OD: confirm the cookie policy treats basic error capture as necessary].
- After "analytics" consent: PostHog capture (initialised with `opt_out_capturing_by_default: true` and memory persistence until opt-in), Sentry Replay (lazy-loaded, error-only).
- Server-side billing and cost events (`trial_started`, `subscription_activated`, `coach_message_completed`) are recorded without device properties as part of running the service [OD: confirm the legal basis in the policy].
- The consent record (`user_settings.consent`: choices, policy version, method, timestamp) is written by `PUT /api/me/consent` and also kept in the `rc_consent` cookie for signed-out visitors.
- Today GA, Vercel Analytics, Speed Insights, PostHog and Replay all load before any consent (`WEB/app/layout.tsx:156-160`, `WEB/instrumentation-client.ts:14,38-48`); `V3CookieConsent` enforcement fixes that.

#### 3.3.4 Account deletion cascade

Order, so that "nothing was deleted" stays true on failure (`inv-acct` §3.8):

1. **Pre-flight (read-only):** typed confirmation equals the current username; Clerk reverification within 10 minutes; block if the user is in a live game (409 `in_game`), is the last admin, or hosts an upcoming tournament (transfer or cancel first).
2. **One transaction:**
   - write `trial_ledger` hashes if a trial was used;
   - insert `account_deletions` (outbox) with the masked email for the confirmation;
   - **anonymise shared rows:** games and tournament standings that involve other people are reassigned to the `DELETED_USER` system row, so opponents keep their history and their reviews (today `onDelete: Cascade` at `WEB/prisma/schema.prisma:90-91` and `:399` would erase them);
   - delete private rows: external accounts and tokens, mistakes, training cards and attempts, training days, coach threads and messages, usage rows, weakness snapshots, preferences, consents, push subscriptions, notifications, shares, imported games that only this user owns, lobby-tournament participations, queued and waiting jobs for the user (`jobs.userId`);
   - delete the `users` row.
3. **After commit:** `ACCOUNT_PURGE` performs the external steps (§2.3.8).
4. **Response:** 200 `{deleted:true, emailMasked}`; the client signs out and shows the `deleted` state (`V4DeleteAccount`).
5. **Later:** backups age out within 30 days (§3.3.5), which is what the copy "Backups clear within 30 days" promises.

The schema change from `Cascade` to `SetNull` or `Restrict` on those foreign keys is a contract migration with owner confirmation (§4.6).

#### 3.3.5 Retention

| Data | Kept | Mechanism |
|---|---|---|
| Games played here, analyses, mistakes, cards, attempts | for the life of the account | — |
| Imported games without analysis | newest 2,000 per member | `HOUSEKEEPING` |
| Coach messages | 180 days (threads kept, emptied) | `HOUSEKEEPING` |
| Coach usage counters | 13 months | `HOUSEKEEPING` |
| Weakness snapshots | 12 weeks | `HOUSEKEEPING` |
| `jobs` | `DONE` 7 days, `FAILED` 30 days | `HOUSEKEEPING` |
| `webhook_events` | 30 days (payload hash only after 7 days) | `HOUSEKEEPING` |
| `audit_logs` | 2 years | — |
| `rate_limit_buckets` (UNLOGGED, bursts) | 2 hours | `HOUSEKEEPING` |
| `rate_limit_windows` (logged, long windows) | until `resetAt` | `HOUSEKEEPING` |
| `idempotency_keys` | 24 hours | `HOUSEKEEPING` |
| Read notifications | 90 days | `HOUSEKEEPING` |
| Exports on R2 | 7 days | R2 lifecycle rule |
| Backups on R2 | 14 daily + 2 weekly (≤ 30 days) | R2 lifecycle + `BACKUP` handler |
| Lapsed members | after 12 months without a membership: imported unanalysed games, coach messages | `HOUSEKEEPING` |
| Socket journals | 1 hour after the game is persisted | websocket |
| Sentry, PostHog | per vendor plan; PostHog person deleted on account deletion | vendor |

#### 3.3.6 Data export (GDPR Art. 20)

`POST /api/me/export` (once a day) → `EXPORT_BUILD` → a ZIP streamed to R2 with `games.pgn` (all games, PGN with our annotations as comments), `reviews.json`, `mistake_bank.json`, `training_history.json`, `coach_threads.json`, `settings.json`, `account.json` (profile, linked handles, membership summary) and a `README.txt` describing each file → email with a 7-day presigned link; `V4SettingsAccount` shows the state (`requested`, `ready`, `expired`).

### 3.4 Telemetry

#### 3.4.1 Sentry

| Item | Setting |
|---|---|
| Projects | `replay-chess-web` (exists, org `replay-chess-uf`; client, server, edge), `replay-chess-socket`, `replay-chess-worker` (new) |
| Environments | `local`, `ci`, `dev`, `production`, from `NEXT_PUBLIC_APP_ENV` / `APP_ENV` (as `WEB/instrumentation-client.ts:11` already does) |
| Release | git SHA (`VERCEL_GIT_COMMIT_SHA` on Vercel, `${{ github.sha }}` in the OCI images); source maps uploaded at build |
| Errors | 100 %; `logger.error` → `captureException(err, {extra})` |
| Traces (web) | `tracesSampler`: 0 for `/api/health`, static, status polls; 1.0 for checkout, webhooks, cron, internal routes; 0.2 for coach and review; 0.05 default in production; 1.0 in dev (today `tracesSampleRate: 1`, `WEB/sentry.server.config.ts:13`, `WEB/instrumentation-client.ts:17`) |
| Traces (socket) | 0.1 for socket events, a span per internal HTTP or DB call; the per-game `continueTrace` is removed (`audit-socket` §20) |
| Traces (worker) | one transaction per job (low volume), engine spans sampled at 0.1 |
| Replay | session 0, on-error 1.0, lazy-loaded after consent |
| User context | `Sentry.setUser({ id: referenceId })` in the route wrapper, socket handshake and job context; never email |
| Tags | `service`, `route` or `event` or `job_kind`, `auth`, `member_state`, `app_build`, `request_id` |
| Tunnel | `/monitoring` stays, excluded from middleware |
| Monitors | Sentry cron check-ins for `HOUSEKEEPING` (with `DAILY_PLAN`) and `BACKUP` [V: free-plan monitor count] |

#### 3.4.2 Logs and metrics

- Socket and worker log structured JSON (pino) with `svc, env, lvl, msg, requestId, game, ply, user, job, kind`; warn and above also go to Sentry Logs (`enableLogs` is already on); clock internals log at debug only (`audit-socket` §13).
- Metrics: the socket metrics in `audit-socket` §20 (`ws.loop_lag_ms`, `ws.move_latency_ms`, outbox depth and age, `ws.persist.fail` vs `ws.persist.reconnect` for Neon-suspend closes, end methods, reconnects, rate limits), the worker metrics in §1.10.5, and the **server-side SLO metrics** (`worker.review_ready_ms{band}` = `analysis:done` emit time − `games."completedAt"`, also kept as `game_analyses."readyMs"`; the coach `firstSentenceMs` column; `api.mw_lag_ms`; `webhook.handle_ms`), through Sentry metrics [V4] with the worker's `/internal/metrics` read by `ops-weekly.yml` as the fallback. PostHog keeps funnels, not SLOs, because client events are consent-gated.
- Uptime: UptimeRobot (free) every 5 minutes on `https://www.playchess.tech/api/health` (DB probe with a 2 s timeout), `https://ws-chess.playchess.tech/health` and `/ready`, and the dev equivalents; alerts to the owner's email. A status page (`status.playchess.tech`) is optional [OD].

#### 3.4.3 PostHog conventions

- **Event names:** `area_object_action` in snake case (`review_summary_viewed`, `coach_message_sent`, `bank_session_completed`, `checkout_started`). Areas: `landing, auth, onb, pricing, checkout, home, play, queue, game, review, coach, train, bank, puzzle, weakness, learn, legend, opening, profile, settings, membership, tournament, admin, system`.
- **Registry:** every event and its property schema lives in `packages/analytics/src/events/<area>.ts` (zod; built in P1, consent-aware from P11; one owner per event, CR-32). `track(name, props)` only accepts registered names; CI fails on an unregistered `capture` call. The per-area event lists in the inventories (`inv-pub` §1.11, `inv-sys` §9, `inv-acct` §8.4, `inv-play-b` §3.12, `inv-rct-b` §5.7) are merged into it.
- **Properties:** snake case; units as suffixes (`_ms`, `_count`, `_usd_micro`); booleans as `is_` or `has_`; enumerations in lower snake case; never PII, FEN, PGN or free text.
- **Super properties** (registered once): `app_env`, `app_build`, `device_class` (`desktop`, `ipad_l`, `ipad_p`, `phone`), `viewport_w_bucket`, `zoom_bucket` (`80`, `90`, `100`, `110`, `125`, `150`, `other`), `member_state`, `is_trial`, `is_pwa`, `signed_in`.
- **Person properties:** `rating_band`, `goals`, `plan_interval`, `trial_used`, `signup_source`, `linked_providers`, `classifier_version_seen`.
- **Identity:** `distinct_id = users.referenceId` (X14); `posthog.identify` after sign-in; `reset()` on sign-out; a one-time `alias` from the old Clerk id for existing persons.
- **Server events** (`posthog-node` in web routes via `after()` with `await posthog.shutdown()`; batched in the worker): billing truths (`trial_started`, `subscription_activated`, `subscription_cancelled`, `payment_failed`, `payment_recovered`), `analysis_completed {duration_ms, queue_wait_ms, plies, eval_source}`, `import_finished {provider, games, skipped}`, `coach_message_completed {input_tokens, output_tokens, cache_read_tokens, cost_usd_micro, verified, fallback}`, `notification_sent`, `account_delete_completed`.
- **Volume control:** sampled events (`shortcut_used`, `nav_clicked`, `route_loading_ms` at 10 %); no per-move or per-tick events.
- **Separation:** one project, filtered by `app_env` (CLAUDE.md telemetry tag); synthetic e2e and k6 users carry `is_synthetic` and are excluded by a project filter.
- **Funnels and dashboards:** acquisition (`landing_viewed` → `auth_signup_completed` → `onb_plan_checkout_started` → `trial_started` → `onb_completed` → `review_summary_viewed`), trial conversion (`trial_started` → `subscription_activated` at day 8 vs `subscription_cancelled`), activation (first review within 24 h, first bank session within 72 h), coach cost per member, cancel-flow save rate (`inv-acct` §8.4).

#### 3.4.4 Alerts (owner email; one channel to start)

| Alert | Source | Condition |
|---|---|---|
| New production issue | Sentry | first seen in `production` |
| Error spike | Sentry | > 50 events in 10 min in `production` |
| Webhook failures | Sentry | any error in `/api/webhook/*` |
| Socket health | Sentry metrics | `ws.persist.fail` (excluding `ws.persist.reconnect`) > 0 for 5 min; outbox oldest > 60 s; loop lag p99 > 100 ms for 5 min |
| Worker | Sentry | §2.5 |
| Uptime | UptimeRobot | 2 failed checks |
| Spend | Anthropic workspace limits; Neon and Vercel usage emails | 80 % of budget |

### 3.5 Feature flags

#### 3.5.1 Two kinds of switch

| | Product rollout flags | Operational kill switches |
|---|---|---|
| Purpose | Ship a phase dark, roll out to dev, then to a percentage, then to everyone | Turn a costly or broken feature off in seconds, even if PostHog is down |
| Store | PostHog feature flags | Vercel Edge Config store `replay-ops` (with env-var defaults) |
| Evaluated | Server-side in `getViewer()` with `posthog-node` local evaluation (definitions polled every 30 s per function instance), passed to the client through `ShellState` and posthog-js `bootstrap`, so there is no flicker | Web: memoised read per instance (30 s). OCI services: poll the Edge Config read endpoint every 5 minutes (≈ 17k reads a month for two services, inside Hobby's 100k) |
| Default on error | **off** (new feature stays hidden) | the last known value; the env default if none |
| Examples | below | `maintenance` (`off`, `scheduled`, `active` + times + message), `coach_enabled`, `imports_enabled`, `analysis_enabled`, `signups_enabled`, `min_client_build`, `coach_daily_budget_usd` |

The socket server and worker never evaluate PostHog flags per user. Their behaviour follows the protocol version (`proto`) or the job payload, which web decides.

#### 3.5.2 Rules

- Names are kebab case with an area prefix where useful (`review-v3`); each flag has an owner, a creation date and an **expiry date** in its PostHog description, and a removal task in the phase that ships it.
- At most about 10 live rollout flags at a time. A flag older than its expiry fails a weekly CI report.
- Rollout ladder: `app_env = dev` 100 % → internal and synthetic users in production → 10 % of members → 100 % → remove the flag and the old code.
- Flags never gate security: authorisation does not depend on a flag value.

#### 3.5.3 Initial flags (allocation §1.6 names plus CR-29)

| Flag | Phase | Kind | Gates |
|---|---|---|---|
| `shell-v3` | P1 | PostHog | v3 app shell, rail and tab bar, `ViewportStage` |
| `csp-enforce` | P1 | PostHog | switches CSP from report-only to enforced |
| `live-protocol-v2`, `game-v3` | P2 | PostHog | socket v2 commands; the v3 game screen |
| `review-v3`, `review-share`, `review-lapsed-read`, `analysis-live-prewarm` | P3 | PostHog | `/review/[ref]`; shares; lapsed read-only reviews (only if B26 allows); websocket posts live plies to the worker |
| `import-v3`, `onboarding-v3` | P4 | PostHog | linking and import UI; onboarding |
| `train`, `home` | P5 | PostHog | Train hub, bank and puzzle sessions; Home |
| `weakness` | P6 | PostHog | weakness screens and jobs |
| `coach` (+ the P7 flags in its spec) | P7 | PostHog + Edge Config kill switch `coach_enabled` | Ask the Coach; LLM review text |
| `learn-v3` | P8 | PostHog | lessons, catalogue, legend practice |
| `play-hub-v3` | P9 | PostHog | play hub, queue, challenges |
| `account-v3` | P10 | PostHog | profile and settings |
| `public-v3` (deploy-scoped), `auth-v3` (Edge Config key `replay-ops.flags.auth_custom_flows`), consent bar (env `NEXT_PUBLIC_CONSENT_BAR`, **not** Edge Config) | P11 | as named | public pages, custom auth flows, consent bar |
| `admin-v3` (+ P12's tournament flags) | P12 | PostHog | admin, arena |
| `coach-voice` | later | PostHog | spoken answers |

Flag registrations live in `WEB/lib/flags/registry/<phase>.ts` (one file per phase, feasibility §7). Names not in allocation §1.6, this table or a phase spec's §7 do not exist (`new-shell`, `mistake-bank`, `puzzles`, Edge Config `consent_bar`).

---

## 4. Environments and release process

### 4.1 Environment matrix

| | local | ci (GitHub Actions) | dev | production |
|---|---|---|---|---|
| Web | `next dev` :3000 with `.env.development.local` | `next build && next start` in the runner (also the target of the nightly device × zoom matrix) | Vercel `replay-chess-dev` (production branch `dev`, `target: production`) → `https://replay-chess-dev-replaychess007-1069.vercel.app`, behind Vercel Authentication + automation bypass | Vercel `replay-chess` (production branch `main`, created at go-live) → `https://www.playchess.tech` |
| Socket | `pnpm --filter web-socket dev` :3002 | in-runner; per-worker fixture server on :3102 with `TIMING_PROFILE=fast` | OCI dev box 80.225.200.210 → `wss://ws-dev.80-225-200-210.sslip.io` | OCI socket box 132.226.190.10 → `wss://ws-chess.playchess.tech` |
| Worker | `pnpm --filter analysis-worker dev`; `ENGINE=native` or `ENGINE=fake` | `ENGINE=fake` (scripted UCI); nightly real Stockfish on `ubuntu-24.04-arm` | dev box container (`cpu.idle` slice) | worker VM `10.42.0.30` (P13) |
| Database | Docker Postgres 17, or the Neon dev project (CLAUDE.md) | **Docker `postgres:17-alpine`** for integration and e2e; never Neon | Neon project `replay-chess-dev` (P1 1B·H10; until then the `dev` branch of `withered-cake-82837167`) | Neon `withered-cake-82837167` branch `production` |
| Clerk | development instance | development instance, `@clerk/testing` tokens | development instance (restricted sign-up [V3]) | production instance (`t0wy2xb4vvpw`, bound to the domain) |
| Dodo | test mode | test mode for the checkout spec; mocked elsewhere | test mode (webhook → dev URL with the bypass parameter) | live mode |
| Anthropic | `replay-dev` workspace or recorded fixtures | recorded fixtures / `COACH_LLM_PROVIDER=mock`; nightly `replay-ci` smoke with a cost guard | `replay-dev` | `replay-prod-web`, `replay-prod-worker` |
| R2 | `replay-dev-*` buckets | none (local fixture server; the engine is served from disk with `page.route`) | `replay-dev-*` | `replay-*` |
| Email | Resend test mode, or console | none | Resend, allowlisted recipients only | Resend live, from `hello@playchess.tech` |
| Sentry env | `local` (DSN unset by default) | `ci` | `dev` | `production` |
| PostHog | off (key unset) | **the local sink** (`WEB/e2e/mocks/posthog-sink.ts` :4011) | `app_env=dev` | `app_env=production` |
| Edge Config | env-var fallback | env-var fallback | `replay-ops-dev` | `replay-ops` |
| `APP_ENV` / test hooks | `dev` | `test`, `ALLOW_TEST_HOOKS=1` | `dev`, `ALLOW_TEST_HOOKS=1` | `production` (hooks refuse to load, CR-27) |
| Data | seeds + synthetic users | seeds + global-setup provisioning per run | seeds + synthetic users A–R and the persona pool `E2E_POOL_01…24` | real data; never copied to other environments without owner approval and anonymisation |

**The dev project split is a P1 day-1 task (1B·H10)**, about an hour of owner work: dump the `dev` branch and restore it into the new Free project `replay-chess-dev` (`pg_dump` → `pg_restore` on the owner's machine), set autoscaling max 0.5 CU, repoint `apps/web/.env.development.local`, `.env.test`, the Vercel `replay-chess-dev` env, `WS_DEV_ENV_FILE` and `WORKER_DEV_ENV_FILE`, and update CLAUDE.md's environments table (owner). Until it lands, k6 runs, worker backfills and the P4 import fixtures do not start, because on the Free plan the 100 CU-h cap is per project and running out suspends every compute in it, the live site included (audit-db DB-01, api-perf AP-01). It also removes the "dev is a child of production" hazard (a mistaken "reset from parent" would copy production into dev). The weekly CU-h report (`ops-weekly.yml`, Neon consumption API, alert at 50 % pro-rata) starts in P1 as well.

### 4.2 Branches and promotion

```
feature/*  ──PR──►  dev  ──(auto)──►  dev environment  ──release PR──►  main  ──(ordered pipeline)──►  production
   ▲                                                                       │
   └──────────────── hotfix/* ──PR──► main, then main is merged back into dev ┘
```

- Work happens on short-lived branches off `dev` (CLAUDE.md "Work happens on the `dev` branch"), merged by squash after the PR gates (§4.4).
- A **release** is a PR from `dev` to `main`, opened when the dev environment has passed the release gates. Its description lists migrations (expand or contract), flags to flip, and the manual device checks done.
- **Hotfix:** branch from `main`, PR to `main` with the smoke gates plus the specs for the affected area, then merge `main` back into `dev`.
- Commit and PR attribution follow the session's attribution rules; PR templates include the security and data-impact checklist (§3.2.2 A04).

### 4.3 CI/CD workflows (`.github/workflows/`)

| Workflow | Status | Trigger | Jobs |
|---|---|---|---|
| `ci.yml` | **new (P1)** | PR to `dev` or `main`; push to `dev` or `main` | `verify` (install with filters, lint, `tsc` for every app and package, `prisma validate`, gitleaks with the history baseline, `pnpm audit --prod`, `license-checker`, **`check-test-globs`**, the registry lints: cache tiers, GET purity, room and priority literals, test-hook registry); `unit` (`node:test` via `tsx`, every package); `contracts` (OpenAPI regenerate + diff, breaking-change check, socket schema and size tests); `integration` (`postgres:17-alpine` service → `migrate deploy` → seeds → `test:int` for web, WS and packages; queue, races, query budgets; the index-existence and `EXPLAIN` gate); `migrations` (destructive-SQL lint, `scripts/db/check-drift.ts` from P2); `build` (`next build`, **blocking** bundle budgets from P1: marketing ≤ 180 kB, app ≤ 300 kB gz, middleware ≤ 100 kB, no `ZodError` or `@tanstack/query-core` in marketing chunks); `e2e-smoke` (production build, socket from source, Docker Postgres, `BILLING_PAYWALL=on`, projects `chromium` 1440 × 900 and `webkit-iphone`, `--grep @smoke`, the 4 PR device projects for changed areas) |
| `nightly.yml` | **new (P1)** | schedule `30 21 * * *` + `workflow_dispatch` | `e2e-full` (main config, sharded × 4, paywall on, includes the `flags-off` project); `devices-full` (all 40 device × zoom projects + UI projects against the **CI-local build**, sharded × 4); `visual`; `state-coverage`; `dev-url` (the `@smoke` subset against the deployed dev URL: desktop-1440 and iPhone at 100 % only); later phases append: P2 resilience, P3 arm64 goldens and label stability, P4 provider canary, P6 weakness recompute check; flag-expiry report. Runs that share the Neon dev project or the Clerk dev users use `concurrency: e2e-dev-shared` |
| `post-deploy-dev.yml` | **new (P1)** | `deployment_status` success from Vercel `replay-chess-dev` | `/api/health` `buildId` equals the SHA; a socket.io handshake from `Origin: https://replay-chess-dev-replaychess007-1069.vercel.app` to the dev socket succeeds (catches a wrong `ALLOWED_ORIGINS`); `@smoke` against the dev URL with the bypass header |
| `weekly-full-dev.yml` | **new (P1)** | weekly | one full deployed run of the main suite against the dev URL (the only full run against deployed dev, to stay inside Hobby quotas) |
| `ops-weekly.yml` | **new (P1)** | weekly | Vercel usage API (invocations, edge requests, FDT, image transformations, Speed Insights, Edge Config reads) and Neon consumption API for both projects; opens an issue at 50 % pro-rata (Neon) or 60 % (any Hobby quota, which also stops deployed test traffic, §1.13.3) |
| `backup-prod.yml` | **new (P1, interim)** | nightly | `pg_dump` of live production → `age` → R2 (§2.3.9); weekly restore check; retired when the P13 worker `BACKUP` job runs |
| `e2e-tests.yml` | **change (P1)** | today: push and PR to `main` only, paywall off (`:3-8`, `:57`, `:79`) | becomes the release-PR gate: the full main + devices suites on the release SHA with the paywall on and Docker Postgres instead of `PERF_DATABASE_URL` (`:30-35`) |
| `deploy-oci.yml` | **change** | reusable workflow (`workflow_call`) invoked by `release-dev.yml` and `release-prod.yml`, plus `workflow_dispatch` with `environment`, `image_tag` (rollback) and `force` (deploy during a tournament). The push-to-`main` trigger (`:18-24`) is removed | `needs: ci`; build two arm64 images (`websocket`, `worker`) on `ubuntu-24.04-arm`; drain the socket through the signing CLI (§4.5.2); `docker compose pull && up -d` on the socket box (and on the worker VM in prod); wait for `/ready`; roll back to the previous tag if `/ready` fails for 2 minutes. Rule: no socket image rollback during a live arena (roll forward, or cancel the arena from admin) |
| `release-prod.yml` | **new** | push to `main` (Vercel Git auto-deploy off for the two release branches via `"git": {"deploymentEnabled": {"main": false, "dev": false}}`; feature-branch previews stay on) | 1. `db-migrate` (GitHub environment `production`, owner approval): delete the old manual snapshot, take a new one, `prisma migrate status`, `prisma migrate deploy`; 2. `deploy-oci.yml` (prod); 3. `vercel build --prod && vercel deploy --prebuilt --prod`; 4. smoke (`@public` + `@prod-smoke` + one synthetic member); 5. Sentry release finalise, PostHog annotation |
| `release-dev.yml` | **new** | push to `dev` | the same ordered steps for dev (migrate the dev project → OCI dev → `vercel deploy --prebuilt --prod` to `replay-chess-dev`), without the approval, so dev rehearses exactly what production will run; `post-deploy-dev.yml` follows |
| `perf-tests.yml` | **change** | `workflow_dispatch` + at most once per phase | k6 scenarios in §5.8 against dev only; usage recorded before and after (k6 against dev counts against the team's Hobby quotas); results written as JSON to `perf/results/` |
| `coach-live.yml` | new (P7) | nightly | ten fixed questions against the real model with the `replay-ci` key and a cost guard |
| `update-snapshots.yml` | new (P1) | PR label `update-snapshots` | regenerates visual baselines in the official Playwright image |
| `indexnow.yml` | keep | — | — |
| `dependabot.yml` + Renovate | **new** | weekly npm (grouped), monthly GitHub Actions | `package.json` and the lockfile have one steward a week |

Vercel settings (`WEB/vercel.json`, the file the project actually reads; check the Root Directory with Vercel MCP `get_project`):

```json
{
  "regions": ["iad1"],
  "crons": [{ "path": "/api/cron/daily", "schedule": "0 9 * * *" }],
  "installCommand": "pnpm install --frozen-lockfile --filter web...",
  "ignoreCommand": "npx turbo-ignore web",
  "git": { "deploymentEnabled": { "main": false, "dev": false } },
  "functions": {
    "app/api/coach/messages/route.ts":             { "supportsCancellation": true, "maxDuration": 60 },
    "app/api/coach/messages/[ref]/retry/route.ts": { "supportsCancellation": true, "maxDuration": 60 },
    "app/api/games/[ref]/pgn/route.ts":            { "supportsCancellation": true, "maxDuration": 30 },
    "app/api/me/export/download/route.ts":         { "supportsCancellation": true, "maxDuration": 30 }
  }
}
```

Request cancellation is opt-in per function on Vercel (verified 2026-11-02). Without it the coach's Stop never reaches `request.signal`: the model keeps streaming and billing, and every Stop becomes a counted `done` (api-perf AP-02). The exact path-key format for App Router functions is verified on the dev deployment (the docs' example uses `api/*`), and P7's acceptance test aborts a stream on the deployed dev URL after the first `sentence` and asserts `coach_messages.status = 'ABORTED'` within 2 s with no quota increment. Node 24 in project settings (X13). Preview deployments for PRs keep deployment protection on and use the dev database; a PR that adds a migration skips its preview or gets its own branch of the dev project [V].
### 4.4 Testing gates per stage

| Stage | Must pass | Time budget |
|---|---|---|
| PR → `dev` | `ci.yml` (all jobs), including `e2e-smoke` with the paywall on, the authz matrix, `check-test-globs`, the registry lints and the bundle budgets | ≤ 15 min |
| Merge to `dev` | `release-dev.yml` (dev migrations, OCI deploy, Vercel deploy) then `post-deploy-dev.yml` (build id, socket handshake from the real origin, `@smoke` against the dev URL) | ≤ 15 min |
| Nightly | `nightly.yml`: full main suite + `flags-off`, the 40-project device × zoom matrix against the CI-local build, visual regression, axe, state coverage, oracle, goldens and label stability, provider canaries, coach live smoke; `@smoke` against the deployed dev URL | ≤ 60 min, sharded × 4 |
| Weekly | one full deployed run against dev; `ops-weekly.yml` quota report | ≤ 60 min |
| Once per phase | k6 scenarios (§5.8) against dev, usage recorded before and after | ≤ 45 min |
| Phase sign-off (DoD rules 9–14, §5.12) | all of the above green on the phase's final `dev` SHA; state coverage 0 missing; telemetry asserted; `quarantine.json` without expired entries; `docs/qa/phase-NN-signoff.md` committed after a ≥ 24 h test window | — |
| Release PR `dev` → `main` | latest nightly green on the release SHA; `e2e-tests.yml` on the release SHA; migration rehearsal on a child branch of production; manual checklist (tap-to-move on a real iPhone and Android phone, PWA install and update, Dodo test checkout with the trial) signed off in the PR | — |
| Merge to `main` | `release-prod.yml` with owner approval of the migration step, then `@prod-smoke` (includes `prod-guard.spec.ts`: every registered test hook is 404 or ignored) | ≤ 20 min |

### 4.5 Deploy ordering and zero downtime

#### 4.5.1 Order inside one release

1. **Expand migration** (additive: new tables, nullable columns, new indexes) on production. Old code keeps working against the new schema.
2. **Worker**, then **socket server** (both tolerate old and new web clients; the socket speaks protocol v1 and v2 for one release).
3. **Web** (Vercel).
4. Flags flipped in PostHog per the release notes.
5. **Contract migration** (drop columns or tables, tighten `NOT NULL`, change foreign keys) only in a **later** release, after the code that stopped using the old shape has run in production for at least a week.

#### 4.5.2 Socket server drain

1. The workflow runs the signing CLI on the box (`docker compose exec websocket node dist/cli/internal.js broadcast --in 60`, kid `ops`; `/internal/broadcast` and `/internal/drain` are blocked at Caddy). If a tournament is live and `force` is not set, the deploy waits up to 30 minutes, then fails without restarting.
2. The server emits `server:restarting {restartAt, resumes: true}` (the in-game chip in `V3Maintenance`), stops accepting new queue entries and game creations (ack `{ok:false, code:"draining"}`), and lets live games continue.
3. At `restartAt`: flush every outbox to Neon, `fsync` the journal, `io.close()`, exit. `stop_grace_period: 45s` gives it time (today Docker kills it after 10 s and nothing is flushed, `audit-socket` §10).
4. The new container restores from the journal and the database by replaying plies (`audit-socket` §18.4), freezes clocks until both players reattach or 60 s pass, and clients resync from `game:snapshot`.

Socket deploys from `dev` hit only the dev box. Production socket deploys go through `release-prod.yml`, so routine merges never restart production games.

#### 4.5.3 Worker restart

`SIGTERM` → stop claiming → finish the current position → checkpoint → release the job to `QUEUED` → exit (§1.9.6). A restart costs at most one position of work.

#### 4.5.4 Web

Vercel deployments are atomic. Old browser bundles keep calling the API; additive contracts and the `x-rc-build` check (§1.6.4) handle the skew, and the PWA update chip waits until a game ends (`V3PwaUpdate`).

### 4.6 Database migration flow (per CLAUDE.md)

| CLAUDE.md rule | How this flow honours it |
|---|---|
| 1. Schema changes on prod/shared databases: `db push` | **Conflicts** with rule 3, with the environments section of the same file ("All migrations applied with `prisma migrate deploy`") and with this plan's hand-written SQL (partial indexes, `UNLOGGED`, storage parameters), which `db push` would drop. CR-35: no `db push` on any Neon branch, dev included. Rewording rule 1 is owner decision **D5**; until the owner rewords it, the plan's rule is the stricter one, and the CLAUDE.md safety rules (2–5) apply in full |
| 2. `migrate dev` only on local, resettable databases | Never run in CI or against any Neon branch; migration SQL is generated with `migrate diff` against a **local Docker** shadow database |
| 3. `migrate deploy` is the safe way to apply to prod | The only command that changes production, run by `release-prod.yml` after owner approval; also the only command used on the dev project |
| 4. Re-sync history with `migrate resolve --applied` | The drift procedure below |
| 5. Ask before any destructive command | Contract migrations are separate PRs labelled `db-contract` whose description states "This command may reset/drop your database. Are you sure?"; the GitHub environment approval is the owner's explicit yes; the destructive-SQL lint blocks them otherwise |

Steps for one schema change:

1. Edit `DB/prisma/schema.prisma` (moved from `WEB/prisma/schema.prisma` by P2 WP-A so web, socket and worker share one client; `_prisma_migrations` stores folder names only, so the move is safe).
2. Start a local shadow: `docker run -d --rm --name rc-shadow -e POSTGRES_PASSWORD=pw -p 55433:5432 postgres:17-alpine`. **Prisma wipes the shadow database**, so the shadow URL is never a Neon URL.
3. Generate the SQL without touching any shared database:
   `pnpm --filter @repo/db exec prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url postgresql://postgres:pw@localhost:55433/postgres --script > prisma/migrations/<YYYYMMDDHHMMSS>_<name>/migration.sql`
4. Hand-edit what Prisma cannot express: partial indexes (`jobs_ready_idx`, `games_open_idx`), `NOT VALID` foreign keys followed by `VALIDATE CONSTRAINT` in their own file, `UNLOGGED`, storage parameters; once a table passes about a million rows, `CREATE INDEX CONCURRENTLY` in a one-statement file. Start each hand-edited file with `SET lock_timeout = '5s';`. Add the header `-- kind: expand` or `-- kind: contract` (and `-- destructive: yes` where it applies). Every enum value is `ALTER TYPE … ADD VALUE IF NOT EXISTS` in **its own file** and is not written by code until the next release (§4.7). Partial-index names go into `DB/prisma/protected-indexes.txt`.
5. CI: the destructive-SQL lint (`DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, `ALTER … TYPE`, `SET NOT NULL`, `DROP CONSTRAINT`, `DELETE FROM`, `UPDATE` without `WHERE` → requires `db-contract`); `scripts/db/check-drift.ts` (created by P2; runs `migrate diff --script`, ignores `DROP INDEX` lines for protected names and the storage-parameter lines, fails on anything else; it replaces P1's raw `migrate diff --exit-code`, which fails as soon as a partial index exists); `migrate deploy` from scratch on the CI Postgres; the index-existence check (every index named in a phase's "Indexes and the queries they serve" table exists in `pg_indexes`).
6. Merge to `dev`: `release-dev.yml` runs `prisma migrate deploy` on the dev project with the owner role's direct URL (host printed and checked first), before the new code deploys.
7. Release: rehearse on a child branch of production (`neonctl branches create --project-id withered-cake-82837167 --parent production --name rehearse-<sha>`, `migrate deploy`, smoke, delete); delete the previous manual snapshot and take a new one (Free keeps one); the owner approves the `production` environment; `prisma migrate deploy` with the production direct URL; `prisma migrate status` must report no pending migrations.
8. **Data backfills** are idempotent TypeScript scripts in `DB/scripts/backfill-*.ts` (or `WEB/scripts/backfill/*.ts` before the move), batched by 500 ids, `--dry-run` first with printed counts, run by `workflow_dispatch` with the same environment approval. They are never part of a migration file.
9. **Drift recovery:** compare with `prisma migrate diff --from-url "$PROD_DIRECT_URL" --to-migrations prisma/migrations --shadow-database-url <local shadow>`; if the database already has a migration's changes, mark it with `prisma migrate resolve --applied <name>` (rule 4). Never "fix" drift with `migrate dev` or `migrate reset`.
10. Runtime roles cannot run DDL (§1.12.1), so a mistaken command with a runtime URL fails safely.

### 4.7 Rollback and incidents

| Component | Rollback | Time |
|---|---|---|
| Web | Vercel Instant Rollback. **Hobby reaches only the previous deployment** (dev until P13); production on Pro can reach older ones | < 1 min |
| Socket, worker | `deploy-oci.yml` `workflow_dispatch` with the previous `image_tag`; journals keep live games. Journal records carry a version byte, and an older image skips journals with a newer version instead of crashing; P13 preflight checks journal compatibility between the launch image and the previous one. No socket rollback during a live arena | ≈ 3 min |
| Database | Forward fix only (expand/contract keeps old code compatible). Data loss: restore to a new branch from Neon history (6 h on Free; 7 days on Launch once set) or from the latest R2 dump, then switch the connection strings. Every restore step needs the owner's confirmation (CLAUDE.md rule 5) | 30–60 min |
| A broken feature | Kill switch in Edge Config, or the PostHog flag | < 1 min |
| **A broken service worker** (the slowest rollback) | ship the emergency build with `SW_KILL_SWITCH=1`: `skipWaiting`, delete all caches, `registration.unregister()` (P11); documented in `docs/runbooks/rollback.md` | one deploy |

**Cross-cutting rollback rules** (every phase; feasibility §9):

1. **Enum values take two releases.** Release N adds the value to the schema and the client and does not write it; release N+1 writes it. Rolling back from N+1 to N is then safe; rolling back across N would make the old Prisma client throw on read. For fast-growing sets, `text` + a zod enum avoids the hazard (§1.10.1).
2. **Versioned payloads.** Journal records, job payloads, `jobs.progress`, SSE frames and JSON columns carry `v`; readers ignore an unknown newer version instead of crashing.
3. **Legacy screens stay one release** after their parity gate, so a rollback lands on working code.
4. **Redirects that cannot be undone** (P8's 308s for slugs) are 307 on dev and become 308 only in production at P13.
5. **Data that can be rebuilt says so** in its phase spec: FSRS state from `training_attempts`, weakness snapshots from analyses, ratings from `game_players.rating{Before,After}` (P9 keeps them append-only), imported rows by `IMPORT_PURGE`.

Per-phase rollback sections (§14.x "Rollback") are mandatory in every phase spec; P2's covers the `live-protocol-v2` off switch, the journal version byte, the expand-only M2 and the legacy path kept one release after the gate.

Incident steps: post a `system:notice` (Edge Config `maintenance`) so users see `V3Maintenance`; follow the runbook; write a short post-mortem in `docs/postmortems/YYYY-MM-DD-<slug>.md` (timeline, cause, fix, follow-ups, the regression test that now guards it).

---

## 5. Testing strategy

The owner's requirement: **after each phase, test the system in the browser and write regression and e2e tests.** The phase specs carry the per-phase test lists; this section fixes the plumbing that makes those lists run, stay trustworthy and actually gate a phase (critique-testing X1–X18). P1 builds all shared tools (≈ +2.5 dev-days); each later phase adds ≈ 0.5 dev-day for tags, telemetry assertions, persona writers and its axe and visual states.

### 5.1 Pyramid, runner and layout

| Layer | Tool | Runs | Budget |
|---|---|---|---|
| Unit (pure packages and functions) | **`node:test` via `tsx`** in every package and app (SPEC D13; the 12 existing `node:test` files keep working). If the owner prefers Vitest, every package switches in P1, never half-way | every PR | < 30 s |
| Contract (HTTP, socket, webhooks, providers, LLM) | `node:test` + zod schemas from `CT/{http,socket,internal}` | every PR | < 60 s |
| Integration (route handlers, queue, socket server, worker) | `node:test` + Docker Postgres 17 + in-process servers + fake engine | every PR (`ci.yml` `integration`) | < 4 min |
| E2E | Playwright (`WEB/e2e`, main config + `playwright.devices.config.ts`) | `@smoke` per PR; full suite and the device matrix nightly; `@smoke` after every dev deploy | smoke ≤ 10 min; matrix ≤ 60 min sharded |
| Visual regression | `toHaveScreenshot` in `mcr.microsoft.com/playwright:v<same version as @playwright/test>-noble` | nightly, release | in the matrix run |
| Accessibility | `@axe-core/playwright` on every e2e page visit | nightly + PR smoke | — |
| Load | k6 (`perf/k6`), dev only | once per phase and before hot-path releases | ≤ 45 min |
| Chess correctness | `CF` corpus + golden files | unit on PR; real-engine goldens and label stability nightly on arm64 | — |
| Resilience | scripted fault tests | nightly | — |

**One layout** (X1): unit tests sit beside the source as `*.test.ts`; DB-backed tests are `*.int.test.ts`; route, contract and authz tests live under `WEB/test/{api,integration,authz}/` (no `WEB/tests/`). Scripts in `WEB/package.json`:

```json
"test:unit": "tsx --test \"{app,lib,components,features,scripts,worker,prisma,e2e/devices,e2e/fixtures}/**/!(*.int).test.ts\"",
"test:int":  "tsx --test \"**/*.int.test.ts\" \"test/**/*.test.ts\""
```

Every package and `WS`/`WK` get `test` and `test:int` with the same pattern. **Orphan guard:** `REPO/scripts/qa/check-test-globs.mjs` runs `git ls-files '*.test.ts' '*.test.tsx'`, expands each package's test globs and fails CI on any file no script runs.

### 5.2 Unit tests (what must be covered)

- `CA` (chess-analysis): `winPct`, per-move and game accuracy against reference values (±0.01); the 12 labels in precedence order with threshold edges; key-moment selection; phase detection; the verifier rules V1–V8; **the grades corpus** (§5.9) as a pure classifier test over stored evals.
- `PKG/game-core`: the reducer for every transition of the v2 state machine with a fake clock; draw cooldowns; auto-draw order; timeout vs insufficient material; abort windows; presence grace; rematch expiry; ply idempotency; restore by replay keeps threefold detection; a property test of 1,000 random games agreeing with chess.js; Glicko-2 (both presets) against published examples; the one time-control classifier.
- `TRN` (chess-training): FSRS grade mapping, release-hour snapping across time zones and DST days, daily and new-card caps, offline replay ordering.
- `CT/internal/auth.ts`: HMAC sign and verify, clock skew, replay set, key rotation, kid allow-lists; socket token claims (`env`, `exp`, `kid`, `v`).
- Web: entitlement and `memberState` matrix; the CR-25 compare-and-set (a webhook older than a refresh must not overwrite it, and the reverse); trial eligibility with the ledger; the rate-limit spec rules (a `windowSec > 300` with `store: "burst"` throws); coach usage guard maths; CSP builder; overlay arbitration; `safeReturnPath`; `lib/billing/catalog.test.ts` (`e2e-fixture` accepted only in dev and test); `lib/api/now.test.ts` (`x-rc-now` honoured only with the token in dev and test); `lib/test-hooks/registry.test.ts`; `fallbackInterval` stops after `stopAfterMs` even when re-created every render.
- Worker: priority and `fairSeq` ordering, back-off schedules, `DAILY_PLAN` row generation across DST, trial-reminder skip rules, provider back-off on 429 and `Retry-After`, **the timer audit** (24 simulated idle hours ≤ 5 DB round trips).
- Socket: `TIMING_PROFILE` refused with `APP_ENV=production` (`WS/test/timing-profile.test.ts`); frame-size tests with realistic fixtures (25-char ref, real FEN, longest legend prefix); emit allow-lists per kid.

### 5.3 Contract tests

#### 5.3.1 HTTP

- Every route's request and response schemas live in `CT/http`. `pnpm contracts:openapi` turns them into `docs/api/openapi.json` with zod 4's `z.toJSONSchema()`. CI regenerates it and fails if the committed file differs, then runs a breaking-change diff against `main` (`oasdiff breaking`); a breaking change needs the `api-breaking` label and a versioned path.
- Route tests call the handler with a mocked auth context and parse the response with its schema, including every documented error code from the CR-18 ledger.
- **Registry lints** over `@repo/contracts/registry`: `public-*` tiers only with `auth: "public"`; per-user routes only `private-etag`, `no-store` or `sse`; any `max-age > 0` on a non-public route fails; GETs with writes only if `sideEffects` declares them.
- Query budgets: integration tests count statements per screen loader and fail above the budget the phase spec records (§9.2 of each phase).

#### 5.3.2 Socket protocol

- `CT/socket` schemas are imported by the server, the web client (validation only in dev and test builds, through a dynamic import) and k6.
- **Golden transcripts:** for each of the 55 `V3Game` states a fixture lists the commands and the expected event sequence (`CF/socket/transcripts/*.json`). The server test replays the commands against an in-process server and compares the emitted events (time-normalised). The client test feeds the same events to the game store and asserts the `phase` that matches the design state.

#### 5.3.3 Authorisation matrix

A generated test walks `app/api/**/route.ts`, reads each handler's declared `auth` and resolver from the wrapper, and calls it as each actor: anonymous, signed-in non-member, member, a different member (not a participant or owner), lapsed member, admin, valid internal signature per kid, forged or expired signature, a kid outside the route's allow-list. Expected statuses come from `WEB/test/authz/matrix.ts`. A new route without a row fails CI.

#### 5.3.4 Webhooks

Recorded Dodo test-mode payloads and Clerk payloads, signed with test secrets: valid; bad signature; stale timestamp; duplicate event id (second call is a no-op); snapshots out of order (older event does not overwrite newer state, CR-25); unknown product id refused; refund and dispute revoke access. The Clerk `user.created` vs first `/api/me` race ends with one user row.

#### 5.3.5 Providers

A fixture server (`WEB/e2e/mocks/upstream` on :4010, P4) replays recorded Chess.com and Lichess responses: 200, 304 with ETag, 404, 429 with `Retry-After`, a 5xx, private or empty archives, and an ndjson stream with clocks, evals and division. Importer tests assert serial access and cursor resume. The nightly provider canary (P4) fetches one public account from each real API, read-only.

#### 5.3.6 LLM

Recorded Anthropic responses drive the coach route (`COACH_LLM_PROVIDER=mock`): a tool round, a refusal, an overloaded error, a mid-stream abort, a stream that fails the verifier twice (engine-line fallback), and the prompt-injection corpus with a canary (P7). Assertions: only verified sentences are emitted; usage and quota are recorded or not charged correctly; no history message is mutated; `cache_read_input_tokens` is logged. Nightly `coach-live.yml` runs ten fixed questions against the real model with a cost guard. The deployed-abort acceptance test (§4.3) runs against the dev URL.

### 5.4 Integration tests

- **Queue:** two worker loops against one Postgres claim 1,000 jobs with no job claimed twice; the reaper re-queues a job whose heartbeat stopped; `ON CONFLICT` dedupe; a kick during sleep re-arms the timer; `fairSeq` interleaves two users; the `lastKickAt` CAS lets one kick through per 30 s under 10 concurrent pollers.
- **Races:** two concurrent joins of one challenge → exactly one 409; concurrent finishes → stats counted once; concurrent coach requests with the same `clientId` → one model call; duplicate training attempts → one row; a card graded while an analysis of the same user commits → W1 p95 < 300 ms.
- **Socket server** (in-process, `socket.io-client`, fake clock, real Postgres): join, move, reconnect, multi-tab, spectators, drain → restart → restore with no lost plies, rate limits, per-user handshake limits, token rejection (wrong `env`, expired), `draw:accept` rules, Neon-suspend error classification.
- **Worker** (fake UCI engine answering from a fixture map): the whole analysis pipeline writes the expected `GameAnalysis`, reviews, mistakes and cards in one batch; kill during pass 1 → resume from the checkpoint; import with the provider fixture server; entitlement wait and release.

### 5.5 End-to-end: one device × zoom matrix, tiered (X9)

The matrix lives in one place, **P1 SPEC D7**: 8 base devices × 5 zooms = 40 projects in `WEB/playwright.devices.config.ts` (desktop 1440 × 900 and 1280 × 800, iPad landscape 1194 × 834, iPad portrait 834 × 1194, iPhone 393 × 852, Android 412 × 915, plus the SPEC's remaining bases; zoom 80, 100, 110, 125, 150 %). Zoom emulation: browser zoom `z` on a `W × H` screen gives a CSS viewport of `W/z × H/z` and a device pixel ratio of `dpr × z` (DS README "Browser zoom").

- **Tiering:** PR CI runs 4 projects (`desktop-1440@100`, `desktop-1280@125`, `iphone@100`, `ipad-portrait@100`) for the changed areas; nightly runs all 40 against the **CI-local build** (`next build && next start`, Docker Postgres, the socket in a container, the upstream mocks, the engine served from disk with `page.route`); the deployed dev URL gets only the smoke subset nightly and one full run weekly (a full deployed matrix would be ≈ 1–6.5M CDN requests a month against Hobby's 1M, feasibility F-VER-3).
- **The one-viewport assertion** (`WEB/e2e/fixtures/one-viewport.ts`, every page with a board): the board's bounding box lies inside the viewport; `document.scrollingElement.scrollHeight <= innerHeight + 1`; both player bars, both clocks and the primary controls are in the viewport; a board square is at least 220 / 8 px; listed controls are at least 44 × 44 CSS px; the phone tab bar is hidden on immersive routes; no toast intersects the board.
- **Stress data:** demo data gets a `stress=1` variant (20-character usernames, 120-ply move lists, the longest opening names, 300-row banks, both colours); the one-viewport assertion runs on it at `@150` on all devices.
- **Real-route layer:** `e2e/devices/layout/routes.real.ts` runs each phase's main real routes signed in as a shared member on `desktop-1440@100/150`, `iphone@100/125` and `ipad-portrait@100`. P1 starts it with `/play`, `/tournaments`, `/legends`, `/openings`, `/profile/<A>`.
- **CLS ≤ 0.02 at 80–150 % zoom** is a lab gate in this matrix, not a field SLO (field data cannot segment by zoom).
- Manual zoom checks in ego-browser stay: emulated zoom does not reproduce real font hinting or every media query. Real devices: each release PR records a manual pass on a real iPhone and Android phone for tap-to-move, drag, premove and PWA install.

### 5.6 Visual regression (X10, owner P1)

- `toHaveScreenshot` in the official Playwright image; `snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{testFilePath}/{arg}{ext}"`; `page.clock.install({ time: FIXED_NOW })`; `reducedMotion: "reduce"`; masks on `[data-vr-mask]` (avatars, relative dates); `maxDiffPixelRatio: 0.002`; baselines change only through the `update-snapshots` label workflow, which regenerates them in CI.
- First baselines (P1): `/dev/ui/sections/{foundations,controls,overlays,shell,layout}` and `/dev/ui/shell` × the 4 UI projects × light and dark. Each later phase adds 4–8 key states (P4, P5, P8, P9 and P12 included).
- Design parity with the `.dc.html` boards stays manual: the boards need the Claude Design runtime, which is not in the repo. The sign-off records a side-by-side check of the canvas board at its `$preview` size next to the demo route.

### 5.7 Accessibility

axe on every e2e page (no serious or critical violations; P4, P10 and P12 included); a keyboard-only spec for the board (keyboard move entry, focus outline per the DS README); a unit test that computes contrast for token pairs from `tokens.json` (body text ≥ 4.5 : 1; today `--cb-text-muted` is 2.4 : 1, `audit-quality` A-01).

### 5.8 Load tests (k6, dev only)

Existing scenarios (`perf/k6/src/scenarios/`) move to protocol v2. Additions:

| Scenario | Target | Load | Thresholds (`abortOnFail` for the hard SLOs) |
|---|---|---|---|
| `ws-ramp-colocated` | dev box while the worker drains a seeded backlog in its `cpu.idle` slice | 250 → 2,000 sockets, one move per 5 s per game | server `ws.move_latency_ms` p95 < 50 ms; k6 `ws_move_duration` p95 < 150 ms; `ws.loop_lag_ms` p99 < 50 ms; no flag disputes; RSS < 1.5 GB |
| `analysis-throughput` | dev worker | 200 seeded games of mixed length | games per hour ≥ the target computed from `stockfish bench`; priority-80 wait p95 < 60 s while the backlog runs (5 live games at `JOB_PRIORITY.GAME_ENDED`) |
| `api-read-mix` | dev web | 50 VUs over `/api/me`, review, `train/today`, bank list | p95 within §1.6.7; error rate < 0.5 % |
| `train-write-burst` | dev web | 100 VUs posting attempts with retries | p95 < 200 ms; no lost or duplicated attempts |
| `coach-sse` | dev web with `COACH_FAKE_UPSTREAM=1` | 20 concurrent streams, some aborted | first sentence p95 < 1.5 s with the stub; no dropped streams; aborts end `ABORTED` |
| `matchmaking` | dev socket | 200 searchers | match p95 < 5 s; zero HTTP calls |

Auth uses Clerk testing tokens or perf-minted socket tokens on dev; `PERF_AUTH_BYPASS` refuses to load outside `isNonProd() && ALLOW_TEST_HOOKS=1`. Results are data (X18): each run writes `perf/results/p<NN>-<scenario>-<sha>.json`, and `perf/compare.ts` flags a regression > 15 % against the previous phase for the shared scenarios (`me`, `api-read-mix`, `ws-ramp`, `train-session`). Usage of the Hobby quotas is recorded before and after each run.

### 5.9 Chess-correctness fixtures (`packages/chess-fixtures/`)

| Corpus | Content | Assertion |
|---|---|---|
| `pgn/rules/` | castling-rights edge cases, en passant (including the discovered-check case), promotion and under-promotion, stalemate, threefold by transposition, 50- and 75-move rules, insufficient material, timeout vs insufficient material, FEN-start games with Black to move | `game-core` end detection and PGN builder agree with chess.js |
| `perft/` | start position depth 4 (197,281), Kiwipete depth 3 (97,862) | guards chess.js upgrades |
| `design/*.json` (P2) | every FEN and SAN sequence used in the `DR/` boards (`V3BankSession` `P`, `V3ReviewSummary` `GAME` and `CLEAN`, …) | legal under chess.js |
| `grades/positions.jsonl` (P3, ≥ 80 lines) | `{id, fen, move, evalBefore, evalAfter, best, secondGapWinPct?, legalCount, expected: {label, winPctLossApprox}, source}`: Win% thresholds at 4.99/5.00/9.99/10.00/14.99/15.00; mate created, lost and delayed; MISS; GREAT; BRILLIANT (Opera Game 16.Qb8+) and not BRILLIANT above +300; FORCED; the BOOK boundary and a FEN start (never BOOK); Fool's Mate `2.g4??`; Scholar's Mate `3…Nf6?? 4.Qxf7#`; Légal's trap; KT `24.Rxd4`; Byrne–Fischer `17…Be6` | exact labels from stored evals (pure); nightly eval provenance on arm64 within ±30 cp or the same mate distance. P5 derives "becomes a bank item", P6 its `errorLog` judgements and P7 its "wrong severity" sentences from the same lines |
| `analysis/oracle/` | 30 Lichess-analysed games with Lichess judgements and accuracy | accuracy within ±1; judgement agreement ≥ 90 % |
| `analysis/golden/` | 10 games analysed by the real arm64 Stockfish with the P3-D9 profile, `EVAL_CACHE=off`, fresh engine per game, `Threads 1`, no resume | byte-identical `GameAnalysis`; plus the label-stability run (cache warm, crash and resume at ply 20: ≥ 98 % identical labels, all key moments, accuracy ±0.5) |
| `puzzles/` | 1,000 CC0 puzzles replayed from their source positions | ≥ 90 % reproduce the published solution |
| `themes/` | CC0 puzzles with tags | tier-1 recall ≥ 85 % |
| `verifier/` | known-bad and known-good sentences (+ P7's 120-sentence adversarial corpus) | 100 % of bad rejected; < 2 % of good rejected |
| `fsrs/` | grade sequences, DST boundary days (`America/New_York`) and a no-DST zone (`Asia/Kolkata`) | intervals and due times |

### 5.10 Resilience tests (nightly, CI or dev)

`kill -9` the socket server mid-game → no ply lost, clocks frozen then resumed; **suspend the Neon dev compute mid-game** (Neon API) → the first checkpoint after it is a `ws.persist.reconnect`, not a failure, and the game persists; block Neon for 2 minutes (network policy in the CI container) → the outbox buffers and live games continue; kill the worker mid-job → resume from the checkpoint; duplicate kicks → no double processing; Anthropic 529 and timeout → fallback text; Dodo webhooks duplicated and out of order; the Clerk webhook arriving after the first `/api/me`.

### 5.11 Test data, personas, time and hooks

- **Test databases (X16).** CI integration and e2e run on Docker Postgres 17: `migrate deploy`, `prisma/seed.ts`, the opening seed, the P1 content seed, then global-setup provisioning. Only the dev-URL jobs touch Neon (the dev project). `pnpm --filter web e2e:reset-dev` re-runs the provisioning, the content seed and the persona resets on dev, never drops anything, and refuses non-dev hosts (P1 `seed-guards.ts`).
- **Paywall on (X3).** `BILLING_PAYWALL=on` in `ci.yml`, `nightly.yml`, `e2e-tests.yml` and the devices build. `WEB/e2e/global-setup.ts` entitles A–P idempotently; `e2e/fixtures/health.ts` fails the run when any of A–P has `currentPeriodEnd < now + 30 d`, Q has lost `trialUsedAt`, or R has a subscription. The few specs that need the paywall off say so with `test.use({ paywall: "off" })` in a separate project.
- **User registry and leased personas (X4).** `WEB/e2e/fixtures/users.ts`: A–P are shared members (specs only **add** data and never assert absolute counts); Q trial-used and R never-trialled are read-only; `E2E_ADMIN_EMAIL` is the admin (not a letter). Exact states come from the leased pool `E2E_POOL_01…24` (permanent Clerk dev users, no churn): `leasePersona(name)` takes a row lock in the dev-only table `e2e_leases(userRef, runId, expiresAt)` (TTL 15 min) and resets the user with `WEB/scripts/dev/personas.ts --reset <pool user> --persona <name>` (`bank-empty`, `bank-caughtup`, `weak-insufficient`, `coach-capped`, `lapsed`, `onboarding-fresh`, …; each phase adds its writers). Truly destructive flows (P10 deletion, P11 sign-up) create one throwaway `e2e-<flow>-<runId>@…+clerk_test` user; `WEB/e2e/scripts/sweep-throwaway-users.ts` deletes any older than 2 h and fails within 20 users of the Clerk dev cap. `users.test.ts` fails a spec that mutates a shared letter or leases a persona twice without `mode: "serial"`. Matchmaking isolation: with `APP_ENV=test` the queue key includes `e2eRun` from the socket token; on the dev URL the queue specs run in a `play-queue` project with `workers: 1`.
- **Server time (X5).** `route()` builds `ctx.now` from `x-rc-now: <epoch ms>` only when `isNonProd()` and `x-e2e-token == E2E_TEST_TOKEN`; services take `now` as an argument (ESLint bans `new Date()`/`Date.now()` in `lib/services/**` and `lib/data/**`); SQL binds `$now`. Fixture `e2e/fixtures/time.ts` provides `serverNow.set(iso)`. Socket and worker: `TIMING_PROFILE=fast` scales study, first move, reconnect grace, rematch TTL, queue widen and timeout, `ending_soon` and `no_show` to 2–5 s, only with `APP_ENV=test` (the process exits otherwise); specs assert the server's `deadlineAt`. One `@slow` spec per timer runs nightly with real timings.
- **Telemetry (X6).** Event registry `packages/analytics/src/events/<area>.ts` (zod, closed property sets; `track()` typed against it). Client sink `window.__rcTelemetry` when `NEXT_PUBLIC_TELEMETRY_SINK=1` (only in `APP_ENV=test` builds; sampling forced to 100 %). Server sink: `POSTHOG_HOST` → `WEB/e2e/mocks/posthog-sink.ts` (:4011) records web `after()`, socket and worker events (`GET /__events`). Fixture `telemetry.expect(name, match, {count})`, `telemetry.none(name)`, an auto-use check that parses every captured event against the registry, and a **PII guard** (email, FEN prefix, PGN move run, the user's name or email, any text the spec typed via `telemetry.forbid`). After P11 the fixture sets the consent cookie by default; only `consent.spec.ts` covers the reject path. `REPO/scripts/qa/error-window.ts --since <deploy time>` prints new Sentry issues per project and Vercel runtime errors for the DoD.
- **Console guard (X7).** Auto-use `WEB/e2e/fixtures/console-guard.ts` fails a test on `pageerror`, `console.error`, hydration messages and any `/api/*` ≥ 500 the spec did not inject with `x-rc-fault`; per-spec allowlist `test.use({ allowConsole: [...] })`.
- **Test hooks (X12).** `WEB/lib/test-hooks/registry.ts` lists every hook `{kind: "route" | "header" | "env", id, phase, guard}`; every guard calls `isNonProd()` plus `ALLOW_TEST_HOOKS=1` (and `x-e2e-token` for request hooks), never "`APP_ENV=dev` only" (CI runs `APP_ENV=test`). `WEB/e2e/specs/prod-guard.spec.ts` runs against the production-mode build (port 3200) and iterates the registry: routes 404, headers ignored, env hooks refuse to boot. P13 adds it to `@prod-smoke`.
- **Fixtures that call removed APIs (X17).** P1 F4d rewrites `signIn()` (`WEB/e2e/fixtures/auth.ts:51,59`, `tournament-helpers.ts:46,54`) to `GET /api/me`; P4 replaces the onboarding skip with provisioning `onboardingStep = DONE`.

### 5.12 Design-state coverage, regression scope, flakes and sign-off

- **State manifest (X8).** `REPO/docs/qa/design-states.json`, generated from `DR/*.dc.html` by `REPO/scripts/qa/extract-design-states.ts` (board, enum options, owner phase from 07-design-coverage), with reviewed `ignore: true` entries for tweak enums in `design-states.overrides.json`. Specs tag what they reach: `@state:V3Game.your_move` (real data) or `@demo:V3Game.your_move` (demo route). `REPO/scripts/qa/state-coverage.ts` compares `playwright test --list --reporter=json` against the manifest filtered to `phase ≤ CURRENT_PHASE` (`docs/qa/phase.txt`): missing fails CI; demo-only needs a written reason.
- **Regression = the whole suite (X11).** Every spec carries `@p<N>`. The regression gate for phase N is the entire main suite plus the entire devices suite on the final SHA with the paywall on (nightly) plus one run against the dev URL. A `flags-off` project sets `FLAGS_OVERRIDE` to turn the open phase's flags off and runs the earlier phases' `@smoke` specs, until the flags and the legacy code are deleted; P11 adds an `sw-on` project. After each parity deletion a grep test lists the deleted modules.
- **Every bug gets a test; quarantine (X14).** Every defect found in the owner test, the ego-browser checklist or the real-device pass gets a failing automated test first, named `regression: <slug> (#issue)`. `WEB/e2e/quarantine.json` (`{testId, reason, owner, expires ≤ 14 d}`) builds a PR-CI `grepInvert`; nightly still runs and reports quarantined tests; an expired entry fails CI; `retries: 1` in CI, and two flaky nights quarantine a test automatically with an issue opened. P13's "known-flaky list empty" means this file is empty.
- **Sign-off record (X15).** `REPO/docs/qa/phase-NN-signoff.md`, committed: SHA, Vercel deployment id, OCI image tags; each owner-test row with pass/fail and screenshot path (`docs/qa/phase-NN/`); real devices (model, OS), browsers and zoom levels; the state-coverage table; the `error-window.ts` output for ≥ 24 h after the last dev deploy; the PostHog live-view check (`app_env=dev`); k6 result files; defects with their regression tests. The test window runs from the last dev deploy of the phase to sign-off, at least 24 h. The dev URL is `https://replay-chess-dev-replaychess007-1069.vercel.app` (CLAUDE.md). Each manual ego-browser checklist ends by closing its pages (`task.finish({ keep: [] })`).

**Definition of done, rules 9–14** (appended to allocation §1.1 rules 1–8):

9. **CI ran it.** The phase's specs ran green in CI on the final `dev` SHA with `BILLING_PAYWALL=on`: `ci.yml` (unit, integration, contracts, `e2e-smoke`), the nightly full main and device suites, and the post-deploy smoke against the dev URL; `check-test-globs` confirms every new test file ran.
10. **States are covered by machine.** `state-coverage` shows 0 missing states for the phase's boards; every demo-only state has a written reason.
11. **Telemetry is asserted.** Every event the phase adds is in the registry and asserted in at least one spec through the sink (exactly once for server events); the PII guard is green; the PostHog live view on dev was checked by hand.
12. **Regression is the whole suite.** All phases' specs are green (main, devices, `flags-off` for the phase's open flags, `sw-on` from P11), plus the phase's targeted list.
13. **Hooks and data are clean.** Every test hook the phase adds is registered and proven 404 or ignored in the production-mode build; no spec mutates a shared letter user; exact states come from leased personas.
14. **Defects have tests, and there is a record.** Every defect found by hand has a regression test; `quarantine.json` has no expired entries; `docs/qa/phase-NN-signoff.md` is committed.

**Who builds which shared test tool**

| Tool | Built in | Where |
|---|---|---|
| Unit globs, `check-test-globs.mjs`, `WEB/test/` layout | P1 | `WEB/package.json`, `REPO/scripts/qa/` |
| `ci.yml` integration and e2e-smoke, `nightly.yml`, `post-deploy-dev.yml`, `weekly-full-dev.yml`, `ops-weekly.yml`, `E2E_BASE_URL` + the Vercel bypass in `playwright.config.ts` (`webServer` only when `E2E_BASE_URL` is unset; `@local-only` specs skipped against a URL) | P1 | `REPO/.github/workflows/`, `WEB/playwright.config.ts` |
| Paywall on, the `e2e-fixture` catalogue rule, `health.ts` | P1 | `WEB/e2e/global-setup.ts`, `WEB/lib/billing/catalog.ts` |
| User registry, persona lease pool, sweeper | P1 (each phase adds personas) | `WEB/e2e/fixtures/{users,lease}.ts`, `WEB/scripts/dev/personas.ts`, `WEB/e2e/scripts/sweep-throwaway-users.ts` |
| `x-rc-now` / `ctx.now` | P1 | `WEB/lib/api/route.ts`, `WEB/e2e/fixtures/time.ts` |
| `TIMING_PROFILE` and the per-worker fixture socket server | P2 | `WS/src/config/timing.ts`, `WEB/e2e/fixtures/socket-server.ts` |
| Event registry, sinks, PII guard, `error-window.ts` | P1 (consent-aware in P11) | `REPO/packages/analytics/src/events/`, `WEB/e2e/mocks/posthog-sink.ts`, `WEB/e2e/fixtures/telemetry.ts`, `REPO/scripts/qa/error-window.ts` |
| Console guard | P1 | `WEB/e2e/fixtures/console-guard.ts` |
| `design-states.json`, `state-coverage.ts` | P1 | `REPO/docs/qa/`, `REPO/scripts/qa/` |
| Visual tooling and `update-snapshots` | P1 | `WEB/playwright.devices.config.ts`, `WEB/e2e/__screenshots__/` |
| `flags-off` project, `@p<N>` tags | P1 | `WEB/playwright.config.ts` |
| Test-hook registry, `prod-guard.spec.ts` | P1 | `WEB/lib/test-hooks/registry.ts`, `WEB/e2e/specs/prod-guard.spec.ts` |
| `quarantine.json` and the flake policy | P1 | `WEB/e2e/quarantine.json` |
| `CF` with design-FEN extraction and socket transcripts | P2 | `REPO/packages/chess-fixtures/{design,socket}/` |
| `grades/positions.jsonl`, eval provenance, label stability | P3 | `REPO/packages/chess-fixtures/grades/`, `nightly.yml` |
| Provider canary | P4 | `nightly.yml` |
| `sw-on` project | P11 | `WEB/playwright.config.ts` |
| k6 result files and `compare.ts` | P1 | `REPO/perf/results/`, `REPO/perf/compare.ts` |
| Sign-off record template | P1 | `REPO/docs/qa/phase-NN-signoff.md` |

---

## 6. Build order (13-phase numbering)

### 6.1 Crosswalk from the 10-phase numbering used by revision 1 and `docs/implementation-plan.md`

| Old | New | Old | New |
|---|---|---|---|
| 1 | P1 | 6 | P6 |
| 2 | P2 (matchmaking moves to P9, arena to P12) | 7 | P7 |
| 3 | P3 | 8 | P8 Learn + P9 Play hub + P12 tournaments and admin |
| 4 | P4 | 9 | P10 account area + P11 public, auth, system and PWA |
| 5 | P5 (notifications and the release push move to P10) | 10 | DoD rules in every phase + P13 launch |

### 6.2 Architecture work per phase

| Phase | Architecture work | Notes |
|---|---|---|
| **P1** (hotfix lane first) | S-P0-1 … S-P0-12 (§3.2.1); **1B·H10 dev Neon project**; **1B·H11 `backup-prod.yml`**; OCI PAYG + quotas; UptimeRobot on the dev socket; `sendDefaultPii: false`, trace sampling; `logger.error` → `captureException`; Caddy allowlist; `CT/http` (`codes.ts` ledger), `route()` wrapper with the six cache tiers, `ctx.now`, rate-limit `store`, registry `sideEffects`; `getViewer()` (one round trip with `relationLoadStrategy: "join"`), `GET /api/me`, Clerk webhook, middleware rewrite with claims, scanner early-return and the catalogue matcher exclusion; the CR-25 billing compare-and-set (F4b) and `POST /api/billing/refresh`; `POST /api/session/clear`; one `api()` with `devSchema()`; CSP report-only; registry directories (`lib/api/keys/`, `lib/flags/registry/`, `lib/routes/classes/`, `lib/cron/tasks/`, `lib/realtime/handlers/`, `config/redirects/`, `lib/seo/robots-rules/`, `e2e/personas/`) and `OWNERS.yml`; **every shared test tool in §5**; `ci.yml`, `nightly.yml`, `post-deploy-dev.yml`, `ops-weekly.yml`; Node 24; Edge Config ops switches; consent-gated PostHog with the event registry; `vercel.json` (regions, install filter, `functions`) | The foundation every later route uses. Estimate grows with the critique fixes (P1 spec) |
| **P2** | `packages/db` move; `PKG/game-core`; `CT/socket` (+ `rooms.ts`, registry) and `CT/internal/auth.ts` (HMAC, kids); socket v2 with direct DB writes (`DB/src/live/*`), journal, outbox, drain, restore, Neon-suspend handling, per-user handshake limits, `session:hello`; `scripts/db/check-drift.ts`; engine from R2 with the same-origin shim and GPL files; `TIMING_PROFILE`; socket integration tests and golden transcripts | `audit-socket` priorities |
| **P3** | `apps/analysis-worker`: queue (`fairSeq`, `lastKickAt`), kicks, the next-due timer, `HOUSEKEEPING` + `DAILY_PLAN`, engine pool, SQLite eval cache, analysis pipeline (one HTTP batch), template review text; worker image and dev compose with the `cpu.idle` slice; `release-dev.yml`, `release-prod.yml`, `db-migrate`; the grades corpus, goldens and label stability | Benchmark Stockfish on the A1 first (C1) |
| **P4** | importers, provider gate, the worker lookup fallback, daily sync, Lichess token handling per §2.3.2, `AuditLog` (M4), `User.timeZone` (M4), provider fixture server and canary | |
| **P5** | grading route, the outbox, bank rows inside the analysis batch, `EXTRACT_MISTAKES`; the client release-hour timer | Node 24 for ts-fsrs v6 |
| **P6** | `RECOMPUTE_WEAKNESS`, baseline build script, the weekly roll as a `DAILY_PLAN` row | |
| **P7** | coach route with `supportsCancellation` and the stop beacon, `/engine/analyse`, prompt caching on the 5-minute TTL, `CT/limits.ts`, `REVIEW_TEXT`, LLM contract tests and `coach-live.yml` | |
| **P8** | catalogue on ISR with no session read, lessons, opening drill; starts after P5 merges or splits (CR-36) | |
| **P9** | `packages/domain`, matchmaking on the socket, challenges, ratings (`PLAY` Glicko preset) | |
| **P10** | notifications (`NOTIFY_*` kinds, web-push, Resend budget from `notifications`), deletion purge, export, trial ledger with `HASH_PEPPER`, the trial reminder, R2 presign helper (or P12, whichever merges first) | |
| **P11** | public pages, custom auth behind `auth_custom_flows`, consent, PWA with per-user page caches and the SW kill switch | after P7 and P10 |
| **P12** | arena, `/api/internal/tournaments/*` (CR-17 exception), `TOURNAMENT_STARTING`, admin | |
| **P13** | prod worker VM (D7), Vercel Pro and Neon Launch (D1, D2), `BACKUP` replaces `backup-prod.yml`, CSP enforcement, `@prod-smoke`, launch | verifies D16 (the dev split) rather than doing it |

**Schedule realism (feasibility §8).** The phase specs total ≈ 255.5 dev-days against 244 in the allocation, and the two phases measured in detail ran 34–46 % over. Each phase §13 carries a 20 % buffer line that is not spent by default. Owner time is the bottleneck (≈ 243 owner questions across the plan set), so the plan keeps one decision register, `docs/decisions.md`, with "the default applies unless the owner objects within 3 days" and a weekly 30-minute decision batch. **Launch A** option [OD D19]: ship P1–P5, P7, a thin P10 (membership, plan switch, cancel, delete, export, connected accounts; ≈ 6 d), a thin P11 (pricing, legal, prebuilt Clerk auth behind the kill switch, error and maintenance pages; ≈ 6 d) and P13 (≈ 162 dev-days); legacy legends, openings, play hub and tournament pages stay inside the shell; P6, P8, P9, P12 and the rest of P10/P11 follow after launch.

---

## 7. Owner decisions

### 7.1 Decisions

| # | Decision | Recommendation | Why it matters |
|---|---|---|---|
| D1 | Vercel plan | **Pro before the first real charge** (a hard launch blocker); consider moving the old account to Pro now, since the live site already charges grandfathered $8 members. The dev project may stay on Hobby | Hobby is licensed for non-commercial use; its quotas fit roughly 700–900 active members |
| D2 | Neon plan and projects | **Launch** for production before go-live, with the 7-day restore window set explicitly; dev and E2E in the separate Free project from **P1** | 100 CU-h a month cannot keep production awake; dev traffic must not spend production's allowance |
| D3 | OCI capacity | The prod worker VM (P13 D7) uses the last free OCPU; any further capacity ("Stage C") is paid, ≈ $14 a month per 1 OCPU / 6 GB [V7], and needs a yes | CLAUDE.md: nothing on Oracle should cost money |
| D4 | OCI tenancy | Upgrade to Pay-As-You-Go **in P1**, with a $1 budget alert and compartment quotas capping A1 at 4/24 | Avoids idle reclamation; quotas prevent accidental paid shapes |
| D5 | CLAUDE.md migration rule 1 | Reword to "every Neon branch: migration files applied with `prisma migrate deploy`; `migrate dev`/`migrate diff` only against a local Docker shadow; no `db push` on Neon" | Removes the contradiction with rule 3 and the environments section; `db push` drops partial indexes |
| D6 | Coach limits | CR-33 (member 30/day, 150/month, $1.50; trial 10/day, 40/trial, $0.40; breaker `max($5, $0.08 × entitled)`); copy "About any move, fair use applies" | Keeps LLM cost under about a quarter of revenue; caps trial exposure |
| D7 | Lapsed members (**B26**) | Decide **before P3** whether past reviews stay readable after a membership ends | Drives `member_or_lapsed_read`, the middleware allowlist and the reachability of 6 designed states and flow edges E41, E78, E80 (coverage C-21) |
| D8 | Spectating | Members only; public games only (tournaments, or both players public) | Socket gating and privacy |
| D9 | Email provider | Resend from `hello@playchess.tech`; decide Resend Pro before P13 | Trial reminders, notifications, deletion and export emails |
| D10 | TTS | Browser `speechSynthesis` now; choose a provider later | Coach voice setting |
| D11 | Error capture and performance metrics under the cookie policy | Treat basic error capture without PII as strictly necessary; Replay only after consent; decide whether anonymous Sentry performance metrics (`{route_class, device_class}`, no user id) count as necessary, because the client-observed SLO numbers depend on it (05-optimization §2) | Consent banner behaviour and SLO coverage |
| D12 | `users.dateOfBirth` | Drop it unless an age gate is planned | Data minimisation |
| D13 | Trial ledger | Keep hashed email and handles after deletion (one trial per person), disclosed in the privacy policy | One-trial rule vs deletion |
| D14 | Backups | 14 daily + 2 weekly, encrypted, nothing older than 30 days; interim GitHub Actions backup from P1 | Matches "Backups clear within 30 days" |
| D15 | Status page | Optional; UptimeRobot's free status page [V5 commercial terms] or Better Stack free | Comms during incidents |
| D16 | Bot games | Accept client-run, unrated bot games with server adjudication | Keeps engine load off the socket box |
| D17 | Domain | **Renew `playchess.tech` now**, auto-renew on, registrar lock, 2FA; optionally move to Cloudflare Registrar | Expires 2027-02-02, before launch; a lapse takes down the site, Clerk production and email |
| D18 | `CLAUDE.md` content in a public repo | Move environments and accounts to a gitignored `CLAUDE.local.md` | It maps servers, accounts and the expiring domain |
| D19 | Scope at launch | Consider **Launch A** (§6.2) | Revenue 3–4 months earlier; tests the paid-coaching hypothesis sooner |
| D20 | Repository visibility | Keep it public (the CI cost model assumes free runners), or budget for CI if it becomes private | A private repo exceeds the 2,000 free minutes and may lose free arm64 runners; a public repo exposes prompts, verifier and constants |
| D21 | Dev gate | Vercel Authentication on `replay-chess-dev` + an automation bypass secret | The dev site is otherwise a free public copy of the paid product |
| D22 | Internal auth | Approve HMAC from P2 (P2 Q17) | Deviates from the B20 wording; the alternative keeps a replayable shared token |
| D23 | Living legends | Portraits only with recorded source and licence (`portraitSource`, `portraitLicence`), otherwise initials; "Play this position" and factual copy for living players | Nothing should imply endorsement (feasibility LIC-6) |
| D24 | Third-party assets | Record the origin and licence of `public/sounds/*.webm` and `public/chess-icons/*.png` in `WEB/THIRD_PARTY.md` before charging (`public/board_icons` are the owner's own) | Asset provenance (LIC-5) |

### 7.2 Facts to verify before relying on them ([V] list)

| # | Check | How |
|---|---|---|
| V1 | The `cpu.idle` slice works on the OCI Ubuntu 24.04 kernel with Docker `cgroup_parent` | dev box: create `worker-idle.slice` with `CPUWeight=idle`, run the worker, `cat cpu.idle`, then k6 with a backfill and watch loop lag p99 |
| V2 | Vercel Authentication covers the dev project's production alias on Hobby, and the automation bypass works for webhooks | dashboard plus `curl` with and without the bypass header and query parameter |
| V3 | Clerk restricted or allowlist sign-up on the dev instance's plan | Clerk dashboard |
| V4 | Sentry metrics API and free quota for the Node and Next SDK v10 | Sentry docs; one test metric from dev |
| V5 | UptimeRobot free-plan commercial terms | their terms page |
| V6 | R2 token permission types; bucket lock availability | Cloudflare dashboard |
| V7 | Current OCI A1 PAYG price | OCI price list |
| V8 | scalachess licence before porting `Divider` | `LICENSE` in the scalachess repo |
| V9 | `pgn` storage size after TOAST on real PGNs | 02-data-model §10.1 method with real CC0 games |
| V10 | Prisma migration transaction behaviour with `ALTER TYPE … ADD VALUE` on PG 17 | Docker PG 17 test in CI |
| V11 | GitHub `ubuntu-24.04-arm` availability and minutes if the repo becomes private | GitHub billing docs |
| V12 | Dodo fees on a $4.99 charge | Dodo pricing page / dashboard |
| V13 | Speed Insights pricing on Pro | Vercel pricing page |
| V14 | Measured Vercel CDN requests and FDT for one night of the deployed smoke run | Vercel usage API before and after |
| V15 | The `functions` path-key format for App Router routes in `vercel.json` | deploy to dev, abort a stream, check the row |

---

## Appendix A. Environment variables per service

| Variable | web | websocket | worker | Notes |
|---|---|---|---|---|
| `APP_ENV` / `NEXT_PUBLIC_APP_ENV` | ✓ | ✓ | ✓ | `local`, `test`, `dev`, `production`; **required at boot** (`lib/env.ts`, allowed set); `NEXT_PUBLIC_APP_ENV=production` on prod, without which `/dev/*` is public |
| `ALLOW_TEST_HOOKS`, `E2E_TEST_TOKEN` | ✓ | ✓ | ✓ | dev and test only (CR-27); a production process with either set refuses to boot |
| `DATABASE_URL` | ✓ `replay_app` | ✓ `replay_realtime` | ✓ `replay_worker` | pooled host |
| `DIRECT_URL` | CI migration job only | — | — | owner role, never in the runtime env |
| `BACKUP_DATABASE_URL` | — | — | ✓ `replay_backup` | direct host, read-only (P13; the P1 interim backup uses a GitHub secret) |
| `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET` | ✓ | — | — | |
| `DODO_PAYMENTS_API_KEY`, `DODO_PAYMENTS_WEBHOOK_KEY`, `DODO_PAYMENTS_ENVIRONMENT`, `DODO_PRODUCT_ID_MONTHLY`, `DODO_PRODUCT_ID_YEARLY`, `DODO_LEGACY_PLAYER_PRODUCT_ID` | ✓ | — | — | checked at boot |
| `ANTHROPIC_API_KEY` | ✓ (web workspace) | — | ✓ (worker workspace) | separate keys |
| `COACH_SYSTEM_CACHE_TTL` | ✓ | — | — | unset (5 min) by default; `1h` only when traffic justifies it |
| `SOCKET_TOKEN_SECRET` | ✓ sign | ✓ verify | — | key set with ids; user tokens only |
| `INTERNAL_API_SECRET` | ✓ (kid `web`) | ✓ (kid `ws`; verifies `web`, `wk`, `ops`) | ✓ (kid `wk`) | `kid:base64[,kid:base64]`, first signs; a bare legacy value is read as kid `web` (CR-16) |
| `HASH_PEPPER` | ✓ | — | ✓ | emails (trial ledger, deletion, contact limits); never rotated |
| `RATE_LIMIT_IP_PEPPER` | ✓ | — | — | IP hashing |
| `LINK_TOKEN_KEYS` | ✓ (public key only if sealed) | — | ✓ | only if P4 keeps a stored Lichess token (§2.3.2) |
| `CRON_SECRET` | ✓ | — | — | Vercel sends it as a bearer token |
| `ANALYSIS_WORKER_URL`, `WS_INTERNAL_URL` | ✓ (public HTTPS through Caddy) | ✓ (`http://worker:3003` dev; `http://10.42.0.30:3003` prod) | ✓ (`http://websocket:3002` dev; the socket box VCN address prod) | |
| `WEB_APP_URL` | — | ✓ | ✓ | for signed calls to `/api/internal/*` |
| `NEXT_PUBLIC_SITE_URL` (+ optional `NEXT_PUBLIC_SHARE_ORIGIN`) | ✓ | — | — | web origin, share links |
| `NEXT_PUBLIC_WEBSOCKET_URL` | ✓ | — | — | X17 |
| `NEXT_PUBLIC_ENGINE_BASE_URL` | ✓ | — | — | R2 engine folder; unset → same-origin `/workers/sf18-<hash>/` |
| `ALLOWED_ORIGINS` | — | ✓ | — | fail closed if unset; the dev value is the real dev URL |
| `R2_*` (account, `R2_PUBLIC_BUCKET`, `R2_PRIVATE_BUCKET`, scoped keys) | ✓ uploads, exports read | — | ✓ backups write, exports write, media | per-bucket tokens |
| `BACKUP_AGE_RECIPIENT`, `BACKUP_ENABLED` | — | — | ✓ | public key only; `BACKUP_ENABLED=false` on dev |
| `RESEND_API_KEY`, `EMAIL_FROM` | — | — | ✓ | |
| `VAPID_PRIVATE_KEY` / `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | public key only | — | ✓ private | |
| `NEXT_PUBLIC_POSTHOG_KEY`, `POSTHOG_PROJECT_KEY`, `POSTHOG_FEATURE_FLAGS_KEY`, `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_HOST` | ✓ (+ flags key) | ✓ project key | ✓ (project key; personal key for person delete) | `POSTHOG_HOST` points at the sink in CI |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN` (build) | ✓ | ✓ | ✓ | per-service DSNs |
| `EDGE_CONFIG` | ✓ | ✓ (read URL) | ✓ (read URL) | ops switches |
| `ENGINE`, `ENGINE_PATH`, `ENGINE_THREADS`, `ENGINE_HASH_MB`, `ENGINE_POOL`, `PREWARM_MAX_GAMES`, `EVAL_CACHE` | — | — | ✓ | §1.8–1.9 |
| `TIMING_PROFILE` | — | ✓ | ✓ | `fast` only with `APP_ENV=test` |
| `COACH_LLM_PROVIDER`, `COACH_FAKE_UPSTREAM` | ✓ | — | — | non-production only |
| `BILLING_PAYWALL`, `PERF_AUTH_BYPASS`, `NEXT_PUBLIC_TELEMETRY_SINK`, `FLAGS_OVERRIDE`, `MIDDLEWARE_MEMBER_GATE` | ✓ | — | — | test switches refuse to load in production (CR-27) |
| `NEXT_PUBLIC_CONSENT_BAR` | ✓ | — | — | P11 consent bar |

Every variable the web build reads is listed in `turbo.json` `globalEnv` (today `NEXT_PUBLIC_*` are missing, `audit-quality` B-03). GitHub secrets: `WS_ENV_FILE`, `WS_DEV_ENV_FILE`, `WORKER_ENV_FILE`, `WORKER_DEV_ENV_FILE`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `VERCEL_AUTOMATION_BYPASS_SECRET`, `NEON_API_KEY`, `SENTRY_AUTH_TOKEN`, `PROD_BACKUP_DATABASE_URL` (P1 interim).

## Appendix B. New and changed files

**New**

- `apps/analysis-worker/` (P3): `package.json`, `Dockerfile` (Stockfish build stage + `node:24-bookworm-slim`), `NOTICE`, `src/index.ts`, `src/http/server.ts`, `src/queue/{claim,heartbeat,complete,reaper}.ts`, `src/scheduler/timer.ts`, `src/scheduler/recurring/{housekeeping,dailyPlan}.ts` (later phases add files), `src/engine/{uci,pool,profile}.ts`, `src/cache/evalCache.ts` (SQLite), `src/handlers/<kind>.ts`, `src/importers/{chesscom,lichess,providerGate}.ts`, `src/llm/{client,reviewText,batch}.ts`, `src/notify/{socket,email,push}.ts`, `src/backup/pgdump.ts`.
- Packages: `packages/db` (Prisma schema, client, `src/live/*`, `src/jobs.ts`, roles SQL in `sql/roles.sql`, `prisma/protected-indexes.txt`, backfill scripts), `packages/contracts/src/{http,socket,internal}` (zod schemas, `codes.ts`, `limits.ts`, `rooms.ts`, `registry.ts`, `internal/auth.ts`, job payloads), `packages/game-core`, `packages/chess-analysis` (formulas, classifier, verifier, `CLEANROOM.md`), `packages/chess-training` (FSRS wrapper, baselines), `packages/analytics/src/events/<area>.ts`, `packages/chess-fixtures`, `packages/domain` (P9).
- Web: `lib/api/{route,client,schema}.ts`, `lib/api/keys/<area>.ts`, `lib/auth/{viewer,claims}.ts`, `lib/jobs/enqueue.ts`, `lib/internal/fetch.ts`, `lib/security/csp.ts`, `lib/flags/registry/<phase>.ts`, `lib/routes/classes/<area>.ts`, `lib/cron/tasks/<task>.ts`, `lib/realtime/handlers/<domain>.ts`, `lib/ops/edge-config.ts`, `lib/r2/presign.ts`, `lib/test-hooks/registry.ts`, `lib/sse.ts`, `app/api/cron/daily/route.ts`, `app/api/webhook/clerk/route.ts`, `app/api/session/clear/route.ts`, `app/api/billing/refresh/route.ts`, `app/api/internal/account-purge/[id]/[step]/route.ts`, `app/api/health/route.ts`, `test/authz/matrix.ts`, `e2e/fixtures/{one-viewport,zoom,users,lease,time,telemetry,console-guard,health}.ts`, `e2e/mocks/posthog-sink.ts`, `e2e/specs/prod-guard.spec.ts`, `e2e/quarantine.json`, `scripts/dev/personas.ts`, `e2e/scripts/sweep-throwaway-users.ts`, `THIRD_PARTY.md`.
- Repo: `.github/workflows/{ci,nightly,post-deploy-dev,weekly-full-dev,ops-weekly,backup-prod,release-dev,release-prod,update-snapshots,coach-live}.yml`, `.github/dependabot.yml`, `OWNERS.yml`, `scripts/db/check-drift.ts`, `scripts/qa/{check-test-globs.mjs,extract-design-states.ts,state-coverage.ts,error-window.ts}`, `docs/qa/{design-states.json,design-states.overrides.json,phase.txt,phase-NN-signoff.md}`, `docs/decisions.md`, `docs/runbooks/*.md`, `docs/api/openapi.json` (generated), `docs/postmortems/`, `perf/results/`, `perf/compare.ts`, `deploy/oci/worker/docker-compose.yml`, `CLAUDE.local.md` (gitignored, owner).

**Changed**

- `WEB/middleware.ts` (route classes as data, claims, CSP nonce, request id, `x-mw-start`, origin check, scanner early-return, matcher exclusions), `WEB/next.config.js` (CSP, `poweredByHeader`, image allowlist, PWA runtime caching, `X-Robots-Tag` for `/r/:code` via `async headers()`), `WEB/vercel.json` (§4.3), `WEB/instrumentation-client.ts`, `WEB/sentry.server.config.ts`, `WEB/sentry.edge.config.ts`, `WEB/lib/logger.ts`, `WEB/app/api/webhook/dodo-payments/route.ts` (event log, compare-and-set, claims sync, emit), `WEB/lib/billing/entitlement-rules.ts`, `WEB/lib/billing/catalog.ts`, `WEB/playwright.config.ts` (`E2E_BASE_URL`, bypass, projects, `flags-off`), `WEB/package.json` (test scripts), `WS/*` (v2), `WS/Dockerfile` (Node 24), `deploy/oci/docker-compose.yml`, `deploy/oci/Caddyfile`, `.github/workflows/{deploy-oci,e2e-tests,perf-tests}.yml`, `turbo.json`, root `package.json` (`engines.node >=24`), `CLAUDE.md` (environments table after the dev split, migration rule wording, once the owner decides).

**Removed**

- `k8s/`, root `docker-compose.yml`, `build-and-push.sh`, `WEB/Dockerfile`, `WS/docker-compose.yml`, `WS/deploy/*`, `WS/spotInterruption.ts`, `WEB/lib/sentry/logger.ts`, the polling and PII routes listed in 06-codebase-audit §4.

## Appendix C. Critique dispositions (revision 2)

Every finding that concerns this file, with its disposition. "Applied" means the section named carries the fix.

| Finding | Disposition | Where |
|---|---|---|
| api-perf AP-01 (dev shares prod CU-h) | Applied: split in P1 1B·H10; weekly CU-h report from P1 | §4.1, §1.12.1, X21 |
| api-perf AP-02 (`supportsCancellation`) | Applied | §4.3 `vercel.json`, §1.7.5, §1.11.7 |
| api-perf AP-04, AP-22, AP-03 (cache tiers, private no-cache, `P+` split) | Applied | §1.6.6, CR-20, CR-21 |
| api-perf AP-05 (OG images) | Applied: images only through shares | §1.6.6 |
| api-perf AP-06, AP-31 (billing CAS, refresh by GET) | Applied | CR-25, §1.7.6, §2.1 |
| api-perf AP-08, feasibility F-NEON-2 (timers, `HOURLY_TICK`) | Applied: next-due rows + `DAILY_PLAN` | CR-10, §1.10.3, §2.2, §2.4 |
| consistency R-05 item 3 (`HOURLY_TICK` as a JobKind) | **Rejected** in favour of F-NEON-2/AP-08; the rest of R-05 (fairSeq, `JOB_PRIORITY`, ledger, kick path) applied | CR-8–CR-11 |
| api-perf AP-09 (GETs enqueue, re-kicks) | Applied | CR-24, §1.10.2, §2.2, §2.3.1 |
| api-perf AP-10 (invalidation storm) | Applied: priority-banded progress, `analysis:batch` | §1.6.5, §1.7.2, §1.9.1 |
| api-perf AP-11, feasibility F-NEON-3 (UNLOGGED limits, email budget) | Applied | CR-19, §1.12.1, §2.3.6 |
| api-perf AP-17 (per-IP handshake limits), AP-32 (bot checkpoint) | Applied | §3.2.6 |
| api-perf AP-18, feasibility F-OCI-4 (Neon suspend errors) | Applied | §1.5 E7/E8, §1.12.1, §5.10 |
| api-perf AP-26 (import CTE) | Applied | §1.7.4, §2.3.2 |
| api-perf AP-33 (dynamic 404), AP-41 (token minting), AP-46 (insert before the LLM) | Applied | §3.1.4, §1.5 E4, §1.7.5 |
| api-perf AP-44, feasibility SEC-4/SEC-8 (internal auth) | Applied: HMAC from P2, kids, allow-lists, Caddy pre-check | CR-16, §3.2.4, §1.8.1 |
| consistency R-08 (keep the static token) | **Rejected** (replay and forgery exposure); its single helper and env name kept | CR-16, X20 |
| api-perf AP-07 rename to `playedAt` | **Rejected** in favour of consistency R-01 (`endedAt`); index-existence gate applied | CR-2, §4.6 step 5 |
| consistency R-01, R-02, R-03, R-04, R-06, R-07, R-09, R-10, R-11, R-12, R-13, R-14, R-16, R-17, R-18, R-19, R-20 | Applied | CR-1…CR-36 |
| consistency §3 rows for `architecture.md` (X1, X3, X5, X11, X16, §1.10, §3.5, §5.1, App. A) | Applied | §0.2, §1.10.1, §3.5.3, §5.1, App. A |
| feasibility fix #1 (domain) | Applied as owner decision | S-P0-11, D17 |
| feasibility fix #2, F-OCI-1 (worker topology), F-OCI-2 (`cpu.idle`), F-OCI-3 (capacity), F-OCI-5 (PAYG) | Applied | §1.8, §1.9.5, D3, D4 |
| feasibility fix #3, SEC-5 (`VERCEL_ENV` gates) | Applied | CR-27, §5.11 |
| feasibility fix #6 (crosswalk) | Applied | §6.1 |
| feasibility fix #7, F-LLM-2/3/4 (caps, TTL, breaker) | Applied | CR-33, §1.11.4, §1.11.7 |
| feasibility fix #8, F-VER-3 (matrix against deployed dev) | Applied | §4.3, §5.5 |
| feasibility fix #9, LIC-2 (engine on R2, GPL files) | Applied | CR-34, §1.12.2 |
| feasibility fix #14, SEC-1, SEC-2, SEC-3 | Applied | §3.2.1, D18, D21 |
| feasibility fix #15, §8 (calendar, Launch A) | Applied as planning rules and D19 | §6.2 |
| feasibility F-VER-1, F-VER-2, F-VER-4…7 (Hobby facts, 60 % stop) | Applied | §1.13.1, §1.13.3 |
| feasibility F-API-1, F-API-3, F-API-4 | Applied (F-API-3 as a recommendation P4 decides) | §2.3.2, §1.5 E19 |
| feasibility F-NEON-4, F-NEON-5 (PGN, backups, snapshots) | Applied | X22, §2.3.9, §1.12.1 |
| feasibility SEC-6, SEC-7, SEC-9 | Applied | §2.3.2, §1.12.2, §3.2.6 |
| feasibility LIC-3…LIC-6 | Applied | §1.9.1, D23, D24 |
| feasibility §7 (shared registries) | Applied: registry directories and `OWNERS.yml` in P1 | §6.2, §3.1.4, §2.1 |
| feasibility §9 (rollback rules, SW kill switch) | Applied | §4.7 |
| feasibility 10.1 items 1–22 | Applied (items map to the rows above) | — |
| feasibility §11 [V] list | Carried | §7.2 |
| testing X1–X18, §3 DoD addendum, §4 tool owners | Applied | §5 |
| testing X16 (split the Neon project in P2) | Superseded: split moved earlier, to P1 | §4.1 |
| coverage C-21 (B26 before P3) | Applied as owner decision D7 | §1.6.3, §7.1 |
| coverage C-01, C-02, C-03 (game-over slots) | Recorded as a cross-plan ruling; fixes live in the phase specs | CR-37, 07-design-coverage §3 |
