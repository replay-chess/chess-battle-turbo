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
