# Phase 4 plan: Game import and onboarding v3

Status: detailed phase spec, **revision 2**, 2026-11-02, branch `dev` @ `0848b76`. It expands `SP/plan/allocation.md` §3 "P4 · Game import and onboarding v3" (allocated 16 dev-days, 27 boards; this revision estimates 17.5 dev-days of work plus a 3.5-day (20 %) buffer, 21 in all; owner decision OD-9). Where this file and the allocation disagree, the allocation's binding decisions (§2, B1–B26) win, and this file says so in §0.2. This file is the final copy at `REPO/docs/plan/phase-04-game-import-and-onboarding-v3.md`; the working copy and the companion plans (`allocation`, `architecture`, `data-model`, `api-design`, `client-data-layer`, `optimization`, the other phases) are in `SP/plan/`. Revision 2 applies the five plan critiques (`SP/plan/critique-{coverage,consistency,feasibility,testing,api-perf}.md`); every finding that concerns P4 is answered in **Appendix Z** (accepted, with the section that changed, or rejected with a reason). Where two critiques disagree, §0.2 records the ruling P4 follows.

**Path shorthands** (same as the allocation, plus three)

| Short | Path |
|---|---|
| `REPO` | `/Users/rohitpandit/open_source/chess-battle-turbo` |
| `WEB`, `WS` | `REPO/apps/web`, `REPO/apps/web-socket` |
| `WK` | `REPO/apps/analysis-worker` (created in P3) |
| `DB` | `REPO/packages/db` (schema and migrations, moved out of `WEB/prisma` before M2, data-model O12). If the move has not happened, read `WEB/prisma` wherever this file says `DB/prisma`. |
| `CT` | `REPO/packages/contracts/src` (`http/`, `socket/`, `internal/`, zod 4; B17), imported as `@repo/contracts/{http,socket,internal}/<file>` (consistency R-10) |
| `CI` | `REPO/packages/chess-import` (new in this phase) |
| `SP` | the planning session's scratchpad, archived scratch inputs that are not in the repo and may no longer exist (see [99-open-decisions.md](99-open-decisions.md) A12) |
| `DR` | `SP/design-ref/project/v2` (board files `*.dc.html`) |

Inputs read for this spec: `SP/design-ref/INDEX.md`; every P4 board in `DR` (the 24 `V3Onb*`/`V3iPhoneOnb*`/`V3iPadOnb*` files, `V3CheckoutActivating`, `V4SettingsConnected`, `V4SettingsConnectedError`), plus the P10 settings-shell phone/tablet boards for the connected-accounts detail pane and `V3GamesArchive` for the slots P4 lights up; `SP/design-ref/ds/project/README.md` (one-viewport and zoom rules); `SP/plan/{allocation,architecture,data-model,api-design,client-data-layer,optimization}.md`; the inventories `inv-pub` §1.2–1.12 and §2.7, §2.13–2.20, §3, §4; `inv-acct` §3.7, §8.3; `inv-research` §11, §18–20; the audits `audit-api` #52–55 and F-12/F-16/F-21/F-27, `audit-db` §3.5, `audit-client` #12/#217/§9.4, `audit-quality` SEC/dead-code rows; `SP/phase1/SPEC.md` (UI kit contracts §3.5, shell §2.2–2.3, device suite §10.6); `REPO/research_notes/Chess coaching app market research/implementation.md` L124–L172; `REPO/docs/implementation-plan.md` §1 and Phase 4; the code listed in §3; and, for revision 2, the five critiques above plus `SP/plan/phase-02.md` §6.2 (the shipped `games` / `game_players` columns, L855–941) and `phase-03.md` §6–7 (jobs, priorities, enqueue SQL).

---

## 0. Summary

### 0.1 What P4 delivers, in one paragraph

A signed-in user who has not finished setup is sent by middleware to `/onboarding`, which resumes at the right step: **welcome → link (Chess.com lookup or Lichess OAuth) → confirm → level → goals → plan (Dodo checkout with the 7-day trial) → activating (socket push + polling fallback) → done (live import progress)**. Linking creates a `LinkedAccount` and an `ImportRun`. Lichess OAuth only proves ownership: the token is revoked inside the callback and never stored (D4-21). The run waits (`WAITING_FOR_MEMBERSHIP`) until the trial is active, then the OCI worker imports the last 12 months of rated games (capped at the newest 2,000) through serial, ETag-aware, anonymous provider clients, saves the newest 100 games at once and the rest in one SQL statement per 100 games, queues the newest game for analysis at "user waiting" priority and the next 19 (trialists) or 49 (paying members) at import priority, releases the backlog (up to 200 analysed games per member) in seven daily slices after the first paid charge (D4-09), and pushes `import:progress` / `import:finished` (both carrying `analysed`) over the user room. `/settings/connected` shows both providers with sync now, the daily auto-import switch, error states and disconnect (optionally deleting the imported games). `/checkout/activating` serves every non-onboarding checkout with the same activation engine. The P3 archive gains its source tabs and the import banner.

### 0.2 Decisions this spec makes (and the conflicts it settles)

| # | Topic | Inputs disagree / leave open | Decision for P4 |
|---|---|---|---|
| D4-01 | Account endpoints | allocation B10 `/api/accounts/*`; api-design §4.4 `/api/me/linked-accounts/*`, `/api/oauth/lichess/*`, `/api/me/imports` | **B10 is binding**: `/api/accounts/*`, `/api/accounts/lichess/{start,callback}`, `/api/import/status`, `/api/import/{ref}/retry`. The api-design IDs (ACC-1…8, OAU-1/2) are kept as aliases in §7 so cross-references still resolve. |
| D4-02 | Job kind name | allocation "Worker job `IMPORT_ACCOUNT`"; data-model `JobKind.IMPORT_SYNC`, `IMPORT_PURGE`; architecture `IMPORT_SYNC` | **`IMPORT_SYNC`** and **`IMPORT_PURGE`** (data-model is the schema authority). `IMPORT_ACCOUNT` in the allocation is the same job. Both values already exist in P3's M3 `CREATE TYPE "JobKind"` (consistency R-05 ledger), so P4 writes no `JobKind` migration. |
| D4-03 | Progress row | data-model D6 keeps counters on `LinkedAccount` (`importDone`, `importTotal`) and no `ImportRun`; allocation B5 "ImportRun stays as the user-visible progress row" | **Both, without duplication.** `ImportRun` (B5) holds the per-run counters and the `ref` the UI retries; `LinkedAccount` keeps only lifetime counters and summary state (`importState`, `importedCount`, `skippedCount`, `lastSync*`, `lastError`). `importDone` / `importTotal` from data-model §5.5 are **not created**. |
| D4-04 | `LinkedAccount.status` values | allocation `LINKED\|SYNCING\|ERROR\|REVOKED`; data-model `LinkStatus {ACTIVE, ERROR, RELINK_REQUIRED}` + `ImportState` | **data-model enums.** "Syncing" is `importState = RUNNING`, not a link status. The API maps the pair to one view status (§8.11). |
| D4-05 | Error codes | api-design §2.6 (`upstream_rate_limited`, `upstream_error`, `upstream_timeout`, `in_flight`, `membership_ended`); client-data-layer §4.2 (`upstream_unavailable`, `unauthenticated`); allocation F2 closed list | **P1's `CT/http/codes.ts` ledger** (consistency R-06): `rate_limited` (429) with `details.source: "replay" \| "chesscom" \| "lichess"`; `upstream_unavailable` (**always 502**, one status per code) with `details.provider` and `details.kind: "timeout" \| "error"`; `conflict` (409) with `details.reason`; `subscription_required` (402) with `details.reason` from `SUBSCRIPTION_REASONS`. No new codes in P4. P4 appends its six reasons to `CONFLICT_REASONS` in `codes.ts`: `linked_elsewhere`, `already_linked`, `sync_running`, `not_failed`, `plan_required`, `profile_closed`. |
| D4-06 | Job priority numbers | allocation P3 text and optimization §3.5 use "lower runs sooner"; data-model §5.4, architecture §1.10.4 and P3-D7 use "higher runs sooner"; api-perf AP-07 proposes `PRIORITY` in `packages/contracts/internal/jobs.ts` | **Higher runs sooner (P3-D7), named constants only, in `JOB_PRIORITY` exported from `DB/src/jobs.ts`** (P3 owns the file and the enqueue SQL; consistency R-05). P4 adds four names and reuses three: `IMPORT_SYNC_MANUAL 100`, `IMPORT_SYNC_INITIAL 60`, `IMPORT_PURGE 20`, `IMPORT_SYNC_DAILY 15`; reused `USER_OPENED 100`, `IMPORT_NEWEST 50`, `BACKLOG 10`. Per-member interleaving uses P3's `jobs."fairSeq"` (M3, index `jobs_ready_idx (priority DESC, "fairSeq", "runAt") WHERE status = 'QUEUED'`). P4 code never writes a priority literal (a lint rule in `DB/src/jobs.ts`'s package bans numeric `priority:` in P4 files). |
| D4-07 | When the import starts (inv-pub Q13) | confirm copy "Importing starts as soon as you confirm" vs paid-only | **Link at confirm, import after entitlement.** The run is created as `WAITING_FOR_MEMBERSHIP` and released by the entitlement fan-out. Copy on confirm and activating changes (§4.3, §4.7). |
| D4-08 | The "480 games, last 12 months" figure at lookup (Q13) | needs 12 archive calls at lookup time | Lookup and confirm show the **all-time rated total** from Chess.com stats ("480 rated games"). The 12-month total arrives with the import's reading phase. Owner confirms the copy (§14 OD-3). |
| D4-09 | Import window and analysis volume (allocation P4 owner decision 1; feasibility F-OCI-3) | all time vs 12 months + newest 2,000; feasibility: 200 eager analyses per sign-up saturate the prod worker at ≈ 20 sign-ups a day | **Window: the last 12 months of rated games, capped at the newest 2,000 per account** (`IMPORT_WINDOW_MONTHS=12`, `IMPORT_MAX_GAMES=2000`). **Analysis budget per member (across both providers): at most 200 imported games are analysed without being opened** (`IMPORT_ANALYSE_CAP=200`). Trialists: the newest game at `USER_OPENED`, the next 19 at `IMPORT_NEWEST` (`IMPORT_ANALYSE_EAGER_TRIAL=20`), nothing else until the first paid charge. Paying members (trial used, or after the first charge): the newest 50 eagerly (`IMPORT_ANALYSE_EAGER=50`), then the backlog up to the cap at `BACKLOG` in **seven daily slices** that run at the member's daily-sync hour (`IMPORT_BACKLOG_SPREAD_DAYS=7`, §8.9). Everything else is analysed when opened (`POST /api/review/:ref/analyse`, P3 A3). Owner can change all constants (§14 OD-1). |
| D4-10 | Chess.com ownership (inv-acct Q18, data-model O10) | verify now vs later | **Unverified links are allowed and may coexist.** The partial unique index `linked_accounts_verified_key` already allows one *verified* owner. P4 ships no verification UI (no board); a verified link elsewhere returns `409 conflict {reason: linked_elsewhere}`. Unverified Chess.com handles are written to the trial ledger but **not** used to deny a trial (a squatter could otherwise burn a real owner's trial). Lichess handles are verified by OAuth and are enforced. |
| D4-11 | What M4 creates | data-model puts `TrialLedger`, `AuditLog` and the billing columns in M1; allocation P1 M1 is only `RateLimitBucket` + `WebhookEvent`; consistency R-03/R-04/R-01 assign `User.timeZone`, `AuditLog` and `GamePlayer.linkedAccountId` to M4 | **M4 creates** `TrialLedger` (data-model shape, backfill B9), **`AuditLog` + `AuditCategory` + `AuditActor`** (data-model §5.1 verbatim; P4 is the first writer, R-04; `WEB/lib/audit.ts` moves to P4), **`User.timeZone`** (`String @default("UTC") @db.VarChar(64)`, column `"timeZone"`; P4 is the first reader, R-03), **`GamePlayer.linkedAccountId`** (FK `NOT VALID`, validated in `m4v`, R-01), and the billing columns P4 writes (`trialOfferedAt`, `pendingCheckout*`, `lastCheckoutSource`, `membershipEndedAt`, `lastPaymentFailedAt`, `lastPaymentFailureReason`; `ADD COLUMN IF NOT EXISTS`, P10 no longer re-declares them, consistency 10.3). The billing compare-and-set column `subscriptionSourceAt` belongs to **P1 F4b** (api-perf AP-06), not to M4. |
| D4-12 | Lichess resume cursor | data-model `lichessSinceMs` only | Adds `ImportCursor.lichessResumeUntilMs` because the export streams newest first: a run that fails half-way must resume with `until`, not `since` (§8.7). |
| D4-13 | Post-onboarding landing | — | `redirect_url` (kept in the `rc_onb_next` cookie) or **`/games`** until P5 swaps in `/home` (allocation). |
| D4-14 | "Play your first legend position" on Done and the legend aside | the CTA targets P8's legend practice | Rendered only if `getFeaturedPositionByFen(KT_FEN)` resolves to a legacy `/position/[ref]` the member can open; otherwise hidden (allocation §1.2: later-phase slots are not rendered). P8 retargets it to `/legends/positions/kasparov-topalov-1999`. The aside board itself is static and always shown. |
| D4-15 | Where onboarding state is written | inv-pub: a PATCH per step, plus separate link POST | One `PATCH /api/me/onboarding` per step, **except** two writes folded into the call that already happens: `POST /api/accounts/chesscom {context: "onboarding"}` advances the step to `LEVEL` and stores the band suggestion in the same transaction; `POST /api/checkout {source: "onboarding"}` sets `ACTIVATING` in the same `UPDATE` that records `pendingCheckout*`. |
| D4-16 | Claim lag after completion | after `complete`, middleware still sees `md.onboarded=false` until the JWT refreshes; P1 defers the onboarding gate and `rc_act` to P4 (`phase-01.md:129`) | `PATCH {complete:true}` **awaits** P1's `syncClerkClaims(user.id)` (it recomputes `RcPublicMetadata` from the DB, which now says `onboarded`) under `AbortSignal.timeout(3000)`, and sets a 120 s HMAC cookie `rc_onb` that middleware honours. P4 also builds `rc_act` (entitlement) the same way. This prevents an `/games` ↔ `/onboarding` bounce. |
| D4-17 | Settings connected page before P10 | P10 owns the settings shell | `/settings/connected` ships as a **standalone page in the app shell** (no section list, which would be dead links). It uses the panel design from `V4SettingsConnected` on desktop and the `on_connected` detail pane of the P10 device boards on phones and tablets. P10 moves it into the shell unchanged. |
| D4-18 | Two-phase import | — | Each run first **reads** (fetches and parses everything in the window into memory, ≤ 2,000 games ≈ 3 MB), so the total is known after seconds, then **saves** newest first in 100-game statements. The one exception is the newest chunk, saved as soon as it is parsed (D4-28). Progress carries `phase: "reading" \| "saving"`. |
| D4-19 | E2E against third parties | testing critique: the hosted checkout is only proven by hand | A local upstream mock (`WEB/e2e/mocks/upstream-server.ts`) stands in for Chess.com, Lichess OAuth, the Lichess export **and the Dodo REST API** (`DODO_API_BASE_URL`, test builds only), so CI is hermetic; Dodo events arrive as signed test webhooks. One real Dodo hosted-checkout spec (`@dodo-hosted`) runs **nightly** against the dev URL with `retries: 2` and may be quarantined (testing X14); it is the only automated proof that the real return URL and webhook fire. |
| D4-20 | Lichess OAuth client id | inv-pub `playchess.tech` | `LICHESS_CLIENT_ID=replay-chess-dev` on dev, `playchess.tech` on production (P13). No scopes (R-LI-04). |
| D4-21 | Lichess token at rest (feasibility F-API-3, SEC-6; consistency R-09 `LINK_TOKEN_KEYS`) | data-model §5.5 stores `accessTokenEnc` (AES-GCM); architecture App. A `TOKEN_ENC_KEY`; feasibility: use once and revoke, or seal it | **No token is stored.** The callback exchanges the code, reads `/api/account` (the ownership proof), and revokes the token with `DELETE /api/token` before it responds. Every import runs anonymously (20 games/s; 2,000 games ≈ 100 s of reading, offset by D4-28). This removes `LINK_TOKEN_KEYS`, the token columns, the global `omit`, key rotation, the token reader modules, the 401 path and P10's `lichess_revoke` step. Rejected variant: "use the token for the initial import, then revoke": the initial run can wait up to 30 days for a trial, so the token would sit at rest exactly when it is least needed. |
| D4-22 | Column names on `games` / `game_players` (consistency R-01) | the first draft used data-model names (`playedAt`, `finalFen`, `endReason GameEndReason`, `outcome GameOutcome`, `whiteUserId`, `GamePlayer.rating`); api-perf §1 prefers a `playedAt` index | **P2's shipped M2 names win** (first phase that ships a thing fixes its name): `games."completedAt"`, `fen`, `"endMethod" "GameEndMethod"` (+ `OTHER`), `outcome "GameWinner"` (`WHITE \| BLACK \| DRAW`), `"whitePlayerId"` / `"blackPlayerId"`, `"expiresAt" = "completedAt"`; `game_players."endedAt"`, `"ratingBefore"`, `"opponentName"`, `"opponentRating"`, PK `("gameId", "userId")` + unique `("gameId", color)`; archive index `game_players_userId_endedAt_gameId_idx`. Wire DTOs may keep `playedAt` (P3 contracts). §2.3 lists the columns M2/M3 must have created and the safety net if they did not. |
| D4-23 | Chess.com lookups from Vercel's shared IPs (feasibility F-API-1) | web-only lookups | **Web first, worker fallback**: on an upstream 429 or 403 the web route asks the worker (`POST /internal/provider/chesscom/lookup`, through the worker's one-at-a-time gate, one IP and one User-Agent). Both sides cache 600 s. Metric `import.lookup_source{web\|worker}`. The confirm step's newest-month archive call uses the same fallback. |
| D4-24 | Internal service auth (critiques disagree: consistency R-08 keeps `x-internal-token` + `INTERNAL_API_SECRET`; api-perf AP-44 and feasibility SEC-4 want HMAC from P2/P3) | — | **P4 is scheme-neutral.** Every internal hop P4 adds (web → worker kick and lookup, web/worker → socket emit) goes through `internalFetch()` / `verifyInternal()` in `CT/internal/auth.ts` (P2/P3, `phase-03.md:1321`). P4 code never names a header or a secret. Whichever scheme that helper ships is P4's, and an HMAC upgrade lands there for every hop at once. P4 adds its events to the per-caller emit allow-list (AP-44): the worker may emit `import:*` and `games:changed`; the web emits `entitlement:changed`. |
| D4-25 | Wire enum casing (consistency R-17) | the first draft sent `step: "WELCOME"`, `ratingBand: "R800_1200"`, `goals: ["STOP_BLUNDERING"]` | **Lowercase wire enums** in request and response bodies (`"welcome"`, `"r800_1200"`, `"stop_blundering"`); Postgres keeps the uppercase enum. `CT/http/onboarding.ts` exports `toWire()` / `fromWire()` maps with a round-trip unit test. Job payloads (internal) keep the DB spelling. |
| D4-26 | Chess.com avatars (feasibility F-API-4) | the boards show avatars; Chess.com's User Agreement review (OD-2) is pending | **Initials only** until OD-2 clears in the P13 preflight. `avatarUrl` is stored, never rendered; `images.chesscomfiles.com` is **not** added to `next.config.js images.remotePatterns` or the CSP `img-src`. One constant `PROVIDER_AVATARS_ENABLED = false` in `WEB/lib/accounts/avatars.ts` flips it later. |
| D4-27 | Daily-sync wakes (feasibility R-3 / F-NEON-2; api-perf AP-08) | first draft required P3's idle sleep "≥ 6 h"; feasibility proposes per-hour jobs from a `DAILY_PLAN` | **Next-due wake, per-account rows.** Each account keeps its one reusable `import:<id>` job row with `runAt` snapped to `HH:05` UTC (§8.10). The worker sleeps until `min("runAt")` (AP-08 / F-NEON-2, read in the same round trip as the drain's last write), so all of an hour's syncs share one Neon wake. No hourly tick and no per-hour grouping job: rows with the same `runAt` already give one wake per hour, and the per-account row keeps the dedupe and one-active-run guarantees. The lost-row backstop sweep runs as a step of P3's daily `HOUSEKEEPING` (or `DAILY_PLAN`), never on its own timer. |
| D4-28 | Time to the first review | two-phase import (D4-18) holds every save until reading ends; anonymous Lichess reading of 2,000 games takes ≈ 100 s | **The newest chunk is saved early.** As soon as the first 100 candidates (newest first) are parsed, the worker saves them in one statement, which queues the newest game's analysis; reading then continues and the rest saves as in D4-18. The Done card shows `imported` growing during `phase = reading`. |
| D4-29 | Who sets cookies | first draft set `rc_onb_next` from the resolver page and `rc_act` inside `getActivation()` | **Only middleware and route handlers set cookies** (App Router server components cannot; the same class of bug as api-perf AP-14). Middleware sets `rc_onb_next` when it redirects to `/onboarding?redirect_url=…` or sees that query on `/onboarding`; `rc_act` is set only by `GET /api/billing/activation`, `rc_onb` only by `PATCH /api/me/onboarding`. |
| D4-30 | `games.pgn` for imports (feasibility F-NEON-4) | P2 stores `pgn` with `%clk` for platform games | **`pgn` stays NULL for imported games**; exports rebuild it from `moves` + `moveClocksMs`. Storage figures in §6.8 already exclude it. |
| D4-31 | Re-kicks from status GETs (api-perf AP-09) | first draft kicked from `GET /api/import/status` with a module-scope map (per instance, so not a real limit on Fluid compute) | **GETs never enqueue**; a stale `QUEUED` run is re-kicked through P3's compare-and-set on `jobs."lastKickAt"` (at most one kick per job per 30 s across all instances and tabs), registered as the allowed GET side effect `kick_cas`. |

---

## 1. Goal and user-visible outcome

**Goal.** Import Chess.com and Lichess games into the P3 analysis pipeline, and rebuild onboarding through the trial checkout and its activation, with connected accounts that can sync and unlink.

**What a user sees at the end of P4**

- A new user is taken through eight short screens in under two minutes, on every device and at 80–150 % zoom, without the page ever scrolling.
- Their Chess.com username is checked live; Lichess is linked through Lichess's own consent screen.
- After the card step, the activating screen flips to "Your free trial has started." in about a second (socket) or a few seconds (poll), and the Done screen counts the import up ("Importing games 212 / 480").
- `/games` fills with imported games while they watch, with per-source tabs. The newest game has a full review within about a minute of the import starting; during the trial the 20 newest are reviewed automatically and any other game is reviewed when opened.
- Settings › Connected accounts shows each link (initials, no provider avatars until the terms review, D4-26), its last sync, a manual sync with a countdown when limited, the daily import switch, the error and rate-limit states, and disconnect with an option to delete the imported games.
- Linking Lichess leaves no token behind: lichess.org › Preferences › Security lists no Replay Chess session after the callback (D4-21).
- Returning to `/onboarding` at any time resumes where they stopped; members are sent past it.

### 1.1 Owner test script (dev site, ego-browser; Dodo dashboard in Claude in Chrome)

Site: `https://replay-chess-dev-replaychess007-1069.vercel.app` (the URL in CLAUDE.md's environments table; testing X15). Socket: `wss://ws-dev.80-225-200-210.sslip.io`. Flags `onboarding-v3` and `import-v3` on for the owner and E2E users. If P1 turned on Vercel Authentication for `replay-chess-dev` (feasibility SEC-3), the Dodo test-mode webhook URL carries `?x-vercel-protection-bypass=<secret>` and the owner is signed in to Vercel in ego-browser. Each row's result and screenshot path go into `REPO/docs/qa/phase-04-signoff.md` (§12.8).

| # | Step | Expected |
|---|---|---|
| 1 | Sign up a fresh Clerk dev user (`replaychess007+onb1@gmail.com`) through the existing `/sign-in` page | Lands on `/onboarding/welcome`: "Welcome, <first name>.", four numbered items with time hints, "04 Start your free trial · 7 DAYS FREE" |
| 2 | Get Started → type `knightowl88xx` → Look Up Profile | "We couldn't find "knightowl88xx" on Chess.com. …"; input marked invalid |
| 3 | Type `hikaru` → Enter | Button reads "Looking up…", then "Found Hikaru · {time class with the most games} 3xxx · NN,NNN rated games"; Continue enabled |
| 4 | Press Look Up 10 more times within a minute | "Chess.com is limiting lookups right now. Try again in 0:30." with a live countdown; button disabled until 0:00 |
| 5 | Continue | `/onboarding/confirm?provider=chesscom&u=hikaru`: skeleton, then the profile card, four ratings, "Rated games N" and the five most recent games |
| 6 | That's Me | `/onboarding/level` with "2000+" checked and "From Chess.com: {time class} 3xxx. We picked the band for you …" |
| 7 | Continue → Goals: untoggle both chips | "Pick at least one goal to continue.", Continue disabled, aside "Choose a goal to see a sample day." |
| 8 | Pick Stop blundering + Learn openings, 20 min → Continue | `/onboarding/plan`, monthly preselected, "$4.99 / month", "Then $4.99/month. Cancel before <date+7> and you won't be charged." |
| 9 | Toggle Yearly | "$50 / year", "About $4.17 a month", URL `?plan=yearly` |
| 10 | Start 7-day free trial | Button "Opening secure checkout…", then Dodo test checkout (card 4242 4242 4242 4242, any future date, any CVC) |
| 11 | Pay | Back on `/onboarding/activating`: "Starting your trial…" with the indeterminate bar, then "Your free trial has started." (typically ≤ 3 s); the import card switches from "Waiting for your trial to start" to "Importing games …" |
| 12 | Repeat 1–11 with a second fresh user, but block `ws-dev.80-225-200-210.sslip.io` in DevTools › Network request blocking before paying | Success still arrives through the poll (≤ 15 s). With the webhook delayed (Dodo dashboard: pause the dev endpoint), "Still activating" appears at 12 s; Check Again works after the webhook is resumed |
| 13 | Continue | `/onboarding/done`: "Trial · 7 days left", "Importing games 212 / 2,000 · About N minutes left." |
| 14 | Go to Home | `/games` (until P5). The list grows without a reload; the Chess.com tab count rises; the banner "IMPORTING 640 / 2,000 Chess.com" is shown until the run ends |
| 15 | Wait ≤ 2 min, open the newest game | The P3 review is ready (or shows "Analysing · n of m" and completes) |
| 15b | Open the 25th newest imported game | Its review is not queued yet (trialist budget, D4-09); opening it starts the analysis (P3 `none` → `queued`) |
| 16 | Account menu › Connected accounts | `/settings/connected`: Chess.com card with initials (no avatar image, D4-26), "Linked" (or "Syncing" with "IMPORTING n / N"); Lichess card "Not linked" |
| 17 | Sync now, then Sync now again | First: "Syncing…", toast "Sync finished · N new games". Second within 30 s: "Chess.com is limiting requests. You can sync again in 0:2x." |
| 18 | Toggle "Import new games every day", reload | The switch keeps its value; the hint shows "About 3 a.m. your time" |
| 19 | Connect Lichess → approve on lichess.org with the owner's Lichess account | Back on `/settings/connected`, toast "Lichess linked · importing N games", Lichess card "Linked", then both cards linked (`both_linked`). On lichess.org › Preferences › Security, no Replay Chess token is listed (revoked in the callback, D4-21) |
| 20 | Disconnect Lichess, Connect again, click Cancel on lichess.org | "Lichess sign-in was cancelled, so nothing was linked. You can try again." |
| 21 | `/dev/import` › "Chess.com: fail with 5xx for 5 min" → Sync now | Pill "Sync failed", banner "Chess.com didn't respond. Your N imported games are safe; the last good sync was N minutes ago." [Try again] |
| 22 | Disconnect Chess.com with "Also delete the N imported games and their reviews" ticked | Toast "Chess.com disconnected. Imported games are being removed."; within a minute the `/games` Chess.com tab shows 0 and its empty state |
| 23 | Sign in as the leased pool user reset to persona `onboarding-trial-used` (`personas.ts --reset <pool user> --persona onboarding-trial-used`; shared user Q stays read-only, testing X4) and open `/onboarding/plan` | "Start your membership.", CTA "Start Coaching", note "Your free trial has been used. Billing starts today.", no "Day 8" row; Welcome item 04 reads "Start your membership" |
| 24 | Sign in as member A, open `/onboarding` | Redirected to `/games` |
| 25 | As a third fresh user, go to `/pricing` and start the trial there | Dodo returns to `/checkout/activating?redirect_url=/pricing…`: polling → "Your free trial has started." with a 3-second countdown (paused while the card has focus) → the destination |
| 26 | Repeat steps 1–6 and 13–14 on a real iPhone and a real Android phone; spot-check iPad portrait | No page scroll; the primary button is above the home indicator; the back arrow moves one step back |
| 27 | Keyboard only (no mouse) from Welcome to Plan on desktop at 125 % | Enter submits every step, Alt+← goes back, focus lands on each step's h1, the focus ring is visible on every control |
| 28 | Close every ego-browser page opened for the script (`task.finish({ keep: [] })`) | No tabs left open |

---

## 2. Scope

### 2.1 In scope

1. **Schema m4a + M4 + m4v** (§6): `LinkedAccount`, `ImportCursor`, `ImportRun`, `TrialLedger`, `AuditLog` (+ its two enums), `User` onboarding columns, `User.timeZone`, the billing columns P4 writes, `GamePlayer.linkedAccountId` (FK validated in m4v), partial indexes, backfills B5, B6, B9, B12, P4 personas for the lease pool.
2. **`packages/chess-import`** (§8.6–8.7): Chess.com and Lichess clients (serial, ETag, User-Agent with contact, base URL injectable, anonymous), PGN/NDJSON parsing, mapping to P2's `Game` + `GamePlayer` columns (D4-22), fixtures, the provider canary script.
3. **Web API** (§7): accounts (lookup with worker fallback, link, list, sync, auto-import, unlink), Lichess OAuth PKCE start/callback (ownership proof, token revoked at once), import status and retry, onboarding PATCH (incl. `timeZone`), billing activation, checkout changes, `/api/me` additions, Dodo webhook fan-out (`entitlement:changed`, release of waiting imports, release of the analysis backlog after the first paid charge, trial ledger, `membershipEndedAt`), the `audit()` helper.
4. **Worker** (§7.7, §8): `IMPORT_SYNC` and `IMPORT_PURGE` handlers on a new I/O lane, provider gates, two-phase import with an early first chunk, batched writes, analysis enqueue within the per-member budget, progress events, daily auto-sync scheduling, the internal Chess.com lookup endpoint, dev fault injection.
5. **Realtime** (§7.6): payload schemas for `import:progress`, `import:finished`, `import:failed`, `entitlement:changed`, and `games:changed` from imports, registered in P2's `CT/socket/registry.ts` and sent through `POST /internal/emit` with P2's body (`{v:1, targets, event, data, dedupeKey?}`).
6. **UI** (§4): onboarding v3 (8 routes + resolver), `/checkout/activating`, `/settings/connected`, the shared `ActivationCard` and `ImportProgressCard`, the account-menu entry, the P3 archive slots (source tabs, `import_running` banner, per-source empty tabs), dev demo routes `/dev/ui/onboarding` and `/dev/import`.
7. **Tests that gate the phase** (§12): unit, integration, contract, e2e on leased personas, device × zoom, axe, visual baselines, telemetry assertions, the provider canary in `nightly.yml`, and the sign-off record.
8. **Removal** of the legacy onboarding page and the three legacy endpoints once the parity check passes (§3, §15), as one revertible commit.

### 2.2 Out of scope (and who owns it)

| Item | Owner |
|---|---|
| Home `import_running` card and the first-review card on Home | P5 (lights up from `qk.imports()` built here) |
| Weakness Profile use of imported games | P6 |
| Chess.com ownership verification UI (profile-location code) and take-over | Not designed; schema ready (`verifyCode`, `verifiedAt`). Owner decision OD-4 |
| Settings shell, section list and summaries | P10 (adopts `/settings/connected`) |
| Account deletion cascade into the import purge | P10 (`ACCOUNT_PURGE` reuses `IMPORT_PURGE`; there is no Lichess token to revoke after D4-21, so P10 drops `AccountDeletion.lichessTokenEnc` and its `lichess_revoke` step) |
| v3 auth screens (sign-up, verify) | P11; P4 starts from the current Clerk `/sign-in` page |
| v3 pricing page, paywall, renew sheet | P11; P4 only changes the pricing page's return path and removes its activation poll |
| Trial-started confirmation email and the trial-ending reminder | **P10** (`NotificationKind.TRIAL_ENDING`, a `NOTIFY_DISPATCH` job at `trialEndsAt − 48 h`, Resend setup; consistency 10.17 and 13.6). P4 builds no email and omits the "Confirmation sent to …" line |
| Rating seeds for Glicko from linked ratings | P9 (reads `LinkedAccount.ratings`) |
| PGN file upload, variants (chess960, crazyhouse, …), unrated games, other sites | Not designed; variants and unrated games are skipped and counted |
| Production Lichess client id, prod webhook endpoints, prod migration | P13 |

### 2.3 Dependencies on earlier phases

| From | What P4 uses | Where |
|---|---|---|
| P1 1A | UI kit (`components/ui/*`: Button, IconButton, Spinner, Field, Card, Chip, Segmented, Tag, Banner, Skeleton/SkeletonRegion, ProgressBar, Avatar, Switch/SwitchRow, Checkbox/CheckboxRow, Divider, PageHeader, toast `notify`), shell (`AppShellView`, `AccountMenu`, `ViewportStage`, `ScrollRegion`), lock scroll mode, `/dev/ui` gallery, `playwright.devices.config.ts` (8 devices × 80/100/110/125/150 %) | SPEC §2.2–2.3, §3.5, §10 |
| P1 1B | `route()` wrapper (`WEB/lib/api/route.ts`) with `ctx.now` (honours `x-rc-now` only under `isNonProd()` + `x-e2e-token`, testing X5), `CT/http/{envelope,codes,cursor,me}.ts` (`ERROR_STATUS`, `SUBSCRIPTION_REASONS`, `CONFLICT_REASONS`), `api()` client (header `x-rc-build`, schema parse in dev/test only, transparent 304s; api-perf AP-12/AP-21) + `qk`, `QueryProvider` global error reactions, `getViewer()` (`WEB/lib/auth/viewer.ts`), `requireMember()` 402 with `reason`, `GET /api/me`, Clerk webhook + `syncClerkClaims(userId)`, middleware public allow-list with claim gating (**the onboarding rule, `rc_act` and `rc_onb` are P4's**, `phase-01.md:129`), `WebhookEvent` dedupe in the Dodo webhook, **the billing compare-and-set in F4b** (`subscriptionSourceAt`, conditional `UPDATE … IS DISTINCT FROM`, provider event time for API snapshots; api-perf AP-06), Postgres fixed-window rate limiter (`route({rateLimit: {bucket, limit, windowSec, by, store}})`, consistency R-13), flags (`WEB/lib/flags.ts`, `useFlag()`), `lib/env.ts` (`isNonProd()`, `testHooksEnabled()`), the test-hook registry `WEB/lib/test-hooks/registry.ts` (X12), the analytics event registry `packages/analytics/src/events/*` with the client and server telemetry sinks (X6), the persona lease pool and sweeper (X4), `toHaveScreenshot` tooling (X10), the state-coverage manifest (X8), `nightly.yml` and `post-deploy-dev.yml` (X2), `RetryCountdown`, `SessionExpiredModal`, `/api/cron/daily` | allocation P1 F1–F8; testing X1–X18 |
| P1 owner tasks | The separate Neon dev project (api-perf AP-01, feasibility F-NEON-1, testing X16). P4's k6 runs, the real large-account import and the import fixtures run only against it, never against the production project's compute allowance. Phase specs name "the Neon dev branch (CLAUDE.md environments table)", not branch ids (consistency R-20) | AP-01 |
| P2 | `GamePlayer` (`gameId`, `userId`, `color`, `mode`, `timeClass`, `rated`, `result`, `endedAt`, `opponentName`, `opponentRating`, `ratingBefore`, PK `(gameId, userId)` + unique `(gameId, color)`, index `(userId, endedAt DESC, gameId DESC)`), `Game` typed play columns (`whitePlayerId`, `blackPlayerId`, `moves`, `moveClocksMs`, `plyCount`, `startPly`, `fen`, `outcome GameWinner`, `endMethod GameEndMethod`, `pgn`), the M2 additions consistency R-01 assigns to P2 (below), `POST /internal/emit` with body `{v:1, targets: ({room}\|{userRef})[] ≤ 50, event, data, dedupeKey?}` + the `user:{ref}` room, `ROOM` builders in `CT/socket/rooms.ts`, the only server→client registry `CT/socket/registry.ts`, socket token with `ent` claim issued to signed-in non-members, `RealtimeConnection` / `RealtimeBoot` / `UserChannel` / `fallbackInterval()` (start time kept in `query.meta`, api-perf AP-20) | allocation P2, B1–B4, B20; `phase-02.md:855-941` |
| P3 | `Job` table (with `fairSeq` and, per AP-09, `lastKickAt`) and claim loop, `JOB_PRIORITY` + `enqueueAnalysis()` in `DB/src/jobs.ts`, `kickWorker()` and `kickIfStale(dedupeKey)` (`WEB/lib/jobs/kick.ts` → worker `POST /internal/analysis/kick`), next-due sleep (`min("runAt")`, AP-08 / F-NEON-2), daily `HOUSEKEEPING`, `ANALYZE_GAME` with `dedupeKey analyze:<gameId>` and the `evalHint` input, `Game.analysisStatus`, `GamePlayer.accuracy/momentsCount/headline`, `analysis:done` for jobs with priority ≥ 80 and the coalesced `analysis:batch` for lower bands (AP-10), `/review/[ref]`, `/games` + `GET /api/me/games` with per-source facets, the M3 columns R-01 assigns to P3 (below) | allocation P3; `phase-03.md` §6–7 |

**Preconditions from M2 and M3 (consistency R-01).** WP-A's first task checks `information_schema` and `pg_enum` on a fresh local `migrate deploy`. Every row should already exist; any row that does not is added by P4's safety files (`m4a` for enum values, M4 for columns, all `IF NOT EXISTS`), and the gap is reported to the P2/P3 owner. When a safety line really creates a column, WP-A also declares the field once in the owning Prisma model block, so `check-drift.ts` stays clean and no field is declared twice.

| Object | Owner | P4 reads / writes | Safety net if absent |
|---|---|---|---|
| `enum GameSource { REPLAY CHESSCOM LICHESS }`; `games.source GameSource @default(REPLAY)`; `game_players.source` | M2 (P2) | writes `CHESSCOM` / `LICHESS` | **none**: an enum type cannot be created idempotently in Prisma's flow; P4 blocks until P2 ships it |
| `games."externalId" VarChar(40)?`, `"externalUrl" VarChar(120)?`, unique `games_source_externalId_key (source, "externalId")` | M2 (P2) | conflict arbiter of the batch writer | M4 `ADD COLUMN IF NOT EXISTS` + `CREATE UNIQUE INDEX IF NOT EXISTS` (no-ops when M2 has them) |
| `games."whiteName"`, `"blackName"` `VarChar(40)?`; `"whiteRating"`, `"blackRating"` `SmallInt?`; `"whiteTitle"`, `"blackTitle"` `VarChar(4)?` | M2 (P2) | writes | M4 `ADD COLUMN IF NOT EXISTS` |
| `GameMode.IMPORTED`, `GameEndMethod.OTHER` | M2 (P2) | writes | `m4a` `ALTER TYPE … ADD VALUE IF NOT EXISTS` |
| `games."ecoCode" VarChar(3)?`, `"openingName" VarChar(80)?`, `game_players."ecoCode" VarChar(3)?`, `games."analysisStatus"` | M3 (P3) | writes | M4 `ADD COLUMN IF NOT EXISTS` (except `analysisStatus`, which P4 cannot do without P3) |
| `jobs."fairSeq" Int @default(0)`, `jobs."lastKickAt" TIMESTAMP(3)?` | M3 (P3; R-05, AP-09) | writes `fairSeq = rank`; the kick CAS | M4 `ADD COLUMN IF NOT EXISTS` |
| `users."gamesVersion" Int @default(0)` (archive ETag, AP-19) | M3 (P3) | bumped in the import chunk and the purge | M4 `ADD COLUMN IF NOT EXISTS` |

---

## 3. Current code touched

Line numbers are from `dev` @ `0848b76`. "P1"/"P2"/"P3" marks code that an earlier phase already reworked; P4 edits the reworked version.

| File (lines) | Today | Fate in P4 |
|---|---|---|
| `WEB/app/onboarding/page.tsx` (1–730) | One client page: plan first (`:31`, `:90`), Chess.com second, own activation poll via `waitForEntitlement` (`:140-160`), three hand-written POSTs (`:184`, `:213`, `:245`), default plan **yearly** (`:91-93`), destination `/play` (`:40`), `motion` everywhere | **Replace.** Becomes the server resolver (`WEB/app/onboarding/page.tsx`, ~40 lines). The old component moves to `WEB/app/onboarding/_legacy/LegacyOnboarding.tsx` and is rendered only while `onboarding-v3` is off; deleted at DoD (§15). |
| `WEB/app/onboarding/layout.tsx` (1–13) | Metadata only (`noIndex`) | **Rework.** Server layout: `getViewer()`, guards, `OnboardingShell`, `RealtimeBoot` with a minted token, `HydrationBoundary(qk.me)`. Keeps `noIndex`. |
| `WEB/app/api/user/chess-com-profile/preview/route.ts` (1–55) | Unrate-limited, uncached lookup; 2 parallel Chess.com calls via `lib/chess-com.ts:52-55`; leaks `error.message` (`:46-47`) | **Remove** (replaced by `POST /api/accounts/chesscom/lookup`). Kept while the flag is off; deleted at DoD. |
| `WEB/app/api/user/chess-com-profile/route.ts` (1–165) | Upsert `ChessComProfile` + `onboarded = true` in one tx (`:108-121`, G10); parallel upstream calls (`:49-52`); P2002 message leaked as 400 (`:156-158`, F-12); no ownership check (F-27) | **Remove** (replaced by `POST /api/accounts/chesscom`). Its dual-write of `ChessComProfile` moves into `WEB/lib/accounts/link-service.ts` **without** the `onboarded` write. |
| `WEB/app/api/user/onboarding-skip/route.ts` (1–46) | Marks onboarded without a plan (2 round trips) | **Remove** (paid-only: the plan cannot be skipped). |
| `WEB/lib/chess-com.ts` (1–81) | `fetchChessComProfile/Stats/Preview`; no `encodeURIComponent` (`:13`, `:33`), no timeout, UA `"ReplayChess/1.0"` without contact (`:7`), `Promise.all` (`:52`, R-CC-02) | **Replace** by `CI/src/chesscom/client.ts` (shared with the worker) and `WEB/lib/accounts/chesscom.ts` (web-side caching wrapper). Delete after the last importer goes. |
| `WEB/lib/types/chess-com.ts` | API types for the above | **Move** to `CI/src/chesscom/types.ts`. |
| `WEB/app/components/ChessComPreviewCard.tsx` (231) | Preview card used by onboarding and the profile modal | **Remove** (replaced by `WEB/components/onboarding/ProfilePreviewCard.tsx`). |
| `WEB/app/profile/[referenceId]/ChessComConnectModal.tsx` (306; POSTs at `:61`, `:94`) | Profile "connect" modal | **Remove.** The own-profile CTA (`WEB/app/profile/[referenceId]/page.tsx:214`) becomes a link to `/settings/connected`. |
| `WEB/app/profile/[referenceId]/ChessComRatings.tsx` (117) | Dead (audit-quality, 0 importers) | **Delete.** |
| `WEB/app/profile/[referenceId]/ProfileHero.tsx:180-210`, `WEB/app/api/profile/[referenceId]/route.ts:29,123-134` | Read `ChessComProfile` ratings and handle | **Keep** (dual-write keeps the row fresh until P10's profile rebuild reads `LinkedAccount`). |
| `WEB/app/api/profile/[referenceId]/route.ts:41-56` | "Last 20 completed games where user is creator OR opponent" (`status: "COMPLETED", OR: [{creatorId}, {opponentId}]`) | **Edit (one line)**: add `source: "REPLAY"` to the `where`. Imported games are `COMPLETED` with `creatorId` = the importing member (§8.8), so without the filter the legacy profile would list them as games against nobody. P10's profile rebuild reads `game_players` and drops the line. |
| `WEB/lib/services/matchmaking/matchmaking.service.ts:31,57`, `WEB/app/api/chess/create-ai-game/route.ts:30-61` | Ratings from `ChessComProfile` | **Keep** until P9 (dual-write). |
| `WEB/app/api/checkout/route.ts` (1–179) | Body `{plan, returnPath, theme}` (`:15-19`); email from `currentUser()` (`:50-63`); trial from `isTrialEligible` (`:94-98`); live `subscriptions.list` on every checkout with a customer (`:99-141`); returns `{checkoutUrl, sessionId, trial}` (`:166-170`); raw error message on 500 (`:175-177`) | **Rework** on the route wrapper: `source`, `Idempotency-Key`, email from the DB row, trial claim through `trialOfferedAt` + ledger, session reuse (< 30 min, same plan), live guard only when the DB shows a non-terminal subscription, return URL by source, `chargeDate`/`priceCents`/`interval` in the response, `onboardingStep = ACTIVATING` for `source: onboarding`. |
| `WEB/lib/billing/return-url.ts:10-25,65-70` | Allow-list without `/checkout`, `/games`, `/review`, `/settings`, `/home`, `/train`, `/learn`; appends `checkout=success` | **Extend**: add those prefixes; new `buildActivationReturnUrl(source, returnPath, origin)` (§8.5). `buildReturnUrl` stays for the legacy pricing page until P11. |
| `WEB/lib/billing/trial-rules.ts:22-24` | `isTrialEligible({trialStartedAt, trialEndsAt, subscriptionId})` | **Extend**: `isTrialEligible(record, { ledgerHit })`. New sibling `WEB/lib/billing/trial-ledger.ts` (normalise, hash, check, write). |
| `WEB/lib/billing/client.ts:22-23,51-56,87-113` | `ACTIVATION_POLL_*`, `checkoutReturnPath()` through `/pricing`, `waitForEntitlement()` (3 copies of the poll, audit-client #217) | **Remove** the poll and constants; `checkoutReturnPath()` returns `/checkout/activating?redirect_url=…`. |
| `WEB/lib/billing/entitlement.ts:99-116` (P1 added `syncClerkClaims` and, in F4b, the compare-and-set) | Applies snapshots with P1's conditional `UPDATE … WHERE "subscriptionSourceAt" <= $eventTime AND ROW(…) IS DISTINCT FROM ROW(…)` | **Extend**: the post-apply hook `onEntitlementApplied()` (§8.5.4), called only when the CAS `RETURNING` produced a row: emit `entitlement:changed`, release waiting imports, release the analysis backlog after the first paid charge, write the trial ledger on the first trialing snapshot, set `membershipEndedAt` on entitled → not entitled. Runs in `after()`. P4 does not touch the CAS itself (api-perf AP-06). If F4b has not merged when P4 starts, WP-D stops and raises it: P4 does not build a second compare-and-set. |
| `WEB/app/api/webhook/dodo-payments/route.ts:36-71` (P1 added `WebhookEvent`) | Applies `subscription.*`, links customer on `payment.succeeded` | **Extend**: record `payment.failed` and `subscription.failed` keyed by `checkout_session_id`/`subscription_id` so activation can answer `failed` at once; duplicate-trial guard (§8.4.5). |
| `WEB/app/components/billing/useCheckout.ts` (1–80) | Hand `fetch`, no `source`, no idempotency | **Rework** into `WEB/lib/api/mutations/billing.ts#useStartCheckout`; `useCheckout` stays as a thin facade for the legacy pricing page. |
| `WEB/app/pricing/PricingContent.tsx:113-129` | Third copy of the activation poll | **Remove** the poll (returns now land on `/checkout/activating`). The rest of the page is P11's. |
| `WEB/lib/hooks/useRequireSubscription.ts:84-90` | Second copy of the poll | **Remove** the poll (if P1 did not). |
| `WEB/middleware.ts` (P1 rewrite of `:16-38`) | Public allow-list, claim gating | **Edit** (or, if P1 turned route classes into data, add `WEB/lib/routes/classes/onboarding.ts`; feasibility §7): the onboarding redirect rule (§8.1); `/onboarding(.*)`, `/checkout/activating`, `/settings/connected`, `/api/accounts/(.*)`, `/api/import/(.*)`, `/api/billing/activation` reachable by signed-in non-onboarded users; verify `rc_act` and `rc_onb` (D4-16); set `rc_onb_next` (D4-29). P8 edits the same file in the same weeks (feasibility §7), so the change is one block with an `OWNERS.yml` label. |
| `WEB/app/(app)/games/**` (P3) | Archive with `All` / `Replay Chess` | **Edit (lights up)**: `Chess.com` and `Lichess` tabs with counts, `import_running` banner, per-source empty tab copy. |
| `WEB/components/shell/AccountMenu.tsx` (P1) | Profile, membership, sign out | **Edit**: add "Connected accounts" (`/settings/connected`). |
| `WEB/e2e/fixtures/auth.ts:44-70` | Calls `/api/user/sync` and `/api/user/onboarding-skip` after sign-in | **Rework** (with P1 F4d's `GET /api/me` sign-in): no onboarding calls; users A–P are provisioned onboarded (below). |
| `WEB/e2e/fixtures/tournament-helpers.ts:40-56` | Calls the same two endpoints (`:46`, `:54`) | **Rework** the same way (testing X17); otherwise the tournament specs break when P4 deletes `onboarding-skip`. |
| `WEB/e2e/scripts/provision-test-users.ts:143` | Writes `onboarded: true` | **Extend**: also `onboardingStep = DONE`, `onboardedAt`, and Clerk `publicMetadata.onboarded = true` for A–R. **No `--fresh <letter>` mode**: shared letters are never reset (Q stays read-only, testing X4). Exact onboarding states come from P4's persona writers in the lease pool (`WEB/e2e/personas/p04.ts`, or P1's `scripts/dev/personas.ts --reset … --persona …`, §6.7). P8 also edits this file (feasibility §7), so P4 adds its own persona file instead of editing shared code. |
| `WS/**` (P2) | Generic `/internal/emit` with the registry in `CT/socket/registry.ts` | **No socket edits.** P4 adds payload schemas to `CT/socket/user.ts` and their lines to `CT/socket/registry.ts` (consistency R-07). |
| `WEB/next.config.js` | `images.remotePatterns` (P1 closed the open `hostname: "**"`) | **Edit**: `transpilePackages += "@repo/chess-import"` only. No Chess.com image host (D4-26). |
| `WK/src/**` (P3) | Engine lane, `ANALYZE_GAME` | **Extend** (§7.6): I/O lane, import handlers, provider clients, schedule, dev fault route. |
| `REPO/deploy/oci/docker-compose.yml` (P3 worker service) | Worker env | **Edit**: new env vars (§7.9). |
| `REPO/turbo.json` `globalEnv` | 13 names today | **Edit**: add P4 env names. |

---

## 4. Screens

### 4.0 Shared onboarding frame (`OnboardingShell`)

**Boards.** Desktop frame from `DR/V3Onb*.dc.html` (`.app`, `.oh`, `.stp`, `.ostage`, `.opanel`, `.obody`, `.ofoot`, `.oaside`). iPhone frame from `DR/V3iPhoneOnb*.dc.html` (back arrow, "Step N of 4 · Name", `.segs`, `.obody` region). iPad portrait from `DR/V3iPadOnb*.dc.html` (`.ocol`, h1 3.25 rem). Android 412×915 uses the iPhone layout (no Android boards on v3pub, inv-pub §3). iPad landscape 1194×834 and desktop 1280×800 use the desktop layout.

**Files.** `WEB/components/onboarding/OnboardingShell.tsx` (server), `OnbHeader.tsx` (desktop header with the stepper), `OnbMobileHeader.tsx` (back arrow, step label, segments), `OnbStepper.tsx`, `OnbFooter.tsx`, `onboarding.css` (the board's layout rules as CSS modules on the P1 tokens; no inline styles).

**Layout per device (one viewport).** The root is P1's lock mode (`data-rc-lock`): `height: 100dvh; overflow: hidden`. The page never scrolls; only `.obody` may scroll inside its own region, as a fallback at 150 % zoom on phones.

| Device (CSS viewport at 100 %) | Header | Body | Footer |
|---|---|---|---|
| Desktop 1440×900, 1280×800, iPad L 1194×834 | 64 px: logo (36 px) + "ReplayChess", stepper centred (`ol.stp`, 4 items, 28 px connectors), "Sign out" text button right | `.ostage` grid `minmax(0,460px) minmax(0,560px)`, `gap 64px`, `padding 32px 32px 24px`, centred both ways. Left: panel (eyebrow, serif h1 2.5 rem, body, controls). Right: aside (card or board) | `.ofoot` inside the panel: border-top, secondary action left (Skip / Back / Not Me), primary right (`min-height 48px`) |
| width ≤ 1100 (iPad L at ≥ 110 %, laptops at 125 %) | stepper words hidden (`.stp li .w`), numbers only | columns `minmax(0,440px) minmax(0,1fr)`, gap 36 | same |
| height ≤ 760 (1280×800 at 110 %, 1440×900 at 125 %) | — | `.tall` items hidden (time hints, aside captions, the plan timeline's "Every game" row), h1 2.125 rem, padding 20/32/16; aside board `width: max(200px, min(calc(100dvh - 220px), 40vw, 520px))` | — |
| height ≤ 640 (1440×900 at 150 %) | 48 px | padding 12/28/10, gaps 10, chips 36 px | — |
| iPad P 834×1194 | back arrow (44 px target), "Step N of 4 · Accounts", `.segs` (4 × 3 px bars, done = `--cb-ink`), "Sign out" | `.ocol` single column, padding 0 56 px, `justify-content: safe center`; h1 3.25 rem; aside below the panel as a card | pinned bottom, buttons side by side |
| Phones 393×852, 412×915 (and iPad P at ≥ 150 %, which falls under 600 px wide) | 56 px bar as iPad P; h1 2 rem | `.obody` is `flex: 1 1 auto; min-height: 0; overflow-y: auto` (the only scrollable region); aside content becomes a card at the end of the body or is dropped where the table says so | pinned, primary full width, `padding-bottom: max(16px, env(safe-area-inset-bottom))` (Android's 48 dp gesture bar) |

The step-to-stepper mapping is `WELCOME, LINK, CONFIRM → 1 Accounts`, `LEVEL → 2 Level`, `GOALS → 3 Goals`, `PLAN, ACTIVATING → 4 Plan`; on Done all four show as done. A done step shows a check in `.n` and is a link back to that step; the current one has `aria-current="step"`.

**Shared interactions.** Each step's controls sit in one `<form>`; **Enter submits the primary action** (the browser's default form submit, so it also works on mobile keyboards' Go key). **Alt+←** (and the mobile back arrow) goes to the previous step with `router.push`, never `history.back()` (deep links have no history). Browser Back works because every step is a route. "Sign out" runs P1's `signOutEverywhere()` with `redirectUrl: "/"` and fires `onb_signed_out`. The command palette and `?` sheet are not mounted (the onboarding frame is outside the app shell). Focus moves to the step's `h1` (`tabIndex=-1`) after each navigation (`useFocusOnRouteChange`).

**Shared states.** `loading.tsx` in `WEB/app/onboarding/` renders the frame with a `SkeletonRegion` in the panel (one layer only, client-data-layer §8.2 rule 4). Errors thrown during render go to `WEB/app/onboarding/error.tsx` (the `V3Error500` card inside the frame, Retry = `reset()` + `router.refresh()`). A mutation failure shows the toast "Couldn't save. We'll retry." and retries the idempotent PATCH (1 s, 3 s, 9 s); navigation is never blocked by it.

**Shared aside component.** `WEB/components/board/StaticBoard.tsx` (server component, FEN → inline SVG: 64 rects in the neutral board colours of `ChessBoard`, pieces as `<image>` from `public/chess-icons`, optional last-move squares, `role="img"` + `aria-label`; no JS, no chess.js). If P3 already built one for `/r/[slug]`, reuse it. The legend aside uses Kasparov–Topalov, Wijk aan Zee 1999, before 24.Rxd4: `b2r3r/k4p1p/p2q1np1/NppP4/3p1Q2/P4PPB/1PP4P/1K1RR3 w - - 1 24` (the FEN on `V3OnbWelcome`, `V3OnbActivating`, `V3OnbDone`).

### 4.1 Resolver `/onboarding` and Welcome `/onboarding/welcome`

**Boards.** D `DR/V3OnbWelcome.dc.html`, iPhone `DR/V3iPhoneOnbWelcome.dc.html`, iPad P `DR/V3iPadOnbWelcome.dc.html`. No state enum.

**Resolver** (`WEB/app/onboarding/page.tsx`, server, renders nothing). Runs `resolveOnboardingRoute(viewer, ctx.now)` (§8.1) and `redirect()`s. A safe `redirect_url` is kept in the cookie `rc_onb_next` (Path `/onboarding`, 24 h, `SameSite=Lax`, `HttpOnly`, value checked with `safeReturnPath`) so Done can forward there without client storage (client-data-layer D15 forbids `sessionStorage` outside `lib/storage`). **Middleware sets the cookie** (D4-29): on the redirect it issues to `/onboarding?redirect_url=…`, and on any `/onboarding` request that carries the query (P11's sign-in hands it over that way). Server components cannot set cookies, so the resolver only reads it. With `onboarding-v3` off it renders `<LegacyOnboarding/>` instead.

**Welcome content.** Eyebrow "Welcome"; h1 "Welcome, {displayName}." (§8.13); body "ReplayChess is your chess coach. It analyses your Chess.com games, finds the mistakes you keep making, and turns them into a short daily plan of reviews and puzzles."; an `<ol>` of four rows with mono time hints: "01 Link Chess.com or Lichess · 30 S", "02 Tell us your level · 10 S", "03 Pick your goals · 10 S", "04 Start your free trial · 7 DAYS FREE"; hint "About a minute. You can change all of it later in Settings."; primary "Get Started". Aside: "Your first legend position", the static board, caption "Kasparov vs Topalov, 1999. White to move. It's waiting for you at the end of setup."

| State | Condition | Difference |
|---|---|---|
| default | `trial.eligible` | as above |
| trial used | `!trial.eligible` | row 04 "Start your membership" without the "7 DAYS FREE" tag |
| already linked (legacy `ChessComProfile` users backfilled by B5) | an `ACTIVE` link exists | Get Started goes to `/onboarding/level` (band prefilled), the resolver never shows Link |

**Phones.** The aside board is dropped (the list fills the body); iPad P keeps it below the list at `min(100%, 520px)`.

**Data.** RSC `getViewer()`; "Get Started" → `advance("link", { timeZone })` (§5.2; `timeZone` from `Intl.DateTimeFormat().resolvedOptions().timeZone`, sent only when it differs from `me.user.timeZone`) → `/onboarding/link`.

**Copy note.** The body says "Chess.com games"; when the user later links only Lichess this is still accurate enough for a welcome line. No change.

### 4.2 Link `/onboarding/link`

**Boards.** D `DR/V3OnbLink.dc.html`, iPhone `DR/V3iPhoneOnbLink.dc.html`, iPad P `DR/V3iPadOnbLink.dc.html`. Enum: `default, validating, found, not_found, private_profile, rate_limited, lichess_denied`.

**Content.** h1 "Bring your games."; body "We read your public games so the coach can start from how you really play. We never ask for your password." Card 1 "Chess.com · PUBLIC GAMES ONLY": `Field` "Chess.com username" (`id="cu"`, `autocomplete="username"`, `autocapitalize="none"`, `spellcheck=false`, `inputmode="text"`, `maxlength=25`), button "Look Up Profile", result line (`aria-live="polite"`, tied to the input by `aria-describedby`). Card 2 "Lichess": "Opens Lichess to approve read-only access." + "Connect Lichess ↗". Footer: "Skip for now" (left), "Continue" (right, `aria-disabled` until found). Aside "What we import": four rows (last 12 months of rated games in the background; ratings per time control; new games every day until you disconnect; never your password, messages or friends) + "Disconnect any time in Settings · Connected accounts." On phones the aside is a card at the end of the body.

| State | Trigger | UI | Next |
|---|---|---|---|
| `default` | first visit | empty input (or the last looked-up handle from `qk.me().accounts`) | — |
| `validating` | submit with a non-empty, valid handle | input disabled, button "Looking up…" with `Spinner`, `aria-busy` on the card | lookup result |
| `found` | `200 {status:"found"}` | "Found **{displayUsername}** · {headline.timeClass} {headline.rating} · {totalRatedGames} rated games"; Continue enabled; `router.prefetch(confirmUrl)` | Continue → `/onboarding/confirm?provider=chesscom&u={username}` |
| `found` (no games) | `200 {status:"no_games"}` | "Found {name} · no rated games yet" | Continue → confirm (`no_games` there) |
| `not_found` | `404 not_found` | input `aria-invalid`, ferr line "We couldn't find "{typed}" on Chess.com. Check the spelling; usernames have no spaces." | edit and retry |
| `private_profile` | `200 {status:"private"}` (Chess.com 410 or `status: closed*`) | "This profile is closed or its games are private, so we can't import them. You can still continue and play here first."; Continue enabled | Continue → `/onboarding/level` (manual), no link is created |
| `rate_limited` | `429 rate_limited` (`details.source` `replay` from our bucket, or `chesscom` when both the web call and the worker fallback were limited, D4-23) | "Chess.com is limiting lookups right now. Try again in 0:30." (`RetryCountdown` from `retryAfterSec`, default 30); button disabled until 0 | auto-enables; never auto-retries |
| `lichess_denied` | `?lichess=denied` on arrival | inside the Lichess card: "Access wasn't approved on Lichess. Try again, or skip." | retry Connect |
| not drawn: `linked_elsewhere` | `409 conflict {reason: linked_elsewhere}` | "This Chess.com account is linked to another ReplayChess account. Sign in with that account, or contact us." + link `/contact?topic=importing` | — |
| not drawn: upstream down | `502 upstream_unavailable` (`details.kind` `error` or `timeout`) | "Chess.com didn't answer. Try again in a moment." | retry |
| not drawn: Lichess error | `?lichess=error&reason=…` | in the Lichess card: `already_linked` "You already have a Lichess account linked. Disconnect it in Settings first."; `linked_elsewhere` "This Lichess account is linked to another ReplayChess account."; other "Lichess didn't answer. Try again." | — |
| not drawn: Lichess pending | click Connect Lichess | button "Waiting for Lichess…" + spinner (`li_connecting` styling) until the page unloads | lichess.org |

**Interactions.** Enter in the input = Look Up (the form's submit when not yet found; once `found`, Enter = Continue). The input trims, strips a leading `@`, keeps the typed case for display and sends it as typed (the server lowercases). No debounce or auto-lookup (Chess.com limits). Typing after `found` returns to `default` (Continue disabled again). "Connect Lichess" is a plain link to `/api/accounts/lichess/start?returnTo=/onboarding/link` (full navigation). "Skip for now" → `advance("level")` → `/onboarding/level`. The client checks the username with the exported regex constant `CHESSCOM_USERNAME_RE` from `CT/http/accounts.ts` (no zod in the client bundle, api-perf AP-12); the server re-validates with the zod schema. An `aria-disabled` Continue stays focusable and, when activated, focuses the input and announces "Look up your profile first."

**Edge cases.** A Lichess name typed in the Chess.com field gives `not_found` (copy unchanged). Chess.com usernames are case-insensitive. A user who already has a Chess.com link and comes back here sees `found` prefilled from `me.accounts` and Continue goes to confirm. In a standalone PWA on iOS, the Lichess redirect leaves the PWA scope; the callback returns to the browser tab, which is acceptable (tested manually).

### 4.3 Confirm `/onboarding/confirm`

**Boards.** D `DR/V3OnbPreview.dc.html`, iPhone `DR/V3iPhoneOnbPreview.dc.html`, iPad P `DR/V3iPadOnbPreview.dc.html`. Enum: `default, loading, no_games`.

**Route.** `/onboarding/confirm?provider=chesscom&u={username}` or `/onboarding/confirm?provider=lichess` (after OAuth, the account is already linked).

**Content.** h1 "Is this you?"; body (changed, D4-07) "Check the profile before we import. Importing starts as soon as your trial begins, and runs in the background." Profile card (`.acct`): `Avatar` (initials only until OD-2 clears, D4-26), username, "Chess.com · joined March 2021 · Portugal", a `<dl>` of four ratings "Rapid 1184 · Blitz 1032 · Bullet 871 · Daily —", and "Rated games {N}" (all-time, D4-08). Footer "Not Me" / "That's Me". Aside "Most recent games · of {N}": five rows (`Tag` LOSS/WIN/DRAW, opponent + rating, opening name, relative date "Today", "Oct 27"). On phones the recent games become a card under the profile (three rows at heights ≤ 760).

| State | Condition | UI |
|---|---|---|
| `loading` | streaming: the `<Suspense fallback>` while `getAccountPreview()` runs | card skeleton (`SkeletonRegion aria-busy`), five `GhostRow`s, "That's Me" `aria-disabled` |
| `default` | preview has games | as above |
| `no_games` | `totalRatedGames = 0` | "No rated games yet. The coach will start from your first game here." in the card; aside "Nothing to import yet." |
| not drawn: recent games failed | archives call failed, profile fine | aside "Couldn't load recent games." (muted); confirm still allowed |
| not drawn: profile gone | lookup now 404 | `redirect('/onboarding/link?error=not_found&u=…')` |

**Actions.** That's Me (Chess.com) → `POST /api/accounts/chesscom {username, context:"onboarding"}` with an `Idempotency-Key` (button spinner) → 201 → `/onboarding/level`. A `409 linked_elsewhere` (race) → `/onboarding/link?error=linked_elsewhere`. That's Me (Lichess) → `advance("level")`. Not Me (Chess.com) → `/onboarding/link` with the input cleared and focused. Not Me (Lichess) → `DELETE /api/accounts/lichess` (removes the link row; there is no token to revoke, D4-21) → `/onboarding/link`.

**Keyboard.** Enter = That's Me; Esc = Not Me when focus is not in a field.

### 4.4 Level `/onboarding/level`

**Boards.** D `DR/V3OnbRating.dc.html`, iPhone `DR/V3iPhoneOnbRating.dc.html`, iPad P `DR/V3iPadOnbRating.dc.html`. Enum: `prefilled, manual`.

**Content.** h1 "Where are you now?"; note; label "Your level"; `BandPicker` (`role="radiogroup" aria-label="Rating band"`, six `Chip`s with `role="radio"` and `aria-checked` only — the board's extra `aria-pressed` is dropped, inv-pub §2.16): New to chess, Under 800, 800–1200, 1200–1600, 1600–2000, 2000+. Band note line (polite live region). Footer "Skip" / "Continue". Aside "A puzzle at your level": a `StaticBoard` from `WEB/lib/onboarding/sample-puzzles.ts` (one CC0 Lichess puzzle FEN per band; board FEN on `V3OnbRating` is the 800–1200 sample) and the aside note.

| State | Condition | Note text | Selection |
|---|---|---|---|
| `prefilled` | `ratingBandSource` starts with `chesscom:` or `lichess:` | "From {Provider}: {TimeClass} {rating}. We picked the band for you; change it if it feels off." | suggested band checked |
| `manual` | no suggestion | "No linked account, so pick the band that fits. A rough guess is fine; the coach adjusts after a few games." | none; Continue `aria-disabled`, band note "Pick one to continue." |

Band note when a band is selected: "Puzzles start near {puzzleStart}, and coach lines skip what you already know." (`puzzleStart`, §8.2). Aside note: "We'll start with how the pieces work together, not ratings." for New to chess, else "Puzzles and coach lines are pitched at your band and move with you as you improve."

**Interactions.** Roving tabindex; ←/→/↑/↓ move and select; Space selects; Enter continues. Continue → `advance("goals", {ratingBand, ratingBandSource, initialRating})` (§8.2 for the values; wire values lowercase, D4-25). Skip → `advance("goals")` with nothing set (Train uses its default band).

**Phones.** Chips wrap in two columns; the aside board is dropped at heights ≤ 760 (iPhone at 100 % keeps it at `min(100%, calc(100dvh - 520px))`, hidden below 220 px).

### 4.5 Goals `/onboarding/goals`

**Boards.** D `DR/V3OnbGoals.dc.html`, iPhone `DR/V3iPhoneOnbGoals.dc.html`, iPad P `DR/V3iPadOnbGoals.dc.html`. Enum: `default, none_selected`.

**Content.** h1 "What do you want from it?"; "Pick any. Your Home screen leads with these."; `fieldset` legend "Goals" with five toggle `Chip`s (`aria-pressed`, check icon when on): Stop blundering, Learn openings, Improve endgames, Study legends, Play friends. "Time a day": `Segmented` 5 / 10 / 20 min (`role="group" aria-label="Daily time"`). Footer "Skip" / "Continue". Aside "Your day · {mins} MIN A DAY": `DayPreview` `<ol>` of rows "{title} · {desc} · {m} MIN".

| State | Condition | UI |
|---|---|---|
| `default` | ≥ 1 goal | preview rows from `previewDay()` (§8.3); default selection Stop blundering + Study legends, 10 min (or the saved values) |
| `none_selected` | 0 goals | status "Pick at least one goal to continue." (`role="status"`), Continue `disabled`, aside "Choose a goal to see a sample day." |

**Interactions.** Space/Enter toggle chips; ←/→ in the segmented control. Continue → `advance("plan", {goals, dailyMinutes})`. Skip → `advance("plan", {goals: ["stop_blundering"], dailyMinutes: 10})` so Home has something to lead with.

**Copy note (owner decision OD-6).** The board gives "Play friends" minutes (`0.2` weight). This spec follows inv-pub §2.17: it shows "Challenge a friend · ANYTIME" and takes no minutes. If the owner prefers the board, set `GOAL_WEIGHTS.PLAY_FRIENDS = 0.2` in `day-preview.ts`.

### 4.6 Plan `/onboarding/plan`

**Boards.** D `DR/V3OnbPlan.dc.html`, iPhone `DR/V3iPhoneOnbPlan.dc.html`, iPad P `DR/V3iPadOnbPlan.dc.html`. Enum: `default, loading`; prop `plan: monthly | yearly` (default **monthly**, board prop; the old page defaulted to yearly at `WEB/app/onboarding/page.tsx:91-93`, inv-pub Q5 is decided by the board here).

**Content.** h1 "Start your 7-day free trial."; body "Pick how you'll be billed after the trial. A card is needed now; nothing is charged today, and your games start importing as soon as the trial begins." `Segmented` Monthly / "Yearly −16%" (`?plan=` with `router.replace`, no history entry). `PlanCard` "Coaching", note ("Cancel any time" / "About $4.17 a month"), price ("$4.99 / month" / "$50 / year"), four features. Footer "Back" / "Start 7-day free trial". `TrialTermsLine` "Then $4.99/month. Cancel before {chargeDateLabel} and you won't be charged." Aside `PlanTimeline` table (`th scope="row"`): Today · Your recent Chess.com games are analysed; Tomorrow · Your first puzzle set, built from your mistakes; Week 1 · Your Weakness Profile shows your top patterns; Every game · A coach review within a minute (`.tall`); Day 8 · First charge, unless you cancel before {chargeDateLabel}. Hint "Secure checkout by Dodo Payments. Prices in USD."

| State | Condition | UI |
|---|---|---|
| `default` | trial eligible | as above |
| `loading` | checkout POST in flight, until the browser leaves | primary disabled "Opening secure checkout…" + spinner |
| not drawn: trial used | `!trial.eligible` | h1 "Start your membership."; CTA "Start Coaching"; note "Your free trial has been used. Billing starts today."; "Day 8" row removed; terms line "Billed $4.99 today, then monthly. Cancel any time." |
| not drawn: checkout failed | `?status=failed` (redirected from activating) | `Banner tone="bad"` "Card wasn't accepted. Nothing was charged." above the card |
| not drawn: checkout start error | `upstream_unavailable` / `internal` | inline bad banner with Retry and the request id |
| not drawn: abandoned checkout | resolver sent the user back from `ACTIVATING` after 30 min | `Banner tone="info"` "Checkout wasn't finished. Pick a plan to try again." |

`chargeDateLabel` is rendered on the server in the viewer's time zone (`users."timeZone"`, created in M4 and written by the first onboarding PATCH, consistency R-03) as `d MMM` ("6 Nov"), computed as `today + TRIAL_DAYS` for display; after the click the server's `chargeDate` is authoritative (it is shown on activating).

**Actions.** Start → `useStartCheckout().mutate({plan, source:"onboarding"})` → `window.location.assign(checkoutUrl)`. `409 already_subscribed` → invalidate `qk.me()` → `/onboarding/done`. `402 payment_update_required` → `/api/customer-portal`. `503 not_configured` → banner "This plan is not available right now." `429` → `RetryCountdown` on the button. Back from Dodo via the browser button restores a bfcache page with a spinning button: a `pageshow` listener with `event.persisted` resets the mutation. Admins and `BILLING_PAYWALL=off`: the resolver skips Plan entirely.

**Keyboard.** Enter = Start; Alt+← = Back.

### 4.7 Activating (onboarding) `/onboarding/activating`

**Boards.** D `DR/V3OnbActivating.dc.html`, iPhone `DR/V3iPhoneOnbActivating.dc.html`, iPad P `DR/V3iPadOnbActivating.dc.html`. Enum: `polling, stalled, success`.

**Route.** Dodo's return URL `/onboarding/activating?checkout=success&subscription_id=…&status=…&email=…` (Dodo appends `subscription_id`, `status`, `email`; the server adds nothing it cannot verify).

**Content.** `ActivationCard` (shared with §4.9, `WEB/components/billing/ActivationCard.tsx`, `aria-live="polite"` on the state line only) + `ImportProgressCard` (`WEB/components/import/ImportProgressCard.tsx`) + aside "While you wait · Your first legend position is ready: Kasparov vs Topalov, White to move." with the board.

| State | Trigger | UI |
|---|---|---|
| `polling` | first paint while `activation.state = pending` | eyebrow "Confirming your card" + `Spinner`; h1 "Starting your trial…" (or "Activating your membership…" when not a trial); "Card saved. Nothing is charged today. This usually takes a few seconds."; indeterminate `ProgressBar aria-valuetext="Waiting for confirmation"`; import card "Waiting for your trial to start" (D4-07); "Continue in Background" → Done |
| `stalled` | 12 s after mount without `active`/`failed` (polling continues) | "Still activating"; h1 "This is taking longer than usual."; "Your card was saved and nothing has been charged. Check again, or carry on: your trial starts by itself once it's confirmed."; buttons "Contact Support" (`/contact?topic=billing&ref={reference}`) and "Check Again" (forces a Dodo lookup) |
| `success` | `entitlement:changed {state ∈ member, trial}` or poll `state: active` | `Tag tone="good"` "Active"; h1 "Your free trial has started."; "7 days free. First charge on {chargeDateLabel} unless you cancel before then."; import card now live; primary "Continue" → Done |
| not drawn: `failed` | `?status=failed`, or poll `state: failed` | `router.replace('/onboarding/plan?status=failed&plan=…')`; if the webhook later says active within 30 s, the plan page's activation watcher (same hook, passive) flips the user to Done |

On success the client runs `await clerk.session.reload()` (so `md.entitled` is in the JWT; `rc_act` covers the gap) and `realtime.refreshToken()` (so the socket's `ent` claim updates). Focus moves to the h1 on each state change; the countdown is not announced.

**Phones.** Single column: activation card, import card, buttons stacked; the aside board is dropped.

### 4.8 Done `/onboarding/done`

**Boards.** D `DR/V3OnbDone.dc.html`, iPhone `DR/V3iPhoneOnbDone.dc.html`, iPad P `DR/V3iPadOnbDone.dc.html`. Enum: `importing, import_failed, imported`.

**Content.** Eyebrow "Setup complete" + `Tag` "Trial · {daysLeft} days left"; h1 "You're set."; body "The coach is analysing your Chess.com games now. Your first review and puzzle set land on Home. Warm up with a classic position while you wait." (provider name from the linked account; "your games" when none). `ImportProgressCard` (`aria-live="polite"`). Buttons "Go to Home" (primary) and "Play Your First Legend Position" (secondary, D4-14). Aside: "Wijk aan Zee · 1999 · White to move", board, "Kasparov vs Topalov. Kasparov found a rook sacrifice here. Can you?"

| State | Condition (from `qk.imports()`) | Card copy |
|---|---|---|
| `importing` (phase reading) | run `RUNNING`, `phase = reading` | "Importing games · {seen} found" + indeterminate bar · "We'll show your first review on Home." |
| `importing` (phase saving) | `RUNNING`, `phase = saving` | "Importing games {imported} / {total}" + determinate bar (`aria-valuemin=0 aria-valuemax={total} aria-valuenow={imported}`) · "About {eta} left. We'll show your first review on Home." |
| `imported` | run `DONE` | "Imported {imported} games" · if `firstReview.analysisStatus = DONE`: "The coach found {momentsCount} moments in your last game. They're first on Home." (0 → "Your last game was clean. Nice."); else "Your first review is being prepared." |
| `import_failed` | run `FAILED` | "Import stopped at {imported} of {total}" · "{Provider} stopped answering. We'll retry in the background, or you can now." + "Retry Import" |
| not drawn: nothing linked | no account | "Link Chess.com or Lichess any time in Settings · Connected accounts." (link) |
| not drawn: zero games | run `DONE`, `imported = 0` | "Nothing to import yet. Your first game here starts your Mistake Bank." |
| not drawn: trial still starting | not entitled yet (came via Continue in Background) | `Tag` "Trial starting…" (no day count); completion deferred until `entitlement:changed`; Go to Home disabled with hint "Almost there…" |

`eta = ceil((total − imported) / rate)` where `rate` is games per second over the last three progress events; shown as "About 2 minutes" (≥ 90 s), "Less than a minute", hidden when unknown. "Go to Home" → the `rc_onb_next` destination or `/games`. "Retry Import" → `POST /api/import/{ref}/retry` (optimistic `QUEUED`).

**Phones.** Card, then the two buttons stacked; the aside is dropped at heights ≤ 760.

### 4.9 Checkout activating `/checkout/activating`

**Boards.** D `DR/V3CheckoutActivating.dc.html` (enum `polling, success, stalled, failed`). Phones and iPad P: the onboarding activating mobile layouts (single column, inv-pub §2.7).

**Route.** `/checkout/activating?redirect_url=…&checkout=success&subscription_id=…&status=…` for checkouts with `source ∈ pricing, paywall, renew`.

**Layout.** Marketing top nav (`.tn`, 64 px; 48 px at ≤ 640 tall; the existing `Navbar` until P11 ships `MarketingTopNav`), `.stage` centred, `.ck` grid `minmax(0,1.35fr) minmax(0,1fr)` max 1000 px, one column at ≤ 900 px wide. Left: `ActivationCard`. Right: "Your trial" aside card (plan, price, "7 days free · then monthly from {date}", four features, "You'll return to {destinationLabel} when this finishes." while polling/stalled). Destination label from P1's `resolveReturnTarget()` (SYS-4) ("Play · Kasparov vs Topalov").

| State | Trigger | UI |
|---|---|---|
| `polling` | as §4.7 | eyebrow "Checking with Dodo Payments"; h1 "Starting your trial…"; "Card saved, nothing charged today. This usually takes a few seconds. You can leave this page; we'll finish in the background."; bar. "Go to Home" is **hidden** until success (inv-pub Q7: Home is member-only) |
| `success` | as §4.7 | "Active"; h1 "Your free trial has started." (or "Your membership is active."); "7 days free, first charge on {date}. Taking you back to {destination} in 3 seconds."; "Continue Now" + "See Membership"; hint "Trial ends {endsAt}; first charge {price} on {chargeDate}." (the "Confirmation sent to …" sentence is omitted until an email provider exists) |
| `stalled` | 12 s | "Still activating"; h1 "This is taking longer than usual."; copy; "Check Again", "Get Support" → `/contact?topic=billing&ref={reference}`; hint "Reference {reference} · waited {waited}" |
| `failed` | `?status=failed` or `state: failed` | "Not charged"; h1 "Card wasn't accepted."; "Your bank declined the card check or checkout was cancelled. Nothing was charged. Your account is saved; finish checkout to start your free trial."; "Try Again" → `/pricing?checkout=failed&plan={plan}`; "Back to Home" → `/` for non-members |

The 3-second countdown pauses while the success card has focus or hover; it then `router.replace(redirect_url ?? "/games")`, or `/onboarding` when `!me.onboarding.done`. Already entitled on arrival → `success` with "You're already a member" and no countdown.

### 4.10 Connected accounts `/settings/connected`

**Boards.** D `DR/V4SettingsConnected.dc.html` (default `default`) and `DR/V4SettingsConnectedError.dc.html` (default `sync_failed`). Enum: `default, syncing, sync_failed, rate_limited, not_found, private_games, li_connecting, li_denied, both_linked, none_linked` (+ local `looking`). Phone and tablet layout of the detail pane: the `on_connected` branch of `DR/V4iPhoneSettings.dc.html`, `DR/V4AndroidSettings.dc.html`, `DR/V4iPadPSettings.dc.html`, `DR/V4iPadLSettings.dc.html` (P10 boards; P4 uses only their detail pane).

**Route.** `WEB/app/(app)/settings/connected/page.tsx`, inside the app shell, reachable by signed-in non-members (D4-17). The OAuth return uses `?lichess=linked|denied|error`.

**Layout.**
- Desktop / iPad L: shell sidebar or rail; `PageHeader` overline "Settings", title "Connected accounts" (the board's "Settings" h1 + panel h2 collapse into one header until P10 adds the list); one `Card` panel `max-width: 760px`, `grid-template-rows: auto minmax(0,1fr)`; the body is a P1 `ScrollRegion` (only it may scroll; at 1440×900 both cards with banners fit without scrolling).
- iPad P / phones: tab-bar mode; detail header with Back (to `/profile` until P10) and "Connected accounts"; body `ScrollRegion`; the disconnect confirm stays inline.
- `@media (max-height:700px)`: row heights 48 px, `.short-hide` lines hidden (the intro line).

**Content.** Intro "Linked games feed your reviews, Mistake Bank and weakness profile. Importing never posts anything." A "SAVED · SYNCED" status chip fades in for 2.6 s after any successful settings write (`role="status"`).

**Chess.com card.**

| State | Data condition | UI |
|---|---|---|
| `default` (linked) | `status: linked` | Avatar (initials, D4-26), "knightowl_88", "BLITZ 1179 · RAPID 1206", "Last sync 2 hours ago · 480 games imported", pill `Tag tone="good"` "Linked"; `SwitchRow` "Import new games every day · About 3 a.m. your time"; "Sync now"; "Disconnect" |
| `syncing` | `run.status ∈ queued, running`, or set optimistically by Sync now before the 202 (api-perf AP-30) | pill warn "Syncing"; line "Importing your latest games…"; `role="status"` "IMPORTING {imported} / {total}" + bar; "Syncing…" (disabled); at finish toast "Sync finished · {newGames} new games" |
| `sync_failed` | `lastError.code ∈ upstream, timeout` and `importState = FAILED` | pill bad "Sync failed"; line "Last sync failed {rel}"; `Banner tone="bad" role="alert"` "Chess.com didn't respond. Your {importedCount} imported games are safe; the last good sync was {lastSyncOk rel}." + "Try again" (= Sync now) |
| `rate_limited` | `nextAllowedSyncAt > now` or a `429` from Sync now | pill warn "Paused"; `Banner tone="warn"` "Chess.com is limiting requests. You can sync again in {m:ss}." Sync now disabled until then |
| `private_games` | `skippedCount > 0` after a run | `Banner tone="warn"` (copy changed, inv-acct Q19): "We imported {imported} of {seen} games. {skipped} were skipped: variants, unrated or unfinished games." + "Why?" → `/help#importing` |
| `none_linked` / not linked | no Chess.com account | "Not linked", pill "Off"; "Enter your Chess.com username. We read your public games; you never share a password."; input + "Look up profile" |
| `looking` | link POST in flight | button "Looking up…" + spinner |
| `not_found` | `404` on link | ferr `role="alert"` "No Chess.com player called "{u}". Check the spelling; it is the name in your Chess.com profile link." |
| not drawn: closed account | `lastError.code = closed` | bad banner "This Chess.com account was closed, so new games can't be imported. Your {n} imported games are safe." + Disconnect |
| not drawn: non-member | `status: waiting_for_membership` | info banner "Importing starts when your trial begins." Sync now hidden; Disconnect available |

Success of "Look up profile" goes straight to `syncing` (the board's flow): in settings the link POST performs the lookup itself (§7.3.3), there is no separate confirm.

**Disconnect confirm** (inline `role="group" aria-label="Disconnect Chess.com"`, focus moves to "Keep it"): "Disconnect Chess.com? New games stop importing. Games already imported stay in your archive unless you remove them." `CheckboxRow` "Also delete the {n} imported games and their reviews"; "Keep it" / "Disconnect" (danger). Result toast "Chess.com disconnected. Imported games kept." or "Chess.com disconnected. Imported games are being removed."

**Lichess card.**

| State | Condition | UI |
|---|---|---|
| off | no account | "Not linked", pill "Off"; "Sign in on Lichess and approve read-only access to your games. You come straight back here."; "Connect Lichess" |
| `li_connecting` | click until unload | "Waiting for Lichess…" + spinner, pill warn "Waiting" |
| `li_denied` | `?lichess=denied` | ferr "Lichess sign-in was cancelled, so nothing was linked. You can try again." |
| linked (`both_linked` when Chess.com is linked too) | account exists | Avatar (initials; Lichess has no avatars), "knightowl88", "BLITZ 1402 · Linked just now · 96 games imported", "Sync now", "Disconnect"; on return with `?lichess=linked` toast "Lichess linked · importing {n} games" |
| syncing / failed / rate limited | as Chess.com | same patterns with "Lichess" in the copy |

**Interactions.** Switch toggles on Space; Sync now and Try again share one handler; Disconnect opens the inline confirm; Esc inside the confirm = Keep it. `?lichess=…` is consumed once and removed with `history.replaceState`.

### 4.11 Slots P4 lights up in earlier screens

| Screen (phase) | Board | What turns on |
|---|---|---|
| `/games` archive (P3) | `DR/V3GamesArchive.dc.html` states `import_running`, tabs | Source tabs `All · Replay Chess · Chess.com · Lichess` with counts from `GET /api/me/games?limit=0` facets; the tab is hidden when its count is 0 and no account of that provider exists. `import_running` banner `role="status"` "IMPORTING {imported} / {total} {Provider}" fed by `qk.imports()`. Empty tab copy for a provider tab with a link but 0 games: "No {Provider} games yet. They appear here as they import." The empty state's "Import from Chess.com" link → `/settings/connected` |
| Account menu (P1) | `DR/V3Nav.dc.html` menu | "Connected accounts" item with the link icon |
| Own profile (legacy) | — | "Connect Chess.com" → `/settings/connected` |
| Home (P5) | `V3Home import_running` | **Not lit in P4**; P5 reads the same `qk.imports()` |
| Archive rows of imported games outside the analysis budget (P3) | `V3GamesArchive` row without a review | P3's existing `none` row state ("Review" opens `/review/[ref]`, which posts A3). No new state: D4-09 only changes which rows start as `none` |

### 4.12 Dev demo routes (allocation §1.1 item 4: every state reachable)

`WEB/app/dev/ui/onboarding/[step]/page.tsx?state=…` renders each step with fixture props and no network (`notFound()` unless `devRoutesEnabled()`, SPEC D11). `WEB/app/dev/ui/connected/page.tsx?state=…` renders the panel in each of the 10 states. `WEB/app/dev/ui/activating/page.tsx?kind=onboarding|checkout&state=…`. `WEB/app/dev/import/page.tsx` (admin, `testHooksEnabled()` = `isNonProd()` plus `ALLOW_TEST_HOOKS=1`; feasibility SEC-5, testing X12) holds fault-injection buttons (§7.7.4). All four routes are listed in `WEB/lib/test-hooks/registry.ts`, so `prod-guard.spec.ts` proves they 404 in a production build. Every demo state also carries `?stress=1` (20-character usernames, 80-character opening names, five-digit counts) for the one-viewport checks at 150 % (testing X9).

Each spec that reaches a state tags it `@state:<Board>.<state>` (real data) or `@demo:<Board>.<state>` (demo route), so P1's `state-coverage.ts` can check the 27 P4 boards against `docs/qa/design-states.json` (testing X8). The table below is the expected result; demo-only rows carry their reason in `design-states.overrides.json`.

**State reachability**

| Board state | Real data | Demo route |
|---|---|---|
| Link `default`, `validating`, `found`, `not_found`, `private_profile`, `lichess_denied` | yes (mock upstream in e2e, real Chess.com on dev) | yes |
| Link `rate_limited` | yes (11 lookups in 60 s) | yes |
| Confirm `default`, `no_games`, `loading` | yes (`loading` is visible on a cold cache) | yes |
| Level `prefilled`, `manual`; Goals `default`, `none_selected`; Plan `default`, `loading`, `plan` | yes | yes |
| Activating `polling`, `success` | yes; `stalled` by pausing the dev webhook endpoint in Dodo (dev URL) or by delaying the signed webhook past 12 s (CI) | yes |
| Checkout activating `polling`, `success`, `stalled`, `failed` | yes (`failed` with a declined test card from Dodo's test-mode card list, see the `testing-and-go-live` guide; or a signed `payment.failed` test webhook) | yes |
| Done `importing`, `imported` | yes; `import_failed` via `/dev/import` fault | yes |
| Connected all 10 | yes (`syncfailed` persona, fault route, real Lichess) | yes |

---

## 5. UI ↔ API data flow

### 5.1 Conventions inherited (P1 1B, client-data-layer)

- **First paint is RSC** through the server-only DAL. P4 adds `WEB/lib/data/accounts.ts` (`listLinkedAccounts`, `getAccountPreview`), `WEB/lib/data/imports.ts` (`getImportStatus`), `WEB/lib/data/onboarding.ts` (`getOnboardingState`), and `getActivation` in `WEB/lib/data/billing.ts`. Pages never fetch their own `/api` over HTTP. The same DAL function backs the GET route, so the dehydrated query and the API body are identical (client-data-layer §2.3).
- **Client reads and every mutation** go through `api()` (`WEB/lib/api/client.ts`) and TanStack Query v5 hooks in `WEB/lib/api/queries/{accounts,imports,billing}.ts` and `WEB/lib/api/mutations/{accounts,imports,onboarding,billing}.ts`. Paths are registered once in `WEB/lib/api/endpoints.ts`; P4's keys live in `WEB/lib/api/keys/account.ts` if P1 split the key registry into a directory (feasibility §7), else in `keys.ts`. Response schemas are parsed in dev and test only, so no zod reaches production bundles (api-perf AP-12). Conditional GETs need no client code: `private, no-cache` + `ETag` lets the browser revalidate and hand `fetch` the cached body on a 304 (api-perf AP-21).
- **Providers.** `WEB/app/onboarding/layout.tsx` and `WEB/app/checkout/activating/layout.tsx` mount `QueryProvider` themselves (the root layout does not, api-perf AP-48).
- **Push over the socket** (`user:{ref}` room, P2 `RealtimeConnection`), HTTP polling only as the fallback in §5.7.
- **Errors**: `QueryProvider`'s global handlers (401 → session flow; 402 → paywall; 429/upstream → none; 5xx → toast with request id). P4 sets `meta: { errorUi: "inline" }` on every account and onboarding mutation so the global toast does not fire for errors the screen renders itself, and `meta: { paywall: "inline" }` on the two member-only calls made from a page non-members can see (sync, retry), so a 402 renders "Importing starts when your trial begins." instead of redirecting.

### 5.2 Hooks P4 adds

| Hook (file) | Wraps | Behaviour |
|---|---|---|
| `useOnboardingStep()` (`WEB/lib/api/mutations/onboarding.ts`) | `PATCH /api/me/onboarding` | `advance(step, fields?)` with lowercase wire values (D4-25): `setQueryData(qk.me(), merge)`, `router.push(stepPath(step))` **immediately**, then sends the PATCH (`retry: 3`, delays 1 s / 3 s / 9 s; safe because the write is monotonic and idempotent). The first call of a session adds `timeZone` when the browser's zone differs from `me.user.timeZone`. Failure after retries: toast "Couldn't save. We'll retry." and the resolver re-derives the step on the next load. |
| `useCompleteOnboarding()` | same, `{complete: true}` | Not optimistic. On 200: `await clerk.session.reload()`, `setQueryData(qk.me())`. On `409 conflict {reason: plan_required}`: `router.replace('/onboarding/plan')`. |
| `useChessComLookup()` (`mutations/accounts.ts`) | `POST /api/accounts/chesscom/lookup` | A mutation (POST), `retry: 0`, `AbortController` per submit (a new submit aborts the previous), maps the result to the Link board states (§4.2). |
| `useLinkChessCom()` | `POST /api/accounts/chesscom` | `Idempotency-Key` = a UUID created when the confirm page (or the settings input) mounts, reused for retries of the same username. On success: `setQueryData(qk.accounts())`, `setQueryData(qk.me())` (`accounts`, `import`, `onboarding`), `setQueryData(qk.imports())`; stale `qk.games.all()`; `BroadcastChannel("rc-sync")` to other tabs. |
| `useUnlinkAccount(provider)` | `DELETE /api/accounts/{provider}?deleteGames=` | Not optimistic (confirm first). On success: remove from `qk.accounts()` and `qk.me().accounts`; stale `qk.games.all()`, `qk.imports()`. |
| `useSyncAccount(provider)` | `POST /api/accounts/{provider}/sync` | Optimistic in `onMutate` (api-perf AP-30): the account's view status → `syncing` with an empty run, so the row flips before the round trip. Rollback on error. `429 rate_limited` → `rate_limited` with the countdown from `retryAfterSec`; `409 sync_running` → keep `syncing`, no toast. |
| `useSetAutoImport(provider)` | `PATCH /api/accounts/{provider}` | Optimistic toggle; the body carries `timeZone` when it differs from `me.user.timeZone` (the daily hour depends on it); rollback + toast "Couldn't save the setting." on error; shows "SAVED · SYNCED" on success. |
| `useImportStatus()` (`queries/imports.ts`) | `GET /api/import/status` | `qk.imports()`, `staleTime: 0`, seeded by RSC, `refetchInterval` = the fallback in §5.7 (a module-scoped `fallbackInterval()` instance per query hash, so its start time survives re-renders, api-perf AP-20); 304s handled by the browser cache. |
| `useImportProgress()` (`WEB/lib/realtime/useImportProgress.ts`) | socket `import:*` | Acquires the `"user"` hold; writes events into `qk.imports()`, `qk.accounts()`, `qk.me().import`; keeps a 3-sample rate window for the ETA. |
| `useRetryImport()` | `POST /api/import/{ref}/retry` | Optimistic run status `queued`. |
| `useActivation(params)` (`WEB/lib/billing/useActivation.ts`) | `GET /api/billing/activation` + `entitlement:changed` | Acquires the critical `"activation"` hold (the socket stays up in a hidden tab), runs the client state machine `activation-machine.ts` (§8.5.3), polls with `evenWhenLive` (money: belt and braces). On `active`: `clerk.session.reload()`, `realtime.refreshToken()`, `setQueryData(qk.me())`. |
| `useStartCheckout()` (`mutations/billing.ts`) | `POST /api/checkout` | `Idempotency-Key` per (plan, page view); not optimistic; resets on `pageshow` with `persisted`. |

### 5.3 Query keys and freshness (additions to `WEB/lib/api/keys.ts`)

| Key | Endpoint | DAL (first paint) | `staleTime` | Focus refetch | Realtime updater | Seed |
|---|---|---|---|---|---|---|
| `qk.me()` (exists) | `GET /api/me` (`private-etag`) | `getMe()` | 5 min | when stale | `entitlement:changed` → `setQueryData` from the payload (it carries the entitlement DTO; no refetch, api-perf AP-39), `import:*` (`import`) | onboarding layout and `(app)` layout |
| `qk.accounts()` | `GET /api/accounts` (ETag) | `listLinkedAccounts(viewer)` | 60 s | yes | `import:progress` (patch `run`), `import:finished` / `import:failed` (invalidate) | `/settings/connected` RSC |
| `qk.imports()` | `GET /api/import/status` (ETag) | `getImportStatus(viewer)` | 0 | yes | `import:progress` (`setQueryData`), `import:finished` / `import:failed` (`setQueryData` then invalidate once), `analysis:done` for `firstReview.gameRef` (patch `firstReview`) | activating, done RSC |
| `qk.billing.activation(key)` | `GET /api/billing/activation?…` | `getActivation(viewer, params, {dodo: false})` | 0 | — | `entitlement:changed` → `{state: "active", entitlement}` | activating RSC (`key` = `subscription_id ?? session_id ?? "latest"`) |
| `qk.games.counts()` (P3) | `GET /api/me/games?limit=0` | — | 60 s | yes | `games:changed` (stale, throttled 1/10 s) | archive RSC |

No other server state is cached on the client in P4. Lookup results live in component state (they are already cached for 10 minutes on the server, §9.3).

### 5.4 Per-screen data flow

| Screen | RSC loader (server, first paint) | Client reads | Mutations | Realtime | Polling | Prefetch | Errors |
|---|---|---|---|---|---|---|---|
| Layout `/onboarding/*` | `getViewer()` (React `cache`, one select), `resolveOnboardingRoute()` guard, `mintSocketToken(viewer)` (P2, no HTTP), `HydrationBoundary(qk.me)`; `<RealtimeBoot>` does **not** connect | — | — | — | — | — | signed out → middleware `redirectToSignIn`; render error → `onboarding/error.tsx` |
| Welcome | viewer only | — | `advance("link")` | — | — | `router.prefetch('/onboarding/link')` on mount | PATCH retries silently |
| Link | `searchParams.lichess`, `me.accounts` (prefill) | — | `useChessComLookup()`; Lichess = full navigation to `/api/accounts/lichess/start`; `advance("level")` on skip | — | — | on `found`: `router.prefetch(confirmUrl)` (one invocation that warms the confirm RSC and the server's Chess.com cache) | inline per §4.2; never a global toast |
| Confirm | `<Suspense>` → `getAccountPreview(viewer, provider, u)`: Chess.com profile + stats (already cached by the lookup), archives list + newest month (+ previous month if < 5 games), all through `unstable_cache` 600 s, with the worker fallback on 429/403 (D4-23); Lichess: the `LinkedAccount` row + anonymous `recentGames(u, 5)` cached 600 s | — | `useLinkChessCom({context: "onboarding"})` / `advance("level")` / `useUnlinkAccount("lichess")` | — | — | `router.prefetch('/onboarding/level')` after link | 404 → redirect to link; `409 linked_elsewhere` → link with reason; upstream failure on recent games → partial render |
| Level | viewer (`ratingBand`, `ratingBandSource`, `initialRating`) + `me.accounts` ratings | — | `advance("goals", fields)` | — | — | goals | — |
| Goals | viewer (`goals`, `dailyMinutes`) | — (preview is pure, `previewDay()`) | `advance("plan", fields)` | — | — | plan | — |
| Plan | viewer (`trial.eligible`), `BILLING_PLANS`, `?plan`, `?status`, `chargeDateLabel` in the viewer's time zone | — | `useStartCheckout({source: "onboarding"})` → `location.assign` | — | — | none (next stop is Dodo) | 409/402/429/503 inline (§4.6) |
| Onboarding activating | `getActivation(viewer, params, {dodo: false})` (DB only: entitled? a recorded failure?), `getImportStatus(viewer)` | `qk.billing.activation`, `qk.imports()` | Check Again = `refetch({ force: 1 })` | `entitlement:changed`, `import:*` (holds `"activation"` + `"user"`) | activation always (§5.7); imports only while the socket is down | `/onboarding/done` on success | `failed` → replace to plan; `upstream_unavailable` on force → stay `stalled` |
| Done | viewer, `getImportStatus(viewer)`, `rc_onb_next` destination | `qk.imports()` | `useCompleteOnboarding()` on mount when entitled (else after `entitlement:changed`); `useRetryImport()` | `import:*`, `analysis:done` (first review), `entitlement:changed` | imports only while the socket is down; passive activation (5 s → 15 s, 3 min) when not yet entitled | `/games` on hover/focus of "Go to Home" (`AppLink` intent) | `409 plan_required` → plan |
| Checkout activating | `getActivation(...)`, `resolveReturnTarget(redirect_url)` label | `qk.billing.activation` | Check Again | `entitlement:changed` | activation | destination on success | `failed` state |
| Connected | `listLinkedAccounts(viewer)` → `HydrationBoundary(qk.accounts)`; `searchParams.lichess` | `qk.accounts()` | link (`context: "settings"`), sync, auto-import, unlink, Lichess start (navigation) | `import:*` | `qk.accounts()` while any account is `syncing` and the socket is down | — | §4.10 inline; 402 inline |
| Archive slots (P3 page) | P3's first page + `getImportStatus(viewer)` (for the banner) | `qk.imports()`, `qk.games.counts()` | — | `import:*`, `games:changed` | imports fallback | — | — |

### 5.5 Invalidation map for P4

| Trigger | set | inv | stale | x-tab |
|---|---|---|---|---|
| `PATCH /api/me/onboarding` | `qk.me()` (`onboarding`) | — | — | — |
| `PATCH {complete}` | `qk.me()` | — | — | yes (other tabs re-read `me`) |
| Link Chess.com / Lichess OAuth return | `qk.accounts()`, `qk.me()` (`accounts`, `import`), `qk.imports()` | — | `qk.games.all()` | yes |
| Unlink | `qk.accounts()`, `qk.me()` | — | `qk.games.all()`, `qk.imports()` | yes |
| Sync now / Retry import | `qk.accounts()` / `qk.imports()` (status `queued`) | — | — | — |
| Auto-import toggle | `qk.accounts()` | — | — | yes |
| Checkout start | — | — | — | — |
| `entitlement:changed` | `qk.me().entitlement`, `qk.billing.activation(*)` → `active` when entitled | — | — | — (each tab gets the event itself) |
| `import:progress` (carries `analysed`) | `qk.imports()` (run), `qk.accounts()` (run), `qk.me().import` | — | — | — |
| `import:finished` | as progress, then | `qk.imports()`, `qk.accounts()` | `qk.games.all()`, `qk.home()` (P5, through its 30 s `invalidateThrottled`, api-perf AP-10) | — |
| `import:failed` | run status `failed` + error | `qk.accounts()` | — | — |
| `games:changed` (imports, ≤ 1 per 10 s) | — | — | `qk.games.all()` (active archive refetches its first page) | — |
| `analysis:done` where `gameRef = firstReview.gameRef` (emitted because the first game runs at `USER_OPENED` ≥ 80; backlog games emit only P3's coalesced `analysis:batch`, AP-10) | `qk.imports().firstReview` | — | — | — |
| Socket reconnect | — | only when the connect ack's `bootId` changed or its `useq` shows a gap (api-perf AP-25): active `qk.imports()`, `qk.accounts()`, `qk.billing.activation(*)` | `qk.me()` | — |

### 5.6 Realtime wiring

- **Boot.** `WEB/app/onboarding/layout.tsx` renders `<RealtimeBoot url={NEXT_PUBLIC_WEBSOCKET_URL} token={mintSocketToken(viewer)} />` exactly like `(app)/layout.tsx`. The token carries `ent=false` for non-members; P2's server accepts it and joins `user:{ref}` (allocation P2 "Changed"). No connection is opened until a hold is acquired: Welcome, Link, Level, Goals and Plan never open a socket (no `socket.io-client` chunk on those routes, §9.6).
- **Holds.** Activating pages acquire `"activation"` (critical, survives a hidden tab) and `"user"`; Done and Connected acquire `"user"`; the archive acquires `"user"` through P2's `UserChannel`.
- **Event routing.** `WEB/lib/realtime/UserChannel.tsx` (P2) gets the P4 handlers in `WEB/lib/realtime/handlers/import.ts` and `handlers/entitlement.ts` (one barrel line each; feasibility §7); payloads are parsed with `CT/socket/user.ts` in dev and test (a parse failure is a Sentry `contract_mismatch` and the event is dropped).
- **Entitlement handler** (api-perf AP-39): `setQueryData(qk.me(), …)` from the payload; `router.refresh()` only in the **visible** tab and only when the route's gate decision changes (`member ↔ lapsed`); a hidden tab records the change and refreshes on `visibilitychange`.
- **Token refresh.** On `entitlement:changed` with an entitled state, `realtime.refreshToken()` (so the socket's `ent` claim becomes true before the user reaches a game).

### 5.7 Polling (fallback only; `fallbackInterval()` from P2)

| Poller | Endpoint | Schedule | Runs when | Stops when |
|---|---|---|---|---|
| Activation (both activating pages) | `GET /api/billing/activation` | 2 s × 6, 5 s × 12, then 15 s | always, even with the socket live and the tab hidden (`evenWhenLive`, `hiddenOk`) | `state ≠ pending`, or 180 s (UI stays `stalled`; Check Again restarts it) |
| Passive activation (Done when not yet entitled; Plan after a `failed` return) | same | 5 s × 6, then 15 s | socket down or not yet `live` after 5 s | entitled, or 180 s |
| Import status (activating, done, archive banner) | `GET /api/import/status` (browser revalidation → 304) | 3 s × 10, then 10 s | socket not `live` for 5 s and a run is `queued`/`running`, tab visible | run terminal, socket live, tab hidden, or 10 min |
| Linked accounts (Connected) | `GET /api/accounts` (ETag) | 3 s, 3 s, 5 s, then 10 s | same, while any account is `syncing` | same |

Each poller's `fallbackInterval()` is created once per query hash (module scope), not inline in the hook options, so `stopAfterMs` really stops it (api-perf AP-20; unit test in §12.1).

**Stale-run self-heal without a GET side effect storm** (D4-31, api-perf AP-09). When `GET /api/import/status` sees a run `QUEUED` for more than 30 s, `after()` calls P3's `kickIfStale('import:' || linkedAccountId)`. That runs one compare-and-set (`UPDATE jobs SET "lastKickAt" = now() WHERE "dedupeKey" = $1 AND status = 'QUEUED' AND "runAt" < now() - interval '30 seconds' AND ("lastKickAt" IS NULL OR "lastKickAt" < now() - interval '30 seconds') RETURNING id`) and kicks only when a row comes back, so all instances and tabs together send at most one kick per job per 30 s. The route registers `kick_cas` as its allowed GET side effect (api-perf §5 GET-purity gate). No GET in P4 enqueues work.

### 5.8 Status handling specific to P4

| Status / code | Where | Behaviour |
|---|---|---|
| 401 `unauthorized` | any | global session flow; onboarding resumes after re-auth at the same URL |
| 402 `subscription_required` | sync, retry from `/settings/connected` or Done | inline "Importing starts when your trial begins." (`meta.paywall = "inline"`) |
| 409 `conflict` reasons `linked_elsewhere`, `already_linked`, `sync_running`, `not_failed`, `plan_required` | link, sync, retry, complete | screen-owned copy (§4) |
| 409 `already_subscribed` | checkout | invalidate `qk.me()`, go to Done |
| 429 `rate_limited` | lookup, link, Lichess start, sync, retry, activation (1 per 1.5 s) | `RetryCountdown` on the control from `retryAfterSec`; never auto-retried (activation's poller simply waits for its next tick) |
| 502 `upstream_unavailable` (`details.kind: "timeout" \| "error"`) | lookup, link, confirm, activation force | inline, naming the provider; GETs retry once after 2 s |
| 503 `maintenance` (`affects: import`) | accounts, import routes | P1 maintenance banner; buttons disabled |

### 5.9 Request budget (signed-in user, socket up)

| Flow | Invocations (Vercel) | Third-party calls on the request path |
|---|---|---|
| Whole onboarding (welcome → done, Chess.com, one lookup) | 8 RSC renders + 6 PATCH + 1 lookup + 1 prefetch + 1 link + 1 checkout + 1–2 activation GETs + 1 complete ≈ **21** | lookup: 2 (profile, stats; 0 on a warm cache); confirm: 2 (archives, newest month); checkout: 1–2 (Dodo create; the `subscriptions.list` guard only for returning customers); activation: 0 (DB) unless `force` or every 3rd call while pending |
| Settings visit + one manual sync | 1 RSC + 1 sync POST (+0 polls with the socket up) | 0 |
| Archive during an import | P3's reads + `qk.games` refetch ≤ 1 per 10 s while the tab is active | 0 |

---

## 6. Data model (m4a + M4 + m4v)

Consistent with `SP/plan/data-model.md` §5.5 and `SP/plan/schema.target.prisma` except where §0.2 says otherwise: D4-03 (`ImportRun`), D4-11 (what M4 creates), D4-12 (Lichess resume cursor), D4-21 (no token columns), D4-22 (P2's column names), and the extra display columns marked **(+)** below, needed so `/settings/connected` and Confirm render without an upstream call. The data-model edits these imply are listed in Appendix Z.2.

### 6.1 Prisma (in `DB/prisma/schema.prisma`)

```prisma
// ---------- M4 enums ----------
enum ChessProvider   { CHESSCOM LICHESS }
/// RELINK_REQUIRED is reserved (not written in P4): created now so Chess.com verification (OD-4) needs no ADD VALUE later
enum LinkStatus      { ACTIVE ERROR RELINK_REQUIRED }
/// Summary of the account's import, mirrored from the active ImportRun; drives the V4SettingsConnected pills.
enum ImportState     { IDLE WAITING_FOR_MEMBERSHIP QUEUED RUNNING RATE_LIMITED FAILED }
enum ImportRunStatus { WAITING_FOR_MEMBERSHIP QUEUED RUNNING DONE FAILED CANCELLED }
enum ImportTrigger   { INITIAL MANUAL DAILY RETRY }
enum OnboardingStep  { WELCOME LINK CONFIRM LEVEL GOALS PLAN ACTIVATING DONE }
enum RatingBand      { NEW_TO_CHESS UNDER_800 R800_1200 R1200_1600 R1600_2000 R2000_PLUS }
enum OnboardingGoal  { STOP_BLUNDERING LEARN_OPENINGS IMPROVE_ENDGAMES STUDY_LEGENDS PLAY_FRIENDS }
/// data-model §5.1 verbatim (consistency R-04: M4, first writer P4)
enum AuditCategory   { ACCOUNT BILLING ADMIN CONTENT TOURNAMENT MODERATION SYSTEM }
enum AuditActor      { USER ADMIN SYSTEM WORKER WEBHOOK }

/// M4 (moved from M1/M12 by R-04). Append-only audit trail. No FK: rows outlive deleted users. Never store email or tokens in meta.
model AuditLog {
  id          BigInt        @id @default(autoincrement())
  at          DateTime      @default(now())
  category    AuditCategory
  /// dotted verb, e.g. "account.linked", "account.unlinked", "billing.duplicate_trial_cancelled", "backfill.linked_accounts"
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

/// Phase 4. Replaces ChessComProfile (dual-written until contract step C4). Unlinking deletes the row.
model LinkedAccount {
  id                BigInt        @id @default(autoincrement())
  userId            BigInt
  provider          ChessProvider
  /// Chess.com player_id / Lichess id: stable across renames. Backfilled links hold the handle until the first sync.
  externalId        String        @db.VarChar(64)
  username          String        @db.VarChar(40)
  usernameLower     String        @db.VarChar(40)
  displayName       String?       @db.VarChar(80)
  /// Stored, never rendered until the Chess.com terms review clears (D4-26)
  avatarUrl         String?       @db.VarChar(300)
  countryCode       String?       @db.Char(2)       // (+)
  title             String?       @db.VarChar(4)    // (+) GM, IM, BOT…
  joinedAt          DateTime?                       // (+)
  /// RatingsV1 {v, rapid:{rating,best,games}, blitz…, bullet…, daily…, classical…}
  ratings           Json?
  totalRatedGames   Int?                            // (+) all-time, from stats / perfs (D4-08)
  /// Ownership proof. Lichess OAuth sets it at link; Chess.com stays null until verification ships (D4-10).
  verifiedAt        DateTime?
  verifyCode        String?       @db.VarChar(16)
  status            LinkStatus    @default(ACTIVE)
  importState       ImportState   @default(IDLE)
  /// Lifetime counters (D4-03). Per-run counters live on ImportRun.
  importedCount     Int           @default(0)
  skippedCount      Int           @default(0)
  autoImport        Boolean       @default(true)
  nextAutoSyncAt    DateTime?
  nextAllowedSyncAt DateTime?
  lastSyncAt        DateTime?
  lastSyncOkAt      DateTime?
  /// ImportErrorV1 {v, code, message, at, retryAt?, httpStatus?}
  lastError         Json?
  // No token columns: the Lichess token is revoked inside the OAuth callback (D4-21)
  linkedAt          DateTime      @default(now())
  updatedAt         DateTime      @updatedAt
  user              User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  cursor            ImportCursor?
  runs              ImportRun[]
  gamePlayers       GamePlayer[]

  @@unique([userId, provider])
  @@index([provider, usernameLower])
  @@map("linked_accounts")
}

/// Phase 4. Incremental import position, 1:1 with LinkedAccount (kept apart so /api/me stays narrow).
model ImportCursor {
  linkedAccountId      BigInt        @id
  provider             ChessProvider
  /// Chess.com archives list validators (R-CC-04)
  archivesEtag         String?       @db.VarChar(120)   // (+)
  archivesLastModified String?       @db.VarChar(40)    // (+)
  /// ArchivesV1 Chess.com: {"2026/10": {etag, lastModified, done, games, skipped}}
  archives             Json?
  /// Lichess: createdAt (ms) of the newest imported game; the next run uses since = value + 1
  lichessSinceMs       BigInt?
  /// Lichess: set while a newest-first run is interrupted; the resume uses until = value - 1 (D4-12)
  lichessResumeUntilMs BigInt?                          // (+)
  oldestImportedAt     DateTime?
  seen                 Int           @default(0)
  skippedVariants      Int           @default(0)
  updatedAt            DateTime      @updatedAt
  linkedAccount        LinkedAccount @relation(fields: [linkedAccountId], references: [id], onDelete: Cascade)

  @@map("import_cursors")
}

/// Phase 4 (allocation B5). The user-visible progress row; the queue itself is `jobs` (P3).
model ImportRun {
  id              BigInt          @id @default(autoincrement())
  referenceId     String          @unique @default(cuid())
  userId          BigInt
  linkedAccountId BigInt
  provider        ChessProvider
  trigger         ImportTrigger
  status          ImportRunStatus @default(QUEUED)
  /// "reading" | "saving" (D4-18); null before the run starts
  phase           String?         @db.VarChar(8)
  seen            Int             @default(0)
  /// Games in the window after filters, known at the end of the reading phase
  total           Int?
  imported        Int             @default(0)
  skipped         Int             @default(0)
  analysisQueued  Int             @default(0) @db.SmallInt
  /// Games of this run whose analysis finished; bumped by P3's final analysis batch through payload.importRunId (api-perf AP-10)
  analysed        Int             @default(0) @db.SmallInt
  /// Newest game of this run: the first review on Done / Home
  firstGameId     BigInt?
  /// ImportErrorV1
  error           Json?
  createdAt       DateTime        @default(now())
  startedAt       DateTime?
  finishedAt      DateTime?
  updatedAt       DateTime        @updatedAt
  user            User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  linkedAccount   LinkedAccount   @relation(fields: [linkedAccountId], references: [id], onDelete: Cascade)

  @@index([userId, createdAt(sort: Desc)])
  @@index([linkedAccountId, createdAt(sort: Desc)])
  @@map("import_runs")
}

/// One free trial per person, surviving account deletion. No FK, no PII (data-model D15; created here, D4-11).
model TrialLedger {
  /// sha256(HASH_PEPPER || "\n" || normalised email), hex. P10's deletion path calls the same trialLedgerEmailHash() (consistency R-09, 10.2)
  emailHash    String   @id @db.Char(64)
  /// sha256(pepper || "chesscom:"|"lichess:" + usernameLower); "v:" prefix = verified (enforced)
  handleHashes String[] @default([])
  firstTrialAt DateTime @default(now())

  @@map("trial_ledger")
}

// ---------- User additions (M4) ----------
model User {
  // …existing fields…
  onboardingStep           OnboardingStep   @default(WELCOME)
  /// `onboarded Boolean` stays and is written together with onboardedAt (DONE)
  onboardedAt              DateTime?
  ratingBand               RatingBand?
  /// "chesscom:rapid" | "lichess:blitz" | "self"
  ratingBandSource         String?          @db.VarChar(24)
  initialRating            Int?             @db.SmallInt
  goals                    OnboardingGoal[] @default([])
  dailyMinutes             Int?             @db.SmallInt
  signupSource             String?          @db.VarChar(200)
  /// IANA zone; first reader is the trial end label, first writer the onboarding PATCH (consistency R-03)
  timeZone                 String           @default("UTC") @db.VarChar(64)
  // gamesVersion Int @default(0): the archive ETag version (api-perf AP-19) is P3's field. P4 bumps it per import chunk and
  // purge batch. Only if the §2.3 precondition check finds it missing does WP-A declare it here (one declaration in the schema).
  // Billing columns P4 writes (ADD COLUMN IF NOT EXISTS; P10 does not re-declare them). subscriptionSourceAt is P1 F4b's.
  trialOfferedAt           DateTime?
  pendingCheckoutSessionId String?          @db.VarChar(80)
  pendingCheckoutPlan      String?          @db.VarChar(16)
  pendingCheckoutAt        DateTime?
  lastCheckoutSource       String?          @db.VarChar(16)
  membershipEndedAt        DateTime?
  lastPaymentFailedAt      DateTime?
  lastPaymentFailureReason String?          @db.VarChar(120)
  linkedAccounts           LinkedAccount[]
  importRuns               ImportRun[]
}

// ---------- GamePlayer addition (M4; consistency R-01) ----------
model GamePlayer {
  // …P2/P3 fields…
  /// The account that imported this row; SET NULL on unlink, so purge works by (userId, source)
  linkedAccountId BigInt?
  linkedAccount   LinkedAccount? @relation(fields: [linkedAccountId], references: [id], onDelete: SetNull)
}

// JobKind: no change. IMPORT_SYNC and IMPORT_PURGE are in P3's M3 CREATE TYPE (consistency R-05).
```

No global `omit` is needed for P4's tables: they hold no secrets after D4-21. `WEB/lib/audit.ts` exports `audit(tx | null, entry)` (moved from P12 §10.3 by R-04): it inserts one `audit_logs` row, rejects `meta` keys matching `/email|token|password/i` in dev and test, and is used by the link and unlink routes, the webhook's duplicate-trial guard and every backfill.

### 6.2 Raw SQL in `M4`

```sql
SET lock_timeout = '5s';

-- Billing columns P4 writes (no-ops if P1 shipped any of them; P10 no longer re-declares them)
ALTER TABLE users ADD COLUMN IF NOT EXISTS "trialOfferedAt" TIMESTAMP(3),
                  ADD COLUMN IF NOT EXISTS "pendingCheckoutSessionId" VARCHAR(80),
                  ADD COLUMN IF NOT EXISTS "pendingCheckoutPlan" VARCHAR(16),
                  ADD COLUMN IF NOT EXISTS "pendingCheckoutAt" TIMESTAMP(3),
                  ADD COLUMN IF NOT EXISTS "lastCheckoutSource" VARCHAR(16),
                  ADD COLUMN IF NOT EXISTS "membershipEndedAt" TIMESTAMP(3),
                  ADD COLUMN IF NOT EXISTS "lastPaymentFailedAt" TIMESTAMP(3),
                  ADD COLUMN IF NOT EXISTS "lastPaymentFailureReason" VARCHAR(120),
                  ADD COLUMN IF NOT EXISTS "timeZone" VARCHAR(64) NOT NULL DEFAULT 'UTC',      -- R-03 (created here)
                  ADD COLUMN IF NOT EXISTS "gamesVersion" INTEGER NOT NULL DEFAULT 0;          -- AP-19 (no-op if P3 made it)

-- Safety net for the R-01 columns that M2/M3 own (§2.3). Every line is a no-op when M2/M3 shipped as ruled;
-- WP-A reports any line that actually changed the schema to the P2/P3 owner.
ALTER TABLE games ADD COLUMN IF NOT EXISTS "externalId" VARCHAR(40), ADD COLUMN IF NOT EXISTS "externalUrl" VARCHAR(120),
                  ADD COLUMN IF NOT EXISTS "whiteName" VARCHAR(40), ADD COLUMN IF NOT EXISTS "blackName" VARCHAR(40),
                  ADD COLUMN IF NOT EXISTS "whiteRating" SMALLINT,  ADD COLUMN IF NOT EXISTS "blackRating" SMALLINT,
                  ADD COLUMN IF NOT EXISTS "whiteTitle" VARCHAR(4),  ADD COLUMN IF NOT EXISTS "blackTitle" VARCHAR(4),
                  ADD COLUMN IF NOT EXISTS "ecoCode" VARCHAR(3),     ADD COLUMN IF NOT EXISTS "openingName" VARCHAR(80);
ALTER TABLE game_players ADD COLUMN IF NOT EXISTS "ecoCode" VARCHAR(3);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS "fairSeq" INTEGER NOT NULL DEFAULT 0,
                 ADD COLUMN IF NOT EXISTS "lastKickAt" TIMESTAMP(3);
CREATE UNIQUE INDEX IF NOT EXISTS games_source_externalId_key ON games (source, "externalId");

-- Link from an imported game_players row to its account (R-01: created here). NOT VALID now, validated in m4v.
ALTER TABLE game_players ADD COLUMN IF NOT EXISTS "linkedAccountId" BIGINT;
ALTER TABLE game_players ADD CONSTRAINT "game_players_linkedAccountId_fkey"
  FOREIGN KEY ("linkedAccountId") REFERENCES linked_accounts(id) ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
CREATE INDEX IF NOT EXISTS game_players_linked_account_idx ON game_players ("linkedAccountId") WHERE "linkedAccountId" IS NOT NULL;

-- One verified owner per external account (D4-10)
CREATE UNIQUE INDEX IF NOT EXISTS linked_accounts_verified_key
  ON linked_accounts (provider, "externalId") WHERE "verifiedAt" IS NOT NULL;
-- Backstop sweep for daily syncs whose job row was lost
CREATE INDEX IF NOT EXISTS linked_accounts_autosync_idx
  ON linked_accounts ("nextAutoSyncAt") WHERE "autoImport" AND status = 'ACTIVE';
-- At most one active run per account: makes "sync already running" race-free
CREATE UNIQUE INDEX IF NOT EXISTS import_runs_one_active
  ON import_runs ("linkedAccountId") WHERE status IN ('WAITING_FOR_MEMBERSHIP','QUEUED','RUNNING');
-- Entitlement fan-out: release waiting runs for one user
CREATE INDEX IF NOT EXISTS import_runs_waiting_idx
  ON import_runs ("userId") WHERE status = 'WAITING_FOR_MEMBERSHIP';

ALTER TABLE import_cursors ALTER COLUMN archives SET COMPRESSION lz4;
ALTER TABLE linked_accounts SET (fillfactor = 85);   -- counters and sync stamps are updated in place (HOT)
```

`m4a` (own file, first; both lines are no-ops when M2 created the values as consistency R-01 rules, and the `JobKind` lines of the first draft are gone because M3 has both values, R-05):

```sql
ALTER TYPE "GameMode"      ADD VALUE IF NOT EXISTS 'IMPORTED';
ALTER TYPE "GameEndMethod" ADD VALUE IF NOT EXISTS 'OTHER';
```

`m4v` (own file, last; `VALIDATE` takes only a `SHARE UPDATE EXCLUSIVE` lock, so live writes continue):

```sql
ALTER TABLE game_players VALIDATE CONSTRAINT "game_players_linkedAccountId_fkey";
```

Add to `DB/prisma/protected-indexes.txt`: `linked_accounts_verified_key`, `linked_accounts_autosync_idx`, `import_runs_one_active`, `import_runs_waiting_idx`, `game_players_linked_account_idx` (and `games_source_externalId_key` if P2 did not list it). P1/P3's `explain-check.ts` also fails when any index named in §6.3 is missing from `pg_indexes` after `migrate deploy` (api-perf §2.6).

### 6.3 Indexes and the queries they serve

| Index | Query (shape) | Used by |
|---|---|---|
| `linked_accounts_userId_provider_key` | `SELECT … FROM linked_accounts WHERE "userId" = $1` (≤ 2 rows); upsert `INSERT … ON CONFLICT ("userId", provider) DO UPDATE`; `DELETE … WHERE "userId" = $1 AND provider = $2` | `/api/me`, `GET /api/accounts`, link, unlink, the worker's run start |
| `linked_accounts_verified_key` (raw) | `SELECT "userId" FROM linked_accounts WHERE provider = $1 AND "externalId" = $2 AND "verifiedAt" IS NOT NULL AND "userId" <> $3` | link conflict check (`linked_elsewhere`); Lichess callback |
| `linked_accounts_provider_usernameLower_idx` | `… WHERE provider = 'CHESSCOM' AND "usernameLower" = $1 AND "userId" <> $2` | unverified co-claimants (audit log + Sentry breadcrumb only) |
| `linked_accounts_autosync_idx` (raw) | `SELECT id, "userId" FROM linked_accounts la WHERE "autoImport" AND status = 'ACTIVE' AND "nextAutoSyncAt" < now() - interval '1 hour' AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j."dedupeKey" = 'import:' \|\| la.id AND j.status IN ('QUEUED','RUNNING')) LIMIT 200` | the worker's boot and its daily housekeeping run (re-enqueue lost daily syncs; D4-27) |
| `import_cursors_pkey` | read once at run start, patched once per month/page inside the batch statement | worker |
| `import_runs_referenceId_key` | `UPDATE import_runs SET status = 'QUEUED' … WHERE "referenceId" = $1 AND "userId" = $2 AND status = 'FAILED' RETURNING id` | `POST /api/import/{ref}/retry` |
| `import_runs_userId_createdAt_idx` | `SELECT … FROM import_runs WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT 5`; the `/api/me` summary `… AND (status IN (active) OR "finishedAt" > now() - '1 day') LIMIT 1` | `/api/import/status`, `/api/me` |
| `import_runs_linkedAccountId_createdAt_idx` | `SELECT DISTINCT ON ("linkedAccountId") … WHERE "linkedAccountId" = ANY($1) ORDER BY "linkedAccountId", "createdAt" DESC` (≤ 2 accounts); the FK cascade on unlink | `GET /api/accounts`, unlink |
| `import_runs_one_active` (raw, unique) | `INSERT INTO import_runs (…, status 'QUEUED') …` fails with 23505 when a run is active → `409 sync_running`; the worker's "adopt the active run" lookup `WHERE "linkedAccountId" = $1 AND status IN (…)` | sync, link, worker |
| `import_runs_waiting_idx` (raw) | `UPDATE import_runs SET status = 'QUEUED' WHERE "userId" = $1 AND status = 'WAITING_FOR_MEMBERSHIP' RETURNING id, "linkedAccountId", trigger` | entitlement fan-out (§8.5.4) |
| `trial_ledger_pkey` | `SELECT 1 FROM trial_ledger WHERE "emailHash" = $1 OR "handleHashes" && $2::text[] LIMIT 1` (tiny table, seq scan on the array part is fine, data-model §5.1) | checkout eligibility; `/api/me` `trial.eligible` (cached per request) |
| `games_source_externalId_key` (M2) | the import batch `INSERT INTO games … ON CONFLICT (source, "externalId") DO UPDATE …` | worker |
| `game_players_userId_endedAt_gameId_idx` (M2, P2's name; D4-22) | purge `SELECT "gameId", "userId" FROM game_players WHERE "userId" = $1 AND source = $2 LIMIT 500`; archive source facets `GROUP BY source`; the per-member analysis budget count (§8.9) | `IMPORT_PURGE`, P3 archive, worker run start |
| `game_players_linked_account_idx` (M4, partial) | the `SET NULL` FK action when a link row is deleted | unlink |
| `game_players_pkey (gameId, userId)` + `game_players_gameId_color_key` (M2) | known-game filter join; the batch writer's `ON CONFLICT ("gameId", "userId") DO NOTHING` | worker |
| `jobs_dedupeKey_key` (M3) | `INSERT INTO jobs … ON CONFLICT ("dedupeKey") DO UPDATE … WHERE jobs.status <> 'RUNNING'` (`import:<linkedAccountId>`, `importpurge:<userId>:<provider>`, `analyze:<gameId>`); the kick CAS `UPDATE jobs SET "lastKickAt" = now() WHERE "dedupeKey" = $1 AND …` | link, sync, release, backlog release, status self-heal, worker |
| `jobs_ready_idx (priority DESC, "fairSeq", "runAt") WHERE status = 'QUEUED'` (M3) | P3's claim; P4's rows carry `fairSeq = rank` | worker |
| `audit_logs_category_at_idx`, `audit_logs_targetType_targetId_idx` (M4) | inserts only in P4 (link, unlink, co-claim, duplicate trial, backfills); P12's admin feed reads them | web |

### 6.4 JSON registry additions (`DB/json/*.ts`, zod with `v`)

| Column | Schema | Shape |
|---|---|---|
| `linked_accounts.ratings` | `RatingsV1` (`DB/json/ratings.ts`) | `{ v: 1, bullet?: {rating, best, games}, blitz?, rapid?, daily?, classical? }` (Lichess `ultraBullet` folds into `bullet`, `correspondence` into `daily`) |
| `linked_accounts.lastError`, `import_runs.error` | `ImportErrorV1` (`DB/json/import-error.ts`) | `{ v: 1, code: "not_found" \| "closed" \| "upstream" \| "timeout" \| "rate_limited" \| "internal", message: string ≤ 200, at: ISO, retryAt?: ISO, httpStatus?: number }` (`token_revoked` dropped with D4-21) |
| `import_cursors.archives` | `ArchivesV1` (`DB/json/import-cursor.ts`) | `{ v: 1, months: { "2026/10": { etag?, lastModified?, done: boolean, games: number, skipped: number } } }` |
| `jobs.payload` (`IMPORT_SYNC`) | `ImportSyncPayloadV1` (`DB/json/jobs.ts`) | `{ v: 1, linkedAccountId: string, runId: string \| null, trigger: "INITIAL" \| "MANUAL" \| "DAILY" \| "RETRY" }` |
| `jobs.payload` (`IMPORT_PURGE`) | `ImportPurgePayloadV1` | `{ v: 1, userId: string, provider: "CHESSCOM" \| "LICHESS", requestedAt: ISO }` |
| `jobs.payload` (`ANALYZE_GAME`, P3; schema in `CT/internal/jobs.ts`) | adds optional `evalHint: { source: "lichess", cp: number[] }` and `importRunId: string` | `evalHint`: white-POV cp per ply from the Lichess export, mate encoded as in `codec.ts`; lets P3 skip pass 1 (R-LI-08). `importRunId`: P3's final analysis batch appends `UPDATE import_runs SET analysed = analysed + 1 WHERE id = $importRunId` (a no-op after the run row is pruned). Both optional, so older payloads still parse; every payload keeps `v` (feasibility §9 rule 2) |

### 6.5 Migration files, order and safety

| # | Folder | Contents | Applied |
|---|---|---|---|
| m4a | `DB/prisma/migrations/<ts>_m4a_game_enum_safety/migration.sql` | the two `ADD VALUE IF NOT EXISTS` lines (no-ops when M2 is as ruled) | the Neon dev branch with `prisma migrate deploy` |
| M4 | `DB/prisma/migrations/<ts+1>_m4_import_onboarding/migration.sql` | generated `CREATE TYPE` / `CREATE TABLE` (incl. `audit_logs`) / `ALTER TABLE users ADD COLUMN …` for §6.1 + the raw SQL of §6.2 | same |
| m4v | `DB/prisma/migrations/<ts+2>_m4v_validate_linked_account_fk/migration.sql` | `VALIDATE CONSTRAINT` | same |

Procedure (data-model §11.2, allocation §1.3, consistency R-20):

1. Edit `schema.prisma`. Generate with `prisma migrate diff --from-migrations DB/prisma/migrations --to-schema-datamodel DB/prisma/schema.prisma --shadow-database-url postgresql://postgres:pw@localhost:55433/postgres --script` against a **local Docker Postgres 17** (no Neon branch, no CU-hours).
2. Move the enum lines into m4a. Hand-add §6.2 (Prisma cannot express partial indexes or `NOT VALID`); replace the generated `ADD COLUMN` lines for the billing columns, `timeZone`, `gamesVersion` and the R-01 safety columns with the `IF NOT EXISTS` forms, and the generated `game_players_linkedAccountId_fkey` with the `NOT VALID` form; add m4v.
3. `scripts/db/check-drift.ts` must report no drift except the protected names.
4. `prisma migrate deploy` from scratch on local Docker, run the seed, `pnpm --filter web check-types`, unit and integration tests.
5. Apply to **the Neon dev branch named in CLAUDE.md's environments table** (in the separate dev project once P1's AP-01 split lands; phase specs no longer hard-code branch ids, R-20) with `prisma migrate deploy` and the branch's direct URL. **Never `prisma migrate dev` against any Neon branch, and never `prisma db push`** (it would drop the hand-written partial indexes; R-20). CLAUDE.md rule 1 still recommends `db push` for prod; the owner updates it per R-20, and until then this spec follows the stricter rule. Never touch the old project `shy-morning-50748774` or the `production` branch; production gets m4a/M4/m4v in P13 through `migrate deploy` after a rehearsal on a child branch.
6. Deploy order (data-model §11.1 rule 6): migrate → deploy web (new Prisma client) → deploy the worker → turn on `import-v3` (the first writer of `IMPORT_SYNC` rows and of `GameMode.IMPORTED`). Old clients never read the new values.

Every change is additive: new tables, nullable or defaulted columns, enum values, indexes, one `NOT VALID` FK. **No contract step in P4.** `chess_com_profiles` is dropped in C4 (data-model §5.11) after P9/P10 stop reading it, with the owner's confirmation (CLAUDE.md rule 5). Rollback is in §14.4.

Table sizes are tiny (dev: < 50 users), so plain `CREATE INDEX` inside the migration is fine; nothing needs `CONCURRENTLY`.

### 6.6 Backfills (`WEB/scripts/backfill/*.ts`; dry run by default, `--apply`, batches of 500, refuse unless the host is in `BACKFILL_ALLOWED_HOSTS`, one `audit_logs` row each through `audit(null, {category: SYSTEM, action: "backfill.<name>", actorKind: SYSTEM, meta: counts})`)

| ID | Script | Source → target | Predicate | Verification |
|---|---|---|---|---|
| B5 | `linked-accounts.ts` | `chess_com_profiles` → `linked_accounts` (`CHESSCOM`, `username` = handle, `usernameLower`, `externalId` = handle until the first sync replaces it with `player_id`, `ratings` from the 20 rating columns, `displayName`, `avatarUrl`, `countryCode`, `title`, `joinedAt`, `verifiedAt` NULL, `importState` IDLE); with `--queue-imports` also an `ImportRun(INITIAL, WAITING_FOR_MEMBERSHIP)` per link, then `releaseWaitingImports()` for entitled users (throttled 1 user/s) | `NOT EXISTS (SELECT 1 FROM linked_accounts la WHERE la."userId" = p."userId" AND la.provider = 'CHESSCOM')` | one link per profile; `--queue-imports` is a P13 owner decision (OD-1) |
| B6 | `onboarding.ts` | `onboardingStep = 'DONE'`, `onboardedAt = "updatedAt"` where `onboarded` | `"onboardingStep" = 'WELCOME' AND onboarded` | 0 rows match afterwards |
| B9 | `trial-ledger.ts` | users with `trialStartedAt` → `trial_ledger(emailHash)` via `trialLedgerEmailHash()` and `HASH_PEPPER` (+ `handleHashes` from their links) | `INSERT … ON CONFLICT ("emailHash") DO NOTHING` | count = users with a used trial |
| B12 | `clerk-onboarded-claims.ts` | for `onboarded = true` users: Clerk `updateUserMetadata(googleId, { publicMetadata: { onboarded: true } })` (merge), 5 requests/s | users whose Clerk `publicMetadata.onboarded !== true` | a sample of 20 users shows the claim in a fresh session token |

On dev all four run once after M4. On production they run in P13.

### 6.7 Dev seed (`DB/prisma/seed/personas.ts`, data-model §13.4)

| Persona | Changes in P4 | Board states |
|---|---|---|
| `new` | `onboardingStep = LINK`, no link | Link `default`; Connected `none_linked` |
| `trial` | Chess.com `knightowl_88` link (`ratings` rapid 1184 / blitz 1032 / bullet 871, the `V3OnbPreview` values; `totalRatedGames 480`), active `ImportRun(INITIAL, RUNNING, phase saving, imported 212, total 480)`, `importState RUNNING` | Done `importing`; Connected `syncing`; archive `import_running` |
| `member` | Chess.com + Lichess (`knightowl88`, verified, blitz 1402) links, last runs `DONE`, `importedCount` 480 / 96 | Connected `both_linked`; Done `imported` |
| `syncfailed` | Chess.com link `importState FAILED`, `lastError {code: upstream}`, `lastSyncOkAt` = 2 h ago; Lichess link `importState RATE_LIMITED`, `nextAllowedSyncAt` = now + 30 s at seed time | Connected `sync_failed`, `rate_limited`; Done `import_failed` |
| `privategames` (new) | Chess.com link, last run `DONE` with `seen 480, imported 312, skipped 168`, `skippedCount 168` | Connected `private_games` |
| `onbplan` (new) | `onboardingStep = PLAN`, band and goals set, trial eligible | Plan `default` |
| `onbused` (new) | as `onbplan` but `trialStartedAt` = 60 days ago, `subscriptionStatus = cancelled` | Plan trial-used variant; Welcome item 04 variant |

Seeded games for `trial` and `member` reuse the 60 CC0 Lichess fixture games (data-model §13.5) re-labelled `source = CHESSCOM` for half of them, inserted through `CI`'s mappers so the seed exercises the real parser. "Sync now" on seeded personas hits the real providers on dev (the handles are fictional, so Chess.com returns 404 → `not_found` error, which is itself a useful state) and the upstream mock in CI.

**E2E lease pool (testing X4).** The same writers are registered as persona reset modes in `WEB/e2e/personas/p04.ts` (or P1's `scripts/dev/personas.ts` if the registry directory does not exist) and applied to a leased pool user with `--reset <pool user> --persona <name>`. A reset deletes the user's `linked_accounts` (cascades cursors and runs), imported games (`IMPORT_PURGE` logic inline, `source <> 'REPLAY'`), the user's queued jobs, **both kinds of `trial_ledger` rows** (the email hash and every handle hash of the user's links), sets `dodoCustomerId`, `subscription*`, `trial*` and `pendingCheckout*` to the persona's values, and syncs Clerk claims. Shared users A–R are never reset.

| Pool persona | Seed equivalent | Used by |
|---|---|---|
| `onboarding-fresh` | `new`, but `onboardingStep = WELCOME`, never trialled, `dodoCustomerId` NULL | happy path, Lichess, link errors, resume and guards |
| `onboarding-plan` | `onbplan` | plan states, checkout failed |
| `onboarding-trial-used` | `onbused` | trial-used spec (replaces the first draft's `--fresh Q`) |
| `import-trial` | `trial` | archive lights-up, Done `importing` |
| `connected-none-member` | member with no links | connected accounts happy path |
| `connected-both` | `member` | `both_linked`, disconnect |
| `connected-syncfailed` | `syncfailed` | `sync_failed`, `rate_limited` |
| `connected-privategames` | `privategames` | `private_games` |
| `connected-nonmember` | onboarded, never trialled, no links | non-member settings spec |

### 6.8 Storage (data-model §10)

| Rows per typical member per year | Bytes | MB |
|---|---|---|
| `games` imported (12-month window, ≈ 600; `pgn` NULL, D4-30) | ≈ 1,176 B each | 0.70 |
| `game_players` for them | ≈ 199 B | 0.12 |
| `linked_accounts` (1–2) | ≈ 900 B | < 0.01 |
| `import_cursors` (12 months JSON, lz4) | ≈ 1.5 KB | < 0.01 |
| `import_runs` (pruned: DONE/CANCELLED after 30 days, FAILED after 90; DAILY runs with 0 new games are never inserted) | ≈ 160 B × ≤ 40 | < 0.01 |
| `jobs` (`ANALYZE_GAME` rows for ≤ 200 imports per member, pruned 7 days after DONE) | transient | — |
| `audit_logs` (link, unlink, rare co-claims) | ≈ 200 B × a few | < 0.01 |

The 2,000-game cap bounds a heavy first import at ≈ 2.8 MB. Housekeeping rule P11 (data-model §10.4: unanalysed imported games older than 12 months) is what keeps the window rolling; it ships with P3/P5's housekeeping job, P4 only adds **P22**: `DELETE FROM import_runs WHERE (status IN ('DONE','CANCELLED') AND "finishedAt" < now() - interval '30 days') OR (status = 'FAILED' AND "finishedAt" < now() - interval '90 days')`, and P23: cancel `WAITING_FOR_MEMBERSHIP` runs older than 30 days (`UPDATE … SET status = 'CANCELLED'`), both in the daily cron's `prune` task.

---

## 7. API

### 7.0 Route catalogue

Every route is a `route()` handler (P1 F1) with an explicit `maxDuration`. Auth: `U` signed in (member or not), `M` member (402 `subscription_required` with `details.reason`), `I` internal (verified by `verifyInternal()` from `CT/internal/auth.ts`, D4-24), `W` webhook signature, `C` cron bearer. Class per optimization §2.1 (R1 session read, W1 small write, W2 multi-row write, X third-party bound, WH webhook). Cache tiers are P1's names (`private-etag` = `private, no-cache` + strong ETag; `no-store`). Rate limits use P1's fixed-window limiter, written as `{bucket, limit, windowSec, by, store}` (consistency R-13); every P4 window is ≤ 60 s, so all buckets use `store: "burst"` on the `UNLOGGED` table, which is safe to empty when Neon suspends (api-perf AP-11). Keys are `rl:<bucket>:u:<userRef>` (and `:ip:<hash16>` where noted).

| ID (api-design alias) | Method · path | Auth | Class | RL (`limit / windowSec`, by) | Idempotency | Cache | `maxDuration` | Status |
|---|---|---|---|---|---|---|---|---|
| ACC-1 | `GET /api/accounts` | U | R1 | — | — | `private-etag` | 10 | NEW |
| ACC-2 | `POST /api/accounts/chesscom/lookup` | U | X | `lookup` 10 / 60 s by user, and 30 / 60 s by IP | natural (read) | `no-store`; upstream cached 600 s server-side (web and worker, D4-23) | 15 | NEW (replaces `POST /api/user/chess-com-profile/preview`) |
| ACC-3 | `POST /api/accounts/chesscom` | U | X | `link` 5 / 60 s by user | `Idempotency-Key` required | `no-store` | 15 | NEW (replaces `POST /api/user/chess-com-profile`) |
| OAU-1 | `GET /api/accounts/lichess/start?returnTo=` | U | — | `link` 5 / 60 s by user | — | `no-store` | 10 | NEW |
| OAU-2 | `GET /api/accounts/lichess/callback` | U | X | — | state + signed cookie | `no-store` | 15 | NEW |
| ACC-4 | `POST /api/accounts/{provider}/sync` | M | W2 | `sync` 1 / 30 s by user + provider | natural (one active run) | `no-store` | 10 | NEW |
| ACC-5 | `PATCH /api/accounts/{provider}` | U | W1 | `settings` 30 / 60 s by user | natural | `no-store` | 10 | NEW |
| ACC-6 | `DELETE /api/accounts/{provider}?deleteGames=0\|1` | U | W2 | `link` 5 / 60 s by user | natural | `no-store` | 15 | NEW |
| ACC-7 | `GET /api/import/status` | U | R1 (+ registered side effect `kick_cas`, D4-31) | — | — | `private-etag` | 10 | NEW |
| ACC-8 | `POST /api/import/{ref}/retry` | M | W2 | `sync` 1 / 30 s by user + run | natural | `no-store` | 10 | NEW |
| ME-4 | `PATCH /api/me/onboarding` | U | W1 (X with `complete`) | `onboarding` 60 / 60 s by user | natural (monotonic) | `no-store` | 10 | NEW (replaces `POST /api/user/onboarding-skip`) |
| ME-1 | `GET /api/me` | U | R1 | — | — | `private-etag` (consistency 4.12, api-perf AP-22) | 10 | CHANGE (adds `accounts`, `import`, `onboarding`, `user.timeZone`) |
| BIL-1 | `POST /api/checkout` | U | X | `checkout` 6 / 60 s by user | `Idempotency-Key` required | `no-store` | 30 | CHANGE |
| BIL-2 | `GET /api/billing/activation` | U | R1 (X when it calls Dodo) | `billing-refresh` 40 / 60 s by user; Dodo calls further limited by `dodo-activation` 1 / 5 s by user | natural | `no-store` | 15 | NEW (replaces `waitForEntitlement`) |
| WH-1 | `POST /api/webhook/dodo-payments` | W | WH | — | `WebhookEvent` (P1) | — | 15 | CHANGE (fan-out) |
| DEV-1 | `POST /api/dev/import-fault` | admin or `x-e2e-token`, and `testHooksEnabled()` (`isNonProd()` + `ALLOW_TEST_HOOKS=1`); 404 elsewhere; listed in the test-hook registry | — | — | — | `no-store` | 10 | NEW (test hook) |
| CRON-1 | `GET /api/cron/daily` (P1) | C | — | — | idempotent tasks | — | 60 | CHANGE (prune P22/P23, stale checkout; as task files `WEB/lib/cron/tasks/{import-prune,stale-checkout}.ts` if P1 made the cron a task list) |

### 7.1 Contracts (`CT/http/accounts.ts`, `CT/http/import.ts`, `CT/http/onboarding.ts`, additions to `CT/http/billing.ts` and `CT/http/me.ts`)

```ts
// CT/http/accounts.ts
import { z } from "zod";

export const ProviderSlug = z.enum(["chesscom", "lichess"]);
export const TimeClassSlug = z.enum(["bullet", "blitz", "rapid", "classical", "daily"]);
/** Plain constant so client components validate without importing zod (api-perf AP-12) */
export const CHESSCOM_USERNAME_RE = /^[A-Za-z0-9_-]{3,25}$/;
export const ChessComUsername = z.string().trim()
  .transform((s) => s.replace(/^@/, ""))
  .pipe(z.string().regex(CHESSCOM_USERNAME_RE, "Chess.com usernames are 3–25 letters, digits, - or _."));
/** IANA zone, checked against Intl.supportedValuesOf("timeZone") on the server */
export const TimeZone = z.string().max(64).refine((tz) => Intl.supportedValuesOf("timeZone").includes(tz) || tz === "UTC", "unknown time zone");

const RatingEntry = z.object({ rating: z.int(), best: z.int().nullable(), games: z.int().min(0) });
export const RatingsView = z.object({
  bullet: RatingEntry, blitz: RatingEntry, rapid: RatingEntry, classical: RatingEntry, daily: RatingEntry,
}).partial();
export const Headline = z.object({ timeClass: TimeClassSlug, rating: z.int() }).nullable();  // "Blitz 1179"

export const LookupBody = z.object({ username: ChessComUsername }).strict();
export const LookupData = z.object({
  status: z.enum(["found", "private", "no_games"]),
  profile: z.object({
    username: z.string(), displayUsername: z.string(), name: z.string().nullable(),
    avatarUrl: z.url().nullable(), countryCode: z.string().length(2).nullable(),
    joinedAt: z.iso.datetime().nullable(), title: z.string().max(4).nullable(),
  }),
  ratings: RatingsView, headline: Headline, totalRatedGames: z.int().min(0),
});

export const ImportErrorCode = z.enum(["not_found", "closed", "upstream", "timeout", "rate_limited", "internal"]);
export const ImportErrorView = z.object({ code: ImportErrorCode, at: z.iso.datetime(), retryAt: z.iso.datetime().nullable() });
export const RunView = z.object({
  ref: z.string(), provider: ProviderSlug, trigger: z.enum(["initial", "manual", "daily", "retry"]),
  status: z.enum(["waiting_for_membership", "queued", "running", "done", "failed", "cancelled"]),
  phase: z.enum(["reading", "saving"]).nullable(),
  seen: z.int(), total: z.int().nullable(), imported: z.int(), skipped: z.int(),
  analysisQueued: z.int(), analysed: z.int(),
  error: ImportErrorView.nullable(),
  startedAt: z.iso.datetime().nullable(), finishedAt: z.iso.datetime().nullable(), updatedAt: z.iso.datetime(),
});
export const LinkViewStatus = z.enum(["linked", "waiting_for_membership", "queued", "syncing", "rate_limited", "error"]);
export const LinkedAccountView = z.object({
  provider: ProviderSlug, username: z.string(), displayName: z.string().nullable(), avatarUrl: z.url().nullable(),
  title: z.string().nullable(), ratings: RatingsView, headline: Headline, totalRatedGames: z.int().nullable(),
  verified: z.boolean(), status: LinkViewStatus, autoImport: z.boolean(),
  lastSyncAt: z.iso.datetime().nullable(), lastSyncOkAt: z.iso.datetime().nullable(),
  nextAllowedSyncAt: z.iso.datetime().nullable(), nextAutoSyncAt: z.iso.datetime().nullable(),
  importedCount: z.int(), skippedCount: z.int(), lastError: ImportErrorView.nullable(), run: RunView.nullable(),
});
export const AccountsData = z.object({ items: z.array(LinkedAccountView).max(2) });

export const LinkChessComBody = z.object({ username: ChessComUsername, context: z.enum(["onboarding", "settings"]) }).strict();
export const LinkData = z.object({ account: LinkedAccountView, run: RunView.nullable(), onboarding: z.lazy(() => OnboardingView).nullable() });
export const ProviderParams = z.object({ provider: ProviderSlug });
export const SyncData = z.object({ run: RunView });
export const PatchAccountBody = z.object({ autoImport: z.boolean(), timeZone: TimeZone.optional() }).strict();
export const UnlinkQuery = z.object({ deleteGames: z.enum(["0", "1"]).default("0") });
export const UnlinkData = z.object({ removed: z.literal(true), purge: z.object({ games: z.int() }).nullable() });
export const LichessStartQuery = z.object({ returnTo: z.enum(["/onboarding/link", "/settings/connected"]).default("/settings/connected") });
export const LichessCallbackQuery = z.union([
  z.object({ code: z.string().min(1).max(512), state: z.string().min(16).max(128) }),
  z.object({ error: z.string().max(64), state: z.string().max(128).optional(), error_description: z.string().max(300).optional() }),
]);

// CT/http/import.ts
export const ImportStatusData = z.object({
  runs: z.array(RunView).max(5),
  firstReview: z.object({ gameRef: z.string(), analysisStatus: z.enum(["none", "queued", "running", "done", "failed", "skipped"]), momentsCount: z.int().nullable() }).nullable(),
});
export const RunRefParams = z.object({ ref: z.string().regex(/^c[a-z0-9]{24}$/) });   // cuid

// CT/http/onboarding.ts — wire enums are lowercase (consistency R-17); the DB keeps the uppercase Postgres enum
export const OnboardingStep = z.enum(["welcome", "link", "confirm", "level", "goals", "plan", "activating", "done"]);
export const RatingBand = z.enum(["new_to_chess", "under_800", "r800_1200", "r1200_1600", "r1600_2000", "r2000_plus"]);
export const Goal = z.enum(["stop_blundering", "learn_openings", "improve_endgames", "study_legends", "play_friends"]);
/** toWire("R800_1200") === "r800_1200"; fromWire("r800_1200") === "R800_1200"; round-trip unit test over every value */
export const toWire = (v: string) => v.toLowerCase();
export const fromWire = <T extends string>(v: string) => v.toUpperCase() as T;
export const RatingBandSource = z.string().regex(/^(self|chesscom:(bullet|blitz|rapid|daily)|lichess:(bullet|blitz|rapid|classical|daily))$/);
export const PatchOnboardingBody = z.object({
  step: OnboardingStep.exclude(["done"]).optional(),
  ratingBand: RatingBand.nullable().optional(),
  ratingBandSource: RatingBandSource.optional(),
  initialRating: z.int().min(100).max(3000).optional(),
  goals: z.array(Goal).max(5).refine((g) => new Set(g).size === g.length, "duplicate goal").optional(),
  dailyMinutes: z.union([z.literal(5), z.literal(10), z.literal(20)]).optional(),
  timeZone: TimeZone.optional(),
  complete: z.literal(true).optional(),
}).strict().refine((b) => !(b.complete && b.step), "step and complete are exclusive");
export const OnboardingView = z.object({
  step: OnboardingStep, done: z.boolean(), ratingBand: RatingBand.nullable(), ratingBandSource: z.string().nullable(),
  initialRating: z.int().nullable(), goals: z.array(Goal), dailyMinutes: z.union([z.literal(5), z.literal(10), z.literal(20)]).nullable(),
  onboardedAt: z.iso.datetime().nullable(),
});

// CT/http/billing.ts (additions)
export const CheckoutBody = z.object({
  plan: z.enum(["monthly", "yearly"]), source: z.enum(["pricing", "onboarding", "paywall", "renew"]),
  returnPath: z.string().max(512).optional(), theme: z.enum(["dark", "light", "system"]).optional(),
}).strict();
export const CheckoutData = z.object({
  checkoutUrl: z.url(), sessionId: z.string(), trial: z.boolean(), chargeDate: z.iso.datetime().nullable(),
  priceCents: z.int(), currency: z.literal("USD"), interval: z.enum(["month", "year"]),
});
export const ActivationQuery = z.object({
  session_id: z.string().max(80).optional(), subscription_id: z.string().max(80).optional(),
  status: z.string().max(32).optional(), force: z.literal("1").optional(),
});
export const ActivationData = z.object({
  state: z.enum(["pending", "active", "failed"]), reason: z.enum(["declined", "cancelled"]).nullable(),
  entitlement: ViewerEntitlement,                                   // CT/http/me (P1)
  trial: z.object({ active: z.boolean(), endsAt: z.iso.datetime().nullable(), chargeDate: z.iso.datetime().nullable() }),
  plan: z.object({ interval: z.enum(["month", "year"]), priceCents: z.int(), legacy: z.boolean() }).nullable(),
  emailMasked: z.string().nullable(), reference: z.string().nullable(), waitedMs: z.int().min(0),
});

// CT/http/me.ts (additions to MeData; additive, consistency R-03)
//   user.timeZone: string                                     (IANA, default "UTC")
//   onboarding: OnboardingView
//   accounts: { provider, username, status: LinkViewStatus, lastSyncAt }[] (≤ 2)
//   import: { ref, provider, status, phase, imported, total } | null   (active run, or one finished in the last 24 h)

// CT/internal/provider.ts (web → worker lookup fallback, D4-23)
export const InternalLookupBody = z.object({ v: z.literal(1), username: ChessComUsername, what: z.enum(["profile+stats", "archives+month"]), month: z.string().regex(/^\d{4}\/\d{2}$/).optional() }).strict();
export const InternalLookupData = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("found"), profile: z.unknown(), stats: z.unknown().optional(), archives: z.array(z.string()).optional(), month: z.unknown().optional() }),
  z.object({ kind: z.literal("private") }), z.object({ kind: z.literal("not_found") }),
  z.object({ kind: z.literal("rate_limited"), retryAfterSec: z.int() }),
]);   // raw Chess.com bodies are re-validated by CI's strict schemas on the web side
```

Every response is `{ data }`; errors are `{ error: { code, message, details?, retryAfterSec?, requestId } }` (B16). Response schemas are validated in dev and test only (P1 wrapper).

### 7.2 Viewer and onboarding

#### `GET /api/me` (changed)

The P1 `getMe()` select gains (one round trip with `relationLoadStrategy: "join"`):

```ts
onboardingStep: true, onboardedAt: true, ratingBand: true, ratingBandSource: true, initialRating: true, goals: true, dailyMinutes: true, timeZone: true,
linkedAccounts: { select: { provider: true, username: true, status: true, importState: true, lastSyncAt: true, nextAllowedSyncAt: true } },
importRuns: {
  where: { OR: [{ status: { in: ["WAITING_FOR_MEMBERSHIP", "QUEUED", "RUNNING"] } }, { finishedAt: { gt: dayAgo } }] },
  orderBy: { createdAt: "desc" }, take: 1,
  select: { referenceId: true, provider: true, status: true, phase: true, imported: true, total: true },
},
```

Index: `linked_accounts_userId_provider_key`, `import_runs_userId_createdAt_idx`. The payload grows by ≈ 320 B. `trial.eligible` additionally consults the trial ledger (one PK/array probe, §8.4) only when the user row says eligible, so members pay nothing. The ETag stays P1's hash of the serialised `data`, so a progress update changes it and a quiet poll gets a 304.

#### `PATCH /api/me/onboarding`

- Body `PatchOnboardingBody`, response `{ onboarding: OnboardingView }` (wire enums mapped with `fromWire()` / `toWire()`, D4-25).
- **Step is monotonic** (§8.1). One statement (`$10` = `timeZone`, written only when present):

```sql
UPDATE users SET
  "onboardingStep" = CASE WHEN $1::text IS NOT NULL
      AND array_position($2::text[], $1::text) > array_position($2::text[], "onboardingStep"::text)
    THEN $1::"OnboardingStep" ELSE "onboardingStep" END,
  "ratingBand"       = CASE WHEN $3::boolean THEN $4::"RatingBand" ELSE "ratingBand" END,   -- $3 = field present
  "ratingBandSource" = COALESCE($5, "ratingBandSource"),
  "initialRating"    = COALESCE($6, "initialRating"),
  goals              = COALESCE($7::"OnboardingGoal"[], goals),
  "dailyMinutes"     = COALESCE($8, "dailyMinutes"),
  "timeZone"         = COALESCE($10, "timeZone"),
  "updatedAt"        = now()
WHERE id = $9
RETURNING "onboardingStep", onboarded, "onboardedAt", "ratingBand", "ratingBandSource", "initialRating", goals, "dailyMinutes", "timeZone";
-- $2 = '{WELCOME,LINK,CONFIRM,LEVEL,GOALS,PLAN,ACTIVATING,DONE}'
```

- **`complete: true`**: requires DB entitlement (`isEntitled(user)`, or admin, or `BILLING_PAYWALL=off`), else `409 conflict {reason: "plan_required"}`. Then `UPDATE users SET onboarded = true, "onboardedAt" = COALESCE("onboardedAt", now()), "onboardingStep" = 'DONE' WHERE id = $1`; **awaited** `syncClerkClaims(user.id)` (P1's signature; it recomputes `onboarded` from the row just written) raced against `AbortSignal.timeout(3000)` (D4-16; on timeout it is retried in `after()`); `Set-Cookie: rc_onb=<hmac>; Max-Age=120; HttpOnly; Secure; SameSite=Lax; Path=/` (§8.14). `after()`: PostHog server `onb_completed_server {trial, linked_providers}`.
- Errors: `validation_failed`, `conflict (plan_required)`, `rate_limited`.

### 7.3 Accounts

#### 7.3.1 `POST /api/accounts/chesscom/lookup`

1. Parse `LookupBody`; RL `lookup` (user and IP).
2. `chesscomLookup(usernameLower)` in `WEB/lib/accounts/chesscom.ts`:
   - `unstable_cache(fn, ["cc-lookup", u], { revalidate: 600, tags: ["chesscom:" + u] })`. The cached value is a discriminated union `{kind: "found" | "private" | "not_found", profile?, stats?}`; **a `not_found` is cached too** (repeat typos cost nothing), while 429, 5xx and timeouts throw and are never cached.
   - Inside, **serially** (R-CC-02, fixes `lib/chess-com.ts:52`): `CI.chesscom.getProfile(u)` then, if found and not closed, `CI.chesscom.getStats(u)`. Each call: `encodeURIComponent(u)`, `AbortSignal.timeout(5000)`, `User-Agent: ReplayChess/1.0 (+https://playchess.tech; hello@playchess.tech)`.
   - Profile `404` → `not_found`; `410` or `status` ∈ {`closed`, `closed:fair_play_violations`} → `private`.
   - **Worker fallback (D4-23, feasibility F-API-1).** If either web call gets 429 or 403 (Vercel's egress IPs are shared with other tenants), the function calls `internalFetch("worker", "/internal/provider/chesscom/lookup", {v: 1, username: u, what: "profile+stats"})` with a 6 s budget. The worker serves it through its Chess.com gate (one request at a time, one IP, the same User-Agent) and its own 600 s LRU (≤ 2,000 entries), and returns `InternalLookupData`. A worker `rate_limited` becomes our 429 with `details.source: "chesscom"`; a worker timeout or 5xx becomes 502. The cached value records `source: "web" | "worker"` for the metric `import.lookup_source`.
3. Conflict: `SELECT "userId" FROM linked_accounts WHERE provider = 'CHESSCOM' AND "externalId" = $playerId AND "verifiedAt" IS NOT NULL AND "userId" <> $me` → `409 conflict {reason: "linked_elsewhere"}`.
4. Map to `LookupData`: `totalRatedGames = Σ (record.win + record.loss + record.draw)` over `chess_rapid`, `chess_blitz`, `chess_bullet`, `chess_daily`; `headline` = the time class `suggestBand()` would pick (§8.2); `status = "no_games"` when the total is 0. `profile.avatarUrl` is returned but the UI renders initials (D4-26).
5. Errors: `404 not_found`; `409 conflict (linked_elsewhere)`; `429 rate_limited` (`details.source: "replay"` from our bucket, `"chesscom"` when the web call and the worker fallback were both limited, `retryAfterSec = Retry-After ?? 30`); `502 upstream_unavailable {provider: "chesscom", kind: "error" | "timeout"}` (one status per code, consistency R-06).
6. Telemetry: span `accounts.lookup`, tags `cache: hit | miss`, `source: web | worker`.

#### 7.3.2 `POST /api/accounts/chesscom`

1. Parse `LinkChessComBody`; RL `link`; idempotency (P2's `idempotency_keys`, scope `link-chesscom`).
2. Lookup through the same cached function (normally a cache hit from step 7.3.1). `not_found` → 404; `private` → `409 conflict {reason: "profile_closed"}` (settings) — onboarding never links a private profile (§4.2).
3. Interactive transaction (`prisma.$transaction`, ≤ 7 statements, all in iad1 next to Neon):
   1. `SELECT id, "externalId" FROM linked_accounts WHERE "userId" = $me AND provider = 'CHESSCOM' FOR UPDATE`. Same `externalId` → idempotent success (return it, status 200). Different → `409 conflict {reason: "already_linked"}`.
   2. Verified elsewhere → `409 linked_elsewhere` (re-checked inside the transaction).
   3. `INSERT INTO linked_accounts (…, "externalId" = player_id, username = profile.username, "usernameLower", "displayName", "avatarUrl", "countryCode", title, "joinedAt", ratings, "totalRatedGames", "importState") RETURNING id`.
   4. `INSERT INTO import_cursors ("linkedAccountId", provider) VALUES ($id, 'CHESSCOM')`.
   5. `INSERT INTO import_runs (…, trigger 'INITIAL', status $s) RETURNING "referenceId"`, `$s = entitled ? 'QUEUED' : 'WAITING_FOR_MEMBERSHIP'`; `importState` set to match.
   6. If entitled: P3's `enqueueJob(tx, {kind: 'IMPORT_SYNC', priority: JOB_PRIORITY.IMPORT_SYNC_INITIAL, dedupeKey: 'import:' + id, userId, payload: ImportSyncPayloadV1{runId}})` from `DB/src/jobs.ts`, which is `INSERT … ON CONFLICT ("dedupeKey") DO UPDATE SET status = 'QUEUED', "runAt" = now(), priority = GREATEST(jobs.priority, EXCLUDED.priority), payload = EXCLUDED.payload, attempts = 0 WHERE jobs.status <> 'RUNNING'`.
   7. If `context = "onboarding"`: the monotonic step update to `LEVEL` plus `"ratingBand" = COALESCE("ratingBand", $band), "ratingBandSource" = COALESCE(…), "initialRating" = COALESCE(…)` from `suggestBand()`.
4. `after()`: `kickWorker({reason: "import"})` if entitled; dual-write `chess_com_profiles` (upsert by `userId`, the old 26 columns from profile + stats; a P2002 on `chessComHandle @unique` is logged and skipped, never surfaced); `audit(null, {category: ACCOUNT, action: "account.linked", actorKind: USER, actorUserId, targetType: "linked_account", targetId: provider, meta: {verified: false}})`; when an unverified co-claimant exists, `audit(… "account.link_coclaim" …)` (refs only, no handle); `revalidateTag("chesscom:" + u)`; PostHog `account_linked {provider, context, is_verified, total_rated_games_bucket}`.
5. Response `201 LinkData` (200 on the idempotent re-link).

#### 7.3.3 Settings link path

`/settings/connected` calls the same endpoint with `context: "settings"`; there is no separate lookup round trip (the board goes straight from "Looking up…" to syncing). `404` renders `not_found`, `409 profile_closed` renders "This Chess.com account is closed, so its games can't be imported."

#### 7.3.4 `GET /api/accounts/lichess/start?returnTo=`

1. Signed out → 302 to `/sign-in?redirect_url=<returnTo>`. RL `link` exceeded → 302 `returnTo?lichess=error&reason=rate_limited`.
2. `verifier = base64url(randomBytes(48))` (64 chars), `challenge = base64url(sha256(verifier))`, `state = base64url(randomBytes(24))`.
3. `Set-Cookie: rc_lichess_pkce=<payload>.<sig>; Path=/api/accounts/lichess; Max-Age=600; HttpOnly; Secure; SameSite=Lax`, where payload = base64url(JSON `{v:1, verifier, state, returnTo, sub: clerkUserId, exp}`) and sig = HMAC-SHA256(`SIGNED_COOKIE_SECRET`) (a route handler, so it may set cookies; D4-29).
4. 302 to `${LICHESS_BASE_URL}/oauth?response_type=code&client_id=${LICHESS_CLIENT_ID}&redirect_uri=${origin}/api/accounts/lichess/callback&code_challenge_method=S256&code_challenge=${challenge}&state=${state}` (no `scope`: R-LI-04).

#### 7.3.5 `GET /api/accounts/lichess/callback`

1. Verify the cookie signature, `exp`, `sub === clerkUserId`, and `state` (timing-safe). Any mismatch → 302 `returnTo?lichess=error&reason=state`. Always clear the cookie.
2. `?error=access_denied` → 302 `returnTo?lichess=denied`. Other `error` → `?lichess=error&reason=upstream`.
3. `POST ${LICHESS_BASE_URL}/api/token` (`application/x-www-form-urlencoded`: `grant_type=authorization_code`, `code`, `code_verifier`, `redirect_uri`, `client_id`; 8 s timeout) → `{access_token, token_type, expires_in}`. The token lives only in this function's memory.
4. `GET /api/account` with `Authorization: Bearer …` → `{id, username, title?, perfs, createdAt, profile?.flag, count.rated, disabled?, tosViolation?}`. This is the ownership proof.
5. **Revoke at once (D4-21):** `DELETE ${LICHESS_BASE_URL}/api/token` with the same Bearer (5 s timeout, 204 expected), in a `finally` around steps 4–6 so it runs on every path (success, conflict, DB error). A failed revoke is retried once, then logged as the Sentry warning `lichess.revoke_failed` (the token is scope-less and expires on its own; nothing was stored).
6. Conflicts: verified link to this `id` by another user → `?lichess=error&reason=linked_elsewhere`. This user already has a Lichess link with another `id` → `reason=already_linked`.
7. Transaction: upsert `linked_accounts` (`verifiedAt = now()`, `externalId = id`, `username`, `usernameLower`, `ratings` from `perfs`, `totalRatedGames = count.rated`, `title`, `countryCode` from `profile.flag`, `joinedAt = createdAt`); `import_cursors`; `import_runs (INITIAL)` and the job as in 7.3.2; for `returnTo = /onboarding/link` the monotonic step update to `CONFIRM` plus the band suggestion with `COALESCE`.
8. `after()`: kick, `audit(… "account.linked" …, meta: {verified: true})`, PostHog `account_linked`.
9. 302: onboarding → `/onboarding/confirm?provider=lichess`; settings → `/settings/connected?lichess=linked`. Upstream failure at step 3 or 4 → `?lichess=error&reason=upstream`.

#### 7.3.6 `POST /api/accounts/{provider}/sync` (member)

1. RL `sync` keyed `u:<ref>:<provider>`; `nextAllowedSyncAt > now()` → `429 rate_limited {source: provider}` with `retryAfterSec`.
2. Transaction: `INSERT INTO import_runs (…, trigger 'MANUAL', status 'QUEUED')` (23505 on `import_runs_one_active` → `409 conflict {reason: "sync_running"}`); the job upsert with `priority = JOB_PRIORITY.IMPORT_SYNC_MANUAL`, `"runAt" = now()` (returns no row when the job is `RUNNING` → roll back, `409 sync_running`); `UPDATE linked_accounts SET "importState" = 'QUEUED'`.
3. `after()`: kick. Response `202 {run}`. No account → 404.

#### 7.3.7 `PATCH /api/accounts/{provider}`

When the body carries `timeZone`, the same transaction first runs `UPDATE users SET "timeZone" = $tz WHERE id = $me`. Then `UPDATE linked_accounts SET "autoImport" = $v, "nextAutoSyncAt" = $next WHERE "userId" = $me AND provider = $p RETURNING …` with `$next = v ? nextAutoSyncAt(tz, ctx.now, lastSyncOkAt, id) : NULL` (§8.10). On: upsert the `DAILY` job at `runAt = $next` (if none queued). Off: `DELETE FROM jobs WHERE "dedupeKey" = 'import:' || $id AND status = 'QUEUED' AND payload->>'trigger' = 'DAILY'`. Response `LinkedAccountView`.

#### 7.3.8 `DELETE /api/accounts/{provider}?deleteGames=0|1`

1. Transaction: read the account; `DELETE FROM jobs WHERE "dedupeKey" = 'import:' || $id AND status = 'QUEUED'`; `DELETE FROM linked_accounts WHERE id = $id` (cascades `import_cursors`, `import_runs`; `game_players."linkedAccountId"` → NULL); Chess.com: `DELETE FROM chess_com_profiles WHERE "userId" = $me`; with `deleteGames=1`: `SELECT count(*) FROM game_players WHERE "userId" = $me AND source = $src` and enqueue `IMPORT_PURGE` (`dedupeKey importpurge:<userId>:<provider>`, priority `IMPORT_PURGE`).
2. A worker that is mid-run sees the account vanish: its next batch statement fails on the `game_players → linked_accounts` FK (23503), and the handler stops the run as `CANCELLED` (§8.11).
3. `after()`: kick when purging, `audit(… "account.unlinked" …, meta: {provider, deleteGames})`, PostHog `account_unlinked`. No Lichess call: there is no token (D4-21).
4. Response `200 UnlinkData` (`purge: {games}` or null).

### 7.4 Import status and retry

#### `GET /api/import/status`

`getImportStatus(viewer)` (`WEB/lib/data/imports.ts`), one query:

```sql
SELECT r."referenceId", r.provider, r.trigger, r.status, r.phase, r.seen, r.total, r.imported, r.skipped, r.error,
       r."analysisQueued", r.analysed, r."linkedAccountId", r."startedAt", r."finishedAt", r."updatedAt",
       fg."referenceId" AS "firstGameRef", fg."analysisStatus" AS "firstAnalysis", fp."momentsCount"
FROM import_runs r
LEFT JOIN games fg ON fg.id = r."firstGameId"
LEFT JOIN game_players fp ON fp."gameId" = r."firstGameId" AND fp."userId" = r."userId"
WHERE r."userId" = $1
ORDER BY r."createdAt" DESC
LIMIT 5;
```

`firstReview` is taken from the newest run that has a `firstGameId`. ETag = strong hash of `max(updatedAt)`, `firstAnalysis` and the `analysed` counts (P1 `private-etag`). Self-heal: if a run has been `QUEUED` for > 30 s, `after()` calls `kickIfStale('import:' || linkedAccountId)` (the jobs compare-and-set in §5.7; D4-31). The first draft's module-scope `Map<runId, lastKick>` is gone: it limited nothing across Fluid instances.

#### `POST /api/import/{ref}/retry` (member)

```sql
UPDATE import_runs SET status = 'QUEUED', trigger = 'RETRY', error = NULL, "updatedAt" = now()
WHERE "referenceId" = $1 AND "userId" = $2 AND status = 'FAILED'
RETURNING id, "linkedAccountId";
```

0 rows → read back: missing → 404; not failed → `409 conflict {reason: "not_failed"}`; 23505 (another run active) → `409 sync_running`. Then the job upsert (`JOB_PRIORITY.IMPORT_SYNC_MANUAL`), `importState = 'QUEUED'`, kick. Response `202 {run}`.

### 7.5 Billing

#### 7.5.1 `POST /api/checkout` (changed)

1. Parse `CheckoutBody`; RL `checkout`; idempotency required (a replay returns the same `checkoutUrl`, which covers double clicks and the bfcache Back button).
2. One read of the user (email **from the DB row**, not `currentUser()`, fixing `checkout/route.ts:50-63`; `trialStartedAt`, `subscriptionId`, `subscriptionStatus`, `dodoCustomerId`, linked handles).
3. Entitled → `409 already_subscribed`.
4. Live Dodo guard (`subscriptions.list`) **only** when `dodoCustomerId` is set and `subscriptionStatus` is non-terminal (`active`, `on_hold`, `past_due`, `paused`, `pending`) (inv-pub §1.5; saves ≈ 400 ms on first checkouts). `on_hold`/`past_due` → `402 payment_update_required`.
5. Trial decision `decideTrial(user)` (§8.4).
6. `dodo.checkoutSessions.create({ product_cart, customer: dodoCustomerId ? {customer_id} : {email, name}, metadata: {clerkUserId, userRef, plan, trial: "yes"|"no", source}, subscription_data: trial ? {trial_period_days: 7} : undefined, return_url: buildActivationReturnUrl(source, returnPath, origin), customization: {theme, show_order_details: true}, feature_flags: {redirect_immediately: true, allow_discount_code: true} })`.
7. `UPDATE users SET "pendingCheckoutSessionId" = $sid, "pendingCheckoutPlan" = $plan, "pendingCheckoutAt" = now(), "lastCheckoutSource" = $source, "trialOfferedAt" = CASE WHEN $trial THEN now() ELSE "trialOfferedAt" END, "onboardingStep" = <monotonic to ACTIVATING when source = onboarding> WHERE id = $me`.
8. Response `CheckoutData` (`chargeDate = trial ? now + 7 d : null`, `priceCents` 499 / 5000 from `BILLING_PLANS`).
9. Errors: Dodo failure → `502 upstream_unavailable {provider: "dodo"}` (never the raw message; fixes `:175-177`); `503 not_configured`.

#### 7.5.2 `GET /api/billing/activation`

Algorithm in §8.5.1. Response `ActivationData`; on the first `active` this **route** sets `rc_act` (§8.5.2; the RSC first paint calls the same DAL with `{dodo: false}` and never sets cookies, D4-29). It stays a GET because it is polled (api-perf AP-31), but its Dodo lookup goes through the same `refreshFromDodo(userId, {eventTime})` function as P1/P10's `POST /api/billing/refresh`, guarded by the `dodo-activation` bucket, and it writes only through P1's compare-and-set, with Dodo's `subscription.updated_at` (or `created_at`) as the event time, never `now()` (AP-06).

#### 7.5.3 Dodo webhook (changed)

P1 verifies, deduplicates through `WebhookEvent`, applies snapshots with **P1 F4b's compare-and-set** (`subscriptionSourceAt` = Dodo's event time; the conditional `UPDATE … RETURNING id` returns no row for a stale or unchanged snapshot; api-perf AP-06) and syncs Clerk claims. P4 does not change that statement; it adds its columns (§6.2) and the fan-out, which runs only when the CAS returned a row:

| Event | Addition |
|---|---|
| `subscription.*` (applied) | `after()`: `onEntitlementApplied(userId, before, after)` (§8.5.4): emit `entitlement:changed`; release waiting imports; on the first trialing snapshot write the trial ledger and PostHog `trial_started`; on trialing → active (the first paid period) release the analysis backlog (§8.9); on entitled → not entitled set `membershipEndedAt`; clear `pendingCheckout*` once entitled; duplicate-trial guard (§8.4.5) |
| `payment.failed`, `subscription.failed` | resolve the user (`metadata.clerkUserId`, then customer, then normalised email); `UPDATE users SET "lastPaymentFailedAt" = $eventTime, "lastPaymentFailureReason" = $code WHERE id = $1 AND ("lastPaymentFailedAt" IS NULL OR "lastPaymentFailedAt" < $eventTime)`; `after()`: emit `entitlement:changed` so an open activation page refetches and turns `failed` |
| `payment.succeeded` | unchanged, but the email match is case-insensitive (`lower(email) = lower($1)`, fixing `route.ts:63`). When `total_amount > 0` and the user's backlog has not been released (`import_runs` rows with `trigger = 'INITIAL'` and no `BACKLOG` jobs yet), it also calls `releaseImportBacklog(userId)` (idempotent; covers members whose first charge arrives before the `subscription.active` snapshot) |

### 7.6 Realtime (payloads in `CT/socket/user.ts`, registered in `CT/socket/registry.ts`; transport is P2's `POST /internal/emit`)

Body (consistency R-07, P2 L1612): `{ v: 1, targets: [{ userRef }], event, data, dedupeKey? }`, sent with `internalFetch("socket", "/internal/emit", body)` (D4-24). `dedupeKey` is set for the terminal events (`import:finished:<runRef>`, `import:failed:<runRef>:<attempt>`) so a retried emit is not shown twice.

```ts
export const ImportProgress = z.object({
  runRef: z.string(), provider: ProviderSlug, phase: z.enum(["reading", "saving"]),
  seen: z.int(), imported: z.int(), total: z.int().nullable(),
  analysed: z.int(),                     // games of this run already reviewed (api-perf AP-10): no per-game backlog events needed
});                                                                           // ≤ 1 per second per user, ≈ 125 B
export const ImportFinished = z.object({
  runRef: z.string(), provider: ProviderSlug, imported: z.int(), skipped: z.int(), total: z.int(),
  newGames: z.int(), analysisQueued: z.int(), analysed: z.int(), firstReviewGameRef: z.string().nullable(),
});
export const ImportFailed = z.object({
  runRef: z.string(), provider: ProviderSlug, code: ImportErrorCode, retryAt: z.iso.datetime().nullable(),
  imported: z.int(), total: z.int().nullable(),
});
export const EntitlementChanged = ViewerEntitlement;                          // CT/http/me (P1)
export const GamesChanged = z.object({ reason: z.enum(["import", "purge", "game"]), count: z.int().optional() });  // ≤ 1 per 10 s per user
```

| Event | Room | Emitted by | When |
|---|---|---|---|
| `import:progress` | `user:{ref}` | worker | reading: every 250 games or 2 s; saving: after each 100-game statement; coalesced to ≤ 1/s |
| `import:finished` | `user:{ref}` | worker | run `DONE` (not emitted for DAILY runs with 0 new games) |
| `import:failed` | `user:{ref}` | worker | run `FAILED`, or a rate-limit pause (`code: rate_limited`, `retryAt`) |
| `games:changed` | `user:{ref}` | worker | after a saving statement inserted ≥ 1 row (throttled 1/10 s), after a purge batch |
| `entitlement:changed` | `user:{ref}` | web (webhook fan-out, activation self-heal) | every applied snapshot that changes the viewer entitlement DTO (it also carries `subscriptionUpdatedAt`, which replaces P10's `membership:updated`, api-perf §1), every recorded payment failure |

The socket server rejects any event not in its registry or whose `data` fails the schema (P2 WS-3 rule), so the registry update ships with this phase. **Per-caller allow-list** (api-perf AP-44): the worker may emit `import:*` and `games:changed`; the web emits `entitlement:changed`. P4 adds these lines to P2's caller table in `CT/internal/auth.ts`. Imported-game analyses in the backlog band (priority < 80) emit no per-game `analysis:progress` / `analysis:done`; P3's coalesced `analysis:batch` (≤ 1 per user per 60 s) covers them, and `import:*.analysed` covers the run while it is active (AP-10).

### 7.7 Worker (`WK`)

#### 7.7.1 Lanes and claim

- P3 runs one engine lane. P4 adds an **I/O lane** in the same process (`WK/src/queue/lanes.ts`): concurrency 2, claims only `kind = ANY('{IMPORT_SYNC,IMPORT_PURGE}')` with P3's claim statement plus `AND kind = ANY($kinds)`; the engine lane excludes those kinds. Imports therefore never wait behind an analysis, and Stockfish never waits behind a slow provider.
- P3's job completion gains a `reschedule` result: `{ reschedule: { runAt, priority, payload } }` → `UPDATE jobs SET status = 'QUEUED', "runAt" = $1, priority = $2, payload = $3, attempts = 0, "lockedBy" = NULL WHERE id = $4` instead of `DONE` (`WK/src/queue/complete.ts`). One job row per account (`import:<linkedAccountId>`) is reused forever. The completion statement also returns `(SELECT min("runAt") FROM jobs WHERE status = 'QUEUED')`, which feeds P3's next-due sleep (D4-27), so a rescheduled daily sync never needs an extra query or a timer.
- An older worker image claims only kinds it knows (`kind = ANY($2)`, P3) and every P4 payload carries `v`; a payload with a newer `v` is put back with `runAt + 10 min` instead of failing (feasibility §9 rule 2).
- Back-off for `IMPORT_SYNC`: 60 s, 5 min, 15 min, honouring the provider's `Retry-After`; `maxAttempts = 5`. `IMPORT_PURGE`: 30 s, 2 min, 10 min; `maxAttempts = 5`.

#### 7.7.2 Files

| File | Role |
|---|---|
| `WK/src/jobs/import-sync.ts` | the handler (§8.6–8.10) |
| `WK/src/jobs/import-purge.ts` | §8.12 |
| `WK/src/import/context.ts` | `loadImportContext(linkedAccountId)`: one query for account + cursor + user entitlement columns + active run |
| `WK/src/import/run.ts` | `startRun`, `parkRun`, `setTotal`, `finishRun`, `failRun` (one statement each) |
| `WK/src/import/batch-writer.ts` | the single-statement chunk writer (§8.8) |
| `WK/src/import/known.ts` | "already imported for this user" filter (§8.8) |
| `WK/src/import/progress.ts` | coalescing emitter (≤ 1/s), ETA-free; `games:changed` throttle |
| `WK/src/import/schedule.ts` | `nextAutoSyncAt()` (§8.10) |
| `WK/src/import/priorities.ts` | analysis priority by rank within the member's budget (§8.9) |
| `WK/src/providers/gate.ts` | per-provider mutex with a global pause (`pauseUntil`) |
| `WK/src/providers/chesscom.ts`, `lichess.ts` | thin adapters over `CI` clients (anonymous), wired to the gate and the fault table |
| `WK/src/http/routes/provider-lookup.ts` | `POST /internal/provider/chesscom/lookup` (D4-23): `verifyInternal()`, body `InternalLookupBody`, served through the Chess.com gate with a 5 s gate-wait cap (returns `rate_limited` rather than queueing behind an import), 600 s LRU of ≤ 2,000 entries |
| `WK/src/jobs/analyze-game.ts` (P3) | **hook line only**: when `payload.importRunId` is set, the final batch appends `UPDATE import_runs SET analysed = analysed + 1 WHERE id = $1` |
| `WK/src/dev/faults.ts` + route `POST /internal/dev/fault` | fault injection; the process refuses to boot with `IMPORT_FAULTS_ALLOWED=1` and `APP_ENV=production` (unit test, testing X12) |
| `WK/src/scheduler/recurring/import-backstop.ts` (or a step in P3's `HOUSEKEEPING` handler) | the daily-sync backstop sweep (§6.3 `linked_accounts_autosync_idx`) at boot and inside the daily housekeeping run, never on its own timer (D4-27) |
| `WK/src/metrics.ts` (P3) | + import metrics (§10.2) |

#### 7.7.3 Internal endpoints used

All four go through `internalFetch()` / `verifyInternal()` (D4-24); none of them names a header here.

| Call | Direction | Notes |
|---|---|---|
| `POST /internal/analysis/kick` (P3, Caddy `handle /internal/analysis/*`) | web → worker | body `{kinds: ["IMPORT_SYNC"], runAt?}` (feasibility §6 canonical); `kickWorker()` / `kickIfStale()` from `after()`, 2 s timeout |
| `POST /internal/emit` (P2) | worker / web → socket | `{v: 1, targets: [{userRef}], event, data, dedupeKey?}` (R-07) |
| `POST /internal/provider/chesscom/lookup` (new) | web → worker | `InternalLookupBody` → `InternalLookupData`, 6 s budget on the web side; Caddy `handle /internal/provider/*` → worker in both the dev and the prod Caddyfile (P13 copies the line) |
| `POST /internal/dev/fault` (new, test hook) | web dev route → worker | `{v:1, provider: "chesscom"\|"lichess", mode: "5xx"\|"timeout"\|"429"\|"off", ttlSec ≤ 600}`; Caddy `handle /internal/dev/*` only in the dev Caddyfile |

#### 7.7.4 Dev fault injection

`WEB/app/dev/import/page.tsx` (admin, `testHooksEnabled()`) shows buttons → `POST /api/dev/import-fault` (admin or `x-e2e-token`) → worker `/internal/dev/fault`. The worker's provider fetch wrapper checks the in-memory fault table before every upstream call and returns a synthetic 503 / timeout / 429 (`Retry-After: 30`). Both hooks are entries in `WEB/lib/test-hooks/registry.ts` (`{kind: "route", id: "dev-import-fault", phase: 4, guard: "testHooksEnabled"}`, and the page), so `prod-guard.spec.ts` proves they 404 in a production build, and the worker refuses to boot with the flag in production (testing X12).

### 7.8 Third-party calls

| Provider | Call | Where | Headers / params | Timeout | Cache | Errors → |
|---|---|---|---|---|---|---|
| Chess.com | `GET /pub/player/{u}` | web lookup/link (worker fallback on 429/403, D4-23), worker run start | `User-Agent: ReplayChess/1.0 (+https://playchess.tech; hello@playchess.tech)`, `Accept: application/json` | web 5 s, worker 8 s | web 600 s (`unstable_cache`), worker LRU 600 s | 404 not_found; 410 / `status: closed*` private |
| Chess.com | `GET /pub/player/{u}/stats` | web lookup (same fallback) | same | 5 s | 600 s | — |
| Chess.com | `GET /pub/player/{u}/games/archives` | web confirm (recent games; same fallback), worker | `If-None-Match`, `If-Modified-Since` (worker) | 5 s / 8 s | web 600 s | 304 = unchanged |
| Chess.com | `GET /pub/player/{u}/games/{YYYY}/{MM}` | web confirm (newest month; same fallback), worker | same | 5 s / 15 s | web 600 s | 304 skip; 429 pause 60 s |
| Lichess | `GET /oauth` (browser), `POST /api/token`, `GET /api/account`, `DELETE /api/token` | web callback only; all three server calls in one request, the revoke in a `finally` (D4-21) | form body for token; `Authorization: Bearer` | 8 s / 5 s / 5 s | none | denied / upstream; revoke failure → one retry, then Sentry warning |
| Lichess | `GET /api/games/user/{u}?max=5&rated=true&moves=false&opening=true` | web confirm | `Accept: application/x-ndjson`, anonymous | 5 s | 600 s | partial render |
| Lichess | `GET /api/games/user/{u}?since&until&max&rated=true&perfType=ultraBullet,bullet,blitz,rapid,classical,correspondence&moves=true&clocks=true&evals=true&opening=true&finished=true&pgnInJson=false&tags=false` | worker | `Accept: application/x-ndjson`, **anonymous** (20 games/s, R-LI-05; feasibility §1 verified the rates) | idle 30 s, total 10 min | — | 429 global pause 60 s → 15 min (R-LI-06) |
| Dodo | `checkoutSessions.create` | web checkout | SDK (`baseURL` = `DODO_API_BASE_URL` in test builds only, D4-19) | 10 s | — | 502 |
| Dodo | `subscriptions.list` (guarded), `subscriptions.retrieve`, `checkoutSessions.retrieve` (`{id, payment_status, payment_id}`) | web checkout / activation | SDK | 8 s | — | stay pending |
| Dodo | `subscriptions.update(id, { cancel_at_next_billing_date: true })` | webhook duplicate-trial guard | SDK | 8 s | — | Sentry warning |
| Clerk | `users.updateUserMetadata(googleId, {publicMetadata})` | web (complete, claims) | BAPI | 3 s | — | retry in `after()` |

`pgnInJson=false` is a deliberate deviation from the research string (R-LI-05): the worker needs `moves`, `clocks`, `initialFen`, `opening` and `analysis`, all present in the JSON without the PGN, which roughly halves the stream size.

### 7.9 Environment variables (add to `turbo.json` `globalEnv`, Vercel `replay-chess-dev`, `WORKER_DEV_ENV_FILE`; names per consistency R-09)

| Name | Web | Worker | Value on dev | Notes |
|---|---|---|---|---|
| `LICHESS_CLIENT_ID` | yes | — | `replay-chess-dev` | `playchess.tech` in P13 |
| `LICHESS_BASE_URL` | yes | yes | `https://lichess.org` | e2e: `http://localhost:4010/lichess`. Env test hook: `lib/env.ts` refuses any other value when `APP_ENV=production` (testing X12) |
| `CHESSCOM_API_BASE` | yes | yes | `https://api.chess.com` | e2e: `http://localhost:4010/chesscom`; same production guard |
| `DODO_API_BASE_URL` | yes (test builds) | — | unset on dev | e2e: `http://localhost:4010/dodo`; refused unless `APP_ENV=test` (D4-19) |
| `UPSTREAM_CONTACT` | yes | yes | `hello@playchess.tech` | User-Agent contact (R-CC-03) |
| `SIGNED_COOKIE_SECRET` | yes | — | random 32 bytes | **created by P4** (P1 defers `rc_act` to P4): `rc_lichess_pkce`, `rc_act`, `rc_onb`, `rc_onb_next` |
| `HASH_PEPPER` | yes | yes | random 32 bytes | **one pepper for every email hash** (trial ledger, P10's deletion, contact limits; R-09). Never rotated (rotation would forget every trial). Replaces the first draft's `TRIAL_LEDGER_PEPPER` |
| `IMPORT_WINDOW_MONTHS` | yes | yes | `12` | D4-09 |
| `IMPORT_MAX_GAMES` | yes | yes | `2000` | D4-09 |
| `IMPORT_ANALYSE_EAGER_TRIAL` / `IMPORT_ANALYSE_EAGER` / `IMPORT_ANALYSE_CAP` | yes | yes | `20` / `50` / `200` | D4-09, §8.9 (web needs them for the backlog release) |
| `IMPORT_BACKLOG_SPREAD_DAYS` | yes | — | `7` | §8.9 |
| `IMPORT_PAUSED` | — | yes | unset | ops kill switch: the I/O lane claims nothing |
| `IMPORT_FAULTS_ALLOWED` | — | yes (dev only) | `1` | §7.7.4; boot refuses it in production |
| `ALLOW_TEST_HOOKS` | yes | — | `1` on `replay-chess-dev` only | P1's `testHooksEnabled()` (feasibility SEC-5: the dev project deploys with `VERCEL_ENV=production`, so the guard is `APP_ENV` + this flag) |
| `DODO_PAYMENTS_WEBHOOK_KEY` | `.env.test` too | — | test key | e2e signs test webhooks |

Existing names P4 uses unchanged: `INTERNAL_API_SECRET` (through the helper, D4-24), `ANALYSIS_WORKER_URL`, `WS_INTERNAL_URL`, `NEXT_PUBLIC_WEBSOCKET_URL`. Removed by D4-21: `LINK_TOKEN_KEYS` (and its aliases `LINKED_ACCOUNT_KEY`, `TOKEN_ENC_KEY`, `LINK_TOKEN_KEY` for Lichess tokens).

### 7.10 Feature flags and switches

| Flag (PostHog, server-evaluated by `lib/flags.ts`) | Off | On |
|---|---|---|
| `onboarding-v3` | `/onboarding` renders `LegacyOnboarding`; step routes 404; checkout returns use the legacy paths | resolver + step routes; checkout uses `buildActivationReturnUrl` |
| `import-v3` | accounts and import routes return `404`; `/settings/connected` 404; archive tabs hidden; legacy chess-com routes active | everything in §7 |

Both are on for the owner, E2E users A–R and the lease pool on dev. P1's `flags-off` Playwright project runs P1–P3's `@smoke` specs with both flags off until the legacy code is deleted (testing X11). The legacy page and routes are deleted in the same phase once the parity checks in §12.6 pass (allocation §1.1.2). `IMPORT_PAUSED` (worker) and the P1 maintenance notice with `affects: ["import"]` (web → `503 maintenance` on `/api/accounts/*` and `/api/import/*`) are the operational switches.

### 7.11 Cron (`GET /api/cron/daily`, P1)

`prune` task additions: P22 (old import runs), P23 (cancel `WAITING_FOR_MEMBERSHIP` runs older than 30 days, set `importState = 'IDLE'`), and clearing `pendingCheckout*` older than 24 h when not entitled. `wake-worker` already exists (the "is the worker alive" backstop); the worker's daily housekeeping run re-enqueues lost daily syncs (D4-27). The cron runs once a day, the Hobby limit.

### 7.12 Legacy endpoints

| Endpoint | Callers today | Fate |
|---|---|---|
| `POST /api/user/chess-com-profile/preview` | `onboarding/page.tsx:184`, `ChessComConnectModal.tsx:61` | removed at DoD (both callers are deleted in P4) |
| `POST /api/user/chess-com-profile` | `onboarding/page.tsx:213`, `ChessComConnectModal.tsx:94` | removed at DoD |
| `POST /api/user/onboarding-skip` | `onboarding/page.tsx:245`, `e2e/fixtures/auth.ts:59` | removed at DoD (fixture reworked first) |
| `GET /api/subscription` activation polling | `lib/billing/client.ts:87-113` and its 3 callers | callers removed; the route itself stays (P1 made it DB-first) |

---

## 8. Domain logic

### 8.1 Onboarding state machine (`WEB/lib/onboarding/steps.ts`, `resolve.ts`)

```ts
export const ORDER = ["WELCOME", "LINK", "CONFIRM", "LEVEL", "GOALS", "PLAN", "ACTIVATING", "DONE"] as const;
export const PENDING_CHECKOUT_TTL_MS = 30 * 60_000;

export function resolveOnboardingRoute(v: OnbViewer, now: number): string {
  const entitledLike = v.entitled || v.isAdmin || !v.paywallOn;
  if (v.onboardingDone && entitledLike) return v.next ?? "/games";            // D4-13
  const at = ORDER.indexOf(v.step);
  if (entitledLike && at >= ORDER.indexOf("PLAN")) return "/onboarding/done";  // plan is skipped for members
  switch (v.step) {
    case "WELCOME": return "/onboarding/welcome";
    case "LINK": return v.hasActiveLink ? "/onboarding/level" : "/onboarding/link";
    case "CONFIRM": return v.lichessLinked ? "/onboarding/confirm?provider=lichess" : "/onboarding/link";
    case "LEVEL": return "/onboarding/level";
    case "GOALS": return "/onboarding/goals";
    case "PLAN": return "/onboarding/plan";
    case "ACTIVATING":
      return v.pendingCheckoutAt && now - v.pendingCheckoutAt < PENDING_CHECKOUT_TTL_MS
        ? "/onboarding/activating" : "/onboarding/plan?resume=abandoned";
    case "DONE": return entitledLike ? "/onboarding/done" : "/onboarding/plan";
  }
}
```

**Per-page guard** (`guardStep(page, v)`, called in every step page): a step up to `PLAN` may be opened if `index(page) ≤ index(v.step) + 1` (back navigation and one step ahead); otherwise redirect to the resolver. `confirm` needs a valid `u` (Chess.com) or a Lichess link. `activating` needs a pending checkout within 30 min, `checkout=success` in the URL, or entitlement. `done` needs entitlement or a pending checkout within 30 min (the "Trial starting…" variant); otherwise plan. **Writes are monotonic**: `onboardingStep` never moves backwards (§7.2 SQL), so revisiting an earlier step never loses progress; the URL is the source of truth for what is on screen.

The resolver and guards work on the DB enum (uppercase) and take `now` from P1's request clock (`ctx.now` / `getRequestNow()`), which honours `x-rc-now` only in non-production with `x-e2e-token`, so the 30-minute abandoned-checkout rule is testable without waiting (testing X5).

**Middleware rule** (P1's matrix, P4 adds it): a signed-in user with `md.onboarded !== true` and no valid `rc_onb` cookie, on any page outside the public list and outside `/onboarding(.*)`, `/checkout/activating`, `/settings/connected`, `/settings/account`, `/settings/membership`, is redirected to `/onboarding?redirect_url=<path>`, and the redirect response sets `rc_onb_next` (D4-29). A request to `/onboarding?redirect_url=…` (P11's sign-in hand-over) gets the cookie on its `NextResponse.next()`. API routes are never redirected.

### 8.2 Rating band suggestion (`WEB/lib/onboarding/suggest-band.ts`)

```ts
const PREFERENCE = ["rapid", "blitz", "bullet", "daily", "classical"] as const;   // tie-break order; rapid wins ties
const MIN_GAMES = 10;
/** Lichess ratings run higher than Chess.com for the same strength. Unsourced constant (research §19 gap 10). */
export const LICHESS_OFFSET = { bullet: -50, blitz: -100, rapid: -100, classical: -100, daily: 0 } as const;
export const BAND_MIDPOINT = { NEW_TO_CHESS: 400, UNDER_800: 700, R800_1200: 1000, R1200_1600: 1400, R1600_2000: 1800, R2000_PLUS: 2100 } as const;

export function suggestBand(ratings: RatingsV1, provider: "chesscom" | "lichess") {
  const usable = PREFERENCE.filter((tc) => (ratings[tc]?.games ?? 0) >= MIN_GAMES);
  const pool = usable.length ? usable : PREFERENCE.filter((tc) => (ratings[tc]?.games ?? 0) > 0);
  if (!pool.length) return null;
  const tc = pool.reduce((a, b) => (ratings[b]!.games > ratings[a]!.games ? b : a));   // first in PREFERENCE wins ties
  const r = ratings[tc]!.rating + (provider === "lichess" ? LICHESS_OFFSET[tc] : 0);
  const band = r < 800 ? "UNDER_800" : r < 1200 ? "R800_1200" : r < 1600 ? "R1200_1600" : r < 2000 ? "R1600_2000" : "R2000_PLUS";
  return { band, source: `${provider}:${tc}`, initialRating: Math.min(2400, Math.max(400, Math.round(r))), timeClass: tc, displayRating: ratings[tc]!.rating };
}
export const puzzleStart = (initialRating: number) => Math.floor(initialRating / 50) * 50;      // 1184 → 1150 (board copy)
```

`NEW_TO_CHESS` is never suggested. When the user picks a different band than the suggestion, `ratingBandSource = "self"` and `initialRating = BAND_MIDPOINT[band]`. A 2400+ titled player maps to `R2000_PLUS` with `initialRating` clamped to 2400.

### 8.3 Daily plan preview (`WEB/lib/onboarding/day-preview.ts`; P5 may reuse the weights)

| Goal | Row title | Row description | Weight |
|---|---|---|---|
| `STOP_BLUNDERING` | Mistake Bank review | Positions from your own games | 0.45 |
| `LEARN_OPENINGS` | Opening line | One line you actually play | 0.25 |
| `IMPROVE_ENDGAMES` | Endgame drill | King and pawn technique | 0.25 |
| `STUDY_LEGENDS` | Legend position | Play a famous moment | 0.30 |
| `PLAY_FRIENDS` | Challenge a friend | Send a link from any position | — ("ANYTIME", OD-6) |

For the timed goals `G` and daily minutes `M ∈ {5, 10, 20}`: `m_i = max(1, round(M · w_i / Σ_G w))` (the board's formula); then, while `Σ m_i ≠ M`, add or subtract 1 on the row with the largest weight (never below 1; if every row is at 1 and the sum still exceeds `M`, keep the sum: 5 goals × 1 min > 5 min is acceptable, and the preview header shows the true total). Example: Stop blundering + Study legends at 10 min → 6 + 4.

### 8.4 Trial eligibility and the ledger (`WEB/lib/billing/trial-ledger.ts`, `trial-rules.ts`)

1. `normaliseEmail(e)`: trim, lowercase; split at the last `@`; `googlemail.com` → `gmail.com`; for `gmail.com` remove `.` from the local part; for every domain drop a `+tag` suffix in the local part.
2. `trialLedgerEmailHash(email) = sha256hex(HASH_PEPPER + "\n" + normaliseEmail(email))`, exported from `WEB/lib/billing/trial-ledger.ts` so P10's deletion path writes the same hash (consistency R-09; P10 adds a unit test that both agree); `handleHash = (verified ? "v:" : "u:") + sha256hex(HASH_PEPPER + "\n" + provider + ":" + usernameLower)`.
3. **Eligible** iff `trialStartedAt IS NULL AND subscriptionId IS NULL` (existing rule, `trial-rules.ts:22-24`) **and** no ledger hit: `SELECT 1 FROM trial_ledger WHERE "emailHash" = $1 OR "handleHashes" && $2::text[]`, where `$2` holds only the user's **verified** handle hashes (D4-10).
4. **Write** on the first trialing snapshot (webhook): `INSERT INTO trial_ledger ("emailHash", "handleHashes") VALUES ($1, $2) ON CONFLICT ("emailHash") DO UPDATE SET "handleHashes" = ARRAY(SELECT DISTINCT unnest(trial_ledger."handleHashes" || EXCLUDED."handleHashes"))`, with all linked handles (verified and unverified).
5. **Duplicate-trial guard.** Two tabs can open two trial checkouts before either completes. When a `subscription.active` arrives for subscription *Y* while the user already holds a different live subscription *X* created earlier, the webhook calls `dodo.subscriptions.update(Y, { cancel_at_next_billing_date: true })` so *Y* ends at its trial end without a charge, records `audit_logs billing.duplicate_trial_cancelled`, and sends a Sentry warning. `trialFieldsFromSnapshot` (`trial-rules.ts:76-87`) already never moves the stored trial dates.

### 8.5 Activation

#### 8.5.1 Server: `getActivation(viewer, params, { dodo })` (`WEB/lib/data/billing.ts`)

1. Read the user (entitlement columns, `pendingCheckout*`, `lastPaymentFailedAt`, email, `trialEndsAt`, `subscriptionId`).
2. Entitled → `active` (the API route then sets `rc_act` the first time; the DAL itself never sets cookies, D4-29).
3. `lastPaymentFailedAt > pendingCheckoutAt` → `failed {reason: declined}`.
4. If `dodo` is allowed (the API route, not the RSC first paint) **and** (`force=1` or the per-user bucket `dodo-activation` allows one Dodo check per 5 s) **and** `now − pendingCheckoutAt > 6 s`:
   - `subscription_id` present → `refreshFromDodo()` → `dodo.subscriptions.retrieve(id)`; it must belong to this user (`metadata.clerkUserId === viewer.clerkId` or `customer.email` matches) → `applySubscriptionSnapshot(snapshot, {source: "api", userId, eventTime: snapshot.updated_at ?? snapshot.created_at})` through P1's compare-and-set (never `now()`, so a later webhook is not mistaken for stale; api-perf AP-06) → entitled → `active` (this self-heals a late webhook and runs the same `onEntitlementApplied` fan-out when the CAS returned a row).
   - else `pendingCheckoutSessionId` → `dodo.checkoutSessions.retrieve(id)` → `payment_status ∈ {failed, cancelled}` → `failed {reason}`.
5. Otherwise `pending`. `waitedMs = now − pendingCheckoutAt`; `emailMasked` = first character + "•••" + "@" + domain; `reference` = the subscription id shortened to `sub_8F2K…Q1` (first 8 + "…" + last 2).
6. The Dodo `?status=` parameter is a hint for the client only; the server never treats it as proof of payment.

#### 8.5.2 Bridging cookies

`rc_act` and `rc_onb`: `base64url(clerkUserId + "|" + exp) + "." + base64url(HMAC-SHA256(SIGNED_COOKIE_SECRET, …))`, `Max-Age=120`, `HttpOnly; Secure; SameSite=Lax; Path=/`. Middleware treats the user as entitled (`rc_act`) or onboarded (`rc_onb`) when the cookie verifies, is unexpired and names the session's user. The APIs never read these cookies; they check the DB.

#### 8.5.3 Client state machine (`WEB/lib/billing/activation-machine.ts`, a pure reducer)

| From | Event | To | Effect |
|---|---|---|---|
| `polling` | `SERVER {state: active}` or `SOCKET_ENTITLED` | `success` | `session.reload()`, `realtime.refreshToken()`, analytics `via` |
| `polling` | `SERVER {state: failed}` or `URL_STATUS_FAILED` | `failed` | onboarding: replace to plan with `?status=failed` |
| `polling` | `TICK` at `STALLED_AFTER_MS = 12_000` | `stalled` | polling continues |
| `stalled` | `SERVER active` / `SOCKET_ENTITLED` | `success` | as above |
| `stalled` | `CHECK_AGAIN` | `polling` | `refetch({force: 1})`; stalled timer restarts |
| `failed` | `SERVER active` within `FAILED_GRACE_MS = 30_000` | `success` | 3-D Secure retries can succeed after a failed redirect |
| any | `POLL_STOPPED` (180 s) | unchanged | UI keeps `stalled`; Check Again restarts the poller |

Checkout only: `success` starts `COUNTDOWN_MS = 3000`, paused while the card has focus or hover.

#### 8.5.4 Entitlement fan-out: `onEntitlementApplied(userId, before, after)` (`WEB/lib/billing/fanout.ts`, from `after()`)

1. Emit `entitlement:changed` (the Viewer entitlement DTO plus `subscriptionUpdatedAt`) with `internalFetch("socket", "/internal/emit", {v: 1, targets: [{userRef}], event: "entitlement:changed", data})`.
2. If `!before.entitled && after.entitled`: release waiting imports in one statement, then kick (`$2` = `JOB_PRIORITY.IMPORT_SYNC_INITIAL`):

```sql
WITH rel AS (
  UPDATE import_runs SET status = 'QUEUED', "updatedAt" = now()
  WHERE "userId" = $1 AND status = 'WAITING_FOR_MEMBERSHIP'
  RETURNING id, "linkedAccountId", trigger),
acc AS (
  UPDATE linked_accounts SET "importState" = 'QUEUED', "updatedAt" = now()
  WHERE id IN (SELECT "linkedAccountId" FROM rel) RETURNING id),
j AS (
  INSERT INTO jobs (kind, status, priority, "dedupeKey", "userId", payload, "runAt", "createdAt")
  SELECT 'IMPORT_SYNC', 'QUEUED', $2, 'import:' || rel."linkedAccountId", $1,
         jsonb_build_object('v', 1, 'linkedAccountId', rel."linkedAccountId"::text, 'runId', rel.id::text, 'trigger', rel.trigger),
         now(), now()
  FROM rel
  ON CONFLICT ("dedupeKey") DO UPDATE SET status = 'QUEUED', "runAt" = now(), priority = EXCLUDED.priority,
     payload = EXCLUDED.payload, attempts = 0 WHERE jobs.status <> 'RUNNING'
  RETURNING id)
SELECT (SELECT count(*) FROM rel) AS released, (SELECT count(*) FROM j) AS queued;
```

   A returning member (lapsed → entitled) also gets a `DAILY`-trigger sync now for each `autoImport` account whose `lastSyncOkAt` is older than 12 h.
3. First trialing snapshot: trial ledger write (§8.4), PostHog `trial_started {plan_interval}`.
4. **First paid period** (`before.status = trialing && after.status = active`, or an entitled non-trial snapshot for a member who never trialled): `releaseImportBacklog(sql, userId)` (`DB/src/import-backlog.ts`, shared by web and worker, §8.9), one statement, idempotent through `dedupeKey analyze:<gameId>`.
5. `before.entitled && !after.entitled`: `membershipEndedAt = $eventTime`; nothing is cancelled (the worker re-checks entitlement at run start and parks the run; queued backlog analyses stay queued and run, which costs at most the 200-game cap).
6. Entitled: `pendingCheckout* = NULL`.

### 8.6 Chess.com import (`CI/src/chesscom/*`, `WK/src/jobs/import-sync.ts`)

**Window.** `windowStart = first day (UTC) of the month 12 months before now` (`IMPORT_WINDOW_MONTHS`); games with `end_time < windowStart` are dropped.

**Reading phase** (holds the Chess.com gate one request at a time):

1. `GET /pub/player/{u}` (refresh `username`, `usernameLower`, `avatarUrl`, `externalId = player_id` for backfilled links, `status`). 404 → error `not_found`; closed → `closed`.
2. `GET /pub/player/{u}/games/archives` with the stored validators. 200 → store the new ETag/Last-Modified and the month list; 304 → reuse the month keys from `cursor.archives`.
3. Months to fetch, **newest first**: initial → every archive month ≥ `windowStart`; incremental → the current month, any month newer than the newest stored, and the previous month during the first two days of a month (games that finish across midnight UTC on the 1st), skipping months with `done = true`.
4. For each month: `GET …/games/{YYYY}/{MM}` with `If-None-Match`/`If-Modified-Since`; 304 → skip; 200 → parse every game; mark the month `done` with its validators unless it is the current month. Stop when `IMPORT_MAX_GAMES` candidates are collected.
5. **Filters** (each counted in `skipped` with a reason): `rules ≠ "chess"` (variants; also `cursor.skippedVariants`), `rated ≠ true`, fewer than 2 plies, the archive owner is on neither side, PGN fails to replay (Sentry warning with the game URL host stripped, counted as `parse_error`).
6. Progress: `import:progress {phase: reading, seen}` every 250 games or 2 s, and `UPDATE import_runs SET seen, phase` at the same cadence.

**Mapping one game** (`CI/src/chesscom/map.ts`, pure). The left column is the mapper's output field; it is written to P2's columns (D4-22): `endedAt` → `games."completedAt"`, `games."expiresAt"` and `game_players."endedAt"`; `fen` → `games.fen`; `endMethod` → `games."endMethod"`; `outcome` → `games.outcome`. The newest chunk is written as soon as it is parsed (D4-28).

| Field | Source |
|---|---|
| `externalId` | `url` matched by `/\/game\/(live\|daily)\/(\d+)$/` → group 2 (fallback: `uuid`) |
| `externalUrl` | `url` |
| `timeClass` | `time_class`: `bullet` → BULLET, `blitz` → BLITZ, `rapid` → RAPID, `daily` → DAILY |
| `initialTimeSeconds`, `incrementSeconds` | `time_control`: `"180+2"` → 180, 2; `"600"` → 600, 0; `"1/86400"` (daily) → 86400, 0 |
| `startingFen` | `initial_setup` if present and not the standard FEN, else the standard FEN; `startPly` from the FEN's side and move number |
| `moves`, `plyCount`, `fen` | `chess.js` `loadPgn(pgn)` → `history({verbose: true})` → `from + to + (promotion ?? "")` joined by spaces; `fen()` at the end must equal `game.fen` (else `parse_error`). **The PGN is authoritative**: when the archive's `game.fen` disagrees with the replayed PGN on the last ply, the game is counted `parse_error` (fixture case, §12.5), never stored half-right |
| `moveClocksMs` | `%clk h:mm:ss(.f)` comments per ply → ms; empty when absent (daily) |
| `endedAt` | `end_time` (unix seconds, UTC). Display dates are rendered in `users."timeZone"`, so a daily game ending 23:30 UTC shows on the next local day in Asia/Kolkata (fixture case, §12.5) |
| `whiteName`/`blackName`, `whiteRating`/`blackRating`, `whiteTitle`/`blackTitle` | `white.username`, `white.rating`, … (titles from the profile when the member is titled; opponents' titles are not in the archive) |
| colour | `white.username.toLowerCase() === usernameLower` → `w`, black → `b` |
| `outcome` (`GameWinner`) | `white.result = "win"` → `WHITE`; `black.result = "win"` → `BLACK`; a draw code on both → `DRAW` |
| `endMethod` (`GameEndMethod`) | from the non-winning side's code: `checkmated` → CHECKMATE, `resigned` → RESIGNATION, `timeout` → TIMEOUT, `abandoned` → ABANDONED, `agreed` → AGREEMENT, `repetition` → THREEFOLD, `stalemate` → STALEMATE, `insufficient` → INSUFFICIENT_MATERIAL, `50move` → FIFTY_MOVE, `timevsinsufficient` → TIMEOUT_VS_INSUFFICIENT, anything else (`lose`, `kingofthehill`, `threecheck`, `bughousepartnerlose`) → `OTHER` |
| `ecoCode`, `openingName` | PGN `[ECO]`; `[ECOUrl]` slug → words ("Scandinavian-Defense-Mieses-Kotroc-Variation" → "Scandinavian Defense Mieses Kotroc Variation"), ≤ 80 chars, markup stripped |
| `GamePlayer.result`, `.ratingBefore`, `.opponentName`, `.opponentRating` | the member's side (`WIN \| LOSS \| DRAW`); the member's rating as the archive reports it; the other side's username (≤ 40 chars) and rating. `ratingAfter` / `ratingDelta` stay NULL for Chess.com (not in the archive) |
| `accuracies` | ignored (R-CC-06) |
| `pgn` | not stored (D4-30) |
| `creatorTimeRemaining`, `opponentTimeRemaining` (legacy NOT NULL) | the last clock of each side in seconds, else 0; `creatorId` = the importing member (until contract **C3** in P10 makes it nullable, consistency R-01) |
| legacy `result` (`GameResult`) | from the member's side: `CREATOR_WON` / `OPPONENT_WON` / `DRAW`, so legacy readers that still look at it stay coherent; `winnerId` = the member when they won, else NULL |

### 8.7 Lichess import (`CI/src/lichess/*`)

1. **Request** (one stream at a time globally, R-LI-06): initial → `since = windowStart (ms)`, `max = IMPORT_MAX_GAMES`; incremental → `since = lichessSinceMs + 1`, `max = 1000` (the rest arrives the next day); resume after an interrupted run → `until = lichessResumeUntilMs − 1` with the original `since` (D4-12). Always anonymous (20 games/s, D4-21): 2,000 games ≈ 100 s, a day's games well under a second. The stream is newest first, so the early chunk (D4-28) is the newest 100 games after ≈ 5 s.
2. **Stream parse** (`CI/src/lichess/ndjson.ts`): a `TextDecoderStream` line splitter that handles chunk boundaries and a trailing line without `\n`; a line that fails `JSON.parse` is skipped and counted.
3. **Mapping** (`CI/src/lichess/map.ts`):

| Field | Source |
|---|---|
| `externalId`, `externalUrl` | `id`, `https://lichess.org/{id}` |
| `timeClass` | `speed`: ultraBullet, bullet → BULLET; blitz → BLITZ; rapid → RAPID; classical → CLASSICAL; correspondence → DAILY |
| clocks | `clock.initial`, `clock.increment` (s); correspondence `daysPerTurn × 86400`; `clocks[]` centiseconds → `moveClocksMs = clocks × 10` |
| `startingFen`, `startPly` | `initialFen` for `variant = "fromPosition"`, else standard; `startPly = 2·(fullmove − 1) + (side = b ? 1 : 0)` (P2's rule), so a `fromPosition` game with Black to move has an odd `startPly` (fixture case, §12.5); other variants never arrive (`perfType` filter) but are skipped if they do |
| `moves`, `fen` | `moves` (SAN, space-separated) replayed with chess.js from `startingFen` → UCI; `fen` = the final position |
| `endedAt` | `lastMoveAt` |
| players | `players.white.user.{name, id, title}`, `players.white.rating`, `players.white.ratingDiff`; colour by `players.white.user.id === externalId`; the member's side → `GamePlayer.ratingBefore` (and `ratingDelta` from `ratingDiff` when present), the other side → `opponentName`, `opponentRating` |
| `outcome` (`GameWinner`) | `winner` `white`/`black` → `WHITE` / `BLACK`, else `DRAW` when `status ∈ {draw, stalemate, outoftime without winner}` |
| `endMethod` (`GameEndMethod`) | `mate` → CHECKMATE, `resign` → RESIGNATION, `stalemate` → STALEMATE, `outoftime` → TIMEOUT (TIMEOUT_VS_INSUFFICIENT when there is no winner), `timeout` → ABANDONED, `draw` → AGREEMENT, upgraded to THREEFOLD / FIFTY_MOVE when the replayed final position shows it (same rule as data-model B1), `cheat`/`unknownFinish`/`variantEnd` → OTHER; `aborted`, `noStart`, `created`, `started` → skipped |
| titles | `title = "BOT"` stored as `whiteTitle`/`blackTitle` (R-LI-09: excluded from weakness baselines later) |
| `ecoCode`, `openingName` | `opening.eco`, `opening.name` |
| `evalHint` | `analysis[i].eval` (cp) or `analysis[i].mate` → `sign·(30000 − \|n\|)`, White's view, only when `analysis.length === plyCount` (R-LI-08) |

4. **Cursor**: the first line's `createdAt` is the run's newest; on success `lichessSinceMs = max(previous, newest)` and `lichessResumeUntilMs = NULL`; on failure `lichessResumeUntilMs = createdAt of the oldest game already saved`.
5. **No token** (D4-21): there is no 401 path. A 401 or 403 from the anonymous export (not expected) is handled as `upstream` (§8.11). `RELINK_REQUIRED` is reserved and not set in P4.

### 8.8 Batch writer (`WK/src/import/batch-writer.ts`)

**Known-game filter first** (one query per ≤ 500 candidate ids): `SELECT g."externalId" FROM games g JOIN game_players gp ON gp."gameId" = g.id AND gp."userId" = $1 WHERE g.source = $2 AND g."externalId" = ANY($3::text[])` (index `games_source_externalId_key` + the `game_players` PK). Known games are dropped before writing, so a daily sync of a month that already has 40 games writes only the new ones, and `imported` counts only genuinely new rows.

**Saving phase**: newest first, chunks of `IMPORT_CHUNK = 100`, **one statement per chunk** (a data-modifying CTE chain is atomic and costs one round trip from Mumbai, ≈ 200 ms, data-model §7, audit-db §5.3). The first chunk is written during reading (D4-28); `phase` is passed in so that chunk leaves the run in `reading`. Column names are P2's (D4-22, consistency 4.1); every `NOT NULL` column without a database default is set explicitly (`games."expiresAt"`, `games."updatedAt"`, `game_players."updatedAt"`, which Prisma's `@updatedAt` fills only in the client):

```sql
WITH src AS (
  SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
    "referenceId" text, ord int, "externalId" text, "externalUrl" text, "timeClass" "TimeClass", rated boolean,
    "endedAt" timestamptz, "whiteName" text, "blackName" text, "whiteRating" int, "blackRating" int,
    "whiteTitle" text, "blackTitle" text, outcome "GameWinner", "endMethod" "GameEndMethod", "legacyResult" "GameResult",
    "ecoCode" text, "openingName" text, moves text, "moveClocksMs" int[], "plyCount" int, "startPly" int,
    "startingFen" text, fen text, "initialTimeSeconds" int, "incrementSeconds" int,
    "creatorTimeRemaining" int, "opponentTimeRemaining" int, "memberWon" boolean,
    color char(1), result "PlayerResult", "ratingBefore" int, "ratingDelta" int,
    "opponentName" text, "opponentRating" int, priority int, "fairSeq" int, "evalHint" jsonb)),
ins AS (
  INSERT INTO games ("referenceId", source, "externalId", "externalUrl", mode, status, rated, "timeClass",
      "completedAt", "expiresAt", "whiteName", "blackName", "whiteRating", "blackRating", "whiteTitle", "blackTitle",
      outcome, "endMethod", result, "winnerId", "ecoCode", "openingName", moves, "moveClocksMs", "plyCount", "startPly",
      "startingFen", fen, "initialTimeSeconds", "incrementSeconds", "creatorTimeRemaining", "opponentTimeRemaining",
      "creatorId", "whitePlayerId", "blackPlayerId", "analysisStatus", "createdAt", "updatedAt")   -- pgn stays NULL (D4-30)
  SELECT s."referenceId", $2::"GameSource", s."externalId", s."externalUrl", 'IMPORTED', 'COMPLETED', s.rated, s."timeClass",
      s."endedAt", s."endedAt", s."whiteName", s."blackName", s."whiteRating", s."blackRating", s."whiteTitle", s."blackTitle",
      s.outcome, s."endMethod", s."legacyResult", CASE WHEN s."memberWon" THEN $3 END, s."ecoCode", s."openingName",
      s.moves, s."moveClocksMs", s."plyCount", s."startPly", s."startingFen", s.fen, s."initialTimeSeconds",
      s."incrementSeconds", s."creatorTimeRemaining", s."opponentTimeRemaining",
      $3, CASE WHEN s.color = 'w' THEN $3 END, CASE WHEN s.color = 'b' THEN $3 END,
      CASE WHEN s.priority IS NULL THEN 'NONE' ELSE 'QUEUED' END::"AnalysisStatus", now(), now()
  FROM src s
  ON CONFLICT (source, "externalId") DO UPDATE SET
      "whitePlayerId" = COALESCE(games."whitePlayerId", EXCLUDED."whitePlayerId"),
      "blackPlayerId" = COALESCE(games."blackPlayerId", EXCLUDED."blackPlayerId"),
      "updatedAt" = now()
  RETURNING id, "externalId", (xmax = 0) AS created),
gp AS (
  INSERT INTO game_players ("gameId", "userId", color, source, mode, "timeClass", rated, "endedAt", result,
      "ratingBefore", "ratingDelta", "opponentName", "opponentRating", "ecoCode", "linkedAccountId", "createdAt", "updatedAt")
  SELECT ins.id, $3, s.color, $2::"GameSource", 'IMPORTED', s."timeClass", s.rated, s."endedAt", s.result,
      s."ratingBefore", s."ratingDelta", left(s."opponentName", 40), s."opponentRating", s."ecoCode", $4, now(), now()
  FROM ins JOIN src s USING ("externalId")
  ON CONFLICT ("gameId", "userId") DO NOTHING
  RETURNING "gameId"),
jq AS (
  INSERT INTO jobs (kind, status, priority, "fairSeq", "dedupeKey", "userId", "gameId", payload, "runAt", "createdAt")
  SELECT 'ANALYZE_GAME', 'QUEUED', s.priority, s."fairSeq", 'analyze:' || ins.id, $3, ins.id,
         jsonb_strip_nulls(jsonb_build_object('v', 1, 'gameId', ins.id::text, 'evalHint', s."evalHint",
                                              'importRunId', $5::text)), now(), now()
  FROM ins JOIN src s USING ("externalId") JOIN gp ON gp."gameId" = ins.id
  WHERE s.priority IS NOT NULL
  ON CONFLICT ("dedupeKey") DO NOTHING
  RETURNING "gameId"),
run AS (
  UPDATE import_runs SET
      imported = imported + (SELECT count(*) FROM gp),
      "analysisQueued" = "analysisQueued" + (SELECT count(*) FROM jq),
      "firstGameId" = COALESCE("firstGameId", (SELECT ins.id FROM ins JOIN src s USING ("externalId") ORDER BY s.ord LIMIT 1)),
      phase = $8, "updatedAt" = now()
  WHERE id = $5 RETURNING imported, analysed),
acct AS (
  UPDATE linked_accounts SET "importedCount" = "importedCount" + (SELECT count(*) FROM gp), "updatedAt" = now()
  WHERE id = $4 RETURNING id),
ver AS (
  UPDATE users SET "gamesVersion" = "gamesVersion" + 1                    -- archive ETag (api-perf AP-19)
  WHERE id = $3 AND EXISTS (SELECT 1 FROM gp) RETURNING 1),
cur AS (
  UPDATE import_cursors SET archives = COALESCE(archives, '{}'::jsonb) || $6::jsonb,
      "lichessResumeUntilMs" = COALESCE($7, "lichessResumeUntilMs"), "updatedAt" = now()
  WHERE "linkedAccountId" = $4 RETURNING 1)
SELECT (SELECT count(*) FROM gp) AS new_rows, (SELECT count(*) FROM jq) AS queued,
       (SELECT imported FROM run) AS imported, (SELECT analysed FROM run) AS analysed;
-- $1 rows (≤ 100), $2 source, $3 userId, $4 linkedAccountId, $5 runId, $6 cursor patch ('{}' when none),
-- $7 resume-until or NULL, $8 phase ('reading' for the early chunk, else 'saving')
```

`referenceId` values are cuids generated in the worker (Prisma's `@default(cuid())` is client-side). A game imported earlier by the opponent (another member) is attached through the `ON CONFLICT … DO UPDATE … RETURNING id, (xmax = 0)` form (api-perf AP-26 confirms it; `DO NOTHING` would drop the second member's row) and gets its own `game_players` row. Errors: 23503 (the account was deleted mid-run, FK `game_players_linkedAccountId_fkey`) → stop, run `CANCELLED`; 40001/40P01 → retry the chunk once; `57P01`, `08006`, `ECONNRESET` (Neon closed an idle connection after a suspend, feasibility F-OCI-4) → retry once at once on a fresh connection, then the job back-off; statement timeout (15 s role limit) → fail the job attempt (it resumes, because the known-game filter skips what was saved). The worker never holds a transaction open between chunks (an idle transaction keeps Neon awake).

### 8.9 Analysis priorities for imported games (`WK/src/import/priorities.ts`)

**Budget** (D4-09, feasibility F-OCI-3). At run start `loadImportContext()` also returns, in the same query, the member's billing state and `budgetUsed = count(*)` of their imported `game_players` rows (both providers) whose game has `analysisStatus <> 'NONE'` (index `game_players_userId_endedAt_gameId_idx` + `games_pkey`). Then `eager = (trialing ? IMPORT_ANALYSE_EAGER_TRIAL : IMPORT_ANALYSE_EAGER)` and `room = max(0, IMPORT_ANALYSE_CAP − budgetUsed)`.

| Rank among this run's new games (newest = 1) | INITIAL run, trialist | INITIAL run, paying member | MANUAL / DAILY / RETRY run |
|---|---|---|---|
| 1 | `USER_OPENED` (the Done screen waits for this review) | `USER_OPENED` | `IMPORT_NEWEST` |
| 2 – `eager` (20 or 50) | `IMPORT_NEWEST` | `IMPORT_NEWEST` | `IMPORT_NEWEST` (daily runs add a few games, all inside the cap) |
| `eager + 1` – `room` | none now; released at the first paid charge | `BACKLOG`, in daily slices (below) | `BACKLOG` slices |
| beyond `room` | none (`analysisStatus = NONE`; analysed when opened through P3's `POST /api/review/:ref/analyse`) | none | none |

Every queued row carries `fairSeq = rank` (P3's M3 column, consistency R-05; no hedge), so one member's work interleaves with other members' at the same priority. Lichess games with a full `evalHint` let P3 skip pass 1 and run only pass 2 on candidate plies.

**Backlog release in daily slices** (`releaseImportBacklog(sql, userId)` in `DB/src/import-backlog.ts`, so web and worker run the same statement; called by the fan-out on the first paid period, §8.5.4, and by the worker for paying members right after an INITIAL run). One statement inserts `ANALYZE_GAME` jobs for the member's imported games with `analysisStatus = 'NONE'`, newest first, up to `room`, at `JOB_PRIORITY.BACKLOG`, split into `IMPORT_BACKLOG_SPREAD_DAYS` (7) equal slices. Slice *k* (0–6) gets `"runAt" = nextAutoSyncAt + k days` (the member's `HH:05` daily-sync slot, §8.10), and `fairSeq = rank`. Each slice of ≈ 26 games then runs back to back in **one** Neon awake window a day that it shares with the daily sync. An even spread (one game every ≈ 56 min) would keep Neon awake ≈ 18 h for one member, so slices are deliberate. `ON CONFLICT ("dedupeKey") DO NOTHING` makes a second call a no-op, and the statement also sets `games."analysisStatus" = 'QUEUED'` for the chosen games.

Effect on capacity: a trialist costs ≈ 20 analyses (≈ 12 lane-minutes on prod) instead of 200 (≈ 2 lane-hours), and a converting member's backlog spreads over a week of off-peak slots. The architecture "Stage C" triggers (feasibility F-OCI-3) belong to P13.

### 8.10 Sync scheduling (`WK/src/import/schedule.ts`)

```ts
export function nextAutoSyncAt(tz: string, now: Date, lastSyncOkAt: Date | null, accountId: bigint): Date {
  let local = atLocalTime(tz, now, 3, 0);                     // today 03:00 in tz (DST-safe via the P1 tz library)
  if (local <= now) local = addLocalDays(tz, local, 1);       // next 03:00
  const jitterMin = Number(accountId % 60n);                  // deterministic, spreads one hour
  let at = new Date(local.getTime() + jitterMin * 60_000);
  at = new Date(Math.floor(at.getTime() / 3_600_000) * 3_600_000 + 5 * 60_000);   // snap to HH:05 UTC: one Neon wake per UTC hour
  const floor = lastSyncOkAt ? lastSyncOkAt.getTime() + 12 * 3_600_000 : 0;      // R-CC-05: ≤ once per 12 h
  return new Date(Math.max(at.getTime(), floor));
}
```

- `tz` is `users."timeZone"` (M4); while it is still `UTC` the hint reads "Once a day" instead of "About 3 a.m. your time" (R-11).
- The display hint "About 3 a.m. your time" stays true within an hour.
- Snapping every account's daily sync to `HH:05` UTC means the worker wakes Neon at most once per distinct UTC hour in use (≈ 3–8 a day), not once per account. The worker sleeps until `min("runAt")` of the queue (P3's next-due scheduling, api-perf AP-08 / feasibility F-NEON-2; D4-27); there is no hourly tick and no fixed sleep cap to depend on. Backlog slices (§8.9) use the same `HH:05` slot, so they add no wake of their own.
- Manual sync: 1 per 30 s per account (RL) and never before `nextAllowedSyncAt` (provider back-off). It refetches only the current month (Chess.com, cheap with ETag) or `since` (Lichess); the 12-hour rule applies to automatic syncs only.
- Lapsed members: the worker parks the run (`WAITING_FOR_MEMBERSHIP`) and does not reschedule; §8.5.4 restarts it.

### 8.11 Failure handling and the view status

| Failure | Retry | Run | Account | Event | UI |
|---|---|---|---|---|---|
| Chess.com profile 404 | none | `FAILED {not_found}` | `status ERROR`, `importState FAILED` | `import:failed` | "We couldn't find {u} on Chess.com. If you renamed your account, link it again." |
| Chess.com closed (410 / `closed*`) | none | `FAILED {closed}` | `ERROR` | `import:failed` | closed banner (§4.10) |
| 429 from either provider | gate paused (Chess.com 60 s; Lichess 60 s → 120 → 240 → 480 → 900 s), job `runAt = pauseUntil` | stays `RUNNING` → `QUEUED` | `importState RATE_LIMITED`, `nextAllowedSyncAt = pauseUntil` | `import:failed {code: rate_limited, retryAt}` | `rate_limited` countdown |
| 5xx / network / timeout | job attempts: 60 s, 5 min, 15 min, 15 min | `RUNNING` until the last attempt, then `FAILED {upstream \| timeout}` | `importState FAILED`, `lastError` | `import:failed` (terminal) | `sync_failed` / Done `import_failed` |
| Lichess 401 / 403 (not expected on the anonymous export) | as 5xx | as 5xx | as 5xx | `import:failed` | `sync_failed` |
| Neon connection closed after a suspend (`57P01`, `08006`, `ECONNRESET`) | one immediate retry on a fresh connection, then the job back-off | unchanged | unchanged | none | none |
| Account deleted mid-run (23503) | none | `CANCELLED` | — (gone) | none | — |
| Not entitled at start | none | `WAITING_FOR_MEMBERSHIP` | `importState WAITING_FOR_MEMBERSHIP` | none | "Importing starts when your trial begins." |
| Parse error on one game | none | game skipped, `skipped + 1` | `skippedCount + 1` | — | counted in `private_games` banner |
| `IMPORT_PAUSED` | job `runAt + 10 min` | `QUEUED` | unchanged | none | maintenance notice (if set) |

**View status** (`WEB/lib/accounts/view-status.ts`, unit-tested over the full product of the enums):

| `importState` | `nextAllowedSyncAt > now` | View status |
|---|---|---|
| `WAITING_FOR_MEMBERSHIP` | — | `waiting_for_membership` |
| `QUEUED` | — | `queued` (rendered as Syncing) |
| `RUNNING` | — | `syncing` |
| `RATE_LIMITED` | yes | `rate_limited` |
| `RATE_LIMITED` | no | `queued` |
| `FAILED` | — | `error` |
| `IDLE` | yes | `rate_limited` |
| `IDLE` | no | `linked` |

`LinkStatus.ERROR` forces `error` regardless of `importState`.

### 8.12 Purge (`IMPORT_PURGE`, `WK/src/jobs/import-purge.ts`)

Loop until nothing is left, each iteration one statement (batches of 500, data-model §10.4 style):

```sql
WITH victims AS (
  SELECT "gameId" FROM game_players WHERE "userId" = $1 AND source = $2 LIMIT 500),
del_gp AS (
  DELETE FROM game_players gp USING victims v WHERE gp."gameId" = v."gameId" AND gp."userId" = $1 RETURNING gp."gameId"),
del_jobs AS (
  DELETE FROM jobs WHERE kind = 'ANALYZE_GAME' AND status = 'QUEUED' AND "gameId" IN (SELECT "gameId" FROM del_gp) RETURNING 1),
ver AS (
  UPDATE users SET "gamesVersion" = "gamesVersion" + 1 WHERE id = $1 AND EXISTS (SELECT 1 FROM del_gp) RETURNING 1)
SELECT array_agg(DISTINCT "gameId") AS ids FROM del_gp;
-- then: DELETE FROM games g WHERE g.id = ANY($ids) AND g.source <> 'REPLAY'
--        AND NOT EXISTS (SELECT 1 FROM game_players p WHERE p."gameId" = g.id);
```

Deleting `games` cascades `game_analyses`, `player_reviews` and `shares` (M2/M3 `onDelete`). A game the opponent also imported keeps existing for them, and only the purged member's side is cleared (`"whitePlayerId"` / `"blackPlayerId"` = NULL for that member, one extra `UPDATE games … WHERE id = ANY($ids) AND (… = $1)` for the survivors). After each batch: `games:changed {reason: purge}`; at the end PostHog `account_purge_completed {games}` and `audit(… "account.purged" …, meta: {provider, games})`. Purging by `(userId, source)` instead of `linkedAccountId` works after the link row is gone (`linkedAccountId` was set to NULL by the FK).

### 8.13 Display name (inv-pub Q10)

`displayName(viewer)` = Clerk `username` if set → the first linked account's `username` (after Link) → the first word of `users.name` → "there" ("Welcome, there." is never shown in practice because Clerk sign-up always yields a name or email; the email's local part is the last fallback). The header avatar initials use the same string.

### 8.14 PKCE, signed cookies and the token lifetime (`WEB/lib/accounts/pkce.ts`, `WEB/lib/crypto/signed-cookie.ts`)

- **PKCE (RFC 7636 S256)**: `verifier` 64 chars from `[A-Za-z0-9-._~]` (base64url of 48 random bytes); `challenge = base64url(sha256(verifier))`. Test vector (RFC 7636 appendix B): verifier `dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk` → challenge `E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM`.
- **Signed cookie**: `payload.sig` with `sig = HMAC-SHA256(SIGNED_COOKIE_SECRET, payload)`, compared with `timingSafeEqual`; payload carries `v` and `exp`.
- **Token lifetime** (D4-21): the Lichess access token exists only inside one callback invocation: exchange → `/api/account` → `DELETE /api/token` in a `finally`. It is never written to the DB, a log, Sentry or a cookie. The first draft's AES-GCM column, `LINK_TOKEN_KEYS` and `CI/src/crypto/token.ts` are not built.

### 8.15 Ownership and conflicts (D4-10)

| Situation | Chess.com | Lichess |
|---|---|---|
| Nobody else holds the external account | link (unverified) | link (verified) |
| Another user holds it **unverified** | link anyway; `audit_logs account.link_coclaim` | link; the other user's unverified row stays (Lichess rows are always verified, so this case cannot occur) |
| Another user holds it **verified** | `409 linked_elsewhere` | `?lichess=error&reason=linked_elsewhere` (the token is revoked, as on every path) |
| This user already has a different account of the provider | `409 already_linked` (disconnect first) | `reason=already_linked` |
| Same account again | idempotent 200 | refresh the ratings, 302 as success (token revoked) |

The dual-written `chess_com_profiles.chessComHandle @unique` (`schema.prisma:132`) can collide when two users claim the same unverified handle; the dual-write then skips silently (the legacy readers only need the first claimant).

---

## 9. Performance and optimisation

### 9.1 Targets (server time from `Server-Timing: total`, p50 / p95 over 7 days on dev; user-perceived adds optimization §1.2)

Measurement rule (api-perf AP-15): every SLO below has a **server-side** source (route-wrapper timing, Sentry metric, worker metric or a DB column), because P11 loads PostHog only after analytics consent. PostHog events stay for funnels; where a row names a client event, it is a secondary check.

| Path | Class | p50 | p95 | DB round trips | Third-party calls | How measured |
|---|---|---|---|---|---|---|
| `GET /api/me` (with the new joins) | R1 | 25 ms | **< 150 ms** (k6, unchanged P1 budget) | 1 | 0 | k6 `perf/k6/me.js`, Sentry span `api me.get` |
| `GET /api/accounts`, `GET /api/import/status` | R1 | 20 ms | 100 ms (304 path ≤ 60 ms) | 1 (+ viewer) | 0 | k6 `perf/k6/import-status.js` |
| `PATCH /api/me/onboarding` (step) | W1 | 30 ms | 150 ms | 1 | 0 | k6 `perf/k6/onboarding-patch.js` |
| `PATCH {complete}` | X | 250 ms | 1 s | 2 | 1 (Clerk) | Sentry span |
| `POST /api/accounts/chesscom/lookup` warm / cold / worker fallback | X | 40 ms / 700 ms / 1.2 s | 150 ms / 1.5 s / 3 s | 1 | 0 / 2 serial / 2 serial from OCI | span tags `cache`, `source` |
| `POST /api/accounts/chesscom` | X | 60 ms (warm cache) | 400 ms | 1 tx (≤ 7 statements) | 0 warm / 2 cold | span |
| Lichess callback | X | 700 ms | 1.8 s | 1 tx | 3 (token, account, revoke) | span |
| `GET /api/billing/activation` DB path / Dodo path | R1 / X | 25 ms / 500 ms | 100 ms / 1.5 s | 1–2 | 0 / 1 | span tag `dodo: yes\|no` |
| `POST /api/checkout` | X | 500 ms | 1.5 s | 2 | 1 (2 for returning customers) | span |
| Webhook → `entitlement:changed` emitted | — | 300 ms | **≤ 2 s** | — | — | Sentry metric `billing.activation_emit_ms` = emit time − webhook receipt (wrapper), plus `webhook.handle_ms` (api-perf AP-35); the client `checkout_activation_succeeded.waited_ms{via: socket}` is a secondary check |
| Payment → activating `success` (poll only) | — | 3 s | ≤ 8 s | — | — | server metric `activation.waited_ms{via: poll}` recorded by BIL-2 when it first answers `active` (`now − pendingCheckoutAt`) |
| Entitlement → first `import:progress` | — | 2 s | ≤ 5 s | — | — | worker metric `import.queue_wait_ms` + emit timestamp |
| 2,000-game Chess.com first import (reading + saving) | worker | 30 s | ≤ 90 s | ≈ 41 statements | ≈ 14 requests (archives + 12 months + profile) | `import.duration_ms{provider,trigger}`; mock bench ≥ 600 games/min (OPT-43) |
| 2,000-game Lichess first import (anonymous, D4-21) | worker | 100 s | ≤ 150 s | ≈ 31 statements | 1 stream (20 games/s) | same |
| First 100 games saved (early chunk, D4-28) | worker | 5 s | ≤ 15 s | 1 | — | `import.first_chunk_ms{provider}` |
| First review of the newest imported game | worker | 60 s | ≤ 3 min on dev (0.75 CPU + `cpu.idle` slice, feasibility §6) | — | — | worker metric `import.review_ready_ms` = `analysis:done` emit − run `startedAt` (server truth, AP-15) |
| Eager set analysed (20 trialist / 50 member) | worker | — | ≤ 8 min / ≤ 15 min after linking on prod (optimization §2.6, adjusted for D4-09) | — | — | worker metrics `worker.queue.wait_ms{band}` |

**Core Web Vitals (p75, optimization §2.3 row "Onboarding / checkout return")**: LCP ≤ 2.5 s (onboarding) and ≤ 1.8 s (activating), INP ≤ 150 ms, CLS ≤ 0.05. Field data comes from Speed Insights at P1's Hobby sample rate (feasibility F-VER-5) and Sentry web-vitals; CLS at 80–150 % zoom is a **lab** gate in the device × zoom suite, not a field SLO (api-perf AP-35). The aside boards are server SVG with fixed aspect ratio, so they cause no layout shift; fonts come from `next/font` (P1).

### 9.2 Query plans for the hot paths

Verified with `EXPLAIN (ANALYZE, BUFFERS)` on the perf branch seeded `--scale 100` (data-model §13.6) and asserted in CI by `WEB/scripts/db/explain-check.ts` (P1/P3 harness; P4 adds its queries), which fails when the plan does not use the named index.

| Query | Expected plan |
|---|---|
| `/api/me` linked accounts and latest run | `Index Scan using linked_accounts_userId_provider_key`; `Index Scan using import_runs_userId_createdAt_idx` + `Limit 1` |
| `/api/import/status` | `Index Scan using import_runs_userId_createdAt_idx` (Limit 5) → nested loop `games_pkey`, `game_players_pkey` |
| Known-game filter | `Index Scan using games_source_externalId_key` (`= ANY`) → `game_players_pkey` |
| Batch insert | `games_source_externalId_key` for the conflict arbiter; `game_players_pkey`; `jobs_dedupeKey_key` |
| Release waiting runs | `Index Scan using import_runs_waiting_idx` (partial) |
| Sync conflict | unique violation on `import_runs_one_active` (no read needed) |
| Purge batch, analysis-budget count | `Index Scan using game_players_userId_endedAt_gameId_idx` with filter `source = $2` (≤ a few thousand rows per user) |
| Kick CAS | `Index Scan using jobs_dedupeKey_key` (one row) |
| Backlog release | `Index Scan using game_players_userId_endedAt_gameId_idx` → `games_pkey` (≤ 2,000 rows), insert through `jobs_dedupeKey_key` |
| Daily backstop sweep | `Index Scan using linked_accounts_autosync_idx` (partial) |
| Trial ledger probe | `Index Scan using trial_ledger_pkey` OR seq scan of a table with one row per trial ever (≤ thousands, < 1 ms) |

### 9.3 Caching layers

| Layer | What | TTL / invalidation |
|---|---|---|
| L1 TanStack (browser tab) | `qk.accounts()` 60 s, `qk.imports()` 0, `qk.billing.activation` 0, `qk.me()` 5 min | socket events (§5.5); cleared at sign-out (`signOutEverywhere`) |
| L2 HTTP conditional | `GET /api/accounts`, `GET /api/import/status`: `Cache-Control: private, no-cache` + `ETag`; the poller sends `If-None-Match` → 304 (≈ 200 B instead of ≈ 1–2 KB) | per response |
| L3 Next data cache (`unstable_cache`, Vercel) | Chess.com profile/stats per handle (`chesscom:<u>`), archives list and newest month (`chesscom:<u>:archives`, `:month:<yyyy/mm>`), Lichess recent five (`lichess:<id>:recent`); 600 s; `not_found` cached, errors not; values fetched through the worker fallback are cached the same way | `revalidateTag("chesscom:" + u)` after a successful link (so Connected shows fresh ratings) |
| L3b worker LRU | the fallback's Chess.com answers (≤ 2,000 entries, 600 s) | TTL |
| L4 provider conditional requests | Chess.com archives and months with `If-None-Match` / `If-Modified-Since`; validators in `import_cursors` | per month; the current month is always revalidated |
| L5 skip known games | the known-game filter (§8.8) | — |
| Never cached | activation responses, checkout responses, lookup responses (the upstream data is cached server-side; the response itself is `no-store`), anything that sets a cookie. No per-user response in P4 has a `max-age`, so nothing survives in the browser HTTP cache across a sign-out (api-perf AP-04) | — |

The service worker keeps `/api/*` network-only (P1 H8).

### 9.4 Write-path cost

| Operation | Statements (RTT) | Notes |
|---|---|---|
| Link (web, iad1) | 1 transaction, ≤ 7 statements (≈ 1–2 ms each in-region) | dual-write and audit in `after()` |
| Release on entitlement | 1 statement | §8.5.4 |
| Import run (worker, Mumbai → us-east-1 ≈ 200 ms) | context 1 (incl. the budget count) + start 1 + reading progress ≈ 1 per 5 s + known filter ⌈n/500⌉ + saving ⌈n/100⌉ (the early chunk is one of them) + finish 1 + backlog release 1 (paying members) | 2,000 games ≈ 1 + 1 + 6 + 4 + 20 + 1 + 1 = **34 statements ≈ 7 s of RTT**; the `gamesVersion` bump and the `fairSeq` values ride in the chunk statement; the old design (one write per game) would be 2,000+ |
| Daily sync with nothing new | context 1 + start 0 (no run row) + known filter 1 + finish 1 | 3 statements, 2 Chess.com requests (archives 304 + current month 304) |
| Purge 2,000 games | 4 iterations × 2 statements | — |

### 9.5 Neon compute budget (Free plan: 100 CU-h per month per project, 5-minute scale-to-zero)

| Source | Wake pattern | Estimate (0.25 CU) |
|---|---|---|
| Onboarding requests | user-driven; overlaps with existing traffic | negligible on its own |
| First import | ≈ 1–2 min of statements → one 5–6 min awake window | ≈ 0.025 CU-h per new member |
| Eager analysis (20 games per trialist, 50 per paying member) | worker writes ≈ 8 statements per game while it analyses (prod 2 OCPU ≈ 20–40 s per game) | trialist ≈ 0.04 CU-h; member ≈ 0.1 CU-h, once |
| Backlog slices (≤ 150 games, 7 daily slices at the member's daily-sync hour) | each slice ≈ 15–20 min awake on prod, sharing the sync's wake | ≈ 0.4 CU-h per converting member, spread over a week |
| Daily syncs | snapped to `HH:05` UTC, next-due wake (D4-27): ≤ 8 distinct hours in practice → ≤ 8 wakes a day | ≤ 8 × 6 min × 30 = 24 h → **≈ 6 CU-h per month total**, independent of member count (bounded by distinct hours) |
| Activation polls | only during checkout | negligible |

Conclusion: P4 adds roughly **6 CU-h per month** plus ≈ 0.07 CU-h per trialist and ≈ 0.5 CU-h per converting member. Three things matter most: snapping syncs and backlog slices to the hour, the trialist budget of 20 (D4-09), and never polling from a timer. These figures assume the separate dev Neon project (AP-01); on the shared production project they would come out of production's 100 CU-h.

### 9.6 Payload and bundle budgets

| Item | Budget |
|---|---|
| `LookupData` | ≤ 1.5 KB |
| `AccountsData` (2 accounts) | ≤ 2.5 KB |
| `ImportStatusData` | ≤ 2 KB (5 runs) |
| `ActivationData` | ≤ 1 KB |
| `/api/me` growth | ≤ +350 B |
| Socket `import:progress` | ≤ 130 B (with `analysed`), ≤ 1/s |
| Import chunk statement parameter (worker → Neon) | ≈ 100 games × 0.8–1.2 KB ≈ 100 KB |
| First Load JS, `/onboarding/{welcome,link,confirm,level,goals,plan}` | ≤ **140 KB gz** (no `chess.js`, no `motion`, no `socket.io-client`, no zod: the username check uses `CHESSCOM_USERNAME_RE` and response schemas parse in dev/test only, AP-12; `StaticBoard` renders on the server) |
| First Load JS, `/onboarding/{activating,done}`, `/checkout/activating` | ≤ 165 KB gz (`socket.io-client` ≈ 15 KB loaded on the first hold) |
| `/settings/connected` | shell + ≤ 25 KB |

Enforced by the P1 bundle budget report in CI (`next build` route table) with the numbers above added to `WEB/bundle-budgets.json`.

### 9.7 Load and throughput checks

- k6 (dev only, against the separate dev Neon project): `perf/k6/me.js` (regression: p95 < 150 ms), `perf/k6/import-status.js` (50 VUs polling with `If-None-Match`: p95 < 100 ms, ≥ 95 % 304), `perf/k6/onboarding-patch.js` (p95 < 150 ms), `perf/k6/accounts.js`. Hard SLOs use `abortOnFail`; each run writes `REPO/perf/results/p04-<scenario>-<sha>.json`, and `perf/compare.ts` flags a regression > 15 % on the shared `me` scenario against P3's result (testing X18).
- Worker bench: `pnpm --filter analysis-worker bench:import` against the mock upstream on a local Postgres with 200 ms injected latency (`toxiproxy` or `pg` wrapper delay): 2,000 Chess.com games ingest ≤ 90 s, 2,000 Lichess games at the mock's 20 games/s ≤ 150 s, first chunk ≤ 15 s, statement count ≤ 41, never two concurrent upstream requests per provider.
- One real run on dev with a large public Chess.com account (for example `hikaru`): reading + saving to the 2,000 cap, memory peak (`process.memoryUsage().rss`) under 400 MB.

---

## 10. Telemetry

### 10.1 PostHog events (zod schemas in P1's registry `REPO/packages/analytics/src/events/{onboarding,accounts,import,billing}.ts`, closed property sets, `track()` typed against them, testing X6; `area_object_action`, snake case, no PII, no usernames, no FEN)

P4 owns `checkout_start_failed`; P11 marks it reused (consistency R-18). Every event below is asserted automatically through P1's client and server telemetry sinks (§12.4), and the PII guard fails a spec that sends an email, a FEN, a PGN fragment, a typed username or the user's display name.

| Event | Fired by | Properties |
|---|---|---|
| `onb_step_viewed` | client, each step route | `step` |
| `onb_step_completed` | client | `step`, `ms_on_step` |
| `onb_step_skipped` | client | `step` (`link`, `level`, `goals`) |
| `onb_get_started_clicked` | client | — |
| `onb_link_lookup_submitted` | client | `provider: "chesscom"` |
| `onb_link_lookup_result` | client | `result: found \| not_found \| private \| no_games \| rate_limited \| linked_elsewhere \| error`, `ms`, `is_cache_hit` (from `Server-Timing`) |
| `onb_link_lichess_clicked` / `onb_link_lichess_result` | client | `result: linked \| denied \| error`, `reason` |
| `onb_confirm_viewed` | client | `provider`, `games_bucket` (`0`, `1-49`, `50-499`, `500+`) |
| `onb_confirm_accepted` / `onb_confirm_not_me` | client | `provider` |
| `onb_level_selected` | client | `band`, `source: suggested \| changed \| manual` |
| `onb_goals_changed` / `onb_minutes_changed` | client | `goals` / `minutes` |
| `onb_plan_viewed` | client | `plan_default`, `is_trial_eligible` |
| `onb_plan_toggled` | client | `plan` |
| `checkout_started` | client | `source`, `plan`, `is_trial` |
| `checkout_start_failed` | client | `code` |
| `checkout_returned` | client (activating mount) | `status_param`, `source` |
| `checkout_activation_succeeded` | client | `waited_ms`, `via: socket \| poll \| self_heal \| already`, `is_trial`, `source` |
| `checkout_activation_stalled` / `checkout_activation_failed` | client | `waited_ms` / `reason`, `source` |
| `checkout_check_again_clicked`, `checkout_support_clicked`, `onb_activating_continue_background` | client | `source` |
| `onb_completed` | client (once) | `total_ms`, `linked_providers`, `rating_band`, `goals`, `daily_minutes`, `plan`, `is_trial` |
| `onb_done_cta_clicked` | client | `cta: home \| first_position` |
| `onb_import_retry_clicked` | client | `provider` |
| `onb_signed_out` | client | `step` |
| `settings_connected_viewed` | client | `state` (one of the 10 board states) |
| `account_link_started` | client | `provider`, `context` |
| `account_sync_requested` / `account_sync_rate_limited` | client | `provider` |
| `account_autoimport_toggled` | client | `provider`, `is_on` |
| `account_unlink_confirmed` | client | `provider`, `has_delete_games` |
| `lichess_oauth_denied` | client | `context` |
| `account_linked` | **server** (link route, callback) | `provider`, `context`, `is_verified`, `total_rated_games_bucket` |
| `account_unlinked` | server | `provider`, `has_delete_games`, `games_count_bucket` |
| `import_started` / `import_finished` / `import_failed` / `import_rate_limited` | **worker** (batched) | `provider`, `trigger`, `imported`, `skipped`, `total`, `analysis_queued`, `duration_ms`, `reading_ms`, `saving_ms`, `first_chunk_ms`, `upstream_requests`, `upstream_304_count` / `code`, `attempts` / `pause_sec` |
| `import_backlog_released` | server (fan-out) / worker | `games`, `slices`, `trigger: first_charge \| paid_initial` |
| `account_lookup_fallback_used` | server (lookup) | `upstream_status: 429 \| 403`, `result` |
| `review_ready_after_import` | worker (first review of an INITIAL run) | `provider`, `ms_since_entitled` |
| `trial_started`, `subscription_activated` | server (webhook) | `plan_interval`, `source` |
| `trial_ledger_hit` | server (checkout) | `kind: email \| handle` (fraud signal) |
| `account_purge_completed` | worker | `provider`, `games` |

Person properties set on `onb_completed`: `rating_band`, `goals`, `linked_providers`, `trial_used`. Funnel "onboarding v3": `onb_step_viewed{welcome}` → `{link}` → `{confirm}` → `{level}` → `{goals}` → `{plan}` → `checkout_started{onboarding}` → `checkout_activation_succeeded` → `onb_completed` → `review_summary_viewed` (P3). Server events from the worker go through `posthog-node` batched (flush every 10 s or 50 events).

### 10.2 Sentry

- **Web spans**: one per route id (`accounts.lookup`, `accounts.link.chesscom`, `accounts.lichess.callback`, `accounts.sync`, `accounts.unlink`, `import.status`, `import.retry`, `me.onboarding`, `billing.activation`, `billing.checkout`) with tags `provider`, `cache`, `dodo`, `context`. `tracesSampler`: 1.0 for checkout, activation, callback and webhook (money and auth); 0.2 for accounts; 0 for `import.status` 304s.
- **Worker transactions**: `job IMPORT_SYNC` / `job IMPORT_PURGE` with child spans `upstream.chesscom.profile`, `upstream.chesscom.archives`, `upstream.chesscom.month`, `upstream.lichess.stream`, `db.import.known`, `db.import.chunk`, `db.import.finish`; tags `provider`, `trigger`, `phase`, `job_kind`; `Sentry.setUser({id: userRef})`.
- **Scrubbing** (`beforeSend` / `beforeSendTransaction` in web and worker): drop `authorization` headers, the `code`, `code_verifier`, `state`, `access_token` keys in URLs and bodies, the `rc_lichess_pkce`, `rc_act`, `rc_onb`, `rc_onb_next` cookies. The callback's token never leaves the function's memory (D4-21).
- **Metrics** (server-side SLO sources, api-perf AP-15): `import.games{provider}`, `import.duration_ms{provider,trigger}`, `import.first_chunk_ms{provider}`, `import.queue_wait_ms`, `import.chunk_ms`, `import.upstream_ms{provider,endpoint}`, `import.rate_limited{provider}`, `import.skipped{reason}`, `import.lookup_source{web|worker}` (D4-23), `import.review_ready_ms`, `import.backlog_released`, `activation.waited_ms{via}`, `billing.activation_emit_ms`, `lookup.cache_hit`. If the Sentry metrics API is unavailable on the free plan (feasibility §2.5 [V]), the worker exposes the same counters on `/internal/metrics` and `ops-weekly.yml` reads them.
- **Alerts** (owner email, architecture §3.4.4): import failure rate > 20 % of runs in 1 h; ≥ 5 provider 429s in 10 min; `import.lookup_source{worker}` > 50 % of lookups in a day (Chess.com is blocking Vercel's IPs, R-1); ≥ 3 `checkout_activation_stalled` in 1 h on dev during testing (production threshold set in P13); any `lichess.revoke_failed` (weekly digest); any error on `/api/webhook/*` (exists).

---

## 11. Security, privacy, paywall and authorisation

### 11.1 Access matrix

| Route / page | Signed out | Signed in, not onboarded, not member | Not member, onboarded (lapsed) | Member | Admin |
|---|---|---|---|---|---|
| `/onboarding/*` | → sign-in | ✔ | → `/pricing?reason=ended` (middleware, inv-pub §1.2 rule 5) | → `redirect_url` or `/games` (resolver) | ✔ (plan skipped) |
| `/checkout/activating` | → sign-in | ✔ | ✔ | ✔ (success at once) | ✔ |
| `/settings/connected` | → sign-in | ✔ | ✔ | ✔ | ✔ |
| lookup, link, Lichess start/callback, `PATCH` auto-import, unlink, `GET /api/accounts`, `GET /api/import/status` | 401 | ✔ | ✔ | ✔ | ✔ |
| sync, retry | 401 | 402 `subscription_required {reason: trial_available}` | 402 `{reason: expired}` | ✔ | ✔ |
| Import execution (worker) | — | parked `WAITING_FOR_MEMBERSHIP` | parked | runs | runs |
| `PATCH /api/me/onboarding {complete}` | 401 | 409 `plan_required` | 409 | ✔ | ✔ |
| `/dev/import`, `POST /api/dev/import-fault` | 404 | 404 | 404 | 404 | ✔ only when `testHooksEnabled()` (`APP_ENV ∈ {dev, test}` and `ALLOW_TEST_HOOKS=1`); e2e may call the route with `x-e2e-token` instead of an admin session |
| Worker `POST /internal/provider/chesscom/lookup` | 401 (no internal credentials) | — | — | — | — (web only, through `internalFetch()`) |

Every resource is scoped by the viewer: runs by `"userId" = $me` (a foreign `ref` returns 404, never 403), accounts by `("userId", provider)`. There is no route that takes another user's identifier.

### 11.2 Threats and controls

| Threat | Control |
|---|---|
| SSRF / path injection through the username | strict zod regex (Chess.com `^[A-Za-z0-9_-]{3,25}$`), `encodeURIComponent`, fixed base URLs from env; the worker builds URLs only from stored, validated usernames |
| OAuth login CSRF / code injection | PKCE S256 + `state` in an HMAC-signed, `HttpOnly`, `SameSite=Lax`, 10-minute cookie bound to the Clerk user id; timing-safe compare; single use (cleared on callback) |
| Open redirect | `returnTo` is an enum of two paths; `redirect_url` and `returnPath` go through `safeReturnPath` (`//evil`, `/\evil`, encoded variants rejected; unit-tested); the activation return path is built server-side |
| Token theft | **No token at rest** (D4-21; feasibility F-API-3, SEC-6): the scope-less Lichess token lives only inside the callback and is revoked in a `finally` before the response; never logged (Sentry scrubbing, pino redaction `*.access_token*`); no scopes requested |
| Forged internal calls (fake `entitlement:changed`, worker kick loops, lookup abuse) | every internal hop through `CT/internal/auth.ts` (D4-24); per-caller emit allow-list (AP-44); the lookup endpoint accepts only `InternalLookupBody` and serves through the gate with its own cache |
| Importing someone else's games (squatting) | Chess.com data is public and read-only; the importer is told it is "public games only"; one verified owner per account; co-claims are audited; trial ledger enforcement uses verified handles only (D4-10) |
| Trial abuse (delete and re-sign-up) | `TrialLedger` by normalised email hash (Gmail dots and `+tags` folded) and verified handle hashes; duplicate-trial guard in the webhook |
| Rate-limit abuse / our IP being blocked | per-user and per-IP buckets on lookup; serial upstream calls; 10-minute shared cache; provider-wide back-off on 429; worker gate one request at a time per provider |
| Cost abuse (huge accounts, trial churn) | 12-month window, 2,000-game cap, unopened analysis capped at 200 per **member** across both providers and at 20 during the trial (D4-09); `IMPORT_PAUSED` kill switch |
| Activation spoofing via `?status=active` | the server never trusts URL parameters; it checks the DB, a recorded failure, or Dodo by id with an ownership check |
| Clerk claim tampering | claims come from Clerk's signed JWT; `rc_act` / `rc_onb` are HMAC-signed, 120 s, bound to the Clerk user id; APIs check the DB |
| CSRF on cookie-authenticated mutations | P1 wrapper's origin check on every non-GET (rejects with `403 forbidden`; `origin_mismatch` is not a wire code, consistency R-06); JSON bodies only |
| XSS through imported names | names are rendered as text (React escaping); opening names are capped and stripped of markup; no HTML from providers is ever rendered |
| Image proxy abuse, provider terms, Hobby image quota | no provider images at all until OD-2 clears (D4-26; feasibility F-API-4, F-VER-4): `images.chesscomfiles.com` is **not** in `remotePatterns` or the CSP `img-src`; avatars render as initials; Lichess has no avatars |

### 11.3 Privacy

- **What is stored**: the member's public games (moves, clocks, opponents' public usernames and ratings; no PGN copy, D4-30), their public ratings, the link metadata and the `verifiedAt` of a Lichess ownership proof. **No provider token** (D4-21). Imports never post anything to the member's accounts (R-IMP-02; copy "Importing never posts anything").
- **Retention**: imported unanalysed games older than 12 months are pruned (data-model P11); runs are pruned after 30/90 days (P22); disconnect with "delete games" removes the games and their reviews; account deletion (P10) removes links, runs and cursors (cascades). `audit_logs` rows hold refs, never emails, and are kept 400 days (data-model D15).
- **Trial ledger**: hashes only (`HASH_PEPPER`), survives account deletion by design; requires privacy-policy text (OD-2).
- **Chess.com terms**: data is fetched on the member's behalf and never redistributed; no Chess.com branding, glyphs, palettes, pieces or avatars (R-CC-07, D4-26; the provider names appear as plain text only). Legal review of the User Agreement is an owner action (OD-2) and a **P13 preflight blocker** (feasibility F-API-4).
- **Analytics**: no usernames, emails or FENs in PostHog or Sentry; the user id is the `referenceId`.

### 11.4 Paywall rules (Phase 0, implementation-plan §1)

Linking and lookups are allowed before the trial, because onboarding needs them; the import itself is a member feature: it starts only when the DB says the user is entitled (link route, fan-out, worker re-check at run start). A lapsed member's runs park and their daily syncs stop; they resume on renewal.

---

## 12. Testing

Layout (testing X1): unit tests sit beside the source as `*.test.ts` (the `__tests__/` folders below are inside the source tree and match P1's `test:unit` glob); DB-backed tests are `*.int.test.ts`; route, contract and authz tests live under `WEB/test/{api,integration,authz}/` (the first draft's `WEB/tests/…` paths are renamed). P1's `check-test-globs.mjs` must list every P4 test file as run by some script. Every spec is tagged `@p4`; 5 are also `@smoke` (happy path, Lichess, connected accounts, checkout activating, archive lights-up) and run on every PR (testing X2, X11).

### 12.1 Unit tests (`node:test` via `tsx`, added to `test:unit`)

| File | Cases |
|---|---|
| `CI/src/chesscom/__tests__/map.test.ts` | every result code → `outcome` (`GameWinner`) / `endMethod` (`GameEndMethod`, unmapped → `OTHER`) (table-driven, 15 codes × both colours); legacy `result` and `memberWon`; `time_control` parsing (`180+2`, `600`, `1/86400`); `externalId` from live and daily URLs; colour by case-insensitive username; `%clk` with and without tenths; promotion to UCI (`e7e8q`); castling and en passant UCI; custom `initial_setup` with Black to move and `startPly`; `rules ≠ chess` skipped; unrated skipped; < 2 plies skipped; final FEN mismatch (archive `fen` vs replayed PGN on the last ply) → `parse_error`; ECOUrl → opening name; `opponentName` truncated to 40 |
| `CI/src/lichess/__tests__/map.test.ts` | every `status` mapping; `winner` absent → `DRAW`; `outoftime` without winner → TIMEOUT_VS_INSUFFICIENT; draw upgraded to THREEFOLD / FIFTY_MOVE by replay; `speed` → TimeClass incl. ultraBullet and correspondence; clocks centiseconds → ms; `fromPosition` with `initialFen`, Black to move, odd `startPly`; BOT title; `ratingDiff` → `ratingDelta`; `evalHint` with cp and mate (sign and 30000 − n), ignored when the length differs; aborted / noStart skipped |
| `CI/src/lichess/__tests__/ndjson.test.ts` | lines split across chunks; CRLF; trailing line without newline; an invalid line is skipped and counted; abort mid-stream |
| `CI/src/__tests__/time-class.test.ts` | every `speed` / `time_class` value |
| `CT/http/__tests__/onboarding-wire.test.ts` | `toWire` / `fromWire` round trip over every `OnboardingStep`, `RatingBand`, `OnboardingGoal` value; `PatchOnboardingBody` rejects uppercase values (D4-25); `TimeZone` accepts `Asia/Kolkata`, rejects `Mars/Olympus` |
| `CT/http/__tests__/codes.test.ts` (P1's, extended) | the six P4 reasons are in `CONFLICT_REASONS`; `upstream_unavailable` maps only to 502 |
| `WEB/lib/onboarding/__tests__/suggest-band.test.ts` | each band edge (799/800, 1199/1200, 1599/1600, 1999/2000); `MIN_GAMES` = 10; rapid wins ties; fallback to the class with any games; Lichess offsets; clamp 400/2400; `puzzleStart(1184) = 1150` |
| `…/day-preview.test.ts` | the board example (6 + 4 at 10 min); sums equal `M` for every subset of goals × {5, 10, 20} except the documented over-minimum case; each row ≥ 1; Play friends → ANYTIME |
| `…/resolve.test.ts` | the resolver matrix: every `OnboardingStep` × {entitled, not, admin, paywall off} × {link, no link} × {pending checkout fresh, stale, none}; `guardStep` one-ahead and back rules |
| `…/display-name.test.ts` | the fallback chain |
| `WEB/lib/accounts/__tests__/pkce.test.ts` | the RFC 7636 appendix B vector; verifier alphabet and length |
| `WEB/lib/crypto/__tests__/signed-cookie.test.ts` | valid, tampered payload, tampered signature, expired, wrong user |
| `WEB/lib/accounts/__tests__/view-status.test.ts` | the full product `LinkStatus × ImportState × (nextAllowedSyncAt past/future)` against §8.11 |
| `WEB/lib/billing/__tests__/trial-ledger.test.ts` | `normaliseEmail`: Gmail dots, `+tags`, `googlemail.com`, uppercase, non-Gmail dots kept, plus tags dropped on every domain; `trialLedgerEmailHash()` stability with a fixed `HASH_PEPPER` (P10 imports the same function); verified-only enforcement |
| `WEB/lib/accounts/__tests__/chesscom-lookup.test.ts` | web 429 → worker fallback called once; web 403 → fallback; web 404 → no fallback; fallback `rate_limited` → our 429 with `source: chesscom`; fallback timeout → 502 `kind: timeout`; cached value records `source` |
| `WEB/lib/api/__tests__/fallback-interval.test.ts` | a re-created hook (new render) keeps the module-scoped start time and stops after `stopAfterMs` (api-perf AP-20) |
| `WEB/lib/realtime/handlers/__tests__/entitlement.test.ts` | payload → `setQueryData`; `router.refresh()` only when visible and the gate decision changed; hidden tab refreshes on `visibilitychange` (api-perf AP-39) |
| `WEB/lib/env.test.ts` (P1's, extended) | `CHESSCOM_API_BASE` / `LICHESS_BASE_URL` overrides refused with `APP_ENV=production`; `DODO_API_BASE_URL` refused unless `APP_ENV=test`; `testHooksEnabled()` true for `VERCEL_ENV=production` + `APP_ENV=dev` + `ALLOW_TEST_HOOKS=1` (the `replay-chess-dev` case, feasibility SEC-5) |
| `WEB/lib/billing/__tests__/trial-rules.test.ts` (extend) | `isTrialEligible` with `ledgerHit` |
| `WEB/lib/billing/__tests__/activation-machine.test.ts` | every transition in §8.5.3, including stalled at exactly 12 s, failed then active within 30 s, poll stop at 180 s, countdown pause/resume |
| `WEB/lib/billing/__tests__/return-url.test.ts` (extend) | `buildActivationReturnUrl` per source; open-redirect cases |
| `WK/src/import/__tests__/schedule.test.ts` | next 03:00 in `Asia/Kolkata`, `Europe/London` across the October DST change, `America/New_York` on 2027-03-14; hour snap to HH:05 UTC; 12-hour floor; deterministic jitter |
| `WK/src/import/__tests__/priorities.test.ts` | ranks 1, 2, 20, 21 for a trialist INITIAL run; 1, 2, 50, 51, 200, 201 for a paying member; `budgetUsed = 180` leaves room for 20; DAILY runs never exceed the cap; `fairSeq = rank`; priorities read from `JOB_PRIORITY` (no literals) |
| `DB/src/__tests__/import-backlog.int.test.ts` | 180 eligible games → 7 slices with `runAt` = `nextAutoSyncAt + k days`, sizes 26/26/26/26/26/25/25; second call inserts nothing; games beyond the cap stay `NONE` |
| `WK/src/providers/__tests__/gate.test.ts` | never two concurrent requests per provider under 10 parallel callers (including lookup-fallback callers); a 429 pauses all callers; the back-off ladder 60 → 900 s; a lookup waiting > 5 s for the gate returns `rate_limited` |
| `WK/src/dev/__tests__/faults.test.ts` | boot refuses `IMPORT_FAULTS_ALLOWED=1` with `APP_ENV=production` |

### 12.2 Integration tests (local Docker Postgres 17 with M1–M4 applied; mock upstream; fake clock)

`WK/src/import/__tests__/import-sync.int.test.ts`:
1. Chess.com initial import of the fixture account (3 months, 48 games) for a trialist: counts, `game_players` with P2's columns (`endedAt`, `ratingBefore`, `opponentName`, `linkedAccountId`), `games` with `completedAt = expiresAt`, `pgn IS NULL`, `fen`, `endMethod`, `outcome`; jobs: 1 at `USER_OPENED`, 19 at `IMPORT_NEWEST`, the rest `NONE`; every job's payload has `importRunId`; `fairSeq = rank`; `users.gamesVersion` bumped once per chunk; the early chunk was written while `phase = reading`; `firstGameId` = newest; cursor months `done` except the current one; events emitted in order (`progress` reading → saving → `finished` with `analysed`).
1b. The same account for a paying member: 50 eager, the rest as backlog slices; then a trialist's first paid `subscription.active` releases the backlog once (a second webhook delivery changes nothing).
2. Re-run: archives 304, current month 304 → 0 statements of the batch kind, no run row for DAILY, `lastSyncOkAt` advanced.
3. New game in the current month → exactly 1 inserted.
4. Failure mid-month (mock 503 after 30 games) → attempt 1 fails, attempt 2 resumes, no duplicates, final counts equal the clean run.
5. Two members who played each other both import → one `games` row, two `game_players` rows, `whitePlayerId`/`blackPlayerId` both set (the `DO UPDATE … (xmax = 0)` path, api-perf AP-26).
6. Lichess stream 429 → the gate pauses 60 s (fake clock), no concurrent request observed by the mock's concurrency counter (research §20 "Import" row).
7. Lichess interrupted at game 700 of 1,200 → `lichessResumeUntilMs` set; resume fetches only the older remainder; final `lichessSinceMs` = newest.
8. Lichess stream at the mock's anonymous 20 games/s: no `Authorization` header is ever sent (mock asserts), the early chunk lands within 6 s.
9. Account deleted mid-run → run `CANCELLED`, no orphan rows; `game_players."linkedAccountId"` of already-saved rows is NULL (the `SET NULL` FK).
10. Not entitled at start → run parked, no job reschedule.
11. Purge: both providers linked, purge Chess.com → only Chess.com rows removed; a game shared with another member survives for them with only the purged side's `*PlayerId` cleared; queued `ANALYZE_GAME` jobs for purged games removed; `gamesVersion` bumped.
12. Neon connection killed between two chunks (`pg_terminate_backend` on the local Postgres) → the next chunk retries once on a fresh connection and the run completes (feasibility F-OCI-4).
13. P3's analysis completion with `importRunId` → `import_runs.analysed` + 1; the next `import:progress` carries it.

`WEB/test/integration/fanout.int.test.ts`: a webhook `subscription.active` (signed with the test key) for a user with a waiting run → run `QUEUED`, job inserted, `entitlement:changed` sent to a fake `/internal/emit` with body `{v: 1, targets: [{userRef}], …}`, ledger row written, duplicate delivery → no second job; a stale snapshot (older `eventTime` than the stored `subscriptionSourceAt`) → the CAS returns no row and **no** fan-out runs (api-perf AP-06); trialing → active → backlog released once.

`WEB/test/integration/kick-cas.int.test.ts`: 10 concurrent `GET /api/import/status` for a run queued > 30 s → exactly one kick (fake worker counter) (D4-31).

### 12.3 API contract tests (`WEB/test/api/*.test.ts`; route handlers invoked with a fake viewer; responses parsed with the `CT` schemas)

- Every route in §7.0: success shape, each listed error code with the right HTTP status (`upstream_unavailable` always 502), `Cache-Control`, `ETag` / 304, `Retry-After` on 429, `Idempotent-Replayed: true` on a replayed link/checkout, `maxDuration` exported, rate-limit spec `{limit, windowSec}` as in §7.0.
- Authorization rows from §11.1 (signed out, non-member, lapsed, member, admin), including 404 on another user's run ref, and 401 on the worker lookup endpoint without internal credentials.
- Lookup cache: two calls → one upstream hit (mock counter); `not_found` cached; 503 not cached; web 429 → worker fallback (mock counter on the worker path).
- Callback: bad state, expired cookie, other user's cookie, `access_denied`, token exchange failure, linked elsewhere, DB error. **On every path that obtained a token the mock records exactly one `DELETE /api/token`**, and no row or log line contains the token (D4-21).
- GET purity: `GET /api/import/status` and `GET /api/billing/activation` write nothing except the registered `kick_cas` and the CAS-guarded snapshot (api-perf AP-09, AP-31).
- Checkout: trial for an eligible user, none for a ledger hit (email), none for a verified-handle hit, still offered for an unverified-handle hit; `onboardingStep` advanced only for `source: onboarding`; return URL per source.
- Activation: entitled → active + `rc_act`; recorded failure → failed; Dodo self-heal path (mocked SDK) → active and the fan-out ran; foreign subscription id (different `clerkUserId`) → stays pending.
- Webhook: P1's contract tests extended for `payment.failed` and the duplicate-trial guard.

### 12.4 End-to-end (Playwright, local stack in CI: `next build && next start` + socket + worker with the fake engine + `WEB/e2e/mocks/upstream-server.ts` on port 4010 + P1's PostHog sink on 4011, on Docker Postgres 17; never Neon, testing X16 and feasibility F-VER-3)

Infrastructure (WP-H):
- `WEB/e2e/mocks/upstream-server.ts`: `/chesscom/pub/player/:u` (`knightowl_88` found with 3 fixture months; `quiet_rook` closed 410; `ratelimited` 429 `Retry-After: 30`; `blocked` 403 (exercises the worker fallback); `boom` 503; others 404), `/stats`, `/games/archives`, months with ETag/304; `/lichess/oauth` (an HTML page with Approve / Deny that redirects to `redirect_uri` with `code`+`state` or `error=access_denied`), `/lichess/api/token` (POST, DELETE; records every DELETE), `/lichess/api/account`, `/lichess/api/games/user/:u` (NDJSON from fixtures at 20 games/s; fails the test if an `Authorization` header arrives); `/dodo/*` (checkout session create/retrieve, subscription retrieve/list/update; D4-19); `POST /__control` to queue faults and read counters (requests, max concurrency, revokes).
- **Personas, not throwaway users** (testing X4): specs call `leasePersona(name)` (P1's lease pool; §6.7 lists P4's personas), which row-locks a pool user for 15 min and resets it. Two spec files that lease the same persona run with `test.describe.configure({ mode: "serial" })`; P1's `users.test.ts` lint enforces it. Shared users A–R are never mutated.
- `WEB/e2e/fixtures/fresh-user.ts` remains **only** for `checkout/activating.spec.ts`'s fresh sign-up (the one flow that needs a brand-new Clerk user). It creates `e2e-onb-<runId>-<n>+clerk_test@<domain>` (the `e2e-` prefix is what P1's sweeper deletes after 2 h; the unique local part means the ledger's `+tag` folding cannot collide across runs) and on teardown deletes the Clerk user, the DB user (cascade) and its ledger rows.
- `WEB/e2e/fixtures/dodo-webhook.ts`: builds `subscription.active` (trial 7 days, `metadata.clerkUserId`), `subscription.active` after the trial (first charge), `payment.succeeded`, `payment.failed`; signs with `standardwebhooks` and `DODO_PAYMENTS_WEBHOOK_KEY`; POSTs to `/api/webhook/dodo-payments`.
- `playwright.config.ts` `webServer` gains the mock; the web, socket and worker servers get `CHESSCOM_API_BASE` / `LICHESS_BASE_URL` / `DODO_API_BASE_URL` pointing at it. Specs that need the mock are tagged `@local-only` and skipped when `E2E_BASE_URL` targets the deployed dev site (testing X2).
- **Paywall on** in every P4 project (testing X3); the non-member specs depend on it.
- **Server time** (testing X5): the abandoned-checkout case sets `serverNow.set(pendingCheckoutAt + 31 min)` (P1's `x-rc-now` fixture) instead of waiting; rate-limit countdowns assert `retryAfterSec` and the disabled state, not a real 30 s wait.
- **Telemetry** (testing X6): P1's `telemetry` fixture parses every captured event against `packages/analytics` schemas. `happy-path.spec.ts` asserts, in order, one `onb_step_viewed{step}` per step (`welcome` … `done`), `onb_link_lookup_result{result: "found"}`, `checkout_started{source: "onboarding", plan: "monthly", is_trial: true}`, `checkout_activation_succeeded{via}`, `onb_completed`; from the server sink, `account_linked{provider: "chesscom", context: "onboarding"}`, the worker's `import_started` and `import_finished{provider: "chesscom", imported: 48}`. It calls `telemetry.forbid("knightowl_88")`, so a username in any property fails the run (the registry marks no handle as allowed).
- Console guard, hydration guard and the failed-request guard are P1's auto-use fixtures (testing X7); `/api/*` 5xx are allowed only where a spec injects a fault.

| Spec (`WEB/e2e/specs/…`) | Steps | Projects |
|---|---|---|
| `onboarding/happy-path.spec.ts` `@smoke` | persona `onboarding-fresh` → welcome → link `knightowl_88` → found → confirm (5 recent games, initials avatar) → That's Me → level prefilled `800–1200` with "From Chess.com: Rapid 1184" and "Puzzles start near 1150" → goals defaults → plan monthly → Start trial (assert the checkout POST body has `source: "onboarding"` and the PATCH bodies use lowercase wire values; intercept the browser navigation to Dodo) → send the signed `subscription.active` webhook → open `/onboarding/activating?checkout=success&subscription_id=…` → `success` → Continue → Done `importing` → `imported` "Imported 48 games" → Go to Home → `/games` shows the Chess.com tab with 48, 20 of them with a queued or finished review; telemetry assertions above | `desktop-1440`, `iphone` (PR smoke); all 8 devices nightly |
| `onboarding/activation-fallback.spec.ts` | as above but `page.routeWebSocket(/socket\.io/, ws => ws.close())`; webhook sent after 4 s → success via poll (`via: poll`); second case: webhook after 15 s → `stalled` at 12 s, Check Again, then success | `desktop-1440` |
| `onboarding/checkout-failed.spec.ts` | Dodo return with `status=failed` → plan with the bad banner; a signed `payment.failed` while polling → failed → plan | `desktop-1440` |
| `onboarding/link-errors.spec.ts` | `knightowl88xx` not found; `quiet_rook` private → Continue → level manual; `ratelimited` → countdown (worker fallback also limited → `source: chesscom`); `blocked` (web 403) → found through the worker fallback; `boom` → upstream copy; 11 lookups → our own 429; a verified link held by another persona → `linked_elsewhere` | `desktop-1440`, `android` |
| `onboarding/lichess.spec.ts` `@smoke` | Connect Lichess → mock Approve → `/onboarding/confirm?provider=lichess` → That's Me → level prefilled from Lichess blitz (offset applied); the mock recorded exactly one token DELETE; second run: Deny → `lichess_denied` copy | `desktop-1440`, `iphone` |
| `onboarding/trial-used.spec.ts` | persona `onboarding-trial-used` (Q stays read-only): Welcome row 04 copy; plan h1 "Start your membership.", CTA "Start Coaching", no Day 8 row; the checkout POST response has `trial: false` | `desktop-1440` |
| `onboarding/resume-and-guards.spec.ts` | stop at goals, reload `/onboarding` → goals; Alt+← → level keeps the band; deep link to `/onboarding/done` while not entitled → plan; abandoned checkout via `serverNow` (+31 min) → plan with the info banner; member A on `/onboarding` → `/games`; fresh persona on `/games` → `/onboarding?redirect_url=/games` and `rc_onb_next` is set by middleware; Done's "Go to Home" goes to `/games`; Enter submits each step | `desktop-1440`, `ipad-port` |
| `onboarding/keyboard.spec.ts` | the whole onboarding with the keyboard only (no `click()`): Tab order, Enter submits each step, Alt+← goes back, focus is on each step's `h1` after navigation, roving tabindex in the band picker (testing P4 a11y) | `desktop-1440` |
| `checkout/activating.spec.ts` `@smoke` | fresh Clerk user (the only throwaway user, §12.4) onboarded via the API starts checkout from `/pricing` → return URL is `/checkout/activating?redirect_url=…` → webhook → success → countdown pauses on focus → redirect to the destination | `desktop-1440`, `iphone` |
| `checkout/dodo-hosted.spec.ts` `@dodo-hosted` (nightly, dev URL, `retries: 2`, quarantinable) | persona `onboarding-plan` on the deployed dev site → real Dodo test checkout with card `4242 4242 4242 4242` → back on activating → `success` via the real webhook | `desktop-1440` |
| `accounts/connected.spec.ts` `@smoke` | persona `connected-none-member`: `none_linked` → Look up `knightowl88xx` → not_found → `knightowl_88` → syncing → toast "Sync finished · 48 new games"; Sync now twice → `rate_limited` countdown (the row flips to Syncing before the 202, AP-30); toggle auto-import, reload, still off; Connect Lichess approve → `both_linked` + toast; Disconnect Lichess (keep games) → toast; Disconnect Chess.com with delete → `/games` Chess.com tab empty within 30 s; mock fault 503 → Sync now → `sync_failed` banner → Try again recovers | `desktop-1440`, `iphone`, `ipad-land` |
| `accounts/non-member.spec.ts` | persona `connected-nonmember` links Chess.com in settings → "Importing starts when your trial begins.", Sync now hidden; `POST …/sync` → 402 | `desktop-1440` |
| `archive/import-lights-up.spec.ts` `@smoke` | persona `import-trial` during an import: archive banner "IMPORTING n / 48 Chess.com", list grows (`games:changed`), tab counts; after: banner gone; the legacy profile page lists no imported game (§3) | `desktop-1440` |

Each spec carries `@p4`, its `@state:` / `@demo:` tags (§4.12) and, where listed, `@smoke`.

**Device × zoom layout specs** (P1 suite; tiered per testing X9: the 4 PR projects `desktop-1440@100`, `desktop-1280@125`, `iphone@100`, `ipad-portrait@100` on PRs that touch P4 files, all 40 projects = 8 devices × 80/100/110/125/150 % nightly against `next start` in CI): `WEB/e2e/devices/layout/onboarding.spec.ts` visits each step in each designed state through `/dev/ui/onboarding/[step]?state=` (and `&stress=1` at 150 %) and asserts `document.scrollingElement.scrollHeight <= innerHeight`, the primary button's bounding box inside the viewport, the header inside the viewport, and the aside board (when rendered) inside the viewport; `settings-connected.spec.ts` (10 states via `/dev/ui/connected`), `activating.spec.ts` (both kinds × 4 states).

**Real-route layer** (testing X9): P4 adds `/onboarding/welcome`, `/onboarding/link` (persona `onboarding-fresh`), `/settings/connected` (persona `connected-both`) and `/checkout/activating` (entitled member, "already a member") to P1's `e2e/devices/layout/routes.real.ts`, run on `desktop-1440@100/150`, `iphone@100/125` and `ipad-portrait@100`.

**Accessibility** (testing P4): `WEB/e2e/devices/ui/onboarding.a11y.spec.ts` runs P1's `expectNoAxeViolations` on every `/dev/ui/onboarding/[step]?state=`, every `/dev/ui/connected?state=` and every `/dev/ui/activating?kind=&state=` state, light and dark, on `desktop-1440@100` and `iphone@100`.

**Visual baselines** (testing X10; P1's `toHaveScreenshot` setup in the Playwright image, fixed clock, `[data-vr-mask]` on relative dates): `V3OnbWelcome`, `V3OnbPreview` found, `V3OnbRating` prefilled, `V3OnbPlan` trial and trial-used, `V3OnbDone` importing, `/checkout/activating` stalled, `V4SettingsConnected` default and `sync_failed`, on `desktop-1440` and `iphone`, light and dark (`WEB/e2e/devices/visual/p04.spec.ts`). The side-by-side check against the canvas boards stays manual and is recorded in the sign-off.

**Flags-off regression** (testing X11): P1's `flags-off` project runs P1–P3's `@smoke` specs with `onboarding-v3` and `import-v3` off until the legacy code is deleted.

### 12.5 Chess-correctness fixtures (`REPO/packages/chess-fixtures/import/`)

- `chesscom/knightowl_88/{profile,stats,archives}.json` (stats: rapid 1184 with the most games, blitz 1032, bullet 871, daily none, matching `V3OnbPreview`), `chesscom/knightowl_88/2026-08.json`, `2026-09.json`, `2026-10.json`: 48 games built from CC0 Lichess games re-encoded in Chess.com's JSON shape (usernames replaced), covering checkmated, resigned, timeout, agreed, repetition, stalemate, insufficient, 50move, timevsinsufficient, abandoned, a daily game, a chess960 game (skipped), an unrated game (skipped), a custom `initial_setup`, under-promotion, both castlings, en passant.
- `lichess/knightowl88/{account.json, games.ndjson}`: 30 CC0 games incl. `analysis` with mate scores, `clocks`, a BOT opponent, `fromPosition`, correspondence, an aborted game, plus one malformed line.
- Cases added in revision 2 (testing P4): a Chess.com game whose archive `fen` disagrees with its PGN on the last ply (→ `parse_error`, skipped and counted); a Chess.com **daily** game whose `end_time` is 23:30 UTC (`timeClass` DAILY; the archive shows it on the next local day for a member in `Asia/Kolkata`, on the same day in `America/New_York`); a Lichess `fromPosition` game with Black to move and an odd `startPly`.
- Each fixture has `*.expected.json` (externalId, colour, outcome, endMethod, plyCount, fen, timeClass, clocks length, startPly). A test replays every `moves` string with chess.js from `startingFen` and asserts legality, `plyCount`, and that a CHECKMATE game ends in mate.
- A **recorded** real Chess.com month (the owner's own public account, anonymised by the recorder script `CI/scripts/record-fixture.ts`) confirms the `%clk` presence and field names (V-3).
- The design-embedded FEN on the onboarding boards (Kasparov–Topalov before 24.Rxd4) and the five sample-puzzle FENs in `sample-puzzles.ts` are added to P2's `packages/chess-fixtures/design/*.json`, whose test checks their legality (testing X13).

### 12.5b Provider canary (`CI/scripts/canary.ts`, a job in P1's `nightly.yml`; testing P4, architecture §5.3.5)

- Read-only, through the same clients, gate and User-Agent as the worker (serial, polite):
  - one public Chess.com account's current-month archive (the owner's own account, as for V-3), plus its profile and stats;
  - one Lichess user's last 5 games as NDJSON (anonymous).
- Parses everything through the `CI` mappers with the provider zod schemas in **strict** mode, so a new or a missing field fails the job, and checks that each mapped game replays legally.
- Two failures in a row open a GitHub issue (label `provider-drift`, assignee the owner). The job never writes to a database.

### 12.6 Parity checks before deleting the legacy code (allocation §1.1.2)

1. Every legacy capability has a v3 equivalent: Chess.com lookup ✓, connect ✓, skip ✓ (now skip link only), plan + checkout ✓, activation ✓, profile "connect" CTA → settings ✓.
2. `grep` finds no importer of `ChessComPreviewCard`, `ChessComConnectModal`, `ChessComRatings`, `waitForEntitlement`, `lib/chess-com.ts`, `/api/user/chess-com-profile`, `/api/user/onboarding-skip` (CI dead-code check), including `e2e/fixtures/auth.ts` and `e2e/fixtures/tournament-helpers.ts` (testing X17).
3. The e2e fixtures no longer call `onboarding-skip`; all signed-in specs green.
4. `onboarding-v3` and `import-v3` at 100 % on dev for 48 hours with no new Sentry issues (`scripts/qa/error-window.ts` output in the sign-off).
Then delete: `WEB/app/onboarding/_legacy/`, the three legacy routes, `WEB/lib/chess-com.ts`, `WEB/lib/types/chess-com.ts`, the three components. The deletion is **one commit** (`p4: remove legacy onboarding and chess-com routes`) that lands after the flags have been at 100 % on dev for that window, so `git revert` of a single commit restores the legacy path (feasibility §9 rule 3: legacy stays one release past its parity gate). A grep test then lists the deleted modules and fails if any comes back (testing X11).

### 12.7 Regression of earlier phases

The regression gate is the **whole** main suite plus the whole devices suite on P4's final `dev` SHA, paywall on (CI nightly and one run against the dev URL; testing X11). The rows below are targeted extras, not the gate:

- P1: authz matrix, `/api/me` k6 budget, session-expired and 429 UI, device suite on shell pages.
- P2: the user room still joins for members; the socket token for non-members has `ent=false` and cannot join games.
- P3: open an imported game's review → `analysing` → `summary` with the fake engine; an imported Lichess game with `evalHint` skips pass 1 (worker log + `GameAnalysis.evalSource`); `/games` filters still work with imported rows.
- Phase 0: `e2e/specs/membership.spec.ts` (trial eligibility, checkout with trial in Dodo test mode) updated for the new checkout body (`source`) and response (`chargeDate`); `paid-only.spec.ts` unchanged; `pricing.spec.ts:9` still asserts the pricing page's own default (P11 decides).
- Tournament specs that sign in through `tournament-helpers.ts` (reworked, §3) stay green; an imported game never appears in a tournament list or standings.
- Every defect found in the owner test, the ego-browser checklist or the real-device pass gets a failing automated test first, named `regression: <slug> (#issue)`, listed in the sign-off (testing X14). A flaky P4 test goes into `WEB/e2e/quarantine.json` with an expiry ≤ 14 days, never into a skip.

### 12.8 Manual checklist on the dev site (ego-browser; Dodo dashboard in Claude in Chrome)

1. The owner test script (§1.1) end to end.
2. Each onboarding step at 1440×900 at 80/100/110/125/150 % and at 1280×800, iPad L, iPad P, iPhone, Android sizes: no page scroll, primary button visible, stepper legible (ego-browser viewport + zoom).
3. Real iPhone and Android: link, confirm, level, goals, plan (until Dodo), done; the keyboard does not cover the input's result line (the body region scrolls).
4. Lichess OAuth from an installed PWA on iOS (returns to the browser tab; documented behaviour).
5. Dodo dashboard (test mode): the webhook deliveries for the test subscriptions are 200; pause and resume the dev endpoint to see `stalled` → success.
6. `scripts/qa/error-window.ts --since <last dev deploy>` (testing X6.7): 0 new Sentry issues across web, socket and worker for `environment:dev` and no Vercel runtime 5xx over the test window, or each one triaged in the sign-off; PostHog `app_env=dev`: the onboarding funnel shows each step for the test users (live view, the only manual telemetry check left); Neon dev project: compute hours consumed during the window noted in the sign-off.
7. lichess.org › Preferences › Security after the Lichess step: no Replay Chess token listed (D4-21).
8. Close every tab opened (`task.finish({ keep: [] })`).

**Sign-off record** (testing X15): `REPO/docs/qa/phase-04-signoff.md`, committed, holds the SHA, the Vercel deployment id and the OCI image tags; each owner-test row of §1.1 with pass/fail and its screenshot path under `docs/qa/phase-04/`; the real devices (model and OS version), browsers and zoom levels; P1's state-coverage table for the 27 P4 boards (§4.12); the `error-window.ts` output; the PostHog live-view result; the k6 result files; the provider canary's first green night; defects with their regression tests. **Test window**: from the last P4 deploy to `replay-chess-dev` to sign-off, at least 24 h.

### 12.9 Performance checks (DoD)

k6 budgets in §9.7 pass on dev and their JSON results are committed under `perf/results/`; the worker bench meets ≤ 90 s / ≤ 41 statements (Chess.com) and ≤ 150 s (Lichess); the bundle report meets §9.6; `explain-check` passes; one real large-account import stays under 400 MB RSS.

---

## 13. Work breakdown (17.5 dev-days of work + 3.5 days buffer)

Packages run in parallel where the dependency column allows. **Strict file ownership**: a package edits only the files it lists; anything else goes through the owner. `CT/**` contracts are written first (WP-A day 1) so every package codes against them.

**Shared registries** (feasibility §7). P4 runs alongside P8 (stream B), which also edits `middleware.ts`, `provision-test-users.ts`, `lib/api/keys.ts` and `onboarding/done/page.tsx`. Where P1 turned a registry into a directory, P4 **adds a file** and one barrel line: `WEB/lib/routes/classes/onboarding.ts`, `WEB/lib/api/keys/account.ts`, `WEB/lib/cron/tasks/{import-prune,stale-checkout}.ts`, `WEB/lib/realtime/handlers/{import,entitlement}.ts`, `WEB/e2e/personas/p04.ts`, `WEB/lib/flags/registry/p04.ts`. Where it did not, P4's edit is one contiguous block and the PR carries the `OWNERS.yml` label of the other active phase. `package.json` and the lockfile go through the week's steward.

| WP | Scope | Creates / edits (exclusive) | Depends on | Est. |
|---|---|---|---|---|
| **A** Schema, contracts, backfills, seed | precondition check (§2.3), m4a, M4 (incl. `audit_logs`, `timeZone`, `linkedAccountId`), m4v, protected indexes, JSON schemas, contracts, socket registry lines, emit allow-list lines, `JOB_PRIORITY` names, backlog SQL, `audit()` helper, env registry, backfills, personas | `DB/scripts/check-p4-preconditions.ts`, `DB/prisma/schema.prisma` (M4 sections only), `DB/prisma/migrations/<ts>_m4a_game_enum_safety/`, `<ts+1>_m4_import_onboarding/`, `<ts+2>_m4v_validate_linked_account_fk/`, `DB/prisma/protected-indexes.txt`, `DB/json/{ratings,import-error,import-cursor,jobs}.ts`, `DB/src/jobs.ts` (the four `JOB_PRIORITY` lines only; P3 owns the file), `DB/src/import-backlog.ts`, `CT/http/{accounts,import,onboarding}.ts`, `CT/http/{billing,me}.ts` (additions), `CT/http/codes.ts` (six `CONFLICT_REASONS` entries), `CT/internal/{provider,jobs}.ts` (new file / payload additions), `CT/internal/auth.ts` (allow-list lines), `CT/socket/{user,registry}.ts` (additions), `WEB/lib/audit.ts`, `REPO/turbo.json` (`globalEnv`), `WEB/scripts/backfill/{linked-accounts,onboarding,trial-ledger,clerk-onboarded-claims}.ts`, `DB/prisma/seed/personas.ts` (P4 personas) | P3 merged | 1.75 |
| **B** `packages/chess-import` | clients (anonymous), parsers, mappers on P2's columns, fixtures (+3 cases), recorder, canary | `CI/**` (`package.json`, `src/chesscom/{client,map,types}.ts`, `src/lichess/{client,map,ndjson,types}.ts`, `src/time-class.ts`, `src/index.ts`, tests, `scripts/{record-fixture,canary}.ts`), `REPO/packages/chess-fixtures/import/**`, `REPO/packages/chess-fixtures/design/onboarding.json` | A (contracts only) | 1.25 |
| **C** Web accounts and import API | accounts routes (lookup with worker fallback), Lichess OAuth (revoke in callback), import routes, DAL, jobs helpers, client hooks, `/api/me` additions, cron prune, legacy-profile filter | `WEB/app/api/accounts/**`, `WEB/app/api/import/**`, `WEB/lib/accounts/{chesscom,lichess,pkce,link-service,view-status,avatars}.ts`, `WEB/lib/crypto/signed-cookie.ts`, `WEB/lib/data/{accounts,imports}.ts`, `WEB/lib/data/me.ts` (select additions), `WEB/lib/jobs/import.ts` (`enqueueImport`, `releaseWaitingImports`), `WEB/lib/api/keys/account.ts` (or `keys.ts`; all P4 keys incl. `qk.billing.activation`), `WEB/lib/api/endpoints.ts`, `WEB/lib/api/queries/{accounts,imports}.ts`, `WEB/lib/api/mutations/{accounts,imports}.ts`, `WEB/lib/realtime/useImportProgress.ts`, `WEB/lib/realtime/handlers/import.ts`, `WEB/lib/realtime/UserChannel.tsx` (two barrel lines), `WEB/lib/cron/tasks/import-prune.ts` (or the prune block of `WEB/app/api/cron/daily/route.ts`, calling WP-D's `clearStaleCheckouts()`), `WEB/next.config.js` (`transpilePackages` only), `WEB/app/api/profile/[referenceId]/route.ts` (one `where` line), `WEB/scripts/ops/purge-imports.ts` (rollback tool, §14.4) | A, B | 2 |
| **D** Billing: checkout, activation, fan-out | checkout rework, activation route and DAL (through P1's `refreshFromDodo` and CAS), ledger, fan-out incl. backlog release, webhook additions, `/checkout/activating`, shared `ActivationCard`, poll removal, entitlement handler | `WEB/app/api/checkout/route.ts`, `WEB/app/api/billing/activation/route.ts`, `WEB/app/api/webhook/dodo-payments/route.ts`, `WEB/lib/billing/{trial-ledger,fanout,activation-machine,useActivation,housekeeping}.ts`, `WEB/lib/billing/{trial-rules,return-url,client,entitlement}.ts` (edits; `entitlement.ts` only the post-CAS hook call), `WEB/lib/data/billing.ts` (`getActivation`), `WEB/lib/api/{queries,mutations}/billing.ts`, `WEB/lib/realtime/handlers/entitlement.ts`, `WEB/app/components/billing/useCheckout.ts`, `WEB/app/pricing/PricingContent.tsx` (poll removal only), `WEB/lib/hooks/useRequireSubscription.ts` (poll removal), `WEB/components/billing/{ActivationCard,PlanSummaryAside,TrialTermsLine}.tsx`, `WEB/app/checkout/activating/{layout,page,loading}.tsx`, `WEB/app/dev/ui/activating/page.tsx`, `WEB/lib/cron/tasks/stale-checkout.ts` | A; C's `releaseWaitingImports` signature (contract day 1); P1 F4b merged | 2 |
| **E** Worker import | I/O lane, completion with `min(runAt)`, handlers, gates, batch writer (early chunk), budget and priorities, lookup endpoint, analysis hook line, scheduling, purge, faults, metrics, compose env, Caddy routes, dev fault web route | `WK/src/queue/{lanes,complete}.ts` (edits), `WK/src/jobs/{import-sync,import-purge}.ts`, `WK/src/jobs/analyze-game.ts` (hook line only), `WK/src/import/**`, `WK/src/providers/**`, `WK/src/http/routes/{provider-lookup,dev-fault}.ts`, `WK/src/dev/faults.ts`, `WK/src/scheduler/recurring/import-backstop.ts` (or the housekeeping step), `WK/src/metrics.ts` (import metrics), `WK/package.json` (`bench:import`), `WK/bench/import.ts`, `REPO/deploy/oci/docker-compose.yml` (worker env), `REPO/deploy/oci/Caddyfile.dev` (`handle /internal/dev/*`, `handle /internal/provider/*`), `REPO/deploy/oci/Caddyfile` (`handle /internal/provider/*`, for P13), `WEB/app/dev/import/page.tsx`, `WEB/app/api/dev/import-fault/route.ts` | A, B | 3.25 |
| **F** Onboarding UI | resolver, layout (QueryProvider, RealtimeBoot), 8 steps, components, onboarding PATCH (incl. `timeZone`), middleware rule (`rc_onb`, `rc_act`, `rc_onb_next`), StaticBoard, import progress card, demo routes | `WEB/app/onboarding/**` (incl. `_legacy/LegacyOnboarding.tsx` move), `WEB/components/onboarding/**`, `WEB/components/board/StaticBoard.tsx` (if absent), `WEB/components/import/ImportProgressCard.tsx`, `WEB/lib/onboarding/{steps,resolve,guard,suggest-band,day-preview,sample-puzzles,display-name}.ts`, `WEB/lib/data/onboarding.ts`, `WEB/lib/auth/viewer.ts` (select additions: `onboardingStep`, `pendingCheckoutAt`, `timeZone`), `WEB/app/api/me/onboarding/route.ts`, `WEB/lib/api/mutations/onboarding.ts`, `WEB/lib/routes/classes/onboarding.ts` or `WEB/middleware.ts` (one block), `WEB/app/dev/ui/onboarding/**` | A; C and D endpoints (built against contracts, then integrated) | 3.5 |
| **G** Connected accounts and lights-up | settings page, account cards (initials), archive slots, menu item, profile CTA | `WEB/app/(app)/settings/connected/{page,loading}.tsx`, `WEB/components/accounts/**`, `WEB/components/import/ImportBanner.tsx`, `WEB/app/(app)/games/_components/{SourceTabs,ArchiveEmpty}.tsx` (P3 files; edits limited to tabs, banner slot and empty copy), `WEB/components/shell/AccountMenu.tsx` (one item), `WEB/app/profile/[referenceId]/page.tsx` (`:214` CTA), `WEB/app/dev/ui/connected/page.tsx` | C | 1.5 |
| **H** Test infrastructure, cleanup, docs | upstream mock (+ Dodo), fixtures, personas, fixture rework, e2e / device / a11y / visual / keyboard / real-route specs, test-hook entries, nightly jobs, k6 and results, legacy deletion, sign-off, docs | `WEB/e2e/mocks/**`, `WEB/e2e/fixtures/{fresh-user,dodo-webhook}.ts`, `WEB/e2e/fixtures/{auth,tournament-helpers}.ts` (rework), `WEB/e2e/personas/p04.ts`, `WEB/e2e/scripts/provision-test-users.ts` (onboarded columns for A–R only), `WEB/e2e/specs/{onboarding,accounts,checkout,archive}/**`, `WEB/e2e/devices/layout/{onboarding,settings-connected,activating}.spec.ts`, `WEB/e2e/devices/layout/routes.real.ts` (P4 rows), `WEB/e2e/devices/ui/onboarding.a11y.spec.ts`, `WEB/e2e/devices/visual/p04.spec.ts` + baselines, `WEB/e2e/specs/membership.spec.ts` (checkout body), `WEB/lib/test-hooks/registry.ts` (P4 entries), `WEB/playwright.config.ts` (`webServer` mock + env), `.github/workflows/nightly.yml` (`provider-canary` and `dodo-hosted` jobs), `perf/k6/{import-status,accounts,onboarding-patch}.js`, `perf/results/p04-*.json`, `WEB/bundle-budgets.json` (P4 rows), `WEB/scripts/db/explain-check.ts` (P4 queries and index names), `REPO/docs/qa/design-states.overrides.json` (P4 demo-only reasons), `REPO/docs/qa/phase-04-signoff.md`, deletions in §12.6, `docs/implementation-plan.md` (pointer to this spec) | all; deletion last | 2.25 |

Unit tests are written by the package that owns the code under test; contract tests for a route by the route's owner.

**Order (one developer with Claude; days are dev-days)**

| Day | Work |
|---|---|
| 1 | A: precondition check, contracts and schema; m4a/M4/m4v on local Docker; B starts (mappers + fixtures) |
| 2 | A: migrations on the Neon dev branch, backfills, personas, registries; B: clients, ndjson, canary |
| 3–4 | C (accounts, lookup fallback, OAuth, import routes, DAL, hooks); E starts (lanes, gates, context, run) |
| 5–6 | D (checkout, activation, fan-out, backlog release, `/checkout/activating`); E (reading, early chunk, batch writer, budget, scheduling) |
| 7–7.5 | E (lookup endpoint, purge, failures, faults, bench); F starts (shell, resolver, welcome, link) |
| 8–10.5 | F (confirm, level, goals, plan, activating, done, middleware, demo routes) |
| 11–12 | G (connected page, archive slots, menu) |
| 12–14 | H (mock server, personas, e2e, a11y, visual, keyboard specs, canary job); integration on dev |
| 15–16 | Device × zoom fixes, owner test on dev, real phones, sign-off record |
| 17–17.5 | Parity checks, legacy deletion commit, docs |
| 18–21 | **Buffer (20 %, feasibility §8)** for review fixes and P1/P2/P3 dependency gaps (§2.3) |

**Acceptance criteria per package**

| WP | Done when |
|---|---|
| A | precondition check green (or every gap reported and covered by the safety lines); `migrate deploy` from scratch passes locally and on the Neon dev branch; drift check clean; backfills dry-run and apply on dev with the expected counts; `CT` schemas compile in web, worker and socket; personas render the states listed in §6.7 and reset through the lease pool |
| B | all `CI` unit tests green; every fixture's `expected.json` matches; record script works on a real public Chess.com account; the canary passes locally against the real providers |
| C | contract tests green for ACC-1…8 and OAU-1/2 (incl. the revoke-on-every-path test); `GET /api/me` k6 p95 < 150 ms; OAuth works against the mock and real Lichess on dev, and lichess.org lists no token afterwards |
| D | contract tests green for checkout, activation and the webhook additions; integration fan-out test green (incl. the stale-snapshot no-fan-out case); no `waitForEntitlement` importers left; `/checkout/activating` reaches its 4 states |
| E | integration tests 1–13 green; bench ≤ 90 s / ≤ 41 statements for 2,000 Chess.com games and ≤ 150 s for Lichess; never two concurrent provider requests; dev worker deployed by `deploy-oci.yml` with the new env |
| F | every onboarding board state reachable (real data or demo route, tagged for the state-coverage check); device × zoom suite green for onboarding; resolver matrix tests green; Enter / Alt+← work; keyboard spec green |
| G | the 10 Connected states reachable; archive tabs and banner light up; menu item present |
| H | every spec in §12.4 green in CI (PR smoke subset + nightly full + one dev-URL run); axe clean; visual baselines committed; canary green for one night; legacy removed; sign-off record committed |

---

## 14. Risks, open questions and owner decisions

### 14.1 Owner decisions (needed before or during the phase)

Defaults apply unless the owner objects within 3 days (feasibility §8: one decision register, `docs/decisions.md`).

| # | Decision | Default in this spec |
|---|---|---|
| OD-1 | Import scope and analysis volume (allocation P4 decision 1, feasibility F-OCI-3): window, cap, the trialist and member eager counts, the per-member cap, the 7-day backlog slices; and whether production backfilled links get an automatic first import (B5 `--queue-imports`) in P13 | 12 months, newest 2,000; trialists 20 eager, members 50 eager; 200 unopened analyses per member; backlog in 7 daily slices after the first paid charge; production auto-import yes, throttled |
| OD-2 | Privacy policy text for the trial ledger and imported game data (including opponents' public names and ratings); legal review of Chess.com's User Agreement (R-CC-07) | **P13 preflight blocker** (feasibility F-API-4); until it clears, no Chess.com avatars (D4-26) and provider names as plain text only; no blocker on dev |
| OD-3 | Copy changes against the boards: confirm "Importing starts as soon as your trial begins"; all-time "rated games" counts at lookup and confirm; the rewritten `private_games` banner; "Confirmation sent to …" omitted; "Go to Home" hidden while activating; initials instead of avatars | as written in §4 |
| OD-4 | Chess.com ownership verification (allocation P4 decision 3) | none in P4; unverified handles do not block trials; build the profile-location check in P10 if squatting shows up (`RELINK_REQUIRED` is reserved for it) |
| OD-5 | Default billing interval on the onboarding plan step | monthly (the board's prop); pricing page decided in P11 |
| OD-6 | Does "Play friends" take minutes in the day preview? | no ("ANYTIME") |
| OD-7 | Lichess OAuth client ids (`replay-chess-dev`, `playchess.tech`), requesting no scopes, and **storing no token** (D4-21: every import is anonymous at 20 games/s) | as stated |
| OD-8 | Email provider for the trial-started confirmation and the trial-ending reminder | **P10** owns both (consistency 10.17); P4 builds no email |
| OD-9 | Phase size: 17.5 dev-days of work + 3.5 buffer = 21, against the allocation's 16 | accept 21. If the owner holds 16, cut in this order: the visual baselines (0.25 d), the keyboard spec (0.25 d, keep the manual check), the worker lookup fallback (0.5 d, accept R-1 at medium), the `@dodo-hosted` nightly (0.25 d) |
| OD-10 | Internal-auth scheme (critiques disagree; D4-24) | not P4's decision: P2/P3 own `CT/internal/auth.ts`; P4 inherits whatever it ships |
| OD-11 | CLAUDE.md rule 1 still recommends `prisma db push` for prod; consistency R-20 forbids `db push` on any Neon branch | owner updates CLAUDE.md; P4 uses `migrate deploy` only |

### 14.2 Risks

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R-1 | Chess.com throttles or blocks our egress (Vercel's shared IPs for lookups, the OCI IP for imports) | medium / high | serial calls, User-Agent with contact, 10-minute caches incl. negative results, per-user and per-IP buckets, provider-wide back-off, clear copy; **worker fallback for lookups on 429/403** (D4-23) with the `import.lookup_source` alert; worst case lookups move to the worker entirely (flip the constant `LOOKUP_PRIMARY` to `"worker"` in `WEB/lib/accounts/chesscom.ts`) |
| R-2 | Anonymous Lichess exports (20 games/s) slow the first import of a large account | high / low | 2,000 games ≈ 100 s; the early chunk saves the newest 100 within ≈ 5 s (D4-28), so time to the first review is unchanged; reading progress is visible on Done |
| R-3 | P3 ships a fixed sleep cap or an hourly tick instead of next-due scheduling | low / medium | D4-27 does not depend on a cap: rows with the same `HH:05` `runAt` share one wake either way; with an hourly tick the cost is P3's (AP-08), not P4's |
| R-4 | Heavy importers fill the Neon 1 GB cap faster than data-model §10 assumed | low / medium | 2,000-game cap; no `pgn` copy for imports (D4-30, feasibility F-NEON-4); P11 pruning; the 500 MB alert (data-model O2) |
| R-5 | Clerk claim lag bounces users between `/games` and `/onboarding` | low / high | awaited claim write + `rc_onb`; `rc_act` for entitlement; e2e `resume-and-guards` covers it |
| R-6 | Dodo test-mode webhooks are slow or out of order | medium / low | activation self-heal by subscription id with Dodo's own event time; **P1 F4b's compare-and-set** discards stale snapshots and the fan-out runs only when the CAS wrote (api-perf AP-06) |
| R-7 | Automating Dodo's hosted checkout is brittle | high / low | CI uses the Dodo API mock and signed webhooks; the real checkout is the nightly `@dodo-hosted` spec with `retries: 2`, quarantinable, plus the owner test |
| R-8 | Until contract **C3** (P10), `games.creatorId` is required with `ON DELETE CASCADE`: if the first importer of a game two members share deletes their account, the other member loses that game | low / low | accepted until C3 (data-model makes it `SetNull`); documented |
| R-9 | Large monthly archives (bullet-heavy accounts: several MB per month) inflate worker memory during reading | low / medium | the 2,000 cap stops reading early; per-month JSON is released after parsing; RSS check in §12.9 |
| R-10 | chess.js parsing competes with Stockfish for the dev worker's CPU (`cpus: 0.75` plus the `cpu.idle` slice, feasibility §6; 0.5 is the fallback) | medium / low | the I/O lane yields every 50 games (`setImmediate`); imports are short |
| R-11 | `users."timeZone"` stays `UTC` for members who onboarded before P4 and never toggle auto-import | medium / low | the hint says "Once a day" while the zone is `UTC`; the onboarding PATCH and the auto-import PATCH write it |
| R-12 | Imports outrank live games through a wrong priority | low / high | named `JOB_PRIORITY` constants on the DESC scale only (D4-06), a lint rule against literals, and a P3+P4 test asserting `USER_OPENED` and live-game jobs are claimed before `IMPORT_NEWEST` and `BACKLOG` |
| R-13 | P1/P2/P3 names differ from what this spec assumes (`kickWorker`, `kickIfStale`, `mintSocketToken`, `fallbackInterval`, `refreshFromDodo`, `testHooksEnabled`, `/internal/analysis/kick`, `evalHint`, the R-01 columns) | medium / low | WP-A's first task runs the §2.3 precondition check, lists the actual names and updates this spec's references in the hand-back |
| R-14 | P4 and P8 edit the same shared files in the same weeks (feasibility §7) | medium / medium | registry directories where P1 built them; otherwise one contiguous block per file and the `OWNERS.yml` label |
| R-15 | Two critiques disagree on internal auth (D4-24) and the helper changes mid-phase | low / low | P4 code calls only the helper; a scheme change touches no P4 file |

### 14.3 Things to verify early (day 1–2)

| # | Check | How |
|---|---|---|
| V-1 | The anonymous Lichess export streams at ≈ 20 games/s and `/api/account` works with an empty-scope token that is revoked right after | one manual OAuth on dev with the owner's Lichess account; time a 1,000-game anonymous export; check lichess.org › Security afterwards |
| V-2 | How private or unlisted Chess.com games appear in archives (research §19.7); whether "N games private" copy can ever be true | inspect the owner's account archives |
| V-3 | `%clk` presence in Chess.com archive PGNs | the recorded fixture |
| V-4 | Dodo test mode sends `subscription.active` immediately for a trial checkout, `payment.failed` for a declined card on a $0 trial authorisation, and `subscription.active` (or `payment.succeeded` with an amount) at the first charge | one test checkout each, watched in the Dodo dashboard; the first-charge event with Dodo's renewal simulation (`testing-and-go-live` guide) |
| V-5 | `unstable_cache` caches the discriminated `not_found` result on Vercel as expected | contract test plus one dev check (two lookups, one upstream call in the logs) |
| V-6 | Middleware can set `rc_onb_next` on a `NextResponse.redirect()` and on `NextResponse.next()` under Clerk's `clerkMiddleware` | one dev request with DevTools; unit test on the middleware helper |
| V-7 | The §2.3 preconditions (R-01 columns from M2/M3) | `DB/scripts/check-p4-preconditions.ts` on a fresh local `migrate deploy` |

### 14.4 Rollback (feasibility §9, P4 row)

| What | How to roll back | Notes |
|---|---|---|
| Web code (Vercel `replay-chess-dev`, Hobby) | Instant Rollback reaches only the previous deployment; anything older is a revert commit on `dev` | production gets P4 in P13, where Pro allows older rollbacks |
| Onboarding v3 | `onboarding-v3` off → `/onboarding` renders `LegacyOnboarding`, step routes 404, checkout returns use the legacy paths | only until the legacy deletion commit; after it, `git revert` of that one commit restores the legacy path (§12.6) |
| Imports | `import-v3` off → account and import routes 404, archive tabs hidden; `IMPORT_PAUSED=1` on the worker stops all claims without a deploy | queued `IMPORT_SYNC` rows wait; nothing is lost |
| Imported data | **data rollback = `IMPORT_PURGE` per account** (the same job as "Disconnect and delete games"), run per user or for all users of a provider with `WEB/scripts/ops/purge-imports.ts --provider <p> [--user <ref>]` (dry run by default) | removes games, reviews and queued analyses; links can stay |
| Worker image | redeploy the previous image tag with `deploy-oci.yml`; an older worker claims only kinds it knows, and P4 payloads carry `v` so a newer payload is put back, not failed (§7.7.1) | no schema dependency in that direction |
| Schema | m4a/M4/m4v are additive (new tables, defaulted columns, enum values, one FK); the previous code ignores them. No down-migration | enum values follow the two-release rule where it matters: `GameMode.IMPORTED` and `GameEndMethod.OTHER` exist from M2 (or m4a) before P4's code writes them; rolling web back past m4a is never needed because the values are inert |
| Trial ledger | rows stay **by design**: a rollback never gives anyone a second trial | stated in §11.3 |
| Lichess links | nothing to revoke (no token stored, D4-21) | — |

---

## 15. Definition of done

- [ ] The §2.3 precondition check is green (or each gap is reported to its owner and covered by the safety lines). m4a, M4 and m4v applied to the Neon dev branch named in CLAUDE.md with `prisma migrate deploy` (never `migrate dev`, never `db push`); drift check clean; protected indexes listed; `audit_logs`, `users."timeZone"` and `game_players."linkedAccountId"` (FK validated) exist; backfills B5, B6, B9, B12 applied on dev with their verification queries passing. Production untouched (P13).
- [ ] `packages/chess-import` published in the workspace and used by web, worker and seed; all fixtures pass (incl. the three revision-2 cases); the mappers write P2's column names (D4-22).
- [ ] Every route in §7.0 is live on `replay-chess-dev`, behind `import-v3` / `onboarding-v3`, with contract tests green, the error codes and single statuses of §7, and P4's six reasons in `CONFLICT_REASONS`.
- [ ] No Lichess token is stored anywhere: the schema has no token column, the revoke-on-every-path contract test passes, and lichess.org lists no Replay Chess token after the owner's link (D4-21).
- [ ] The worker on the OCI dev VM runs `IMPORT_SYNC` and `IMPORT_PURGE` on the I/O lane and serves the Chess.com lookup fallback; `deploy-oci.yml` deployed it with the new env; never two concurrent requests per provider (tests and logs).
- [ ] Trialists get 20 eager analyses, paying members 50, the backlog is released in 7 daily slices after the first paid charge, and no member has more than 200 unopened imported games queued (integration test 1b and a dev check on one converting persona).
- [ ] `import:progress` (with `analysed`), `import:finished`, `import:failed`, `games:changed` and `entitlement:changed` are registered in `CT/socket/registry.ts` and the emit allow-list, are sent with P2's emit body through the shared internal helper, and reach the browser.
- [ ] All 27 P4 boards have a reachable route, and every state in their `data-props` enums is reachable from real data or `/dev/ui/...?state=` (§4.12); P1's state-coverage check reports no missing P4 state, and demo-only states carry a reason.
- [ ] The device × zoom suite (8 devices × 80/100/110/125/150 %) passes for onboarding, `/checkout/activating` and `/settings/connected` (incl. `stress=1` at 150 %): no page scroll, primary action and boards inside the viewport; the real-route rows pass.
- [ ] Axe is clean on every P4 demo state in light and dark; the keyboard-only spec passes; the visual baselines for the listed P4 states are committed.
- [ ] The P3 archive shows the source tabs, the `import_running` banner and the per-source empty tabs; the legacy profile lists no imported games; the account menu has "Connected accounts".
- [ ] Unit, integration, contract and e2e suites in §12 green in CI (lint, `check-types`, drift gate, `check-test-globs`, bundle budgets included) on P4's final `dev` SHA: `ci.yml` smoke on every PR, `nightly.yml` full and device suites, and the post-deploy dev-URL smoke; links in the sign-off record.
- [ ] Onboarding and import telemetry are asserted by the sink-based specs (§12.4), with the PII guard on.
- [ ] Onboarding specs use leased personas; P1's sweeper reports no leaked `e2e-*` Clerk users and the Clerk dev instance stays under its cap; shared users A–R were not mutated.
- [ ] The provider canary is in `nightly.yml` and has passed at least one night.
- [ ] k6 budgets (results committed under `perf/results/`), the worker bench, `explain-check` (incl. every index named in §6.3) and the bundle budgets in §9 are met.
- [ ] The owner test script (§1.1) passes on the dev URL with ego-browser, and the onboarding is checked on a real iPhone and a real Android phone; every defect found has a `regression:` test.
- [ ] `scripts/qa/error-window.ts` shows no new Sentry issue and no Vercel 5xx over a test window of at least 24 h after the last P4 deploy (or each is triaged); PostHog live view shows the onboarding funnel events with `app_env=dev`.
- [ ] `REPO/docs/qa/phase-04-signoff.md` is committed with the items listed in §12.8.
- [ ] Parity checks (§12.6) passed, then the legacy onboarding page, `ChessComPreviewCard`, `ChessComConnectModal`, `ChessComRatings`, `lib/chess-com.ts`, `lib/types/chess-com.ts` and the three legacy endpoints are deleted in one revertible commit; no `waitForEntitlement` copy remains; no fixture calls a deleted endpoint.
- [ ] `docs/implementation-plan.md` points to this spec; owner decisions OD-1…OD-11 are recorded with their answers (or the defaults) in `docs/decisions.md`; the cross-file edits in Appendix Z.2 are handed to the owners of those files.

---

## Appendix Z. Critique dispositions (revision 2)

Sources: `SP/plan/critique-coverage.md` (COV), `critique-consistency.md` (CON), `critique-feasibility.md` (FEA), `critique-testing.md` (TST), `critique-api-perf.md` (API). "Accepted" names the section that now carries the fix. "Rejected" gives the reason in one line. Where two critiques disagree, the row says which one P4 follows and why.

### Z.1 Findings that concern P4

| Source · ID | Finding (short) | Disposition | Where |
|---|---|---|---|
| COV · phase-04 | No gaps: 27 boards, all states, edges E10–E20 and E43 | Accepted as confirmation; no change. State coverage is now also machine-checked (TST X8) | §4.12 |
| COV · C-08 | P7's empty state links to `/settings/accounts` | Not a P4 change: `/settings/connected` stays; P7 fixes its link | Z.2 |
| CON · 4.1 | Batch writer SQL uses data-model column names | Accepted: P2's names throughout, plus explicit `updatedAt` and `expiresAt` | D4-22, §8.8 |
| CON · 4.2 | Mapping tables use `playedAt`, `finalFen`, `WHITE_WIN`, `endReason` | Accepted: `endedAt`/`completedAt`, `fen`, `WHITE/BLACK/DRAW`, `endMethod` with `OTHER` | §8.6, §8.7 |
| CON · 4.3 | `GamePlayer.linkedAccountId` is never created | Accepted: M4 column, `NOT VALID` FK, `m4v` validate file | §6.1, §6.2, §6.5 |
| CON · 4.4 | `ADD COLUMN IF NOT EXISTS` lines for `externalId`/`externalUrl` | Accepted: marked as no-op safety lines; precondition table added | §2.3, §6.2 |
| CON · 4.5 | `users.timezone` has no creator | Accepted: `User.timeZone` in M4, in `MeData`, written by the onboarding and auto-import PATCHes | §6.1, §7.1, §7.2, §7.3.7 |
| CON · 4.6 | `audit_logs` written before it exists | Accepted: `AuditLog` + enums in M4, `WEB/lib/audit.ts` moved to P4 | §6.1, WP-A |
| CON · 4.7 | M4a re-adds `JobKind` values M3 already has | Accepted: `JobKind` lines dropped; `m4a` now holds only the R-01 game-enum safety lines | §6.2 |
| CON · 4.8 | Priority module and dual scale | Accepted: `JOB_PRIORITY` in `DB/src/jobs.ts`, DESC values only | D4-06 |
| CON · 4.9 | `upstream_unavailable` is 504 in places | Accepted: always 502 with `details.kind` | D4-05, §4.2, §5.8, §7.3.1 |
| CON · 4.10 | "Internal HMAC" on kick and emit | Accepted in form: P4 names no scheme and calls the shared helper (FEA SEC-4 and API AP-44 want HMAC, CON R-08 keeps the token; the helper owner decides) | D4-24 |
| CON · 4.11 | `/internal/emit {room, event, data}` | Accepted: P2's `{v, targets, event, data, dedupeKey?}` | §7.6, §7.7.3, §8.5.4 |
| CON · 4.12 | ME-1 `private, no-store` + ETag | Accepted: `private-etag` | §7.0 |
| CON · 4.13 | `TRIAL_LEDGER_PEPPER` vs P10's pepper | Accepted: `HASH_PEPPER` and an exported `trialLedgerEmailHash()` | §6.1, §7.9, §8.4 |
| CON · 4.14 | "`creatorId` … until M9" | Accepted: until contract C3 (P10) | §8.6, R-8 |
| CON · 4.15 | "If P3 implemented `fairSeq`" hedge | Accepted: hedge removed; `fairSeq = rank` | §8.8, §8.9 |
| CON · 4.16 | No trial-reminder email built here | Accepted (no P4 code change): §2.2 now names P10 as owner | §2.2, OD-8 |
| CON · R-06 | Conflict reasons must be registered | Accepted: six reasons appended to `CONFLICT_REASONS` | D4-05, WP-A |
| CON · R-07 | One registry file `CT/socket/registry.ts` | Accepted: no `WS` edits | §3, §7.6 |
| CON · R-09 | Env names (`LINK_TOKEN_KEYS`, `HASH_PEPPER`) | Accepted; `LINK_TOKEN_KEYS` is removed altogether by D4-21 | §7.9 |
| CON · R-10 | `CT` = `packages/contracts/src` | Accepted | shorthand table |
| CON · R-13 | Limits as `limit / windowSec` | Accepted | §7.0 |
| CON · R-17 | Lowercase wire enums | Accepted (not listed for P4, but P4 violated it) | D4-25, §7.1 |
| CON · R-18 | `checkout_start_failed` owner | Accepted: P4 owns it | §10.1 |
| CON · R-20 | No `db push`; no hard-coded branch ids | Accepted; CLAUDE.md rule 1 conflict raised to the owner | §6.5, OD-11 |
| CON · R-19 / #13 | P8 runs in parallel with P4 | No P4 change beyond the shared-file risk | §13, R-14 |
| FEA · 10.10.1 / F-API-1 | Chess.com lookups from Vercel's shared IPs | Accepted: worker fallback on 429/403, both caches, `import.lookup_source` | D4-23, §7.3.1, §7.7 |
| FEA · 10.10.2 / F-API-3, SEC-6 | Do not keep the Lichess token | Accepted, stronger: revoke inside the callback, all imports anonymous. Rejected sub-variant "use the token for the initial import, then revoke": that run can wait up to 30 days for a trial, so the token would sit at rest | D4-21, §7.3.5, §8.14 |
| FEA · 10.10.3 / F-OCI-3 | 200 eager analyses per sign-up saturate the worker | Accepted: trialists 20, members 50, cap 200 per member, backlog after the first paid charge. "Spread over 7 days" is implemented as 7 daily slices at the sync hour, because an even spread would keep Neon awake ≈ 18 h per member | D4-09, §8.9 |
| FEA · 10.10.4 / R-3, F-NEON-2 | Daily planner with per-hour jobs | Next-due wake accepted. Per-hour grouping job rejected: rows sharing an `HH:05` `runAt` already cost one wake per hour, and per-account rows keep dedupe and one-active-run | D4-27, §8.10 |
| FEA · 10.10.5 / F-API-4 | Chess.com terms review as a P13 blocker; no avatars | Accepted | D4-26, OD-2, §11.2 |
| FEA · 10.10.6 / F-NEON-4 | No `pgn` for imports | Accepted | D4-30, §8.8 |
| FEA · 10.10.7 / §9 | Rollback subsection | Accepted | §14.4 |
| FEA · §6 dev worker CPU | 0.75 + `cpu.idle`, not 0.5 | Accepted | R-10, §9.1 |
| FEA · §6 wake body | `/internal/analysis/kick` body `{kinds[], runAt?}` | Accepted | §7.7.3 |
| FEA · §6 internal auth / SEC-4 | Build HMAC in P2 | Not P4's decision (P2/P3 own the helper); P4 is neutral | D4-24, OD-10 |
| FEA · §7 | Shared files clash with P8; registries as directories | Accepted: P4 adds files where P1 built directories, else one block + `OWNERS.yml` label | §3, §13, R-14 |
| FEA · §8 | 20 % buffer; estimates run over | Accepted: 17.5 d + 3.5 d; owner decides against the allocation's 16 | §13, OD-9 |
| FEA · §9 rules 1–4 | Enum two-release rule, versioned payloads, legacy one release, Hobby rollback | Accepted. Rule 3 is met by deleting legacy in one revertible commit after the 48 h window, because allocation §1.1.2 binds the deletion to this phase | §6.4, §7.7.1, §12.6, §14.4 |
| FEA · SEC-3 | Dev site is a free copy; Vercel protection | Accepted for P4's part: the Dodo webhook URL carries the bypass if P1 enables protection | §1.1 |
| FEA · SEC-5 | `VERCEL_ENV` gates never open on dev | Accepted: `testHooksEnabled()` = `APP_ENV` + `ALLOW_TEST_HOOKS` | §7.0, §7.9, §12.1 |
| FEA · F-OCI-4 | Neon closes idle connections | Accepted: one immediate retry on a fresh connection; no idle transactions | §8.8, §8.11, §12.2 |
| FEA · F-NEON-1 / API · AP-01 | Dev shares the production project | Accepted as a P1 dependency; P4's k6 and real imports run only on the dev project | §2.3, §9.5, §9.7 |
| FEA · F-VER-3 | Device matrix against the deployed site | Accepted: CI against `next start`; deployed smoke only | §12.4 |
| FEA · F-VER-5 | Speed Insights quota | Accepted: P1's sample rate; Sentry web-vitals | §9.1 |
| FEA · §2.5 Sentry metrics [V] | Metrics API may not be free | Accepted: `/internal/metrics` fallback | §10.2 |
| FEA · F-API-5 | Gate, ETags, back-off, cap, mocks correct | No change | — |
| TST · P4 a11y | No axe, no keyboard run | Accepted | §12.4 |
| TST · P4 visual | No baselines | Accepted: 10 states × 2 projects × 2 themes | §12.4 |
| TST · P4 fresh users / X4 | Lease personas; reset ledger; throwaway only for checkout | Accepted. Naming changed to `e2e-onb-<runId>-<n>` so it matches P1's sweeper rule `e2e-*` exactly (the critique's `e2eonb…` would escape it) | §6.7, §12.4 |
| TST · P4 canary | Provider canary missing | Accepted | §12.5b |
| TST · P4 telemetry / X6 | Assert events, PII guard | Accepted with P4's registered names (`onb_step_viewed`, `onb_link_lookup_result`, `checkout_started{is_trial}`, `import_finished{imported}`); the critique's `onboarding_*` names and `trial`/`games` props are not in the registry | §10.1, §12.4 |
| TST · P4 Dodo hosted | Nightly `@dodo-hosted` | Accepted, plus the manual pass | D4-19, §12.4 |
| TST · P4 fixtures | Three new chess cases | Accepted (the "pgn vs moves" case is "archive `fen` vs PGN", since Chess.com archives carry no `moves`) | §12.5 |
| TST · X17 | `tournament-helpers.ts` calls removed endpoints | Accepted | §3, WP-H |
| TST · DoD additions | axe/visual, canary, personas, telemetry | Accepted | §15 |
| TST · X1 | One test layout | Accepted: `WEB/test/{api,integration}` | §12 |
| TST · X2, X3, X5, X8, X9, X11, X12, X14, X15, X16, X18 | CI runs, paywall on, server time, state tags, tiered matrix and real routes, whole-suite regression and flags-off, test-hook registry, regression-test rule, sign-off, Docker Postgres, perf results | Accepted | §4.12, §7.0, §7.7.4, §7.10, §8.1, §9.7, §12.4, §12.7, §12.8, §15 |
| TST · X4 table (Q) | `--fresh Q` resets a shared read-only user | Accepted: persona `onboarding-trial-used` | §1.1, §3, §12.4 |
| TST · X13 | Design-embedded FENs | Accepted for P4's boards | §12.5 |
| API · 4.9.1 / AP-06 | Billing CAS falls between P1 and P4 | Accepted: P1 F4b owns it; P4 adds columns and runs the fan-out only after a CAS write; API snapshots use Dodo's event time | D4-11, §3, §7.5.3, §8.5.1 |
| API · 4.9.2 / AP-30 | Sync now not optimistic | Already optimistic in the first draft; made explicit (`onMutate`, board row) | §4.10, §5.2 |
| API · 4.9.3 / AP-10 | Backlog invalidation storm | Accepted: `analysed` on `import:*`, no per-game backlog events, P5 throttle | §6.1, §7.6, §5.5 |
| API · §1 per-user index | `playedAt` should win | **Rejected**: P2 shipped `endedAt`, five phases use it, and CON R-01 rules the first shipper wins; P4 follows R-01 | D4-22 |
| API · §1 priority module | `PRIORITY` in `packages/contracts/internal/jobs.ts` | Scale accepted; location and names rejected in favour of CON R-05 (`JOB_PRIORITY` in `DB/src/jobs.ts`, next to P3's enqueue SQL) | D4-06 |
| API · §1 membership event | Fold `membership:updated` into `entitlement:changed` | Accepted for P4's payload (`subscriptionUpdatedAt`); P10 drops its event | §7.6 |
| API · §1 / AP-44 internal auth | HMAC mandatory from P3 | Not P4's decision; the per-caller allow-list part is accepted | D4-24, §7.6 |
| API · AP-09 | GETs re-kick on every poll | Accepted: jobs CAS on `lastKickAt` | D4-31, §5.7, §7.4 |
| API · AP-11 | UNLOGGED windows reset | Confirmed safe: every P4 window ≤ 60 s, `store: "burst"` | §7.0 |
| API · AP-12 | zod in client bundles | Accepted | §4.2, §5.1, §9.6 |
| API · AP-14 | Headers from RSC pages | Applied to cookies: only middleware and route handlers set them | D4-29 |
| API · AP-15, AP-35 | SLOs need server-side sources and formulas | Accepted | §9.1, §10.2 |
| API · AP-19 | Archive ETag via `gamesVersion` | Accepted: bumped by the import chunk and the purge | §6.2, §8.8, §8.12 |
| API · AP-20 | `fallbackInterval` never stops | Accepted | §5.2, §5.7, §12.1 |
| API · AP-21, AP-22 | One `api()`, transparent 304s, `private-etag` | Accepted | §5.1, §7.0 |
| API · AP-25 | Reconnect resync burst | Accepted | §5.5 |
| API · AP-26 | Import CTE must use `DO UPDATE … xmax` | Confirms P4; cited | §8.8 |
| API · AP-31 | Billing refresh through GET | Accepted for BIL-2: shared refresh function, bucket, CAS-only writes | §7.5.2 |
| API · AP-39 | `router.refresh()` in every tab | Accepted | §5.6 |
| API · AP-48 | `QueryProvider` in the root layout | Accepted: onboarding and checkout layouts mount it | §5.1 |
| API · §2.6 | CI must fail on a missing named index | Accepted | §6.2 |
| API · AP-04 | Per-user `max-age` survives sign-out | Confirmed none in P4 | §9.3 |

### Z.2 Edits handed to other files (P4 does not edit them)

| File | Edit | Reason |
|---|---|---|
| `SP/plan/data-model.md` §5.5, §2 rule 10, L119, L216-219 | Drop `LinkedAccount.accessTokenEnc`, `tokenScopes`, `tokenExpiresAt`, the global `omit` entry and the "401 sets `RELINK_REQUIRED`" note; add `ImportRun` (with `analysed`); move `TrialLedger`, `AuditLog`, `User.timeZone`, `GamePlayer.linkedAccountId` to M4; `"timeZone"` spelling | D4-03, D4-11, D4-21 |
| `SP/plan/architecture.md` L850, L895, App. A (`TOKEN_ENC_KEY`), §3.2.5 CSP | Lichess: OAuth for ownership only, anonymous export, no token; remove the `lichess_revoke` purge step; drop `images.chesscomfiles.com` from `img-src` until OD-2 | D4-21, D4-26 |
| `SP/plan/phase-10.md` L964, L970, L1732, L1766; L1512, L1730; L773, L783-785; L143 | Drop `AccountDeletion.lichessTokenEnc` and `lichess_revoke`; use `trialLedgerEmailHash()` / `HASH_PEPPER`; remove the re-declared billing columns; own the trial reminder | D4-21, CON 10.2, 10.3, 10.17 |
| `SP/plan/phase-13.md` env manifest, Caddyfile, preflight | Drop `LINKED_ACCOUNT_KEY` / `TOKEN_ENC_KEY`; add `handle /internal/provider/*` on the prod Caddy; Chess.com terms review as a preflight blocker; the trial-reminder backstop is P10's | D4-21, D4-23, FEA F-API-4, CON 13.6 |
| `SP/plan/phase-03.md` | Hook line in `analyze-game.ts` for `importRunId`; `kickIfStale` + `jobs."lastKickAt"`; next-due sleep; `analysis:batch`; `users."gamesVersion"`; the M3 columns of R-01 (`ecoCode`, `openingName`, `fairSeq`) | D4-31, API AP-08/09/10/19, CON R-01/R-05 |
| `SP/plan/phase-02.md` | The M2 columns and enum values of R-01 (`GameSource`, `source`, `externalId`, `externalUrl`, display columns, `GameMode.IMPORTED`, `GameEndMethod.OTHER`) | CON R-01; §2.3 |
| `SP/plan/phase-01.md` | F4b compare-and-set and `refreshFromDodo()`; registries as directories; `testHooksEnabled()`; the persona lease pool | API AP-06, FEA §7, TST X4/X12 |
| `SP/plan/optimization.md` §3.7.6, §2.6 | Cite P4's `DO UPDATE … RETURNING (xmax = 0)`; eager-set SLO 20 / 50 | API AP-26, D4-09 |
| `SP/plan/api-design.md` §4.4 | Alias table to `/api/accounts/*`, `/api/import/*` (already listed by CON §3); note the internal lookup endpoint | D4-01, D4-23 |
| `SP/plan/phase-07.md` L353 | `/settings/accounts` → `/settings/connected` | COV C-08 |
| `REPO/CLAUDE.md` rule 1 | Replace "use `prisma db push`" with `migrate deploy` (owner action) | CON R-20, OD-11 |

### Z.3 Further fixes found while revising (not raised by the critiques)

| Problem in the first draft | Fix | Where |
|---|---|---|
| The resolver page set `rc_onb_next`, and `getActivation()` set `rc_act` from the RSC path; App Router server components cannot set cookies | Middleware sets `rc_onb_next`; only route handlers set `rc_act` / `rc_onb` | D4-29, §4.1, §8.1, §8.5.1 |
| P1 defers the onboarding middleware rule and `rc_act` to P4 (`phase-01.md:129`), but the draft listed them as P1's | P4 builds both and `SIGNED_COOKIE_SECRET` | D4-16, §2.3, §7.9 |
| `syncClerkClaims(user, { onboarded: true })` does not match P1's `syncClerkClaims(userId)` | Call P1's signature; it recomputes from the DB | §7.2 |
| `game_players."updatedAt"` and `games."expiresAt"` are `NOT NULL` without a DB default; raw inserts would fail | Set explicitly in the batch writer | §8.8 |
| The legacy profile route lists every `COMPLETED` game where the member is creator, so imports would show as games against nobody | One-line `source: "REPLAY"` filter until P10 | §3 |
| The backlog release was a web module the worker would also need | Shared SQL in `DB/src/import-backlog.ts` | §8.9 |
| A purge left the purged member's id on games the opponent keeps | Clear only that member's `*PlayerId` | §8.12 |
