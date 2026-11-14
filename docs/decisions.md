# Decision register

One register for owner decisions (architecture plan, "Schedule realism"; feasibility §8). A decision's **default
applies unless the owner objects within 3 days**; an objection is recorded here with its date and the new answer.
Each row names where the decision came from and where the code follows it.

## Phase 4: Game import and onboarding v3

Source: `docs/plan/phase-04-game-import-and-onboarding-v3.md` §14.1. Status on 2026-11-13: **the defaults stand** (the
orchestrator confirmed them for stage A; no owner objection recorded). Full scope, nothing trimmed.

| # | Decision | Answer in force | Followed in |
|---|---|---|---|
| OD-1 | Import scope and analysis volume | 12-month window, newest 2,000 games per account and run; trialists 20 eager analyses, members 50; 200 analysed-without-opening per member; the backlog in 7 daily slices after the first paid charge; production backfilled links get a throttled first import (B5 `--queue-imports`, P13) | `apps/analysis-worker/src/import/settings.ts`, `packages/chess-import/src/window.ts`, `packages/db/src/import-backlog.ts` |
| OD-2 | Privacy text for the trial ledger and imported data; Chess.com User Agreement review | P13 preflight blocker; until it clears: no Chess.com avatars (initials, D4-26) and provider names as plain text; no blocker on dev | onboarding Confirm/Link, Settings · Connected |
| OD-3 | Copy changes against the boards | as written in plan §4 ("Importing starts as soon as your trial begins"; all-time rated-game counts; the rewritten `private_games` banner; no "Confirmation sent to …"; "Go to Home" hidden while activating; initials instead of avatars) | `components/onboarding/*`, `components/billing/ActivationCard.tsx` |
| OD-4 | Chess.com ownership verification | none in P4; an unverified handle never blocks a trial; `RELINK_REQUIRED` reserved for P10's profile-location check | `lib/billing/trial-ledger.ts` (verified handles only), `lib/accounts/link-service.ts` |
| OD-5 | Default billing interval on the onboarding Plan step | monthly | `lib/onboarding/plan-view.ts` |
| OD-6 | Does "Play friends" take minutes in the day preview? | no ("ANYTIME") | `lib/onboarding/day-preview.ts` |
| OD-7 | Lichess OAuth: client ids, no scopes, no stored token | as stated: `replay-chess-dev` / `playchess.tech`, no scope, the token revoked before the redirect, every import anonymous | `lib/accounts/lichess-oauth.ts` |
| OD-8 | Email for the trial-started confirmation and the trial-ending reminder | P10 owns both; P4 sends no email | — |
| OD-9 | Phase size | 21 days accepted (17.5 + 3.5 buffer); nothing cut | — |
| OD-10 | Internal-auth scheme | not P4's: P2/P3's `packages/contracts/src/internal/auth.ts` (kids `web`, `ws`, `wk`, `ops`, `webwk`, `opswk`) | `lib/internal/fetch.ts`, worker `http/server.ts` |
| OD-11 | `prisma db push` | never, on any database; every schema change is a committed migration applied with `prisma migrate deploy` (CLAUDE.md "Database Safety Rules" already says so) | `packages/db/prisma/migrations/` |

### Readings settled in the Phase 4 fix round (FIX-1, 2026-11-13)

Rule or product readings the review raised, settled the way a chess-coach product wants them. The owner may object
like any default.

| # | Question | Reading in force | Where |
|---|---|---|---|
| FX-1 | A Lichess member plays more than 1,000 games between two syncs (a long break, auto-import off, a heavy bullet player) | Every game is read: a full 1,000-game stream pages on with `until` in the same run, up to the newest 2,000 for the run (the same "newest N" rule as a first import, OD-1). Older games past the run's 2,000 are not imported. | `apps/analysis-worker/src/import/reading.ts` |
| FX-2 | A Lichess correspondence game still running at a sync | Imported once it finishes: every non-initial sync ends with one correspondence look-back stream over the import window (one extra anonymous request a day per Lichess account; known games are dropped before writing). | same |
| FX-3 | Disconnect and delete games, where the opponent imported the same game | The game stays for the opponent with its analysis (the queued job is handed to them); the departing member's share links and legend comparisons of it are deleted with their side. | migration `20261113000100_m4p_purge_survivors` |
| FX-4 | Two checkouts paid at once (two tabs or devices) | Prevented when possible: a second checkout is refused while the first session is paid but not yet applied. When both pages are paid anyway, the second subscription is cancelled at its next billing date and never applied, and its first charge is listed for a refund (`audit_logs` action `billing.duplicate_subscription_cancelled`, `meta.refund = first_charge`; the owner refunds from the Dodo dashboard). No automatic refund: money movement stays a human action. | `lib/billing/checkout.ts`, `lib/billing/dodo-events.ts` |
| FX-5 | A decline, then a second card accepted on the same Dodo page | The success wins: Dodo's return (`subscription_id`) and Check Again (`force=1`) still ask Dodo after a recorded decline; only the passive poll trusts the decline. | `lib/data/billing.ts` |
| FX-6 | `review_ready_after_import.ms_since_entitled` | From when the member could expect the review: the trial start when the run was parked for a membership and released at entitlement, else the run's creation (an already-entitled member linking). `import.review_ready_ms` = analysis commit − the run's `startedAt`. | `apps/analysis-worker/src/pipeline/final-batch/p04-import.ts` |
| FX-7 | DEV-1 `/api/dev/import-fault` and route() | Stays a guarded plain handler with its `maxDuration`: a test hook must 404 every request in production, and route() validates and authenticates before its handler. | `app/api/dev/import-fault/route.ts`, `test/api/route-catalogue.test.ts` |
| FX-8 | Maintenance switch for imports | `MAINTENANCE_AFFECTS=import` (optional `MAINTENANCE_RETRY_AT`) answers `/api/accounts/*` and `/api/import/*` with `503 maintenance {affects: ["import"]}`; pair with the worker's `IMPORT_PAUSED`. An env switch (a redeploy flips it) until P1's Edge Config notice exists. | `lib/api/maintenance.ts` |
| FX-9 | Level-step sample puzzles | Five CC0 puzzles from the Lichess puzzle database, ids and ratings kept with each one. | `lib/onboarding/sample-puzzles.ts` |

### Readings settled in the Phase 4 second fix round (FIX-2, 2026-11-13)

Round-2 review findings that were product or rule readings rather than defects, settled the way a chess-coach product
wants them. The owner may object like any default.

| # | Question | Reading in force | Where |
|---|---|---|---|
| FX-10 | Two members link the same Chess.com account (unverified, "link anyway", §8.15): a coach and a student, one person with two accounts, a typo, or someone squatting another player's handle | Nobody is blocked and nothing is taken: every claimant gets the games. M2 allows one member per colour of a games row, so a claimant whose side another member already holds gets their own **claim copy** of the game (`externalId` = `<id>~<linkedAccountId>`, a hash prefix when that does not fit 40 characters) with only their side and their own analysis; the known filter maps it back. The first claimant keeps everything. Lichess links stay verified (no co-claim). | `apps/analysis-worker/src/import/{co-claim,batch-writer,known}.ts` |
| FX-11 | A provider rate-limits an import again and again | A 429 is a pause, never a failure: the gate pauses (Lichess 60 → 900 s), the run waits QUEUED, the job is requeued at the pause's end without using an attempt (plan §8.11 "no terminal case"). The account shows the rate-limited countdown meanwhile. | `apps/analysis-worker/src/jobs/import-sync.ts`, `src/queue/outcome.ts` (`refundAttempt`) |
| FX-12 | Purge with the link kept (the ops data rollback, §14.4) and games that survive a purge | The purged link starts over: its cursor is reset and its counters go to 0, so the next sync re-reads the window. A game the opponent also imported is handed to the remaining player as its legacy creator (result and clocks from their side, `winnerId` = them when their colour won), so the purged member keeps no foothold in it. | migration `20261113000200_m4q_purge_resets` |
| FX-13 | A declined trial checkout (`subscription.failed`, or a `pending` mandate) | A subscription that never started uses nothing: no trial dates, and it is not held on the users row; the retry the decline screens promise gets the free trial. Two entitled subscriptions at once (two tabs, two plans) never both stand: whichever reaches the row second is not applied on any path (webhook, activation self-heal, refresh) and is cancelled at its next billing date, so a second trial never charges. | `lib/billing/{trial-rules,entitlement-rules,entitlement,dodo-events,refresh}.ts`, `lib/data/billing.ts` |
| FX-14 | Two checkout tabs for the same plan | The second tab gets the first tab's open Dodo page back (same session, same trial offer, same charge date) within the 30-minute pending window; another plan, a failed or cancelled session, or an older one opens a new session (FX-13 then guarantees one subscription). The page URL is stored with the session (migration `20261113000300_m4r_pending_checkout_url`). | `lib/billing/checkout.ts` |
| FX-15 | The trial-ledger write is lost (the fan-out runs after the response and only logs a failure) | A daily cron task (`trial-ledger-sweep`) writes the ledger row again for every trial started in the last 30 days (idempotent merge), so a lost write is repaired within a day. | `lib/cron/tasks/trial-ledger-sweep.ts` |
| FX-16 | A ledger hit (a re-signup, an email variant) on surfaces other than /pricing | Every server seed of the viewer query asks the ledger (one shared probe per request, only while the row says eligible), and a 402 for such a person says `trial_used` (sent to the "ended" paywall), never `trial_available`. | `lib/billing/ledger-viewer.ts`, `lib/api/route.ts`, `lib/auth/membership.ts` |
| FX-17 | The legacy Chess.com endpoints while v3 is on | `POST /api/user/chess-com-profile` and its `/preview` answer 404 once both `onboarding-v3` and `import-v3` are on (no caller left); while served they spend the lookup buckets; the profile route marks the user onboarded only for the legacy onboarding page (`onboarding-v3` off). | `lib/onboarding/legacy-chesscom.ts` |
| FX-18 | What `/api/me` carries once onboarding is finished | Not the onboarding view: only the steps read it, so a member's `/api/me` grows by ~170 B with P4 instead of ~380 B (plan §9.6 ≤ +350 B). A user mid-onboarding still gets it. | `lib/auth/viewer-dto.ts` |
| FX-19 | Which errors `/api/import/status` and `/api/accounts` send | An error once, where it is shown: on each provider's newest run in the status (the run the client shows), and on the account (`lastError`) rather than again on its run in the accounts list (plan §9.6 payload budgets). | `lib/data/{imports,import-rows}.ts` |
| FX-20 | How a route's First Load JS is counted for the bundle budgets | The route's own cost: the files every route loads plus its page-entry files, less the files the root layout's entry already loads on every route (the toaster, the class merger, the query client, the API client). `next build` prints the page entry including those files, which charged a page 26–33 kB for reusing the root layout's modules; the report shows both figures. Applies to every row (P2, P3, P4). | `apps/web/scripts/check-bundle-budgets.mjs` |
| FX-21 | Sentry sampling of the P4 routes | The Lichess callback at 1.0 (auth), other `/api/accounts/*` at 0.2, `/api/import/status` at the API default with its 304 polls dropped after the response (the sampler runs before the status is known). | `lib/sentry/{traces-sampler,scrub}.ts` |

## Phase 5: Mistake Bank, puzzles, Train and Home

Source: `docs/plan/phase-05-mistake-bank-puzzles-train-and-home.md` §14.1. Status on 2026-11-14: **the defaults stand**
(the orchestrator confirmed them for stage A; no owner objection recorded). Full scope, nothing trimmed (D-21).

| # | Decision | Answer in force | Followed in |
|---|---|---|---|
| D-1 | Inaccuracies in the bank | yes, when ΔWin ≥ 7 in an undecided position, inside the 4-per-game cap | `packages/chess-analysis/src/bank/candidates.ts` |
| D-2 | "Remove from bank" (no design) | W6 + the row ⋯ ship behind the `bank-remove` flag variant with a 6 s Undo toast; a design board is needed before the variant reaches members (deferred to the owner's design pass) | `app/api/train/cards/[ref]/route.ts`, `components/train/bank/BankRowMenu.tsx` |
| D-3 | Puzzle rating seed | linked blitz/rapid + 300, clamped 800–2200, RD 250, "provisional" under 20 attempts | `packages/chess-training/src/rating.ts`, `lib/train/profile.server.ts` |
| D-4 | Streak definition | ≥ 1 graded item a day; one missed day forgiven ("resets if you skip 2 days") | `packages/chess-training/src/streak.ts` |
| D-5 | New-user Train hub (no board) | step 1 "Review your last game" / "Import games", step 2 puzzles at the seeded rating, EmptyState in the due strip; a `V3TrainHubNew` board is deferred to Design | `packages/chess-training/src/plan.ts`, `components/train/hub/*` |
| D-6 | Puzzle cards only for misses | a card only on Again/Hard; clean solves are logged | `lib/train/attempts.server.ts` |
| D-7 | ts-fsrs version | `ts-fsrs@^5.4.2` behind `fsrs.ts` (v6 after Node 24 is a wrapper change) | `packages/chess-training/src/fsrs.ts` |
| D-8 | "Hard 2 days" on new cards | the again-only learning-step strategy (Hard graduates) | same |
| D-9 | Which mistakes get cards | key-moment plies only (≤ 3 a game, A6 controls them); up to 4 `Mistake` rows a game | worker `extract/*`, `packages/chess-analysis/src/bank/*` |
| D-10 | Grade override | any grade allowed, `overridden` tracked | `components/train/runner/GradeBar.tsx`, `train_item_graded` |
| D-11 | Nav due badge | none shown; `badges.bankDue` is served for a later badge | `lib/train/badges.server.ts` |
| D-12 | Home device layouts (no boards) | derived from the Train hub device pattern (§4.1); a design pass before the `home` flag reaches members (deferred to Design) | `components/home/home.css` |
| D-13 | Client-side Glicko preview | the deterministic preview, replaced silently by the server's state on flush | `features/train/rating.ts`, `features/train/runner-store.ts` |
| D-14 | Training prefs location | `TrainingProfile` columns, written only through W8 | `lib/train/prefs.server.ts` |
| D-15 | Reports endpoint | one `reports` table + `POST /api/reports` | `lib/reports/reports.server.ts` |
| D-16 | Vercel Hobby is non-commercial | stay on Hobby for dev in P5; the move to Pro is the owner's P13 decision and the P13 preflight fails while the team is on Hobby with Dodo live mode on (deferred to P13) | — |
| D-17 | Puzzle shard URL | the `replay-chess-media` R2 bucket's public URL (env `PUZZLE_SHARD_BASE_URL`); `media.playchess.tech` when the owner confirms (deferred, env-only change) | `lib/train/puzzle-shards.ts` |
| D-18 | CLAUDE.md DB rule 1 | `migrate deploy` on every Neon branch, never `db push` or `migrate dev` there; `migrate dev` only on a local Docker Postgres (CLAUDE.md already says so) | `packages/db/prisma/migrations/` |
| D-19 | Lapsed members reading their bank | hard redirect to the paywall, data kept | `lib/auth/*` member gate, `route({ auth: "member" })` |
| D-20 | Settings › Training (no board) | not built; defaults only; W8 accepts every pref for a later screen (deferred to P10 if approved) | `app/api/train/prefs/route.ts` |
| D-21 | P5 budget | 28 dev-days accepted; full scope | — |
| D-22 | Telemetry for SLOs | client timing as anonymous Sentry metrics (`route_class`, `device_class` only), not PostHog | `features/train/telemetry.ts`, `lib/offline/attempts-sync.ts`, `lib/realtime/handlers/home.ts` |

### Phase 5 hand-off notes (plan §15 "Docs")

| To | Note |
|---|---|
| P3 | `?ply=` equal to a moment ply opens that moment (See It in Your Game links `?ply=<lastPly>&from=bank`); the final batch's extension hook (`pipeline/final-batch`) carries P5's statements; `analysis:done` grows to ≤ 200 B with `bankAdded`/`bankDue`, and `analysis:batch` carries the same two fields; A2's probe includes the bank count. |
| P6 | Use `training_cards` / `training_attempts` and their index names; the `train_session_*` events are reused with `kind: "weakness"`. |
| P7 | Delete the `KeyMoment` hedges; `Mistake.texts` is the only stored coach text. |
| P8 | Light `LessonCardSlot` on the summary (`SessionSummary.next.lesson`, edge E60) and the caught-up bank (`BankPage.lesson`) in S13; the runner, `SessionKind`, the outbox and the slot interfaces are frozen (§14.2). |
| P9 | Add the `GAME` preset to `rating/presets.ts`; leave `glicko2.ts` unchanged. |
| P10 | Add `targetType: "user" \| "game"` branches to `POST /api/reports` (no `UserReport`); Settings › Training only if D-20 is approved, calling W8; account deletion anonymises `lastOpponentName` ("Deleted player") and deletes the P5 private tables; reminders and the release push as future-dated jobs. |
| P11 | The per-user `rc-pages:u:<ref>` cache allow-lists `/train/bank/session` and `/train/puzzles` for an offline reload (reading `rc-offline`), plus the daily offline snapshot and the `/offline` row; the consent fixture keeps the P5 telemetry assertions green. |
| P12 | The tournament game-over card reuses the `bank` slot (§4.8). |
| P13 | Remove `_m5v_validate_key_moment_fk` from the production migration list; rehearse M5 on a child branch of production; the D-16 preflight. |

### Readings settled in the Phase 5 first fix round (P5 FIX-1, 2026-11-14)

Round-1 review findings that were product or rule readings rather than defects, settled the way a chess-coach product
wants them. The owner may object like any default.

| # | Question | Reading in force | Where |
|---|---|---|---|
| P5-FX-1 | A puzzle stream past 40 items (`SessionItemsV1` holds ≤ 40, pass-2 copies included) | One streaming session holds at most 40 items. W3 fills the last batch to 40 and then answers `stream: false`; the runner ends the stream (no "No more puzzles" note) and the summary's Continue With Puzzles opens the next stream. An Again on a full list still schedules the card but queues no pass-2 copy, on the client and the server alike (`requeueAfterAgain`). A summary every ≤ 40 puzzles is a natural checkpoint; an unbounded session row would break the 40-item contract and the payload budgets. | `packages/chess-training/src/{constants,grade}.ts`, `lib/train/sessions.server.ts` |
| P5-FX-2 | Alternative checkmates | Any legal move that gives mate solves a ply whose stored move mates, in Lichess puzzles and bank cards, at any ply of the line (§8.1 step 2 "every other mate-in-1 joins accept", read for every mating ply). A mate is never scored as a wrong move (Glicko, streak, mastery). Bank cards store every other mate-in-1 in `accept` (≤ 6). | `packages/chess-training/src/mates.ts`, `features/train/validate.ts`, `lib/train/attempts.server.ts`, worker `extract/extractMistakes.ts` |
| P5-FX-3 | FSRS fuzz versus the buttons | The fuzz is seeded by the card (its key) and its state before the grade (reps, difficulty, stability), never by the review instant, so the interval a button shows when the session is built is the interval the grade schedules (ts-fsrs's default seed mixed in the review time; most grades landed on another day). Different cards still spread. | `packages/chess-training/src/fsrs.ts` |
| P5-FX-4 | A session item graded twice (two tabs, a replay with a fresh `clientAttemptId`) | A session's item is graded once: a second grade of it answers `conflict` and writes nothing (rating, puzzlesDone, streaks, mastery, session counters untouched); an invented item id is `not_found`. A grade with no session must reschedule its card, else `conflict`. A grade dated before the card's last review is logged, never scheduled. | `lib/train/attempts.server.ts` |
| P5-FX-5 | `reviewedAt` of a session's attempt | Never before its session started (raised to `startedAt`), so a batch cannot fill streak days before the session existed; sessionless grades keep the 7-day clamp. | same |
| P5-FX-6 | A time-zone or day-start change in the middle of a training day | The day in progress keeps its key and its used cap, plan and streak until it ends in the zone it began in; moving west lengthens it (the key never goes back); the new zone's days follow. Each `training_days` row records the zone it was opened in (migration m5b). The hub syncs the device zone only over the default "UTC" (unchanged), so two devices do not flip it back and forth. | `packages/chess-training/src/day.ts` (`trainingDayAt`), `lib/train/{day,attempts,today}.server.ts`, migration `20261114000200_m5b_training_day_zone` |
| P5-FX-7 | Recurrence | Any new occurrence of a carded mistake in a newer game brings the card back at the next release, key moment of that game or not (§8.1 step 8). | worker `extract/bankStatements.ts` |
| P5-FX-8 | A regrade (engine-free) and the bank | A regrade with J1 on marks the sides for re-extraction (`bankVersion` 0) and queues one EXTRACT_MISTAKES job per side in its own batch, so a moment it adds gets its card. Re-extraction never deletes cards: a card for a moment a regrade or re-analysis dropped is still a real error of that game, and its FSRS history is the member's. | worker `pipeline/final-batch/p05-bank.ts` |
| P5-FX-9 | Offline stores at sign-out | Every sign-out path clears the member's `rc-outbox` and `rc-offline`: the in-app ones (account menu, palette, "Use a Different Account", onboarding) flush first (≤ 3 s); another tab's sign-out and an external one (Clerk's UserButton, a session ended elsewhere on a public page) clear without a flush, because the session is gone. On a shared device the next person must not find the previous member's solutions, opponents and grades; an unsent grade from a revoked session is the accepted loss. A queue is never sent while another member is signed in in the same document. | `lib/auth/sign-out.ts`, `lib/offline/{active-user,attempts-sync,useOutboxSync}.ts` |
| P5-FX-10 | §9.4 payload budgets | gzip (what crosses the network) is held at §9.4's figures for every payload, except the 50-row bank page at 5 KB: a real member's bank projects to ≈ 4.8 KB (the FEN is ≈ 40 B of gzip a row) after BankRow dropped its unused 25-character mistake ref (it was ≈ 5.3 KB). The raw column of §9.4 assumed ≈ 280 B a bank row and ≈ 1 KB a session item, which §7.1's contract cannot hold; raw ceilings are the measured worst cases + ≈ 5 % as regression guards, §9.4's figures kept beside them. | `packages/contracts/src/http/train-budgets.ts` |
| P5-FX-11 | §9.1 statement counts | The latency budget is §9.1's round-trip column: every read path runs its statements in one parallel batch (R1, R2, HOME, the R3 summary are 1 round trip; the summary now reads its attempts by the session's ref in that batch). W1 meets §9.1 outright: 3 statements in its transaction (+1 when a touched day's plan is open). W2 gained a per-member lock and a reuse/limit re-check in its transaction (two creates at once give one session; the 31st of the hour is refused under concurrency, before any build work); W2 also has a 20/60 s burst limiter. Statement counts are held as ceilings in `budgets.contract.int.test.ts`. | `lib/train/{attempts,sessions}.server.ts` |
| P5-FX-12 | The puzzles kill switch's copy | `PUZZLES_ENABLED=off` shows "Puzzles are taking a break. Your Mistake Bank still works." (§7.9) with Open Mistake Bank; a shard outage keeps "Puzzles are unavailable right now." | `components/train/runner/SessionError.tsx` |

### Readings settled in the Phase 5 second fix round (P5 FIX-2, 2026-11-14)

| # | Question | Reading in force | Where |
|---|---|---|---|
| P5-FX-13 | A6 opt-out with the `train` flag off | An opt-out deletes the card an extraction already made (and hides the mistake), flag on or off: the extraction is not flag-gated, so otherwise the bank would hold, and the review show as "Added", a moment the member opted out of once the flag turns on. An opt-in with the flag off still records only the flag (P3-D19); the card comes back when the member toggles it on with the flag on. | `app/api/review/[ref]/moments/[ply]/route.ts`, `lib/train/links.server.ts` |
| P5-FX-14 | Sessionless grades (`sessionRef: null` with a `cardRef`: a contract form no shipped client sends) | Dated by the server's clock, never by the client's `reviewedAt` (no session start bounds them, so seven backdated grades could fill seven past training days); still must reschedule their card, else `conflict`; never move the puzzle rating (the server did not serve that puzzle, and a learning card could be re-graded at will). Session attempts keep the 7-day clamp raised to the session's start (P5-FX-5). | `lib/train/attempts.server.ts` |
| P5-FX-15 | Which "days" FSRS counts | The member's training days (local wall clock, day start 04:00), not UTC calendar days: ts-fsrs runs on a training-day clock, so the interval a button shows is the interval the grade schedules anywhere inside one training day (a US evening session crossing UTC midnight changed most intervals before). Across the member's own day start the day changes, as the cap, streak and plan do. | `packages/chess-training/src/fsrs.ts` (`dayClock`) |
| P5-FX-16 | §9.4 raw payload figures and §9.1's W2 round trips | **Not met; owner decision needed** (listed as expected red). The gzip column holds on every real answer measured (R2 41 rows 3,988 B ≤ 4,096) except a full 50-row bank page, which projects to ≈ 4.9 KB. The raw column assumed ≈ 280 B a bank row and ≈ 1 KB a session item; §7.1's contract carries ≈ 450 B a row and 1.3–1.6 KB an item (8 grade previews and up to ≈ 1.1 KB of coach text), so meeting it needs a new wire format (tuple rows and previews without the unused `due`), a client-wide contract change. W2 BANK runs ≈ 7 sequential round trips (the per-member lock and re-check that make two concurrent creates one session) against §9.1's 2 (+1). The ceilings in `train-budgets.ts` and `budgets.contract.int.test.ts` stay at the measured values as growth guards; nothing was raised in FIX-2. | `packages/contracts/src/http/train-budgets.ts` |
| P5-FX-17 | Home's "Play" links | `/play` reads `?tab=quick\|friend\|bot` and `?tc=<min>+<inc>`: Challenge a Friend opens Challenge a Friend, Play a Bot opens Play the Machine, Quick Match · 5+3 opens Quick Match with 5 \| 3 selected (the selector's presets have no 5+3; the value is applied as a custom Blitz control). | `lib/play/play-params.ts`, `app/(app)/play/page.tsx`, `components/home/copy.ts` |
| P5-FX-18 | Offline stores at a sign-out in a tab that never mounted the (app) layout | Every member's `rc-outbox` and `rc-offline` keys go (each key is per member and nobody is signed in after a sign-out), not none. | `lib/auth/sign-out.ts`, `lib/offline/{outbox,snapshots}.ts` |
| P5-FX-19 | "See It in Your Game" on phones and iPad portrait | A bank item shows a 36 px line under the board ("You play White · See It in Your Game"; iPad portrait keeps "In the game you played b3") and the ⋯ menu carries See It in Your Game on every device; on a short phone (≤ 620 px stage) the line gives way to the board's 220 px floor and the menu entry stays. Puzzles have no line under the board (device boards). | `components/train/runner/{TrainerLabelBar,TrainerMenu,trainer.css}` |
| P5-FX-20 | A puzzle that already has a PUZZLE card | Never served again as a new shard puzzle (the 90-day exclusion also reads the member's puzzle cards); it comes back only through its card's schedule. | `lib/train/sessions.server.ts` (`recentPuzzlesSql`) |

