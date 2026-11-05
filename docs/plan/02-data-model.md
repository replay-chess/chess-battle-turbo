# Replay Chess: target data model

Status: **final plan, revision 2**, 2026-11-02. Branch `dev` at `0848b76`. Scope: the complete Prisma schema delta from today's `apps/web/prisma/schema.prisma` (434 lines, 10 models, 6 enums, 17 migrations) to the coaching product in the 13-phase plan (P1–P13; `SP/plan/allocation.md`) and the v3 designs. It covers models, columns, enums, relations, `onDelete` rules, unique constraints and indexes (each with the query it serves), normalisation decisions, storage growth against the Neon plans, the migration and backfill procedure, the old-prod → new-prod copy, and the dev seed.

**What revision 2 changed** (every finding about this file in the five critiques; dispositions in Appendix B):

1. **One schema ledger per migration id, in the allocation's numbering** (§5.0): M1 (P1) … M13 (P13), with the column-to-migration assignments of consistency R-01. Revision 1 used a 10-phase numbering ("M8" = tournaments, "M9" = identity); the crosswalk is in §5.0.3.
2. **Names follow what P2 shipped and the canonical table in `01-architecture.md` §0.3**: `games."whitePlayerId"`, `"endMethod" GameEndMethod`, `outcome GameWinner`, `fen`, `"rematchOfId"`, `"completedAt"`; `GamePlayer` PK `(gameId, userId)` + unique `(gameId, color)`; `game_players."endedAt"` and `game_players_userId_endedAt_gameId_idx`; `TrainingCard`/`TrainingAttempt`; `User.timeZone` (M4); `AuditLog` in M4; no `KeyMoment` table; one `Report` table.
3. **Live games are written by the socket server directly** (allocation B4, P2), with one exception: tournament pairing, start and finalize go through web internal routes (P12 D12-4). Revision 1's D22 (internal routes for every socket write) is withdrawn (§3.22, §7.1).
4. **The analysis write is one Neon HTTP batch of set-based, natural-key statements** (or the `rc_apply_analysis(jsonb)` function), never an 11-round-trip interactive transaction (§7.2).
5. **PGN is stored once for games played here** (P2 B3); imports rebuild it from `moves` (§3.1).
6. **UNLOGGED tables hold only state that is safe to lose** (burst rate-limit windows ≤ 60 s). Long windows and daily budgets are durable (§3.15).
7. **New columns:** `users."gamesVersion"` (ETag for the archive), `users."subscriptionSourceAt"` (billing compare-and-set, in P1), `jobs."fairSeq"` and `jobs."lastKickAt"` (M3), `game_analyses."readyMs"` (SLO audit).
8. **Rollback-safe enums** (values written one release after they ship; `text` + zod as the option for fast-growing sets), and dev in its own Neon project from P1 (§11.1, §13.1).

**Artifacts produced with revision 1** (in `SP/plan/`): `schema.target.prisma` (validated with Prisma 6.17.1), `schema.target.diff.sql`, `schema.target.raw.sql`, and the size measurements under `SP/sizes/`. **They predate the revision-2 renames** and must be regenerated from the ledger in §5.0 before anyone relies on them (consistency §3); the phase specs' §6 blocks are authoritative for each migration's exact Prisma text.

**Reading guide.** §0 summary. §1 one name per concept. §3 normalisation decisions. §5.0 the canonical ledger, then revision 1's detailed blocks (renamed). §6–§9 reference tables. §10–§13 storage, migrations, the production copy and the seed. Appendix B: critique dispositions.

Paths are relative to the repo root (`/Users/rohitpandit/open_source/chess-battle-turbo`). `schema:N` means `apps/web/prisma/schema.prisma` line N (moved to `packages/db/prisma/schema.prisma` by P2). Shorthands as in `01-architecture.md` (`WEB`, `WS`, `WK`, `PKG`, `CT`, `DB`, `TRN`, `CA`, `SP`, `DR`). Phase specs: `docs/plan/phase-NN-*.md` (final) or `SP/plan/phase-NN.md`.

---

## 0. Summary

### 0.1 Shape of the change

- **About 40 new tables, 7 changed, 3 removed later** (`matchmaking_queue`, `user_stats`, `chess_com_profiles`, by contract steps C2 and C4).
- **Every change is additive** until the contract steps, which each need the owner's confirmation (CLAUDE.md rule 5).
- **Every Neon branch changes through migration files and `prisma migrate deploy` only.** The plan needs hand-written SQL (partial indexes, `NOT VALID` foreign keys, `UNLOGGED`, storage parameters), and `prisma db push` would drop it. CLAUDE.md rule 1 still says `db push` for shared databases: rewording it is owner decision O1 (= `01-architecture.md` D5).
- **Measured storage:** about **4.4 MB per typical member per year** (re-measure with real PGN text, §10.1) and 14.7 MB for a heavy member. On the 1 GB Free plan that is roughly 100–150 members in year one; production moves to Neon Launch before charging (P13 D17), and compute hours run out long before storage.

### 0.2 Decisions

| # | Decision | Replaces | Evidence |
|---|---|---|---|
| D1 **(r2)** | Moves are stored as `Game.moves` (space-separated UCI), `moveClocksMs int[]` and a `plyCount` guard. No per-ply rows. **`pgn` (with `%clk`) is written once at game end for games played here** (B3); imported games rebuild PGN from `moves` and the header columns | `gameData.moveHistory` (265 B per ply, rewritten on every move); `GameMove` rows; `movesUci String[]`; revision 1's "PGN is not stored" | An 80-ply game row is 1,176 B without PGN; PGN with clocks adds ≈ 1.5–2.5 KB raw before TOAST compression [V9] (feasibility F-NEON-4) |
| D2 **(r2)** | `GamePlayer` is one row per **member** side, PK **`(gameId, userId)`** + unique `(gameId, color)`; per-member end time `endedAt`; opponent snapshot columns (`opponentUserId`, `opponentName`, `opponentRating`) and the game display snapshot (`whiteName…blackTitle`) on `Game` | `PlayerGame`, `UserGame`, `UserStats`, creator/opponent OR queries; revision 1's PK `(gameId, color)` and `playedAt` | allocation B1, P2 §6.2 |
| D3 | Analysis is packed per game in `GameAnalysis` (`smallint[]` evals, best moves, judgements) | Per-ply `MoveEval`, JSON columnar `plies` | 1,206 B vs 23,773 B per 80-ply game (§10.1) |
| D4 **(r2)** | `PlayerReview` (PK `(gameId, color)`) holds the coach text and **the key moments (`content.moments[]`, ≤ 3)** for one member side; bank items are `Mistake` rows linked through `MistakeOccurrence (gameId, ply)`; the per-review bank opt-out is `progress.bankOptOut` | `KeyMoment` rows (allocation B6 wording, P5 rev 1) | One read for the Review screen; P3-D3 |
| D5 **(r2)** | One `Job` table is the worker queue: SKIP LOCKED claim, push wake-up (`/internal/analysis/kick`), `fairSeq`, `lastKickAt`, `JOB_PRIORITY` (higher first), future-dated recurring rows (no hourly tick) | `AnalysisJob`, a notification queue, revision 1's 30-minute safety sweep | `01-architecture.md` CR-8–CR-12 |
| D6 **(r2)** | `LinkedAccount` plus `ImportCursor` (+ `ImportRun` for user-visible runs, P4). **Recommended: no stored Lichess token** (use it for the initial import, then revoke; feasibility F-API-3); if P4 keeps it, `accessTokenEnc` is sealed with the worker's public key under `LINK_TOKEN_KEYS` | `ChessComProfile` (unverified `@unique` handle) | inv-acct Q18; feasibility SEC-6 |
| D7 | `Mistake` deduplicated per (user, position) with `MistakeOccurrence`; template texts computed at read time; only LLM-verified texts stored | One Mistake per game ply with stored texts | 512 B per row with no stored text |
| D8 **(r2)** | FSRS state lives in **`TrainingCard` (`training_cards`)** (decks BANK, PUZZLE, OPENING; API ref = `itemKey`) and the append-only **`TrainingAttempt` (`training_attempts`)** | revision 1's `TrainingCard` / `TrainingAttempt` | allocation B11; P5 created them |
| D9 | The Lichess CC0 puzzles live in versioned R2 shards. Neon stores only cards and attempts | A 1M-row `LichessPuzzle` table | 0 B in Neon instead of about 350 MB |
| D10 | Weakness inputs are packed per-game aggregates on `GamePlayer` (`stats`, `"errorThemes"`, `errorLog`, `errorThemeN`, `weaknessInputsV`; **created in M6 by P6**), rolled into a weekly `WeaknessSnapshot` | `MoveEval` scans | One indexed scan of ≤ 300 rows per user |
| D11 | Coach: a thread per subject; a partial unique index allows one streaming answer per user; the `(userId, clientId)` unique key makes a retry idempotent; usage in daily rows (`coach_usage_days`, `coach_spend_days`); burst limits in the burst store; messages kept 180 days | The in-memory limiter (`apps/web/lib/rate-limit.ts:13-38`) | P7 |
| D12 | `Lesson` plus `LessonStep` rows | JSON `plies` / `checkpoints` | Steps validated and edited per ply |
| D13 **(r2)** | `UserSettings.prefs` JSON (+ `consent`, `pushOptIns`) plus derived columns for jobs (P9 creates, P10 extends); **`User.timeZone` (M4, P4)**; `TrainingProfile` for counters | `UserPreference`, `DailyPlan`, `UserStreak`; `User.timeZone` | consistency R-02, R-03 |
| D14 | `Notification` is both the inbox item and the per-channel delivery state | Separate outbox and inbox tables | |
| D15 **(r2)** | `AuditLog` (**M4**), `WebhookEvent`, `IdempotencyKey`, an `UNLOGGED` `RateLimitBucket` **for windows ≤ 60 s only**, a logged `RateLimitWindow` for longer windows (or counts over source rows), and `TrialLedger` (hashed with `HASH_PEPPER`) | `AdminActivity`, `BillingEvent`, `Game.clientKey` | api-perf AP-11, feasibility F-NEON-3, consistency R-04 |
| D16 **(r2)** | `PlayerRating` (Glicko-2 per pool, P9). The rating before and after each game lives on `GamePlayer` (`ratingBefore`, `ratingAfter`, `ratingDelta`), append-only, so ratings can be recomputed | `RatingEvent` | One table and one index fewer |
| D17 | One `Share` table (kind POSITION or REVIEW, P3) with no view counters | `SharedPosition`, `ShareLink`, `GameShare` | A per-view `UPDATE` would wake Neon on every crawler hit |
| D18 | The engine eval cache lives on the worker's local disk (SQLite) | `PositionEval` in Postgres | Free, no egress, no Neon storage |
| D19 | Account deletion is a hard delete of private rows plus anonymisation of shared rows, with an external clean-up outbox and the trial ledger | `ON DELETE CASCADE` into the opponent's games (`schema:90-91`) | Opponents keep their history and their Mistake Bank |
| D20 | The `explanation` JSON for positions and openings moves to R2 (`explanationUrl`, `hasExplanation`) | Full-row reads of `explanation` | Database egress for explanations drops to 0 |
| D21 | Tournaments have no pairing table. Points per game live in `GamePlayer.tournamentPoints` (M12); the invite code is a column | `TournamentPairing`, `TournamentInvite`, `PositionCollection` | |
| D22 **(r2)** | Writers: the **socket server writes Neon directly** through `DB/src/live/*` (checkpoints ≤ 10 per game, one finish CTE); the worker writes directly in one HTTP batch per job; **tournament pairing, start and finalize go through web internal routes** (P12 D12-4) | Revision 1: every socket write through internal web routes | allocation B4, consistency R-11 |
| D23 | Migrations: `migrate deploy` on every Neon branch; partial indexes in SQL, guarded by `DB/prisma/protected-indexes.txt` and `scripts/db/check-drift.ts` (P2) | `db push` on prod (CLAUDE.md rule 1) | Prisma 6.17.1 rejects a `partialIndexes` preview flag |
| D24 **(new)** | Version columns for cheap ETags: `users."gamesVersion"` (archive), plus the existing `statsVersion`/`bankVersion` pattern | an ETag computed by scanning the archive | api-perf AP-19 |
| D25 **(new)** | Billing snapshots are applied with a compare-and-set on `users."subscriptionSourceAt"` (provider event time) and `IS DISTINCT FROM` (**P1 F4b**) | read → decide → write | audit-db DB-06/DB-07, api-perf AP-06 |

---

## 1. Proposals reconciled

The audits and inventories propose overlapping tables under different names. This is the single naming every plan uses (it matches `01-architecture.md` §0.3; where revision 1 chose differently, the row says so).

| Concept | Proposed as (where) | Chosen | Why |
|---|---|---|---|
| Per-user game index | `GamePlayer` (audit-db §11.2; inv-play-a §3.2), `PlayerGame` (inv-acct), `UserGame` (inv-play-b; inv-sys) | **`GamePlayer`** (`game_players`), PK **`(gameId, userId)`**, unique `(gameId, color)`, member sides only; index `game_players_userId_endedAt_gameId_idx (userId, endedAt DESC, gameId DESC)` | B1, P2. The game display snapshot (`whiteName`, `blackRating`, …) lives on `Game`; the per-member opponent snapshot (`opponentUserId`, `opponentName`, `opponentRating`) lives on `GamePlayer`. One user has ≤ 2,000 rows, which a filter scans in about 1 ms |
| Chess.com / Lichess link | `ExternalAccount` (audit-db), `LinkedAccount` (inv-acct, inv-pub) | **`LinkedAccount`** + **`ImportCursor`** + `ImportRun` (P4) | The UI calls them linked accounts; the cursor grows with account age |
| Import runs | `ImportRun` (inv-pub), `ImportJob` (inv-acct), `Job IMPORT_ACCOUNT` (audit-db) | **`ImportRun`** (user-visible state) + **`Job IMPORT_SYNC`** (the work) | P4 B5/D4-03; "waiting for membership" is `LinkedAccount.importState = WAITING_FOR_MEMBERSHIP` |
| Analysis queue | `AnalysisJob` (plan; inv-rct-a), `Job` (audit-db) | **`Job`** (kind `ANALYZE_GAME`, `dedupeKey = analyze:<gameId>`) | One SKIP LOCKED drain for every job kind |
| Per-move analysis | `MoveEval`, packed arrays, columnar JSON | **Packed `smallint[]`** in `GameAnalysis` | Measured (§10.1) |
| Review text and moments | `PlayerReview` + `KeyMoment` (inv-rct-a, allocation B6) | **`PlayerReview.content.moments[]`**; bank link through `MistakeOccurrence (gameId, ply)`; opt-out in `progress.bankOptOut` | Read and written as one document; ≤ 3 moments; P3-D3 |
| FSRS | `TrainingCard`/`TrainingAttempt` (plan; audit-db; research; revision 1), `TrainingCard`/`TrainingAttempt` (inv-rct-b) | **`TrainingCard`** / **`TrainingAttempt`** (`training_cards`/`training_attempts`) | Allocation B11; P5 created them (revision 1's choice reversed) |
| Day, streak, plan | `TrainingDay`, `DailyPlan` + `UserStreak`, `TrainingProfile` | **`TrainingDay`** (with `plan`) + **`TrainingProfile`** | B12 |
| Preferences | `UserSettings`, `UserPreference`, `User.preferences`, `TrainingProfile` prefs | **`UserSettings`** (`prefs` zod `PreferencesV1`, `prefsVersion`, derived minute columns, `emailOptIns`, `consent`, `pushOptIns`) + **`User.timeZone`** | B14; P9 creates, P10 adds `pushOptIns`; `timeZone` in M4 (R-03) |
| Notifications | Outbox `Notification` (inv-acct), inbox `Notification` (inv-sys) | **One `Notification`** with `pushStatus`, `emailStatus`, `readAt` | Producers idempotent through `dedupeKey` |
| Webhook dedupe | `WebhookEvent`, `BillingEvent` | **`WebhookEvent(provider, eventId)`** | B15 |
| Trial ledger | `TrialLedger` (inv-acct, inv-pub) | **`TrialLedger(emailHash PK, handleHashes[])`**, hashed with **`HASH_PEPPER`** by every writer and reader | One pepper, or a deleted member gets a second trial (consistency R-09) |
| Rate limits | token bucket, count/resetAt, UNLOGGED windows | **`RateLimitBucket(key, count, resetAt)` UNLOGGED, windows ≤ 60 s only**; **`RateLimitWindow(key, count, resetAt)` LOGGED** for longer windows, or counts over the route's source rows | Neon empties unlogged tables at every scale-to-zero, which resets hour- and day-long windows (api-perf AP-11) |
| Reports | `UserReport` (inv-acct, P10 rev 1), `TrainingReport` (inv-rct-b) | **`Report`** (`reports`, P5) with `targetType`; P10 adds the `user`/`game` targets to P5's handler | One admin queue, one `User.reportsMade` relation (R-02) |
| Admin activity | `AdminActivity` (inv-acct) | **`AuditLog`** (`audit_logs`, **M4**) | P4 is the first writer (R-04) |
| Public links | `SharedPosition`, `ShareLink`, `GameShare` | **`Share`** (kind `POSITION` → `/s/<code>`, `REVIEW` → `/r/<code>`), M3 | One resolver, one code space |
| Ratings | `PlayerRating` + `RatingEvent` | **`PlayerRating`** (P9); per-game `ratingBefore`/`ratingAfter`/`ratingDelta` on `GamePlayer` | The rating chart reads `game_players` by `(userId, endedAt)` |
| Tournament pairing and invites | `TournamentPairing`, `TournamentInvite` | **`GamePlayer.tournamentPoints` / `tournamentFire`**, `Game.tournamentPositionOrder` (M12), **`Tournament.inviteCode`** | A pairing *is* a game |
| Legend practice set | `PositionCollection`, `practiceOrder` | **`ChessPosition.practiceOrder` / `availableFrom`** (P8) | There is one collection |
| Contact messages | — | **`SupportRequest`** (`support_requests`, P11 D9) | new in revision 2 |
| Coach usage | `CoachUsage` | **`CoachUsageDay`** + **`CoachSpendDay`** (P7) | |
| Eval cache | `PositionEval`, `EvalCache` | **Worker-local SQLite** | §3.18 |
| Lichess puzzles | 1M-row table, 150–250k rows, R2 shards | **R2 shards** | §3.9 |
| Lessons | JSON `plies` / `checkpoints` / `narration` | **`Lesson` + `LessonStep`** | §3.12 |
| Live moves | `moves` text, `GameMove` rows, `movesUci String[]` | **`moves` text + `moveClocksMs int[]`** (+ `pgn` once at the end) | §3.1 |
| Socket persistence | direct writes (inv-play-a; audit-api §7.3), internal web API (audit-db §5.3; revision 1) | **Direct writes** through `DB/src/live/*` (B4); tournament pairing/start/finalize through web internal routes | §3.22 |
| Applying schema changes | `db push` on prod (CLAUDE.md rule 1), `migrate deploy` | **`migrate deploy`** on every Neon branch; no `db push` on Neon | §11.1, owner decision O1 |

---

## 2. Conventions

1. **Names.** Models are PascalCase; tables are snake_case through `@@map`; columns stay camelCase, as in every existing migration (for example `"trialStartedAt"` in `apps/web/prisma/migrations/20261101000000_add_free_trial/migration.sql`). Raw SQL quotes them.
2. **Keys.** `BigInt @id @default(autoincrement())`. A `referenceId String @unique @default(cuid())` exists **only** on rows addressed in URLs or APIs: users, games, mistakes, sessions, coach threads and messages, lessons, reports, tournaments and their participants, positions, legends and openings.
   - High-volume child rows use composite keys and **no cuid**: `game_players`, `player_reviews`, `mistake_occurrences`, `training_days`, `theme_mastery`, `coach_usage_days`, `weakness_snapshots`, `lesson_steps`, `lesson_progress`. A cuid costs about 26 B of heap plus a 40 B unique-index entry per row.
   - The API never exposes a BigInt. Composite rows are addressed through their parent's ref (for example the game ref plus the viewer). A review card's API ref is its `itemKey`: `m_<sqid(mistakeId)>`, `p_<puzzleId>` or `o_<sqid(openingId)>`.
3. **Time.** Timestamps are `timestamp(3)` in UTC. Every new table has `createdAt`; `updatedAt` appears only where rows are mutated. Local-day tables (`training_days`, `coach_usage_days`, `weakness_snapshots`, `training_sessions.day`) use `@db.Date`, computed in `User.timeZone` with the training day rollover hour from `prefs.training.dayStartHour` (default 04:00).
4. **Enums.** New closed sets use Postgres enums. Billing strings stay strings because they mirror Dodo. A new enum value goes in **its own migration** (`ALTER TYPE … ADD VALUE IF NOT EXISTS`), and is not written until every deployed Prisma client knows it. An old client throws on an unknown enum value when it reads one.
5. **Code tables are not enums.** `JudgementCode`, `MoveCode` and `STATS_V1` are append-only `smallint` code tables in `packages/chess-analysis/codec.ts`, never derived from the order of a Postgres enum.
6. **JSON.** Every `Json` column has a zod schema with a `v` field in `packages/db/json/*.ts` (registry in §9).
   - JSON is for documents that are read whole.
   - Nothing filtered, sorted or aggregated in SQL goes in JSON.
   - Numeric arrays never go in `jsonb`: measured, a 30-number stats object was 998 B as jsonb against about 84 B as `smallint[]` (§10.1).
7. **Text limits.** Every user-visible string has a `@db.VarChar(n)` limit, mirrored in zod.
8. **`onDelete` policy.**
   - Rows private to a user: `Cascade` from `User`.
   - Shared records (games, finished standings, position shares): `SetNull`, plus a name snapshot.
   - Authored content: `Restrict` (`Lesson → Legend`).
   - History: a plain column with no foreign key (`TrainingAttempt.cardId`, `AuditLog.actorUserId`, `Mistake.lastGameId`, `GamePlayer.opponentUserId` and `tournamentId`).
9. **Index policy.**
   - Every foreign key that a cascade or `SetNull` follows from a big table has an index, partial `WHERE … IS NOT NULL` when the column is sparse.
   - No index duplicates a unique constraint.
   - Per-user tables rely on a `(userId, …)` prefix.
   - Filters inside one user's few thousand rows get no extra index.
   - Every index in §8 names the query it serves.
10. **Prisma client.**
    - A global `omit` (GA since Prisma 6.2) in `apps/web/lib/prisma.ts` for heavy or secret columns: `ChessPosition.explanation`, `Opening.explanation`, `Game.gameData`, `LinkedAccount.accessTokenEnc`, `AccountDeletion.lichessTokenEnc`.
    - `binaryTargets` gains `linux-musl-arm64-openssl-3.0.x` for the worker on the OCI Arm VMs, unless the worker uses a driver adapter (`@prisma/adapter-pg`) instead of the Rust engine.
    - `previewFeatures = ["relationJoins"]` (accepted by 6.17.1, checked) so the Review loader can use `relationLoadStrategy: "join"`: one round trip for game, players, analysis and review.
11. **Package.** In its own PR, move `schema.prisma`, the migrations and the generated client into `packages/db` (inv-play-a §2.1), with the JSON schemas, so `apps/web` and the worker share them. `_prisma_migrations` stores migration names only, so moving the folder is safe.

---

## 3. Normalisation decisions

Each decision gives the problem, the options, the choice and its consequences. Sizes come from §10.1.

### 3.1 D1: moves and clocks as columns, not `gameData` JSON

- **Today:**
  - `Game.gameData` (`schema:83`) holds config, display copies, the final FEN, the end method, a Sentry trace header and a verbose chess.js `moveHistory`.
  - The socket server sends the whole history on every move (`apps/web-socket/GameSession.ts:1108`), and `apps/web/app/api/chess/move/route.ts:73-86` rewrites it: 265 B per ply, about 860 KB written per 80-ply game.
  - The mating move is never stored (`GameSession.ts:430` returns before `persistMoveToDb` at :440).
  - A restart rebuilds from `startingFen` only (`GameSession.ts:66`).
- **Options:** (a) keep JSON; (b) a `GameMove` row per ply (about 6 KB per game and a join on every read); (c) `String[]` of UCI moves; (d) one `moves` text column plus `moveClocksMs int[]`.
- **Choice: (d)** (allocation B3, P2 §6.2).
  - `moves` is space-separated UCI from `startingFen` (about 5 B per ply, measured 403 B for 80 plies).
  - `moveClocksMs` holds the mover's remaining milliseconds after each ply (344 B). It is empty for untimed games.
  - `plyCount smallint` makes every checkpoint idempotent and safe against reordering: `UPDATE … WHERE "plyCount" <= $n`.
  - The socket server keeps a per-game ndjson journal on the OCI disk (version byte per record), so sparse checkpoints (≤ 10 per game, on phase change and at the end) lose nothing.
  - Time spent per move is derived: `spent_i = clock_{i−2} − clock_i + increment`.
- **PGN (revision 2): stored once for games played here.** `pgn` (with `%clk`) is built at the finish and never rewritten (B3; `ALTER COLUMN pgn SET COMPRESSION lz4`). Imported games do **not** store PGN: "Download PGN", the coach context and the export rebuild it from `moves`, `moveClocksMs` and the header columns (`whiteName`, `whiteRating`, `timeClass`, `"endMethod"`, `"completedAt"`, `ecoCode`, `"externalUrl"`). Lichess `%eval` values go into `GameAnalysis.evals`. Re-measure §10.1 with real PGN text (it compresses, unlike random hex) [V9].
- **`gameData`** stays as a legacy column. New games write `null`, and small typed config goes in `meta Json` (`GameMetaV1`, P2 §6.2: header, prefix, position card, assists, `rev`, draw offers, premoves, `abortedBy`, client). The B1 backfill moves old rows over, C1 strips `moveHistory` and `traceContext`, and C6 drops the column.
- **Display copies** (`positionInfo`, `openingInfo`) are not copied forward; the header and prefix are computed once at creation, so neither the socket session nor the RSC snapshot joins `chess_positions`/`openings` (and `explanation` is never read on a game path).

### 3.2 D2: `GamePlayer`, one row per member side

- **Today:**
  - Colour is implied (creator = White in matchmaking, `apps/web/lib/services/matchmaking/matchmaking.service.ts:260-261`) or buried in JSON. The analysis route guesses it three ways (`apps/web/app/api/analysis/[gameId]/route.ts:200-208`).
  - Profile lists run an OR over `creatorId` / `opponentId` (`apps/web/app/api/profile/[referenceId]/route.ts:42-61`).
  - The bot user is a party to every AI game, which makes it a hot `user_stats` row.
- **Choice (B1, B2, P2):**
  - `Game` gains explicit `whitePlayerId` / `blackPlayerId` (`SetNull`, fixed at creation; a null side is a bot or a not-yet-joined friend), plus a display snapshot (`whiteName`, `whiteRating`, `whiteTitle`, and the black equivalents) for members, bots ("Engine {botElo}") and external players alike.
  - **`GamePlayer` holds one row per member side**, PK `(gameId, userId)`, unique `(gameId, color)`. A bot game has 1 row, an imported game 1, a PvP game between two members 2.
  - It denormalises the filter keys (`mode`, `timeClass`, `rated`, `source`, `endedAt`, `result`) and the per-side display and result columns the lists need: `opponentUserId` (no FK), `opponentName`, `opponentRating`, `ratingBefore`/`ratingAfter`/`ratingDelta`, `tournamentId` (no FK). Later phases add columns in their own migrations: analysis outputs and `ecoCode` (M3), `linkedAccountId` (M4), `bankVersion` (M5), weakness inputs (M6), `game_players_h2h_idx` (M9), tournament points (M12).
- **Why member sides only:** bots and external opponents never need a "my games" index; their snapshot sits on `Game`.
- **Two members import the same Lichess game:** `games_source_externalId_key` deduplicates it into one `Game`; the import upsert is `ON CONFLICT … DO UPDATE … RETURNING id, (xmax = 0) AS created`, so the second member still gets their `GamePlayer` row (P4 §8; a `DO NOTHING` form would silently skip it).
- **Replaces:** the OR queries, `UserStats` (wins, losses, draws and streaks are derived with one range scan over ≤ 2,000 rows), `RatingEvent` (D16) and `TournamentPairing` (D21).
- **Live games:** "my live games" is `WHERE "userId" = $1 AND "endedAt" IS NULL` on the main index (NULLs sort first in `DESC`), so no extra partial index is needed for P5 "Continue" or P9's "one live game per user".

### 3.3 D3: packed `GameAnalysis` instead of `MoveEval`

- **The plan's per-ply `MoveEval`** (`docs/implementation-plan.md:100-104`) measured **23,773 B per 80-ply game** (§10.1). For a typical member that is about 6.7 MB a year for analysis alone.
- **The Review screen always loads one game with all its plies:** the eval graph, a badge per move, the best move and line at key moments, and the progress counter. Cross-game per-ply queries are not needed, because the worker writes the per-player aggregates (§3.10) and the bank items (§3.7) while it analyses.
- **Choice: one `GameAnalysis` row per game** (both colours). Array index `i` is the ply offset from `Game.startPly`.
  - `evals smallint[]`, length n+1, White's point of view, `evals[0]` is the start position. cp is clamped to ±9999, and mate in n is stored as `sign·(30000 − n)`. Win% clamps at ±1000 cp anyway (research R-EVAL).
  - `best smallint[]`: the best move in the position **before** each ply, as a MoveCode (`from + 64·to + 4096·promo`, 0 = unknown).
  - `judgements smallint[]`: a JudgementCode per ply (0 = ungraded).
  - `lines` JSON for flagged plies only: `{"<ply>": ["<pv>", "<alts>"]}`.
  - Accuracies, `countsWhite` / `countsBlack` (12 each), and the phase boundaries.
- **Measured: 1,206 B per game**, which is 19.7× smaller.
- **Not stored:** per-move Win%, per-move accuracy and Win% loss. The browser and the worker recompute them from `evals` with the shared `packages/chess-analysis` formulas (`implementation-plan.md:115-122`). The FEN before each ply is derived from `moves`, and is stored only on `Mistake` rows.
- **Determinism and versioning:** `version` (`GRADING_VERSION`), `engine`, `nodesPass1` and `nodesPass2` (research R-DET). A version bump re-queues the analysis.
- **Imported Lichess games with `%eval`:** `evalSource = LICHESS`. `best` is 0 except on pass-2 candidate plies, and "Best" is then judged by a loss under 0.5 Win% instead of by matching the engine move.
- **Progress:** progress goes over the socket. The row is written **once** at the end (or once at failure, with `gradedPlies` and `failedAtPly` for the `V3ReviewFailed` state). There are no intermediate writes, so no Neon round trips during the 10–25 s run, and a crashed run restarts from ply 0.

### 3.4 D4: `PlayerReview` (text and moments) vs `Mistake` (bank)

- **Coach text is per colour:** summary sentences, the phase line, "best decision", and for each key moment the ask, why and plan-chip feedback.
  - It is generated lazily for imported backlog games, on first open (inv-rct-a §2.4.6).
  - The walkthrough state (moment index, FOUND / REVEALED per moment) is per user.
- **Choice:** `PlayerReview` is 1:1 with `GamePlayer` (composite FK `(gameId, color)`, Cascade).
  - `content` (`ReviewContentV1`, with the ≤ 3 moments inside, each pointing to its `Mistake.referenceId`) and `progress` (`ReviewProgressV1`) are separate JSON columns, because they have different writers.
  - Measured at 4.4 KB with incompressible text; real English is smaller after lz4.
- **Rejected:** a `KeyMoment` table (inv-rct-a). Moments are always read with the review, never queried on their own; the training state is on `TrainingCard`.

### 3.5 D5: one `Job` table

- **Kinds:** the ledger in `01-architecture.md` CR-11: M3 `ANALYZE_GAME REVIEW_TEXT LEGEND_COMPARE IMPORT_SYNC IMPORT_PURGE RECOMPUTE_WEAKNESS EXPORT_BUILD ACCOUNT_PURGE DODO_CUSTOMER_SYNC HOUSEKEEPING DAILY_PLAN`; m5a `EXTRACT_MISTAKES`; m10a `MILESTONES_EVALUATE NOTIFY_DISPATCH NOTIFY_REMINDERS NOTIFY_WEEKLY MEMBERSHIP_PAUSE_EDGE R2_SWEEP`; m12a `TOURNAMENT_STARTING`; m13a `BACKUP`.
- **Columns added beyond revision 1:** `fairSeq int default 0` (per-user interleaving; `jobs_ready_idx (priority DESC, "fairSeq", "runAt") WHERE status = 'QUEUED'`), `lastKickAt timestamp(3)` (the re-kick compare-and-set), `WAITING` in `JobStatus`.
- **`dedupeKey`** is unique, so enqueueing is idempotent. Opening a backlog game re-prioritises its row (`DO UPDATE SET priority = GREATEST(…), "runAt" = LEAST(…)`) instead of creating a second one.
- **Waking the worker without polling:** the enqueuing route POSTs `/internal/analysis/kick` (HMAC) in `after()`. The worker drains with `FOR UPDATE SKIP LOCKED` until nothing is claimable, reads `min("runAt")` while Neon is still awake, and arms one timer; an idle worker sends no query. Recurring work is future-dated rows planned by the daily `DAILY_PLAN` (no hourly tick, no 30-minute safety sweep). A worker that polled every few seconds would keep the compute awake all month (720 h × 0.25 CU = 180 CU-h against the Free plan's 100).
- **Priorities** are `JOB_PRIORITY` names from `DB/src/jobs.ts`; higher runs first.
- **Progress the UI needs is on the domain rows**, not on the job: `Game.analysisStatus` (+ `GameAnalysis.gradedPlies` on failure) and the `ImportRun`/`LinkedAccount` counters. `jobs.progress` (with `v`) is internal.
- **`userId` / `gameId` are plain columns with no FK**, so an `ACCOUNT_PURGE` job survives the deletion it is cleaning up after.
- **Enum or text?** `JobKind` grows every phase. P3 may ship it as `text` + a zod enum (raw SQL `kind = ANY($2::text[])`) to avoid the enum rollback hazard (§11.1 rule 6); if it ships as a Postgres enum, every value follows the two-release rule.

### 3.6 D6: `LinkedAccount`, `ImportCursor`, the encrypted Lichess token

- **Identity:** `externalId` is the Chess.com `player_id` or the Lichess id, which are stable across renames. `username` and `usernameLower` are refreshed on every sync.
- **Ownership (inv-acct Q18):**
  - Lichess links are verified by OAuth.
  - Chess.com links start unverified. `verifiedAt` is set by the profile-location code check.
  - The partial unique index `linked_accounts_verified_key (provider, externalId) WHERE "verifiedAt" IS NOT NULL` allows one verified owner. Unverified claimants coexist until someone verifies; the verified claimant takes over, and the squatter's imported rows are purged by `GamePlayer.linkedAccountId`.
- **Token (only if P4 keeps one; the recommended default stores none, feasibility F-API-3):**
  - `accessTokenEnc bytea` = `keyId(1) | iv(12) | ciphertext | tag(16)`, AES-256-GCM, with **AAD = `linked_accounts.id`**, so a ciphertext copied to another row fails to decrypt.
  - The key is `LINK_TOKEN_KEYS` (sealed with the worker's public key, so web holds only the public half) in the Vercel env, plus the worker env if it uses the owner-rate export (60 games/s, research R-LI-05). `keyId` allows key rotation.
  - It is globally omitted from Prisma reads.
  - A 401 sets `status = RELINK_REQUIRED`. Lichess tokens cannot be refreshed (R-LI-02).
- **Import state** lives on the account (`importState`, `importDone`, `importTotal`, `importedCount`, `skippedCount`, `lastSyncAt`, `lastSyncOkAt`, `nextAllowedSyncAt`, `lastError`), so the Connected card and `/api/me` need one row. The worker updates the counters every 25 games or 5 s, never per game.
- **`ImportCursor`** (1:1):
  - Chess.com: `archives` (`{"2026/10": {etag, lastModified, done, games}}`, R-CC-04).
  - Lichess: `lichessSinceMs` (next `since`), plus `oldestImportedAt` and `seen` / `skippedVariants`.
  - Kept apart because it grows with account age.
- **Nightly auto-import:** `nextAutoSyncAt` is computed for about 03:00 user-local (`User.timeZone`), in 15-minute buckets. The scheduler query uses the `linked_accounts_autosync_idx` partial index.

### 3.7 D7: `Mistake` deduplicated, with `MistakeOccurrence`

- **A bank item is a trainable position, not a game event.** The same opening error across five games is one card that comes back, with "seen in 5 games" (research R-PZL-10).
- **Key:** `@@unique([userId, epdHash])`, where `epdHash` is a 64-bit hash of the EPD (placement, side, castling, en passant) of the position before the user's move. That is 8 B of index key instead of 60–90 B of FEN text.
- **`MistakeOccurrence (gameId, ply) → mistakeId`** cascades from both sides.
  - A re-analysis inserts `ON CONFLICT DO NOTHING`, so occurrences are never double-counted.
  - Deleting imported games removes their occurrences. The purge job then deletes mistakes with no occurrence left and recomputes `lastGameId`, `lastPly`, `lastPlayedAt` and `lastOpponentName`. These are plain columns so a bank row renders with no join.
- **Lichess-CSV shape** (research §7.4): `fen` is the position before the opponent's setup move, `setupUci` is that move, and `solution` is the space-separated line. `accept` holds the alternative first moves.
- **Texts are not stored by default.** The hint, coach-correct, coach-wrong and cost texts come from deterministic templates in `packages/chess-training/explain.ts`, run on `fen` plus the stored facts at read time (about 1 ms with chess.js). This saved about 500 B per row in the estimate. Only LLM-rewritten **verified** text is stored, in `texts` (`MistakeTextV1`), with `textVerifiedAt`.
- **What becomes a Mistake:** MISTAKE, BLUNDER and MISS plies, plus INACCURACY plies with a drop of at least 7 Win% in an undecided position, capped at the top 4 per game (inv-rct-b §3.1). Errors beyond the cap still feed Weakness through `GamePlayer.errorThemes` (§3.10).

### 3.8 D8: `TrainingCard` / `TrainingAttempt`, sessions and days

- **`TrainingCard`:**
  - One per (user, item). Decks are BANK, PUZZLE and OPENING (inv-rct-b D1).
  - It holds the ts-fsrs card fields (`due`, `stability`, `difficulty`, `elapsedDays`, `scheduledDays`, `learningSteps`, `reps`, `lapses`, `state`, `lastReview`), plus `mastery` (0–5 dots) and `suspendedUntil` ("skip for today").
  - PUZZLE and OPENING cards carry a snapshot (`fen`, `solution`, `orient`, `puzzleRating`) so they render without the shards.
  - `@@unique([userId, itemKey])` replaces three sparse unique indexes.
- **Owner decision O6:** create a PUZZLE card only when the first attempt was not a clean first-try solve (graded Again or Hard). Clean solves are logged only. That is about 60% fewer cards, and the recently-seen exclusion uses `training_attempts_puzzle_idx`.
- **`TrainingAttempt`:**
  - Append-only, one row per graded or practice attempt.
  - `clientAttemptId uuid @unique` gives idempotency and offline-outbox replay (inv-rct-b D4).
  - It stores the FSRS state **after** the review (for the optimiser), the hint, wrong-try and solution flags, and the puzzle rating before and after.
  - `cardId` and `sessionId` are plain columns: history outlives cards and sessions.
- **`TrainingSession`:** `items` is the ordered list of `itemKey`s (≤ 20, measured 614 B per row). Sessions are pruned after 90 days.
- **`TrainingDay`:** PK `(userId, day)`. It holds `bankReviewed` (the cap), `newIntroduced`, `puzzlesDone`, `lessonsDone`, `activeMs`, and `plan` (the frozen daily plan, nulled after 7 days) with `planDone`. Updates are HOT (PK only, `fillfactor 80`).
- **`ThemeMastery`:** PK `(userId, theme)`, holding the EWMA and `bankCount`.
- **`TrainingProfile`:** the puzzle Glicko rating, the solve and day streaks with their bests, and `lastActiveDay`.
- **Grading a card is one transaction** (§7.3). The card update is guarded by `reps = $cardReps`, so two tabs cannot both grade it.

### 3.9 D9: Lichess puzzles on R2

- The corpus is built offline (`scripts/puzzles/build-shards.ts`) from `lichess_db_puzzle.csv.zst` (CC0, 6,157,341 rows).
  - Filter: popularity ≥ 80, NbPlays ≥ 300, RD ≤ 90, rating 600–2600.
  - Per theme × 100-point band, keep the top 250.
  - Published as `media.playchess.tech/puzzles/v1/{theme}/{band}.json`, immutable and versioned (inv-rct-b §2.6). That is about 155k tuples and 20 MB on R2, and **0 B in Neon**.
- **Neon stores only** `TrainingCard` (puzzles attempted and not cleanly solved) and `TrainingAttempt`.
- **Fallback, not created:** if R2 is unavailable, use this table, capped at 150k rows (about 60 MB). It is sampled by `WHERE themes @> ARRAY[$t] AND "ratingBand" BETWEEN $b AND $b + 1 AND "randKey" >= $r ORDER BY "ratingBand", "randKey" LIMIT 40`, wrapping to `"randKey" >= 0` when short, never `ORDER BY random()`. It is loaded by a one-off script (`zstd -d | filter | \copy` into staging, then `INSERT … SELECT`), with `importedFrom` kept for diffs on refresh (research R-LPZ-04).

```prisma
/// FALLBACK ONLY (not in schema.target.prisma). Lichess CC0 puzzle subset.
model LichessPuzzle {
  id           String   @id @db.VarChar(8)
  fen          String
  /// setup move + solution, space-separated UCI (cheaper than String[])
  moves        String   @db.VarChar(160)
  rating       Int      @db.SmallInt
  ratingBand   Int      @db.SmallInt   // rating / 100
  ratingDev    Int      @db.SmallInt
  popularity   Int      @db.SmallInt
  nbPlays      Int
  themes       String[]
  openingTags  String[] @default([])
  randKey      Int                      // random 0..2^31-1, fixed at load
  importedFrom String   @db.VarChar(10) // "2026-10-05"

  @@index([ratingBand, randKey])
  @@index([themes], type: Gin)
  @@map("lichess_puzzles")
}
```

### 3.10 D10: Weakness inputs as packed per-game stats

The Weakness profile (`V3WeaknessProfile`) needs, per user and scope:

- rates per 100 moves by theme, phase, clock bucket, opening family and piece;
- conversion ("9 of your last 10 positions that were +3 or better ended in a win");
- book exit;
- "seen in 7 of the last 20 games";
- the trend.

Scanning per-ply rows for this is what made `MoveEval` attractive. Instead, the worker computes the aggregates once per game and side, while it has every ply in memory, and stores them on `GamePlayer`:

| Column | Type | Content |
|---|---|---|
| `counts` | `smallint[12]` | Judgement counts for this side |
| `phaseAccuracy` | `real[3]` | Opening, middlegame and endgame accuracy (−1 = not reached) |
| `stats` | `smallint[30]` (`STATS_V1`) | moves; phase moves ×3; phase errors ×3; clock moves ×4 and clock errors ×4 (> 5, 2–5, 1–2, < 1 min left, the design's buckets); piece moves ×6 and piece errors ×6 (p n b r q k); reached +300 (0/1); converted (0/1); book-exit Win% |
| `errorThemes` | `text[]` | One entry per (error, theme), covering **all** errors and not only the 4 bank items |

- The Weakness job (`RECOMPUTE_WEAKNESS`, deduped per user per hour) reads at most about 300 rows through `game_players_userId_endedAt_gameId_idx`, sums them in TypeScript, joins the static rating-band baseline (`packages/chess-training/baselines/v1.json`, research R-WK-01), and upserts this week's `WeaknessSnapshot`.
- **Measured:** a `jsonb` object with the same content was 998 B; the packed columns put the analysed row at 344 B in total.
- `STATS_V1` is append-only: a new metric is appended, and shorter old arrays read as "unknown".

### 3.11 D11: coach threads, messages and usage metering

- **`CoachThread`:** one per `(userId, kind, subjectKey)` (unique), where `subjectKey` is a game ref, mistake ref, lesson slug, `fen:<epdHash>` or `general`. `gameId` cascades, so deleting a game deletes its threads.
- **`CoachMessage`:**
  - Stores user questions and **verified** coach sentences (`sentences [{t, v}]`). Tool rounds are not stored; they are rebuilt from facts.
  - Per message it records the token, cache and cost columns and the latency.
- **One answer in flight per user:** `coach_messages_streaming_key UNIQUE (userId) WHERE status = 'STREAMING'`.
  - Inserting the coach placeholder fails with P2002 when another answer is streaming, which maps to 409 `in_flight`.
  - Before inserting, the route marks this user's `STREAMING` rows older than 90 s as `ABORTED` (crash recovery).
- **Fair use:** `CoachUsageDay (userId, day)` gets one atomic upsert per finished answer (§7.3), counted on `done` only, so failures and fallbacks are refunded.
  - The caps live in `CT/limits.ts` (architecture CR-33: member 30/day and 150/month, trial 10/day and 40 over the trial, with cost ceilings); the monthly sum reads ≤ 31 PK rows.
  - `bgCostMicroUsd` attributes the worker's LLM spend (review text, narration) to the user.
- **Burst limit** (5 questions a minute): `rate_limit_buckets`, so the big message table needs no `(userId, createdAt)` index.
- **Answer reuse:** "Explain 19.Qd2" for a key moment is answered from `PlayerReview.content` with no model call. A repeated chip in the same thread reuses the stored message (`threadId, chipKey, ply`).
- **Retention:** messages older than 180 days are deleted. Threads are kept and simply become empty.

### 3.12 D12: `Lesson` + `LessonStep`

- Lessons are authored content (`V3LessonPlayer`, `V3LessonGuess`, `V3LessonComplete`): a verified game score, a start and end ply, checkpoints with prompt, hint, correct text, badge and accepted alternatives, narration per ply, plus intro, story and outro.
- **Rows instead of JSON:**
  - The authoring script (`scripts/lessons/build.ts`, inv-rct-b J7) checks every step against the PGN (each checkpoint ply must be the legend's move).
  - The Phase 8 admin edits single steps.
  - The player reads the steps in one indexed range scan (`lesson_steps` PK), cached with `unstable_cache` under the tag `lesson:<slug>`.
  - A lesson has about 20–40 steps, and there are tens of lessons.
- **`Lesson.legend` is `Restrict`:** a legend that has lessons cannot be deleted. Alignment JSON for karaoke text goes to R2 (`alignmentUrl`), like explanations.
- **`LessonProgress`:** PK `(userId, lessonId)`, holding status, the resume ply, stars and the checkpoint results of the last run.

### 3.13 D13: settings and notification preferences

- **`UserSettings.prefs`** (`PreferencesV1`, inv-acct §3.0.1, plus a `training` section) covers:
  - board, pieces, sound, appearance;
  - notifications: the channels × push/email matrix, reminder time and quiet hours;
  - training: `dayStartHour`, `releaseHour`, `bankDailyCap`, `newPerDay`, `autoGrade`, `coachVoice`, `botStrength`.
- **`PATCH` deep-merges per leaf** and bumps `prefsVersion`.
- **Derived columns, so jobs never parse JSON:** `reminderUtcMinute`, `quietStartUtcMinute`, `quietEndUtcMinute` and `emailOptIns`. They are recomputed on every PATCH and by the nightly DST pass.
- **`User.timeZone`** is on the user row, because training writes and coach caps need it and already load the viewer.
- **`TrainingProfile`** holds counters, not preferences, so its frequent writes never contend with a prefs PATCH.
- **Push permission is per device:** `PushSubscription` rows, one per endpoint.

### 3.14 D14: `Notification`

- **One row per logical notification.** `dedupeKey` (`mistakes_due:<userRef>:<day>`) makes every producer idempotent.
- **Delivery state per channel:** `pushStatus`, `emailStatus` (`PENDING`, `SENT`, `SKIPPED` or `FAILED`), `attempts`, `lastError`, `sentAt`. The dispatcher claims rows with `notifications_pending_idx` and `FOR UPDATE SKIP LOCKED`.
- **Inbox fields:** `readAt` and `clickedAt` serve an in-app inbox if one ships (inv-sys Q13). Without an inbox, rows are kept only as a send log.
- **Retention:** 90 days.

### 3.15 D15: audit log, webhooks, idempotency, rate limits, trial ledger

- **`AuditLog`** (M4; P4 is the first writer, consistency R-04):
  - Append-only, no foreign key.
  - Categories: `ACCOUNT`, `BILLING`, `ADMIN`, `CONTENT`, `TOURNAMENT`, `MODERATION`, `SYSTEM`.
  - `action` is a dotted verb; `targetType` / `targetId` hold a referenceId or slug, never an email.
  - Written for: username changes, email relinks in user sync (`apps/web/app/api/user/sync/route.ts:56-79`), applied billing snapshots, plan changes, cancellations, deletions, admin CRUD, the backfills, and imports of other people's data on take-over.
  - The admin feed reads `(category, at DESC)`. Kept 400 days.
- **`WebhookEvent (provider, eventId)`:**
  - The **first** statement of each webhook is `INSERT … ON CONFLICT DO NOTHING`; a conflict returns 200 with no work done.
  - `eventTime` (Dodo's timestamp) feeds `User.subscriptionSourceAt` for the billing compare-and-set (audit-db DB-07).
  - The payload is nulled after 7 days and the row deleted after 30.
- **`IdempotencyKey`:** `"<userRef>:<scope>:<Idempotency-Key>"` → stored status and response, kept 24 h. Used by `POST /api/games`, challenges, shares and checkout. It replaces `Game.clientKey` (inv-play-b), which would put a mostly-NULL unique index on the largest table.
- **`RateLimitBucket`:** `UNLOGGED`, one upsert per check, **only for windows ≤ 60 s** (bursts: lookup, search, username availability, coach bursts, `bot-checkpoint`). Hour- and day-long windows (contact 5/h, reports 20/day, shares, exports, avatar, review batch, push test) are **durable**: counted from the route's own source rows or kept in the LOGGED `RateLimitWindow (key, count, resetAt)`, because Neon empties unlogged tables at every scale-to-zero (api-perf AP-11). The Resend daily budget is counted from `notifications` (feasibility F-NEON-3). The limiter's spec carries `store: "burst" | "durable"`; a `windowSec > 300` with `burst` fails at module load. Never on hot paths.
- **`TrialLedger`:** `sha256(HASH_PEPPER‖normalised email)` (the same pepper for every writer and reader, consistency R-09) as the PK, plus `handleHashes` for linked chess handles. It is written when the trial starts, so "one trial per person" survives account deletion. Its legal basis needs privacy-policy text (inv-pub Q9).

### 3.16 D16: ratings

- `PlayerRating (userId, pool)` holds the Glicko-2 rating, RD and volatility for REPLAY rated games (BULLET, BLITZ, RAPID). It is seeded from the linked Chess.com or Lichess rating (`seededFrom`).
- The rating before each game and its delta live on `GamePlayer`. The rating chart and "+8 since Monday" read `game_players` by `(userId, endedAt)`, filtered on `rated` and `timeClass`.
- Imported games put the provider's rating at that time in `GamePlayer.ratingBefore`, with `ratingDelta` null.
- Whether REPLAY games are rated at all is owner decision O3 (inv-acct Q7, audit-socket §23.4). If the answer is no, `player_ratings` is simply not created.

### 3.17 D17: one `Share` table

- **Kinds:**
  - `POSITION` (`/s/<code>`): fen or chessPositionId, title, subtitle, a note of up to 140 characters, themes, the source game and ply.
  - `REVIEW` (`/r/<code>`): game, colour, `snapshot` (the frozen public payload, so the public page needs no join and survives later edits), `showUsername`, `imageVersion` for OG image cache busting, and a 30-day `expiresAt`.
- **Ownership:** `ownerId` is `SetNull`, so position shares outlive their author. The deletion flow deletes REVIEW shares explicitly.
- **No view or play counters.** A per-view `UPDATE` would wake Neon on crawler hits; views come from PostHog.

### 3.18 D18: eval cache off Neon

- The worker caches evals per EPD in a local SQLite file on the 50 GB boot volume (`/data/evalcache.sqlite`).
- It is seeded from the CC0 Lichess eval DB, filtered to EPDs reachable from the `openings` lines (research R-CMP-07), and also serves the coach's `/engine/analyse` tool.
- **Neon cost: 0.** Dev and prod each keep their own cache.

### 3.19 D19: soft deletes and account deletion

- **No soft delete for users.** Delete account (`V4DeleteAccount`) runs `lib/services/account-deletion.ts`, which is also called by the Clerk `user.deleted` webhook.
- **One transaction:**
  1. Write `TrialLedger` (if a trial was ever used) and `AccountDeletion` (the outbox: hashes, `clerkUserId`, the Dodo subscription id and the still-encrypted Lichess token).
  2. Anonymise shared rows: `UPDATE games SET "whiteName" = 'Deleted player' WHERE "whitePlayerId" = $u` (and the same for black), using `games_white_player_idx` / `games_black_player_idx`; `UPDATE tournament_participants SET "displayName" = 'Deleted player' WHERE "userId" = $u`.
  3. Delete REVIEW shares, and imported games where this user is the only player.
  4. `DELETE FROM users WHERE id = $u`. The foreign keys do the rest (§6).
- **After commit, the `ACCOUNT_PURGE` job** cancels Dodo, revokes the Lichess token, deletes the R2 avatars and exports, deletes the Clerk user, deletes the PostHog person and sends the confirmation, retrying each step (inv-acct §3.8).
- **The foreign keys that make this safe ship in M10** (P10; §5.10): `games.creatorId` / `opponentId` become nullable `SetNull` (today `Cascade`, `schema:90-91`), as do `tournaments.createdByUserId` (`schema:399`) and `tournament_participants.userId`.
- **Soft "hide" flags that remain:** `Mistake.hiddenAt` (removed from the bank), `Share.revokedAt`, and `isActive` / `isVisible` on catalogue rows. `User.isActive = false` is suspension, and `resolveUser` / `requireMember` must check it (audit-db §3.2).
- **Lapsed members** keep their data for 12 months (§10.4).

### 3.20 D20: explanations to R2

- `ChessPosition.explanation` and `Opening.explanation` (`schema:202`, `schema:287`) are uploaded by the B4 backfill to `explanations/{position|opening}/{referenceId}.v1.json` on R2, next to the existing audio.
- Their rows get `explanationUrl` and `hasExplanation` (for the sitemap and catalogue badges without the blob). Until C5 drops the JSON columns they are globally omitted.

### 3.21 D21: tournaments without a pairing table

- The arena (inv-acct §5) needs: per-game points with fire streaks, position rotation, auto-start, late join, invites and frozen results.
- **Columns:**
  - `Tournament` gains `slug`, `inviteCode` (unique), `visibility`, `hostUserId`, `lobbyOpensAt`, `lateJoinUntil`, `participantCount` (incremented atomically on join, with the cap in the `WHERE`), `standingsVersion` (for socket deltas), `scoring` JSON, `finalStandings` (frozen at finalize) and `cancelledReason`.
  - `TournamentPosition (tournamentId, order)` holds the position rotation.
  - `TournamentParticipant` gains the arena fields (`score`, `streak`, `fire`, colour counts, `lastOpponentId`, `finalRank`, `withdrawnAt`) and a `displayName` snapshot.
  - **A pairing is the `Game` row** (`tournamentId`, `tournamentPositionOrder`). Each side's points are in `GamePlayer.tournamentPoints` / `tournamentFire`, written in the game-finish transaction, which runs once.

### 3.22 D22: who writes

| Writer | Tables | Path | Round trips |
|---|---|---|---|
| Vercel route handlers (iad1, next to Neon us-east-1) | everything user-initiated; bot-game create, checkpoint and complete; tournament pairing, start, finalize and reminders (`/api/internal/tournaments/*`, called by the socket server, P12 D12-4) | pooled `DATABASE_URL`, runtime role `replay_app` | about 1–2 ms each |
| Socket server (OCI Mumbai) | `games` live columns from creation (matchmaking, rematch, P9 challenges) through the finish; `game_players` of live games; `player_ratings` and `game_players.rating*` (P9 fragment of the finish); `users."gamesVersion"`/stats; `jobs` (`ANALYZE_GAME`) | **direct**, `DB/src/live/*` over a pooled connection (`connection_limit=3`), role `replay_realtime` (B4, P2 §6.7) | checkpoint: 1 statement ≈ 220 ms, ≤ 10 per game; finish: **one data-modifying CTE** (`DB/src/live/finish.ts`) ≈ 220 ms |
| Analysis/import worker (OCI) | `jobs`, `game_analyses`, `player_reviews`, `game_players` analysis columns, `mistakes`, `mistake_occurrences`, `training_cards` (new BANK cards), `games`/`game_players` (imports), `linked_accounts`/`import_runs` counters, `import_cursors`, `weakness_snapshots`, `legend_comparisons`, `notifications` delivery state | the analysis result is **one Neon HTTP batch** (`sql.transaction([...])`, P3-D11) of set-based statements; claims and small writes over a pooled `pg` connection; role `replay_worker` (`statement_timeout = 60s`) | one round trip per analysed game (§7.2); one per import chunk |
| Vercel daily cron (Hobby: once a day) | billing reconcile, the trial-reminder backstop, checkout clean-up | route handler | — |

Why direct socket writes (revision 1 chose internal routes): every Vercel hop from Mumbai is an invocation plus ≈ 250 ms, and B4 is binding. The finish is one CTE, so the cross-continent cost is one round trip, not eight. The tournament exception exists because pairing and finalize read and write many rows next to Neon (P12). The socket and worker pools follow the Neon-suspend rules in `01-architecture.md` §1.12.1.

---

## 4. Enum catalogue

Existing enums are unchanged except `GameStatus`. Values are listed in declaration order; code never relies on that order (§2.5). Migration ids are the allocation's (§5.0). Each `ADD VALUE` ships in its own file and is written one release later (§11.1).

| Enum | Values | Used by | Migration |
|---|---|---|---|
| `GameStatus` (existing, `schema:303`) | + `ABORTED` | `games.status` | M2a (own file) |
| `GameResult`, `MatchmakingStatus`, `TournamentStatus`, `TournamentMode`, `Role` | unchanged | — | — |
| `GameSource` | REPLAY, CHESSCOM, LICHESS | `games`, `game_players` | M2 |
| `GameMode` | LEGEND_BOT, BOT, FRIEND, ONLINE, TOURNAMENT, IMPORTED | `games`, `game_players` (`IMPORTED` and `LEGEND_BOT` exist from M2, written from P4/P8) | M2 |
| `TimeClass` | BULLET, BLITZ, RAPID, CLASSICAL, DAILY, UNTIMED | `games`, `game_players`, `mistakes`, `player_ratings.pool` (BULLET/BLITZ/RAPID), `weakness_snapshots.timeClasses` | M2 |
| `GameWinner` | WHITE, BLACK, DRAW, NONE (NONE = aborted) | `games.outcome` | M2 |
| `GameEndMethod` | CHECKMATE, RESIGNATION, TIMEOUT, TIMEOUT_VS_INSUFFICIENT, STALEMATE, THREEFOLD, FIFTY_MOVE, INSUFFICIENT_MATERIAL, AGREEMENT, ABANDONED, ABORTED, OTHER (imports only) | `games."endMethod"`. Fixes threefold and fifty-move being written as `draw_agreement` today (`apps/web/app/api/chess/game-over/route.ts:33-40`) | M2 |
| `LivePhase` | WAITING, STUDY, FIRST_MOVE, PLAYING, ENDED | `games.phase` (rehydration) | M2 |
| `PlayerResult` | WIN, LOSS, DRAW, ABORTED | `game_players.result` | M2 |
| `AnalysisStatus` | NONE, QUEUED, RUNNING, DONE, FAILED, SKIPPED | `games."analysisStatus"` (no column on `game_players`) | M3 |
| `EvalSource` | ENGINE, LICHESS, MIXED | `game_analyses` | M3 |
| `ShareKind` | POSITION, REVIEW | `shares` | M3 |
| `ComparisonStatus` | FACTS_READY, NARRATING, READY, FAILED | `legend_comparisons` | M3 |
| `JobKind` | CR-11 ledger: M3 `ANALYZE_GAME REVIEW_TEXT LEGEND_COMPARE IMPORT_SYNC IMPORT_PURGE RECOMPUTE_WEAKNESS EXPORT_BUILD ACCOUNT_PURGE DODO_CUSTOMER_SYNC HOUSEKEEPING DAILY_PLAN`; m5a `EXTRACT_MISTAKES`; m10a `MILESTONES_EVALUATE NOTIFY_DISPATCH NOTIFY_REMINDERS NOTIFY_WEEKLY MEMBERSHIP_PAUSE_EDGE R2_SWEEP`; m12a `TOURNAMENT_STARTING`; m13a `BACKUP` (or `text` + zod, §3.5) | `jobs` | M3 + later files |
| `JobStatus` | QUEUED, RUNNING, DONE, FAILED, CANCELLED, WAITING | `jobs` | M3 |
| `ChessProvider` | CHESSCOM, LICHESS | `linked_accounts`, `import_cursors` | M4 |
| `LinkStatus` | ACTIVE, ERROR, RELINK_REQUIRED | `linked_accounts.status` | M4 |
| `ImportState` | IDLE, WAITING_FOR_MEMBERSHIP, QUEUED, RUNNING, RATE_LIMITED, FAILED | `linked_accounts.importState` | M4 |
| `OnboardingStep` | WELCOME, LINK, CONFIRM, LEVEL, GOALS, PLAN, ACTIVATING, DONE | `users.onboardingStep` | M4 |
| `RatingBand` | NEW_TO_CHESS, UNDER_800, R800_1200, R1200_1600, R1600_2000, R2000_PLUS | `users.ratingBand` | M4 |
| `OnboardingGoal` | STOP_BLUNDERING, LEARN_OPENINGS, IMPROVE_ENDGAMES, STUDY_LEGENDS, PLAY_FRIENDS | `users.goals` (enum array) | M4 |
| `AuditCategory`, `AuditActor` | ACCOUNT, BILLING, ADMIN, CONTENT, TOURNAMENT, MODERATION, SYSTEM / USER, ADMIN, SYSTEM, WORKER, WEBHOOK | `audit_logs` | **M4** (R-04) |
| `Judgement` | BRILLIANT, GREAT, BEST, EXCELLENT, GOOD, BOOK, FORCED, INTERESTING, INACCURACY, MISTAKE, MISS, BLUNDER | `mistakes.judgement`; per-ply arrays use `JudgementCode` smallints | M5 |
| `GamePhase` | OPENING, MIDDLEGAME, ENDGAME | `mistakes`, `training_cards` | M5 |
| `MistakeSource` | OWN_ERROR, MISSED_PUNISH | `mistakes.source` | M5 |
| `TrainingDeck` | BANK, PUZZLE, OPENING | `training_cards`, `training_attempts` | M5 |
| `TrainingItemKind` | MISTAKE, REVIEW_POSITION, LICHESS_PUZZLE, OPENING_LINE | `training_cards`, `training_attempts` | M5 |
| `CardState` | NEW, LEARNING, REVIEW, RELEARNING | `training_cards`, `training_attempts` | M5 |
| `FsrsGrade` | AGAIN, HARD, GOOD, EASY | `training_attempts` | M5 |
| `SessionKind` | DAILY, BANK, PUZZLES, WEAKNESS, PRACTICE (+ OPENINGS in m8a) | `training_sessions` (wire values lowercase, CR-31) | M5 |
| `SessionStatus` | ACTIVE, COMPLETED, ABANDONED | `training_sessions` | M5 |
| `ReportTarget`, `ReportReason`, `ReportStatus` | USER, GAME, MISTAKE, PUZZLE, LESSON, POSITION, COACH_MESSAGE / CHEATING, ABUSE, INAPPROPRIATE_NAME, WRONG_SOLUTION, BETTER_MOVE, ILLEGAL_MOVE, TEXT_WRONG, OTHER / OPEN, ACTIONED, DISMISSED | `reports` (P10 writes the USER and GAME targets) | M5 |
| `WeaknessStatus` | INSUFFICIENT, COMPUTING, READY, FAILED | `weakness_snapshots` | M6 |
| `CoachContextKind`, `CoachRole`, `CoachMessageKind`, `CoachMessageStatus` | GAME, MISTAKE, POSITION, LESSON, GENERAL / USER, COACH / CHIP, TYPED, WHATIF, EXPLAIN / STREAMING, ABORTING, COMPLETE, FALLBACK, FAILED, ABORTED | `coach_threads`, `coach_messages` | M7 (exact values in P7 §6.1) |
| `LessonStatus` | NOT_STARTED, IN_PROGRESS, COMPLETED | `lesson_progress` | M8 |
| `ChallengeStatus`, `ChallengeStart` | OPEN, ACCEPTED, DECLINED, CANCELLED, EXPIRED / START, LEGEND, SHARED | `challenges` | M9 |
| `ProfileVisibility` | PUBLIC, PRIVATE | `users.visibility` | M10 |
| `NotificationKind` | CHALLENGE, TOURNAMENT_STARTING, TOURNAMENT_NEW, REVIEW_READY, MISTAKES_DUE, WEEKLY_PROGRESS, IMPORT_DONE, TRIAL_ENDING, PAYMENT_FAILED, PRODUCT_NEWS, ACCOUNT, TEST | `notifications` | M10 |
| `DeliveryStatus` | PENDING, SENT, SKIPPED, FAILED | `notifications.pushStatus` / `emailStatus` | M10 |
| `TournamentVisibility`, `PositionStatus` | PUBLIC, INVITE / (P12) | `tournaments`, `chess_positions.status` (archiving also sets `isActive = false`) | M12 |

**Code tables in `packages/chess-analysis/codec.ts`** (append-only, unit-tested):

- **`JudgementCode`:** 0 ungraded, 1 BOOK, 2 FORCED, 3 BEST, 4 EXCELLENT, 5 GOOD, 6 INACCURACY, 7 MISTAKE, 8 BLUNDER, 9 MISS, 10 GREAT, 11 BRILLIANT, 12 INTERESTING.
- **`MoveCode`:** `from + 64·to + 4096·promo`. Squares are a1 = 0 … h8 = 63; promo is 0 none, 1 n, 2 b, 3 r, 4 q. 0 means unknown, which never collides with a real move because a1a1 is not a move.
- **Eval encoding:** cp clamped to ±9999; mate in n = `sign·(30000 − n)`.
- **`STATS_V1`:** the 30-slot layout in §3.10.

---

## 5. Schema delta by phase

Each migration is its own folder in `packages/db/prisma/migrations/` (names in §11.4). §5.0 is the binding ledger. The blocks in §5.1–§5.11 come from revision 1's validated `schema.target.prisma`, renamed to the canonical names; where one still disagrees with §5.0 or the owning phase spec, those win (§5.0.2). Every index table names the query it serves. "Raw" means hand-written SQL in the same migration.

### 5.0 Canonical schema ledger by migration (revision 2; binding)

The phase spec that owns a migration is authoritative for its exact Prisma text; this ledger is authoritative for **which migration creates which name**. A phase never creates a column another migration owns; if it needs one earlier, it moves the column here first. Each later migration uses `ADD COLUMN IF NOT EXISTS` only where two phases run in parallel (P10 ∥ P12).

#### 5.0.1 The ledger

| Migration | Phase | Creates (models, columns, enums) | Hand-written SQL and notes |
|---|---|---|---|
| **M1** | P1 | `WebhookEvent`; `TrialLedger`; `IdempotencyKey` (or M2i); `RateLimitBucket` (UNLOGGED, ≤ 60 s windows) + `RateLimitWindow` (LOGGED); `users."subscriptionSourceAt"` and `users."gamesVersion" int default 0` (P1 F4b, api-perf AP-06/AP-19); entitlement and billing columns P1 needs | `UNLOGGED` for `rate_limit_buckets`; the billing compare-and-set statement (§7.3). **Not** in M1: `AuditLog` (M4), `User.timeZone` (M4), `UserSettings` (P9) |
| **M2a / M2 / M2i** | P2 | `GameStatus.ABORTED` (M2a); enums `GameMode` (+ `IMPORTED`), `GameSource`, `TimeClass`, `GameEndMethod` (+ `OTHER`), `GameWinner`, `LivePhase` (`PLAYING`), `PlayerResult` (+ `ABORTED`); `games`: `mode, rated, timeClass, whitePlayerId, blackPlayerId, botElo, startPly, studySeconds, moves, moveClocksMs, plyCount, fen, whiteTimeMs, blackTimeMs, clockRunning, phase, phaseEndsAt, endMethod, outcome, pgn, rematchOfId, whiteName, blackName, whiteRating, blackRating, whiteTitle, blackTitle, source, externalId, externalUrl, meta`; unique `games_source_externalId_key`; `GamePlayer` (PK `(gameId, userId)`, unique `(gameId, color)`, `color, mode, timeClass, rated, result, endedAt, opponentUserId, opponentName, opponentRating, ratingBefore, ratingAfter, ratingDelta, tournamentId, source`); index `game_players_userId_endedAt_gameId_idx`; `IdempotencyKey` if P1 did not ship it | partial `games_open_idx`, `games_white_player_idx`, `games_black_player_idx`, `games_rematch_of_idx`; `fillfactor 90` on `games`; `lz4` on `moves`, `pgn`; `protected-indexes.txt` + `scripts/db/check-drift.ts` created (P2 §6.3) |
| **M3** | P3 | `Job` (+ `fairSeq`, `lastKickAt`, `JobStatus.WAITING`, JobKind M3 set incl. `DAILY_PLAN`); `GameAnalysis` (+ `readyMs` for the review-ready SLO audit); `PlayerReview` (PK `(gameId, color)`; `content` with `moments[]`, `progress` with `bankOptOut`, `textStatus`, `model`, `promptVersion`); `Share` (`ShareKind`); `LegendComparison` (`ComparisonStatus`); `games."analysisStatus"`, `games."ecoCode"`, `games."openingName"`; `game_players` analysis outputs (`accuracy, headline, momentsCount, counts, phaseAccuracy`) and `"ecoCode"` | `jobs_ready_idx (priority DESC, "fairSeq", "runAt") WHERE status = 'QUEUED'`, `jobs_running_idx`, `jobs_user_idx`; the optional `rc_apply_analysis(jsonb)` SQL function (§7.2) |
| **M4** | P4 | `LinkedAccount`, `ImportCursor`, `ImportRun`; `game_players."linkedAccountId"` (FK `ON DELETE SET NULL`, `NOT VALID`, validated in its own file) + partial `game_players_linked_account_idx`; **`User.timeZone`** (`@default("UTC") @db.VarChar(64)`); onboarding columns (`onboardingStep`, `ratingBand`, `goals`); **`AuditLog`** + `AuditCategory` + `AuditActor` (index `(category, at DESC)` and `(targetType, targetId)`); billing timestamps `membershipEndedAt`, `lastPaymentFailedAt`, `lastPaymentFailureReason` | `linked_accounts_verified_key (provider, externalId) WHERE "verifiedAt" IS NOT NULL`; `m4a` not needed (kinds exist since M3) |
| **M5 / m5a** | P5 | `Mistake`, `MistakeOccurrence`, `TrainingCard`, `TrainingAttempt`, `TrainingSession`, `TrainingDay`, `ThemeMastery`, `TrainingProfile`, `Report` (+ `ReportTarget`, `ReportReason`, `ReportStatus`); `game_players."bankVersion"`; `EXTRACT_MISTAKES` (m5a) | `training_cards_userId_deck_due_idx`, `training_attempts_puzzle_idx`, `training_sessions_userId_startedAt_idx`, `reports_reporterId_createdAt_idx` (durable limits); `fillfactor 80` on `training_days`. **No `KeyMoment`**, no `_m5v_validate_key_moment_fk` |
| **M6** | P6 | `WeaknessSnapshot` (PK `(userId, weekStart)`); `game_players.stats SmallInt[] default []`, `"errorThemes" String[] default []`, `errorLog`, `errorThemeN`, `weaknessInputsV`; `TrainingProfile.weaknessVersion` | — |
| **M7** | P7 | `CoachThread`, `CoachMessage` (unique `(userId, clientId)`; partial unique one `STREAMING` per user), `CoachUsageDay`, `CoachSpendDay` | `coach_messages_streaming_key`; BRIN on `coach_messages.createdAt` for retention |
| **M8 / m8a** | P8 | `Lesson`, `LessonStep`, `LessonProgress` (+ `runId`, `lastSeq`); `ChessPosition."practiceOrder"`, `"availableFrom"`, slugs, `explanationUrl`, `hasExplanation`; `Game."seriesNo" SmallInt default 1`; `SessionKind.OPENINGS` (m8a); contract C5 (P8 explanation JSON) | — |
| **M9** | P9 | `Challenge` (+ enums), `PlayerRating`, `UserSettings` (`prefs`, `prefsVersion`, derived minute columns, `emailOptIns`, `consent`); `game_players_h2h_idx ON game_players ("userId", "opponentUserId", "endedAt" DESC) WHERE "opponentUserId" IS NOT NULL` | — |
| **M10 / m10a** | P10 | `Notification`, `PushSubscription`, `UsernameHistory`, `UserBlock`, `AccountDeletion`, `DataExportJob`, `UserMilestone`; `UserSettings.pushOptIns`; `users.visibility`; `TournamentParticipant."displayName"` (or P12, first to merge); FK swaps on `games.creatorId`/`opponentId`, `tournaments.createdByUserId`, `tournament_participants.userId` to `SET NULL` (`NOT VALID` + validate); `NotificationKind`, `DeliveryStatus`, `ProfileVisibility`; m10a JobKinds | partial `notifications_pending_idx`, `notifications_sent_day_idx (sentAt) WHERE status = 'SENT'` (email budget), the `creatorId` nullable contract (C3) |
| **M11** | P11 | `SupportRequest` (`support_requests`) | — |
| **M12 / m12a** | P12 | `Tournament` arena columns (`slug NOT NULL` contract C12, `inviteCode`, `visibility`, `hostUserId`, `participantCount`, `standingsVersion`, `scoring`, `finalStandings`, …), `TournamentPosition`, `TournamentParticipant` arena fields; `games."tournamentPositionOrder"`, `game_players."tournamentPoints"`, `"tournamentFire"`; `ChessPosition.status PositionStatus`; `TOURNAMENT_STARTING` (m12a) | partial `games_tournament_live_idx`, `game_players_tournament_idx`. Ships unconditionally (the early-launch option no longer depends on it, because `AuditLog` moved to M4) |
| **m13a** | P13 | `BACKUP` JobKind | production migrates in P13 after a rehearsal (`01-architecture.md` §4.6) |

#### 5.0.2 Known differences between this ledger and revision 1's blocks below

The blocks in §5.1–§5.11 are revision 1's validated target, kept for column-level detail and renamed to the canonical names where a plain rename was enough. Where a block still disagrees with §5.0.1 or with the owning phase spec, **the phase spec wins**. The differences that a rename cannot fix:

- §5.2 "M1b settings shell": `UserSettings` ships in **M9** (P9), and `User.timeZone` in **M4**.
- §5.3 M2: the `Game`/`GamePlayer` block is replaced by a pointer to P2 §6.2; `PlayerRating` and `Challenge` move to **M9**, `Share` to **M3**; `ecoCode`/`openingName` move to M3, `seriesNo` to M8, the tournament columns to M12, `stats`/`errorThemes` to M6, `linkedAccountId` to M4.
- §5.6 M5: the cards are `training_cards`/`training_attempts` with P5's columns (`reviewedAt`, `grade`, `firstTry`, …); the `AuditLog` and report details follow P5 §6.
- §5.9 "M8" covers allocation **M8** (lessons, legend practice) **and M12** (tournament arena); §5.10 "M9" is allocation **M10** (identity, notifications, deletion), and its `ConsentRecord` model is folded into `UserSettings.consent` (P9/P11).
- `schema.target.prisma` predates all of the above; regenerate it from the phase specs before using it as a reference.

#### 5.0.3 Crosswalk from revision 1's migration ids

| Revision 1 | Allocation id | Revision 1 | Allocation id |
|---|---|---|---|
| M1 | M1 | M6 | M6 |
| M1b | M9 (`UserSettings`), M4 (`timeZone`) | M7 | M7 |
| M2 | M2 (+ M3, M4, M6, M8, M9, M12 for moved columns) | M8 | M8 + M12 |
| M3 | M3 | M9 | M10 (+ M9 for challenges and ratings) |
| M4 | M4 | C1–C7 | unchanged ids, scheduled by the owning phase |
| M5 | M5 | | |

### 5.1 M1 (P1): hardening

Fixes the billing races (audit-db DB-07), adds webhook idempotency and the trial ledger, the audit log and the shared rate limiter, and puts a partial unique index on the matchmaking queue (DB-12).

**`User` additions:**

```prisma
  // M1 billing hardening
  /// Provider-side time of the snapshot last applied (webhook timestamp). Compare-and-set key.
  subscriptionSourceAt     DateTime?
  /// Set when a checkout with trial_period_days is created; closes the two-tab double-trial race.
  trialOfferedAt           DateTime?
  trialReminderSentAt      DateTime?
  pendingCheckoutSessionId String?   @db.VarChar(80)
  pendingCheckoutPlan      String?   @db.VarChar(16)
  pendingCheckoutAt        DateTime?
  lastCheckoutSource       String?   @db.VarChar(16)
  membershipEndedAt        DateTime?
  scheduledPlanKey         String?   @db.VarChar(32)
  scheduledChangeAt        DateTime?
  pausedAt                 DateTime?
  pausedUntil              DateTime?
  lastPaymentFailedAt      DateTime?
  lastPaymentFailureReason String?   @db.VarChar(120)
```

**New models:**

```prisma
/// M1. Webhook idempotency + short-lived debug copy (Dodo, Clerk).
model WebhookEvent {
  provider    String    @db.VarChar(16)
  eventId     String    @db.VarChar(100)
  type        String    @db.VarChar(64)
  eventTime   DateTime?
  userId      BigInt?
  status      String?   @db.VarChar(16)
  error       String?   @db.VarChar(500)
  /// Nulled after 7 days, row deleted after 30 days.
  payload     Json?
  receivedAt  DateTime  @default(now())
  processedAt DateTime?

  @@id([provider, eventId])
  @@map("webhook_events")
}

/// M1. One free trial per person, surviving account deletion. No FK, no PII.
model TrialLedger {
  /// sha256(pepper || normalised email)
  emailHash    String   @id @db.Char(64)
  /// sha256(pepper || provider:username) for linked chess accounts
  handleHashes String[] @default([])
  firstTrialAt DateTime @default(now())

  @@map("trial_ledger")
}

/// M1. Generic Idempotency-Key store for create endpoints (games, challenges, shares, checkout).
model IdempotencyKey {
  /// "<userRef>:<scope>:<client key>"
  key         String   @id @db.VarChar(120)
  requestHash String   @db.Char(64)
  status      Int      @db.SmallInt
  response    Json?
  createdAt   DateTime @default(now())
  expiresAt   DateTime

  @@map("idempotency_keys")
}

/// M1. Created as UNLOGGED by hand (resets on compute restart; fine for limits).
model RateLimitBucket {
  key     String   @id @db.VarChar(120)
  count   Int
  resetAt DateTime

  @@map("rate_limit_buckets")
}

/// M1. Append-only audit trail. No FK: rows outlive deleted users. Never store email or tokens in meta.
model AuditLog {
  id          BigInt        @id @default(autoincrement())
  at          DateTime      @default(now())
  category    AuditCategory
  /// dotted verb, e.g. "account.username_changed", "billing.snapshot_applied", "admin.position_updated"
  action      String        @db.VarChar(64)
  actorKind   AuditActor
  actorUserId BigInt?
  targetType  String?       @db.VarChar(32)
  /// referenceId / slug / provider id — never a raw email
  targetId    String?       @db.VarChar(64)
  requestId   String?       @db.VarChar(40)
  meta        Json?

  @@index([category, at(sort: Desc)])
  @@index([targetType, targetId])
  @@map("audit_logs")
}
```

**Raw SQL:**

```sql
SET lock_timeout = '5s';
-- Prisma emits CREATE TABLE "rate_limit_buckets"; hand-edit it to:
CREATE UNLOGGED TABLE "rate_limit_buckets" ("key" VARCHAR(120) NOT NULL, "count" INTEGER NOT NULL,
  "resetAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("key"));
CREATE INDEX IF NOT EXISTS users_trial_reminder_idx ON users ("trialEndsAt")
  WHERE "trialReminderSentAt" IS NULL AND "trialEndsAt" IS NOT NULL;
-- Data fix needed so the unique index can build (it only expires stale searches; owner confirms):
UPDATE matchmaking_queue SET status = 'EXPIRED' WHERE status = 'SEARCHING' AND "expiresAt" < now();
CREATE UNIQUE INDEX IF NOT EXISTS matchmaking_queue_one_searching ON matchmaking_queue ("userId") WHERE status = 'SEARCHING';
```

| Index | Columns / predicate | Query it serves |
|---|---|---|
| `webhook_events_pkey` | `(provider, eventId)` | The first statement of `app/api/webhook/dodo-payments/route.ts` and the new `/api/webhook/clerk`: `INSERT … ON CONFLICT DO NOTHING RETURNING 1`. No row returned means a redelivery, answered 200 with no work |
| `trial_ledger_pkey` | `emailHash` | `isTrialEligible` (`apps/web/lib/billing/trial-rules.ts:22`) at checkout: `SELECT 1 FROM trial_ledger WHERE "emailHash" = $1 OR "handleHashes" && $2`. The table holds one row per trial ever started, so the array check is a sequential scan of a tiny table |
| `idempotency_keys_pkey` | `key` | Create endpoints: `INSERT … ON CONFLICT DO NOTHING`; on conflict, compare `requestHash` and replay `response` |
| `rate_limit_buckets_pkey` | `key` | One upsert per check: `INSERT … ON CONFLICT (key) DO UPDATE SET count = CASE WHEN b."resetAt" < now() THEN 1 ELSE b.count + 1 END, "resetAt" = CASE … END RETURNING count, "resetAt"` |
| `audit_logs_category_at_idx` | `(category, at DESC)` | `V4Admin` activity feed: `WHERE category = ANY($1) ORDER BY at DESC LIMIT 20` |
| `audit_logs_targetType_targetId_idx` | `(targetType, targetId)` | Admin detail history ("this tournament / position / user") and support lookups |
| `users_trial_reminder_idx` (raw) | `(trialEndsAt) WHERE trialReminderSentAt IS NULL AND trialEndsAt IS NOT NULL` | Daily cron `/api/cron/trial-reminders` (`implementation-plan.md:50`): `WHERE "trialReminderSentAt" IS NULL AND "trialEndsAt" BETWEEN now() + '1 day' AND now() + '2 days'`, then `UPDATE … SET "trialReminderSentAt" = now() WHERE id = $1 AND "trialReminderSentAt" IS NULL` (idempotent) |
| `matchmaking_queue_one_searching` (raw) | `(userId) WHERE status = 'SEARCHING'` | Turns the double-tab duplicate search race (`matchmaking.service.ts:43-53` then `:90`) into P2002, mapped to "already searching". Dropped with the table in C2 |

**Write semantics this enables:**

```ts
// Billing snapshot compare-and-set (replaces the unconditional write at apps/web/lib/billing/entitlement.ts:99).
const r = await prisma.user.updateMany({
  where: { id: user.id, OR: [{ subscriptionSourceAt: null }, { subscriptionSourceAt: { lte: eventTime } }] },
  data: { ...fields, subscriptionSourceAt: eventTime },
});  // r.count === 0 → an older snapshot lost the race; nothing to do. API refreshes without a provider timestamp do not write.

// One trial per person, race-free across two checkout tabs (apps/web/app/api/checkout/route.ts:94-99).
const offered = await prisma.user.updateMany({
  where: { id: user.id, trialStartedAt: null, trialOfferedAt: null }, data: { trialOfferedAt: new Date() } });
const sendTrial = offered.count === 1 && !(await ledgerHas(emailHash(user.email)));
```

### 5.2 Revision 1's "M1b settings shell" (withdrawn: `UserSettings` ships in M9 with P9, `User.timeZone` in M4 with P4)

```prisma
  // M1b (Phase 1) locale
  /// IANA zone from Intl on first load; drives training days, coach day caps and reminders.
  timeZone String @default("UTC") @db.VarChar(64)   // ships in M4 (P4), not M1b

/// Phase 1. Synced preferences (zod PreferencesV1 in packages/db/json/preferences.ts). 1:1 with User.
model UserSettings {
  userId              BigInt   @id
  prefs               Json     @default("{}")
  prefsVersion        Int      @default(0)
  /// Derived on every PATCH and by the nightly DST pass. Read by the reminder tick only.
  reminderUtcMinute   Int?     @db.SmallInt
  quietStartUtcMinute Int?     @db.SmallInt
  quietEndUtcMinute   Int?     @db.SmallInt
  /// Derived: NotificationKind keys with email on (weekly digest selection).
  emailOptIns         String[] @default([])
  /// Latest cookie consent {v, analytics, replay, marketing, at}; history in consent_records.
  consent             Json?
  updatedAt           DateTime @updatedAt
  user                User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("user_settings")
}
```

**Raw SQL:**

```sql
CREATE INDEX IF NOT EXISTS user_settings_reminder_idx ON user_settings ("reminderUtcMinute") WHERE "reminderUtcMinute" IS NOT NULL;
ALTER TABLE user_settings SET (fillfactor = 80);
```

| Index | Query it serves |
|---|---|
| `user_settings_pkey (userId)` | `GET /api/me` and the `settings/layout.tsx` loader (one PK read); `PATCH /api/me/preferences` (`UPDATE … SET prefs = $merged, "prefsVersion" = "prefsVersion" + 1, …derived`) |
| `user_settings_reminder_idx` (raw) | Reminder tick every 15 min (worker, inv-acct §3.5): `WHERE "reminderUtcMinute" BETWEEN $a AND $b`, then an EXISTS on due cards (§5.6) and a quiet-hours check in code |

`UserSettings` is created lazily on first PATCH. The read path falls back to the zod defaults when the row is missing, so the defaults are never written for every user.

### 5.3 M2a / M2 / M2v (P2): the live game model

**M2a** (its own file, so later files can use the value):

```sql
ALTER TYPE "GameStatus" ADD VALUE IF NOT EXISTS 'ABORTED';
```

**M2: `Game` additions and `GamePlayer`** are defined by **`docs/plan/phase-02-board-and-live-game.md` §6.2** (authoritative) and summarised in the ledger (§5.0.1). In short: P2 adds the typed play columns (`mode`, `rated`, `timeClass`, `whitePlayerId`, `blackPlayerId`, `botElo`, `startPly`, `studySeconds`, `moves`, `moveClocksMs`, `plyCount`, `fen`, `whiteTimeMs`, `blackTimeMs`, `clockRunning`, `phase`, `phaseEndsAt`, `endMethod`, `outcome`, `pgn`, `rematchOfId`), the display snapshot (`whiteName`, `blackName`, `whiteRating`, `blackRating`, `whiteTitle`, `blackTitle`; filled at creation and join, bots get "Engine {botElo}"), the source and external identity (`source`, `externalId`, `externalUrl`) and `meta` (`GameMetaV1`); and `GamePlayer` with PK `(gameId, userId)`, unique `(gameId, color)`, `endedAt`, the opponent snapshot and `ratingBefore`/`ratingAfter`/`ratingDelta`. `games."expiresAt"` stays `NOT NULL`; the P4 import insert sets it to the game's end time.

Columns revision 1 put in M2 that now belong to later migrations: `games."analysisStatus"`, `"ecoCode"`, `"openingName"` and `game_players` analysis outputs (M3); `game_players."linkedAccountId"` (M4); `game_players.stats`, `"errorThemes"` (M6); `games."seriesNo"` (M8, replacing `parentGameId`, which is P2's `rematchOfId`); `games."tournamentPositionOrder"`, `game_players."tournamentPoints"`, `"tournamentFire"` (M12). Revision 1's `games."playedAt"` does not exist: the game end time is the existing `"completedAt"`, and the per-member time is `game_players."endedAt"`.

**Models revision 1 put in M2 that now ship later** (blocks kept below for column detail): `PlayerRating` and `Challenge` → M9 (P9); `Share` → M3 (P3).

```prisma

/// M2 (Phase 2; owner decision Q7). Glicko-2 per pool for REPLAY rated games.
model PlayerRating {
  userId     BigInt
  pool       TimeClass
  rating     Float     @default(1500) @db.Real
  rd         Float     @default(350) @db.Real
  volatility Float     @default(0.06) @db.Real
  games      Int       @default(0)
  peak       Int?      @db.SmallInt
  peakAt     DateTime?
  /// "chesscom" | "lichess" | "self" | null
  seededFrom String?   @db.VarChar(12)
  updatedAt  DateTime  @updatedAt
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([userId, pool])
  @@map("player_ratings")
}

/// M2 (Phase 2). Friend challenge links (/play/friend/<code>).
model Challenge {
  id               BigInt          @id @default(autoincrement())
  /// 8 chars Crockford base32
  code             String          @unique @db.VarChar(10)
  creatorId        BigInt
  startFrom        ChallengeStart
  chessPositionId  BigInt?
  shareId          BigInt?
  startFen         String
  initialSeconds   Int
  incrementSeconds Int
  /// "white" | "black" | "random" (resolved at accept)
  creatorColor     String          @db.VarChar(6)
  rated            Boolean         @default(false)
  status           ChallengeStatus @default(OPEN)
  expiresAt        DateTime
  acceptedById     BigInt?
  acceptedAt       DateTime?
  declinedAt       DateTime?
  gameId           BigInt?         @unique
  createdAt        DateTime        @default(now())
  creator          User            @relation("ChallengesCreated", fields: [creatorId], references: [id], onDelete: Cascade)
  acceptedBy       User?           @relation("ChallengesAccepted", fields: [acceptedById], references: [id], onDelete: SetNull)
  game             Game?           @relation(fields: [gameId], references: [id], onDelete: SetNull)

  @@index([creatorId, status])
  @@map("challenges")
}

/// M2 (POSITION, /s/<code>) + M3 (REVIEW, /r/<code>). One public-link table.
model Share {
  id              BigInt         @id @default(autoincrement())
  code            String         @unique @db.VarChar(10)
  kind            ShareKind
  /// SetNull: position shares outlive the account; REVIEW shares are deleted by the deletion flow
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
  /// REVIEW: frozen public payload (moves, labels, accuracy, moment) so the public page needs no joins
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

**Raw SQL (M2):**

```sql
SET lock_timeout = '5s';
ALTER TABLE games ALTER COLUMN "expiresAt" DROP NOT NULL;                       -- metadata only
-- Prisma emits ADD CONSTRAINT "games_chessPositionId_fkey" …; hand-edit it to NOT VALID:
ALTER TABLE games ADD CONSTRAINT "games_chessPositionId_fkey" FOREIGN KEY ("chessPositionId")
  REFERENCES chess_positions(id) ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
CREATE INDEX IF NOT EXISTS games_open_idx            ON games (status) WHERE status IN ('WAITING_FOR_OPPONENT','IN_PROGRESS');
CREATE INDEX IF NOT EXISTS games_tournament_live_idx ON games ("tournamentId") WHERE status = 'IN_PROGRESS';
CREATE INDEX IF NOT EXISTS games_white_player_idx      ON games ("whitePlayerId") WHERE "whitePlayerId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS games_black_player_idx      ON games ("blackPlayerId") WHERE "blackPlayerId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS games_rematch_of_idx          ON games ("rematchOfId") WHERE "rematchOfId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS game_players_h2h_idx            ON game_players ("userId","opponentUserId","endedAt" DESC) WHERE "opponentUserId" IS NOT NULL;   -- M9 (P9), not M2
CREATE INDEX IF NOT EXISTS game_players_tournament_idx     ON game_players ("tournamentId","userId") WHERE "tournamentId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS game_players_linked_account_idx ON game_players ("linkedAccountId") WHERE "linkedAccountId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS challenges_open_idx  ON challenges ("expiresAt") WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS shares_owner_idx     ON shares ("ownerId","createdAt" DESC) WHERE "ownerId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS shares_game_idx      ON shares ("gameId") WHERE "gameId" IS NOT NULL;
ALTER TABLE games ALTER COLUMN moves SET COMPRESSION lz4;
ALTER TABLE games ALTER COLUMN "moveClocksMs" SET COMPRESSION lz4;
ALTER TABLE shares ALTER COLUMN snapshot SET COMPRESSION lz4;
```

**M2v** (its own file, after the B0 orphan check, §11.6): `ALTER TABLE games VALIDATE CONSTRAINT "games_chessPositionId_fkey";`

| Index | Columns / predicate | Query it serves |
|---|---|---|
| `games_source_externalId_key` | unique `(source, externalId)` (NULLs never collide, so REPLAY rows are unaffected) | Import dedupe: `INSERT INTO games … ON CONFLICT (source, "externalId") DO UPDATE SET "whitePlayerId" = COALESCE(games."whitePlayerId", EXCLUDED."whitePlayerId"), "blackPlayerId" = COALESCE(…) RETURNING id` (a second member importing the same game attaches to it) |
| `games_open_idx` (raw) | `(status) WHERE status IN (WAITING_FOR_OPPONENT, IN_PROGRESS)` | Socket boot restore (`DB/src/live/restore.ts`, direct, B4) (audit-socket §18.4); housekeeping expiry and abandoned sweeps (§10.4); "resume my unfinished legend game" (inv-play-b A4/A5: `WHERE status = 'IN_PROGRESS' AND "creatorId" = $me AND mode = 'LEGEND_BOT' AND "chessPositionId" = $p`). The live set is small; the predicate column `status` does not change during checkpoints, so checkpoint updates stay HOT-eligible |
| `games_tournament_live_idx` (raw) | `(tournamentId) WHERE status = 'IN_PROGRESS'` | Arena top board and live games (`app/api/tournament/[tournamentReferenceId]/route.ts:80-93`) until pairing moves to the socket server |
| `games_white_player_idx`, `games_black_player_idx` (raw) | partial `WHERE … IS NOT NULL` | The `SetNull` FK on user deletion, and anonymisation (`UPDATE games SET "whiteName" = 'Deleted player' WHERE "whitePlayerId" = $u`) |
| `games_rematch_of_idx` (raw) | `(rematchOfId) WHERE NOT NULL` | The `SetNull` FK when a game is deleted (an import purge would otherwise scan `games`); "Rematch" / "Next position" chains |
| `game_players_pkey` | `(gameId, color)` | Participant check on every review, coach and game route (`WHERE "gameId" = $g`, ≤ 2 rows); finish-transaction insert; the `PlayerReview` FK |
| `game_players_userId_endedAt_gameId_idx` | `(userId, endedAt DESC, gameId DESC)` | `V3Home` recent games (`LIMIT 8`); `V3GamesArchive` / `V4ProfileGames` keyset `WHERE "userId" = $1 AND ("endedAt", "gameId") < ($c1, $c2) ORDER BY "endedAt" DESC, "gameId" DESC LIMIT 31`, with result, source, time class, ECO and moments filters applied in-row; per-source tab counts (`GROUP BY source`); profile stats (W/L/D per time class, 90 days); the "this week" strip; the rating chart (`rated AND "timeClass" = $pool`); Weakness input (`accuracy IS NOT NULL AND "endedAt" >= $since`); the user-delete cascade |
| `game_players_h2h_idx` (raw) | `(userId, opponentUserId, endedAt DESC) WHERE opponentUserId IS NOT NULL` | `V4ProfileOther` head-to-head |
| `game_players_tournament_idx` (raw) | `(tournamentId, userId) WHERE NOT NULL` | Arena "your games here", and the results "your placement" detail (`V4TournamentResults`) |
| `game_players_linked_account_idx` (raw) | `(linkedAccountId) WHERE NOT NULL` | Disconnect with "also delete the imported games" (`IMPORT_PURGE`); squatter take-over; the `SetNull` FK |
| `player_ratings_pkey` | `(userId, pool)` | The rating range at queue join (read by the internal route that mints the socket token claims); the Glicko update in the finish transaction (`… WHERE ("userId", pool) IN (($w,$p),($b,$p)) FOR UPDATE`) |
| `challenges_code_key` | `code` | Accept: `UPDATE challenges SET status = 'ACCEPTED', "acceptedById" = $me, "acceptedAt" = now() WHERE code = $c AND status = 'OPEN' AND "expiresAt" > now() AND "creatorId" <> $me RETURNING *`. Zero rows means re-read and report already_started, expired, cancelled or own_link |
| `challenges_open_idx` (raw) | `(expiresAt) WHERE status = 'OPEN'` | Hourly expiry: `UPDATE … SET status = 'EXPIRED' WHERE status = 'OPEN' AND "expiresAt" < now()` |
| `challenges_creatorId_status_idx` | `(creatorId, status)` | Play hub Friend tab "your open challenge"; the user-delete cascade |
| `challenges_gameId_key` | unique `gameId` | "Watch the game" from the challenge share screen |
| `shares_code_key` | `code` | `/s/<code>` and `/r/<code>` (ISR; `revalidateTag('share:' + code)` on revoke) |
| `shares_owner_idx` (raw) | `(ownerId, createdAt DESC) WHERE NOT NULL` | The owner's shares (revoke); the `SetNull` FK |
| `shares_game_idx` (raw) | `(gameId) WHERE NOT NULL` | The cascade when a game is deleted |

### 5.4 M3 (P3): analysis and review

```prisma
/// Phase 3. One queue for every background job on the OCI worker (SKIP LOCKED claim, push wake-up).
model Job {
  id          BigInt    @id @default(autoincrement())
  kind        JobKind
  status      JobStatus @default(QUEUED)
  /// 100 = viewer waiting (just-finished / opened), 50 = newest imported, 10 = backlog, 0 = housekeeping
  priority    Int       @default(10) @db.SmallInt
  /// "analyze:<gameId>", "import:<linkedAccountId>", "weakness:<userId>:<hour>"
  dedupeKey   String?   @unique @db.VarChar(120)
  userId      BigInt?
  gameId      BigInt?
  payload     Json      @default("{}")
  result      Json?
  runAt       DateTime  @default(now())
  attempts    Int       @default(0) @db.SmallInt
  maxAttempts Int       @default(4) @db.SmallInt
  lockedBy    String?   @db.VarChar(40)
  lockedAt    DateTime?
  lastError   String?   @db.VarChar(1000)
  createdAt   DateTime  @default(now())
  startedAt   DateTime?
  finishedAt  DateTime?

  @@map("jobs")
}

/// M3 (Phase 3). Packed engine facts for BOTH colours, one row per game (replaces per-ply MoveEval).
/// Array index i = ply offset from Game.startPly (0-based). Codecs live in packages/chess-analysis/codec.ts.
model GameAnalysis {
  gameId        BigInt     @id
  /// GRADING_VERSION; re-run when it changes
  version       Int        @db.SmallInt
  engine        String     @db.VarChar(32)
  nodesPass1    Int
  nodesPass2    Int
  evalSource    EvalSource @default(ENGINE)
  totalPlies    Int        @db.SmallInt
  gradedPlies   Int        @db.SmallInt
  failedAtPly   Int?       @db.SmallInt
  /// Length totalPlies+1, White POV, evals[0] = start position. cp clamped to ±9999; mate n = sign·(30000 − n)
  evals         Int[]      @db.SmallInt
  /// MoveCode per ply: best move in the position BEFORE the ply = from + 64·to + 4096·promo (0 = unknown, e.g. Lichess-eval imports)
  best          Int[]      @db.SmallInt
  /// JudgementCode per ply (append-only code table in packages/chess-analysis/codec.ts; 0 = ungraded)
  judgements    Int[]      @db.SmallInt
  /// LinesV1, flagged plies only (errors, brilliant/great, key moments): {"<ply>": ["<pv uci …>", "<alts uci …>"]}
  lines         Json?
  middlegamePly Int?       @db.SmallInt
  endgamePly    Int?       @db.SmallInt
  accuracyWhite Float?     @db.Real
  accuracyBlack Float?     @db.Real
  /// 12 counters each, indexed by JudgementCode
  countsWhite   Int[]      @db.SmallInt
  countsBlack   Int[]      @db.SmallInt
  createdAt     DateTime   @default(now())
  completedAt   DateTime?
  game          Game       @relation(fields: [gameId], references: [id], onDelete: Cascade)

  @@map("game_analyses")
}

/// M3 (Phase 3). Coach text + walkthrough state for one member side. Written lazily (on first open for imports).
model PlayerReview {
  gameId        BigInt
  color         String     @db.Char(1)
  /// ReviewContentV1 {summary:[{t,v}], phaseLine, isClean, bestPly, bestDecision, moments:[{ply, mistakeRef, ask, why:[{t,v}], plan:{…}}]}
  content       Json?
  /// PENDING | READY | FALLBACK
  textStatus    String     @default("PENDING") @db.VarChar(10)
  model         String?    @db.VarChar(40)
  promptVersion Int?       @db.SmallInt
  /// ReviewProgressV1 {momentIndex, results:{"<ply>":"FOUND"|"FOUND_RETRY"|"REVEALED"}, planChips:{…}}
  progress      Json?
  startedAt     DateTime?
  completedAt   DateTime?
  updatedAt     DateTime   @updatedAt
  gamePlayer    GamePlayer @relation(fields: [gameId, color], references: [gameId, color], onDelete: Cascade)

  @@id([gameId, color])
  @@map("player_reviews")
}
```

`Game.analysisStatus` ships in this migration. **`Opening` and `ChessPosition` additions:**

```prisma
// Opening
  // M3 (Phase 3): book detection + catalogue
  /// First four FEN fields after the line (transposition-safe lookup)
  epd            String? @db.VarChar(90)
  hasExplanation Boolean @default(false)
  explanationUrl String?
// ChessPosition
  // M3 catalogue (explanations to R2)
  hasExplanation      Boolean   @default(false)
  explanationUrl      String?
```

**Raw SQL:**

```sql
CREATE INDEX IF NOT EXISTS jobs_ready_idx   ON jobs (priority DESC, "runAt") WHERE status = 'QUEUED';
CREATE INDEX IF NOT EXISTS jobs_running_idx ON jobs ("lockedAt") WHERE status = 'RUNNING';
ALTER TABLE game_analyses  ALTER COLUMN lines   SET COMPRESSION lz4;
ALTER TABLE player_reviews ALTER COLUMN content SET COMPRESSION lz4;
```

| Index | Query it serves |
|---|---|
| `jobs_ready_idx` (raw) | Claim: `UPDATE jobs SET status = 'RUNNING', "lockedBy" = $1, "lockedAt" = now(), "startedAt" = now(), attempts = attempts + 1 WHERE id = (SELECT id FROM jobs WHERE status = 'QUEUED' AND "runAt" <= now() ORDER BY priority DESC, "runAt" LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id, kind, payload, "gameId", "userId"`. SKIP LOCKED is transaction-scoped and works through Neon's transaction-mode pooler (audit-db §5.2) |
| `jobs_running_idx` (raw) | Stale-lock recovery (every sweep): `UPDATE jobs SET status = 'QUEUED', "runAt" = now() + interval '1 min' WHERE status = 'RUNNING' AND "lockedAt" < now() - interval '10 min' AND attempts < "maxAttempts"` |
| `jobs_dedupeKey_key` | Idempotent enqueue that can re-prioritise or re-queue: `INSERT … ON CONFLICT ("dedupeKey") DO UPDATE SET priority = GREATEST(jobs.priority, EXCLUDED.priority), "runAt" = LEAST(jobs."runAt", EXCLUDED."runAt"), status = 'QUEUED', attempts = CASE WHEN jobs.status = 'QUEUED' THEN jobs.attempts ELSE 0 END WHERE jobs.status <> 'RUNNING'`. Opening a backlog game raises its priority from 10 to 100. A `version` bump re-queues a DONE row. Callers skip the enqueue when `games."analysisStatus" = 'DONE'` at the current version |
| `game_analyses_pkey (gameId)` | `GET /api/review/[ref]` (one PK read); the worker upsert `ON CONFLICT ("gameId") DO UPDATE` when `version` changes |
| `player_reviews_pkey (gameId, color)` | The same review read; lazy text generation (`REVIEW_TEXT`); walkthrough progress `PATCH` |
| `openings_epd_idx` | Opening name for a position (coach facts, and imports without an ECO header): `WHERE epd = $1`. Book detection runs in memory in the worker from `SELECT epd FROM openings WHERE "isActive"` (about 30k line EPDs) |

### 5.5 M4 (P4): import and onboarding (+ `AuditLog`, `User.timeZone`)

```prisma
/// Phase 4. Replaces ChessComProfile. Unlinking deletes the row (games stay unless purge requested).
model LinkedAccount {
  id                BigInt        @id @default(autoincrement())
  userId            BigInt
  provider          ChessProvider
  /// chess.com player_id / lichess id (stable across renames)
  externalId        String        @db.VarChar(64)
  username          String        @db.VarChar(40)
  usernameLower     String        @db.VarChar(40)
  displayName       String?       @db.VarChar(80)
  avatarUrl         String?
  /// RatingsV1 {rapid:{rating,best,games}, blitz…}
  ratings           Json?
  /// Ownership proof. Lichess OAuth sets it at link; Chess.com via the profile-location code (Q18).
  verifiedAt        DateTime?
  verifyCode        String?       @db.VarChar(16)
  status            LinkStatus    @default(ACTIVE)
  importState       ImportState   @default(IDLE)
  importDone        Int           @default(0)
  importTotal       Int?
  importedCount     Int           @default(0)
  skippedCount      Int           @default(0)
  autoImport        Boolean       @default(true)
  nextAutoSyncAt    DateTime?
  nextAllowedSyncAt DateTime?
  lastSyncAt        DateTime?
  lastSyncOkAt      DateTime?
  /// {code, message, at, retryAt?}
  lastError         Json?
  /// Lichess only. AES-256-GCM: keyId(1) | iv(12) | ciphertext | tag(16); AAD = id. Globally omitted.
  accessTokenEnc    Bytes?
  tokenScopes       String?       @db.VarChar(120)
  tokenExpiresAt    DateTime?
  linkedAt          DateTime      @default(now())
  updatedAt         DateTime      @updatedAt
  user              User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  cursor            ImportCursor?
  gamePlayers       GamePlayer[]

  @@unique([userId, provider])
  @@index([provider, usernameLower])
  @@map("linked_accounts")
}

/// Phase 4. Incremental import position, 1:1 with LinkedAccount (kept apart so /api/me stays narrow).
model ImportCursor {
  linkedAccountId  BigInt        @id
  provider         ChessProvider
  /// Chess.com: {"2026/10": {etag, lastModified, done, games}}
  archives         Json?
  /// Lichess: createdAt (ms) of the newest imported game; next run uses since = value + 1
  lichessSinceMs   BigInt?
  /// Oldest game kept by the first backfill (12 months / newest N)
  oldestImportedAt DateTime?
  seen             Int           @default(0)
  skippedVariants  Int           @default(0)
  updatedAt        DateTime      @updatedAt
  linkedAccount    LinkedAccount @relation(fields: [linkedAccountId], references: [id], onDelete: Cascade)

  @@map("import_cursors")
}

// User: onboarding (v3pub boards: welcome → link → confirm → level → goals → plan → activating → done)
  // M4 (Phase 4) onboarding
  onboardingStep   OnboardingStep   @default(WELCOME)
  onboardedAt      DateTime?
  ratingBand       RatingBand?
  ratingBandSource String?          @db.VarChar(24)
  initialRating    Int?             @db.SmallInt
  goals            OnboardingGoal[] @default([])
  dailyMinutes     Int?             @db.SmallInt
  signupSource     String?          @db.VarChar(200)
```

**Raw SQL:**

```sql
CREATE UNIQUE INDEX IF NOT EXISTS linked_accounts_verified_key ON linked_accounts (provider, "externalId") WHERE "verifiedAt" IS NOT NULL;
CREATE INDEX IF NOT EXISTS linked_accounts_autosync_idx ON linked_accounts ("nextAutoSyncAt") WHERE "autoImport" AND status = 'ACTIVE';
```

| Index | Query it serves |
|---|---|
| `linked_accounts_userId_provider_key` | `/api/me` (`linkedAccounts` select), the `V4SettingsConnected` cards, link upsert, `DELETE /api/accounts/{provider}` |
| `linked_accounts_verified_key` (raw) | At most one verified owner per external account (Q18); the take-over check |
| `linked_accounts_provider_usernameLower_idx` | Lookup conflict "linked elsewhere": `WHERE provider = $p AND "usernameLower" = $u AND "userId" <> $me` |
| `linked_accounts_autosync_idx` (raw) | Nightly auto-import scheduler (worker, every 15 min): `WHERE "autoImport" AND status = 'ACTIVE' AND "nextAutoSyncAt" <= now() ORDER BY "nextAutoSyncAt" LIMIT 50` → enqueue `IMPORT_SYNC` |
| `import_cursors_pkey` | Read and write once per import batch |

**Import write per batch** (worker, one transaction per 50 games; one Lichess or Chess.com request in flight globally, R-LI-06 / R-CC-02):

1. `INSERT INTO games … ON CONFLICT (source, "externalId") DO UPDATE … RETURNING id` (multi-row).
2. `INSERT INTO game_players … ON CONFLICT DO NOTHING`.
3. `UPDATE linked_accounts SET "importDone" = …, "importedCount" = …, "skippedCount" = …`.
4. `UPDATE import_cursors SET archives = … / "lichessSinceMs" = …`.

That is 4 statements per 50 games. The newest 50 games are then enqueued as `ANALYZE_GAME` with priority 50 (`implementation-plan.md:131`).

### 5.6 M5 (P5): Mistake Bank, puzzles, FSRS

```prisma
/// M5 (Phase 5). A trainable position from the user's own games, deduped by (user, position, best move).
model Mistake {
  id               BigInt              @id @default(autoincrement())
  referenceId      String              @unique @default(cuid())
  userId           BigInt
  /// 64-bit hash of the EPD (placement, side, castling, ep) of the position before the user's move
  epdHash          BigInt
  color            String              @db.Char(1)
  /// Lichess-CSV shape: fen = position before the opponent's setup move (or pos_i when ply < 2)
  fen              String
  setupUci         String?             @db.VarChar(5)
  /// "best reply best …" after the setup move, odd length, space-separated UCI
  solution         String              @db.VarChar(120)
  /// Other first moves accepted (within 2 Win% of best, other mates)
  accept           String?             @db.VarChar(60)
  playedUci        String              @db.VarChar(5)
  judgement        Judgement
  source           MistakeSource
  isPuzzle         Boolean
  /// winning-chance gap best − second (stored so the uniqueness threshold can change without engine work)
  uniquenessGap    Float?              @db.Real
  themes           String[]            @default([])
  primaryTheme     String              @db.VarChar(32)
  phase            GamePhase
  winBefore        Float               @db.Real
  winAfterPlayed   Float               @db.Real
  cpBest           Int?
  mateBest         Int?                @db.SmallInt
  timeClass        TimeClass?
  ecoCode          String?             @db.VarChar(3)
  moveNumber       Int                 @db.SmallInt
  occurrences      Int                 @default(1) @db.SmallInt
  /// Most recent occurrence, denormalised for list rows (no join). Plain column, maintained by the purge job.
  lastGameId       BigInt?
  lastPly          Int?                @db.SmallInt
  lastPlayedAt     DateTime
  lastOpponentName String              @db.VarChar(40)
  /// Only LLM-rewritten, verified texts are stored (MistakeTextV1). Template texts are computed at read time.
  texts            Json?
  textVerifiedAt   DateTime?
  hiddenAt         DateTime?
  createdAt        DateTime            @default(now())
  user             User                @relation(fields: [userId], references: [id], onDelete: Cascade)
  card             TrainingCard?
  occurrenceRows   MistakeOccurrence[]

  @@unique([userId, epdHash])
  @@index([userId, createdAt(sort: Desc)])
  @@map("mistakes")
}

/// M5. Every game/ply where a Mistake happened ("you've played this 3 times"). Cascades both ways.
model MistakeOccurrence {
  gameId    BigInt
  ply       Int     @db.SmallInt
  mistakeId BigInt
  game      Game    @relation(fields: [gameId], references: [id], onDelete: Cascade)
  mistake   Mistake @relation(fields: [mistakeId], references: [id], onDelete: Cascade)

  @@id([gameId, ply])
  @@index([mistakeId])
  @@map("mistake_occurrences")
}

/// M5. FSRS state (ts-fsrs Card). API ref = itemKey ("m_<mistakeRef>", "p_<puzzleId>", "o_<openingRef>").
model TrainingCard {
  id             BigInt           @id @default(autoincrement())
  userId         BigInt
  deck           TrainingDeck
  kind           TrainingItemKind
  itemKey        String           @db.VarChar(40)
  mistakeId      BigInt?          @unique
  puzzleId       String?          @db.VarChar(8)
  /// Plain column (openings are never deleted, only deactivated)
  openingId      BigInt?
  /// Snapshot for PUZZLE / OPENING cards so they render without the shards
  fen            String?
  solution       String?          @db.VarChar(120)
  orient         String?          @db.Char(1)
  puzzleRating   Int?             @db.SmallInt
  theme          String           @db.VarChar(32)
  phase          GamePhase?
  due            DateTime
  stability      Float            @default(0) @db.Real
  difficulty     Float            @default(0) @db.Real
  elapsedDays    Int              @default(0) @db.SmallInt
  scheduledDays  Int              @default(0) @db.SmallInt
  learningSteps  Int              @default(0) @db.SmallInt
  reps           Int              @default(0) @db.SmallInt
  lapses         Int              @default(0) @db.SmallInt
  state          CardState        @default(NEW)
  lastReview     DateTime?
  /// 0..5 dots, derived from stability on every write
  mastery        Int              @default(0) @db.SmallInt
  suspendedUntil DateTime?
  createdAt      DateTime         @default(now())
  updatedAt      DateTime         @updatedAt
  user           User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  mistake        Mistake?         @relation(fields: [mistakeId], references: [id], onDelete: Cascade)

  @@unique([userId, itemKey])
  @@index([userId, deck, due])
  @@map("training_cards")
}

/// M5. One row per graded (or practice) attempt; doubles as the FSRS review log. Append-only.
model TrainingAttempt {
  id              BigInt           @id @default(autoincrement())
  /// Browser UUID: idempotency + offline outbox replay
  clientAttemptId String           @unique @db.Uuid
  userId          BigInt
  /// Plain columns (history may outlive the card/session)
  cardId          BigInt?
  sessionId       BigInt?
  deck            TrainingDeck
  kind            TrainingItemKind
  puzzleId        String?          @db.VarChar(8)
  puzzleRating    Int?             @db.SmallInt
  theme           String           @db.VarChar(32)
  solved          Boolean
  firstTry        Boolean
  hintsUsed       Int              @default(0) @db.SmallInt
  wrongTries      Int              @default(0) @db.SmallInt
  solutionShown   Boolean          @default(false)
  timeMs          Int
  /// null = practice repeat (no FSRS update)
  grade           FsrsGrade?
  suggestedGrade  FsrsGrade?
  /// FSRS state AFTER this review (optimizer + audits)
  state           CardState?
  stability       Float?           @db.Real
  difficulty      Float?           @db.Real
  elapsedDays     Int?             @db.SmallInt
  scheduledDays   Int?             @db.SmallInt
  ratingBefore    Float?           @db.Real
  ratingAfter     Float?           @db.Real
  /// Client clock, clamped to [now − 7 d, now + 5 min]
  reviewedAt      DateTime
  user            User             @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, reviewedAt(sort: Desc)])
  @@map("training_attempts")
}

/// M5. A runner session (resume + summary). Pruned after 90 days.
model TrainingSession {
  id              BigInt        @id @default(autoincrement())
  referenceId     String        @unique @default(cuid())
  userId          BigInt
  kind            SessionKind
  status          SessionStatus @default(ACTIVE)
  source          String        @db.VarChar(24)
  theme           String?       @db.VarChar(32)
  size            Int           @db.SmallInt
  mix             Boolean       @default(false)
  countsTowardCap Boolean       @default(true)
  /// SessionItemsV1: ordered item refs incl. requeued AGAIN items
  items           Json
  day             DateTime      @db.Date
  total           Int           @default(0) @db.SmallInt
  solved          Int           @default(0) @db.SmallInt
  firstTry        Int           @default(0) @db.SmallInt
  withHint        Int           @default(0) @db.SmallInt
  startedAt       DateTime      @default(now())
  endedAt         DateTime?
  user            User          @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, startedAt(sort: Desc)])
  @@map("training_sessions")
}

/// M5. One row per user per LOCAL training day: caps, streak week strip, frozen daily plan.
model TrainingDay {
  userId        BigInt
  /// local date in User.timeZone, day starts at prefs.training.dayStartHour
  day           DateTime @db.Date
  bankReviewed  Int      @default(0) @db.SmallInt
  newIntroduced Int      @default(0) @db.SmallInt
  puzzlesDone   Int      @default(0) @db.SmallInt
  lessonsDone   Int      @default(0) @db.SmallInt
  activeMs      Int      @default(0)
  /// DailyPlanV1, frozen on the first hub read of the day; nulled after 7 days
  plan          Json?
  planDone      Int      @default(0) @db.SmallInt
  updatedAt     DateTime @updatedAt
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([userId, day])
  @@map("training_days")
}

/// M5. EWMA of first-try success per theme ("Forks 62%").
model ThemeMastery {
  userId        BigInt
  theme         String    @db.VarChar(32)
  attempts      Int       @default(0)
  firstTry      Int       @default(0)
  ewma          Float     @default(0) @db.Real
  bankCount     Int       @default(0) @db.SmallInt
  milestonePct  Int       @default(0) @db.SmallInt
  lastAttemptAt DateTime?
  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([userId, theme])
  @@map("theme_mastery")
}

/// M5. System-maintained training counters (prefs live in UserSettings.prefs.training).
model TrainingProfile {
  userId                  BigInt    @id
  puzzleRating            Float     @default(1500) @db.Real
  puzzleRd                Float     @default(350) @db.Real
  puzzleVol               Float     @default(0.06) @db.Real
  solveStreak             Int       @default(0) @db.SmallInt
  solveStreakBest         Int       @default(0) @db.SmallInt
  dayStreak               Int       @default(0) @db.SmallInt
  dayStreakBest           Int       @default(0) @db.SmallInt
  lastActiveDay           DateTime? @db.Date
  lastWeaknessSeenVersion Int       @default(0)
  updatedAt               DateTime  @updatedAt
  user                    User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("training_profiles")
}

/// Phase 5 (content reports) + Phase 9 (player reports). One admin queue.
model Report {
  id             BigInt       @id @default(autoincrement())
  referenceId    String       @unique @default(cuid())
  reporterId     BigInt?
  targetType     ReportTarget
  /// referenceId / Lichess puzzle id / "<lessonSlug>:<ply>"
  targetRef      String       @db.VarChar(64)
  reportedUserId BigInt?
  fen            String?
  reason         ReportReason
  note           String?      @db.VarChar(500)
  status         ReportStatus @default(OPEN)
  createdAt      DateTime     @default(now())
  resolvedAt     DateTime?
  resolvedById   BigInt?
  reporter       User?        @relation("ReportsMade", fields: [reporterId], references: [id], onDelete: SetNull)

  @@index([status, createdAt])
  @@index([targetType, targetRef])
  @@map("reports")
}
```

**Raw SQL:**

```sql
CREATE INDEX IF NOT EXISTS training_attempts_puzzle_idx ON training_attempts ("userId","puzzleId") WHERE "puzzleId" IS NOT NULL;
ALTER TABLE training_days     SET (fillfactor = 80);
ALTER TABLE theme_mastery     SET (fillfactor = 80);
ALTER TABLE training_profiles SET (fillfactor = 80);
ALTER TABLE training_sessions ALTER COLUMN items SET COMPRESSION lz4;
```

| Index | Query it serves |
|---|---|
| `mistakes_referenceId_key` | Bank detail and drill URLs (`/train/bank?m=`); coach thread `subjectKey`; report `targetRef`; key moment → bank links |
| `mistakes_userId_epdHash_key` | Worker upsert: `INSERT … ON CONFLICT ("userId", "epdHash") DO UPDATE SET "lastGameId" = …, "lastPly" = …, "lastOpponentName" = …, "lastPlayedAt" = EXCLUDED."lastPlayedAt" WHERE EXCLUDED."lastPlayedAt" > mistakes."lastPlayedAt" RETURNING id`. `occurrences` is then set from `mistake_occurrences` (`UPDATE mistakes m SET occurrences = (SELECT count(*) FROM mistake_occurrences o WHERE o."mistakeId" = m.id) WHERE m.id = ANY($ids)`), so re-analysing a game never double-counts |
| `mistakes_userId_createdAt_idx` | Bank "All" tab and the NEW-card intake (newest game first); user-delete cascade |
| `mistake_occurrences_pkey (gameId, ply)` | Idempotent insert on re-analysis; cascade from game deletion |
| `mistake_occurrences_mistakeId_idx` | Bank detail "seen in 3 games" (with game links); cascade from mistake deletion |
| `training_cards_userId_itemKey_key` | The attempt write (`POST /api/train/attempts`) finds the card by its API ref; idempotent card creation |
| `training_cards_mistakeId_key` | 1:1 with `Mistake`; cascade |
| `training_cards_userId_deck_due_idx` | Due counts for the `V3TrainHub` header, bank header and nav badge (`count(*) FILTER (WHERE due <= now())`, `min(due) FILTER (WHERE due > now())`); "Due from your games" (`ORDER BY due LIMIT 4`); session build (≤ 50 due rows, then sorted by retrievability in TS); caught-up "Coming up" histogram (`date_trunc('day', due)` over the next 7 days); reminder EXISTS. One user has ≤ a few thousand cards, so theme, phase and source filters run in-row |
| `training_attempts_clientAttemptId_key` | `INSERT … ON CONFLICT ("clientAttemptId") DO NOTHING`: double submits and offline replays are no-ops |
| `training_attempts_userId_reviewedAt_idx` | Streak and history, "last results" dots, the session summary (bounded by the session's start and end), FSRS optimiser export, user-delete cascade |
| `training_attempts_puzzle_idx` (raw) | Exclude puzzles seen in the last 90 days at session build: `WHERE "userId" = $1 AND "puzzleId" = ANY($ids) AND "reviewedAt" > now() - interval '90 days'` (≤ 500 ids) |
| `training_sessions_referenceId_key` | `/train/session/[ref]` summary; runner `?s=` resume |
| `training_sessions_userId_startedAt_idx` | Resume the ACTIVE session (`WHERE "userId" = $1 AND status = 'ACTIVE' ORDER BY "startedAt" DESC LIMIT 1`); cascade |
| `training_days_pkey (userId, day)` | Hub week strip (`WHERE "userId" = $1 AND day >= $monday`); today's caps upsert (`ON CONFLICT ("userId", day) DO UPDATE SET "bankReviewed" = training_days."bankReviewed" + $d`); streak |
| `theme_mastery_pkey (userId, theme)` | Hub mastery bars, theme picker (< 60 rows per user), attempt upsert |
| `training_profiles_pkey` | Puzzle rating, streaks; attempt update |
| `reports_status_createdAt_idx` | Admin reports queue (inv-acct Q10) |
| `reports_targetType_targetRef_idx` | "Already reported" check; reports per puzzle, lesson or position |

### 5.7 M6 (P6): Weakness profile

```prisma
/// M6 (Phase 6). Weekly snapshot; latest = PK backward scan. Keep 12 weeks.
model WeaknessSnapshot {
  userId        BigInt
  /// Monday of the ISO week in the user's timezone
  weekStart     DateTime       @db.Date
  algoVersion   Int            @db.SmallInt
  status        WeaknessStatus
  timeClasses   TimeClass[]    @default([])
  since         DateTime?
  gamesInScope  Int            @db.SmallInt
  gamesAnalysed Int            @db.SmallInt
  ratingBandMin Int?           @db.SmallInt
  ratingBandMax Int?           @db.SmallInt
  /// WeaknessMetricsV1 (top, more, preliminary, breakdown{phase, clock, openings, strengths}, weekPlan)
  metrics       Json
  headline      String?        @db.VarChar(200)
  computedAt    DateTime       @default(now())
  user          User           @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([userId, weekStart])
  @@map("weakness_snapshots")
}
```

Raw SQL: `ALTER TABLE weakness_snapshots ALTER COLUMN metrics SET COMPRESSION lz4;`

| Index | Query it serves |
|---|---|
| `weakness_snapshots_pkey (userId, weekStart)` | `GET /api/weakness` reads the latest with `ORDER BY "weekStart" DESC LIMIT 1` (backward PK scan). The trend reads the previous 4–12 weeks. The worker upserts `ON CONFLICT ("userId", "weekStart") DO UPDATE` |

The "Insufficient (14/20)" count is not stored. It is `count(*) FROM game_players WHERE "userId" = $1 AND accuracy IS NOT NULL AND "timeClass" = ANY($scope) AND "endedAt" >= $since` on the `(userId, endedAt)` index, and it is written into `gamesAnalysed` at compute time.

### 5.8 M7 (P7): AI coach

```prisma
/// M7 (Phase 7). One thread per (user, context subject).
model CoachThread {
  id            BigInt           @id @default(autoincrement())
  referenceId   String           @unique @default(cuid())
  userId        BigInt
  kind          CoachContextKind
  /// gameRef | mistakeRef | lessonSlug | "fen:<epdHash>" | "general"
  subjectKey    String           @db.VarChar(64)
  gameId        BigInt?
  lastMessageAt DateTime         @default(now())
  createdAt     DateTime         @default(now())
  user          User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  game          Game?            @relation(fields: [gameId], references: [id], onDelete: Cascade)
  messages      CoachMessage[]

  @@unique([userId, kind, subjectKey])
  @@map("coach_threads")
}

/// M7. User questions and verified coach answers. Tool rounds are not stored. Pruned after 180 days.
model CoachMessage {
  id           BigInt             @id @default(autoincrement())
  referenceId  String             @unique @default(cuid())
  threadId     BigInt
  /// Plain copy for the one-streaming-per-user partial unique index
  userId       BigInt
  role         CoachRole
  kind         CoachMessageKind
  chipKey      String?            @db.VarChar(32)
  ply          Int?               @db.SmallInt
  fen          String?
  /// USER: the question. COACH: null (text = sentences joined)
  text         String?            @db.VarChar(2000)
  /// COACH: [{t, v}] verified sentences only
  sentences    Json?
  verified     Boolean            @default(false)
  status       CoachMessageStatus @default(COMPLETE)
  fallback     Json?
  annotations  Json?
  model        String?            @db.VarChar(40)
  inputTokens  Int?
  outputTokens Int?
  cacheRead    Int?
  cacheWrite   Int?
  costMicroUsd Int?
  latencyMs    Int?
  createdAt    DateTime           @default(now())
  thread       CoachThread        @relation(fields: [threadId], references: [id], onDelete: Cascade)

  @@index([threadId, createdAt])
  @@map("coach_messages")
}

/// M7. Fair-use metering per user per LOCAL day (one atomic upsert per question).
model CoachUsageDay {
  userId           BigInt
  day              DateTime @db.Date
  questions        Int      @default(0) @db.SmallInt
  inputTokens      Int      @default(0)
  outputTokens     Int      @default(0)
  cacheReadTokens  Int      @default(0)
  chatCostMicroUsd Int      @default(0)
  /// Worker-side LLM spend attributed to the user (review text, narration)
  bgCostMicroUsd   Int      @default(0)
  user             User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([userId, day])
  @@map("coach_usage_days")
}
```

**Raw SQL:**

```sql
CREATE UNIQUE INDEX IF NOT EXISTS coach_messages_streaming_key ON coach_messages ("userId") WHERE status = 'STREAMING';
CREATE INDEX IF NOT EXISTS coach_threads_game_idx ON coach_threads ("gameId") WHERE "gameId" IS NOT NULL;
ALTER TABLE coach_usage_days SET (fillfactor = 80);
ALTER TABLE coach_messages ALTER COLUMN sentences SET COMPRESSION lz4;
```

| Index | Query it serves |
|---|---|
| `coach_threads_userId_kind_subjectKey_key` | Find-or-create the thread for a game, mistake or lesson (`POST /api/coach`); user-delete cascade |
| `coach_threads_referenceId_key` | `GET /api/coach/threads/[ref]` |
| `coach_threads_game_idx` (raw) | Cascade when a game is deleted |
| `coach_messages_threadId_createdAt_idx` | The last 20 messages for the prompt and the thread view; chip reuse (`WHERE "threadId" = $t AND "chipKey" = $k AND ply = $p AND status = 'COMPLETE'`); cascade |
| `coach_messages_referenceId_key` | SSE `meta` ids; feedback; retract |
| `coach_messages_streaming_key` (raw) | One answer in flight per user (409 `in_flight`) |
| `coach_usage_days_pkey (userId, day)` | Fair-use upsert (§7.3); the monthly sum over ≤ 31 PK rows; the cost dashboard |

### 5.9 M8 (P8) legends, lessons, legend practice; M12 (P12) tournament arena

```prisma
/// M8 (Phase 8). Authored legend lesson. Steps are rows (validated and edited per ply).
model Lesson {
  id              BigInt           @id @default(autoincrement())
  referenceId     String           @unique @default(cuid())
  slug            String           @unique @db.VarChar(80)
  legendId        BigInt
  chessPositionId BigInt?
  legendOrder     Int              @db.SmallInt
  pathOrder       Int?             @db.SmallInt
  title           String           @db.VarChar(80)
  idea            String           @db.VarChar(120)
  themes          String[]         @default([])
  event           String           @db.VarChar(80)
  year            Int              @db.SmallInt
  whiteName       String           @db.VarChar(40)
  blackName       String           @db.VarChar(40)
  legendColor     String           @db.Char(1)
  /// Verified full game score (source of truth for steps)
  pgn             String           @db.Text
  startPly        Int              @db.SmallInt
  endPly          Int              @db.SmallInt
  playItOutPly    Int?             @db.SmallInt
  intro           String           @db.Text
  story           String           @db.Text
  outro           String           @db.Text
  audioUrl        String?
  /// ExplanationAlignment JSON on R2 (same format as useExplanationPlayer.ts:32-36)
  alignmentUrl    String?
  durationSec     Int              @db.SmallInt
  isPublished     Boolean          @default(false)
  contentVersion  Int              @default(1) @db.SmallInt
  verifiedAt      DateTime?
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt
  legend          Legend           @relation(fields: [legendId], references: [id], onDelete: Restrict)
  chessPosition   ChessPosition?   @relation(fields: [chessPositionId], references: [id], onDelete: SetNull)
  steps           LessonStep[]
  progress        LessonProgress[]

  @@unique([legendId, legendOrder])
  @@index([isPublished, pathOrder])
  @@map("lessons")
}

/// M8. One row per ply in [startPly, endPly].
model LessonStep {
  lessonId    BigInt
  ply         Int     @db.SmallInt
  san         String  @db.VarChar(10)
  uci         String  @db.VarChar(5)
  fenAfter    String
  narration   String? @db.VarChar(600)
  checkpoint  Boolean @default(false)
  prompt      String? @db.VarChar(300)
  hint        String? @db.VarChar(300)
  correctText String? @db.VarChar(400)
  badge       String? @db.VarChar(32)
  /// Space-separated UCI also accepted at a checkpoint
  alsoAccept  String? @db.VarChar(60)
  lesson      Lesson  @relation(fields: [lessonId], references: [id], onDelete: Cascade)

  @@id([lessonId, ply])
  @@map("lesson_steps")
}

/// M8.
model LessonProgress {
  userId      BigInt
  lessonId    BigInt
  status      LessonStatus @default(NOT_STARTED)
  lastPly     Int?         @db.SmallInt
  bestStars   Int          @default(0) @db.SmallInt
  lastStars   Int          @default(0) @db.SmallInt
  attempts    Int          @default(0) @db.SmallInt
  /// {"24":"first_try","30":"hint"} of the last run
  checkpoints Json?
  startedAt   DateTime     @default(now())
  completedAt DateTime?
  updatedAt   DateTime     @updatedAt
  user        User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  lesson      Lesson       @relation(fields: [lessonId], references: [id], onDelete: Cascade)

  @@id([userId, lessonId])
  @@map("lesson_progress")
}

/// M8 (Phase 8). Legend practice comparison (facts at game end, narration later).
model LegendComparison {
  gameId          BigInt
  userId          BigInt
  chessPositionId BigInt?
  status          ComparisonStatus @default(FACTS_READY)
  /// ComparisonFactsV1 {side, historicalName, comparedPlies, matchedPlies, divergencePly, divergenceBy, userSan, legendSan, …}
  facts           Json
  /// NarrationV1 {summary, segments:[{label, text, verified, refs}], promptVersion}
  narration       Json?
  model           String?          @db.VarChar(40)
  costMicroUsd    Int?
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

/// M8. Position rotation ("five positions, one per time slice").
model TournamentPosition {
  tournamentId    BigInt
  order           Int            @db.SmallInt
  chessPositionId BigInt?
  fen             String
  label           String         @db.VarChar(80)
  note            String?        @db.VarChar(200)
  tournament      Tournament     @relation(fields: [tournamentId], references: [id], onDelete: Cascade)
  chessPosition   ChessPosition? @relation(fields: [chessPositionId], references: [id], onDelete: SetNull)

  @@id([tournamentId, order])
  @@map("tournament_positions")
}

// Legend additions
  // M8 (Phase 8)
  slug       String?  @unique @db.VarChar(80)
  /// romantic | classical | soviet | modern
  eraKey     String?  @db.VarChar(16)
  styleTag   String?  @db.VarChar(16)
  birthPlace String?  @db.VarChar(60)
  bio        String?  @db.Text
  themes     String[] @default([])
// ChessPosition additions (legend practice)
  // M8 (Phase 8) legend practice
  slug                String?   @unique @db.VarChar(80)
  title               String?   @db.VarChar(80)
  blurb               String?   @db.VarChar(280)
  year                Int?      @db.SmallInt
  eventRound          String?   @db.VarChar(24)
  /// 'w' | 'b': the side the member plays (the legend's side)
  heroSide            String?   @db.Char(1)
  themes              String[]  @default([])
  ecoCode             String?   @db.VarChar(3)
  openingName         String?   @db.VarChar(80)
  defaultInitialSec   Int?      @db.SmallInt
  defaultIncrementSec Int?      @db.SmallInt
  /// Spoiler: the move played in the real game from this FEN. Never sent before the game ends.
  legendMoveUci       String?   @db.VarChar(5)
  legendMoveSan       String?   @db.VarChar(10)
  /// LegendNotesV1 [{ply, text, verified}]
  legendNotes         Json?
  startPly            Int?      @db.SmallInt
  practiceOrder       Int?      @db.SmallInt
  availableFrom       DateTime?
  verifiedAt          DateTime?
  verifiedById        BigInt?
// Opening additions
  // M8 (Phase 8)
  slug           String? @unique @db.VarChar(100)
  popularity     Int     @default(0)
  /// MoveNotesV1 ["1.e4 takes the centre…", …] for the top ~150 lines
  moveNotes      Json?
// Tournament additions
  // M8 (Phase 8) arena engine
  slug             String?              @unique @db.VarChar(80)
  inviteCode       String?              @unique @db.VarChar(24)
  visibility       TournamentVisibility @default(PUBLIC)
  hostUserId       BigInt?
  lobbyOpensAt     DateTime?
  lateJoinUntil    DateTime?
  participantCount Int                  @default(0)
  standingsVersion Int                  @default(0)
  /// ScoringV1 {"win":2,"draw":1,"fire":true,"earlyDrawPly":20}
  scoring          Json                 @default("{\"win\":2,\"draw\":1,\"fire\":true,\"earlyDrawPly\":20}")
  /// Frozen podium + placements at finalize (results page needs no recompute)
  finalStandings   Json?
  finalizedAt      DateTime?
  cancelledReason  String?              @db.VarChar(200)
// TournamentParticipant additions
  // M8 arena fields
  score          Int       @default(0) @db.SmallInt
  streak         Int       @default(0) @db.SmallInt
  fire           Boolean   @default(false)
  ratingAtJoin   Int?      @db.SmallInt
  whiteCount     Int       @default(0) @db.SmallInt
  blackCount     Int       @default(0) @db.SmallInt
  lastOpponentId BigInt?
  withdrawnAt    DateTime?
  finalRank      Int?      @db.SmallInt
  /// Snapshot, kept when the user is deleted
  displayName    String?   @db.VarChar(40)
```

**Raw SQL:**

```sql
CREATE INDEX IF NOT EXISTS chess_positions_featured_recent_idx ON chess_positions ("createdAt" DESC) WHERE featured AND "isActive";
CREATE INDEX IF NOT EXISTS chess_positions_practice_idx ON chess_positions ("practiceOrder") WHERE "practiceOrder" IS NOT NULL AND "isActive";
```

| Index | Query it serves |
|---|---|
| `lessons_slug_key` | `/learn/lessons/[slug]` (members), cached under the tag `lesson:<slug>` |
| `lessons_legendId_legendOrder_key` | `V3LegendDetail` lesson list ("lesson 2 of 5") |
| `lessons_isPublished_pathOrder_idx` | `V3TrainHub` lesson step ("next lesson whose themes include the focus theme"); the global path |
| `lesson_steps_pkey (lessonId, ply)` | The lesson player loads every step ordered by ply |
| `lesson_progress_pkey (userId, lessonId)` | Hub "Morphy 2 of 5" (a join to the published-lessons list); resume; complete |
| `legend_comparisons_pkey (gameId, userId)` | `V3LegendCompare` tabs; the narration job writes |
| `legend_comparisons_userId_idx` | User-delete cascade; recent comparisons |
| `chess_positions_slug_key` | Legend position detail (`V3TryPosition`), public ISR |
| `chess_positions_featured_recent_idx` (raw) | Featured cards: `WHERE featured AND "isActive" ORDER BY "createdAt" DESC LIMIT 6` (`apps/web/lib/featured-positions.ts:9-26`) |
| `chess_positions_practice_idx` (raw) | Legend practice catalogue order (`V3TryCatalogue`); "Next position" |
| `legends_slug_key`, `openings_slug_key` | SEO slugs (keep `/legends/[referenceId]` canonical until the owner decides, inv-rct-b Q12) |
| `tournaments_slug_key` | `/tournaments/[slug]` |
| `tournaments_inviteCode_key` | `/join-tournament/[code]` (`V4TournamentJoin`) |
| `tournaments_visibility_status_scheduledStartAt_idx` | Tournaments list tabs (`V4Tournaments`): `WHERE visibility = 'PUBLIC' AND status = ANY($s) ORDER BY "scheduledStartAt"` |
| `tournament_participants_tournamentId_score_gamesPlayed_id_idx` | Standings `ORDER BY score DESC, "gamesPlayed", id LIMIT 100`, with the same tie-break for the viewer's rank (fixes the rank mismatch in audit-db §8.6) |
| `tournament_positions_pkey (tournamentId, order)` | Lobby list and the position for the current time slice |

Joining is atomic: `UPDATE tournaments SET "participantCount" = "participantCount" + 1 WHERE id = $t AND status IN ('LOBBY','ACTIVE') AND ("maxParticipants" IS NULL OR "participantCount" < "maxParticipants") AND ("lateJoinUntil" IS NULL OR now() < "lateJoinUntil") RETURNING id`, then the participant insert, with P2002 mapped to "already joined". This fixes the overfill race in `apps/web/app/api/tournament/join/route.ts:37-69`.

### 5.10 M10 (P10): identity, notifications, deletion (challenges and ratings: M9, P9)

```prisma
// User: public identity
  // M9 (Phase 9) public identity
  /// Display casing, e.g. "knightowl_88". Uniqueness is on usernameKey.
  username          String?           @db.VarChar(20)
  /// lower(username); /@username lookups.
  usernameKey       String?           @unique @db.VarChar(20)
  usernameChangedAt DateTime?
  displayName       String?           @db.VarChar(24)
  bio               String?           @db.VarChar(160)
  countryCode       String?           @db.Char(2)
  avatarUrl         String?
  avatarKey         String?           @db.VarChar(120)
  visibility        ProfileVisibility @default(PUBLIC)

/// Phase 9. Old usernames redirect for 90 days.
model UsernameHistory {
  oldKey    String   @id @db.VarChar(20)
  userId    BigInt
  changedAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("username_history")
}

/// Phase 9.
model PushSubscription {
  id            BigInt    @id @default(autoincrement())
  userId        BigInt
  endpoint      String    @unique
  p256dh        String    @db.VarChar(120)
  auth          String    @db.VarChar(40)
  platform      String    @db.VarChar(16)
  userAgent     String?   @db.VarChar(200)
  failures      Int       @default(0) @db.SmallInt
  lastSuccessAt DateTime?
  disabledAt    DateTime?
  createdAt     DateTime  @default(now())
  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("push_subscriptions")
}

/// Phase 9 (first writer: Phase 3 REVIEW_READY). One logical notification = inbox item + per-channel delivery state.
model Notification {
  id          BigInt           @id @default(autoincrement())
  userId      BigInt
  kind        NotificationKind
  /// e.g. "mistakes_due:<userRef>:2026-11-02"; makes every producer idempotent.
  dedupeKey   String           @unique @db.VarChar(120)
  title       String           @db.VarChar(120)
  body        String           @db.VarChar(300)
  url         String?          @db.VarChar(300)
  data        Json?
  runAt       DateTime         @default(now())
  pushStatus  DeliveryStatus   @default(SKIPPED)
  emailStatus DeliveryStatus   @default(SKIPPED)
  attempts    Int              @default(0) @db.SmallInt
  lastError   String?          @db.VarChar(300)
  sentAt      DateTime?
  readAt      DateTime?
  clickedAt   DateTime?
  createdAt   DateTime         @default(now())
  user        User             @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, createdAt(sort: Desc)])
  @@map("notifications")
}

/// Phase 9.
model UserBlock {
  blockerId BigInt
  blockedId BigInt
  createdAt DateTime @default(now())
  blocker   User     @relation("Blocker", fields: [blockerId], references: [id], onDelete: Cascade)
  blocked   User     @relation("Blocked", fields: [blockedId], references: [id], onDelete: Cascade)

  @@id([blockerId, blockedId])
  @@index([blockedId])
  @@map("user_blocks")
}

/// Phase 9. Deletion outbox for external clean-up (Dodo cancel, Clerk delete, Lichess revoke, R2, PostHog). No PII.
model AccountDeletion {
  id                 String    @id @default(cuid())
  userRefHash        String    @db.Char(64)
  emailHash          String    @db.Char(64)
  /// Needed to call Clerk; nulled when the step completes.
  clerkUserId        String?   @db.VarChar(64)
  dodoSubscriptionId String?   @db.VarChar(64)
  /// Lichess token copied (still encrypted) so it can be revoked after the row is gone; nulled after use.
  lichessTokenEnc    Bytes?
  steps              Json      @default("{}")
  requestedAt        DateTime  @default(now())
  completedAt        DateTime?
  lastError          String?   @db.VarChar(500)

  @@map("account_deletions")
}

/// Phase 9. Cookie-consent proof (append-only, 24-month retention).
model ConsentRecord {
  id        BigInt   @id @default(autoincrement())
  userId    BigInt?
  anonId    String?  @db.VarChar(40)
  version   String   @db.VarChar(8)
  analytics Boolean
  replay    Boolean
  marketing Boolean
  method    String   @db.VarChar(16)
  country   String?  @db.Char(2)
  createdAt DateTime @default(now())

  @@map("consent_records")
}
```

**Raw SQL, the foreign-key swaps.** The four `DROP CONSTRAINT` statements are the only drops in the whole diff:

```sql
SET lock_timeout = '5s';
ALTER TABLE games ALTER COLUMN "creatorId" DROP NOT NULL;                         -- metadata only
ALTER TABLE tournaments ALTER COLUMN "createdByUserId" DROP NOT NULL;
ALTER TABLE tournament_participants ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE games DROP CONSTRAINT "games_creatorId_fkey",
  ADD CONSTRAINT "games_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE games DROP CONSTRAINT "games_opponentId_fkey",
  ADD CONSTRAINT "games_opponentId_fkey" FOREIGN KEY ("opponentId") REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE tournaments DROP CONSTRAINT "tournaments_createdByUserId_fkey",
  ADD CONSTRAINT "tournaments_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE tournament_participants DROP CONSTRAINT "tournament_participants_userId_fkey",
  ADD CONSTRAINT "tournament_participants_userId_fkey" FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
CREATE INDEX IF NOT EXISTS notifications_pending_idx ON notifications ("runAt") WHERE "pushStatus" = 'PENDING' OR "emailStatus" = 'PENDING';
CREATE INDEX IF NOT EXISTS account_deletions_open_idx ON account_deletions ("requestedAt") WHERE "completedAt" IS NULL;
-- M9v (separate file): VALIDATE CONSTRAINT for the four FKs above.
```

Each `DROP` and `ADD` pair runs in one statement, so there is no window without a constraint. `NOT VALID` makes the `ADD` instant, and `VALIDATE` takes only a `SHARE UPDATE EXCLUSIVE` lock. This ships **with** the delete-account flow and needs the owner's confirmation (it changes delete semantics).

| Index | Query it serves |
|---|---|
| `users_usernameKey_key` | `/@username` (rewritten to `/u/[username]`); `GET /api/usernames/availability`; `PATCH /api/me/username` (P2002 → 409 `username_taken`) |
| `username_history_pkey (oldKey)` | Redirect an old username for 90 days |
| `username_history_userId_idx` | Cascade |
| `push_subscriptions_endpoint_key` | `POST /api/me/push-subscriptions` upserts by endpoint; a 404/410 from the push service deletes the row |
| `push_subscriptions_userId_idx` | Send to all of a user's devices; cascade |
| `notifications_dedupeKey_key` | Idempotent producers (`INSERT … ON CONFLICT ("dedupeKey") DO NOTHING`) |
| `notifications_userId_createdAt_idx` | Inbox list (if it ships); prune; cascade |
| `notifications_pending_idx` (raw) | Dispatcher (worker): `WHERE ("pushStatus" = 'PENDING' OR "emailStatus" = 'PENDING') AND "runAt" <= now() ORDER BY "runAt" LIMIT 100 FOR UPDATE SKIP LOCKED` |
| `user_blocks_pkey`, `user_blocks_blockedId_idx` | "Can A challenge or see B" (both directions); cascade |
| `account_deletions_open_idx` (raw) | `ACCOUNT_PURGE` retries; the runbook query for stuck deletions |
| `consent_records` | No secondary index. It is append-only and read only for audits |

### 5.11 Contract steps (each one needs the owner's confirmation and a fresh dump first)

| Step | When | Content | Reversible? |
|---|---|---|---|
| **C1** | After M2 has been stable for one release | Drop the 14 duplicate indexes (audit-db §13.1: `users_{googleId,email,code,referenceId,dodoCustomerId}_idx`, `games_referenceId_idx`, `user_stats_{userId,referenceId}_idx`, `chess_com_profiles_{userId,chessComHandle,referenceId}_idx`, `chess_positions_referenceId_idx`, `legends_name_idx`, `tournaments_referenceId_idx`). Drop the low-value ones: `openings_name_idx` (344 KB, 0 scans), `users_subscriptionStatus_idx`, `games_status_idx`, `games_expiresAt_idx`, `chess_positions_{featured,isActive}_idx`, `tournament_participants_tournamentId_points_idx`. **Replace** the full `games_{chessPositionId,openingId,winnerId,tournamentId}_idx` with the partial ones in `schema.target.raw.sql`, created first. Script B10 strips `gameData.moveHistory` and `traceContext`. Remove the `@@index` lines (`schema:58-63, 99-104, 123-124, 166-168, 222-225, 271, 297, 406, 431`) | Indexes can be recreated; the stripped JSON keys are kept in the pre-C1 dump |
| **C2** | After the socket-server queue ships (inv-play-a §2.3) | `DROP TABLE matchmaking_queue`, `DROP TYPE "MatchmakingStatus"`; remove `/api/matchmaking/*` | From the dump |
| **C3** | (merged into M9) | — | — |
| **C4** | One release after stats read `game_players` and links read `linked_accounts` | `DROP TABLE user_stats, chess_com_profiles` | From the dump |
| **C5** | After B4 (R2 copy) has been verified byte for byte | Drop `chess_positions.explanation` and `openings.explanation` | From the dump or R2 |
| **C6** | After B1 is verified and every reader uses typed columns | Drop `games."gameData"`, `"creatorTimeRemaining"` and `"opponentTimeRemaining"` | From the dump |
| **C7** (optional) | Later | Drop `games.result`, `games."winnerId"`, `GameResult`, `users."dateOfBirth"` and `tournament_participants.points` once no code reads them | From the dump |

Measured effect of C1 on `games`: index bytes per row fall from **269 to 159 B**, and the total from 1,638 to 1,529 B per game (§10.1).

---

## 6. Relations and `onDelete` matrix

"Index" says what makes the referential action cheap. A foreign key without an index on the child side turns every parent delete into a sequential scan of the child table.

| Child column | → Parent | onDelete | Index on the child side | Why |
|---|---|---|---|---|
| `games.creatorId` | users | **SetNull** (M9; Cascade today, `schema:90`) | `games_creatorId_idx` | A deleted account must not erase the opponent's game |
| `games.opponentId` | users | **SetNull** (M9; `schema:91`) | `games_opponentId_idx` | Same |
| `games.winnerId` | users | SetNull (Prisma default, `schema:92`) | partial `games_winner_idx` (C1) | Legacy |
| `games.whitePlayerId` / `blackPlayerId` | users | SetNull | partial `games_{white,black}_user_idx` | The names survive as snapshots (`whiteName`) |
| `games.chessPositionId` | chess_positions | SetNull (new FK, `NOT VALID` then `VALIDATE`) | partial `games_chess_position_idx` | Closes DB-18: there is no FK today |
| `games.openingId` | openings | SetNull (existing) | partial (C1) | |
| `games.tournamentId` | tournaments | SetNull (existing) | partial (C1) + `games_tournament_live_idx` | |
| `games.rematchOfId` | games | SetNull | partial `games_rematch_of_idx` | Rematch chain |
| `game_players.gameId` | games | Cascade | PK prefix | |
| `game_players.userId` | users | Cascade | `(userId, endedAt, gameId)` prefix | The member's own index row |
| `game_players.linkedAccountId` | linked_accounts | SetNull | partial | Unlinking keeps the games unless a purge is asked for |
| `player_reviews.(gameId, color)` | game_players | Cascade | PK | |
| `game_analyses.gameId` | games | Cascade | PK | |
| `mistakes.userId` | users | Cascade | `(userId, createdAt)` prefix | Private |
| `mistake_occurrences.gameId` | games | Cascade | PK prefix | |
| `mistake_occurrences.mistakeId` | mistakes | Cascade | `mistakeId` index | |
| `mistakes.lastGameId` | — (plain) | — | — | Maintained by the purge job (§3.7) |
| `training_cards.userId` | users | Cascade | `(userId, itemKey)` prefix | |
| `training_cards.mistakeId` | mistakes | Cascade | unique | |
| `training_cards.openingId` | — (plain) | — | — | Openings are never deleted |
| `training_attempts.userId` | users | Cascade | `(userId, reviewedAt)` prefix | |
| `training_attempts.cardId` / `sessionId` | — (plain) | — | — | History outlives cards and sessions |
| `training_sessions`, `training_days`, `theme_mastery`, `training_profiles`, `weakness_snapshots`, `coach_usage_days`, `lesson_progress`, `user_settings`, `linked_accounts`, `push_subscriptions`, `notifications`, `username_history`, `player_ratings`, `legend_comparisons` `.userId` | users | Cascade | PK or `(userId, …)` prefix | Private |
| `import_cursors.linkedAccountId` | linked_accounts | Cascade | PK | |
| `coach_threads.userId` | users | Cascade | unique prefix | |
| `coach_threads.gameId` | games | Cascade | partial `coach_threads_game_idx` | Deleting a game deletes its threads |
| `coach_messages.threadId` | coach_threads | Cascade | `(threadId, createdAt)` | |
| `challenges.creatorId` | users | Cascade | `(creatorId, status)` | An open link dies with its creator |
| `challenges.acceptedById` | users | SetNull | — (small, pruned table) | |
| `challenges.gameId` | games | SetNull | unique | |
| `shares.ownerId` | users | SetNull | partial `shares_owner_idx` | Position shares outlive the author; REVIEW shares are deleted by the deletion flow |
| `shares.gameId` | games | Cascade | partial `shares_game_idx` | |
| `shares.chessPositionId` | chess_positions | SetNull | — (positions are rarely deleted) | |
| `legend_comparisons.gameId` | games | Cascade | PK prefix | |
| `lessons.legendId` | legends | **Restrict** | unique `(legendId, legendOrder)` | Content cannot be orphaned by an admin delete |
| `lessons.chessPositionId` | chess_positions | SetNull | — | |
| `lesson_steps.lessonId` | lessons | Cascade | PK | |
| `tournaments.createdByUserId` | users | **SetNull** (M9; Cascade today, `schema:399`) | `tournaments_createdByUserId_idx` | |
| `tournaments.hostUserId` | users | SetNull | — (small table) | |
| `tournament_participants.userId` | users | **SetNull** (M9; Cascade today, `schema:428`) | `tournament_participants_userId_idx` | Finished standings keep a `displayName` snapshot |
| `tournament_positions.tournamentId` | tournaments | Cascade | PK | |
| `reports.reporterId` | users | SetNull | — (small table) | A report survives its reporter |
| `user_blocks.*` | users | Cascade | PK + `blockedId` | |
| `chess_positions.white/blackPlayerId` | legends | SetNull (existing) | existing (C1 may make them partial `WHERE "isActive"`) | |
| `jobs.userId` / `gameId`, `audit_logs.actorUserId`, `consent_records.userId`, `webhook_events.userId`, `game_players.opponentUserId` / `tournamentId` | — (plain) | — | — | Must survive deletions, or are denormalised |

### 6.1 What account deletion removes and keeps

| Data | Result | Mechanism |
|---|---|---|
| `users` row | deleted | `DELETE FROM users` at the end of the transaction (§3.19) |
| Profile, settings, links and tokens, push subscriptions, notifications, username history, ratings | deleted | Cascade |
| Own `game_players` rows, and the reviews, mistakes, occurrences, cards, logs, sessions, days, mastery, profile, snapshots, coach threads and messages, usage, lesson progress and comparisons that hang off them | deleted | Cascade |
| Imported games where the user is the only player | deleted | Explicit `DELETE` in the transaction, then cascade (analyses, occurrences, shares, threads) |
| Games against other members | **kept**; the user's side becomes `whiteName = 'Deleted player'`, `whitePlayerId = NULL`, `creatorId = NULL` | Anonymising `UPDATE` + SetNull FKs (M9) |
| The other member's `game_players`, review, Mistake Bank | **kept** | Not linked to the deleted user |
| Finished tournament standings | **kept** under "Deleted player" | `displayName` snapshot + SetNull |
| Lobby or active tournament participations | deleted | Explicit `DELETE` (with a warning in the deletion preview) |
| Position shares | kept, ownerless | SetNull |
| Review shares | deleted | Explicit `DELETE` |
| Reports they filed | kept, reporter null | SetNull |
| Audit log, consent records, webhook events | kept (no PII; ids only) | No FK |
| Trial used | kept as a hash | `TrialLedger` |
| Clerk user, Dodo subscription, Lichess token, R2 avatar and exports, PostHog person | removed after commit, with retries | `AccountDeletion` outbox + `ACCOUNT_PURGE` job |
| Backups | cleared within the R2 backup retention (14 daily + 8 weekly, audit-db §15) | The `V4DeleteAccount` copy says "within 30 days"; 8 weekly copies is 56 days, so the copy or the retention must change (O9) |

---

## 7. Writers, transactions and the per-screen database budget

### 7.1 Live game (socket server → Neon directly, B4)

The exact statements are in P2 §6.6 (authoritative); the shapes:

**Checkpoint** (`DB/src/live/checkpoint.ts`, ≤ 10 per 80-ply game, on phase change; 1 statement ≈ 220 ms from Mumbai):

```sql
UPDATE games SET moves = $moves, "moveClocksMs" = $clocks, "plyCount" = $n, fen = $fen,
       "whiteTimeMs" = $w, "blackTimeMs" = $b, "clockRunning" = $side, phase = $phase, "phaseEndsAt" = $pe, "lastMoveAt" = $now
WHERE id = $id AND status = 'IN_PROGRESS' AND "plyCount" <= $n;   -- reordered or duplicate checkpoints are no-ops
```

`lastMoveAt` is not indexed (only the partial `games_open_idx` on `status`), so each checkpoint stays a HOT update on a `fillfactor 90` page.

**Finish** (`DB/src/live/finish.ts`, `finishGame()`): **one data-modifying CTE**, idempotent on `status`, built from named fragments that P3 (analysis enqueue), P9 (ratings) and P12 (tournament scoring) append to:

```sql
WITH g AS (
  UPDATE games SET status = 'COMPLETED', outcome = $o, "endMethod" = $m, moves = $moves, "moveClocksMs" = $clocks,
         "plyCount" = $n, fen = $fen, pgn = $pgn, "completedAt" = $endedAt, phase = 'ENDED',
         "analysisStatus" = CASE WHEN $n >= 4 THEN 'QUEUED' ELSE 'SKIPPED' END            -- M3 fragment
  WHERE id = $id AND status = 'IN_PROGRESS' RETURNING id                                  -- 0 rows → already finished
), gp AS (
  UPDATE game_players SET result = v.result, "endedAt" = $endedAt  /* P9: "ratingAfter", "ratingDelta" */
  FROM g, (VALUES …) v(color, result) WHERE game_players."gameId" = g.id AND game_players.color = v.color
  RETURNING "userId"
), u AS (
  UPDATE users SET "gamesVersion" = "gamesVersion" + 1 /* , stats */ FROM (SELECT DISTINCT "userId" FROM gp) x
  WHERE users.id = x."userId"
), j AS (
  INSERT INTO jobs (kind, priority, "dedupeKey", "userId", payload)                         -- P3 fragment
  SELECT 'ANALYZE_GAME', $JOB_PRIORITY_GAME_ENDED, 'analyze:' || g.id, NULL, jsonb_build_object('v',1,'gameId',g.id) FROM g
  ON CONFLICT ("dedupeKey") DO NOTHING
)
SELECT (SELECT count(*) FROM g) AS finished;
-- then: game:result to the room; POST /internal/analysis/kick (HMAC, kid ws)
```

This replaces the race in `apps/web/app/api/chess/game-over/route.ts:83-120` (DB-04) and stores the mating move (DB-03). Tournament pairing, start and finalize are the exception: they run on web through `/api/internal/tournaments/*` (P12 D12-4). The bot-game path (`POST /api/games/[ref]/complete`) runs the same service on Vercel after server-side adjudication (P2 §7.1.4).

### 7.2 Analysis write (worker, one HTTP batch per game)

The worker builds every row in TypeScript, then sends **one** `sql.transaction([...])` over the Neon HTTP driver (P3-D11): one round trip from Mumbai and one short lock window. A non-interactive batch cannot feed one statement's `RETURNING` into the next, so every statement is **set-based and keyed by natural keys** (api-perf AP-27):

```sql
INSERT INTO game_analyses … ON CONFLICT ("gameId") DO UPDATE … ;
INSERT INTO player_reviews … ON CONFLICT ("gameId", color) DO UPDATE … ;
UPDATE game_players gp SET accuracy = v.accuracy, counts = v.counts, "phaseAccuracy" = v.pa, headline = v.h, "momentsCount" = v.mc
  FROM jsonb_to_recordset($sides) v(…) WHERE gp."gameId" = $g AND gp.color = v.color;
-- P5 J1 (bank rows), appended to the same batch:
INSERT INTO mistakes ("userId","epdHash",…) SELECT … FROM jsonb_to_recordset($m) …
  ON CONFLICT ("userId","epdHash") DO UPDATE SET … WHERE EXCLUDED."lastPlayedAt" > mistakes."lastPlayedAt";
INSERT INTO mistake_occurrences ("mistakeId","gameId",ply,…)
  SELECT m.id, x."gameId", x.ply, … FROM jsonb_to_recordset($o) x
  JOIN mistakes m ON m."userId" = x."userId" AND m."epdHash" = x."epdHash" ON CONFLICT DO NOTHING;
INSERT INTO training_cards ("userId",deck,"itemKey","mistakeId",…)
  SELECT m."userId",'BANK','m_'||…, m.id, … FROM jsonb_to_recordset($c) x JOIN mistakes m USING ("userId","epdHash")
  ON CONFLICT ("userId","itemKey") DO NOTHING;
UPDATE games SET "analysisStatus" = 'DONE' WHERE id = $g AND ("analysisStatus" <> 'DONE' OR …version guard…);
UPDATE users SET "gamesVersion" = "gamesVersion" + 1 WHERE id = ANY($members);
UPDATE jobs SET status = 'DONE', "finishedAt" = now() WHERE id = $j AND "lockedBy" = $me;
INSERT INTO jobs (kind, "dedupeKey", "userId", priority, "runAt") VALUES ('RECOMPUTE_WEAKNESS', 'weakness:' || $u, $u, $JOB_PRIORITY_WEAKNESS, now() + interval '10 minutes')
  ON CONFLICT ("dedupeKey") DO UPDATE SET "runAt" = EXCLUDED."runAt" WHERE jobs.status = 'QUEUED';
```

The inserted-card counts and the due count for `analysis:done.bank` come from the batch results. Alternative: ship `rc_apply_analysis(p jsonb)` (a SQL function defined in M3; Prisma's diff ignores functions) as the default, with the same statements inside. Revision 1's interactive transaction (≈ 11 round trips, ≈ 2–2.5 s, holding locks on `mistakes` and cards while a member grades) is withdrawn: P5's grading takes `FOR UPDATE` on the same `training_cards` rows, and P5 tests that W1 p95 stays < 300 ms while an analysis of the same user commits.

### 7.3 User writes on Vercel

**Grading a card** (`POST /api/train/attempts`, batch-capable, idempotent), one transaction:

```sql
INSERT INTO training_attempts (…) VALUES (…) ON CONFLICT ("clientAttemptId") DO NOTHING RETURNING id;   -- no row → duplicate → 200 "duplicate"
UPDATE training_cards SET due = $due, stability = $s, difficulty = $d, "elapsedDays" = …, "scheduledDays" = …, reps = reps + 1,
       lapses = …, state = $st, "lastReview" = $at, mastery = $m, "updatedAt" = now()
WHERE id = $card AND "userId" = $u AND reps = $cardReps;         -- 0 rows → roll back (the log too), 409 conflict (another tab graded it)
INSERT INTO training_days ("userId", day, "bankReviewed", "newIntroduced", "puzzlesDone", "activeMs", "updatedAt")
VALUES ($u, $day, $b, $n, $p, $ms, now())
ON CONFLICT ("userId", day) DO UPDATE SET "bankReviewed" = training_days."bankReviewed" + EXCLUDED."bankReviewed", …;
INSERT INTO theme_mastery … ON CONFLICT ("userId", theme) DO UPDATE SET ewma = …, attempts = theme_mastery.attempts + 1, …;
UPDATE training_profiles SET "puzzleRating" = …, "solveStreak" = …, "dayStreak" = …, "lastActiveDay" = $day WHERE "userId" = $u;
```

**Coach fair use** (one round trip, race-free; it is counted on `done`, so failures are refunded):

```sql
INSERT INTO coach_usage_days ("userId", day, questions, "inputTokens", "outputTokens", "cacheReadTokens", "chatCostMicroUsd")
VALUES ($u, $localDay, 1, $in, $out, $cr, $cost)
ON CONFLICT ("userId", day) DO UPDATE SET questions = coach_usage_days.questions + 1,
  "inputTokens" = coach_usage_days."inputTokens" + EXCLUDED."inputTokens", …
RETURNING questions;
```

The pre-check before streaming is a PK read of today's row. The caps come from `CT/limits.ts` (architecture CR-33).

**Preferences:** `UPDATE user_settings SET prefs = $merged, "prefsVersion" = "prefsVersion" + 1, "reminderUtcMinute" = …, … WHERE "userId" = $u` (upsert on first write).

### 7.4 Database cost per screen (target)

"Auth" is the memoised `getViewer()` read by `googleId`, selecting about 15 columns (audit-api §7.1). Middleware entitlement uses the Clerk session claim and makes no DB call (`implementation-plan.md:42`).

| Screen (board) | API / loader | Statements after auth | Indexes |
|---|---|---|---|
| Home (`V3Home`, `V3HomeNewUser`) | RSC loader `getHome()` | recent games (8) ⋈ games; due count; today's `training_days`; latest weakness headline; `linked_accounts` import state. Five reads in `Promise.all` | `game_players_userId_endedAt_gameId_idx`, `training_cards_userId_deck_due_idx`, PKs, `linked_accounts_userId_provider_key` |
| Train hub (`V3TrainHub`, `V3TrainHubDone`) | `GET /api/train/today` | due summary; this week's `training_days` (incl. the frozen plan); `theme_mastery`; lesson progress; due-4 preview | as §5.6 |
| Mistake Bank (`V3MistakeBank`, `V3BankEmpty`, `V3BankCaughtUp`) | `GET /api/bank?view=&theme=&phase=&source=&cursor=` | one join `training_cards ⋈ mistakes` (51 rows), plus one `GROUP BY GROUPING SETS` for the facets | `training_cards_userId_deck_due_idx` |
| Bank session (`V3BankSession`) and puzzles (`V3Puzzle*`) | `POST /api/train/sessions` once; `POST /api/train/attempts` once per item | build: ≤ 50 due cards (+ 1–2 R2 shards and the seen-puzzle exclusion); attempt: 5 statements (§7.3) | `training_cards_*`, `training_attempts_puzzle_idx` |
| Review (`V3ReviewSummary`, `V3KeyMoments`, `V3ReviewClean`, `V3ReviewFailed`) | RSC + `GET /api/review/[ref]` | `games` by `referenceId`, `game_players` (≤ 2), `game_analyses` PK, `player_reviews` PK. One round trip with `relationLoadStrategy: "join"` | PKs. strong ETag from `analysisVersion`; `private-etag`, never `immutable` (per-user) |
| Analysing (`V3ReviewAnalysing`) | `analysis:*` events on `user:{ref}`; fallback poll `GET /api/review/[ref]/status` (ETag → 304) | 1 PK read of `games` | PK |
| Weakness (`V3WeaknessProfile`, `…Insufficient`, `…Computing`) | `GET /api/weakness` | 1 backward PK read of `weakness_snapshots` | PK |
| Games archive (`V3GamesArchive`, `V4ProfileGames`) | `GET /api/me/games?cursor=` | 1 keyset query of `game_players` (31) ⋈ games; counts by `GROUP BY source` | `game_players_userId_endedAt_gameId_idx` |
| Profile overview (`V4Profile`, `V4ProfileStats`) | RSC, `unstable_cache` with the tag `player:<id>` | ratings (PK), last 90 days of `game_players` aggregates, latest weakness strengths | PKs + main index |
| Connected accounts (`V4SettingsConnected*`) | RSC + `GET /api/accounts` (fallback poll while SYNCING, ETag) | 1 read of `linked_accounts` | unique `(userId, provider)` |
| Membership (`V4Membership*`) | `GET /api/me` | 0 extra (entitlement columns are on the user row; Dodo only on `POST /api/billing/refresh`) | — |
| Coach (`V3Coach*`) | `POST /api/coach/messages` (SSE) | usage PK read; thread find-or-create; last 20 messages; insert question + placeholder (partial unique); at the end, update the answer + usage upsert | §5.8 |
| Tournament arena (`V4TournamentLive`) | RSC + socket deltas | standings top 100 + viewer rank | rank index |
| Public catalogues (legends, openings, positions, how we grade) | ISR / `unstable_cache` with tags | **0 per request** (revalidated by admin writes) | — |

---

## 8. Index catalogue notes

The per-table index lists with the query each one serves are in §5.1–§5.10. The totals in the target are: 49 indexes generated by Prisma (`schema.target.diff.sql`), 30 hand-written partial indexes (`schema.target.raw.sql`), and 25 dropped or replaced in C1 (§5.11).

**Indexes deliberately not created**, so a later plan doesn't add them back without a measured reason:

| Not created | Why |
|---|---|
| A trigram (`pg_trgm`) GIN index on `openings.name`, `legends.name`, `chess_positions` names, or a `searchText` on game lists (inv-acct, inv-pub, inv-sys) | 3,641 openings, 51 legends, ≤ 2,000 games per user: `ILIKE` is a 1–2 ms scan. The pages are ISR- and CDN-cached. A GIN index also needs the `postgresqlExtensions` preview feature and makes drift handling harder. Revisit above 50k rows |
| GIN on `mistakes.themes` / `training_cards.theme` / `chess_positions.themes` | Filters run inside one user's ≤ few thousand rows, or a catalogue of under 1,000 |
| `(userId, outcome, …)` and `(userId, source, …)` on `game_players` (inv-acct) | The main `(userId, endedAt, gameId)` index plus an in-row filter covers ≤ 2,000 rows |
| `(userId, deck, theme, due)` and `(userId, deck, mastery)` on cards (inv-rct-b) | Same reasoning, ≤ a few thousand cards |
| `(cardId, reviewedAt)` and `(sessionId)` on `training_attempts` | The card history ("last 3 results") and the session summary are bounded by `(userId, reviewedAt)` |
| `(userId, createdAt)` on `coach_messages` | The burst limit uses `rate_limit_buckets` |
| `users(createdAt)`, `games(createdAt)` for admin "this week" counts (inv-acct) | A count over a few thousand users is a scan once a day, read through `unstable_cache` |
| An index on `player_ratings (pool, rating)` | No leaderboard board in v3 |
| `games (status, lastMoveAt)` (inv-play-a) | Replaced by the much smaller partial `games_open_idx`. `lastMoveAt` changes on every checkpoint, so indexing it would prevent HOT updates |
| `GameMove (gameId, ply)` (audit-socket) | No such table (D1) |
| `Game.clientKey @unique` (inv-play-b) | `idempotency_keys` instead (D15) |

**Diagnostics.** `CREATE EXTENSION IF NOT EXISTS pg_stat_statements;` on production. It is available but not installed (audit-db §0). Review the top 20 statements monthly. Neon resets its data when the compute restarts, so export the snapshot from the daily housekeeping job.
**Indexes revision 2 adds or renames** (each in its owning migration, §5.0.1; every name also goes into `DB/prisma/protected-indexes.txt` when it is a hand-written partial index):

| Index | Migration | Query it serves |
|---|---|---|
| `game_players_userId_endedAt_gameId_idx (userId, endedAt DESC, gameId DESC)` | M2 | archive keyset `WHERE "userId" = $1 AND ("endedAt","gameId") < ($c1,$c2) ORDER BY "endedAt" DESC, "gameId" DESC LIMIT 31`; Home recent 3 and "this week"; "my live games" (`"endedAt" IS NULL`, first in `DESC`); rating chart; P7 CO-1, P10 stats CTE |
| `games_open_idx (status) WHERE status IN ('WAITING_FOR_OPPONENT','IN_PROGRESS')` | M2 | socket boot restore and stale sweeps (dozens of rows) |
| `jobs_ready_idx (priority DESC, "fairSeq", "runAt") WHERE status = 'QUEUED'` | M3 | the claim (`ORDER BY priority DESC, "fairSeq", "runAt"`) |
| `training_cards_userId_deck_due_idx`, `training_attempts_puzzle_idx` | M5 | due counts, session build, recent-puzzle exclusion (P6 Q-W2/Q-W7 and the weekly roll use these names) |
| `reports_reporterId_createdAt_idx`, `training_sessions_userId_startedAt_idx` | M5 | durable rate limits counted from source rows (AP-11) |
| `coach_messages_streaming_key (userId) WHERE status = 'STREAMING'`; unique `(userId, clientId)` | M7 | one in-flight answer; idempotent retries. The `ON CONFLICT` target is `("userId","clientId")`, not `("threadId","clientId")`, because the first message of a new thread has no thread id yet |
| `game_players_h2h_idx ("userId","opponentUserId","endedAt" DESC) WHERE "opponentUserId" IS NOT NULL` | M9 | head-to-head on profiles |
| `notifications_sent_day_idx ("sentAt") WHERE status = 'SENT'` | M10 | the durable daily Resend budget |
| `games_tournament_live_idx`, `game_players_tournament_idx` | M12 | arena standings and results |

**CI gate (api-perf §2.6):** `scripts/explain-hot-queries.ts` fails when any index named in a phase spec's "Indexes and the queries they serve" table is missing from `pg_indexes` after `migrate deploy` on the CI database, then `EXPLAIN`s each listed query and fails on a Seq Scan or Sort over `game_players`, `training_cards` or `training_attempts`.

---

## 9. JSON column registry

Every JSON value is validated with zod on write and on read (`packages/db/json/<name>.ts`, each with `v: 1`). "Max" is enforced by zod.

| Column | Schema | Max | Writer | Reader |
|---|---|---|---|---|
| `user_settings.prefs` | `PreferencesV1` (board, pieces, sound, appearance, notifications, training) | 4 KB | `PATCH /api/me/preferences` (deep merge) | `GET /api/me`, the settings shell, the board and sound stores |
| `user_settings.consent` | `ConsentV1 {v, analytics, replay, marketing, at}` | 200 B | `PUT /api/me/consent` | Server components (gate PostHog / GA) |
| `games.meta` | `GameMetaV1 {hints, undos, takebacks, premoves, drawOffers, shareCode, client}` | 1 KB | finish / complete | Review (assists shown), analytics |
| `games."gameData"` | legacy, untyped | — | none for new games | B1 backfill only |
| `game_analyses.lines` | `LinesV1 {"<ply>": [pv, alts]}` | 2 KB | worker | Review (key moments, best line), coach facts |
| `player_reviews.content` | `ReviewContentV1 {summary[{t,v}], phaseLine, isClean, bestPly, bestDecision, moments[{ply, mistakeRef, ask, why[{t,v}], plan{attack,defend,trade,improve,unsure}}]}` | 8 KB | worker (`REVIEW_TEXT`) | Review, the coach's "explain this move" |
| `player_reviews.progress` | `ReviewProgressV1 {momentIndex, results{ply: FOUND\|FOUND_RETRY\|REVEALED}, planChips{ply: key}}` | 1 KB | `PATCH /api/review/[ref]/progress` | Review |
| `mistakes.texts` | `MistakeTextV1 {hint, correct, wrong, cost, model, promptVersion}` (LLM-verified only) | 2 KB | worker (`REVIEW_TEXT`) | Bank session |
| `linked_accounts.ratings` | `RatingsV1 {rapid?{rating,best,games}, blitz?, bullet?, daily?, classical?}` | 1 KB | import / lookup | Connected card, onboarding confirm, puzzle-rating seed, rating band |
| `linked_accounts.lastError` | `LinkErrorV1 {code, message, at, retryAt?}` | 500 B | worker | Connected card (the sync_failed and rate_limited states) |
| `import_cursors.archives` | `ChesscomArchivesV1 {"YYYY/MM": {etag, lastModified, done, games}}` | 20 KB | worker | worker |
| `jobs.payload` / `result` | per `JobKind` (discriminated union) | 4 KB | enqueuers / worker | worker, admin |
| `training_sessions.items` | `SessionItemsV1 [itemKey]` (+ requeue markers) | 2 KB | `POST /api/train/sessions` | runner, summary |
| `training_days.plan` | `DailyPlanV1 {steps[{kind, title, subtitle, estMin, status, href, itemKeys?}]}` | 2 KB | the first hub read of the day | hub |
| `weakness_snapshots.metrics` | `WeaknessMetricsV1` (the `WeaknessPayload` in inv-rct-b §4.3, minus progress) | 8 KB | worker | `GET /api/weakness` |
| `coach_messages.sentences` / `fallback` / `annotations` | `SentencesV1 [{t, v}]`, `EngineLineV1`, `AnnotationsV1 {arrows, line}` | 8 KB | `POST /api/coach` | the coach thread |
| `notifications.data` | per kind | 1 KB | producers | dispatcher, inbox |
| `legend_comparisons.facts` / `narration` | `ComparisonFactsV1`, `NarrationV1` | 4 KB | finish (facts), worker (narration) | `V3LegendCompare` |
| `shares.snapshot` | `ReviewShareV1` (the frozen public payload) | 16 KB | `POST /api/games/[ref]/share` | `/r/<code>` |
| `tournaments.scoring` / `finalStandings` | `ScoringV1`, `StandingsV1` | 2 KB / 32 KB | admin create / finalize | arena, results |
| `chess_positions.legendNotes` | `LegendNotesV1 [{ply, text, verified}]` | 4 KB | admin | legend practice |
| `openings.moveNotes` | `MoveNotesV1 [string]` | 4 KB | script J8 | opening stepper |
| `lesson_progress.checkpoints` | `{ply: result}` | 500 B | lesson events | lesson complete |
| `audit_logs.meta`, `webhook_events.payload` | free-form, **no PII** (lint rule on the `audit()` helper) | 4 KB / 64 KB | server | admin, support |

---

## 10. Storage growth and the Neon budget

### 10.1 Measured row sizes

**Method.**

1. Start a throwaway `postgres:17-alpine` container (Docker, local).
2. `prisma migrate deploy` the 17 repo migrations, then apply `schema.target.diff.sql` and `schema.target.raw.sql`.
3. Insert synthetic rows shaped like real ones (`../sizes/gen2.sql`). Text is random hex, so nothing compresses better than real data. Games have 80 plies; 40% of `game_players` rows are analysed; reviews have 4 summary sentences and 3 moments.
4. Measure with `pg_table_size` (heap + TOAST), `pg_indexes_size` and `pg_total_relation_size` divided by `count(*)` (`../sizes/measure2.sql`, `../sizes/c1.sql`).

Postgres page and tuple overhead is included. Neon stores the same Postgres pages.

| Table | Rows | Heap + TOAST B/row | Index B/row | **Total B/row** | Indexes | Note |
|---|---|---|---|---|---|---|
| `games` (before C1) | 10,000 | 1,369 | 269 | 1,638 | 21 | Row content is 1,176 B: `moves` 403, `moveClocksMs` 344 |
| `games` (after C1) | 10,000 | 1,369 | **159** | **1,529** | 14 | Legacy full indexes replaced by partial ones |
| `game_players` | 10,000 | 222 | 79 | 301 | 5 | Row is 120 B unanalysed, 344 B analysed |
| `game_analyses` | 4,000 | 1,180 | 27 | **1,206** | 1 | 80 plies, `smallint[]` packing |
| per-ply `MoveEval` (the plan's columns) | 80,000 (1,000 games) | — | — | **23,773 per game** | 3 | `../sizes/moveeval.sql`: **19.7×** the packed row |
| `player_reviews` | 2,000 | 4,391 | 41 | 4,432 | 1 | Random text does not compress; real text is smaller after lz4. Planned at 3,500 B |
| `mistakes` | 10,000 | 376 | 136 | 512 | 4 | Templates are not stored |
| `mistake_occurrences` | 11,000 | 55 | 60 | 115 | 2 | |
| `training_cards` | 9,999 | 199 | 127 | 326 | 4 | Rows: BANK 160 B, PUZZLE 248 B |
| `training_attempts` | 30,000 | 153 | 109 | 262 | 4 | |
| `training_sessions` | 1,000 | 467 | 147 | 614 | 3 | Compact itemKeys; 2,228 B with 25-character refs |
| `training_days` | 3,000 | 109 | 55 | 164 | 1 | Plan pruned |
| `coach_messages` | 6,000 | 639 | 122 | 760 | 4 | User message 232 B row, coach 1,008 B row. A Q+A pair ≈ 1,520 B |
| `coach_threads` | 1,000 | 172 | 254 | 426 | 4 | |
| `weakness_snapshots` | 120 | 4,915 | 137 | 5,052 | 1 | Random text; planned at 4,000 B |
| `notifications` | 2,000 | 291 | 139 | 430 | 4 | |

**What the measurements changed in the design:**

| Before | After | Saving |
|---|---|---|
| `jsonb` stats on `GamePlayer` (998 B) | `smallint[]` + `real[]` + `text[]` (§3.10) | Analysed rows 628 → about 430 B |
| `evals int[]`, `bestUci text`, verbose `lines` JSON (2,083 B per game) | `smallint[]` evals and MoveCodes, compact lines | 2,083 → 1,206 B per game |
| 25-character cuids in session items (2,228 B) | Compact `itemKey`s | 2,228 → 614 B |
| `fillfactor = 90` on `games` (planned) | Dropped | A 1.2 KB row cannot fit a HOT copy in 10% of an 8 KB page, so the setting bought nothing |

### 10.2 Per member per year

| Profile | Typical | Heavy |
|---|---|---|
| Imported games kept (12-month window) | 600 | 2,500 |
| Replay games (bot + PvP) | 120 (50 PvP) | 300 (150 PvP) |
| Analysed games | 300 | 700 |
| Reviews with coach text | 150 | 400 |
| Bank items / occurrences | 800 / 900 | 2,000 / 2,300 |
| Cards (BANK / PUZZLE) | 800 / 400 | 2,000 / 1,500 |
| Review log rows | 3,000 (≈ 13 a day × 220 days) | 9,000 |
| Coach Q+A pairs live (180 days) | 180 (30 a month) | 1,500 (10 a day) |

| Table group (measured B/row × rows) | Typical MB | Heavy MB |
|---|---|---|
| `games` | 1.06 | 4.17 |
| `game_players` | 0.23 | 0.77 |
| `game_analyses` | 0.34 | 0.78 |
| `player_reviews` | 0.53 | 1.40 |
| `mistakes` + `mistake_occurrences` | 0.51 | 1.29 |
| `training_cards` | 0.40 | 1.19 |
| `training_attempts` | 0.79 | 2.36 |
| `training_sessions` + `training_days` | 0.07 | 0.11 |
| `coach_*` (live) | 0.32 | 2.45 |
| weakness, notifications, user, settings, links, ratings, mastery | 0.13 | 0.20 |
| **Total** | **≈ 4.4 MB** | **≈ 14.7 MB** |

For comparison, the plan's design with per-ply `MoveEval` would add about 6.3 MB per typical member per year (280 analysed games × (23.8 − 1.2) KB). The current `moveHistory` blob would add about 21 KB per stored game, plus WAL for the quadratic rewrites.

### 10.3 Against the Neon Free plan

Limits, from Neon's plans page (checked 2026-11-02 with the Neon docs search):

- 1 GB of Postgres storage **per project**; going over blocks writes.
- 100 CU-hours per project per month; running out suspends the compute until the next month.
- 5 GB egress.
- 10 branches.

| Budget line | MB |
|---|---|
| Plan cap | 1,024 |
| Headroom: MVCC bloat between vacuums, index growth, temporary backfill bloat, the `dev` branch delta while dev still lives in this project (CLAUDE.md: `dev` is a child of `production`) | −300 |
| Fixed content: openings 2.3 (measured on dev) + about 0.6 for slug/epd; legends, positions and lessons < 2 once explanations are on R2; system tables (jobs, webhooks, audit, idempotency) < 10 with pruning | −15 |
| **Member data** | **≈ 700** |

| Member mix | MB per member-year | Members in year one |
|---|---|---|
| All typical | 4.4 | ≈ 160 |
| 80% typical, 20% heavy | 6.5 | ≈ 105 |
| All heavy | 14.7 | ≈ 48 |

**Recommendation (owner decision O2):**

- Ship on Free during P1–P12; production moves to **Launch before charging** (P13 D17), with the 7-day restore window set explicitly.
- Alert at **500 MB**: a daily housekeeping check runs `SELECT pg_database_size(current_database())` and logs to Sentry.
- Move production to Neon Launch before **100 paying members** or 600 MB, whichever comes first. At $0.35 per GB-month for storage and $0.106 per CU-hour (audit-db §10.3), 2 GB costs about $0.70 a month; compute is the real cost, about $15–25 for an always-on 0.25 CU. 100 members bring in about $499 a month.
- **Compute runs out before storage** in every scenario (audit-db §10), which is why the design avoids polling, per-move writes and per-view counters (§3).
- Put dev and E2E in a **separate Neon project in P1** (1B·H10; audit-db DB-01, api-perf AP-01), so their activity stops spending production's 100 CU-hours and their branch delta stops spending its 1 GB.

### 10.4 Pruning policy (daily `HOUSEKEEPING` job on the OCI worker)

Each rule runs in batches of 1,000 (`DELETE … WHERE id IN (SELECT id … LIMIT 1000)`) until nothing is left, so WAL and locks stay small. The job wakes the compute once a day, at about 03:30 UTC, for about 0.03 CU-h.

| # | Rule | SQL sketch |
|---|---|---|
| P1 | Jobs: DONE after 7 days; FAILED and CANCELLED after 30 | `DELETE FROM jobs WHERE status = 'DONE' AND "finishedAt" < now() - '7 days'` |
| P2 | Webhook events: payload nulled at 7 days, row deleted at 30 | `UPDATE webhook_events SET payload = NULL WHERE "receivedAt" < now() - '7 days' AND payload IS NOT NULL` |
| P3 | Idempotency keys past `expiresAt` | `DELETE FROM idempotency_keys WHERE "expiresAt" < now()` |
| P4 | Rate-limit buckets more than 1 hour past reset (also lost on compute restart) | `DELETE FROM rate_limit_buckets WHERE "resetAt" < now() - '1 hour'` |
| P5 | Notifications after 90 days | `DELETE FROM notifications WHERE "createdAt" < now() - '90 days'` |
| P6 | Coach messages after 180 days (threads kept) | `DELETE FROM coach_messages WHERE "createdAt" < now() - '180 days'` |
| P7 | Training sessions: ACTIVE for over 24 h becomes ABANDONED; finished ones are deleted after 90 days | `UPDATE training_sessions SET status = 'ABANDONED' WHERE status = 'ACTIVE' AND "startedAt" < now() - '24 hours'` |
| P8 | Daily plan JSON after 7 days | `UPDATE training_days SET plan = NULL WHERE day < current_date - 7 AND plan IS NOT NULL` |
| P9 | Weakness snapshots: newest 12 per user | `DELETE … WHERE ("userId", "weekStart") NOT IN (SELECT … ORDER BY "weekStart" DESC LIMIT 12)` (per user, via `row_number()`) |
| P10 | Training attempts older than 24 months (after the FSRS optimiser has been fitted; owner decision O7) | `DELETE FROM training_attempts WHERE "reviewedAt" < now() - '24 months'` |
| P11 | **Imported, unanalysed games older than 12 months** with no occurrences, shares or coach threads. Delete the member's `game_players` row, then delete the game when no player row is left. Also caps each member at the newest 2,000 unanalysed imported games | `DELETE FROM game_players gp USING games g WHERE g.id = gp."gameId" AND g.source <> 'REPLAY' AND g."analysisStatus" IN ('NONE','SKIPPED') AND gp."playedAt" < now() - '12 months' AND NOT EXISTS (…occurrences/shares/threads…)` |
| P12 | Dead Replay games: EXPIRED, CANCELLED or ABORTED with fewer than 2 plies, older than 30 days, not in a tournament | `DELETE FROM games WHERE status IN (…) AND "plyCount" < 2 AND "createdAt" < now() - '30 days' AND "tournamentId" IS NULL` |
| P13 | Expire friend invites and abandoned live games (the socket server owns liveness: skip games it reports active) | `UPDATE games SET status = 'EXPIRED' WHERE status = 'WAITING_FOR_OPPONENT' AND "expiresAt" < now()` (via `games_open_idx`) |
| P14 | Challenges: EXPIRED, DECLINED or CANCELLED after 30 days | |
| P15 | Shares: expired REVIEW shares after 7 more days; revoked after 30 | |
| P16 | Username history after 90 days | |
| P17 | Consent records after 24 months | |
| P18 | Audit log after 400 days | |
| P19 | Account deletions after completion + 3 years (no PII) | |
| P20 | **Lapsed members**, 12 months after `membershipEndedAt` with no renewal: delete imported unanalysed games, coach messages and review logs. Keep the account and the analysed reviews only if "past reviews stay readable" is approved (`implementation-plan.md:56`, owner decision O8), else offer an export, then purge | |
| P21 | `matchmaking_queue` rows not SEARCHING after 1 day (until C2) | |

**Backups:**

- Nightly `pg_dump -Fc` from the OCI box over `DIRECT_URL` to R2 (`replay-backups/neon/YYYY-MM-DD.dump`), keeping 14 daily and 2 weekly copies (≤ 30 days, which is what the deletion copy promises; P13 D9), encrypted with `age`. From P1 until the worker's `BACKUP` job exists (P13), a GitHub Actions workflow dumps live production nightly (`backup-prod.yml`, architecture §2.3.9). `BACKUP` is disabled on dev. Free keeps one manual snapshot, so the release workflow deletes the previous one before taking a new one.
- A custom-format dump compresses to roughly a third of the database size. At a full 1 GB database, the 16 retained dumps take about 5–6 GB, inside R2's free 10 GB; `BACKUP` alerts above 6 GB in total.

---

## 11. Migration plan

### 11.1 Rules

1. **Production and every shared branch change only through migration files applied with `prisma migrate deploy`** (with `DIRECT_URL` and the owner role).
   - `prisma migrate dev` only ever runs against a local Docker Postgres or a throwaway branch (CLAUDE.md rules 2 and 3).
   - `prisma db push` is **not** used on any Neon branch (production, dev, or the dev project). It writes no history, which is how the 2026-03-08 loss started. It would also drop the hand-written partial indexes and `NOT VALID` constraints, which the schema language cannot express.
   - This conflicts with CLAUDE.md rule 1 ("Use `prisma db push`") and with the inventories that repeat it. **Owner decision O1:** change rule 1 to `migrate deploy`. CLAUDE.md already says the new `production` branch has "all migrations applied with `prisma migrate deploy`".
2. **Expand, then contract.**
   - An expand migration only adds: new tables, nullable columns, columns with constant defaults (metadata-only since PG 11), new indexes, new enum values, `DROP NOT NULL`, and `NOT VALID` foreign keys.
   - A contract step (C1–C7) ships at least one release later, after a fresh dump, with the owner's confirmation (CLAUDE.md rule 5).
3. **One concern per file.**
   - `ALTER TYPE … ADD VALUE` goes in its own file, before any statement that uses the value.
   - `VALIDATE CONSTRAINT` goes in its own file.
   - `CREATE INDEX CONCURRENTLY` cannot run in a transaction block, so it goes in a single-statement file. It is needed only once a table passes about 1M rows; today every table is under 10k.
4. **Every hand-edited migration starts with `SET lock_timeout = '5s';`**, so a migration fails fast instead of queueing behind a long transaction and blocking traffic.
5. **Never rename or retype a column in place.** Use `@map` for code names (for example `clerkUserId @map("googleId")`), and add-backfill-switch-drop for type changes.
6. **New enum values are written only after every deployed client knows them.** An old Prisma client throws when it reads an unknown enum value.
   - Order: migration → deploy web (new client) → deploy the socket server and worker → start writing the value.
   - **Two-release rule (feasibility §9):** release N ships the value in the schema and every client without writing it; release N+1 writes it, so a rollback from N+1 to N is safe. Fast-growing sets (`JobKind`, notification kinds, audit actions, report targets) may use `text` + a zod enum instead (§3.5). Whether Prisma wraps an `ADD VALUE` file in a transaction on PG 17 is checked in CI [V10].
   - Example: `GameStatus.ABORTED` is written only by the protocol-v2 socket path, behind the `live-protocol-v2` flag (audit-socket §22).
7. **New `NOT NULL` columns always have a default**, so inserts from the previous deployment keep working during a rolling deploy. Checked: every new required column on an existing table has a default (`moves ""`, `plyCount 0`, `rated false`, `source REPLAY`, `analysisStatus NONE`, `seriesNo 1`, `studySeconds 0`, `timeZone "UTC"`, `onboardingStep WELCOME`, `goals []`, `visibility PUBLIC`, `hasExplanation false`, `popularity 0`, `participantCount 0`, `standingsVersion 0`, `scoring {...}`, the participant counters).

### 11.2 Per-migration procedure

1. Edit `packages/db/prisma/schema.prisma` (or `apps/web/prisma/schema.prisma` until the package move).
2. Generate the SQL against a **local** shadow database, so no Neon branch, CU-hour or shared DB is involved:

   ```bash
   docker run -d --rm --name rc-shadow -e POSTGRES_PASSWORD=pw -p 55433:5432 postgres:17-alpine
   pnpm --filter web exec prisma migrate diff --from-migrations prisma/migrations \
     --to-schema-datamodel prisma/schema.prisma \
     --shadow-database-url postgresql://postgres:pw@localhost:55433/postgres --script \
     > prisma/migrations/<ts>_<name>/migration.sql
   ```

3. Hand-add the raw SQL for this phase (§5) and `SET lock_timeout`. Hand-edit the generated `ADD CONSTRAINT … FOREIGN KEY` on existing tables to `NOT VALID`, and the generated `CREATE TABLE "rate_limit_buckets"` to `UNLOGGED`.
4. **Drift check with the protected-index list** (§11.3): `prisma migrate diff --from-migrations … --to-schema-datamodel … --exit-code` must report no change, apart from the `DROP INDEX` lines for names listed in `prisma/protected-indexes.txt`, which `scripts/db/check-drift.ts` filters out. This runs in CI (audit-db §4.3 step 6).
5. Verify locally: `prisma migrate deploy` from scratch on a local Docker Postgres 17, run the seed (§13), then `pnpm --filter web check-types` and the e2e suite.
6. Rehearse on Neon: create a child branch of `production`, `migrate deploy` with the branch's direct URL, run the backfills with `--dry-run` and then `--apply`, run the smoke tests, delete the branch. Branches count against the 10-branch limit, so delete it right away.
7. Take the single Free-plan manual snapshot of `production`, plus an on-demand `pg_dump` to R2.
8. `prisma migrate deploy` on `production` (from CI or a laptop, never from the Vercel build).
9. Deploy the code (§11.5), run the backfills (§11.6), check the verification queries.

### 11.3 Partial indexes and Prisma drift

- **Prisma 6.17.1 cannot express partial indexes.** Adding `previewFeatures = ["partialIndexes"]` to the target schema and running `prisma validate` fails with: *The preview feature "partialIndexes" is not known. Expected one of: fullTextSearchPostgres, metrics, nativeDistinct, postgresqlExtensions, relationJoins, schemaEngineDriverAdapters, shardKeys, strictUndefinedChecks, views.*
- **Known behaviour:**
  - Prisma issue [#13417](https://github.com/prisma/prisma/issues/13417) reports manually created partial unique indexes being dropped or recreated by later generated migrations.
  - A prisma-engines change ([commit ab73dcf](https://app.semanticdiff.com/gh/prisma/prisma-engines/commit/ab73dcf0b34b9ac77280e9b5fb2a48207b38bc8f)) stops dropping manually created partial indexes as drift when the `partialIndexes` preview is off, but only in versions that contain it.
  - Custom-opclass indexes created in SQL (for example trigram) are reported as drift and dropped ([Answer Overflow thread](https://www.answeroverflow.com/m/1425883069759492227)).
- **Handling:**
  - Every hand-written index is listed in `prisma/protected-indexes.txt`, and in the header comment of `schema.prisma` (the target already has it).
  - `scripts/db/check-drift.ts` fails CI if any generated migration contains `DROP INDEX` for a protected name.
  - Before M2, check on the local shadow whether the installed Prisma emits those drops at all. If a later Prisma release ships `partialIndexes`, upgrade and move the partial indexes into PSL as `@@index([...], where: raw("…"))`.
  - Avoid expression indexes and custom opclasses entirely (none are planned, §8).
- **`UNLOGGED`, `fillfactor` and `SET COMPRESSION`** are storage parameters that Prisma's diff does not model, so they cause no drift. Check this once on the local shadow after M1.

### 11.4 Migration files and order

| # | Folder (timestamps are set when written) | Contents | Phase | Depends on |
|---|---|---|---|---|
| M1 | `2026xxxx_m1_hardening` | `users` billing columns; `webhook_events`, `trial_ledger`, `idempotency_keys`, `rate_limit_buckets` (UNLOGGED), `audit_logs`; `users_trial_reminder_idx`; `matchmaking_queue_one_searching` (+ the stale-search expiry) | 0.5 | — |
| M1b | (withdrawn) | `users."timeZone"` moves to M4 (P4); `user_settings` + reminder index move to M9 (P9) | — | — |
| M2a | `…_m2a_game_status_aborted` | `ALTER TYPE "GameStatus" ADD VALUE 'ABORTED'` | 2 | — |
| M2 | `…_m2_play_model` | new enums; `games` columns (play + import identity); `expiresAt DROP NOT NULL`; `game_players`, `player_ratings` (if O3 = yes), `challenges`, `shares`; FK `games_chessPositionId_fkey NOT VALID`; partial indexes; lz4 | 2 | M2a |
| M2v | `…_m2v_validate_position_fk` | `VALIDATE CONSTRAINT games_chessPositionId_fkey` | 2 | B0 |
| M3 | `…_m3_analysis` | `jobs`, `game_analyses`, `player_reviews`; `games.analysisStatus`; `openings.epd`, `hasExplanation`, `explanationUrl`; `chess_positions.hasExplanation`, `explanationUrl`; job indexes | 3 | M2 |
| M4 | `…_m4_import_onboarding` | `linked_accounts`, `import_cursors`, partial indexes; `users` onboarding columns | 4 | M3 |
| M5 | `…_m5_training` | `mistakes`, `mistake_occurrences`, `training_cards`, `training_attempts`, `training_sessions`, `training_days`, `theme_mastery`, `training_profiles`, `reports`; fillfactor; lz4 | 5 | M3 |
| M6 | `…_m6_weakness` | `weakness_snapshots` | 6 | M5 |
| M7 | `…_m7_coach` | `coach_threads`, `coach_messages`, `coach_usage_days`; partial unique streaming | 7 | M3 |
| M8 | `…_m8_learn_tournaments` | `lessons`, `lesson_steps`, `lesson_progress`, `legend_comparisons`, `tournament_positions`; `legends` / `chess_positions` / `openings` / `tournaments` / `tournament_participants` columns; catalogue partial indexes | 8 | M3 |
| M9 | `…_m9_identity_notifications_deletion` | `users` identity columns; `username_history`, `push_subscriptions`, `notifications`, `user_blocks`, `account_deletions`, `consent_records`; the four FK swaps (`NOT VALID`) + nullability | 9 | all |
| M9v | `…_m9v_validate_user_fks` | `VALIDATE` the four FKs | 9 | M9 |
| C1–C7 | `…_c1_drop_redundant_indexes`, … | §5.11 | after their triggers | owner confirmation |

Phases 4 and 7 can land before 5 and 6 (`implementation-plan.md:226`). The dependency column is the real constraint.

### 11.5 Zero-downtime order per phase

| Step | Action | Why it is safe |
|---|---|---|
| 1 | `migrate deploy` the expand migration | The previous code ignores new tables and columns. New required columns have defaults (§11.1.7) |
| 2 | Deploy readers that tolerate both shapes. Example: the review loader reads `games.moves` and falls back to `gameData.moveHistory` when `moves = ''` | Old rows keep working before the backfill |
| 3 | Deploy writers of the new columns, behind a PostHog flag where behaviour changes (`live-protocol-v2`, `review-v3`, `bank-v1`) | Can be rolled back by flag |
| 4 | Run the backfill (§11.6) with `--dry-run`, then `--apply` | Idempotent; resumable by id cursor |
| 5 | Verify: zero rows match the "needs backfill" predicate, and the spot checks pass | |
| 6 | Remove the fallback reads in the next release | |
| 7 | Contract step (§5.11) one release later, after a dump and the owner's confirmation | |

**Rollback:** an expand migration is backward compatible, so rollback means redeploying the previous code. The schema stays. Down-migrations are not written. Contract steps are undone from the dump taken right before them.

### 11.6 Backfill scripts (`apps/web/scripts/backfill/*.ts`, later `packages/db/scripts`)

Every script follows the same rules:

- `--dry-run` is the default; `--apply` writes.
- Batches of 500: `WHERE id > $cursor ORDER BY id LIMIT 500`.
- Idempotent through its predicate.
- Refuses to run unless the `DATABASE_URL` host is in `BACKFILL_ALLOWED_HOSTS`.
- Prints the counts and writes one `audit_logs` row (`SYSTEM`, `backfill.<name>`, counts in `meta`).
- They are data scripts, not schema migrations (audit-db §4.3 step 8).

| ID | Script | Phase | Source → target | Predicate | Verification |
|---|---|---|---|---|---|
| B0 | `null-orphan-position-ids.ts` (owner confirmation: a data change) | M2 → M2v | `games."chessPositionId"` pointing at no row → `NULL` | `NOT EXISTS (SELECT 1 FROM chess_positions p WHERE p.id = g."chessPositionId")` | 0 orphans, then M2v |
| B1 | `game-play-columns.ts` | M2 | `gameData` → `mode`, `moves`, `moveClocksMs` (empty: legacy rows have no clocks), `plyCount`, `fen`, `startPly`, `endMethod`, `outcome`, `whitePlayerId` / `blackPlayerId`, names and ratings, `timeClass`, `completedAt` (game) and `game_players."endedAt"`, `whiteTimeMs` / `blackTimeMs` | `mode IS NULL` | Each `moves` replays legally from `startingFen` with chess.js; `plyCount` = the token count; checkmate games end in mate |
| B2 | `game-players.ts` | M2 | One row per member side of COMPLETED games with a known colour | `NOT EXISTS (… game_players …)` | counts = completed games × member sides |
| B3 | `catalog-keys.ts` | M3 / M8 | `openings.epd` (first 4 FEN fields), `hasExplanation`; slugs for legends (`paul-morphy`), openings (`c50-italian-game`) and positions (featured and practice), deduped `-2`, `-3`; `openings.popularity` from `count(games."openingId")` | `epd IS NULL` / `slug IS NULL` | Unique indexes hold |
| B4 | `explanations-to-r2.ts` | M3 | `explanation` JSON → R2 `explanations/{position\|opening}/{referenceId}.v1.json`; set `explanationUrl` | `explanation IS NOT NULL AND "explanationUrl" IS NULL` | SHA-256 of the DB JSON = SHA-256 of the R2 object; then C5 |
| B5 | `linked-accounts.ts` | M4 | `chess_com_profiles` → `linked_accounts` (`CHESSCOM`, `username` = handle, `externalId` = handle until the first sync fetches `player_id`, `ratings` JSON from the 26 rating columns, `verifiedAt` NULL, `importState` IDLE) | `NOT EXISTS (… linked_accounts …)` | One link per profile |
| B6 | `onboarding.ts` | M4 | `onboardingStep = DONE`, `onboardedAt = "updatedAt"` where `onboarded` | `onboardingStep = 'WELCOME' AND onboarded` | |
| B7 | `tournaments.ts` | M8 | `slug`, `score = round(points × 2)`, `participantCount`, `TournamentPosition(order 0)` from opening / legend / position FEN, `displayName` snapshots, `finalStandings` for COMPLETED | `slug IS NULL` | Ranks by `score` equal the old ranks by `points` |
| B8 | `usernames.ts` | M9 | `username` = the Chess.com handle if free, else `slug(name)` + `_` + `code`; `usernameKey` = lower; `displayName = name`; system users excluded | `"usernameKey" IS NULL` | Unique; regex `^[A-Za-z0-9_]{3,20}$` |
| B9 | `trial-ledger.ts` | M1 | Users with `trialStartedAt` → `trial_ledger (emailHash)` | `ON CONFLICT DO NOTHING` | count = users with a used trial |
| B10 | `strip-gamedata.ts` (contract C1, owner confirmation) | C1 | Remove `moveHistory` and `traceContext` from `gameData` | `"gameData" ? 'moveHistory'` | Only after B1 is verified and the dump is taken |
| B11 | `legend-practice-seed.ts` | M8 | The five design positions: slugs, themes, blurbs, time controls, legend moves. Check the Anderssen and Paulsen positions against the real game scores first (`implementation-plan.md:187`) | upsert by `fen` | Admin verify flow |

**B1 details** (the hardest one):

- **`mode`:**
  - `gameData.gameMode` `"AI"`, `"ai"` → `BOT`, or `LEGEND_BOT` when `chessPositionId` or `selectedLegend` is set.
  - `friend` → `FRIEND`; `quick` → `ONLINE`; `tournament` → `TOURNAMENT`.
- **Colours, only where provable:**
  - AI games: `gameData.playerColor` (the human is the creator, `apps/web/app/api/chess/create-ai-game/route.ts:228-230`).
  - Matchmaking and tournament games: creator = White by construction (`matchmaking.service.ts:260-261`, `apps/web/app/api/tournament/find-match/route.ts:146-147`).
  - Friend games: `gameData.creatorColor` when present.
  - Otherwise leave the colour null, set `meta.colorUnknown = true`, and exclude the game from Weakness (audit-socket §18.2).
- **Moves:** `moves` comes from `moveHistory[].lan`, or `from + to + promotion`.
- **The missing mating move (DB-03):** when `gameData.method = 'checkmate'` and the replayed position is not mate, search the legal moves for the one whose resulting FEN equals `gameData.fen`, and append it. Count the fixes. audit-db Appendix A query 7 sizes this beforehand.
- **`endMethod`:**
  - Map `gameData.method`.
  - For a stored `draw_agreement`, replay the moves: a final position that is a threefold repetition or meets the fifty-move rule becomes `THREEFOLD` / `FIFTY_MOVE` (they are mislabelled today, audit-db §3.3).
- **`timeClass`** from `initialTimeSeconds + 40 × incrementSeconds`, with Lichess bands: < 180 s bullet, < 480 s blitz, < 1,500 s rapid, otherwise classical.
- **Unchanged legacy values:** `rated = false` (legacy games were unrated) and `game_players."endedAt" = games."completedAt"`.

---

## 12. Old production → new production

**Facts:**

- **Old:** account pandit.rohit0007, project `shy-morning-50748774`, branch `br-still-brook-a5nutqwh`, database `prisma_migrate_shadow_db_696341e6-c32e-46e7-8f09-b53758dedd0f`. It still serves the live site. The last known counts are 104 users, 378 games, 3,641 openings, 51 legends and 18 tournaments (CLAUDE.md).
- **New:** account replaychess007, project `withered-cake-82837167` (AWS us-east-1), branch `production` (`br-shiny-shape-b8lvr0f5`), at migration 17 and empty of user data (CLAUDE.md).
- **Reads of the old project need the owner's approval.** The audit's read-only probe was blocked (audit-db §0).

### 12.1 Runbook

Each destructive step is marked **[confirm]** and needs the owner's explicit yes: "This command may reset or drop data. Are you sure?"

1. **Schema parity, read-only.**
   - Check that `SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY 1` on the old database lists the same 17 names as `apps/web/prisma/migrations/`, none rolled back.
   - Run `prisma migrate diff --from-url "$OLD_DIRECT_URL" --to-migrations prisma/migrations --shadow-database-url <local docker> --exit-code`. Any drift: **stop**. Do not "fix" it with `migrate dev`; that is the 2026-03-08 failure.
2. **Sizing, read-only.** Run audit-db Appendix A queries 1–7: table sizes, `moveHistory` sizes, explanation sizes, stale games, duplicate SEARCHING rows, bot share and checkmates missing their last move.
3. **Freeze.** Turn on maintenance mode on the old site (writes stop) in a low-traffic window. Dodo webhooks that arrive meanwhile are replayed in step 10.
4. **Full backup.** `pg_dump -Fc --no-owner "$OLD_DIRECT_URL" > old-full-$(date +%F).dump`, copied to R2 and a laptop. It replaces `/tmp/chess_battle_data_fixed.sql` as the recovery dump in CLAUDE.md.
5. **Data-only dump.** `pg_dump -Fc --data-only --no-owner --no-privileges --exclude-table-data=_prisma_migrations --exclude-table-data=matchmaking_queue "$OLD_DIRECT_URL" > old-data.dump`. `pg_dump` orders table data by foreign-key dependency, and a data-only dump includes the `setval` for each sequence.
6. **Target check.**
   - `_prisma_migrations` on new `production` lists the same 17 names.
   - `SELECT count(*)` is 0 in every table. If not, **stop** and ask.
   - Take the Neon snapshot of `production`.
7. **Restore** **[confirm]**: `pg_restore --data-only --no-owner --single-transaction --exit-on-error -d "$NEW_PROD_DIRECT_URL" old-data.dump`. `--disable-triggers` and `session_replication_role` are not used; they need superuser, which Neon does not grant.
8. **Verify.**
   - The per-table `count(*)` matches the old database.
   - `md5(string_agg("referenceId", ',' ORDER BY id))` matches per table.
   - Each sequence's `last_value` ≥ `max(id)`.
   - The 3,641 openings are byte-identical, so the seed TSVs (`apps/web/public/openings/{a..e}.tsv`) match.
9. **Upgrade.** `prisma migrate deploy` for M1 (and anything else merged by then), then B9, B6 and B3.
10. **Cut over.**
    - Point the Vercel `replay-chess` production env `DATABASE_URL` / `DIRECT_URL` at the new branch, using the runtime role `replay_app` (audit-db §5.4).
    - Point the Dodo live webhook at the new deployment.
    - Replay the webhooks missed in the freeze window (Dodo dashboard resend). Alternatively, run a one-off script that calls `applySubscriptionSnapshot` for every user with a `subscriptionId`, rate-limited.
11. **Clerk.** The new production Clerk instance (replaychess007) issues new user ids, while `users.googleId` holds the old instance's ids. Two options:
    - **(a)** Relink on first sign-in by verified email. This already exists (`apps/web/app/api/user/sync/route.ts:56-79`). Add an `audit_logs` row per relink, and email users that the site moved.
    - **(b)** Bulk-import users into the new Clerk with `externalId = referenceId`, then rewrite `googleId` by script.
    - Recommended: (a). Google sign-in users keep the same email.
12. **Old project:** read-only for 30 days, then delete **[confirm]**.

### 12.2 Table mapping

| Old table | New table(s) | Copy | Transform afterwards |
|---|---|---|---|
| `users` | `users` (`user_settings`, `training_profiles` are created lazily) | yes | B9 trial ledger, B6 onboarding, B8 usernames (Phase 9). System users: keep `CHESS_BOT_001`, which is the creator or opponent of every AI game. `DEMO_PLAYER_001` and its `/try` guest games: deleting the user cascades its games today (`schema:90-91`), so delete it before M9 only with confirmation, or mark it `isActive = false` |
| `games` | `games` + `game_players` | yes | B1, B2; queue no analyses for legacy games (members can open one to analyse it) |
| `user_stats` | `user_stats` (read-only) | yes | Dropped in C4 |
| `chess_com_profiles` | `linked_accounts` | yes | B5; dropped in C4 |
| `chess_positions` | `chess_positions` | yes | B3, B4, B11 |
| `legends` | `legends` | yes | B3 (slugs); Phase 8 bios, era keys and style tags |
| `openings` | `openings` | yes | B3 (`epd`, slug), B4 (explanations) |
| `tournaments`, `tournament_participants` | the same + `tournament_positions` | yes | B7 |
| `matchmaking_queue` | — | **no** (ephemeral) | — |
| `_prisma_migrations` | — | **no** (the target has its own, identical names) | — |
| Dodo customers and subscriptions | unchanged (the same Dodo account, live mode) | — | Webhook URL moved; replay the gap |
| Clerk users | new instance | — | Relink by email (step 11) |
| R2 media (`media.playchess.tech`) | unchanged | — | — |

---

## 13. Dev seed strategy

**Rule: the dev database never holds production personal data.** It gets public content copied read-only from the old production database, plus synthetic users and activity.

### 13.1 Where dev lives

- **From P1 (1B·H10):** a separate Neon Free project, `replay-chess-dev`, holding dev (autoscaling max 0.5 CU). It gets its own 100 CU-hours and its own 1 GB (audit-db DB-01, api-perf AP-01). The owner restores today's `dev` branch into it (`pg_dump` → `pg_restore` on the owner's machine) and updates CLAUDE.md's environments table; phase specs refer to "the Neon dev branch (CLAUDE.md)" and never hard-code branch ids.
- **Until then:** the `dev` branch of `withered-cake-82837167`, which is a child of `production` and shares its quotas. **Never run Neon's `reset_from_parent` on `dev`** once production holds real users: it would copy their PII into dev.
- **CI** uses Docker Postgres 17 for integration and e2e and never touches Neon. The shadow database for migrations is a **local Docker Postgres 17** (§11.2), never Neon.
- `BACKUP` is disabled on dev (`BACKUP_ENABLED=false`): a nightly dump costs egress and is not needed.
### 13.2 Content copy (read-only from old production)

- Use `scripts/content/export-content.ts`, run once with the owner's approval, under a read-only role or the console's read-only mode.
- It exports `legends`, `chess_positions` (including `explanation` until C5, and `explanationAudioUrl`) and the `openings` columns that are not in the TSVs (`explanation`, `explanationAudioUrl`).
- The output goes to `content-v1.json.gz` in a **private** R2 bucket (`replay-seed/`). Its SHA-256 is committed in `prisma/seed-data/content.lock`.
- Legends are public figures and positions are product content; there is no user data in it. The file is about 3 MB raw, so it stays out of git.
- **Openings** are already reproducible from `apps/web/public/openings/{a..e}.tsv` through `apps/web/prisma/opening-seed.ts` (idempotent via `skipDuplicates`, `:77-80`). The export only adds the explanation fields, keyed by `(eco, name, pgn)`.
- **Load order:** legends first (positions reference them through `whitePlayerId` / `blackPlayerId`), then positions, then opening explanations. Everything upserts by natural key (`legends.name`, `chess_positions.fen`, the `(eco, name, pgn)` unique).

### 13.3 Seed layout (`prisma/seed/`, replacing the single `prisma/seed.ts`)

| File | Creates | Idempotency |
|---|---|---|
| `index.ts` | Orchestrates; refuses unless `SEED_TARGET=dev` and the `DATABASE_URL` host is in `DEV_DB_HOSTS`; never `TRUNCATE` | — |
| `system.ts` | The bot user `CHESS_BOT_001` (`prisma/seed.ts:7-29`). **Drop** the demo user (`:33-56`): `/try` is gone (Phase 0) | upsert by email |
| `content.ts` | `opening-seed.ts`, then the R2 content export (§13.2); the legend-practice metadata (B11) and lessons from `content/lessons/*.json` once authored (validated by `scripts/lessons/build.ts`) | upsert by natural key |
| `personas.ts` | The users in §13.4, with settings, links, entitlement fields and training state | upsert by `email` (`persona+<name>@seed.replaychess.local`) |
| `fixtures.ts` | Games, analyses, reviews, mistakes and cards for the personas (§13.5) | `games.externalId = 'fixture-<n>'` with `source = LICHESS` (unique), and `Mistake.epdHash` unique |
| `reset-personas.ts` | Deletes only persona users (`email LIKE '%@seed.replaychess.local'`); the cascades remove their rows | — |

Commands: `pnpm --filter web db:seed` (all) and `pnpm --filter web db:seed:personas -- --reset`.

### 13.4 Personas → design states

Each persona puts a v3 board in its designed state with real data. Personas sign in through Clerk dev users made by `apps/web/e2e/scripts/provision-test-users.ts`, extended with `--personas`. The E2E users A–R stay untouched.

| Persona | Entitlement fields | Data | Boards and states it exercises |
|---|---|---|---|
| `new` | none, `onboardingStep = LINK` | nothing linked | onboarding link → plan; `V3HomeNewUser`; `V4Membership` free; `V4SettingsConnected` none_linked; `V3BankEmpty`; `V3WeaknessInsufficient` 0/20 |
| `trial` | `subscriptionStatus = active`, `trialStartedAt` = 2 days ago, `trialEndsAt` = +5 days | Chess.com linked, `importState = RUNNING`, `importDone` 212 / `importTotal` 480; 14 analysed games; 6 due cards | `V3Home` import running and trial; `V4MembershipTrial`; `V4SettingsConnected` syncing; `V3WeaknessInsufficient` 14/20; `V3TrainHub` |
| `member` (main) | active monthly | Chess.com and Lichess linked (both_linked); 480 imported + 120 Replay games; 40 analysed; one game with 3 key moments vs `tal_fan_77` (the `V3ReviewSummary` mock game), one clean game (the CLEAN mock), one `RUNNING` analysis (static, `gradedPlies` 23/61), one `FAILED`; 41 bank items with due, overdue, new and mastered (mastery 0–5) cards; a 4-day streak (best 9); weakness READY with 3 patterns and a 12-week trend; 2 coach threads; 3 notifications | `V3Home` populated; `V3TrainHub`; `V3MistakeBank` default and filtered; `V3BankSession`; `V3SessionSummary`; `V3ReviewSummary`, `V3KeyMoments`, `V3ReviewClean`, `V3ReviewAnalysing`, `V3ReviewFailed`, `V3RvComplete`; `V3WeaknessProfile`; `V3GamesArchive` + filters; `V4Profile` overview, games and stats; `V3CoachSuggested`, `V3CoachStreaming` (live) |
| `caughtup` | active yearly | today's `training_days.bankReviewed` = 10; future due cards over 7 days | `V3BankCaughtUp` ("Coming up"), `V3TrainHubDone`; `V4Membership` active_yearly |
| `pastdue` | `subscriptionStatus = on_hold`, `lastPaymentFailedAt` = yesterday | as `member`, smaller | the `V3PaymentFailed` banner; `V4MembershipPastDue` |
| `cancelling` | `cancelAtPeriodEnd = true` | — | `V4MembershipCancelling`; the `V4CancelSub` done state |
| `lapsed` | `subscriptionStatus = expired`, `membershipEndedAt` = 12 days ago | 10 analysed reviews | Membership ended; the coach's membership-ended state; read-only reviews (if O8 is approved) |
| `legacy` | `plan` = the legacy $8 product (grandfathered) | — | `V4Membership` legacy |
| `ratelimited` | active | `coach_usage_days.questions` at the cap for today | `V3CoachRateLimit` |
| `syncfailed` | active | `linked_accounts.status = ERROR` with `lastError`; a second account `RATE_LIMITED` with `nextAllowedSyncAt` = +30 s | `V4SettingsConnectedError` sync_failed and rate_limited |
| `private` | active, `visibility = PRIVATE` | — | `V4ProfilePrivate`, `V4ProfileOther` private |
| `admin` | `role = ADMIN` | 3 open `reports`, `audit_logs` activity | `V4Admin*` |

**Shared content seeded with the personas:**

- Tournaments in LOBBY (starts in 30 min, 6 participants), ACTIVE (ends in 20 min, 30 participants with scores and fire), COMPLETED (podium + `finalStandings`) and CANCELLED, for the `V4Tournament*` states.
- Challenges OPEN and EXPIRED.
- A POSITION share and a REVIEW share.

**Seeded billing state is fake.** `sub_seed_*` ids are not in Dodo test mode. Persona pages read the DB (`GET /api/subscription` is DB-first, inv-pub §1.5), but "Refresh", the customer portal and plan switch fail for them. Billing flows are tested with the E2E users and real Dodo test-mode subscriptions.

### 13.5 Fixtures

- **Games:** 60 CC0 games from the Lichess open database, with `%clk` and `%eval`, in `prisma/seed-data/games/*.pgn` (licence noted in the folder README).
  - They are parsed by the same `packages/chess-import` code the worker uses, so seeded games exercise the real parser.
  - Persona names replace the real players' names (`whiteName`, `blackName`); the original Site URL is dropped.
- **Analyses:** precomputed once by the worker CLI (`pnpm --filter analysis-worker fixtures`) into `prisma/seed-data/analyses/*.json` (`GameAnalysis`, `GamePlayer` stats, `Mistake`, `PlayerReview` content). Seeding needs no Stockfish and no LLM. Regenerate when `GRADING_VERSION` or `STATS_V1` changes; a unit test fails if the fixture version is stale.
- **The design's mock games** (`V3ReviewSummary.dc.html` GAME and CLEAN arrays) are included as fixtures, with their expected labels (inv-rct-a §2.3). The same files back the classifier unit tests.
- **Training state** comes from a seeded PRNG (mulberry32, seed 42) relative to `now()` at seed time, so "due today" is always due on the day the seed runs:
  - card `due` spread from −3 to +14 days;
  - `training_attempts` for the last 9 days, which makes the streak;
  - `theme_mastery` rows matching the logs;
  - a frozen `training_days.plan` for today.

### 13.6 E2E and perf

- E2E keeps its own users (A–R, `apps/web/.env.test`) and creates any data it needs through the API. It does not depend on personas, so a persona reset never breaks a test.
- Perf (`perf/k6`) runs on a separate branch of the dev project, seeded with `--scale 100` (100 synthetic members, about 60k games). That is about 0.5 GB, measured from §10.1: 100 × 4.4 MB. Use it to check the index plans with `EXPLAIN (ANALYZE, BUFFERS)` for every query in §5 before Phase 10.

---

## 14. Open decisions that change the schema

| # | Decision | Default in this plan | Schema impact if the answer differs |
|---|---|---|---|
| O1 | Replace CLAUDE.md rule 1 (`db push` on shared DBs) with `migrate deploy` (= architecture D5) | `migrate deploy` on every Neon branch; no `db push` on Neon | If `db push` stays, the partial indexes, `NOT VALID` FKs and `UNLOGGED` table cannot be used: replace every partial index with a full one and lose the race-free uniqueness (`coach_messages_streaming_key`, `linked_accounts_verified_key`) |
| O2 | Neon plan for production | Launch before charging (P13 D17), 7-day restore window set explicitly; dev in its own Free project from P1 | None. Pruning P10, P11 and P20 can be relaxed on Launch |
| O3 | Are REPLAY games rated (Glicko per pool)? | yes (P9, `PLAY` preset) | If no: drop `player_ratings`; `ratingBefore` keeps the imported or displayed rating only |
| O4 | Weakness threshold: 20 analysed games (design) or 10 (plan) | 20, preliminary from 5 | None |
| O5 | Coach caps | `CT/limits.ts` (`01-architecture.md` CR-33): member 30/day, 150/month, $1.50; trial 10/day, 40/trial, $0.40 | None: `coach_usage_days` supports both |
| O6 | Create PUZZLE cards for clean first-try solves? | no (only Again or Hard) | yes ≈ 2.5× the PUZZLE card rows |
| O7 | Keep `training_attempts` for 24 months, then delete | 24 months | Longer: +0.8 MB per typical member-year |
| O8 | "Past reviews stay readable" for lapsed members (**B26**, decide before P3) | B26 default: hard redirect, data kept 12 months | If read-only is approved: `requireMember({allowLapsedRead:true})` on review reads; P20 unchanged |
| O9 | Backup retention vs the deletion copy ("backups clear within 30 days") | 14 daily + 2 weekly (≤ 30 days) | None (R2 lifecycle rule) |
| O10 | Ownership proof for Chess.com links | Allow unverified links; the verified owner takes over | If verification becomes mandatory: a full unique index on `(provider, externalId)` |
| O11 | Public read-only replay of another player's games | moves only, no engine data | None |
| O12 | Move `schema.prisma` into `packages/db` | yes, P2 WP-A, its own PR before M2 | None |
| O13 | Store the Lichess token? (feasibility F-API-3) | No: use it for the initial import, then revoke | If stored: `linked_accounts.accessTokenEnc` sealed with the worker's public key, `LINK_TOKEN_KEYS`, the `lichess_revoke` purge step |
| O14 | `JobKind` (and other fast-growing sets) as `text` + zod instead of Postgres enums | P3 decides in M3 | Enum: every value follows the two-release rule; text: no rollback hazard |
---

## Appendix A. Files and checks

| Path | Purpose |
|---|---|
| `/private/tmp/claude-501/-Users-rohitpandit-open-source-chess-battle-turbo/8433de47-73d2-466e-945c-3c2450748123/scratchpad/plan/schema.target.prisma` | Full target schema (2027 lines, 49 models, 51 enums), formatted, valid with Prisma 6.17.1 |
| `/private/tmp/claude-501/-Users-rohitpandit-open-source-chess-battle-turbo/8433de47-73d2-466e-945c-3c2450748123/scratchpad/plan/schema.target.diff.sql` | Generated DDL from today's schema to the target (1359 lines) |
| `/private/tmp/claude-501/-Users-rohitpandit-open-source-chess-battle-turbo/8433de47-73d2-466e-945c-3c2450748123/scratchpad/plan/schema.target.raw.sql` | Hand-written SQL (partial indexes, storage settings) |
| `/private/tmp/claude-501/-Users-rohitpandit-open-source-chess-battle-turbo/8433de47-73d2-466e-945c-3c2450748123/scratchpad/sizes/gen2.sql`, `measure2.sql`, `c1.sql`, `moveeval.sql` | Size measurement scripts (§10.1) |

**Checks that were run (2026-11-02):**

```text
prisma validate --schema schema.target.prisma            → "The schema … is valid"
prisma migrate diff (schema.prisma → schema.target.prisma) → 39 CREATE TABLE, 45 CREATE TYPE, 49 indexes, 54 FKs;
                                                           DROPs: 4 (FK constraint swaps only)
docker postgres:17-alpine: prisma migrate deploy (17 repo migrations) → OK; + diff → OK; + raw SQL → OK
synthetic rows + size queries                             → §10.1
prisma validate with previewFeatures ["partialIndexes"]    → P1012 "not known"; ["relationJoins"] → valid
neon docs search (plans page)                              → Free: 1 GB storage/project, 100 CU-h/project, 5 GB egress, 10 branches;
                                                           unlogged tables are emptied when the compute restarts or scales to zero
```

## Appendix B. Critique dispositions (revision 2)

| Finding | Disposition | Where |
|---|---|---|
| consistency R-01 (games / game_players contract) | Applied: P2 names; columns assigned to M3/M4/M6/M8/M9/M12 | §0.2 D2, §1, §3.2, §4, §5.0, §5.3 |
| consistency R-02 (tables that exist: `TrainingCard`, `Report`, no `KeyMoment`, `SupportRequest`, …) | Applied | §0.2, §1, §5.0 |
| consistency R-03 (`User.timeZone` in M4) | Applied | §0.2 D13, §5.0 |
| consistency R-04 (`AuditLog` in M4) | Applied | §0.2 D15, §4, §5.0 |
| consistency R-05 (Job columns, kinds, priorities) | Applied, with `DAILY_PLAN` instead of `HOURLY_TICK` (architecture CR-10) | §3.5, §4, §5.0 |
| consistency R-11 (socket writes directly, tournament exception) | Applied | §0.2 D22, §3.22, §7.1 |
| consistency §3 (renumber M-ids, D1/D2/D8/D22, regenerate `schema.target.prisma`) | Applied (ledger + crosswalk; regeneration flagged as a task) | header, §5.0.2, §5.0.3 |
| api-perf AP-06 (`subscriptionSourceAt`, CAS) | Applied in M1 (P1 F4b) | §0.2 D25, §5.0 |
| api-perf AP-07 (index drift) | Applied for `games_open_idx`, card and coach index names; the `playedAt` rename **rejected** (consistency R-01 keeps `endedAt`, which needs no extra live-game index) | §3.2, §8 |
| api-perf AP-09 (`jobs."lastKickAt"`) | Applied | §3.5, §5.0 |
| api-perf AP-11, feasibility F-NEON-3 (UNLOGGED limits, email budget) | Applied: bursts only; `RateLimitWindow` or source-row counts; `notifications_sent_day_idx` | §0.2 D15, §1, §8 |
| api-perf AP-19 (`gamesVersion`) | Applied (M1, bumped by P2, P3, P4) | §0.2 D24, §7.1, §7.2 |
| api-perf AP-27 (analysis write path) | Applied: one HTTP batch of natural-key statements or `rc_apply_analysis` | §7.2 |
| api-perf §4.2 item 2 (`/api/review/[ref]`, no `review:<ref>` room) | Applied by substitution in §7.4 | §7.4 |
| feasibility F-NEON-4 (PGN stored) | Applied; re-measure [V9] | §0.2 D1, §3.1 |
| feasibility F-NEON-5, §10.4 (backups 14 + 2, dev disabled, one snapshot) | Applied | §10.4, §13.1 |
| feasibility F-NEON-1 (dev project in P1) | Applied | §13.1 |
| feasibility F-API-3 (Lichess token) | Applied as the recommended default; P4 decides | §0.2 D6, §14 O13 |
| feasibility §9 (enum two-release rule, `text` + zod, `ADD VALUE` in its own file) | Applied | §3.5, §11.1, §14 O14 |
| feasibility 10.2 item 9 (measure with real PGN text) | Applied as [V9] | §3.1 |
| critique-testing X16 (CI on Docker Postgres, dev project) | Applied | §13.1 |
