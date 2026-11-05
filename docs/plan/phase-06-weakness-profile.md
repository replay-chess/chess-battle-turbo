# Phase 6 · Weakness Profile: detailed plan (final)

Status: plan, revised after the five critiques, 2026-11-02. Written against branch `dev` @ `0848b76` (Phase 0 done). Budget: **9 dev-days** (allocation §0), plus a **20 % buffer of 1.8 days** held outside the work packages (feasibility §8). Feature flag: **`weakness`**. Schema step: **M6**.

**Goal.** Show the recurring patterns in a member's analysed games, measure each one against players of the same rating band, and attach a drill to every weakness.

**What changed from the draft** (each item is traced in Appendix A):

1. Table and index names follow P5: `training_cards` / `training_attempts`, not `review_cards` / `review_logs` (CC 6.1, AP-07).
2. The user room is `user:{ref}` through `ROOM.user(ref)` (CC 6.2).
3. M6 now creates `game_players.stats` and `game_players."errorThemes"` as well, because P3 deferred both to P6 (CC 6.3). P6 also owns the `STATS_V1` codec and the per-game input builder.
4. SQL uses the columns P2 shipped: `game_players."endedAt"`, `"ratingBefore"`, `games."completedAt"`. The time zone column is `User.timeZone` (CC R-01, R-03).
5. There is no `HOURLY_TICK`. The weekly roll and the heal sweep are slices of P3's once-a-day housekeeping window, so P6 adds no fixed Neon wake (AP-08, FE 10.12.2).
6. `GET /api/train/weakness` no longer enqueues work. It may only re-kick a stale queued job through a compare-and-set, and the page asks for a missing build with a POST (AP-09).
7. The recompute limit (1 per 600 s) is enforced from the user's own job row, which survives Neon scale-to-zero (AP-11).
8. Error statuses: `validation_failed` is 400, `idempotency_key_reused` is 422, and lapsed members get 402 `subscription_required {reason}` (CC 6.6–6.8).
9. Path shorthands: `TRN` = chess-training and `CT` = contracts (CC 6.4, FE 10.12.1). Priorities are `JOB_PRIORITY.*` from `DB/src/jobs.ts` (higher runs first, P3-D7).
10. Analysis coverage stays inside P4's eager budget of 200 games per member, and trialists get 20 (FE 10.12.3).
11. The baseline build pins the worker's Stockfish build, network hash and `sf18-v1` search profile (FE 10.12.4).
12. Tests: leased personas instead of shared letters, hooks guarded by `isNonProd()` + `x-e2e-token`, property tests, the shared grade corpus, telemetry asserted through the sink, design-state tags and a nightly dev recompute check (TE §2 P6, X1–X18).
13. The client changes: the ME-2 fallback is 10 minutes, the poll interval is hoisted so it actually stops, and zod schemas stay out of the production bundle (AP-08 item 4, AP-20, AP-12).
14. The Settings › Training scope editor is not built (C-12). The legend-lesson hand-off to P8 has an exact contract and acceptance test (C-07).
15. Found while revising: the weakness scope is stored on `training_profiles` (`UserSettings` arrives only in P9). The recompute debounce is 240 s, which is shorter than Neon's 5-minute suspend window. Aborted games are excluded.

**Path shorthands**

| Short | Path |
|---|---|
| `REPO` | `/Users/rohitpandit/open_source/chess-battle-turbo` |
| `WEB` | `REPO/apps/web` |
| `WK` | `REPO/apps/analysis-worker` (the P3 worker) |
| `WS` | `REPO/apps/web-socket` |
| `PKG` | `REPO/packages` |
| `TRN` | `PKG/chess-training` (P5 package) |
| `CA` | `PKG/chess-analysis` (P3 package) |
| `CT` | `PKG/contracts/src` (P1/P2/P3 package; subpaths `http/`, `socket/`, `internal/`) |
| `DB` | `PKG/db` (P2 moved the Prisma schema here) |
| `AN` | `PKG/analytics/src` (P1 event registry, testing X6) |
| `FX` | `PKG/chess-fixtures` |
| `SP` | the planning session's scratchpad, archived scratch inputs that are not in the repo and may no longer exist (see [99-open-decisions.md](99-open-decisions.md) A12) |
| `DR` | `SP/design-ref/project/v2` (board files `*.dc.html`) |
| `EX` | `SP/extract` (parsed board markup and DCLogic, one `.txt` per board) |

`TR-5`, `TR-7`, `TR-12` and `TR-13` are endpoint ids from api-design §4.9. They are not paths.

Inputs used: `SP/plan/allocation.md` §3 P6, §4, §5; `data-model.md` §3.10, §5.7, §11, §13; `api-design.md` §2.10–2.12, §4.9, §6; `client-data-layer.md` §2–5, §8–9; `optimization.md` §2–5, §10 (OPT-50); `architecture.md` §1.10, §2.3.3; `phase-02.md` §6.2 (M2 models); `phase-03.md` §6–8 (M3, the final write, `sf18-v1`); `phase-04.md` §8.9 (analysis tiers), §7 I/O lane; `phase-05.md` §3, §6, §7, §8.11; the five critiques (`critique-coverage.md`, `critique-consistency.md`, `critique-feasibility.md`, `critique-testing.md`, `critique-api-perf.md`); `inv-rct-b.md` W1, W2, §3.5–3.8, §4, §5; `inv-research.md` §14 (R-WEAK, R-WK-01…07); `REPO/research_notes/Chess coaching app market research/implementation.md` §1, §4, §5; the 8 boards and their extracts; the code at `0848b76`.

---

## 0. Names used in this spec

Where the input plans disagree, this spec uses the left column. The right column says which ruling decided it.

| Thing | Name used here | Aliases in the inputs | Decided by |
|---|---|---|---|
| Profile read | **TR-5** `GET /api/train/weakness` | `GET /api/weakness` (audit-api, audit-client) | api-design §0.3 |
| Recompute | **TR-12** `POST /api/train/weakness/recompute` | rct-b W9; `POST /api/weakness/drill` | api-design §4.9 |
| Drill start | **TR-7** `POST /api/train/sessions {kind:"weakness"}` | rct-b W2 `kind:'WEAKNESS'` | api-design §4.9; lowercase wire enums (CC R-17) |
| "Seen" marker | **TR-13** `POST /api/train/weakness/seen` (new in P6) | rct-b W8 `PATCH /api/train/prefs {lastWeaknessSeenVersion}` | this spec (§7.1.3): it is a counter, not a preference |
| Socket events | **`weakness:progress`**, **`weakness:ready`** | `weakness.progress` (architecture, dot case) | allocation B20, CC R-07 |
| User room | **`user:{ref}`**, built with `ROOM.user(ref)` from `CT/socket/rooms.ts` (P2) | `u:{userRef}` (api-design §6.3, the draft) | CC R-07 / 6.2 |
| Emit body | `{ v:1, targets:[{userRef}], event, data, dedupeKey? }` | `{room, …}`, `rooms[]` | P2 L1612, CC R-07 |
| Job kind | **`RECOMPUTE_WEAKNESS`** (already in P3's M3 `CREATE TYPE`) | `WEAKNESS_RECOMPUTE` | CC R-05 ledger |
| Bank tables | **`TrainingCard` / `TrainingAttempt`** (`training_cards`, `training_attempts`) | `ReviewCard` / `ReviewLog` (data-model) | P5 creates them (allocation B11); CC R-02, AP-07 |
| Per-member end time | **`game_players."endedAt"`**, index `game_players_userId_endedAt_gameId_idx` | `game_players."playedAt"` (data-model, AP-07) | CC R-01: P2 shipped `endedAt`. Wire fields may still say `playedAt` |
| Member rating at the game | **`game_players."ratingBefore"`** (+ `rated`, `source`) | `game_players.rating` | CC R-01 |
| Game end time | `games."completedAt"` | `games."playedAt"` | CC R-01 |
| Time zone | **`User.timeZone`** (column `"timeZone"`, M4 by P4) | `User.timezone` | CC R-03 |
| Snapshot key | **PK `(userId, weekStart)`**; latest = backward PK scan | `isCurrent` + cuid `referenceId` (rct-b) | data-model §5.7 |
| Baseline file | **`TRN/baselines/v1.json`** | `packages/chess-analysis/baseline/v1.json` | data-model §3.10, CC R-10 |
| Taxonomy file | **`TRN/src/themes.ts`** (P5) | `CT/src/taxonomy.ts` (the draft) | P5 §8.11 |
| Worker app | **`apps/analysis-worker`** | `apps/worker` | allocation P3, architecture App. B |
| Job priorities | **`JOB_PRIORITY.*`** from `DB/src/jobs.ts`. Higher runs first: `USER_OPENED 100`, `GAME_ENDED 80`, `IMPORT_NEWEST 50`, `WEAKNESS 20`, `BACKLOG 10`, `HOUSEKEEPING 0` | `PRIORITY.*` in `CO/src/jobs.ts`; lower-runs-first scales | P3-D7, CC R-05 |
| Worker wake | **`POST /internal/analysis/kick`**, body `{ v:1, kinds:["RECOMPUTE_WEAKNESS"], runAt? }` | `/worker/wake`, `/internal/wake` | P3-D12, FE §6, CC R-05 |
| Internal auth | The shared helper `CT/internal/auth.ts` (P2/P3 own the scheme). P6 adds no secret | HMAC `x-rc-kid/ts/sig` (the draft) | CC R-08 / FE §6 disagree on the scheme; P6 is scheme-neutral |
| Recurring work | A slice of P3's daily `HOUSEKEEPING` / `DAILY_PLAN` window: `WK/src/scheduler/recurring/weakness.ts`. **No `HOURLY_TICK`** | `HOURLY_TICK` slice | FE F-NEON-2, AP-08 |
| Rate-limit specs | `limit / windowSec` (P1 fixed window). Windows longer than 60 s are durable | "Postgres token bucket" | CC R-13, AP-11 |
| Error statuses | `validation_failed` 400; `idempotency_key_reused` 422; `subscription_required` 402 with `details.reason` | 422 / 409 / `membership_ended` | CC R-06 |
| Engine binary env | **`ENGINE_PATH`** | `STOCKFISH_PATH` | CC R-09 |
| Telemetry registry | **`AN/events/weakness.ts`** (zod per event) | `WEB/lib/analytics/events/weakness.ts` | TE X6 |
| Test hooks | Registered in `WEB/lib/test-hooks/registry.ts`; guard `isNonProd()` + `x-e2e-token` | "`APP_ENV=dev` only" | TE X12, FE #3 |

---

## 1. Goal and what the owner can test

### 1.1 User-visible outcome

A member opens **Train › Weakness Profile** (`/train/weakness`) and sees one of four states:

1. **Insufficient.** Fewer than 20 analysed games are in scope. The page shows a meter ("14 / 20 games analysed"). From 5 analysed games it also lists preliminary patterns ("Missed forks · Seen in 5 of 14 games · Preliminary"), with import and play CTAs.
2. **Computing.** Enough games exist but are still being analysed (an import has just landed, for example). The page shows real progress over 4 steps and a real ETA. The member can leave; a dot appears on Train when the profile is ready.
3. **Profile.** A verified headline ("You lose most points to missed forks in the middlegame, especially with under a minute on your clock."). Below it:
   - The top 3 patterns (up to 5 with "See all"). Each shows the member's rate per 100 moves next to the rate of players rated 1100–1300, a trend, an example position from their games, and a "Drill · 12 in bank" button.
   - A weekly plan.
   - Breakdown tabs: By phase, Clock, Openings, and Strengths (Strengths is a tab on devices and a box on desktop).
4. **Failed.** Not designed. It reads "We couldn't build your profile" and offers Retry.

**Drill a weakness** (`/train/weakness/[pattern]`) picks a size (10 or 20) and whether to "Fill with matched Lichess puzzles". It then starts a session in the P5 runner, built as 6 positions from the member's own games plus 4 matched puzzles near their puzzle rating, interleaved. The session ends at the P5 summary page with the eyebrow "Missed forks drill · 10 positions".

P6 also lights up slots that earlier phases left unrendered (allocation §1.2): the Train hub "Weakness drills" row, the hub plan's focus theme and its "Built from your last 20 games." footnote, the Home bank-card "top theme" line, and the Train nav dot.

### 1.2 Owner test script (dev: `https://replay-chess-dev-replaychess007-1069.vercel.app`, ego-browser)

Seed personas (`new`, `trial`, `member`, `weakcompute`, `weakfail`, `bullet`, `noclock`) are dev-seed users (§6.8). Rows that change data use a **pool user** leased and reset to a named persona (TE X4), never a shared letter A–P.

| # | As | Steps | Expected |
|---|---|---|---|
| T1 | persona `trial` (14 analysed rapid/blitz games, Chess.com import running) | Train › Weakness Profile | Insufficient: "6 more games and we can tell you what keeps costing you points", meter `role=img` "14 of 20 games analysed", "Import games from Chess.com or Lichess", "Or play 6 more games here", preliminary list with 2 rows tagged Preliminary |
| T2 | pool user reset to persona `weak-fresh` (member, no games) | Link the Lichess fixture account in `/settings/connected`, then open `/train/weakness` | Computing: "Analysing 60 games", the 4 steps advancing, an ETA in minutes (never the board's fixed "about a minute"). Navigate to `/home`; when the profile is ready the Train nav item gets a dot. Open the page: the profile shows and the dot clears |
| T3 | persona `member` (READY snapshot with 3 patterns) | Open `/train/weakness` | Headline + VERIFIED. Rows 1–3: row 1 open by default, with its 132 px example board, "Middlegame · 7 of the last 20 games", "Drill · 12 in bank". Open row 2: row 1 closes. "See all" shows rows 4–5. Tabs By phase / Clock / Openings switch with arrow keys and make no network request. "What you already do well" shows 2 sentences |
| T4 | `member` | Click "Drill · 12 in bank" on row 1 | URL `/train/weakness/fork`. The row expands into the config: "10 positions" pressed, checkbox on, "6 from your games + 4 matched Lichess puzzles near 1512", CTA "Start drill · 10 positions · ~5 min". Pick 20 → "12 + 8", "~10 min". Uncheck → "12 from your games only (12 in your bank)" |
| T5 | `member` | Start the drill | Runner `/train/bank/session?s=…` titled "Weakness drill". Items alternate own/puzzle, and Lichess items read "Lichess puzzle · matched to your rating". Finish → summary eyebrow "Missed forks drill · 10 positions". The bank daily cap is unchanged |
| T6 | `member` | Drill the "Time-pressure blunders" row | The checkbox is disabled with "Matched puzzles have no clock, so this drill uses your own positions only". Own items are mistakes made with under a minute on the clock |
| T7 | persona `weakfail` | Open the page, click Retry, then Retry again | First click: Computing. Second click within 10 minutes: an inline countdown "Try again in 9:52" |
| T8 | persona `bullet` (64 bullet games, 8 blitz) | Open the page | Insufficient with an info banner "You have 64 bullet games from the last 6 months. Include them?". Accept → computing → profile; the scope label reads "Bullet, blitz and rapid" |
| T9 | `member` on a real iPhone and Android, iPad portrait and landscape | Open the profile | iPhone/Android/iPad P: top bar + scroll column + 4 tabs (Strengths is a tab) + tab bar; "Drill · 12 in bank" opens a bottom sheet with the same config. iPad L: rail, 2 columns, 4 tabs, week plan. The page never scrolls at 80/100/110/125/150 % zoom; only the content panel does |
| T10 | `member` | `/train` and `/home` | The hub "All training" shows "Weakness drills · Missed forks · 12 in your bank". The hub footnote says "Built from your last 20 games." The Home bank card reads "Missed forks is your top weakness (12 in bank)." |
| T11 | E2E user R (non-member, read-only) | `/train/weakness`; `curl` TR-5 | Redirect to `/pricing?reason=…&redirect_url=%2Ftrain%2Fweakness`; the API returns 402 `subscription_required` with `details.reason` |
| T12 | owner, with `weakness` turned off for their user in PostHog | `/train/weakness`, `/train`, `/home`, the nav, `g w` | `/train/weakness` → `/train`. Hub and Home look exactly as in P5. The nav sub-item is gone and `g w` does nothing |
| T13 | signed out | Open `/weakness` | 307 to `/train/weakness` on dev (it becomes 308 only in production, in P13), then the normal sign-in gate |

---

## 2. Scope

### 2.1 In scope

- **Schema M6.**
  - `weakness_snapshots`.
  - Five `game_players` columns that feed the profile: `stats` (STATS_V1) and `errorThemes`, which P3 deferred to P6 (`phase-03.md:896`), plus `errorLog`, `errorThemeN` and `weaknessInputsV`.
  - `training_profiles.weaknessVersion`, plus the scope columns `weaknessTimeClasses` and `weaknessMonths`.
  - `jobs."lastKickAt"` and the partial index `jobs_user_active_idx`, both only if absent.
  - Role grants for the new columns.
- **The rating-band baseline.** Script J5 (`TRN/scripts/build-baseline.ts`), the committed `TRN/baselines/v1.json`, and its loader and schema.
- **The pure weakness engine** in `TRN/src/weakness/*`: scope, band, aggregation, eligibility, ranking, trend, the "where" line, the phase/clock/openings breakdowns, strengths, the headline template, preliminary patterns, status, progress and ETA, and the version rule.
- **Analysis inputs:**
  - the `STATS_V1` and `ERROR_LOG_V1` codecs;
  - `CA/src/weakness-inputs.ts#computeSideInputs()`;
  - the writer inside P3's final analysis batch;
  - `rc:timePressure` tagging of bank mistakes;
  - the backfills.
- **Worker job `RECOMPUTE_WEAKNESS`** in P4's I/O lane: its triggers, the debounce, coverage (J4: analysis priority for in-scope games, inside the eager budget), progress emission, and the daily slice (weekly roll, heal sweep, prune).
- **Web API:** TR-5, TR-12 and TR-13, plus the `weakness` branch of TR-7 and its summary text.
- **Socket events** `weakness:progress` and `weakness:ready` (schemas, registry entries, the emitter).
- **UI:**
  - `/train/weakness` and `/train/weakness/[pattern]` across the 8 boards and all their states;
  - the undesigned `failed` state;
  - the phone drill sheet;
  - the demo route `/dev/ui/weakness`, including `lesson=1` and `stress=1` variants.
- **Lights up:**
  - the hub weakness row, the plan focus and the footnote;
  - the Home top-theme line;
  - the Train nav dot (`ME-2 weaknessReady`);
  - a nav destination and the `g w` chord, and a ⌘K entry;
  - a `/how-we-grade#weakness` section;
  - the redirect `/weakness` → `/train/weakness` (the landing "Your Patterns" CTA, inv-pub §2).
- Tests, telemetry, k6 checks, seed and leased personas, the sign-off record and the runbooks.

### 2.2 Explicitly out of scope (and who owns it)

| Item | Why out | Owner / phase |
|---|---|---|
| Legend lesson links on rows, in the week plan and in the drill config ("Legend lesson: Tal vs Smyslov, 1959") | The `Lesson` table and player arrive in P8. Under allocation §1.2 the slot is **not rendered** until then. P6 builds the three slots, their fixtures and the resolver stub, so lighting them up is one function body (§7.6) | **P8 S13** must add `resolveLessonForPattern` (critique C-07). §14.3 lists it as an open hand-off |
| Settings › Training scope editor (time classes, months) | There is no board, and P10's settings plan has no Training section (critique C-12) | **Not built.** Defaults apply, and the only scope change is the inline "Include bullet games" offer. TR-12 already accepts `timeClasses`/`months`, so a later settings row is UI-only work and needs the owner's sign-off |
| Profile "strengths" card | Account area | P10 (reads `metrics.breakdown.strengthKeys`) |
| Weakness facts in the coach context | Coach | P7 (reads the latest snapshot) |
| LLM-written weakness text | Every claim must be verifiable. P6 uses deterministic templates, verified by construction | P7 may rephrase through its verifier |
| Per-move timer for time-pressure drills | rct-b Q16 v1: untimed, own positions only | later |
| Maia "should-have-found" weighting | research §5. Licence and inference cost are unknown | later |
| Piece breakdown and an Aimchess-style radar | Not in the v3 boards | Computed into `metrics.breakdown.pieces` for P7, never rendered in P6 |
| Weekly email summary | Optional in architecture §2.2 | P10 notifications |
| Phase and opening gaps as top-3 rows | They can't be ranked on the same "points lost per 100 moves" scale (§8.6). They appear in the headline clause and the breakdown tabs instead | Decision D-P6-4 (§14) |

### 2.3 Dependencies on earlier phases (entry checklist; verify on the Neon dev branch named in CLAUDE.md before day 1)

| From | Needed | How to verify |
|---|---|---|
| P1 | `route()`/`defineRoute()` wrapper: auth `member`, `cache: "private-etag"`, rate-limit specs `{bucket, limit, windowSec, by}`, the registry `sideEffects` list and the GET-purity check (AP-09), `Server-Timing`, the `ctx.now` from `x-rc-now` (TE X5). The `CT` envelope and registry. `api()` with transparent 304 and `devSchema()` (AP-12, AP-21). `qk`, `QueryProvider`, `fallbackInterval` with the AP-20 fix. The flags registry. `isNonProd()` + the test-hook registry (TE X12). The telemetry registry and sinks (TE X6). The leased persona pool and `scripts/dev/personas.ts --reset` (TE X4). The state-coverage manifest (X8). Visual tooling (X10). The UI kit (`Tabs`, `Segmented`, `Checkbox`, `Sheet`, `ProgressBar`, `Tag`, `Banner`, `Skeleton*`, `EmptyState`, `InfoButton`, `Card`, `RateLimitedInline`, `ErrorState`). `lib/nav/destinations.ts`. The tiered device × zoom suite | `pnpm --filter web check-types`; `/dev/ui` renders; `check-test-globs` lists `features/**` tests. If `devSchema()` or `isNonProd()` is missing, WP1 adds the 3-line helper in P1's file and tells the P1 owner |
| P2 | `GamePlayer` (`mode`, `timeClass`, `rated`, `result`, `endedAt`, `ratingBefore`, `opponentUserId`). The R-01 fix 2.1/2.3 columns `games."whiteTitle"/"blackTitle"`, `games.source`, `game_players.source`. `Game.moves`, `moveClocksMs`, `startingFen`, `startPly`, `initialTimeSeconds`, `incrementSeconds`, `completedAt`. `ROOM.user()`. `/internal/emit` with the `targets` body and the event registry. The drift gate `scripts/db/check-drift.ts` + `DB/prisma/protected-indexes.txt` | `\d game_players` shows `source` and `endedAt`; a test event emitted to `user:{ref}` reaches a browser |
| P3 | `jobs` with `fairSeq` and `jobs_ready_idx (priority DESC, "fairSeq", "runAt")`; `JOB_PRIORITY`; the SKIP LOCKED claim; `/internal/analysis/kick`; the daily `HOUSEKEEPING` (and `DAILY_PLAN` if adopted) with the `WK/src/scheduler/recurring/` directory; `game_analyses` (`evals`, `best`, `judgements`, `lines`, `middlegamePly`, `endgamePly`, `completedAt`); `game_players.accuracy`, `phaseAccuracy`, `counts`; `games."ecoCode"`, `"openingName"`, `game_players."ecoCode"` (R-01 fix 3.4); `CA` (Win%, classifier, Divider, `codec.ts`); the final write as one `sql.transaction([...])` batch; `DB/scripts/roles/replay_worker.sql` | `SELECT count(*) FROM game_players WHERE accuracy IS NOT NULL AND cardinality("phaseAccuracy") = 3` |
| P4 | Imports that carry `ratingBefore`, `ecoCode`, `moveClocksMs`, `timeClass`, the opponent title and `source`. `LinkedAccount.importState/importDone/importTotal`. `User.ratingBand` and `User.timeZone` (M4). The analysis tiers: game 1 `USER_OPENED`, games 2–50 `IMPORT_NEWEST`, games 51–200 `BACKLOG` (P4 §8.9). The I/O lane (`WK/src/queue/lanes.ts`) and `complete.ts` | An imported Lichess game has `moveClocksMs` and an `ecoCode`; `SELECT "timeZone" FROM users LIMIT 1` works |
| P5 | `Mistake` (`themes`, `phase`, `hiddenAt`, `fen`, `setupUci`, `color`, `lastPlayedAt`, `isPuzzle`), `MistakeOccurrence (gameId, ply)`, `TrainingCard` BANK deck (`theme`, `mistakeId`, `due`, `mastery`, `suspendedUntil`), `TrainingAttempt` + `training_attempts_puzzle_idx`, `TrainingSession` (`kind` WEAKNESS already declared, `filterKey`, `theme`, `size`, `mix`, `countsTowardCap`), `TrainingProfile` (`puzzleRating`, `lastWeaknessSeenVersion`), `ThemeMastery`. The tagger `CA/src/themes/*`, the taxonomy `TRN/src/themes.ts`, `TRN/src/session.ts`, `TrainerRunner` and the summary. Puzzle shards and the selector (W2). Hub `AllTrainingList`, `ThemeMasteryBars`; Home `BankCard`; `getMe()` badges; `WEB/lib/realtime/handlers/{train,home}.ts`; J1 in `WK/src/extract/extractMistakes.ts` | `/train/bank/session` runs a DAILY session with puzzles |

P3 writes no `stats` and no `errorThemes` (`phase-03.md:896`). P6 adds both columns, computes them in the same final batch as the other three inputs, and backfills earlier rows (§6.6 B-W1). The worker also heals any row it reads with `weaknessInputsV = 0` (§7.4.2 step 4), so P6 does not block on the backfill.

---

## 3. Current code touched

Nothing weakness-related exists in the code today: `grep -rni weakness apps packages` finds only marketing copy. P6 mostly edits deliverables from P1–P5. The first table lists today's files that matter; the second lists the earlier-phase files P6 edits.

### 3.1 Files that exist at `0848b76`

| File:line | Today | P6 action |
|---|---|---|
| `WEB/prisma/schema.prisma:1-434` | 10 models, no training or weakness tables | **Untouched in P6.** The schema lives in `DB/prisma/schema.prisma` from P2, and M6 edits that copy |
| `WEB/middleware.ts:16-26` | `isProtectedRoute` lists `/play`, `/game`, `/analysis`… but not `/train` | P1 F4 inverts it to a public allow-list. **Verify** that `/train/weakness(.*)` is not on the allow-list, so it is gated. No edit if P1 shipped; otherwise add `'/train(.*)'` |
| `WEB/lib/auth/require-subscription.ts:30-58` | `requireSubscribedUser`, 402 `subscription_required` | Keep. P6 routes use `auth: "member"`, which calls it through the P1 wrapper |
| `WEB/lib/billing/copy.ts:27` | `PLAN_FEATURES` includes "Your Weakness Profile" | **Keep.** The feature is now real |
| `WEB/lib/billing/plans.ts:44,55` | Plan descriptions mention the Weakness Profile | Keep |
| `WEB/app/pricing/PricingContent.tsx:427,655` | Pricing copy and the comparison row "Weakness Profile ✓" | Keep (P11 rebuilds pricing) |
| `WEB/next.config.js:80-91` | `redirects()` holds the `/try` → `/pricing` rules | **Edit (WP7):** add `{ source: "/weakness", destination: "/train/weakness", permanent: process.env.APP_ENV === "production" }`. Dev gets a 307, and production gets a 308 from P13, because browsers cache a 308 for good (feasibility §9, P8 row). If P1 split redirects into `WEB/config/redirects/<phase>.mjs` (feasibility §7), the rule goes in `p6.mjs` instead |
| `WEB/lib/rate-limit.ts:13-38` | In-memory limiter | Not used. P1 replaced it with the fixed-window `rate_limit_buckets` |
| `WEB/app/components/ChessBoard.tsx` | 863-line interactive board | **Not used.** The weakness example boards are `MiniBoard` SVGs (P5), with no chess.js on this route |
| `REPO/docs/implementation-plan.md:159-165` | Old "Phase 6 (≈1 week)": `MoveEval` aggregation, a "fewer than 10 games" insufficient threshold, a nightly job | **Edit (WP7):** replace the section with a pointer to `docs/plan/phase-06-weakness-profile.md`. Record the changes: threshold 20 with preliminary from 5 (D8/X15/R-WK-04), packed `GamePlayer` inputs instead of `MoveEval` (data-model D10), no nightly job and no Vercel cron |
| `DR/../WeaknessProfile.dc.html`, `AndroidWeaknessProfile.dc.html`, `v2/V2WeaknessProfile.dc.html` | v1/v2 explorations | Superseded. Used for ideas only |

### 3.2 Earlier-phase deliverables P6 edits (each edit has a single owner in §13)

Shared registries are edited in their directory form when P1 adopted it (feasibility §7): P6 **adds a file** and one barrel line. When P1 kept a single file, the edit is a one-line append.

| File (owner phase) | P6 change | WP |
|---|---|---|
| `DB/prisma/schema.prisma` (P2) | M6 models and columns (§6.1) | WP3 |
| `DB/prisma/protected-indexes.txt` (P2) | + `jobs_user_active_idx` | WP3 |
| `DB/scripts/roles/replay_worker.sql`, `replay_app.sql` (P3, P1) | Grants for the new columns and table (§6.2.3) | WP3 |
| `DB/src/jobs.ts` (P3) | `RecomputeWeaknessPayload` (zod). `JOB_PRIORITY.WEAKNESS = 20` already exists (CC R-05); add it if P3 left it out | WP1 |
| `CA/src/codec.ts` (P3) | + `STATS_V1` and `ERROR_LOG_V1` encode/decode (append-only) | WP3 |
| `CA/src/themes/index.ts` (P5) | Export `tagErrorPly(input)`, a thin wrapper that runs the Tier-1 detectors and `rc:*` heuristics on one error ply (§8.3.2). No detector changes | WP3 |
| `WK/src/handlers/analyzeGame.ts` (P3) | Add the five input columns to the existing `UPDATE game_players … FROM jsonb_to_recordset(…)` statement of the final `sql.transaction([...])` batch. Replace data-model §7.3 statement 7 (the per-hour weakness enqueue) with the §7.4.1 upsert as one more statement in the same batch. Call `maybeEmitWeaknessProgress()` after commit | WP4 |
| `WK/src/extract/extractMistakes.ts` (P5 J1) | Add `rc:timePressure` to `Mistake.themes` when the occurrence's clock was < 60 s (§8.12) | WP4 |
| `WK/src/jobs/import-sync.ts` + `WK/src/import/progress.ts` (P4) | On finish: `ensureWeaknessCoverage()` + `enqueueWeakness(trigger:'import')`. On each page: `maybeEmitWeaknessProgress()` | WP4 |
| `WK/src/queue/lanes.ts` (P4) | Add `RECOMPUTE_WEAKNESS` to the I/O lane's `kinds`, so it never waits behind Stockfish | WP4 |
| `WK/src/queue/complete.ts` (P4) | A `rerunIfFlagged` completion (§7.4.1), next to P4's `reschedule` result | WP4 |
| `WK/src/scheduler/recurring/` (P3) | New slice file `weakness.ts`: the weekly roll, the heal sweep and the prune, called from the daily housekeeping run (§7.4.6) | WP4 |
| `CT/http/train.ts` (P5) | `SessionCreate` gains the `weakness` member; the `SessionSummary` eyebrow variant | WP1 |
| `CT/socket/user.ts` + `CT/socket/registry.ts` (P2) | + `weakness:progress`, `weakness:ready` schemas and registry entries; add both to the worker caller's allow-list where one exists (AP-44) | WP1 |
| `TRN/src/themes.ts` (P5) | + `weaknessCandidate: boolean`, `weaknessLabel` and `lichessMatch` per key; + the key `rc:timePressure` (never primary) | WP1 |
| `TRN/src/session.ts` (P5) | `kind: "weakness"` dispatches to `TRN/src/weakness/drill.ts` (§8.11) | WP5 |
| `WEB/lib/train/sessions.server.ts` (P5 W2) | The own-item query Q-W7 and the puzzle fill for `kind:"weakness"` | WP5 |
| `WEB/lib/train/today.server.ts` (P5 R1, `getTrainToday`) | `allTraining.weakness`, the plan focus theme, `plan.basis: "games20"` | WP7 |
| `WEB/lib/home/home.server.ts` (P5 HOME-1, `getHomeData`) | `bank.topTheme` line | WP7 |
| `WEB/lib/auth/viewer.ts` `getMe()` + `WEB/lib/train/badges.server.ts` + `WEB/app/api/me/badges/route.ts` (P5) | `weaknessReady`, `trainDot` | WP7 |
| `WEB/components/train/hub/AllTrainingList.tsx`, `ThemeMasteryBars.tsx` (P5) | Render the weakness row and the "Weakness profile" link | WP7 |
| `WEB/components/home/BankCard.tsx` (P5) | Top-theme line | WP7 |
| `WEB/lib/nav/destinations.ts` (P1, edited by P5) | `weakness` destination (parent `train`, chord `g w`, enabled by the flag) | WP7 |
| `WEB/lib/realtime/useUserChannel.ts` event router (P4) | Register the new handler module `WEB/lib/realtime/handlers/weakness.ts` (one line) | WP6 |
| `WEB/lib/realtime/resync.ts` (P1) | Add `qk.train.weakness()` to the reconnect resync list | WP5 |
| `WEB/lib/test-hooks/registry.ts` (P1) | Register the P6 hooks (§7.10) | WP8 |
| `WEB/app/(marketing)/how-we-grade/page.tsx` (P3) | Add the `#weakness` section, which reads `TRN/src/weakness/constants.ts` | WP7 |
| `WEB/scripts/explain-hot-queries.ts` (P1/OPT) | + Q-W1…Q-W13 and the index names of §6.5 (index existence check, AP §5) | WP8 |
| `WEB/e2e/personas/weakness.ts` (P1 persona registry) | The leased persona writers (§12.4) | WP8 |
| `DB/prisma/seed/personas.ts` (data-model §13) | + seed personas `weakcompute`, `weakfail`, `bullet`, `noclock`; weakness state for `trial`, `member`, `new` | WP8 |

---

## 4. Screens

### 4.1 Route map

| Route | Group | Boards | Render |
|---|---|---|---|
| `/train/weakness` | `(app)` (members; `requireMemberPage()`; flag `weakness`) | `V3WeaknessInsufficient`, `V3WeaknessComputing`, `V3WeaknessProfile` (+ `V3iPhone/Android/iPadL/iPadPWeaknessProfile`) | dynamic RSC + `HydrationBoundary` |
| `/train/weakness/[pattern]` | `(app)` | `V3WeaknessDrill` (desktop). On iPad P and phones, a bottom sheet over the profile | the same page component with `selected=pattern` |
| `/train/weakness/loading.tsx` | — | `V3WeaknessProfile` `loading`. The board's loading branch is empty, so the P1 `V3Skeletons` conventions apply | streaming skeleton |
| `/weakness` | redirect | — | 307 (dev) / 308 (production, P13) → `/train/weakness` |
| `/dev/ui/weakness?state=&device=&lesson=1&stress=1` | test hook, `isNonProd()` only (404 elsewhere; gated on `APP_ENV`, never on `VERCEL_ENV`, because `replay-chess-dev` deploys with `target: production`, feasibility #3) | every state from fixtures; `lesson=1` fills the P8 slots; `stress=1` uses the longest labels and names | client |

`[pattern]` is the **slug** of the pattern key (`TRN/src/weakness/slug.ts`). CamelCase keys become kebab-case (`hangingPiece` → `hanging-piece`, `backRankMate` → `back-rank-mate`), and `rc:` keys drop the prefix (`rc:timePressure` → `time-pressure`, `rc:missedThreat` → `missed-threat`). An unknown slug, or a pattern that is not among the profile's rows, redirects with `redirect('/train/weakness')`.

**Design-state coverage (TE X8).** All 19 enum values of the 8 boards are tagged in the specs:
- `V3WeaknessInsufficient`, `V3WeaknessComputing` and `V3WeaknessDrill` each carry `insufficient · computing · drill` (one shared DCLogic): 9 values.
- `V3WeaknessProfile` and its 4 device boards carry `default · loading`: 10 values.

Real-data tags (`@state:<Board>.<value>`) come from leased personas. The 5 `loading` values are reached for real by delaying the RSC response with `page.route` in the device suite, so no state is demo-only.

### 4.2 State model of the page (server-decided status + client view state)

```
                 ┌──────────── loading (route skeleton) ────────────┐
                 ▼                    ▼                 ▼           ▼
          insufficient ──(import starts / ≥20 in scope, analysis queued)──► computing
              │  ▲                                                     │   │
              │  └──(scope shrinks / games deleted)── ready ◄──(weakness:ready, READY)┘   │
              │                                        │  ▲                         │
              └────(5..19 analysed: preliminary list updates on weakness:ready)     │
                                                       │  └─(weakness:ready)─ updating (ready + recompute queued)
                                       failed ◄────────┼───────(job exhausted, no READY)◄┘
                                         └──Retry (TR-12)──► computing
computing (orphaned: ≥ 5 analysed, no snapshot, no job) ──auto POST TR-12 once per mount──► computing
ready (view state): open row i (default 0) · showAll · tab ∈ {phase, clock, open, str*} · selected pattern (drill config)
drill config: default(10, mix) · size20 · mixOff · unmatched · few · zeroOwn · empty · starting · startError · rateLimited
```

`*` `str` (Strengths) is a tab only in `tabbar:` mode and on iPad L. Desktop shows the "What you already do well" box instead.

### 4.3 Layout rules shared by every state (DS README "Layout: one viewport", P1 SPEC variants)

- The root is P1 `ViewportStage` (page variant). `document.scrollingElement.scrollHeight <= innerHeight` always holds. Only two regions scroll: the Top-weaknesses panel (desktop, iPad L) and the content column (`.scol`) in `tabbar:` mode.
- There is no interactive board on this screen. Example positions are `MiniBoard` SVGs (P5): 132 px on desktop, 96 px at `vh700:`, on iPad and on phones. They use `article-board-*` squares, have no coordinates, and carry `role=img` with the label "Missed forks: example position from your games".
- Type: one serif title per screen (`PageHeader`, 28–36 px, `clamp(1.75rem,3.6vh,2.25rem)` on desktop, 28 px on iPad L, a 17 px top-bar title on phones), the headline in serif `clamp(1.25rem,2.6vh,1.625rem)` (22 px on devices), body 14–15 px, labels 11 px mono uppercase.
- Hit targets are ≥ 44 CSS px (row headers have min-height 60 px; buttons use `min-h-11`).
- Zoom:
  - 80 % (1800×1125) caps the content at `max-w-[1280px]`, centred.
  - At 125 % (1152×720) the `vh700:` density applies.
  - At 150 % (960×600) the `narrow:` rail (64 px) and `vh640:` apply: the nav subs and the week plan (`.tall`) are hidden.
- Long data (the `stress=1` fixture, TE X9) must still fit: labels up to 40 characters ("Missed 'remove the defender'"), opening names up to 60 ("Sicilian Defense: Najdorf Variation, English Attack" is truncated with an ellipsis and a `title`), 3-digit game counts, and 5 rows open in "See all".

### 4.4 S1: Insufficient (`status = insufficient`)

**Boards.** Desktop `DR/V3WeaknessInsufficient.dc.html` (state `insufficient`; extract `EX/V3WeaknessInsufficient.txt`). There is no device board; the device layouts are derived below.

**Layout.**

| Device | Layout |
|---|---|
| Desktop 1440×900, 1280×800 | Sidebar (`V3Nav current=train sub=weak`); the main column `max-w-[1280px]`, vertically centred (`align-items: safe center`). **Header row:** h1 "Weakness profile", the scope label ("Rapid and blitz · since Aug 2026"), a spacer, and the text link "How this is calculated" → `/how-we-grade#weakness`. **Body:** a 2-column grid (`1fr 1fr`, gap 40, items centred). **Left:** Tag `warn` "Preliminary"; h2 serif `clamp(2rem,4.4vh,2.75rem)`; an 8 px `ProgressBar` with the mono caption "14 / 20 games analysed"; a primary CTA (`max-w-[460px]`); a secondary row link. **Right:** the label "What we can see so far"; ≤ 3 `Card` rows (min-height 64: label + "Seen in 5 of 14 games" + Tag `warn` "Preliminary"); then a 13 px note "Under 20 games a pattern can be chance. How this is calculated" |
| iPad L 1194×834 | Rail + the same 2 columns (gap 24) |
| iPad P 834×1194, iPhone 393×852, Android 412×915 | Top bar (Back → `/train`, title, ⓘ → `/how-we-grade#weakness`); a `.scol` single column, gap 14: tag, h2 (26 px), meter, CTA full width, secondary row, preliminary cards, note. Tab bar (Train current) |

**Sub-states and copy** (copy from the board unless marked *new*).

| Sub-state | When | h2 | Right column |
|---|---|---|---|
| `zero` | analysed 0 and in scope 0 | *new* "Play or import 20 games and we can tell you what keeps costing you points" | `EmptyState` (card size): "Nothing Yet" / "Patterns show after 5 analysed games." |
| `few` | analysed 1–4 | "{20−n} more games and we can tell you what keeps costing you points" | the same empty state |
| `preliminary` | analysed 5–19 | the same | ≤ 3 preliminary rows (§8.10) |
| `bullet_offer` (modifier) | in scope < 20 **and** bullet games in the window ≥ 20 − in scope | — | `Banner tone="info"` above the grid: *new* "You have {n} bullet games from the last 6 months. Include them?" + Button "Include bullet games" (TR-12 `{timeClasses:[BULLET,BLITZ,RAPID]}`) |
| `linked` (modifier) | a linked account exists and its import is idle | — | The primary CTA becomes *new* "Check for new games" → `/settings/connected` |

**CTAs.** The primary "Import games from Chess.com or Lichess" goes to `/settings/connected` (P4). The board links `V3OnbLink`, but members past onboarding use Connected accounts. The secondary "Or play {20 − inScope} more games here" goes to `/play` and counts only games that count (§8.2). It is hidden when `20 − inScope ≤ 0`.

**Transitions.** `import:progress` or `weakness:progress` → computing (the page refetches on `weakness:progress` if the cached status is insufficient). `weakness:ready` → refetch (new preliminary rows, or ready).

**Accessibility.** The meter is `role=img aria-label="14 of 20 games analysed"`. Preliminary rows are a `ul` of non-interactive items. The banner is `role=status`.

### 4.5 S2: Computing (`status = computing`)

**Boards.** Desktop `DR/V3WeaknessComputing.dc.html` (state `computing`; its DCLogic shows the 4 steps and the `ready` panel at 100 %).

**Layout.**

| Device | Layout |
|---|---|
| Desktop and iPad L | The same header. A 2-column grid (gap 40) in one `role=status aria-live=polite` region. **Left:** the label "Building your profile", h2 "Analysing {N} games", an 8 px `ProgressBar`, the mono line "{pct}% · {eta}", and the note "You can leave this page. We'll show a dot on Train when it's ready." **Right:** an `ol` of 4 steps. Each `li` has a state icon (done ✓ / running dot / waiting ring), the step label and a 4 px bar |
| Phones, iPad P | One column in `.scol`: the left block, then the steps |

**Steps** (§8.13 gives the formulas):
1. "Import {importTotal or inScope} games"
2. "Grade every move with Stockfish"
3. "Find patterns across games"
4. "Compare with players rated {band label}" ("Compare with players at your level" while the band is unknown)

**Sub-states.**

| Sub-state | When | Copy |
|---|---|---|
| `progress` | default | ETA from §8.13: "about {n} minutes left", "about a minute left" (< 90 s), "about {h} hours left" (> 90 min), "Working…" when unknown. The board's fixed "about a minute left" is **replaced** (rct-b Q3) |
| `stalled` | `stalled = true` (§8.13) | *new* "Taking longer than usual. We'll keep going in the background." The bar stops animating |
| `orphaned` | `progress.orphaned = true`: ≥ 5 analysed in scope, no snapshot, no active job (§8.14) | Looks like `progress`. On mount, the client sends one TR-12 `{}` (§5.4, "auto-build"). This replaces the old GET-side heal (AP-09) |
| `ready_flash` | The client watched `computing` and the refetch returned `ready` | Board copy: label "Ready", h2 "Your profile is ready", the headline text, Button "See your weakness profile". Click (or `Enter`) swaps to S3 without a request, because the data is already in the cache |
| *new* sub-line under h2 when `N > 20` | — | "Your profile appears after the first 20; the rest keep improving it." |

**Live announcements.** Polite announcements fire at 25, 50, 75 and 100 % only. The status text node outside those milestones has `aria-live=off`.

### 4.6 S3: Profile (`status = ready`)

**Boards.**

| Device | Board | Notes from the markup and CSS |
|---|---|---|
| Desktop 1440×900 | `DR/V3WeaknessProfile.dc.html` (enum `default, loading`) | `.main.fit` overflow hidden; `.wkgrid` `minmax(0,1.25fr) minmax(0,1fr)`, gap 20; `.whead` grid `24px 1fr 150px 24px`, min-height 60; `.wbody` `132px 1fr`, padding `0 14px 14px 50px`. Tabs **By phase, Clock, Openings** (3) plus a "What you already do well" box. `.tall` (week plan) hidden at `max-height:640px` |
| iPad L 1194×834 | `DR/V3iPadLWeaknessProfile.dc.html` | Rail; h1 28 px; grid `1.2fr 1fr`, gap 16; whead `20px 1fr 92px 20px`; wbody 96 px; **4 tabs** (+ Strengths); the week plan is present; no visible "Top 3" label (the section keeps its `aria-label`) |
| iPad P 834×1194 | `DR/V3iPadPWeaknessProfile.dc.html` | Top bar (Back, title, ⓘ), `.scol` single column, 4 tabs, **no week plan**, tab bar |
| iPhone 393×852 | `DR/V3iPhoneWeaknessProfile.dc.html` | As iPad P; frame padding 54/34 (safe areas); headline 22 px; "Top 3 · per 100 moves vs 1100–1300" |
| Android 412×915 | `DR/V3AndroidWeaknessProfile.dc.html` | As iPhone (only the nav hrefs differ) |
| 1280×800 | the desktop board, checked at the smaller size | Fits without `vh700:` (800 > 700) |

**Desktop layout (top to bottom, inside one viewport).**

1. **Header (56–64 px):** h1 "Weakness profile"; the label `scopeLabel` ("212 games · rapid and blitz · since Aug 2026"); a spacer; `btn-t` "How this is calculated"; `btn-s` "‹ Train" (min-height 44) → `/train`.
2. **Headline row:** a serif paragraph (max 62ch) + `Tag variant="verified"` "VERIFIED" (`.ver`: `#4f6b3a` on white). When `updating` is set, add `UpdatingChip`, *new* "Updating with {n} new games…" (`role=status`).
3. **Grid** (`flex:1 1 auto; min-height:0`, `align-items:start`, children `max-height:100%`):
   - **Left `section` "Top weaknesses"** (`overflow-y:auto` inside its panel). The label "Top 3 · per 100 moves, you vs players rated {band}". Then 3 `WeaknessRow`s, then the `MoreRow` "{n} more patterns found. All {total} have drills." with `btn-t` "See all", which toggles rows 4–5 **in place**. The board's lock icon is replaced by a list icon (copy note C7).
   - **Right column** (flex column, gap 14):
     - `WeekPlanCard` (`.tall`: hidden at `vh640:`), label "This week's plan from your profile", 2 rows in P6 (§8.15) and a third `lesson` row only when `weekPlan` carries one (P8).
     - `BreakdownCard` with underline `Tabs`: By phase | Clock | Openings.
     - `StrengthsBox` "What you already do well" (≤ 2 sentences).
     - The footnote "Updated after every analysed game. Patterns under 20 games are marked Preliminary."
   - At `narrow:` (≤ 1100 wide) the grid becomes `minmax(0,1fr) 340px` and the bar column 100 px. At `vh700:` the padding becomes 14/24, the thumbnails 96 px and the clock bars 110 px tall.

**`WeaknessRow` anatomy** (board `.wrow`/`.whead`/`.wbody`):

- **Header** `button[aria-expanded][aria-controls]` with 4 grid columns:
  - the rank (mono, 50 % ink);
  - the label + the trend line (13 px, 62 % ink: "Getting worse this month" / "About the same" / "Improving" / *new* "Not enough recent games for a trend");
  - `RateBar` (`role=img aria-label="You 3.1 per 100 moves, rating band 1.6"`): two 5 px bars (you: `--cb-accent` #3d3229; band: 25 % ink) with mono values. Bar widths are `value / scaleMax`, where `scaleMax = max over rows of max(you, band) × 1.15` (min 1.0). The board hard-codes 4.5;
  - a chevron rotated −90°, which turns when open.
- **Body** (when open; `fadein` 150 ms, none under reduced motion):
  - `MiniBoard` 132/96 px;
  - the `where` line ("Middlegame · 7 of the last 20 games");
  - actions: Button primary "Drill · {inBank} in bank" → `/train/weakness/{slug}`, then `LessonLink` "Legend lesson: {title}" → `/learn/lessons/{slug}?from=weakness`, rendered **only when `row.lesson != null`** (always null until P8; `lesson=1` fixture in the demo route);
  - with no example position, the body is text and actions only.
- **Time-pressure row:** the label is "Time-pressure blunders", the rate reads "You 4.0 under 1 min · band 2.2", and the unit is `per100_under1min`.
- **No band** (`band = null`): a single bar, the label reads "Top 3 · per 100 moves", and the `aria-label` is "You 3.1 per 100 moves".

**Tabs content** (all the data is in the one payload, so switching tabs makes no request):

| Tab | Content (board copy; numbers from §8.7–8.9) |
|---|---|
| By phase | The template sentence (§8.7). 3 rows "Opening / You 88 · band 84" with two horizontal bars each; a bar below the band uses the `--cb-bad` tint (board `worse`). Legend "You · Players rated 1100–1300" |
| Clock | "Blunders per 100 moves, by time left on your clock." + the template clause ("Below 2 minutes the rate triples."). A 4-bar column chart (> 5 min, 2–5 min, 1–2 min, < 1 min), 140 px tall (110 at `vh700:`), with `role=img` and an `aria-label` that is the **full sentence** listing every value (TE P6 a11y). **Hidden** when `breakdown.clock = null`; the panel footnote then reads *new* "These games have no clock data, so there is no Clock tab." |
| Openings | A real `table` (`th` Family / Games / Score). Rows: "Two Knights Defence" + the muted ECO range "C55–C59" + " · Most played"; games; score %. ≤ 4 rows. Empty: *new* "Not enough games per opening yet." |
| Strengths (devices and iPad L only) | The same 1–2 sentences as the desktop box. Empty: *new* "Nothing stands out yet. Strengths show once a pattern holds across 20 games." |

**Phone and iPad P layout** (`.scol`, gap 14):

1. The label `scopeLabelShort` ("212 games · since Aug 2026").
2. The `headline.short` paragraph (22 px) + VERIFIED.
3. The section "Top 3 · per 100 moves vs 1100–1300": rows with whead `20px 1fr 92px 20px` and wbody `96px 1fr`.
4. The more row.
5. The breakdown section with 4 tabs; the tab list is `overflow-x:auto` with the active tab scrolled into view (P1 `Tabs` behaviour).

There is no week plan and no strengths box. The bottom tab bar shows Train as current. The Drill button opens the **drill sheet** (§4.7).

**Sub-states.**

| Sub-state | When | Change |
|---|---|---|
| `default` | — | Row 0 open, tab `phase` |
| `loading` | navigation into the route | §4.9 |
| `see_all` | the user clicked See all | Rows 4–5 shown (collapsed). The link turns into "Show fewer" |
| `few_patterns` | 1–2 eligible patterns | Only those rows. The label is *new* "Top {n} · per 100 moves, you vs players rated …". The more row is hidden |
| `none_eligible` | 0 eligible patterns | Headline *new* "Nothing stands out against players at your level. Your mistakes are spread across many patterns." (still VERIFIED). The rows show the 3 most frequent patterns under the label *new* "Most frequent in your games · per 100 moves", without band bars or trend |
| `no_band` | rating unknown and no onboarding band | See the row anatomy above |
| `no_clock` | clock data missing | The Clock tab and its footnote are hidden. The headline drops the clock clause |
| `updating` | ready + a recompute or analysis pending | The chip. The data refreshes on `weakness:ready` |
| `top_changed` | after an update, `top[0].pattern` changed | Toast (*new*): "Your weakness profile changed: {label} is now your top pattern." |

### 4.7 S4: Drill a weakness (`/train/weakness/[pattern]`)

**Board.** Desktop `DR/V3WeaknessDrill.dc.html` (state `drill`). Its DCLogic gives the size buttons, the mix checkbox and the label formulas: `drillLbl = 'Start drill · ' + size + ' positions · ~' + round(size·0.5) + ' min'`; `own = mix ? round(size·0.6) : min(inBank, size)`; `mixLbl`.

**Layout.**

- **Desktop and iPad L.** This is the profile layout with the selected row's body replaced by `DrillConfig`, matching the drill board's row anatomy. The header shows the Tag "Selected" instead of the chevron. The other rows' headers show a secondary "Drill" button instead of the chevron.
  - `DrillConfig` is a 2-column grid (`1fr 1fr`, gap 24, padding `14px 16px 16px 58px`, background `--cb-page`).
    - **Left:** the label "Drill {label lower}"; `Segmented` `aria-label="Drill size"` with "10 positions" / "20 positions" (radio semantics, P1 `Segmented`; the board's `aria-pressed` chips map to it); `CheckboxRow` "Fill with matched Lichess puzzles"; the mix line (14 px, 66 % ink).
    - **Right:** the primary Button `drillLbl` (full width), then the legend-lesson row "Legend lesson: {title} · {sub}" (board: "Tal vs Smyslov, 1959 · A world champion's forks, then play it out"), rendered only when `row.lesson != null` (P8).
  - At `narrow:` the config stacks into one column.
  - The headline and the right column stay, so the page still fits one viewport. The config adds about 150 px; the left panel scrolls if needed.
- **iPad P and phones.** A P1 `Sheet` (side `bottom`, max height 70 % of the viewport, drag handle, title "Drill {label lower}") over the profile. It holds the same `DrillConfig` in one column, with the CTA full width and pinned to the sheet bottom, and safe-area padding. Opening the sheet runs `history.pushState` to `/train/weakness/{slug}`, so Back and `Esc` close it.
  - The phone boards link "Drill · 12 in bank" straight to `V3BankSession`. This plan keeps the config step (decision D-P6-9). The default stays 10 + mix, so the user needs one extra tap.

**Sub-states.**

| Sub-state | When | Copy and behaviour |
|---|---|---|
| `default` | size 10, mix on (when matchable) | "6 from your games + 4 matched Lichess puzzles near {R}" |
| `size20` | — | "12 from your games + 8 matched…", CTA "~10 min" |
| `mixOff` | checkbox off | "{min(inBank,size)} from your games only ({inBank} in your bank)". If `inBank < size`, the CTA counts the real size: "Start drill · 7 positions · ~4 min" (`few`) |
| `unmatched` | the pattern has no Lichess theme (`rc:pawnStructure`, …) or is `rc:timePressure` | The checkbox is `disabled` and described by *new* "No matching puzzles for this pattern" / "Matched puzzles have no clock, so this drill uses your own positions only" (time pressure) |
| `zeroOwn` | `inBank = 0` and matchable | The checkbox is checked and disabled; copy (rct-b W2): "All your fork positions are mastered; this drill uses matched puzzles" |
| `empty` | `inBank = 0` and not matchable | The CTA is disabled; *new* "No positions to drill yet. They're added as your games are reviewed." |
| `starting` | the TR-7 call is pending | Button spinner, `aria-busy`, controls disabled |
| `startError` | 5xx or network error | Toast "Couldn't start the drill" + Retry, with the request id. The config stays |
| `rateLimited` | 429 `train-session` (30 / 3600 s) | `RateLimitedInline` "Too many sessions. Try again in m:ss" under the CTA |

### 4.8 S5: Failed (`status = failed`, not designed; rct-b Q15)

The same header. A centred P1 `ErrorState` (`inline` variant, region-centred) reading *new*: "We couldn't build your profile" / "Something went wrong while comparing your games. Your games and Mistake Bank are fine." It has a primary Button "Retry" (TR-12), shows the "Event ID" (request id) only when the failure came from a request, and keeps the text link "How this is calculated".

Sub-states (the V3Error500 pattern): `default` → `retrying` (button spinner) → computing, or `failed_again` (the same copy plus "If this keeps happening, contact hello@playchess.tech"). A 429 shows `RateLimitedInline` with a countdown.

### 4.9 Loading (`loading.tsx`)

`WeaknessSkeleton` (P1 `SkeletonRegion` + `Skeleton`): the real header (h1 static, scope label skeleton), 2 headline lines, then the grid with 3 `GhostRow`s of 60 px on the left and a tabs strip plus 3 bar skeletons on the right. On phones it is one column. `aria-busy="true"` with "Loading…". The shimmer is static under reduced motion. There is only one loading layer, because the RSC seeds the client queries (client-data-layer §8.2 rule 4).

### 4.10 Components (P1 UI kit + P5 + new in P6)

| Component | From | Used for |
|---|---|---|
| `PageHeader`, `Button`, `IconButton`, `Tag` (warn/verified/neutral), `Banner`, `Card`, `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent` (underline), `Segmented`, `CheckboxRow`, `ProgressBar`, `Sheet`, `Skeleton`/`SkeletonRegion`/`GhostRow`, `EmptyState`, `ErrorState`, `RateLimitedInline`, `InfoButton`, `Toast` (`notify`) | P1 `WEB/components/ui/*` | everywhere |
| `AppShell`, `V3Nav` sub-nav, `PhoneTopBar`, `TabBar`, `ViewportStage` | P1 `WEB/components/shell/*`, `components/layout/*` | the shell |
| `MiniBoard` (SVG, works on server and client, no chess.js) | P5 `WEB/components/train/MiniBoard.tsx` | example positions |
| **New** in `WEB/components/train/weakness/`: `WeaknessScreen` (client root), `WeaknessHeader`, `WeaknessHeadline`, `UpdatingChip`, `WeaknessList`, `WeaknessRow`, `RateBar`, `MoreRow`, `LessonLink`, `DrillConfig`, `DrillSheet`, `WeekPlanCard`, `BreakdownCard`, `PhaseBars`, `ClockHistogram`, `OpeningsTable`, `StrengthsList`, `StrengthsBox`, `InsufficientPanel`, `InsufficientMeter`, `PreliminaryList`, `BulletOfferBanner`, `ComputingPanel`, `ProfileProgress`, `FailedPanel`, `WeaknessSkeleton`, `copy.ts`, `__fixtures__/payloads.ts` (incl. `lesson` and `stress` variants) | P6 | — |

### 4.11 Interactions and keyboard

| Input | Effect |
|---|---|
| `g` then `w` (chord; fine pointers; outside fields; P1 D20) | Go to `/train/weakness`. Listed in the `?` dialog under "Train" as "G W · Weakness profile" |
| ⌘K "Weakness profile" | Palette destination (from `destinations.ts`) |
| Row header click / `Enter` / `Space` | Toggle the row; one row is open at a time (board `open` index) |
| `↓` / `↑`, `Home` / `End` on a row header | Move focus between row headers (WAI-ARIA accordion optional keys) |
| Tabs: `←` / `→`, `Home` / `End` | Radix automatic activation; `history.replaceState` writes `?tab=` (no RSC request) |
| "Drill · n in bank" / "Drill" | Desktop: `history.pushState('/train/weakness/{slug}')`, and the row expands into the config. Phones: the sheet opens |
| Size: `←` / `→` inside the segmented group | 10 ↔ 20 |
| `Space` on the checkbox | Toggle mix |
| `Enter` on the CTA | Start the drill |
| `Esc` | Close the config (back to `/train/weakness` with `history.back()` when we pushed the entry, otherwise `replaceState`) or the sheet |
| "See all" / "Show fewer" | Toggle rows 4–5; focus moves to row 4's header |
| "See your weakness profile" (ready flash) | Switch to S3; focus moves to the h1 |
| Retry / Include bullet | TR-12 mutation (§5.4) |

There are no single-letter page shortcuts (P1 D20 reserves single keys).

### 4.12 Copy notes (to confirm with the owner or design)

| # | Board text | Plan |
|---|---|---|
| C1 | "about a minute left" (Computing) | A real ETA from worker throughput (rct-b Q3) |
| C2 | "Steady" (drill board) vs "About the same" (profile board) | "About the same" everywhere |
| C3 | "Time pressure blunders" vs "Time-pressure blunders" | Hyphenated |
| C4 | Clock tab "< 1 min 3.4" vs row "4.0 under 1 min" in the mock data | One computation; real data matches (§8.8) |
| C5 | "players rated 1100–1300" | The same label. "How this is calculated" adds "rated on Lichess" and explains the Chess.com conversion (R-WK-02, D-P6-5) |
| C6 | "Or play 6 more games here" | Counts only games that count (D-P6-6: no bot games) |
| C7 | Lock icon on "2 more patterns found. All 5 have drills." | A list icon, because nothing is locked under paid-only. "See all" expands in place |
| C8 | Legend lesson rows | Built, hidden until P8 returns a lesson (§7.6) |
| C9 | Added copy (failed, stalled, updating, bullet offer, no clock, none eligible, unmatched, empty, trend unknown, top changed) | Written in the UX copy pass. The strings live in `WEB/components/train/weakness/copy.ts` |
| C10 | "won endgames" (strength sentence) | "won positions", because +3 can happen in the middlegame (§8.20) |

---

## 5. UI ↔ API data flow (client-data-layer conventions)

### 5.1 Channels per screen

| Screen | First paint (RSC) | Client reads | Mutations | Push | Fallback poll |
|---|---|---|---|---|---|
| `/train/weakness` (all statuses) | `getWeakness(viewer)` → `qc.prefetchQuery(qk.train.weakness())` → `HydrationBoundary` | `weaknessQuery()` (TR-5, ETag) on focus when stale, and after events | TR-12 (Retry, Include bullet, auto-build); TR-13 (seen) | `weakness:progress` → `setQueryData`; `weakness:ready` → invalidate | Only while `computing`/`updating` **and** the socket is down **and** the tab is visible: 3 s × 20, then 10 s; stops after 15 min |
| `/train/weakness/[pattern]` | the same loader (no extra read); `selected` comes from the params | the same | TR-7 `{kind:"weakness"}` | the same | the same |
| Train hub `/train` (P5) | `getTrainToday()` adds the snapshot read | `qk.train.today()` | — | `weakness:ready` → mark `train.today` stale (no refetch) | — |
| Home `/home` (P5) | `getHomeData()` adds the snapshot read | `qk.home()` | — | `weakness:ready` → mark `home` stale (no refetch). P5's 30 s throttled Home invalidation (AP-10) still applies | — |
| Shell nav dot | `getMe()` badges (P5) | `qk.me()` badges, or `ME-2` while the socket is down | — | `weakness:ready` → patch `me.badges.weaknessReady` | ME-2 **on focus, and at most every 10 min** while the socket is down and the tab is visible. 5 minutes would equal Neon's suspend window and keep the compute awake by itself (AP-08 item 4) |

### 5.2 RSC page

```tsx
// WEB/app/(app)/train/weakness/page.tsx (server)
export default async function WeaknessPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const viewer = await requireMemberPage();                       // P1: redirect to /pricing?reason=…&redirect_url=…
  if (!(await isFlagOn("weakness", viewer))) redirect("/train");  // P1 flags registry
  const qc = getServerQueryClient();
  await qc.prefetchQuery({ queryKey: qk.train.weakness(), queryFn: () => getWeakness(viewer) });   // DAL, not HTTP
  const { tab } = await searchParams;
  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <WeaknessScreen selected={null} initialTab={parseTab(tab)} />
    </HydrationBoundary>
  );
}
// WEB/app/(app)/train/weakness/[pattern]/page.tsx: the same, plus
//   const key = patternFromSlug(params.pattern); if (!key) redirect("/train/weakness");
//   after the prefetch: if (!payloadHasPattern(data, key)) redirect("/train/weakness");
//   <WeaknessScreen selected={key} …/>
```

- There is no `export const dynamic`; `cookies()` makes the page dynamic.
- Everything on this page is awaited. The payload is one read of about 4 KB, and nothing needs streaming. `loading.tsx` covers navigation.
- `experimental.staleTimes.dynamic = 30` (P1) lets Back/Forward reuse the RSC payload.
- The page sets no response headers (AP-14). The ETag lives only on TR-5.

### 5.3 Query definition

```ts
// WEB/lib/api/queries/weakness.ts
const isLive = (d?: WeaknessPayload) => !!d && (d.status === "computing" || d.updating != null);

// Hoisted to module scope: created once, so its start time survives re-renders and the poll really
// stops after 15 minutes (AP-20). P1's fallbackInterval keys its start on q.queryHash and resets it
// when done(q) flips from true back to false (a new computing episode).
const weaknessPoll = fallbackInterval({
  schedule: [...Array(20).fill(3_000), 10_000], stopAfterMs: 15 * 60_000,
  done: (q) => !isLive(q.state.data),                     // stops at ready / insufficient / failed
});                                                       // returns false while realtime.isLive() or document.hidden

export const weaknessQuery = () => queryOptions({
  queryKey: qk.train.weakness(),                          // ["train","weakness"]
  queryFn: ({ signal }) => api(endpoints.trainWeakness, { schema: devSchema(WeaknessPayload), signal }),
  staleTime: (q) => (isLive(q.state.data) ? 0 : 10 * 60_000),
  refetchOnWindowFocus: true,                             // refetches only when stale
  refetchInterval: weaknessPoll,
});
```

- **`devSchema()`** (AP-12) returns `undefined` in production builds. The minifier then drops the branch, and the `CT/http/weakness` schemas leave the route's client bundle. Responses are parsed in dev and test only.
- **ETag and 304.** TR-5 answers `Cache-Control: private, no-cache` with a strong ETag. `api()` uses the browser HTTP cache, so polls and refetches revalidate with `If-None-Match` automatically, and a 304 returns the cached body (client-data-layer §4.3, AP-21). No client code is needed.
- `useSuspenseQuery(weaknessQuery())` in `WeaknessScreen` never suspends on first paint, because the RSC seeded it.
- Client view state lives in `WEB/features/train/weakness/view-state.ts`, a `useReducer`: `{openIndex, showAll, tab, selected, sheetOpen, sawComputing, autoBuildSent}`. It is not in the query cache. The URL holds `selected` (path) and `tab` (`?tab=`, `replaceState`).

### 5.4 Mutations

| Mutation | Hook (`WEB/features/train/weakness/*`) | Request | Optimistic | On success | On error |
|---|---|---|---|---|---|
| Retry / Include bullet | `useRecomputeWeakness()` | TR-12 `POST /api/train/weakness/recompute {timeClasses?, months?}`. No idempotency key: the job row dedupes | **yes, for Retry:** `setQueryData(qk.train.weakness(), d => ({...d, status:"computing", failure:null, progress: initialProgress(d)}))` | `invalidateQueries(qk.train.weakness())`; mark `qk.train.today()` stale | Roll back. 429 → `RateLimitedInline` with `retryAfterSec` (no toast). 402 → the global paywall. 5xx → toast with the request id |
| Auto-build (orphaned state) | `useAutoBuildWeakness(payload)`: an effect that runs once per mount when `payload.progress?.orphaned` | TR-12 `{}` (the same route and limiter as Retry) | no | invalidate `qk.train.weakness()` | 429 is ignored (a build was requested in the last 10 minutes, so one is coming); other errors are a Sentry breadcrumb only. This POST replaces the GET-side heal (AP-09) |
| Mark seen | `useMarkWeaknessSeen(payload)`: an effect that runs once per `version` when `status === "ready" && version > seenVersion` | TR-13 `POST /api/train/weakness/seen {version}` with `keepalive: true` | **yes:** `setQueryData(qk.me(), badges.weaknessReady=false)`; payload `seenVersion = version`; the BroadcastChannel `rc-sync` tells other tabs to mark `me` stale | — | Ignored (Sentry breadcrumb); it retries on the next view |
| Start drill | `useStartWeaknessDrill(pattern)` | TR-7 `POST /api/train/sessions {kind:"weakness", pattern, size, mix}` + `Idempotency-Key` (a `useRef` uuid, regenerated whenever size or mix changes) | no (the server creates the id) | `qc.setQueryData(qk.train.session(ref), payload)` → `router.push('/train/bank/session?s='+ref)` | 400 `validation_failed` `details.reason:"empty_drill"` → the `empty` sub-state. 422 `idempotency_key_reused` → new key, one silent retry. 429 → `rateLimited`. 402 → global. 5xx → `startError` |

**Prefetch.**

- Hub and Home links to `/train/weakness` use `AppLink` (intent prefetch on an 80 ms hover, `touchstart` or focus; client-data-layer §3.8). This is safe because TR-5 and the page enqueue nothing.
- On `pointerenter`/`focus` of the drill CTA: `router.prefetch('/train/bank/session')` (the route shell).
- The week-plan puzzle row prefetches `/train/puzzles` on intent.
- There is no viewport prefetch for member routes.

### 5.5 Socket handling (`WEB/lib/realtime/handlers/weakness.ts`, registered in P4's `useUserChannel` router)

```ts
export const weaknessHandlers = defineUserHandlers({
  "weakness:progress": (e, { qc }) => {           // { v, pct, step, etaSec, stalled, analysed, target, importDone, importTotal }
    qc.setQueryData<WeaknessPayload>(qk.train.weakness(), (d) => d && d.status !== "ready"
      ? { ...d, status: "computing", progress: progressFromEvent(e, d) } : d);   // pure fn shared with the server (TRN/src/weakness/progress.ts)
  },
  "weakness:ready": (e, { qc }) => {              // { v, snapshotKey, status, version, bumped, topLabel }
    qc.invalidateQueries({ queryKey: qk.train.weakness() });                     // refetches if mounted, otherwise marks stale
    qc.invalidateQueries({ queryKey: qk.train.today(), refetchType: "none" });
    qc.invalidateQueries({ queryKey: qk.home(), refetchType: "none" });
    if (e.bumped) qc.setQueryData(qk.me(), (m) => m && patchBadges(m, { weaknessReady: true, trainDot: true }));
  },
});
```

- The `computing` → `ready_flash` transition: when the refetch after `weakness:ready` returns `ready` and `viewState.sawComputing` is true, the screen shows the ready panel first (§4.5).
- **Reconnect.** `qk.train.weakness()` is on the P1 resync list (`WEB/lib/realtime/resync.ts`). P1 decides when the list refetches: after a gap, or with AP-25's `bootId`/`useq` rule, only when events were missed.
- Neither event causes a refetch of Home or the hub, so an import backlog adds no refetch storm (AP-10).

### 5.6 Error and status handling (P1 global reactions + screen-owned)

| Code | Where | Reaction |
|---|---|---|
| 401 `unauthorized` | any | Global: session reload → `V3SessionExpired` modal |
| 402 `subscription_required` (`details.reason` ∈ `trial_available`, `trial_used`, `expired`, `payment_failed`, `paused`) | page (RSC) | `requireMemberPage()` redirects to `/pricing?reason=…&redirect_url=/train/weakness` (B26 default: hard redirect) |
| 402 | client calls | Global `paywallUrl()` redirect |
| 404 `not_found` | TR-5/12/13 while the flag is off | Treated as "feature off": the page itself redirects first |
| 400 `validation_failed` | TR-7 (`details.reason` `empty_drill` / `unknown_pattern`), TR-12/13 bodies | `empty` sub-state; malformed bodies are a bug (Sentry) |
| 422 `idempotency_key_reused` | TR-7 | New key, one silent retry |
| 429 `rate_limited` | TR-12 / TR-7 | Inline countdown on the control |
| 5xx / network on a GET that has data | background refetch | Keep the data. No toast (it is a background error) |
| 5xx / network on a GET with no data | only on the client after a hard failure | `ErrorState` inline + Retry → `refetch()` |
| Render throw | page | `(app)/error.tsx` = `V3Error500` in the shell |

### 5.7 Request budget (one visit)

| Step | Requests |
|---|---|
| Hard load `/train/weakness` (ready) | 1 document (RSC). **0** `/api/*` during first paint (asserted by `request-budget.spec.ts`). Then 1 `POST …/seen` only if the dot was on |
| Hard load in the orphaned computing state | 1 document + 1 TR-12 auto-build POST |
| Tab switch, accordion, See all | 0 |
| Open the drill config | 0 (`pushState`) |
| Start the drill | 1 TR-7 + 1 RSC navigation to the runner |
| Computing with the socket live | 0 polls; progress arrives as events |
| Computing with the socket down | ≤ 20 polls in the first minute (each a 304 when nothing changed), then 1 per 10 s while visible, never after 15 min |

---

## 6. Data model (M6)

All changes are **additive (expand)** and follow data-model §5.7 and its conventions §2:
- composite keys with no cuid on high-volume child rows;
- `@db.SmallInt` where the range allows;
- JSON only for documents read whole;
- numeric arrays as `smallint[]`, never `jsonb`;
- `onDelete: Cascade` from `User` for private rows.

### 6.1 Prisma changes (`DB/prisma/schema.prisma`)

```prisma
/// M6 (Phase 6). Weekly snapshot; latest = PK backward scan. Keep 12 weeks. (data-model §5.7)
model WeaknessSnapshot {
  userId        BigInt
  /// Monday of the ISO week in User.timeZone (local date)
  weekStart     DateTime       @db.Date
  algoVersion   Int            @db.SmallInt
  /// READY | INSUFFICIENT | FAILED are written; COMPUTING is derived at read time (§8.14) and never stored in v1
  status        WeaknessStatus
  timeClasses   TimeClass[]    @default([])
  since         DateTime?
  gamesInScope  Int            @db.SmallInt
  gamesAnalysed Int            @db.SmallInt
  ratingBandMin Int?           @db.SmallInt
  ratingBandMax Int?           @db.SmallInt
  /// WeaknessMetricsV1 (DB/json/weakness.ts): rows, preliminary, breakdown, headline claims, topKeys, band, inputs watermark
  metrics       Json
  headline      String?        @db.VarChar(200)
  computedAt    DateTime       @default(now())
  user          User           @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([userId, weekStart])
  @@map("weakness_snapshots")
}

enum WeaknessStatus { INSUFFICIENT COMPUTING READY FAILED }   // data-model §8 (M6)

model GamePlayer {
  // … existing M2 (P2), M3 (P3), M4 (P4) and M5 (P5) columns …
  /// M6 (moved here from M3: P3 L896). STATS_V1 (CA/src/codec.ts), 30 slots, §8.3.1. Empty = not computed
  stats            Int[]          @default([]) @db.SmallInt
  /// M6 (moved here from M3). One entry per (error, theme) over ALL errors of this side, in error order;
  /// errorThemeN says how many belong to each error
  errorThemes      String[]       @default([])
  /// M6. ERROR_LOG_V1: one smallint per MISTAKE/BLUNDER/MISS ply of this side, in ply order:
  /// (judgement2 << 12) | (phase2 << 10) | (clockBucket3 << 7) | winLoss7
  errorLog         Int[]          @default([]) @db.SmallInt
  /// M6. For error i, how many consecutive entries of errorThemes belong to it (0..8). Σ errorThemeN = cardinality(errorThemes)
  errorThemeN      Int[]          @default([]) @db.SmallInt
  /// M6. 0 = the four arrays above are not computed for this row yet; 1 = STATS_V1 + ERROR_LOG_V1 + ordered errorThemes
  weaknessInputsV  Int            @default(0) @db.SmallInt
}

model TrainingProfile {
  // … existing M5 columns (P5 §6.2), incl. lastWeaknessSeenVersion Int @default(0) …
  /// M6. Bumped by the worker on a material profile change (§8.16); nav dot = weaknessVersion > lastWeaknessSeenVersion
  weaknessVersion     Int         @default(0)
  /// M6. Weakness scope. Empty array = default (RAPID, BLITZ). UserSettings arrives only in P9 (B14),
  /// so the scope lives here next to P5's other training prefs; P10 may move it with a contract step
  weaknessTimeClasses TimeClass[] @default([])
  /// M6. 0 = default (6). Allowed 3 | 6 | 12
  weaknessMonths      Int         @default(0) @db.SmallInt
}

model User {
  // … existing …
  weaknessSnapshots WeaknessSnapshot[]
}
```

**Why the five `game_players` columns.**
- `stats` (STATS_V1) holds per-phase, per-clock-bucket and per-piece **counts** (data-model §3.10).
- `errorThemes` holds theme **occurrences** across all errors, not only the 4 bank items per game.
- Neither can attribute an error's Win% loss, phase or clock bucket to a theme. The designed rows need exactly that: "Middlegame · 7 of the last 20 games", "especially with under a minute on your clock", and a ranking by points lost (R-WK-05). `errorLog` + `errorThemeN` answer it with about 2 B per error and no per-ply table.
- Measured shape: a `smallint[30]` is 84 B with its header. About 6 errors per analysed side gives about 9 theme entries (≈ 110 B), plus `errorLog` and `errorThemeN` (≈ 36 B each). That is about 270 B per analysed row, or about 55 KB per member at 200 analysed games.

### 6.2 Migration SQL (hand-checked; generated with `prisma migrate diff`, allocation §1.3)

#### 6.2.1 `m6a` is not written

`RECOMPUTE_WEAKNESS` is already in P3's M3 `CREATE TYPE "JobKind"` (CC R-05 ledger). WP3 checks this on day 1 with `SELECT unnest(enum_range(NULL::"JobKind"))`. If the value is missing, WP3 writes `…_m6a_jobkind_weakness/migration.sql` with `ALTER TYPE "JobKind" ADD VALUE IF NOT EXISTS 'RECOMPUTE_WEAKNESS';` as its own migration, deployed one release before any writer (data-model §2 rule 4).

#### 6.2.2 `DB/prisma/migrations/2026MMDDhhmmss_m6_weakness/migration.sql` (timestamps set when written; depends on M5)

```sql
CREATE TYPE "WeaknessStatus" AS ENUM ('INSUFFICIENT', 'COMPUTING', 'READY', 'FAILED');

CREATE TABLE "weakness_snapshots" (
  "userId"        BIGINT        NOT NULL,
  "weekStart"     DATE          NOT NULL,
  "algoVersion"   SMALLINT      NOT NULL,
  "status"        "WeaknessStatus" NOT NULL,
  "timeClasses"   "TimeClass"[] NOT NULL DEFAULT ARRAY[]::"TimeClass"[],
  "since"         TIMESTAMP(3),
  "gamesInScope"  SMALLINT      NOT NULL,
  "gamesAnalysed" SMALLINT      NOT NULL,
  "ratingBandMin" SMALLINT,
  "ratingBandMax" SMALLINT,
  "metrics"       JSONB         NOT NULL,
  "headline"      VARCHAR(200),
  "computedAt"    TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "weakness_snapshots_pkey" PRIMARY KEY ("userId", "weekStart")
);
ALTER TABLE "weakness_snapshots" ADD CONSTRAINT "weakness_snapshots_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "game_players"
  ADD COLUMN IF NOT EXISTS "stats"           SMALLINT[] NOT NULL DEFAULT ARRAY[]::SMALLINT[],
  ADD COLUMN IF NOT EXISTS "errorThemes"     TEXT[]     NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "errorLog"        SMALLINT[] NOT NULL DEFAULT ARRAY[]::SMALLINT[],
  ADD COLUMN "errorThemeN"     SMALLINT[] NOT NULL DEFAULT ARRAY[]::SMALLINT[],
  ADD COLUMN "weaknessInputsV" SMALLINT   NOT NULL DEFAULT 0;

ALTER TABLE "training_profiles"
  ADD COLUMN "weaknessVersion"     INTEGER       NOT NULL DEFAULT 0,
  ADD COLUMN "weaknessTimeClasses" "TimeClass"[] NOT NULL DEFAULT ARRAY[]::"TimeClass"[],
  ADD COLUMN "weaknessMonths"      SMALLINT      NOT NULL DEFAULT 0;

-- AP-09 kick compare-and-set column; a no-op if P3 already added it
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "lastKickAt" TIMESTAMP(3);

-- Hand-added (Prisma cannot express these; listed in DB/prisma/protected-indexes.txt):
ALTER TABLE "weakness_snapshots" ALTER COLUMN "metrics" SET COMPRESSION lz4;
CREATE INDEX IF NOT EXISTS "jobs_user_active_idx" ON "jobs" ("userId", "kind")
  WHERE "status" IN ('QUEUED', 'RUNNING');            -- a no-op if P3/P4 created it (architecture §1.10.1, optimization §3.5.3)
```

- `stats` and `errorThemes` use `IF NOT EXISTS`, in case a P3 build shipped them after all. The Prisma model is the same either way.
- Every new `NOT NULL` column has a default, so inserts from the previous deployment keep working (data-model §11.5 rule 7).
- `ADD COLUMN … DEFAULT` with a constant is a metadata-only change on Postgres 11+. There is no table rewrite on `game_players`.
- The FK to `users` is created on an **empty** new table, so `NOT VALID` is not needed.

#### 6.2.3 Role grants (not in the migration; P3 §6.3 rule)

Grants live in the idempotent role scripts, because the shadow database, CI's Docker Postgres and fresh branches have no app roles. Each script is guarded by `IF EXISTS (SELECT FROM pg_roles WHERE rolname = …)`.

```sql
-- DB/scripts/roles/replay_worker.sql (P3 file; P6 appends)
GRANT UPDATE ("stats", "errorThemes", "errorLog", "errorThemeN", "weaknessInputsV") ON game_players TO replay_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON weakness_snapshots TO replay_worker;
GRANT SELECT ON training_profiles, training_cards, training_attempts TO replay_worker;   -- if P5 did not already
GRANT INSERT ("userId", "weaknessVersion"), UPDATE ("weaknessVersion") ON training_profiles TO replay_worker;
GRANT UPDATE ("themes") ON mistakes TO replay_worker;                                    -- B-W2 / J1 tag (P5 grants the rest)

-- DB/scripts/roles/replay_app.sql (P1 file; P6 appends)
GRANT SELECT ON weakness_snapshots TO replay_app;
GRANT UPDATE ("lastWeaknessSeenVersion", "weaknessTimeClasses", "weaknessMonths") ON training_profiles TO replay_app;
GRANT UPDATE ("lastKickAt") ON jobs TO replay_app;                                       -- TR-5 kick CAS
```

### 6.3 JSON document `WeaknessMetricsV1` (`DB/json/weakness.ts`, zod, data-model §9 registry)

```ts
export const WeaknessMetricsV1 = z.strictObject({
  v: z.literal(1),
  scope: z.strictObject({ timeClasses: z.array(TimeClassEnum), since: z.string(), months: z.number().int(), maxGames: z.number().int() }),
  games: z.strictObject({ inScope: z.number().int(), analysed: z.number().int(), excludedBot: z.number().int() }),
  band: z.strictObject({ min: z.number().int(), max: z.number().int(), center: z.number().int(),
                         source: z.enum(["lichess","chesscom","replay","onboarding"]), rating: z.number().int(),
                         baselineBands: z.array(z.string()) }).nullable(),
  listMode: z.enum(["vs_band","own_only","most_frequent"]),
  rows: z.array(z.strictObject({                      // ≤ 5, already ranked; rank 1..3 = top, 4..5 = more
    pattern: z.string(), label: z.string(), unit: z.enum(["per100","per100_under1min"]),
    you: z.number(), band: z.number().nullable(), events: z.number().int(), moves: z.number().int(),
    gamesWith: z.number().int(), gamesWithLast20: z.number().int(), lastN: z.number().int(),
    lossYou100: z.number(), lossBand100: z.number().nullable(), ratio: z.number().nullable(), z: z.number().nullable(), score: z.number(),
    phaseMode: z.enum(["opening","middlegame","endgame"]).nullable(),
    trend: z.enum(["worse","same","better","unknown"]), trendRecent: z.number().nullable(), trendPrior: z.number().nullable(),
    example: z.strictObject({ fen: z.string(), orient: z.enum(["w","b"]), mistakeRef: z.string() }).nullable(),
  })).max(5),
  topKeys: z.array(z.string()).max(3),                 // for the version rule (§8.16)
  preliminary: z.array(z.strictObject({ pattern: z.string(), label: z.string(), seenIn: z.number().int(), of: z.number().int() })).max(3),
  headline: z.strictObject({ text: z.string(), short: z.string(),
    claims: z.array(z.discriminatedUnion("k", [
      z.strictObject({ k: z.literal("pattern"), key: z.string() }),
      z.strictObject({ k: z.literal("phase"), phase: z.enum(["opening","middlegame","endgame"]) }),
      z.strictObject({ k: z.literal("clock"), bucket: z.literal("lt1") }) ])) }).nullable(),
  breakdown: z.strictObject({
    phase: z.array(z.strictObject({ phase: z.enum(["opening","middlegame","endgame"]), you: z.number().nullable(), band: z.number().nullable(), moves: z.number().int() })).length(3),
    phaseSentence: z.string(),
    clock: z.strictObject({ buckets: z.array(z.strictObject({ key: z.enum(["gt5","2to5","1to2","lt1"]), moves: z.number().int(), blunders: z.number().int(), per100: z.number().nullable(), band: z.number().nullable() })).length(4), sentence: z.string() }).nullable(),
    openings: z.array(z.strictObject({ family: z.string(), ecoRange: z.string(), games: z.number().int(), points: z.number(), scorePct: z.number().int(), note: z.enum(["most_played","most_points_lost","best_score"]).nullable() })).max(4),
    strengths: z.array(z.string()).max(2),
    strengthKeys: z.array(z.enum(["conversion","book_exit_w","book_exit_b","phase_opening","phase_middlegame","phase_endgame"])).max(2),  // P10 card
    pieces: z.array(z.strictObject({ piece: z.enum(["p","n","b","r","q","k"]), per100: z.number().nullable() })).length(6),          // P7 context only
  }).nullable(),
  failure: z.strictObject({ code: z.string().max(40), at: z.string() }).nullable(),       // FAILED rows only
  inputs: z.strictObject({ watermarkEndedAt: z.string().nullable(), healed: z.number().int(), baseline: z.string(),  // "v1" | "v0-synthetic"
                           engineProfile: z.string() }),                                   // e.g. "sf18-v1"; must equal baseline.meta.profile
});
```

Live fields are **not stored**: `status` (derived), `progress`, `updating`, `inBank`, `rating`, `weekPlan`, `matchable`, `slug`, `lesson`, `seenVersion`, `version`. They are added at read time (§7.1.1). An empty `rows` list with `status = INSUFFICIENT` is valid.

### 6.4 Codecs (`CA/src/codec.ts`, append-only like P3's codes)

**`STATS_V1`** (30 smallints per member side; data-model §3.10). "Error" means a MISTAKE, BLUNDER or MISS ply of this side, the same set as `ERROR_LOG_V1`.

| Slot | Content |
|---|---|
| 0 | moves (this side's plies, excluding BOOK and FORCED) |
| 1–3 | phase moves: opening, middlegame, endgame (Divider: `middlegamePly`, `endgamePly`) |
| 4–6 | phase errors |
| 7–10 | clock moves by the time left **before** the move: gt5, 2to5, 1to2, lt1 (§8.3) |
| 11–14 | clock errors, same buckets |
| 15–20 | piece moves by the moved piece: p n b r q k |
| 21–26 | piece errors |
| 27 | reached +300 cp (side POV) after one of this side's moves: 0/1 |
| 28 | converted: slot 27 = 1 and the result is WIN: 0/1 |
| 29 | Win% (side POV) after this side's first non-BOOK move, rounded; −1 = unknown (FEN start, or no book ply) |

Moves with an unknown clock (untimed, empty `moveClocksMs`) count in slot 0 but in none of slots 7–14.

**`ERROR_LOG_V1`** (one smallint per error, in ply order):

| Bits | Field | Values |
|---|---|---|
| 0–6 | `winLoss` | `clamp(round(winBefore − winAfterPlayed), 0, 100)`, in Win% points from the mover's side (research §1: Win% = 50 + 50·(2/(1+e^(−0.00368208·cp)) − 1), cp clamped to ±1000) |
| 7–9 | `clockBucket` | 0 unknown or untimed, 1 > 5 min, 2 2–5 min, 3 1–2 min, 4 < 1 min (the clock **before** the move, §8.3) |
| 10–11 | `phase` | 0 opening, 1 middlegame, 2 endgame (P3 Divider, R-ACC-03) |
| 12–13 | `judgement` | 0 MISTAKE, 1 BLUNDER, 2 MISS. Inaccuracies are excluded (research R-PZL-01; §14.1 "Over MISTAKE, BLUNDER and MISS plies") |

The maximum encoded value is `(2<<12)|(2<<10)|(4<<7)|100 = 10852 < 32767`. Unit tests check the round trip and the boundaries, and that `errorThemeN.length === errorLog.length`.

### 6.5 Indexes and the queries they serve

**No new index on `game_players`, `mistakes` or `training_cards`.** Every P6 query is bounded by one member's rows (≤ 2,000 games, ≤ a few thousand cards) behind an existing `(userId, …)` prefix (data-model §2 rule 9). Every index named below is checked for existence after `migrate deploy` by `explain-hot-queries.ts` (AP §5 "index existence check").

| Id | Query (runs on) | Index used | Expected plan and time (§9.1) |
|---|---|---|---|
| Q-W1 | Latest snapshot: `SELECT "weekStart","algoVersion",status,"timeClasses",since,"gamesInScope","gamesAnalysed","ratingBandMin","ratingBandMax",metrics,"computedAt" FROM weakness_snapshots WHERE "userId"=$1 ORDER BY "weekStart" DESC LIMIT 1` (TR-5, hub, Home) | `weakness_snapshots_pkey` | Index Scan Backward, 1 row, < 0.3 ms (+ TOAST detoast ≈ 4 KB) |
| Q-W2 | Live bank counts per theme: `SELECT t AS theme, count(*)::int AS n FROM training_cards c JOIN mistakes m ON m.id = c."mistakeId" CROSS JOIN LATERAL unnest(m.themes) t WHERE c."userId"=$1 AND c.deck='BANK' AND m."hiddenAt" IS NULL GROUP BY t` (TR-5, hub) | `training_cards_userId_deck_due_idx` (prefix) + `mistakes_pkey` | Nested Loop + HashAggregate, < 3 ms at 2,000 cards |
| Q-W3 | Progress probe (TR-5, only when not READY or when analysis is pending): `SELECT s."timeClass", count(*)::int AS n, count(*) FILTER (WHERE s.accuracy IS NOT NULL)::int AS analysed, max(s."endedAt") AS last FROM (SELECT gp."timeClass", gp.accuracy, gp."endedAt" FROM game_players gp JOIN games g ON g.id = gp."gameId" WHERE gp."userId"=$1 AND gp."endedAt" >= $since AND gp.mode NOT IN ('BOT','LEGEND_BOT') AND gp.result IS DISTINCT FROM 'ABORTED' AND NOT (gp.source <> 'REPLAY' AND (CASE gp.color WHEN 'w' THEN g."blackTitle" ELSE g."whiteTitle" END) = 'BOT') ORDER BY gp."endedAt" DESC LIMIT 1000) s GROUP BY s."timeClass"` ‖ `SELECT kind, status, count(*)::int FROM jobs WHERE "userId"=$1 AND status IN ('QUEUED','RUNNING') AND kind IN ('ANALYZE_GAME','RECOMPUTE_WEAKNESS','IMPORT_SYNC') GROUP BY kind, status` ‖ `SELECT "importState","importDone","importTotal" FROM linked_accounts WHERE "userId"=$1` | `game_players_userId_endedAt_gameId_idx` + `games_pkey`; `jobs_user_active_idx`; `linked_accounts_userId_provider_key` | 3 index scans in parallel, < 4 ms for the first, < 1 ms for the others |
| Q-W3b | Stalled check (probe, only while analysis jobs are active): `SELECT max(ga."completedAt") FROM game_players gp JOIN game_analyses ga ON ga."gameId" = gp."gameId" WHERE gp."userId"=$1 AND gp."endedAt" >= $since` | `game_players_userId_endedAt_gameId_idx` + `game_analyses_pkey` | < 2 ms |
| Q-W4 | Training profile: `SELECT "puzzleRating","weaknessVersion","lastWeaknessSeenVersion","weaknessTimeClasses","weaknessMonths" FROM training_profiles WHERE "userId"=$1` | `training_profiles_pkey` | < 0.2 ms |
| Q-W5 | Worker inputs: §7.4.2 step 3 (`LIMIT 300`, join `games` by PK for the opponent title) | `game_players_userId_endedAt_gameId_idx` + `games_pkey` | < 10 ms |
| Q-W6 | Worker example positions: `SELECT DISTINCT ON (t) t, m."referenceId", m.fen, m."setupUci", m.color FROM mistakes m CROSS JOIN LATERAL unnest(m.themes) t WHERE m."userId"=$1 AND m."hiddenAt" IS NULL AND t = ANY($patterns) ORDER BY t, m."isPuzzle" DESC, m."lastPlayedAt" DESC` | `mistakes_userId_createdAt_idx` (prefix) | < 5 ms at 2,000 mistakes |
| Q-W7 | Drill own items (TR-7 weakness): `SELECT c.id, c."itemKey", c.due, c.mastery, c.reps, m.* FROM training_cards c JOIN mistakes m ON m.id = c."mistakeId" WHERE c."userId"=$1 AND c.deck='BANK' AND m."hiddenAt" IS NULL AND (c."suspendedUntil" IS NULL OR c."suspendedUntil" <= now()) AND m.themes @> ARRAY[$pattern]::text[] ORDER BY (c.due <= now()) DESC, c.mastery ASC, m."lastPlayedAt" DESC LIMIT 40` | `training_cards_userId_deck_due_idx` (prefix) + `mistakes_pkey` | < 3 ms |
| Q-W8 | Enqueue or coalesce: §7.4.1 | `jobs_dedupeKey_key` | 1 row |
| Q-W9 | Seen: `UPDATE training_profiles SET "lastWeaknessSeenVersion" = GREATEST("lastWeaknessSeenVersion", LEAST($v, "weaknessVersion")) WHERE "userId"=$1` | `training_profiles_pkey` (HOT, fillfactor 80 from M5) | < 0.5 ms |
| Q-W10 | Snapshot upsert + version bump: §7.4.2 step 9 | `weakness_snapshots_pkey`, `training_profiles_pkey` | 2 statements in one batch |
| Q-W11 | Prune: §7.4.6 | `weakness_snapshots_pkey` | batched |
| Q-W12 | Kick CAS (TR-5 `after()`): `UPDATE jobs SET "lastKickAt" = now() WHERE "dedupeKey" = 'weakness:' || $1::text AND status = 'QUEUED' AND "runAt" < now() - interval '30 seconds' AND ("lastKickAt" IS NULL OR "lastKickAt" < now() - interval '30 seconds') RETURNING id` | `jobs_dedupeKey_key` | 1 row or none |
| Q-W13 | Daily slice candidates: §7.4.6 (per-user `LIMIT 5` probes; Seq Scan only on the small `users` / `weakness_snapshots` tables) | `weakness_snapshots_pkey`, `game_players_userId_endedAt_gameId_idx`, `training_attempts_userId_reviewedAt_idx` | < 1 s per 1,000 members |

The TR-7 puzzle fill uses P5's `training_attempts_puzzle_idx` for the 90-day exclusion.

### 6.6 Migration, application and safety notes (CLAUDE.md + allocation §1.3)

1. Edit `DB/prisma/schema.prisma`. Generate the SQL with `prisma migrate diff --from-migrations DB/prisma/migrations --to-schema-datamodel DB/prisma/schema.prisma --shadow-database-url <throwaway Neon branch or the CI Docker Postgres> --script`. Hand-add the `lz4`, `IF NOT EXISTS` and partial-index lines (§6.2.2). Commit.
2. Rehearse on a **throwaway child branch of the Neon dev branch** named in CLAUDE.md (the dev project, once P1 1B·H10 / P13 D16 moved it out of `withered-cake-82837167`; R-20): `prisma migrate deploy`, then the role scripts, then the backfills, then `explain-hot-queries.ts`. Delete the branch afterwards.
3. Apply to the Neon **dev branch** with `prisma migrate deploy`. **Never `prisma migrate dev`** against dev or production (CLAUDE.md rule 2; the dev branch holds the E2E users), and **never `prisma db push`** against any Neon branch, because it would drop the hand-written partial index and the `lz4` setting (CC R-20).
4. The CI drift gate (`scripts/db/check-drift.ts`, P2) must show no `DROP INDEX` of a protected name. `jobs_user_active_idx` is added to `protected-indexes.txt`.
5. **Production** gets M6 only in P13, through `prisma migrate deploy` after a rehearsal on a child branch of `production`. Every step here is additive, so the owner confirmation for contract steps (CLAUDE.md rule 5) does not apply. If anything in the P6 rollout ever needs a drop, the plan stops and asks: "This command may reset/drop your database. Are you sure?"
6. Order with code: m6 deploys before the worker build that writes the input columns. Old worker builds keep working, because the defaults cover them.
7. Backfills and k6 runs against dev start only after the dev database has its own Neon project (AP-01, FE F-NEON-1), or with the owner's explicit OK. Each run records the Neon CU-h before and after in the sign-off record.

**Backfills** (idempotent TypeScript in `WEB/scripts/backfill/`; batches of 500 rows; keyset pagination on `("gameId","userId")`; `--dry-run` by default and `--apply` to write; they refuse unless the `DATABASE_URL` host is in `BACKFILL_ALLOWED_HOSTS`; each writes one `audit_logs` row `SYSTEM backfill.<name>` with its counts):

| # | Script | What | Done when |
|---|---|---|---|
| B-W1 | `backfill-weakness-inputs.ts` | `game_players` rows with `accuracy IS NOT NULL AND "weaknessInputsV" = 0`: load `game_analyses` (`evals`, `best`, `judgements`, `lines`, `middlegamePly`, `endgamePly`) + `games` (`moves`, `moveClocksMs`, `startingFen`, `startPly`, `initialTimeSeconds`, `incrementSeconds`), run `CA.computeSideInputs()` with the P5 tagger, then `UPDATE … FROM jsonb_to_recordset($1)` setting all five columns and `"weaknessInputsV" = 1`. CPU only, no engine | `count(*) WHERE accuracy IS NOT NULL AND "weaknessInputsV" = 0` = 0 |
| B-W2 | `backfill-mistake-timepressure.ts` | For each `mistake_occurrences` row, find the user's clock before that ply from `games.moveClocksMs`. When < 60 s: `UPDATE mistakes SET themes = array_append(themes, 'rc:timePressure') WHERE id = $1 AND NOT ('rc:timePressure' = ANY(themes))` | Re-running changes 0 rows |
| B-W3 | `enqueue-weakness-recompute.ts` | For every user with ≥ 5 analysed games: the §7.4.1 upsert with `trigger:'algo'` at `JOB_PRIORITY.HOUSEKEEPING`, `runAt` spread over 30 minutes; then one `POST /internal/analysis/kick {kinds:["RECOMPUTE_WEAKNESS"]}` | Every such user has a snapshot row with `algoVersion = ALGO_VERSION` |

The worker also heals missing inputs at run time (§7.4.2 step 4), so B-W1 is a speed-up, not a correctness requirement. The same three scripts run on production in P13 after `migrate deploy`.

### 6.7 Storage (Neon Free, 1 GB)

| Item | Per member | 100 members |
|---|---|---|
| `weakness_snapshots`: about 4–6 KB of metrics (lz4; measured 4,915 B for random-text rows in data-model §10) × 12 weeks | ≈ 60 KB | 6 MB |
| `game_players` new columns: ≈ 270 B × up to 200 analysed rows | ≈ 55 KB | 5.5 MB |
| `training_profiles` new columns | ≈ 10 B | — |

The baseline is about 45 KB in the repo and **0 B in Neon**.

### 6.8 Seed data and personas (`DB/prisma/seed/weakness.ts` for dev seeds; `WEB/e2e/personas/weakness.ts` for leased pool users)

Snapshots are produced by **running the real `computeWeakness()`** on fixture `GamePlayer` rows (precomputed analyses in `prisma/seed-data/analyses/*.json`, data-model §13.5). They are never hand-written, so code and seed can't drift apart. With the synthetic baseline (§7.4.5) the band numbers are deterministic.

**Dev seed personas** (manual and owner testing; `pnpm --filter web db:seed:personas -- --only=weakness`, which refuses unless `SEED_TARGET=dev`):

| Persona | Data | State |
|---|---|---|
| `new` | none | Insufficient `zero` (0/20) |
| `trial` (existing) | 14 analysed rapid/blitz games (5 with a fork error, 3 with a loose-piece error); Chess.com import RUNNING 212/480 | Insufficient `preliminary` 14/20 |
| `member` (existing) | 40 analysed + 172 unanalysed in-scope games; mistakes with themes so that `fork` = 12 in bank, `hangingPiece` = 7, `rc:timePressure` = 4; READY snapshots for this week and 11 earlier weeks; `weaknessVersion` 3, seen 2 (dot on) | Profile, all tabs, drill, dot |
| `weakcompute` (new) | 25 in-scope imported games, 12 analysed, 13 `ANALYZE_GAME` jobs QUEUED with a far-future `runAt` (static: the dev worker env `WEAKNESS_SEED_FREEZE=1` skips claiming `runAt > now()+1y`) | Computing at about 48 % |
| `weakfail` (new) | 22 analysed; a `RECOMPUTE_WEAKNESS` job FAILED (attempts 3); a FAILED snapshot row | Failed |
| `bullet` (new) | 64 bullet + 8 blitz analysed games | Insufficient + bullet offer |
| `noclock` (new) | 30 analysed games with empty `moveClocksMs` (OTB-style imports) | Profile without the Clock tab |

**Leased e2e personas** (TE X4; written by `WEB/e2e/personas/weakness.ts` through `scripts/dev/personas.ts --reset <pool user> --persona <name>`, on Docker Postgres in CI and on the dev branch for dev-URL runs; the shared letters A–P are never mutated):

| Persona | Contents | Used by |
|---|---|---|
| `weak-zero` | member, no games | `insufficient.spec.ts` (zero) |
| `weak-few` | 3 analysed | `insufficient.spec.ts` (few) |
| `weak-insufficient` | as seed `trial`, without the running import | `insufficient.spec.ts` |
| `weak-computing` | as seed `weakcompute`; the step `weak-computing:ready` writes the READY snapshot | `computing-to-ready.spec.ts`, `computing-fallback-poll.spec.ts` |
| `weak-orphaned` | 22 analysed, no snapshot, no job | `orphaned-autobuild.spec.ts` |
| `weak-member` | from `TRN/test/fixtures/weakness/member-design.json` (the board numbers) | `profile.spec.ts`, `drill*.spec.ts`, `lights-up.spec.ts`, devices real-route layer, the nightly dev check |
| `weakfail`, `bullet`, `noclock` | as the seed personas | `failed-retry.spec.ts`, `insufficient.spec.ts` (bullet), `profile.spec.ts` (noclock) |
| `weak-fresh` | member, no games, Lichess fixture link allowed | owner test T2, the nightly real-import check |

---

## 7. API

Every route uses `defineRoute()` (`WEB/lib/api/route.ts`) with its spec from the `CT` registry. That gives the envelope `{data}` / `{error:{code,message,details?,retryAfterSec?,requestId}}`, the request id, the Sentry span, `Server-Timing` (dev and preview), the class tag and `ctx.now` (from `x-rc-now` only under `isNonProd()` + `x-e2e-token`, TE X5). Route files import only `@repo/contracts`, `@/lib/api/*`, `@/lib/auth/*` and one service module (api-design §1.3 lint rule). Services take `now` as an argument.

### 7.1 HTTP routes

#### 7.1.1 TR-5 `GET /api/train/weakness`

| Field | Value |
|---|---|
| File | `WEB/app/api/train/weakness/route.ts` → `WEB/lib/train/weakness.server.ts#getWeakness(viewer, now)` |
| Auth | `member` (401 `unauthorized`; 402 `subscription_required` with `details.reason`). Flag `weakness` off → 404 `not_found` |
| Request | none (`If-None-Match` optional) |
| Response 200 | `{ data: WeaknessPayload }` (§7.2), ≤ 8 KB raw / ≤ 3 KB gzip |
| Response 304 | empty, with `ETag` |
| Cache | `private-etag` (`Cache-Control: private, no-cache`) with a strong `ETag: "wk1:{snapshotKey}:{algoVersion}:{inBankHash}:{tick}:{seenVersion}"`. `snapshotKey = {weekStart}.{computedAt epoch ms in base36}` or `none`; `inBankHash` = fnv1a over the sorted `pattern:n` pairs of the payload rows; `tick` = `{analysedInScope}.{importDone}.{jobsState}` while computing or updating, else `0`. No payload hash (api-design §2.12) |
| Class | R2 (p95 160 ms server time), ≤ 3 sequential DB round trips |
| Rate limit | none on the read path (api-design: never on hot reads). The Vercel Firewall per IP covers abuse |
| Side effects | **Only `kick_cas`**, declared in the registry `sideEffects: ["kick_cas"]` so the GET-purity check passes (AP-09). The route never enqueues |
| Idempotent | yes |

**Handler steps:**

1. `viewer = getViewer()` (React `cache()`; it includes `timeZone`).
2. `Promise.all([Q-W1, Q-W2, Q-W4, the jobs part of Q-W3])`.
3. If there is no READY snapshot, or analysis or recompute jobs are active: `Promise.all([the game_players part of Q-W3, the linked_accounts part, Q-W3b if jobs are active])`.
4. `derive = deriveStatus(…, now)` and `progress = computeProgress(…, now)` (pure, `TRN/src/weakness/status.ts` and `progress.ts`). `progress.orphaned = true` when `analysedInScope ≥ 5 ∧ no snapshot ∧ no active RECOMPUTE_WEAKNESS`.
5. `payload = buildPayload(snapshot.metrics, live)`, a pure function. It adds `inBank` per row from Q-W2, `rating` from Q-W4, `weekPlan` (§8.15), `matchable` and `slug` from the taxonomy, `lesson` from `resolveLessonForPattern()` (null until P8), and `version`/`seenVersion`.
6. Compute the ETag. If it matches `If-None-Match`, answer 304; otherwise 200.
7. `after()`: when the jobs part of Q-W3 shows a QUEUED `RECOMPUTE_WEAKNESS`, run Q-W12 (the compare-and-set; it checks `runAt < now − 30 s` and `lastKickAt` itself). Only when it returns a row, call `POST /internal/analysis/kick {v:1, kinds:["RECOMPUTE_WEAKNESS"]}` (2 s timeout). However many tabs poll, that is at most 1 kick per 30 s.

The old draft enqueued a heal job from this GET. That moved to the page's auto-build POST (§5.4) and to the worker's daily heal sweep (§7.4.6).

#### 7.1.2 TR-12 `POST /api/train/weakness/recompute`

| Field | Value |
|---|---|
| File | `WEB/app/api/train/weakness/recompute/route.ts` → `WEB/lib/train/weakness-write.server.ts#requestRecompute(viewer, body, now)` |
| Auth | `member`. Flag off → 404 |
| Body | `RecomputeBody` `{ timeClasses?: ("BULLET"\|"BLITZ"\|"RAPID"\|"CLASSICAL")[1..4], months?: 3\|6\|12 }`, max 1 KB (413 `payload_too_large`) |
| Response | **202** `{ data: { status: "computing", queuedAt, scopeChanged } }` |
| Errors | 400 `validation_failed` (`fields`), 401, 402, 404, 413, 429 `rate_limited` (`retryAfterSec` + `Retry-After`) |
| Rate limit | **Durable** 1 per 600 s per user, enforced inside the enqueue statement from the user's own job row (`payload.userAt`, §7.4.1). The UNLOGGED burst table is emptied at every Neon scale-to-zero, so it cannot hold a 10-minute window (AP-11 option b). A burst bucket `weakness-recompute-burst` 5 / 60 s (P1 fixed window) in front stops hammering |
| Idempotency | natural: the job dedupe key `weakness:{userId}`. A repeat inside the window is a 429, not a second job |
| Cache | `no-store` · class W1 |
| Side effects | (1) When the scope differs from the stored one: `UPDATE training_profiles SET "weaknessTimeClasses" = $tc, "weaknessMonths" = $m WHERE "userId" = $1`, upserting the row if absent (`scopeChanged: true`). (2) The rate-limited enqueue (§7.4.1, `trigger: scopeChanged ? 'scope' : 'user'`, `JOB_PRIORITY.USER_OPENED`, `runAt: now`). (3) `after()`: `POST /internal/analysis/kick {v:1, kinds:["RECOMPUTE_WEAKNESS"], runAt: now}` (2 s timeout) |

The scope `UPDATE` runs first and carries the same limiter predicate (`AND NOT EXISTS (SELECT 1 FROM jobs WHERE "dedupeKey" = 'weakness:' || $1::text AND (payload->>'userAt')::timestamptz > $now - interval '600 seconds')`). Both statements go in one `$transaction([...])` batch (a single round trip on the pooled connection), so a 429 never changes the scope.

#### 7.1.3 TR-13 `POST /api/train/weakness/seen` (new in P6)

| Field | Value |
|---|---|
| File | `WEB/app/api/train/weakness/seen/route.ts` → `markWeaknessSeen(viewer, version)` (Q-W9) |
| Auth | `member` |
| Body | `SeenBody` `{ version: int ≥ 0 }`, max 256 B |
| Response | **204** |
| Errors | 400, 401, 402, 404 (flag off) |
| Rate limit | `train-write` 120 / 60 s (the P5 shared bucket, fixed window, burst store) |
| Idempotency | yes: `GREATEST(…, LEAST($v, weaknessVersion))`, so a stale or forged version can't run ahead of the real one |
| Cache | `no-store` · W1 |
| Why not a GET side effect | Intent prefetch of `/train/weakness` (AppLink) would clear the dot without a real view. The client posts only after mount, once per version |

#### 7.1.4 TR-7 `POST /api/train/sessions`: the new `weakness` member (P5 route; P6 adds the branch)

| Field | Value |
|---|---|
| Body | `{ kind: "weakness", pattern: PatternKey, size: 10 \| 20, mix: boolean }` + header `Idempotency-Key` (required for creates, api-design API-07) |
| Response | **201** `SessionPayload` (P5), with `header.title = "Weakness drill"`, `theme = {key: pattern, label}`, `capRemaining: null`, `countsTowardCap: false`, and `items` as composed in §8.11 (≤ 20). **200** when an ACTIVE session is reused or the key is replayed (`Idempotent-Replayed: true`, P5) |
| Reuse | P5's `filterKey` = hash of the normalised body `{kind, pattern, size, mix}`; an ACTIVE session of kind WEAKNESS with the same key and less than 2 h old is returned |
| Errors | 400 `validation_failed` with `details.reason` ∈ {`unknown_pattern` (not in the taxonomy or not a weakness candidate), `empty_drill`}; 402; 422 `idempotency_key_reused` (same key, different body); 429 `rate_limited` (`train-session` 30 / 3600 s, P5) |
| DB | Q-W7 + the P5 puzzle selector (R2 shards near R, exclusion through `training_attempts_puzzle_idx`) + `INSERT training_sessions` (`kind='WEAKNESS'`, `source='weakness'`, `theme=pattern`, `size`, `mix`, `countsTowardCap=false`) in one transaction · class W2 (p95 250 ms) |

`train-session` is P5's bucket. Its one-hour window needs P1's durable store (AP-11); P6 only reuses it.

#### 7.1.5 Changed P5 reads (light up)

| Route | Change | Extra cost |
|---|---|---|
| TR-1 `GET /api/train/today` (+ RSC `getTrainToday`, `WEB/lib/train/today.server.ts`) | `allTraining.weakness: { label, inBank, href } \| null` (null unless the flag is on and the latest snapshot is READY); `plan.basis = "games20"` when READY; plan step 2's focus theme is the first **matchable** row (rct-b §3.5 rule 1), applied when today's `TrainingDay.plan` is generated (it is frozen for the day) | + Q-W1 and Q-W2 in the existing `Promise.all` |
| HOME-1 (`getHomeData`, `WEB/lib/home/home.server.ts`; `GET /api/home`) | `bank.topTheme: { label, inBank, source: "weakness" \| "bank" } \| null` → the line "{label} is your top weakness ({n} in bank)." (READY) or "{Theme} is your most common mistake ({n} in bank)." (bank fallback, ≥ 3 cards) | + Q-W1 (PK) |
| ME-2 `GET /api/me/badges` and `getMe()` `badges` (`WEB/lib/auth/viewer.ts`, `WEB/lib/train/badges.server.ts`) | `weaknessReady = flagOn && weaknessVersion > lastWeaknessSeenVersion`; `trainDot = bankDue > 0 \|\| weaknessReady` | the Q-W4 PK read (already read for streaks in P5) |

### 7.2 Contracts (`CT/http/weakness.ts`, zod 4; registered in `CT/http/registry/train.ts`)

```ts
import { z } from "zod";
import { defineEndpoint } from "../registry/define";
import { IsoDateTime, TimeClassEnum } from "./common";

export const WeaknessStatus  = z.enum(["insufficient", "computing", "ready", "failed"]);
export const PatternKey      = z.string().regex(/^(rc:)?[a-z][A-Za-z0-9]{1,31}$/);      // "fork", "hangingPiece", "rc:timePressure"
export const PatternSlug     = z.string().max(40).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);    // "fork", "hanging-piece", "time-pressure"
export const ProgressStepKey = z.enum(["import", "grade", "patterns", "compare"]);
const Phase = z.enum(["opening", "middlegame", "endgame"]);
const Lesson = z.strictObject({ slug: z.string().max(80), title: z.string().max(80), sub: z.string().max(100) });

export const WeaknessProgress = z.strictObject({
  pct: z.number().int().min(0).max(100),
  etaSec: z.number().int().min(0).max(86_400).nullable(),
  stalled: z.boolean(),
  orphaned: z.boolean(),                                   // §8.14: the client sends one auto-build POST
  analysed: z.number().int().min(0), target: z.number().int().min(1).max(300),
  steps: z.array(z.strictObject({ key: ProgressStepKey, label: z.string().max(80),
    pct: z.number().int().min(0).max(100), state: z.enum(["done", "run", "wait"]) })).length(4),
});

export const WeaknessRow = z.strictObject({
  rank: z.number().int().min(1).max(5), pattern: PatternKey, slug: PatternSlug,
  label: z.string().max(40), unit: z.enum(["per100", "per100_under1min"]),
  you: z.number().min(0).max(100), band: z.number().min(0).max(100).nullable(),    // 1 decimal
  trend: z.enum(["worse", "same", "better", "unknown"]), trendLabel: z.string().max(60),
  events: z.number().int().min(0), where: z.string().max(80),
  example: z.strictObject({ fen: z.string().max(100), orient: z.enum(["w", "b"]), mistakeRef: z.string().max(32) }).nullable(),
  inBank: z.number().int().min(0), matchable: z.boolean(),
  lesson: Lesson.nullable(),                               // null until P8 lights it up (§7.6)
});

export const WeaknessPayload = z.strictObject({
  v: z.literal(1),
  status: WeaknessStatus,
  scope: z.strictObject({ timeClasses: z.array(TimeClassEnum).min(1), since: IsoDateTime,
                          months: z.union([z.literal(3), z.literal(6), z.literal(12)]), maxGames: z.literal(300) }),
  scopeLabel: z.string().max(80),            // "212 games · rapid and blitz · since Aug 2026" | "Rapid and blitz · since Aug 2026"
  scopeLabelShort: z.string().max(60),       // "212 games · since Aug 2026"
  games: z.strictObject({ analysed: z.number().int(), inScope: z.number().int(), pending: z.number().int(),
                          required: z.literal(20), preliminaryFrom: z.literal(5) }),
  progress: WeaknessProgress.nullable(),
  updating: z.strictObject({ newGames: z.number().int().min(0) }).nullable(),
  band: z.strictObject({ min: z.number().int(), max: z.number().int(), label: z.string().max(20),
                         source: z.enum(["lichess", "chesscom", "replay", "onboarding"]) }).nullable(),
  rating: z.number().int().nullable(),       // puzzle rating near which matched puzzles are drawn
  headline: z.strictObject({ text: z.string().max(200), short: z.string().max(120), verified: z.literal(true) }).nullable(),
  listMode: z.enum(["vs_band", "own_only", "most_frequent"]),
  top: z.array(WeaknessRow).max(3),
  more: z.array(WeaknessRow).max(2),
  preliminary: z.array(z.strictObject({ pattern: PatternKey, label: z.string().max(40),
                                        seenIn: z.number().int(), of: z.number().int() })).max(3),
  weekPlan: z.array(z.strictObject({ kind: z.enum(["drill", "puzzles", "lesson"]), label: z.string().max(60),
                                     sub: z.string().max(100), href: z.string().max(120) })).max(3),
  breakdown: z.strictObject({
    phase: z.strictObject({ sentence: z.string().max(160),
      rows: z.array(z.strictObject({ phase: Phase, label: z.string(), you: z.number().int().nullable(), band: z.number().int().nullable() })).length(3) }),
    clock: z.strictObject({ sentence: z.string().max(160), ariaLabel: z.string().max(200),
      buckets: z.array(z.strictObject({ key: z.enum(["gt5", "2to5", "1to2", "lt1"]), label: z.string(),
                                        per100: z.number().nullable(), moves: z.number().int() })).length(4) }).nullable(),
    openings: z.array(z.strictObject({ family: z.string().max(60), ecoRange: z.string().max(16), games: z.number().int(),
      scorePct: z.number().int().min(0).max(100), note: z.enum(["most_played", "most_points_lost", "best_score"]).nullable() })).max(4),
    strengths: z.array(z.string().max(160)).max(2),
  }).nullable(),
  offers: z.strictObject({ includeBullet: z.strictObject({ bulletGames: z.number().int() }).nullable() }),
  failure: z.strictObject({ code: z.string().max(40), retryable: z.boolean() }).nullable(),
  version: z.number().int(), seenVersion: z.number().int(),
  algoVersion: z.number().int(), computedAt: IsoDateTime.nullable(), snapshotKey: z.string().max(40).nullable(),
});

export const RecomputeBody = z.strictObject({
  timeClasses: z.array(z.enum(["BULLET", "BLITZ", "RAPID", "CLASSICAL"])).min(1).max(4)
    .refine((a) => new Set(a).size === a.length, "duplicate time class").optional(),
  months: z.union([z.literal(3), z.literal(6), z.literal(12)]).optional(),
});
export const RecomputeResponse = z.strictObject({ status: z.literal("computing"), queuedAt: IsoDateTime, scopeChanged: z.boolean() });
export const SeenBody = z.strictObject({ version: z.number().int().min(0).max(2_147_483_647) });

export const weaknessEndpoints = {
  get:       defineEndpoint({ id: "TR-5",  method: "GET",  path: "/api/train/weakness", auth: "member", response: WeaknessPayload,
                              cache: "private-etag", class: "R2", sideEffects: ["kick_cas"], errors: ["not_found"] }),
  recompute: defineEndpoint({ id: "TR-12", method: "POST", path: "/api/train/weakness/recompute", auth: "member", body: RecomputeBody,
                              response: RecomputeResponse, status: 202, cache: "no-store", class: "W1",
                              rateLimit: { bucket: "weakness-recompute-burst", limit: 5, windowSec: 60, by: "user" },
                              maxBodyBytes: 1024, errors: ["validation_failed", "rate_limited", "not_found", "payload_too_large"] }),
  seen:      defineEndpoint({ id: "TR-13", method: "POST", path: "/api/train/weakness/seen", auth: "member", body: SeenBody,
                              status: 204, cache: "no-store", class: "W1",
                              rateLimit: { bucket: "train-write", limit: 120, windowSec: 60, by: "user" }, maxBodyBytes: 256,
                              errors: ["validation_failed", "not_found"] }),
};

// CT/http/train.ts (P5 file, edited by WP1): SessionCreate gains
//   z.strictObject({ kind: z.literal("weakness"), pattern: PatternKey, size: z.union([z.literal(10), z.literal(20)]), mix: z.boolean() })
```

Error codes: P6 adds **no new codes** to `CT/http/codes.ts` (CC R-06). `details.reason` under `validation_failed` (400) carries `empty_drill` and `unknown_pattern`.

### 7.3 Socket events (`CT/socket/user.ts` + `CT/socket/registry.ts`; room `user:{ref}` via `ROOM.user(ref)`; emitted by the worker through WS-3 `POST /internal/emit`)

```ts
export const WeaknessProgressEvent = z.strictObject({        // "weakness:progress", ≤ 180 B
  v: z.literal(1), pct: z.number().int().min(0).max(100), step: ProgressStepKey,
  etaSec: z.number().int().nullable(), stalled: z.boolean(),
  analysed: z.number().int(), target: z.number().int(),
  importDone: z.number().int().nullable(), importTotal: z.number().int().nullable(),
});
export const WeaknessReadyEvent = z.strictObject({           // "weakness:ready", ≤ 120 B
  v: z.literal(1), snapshotKey: z.string().max(40),
  status: z.enum(["ready", "insufficient", "failed"]), version: z.number().int(),
  bumped: z.boolean(),                                        // true → the client turns the Train dot on
  topLabel: z.string().max(40).nullable(),
});
```

| Event | When | Throttle | Client effect (§5.5) |
|---|---|---|---|
| `weakness:progress` | The member has no READY snapshot, and an `ANALYZE_GAME` for an in-scope game finished, an import page landed, or the recompute started | ≤ 1 per 10 s per user, **or** on every 5 % step (§7.4.4) | `setQueryData(qk.train.weakness())` |
| `weakness:ready` | After every snapshot write (READY, INSUFFICIENT or FAILED) | 1 per write; `dedupeKey: weakness:ready:{userRef}:{snapshotKey}` | invalidate `qk.train.weakness()`; mark `train.today` and `home` stale; patch the badge when `bumped` |

Both events go to the user room only, so the fan-out is 1 user × their tabs. The coverage analyses run below `JOB_PRIORITY.GAME_ENDED`, so under AP-10's banding they emit no per-ply `analysis:progress` either. There are no SSE streams and no webhooks in P6.

### 7.4 Background jobs (worker `WK`; `RECOMPUTE_WEAKNESS` runs in **P4's I/O lane**, never behind Stockfish)

#### 7.4.1 Enqueue and coalesce (`DB/src/sql/enqueueWeakness.ts`, shared by web and worker)

```sql
-- $1 userId, $2 priority, $3 runAt, $4 payload {v:1, trigger, userAt?}, $5 debounce seconds
INSERT INTO jobs (kind, "dedupeKey", "userId", priority, "fairSeq", "runAt", payload, status, attempts)
VALUES ('RECOMPUTE_WEAKNESS', 'weakness:' || $1::text, $1::bigint, $2, 0, $3, $4::jsonb, 'QUEUED', 0)
ON CONFLICT ("dedupeKey") DO UPDATE SET
  payload      = jobs.payload || EXCLUDED.payload
                 || CASE WHEN jobs.status = 'RUNNING' THEN '{"rerun":true}'::jsonb ELSE '{}'::jsonb END,
  status       = CASE WHEN jobs.status = 'RUNNING' THEN jobs.status ELSE 'QUEUED' END,
  "runAt"      = CASE WHEN jobs.status = 'RUNNING' THEN jobs."runAt"
                      WHEN jobs.status = 'QUEUED'  THEN LEAST(jobs."runAt", EXCLUDED."runAt")       -- never pushed back: no starvation in long imports
                      ELSE GREATEST(EXCLUDED."runAt",                                               -- DONE/FAILED/CANCELLED → re-arm
                                    COALESCE(jobs."finishedAt", now()) + make_interval(secs => $5)) END,
  priority     = CASE WHEN jobs.status IN ('QUEUED','RUNNING') THEN GREATEST(jobs.priority, EXCLUDED.priority)
                      ELSE EXCLUDED.priority END,                                                   -- a past user run does not pin it at 100
  attempts     = CASE WHEN jobs.status = 'RUNNING' THEN jobs.attempts ELSE 0 END,
  "lastError"  = CASE WHEN jobs.status = 'RUNNING' THEN jobs."lastError" ELSE NULL END,
  "finishedAt" = CASE WHEN jobs.status = 'RUNNING' THEN jobs."finishedAt" ELSE NULL END,
  "lockedBy"   = CASE WHEN jobs.status = 'RUNNING' THEN jobs."lockedBy" ELSE NULL END
RETURNING status, "runAt";
```

**TR-12 wraps the same upsert with the durable limit** (AP-11 option b; `$6` = `ctx.now`, so `x-rc-now` moves it in tests):

```sql
WITH prev AS (
  SELECT (payload->>'userAt')::timestamptz AS "userAt" FROM jobs WHERE "dedupeKey" = 'weakness:' || $1::text
), up AS (
  INSERT INTO jobs (kind, "dedupeKey", "userId", priority, "fairSeq", "runAt", payload, status, attempts)
  SELECT 'RECOMPUTE_WEAKNESS', 'weakness:' || $1::text, $1::bigint, $2, 0, $3, $4::jsonb, 'QUEUED', 0
  WHERE NOT EXISTS (SELECT 1 FROM prev WHERE "userAt" > $6 - interval '600 seconds')
  ON CONFLICT ("dedupeKey") DO UPDATE SET /* the same SET list as above */
  WHERE COALESCE((jobs.payload->>'userAt')::timestamptz, '-infinity') <= $6 - interval '600 seconds'
  RETURNING status, "runAt"
)
SELECT (SELECT count(*) FROM up)::int AS queued, (SELECT "userAt" FROM prev) AS "prevUserAt";
-- queued = 0 → 429 with retryAfterSec = ceil(600 − ($6 − prevUserAt))
```

- The `DO UPDATE … WHERE` re-checks the locked row, so two concurrent clicks give exactly one 202.
- `payload.userAt` persists, because every later enqueue **merges** its payload instead of replacing it.
- One row per user, ever. This replaces data-model §7.3's per-hour key `weakness:<userId>:<YYYYMMDDHH24>`, which leaves 24 DONE rows a day per active user and cannot coalesce across the hour boundary.

**Completion** (`WK/src/queue/complete.ts`, a `rerunIfFlagged` option next to P4's `reschedule`, about 10 lines):

```sql
UPDATE jobs SET
  status       = CASE WHEN payload->>'rerun' = 'true' THEN 'QUEUED' ELSE 'DONE' END,
  "runAt"      = CASE WHEN payload->>'rerun' = 'true' THEN now() + make_interval(secs => $3) ELSE "runAt" END,
  payload      = payload - 'rerun',
  "finishedAt" = now(), "lockedBy" = NULL
WHERE id = $1 AND "lockedBy" = $2;
```

**Triggers.** The debounce is **240 s**. That is shorter than Neon's 5-minute scale-to-zero, so the recompute after the last analysis of a burst runs on the same compute wake instead of waking Neon again (§9.6).

| Trigger (`payload.trigger`) | Caller | Priority | `runAt` / debounce |
|---|---|---|---|
| `analysis`: an `ANALYZE_GAME` finished for an in-scope game, and the user has a READY snapshot | `WK/src/handlers/analyzeGame.ts`, as one statement of P3's final `sql.transaction([...])` batch (replacing data-model §7.3 statement 7) | `JOB_PRIORITY.WEAKNESS` | `now() + 240 s`, debounce 240 s |
| `first_build`: no READY snapshot, and the in-scope analysed count reaches 5, 10, 15, 20 or more | `analyzeGame` after commit (`maybeEmitWeaknessProgress` computes the count) | `JOB_PRIORITY.GAME_ENDED` | `now()`, debounce 0 |
| `import`: `IMPORT_SYNC` finished | `WK/src/jobs/import-sync.ts` | `JOB_PRIORITY.WEAKNESS` | `now() + 120 s`, debounce 240 s |
| `user` / `scope`: TR-12 (Retry, Include bullet, auto-build) | web | `JOB_PRIORITY.USER_OPENED` | `now()`, debounce 0, durable 600 s limit |
| `heal` / `algo`: the daily slice (§7.4.6), B-W3 | worker, script | `JOB_PRIORITY.HOUSEKEEPING` | `now()` (the slice runs inside the daily wake) / spread over 30 min (B-W3) |
| `weekly`: a new local week | the daily slice (§7.4.6) | `JOB_PRIORITY.HOUSEKEEPING` | `now()` |

#### 7.4.2 Handler `WK/src/handlers/weaknessRecompute.ts`

Payload: `RecomputeWeaknessPayload = z.strictObject({ v: z.literal(1), trigger: z.enum(["analysis","first_build","import","user","scope","heal","algo","weekly"]), userAt: IsoDateTime.optional(), rerun: z.boolean().optional() })` in `DB/src/jobs.ts`.

The worker talks to Neon over the HTTP driver (P3-D11), so it holds no idle pool connections that a suspend could break (FE F-OCI-4). Steps 1–3 are reads; step 9 is one non-interactive `sql.transaction([...])` batch.

1. **Context**, in one statement:
   ```sql
   SELECT u.id, u."referenceId", u."timeZone", u."ratingBand", <the entitlement columns isEntitled()/isTrialing() read>,
          tp."puzzleRating", tp."weaknessVersion", tp."weaknessTimeClasses", tp."weaknessMonths",
          prev.metrics -> 'topKeys' AS prev_top, (prev."weekStart" IS NOT NULL) AS had_ready
   FROM users u
   LEFT JOIN training_profiles tp ON tp."userId" = u.id
   LEFT JOIN LATERAL (SELECT ws.metrics, ws."weekStart" FROM weakness_snapshots ws
                      WHERE ws."userId" = u.id AND ws.status = 'READY' ORDER BY ws."weekStart" DESC LIMIT 1) prev ON true
   WHERE u.id = $1
   ```
   If the user is not entitled (lapsed), finish DONE with `skipped:'lapsed'`, so no CPU is spent on former members. The data is kept, and the next analysis after renewal re-triggers.
2. **Coverage (J4)**: `ensureWeaknessCoverage(userId, scope, isTrialing)` (§7.4.3).
3. **Inputs** (Q-W5):
   ```sql
   SELECT gp."gameId", gp.color, gp."endedAt", gp."timeClass", gp.result, gp."ratingBefore", gp.rated, gp.source, gp."ecoCode",
          gp.accuracy, gp."phaseAccuracy", gp.stats, gp."errorThemes", gp."errorLog", gp."errorThemeN", gp."weaknessInputsV",
          CASE gp.color WHEN 'w' THEN g."blackTitle" ELSE g."whiteTitle" END AS "oppTitle"
   FROM game_players gp JOIN games g ON g.id = gp."gameId"
   WHERE gp."userId" = $1 AND gp."endedAt" >= $since AND gp."timeClass" = ANY($tc::"TimeClass"[])
     AND gp.mode NOT IN ('BOT', 'LEGEND_BOT') AND gp.result IS DISTINCT FROM 'ABORTED'
   ORDER BY gp."endedAt" DESC, gp."gameId" DESC
   LIMIT 300;
   ```
   Plus the per-time-class counts (the game_players part of Q-W3) for the bullet offer. Imported rows with `oppTitle = 'BOT'` are dropped and counted in `games.excludedBot` (R-LI-09).
4. **Heal inputs.** For analysed rows with `weaknessInputsV = 0` (at most 300): load `game_analyses` and `games` with `WHERE "gameId" = ANY($ids)` / `WHERE id = ANY($ids)` (2 statements), run `CA.computeSideInputs()` with the P5 tagger (§8.3.2), and batch-update with `UPDATE game_players gp SET stats = v.st, "errorThemes" = v.et, "errorLog" = v.el, "errorThemeN" = v.etn, "weaknessInputsV" = 1 FROM jsonb_to_recordset($1::jsonb) AS v("gameId" bigint, color char(1), st smallint[], et text[], el smallint[], etn smallint[]) WHERE gp."gameId" = v."gameId" AND gp.color = v.color`. Budget: about 5 ms CPU per row.
5. **Band and baseline**: `resolveBand()` (§8.4) against `TRN/baselines/v1.json`, loaded once per process (≈ 45 KB). The worker refuses a baseline whose `meta.profile` differs from its own engine profile (`sf18-v1`), and logs `baseline_profile_mismatch`.
6. **Compute**: `TRN.computeWeakness(inputs, baseline, ctx)`, a pure function returning `{ status, metrics, headline }` (§8).
7. **Examples** (Q-W6) for `rows[].pattern` (`rc:timePressure` uses the same theme tag, §8.12). The FEN is computed **after** applying `setupUci` with chess.js (user to move); `orient = color`.
8. **Version rule** (§8.16) compares against `prev_top` and `had_ready`.
9. **Write**, one batch (Q-W10):
   ```sql
   INSERT INTO weakness_snapshots ("userId","weekStart","algoVersion",status,"timeClasses",since,"gamesInScope","gamesAnalysed",
                                   "ratingBandMin","ratingBandMax",metrics,headline,"computedAt")
   VALUES ($1,$2,$3,$4,$5::"TimeClass"[],$6,$7,$8,$9,$10,$11::jsonb,$12, now())
   ON CONFLICT ("userId","weekStart") DO UPDATE SET
     "algoVersion"=EXCLUDED."algoVersion", status=EXCLUDED.status, "timeClasses"=EXCLUDED."timeClasses", since=EXCLUDED.since,
     "gamesInScope"=EXCLUDED."gamesInScope", "gamesAnalysed"=EXCLUDED."gamesAnalysed", "ratingBandMin"=EXCLUDED."ratingBandMin",
     "ratingBandMax"=EXCLUDED."ratingBandMax", metrics=EXCLUDED.metrics, headline=EXCLUDED.headline, "computedAt"=now()
   WHERE NOT (weakness_snapshots.status = 'READY' AND EXCLUDED.status = 'FAILED');   -- a failure never hides a good profile
   -- only when bumped:
   INSERT INTO training_profiles ("userId","weaknessVersion") VALUES ($1, 1)
   ON CONFLICT ("userId") DO UPDATE SET "weaknessVersion" = training_profiles."weaknessVersion" + 1
   RETURNING "weaknessVersion";
   ```
   `weekStart` is the Monday of the current ISO week in `User.timeZone`, computed with `Intl` in TypeScript.
10. **Complete** with `rerunIfFlagged` (§7.4.1; rerun debounce 240 s).
11. **After commit:**
    - emit `weakness:ready` (WS-3; `bumped`, `version`, `topLabel`);
    - send the PostHog server event `weakness_snapshot_computed` (and `weakness_first_ready` on the first READY);
    - record the Sentry metrics `worker.weakness.duration_ms` and `worker.weakness.games{status}`.

**Retries and failure.** `maxAttempts = 3`, back-off 30 s / 2 min / 10 min (the P3 per-kind table). On the final failure:
- write `status = FAILED` with `metrics.failure` only when no READY row exists (the guarded upsert);
- emit `weakness:ready {status:'failed'}`;
- capture to Sentry with the tags `{job_kind, algo_version, trigger}` and no PII.

**Budget.** About 9 DB round trips (≈ 200 ms each from Mumbai to us-east-1, data-model D22), so about 1.8 s wall time, plus < 300 ms CPU for 300 games, plus up to 1.5 s for a one-time heal. Target: **≤ 2 s p95** with no heal (OPT-50).

#### 7.4.3 Coverage, J4 (`WK/src/weakness/coverage.ts`)

`ensureWeaknessCoverage(userId, scope, isTrialing)` runs at the start of the handler and when `IMPORT_SYNC` finishes. It stays inside P4's eager analysis budget (FE 10.12.3, F-OCI-3):

```
target    = isTrialing ? WEAKNESS_ANALYSE_CAP_TRIAL (20) : WEAKNESS_ANALYSE_CAP (100)      // in-scope analysed games wanted
eagerUsed = count of the member's analysed games + QUEUED/RUNNING ANALYZE_GAME jobs (Q-W3 jobs part + one count)
eagerCap  = isTrialing ? 40 : 200                    // P4 queues the newest 20 (trial) / 200 (member); P6 never exceeds the cap
pick      = newest in-scope games with accuracy IS NULL (Q-W5 filters), up to min(target − analysedInScope, eagerCap − eagerUsed)
```

1. Upsert their `ANALYZE_GAME` jobs. The jobs needed to reach the **first 20** get `JOB_PRIORITY.IMPORT_NEWEST`; the rest get `JOB_PRIORITY.WEAKNESS`. `fairSeq` = the game's rank in the pick, so one member's batch interleaves with other members' work (architecture §1.10.4):
   ```sql
   INSERT INTO jobs (kind, "dedupeKey", "userId", priority, "fairSeq", payload)
   SELECT 'ANALYZE_GAME', 'analyze:' || x.id, $1, x.prio, x.seq, jsonb_build_object('v',1,'gameId',x.id)
   FROM jsonb_to_recordset($2::jsonb) AS x(id bigint, prio smallint, seq int)
   ON CONFLICT ("dedupeKey") DO UPDATE SET priority = GREATEST(jobs.priority, EXCLUDED.priority) WHERE jobs.status = 'QUEUED';
   ```
2. Most picks are already in P4's eager set (games 2–50 `IMPORT_NEWEST`, 51–200 `BACKLOG`), so the upsert only raises their priority. New jobs appear only for in-scope games outside it (for example, a member whose newest 200 games are mostly bullet).
3. Imported Lichess games that carry `%eval` analyse faster (pass 1 is skipped, data-model §3.3).
4. The worker's own drain loop picks the jobs up.
5. Games beyond the cap are analysed only when opened (P4 rule). When a trial converts to paid, the next run raises `target` to 100.

#### 7.4.4 Progress emitter (`WK/src/weakness/progressEmitter.ts`)

`maybeEmitWeaknessProgress(userId)` runs after each `ANALYZE_GAME` commit and each import page:

1. Read the in-memory `hasReady(userId)` cache (TTL 10 min, filled from the context query). If the user has a READY snapshot, return.
2. Run the game_players part of Q-W3 (1 statement).
3. Call `TRN.computeProgress()` with `secPerGame` = the rolling median of the last 50 `ANALYZE_GAME` durations in this process, and `lanes` = the engine lanes.
4. Emit when `|pct − lastPct| ≥ 5` or `now − lastEmit ≥ 10 s`.
5. When the analysed count crosses 5, 10, 15 or 20, enqueue `first_build`.

The cost is 1 small indexed query per analysed game (≈ 1 per 40 s per user), run while Neon is already awake for the analysis write.

#### 7.4.5 J5 baseline build (`TRN/scripts/build-baseline.ts`; runs on a laptop, one-off, refreshed quarterly; R-WK-01…03)

1. **Input:** one Lichess CC0 monthly standard rated dump (e.g. `lichess_db_standard_rated_2026-10.pgn.zst`, about 30 GB; about 6 % of games carry `%eval`; research §4). Stream it: `zstd -dc <file> | tsx TRN/scripts/build-baseline.ts --stdin`.
2. **Filter:**
   - standard and rated;
   - both Elo values present;
   - `[%eval` present;
   - `%clk` present;
   - ≥ 20 plies;
   - no `BOT` title on either side;
   - time class from the estimated duration `initial + 40 × increment` (`< 180` bullet, `< 480` blitz, `< 1500` rapid; classical and correspondence skipped; audit-api F-28).
3. **Sample:** reservoir-sample **2,000 player sides per (100-point band 600–2400 × {BULLET, BLITZ, RAPID})**. Each game contributes the side whose band cell is not yet full.
4. **Per side, with the production code:**
   - the Win% series from `%eval` (White's view; mate = ±1000 cp);
   - the `CA` classifier (12 labels);
   - Divider phases;
   - the clock before each move from `%clk`;
   - per-phase accuracy (R-ACC-02);
   - `computeSideInputs()` exactly as the worker runs it, so the baseline uses the same `STATS_V1`/`ERROR_LOG_V1` records.
   - For each MISTAKE, BLUNDER and MISS position, run **the worker's engine with the worker's `sf18-v1` pass-1 settings** (P3-D9: `go nodes 120000`, `MultiPV 2`, `Threads 1`, `Hash 64`, or whatever the C1 bench froze) on the position before the move, to get the best line (the `%eval` comments carry no best move). Then run the P5 tagger, which gives the themes.
   - **Pinning (FE 10.12.4):** the script runs the same Stockfish 18 build as the worker image: the binary from `ENGINE_PATH`, checked against the worker's recorded sha256 and the NNUE net hash. It refuses to run if either differs.
   - That is about 114k sides × about 3 errors, so about 350k positions at about 0.12 s each: about 12 CPU-hours, or about 1.5 h on 8 threads.
5. **Aggregate per cell:**
   - `moves`;
   - per theme `per100 = events/moves×100` and `loss100 = Σ winLoss/moves×100`;
   - `timePressure {movesLt1, blundersLt1, per100Lt1, loss100}`;
   - `phaseAccuracy[3]` (move-weighted);
   - `clockBlunders100[4]` with the moves per bucket;
   - `conversion` (games reaching ≥ +300 cp that were won);
   - `bookExitEqualShare` (Win% ≥ 45 at the first non-book ply);
   - `pieceErrors100[6]`.
6. **Calibration (R-WK-03):** re-run the full pipeline (our engine on every ply, `sf18-v1`) on 300 sides per blitz cell. Store `calibration[judgement] = ourRate / evalRate` per band. `compute` multiplies the baseline rates by it when the user's game was graded by our engine (`evalSource = ENGINE`), but not for imported Lichess `%eval` games.
7. **Output:**
   - `TRN/baselines/v1.json` (≈ 45 KB, sorted keys, 4 decimals): `{ v:1, algoVersion:1, gradingVersion, profile:"sf18-v1", source:{dump, games, builtAt}, ratingOffsets:{CHESSCOM:{BULLET:0,BLITZ:0,RAPID:0}}, calibration:{…}, bands:{"1100":{"BLITZ":{…},"RAPID":{…},"BULLET":{…}}, …} }`;
   - `v1.meta.json`: counts per cell, the sha256 of the dump, the runtime, **the engine binary sha256, the NNUE net hash and the profile id**;
   - committed through a normal PR.
8. **Validation (`TRN/baselines/baselines.test.ts`):**
   - the zod `BaselineV1` schema;
   - every cell has `moves ≥ 20,000`;
   - blunder rates are non-increasing with band (a soft check: a warning list, which fails only if more than 20 % of adjacent pairs invert);
   - for the `fork` theme, the 1100 blitz rate falls between 0.5 and 4.0 per 100 (sanity bounds);
   - `meta.profile` equals the worker's `ENGINE_PROFILE` constant (`CA/src/version.ts`).

Until `v1.json` lands, **`v0-synthetic.json`** (generated by `--synthetic` from the fixture distributions) unblocks integration. The worker refuses to write READY snapshots with a synthetic baseline when `APP_ENV=production`. On dev it writes them with `metrics.inputs.baseline = "v0-synthetic"`, and the UI shows a dev-only "Synthetic baseline" tag.

#### 7.4.6 The daily slice: weekly roll, heal sweep and prune (`WK/src/scheduler/recurring/weakness.ts`)

There is **no `HOURLY_TICK`** and no P6 timer. The slice runs once a day inside P3's `HOUSEKEEPING` run (or as part of `DAILY_PLAN` if P3 adopts FE F-NEON-2), on the wake that already happens. If P3 kept a single scheduler file, the slice is one call line in `WK/src/handlers/housekeeping.ts`.

1. **Weekly roll.** For entitled users whose latest snapshot `weekStart` is before the Monday of their current local week (in `User.timeZone`), and who have a `training_attempts` or `game_players` row in the last 30 days: `enqueueWeakness(trigger:'weekly', priority: HOUSEKEEPING, runAt: now())`. Because the slice runs daily, every member is rolled within 24 h of their local Monday. The candidate read is one grouped `SELECT DISTINCT ON ("userId") "userId", "weekStart" FROM weakness_snapshots ORDER BY "userId", "weekStart" DESC` (a PK scan of ≤ 12 rows per member) plus per-user `LIMIT 1` activity probes on `training_attempts_userId_reviewedAt_idx` and `game_players_userId_endedAt_gameId_idx`. This keeps 12 weekly rows for P10 trends and refreshes the 30/60-day trend windows. Jobs drain in the I/O lane with no jitter, so the whole roll finishes inside the same wake (100 members × 2 s / 2 lanes ≈ 100 s).
2. **Heal sweep** (replaces the old GET-side heal, AP-09). For entitled users with no snapshot at `ALGO_VERSION` and no active `RECOMPUTE_WEAKNESS` job: a per-user probe `SELECT count(*) FROM (SELECT 1 FROM game_players WHERE "userId" = $1 AND "endedAt" >= $since AND accuracy IS NOT NULL LIMIT 5) x`. When it returns 5: enqueue with `trigger: 'heal'` (or `'algo'` when an older snapshot exists).
3. **Prune** (batched 1,000 rows):
   ```sql
   DELETE FROM weakness_snapshots ws USING (
     SELECT "userId","weekStart", row_number() OVER (PARTITION BY "userId" ORDER BY "weekStart" DESC) AS rn
     FROM weakness_snapshots WHERE "userId" = ANY($userBatch)) x
   WHERE ws."userId" = x."userId" AND ws."weekStart" = x."weekStart" AND x.rn > 12;
   ```

#### 7.4.7 Nothing on Vercel cron, and no new timers

All the timing above runs on the worker scheduler (D11, API-15). The worker sleeps until `min(runAt)`, which it learns from kicks (the body carries `runAt`) and from the end of each drain. The Vercel daily cron (`/api/cron/daily`) only re-wakes the worker (P3). The worker timer-audit test (AP §5: 24 simulated idle hours, ≤ 5 DB round trips) must stay green with P6's code loaded.

### 7.5 Internal endpoints used (no new ones)

| Id | Path | Caller in P6 | Body |
|---|---|---|---|
| WS-3 | socket `POST /internal/emit` | worker | `{ v:1, targets:[{userRef}], event:"weakness:ready" \| "weakness:progress", data, dedupeKey? }`. The server rejects events that are not in the registry, and (where AP-44's per-caller allow-lists exist) `weakness:*` is on the worker's list |
| WK-1 | worker `POST /internal/analysis/kick` (through the socket box's Caddy) | web: TR-12 and the TR-5 kick CAS; script B-W3 | `{ v:1, kinds:["RECOMPUTE_WEAKNESS"], runAt? }`, 2 s caller timeout |

Both hops authenticate with the shared helper in `CT/internal/auth.ts`. The consistency critique (R-08: `x-internal-token`) and the feasibility and API critiques (HMAC from P2/P3) disagree on the scheme; P2/P3 decide it, and P6 code calls `signInternal(req)` either way. P6 adds no secret.

### 7.6 Hand-off to P8: legend lessons (critique C-07)

P6 builds everything except the lookup:

- **The stub:** `WEB/lib/train/weakness-lessons.server.ts` exports `resolveLessonForPattern(pattern: PatternKey): Promise<{ slug: string; title: string; sub: string } | null>`, which returns `null` in P6. `getWeakness()` calls it for each row and once for the week plan (the top row's pattern).
- **The slots** render only when the value is non-null:
  - the row's `LessonLink` (§4.6);
  - the drill config's lesson row (§4.7);
  - the week plan's third row, `{kind:"lesson", label:"Legend lesson: {title}", sub, href:"/learn/lessons/{slug}?from=weakness"}`.

  All three are exercised now through `/dev/ui/weakness?state=ready&lesson=1` and `?state=drill&lesson=1`, and by a component test.
- **What P8 must do (S13 "Lights up", P8 WBS "Edits"):**
  - replace the stub body with a lookup over cached lesson content (`unstable_cache`, tag `lessons`) through `Lesson.themes` (P8 §6, rct-b §2.5, R-WK-06);
  - accept `from=weakness` on `/learn/lessons/[slug]` (P8 already accepts `from=summary`);
  - add `learn-lights-up.spec.ts` cases: "the weakness row shows 'Legend lesson: …' for `fork`", "the drill config shows the lesson row", "the week plan has 3 rows".
- **Contract test that stays in P6:** `WEB/lib/train/weakness-lessons.contract.test.ts` asserts the stub's signature and that `buildPayload()` with a non-null lesson still parses and stays under 8 KB. P8's change must keep it green.

§14.3 records this as an open hand-off, because `phase-08.md` does not mention the resolver today.

### 7.7 Environment variables

| Var | Service | Default | Purpose |
|---|---|---|---|
| `WEAKNESS_JOBS_ENABLED` | worker | `true` (dev), `false` (production until P13) | Kill switch: the handler returns DONE `skipped:'disabled'` and the enqueue helpers no-op |
| `WEAKNESS_ANALYSE_CAP` / `WEAKNESS_ANALYSE_CAP_TRIAL` | worker | `100` / `20` | J4 in-scope analysis target per member / per trialist (D-P6-3) |
| `WEAKNESS_DEBOUNCE_SEC` | worker, web | `240` | Coalescing window (§7.4.1). Must stay below 300 (Neon suspend) |
| `ANALYSIS_SECONDS_PER_GAME` | web | `45` | ETA for the polling fallback when no socket estimate exists |
| `ANALYSIS_LANES` | web | `1` | Engine lanes for the fallback ETA (2 on the P13 worker VM) |
| `WEAKNESS_SEED_FREEZE` | worker (test hook, registered §7.10) | unset | Skip claiming seeded jobs with `runAt > now() + 1 year` (persona `weakcompute`). The worker refuses to boot with it set when `APP_ENV=production` |
| `LICHESS_DUMP_PATH`, `ENGINE_PATH`, `BASELINE_SAMPLE_PER_CELL` (2000), `BASELINE_THREADS` | J5 script, laptop only | — | Baseline build. Nodes and MultiPV come from the `sf18-v1` profile constant, not from env, so the script and the worker can't diverge |

Existing variables are used as they are: `DATABASE_URL` (web `replay_app`, worker `replay_worker`), the internal secret named by `CT/internal/auth.ts`, `SOCKET_TOKEN_SECRET` (unchanged), `POSTHOG_*`, `SENTRY_DSN`.

### 7.8 Feature flag `weakness` (PostHog, server-evaluated by the P1 flags registry; file `WEB/lib/flags/registry/p6.ts` in the directory form)

| Surface | Flag off | Flag on |
|---|---|---|
| `/train/weakness*` pages | `redirect('/train')` | render |
| TR-5, TR-12, TR-13, and TR-7 `kind:"weakness"` | 404 `not_found` | serve |
| Nav sub-item, `g w` chord, ⌘K entry | hidden (P1 "no dead links") | shown |
| Hub weakness row, plan footnote and focus; Home line; badge `weaknessReady` | not rendered / `false` | rendered |
| Worker | unaffected (it computes regardless, so turning the flag on shows warm data) | — |

Rollout: on dev for the owner and the E2E users from the first merge. Production is 100 % at P13. The flag is removed one release after 100 % (allocation §1.6). The `flags-off` Playwright project (TE X11) keeps the off path tested until then.

### 7.9 Third parties

| Party | Use | When |
|---|---|---|
| Lichess open database (CC0) | Monthly dump for J5 | Offline, quarterly; no runtime calls |
| Stockfish 18 (GPL, run as a separate process) | J5 best lines; the worker's analysis (P3) | Laptop / worker |
| PostHog | Client events (consent-gated) and worker server events | Runtime |
| Sentry | Spans, errors and metrics in web and worker | Runtime |

Nothing calls Chess.com, Lichess, Dodo or Clerk on any P6 request path.

### 7.10 Test hooks (registered in `WEB/lib/test-hooks/registry.ts`; TE X12)

| Kind | Id | Guard | Production proof |
|---|---|---|---|
| route | `/dev/ui/weakness` (`WEB/app/dev/ui/weakness/page.tsx`) | `isNonProd()` | `prod-guard.spec.ts`: 404 |
| route | `POST /api/dev/emit` (`WEB/app/api/dev/emit/route.ts`; created here if no earlier phase did) | `isNonProd()` + `x-e2e-token`. It emits only registry events, and only to the **caller's own** `user:` room | 404 |
| env | `WEAKNESS_SEED_FREEZE` | worker boot refuses it when `APP_ENV=production` | unit test `WK/src/env.test.ts` |
| header | `x-rc-now` (P1) | used by TR-5/TR-12 through `ctx.now` | P1's test |

The draft's `WEB/app/api/dev/e2e/weakness/route.ts` is **dropped**. Fixture data now comes from the leased persona writers (§6.8), which run from the test process with DB access, so one hook fewer has to be proven absent.

---

## 8. Domain logic (`TRN/src/weakness/*`: pure, browser-safe, no Prisma)

`computeWeakness(inputs, baseline, ctx) → { status, metrics, headline }`. The worker, the seed, the persona writers and the tests share this one function. `computeProgress`, `deriveStatus`, `previewWeaknessDrill`, `slug` and the labels are also imported by the web DAL and the client, so server and client numbers can't drift apart. Every function that reads the time takes `now` as an argument.

### 8.1 Constants (`TRN/src/weakness/constants.ts`; `/how-we-grade#weakness` reads them)

| Constant | Value | Source |
|---|---|---|
| `ALGO_VERSION` | 1 | bump → B-W3 re-enqueue and the daily `algo` sweep |
| `GAMES_REQUIRED` | 20 analysed games in scope | D8 / X15 / R-WK-04 (design "14 / 20") |
| `PRELIMINARY_FROM` | 5 | rct-b D8, architecture §2.3.3 |
| `SCOPE_DEFAULT` | `{ timeClasses: [RAPID, BLITZ], months: 6, maxGames: 300 }` | rct-b Q24 |
| `MIN_EVENTS` / `MIN_GAMES_WITH` | 5 / 3 | R-WK-05 / this spec (no single-game patterns) |
| `MIN_MOVES` (themes) / `MIN_MOVES_TP` (time pressure) | 200 / 100 user moves | R-WK-05 / this spec |
| `RATIO_MIN` / `Z_MIN` | 1.5 / 2.0 | R-WK-05 |
| `TOP_N` / `MORE_N` | 3 / 2 | design ("Top 3", "2 more patterns found. All 5 have drills.") |
| `TREND_RECENT_DAYS` / `TREND_PRIOR_DAYS` / `TREND_DELTA` / `TREND_MIN_MOVES` | 30 / 60 / ±20 % / 100 (30 for time pressure) | rct-b W1 |
| `CLOCK_EDGES_MS` | `lt1 < 60 000 ≤ 1to2 < 120 000 ≤ 2to5 < 300 000 ≤ gt5` | design buckets "> 5, 2–5, 1–2, < 1 min" |
| `TIME_PRESSURE_MS` | 60 000 | rct-b W2 |
| `CLOCK_MIN_MOVES_BUCKET` / `CLOCK_MIN_MOVES_TOTAL` | 30 / 100 | this spec (below that, show "—" or hide the tab) |
| `WHERE_LAST_N` | 20 | design "7 of the last 20 games" |
| `BAND_HALF_WIDTH` / `BASELINE_STEP` | 100 / 100 | rct-b W1 (1184 → 1100–1300); R-WK-01 (100-point cells) |
| `BAND_RATING_MIN_GAMES` | 10 rated games of one source | this spec |
| `DRILL_SIZES` / `DRILL_OWN_SHARE` / `MIN_PER_ITEM` | {10, 20} / 0.6 / 0.5 min | design DCLogic (`round(size·0.6)`, `round(size·0.5)`); P5 §8 "0.5 min per weakness item" |
| `ANALYSE_CAP` / `ANALYSE_CAP_TRIAL` / `EAGER_CAP` / `EAGER_CAP_TRIAL` | 100 / 20 / 200 / 40 | D-P6-3, FE F-OCI-3 |
| `DEBOUNCE_SEC` / `RECOMPUTE_LIMIT_SEC` | 240 / 600 | §7.4.1; api-design TR-12 |
| `PROGRESS_STEP_PCT` / `PROGRESS_MIN_MS` / `STALLED_MS` | 5 / 10 000 / 600 000 | rct-b §4.4, W1 edge cases |
| `KEEP_WEEKS` | 12 | data-model §5.7 |
| `OPENINGS_MIN_GAMES` / `OPENINGS_ROWS` / `BEST_SCORE_MIN_GAMES` / `MOST_PLAYED_MIN_GAMES` | 3 / 4 / 10 / 5 | rct-b W1 + this spec |
| `CONVERSION_CP` / `CONVERSION_MIN_REACHED` / `CONVERSION_MIN_RATE` | +300 cp (Win% 75.1) / 5 / max(0.80, band + 0.05) | R-WEAK strengths / design copy |
| `BOOK_EXIT_EQUAL_WIN` / `BOOK_EXIT_MIN_GAMES` / `BOOK_EXIT_MIN_SHARE` | 45 Win% / 10 per colour / max(0.70, band + 0.05) | design "81 %" |
| `PHASE_STRENGTH_DELTA` / `PHASE_SENTENCE_DELTA` | +3 / ±2 accuracy points | this spec |

### 8.2 Which games count (scope)

- **In scope:** `GamePlayer` rows of the member with `timeClass ∈ scope.timeClasses` and `endedAt ≥ since`. `since` = local midnight of the first day of the month `scope.months` months ago, in `User.timeZone`. Newest first, at most **300**. The scope is `training_profiles.weaknessTimeClasses` / `weaknessMonths`, or `SCOPE_DEFAULT` when they are empty or 0.
- **Excluded:**
  - `mode ∈ {BOT, LEGEND_BOT}`. Client-run bot games are forgeable (audit-client #294, audit-quality) and are not human play (D-P6-6);
  - imported games whose opponent title is `BOT` (R-LI-09);
  - `result = ABORTED` (P2 writes it for aborted games; they have no meaningful moves);
  - live games (`endedAt IS NULL` never satisfies `endedAt ≥ since`);
  - `timeClass ∈ {DAILY, UNTIMED}` unless the member adds them (not offered in P6).
- **Analysed** means `accuracy IS NOT NULL` (data-model §5.7). Rows with `weaknessInputsV = 0` are healed (§7.4.2 step 4) before aggregation.
- **"Or play N more games here"** uses `N = GAMES_REQUIRED − inScope`. Only FRIEND, ONLINE and TOURNAMENT games in the scope's time classes count.

### 8.3 Per-game inputs

#### 8.3.1 Clock before a move (`CA/src/clock.ts`)

`clockBefore(p) = p ≥ 2 ? moveClocksMs[p − 2] : initialMs`, where `p` is the ply offset from `Game.startPly` and `moveClocksMs[i]` is the mover's remaining time after ply `i` (data-model D1). The value is `unknown` when `moveClocksMs` is empty, when the time class is DAILY or UNTIMED, or when the index is missing. `clockBucket(ms)` maps to 1–4 per `CLOCK_EDGES_MS`, and 0 means unknown. The same function feeds STATS_V1 slots 7–14, `ERROR_LOG_V1` and the `rc:timePressure` tag (§8.12), so the three can't disagree.

#### 8.3.2 `computeSideInputs()` (`CA/src/weakness-inputs.ts`, CPU only, no engine)

Input: the `games` row (`moves`, `moveClocksMs`, `startingFen`, `startPly`, `initialTimeSeconds`, `incrementSeconds`, `timeClass`), the `game_analyses` row (`evals`, `best`, `judgements`, `lines`, `middlegamePly`, `endgamePly`), the side's `color` and `result`, and the tagger. Output: `{ stats: number[30], errorLog: number[], errorThemeN: number[], errorThemes: string[] }`.

1. Replay the moves from `startingFen` with chess.js to get the FEN before each ply and the moved piece.
2. For each ply of this side, add it to the STATS_V1 slots (§6.4) using the phase from the Divider plies and the bucket from `clockBefore`.
3. **Errors** = plies of this side with judgement MISTAKE, BLUNDER or MISS. For each error, in ply order:
   - append the `ERROR_LOG_V1` code (winLoss from `evals` in the mover's POV, the bucket, the phase, the judgement);
   - call `tagErrorPly({ fenBefore, bestLine, playedUci, refuteUci, evalBest, phase })`:
     - `bestLine` = `lines["<ply>"].pv` when P3 stored a line for the ply (flagged plies), else `[best[ply]]`;
     - `refuteUci` = `best[ply + 1]` (the opponent's best reply after the played move), which feeds `rc:missedThreat`;
   - keep the returned keys **without** the meta tags (`advantage`, `crushing`, `equality`, `mate`, `oneMove`, `short`, `long`, `veryLong`) and the phase tags, at most 8 per error;
   - append them to `errorThemes` and their count to `errorThemeN`.
4. `rc:timePressure` is **not** stored in `errorThemes`; it is derived from `clockBucket = lt1` in the log (§8.5).

The same function runs in the worker's final analysis batch, in B-W1, in the worker heal and in J5. One fixture test pins all four call sites to the same output.

### 8.4 Rating band (`TRN/src/weakness/band.ts`; R-WK-02)

1. **Rating `r` and source.** Over in-scope games, newest first, with `ratingBefore` not null:
   - **LICHESS** (`source = LICHESS`): ≥ 10 such games → the median of the newest 20, source `lichess`. Preferred, because the baseline is Lichess.
   - **CHESSCOM:** ≥ 10 → the median plus `baseline.ratingOffsets.CHESSCOM[tc]`, where `tc` is the member's majority time class. The offset defaults to 0 in v1 [V] (D-P6-5). Source `chesscom`.
   - **REPLAY:** ≥ 10 games with `rated = true` (P9 Glicko; none before P9) → source `replay`. Unrated REPLAY rows are skipped: their `ratingBefore` is the Chess.com-derived display rating (P2).
   - **Onboarding fallback:** the `User.ratingBand` midpoint (`NEW_TO_CHESS` 700, `UNDER_800` 700, `R800_1200` 1000, `R1200_1600` 1400, `R1600_2000` 1800, `R2000_PLUS` 2100). Source `onboarding`.
   - Else `null`, giving `listMode = own_only`.
2. **Centre and display band.** `c = clamp(round(r/100)·100, 700, 2400)`. The display band is `[c − 100, c + 100]`, labelled "1100–1300". The baseline cells are `"${c−100}"` (c−100…c−1) and `"${c}"` (c…c+99). Example: 1184 → c = 1200 → cells "1100" and "1200" → label "1100–1300".
3. **Band value of any metric.** Weight by the member's move share per time class, `w_tc`, and within a time class by the baseline sample moves of the two cells:
   `band(x) = Σ_tc w_tc · (Σ_cell moves_cell·x_cell / Σ_cell moves_cell) · cal`.
   - `cal = s_e·calibration + (1 − s_e)`, where `s_e` is the share of the member's moves graded by our engine and not by imported Lichess `%eval` (R-WK-03, §7.4.5 step 6).

### 8.5 Aggregation over the scope set G

Write `S_g` for the STATS_V1 array of game g (slots in §6.4).

- Total moves `M = Σ_g S_g[0]`; moves under 1 minute `M_lt1 = Σ_g S_g[10]`.
- For every error `e` in `decode(errorLog_g)`, with themes `T_e = errorThemes_g.slice(off_e, off_e + errorThemeN_g[e])`, and for each theme `t`:
  - `k_t = |{e : t ∈ T_e}|`
  - `L_t = Σ_{e: t∈T_e} winLoss_e` (an error with 2 themes counts once **per theme**, the same as in the baseline)
  - `gamesWith_t = |{g : ∃e ∈ g, t ∈ T_e}|`
  - `phaseCount_t[p] = |{e : t ∈ T_e, phase_e = p}|`
  - `you_t = 100·k_t / M` (shown with 1 decimal)
  - `lossYou100_t = 100·L_t / M`
- **Time pressure** (`rc:timePressure`, shown only when `M_lt1 ≥ MIN_MOVES_TP`):
  - `k_tp = |{e : clock_e = lt1 ∧ judgement_e = BLUNDER}|`
  - `you_tp = 100·k_tp / M_lt1` (unit `per100_under1min`, "You 4.0 under 1 min")
  - `lossYou100_tp = 100·Σ_{e: clock_e = lt1} winLoss_e / M`. This is per 100 **total** moves, so it ranks on the same scale as the themes.

### 8.6 Candidates, eligibility and ranking (R-WK-05, adapted)

- **Candidates:** taxonomy keys with `weaknessCandidate = true`: Tactics, Material, Mates, Defence, Special `{promotion, advancedPawn}`, Endgames, and Review `rc:*`. The meta tags (`advantage`, `crushing`, `equality`, `mate`, `oneMove`, `short`, `long`, `veryLong`) and the phase tags are excluded. `rc:timePressure` is added when `M_lt1 ≥ 100`. A Tier-2 theme becomes a candidate only once its recall is ≥ 85 % (R4).
- **`listMode = vs_band`** (band known). For candidate `c` with `n_c = M` (or `M_lt1`) and `p = band_c/100`:
  - `ratio = you_c / band_c`;
  - `z = (k_c − n_c·p) / sqrt(n_c·p·(1−p))`;
  - **eligible** iff `n_c ≥ MIN_MOVES(_TP) ∧ k_c ≥ 5 ∧ gamesWith_c ≥ 3 ∧ you_c > band_c ∧ (ratio ≥ 1.5 ∨ z ≥ 2)`.
  - **Score** = excess points lost per 100 moves: `lossYou100_c − lossBand100_c`. Rank by score desc, then `k` desc, then key asc. Keep 5 rows: ranks 1–3 are `top`, 4–5 are `more`.
- **`listMode = own_only`** (no band): eligible iff `k ≥ 5 ∧ gamesWith ≥ 3`; score `= lossYou100`. No band bars, no z or ratio.
- **`listMode = most_frequent`** (0 eligible in `vs_band`): the top 3 by `k` (with `k ≥ 3`), no band bars, the neutral headline (§8.17).
- **Labels (`weaknessLabel`, `TRN/src/themes.ts`):**
  - `fork` "Missed forks", `pin` "Missed pins", `skewer` "Missed skewers", `discoveredAttack` "Missed discovered attacks";
  - `hangingPiece` "Loose pieces", `trappedPiece` "Trapped pieces", `capturingDefender` "Missed 'remove the defender'";
  - `backRankMate` "Back-rank weaknesses", `mateIn1|2|3` "Missed mate in 1|2|3";
  - `defensiveMove` "Missed threats", `promotion` "Promotion chances", `advancedPawn` "Advanced pawns";
  - `rookEndgame` "Rook endgames" (and the other endgames the same way);
  - `rc:recapture` "Recapture first", `rc:defendedTarget` "Taking defended pieces", `rc:pawnStructure` "Pawn structure damage", `rc:kingSafety` "King safety", `rc:development` "Slow development", `rc:missedThreat` "Missed threats" (merged with `defensiveMove` for display: the larger row wins and the smaller row is dropped), `rc:timePressure` "Time-pressure blunders".
  - The remaining Tier-2 themes use "Missed {plural label}".

### 8.7 Phase breakdown

- `you_p = round(Σ_g acc_{g,p}·m_{g,p} / Σ_g m_{g,p})` over games with `acc_{g,p} ≥ 0` (P3 per-phase Lichess accuracy, R-ACC-02) and `m_{g,p} = S_g[1+p] ≥ 3`. It is `null` when `Σ m < 60`. `band_p` comes from the baseline `phaseAccuracy[p]`.
- Sentence (`phaseSentence`): `above` = phases with `you ≥ band + 2`; `below` = phases with `you ≤ band − 2`. The worst below is the one with the largest `band − you`.
  - Mixed: "Accuracy by phase. Your openings are above your band; the middlegame is where it drops." (the design text: "Your openings" / "your middlegame" / "your endgames"; the joins are "and").
  - All above: "Accuracy by phase. You are above your band in every phase."
  - All below: "Accuracy by phase. Every phase is below your band; the {worst} drops most."
  - Otherwise: "Accuracy by phase. You are close to your band in every phase."

### 8.8 Clock breakdown

- `moves_b = Σ_g S_g[7+b]`; `blunders_b = |{e : clock_e = b ∧ judgement_e = BLUNDER}|`.
- `per100_b = moves_b ≥ 30 ? round1(100·blunders_b/moves_b) : null`.
- The clock section is `null` (Clock tab hidden) when `Σ_b moves_b < 100`.
- Sentence: `r_low = 100·(bl_1to2 + bl_lt1)/(m_1to2 + m_lt1)`, `r_high = per100_gt5`. If `r_high > 0 ∧ r_low/r_high ≥ 1.8`, the word is "doubles" (< 2.5×), "triples" (< 3.5×) or "is {round(×)}× higher": "Below 2 minutes the rate triples." Otherwise: "Your blunder rate stays about the same as the clock runs down."
- `ariaLabel`: "Blunders per 100 moves: over 5 minutes 0.8, 2 to 5 minutes 1.1, 1 to 2 minutes 2.6, under 1 minute 3.4" (a null bucket reads "not enough moves").
- The time-pressure row (`you_tp`) and the `lt1` bar use the **same** numerator and denominator, so they always match (copy C4).

### 8.9 Openings breakdown

- **Families** come from `CA/src/eco-families.ts`, a curated table of about 110 entries `{name, from, to}` built from the CC0 `lichess-org/chess-openings` names. A unit test checks that each of the 500 ECO codes A00–E99 maps to exactly one family. Examples: "Two Knights Defence" C55–C59; "Queen's Gambit Declined" D30–D69; "Sicilian, Alapin" B22; "London System" D02.
- Over **all** in-scope games with an `ecoCode` (analysis not needed): `games`, `points` (win 1, draw 0.5), `scorePct = round(100·points/games)`.
- Families with ≥ 3 games are kept: the top 4 by games desc, ties broken by `games·(0.5 − score)` desc.
- **Notes** (one per row, in priority order): "Most played" = max games (≥ 5); "Most points lost" = max `games·(0.5 − score)` > 0; "Best score" = max `scorePct` with ≥ 10 games.
- `ecoRange` is `from` when `from = to`, else "from–to".

### 8.10 Preliminary patterns (insufficient state)

When `5 ≤ analysed < 20`: candidates with `gamesWith ≥ 2`, sorted by `gamesWith` desc then `k` desc, top 3. Each reads "Missed forks · Seen in {gamesWith} of {analysed} games · Preliminary". Below 5 analysed games the list is empty (the empty-state copy).

### 8.11 Drill composition (`TRN/src/weakness/drill.ts`, used by TR-7 through `TRN/src/session.ts` and by `previewWeaknessDrill` in the UI)

```
matchTheme  = themes.lichessMatch(pattern)          // fork→fork, hangingPiece→hangingPiece, rc:defendedTarget→hangingPiece,
                                                    // rc:missedThreat→defensiveMove, rc:kingSafety→kingsideAttack, rc:pawnStructure→null
if pattern === "rc:timePressure": matchTheme = null   // puzzles have no clock (rct-b Q16)
matchable   = matchTheme != null
own[]       = Q-W7 rows (due first, lowest mastery, newest); count = own.length
if !matchable && count === 0            → 400 validation_failed { reason: "empty_drill" }
mixEff      = matchable && (mix || count === 0)       // zero own → mix forced on (rct-b W2)
ownTarget   = mixEff ? round(size × 0.6) : size       // 10→6, 20→12
ownItems    = own.slice(0, ownTarget)
puzTarget   = mixEff ? size − ownItems.length : 0     // any shortfall of own items is filled with puzzles
puzzles     = selectPuzzles(matchTheme, R, puzTarget, excludeSeen90d)   // P5 W2: shards [R−100, R+150], widen ±1 band, meta.widened
items       = interleave(ownItems, puzzles)           // o p o p …, then the remainder: 6+4 → o p o p o p o p o o
size'       = items.length                            // "few" when < size
estMin      = round(size' × 0.5)
```

- Own items keep their FSRS behaviour: the BANK deck is graded at most once per day, and `countsTowardCap = false` (rct-b D6).
- Puzzle items follow P5 (PUZZLE deck, Glicko, the O6 card rule).
- Queue labels: own "vs {opp} · move {n} · {themeLabel}"; puzzle "Lichess puzzle · matched to your rating".
- Summary eyebrow: "{label} drill · {size'} positions".
- **Preview** (client): `own = mixEff ? min(round(size·0.6), inBank) : min(inBank, size)`, `puzzles = mixEff ? size − own : 0`. Mix line:
  - mix on: "{own} from your games + {puzzles} matched Lichess puzzles near {R}";
  - mix off: "{own} from your games only ({inBank} in your bank)".
  - CTA: "Start drill · {own+puzzles} positions · ~{round(n·0.5)} min".

### 8.12 Time-pressure tag on bank mistakes

At extraction (P5 J1, `WK/src/extract/extractMistakes.ts`), for each occurrence `(game, offset p)`: if `clockBefore(p)` is known and `< 60 000` ms, `themes = themes ∪ {'rc:timePressure'}`. `primaryTheme` is unchanged (the key is never primary), so bank filters and mastery are unaffected. B-W2 backfills existing rows. The drill's own items for `rc:timePressure` are the cards with that tag, of any judgement (D-P6-8).

### 8.13 Progress and ETA (`TRN/src/weakness/progress.ts`)

```
importPct   = importRunning ? floor(100·importDone / max(1, importTotal)) : 100
gradePct    = floor(100·min(analysedInScope, 20) / 20)
patternsPct = analysedInScope < 20 ? 0 : recompute === "running" ? 50 : recompute === "queued" ? 10 : hasReady ? 100 : 10
comparePct  = hasReady ? 100 : 0
pct         = round(0.15·importPct + 0.70·gradePct + 0.10·patternsPct + 0.05·comparePct)
step        = first of [import, grade, patterns, compare] with pct < 100
state       = 100 → "done"; current step → "run"; else "wait"
N (h2)      = min(inScope, isTrialing ? ANALYSE_CAP_TRIAL : ANALYSE_CAP)  → "Analysing {N} games" ("Analysing your {N} newest games" when inScope > cap)
etaSec      = max(0, 20 − analysedInScope) × secPerGame / lanes
              + (importRunning ? (importTotal − importDone) / importRate : 0) + queueAheadSec + 5
              secPerGame = the worker's rolling median of ANALYZE_GAME durations (event) | env ANALYSIS_SECONDS_PER_GAME (fallback)
stalled     = activeAnalyzeJobs > 0 ∧ now − lastAnalysedAt > 10 min      (lastAnalysedAt = Q-W3b max(completedAt))
orphaned    = analysedInScope ≥ 5 ∧ snapshot = none ∧ recompute = "none"
```

ETA text: `< 90 s` → "about a minute left"; `< 90 min` → "about {round(min)} minutes left"; else "about {round(h)} hours left"; null → "Working…". Analysis takes about 40 s per 80-ply game at 0.75 CPU (architecture §1.9.5), so 20 games take about 13 minutes when the lane is free. The design's "about a minute" is never shown for a real first build.

### 8.14 Status (`TRN/src/weakness/status.ts#deriveStatus`)

```
if snapshot?.status === READY                       → "ready";  updating = recompute ≠ "none" ? { newGames: max(0, analysedInScope − snapshot.gamesAnalysed) } : null
else if (snapshot?.status === FAILED ∨ lastJobFailed) ∧ recompute === "none"   → "failed"
else if analysedInScope ≥ 20                         → "computing"   (patterns and compare steps; orphaned → the page's auto-build POST)
else if importRunning ∨ inScope ≥ 20                 → "computing"   (grade step; coverage queues the analyses)
else                                                 → "insufficient" (preliminary from the snapshot's INSUFFICIENT metrics when analysed ≥ 5;
                                                                      orphaned with 5..19 analysed → the auto-build writes the INSUFFICIENT row)
```

The function is total over its inputs (a property test enumerates the product, §12.1). The UI shows the chip only when `updating.newGames > 0` or the recompute is RUNNING.

### 8.15 Week plan (ready; rendered on desktop and iPad L)

1. **Drill** (from `top[0]`): "Drill {label lower}", subtitle "10 positions · {own} from your games + {10−own} matched puzzles" (own = min(6, inBank)), or "10 positions from your games" when not matchable. `href = /train/weakness/{slug}`.
2. **Puzzles** (the first matchable row): "{Theme singular} puzzles at {R}" ("Fork puzzles at 1512"; "… at your level" when R is unknown), subtitle "3 drills a session, under a minute each". `href = /train/puzzles?theme={lichessKey}&n=3`.
3. **Lesson** (only when `resolveLessonForPattern(top[0].pattern)` returns a lesson, which happens from P8): "Legend lesson: {title}", subtitle `sub`, `href = /learn/lessons/{slug}?from=weakness`.

### 8.16 Version rule (nav dot)

`bumped = status = READY ∧ (¬hadReady ∨ prevTop[0] ≠ topKeys[0] ∨ ∃k ∈ topKeys: k ∉ prevTop)`. When bumped, `training_profiles.weaknessVersion += 1` and the event carries `bumped:true`. The dot shows while `weaknessVersion > lastWeaknessSeenVersion`. TR-13 clears it after a real view. Weekly rolls and ordinary updates don't bump, so the dot means "something new to look at", not "recomputed".

### 8.17 Headline (template, verified by construction)

- **vs_band / own_only:** `"You lose most points to " + lower(top.label) + phaseClause + clockClause + "."`.
  - `phaseClause` = " in the {phaseMode}". It is omitted for time pressure or a null phase mode.
  - `clockClause` = ", especially with under a minute on your clock" when the clock section exists **and** (≥ 40 % of `top`'s events have `clock = lt1`, **or** `rc:timePressure` is an eligible row other than `top`).
  - `short` uses ", especially under a minute".
  - Examples: "You lose most points to missed forks in the middlegame, especially with under a minute on your clock." (the design, desktop); short: "…, especially under a minute." (the design, phones).
- **Time pressure on top:** "You lose most points to blunders with under a minute on your clock." / short "…to blunders under a minute."
- **most_frequent:** "Nothing stands out against players at your level. Your mistakes are spread across many patterns."
- **Verification:** `metrics.headline.claims` records `{pattern}`, `{phase}` and `{clock}`. `verifyHeadline(metrics)` recomputes each claim from `rows`, `phaseCount` and the clock data. When it fails (it shouldn't), the headline drops to the claim-free "You lose most points to {label}.". The UI always shows VERIFIED, because the text is never free-form.

### 8.18 Trend

The windows use `endedAt` relative to `computedAt`: recent `[t−30d, t]`, prior `[t−90d, t−30d)`.

- `rate_w = 100·k_w / M_w`, which needs `M_w ≥ 100` in both windows (≥ 30 under 1 minute for time pressure). Otherwise `unknown`, labelled "Not enough recent games for a trend".
- `Δ = (recent − prior) / max(prior, 0.1)`.
- `Δ ≥ +0.20` → `worse`, "Getting worse this month"; `Δ ≤ −0.20` → `better`, "Improving"; else `same`, "About the same".

### 8.19 "Where" line and example position

- `phaseMode = argmax_p phaseCount[p]`, with ties going to the middlegame.
- `last20` is the newest `min(20, |G|)` analysed games, and `g20` is the number of them with at least one event.
- Text: "{Opening|Middlegame|Endgame} · {g20} of the last {|last20|} games". Time pressure: "Under 1 minute · {g20} of the last 20 games".
- **Example** (Q-W6): the most recent visible mistake carrying the pattern, puzzles first. The FEN is taken after `setupUci` (the user to move); `orient` is the user's colour. Without one, the row shows no board.

### 8.20 Strengths (priority order, at most 2; `strengthKeys` stored for P10)

1. **Conversion** (the newest 30 analysed games): `reached = Σ S[27]`, `converted = Σ S[28]`. Shown when `reached ≥ 5` and `converted/reached ≥ max(0.80, bandConversion + 0.05)`: "You convert won positions: {converted} of your last {reached} games that reached +3 or better ended in a win." (copy note C10).
2. **Book exit**, per colour with ≥ 10 games that have `S[29] ≥ 0`: `share = #(S[29] ≥ 45)/n`. Shown when `share ≥ max(0.70, bandShare + 0.05)` (the better colour wins): "Your openings as White are sound: you leave book with an equal position 81% of the time."
3. **Phase:** the phase with the largest `you − band ≥ 3`: "Your endgame accuracy is 79, above players at your level (74)."

### 8.21 Scope labels

- Time classes are joined in the order rapid, blitz, bullet, classical: "Rapid and blitz", "Rapid, blitz and bullet".
- The `since` month = `max(scope since, earliest in-scope game)`, formatted with `Intl.DateTimeFormat('en', {month:'short', year:'numeric', timeZone})`, e.g. "Aug 2026".
- **Ready:** "{gamesInScope} games · {time classes lower} · since {Mon YYYY}". **Insufficient / computing:** "{Time classes} · since {Mon YYYY}". **Short:** "{gamesInScope} games · since {Mon YYYY}".

---

## 9. Performance and optimisation (`optimization.md`)

### 9.1 Hot paths, query plans and checks (added to `WEB/scripts/explain-hot-queries.ts`, which refuses non-throwaway hosts; seeded with 20 members × 2,000 games, 500 mistakes, 3,000 attempts)

The script first asserts that every index named in §6.5 exists in `pg_indexes` after `migrate deploy` (AP §5), then runs `EXPLAIN (ANALYZE, BUFFERS)` on each query.

| Query | Expected plan | Limit asserted |
|---|---|---|
| Q-W1 latest snapshot | Index Scan Backward using `weakness_snapshots_pkey` | < 0.3 ms, shared hits < 10 |
| Q-W2 bank counts by theme | Index Scan `training_cards_userId_deck_due_idx` → Nested Loop `mistakes_pkey` → HashAggregate | < 3 ms |
| Q-W3 probe (game_players part) | Limit → Nested Loop (Index Scan `game_players_userId_endedAt_gameId_idx`, `games_pkey`) → HashAggregate | < 4 ms |
| Q-W3 jobs part | Index Scan `jobs_user_active_idx` | < 0.5 ms |
| Q-W5 worker inputs | Limit 300 → Nested Loop (`game_players_userId_endedAt_gameId_idx`, `games_pkey`) | < 10 ms |
| Q-W6 examples | Index Scan on the `mistakes_userId_createdAt_idx` prefix → Unique/Sort | < 5 ms |
| Q-W7 drill own items | Index Scan `training_cards_userId_deck_due_idx` + `mistakes_pkey`, Sort | < 3 ms |
| Q-W12 kick CAS | Index Scan `jobs_dedupeKey_key` | < 0.5 ms |
| **None of the above** | contains `Seq Scan` on `game_players`, `mistakes`, `training_cards`, `training_attempts`, `jobs` or `weakness_snapshots` | — |

### 9.2 Caching layers

| Layer | What | Policy |
|---|---|---|
| Materialisation | `weakness_snapshots` (OPT-50) | The read cost is 1 PK row. All the heavy work runs on OCI, at most about once per 4 minutes per member during imports, and only when something changed |
| Browser HTTP cache | TR-5 | `private, no-cache` + strong ETag → 304 on refocus and polls, with no client code (client-data-layer §4.3). Never `max-age > 0` on per-user data (AP-04) |
| TanStack Query | `qk.train.weakness()` | `staleTime` 10 min (0 while computing or updating). Socket events patch or invalidate. `gcTime` 5 min |
| React `cache()` | `getViewer()`, `getWeakness()` per request | Dedupes layout and page reads |
| Router cache | `experimental.staleTimes.dynamic = 30` | Back/Forward within 30 s costs 0 invocations |
| Worker process | the baseline JSON (45 KB, loaded once), the ECO family table, `hasReady` (10 min TTL), the progress throttle map, the rolling `secPerGame` | in memory |
| CDN | none for this data: it is per user and never public (api-design §2.12 rule) | — |

### 9.3 Payload and bundle budgets

| Item | Budget | How it is met | Enforced by |
|---|---|---|---|
| TR-5 200 response | ≤ 8 KB raw / ≤ 3 KB gzip (optimization §5.1) | ≤ 5 rows; FEN strings only (no board markup); labels precomputed; no PGN | a contract test asserts `JSON.stringify(payload).length < 8192` on the `weak-member` fixture, with and without lessons |
| RSC payload `/train/weakness` | ≤ 12 KB | dehydrated query (≈ 4 KB) + markup | `request-budget.spec.ts` measures |
| Socket events | ≤ 180 B / ≤ 120 B | flat numbers | zod `max` + a size test with realistic refs |
| Route JS `/train/weakness` (gzip, route-level) | **≤ 90 KB** (rct-b §5.4) | no chess.js, no Stockfish, no board component; `MiniBoard` is plain SVG; `Tabs`, `Sheet` and `Segmented` are shared P1 chunks; `DrillSheet` through `next/dynamic` (phones only); **zod schemas excluded through `devSchema()`** (AP-12) | the `next build` budget check in CI, blocking from P1; plus the AP-12 assertion that `ZodError` does not appear in the route's chunks |
| Worker memory | + < 5 MB | baseline + maps | `/internal/metrics` `rssMb` |

### 9.4 SLOs (targets) and how each is measured

Every SLO has a server-side or lab source. None depends on PostHog, which is consent-gated and biased (AP-15). PostHog keeps funnels only.

| SLO | Target | Metric and source |
|---|---|---|
| TR-5 server time (class R2) | p50 45 ms / p95 160 ms / p99 400 ms | wrapper `Server-Timing` → Sentry metric `api.duration_ms{route="train.weakness.get"}`; k6 |
| TR-5 304 path | p95 ≤ 80 ms | k6 `weakness.js` scenario `revalidate` |
| TR-12 / TR-13 (W1) | p95 150 ms | Sentry `api.duration_ms{route}` |
| TR-7 weakness (W2) | p95 250 ms (cold shard LRU: 400 ms) | k6 `train-sessions.js` (P5) + a weakness scenario |
| `RECOMPUTE_WEAKNESS` duration | p95 ≤ 2 s per member without heal; heal ≤ 4 s | `worker.weakness.duration_ms` (Sentry metric), `worker.job.duration_ms{kind}` |
| Time to first READY after the 20th in-scope analysis | p95 ≤ 2 min | `weakness.first_ready_lag_s` = snapshot `computedAt` − `game_analyses.completedAt` of the 20th in-scope analysed game (worker, computed when `weakness_first_ready` fires) |
| Push latency `weakness:ready` | ≤ 2 s after commit | worker log `emit_ms` (`worker.weakness.emit_ms`); the e2e asserts < 5 s |
| `/train/weakness` field CWV (p75) | LCP ≤ 2.5 s, INP ≤ 150 ms, CLS ≤ 0.05, TTFB US ≤ 600 ms / India ≤ 900 ms | Vercel Speed Insights per route (optimization §2.3). On Hobby the quota is 10,000 events per 30 days team-wide, so the dev number is indicative; the lab budgets below are the gate |
| Tab switch, accordion, See all | ≤ 50 ms in the lab (no network) | Playwright trace in `profile.spec.ts` (`performance.now()` around the click) |
| Request budget | 0 `/api/*` during first paint; ≤ 1 POST per view | `e2e/specs/request-budget.spec.ts` (+ weakness step) |
| Neon | 0 extra fixed wakes per day; ≤ 10 statements per recompute | the P1 weekly CU-h report (Neon consumption API; AP-01, AP-35) + the worker timer-audit test |

### 9.5 Load tests (`perf/k6/weakness.js`; dev only; P1's perf bypass, gated on `APP_ENV` plus `ALLOW_TEST_HOOKS=1`, never `VERCEL_ENV`)

- `cold`: 20 VUs × `GET /api/train/weakness` over 20 synthetic members (`--scale 100` perf branch). Check p95 < 160 ms and an error rate < 0.5 %.
- `revalidate`: the same requests with `If-None-Match` from the first response. Check that ≥ 95 % are 304 and p95 < 80 ms.
- `recompute_burst`: 50 TR-12 calls from 10 members in 10 s. Check that exactly 10 are 202 and 40 are 429, that a repeat after a forced Neon suspend (Neon API `suspend endpoint`) is **still** 429 (the durable limit, AP-11), and that the worker drains 10 jobs with p95 duration < 2 s.
- `drill_start`: 5 rps TR-7 `{kind:"weakness"}` for 2 min. Check p95 < 250 ms.
- Thresholds abort the run on failure (`abortOnFail` for the hard SLOs). The JSON summary goes to `REPO/perf/results/p06-weakness-<sha>.json`, and `perf/compare.ts` flags a regression > 15 % against the previous run (TE X18). Each run records Vercel and Neon usage before and after (FE 10.8.7).

### 9.6 Optimisations explicitly chosen (and rejected)

| Choice | Instead of | Why |
|---|---|---|
| Per-game packed inputs (`stats` + `errorLog`) aggregated in TypeScript | SQL `unnest` over per-ply `MoveEval` (rct-b Q11) | 300 rows in 1 index scan; about 270 B per row extra |
| One coalescing job row per user, which also holds the durable recompute limit | Per-hour dedupe keys (data-model §7.3); an UNLOGGED rate-limit window | No starvation and no accumulation of DONE rows; reruns don't get lost; the limit survives scale-to-zero (AP-11) |
| A debounce of 240 s | 600 s | The post-burst recompute lands before Neon suspends (5 min), so it costs no extra wake |
| Weekly roll and heal sweep inside the daily housekeeping wake | `HOURLY_TICK` (24 wakes a day ≈ 15 CU-h a month) | 0 extra wakes (AP-08, FE F-NEON-2) |
| GET is read-only except a 1-per-30-s kick CAS | GET-side heal enqueue | Prefetch, focus refetch and polls can't create work (AP-09) |
| Live `inBank` counts (Q-W2) | Stored in the snapshot | Grading changes the bank all day; the query costs < 3 ms |
| Read-time `weekPlan`, `matchable`, `slug`, `lesson` | Stored | Taxonomy and lessons change without a recompute |
| No new indexes on per-user tables | `game_players_user_analysed_idx` (optimization §3.5.3) | Bounded per-user scans already meet the targets; one less index to write per analysed game. Revisit if Q-W3 p95 > 5 ms |
| A strong ETag from versions | Body hash | Avoids serialising on a 304 (api-design §2.12) |
| `devSchema()` for response parsing | Always `safeParse` on the client | Keeps zod out of the production bundle and saves CPU per response (AP-12) |

---

## 10. Telemetry

### 10.1 PostHog (client events are consent-gated, P11; `area_object_action` names; every event carries `device`, `viewport_w`, `zoom_bucket`, `is_trial`; `distinct_id = User.referenceId`; registry `AN/events/weakness.ts` with a zod schema per event, TE X6)

| Event | When | Properties |
|---|---|---|
| `weakness_viewed` | page mount (once per status per visit) | `status`, `patterns` (row count), `games_analysed`, `games_in_scope`, `list_mode`, `top_pattern`, `band_min`, `has_clock`, `updating`, `entry` (`nav`\|`hub`\|`home`\|`palette`\|`chord`\|`direct`\|`dot`) |
| `weakness_computing_viewed` | computing mount | `pct`, `eta_sec`, `stalled`, `target`, `orphaned` |
| `weakness_ready_seen` | TR-13 sent | `version`, `latency_s` (now − computedAt) |
| `weakness_row_expanded` | accordion open | `pattern`, `rank` |
| `weakness_tab_changed` | tab | `tab` (`phase`\|`clock`\|`open`\|`str`) |
| `weakness_see_all_clicked` | See all | `more_count` |
| `weakness_import_cta_clicked` / `weakness_play_cta_clicked` | insufficient CTAs | `analysed` |
| `weakness_include_bullet_clicked` | bullet offer | `bullet_games` |
| `weakness_recompute_clicked` | Retry, Include bullet or auto-build | `from` (`failed`\|`bullet_offer`\|`auto`), `result` (`ok`\|`rate_limited`\|`error`) |
| `weakness_week_plan_clicked` | plan row | `kind`, `pattern` |
| `weakness_drill_opened` | config or sheet opens | `pattern`, `rank`, `surface` (`inline`\|`sheet`), `entry` (`row`\|`hub`\|`plan`) |
| `weakness_drill_configured` | size or mix change | `pattern`, `size`, `mix` |
| `weakness_drill_started` | TR-7 result | `pattern`, `size`, `mix`, `own`, `puzzles`, `result` (`ok`\|`empty`\|`rate_limited`\|`error`) |
| `train_session_started` / `train_session_completed` | runner | **P5 events, reused** (CC R-18): P6 adds only `kind = "weakness"` and `theme = pattern` to P5's schema |

Properties carry pattern keys, counts and enums only: no FENs, no names, no emails. The sink's PII guard enforces this in every spec (TE X6).

Server events (worker, through the PostHog HTTP capture, `distinct_id = userRef`, no PII):

| Event | Properties |
|---|---|
| `weakness_snapshot_computed` | `status`, `algo_version`, `trigger`, `games_in_scope`, `games_analysed`, `list_mode`, `top_patterns` (3 keys), `band_center`, `band_source`, `duration_ms`, `healed_rows`, `bumped` |
| `weakness_first_ready` | `minutes_since_first_analysis`, `games_analysed`, `source_mix` (lichess/chesscom/replay shares) |
| `weakness_recompute_failed` | `code`, `attempts`, `trigger` |

Funnel dashboards (funnels, not SLOs, AP-15):

- view → drill_opened → drill_started → `train_session_completed{kind:weakness}` (rate per member per week);
- insufficient → import_cta → first_ready (days);
- a weekly retention cohort of members who drilled a weakness against those who didn't.

### 10.2 Sentry

| Where | Instrumentation |
|---|---|
| Web routes | Wrapper spans `train.weakness.get` (class R2), `train.weakness.recompute` (W1), `train.weakness.seen` (W1); DB spans through `prismaIntegration`; `tracesSampler` 0.1 by default and 0 for the polling fallback (requests with `If-None-Match` while computing); 4xx as breadcrumbs only |
| Client | `contract_mismatch` capture with the zod issues (`api()`, dev and test builds only after AP-12); breadcrumbs for `weakness:progress`/`ready` events (no payloads); render errors → `(app)/error.tsx` |
| Worker | Span `job.RECOMPUTE_WEAKNESS` with the attributes `{trigger, games, analysed, healed, status, list_mode}`; `captureException` on failure with the tags `{job_kind, algo_version, trigger}`. Metrics `worker.weakness.duration_ms`, `worker.weakness.games{status}`, `worker.weakness.healed_rows`, `weakness.first_ready_lag_s`, `worker.weakness.coalesced` (enqueues that hit an existing row), `worker.weakness.emit_ms`, `worker.weakness.kick_cas_hits` |
| Alerts | (1) `RECOMPUTE_WEAKNESS` failure rate > 5 % over 1 h. (2) TR-5 p95 > 300 ms for 3 days. (3) Any user stuck in `computing` with `stalled = true` for more than 30 min (worker health, `oldestJobAgeSec`). (4) The baseline sanity test or the profile pin fails in CI. (5) `baseline_profile_mismatch` logged by the worker |

---

## 11. Security, privacy, paywall and authorisation

| Concern | Rule in P6 |
|---|---|
| Paywall | Every P6 page and route is **members only**: `requireMemberPage()` for pages and `auth: "member"` for APIs. Admins and `BILLING_PAYWALL=off` pass (api-design §2.11.2). Lapsed members: the B26 default, a hard redirect to `/pricing?reason=expired`, with the data kept; the API answers 402 `subscription_required` with `details.reason`. If the owner approves lapsed read access, TR-5 moves to `member_or_lapsed_read` and the drill CTA shows the renew sheet. TR-12/13 and TR-7 stay `member` |
| Ownership | No user id or ref is ever accepted in a P6 request. Every query is keyed on `viewer.id`. There is no URL that names another user's profile. The pattern slug is validated against the taxonomy (`patternFromSlug`); unknown → redirect or 400 |
| Data exposure | The payload carries only the viewer's data: aggregates, the viewer's own example FENs and `mistakeRef`s. Opponent names never appear (example rows have none). Snapshots are private; P10 decides whether strengths appear on the public profile (D-P6-10; default: the own profile only) |
| Abuse and cost | TR-12 is limited to 1 per 10 min per user, durably (it survives Neon suspends, AP-11), and the recompute CPU is bounded (≤ 300 games). `ensureWeaknessCoverage` stays inside the per-member eager cap (40 trial / 200 member). Bot games are excluded, so a member can't flood their profile with forged client-run games (audit-client #294). The 1 KB / 256 B body limits come from the wrapper. GETs create no work (AP-09) |
| CSRF | Middleware rejects cookie-authenticated non-GET requests with a foreign `Origin` (403 `forbidden`, api-design §2.11.4). `keepalive` POSTs send a same-origin `Origin` |
| Service auth | Worker → socket emit and web → worker kick use the shared helper `CT/internal/auth.ts` (scheme owned by P2/P3). The worker writes with the `replay_worker` role (`statement_timeout = 60s`) and only the column grants of §6.2.3 |
| Test hooks | Registered (§7.10), guarded by `isNonProd()` + `x-e2e-token`, and proven absent in the production build by `prod-guard.spec.ts` (TE X12). `/api/dev/emit` can only target the caller's own room |
| Privacy and deletion | `weakness_snapshots` cascades from `users`. `ACCOUNT_PURGE` deletes jobs with `userId` (architecture §3.3). Retention is 12 weeks. Telemetry carries pattern keys and counts only: no FENs, no names, no emails (api-design §2.13), checked by the sink's PII guard |
| Third parties | No user data leaves our systems in P6. The coach (P7) will send weakness **facts** to Anthropic, with no names or emails (architecture §3.3) |
| Integrity of claims | Headlines are templates checked by `verifyHeadline`. Numbers come only from metrics. The baseline is versioned (`baseline.v`, the sha and the engine pin in `v1.meta.json`). A synthetic baseline can't produce production snapshots |

---

## 12. Testing

The layout follows TE X1: unit tests sit beside the source as `*.test.ts`; DB-backed tests are `*.int.test.ts` and run on the CI Docker Postgres 17 service (never Neon, TE X16); route and contract tests live under `WEB/test/api/`. `check-test-globs` must list every P6 test file. Every Playwright spec carries `@p6`. The specs `profile`, `insufficient`, `drill` and `paywall` also carry `@smoke` (TE X2, X11).

### 12.1 Unit tests (`tsx --test`)

| File | Cases |
|---|---|
| `CA/src/codec.test.ts` (+ STATS_V1, ERROR_LOG_V1) | Round trip of every field at its bounds (winLoss 0/100, clock 0–4, phase 0–2, judgement 0–2); max value 10852; rejects out-of-range values; decoding an array; STATS_V1 length 30; an older shorter array reads as "unknown" |
| `CA/src/clock.test.ts` | `clockBefore` for p = 0, 1, 2 and the last ply; empty clocks → unknown; DAILY → unknown; the bucket edges at 59 999 / 60 000 / 119 999 / 120 000 / 299 999 / 300 000 |
| `CA/src/weakness-inputs.test.ts` | `computeSideInputs` on the design mock game (`V3ReviewSummary` GAME array from `FX/design/`): the expected `stats`, `errorLog` and `errorThemeN`; `Σ errorThemeN = errorThemes.length`; inaccuracies excluded; ply ascending order; meta tags dropped; `lines` used when present, `best` otherwise; one fixture pins the worker, B-W1, the heal and J5 call sites to the same output |
| `CA/src/eco-families.test.ts` | All 500 codes map to exactly one family; sample names: C55 → Two Knights Defence "C55–C59", D35 → Queen's Gambit Declined, B22 → Sicilian, Alapin |
| `TRN/src/weakness/errorlog.positions.test.ts` (TE X13) | For every line of `FX/grades/positions.jsonl` tagged with a phase and a clock: the `ERROR_LOG_V1` judgement, phase and bucket match the line's `expected`; lines labelled INACCURACY produce no entry |
| `TRN/src/weakness/band.test.ts` | 1184 → 1100–1300 (cells 1100, 1200); 650 → 700 clamp; 2480 → 2400; source order (lichess ≥ 10 beats chesscom); unrated REPLAY rows skipped; the onboarding fallback map; null → `own_only`; the Chess.com offset applied; time-class weighting (60 % blitz / 40 % rapid); the calibration mix |
| `TRN/src/weakness/aggregate.test.ts` | `k`, `L`, `gamesWith`, `phaseCount` on handmade inputs; an error with 2 themes counts in both; time pressure uses `M_lt1` |
| `TRN/src/weakness/aggregate.property.test.ts` (TE P6; a seeded mulberry32 generator in `TRN/test/gen.ts`, no new dependency) | 500 random scopes each: adding one error with theme T never lowers T's rate; adding a game outside the scope never changes in-scope numbers; the rates are invariant to game order; `deriveStatus` is total over the full product of its inputs (snapshot none/READY/INSUFFICIENT/FAILED × recompute none/queued/running × lastJobFailed × importRunning × analysed {0,4,5,19,20,25} × inScope {0,19,20,300}) and never returns `undefined` |
| `TRN/src/weakness/patterns.test.ts` | Eligibility gates one at a time (k = 4 fails; gamesWith = 2 fails; ratio 1.49 with z 1.9 fails; ratio 1.5 passes; z 2.0 passes; `you ≤ band` fails); ranking by excess loss; ties; top 3 + more 2; `own_only`; the `most_frequent` fallback; time pressure only when `M_lt1 ≥ 100`; meta tags are never candidates; the `rc:missedThreat` / `defensiveMove` merge |
| `TRN/src/weakness/trend.test.ts` | +20 % → worse; −20 % → better; ±19 % → same; prior 0 → uses 0.1; < 100 moves in a window → unknown; time pressure with 30 moves; windows use `endedAt` relative to a fixed `computedAt` |
| `TRN/src/weakness/breakdown.test.ts` | Phase-weighted mean; null below 60 moves; every sentence variant; clock per-bucket null below 30 moves; the tab null below 100; the "doubles" / "triples" / "×" wording; `ariaLabel` text exactly as on the board; openings notes priority and thresholds; ECO range formatting |
| `TRN/src/weakness/strengths.test.ts` | Conversion shown at 9/10 and hidden at 4/5 reached; book exit 81 % White wins over 75 % Black; phase strength +3; max 2; empty list |
| `TRN/src/weakness/headline.test.ts` | The desktop and short texts for the design case; the time-pressure variant; most_frequent; every claim checked by `verifyHeadline`; a mutated metric makes verify fail → the fallback text |
| `TRN/src/weakness/preliminary.test.ts` | 4 analysed → []; 14 analysed → "Seen in 5 of 14 games"; max 3; `gamesWith ≥ 2` |
| `TRN/src/weakness/status.test.ts` | Every branch of `deriveStatus`: READY + recompute → updating; FAILED + no job → failed; FAILED + queued → computing; 20 analysed without a snapshot → computing with `orphaned`; import running → computing; inScope 19 → insufficient; the bullet-offer condition |
| `TRN/src/weakness/progress.test.ts` | Weights (import 50 % → pct 7 + …); step states; ETA text thresholds (89 s, 90 s, 89 min, 90 min, null); `stalled` at 10 min with a fixed `now`; N capped at 100 (member) and 20 (trial); `orphaned` |
| `TRN/src/weakness/version.test.ts` | First READY bumps; a new top-1 bumps; a new member of the top 3 bumps; reordering within the top 3 doesn't; INSUFFICIENT never bumps |
| `TRN/src/weakness/slug.test.ts` | Round trip for every candidate key; unknown → null; `rc:timePressure` ↔ `time-pressure` |
| `TRN/src/weakness/compute.golden.test.ts` | Fixture `TRN/test/fixtures/weakness/member-design.json` (GamePlayer rows synthesised to reproduce the board numbers) + `baselines/v0-synthetic.json` → must equal `member-design.golden.json`: rows "Missed forks 3.1 / 1.6, Getting worse", "Loose pieces 2.4 / 1.9, About the same", "Time-pressure blunders 4.0 / 2.2, Improving"; phases 88/84, 71/76, 79/74; clock 0.8, 1.1, 2.6, 3.4; the openings table; 2 strengths; the headline text. A second golden, `member-design.v1.golden.json`, is computed with `v1.json` and used by the nightly dev check (§12.4). Regenerate either file only with a reviewed `--update` flag |
| `TRN/src/weakness/drill.test.ts` | 10 + mix → 6 own + 4 puzzles in the order `o p o p o p o p o o`; 20 → 12 + 8; mix off with 7 own → 7 (few); zero own + matchable → puzzles only; zero own + unmatched → `empty_drill`; time pressure → own only; a puzzle shortfall (shards return 2) → size 8 with `meta.widened`; `previewWeaknessDrill` matches the composer for the same inputs |
| `TRN/baselines/baselines.test.ts` | The schema; every cell has ≥ 20k moves; the monotonic soft check; the sanity bounds; the synthetic flag is false in `v1.json`; `meta.profile` = `ENGINE_PROFILE` |
| `WEB/lib/api/queries/weakness.test.ts` | With fake timers, `weaknessQuery()` re-created on every simulated render still stops polling after 15 min (AP-20); `done` flipping false → true → false starts a new episode; `devSchema` returns `undefined` when `NODE_ENV=production` |
| `WEB/components/train/weakness/*.test.tsx` | `LessonLink`, the drill-config lesson row and the week-plan lesson row render only with a non-null lesson; `RateBar` `scaleMax`; copy for every sub-state from `copy.ts` |
| `WK/src/env.test.ts` | Boot refuses `WEAKNESS_SEED_FREEZE` with `APP_ENV=production` |

### 12.2 API contract tests (`WEB/test/api/train-weakness.int.test.ts`; route handlers against the CI Docker Postgres; never production)

| Route | Cases |
|---|---|
| TR-5 | Signed out → 401; user R → 402 `subscription_required` with `details.reason`; flag off → 404; member → 200 that parses `WeaknessPayload`; the same request with `If-None-Match` → 304 and an empty body; the ETag changes after a bank grade (`inBank` changes), after TR-13 (`seenVersion` changes) and after a snapshot write; no data from a second seeded user; size < 8 KB; `Cache-Control: private, no-cache`; **the GET performs no INSERT** (the P1 statement counter in GET-purity mode passes with `sideEffects: ["kick_cas"]`); with a QUEUED job older than 30 s, two GETs within 30 s run exactly one kick; the `orphaned` flag for 22 analysed + no snapshot + no job |
| TR-12 | 202 and a job row (`dedupeKey weakness:{id}`, `payload.userAt`); a second call within 10 min → 429 with `retryAfterSec` between 1 and 600 and a `Retry-After` header; the 429 still holds after `TRUNCATE rate_limit_buckets` (simulating a Neon suspend; AP-11); with `x-rc-now` + 601 s → 202 again; invalid `timeClasses` (`["DAILY"]`, duplicates) → 400 with `fields`; `months: 4` → 400; a body > 1 KB → 413; a scope change updates `training_profiles.weaknessTimeClasses/weaknessMonths` and sets `scopeChanged:true`; a 429 leaves the scope unchanged; Retry on FAILED resets attempts; two concurrent calls → exactly one 202 |
| TR-13 | 204; a version above `weaknessVersion` is clamped; a lower version is a no-op (GREATEST); a repeat is idempotent; 402 for user R |
| TR-7 weakness | 201 with ≤ 20 items, `header.title "Weakness drill"`, `countsTowardCap false`; the same `Idempotency-Key` → the same `ref` (200, `Idempotent-Replayed: true`); the same key with another body → **422** `idempotency_key_reused`; unknown pattern → **400** `validation_failed {reason:"unknown_pattern"}`; nothing to drill → **400** `{reason:"empty_drill"}`; it reuses an ACTIVE session < 2 h with the same `filterKey`; the 31st call within an hour → 429 |
| ME-2 / TR-1 / HOME-1 | `weaknessReady` follows the versions; `trainDot`; the `allTraining.weakness` shape; `plan.basis "games20"`; the Home `topTheme` source `weakness` versus `bank` |
| Registry | Every P6 endpoint goes through the Appendix D matrix (auth, 400 on malformed JSON, 413, rate-limit headers, response schema, cache-tier lint: no `max-age > 0` on a member route), and the `openapi.json` regeneration has no diff |
| Lesson contract | `weakness-lessons.contract.test.ts` (§7.6) |

### 12.3 Worker integration tests (`WK/test/weakness/*.int.test.ts`; Docker Postgres in CI; a fake `/internal/emit` server; a fake clock)

- **Enqueue semantics (§7.4.1):** QUEUED keeps the earliest `runAt`; RUNNING sets `rerun` and completion re-queues at +240 s; DONE re-arms at `finishedAt + 240 s`; a `user` trigger with debounce 0 runs now; the priority only rises while queued and resets after DONE; the payload merges (an `analysis` trigger keeps `userAt`).
- **Handler, happy path:** a READY snapshot for the week; the right `weekStart` in `Asia/Kolkata` and `America/Los_Angeles` on a Sunday night or Monday morning; `weaknessVersion` bumped once; `weakness:ready` emitted with `bumped:true` to `user:{ref}` with the `targets` body; the PostHog capture called once.
- **Rerun in the same week:** an upsert (1 row), no bump when the top is unchanged.
- **Lapsed user:** DONE `skipped:'lapsed'`, no write.
- **Heal:** rows with `weaknessInputsV = 0` are filled once (all five columns); a second run heals nothing.
- **Failure:** 3 thrown attempts → a FAILED snapshot only when there is no READY row; with a READY row present the row is unchanged; the Sentry capture has its tags.
- **Coverage:** with 212 unanalysed games in scope, a member gets at most 100 in-scope analysed + queued (20 at `IMPORT_NEWEST`, the rest at `WEAKNESS`, `fairSeq` = rank); a trialist gets at most 20; the member's total eager count never exceeds 200 (40 trial); existing QUEUED jobs are raised, never lowered.
- **Progress emitter:** throttled (no 2 emits within 10 s unless pct moves ≥ 5); `first_build` enqueued at 5, 10, 15 and 20; nothing once `hasReady`.
- **Daily slice:** the weekly roll picks only stale-week, entitled, recently active users and enqueues at `now()`; the heal sweep picks the orphaned and old-algo users only; the prune keeps the newest 12 per user.
- **Lanes:** a `RECOMPUTE_WEAKNESS` row is claimed by the I/O lane while the engine lane is busy.
- **Timer audit (AP §5):** the worker booted with P6's handlers and a fake clock for 24 idle hours issues ≤ 5 DB round trips.

### 12.4 End-to-end (Playwright; `WEB/e2e/specs/weakness/*.spec.ts`)

Data comes from **leased personas** (§6.8; `leasePersona(name)` in `WEB/e2e/fixtures/users.ts`, TE X4). No spec mutates a shared letter. Server time comes from `serverNow.set()` (`x-rc-now`, TE X5) where a test crosses a window. Telemetry is asserted through `WEB/e2e/fixtures/telemetry.ts` (sink + PII guard, TE X6). The console and hydration guard runs automatically (TE X7). Each spec carries its `@state:` tags (§4.1).

| Spec | Persona | Steps and asserts |
|---|---|---|
| `insufficient.spec.ts` `@smoke` | `weak-insufficient`, `weak-few`, `weak-zero`, `bullet` | The h2 text, the meter `aria-label`, 2 preliminary rows, the import CTA href `/settings/connected`, play CTA "6 more"; `weak-few` → the empty-state copy; `bullet` → the banner → click → 202 → computing. Tags `@state:V3WeaknessInsufficient.insufficient` |
| `computing-to-ready.spec.ts` | `weak-computing` | Steps advance with the `aria-live` milestones (events pushed through `POST /api/dev/emit` to the caller's own room); navigate to `/home`; the persona step `weak-computing:ready` writes the snapshot, then emit `weakness:ready {bumped:true}`; the Train nav dot appears; return → the ready flash → "See your weakness profile" → profile; TR-13 sent once; the dot cleared. Telemetry: `weakness_ready_seen` exactly once. Tags `@state:V3WeaknessComputing.computing` |
| `computing-fallback-poll.spec.ts` | `weak-computing` | Block WebSocket (`page.route('**/socket.io/**', r => r.abort())`): TR-5 polls about every 3 s with `If-None-Match` and gets 304s; stops when the tab is hidden (`page.evaluate` visibility override); stops at ready; stops after 15 min with `page.clock` |
| `computing-stalled.spec.ts` | `weak-computing` | `serverNow.set(+11 min)` → the stalled copy, the bar stops animating |
| `orphaned-autobuild.spec.ts` | `weak-orphaned` | First paint → exactly one TR-12 POST → 202; a reload within 10 min → the second auto-build gets 429 and the UI stays in computing with no error toast; the GET itself never enqueued (DB check through the persona script) |
| `profile.spec.ts` `@smoke` | `weak-member`, `noclock` | Row 0 open; opening row 2 closes row 0; keyboard ↓/↑/Home/End across headers; See all → 5 rows → Show fewer; tabs with arrow keys (no network: `page.on('request')` counts 0 `/api/*`); the Clock `aria-label` equals the full sentence; the openings table semantics; the strengths box (desktop) or tab (phones); `noclock` hides the Clock tab and shows its footnote. Telemetry: `weakness_viewed{status:"ready", patterns:3}` and `weakness_row_expanded{pattern}`. Tags `@state:V3WeaknessProfile.default` |
| `drill.spec.ts` `@smoke` | `weak-member` | Row 1 Drill → URL `/train/weakness/fork`; size 20 → "12 + 8"; mix off → "12 from your games only (12 in your bank)"; Start → runner `?s=` with the header "Weakness drill"; solve 2 items (1 own, 1 puzzle) with the P5 runner helpers; end → the summary eyebrow; the bank cap is unchanged (TR-1 `capRemaining` equal before and after); `Esc` on the config returns to `/train/weakness`. Telemetry: `weakness_drill_started{pattern:"fork", size:20, mix:true}`. Tags `@state:V3WeaknessDrill.drill` |
| `drill-time-pressure.spec.ts` | `weak-member` | The checkbox is disabled with its description; the session contains only own items |
| `drill-sheet.spec.ts` | `weak-member` (iPhone project) | Drill opens the sheet; Back closes it; Start works; the sheet stays within the viewport at 125 % zoom |
| `failed-retry.spec.ts` | `weakfail` | Retry → computing (optimistic) → a second Retry → the countdown is visible; `serverNow.set(+601 s)` → Retry → 202 |
| `paywall.spec.ts` `@smoke` | user R (read-only) | Page → `/pricing?reason=…&redirect_url=%2Ftrain%2Fweakness`; API 402 with `details.reason`. Runs with `BILLING_PAYWALL=on` (TE X3) |
| `lights-up.spec.ts` | `weak-member` | Hub row text and href; the hub footnote; the Home bank line; ⌘K "Weakness profile"; the `g w` chord |
| `request-budget.spec.ts` (extend) | `weak-member` | 0 `/api/*` requests during first paint of `/train/weakness` |
| `flags-off` project (TE X11) | P5 `@smoke` specs | With `FLAGS_OVERRIDE=weakness:off`: the hub and Home snapshots equal P5's; `/train/weakness` → `/train` |

The draft used shared users C and D. That collided with P5's bank specs, because D's seeded analyses created bank cards (TE X4).

**Device × zoom** (`WEB/e2e/devices/train/weakness.spec.ts`; tiered per TE X9; runs against `next start` in CI, not the deployed dev site, FE #8):
- the PR tier runs `desktop-1440@100`, `desktop-1280@125`, `iphone@100` and `ipad-portrait@100`;
- the nightly tier runs all 40 projects.

For each demo state (insufficient-preliminary, computing, ready, ready-see-all, drill, drill+lesson, failed, loading), both normal and `stress=1`:
- `document.scrollingElement.scrollHeight <= innerHeight`;
- the header and headline are visible;
- the first row header is inside the viewport;
- desktop: the tabs are visible without scrolling the page;
- phones: the tab bar is visible and the sheet stays within the viewport;
- touch targets ≥ 44 px (P1 `e2e/devices/a11y.ts`);
- axe has no serious violations.

**Real-route layer** (`e2e/devices/layout/routes.real.ts`): `/train/weakness` and `/train/weakness/fork`, signed in as the leased `weak-member`, on `desktop-1440@100/150`, `iphone@100/125` and `ipad-portrait@100`. The `loading` states are reached here by delaying the RSC response with `page.route`.

**Visual regression** (`WEB/e2e/visual/weakness.visual.spec.ts`; P1's `toHaveScreenshot` tooling, TE X10): `V3WeaknessProfile` default, drill, insufficient and computing × the 4 UI projects, light and dark, at 100 %; desktop also at 125 % and 150 %. Avatars and relative dates are masked with `[data-vr-mask]`.

**Nightly on dev** (`nightly.yml` job `weakness-recompute-check`, TE P6 / X2): lease a pool user, reset it to `weak-member` on the Neon dev branch, call TR-12 on the dev URL, wait ≤ 2 min for the snapshot written by the **real dev worker**, normalise times and ids, and compare with `member-design.v1.golden.json`. A mismatch fails the job and opens an issue. This catches drift between `baselines/v1.json`, the tagger and the dev environment.

### 12.5 Chess-correctness fixtures (`FX/weakness/` + the shared corpus)

- **Shared grade corpus (TE X13):** P6 adds no private label table. It reads `FX/grades/positions.jsonl` (P3) for the `ERROR_LOG_V1` judgements (§12.1) and the design positions in `FX/design/*.json` (P2) for `computeSideInputs`.
- **`clock-games/*.pgn`:** 6 CC0 Lichess blitz/rapid games with `%clk` and `%eval`, with hand-verified expected `errorLog` (judgement, phase, clock bucket and Win% loss for each error), `stats` and `rc:timePressure` occurrences. Includes an increment game (3+2) and a game that starts from a FEN (odd `startPly`).
- **`examples.json`:** 10 mistakes with `setupUci`. The expected FEN after the setup move must be legal and have the user to move, and the orientation must match the colour.
- **`drill-legality.test.ts`:** every item of a composed weakness session replays its `solution` legally from `fen` + `setup` with chess.js.
- **`baseline-sample.json`:** 50 baseline sides with expected per-side records, so the J5 aggregation is tested without the dump.
- **Tagger recall gate (R-THM-05):** reused from P5 (≥ 85 % recall on Tier 1, 500 CC0 puzzles per theme). It matters doubly here, because the baseline and the users use the same tagger.

### 12.6 Regression of earlier phases

The gate is **the whole suite** on the final SHA with the paywall on: the main and device suites nightly, plus one run against the dev URL (TE X11). These targeted checks are extras:

- the `analyzeGame` batch still writes `counts`, `accuracy`, `phaseAccuracy` and `headline`, plus the five new columns, in one `sql.transaction`;
- P5's J1 extraction is unchanged except for the `rc:timePressure` tag (golden test);
- `getTrainToday` output for a user **without** a snapshot is byte-identical to P5 (no slot rendered);
- the hub and Home render with the flag off (the `flags-off` project);
- P4's import specs: with `RECOMPUTE_WEAKNESS` added to the I/O lane, an `IMPORT_SYNC` waits behind at most one weakness job (lane test with 2 slots).

Every defect found by the owner test, the ego-browser pass or a real device first gets a failing test named `regression: <slug> (#issue)` (TE X14). Flaky specs go to `WEB/e2e/quarantine.json` with an expiry of ≤ 14 days.

### 12.7 Manual ego-browser checklist (dev site `https://replay-chess-dev-replaychess007-1069.vercel.app`, OCI dev socket `wss://ws-dev.80-225-200-210.sslip.io`)

1. Personas `trial`, `member`, `weakcompute`, `weakfail`, `bullet`, `noclock`: each state matches its board (side by side with `DR/*.dc.html` open in the canvas at its `$preview` size).
2. Real-device pass: iPhone (Safari), Android (Chrome), iPad portrait and landscape. Check the safe areas, the sheet drag and Back, and the tab overflow. Record the model and OS version.
3. Desktop at 80, 100, 110, 125 and 150 % zoom in Chrome and Safari: no page scroll, the week plan hidden at 150 %, the rail at ≤ 1100 px.
4. Stop the dev worker (`docker compose stop analysis-worker` on 80.225.200.210) while `weakcompute` is computing. After 10 minutes the stalled copy shows; restart the worker → progress resumes.
5. Kill the socket in DevTools (offline WS) → the fallback poll gives 304s in the Network tab, then stops after 15 min; come back online.
6. Keyboard only: reach every control; the visible focus ring; `g w`; `Esc` on the drill config.
7. VoiceOver/TalkBack: the rate bars read "You 3.1 per 100 moves, rating band 1.6"; the Clock chart is read in full; progress milestones are announced once each.
8. Light and dark themes.
9. PostHog live events show for each interaction (consent given); `scripts/qa/error-window.ts --since <deploy>` shows no new Sentry or Vercel errors for at least 24 h (TE X6.7).
10. Close the ego-browser pages when done (`task.finish({ keep: [] })`).

The results go into `REPO/docs/qa/phase-06-signoff.md` (TE X15): the SHA, the Vercel deployment id and OCI image tags, each T1–T13 row with pass/fail and a screenshot path under `docs/qa/phase-06/`, the devices, the state-coverage table, the error-window output, the k6 result files, the CU-h before and after, and the defects with their regression tests. The test window runs from the last dev deploy of the phase to sign-off and is at least 24 h.

### 12.8 Performance checks before done

- `explain-hot-queries.ts` passes on a throwaway branch, including the index existence check (§9.1).
- k6 `weakness.js` passes (§9.5), and the result JSON is committed.
- `worker bench`: `pnpm --filter analysis-worker bench:weakness --users 20 --games 300` reports p95 < 2 s.
- The `next build` route budget for `/train/weakness` is ≤ 90 KB gz, and `ZodError` is absent from its chunks.
- Speed Insights shows LCP p75 ≤ 2.5 s after 3 days on dev (owner traffic only, so indicative).

---

## 13. Work breakdown (9 dev-days + 1.8-day buffer; strict file ownership; one owner per file for the phase)

Packages can run in parallel where the dependencies allow. "Owner" is a stream (one developer + Claude agents). Any edit to a file owned by another package goes through that package's owner. P6 runs alongside P9/P12 (stream B, feasibility §7). Shared registries are therefore edited in their directory form (`lib/realtime/handlers/weakness.ts`, `lib/flags/registry/p6.ts`, `config/redirects/p6.mjs`, `e2e/personas/weakness.ts`, `WK/src/scheduler/recurring/weakness.ts`), so P6 adds files instead of editing code another phase is changing.

| WP | Name | Depends on | Days | Owner |
|---|---|---|---|---|
| WP1 | Contracts + pure weakness engine | P5 taxonomy | 1.25 | A |
| WP2 | Baseline J5 (script + `v0-synthetic` + `v1`, engine pin) | WP1 types | 0.75 (+ ≈ 2 h laptop compute) | B |
| WP3 | Schema M6 + input builder + codecs + backfills | — | 1.25 | C |
| WP4 | Worker job, coverage, progress, daily slice, lanes | WP1, WP3 | 1.5 | C |
| WP5 | Web DAL + TR-5/12/13 + TR-7 weakness branch | WP1, WP3 | 1.0 | A |
| WP6 | UI: routes, components, states, hooks, demo route | WP1 (contracts + fixtures) | 1.75 | D |
| WP7 | Lights up: hub, Home, badges, nav, how-we-grade, redirect, docs | WP5, WP6 | 0.5 | D |
| WP8 | E2E, personas, device/visual suites, k6, explain, telemetry registry, nightly check, sign-off, runbooks | WP4–WP6 | 1.0 | B |
| — | Buffer (20 %, feasibility §8) | — | 1.8 | unassigned |

**Timeline (with parallel streams):**

- Day 1–2: WP1 ∥ WP2 (synthetic baseline on day 1) ∥ WP3.
- Day 2–4: WP4 ∥ WP5 ∥ WP6 (WP6 runs against fixtures and the `/dev/ui/weakness` route from day 2).
- Day 4–5: WP7 ∥ WP8; the `v1.json` baseline swap; integration on dev.
- Day 5–6: the owner test script, then the ≥ 24 h test window and sign-off.

Calendar is about 6 working days with 3–4 streams, or 9 days (10.8 with the buffer) sequentially.

### WP1: Contracts + pure engine (A, 1.25 d)

- **Creates:**
  - `CT/http/weakness.ts`;
  - `TRN/src/weakness/{constants,scope,band,aggregate,patterns,trend,where,breakdown,openings,strengths,headline,preliminary,status,progress,version,slug,labels,drill,compute,index}.ts`;
  - the `TRN/src/weakness/*.test.ts` tests listed in §12.1, including `aggregate.property.test.ts`, and `TRN/test/gen.ts`;
  - `TRN/test/fixtures/weakness/{member-design.json,member-design.golden.json}`;
  - `WEB/components/train/weakness/__fixtures__/payloads.ts` (built by `buildPayload` from the golden data, with `lesson` and `stress` variants).
- **Edits:**
  - `CT/http/registry/train.ts` (register 3 endpoints, with `sideEffects` on TR-5);
  - `CT/http/train.ts` (the `SessionCreate` weakness member, the summary eyebrow variant);
  - `CT/socket/user.ts` + `CT/socket/registry.ts` (2 events + registry entries);
  - `DB/src/jobs.ts` (`RecomputeWeaknessPayload`; `JOB_PRIORITY.WEAKNESS` if absent);
  - `TRN/src/themes.ts` (`weaknessCandidate`, `weaknessLabel`, `lichessMatch`, the `rc:timePressure` key);
  - `TRN/src/session.ts` (dispatch `kind:"weakness"` to `weakness/drill.ts`);
  - `AN/events/weakness.ts` (the event schemas; extends P5's `train_session_*` with `kind`/`theme`).
- **Acceptance:**
  - every §12.1 TRN test is green;
  - the golden design test reproduces every number on the board;
  - `buildPayload(golden)` parses with `WeaknessPayload` and is < 8 KB, with and without lessons;
  - no Prisma, Node built-ins or DOM in `TRN/src/weakness/*` (lint rule).

### WP2: Baseline (B, 0.75 d + compute)

- **Creates:**
  - `TRN/scripts/build-baseline.ts` (stream parser, sampler, `--synthetic`, `--calibrate`, the engine pin check);
  - `TRN/baselines/{schema.ts,load.ts,v0-synthetic.json,v1.json,v1.meta.json,baselines.test.ts}`;
  - `TRN/test/fixtures/weakness/member-design.v1.golden.json` (after `v1.json` lands);
  - `REPO/docs/runbooks/weakness-baseline.md` (download, pin check, run, verify, commit, quarterly refresh, the `ALGO_VERSION` bump rule).
- **Edits:** none outside these.
- **Acceptance:**
  - `v1.json` committed, built from one 2026 monthly dump, with ≥ 2,000 sides per cell (or an explained shortfall at the 2300+ bands);
  - the tests pass;
  - the dump sha256, the engine binary sha256, the NNUE net hash and `profile: "sf18-v1"` recorded;
  - `ratingOffsets` present (0 values flagged [V]).

### WP3: Schema + inputs (C, 1.25 d)

- **Creates:**
  - `DB/prisma/migrations/…_m6_weakness/migration.sql` (and `…_m6a_jobkind_weakness/` only if the day-1 enum check fails);
  - `DB/json/weakness.ts`;
  - `CA/src/weakness-inputs.ts` (+ test), `CA/src/clock.ts` (+ test, if P3 has none), `CA/src/eco-families.ts` (+ test);
  - `WEB/scripts/backfill/{backfill-weakness-inputs.ts,backfill-mistake-timepressure.ts,enqueue-weakness-recompute.ts}`.
- **Edits:**
  - `DB/prisma/schema.prisma` (§6.1);
  - `DB/prisma/protected-indexes.txt`;
  - `DB/scripts/roles/{replay_worker,replay_app}.sql` (§6.2.3);
  - `CA/src/codec.ts` (STATS_V1, ERROR_LOG_V1) + its test;
  - `CA/src/themes/index.ts` (the `tagErrorPly` wrapper; P5 file, no detector changes).
- **Acceptance:**
  - the migration applies with `migrate deploy` on a throwaway child of the Neon dev branch over the real migration chain, and on the CI Docker Postgres;
  - the drift gate is clean;
  - the backfills are idempotent (a second run changes 0 rows) and refuse hosts outside `BACKFILL_ALLOWED_HOSTS`;
  - the codec and inputs tests are green;
  - `prisma validate` passes;
  - the dev branch is migrated (after the AP-01 project split or with the owner's OK).

### WP4: Worker (C, 1.5 d)

- **Creates:**
  - `WK/src/handlers/weaknessRecompute.ts`;
  - `WK/src/weakness/{context,load,heal,coverage,progressEmitter,examples,write}.ts`;
  - `WK/src/scheduler/recurring/weakness.ts` (the daily slice);
  - `DB/src/sql/enqueueWeakness.ts` (the shared SQL builder, with the durable-limit variant);
  - `WK/test/weakness/*.int.test.ts`;
  - `WK/scripts/bench-weakness.ts`.
- **Edits:**
  - `WK/src/handlers/index.ts` (register);
  - `WK/src/handlers/analyzeGame.ts` (the five columns and the enqueue statement in the final batch; progress after commit);
  - `WK/src/jobs/import-sync.ts`, `WK/src/import/progress.ts` (finish and page hooks);
  - `WK/src/extract/extractMistakes.ts` (`rc:timePressure`);
  - `WK/src/queue/lanes.ts` (I/O lane kinds);
  - `WK/src/queue/complete.ts` (`rerunIfFlagged`);
  - `WK/src/env.ts` (+ `env.test.ts`), `WK/.env.example`;
  - `REPO/deploy/oci/docker-compose.yml` (env vars only).
- **Acceptance:**
  - every §12.3 test is green, including the timer audit;
  - on dev, linking the Lichess fixture account for `weak-fresh` reaches READY;
  - bench p95 < 2 s;
  - no polling timers added (the worker sleeps until `min(runAt)`);
  - the `WEAKNESS_JOBS_ENABLED=false` kill switch is verified.

### WP5: Web API (A, 1.0 d)

- **Creates:**
  - `WEB/lib/train/weakness.server.ts` (`getWeakness`, `buildLive`, the ETag parts, the kick CAS);
  - `WEB/lib/train/weakness-write.server.ts` (`requestRecompute` with the durable limit, `markWeaknessSeen`);
  - `WEB/lib/train/weakness-lessons.server.ts` (the stub returning null) + `weakness-lessons.contract.test.ts`;
  - `WEB/app/api/train/weakness/route.ts`, `recompute/route.ts`, `seen/route.ts`;
  - `WEB/lib/api/queries/weakness.ts` (+ test);
  - `WEB/test/api/train-weakness.int.test.ts`.
- **Edits:**
  - `WEB/lib/train/sessions.server.ts` (the weakness branch, Q-W7);
  - `WEB/lib/api/endpoints.ts` (paths) and `WEB/lib/api/keys.ts` (`qk.train.weakness`, if P5 did not add it);
  - `WEB/lib/api/rate-limit-buckets.ts` (`weakness-recompute-burst`);
  - `WEB/lib/realtime/resync.ts` (add `qk.train.weakness()`).
- **Acceptance:**
  - every §12.2 test is green;
  - the 304 path works;
  - the GET-purity check passes;
  - the p95 targets are met in k6 on dev;
  - no Prisma import in the route files (lint).

### WP6: UI (D, 1.75 d)

- **Creates:**
  - `WEB/app/(app)/train/weakness/{page.tsx,loading.tsx}`;
  - `WEB/app/(app)/train/weakness/[pattern]/page.tsx`;
  - the components in `WEB/components/train/weakness/` listed in §4.10, plus `copy.ts` and the component tests;
  - `WEB/features/train/weakness/{useRecomputeWeakness.ts,useAutoBuildWeakness.ts,useMarkWeaknessSeen.ts,useStartWeaknessDrill.ts,view-state.ts}`;
  - `WEB/lib/realtime/handlers/weakness.ts`;
  - `WEB/app/dev/ui/weakness/page.tsx`.
- **Edits:** `WEB/lib/realtime/useUserChannel.ts` (register the handler module, one line).
- **Acceptance:**
  - every state in §4 is reachable from real data (leased personas) and from `/dev/ui/weakness?state=`;
  - all 19 board enum values carry `@state:` tags, and `state-coverage` shows 0 missing;
  - the PR-tier device × zoom spec is green;
  - axe is clean;
  - tabs and accordion make no network requests;
  - route JS ≤ 90 KB with no zod.

### WP7: Lights up (D, 0.5 d)

- **Edits:**
  - `WEB/lib/train/today.server.ts`;
  - `WEB/components/train/hub/{AllTrainingList.tsx,ThemeMasteryBars.tsx}`;
  - `WEB/lib/home/home.server.ts`;
  - `WEB/components/home/BankCard.tsx`;
  - `WEB/lib/auth/viewer.ts`, `WEB/lib/train/badges.server.ts` and `WEB/app/api/me/badges/route.ts`;
  - `WEB/lib/nav/destinations.ts` (destination `weakness`: label "Weakness Profile", href `/train/weakness`, parent `train`, chord `g w`, `enabled` = flag);
  - `WEB/app/(marketing)/how-we-grade/page.tsx`;
  - `WEB/lib/flags/registry/p6.ts` (flag `weakness`);
  - `WEB/next.config.js` or `WEB/config/redirects/p6.mjs` (the redirect, 307 on dev);
  - `REPO/docs/implementation-plan.md` (the §6 pointer).
- **Creates:** `WEB/components/marketing/HowWeGradeWeakness.tsx`.
- **Acceptance:**
  - `lights-up.spec.ts` is green;
  - the `flags-off` project shows the hub and Home byte-identical to P5;
  - `/weakness` → 307 on dev.

### WP8: Quality and data (B, 1.0 d)

- **Creates:**
  - `WEB/e2e/specs/weakness/*.spec.ts` (§12.4);
  - `WEB/e2e/personas/weakness.ts` (the leased persona writers and the `weak-computing:ready` step);
  - `WEB/app/api/dev/emit/route.ts` (if no earlier phase created it);
  - `WEB/e2e/devices/train/weakness.spec.ts`, `WEB/e2e/visual/weakness.visual.spec.ts`;
  - `REPO/perf/k6/weakness.js`;
  - `DB/prisma/seed/weakness.ts`;
  - the `nightly.yml` job `weakness-recompute-check` and its script `WK/scripts/nightly-weakness-check.ts`;
  - `REPO/docs/runbooks/weakness.md` (states, stuck computing, re-enqueue, the kill switch, rollback);
  - `REPO/docs/qa/phase-06-signoff.md` (template, filled at sign-off).
- **Edits:**
  - `DB/prisma/seed/{index.ts,personas.ts}`;
  - `WEB/scripts/explain-hot-queries.ts` (queries + index names);
  - `WEB/lib/test-hooks/registry.ts` (§7.10);
  - `WEB/e2e/specs/request-budget.spec.ts` (the weakness step);
  - `e2e/devices/layout/routes.real.ts` (the weakness routes).
- **Acceptance:**
  - CI green (lint, `check-types`, unit, integration, drift gate, `check-test-globs`, `prod-guard`, `state-coverage`, Playwright smoke, the PR device tier);
  - the nightly main, device and visual suites green on the final SHA;
  - the personas seed on dev;
  - k6 and explain pass, and their result files are committed;
  - the nightly dev recompute check has matched the golden once.

---

## 14. Risks, open questions and decisions needed

### 14.1 Risks

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R1 | **Time to first profile** on the 1-OCPU boxes: 20 games × about 40 s ≈ 13 min when the lane is free, and longer behind other users' imports | High / M | A real ETA, "you can leave", the push plus the nav dot; first READY at 20 analysed games (newest first) with the rest analysed in the background; Lichess `%eval` games skip pass 1; 2 lanes on the P13 worker VM |
| R2 | **Baseline bias** between Lichess `%eval` (their budgets) and our `sf18-v1` grading (R-WK-03) | M / M (inflated or deflated "vs band") | The calibration factor (§7.4.5 step 6); the engine pin (same binary, net and profile as the worker); imported Lichess games use the same eval source; `v1.meta.json` records the residual; quarterly refresh |
| R3 | **Chess.com versus Lichess rating scale** (R-WK-02 [V]): a Chess.com 1184 compared with Lichess 1100–1300 players | High / M | `ratingOffsets.CHESSCOM` per time class in the baseline (0 in v1); decision D-P6-5; "How this is calculated" says "players rated … on Lichess" |
| R4 | **Tagger recall** drives both the user and the baseline theme rates; a weak tagger makes the top 3 noisy | M / H | The same tagger on both sides cancels systematic misses; the P5 ≥ 85 % recall gate; Tier-2 themes are ranked only once their recall is ≥ 85 % (`weaknessCandidate` per theme) |
| R5 | **Small samples** (20 games ≈ 700 moves) give unstable patterns | M / M | `k ≥ 5`, `gamesWith ≥ 3`, the ratio or z gates; "Preliminary" below 20; the trend shows "unknown" under 100 moves per window |
| R6 | P3 ships no `stats`/`errorThemes` (now certain), so P6's input builder adds CPU to every analysis and must backfill every analysed row | High / L | About 5 ms CPU per side in the final batch (no engine); B-W1 is CPU-only and idempotent; the worker heal covers any row B-W1 missed |
| R7 | Neon CU-hours: recomputes wake the compute | L / M | The 240 s debounce lands inside the same wake as the analysis; the daily slice rides the housekeeping wake; the durable limit; no timers; the weekly CU-h report |
| R8 | Design deltas: the phone boards skip the drill config; "about a minute"; the lock icon; legend lessons absent until P8 | M / L | The decisions below; the copy list C1–C10 |
| R9 | Analysis CPU per new member competes with just-played games | M / M | The priority order (the weakness lane is below user-opened and just-finished games); P6 stays inside P4's eager cap (200 member / 40 trial); `fairSeq` interleaving |
| R10 | Entitlement checks in the worker diverge from the web | L / M | One shared `isEntitled`/`isTrialing` (P3/P4) |
| R11 | Week boundaries in user time zones (DST, a time zone change) | L / L | `Intl`-based `weekStart`; tests across zones; a time zone change at worst creates a new row |
| R12 | **Cross-phase naming drift**: the critiques disagree on `endedAt` vs `playedAt` and on the internal-auth scheme. If P2/P3 choose differently, P6's SQL or calls break | M / M | All P6 SQL lives in `DB/src/sql/*` and `WK/src/weakness/*`; the index existence check and the `*.int.test.ts` suites fail in CI on the first mismatch; the rename is mechanical; internal calls go only through `CT/internal/auth.ts` |
| R13 | **P8 never lights the lesson slots** (critique C-07: P8 does not mention the resolver today) | M / L | The slots stay hidden (no dead links); the exact contract and the P8 spec cases are written down (§7.6); open question §14.3 |
| R14 | **"Launch A" schedule cut** (feasibility §8) moves P6 after launch | M / L | P6 is self-contained behind `weakness` and `WEAKNESS_JOBS_ENABLED`; M6 can merge early with both off; decision D-P6-16 |

### 14.2 Decisions for the owner (each has a default the plan builds on)

| # | Question | Default | Impact if different |
|---|---|---|---|
| D-P6-1 | Default scope (rct-b Q24) | Rapid + blitz, the last 6 months, ≤ 300 games | Constants only |
| D-P6-2 | Full profile threshold (D8 vs the old plan's 10) | 20 analysed, preliminary from 5 | Constants; copy "14 / 20" |
| D-P6-3 | How many in-scope games to analyse for a profile | Up to **100** per member and **20** per trialist, always inside P4's eager cap (200 / 40); the first 20 at import-newest priority | CPU per member; ETA copy |
| D-P6-4 | May phase or opening gaps appear as top-3 rows? | No in v1; they appear in the headline clause and the tabs | `patterns.ts` candidate set + a ranking scale for accuracy gaps |
| D-P6-5 | The Chess.com → Lichess rating offset | 0 in v1, labelled "on Lichess"; revisit with data | One JSON value per time class |
| D-P6-6 | Do REPLAY bot games count? | No (forgeable, not human play); "play N more games here" counts friend, online and tournament games only | `scope.ts` filter; CTA copy |
| D-P6-7 | Time-pressure drills (rct-b Q16) | Untimed, own positions only, no matched puzzles | A later per-move timer |
| D-P6-8 | Time-pressure drill items: blunders only, or every error under 1 minute | Every bank item tagged `rc:timePressure` | The Q-W7 filter |
| D-P6-9 | Phone drill: config sheet (this plan) or direct start (the boards link straight to the session) | Sheet with defaults (10, mix): one extra tap | The phone handler only |
| D-P6-10 | Show strengths on the public profile (P10) | The own profile only | P10 |
| D-P6-11 | When a READY profile updates: a silent refresh with an "Updating…" chip and a toast only when the top pattern changes, or the full computing screen (architecture §2.3.3 wording) | Silent + chip + toast | UI only |
| D-P6-12 | The nav dot rule | First READY, or a new pattern in the top 3 | `version.ts` |
| D-P6-13 | Lapsed members read their profile (B26) | No (hard redirect), data kept | Route auth `member_or_lapsed_read` |
| D-P6-14 | Inaccuracies in weakness stats | Excluded (MISTAKE, BLUNDER and MISS only, research §14.1) | Codec judgement field + baseline rebuild |
| D-P6-15 | The baseline dump month and refresh cadence | One 2026 month; quarterly refresh with an `ALGO_VERSION` bump only when the formulas change | Runbook |
| D-P6-16 | Ship P6 before launch (allocation) or after it ("Launch A", feasibility §8) | As allocated: before launch | Nothing in P6 changes; only when the flag turns on in production |
| D-P6-17 | A Settings › Training scope editor (critique C-12) | Not built; defaults + the bullet offer | A P10 row with no board, using TR-12's existing body |
| D-P6-18 | The recompute debounce | 240 s (inside Neon's 5-minute suspend window) | `WEAKNESS_DEBOUNCE_SEC` |

### 14.3 Open questions for other phase owners

- **P1:** confirm that `devSchema()`, `isNonProd()`, the AP-20 `fallbackInterval` fix, the registry `sideEffects` field with the GET-purity check, `ctx.now`/`x-rc-now`, the leased persona pool, the telemetry sink and the state-coverage manifest ship in P1. Confirm a durable store for P5's `train-session` window (AP-11). Confirm the dev Neon project split (AP-01) before P6's backfills.
- **P2:** confirm the R-01 fix 2.1/2.3 columns (`games."whiteTitle"/"blackTitle"`, `games.source`, `game_players.source`) and `CT/socket/rooms.ts`. Confirm that `game_players."endedAt"` stays (CC R-01) rather than AP-07's rename to `playedAt`.
- **P3:**
  - the daily housekeeping window and the `WK/src/scheduler/recurring/` directory (or a single file);
  - whether `jobs."lastKickAt"` ships in M3 (P6 adds it `IF NOT EXISTS` otherwise);
  - `fairSeq` and `JOB_PRIORITY.WEAKNESS`;
  - that `game_analyses.lines` holds a PV for every MISTAKE, BLUNDER and MISS ply ("flagged plies"); otherwise the tagger falls back to `best[ply]`;
  - the internal-auth scheme in `CT/internal/auth.ts`;
  - an exported `ENGINE_PROFILE` constant in `CA/src/version.ts` for the baseline pin.
- **P4:** the I/O lane `kinds` edit and the `rerunIfFlagged` completion in `complete.ts`. Whether the trialist eager cap of 20 (F-OCI-3) is adopted; P6's trial cap of 40 assumes it.
- **P5:** the `tagErrorPly` wrapper in `CA/src/themes/index.ts`; the `rc:timePressure` key in `TRN/src/themes.ts` (never primary); the `mistake_occurrences.ply` convention (offset from `startPly`).
- **P8:** add `resolveLessonForPattern` to S13 and the WBS "Edits" list; accept `from=weakness`; add the three `learn-lights-up.spec.ts` cases (§7.6, critique C-07).
- **P10:** Settings › Training is not built (C-12). If P10 later moves the weakness scope into `UserSettings`, that is a contract step. `account-deletion.int.test.ts` should name `weakness_snapshots` explicitly (testing critique, P10 regression).
- **P11:** the SW-on regression set should include `weakness/computing-fallback-poll.spec.ts`.

### 14.4 Rollback (feasibility §9)

| Lever | Effect | Data |
|---|---|---|
| Flag `weakness` off | Pages redirect to `/train`; TR-5/12/13 and TR-7 `weakness` → 404; nav, hub, Home and badge slots disappear | Kept |
| `WEAKNESS_JOBS_ENABLED=false` on the worker | No recomputes; enqueues no-op; existing snapshots keep serving | Kept |
| Worker image rollback | An older image claims only the kinds it knows, so `RECOMPUTE_WEAKNESS` rows wait as QUEUED; the old `analyzeGame` leaves the new columns at their defaults | Kept |
| Web rollback | M6 is expand-only; older code ignores the new columns and table | Kept |
| Bad numbers in production | Fix the code, bump `ALGO_VERSION`, and run B-W3. Snapshots are always rebuildable from `game_players` inputs, so none is ever deleted to recover | Rebuilt |
| Bad inputs (codec bug) | Bump the input version in code (`weaknessInputsV` = 2); the worker heal and B-W1 recompute the rows. No engine work | Rebuilt |
| `rc:timePressure` tags | Additive and never primary. Removing them is an `array_remove` update, a data change that needs the owner's confirmation first | Kept |
| `/weakness` redirect | 307 on dev, so it can be undone; 308 only from P13 | — |

There is no down migration. Any drop in a P6 rollout stops and asks: "This command may reset/drop your database. Are you sure?"

---

## 15. Definition of done (allocation §1.1 + the testing addendum items 9–14, plus P6 specifics)

- [ ] M6 is migrated with `prisma migrate deploy` on the Neon **dev** branch after a rehearsal on a throwaway child; the drift gate is clean; `jobs_user_active_idx` is protected; the role scripts ran; `prisma migrate dev` and `prisma db push` were never run against a Neon branch.
- [ ] B-W1, B-W2 and B-W3 have run on dev; `count(*) WHERE accuracy IS NOT NULL AND "weaknessInputsV" = 0` = 0; every user with ≥ 5 analysed games has a snapshot row at `ALGO_VERSION`.
- [ ] `TRN/baselines/v1.json` is committed from a real 2026 dump with the engine pin; no dev snapshot uses `v0-synthetic` after the swap (`metrics.inputs.baseline = "v1"`).
- [ ] The worker on the OCI dev VM runs `RECOMPUTE_WEAKNESS` in the I/O lane; `WEAKNESS_JOBS_ENABLED` is set in `WORKER_DEV_ENV_FILE`; deployed through `.github/workflows/deploy-oci.yml`; no new timers (the timer audit passes and the Neon console shows scale-to-zero while idle).
- [ ] TR-5, TR-12 and TR-13 plus the TR-7 weakness branch are live on Vercel `replay-chess-dev`, registered in `CT`, GET-pure apart from `kick_cas`, and `docs/api/openapi.json` is regenerated with no drift.
- [ ] `weakness:progress` and `weakness:ready` are in the socket registry; they are emitted to `user:{ref}` on dev and patch the cache; the fallback poll is verified with WS blocked and stops after 15 min.
- [ ] All 8 boards are built. All 19 `data-props` values (`insufficient·computing·drill` on the 3 desktop boards; `default·loading` on the 5 profile boards) are reached from real data and tagged; `state-coverage` shows 0 missing. The failed and orphaned states are implemented.
- [ ] The device × zoom suite is green: the PR tier on every PR, all 40 projects nightly, including the `stress=1` fixtures and the real-route layer. The visual baselines are committed.
- [ ] Unit (incl. property tests and the grade-corpus test), contract, worker integration, e2e, chess-correctness and regression suites are green in CI on the final `dev` SHA with `BILLING_PAYWALL=on`; `check-test-globs` confirms every new test file ran; the golden design test reproduces the board numbers.
- [ ] Specs use leased personas only; no shared letter is mutated. The P6 test hooks are registered and `prod-guard` is green.
- [ ] Telemetry: every §10.1 event is in `AN/events/weakness.ts` and asserted through the sink in at least one spec (server events exactly once in the worker tests); the PII guard is green; the PostHog live view on dev was checked by hand.
- [ ] The performance targets are met: explain plans and the index existence check (§9.1), k6 (§9.5) with its result file, the worker bench < 2 s p95, route JS ≤ 90 KB with no zod, payload < 8 KB, 0 `/api/*` on first paint.
- [ ] Lights up: the hub weakness row, the plan footnote and focus; the Home top-theme line; the Train nav dot; the `g w` chord and ⌘K; `/how-we-grade#weakness`; the `/weakness` redirect (307 on dev). With the flag off, the hub and Home match P5 exactly (`flags-off` project).
- [ ] The flag `weakness` is on for the owner and the E2E users on dev. No dead links: the legend lesson slots are not rendered.
- [ ] The nightly dev recompute check has matched `member-design.v1.golden.json` at least once.
- [ ] Every defect found in the owner, manual or device passes has a regression test; `quarantine.json` has no expired entries.
- [ ] The owner test script (§1.2, T1–T13) passes on the dev URL with ego-browser, and on a real iPhone and a real Android phone. `docs/qa/phase-06-signoff.md` is committed with the SHA, screenshots, devices, the coverage table, the error-window output (0 new issues for ≥ 24 h, or each triaged), the k6 files and the CU-h before and after.
- [ ] The runbooks `weakness-baseline.md` and `weakness.md` are written. `docs/implementation-plan.md` §6 points to this spec. The copy notes C1–C10 are resolved with the owner.

---

## Appendix A. Critique dispositions

Every finding in the five critiques that concerns P6, with what this spec did about it. **Accepted** means the change is in the section named. **Rejected** gives a one-line reason. Source keys: AP = `critique-api-perf.md`, CC = `critique-consistency.md`, CV = `critique-coverage.md`, FE = `critique-feasibility.md`, TE = `critique-testing.md`.

### A.1 `critique-api-perf.md`

| Finding | Disposition | Where |
|---|---|---|
| §4.11 #1 / AP-07: `review_cards`/`review_logs` → `training_cards`/`training_attempts`, and the index names | Accepted | §0, §6.5, §7.1.4, §7.4.6, §9.1 |
| §4.11 #2 / AP-08 item 3: the weekly roll is not an `HOURLY_TICK` slice | Accepted: it is a slice of the daily housekeeping wake | §7.4.6, §9.6 |
| §4.11 #3 / AP-08 item 4: the ME-2 fallback every 5 min keeps Neon awake | Accepted: on focus and at most every 10 min | §5.1 |
| AP-07 / §1 register: the per-user game index column should be `playedAt` | **Rejected:** P2 already ships `game_players."endedAt"` and its index, and CC R-01 rules that the first shipping phase wins; renaming would edit P2–P13 for no runtime gain (R12 tracks the risk) | §0, §14.1 R12 |
| AP-07 / §1 register: job priorities, higher runs first, named constants | Accepted, using CC R-05's `JOB_PRIORITY` in `DB/src/jobs.ts` (P3 owns that file) rather than `PRIORITY` in `packages/contracts/internal/jobs.ts` | §0, §7.4.1, §7.4.3 |
| §1 register: rate limiter is P1's fixed window, not a token bucket | Accepted | §0, §7.1.2, §7.1.3, §7.2 |
| §1 register: worker wake is `/internal/analysis/kick` | Accepted | §0, §7.1, §7.5 |
| §1 register: rooms and events follow P2 (`user:{ref}`) | Accepted | §0, §7.3 |
| AP-09: GETs must not enqueue; re-kicks through a compare-and-set | Accepted: TR-5 declares only `kick_cas`; the heal moved to a page POST and the daily sweep | §5.4, §7.1.1, §7.4.6, §12.2 |
| AP-10: invalidation storm during an import backlog | Accepted: weakness events never refetch Home or the hub, and coverage analyses run below priority 80 | §5.1, §5.5, §7.3 |
| AP-11: `weakness-recompute` (600 s) cannot live in the UNLOGGED table | Accepted: the limit is read from the user's job row (option b), with a test that truncates the burst table | §7.1.2, §7.4.1, §9.5, §12.2 |
| AP-12: zod schemas in the production client bundle | Accepted: `devSchema()` and a `ZodError` bundle check | §5.3, §9.3 |
| AP-14: no response headers from RSC pages | Accepted (the page sets none; the ETag is only on TR-5) | §5.2 |
| AP-15: SLOs must not depend on consent-gated PostHog | Accepted: every SLO has a server or lab source | §9.4, §10.1 |
| AP-20: an inline `fallbackInterval` never stops | Accepted: hoisted to module scope, with a fake-timer test | §5.3, §12.1 |
| AP-21: one `api()` with transparent 304 | Already consistent (the draft relied on it); no change | §5.3 |
| AP-04 / AP-22: per-user data never gets `max-age > 0`; `private, no-cache` | Already consistent; restated, and the registry lint is in the contract tests | §9.2, §12.2 |
| AP-25: the reconnect resync burst | Accepted: P6 registers its key; P1 owns the gap rule | §5.5 |
| AP-35: budgets need a metric, a source and a formula | Accepted (e.g. `first_ready_lag_s` is defined) | §9.4 |
| AP-01: dev shares production's Neon CU-h | Accepted for P6's part: backfills and k6 wait for the project split or the owner's OK, and CU-h are recorded | §6.6 step 7, §9.5 |
| AP-44: HMAC internal auth from P3 | Not adopted in P6: CC R-08 rules `x-internal-token` and FE §6 rules HMAC. P2/P3 own the helper, and P6 calls only `CT/internal/auth.ts` | §0, §7.5 |
| §5 gates: index existence, GET purity, timer audit, cache-tier lint | Accepted | §6.5, §7.2, §7.4.7, §9.1, §12.2, §12.3 |

### A.2 `critique-consistency.md`

| Finding | Disposition | Where |
|---|---|---|
| 6.1: `ReviewCard`/`ReviewLog` names | Accepted | §0, §6.5 |
| 6.2: room `u:{userRef}` → `user:{ref}` | Accepted | §0, §7.3 |
| 6.3: `stats` and `errorThemes` are never created | Accepted: added to M6, and P6 also owns the STATS_V1 codec and `computeSideInputs` | §2.1, §6.1, §6.2, §6.4, §8.3 |
| 6.4: shorthands `TR`/`CT`, and `JOB_PRIORITY` from `PKG/db/src/jobs.ts` | Accepted with one change: `TRN` instead of `TR`, because `TR-5`/`TR-12` are endpoint ids in this spec (FE §6 also uses `TRN`) | path table, §0 |
| 6.5: "P3 must confirm" the priority scale | Accepted: the old R12 is removed; P3-D7 decided it | §0 |
| 6.6: `idempotency_key_reused` is 422, not 409 | Accepted | §5.4, §5.6, §7.1.4, §12.2 |
| 6.7: `validation_failed` is 400, not 422 | Accepted | §5.4, §5.6, §7.1.4, §8.11, §12.2 |
| 6.8: `membership_ended` → 402 `subscription_required {reason}` | Accepted | §5.6, §7.1.1, §11 |
| 6.9: cite P3's `HOURLY_TICK` once P3 fix 3.6 lands | **Rejected:** P6 no longer uses `HOURLY_TICK`; AP-08 and FE F-NEON-2 replace it with the daily window, so there is nothing to cite | §7.4.6 |
| 6.10: `User.timezone` → `User.timeZone` | Accepted | §0, §7.4.2, §8.2 |
| 6.11: `STOCKFISH_PATH` → `ENGINE_PATH` | Accepted | §7.7 |
| 6.12: `train_session_*` re-declared | Accepted: marked "P5 events, reused" | §10.1 |
| §0 #1 / R-01: SQL names (`endedAt`, `ratingBefore`, `completedAt`, `source`, the titles) | Accepted | §0, §6.5, §7.4.2, §8.2, §8.4 |
| §0 #5 / R-05: `fairSeq`, `JOB_PRIORITY`, `/internal/analysis/kick` | Accepted (coverage sets `fairSeq`); its `HOURLY_TICK` part is rejected as in 6.9 | §7.4.3, §7.5 |
| R-07: one `/internal/emit` body | Already consistent; restated | §0, §7.5 |
| R-08: internal auth `x-internal-token` | Not adopted in P6 (scheme-neutral; see AP-44) | §7.5 |
| R-10: contracts paths include `src/` | Accepted (`CT` = `PKG/contracts/src`) | path table |
| R-13: limits as `limit / windowSec` | Accepted | §7.1.2–§7.1.4, §7.2 |
| R-18: telemetry re-declarations | Accepted | §10.1 |
| R-20: no `db push` on Neon; name the dev branch through CLAUDE.md | Accepted | §6.6 |

### A.3 `critique-coverage.md`

| Finding | Disposition | Where |
|---|---|---|
| C-07 (High): the legend-lesson links never light up, because P8 does not pick up `resolveLessonForPattern` | Accepted for P6's side: all three slots are built with fixtures and tests, and the exact P8 work and acceptance cases are written down. The edit to `phase-08.md` itself is outside this file and is listed as an open hand-off | §2.2, §4.6, §4.7, §7.6, §8.15, §14.3, R13 |
| C-12 (Medium): Settings › Training scope editor is handed to P10, which has no such section | Accepted: not built; defaults and the bullet offer only; TR-12 already accepts the fields if the owner later wants a row | §2.2, D-P6-17 |
| Coverage check: 8 boards, 19 enum values, 0 missing | No gap found. The DoD now lists the 19 values and requires machine coverage | §4.1, §15 |

### A.4 `critique-feasibility.md`

| Finding | Disposition | Where |
|---|---|---|
| 10.12.1: shorthand `CT` → `TRN`, `CO` → `CT` | Accepted | path table |
| 10.12.2 / #4 / F-NEON-2: the weekly roll is a daily-planner slice, not `HOURLY_TICK` | Accepted | §7.4.6 |
| 10.12.3 / F-OCI-3: the 100 in-scope games are a subset of P4's eager 200; trialists get 20 | Accepted: the targets are 100 member / 20 trial, inside eager caps of 200 / 40 | §7.4.3, D-P6-3 |
| 10.12.4: pin the worker's Stockfish build, net hash and profile in the baseline | Accepted: `sf18-v1` pass-1 settings, sha256 checks, `meta.profile` test, and a worker-side refusal | §7.4.5, §7.4.2 step 5 |
| 10.12.5: add a rollback line | Accepted: a full rollback table | §14.4 |
| #3: `VERCEL_ENV !== "production"` gates never open on `replay-chess-dev` | Accepted: the P6 hooks and the perf bypass gate on `APP_ENV` (`isNonProd()`) | §4.1, §7.10, §9.5 |
| #8: keep test traffic off the deployed dev site's Hobby quotas | Accepted: the device matrix runs against `next start` in CI; only the smoke and nightly checks touch the dev URL | §12.4 |
| #15 / §8: the calendar is optimistic; "Launch A" defers P6 | Accepted as a 20 % buffer line and owner decision D-P6-16; P6 alone cannot decide the cut | header, §13, §14.1 R14 |
| §6: worker wake `/internal/analysis/kick {kinds[], runAt?}` | Accepted | §7.5 |
| §6: internal auth is HMAC from P2 | Not adopted in P6 (scheme-neutral; CC R-08 disagrees) | §7.5 |
| §6: engine profile follows P3-D9 | Accepted | §7.4.5 |
| §7: shared registries become directories | Accepted (P6 adds files where P1 adopted directories) | §3.2, §13 |
| F-OCI-4: database pools must survive Neon suspends | Already satisfied: the worker uses the HTTP driver, and P6 adds no pool | §7.4.2 |
| F-NEON-1: dev shares production's project | Accepted for P6's part (see AP-01) | §6.6 step 7 |
| §1: the Hobby Speed Insights quota | Accepted: field CWV on dev is indicative; the lab budgets gate | §9.4 |
| §9 (P8 row): browsers cache 308s for good | Accepted for `/weakness`: 307 on dev, 308 only in production | §3.1, §4.1, §14.4 |

### A.5 `critique-testing.md`

| Finding | Disposition | Where |
|---|---|---|
| P6 hook guard (X12): `APP_ENV=dev` hooks 404 in CI | Accepted: `isNonProd()` + `x-e2e-token`, registered, `prod-guard`; the fixture route is dropped in favour of persona writers | §7.10, §12.4 |
| P6 persona collisions (X4): users C and D clash with P5 | Accepted: leased personas `weak-*`, `weakfail`, `bullet`, `noclock` | §6.8, §12.4 |
| Unit additions: `aggregate.property.test.ts` (4 properties) and `errorlog.positions.test.ts` | Accepted (a seeded generator, no new dependency) | §12.1 |
| Telemetry assertions `weakness_viewed{status, patterns:3}`, `weakness_row_opened{slug}`, `weakness_drill_started{…}`, server `weakness_ready{bumped}` once | Accepted in intent, with the registry's names: `patterns` was added to `weakness_viewed`; `weakness_row_expanded{pattern}` keeps its name; the server event `weakness_snapshot_computed{bumped}` is asserted once in the worker tests, because CI e2e runs no worker | §10.1, §12.3, §12.4 |
| A11y: the Clock `aria-label` is the full sentence; keep axe | Accepted | §4.6, §12.4 |
| Nightly dev recompute of `weak-member` against the golden | Accepted, with a v1-baseline golden so the comparison is like for like | §12.1, §12.4 |
| DoD additions (hooks, personas, property tests, telemetry, nightly) | Accepted | §15 |
| X1: one runner and layout; `*.int.test.ts`; `check-test-globs` | Accepted | §12 |
| X2: e2e in CI on `dev`; the nightly job for P6 | Accepted | §12, §12.4 |
| X3: paywall on in e2e | Accepted | §12.4 `paywall.spec.ts`, §15 |
| X5: server-time control (`x-rc-now`) | Accepted: the stalled, cooldown and window tests use it; services take `now` | §7, §12.4 |
| X6: telemetry registry, sink and PII guard | Accepted | §10.1, §12.4 |
| X7: console and hydration guard | Accepted (auto-use fixture) | §12.4 |
| X8: design-state manifest and tags | Accepted | §4.1, §15 |
| X9: tiered device matrix, stress data, real routes | Accepted | §4.3, §12.4 |
| X10: visual regression tooling | Accepted (P1 tooling; P6 baselines) | §12.4 |
| X11: regression is the whole suite, plus a `flags-off` project | Accepted | §12.4, §12.6 |
| X13: one shared grade corpus | Accepted | §12.1, §12.5 |
| X14: every defect gets a regression test; quarantine | Accepted | §12.6, §15 |
| X15: a sign-off record, a ≥ 24 h test window, tab hygiene | Accepted | §12.7, §15 |
| X16: CI on Docker Postgres, never Neon | Accepted | §12 |
| X18: performance results as data | Accepted | §9.5 |
| P10 regression: the deletion test should name the weakness snapshots | Outside this file: recorded as an open question to P10 | §14.3 |
| P11 regression: the SW-on set should include the weakness fallback poll | Outside this file: recorded as an open question to P11 | §14.3 |

### A.6 Found while revising (no critique raised them)

| Change | Why | Where |
|---|---|---|
| The weakness scope is stored on `training_profiles`, not in `user_settings.prefs` | `UserSettings` arrives only in P9 (B14), after P6 in stream A; P5 already keeps training prefs on `TrainingProfile` | §6.1, §7.1.2 |
| Debounce 240 s instead of 600 s | The post-burst recompute then lands before Neon's 5-minute suspend | §7.4.1, §9.6 |
| Aborted games are excluded from scope | P2 writes `result = ABORTED`; those games have no meaningful moves | §8.2, Q-W3, Q-W5 |
| Grants go in the role scripts, not the migration | P3 §6.3: shadow and CI databases have no app roles | §6.2.3 |
| The enqueue resets the priority after DONE, and merges the payload | The draft kept `GREATEST` forever, so one user-triggered run pinned every later recompute at the top priority; replacing the payload would also have dropped `userAt` | §7.4.1 |
| Paths follow P4/P5's actual files (`WK/src/jobs/import-sync.ts`, `WK/src/extract/extractMistakes.ts`, `WEB/lib/train/*.server.ts`, `WEB/lib/home/home.server.ts`, `WEB/lib/realtime/handlers/*`, `TRN/src/themes.ts`, `TRN/src/session.ts`) | The draft used names no phase creates | §3.2, §13 |
| `RECOMPUTE_WEAKNESS` runs in P4's I/O lane, and the rerun uses a completion option in P4's `complete.ts` | P4 built the lane and the completion helper | §7.4, §13 WP4 |
| The TR-5 probe joins `games` for the opponent title | The "14 / 20" count then matches what the worker counts | §6.5 Q-W3 |
| Unrated REPLAY rows are skipped for the band | Before P9, their `ratingBefore` is the Chess.com-derived display rating | §8.4 |
