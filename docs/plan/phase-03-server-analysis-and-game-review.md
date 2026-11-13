# Phase 3 spec: server analysis and Game Review

Status: **final plan, revision 2**, 2026-11-02, branch `dev` @ `0848b76`. This revision applies the five critiques (`critique-coverage`, `critique-consistency`, `critique-feasibility`, `critique-testing`, `critique-api-perf`). Every finding that concerns P3 is either applied in the body or rejected with a one-line reason in **Appendix A, "Critique dispositions"**.

Budget: **30.75 dev-days**. ALLOC §0 allows 28; the extra 2.75 days are the critique fixes, itemised in §13.1. P3-Q15 lists two trims that bring it back to 28 if the owner wants that.

Depends on:
- **P1:** shell, UI kit, `route()`, contracts, `api()`/`qk`, flags, rate limiter, viewer, plus the shared test tooling: `nightly.yml`, the telemetry sink, the hook registry, personas and the visual-regression setup.
- **P2:** board, `GamePlayer`, typed `Game` columns, socket v2 user rooms, `/internal/emit`, the `finishGame()` CTE, bot `complete`, `EngineProvider`, `packages/chess-fixtures`.

This file is the single source for what P3 builds. Where it differs from a sibling plan, §0.2 records the decision and the reason.

**Path shorthands** (as in `allocation.md`, with the consistency critique's R-10 fixes)

| Short | Path |
|---|---|
| `REPO` | `/Users/rohitpandit/open_source/chess-battle-turbo` |
| `WEB` | `REPO/apps/web` |
| `WS` | `REPO/apps/web-socket` |
| `WK` | `REPO/apps/analysis-worker` (new in P3) |
| `PKG` | `REPO/packages` |
| `CA` | `PKG/chess-analysis` (new in P3) |
| `FX` | `PKG/chess-fixtures` (created by P2; P3 adds `grades/`) |
| `DB` | `PKG/db` (created by P2; holds `prisma/schema.prisma`, `prisma/migrations`, `prisma/protected-indexes.txt`, `src/live/finish.ts`, `src/json/*`, `src/jobs.ts`) |
| `CT` | `PKG/contracts/src` (P1 `http/`, P2 `socket/`, P3 adds `internal/`), imported as `@repo/contracts/{http,socket,internal}/<file>` |
| `SP` | the planning session's scratchpad, archived scratch inputs that are not in the repo and may no longer exist (see [99-open-decisions.md](99-open-decisions.md) A12) |
| `DR` | `SP/design-ref/project/v2` (board files `*.dc.html`) |
| `DS` | `SP/design-ref/ds/project` (design-system README, tokens, component READMEs) |

Inventory and audit references point into `SP/plan/`:
- "rct-a §4.4" → `inv-rct-a.md`; "play-b F6" → `inv-play-b.md`.
- "DM" = `data-model.md`, "API" = `api-design.md`, "CDL" = `client-data-layer.md`, "OPT" = `optimization.md`, "ARCH" = `architecture.md`, "RES" = `inv-research.md`, "ALLOC" = `allocation.md`.
- The critiques are cited by their finding IDs:
  - COV C-nn (coverage);
  - CON n.n and R-nn (consistency);
  - FEA F-…/SEC-…/LIC-… and 10.9-n (feasibility);
  - TST Xn (testing);
  - AP-nn (api-perf).

**SQL convention.** Prisma `DateTime` columns are `timestamp(3)` without zone, stored in UTC (P1 §6). Every raw statement below writes `now()` for brevity. The code writes `(now() AT TIME ZONE 'UTC')`, as P1 does, so results never depend on the session `TimeZone`.

### What changed in revision 2 (short list; details in Appendix A)

1. **Schema names follow P2's M2** (R-01):
   - `games.fen`, `"endMethod"`, `"completedAt"`;
   - `game_players."endedAt"` and its index `game_players_userId_endedAt_gameId_idx`;
   - `GamePlayer` PK `(gameId, userId)` + unique `(gameId, color)`.
   
   M3 adds `ecoCode`/`openingName` (games), `ecoCode` (game_players), `Job.fairSeq`, `Job.lastKickAt`, `users."gamesVersion"`, `game_analyses.second[]` and `game_analyses."readyMs"`.
2. **No GET enqueues engine work** (AP-09). Unanalysed reviews are enqueued by the client's `POST …/analyse`. Re-kicks go through a 30 s compare-and-set on `jobs."lastKickAt"`. Legend evals are computed by `POST …/legend/compute`.
3. **Internal calls are signed with HMAC** through one helper in `CT/internal/auth.ts` (AP-44, SEC-4). It keeps the single env name `INTERNAL_API_SECRET` (R-09). The worker's public route accepts only signed calls, and Caddy rejects unsigned requests before Node sees them.
4. **`/internal/emit` uses P2's body** `{v:1, targets:[{userRef}], event, data, dedupeKey?}` (R-07). Events are registered in P2's `socket/registry.ts`. `game:result` fields live in `CT/socket/game.ts`.
5. **Timed work runs from a once-a-day planner, with no `HOURLY_TICK`** (F-NEON-2, AP-08). P3 creates `WK/src/scheduler/recurring/` as an extension directory. The idle worker still issues zero queries.
6. **Banded realtime** (AP-10):
   - `analysis:progress` only for jobs someone is waiting on (priority ≥ 80, or watched);
   - background jobs coalesce into `analysis:batch` per user, at most one per 60 s;
   - `analysis:done` carries `coachLine` and a reserved `bank` field for P5.
7. **Cache rules** (AP-04, AP-05, AP-14, AP-47):
   - strong ETags everywhere;
   - no `max-age` on per-user responses; PGN download is `no-store`;
   - `/r/[code]` has no `headers()`, uses ISR with a 1 h revalidate, and caches negatives;
   - the share image has a short browser TTL and a CDN cache tag that is purged on revoke and on the username toggle.
8. **Game-over card** (COV C-02, C-03, design `V3GameOverLegend`):
   - while analysing, the primary is the disabled "Analysing · 64%";
   - when done, it is **See What the Coach Thinks**;
   - a template coach line;
   - **Replay from Move N** → `/practice`;
   - the bank line slot is reserved for P5.
9. **Worker CPU isolation on the dev box** uses a cgroup `cpu.idle` slice plus the 0.75 cap and the lag pause (F-OCI-2). `SCHED_IDLE` inside the container does not protect another container.
10. **Testing plumbing** (TST X1–X18):
    - goldens run deterministically (cache off, fresh engine, no resume);
    - a nightly label-stability job;
    - an ≥ 80-line grade corpus in `FX/grades/positions.jsonl`;
    - nightly eval provenance;
    - worker telemetry tests;
    - real-data `queued`/`writing` states through registered hooks;
    - a post-deploy real-engine smoke on the dev box;
    - a sign-off record.
11. **Rollback** (FEA §9):
    - versioned job payloads; an older worker releases jobs it cannot read;
    - legacy `/analysis` code is deleted **one dev release after** the redirect switch, still inside P3.
12. **How we grade** gets **Pricing** in its nav (COV C-18, flow edge E2).

---

## 0. Summary and binding decisions

### 0.1 P3 in ten lines

1. **The worker.** A new OCI service, `apps/analysis-worker`, runs **native Stockfish 18 (arm64)**.
   - On dev it is a compose service on the dev VM (80.225.200.210), next to the socket server, inside a `cpu.idle` cgroup slice.
   - Prod gets its own A1 VM in P13 (ALLOC §1.5, P13 D7). P3 never deploys the worker to prod.
2. **Enqueue at finish.** Every finished game inserts one `Job{kind: ANALYZE_GAME}` row **in the same statement or transaction that finishes it**:
   - live games: a `jobs` fragment appended to P2's `finishGame()` CTE;
   - bot and legend-bot games: the `complete` transaction.
   
   The worker is then kicked over signed HTTP. It never polls Neon on a timer.
3. **Grading.** The worker grades every ply with one fixed engine profile (`sf18-v1`), using the published Lichess formulas re-implemented in a new pure package, `packages/chess-analysis`.
   - It writes one packed `GameAnalysis` row per game, checkpointed every 10 plies so a failure can resume.
   - It streams badge deltas to the players' `user:{ref}` rooms only when someone is waiting.
4. **Reviews.** Each member side gets a `PlayerReview`: key moments, deterministic **template** text (including a one-line game-over coach line), and walkthrough progress. P7 later swaps the template text for verified LLM text with no schema change.
5. **The Review screen** (`/review/[ref]`) covers all 5 design states (`analysing`, `failed`, `clean`, `summary`, `moment`) on 6 device classes at 80–150 % zoom, with the board always on screen.
   - The page is server-rendered from one ~4 KB payload.
   - After that it updates only from socket deltas. A polling fallback runs only while the socket is down.
6. **Around the review.** These ship in the same phase:
   - Review complete;
   - Share (a frozen public snapshot at `/r/[code]` with an OG image);
   - My games (`/games`, keyset-paginated over `game_players."endedAt"`);
   - Compare with the legend (`/review/[ref]/legend`);
   - Practice from a position (`/practice`, browser engine);
   - the public How we grade page.
7. **The game-over card** that P2 built gains:
   - `over_analysing` (disabled "Analysing · 64%");
   - the final accuracy line;
   - the coach line;
   - **See What the Coach Thinks**;
   - `over_legend` with **Compare with {Legend}** and **Replay from Move N**.
8. **Retiring `/analysis`.** `/analysis/*` and `GET /api/analysis/[gameId]` switch to 308 redirects once the parity check passes. The legacy code is deleted one dev release later (≥ 3 days), still inside P3.
9. **Flags.** Everything ships behind the PostHog flags `review-v3` and `review-share`, on for the owner and the shared E2E members on dev. Grading itself is not flagged.
10. **Slots.** Mistake Bank cards and the game-over bank line (P5), coach chat and LLM text (P7), import sources (P4) and rating deltas (P9) are **slots that later phases switch on**. P3 does not render them (ALLOC §1.2). P3 does ship their reserved contract fields, so no later phase changes a P3 shape.

### 0.2 Decisions this spec makes where sibling plans disagree

ALLOC §2 decisions B1–B26 bind every phase. For schema shape this spec follows P2's shipped M2, then DM (`schema.target.prisma`) for anything new (R-01). The rows below settle the P3-specific conflicts. Rows marked **(rev 2)** are new or changed in this revision.

| # | Topic | Conflicting inputs | Decision for P3 | Why |
|---|---|---|---|---|
| P3-D1 | Review API root | ALLOC B21 `/api/review/:ref/*`; API `/api/reviews/{gameRef}`; DM §7.4 `/api/games/[ref]/review` | **`/api/review/[ref]/*`** | B21 is binding. CDL keys (`qk.review.detail`) already use it. |
| P3-D2 | Status fallback endpoint | CDL/API: `GET /api/games/:ref/status`; ALLOC P3: `GET /api/review/:ref/status`, carrying comparison and bank | **`GET /api/review/[ref]/status`**, key `qk.review.status(ref)` (R-15) | ALLOC names it as the single fallback for game-over, compare and review |
| P3-D3 | Key-moment storage | ALLOC M3: a `KeyMoment` table; DM D4: moments inside `PlayerReview.content` | **Inside `PlayerReview.content.moments` (≤ 3)**. The API moment id is the ply number. **No `key_moments` table in any phase** (R-02). | They are always read with the review (DM D4). P5 links bank items through `MistakeOccurrence (gameId, ply)` and reads `progress.bankOptOut`. |
| P3-D4 | Share storage | ALLOC M3 `ShareLink`; DM D17 one `Share` table (kind POSITION or REVIEW) | **`Share` table, created in P3** with both enum values. P3 writes `REVIEW` only; P9 starts writing `POSITION`. | One resolver and one code space (DM D17), and no table change in P9 |
| P3-D5 | `LegendComparison` timing | DM puts it in its "M8"; ALLOC puts `V3LegendCompare` and `V3GameOverLegend` in P3 | **Created in P3** (DM's model, unchanged) | P3 owns the screens |
| P3-D6 | Analysis checkpoints | DM D3: write `GameAnalysis` once at the end; ALLOC B6 + ARCH §1.9.6: checkpoint every 10 plies | **Upsert partial arrays every 10 plies**, in one statement that also refreshes the job heartbeat and returns the job's current priority | Needed for the owner test "kill the worker → retry resumes", and so a reload mid-analysis shows graded plies. Neon is already awake while a job runs, so the cost is about 6 extra statements per 60-ply game. |
| P3-D7 | Job priority scale **(rev 2)** | ALLOC P3 text: 0 = live … 8 = backlog (lower first); DM/ARCH: 100 = viewer waiting … 0 = housekeeping, index `priority DESC` | **Higher runs first**, written only as named constants: `JOB_PRIORITY` in `CT/internal/jobs.ts`, re-exported by `DB/src/jobs.ts` (R-05.2). Values: `USER_OPENED 100`, `IMPORT_SYNC_MANUAL 100`, `GAME_ENDED 80`, `IMPORT_SYNC_INITIAL 60`, `REVIEW_BATCH 60`, `IMPORT_NEWEST 50`, `WEAKNESS 20`, `IMPORT_PURGE 20`, `IMPORT_SYNC_DAILY 15`, `BACKLOG 10`, `HOUSEKEEPING 0`. An ESLint rule bans `priority: <digit>` literals outside that file. | It matches the claim index. Later phases add names, never literals. |
| P3-D8 | Worker CPU on the dev VM **(rev 2)** | ALLOC: `cpus: "0.5"`; ARCH §1.8.2: `cpus: "0.75"`, `cpu_shares: 64`, `SCHED_IDLE`; FEA F-OCI-2: `SCHED_IDLE` inside a container only orders tasks within that container | **Compose `cgroup_parent: worker-idle.slice`** (systemd slice with `CPUWeight=idle`, so `cpu.idle=1`), plus `cpus: "0.75"`, plus the lag pause between positions when the socket loop lag p99 > 40 ms. `nice -n 19` stays as a harmless extra. The day-1 check is `cat /sys/fs/cgroup/worker.slice/worker-idle.slice/cpu.idle` = `1`. If the co-location k6 run (§12.7) shows a socket lag p99 ≥ 50 ms, fall back to `cpus: "0.5"`. | Under cgroup v2, CPU is shared between container cgroups first. An idle cgroup yields to the socket container; `SCHED_IDLE` inside the container does not. |
| P3-D9 | Engine budget | ALLOC: pass 1 = 120k nodes MultiPV 2, pass 2 = 1M MultiPV 3; ARCH X5: 150k MultiPV 1 + pass 1b + 1.5M MultiPV 2; RES §6.2: 250k / 2M | **Profile `sf18-v1` = ALLOC's numbers**, frozen only after `stockfish bench` on the dev VM (task C1, day 1). If a 60-ply game takes more than 60 s on 0.75 core, pass 1 drops to 80k before any golden file is recorded. | Binding ALLOC numbers. MultiPV 2 on every ply gives "second best" for GREAT without a pass 1b. |
| P3-D10 | Eval cache and Lichess cloud-eval **(rev 2)** | ALLOC: eval cache + Lichess cloud-eval for book plies; OPT §4.6: no cloud-eval in the hot path; TST X13: the cache makes results order-dependent | **In-process LRU → SQLite on the worker disk**, seeded offline from the Lichess CC0 eval DB for opening positions. **No cloud-eval HTTP calls.** Goldens run with `EVAL_CACHE=off`. If the nightly label-stability job (§12.4) fails, graded positions bypass the cache, and the decision is recorded in `CA/README.md`. | A cloud lookup from Mumbai (~250 ms) is slower than a local 120k-node search (~0.2–0.3 s), and it adds a rate-limited dependency |
| P3-D11 | Worker DB driver **(rev 2)** | ALLOC: the worker uses `packages/db`; OPT D3: Neon HTTP driver, 2 round trips per game; FEA F-OCI-4: pools must survive Neon suspends | **`@neondatabase/serverless` `neon()` over HTTP** for every worker statement, with types from `packages/db` and zod schemas from `CT/internal/jobs.ts`. HTTP holds no idle connection, so a Neon suspend cannot crash the worker. A failed fetch is retried once (every worker statement is idempotent). | A Prisma interactive transaction from Mumbai costs one RTT (~220 ms) per statement. `sql.transaction([...])` sends the whole batch in one HTTP request. |
| P3-D12 | Wake endpoint name **(rev 2)** | ALLOC `/internal/analysis/kick`; ARCH `/internal/wake`; API `/worker/wake`; P6/P10 `/worker/wake` | **`POST /internal/analysis/kick`** for every job kind (R-05.5). ARCH, API, P6 and P10 must use this path (listed in Appendix A). | ALLOC is binding. P4 reuses it for import jobs (the body names the kinds). |
| P3-D13 | Rooms, event names and emit body **(rev 2)** | API `u:{ref}`; ARCH dot case; the P3 draft's `rooms[]` | **`user:{userRef}`**, **`domain:event`** (ALLOC B20). Every emit uses P2's `POST /internal/emit {v:1, targets:[{userRef}] ≤ 50, event, data, dedupeKey?}`, built with `ROOM` from `CT/socket/rooms.ts`. No `rooms[]` extension. | Binding; one body shape (R-07) |
| P3-D14 | Key-moment candidates | rct-a: errors ≥ inaccuracy, one per 6-ply window; RES §5: blunder/miss/mistake only, skip within 3 plies | **Primary**: BLUNDER, MISS, MISTAKE. **Fill**: INACCURACY with Win% loss ≥ 7, used only when there are fewer than 3 primary candidates. **Spacing**: skip a candidate within 3 plies of one already picked. | It reproduces the design fixture exactly (moments at plies 32 INACCURACY d = 9.8, 36 MISS, 40 BLUNDER; `DR/V3ReviewSummary.dc.html` `GAME`). rct-a's 6-ply window would drop 19.Qd2. |
| P3-D15 | INTERESTING label | rct-a: a sacrifice rule in v1; RES §4.4d: v2 only (needs Maia) | **Not emitted in `GRADING_VERSION = 1`.** The enum value, the badge and the How we grade row exist. | There is no verifiable v1 rule. The design mock's `44.Rxf6` becomes INACCURACY in our fixture (documented in the fixture file). |
| P3-D16 | Template text status | DM `textStatus` PENDING/READY/FALLBACK; API `summary.status: pending/ready/template` | **`textStatus` ∈ PENDING, TEMPLATE, READY, FALLBACK.** P3 writes TEMPLATE. The VERIFIED tag shows only for READY (P7). | The tag means "passed the LLM verifier" (V3HowWeGrade coach tab copy). Template text comes from engine facts but is not verifier output. |
| P3-D17 | `GamePlayer` key **(rev 2)** | ALLOC B1 PK `(gameId, userId)`; DM PK `(gameId, color)` | **P2 shipped PK `(gameId, userId)` + unique `(gameId, color)`.** `PlayerReview` references the unique `(gameId, color)`. | P2 is the first shipper (R-01, CON 3.1) |
| P3-D18 | Annotated PGN | API PLAY-6 `GET /api/games/{ref}/pgn?annotated=true`; ALLOC A8 `GET /api/review/:ref/pgn`; OPT §3.6.6: build it in the browser | **Built in the browser** from the payload by `buildAnnotatedPgn()` in `CA`. A8 exists for the copy-link flow and non-JS clients, uses the same builder, and is `no-store` (AP-04). P2's plain `GET /api/games/[ref]/pgn` is unchanged. | No extra function invocation for Download PGN |
| P3-D19 | Bank toggle in P3 | ALLOC: A6 ships "inert until P5"; ALLOC §1.2: slots are not rendered before their phase | A6 ships and records opt-outs in `PlayerReview.progress.bankOptOut`. **The checkbox, the "Added" tags and the drill CTA are not rendered until the `train` flag (P5).** | P5's extraction reads the opt-outs when it creates cards, so no backfill is needed |
| P3-D20 | Coach entry points | design: "Ask about this move", "Ask the coach about this game", the Coach panel, "Ask" on Compare | **Hidden until the `coach` flag (P7).** P7 lights all of them, including Compare's **Ask** → `/review/[ref]/coach?ply=<ply>&from=compare` (COV C-04). The review's "Coach" tab is the narrated summary, which is P3 content. | ALLOC lights-up list |
| P3-D21 | Internal service auth **(rev 2)** | P2/R-08: static `x-internal-token`; AP-44 and SEC-4: HMAC, mandatory from P3 | **HMAC through one helper**, `CT/internal/auth.ts` (§8.17). Headers `x-rc-caller`, `x-rc-ts`, `x-rc-sig` sign `ts\nMETHOD\npath\nsha256(body)`. The per-caller key is derived from `INTERNAL_API_SECRET`. The skew window is ±60 s, with a 120 s replay cache. The worker's routes accept **only** HMAC. P2's `/internal/emit` accepts both forms until task H3 moves web's calls over; then the token path is removed. `/internal/emit` also restricts event names by caller. | The web → worker kick crosses the public internet, and a static bearer token can be replayed forever. One env name keeps R-09. |
| P3-D22 | Timed jobs **(rev 2)** | R-05.3: an `HOURLY_TICK` recurring job built by P3; FEA F-NEON-2 / AP-08: a daily planner, no hourly tick | **No `HOURLY_TICK`.** `HOUSEKEEPING` runs once a day at 21:00 UTC. Its last step, `DAILY_PLAN`, asks every slice in `WK/src/scheduler/recurring/*.ts` for timed rows in the next 26 h and inserts them with `dedupeKey`. The worker keeps `nextRunAt` in memory (from kick bodies and each drain's `min("runAt")`), and the reaper runs at boot and at the end of each drain. P6, P10 and P13 add slices as files. | 24 wakes a day cost ≈ 15 CU-h a month and break the zero-idle-query rule. The planner gives the same extension point at 1 fixed wake a day. |
| P3-D23 | GET side effects **(rev 2)** | Draft: A1/A2/the RSC page enqueue at priority 100 and re-kick on every poll; A9 enqueues `LEGEND_COMPARE` (AP-09) | **GETs never enqueue.** Unanalysed games: the client's A3 POST on mount. Lost-kick heal: a compare-and-set on `jobs."lastKickAt"` (at most 1 kick per job per 30 s, however many tabs poll). Legend evals: the client's A9b `POST …/legend/compute`. The only GET writes are the registered side effects `kick_cas` (A1, A2) and `legend_facts` (A2, A9: an idempotent derived insert with no engine work). | Prefetches, focus refetches and hovers no longer queue engine work above just-finished games |
| P3-D24 | Where legend facts are computed **(rev 2)** | Draft: synchronously in the socket finish and in bot `complete` | **Bot / legend-bot `complete`** (web; it can read `chess_positions.pgn` in the same transaction), plus lazily in A2/A9 and in the worker. All use the same pure `compareWithLegend()` and `INSERT … ON CONFLICT DO NOTHING`. The socket finish computes nothing. | P2's socket session does not hold the legend continuation. Reading it at finish would add one Mumbai round trip to the ≤ 500 ms `game:result` budget. |
| P3-D25 | Archive keyset column **(rev 2)** | AP drift register: one column `playedAt`; R-01: P2's `game_players."endedAt"` | **`game_players."endedAt"`**, index `game_players_userId_endedAt_gameId_idx` (P2). Wire DTOs keep `playedAt`/`playedAtLabel`. | P2 is the first shipper and already has the index; a `playedAt` sort would be a Sort node over all of the user's rows |
| P3-D26 | Realtime volume **(rev 2)** | AP-10 | `analysis:progress` only while the job priority is ≥ `GAME_ENDED` **or** the game is watched (a kick body carries `watch: gameRef`). Lower bands emit nothing per game, only a coalesced `analysis:batch` per user, at most one per 60 s. `games:changed` is folded into it for those bands. | A backlog would otherwise send ~30 posts per game to the 1-OCPU socket box and refetch storms to open pages |
| P3-D27 | Archive ETag **(rev 2)** | AP-19 | **`users."gamesVersion"`**, bumped in the finish CTE fragment, bot `complete`, A3/A4, and the worker's done and fail batches. `ETag = "g<gamesVersion>-<hash(filter, cursor, limit)>"`, which costs 0 statements because the viewer is already loaded. | The draft's `max(createdAt, updatedAt)` scanned the whole archive on every request |
| P3-D28 | Engine-free regrades **(rev 2)** | Draft: "re-grade from stored evals" while GREAT needs the MultiPV-2 score, which was not stored | **Store `game_analyses.second[]`**: the MultiPV-2 score per position (White POV, smallint; `32767` = no second move). | +2 B per ply makes every `GRADING_VERSION` bump engine-free |
| P3-D29 | Game-over review CTA **(rev 2)** | Draft: "Open Review", enabled while analysing; design `V3GameOverLegend` result card: disabled "Analysing · {pct}%", then **See what the coach thinks**; P2 row 47 says the same | **Follow the design.** While analysing, the primary is disabled and shows the percentage. When done, the primary is **See What the Coach Thinks** (Title Case, P1 rule). "Open Review" stays the label on `/games` and in the "game already ended" zone. | Design is authoritative (COV C-03 asked for the decision) |
| P3-D30 | Legacy deletion timing **(rev 2)** | Draft: delete in the same task as the parity check; FEA §9: keep legacy one release after parity | **H3** switches `/analysis/*` to 308s once parity passes, while the code is still present. **H4** deletes it ≥ 1 dev release and ≥ 3 days later. Both are inside P3. | One rollback step with no code revert |
| P3-D31 | Migration procedure **(rev 2)** | Draft: shadow on a throwaway Neon branch; ALLOC §1.3 allows `db push` on dev; R-20 | **Shadow on a local Docker Postgres 17** (as P2 §6.5). **No `prisma db push` on any Neon branch** (it drops the hand-written partial indexes). `prisma migrate deploy` on the Neon dev branch named in CLAUDE.md. **Never `prisma migrate dev` against Neon.** | R-20; it saves one of Neon Free's 10 branches |

---

## 1. Goal and user-visible outcome

**Goal.** Grade every finished game on our server, with published, deterministic formulas, and turn the result into a guided review:
- summary → 3 key moments (think first, then reveal) → complete → optional public share.

Also ship the surfaces around it: My games, Compare with the legend, Practice from a position, and How we grade. The 1,178-line `/analysis` page is retired.

**What a member sees at the end of P3 (dev site, flags on):**

1. **Game over.** They finish any game: a live friend or online game, a bot game, or a game from a legend position.
   - Within about 1 s the game-over card's primary turns into a disabled **Analysing · 64%** with a spinner.
   - It then becomes "ACCURACY 85 · 3 MOMENTS TO LEARN FROM", followed by a one-sentence coach line such as "The game turned on move 19, when Qd2 missed Rxf5.", and the primary **See What the Coach Thinks**.
2. **Watching it analyse.** They open the review while it is still running (from **Review** in the nav → `/games` → the top row, which says "Analysing").
   - Badges appear on the move list and the board as each ply is graded.
   - The progress card reads "Analysing · move 23 of 61 · 38%".
   - About 20 s later the view auto-advances to the summary: narrated template text, the eval graph, label counts for You and Opp, and the phase line.
3. **Moments.** **Start Review · 3 Moments** walks the key moments.
   - The board shows the position before the mistake.
   - The member plays a move or picks a plan chip.
   - A wrong try rings the squares and says why. A right one says "You found it".
   - Reveal shows their move, the engine's move as a green arrow, the "why" text and **Show Line**.
4. **Finish.** **Finish Review** goes to Review complete: accuracy, moments, best this month. A clean game shows "Clean game · nothing to drill" and its best move.
5. **Share.** **Share Analysis** makes a 30-day link, `playchess.tech/r/<code>`, with:
   - a 1200×630 image;
   - a username toggle;
   - Copy Link, Post to X, Copy PGN and Stop Sharing.
   
   A signed-out browser sees the frozen snapshot.
6. **My games.** The nav item **Review** opens `/games`: a keyset-paginated, virtualised list with search, a filter popover (a bottom sheet on phones), keyboard navigation and an aside with the final position.
7. **Legend games.** A game played from a legend position shows `over_legend` on the game-over card: "You matched 2 of 3 · left Morphy's path with 12.Ba4".
   - **Compare with Morphy** opens the 4-tab compare screen.
   - **Replay from Move 12** and **Practice from Move 12** open `/practice` against the browser engine, untimed.
8. **How we grade.** `/how-we-grade` (public, static) shows the 12 labels and the accuracy formula, from the same constants the worker uses. Its nav links to Pricing.

**What the owner can test on dev.** These are ALLOC's "Owner test" made concrete. Run every step on `https://replay-chess-dev-replaychess007-1069.vercel.app` (the dev URL in CLAUDE.md) with ego-browser, then the starred steps on a real iPhone and a real Android phone. Results go into the sign-off record `REPO/docs/qa/phase-03-signoff.md` (§12.6).

| # | Step | Expected |
|---|---|---|
| T1 ★ | Play a bot game to the end (resign after ~20 moves) | The game-over primary shows a disabled `Analysing · nn%` that rises, then "ACCURACY NN · N MOMENTS TO LEARN FROM", the coach line, and **See What the Coach Thinks** |
| T2 ★ | Start another bot game, finish it, and at once open **Review** → the top row of `/games` | The row says "Analysing". The review opens in `analysing` and badges fill in. On dev (0.75 core): a 40-ply game has all badges in ≤ 12 s p50, and auto-advances to the summary in ≤ 25 s p50 |
| T3 | Summary: press Space, then ←/→, then click the graph | Narration plays sentence by sentence with a highlight; the ply steps; a graph click jumps |
| T4 ★ | **Start Review** → moment 1: play a wrong move, then the right one | Wrong: rings + "Not quite: Nd5 isn't the move here…". Right: "You found it: Qc1 is the engine's move" |
| T5 | Moment 2: **Reveal the Answer** → **Show Line** | A green arrow on the best move; the line animates at 600 ms per ply |
| T6 | **Finish Review** | `/review/<ref>/complete`: stats, the moment list with mini boards, Share and Back to Home rows |
| T7 | Open the seeded clean Opera game | `clean` state: "Your best decision: 16.Qb8+…" → **See Your Best Move**, **Done** → complete `nothing` |
| T8 | **Share Analysis** → **Copy Link** → open it in a signed-out window | Generating → Ready. The `/r/<code>` page shows the board and graded moves with no account; the OG image previews in a link unfurl |
| T9 | Untick **Show My Username**, reload the public page and the image URL | Names are masked. The image URL's `?v=` is bumped and the new image is masked |
| T10 | **Stop Sharing**, reload the public page and the old image URL | The page shows "This review link has expired or was turned off" within one reload; the image URL returns the generic Replay Chess card |
| T11 | `ssh … docker exec analysis-worker kill -9 1` while a review shows Analysing (a crash: `docker kill` would count as a manual stop, R14) | Within ~45 s the page shows `failed` ("The engine stopped at move 16 of 27. Moves 1 to 15 are graded below.") with **Retry Analysis**. Docker restarts the container; **Retry** (or the 30 s auto-retry) resumes at ply 30, not ply 0 |
| T12 | `/games` | All games newest first; filter Losses + Rapid; search "tal"; ↑/↓ + Enter opens a review; the leased empty persona shows `empty` |
| T13 ★ | Play a legend position (legacy entry from `/legends/...`) → game-over **Compare with Morphy** | 4 tabs; the static narration plays where the position has audio; **Practice from Move 12** → `/practice` |
| T14 | `/practice`, cold cache | `engine_loading` 0 → 100 % ("First load only: about 7 MB"), then play, Take Back, Reset |
| T15 | `/how-we-grade` signed out | Tabs Move Labels and Accuracy; the `#blunder` anchor scrolls; the numbers match the worker profile; **Pricing** in the nav opens `/pricing` |
| T16 | `/analysis/<old ref>` | 308 to `/review/<ref>` (or `/review/<ref>/legend` for legend games) |
| T17 | Signed in as user R (never a member): open `/review/<A's game>` | Redirect to `/pricing?reason=…`; the API answers 402 |
| T18 | Signed in as member B: open member A's review | 404 page (existence hidden) |
| T19 | Every review screen at 80/100/110/125/150 % zoom on desktop, and on iPad L/P | Board fully visible, no page scroll; only panels scroll |
| T20 ★ | Legend game over → **Replay from Move 12** | `/practice?game=<ref>&ply=<divergence ply>`, with the board at the position before the member's divergent move |
| T21 | Hover the ⋯ menu item **Compare with Morphy** on a review, without clicking | No job row is created (Neon console: `SELECT count(*) FROM jobs WHERE "dedupeKey" LIKE 'legend:%'` is unchanged); clicking opens compare; `pending_evals` resolves after the page's own `POST …/legend/compute` |
| T22 | Push to `dev` | `deploy-oci.yml` runs the worker smoke (§12.8) and it is green; the dev PostHog shows `analysis_ready` for the smoke game within 120 s |

---

## 2. Scope

### 2.1 In scope

| Area | Deliverables |
|---|---|
| Grading library | `packages/chess-analysis`: <br>• Win%, per-move and game accuracy, phase division <br>• the 12-label classifier (11 emitted in v1), the key-moment picker, the clean-game best decision <br>• template text (including the game-over coach line), headline <br>• book set builder, legend-path comparison, annotated PGN <br>• codecs, version constants, fixtures <br>• `CLEANROOM.md` |
| Grade corpus | `FX/grades/positions.jsonl` (≥ 80 positions with expected grades, TST X13), shared with P5, P6 and P7 |
| Worker | `apps/analysis-worker`: <br>• signed HTTP kick, SKIP LOCKED claim with `fairSeq`, scheduler with in-memory `nextRunAt` <br>• engine pool (one process), UCI driver, `sf18-v1` profile, eval cache (LRU + SQLite) <br>• pass 1 / pass 2, checkpoints, retries and back-off, reaper <br>• `HOUSEKEEPING` + `DAILY_PLAN` and the `recurring/` extension directory <br>• banded progress fan-out through `/internal/emit` <br>• Sentry, metrics <br>• Dockerfile with a native Stockfish 18 arm64 build, `NOTICE` <br>• compose service in a `cpu.idle` slice, Caddy route with an unsigned-request pre-check <br>• CI build, dev deploy, post-deploy smoke |
| Schema M3 | `jobs` (with `fairSeq`, `lastKickAt`), `game_analyses` (with `second`, `readyMs`), `player_reviews`, `legend_comparisons`, `shares`; `games."analysisStatus"`, `"ecoCode"`, `"openingName"`; `game_players` analysis columns + `"ecoCode"`; `users."gamesVersion"`; `openings.epd`; enums; raw partial indexes; DB role `replay_worker` on the Neon dev branch; grants for `replay_app` and the socket role; backfills; review seed fixtures |
| Integration with P2 | Fragments appended to `finishGame()` (jobs insert, `analysisStatus`, `gamesVersion`); the bot `complete` hook (enqueue, legend facts, `gamesVersion`); `analysis:*` / `compare:*` event schemas in P2's registry; `game:result.review` fields; `GET /internal/load` on the socket server; game-over card slots |
| Internal auth | `CT/internal/auth.ts` HMAC sign/verify (P2 owns the file; P3 adds HMAC if P2 shipped token-only), verifiers on the worker and on `/internal/emit` |
| HTTP | A1–A12 review and share routes, `GET /api/me/games`, `GET /api/practice/context`, the `/r/[code]` page, the share image route, the `gone` error code and P3's conflict reasons |
| UI | Screens: `/review/[ref]` (5 states × 6 devices), `/review/[ref]/complete`, `/review/[ref]/share`, `/r/[code]`, `/review/[ref]/legend`, `/practice`, `/games`, `/how-we-grade`; the nav item Review. <br>Components: `EvalGraph`, `ReviewMoveList`, `ReviewMoveStrip`, `MoveQualityBadge` at 22/18 px, `KeyMomentStepper`, `CoachLine` + narration (Web Speech API), `LabelCountsTable`, `ShareSheet`, `GameList`, `CompareTable`, game-over slots |
| Retirement | `/analysis/*` pages, `GET /api/analysis/[gameId]`, `useAnalysisBoard`, `usePlayFromPosition`, `useMultiPvAnalysis`, `AnalysisMoveList`, the analysis share modal and the Twitter banner |
| Tests | Unit; worker integration with a fake engine; API contract and authz matrix; Playwright flow specs with telemetry assertions; device × zoom layout specs (tiered); chess-correctness fixtures (labels, corpus, oracle, golden, label stability, eval provenance); k6 read paths and worker throughput; co-location load test; post-deploy smoke |

### 2.2 Explicitly out of scope (and who owns it)

| Not in P3 | Owner phase | What P3 leaves in place |
|---|---|---|
| Mistake rows, FSRS cards, the "Add to my Mistake Bank" checkbox, "Added" tags, "Drill these 3 mistakes", and the game-over bank line "+1 position added to your Mistake Bank (move 13)" (COV C-01) | P5 | `progress.bankOptOut`, A6, `analysis:done.bank = null`, `ReviewStatusDTO.bank = null`, a hidden slot in the game-over card, and the final-batch extension point (§8.12) for P5's set-based writes (AP-27) |
| Coach chat, "Ask about this move", "Ask the coach about this game", **Ask on Compare**, LLM summary, captions and coach line, the VERIFIED tag, the How we grade "Verified coach" tab, `POST /engine/analyse` | P7 | `PlayerReview.textStatus/model/promptVersion`, `content.coachLine`, the `REVIEW_TEXT` job kind, the reserved Caddy route |
| Personalised legend narration (the `no_explanation` copy "The coach is still writing this one") | P7 (POSITION thread), per the COV C-04 fix; "later" if P7 declines | `LegendComparison.narration/model/costMicroUsd`, `ComparisonStatus.NARRATING` |
| Chess.com and Lichess import, the source tabs and import banner on `/games`, `evalSource = LICHESS`, the import backlog policy for trialists (FEA F-OCI-3) | P4 | `games.source` (or the M3 fallback, §2.3), the `src` filter key reserved, the kick body `kinds`, `JOB_PRIORITY.IMPORT_*`, `analysis:batch` |
| Rating deltas on archive rows and the game-over card | P9 | The archive shows "—" |
| The `/play/legend/[slug]` entry, legend slugs, the legend practice catalogue, per-game TTS | P8 | Compare uses the static position narration; entry via today's legend pages |
| Shared positions `/s/[code]` (`Share.kind = POSITION`) | P9 | The table supports it |
| Public profile games tab (`/api/players/{u}/games`) | P10 | `listMyGames` is written so P10 can reuse it with a visibility filter |
| Prod worker VM, prod migration, old-prod game backfill, "Stage C" capacity plan | P13 | The compose profile `worker` is enabled only in the dev bundle |
| Weakness stats (`GamePlayer.stats`, `errorThemes`) | P6 (M6, R-01) | Computed later from the stored packed arrays; no engine re-run needed |
| Rating-aware thresholds, Maia "findability" (Brilliant v2, Interesting) | later (`GRADING_VERSION` 2) | The constants live in one file |

### 2.3 Dependencies on earlier phases (what P3 assumes exists)

| From | Item P3 uses | If missing |
|---|---|---|
| P1 1A | `components/ui/*`: Button, IconButton, Kbd, Chip/ChipGroup, Segmented, Tabs, Checkbox, Banner, Tag, Card, Eyebrow, Skeleton, ProgressBar, ActionBar, EmptyState, PageHeader, Tooltip, Popover, FilterPopover, Menu, Dialog, Sheet/ResponsiveDialog, `notify`. <br>`components/shell/*`: nav config, shortcuts registry, SubNav, top bar Back. <br>`components/layout/{ViewportStage,BoardStage,ScrollRegion}`, the `/dev/ui` demo pattern, `playwright.devices.config.ts` (40 projects) | blocking |
| P1 1B | `lib/api/route.ts` `route()` (tiers `public-static`/`private-etag`/`no-store`, `RateLimitSpec {bucket, limit, windowSec, by}`); `CT/http/{envelope,codes,cursor}`; `lib/api/client.ts` `api()` (transparent 304s, `x-rc-build`) + `devSchema()` (AP-12); `lib/api/keys` `qk`; `QueryProvider` + `reactToApiError`; `lib/query/server.ts`; `lib/auth/viewer.ts` `getViewer()`/`requireMember()`/`requireMemberPage()`; `lib/rate-limit-db.ts`; `lib/flags.ts` `useFlag()`; the middleware public allow-list; request id; a Sentry span per route; the `replay_app` role; `POST /api/session/clear` (AP-04); `lib/env.ts` `isNonProd()` | blocking |
| P1 test tooling (TST X1–X12, X15, X18) | One unit runner (`node:test` via `tsx`) and the layout `*.test.ts` / `*.int.test.ts` / `WEB/test/{api,integration,authz}`; `ci.yml` `integration` + `e2e-smoke`; **`nightly.yml`** and `post-deploy-dev.yml`; `BILLING_PAYWALL=on` in e2e; the persona registry + leased pool (`leasePersona`); the telemetry sink + `telemetry` fixture + event registry `packages/analytics/src/events/`; the console guard; the design-state manifest + `@state:`/`@demo:` tags; `toHaveScreenshot` setup; `WEB/lib/test-hooks/registry.ts` + `prod-guard.spec.ts`; `perf/results/*.json` | P3 cannot claim its CI gates without them. If one is missing at P3 day 1, WP-H adds the minimum (a `nightly.yml` with P3's jobs) and flags it to P1. |
| P1 registries as directories (FEA §7) | `lib/api/keys/<area>.ts`, `lib/flags/registry/<phase>.ts`, `lib/routes/classes/<area>.ts`, `config/redirects/<phase>.mjs`, `lib/seo/robots-rules/<phase>.ts`, `lib/realtime/handlers/<domain>.ts`, `lib/cron/tasks/<task>.ts` | If P1 kept single files, P3 adds lines to them under the shared-file locks of §13.1 |
| P1 hotfix lane (AP-01, FEA F-NEON-1) | **Dev and E2E moved to their own Neon project** (or an explicit owner waiver) | P3's dev backfill (§6.8), the k6 runs (§12.7) and the throughput bench **do not start** until it lands, because they would spend the production project's 100 CU-h |
| P2 | The `DB` package (schema + client, arm64 binary target) and `finishGame()` built from named CTE fragments in `DB/src/live/finish.ts` (P2 §6.6.4). <br>`Game.mode/moves/moveClocksMs/plyCount/startPly/whitePlayerId/blackPlayerId/botElo/timeClass/fen/endMethod/outcome/completedAt/meta/pgn`. <br>`GamePlayer` (PK `(gameId, userId)`, unique `(gameId, color)`, `result`, `endedAt`, `opponentUserId/opponentName/opponentRating`, `ratingBefore/After/Delta`, `timeClass`, `mode`) and the index `game_players_userId_endedAt_gameId_idx`. <br>`POST /api/games/[ref]/complete`; `POST /internal/emit` (body above) + `CT/socket/registry.ts` + `CT/socket/rooms.ts` (`ROOM`); user rooms joined from the token `sub`; `lib/realtime/{connection.ts,UserChannel.tsx}` + `resyncCaches()`. <br>`components/board/Board.tsx` (props `fen, orient, mover, onMove, last, hl, ring, arrows, badge, label, thumb, dimmed`), `MiniBoard` (static SVG), the `MoveQualityBadge` art (B8), `features/engine/EngineProvider.tsx` with the bot ladder, the `features/game` local runner, `GameOverCard`; `FX/` | Blocking for the integration tasks (WP-E). WP-A to WP-D and the UI built against fixtures can start before P2 merges. |
| P2 fix 2.1/2.3 (consistency) | `games.source`, `game_players.source` (`GameSource`) | **Day-1 interface check:** if absent, B1 adds `enum GameSource { REPLAY CHESSCOM LICHESS }` and both columns (defaulted, metadata-only) in M3. P3 does **not** read `games.whiteName…blackTitle`: player cards come from `game_players` + `users.name` (§9.2). |
| ALLOC B26 (COV C-21) | The lapsed-read rule | **Decide before P3 starts** (P3-Q1). The default ("no") needs no code beyond the flag. |
| R-03 | `User.timeZone` arrives in M4 (P4) | The P3 DAL takes `tz = viewer.timeZone ?? "UTC"`. Labels and "best this month" are in UTC until P4 merges, then follow the user with no P3 change. |

### 2.4 Lights up (ALLOC §1.2)

| Slot | Screen | Switched on by |
|---|---|---|
| `over_analysing` (disabled "Analysing · nn%"), the accuracy line, the **coach line** (template), **See What the Coach Thinks**, `over_legend` with **Compare** and **Replay from Move N** | P2 game-over card | **P3** (this phase) |
| Nav item **Review** (→ `/games`) | P1 shell | **P3** (flag `review-v3`) |
| The game-over **bank line** ("+1 position added to your Mistake Bank (move 13)"), from `analysis:done.bank` / `ReviewStatusDTO.bank` (COV C-01) | game over | P5 (`train`) |
| Bank checkbox, "Added" tags, drill CTA, "To Drill" stat, `bank` in A2 | Review moments, Complete | P5 (`train`) |
| Ask about This Move, Ask the Coach about This Game, the coach panel, the VERIFIED tag, LLM text, the LLM coach line (swapped on `review:text_ready`), **Ask on Compare** | Review, Complete, game over, Compare | P7 (`coach`) |
| Personalised legend narration (`no_explanation` "still writing" variant) | Compare | P7 per COV C-04 (or "later") |
| Source tabs, import banner, "Import from Chess.com" in `empty` | `/games` | P4 (`import-v3`) |
| Rating delta on rows and the game-over card | `/games`, game over | P9 |
| Tournament block | game over | P12 |

The allocation file's "Lights up" bullets for P3, P5 and P7 should list the game-over coach and bank lines; that cross-cutting edit is listed in Appendix A.

---

## 3. Current code touched

Line numbers are from `dev` @ `0848b76`, as of today. P1 and P2 change some of these files first. Where they do, the row says what P3 does **on top of** that phase.

### 3.1 Switched to redirects at H3, deleted at H4 (≥ 1 dev release later, P3-D30)

| File (lines) | What it does today | Replaced by |
|---|---|---|
| `WEB/app/analysis/[gameId]/page.tsx` (31) | A client gate `useRequireAuth` (`:8`), then renders the content, so a spinner shows before any fetch (audit-client §3.3) | `WEB/app/(app)/(immersive)/review/[ref]/page.tsx` (RSC) |
| `WEB/app/analysis/[gameId]/AnalysisPageContent.tsx` (1,178) | `fetch('/api/analysis/'+id)` on mount (`:84-90`; a 402 does `window.location.assign`); tabs `explanation\|your-moves\|legend-moves\|practice` (`:24`, `:112-130`); narration autoplay | `features/review/*`, `features/legend-compare/*` |
| `WEB/app/analysis/[gameId]/layout.tsx` (13), `loading.tsx` (7) | metadata `noIndex` | `review/[ref]/layout.tsx` metadata + the designed skeleton `loading.tsx` |
| `WEB/app/analysis/[gameId]/AnalysisShareModal.tsx` (395) | The share modal; also calls `cancel-game` (`:378`) and `create-game` (`:180`) | `/review/[ref]/share` + A10/A11 |
| `WEB/app/analysis/[gameId]/TwitterShareBanner.tsx` (262) | A localStorage-keyed X prompt (`:66-110`) | The "Post to X" row on the share screen |
| `WEB/app/analysis/[gameId]/PracticeView.tsx` (405), `PracticeMoveList.tsx` (292), `EngineConfigSliders.tsx` (171), `MultiPvDisplay.tsx` (74) | Untimed practice with depth and skill sliders; a second Stockfish worker | `/practice` on P2's `EngineProvider` + local runner |
| `WEB/app/api/analysis/[gameId]/route.ts` (346) | `requireSubscribedUser` (`:140`); the participant-or-admin check with 404 masking (`:166-174`, on `creatorId`/`opponentId`); colour guessed three ways (`:200-208`); 3–4 sequential queries; the legend PGN sliced on every request (`:95-129`); a 500 with `details: error.message` | A1 `GET /api/review/[ref]` and A9 `GET /api/review/[ref]/legend`. The participant rule (now through `game_players`) and the 404 masking are kept. The helpers `parsePgnFromMoveNumber` (`:95-129`), `parseResultFromMetadata` (`:42-67`) and `getUserGameOutcome` (`:69-89`) move into `CA/src/legend/` with tests. |
| `WEB/lib/hooks/useAnalysisBoard.ts` (348) | Re-parses `legendPgn` and verbose `Move` objects (`:155-166`) | The columnar payload + `features/review/view-store.ts` |
| `WEB/lib/hooks/usePlayFromPosition.ts` (397) | `new Chess(game.fen())` per move (`:166`), so threefold (`:74`) never triggers (play-b PB4) | P2's local runner (one `Chess` per game) |
| `WEB/lib/hooks/useMultiPvAnalysis.ts` | `setState` on every engine `info` line (CDL §9.3) | Not needed: Review uses server facts; Practice shows no MultiPV panel |
| `WEB/app/components/AnalysisMoveList.tsx` (409) | The analysis-only move list (no other importer, checked with grep) | `features/review/components/ReviewMoveList.tsx` |
| `WEB/lib/hooks/index.ts` | The barrel exports `useAnalysisBoard`, `usePlayFromPosition` (lines 15–18) | Those two exports are removed at H4 |

### 3.2 Kept, reworked or moved

| File | Today | P3 change |
|---|---|---|
| `WEB/app/analysis/[gameId]/NarrationDisplay.tsx` (188), `SegmentList.tsx` (82), `AudioControls.tsx` (224), `ExplanationView.tsx` (139) | The static legend/opening narration UI | **Moved and restyled** to `WEB/features/legend-compare/{NarrationPlayer,SegmentList}.tsx` with DS tokens (square shapes, Title Case labels, 44 px hit targets). They drive the Explanation tab. |
| `WEB/app/analysis/[gameId]/EvalBar.tsx` (49) | A vertical eval bar | **Rewritten** as `WEB/features/review/components/EvalBar.tsx` (`role="img"`, label "White winning chances 63 percent", viewer side per P3-Q8) |
| `WEB/lib/hooks/useExplanationPlayer.ts` (628; `ExplanationData` at `:38`, the hook at `:80`) | Pre-recorded audio + word alignment | **Kept** for the static narration. Autoplay after 2 s is removed; play starts on a gesture only (CDL §9.3). |
| `WEB/app/components/ChessBoard.tsx` (`annotationStyles` at `:60`, used at `:610`) | Tailwind annotation symbols | Replaced by P2's `Board` `badge` prop. If P2 left legacy users of `ChessBoard`, P3 does not touch them. |
| `WEB/app/og/route.tsx` (151; `GET` at `:18`, `ImageResponse` at `:27`) | The generic social card | Kept. Its font and colour helpers move to `WEB/lib/og/theme.ts`, which the share image reuses. The generic card is also what a revoked or expired share's image returns (§5.5). |
| `WEB/app/profile/[referenceId]/GameHistory.tsx:109` | Links to `/analysis/${ref}` | Uses `reviewHref(ref)` from `WEB/lib/routes.ts` (P10 replaces the page later) |
| `WEB/app/components/Breadcrumbs.tsx:94` | `pathname.startsWith("/analysis/")` | Adds `/review/`, `/games`, `/practice`; drops `/analysis/` at H4 |
| `WEB/app/game/[gameId]/GamePageContent.tsx:800` | `analysisPath = /analysis/${gameId}` | Deleted by P2. If it is still alive when P3 lands, it switches to `reviewHref()`. |
| `WEB/middleware.ts:16-26` (`'/analysis(.*)'` at `:23`) | The protected-prefix list | P1 inverts it to a public allow-list (route classes as data, FEA §7). P3 adds the **public** `/r/(.*)` and `/how-we-grade`. `/review`, `/games` and `/practice` are protected by default. |
| `WEB/lib/billing/return-url.ts:24` | `RETURN_PATH_PREFIXES` has `/analysis` | Add `/review`, `/games`, `/practice`; remove `/analysis` at H4; extend `return-url.test.ts` |
| `WEB/app/robots.ts:17` | Disallows `/analysis/` | Disallow `/review/`, `/r/`, `/games`, `/practice` (the `/r/` pages are also `noindex`) |
| `WEB/next.config.js` `redirects()` (`:85-100`) and `headers()` | `/try` → `/pricing` | Add `{source:'/review', destination:'/games', permanent:true}` and the header rule `{source:'/r/:path*', headers:[{key:'X-Robots-Tag', value:'noindex, nofollow'}]}` (AP-14). `/analysis/:ref` is a route handler (it needs a DB lookup), see §7.2 R1. |
| `WEB/lib/auth/viewer.ts` (P1) `VIEWER_SELECT` | — | + `gamesVersion` (one field; it carries the G1 ETag, P3-D27) |
| `WEB/prisma/schema.prisma` (moved to `DB` by P2): `Opening` (`:276-299`), `Game` (`:67-106`), `User` (`:18-65`) | — | M3 additions (§6) |
| `WEB/e2e/specs/paid-only.spec.ts:42`, `membership.spec.ts:52,70` | Probe `/api/analysis/...` | Probe `/api/review/...` (the 401/402/404 matrix) |
| `REPO/deploy/oci/docker-compose.yml` | `websocket` + `caddy` | Add `analysis-worker` under compose profile `worker` with `cgroup_parent: worker-idle.slice`, the caps, the `evalcache` volume, the healthcheck and `stop_grace_period: 30s` |
| `REPO/deploy/oci/setup-server.sh` | Box setup | Creates `/etc/systemd/system/worker-idle.slice` (`[Slice] CPUWeight=idle`) on the dev box, then runs `systemctl daemon-reload` (idempotent) |
| `REPO/deploy/oci/Caddyfile:7-9` | A catch-all `reverse_proxy websocket:3002` (it made `/internal/tournament-event` public, audit-socket S5) | P1/P2 add the path allow-list. P3 adds `@unsigned_worker { path /internal/analysis/* /engine/*; not header X-Rc-Sig * }` → `respond 401`, then `handle /internal/analysis/* { reverse_proxy analysis-worker:3003 }` (SEC-8). `/engine/*` stays 404 until P7. |
| `REPO/.github/workflows/deploy-oci.yml` (build job `:39-59`, bundle `:71-79`) | Builds and deploys the websocket image | Adds the worker image build (`ghcr.io/<owner>/replay-chess-analysis-worker:<sha>`, private package), the healthcheck wait and the smoke step (§12.8). The dev bundle `.env` gets `COMPOSE_PROFILES=worker` and `WORKER_IMAGE`; the prod bundle does not. |
| P2's `WS` internal routes (`/internal/emit`) | `{v:1, targets, event, data, dedupeKey?}`, `x-internal-token` | **No body change.** The `analysis:*` and `compare:*` schemas are registered in `CT/socket/registry.ts`. The receiver accepts HMAC (P3-D21) plus the caller's event allow-list. New `GET /internal/load` (docker network only, never proxied by Caddy). |
| P2's `finishGame()` in `DB/src/live/finish.ts` and `WEB/app/api/games/[ref]/complete/route.ts` → `WEB/lib/games/complete-bot-game.server.ts` | Finish the game and write `GamePlayer` | **P3 appends named fragments to P2's `finishGame()` CTE** (P2 §6.6.4, CON 3.13): `analysisStatus` in the `g` UPDATE, the `jobs` insert, and the `gamesVersion` bump. Bot `complete` adds the same writes plus the legend facts inside its transaction. Both kick the worker after commit. |
| P1's daily Vercel cron (`lib/cron/tasks/*`) | Sweeps `rate_limit_buckets` (temporary) | The sweep moves into the worker's `HOUSEKEEPING`. P3 adds the task `worker-alive.ts`: a signed `GET /internal/metrics` on the worker (in memory, no DB) plus one signed kick (`reason:"cron_backstop"`). If the worker is unreachable it alerts through Sentry. This is the "is the worker alive" backstop (AP-08). |

### 3.3 Created by P3 (top level)

- `CA/**` (including `CLEANROOM.md`, `NOTICE.md`, `README.md`) and `FX/grades/**`.
- `WK/**` (including `NOTICE`, `README.md`, `src/scheduler/recurring/`, `src/pipeline/final-batch/`, `scripts/{bench,smoke,make-golden,seed-evalcache}.ts`).
- Contracts: `CT/http/{review,games,share,practice,legend}.ts`, `CT/socket/analysis.ts`, `CT/internal/{jobs,kick,auth}.ts` (`auth.ts` is P2's if it exists; P3 adds HMAC).
- Database:
  - `DB/prisma/migrations/<ts>_m3_analysis_review/`;
  - `DB/src/json/{review,legend,share}.ts`;
  - `DB/src/jobs.ts`;
  - `DB/src/live/finish.fragments.p3.ts`;
  - `DB/scripts/backfill/{opening-epd,enqueue-analysis,legend-facts}.ts`;
  - `DB/scripts/roles/{replay_worker,replay_app.p3,socket.p3}.sql`;
  - `DB/scripts/explain-hot.ts`;
  - `DB/seed/{review,perf-archive,smoke}.ts`.
- Web data and services: `WEB/lib/data/{review,games,practice,share,legend}.ts`, `WEB/lib/services/analysis/{enqueue,kick}.ts`.
- Web API routes: `WEB/app/api/review/**`, `WEB/app/api/share/**`, `WEB/app/api/me/games/route.ts`, `WEB/app/api/practice/context/route.ts`.
- Web pages:
  - `WEB/app/(app)/(immersive)/review/[ref]/**`;
  - `WEB/app/(app)/games/**`;
  - `WEB/app/(app)/(immersive)/practice/**`;
  - `WEB/app/(marketing)/how-we-grade/page.tsx`;
  - `WEB/app/r/[code]/{page,og/route}.tsx`;
  - `WEB/app/analysis/[ref]/route.ts` (the redirect, at H3).
- Web features and wiring:
  - `WEB/features/{review,games,legend-compare,practice,share}/**`;
  - `WEB/lib/realtime/handlers/analysis.ts`;
  - `WEB/lib/cron/tasks/worker-alive.ts`;
  - `WEB/app/dev/ui/{review,games,compare,practice}/**`.
- The e2e specs in §12, `packages/analytics/src/events/review.ts`, `REPO/docs/qa/phase-03-signoff.md`.

---

## 4. Screens

Every screen below follows the DS rules (`DS/README.md` "Layout: one viewport", "Browser zoom") and the P1 conventions:

- Title Case on buttons, tabs and menu items; sentence case for descriptions and toasts.
- Square shapes.
- lucide icons with `aria-hidden`.
- 44 CSS px effective hit targets.
- No emoji.
- No spinner on its own.

Board screens set `data-rc-lock` (P1 D15 lock mode) and size the board with `BoardStage` container units (P1 D6), so the board never scrolls. Only lists and side panels scroll, inside `ScrollRegion`.

**Breakpoints used by every board screen in this phase.** They come from the board CSS in `DR/V3ReviewSummary.dc.html` `:root`, mapped onto P1's shell modes.

| Condition | Shell (P1) | Side panel `--pw` | Bars `--bars` | Pad | Notes |
|---|---|---|---|---|---|
| width > 1100, fine pointer | sidebar 220 px | 400 px | 96 px | 24 px | Desktop 1440×900 and 1280×800 at 100 % |
| width ≤ 1100, or a coarse pointer and not a phone | rail 64 px | 330 px | 96 px | 16 px | iPad L 1194×834; desktop at 125 % (1152×720) and 150 % (960×600) |
| height ≤ 620 | any | unchanged | 76 px | 10 px | Desktop at 150 %: secondary lines hide (`.meta-2`, the phase line, "Click the graph to jump"); the player bars go compact |
| width ≤ 900 portrait, or width ≤ 600 | tab bar hidden on immersive routes; top bar 44/52 px | docked sheet | — | 12 px | iPhone 393×852, Android 412×915, iPad P 834×1194 |

Board side = `min(100cqw, 100cqh)` of the board stage (P1 `BoardStage`), with a minimum of 260 px and a maximum of 860 px. This replaces the mock's `--bd` formula with the same result.

### 4.1 Review `/review/[ref]` (`?ply=`, `?tab=coach|moves`, `?m=1..3`)

**Boards.** One component. The design's `state` enum is `analysing | failed | clean | summary | moment`.

| Device | Board file | Default state shown |
|---|---|---|
| Desktop 1440×900 | `DR/V3ReviewAnalysing.dc.html` | analysing |
| Desktop | `DR/V3ReviewFailed.dc.html` | failed |
| Desktop | `DR/V3ReviewClean.dc.html` | clean |
| Desktop | `DR/V3ReviewSummary.dc.html` (also holds the `GAME` fixture) | summary |
| Desktop | `DR/V3KeyMoments.dc.html` | moment |
| iPad landscape 1194×834 | `DR/V3iPadLReview.dc.html` | analysing (all 5 states) |
| iPad portrait 834×1194 | `DR/V3iPadPReview.dc.html` | analysing (all 5 states) |
| iPhone 393×852 | `DR/V3iPhoneReview.dc.html` | analysing (all 5 states) |
| Android 412×915 | `DR/V3AndroidReview.dc.html` | analysing (all 5 states) |

Supporting component boards: `DR/V3MoveBoard.dc.html` (board props) and `DR/V2Badge.dc.html` (12 badges). Readable dumps of all of them: `SP/plan/rcta/*.txt`.

**Layout per device (one-viewport compliance).**

| Device | Regions (top → bottom / left → right) | What scrolls |
|---|---|---|
| Desktop / iPad L | **Shell nav:** sidebar 220 / rail 64, `current="review"`. <br>**Board column:** the opponent bar (initials, name, rating, colour, the position label in moment mode), the eval bar + board, your bar ("Accuracy 85 · opp 89" after DONE, eval words). <br>**Aside** (`--pw`): <br>• header: h2 title "Review · vs tal_fan_77", meta label "Rapid 10+0 · C59 Two Knights · 0–1 resigned"; <br>• tabs Coach / Moves (hidden while analysing, failed and in moments); <br>• scroll body; <br>• pinned footer: First, Prev, Next, Last, ⋯ menu (in moments: Previous Moment, primary, ⋯) | Only the aside body (`ScrollRegion`, with the "More below" cue until it is scrolled to the end) |
| iPad P | • Top bar 52 px (Back, title, ⋯). <br>• Opponent strip with eval and position label. <br>• The board at full width (capped by height). <br>• A 7-move strip. <br>• **Docked sheet** (flex 1, `min-height: 0`) with the same content as the aside. <br>• Bottom action bar 64 px (Prev, primary, Next, ⋯). <br>No tab bar (DS: a control bar or a tab bar, never both). | The sheet body |
| iPhone / Android | • Top bar 44 px (Back → the game or the archive, title "Review", ⋯). <br>• Opponent strip + eval. <br>• A full-width board. <br>• A 7-move strip with badges, and `curMove · label · reason` under it. <br>• Docked sheet (~40 % height). <br>• Bottom action bar (Prev, primary, Next, ⋯). <br>The sheet drops the counts table, the phase line and the Moves tab (rct-a §3); the counts stay reachable on Complete. | The sheet body; the move strip scrolls horizontally |

At 150 % zoom on a laptop (960×600 CSS): the rail, 76 px bars, and the phase line and graph caption hidden. The board stays ≥ 260 px and fully visible. `e2e/devices/layout/review.layout.spec.ts` checks it (§12.3).

**States and transitions.** `status` comes from the server; the sub-state comes from the view store.

| State | Sub-state | Entered when | Shows | Leaves to |
|---|---|---|---|---|
| `loading` | — | route navigation before the RSC payload streams | `loading.tsx` = the `V3Skeletons` `review` variant: the board from the start FEN, ghost move rows, an "Analysing · n of m" placeholder | any state below |
| `analysing` | `queued` | `analysis.status = queued` | A `role="status"` card: "Waiting for the engine · about 20 s" (new copy, rct-a Q12). The moves are steppable; no badges yet. | `running` on the first `analysis:progress` |
| `analysing` | `running` | `status = running`, or progress events arriving | "Analysing · move 23 of 61 · 38%", a bar, "Stockfish 18 · on our server" (the depth label from the profile constants). Badges appear per graded ply on the move list and the board. Ungraded graph buttons are `disabled`. | `writing` on `analysis:writing` |
| `analysing` | `writing` | `analysis:writing` | The bar at 95 %, "Finding your key moments…" (P3 copy; P7 changes it to "The coach is writing…") | `summary`, `clean` or `skipped` on `analysis:done`: auto-advance with a 300 ms cross-fade; under reduced motion, an instant swap with focus moved to the h2 |
| `failed` | `retryable` | `analysis:failed {retryable:true}`, or A2 reports a stalled worker | A `role="alert"` card: "Couldn't finish analysis. The engine stopped at move 16 of 27. Moves 1 to 15 are graded below." (this fixes the plies/moves mix-up, rct-a §4.2). <br>**Retry Analysis** (primary) + **What Happened?** (→ `/how-we-grade#failures`). With an auto-retry scheduled: "Trying again in 25 s." <br>Phone primary: **Retry Analysis** | `analysing.queued` (optimistic) on Retry; `analysing.running` on auto-retry progress |
| `failed` | `terminal` | `retryable:false` (4 attempts used) | "We couldn't analyse this game. Your moves are still here." No Retry; **Report a Problem** → `/help#contact` | — |
| `skipped` | — | `status = skipped` (fewer than 6 plies, or aborted) | Empty state: "This game is too short to review." + **Back to My Games** | — |
| `summary` | `coach` (default tab) | DONE and not clean | **Coach card:** the `C` avatar and 2–3 template sentences (no VERIFIED tag, P3-D16). <br>**Narration controls:** play/pause (`aria-pressed`), progress, `0:07 / 0:18`, speed chip 1× → 1.25× → 1.5×. <br>**Start Review · 3 Moments** (the count comes from data). <br>**EvalGraph** (540×72 viewBox, the user's side up, P3-Q8) with "Move 1 · Click the graph to jump · End". <br>**Label-counts table** (You, Opp; 10 rows, plus Forced/Interesting when > 0). <br>**Phase line** | `moment[0].ask` on Start; `summary.moves` on the tab |
| `summary` | `moves` | the Moves tab, or `?tab=moves` | A two-column move list with 18 px badges; the current line "19.Qd2 · Miss. Engine preferred Rxf5." (reason template, §8.7) | `summary.coach` |
| `summary` | `noMoments` | DONE, 0 moments, not clean (only decided-position errors) | "No turning points to review in this game." (new copy, rct-a Q12); no Start; **Done** → complete | complete |
| `clean` | `coach` / `moves` | `review.isClean` | "Clean game. Nothing to drill from this one. Your best decision: 16.Qb8+, a sacrifice that forced mate." (P3 wording; the "Mistake Bank" sentence lights up in P5) + **See Your Best Move** (→ the Moves tab at `bestPly`) + **Done**. Accuracy "97 · opp 71". <br>A clean **loss** uses the template "You held the balance; the result came from elsewhere.", with no congratulation. | complete (`nothing`) |
| `moment` | `ask` | Start, Next Moment, or `?m=` | "Moment 1 of 3 · Move 17" + 3 dots. The board **before** the move, with the previous move highlighted. The ask text. Plan chips (Attack, Defend, Trade, Improve a Piece, Not Sure; `aria-pressed`). "Play your move on the board, or pick your plan". **Reveal the Answer** | `tried`, `found`, `pickLine`, `reveal` |
| `moment` | `tried` | a legal move not in `accept` | Rings on from/to (`#a3412e`); `role="status"` "Not quite: Nd5 isn't the move here. Try again, or reveal the answer." | `found`, `reveal` |
| `moment` | `found` / `found_retry` | the move is in `accept` | The board after the best move, the Best badge, a green highlight. "You found it: Qc1 is the engine's move. In the game you played b3." + the why text | `line`, the next moment |
| `moment` | `pickLine` | a chip is picked | The chip's precomputed feedback (§8.8), for example "You were thinking: trade. The engine's idea here was to defend: Qc1 keeps the queen ready to recapture on e3." | `reveal` |
| `moment` | `reveal` | Reveal | The board after the **played** move with its badge, plus a green arrow for the best move (`#7d9d3e`). Rows "You played 17.b3 · Inaccuracy" / "Best was Qc1 · green arrow". The why text; **Show Line**; **Next Moment** (or **Finish Review** on the last) | `line`, the next moment, complete |
| `moment` | `line` | Show Line | Steps the best line at 600 ms per ply (FENs computed on the client), an `aria-live` SAN list, the position label "Best line · Qc1 Nxe3". Under reduced motion it jumps to the end. | `reveal` |

**Overlays in every state.**
- The ⋯ menu (`role="menu"`):
  - **Flip Board**;
  - **Share Analysis** (disabled until DONE; hidden unless `review-share`);
  - **Download PGN**;
  - **Compare with {Legend}** (legend games only; hover or focus prefetches A9, which is safe because A9 queues nothing, P3-D23);
  - **How We Grade Moves**;
  - **Back to the Game**.
- Narration states: off, playing, paused, done.

**Components.** The P1 kit (`Tabs`, `Chip/ChipGroup`, `Button`, `IconButton`, `Banner`, `ProgressBar`, `Skeleton`, `Menu`, `ScrollRegion`, `ActionBar`, `Kbd`, `Tooltip`) and P2's `Board`, `MoveQualityBadge` and `PlayerBar`. New in P3, all under `WEB/features/review/components/`:

| Component | Props (sketch) | Notes |
|---|---|---|
| `ReviewScreen` | `refId`, `initialTab`, `initialPly`, `initialMoment` | Client root; picks the layout by shell mode; owns the keyboard shortcuts |
| `ReviewBoardColumn` | `fen, orient, last, badge, arrows, ring, hl, label, onMove?` | Wraps P2 `Board` + both `PlayerBar`s + `EvalBar` |
| `EvalBar` | `cpWhite, mate, viewer` | `role="img"` |
| `EvalGraph` | `evals: number[], viewer, ticks: {ply, j}[], cur, gradedPlies, onJump` | SVG: a Win% line + area, ticks for the user's inaccuracy/mistake/miss/blunder/brilliant. One invisible `<button>` per ply in a `role="group"` labelled "Jump to a move". Downsamples to ≤ 240 points over 240 plies. |
| `CoachLine` | `sentences: {t, v}[], narration` | `C` avatar; the VERIFIED tag only when every `v` is true (P7) |
| `NarrationControls` | `text[], onSentence` | Web Speech API (§8.10); hidden when `speechSynthesis` is missing |
| `LabelCountsTable` | `counts: {you: number[13], opp: number[13]}` | A real `<table>`; 22 px badges |
| `ReviewMoveList` | `san[], j, cur, onPick` | Two columns, `aria-current`; keeps the active row in view inside the panel |
| `ReviewMoveStrip` | same | Phone: 7 visible, horizontal scroll |
| `KeyMomentStepper` | `moments, index, phase` | Header, dots, ask/why, chips, result rows, line |
| `ReviewMenu` | flags, `legend`, `share` | The overflow menu |
| `ReviewFooter` | `mode: "moves" \| "moment"` | First/Prev/Next/Last, or Prev Moment/Primary |

**Interactions and keyboard shortcuts.** They are registered in P1's shortcut registry under the "Review" group, so `?` lists them. Single keys work only on fine pointers, with the Single-Key Shortcuts switch on, and outside inputs (P1 D20).

| Key | Action |
|---|---|
| `←` / `→` | Previous / next ply (outside moments) |
| `Home` / `End` | First / last ply |
| `Space` | Play or pause narration (not when focus is on a button) |
| `F` | Flip board |
| `Enter` | Start Review / Reveal / Next Moment / Finish Review / See Your Best Move (the current primary) |
| `M` / `C` | Moves tab / Coach tab |
| `1`–`5` | Pick a plan chip (moments) |
| `Shift+←` / `Shift+→` | Previous / next moment |
| `L` | Show Line |
| `S` | Share Analysis (when enabled) |
| `D` | Done (clean) |
| `Esc` | Close the menu; cancel a piece selection |

Board input in `ask`/`tried`:
- Click-click and drag (P2 `Board`), with the promotion picker.
- Correctness is checked locally against `moment.accept`, so it is instant.
- The URL keeps `?tab`, `?ply` and `?m` through `history.replaceState` (CDL D8). Back leaves the review, and deep links from the Mistake Bank (P5) work.

**Empty, loading and error states.**
- Loading = the `review` skeleton.
- Not found, or not a player → `notFound()`, which renders P1's 404 EmptyState "We couldn't find that review" + **Back to My Games**. It never reveals that the game exists.
- 402 → `requireMemberPage()` redirects to `/pricing?reason=<reason>&redirect_url=/review/<ref>`.
- A network error on a client refetch → an inline `Banner` "Couldn't refresh the review. Your progress is saved." + **Try Again**.
- Socket offline → P1 `OnlineChip`, and the status poller takes over.

**Copy notes.**
- Every number in the copy is computed (moment count, move numbers, percentages).
- Move vs ply wording: progress counts **moves**. "move 23 of 61" means the 23rd of 61 full moves, that is `ceil(gradedPlies/2)` of `ceil(totalPlies/2)`.
- "usually in under 10 seconds" stays only if the dev p50 for a 40-ply game is ≤ 10 s. Otherwise it becomes "usually within half a minute" (P3-Q5).
- Mate shows as `M3`. Scores are from the viewer's side, with a sign (DS "Scores").

### 4.2 Review complete `/review/[ref]/complete`

**Boards.** `DR/V3RvComplete.dc.html` (enum `default | nothing`, default `default`) and `DR/V3RvCompleteClean.dc.html` (default `nothing`). Desktop only. `DR/V3ReviewComplete.dc.html` is off-canvas and superseded; use it for ideas only (the "Review Again" row).

**Layout.**
- **Desktop / iPad L:** shell nav, then a centred main column (max 720 px) holding:
  - the eyebrow "Review · vs tal_fan_77 · 0–1";
  - a serif h1;
  - a stat tile row (`<dl>`);
  - the primary button and the link rows;
  - the card "The moments" (56 px mini boards, warm `article-board-*` squares). It scrolls inside its own `ScrollRegion` when the height is short.
- **iPad P / phones:** one column. The stats in a 3-up row, then the moments card in a `ScrollRegion`, with the primary pinned in an `ActionBar` at the bottom (rct-a Q16: a one-column port).

**States.**

| State | When | Content in P3 | Lights up later |
|---|---|---|---|
| `default` | ≥ 1 moment | h1 "Review complete"; "3 moments reviewed." <br>Stats: Accuracy 85 · Moments 3 · Found 2. <br>Primary **Play Again** (→ `/play`). <br>Rows: **Share Analysis** (`review-share`), **Review Again** (→ `/review/<ref>?m=1`), **Back to My Games**. <br>Moment cards: a mini board after the played move, the badge, "You played 17.b3 · best was Qc1", the why line, a result line ("Inaccuracy · you found it on retry") | **P5:** "· 3 added to your Mistake Bank. The first one comes back tomorrow.", the stat **To Drill**, the primary **Drill These 3 Mistakes · ~2 min**, "Added/Not added" tags. <br>**P7:** the row **Ask the Coach about This Game** |
| `nothing` | clean game | h1 "Clean game"; "Your best decision was 16.Qb8+, a sacrifice that forced mate." <br>Stats: Accuracy 97 · Brilliant 1 · Best this month ✓ (shown only when true). <br>Primary **Play Again**. <br>Up to 3 standout cards (brilliant, great, best mate). <br>"Accuracy 97 is your best this month." (only when true) | P5 copy "Nothing went into your Mistake Bank." |
| `partial` (variant) | Finish pressed before every moment was revealed | "2 of 3 moments reviewed." + a **Finish the Last Moment** row | — |
| `noMoments` (variant) | DONE, 0 moments, not clean | "No turning points in this game." Stats: Accuracy, Best move | — |

**Interactions.** `Enter` = primary. Each mini board links to `/review/<ref>?m=N`. `Esc` and the browser Back return to the review.

**Empty / error.**
- There is no client fetch. RSC errors use the review's 404/402 handling.
- The page is reachable directly (it reads the same DAL).
- `completedAt` is written only by the POST that Finish Review sends.

### 4.3 Share analysis `/review/[ref]/share` (flag `review-share`)

**Board.** `DR/V3RvShare.dc.html` (enum `generating | ready`). Desktop only; phones get a one-column port.

**Layout.**
- **Desktop:** shell nav.
  - **Left, the preview card:** the wordmark, the "Game review" label, a non-interactive `Board` at the key moment with the last move, arrow and badge; "knightowl_88 vs tal_fan_77", "Rapid 10+0 · 0–1", "85 Accuracy", "Key moment: 19.Qd2, Rxf5 won a piece.".
  - **Right, the controls column:**
    - eyebrow "Share analysis", h1 "Share this review", an explainer;
    - a read-only mono link input with a visually hidden label, **Copy Link**;
    - rows **Download Image · 1200 × 630 PNG**, **Post to X**, **Copy PGN with Comments**;
    - the checkbox **Show My Username**;
    - **Stop Sharing This Link** (new, Q12) and **Back to Review**.
- **Phones / iPad P:**
  - the preview card scaled to the width, the controls below, and **Copy Link** pinned in an `ActionBar`;
  - **Post to X** becomes **Share…** (`navigator.share`, with copy as the fallback).

**States.**

| State | When | Shows |
|---|---|---|
| `generating` | the A10 POST is in flight, or the image is warming | A preview spinner "GENERATING…". Copy Link, Download Image and Post to X are disabled; Copy PGN is enabled |
| `ready` | A10 resolved and `fetch(imageUrl)` resolved (or 2 s passed) | The link `playchess.tech/r/<code>`; everything enabled |
| `copied` | Copy Link | `role="status"` "COPIED · LINK WORKS FOR 30 DAYS"; the button label reads "Link Copied" for 2 s |
| `error` (new) | A10 failed (5xx) | `Banner` bad "Couldn't create the link. Try again." + **Try Again** |
| `rate_limited` (new) | A10 429 (a 5-per-minute burst, or the 20-per-day cap) | P1 `RetryCountdown` inline: "You've made a lot of links today. Try again in 3 h." |
| `revoked` (new) | after Stop Sharing | "Link turned off. Anyone opening it now sees an expired page." + **Create a New Link** |

**Interactions.**
- `Enter` = Copy Link. `⌘/Ctrl+C` in the focused input copies.
- Toggling the username is optimistic (the preview re-renders locally), then PATCH A11.
- Copy PGN uses `buildAnnotatedPgn()` on the client.

### 4.4 Public share page `/r/[code]` (no design board, rct-a Q3; built from the `V3RvShare` preview card)

**Layout (one viewport, public chrome).**
- Marketing top nav (logo, **Pricing**, **Start Free Trial**), with P11's compact footer line.
- Centre: the preview card, larger.
  - The board is a **server-rendered SVG `MiniBoard`**, with no board JS.
  - Prev/Next buttons step through the graded moves inside a small client island (≤ 6 kB) that reads the snapshot's columnar arrays.
- A move strip with badges, the accuracy line and the summary sentences.
- The CTA "Get your own games reviewed · Start 7-day free trial" → `/pricing`.
- Phones: one column; the move strip scrolls horizontally.

**States.**
- `ok`.
- `gone` (the link is expired or revoked): "This review link has expired or was turned off." + **See How Replay Chess Works** → `/`. The HTTP status is 200, because App Router pages cannot return 410. The page is `noindex`, so the status has no SEO effect. The API surfaces return 410 `gone`.
- `not_found` (404, cached for 1 h, AP-47).

**Rules.**
- `noindex, nofollow` through `metadata.robots` plus the `X-Robots-Tag` header from `next.config.js` (AP-14).
- Names follow the snapshot's masking (§11.3).
- No internal ids and no clocks.

### 4.5 How we grade `/how-we-grade` (public)

**Board.** `DR/V3HowWeGrade.dc.html` (no state enum; tabs `labels | acc | coach`). There are no device boards. iPad P and phones turn the tabs into a `Segmented` control in one column (inv-pub §2.5).

**Layout.**
- `StageShell` (one viewport, inv-pub). The marketing top nav, as on the board:
  - logo, **Pricing** (→ `/pricing`; flow edge E2, COV C-18);
  - signed-out: **Sign In**, **Start Free Trial**;
  - signed-in: **Play** + avatar, through a client island using `useAuth()` with no network. The box sizes are identical, so there is no CLS.
- Below the nav: the h1 serif "How we grade", a lead line, the tablist and the engine line.
- The tab panel scrolls inside its `ScrollRegion`; the footer is one compact line.

**Content.**
- **Move Labels:** 12 rows: a 28 px badge, the name, and the text from the design's `mq` array, with anchors `#brilliant`…`#blunder`. The Interesting row says "Not given yet: we need a model of human play to grade it fairly." (P3-D15)
- **Accuracy:** the formula card, "move accuracy = 103.1668 × e^(−0.04354 × win% loss) − 3.1669 + 1, clamped to 0–100" (with Lichess's +1, RES §3.1). Then a text equivalent, the game-accuracy explanation, and "shown as a whole number, only after the game".
- **`#failures`** (new): "Why analysis sometimes stops", covering engine restarts, retries and terminal failures.
- **Verified Coach** tab: rendered only when the `coach` flag is on (P7).
- **Engine line:** "Engine: Stockfish 18 on our server, {nodes} positions per move (about {depthP50} plies deep). Last changed {GRADING_CHANGED_AT}.", all from `CA/src/version.ts`.
- Attribution line: "Opening evaluations from the Lichess open database, CC0."

**Interactions.** Tabs with arrow keys (roving tabindex); `?tab=` and the hash are kept in the URL.

### 4.6 Compare with the legend `/review/[ref]/legend` (`?tab=explanation|your_moves|legend_moves|practice`, `?ply=`)

**Boards.**
- `DR/V3LegendCompare.dc.html`: enum `state: default | loading | no_explanation | audio_failed`; `tab: explanation | your_moves | legend_moves | practice`.
- `DR/V3TryCompare.dc.html` (enum `default | loading | error`) is **merged in** (play-b R4/F9): the divergence sentence with a jump button, the two-line stepper with "Paths split here", and the `error` banner. Its locked tabs and "Open Full Comparison" are dropped.
- There are no device boards. P, A and IP use a full-width board, a tab strip and a 60 % docked sheet; IL uses the desktop layout.

**Layout.**
- **Desktop / iPad L:** shell nav (`current="review"`), then the board column: the opponent chip "martin_k 1212 Black"; the board with two arrows, yours grey `rgba(90,90,90,.85)` and the legend's sky `#0369a1`; your chip "knightowl_88 1184 White · you".
- **The aside:**
  - eyebrow "Compare with the legend", h1 "You vs Morphy";
  - the summary line "You matched 2 of 3 moves, then left his path with 12.Ba4.";
  - tabs, a panel `ScrollRegion`;
  - a footer `ActionBar`: **Practice from Here** (primary) and **Share**. **Ask** is not rendered until P7 lights it to `/review/[ref]/coach?ply=<ply>&from=compare` (P3-D20, COV C-04).

**States.**

| State | When | Shows |
|---|---|---|
| `loading` | a slow client navigation | 4 skeleton bars; the board shows the divergence FEN from the payload |
| `default` · Explanation | facts present | A template comparison paragraph built from facts (§8.9). When `ChessPosition.explanation` exists: the static narration player (play/pause, `role="progressbar"`, "0:51 / 2:10 · narrated", speed 0.75× / 1× / 1.5×) and the segment list (clicking a segment seeks and moves the board) |
| `no_explanation` | the position has no static explanation | The template paragraph + "This position has no narrated walkthrough yet. Your moves and Morphy's are in the other tabs." (P3 copy). The design's "The coach is still writing this one" belongs to the personalised-narration owner (§2.2). |
| `audio_failed` | the `<audio>` `error` event | A warn banner "Audio unavailable. The text below is the same explanation."; Play disabled |
| `default` · Your Moves | — | "You left Morphy's path on 12.Ba4. The game was drawn by repetition on move 17." + a table (No., White, Black, mark: matched / left the path / blank) |
| `default` · Morphy's Moves | — | "Morphy won in 17 moves. His moves are in blue." + the legend line table (sky colour plus a labelled column, so colour is never the only cue) |
| `default` · Practice | — | "Play on from move 12 against the engine and try Morphy's move yourself." + **Practice from Move 12** + "Engine 1400 · untimed · not rated" |
| `error` | the A9 fetch failed, or `status = failed` | "Couldn't load the comparison." + **Try Again** (A9b) |
| variant `followed` | no divergence | "You found every one of Morphy's moves from move 10." |
| variant `opponent_left` | `divergenceBy = opponent` | "The engine left the game's path on 25…Kb6 (Topalov played 25…Kxd4), so the comparison stops there." |
| variant `pending_evals` | `facts_ready`, and the evals are not filled yet | The eval row "Win chances after the split: you 41 % · Morphy 78 %" shows a ghost. On mount the page sends A9b `POST …/legend/compute` once (the only enqueue, P3-D23), then waits for `compare:ready`. |

**Interactions.** `Space` play/pause; `←/→` step the board along the active line; `↑/↓` first/last; `1`–`4` tabs; arrow keys inside the tablist. A game with no legend position → 308 to `/review/<ref>`.

### 4.7 Game-over slots (P2's `V3Game` screen)

**Boards.**
- `DR/V3GameOverLegend.dc.html` (the V3Game enum, state `over_legend`).
- The `over_analysing` state in the same enum and in `DR/V3Game.dc.html` (P2 §4.3 row 47).
- The device game-over boards `DR/V3{iPhone,Android,iPadL,iPadP}GameOver.dc.html`: P2-owned layouts; P3 fills the slots.
- The coach line appears in the `result.coach` field of 21 `over_*` states (COV C-02):
  - `over_checkmate_win/loss`, `over_resign_win/loss`, `over_timeout_win/loss/insufficient`;
  - `over_stalemate`, `over_threefold`, `over_fifty`, `over_insufficient`, `over_agreement`, `over_abandoned`, `over_analysing`;
  - `over_tournament`, `over_rematch_sent/received/declined/expired`.

**What P3 adds.** P2's `GameOverCard` renders these when `review-v3` is on, through `WEB/features/review/game-over/{GameOverReviewSlot,GameOverCoachLine,GameOverLegendSlot}.tsx`.

| Slot | Data | States and copy |
|---|---|---|
| Review primary | `useAnalysisProgress(ref, {target:"status"})` → `qk.review.status(ref)` | **`analysing`:** a disabled primary with a spinner, "Analysing · 64%" (the % is `gradedPlies/totalPlies`; P3-D29). <br>**`done`:** the eyebrow "ACCURACY 91 · 1 MOMENT TO LEARN FROM" (final server numbers only, RES R-KM-01) and the primary **See What the Coach Thinks** (`<Link prefetch>` full, CDL §3.8). <br>**`failed`:** "Review paused · retrying" + the primary **Open Review** (it opens the `failed` state). <br>**`skipped`:** the slot is hidden (aborted or too short). |
| Coach line (COV C-02) | `ReviewStatusDTO.review.coachLine` (seeded or refetched) / `analysis:done.coachLine` | Hidden while analysing. When done: one sentence in the result card's `coach` position, `aria-live="polite"`, at most 160 characters. It is the template turning-point sentence, or the best-decision sentence for a clean game (§8.7). P7 swaps in the verified LLM sentence on `review:text_ready`. |
| Legend block (`over_legend`) | `ReviewStatusDTO.comparison` (`LegendSummaryDTO`): from the bot `complete` response, or from one A2 fetch on mount for live legend games (A2 inserts the facts lazily, P3-D24) | Table rows (No., yours, the legend's, ✓/×). "Matched 2 of 3 · left Morphy's path with 12.Ba4". An outcome line, "Morphy won this; you drew." <br>**Replay from Move 12** (`btn-t`, → `/practice?game=<ref>&ply=<divergencePly>`; COV C-03). <br>**Compare with Morphy** → `/review/<ref>/legend`. When there is no divergence: "You followed Morphy to the end." and no Replay link. |
| Bank line | `analysis:done.bank` / `ReviewStatusDTO.bank` (both `null` in P3) | **Not rendered in P3**; P5 owns it (COV C-01) |

Also not in P3: "Blitz 1184 → 1186 (+2)" (P9) and the tournament block (P12).

### 4.8 Practice from a position `/practice` (`?game=<ref>&ply=<n>` · `?position=<ref>` · `?fen=<urlencoded>`)

**Board.** `DR/V3Practice.dc.html` (enum `default | engine_loading | engine_failed | offline`). There are no device boards. P, A and IP use the game layout: top bar, chips, a full-width board, a coach line card, an `ActionBar`.

**Layout.**
- **Desktop / iPad L:** the shell nav, with `current = review` when coming from compare or review, otherwise the origin's section.
- **Board column:** an engine chip "Engine 1400 · Ready · ∞" and your chip "knightowl_88 1184 · Your move · ∞".
- **The aside:**
  - the eyebrow "Practice · from move 12" and a serif h1 (the plan title);
  - the copy "Engine 1400 plays Black. Untimed and unrated; take back as often as you like.";
  - a status line and the hint card;
  - an `ActionBar`: **Compare** (only with `?game=` on a legend game), **Take Back**, **Reset**.

**States.**

| State | When | Shows |
|---|---|---|
| `engine_loading` | `EngineProvider` not ready | The board dimmed; the engine chip "Loading"; "Starting the engine · 34%" (determinate, from the fetch progress); "First load only: about 7 MB, cached after this." |
| `default` | ready | As above; the side to move comes from the FEN. If the engine is to move: "Engine 1400 plays White. The engine moves first." |
| `engine_failed` | the worker failed to start | The board dimmed; "Engine didn't start. This browser may block WebAssembly." + **Retry** |
| `offline` | `useOnline()` false | "Offline. The engine is cached, so practice still works; hints from the coach are unavailable." (hint card hidden; Compare disabled) |
| variant `over` | mate, stalemate or repetition in practice | An inline result, "Checkmate · you won", + **Reset** |
| error `illegal_fen` | the `?fen=` fails validation | A 400 page "This position isn't legal" + Back |

**Hint (P3, local and free).**
- Level 1: "Hint: look at your {piece} on {square}." (from the local engine's best move, §8.11).
- Level 2: an arrow.
- There is no API.

**Interactions.** `Backspace` Take Back (the last full move pair); `R` Reset; `H` hint (twice for the arrow); `←/→` step the practice line; `F` flip; `Esc` cancel the selection.

### 4.9 My games `/games` (`?q=&result=win,loss,draw&tc=bullet,blitz,rapid,classical&moments=1&sel=<ref>`)

**Boards.** `DR/V3GamesArchive.dc.html` (enum `default | filters_open | empty | loading | import_running | error`), `DR/V3GamesArchiveFilters.dc.html` (default `filters_open`), `DR/V3GamesArchiveEmpty.dc.html` (default `empty`). Desktop only.

**Layout.** The list is the only thing that scrolls (in its own `ScrollRegion`); the page never does.

| Device | Layout |
|---|---|
| Desktop | Shell nav (`current="review"`). <br>**Header:** the eyebrow "Review", serif h1 "My games", a search field ("Opponent or opening"), the **Filter** button with the active count. <br>**List card:** a virtualised `role="listbox"` (`@tanstack/react-virtual`), row height 56 px. <br>**Aside card** (360 px): the final-position `Board` (static), "{source} · {tc}", "vs tal_fan_77 · lost", the note line, **Open Review** (primary), **Compare** (legend games only) |
| iPad L | Same, with a 300 px aside |
| iPad P | The aside collapses to a 200 px board strip above the list |
| Phones | A full-width list; tapping a row opens the review (no aside); Filter opens a bottom `Sheet` (P1 `ResponsiveDialog`) |

**States.**

| State | When | Shows |
|---|---|---|
| `loading` | `loading.tsx`, or a client refetch with no data | 9 ghost rows + an aside placeholder (`V3Skeletons` list) |
| `default` | rows | Each row shows: <br>• the result WIN/LOSS/DRAW (word + colour); <br>• the opponent + rating; <br>• the note: the `headline`, "Not reviewed yet", "Analysing" with a spinner, or "Analysis paused" for `failed`; <br>• the opening or position + time control; <br>• the date label (server-rendered in `viewer.timeZone ?? "UTC"`, CDL §2.3 rule 6, R-03); <br>• the rating delta "—" (P9) |
| `filters_open` | Filter | A popover (desktop) or sheet (phones): the active filters as removable chips, a Result `Segmented` (All, Wins, Losses, Draws), Time Control chips, the checkbox "Only games with moments to review", **Clear All**, and the primary **Show 7 Games** (a live count from `limit=0`) |
| `empty` | no games at all | "No games yet. Play a game and the coach reviews it here." + **Play a Game** (→ `/play`). The "Import from Chess.com" button lights up in P4. |
| `empty` (filtered, variant) | filters or a search with no match | "No games match 'pawnstorm'." + **Clear Search** / **Clear Filters** |
| `error` | the list query failed | `Banner` bad "Couldn't load your games." + **Try Again** (the design's "Imported games are safe." returns with P4) |
| `import_running` | P4 | — (not rendered in P3) |

There are no source tabs in P3, only All. The tabs light up with P4.

**Interactions.**
- `↑/↓/Home/End` move the selection (`aria-activedescendant`); `Enter` opens the review; `C` opens Compare when available.
- `F` focuses the search field (`/` stays the P1 command palette); `Esc` closes the popover; the search is debounced 250 ms; Space toggles a chip.
- A row click selects (`?sel=`); a double-click opens. On phones a tap opens.

### 4.10 Dev demo routes (P1 SPEC D11; dev and test only, registered in the hook registry, TST X12)

`WEB/app/dev/ui/review/page.tsx?state=analysing|queued|writing|failed|terminal|clean|summary|moves|moment&phase=ask|tried|found|reveal|line&device=…&stress=1` renders `ReviewScreen` from the fixtures in `CA/fixtures/design-mock.ts`.
- Socket events are simulated by a local timer, which mirrors the mock's 300 ms ticks.
- `stress=1` (TST X9) uses 20-character usernames, a 120-ply game, the longest opening name, and both colours.

The same pattern covers:
- `/dev/ui/review/complete?state=default|nothing|partial`;
- `/dev/ui/review/share?state=generating|ready|copied|error|revoked`;
- `/dev/ui/games?state=…`;
- `/dev/ui/compare?state=…&tab=…`;
- `/dev/ui/practice?state=…`;
- `/dev/ui/game-over?slot=analysing|done|failed|legend|legend_followed` (P2's card with P3's slots).

Together they make every enum value reachable for the device × zoom suite, as ALLOC §1.1.4 requires. Specs tag demo-only coverage `@demo:<Board>.<state>` and real-data coverage `@state:<Board>.<state>` (TST X8).

---

## 5. UI ↔ API data flow

Conventions are inherited from CDL and ALLOC §5.4:

- **First paint** comes from RSC through the server-only DAL (`WEB/lib/data/*.ts`, `import "server-only"`, `cache()`).
- **Client cache:**
  - TanStack Query, seeded by `HydrationBoundary`;
  - keys only from `qk`;
  - responses go through `api()` with `devSchema(Schema)`, so the zod schemas are dropped from production bundles (AP-12).
  - 304s are transparent: `private, no-cache` plus a strong ETag, with the browser revalidating. There is no `ifNoneMatch` option (AP-21).
- **Push** over the user room, with polling only as a fallback.
- **Errors** go through `reactToApiError()`:
  - 401 → session modal;
  - 402 → pricing with `reason`;
  - 429 → inline countdown;
  - 503 → maintenance;
  - 5xx → a toast with the request id.
- **GETs never queue engine work** (P3-D23). Each route's allowed GET side effects are declared in the route registry (`sideEffects: ["kick_cas" | "legend_facts"]`), and the P1 GET-purity gate fails on anything else (§12.2).

### 5.1 New query keys and freshness (`WEB/lib/api/keys/review.ts`, `…/games.ts`; additive)

```ts
review: {
  all:    () => ["review"] as const,
  detail: (ref: string) => ["review", ref] as const,            // ReviewDTO
  status: (ref: string) => ["review", ref, "status"] as const,  // ReviewStatusDTO (fallback poller, game-over card, legend block)
  legend: (ref: string) => ["review", ref, "legend"] as const,  // LegendCompareDTO
  share:  (ref: string) => ["review", ref, "share"] as const,   // ShareDTO | null
},
games: {                                                         // P2/CDL already define the namespace; P3 adds list and counts
  list:   (f: GamesFilter) => ["games", "list", norm(f)] as const,
  counts: (f: GamesFilter) => ["games", "counts", norm(f)] as const,
},
```

| Key | Endpoint (client refetch) | DAL (first paint) | `staleTime` | Focus refetch | Realtime updater | Seed / prefetch |
|---|---|---|---|---|---|---|
| `qk.review.detail(ref)` | A1 `GET /api/review/[ref]` (strong ETag) | `getReview(viewer, ref)` | `Infinity` when `status ∈ {done, skipped}` or `failed.terminal`; else `0` | only while not done | `analysis:progress` → `setQueryData` (merge ply deltas); `analysis:writing` → set phase; `analysis:done` → `invalidateQueries` (one GET); `analysis:failed` → `setQueryData` | RSC `prefetchQuery`; the game-over primary `<Link prefetch>` (once done); archive row intent prefetch |
| `qk.review.status(ref)` | A2 `GET /api/review/[ref]/status` (strong ETag → 304) | `getReviewStatus(viewer, ref)` | `0` | — | the same events, mapped to the status shape (`coachLine` from `analysis:done`) | the game-over card seeds it from `game:result.review` (live) or the `complete` response (bot) |
| `qk.review.legend(ref)` | A9 `GET /api/review/[ref]/legend` (strong ETag) | `getLegendCompare(viewer, ref)` | `Infinity` once `ready`; `0` while `facts_ready` | no | `compare:ready` → `invalidateQueries` | RSC prefetch on `/legend`; `prefetchQuery` on hover/focus of the menu item and the game-over **Compare** CTA (safe: A9 queues nothing) |
| `qk.review.share(ref)` | — (mutation results only) | `getActiveShare(viewer, ref)` | `Infinity` | no | — | RSC seed on the share page |
| `qk.games.list(f)` (infinite) | G1 `GET /api/me/games?…&cursor&limit=30` | `listMyGames(viewer, f, null)` | 60 s | yes | `games:changed` / `analysis:batch` → mark stale, throttled to 1 per 10 s per tab, with `refetchType: "active"`; `analysis:progress`/`done` → `setQueriesData` patch of the matching row (status, accuracy, headline, momentsCount) | RSC `prefetchInfiniteQuery` (page 1) |
| `qk.games.counts(f)` | G1 with `limit=0` | the same | 60 s | yes | `games:changed` / `analysis:batch` | a streamed `<Suspense>` block; the popover's draft filter |

`GamesFilter` = `{q?: string; result?: ("win"|"loss"|"draw")[]; tc?: TimeClass[]; moments?: boolean}`. `src` is reserved for P4.

### 5.2 Review `/review/[ref]`

**First paint (server).** `WEB/app/(app)/(immersive)/review/[ref]/page.tsx`:

```tsx
export default async function ReviewPage({ params, searchParams }) {
  const { ref } = await params;
  const viewer = await requireMemberPage({ allowLapsedRead: flags.reviewLapsedRead });   // B26: default false → redirect
  const qc = getServerQueryClient();
  const review = await qc.fetchQuery({ queryKey: qk.review.detail(ref), queryFn: () => getReview(viewer, ref) });
  // getReview throws DataError("not_found") for non-players → notFound() (404 masking, analysis route :166-174)
  // No enqueue here (P3-D23). A lost kick is healed by the A1/A2 kick CAS, not by page renders.
  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <ReviewScreen refId={ref} initialTab={tab} initialPly={ply} initialMoment={m} />
    </HydrationBoundary>
  );
}
```

- One DB round trip for the payload (§9.2), plus the viewer, which is cached per request.
- The page has **no side effects**. A router prefetch, a link preview or a crawler that renders it cannot queue engine work.
- The board and both player bars render from the payload outside any `<Suspense>`.

**Client.**

| Concern | Mechanism |
|---|---|
| Read | `useQuery(reviewQuery(ref))` reads the seeded cache; there is no fetch on mount |
| Unanalysed games | If `status === "none"` after hydration, `useMutation(A3)` runs once with an optimistic `status="queued"`. `onError` → back to `none` with the toast "Couldn't start the analysis. Try again." + Retry. This is the only enqueue from an open review. |
| Outdated grading | If `analysis.version < GRADING_VERSION` and the status is `done`, the old grades stay on screen (still valid) and A3 is sent once with `{reason:"regrade"}`. The regrade is engine-free (P3-D28), so `analysis:done` arrives in well under a second of worker time. |
| Live progress | `useAnalysisProgress(ref)` (`WEB/features/review/useAnalysisProgress.ts`) registers a handler in `WEB/lib/realtime/handlers/analysis.ts` for `analysis:*`, filtered by `gameRef === ref`. A3 and A4 send `watch: gameRef` in their kick, so progress streams even for a backlog job (P3-D26). |
| Delta merge | `analysis:progress {from, gradedPlies, totalPlies, evals, best, j}` → `setQueryData(qk.review.detail(ref), d => mergePlies(d, ev))`. `mergePlies` (in `CA/src/codec.ts`) splices `evals[from..]`, the `best` tokens and the `j` chars, and ignores stale deltas (`ev.gradedPlies <= d.analysis.gradedPlies`). |
| Done | `analysis:done` → `invalidateQueries(qk.review.detail(ref))`. The single A1 GET returns the full payload (moments, text, accuracy). The view store then plays the auto-advance. `staleTime` becomes ∞. |
| Gap recovery | After a reconnect gap > 5 s, P2's `resyncCaches()` marks a non-done `review.detail` stale → one A1 GET (ETag; 304 if nothing changed). |
| Fallback poll | `useQuery({...reviewStatusQuery(ref), refetchInterval: reviewFallback})`, where `reviewFallback` is created **once per query**. Its start time lives in `query.meta.pollStartedAt` (set on the first call), not in a closure, so `stopAfterMs: 180_000` holds across renders (AP-20). Schedule `[2000, 4000, 8000, 15000]`. It is **enabled only while** `status ∈ {queued, running}` **and** the socket is not live (or did not connect within 3 s) **and** the tab is visible. When the status changes, A1 is refetched once. |
| Lost-kick heal | Each A1/A2 response whose probe shows `QUEUED` with `runAt` older than 30 s runs the kick compare-and-set in `after()` (§7.3 `healKick`). At most 1 kick per job per 30 s, however many tabs poll (AP-09). |
| Stall detection | If `status ∈ {queued, running}` and no `analysis:*` event arrives for 45 s while the socket is live → one A2 fetch. A2 reports `failed {code:"worker_stalled", retryable:true}` when the job heartbeat is older than 90 s. |
| Retry | `useMutation(A4)`: optimistic `analysis.status="queued"`, keeping `gradedPlies`. `onError`: 409 (`already_running`) → keep `queued`; 410 → `failed.terminal`; other errors → restore + the toast "Retry failed. Try again in a minute." Focus goes to the progress card. |
| View state | `createReviewViewStore()` (`WEB/features/review/view-store.ts`, Zustand per instance): `ply`, `orient`, `phase` (moment sub-state), `tried`, `planChip`, `lineN`, `narration`, `menuOpen`. The URL holds `?tab`, `?ply` and `?m` via `useUrlState` (`history.replaceState`). |
| Walkthrough progress | Events (`viewed`, `attempt{uci, correct}`, `plan_picked{chip}`, `revealed`, `show_line`) are queued in the view store. `useReviewProgressSync(ref)` sends A5 `PATCH /progress {momentIndex, events[] ≤ 50}`: debounced 1 s, and immediately with `fetch(..., {keepalive:true})` on `pagehide`/`visibilitychange:hidden`. It is fire-and-forget: a failure re-queues once, then drops (analytics duplicates the signal). The cache's `review.progress` is updated locally (optimistic), so a remount restores `momentIndex`. |
| Bank toggle | Hidden until P5 (P3-D19). The mutation hook `useToggleMomentInBank` (CDL §3.6.1) ships with A6, behind `useFlag("train")`. |
| Finish Review | `fetch(A7, {method:"POST", keepalive:true})`, then `router.push('/review/<ref>/complete')`. `onSettled`: `invalidateQueries({queryKey: qk.games.all(), refetchType: "none"})`, plus a cross-tab stale of `games.*`. |
| Download PGN | Client-side `buildAnnotatedPgn(review)` → a Blob download `replaychess-<white>-vs-<black>-<yyyy-mm-dd>.pgn`. No network. |
| Errors | 401 (session expired) → modal; on return the query refetches. 402 on A3/A4/A5 → pricing redirect with `redirect_url` = the current URL. 404 on a refetch → `notFound()` via an error boundary. |

**Request budget per review session** (target; measured in §9.6):
- 1 RSC render;
- 0 polling (socket live);
- 1 A1 refetch at done;
- 1–3 A5 PATCHes;
- 1 A7.

That is **3–6 Vercel invocations**, plus 1 A3 only for games that were never enqueued (pre-P3 games and, from P4, imports).

### 5.3 Review complete `/review/[ref]/complete`

- RSC only: `getReviewComplete(viewer, ref)` returns `{header, accuracy, moments[{ply, fenAfter, playedSan, bestSan, judgement, why0, result}], found, isClean, standouts[], bestThisMonth, partial}`.
- One `Promise.all` of two statements: the review payload's tables, and `max(accuracy)` this month over `game_players` (§6.4). The month boundary is in `viewer.timeZone ?? "UTC"`.
- No client queries. Links are plain `<Link>`s. **Review Again** is `prefetch={false}`.
- A7 is not called from this page; Finish Review sent it. A direct visit renders `partial` when `completedAt IS NULL`.

### 5.4 Share `/review/[ref]/share`

| Step | Mechanism |
|---|---|
| First paint | RSC `getActiveShare(viewer, ref)` (a live REVIEW share for this viewer and game: not revoked, not expired) → seeds `qk.review.share(ref)`. If none exists, the page renders `generating`. **No creation on GET** (prefetch safety). |
| Create | A client `useEffect` runs once: `useMutation(A10)` with `Idempotency-Key` = the `sessionStorage` key `rc:share:<ref>` (try/catch) and body `{showUsername: true}` → `setQueryData(qk.review.share(ref), out)`. Then `fetch(out.imageUrl)` warms the image; `ready` on resolve, or after 2 s. |
| Toggle username | Optimistic `setQueryData` + the preview re-renders → `PATCH /api/share/[code] {showUsername}` → `{imageUrl}` (with a bumped `?v=`); rollback + toast on error |
| Stop sharing | `DELETE /api/share/[code]` (optimistic: state `revoked`); rollback on error |
| Copy / Post to X / Copy PGN | Local only: `navigator.clipboard.writeText`, `https://x.com/intent/post?text=…&url=…`, `buildAnnotatedPgn` |
| 429 | `RetryCountdown` inline; the primary stays disabled until `retryAfterSec` |

### 5.5 Public share `/r/[code]` and its image (AP-05, AP-14, AP-47)

**Page.** `WEB/app/r/[code]/page.tsx`:

```ts
export const revalidate = 3600;          // ISR: re-render at most hourly per visited code; bounds expiry overrun to 1 h
export const dynamicParams = true;
const loadShare = (code: string) =>
  unstable_cache(() => getPublicShare(code), ["share", code], { tags: [`share:${code}`], revalidate: 3600 })();
```

- The loader reads **only** `shares.snapshot`, `kind`, `expiresAt`, `revokedAt` and `imageVersion`.
- An unknown code → `notFound()`. The 404 is cached for the revalidate window, so random-code probing costs at most one render per code per hour, and P1's edge limiter caps the rate.
- Expired or revoked → the `gone` view (§4.4).
- **No `headers()` call.** `robots` is set in `generateMetadata`; `X-Robots-Tag: noindex, nofollow` comes from `next.config.js` `headers()`. Caching comes from ISR alone.
- **No flag check.** A share row can only be created while the creator has `review-share`, so the public page never evaluates a per-user flag, which would make no sense on an ISR page.
- PATCH and DELETE call `revalidateTag("share:" + code)` in the route, so the next request renders the new state.
- Views: there is no view counter (DM D17). PostHog `share_page_viewed` is sent server-side in `after()` on renders, and by a client island beacon.

**Image.** `WEB/app/r/[code]/og/route.tsx` (`GET`, `next/og` `ImageResponse`, 1200×630, the board drawn as 64 divs, `lib/og/theme.ts`):
- `generateMetadata` points `openGraph.images` and `twitter.images` at `/r/<code>/og?v=<imageVersion>`.
- Response headers:
  - `Cache-Control: public, max-age=3600`: short in browsers and social caches, because a CDN purge cannot reach their copies;
  - `Vercel-CDN-Cache-Control: public, s-maxage=31536000`;
  - `Vercel-Cache-Tag: share:<code>`.
- The image reads the same tagged loader as the page. A revoked, expired or deleted share returns the **generic Replay Chess card** (the `/og` design) with `max-age=300`, never the old board or names.
- PATCH and DELETE call `invalidateByTag("share:" + code)` from `@vercel/functions` in `after()` [V: the API name and its Hobby availability are checked in task G5; the fallback is the `?v=` bump plus the 1 h browser TTL].
- `?download=1` adds `Content-Disposition: attachment; filename="replaychess-review-<code>.png"` and is otherwise the same response.
- The client island (`ShareStepper`) makes no fetch.

### 5.6 How we grade `/how-we-grade`

`export const dynamic = "force-static"`. It imports `GRADING`, `LABELS` and `ENGINE_PROFILE` from `CA/src/version.ts`. There are no queries and no client fetches. The auth-aware nav CTA is a `useAuth()` island with an identical box size (no CLS).

### 5.7 Compare with the legend `/review/[ref]/legend`

| Concern | Mechanism |
|---|---|
| First paint | RSC `prefetchQuery(qk.review.legend(ref), getLegendCompare)`. When the facts row is missing (a game finished before P3, or a live legend game), the service computes and inserts the facts (`legend_facts`: < 5 ms of chess.js, `ON CONFLICT DO NOTHING`). **It never enqueues engine work** (P3-D23). |
| Static narration | `ChessPosition.explanation` JSON is fetched **only** when the Explanation tab is active: `useQuery({queryKey: [...qk.review.legend(ref), "explanation"], queryFn: () => api(A9 + "?include=explanation")})`. The default payload carries only `hasExplanation`, which keeps the ~20 KB explanation JSON off the first payload. Audio is `preload="none"` and loads on Play. |
| Pending evals | When `status = facts_ready` and the game's analysis is `done`, the client calls A9b `POST /api/review/[ref]/legend/compute` once (`useMutation`, optimistic `computing`). Then `compare:ready` → `invalidateQueries(qk.review.legend(ref))`. Fallback: A2 carries `comparison.status`, and the poller rule from §5.2 applies. |
| Retry | The same A9b after `status = failed` → 202. After 3 attempts → 410 `gone` (§7.2). |
| Practice from Here | `<Link prefetch={false} href="/practice?game=<ref>&ply=<divergencePly or the current ply>">` + `router.prefetch` on hover (P1 `AppLink`) |
| Tabs / ply | URL via `replaceState` |

### 5.8 Game-over slots (on P2's game screen)

- **Seeds** (either is written into `qk.review.status(ref)` with `setQueryData`):
  - live games: `game:result` (P2 event in `CT/socket/game.ts`), with the field `review: {status: "queued"|"skipped", etaSec}` (CON 3.9);
  - bot and legend-bot games: the `complete` response (`analysis: {status, etaSec}`, `comparison: LegendSummaryDTO | null`).
- **Legend data for live games:** when `game.isLegend` and the seed has no `comparison`, the card fetches A2 once on mount. A2 inserts the facts lazily (P3-D24).
- **Live updates:** `useAnalysisProgress(ref, {target: "status"})` maps:
  - `analysis:progress` → `{gradedPlies, totalPlies}`;
  - `analysis:done` → `{accuracy, momentsCount, coachLine, isClean}`.
  
  The card is a watched view: the socket finish and bot `complete` enqueue at `GAME_ENDED` (80), so progress is emitted.
- **Fallback:** the same per-query poller on A2, only while the card is visible and the socket is down.
- **Prefetch:** once `status` is `done`, `router.prefetch('/review/<ref>')`. The primary is a full `<Link prefetch>` (CDL §3.8 "highly likely next click"), which is safe because the page has no side effects.

### 5.9 Practice `/practice`

- RSC `getPracticeContext(viewer, params)` → `{fen, sideToMove, humanColor, title, fromLabel, botElo, backHref, compareHref | null, planLine | null}`:
  - `?game=` requires the viewer to be a player (404 otherwise); the FEN is computed from `moves` up to `ply`;
  - `?position=` reads `chess_positions` by ref;
  - `?fen=` is validated: a legal FEN, one king each, and the side not to move is not in check.
- No client queries. The engine is `EngineProvider` (P2: lazy, hashed and immutable WASM, with `<link rel="prefetch">` on hover of any **Practice** link).
- No server writes. An optional local resume lives in `sessionStorage` per URL (try/catch).
- `GET /api/practice/context` (PR1) exists for client callers outside the RSC (the Mistake Bank "study this position" in P5). P3's own pages never call it.

### 5.10 My games `/games`

| Concern | Mechanism |
|---|---|
| First paint | RSC: `requireMemberPage()` → `parseGamesFilter(searchParams)` → `prefetchInfiniteQuery(qk.games.list(f), listMyGames(viewer, f, null), initialPageParam: null)`. Page 1 carries `meta.filteredTotal` and `meta.counts` (AP-38). The aside renders the first row (or `?sel=`) from the page data, with no extra query. |
| Paging | `useInfiniteQuery({getNextPageParam: last => last.meta.nextCursor ?? undefined, maxPages: 10})`; an `IntersectionObserver` sentinel with `rootMargin: "600px"` calls `fetchNextPage()`. Pages 2 and later return only `meta.nextCursor` (no counts, AP-38). |
| Filters / search | The URL is the state (`replaceState`). A key change uses `placeholderData: keepPreviousData` (dimmed rows, `aria-busy`, a hairline after 200 ms; never a skeleton). The query function passes an `AbortSignal`. Search is `enabled: q.length === 0 \|\| q.length >= 2` and debounced 250 ms. |
| Popover live count | `useQuery(qk.games.counts(draft))` → G1 `limit=0` → `meta.filteredTotal` for "Show N Games", debounced 150 ms, `staleTime` 60 s |
| Realtime | `games:changed` and `analysis:batch` → `invalidateQueries({queryKey: ["games"], refetchType: "active"})`, throttled to 1 per 10 s per tab with a trailing edge. Events that arrive while the tab is hidden only mark the data stale. `analysis:progress/done` → `setQueriesData({queryKey: ["games","list"]}, patchRow(gameRef, …))`. |
| Revalidation | G1's ETag is `"g<viewer.gamesVersion>-<hash>"`, so a revisit or a focus refetch with no new games costs 0 statements beyond the viewer (P3-D27) |
| Selection prefetch | Selecting a row → `router.prefetch('/review/<ref>')` after an 80 ms dwell (fine pointer) |
| Errors | A list error → the `error` state with **Try Again** (`refetch()`); a next-page error → an inline row "Couldn't load more · Try Again" |

### 5.11 Socket events P3 consumes and emits

All of these go to `user:{userRef}` and use `domain:event` names with `{v:1}` payloads. Schemas live in `CT/socket/analysis.ts`, registered in P2's `CT/socket/registry.ts` (R-07: one registry). Wire enums are lowercase (R-17).

| Event | Payload (zod) | Emitted by, and when | Size | Consumers |
|---|---|---|---|---|
| `analysis:queued` | `{gameRef, position: number, etaSec: number}` | web A3/A4 (`after()`), socket finish (after commit), bot `complete` | ≤ 80 B | review, game-over card, archive row |
| `analysis:progress` | `{gameRef, from: number, gradedPlies, totalPlies, evals: number[], best: string, j: string, depthP50: number}`: one frame every 2 plies or 300 ms, whichever comes first | worker, **only while** the job priority is ≥ `GAME_ENDED` or the game is watched (P3-D26) | ≤ 400 B | review (`setQueryData`), game-over card, archive row |
| `analysis:writing` | `{gameRef}` | worker (start of pass 2), same band rule | ≤ 60 B | review |
| `analysis:done` | `{gameRef, analysisVersion, accuracy: number \| null, momentsCount, headline: string \| null, coachLine: string \| null, isClean, bank: null}`: **personalised per recipient** (one emit per member side); `bank` is reserved for P5's `{added, plies, due}` (COV C-01, AP-10) | worker, band ≥ 80 or watched; `dedupeKey` `done:<gameId>:<version>:<color>` | ≤ 360 B | review (invalidate), game-over card, archive row, Home (P5) |
| `analysis:failed` | `{gameRef, gradedPlies, totalPlies, failedAtPly, retryable, retryAt: string \| null, code: "engine_failed" \| "worker_stalled" \| "timeout" \| "internal"}` | worker, reaper | ≤ 160 B | review, game-over card |
| `analysis:batch` | `{done: number, failed: number, queued: number, refs: string[] ≤ 20}` | worker, for jobs below band 80 that are not watched: one coalesced frame per user, at most every 60 s, flushed at the end of a drain | ≤ 600 B | archive (throttled invalidate), Home (P5), import banner (P4) |
| `compare:ready` | `{gameRef, status: "ready" \| "failed"}` | worker | ≤ 60 B | compare, game-over legend block |
| `games:changed` | `{gameRef?: string}` | socket finish, bot `complete`, worker (band ≥ 80; lower bands use `analysis:batch`) | ≤ 60 B | archive (throttled) |

The emit body is always P2's `{v:1, targets, event, data, dedupeKey?}` (P3-D13), built with `ROOM.user(ref)` / `{userRef}`:
- Shared events (`progress`, `writing`, `failed`, `games:changed`) go out as one call with both member players in `targets`.
- `analysis:done` goes out as one call per member side.
- Only the game's member players ever receive these events, which is the Phase 0 "analysis private to players" rule.
- The socket's caller allow-list lets the worker emit only `analysis:*`, `compare:*` and `games:changed` (P3-D21). Later phases extend the list.

---
## 6. Data model (migration M3)

This follows P2's shipped M2 names (R-01) and DM §5.4 / `SP/plan/schema.target.prisma` for the new tables, with the P3-D3/D4/D5/D6/D27/D28 adjustments above. The schema lives in `DB/prisma/schema.prisma` (moved there by P2).

### 6.1 Enums (new in M3 unless P2 already created them; each `CREATE TYPE` is guarded)

```prisma
enum JobKind {            // DM §3.5 / R-05 ledger. P3 uses ANALYZE_GAME, LEGEND_COMPARE, HOUSEKEEPING; the rest are reserved
  ANALYZE_GAME            // for P4/P6/P7/P10 so their phases need no ADD VALUE file. No HOURLY_TICK (P3-D22).
  REVIEW_TEXT
  LEGEND_COMPARE
  IMPORT_SYNC
  IMPORT_PURGE
  RECOMPUTE_WEAKNESS
  EXPORT_BUILD
  ACCOUNT_PURGE
  DODO_CUSTOMER_SYNC
  HOUSEKEEPING
}
enum JobStatus        { QUEUED RUNNING DONE FAILED CANCELLED }
enum AnalysisStatus   { NONE QUEUED RUNNING DONE FAILED SKIPPED }      // skip if M2 created it
enum EvalSource       { ENGINE LICHESS MIXED }
enum Judgement        { BRILLIANT GREAT BEST EXCELLENT GOOD BOOK FORCED INTERESTING INACCURACY MISTAKE MISS BLUNDER }  // B8: 12
enum ComparisonStatus { FACTS_READY NARRATING READY FAILED }
enum ShareKind        { POSITION REVIEW }
// enum GameSource { REPLAY CHESSCOM LICHESS }   only if P2 shipped without fix 2.1 (§2.3 day-1 check)
```

- The `Judgement` Postgres enum is not used for anything stored per ply. Per-ply judgements are `smallint` codes from the append-only code table in `CA/src/codec.ts` (DM convention 5): `0 ungraded, 1 BRILLIANT, 2 GREAT, 3 BEST, 4 EXCELLENT, 5 GOOD, 6 BOOK, 7 FORCED, 8 INTERESTING, 9 INACCURACY, 10 MISTAKE, 11 MISS, 12 BLUNDER`. The enum exists for typed JSON validation and for P5's `Mistake.judgement`.
- **Enum rollback rule** (FEA §9): every value above ships in M3 and is written in M3's own release, and no later phase adds a `JobKind` that P3 writes. A worker image rollback therefore never meets an unknown enum. The claim filters on `kind::text = ANY($kinds)`.

### 6.2 Models

```prisma
/// M3. One queue for every background job on the OCI worker (SKIP LOCKED claim, push wake-up). DM §5.4 + heartbeatAt,
/// fairSeq (R-05.1) and lastKickAt (AP-09).
model Job {
  id          BigInt    @id @default(autoincrement())
  kind        JobKind
  status      JobStatus @default(QUEUED)
  /// JOB_PRIORITY.* only (P3-D7): 100 user waiting · 80 game just ended · 60/50/20/15 imports, batch, weakness · 10 backlog · 0 housekeeping
  priority    Int       @default(10) @db.SmallInt
  /// per-user ordinal inside a batch, so equal-priority jobs interleave users (ARCH §1.10.4); 0 for single enqueues
  fairSeq     Int       @default(0)
  /// "analyze:<gameId>", "legend:<gameId>:<userId>", "housekeeping:<yyyy-mm-dd>", "regrade-sweep:<yyyy-mm-dd>"
  dedupeKey   String?   @unique @db.VarChar(120)
  userId      BigInt?   // no FK (DM D5): survives the deletion it may be cleaning up after
  gameId      BigInt?   // no FK
  /// JobPayloadV1 per kind (CT/internal/jobs.ts); always carries `v`
  payload     Json      @default("{\"v\":1}")
  result      Json?
  runAt       DateTime  @default(now())
  attempts    Int       @default(0) @db.SmallInt
  maxAttempts Int       @default(4) @db.SmallInt
  /// "<env>-worker-<bootId>"
  lockedBy    String?   @db.VarChar(40)
  lockedAt    DateTime?
  /// refreshed by every checkpoint and at least every 30 s while RUNNING (stale detection: §8.12)
  heartbeatAt DateTime?
  /// last web-side re-kick (CAS, at most one per 30 s per job; AP-09)
  lastKickAt  DateTime?
  /// "<code>: <short message>"; never PII
  lastError   String?   @db.VarChar(1000)
  createdAt   DateTime  @default(now())
  startedAt   DateTime?
  finishedAt  DateTime?

  @@map("jobs")
}

/// M3. Packed engine facts for BOTH colours, one row per game (DM D3). Array index i = ply offset from Game.startPly.
/// Checkpointed every 10 plies while RUNNING (P3-D6); completedAt is set once at the end.
model GameAnalysis {
  gameId        BigInt     @id
  /// GRADING_VERSION (classifier); re-grade from stored evals when it changes (engine-free, P3-D28)
  version       Int        @db.SmallInt
  /// "sf18-armv8dp-<net8>/sf18-v1" (engine build id + profile)
  engine        String     @db.VarChar(48)
  nodesPass1    Int
  nodesPass2    Int
  evalSource    EvalSource @default(ENGINE)
  totalPlies    Int        @db.SmallInt
  gradedPlies   Int        @db.SmallInt
  failedAtPly   Int?       @db.SmallInt
  /// length gradedPlies+1 while running, totalPlies+1 when done. White POV; cp clamped ±9999; mate in n = sign·(30000 − n)
  evals         Int[]      @db.SmallInt
  /// MultiPV-2 score per position, same encoding; 32767 = no second legal move (P3-D28)
  second        Int[]      @db.SmallInt
  /// MoveCode per ply = from + 64·to + 4096·promo (promo 0 none, 1 n, 2 b, 3 r, 4 q); 0 = unknown/forced
  best          Int[]      @db.SmallInt
  /// JudgementCode per ply (0 = ungraded)
  judgements    Int[]      @db.SmallInt
  /// LinesV1, flagged plies only: {"<ply>": {"pv": "<uci …>", "alts": ["<uci>", …], "d": <winLoss×10>}}
  lines         Json?
  middlegamePly Int?       @db.SmallInt
  endgamePly    Int?       @db.SmallInt
  accuracyWhite Float?     @db.Real
  accuracyBlack Float?     @db.Real
  /// 13 counters each (index = JudgementCode; [0] unused)
  countsWhite   Int[]      @db.SmallInt
  countsBlack   Int[]      @db.SmallInt
  /// median search depth reached in pass 1 (How we grade "about N plies deep")
  depthP50      Int?       @db.SmallInt
  /// games.completedAt → analysis:done emit, ms (server-side SLO truth, AP-15); null for regrades and backfills
  readyMs       Int?
  createdAt     DateTime   @default(now())
  updatedAt     DateTime   @updatedAt
  completedAt   DateTime?
  game          Game       @relation(fields: [gameId], references: [id], onDelete: Cascade)

  @@map("game_analyses")
}

/// M3. Text + key moments + walkthrough state for one MEMBER side (DM D4). 1:1 with GamePlayer via its unique (gameId, color).
model PlayerReview {
  gameId        BigInt
  color         String     @db.Char(1)
  /// ReviewContentV1 (§6.6). P3 writes source "template".
  content       Json?
  /// PENDING | TEMPLATE | READY | FALLBACK (P3-D16)
  textStatus    String     @default("PENDING") @db.VarChar(10)
  model         String?    @db.VarChar(40)       // P7
  promptVersion Int?       @db.SmallInt          // P7
  /// ReviewProgressV1 (§6.6). Written by A5/A6 only (a different writer than content).
  progress      Json?
  startedAt     DateTime?
  completedAt   DateTime?
  createdAt     DateTime   @default(now())
  updatedAt     DateTime   @updatedAt
  gamePlayer    GamePlayer @relation(fields: [gameId, color], references: [gameId, color], onDelete: Cascade)  // P2's @@unique([gameId, color])

  @@id([gameId, color])
  @@map("player_reviews")
}

/// M3 (pulled forward from DM "M8", P3-D5). Legend comparison per (game, member).
model LegendComparison {
  gameId          BigInt
  userId          BigInt
  chessPositionId BigInt?
  status          ComparisonStatus @default(FACTS_READY)
  /// ComparisonFactsV1 (§6.6)
  facts           Json
  /// NarrationV1, P7/P8 (personalised narration); null in P3
  narration       Json?
  model           String?          @db.VarChar(40)
  costMicroUsd    Int?
  /// LEGEND_COMPARE runs requested through A9b; capped at 3 (then 410)
  attempts        Int              @default(0) @db.SmallInt
  error           String?          @db.VarChar(500)
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt
  game            Game             @relation(fields: [gameId], references: [id], onDelete: Cascade)
  user            User             @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([gameId, userId])
  @@index([userId])
  @@map("legend_comparisons")
}

/// M3 (P3-D4). One public-link table: REVIEW (/r/<code>) now, POSITION (/s/<code>) from P9. DM D17: no view counters.
model Share {
  id              BigInt         @id @default(autoincrement())
  /// 8 chars of Crockford base32, lowercase (e.g. "8kq2xh4m"); 40 random bits from crypto.randomBytes
  code            String         @unique @db.VarChar(10)
  kind            ShareKind
  /// SetNull for POSITION; REVIEW shares are deleted explicitly by the account-deletion flow (P10)
  ownerId         BigInt?
  fen             String?
  chessPositionId BigInt?
  gameId          BigInt?
  ply             Int?           @db.SmallInt
  color           String?        @db.Char(1)
  title           String?        @db.VarChar(80)
  subtitle        String?        @db.VarChar(40)
  note            String?        @db.VarChar(140)
  themes          String[]       @default([])
  showUsername    Boolean        @default(true)
  /// ShareSnapshotV1 (§6.6): the frozen public payload
  snapshot        Json?
  imageVersion    Int            @default(1) @db.SmallInt
  expiresAt       DateTime?
  revokedAt       DateTime?
  createdAt       DateTime       @default(now())
  owner           User?          @relation(fields: [ownerId], references: [id], onDelete: SetNull)
  game            Game?          @relation(fields: [gameId], references: [id], onDelete: Cascade)
  chessPosition   ChessPosition? @relation(fields: [chessPositionId], references: [id], onDelete: SetNull)

  @@map("shares")
}
```

**Changed models.** All changes are additive. The SQL uses `ADD COLUMN IF NOT EXISTS`, in case P2's M2 already carries some of them.

```prisma
model Game {
  // M3
  analysisStatus    AnalysisStatus     @default(NONE)
  /// opening of the game (deepest EPD match, written by the worker when null; R-01, CON 3.4). Not the same thing as
  /// the existing openingId, which means "started from this opening line" and is never written by the worker.
  ecoCode           String?            @db.VarChar(3)
  openingName       String?            @db.VarChar(80)
  analysis          GameAnalysis?
  legendComparisons LegendComparison[]
  shares            Share[]
}
model GamePlayer {
  // M3: written by the worker's final batch
  accuracy      Float?   @db.Real
  /// archive note, e.g. "Missed Rxf5 · move 19" | "Clean game" (§8.7)
  headline      String?  @db.VarChar(80)
  momentsCount  Int      @default(0) @db.SmallInt
  /// 13 counters indexed by JudgementCode (this side only)
  counts        Int[]    @default([]) @db.SmallInt
  /// [opening, middlegame, endgame]; -1 = phase not reached
  phaseAccuracy Float[]  @default([]) @db.Real
  /// copy of games.ecoCode for per-user opening stats (P4, P6 read it)
  ecoCode       String?  @db.VarChar(3)
  review        PlayerReview?
}
model User {
  /// bumped whenever a row of this user's archive changes (finish, analysis status/result); the G1 ETag (P3-D27)
  gamesVersion      Int                @default(0)
  legendComparisons LegendComparison[]
  shares            Share[]
}
model Opening {
  // M3: transposition-safe opening-name lookup (deepest EPD match) and book seed
  /// the first four FEN fields of `fen` (the position after the line)
  epd String? @db.VarChar(90)
}
model ChessPosition  { shares Share[] }
```

`stats` and `errorThemes` on `GamePlayer` (DM §3.10) are **not** in M3. P6 adds them in M6 and fills them from the stored arrays (R-01). There is no `game_players."analysisStatus"`; it is `games."analysisStatus"`.

### 6.3 Raw SQL appended to the migration (Prisma cannot express these, DM §11.3)

```sql
SET lock_timeout = '5s';
-- Job claim: ORDER BY priority DESC, "fairSeq", "runAt" over queued rows only (R-05.1)
CREATE INDEX IF NOT EXISTS jobs_ready_idx      ON jobs (priority DESC, "fairSeq", "runAt") WHERE status = 'QUEUED';
-- Stale-lock recovery (reaper)
CREATE INDEX IF NOT EXISTS jobs_running_idx    ON jobs ("heartbeatAt") WHERE status = 'RUNNING';
-- Pruning (HOUSEKEEPING)
CREATE INDEX IF NOT EXISTS jobs_finished_idx   ON jobs ("finishedAt") WHERE status IN ('DONE','FAILED','CANCELLED');
-- Archive filter "only games with moments" stays inside the user's rows: no index (≤ 2,000 rows per user, DM §2 rule 9)
-- Book / opening lookup
CREATE INDEX IF NOT EXISTS openings_epd_idx    ON openings (epd) WHERE epd IS NOT NULL;
-- Share reuse lookup (A10), the durable daily create cap (AP-11), and owner listing (P10 "manage links")
CREATE INDEX IF NOT EXISTS shares_owner_idx    ON shares ("ownerId", "createdAt" DESC) WHERE kind = 'REVIEW';
-- Share pruning
CREATE INDEX IF NOT EXISTS shares_expires_idx  ON shares ("expiresAt") WHERE "expiresAt" IS NOT NULL;
-- FK index followed by cascades from big tables (DM §2 rule 9)
CREATE INDEX IF NOT EXISTS shares_game_idx     ON shares ("gameId") WHERE "gameId" IS NOT NULL;
-- Compression for the read-whole JSON documents (Postgres 16+ on Neon)
ALTER TABLE game_analyses  ALTER COLUMN lines    SET COMPRESSION lz4;
ALTER TABLE player_reviews ALTER COLUMN content  SET COMPRESSION lz4;
ALTER TABLE shares         ALTER COLUMN snapshot SET COMPRESSION lz4;
-- A5 progress merge in one statement. The route reduces the event batch into a patch in TS
-- ({results, attempts, planChips}); existing results are never overwritten, and momentIndex never goes back.
CREATE OR REPLACE FUNCTION review_progress_merge(p jsonb, patch jsonb, idx int) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'v', 1,
    'momentIndex', GREATEST(COALESCE((p->>'momentIndex')::int, 0), idx),
    'results', COALESCE(p->'results', '{}'::jsonb)
               || (COALESCE(patch->'results', '{}'::jsonb)
                   - ARRAY(SELECT jsonb_object_keys(COALESCE(p->'results', '{}'::jsonb)))),
    'attempts',  COALESCE(p->'attempts', '{}'::jsonb)  || COALESCE(patch->'attempts', '{}'::jsonb),   -- client sends cumulative counts
    'planChips', COALESCE(p->'planChips', '{}'::jsonb) || COALESCE(patch->'planChips', '{}'::jsonb),
    'bankOptOut', COALESCE(p->'bankOptOut', '[]'::jsonb))
$$;
```

**Role grants are not in the migration.** The shadow database, CI's Docker Postgres and fresh branches have no `replay_worker` role, so a `GRANT` to a missing role would fail the migration. The grants live in `DB/scripts/roles/*.sql`. They run once per branch after the role exists (§6.7 step 5), and each is guarded by `IF EXISTS (SELECT FROM pg_roles WHERE rolname = …)`:

```sql
-- replay_worker.sql (the worker; HTTP driver)
GRANT SELECT ON users, games, game_players, openings, chess_positions, shares, rate_limit_buckets TO replay_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON jobs, game_analyses, player_reviews, legend_comparisons TO replay_worker;
GRANT UPDATE ("analysisStatus", "ecoCode", "openingName") ON games TO replay_worker;            -- never openingId
GRANT UPDATE (accuracy, headline, "momentsCount", counts, "phaseAccuracy", "ecoCode") ON game_players TO replay_worker;
GRANT UPDATE ("gamesVersion") ON users TO replay_worker;
GRANT DELETE ON shares, rate_limit_buckets TO replay_worker;        -- HOUSEKEEPING only
GRANT USAGE, SELECT ON SEQUENCE jobs_id_seq TO replay_worker;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO replay_worker;   -- P4+ tables get explicit write grants in their phase

-- replay_app.p3.sql (web; only needed if P1's role uses explicit grants rather than default privileges)
GRANT SELECT, INSERT ON jobs TO replay_app;
GRANT UPDATE (priority, "runAt", status, "lockedBy", "lastKickAt", payload, attempts, "fairSeq") ON jobs TO replay_app;
GRANT USAGE, SELECT ON SEQUENCE jobs_id_seq TO replay_app;
GRANT SELECT ON game_analyses TO replay_app;
GRANT SELECT, UPDATE (progress, "startedAt", "completedAt") ON player_reviews TO replay_app;
GRANT SELECT, INSERT, UPDATE ON legend_comparisons, shares TO replay_app;
GRANT USAGE, SELECT ON SEQUENCE shares_id_seq TO replay_app;
GRANT UPDATE ("analysisStatus") ON games TO replay_app;
GRANT UPDATE ("gamesVersion") ON users TO replay_app;

-- socket.p3.sql (P2's least-privilege socket role; the finishGame fragments)
GRANT INSERT ON jobs TO <socket role>; GRANT USAGE, SELECT ON SEQUENCE jobs_id_seq TO <socket role>;
GRANT UPDATE ("analysisStatus") ON games TO <socket role>; GRANT UPDATE ("gamesVersion") ON users TO <socket role>;
```

The partial-index names go into P2's protected list, **`DB/prisma/protected-indexes.txt`**, read by `REPO/scripts/db/check-drift.ts` (R-10, CON 3.10). The drift gate then fails if anything would drop them.

### 6.4 Indexes and the queries they serve

Every name below is exact. The api-perf "index existence" gate (§12.7) asserts each one exists in `pg_indexes` after `migrate deploy`.

| Index | Query (hot path) | Plan target |
|---|---|---|
| `games_referenceId_key` (exists) + `game_players_pkey (gameId,userId)` (P2) + `game_analyses_pkey` + `player_reviews_pkey` + `users_pkey` | A1 review load: one statement (§9.2) | 5 PK/unique lookups, < 1 ms DB |
| same + `jobs_dedupeKey_key` + `shares_owner_idx` | **A1/A2 probe** (the ETag): `SELECT g."analysisStatus", a."gradedPlies", a."totalPlies", a.version, a."failedAtPly", pr."updatedAt", j.status, j.attempts, j."maxAttempts", j."runAt", j."heartbeatAt", j."lastKickAt", s.code FROM games g JOIN game_players gp ON gp."gameId"=g.id AND gp."userId"=$viewer LEFT JOIN game_analyses a ON a."gameId"=g.id LEFT JOIN player_reviews pr ON pr."gameId"=g.id AND pr.color=gp.color LEFT JOIN jobs j ON j."dedupeKey"='analyze:'\|\|g.id LEFT JOIN LATERAL (SELECT code FROM shares WHERE "ownerId"=$viewer AND "gameId"=g.id AND kind='REVIEW' AND "revokedAt" IS NULL AND "expiresAt" > now() ORDER BY "createdAt" DESC LIMIT 1) s ON true WHERE g."referenceId"=$ref` | < 0.5 ms; a 304 needs only this statement |
| `jobs_ready_idx` | claim (§8.12) | Index Scan + LockRows, < 1 ms |
| `jobs_dedupeKey_key` | idempotent enqueue `INSERT … ON CONFLICT ("dedupeKey") DO UPDATE …`; the kick CAS `UPDATE jobs SET "lastKickAt"=now() WHERE "dedupeKey"=$k AND …` | unique probe |
| `jobs_running_idx` | reaper `… WHERE status='RUNNING' AND "heartbeatAt" < now() - interval '3 min'` | a tiny partial index |
| `game_players_userId_endedAt_gameId_idx (userId, endedAt DESC, gameId DESC)` (P2) | G1 archive keyset (§9.3); best this month `SELECT max(accuracy) FROM game_players WHERE "userId"=$1 AND "endedAt" >= $monthStartUtc` | Index Scan on the prefix, ≤ 31 rows read per page, < 2 ms; **no Sort node** |
| `openings_epd_idx` | the worker's deepest-match opening name `SELECT eco, name FROM openings WHERE epd = ANY($1::text[]) AND "isActive"` (one statement per game, ≤ 30 EPDs) | Bitmap/Index Scan |
| `legend_comparisons_pkey (gameId,userId)` | A2/A9 reads, the lazy facts insert, worker update | PK |
| `shares_code_key` | `/r/[code]` (ISR miss only) | unique |
| `shares_owner_idx` | A10 reuse `… WHERE "ownerId"=$1 AND kind='REVIEW' AND "gameId"=$2 AND "revokedAt" IS NULL AND "expiresAt" > now() AND "showUsername"=$3 ORDER BY "createdAt" DESC LIMIT 1`; the daily cap `count(*) … WHERE "ownerId"=$1 AND kind='REVIEW' AND "createdAt" > now() - interval '1 day'` | partial index range, ≤ 600 rows per owner |
| `shares_expires_idx` | HOUSEKEEPING `DELETE FROM shares WHERE kind='REVIEW' AND "expiresAt" < now() - interval '7 days'` | a range on the partial index |

### 6.5 Storage (Neon 1 GB budget, DM §10)

| Row | Size per game | Notes |
|---|---|---|
| `game_analyses` | ~1.4 KB (80 plies; DM §10.1 + `second[]`) | `lines` lz4 |
| `player_reviews` | ~1.5–3 KB per member side (template text is short; DM measured 4.4 KB for incompressible text) | lz4 |
| `game_players` analysis columns | +~65 B | — |
| `legend_comparisons` | ~1 KB, legend games only | — |
| `shares` | ~4 KB per link, pruned 7 d after expiry | — |
| `jobs` | ~300 B, pruned 14 d after DONE | — |

A typical member (0.4 games/day) adds about 1.4 MB a year from P3 tables, inside DM §10.2's 4.4 MB per member per year.

### 6.6 JSON registry (zod, `DB/src/json/*.ts`, each with `v`; the same folder as P2's `game-meta.ts`)

```ts
// DB/src/json/review.ts
export const Sentence = z.object({ t: z.string().max(400), v: z.boolean() });   // v = verifier passed (P7); false for templates
export const PlanKey = z.enum(["attack", "defend", "trade", "improve", "unsure"]);
export const ReviewContentV1 = z.object({
  v: z.literal(1),
  source: z.enum(["template", "llm"]),
  summary: z.array(Sentence).max(4),
  /// the game-over card line (COV C-02): the turning-point sentence, or the best decision for a clean game
  coachLine: Sentence.nullable(),
  phaseLine: z.string().max(120),
  headline: z.string().max(80).nullable(),
  isClean: z.boolean(),
  bestPly: z.number().int().nullable(),
  bestDecision: z.string().max(200).nullable(),
  moments: z.array(z.object({
    ply: z.number().int(),                 // ply offset from startPly (0-based)
    judgement: z.number().int().min(1).max(12),
    playedUci: z.string().max(5), bestUci: z.string().max(5),
    accept: z.array(z.string().max(5)).max(3),   // moves within 2 Win% of best (MultiPV 3, pass 2)
    pv: z.string().max(60),                // best line from fenBefore, UCI space-separated, 3–8 plies
    winBefore: z.number(), winAfter: z.number(),  // mover POV, 1 decimal
    intent: PlanKey,                       // the engine's idea class (§8.8)
    ask: z.string().max(300),
    why: z.array(Sentence).max(3),
    plan: z.record(PlanKey, z.string().max(200)),
    mistakeRef: z.string().nullable(),     // P5 fills
  })).max(3),
});
export const ReviewProgressV1 = z.object({
  v: z.literal(1),
  momentIndex: z.number().int().min(0).max(3),
  results: z.record(z.string(), z.enum(["FOUND", "FOUND_RETRY", "REVEALED"])),   // key = ply
  attempts: z.record(z.string(), z.number().int().max(50)),
  planChips: z.record(z.string(), PlanKey),
  bankOptOut: z.array(z.number().int()).max(3),   // P3-D19, read by P5
});
// DB/src/json/legend.ts
export const ComparisonFactsV1 = z.object({
  v: z.literal(1),
  side: z.enum(["w", "b"]), historicalName: z.string().max(40),
  startPly: z.number().int(), comparedPlies: z.number().int(), matchedPlies: z.number().int(),
  divergencePly: z.number().int().nullable(), divergenceBy: z.enum(["user", "opponent"]).nullable(),
  userUci: z.string().nullable(), userSan: z.string().nullable(),
  legendUci: z.string().nullable(), legendSan: z.string().nullable(),
  legendResult: z.enum(["white_won", "black_won", "draw"]), legendTotalMoves: z.number().int().nullable(),
  userLineUci: z.string(), legendLineUci: z.string(),          // from startPly, space-separated (≤ 120 plies each)
  evalAtDivergence: z.object({ userWin: z.number(), legendWin: z.number() }).nullable(),   // the worker fills it → READY
});
// DB/src/json/share.ts
export const ShareSnapshotV1 = z.object({
  v: z.literal(1), kind: z.literal("review"),
  players: z.object({ w: z.object({ name: z.string(), rating: z.number().nullable(), isYou: z.boolean() }),
                      b: z.object({ name: z.string(), rating: z.number().nullable(), isYou: z.boolean() }) }),
  result: z.string(), endLabel: z.string(), tcLabel: z.string(), playedOn: z.string(),   // date only
  startFen: z.string(), moves: z.string(), san: z.string(), j: z.string(), evals: z.array(z.number().int()),
  accuracy: z.object({ you: z.number().nullable(), opp: z.number().nullable() }),
  moment: z.object({ ply: z.number().int(), playedSan: z.string(), bestSan: z.string(), judgement: z.number().int(),
                     caption: z.string(), arrow: z.tuple([z.string(), z.string()]) }).nullable(),
  summary: z.array(z.string()).max(4), gradingVersion: z.number().int(),
});
// CT/internal/jobs.ts (dependency-free; re-exported by DB/src/jobs.ts)
export const JOB_PRIORITY = { USER_OPENED: 100, IMPORT_SYNC_MANUAL: 100, GAME_ENDED: 80, IMPORT_SYNC_INITIAL: 60,
  REVIEW_BATCH: 60, IMPORT_NEWEST: 50, WEAKNESS: 20, IMPORT_PURGE: 20, IMPORT_SYNC_DAILY: 15, BACKLOG: 10, HOUSEKEEPING: 0 } as const;
export const PROGRESS_BAND_MIN = JOB_PRIORITY.GAME_ENDED;                 // P3-D26
export const PAYLOAD_V_MAX = 1;                                           // the highest payload version this build reads
export const AnalyzeGamePayloadV1 = z.object({
  v: z.literal(1), gameId: z.string() /* bigint as string */, gameRef: z.string(),
  reason: z.enum(["live_end", "bot_end", "opened", "retry", "regrade", "backfill", "smoke"]),
});
export const LegendComparePayloadV1 = z.object({ v: z.literal(1), gameId: z.string(), userId: z.string(), gameRef: z.string() });
export const HousekeepingPayloadV1 = z.object({ v: z.literal(1), day: z.string() /* yyyy-mm-dd */ });
// CT/internal/kick.ts
export const KickBodyV1 = z.object({
  v: z.literal(1),
  reason: z.enum(["live_end","bot_end","opened","retry","regrade","stale_queue","backfill","boot","cron_backstop","smoke","test"]),
  kinds: z.array(z.string()).max(10).optional(),   // P4+ name their kinds; absent = all known kinds
  runAt: z.string().datetime().optional(),         // earliest due time the caller just enqueued (keeps nextRunAt in memory)
  watch: z.string().optional(),                    // gameRef whose progress must stream (P3-D26)
  fault: z.string().max(40).optional(),            // APP_ENV=test only: one-shot fault for `watch` (§12.3)
});
```

### 6.7 Migration procedure and safety (CLAUDE.md rules apply; R-20, P3-D31)

| Step | Command / action | Where | Notes |
|---|---|---|---|
| 1 | Edit `DB/prisma/schema.prisma` (§6.1–6.2) | repo | — |
| 2 | `docker run -d --rm --name rc-shadow -e POSTGRES_PASSWORD=pw -p 55433:5432 postgres:17-alpine`, then `pnpm --filter @repo/db exec prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url postgresql://postgres:pw@localhost:55433/postgres --script > prisma/migrations/<ts>_m3_analysis_review/migration.sql` | laptop | A **local** shadow, as in P2 §6.5. **Never `prisma migrate dev` against Neon** (CLAUDE.md rule 2; the 2026-03-08 incident). **No `prisma db push` against any Neon branch**: it would drop the partial indexes. |
| 3 | Append the §6.3 raw SQL. Wrap every `CREATE TYPE` in `DO $$ BEGIN … EXCEPTION WHEN duplicate_object THEN NULL; END $$;` and use `ADD COLUMN IF NOT EXISTS` for the columns P2 may have shipped. Start the file with `SET lock_timeout = '5s';`. | repo | Keeps M3 idempotent whatever P2 shipped |
| 4 | The CI drift gate (`scripts/db/check-drift.ts` + `protected-indexes.txt`), the index existence check, then `migrate deploy` + seed on Docker Postgres 17 in CI | CI | — |
| 5 | The owner creates `replay_worker` on the **Neon dev branch named in CLAUDE.md** (Neon console or the Neon MCP `create_postgres_role`), then runs `ALTER ROLE replay_worker SET statement_timeout = '60s'; ALTER ROLE replay_worker SET idle_in_transaction_session_timeout = '30s';`, then the `DB/scripts/roles/*.sql` scripts (after step 6) | Neon dev | Non-destructive. Stated to the owner before running: CLAUDE.md rule 5 asks for confirmation on destructive commands, and this is not one, but it is account configuration (P3-Q10). |
| 6 | `DATABASE_URL=<dev direct URL> pnpm --filter @repo/db exec prisma migrate deploy`, printing and checking the host first | laptop/CI | `migrate deploy` never resets |
| 7 | Run the backfills (§6.8) on dev, **only after the AP-01 dev-project split** (or the owner's explicit waiver) | laptop | Idempotent and batched |
| 8 | Production | **P13 only** | `migrate deploy` after a rehearsal on a child branch of `production` (ALLOC §1.3). Nothing in P3 touches the production branch. |

Every change in M3 is an expand step: no drops, no type changes and no NOT NULL tightening. No contract step is needed, and the only rollback is "stop writing".

### 6.8 Backfills (`DB/scripts/backfill/*.ts`; idempotent, 500 rows per batch, `--dry-run` by default)

| Script | Does | Run |
|---|---|---|
| `opening-epd.ts` | For each `Opening` with `epd IS NULL`: replay `pgn` with chess.js and assert that the final FEN's first 4 fields equal `fen`'s (mismatches are logged and not written); then `UPDATE openings SET epd=$1 WHERE id=$2 AND epd IS NULL` | dev, once (prod in P13) |
| `enqueue-analysis.ts --since <date> --limit N` | `INSERT INTO jobs (kind, priority, "fairSeq", "dedupeKey", "gameId", payload) SELECT 'ANALYZE_GAME', ${JOB_PRIORITY.BACKLOG}, row_number() OVER (PARTITION BY gp."userId" ORDER BY g."completedAt" DESC), 'analyze:'\|\|g.id, g.id, jsonb_build_object('v',1,'gameId',g.id::text,'gameRef',g."referenceId",'reason','backfill') FROM games g JOIN LATERAL (SELECT "userId" FROM game_players WHERE "gameId"=g.id ORDER BY color LIMIT 1) gp ON true WHERE g.status='COMPLETED' AND g."plyCount" >= 6 AND g."analysisStatus"='NONE' ORDER BY g."completedAt" DESC LIMIT N ON CONFLICT DO NOTHING`, then one kick | dev (the E2E users' existing games; the newest 200, P3-Q13). Prod's old games are P13. **Only after the AP-01 split.** |
| `legend-facts.ts` | For completed legend games without a `legend_comparisons` row: compute the facts (`CA/src/legend/compare.ts`) and insert them | dev |

### 6.9 Dev seed (`DB/seed/review.ts`, called from the dev seed entry; refuses non-dev hosts via P1 `seed-guards.ts`)

Personas follow the TST X4 registry:
- **Shared members A–P** only gain data. The specs never assert absolute counts on them.
- **Exact states use leased pool personas** (`leasePersona(name)`). P3 adds the writers `review-empty`, `review-lapsed` and `review-terminal` to `scripts/dev/personas.ts`.

The seed writes **finished** states only, so the worker never picks a seeded row up as live work.

| Fixture | For | Rows |
|---|---|---|
| `GAME` mock (knightowl_88 vs tal_fan_77, 54 plies, from `DR/V3ReviewSummary.dc.html`) | summary, moments, complete `default`, share | `games` (REPLAY, RAPID 10+0, ECO C59), `game_players` (user A, white; `opponentName` "tal_fan_77"), `game_analyses` (evals from the mock `ev`, `second` stubbed, judgements from the mock `q` mapped to codes, `44.Rxf6` as INACCURACY per P3-D15), `player_reviews` (3 moments at plies 32/36/40 with the mock's ask/why text marked `source:"template"`, `coachLine`), a DONE `jobs` row |
| `CLEAN` mock (Opera Game, 33 plies, `DR/V3ReviewClean.dc.html`) | clean, complete `nothing` | as above; `isClean`, `bestPly` 30 (16.Qb8+, BRILLIANT) |
| Legend game (Opera position; the user drew by repetition; 12.Ba4 divergence; the `V3GameOverLegend` `over_legend` data) | compare, game-over legend | `games.chessPositionId` = the Opera seed position; `legend_comparisons` READY with facts |
| Kasparov–Topalov practice game (split at 27.b4+ vs 27.Qc3+, play-b F9) | compare `divergenceBy=user` after 6 matched plies | facts only (FACTS_READY) |
| Terminal-failure game (on the leased `review-terminal` persona) | `failed.terminal` | `analysisStatus=FAILED`, a job with `attempts=4` and `status=FAILED`, `gradedPlies=30` partial arrays |
| Unanalysed game | "Not reviewed yet" + opening the review starts the analysis (A3) | `analysisStatus=NONE`, no job |
| 40 mixed archive rows for user A | `/games` default, filters, keyboard | REPLAY sources; results and time classes spread; 25 analysed |
| Empty account (leased `review-empty` persona) | `/games` `empty` | none |
| Smoke game `smoke-26` (dedicated persona `smoke`, 26 plies) | the post-deploy real-engine smoke (§12.8) | `analysisStatus=NONE`; `WK/scripts/smoke.ts` resets it before each run |
| Expired and revoked shares on user A's `GAME` | `/r/[code]` `gone` | two `shares` rows (`expiresAt` in the past; `revokedAt` set) |

The `analysing` and retryable `failed` states are exercised live (the real worker on dev; the fake engine with registered faults in CI, §12.3) and through `/dev/ui/review?state=`.

---
## 7. API

All routes use P1's `route()` wrapper (`WEB/lib/api/route.ts`, B18). Each route file is thin: a `CT` schema plus one DAL or service call (API §1.3 rule: no Prisma in route files).

- **Envelope:** `{data, meta?}` / `{error:{code, message, details?, retryAfterSec?, requestId}}` (B16).
- **Ids:** only refs and codes leave the server; BigInt ids never do.
- **Auth contexts:**
  - `member`: P1's `requireMember()` → 401/402 with `reason`, then a player check inside the service.
  - **Player check:** the viewer has a `game_players` row for the game (P2's PK `(gameId, userId)`). Non-players get **404**, not 403, so a game's existence is never revealed.
  - **Admins** (`role = ADMIN`) may **read** any review, for support. Writes from a non-player admin are no-ops (204).
  - **Lapsed reads:** when the flag `review-lapsed-read` is on, GETs use `requireMember({allowLapsedRead: true})` (B26). It is off by default.
- **Cache tiers** are P1's: `public-static`, `private-etag`, `no-store`.
  - Every `private-etag` ETag is **strong** (P1 rule; AP drift register).
  - No per-user response carries `max-age > 0` (AP-04).
  - Downloads are `no-store` with `Content-Disposition: attachment`.
- **ETag probe.** A1 and A2 compute their ETag from the one-statement probe (§6.4) **before** the payload query. P1's wrapper gets an optional `etagProbe(ctx) → Promise<string>` hook for this (≤ 15 lines + a test in WP-D, coordinated with P1's owner). If `If-None-Match` matches, the wrapper returns 304 without running the handler.
- **GET side effects** are declared per route in the registry (`sideEffects`), and P1's GET-purity check enforces them (§12.2):
  - A1, A2: `["kick_cas"]` (A2 also `"legend_facts"`);
  - A9: `["legend_facts"]`;
  - every other GET: none.

### 7.1 Contracts files (`CT/http/*.ts`, zod 4; wire enums lowercase, R-17)

```ts
// CT/http/review.ts (shapes abbreviated where they repeat)
export const JKey = z.enum(["brilliant","great","best","excellent","good","book","forced","interesting","inaccuracy","mistake","miss","blunder"]);
export const PlayerCard = z.object({ name: z.string(), rating: z.number().int().nullable(), initials: z.string().max(2),
  kind: z.enum(["member","bot","external","legend"]), isYou: z.boolean() });
export const MomentDTO = z.object({
  ply: z.number().int(), moveLabel: z.string() /* "17." | "17…" */, judgement: JKey,
  playedUci: z.string(), playedSan: z.string(), bestUci: z.string(), bestSan: z.string(),
  accept: z.array(z.string()), line: z.string() /* uci from fenBefore */, lineSan: z.string(),
  winBefore: z.number(), winAfter: z.number(), intent: PlanKey,
  ask: z.string(), why: z.array(Sentence), plan: z.record(PlanKey, z.string()),
  inBank: z.boolean() /* !bankOptOut; UI hidden until P5 */, result: z.enum(["found","found_retry","revealed"]).nullable(), attempts: z.number().int(),
});
export const ReviewDTO = z.object({
  v: z.literal(1), ref: z.string(),
  status: z.enum(["none","queued","running","done","failed","skipped"]),
  game: z.object({
    mode: z.enum(["online","friend","bot","legend_bot","tournament","imported"]), source: z.enum(["replay","chesscom","lichess"]),
    startFen: z.string(), startPly: z.number().int().min(0),
    tc: z.object({ label: z.string() /* "Rapid 10+0" */, timeClass: z.string().nullable(), initialSec: z.number().int(), incSec: z.number().int() }),
    result: z.enum(["1-0","0-1","1/2-1/2"]), endLabel: z.string() /* from games.endMethod: "0–1 resigned" */,
    playedAt: z.string().datetime() /* games.completedAt */, playedAtLabel: z.string(),
    opening: z.object({ eco: z.string(), name: z.string() }).nullable(),
    legend: z.object({ name: z.string(), compareHref: z.string() }).nullable(),
  }),
  players: z.object({ w: PlayerCard, b: PlayerCard }), you: z.enum(["w","b"]),
  moves: z.string(), san: z.string(), clocks: z.array(z.number().int()),
  analysis: z.object({
    version: z.number().int(), engineLabel: z.string() /* "Stockfish 18" */, depthLabel: z.string() /* "depth 18" */,
    gradedPlies: z.number().int(), totalPlies: z.number().int(),
    evals: z.array(z.number().int()), best: z.string() /* uci tokens, "-" unknown */, j: z.string() /* 1 char per ply */,
    accuracy: z.object({ w: z.number().int().nullable(), b: z.number().int().nullable() }),
    phaseAccuracy: z.object({ w: z.array(z.number()), b: z.array(z.number()) }),
    phases: z.object({ middlegamePly: z.number().int().nullable(), endgamePly: z.number().int().nullable() }),
    counts: z.object({ w: z.array(z.number().int()).length(13), b: z.array(z.number().int()).length(13) }),
    failure: z.object({ failedAtPly: z.number().int(), retryable: z.boolean(), retryAt: z.string().nullable(), code: z.string() }).nullable(),
    queue: z.object({ position: z.number().int(), etaSec: z.number().int() }).nullable(),
  }).nullable(),
  review: z.object({
    textStatus: z.enum(["pending","template","ready","fallback"]),
    summary: z.array(Sentence), coachLine: Sentence.nullable(), phaseLine: z.string(), headline: z.string().nullable(),
    isClean: z.boolean(), bestPly: z.number().int().nullable(), bestDecision: z.string().nullable(),
    moments: z.array(MomentDTO).max(3),
    progress: z.object({ momentIndex: z.number().int(), startedAt: z.string().nullable(), completedAt: z.string().nullable() }),
  }).nullable(),
  share: z.object({ code: z.string(), url: z.string(), expiresAt: z.string(), showUsername: z.boolean() }).nullable(),
});
export const LegendSummaryDTO = z.object({                        // the game-over legend block (§4.7) and A2
  status: z.enum(["facts_ready","narrating","ready","failed"]),
  legendName: z.string(), legendResult: z.enum(["white_won","black_won","draw"]),
  matched: z.number().int(), compared: z.number().int(),
  divergence: z.object({ ply: z.number().int(), moveLabel: z.string(), userSan: z.string(), legendSan: z.string(),
                         by: z.enum(["user","opponent"]) }).nullable(),
  rows: z.array(z.object({ n: z.string(), yours: z.string(), legend: z.string(), mark: z.enum(["match","split","none"]) })).max(6),
  outcomeLine: z.string(), compareHref: z.string(), replayHref: z.string().nullable(),
});
export const ReviewStatusDTO = z.object({
  v: z.literal(1),
  analysis: z.object({ status: ReviewDTO.shape.status, gradedPlies: z.number().int(), totalPlies: z.number().int(),
    failedAtPly: z.number().int().nullable(), retryable: z.boolean(), retryAt: z.string().nullable(), code: z.string().nullable(),
    etaSec: z.number().int().nullable() }),
  review: z.object({ ready: z.boolean(), accuracy: z.number().int().nullable(), momentsCount: z.number().int(), isClean: z.boolean(),
    coachLine: z.string().nullable() }),
  comparison: LegendSummaryDTO.nullable(),
  bank: z.null(),   // P5: { added: number, plies: number[], due: number } (COV C-01)
});
export const ProgressBody = z.object({
  momentIndex: z.number().int().min(0).max(3),
  events: z.array(z.object({
    type: z.enum(["viewed","attempt","plan_picked","revealed","show_line"]),
    ply: z.number().int(), at: z.string().datetime(),
    uci: z.string().max(5).optional(), correct: z.boolean().optional(), chip: PlanKey.optional(),
  })).max(50),
});
export const AnalyseBody = z.object({ reason: z.enum(["opened","regrade"]).default("opened") });
export const CompleteOut = z.object({ accuracy: z.number().int().nullable(), moments: z.number().int(), found: z.number().int(),
  revealed: z.number().int(), isClean: z.boolean(), bestThisMonth: z.boolean(), completedAt: z.string() });
// CT/http/share.ts
export const ShareCreateBody = z.object({ showUsername: z.boolean().default(true), momentPly: z.number().int().optional() });
export const ShareDTO = z.object({ code: z.string(), url: z.string(), imageUrl: z.string(), expiresAt: z.string(), showUsername: z.boolean() });
// CT/http/games.ts
export const GamesQuery = z.object({
  q: z.string().trim().max(40).optional(),
  result: z.string().optional() /* csv of win,loss,draw */, tc: z.string().optional() /* csv of TimeClass */,
  moments: z.coerce.boolean().optional(), cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(0).max(30).default(30),
});
export const GameRowDTO = z.object({
  ref: z.string(), color: z.enum(["w","b"]), result: z.enum(["win","loss","draw"]),
  opponent: z.object({ name: z.string(), rating: z.number().int().nullable(), kind: PlayerCard.shape.kind }),
  headline: z.string().nullable(), opening: z.object({ eco: z.string(), name: z.string() }).nullable(), positionTitle: z.string().nullable(),
  tc: z.object({ label: z.string(), timeClass: z.string().nullable() }), playedAt: z.string() /* game_players.endedAt */, playedAtLabel: z.string(),
  ratingDelta: z.number().int().nullable(), source: z.enum(["replay","chesscom","lichess"]), finalFen: z.string() /* games.fen */,
  analysisStatus: z.enum(["none","queued","running","done","failed","skipped"]), momentsCount: z.number().int(),
  accuracy: z.number().int().nullable(), hasComparison: z.boolean(),
});
// meta: page 1 or limit=0 → { nextCursor, filteredTotal, counts: { all } }; later pages → { nextCursor } only (AP-38)
// CT/http/practice.ts
export const PracticeQuery = z.union([
  z.object({ game: z.string(), ply: z.coerce.number().int().min(0).optional() }),
  z.object({ position: z.string() }), z.object({ fen: z.string().max(100) }) ]);
export const PracticeContextDTO = z.object({ fen: z.string(), sideToMove: z.enum(["w","b"]), humanColor: z.enum(["w","b"]),
  title: z.string(), fromLabel: z.string().nullable(), botElo: z.number().int(), backHref: z.string(), compareHref: z.string().nullable(),
  planLine: z.string().nullable() });
// CT/http/codes.ts (additive, R-06): `gone` → 410 (terminal analysis, legend compute attempts used, revoked/expired share on the API).
// CONFLICT_REASONS += "skipped", "already_running", "not_failed", "analysis_not_done", "already_ready".
```

`LegendCompareDTO` is play-b F6's `LegendComparisonDTO` with two changes: `hasExplanation: boolean` replaces `staticExplanation` (the explanation comes with `?include=explanation`), and `evalAtDivergence` is added. Its status is lowercase. It lives in `CT/http/legend.ts`.

### 7.2 HTTP routes

Rate limits are P1's fixed-window `RateLimitSpec {bucket, limit, windowSec, by}` (R-13). Windows longer than 60 s are never held in the UNLOGGED table, which empties whenever Neon scales to zero (AP-11). They are counted from the source rows instead.

| Bucket | Spec | Routes | Store |
|---|---|---|---|
| `review-analyse` | 10 / 60 s, by user | A3, A4, A9b | P1 burst table |
| `review-write` | 120 / 60 s, by user | A5, A6, A7 | P1 burst table |
| `share-create` | 5 / 60 s, by user, **plus** a daily cap of 20 | A10 | Burst: P1 table. Daily: `count(*)` over `shares_owner_idx` inside the create statement; on a hit, 429 with `retryAfterSec` = the oldest share in the window + 24 h − now |
| `share-edit` | 10 / 60 s, by user | A11 | P1 burst table |
| (no bucket) | the legend compute cap | A9b | `legend_comparisons.attempts ≤ 3`, then 410 `gone` |

| # | Method · path | Auth | Request → response `data` | Errors (status) | Cache | GET side effects / idempotency |
|---|---|---|---|---|---|---|
| A1 | `GET /api/review/[ref]` | member + player (admin read) | → `ReviewDTO` (~4.6 KB raw, ~2.5 KB br at 80 plies) | `unauthorized` 401, `subscription_required` 402 (+`reason`), `not_found` 404 | `private-etag`, `ETag: "r1-<version>-<gradedPlies>-<status>-<reviewUpdatedEpoch>-<shareCode\|0>"` from the probe; a 304 runs only the probe | `kick_cas` in `after()` when the probe shows QUEUED with `runAt` older than 30 s (§7.3 `healKick`). **Never enqueues.** |
| A2 | `GET /api/review/[ref]/status` | member + player | → `ReviewStatusDTO` (≤ 600 B with the legend summary) | 401, 402, 404 | `private-etag` (ETag from the probe values + the comparison status); 304 when unchanged | `kick_cas`; `legend_facts` when the game has a legend position and no facts row |
| A3 | `POST /api/review/[ref]/analyse` | member + player | `AnalyseBody` → 202 `{status: "queued"\|"running"\|"done", position, etaSec}` (200 with `status: done` when already done at the current version) | 401, 402, 404, `conflict` 409 (`skipped` for games under 6 plies or aborted), `gone` 410 (terminal), `rate_limited` 429 | `no-store` | natural (`dedupeKey analyze:<gameId>`); priority raised to `USER_OPENED`; `regrade` resets a DONE job; kick with `watch` |
| A4 | `POST /api/review/[ref]/retry` | member + player | `{}` → 202 `{status: "queued", resumeFromPly, etaSec}` | 401, 402, 404, `conflict` 409 (`already_running` / `not_failed`), `gone` 410 (terminal), 429 | `no-store` | natural; `runAt = now()`, priority `USER_OPENED`; attempts are **not** reset; kick with `watch` |
| A5 | `PATCH /api/review/[ref]/progress` | member + player | `ProgressBody` (JSON, or `text/plain` JSON for `keepalive`/beacon) → 204 | 401, 402, 404, `validation_failed` 400, `payload_too_large` 413 (> 8 KB) | `no-store` | events deduped by `(type, ply, at)`; `momentIndex = GREATEST(stored, body)`; `startedAt = COALESCE(startedAt, now())` |
| A6 | `PATCH /api/review/[ref]/moments/[ply]` | member + player | `{inBank: boolean}` → `{ply, inBank, card: null}` (`card` filled from P5) | 401, 402, 404 (no such moment) | `no-store` | set semantics (idempotent) |
| A7 | `POST /api/review/[ref]/complete` | member + player | `{}` → `CompleteOut` | 401, 402, 404, `conflict` 409 (`analysis_not_done`) | `no-store` | `completedAt = COALESCE(completedAt, now())`; a replay returns the same body |
| A8 | `GET /api/review/[ref]/pgn` | member + player | → `text/x-chess-pgn` with `[%eval]`, `[%clk]`, NAGs (`$1` great … `$4` blunder, `$6` inaccuracy), template sentences as comments | 401, 402, 404, 409 (not done) | **`private, no-store`** + `Content-Disposition: attachment; filename="replaychess-<white>-vs-<black>-<yyyy-mm-dd>.pgn"` (AP-04) | read |
| A9 | `GET /api/review/[ref]/legend[?include=explanation]` | member + player | → `LegendCompareDTO` (~3 KB; +~20 KB with the explanation) | 401, 402, 404 (no legend position → the page 308s instead) | `private-etag` (ETag = `updatedAt` + the include flag) | `legend_facts` only. **Never enqueues.** Hover prefetch is safe. |
| A9b | `POST /api/review/[ref]/legend/compute` | member + player | `{}` → 202 `{status: "computing"}` | 401, 402, 404, 409 (`already_ready`), `gone` 410 (3 attempts used), 429 | `no-store` | natural `legend:<gameId>:<userId>`; one CTE does `attempts = attempts + 1` and the job upsert; kick |
| A10 | `POST /api/review/[ref]/share` | member + player; flag `review-share` (404 when off) | `ShareCreateBody` + `Idempotency-Key` → 201 `ShareDTO` (200 when an identical live share is reused) | 401, 402, 404, 409 (`analysis_not_done`), 429 | `no-store` | the header key (P2's `IdempotencyKey`, 24 h) + natural reuse (§6.4 query) |
| A11 | `PATCH /api/share/[code]` | owner (`shares.ownerId = viewer`) | `{showUsername: boolean}` → `ShareDTO` (`imageVersion` + 1, snapshot names recomputed) | 401, 404, `gone` 410 | `no-store` | set semantics; `revalidateTag` + `invalidateByTag` in `after()` |
| A11 | `DELETE /api/share/[code]` | owner | → 204 (`revokedAt = now()`) | 401, 404 | `no-store` | idempotent (a repeat → 204); the same purge |
| A12 | `GET /r/[code]` (page), `GET /r/[code]/og[?download=1]` (image route) | public | HTML from the frozen snapshot / PNG 1200×630 | page: 404 (unknown; cached 1 h), the `gone` view with HTTP 200 (expired or revoked); image: the generic card for gone or unknown | page: ISR `revalidate = 3600`, tag `share:<code>`, `X-Robots-Tag` from `next.config.js`; image: `public, max-age=3600` + `Vercel-CDN-Cache-Control: public, s-maxage=31536000` + `Vercel-Cache-Tag: share:<code>` (URL carries `?v=`) | read; Vercel Firewall per-IP limits (P1) |
| G1 | `GET /api/me/games` | member (lapsed read under the flag) | `GamesQuery` → `GameRowDTO[]` + `meta`; `limit=0` → counts only | 401, 402, `validation_failed` 400 (bad cursor) | `private-etag`, `ETag: "g<viewer.gamesVersion>-<fnv(filter, cursor, limit)>"` (P3-D27): a 304 costs no statement beyond the viewer | read |
| PR1 | `GET /api/practice/context` | member (+ player for `?game=`) | `PracticeQuery` → `PracticeContextDTO` | 401, 402, 404, `validation_failed` 400 (`details.reason: "illegal_position"`) | `private-etag` (AP-04: no `max-age`) | read |
| R1 | `GET /analysis/[ref]` (a route handler, replacing the page at H3) | Clerk session (middleware) | → 308 `/review/[ref]`, or `/review/[ref]/legend` when `chessPositionId` is set; an unknown ref → 308 `/games` | — | `no-store` | — |

**Status-code rules** (P1 contract):
- 401 only for no session.
- 402 only for "not a member".
- 404 for a missing game **and** for a non-player (masking).
- 409 for state conflicts, with `details.reason` from `CONFLICT_REASONS`.
- 410 for terminal resources.
- 413 for oversized bodies.

**Removed at H4:** `GET /api/analysis/[gameId]` (with the `/analysis/*` pages). The two e2e specs that probe it move to A1.

### 7.3 Service functions behind the routes (`WEB/lib/data/*.ts`, `WEB/lib/services/analysis/*.ts`)

| Function | Used by | Notes |
|---|---|---|
| `probeReview(viewer, ref)` | A1/A2 `etagProbe`, `healKick` | The §6.4 probe statement; returns the ETag parts plus the job state |
| `getReview(viewer, ref)` | A1, review RSC | One statement (§9.2). Builds the DTO and encodes `j` and `best` with `CA/src/codec.ts`. Player cards come from `game_players` + `users.name` + `opponentName/opponentRating` (§9.2), never from `games.whiteName…`. |
| `getReviewStatus(viewer, ref)` | A2, the game-over card fallback | The probe plus `legend_comparisons` (lazy `legend_facts` insert when missing) and `player_reviews.content->'coachLine'`; the stall rule (§8.12) |
| `healKick(gameId)` | A1/A2 `after()` | `UPDATE jobs SET "lastKickAt" = now() WHERE "dedupeKey" = 'analyze:'\|\|$1 AND status = 'QUEUED' AND "runAt" < now() - interval '30 seconds' AND ("lastKickAt" IS NULL OR "lastKickAt" < now() - interval '30 seconds') RETURNING id`; `kickWorker({reason:"stale_queue"})` only when a row comes back. A Sentry breadcrumb `analysis.rekick`. |
| `requestAnalysis(viewer, ref, {reason})` | A3 | `enqueueAnalysis` (shared SQL in `DB/src/jobs.ts`, §7.6) at `USER_OPENED`, then in `after()`: `kickWorker({reason, watch: ref, runAt})` + emit `analysis:queued`. 0 rows and a terminal FAILED job → 410. |
| `retryAnalysis(viewer, ref)` | A4 | `WITH j AS (UPDATE jobs SET "runAt"=now(), priority=GREATEST(priority, $USER_OPENED), "lastKickAt"=now() WHERE "dedupeKey"=$1 AND status='QUEUED' AND attempts < "maxAttempts" RETURNING id) UPDATE games SET "analysisStatus"='QUEUED' FROM j WHERE games.id=$2 RETURNING j.id`. 0 rows → read the job: RUNNING → 409 `already_running`; DONE → 409 `not_failed`; FAILED → 410. Then kick with `watch`. |
| `recordProgress(viewer, ref, body)` | A5 | One `UPDATE player_reviews SET progress = review_progress_merge(progress, $patch::jsonb, $momentIndex), "startedAt" = COALESCE("startedAt", now()) WHERE "gameId"=$g AND color=$c` (the SQL function shipped in M3: plain `jsonb` operations, no plpgsql loop) |
| `setMomentBank(viewer, ref, ply, inBank)` | A6 | `jsonb_set` on `progress.bankOptOut` |
| `completeReview(viewer, ref)` | A7 | A conditional `UPDATE … SET "completedAt" = COALESCE("completedAt", now())` + the best-this-month query (`Promise.all`) |
| `getLegendCompare(viewer, ref, {include})` | A9, compare RSC | Reads the facts row, or computes and inserts it (`legend_facts`). The legend line comes from `chess_positions.pgn`, sliced by `CA/src/legend/slice.ts` (ported from `api/analysis/[gameId]/route.ts:95-129`). |
| `computeLegend(viewer, ref)` | A9b | Ensures the facts row first (the same `legend_facts` insert), then: `WITH lc AS (UPDATE legend_comparisons SET attempts = attempts + 1, status = CASE WHEN status='FAILED' THEN 'FACTS_READY' ELSE status END WHERE "gameId"=$g AND "userId"=$u AND status <> 'READY' AND attempts < 3 RETURNING 1) INSERT INTO jobs (kind, priority, "dedupeKey", "gameId", "userId", payload) SELECT 'LEGEND_COMPARE', $USER_OPENED, 'legend:'\|\|$g\|\|':'\|\|$u, $g, $u, $payload FROM lc ON CONFLICT ("dedupeKey") DO UPDATE SET status='QUEUED', "runAt"=now() WHERE jobs.status IN ('DONE','FAILED') RETURNING id`, then kick |
| `createOrReuseShare(viewer, ref, body)` | A10 | One CTE: the daily-cap count + the reuse lookup + an insert when neither applies. It builds `ShareSnapshotV1` from the review (§11.3 masking), with `code = base32(randomBytes(5))` (retried on a unique violation, ≤ 3) and `expiresAt = now() + 30 d`. |
| `updateShare`, `revokeShare` | A11 | Owner check in the `WHERE`; `revalidateTag('share:'+code)`; `invalidateByTag('share:'+code)` in `after()` |
| `getPublicShare(code)` | `/r` page, image route | Selects `snapshot, kind, expiresAt, revokedAt, imageVersion` only |
| `listMyGames(viewer, filters, cursor)` | G1, `/games` RSC | §9.3 SQL. The cursor is P1's opaque base64url `{k: endedAt ISO, id: gameId}` (CON 3.3). Counts run only on page 1 or with `limit=0`. |
| `getPracticeContext(viewer, params)` | PR1, `/practice` RSC | FEN validation via `packages/game-core` |
| `kickWorker(body: KickBodyV1)` | everything that enqueues | `fetch(ANALYSIS_WORKER_URL + "/internal/analysis/kick", {method:"POST", headers: signInternal("web", …), body, signal: AbortSignal.timeout(2000)})` (§8.17). Errors are logged to Sentry as the warning `analysis.kick_failed`, never thrown. The `healKick` CAS, the worker's own drain-end sweep and the daily cron backstop cover a lost kick. |

### 7.4 Socket server additions (`WS` and `DB/src/live/`; P2 owns the files, P3's WP-E appends)

| Item | Contract |
|---|---|
| `POST /internal/emit` | **Body unchanged** (P2: `{v:1, targets:({room}\|{userRef})[] ≤ 50, event, data, dedupeKey?}`). P3 registers `analysis:queued\|progress\|writing\|done\|failed\|batch`, `compare:ready` and `games:changed` in `CT/socket/registry.ts` with the schemas from `CT/socket/analysis.ts`. The receiver verifies HMAC through `verifyInternal()` and accepts the static `x-internal-token` from web only until task H3. The caller allow-list rejects a `worker` caller emitting anything outside `analysis:*`, `compare:*` and `games:changed` (403). |
| `GET /internal/load` | `{loopLagP99Ms, liveGames, sockets, draining}`, signed. It is bound to the docker network only (not in the Caddy allow-list) and served from the existing lag monitor. The worker's lag pause uses it (P3-D8). |
| `finishGame()` fragments (`DB/src/live/finish.fragments.p3.ts`, appended to P2 §6.6.4's named CTE) | Inside `g`'s `SET` list: `"analysisStatus" = CASE WHEN $n >= 6 THEN 'QUEUED'::"AnalysisStatus" ELSE 'SKIPPED'::"AnalysisStatus" END`. <br>New CTEs: <br>• `p3_jobs AS (INSERT INTO jobs (kind, priority, "dedupeKey", "gameId", payload) SELECT 'ANALYZE_GAME', $prioGameEnded, 'analyze:' \|\| g.id, g.id, jsonb_build_object('v',1,'gameId',g.id::text,'gameRef',$ref,'reason','live_end') FROM g WHERE $n >= 6 ON CONFLICT ("dedupeKey") DO NOTHING RETURNING id)` <br>• `p3_gv AS (UPDATE users u SET "gamesVersion" = u."gamesVersion" + 1 FROM gp WHERE u.id = gp."userId" RETURNING u.id)` <br>The final SELECT gains `(SELECT count(*) FROM p3_jobs)::int AS queued`. <br>P2's abort statement gains `"analysisStatus" = 'SKIPPED'` and the same `p3_gv` bump. |
| After the finish commit | `kickWorker({reason:'live_end', watch: ref})` to `http://analysis-worker:3003` on dev (`ANALYSIS_WORKER_URL` in the socket env), plus `analysis:queued` and `games:changed` to both players' rooms (in-process: the socket server is the emitter) |
| `game:result` payload (`CT/socket/game.ts`, CON 3.9) | P2's `review: {status: "none"}` becomes `review: {status: "queued"\|"skipped", etaSec: number \| null}`. No `legend` field (P3-D24). |

### 7.5 Worker HTTP surface (`WK/src/http/server.ts`, `node:http`, port 3003)

| Route | Auth | Body → response | Notes |
|---|---|---|---|
| `POST /internal/analysis/kick` | `verifyInternal({allow: ["web","socket"]})`, **HMAC only** | `KickBodyV1` (§6.6) → 202 `{draining: boolean, nextRunAt: string \| null}` | Cancels the scheduler sleep and starts a drain. `runAt` lowers the in-memory `nextRunAt`; `watch` marks a gameRef as watched for 10 min; `fault` is honoured only with `APP_ENV=test`. Idempotent and cheap: a duplicate kick during a drain is a no-op. The body is ≤ 1 KB. |
| `GET /health` | none (docker healthcheck only; Caddy returns 404 for it) | → 200 `{ok:true}` | |
| `GET /ready` | none (docker network) | → 200 when the engine answers `readyok` and the eval cache is open; else 503 | |
| `GET /internal/metrics` | `verifyInternal({allow:["web"]})` | → JSON gauges from memory (§10.2); no DB | for the daily cron backstop, the `deploy-oci.yml` smoke and the P12 admin dashboard |
| `POST /engine/analyse` | — | **not implemented in P3** (reserved for P7; Caddy keeps `/engine/*` → 404) | |

**Caddy (dev box):**
- `@unsigned_worker { path /internal/analysis/* /engine/*; not header X-Rc-Sig * }` → `respond 401`, so unsigned requests never reach Node (SEC-8).
- Then `handle /internal/analysis/* { reverse_proxy analysis-worker:3003 }`, with a `request_body` limit of 4 KB.

That is the only worker path reachable from Vercel. The worker container publishes no port on the host.

### 7.6 Enqueue points and the shared enqueue SQL (`DB/src/jobs.ts`)

```sql
-- enqueueAnalysis(sql, {gameId, gameRef, priority, reason, fairSeq = 0}) — one statement
WITH j AS (
  INSERT INTO jobs (kind, priority, "fairSeq", "dedupeKey", "gameId", payload, "runAt")
  VALUES ('ANALYZE_GAME', $priority, $fairSeq, 'analyze:' || $gameId, $gameId, $payload::jsonb, now())
  ON CONFLICT ("dedupeKey") DO UPDATE
    SET priority  = GREATEST(jobs.priority, EXCLUDED.priority),
        "runAt"   = CASE WHEN jobs.status = 'QUEUED' THEN LEAST(jobs."runAt", EXCLUDED."runAt") ELSE EXCLUDED."runAt" END,
        "fairSeq" = LEAST(jobs."fairSeq", EXCLUDED."fairSeq"),
        status    = CASE WHEN jobs.status = 'DONE' THEN 'QUEUED'::"JobStatus" ELSE jobs.status END,   -- only reachable for regrade (WHERE)
        payload   = CASE WHEN jobs.status = 'DONE' THEN EXCLUDED.payload ELSE jobs.payload END,
        attempts  = CASE WHEN jobs.status = 'DONE' THEN 0 ELSE jobs.attempts END
    WHERE jobs.status IN ('QUEUED','RUNNING')                                    -- raise priority (also mid-run: the band switches)
       OR (jobs.status = 'DONE' AND (EXCLUDED.payload->>'reason') = 'regrade')
  RETURNING id, status, priority, (xmax = 0) AS created
)
UPDATE games SET "analysisStatus" = 'QUEUED'
FROM j WHERE games.id = $gameId AND (games."analysisStatus" = 'NONE' OR (games."analysisStatus" = 'DONE' AND j.status = 'QUEUED'))
RETURNING j.id, j.status, j.priority;
-- A terminal FAILED job is never resurrected here (A3 → 410). A4 is the only path that pulls a backed-off QUEUED job forward.
-- The same transaction bumps users."gamesVersion" for the game's members (one more statement in the batch).
```

| Caller | When | Priority (`JOB_PRIORITY`) | In the same statement or transaction as |
|---|---|---|---|
| Socket finish (P2 code + the P3 fragment) | a live game COMPLETED with ≥ 6 plies; not ABORTED | `GAME_ENDED` | the finish CTE (`WHERE status='IN_PROGRESS'`), so a finish without a job is impossible |
| `POST /api/games/[ref]/complete` (bot / legend bot) | same rule | `GAME_ENDED` | the complete transaction, together with the legend facts insert and the `gamesVersion` bump; the kick goes in `after()` |
| A3 | the client opens an unanalysed game, or an outdated grading version | `USER_OPENED` | — |
| A4 | Retry | `USER_OPENED` | — |
| A9b (`LEGEND_COMPARE`) | the compare page needs the evals | `USER_OPENED` | the attempts CTE |
| HOUSEKEEPING regrade sweep | daily, ≤ 200 rows with `version < GRADING_VERSION`, newest first | `HOUSEKEEPING` | — |
| Backfill | dev only | `BACKLOG` (with `fairSeq` per user) | — |
| P4 import (later) | the newest 50 / the backlog | `IMPORT_NEWEST` / `BACKLOG` | the import batch |

Games under 6 plies, and aborted games, get `analysisStatus = SKIPPED` and no job.

### 7.7 Background jobs (worker)

| Kind | Trigger | Work | Retries | Output |
|---|---|---|---|---|
| `ANALYZE_GAME` | enqueue + kick | the §8.12 pipeline (or the engine-free regrade path, §8.14) | 4 attempts; back-off 30 s, 2 min, 10 min | `game_analyses`, `player_reviews`, the `game_players` columns, `games.analysisStatus/ecoCode/openingName`, `legend_comparisons.facts.evalAtDivergence`, `users.gamesVersion` |
| `LEGEND_COMPARE` | A9b only | 2 searches (after the user's move, after the legend's move) at the pass-2 budget | 3 (`legend_comparisons.attempts`) | `legend_comparisons` READY + `compare:ready` |
| `HOUSEKEEPING` | `DAILY_PLAN` inserts tomorrow's row: `dedupeKey housekeeping:<date>`, `runAt` 21:00 UTC | **Slices**, run in order from `WK/src/scheduler/recurring/` (P3-D22): <br>1. `prune-jobs`: DONE > 14 d; FAILED/CANCELLED > 30 d. <br>2. `prune-shares`: REVIEW `shares` with `expiresAt < now() - 7 d`. <br>3. `prune-rate-limits`: expired `rate_limit_buckets` (taking over from P1's daily cron). <br>4. `evalcache-trim`: weekly, trims the SQLite cache to 4 GB by `used_at`. <br>5. `regrade-sweep`: enqueues ≤ 200 outdated analyses at `HOUSEKEEPING` priority. <br>6. **`DAILY_PLAN`**: collects `plan(window = now → now + 26 h)` from every slice and inserts the timed rows with `ON CONFLICT ("dedupeKey") DO NOTHING`. In P3 the only row is the next `HOUSEKEEPING`. P6, P10 and P13 add slices as files: the weekly weakness roll, reminders, DST, backups. | 2 | metrics; the Sentry cron check-in `housekeeping` |
| `REVIEW_TEXT` | — | **P7** (reserved) | — | — |

**`WK/src/scheduler/recurring/` contract** (one file per slice, plus a barrel `index.ts`):

```ts
export interface RecurringSlice {
  id: string;                                   // "prune-jobs", later "weakness-roll" (P6), "notify-reminders" (P10), "backup" (P13)
  run?(ctx: HousekeepingCtx): Promise<void>;    // work done inside today's HOUSEKEEPING job (≤ 60 s each)
  plan?(window: { from: Date; to: Date }): JobRowInput[];   // timed rows for the next 26 h (dedupeKey required)
}
```

### 7.8 Third-party integrations

| Service | Use in P3 | Limits and notes |
|---|---|---|
| Stockfish 18 (GPLv3) | A native arm64 build in the worker image; WASM in the browser for Practice (P2) | Built from the pinned tag with `make -j profile-build ARCH=armv8-dotprod COMP=gcc` on `ubuntu-24.04-arm`. The GHCR worker package stays **private** (running it as a service is not distribution). `WK/NOTICE` records the upstream tag, the NNUE net hash and the GPL text location, in case the image is ever shared (LIC-3, P3-Q9). |
| Lichess CC0 eval DB (`lichess_db_eval.jsonl.zst`) | A one-off seed of the SQLite cache for EPDs on the `openings` lines with `knodes ≥ 120` | `WK/scripts/seed-evalcache.ts` runs on the owner's laptop and uploads `evalcache-seed-v1.sqlite` to R2 (`media.playchess.tech/evalcache/…`). The worker downloads it at boot if missing. No runtime calls to Lichess. |
| Neon | Worker writes over HTTP (`@neondatabase/serverless`), role `replay_worker` | ≤ 10 statements per analysed game; no idle queries (§9.5); no pooled TCP connection, so no suspend crash (P3-D11) |
| PostHog | Server events from the web (`after()`) and the worker (HTTP `/batch`, `distinct_id = User.referenceId`); events registered in `packages/analytics/src/events/review.ts` (TST X6) | §10 |
| Sentry | `@sentry/node` in the worker; the existing Next SDK | §10; metrics API availability [V4], with the in-memory `/internal/metrics` as the fallback |
| Vercel | ISR + the data cache (`revalidateTag`), CDN cache tags + `invalidateByTag` (`@vercel/functions`) for the share image [V, task G5] | Hobby quotas: image routes are function invocations, not image transformations (F-VER-4) |
| Cloudflare R2 | the eval-cache seed file only | free tier |

### 7.9 Environment variables (canonical names, R-09)

| Var | Where | Value (dev) | Notes |
|---|---|---|---|
| `ANALYSIS_WORKER_URL` | Vercel `replay-chess-dev` | `https://ws-dev.80-225-200-210.sslip.io` | the web → worker kick through Caddy |
| `ANALYSIS_WORKER_URL` | `WS_DEV_ENV_FILE` (socket .env) | `http://analysis-worker:3003` | docker network |
| `INTERNAL_API_SECRET` | web, socket, worker | the existing secret | The HMAC root key (P3-D21). The static `x-internal-token` path survives only until H3. No other names (`RC_INTERNAL_KEYS`, `INTERNAL_HMAC_SECRET`) are used (CON 3.11). |
| `INTERNAL_TOKEN_COMPAT` | socket | `1` until task H3, then unset | while set, `/internal/emit` also accepts the old static `x-internal-token` (P3-D21 transition) |
| `WORKER_DATABASE_URL` | worker | the Neon dev branch's pooled URL, role `replay_worker` | never the owner role |
| `WS_INTERNAL_URL` | worker | `http://websocket:3002` | `/internal/emit`, `/internal/load` |
| `WORKER_ID` | worker | `dev-worker` (a boot id is appended at runtime) | `lockedBy` |
| `ENGINE`, `ENGINE_PATH`, `ENGINE_THREADS`, `ENGINE_HASH_MB`, `ENGINE_PROFILE` | worker | `stockfish`, `/usr/local/bin/stockfish`, `1`, `64`, `sf18-v1` | `ENGINE=fake` is allowed only with `APP_ENV=test`; the worker refuses to boot otherwise |
| `EVAL_CACHE`, `EVAL_CACHE_PATH`, `EVAL_CACHE_SEED_URL`, `EVAL_CACHE_MAX_GB` | worker | `on`, `/data/evalcache/evals.sqlite`, the R2 URL, `4` | `EVAL_CACHE=off` for goldens (§12.4) |
| `LAG_PAUSE_MS` | worker | `40` | the socket loop-lag p99 threshold |
| `SENTRY_DSN`, `POSTHOG_PROJECT_KEY`, `POSTHOG_HOST`, `APP_ENV` | worker | — / the dev project key / `https://us.i.posthog.com` / `dev` | R-09 names |
| `WORKER_FAULT` | worker (**test hook**, registered in `WEB/lib/test-hooks/registry.ts` as `kind:"env"`) | e.g. `fail_at_ply:12`, `stall_at_ply:20`, `engine_crash:1`, `hold_queue`, `pause_at:writing:5000` | Honoured only with `APP_ENV ∈ {dev, test}`; **the worker refuses to boot** when it is set with `APP_ENV=production` (TST X12). Per-game one-shot faults come through the kick body in `APP_ENV=test`. |
| `WORKER_IMAGE`, `COMPOSE_PROFILES=worker` | the dev bundle `.env` written by `deploy-oci.yml` | — | the prod bundle omits both, so the worker never starts on prod |
| `NEXT_PUBLIC_SITE_URL` | Vercel | the dev URL on dev; `https://playchess.tech` on prod (P13) | builds the absolute `/r/<code>` URL (R-09; it replaces the draft's `NEXT_PUBLIC_SHARE_ORIGIN`) |

GitHub secrets: `WORKER_DEV_ENV_FILE` (the worker .env on the dev box), plus P1's `VERCEL_AUTOMATION_BYPASS_SECRET` for the dev-URL e2e (SEC-3). Vercel env: `ANALYSIS_WORKER_URL`.

The fault and engine hooks gate on `APP_ENV` only, never on `VERCEL_ENV`: the dev Vercel project deploys with `target: production` (FEA fix #3).

### 7.10 Feature flags (PostHog, server-evaluated by `lib/flags.ts`; registered in `lib/flags/registry/p3.ts`)

| Flag | Gates | Default on dev | Removal |
|---|---|---|---|
| `review-v3` | The nav item Review; `/review/*`, `/games`, `/practice`; the `/how-we-grade` link targets; the game-over slots; `reviewHref()` → `/review` (otherwise the legacy `/analysis`) | on for the owner and the shared E2E members | one release after 100 % (ALLOC §1.6). The legacy `/analysis` code is deleted at H4 (§15). |
| `review-share` | The share screen, the menu item, the complete row, A10 (404 when off). A11 stays available to owners of existing links, so they can always revoke. **`/r/*` is not flagged** (§5.5). | on for the owner and the E2E users | after the owner decision P3-Q2 |
| `review-lapsed-read` | `allowLapsedRead` on the review and archive GETs (B26) | **off** | owner decision (P3-Q1) |
| `analysis-live-prewarm` | The socket posts each live position to the worker for eval-cache prewarm (ARCH §1.9.4) | **off** (stretch, §9.7) | — |

The enqueueing of analysis is **not** flagged: every finished game gets graded even with `review-v3` off. That keeps the data complete for when the flag flips, and the legacy `/analysis` page simply ignores it. The flags-off regression project (TST X11) runs the P2 `@smoke` specs with both P3 flags off.

---
## 8. Domain logic

Everything in §8.1–§8.11 is pure TypeScript in `packages/chess-analysis` (`CA/src/*`). It has no I/O and is shared by the worker, the web (DTO building, PGN, client-side Win% for the graph) and the tests.

The formulas are re-implemented from the published maths under the clean-room process in `CA/CLEANROOM.md` (LIC-4):
- the sources used (papers, docs, `research_notes/`, RES) are listed;
- constants come from documentation, not code;
- whoever implements does not open AGPL source (lila, lichess-puzzler) during the work;
- CI runs `license-checker --production --failOn "AGPL;GPL"` over the npm dependencies, with the Stockfish binary allow-listed as a separate asset.

The phase divider is a port of scalachess `Divider`. Its licence is verified from the scalachess `LICENSE` file before porting (FEA V8); P3 expects MIT, with attribution in `CA/NOTICE.md`. If the licence is not MIT, the divider is re-derived from the published description instead.

### 8.1 Conventions (RES §2)

- **Point of view:** stored evals are **White POV** (R-ENG-01). Classification converts to mover POV: `cpMover = mover === 'w' ? cpW : -cpW`.
- **Encoding** (`CA/src/codec.ts`):
  - eval `e` ∈ smallint: `|e| < 29000` → centipawns, clamped to ±9999;
  - `e = sign·(30000 − n)` → mate in `n` for the sign's side, with `n = 0` meaning the side to move is checkmated (terminal);
  - stalemate and other terminal draws store `0`;
  - `second[i] = 32767` → no second legal move.
- **Win%:** clamp cp to ±1000; mate for → +1000, mate against → −1000 (R-ENG-02).
- **EPD** (the first 4 FEN fields) keys every cache, book and repetition check (R-ENG-07).
- **Index base:** ply index `i` is the offset from `Game.startPly`. `evals[i]` is the position before ply `i`; `evals[n]` is the final position. `best[i]` is the engine's best move in the position before ply `i`.
- **Move numbers:** `moveNo(i) = floor((startPly + i) / 2) + 1`, with "…" for Black.

### 8.2 Win% and accuracy (exact; RES §3.1–3.2)

```ts
// CA/src/winpct.ts
export const WIN_K = 0.00368208;
export const cpOf = (e: number) => Math.abs(e) >= 29000 ? Math.sign(e) * 1000 : Math.max(-1000, Math.min(1000, e));
export const winningChances = (cp: number) => 2 / (1 + Math.exp(-WIN_K * cpOf(cp))) - 1;     // ∈ [-1, 1]
export const winPct = (cp: number) => 50 + 50 * winningChances(cp);                           // ∈ [2.46, 97.54]

// CA/src/accuracy.ts
export const ACC_A = 103.1668100711649, ACC_B = 0.04354415386753951, ACC_C = 3.166924740191411, ACC_BONUS = 1;
export function moveAccuracy(winBefore: number, winAfter: number): number {    // mover POV
  if (winAfter >= winBefore) return 100;
  const d = winBefore - winAfter;
  return clamp(ACC_A * Math.exp(-ACC_B * d) - ACC_C + ACC_BONUS, 0, 100);
}
export function gameAccuracy(seriesWhitePct: number[], color: "w" | "b", startMover: "w" | "b"): number | null {
  const n = seriesWhitePct.length;                                   // positions 0..plies
  if (n < 3) return null;
  const w = clamp(Math.floor((n - 1) / 10), 2, 8);                   // window size
  const windows = [...Array(Math.max(0, w - 2)).fill(seriesWhitePct.slice(0, w)), ...sliding(seriesWhitePct, w)];
  const weights = windows.map((xs) => clamp(stddev(xs), 0.5, 12));
  const accs: number[] = [], wts: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const mover = (i % 2 === 0) === (startMover === "w") ? "w" : "b";
    if (mover !== color) continue;
    const before = color === "w" ? seriesWhitePct[i] : 100 - seriesWhitePct[i];
    const after  = color === "w" ? seriesWhitePct[i + 1] : 100 - seriesWhitePct[i + 1];
    accs.push(moveAccuracy(before, after)); wts.push(weights[i]);
  }
  if (!accs.length) return null;
  return (weightedMean(accs, wts) + harmonicMean(accs)) / 2;         // harmonicMean treats 0 as 0.01 [V: oracle test]
}
```

- Shown as `Math.round()`, and only after DONE (R-ACC-04).
- **Phase accuracy** re-runs `gameAccuracy` on each phase slice (R-ACC-02). A phase with fewer than 2 own moves → `-1` ("not reached").
- **Reference values** (unit tests, RES §3.3):
  - `winPct(0)=50.00`, `winPct(100)=59.10`, `winPct(300)=75.11`, `winPct(±1000)=97.54/2.46`;
  - `moveAccuracy` for Δ = 0/1/2/5/10/15/20/30/40/60/80 is 100/96.60/92.40/80.82/64.58/51.52/41.02/25.77/15.91/5.40/1.00 (±0.01).
- **Oracle** (R-ACC-05): 30 Lichess-analysed games in `CA/fixtures/oracle/*.json`, pulled once by `CA/scripts/fetch-oracle.ts` with `?evals=true&accuracy=true&division=true`.
  - Our accuracy must be within ±1 of Lichess per player.
  - The `[V]` items (the series start, the harmonic mean with 0) are settled by this test **before** GRADING_VERSION 1 is frozen.

### 8.3 Phase division (`CA/src/divider.ts`; RES R-ACC-03)

- For each position:
  - `majorsAndMinors` = the count of N, B, R, Q of both colours;
  - `backrankSparse` = fewer than 4 pieces on either side's back rank;
  - `mixedness` = the scalachess region score.
- `middlegamePly` = the first ply where `majorsAndMinors ≤ 10 || backrankSparse || mixedness > 150`.
- `endgamePly` = the first ply where `majorsAndMinors ≤ 6`.
- The constants are taken with attribution [V: verify them against the pinned scalachess tag before freezing].
- Games from a FEN start can begin in any phase. Imported Lichess games (P4) use the API's `division`.

### 8.4 Move classification (`CA/src/classify.ts`; RES §4.3, first match wins; GRADING_VERSION 1)

Inputs per ply `i` (mover `m`):

- `Wb = winPct(cpMover(evals[i]))`, `Wa = winPct(cpMover(evals[i+1]))`, `d = max(0, Wb − Wa)`;
- `legal` = the legal move count before the ply; `played`, `bestUci = decode(best[i])`;
- `second` = **`second[i]`**, the stored MultiPV 2 score of position `i` (mover POV), so every rule below runs from stored data (P3-D28);
- `oppPrev` = the `d` of the opponent's previous ply;
- the mate flags from the encoding.

```
1  FORCED      legal == 1
2  BOOK        game.startFen == initial AND every earlier ply is BOOK AND i < 30 AND EPD(pos[i+1]) ∈ BOOK_SET
3  mate rules  (Advice thresholds, mover POV, on cp before clamping)
               MateCreated (no mate before; the mover is being mated after):
                   cpBefore < −999 → INACCURACY;  < −700 → MISTAKE;  else BLUNDER
               MateLost (the mover had a forced mate; none after):
                   cpAfter  >  999 → INACCURACY;  >  700 → MISTAKE;  else BLUNDER
               MateDelayed (mate before and after, slower) → no negative label; fall through to 6
4  severity    d ≥ 15 → BLUNDER;  d ≥ 10 → MISTAKE;  d ≥ 5 → INACCURACY            (≥, as lila; R-CLS-03)
5  MISS        replaces MISTAKE/BLUNDER from 3–4 when opportunity(i):
               oppPrev ≥ 10 AND ( the mover had a mate available at pos i
                                  OR (cpBefore ≥ 200 AND wc(cpBefore) > wc(cpBeforeOppPrev) + 0.6) )
               (wc = winningChances; cpBeforeOppPrev = the mover-POV eval before the opponent's previous move)
6  positive    only when d < 5:
               BRILLIANT  d ≤ 2 AND Wa ≥ 50 AND cpBefore ≤ +300 AND sacrifice(i) AND NOT BOOK/FORCED
                          sacrifice(i): along the pass-2 PV, after the opponent's reply (a capture),
                          the material balance (1/3/3/5/9) ≤ the balance before the move − 2
               GREAT      played == bestUci AND second exists AND (Wbest − Wsecond) ≥ 10
                          AND outcomeClass(Wbest) > outcomeClass(Wsecond)     (classes: < 30 lose, < 70 hold, ≥ 70 win)
                          AND 10 ≤ Wb ≤ 90
               BEST       played == bestUci  (or d < 0.5 when best is unknown, e.g. Lichess-eval imports)
               EXCELLENT  d ≤ 2
               GOOD       2 < d < 5
   INTERESTING  never emitted in GRADING_VERSION 1 (P3-D15)
```

- **Reason templates** (R-CLS-08, shown as `curReason`):
  - Book "Known opening theory." · Forced "The only legal move." · Best "The engine's top choice.";
  - Excellent "Almost as good as the engine's move, {bestSan}." · Good "Fine; {bestSan} was a little better.";
  - Great "The only move that keeps {the win \| the draw \| the hold}." · Brilliant "A sound sacrifice.";
  - Inaccuracy / Mistake / Blunder "Engine preferred {bestSan}.";
  - Miss "Missed {bestSan}{, which wins {piece} \| , a mate in {n}}.";
  - ungraded "Not graded yet. Still analysing this move."
- **Fixture expectations:** `CA/fixtures/labels/design-mock.ts` (from `DR/V3ReviewSummary.dc.html` `GAME` and `DR/V3ReviewClean.dc.html` `CLEAN`). Feeding the mock `ev` values reproduces the mock `q` labels for every user ply, with these documented differences:
  - `44.Rxf6` is INACCURACY, not "interesting" (P3-D15);
  - mock plies labelled "book" whose `best` differs only by a transposition stay BOOK (the book rule is EPD-based);
  - `16.Qb8+` in CLEAN → BRILLIANT;
  - `26.Rd1` → GREAT (fixture-checked: `Wbest − Wsecond ≥ 10` with the stubbed `second`).
- **Position corpus** (TST X13): `FX/grades/positions.jsonl`, at least 80 lines of `{id, fen, move, evalBefore, evalAfter, best, second?, legalCount, expected: {label, winPctLossApprox}, source}`. It covers:
  - the edges at 4.99/5.00/9.99/10.00/14.99/15.00;
  - mate created, lost and delayed;
  - MISS (GAME ply 36);
  - GREAT (a gap ≥ 10 with an outcome-class change);
  - BRILLIANT (16.Qb8+), and not BRILLIANT when cpBefore > +300;
  - FORCED;
  - the BOOK boundary and a FEN start;
  - Fool's Mate `2.g4??`, Scholar's Mate `3…Nf6??` then `4.Qxf7#` (BEST), Légal's trap `…Bxd1??`;
  - KT `24.Rxd4`, Byrne–Fischer `17…Be6`.
  
  `CA/src/classify.positions.test.ts` runs it on stored evals only (pure). P5, P6 and P7 derive their expectations from the same lines.

### 8.5 Key moments (`CA/src/moments.ts`; P3-D14)

```ts
export const MAX_MOMENTS = 3, FILL_MIN_LOSS = 7, MIN_SPACING = 3, ACCEPT_WITHIN = 2;
const PRIMARY = new Set([BLUNDER, MISS, MISTAKE]);
// candidates: the member's plies only; skip decided positions: (Wb < 10 && Wa < 10) || (Wb > 90 && Wa > 90)
// rank: d desc, then MISS > BLUNDER > MISTAKE > INACCURACY
// pick greedily from PRIMARY; if picked < MAX_MOMENTS, continue with INACCURACY where d ≥ FILL_MIN_LOSS
// reject any candidate with |ply − picked.ply| ≤ MIN_SPACING
// order the result by ply ascending (walkthrough order, "Moment 1 of 3 · Move 17")
```

- For each picked moment, pass 2 provides:
  - `pv`, trimmed to 3–8 plies (it stops after the first capture sequence ends, or at 8; RES §7.3);
  - `accept` = every MultiPV-3 move whose Win% is within `ACCEPT_WITHIN` (2) of the best, mover POV (rct-a Q9).
- **Correctness on the client:** the user's move `u` is "found" iff `u ∈ accept`. The first try → `FOUND`; later tries → `FOUND_RETRY`.
- **Fixture:** the GAME mock picks plies 32 (INACCURACY d ≈ 9.8, fill), 36 (MISS d ≈ 30) and 40 (BLUNDER d ≈ 23), which are the design's three moments.

### 8.6 Clean game and best decision

- `isClean` = no candidates at all (primary or fill) for the member side.
- `bestPly` = the first BRILLIANT, else the first GREAT, else the member ply with the largest Win% gain over the previous position (RES §5).
- `bestDecision` (template): "Your best decision: {moveNo}{san}{, a sacrifice that forced mate \| , the only move that held \| }." For the Opera fixture: "Your best decision: 16.Qb8+, a sacrifice that forced mate."
- When the member lost a clean game, the template set `clean_loss` is used ("You kept the balance; the result came from elsewhere.").

### 8.7 Template text (`CA/src/text/*.ts`; deterministic, engine facts only; `source: "template"`)

**Phase line** (`phaseLine`). One token per phase, from the member's phase accuracy `a` and the Win% swing `s` (end − start of the phase, member POV):

| Condition (first match) | Token |
|---|---|
| phase not reached | "{phase} not reached" |
| `s ≤ −25` | "{phase} lost the thread" |
| `s ≥ +25` | "{phase} won it" |
| `a ≥ 90` | "{phase} solid" |
| `a ≥ 75` | "{phase} equal" |
| else | "{phase} slipped" |

The tokens are joined with " · ", for example "Opening equal · middlegame lost the thread · endgame not reached".

**Summary** (2–3 sentences, `summary[]`):

1. Accuracy: "You played at {acc} accuracy{; your opponent at {oppAcc} \| }." Optionally "Your opening was the strongest part (91)." when one phase is ≥ 10 points above the game accuracy.
2. Turning point, from the worst moment `k`: "The game turned on move {moveNo}, when {playedSan} {missed {bestSan} \| let {opp piece fact} \| lost {material fact}}."
3. Close: "{N} moments are worth a second look." / "Nothing big to fix in this one."

**Game-over coach line** (`coachLine`, ≤ 160 characters, COV C-02). The first match wins:
1. a legend game whose member matched every compared move: "{finalSan} finished it the way {legend} did in {year}." (the design's example);
2. at least one moment: the turning-point sentence (summary 2);
3. a clean game: the `bestDecision` sentence;
4. otherwise: "Nothing big to fix in this one."

The critique proposed `summary[0]`. That is the accuracy sentence, which repeats the number already on the card's eyebrow, so the turning point is used instead (Appendix A).

**Moment ask** (`ask`): "Move {n}. {threatFact?} What would you play?", where `threatFact` is computed by chess.js:

- the opponent's last move attacks one of the member's pieces that is undefended, or defended less than it is attacked → "{Opp}'s {piece} on {sq} is eyeing your {piece} on {sq}.";
- the opponent's last move hangs a piece (SEE > 0 for the member) → "{Opp} just played {san}. Something was available here.";
- otherwise, from `Wb` → "The position is still close." / "You are better here." / "You are under pressure."

**Moment why** (`why[]`, 1–3 sentences from facts):

- Material facts from the best line: the first move captures with SEE > 0 → "{bestSan} wins the {piece} on {sq}."; the best line mates → "{bestSan} starts a forced mate in {n}."
- The played move's consequence, from its own PV: "After {playedSan}, {oppReplySan} {wins material \| leaves you with doubled pawns \| gives a check}."
- The cost: "You lose about {round(d)} win% points, so this is {an inaccuracy, not a disaster \| a mistake \| the move that decided the game}."
- **Never invented:** every SAN in a template comes from the engine line or the game, and every number from the arrays. A template test asserts that each SAN parses with chess.js at its position: the same checks P7's verifier will run.

**Headline** (archive note, ≤ 80 chars):

| Condition | Template |
|---|---|
| clean, and a legend game with every move matched | "Played like {legend}" |
| clean | "Clean game" |
| worst moment MISS | "Missed {bestSan} · move {n}" |
| worst BLUNDER with material loss | "Dropped a {piece} · move {n}" |
| worst BLUNDER | "Blunder · move {n}" |
| worst MISTAKE | "Mistake · move {n}" |
| only fill inaccuracies | "{k} inaccuracies" |
| legend game diverged, no moments | "Left {legend}'s path · move {n}" |

The examples match the row notes in `DR/V3GamesArchive.dc.html`.

**Copy rules** (P1 §3.11): sentence case, no emoji, no exclamation marks, numbers as digits, and the user is "you".

### 8.8 Plan intent and chip feedback (`CA/src/intent.ts`)

`intent(bestUci, pos)`, first match:

1. Gives check, or attacks a square next to the enemy king → `attack`.
2. Captures (SEE ≥ 0) → `trade`.
3. Moves a piece that was attacked and under-defended, adds a defender to an attacked piece, or blocks a check line → `defend`.
4. Else → `improve`.

Chip feedback (`plan[chip]`):

- chip == intent → "Right instinct. {whyFirstSentence}".
- chip == `unsure` → "The engine's idea here was to {intent}: {bestSan}."
- otherwise → "You were thinking: {chip}. The engine's idea here was to {intent}: {bestSan} {short fact}."

All five are precomputed, so a chip tap needs no network.

### 8.9 Legend comparison facts (`CA/src/legend/compare.ts`; P3-D24)

- **Inputs:** `startFen`; `legendPgn` (sliced from `startPly` with `slice.ts`, ported from `api/analysis/[gameId]/route.ts:95-129`); the game's `moves`; the member's colour; `heroSide`.
- **Walk** both lines ply by ply from `startPly`:
  - `matchedPlies` counts the member's plies that equal the legend's;
  - the first member ply that differs → `divergencePly`, with `divergenceBy = "user"`;
  - if the opponent (bot or human) differs first → `divergenceBy = "opponent"`, and the comparison stops there;
  - transpositions back into the line are ignored: the first divergence counts (play-b Q18).
- `comparedPlies` = the member plies up to and including the divergence, or all of them.
- `legendResult` and `legendTotalMoves` come from the legend PGN headers (the ported `parseResultFromMetadata`).
- **Writers:** all use `compareWithLegend()` + `INSERT … ON CONFLICT ("gameId","userId") DO NOTHING`, so they are idempotent and agree:
  - bot `complete`, synchronous, < 5 ms;
  - A2/A9, lazy (`legend_facts`);
  - the worker at load time, when the row is missing.
- **Worker:** adds `evalAtDivergence = {userWin, legendWin}` (member-POV Win% after each move, pass-2 budget) inside `ANALYZE_GAME` pass 2, or in `LEGEND_COMPARE` → READY + `compare:ready`.
- **Summary** (`LegendSummaryDTO`, built in the web DAL from the facts): up to 6 rows centred on the divergence; `outcomeLine` "{Legend} won this; you {won \| drew \| lost}."; `replayHref` = `/practice?game=<ref>&ply=<divergencePly>` (null when followed).
- **Template paragraph** (Explanation tab): "You matched {legend} for {matched} of {compared} moves. On move {n} you played {userSan}; {legend} played {legendSan}.{ After that your winning chances were {userWin}% against {legendWin}% for {legend}'s move. \| }"
- **Fixtures:** Opera (12.Ba4 vs 12.O-O-O, 2 of 3 matched), KT (27.Qc3+ vs 27.b4+, 6 matched, `user`), and the opponent-left case (25…Kb6 vs 25…Kxd4).

### 8.10 Narration (Web Speech API, client only; rct-a §2.7)

`WEB/features/review/narration.ts`:

- One `SpeechSynthesisUtterance` per sentence. Its `start` event sets the highlighted sentence (an amber wash `rgba(235,185,60,0.22)` plus weight, never colour alone).
- `rate` ∈ {1, 1.25, 1.5}. Progress = spoken characters / total. The duration estimate = characters / (14 × rate) s.
- The voice is the first `en-*` voice after `voiceschanged`. On iOS the first `speak()` happens inside the tap handler.
- It stops on a moment, tab or route change, and on `pagehide`.
- The controls are hidden when `speechSynthesis` is missing.
- The speed is remembered in the `localStorage` key `rc:narration:rate` (try/catch); Settings › Sounds syncs it in P10.
- It costs nothing. Neural TTS is a later option (rct-a Q6).

### 8.11 Practice hint (client, `WEB/features/practice/hint.ts`)

- Level 1: from the local engine's best move at the current position → "Hint: look at your {pieceName} on {fromSq}."
- Level 2: an arrow from → to.
- Works offline. **P7** may replace the level-1 wording with `POST /api/coach/hint` (CON 3.14).

### 8.12 Worker pipeline (`WK/src/*`)

**Loop and scheduler** (no polling; ARCH §1.10.3, P3-D22):

```
boot → refuse to start if APP_ENV=production and (WORKER_FAULT set or ENGINE=fake)
     → open the SQLite cache → spawn the engine (uci, isready)
     → reap (orphans with my WORKER_ID prefix, and stale heartbeats)       (1 statement)
     → drain()
drain(): loop { job = claim(KNOWN_KINDS, PAYLOAD_V_MAX); if !job break; run(job) }
     → flush the analysis:batch accumulators
     → reap + next = SELECT min("runAt") FROM jobs WHERE status='QUEUED'   (1 batch request; Neon is already awake)
     → nextRunAt = min(next, the kick-supplied runAt values held in memory)
     → sleep until nextRunAt (cap 24 h; DAILY_PLAN guarantees one row a day) or until a kick
```

When idle the worker issues **zero** Neon queries, so Neon scales to zero 5 minutes after the last job. The only fixed wake is the daily `HOUSEKEEPING` at 21:00 UTC (§9.5). The timer audit test (§12.1) proves ≤ 5 DB round trips over 24 simulated idle hours.

**Claim** (one statement over Neon HTTP; safe through the pooler; DM §5.4):

```sql
UPDATE jobs SET status='RUNNING', "lockedBy"=$1, "lockedAt"=now(), "heartbeatAt"=now(),
       "startedAt"=COALESCE("startedAt", now()), attempts = attempts + 1
WHERE id = (SELECT id FROM jobs
            WHERE status='QUEUED' AND "runAt" <= now() AND kind::text = ANY($2::text[])
              AND COALESCE((payload->>'v')::int, 1) <= $3                         -- rollback-safe (FEA §9)
            ORDER BY priority DESC, "fairSeq", "runAt" LIMIT 1 FOR UPDATE SKIP LOCKED)
RETURNING id, kind, payload, attempts, "maxAttempts", priority, "gameId", "userId";
```

An older worker image never claims a job whose payload version it cannot read. Such jobs wait for the newer image.

**Load** (1 statement):
- the `games` row: `moves`, `startingFen`, `startPly`, `moveClocksMs`, `whitePlayerId`, `blackPlayerId`, `chessPositionId`, `mode`, `status`, `plyCount`, `outcome`, `endMethod`, `ecoCode`, `completedAt`;
- the `json_agg` of `game_players` (`color`, `userId`, `users."referenceId"`);
- the existing `game_analyses` row (resume);
- the legend PGN and any `legend_comparisons` rows when `chessPositionId` is set.

**Run `ANALYZE_GAME`:**

1. **Guards.**
   - `status != COMPLETED`, or `plyCount < 6`, or ABORTED → `SKIPPED` (write + `analysis:done {isClean:false, momentsCount:0}`), job DONE.
   - Empty `moves` (legacy pre-P2 data) → SKIPPED.
2. **Replay** the moves with chess.js from `startingFen`: positions, EPDs, legal counts, SANs, material, repetition flags, `lastIrreversible[i]`. When the game has a legend position and no facts row, compute the facts (§8.9) for insertion at the first checkpoint.
3. **Resume point** `r = existing.gradedPlies`: 0 if there is none, or if `existing.version` or the profile differs. If `existing.engine` equals the current profile and only `version` differs, take the **regrade path** (§8.14) instead.
4. **Band.**
   - `streams = job.priority >= PROGRESS_BAND_MIN || watched.has(gameRef)` (P3-D26).
   - If `streams`, emit `analysis:progress {from:r, gradedPlies:r, …}`, so a reloaded client shows the resume point at once.
5. **Pass 1**, for positions `i = r … n`:
   - **Terminal position:** no search; checkmate → `sign·30000`; draw → 0.
   - **Cache:**
     - E1 LRU (200k entries) → E2 SQLite `evals(epd, engine, nodes, multipv)`;
     - used only when `nodes`, `multipv` and `engine` match exactly (determinism), or for a `lichess-db` seed entry at ply < 20 from the initial position;
     - **bypassed** when the EPD occurred earlier in the game, when the half-move clock is ≥ 90 (ARCH §1.9.3), or when `EVAL_CACHE=off`.
   - **Search:** `ucinewgame` (before every search since REGRESSION-3: once per game left resumed runs non-deterministic; `CA/README.md`), `position fen <fen at lastIrreversible[i]> moves <uci …>`, `go nodes 120000` with `MultiPV 2`, `Threads 1`, `Hash 64`. Parse the final `info … multipv 1/2 … score cp|mate … pv …` and `bestmove`. Store `evals[i]`, `second[i]` and `best[i]`.
   - Convert to White POV.
   - **Classify** ply `i−1` as soon as `evals[i]` is known. If `streams`, emit a delta every 2 plies or 300 ms.
   - **Lag pause:** between searches, if `GET websocket:3002/internal/load` (polled at most once a second) reports `loopLagP99Ms > LAG_PAUSE_MS` or `draining`, wait 200 ms and check again.
   - **Checkpoint** every 10 plies, in one statement:
     ```sql
     WITH a AS (INSERT INTO game_analyses … ON CONFLICT ("gameId") DO UPDATE
                SET evals=…, second=…, best=…, judgements=…, "gradedPlies"=$g, "updatedAt"=now())
     UPDATE jobs SET "heartbeatAt"=now() WHERE id=$job AND "lockedBy"=$me RETURNING priority
     ```
     The returned priority re-evaluates `streams`, because an A3 may have raised it mid-run. The first checkpoint also carries the lazy legend-facts insert.
   - **Heartbeat:** a timer also heartbeats if 30 s pass without a write.
6. **Classify all** (§8.4: GREAT uses `second`), then compute the counts, the accuracy per colour, the divider and the phase accuracy. If `streams`, emit `analysis:writing`.
7. **Pass 2** (≤ 6 positions per game, shared by both member sides):
   - candidates = the moment candidates of each member side (§8.5) + BRILLIANT candidates (d ≤ 2 with a material-down PV) + the legend divergence evals (2 positions);
   - `go nodes 1000000` with `MultiPV 3`;
   - re-classify the candidate plies with the deeper before/after evals (consistent: both come from pass 2);
   - build `pv`, `accept` and the sacrifice check;
   - stop early when the time used passes 60 s; the remaining candidates keep their pass-1 labels.
8. **Moments, text, coach line and headline** per member side (§8.5–8.8). The opening name comes from the deepest EPD match, and only when `ecoCode` is null.
9. **Final write.** One `sql.transaction([...])` HTTP request:
   - upsert `game_analyses` (the complete arrays, `completedAt`, `depthP50`, `readyMs = emitTime − games.completedAt` for `reason ∈ {live_end, bot_end, opened}`);
   - upsert `player_reviews` per member side (`content`, `textStatus='TEMPLATE'`; **`progress` untouched**);
   - `UPDATE game_players` per side (`accuracy`, `headline`, `momentsCount`, `counts`, `phaseAccuracy`, `ecoCode`) via `jsonb_to_recordset`;
   - `UPDATE games SET "analysisStatus"='DONE'` (+ the opening when null);
   - `UPDATE users SET "gamesVersion" = "gamesVersion" + 1 WHERE id = ANY($memberIds)`;
   - `UPDATE legend_comparisons` (`facts.evalAtDivergence`, status READY);
   - **extension statements** from `WK/src/pipeline/final-batch/*.ts`. P5 adds its set-based mistake/occurrence/card statements here, keyed by natural keys so no statement needs another's `RETURNING` (AP-27);
   - `UPDATE jobs SET status='DONE', "finishedAt"=now() WHERE id=$job AND "lockedBy"=$me`.
10. **Emit**, through `/internal/emit`, signed:
    - when `streams`: `analysis:done` (personalised, one call per member), `games:changed`, and `compare:ready` (legend games);
    - otherwise, add the game to the per-user `analysis:batch` accumulator (flushed every 60 s and at the end of the drain), and still send `compare:ready` when a compare page waits (watched).
11. **Telemetry:** PostHog `analysis_ready`; the Sentry span and metric `worker.review_ready_ms{band}` (§10).

**Failure.**

- **Engine:** no `bestmove` within 10 s of `go`, or the process exits → restart the process and retry the same position once. A second failure fails the job (`engine_failed`).
- **Fail write** (one statement batch):

```sql
UPDATE jobs SET status = CASE WHEN attempts >= "maxAttempts" THEN 'FAILED' ELSE 'QUEUED' END,
       "runAt" = now() + ($backoff * interval '1 second'), "lastError" = $code, "lockedBy" = NULL
WHERE id = $job AND "lockedBy" = $me;
UPDATE games SET "analysisStatus" = 'FAILED' WHERE id = $gameId;
UPDATE game_analyses SET "failedAtPly" = "gradedPlies" WHERE "gameId" = $gameId;
UPDATE users SET "gamesVersion" = "gamesVersion" + 1 WHERE id = ANY($memberIds);
```

- **Back-off** `$backoff` by attempt: 30 s, 120 s, 600 s. The 4th failure is terminal.
- Emit `analysis:failed {retryable: attempts < maxAttempts, retryAt}` (always: a failure is rare and someone may be waiting).
- **Reaper**, at worker boot and at the end of each drain (no timer):

```sql
UPDATE jobs SET status = CASE WHEN attempts >= "maxAttempts" THEN 'FAILED' ELSE 'QUEUED' END,
  "runAt" = now() + interval '30 seconds', "lockedBy" = NULL, "lastError" = 'worker_stalled'
WHERE status = 'RUNNING' AND ("heartbeatAt" < now() - interval '3 minutes' OR ("lockedBy" LIKE $prefix AND "lockedBy" <> $me))
RETURNING "gameId";
```

  For each reaped game: `games.analysisStatus = 'FAILED'` + `analysis:failed {code:"worker_stalled", retryable, retryAt}`. This is owner test T11: a killed container restarts, reaps its orphan at boot, the UI shows `failed`, and 30 s later the retry resumes from the last checkpoint. A worker that dies and is not restarted is covered by the A2 stall rule below and by the daily cron backstop's kick.
- **Graceful SIGTERM** (`stop_grace_period: 30s`): stop claiming, finish the current search (≤ 0.5 s), checkpoint, then `UPDATE jobs SET status='QUEUED', "runAt"=now(), "lockedBy"=NULL, attempts = attempts - 1` (not counted as a failure), and exit.
- **Stall rule for the API** (A2 / A1): `job.status='RUNNING' AND heartbeatAt < now() - 90 s` → report `failed {code:"worker_stalled", retryable:true}`, even before the reaper runs.
- **Neon fetch errors:** every worker statement is idempotent (upserts, guarded by `lockedBy`), so one immediate retry follows a network or `57P01` failure. A second failure fails the job with `internal` (P3-D11, FEA F-OCI-4).

### 8.13 Engine profile `sf18-v1` and throughput (`CA/src/version.ts`)

```ts
export const GRADING_VERSION = 1;
export const GRADING_CHANGED_AT = "2026-11-??";     // set on freeze
export const ENGINE_PROFILE = {
  id: "sf18-v1", engine: "Stockfish 18", threads: 1, hashMb: 64,
  pass1: { nodes: 120_000, multipv: 2 },               // P3-D9 (may drop to 80k after the bench, before the goldens)
  pass2: { nodes: 1_000_000, multipv: 3, maxPositions: 6, maxSeconds: 60 },
  minPlies: 6, bookMaxPly: 30,
} as const;
```

Throughput model (ARCH §1.9.5, re-computed from the dev bench in task C1):

| Quantity | Formula | Estimate at 0.45–0.75 Mnps effective (0.75 core) |
|---|---|---|
| Pass 1, 60-ply game | 61 × 120k = 7.3M nodes, minus cache hits (~25 % live, ~80 % of plies 1–10) | 8–14 s |
| Pass 2 | ≤ 6 × 1M = 6M nodes | 8–13 s |
| Total per 60-ply game | — | 16–27 s → **130–220 games/hour** |

**Acceptance gate (task C1):** ≥ 60 games/hour on the dev VM, with a socket loop lag p99 < 50 ms during the run.
- If it fails, lower pass 1 to 80k. GRADING_VERSION stays 1, since nothing is frozen yet.
- If it still fails, the owner chooses between `cpus: 0.5` with slower reviews, and the P3-Q4 options.

### 8.14 Versioning and re-grading

- `GameAnalysis.version` = `GRADING_VERSION`; `engine` = the build id + profile.
- **A classifier-only change** (thresholds, templates) bumps `GRADING_VERSION`. The worker **re-grades from the stored `evals`, `second`, `best` and `lines`** with no engine work (R-ENG-04, P3-D28): about 10 ms of CPU and one final batch. Moments whose `pv`/`accept` came from pass 2 are kept, since they are engine facts. Triggers (no GET enqueue, P3-D23):
  - the client's A3 `{reason:"regrade"}` when a review is opened with an old version, at `USER_OPENED`;
  - the daily `regrade-sweep` slice, ≤ 200 a day, newest first, at `HOUSEKEEPING` priority.
- **A profile change** (nodes or engine build) needs a full re-run. Old analyses stay readable until then, because the payload carries `version`.

### 8.15 Annotated PGN (`CA/src/pgn.ts` → `buildAnnotatedPgn(review)`)

- **Headers:** `Event "Replay Chess game"`, `Site`, `Date`, `White`, `Black`, `Result`, `TimeControl`, `ECO`, `Opening`, `FEN`/`SetUp` for FEN starts, `Annotator "Replay Chess · Stockfish 18 (sf18-v1)"`.
- **Per ply:**
  - the SAN and a NAG: `$3` brilliant, `$1` great, `$5` interesting, `$6` inaccuracy, `$2` mistake, `$4` blunder; the Miss NAG is `$2` plus the comment "Miss";
  - `{[%eval 0.36]}` (mate `#3`);
  - `{[%clk 0:04:12]}` from `moveClocksMs`;
  - on moment plies, the template "why" sentences.
- Used by Download PGN, Copy PGN with Comments and A8.

### 8.16 Codec (`CA/src/codec.ts`)

| Item | Encoding |
|---|---|
| JudgementCode (DB) | `0` ungraded … `12` BLUNDER (§6.1); append-only |
| `j` char (DTO, socket) | `.` ungraded, `B` brilliant, `G` great, `b` best, `E` excellent, `g` good, `k` book, `F` forced, `N` interesting, `I` inaccuracy, `M` mistake, `S` miss, `X` blunder |
| MoveCode (DB) | `from + 64·to + 4096·promo` (promo 0 none, 1 n, 2 b, 3 r, 4 q); `0` unknown |
| `best` (DTO) | UCI tokens separated by spaces, `-` for unknown |
| Mate | `sign·(30000 − n)`; `second` sentinel `32767` |

Round-trip property test: 10,000 random positions and moves encode and decode exactly.

### 8.17 Internal call signing (`CT/internal/auth.ts`; P3-D21)

```ts
export type Caller = "web" | "socket" | "worker";
const keyFor = (caller: Caller) => hmacSha256(process.env.INTERNAL_API_SECRET!, `rc-internal-v1:${caller}`);   // derived, cached
export function signInternal(caller: Caller, method: string, path: string, body: string, now = Date.now()) {
  const ts = String(now);
  const sig = b64url(hmacSha256(keyFor(caller), `${ts}\n${method.toUpperCase()}\n${path}\n${sha256Hex(body)}`));
  return { "x-rc-caller": caller, "x-rc-ts": ts, "x-rc-sig": sig };
}
export function verifyInternal(req: { method: string; path: string; headers: Headers; body: string },
                               opts: { allow: Caller[]; maxSkewMs?: number /* 60_000 */ }): { caller: Caller } | { error: 401 | 403 };
// Rules: |now − ts| ≤ 60 s; timingSafeEqual over equal-length buffers; a 120 s LRU of seen signatures rejects
// exact replays; a caller not in `allow` → 403. Unit tests: wrong key, skew, replay, a body changed after signing, the caller swap.
```

- **Callers in P3:**
  - web → worker kick;
  - socket → worker kick;
  - worker → socket `/internal/emit` and `/internal/load`;
  - web → socket `/internal/emit` (the A3/A4 `analysis:queued`);
  - the web cron → worker metrics.
- **What it does not give:** isolation from a full secret leak, since every key is derived from one root. Separate secrets per caller and rotation are a P13 hardening item (P3-Q16).
- **Transition:** the worker accepts only HMAC from day 1. P2's `/internal/emit` accepts HMAC or the old token while the socket env sets `INTERNAL_TOKEN_COMPAT=1`, until H3, when web's emits are already signed; the token branch is then removed and Caddy's unsigned pre-check is widened to `/internal/*`.

---
## 9. Performance and optimization

Targets and conventions follow OPT (§2 SLO classes, §3 database, §4 caching, §5 payloads, §7 bundles) and ALLOC §1.5 (free tiers).

### 9.1 SLOs for this phase and how each is measured

The truth for the latency SLOs is **server-side** (AP-15). PostHog is loaded only after analytics consent (P11), so it keeps funnels, not SLOs.

Field web vitals come from Speed Insights at `sampleRate 0.2`: the Hobby quota is 10k events per 30 days, team-wide (F-VER-5). The lab measurements (Playwright traces in CI) are the gate.

| SLO | Target (dev, worker on 0.75 core) | Target (prod, P13 worker VM) | Measured by |
|---|---|---|---|
| Game end → first badge visible | p50 ≤ 3 s, p95 ≤ 5 s | ≤ 1.5 s / ≤ 3 s (OPT §2.6) | **Server:** the worker metric `worker.first_progress_ms{band}` = the first `analysis:progress` emit − `games.completedAt`. Client part: anonymous Sentry metric `review.first_badge_render_ms{device_class}` (owner decision P11, AP-15) |
| → all badges, 40-ply game | p50 ≤ 12 s, p95 ≤ 20 s | ≤ 6 s / ≤ 10 s | `worker.job.duration_ms{pass:1}` + the queue wait |
| → summary ready, 60-ply game | p50 ≤ 25 s, p95 ≤ 40 s | ≤ 12 s / ≤ 22 s | **`game_analyses."readyMs"`** (SQL percentile over dev rows) and `worker.review_ready_ms{band}` |
| Queue wait, priority ≥ 80 | p95 ≤ 5 s with no backlog | ≤ 2 s | `worker.queue.wait_ms{kind, band}` |
| A1 `GET /api/review/[ref]` server time (class R2) | p95 ≤ 160 ms; a 304 p95 ≤ 60 ms | same | Sentry route span `class:R2`; k6 `review-read.ts` |
| A2 status (R1) | p95 ≤ 100 ms | same | Sentry; k6 |
| G1 `GET /api/me/games` (R2) | p95 ≤ 160 ms; DB ≤ 5 ms at 2,000 rows/user; a 304 adds 0 statements | same | Sentry; k6 `games-list.ts`; `EXPLAIN (ANALYZE, BUFFERS)` in §9.3 |
| A5/A6/A7 writes (W1) | p95 ≤ 150 ms; UI perceived 0 ms (optimistic or keepalive) | same | Sentry |
| `/review/[ref]` TTFB | lab ≤ 400 ms (CI, desktop-1440 trace); field p75 ≤ 600 ms India / ≤ 300 ms US (indicator) | same | Playwright trace; Speed Insights (sampled) |
| `/review/[ref]` LCP / INP / CLS | lab LCP ≤ 2.5 s, INP proxy ≤ 200 ms, CLS ≤ 0.05 at every zoom of the device matrix (a lab gate; field data cannot segment by zoom, AP-35) | same | Playwright on desktop-1440 and iPhone; Speed Insights (indicator) |
| Board interaction in moments (tap → highlight) | ≤ 50 ms | same | Playwright `performance.mark` around `onMove` |
| `/r/[code]` TTFB (CDN hit) | ≤ 150 ms | same | Playwright against the dev URL |
| Socket co-location | loop lag p99 < 50 ms while the worker runs flat out (P2's SLO is < 100 ms) | n/a (own VM) | k6 `ws-ramp.ts` + `scripts/worker-flood.ts` (§12.7) |
| Worker throughput | ≥ 60 games/hour (60-ply average) | ≥ 190/hour (2 lanes) | `WK/scripts/bench.ts`; `worker.engine.nps` |
| Neon statements per analysed game | ≤ 10 (claim 1, load 1, ≤ 6 checkpoints, final 1, drain-end 1) | same | the worker counter `worker.db.statements{kind}` |
| Neon fixed wakes from P3 | ≤ 1 a day (HOUSEKEEPING) | same | the timer audit test (§12.1) + the Neon consumption API weekly report (P1/P13 §9.6), over 3 quiet days |
| Emits per backlog game | 0 per-game frames below band 80; ≤ 1 `analysis:batch` per user per 60 s | same | `ws.emit.analysis{event}` |

### 9.2 The review read (A1 and the RSC page)

One statement, with P2's column names (R-01):

```sql
SELECT g.id, g."referenceId", g.mode, g.source, g."startingFen", g."startPly", g.moves, g."moveClocksMs",
       g."whitePlayerId", g."blackPlayerId", g."botElo", g.outcome, g."endMethod", g."completedAt", g."timeClass",
       g."ecoCode", g."openingName", g."initialTimeSeconds", g."incrementSeconds",
       g."analysisStatus", g."chessPositionId", g.meta->'position' AS position,
       gp.color, gp."opponentUserId", gp."opponentName", gp."opponentRating", gp."ratingBefore",
       u.name AS "youName",
       a.version, a.engine, a."totalPlies", a."gradedPlies", a."failedAtPly", a.evals, a.best, a.judgements,
       a."middlegamePly", a."endgamePly", a."accuracyWhite", a."accuracyBlack", a."countsWhite", a."countsBlack", a."depthP50",
       pr.content, pr."textStatus", pr.progress, pr."startedAt", pr."completedAt" AS "reviewCompletedAt", pr."updatedAt" AS "reviewUpdatedAt",
       opp.accuracy AS "oppAccuracy", opp."phaseAccuracy" AS "oppPhaseAccuracy",
       me.accuracy AS "myAccuracy", me."phaseAccuracy" AS "myPhaseAccuracy",
       j.status AS "jobStatus", j.attempts, j."maxAttempts", j."runAt", j."heartbeatAt", j.priority, j."lastError",
       s.code AS "shareCode", s."expiresAt" AS "shareExpiresAt", s."showUsername"
FROM games g
JOIN game_players gp        ON gp."gameId" = g.id AND gp."userId" = $viewer          -- the player check (404 if no row)
JOIN users u                ON u.id = gp."userId"
LEFT JOIN game_players opp  ON opp."gameId" = g.id AND opp.color <> gp.color          -- member opponent only
LEFT JOIN game_players me   ON me."gameId" = g.id AND me.color = gp.color
LEFT JOIN game_analyses a   ON a."gameId" = g.id
LEFT JOIN player_reviews pr ON pr."gameId" = g.id AND pr.color = gp.color
LEFT JOIN jobs j            ON j."dedupeKey" = 'analyze:' || g.id
LEFT JOIN LATERAL (SELECT code, "expiresAt", "showUsername" FROM shares
                   WHERE "ownerId" = $viewer AND kind='REVIEW' AND "gameId" = g.id AND "revokedAt" IS NULL AND "expiresAt" > now()
                   ORDER BY "createdAt" DESC LIMIT 1) s ON true
WHERE g."referenceId" = $ref;
```

- **Player cards** (no `games.whiteName…` dependency):
  - **You:** `users.name` + `gp."ratingBefore"`.
  - **Opponent:** `gp."opponentName"` + `"opponentRating"`.
  - **Opponent kind:**
    - `opponentUserId` not null → `member`;
    - `mode ∈ {BOT, LEGEND_BOT}` → `bot`;
    - `source ≠ REPLAY` → `external`;
    - a legend line → `legend`.
- **Opponent accuracy:**
  - a member opponent: from `opp.accuracy`;
  - a bot opponent: from `game_analyses.accuracyWhite/Black` for the other colour.
  
  The opponent's review, moments and progress are never selected.
- **Index use:** `games_referenceId_key`, `game_players_pkey` (P2), `game_players_gameId_color_key`, `users_pkey`, `game_analyses_pkey`, `player_reviews_pkey`, `jobs_dedupeKey_key`, `shares_owner_idx`. Expected: < 1 ms DB and ≤ 30 shared buffers.
- **Admin path:** the same query without the `gp` user filter (`you` = white for admins).
- **ETag first:** for a revalidation (`If-None-Match`), the wrapper's `etagProbe` runs the §6.4 probe and returns 304 before the query above.
- **DTO build:** ~0.2 ms CPU to encode the arrays to strings and derive the SAN from `moves`. SAN is not stored. A chess.js replay of 80 plies takes ~1 ms on Vercel, so SAN is computed per request and memoised **per version** in a module-scope LRU (`lru-cache`, 500 entries, key `ref:version`, OPT §4.5). Only refs, never user data, sit in the module cache.

### 9.3 Archive (G1; keyset on `game_players."endedAt"`, P3-D25)

```sql
SELECT g."referenceId", gp.color, gp.result, gp."timeClass", gp.mode, gp."endedAt",
       gp."opponentName", gp."opponentRating", gp."opponentUserId", gp."ratingDelta",
       gp.accuracy, gp.headline, gp."momentsCount", gp."ecoCode",
       g.source, g."analysisStatus", g.fen, g."chessPositionId", g."openingName",
       g."initialTimeSeconds", g."incrementSeconds", g.meta->'position'->>'name' AS "positionTitle",
       (lc."gameId" IS NOT NULL) AS "hasComparison"
FROM game_players gp
JOIN games g ON g.id = gp."gameId"
LEFT JOIN legend_comparisons lc ON lc."gameId" = gp."gameId" AND lc."userId" = gp."userId"
WHERE gp."userId" = $1
  AND gp.result = ANY($4::"PlayerResult"[])                                         -- default {WIN,LOSS,DRAW}: no live, no aborted
  AND ($2::timestamp(3) IS NULL OR (gp."endedAt", gp."gameId") < ($2, $3::bigint))  -- keyset cursor
  AND ($5::"TimeClass"[] IS NULL OR gp."timeClass" = ANY($5))
  AND (NOT $6 OR gp."momentsCount" > 0)
  AND ($7::text IS NULL OR gp."opponentName" ILIKE $7 OR g."openingName" ILIKE $7
       OR (g.meta->'position'->>'name') ILIKE $7)                                   -- $7 = '%' || escaped q || '%'
ORDER BY gp."endedAt" DESC, gp."gameId" DESC
LIMIT $8 + 1;
```

- **Plan:** an Index Scan on `game_players_userId_endedAt_gameId_idx` with a filter, plus a nested loop to the `games` PK. **No Sort node**, which the explain gate asserts (AP-07).
- **Filter selectivity:** filters run inside one user's ≤ 2,000 rows (DM §2 rule 9). The worst case, a search with no match, scans all of that user's rows: ~2,000 index entries + heap fetches ≈ 3 ms.
- **Counts** (page 1 and `limit=0` only, AP-38): `SELECT count(*) FILTER (WHERE <filters>) AS "filteredTotal", count(*) AS all FROM game_players gp JOIN games g … WHERE gp."userId"=$1 AND gp.result = ANY('{WIN,LOSS,DRAW}')`, one statement run in `Promise.all` with the page query.
- **ETag:** `"g<viewer.gamesVersion>-<fnv(filter, cursor, limit)>"`. The viewer is already loaded, so a 304 costs nothing beyond it (P3-D27).
- **Check:** `EXPLAIN (ANALYZE, BUFFERS)` on Docker Postgres in CI and on the Neon dev branch, with the 2,000-row synthetic user (`DB/seed/perf-archive.ts`, dev only). Expect ≤ 200 shared hits, no Seq Scan on `games` or `game_players`, and no Sort (OPT §3.5).
- **Scale path:** past 20k rows for a single user, a `pg_trgm` GIN index on names (play-b F8). Not needed now.

### 9.4 Caching layers

| Layer | What | Policy |
|---|---|---|
| Browser query cache | `qk.review.detail` | `staleTime ∞` once done: a revisit within the tab costs 0 requests |
| HTTP (per user) | A1, A2, A9, G1, PR1 | `private, no-cache` + a **strong** ETag. The 304 path is one tiny probe, or 0 extra statements for G1 (OPT §4.9). **No `max-age` on any per-user response** (AP-04). |
| HTTP (downloads) | A8 | `private, no-store` + `Content-Disposition: attachment` |
| Sign-out | — | P1's `POST /api/session/clear` (`Clear-Site-Data: "cache"`) runs before `clerk.signOut()`. The shared-device spec (§12.3) checks P3's URLs. |
| CDN / ISR | `/r/[code]` | ISR `revalidate = 3600`, tag `share:<code>`, purged by `revalidateTag` on PATCH/DELETE. A 404 is cached for the same window (AP-47). |
| CDN | `/r/[code]/og` | `Vercel-CDN-Cache-Control: s-maxage=31536000` + `Vercel-Cache-Tag`, purged with `invalidateByTag`. The browser gets `max-age=3600`, and the versioned URL changes on every edit (AP-05). |
| Static | `/how-we-grade` | `force-static` (a deploy invalidates it) |
| Module scope (Vercel) | the SAN-by-version LRU (§9.2). The parsed `CA` book set is **not** loaded on Vercel. | 500 entries |
| Worker E1 | an LRU of evals | 200k entries ≈ 60–80 MB |
| Worker E2 | SQLite `evals` on `/data/evalcache` | 4 GB cap; LRU trim weekly |
| Worker E3 | the Lichess CC0 seed (opening EPDs) | loaded into E2 at first boot |
| Worker in-memory | the book set (~30–40k EPDs from replaying every `openings.pgn`), rebuilt at boot | `SELECT pgn FROM openings WHERE "isActive"` once per boot (~3.6k rows, ~400 KB) |
| Service worker | never caches `/api/*` or RSC (P1 H8) | — |

### 9.5 Free-tier budgets

| Resource | P3 impact | Guard |
|---|---|---|
| Neon compute (100 CU-h a month) | The worker is active only while jobs run: ~25 s × games a day. At 120 games a day that is ≈ 50 min a day of activity, which overlaps user traffic anyway. | No timer polling; the in-memory `nextRunAt`; 1 fixed wake a day (the timer audit test); no GET enqueues; banded emission. **Backfills and k6 wait for the AP-01 dev-project split.** |
| Neon storage (1 GB) | ~1.4 MB per member per year from P3 tables (§6.5) | lz4; job and share pruning |
| Vercel invocations (Hobby, 1M a month) | 3–6 per review session (§5.2); 0 per ply (the worker does not call Vercel); 1 cron task a day | Socket push, keepalive batching, no prefetch of the share page, G1 304s |
| Vercel bandwidth / CDN requests | review payload ~2.5 KB br; `/r/` mostly CDN; **no deployed-URL device matrix** (the full matrix runs against `next start` in CI, F-VER-3) | — |
| Speed Insights (10k events per 30 d) | the review pages | `sampleRate 0.2` (F-VER-5) |
| OCI (Always Free) | +1 container on the dev VM (0.75 CPU cap in a `cpu.idle` slice, 1 GB RAM, ~5 GB disk for the cache + image) | Compose profile `worker` is dev-only; the prod VM comes in P13, within 4 OCPU / 24 GB |
| R2 | one seed file (≈ 0.5–1.5 GB) | free tier |

### 9.6 Payloads and bundles

| Item | Budget | Notes |
|---|---|---|
| `ReviewDTO` at 80 plies | ≤ 12 KB raw / ≤ 5 KB br (expect ~4.6 / ~2.5) | Columnar; FENs computed on the client; the opponent's moments are not sent |
| `analysis:progress` frame | ≤ 400 B | deltas only |
| `analysis:done` frame | ≤ 360 B | including `coachLine` (≤ 160 chars) |
| `analysis:batch` frame | ≤ 600 B | ≤ 20 refs |
| `ReviewStatusDTO` | ≤ 600 B | ≤ 300 B without the legend summary |
| `GET /api/me/games` page (30 rows) | ≤ 12 KB raw / ≤ 4 KB br | `finalFen` is the largest field |
| `LegendCompareDTO` | ≤ 4 KB (+ ~20 KB with `include=explanation`, fetched only on the Explanation tab) | — |
| `ShareSnapshotV1` | ≤ 6 KB | — |
| First Load JS `/review/[ref]` | ≤ 300 kB gz (ALLOC §5.4), no engine; **no zod in production chunks** (`devSchema`, AP-12) | `next/dynamic` for `ReviewMenu`, `NarrationControls`, `KeyMomentStepper` (loaded on Start) and `LabelCountsTable` |
| `/games` | ≤ 230 kB gz | `@tanstack/react-virtual` ≈ 5 kB (kept eager: Appendix A) |
| `/practice` | ≤ 300 kB gz + the engine (lazy, hashed, immutable, ~7.3 MB WASM, cached by the SW `CacheFirst`) | — |
| `/r/[code]` | ≤ 120 kB gz (no board JS; a ≤ 6 kB stepper island) | — |
| `/how-we-grade` | ≤ 180 kB gz (marketing budget) | static |

P1's CI bundle report enforces these, and the PR fails on a regression > 5 % or on going over budget. The `ZodError` grep check (AP-12) covers P3's chunks.

### 9.7 Optional speed-ups (stretch; only if the dev SLOs in §9.1 miss)

1. **Live prewarm** (flag `analysis-live-prewarm`, ARCH §1.9.4):
   - The socket server posts each new live position to `POST /internal/analysis/prewarm {epd, fenWithHistory}` on the worker (signed).
   - When the batch lane is idle and `liveGames ≤ 30`, the worker runs the pass-1 search into the eval cache only.
   - Results are never sent to clients during play (no engine leak).
   - After the game, pass 1 is mostly cache hits, so badges stream within ~2 s.
   - Not for bot games (they are client-run).
2. **Shorter pass 2** for long games (≤ 4 positions when `totalPlies > 120`).
3. **Bring the P13 worker VM forward** (P3-Q4: an owner decision, inside 4 OCPU).

### 9.8 Database client rules (FEA F-OCI-4, AP-18)

- **Worker:** `neon()` over HTTP only. No pool and no idle connection, so a Neon suspend cannot raise an unhandled `error` event. A fetch or `57P01` failure is retried once immediately (every statement is idempotent), then the job fails `internal` with back-off. Nothing ever holds a transaction open between HTTP requests.
- **Web:** P1's Prisma client with its P1001/P1017 retry for GETs. P3's write services are single statements or `$transaction([...])` batches, never interactive transactions spanning network calls. Every `kickWorker` and `emit` call happens **after** the commit, in `after()`.
- **Socket:** P2 owns the pool rules (`pool.on('error')`, `idleTimeoutMillis`). P3 adds only CTE fragments to an existing statement.
- **Resilience check** (§12.6): suspend the dev compute while the worker is between checkpoints. The next statement wakes Neon (~0.5–1 s) and the job completes.

---

## 10. Telemetry

PostHog: `distinct_id = User.referenceId` (ARCH X14). Every event carries `app_env`.
- **No PII in properties:** no FEN, PGN, SAN, names or free text (play-b §3.12). The P1 PII guard enforces this in e2e: it fails on FEN, PGN or SAN shapes and on any text the spec registers.
- **Schemas:** P3 registers every event below with a zod schema in `packages/analytics/src/events/review.ts` (TST X6). `track()` is typed against the registry, and the e2e fixture rejects unknown events and extra keys.
- **Transport:** client events go through `track()`. Server events go through the PostHog HTTP `/batch` endpoint, in `after()` (web) or batched every 5 s (worker).
- **The engine-load event is P2's `engine_init`** (`cached, ms, ok`), reused unchanged. A failure is `ok: false` (CON 3.12, R-18).

### 10.1 PostHog events

| Event | Where | Properties |
|---|---|---|
| `analysis_queued` (s) | web/socket enqueue (once per `dedupeKey`: only when `created`) | `game_mode, source, reason, priority, queue_position` |
| `analysis_started` (s) | worker claim | `wait_ms, attempt, resumed_from_ply, priority, band` |
| `analysis_ready` (s) | worker done | `ms_from_game_end, plies, nodes_total, cache_hit_ratio, duration_ms, pass2_positions, moments_w, moments_b, clean_w, clean_b, regrade` |
| `analysis_failed` (s) | worker | `code, attempt, failed_at_ply, retryable` |
| `review_opened` | client | `source: game_over\|archive\|home\|deeplink\|share_owner, status, device` |
| `review_summary_viewed` | client | `accuracy_bucket (10s), moments, is_clean` |
| `review_tab_switched` | client | `tab` |
| `eval_graph_jump` | client | `ply_bucket` |
| `narration_played` / `narration_completed` | client | `context: summary\|moment, speed` |
| `review_started` | client | `moments` |
| `moment_viewed` | client | `idx, judgement` |
| `moment_attempt` | client | `idx, correct, attempt_no, accepted_as: best\|alt` |
| `moment_plan_picked` | client | `idx, chip, matched_intent` |
| `moment_revealed` | client | `idx, attempts` |
| `moment_show_line` | client | `idx` |
| `review_completed` | client | `moments, found, found_retry, revealed, duration_ms` |
| `game_over_review_clicked` | client | `status_at_click, has_coach_line, legend` |
| `game_over_replay_clicked` | client | `divergence_ply_bucket` |
| `analysis_retry_clicked` / `analysis_retry_succeeded` | client / worker | `code, attempt` |
| `pgn_downloaded` | client | `annotated: true` |
| `how_we_grade_viewed` | client | `tab, from` |
| `share_opened` / `share_link_created` (s, once per `Idempotency-Key`) / `share_link_copied` / `share_image_downloaded` / `share_posted_x` / `share_pgn_copied` / `share_username_toggled` / `share_revoked` | client / server | `from, show_username` |
| `share_page_viewed` (s) | `/r` page `after()` (ISR renders only) + the client island beacon | `referrer_domain, signed_in` |
| `share_signup_clicked` | client | — |
| `games_archive_viewed` | client | `count_bucket, filters_active` |
| `games_archive_filtered` | client (debounced) | `result[], tc[], moments, q_len, results_bucket` |
| `games_archive_game_opened` | client | `analysed, target: review\|compare` |
| `legend_compare_opened` | client (P3 owns it; P8 reuses it, R-18) | `from: game_over\|archive\|review_menu, status` |
| `compare_tab_viewed` | client | `tab, comparison_status` |
| `compare_narration_played` | client | `pct_listened, speed, audio_failed` |
| `practice_started` | client | `from: compare\|review\|position\|fen\|game_over, ply_bucket` |
| `practice_action` | client | `action: takeback\|reset\|hint1\|hint2\|compare` |

**Dashboards** (PostHog, created in WP-H):
- Funnel: game end → `review_opened` → `review_started` → `review_completed` (→ the P5 drill).
- Failure rate by code.
- Share creation → public views.

The latency SLO panels read Sentry metrics and `game_analyses."readyMs"`, not PostHog (§9.1).

### 10.2 Sentry

| Where | Instrumentation |
|---|---|
| Worker (`@sentry/node`, `SENTRY_DSN`, `environment = APP_ENV`, release = the git sha) | **Transaction** `job.analyze` (sample 1.0: low volume), with child spans `load`, `pass1`, `classify`, `pass2`, `text`, `write`. Tags: `kind`, `attempt`, `priority`, `band`, `profile`. <br>**Errors:** `captureException` on engine failures and DB errors, with context `{gameRef, ply}` (no names). <br>**Metrics:** `worker.queue.depth{band}`, `worker.queue.wait_ms{kind,band}`, `worker.job.duration_ms{kind,pass}`, `worker.first_progress_ms{band}`, `worker.review_ready_ms{band}`, `worker.job.fail{kind,code}`, `worker.engine.nps`, `worker.engine.restarts`, `worker.cache.hit{tier}`, `worker.db.statements{kind}`, `worker.lag_pause_ms`, `worker.emit{event}`. <br>**Cron monitor** `housekeeping` (check-ins at the start and end). <br>If the Sentry metrics API is not available on the free plan [V4], the same gauges are served from `/internal/metrics` and pulled by the daily cron backstop. |
| Web routes | P1's route span per route, with `class` (R1/R2/W1/W2). `tracesSampler` keeps `/api/review/*` at 0.2 on dev. Warnings for a failed `kickWorker` (`analysis.kick_failed`) and breadcrumbs for the CAS re-kick (`analysis.rekick`). |
| Client | An error boundary around `ReviewScreen`, `GameList` and `CompareScreen` (`captureException` with the request id from `ApiError`); breadcrumbs for `analysis:*` events (type and ply only); a `review.auto_advance` span from `done` to the summary paint; the anonymous metric `review.first_badge_render_ms{device_class}` (subject to the P11 decision, AP-15) |
| Socket | A breadcrumb + the metric `ws.emit.analysis{event}`; `/internal/load` served from the existing lag monitor; `ws.internal.auth_fail{caller}` |
| Alerts (dev) | `worker.job.fail` rate > 20 % over 30 min; `worker.queue.oldest_s{band=80+}` > 120 s; no `housekeeping` check-in within 26 h; `analysis.kick_failed` > 10/h; the cron backstop cannot reach the worker |

---

## 11. Security, privacy, paywall and authz

### 11.1 Access matrix

| Resource | Signed out | Signed in, never a member | Lapsed | Member, not a player | Member, player | Admin |
|---|---|---|---|---|---|---|
| `/review/*` pages, A1–A9b | sign-in (middleware) / 401 | `/pricing?reason=trial_available` / 402 | `/pricing?reason=expired` / 402 (read allowed only with `review-lapsed-read`) | **404** | full | read only |
| A10/A11 share writes | 401 | 402 | 402 | 404 | owner only (A11) | no |
| `/r/[code]` and its image | public | public | public | public | public | public |
| `/games`, G1 | sign-in / 401 | 402 | 402 (read only under the flag) | own rows only | own rows | own rows |
| `/practice`, PR1 | sign-in / 401 | 402 | 402 | `?game=` → 404 | full | full |
| `/how-we-grade` | public | public | public | public | public | public |
| Socket `analysis:*` | — | — | — | never sent | the user's own room only | — |
| Worker `/internal/analysis/kick`, `/internal/metrics` | HMAC (web, socket) | HMAC | HMAC | HMAC | HMAC | HMAC |

The 402 `reason` values come from P1 (`trial_available | trial_used | expired | payment_failed`).

### 11.2 Rules and how they are enforced

1. **Players only** (Phase 0 "analysis private to players"):
   - every review query joins `game_players ON "userId" = $viewer`, so a missing row → `DataError("not_found")` → 404;
   - the worker sends events only to the rooms of `game_players` users;
   - the DTO never includes the opponent's review, moments or progress;
   - tested by the authz matrix (§12.2) and the socket event spy (§12.3).
2. **Membership:** `route({auth:"member"})` on every `/api/review/*`, `/api/share/*`, `/api/me/games` and `/api/practice/context` route, plus `requireMemberPage()` on every page (layouts don't re-run on soft navigation, CDL §2.4). E2E runs with `BILLING_PAYWALL=on` (TST X3).
3. **No GET side effects that prefetches or crawlers can trigger** (P3-D23):
   - no page enqueues;
   - only the declared `kick_cas` and `legend_facts` writes, enforced by the GET-purity gate;
   - the share page never creates a link on GET;
   - `<Link prefetch={false}>` to the share page.
4. **Internal endpoints** (P3-D21):
   - HMAC with a ±60 s skew and a replay cache, through `verifyInternal()`;
   - a caller allow-list per route and per event;
   - bodies ≤ 1 KB (kick) or ≤ 4 KB at Caddy;
   - Caddy rejects unsigned `/internal/analysis/*` and `/engine/*` before Node;
   - `/internal/load` and `/health` are not routed;
   - the worker container publishes no port on the host.
5. **DB least privilege:**
   - `replay_worker` has column-level UPDATE grants (§6.3), `statement_timeout = 60s` and no DDL;
   - web routes use `replay_app` (P1 F9), with the P3 grants;
   - the socket role gets only the `jobs` insert and two column updates.
6. **Input validation:**
   - zod on every body and query;
   - `ply` within `[0, plyCount)`;
   - `?fen=` is validated (legal, one king each, no impossible check) before it reaches the engine;
   - A5 events are capped at 50 and the body at 8 KB;
   - a share `code` must match `^[0-9a-hjkmnp-tv-z]{8}$`.
7. **Abuse:**
   - rate limits (§7.2): analyse 10/min, share 5/min + 20/day (durable), share edits 10/min, legend compute ≤ 3 attempts per game;
   - Vercel Firewall per-IP limits on `/r/*` (P1);
   - kick floods are harmless (an idempotent drain; Caddy drops unsigned ones);
   - the worker's 4-attempt cap bounds the engine cost of a poisoned game.
8. **Caching hygiene** (AP-04, AP-05): no per-user `max-age`; downloads `no-store`; `Clear-Site-Data` at sign-out (P1); the share image is purged on revoke and on the username toggle, and returns the generic card afterwards.
9. **Error hygiene:** no `error.message` in responses (P1 H7); `lastError` is a code plus a short message, never PII.
10. **Test hooks off in prod** (TST X12):
    - `WORKER_FAULT` and `ENGINE=fake` make the worker refuse to boot with `APP_ENV=production`;
    - the kick `fault` field is ignored outside `APP_ENV=test`;
    - the `/dev/ui/*` P3 routes are in the hook registry, and `prod-guard.spec.ts` proves they return 404 on the production build.
11. **The dev environment is protected** (SEC-3, P1): e2e and the smoke checks against the dev URL send `x-vercel-protection-bypass`. The worker does not call the web.

### 11.3 Public share privacy (owner decision P3-Q2 before the flag goes beyond the owner)

- The snapshot is **frozen at creation** and copied into `shares.snapshot`. The public page and image read nothing else: no joins to `games`, `users` or analysis, so later edits and deletions do not leak.
- **Names:**
  - With **Show My Username** on, the sharer's name and rating show.
  - The opponent's name shows only when the opponent is a bot, a legend, or an external player in an imported game (public on Chess.com and Lichess).
  - A Replay Chess member opponent shows as "Opponent ({rating})" until P10 gives profiles a visibility setting.
  - With the toggle off, the sharer shows as "A Replay Chess player" and the opponent is masked as above.
- **Never included:** user refs, emails, clocks, the game ref, `chessPositionId`, IP-derived data.
- **Lifetime:**
  - `noindex, nofollow`; `robots.txt` disallows `/r/`;
  - links expire after 30 days (the page shows `gone` within 1 h of expiry through the ISR revalidate) and are deleted 7 days later;
  - Stop Sharing revokes at once: `revalidateTag` + `invalidateByTag`, and the image falls back to the generic card.
- **Account deletion** (P10) deletes REVIEW shares explicitly (DM D19). Until P10, the `Share.ownerId` SetNull path is not used for REVIEW, and the deletion runbook lists them.
- `/privacy` gets one line (P11): "If you share a review, anyone with the link can see that game's moves and grades for 30 days."

### 11.4 Licences

| Component | Licence | What P3 does |
|---|---|---|
| Stockfish | GPLv3 | The worker image stays private (P3-Q9); `WK/NOTICE` carries the source tag, the net hash and a pointer to the GPL text (LIC-3) |
| scalachess `Divider` | MIT, verified before porting (V8) | Attribution in `CA/NOTICE.md` |
| Lichess eval DB | CC0 | Attribution on How we grade: "Opening evaluations from the Lichess open database, CC0" |
| The grading formulas | — | Re-implemented from published descriptions under `CA/CLEANROOM.md` (no lila code); the CI licence check fails on AGPL/GPL npm dependencies (LIC-4) |
| The board icons in `WEB/public/board_icons` | the owner's own (user memory) | Used per B8 |

---
## 12. Testing

The layout follows TST X1:
- unit tests sit beside the source as `*.test.ts` (`node:test` via `tsx`);
- DB-backed tests are `*.int.test.ts` (Docker Postgres 17);
- route, contract and authz tests live under `WEB/test/{api,integration,authz}/`.

`check-test-globs` must show every P3 test file running. Component behaviour is tested in Playwright against the demo routes and the real routes. Every spec carries `@p3`, plus the `@state:`/`@demo:` tags it reaches (TST X8). 3–6 specs carry `@smoke`.

**CI** (ARCH §5, with TST X2 and F-VER-3):
- **PR:** lint, types, unit, contract, `integration` (worker + web on Docker Postgres with the fake engine), and Playwright `e2e-smoke` (`BILLING_PAYWALL=on`, against `next start`).
- **Nightly (`nightly.yml`, created by P1):**
  - the full e2e and the full device × zoom matrix against `next start` + Docker Postgres in CI;
  - visual regression;
  - state coverage;
  - P3's own jobs: the arm64 goldens, label stability and eval provenance.
- **Post-deploy (`post-deploy-dev.yml`, P1):** the `@smoke` set against the dev URL with the protection bypass, plus the worker smoke (§12.8).

### 12.1 Unit tests

| File | Cases |
|---|---|
| `CA/src/winpct.test.ts` | the RES §3.3 table (±0.01); the cp clamp ±1000; the mate encoding → ±1000; `cpOf(±29999)` |
| `CA/src/accuracy.test.ts` | the `moveAccuracy` table; `after ≥ before` → 100; window sizes for n = 3, 11, 81, 200; the harmonic mean with a 0 move; `gameAccuracy` null for < 3 positions; phase slices with -1 |
| `CA/src/accuracy.oracle.test.ts` | 30 Lichess games (`CA/fixtures/oracle/*.json`): our accuracy within ±1 per player (R-ACC-05); judgement agreement ≥ 90 % for inaccuracy/mistake/blunder |
| `CA/src/divider.test.ts` | the oracle games' Lichess `division` reproduced (±1 ply); a FEN start already in an endgame |
| `CA/src/classify.test.ts` | thresholds at exactly 5, 10, 15 (≥); mate created at cp −1000/−800/−500 → INACCURACY/MISTAKE/BLUNDER; mate lost; mate delayed (no negative label); MISS on a hanging piece not taken (GAME ply 36); not MISS when the opponent's previous move was only an inaccuracy; BRILLIANT `16.Qb8+` (CLEAN ply 30); not BRILLIANT when cpBefore > +300; GREAT from the stored `second` with a gap ≥ 10 and an outcome-class change; FORCED single legal move; BOOK contiguous; BOOK never after a non-book ply; a FEN start never BOOK; INTERESTING never emitted; the full `GAME` and `CLEAN` mock arrays vs the expected labels file |
| `CA/src/classify.positions.test.ts` | every line of `FX/grades/positions.jsonl` (≥ 80) gives its expected label (TST X13) |
| `CA/src/moments.test.ts` | GAME → plies [32, 36, 40]; spacing (a candidate 2 plies away is skipped); fill only below 3 primaries and only with d ≥ 7; decided positions excluded; ≤ 3; ascending order; `isClean` for CLEAN; `bestPly` = 30; the clean-loss template |
| `CA/src/intent.test.ts` | check → attack; capture → trade; saving an attacked piece → defend; quiet → improve |
| `CA/src/text/*.test.ts` | deterministic snapshots for GAME and CLEAN, including `coachLine` (the turning point for GAME, the best decision for CLEAN, the legend-followed variant); every SAN in every template parses with chess.js at its position; every number traces to the arrays; ≤ the length limits; no emoji or "!" |
| `CA/src/regrade.test.ts` | a GAME analysis re-graded from the stored arrays equals a fresh grading from the same arrays; no engine call (a spy) |
| `CA/src/legend/compare.test.ts` | Opera 12.Ba4 vs 12.O-O-O (2/3); KT 27.Qc3+ vs 27.b4+ (6 matched, `user`); the opponent left first (`opponent`); followed to the end (null divergence); a legend PGN shorter than the game; the `LegendSummaryDTO` rows and `replayHref` |
| `CA/src/legend/slice.test.ts` | the ported helpers from `api/analysis/[gameId]/route.ts:42-129`: move-number slicing, result metadata, outcome mapping |
| `CA/src/pgn.test.ts` | the annotated PGN re-parses with `chess.loadPgn`; the NAG mapping; `[%eval #3]`; `[%clk]`; FEN-start headers |
| `CA/src/codec.test.ts` | the 10,000-sample round trip (MoveCode, evals, `second` sentinel, `j` chars); `mergePlies` splices and ignores stale deltas |
| `CT/internal/auth.test.ts` | sign/verify round trip; a wrong key, ±61 s skew, a replay within 120 s, a body changed after signing, a caller swap → reject; timing-safe compare on unequal lengths |
| `WK/src/engine/uci.test.ts` | parses `info depth … multipv 2 score cp -35 … pv …`, `score mate -3`, `lowerbound`/`upperbound` lines (ignored), `bestmove (none)`; a 10 s timeout → `EngineTimeout` |
| `WK/src/pipeline.test.ts` | FakeEngine (a deterministic EPD → score table) + an in-memory DB adapter: progress every 2 plies or 300 ms **only for band ≥ 80 or watched**; no per-game frames for a band-10 job, and one `analysis:batch` per 60 s; a checkpoint at 10, 20, …; the checkpoint's returned priority switches streaming on mid-job; the final batch contents (including `second`, `readyMs`, `gamesVersion`, the P5 extension hook); `analysis:done` personalised per member with `coachLine`; the SKIPPED path for 4-ply games |
| `WK/src/resume.test.ts` | a crash at ply 23 → the re-run starts at 20 → the final arrays are byte-identical to an uninterrupted run (cache off) |
| `WK/src/failure.test.ts` | the engine dies twice → the job is QUEUED, `runAt` +30 s, `analysis:failed retryable`; the 4th attempt → FAILED, `retryable:false`; SIGTERM → re-queued without counting an attempt; a Neon fetch error → one retry, then `internal` |
| `WK/src/queue/reaper.test.ts` | an orphan by boot prefix; a stale heartbeat > 3 min; a fresh job untouched; it runs at boot and at the end of a drain only |
| `WK/src/scheduler/scheduler.test.ts` | sleeps until `min(nextRunAt)`; a kick with `runAt` shortens the sleep; a kick interrupts; **timer audit:** a fake clock + a DB spy over 24 simulated idle hours → ≤ 5 DB round trips (the one HOUSEKEEPING wake) (AP-08 gate) |
| `WK/src/scheduler/recurring.test.ts` | `DAILY_PLAN` inserts the next HOUSEKEEPING row once (dedupe); a fake slice's `plan()` rows are inserted; a slice error does not stop the others |
| `WK/src/cache.test.ts` | exact `(engine, nodes, multipv)` match only; bypass on a repeated EPD, halfmove ≥ 90, and `EVAL_CACHE=off`; LRU eviction; the SQLite batch write |
| `WK/src/boot.test.ts` | `APP_ENV=production` with `WORKER_FAULT` or `ENGINE=fake` → the process exits 1; the kick `fault` is ignored unless `APP_ENV=test` |
| `WEB/lib/data/review.test.ts` | the DTO from fixture rows parses with `ReviewDTO`; player cards from `game_players` (member, bot, legend); ETag stability; a non-player → `DataError not_found`; admin read |
| `WEB/lib/data/games.test.ts` | cursor encode/decode/tamper → 400; filter parsing (csv, unknown values dropped); `limit=0` counts; counts absent on page 2; the ETag from `gamesVersion` |
| `WEB/lib/data/share.test.ts` | the masking matrix (§11.3: member, bot, external and legend opponents × the toggle); the code alphabet and length; the reuse rule; expiry; the daily cap |
| `WEB/features/review/view-store.test.ts` | ask → tried → found / found_retry; ask → pickLine → reveal → line; Next on the last → Finish; URL sync |
| `WEB/features/review/fallback.test.ts` | a re-created interval function still stops after `stopAfterMs` (the start time read from `query.meta`, AP-20); off while the socket is live or the tab is hidden |
| `WEB/lib/billing/return-url.test.ts` | `/review/x`, `/games`, `/practice` allowed; `/analysis` removed at H4 |

### 12.2 API contract, authz and gates (`WEB/test/api/review.contract.test.ts`, `WEB/test/authz/review.authz.test.ts`; against `next start` + Docker Postgres in CI)

- **Contract:** every 2xx body parses with its `CT` schema; every error has the envelope, the right status for its code and a `requestId`; `gone` → 410; conflict reasons ∈ `CONFLICT_REASONS`.
- **Authz matrix**, table-driven, actors × routes (A1–A11, G1, PR1, the `/r/` page):

| Actor | Expected |
|---|---|
| signed out | 401 |
| user R (never a member) | 402 `trial_available` |
| user Q (trial used) | 402 `trial_used` |
| the leased `review-lapsed` persona | 402 `expired`; with `review-lapsed-read` on: 200 on GETs, 402 on writes |
| member B (not a player) | 404 |
| member A (player) | 2xx |
| admin (`E2E_ADMIN_EMAIL`) | 200 on GETs, 204 no-op on writes |

- **Idempotency:**
  - A3 twice → one job row, priority raised to 100;
  - A3 `regrade` on a DONE job → re-queued with `attempts = 0`;
  - A4 while RUNNING → 409; A4 on a terminal job → 410;
  - A7 twice → the same `completedAt`;
  - A9b four times → 202, 202, 202, then 410;
  - A10 twice with the same `Idempotency-Key` → the same code; with a new key and the same options → reuse (200); the 21st in a day → 429;
  - A11 DELETE twice → 204.
- **GET purity (AP-09):**
  - A1 for a `none` game creates **no** job row;
  - A9 creates no job;
  - A1/A2 on a QUEUED job older than 30 s, called 5 times in parallel → exactly 1 kick (a CAS assertion with a kick spy);
  - the P1 purity gate passes with the declared side effects only.
- **Caching:**
  - A1 with a matching `If-None-Match` → 304 with no body and exactly one SQL statement (a query-count assertion);
  - G1 304 with 0 statements beyond the viewer;
  - A8 `Cache-Control: private, no-store`;
  - the registry lint: no P3 per-user route declares a `max-age`;
  - the `/r/` page has no `Set-Cookie`, has `X-Robots-Tag` and the ISR headers;
  - the image route has `Vercel-Cache-Tag`.
- **Rate limits:** the 11th A3 in a minute → 429 with `Retry-After` and `retryAfterSec`.
- **Socket contract** (`WS/src/http/emit.analysis.int.test.ts`, an in-process server + `socket.io-client`):
  - `/internal/emit` with two `{userRef}` targets delivers to both players' sockets; a third user's socket receives nothing;
  - an unsigned or badly signed call → 401;
  - a `worker` caller emitting `entitlement:changed` → 403;
  - payloads validate against `CT/socket/analysis.ts`;
  - the static token is accepted only while `INTERNAL_TOKEN_COMPAT=1` (removed at H3).
- **Worker SQL** (`WK/src/queue/claim.int.test.ts`, Docker Postgres 17):
  - two workers claiming concurrently get distinct jobs (SKIP LOCKED);
  - the order is priority DESC, then `fairSeq`, then `runAt`: two users' 5-job batches interleave;
  - a job with `payload.v = 2` is not claimed by a `PAYLOAD_V_MAX = 1` build;
  - the enqueue upsert raises priority and never resurrects DONE (except regrade) or a terminal FAILED;
  - the checkpoint CTE keeps the heartbeat and arrays consistent;
  - the finish fragments: one `jobs` row per finish, even when the finish is replayed.
- **Worker telemetry** (`WK/src/telemetry.int.test.ts`, a fake PostHog `/batch`; TST):
  - `analysis_queued` exactly once per finished game, even when the finish is replayed;
  - `analysis_started{resumed_from_ply:20}` after the resume test;
  - `analysis_failed{retryable:true}` for attempts 1–3 and `{retryable:false}` on the 4th;
  - `analysis_ready.moments_w + moments_b` equals the DTO.
- **Index existence** (`DB/scripts/explain-hot.ts --check-indexes`): every index named in §6.4 exists in `pg_indexes` after `migrate deploy`.

### 12.3 End-to-end (Playwright; CI runs the worker from source with `ENGINE=fake`; on dev, the real engine)

The P1 fixtures are on for every spec:
- the console/hydration guard (TST X7);
- the telemetry sink with its schema check and PII guard (TST X6);
- personas from the registry (shared members only gain data; exact states are leased; TST X4);
- `BILLING_PAYWALL=on`.

**Per-game faults** are armed through the signed kick body (`fault`, `APP_ENV=test` only):
- `hold_queue`: do not claim until a `test` kick;
- `pause_at:writing:5000`;
- `fail_at_ply:12`;
- `stall_at_ply:20`.

| Spec (`WEB/e2e/specs/review/…`) | Projects | Steps → assertions |
|---|---|---|
| `review-walkthrough.spec.ts` `@smoke` | desktop-1440@100, iphone@100 | Seeded GAME → `summary`; the Coach tab shows 3 sentences → **Start Review**. <br>• m1: drag Nd5 → `tried` status text → play Qc1 → `found`; <br>• m2: **Reveal** → the green arrow → **Show Line** (3 SAN in `aria-live`); <br>• m3: pick Trade → feedback → **Finish Review** → complete `default` (3 cards). <br>Reload `/review/<ref>?m=2` → moment 2 restored. <br>**Telemetry:** `review_started{moments:3}`; `moment_attempt{idx:0, correct:false, attempt_no:1}` then `{correct:true, attempt_no:2}`; `moment_revealed{idx:1}`; `review_completed{found:1, found_retry:1, revealed:1}`; `telemetry.forbid("Nd5")`, `forbid("Qc1")`. Tags `@state:V3ReviewSummary.summary`, `@state:V3KeyMoments.moment` |
| `review-live.spec.ts` `@smoke` | desktop-1440@100 | `POST /api/games {mode:"bot"}` + `/complete` with a fixed 26-ply PGN (an API helper) → the game-over primary shows the disabled `Analysing · nn%` → done: the coach line visible + **See What the Coach Thinks** → the review `summary`. A second game: open from `/games` while it is `analysing`, badges increase, auto-advance within 60 s. The archive row flips "Analysing" → headline. `review_opened{source:"game_over"}`. Tags `@state:V3Game.over_analysing`, `@state:V3ReviewAnalysing.analysing` |
| `review-states-live.spec.ts` | desktop-1440@100 | the `hold_queue` fault → `analysing.queued` copy, then a release kick; `pause_at:writing` → "Finding your key moments…"; tags `@state:V3ReviewAnalysing.queued`, `.writing` |
| `review-failed-retry.spec.ts` | desktop-1440@100 | `fail_at_ply:12` (once) → the `failed` card "stopped at move 6" → **Retry Analysis** → the first progress event has `from = 10` (the last checkpoint) → `summary` |
| `review-terminal.spec.ts` | desktop-1440@100 | the leased `review-terminal` persona's game → no Retry button; the Report a Problem link |
| `review-clean.spec.ts` | desktop-1440@100, android@100 | the CLEAN Opera game → `clean` → **See Your Best Move** → the Moves tab at 16.Qb8+ with the Brilliant badge → **Done** → complete `nothing` |
| `review-share.spec.ts` | desktop-1440@100 | the share page → `generating` → `ready` → **Copy Link** (clipboard permission granted) → a new signed-out context opens `/r/<code>` → the board and badges are visible and the member opponent is masked → the owner unticks Show My Username → the public page and the new image show "A Replay Chess player" → **Stop Sharing** → the public page shows the `gone` view and the old image URL returns the generic card. `share_link_created` (server) exactly once across a replay with the same `Idempotency-Key` |
| `review-privacy.spec.ts` | desktop-1440@100 | member B → `/review/<A's ref>` → 404 page; B's API call → 404; user R → redirected to `/pricing?reason=…`; a signed-out API call → 401; B's socket receives no `analysis:*` for A's game (an event spy) |
| `review-lapsed.spec.ts` | desktop-1440@100 | the leased `review-lapsed` persona, with `review-lapsed-read` on → the review and archive render, Retry/Share → pricing; with it off → redirect |
| `review-shared-device.spec.ts` | desktop-1440@100 | user A opens a review, downloads the PGN, signs out; user B signs in in the same context and requests the same URLs → every response comes from the network (no HTTP-cache hit) and returns 404 for B (AP-04 gate) |
| `game-over-legend.spec.ts` | desktop-1440@100, iphone@100 | a seeded legend bot game completed through the API → `over_legend` rows "Matched 2 of 3", **Replay from Move 12** → `/practice?game=<ref>&ply=<n>` with the expected FEN; **Compare with Morphy** → compare. A live legend game (a socket fixture) → the legend block is filled after one A2. `@state:V3GameOverLegend.over_legend` |
| `games-archive.spec.ts` | desktop-1440@100, ipad-portrait@100, iphone@100 | 40 seeded rows: page 1 (30), then scroll → page 2 (no counts in its meta); ↑/↓ move `aria-activedescendant`; Enter → review; Filter → Losses + Rapid → the live "Show N Games" → apply → URL `?result=loss&tc=rapid`; Clear All; search "tal" → the filtered rows; the leased `review-empty` persona → `empty`; the Compare button only on the legend row; on the phone the filter is a bottom sheet |
| `legend-compare.spec.ts` | desktop-1440@100 | the seeded Opera legend game → 4 tabs via keys 1–4; Explanation: play/pause the mocked audio; abort the audio route → the `audio_failed` banner; the Your Moves table marks; hovering the ⋯ "Compare" item on the review creates no job (a DB check); the `pending_evals` variant → exactly one A9b POST → `compare:ready` → evals shown; **Practice from Move 12** → `/practice` with the expected FEN |
| `practice.spec.ts` | desktop-1440@100, iphone@100 | a throttled WASM route → `engine_loading` with % → `default`; play e4 → the engine replies; **Take Back**; **Reset**; abort the WASM → `engine_failed` + Retry; `context.setOffline(true)` after load → `offline`, and play continues; `engine_init{ok:true}` |
| `how-we-grade.spec.ts` (`@public`) | desktop-1440@100, iphone@100 | the tabs; the `#blunder` hash; the formula numbers equal the `CA/src/version.ts` and `accuracy.ts` constants (imported in the spec); **Pricing** in the nav → `/pricing` (flow edge E2) |
| `analysis-redirects.spec.ts` | desktop-1440@100 | `/analysis/<ref>` → 308 `/review/<ref>`; a legend game → `/review/<ref>/legend`; `/review` → `/games` |
| `review-keyboard.spec.ts` | desktop-1440@100 | the `?` sheet lists the Review group; ←/→/Home/End, Space, F, M/C, Shift+→, L, S act as specified; nothing fires while typing in an input |

**Device × zoom layout suite** (`WEB/e2e/devices/layout/review.layout.spec.ts`; tiered per TST X9):
- **PR:** 4 projects (`desktop-1440@100`, `desktop-1280@125`, `iphone@100`, `ipad-portrait@100`) for the changed areas.
- **Nightly:** all 40 projects of `playwright.devices.config.ts`, against `next start` in CI, never the deployed dev URL (F-VER-3).
- **The one-viewport assertion** (ARCH §5.5):
  - the board inside the viewport, `scrollHeight ≤ innerHeight + 1`;
  - both player bars and the primary control in the viewport;
  - squares ≥ 220/8 px, controls ≥ 44 px;
  - the tab bar hidden on immersive routes;
  - no toast over the board.
- **It runs on**, each also with `stress=1` at `@150`:
  - `/dev/ui/review?state=` analysing, queued, writing, failed, terminal, summary, moves, clean, and moment with `phase` ask, tried, reveal, line;
  - `/dev/ui/review/complete?state=` default, nothing, partial (no board: it asserts no document scroll and the primary in view);
  - `/dev/ui/review/share?state=` generating, ready;
  - `/dev/ui/compare?tab=` each of the 4 tabs;
  - `/dev/ui/practice?state=` each of the 4 states;
  - `/dev/ui/games?state=` default, filters_open, empty, loading, error (the list scrolls inside its panel only);
  - `/dev/ui/game-over?slot=` analysing, done, legend;
  - `/how-we-grade`;
  - `/r/<seeded code>`.
- **Real-route layer** (`e2e/devices/layout/routes.real.ts`, TST X9): P3 adds `/review/<GAME ref>`, `/games` and `/review/<ref>/legend`, signed in as member A, on `desktop-1440@100/150`, `iphone@100/125` and `ipad-portrait@100`.

**Visual regression** (P1's `toHaveScreenshot` setup, nightly, TST X10): summary, moment reveal, clean, complete, share ready, archive default, compare Explanation, practice default, game-over done and legend. Desktop-1440 and iPhone, light and dark, at 100 %.

**a11y:** `@axe-core/playwright` on every screen above; zero serious or critical violations.

**State coverage** (TST X8): the P3 rows of `docs/qa/design-states.json` have no "missing" entries. Demo-only entries carry a reason in `design-states.overrides.json`: for example, `V3ReviewFailed.failed` real-data coverage comes from the fault spec, and the device boards' states come from demo routes.

### 12.4 Chess-correctness fixtures (`CA/fixtures/`, `FX/grades/`; ARCH §5.9, TST X13)

| Corpus | Content | Assertion |
|---|---|---|
| `labels/design-mock.ts` | `GAME` (54 plies) and `CLEAN` (33 plies) from the design files, with expected labels and the documented differences (§8.4) | exact labels |
| `labels/edge/*.json` | thresholds at 5/10/15; mate created/lost/delayed; a forced recapture; the end of book; a FEN start; a stalemate final ply; a threefold final ply; a promotion inside a key moment | exact labels / moments |
| `FX/grades/positions.jsonl` | ≥ 80 single positions with expected grades (§8.4 list) | exact labels (pure, stored evals) |
| `oracle/*.json` | 30 Lichess-analysed games (evals, judgements, accuracy, division) | ±1 accuracy; ≥ 90 % judgement agreement |
| `golden/*.json` | 10 games analysed by the real arm64 Stockfish 18 with `sf18-v1`, generated by `WK/scripts/make-golden.ts` and committed | The nightly re-run on `ubuntu-24.04-arm` gives a byte-identical `GameAnalysis` + `PlayerReview.content` **under the determinism rules below**. Regenerated only on a profile or `GRADING_VERSION` bump. |
| `legend/*.json` | Opera, KT, the opponent-left case | exact facts |
| `rules/` (from P2's `FX`) | FEN-start numbering, Black to move first, castling and en passant | the SAN/UCI round trip in the DTO and PGN |

**Determinism rules** (TST X13):
- **Goldens** run with `EVAL_CACHE=off`, a **fresh engine process per game**, `Threads 1`, and no resume. "Byte-identical" is claimed only under those conditions.
- **Label-stability job** (`nightly.yml` → `p3-label-stability`): the same 10 games, run with the cache warm and with a forced crash and resume at ply 20.
  - Labels must be identical on ≥ 98 % of plies and on every key moment, and accuracy within ±0.5.
  - On failure, graded positions bypass the cache (P3-D10), and the decision is recorded in `CA/README.md`.
- **Eval provenance** (`CA/scripts/eval-provenance.ts`, nightly on arm64): each stored eval in `positions.jsonl`, `labels/` and `golden/` is within ±30 cp of Stockfish 18 `sf18-v1`, or gives the same mate distance. This stops the corpora drifting from the real engine.

### 12.5 Regression of earlier phases

- **The whole suite** (TST X11): the full main suite plus the full devices suite on the final SHA, with the paywall on, in CI nightly, plus one run against the dev URL. The **flags-off** project runs the P1/P2 `@smoke` specs with `review-v3` and `review-share` off.
- **P2 specs keep passing with the finish fragments:**
  - bot game, friend game, rematch;
  - abort (no job; `analysisStatus=SKIPPED`);
  - a socket restart mid-game (no duplicate job: the finish guard plus the `dedupeKey`);
  - the P2 golden transcripts replayed with the hook active;
  - `finish-idempotent.int.test.ts` now also asserts one `jobs` row and one `gamesVersion` bump per member.
- **P1:**
  - the `data-layer` spec: no `/api/me` request on a hard load of `/review/<ref>`;
  - the shell: the nav shows Review (desktop sidebar, rail, tab bar) with `review-v3` on and hides it with the flag off; the `/dev/ui/shell` snapshots are updated.
- **Paywall specs:** `paid-only.spec.ts:42` and `membership.spec.ts:52,70` now probe `/api/review/<ref>` (401/402/404).
- **k6 `ws-ramp.ts` with the worker idle:** the lag is unchanged from P2's baseline.
- **Legacy:** with `review-v3` off, `/analysis/<ref>` still works until H3, and the redirects are in place until H4 deletes the code.
- **Every defect** found in the owner test or the manual pass gets a failing test first, named `regression: <slug>` (TST X14).

### 12.6 Manual checklist on the dev site (ego-browser, then a real iPhone and a real Android phone)

Results go into `REPO/docs/qa/phase-03-signoff.md` (TST X15). The record holds:
- the SHA, the Vercel deployment id and the OCI image tags;
- each T-row with pass/fail and a screenshot path;
- the devices, browsers and zoom levels used;
- the state-coverage table;
- the `error-window.ts` output;
- the PostHog live-view result;
- the k6 JSON links;
- the defects with their regression tests.

The test window runs from the last dev deploy of the phase to sign-off, and is at least **48 h** (stricter than the ≥ 24 h minimum).

1. T1–T22 from §1.
2. The badge art matches the owner's icons (B8) at 18/22/34 % sizes, in light and dark.
3. iOS Safari: narration starts on the first tap, the speed chip works, and it stops on navigation. Android Chrome: the same.
4. PWA standalone on iPhone: review, share (the `navigator.share` sheet), the Back gesture.
5. Slow 3G (Chrome throttling) on `/review/<ref>`: the board appears from the HTML before JS, with no layout shift on hydration.
6. Two tabs on the same review: make progress in one and reload the other → `momentIndex` restored. A cross-tab bank toggle (P5) is n/a.
7. Kill the socket (`docker compose stop websocket` on dev) during analysis → the fallback poller advances the bar (2 → 4 → 8 → 15 s) and stops after 180 s → restart → no duplicate events.
8. **Neon suspend resilience** (FEA F-OCI-4): with the owner's confirmation, suspend the dev compute (Neon console or the MCP `suspend_postgres_endpoint`) while a 60-ply game is between checkpoints. The job completes; `worker.db.statements` shows at most one retry.
9. `cat /sys/fs/cgroup/worker.slice/worker-idle.slice/cpu.idle` on the dev box → `1`; `docker inspect analysis-worker` shows `CgroupParent=worker-idle.slice`.
10. Close every tab that was opened (`task.finish({keep: []})`, CLAUDE.md).

### 12.7 Performance checks (results written as JSON to `REPO/perf/results/p03-<scenario>-<sha>.json`, TST X18)

Every check below waits for the AP-01 dev-project split (§2.3). The k6 thresholds use `abortOnFail` for the hard SLOs.

| Check | Tool | Pass |
|---|---|---|
| Review read | `perf/k6/src/scenarios/review-read.ts`: 50 VUs × 5 min over 40 seeded reviews, 70 % revalidations | A1 server p95 < 160 ms; a 304 share ≥ 60 %; 0 errors |
| Archive | `perf/k6/src/scenarios/games-list.ts`: 30 VUs, the 2,000-row user, random filters, 3 pages deep | p95 < 160 ms; the 304 rate on repeat pages ≥ 80 % |
| Worker throughput | `WK/scripts/bench.ts` on the dev VM: enqueue 60 fixture games at `BACKLOG` | ≥ 60 games/hour; the cache hit ratio reported; `worker.engine.nps` recorded in the profile notes; 0 per-game emits (banding) |
| Co-location | `ws-ramp.ts` 250 → 1,000 sockets with the worker saturated by `bench.ts` | socket loop lag p99 < 50 ms (the P3-D8 fallback otherwise) |
| Query plans | `DB/scripts/explain-hot.ts` (the dev branch; CI on Docker Postgres with the perf seed) runs `EXPLAIN (ANALYZE, BUFFERS)` for A1, the A1/A2 probe, G1 pages 1 and 3, the counts, the claim, the reaper and the kick CAS | No Seq Scan on `games`, `game_players` or `jobs`; **no Sort on `game_players`**; buffers under the §9.2–9.3 targets; every §6.4 index present; the output kept as a CI artifact |
| Bundles | P1's CI bundle report | the §9.6 budgets; no `ZodError` in the P3 route chunks |
| Neon idle | the timer audit test + the Neon consumption API report over 3 quiet days after the deploy | ≤ 1 compute start a day attributable to the worker |

### 12.8 Post-deploy smoke on the dev box (the real engine on the real box, TST)

`deploy-oci.yml`, after `docker compose up -d` on the dev box:
1. Wait for the `analysis-worker` Docker healthcheck (`/ready` 200) within 120 s. A failure fails the job.
2. `docker compose exec analysis-worker node dist/scripts/smoke.js`. The script:
   - resets the seeded `smoke-26` game: it deletes its `game_analyses`/`player_reviews` rows and its job, and sets `analysisStatus=NONE`;
   - enqueues it at `USER_OPENED` with `reason:"smoke"`;
   - sends the running worker a signed kick on `localhost:3003`, then polls the DB every 5 s, ≤ 24 polls;
   - asserts `DONE`, `gradedPlies = 26`, non-zero judgements, a `player_reviews` row, and `readyMs` null (smoke runs are excluded from the SLO data).
3. The `post-deploy-dev.yml` job then checks that the dev PostHog project received `analysis_ready{regrade:false}` for the smoke game within 120 s (T22).

---

## 13. Work breakdown

**30.75 dev-days.** One developer with parallel Claude sessions.
- Each work package owns its files outright, and nobody else edits them during P3.
- Shared files are edited only by the package named in the "Shared-file locks" table, and only additively.
- If P1 adopted the registries-as-directories fix (FEA §7), most "shared" edits become new files (`keys/review.ts`, `flags/registry/p3.ts`, `redirects/p3.mjs`, `robots-rules/p3.ts`, `realtime/handlers/analysis.ts`, `cron/tasks/worker-alive.ts`) and the locks below shrink to barrel lines.

A 20 % buffer line (≈ 6 days) is recommended by FEA §8 and is not in the 30.75. That is an owner decision (P3-Q15).

### 13.1 Packages

| WP | Days | Owns (creates or edits) | Depends on |
|---|---|---|---|
| **A. Grading library** | 5.0 | `CA/**` (package.json, tsconfig, `src/**`, `fixtures/**`, `scripts/{fetch-oracle,eval-provenance}.ts`, `NOTICE.md`, `CLEANROOM.md`, `README.md`), `FX/grades/**` | none (pure) |
| **B. Schema and data** | 1.75 | `DB/prisma/schema.prisma` (M3 blocks only); `DB/prisma/migrations/<ts>_m3_analysis_review/**`; `DB/prisma/protected-indexes.txt` (P3 lines); `DB/src/json/{review,legend,share}.ts`; `DB/src/jobs.ts`; `DB/scripts/backfill/*`; `DB/scripts/roles/*.sql`; `DB/scripts/explain-hot.ts`; `DB/seed/{review,perf-archive,smoke}.ts` | A (the codec for the seed only) |
| **C. Worker and deploy** | 6.25 | `WK/**` (src, scripts, Dockerfile, package.json, NOTICE, README), `REPO/deploy/oci/{docker-compose.yml,Caddyfile,setup-server.sh,.env.example}`, `REPO/.github/workflows/deploy-oci.yml` | A (API), B (tables), D1b (auth helper), P2 (`/internal/emit`) |
| **D. Contracts, services, routes** | 4.0 | `CT/http/{review,games,share,practice,legend}.ts`; `CT/http/codes.ts` (`gone` + conflict reasons); `CT/socket/analysis.ts`; `CT/internal/{jobs,kick,auth}.ts`; `WEB/lib/data/*` (P3 files); `WEB/lib/services/analysis/*`; `WEB/app/api/review/**`, `WEB/app/api/share/**`, `WEB/app/api/me/games/route.ts`, `WEB/app/api/practice/context/route.ts`; `WEB/lib/api/queries/{review,games}.ts`; `WEB/lib/api/mutations/{review,share}.ts`; `WEB/lib/routes.ts`; `WEB/lib/cron/tasks/worker-alive.ts`; `packages/analytics/src/events/review.ts`; `WEB/test/{api,authz}/review.*.test.ts` | A, B; P1 |
| **E. P2 integration** | 1.25 | `DB/src/live/finish.fragments.p3.ts` + one import line in P2's `finish.ts`; P2's abort statement (one SET + the bump); `WEB/lib/games/complete-bot-game.server.ts` (hook lines only); `CT/socket/registry.ts` (P3 entries); `CT/socket/game.ts` (`game:result.review`); `WS` `/internal/emit` verifier + allow-list + `GET /internal/load`; `WEB/features/review/game-over/**`; P2's `GameOverCard.tsx` (slot mount, ≤ 12 lines); `WS/src/http/emit.analysis.int.test.ts` | B (`DB/src/jobs.ts`), D (`kick`, contracts, auth), P2 |
| **F. Review UI** | 5.75 | `WEB/app/(app)/(immersive)/review/[ref]/{page,layout,loading}.tsx`, `…/complete/page.tsx`, `…/share/page.tsx`, `WEB/features/review/**` (except `game-over/`), `WEB/features/share/**`, `WEB/lib/realtime/handlers/analysis.ts`, `WEB/app/dev/ui/{review,game-over}/**` | D (queries, DTOs), A (fixtures); the P1 kit, the P2 Board |
| **G. Around-review screens** | 3.75 | `WEB/app/(app)/games/**`, `WEB/features/games/**`, `WEB/app/(app)/(immersive)/review/[ref]/legend/**`, `WEB/features/legend-compare/**` (including the moved `NarrationDisplay`/`SegmentList`/`AudioControls`/`ExplanationView`), `WEB/app/(app)/(immersive)/practice/**`, `WEB/features/practice/**`, `WEB/app/(marketing)/how-we-grade/page.tsx`, `WEB/app/r/[code]/{page,og/route}.tsx`, `WEB/lib/og/theme.ts`, `WEB/app/og/route.tsx` (import the theme), `WEB/app/dev/ui/{games,compare,practice}/**` | D, A; P1, P2 (EngineProvider) |
| **H. Tests, perf, cut-over** | 3.0 | `WEB/e2e/specs/review/**`, `WEB/e2e/devices/layout/review.layout.spec.ts`, the P3 lines of `routes.real.ts`, `WEB/e2e/specs/{paid-only,membership}.spec.ts` (the probe lines), the P3 persona writers in `scripts/dev/personas.ts`, the P3 rows of `docs/qa/design-states.overrides.json`, `REPO/perf/k6/src/scenarios/{review-read,games-list}.ts`, the P3 jobs in `.github/workflows/{ci,nightly,post-deploy-dev}.yml`, the H3/H4 cut-over (every §3.1 file, `WEB/app/analysis/[ref]/route.ts`, `WEB/lib/hooks/index.ts`, `GameHistory.tsx`, `Breadcrumbs.tsx`), `REPO/docs/implementation-plan.md` (pointer), `REPO/docs/qa/phase-03-signoff.md`, the PostHog dashboards | all |

**Where the +2.75 days over ALLOC go:**
- A +0.5: the corpus, the clean-room note, regrade.
- B +0.25: the new columns and grant scripts.
- C +0.75: recurring/planner, HMAC verify, banding/batch, the cgroup slice, smoke.
- D +0.5: the HMAC helper, `etagProbe`, the cron task.
- E −0.25: no `rooms[]` edit and no socket-side facts.
- G +0.25: the image route + purge.
- H +0.75: telemetry assertions, the determinism jobs, the deletion split, sign-off.

**Shared-file locks** (one owner each for the length of P3; the others request changes from it):

| File | Owner WP | Others' needs |
|---|---|---|
| `DB/prisma/schema.prisma` | B | — |
| `WEB/lib/api/keys` (or `keys.ts`) | D | F, G, E use the keys |
| `WEB/lib/flags` registry (flag names) | D | — |
| `WEB/middleware.ts` route classes (public `/r/*`, `/how-we-grade`), `WEB/next.config.js` (`/review` redirect, the `/r` header rule), `WEB/app/robots.ts`, `WEB/lib/billing/return-url.ts` (+ test) | D | — |
| `WEB/lib/api/route.ts` (`etagProbe` hook, ≤ 15 lines) and `WEB/lib/auth/viewer.ts` (`VIEWER_SELECT += gamesVersion`) | D, coordinated with P1's owner | — |
| `WEB/lib/api/rate-limits.ts` (bucket table) | D | — |
| P1's nav config (`WEB/components/shell/nav-config.ts`) and shortcuts registry entries | F | G registers its shortcuts through F's helper `registerReviewShortcuts()`, or adds its own group in its own file |
| `CT/socket/registry.ts`, `CT/socket/game.ts`, `DB/src/live/finish.ts` (one import line) | E | — |
| `CT/internal/auth.ts` | D (P2 owns the file; P3 adds the HMAC mode) | C, E use it |
| `.github/workflows/deploy-oci.yml` | C | H adds nothing here |
| `.github/workflows/{ci,nightly,post-deploy-dev}.yml` (P1 creates them) | H | C provides the worker run command and the smoke script |
| `scripts/dev/personas.ts` (P1) | H | — |

### 13.2 Ordered tasks with acceptance criteria

| # | WP | Task | Days | Acceptance |
|---|---|---|---|---|
| A1 | A | Scaffold `chess-analysis` (ESM, `exports`, `node:test` script), `codec.ts`, `version.ts`, `mergePlies` | 0.5 | `pnpm --filter chess-analysis test` green; added to `transpilePackages`; the codec property test passes |
| A2 | A | `winpct.ts`, `accuracy.ts`, `fetch-oracle.ts` + 30 oracle games committed | 0.75 | The reference table ±0.01; the oracle ±1 on 30/30 (the `[V]` items resolved and written down in `accuracy.ts`) |
| A3 | A | Verify the scalachess licence (V8); `divider.ts` port + attribution | 0.5 | The oracle divisions within ±1 ply on ≥ 28/30; the rest explained |
| A4 | A | `classify.ts` (+ SEE, material, the sacrifice check, the mate rules, GREAT from `second`) and the `labels/` fixtures | 1.25 | `classify.test.ts` green, including the full GAME/CLEAN mock with the documented differences |
| A5 | A | `moments.ts`, `intent.ts`, `text/{summary,phase,ask,why,headline,reasons,clean,coachline}.ts` | 1.0 | GAME → [32, 36, 40]; every template SAN is legal; the snapshots (including the coach lines) reviewed by the owner (copy) |
| A6 | A | `legend/{compare,slice,summary}.ts`, `pgn.ts`, `book.ts` (the book set builder) | 0.5 | The legend fixtures exact; the PGN re-parses; the book set from the seed `openings` has ≥ 25k EPDs |
| A7 | A | `FX/grades/positions.jsonl` (≥ 80 lines) + `classify.positions.test.ts`; `regrade.ts` + test; `CLEANROOM.md`; the licence-check CI step; `eval-provenance.ts` | 0.5 | The corpus green; regrade equals a fresh grading; `license-checker` green |
| B1 | B | Schema M3 + the migration SQL (guards, raw SQL, the `review_progress_merge` function, the new columns), the protected-index lines, the role scripts | 1.0 | `migrate diff` is clean after apply on local Docker; the CI drift gate and index check green; `migrate deploy` on the Neon dev branch (owner informed) |
| B2 | B | JSON zod files + `DB/src/jobs.ts` (`enqueueAnalysis`, `enqueueJob`, the re-exported `JOB_PRIORITY`) | 0.25 | `jobs.int.test.ts`: the enqueue upsert semantics (priority raise, regrade reset, terminal untouched) |
| B3 | B | Backfills + the review seed + the perf-archive seed + the smoke seed + the P3 persona writers (with H) | 0.5 | The seeds load on the dev branch; `/dev/ui` and the e2e fixtures resolve; the backfills are idempotent (run twice = no change); **the backfill runs only after AP-01** |
| C1 | C | Worker Dockerfile (a native SF18 `armv8-dotprod` build, `NOTICE`), `stockfish bench` + a 60-ply sample on the dev VM; **freeze `sf18-v1`** | 0.75 | The bench numbers recorded in `WK/README.md`; the profile decision (120k or 80k) committed before any golden; the image builds in CI in ≤ 10 min |
| C2 | C | Queue: claim (`fairSeq`, payload v), reaper (boot + drain end), scheduler (`nextRunAt`), `recurring/` + `DAILY_PLAN`, the kick server with `verifyInternal`, health/ready/metrics, the boot guards | 1.25 | `claim.int`, `reaper`, `scheduler` (including the timer audit), `recurring` and `boot` tests green; two workers never double-claim |
| C3 | C | Engine driver + pool (1 process) + nice + the lag pause | 0.75 | `uci.test` green; a restart after a crash works; the lag pause holds with a fake `/internal/load` |
| C4 | C | Eval cache E1/E2 (with `EVAL_CACHE=off`) + `seed-evalcache.ts` + the R2 seed upload | 0.75 | `cache.test` green; the seed file built and uploaded; the first boot downloads it |
| C5 | C | `ANALYZE_GAME` pipeline: replay, pass 1 (+`second`), classify, checkpoint (returning priority), pass 2, moments and text (A), the final batch (+ the extension directory, `readyMs`, `gamesVersion`), banded events + `analysis:batch`, failures, faults, the regrade path, telemetry | 1.75 | `pipeline`, `resume`, `failure`, `telemetry.int` tests green; on dev a bot game goes queued → done with all rows written in ≤ 10 statements |
| C6 | C | `LEGEND_COMPARE`, the `HOUSEKEEPING` slices (including the move of P1's sweep) | 0.25 | Legend READY + `compare:ready`; housekeeping prunes (verified with seeded old rows); the next HOUSEKEEPING row is planned |
| C7 | C | Compose service (profile `worker`, `cgroup_parent: worker-idle.slice`, caps, volume, healthcheck, `stop_grace_period`); `setup-server.sh` slice; the Caddy route + the unsigned pre-check; the deploy workflow (build + the dev bundle + the healthcheck wait + smoke); env files; Sentry/PostHog wiring | 0.75 | A push to `dev` deploys the worker and the smoke passes (T22); `curl -X POST https://ws-dev…/internal/analysis/kick` unsigned → 401 from Caddy; a bad signature → 401 from Node; signed → 202; `cpu.idle` = 1; a push to `main` does **not** start the worker on prod |
| D1 | D | Contracts (`CT/http/*`, `CT/socket/analysis.ts`, `CT/internal/{jobs,kick}`, `gone`, conflict reasons), the event registry entries | 0.5 | Types compile across web, socket and worker |
| D1b | D | `CT/internal/auth.ts` HMAC sign/verify (or adopt P2's if it already has it) | 0.25 | `auth.test.ts` green |
| D2 | D | The `probeReview`/`getReview`/`getReviewStatus` DAL; A1/A2/A3/A4; `kickWorker`; `healKick`; the `etagProbe` hook | 1.0 | The contract + authz tests for A1–A4 green; the 304 path is one statement; the GET-purity tests green |
| D3 | D | A5/A6/A7/A8; A9/A9b (lazy facts, compute with attempts) | 0.75 | Contract tests; the progress merges are monotonic; A9b's 4th call → 410 |
| D4 | D | Share DAL + A10/A11 (the daily cap, reuse, purge calls) + `getPublicShare` | 0.5 | The masking matrix test; reuse; the cap; `revalidateTag` and `invalidateByTag` called |
| D5 | D | G1 + PR1 + the query/mutation hooks + keys + flags + the routing files (middleware, robots, return-url, next.config redirect + header) + `VIEWER_SELECT` | 0.75 | `games.test`; the G1 EXPLAIN within target on the perf seed; the G1 304 with 0 extra statements |
| D6 | D | `worker-alive` cron task; the registry declarations of side effects and cache tiers | 0.25 | The cron task alerts when the worker is down (a test with a fake URL); the registry lint green |
| E1 | E | The finish CTE fragments + the abort SET; bot `complete` hooks (enqueue, legend facts, `gamesVersion`, the response fields); kick after commit | 0.5 | Socket integration: one job per finish (a replayed finish too); bot complete → job + facts; the P2 golden transcripts unchanged |
| E2 | E | `/internal/emit` verifier + caller allow-list + the compat flag; `GET /internal/load`; the registry entries | 0.25 | `emit.analysis.int.test` green |
| E3 | E | `useAnalysisProgress`, the game-over slots (disabled analysing primary, coach line, legend block with Replay), `game:result.review` | 0.5 | T1 and T20 pass on dev; `over_legend` matches the board copy |
| F1 | F | `ReviewScreen` layouts (desktop, iPad L, iPad P, phone), board column, footers, menu | 1.25 | The layout spec green on the PR projects for `summary` |
| F2 | F | Analysing, failed and skipped states; the delta merge; the per-query fallback poller; stall detection; retry; the A3-on-mount enqueue | 0.75 | `review-live`, `review-states-live`, `review-failed-retry` green on CI |
| F3 | F | Summary: CoachLine + narration, EvalGraph, the counts table, the move list/strip, PGN download | 1.25 | `review-walkthrough` (summary part) green; axe clean |
| F4 | F | Moments: stepper, local correctness, chips, reveal, the line animation, progress sync | 1.25 | `review-walkthrough` green; a reload restores the moment |
| F5 | F | Complete page | 0.5 | `review-clean` + the walkthrough complete assertions |
| F6 | F | Share page + preview card | 0.5 | `review-share` green up to the public page |
| F7 | F | Demo routes for every state (including `stress=1` and `/dev/ui/game-over`); keyboard; a11y polish | 0.25 | Every enum value reachable; `review-keyboard` green |
| G1 | G | `/games`: list, filters, search, aside, the phone sheet | 1.25 | `games-archive` green on 3 projects; the layout spec green |
| G2 | G | Compare (the moved narration components, tabs, tables, stepper, the A9b-on-mount compute) | 0.75 | `legend-compare` green |
| G3 | G | Practice | 0.5 | `practice` green |
| G4 | G | How we grade (with the Pricing nav and the attribution line) | 0.25 | `how-we-grade` green |
| G5 | G | `/r/[code]` page (ISR, negative cache, no `headers()`), the image route (headers, tag, the generic fallback), the purge; verify `invalidateByTag` on Hobby [V] | 1.0 | The public half of `review-share` green; Lighthouse ≥ 95 on `/r/` |
| H1 | H | E2E specs (with the telemetry assertions, state tags, personas, the shared-device spec) + the device layout spec (tiered, stress) + visual baselines | 1.25 | All §12.3 specs green on CI; the nightly matrix green; state coverage shows no P3 "missing" |
| H2 | H | k6 scenarios (JSON results), `explain-hot`, the co-location run, the bundle check; the nightly `p3-goldens`, `p3-label-stability` and `p3-eval-provenance` jobs; the post-deploy PostHog check | 0.75 | §12.7 passes, or a decision is logged (the P3-D8 fallback); each nightly job has passed one night |
| H3 | H | The parity check (§15) → switch `/analysis/*` to the R1 redirect route; update the links; sign web's emits and turn `INTERNAL_TOKEN_COMPAT` off on dev | 0.5 | `analysis-redirects` green; the owner script T1–T22 passes |
| H4 | H | ≥ 1 dev release and ≥ 3 days after H3: delete the legacy code (§3.1); the grep gate; the docs pointer; the PostHog dashboards; the sign-off record | 0.5 | No `/analysis` import is left (grep gate); `check-test-globs` green; `phase-03-signoff.md` committed |

**Total:** A 5.0 + B 1.75 + C 6.25 + D 4.0 + E 1.25 + F 5.75 + G 3.75 + H 3.0 = **30.75 dev-days**.

### 13.3 Schedule (parallel streams; critical path A → C5 → E1 → H3 → H4)

```
Week 1  A1 A2 A3 │ B1 B2 │ C1 (bench gate) C2 │ D1 D1b │ F1 (against fixtures via /dev/ui)
Week 2  A4 A5 A6 A7 │ B3 │ C3 C4 │ D2 D3 │ F2 F3 │ G1
Week 3  C5 C6 C7 │ D4 D5 D6 │ E1 E2 E3 │ F4 F5 F6 │ G2 G3 G4
Week 4  G5 │ F7 │ H1 H2 │ owner test on dev, fixes │ H3 switch (redirects on, compat off)
Week 5  (≥ 3 days after H3) H4 delete legacy · sign-off record · 48 h test window closes
```

A day-1 interface check with P2's merged code confirms the P2 names this spec relies on:
- the `finishGame()` fragment API;
- the `IdempotencyKey` model;
- `games.source`;
- the socket DB role name;
- `CT/internal/auth.ts`.

It runs before B1 and E1. The same day, check the P1 tooling in §2.3 and the AP-01 split.

---

## 14. Risks, open questions, decisions needed, rollback

### 14.1 Risks

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R1 | Engine throughput on 0.75 of a shared A1 core misses "badges in about 10 s" | medium / medium | The C1 bench gate; the 80k fallback; live prewarm (§9.7); bringing the P13 worker VM forward (P3-Q4). The copy says "10 seconds" only if dev meets it (P3-Q5). |
| R2 | Stockfish load raises socket clock jitter | low / high | The `cpu.idle` slice + the 0.75 cap + the lag pause; the co-location k6 gate; the fallback to `cpus: 0.5` |
| R3 | `cgroup_parent` with the systemd cgroup driver, or `CPUWeight=idle`, is unavailable on the OCI image (FEA V1) | low / medium | Day-1 check: `cat /sys/fs/cgroup/worker.slice/worker-idle.slice/cpu.idle` and `cpu.weight`. If it is unavailable: `cpu_shares: 64` (weight 3 vs 39), the cap and a heavier lag pause (60 ms → 20 ms), re-tested with k6. |
| R4 | P2 shipped something differently from §2.3 (fragment API, `source`, role name, auth helper) | medium / low | The day-1 interface check; E edits are hook lines only; `ADD COLUMN IF NOT EXISTS` fallbacks |
| R5 | The Neon HTTP driver with a non-owner role, or `sql.transaction` semantics, differ from the assumptions | low / medium | The C2 integration test against the dev branch on day 2; fallback to `pg` over the pooled TCP URL with one multi-CTE statement (still 1 RTT), with P2's pool rules (`pool.on('error')`, `idleTimeoutMillis`, transient retry) |
| R6 | The `better-sqlite3` native build on arm64 | low / low | `node:24-bookworm-slim` with prebuilt linux-arm64 binaries; fallback to `node:sqlite` |
| R7 | The accuracy oracle disagrees (the `[V]` series start and the harmonic mean with 0) | medium / low | A2 resolves it before the freeze. A documented deviation is acceptable if it is within ±1 on ≥ 28/30. |
| R8 | Template text feels plainer than the design's LLM-like copy | high / medium | The owner reviews the snapshots in A5; P7 replaces it; the facts-based "threat" sentence keeps the asks specific |
| R9 | The inaccuracy fill makes "3 moments" too common, or leaves too few clean games | medium / low | `FILL_MIN_LOSS = 7` is one constant; measure `moments_*` and `clean_*` in `analysis_ready`, then tune before P5 |
| R10 | Web Speech voice quality and availability vary by device | high / low | The controls are hidden when unavailable; P7/P10 can add neural TTS (rct-a Q6) |
| R11 | A public share leaks an opponent's identity | medium / medium | The §11.3 masking; the image purge; owner decision P3-Q2 before `review-share` goes beyond the owner |
| R12 | Opening table data errors break Book (e.g. the Immortal Game seed PGN, play-b PB8) | medium / low | `opening-epd.ts` logs mismatches and does not write them; the book set is built from replayed PGNs only |
| R13 | Legacy dev games without `moves` (pre-P2 data) | medium / low | P2's backfill fills `moves`; the worker SKIPs games with empty `moves` |
| R14 | `docker kill` counts as a manual stop for `restart: unless-stopped`, so T11 does not auto-restart | high / low | T11 uses `docker exec analysis-worker kill -9 1` (a process crash triggers the restart policy) |
| R15 | Distributing the Stockfish image triggers GPL obligations | low / medium | Keep the GHCR package private (P3-Q9); `WK/NOTICE` is ready if that changes |
| R16 | Vercel Hobby is non-commercial and this is a paid product | known | Owner decision before charging (ALLOC §1.5, P13 D17) |
| R17 | An ISR `/r/` copy or a CDN image outlives a revocation | low / medium | `revalidateTag` + `invalidateByTag` on PATCH/DELETE; the 1 h page revalidate; the 1 h browser TTL on the image; the generic-card fallback |
| R18 | The HMAC switch breaks callers that still send the static token or `{room}` bodies (P4/P5/P9/P10 docs) | medium / medium | `INTERNAL_TOKEN_COMPAT=1` until H3; the Appendix A list of docs to update; `ws.internal.auth_fail{caller}` alerting |
| R19 | Eval-cache hits make labels depend on search order (TST X13) | medium / low | Goldens with the cache off; the nightly label-stability job; the bypass fallback (P3-D10) |
| R20 | The AP-01 dev-project split is late, which blocks the backfill, k6 and the bench | medium / medium | Escalate on day 1. The bench (C1) needs no Neon. k6 and the backfill move to week 4, or the owner waives (P3-Q19). |
| R21 | `invalidateByTag` (Vercel CDN tag purge) is not available on Hobby, or has another name | medium / low | Verified in G5. The fallback is the `?v=` bump on every edit, the 1 h browser TTL and the generic card on revoke (the old URL is never reused). |
| R22 | P1's shared test tooling (nightly, sink, personas, hook registry) lands late | medium / medium | WP-H adds minimal stand-ins in P3's own files and moves them to P1's on arrival |
| R23 | Following the design's disabled "Analysing" CTA lengthens the path to a live analysing view (T2) | low / low | P3-D29; `/games` shows "Analysing" rows; an owner decision can re-enable the CTA (P3-Q18) |

### 14.2 Open questions and owner decisions (needed before the tasks noted)

| # | Decision | Proposal | Needed before |
|---|---|---|---|
| P3-Q1 | B26: can lapsed members read past reviews and the archive? (COV C-21) | Default **no** (hard redirect); the flag `review-lapsed-read` is ready if you say yes | **Before P3 starts** |
| P3-Q2 | Public share scope: is a public `/r/` link allowed under "analysis private to players"? Opponent masking as in §11.3? A design for the public page? | Yes: opt-in per game, 30 days, `noindex`, member opponents masked; the page built from the share preview card | `review-share` beyond the owner |
| P3-Q3 | 3 key moments, with the inaccuracy fill at ≥ 7 Win% | Yes (it matches the design's 3 dots and the fixture) | A5 |
| P3-Q4 | Worker CPU on dev (0.75 + the `cpu.idle` slice) and the fallback if the bench fails: (a) slower reviews at 0.5; (b) create the 2-OCPU worker VM now, after the PAYG upgrade (FEA F-OCI-5), run the dev worker there until P13, still inside 4 OCPU / 24 GB | 0.75 now; decide after C1; (b) if the co-location gate fails twice | C1 |
| P3-Q5 | Keep "usually in under 10 seconds" in the analysing copy? | Only if the dev p50 is ≤ 10 s for 40 plies; otherwise "usually within half a minute" | F2 |
| P3-Q6 | Badge art: your `public/board_icons` (B8) with the `mq-*` colours; which icon for Interesting (`sharp.svg` or `critical.svg`) | Your icons; `sharp.svg` | F3 |
| P3-Q7 | No VERIFIED tag on template text in P3 | Yes; the tag arrives with P7's verifier | F3 |
| P3-Q8 | Eval graph and bar orientation: the user's side up (DS "scores from the viewer's side") | Yes | F3 |
| P3-Q9 | Keep the worker image private on GHCR (GPL) | Yes | C7 |
| P3-Q10 | OK to create the `replay_worker` role on the Neon **dev** branch (non-destructive) | Yes | B1/C2 |
| P3-Q11 | How we grade: the Lichess "+1" in the formula, a new `#failures` section, the engine version and date text, the Pricing link | Yes (RES §3.1, COV C-18) | G4 |
| P3-Q12 | New copy for the states without a design: queued, finding key moments, too short, no turning points, terminal, share error/revoked, the public page and its gone view, the legend menu entry, complete on phones, **the game-over coach-line templates** | Accept the strings in §4 and §8.7 | F2–F6, E3 |
| P3-Q13 | On dev, backfill analysis for existing games (priority 10) | Yes, the newest 200, after AP-01 | B3 |
| P3-Q14 | Show games that predate P3 in `/games` as "Not reviewed yet", and analyse on open | Yes | G1 |
| P3-Q15 | Budget: accept 30.75 days (+2.75 over ALLOC) and a 20 % buffer line, or trim: (T-1) move Share (D4 + F6 + G5 ≈ 2 d) to P4 week 1 behind the same flag; (T-2) Practice hints (0.25 d) | Accept 30.75; no buffer inside the phase, one shared buffer in the calendar | Week 1 |
| P3-Q16 | HMAC with keys derived from one secret now; separate per-caller secrets and rotation at P13 | Yes | D1b |
| P3-Q17 | Anonymous Sentry performance metrics for the client part of the review SLO (AP-15; P11 consent) | Yes, with `{route_class, device_class}` only | F2 |
| P3-Q18 | The game-over review CTA follows the design: disabled while analysing, then "See What the Coach Thinks" (P3-D29) | Yes | E3 |
| P3-Q19 | If the AP-01 dev-project split is not done by P3 week 3: waive it for the P3 backfill and k6 (the cost lands on the production project's CU-h), or slip them | Slip them | B3, H2 |

### 14.3 Rollback (FEA §9)

| What | How to undo | Notes |
|---|---|---|
| Review UI and archive | Turn `review-v3` off → `reviewHref()` points at `/analysis` again (until H4) | After H4, revert the deletion commit on `dev`. Hobby rolls back only to the previous deployment. |
| Worker image | Pin the previous `WORKER_IMAGE` tag in the dev bundle and redeploy | An older worker claims only the kinds and payload versions it knows (`kind::text = ANY`, `payload.v ≤ PAYLOAD_V_MAX`). Newer jobs wait, nothing crashes, and every enum value in use shipped in M3. |
| Schema M3 | Nothing to undo (expand-only); stop writing | Old code ignores the new columns |
| Internal auth | `INTERNAL_TOKEN_COMPAT=1` on the socket restores static-token acceptance | The worker side has no token path to restore |
| Grading constants | Bump `GRADING_VERSION` with the previous constants → the regrade sweep re-grades from stored arrays (engine-free) | Every analysis carries `version` |
| Shares | Turn `review-share` off (no new links) + `DB/scripts/ops/revoke-shares.ts --all-review` (sets `revokedAt`, then calls the purge for each code) | Destructive only to links; prints the counts and asks the owner first (CLAUDE.md rule 5) |
| Legacy `/analysis` | H3 is reversible (remove the redirect route). H4 is the only irreversible step, and it waits ≥ 1 dev release and ≥ 3 days. | P3-D30 |

---

## 15. Definition of done

- [ ] **Deployed to every dev target** (ALLOC §1.1):
  - [ ] merged to `dev`; Vercel `replay-chess-dev` green;
  - [ ] the OCI dev box runs `websocket`, `caddy` and `analysis-worker` (profile `worker`, `cgroup_parent: worker-idle.slice`, `cpu.idle = 1`) from `deploy-oci.yml`, and the post-deploy smoke is green;
  - [ ] the Neon dev branch has M3 through `prisma migrate deploy` (no `migrate dev`, no `db push`, no reset);
  - [ ] `replay_worker` exists with its grants and timeouts; the `replay_app` and socket grants applied; the backfills have run (after AP-01); the review seed is loaded.
- [ ] **Prod untouched:** a push to `main` does not start the worker; no production DB change.
- [ ] **Flags:** `review-v3` and `review-share` on for the owner and the shared E2E members; `review-lapsed-read` per P3-Q1; `analysis-live-prewarm` off.
- [ ] **Engine:**
  - [ ] the `sf18-v1` profile frozen after the bench; `GRADING_VERSION = 1` and `GRADING_CHANGED_AT` set;
  - [ ] the goldens committed under the determinism rules;
  - [ ] the bench numbers in `WK/README.md`.
- [ ] **Chess correctness:**
  - [ ] `FX/grades/positions.jsonl` (≥ 80 cases) is green;
  - [ ] the eval-provenance job has passed one night;
  - [ ] the label-stability job has passed one night, or the cache-bypass decision is recorded in `CA/README.md`.
- [ ] **CI green:**
  - [ ] lint, `check-types`, `check-test-globs`;
  - [ ] unit (`CA`, `WK`, `CT`, `WEB`), contract, authz, GET purity, the registry lint;
  - [ ] worker integration on Docker Postgres, worker telemetry;
  - [ ] the drift gate with the protected indexes, the index existence check;
  - [ ] the Playwright specs in §12.3 (paywall on, console guard, telemetry schema + PII guard);
  - [ ] the tiered device × zoom suite (PR 4 projects; nightly 40), axe, visual baselines, the bundle budgets;
  - [ ] the licence check.
- [ ] **Every P3 board state reachable** (§4, ALLOC §1.1.4), each from real data or from `/dev/ui/...?state=`, with no "missing" in the state-coverage report:
  - [ ] the 5 review states (+ sub-states) on 5 device boards;
  - [ ] complete `default`/`nothing`; share `generating`/`ready`;
  - [ ] compare 4 states × 4 tabs; practice 4 states;
  - [ ] archive 6 states (`import_running` deferred to P4 by ALLOC);
  - [ ] `over_analysing` and `over_legend` (with the coach line and Replay from Move N);
  - [ ] the How we grade tabs.
- [ ] **No dead links:**
  - [ ] the bank checkbox, drill CTA, "Added" tags and the game-over bank line hidden until `train`;
  - [ ] the coach entries (including Ask on Compare) hidden until `coach`;
  - [ ] the source tabs and the import banner hidden until P4;
  - [ ] the rating delta shows "—";
  - [ ] How we grade links to Pricing.
- [ ] **No GET enqueues:** the GET-purity tests and T21 pass.
- [ ] **Owner test T1–T22** passes on the dev URL with ego-browser; the starred steps also on a real iPhone and a real Android phone; recorded in `docs/qa/phase-03-signoff.md`, with every defect covered by a `regression:` test.
- [ ] **Performance:**
  - [ ] the §9.1 dev targets met (server-side measures), or a logged decision for each miss;
  - [ ] the k6 JSON results and the EXPLAIN checks pass;
  - [ ] the co-location lag gate passes (or the P3-D8 fallback is applied and re-tested);
  - [ ] the timer audit passes, and Neon shows ≤ 1 worker-caused wake per idle day.
- [ ] **No new errors:** `error-window.ts` shows no new Sentry issues (web, socket, worker) and no Vercel runtime errors over the 48 h test window, or each is triaged in the sign-off; the worker job failure rate is < 2 %, excluding injected faults.
- [ ] **Privacy and security:**
  - [ ] the authz matrix green; the `/r/` masking and the image purge verified;
  - [ ] no `analysis:*` event to a non-player (socket test);
  - [ ] unsigned and replayed internal calls rejected; `INTERNAL_TOKEN_COMPAT` off on dev after H3;
  - [ ] `robots.txt`, `metadata.robots` and `X-Robots-Tag` checked;
  - [ ] the shared-device cache spec green; `prod-guard.spec.ts` covers the P3 hooks.
- [ ] **Parity, switch, then deletion** (P3-D30): every legacy `/analysis` capability is covered (the move list with badges, the legend explanation with audio, your vs the legend's moves, practice, share). Then:
  - [ ] H3: `/analysis/*` and `/api/analysis/*` answer with 308s;
  - [ ] H4 (≥ 1 dev release and ≥ 3 days later): the §3.1 files are deleted; the grep gate shows no import of the deleted modules; the `paid-only` and `membership` specs are updated.
- [ ] **Telemetry:** the §10.1 events asserted in CI (sink) and visible in PostHog (dev project) with no PII; the dashboards created; the Sentry worker project receiving transactions, metrics (or the `/internal/metrics` fallback) and the housekeeping cron check-ins; alerts configured.
- [ ] **Docs:**
  - [ ] this spec linked from `docs/implementation-plan.md`;
  - [ ] `WK/README.md`: run, deploy, bench, fault injection, and a runbook for a stuck queue, an engine crash loop, reseeding the cache and the rollback table;
  - [ ] `CA/README.md` (formulas with citations, the version bump procedure, the cache decision) and `CA/CLEANROOM.md`;
  - [ ] the owner decisions in §14.2 recorded with their answers;
  - [ ] the cross-document edits listed in Appendix A filed with the owning phases.

---

## Appendix A. Critique dispositions

The sources are the five critiques in `SP/plan/` (coverage = COV, consistency = CON, feasibility = FEA, testing = TST, api-perf = AP). "Accepted" means the change is in the body at the place given. "Rejected" and "Not P3" carry a one-line reason. Findings in those critiques that do not mention P3 are not listed.

### A.1 Coverage (`critique-coverage.md`)

| # | Finding | Disposition | Where |
|---|---|---|---|
| COV C-02 | The game-over coach line is rendered by no phase | **Accepted** with a deviation: a dedicated `coachLine` (the turning point or the best decision), not `summary[0]`, because `summary[0]` repeats the accuracy number already on the card's eyebrow | §4.7, §6.6, §8.7, §5.11, §7.1 |
| COV C-03 | "Replay from move 12" in `over_legend` is unspecified; the review CTA copy is undecided | **Accepted**: → `/practice?game&ply`; the copy follows the design, **See What the Coach Thinks** (P3-D29) | §4.7, §0.2 P3-D29, T20 |
| COV C-04 | Ask on Compare and personalised narration bounce between P7 and P8 | **Accepted (P3's part)**: P3 records P7 as the owner of Ask (`/review/[ref]/coach?ply&from=compare`) and of personalised narration (or "later"). Breaking the P7 ↔ P8 loop itself is a P7/P8 edit. | P3-D20, §2.2, §2.4, §4.6 |
| COV C-18 | Flow edge E2 (How we grade → Pricing) is missing until P11 | **Accepted**: Pricing in the page's nav, as on the board | §4.5, T15 |
| COV C-21 | B26 must be decided before P3 | **Accepted** | P3-Q1 ("before P3 starts"), §2.3 |
| COV C-01 | The game-over bank line is never lit | **Accepted (P3's part)**: reserved `analysis:done.bank` / `ReviewStatusDTO.bank` and a hidden slot; P5 renders it | §2.2, §2.4, §4.7, §5.11, §7.1 |
| COV §6.15 | ALLOC "Lights up" omits the game-over coach and bank lines | **Accepted** as a cross-document edit for `allocation.md` | §2.4 note |

### A.2 Consistency (`critique-consistency.md`)

| # | Finding | Disposition | Where |
|---|---|---|---|
| CON 3.1 | The P3-D17 hedge on the `GamePlayer` key | **Accepted** | P3-D17, §6.2, R4 |
| CON 3.2 | P2 dependency names wrong | **Accepted** | §2.3 |
| CON 3.3 | SQL uses `endReason`/`playedAt` | **Accepted**: `endMethod`, `completedAt`, `gp."endedAt"`; the cursor `{k: endedAt}`; DTOs keep `playedAt` | §6.4, §7.3, §9.2, §9.3 |
| CON 3.4 | `ecoCode`/`openingName` granted and read but never added | **Accepted** (M3 columns on `games` and `game_players`; the grant drops `openingId`) | §6.2, §6.3 |
| CON 3.5 | No `Job.fairSeq` | **Accepted** (+ index order) | §6.2, §6.3, §8.12 |
| CON 3.6 / R-05.3 | Add `HOURLY_TICK` and a recurring tick | **Partially accepted**: P3 builds the recurring extension point (`WK/src/scheduler/recurring/`). **The hourly tick is rejected** in favour of FEA F-NEON-2 / AP-08: 24 wakes a day cost ≈ 15 CU-h a month and break the zero-idle-query rule, while the daily planner gives P6/P10/P13 the same hook. | P3-D22, §7.7, §8.12 |
| CON 3.7 / R-05.2 | Named `JOB_PRIORITY` in `DB/src/jobs.ts` | **Accepted**, with a location change: it is defined in dependency-free `CT/internal/jobs.ts` (the AP name-registry gate) and re-exported by `DB/src/jobs.ts`, so both paths resolve | P3-D7, §6.6 |
| CON 3.8 / R-07 | `rooms[]` vs P2's `targets` body | **Accepted**: P2's body; the `rooms[]` edit is dropped | P3-D13, §5.11, §7.4 |
| CON 3.9 | `game:result` fields in `socket/user.ts` | **Accepted** → `CT/socket/game.ts` | §5.8, §7.4 |
| CON 3.10 / R-10 | Protected-index file path | **Accepted** → `DB/prisma/protected-indexes.txt` + `scripts/db/check-drift.ts` | §6.3 |
| CON 3.11 / R-08 | Delete the `RC_INTERNAL_KEYS` sentence; the token stays | **Sentence deleted; the env name stays `INTERNAL_API_SECRET`.** "The static token stays" is **rejected** for P3's new hops: the web → worker kick crosses the public internet, and AP-44 / SEC-4 show that a static token can be replayed forever. The HMAC helper keeps R-08's goal of one scheme and one name. | P3-D21, §7.9, §8.17 |
| CON 3.12 / R-18 | `engine_load` → `engine_init` | **Accepted** | §10 |
| CON 3.13 | "P2 already inserts the Job row" | **Accepted** (P3 appends fragments) | §3.2, §7.4, §7.6 |
| CON 3.14 | "P8 may replace the hint" | **Accepted** → P7 | §8.11 |
| CON 3.15 | `CT` shorthand | **Accepted** → `PKG/contracts/src` | header |
| CON R-01 (names table) | Read `games.whiteName…blackTitle` and `source` from M2 | **Accepted with an adjustment**: P3 reads player names from P2's `game_players.opponentName/opponentRating` + `users.name`, so it no longer depends on P2 fix 2.1 for names; `source` keeps a day-1 fallback in M3 | §2.3, §9.2 |
| CON R-02 | No `KeyMoment` anywhere | **Accepted** (restated) | P3-D3 |
| CON R-03 | `timeZone` arrives in M4 | **Accepted**: `viewer.timeZone ?? "UTC"` | §2.3, §5.3, §4.9 |
| CON R-06 | `gone` + conflict reasons in `codes.ts` | **Accepted** | §7.1, §7.2 |
| CON R-07 (catalogue) | `analysis:queued/writing/failed` missing from the ALLOC/API/CDL catalogues | **Accepted**: registered in `CT/socket/registry.ts`; the catalogue edits go to those docs | §5.11 |
| CON R-09 | Env names | **Accepted**: `SENTRY_DSN`, `POSTHOG_PROJECT_KEY`, `NEXT_PUBLIC_SITE_URL` | §7.9 |
| CON R-13 | Rate limits written as a token bucket | **Accepted**: fixed window `limit / windowSec` | §7.2 |
| CON R-14 | P3 flags missing from ALLOC §1.6 | **Accepted** as a cross-document edit | §7.10 |
| CON R-17 | Lowercase wire enums | **Accepted** (`comparison.status`, `compare:ready`) | §7.1, §5.11 |
| CON R-20 | `db push` wording; hard-coded Neon IDs | **Accepted**: no `db push` on Neon; a local Docker shadow; "the Neon dev branch named in CLAUDE.md" | P3-D31, §6.7 |

### A.3 Feasibility (`critique-feasibility.md`)

| # | Finding | Disposition | Where |
|---|---|---|---|
| FEA 10.9-1 / F-OCI-2 | `SCHED_IDLE` inside a container does not protect the socket | **Accepted**: the `cpu.idle` slice + the cap + the lag pause; the day-1 `cpu.idle` check | P3-D8, R3, §3.2, C7, §12.6 |
| FEA 10.9-2 / F-NEON-2 | A daily planner instead of `HOURLY_TICK`; `recurring/` as a directory; the kick carries `runAt` | **Accepted** | P3-D22, §6.6, §7.7, §8.12 |
| FEA 10.9-3 | Other docs must use `/internal/analysis/kick` | **Accepted** (cross-document: ARCH, API, P6, P10) | P3-D12 |
| FEA 10.9-4 / SEC-4 | HMAC, not a static token | **Accepted**: P3 builds it in the helper if P2 did not | P3-D21, D1b, §8.17 |
| FEA SEC-8 | A Caddy pre-check for unsigned requests | **Accepted** for P3's paths now, widened at H3 | §3.2, §7.5 |
| FEA 10.9-5 / §9 | Rollback: versioned payloads, an older worker skips newer jobs, legacy kept one release | **Accepted** | P3-D30, §6.1, §8.12, §14.3 |
| FEA 10.9-6 / F-OCI-4 / #13 | Pool rules; a Neon suspend test | **Accepted**: HTTP driver statement, retry rule, manual suspend check | P3-D11, §9.8, §12.6 |
| FEA 10.9-7 / F-OCI-5 | Option: create the worker VM now, after PAYG | **Accepted** as option (b) | P3-Q4 |
| FEA 10.9-8 / LIC-3 | `WK/NOTICE` | **Accepted** | §7.8, §11.4 |
| FEA LIC-4 / V8 | Clean-room record, licence CI check, verify the scalachess licence | **Accepted** | §8 intro, §11.4, A3, A7 |
| FEA F-VER-3 | The device matrix against the deployed dev URL burns Hobby quotas | **Accepted**: the full matrix runs against `next start` in CI; the dev URL gets the smoke only | §12, §12.3 |
| FEA F-VER-5 | The Speed Insights quota | **Accepted**: `sampleRate 0.2`; field data as an indicator; the lab as the gate | §9.1, §9.5 |
| FEA F-NEON-1 / AP-01 | Dev shares the production project's CU-h | **Accepted as a gate**: the backfill, k6 and the throughput runs wait for the split (a P1 task) | §2.3, §6.7, §6.8, §12.7, R20, P3-Q19 |
| FEA §6 wake body `{kinds[], runAt?}` | — | **Accepted** (`KickBodyV1`) | §6.6 |
| FEA §7 registries as directories | — | **Accepted conditionally** (paths given in both forms) | §2.3, §13 |
| FEA §8 calendar realism / 20 % buffer | — | **Accepted** as an owner decision | §13, P3-Q15 |
| FEA fix #3 (`VERCEL_ENV` gates) | — | **No change needed**: P3's hooks gate on `APP_ENV` only (stated) | §7.9 |
| FEA SEC-3 (dev environment public) | — | **Accepted for P3's part**: the dev-URL runs send the bypass header; the worker never calls the web | §7.9, §11.2 |
| FEA F-OCI-3 (capacity ceiling after launch) | — | **Not P3**: the import backlog policy is P4's and Stage C is P13's; P3 only provides `JOB_PRIORITY` and `fairSeq` | §2.2 |
| FEA F-NEON-3 (UNLOGGED budgets) | — | **Accepted** as applied to P3's own long windows (AP-11) | §7.2 |

### A.4 Testing (`critique-testing.md`)

| # | Finding | Disposition | Where |
|---|---|---|---|
| TST P3 determinism | Goldens with the cache off, a fresh engine and no resume; a label-stability job | **Accepted** | P3-D10, §12.4 |
| TST P3 workflow ownership | `nightly.yml` must come from P1 | **Accepted** (dependency; minimal stand-in otherwise) | §2.3, R22 |
| TST X13 corpus | `FX/grades/positions.jsonl` ≥ 80 | **Accepted** | §8.4, §12.1, A7 |
| TST eval provenance | A nightly ±30 cp check | **Accepted** | §12.4 |
| TST worker telemetry test | A fake PostHog `/batch` | **Accepted** | §12.2 |
| TST E2E telemetry assertions | In walkthrough and share | **Accepted** | §12.3 |
| TST real-data states | `hold_queue`, `pause_at:writing`, terminal | **Accepted**: per-game faults through the signed kick, registered hooks | §6.6, §7.9, §12.3 |
| TST `review-lapsed.spec` | — | **Accepted** | §12.3 |
| TST post-deploy real-engine smoke | — | **Accepted**, implemented as a worker smoke script plus a signed kick, with no new internal endpoint | §12.8, T22 |
| TST regression additions | The data-layer spec, P2 transcripts, `finish-idempotent` | **Accepted** | §12.5 |
| TST DoD additions | — | **Accepted** | §15 |
| TST X1 | One runner and one layout | **Accepted** (test file names updated) | §12 |
| TST X2 | CI e2e on `dev`; post-deploy | **Accepted** (dependency) | §2.3, §12 |
| TST X3 | Paywall on in e2e | **Accepted** (dependency) | §11.2, §12.3 |
| TST X4 | Persona registry and leases | **Accepted**: P3 personas leased; admin via `E2E_ADMIN_EMAIL` | §6.9, §12.2, §12.3 |
| TST X6 / X7 | The telemetry sink with PII guard; the console guard | **Accepted** | §10, §12.3 |
| TST X8 | State tags and the coverage manifest | **Accepted** | §4.10, §12.3 |
| TST X9 | Tiered matrix, stress data, real routes | **Accepted** | §4.10, §12.3 |
| TST X10 | Visual regression tooling | **Accepted** (P1's `toHaveScreenshot`) | §12.3 |
| TST X11 | The whole suite, flags-off, phase tags | **Accepted** | §12.5 |
| TST X12 | The hook registry; proven absent in prod | **Accepted** (boot refusal + registry) | §7.9, §11.2, §12.1 |
| TST X14 | Every defect gets a regression test | **Accepted** | §12.5, §15 |
| TST X15 | Sign-off record, test window | **Accepted**; the window stays **48 h** (stricter than ≥ 24 h) | §12.6 |
| TST X16 | CI on Docker Postgres | **Accepted** (already) | §12 |
| TST X18 | k6 results as JSON, `abortOnFail` | **Accepted** | §12.7 |
| TST X5 (`x-rc-now`) | — | **No change needed**: no P3 spec depends on a server deadline; the expired and revoked share states come from seeded rows | §6.9 |

### A.5 API and performance (`critique-api-perf.md`)

| # | Finding | Disposition | Where |
|---|---|---|---|
| AP-09 | GETs enqueue; polls re-kick; A9 enqueues on hover | **Accepted**: no GET enqueue; the `lastKickAt` CAS; A9b compute POST | P3-D23, §5.2, §5.7, §7.2, §7.3 |
| AP-04 | Long private `max-age` (A8, PR1) | **Accepted** | §7.2, §9.4, §12.3 shared-device spec |
| AP-05 | The `/r` image is immutable with no purge | **Accepted**: a short browser TTL, a CDN tag, the purge, the generic card | §5.5, §7.2 A12 |
| AP-14 | `headers()` in the ISR page | **Accepted** | §5.5, §3.2 (`next.config.js`) |
| AP-47 | Probing `/r/[code]` | **Accepted** (a 1 h negative cache; revalidate 3600) | §5.5 |
| AP-10 | Invalidation storm from backlog emits | **Accepted**: banding, `analysis:batch`, a reserved `bank` | P3-D26, §5.11 |
| AP-11 | Long rate windows on the UNLOGGED table | **Accepted**: a durable daily share cap from `shares`; the legend attempts cap; the rest ≤ 60 s | §7.2 |
| AP-15 | SLOs measured through consent-gated PostHog | **Accepted**: server-side metrics + `readyMs`; the client part is anonymous Sentry (P3-Q17) | §9.1, §10 |
| AP-19 | The G1 ETag scans the archive | **Accepted** (`users.gamesVersion`) | P3-D27, §6.2, §7.2, §9.3 |
| AP-20 | `fallbackInterval` never stops | **Accepted** (the start time in `query.meta`; a unit test) | §5.2, §12.1 |
| AP-38 | Counts on every page | **Accepted** (page 1 and `limit=0` only) | §5.10, §7.1, §9.3 |
| AP-44 | HMAC, per-caller keys, event allow-lists | **Accepted**: derived per-caller keys now, separate secrets at P13 (P3-Q16) | P3-D21, §7.4, §8.17 |
| AP drift: strong ETags | — | **Accepted** | §7, §7.2 |
| AP drift: one archive column `playedAt` | — | **Rejected**: P2 (the first shipper) defines `game_players."endedAt"` and its index; R-01 rules P2's names; P3 sorts on `endedAt`, so the plan uses the existing index with no Sort | P3-D25 |
| AP drift: `PRIORITY.{USER_WAITING…}` names | — | **Partially accepted**: R-05's `JOB_PRIORITY` names (more phases already cite them); the file location follows the AP gate | P3-D7 |
| AP-07 index drift | — | **Accepted** (the `endedAt` index; the index existence gate) | §6.4, §12.2, §12.7 |
| AP-12 | zod in client bundles | **Accepted** (`devSchema`) | §5, §9.6 |
| AP-27 | P5's J1 inside P3's HTTP batch | **Accepted as enabling**: the final-batch extension directory, with natural-key statements | §8.12 |
| AP-18 | Transient DB errors | **Accepted** for the worker (HTTP retry rule) | §9.8 |
| AP CI gates (cache-tier lint, index check, GET purity, timer audit, shared device) | — | **Accepted**: P3 contributes its entries and owns the timer audit | §12.1, §12.2, §12.3, §12.7 |
| AP S4 watch: lazy-load `@tanstack/react-virtual` past 200 rows | — | **Rejected**: `/games` is a virtualised listbox with `aria-activedescendant` at every size; a second non-virtual render path costs more than the ≈ 5 kB it saves, and the 230 kB budget is met | §9.6 |
| AP-21 / AP-22 | One `api()`; `private, no-cache` | **No change needed** (already consistent; restated) | §5 |
| AP-25 | Reconnect resync burst | **Not P3** (P2/CDL `useq`); P3 relies on `resyncCaches()` | §5.2 |
| AP-35 | SLO formulas | **Accepted**: every §9.1 row names its metric and source | §9.1 |

### A.6 Found while revising (no critique ID)

| Item | Change |
|---|---|
| App Router pages cannot return HTTP 410 | The `/r/[code]` gone view is served with HTTP 200 + `noindex`; the APIs keep 410 |
| `users` has `name`, not `username` | The player cards use `users.name` (P10's username later) |
| The worker must not overwrite `games."openingId"` | The grant was narrowed; the game's opening lives in the new `ecoCode`/`openingName` |
| The P1 UTC convention for `timestamp(3)` columns | Applied to every raw statement (header note) |
| The design shows the review CTA disabled while analysing (`V3GameOverLegend`, P2 row 47) | P3-D29; T2 updated |
| Regrades needed the MultiPV-2 score | `game_analyses.second[]` (P3-D28) |

**Cross-document edits this spec depends on** (to be filed with their owners):
- **ALLOC:**
  - §1.2 "Lights up" (the coach and bank lines);
  - §1.6 flags;
  - §5.1 M3 row (`Share`, no `KeyMoment`, `ecoCode`/`openingName`, `fairSeq`, `lastKickAt`, `gamesVersion`, `second`, `readyMs`, no `HOURLY_TICK`);
  - §5.2 events (`analysis:queued|writing|failed|batch`).
- **ARCH:**
  - §1.8 (the dev compose with the `cpu.idle` slice);
  - §1.10.3 (`/internal/analysis/kick`, the daily planner, the HMAC helper).
- **API:** §4.7 aliases → `/api/review/*`; WK-1 → `/internal/analysis/kick`.
- **CDL:** §5.9 `fallbackInterval` start time; §3.4 the status key.
- **OPT:** §3.5 `jobs_ready_idx (priority DESC, "fairSeq", "runAt")`.
- **P2:**
  - fix 2.1 (or P3's M3 fallback for `source`);
  - `/internal/emit` HMAC + the compat flag;
  - the `game:result.review` field;
  - the abort statement's `analysisStatus`.
- **P4, P5, P10:** emit bodies use `targets`; `/worker/wake` → `/internal/analysis/kick`.
- **P5:** reads `analysis:done.bank`, the final-batch extension, and `progress.bankOptOut`.
- **P6, P10, P13:** a recurring slice file instead of `HOURLY_TICK`.
- **P7:** lights Ask on Compare and the game-over coach line on `review:text_ready`.
- **P8:** `engine_init`; `qk.review.status`.
