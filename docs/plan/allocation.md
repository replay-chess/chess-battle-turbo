> **Frozen copy** of the session scratch file `SP/plan/allocation.md` (2026-11-02), committed by the plan assembly because every plan file cites it as ALLOC (binding decisions B1–B26 in §2, the Definition of Done in §1.1). Precedence: where `01-architecture.md` §0.3 (CR-01 … CR-37) records a deliberate deviation, §0.3 wins; estimates in §0 are superseded by each phase spec's §13; the board matrix in §4 is superseded by `07-design-coverage.md`. Index: [README.md](README.md).

# Phase allocation and design coverage: Replay Chess coaching app

Status: plan, 2026-11-02, branch `dev` @ `0848b76`. Once the owner approves it, this file replaces §2 "Phases" and §3 "Order and timeline" of `docs/implementation-plan.md`. §1 of that file (the paid-only model) still applies.

**What this file decides.** It sets when each piece of the app ships (Task 1, §0–§3). It also assigns every design board to one phase and one feature (Task 2, §4). For each phase it lists what that phase must deliver: schema, endpoints, socket events, jobs, routes, components and boards, with links to the detailed specs. It also settles the naming conflicts between the inventories (§2). Without that, each phase's spec writer would hit them again.

**Path shorthands**

| Short | Path |
|---|---|
| `REPO` | `/Users/rohitpandit/open_source/chess-battle-turbo` |
| `WEB`, `WS` | `REPO/apps/web`, `REPO/apps/web-socket` |
| `SP` | `/private/tmp/claude-501/-Users-rohitpandit-open-source-chess-battle-turbo/8433de47-73d2-466e-945c-3c2450748123/scratchpad` |
| `DR` | `SP/design-ref/project/v2` (board files `*.dc.html`) |
| inventories | `SP/plan/inv-pub.md`, `inv-play-a.md`, `inv-play-b.md`, `inv-rct-a.md`, `inv-rct-b.md`, `inv-acct.md`, `inv-sys.md`, `inv-research.md` |
| audits | `SP/plan/audit-api.md`, `audit-db.md`, `audit-client.md`, `audit-socket.md`, `audit-quality.md` |
| Phase 1 spec | `SP/phase1/SPEC.md` (UI track of Phase 1; authoritative for that track) |

References like "play-a §4.3" point into those files. "F-01" style IDs are the findings in the audit named in the same sentence.

---

## 0. The plan on one screen

| Phase | Name | Goal | What the owner can test on dev at the end | Depends on | Dev-days | Boards |
|---|---|---|---|---|---|---|
| 0 | Paid-only billing, trial, dev environment | **Done** (`8514fea`) | — | — | done | — |
| 1 | Design system, app shell, API foundations | One UI kit inside one shell (track 1A), and one route wrapper, error contract, typed client, rate limiter and viewer bootstrap (track 1B). The live security holes are closed first. | Existing signed-in pages run inside the v3 shell on 8 devices × 5 zoom levels. Also: ⌘K, `?`, toasts, the payment banner, the `/dev/ui` gallery. Admin, game-over and PII holes are closed, also on `main`. An app boot is 1 server read instead of the UserSync waterfall. Errors are consistent, with a request id. | P0 | 17 (1A 9 ∥ 1B 8) | 12 |
| 2 | Board and live game | The rebuilt board, socket protocol v2 with restart-safe persistence, and the v3 game screen in all 55 states, for human and bot games | A full human game on any device, plus a bot game with hint and undo. A socket deploy mid-game resumes the game. Spectate, rematch with colour swap, abort, draw offers and reconnect all work. | P1 | 28 | 33 |
| 3 | Server analysis and Game Review | Native Stockfish on OCI grades every finished game. Review, key moments, complete, share, My games, legend compare and practice replace `/analysis`. | Finish a game, watch badges arrive in about 10 s, then summary → 3 key moments → complete → public share link. `/games` lists every game. | P2 | 28 | 20 |
| 4 | Game import and onboarding v3 | Chess.com and Lichess import feed the same pipeline. The onboarding funnel through trial checkout is rebuilt. | A fresh user signs up and goes through welcome → link → confirm → level → goals → trial checkout (Dodo test card) → activating → import progress → first imported review. Connected accounts can sync and unlink. | P3 | 16 | 27 |
| 5 | Mistake Bank, puzzles, Train and Home | Mistakes become FSRS cards, with themed puzzles, the Train hub daily plan and the Home dashboard. **This is the first release worth charging for** (import → review → bank → train). | Mistakes from reviewed games appear as puzzles. The drill, grading, theme puzzles, session summary, Train hub streak and plan, and Home all work. Members land on `/home`. | P3 (P4 for volume) | 26 | 35 |
| 6 | Weakness Profile | Aggregated patterns against a rating-band baseline, with drills | Insufficient → computing → profile → drill a weakness | P4, P5 | 9 | 8 |
| 7 | AI coach | An engine-grounded, verified chat over SSE, with a fair-use cap. The LLM review text replaces the P3 templates. | Ask about any move from Review. Streaming, error with engine-line fallback, rate limit and membership-ended states all work. ⌘K Ask works. | P3 (P5, P6 add context) | 16 | 11 |
| 8 | Learn: legends, legend practice, openings, lessons | The public SEO catalogues on ISR, and the members-only legend practice games and lessons | Browse legends, positions and openings signed out. As a member, play a legend position vs the bot → compare → review. Lessons with guess and stars, and the opening drill. | P2, P3, P5 | 24 | 47 |
| 9 | Play hub, matchmaking, challenges, ratings | The v3 Play hub. Matchmaking moves onto the socket (DB polling ends), plus friend challenges, shared positions and Glicko-2 ratings. | Hub tabs Legend, Bot, Friend and Online. Quick match with no opponent → bot fallback. Challenge a friend, also accepted signed out via sign-up. `/s/[code]`. Rating deltas show. | P2, P8 | 15 | 20 |
| 10 | Profile, settings, membership, notifications | The account area | `/@username` with tabs, edit, other/private/guest views, the settings shell with every section, membership in 12 states with plan switch and cancel, delete account, push reminders | P1–P9 | 20 | 39 |
| 11 | Public site, auth, system screens, PWA | The marketing site, Clerk custom auth, error/offline/maintenance pages, consent, PWA | Landing, pricing, blog, help, contact, legal; v3 sign-in/up/verify/reset; 404/500/global error; offline page; maintenance banner; cookie consent; install and update prompts | P3, P5, P8 | 20 | 41 |
| 12 | Tournaments and admin | Arena pairing and scheduling move onto the socket, plus the v3 tournament screens and the admin tools | List → invite join → lobby → live arena → game → results; admin dashboard, positions, legends, create tournament | P2, P9 | 17 | 21 |
| 13 | Production launch | Prod Vercel, prod Clerk, Dodo live, old-prod data migration, DNS cutover, monitoring, backups, rollback | `playchess.tech` serves the new app; old data is present; rollback has been rehearsed | all | 8 | — |
| — | superseded | v1 and v2 canvas pages, plus one off-canvas draft | used only for ideas | — | — | 47 |

**Size.** About 245 dev-days for one developer working with Claude, including tests and the dev deploy. The 13-week timeline in the old plan covered roughly P0–P7 at a much thinner scope (no socket v2, no onboarding v3, no system screens, no launch). Phases can overlap after P3, because they touch different routes:

```
P1 ─ P2 ─ P3 ─┬─ P4 ─ P5 ─ P6 ─ P7 ──────────────┬─ P13
              └─ P8 ─ P9 ─ P12      P10 ∥ P11 ───┘
```

With two parallel streams after P3 (coaching stream P4→P7; play and learn stream P8→P9→P12), the calendar is about 32 weeks. The hot spots for merge conflicts between the streams are `packages/db` (schema), `packages/game-core` and the shell nav config, and each one has a single owner per week.

**Milestones**

| ID | When | Meaning |
|---|---|---|
| M1 | end of P2 | Every game is played on v3 and survives a deploy |
| M2 | end of P5 | Import → review → Mistake Bank → train: the chargeable core |
| M3 | end of P9 | Feature-complete play, coaching and learning |
| M4 | end of P12 | Every v3 board built |
| M5 | P13 | Launch. *Early-launch option:* run P13 straight after P11 and ship P12 afterwards. The legacy tournament pages still run inside the shell. |

**Changes against `docs/implementation-plan.md`**

| Old | New | Why |
|---|---|---|
| Phase 1, DS + shell (≈1 week) | P1 adds **track 1B**: security hotfixes and the API/data foundations | Every later phase needs the wrapper, envelope, client and limiter (audit-api §7, audit-client §11.3–11.5). SPEC.md D14 keeps track 1A schema-free, so 1B is a separate track. |
| Phase 2, board + game (≈1.5 weeks) | P2, 28 d: socket v2, persistence redesign, bot games run on the client. Play hub and matchmaking move to P9. | audit-socket F-01…F-14 and §17. SPEC R3 already defers the legacy entry pages to "Phases 8–9". |
| Phase 3, per-ply `MoveEval` table | Packed `GameAnalysis` + `PlayerReview` + `KeyMoment` | ~1.6 KB per game instead of ~21.6 KB (audit-db DB-10, rct-a Q15) |
| Phase 3, worker on the socket box | Dev: a container on the dev VM. Prod: its own A1 VM, 2 OCPU / 12 GB | Stockfish on the 1-OCPU socket box starves the clocks (audit-socket F-38). 1 + 1 + 2 OCPU stays within the 4-OCPU Always Free allowance. |
| Phase 3, LLM summary | P3 ships deterministic template text; P7 swaps in LLM text plus the verifier | It keeps LLM risk out of the first review release |
| Phase 4, import | + onboarding v3, + Connected accounts, + checkout activating | The link step *is* the import UI. The activating screens share one endpoint and one component (pub §2.7, §2.19). |
| Phase 5, `LichessPuzzle` (1M rows), `ReviewCard` | R2 puzzle shards; `TrainingCard`/`TrainingAttempt`; + Train hub + **Home** | Neon 1 GB cap (audit-db §12.3, rct-b D5). Home and the Train hub share the daily-plan data (sys §3.18–3.19). |
| Phase 8, legends + lessons + play hub + admin | P8 Learn, P9 Play hub; admin moves to P12 | Size. The hub's Legend tab needs P8's legend-practice routes. |
| Phase 9, profile, settings, system, auth | P10 account area; P11 public, auth, system and PWA | Size (39 + 41 boards) |
| Phase 10, quality gates | A Definition of Done for every phase (§1.1), with CI from P1 | Tests ship with the feature they cover |
| (Phase 0 bullets: prod Vercel, DNS, data dump) | P13 Production launch | Prod stays on the old stack until the new app is complete |

---

## 1. Rules every phase follows

### 1.1 Definition of done ("shippable to dev")

1. **It is deployed to every dev target:**
   - merged to `dev`;
   - Vercel `replay-chess-dev` green;
   - OCI dev socket (and from P3 the worker) redeployed by `.github/workflows/deploy-oci.yml`;
   - the Neon `dev` branch on the phase's migration;
   - Clerk development instance and Dodo test mode.
2. **Flags.** The phase's PostHog flags (§1.6) are on for the owner and E2E users A–P on dev. Legacy screens stay reachable behind the flag until the phase's parity check passes, then they are deleted in the same phase.
3. **CI green:**
   - lint, `check-types`, unit (`node:test` via `tsx`) and the migration drift gate (audit-db §4.3 step 6);
   - Playwright signed-in specs (members A–P, non-member R) plus the **device × zoom suite** from P1 (`playwright.devices.config.ts`: 8 devices × 80/100/110/125/150 %). Every board page in the phase asserts that the board's bounding box is inside the viewport and that `document.scrollingElement.scrollHeight <= innerHeight`.
4. **States reachable.** Every board assigned to the phase in §4 has a reachable route. Every value in its `data-props` state enum can be reached from real data, or from a dev-only demo route (`/dev/ui/...?state=`, SPEC D11).
5. **No dead links.** A slot that belongs to a later phase is hidden behind that phase's flag (§1.2).
6. **Owner test script.** The bullets under "Owner test" in the phase pass on the dev URL with ego-browser. Phases with a board are also checked on a real iPhone and a real Android phone.
7. **No new errors.** Vercel runtime errors and Sentry show no new 5xx over the test window. k6 budgets are met where the phase lists them.
8. **Docs.** The phase spec is written (like SPEC.md for P1) and `docs/implementation-plan.md` points to it.

### 1.2 Board ownership and "lights up"

- A board belongs to the phase where its **route and primary states first ship**. Device boards of the same screen always go to the same phase.
- A screen often has slots fed by a later phase: the Home bank card, the Review-complete drill CTA, a game-over rating delta. The **later** phase owns turning that slot on. Each phase lists these under "Lights up". Until then the slot is not rendered. It is never a disabled stub.

### 1.3 Database changes (CLAUDE.md applies; owner sign-off needed on one point)

- Every phase writes **additive (expand) migrations**:
  1. Edit `schema.prisma`.
  2. Generate SQL with `prisma migrate diff --from-migrations … --to-schema-datamodel … --shadow-database-url <throwaway Neon branch>` (audit-db §4.3).
  3. Hand-add what Prisma can't express: partial indexes, `UNLOGGED`, `NOT VALID` FKs.
  4. Commit it.
- On the Neon **dev** branch, apply with `prisma migrate deploy`, or with `prisma db push` while iterating. Run `prisma migrate dev` only on a throwaway branch. That is stricter than CLAUDE.md, which allows `migrate dev` on the dev branch. The dev branch also holds the E2E users, and a reset there would wipe them.
- **Production** gets the migrations only through `prisma migrate deploy`. It happens in P13, after a rehearsal on a child branch of `production`, plus any hotfix migration. Contract steps (drop column, index or table; tighten NOT NULL) ship one release later, and each one is confirmed by the owner (CLAUDE.md rule 5).
- **Owner sign-off:** CLAUDE.md rule 1 says "prod: use `db push`", while the same file says the new production branch is migrated with `migrate deploy`. This plan follows audit-db §4.2: migration files plus `migrate deploy` for prod, and `db push` on dev only. That changes rule 1's wording.
- Data backfills are idempotent TypeScript scripts in `WEB/scripts/`, batched 500 rows at a time. They are never schema migrations.

### 1.4 Branches and environments

- New-app work ships to `dev` only. Until P13, `main` gets only the P1 security hotfixes and any change the live site's v1 socket protocol needs. A push to `main` deploys the prod OCI socket at 132.226.190.10 (CLAUDE.md "Environments").
- Local dev uses `WEB/.env.development.local`: Neon dev, Clerk dev, Dodo test.

### 1.5 Free-tier guard rails and cost

| Resource | Limit | How the plan stays inside it |
|---|---|---|
| OCI Always Free | 4 OCPU / 24 GB / 200 GB in total (CLAUDE.md) | dev 1/6/50 + prod socket 1/6/50 + prod worker 2/12/50 (created in P13) = 4/24/150. The dev worker is a container on the dev VM. Nothing is resized beyond the allowance. |
| Vercel Hobby | Daily crons only; non-commercial use only | No sub-daily Vercel cron: frequent jobs run on the OCI worker scheduler. **The move to Pro is an owner decision before charging customers** (P13). |
| Neon Free | 100 CU-h, 1 GB per project; scale to zero after 5 min | Packed analysis; puzzles on R2; no timer polling (the worker is woken by a kick); matchmaking leaves the DB (P9); ISR catalogues (P8). Dev and E2E move to their own project before P13 (audit-db DB-01). |
| R2 | 10 GB free, free egress | Puzzle shards, avatars, exports, backups |
| Claude API | Paid per token | P7 fair-use budget per member, prompt caching, cost tracked server-side in PostHog |

### 1.6 Feature flags (PostHog, server-evaluated by `lib/flags.ts` from P1)

`shell-v3` (P1), `live-protocol-v2` + `game-v3` (P2), `review-v3` (P3), `import-v3` + `onboarding-v3` (P4), `train` + `home` (P5), `weakness` (P6), `coach` (P7), `learn-v3` (P8), `play-hub-v3` (P9), `account-v3` (P10), `public-v3` + `auth-v3` + `consent` (P11), `tournaments-v3` (P12). After launch each flag is removed one release after it reaches 100 %.

---

## 2. Binding decisions across the inventories

The inventories were written in parallel and sometimes name the same thing differently. These decisions bind every phase spec.

| # | Topic | What the inventories say | Decision | First phase |
|---|---|---|---|---|
| B1 | Per-user game index | `UserGame` (play-b, sys), `GamePlayer` (play-a, audit-db §11.2), `PlayerGame` (acct) | **`GamePlayer`** (`game_players`, PK `(gameId, userId)`), carrying play-b's list fields: `color, result, endedAt, opponentName, opponentRating, timeClass, source, ratingBefore/After/Delta, accuracy, momentsCount, headline, analysisStatus, hasComparison`. Index `(userId, endedAt DESC, gameId DESC)` | P2 creates; P3, P4 and P9 fill |
| B2 | Colours | `whitePlayerId` (play-a) vs `whiteUserId` (audit-db) | `Game.whitePlayerId` / `blackPlayerId` (null side = bot), fixed at creation | P2 (stopgap `gameData.creatorColor` in P1 H6) |
| B3 | Move storage | All agree | `Game.moves` (space-separated UCI), `moveClocksMs Int[]`, `plyCount` as the optimistic guard. No per-ply rows. `pgn` (with `%clk`) is written once at game end | P2 |
| B4 | Who persists live games | audit-db §5.3: keep the socket DB-free and call the web API at checkpoints. audit-api §7.3 and socket §18: the socket writes directly | The socket server writes **directly to Neon (pooled) through `packages/db`, at checkpoints only**: every 10 plies or 15 s, plus one end-of-game transaction. An append-only journal on the OCI volume covers restarts. That is ≤ ~10 writes per 80-ply game against ~80 HTTP calls and full-history rewrites today (DB-03), and no Vercel invocation per move. | P2 |
| B5 | Job queue | `AnalysisJob` (rct-a), `ImportRun` as a queue (pub), generic `Job` (audit-db §11.4) | **One `Job` table** (`kind`, `priority`, `dedupeKey @unique`, `runAt`, `attempts`, `lockedBy/At`, `lastError`, `payload`), claimed with `FOR UPDATE SKIP LOCKED`. Partial index `jobs_ready_idx (priority DESC, runAt) WHERE status='QUEUED'`. `ImportRun` stays as the user-visible progress row. | P3 |
| B6 | Analysis storage | Per-ply `MoveEval` (old plan), packed (audit-db, rct-a) | `GameAnalysis` (packed per-ply arrays + `gradingVersion` + `gradedPlies` for resume), `PlayerReview` (per player), `KeyMoment` (≤ 3 per player). The worker checkpoints every 10 plies, so a failure can resume. | P3 |
| B7 | Eval cache | `PositionEval` table in Neon (rct-a) vs SQLite on the worker's disk (audit-db §11.5) | **SQLite on the worker's disk**, seeded from Lichess CC0 evals near the book. It costs no Neon storage, and the coach's engine tool calls the worker anyway. | P3 |
| B8 | Judgement labels | The old plan has 11; the design has 12 | 12, including `INTERESTING`. Icons are the owner's `public/board_icons` (user memory; `sharp.svg` or a new icon for Interesting). The DS `mq-*` tokens are used for colours only. | P2 (badge), P3 (grading) |
| B9 | Linked accounts | `LinkedAccount` (pub, acct) vs `ExternalAccount` (audit-db) | **`LinkedAccount`**. Dual-write `ChessComProfile` until contract step C4. | P4 |
| B10 | Account endpoints | `/api/accounts/*` (pub §1.7) vs `/api/me/linked-accounts/*` (acct #25–29) | **`/api/accounts/*`** (lookup, link, Lichess start/callback, list, sync, unlink) | P4 |
| B11 | Training tables | `ReviewCard`/`ReviewLog` (plan, audit-db) vs `TrainingCard`/`TrainingAttempt` (rct-b) | **rct-b names**, with one engine and three decks (`BANK`, `PUZZLE`, `OPENING`). `ts-fsrs@^5` behind a wrapper (Node 24 needed for v6). | P5 |
| B12 | Daily plan and streak | `DailyPlan` + `UserStreak` (sys) vs `TrainingDay.plan` + `TrainingProfile.dayStreak` (rct-b) | **rct-b**: the plan lives in `TrainingDay.plan`, created on the first read of the local day. The streak is updated inside the attempt transaction. No cron. | P5 |
| B13 | Puzzle corpus | 1M-row table (plan) vs R2 shards (rct-b D5, audit-db DB-10) | **R2 shards** `puzzles/v1/{theme}/{band}.json`, immutable and CDN-cached. Only cards and attempts go into Neon. | P5 |
| B14 | Preferences | `UserSettings` (acct) vs `UserPreference` (sys) | **`UserSettings`** (typed columns + versioned JSON). One endpoint, `GET/PATCH /api/me/preferences`. | P9 (botStrength), P10 |
| B15 | Webhook dedupe | `BillingEvent` (pub) vs `WebhookEvent` (audit-db DB-07) | **`WebhookEvent`** (`provider`, `eventId @unique`, `payload`, `receivedAt`) for Clerk and Dodo. Billing payloads are kept 180 days. | P1 |
| B16 | Error envelope | `{error: string, code}` (pub, play) vs `{error:{code,…}}` (audit-client §11.4) | `{ data, meta? }` / `{ error: { code, message, fields?, retryAfterSec?, requestId } }`, and the HTTP status always matches the code | P1 |
| B17 | Shared contracts package | `packages/protocol` (client audit), `packages/game-protocol` (socket), `packages/contracts` (quality) | **`packages/contracts`** with `http/` and `socket/` (zod 4) | P1 (`http/`), P2 (`socket/`) |
| B18 | Route wrapper | `lib/api/route.ts` (audit-api) vs `lib/api/define-route.ts` (quality) | `WEB/lib/api/route.ts`, exporting `route()` | P1 |
| B19 | Client data layer | — | TanStack Query v5, key factory `WEB/lib/api/keys.ts`, RSC prefetch + `HydrationBoundary` | P1 |
| B20 | Socket event names | `analysis:progress` (play-b, acct) vs `analysis_progress` (sys, pub) | **`domain:event`**: `analysis:progress`, `import:progress`, `entitlement:changed`, `bank:due_changed`, … One internal fan-out route, `POST /internal/emit {room, event, data}` with `x-internal-token`, which merges `/internal/user-event`, `/internal/notify` and `/internal/review-event`. | P2 |
| B21 | Review URLs | `/api/review/:ref/*` (rct-a) vs `/api/games/[ref]/review` (audit-api §7.6) | **rct-a**: page `/review/[gameRef]`, API `/api/review/:ref/*`. `/analysis/*` → 308. | P3 |
| B22 | Game list | `/api/me/games` (play-b A14) vs `/api/games` (client audit) | **`GET /api/me/games`**. Another player's games: `GET /api/players/{username}/games` (P10) | P3 |
| B23 | Start a game | — | `POST /api/games {mode: BOT \| LEGEND_BOT, …}` + `Idempotency-Key`, plus `/checkpoint` and `/complete` (play-a §5, play-b A4–A8). Friend games come from `/api/challenges` (P9). | P2 |
| B24 | Profile URL | — | `/@username`, rewritten to `/u/[username]`. `/profile/[ref]` → 301. | P10 |
| B25 | Legend and position URLs | cuid today | Slugs with 301s from the cuid URLs. Sitemaps are updated in the same release. | P8 |
| B26 | Lapsed members | Phase 0: hard redirect. The canvas: "past reviews stay readable" | **Default: hard redirect** to `/pricing?reason=ended`, and data is kept. If the owner approves read-only access (pub Q1, rct-a Q2), `requireMember({allowLapsedRead:true})` applies to review, archive and bank GETs only. | decide before P3 |

---

## 3. Phases in detail

Each phase lists: goal, owner test, dependencies, boards, build list (schema · packages · server · HTTP · realtime · jobs · client), lights up, optimisation, tests and the owner decisions to settle before it starts.

### P1 · Design system, app shell and API foundations (17 dev-days; 1A and 1B run in parallel)

**Goal.** Phases 2–12 should only need to add feature code. Track 1A is the UI foundation, exactly as in SPEC.md. Track 1B covers the security fixes and the server and client contract that every endpoint and screen uses.

**Owner test.**

- Track 1A:
  - Sign in as a member: `/play`, `/tournaments`, `/legends`, `/openings` and `/profile` render inside the sidebar (desktop), rail (iPad L) and tab bar (phones, iPad P).
  - ⌘K finds "Morphy" (needs the seed).
  - `?` opens the shortcuts sheet and G-chords navigate.
  - Toasts stack top-right (bottom-centre on phones).
  - `/dev/ui/shell?user=payment` shows the payment banner.
  - `/dev/ui/stage` keeps the board on screen at 80–150 % zoom.
- Track 1B:
  - `curl -X POST /api/legends/create` without auth → 401.
  - A member who is not a player gets 403 from `POST /api/chess/game-over`.
  - `GET /api/user/email/<x>` → 404.
  - Hard-loading `/play` shows exactly one `/api/me` request (or none, when server-rendered).
  - Forcing a 429 on `/api/openings` shows the inline countdown.
  - Expiring the Clerk session shows the session-expired modal.

**Depends on.** P0.

**Boards (12).** `V3Nav`, `V3FlowMap` (the reference route graph), `V3Toasts`, `V3iPhoneToasts`, `V3iPadPToasts`, `V3CommandPalette`, `V3Shortcuts`, `V3Skeletons`, `V3EmptyStates` and `V3PaymentFailed` are track 1A. `V3RateLimited` and `V3SessionExpired` are track 1B.

**Track 1A (SPEC.md packages P0–P6, unchanged).**

- Tokens go into `WEB/app/globals.css`, keeping the `--cb-*` names.
- `WEB/components/ui/*`: about 30 primitives on Radix.
- `WEB/components/shell/*`: sidebar, rail, tab bar, account menu, palette (`cmdk`), shortcuts dialog, payment banner, online chip, route hairline.
- `WEB/components/layout/{ViewportStage,BoardStage,ScrollRegion}` and `ChessBoard` `squareSize="fill"`.
- Route group `WEB/app/(app)/`.
- `playwright.devices.config.ts` (40 projects).
- `WEB/prisma/seed-content.ts`: design fixtures on the dev branch only.
- The nav shows Play (+Tournaments), Learn (Legends, Openings) and Profile. **Home, Train, Review and Settings stay hidden until P5, P5, P3 and P10.**

**Track 1B, part H: security hotfixes (≈3 d; ship first, then cherry-pick to `main`).**

| # | Fix | Where | Closes |
|---|---|---|---|
| H1 | `requireAdmin()` on the 6 admin writes and on `GET /api/chess-positions` (cap `limit` at 50, select only the listed columns) | `WEB/app/api/legends/create/route.ts:26`, `legends/[id]/route.ts:27,191`, `chess-positions/create/route.ts:44`, `chess-positions/[id]/route.ts:167,348`, `chess-positions/route.ts:10-11` | audit-api F-01, DB-14 |
| H2 | `POST /api/chess/{move,game-over,game-state}` accept only `isInternalServiceRequest`. `game-over` runs `updateMany({where:{id, status:'IN_PROGRESS'}})` inside its transaction and stops on `count === 0` | `WEB/app/api/chess/game-over/route.ts:50-58,83-120`, `move/route.ts`, `game-state/route.ts` | F-02, DB-04 |
| H3 | Delete `api/user/[referenceId]`. Strip DOB and role from `api/user/email/[email]` now; delete it once `/api/me` lands (F4 below) | `WEB/app/api/user/[referenceId]/route.ts:19-55`, `user/email/[email]/route.ts:25-60` | F-03, DB-08 |
| H4 | `game-by-ref`: participants (or the internal token) get the snapshot; everyone else gets an invite projection (players, time control, status) | `WEB/app/api/chess/game-by-ref/[gameReferenceId]/route.ts:5-97` | F-04, client #7 |
| H5 | Rotate the Clerk secret key committed in `REPO/k8s/secrets.yaml:12`, and delete `REPO/k8s/` | owner action in the Clerk dashboard | quality SEC-03 |
| H6 | Socket P0 set (audit-socket §19, items 1–13): `accept_draw` needs a player with a pending opponent offer; `SOCKET_AUTH_REQUIRED=true` (dev, then prod `WS_ENV_FILE`), and `join_game` ignores the id in the payload; token on `/internal/tournament-event`; persist the final move; write `gameData.creatorColor` at creation and read it in analysis; restore by replaying `moveHistory`, with a length guard; evict ended sessions; `AbortSignal.timeout(8000)` + 3 retries; reconnect includes `isAIGame`; SIGTERM drain + `stop_grace_period: 30s`; forfeit winner via `getGameResult` | `WS/GameSession.ts:66,197-207,429-442,467-513,559-561,620-630`, `WS/index.ts:42,115-131,367-385`, `WS/utils/apiClient.ts`, `WEB/lib/services/tournament/notify-websocket.ts:11-23`, `REPO/deploy/oci/docker-compose.yml` | socket F-01…F-11, F-16 |
| H7 | `logger.error` → `Sentry.captureException`; remove `details: error.message` from the 25 routes | `WEB/lib/logger.ts:42-52` | F-05, F-12 |
| H8 | Service worker: `/api/*` NetworkOnly, no HTML runtime cache, purge on sign-out | `WEB/next.config.js:13-35`, `public/sw.js` | client #11 |

**Track 1B, part F: API and data-layer foundations (≈5 d).**

| # | Deliverable | Files and details |
|---|---|---|
| F1 | Route wrapper | `WEB/lib/api/route.ts`: `route({ auth: 'public'\|'user'\|'member'\|'owner'\|'admin'\|'internal', params, query, body, cache: 'public-static'\|'private-etag'\|'no-store', rateLimit, maxBodyBytes, idempotent }, handler)`. Input is parsed once (400 `invalid_json`/`validation_failed` with `fields`, 413 on size). Also: a BigInt-safe serialiser, ETag for the cacheable tiers, a Sentry span per route, and `requestId` from middleware's `x-request-id`. The internal token uses a timing-safe compare and a path allow-list, which retires `INTERNAL_ROUTE_PATHS` (`WEB/lib/auth/resolve-user.ts:21-25`). Reference migrations: `GET /api/healthcheck` → `GET /api/health`, `GET /api/openings`, `GET /api/socket-token`. Other legacy routes move when a phase touches them. |
| F2 | Contracts | `REPO/packages/contracts/http/{envelope,codes,cursor,me}.ts`. Codes: `unauthorized`, `subscription_required` (+`reason`: `trial_available`\|`trial_used`\|`expired`\|`payment_failed`), `forbidden`, `not_found`, `validation_failed`, `invalid_json`, `payload_too_large`, `conflict`, `already_subscribed`, `payment_update_required`, `rate_limited`, `upstream_unavailable`, `maintenance`, `internal`. The cursor is opaque base64url of `{k, id}` for keyset pagination. Added to `transpilePackages` in `WEB/next.config.js`. |
| F3 | Typed client and cache | `WEB/lib/api/client.ts`: `api<T>(path, {method, body, schema, signal, idempotencyKey, timeoutMs=15000})` throws `ApiError`. `WEB/lib/api/keys.ts` is the `qk` factory. `WEB/app/providers.tsx` holds a `QueryProvider` whose `QueryCache`/`MutationCache` `onError` handles 401 → `SessionExpiredModal`, 402 → `/pricing?reason=…&redirect_url=`, 429 → `RetryCountdown`, 503 → maintenance hook, 5xx → toast with the request id. Defaults: `staleTime` 30 s; retry twice on network or 5xx and never on 4xx. `WEB/lib/query/server.ts` provides `makeQueryClient()` and the RSC prefetch pattern (audit-client §11.5). |
| F4 | Viewer and entitlement | `WEB/lib/auth/viewer.ts` `getViewer()` (React `cache()`, one select of ~15 columns by `googleId`); SPEC's `getShellSession()` is re-pointed to it. `requireMember()` returns 402 with a `reason` (`WEB/lib/auth/require-subscription.ts:30-58`). `GET /api/me` (pub §1.7, without accounts and import until P4). `POST /api/webhook/clerk` (svix: `user.created/updated/deleted`). The Dodo webhook writes `WebhookEvent` and calls `syncClerkClaims` → Clerk `publicMetadata.entitled` + a custom session-token claim. `WEB/middleware.ts:16-26` is inverted to a public allow-list and gates on the claim with no DB read (client §11.1). `WEB/app/components/UserSync.tsx:93-156` leaves the hot path. Entitlement is no longer persisted (`WEB/lib/stores/useUserStore.ts:150-156`), and "unknown" is not treated as "not entitled" (client #4). `GET /api/subscription` reads the DB first and calls Dodo only on `?refresh=1` or when the data is more than 6 h old. |
| F5 | Postgres rate limiter | `RateLimitBucket` (`key text PK, count int, resetAt timestamptz`, created `UNLOGGED` in the migration SQL) and `WEB/lib/rate-limit-db.ts` (one `INSERT … ON CONFLICT … RETURNING count, resetAt`, pub §1.7) replace the in-memory `WEB/lib/rate-limit.ts:13-38`. Exposed as the `route({rateLimit})` option. A daily cron sweeps expired rows until the worker exists (P3). |
| F6 | Flags | `WEB/lib/flags.ts` (server PostHog evaluation, memoised per request) and `useFlag()` |
| F7 | CI | `.github/workflows/ci.yml` on `dev` pushes and PRs. Lint (fix the broken lint first, quality B-01), `check-types`, `test:unit`, the Prisma drift gate and a bundle budget report. E2E stays in `e2e-tests.yml`. |
| F8 | 401/429 UI | `RetryCountdown` (inline), `/too-many-requests` (force-static, retries the original URL, sys C14), `SessionExpiredModal` (Clerk re-auth, returns to the same URL). The in-game silent refresh is P2. |
| F9 | DB roles (dev branch) | The `replay_app` DML-only role with `statement_timeout=15s`, `idle_in_transaction_session_timeout=30s` and `lock_timeout=5s` (audit-db §5.4). Prod gets the same in P13. |

**Schema M1 (dev).** `RateLimitBucket`, `WebhookEvent`. Nothing else, so SPEC D14 still holds for track 1A.

**Track coordination (SPEC §3.1 file ownership).**

- Track 1B owns the files that SPEC assigns to nobody: `WEB/middleware.ts`, `WEB/app/components/UserSync.tsx`, `WEB/prisma/schema.prisma`. It also owns `WEB/lib/api/**`, `WEB/lib/auth/**`, `WEB/lib/query/**`, `WEB/app/api/**`, `REPO/packages/contracts` and `WS/**`.
- Three files belong to 1A's P0 and P3 packages: `WEB/next.config.js` (H8, `transpilePackages`), `WEB/app/layout.tsx` (mounting `QueryProvider`) and `WEB/instrumentation-client.ts`. Track 1B changes them only in one small follow-up PR, after those 1A packages merge.
- The hotfix lane H edits only API routes, the socket server and `lib/logger.ts`, so it can merge on day 1. The one exception is H8, a small change to `runtimeCaching` in `next.config.js`: it merges before 1A's P0 package starts, and if it misses that window, P0 includes it.

**Tests.**

- SPEC §12.
- Unit:
  - the route wrapper: each auth context, 400/413, the envelope, BigInt;
  - the access matrix (pub §6);
  - the rate-limit window SQL;
  - the client error mapping.
- Authz e2e:
  - unauthenticated admin writes → 401/403;
  - non-participant game-over → 403;
  - a draw accepted by a non-player socket is rejected.
- k6: `/api/me` p95 < 150 ms.

**Owner decisions.**

1. Approve the §1.3 wording change to the CLAUDE.md DB rule.
2. Rotate the Clerk key (H5).
3. Flip `SOCKET_AUTH_REQUIRED` on prod.
4. The Vercel Pro and Neon project split timing (needed by P13).

---

### P2 · Board and live game (28 dev-days)

**Goal.** Rebuild the board, replace the socket server's game core with protocol v2 and restart-safe persistence, and ship the v3 game screen in all 55 `V3Game` states for human games and client-run bot games.

**Owner test.**

- Two browsers: create a friend game from the legacy `/play` page (inside the shell).
  - The 30 s study phase runs, then the first-move window.
  - Premove, promotion, an illegal-move reason, low time with tenths, draw offer and decline, resign confirm.
  - Kill one tab: the 30 s ring shows, then the game is abandoned.
- Redeploy the dev socket mid-game: a "server restarting" banner appears and the game resumes at the same ply with the same colours.
- Rematch swaps colours. Spectate from a third browser.
- Bot game: hint, undo, finish. Reload mid-game: it resumes.
- Tap-to-move on a real iPhone and a real Android phone.

**Depends on.** P1 (BoardStage, shell, `route()`, contracts, flags).

**Boards (33).**

- Desktop: `V3MoveBoard` (component), `V3StudyPhase`, `V3Game` (all 55 states), `V3GamePrototype`, `V3GameTheirMove`, `V3GameBot`, `V3Spectate`, `V3GamePremove`, `V3GameCheck`, `V3GameIllegal`, `V3GamePromotion`, `V3GameLowTime`, `V3GameDrawOffer`, `V3GameResign`, `V3GameOppDisconnected`, `V3GameReconnecting`, `V3GameOver`, `V3GameOverLoss`, `V3GameOverDraw`, `V3GameOverTimeout`, `V3RematchOffer`.
- Devices: `V3{iPhone,Android,iPadL,iPadP}{Game,GameDrawOffer,GameOver}`.

**`V3Game` states and the phase that switches them on.** P2 owns all of them except:

- `over_analysing` and `over_legend`: P3;
- `tournament` and `over_tournament`: P12;
- rating deltas inside `over_*`: P9;
- `over_guest`: dropped. There is no guest play under Phase 0 §1.6.

The full list:

> loading, waiting, study, study_last5, study_reconnect, abort, rematch_study, rematch_first, rematch_your, your_move, their_move, premove, premove_cancelled, check, illegal, promotion, rejected, low_time, viewing, draw_sent, draw_received, draw_declined, resign_confirm, reconnecting, reconnected, opp_disconnected, opp_reconnected, bot, tournament, already_ended, server_error, spectate, over_checkmate_win, over_checkmate_loss, over_resign_win, over_resign_loss, over_timeout_win, over_timeout_loss, over_timeout_insufficient, over_stalemate, over_threefold, over_fifty, over_insufficient, over_agreement, over_abandoned, over_aborted, over_analysing, over_legend, over_tournament, over_guest, over_spectator, over_rematch_sent, over_rematch_received, over_rematch_declined, over_rematch_expired

**Schema M2 (expand; play-a §3.1–3.2).**

- `Game` gains:
  - enums and flags: `mode` (`GameMode`: LEGEND_BOT, BOT, FRIEND, ONLINE, TOURNAMENT), `rated` (false until P9), `ratingPool`;
  - players and start: `whitePlayerId`, `blackPlayerId`, `botElo`, `startPly`;
  - moves and clocks: `moves`, `moveClocksMs`, `plyCount`, `fen`, `whiteTimeMs`, `blackTimeMs`, `clockRunning`;
  - phase and result: `phase`, `phaseEndsAt`, `endMethod` (`GameEndMethod`, 11 values), `outcome` (`GameWinner`), `pgn`;
  - links and extras: `rematchOfId`, `meta`.
  - Index `games(status, lastMoveAt)`.
- `GamePlayer` (B1).
- Backfill `WEB/scripts/backfill-play-columns.ts` (play-a §3.4), run on dev only.

**Packages.**

- `REPO/packages/db`: moves the Prisma schema out of `WEB/prisma`. `binaryTargets` gains `linux-musl-arm64-openssl-3.0.x`. Consumed by web, socket and (from P3) the worker.
- `REPO/packages/game-core`: chess.js rules, millisecond clocks, and a state machine whose phases mirror V3Game. End detection includes threefold over the full history and the timeout-vs-insufficient table. Also PGN with `%clk` and `explainIllegal` reasons.
- `REPO/packages/contracts/socket`: protocol v2 in zod (commands, events, error codes).

**Socket server v2 (`WS/`, audit-socket §17, play-a §4).**

- **Handshake and rooms.** The handshake carries `{proto: 2, token}`. Rooms: `game:{ref}`, `spectate:{ref}`, and `user:{ref}`, joined on connect from the verified token's `sub`.
- **Commands** (all with ack and `seq`):
  - `game:join`, `game:move {clientMoveId, uci, ply}`, `game:resign`, `game:abort`;
  - `draw:offer|accept|decline`, `rematch:offer|accept|decline`;
  - `study:ready`, `clock:ping`, `spectate:join`.
- **Events:**
  - `game:snapshot`, `move:applied`, `move:rejected {code}`, `clock:sync`;
  - `presence:update` (30 s grace), `draw:*`, `game:ended {method, outcome}`, `rematch:*`;
  - `server:restarting {restartAt}`.
- **Game rules:**
  - Study runs 30 s when `startFen ≠ initial` (owner Q).
  - A 30 s first-move window with abort.
  - One timer per game, with lag credit.
  - Per-user command rate limits.
  - Spectators are delayed by one move.
- **Persistence (B4) and restart:**
  - checkpoint UPDATEs guarded by `plyCount`;
  - the end-of-game transaction (play-a §3.3): final move, status, `endMethod`, `pgn`, 2 `GamePlayer` rows, `UserStats`, tournament standings;
  - a journal on the OCI volume, and restore at boot from `games WHERE status='IN_PROGRESS' AND lastMoveAt > now() - interval '2 hours'`;
  - a drain step in `deploy-oci.yml`: `POST /internal/broadcast {type:'restart', inSeconds:120}`, wait, then `compose up -d`;
  - a stale-game sweeper every 5 min.
- **Fan-out.** `POST /internal/emit {room, event, data}` (B20) is the realtime spine for P3 and P4.
- **Migration.** v1 handlers stay for one release behind `proto` and the `live-protocol-v2` flag (socket §22). The AI path is deleted, because bot games run on the client.

**HTTP.**

- **New:**
  - `GET /api/games/[ref]`: a role-aware snapshot; the RSC calls the same service.
  - `POST /api/games {mode:'BOT', color, botElo, tc}` with `Idempotency-Key`.
  - `POST /api/games/[ref]/checkpoint` (sendBeacon body; ignored when behind).
  - `POST /api/games/[ref]/complete`: the server replays the moves with chess.js and rejects claimed mates that are not on the board; idempotent (quality SEC-07).
  - `GET /api/games/[ref]/pgn` (immutable once completed) and `/og/game/[ref]?ply=`.
- **Changed:** `GET /api/socket-token` adds an `ent` (entitled) claim, valid ≤ 15 min. Any signed-in user still gets a token, because P4's activating screen needs the `user:` room before entitlement (pub G23). Game, queue and tournament commands refuse `ent=false`.
- **Removed:**
  - `/api/chess/move` and `/api/chess/game-state`;
  - `/api/chess/game-over` (it keeps an internal alias for one release);
  - `/api/chess/create-ai-game`.
- **Kept until P9, but made atomic** (conditional updates, audit-api F-06): `create-game`, `join`, `cancel-game`, `matchmaking/*`.

**Client.**

- `WEB/app/(app)/game/[ref]/page.tsx`: RSC snapshot passed as props.
- `WEB/features/game/`:
  - `gameMachine.ts`: a reducer whose `phase` enum is the 55 states;
  - `useGameSocket.ts`;
  - `useClock.ts`: external store, rAF interpolation, tenths under 10 s;
  - `outbox.ts`: moves made while reconnecting.
- Game components: `GameBoardArea`, `PlayerBar` (disconnect ring), `MoveStrip` (history viewing), `GameActions` (overflow: resign confirm, draw, abort), `GameOverCard`/`ResultSheet`, `StudyBanner`.
- `WEB/components/board/Board.tsx` (`V3MoveBoard`):
  - input: click and drag parity, 180 ms slides, legal dots, premove, promotion picker, illegal shake with a reason line, keyboard move entry;
  - display: an SVG arrow layer with a viewBox; `badge`, `ring`, `hl` and `thumb` props; the owner's icons.
- `MiniBoard`: a static SVG board.
- `WEB/features/engine/EngineProvider.tsx`: a lazy singleton, using hashed and immutable Stockfish WASM, and a `UCI_LimitStrength`/`UCI_Elo` ladder from 400 to 2200. It runs only for bot, practice and local analysis, never for PvP or spectators (client #6).
- The local runner for bot games.
- The session-expired in-game silent refresh (`V3SessionExpired` `in_game_refresh`).
- Delete `WEB/app/game/[gameId]/GamePageContent.tsx` (1,437 lines) after parity.

**Lights up.** Nothing. P2 is the base other phases build on.

**Optimisation.**

- Moves never touch Vercel. That removes the Mumbai → iad1 → Neon hop and the O(n²) JSON rewrites (DB-03).
- The snapshot is in the first HTML: no `game-by-ref` fetches on mount or reconnect.
- Clock ticks re-render only the clock.
- Sounds load on the first gesture.

**Tests.**

- Unit: `game-core` covers every transition, the auto-draw order, the timeout-vs-insufficient table, abort windows, presence grace and rematch expiry, plus a property test of 1,000 random games against chess.js.
- Socket integration (in-process server + `socket.io-client`): join, move, reconnect, multi-tab, drain → restart → restore, rate limits, auth rejection.
- Playwright:
  - abort on a first-move timeout;
  - rematch swaps colours;
  - opponent offline → abandoned;
  - restart mid-game resumes;
  - threefold auto-draw;
  - spectator gating;
  - tampered bot-game `complete` → 422;
  - one-viewport on the game page at every zoom.
- k6 `perf/k6/src/scenarios/ws-ramp.ts` on the dev OCI box, 250 → 2,000 sockets: loop lag p99 < 100 ms.

**Owner decisions.**

1. Study-phase scope.
2. Abort rights (either player until both have moved, or only the side to move).
3. Spectating rules (members only? private profiles?).
4. The opponent-disconnected copy when you are the side to move.

---

### P3 · Server analysis and Game Review (28 dev-days)

**Goal.** Grade every finished game on the server (native Stockfish on OCI) with the published formulas. Ship Review, key moments, review complete, share, My games, legend compare and practice, and retire `/analysis`.

**Owner test.**

- Finish a bot game: the game-over card shows "Analysing · 64%".
- Open the review. Badges fill in as plies are graded (under ~10 s on dev), then the view auto-advances to the summary with the eval graph, the badges and the template narration.
- Key moments: think, reveal, line, bank toggle. Complete shows the stats.
- Share → open the `/r/[slug]` link in a signed-out browser.
- A clean game shows the clean state.
- Kill the worker mid-analysis → failed state → retry resumes from the ply where it stopped.
- `/games` with filters. A game from a legend position → Compare → Practice from move 12.
- `/how-we-grade` signed out.

**Depends on.** P2 (stored colours, `moves`, `pgn` with `%clk`, `GamePlayer`, the end-of-game transaction, `/internal/emit`).

**Boards (20).**

- Review: `V3ReviewAnalysing`, `V3ReviewFailed`, `V3ReviewClean`, `V3ReviewSummary`, `V3KeyMoments`, `V3RvComplete`, `V3RvCompleteClean`, `V3RvShare`, and `V3{iPhone,Android,iPadL,iPadP}Review`.
- Around the review: `V3HowWeGrade`, `V3LegendCompare`, `V3TryCompare` (merged into compare, pub Q4), `V3GameOverLegend`, `V3Practice`.
- My games: `V3GamesArchive`, `V3GamesArchiveFilters`, `V3GamesArchiveEmpty`.

**Schema M3 (expand).**

- `Job` (B5).
- `GameAnalysis` (B6). Fields:
  - identity and progress: `gameId` PK, `gradingVersion`, `engine`, `nodes`, `status`, `gradedPlies`, `totalPlies`, `failedAtPly`;
  - packed per-ply data: `evals Int[]` (White's view; mate encoded as ±(30000−n)), `bestUci` (text), `judgements Bytes`, `accuracy SmallInt[]`;
  - summary: `phasePlies`, `lines Json` (flagged plies only), `accuracyWhite`/`accuracyBlack`, `counts Json`.
- `PlayerReview`: `gameId`+`userId`, `color`, `accuracy`, `phaseAccuracy`, `summary Json {sentences, verified, source: 'template'|'llm'}`, `momentIndex`, `startedAt`, `completedAt`.
- `KeyMoment`: `reviewId`, `ord`, `ply`, `judgement`, `playedUci`, `bestUci`, `acceptUcis[]`, `line[]`, `inBank` (default true), `attempts`, `result`.
- `ShareLink`: `slug`, `gameId`, `userId`, `momentId?`, `showUsername`, a frozen `snapshot Json`, `expiresAt` (30 d), `revokedAt`.
- `LegendComparison`: `gameId`, `status`, `facts Json`.
- `Opening.epd` with an index, for the book set (audit-db §13.2).
- New `GamePlayer` columns are filled: `analysisStatus`, `accuracy`, `momentsCount`, `headline`.
- Enums: `Judgement` (12, B8) and `AnalysisStatus`.

**Packages.** `packages/chess-analysis` (`GRADING_VERSION = 1`, rct-a §2.3):

- **Formulas:** `winPct` (cp clamped to ±1000), per-move accuracy `103.1668·e^(−0.04354·Δ) − 3.1669 + 1`, game accuracy as the volatility-weighted mean averaged with the harmonic mean, and phases.
- **Labels:** the 12-label precedence table.
- **Key moments:** `MAX_MOMENTS = 3`, one per 6-ply window, with `acceptUcis` inside 2 Win%. The clean-game best ply.
- **Text:** deterministic template text (the phase line and moment captions).
- **Book set:** loaded from `Opening.epd`.
- **Fixtures:** the `GAME`/`CLEAN` arrays from `DR/V3ReviewSummary.dc.html` and the Lichess reference values (research §3.3).

**Worker `REPO/apps/analysis-worker`** (Node 22, native Stockfish 18 arm64, `packages/db`):

- **Queue:**
  - Claim jobs with SKIP LOCKED. There is **no timer polling**: the web app or socket kicks the worker; it drains the queue, then disconnects after 60 s idle. One sweep on boot and one daily.
  - Priorities: 0 = live game just ended or user watching, 1 = opened by the user, 5 = newest 50 imported (P4), 8 = backlog.
- **Engine passes:**
  - Pass 1: every ply at 120k nodes, MultiPV 2.
  - Pass 2: candidate plies only, at 1M nodes, MultiPV 3.
  - The eval cache (B7) and Lichess cloud-eval for book plies.
- **Failure handling:** checkpoint every 10 plies; 3 retries (30 s, 2 min, 10 min), then terminal.
- **Progress:** `analysis:progress {gameRef, done, total}` every 2 plies and `analysis:done {gameRef, accuracy, momentsCount, headline}` via `/internal/emit`.
- **Routes:** `POST /internal/analysis/kick` (`x-internal-token`) and `POST /engine/analyse` (reserved for P7).
- **Placement:** on dev, a compose service on the dev VM (`cpus: "0.5"`, `mem_limit: 1g`). On prod, its own A1 VM, created in P13 (§1.5). Caddy gets `handle /internal/analysis/*` and `handle /engine/*`.
- **Enqueueing:** the socket's end-of-game transaction inserts `Job{kind: ANALYZE_GAME, dedupeKey: 'analyze:<gameId>', priority: 0}` and sends the kick after commit. The bot `complete` route does the same in `after()`.

**HTTP (rct-a §6, play-b §3.7).**

- Review API (rct-a):
  - A1 `GET /api/review/:ref` (ETag, `private, no-cache`), A2 `…/status` (304s), A3 `POST …/analyse` (202), A4 `POST …/retry`;
  - A5 `PATCH …/progress` (keepalive batches), A6 `PATCH …/moments/:id` (bank toggle; inert until P5), A7 `POST …/complete`, A8 `GET …/pgn`;
  - A9 `GET …/legend`, A10 `POST …/share`, A11 `PATCH|DELETE /api/share/:slug`, A12 `/r/:slug` + `opengraph-image` + `image?download=1`.
- Games and practice (play-b): `GET /api/me/games` (A14: keyset over `game_players`, facets per source), `POST /api/review/:ref/legend/retry` (play-b A11, renamed under B21), `GET /api/practice/context` (A12).
- `GET /api/review/:ref/status` (A2) also carries `comparison` and `bank` fields. It is the single fallback status endpoint for the game-over card, compare and review, replacing play-b's separate `GET /api/games/[ref]/status`.
- **Removed:** `GET /api/analysis/[gameId]`. Page routes `/analysis/*` → 308 `/review/*`.

**Client.**

- `/review/[ref]`:
  - RSC + `HydrationBoundary`; `qk.review(ref)` has `staleTime: ∞` once DONE.
  - Socket deltas are applied with `setQueryData`; the `/status` fallback runs only while the page is visible.
- `/review/[ref]/complete`; `/review/[ref]/legend` (tabs explanation, your_moves, legend_moves, practice; static narration through `WEB/lib/hooks/useExplanationPlayer.ts`).
- `/practice` (`EngineProvider`); `/games` (virtualised listbox, filter popover on desktop and sheet on phones, source tabs).
- `/how-we-grade` (ISR, reading the `chess-analysis` constants); `/r/[slug]` (frozen snapshot, `noindex`, `s-maxage`).
- Components: `EvalGraph` (SVG, the user's side up, rct-a Q17), `MoveBadge`, `KeyMomentStepper`, `CoachLine` (template text), `ShareSheet`.
- Delete `WEB/app/analysis/[gameId]/AnalysisPageContent.tsx` (1,178 lines).
- The nav shows **Review** (→ `/games`).

**Lights up.**

- P2 game-over: `over_analysing`, the accuracy line, the Review CTA and `over_legend`.
- Later phases light up the P3 slots:
  - the bank toggle, drill CTA and "added" tags: P5;
  - the Coach tab and "Explain this move": P7;
  - archive source tabs and the import banner: P4.

**Optimisation.**

- One RSC round trip per screen.
- The review payload is about 4 KB (about 1.5 KB with brotli): plies are columnar, and the client computes the FENs.
- Analysis is immutable once done, served with ETag/304.
- About 8 batched statements per analysed game from Mumbai (audit-db §12.4).
- Neon keeps scale-to-zero, because the worker never polls.

**Tests.**

- Unit: label precedence, the formulas, mate edge cases, games that start from a FEN (no Book, ply numbering).
- Worker integration with a fake engine.
- Playwright: bot game → analysing (mocked events) → summary → moments → complete → share → signed-out `/r/` → revoke → 404.
- Privacy:
  - a member who did not play the game gets 404 on A1;
  - user R gets 402;
  - `/r/` never shows the opponent's name when "Show my username" is off.
- k6: worker throughput on the dev VM (games per hour at 120k nodes).

**Owner decisions.**

1. B26 (lapsed read access).
2. The public share-page scope (rct-a Q3, which needs a design board).
3. 3 key moments.
4. Confirm the badge art.

---

### P4 · Game import and onboarding v3 (16 dev-days)

**Goal.** Import Chess.com and Lichess games into the P3 pipeline, and rebuild onboarding through the trial checkout and its activation.

**Owner test.**

- As fresh user R:
  - Sign up, then go through welcome → link "hikaru" (Chess.com) → confirm preview → level (prefilled band) → goals → plan → Dodo test card.
  - Activating flips through the `entitlement:changed` push (the polling fallback is tested by blocking WS).
  - Done shows "Importing 212 / 480".
- `/games` grows live. The first imported game is reviewable.
- Link Lichess through OAuth, and deny it once.
- `/settings/connected`: sync, a forced sync failure, unlink with "delete games".
- User Q (trial already used) sees no trial copy.

**Depends on.** P3 (worker, `Job`, review pipeline). P1 (rate limiter for lookups).

**Boards (27).**

- Onboarding, on desktop, iPhone and iPad: `V3Onb{Welcome,Link,Preview,Rating,Goals,Plan,Activating,Done}`, `V3iPhoneOnb*`, `V3iPadOnb*`.
- `V3CheckoutActivating`, `V4SettingsConnected`, `V4SettingsConnectedError`.

**Schema M4 (expand).**

- `LinkedAccount` (B9):
  - `userId`, `provider` (`CHESSCOM|LICHESS`), `externalId`, `username`, `displayUsername`;
  - `status` (`LINKED|SYNCING|ERROR|REVOKED`), `tokenEnc` (AES-256-GCM, `LINK_TOKEN_KEY`), `lastSyncedAt`, `lastError`, `verifiedAt`;
  - `@@unique([provider, externalId])`.
- `ImportRun`:
  - `ref`, `userId`, `accountId`;
  - `status` (`QUEUED|WAITING_FOR_MEMBERSHIP|RUNNING|DONE|FAILED`);
  - `imported`, `total`, `analysed`, `error`, timestamps.
- `ImportCursor`: per account, the archive month + ETag, or the Lichess `since`.
- `Game.source` (`REPLAY|CHESSCOM|LICHESS`) and `externalId`, with `@@unique([source, externalId])`.
- `User` gains `onboardingStep`, `ratingBand`, `ratingBandSource`, `initialRating`, `goals[]`, `dailyMinutes`, `timeZone`, `onboardedAt`.
- `TrialLedger` (hashed normalised email and linked handles, pub Q19).

**Worker job `IMPORT_ACCOUNT`.**

- **Chess.com:** `/pub/player/{u}/games/archives`, then only the new months, serially with `If-None-Match`. The User-Agent carries a contact address.
- **Lichess:** stream ndjson from `/api/games/user/{u}?since&clocks&evals&opening&accuracy&division&pgnInJson`. One global request at a time, with a 60 s back-off on 429.
- **Mapping:** PGN → `Game{source}` + one `GamePlayer` (the user's colour comes from the linked username). Games carrying `%eval` skip pass 1.
- **Analysis priority:** the newest 50 at priority 5, the rest at priority 8.
- **Progress:** `import:progress` (≤ 1/s per user), `import:finished`, `import:failed`.
- **Resync:** daily from the worker scheduler, not Vercel cron.
- **Membership gate:** runs start only once the member is entitled. The Dodo webhook fan-out releases `WAITING_FOR_MEMBERSHIP` (pub Q13).

**HTTP (B10; pub §1.7).**

- **New:**
  - `POST /api/accounts/chesscom/lookup` (RL 10/min/user; upstream cached 600 s per username), `POST /api/accounts/chesscom`;
  - `GET /api/accounts/lichess/start` (PKCE S256, signed `rc_lichess_pkce` cookie), `GET /api/accounts/lichess/callback`;
  - `GET /api/accounts`, `POST /api/accounts/{provider}/sync`, `DELETE /api/accounts/{provider}?deleteGames=1`;
  - `GET /api/import/status` (ETag; the polling fallback), `POST /api/import/[ref]/retry`;
  - `PATCH /api/me/onboarding`;
  - `GET /api/billing/activation` (replaces `waitForEntitlement` polling of `/api/subscription`).
- **Changed:**
  - `POST /api/checkout` gains `returnPath` and `source`;
  - `GET /api/me` adds `accounts` and `import`;
  - the Dodo webhook fan-out → `entitlement:changed`.
- **Removed:** `POST /api/user/chess-com-profile/preview`, `POST /api/user/chess-com-profile`, `POST /api/user/onboarding-skip`.

**Client.**

- `WEB/app/onboarding/{layout,page}.tsx`: a resolver that resumes at the right step.
- `WEB/app/onboarding/{welcome,link,confirm,level,goals,plan,activating,done}/page.tsx`. Together these replace the 730-line client page.
- `/checkout/activating`.
- `/settings/connected`: a standalone page until the P10 settings shell adopts it. The account menu gains a "Connected accounts" item.
- `WEB/lib/realtime/useUserChannel.ts`: a lazy socket with a polling fallback (3 s → 10 s).
- The page after onboarding is `/games` until P5 swaps in `/home`.

**Lights up.** The P3 archive gets source tabs, the `import_running` banner and the per-source empty tabs.

**Optimisation.**

- No Chess.com or Dodo calls on the request path.
- One batched insert per archive month.
- Imports beyond the newest 50 are analysed lazily: on open, or by low-priority backfill.
- `/api/me` stays a single query (pub §1.7 select).

**Tests.**

- Unit: rating band edges, PKCE, token crypto, PGN → `Game` mapping, colour matching, trial eligibility with the ledger, the activation state machine.
- Playwright:
  - onboarding end to end for user R in Dodo test mode;
  - Lichess denied;
  - Chess.com private, not found and 429 (upstream mocked);
  - import progress with a mocked socket.

**Owner decisions.**

1. Import scope: all time, or the last 12 months plus the newest 2,000 kept (audit-db §14).
2. Disclose the trial ledger in the privacy policy.
3. Chess.com ownership verification on a conflict (acct Q18).
4. The email provider for trial reminders: Resend (pub Q9).

---

### P5 · Mistake Bank, puzzles, Train and Home (26 dev-days)

**Goal.** Turn each user's mistakes into FSRS-scheduled puzzles, and add theme puzzles, the Train hub with its daily plan and streak, and the Home dashboard. This is the chargeable core (M2).

**Owner test.**

- After reviewing a game: Review complete says "3 added", and "Drill these 3" opens the runner.
- Solve one first try, one with a hint and one wrong, then show the solution. The suggested grades are Good, Hard and Again, and an override is allowed.
- The summary shows the grade table.
- `/train` shows the plan "0 of 3 done" → it advances; the streak increments.
- Puzzles: switch the theme in the picker.
- Go offline mid-session and grade 3: they sync when back online.
- `/home` shows populated, new-user (user R) and import-running states.
- Members now land on `/home`.

**Depends on.** P3 (`GameAnalysis`, the worker), with P4 for realistic volume.

**Boards (35).**

- Home: `V3Home`, `V3HomeNewUser`, `V3HomeLoading`.
- Train hub: `V3TrainHub`, `V3TrainHubDone`, `V3TrainHubLoading`, `V3*TrainHub` ×4.
- Bank: `V3BankEmpty`, `V3BankCaughtUp`, `V3BankLoading`, `V3*Bank` ×4, `V3MistakeBank` (+ ×4 devices), `V3BankSession`.
- Summary: `V3SessionSummary`, `V3SessionPerfect`.
- Puzzles: `V3Puzzle{Solve,Hint,Wrong,Correct,Solution,Themes}`, `V3*Puzzle` ×4.

**Schema M5 (rct-b §2).**

- Enums: `TrainingDeck`, `CardState`, `FsrsGrade`, `SessionKind`, `SessionStatus`, `MistakeSource`, `GamePhase`.
- `Mistake`:
  - `userId`, `gameId`, `ply`, `fen`, `playedUci`, `bestUci`, `line[]`;
  - `judgement`, `winLoss`, `themes[]`, `phase`, `source`, `isPuzzle`, `hiddenAt`;
  - `@@unique([gameId, ply, userId])`.
- `TrainingCard`:
  - `deck`, `itemKind`, and a `mistakeId?`, `puzzleId?` or `openingLineId?`;
  - FSRS fields `due`, `stability`, `difficulty`, `reps`, `lapses`, `state`, `lastReview`, plus `suspendedUntil`;
  - index `(userId, deck, due)`.
- `TrainingAttempt`:
  - `clientAttemptId @unique`, `rating`, `suggested`, `overridden`;
  - `firstTry`, `hints`, `wrongs`, `solutionShown`, `elapsedMs`;
  - index `(userId, reviewedAt DESC)`.
- `TrainingSession`.
- `TrainingDay` (PK `(userId, localDate)`, with `plan Json`).
- `ThemeMastery`, `TrainingProfile` (Glicko puzzle rating and RD, `dayStreak`, `dayStreakBest`, `lastActiveDay`, `dayStartHour`, caps), `TrainingReport`.

**Packages.**

- `REPO/packages/chess-training`:
  - a `ts-fsrs@^5` wrapper;
  - due-time release snapped to 08:00 local, DST-safe;
  - caps: 10 bank reviews a day, ≤ 5 new;
  - `buildSession(kind, opts)`, mastery, streak;
  - a deterministic explainer (chess.js attack enumeration, the only text marked VERIFIED).
- The theme tagger goes into `chess-analysis`, using the Lichess theme keys.

**Worker.**

- **J1 extraction after each `GameAnalysis`:**
  - It takes MISTAKE, BLUNDER and MISS, plus INACCURACY with a Win% drop ≥ 7, at most 4 per game (rct-b Q23).
  - A position becomes a scored puzzle only if the best move is clearly unique: best minus second-best > 0.5 win-chance units, and best ≥ +200 cp for the user. Otherwise it is a review position.
  - It backfills everything analysed in P3 and P4.
- **J6 shard build** (a script): Lichess CC0 CSV → filter (popularity > 80, rating 600–2400) → R2 shards (B13).

**HTTP (rct-b §4).**

- Reads:
  - R1 `GET /api/train/today`, R2 `GET /api/train/bank` (cursor plus facets);
  - R3 `GET /api/train/sessions/:ref`, R4 `GET /api/train/themes`, R8 `GET /api/me/badges`.
- Writes:
  - W1 `POST /api/train/attempts` (batch ≤ 50, idempotent on `clientAttemptId`, conflict on a `cardReps` mismatch);
  - W2 `POST /api/train/sessions` (`Idempotency-Key`; reuses an ACTIVE session less than 2 h old), W3 `…/extend`, W4 `…/end`;
  - W5 `POST /api/train/cards/:ref/skip`, W6 `DELETE /api/train/cards/:ref`;
  - W7 `POST /api/train/reports`, W8 `PATCH /api/train/prefs`.
- Home: `GET /api/home`, backed by `getHomeData()` (sys §3.18; 5 parallel indexed queries).
- Review A6 (the bank toggle) goes live.

**Realtime.** `bank:due_changed` and `mistakes:added`, both in the user room.

**Client.**

- Routes: `/train`, `/train/bank`, `/train/bank/session`, `/train/puzzles`, `/train/session/[ref]/summary`, `/home` (RSC, with `<Suspense>` blocks using the V3HomeLoading skeletons).
- One `TrainerRunner` serves bank and puzzles:
  - moves are validated locally against the solution and accepted alternatives;
  - grading is optimistic;
  - the next session is prefetched 2 cards before the end.
- The IndexedDB outbox `rc-train-outbox`.
- Navigation:
  - the nav shows **Home** and **Train**;
  - the logo goes to `/home`, and sign-in lands on `/home`;
  - onboarding Done → `/home`.

**Lights up.**

- P3 Review complete: the bank lines, the drill CTA and the key-moment toggle.
- P4: the post-onboarding landing.
- Home cards fed by later phases:
  - the Weakness "top theme" line: P6;
  - the lesson plan item and the "Play the Opera Game" target: P8;
  - the rating line: P9.
- Until P8, "Play the Opera Game" links to the legacy `/position/[ref]` page.

**Optimisation.**

- One write per training item.
- The plan is stable for the day: one row read.
- Puzzles never touch Neon; they come from CDN shards.
- Due counts are `private, no-store`.
- k6 budgets: W1 at 20 rps p95 < 150 ms; R1 p95 < 250 ms; W2 PUZZLES p95 < 400 ms with a cold shard LRU.

**Tests.** As listed in rct-b §8: FSRS intervals, DST release, caps, session composition, streak gaps, Glicko signs, uniqueness, puzzle-line trim, the route idempotency and conflict cases, and the offline outbox journey.

**Owner decisions.**

1. Whether inaccuracies go into the bank (Q23).
2. A "Remove from bank" action (Q6).
3. The puzzle rating seed (Q8).
4. The streak definition (Q13).
5. A new-user Train hub design (Q4).

---

### P6 · Weakness Profile (9 dev-days)

**Goal.** Recurring patterns from analysed games, measured against a rating-band baseline, with a drill for each weakness.

**Owner test.**

- User A with 14 analysed games sees "14 / 20" (insufficient).
- Import more games: computing (progressive, "Preliminary" from 5 games) → populated (top 3, breakdown tabs).
- "Drill a weakness" → a session of 6 positions from your games plus 4 matched puzzles → summary.

**Depends on.** P4 (game volume), P5 (Mistake, the runner, `ThemeMastery`).

**Boards (8).** `V3WeaknessInsufficient`, `V3WeaknessComputing`, `V3WeaknessDrill`, `V3WeaknessProfile` (+ `V3{iPhone,Android,iPadL,iPadP}WeaknessProfile`).

**Schema M6.**

- `WeaknessSnapshot`:
  - `userId`, `version`, `status` (`COMPUTING|READY|INSUFFICIENT|FAILED`);
  - `scope Json`: time classes, since, ≤ 300 games;
  - `gamesAnalysed`, `metrics Json`: by theme, phase accuracy, clock bucket (< 10 % of time left), opening ECO, piece;
  - `top Json`, `computedAt`;
  - index `(userId, computedAt DESC)`. Kept 12 weeks.

**Data.** The baseline is a static JSON per rating band, computed once from a Lichess CC0 monthly dump (games with `%eval` only) by script J5. It lives at `packages/chess-analysis/baseline/v1.json`.

**Worker.** `RECOMPUTE_WEAKNESS` runs after each import or analysis batch (debounced 10 min per user), plus nightly from the worker scheduler.

**HTTP.**

- R5 `GET /api/train/weakness` (ETag = `snapshot.ref:algoVersion:progressTick`).
- W9 `POST /api/train/weakness/recompute` (1 per 10 min).
- The drill uses W2 with `kind: 'WEAKNESS'`.

**Realtime.** `weakness:ready`.

**Client.** `/train/weakness` and `/train/weakness/[pattern]`. A failed state is added using the sys error pattern; it is not in the designs (rct-b Q15).

**Lights up.**

- The Train hub's "Weakness drills" area and the Theme mastery link.
- The Home "top theme" line.
- The R8 nav dot.
- The P10 profile strengths card.

**Tests.** Metric math against fixtures; insufficient → computing → ready with mocked progress (Playwright); recompute rate limit.

**Owner decisions.**

1. The default scope (Q24).
2. Untimed time-pressure drills in v1 (Q16).

---

### P7 · AI coach (16 dev-days)

**Goal.** An engine-grounded coach that never computes chess itself: every move it writes is checked by chess.js and the engine. It runs as SSE with a fair-use budget. The LLM review text replaces the P3 templates once verified.

**Owner test.**

- From a key moment, "Explain this move" streams an answer, and every move in it is tagged engine-checked.
- Ask a what-if question: the engine tool is called.
- Kill the worker: you get the error state with the engine-line fallback.
- Exhaust the burst limit: rate limit with a countdown.
- A lapsed fixture user gets the membership-ended sheet in place.
- ⌘K → Ask works.
- The review summary sentences now come from the LLM, and are marked verified.

**Depends on.** P3 (facts, the worker engine). P5 and P6 enrich the context.

**Boards (11).** `V3Coach{Suggested,Explain,Typing,Streaming,Error,RateLimit,Paywall}`, plus `V3{iPhone,Android,iPadL,iPadP}Coach`.

**Schema M7.**

- `CoachThread`: `userId`, `gameId?`, `ply?`, `kind`.
- `CoachMessage`:
  - `threadId`, `role`, `status` (`STREAMING|DONE|ERROR`), `text`, `facts Json`, `verified`;
  - `model`, input and output tokens, cache reads, `costMicros`;
  - `clientId @unique`.
- `CoachUsage`: PK `(userId, day)`, `messages`, `costMicros`.
- Retention 180 days.

**Server.**

- **SDK and models.** Add `@anthropic-ai/sdk` to `WEB`. Model IDs and prices are checked against the Claude API reference at build time (rct-a Q13). The plan is a mid-tier model for chat and a small one for review text.
- **Grounding:**
  - The `CoachContext` fact packet is built by code (research §13.3).
  - Tools `evaluate(fen)`, `legalMoves(fen)` and `bestLine(fen, n)` run in our route. The engine tool calls worker `POST /engine/analyse` (priority lane, ≤ 400k nodes).
- **Verifier** (`packages/chess-analysis/verify`): legality and engine checks on every claim. One regenerate; then the engine-line fallback.
- **Prompt caching:** the system prompt for 1 h, the game context for 5 min.

**HTTP.**

- `GET /api/coach/context`.
- `POST /api/coach/messages` (SSE):
  - events `token | move_check | citation | done | error`;
  - `maxDuration = 60`, idempotent by `clientId`;
  - aborted streams are not charged.
- `POST /api/coach/messages/:id/retry`.
- `GET /api/coach/suggestions`.
- Fair use: a burst limit through `RateLimitBucket`, plus a daily or monthly budget in `CoachUsage` → 429 with `retryAfterSec`. A 402 with `reason` → the in-place `RenewSheet` (reused by P9 and P11).

**Worker.** Review text via structured output, run through the verifier. The template stays as the fallback.

**Client.**

- `CoachPanel`: a side panel on desktop and iPad L, a docked 60 % sheet on phones and iPad P.
- `features/coach/useCoachStream.ts`.
- The draft is kept in `sessionStorage`.

**Lights up.**

- P3 Review: the Coach tab, "Explain this move" and the LLM summary.
- P1 ⌘K: Ask mode.
- P3 practice hint wording (play-b A13 `POST /api/coach/hint`).
- An optional "why" line in P5 bank items.

**Optimisation.**

- Prompt caching.
- Stored verified texts are reused.
- Cost events go to PostHog from the server.
- k6 SSE scenario.

**Tests.**

- Verifier unit tests: an illegal move is rejected; a wrong eval claim is rejected.
- A golden set of 50 positions with a pass threshold.
- Playwright with a mocked SSE stream, covering all 7 states.

**Owner decisions.**

1. The fair-use cap: a monthly budget or 200 a day (rct-a Q5, sys C5).
2. "Unlimited" copy.
3. The "What would Tal play?" chip (Q8).
4. Revisit the price given LLM cost (plan §4.3).

---

### P8 · Learn: legends, legend practice, openings, lessons (24 dev-days)

**Goal.** Public SEO catalogues (legends, legend positions, openings, guides) on ISR, plus the members-only legend practice games (vs the bot, from the legend's position, compared with the legend), the legend-detail games, lessons and the opening drill.

**Owner test.**

- Signed out: `/legends`, `/legends/morphy`, `/legends/positions`, `/legends/positions/kasparov-topalov-1999`, `/openings`, `/openings/italian-game` all load, with no Neon query in the logs on a cached hit.
- `/try/x` → 301.
- As a member: Play → study → the KT game vs the bot → find 24.Rxd4 → resign → "You found 24.Rxd4" → compare → review.
- "Next position" cycles through the set. Reloading mid-game resumes it.
- Legend-detail game: the Opera Game from move 10.
- Lesson: 3 checkpoints, one hint → complete shows 2 stars.
- Opening drill: a wrong move slides back; finishing creates an OPENING card.

**Depends on.** P2 (local runner, board), P3 (compare, review), P5 (OPENING deck).

**Boards (47).**

- Legend practice: `V3TryCatalogue`, `V3TryPosition` (+ iPhone, iPad), `V3TryGame` (+ ×4), `V3TryGameOver`, `V3TryGame{KT,BF,AK,TS}` (+ ×4 each).
- Learn pages: `V3LegendsCatalogue`, `V3LegendsEmpty`, `V3LegendDetail`, `V3LessonPlayer` (+ ×4), `V3LessonGuess`, `V3LessonComplete`, `V3OpeningsCatalogue`, `V3OpeningDetail`, `V3LearnOpenings`, `V3LearnLegends`.
- Legend-detail games: `V3LegendGame{Opera,Anderssen,Paulsen}`.

**Schema M8.**

- Existing tables gain columns:
  - `Legend`: `slug`, `eraKey`;
  - `ChessPosition`: `slug`, `status`, `legendMoveUci`/`San`, `startPly`, `heroSide`, `priorMovesSan`, `verifiedAt`, `eco`;
  - `Opening`: `slug`, `popularity`, `hasExplanation`, `isMainline`.
- New tables:
  - `PositionCollection` and `PositionCollectionItem`;
  - `Lesson`: `slug`, `legendId`, `legendOrder`, `pathOrder`, `plies`, `checkpoints`, `narration`, `audio?` (reuses the `ExplanationData` format);
  - `LessonProgress`: `status`, `bestStars`, `resumePly`, processed `eventIds`.

**Content.**

- Check the Anderssen and Paulsen positions against the real game scores before seeding.
- Seed the 5 practice positions: Opera, KT, BF, AK, TS.
- Launch lessons: 5 path lessons plus Morphy's 5 (9 unique, rct-b Q26), each with a chess-accuracy review.
- `POST /api/admin/positions/[id]/verify` (A19) is used by the seed script.

**HTTP.**

- Positions:
  - A1 `GET /api/positions?collection=legend-practice` (public, `s-maxage=3600`, swr);
  - A2 `GET /api/positions/search`, A3 `GET /api/positions/[slug]`.
- Games:
  - A4 `POST /api/games {mode: 'LEGEND_BOT', positionSlug, reason: rematch|restart|next}`;
  - A5 page `/play/legend/[slug]`: GET never writes; it resumes an unfinished game;
  - status polling reuses P3's `GET /api/review/:ref/status`.
- Learn:
  - R6 `GET /api/learn/progress`;
  - R7 `GET /api/learn/openings` (public CDN);
  - W10 `POST /api/learn/lessons/:slug/progress` (idempotent on `eventId`);
  - W11 `POST /api/learn/openings/:ref/drill`.
- **Removed:** `GET /api/chess-positions/featured`, `GET /api/position/[referenceId]` (→ A3 / `/s/`), and the legend branch of `create-ai-game`.

**Client.**

- Public: `/legends`, `/legends/[slug]`, `/legends/positions`, `/legends/positions/[slug]`, `/openings`, `/openings/[slug]`, `/learn/openings/drill/[slug]`, `/learn/legends`.
- Members: `/play/legend/[slug]` → `/game/[ref]` (local runner + the legend-path comparison in `game-core`), `/learn/lessons/[slug]`.
- Public pages use ISR (`revalidate = 86400` + `revalidateTag` from the admin routes):
  - remove `force-dynamic` from `WEB/app/legends/page.tsx:7` and `WEB/app/openings/page.tsx:9`;
  - paginate openings;
  - the sitemap stops selecting the `explanation` JSON (`WEB/app/sitemap-openings.xml/route.ts:9-13`);
  - signed-in members get a "Back to app" client island (rct-b Q1).
- Redirects: `/try/*` → `/legends/positions` (pub Q2); cuid → slug 301s (B25).

**Lights up.**

- Train hub: the "Legend lessons" area and plan step 3.
- Home: "Play the Opera Game" → `/play/legend/opera-game`.
- ⌘K: legend results go to slug routes (sys C6).
- P3 compare: the "Another position" action.

**Optimisation.**

- Crawlers no longer wake Neon (DB-15).
- MiniBoard SVG in lists.
- The engine asset is prefetched on intent.
- The legends list (< 60 rows) ships whole and is filtered on the client.

**Tests.** play-b §7 (legend-practice, legend-compare, practice), rct-b §8 (lessons, opening drill), and the 301 map.

**Owner decisions.**

1. The legend visibility threshold, ≥ 8 positions (rct-b Q2).
2. The slug canonical switch (Q12).
3. Next-lesson order (Q11).
4. Lesson audio (Q18).

---

### P9 · Play hub, matchmaking, challenges, ratings (15 dev-days)

**Goal.** The v3 Play hub. Matchmaking runs on the socket server with no DB polling. Friend challenges are accepted signed in or out, positions can be shared, and Glicko-2 ratings land.

**Owner test.**

- `/play` tabs: Legend (search), Bot (strength slider), Friend (create a link), Online (5+3).
- Two browsers queue → match found countdown → game.
- Queue alone for 60 s → no opponent → "Play a bot".
- Open the challenge link signed out → sign up with a trial → accept → game.
- `/s/[code]` from a review moment; user R sees the paywalled variant.
- After a rated game: "Blitz 1184 → 1186" on the card, Home and archive.

**Depends on.** P2 (socket v2, `user:` room), P8 (legend-practice routes for the Legend tab).

**Boards (20).**

- `V3PlayHub`, `V3Queue`, `V3NoOpponent`, `V3MatchFound`, with `V3{iPhone,Android,iPadL,iPadP}{PlayHub,Queue,MatchFound}`.
- `V3ChallengeShare`, `V3ChallengeAccept`, `V3ChallengeAcceptGuest`, `V3PositionShare`.

**Schema M9 (play-a §3.2).**

- `Challenge`: code `@unique`, status, `expiresAt` (24 h), indexes `(creatorId, status)` and `(status, expiresAt)`.
- `SharedPosition`.
- `PlayerRating`: PK `(userId, pool)`, index `(pool, rating)`.
- `RatingEvent`: `@@unique([gameId, userId])`, index `(userId, pool, createdAt DESC)`.
- `Game.challengeId` is used.
- Contract C2, one release later and confirmed by the owner: drop `MatchmakingQueue`.

**Socket.**

- **Matchmaking:**
  - in-memory pools per (pool, time control), with ±range widening and colour balancing;
  - "position of the day";
  - a 60 s timeout → `queue:timeout`;
  - commands `queue:join` and `queue:leave`; events `queue:status`, and `match:found {gameRef, color, opponent, startsAt}` to `user:{ref}`.
- **Ratings:** Glicko-2 lives in `packages/game-core/glicko.ts` and runs inside the end-of-game transaction. Seeds come from P4 linked ratings or the onboarding band. "Provisional" shows under 5 games.

**HTTP (play-a §5).**

- **Challenges:**
  - `POST /api/challenges` (max 5 open per user);
  - `GET /api/challenges/[code]` (public projection, `s-maxage=10`);
  - `POST …/accept` (conditional update + `Game` in one transaction + notify the creator), `POST …/decline`, `DELETE …`.
- **Shared positions:** `POST /api/shared-positions`, `DELETE …/[code]`, `POST …/[code]/view` (beacon, so the HTML stays cacheable).
- **Other:**
  - `GET /api/positions/featured`;
  - `PATCH /api/me/preferences {botStrength}` (`UserSettings` starts here, B14).
- **Removed:**
  - `/api/matchmaking/*`: 4 routes, plus the 1 Hz poll in `WEB/lib/hooks/useMatchmaking.ts:30`;
  - `/api/chess/{create-game,join,cancel-game}`;
  - the legacy `/play`, `/queue`, `/challenge`, `/join/[ref]` and `/position/[ref]` pages (the last redirects).

**Client.**

- `/play` (tabs × states: default, loading, search_empty, creating, error, limit).
- `/play/online` (searching, no opponent, match found; the game snapshot is prefetched on `match:found`).
- `/play/friend/[code]` (share and waiting).
- `/join/[code]` (signed in and signed out, with an OG image).
- `/s/[code]`.

**Lights up.**

- Rating deltas on the P2 game-over card.
- P3 archive rows.
- P5 Home: header "Blitz 1184", the This-week rating line and per-game deltas.

**Optimisation.**

- Removes ~420 queries a minute per searching user (DB-05), so Neon can scale to zero again.
- The challenge and share pages are CDN-cacheable.
- OG images are immutable.

**Tests.**

- Unit: pairing (widening, colours) and Glicko.
- Playwright:
  - a two-context online match;
  - a challenge accepted signed out → sign-up;
  - expired, cancelled and own-link states;
  - the shared position paywalled for R.

**Owner decisions.**

1. Rated by default, and the pools (socket Q4, sys Q16).
2. The invitee must be a member (paid-only).
3. Whether a decline keeps the challenge open (play-a Q3).

---

### P10 · Profile, settings, membership, notifications (20 dev-days)

**Goal.** The account area: public profiles with privacy, every settings section synced across devices, the membership lifecycle including plan switch, cancel with a retention offer and pause, account deletion and data export, and push reminders.

**Owner test.**

- `/@knightowl_88`: overview, games (filter, select, bulk review), stats, milestones, edit with avatar upload.
- Another player's profile: public, private, and logged out (noindex).
- `/settings/*`, every section: changing the board theme in one tab updates the other.
- Membership in Dodo test mode: trial → switch to yearly (proration preview) → cancel (offer, reason) → cancelling → resume. A past-due simulation.
- Export data; delete account (typed confirmation): the opponents keep their games.
- Enable push: a reminder arrives.

**Depends on.** P1–P9: stats need ratings and analysis; the games tab needs the archive.

**Boards (39).**

- Profile: `V4Profile{,Games,Stats,Edit,Other,OtherGuest,Private}`, `V4{iPhone,Android,iPadL,iPadP}Profile`.
- Settings: `V4Settings{,Board,Pieces,Sounds,Appearance,Notifications,Account}`, `V4DeleteAccount`, `V4*Settings` ×4, `V4*SettingsBoard` ×4.
- Membership: `V4Membership{,Trial,Cancelling,PastDue,Free}`, `V4PlanSwitch`, `V4CancelSub`, `V4*Membership` ×4.
- `V3NotifPrompt`.

**Schema M10 (acct §10.1).**

- Identity on `User`: `username`, `usernameKey` (case-insensitive unique), `bio`, `country`, `visibility`. Plus `UsernameHistory`.
- Stats and social: `PlayerStats` (per pool, written by the worker), `UserMilestone`, `UserBlock`, `UserReport`.
- `UserSettings` (B14).
- Notifications: `PushSubscription`, `Notification` (`dedupeKey @unique`).
- Data rights: `DataExportJob`, `AccountDeletion` (per-step status).
- Contract C3, confirmed by the owner: `games.creatorId`/`opponentId` and `tournaments.createdByUserId` become nullable with `SET NULL`, so deleting a user anonymises instead of cascading (DB-09).

**HTTP (acct §8.1).**

| Group | Endpoints (acct #) |
|---|---|
| Players | `GET /api/players/{username}` and `…/rating-history`, `…/games`, `…/stats`, `…/milestones`, `/api/players/search` (#6–#11) |
| Own profile and safety | `GET/PATCH /api/me/profile`, `POST /api/me/avatar/upload-url` (R2 presigned), `GET /api/usernames/availability`, `PATCH /api/me/username` (#16–#19); blocks and reports (#14–#15) |
| Preferences and notifications | `GET/PATCH /api/me/preferences` (versioned deep-merge, #20); push subscriptions (#21); one-click unsubscribe (#22) |
| Data rights | export (#23); `GET /api/me/deletion-preview` + `DELETE /api/me` with Clerk reverification (#24) |
| Games | `POST /api/me/games/review-batch` (≤ 50 refs → `Job`, #12); `GET /api/me/games/export.pgn` (#13) |
| Membership | `GET /api/me/membership` (DB-only, `deriveMembershipState`); `GET /api/me/billing` (cached 5 min); invoices; `POST /api/subscription/pause`; `POST /api/subscription/payment-method` (#30–#36) |
| Webhooks and cron | Dodo webhook additions (#38); daily `GET /api/cron/membership-reconcile` (#40) |

**Worker jobs.** `profile.stats`, `milestones.evaluate`, `notify.dispatch` (web-push with VAPID; email through Resend), `notify.reminders` (every 15 min), `notify.weekly`, `export.build`, `account.purge`, `membership.autoresume`, `usernames.cleanup`, `r2.sweep`.

**Realtime.** `presence:watch`/`presence:update`, `prefs:updated`, `profile:updated`, `membership:updated`, `export:ready`, `milestone:awarded`.

**Client.**

- `/@[username]` (rewrite to `/u/[username]`; `/profile/[ref]` → 301).
- The `/settings/[section]` shell: list plus detail; drill-in on phones. It adopts P4's `/settings/connected`.
- `/settings/membership` and its modals.
- The notification pre-permission prompt.
- The nav shows **Settings**.

**Lights up.** The P6 strengths card on the profile, and the P3 archive "bulk review".

**Optimisation.**

- The public profile is `s-maxage=60`, with a client merge for `me`.
- Preferences are versioned and pushed to other tabs.
- The membership view reads the DB only; Dodo is read only through the webhook, the daily reconcile and explicit actions.

**Tests.**

- The acct §11 matrix.
- Delete-account cascade checks: the opponent keeps the game.
- Dodo test-mode switch, cancel and pause.
- The push permission states (denied, iOS install first).

**Owner decisions.**

1. The lapsed and non-member access matrix (acct Q3–Q4).
2. The milestone catalogue (Q9).
3. Pause semantics, verified in Dodo test mode (Q21).
4. Refund wording, which needs a legal check (Q20).
5. The moderation admin, which lands in P12 (Q10).

---

### P11 · Public site, auth, system screens, PWA (20 dev-days)

**Goal.** Restyle every logged-out page and the Clerk flows, plus all the system screens: error, offline, maintenance, consent, install and update prompts.

**Owner test.**

- Signed out: landing, pricing (monthly and yearly; `?reason=required`, `?checkout=failed`; trial used), about, blog index and post, help search with no results, contact (sent and error), legal tabs.
- Sign in with a wrong password, with an unknown email, with Google; sign up → verify (wrong code, resend cooldown); reset the password.
- Visit `/nope` (404), force a 500 (event id + report), trigger the global error.
- DevTools offline → the offline page lists the cached bank and lessons.
- Set the Edge Config maintenance notice: the page shows, and the in-game banner appears.
- The cookie bar declines by default, and PostHog sends nothing until you opt in.
- The install prompt on desktop, Android and iOS. A new deploy mid-game defers the update prompt.

**Depends on.** P3 (how-we-grade constants already live), P5 (offline bank data), P8 (catalogue links).

**Boards (41).**

- Marketing: `V3Landing` (+ iPhone, iPad), `V3Pricing` (+ iPhone, iPad), `V3PaywallSoft`, `V3PaywallHard`, `V3About`, `V3BlogIndex`, `V3BlogPost`, `V3Help`, `V3Contact`, `V3Legal`.
- Auth: `V3SignIn` and `V3SignUp` (+ iPhone, iPad each), `V3VerifyEmail`, `V3ResetPassword`.
- Errors: `V3Error404` and `V3Error500` (+ iPhone, iPad P each), `V3ErrorGlobal`.
- System: `V3Offline` (+ iPhone, iPad P), `V3Maintenance`, `V3CookieConsent` (+ iPhone, iPad P), `V3PwaInstall` (+ iPhone, Android, iPad P), `V3PwaUpdate`.

**Schema M11.** `ConsentRecord`.

**Server.**

- Contact and return paths:
  - `POST /api/contact`: Vercel BotID, Resend, RL 5/h per IP hash and 3/h per email;
  - `GET /api/return-target` + `safeReturnPath` (open-redirect tests).
- Consent: `PUT /api/me/consent` (sets the `rc_consent` cookie).
- Maintenance: `GET /api/system/notice` (`s-maxage=30`), backed by Edge Config; `POST /internal/broadcast` on the socket.
- `POST /api/feedback` (Sentry user feedback) and `GET /api/search` (public mode, `s-maxage=300`).

**Client.**

- **Marketing:**
  - landing: a static board and coach card, no live board (pub Q3);
  - pricing: static with a state island; the JSON-LD names are fixed (`WEB/app/pricing/layout.tsx:37,46`); `SALES_FAQS` is the single FAQ source;
  - `/pricing?reason=required|ended`. `V3PaywallSoft` is built per B26: either the renew sheet only, or a lapsed read-only view.
  - about, blog (category relabel, slugs kept), help (`content/help.ts`), contact, legal template.
- **Auth:** Clerk custom flows at `WEB/app/sign-in`, `sign-up`, `sign-up/verify`, `reset-password`, `sso-callback`, with `lib/auth/clerk-errors.ts`. Google now; Apple behind a flag.
- **Errors:** `not-found.tsx` (signed-out, signed-in and missing-game variants), `error.tsx`, `global-error.tsx`.
- **Offline:** `/offline` plus a service-worker rewrite. It precaches only the shell and the offline allow-list; engine files are runtime-cached; data lives in IndexedDB.
- **Consent:**
  - `CookieConsent`: PostHog `opt_out_capturing_by_default`; GA and Sentry Replay load only after consent;
  - fixes `WEB/app/layout.tsx:156` and `WEB/instrumentation-client.ts:14,38-48` (sys C11).
- **PWA:** install (desktop popover, Android `beforeinstallprompt`, iOS steps); an update prompt deferred while a game is running; `public/manifest.json:10` set to `"orientation": "any"`.

**Optimisation.**

- Marketing pages ≤ 180 kB gz first load, with no chess.js, socket.io or PostHog before consent.
- Static and ISR everywhere.
- Lighthouse budgets in CI (pub §6).

**Tests.** pub §6 (public e2e, signed-in onboarding redirect, access matrix), sys §10 (offline, consent and PWA specs).

**Owner decisions.**

1. Cookie bar worldwide, or EU/UK/CH only (sys Q9).
2. Whether Sentry error capture counts as essential (Q10).
3. The status-page provider (Q5).
4. Apple sign-in.
5. The legal entity and support placeholders (plan §4.6).
6. The refund policy (pub Q6).

---

### P12 · Tournaments and admin (17 dev-days)

**Goal.** Tournament scheduling, pairing and standings move onto the socket server, where they are pushed rather than polled. Ship the v3 tournament screens and the admin console with authenticated APIs.

**Owner test.**

- An admin creates an arena (validation errors first).
- Join from an invite on 2 accounts. The lobby counts down on its own.
- The live arena: find match → paired → game with the tournament strip → game over → back to arena. Standings update live, and the top board streams.
- Results show the podium and your placement.
- Admin: dashboard tiles (live games from the socket), the FEN check on positions, a legend edit with upload.

**Depends on.** P2 (socket v2, game screen `tournament` states), P9 (ratings for seeding).

**Boards (21).**

- Tournaments: `V4Tournaments` (+ ×4), `V4TournamentsEmpty`, `V4TournamentJoin`, `V4TournamentLobby`, `V4TournamentLive` (+ ×4), `V4TournamentGame`, `V4TournamentGameOver`, `V4TournamentResults`.
- Admin: `V4Admin`, `V4AdminPositions`, `V4AdminLegends`, `V4AdminTournaments`, `V4AdminTournamentCreate`.

**Schema M12 (acct §10.1).**

- `TournamentInvite`, `TournamentPairing`, `TournamentPosition`, and `Tournament.slug/visibility/hostUserId/finalStandings`.
- `AdminActivity`.
- Indexes (audit-db §13.2): `tournament_participants_rank_idx`, `tournament_participants_searching_idx`, `tournaments_status_created_idx`.

**Socket (acct §5.0, §8.2–8.3).**

- `TournamentScheduler`: T−5 min reminders, start (cancelled with fewer than 2 players), `ending_soon`, finalize.
- `TournamentPairer`: a 1 s tick.
- Commands `tournament:find_match` and `tournament:cancel_search`.
- Events `tournament:paired` (to the user), `tournament:standings_delta {version, rows}`, `tournament:top_board` (≤ 1/s), plus `started`, `ended`, `cancelled` and `results_updated`.
- Atomic join with a capacity check; idempotent scoring in the end-of-game transaction.

**HTTP.**

- Public and member API (acct #41–#53):
  - `/api/tournaments`, `/{slug}` and its participants, `invites`, `standings`, `me`, `top-board`, `find-match` (HTTP fallback), `results`;
  - `/api/tournament-invites/{code}`, `/api/games/{ref}/tournament-result`.
- Admin API (#56–#59): `/api/admin/{metrics,activity,health,positions,legends,uploads,tournaments}`.
- Internal (#60–#63): `/api/internal/tournaments/*`, `/api/internal/blocks`, `/api/internal/notifications`.
- Socket `GET /internal/live-count`.
- **Removed:**
  - the 2–4 s `find-match` polling (`WEB/app/tournament/[tournamentReferenceId]/FindMatchButton.tsx:68-97`) and `cancel-search`;
  - the writes inside `GET /api/tournament/[ref]`;
  - the legacy `chess-positions/*` and `legends/create|[id]|search` routes (replaced by `/api/admin/*`);
  - `tournament/create`.

**Client.**

- `/tournaments` (live, upcoming, finished; empty; error).
- `/t/[slug]/join`, `/t/[slug]` (lobby → live), `/t/[slug]/results`.
- The `(admin)` route group with `requireAdmin()` in its layout, plus a minimal Reports moderation list (acct Q10).

**Lights up.**

- The `V3Game` `tournament` and `over_tournament` states.
- The Play sub-nav "Tournaments" goes to the v3 list.

**Tests.** Scoring rules (fire after 2 wins, early draw), atomic capacity, scheduler timing with fake time, an arena Playwright run with 4 contexts.

**Owner decisions.**

1. Who can host (acct Q27).
2. Auto-navigate into the paired game (Q28).
3. The lobby window and minimum players (Q29).
4. Time-sliced positions (Q26).
5. Arena scoring (Q25).

---

### P13 · Production launch (8 dev-days)

**Goal.** `playchess.tech` serves the new app on the new accounts with the old production data, with monitoring, backups and a rehearsed rollback.

**Before the window (decisions and setup).**

1. **Plans:**
   - Vercel Pro (Hobby is non-commercial);
   - Neon: dev and E2E in their own project; production on Launch, or on Free with compute alerts (audit-db DB-01, §10.3);
   - create the OCI prod worker VM (A1, 2 OCPU / 12 GB / 50 GB: the total stays 4/24/150).
2. **Vercel prod project `replay-chess` on `main`.** Env vars:
   - Clerk prod keys, Dodo live keys;
   - the Neon prod pooled URL with role `replay_app`, plus `DIRECT_URL` (owner role) where migrations run;
   - R2, Sentry, PostHog, `INTERNAL_API_SECRET`, `LINK_TOKEN_KEY`;
   - `NEXT_PUBLIC_WS_URL=wss://ws-chess.playchess.tech`;
   - **`NEXT_PUBLIC_APP_ENV=production`**, without which `/dev/*` is public (SPEC U5).

   Crons: trial reminders, membership reconcile, daily.
3. **Clerk production instance:**
   - domain `playchess.tech`, with its DNS records set to DNS only, never proxied;
   - Google OAuth production credentials;
   - the custom session-token claim;
   - the webhook → `/api/webhook/clerk`.

   Existing users get new Clerk ids. The decision is how to re-key `User.googleId`: claim the existing row by verified email on `user.created` (recommended), or bulk-import users through the Clerk Backend API with `external_id`.
4. **Dodo live:**
   - live products for Coaching monthly $4.99 and yearly $50, with the legacy $8 grandfathered;
   - `trial_period_days: 7` verified in live mode;
   - the webhook pointed at prod;
   - one real purchase and refund.
5. **OCI:**
   - prod socket v2 deployed through the `main` path with the drain step;
   - `SOCKET_AUTH_REQUIRED=true`;
   - the worker VM with Caddy routes;
   - UptimeRobot (or Sentry Uptime) on `/health` and `/ready`.
6. **Rehearsal on a child branch of `production`:**
   1. `pg_dump` the old prod read-only (project `shy-morning-50748774`, branch `br-still-brook-a5nutqwh`, database `prisma_migrate_shadow_db_696341e6-…`).
   2. Restore it into the child branch, then `prisma migrate deploy`.
   3. Run the backfills: play columns + `GamePlayer`, `LinkedAccount` from `ChessComProfile`, slugs, `Opening.epd`.
   4. Run the smoke suite, then delete the branch.
   5. Record the row counts to verify against: 104+ users, 378+ games, 3,641 openings, 51 legends, 18 tournaments.

**The window** (maintenance page from P11; the owner confirms each destructive step, per CLAUDE.md rule 5):

1. Lower DNS TTLs to 300 s 24 h ahead.
2. Freeze the old site with the maintenance banner, then the page.
3. Final dump → restore into `production` (database `neondb`) → `migrate deploy` → backfills → verify counts.
4. Create `replay_app`/`replay_worker` with the role timeouts (DB-17); install `pg_stat_statements`.
5. **DNS** in the Cloudflare zone, live since 2026-11-01 with the old records mirrored:
   - apex and `www` → the new Vercel project;
   - Clerk prod records added;
   - `ws-chess` → 132.226.190.10 and `media` (R2) unchanged;
   - Resend SPF, DKIM and DMARC for `hello@playchess.tech`;
   - never proxy the Vercel or Clerk records.
6. 301 map: `/analysis/*`, `/position/*`, `/profile/*`, `/try/*`, cuid legend and opening URLs. Submit sitemaps; run IndexNow.

**After the window.**

- **Monitoring:**
  - Sentry releases with source maps;
  - alerts: 5xx rate, socket `persist.fail`, outbox oldest > 60 s, loop lag p99 > 100 ms, worker queue age > 5 min, Neon compute and storage, Vercel usage;
  - PostHog funnels: landing → sign-up → plan → checkout → first review.
- **Backups:**
  - a nightly `pg_dump` from the worker to `r2://replay-backups/neon/` (14 daily, 8 weekly);
  - a restore drill once a quarter;
  - retire `/tmp/chess_battle_data_fixed.sql` from CLAUDE.md after the first verified backup (DB-02).
- **Rollback (runbook `REPO/docs/runbooks/launch.md`):**
  - Vercel instant rollback to the previous deployment;
  - within 72 h, DNS can go back to the old stack (TTL 300); the old Neon project stays read-only for 30 days;
  - the socket image tags are pinned, and a v1-compatible tag is kept;
  - DB: the pre-migration Neon snapshot.
- **Clean-up.** After 30 stable days, and with owner confirmation, retire the old accounts' resources and run contract migrations C1, C2 and C4.

**Owner test.** A sign-up with a real card on production, then a refund. The old account's games appear on its `/games`. Rollback is rehearsed on the child branch.

---

## 4. Coverage matrix (every board)

Generated from `SP/design-ref/INDEX.md` by `SP/plan/alloc/build_matrix.py`. The script fails if any v3 board is unassigned or assigned twice. "States" is every enum prop in the board's DCLogic `data-props`, read from the file itself. A screen's device boards share its phase.

### 4.1 Counts

| Phase | Name | Boards |
|---|---|---|
| P1 | Design system, app shell and API foundations | 12 |
| P2 | Board and live game | 33 |
| P3 | Server analysis and Game Review | 20 |
| P4 | Game import and onboarding | 27 |
| P5 | Mistake Bank, puzzles, Train and Home | 35 |
| P6 | Weakness Profile | 8 |
| P7 | AI coach | 11 |
| P8 | Learn: legends, legend practice, openings, lessons | 47 |
| P9 | Play hub, matchmaking, challenges, ratings | 20 |
| P10 | Profile, settings, membership, notifications | 39 |
| P11 | Public site, auth, system screens, PWA | 41 |
| P12 | Tournaments and admin | 21 |
| P13 | Production launch | 0 |
| superseded | v1, v2 and the off-canvas draft | 47 |
| **Total** | | **361** |

Per canvas page (rows = page, columns = phase):

| Page | P1 | P2 | P3 | P4 | P5 | P6 | P7 | P8 | P9 | P10 | P11 | P12 | P13 | superseded | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `v1` |  |  |  |  |  |  |  |  |  |  |  |  |  | 22 | 22 |
| `v2` |  |  |  |  |  |  |  |  |  |  |  |  |  | 24 | 24 |
| `v3pub` |  |  | 2 | 25 |  |  |  | 4 |  |  | 22 |  |  |  | 53 |
| `v3play` | 1 | 32 | 6 |  | 3 |  |  | 26 | 20 |  |  |  |  |  | 88 |
| `v3rct` |  | 1 | 12 |  | 32 | 8 | 11 | 17 |  |  |  |  |  |  | 81 |
| `v3acct` |  |  |  | 2 |  |  |  |  |  | 38 |  | 21 |  |  | 61 |
| `v3sys` | 11 |  |  |  |  |  |  |  |  | 1 | 19 |  |  |  | 31 |
| `offcanvas` |  |  |  |  |  |  |  |  |  |  |  |  |  | 1 | 1 |

Totals check: the v3 pages hold 53 + 88 + 81 + 61 + 31 = **314** boards, all assigned to P1–P12. The v1 (22) and v2 (24) pages and the off-canvas `V3ReviewComplete` are **superseded** (47). That makes 361 rows. P13 has no boards.

### 4.2 Full table

| # | File | Title | Device | Page · section | Phase | Feature | States (`data-props` enum) |
|---|---|---|---|---|---|---|---|
| 1 | `v2/V3Landing.dc.html` | v3 · Landing | Desktop | v3pub · Public · logged-out entry, how coaching works, pricing wi… | **P11** | Landing | default, loading, signed_in |
| 2 | `v2/V3TryCatalogue.dc.html` | v3 · Legend practice · Catalogue | Desktop | v3pub · Public · logged-out entry, how coaching works, pricing wi… | **P8** | Legend positions catalogue (public, ISR) | default, loading, error, offline |
| 3 | `v2/V3TryPosition.dc.html` | v3 · Legend practice · Position detail | Desktop | v3pub · Public · logged-out entry, how coaching works, pricing wi… | **P8** | Legend position detail (public, play is members-only) | default, loading, not_found |
| 4 | `v2/V3TryCompare.dc.html` | v3 · Legend practice · Compare with the legend | Desktop | v3pub · Public · logged-out entry, how coaching works, pricing wi… | **P3** | Compare with the legend · quick view (merged into V3LegendCompare) | default, loading, error |
| 5 | `v2/V3HowWeGrade.dc.html` | v3 · How we grade | Desktop | v3pub · Public · logged-out entry, how coaching works, pricing wi… | **P3** | How we grade (public, constants from `packages/chess-analysis`) | — (no enum prop) |
| 6 | `v2/V3Pricing.dc.html` | v3 · Pricing | Desktop | v3pub · Public · logged-out entry, how coaching works, pricing wi… | **P11** | Pricing (7 states incl. required, trial_used, legacy) | logged_out, logged_in, required, member, checkout_failed, legacy, trial_used; plan: monthly, yearly |
| 7 | `v2/V3CheckoutActivating.dc.html` | v3 · Checkout · Activating | Desktop | v3pub · Public · logged-out entry, how coaching works, pricing wi… | **P4** | Checkout activating (`/checkout/activating`, shares the activation component) | polling, success, stalled, failed |
| 8 | `v2/V3SignIn.dc.html` | v3 · Auth · Sign in | Desktop | v3pub · Auth · branded shell around Clerk | **P11** | Auth · sign in (Clerk custom flow) | default, loading, wrong_password, unknown_email, rate_limited, oauth_loading |
| 9 | `v2/V3SignUp.dc.html` | v3 · Auth · Sign up | Desktop | v3pub · Auth · branded shell around Clerk | **P11** | Auth · sign up | default, loading, email_taken, weak_password, empty_fields |
| 10 | `v2/V3VerifyEmail.dc.html` | v3 · Auth · Verify email | Desktop | v3pub · Auth · branded shell around Clerk | **P11** | Auth · verify email | default, verifying, wrong_code, expired, resend_cooldown |
| 11 | `v2/V3ResetPassword.dc.html` | v3 · Auth · Reset password | Desktop | v3pub · Auth · branded shell around Clerk | **P11** | Auth · reset password | default, sending, unknown_email, sent, saving, done |
| 12 | `v2/V3OnbWelcome.dc.html` | v3 · Onboarding · Welcome | Desktop | v3pub · Onboarding · welcome → link → preview → level → goals → p… | **P4** | Onboarding · welcome (resolver) | — (no enum prop) |
| 13 | `v2/V3OnbLink.dc.html` | v3 · Onboarding · Link account | Desktop | v3pub · Onboarding · welcome → link → preview → level → goals → p… | **P4** | Onboarding · link Chess.com / Lichess | default, validating, found, not_found, private_profile, rate_limited, lichess_denied |
| 14 | `v2/V3OnbPreview.dc.html` | v3 · Onboarding · Account preview | Desktop | v3pub · Onboarding · welcome → link → preview → level → goals → p… | **P4** | Onboarding · confirm account preview | default, loading, no_games |
| 15 | `v2/V3OnbRating.dc.html` | v3 · Onboarding · Rating | Desktop | v3pub · Onboarding · welcome → link → preview → level → goals → p… | **P4** | Onboarding · level (rating band) | prefilled, manual |
| 16 | `v2/V3OnbGoals.dc.html` | v3 · Onboarding · Goals | Desktop | v3pub · Onboarding · welcome → link → preview → level → goals → p… | **P4** | Onboarding · goals | default, none_selected |
| 17 | `v2/V3OnbPlan.dc.html` | v3 · Onboarding · Plan | Desktop | v3pub · Onboarding · welcome → link → preview → level → goals → p… | **P4** | Onboarding · plan (start 7-day trial) | default, loading; plan: monthly, yearly |
| 18 | `v2/V3OnbActivating.dc.html` | v3 · Onboarding · Activating | Desktop | v3pub · Onboarding · welcome → link → preview → level → goals → p… | **P4** | Onboarding · activating (entitlement push + poll) | polling, stalled, success |
| 19 | `v2/V3OnbDone.dc.html` | v3 · Onboarding · Done | Desktop | v3pub · Onboarding · welcome → link → preview → level → goals → p… | **P4** | Onboarding · done (import progress) | importing, import_failed, imported |
| 20 | `v2/V3PaywallSoft.dc.html` | v3 · Membership ended | Desktop | v3pub · Membership ended (trial used, renew) · Membership require… | **P11** | Membership ended (renew sheet; scope depends on lapsed-read decision) | under_limit, limit_reached, sheet_open |
| 21 | `v2/V3PaywallHard.dc.html` | v3 · Paywall · Membership required | Desktop | v3pub · Membership ended (trial used, renew) · Membership require… | **P11** | Membership required = `/pricing?reason=required` | plan: monthly, yearly |
| 22 | `v2/V3About.dc.html` | v3 · About | Desktop | v3pub · Marketing templates | **P11** | About | — (no enum prop) |
| 23 | `v2/V3BlogIndex.dc.html` | v3 · Blog · Index | Desktop | v3pub · Marketing templates | **P11** | Blog index | default, loading, empty_category |
| 24 | `v2/V3BlogPost.dc.html` | v3 · Blog · Post | Desktop | v3pub · Marketing templates | **P11** | Blog post | — (no enum prop) |
| 25 | `v2/V3Help.dc.html` | v3 · Help center | Desktop | v3pub · Marketing templates | **P11** | Help center | default, no_results |
| 26 | `v2/V3Contact.dc.html` | v3 · Contact | Desktop | v3pub · Marketing templates | **P11** | Contact (BotID, Resend) | default, sending, sent, error |
| 27 | `v2/V3Legal.dc.html` | v3 · Legal page (Terms / Privacy / Cookies) | Desktop | v3pub · Marketing templates | **P11** | Legal template (terms, privacy, cookies) | — (no enum prop) |
| 28 | `v2/V3iPhoneLanding.dc.html` | v3 · iPhone · Landing | iPhone | v3pub · iPhone · 390 × 844 | **P11** | Landing | — (no enum prop) |
| 29 | `v2/V3iPhoneTryPosition.dc.html` | v3 · iPhone · Legend practice · Position detail | iPhone | v3pub · iPhone · 390 × 844 | **P8** | Legend position detail (public, play is members-only) | default, loading, not_found |
| 30 | `v2/V3iPhonePricing.dc.html` | v3 · iPhone · Pricing | iPhone | v3pub · iPhone · 390 × 844 | **P11** | Pricing (7 states incl. required, trial_used, legacy) | logged_out, logged_in, required, checkout_failed, trial_used; plan: monthly, yearly |
| 31 | `v2/V3iPhoneSignIn.dc.html` | v3 · iPhone · Auth · Sign in | iPhone | v3pub · iPhone · 390 × 844 | **P11** | Auth · sign in (Clerk custom flow) | default, loading, wrong_password, unknown_email, rate_limited, oauth_loading |
| 32 | `v2/V3iPhoneSignUp.dc.html` | v3 · iPhone · Auth · Sign up | iPhone | v3pub · iPhone · 390 × 844 | **P11** | Auth · sign up | default, loading, email_taken, weak_password, empty_fields |
| 33 | `v2/V3iPhoneOnbWelcome.dc.html` | v3 · iPhone · Onboarding · Welcome | iPhone | v3pub · iPhone · 390 × 844 | **P4** | Onboarding · welcome (resolver) | — (no enum prop) |
| 34 | `v2/V3iPhoneOnbLink.dc.html` | v3 · iPhone · Onboarding · Link account | iPhone | v3pub · iPhone · 390 × 844 | **P4** | Onboarding · link Chess.com / Lichess | default, validating, found, not_found, private_profile, rate_limited, lichess_denied |
| 35 | `v2/V3iPhoneOnbPreview.dc.html` | v3 · iPhone · Onboarding · Account preview | iPhone | v3pub · iPhone · 390 × 844 | **P4** | Onboarding · confirm account preview | default, loading, no_games |
| 36 | `v2/V3iPhoneOnbRating.dc.html` | v3 · iPhone · Onboarding · Rating | iPhone | v3pub · iPhone · 390 × 844 | **P4** | Onboarding · level (rating band) | prefilled, manual |
| 37 | `v2/V3iPhoneOnbGoals.dc.html` | v3 · iPhone · Onboarding · Goals | iPhone | v3pub · iPhone · 390 × 844 | **P4** | Onboarding · goals | default, none_selected |
| 38 | `v2/V3iPhoneOnbPlan.dc.html` | v3 · iPhone · Onboarding · Plan | iPhone | v3pub · iPhone · 390 × 844 | **P4** | Onboarding · plan (start 7-day trial) | default, loading; plan: monthly, yearly |
| 39 | `v2/V3iPhoneOnbActivating.dc.html` | v3 · iPhone · Onboarding · Activating | iPhone | v3pub · iPhone · 390 × 844 | **P4** | Onboarding · activating (entitlement push + poll) | polling, stalled, success |
| 40 | `v2/V3iPhoneOnbDone.dc.html` | v3 · iPhone · Onboarding · Done | iPhone | v3pub · iPhone · 390 × 844 | **P4** | Onboarding · done (import progress) | importing, import_failed, imported |
| 41 | `v2/V3iPadLanding.dc.html` | v3 · iPad · Landing | iPad P | v3pub · iPad · 820 × 1180 | **P11** | Landing | — (no enum prop) |
| 42 | `v2/V3iPadTryPosition.dc.html` | v3 · iPad · Legend practice · Position detail | iPad P | v3pub · iPad · 820 × 1180 | **P8** | Legend position detail (public, play is members-only) | default, loading, not_found |
| 43 | `v2/V3iPadPricing.dc.html` | v3 · iPad · Pricing | iPad P | v3pub · iPad · 820 × 1180 | **P11** | Pricing (7 states incl. required, trial_used, legacy) | logged_out, logged_in, required, checkout_failed, trial_used; plan: monthly, yearly |
| 44 | `v2/V3iPadSignIn.dc.html` | v3 · iPad · Auth · Sign in | iPad P | v3pub · iPad · 820 × 1180 | **P11** | Auth · sign in (Clerk custom flow) | default, loading, wrong_password, unknown_email, rate_limited, oauth_loading |
| 45 | `v2/V3iPadSignUp.dc.html` | v3 · iPad · Auth · Sign up | iPad P | v3pub · iPad · 820 × 1180 | **P11** | Auth · sign up | default, loading, email_taken, weak_password, empty_fields |
| 46 | `v2/V3iPadOnbWelcome.dc.html` | v3 · iPad · Onboarding · Welcome | iPad P | v3pub · iPad · 820 × 1180 | **P4** | Onboarding · welcome (resolver) | — (no enum prop) |
| 47 | `v2/V3iPadOnbLink.dc.html` | v3 · iPad · Onboarding · Link account | iPad P | v3pub · iPad · 820 × 1180 | **P4** | Onboarding · link Chess.com / Lichess | default, validating, found, not_found, private_profile, rate_limited, lichess_denied |
| 48 | `v2/V3iPadOnbPreview.dc.html` | v3 · iPad · Onboarding · Account preview | iPad P | v3pub · iPad · 820 × 1180 | **P4** | Onboarding · confirm account preview | default, loading, no_games |
| 49 | `v2/V3iPadOnbRating.dc.html` | v3 · iPad · Onboarding · Rating | iPad P | v3pub · iPad · 820 × 1180 | **P4** | Onboarding · level (rating band) | prefilled, manual |
| 50 | `v2/V3iPadOnbGoals.dc.html` | v3 · iPad · Onboarding · Goals | iPad P | v3pub · iPad · 820 × 1180 | **P4** | Onboarding · goals | default, none_selected |
| 51 | `v2/V3iPadOnbPlan.dc.html` | v3 · iPad · Onboarding · Plan | iPad P | v3pub · iPad · 820 × 1180 | **P4** | Onboarding · plan (start 7-day trial) | default, loading; plan: monthly, yearly |
| 52 | `v2/V3iPadOnbActivating.dc.html` | v3 · iPad · Onboarding · Activating | iPad P | v3pub · iPad · 820 × 1180 | **P4** | Onboarding · activating (entitlement push + poll) | polling, stalled, success |
| 53 | `v2/V3iPadOnbDone.dc.html` | v3 · iPad · Onboarding · Done | iPad P | v3pub · iPad · 820 × 1180 | **P4** | Onboarding · done (import progress) | importing, import_failed, imported |
| 54 | `v2/V3Home.dc.html` | v3 · Home · Populated | Desktop | v3play · Before the game · Home → Play → Queue → Match found | **P5** | Home · populated (`/home`) | populated, new_user, loading, import_running, payment_failed, trial |
| 55 | `v2/V3HomeNewUser.dc.html` | v3 · Home · New user | Desktop | v3play · Before the game · Home → Play → Queue → Match found | **P5** | Home · new user | populated, new_user, loading, import_running, payment_failed, trial |
| 56 | `v2/V3HomeLoading.dc.html` | v3 · Home · Loading | Desktop | v3play · Before the game · Home → Play → Queue → Match found | **P5** | Home · loading | populated, new_user, loading, import_running, payment_failed, trial |
| 57 | `v2/V3PlayHub.dc.html` | v3 · Play hub | Desktop | v3play · Before the game · Home → Play → Queue → Match found | **P9** | Play hub · Legend / Bot / Friend / Online tabs | default, loading, search_empty, creating, error, limit; tab: legend, bot, friend, online |
| 58 | `v2/V3Queue.dc.html` | v3 · Matchmaking · Searching | Desktop | v3play · Before the game · Home → Play → Queue → Match found | **P9** | Matchmaking · searching (socket queue) | initializing, searching, widened, cancelling, error, offline, timeout, creating |
| 59 | `v2/V3NoOpponent.dc.html` | v3 · Matchmaking · No opponent found | Desktop | v3play · Before the game · Home → Play → Queue → Match found | **P9** | Matchmaking · no opponent (bot fallback) | initializing, searching, widened, cancelling, error, offline, timeout, creating |
| 60 | `v2/V3MatchFound.dc.html` | v3 · Match found · Countdown | Desktop | v3play · Before the game · Home → Play → Queue → Match found | **P9** | Match found · countdown | countdown, ready |
| 61 | `v2/V3ChallengeShare.dc.html` | v3 · Challenge · Share link (waiting) | Desktop | v3play · Friends and shared positions · challenge link → accept (s… | **P9** | Challenge · share link, waiting | waiting, copied, expired, cancelled, error |
| 62 | `v2/V3ChallengeAccept.dc.html` | v3 · Challenge · Accept (invitee) | Desktop | v3play · Friends and shared positions · challenge link → accept (s… | **P9** | Challenge · accept (signed in) | default, loading, joining, unavailable, already_started, own_link, paywalled, logged_out |
| 63 | `v2/V3ChallengeAcceptGuest.dc.html` | v3 · Challenge · Accept (signed out) | Desktop | v3play · Friends and shared positions · challenge link → accept (s… | **P9** | Challenge · accept (signed out, OG preview) | default, loading, joining, unavailable, already_started, own_link, paywalled, logged_out |
| 64 | `v2/V3PositionShare.dc.html` | v3 · Shared position | Desktop | v3play · Friends and shared positions · challenge link → accept (s… | **P9** | Shared position (`/s/[code]`) | default, loading, not_found, creating, paywalled |
| 65 | `v2/V3StudyPhase.dc.html` | v3 · Game · Study the position (30 s) | Desktop | v3play · Study phase and the game · one interactive board with eve… | **P2** | Game · study phase (30 s, ready) | loading, waiting, study, study_last5, study_reconnect, abort, rematch_study, rematch_first, rematch_your, your_move, their_move, premove, premove_cancelled, check, ill… |
| 66 | `v2/V3Game.dc.html` | v3 · Game · All states (tweak) · Your move | Desktop | v3play · Study phase and the game · one interactive board with eve… | **P2** | Game template · all 55 states | loading, waiting, study, study_last5, study_reconnect, abort, rematch_study, rematch_first, rematch_your, your_move, their_move, premove, premove_cancelled, check, ill… |
| 67 | `v2/V3GamePrototype.dc.html` | v3 · Game · Playable prototype | Desktop | v3play · Study phase and the game · one interactive board with eve… | **P2** | Board input contract (click, drag, premove, promotion) | — (no enum prop) |
| 68 | `v2/V3GameTheirMove.dc.html` | v3 · Game · Opponent to move | Desktop | v3play · Study phase and the game · one interactive board with eve… | **P2** | Game · opponent to move | loading, waiting, study, study_last5, study_reconnect, abort, rematch_study, rematch_first, rematch_your, your_move, their_move, premove, premove_cancelled, check, ill… |
| 69 | `v2/V3GameBot.dc.html` | v3 · Game · vs Bot (hint, undo) | Desktop | v3play · Study phase and the game · one interactive board with eve… | **P2** | Game · vs bot (client runner, hint, undo) | loading, waiting, study, study_last5, study_reconnect, abort, rematch_study, rematch_first, rematch_your, your_move, their_move, premove, premove_cancelled, check, ill… |
| 70 | `v2/V3Spectate.dc.html` | v3 · Game · Spectating | Desktop | v3play · Study phase and the game · one interactive board with eve… | **P2** | Game · spectating (delayed) | loading, waiting, study, study_last5, study_reconnect, abort, rematch_study, rematch_first, rematch_your, your_move, their_move, premove, premove_cancelled, check, ill… |
| 71 | `v2/V3GamePremove.dc.html` | v3 · Game · Premove queued | Desktop | v3play · In-game states · separate boards of the same V3Game template | **P2** | Game · premove queued | loading, waiting, study, study_last5, study_reconnect, abort, rematch_study, rematch_first, rematch_your, your_move, their_move, premove, premove_cancelled, check, ill… |
| 72 | `v2/V3GameCheck.dc.html` | v3 · Game · Check | Desktop | v3play · In-game states · separate boards of the same V3Game template | **P2** | Game · check | loading, waiting, study, study_last5, study_reconnect, abort, rematch_study, rematch_first, rematch_your, your_move, their_move, premove, premove_cancelled, check, ill… |
| 73 | `v2/V3GameIllegal.dc.html` | v3 · Game · Illegal move | Desktop | v3play · In-game states · separate boards of the same V3Game template | **P2** | Game · illegal move + reason | loading, waiting, study, study_last5, study_reconnect, abort, rematch_study, rematch_first, rematch_your, your_move, their_move, premove, premove_cancelled, check, ill… |
| 74 | `v2/V3GamePromotion.dc.html` | v3 · Game · Promotion picker | Desktop | v3play · In-game states · separate boards of the same V3Game template | **P2** | Game · promotion picker | loading, waiting, study, study_last5, study_reconnect, abort, rematch_study, rematch_first, rematch_your, your_move, their_move, premove, premove_cancelled, check, ill… |
| 75 | `v2/V3GameLowTime.dc.html` | v3 · Game · Low time (under 10 s) | Desktop | v3play · In-game states · separate boards of the same V3Game template | **P2** | Game · low time (tenths) | loading, waiting, study, study_last5, study_reconnect, abort, rematch_study, rematch_first, rematch_your, your_move, their_move, premove, premove_cancelled, check, ill… |
| 76 | `v2/V3GameDrawOffer.dc.html` | v3 · Game · Draw offer received | Desktop | v3play · In-game states · separate boards of the same V3Game template | **P2** | Game · draw offer received | loading, waiting, study, study_last5, study_reconnect, abort, rematch_study, rematch_first, rematch_your, your_move, their_move, premove, premove_cancelled, check, ill… |
| 77 | `v2/V3GameResign.dc.html` | v3 · Game · Resign confirm (popover) | Desktop | v3play · In-game states · separate boards of the same V3Game template | **P2** | Game · resign confirm | loading, waiting, study, study_last5, study_reconnect, abort, rematch_study, rematch_first, rematch_your, your_move, their_move, premove, premove_cancelled, check, ill… |
| 78 | `v2/V3GameOppDisconnected.dc.html` | v3 · Game · Opponent disconnected (30 s grace) | Desktop | v3play · In-game states · separate boards of the same V3Game template | **P2** | Game · opponent disconnected (30 s ring) | loading, waiting, study, study_last5, study_reconnect, abort, rematch_study, rematch_first, rematch_your, your_move, their_move, premove, premove_cancelled, check, ill… |
| 79 | `v2/V3GameReconnecting.dc.html` | v3 · Game · You are reconnecting | Desktop | v3play · In-game states · separate boards of the same V3Game template | **P2** | Game · you are reconnecting (outbox) | loading, waiting, study, study_last5, study_reconnect, abort, rematch_study, rematch_first, rematch_your, your_move, their_move, premove, premove_cancelled, check, ill… |
| 80 | `v2/V3GameOver.dc.html` | v3 · Game over · Win by checkmate | Desktop | v3play · Game over · result card replaces the panel top, never cov… | **P2** | Game over card · checkmate | loading, waiting, study, study_last5, study_reconnect, abort, rematch_study, rematch_first, rematch_your, your_move, their_move, premove, premove_cancelled, check, ill… |
| 81 | `v2/V3GameOverLoss.dc.html` | v3 · Game over · You resigned | Desktop | v3play · Game over · result card replaces the panel top, never cov… | **P2** | Game over card · resigned | loading, waiting, study, study_last5, study_reconnect, abort, rematch_study, rematch_first, rematch_your, your_move, their_move, premove, premove_cancelled, check, ill… |
| 82 | `v2/V3GameOverDraw.dc.html` | v3 · Game over · Draw agreed | Desktop | v3play · Game over · result card replaces the panel top, never cov… | **P2** | Game over card · draw agreed | loading, waiting, study, study_last5, study_reconnect, abort, rematch_study, rematch_first, rematch_your, your_move, their_move, premove, premove_cancelled, check, ill… |
| 83 | `v2/V3GameOverTimeout.dc.html` | v3 · Game over · Lost on time | Desktop | v3play · Game over · result card replaces the panel top, never cov… | **P2** | Game over card · lost on time | loading, waiting, study, study_last5, study_reconnect, abort, rematch_study, rematch_first, rematch_your, your_move, their_move, premove, premove_cancelled, check, ill… |
| 84 | `v2/V3GameOverLegend.dc.html` | v3 · Game over · Legend comparison | Desktop | v3play · Game over · result card replaces the panel top, never cov… | **P3** | Game over card · legend comparison teaser | loading, waiting, study, study_last5, study_reconnect, abort, rematch_study, rematch_first, rematch_your, your_move, their_move, premove, premove_cancelled, check, ill… |
| 85 | `v2/V3RematchOffer.dc.html` | v3 · Game over · Rematch offer received | Desktop | v3play · Game over · result card replaces the panel top, never cov… | **P2** | Game over · rematch offer (colour swap) | loading, waiting, study, study_last5, study_reconnect, abort, rematch_study, rematch_first, rematch_your, your_move, their_move, premove, premove_cancelled, check, ill… |
| 86 | `v2/V3LegendCompare.dc.html` | v3 · Compare with the legend | Desktop | v3play · After the game · legend compare, practice, archive (revie… | **P3** | Compare with the legend (`/review/[ref]/legend`) | default, loading, no_explanation, audio_failed; tab: explanation, your_moves, legend_moves, practice |
| 87 | `v2/V3Practice.dc.html` | v3 · Practice from position | Desktop | v3play · After the game · legend compare, practice, archive (revie… | **P3** | Practice from a position (`/practice`) | default, engine_loading, engine_failed, offline |
| 88 | `v2/V3GamesArchive.dc.html` | v3 · My games | Desktop | v3play · After the game · legend compare, practice, archive (revie… | **P3** | My games archive (`/games`, nav Review) | default, filters_open, empty, loading, import_running, error |
| 89 | `v2/V3GamesArchiveFilters.dc.html` | v3 · My games · Filters open | Desktop | v3play · After the game · legend compare, practice, archive (revie… | **P3** | My games · filters popover / sheet | default, filters_open, empty, loading, import_running, error |
| 90 | `v2/V3GamesArchiveEmpty.dc.html` | v3 · My games · Empty | Desktop | v3play · After the game · legend compare, practice, archive (revie… | **P3** | My games · empty | default, filters_open, empty, loading, import_running, error |
| 91 | `v2/V3TryGame.dc.html` | v3 · Legend practice · Practice game | Desktop | v3play · Legend practice game · members, ends in the coach review | **P8** | Legend practice game · all states (Morphy, Opera Game) | study, your_move, their_move, check, promotion, over_guest |
| 92 | `v2/V3TryGameOver.dc.html` | v3 · Legend practice · Practice game over | Desktop | v3play · Legend practice game · members, ends in the coach review | **P8** | Legend practice game over (→ review, compare) | study, your_move, their_move, check, promotion, over_guest |
| 93 | `v2/V3TryGameKT.dc.html` | v3 · Legend practice · Practice vs Bot · Kasparov vs Topalov (playable from this position) | Desktop | v3play · Legend practice game · members, ends in the coach review | **P8** | Legend practice game · Kasparov vs Topalov | — (no enum prop) |
| 94 | `v2/V3TryGameBF.dc.html` | v3 · Legend practice · Practice vs Bot · Byrne vs Fischer (playable from this position) | Desktop | v3play · Legend practice game · members, ends in the coach review | **P8** | Legend practice game · Byrne vs Fischer | — (no enum prop) |
| 95 | `v2/V3TryGameAK.dc.html` | v3 · Legend practice · Practice vs Bot · Anderssen vs Kieseritzky (playable from this position) | Desktop | v3play · Legend practice game · members, ends in the coach review | **P8** | Legend practice game · Anderssen vs Kieseritzky | — (no enum prop) |
| 96 | `v2/V3TryGameTS.dc.html` | v3 · Legend practice · Practice vs Bot · Topalov vs Shirov (playable from this position) | Desktop | v3play · Legend practice game · members, ends in the coach review | **P8** | Legend practice game · Topalov vs Shirov | — (no enum prop) |
| 97 | `v2/V3iPhonePlayHub.dc.html` | v3 · iPhone · Play hub | iPhone | v3play · iPhone · 393 × 852 | **P9** | Play hub · Legend / Bot / Friend / Online tabs | default, loading, search_empty, creating, error, limit; tab: legend, bot, friend, online |
| 98 | `v2/V3iPhoneQueue.dc.html` | v3 · iPhone · Matchmaking · Searching | iPhone | v3play · iPhone · 393 × 852 | **P9** | Matchmaking · searching (socket queue) | initializing, searching, widened, cancelling, error, offline, timeout, creating |
| 99 | `v2/V3iPhoneMatchFound.dc.html` | v3 · iPhone · Match found | iPhone | v3play · iPhone · 393 × 852 | **P9** | Match found · countdown | countdown, ready |
| 100 | `v2/V3iPhoneGame.dc.html` | v3 · iPhone · Game · All states (tweak) | iPhone | v3play · iPhone · 393 × 852 | **P2** | Game template · all 55 states | loading, waiting, study, study_last5, study_reconnect, abort, rematch_study, rematch_first, rematch_your, your_move, their_move, premove, premove_cancelled, check, ill… |
| 101 | `v2/V3iPhoneGameDrawOffer.dc.html` | v3 · iPhone · Game · Draw offer received | iPhone | v3play · iPhone · 393 × 852 | **P2** | Game · draw offer received | loading, waiting, study, study_last5, study_reconnect, abort, rematch_study, rematch_first, rematch_your, your_move, their_move, premove, premove_cancelled, check, ill… |
| 102 | `v2/V3iPhoneGameOver.dc.html` | v3 · iPhone · Game over · Result sheet | iPhone | v3play · iPhone · 393 × 852 | **P2** | Game over · result sheet (phones, iPad P) / card (iPad L) | loading, waiting, study, study_last5, study_reconnect, abort, rematch_study, rematch_first, rematch_your, your_move, their_move, premove, premove_cancelled, check, ill… |
| 103 | `v2/V3AndroidPlayHub.dc.html` | v3 · Android · Play hub | Android | v3play · Android · 412 × 915 | **P9** | Play hub · Legend / Bot / Friend / Online tabs | default, loading, search_empty, creating, error, limit; tab: legend, bot, friend, online |
| 104 | `v2/V3AndroidQueue.dc.html` | v3 · Android · Matchmaking · Searching | Android | v3play · Android · 412 × 915 | **P9** | Matchmaking · searching (socket queue) | initializing, searching, widened, cancelling, error, offline, timeout, creating |
| 105 | `v2/V3AndroidMatchFound.dc.html` | v3 · Android · Match found | Android | v3play · Android · 412 × 915 | **P9** | Match found · countdown | countdown, ready |
| 106 | `v2/V3AndroidGame.dc.html` | v3 · Android · Game · All states (tweak) | Android | v3play · Android · 412 × 915 | **P2** | Game template · all 55 states | loading, waiting, study, study_last5, study_reconnect, abort, rematch_study, rematch_first, rematch_your, your_move, their_move, premove, premove_cancelled, check, ill… |
| 107 | `v2/V3AndroidGameDrawOffer.dc.html` | v3 · Android · Game · Draw offer received | Android | v3play · Android · 412 × 915 | **P2** | Game · draw offer received | loading, waiting, study, study_last5, study_reconnect, abort, rematch_study, rematch_first, rematch_your, your_move, their_move, premove, premove_cancelled, check, ill… |
| 108 | `v2/V3AndroidGameOver.dc.html` | v3 · Android · Game over · Result sheet | Android | v3play · Android · 412 × 915 | **P2** | Game over · result sheet (phones, iPad P) / card (iPad L) | loading, waiting, study, study_last5, study_reconnect, abort, rematch_study, rematch_first, rematch_your, your_move, their_move, premove, premove_cancelled, check, ill… |
| 109 | `v2/V3iPadLPlayHub.dc.html` | v3 · iPad landscape · Play hub | iPad L | v3play · iPad landscape · 1194 × 834 | **P9** | Play hub · Legend / Bot / Friend / Online tabs | default, loading, search_empty, creating, error, limit; tab: legend, bot, friend, online |
| 110 | `v2/V3iPadLQueue.dc.html` | v3 · iPad landscape · Matchmaking · Searching | iPad L | v3play · iPad landscape · 1194 × 834 | **P9** | Matchmaking · searching (socket queue) | initializing, searching, widened, cancelling, error, offline, timeout, creating |
| 111 | `v2/V3iPadLMatchFound.dc.html` | v3 · iPad landscape · Match found | iPad L | v3play · iPad landscape · 1194 × 834 | **P9** | Match found · countdown | countdown, ready |
| 112 | `v2/V3iPadLGame.dc.html` | v3 · iPad landscape · Game · All states (tweak) | iPad L | v3play · iPad landscape · 1194 × 834 | **P2** | Game template · all 55 states | loading, waiting, study, study_last5, study_reconnect, abort, rematch_study, rematch_first, rematch_your, your_move, their_move, premove, premove_cancelled, check, ill… |
| 113 | `v2/V3iPadLGameDrawOffer.dc.html` | v3 · iPad landscape · Game · Draw offer received | iPad L | v3play · iPad landscape · 1194 × 834 | **P2** | Game · draw offer received | loading, waiting, study, study_last5, study_reconnect, abort, rematch_study, rematch_first, rematch_your, your_move, their_move, premove, premove_cancelled, check, ill… |
| 114 | `v2/V3iPadLGameOver.dc.html` | v3 · iPad landscape · Game over · Result sheet | iPad L | v3play · iPad landscape · 1194 × 834 | **P2** | Game over · result sheet (phones, iPad P) / card (iPad L) | loading, waiting, study, study_last5, study_reconnect, abort, rematch_study, rematch_first, rematch_your, your_move, their_move, premove, premove_cancelled, check, ill… |
| 115 | `v2/V3iPadPPlayHub.dc.html` | v3 · iPad portrait · Play hub | iPad P | v3play · iPad portrait · 834 × 1194 | **P9** | Play hub · Legend / Bot / Friend / Online tabs | default, loading, search_empty, creating, error, limit; tab: legend, bot, friend, online |
| 116 | `v2/V3iPadPQueue.dc.html` | v3 · iPad portrait · Matchmaking · Searching | iPad P | v3play · iPad portrait · 834 × 1194 | **P9** | Matchmaking · searching (socket queue) | initializing, searching, widened, cancelling, error, offline, timeout, creating |
| 117 | `v2/V3iPadPMatchFound.dc.html` | v3 · iPad portrait · Match found | iPad P | v3play · iPad portrait · 834 × 1194 | **P9** | Match found · countdown | countdown, ready |
| 118 | `v2/V3iPadPGame.dc.html` | v3 · iPad portrait · Game · All states (tweak) | iPad P | v3play · iPad portrait · 834 × 1194 | **P2** | Game template · all 55 states | loading, waiting, study, study_last5, study_reconnect, abort, rematch_study, rematch_first, rematch_your, your_move, their_move, premove, premove_cancelled, check, ill… |
| 119 | `v2/V3iPadPGameDrawOffer.dc.html` | v3 · iPad portrait · Game · Draw offer received | iPad P | v3play · iPad portrait · 834 × 1194 | **P2** | Game · draw offer received | loading, waiting, study, study_last5, study_reconnect, abort, rematch_study, rematch_first, rematch_your, your_move, their_move, premove, premove_cancelled, check, ill… |
| 120 | `v2/V3iPadPGameOver.dc.html` | v3 · iPad portrait · Game over · Result sheet | iPad P | v3play · iPad portrait · 834 × 1194 | **P2** | Game over · result sheet (phones, iPad P) / card (iPad L) | loading, waiting, study, study_last5, study_reconnect, abort, rematch_study, rematch_first, rematch_your, your_move, their_move, premove, premove_cancelled, check, ill… |
| 121 | `v2/V3Nav.dc.html` | v3 · Shared · Sidebar (the one app nav: Home, Play + Tournaments, Train, Learn, Review, Profile, Settings) | Component | v3play · Shared | **P1** | App nav: sidebar / rail / tab bar / top bar (SPEC §8, inv-sys §3.20) | current: home, play, train, learn, review, profile, settings |
| 122 | `v2/V3iPhoneTryGameKT.dc.html` | v3 · iPhone · Legend practice · Practice vs Bot · Kasparov vs Topalov (playable) | iPhone | v3play · Legend practice game · Kasparov vs Topalov · iPhone, Andr… | **P8** | Legend practice game · Kasparov vs Topalov | — (no enum prop) |
| 123 | `v2/V3AndroidTryGameKT.dc.html` | v3 · Android · Legend practice · Practice vs Bot · Kasparov vs Topalov (playable) | Android | v3play · Legend practice game · Kasparov vs Topalov · iPhone, Andr… | **P8** | Legend practice game · Kasparov vs Topalov | — (no enum prop) |
| 124 | `v2/V3iPadPTryGameKT.dc.html` | v3 · iPad portrait · Legend practice · Practice vs Bot · Kasparov vs Topalov (playable) | iPad P | v3play · Legend practice game · Kasparov vs Topalov · iPhone, Andr… | **P8** | Legend practice game · Kasparov vs Topalov | — (no enum prop) |
| 125 | `v2/V3iPadLTryGameKT.dc.html` | v3 · iPad landscape · Legend practice · Practice vs Bot · Kasparov vs Topalov (playable) | iPad L | v3play · Legend practice game · Kasparov vs Topalov · iPhone, Andr… | **P8** | Legend practice game · Kasparov vs Topalov | — (no enum prop) |
| 126 | `v2/V3iPhoneTryGameBF.dc.html` | v3 · iPhone · Legend practice · Practice vs Bot · Byrne vs Fischer (playable) | iPhone | v3play · Legend practice game · Byrne vs Fischer · iPhone, Android… | **P8** | Legend practice game · Byrne vs Fischer | — (no enum prop) |
| 127 | `v2/V3AndroidTryGameBF.dc.html` | v3 · Android · Legend practice · Practice vs Bot · Byrne vs Fischer (playable) | Android | v3play · Legend practice game · Byrne vs Fischer · iPhone, Android… | **P8** | Legend practice game · Byrne vs Fischer | — (no enum prop) |
| 128 | `v2/V3iPadPTryGameBF.dc.html` | v3 · iPad portrait · Legend practice · Practice vs Bot · Byrne vs Fischer (playable) | iPad P | v3play · Legend practice game · Byrne vs Fischer · iPhone, Android… | **P8** | Legend practice game · Byrne vs Fischer | — (no enum prop) |
| 129 | `v2/V3iPadLTryGameBF.dc.html` | v3 · iPad landscape · Legend practice · Practice vs Bot · Byrne vs Fischer (playable) | iPad L | v3play · Legend practice game · Byrne vs Fischer · iPhone, Android… | **P8** | Legend practice game · Byrne vs Fischer | — (no enum prop) |
| 130 | `v2/V3iPhoneTryGameAK.dc.html` | v3 · iPhone · Legend practice · Practice vs Bot · Anderssen vs Kieseritzky (playable) | iPhone | v3play · Legend practice game · Anderssen vs Kieseritzky · iPhone,… | **P8** | Legend practice game · Anderssen vs Kieseritzky | — (no enum prop) |
| 131 | `v2/V3AndroidTryGameAK.dc.html` | v3 · Android · Legend practice · Practice vs Bot · Anderssen vs Kieseritzky (playable) | Android | v3play · Legend practice game · Anderssen vs Kieseritzky · iPhone,… | **P8** | Legend practice game · Anderssen vs Kieseritzky | — (no enum prop) |
| 132 | `v2/V3iPadPTryGameAK.dc.html` | v3 · iPad portrait · Legend practice · Practice vs Bot · Anderssen vs Kieseritzky (playable) | iPad P | v3play · Legend practice game · Anderssen vs Kieseritzky · iPhone,… | **P8** | Legend practice game · Anderssen vs Kieseritzky | — (no enum prop) |
| 133 | `v2/V3iPadLTryGameAK.dc.html` | v3 · iPad landscape · Legend practice · Practice vs Bot · Anderssen vs Kieseritzky (playable) | iPad L | v3play · Legend practice game · Anderssen vs Kieseritzky · iPhone,… | **P8** | Legend practice game · Anderssen vs Kieseritzky | — (no enum prop) |
| 134 | `v2/V3iPhoneTryGameTS.dc.html` | v3 · iPhone · Legend practice · Practice vs Bot · Topalov vs Shirov (playable) | iPhone | v3play · Legend practice game · Topalov vs Shirov · iPhone, Androi… | **P8** | Legend practice game · Topalov vs Shirov | — (no enum prop) |
| 135 | `v2/V3AndroidTryGameTS.dc.html` | v3 · Android · Legend practice · Practice vs Bot · Topalov vs Shirov (playable) | Android | v3play · Legend practice game · Topalov vs Shirov · iPhone, Androi… | **P8** | Legend practice game · Topalov vs Shirov | — (no enum prop) |
| 136 | `v2/V3iPadPTryGameTS.dc.html` | v3 · iPad portrait · Legend practice · Practice vs Bot · Topalov vs Shirov (playable) | iPad P | v3play · Legend practice game · Topalov vs Shirov · iPhone, Androi… | **P8** | Legend practice game · Topalov vs Shirov | — (no enum prop) |
| 137 | `v2/V3iPadLTryGameTS.dc.html` | v3 · iPad landscape · Legend practice · Practice vs Bot · Topalov vs Shirov (playable) | iPad L | v3play · Legend practice game · Topalov vs Shirov · iPhone, Androi… | **P8** | Legend practice game · Topalov vs Shirov | — (no enum prop) |
| 138 | `v2/V3iPhoneTryGame.dc.html` | v3 · iPhone · Legend practice · Practice vs Bot · Morphy · Opera Game (playable) | iPhone | v3play · Legend practice game · Morphy · Opera Game · iPhone, Andr… | **P8** | Legend practice game · all states (Morphy, Opera Game) | — (no enum prop) |
| 139 | `v2/V3AndroidTryGame.dc.html` | v3 · Android · Legend practice · Practice vs Bot · Morphy · Opera Game (playable) | Android | v3play · Legend practice game · Morphy · Opera Game · iPhone, Andr… | **P8** | Legend practice game · all states (Morphy, Opera Game) | — (no enum prop) |
| 140 | `v2/V3iPadPTryGame.dc.html` | v3 · iPad portrait · Legend practice · Practice vs Bot · Morphy · Opera Game (playable) | iPad P | v3play · Legend practice game · Morphy · Opera Game · iPhone, Andr… | **P8** | Legend practice game · all states (Morphy, Opera Game) | — (no enum prop) |
| 141 | `v2/V3iPadLTryGame.dc.html` | v3 · iPad landscape · Legend practice · Practice vs Bot · Morphy · Opera Game (playable) | iPad L | v3play · Legend practice game · Morphy · Opera Game · iPhone, Andr… | **P8** | Legend practice game · all states (Morphy, Opera Game) | — (no enum prop) |
| 142 | `v2/V3ReviewAnalysing.dc.html` | v3 · Review · Analysing (auto-advances to summary) | Desktop | v3rct · Review · analysing → summary → key moments → complete → s… | **P3** | Review · analysing (live badges, auto-advance) | analysing, failed, clean, summary, moment |
| 143 | `v2/V3ReviewFailed.dc.html` | v3 · Review · Analysis failed, retry | Desktop | v3rct · Review · analysing → summary → key moments → complete → s… | **P3** | Review · analysis failed, retry from ply | analysing, failed, clean, summary, moment |
| 144 | `v2/V3ReviewClean.dc.html` | v3 · Review · Clean game (no mistakes) | Desktop | v3rct · Review · analysing → summary → key moments → complete → s… | **P3** | Review · clean game | analysing, failed, clean, summary, moment |
| 145 | `v2/V3ReviewSummary.dc.html` | v3 · Review · Summary, eval graph, badges, narration | Desktop | v3rct · Review · analysing → summary → key moments → complete → s… | **P3** | Review · summary, eval graph, badges, narration (template text) | analysing, failed, clean, summary, moment |
| 146 | `v2/V3KeyMoments.dc.html` | v3 · Review · Key moments walkthrough | Desktop | v3rct · Review · analysing → summary → key moments → complete → s… | **P3** | Review · key moments walkthrough | analysing, failed, clean, summary, moment |
| 147 | `v2/V3RvComplete.dc.html` | v3 · Review complete · drill these 3 mistakes | Desktop | v3rct · Review · analysing → summary → key moments → complete → s… | **P3** | Review complete · drill these mistakes (bank lines light up in P5) | default, nothing |
| 148 | `v2/V3RvCompleteClean.dc.html` | v3 · Review complete · nothing added | Desktop | v3rct · Review · analysing → summary → key moments → complete → s… | **P3** | Review complete · clean (nothing added) | default, nothing |
| 149 | `v2/V3RvShare.dc.html` | v3 · Share analysis (generating → ready) | Desktop | v3rct · Review · analysing → summary → key moments → complete → s… | **P3** | Share analysis + public `/r/[slug]` snapshot | generating, ready |
| 150 | `v2/V3CoachSuggested.dc.html` | v3 · Coach · Suggested questions | Desktop | v3rct · Ask the Coach · suggested, explain a move, typing, stream… | **P7** | Coach · suggested questions | suggested, explain, typing, streaming, error, ratelimit, paywall |
| 151 | `v2/V3CoachExplain.dc.html` | v3 · Coach · Explain this move (from review) | Desktop | v3rct · Ask the Coach · suggested, explain a move, typing, stream… | **P7** | Coach · explain this move (from review) | suggested, explain, typing, streaming, error, ratelimit, paywall |
| 152 | `v2/V3CoachTyping.dc.html` | v3 · Coach · Typing | Desktop | v3rct · Ask the Coach · suggested, explain a move, typing, stream… | **P7** | Coach · typing | suggested, explain, typing, streaming, error, ratelimit, paywall |
| 153 | `v2/V3CoachStreaming.dc.html` | v3 · Coach · Streaming reply (auto) | Desktop | v3rct · Ask the Coach · suggested, explain a move, typing, stream… | **P7** | Coach · streaming reply (SSE) | suggested, explain, typing, streaming, error, ratelimit, paywall |
| 154 | `v2/V3CoachError.dc.html` | v3 · Coach · Error, engine-line fallback | Desktop | v3rct · Ask the Coach · suggested, explain a move, typing, stream… | **P7** | Coach · error, engine-line fallback | suggested, explain, typing, streaming, error, ratelimit, paywall |
| 155 | `v2/V3CoachRateLimit.dc.html` | v3 · Coach · Rate limited (countdown) | Desktop | v3rct · Ask the Coach · suggested, explain a move, typing, stream… | **P7** | Coach · rate limited (fair-use countdown) | suggested, explain, typing, streaming, error, ratelimit, paywall |
| 156 | `v2/V3CoachPaywall.dc.html` | v3 · Coach · Membership ended | Desktop | v3rct · Ask the Coach · suggested, explain a move, typing, stream… | **P7** | Coach · membership ended (in-place 402 sheet) | suggested, explain, typing, streaming, error, ratelimit, paywall |
| 157 | `v2/V3TrainHub.dc.html` | v3 · Train hub · Daily plan | Desktop | v3rct · Train · hub → Mistake Bank states → drill → session summary | **P5** | Train hub · daily plan | default, nothingdue, loading |
| 158 | `v2/V3TrainHubDone.dc.html` | v3 · Train hub · Nothing due | Desktop | v3rct · Train · hub → Mistake Bank states → drill → session summary | **P5** | Train hub · nothing due | default, nothingdue, loading |
| 159 | `v2/V3TrainHubLoading.dc.html` | v3 · Train hub · Loading | Desktop | v3rct · Train · hub → Mistake Bank states → drill → session summary | **P5** | Train hub · loading | default, nothingdue, loading |
| 160 | `v2/V3BankEmpty.dc.html` | v3 · Mistake Bank · Empty (new user) | Desktop | v3rct · Train · hub → Mistake Bank states → drill → session summary | **P5** | Mistake Bank · empty | empty, caughtup, loading |
| 161 | `v2/V3BankCaughtUp.dc.html` | v3 · Mistake Bank · All caught up | Desktop | v3rct · Train · hub → Mistake Bank states → drill → session summary | **P5** | Mistake Bank · all caught up | empty, caughtup, loading |
| 162 | `v2/V3BankLoading.dc.html` | v3 · Mistake Bank · Loading | Desktop | v3rct · Train · hub → Mistake Bank states → drill → session summary | **P5** | Mistake Bank · loading | empty, caughtup, loading |
| 163 | `v2/V3BankSession.dc.html` | v3 · Mistake Bank drill (solve → FSRS grade → next) | Desktop | v3rct · Train · hub → Mistake Bank states → drill → session summary | **P5** | Mistake Bank drill (runner, FSRS grade) | solve, hint, wrong, correct, solution, themes |
| 164 | `v2/V3SessionSummary.dc.html` | v3 · Training session summary | Desktop | v3rct · Train · hub → Mistake Bank states → drill → session summary | **P5** | Training session summary | default, perfect |
| 165 | `v2/V3SessionPerfect.dc.html` | v3 · Training session summary · Perfect | Desktop | v3rct · Train · hub → Mistake Bank states → drill → session summary | **P5** | Training session summary · perfect | default, perfect |
| 166 | `v2/V3PuzzleSolve.dc.html` | v3 · Puzzles · Solve (click a move) | Desktop | v3rct · Puzzle session · solve, hint, wrong, correct + FSRS, solu… | **P5** | Puzzles · solve | solve, hint, wrong, correct, solution, themes |
| 167 | `v2/V3PuzzleHint.dc.html` | v3 · Puzzles · Hint step 1 | Desktop | v3rct · Puzzle session · solve, hint, wrong, correct + FSRS, solu… | **P5** | Puzzles · hint step 1 | solve, hint, wrong, correct, solution, themes |
| 168 | `v2/V3PuzzleWrong.dc.html` | v3 · Puzzles · Wrong, try again | Desktop | v3rct · Puzzle session · solve, hint, wrong, correct + FSRS, solu… | **P5** | Puzzles · wrong, try again | solve, hint, wrong, correct, solution, themes |
| 169 | `v2/V3PuzzleCorrect.dc.html` | v3 · Puzzles · Correct + FSRS grading | Desktop | v3rct · Puzzle session · solve, hint, wrong, correct + FSRS, solu… | **P5** | Puzzles · correct + FSRS grading | solve, hint, wrong, correct, solution, themes |
| 170 | `v2/V3PuzzleSolution.dc.html` | v3 · Puzzles · Solution shown | Desktop | v3rct · Puzzle session · solve, hint, wrong, correct + FSRS, solu… | **P5** | Puzzles · solution shown | solve, hint, wrong, correct, solution, themes |
| 171 | `v2/V3PuzzleThemes.dc.html` | v3 · Puzzles · Theme picker popover | Desktop | v3rct · Puzzle session · solve, hint, wrong, correct + FSRS, solu… | **P5** | Puzzles · theme picker popover / sheet | solve, hint, wrong, correct, solution, themes |
| 172 | `v2/V3WeaknessInsufficient.dc.html` | v3 · Weakness · Insufficient data (14/20) | Desktop | v3rct · Weakness profile · insufficient data, computing, drill a … | **P6** | Weakness · insufficient data | insufficient, computing, drill |
| 173 | `v2/V3WeaknessComputing.dc.html` | v3 · Weakness · Computing (auto) | Desktop | v3rct · Weakness profile · insufficient data, computing, drill a … | **P6** | Weakness · computing (progressive) | insufficient, computing, drill |
| 174 | `v2/V3WeaknessDrill.dc.html` | v3 · Weakness · Drill a weakness | Desktop | v3rct · Weakness profile · insufficient data, computing, drill a … | **P6** | Weakness · drill a weakness (session config) | insufficient, computing, drill |
| 175 | `v2/V3LegendsCatalogue.dc.html` | v3 · Legends catalogue | Desktop | v3rct · Learn · catalogue → detail → lesson → complete · openings | **P8** | Legends catalogue (public, ISR) | default, filtered, empty |
| 176 | `v2/V3LegendsEmpty.dc.html` | v3 · Legends catalogue · No results | Desktop | v3rct · Learn · catalogue → detail → lesson → complete · openings | **P8** | Legends catalogue · no results | default, filtered, empty |
| 177 | `v2/V3LegendDetail.dc.html` | v3 · Legend detail · Morphy | Desktop | v3rct · Learn · catalogue → detail → lesson → complete · openings | **P8** | Legend detail (public, lessons island) | — (no enum prop) |
| 178 | `v2/V3LessonPlayer.dc.html` | v3 · Legend lesson player (narration) | Desktop | v3rct · Learn · catalogue → detail → lesson → complete · openings | **P8** | Legend lesson player · narrating | narrating, guess |
| 179 | `v2/V3LessonGuess.dc.html` | v3 · Legend lesson · Pause and guess | Desktop | v3rct · Learn · catalogue → detail → lesson → complete · openings | **P8** | Legend lesson · pause and guess | narrating, guess |
| 180 | `v2/V3LessonComplete.dc.html` | v3 · Legend lesson complete | Desktop | v3rct · Learn · catalogue → detail → lesson → complete · openings | **P8** | Legend lesson complete (stars) | — (no enum prop) |
| 181 | `v2/V3OpeningsCatalogue.dc.html` | v3 · Openings catalogue | Desktop | v3rct · Learn · catalogue → detail → lesson → complete · openings | **P8** | Openings catalogue (public, ISR, search) | default, family |
| 182 | `v2/V3OpeningDetail.dc.html` | v3 · Opening detail · Italian (stepper) | Desktop | v3rct · Learn · catalogue → detail → lesson → complete · openings | **P8** | Opening detail · stepper (public) | — (no enum prop) |
| 183 | `v2/V3LearnOpenings.dc.html` | v3 · Learn openings · Drill the line | Desktop | v3rct · Learn · catalogue → detail → lesson → complete · openings | **P8** | Openings guide + drill the line (OPENING deck card) | — (no enum prop) |
| 184 | `v2/V3LearnLegends.dc.html` | v3 · Learn legends · Guide | Desktop | v3rct · Learn · catalogue → detail → lesson → complete · openings | **P8** | Guide · learning from legends (path order) | — (no enum prop) |
| 185 | `v2/V3LegendGameOpera.dc.html` | v3 · Legend · Play as Morphy · Opera Game, move 10 (bot game from the legend detail) | Desktop | v3rct · Learn · catalogue → detail → lesson → complete · openings | **P8** | Legend-detail game · Opera Game move 10 | — (no enum prop) |
| 186 | `v2/V3LegendGameAnderssen.dc.html` | v3 · Legend · Play as Morphy · vs Anderssen, move 14 (bot game from the legend detail) | Desktop | v3rct · Learn · catalogue → detail → lesson → complete · openings | **P8** | Legend-detail game · vs Anderssen move 14 | — (no enum prop) |
| 187 | `v2/V3LegendGamePaulsen.dc.html` | v3 · Legend · Play as Morphy · vs Paulsen, move 17 (bot game from the legend detail) | Desktop | v3rct · Learn · catalogue → detail → lesson → complete · openings | **P8** | Legend-detail game · vs Paulsen move 17 | — (no enum prop) |
| 188 | `v2/V3iPhoneReview.dc.html` | v3 · iPhone · Review (analysing → summary → moments) | iPhone | v3rct · iPhone · 393 × 852 | **P3** | Review · device layouts (analysing → summary → moments) | analysing, failed, clean, summary, moment |
| 189 | `v2/V3iPhoneCoach.dc.html` | v3 · iPhone · Ask the coach (60% sheet / panel) | iPhone | v3rct · iPhone · 393 × 852 | **P7** | Coach · docked sheet / side panel | suggested, explain, typing, streaming, error, ratelimit, paywall |
| 190 | `v2/V3iPhonePuzzle.dc.html` | v3 · iPhone · Puzzle session | iPhone | v3rct · iPhone · 393 × 852 | **P5** | Puzzle session · device layouts (also bank drill and theme sheet) | solve, hint, wrong, correct, solution, themes |
| 191 | `v2/V3iPhoneBank.dc.html` | v3 · iPhone · Mistake Bank states | iPhone | v3rct · iPhone · 393 × 852 | **P5** | Mistake Bank · device states (due, empty, caught up, loading) | due, empty, caughtup, loading |
| 192 | `v2/V3iPhoneTrainHub.dc.html` | v3 · iPhone · Train hub | iPhone | v3rct · iPhone · 393 × 852 | **P5** | Train hub · daily plan | default, nothingdue, loading |
| 193 | `v2/V3iPhoneLesson.dc.html` | v3 · iPhone · Legend lesson player | iPhone | v3rct · iPhone · 393 × 852 | **P8** | Legend lesson player · narrating | narrating, guess |
| 194 | `v2/V3iPadLReview.dc.html` | v3 · iPad landscape · Review (analysing → summary → moments) | iPad L | v3rct · iPad landscape · 1194 × 834 | **P3** | Review · device layouts (analysing → summary → moments) | analysing, failed, clean, summary, moment |
| 195 | `v2/V3iPadLCoach.dc.html` | v3 · iPad landscape · Ask the coach (60% sheet / panel) | iPad L | v3rct · iPad landscape · 1194 × 834 | **P7** | Coach · docked sheet / side panel | suggested, explain, typing, streaming, error, ratelimit, paywall |
| 196 | `v2/V3iPadLPuzzle.dc.html` | v3 · iPad landscape · Puzzle session | iPad L | v3rct · iPad landscape · 1194 × 834 | **P5** | Puzzle session · device layouts (also bank drill and theme sheet) | solve, hint, wrong, correct, solution, themes |
| 197 | `v2/V3iPadLBank.dc.html` | v3 · iPad landscape · Mistake Bank states | iPad L | v3rct · iPad landscape · 1194 × 834 | **P5** | Mistake Bank · device states (due, empty, caught up, loading) | due, empty, caughtup, loading |
| 198 | `v2/V3iPadLTrainHub.dc.html` | v3 · iPad landscape · Train hub | iPad L | v3rct · iPad landscape · 1194 × 834 | **P5** | Train hub · daily plan | default, nothingdue, loading |
| 199 | `v2/V3iPadLLesson.dc.html` | v3 · iPad landscape · Legend lesson player | iPad L | v3rct · iPad landscape · 1194 × 834 | **P8** | Legend lesson player · narrating | narrating, guess |
| 200 | `v2/V3iPadPReview.dc.html` | v3 · iPad portrait · Review (analysing → summary → moments) | iPad P | v3rct · iPad portrait · 834 × 1194 | **P3** | Review · device layouts (analysing → summary → moments) | analysing, failed, clean, summary, moment |
| 201 | `v2/V3iPadPCoach.dc.html` | v3 · iPad portrait · Ask the coach (60% sheet / panel) | iPad P | v3rct · iPad portrait · 834 × 1194 | **P7** | Coach · docked sheet / side panel | suggested, explain, typing, streaming, error, ratelimit, paywall |
| 202 | `v2/V3iPadPPuzzle.dc.html` | v3 · iPad portrait · Puzzle session | iPad P | v3rct · iPad portrait · 834 × 1194 | **P5** | Puzzle session · device layouts (also bank drill and theme sheet) | solve, hint, wrong, correct, solution, themes |
| 203 | `v2/V3iPadPBank.dc.html` | v3 · iPad portrait · Mistake Bank states | iPad P | v3rct · iPad portrait · 834 × 1194 | **P5** | Mistake Bank · device states (due, empty, caught up, loading) | due, empty, caughtup, loading |
| 204 | `v2/V3iPadPTrainHub.dc.html` | v3 · iPad portrait · Train hub | iPad P | v3rct · iPad portrait · 834 × 1194 | **P5** | Train hub · daily plan | default, nothingdue, loading |
| 205 | `v2/V3iPadPLesson.dc.html` | v3 · iPad portrait · Legend lesson player | iPad P | v3rct · iPad portrait · 834 × 1194 | **P8** | Legend lesson player · narrating | narrating, guess |
| 206 | `v2/V3AndroidReview.dc.html` | v3 · Android · Review (analysing → summary → moments) | Android | v3rct · Android · 412 × 915 | **P3** | Review · device layouts (analysing → summary → moments) | analysing, failed, clean, summary, moment |
| 207 | `v2/V3AndroidCoach.dc.html` | v3 · Android · Ask the coach (60% sheet / panel) | Android | v3rct · Android · 412 × 915 | **P7** | Coach · docked sheet / side panel | suggested, explain, typing, streaming, error, ratelimit, paywall |
| 208 | `v2/V3AndroidPuzzle.dc.html` | v3 · Android · Puzzle session | Android | v3rct · Android · 412 × 915 | **P5** | Puzzle session · device layouts (also bank drill and theme sheet) | solve, hint, wrong, correct, solution, themes |
| 209 | `v2/V3AndroidBank.dc.html` | v3 · Android · Mistake Bank states | Android | v3rct · Android · 412 × 915 | **P5** | Mistake Bank · device states (due, empty, caught up, loading) | due, empty, caughtup, loading |
| 210 | `v2/V3AndroidTrainHub.dc.html` | v3 · Android · Train hub | Android | v3rct · Android · 412 × 915 | **P5** | Train hub · daily plan | default, nothingdue, loading |
| 211 | `v2/V3AndroidLesson.dc.html` | v3 · Android · Legend lesson player | Android | v3rct · Android · 412 × 915 | **P8** | Legend lesson player · narrating | narrating, guess |
| 212 | `v2/V3MoveBoard.dc.html` | v3 · Interactive board (click-move, 180 ms slides, badges) | Component | v3rct · Shared components | **P2** | Interactive board component (`components/board/Board`) | orient: w, b; mover: , w, b |
| 213 | `v2/V3MistakeBank.dc.html` | v3 · Mistake Bank · Populated (list scrolls in its panel, filters in a popover) | Desktop | v3rct · Mistake Bank and Weakness Profile · populated | **P5** | Mistake Bank · populated list + filters | default, filtered, loading |
| 214 | `v2/V3WeaknessProfile.dc.html` | v3 · Weakness profile · Populated (top 3, breakdown tabs) | Desktop | v3rct · Mistake Bank and Weakness Profile · populated | **P6** | Weakness profile · populated (top 3, breakdown tabs) | default, loading |
| 215 | `v2/V3iPhoneMistakeBank.dc.html` | v3 · iPhone · Mistake Bank · Populated | iPhone | v3rct · Populated Mistake Bank and Weakness Profile · iPhone, And… | **P5** | Mistake Bank · populated list + filters | default, filtered, loading |
| 216 | `v2/V3iPhoneWeaknessProfile.dc.html` | v3 · iPhone · Weakness profile · Populated | iPhone | v3rct · Populated Mistake Bank and Weakness Profile · iPhone, And… | **P6** | Weakness profile · populated (top 3, breakdown tabs) | default, loading |
| 217 | `v2/V3AndroidMistakeBank.dc.html` | v3 · Android · Mistake Bank · Populated | Android | v3rct · Populated Mistake Bank and Weakness Profile · iPhone, And… | **P5** | Mistake Bank · populated list + filters | default, filtered, loading |
| 218 | `v2/V3AndroidWeaknessProfile.dc.html` | v3 · Android · Weakness profile · Populated | Android | v3rct · Populated Mistake Bank and Weakness Profile · iPhone, And… | **P6** | Weakness profile · populated (top 3, breakdown tabs) | default, loading |
| 219 | `v2/V3iPadLMistakeBank.dc.html` | v3 · iPad landscape · Mistake Bank · Populated | iPad L | v3rct · Populated Mistake Bank and Weakness Profile · iPhone, And… | **P5** | Mistake Bank · populated list + filters | default, filtered, loading |
| 220 | `v2/V3iPadLWeaknessProfile.dc.html` | v3 · iPad landscape · Weakness profile · Populated | iPad L | v3rct · Populated Mistake Bank and Weakness Profile · iPhone, And… | **P6** | Weakness profile · populated (top 3, breakdown tabs) | default, loading |
| 221 | `v2/V3iPadPMistakeBank.dc.html` | v3 · iPad portrait · Mistake Bank · Populated | iPad P | v3rct · Populated Mistake Bank and Weakness Profile · iPhone, And… | **P5** | Mistake Bank · populated list + filters | default, filtered, loading |
| 222 | `v2/V3iPadPWeaknessProfile.dc.html` | v3 · iPad portrait · Weakness profile · Populated | iPad P | v3rct · Populated Mistake Bank and Weakness Profile · iPhone, And… | **P6** | Weakness profile · populated (top 3, breakdown tabs) | default, loading |
| 223 | `v2/V4Profile.dc.html` | v3 · Profile · Own · Overview | Desktop | v3acct · Profile · own (tabs in place), other player, logged out, … | **P10** | Own profile · overview + milestones | default, loading, new_user, not_linked; tab: overview, games, stats, milestones |
| 224 | `v2/V4ProfileGames.dc.html` | v3 · Profile · Games tab (filter, select) | Desktop | v3acct · Profile · own (tabs in place), other player, logged out, … | **P10** | Own profile · games tab (filter, select, bulk review) | default, loading, new_user, not_linked; tab: overview, games, stats, milestones |
| 225 | `v2/V4ProfileStats.dc.html` | v3 · Profile · Stats tab | Desktop | v3acct · Profile · own (tabs in place), other player, logged out, … | **P10** | Own profile · stats tab | default, loading, new_user, not_linked; tab: overview, games, stats, milestones |
| 226 | `v2/V4ProfileEdit.dc.html` | v3 · Profile · Edit (validation, upload, save) | Desktop | v3acct · Profile · own (tabs in place), other player, logged out, … | **P10** | Profile edit (validation, avatar upload) | default, dirty, invalid, uploading, upload_error, saving, saved, error |
| 227 | `v2/V4ProfileOther.dc.html` | v3 · Profile · Other player · Public | Desktop | v3acct · Profile · own (tabs in place), other player, logged out, … | **P10** | Other player · public / online / not found | public, online, private, not_found, loading; tab: overview, games, stats, milestones |
| 228 | `v2/V4ProfileOtherGuest.dc.html` | v3 · Profile · Other player · Logged out | Desktop | v3acct · Profile · own (tabs in place), other player, logged out, … | **P10** | Other player · logged out (noindex) | public, private; tab: overview, games, stats, milestones |
| 229 | `v2/V4ProfilePrivate.dc.html` | v3 · Profile · Other player · Private | Desktop | v3acct · Profile · own (tabs in place), other player, logged out, … | **P10** | Other player · private | public, online, private, not_found, loading; tab: overview, games, stats, milestones |
| 230 | `v2/V4Settings.dc.html` | v3 · Settings · Shell (all settings) | Desktop | v3acct · Settings · one shell: section list on the left, detail on… | **P10** | Settings shell (section list + detail; phones drill in) | — (no enum prop) |
| 231 | `v2/V4SettingsBoard.dc.html` | v3 · Settings · Board (live preview) | Desktop | v3acct · Settings · one shell: section list on the left, detail on… | **P10** | Settings › Board (live preview) | — (no enum prop) |
| 232 | `v2/V4SettingsPieces.dc.html` | v3 · Settings · Pieces (preview) | Desktop | v3acct · Settings · one shell: section list on the left, detail on… | **P10** | Settings › Pieces | — (no enum prop) |
| 233 | `v2/V4SettingsSounds.dc.html` | v3 · Settings · Sounds and voice (test) | Desktop | v3acct · Settings · one shell: section list on the left, detail on… | **P10** | Settings › Sounds and voice | default, autoplay_blocked, muted |
| 234 | `v2/V4SettingsAppearance.dc.html` | v3 · Settings · Appearance (light / dark / system) | Desktop | v3acct · Settings · one shell: section list on the left, detail on… | **P10** | Settings › Appearance | — (no enum prop) |
| 235 | `v2/V4SettingsNotifications.dc.html` | v3 · Settings · Notifications | Desktop | v3acct · Settings · one shell: section list on the left, detail on… | **P10** | Settings › Notifications (push, email, reminders) | push_off, enabled, denied, ios_install |
| 236 | `v2/V4SettingsAccount.dc.html` | v3 · Settings · Account | Desktop | v3acct · Account and connected accounts · delete is a typed confir… | **P10** | Settings › Account (email, export) | default, verifying_email, exporting, error |
| 237 | `v2/V4DeleteAccount.dc.html` | v3 · Modal · Delete account (type to confirm) | Desktop | v3acct · Account and connected accounts · delete is a typed confir… | **P10** | Delete account (typed confirmation) | default, active_sub, typed, deleting, error, deleted |
| 238 | `v2/V4SettingsConnected.dc.html` | v3 · Settings · Connected accounts (Chess.com linked, Lichess off) | Desktop | v3acct · Account and connected accounts · delete is a typed confir… | **P4** | Settings › Connected accounts (`/settings/connected`) | default, syncing, sync_failed, rate_limited, not_found, private_games, li_connecting, li_denied, both_linked, none_linked |
| 239 | `v2/V4SettingsConnectedError.dc.html` | v3 · Settings · Connected accounts · Sync failed | Desktop | v3acct · Account and connected accounts · delete is a typed confir… | **P4** | Settings › Connected accounts · sync failed | default, syncing, sync_failed, rate_limited, not_found, private_games, li_connecting, li_denied, both_linked, none_linked |
| 240 | `v2/V4Membership.dc.html` | v3 · Membership · Active (monthly) | Desktop | v3acct · Membership · states, plan switch with proration, cancel w… | **P10** | Membership · active (12-state page) | active, active_yearly, trial, cancelling, switching, past_due, legacy, expired, free, loading, error, trial_cancelled |
| 241 | `v2/V4MembershipTrial.dc.html` | v3 · Membership · Trial | Desktop | v3acct · Membership · states, plan switch with proration, cancel w… | **P10** | Membership · trial | active, active_yearly, trial, cancelling, switching, past_due, legacy, expired, free, loading, error, trial_cancelled |
| 242 | `v2/V4MembershipCancelling.dc.html` | v3 · Membership · Cancelling (access until) | Desktop | v3acct · Membership · states, plan switch with proration, cancel w… | **P10** | Membership · cancelling | active, active_yearly, trial, cancelling, switching, past_due, legacy, expired, free, loading, error, trial_cancelled |
| 243 | `v2/V4MembershipPastDue.dc.html` | v3 · Membership · Past due (payment issue) | Desktop | v3acct · Membership · states, plan switch with proration, cancel w… | **P10** | Membership · past due | active, active_yearly, trial, cancelling, switching, past_due, legacy, expired, free, loading, error, trial_cancelled |
| 244 | `v2/V4MembershipFree.dc.html` | v3 · Membership · None | Desktop | v3acct · Membership · states, plan switch with proration, cancel w… | **P10** | Membership · none | active, active_yearly, trial, cancelling, switching, past_due, legacy, expired, free, loading, error, trial_cancelled |
| 245 | `v2/V4PlanSwitch.dc.html` | v3 · Modal · Switch plan (proration) | Desktop | v3acct · Membership · states, plan switch with proration, cancel w… | **P10** | Switch plan modal (proration preview) | preview, loading_preview, preview_unavailable, downgrade, same_plan, confirming, error, done, trial |
| 246 | `v2/V4CancelSub.dc.html` | v3 · Modal · Cancel membership (offer, reason, confirm) | Desktop | v3acct · Membership · states, plan switch with proration, cancel w… | **P10** | Cancel membership modal (offer, reason, pause) | offer, reason, submitting, error, done, paused, trial_offer, trial_done |
| 247 | `v2/V4Tournaments.dc.html` | v3 · Tournaments · List (live / upcoming / finished) | Desktop | v3acct · Tournaments · list → join (invite) → lobby → live arena →… | **P12** | Tournaments list (live / upcoming / finished) | default, loading, empty, error, free |
| 248 | `v2/V4TournamentsEmpty.dc.html` | v3 · Tournaments · Empty | Desktop | v3acct · Tournaments · list → join (invite) → lobby → live arena →… | **P12** | Tournaments · empty | default, loading, empty, error, free |
| 249 | `v2/V4TournamentJoin.dc.html` | v3 · Tournament · Join from invite | Desktop | v3acct · Tournaments · list → join (invite) → lobby → live arena →… | **P12** | Tournament · join from invite | default, starting_soon, joining, joined, closed, full, paywalled, not_found, error, loading |
| 250 | `v2/V4TournamentLobby.dc.html` | v3 · Tournament · Lobby (countdown runs on its own) | Desktop | v3acct · Tournaments · list → join (invite) → lobby → live arena →… | **P12** | Tournament · lobby (scheduler countdown) | joined, not_joined, host, started |
| 251 | `v2/V4TournamentLive.dc.html` | v3 · Tournament · Live arena (standings, next pairing) | Desktop | v3acct · Tournaments · list → join (invite) → lobby → live arena →… | **P12** | Tournament · live arena (standings, pairing) | idle, searching, matched, in_game, ending_soon, not_participant |
| 252 | `v2/V4TournamentGame.dc.html` | v3 · Tournament · Game (V3Game tournament state) | Desktop | v3acct · Tournaments · list → join (invite) → lobby → live arena →… | **P12** | Tournament · game strip (V3Game tournament state) | loading, waiting, study, study_last5, study_reconnect, abort, rematch_study, rematch_first, rematch_your, your_move, their_move, premove, premove_cancelled, check, ill… |
| 253 | `v2/V4TournamentGameOver.dc.html` | v3 · Tournament · Game over (Find match / Back to arena) | Desktop | v3acct · Tournaments · list → join (invite) → lobby → live arena →… | **P12** | Tournament · game over (find match / back to arena) | loading, waiting, study, study_last5, study_reconnect, abort, rematch_study, rematch_first, rematch_your, your_move, their_move, premove, premove_cancelled, check, ill… |
| 254 | `v2/V4TournamentResults.dc.html` | v3 · Tournament · Results (podium, your placement) | Desktop | v3acct · Tournaments · list → join (invite) → lobby → live arena →… | **P12** | Tournament · results (podium, placement) | default, no_games |
| 255 | `v2/V4Admin.dc.html` | v3 · Admin · Dashboard | Desktop | v3acct · Admin · desktop only, compact | **P12** | Admin · dashboard (metrics, activity, health) | default, forbidden |
| 256 | `v2/V4AdminPositions.dc.html` | v3 · Admin · Chess positions (FEN check) | Desktop | v3acct · Admin · desktop only, compact | **P12** | Admin · chess positions (FEN check, verify) | default, loading, fen_invalid, saving, error |
| 257 | `v2/V4AdminLegends.dc.html` | v3 · Admin · Legends | Desktop | v3acct · Admin · desktop only, compact | **P12** | Admin · legends | default, loading, saving, error |
| 258 | `v2/V4AdminTournaments.dc.html` | v3 · Admin · Tournaments | Desktop | v3acct · Admin · desktop only, compact | **P12** | Admin · tournaments list | default, empty |
| 259 | `v2/V4AdminTournamentCreate.dc.html` | v3 · Admin · Create tournament (validation) | Desktop | v3acct · Admin · desktop only, compact | **P12** | Admin · create tournament (validation) | default, validation, creating, error, created |
| 260 | `v2/V4iPhoneProfile.dc.html` | v3 · iPhone · Profile (own) | iPhone | v3acct · iPhone · 393 × 852 · profile, settings, membership, tourn… | **P10** | Own profile · overview + milestones | default, loading, new_user, not_linked; tab: overview, games, stats, milestones |
| 261 | `v2/V4iPhoneSettings.dc.html` | v3 · iPhone · Settings shell (list, tap to drill in) | iPhone | v3acct · iPhone · 393 × 852 · profile, settings, membership, tourn… | **P10** | Settings shell (section list + detail; phones drill in) | — (no enum prop) |
| 262 | `v2/V4iPhoneSettingsBoard.dc.html` | v3 · iPhone · Settings · Board | iPhone | v3acct · iPhone · 393 × 852 · profile, settings, membership, tourn… | **P10** | Settings › Board (live preview) | — (no enum prop) |
| 263 | `v2/V4iPhoneMembership.dc.html` | v3 · iPhone · Membership (state tweak) | iPhone | v3acct · iPhone · 393 × 852 · profile, settings, membership, tourn… | **P10** | Membership · active (12-state page) | active, active_yearly, trial, cancelling, switching, past_due, legacy, expired, free, loading, error, trial_cancelled |
| 264 | `v2/V4iPhoneTournaments.dc.html` | v3 · iPhone · Tournaments list | iPhone | v3acct · iPhone · 393 × 852 · profile, settings, membership, tourn… | **P12** | Tournaments list (live / upcoming / finished) | default, loading, empty, error, free |
| 265 | `v2/V4iPhoneTournamentLive.dc.html` | v3 · iPhone · Tournament live | iPhone | v3acct · iPhone · 393 × 852 · profile, settings, membership, tourn… | **P12** | Tournament · live arena (standings, pairing) | idle, searching, matched, in_game, ending_soon, not_participant |
| 266 | `v2/V4AndroidProfile.dc.html` | v3 · Android · Profile (own) | Android | v3acct · Android · 412 × 915 · profile, settings, membership, tour… | **P10** | Own profile · overview + milestones | default, loading, new_user, not_linked; tab: overview, games, stats, milestones |
| 267 | `v2/V4AndroidSettings.dc.html` | v3 · Android · Settings shell (list, tap to drill in) | Android | v3acct · Android · 412 × 915 · profile, settings, membership, tour… | **P10** | Settings shell (section list + detail; phones drill in) | — (no enum prop) |
| 268 | `v2/V4AndroidSettingsBoard.dc.html` | v3 · Android · Settings · Board | Android | v3acct · Android · 412 × 915 · profile, settings, membership, tour… | **P10** | Settings › Board (live preview) | — (no enum prop) |
| 269 | `v2/V4AndroidMembership.dc.html` | v3 · Android · Membership (state tweak) | Android | v3acct · Android · 412 × 915 · profile, settings, membership, tour… | **P10** | Membership · active (12-state page) | active, active_yearly, trial, cancelling, switching, past_due, legacy, expired, free, loading, error, trial_cancelled |
| 270 | `v2/V4AndroidTournaments.dc.html` | v3 · Android · Tournaments list | Android | v3acct · Android · 412 × 915 · profile, settings, membership, tour… | **P12** | Tournaments list (live / upcoming / finished) | default, loading, empty, error, free |
| 271 | `v2/V4AndroidTournamentLive.dc.html` | v3 · Android · Tournament live | Android | v3acct · Android · 412 × 915 · profile, settings, membership, tour… | **P12** | Tournament · live arena (standings, pairing) | idle, searching, matched, in_game, ending_soon, not_participant |
| 272 | `v2/V4iPadLProfile.dc.html` | v3 · iPad landscape · Profile (own) | iPad L | v3acct · iPad landscape · 1194 × 834 · profile, settings, membersh… | **P10** | Own profile · overview + milestones | default, loading, new_user, not_linked; tab: overview, games, stats, milestones |
| 273 | `v2/V4iPadLSettings.dc.html` | v3 · iPad landscape · Settings shell (list + detail) | iPad L | v3acct · iPad landscape · 1194 × 834 · profile, settings, membersh… | **P10** | Settings shell (section list + detail; phones drill in) | — (no enum prop) |
| 274 | `v2/V4iPadLSettingsBoard.dc.html` | v3 · iPad landscape · Settings · Board | iPad L | v3acct · iPad landscape · 1194 × 834 · profile, settings, membersh… | **P10** | Settings › Board (live preview) | — (no enum prop) |
| 275 | `v2/V4iPadLMembership.dc.html` | v3 · iPad landscape · Membership (state tweak) | iPad L | v3acct · iPad landscape · 1194 × 834 · profile, settings, membersh… | **P10** | Membership · active (12-state page) | active, active_yearly, trial, cancelling, switching, past_due, legacy, expired, free, loading, error, trial_cancelled |
| 276 | `v2/V4iPadLTournaments.dc.html` | v3 · iPad landscape · Tournaments list | iPad L | v3acct · iPad landscape · 1194 × 834 · profile, settings, membersh… | **P12** | Tournaments list (live / upcoming / finished) | default, loading, empty, error, free |
| 277 | `v2/V4iPadLTournamentLive.dc.html` | v3 · iPad landscape · Tournament live | iPad L | v3acct · iPad landscape · 1194 × 834 · profile, settings, membersh… | **P12** | Tournament · live arena (standings, pairing) | idle, searching, matched, in_game, ending_soon, not_participant |
| 278 | `v2/V4iPadPProfile.dc.html` | v3 · iPad portrait · Profile (own) | iPad P | v3acct · iPad portrait · 834 × 1194 · profile, settings, membershi… | **P10** | Own profile · overview + milestones | default, loading, new_user, not_linked; tab: overview, games, stats, milestones |
| 279 | `v2/V4iPadPSettings.dc.html` | v3 · iPad portrait · Settings shell (list + detail) | iPad P | v3acct · iPad portrait · 834 × 1194 · profile, settings, membershi… | **P10** | Settings shell (section list + detail; phones drill in) | — (no enum prop) |
| 280 | `v2/V4iPadPSettingsBoard.dc.html` | v3 · iPad portrait · Settings · Board | iPad P | v3acct · iPad portrait · 834 × 1194 · profile, settings, membershi… | **P10** | Settings › Board (live preview) | — (no enum prop) |
| 281 | `v2/V4iPadPMembership.dc.html` | v3 · iPad portrait · Membership (state tweak) | iPad P | v3acct · iPad portrait · 834 × 1194 · profile, settings, membershi… | **P10** | Membership · active (12-state page) | active, active_yearly, trial, cancelling, switching, past_due, legacy, expired, free, loading, error, trial_cancelled |
| 282 | `v2/V4iPadPTournaments.dc.html` | v3 · iPad portrait · Tournaments list | iPad P | v3acct · iPad portrait · 834 × 1194 · profile, settings, membershi… | **P12** | Tournaments list (live / upcoming / finished) | default, loading, empty, error, free |
| 283 | `v2/V4iPadPTournamentLive.dc.html` | v3 · iPad portrait · Tournament live | iPad P | v3acct · iPad portrait · 834 × 1194 · profile, settings, membershi… | **P12** | Tournament · live arena (standings, pairing) | idle, searching, matched, in_game, ending_soon, not_participant |
| 284 | `v2/V3FlowMap.dc.html` | v3 · Flow map · every journey, click a card to open its board | Desktop | v3sys · (no section heading) | **P1** | Route map and navigation graph (reference for every phase; no route) | — (no enum prop) |
| 285 | `v2/V3Error404.dc.html` | v3 · Error 404 · Page not found (signed out / in / missing game) | Desktop | v3sys · Errors, offline and maintenance · desktop 1440 × 900 | **P11** | Error 404 (signed out / in / missing game) | signed_out, signed_in, missing_game |
| 286 | `v2/V3Error500.dc.html` | v3 · Error 500 · Something went wrong (retry, report) | Desktop | v3sys · Errors, offline and maintenance · desktop 1440 × 900 | **P11** | Error 500 (retry, report, event id) | default, retrying, failed_again, report_form, reported |
| 287 | `v2/V3ErrorGlobal.dc.html` | v3 · Global error · no shell, system fonts (light / dark) | Desktop | v3sys · Errors, offline and maintenance · desktop 1440 × 900 | **P11** | Global error (no shell, system fonts) | light, dark, reloading |
| 288 | `v2/V3Offline.dc.html` | v3 · Offline page · cached things you can still do | Desktop | v3sys · Errors, offline and maintenance · desktop 1440 × 900 | **P11** | Offline page + cached actions (SW rewrite) | offline, checking, back_online |
| 289 | `v2/V3Maintenance.dc.html` | v3 · Maintenance · page and in-game banner | Desktop | v3sys · Errors, offline and maintenance · desktop 1440 × 900 | **P11** | Maintenance page + in-game banner (Edge Config) | page, in_game |
| 290 | `v2/V3RateLimited.dc.html` | v3 · Rate limited · inline countdown and 429 page | Desktop | v3sys · Errors, offline and maintenance · desktop 1440 × 900 | **P1** | 429 contract UI: inline countdown + `/too-many-requests` (track 1B) | inline, inline_ready, page |
| 291 | `v2/V3SessionExpired.dc.html` | v3 · Session expired · modal and in-game silent refresh | Desktop | v3sys · Overlays and banners · over a live V3Home or V3Game | **P1** | 401 contract UI: session-expired modal (track 1B; in-game silent refresh in P2) | modal, signing_in, in_game_refresh, in_game_ok |
| 292 | `v2/V3PaymentFailed.dc.html` | v3 · Payment failed banner · grace, last day, expired | Desktop | v3sys · Overlays and banners · over a live V3Home or V3Game | **P1** | Payment-failed banner (shell slot; grace, last day, expired) | banner, last_day, dismissed, expired |
| 293 | `v2/V3CookieConsent.dc.html` | v3 · Cookie consent · bar and preferences (equal-weight choices) | Desktop | v3sys · Overlays and banners · over a live V3Home or V3Game | **P11** | Cookie consent (consent-gated analytics) | bar, preferences, saved, gone |
| 294 | `v2/V3PwaInstall.dc.html` | v3 · Install app · desktop prompt | Desktop | v3sys · Overlays and banners · over a live V3Home or V3Game | **P11** | Install app (desktop popover, Android sheet, iOS steps) | prompt, installing, installed, snoozed, gone |
| 295 | `v2/V3PwaUpdate.dc.html` | v3 · New version available · deferred in game | Desktop | v3sys · Overlays and banners · over a live V3Home or V3Game | **P11** | New version available (deferred in game) | ready, refreshing, later, in_game |
| 296 | `v2/V3NotifPrompt.dc.html` | v3 · Notifications · pre-permission, denied, iOS install first | Desktop | v3sys · Overlays and banners · over a live V3Home or V3Game | **P10** | Notification pre-permission prompt (push infra) | ask, waiting, granted, denied, ios_install_first |
| 297 | `v2/V3Toasts.dc.html` | v3 · Toast system · types, stacking, live demo | Desktop | v3sys · Specimens and patterns · toasts, command palette, shortcu… | **P1** | Toast system (SPEC §7, inv-sys §3.13) | — (no enum prop) |
| 298 | `v2/V3CommandPalette.dc.html` | v3 · Command palette (⌘K) · search and Ask | Desktop | v3sys · Specimens and patterns · toasts, command palette, shortcu… | **P1** | Command palette ⌘K, search mode (Ask mode lights up in P7) | open, ask, closed |
| 299 | `v2/V3Shortcuts.dc.html` | v3 · Keyboard shortcuts (?) | Desktop | v3sys · Specimens and patterns · toasts, command palette, shortcu… | **P1** | Keyboard shortcuts sheet `?` and G-chords | open, closed |
| 300 | `v2/V3Skeletons.dc.html` | v3 · Loading · hairline and route skeletons | Desktop | v3sys · Specimens and patterns · toasts, command palette, shortcu… | **P1** | Route hairline and skeleton family | game, review, profile, list |
| 301 | `v2/V3EmptyStates.dc.html` | v3 · Empty state pattern | Desktop | v3sys · Specimens and patterns · toasts, command palette, shortcu… | **P1** | EmptyState pattern | — (no enum prop) |
| 302 | `v2/V3iPhoneError404.dc.html` | v3 · iPhone · Error 404 | iPhone | v3sys · Phones · iPhone 393 × 852 and Android 412 × 915 | **P11** | Error 404 (signed out / in / missing game) | — (no enum prop) |
| 303 | `v2/V3iPhoneError500.dc.html` | v3 · iPhone · Error 500 | iPhone | v3sys · Phones · iPhone 393 × 852 and Android 412 × 915 | **P11** | Error 500 (retry, report, event id) | default, retrying, failed_again, report_form, reported |
| 304 | `v2/V3iPhoneOffline.dc.html` | v3 · iPhone · Offline page | iPhone | v3sys · Phones · iPhone 393 × 852 and Android 412 × 915 | **P11** | Offline page + cached actions (SW rewrite) | offline, checking, back_online |
| 305 | `v2/V3iPhoneToasts.dc.html` | v3 · iPhone · Toasts above the action bar | iPhone | v3sys · Phones · iPhone 393 × 852 and Android 412 × 915 | **P1** | Toast system (SPEC §7, inv-sys §3.13) | — (no enum prop) |
| 306 | `v2/V3iPhoneCookie.dc.html` | v3 · iPhone · Cookie consent | iPhone | v3sys · Phones · iPhone 393 × 852 and Android 412 × 915 | **P11** | Cookie consent (consent-gated analytics) | bar, preferences, saved, gone |
| 307 | `v2/V3iPhonePwaInstall.dc.html` | v3 · iPhone · Add to Home Screen (iOS steps) | iPhone | v3sys · Phones · iPhone 393 × 852 and Android 412 × 915 | **P11** | Install app (desktop popover, Android sheet, iOS steps) | steps, dismissed, gone |
| 308 | `v2/V3AndroidPwaInstall.dc.html` | v3 · Android · Install app | Android | v3sys · Phones · iPhone 393 × 852 and Android 412 × 915 | **P11** | Install app (desktop popover, Android sheet, iOS steps) | prompt, installing, installed, snoozed, gone |
| 309 | `v2/V3iPadPError404.dc.html` | v3 · iPad portrait · Error 404 | iPad P | v3sys · iPad portrait · 834 × 1194 | **P11** | Error 404 (signed out / in / missing game) | — (no enum prop) |
| 310 | `v2/V3iPadPError500.dc.html` | v3 · iPad portrait · Error 500 | iPad P | v3sys · iPad portrait · 834 × 1194 | **P11** | Error 500 (retry, report, event id) | default, retrying, failed_again, report_form, reported |
| 311 | `v2/V3iPadPOffline.dc.html` | v3 · iPad portrait · Offline page | iPad P | v3sys · iPad portrait · 834 × 1194 | **P11** | Offline page + cached actions (SW rewrite) | offline, checking, back_online |
| 312 | `v2/V3iPadPToasts.dc.html` | v3 · iPad portrait · Toasts | iPad P | v3sys · iPad portrait · 834 × 1194 | **P1** | Toast system (SPEC §7, inv-sys §3.13) | — (no enum prop) |
| 313 | `v2/V3iPadPCookie.dc.html` | v3 · iPad portrait · Cookie consent | iPad P | v3sys · iPad portrait · 834 × 1194 | **P11** | Cookie consent (consent-gated analytics) | bar, preferences, saved, gone |
| 314 | `v2/V3iPadPPwaInstall.dc.html` | v3 · iPad portrait · Add to Home Screen (share is top right) | iPad P | v3sys · iPad portrait · 834 × 1194 | **P11** | Install app (desktop popover, Android sheet, iOS steps) | steps, dismissed, gone |
| 315 | `Main.dc.html` | My Games | Desktop | v1 · AI Coaching: Import, Review, Bank, Train, Learn from Legends | **superseded** | v1 exploration (ideas only) | — (no enum prop) |
| 316 | `GameReview.dc.html` | Game Review | Desktop | v1 · AI Coaching: Import, Review, Bank, Train, Learn from Legends | **superseded** | v1 exploration (ideas only) | — (no enum prop) |
| 317 | `MistakeBank.dc.html` | Mistake Bank | Desktop | v1 · AI Coaching: Import, Review, Bank, Train, Learn from Legends | **superseded** | v1 exploration (ideas only) | — (no enum prop) |
| 318 | `PuzzleTrainer.dc.html` | Puzzle Trainer | Desktop | v1 · AI Coaching: Import, Review, Bank, Train, Learn from Legends | **superseded** | v1 exploration (ideas only) | — (no enum prop) |
| 319 | `WeaknessProfile.dc.html` | Weakness Profile | Desktop | v1 · AI Coaching: Import, Review, Bank, Train, Learn from Legends | **superseded** | v1 exploration (ideas only) | — (no enum prop) |
| 320 | `LegendLessons.dc.html` | Legend Lessons | Desktop | v1 · AI Coaching: Import, Review, Bank, Train, Learn from Legends | **superseded** | v1 exploration (ideas only) | — (no enum prop) |
| 321 | `AskCoach.dc.html` | Ask the Coach | Desktop | v1 · AI Coaching: Import, Review, Bank, Train, Learn from Legends | **superseded** | v1 exploration (ideas only) | — (no enum prop) |
| 322 | `CoachingPlans.dc.html` | Coaching Plans | Desktop | v1 · AI Coaching: Import, Review, Bank, Train, Learn from Legends | **superseded** | v1 exploration (ideas only) | — (no enum prop) |
| 323 | `PhoneMistakeBank.dc.html` | iPhone · Mistake Bank | iPhone | v1 · iPhone | **superseded** | v1 exploration (ideas only) | — (no enum prop) |
| 324 | `PhonePuzzle.dc.html` | iPhone · Puzzle Trainer | iPhone | v1 · iPhone | **superseded** | v1 exploration (ideas only) | — (no enum prop) |
| 325 | `iPhoneGameReview.dc.html` | iPhone · Game Review | iPhone | v1 · iPhone | **superseded** | v1 exploration (ideas only) | — (no enum prop) |
| 326 | `iPhoneAskCoach.dc.html` | iPhone · Ask the Coach | iPhone | v1 · iPhone | **superseded** | v1 exploration (ideas only) | — (no enum prop) |
| 327 | `Board.dc.html` | Shared · Board Component | Component | v1 · iPhone | **superseded** | v1 board (ideas for V3MoveBoard, P2) | — (no enum prop) |
| 328 | `iPadGameReviewLandscape.dc.html` | iPad landscape · Game Review | iPad L | v1 · iPad | **superseded** | v1 exploration (ideas only) | — (no enum prop) |
| 329 | `iPadPuzzleLandscape.dc.html` | iPad landscape · Puzzle Trainer | iPad L | v1 · iPad | **superseded** | v1 exploration (ideas only) | — (no enum prop) |
| 330 | `iPadMistakeBankLandscape.dc.html` | iPad landscape · Mistake Bank | iPad L | v1 · iPad | **superseded** | v1 exploration (ideas only) | — (no enum prop) |
| 331 | `iPadGameReviewPortrait.dc.html` | iPad portrait · Game Review | iPad P | v1 · iPad | **superseded** | v1 exploration (ideas only) | — (no enum prop) |
| 332 | `iPadPuzzlePortrait.dc.html` | iPad portrait · Puzzle Trainer | iPad P | v1 · iPad | **superseded** | v1 exploration (ideas only) | — (no enum prop) |
| 333 | `iPadMistakeBankPortrait.dc.html` | iPad portrait · Mistake Bank | iPad P | v1 · iPad | **superseded** | v1 exploration (ideas only) | — (no enum prop) |
| 334 | `AndroidGameReview.dc.html` | Android · Game Review | Android | v1 · Android | **superseded** | v1 exploration (ideas only) | — (no enum prop) |
| 335 | `AndroidPuzzle.dc.html` | Android · Puzzle Trainer | Android | v1 · Android | **superseded** | v1 exploration (ideas only) | — (no enum prop) |
| 336 | `AndroidWeaknessProfile.dc.html` | Android · Weakness Profile | Android | v1 · Android | **superseded** | v1 exploration (ideas only) | — (no enum prop) |
| 337 | `v2/V2Home.dc.html` | v2 · Home | Desktop | v2 · Desktop · one viewport, 1440 × 900 (fits 1280 × 800 and b… | **superseded** | v2 exploration (ideas only) | — (no enum prop) |
| 338 | `v2/V2Play.dc.html` | v2 · Play · Setup | Desktop | v2 · Desktop · one viewport, 1440 × 900 (fits 1280 × 800 and b… | **superseded** | v2 exploration (ideas only) | — (no enum prop) |
| 339 | `v2/V2Game.dc.html` | v2 · Game · In progress | Desktop | v2 · Desktop · one viewport, 1440 × 900 (fits 1280 × 800 and b… | **superseded** | v2 exploration (ideas only) | — (no enum prop) |
| 340 | `v2/V2GameOver.dc.html` | v2 · Game Over | Desktop | v2 · Desktop · one viewport, 1440 × 900 (fits 1280 × 800 and b… | **superseded** | v2 exploration (ideas only) | — (no enum prop) |
| 341 | `v2/V2GameReview.dc.html` | v2 · Game Review | Desktop | v2 · Desktop · one viewport, 1440 × 900 (fits 1280 × 800 and b… | **superseded** | v2 exploration (ideas only) | — (no enum prop) |
| 342 | `v2/V2MistakeBank.dc.html` | v2 · Mistake Bank | Desktop | v2 · Desktop · one viewport, 1440 × 900 (fits 1280 × 800 and b… | **superseded** | v2 exploration (ideas only) | — (no enum prop) |
| 343 | `v2/V2PuzzleTrainer.dc.html` | v2 · Puzzle Trainer | Desktop | v2 · Desktop · one viewport, 1440 × 900 (fits 1280 × 800 and b… | **superseded** | v2 exploration (ideas only) | — (no enum prop) |
| 344 | `v2/V2WeaknessProfile.dc.html` | v2 · Weakness Profile | Desktop | v2 · Desktop · one viewport, 1440 × 900 (fits 1280 × 800 and b… | **superseded** | v2 exploration (ideas only) | — (no enum prop) |
| 345 | `v2/V2LegendLessons.dc.html` | v2 · Legend Lessons | Desktop | v2 · Desktop · one viewport, 1440 × 900 (fits 1280 × 800 and b… | **superseded** | v2 exploration (ideas only) | — (no enum prop) |
| 346 | `v2/V2AskCoach.dc.html` | v2 · Ask the Coach | Desktop | v2 · Desktop · one viewport, 1440 × 900 (fits 1280 × 800 and b… | **superseded** | v2 exploration (ideas only) | — (no enum prop) |
| 347 | `v2/V2Profile.dc.html` | v2 · Profile | Desktop | v2 · Desktop · one viewport, 1440 × 900 (fits 1280 × 800 and b… | **superseded** | v2 exploration (ideas only) | — (no enum prop) |
| 348 | `v2/V2MistakeBankFilter.dc.html` | v2 · Mistake Bank · Filter open | Desktop | v2 · Desktop · one viewport, 1440 × 900 (fits 1280 × 800 and b… | **superseded** | v2 exploration (ideas only) | — (no enum prop) |
| 349 | `v2/V2iPhoneGame.dc.html` | v2 · iPhone · Game | iPhone | v2 · iPhone · 393 × 852 | **superseded** | v2 exploration (ideas only) | — (no enum prop) |
| 350 | `v2/V2iPhoneGameReview.dc.html` | v2 · iPhone · Game Review | iPhone | v2 · iPhone · 393 × 852 | **superseded** | v2 exploration (ideas only) | — (no enum prop) |
| 351 | `v2/V2iPhonePuzzle.dc.html` | v2 · iPhone · Puzzle Trainer | iPhone | v2 · iPhone · 393 × 852 | **superseded** | v2 exploration (ideas only) | — (no enum prop) |
| 352 | `v2/V2iPhoneMistakeBank.dc.html` | v2 · iPhone · Mistake Bank | iPhone | v2 · iPhone · 393 × 852 | **superseded** | v2 exploration (ideas only) | — (no enum prop) |
| 353 | `v2/V2iPadGameLandscape.dc.html` | v2 · iPad landscape · Game | iPad L | v2 · iPad · landscape 1194 × 834, portrait 834 × 1194 | **superseded** | v2 exploration (ideas only) | — (no enum prop) |
| 354 | `v2/V2iPadGameReviewLandscape.dc.html` | v2 · iPad landscape · Game Review | iPad L | v2 · iPad · landscape 1194 × 834, portrait 834 × 1194 | **superseded** | v2 exploration (ideas only) | — (no enum prop) |
| 355 | `v2/V2iPadGameReviewPortrait.dc.html` | v2 · iPad portrait · Game Review | iPad P | v2 · iPad · landscape 1194 × 834, portrait 834 × 1194 | **superseded** | v2 exploration (ideas only) | — (no enum prop) |
| 356 | `v2/V2AndroidGame.dc.html` | v2 · Android · Game | Android | v2 · Android · 412 × 915 | **superseded** | v2 exploration (ideas only) | — (no enum prop) |
| 357 | `v2/V2AndroidGameReview.dc.html` | v2 · Android · Game Review | Android | v2 · Android · 412 × 915 | **superseded** | v2 exploration (ideas only) | — (no enum prop) |
| 358 | `v2/V2Board.dc.html` | v2 · Shared · Board | Component | v2 · Shared v2 components | **superseded** | v2 board (ideas for V3MoveBoard, P2) | orient: w, b |
| 359 | `v2/V2Badge.dc.html` | v2 · Shared · Badge | Component | v2 · Shared v2 components | **superseded** | v2 move-quality badge (ideas for the P2 badge; owner icons win) | q: brilliant, great, best, excellent, good, book, forced, interesting, inaccuracy, mistake, miss, blunder |
| 360 | `v2/V2Nav.dc.html` | v2 · Shared · Sidebar | Component | v2 · Shared v2 components | **superseded** | v2 sidebar (replaced by V3Nav, P1) | current: home, play, review, train, profile |
| 361 | `v2/V3ReviewComplete.dc.html` | (off-canvas) Review complete, earlier draft | Desktop | offcanvas · Board files not on the canvas | **superseded** | Off-canvas draft; ideas for V3RvComplete (P3) | default, nothing_added |

---

## 5. Cross-phase catalogues

### 5.1 Schema rollout

Every row is an expand migration unless marked "contract". The owner confirms every contract step.

| ID | Phase | Content |
|---|---|---|
| M1 | P1 | `RateLimitBucket` (UNLOGGED), `WebhookEvent` |
| M2 | P2 | `Game` play columns, `GamePlayer`, `games(status, lastMoveAt)`; backfill script |
| M3 | P3 | `Job` (+ partial indexes), `GameAnalysis`, `PlayerReview`, `KeyMoment`, `ShareLink`, `LegendComparison`, `Opening.epd`, `Judgement`/`AnalysisStatus`; new `GamePlayer` columns |
| M4 | P4 | `LinkedAccount`, `ImportRun`, `ImportCursor`, `Game.source`/`externalId`, `User` onboarding fields, `TrialLedger` |
| M5 | P5 | `Mistake`, `TrainingCard`, `TrainingAttempt`, `TrainingSession`, `TrainingDay`, `ThemeMastery`, `TrainingProfile`, `TrainingReport` |
| M6 | P6 | `WeaknessSnapshot` |
| M7 | P7 | `CoachThread`, `CoachMessage`, `CoachUsage` |
| M8 | P8 | `Legend.slug/eraKey`, `ChessPosition` practice columns, `Opening.slug/popularity/hasExplanation`, `PositionCollection(+Item)`, `Lesson`, `LessonProgress` |
| M9 | P9 | `Challenge`, `SharedPosition`, `PlayerRating`, `RatingEvent`, `UserSettings` (botStrength first) |
| M10 | P10 | Profile columns, `UsernameHistory`, `PlayerStats`, `UserMilestone`, `UserBlock`, `UserReport`, `PushSubscription`, `Notification`, `DataExportJob`, `AccountDeletion` |
| M11 | P11 | `ConsentRecord` |
| M12 | P12 | `TournamentInvite`, `TournamentPairing`, `TournamentPosition`, tournament columns, `AdminActivity`, tournament indexes |
| C1 | after M2 is stable (P13 + 30 d) | Drop the duplicate indexes (audit-db §13.1); strip `gameData.moveHistory` (contract) |
| C2 | P9 + 1 release | Drop `matchmaking_queue` (contract) |
| C3 | P10 | Nullable `SET NULL` FKs for anonymise-on-delete (contract) |
| C4 | P13 + 1 release | Drop `user_stats` and `chess_com_profiles` (contract) |

### 5.2 Realtime events (socket server, `domain:event`, B20)

| Event | Room | Emitted by | Phase | Consumers |
|---|---|---|---|---|
| `game:*`, `move:*`, `clock:sync`, `draw:*`, `rematch:*`, `presence:update`, `server:restarting` | `game:{ref}` | socket | P2 | game screen |
| `analysis:progress`, `analysis:done` | `user:{ref}` | worker → `/internal/emit` | P3 | review, game-over card, archive row, Home |
| `compare:ready` | `user:{ref}` | worker | P3 | legend compare |
| `games:changed` | `user:{ref}` | complete route, import batches | P3 | archive (throttled to 1 per 10 s) |
| `import:progress`, `import:finished`, `import:failed` | `user:{ref}` | worker | P4 | onboarding done, archive, Home, Connected accounts |
| `entitlement:changed` | `user:{ref}` | Dodo webhook → `/internal/emit` | P4 | activating screens, viewer cache, socket token refresh |
| `bank:due_changed`, `mistakes:added` | `user:{ref}` | attempts route, worker | P5 | Train hub, Home, nav dot |
| `weakness:ready` | `user:{ref}` | worker | P6 | weakness page, nav dot |
| `queue:status`, `queue:timeout`, `match:found`, `challenge:accepted\|declined` | `user:{ref}` | socket, challenge routes | P9 | Play hub, queue, challenge share |
| `prefs:updated`, `profile:updated`, `membership:updated`, `export:ready`, `milestone:awarded`, `presence:update` | `user:{ref}` | PATCH routes, worker | P10 | other tabs and devices, toasts |
| `notice` | broadcast | `/internal/broadcast` | P11 | maintenance banner |
| `tournament:*` | `tournament:{ref}` / `user:{ref}` | scheduler, pairer, game end | P12 | lobby, arena, game strip, results |

Every consumer also has a fallback for clients without a socket: an ETag-guarded status GET that polls only while a job is running and the tab is visible.

### 5.3 Legacy API retirement

| Legacy route (WEB/app/api) | Replaced by | Phase |
|---|---|---|
| `user/[referenceId]` | removed | P1 (H3) |
| `user/email/[email]`, `user/sync` (boot), most `GET subscription` calls | `GET /api/me`, Clerk webhook | P1 |
| `healthcheck` | `GET /api/health` | P1 |
| `chess/move`, `chess/game-state`, `chess/game-over`, `chess/create-ai-game`, `chess/game-by-ref` (browser) | socket v2 direct persistence; `POST /api/games` (+checkpoint, complete); `GET /api/games/[ref]` | P2 |
| `analysis/[gameId]` | `/api/review/:ref/*` | P3 |
| `user/chess-com-profile*`, `user/onboarding-skip` | `/api/accounts/*`, `PATCH /api/me/onboarding` | P4 |
| `chess-positions/featured`, `position/[referenceId]` | `GET /api/positions*`, `/s/[code]` | P8 |
| `legends`, `openings` (public reads) | RSC + ISR loaders; `GET /api/learn/openings` | P8 |
| `matchmaking/*` (4 routes), `chess/create-game`, `chess/join`, `chess/cancel-game` | socket queue; `/api/challenges*` | P9 |
| `profile/[referenceId]` | `/api/players/{username}*` | P10 |
| `customer-portal` (GET) | kept; `POST /api/subscription/payment-method` added | P10 |
| `tournament/*` (most), `chess-positions/*`, `legends/create\|[id]\|search` | `/api/tournaments/*`, `/api/admin/*`, socket pairer | P12 |

### 5.4 How the UI talks to the API (the conventions every phase inherits from P1)

| Concern | Rule |
|---|---|
| First paint | Server components call service functions (`lib/**/*.server.ts`) directly, after `getViewer()` and the member check. There is no client fetch on first load. Heavy blocks stream in `<Suspense>` with the V3Skeletons variant. |
| Client reads | TanStack Query with keys from `lib/api/keys.ts`, seeded via `HydrationBoundary`. `staleTime` by freshness: ∞ for immutable data (finished reviews, PGN), 30–60 s for lists, 0 for sessions. |
| Mutations | `api()` + `useMutation`. Optimistic where the design advances immediately (grades, toggles, prefs). An `Idempotency-Key` on every create (games, sessions, checkout, shares, attempts). Conditional SQL updates for state transitions (audit-api §7.2). |
| Push | The socket `user:{ref}` room patches the cache with `setQueryData`. HTTP serves snapshots only. |
| Polling | Only as a fallback: ETag/304 status endpoints with back-off (2 → 4 → 8 → 15 s), only while visible and while a job is running. |
| Errors | One envelope (B16). 401 → session modal, 402 → pricing with `reason`, 429 → countdown, 503 → maintenance banner, 5xx → toast with the request id. |
| Caching tiers | `public-static`: `s-maxage` + `stale-while-revalidate` + `revalidateTag` (catalogues, challenge previews, share pages). `private-etag`: user data that rarely changes (review payload, weakness). `no-store`: due counts, membership, home. |
| Pagination | Keyset cursors only (`(endedAt, id) < cursor`), `limit` ≤ 50, `meta.cursor`. No offset pagination on user data. |
| Rate limits | Postgres `RateLimitBucket`, only on lookups, search, coach, contact, feedback and creates. Never on hot read paths. |
| Writes from OCI | Batched: one transaction per game end, per analysed game and per import month. Every OCI → Neon round trip costs ~200 ms. |
| Neon wake-ups | No timer polling anywhere. Jobs are kicked; catalogues are ISR; matchmaking runs in memory. |
| Bundles | Shared first load ≤ 200 kB gz; `/game` and `/review` ≤ 300 kB gz without the engine; marketing ≤ 180 kB gz (audit-client §11.14). The engine, palette, sheets and modals load through `next/dynamic`. |
