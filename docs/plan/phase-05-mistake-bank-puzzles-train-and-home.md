# Phase 5 (P5): Mistake Bank, puzzles, Train and Home — detailed plan

Status: **final plan (revision 2)**, 2026-11-02, written against branch `dev` @ `0848b76` (Phase 0 done). Owner of this file: P5 lead. Budget: **26 dev-days** as allocated, re-estimated at **28 dev-days + a 5.5-day (20 %) buffer line** after the critique fixes (§13.3; owner decision D-21). Milestone **M2: import → review → Mistake Bank → train, the chargeable core.**

Revision 2 applies every finding about P5 in the five critiques (`PLAN/critique-{coverage,consistency,feasibility,testing,api-perf}.md`). The largest changes: no `KeyMoment` table (bank ↔ review linking goes through `MistakeOccurrence (gameId, ply)` and `PlayerReview.progress.bankOptOut`), the worker's bank writes become set-based statements inside P3's single HTTP batch, analysis-path socket events are folded into `analysis:done` and throttled on the client, P5 owns the game-over "+1 position added" line, every SQL `now()` becomes the request clock `$now` so end-to-end tests can move server time, and the E2E specs move to leased personas. **Appendix A** lists every finding with its disposition (applied, or rejected with a reason).

**Path shorthands** (same as `allocation.md`):

| Short | Path |
|---|---|
| `REPO` | `/Users/rohitpandit/open_source/chess-battle-turbo` |
| `WEB`, `WS`, `WK` | `REPO/apps/web`, `REPO/apps/web-socket`, `REPO/apps/analysis-worker` (created in P3) |
| `PKG` | `REPO/packages` |
| `CT` | `REPO/packages/contracts/src` (consistency R-10; imported as `@repo/contracts/{http,socket,internal}/<file>`) |
| `TRN` | `REPO/packages/chess-training` (created by P5) |
| `SP` | the planning session's scratchpad, archived scratch inputs that are not in the repo and may no longer exist (see [99-open-decisions.md](99-open-decisions.md) A12) |
| `DR` | `SP/design-ref/project/v2` (board files `*.dc.html`) |
| `DS` | `SP/design-ref/ds/project` (design-system README, tokens, component READMEs) |
| `PLAN` | `SP/plan` (allocation, architecture, data-model, api-design, client-data-layer, optimization, inventories, audits) |

Citations: `file:line` for code that exists today; "(P1)", "(P2)", "(P3)", "(P4)" for files that earlier phases create (no line numbers exist yet, so the anchor is the function or export name from that phase's plan). "rct-b §n" = `PLAN/inv-rct-b.md`, "dm §n" = `PLAN/data-model.md`, "api §n" = `PLAN/api-design.md`, "cdl §n" = `PLAN/client-data-layer.md`, "opt §n" = `PLAN/optimization.md`, "arch §n" = `PLAN/architecture.md`, "alloc §n" = `PLAN/allocation.md`, "res §n" = `PLAN/inv-research.md`.

---

## 0. Naming and decisions this plan fixes (read first)

The planning documents were written in parallel and disagree on several names. P5 follows the allocation's **binding decisions** (alloc §2, B1–B26) where they decide, the data-model's **column design** (dm §5.6) under the allocation's table names, and the API catalogue's paths (api §4.9–4.10) except where the allocation lists a P5 path.

| Topic | Inputs disagree | This plan uses | Why |
|---|---|---|---|
| FSRS tables | `ReviewCard`/`ReviewLog` (dm §3.8, opt §3.5) vs `TrainingCard`/`TrainingAttempt` (rct-b §2.3–2.4, arch §1.4, api §9.2) | **`TrainingCard` (`training_cards`) and `TrainingAttempt` (`training_attempts`)**, with dm §5.6's columns (`itemKey`, SmallInt/Real packing, plain `cardId`/`sessionId`) | alloc B11 binds the rct-b names; dm is the column authority |
| Mistake identity | one row per `(gameId, ply)` (rct-b §2.2, alloc P5 bullet) vs deduped per `(userId, epdHash)` + `MistakeOccurrence` (dm §3.7) | **Deduped: `Mistake @@unique([userId, epdHash])` + `MistakeOccurrence (gameId, ply) PK`** | Research MUST R-PZL-10 (res §7.4): the same opening error in five games is one card ("seen in 5 games"). `(gameId, ply)` stays unique through `MistakeOccurrence` |
| Key moments ↔ bank | a `key_moments` table with `mistakeId`/`inBank` (rev 1 of this file, P7 hedges) vs moments inside `PlayerReview.content.moments[]` (P3-D3, dm D4) | **No `KeyMoment` table.** A moment is `PlayerReview.content.moments[i]` (id = its `ply`, ≤ 3). The moment → bank link is `MistakeOccurrence (gameId, ply)` → `Mistake` → `TrainingCard.mistakeId`. The member's opt-outs live in `PlayerReview.progress.bankOptOut` (P3-D19), which the worker reads in SQL when it creates cards | consistency R-02 / 5.1, api-perf AP-07. P3 owns the storage decision and ships first |
| Per-member game time column | `game_players."playedAt"` (dm, api-perf AP-07) vs `"endedAt"` (P2 M2, shipped) | **`game_players."endedAt"`** and the P2 index `game_players_userId_endedAt_gameId_idx` | consistency R-01: the first phase that ships a column names it; P2 created `endedAt`. Wire DTOs keep `playedAtLabel` |
| Analysis status | `game_players."analysisStatus"` (rev 1) vs `games."analysisStatus"` (P3 M3) | **`games."analysisStatus"`**; joins go through `games` | consistency R-01 / 5.2: there is no per-player status column |
| `User.timeZone` | "M5 adds it if P4 did not" (rev 1) vs P4 M4 | **Created by P4 (M4)**, spelled `timeZone` everywhere (column `"timeZone"`, `MeData.user.timeZone`). M5 does not touch `users` | consistency R-03 / 5.3, 5.4 |
| Stored coach texts | stored per row (rct-b) vs computed at read time, only LLM-verified text stored (dm D7) | **Computed at read time** by `PKG/chess-training/src/explain.ts`; `Mistake.texts Json?` stays null until P7 | ≈500 B/row saved; one code path |
| Content reports | `TrainingReport` + `POST /api/train/reports` (rct-b W7, alloc P5) vs one `Report` + `POST /api/reports` (dm §5.6, api SYS-6) | **`Report` table + `POST /api/reports`** (targetType `MISTAKE`/`PUZZLE`) | One admin queue. **P10** adds `targetType: "user"` (and `"game"`) branches to the same table and handler (consistency R-02 / 5.5); P12's queue reads `reports_status_createdAt_idx` |
| Training prefs | `TrainingProfile` columns (rct-b) vs `UserSettings.prefs.training` (dm D13) | **`TrainingProfile` columns** (`dayStartHour`, `releaseHour`, `bankDailyCap`, `newPerDay`, `autoGrade`); `User.timeZone` from P4 | `UserSettings` ships in P9 (alloc B14). The attempt transaction already updates this row, so prefs cost no extra read. **The only writer is W8 `PATCH /api/train/prefs`** (consistency 10.5 option a). There is no Settings › Training board, so no settings screen is built for these until the owner approves one (D-20, coverage C-12) |
| Socket events | `bank:due` (api §6.6, cdl §5.6) vs `bank.due_changed` (arch X3) vs `bank:due_changed` (alloc §5.2, B20) | **`bank:due_changed`** and **`mistakes:added`** in `user:{ref}`; plus `bankAdded {count, plies}` and `bankDue` on the P3 `analysis:done` payload | B20 is binding. Changes that come from an analysis are **folded into `analysis:done`** (or P3's coalesced `analysis:batch` for backlog games); P5 never emits a separate event for them (api-perf AP-10) |
| `/internal/emit` body and auth | `{room, event, data}` (rev 1) vs P2's `{v:1, targets, event, data, dedupeKey?}` | **P2's body** with `targets: [{userRef}]`; auth is whatever P2's receiver accepts, through the shared helper in `CT/internal/auth.ts` (today `x-internal-token`; HMAC if P2/P13 adopt it) | consistency R-07 / 5.8, R-08. P5 never builds its own header |
| Rate limits | "120 burst / 2 per s" (rev 1) vs P1's fixed window | **`limit / windowSec`**: `train-write` 120 / 60 s; `train-session` 30 / 3600 s; `report` 20 / 86400 s. Windows longer than 300 s are **durable** (counted from the source rows, §7.2), never the `UNLOGGED` bucket | consistency R-13 / 5.9, api-perf AP-11 |
| Error codes | `membership_ended`, `origin_mismatch` (rev 1) | 402 **`subscription_required {reason}`** (`trial_available`, `trial_used`, `expired`, `payment_failed`); 403 **`forbidden`** for a bad `Origin`; P5 registers `session_ended` in `CONFLICT_REASONS` (`CT/http/codes.ts`) | consistency R-06 / 5.6 |
| Glicko-2 module | P5 τ 0.5 / RD floor 50 vs P9 τ 0.75 / RD floor 45 in the same file | **`PKG/game-core/src/rating/glicko2.ts` takes a config; `rating/presets.ts` exports `PUZZLE`** (P5) and later `GAME` (P9) | feasibility #11, §10.11 |
| Shared registries | one file each (`lib/api/keys.ts`, `lib/flags.ts`, `middleware.ts` …) edited by many phases at once | **Directories**: P5 adds `lib/api/keys/train.ts`, `keys/home.ts`, `lib/flags/registry/p5.ts`, `lib/routes/classes/{train,home}.ts`, `lib/realtime/handlers/{train,home}.ts`, `e2e/personas/p5.ts` and one barrel line each | feasibility §7 (P8 and P9 run alongside P5) |
| Server clock | SQL `now()` and `Date.now()` inside services (rev 1) | **`ctx.now`** from P1's `route()` (honours `x-rc-now` only in dev/test with the E2E token, testing X5) is passed into every service; SQL uses the bind `$now`, never `now()`, except for audit columns (`createdAt`, `updatedAt`) | so `day-rollover.spec.ts` can move the release hour, the day start and the streak end to end |
| Neon dev target | branch id `br-misty-dew-b8wy3a8w` hard-coded (rev 1) | **"the Neon dev branch (CLAUDE.md environments table)"**; P1 moves dev to its own Neon project (api-perf AP-01, feasibility F-NEON-1) and the id changes | consistency R-20 |
| Flags | `mistake-bank`, `puzzles` (arch §3.5.3) vs `train`, `home` (alloc §1.6) | **`train`** and **`home`** | alloc §1.6 is binding |
| Summary URL | `/train/session/[ref]` (rct-b §5.5) vs `/train/session/[ref]/summary` (alloc P5) | **`/train/session/[ref]/summary`**; `/train/session/[ref]` redirects (ACTIVE → runner, else → summary) | alloc P5 client list |
| Outbox store | `rc-train-outbox` (alloc P5) vs `rc-outbox` (cdl §7.4) | IndexedDB database **`rc-outbox`**, key `u:<userRef>:attempts` | The cdl outbox also carries lesson events (P8) and offline bot games; one store |
| Route wrapper | `route()` (alloc B18) vs `defineRoute()` (api §2.5) | **`route()`** exported by `WEB/lib/api/route.ts` (P1 F1) | B18 |
| Contracts package | `packages/protocol` (cdl) vs `packages/contracts` (alloc B17) | **`CT/http/train.ts`, `CT/http/home.ts`, `CT/http/reports.ts`, `CT/socket/user.ts`** (+ entries in `CT/socket/registry.ts`) | B17; consistency R-10 (the `src/` segment) |
| Worker priorities | higher = sooner (arch §1.10.4) vs lower = sooner (alloc P3) | **Higher runs first** (P3-D7). Extraction runs inside `ANALYZE_GAME`; the backfill uses **`JOB_PRIORITY.BACKLOG`** (10) from `PKG/db/src/jobs.ts`. No literal priority appears in P5 code | consistency R-05 |
| Puzzle cards | card on first graded attempt (rct-b T4) vs only on a miss (dm O6) | **Card only when the graded attempt was not a clean first-try solve** (grade AGAIN or HARD) | ≈60 % fewer rows; clean solves are logged only. Owner decision D-6 (§14) |
| Which mistakes get cards | every extracted mistake (rct-b §3.1) vs key moments only (rct-a Q10) | **Up to 4 `Mistake` rows per game side; a card only for key-moment plies (≤ 3) that are not in `progress.bankOptOut`** | Keeps the Review-complete copy exact ("3 moments reviewed · 3 added") and lets the A6 toggle control the bank. Owner decision D-9 |
| Game-over bank line | "no change" (rev 1) vs P2/P3/P12 expecting P5 to render it | **P5 owns P2's `GameOverCard` `bank` slot** ("+1 position added to your Mistake Bank (move 13).") | coverage C-01; P2 §2.5 hand-off H-01 |

Everything else in this plan follows the conventions in alloc §5.4 (RSC first paint, TanStack Query, one envelope, keyset cursors, no polling unless the socket is down) and cdl §2–§8.

---

## 1. Goal and user-visible outcome

### 1.1 Goal

Turn each member's real mistakes into FSRS-scheduled puzzles, add themed Lichess puzzles with a puzzle rating, and ship the three surfaces that make the habit loop visible: the **Train hub** (daily plan, streak, all training), the **Mistake Bank** (list, filters, states) and **Home** (the member landing page). This is the first release worth charging for (M2).

### 1.2 What a member sees at the end of P5

0. When a live game ends and its analysis finishes, the game-over card gains one line: "+1 position added to your Mistake Bank (move 13)." (hidden while analysing, when nothing was added, or when the member opted the moments out).
1. After a game is analysed (P3) or imported (P4), its key moments become **bank positions**. Review complete says "3 moments reviewed · 3 added to your Mistake Bank. The first one comes back tomorrow." and **Drill These 3 Mistakes** opens the runner on exactly those positions.
2. The **runner** (`/train/bank/session`) shows one position at a time on a full-size board that never scrolls off screen. Moves are checked instantly in the browser. Hint (ring, then arrow), wrong move ("Not quite." + the coach line), Try Again, Show Solution (600 ms per ply), then a **grade bar** with the real FSRS intervals ("Again < 10 min · Hard 2 days · Good 4 days · Easy 9 days") and the suggested grade highlighted. Any grade can be chosen. The next position appears in under 50 ms.
3. **Puzzles by theme** (`/train/puzzles`): Lichess CC0 puzzles near the member's puzzle rating, with a setup move, a theme picker ("Forks 62% · 14 puzzles"), a rating chip ("Rating 1524 +12 · Streak 5") and the same grade bar. Missed puzzles come back on the FSRS schedule.
4. The **session summary** (`/train/session/[ref]/summary`) shows solved / first try / with a hint, the "How you graded them · next review" table, themes covered and a milestone when one is crossed ("Milestone · forks 70%"), with the `perfect` variant for an all-first-try session.
5. The **Train hub** (`/train`) shows "Thursday · 6 minutes planned", a streak ("4-day streak · Best 9 · resets if you skip 2 days" + M–S dots), **Today's plan** (bank step + puzzle step; the lesson step lights up in P8), "Start Today's Plan · ~6 min", "Due from your games" thumbnails, "All training" and "Theme mastery". When everything is done it switches to **Done for today** with "Your next 6 reviews arrive tomorrow at 08:00."
6. The **Mistake Bank** (`/train/bank`) lists every bank position with Due/All, a Filter popover (Theme, Phase, Source; a sheet on phones), mastery dots, the selected position on a large static board (desktop, iPad landscape) with **Solve This One** and **See It in Your Game**; plus the empty, caught-up ("Coming up: Tomorrow 6 · Saturday 3 …") and loading states.
7. **Home** (`/home`) greets the member in their time zone, shows **Continue** (the last analysed game with its first key moment on a board and **Start Review**), the Mistake Bank card (due count + 4 thumbnails + **Review 4 · About 3 min**), This week (games, puzzles, day dots), Play shortcuts and Recent games; the `new_user`, `import_running`, `payment_failed`, `trial` and `loading` states all render.
8. Members **land on `/home`**: after sign-in, from the logo, after onboarding, and when a signed-in member opens `/`.
9. Grades made **offline** are kept in IndexedDB and synced exactly once when the connection returns; two tabs never double-grade a card.

### 1.3 What the owner can test on the dev site at the end

Dev site: `https://replay-chess-dev-replaychess007-1069.vercel.app` (Vercel `replay-chess-dev`, the Neon dev branch named in CLAUDE.md's environments table, OCI dev socket + worker, Clerk dev, Dodo test). Flags `train` and `home` on for the owner, the shared E2E members A–P and the leased pool users `E2E_POOL_*` (testing X4). The E2E suite runs with `BILLING_PAYWALL=on` (testing X3), so T10 is exercised in CI as well as by hand. Results go into the sign-off record `REPO/docs/qa/phase-05-signoff.md` (testing X15; test window ≥ 24 h after the last dev deploy).

| # | Owner test (from alloc §3 P5, made concrete) | Pass criterion |
|---|---|---|
| T1 | Sign in as the owner (member). | Lands on `/home`. The nav shows Home, Play, Train, Learn, Review, Profile (6 tabs on phones). |
| T2 | Play a bot game to the end, open its review, step through 3 key moments, finish. | Review complete: "3 moments reviewed · 3 added to your Mistake Bank. The first one comes back tomorrow." Tags "Added" on each moment. |
| T3 | Toggle one moment's bank switch off and on again (Review key moments). | Toast "Removed from Mistake Bank" / "Added to Mistake Bank · next review tomorrow". The bank count changes accordingly. |
| T4 | Click **Drill These 3 Mistakes**. Solve #1 first try, #2 with one hint, #3 with a wrong move then Show Solution. | Suggested grades: Good, Hard, Again. Overriding #2 to Good is allowed. #3 graded Again re-appears 3 items later or at the end. |
| T5 | Finish the session (solve the re-queued #3 on its second pass). | Summary shows "3 / 3 Solved · 1 First try · 1 With a hint" (2 / 3 if #3 is missed again), the grade table with real intervals, themes covered. Back to Train works. |
| T6 | Open `/train`. | Plan "0 of 2 done" → after a bank session "1 of 2 done"; the streak increments once per day; "Done for today" after both steps. |
| T7 | `/train/puzzles`, press `T`, pick Pins. | The session rebuilds on pins, progress resets to "1 of 10", rating chip updates after each solve. |
| T8 | During a bank session, turn the network off (DevTools offline), grade 3 positions, turn it back on. | No error shown; "Saving…" never blocks; within 15 s the 3 attempts exist on the server exactly once (summary counts match). |
| T9 | `/home` as the owner, as a fresh member with no games (persona `new`), and while an import runs (persona `trial`). | `populated`, `new_user`, `import_running` states render as designed. |
| T10 | Sign in as E2E user R (non-member). Open `/train`, `/home`, `POST /api/train/attempts`. | Redirect to `/pricing?reason=…&redirect_url=…`; API answers 402 `subscription_required`. |
| T11 | Every P5 screen on a real iPhone and a real Android phone, and on desktop at 80 % and 150 % zoom. | The board (runner) is fully visible with the grade bar; nothing scrolls the document. |
| T12 | Finish a bot game with at least one blunder and stay on the game-over card until analysis completes. | The card shows "+1 position added to your Mistake Bank (move N)." (plural "+2 positions added to your Mistake Bank (moves 13, 19)." when more) without a reload; a clean game shows no line; a reload of `/game/[ref]` shows the same line from the seeded status. |

---

## 2. Scope

### 2.1 In scope

| Area | Items |
|---|---|
| Schema (M5) | `Mistake`, `MistakeOccurrence`, `TrainingCard`, `TrainingAttempt`, `TrainingSession`, `TrainingDay`, `ThemeMastery`, `TrainingProfile`, `Report`; new enums; `GamePlayer.bankVersion`; `JobKind.EXTRACT_MISTAKES` (own migration); `replay_worker` grants for the new tables (P3's roles script). No `KeyMoment` table and no change to `users` |
| Packages | `PKG/chess-training` (new: FSRS wrapper, release time, dayKey, caps, plan, session composition, mastery, streak, theme taxonomy, labels, deterministic explainer, itemKey codec, `CLEANROOM.md`); `PKG/chess-analysis` additions (Tier-1 theme tagger, puzzle uniqueness and line trimming, candidate selection, `epdHash`, `CLEANROOM.md` entries); `PKG/game-core` addition (`rating/glicko2.ts` parameterised by a config, `rating/presets.ts` with `PUZZLE`); `CT` additions |
| Worker | J1 mistake extraction appended to `ANALYZE_GAME`'s final `sql.transaction([...])` batch as set-based natural-key statements; `EXTRACT_MISTAKES` backfill job for games analysed in P3/P4; `analysis:done.{bankAdded, bankDue}` (no separate emits on the analysis path); a coalesced `mistakes:added` (≤ 1 per user per 60 s) for the backfill only; housekeeping rules |
| Puzzle corpus | `scripts/puzzles/build-shards.ts`, `upload-shards.ts`, manifest; R2 path `puzzles/v1/{theme}/{band}.json` (B13) |
| HTTP | R1 `GET /api/train/today`, R2 `GET /api/train/bank`, R3 `GET /api/train/sessions/:ref`, R4 `GET /api/train/themes`, R8 `GET /api/me/badges`, W1 `POST /api/train/attempts`, W2 `POST /api/train/sessions`, W3 `…/extend`, W4 `…/end`, W5 `POST /api/train/cards/:ref/skip`, W6 `DELETE /api/train/cards/:ref`, W7 `POST /api/reports`, W8 `PATCH /api/train/prefs`, HOME-1 `GET /api/home`; P3's A6 `PATCH /api/review/[ref]/moments/[ply]` goes live; P3's A1/A2 review reads gain the bank fields (`MomentDTO.inBank`/`card`, `ReviewStatusDTO.bank`) |
| Realtime | `bank:due_changed`, `mistakes:added` in `user:{ref}` via `/internal/emit` (B20, P2 `targets` body); `bankAdded`/`bankDue` on `analysis:done`; one client-side `invalidateThrottled()` for every Home/Train-affecting event |
| Client | routes `/home`, `/train`, `/train/bank`, `/train/bank/session`, `/train/puzzles`, `/train/session/[ref]/summary`; one `TrainerRunner`; theme picker; IndexedDB outbox; offline continuation of an open session (an offline **reload** waits for P11's per-user service-worker cache); nav Home + Train (subs Today, Mistake Bank, Puzzles); landing on `/home`; the game-over `bank` slot (P2 `GameOverCard`) |
| Boards | the 35 boards in alloc §4 rows 54–56, 157–171, 190–192, 196–198, 202–204, 208–210, 213, 215, 217, 219, 221 (§4 below lists every file) |
| Dev demo routes | `/dev/ui/train/{hub,bank,runner,puzzles,summary}?state=`, `/dev/ui/home?state=` (SPEC D11 fail-closed) for states that real data can't reach on demand; each registered in P1's test-hook registry (testing X12) |
| Test plumbing | leased personas `bank-member`, `bank-empty`, `bank-caughtup`, `puzzles-fresh`, `outbox`, `two-tabs`, `train-plan`, `day-rollover`, `home-new` (writer in `WEB/e2e/personas/p5.ts`); `@state`/`@demo` tags for the 35 boards; visual baselines; post-deploy shard smoke; telemetry assertions (testing X4, X6, X8, X10) |

### 2.2 Explicitly out of scope (and who owns it)

| Item | Owner phase | What P5 does instead |
|---|---|---|
| Weakness Profile, weakness drills, `WEAKNESS` sessions, "Weakness drills" hub row, "Weakness profile" link, Train sub "Weakness Profile", plan focus theme from a snapshot, footnote "Built from your last 20 games" | P6 | Hidden slots. The focus theme falls back to bank and mastery data; the footnote reads "Built from your Mistake Bank. Daily cap: 10 reviews." |
| "Analyse with the coach" (runner menu), LLM rewrite of bank texts (J2) | P7 | Menu item not rendered; template texts only |
| Lesson plan step, "Legend lessons" hub row, summary lesson card (`V3SessionSummary`/`V3SessionPerfect`, flow edge E60), caught-up "Legend lesson on your top theme" card (`V3BankCaughtUp` and the device `caughtup` states), OPENING deck | P8 (S13 must list all five; coverage C-05, C-06) | Plan has 2 steps ("0 of 2"). P5 ships the two lesson cards as **named empty slots with a fixed contract** so P8 adds a component and edits no P5 file: `SessionSummary.next.lesson` and `BankPage.lesson`, both `LessonCard = { slug, title, minutes, href } \| null` (always `null` in P5; P8 fills them from `nextLessonForPlan(viewer)` filtered by the session's or the bank's top theme, `href` with `?from=summary` / `?from=bank`), rendered by `components/train/slots/LessonCardSlot.tsx`, which returns nothing for `null`. The hand-off is recorded in §15 and Appendix A |
| Home "Blitz 1184" header, "This week" rating line, per-game rating deltas, the new Play hub | P9 | Not rendered; Home Play links point at today's `/play` |
| Settings › Training (cap, new per day, release hour, day start, auto-grade, time zone) | **not built** (no board exists; coverage C-12). Owner decision D-20 | Defaults only (§8.5); the time zone is captured silently through W8. W8 `PATCH /api/train/prefs` already validates every pref field, so a later Settings › Training screen (P10, built from the kit after owner sign-off) only calls it |
| Reminders and push (`NOTIFY_DISPATCH`, the 08:00 release push), account-deletion clean-up of training rows | P10 | none; the hub refreshes at the release hour with a client timer (§5.2). P10's release push is a future-dated job, not a tick (api-perf AP-08, feasibility F-NEON-2) |
| `/offline` page row "Mistake Bank · 6 due · saved this morning", the daily offline snapshot, and **document caching for an offline reload** of the runner | P11 (per-user cache name `rc-pages:u:<ref>`, `SET_USER`, skipped without `__client_uat`; api-perf AP-34) | P5 keeps the *open* session usable offline and stores it in `rc-offline` (keyed by user) so P11 can read it; P5 adds **no** service-worker document cache |
| FSRS optimiser (`FSRS_OPTIMIZE`) | later | Default parameters (§8.2) |
| Lapsed read-only access (B26) | owner decision, still open (P1 Q-09 said "before P3"; coverage C-21) | Default hard redirect to `/pricing?reason=expired`; data kept. If B26 becomes "read-only", only R1/R2/R3/HOME-1 change auth to `member_or_lapsed_read` (D-19) |
| Due-count badge on the nav | — (inv-sys Q17: no) | Data exists in `me.badges.bankDue`; not drawn |

### 2.3 Dependencies on earlier phases (must be on `dev` before the P5 package that needs them starts)

| From | What P5 needs | Used by |
|---|---|---|
| P1 | `route()` wrapper (incl. `ctx.now`, `rateLimit {limit, windowSec, store}`, registry `sideEffects`), envelope, `CT/http/codes.ts` (`ERROR_STATUS`, `CONFLICT_REASONS`, `SUBSCRIPTION_REASONS`), `api()` client (header `x-rc-build`, schema parse only through `devSchema()`), `qk` factory as `lib/api/keys/<area>.ts`, `QueryProvider` + `reactToApiError`, `getViewer()` / `requireMemberPage()`, `getMe()`, Postgres rate limiter (`UNLOGGED` bursts ≤ 60 s; long windows durable), `lib/flags/registry/<phase>.ts`, `lib/routes/classes/<area>.ts`, UI kit (`components/ui/*`), shell (`AppShellView`, destinations, palette, shortcuts registry), `ViewportStage` / `BoardStage` / `ScrollRegion`, device × zoom suite (PR tier 4 projects, nightly 40 on `next start` in CI), `/dev/ui` plumbing, `IdempotencyKey` reservation helper | everything |
| P1 (critique fixes P5 relies on) | testing X1 (one runner and layout: `*.test.ts`, `*.int.test.ts`, `WEB/test/api/**`), X2 (nightly and post-deploy e2e on `dev`), X3 (paywall on in CI), X4 (`leasePersona()`, the `E2E_POOL_01…24` users, `e2e_leases`), X5 (`x-rc-now` → `ctx.now`; `requestNow()` for RSC pages), X6 (telemetry sink + PII guard), X7 (console guard), X8 (`docs/qa/design-states.json` + `state-coverage.ts`), X10 (`toHaveScreenshot` setup), X12 (`lib/test-hooks/registry.ts`, `isNonProd()`); api-perf AP-01 (dev Neon project), AP-11 (durable windows), AP-12 (`devSchema()`); feasibility §7 (registry directories) | P5 specs, routes, telemetry |
| P2 | `PKG/db` (schema moved), `PKG/game-core`, `CT/socket` (`registry.ts`, `rooms.ts` `ROOM.user(ref)`), `WEB/components/board/Board.tsx` (`V3MoveBoard` props `fen, orient, mover, last, hl, ring, arrows, badge, thumb, label, onMove`, promotion picker, keyboard move entry), `MiniBoard` (static SVG), `user:{ref}` room, `POST /internal/emit` (`{v:1, targets, event, data, dedupeKey?}`), `GamePlayer` (`result`, `endedAt`, `opponentName`, `opponentRating`), `Game.{startingFen, startPly, moves}`, `GameOverCard` named `slots` (`features/game/screen/GameOverCard.tsx`, hand-off H-01), `IdempotencyKey` table (M2i) | runner, lists, events, game-over line |
| P3 | `Job` queue + worker (`WK`) with `Job.fairSeq` and `JOB_PRIORITY` (`PKG/db/src/jobs.ts`), the final `sql.transaction([...])` HTTP batch of `ANALYZE_GAME` (P3-D11), `GameAnalysis` (packed evals, `bestUci`, judgements, `lines` with MultiPV for candidate plies, `phasePlies`), `PlayerReview` (PK `(gameId, color)`; `content.moments[]` ≤ 3 with `ply`, `judgement`, `playedUci`, `bestUci`, `accept`, `pv`; `progress.bankOptOut: int[]`), `selectKeyMoments()` in `PKG/chess-analysis`, `GamePlayer.{accuracy, momentsCount, headline}`, `Game.{analysisStatus, openingName}`, Review routes `/review/[ref]` (`?m=`, `?ply=`), `/review/[ref]/complete`, A1/A2 (with the reserved `bank: null` field), A6 `setMomentBank` (writes `bankOptOut`), `analysis:progress` / `analysis:done` (+ `analysis:batch` for backlog bands, AP-10), `DB/scripts/roles/replay_worker.sql` | extraction, Home Continue, review lights-up |
| P4 | **`User.timeZone`** (M4, R-03), `LinkedAccount` (ratings for the puzzle-rating seed), onboarding fields (`ratingBand`, `initialRating`), import status service + `import:progress` events, `/settings/connected`, onboarding done step | Home `import_running`, empty-bank CTAs, rating seed, landing |

`User.timeZone String @default("UTC") @db.VarChar(64)` is created by P4 (M4) and read by P5 as `viewer.timeZone` / `me.user.timeZone`; M5 does not alter `users`. **Fallback rule** for the P1 critique items: if one of them has not merged when the WP that needs it starts, that WP adds the minimal version at the P1 location named above (for example `requestNow()` next to `ctx.now`, or a persona writer in `e2e/personas/p5.ts` with a local lease table), records it in the sign-off, and hands the file back to P1's owner; P5 never forks a second copy.

---

## 3. Current code touched

### 3.1 Files that exist today (line numbers at `0848b76`)

| File | Today | P5 action |
|---|---|---|
| `WEB/middleware.ts:16-26` | 9-prefix `isProtectedRoute` list, signed-in check only | P1 F4 inverts it to a public allow-list with claim gating, and (feasibility §7) freezes the code: route classes become data in `WEB/lib/routes/classes/<area>.ts`. **P5 adds data files, not middleware code (WP-H):** `lib/routes/classes/train.ts` (`/train(.*)` → member) and `lib/routes/classes/home.ts` (`/home(.*)` → member, plus the landing rule `{ path: "/", when: { signedIn: true, onboarded: true, entitled: true, flag: "home" }, redirect: "/home" }`, evaluated from session claims with no DB call, inv-sys §1.5). If P1's data-driven classes have not merged, WP-H makes the equivalent two-line edit to `middleware.ts` in a PR labelled for P1's owner (OWNERS.yml rule). |
| `WEB/app/sign-in/[[...sign-in]]/page.tsx:11` | `redirect_url` falls back to `'/'` | **Rework (WP-H):** fall back to `'/home'` (P11 later replaces the page with the custom Clerk flow, which already targets `/home`, inv-pub §1.7). Also set `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/home` and `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/onboarding` on Vercel `replay-chess-dev` and in `WEB/.env.development.local`. |
| `WEB/app/onboarding/page.tsx:40` | `DESTINATION_AFTER_ONBOARDING = "/play"` | P4 replaces this file with the step routes and sends Done to `/games` "until P5 swaps in `/home`" (alloc P4). **P5 edit (WP-H):** P4's done destination constant → `/home`; Done copy "We'll show your first review on Home." stays. |
| `WEB/lib/billing/return-url.ts:9-24` | `RETURN_PATH_PREFIXES` lacks `/home`, `/train` | **Edit (WP-H):** add `"/home"`, `"/train"` (inv-pub G7). Unit test in `return-url.test.ts`. |
| `WEB/next.config.js:13-35` | PWA config (P1 H8 makes `/api/*` NetworkOnly, removes HTML caching) | **No P5 edit.** Rev 1 added `rc-pages` `NetworkFirst` entries for the runner documents; one cache name for every user can serve user A's `/train/bank` HTML to user B on a slow network (api-perf AP-34). The offline-reload cache moves to P11's service worker with per-user caches (`rc-pages:u:<ref>`); P5 only lists the two runner paths for P11's allow-list (§2.2). |
| `WEB/lib/media.ts:7` | `NEXT_PUBLIC_MEDIA_URL` base for R2 media | **Keep.** The shard loader uses `PUZZLE_SHARD_BASE_URL` and falls back to `mediaUrl("/puzzles")`. |
| `WEB/scripts/upload-media.ts:1-60` | R2 upload via `@aws-sdk/client-s3` | **Keep as the pattern** for `WEB/scripts/puzzles/upload-shards.ts` (same env names `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`). |
| `WEB/prisma/schema.prisma:1-434` | 10 models, 6 enums | Moved to `PKG/db/prisma/schema.prisma` in P2. **Edit (WP-A):** add M5 (§6). |
| `WEB/lib/rate-limit.ts:13-38` | in-memory limiter | Replaced in P1 (F5) by the Postgres bucket. P5 uses `route({rateLimit})` only. |
| `WEB/lib/hooks/useStockfish.ts` (372 lines) | browser Stockfish | **Must not load** on any P5 route (solutions are precomputed). Bundle check in WP-I. |
| `WEB/app/components/ChessBoard.tsx` (863 lines) | legacy board | P2 replaces it with `WEB/components/board/Board.tsx`. **P5 never imports `ChessBoard`** (lint `no-restricted-imports` entry added by WP-F for `app/(app)/train/**`, `app/(app)/home/**`). |
| `WEB/package.json:13` | `test:unit` glob covers blog, hooks, billing | P1 (testing X1) replaces it with the repo-wide pattern `{app,lib,components,features,scripts,worker,prisma,e2e/devices,e2e/fixtures}/**/!(*.int).test.ts` plus `test:int`. **P5 edits only dependencies (WP-A):** `idb-keyval`, `lru-cache`, `sqids`, the `@repo/chess-training` workspace dep. `check-test-globs.mjs` proves every P5 test file runs. Package tests run through each package's own `test` / `test:int` scripts in the turbo pipeline. |
| `WEB/e2e/fixtures/auth.ts:42-60` | signs in, syncs via `/api/user/sync`, skips onboarding | P1/P4 rework. **P5 adds (WP-A)** the persona writer `WEB/e2e/personas/p5.ts` (reset modes `bank-member`, `bank-empty`, `bank-caughtup`, `puzzles-fresh`, `outbox`, `two-tabs`, `train-plan`, `day-rollover`, `home-new`) used through P1's `leasePersona(name)`; the `trainSeed` fixture wraps the lease. Shared members A–P only ever **gain** data in P5 specs (testing X4). |
| `WEB/app/play/page.tsx` | legacy play hub | **Keep.** Home "Play" card and header buttons link here until P9. |
| `WEB/app/position/[referenceId]` | legacy legend position page | **Keep.** Home `new_user` "Play the Opera Game" links here until P8 (alloc P5 "Lights up"). |
| `WEB/app/components/Navbar.tsx` | marketing navbar (non-members) | **No change.** Members get the shell. |
| `WS/index.ts:109-351` | v1 socket events | **No change.** P2's `/internal/emit` carries P5's events. |

### 3.2 Files earlier phases create that P5 edits (anchors, not line numbers)

| File (phase) | P5 change | WP |
|---|---|---|
| `WEB/lib/nav/destinations.ts` (P1 SPEC §8.2) | `home.enabled = flag('home')`, `train.enabled = flag('train')`; train `showInTabBar: true`; new sub-destinations `train-today` (`/train`), `bank` (`/train/bank`, chord `g m` per `V3Shortcuts`), `puzzles` (`/train/puzzles`); `DestinationKey` gains `"train-today" \| "bank" \| "puzzles"` (additive). The P1 table bound chord `g m` to `/train`; P5 rebinds it to the Mistake Bank as the `V3Shortcuts` board says ("Go to Mistake Bank G M"); `g h` → `/home`. Logo (`Brand`) → `/home` when `home` is enabled. `backTarget`: `/train/bank/session`, `/train/puzzles`, `/train/session/*` → Train. | WP-H |
| `WEB/lib/nav/destinations.test.ts` (P1) | reachability with Home/Train enabled; `g h`, `g m` chords; hidden-destination rule still holds for Weakness (P6) | WP-H |
| `WEB/lib/shell/keys.ts` + shortcuts registry (P1 §8.2 `findCollisions`) | register page-scoped keys `H R S T 1 2 3 4 Enter Esc` (runner) and `F ↑ ↓ Enter` (bank); add the "Puzzles and lessons" rows to the `?` dialog | WP-F |
| `WEB/components/layout/BoardStage.tsx` + `board-stage.css` (P1 P5) | additive `asideWidth="trainer"` (`--rc-aside-min: 360px; --rc-aside-max: 400px`) and `bars="labels"` (`--rc-bar-h: 42px`, so 2 × (42 + 6) = 96 px = the design's `--bars`) | WP-F |
| `WEB/lib/api/keys/` (P1 F3, as a directory per feasibility §7) | **creates** `keys/train.ts` (`qk.train.{all,today,bank,session,themes}`) and `keys/home.ts` (`qk.home()`, `qk.badges()`), one line each in `keys/index.ts` (§5.1) | WP-A |
| `WEB/lib/api/endpoints.ts` (cdl §4.1) | add every P5 path (append-only block) | WP-A |
| `WEB/lib/flags/registry/` (P1 F6) | **creates** `registry/p5.ts`: `train`, `home`, `bank-remove` (server-evaluated, default off) | WP-A |
| `WEB/lib/test-hooks/registry.ts` (P1, testing X12) | entries for `/dev/ui/train/*`, `/dev/ui/home`, `WEB/e2e/scripts/seed-training.ts`, `WEB/e2e/personas/p5.ts`, env `BANK_EXTRACT_ENABLED` | WP-A |
| `CT/http/codes.ts` (P1) | append `session_ended` to `CONFLICT_REASONS` (no new code) | WP-A |
| `REPO/docs/qa/design-states.overrides.json` (P1, testing X8) | demo-only reasons for the 35 P5 boards' states that real data cannot reach on demand (`saving`, `cap_reached`, `broken item`, `themes` in bank mode) | WP-I |
| `WEB/lib/auth/viewer.ts` `getMe()` (P1 F4) | `badges.bankDue` (capped due count, one indexed count inside the shell CTE) and `badges.trainDot` | WP-E |
| `WEB/lib/realtime/handlers/` + event router (P4, a directory per feasibility §7) | **creates** `handlers/train.ts`, `handlers/home.ts` (WP-A stubs; WP-G and WP-H own them afterwards) and registers them with one line each; every Home/Train-affecting event goes through `invalidateThrottled()` (§5.5) | WP-A → WP-G/H |
| `CT/socket/user.ts` + `CT/socket/registry.ts` (P2) | payload schemas `BankDueChanged`, `MistakesAdded` and their registry entries; `AnalysisDone` gains `bankAdded: {count, plies} \| null` and `bankDue: int \| null`; `AnalysisBatch` (P3) gains the same two fields | WP-A |
| `PKG/chess-analysis` (P3) | add `src/themes/*` (tagger), `src/puzzle/*` (uniqueness, line), `src/bank/candidates.ts`, `src/epd.ts`; append the P5 sources to `CLEANROOM.md` (feasibility LIC-4) | WP-C |
| `PKG/game-core` (P2) | add `src/rating/glicko2.ts` (pure, config-driven: `glicko2(state, results, cfg)` with no constants inside) and `src/rating/presets.ts` (`PUZZLE = { tau: 0.5, rdFloor: 50, rdCeil: 350, sigmaMax: 0.1 }`); P9 adds `GAME` and changes nothing else | WP-B |
| `WK/src/handlers/analyzeGame.ts` (P3) | build J1's rows in TS, then **append** J1's set-based statements to P3's final `sql.transaction([...])` batch (§7.6); read the inserted-card counts and the due count from that batch's results; put `bankAdded`/`bankDue` on `analysis:done` (or P3's `analysis:batch`). No separate `mistakes:added` or `bank:due_changed` on this path | WP-C |
| `WK/src/handlers/housekeeping.ts` (P3) | training hygiene rules (§7.6) | WP-C |
| `DB/scripts/roles/replay_worker.sql` (P3) | `GRANT SELECT, INSERT, UPDATE ON mistakes, mistake_occurrences, training_cards, theme_mastery TO replay_worker; GRANT UPDATE ("bankVersion") ON game_players TO replay_worker; GRANT SELECT ON training_profiles, player_reviews …` (idempotent, guarded by `IF EXISTS` on the role) | WP-C |
| `WEB/app/api/review/[ref]/moments/[ply]/route.ts` (P3 A6) | goes live: besides P3's `bankOptOut` write, creates or deletes the BANK card in the same transaction (§7.3 A6); response `card` filled | WP-E |
| P3's review DAL in `WEB/lib/review/` (`getReview()` A1, `getReviewStatus()` A2) | under the `train` flag, one extra indexed statement fills `MomentDTO.inBank` / `card` and `ReviewStatusDTO.bank = {count, plies}` (§7.3 "Review bank fields"); A2's probe adds the bank count so its ETag changes with it | WP-E |
| `WEB/lib/review/complete.server.ts` (P3) | returns `added`, `nextDueAt`, `nextDueLabel`, `drillHref` from bank tables | WP-E |
| `WEB/app/(app)/(immersive)/review/[ref]/complete/*` and key-moment panel (P3) | render the bank lines ("Added"/"Not added" tags, "{n} added · the first one comes back {label}"), the **Drill These {n} Mistakes · ~{m} min** primary, the bank toggle and the `B` shortcut (slots P3 left unrendered, alloc §1.2) | WP-H |
| `WEB/features/game/screen/GameOverCard.tsx` slots (P2, hand-off H-01) | **no edit to the card**: P5 creates `WEB/components/train/slots/GameOverBankSlot.tsx` and passes it as `slots.bank` where the game screen assembles the slots (one line) | WP-H |
| P3 review URL parser (`/review/[ref]?ply=`) | hand-off, not a P5 edit: when `?ply=` equals a moment ply, open that moment (`?m=` equivalent). "See It in Your Game" links with `?ply=<lastPly>&from=bank`; without the P3 change it opens the move list at that ply, which is still correct | — (P3) |
| `WEB/app/onboarding/done/page.tsx` (P4) | "Go to Home" → `/home` | WP-H |
| `WEB/lib/import/status.server.ts` (P4) | consumed by `getHomeData()` (no edit) | — |
| `WEB/prisma/seed/fixtures.ts`, `personas.ts` (P1 P6 / dm §13.3) | training fixtures for personas `member`, `caughtup`, `trial`, `new` (§6.7) | WP-A |
| `WEB/playwright.devices.config.ts` (P1) | add P5 layout specs to the matrix (PR tier: 4 projects for changed areas; nightly: all 40 on `next start` in CI; deployed dev: smoke subset only, feasibility F-VER-3) | WP-I |

### 3.3 Files P5 creates (owners in §13)

```
PKG/chess-training/                         package.json ("@repo/chess-training", "type":"module", "sideEffects":false), tsconfig.json, CLEANROOM.md
  src/index.ts                              barrel for server use only; client imports subpaths (/labels, /grade, /items) — never ts-fsrs (api-perf bundle watch item)
  src/fsrs.ts  release.ts  tz.ts  day.ts  caps.ts  grade.ts  mastery.ts  streak.ts
  src/plan.ts  session.ts  themes.ts  labels.ts  explain.ts  items.ts  constants.ts
  src/*.test.ts  src/fsrs.property.test.ts  node:test via tsx (1,000 random card states, fixed seed)
PKG/chess-analysis/src/themes/{index,fork,pin,skewer,discovered,hanging,trapped,mate,backRank,promotion,sacrifice,endgame,meta,review}.ts (+ tests)
PKG/chess-analysis/src/puzzle/{validAttack,line}.ts (+ tests)   PKG/chess-analysis/src/bank/candidates.ts (+ candidates.test.ts, candidates.positions.test.ts)
PKG/chess-analysis/src/epd.ts (+ test)      PKG/chess-analysis/CLEANROOM.md (P5 section)
PKG/game-core/src/rating/{glicko2,presets}.ts (+ glicko2.test.ts with per-preset vectors)
CT/http/{train,home,reports}.ts (+ train.size.test.ts)
PKG/db/json/training.ts                      zod: DailyPlanV1, SessionItemsV1, MistakeTextV1, ExtractMistakesPayloadV1 (dm §9 registry)
PKG/db/prisma/migrations/<ts>_m5a_jobkind_extract_mistakes/, <ts>_m5_training/
PKG/chess-fixtures/puzzles/*.json            50 CC0 puzzles per Tier-1 theme
PKG/chess-fixtures/design/v3-bank-session.json, v3-mistake-bank.json   (shared design-fixture folder, testing X13)
WK/src/extract/{extractMistakes,lineBuilder,bankStatements,coalesce}.ts   WK/src/handlers/extractMistakesJob.ts
WEB/scripts/puzzles/{build-shards,upload-shards}.ts   WEB/scripts/backfill/{enqueue-mistake-extraction,recount-bank-themes,rebuild-cards}.ts
WEB/scripts/qa/smoke-puzzle-shards.ts        post-deploy shard smoke (testing P5 gap)
WEB/lib/train/{today,bank,sessions,attempts,cards,themes,puzzles,profile,day,badges,prefs,links,reviewBank,dto}.server.ts (+ tests)
WEB/lib/home/home.server.ts (+ test)        WEB/lib/reports/reports.server.ts
WEB/lib/routes/classes/{train,home}.ts      WEB/lib/api/keys/{train,home}.ts   WEB/lib/flags/registry/p5.ts
WEB/lib/realtime/invalidateThrottled.ts (+ test)
WEB/app/api/train/{today,bank,themes,attempts,prefs}/route.ts
WEB/app/api/train/sessions/route.ts  sessions/[ref]/route.ts  sessions/[ref]/extend/route.ts  sessions/[ref]/end/route.ts
WEB/app/api/train/cards/[ref]/route.ts  cards/[ref]/skip/route.ts
WEB/app/api/home/route.ts  WEB/app/api/me/badges/route.ts  WEB/app/api/reports/route.ts
WEB/app/(app)/home/{page,loading}.tsx
WEB/app/(app)/train/{page,loading}.tsx   train/bank/{page,loading}.tsx   train/session/[ref]/page.tsx   train/session/[ref]/summary/page.tsx
WEB/app/(app)/(immersive)/train/bank/session/{page,loading}.tsx   (immersive)/train/puzzles/{page,loading}.tsx
WEB/components/train/**  (incl. slots/{GameOverBankSlot,LessonCardSlot}.tsx)   WEB/components/home/**   WEB/features/train/**
WEB/lib/offline/{outbox,useOutboxSync,snapshots,crossTab}.ts
WEB/lib/api/queries/{train,home}.ts   WEB/lib/analytics/train-events.ts (registered in packages/analytics/src/events/train.ts, testing X6)
WEB/lib/realtime/handlers/{train,home}.ts
WEB/app/dev/ui/train/{hub,bank,runner,puzzles,summary}/page.tsx   WEB/app/dev/ui/home/page.tsx   WEB/app/dev/ui/_fixtures/train.ts
WEB/e2e/personas/p5.ts   WEB/e2e/mocks/puzzle-shards.ts (static shard server on :4012 for CI; shards are fetched server-side, so page.route cannot intercept them)   WEB/e2e/scripts/seed-training.ts
WEB/e2e/specs/train/*.spec.ts (incl. day-rollover, game-over-bank-line)   WEB/e2e/specs/home.spec.ts
WEB/e2e/devices/layout/{train,home}.spec.ts   WEB/e2e/visual/{train,home}.spec.ts (+ __screenshots__/)
WEB/scripts/explain-hot-queries.ts (P5 queries added; file from opt §3.5.4)
REPO/perf/k6/src/scenarios/train-session.ts   (api-read-mix.ts gains /api/train/today and /api/home)
REPO/docs/qa/phase-05-signoff.md
```

Nothing is removed in P5: there are no legacy training screens. The legacy member landing (`/play`) stays reachable. Rev 1 also listed `<ts>_m5v_validate_key_moment_fk` and a `KeyMoment` model change; both are gone (no `key_moments` table exists, P3-D3).

---

## 4. Screens

Seven screens, 35 boards (alloc §4.2). Every screen is inside the P1 app shell (`AppShellView`), in **lock mode** (`data-rc-lock`, SPEC D15): the document never scrolls; only list panels scroll inside a `ScrollRegion`. Runner routes are in `app/(app)/(immersive)/` and pass `hideTabBar` (phones and iPad portrait show the runner's own control bar instead, DS README "Phones").

**Common rules for every P5 screen**

- **Copy.** Button, menu, tab and nav labels are Title Case (SPEC §1 constraints, DS README); the numeric tail stays as designed ("Start Today's Plan · ~6 min", "Review 4 Due · ~3 min"). Descriptions, status lines, toasts and notes are sentence case and end with a period. No emoji, no exclamation marks. Uppercase eyebrows come from CSS (`text-overline`), never typed in capitals. Every string with a number is generated from data (never the design's sample numbers).
- **Time labels** ("today", "Oct 27", "Tomorrow", "Sat", "08:00") are formatted **on the server** in `User.timeZone` (`PKG/chess-training/src/labels.ts`), so SSR and hydration agree (cdl §2.3 rule 6). Only live countdowns run on the client.
- **Board pieces and badges.** The P2 board (`WEB/components/board/Board.tsx`) with the owner's move-quality icons from `public/board_icons` (B8; user memory). Mini boards are P2's static SVG `MiniBoard` (56 px, `article-board-*` squares, no coordinates).
- **Skeletons** are the P1 `Skeleton`/`SkeletonRegion` (aria-busy, sr-only "Loading…"), never a lone spinner (cdl D14).
- **Errors** without data: P1 `ErrorState` inline (Event ID = `requestId`, Retry → `refetch()`); 401 → session modal; 402 → `/pricing?reason=…&redirect_url=…`; 429 → `RetryCountdown`; 503 → maintenance banner (cdl §3.7).
- **Accessibility.** Focus ring 2 px `cb-text` offset 2 px; hit targets ≥ 44 px (grade buttons 48 px); `aria-live="polite"` for status/coach text; colour always paired with text or symbol; `prefers-reduced-motion` honoured (rct-b §5.8).
- **Zoom.** Every layout responds to height: at ≤ 640 px tall the `.tall` secondary sections hide (queue list, "This puzzle" card, session card, due strip captions); at ≤ 1100 px wide the sidebar becomes the 64 px rail (DS README "Browser zoom").

### 4.1 S1 Home — `/home`

**Boards.** Desktop: `DR/V3Home.dc.html` (enum `populated | new_user | loading | import_running | payment_failed | trial`, default `populated`), `DR/V3HomeNewUser.dc.html` (`new_user`), `DR/V3HomeLoading.dc.html` (`loading`). **No device boards exist** (inv-sys §3.18); the device layouts below are derived from the Train hub device pattern and must get design sign-off (D-12).

**Route.** `WEB/app/(app)/home/page.tsx` (server), `loading.tsx` (V3HomeLoading skeleton). Flag `home` off → `redirect('/play')`.

**Layout per device** (CSS from `V3Home.dc.html` `.grid`, `.cboard`, `.minis`, `.week`):

| Device (CSS viewport) | Shell | Layout | Board (Continue / Start here) |
|---|---|---|---|
| Desktop 1440×900 | sidebar 220 | header row (h1 greeting + stats; actions **Play a Friend**, **New Game**); grid `minmax(0,1fr) 360px`, gap 16; left: Continue card then Recent games (`ScrollRegion`, rows `52px 1fr 30px`); right column: Mistake Bank card (4 × 56 px minis, `repeat(4,minmax(0,56px))`), This week (7 dots, `repeat(7,1fr)`, max 210 px), Play | `width: max(160px, min(100vh − 330px, 100vw − 900px, 520px))` → 520 px |
| Desktop 1280×800 | sidebar | same | `min(470, 380, 520)` = 380 px |
| ≤ 1100 wide (iPad L 1194×834 rail, or 150 % zoom) | rail 64 | grid `minmax(0,1fr) 300px` | `max(160px, min(100vh − 380px, 100vw − 724px, 460px))` |
| ≤ 700 tall | — | `.tall` lines hide (Continue sub-line, week sub-line, Play card) | `max(140px, min(100vh − 370px, 100vw − 940px, 460px))` |
| iPad P 834×1194 | top bar + tab bar | one column: header; Continue card (board left 50 %, text right); Bank card; This week and Play side by side (2 cols); Recent games in a `ScrollRegion` filling the rest | `min(50cqw − 24px, 40dvh)` |
| iPhone 393×852, Android 412×915 | top bar 44 + tab bar 56 | one column in a `ScrollRegion` (the region scrolls, the document does not): greeting + "4 games this week"; Continue card (board full width); Bank card (4 minis + CTA); This week; Play (3 rows); Recent games | `min(100vw − 32px, 100dvh − 44px − 56px − 230px)`: the board, its title and **Start Review** fit the first viewport |

**States and transitions.**

| State | Decided by | Content (design copy, data-driven) |
|---|---|---|
| `loading` | `loading.tsx` during navigation (V3HomeLoading: `section aria-busy="true" aria-label="Loading"`, skeleton blocks in the same grid) | — |
| `populated` | server: viewer has ≥ 1 `GamePlayer` row or ≥ 1 BANK card | h1 "Good evening, knightowl_88." (`greetingPart` from local hour: morning 05–11, afternoon 12–17, evening 18–04); stat "4 games this week" (the "Blitz 1184" stat is **not rendered** until P9). **Continue · today** card: board at the position before the first key moment (`PlayerReview.content.moments[0].ply`; the FEN is replayed on the server with chess.js from `games.startingFen` + `games.moves`, ≈ 0.3 ms, so no FEN is stored twice) with last-move marks, h2 **Review With the Coach**, "Two Knights vs tal_fan_77 (1203). You lost on move 28. The coach found 3 moments; the first is on the board." → **Start Review** (`/review/[gameRef]`). **Mistake Bank 4 due**: "Loose pieces is your most common theme (7 in bank)." (source: `ThemeMastery.bankCount`; P6 switches the source to the weakness top theme), 4 due thumbnails (each → `/train/bank/session?card=<ref>`), CTA **Review 4 · About 3 min** (`round(0.75 n)`, min 1) → `/train/bank/session`; when 0 due: "Nothing due. Next batch {label} at 08:00." + **Open Mistake Bank**. **This week**: "4 games · 12 puzzles" (the rating sub-line is P9), M–S dots (`role="img"` "Played Monday to Thursday this week"), **See Profile**. **Play**: Quick Match · 5+3 → `/play`, Challenge a Friend → `/play?tab=friend`, Play a Bot → `/play?tab=bot` (legacy hub until P9). **Recent games** (≤ 8, **All Games** → `/games`): result pill (WIN/LOSS/DRAW), opponent (rating), chip (`GamePlayer.headline`, e.g. "Missed Rxf5 · move 19"), date label; rating delta not rendered (P9) |
| `new_user` | server: 0 `GamePlayer` rows, 0 cards, no import running | h1 "Welcome, knightowl_88."; **Start here** card: Opera Game board (featured `ChessPosition`), h2 **Play Your First Legend Position**, "Paris, 1858. Morphy is White and two pieces ahead in development. Study it for 30 seconds, then play it out against someone at your level." → **Play the Opera Game** (`/position/[ref]` until P8) and **Import My Chess.com Games** (`/settings/connected`); Bank card "0 due", "Mistakes from your games land here as puzzles.", 4 dashed ghost minis, **How It Works** → `/how-we-grade`; This week "No games yet" / "Play once to start your streak."; Recent games: "Your games appear here after you play or import them." + **Import From Chess.com or Lichess** |
| `import_running` | server: P4 import status `QUEUED\|RUNNING`; live from `import:progress` | the `populated` (or `new_user`) layout plus a status row under the header: `role="status"` "IMPORTING 212 / 480 GAMES · Chess.com · about 2 min left" (ETA from P4's payload) |
| `payment_failed` | shell: `ShellUser.paymentFailed` | the P1 shell payment banner (`shell-payment-banner`) above the page; Home does not duplicate it |
| `trial` | shell: `ShellUser.trialDaysLeft` | the P1 nav tag "Trial · 5 days left"; Home content as `populated`/`new_user` |
| Continue: analysing | `Game.analysisStatus ∈ {QUEUED, RUNNING}` for the newest game | the newest game's card with "Analysing · 14 of 38 moves" (`ProgressBar`, live from `analysis:progress`), **Start Review** disabled with `aria-describedby`; on `analysis:done` the card swaps to the moments view |
| Continue: none | analysed games exist but none has moments | the newest analysed game with "Clean game · accuracy 92" and **Open Review** |

Transitions: `loading` → server state; `import:progress` patches the status row (`setQueryData`, no fetch); `analysis:progress` patches the Continue progress (only sent for priority ≥ 80 jobs, i.e. a game somebody is waiting for); `import:finished`, `analysis:done`, `analysis:batch`, `mistakes:added` and `bank:due_changed` all call **one** `invalidateThrottled(qk.home(), 30_000)` with a trailing edge (at most one `GET /api/home` per 30 s, whatever the event rate; a hidden tab only marks the query stale and refetches on focus). `bankDue` from any of these events is written straight into `qk.home().bank.due` and `qk.me().badges.bankDue` with `setQueryData`, so the visible count is never 30 s behind (api-perf AP-10).

**Components.** P1 kit: `PageHeader`, `Button` (primary / secondary / text), `Card`, `Tag` (result pills via `tone`), `Skeleton`, `SkeletonRegion`, `EmptyState` (`size="card"`), `ProgressBar`, `ScrollRegion`, `Avatar`. P2: `Board` (static, `mover=""`), `MiniBoard`. New in `WEB/components/home/`: `HomeHeader`, `ContinueCard`, `StartHereCard`, `BankCard` (shared look with the hub's `DueStrip`), `WeekCard` (`WeekDots`), `PlayCard`, `RecentGames` (`RecentGameRow`), `ImportStatusRow`.

**Interactions and keys.** `G H` (P1 chord) comes here. `Enter` on a focused card activates its primary. Rows are links (`<Link prefetch={false}>` with P1's intent prefetch, cdl §3.8); **Start Review** uses `<Link prefetch>` (full) because it is the likely next click and `/review/[ref]` has no write side effects once P3's AP-09 fix lands (the enqueue moves to P3's A3 mutation). The bank thumbnails and **Review 4 · About 3 min** link to session-creating URLs, so they are **never fully prefetched** (`prefetch={false}`, no intent prefetch): rendering those pages creates or resumes a session (§5.2 S4/S5).

**Accessibility.** Board `aria-label` "Your game vs tal_fan_77, before move 19. White to move."; thumbnails "Due: loose piece vs tal_fan_77, move 19"; result pills carry text; the dots group is `role="img"`.

### 4.2 S2 Train hub — `/train`

**Boards.** Desktop `DR/V3TrainHub.dc.html` (`default`), `DR/V3TrainHubDone.dc.html` (`nothingdue`), `DR/V3TrainHubLoading.dc.html` (`loading`); `DR/V3iPhoneTrainHub.dc.html`, `DR/V3AndroidTrainHub.dc.html`, `DR/V3iPadLTrainHub.dc.html` (rail, 4 due thumbnails), `DR/V3iPadPTrainHub.dc.html` (top bar + tab bar, all sections). Enum everywhere: `default | nothingdue | loading`.

**Route.** `WEB/app/(app)/train/page.tsx`, `loading.tsx`. Nav: Train · Today (`V3Nav current=train sub=today`).

**Layout per device.**

| Device | Layout |
|---|---|
| Desktop | `main` padding 28/32, `align-items: safe center` (scrolls only as a fallback because there is no live board, inv-sys §3.19). Header: eyebrow "Thursday · 6 minutes planned", h1 **Train**, streak block on the right. Grid `minmax(0,1.55fr) minmax(0,1fr)`, gap 24: **left** Today's plan (`ol`, numbered steps), primary CTA, footnote; **right** Due from your games (3 × 56 px thumbnails, `repeat(3,1fr)`, + **Open Mistake Bank**), All training (link rows), Theme mastery (bars, `110px 1fr 40px`) |
| iPad L | rail 64; same two columns, `align-items: stretch`; due strip 2 × 2 = 4 thumbnails |
| iPad P | top bar 52 + tab bar 64; one column; every section including Theme mastery |
| iPhone / Android | top bar: "Train" + avatar (→ profile); chip "4-day streak · 6 MIN TODAY"; plan list; All training; **sticky CTA above the 6-tab bar**; no due strip, no mastery block (designed omission) |

**States and transitions.**

| State | Server rule (`TrainToday.state`) | Content |
|---|---|---|
| `loading` | `loading.tsx` on navigation; also the in-place state while the plan regenerates after a day rollover (header and All training stay, the plan section shows `SkeletonRegion aria-label="Loading today's plan"`, exactly as `V3TrainHubLoading`) | — |
| `default` | at least one plan step not done | "Today's plan · 0 of 2 done"; steps with tags **Due now** / **Step 2** / **Done**: (1) "Review 3 mistakes from yesterday's game" · "Mistake Bank · vs tal_fan_77 · ~2 min"; (2) "3 fork puzzles at your level" · "Your weakest theme · rating 1512 · ~4 min" (P5 subtitle when no weakness snapshot: "Your lowest-mastery theme · rating 1512 · ~4 min"); CTA **Start Today's Plan · ~6 min**; footnote "Built from your Mistake Bank. Daily cap: 10 reviews." (P6 switches to "Built from your last 20 games.") |
| `nothingdue` | every step done, or nothing due and the cap reached | "Done for today · 2 of 2 done", every step tagged **Done**; "Nothing is due. Your next 6 reviews arrive tomorrow at 08:00." (count and time from `nextBatch`); secondary CTA **Keep Going: Fork Puzzles** (`keepGoing` = focus theme) |
| *cap reached, due remain* (no board; rct-b Q5) | `capRemaining = 0 && dueRaw > 0` | `nothingdue` layout with "You reviewed today's 10 positions. {n} more wait for tomorrow." |
| *partially done* | mixed step statuses | `default` with the CTA **Continue Today's Plan · ~{m} min** (only the remaining steps' estimate) |
| *new user* (no board; rct-b Q4, D-5) | 0 BANK cards and no analysed games | step 1 = "Review your last game" (`/review/[lastUnreviewedGameRef]`) when a played game exists, else "Import games" (`/settings/connected`); step 2 = "3 fork puzzles at your level" at the seeded puzzle rating; due strip replaced by the P1 `EmptyState` (`size="card"`) "Your Bank Is Empty" + "Mistakes from your games land here as puzzles." |

Streak block: `role="img"` `aria-label="4-day streak: trained Monday to Thursday"`, "4-day streak", "Best 9 · resets if you skip 2 days", M–S dots (filled = trained that local day). All training rows (P5): **Mistake Bank** "4 due · 23 positions from your games" → `/train/bank`; **Puzzles by Theme** "Forks 62% · Pins 18% · Back rank 40%" (top 3 themes by attempts, "New" when < 5 attempts) → `/train/puzzles?pick=1`. The Weakness drills row (P6) and Legend lessons row (P8) are not rendered. Theme mastery: 4 bars, text percentage beside each bar; the "Weakness Profile" link (P6) is not rendered.

Transitions: `visibilitychange` → refetch `qk.train.today()` when stale (30 s) or when the local `dayKey` changed (day rollover at `dayStartHour`); socket events go through `invalidateThrottled(qk.train.today(), 30_000)` (§5.5); an outbox flush marks it stale; returning from a session re-renders (RSC, `no-store`). The client also schedules one timer at `nextBatch.at` (if the tab is visible) to refetch, so "Nothing is due" turns into the new batch at 08:00 without a server push (§7.4).

**Components.** P1: `PageHeader` (overline + h1), `Button`, `Tag`, `Card`, `Skeleton*`, `EmptyState`, `ProgressBar` (mastery bars, `aria-valuetext`), `ScrollRegion`. P2: `MiniBoard`. New in `WEB/components/train/hub/`: `StreakWeek`, `PlanStepList` (`ol`; each step is a link with full accessible name "Step 1 of 2, due now: Review 3 mistakes from yesterday's game, Mistake Bank, vs tal_fan_77, about 2 minutes"), `PlanCta`, `DueStrip`, `AllTrainingList`, `ThemeMasteryBars`, `HubFootnote`.

**Interactions and keys.** Click a step → its `href` (bank step `/train/bank/session?plan=1`, puzzle step `/train/puzzles?theme=fork&n=3&source=plan`). These hrefs render a page that creates or resumes a session, so every link to them is `prefetch={false}` with no intent prefetch (a router prefetch must never create a session; the create itself is idempotent by `filterKey`, §7.3 W2). **Start Today's Plan** → `POST /api/train/sessions {kind:"daily"}` (W2) then `router.push('/train/bank/session?s=<ref>')`; button shows the pending spinner (no optimistic navigation: the session id is server-created, cdl §3.6). A due thumbnail → `/train/bank/session?card=<cardRef>`. `G M` → Mistake Bank; `Enter` on a focused step opens it.

### 4.3 S3 Mistake Bank — `/train/bank`

**Boards.** Populated (enum `default | filtered | loading`): `DR/V3MistakeBank.dc.html` (desktop: board left, list right, filter popover), `DR/V3iPhoneMistakeBank.dc.html`, `DR/V3AndroidMistakeBank.dc.html` (list + filter **sheet** + sticky CTA), `DR/V3iPadLMistakeBank.dc.html` (two panes `minmax(0,1fr) 400px`), `DR/V3iPadPMistakeBank.dc.html`. States (enum `empty | caughtup | loading`): `DR/V3BankEmpty.dc.html`, `DR/V3BankCaughtUp.dc.html`, `DR/V3BankLoading.dc.html`. Device states (enum `due | empty | caughtup | loading`): `DR/V3iPhoneBank.dc.html`, `DR/V3AndroidBank.dc.html`, `DR/V3iPadLBank.dc.html`, `DR/V3iPadPBank.dc.html`.

**Route.** `WEB/app/(app)/train/bank/page.tsx`, `loading.tsx`. URL state `?view=due|all&theme=&phase=&source=own|missed&sel=<cardRef>` (cdl §6.4, `history.replaceState`, survives Back). Nav: Train · Mistake Bank.

**Layout per device.**

| Device | Layout |
|---|---|
| Desktop | header: h1 **Mistake Bank**, sub "4 due today · 23 in bank · Next batch tomorrow 08:00", link **Train**, primary CTA. Grid `.mbgrid` `minmax(0,1fr) 440px` (≤ 1100 wide: 360; ≤ 760 tall: 360/320, gap 16): **left** selected position: static board `width: max(240px, min(100vh − 260px, 100%, 720px))` (≤ 760 tall: `100vh − 160px`, max 880) + info grid `.mbinfo` ("Due today · White to move", **Solve This One**, **See It in Your Game**, h2 "{theme} · you played {SAN}", badge, "{Judgement} · vs opp · when · move N · Phase", mastery dots, "Mastery 2 of 5 · best move hidden until you try"); **right** list panel: `Segmented` Due · n / All · n, count, **Filter** button with count; `ScrollRegion` list with group headers "Due today · N" / "Scheduled later · N"; footer note |
| iPad L | rail; two panes `minmax(0,1fr) 400px`, board `min(100%, 600px)` |
| iPad P | top bar + tab bar; list only (no detail pane), sticky group headers (`.lhdr`), Filter **sheet**, sticky CTA above the tab bar; a row tap opens the runner at that card |
| iPhone / Android | top bar (Back → Train, "Mistake Bank", Filter icon button with count); "4 due today · Next batch tomorrow"; `Segmented` Due/All + "23 in bank"; list (rows 72 px: 56 px mini, theme, Due tag or next label, badge, "You played Qd2 · move 19", mastery dots); sticky CTA above the tab bar; Filter sheet with **Close Filters**, groups, **Clear All**, **Show 4 Positions** |

**States and transitions.**

| State | Rule | Content |
|---|---|---|
| `loading` | `loading.tsx`; `aria-label="Loading your Mistake Bank"`, 9 ghost rows (`V3Skeletons list`) | — |
| `empty` (server) | `counts.all = 0` | desktop two columns `1fr 1fr` (max 1080): eyebrow "Empty bank", h2 "Your mistakes will land here after you review a game", "Every review adds the moments where a better move was there. Each one comes back on a schedule until you find it every time."; CTA rows **Play a Game to Fill Your Bank** → `/play`, **Review Your Last Game** "vs tal_fan_77 · not reviewed yet" → `/review/[ref]` (only if a reviewable game exists), **Import Games From Chess.com or Lichess** "We find mistakes in your last 100 games" → `/settings/connected` (only if no linked account); "What a bank card looks like" example card (static FEN from the board, "You played Qd2 · best was Rxf5", dashed, `opacity .55`) |
| `caughtup` (server) | `dueShown = 0 && counts.all > 0` | header "0 due · 23 in bank · Next batch tomorrow"; h2 "All caught up"; "You reviewed today's 4 positions. The next batch of 6 arrives tomorrow at 08:00." (when the cap is the reason: "You reviewed today's 10 positions."); CTAs **Train Forks While You Wait** → `/train/puzzles?theme=<focus>`, **Browse All 23 Positions** → `?view=all`; the lesson card "Legend lesson on your top theme · Morphy's Opera Game · 6 min" is the `LessonCardSlot` reading `BankPage.lesson` (always `null` in P5, so nothing renders; P8 S13 fills it, coverage C-06); "Coming up" list (≤ 4 rows: "Tomorrow 6 · Saturday 3 · Sunday 5 · Next week 9"); "Scheduled with FSRS. You never get more than 10 a day." |
| `default` (server) | otherwise | CTA `Review {n} Due · ~{round(0.75n)} min` or, with nothing due in the current filter, `Drill These {n} · Nothing Due` (practice session); list sorted by next review; footer "Sorted by next review · FSRS keeps it to 10 a day" (All) or "{n} more scheduled for later days · next batch tomorrow" (Due) |
| `filtered` (client) | any active filter | Filter button shows the count; chips inside the popover "Remove filter Fork"; **Show {n} Positions** closes it; zero results → "Nothing matches these filters" + **Clear Filters**, and the detail pane shows "No position selected · Clear a filter to see positions again." |
| device `due` | same as `default` on phones/iPad P | "4 due today · 23 in bank", due rows, "Scheduled later · 19" rows, **Browse All 23 Positions** |

Transitions: tab/filter/clear → URL (`replaceState`) → instant client filtering when `complete = true` (≤ 300 rows, §5.3), otherwise `qk.train.bank(filters)` refetch with `keepPreviousData` (rows dim, region hairline after 200 ms, cdl §3.9). Selected row disappears after a filter → select the first row, else `none`. `bank:due_changed` → stale. Skip from the runner → that row moves to "Scheduled later · Tomorrow".

**Components.** P1: `Segmented` (`role="group" aria-label="Show"`), `FilterPopover` (DS Filter pattern; `role="dialog" aria-label="Filter positions"`, focus trap, Esc), `Sheet` (phones), `Chip`/`ChipGroup` (`aria-pressed`), `Tag`, `Button`, `EmptyState`, `ScrollRegion`, `Skeleton*`. P2: `Board` (`mover=""`), `MiniBoard`. P3: `MoveBadge` (judgement badge, 16/18 px). New in `WEB/components/train/bank/`: `BankScreen`, `BankHeader`, `BankList` (`role="list"`), `BankRow` (button, `aria-current`; accessible name "Fork position from your game vs vera_b, move 24"), `BankDetail`, `MasteryDots` (`role="img"` "Mastery 2 of 5"), `BankFilter`, `UpcomingList`, `EmptyBank`, `CaughtUp`.

**Interactions and keys.** Desktop and iPad L: a row click selects it (`?sel=`); phones and iPad P: a row tap opens `/train/bank/session?card=<ref>` (no detail pane). **Solve This One** → `/train/bank/session?card=<ref>` (`prefetch={false}`: the page creates a session). **See It in Your Game** → `/review/[gameRef]?ply=<lastPly>&from=bank` (P3 maps a moment ply to that moment; §3.2 hand-off). Primary CTA → `POST /api/train/sessions {kind:"bank", filter, practice?}` then the runner. Keys (page-scoped, registered with P1's collision registry): `↑`/`↓` move the selection, `Enter` solves the selection, `F` opens Filter (rct-b proposed `/`, which P1 binds to the command palette), `Esc` closes. Row overflow ⋯ **Remove From Bank** (W6, optimistic with an Undo toast for 6 s; no design yet, D-2) is behind the `train` flag variant `bank-remove`.

### 4.4 S4 Mistake Bank drill (runner, bank mode) — `/train/bank/session`

**Boards.** Desktop `DR/V3BankSession.dc.html` (enum `solve | hint | wrong | correct | solution | themes`, mode `bank`). No device boards for bank mode: use the puzzle device boards (`DR/V3iPhonePuzzle.dc.html`, `DR/V3AndroidPuzzle.dc.html`, `DR/V3iPadLPuzzle.dc.html`, `DR/V3iPadPPuzzle.dc.html`) with the bank header and the "Where this position came from" card moved into the sheet (rct-b T3).

**Route.** `WEB/app/(app)/(immersive)/train/bank/session/page.tsx`. Entry params (exactly one creates a session server-side, idempotently, if `s` is absent): `?s=<sessionRef>` resume; `?plan=1` → DAILY; `?card=<cardRef>` → BANK explicit "Solve this one"; `?cards=a,b,c` → BANK explicit; `?game=<gameRef>` → BANK explicit (the game's in-bank key moments, from Review complete); `?theme=&phase=&source=&practice=1` (the bank list's filter) → BANK; none → BANK due queue. After creation the page `redirect()`s to `?s=<ref>` so a reload resumes.

**Layout per device** (CSS from `V3BankSession.dc.html` `:root{--pw:400px;--bars:96px;--pad:24px}`, `.stage` `grid auto var(--pw)`, `--bd: max(260px, min(100vh − bars − 2·pad, 100vw − nav − pw − 92px, 860px))`), implemented with P1 `BoardStage asideWidth="trainer" bars="labels"`:

| Device (CSS viewport) | Mode | Board side (expected) | Panel |
|---|---|---|---|
| Desktop 1440×900 | side, sidebar 220 | min(900 − 96 − 48, 1440 − 220 − 400 − 92, 860) = **728 px** | 400 px aside, height = board + bars |
| Desktop 1280×800 | side | min(656, 568, 860) = **568 px** | 400 px |
| 1440×900 at 150 % (960×600) | side, rail 64, density step (≤ 620 tall) | design formula min(600 − 96 − 16, 960 − 64 − 400 − 92, 860) = **404 px**; P1's container formula allows up to ≈ 484 px as the aside shrinks to 360 px | 360–400 px; `.tall` sections (queue, rule line) hide |
| iPad L 1194×834 | side, rail 64 | min(690, 638, 860) = **638 px** | 400 px |
| iPad P 834×1194 | stack (portrait), no tab bar | 640 px column (design `width: 640px`) | panel under the board; control bar 64 px (`BoardStage footer`) |
| iPhone 393×852 | stack | `min(358px, 100vh − 456px)` = **358 px** (design) | header 44 (Back, "Mistake Bank · 1 of 3", ⋯), label lines above and below the board, coach + grade section, bottom control bar 56 px (Hint, More) |
| Android 412×915 | stack | min(380, 459) ≈ **380 px** | same as iPhone |

Above the board (label bar): "{theme} · {src} · Streak 4" (+ "· streak reset" in `bad` tone after a wrong move or a shown solution). Below: "You play White" (or Black, from `orient`), and when the item is from a game: "In the game you played b3 · **See It in Your Game**".

Panel (desktop, top to bottom): header h1 **Mistake Bank** + link **Bank**; "Drill · 2 of 3" + segmented progress (`SessionProgress`); `aria-live="polite"` region: status line, theme chip "From your game", `CoachLine` ("C" avatar + text + **VERIFIED** tag when `text.verified`), hint note "Hint used · counts as Hard"; while graded: `GradeBar`; while solving: `SourceCard` "Where this position came from · From your game · Your game vs tal_fan_77 · today · move 19 · You played Qd2 · Miss · Rxf5 won a bishop here, about +2.7 for you. Qd2 let it go.", the rule line "Solved first try: back in {preview.good}. Missed: back in {preview.again}." (from the item's real `preview`), `QueueList` "Due today · 4 positions" (DONE / NOW / NEXT, `li aria-current="step"`). Footer controls: **Hint** (→ **Show Arrow** → **Hint Used**, disabled), ⋯ menu; in `wrong`: **Try Again** (primary) and **Solution**.

**States and transitions** (phase machine `WEB/features/train/machine.ts`, from the board logic `_rv0`/`_sc0`, rct-b §4.5):

```
loading → solve ──move = expected, plies remain──► reply (auto 450 ms: "Good. Black replies…") ──► solve ("Keep going: White to move")
          │  └─move = expected, last ply──► graded ──grade──► next item (pre-rendered, ≤ 16 ms) | done
          ├─move ∉ solution∪accept──► wrong ("Not quite.") ──Try Again (R)──► solve
          │                              └──Solution (S)──► sol (auto 600 ms per ply, "Here is the solution") ──► graded (solutionShown)
          ├─Hint (H)──► hint step 1 (ring on the piece) ──H──► hint step 2 (arrow from→to) [stays in solve]
          └─menu ⋯: Show Solution → sol · Skip for Today → next (W5) · End Session → W4 → summary · Report a Problem → dialog (W7)
done ("Session done · 3 of 3 graded. Next reviews are scheduled.") ──► See Session Summary | Start Again (PRACTICE session)
```

| Board state (enum) | Machine | Visible |
|---|---|---|
| `solve` | `solve`, hint 0 | status "White to move"; coach empty; Hint enabled |
| `hint` | `solve`, hint ≥ 1 | ring `rgba(3,105,161,.9)` on `solution[0].from`; step 2 adds the arrow `#0369a1`; coach = hint text (+ " The arrow shows the move."); note "Hint used · counts as Hard" |
| `wrong` | `wrong` | the wrong move on the board with red from/to (`rgba(210,120,110,.45/.55)`); status "Not quite."; coach `bad` tone: the game-move text when the user repeated `playedUci` ("b3 is what you played. After Nxe3 fxe3 your e-pawns are doubled. Keep the queen ready to take back."), else the explainer or "Not the move. {hint}" (unverified); "· streak reset" |
| `correct` | `graded`, not shown | last destination square green + `best` badge; status "Correct."; coach `good` tone (`text.correct`, VERIFIED); grade bar with **Good** suggested ("Solved first time. Pick Easy if it felt instant.") |
| `solution` | `graded`, `solutionShown` | blue destination highlight, no badge; status "Solution shown"; grade bar with **Again** suggested ("You saw the solution, so Again is suggested: it comes back in under 10 minutes.") |
| `themes` | — | kept in the enum for parity; not reachable in bank mode (no Theme button in the bank header) — reachable only in the dev demo route |
| *saving* (no board) | outbox not empty at `done` | "Saving your results…" under the done line; See Session Summary waits ≤ 3 s for the flush, then navigates (the summary handles the rest, §4.7) |
| *broken item* (no board) | stored solution fails chess.js validation at load | item skipped, toast "Skipped a position we couldn't load.", auto-report (`reason: illegal_move`) |
| *review position* (`kind = review_position`) | any move in `accept ∪ {best}` solves | after solving with a non-best accepted move: "Good enough. The engine's best was {bestSan}." |

Grade bar: `role="group" aria-label="How well did you know it?"`, 4 buttons `Again` / `Hard` / `Good` / `Easy`, each with its real interval from `item.preview` (e.g. "< 10 min", "2 days", "4 days", "9 days"), `aria-label` "Good, next review in 4 days, suggested"; the suggested button is primary (`btn-p`). Note line under it. Choosing a grade: outbox enqueue → advance (§5.4). After a grade, focus moves to the next item's status line.

**Components.** P1: `BoardStage` (trainer variant), `Button`, `IconButton`, `Menu` (`role="menu"`), `Dialog` (report), `Tag`, `ProgressBar`/segmented, `ScrollRegion`, `notify` (toasts: "Back in 4 days", milestone achievements). P2: `Board` (interactive: `mover`, `onMove`, `last`, `hl`, `ring`, `arrows`, `badge`, promotion picker, keyboard move entry). New in `WEB/components/train/runner/`: `TrainerRunner` (one component for bank and puzzles, `mode` prop), `TrainerLabelBar`, `StatusLine`, `CoachLine`, `HintButton`, `GradeBar`, `TrainerMenu`, `SessionProgress`, `SourceCard`, `QueueList`, `RuleLine`, `ReportDialog`, `DoneBlock`.

**Interactions and keys** (`V3Shortcuts` "Puzzles and lessons" + rct-b §5.8; single keys only with a fine pointer, no editable focus, no modal, the P1 single-key switch on): `H` hint (twice for the arrow), `R` try again, `S` show solution, `1`–`4` grade, `Enter` the suggested grade (or Next when done), `Esc` close the menu or dialog. Click-move and drag (P2 board), keyboard square cursor + `Enter`, promotion picker before validation (5-char UCI).

### 4.5 S5 Puzzle session — `/train/puzzles`

**Boards.** Desktop (mode `theme`): `DR/V3PuzzleSolve.dc.html` (`solve`), `DR/V3PuzzleHint.dc.html` (`hint`), `DR/V3PuzzleWrong.dc.html` (`wrong`), `DR/V3PuzzleCorrect.dc.html` (`correct`: "Rating 1524 +12 · Streak 5"), `DR/V3PuzzleSolution.dc.html` (`solution`: "−8 · Streak 0"), `DR/V3PuzzleThemes.dc.html` (`themes`, §4.6). Devices: `DR/V3iPhonePuzzle.dc.html`, `DR/V3AndroidPuzzle.dc.html`, `DR/V3iPadLPuzzle.dc.html`, `DR/V3iPadPPuzzle.dc.html` (all six states).

**Route.** `WEB/app/(app)/(immersive)/train/puzzles/page.tsx`; params `?theme=fork`, `?n=3` (plan step: 3 puzzles then done), `?pick=1` (open the theme picker on load), `?s=<ref>` resume, `?source=plan|hub|summary|nav|bank`.

**Layout.** As S4, with these differences: the panel header is h1 **Puzzles** + **Theme: Forks** button (opens S6); a "This puzzle" card while solving (Theme, Puzzle rating "1420", Source "Lichess puzzle · matched to your rating", look line "Press Hint to see what to look for." → after a hint the theme's look text, e.g. "Look for one square where a piece attacks two things."); a "Session" card ("Puzzle 1 of 10 · Streak 4 · Rating 1512") with `ResultDots` (`role="img"` "Last 6 results: 4 right, 2 wrong"); no `SourceCard`, no `QueueList`. Label bar: "{theme} · {src} · Rating 1512 · Streak 4" (theme mode `ratingLbl`). Phones: header Back, "Puzzles · 1 of 10", theme icon button (`aria-label="Choose a theme"`); status + rating line above the board; "{theme} · {src}"; coach and grade in a bottom section; "Grade it above to get the next puzzle" in `graded`; the overflow label "More: solution, analyse, end session" still lists Skip for Today.

**States.** As S4 plus: every puzzle starts with the **setup move** (Lichess FEN is before the opponent's move): status "Watch the last move…" for 400 ms (reduced motion: no slide, the piece appears), then `solve`. Rating chip: shows the new rating and delta as soon as the item is solved (`correct`/`solution` states) using the same Glicko function as the server (§8.7); the server's value replaces it silently on flush. "You play Black" when `orient = 'b'` (the board logic hard-codes White; P5 makes it dynamic). Puzzle 8 of 10 reached → W3 extend fires in the background; the stream continues past 10 (`?n=` sessions stop at n). Theme with too few puzzles near the rating → info note "Few fork puzzles near 1512; showing 1300–1700." (`meta.widened`). Daily fair-use cap (400) → `RetryCountdown` "You've solved 400 puzzles today. More tomorrow." Shards unavailable → inline `ErrorState` "Puzzles are unavailable right now. Your Mistake Bank still works." + **Open Mistake Bank**.

**Keys.** As S4 plus `T` toggles the theme picker.

### 4.6 S6 Theme picker (popover / sheet over S5)

**Boards.** `DR/V3PuzzleThemes.dc.html` (desktop popover `role="dialog" aria-label="Choose a theme"`, "Theme · your mastery", option rows "Forks 62% · 14 puzzles" + bar); the `themes` state of each puzzle device board (bottom **sheet** on phones and iPad P).

**States.** closed → open (options from the session payload's `themes`, else `GET /api/train/themes`, `qk.train.themes()` 10 min) → picked (closes, W2 `{kind:"puzzles", theme}` builds a new session, the old ACTIVE puzzles session is closed as ABANDONED in the same transaction; progress resets to "1 of 10"; earlier attempts stay recorded). Options: **Recommended** first (focus theme), then the 6 design themes (Forks, Pins, Loose pieces, Back rank, Mate in 2, Discovered attack), then **More Themes** (Disclosure grouped Tactics / Mates / Endgames / Defence, rct-b Q10). A never-attempted theme shows "New" instead of a percentage; `available = 0` near the rating → disabled with "No puzzles at your level yet". Each option: `aria-pressed`, name "Forks, mastery 62 percent, 14 puzzles, selected".

**Components.** P1 `Popover` (desktop) / `Sheet` (phones) via `ResponsiveDialog`, `Disclosure`, `Button`. New `WEB/components/train/runner/ThemePicker.tsx`. Keys: arrows move, `Enter` picks, `Esc` closes, `T` toggles.

### 4.7 S7 Training session summary — `/train/session/[ref]/summary`

**Boards.** `DR/V3SessionSummary.dc.html` (`default`), `DR/V3SessionPerfect.dc.html` (`perfect`). No device boards: phones and iPad P stack the same content in one column (`ScrollRegion`).

**Route.** `WEB/app/(app)/train/session/[ref]/summary/page.tsx`; `WEB/app/(app)/train/session/[ref]/page.tsx` redirects (ACTIVE → the runner `?s=`, otherwise → summary). Nav: Train · Today.

**Layout.** Desktop: two columns `minmax(0,1.1fr) minmax(0,1fr)`, gap 48, max 1180, centred. Left: eyebrow "Session summary · Mistake Bank + forks", h1 (serif), sentence, stat tiles (`dl`: "4 / 5 Solved · 3 First try · 1 With a hint", perfect: "5 / 5 · 5 · 0 Hints"), milestone `Tag` "Milestone · forks 70%", next-step cards (max 520): **Continue With Puzzles** "Rated and themed sets don't count against your bank cap" → `/train/puzzles?theme=<top>&source=summary`, **Back to Train**; the lesson card "Legend lesson: forks in Morphy's Opera Game" is the `LessonCardSlot` reading `SessionSummary.next.lesson` (always `null` in P5, so nothing renders; P8 S13 fills it, which also restores flow-map edge E60, coverage C-05). Right: h2 "How you graded them · next review", grade table (real `table`, headers Grade · Count · Next review; grid `70px 1fr 24px 80px`; "Again 1 < 10 min · Hard 1 2 days · Good 2 4 days · Easy 1 9 days"), note "Again brings a position back today; Easy pushes it out more than a week. The schedule is FSRS.", h2 "Themes covered", chips "Fork · 3 · Loose piece · 1 · Recapture first · 1".

**States.**

| State | Rule | Content |
|---|---|---|
| `default` | otherwise | h1 "Done for today." (bank/daily) / "Session complete." (puzzles); sentence "Your bank resets tomorrow. Forks are improving: 2 of 3 found on the first try." (template: theme with most items + its first-try ratio); puzzles: "Rating 1524 (+12 this session)." replaces the bank sentence |
| `perfect` | `total ≥ 3` and every item first try | h1 "A perfect session."; "5 of 5 on the first try. Forks just passed 70% mastery." (milestone clause only when crossed) |
| *saving* (no board) | the client navigated with `?n=<graded>` and the server has fewer attempts | "Saving your results…" (`role="status"`); R3 refetched every 1 s up to 5 times; then the real summary or, if still short, the partial summary with "Some results are still syncing." |
| *abandoned / empty* | 0 attempts | `redirect('/train')` |

Interval label per grade = median `scheduledDays` of this session's attempts with that grade (minutes when < 1 day), else the default preview label (rct-b T6).

Stat definitions (per distinct item, so a re-queued pass-2 item is not counted twice): **Solved** = items whose last pass was solved without Show Solution; **First try** = items solved on pass 1 with no hint, no wrong move; **With a hint** = items whose solving pass used a hint; **Skipped** = items skipped for today; the grade table counts every graded attempt (pass 2 included).

**Components.** P1 `PageHeader`, `Tag`, `Card`, `Button`, `Chip`. New `WEB/components/train/summary/`: `SummaryHero`, `StatTiles`, `GradeTable`, `ThemeChips`, `NextStepCards`, `SavingNotice`. Keys: `Enter` = Back to Train.

### 4.8 Lights up in earlier phases' screens (P5 turns these on)

| Screen (phase) | Slot | P5 behaviour |
|---|---|---|
| Review key moments `DR/V3KeyMoments.dc.html` (P3) | bank toggle + `B` shortcut | `PATCH /api/review/[ref]/moments/[ply] {inBank}` (A6) optimistic (cdl §3.6.1, P3's `useToggleMomentInBank`); toasts "Added to Mistake Bank · next review tomorrow" / "Removed from Mistake Bank" (+ Undo) |
| Review complete `DR/V3RvComplete.dc.html` (P3) | "{n} moments reviewed · {added} added to your Mistake Bank. The first one comes back {label}." ; tags "Added"/"Not added"; primary **Drill These {n} Mistakes · ~{ceil(n·40 s/60)} min** → `/train/bank/session?game=<ref>` (`prefetch={false}`); all toggles off → "nothing added" and primary **Back to Home** | data from `complete.server.ts` (§3.2) |
| **Game-over card** (P2 `GameOverCard` slot `bank`, hand-off H-01; boards `V3GameOver`, `V3GameOverLoss`, `V3RematchOffer`, `V3Game` `over_*` states with `r.bankOn`, `V3{iPhone,Android,iPadL,iPadP}GameOver`, and `V4TournamentGameOver` `over_tournament`) | `result.bank` line | `GameOverBankSlot` renders "+{n} position{n>1?'s':''} added to your Mistake Bank (move{n>1?'s':''} {list})." where `list` = the move numbers of `bankAdded.plies` (`floor((startPly + ply) / 2) + 1`, joined with ", "). Data: `analysis:done.bankAdded` (live) or `qk.review.status(ref).bank` (seeded by the game-over RSC / P3 A2). Hidden while analysis is queued or running, when `count = 0` (the count is the number of BANK cards that exist for this game's moments now, so an opt-out made in the review lowers it), when `bank` is `null` (flag `train` off), and for spectators. `aria-live="polite"`, appears with the same 300 ms fade as P3's accuracy line (instant with reduced motion). The tournament card reuses the same slot (P12 points at this row) |
| Onboarding done (P4) | **Go to Home** | → `/home`; copy "We'll show your first review on Home." |
| Shell (P1) | Home, Train destinations; tab bar 6 items (Home, Play, Train, Learn, Review, Profile); logo → `/home`; chords `g h`, `g m` | flags `home`, `train` |

---

## 5. UI ↔ API data flow

Follows cdl §2–§8: **RSC first paint through the server-only DAL** (`WEB/lib/train/*.server.ts`, `WEB/lib/home/home.server.ts`, all `import "server-only"`, `cache()`-memoised, JSON-safe DTOs that parse with the contract schemas), **TanStack Query seeded with `HydrationBoundary`**, route handlers only for client refetches and mutations (the same service functions), the socket `user:{ref}` room for push, and **no polling** (the hub's 08:00 refresh is a client timer, not a poll).

### 5.1 Query keys, freshness and seeding (`WEB/lib/api/keys/{train,home}.ts`, `WEB/lib/api/queries/{train,home}.ts`)

Query functions call `api(endpoints.train.today, { schema: devSchema(TrainToday) })`: the zod schema is parsed in dev and test only and is dropped from production chunks (api-perf AP-12); the bundle check asserts no `ZodError` string in the P5 route chunks.

```ts
// added to qk (cdl §3.3): first segment = domain, filters normalised last, no user id in keys
train: {
  all:     () => ["train"] as const,
  today:   () => ["train", "today"] as const,
  bank:    (f: BankFilter) => ["train", "bank", norm(f)] as const,        // f = { view, theme, phase, source }
  session: (ref: string) => ["train", "session", ref] as const,
  themes:  () => ["train", "themes"] as const,
},
home:   () => ["home"] as const,
badges: () => ["me", "badges"] as const,   // also mirrored into qk.me().badges
```

| Key | Endpoint (client refetch) | DAL (first paint) | `staleTime` | Focus refetch | Seeded by | Realtime updater |
|---|---|---|---|---|---|---|
| `qk.home()` | `GET /api/home` | `getHomeData(viewer)` | 30 s | yes (when stale) | `/home` page `prefetchQuery` (awaited) | `import:progress` → `setQueryData(home.import)`; `analysis:progress` → `setQueryData(home.continue.analysis)`; any event's `bankDue` → `setQueryData(home.bank.due)`; `analysis:done`, `analysis:batch`, `import:finished`, `mistakes:added`, `bank:due_changed` → **`invalidateThrottled(qk.home(), 30_000)`** (one trailing refetch per 30 s at most; hidden tab: stale only) |
| `qk.train.today()` | `GET /api/train/today` | `getTrainToday(viewer)` | 30 s; **0 when `dayKey` ≠ current local day** | yes | `/train` page `prefetchQuery` | the same events → `invalidateThrottled(qk.train.today(), 30_000)`; outbox results → stale |
| `qk.train.bank(f)` (infinite) | `GET /api/train/bank?view&theme&phase&source&cursor&limit=50` | `listBank(viewer, f, null)` | 60 s | yes | `/train/bank` `prefetchInfiniteQuery` | the same events → stale only (`refetchType:"none"`); a visible bank page refetches through `invalidateThrottled(qk.train.all(), 30_000)` |
| `qk.train.session(ref)` | `GET /api/train/sessions/:ref?include=items` | `getSession(viewer, ref)` | **∞** (items immutable; patched locally) | no | runner page `setQueryData` from the RSC payload | outbox results patch `capRemaining`, `header.rating`, `header.solveStreak`; extend appends items |
| `qk.train.themes()` | `GET /api/train/themes` | `listThemes(viewer)` | 10 min | no | embedded in the puzzle session payload; fetched on picker open otherwise | — |
| `qk.badges()` / `qk.me().badges` | `GET /api/me/badges` | inside `getMe()` (shell CTE) | 60 s | yes (focus only; **no interval poll**, even with the socket down, api-perf AP-08 item 4) | `(app)/layout` seeds `qk.me()` | outbox: `bankDue − 1` optimistic; `bankDue` from `bank:due_changed`, `analysis:done`, `analysis:batch` → `setQueryData` |

Page pattern (cdl §2.4): every P5 page calls `requireMemberPage()` (DB entitlement through the cached `getMe()`), builds `getServerQueryClient()`, awaits one `prefetchQuery` whose DAL runs **one parallel batch** (§9.2), and renders `<HydrationBoundary state={dehydrate(qc)}>`. Streaming adds nothing for a single ≤ 30 ms batch, so the only skeleton layer is `loading.tsx` (navigation) — one loading layer per page (cdl §8.2 rule 4). The Home `loading` and hub `loading` boards are those `loading.tsx` files; the hub's in-place plan skeleton (§4.2) is the client state while a day-rollover refetch is pending.

Router: `experimental.staleTimes.dynamic = 30` (cdl §2.7) means Back/Forward between `/train` ↔ `/train/bank` within 30 s costs no invocation. Rail/tab links to member pages use P1's `AppLink` intent prefetch (80 ms dwell, fine pointer); **Start Review** (Home) uses `<Link prefetch>` because it is the likely next click (cdl §3.8). **Session-creating URLs are never prefetched**: `/train/bank/session?{plan,card,cards,game,theme…}` and `/train/puzzles?{theme,n,pick}` render pages that create or resume a session, so their links are `prefetch={false}` without intent prefetch. Only `?s=<ref>` (resume) may be prefetched. A lint rule (`rc/no-prefetch-session-create`) flags `<Link prefetch>` to those paths.

### 5.2 Per-screen flow

**S1 Home**

| Step | Mechanism |
|---|---|
| First paint | `app/(app)/home/page.tsx`: `requireMemberPage()` → `prefetchQuery(qk.home(), () => getHomeData(viewer))` → `<HomeScreen/>` (client) reads `useQuery(homeQuery())` |
| Reads after paint | none on mount (0 `/api/*` requests at first paint, asserted in `request-budget.spec.ts`); focus refetch when stale |
| Push | `import:progress` (≤ 1/s) patches `home.import`; `analysis:progress` (priority ≥ 80 jobs only) patches `home.continue.analysis {done,total}` when `gameRef` matches; `bankDue` on any event patches `home.bank.due`; `analysis:done` / `analysis:batch` / `import:finished` / `mistakes:added` / `bank:due_changed` → `invalidateThrottled(qk.home(), 30_000)`. A 500-game import backlog therefore costs at most one `GET /api/home` per 30 s while Home is visible, and none while it is hidden (rev 1: up to 3 per backlog game, api-perf AP-10) |
| Socket down | P4's fallback poll of import status runs only while `import_running` (5 s → 10 s, visible tab, cdl §5.9); nothing else polls |
| Mutations | none on Home |
| Errors | query error with no data → `ErrorState` (unlikely: RSC seeded); 402 on refetch → paywall redirect |

**S2 Train hub**

| Step | Mechanism |
|---|---|
| First paint | `prefetchQuery(qk.train.today(), () => getTrainToday(viewer, requestNow()))`; the DAL creates today's `TrainingDay.plan` and the `TrainingProfile` row on the first read of the local day (idempotent `INSERT … ON CONFLICT`, §7.3 R1). This is a **registered GET side effect**: the R1 route declares `sideEffects: ["daily_plan"]` in the route registry, so P1's GET-purity gate (api-perf §5) allows exactly these two statements and fails any other write (api §2.2, api TR-1, inv-sys §3.19) |
| Time zone | on mount, if `Intl.DateTimeFormat().resolvedOptions().timeZone` ≠ `me.user.timeZone` and the stored value is the default `"UTC"`: `PATCH /api/train/prefs {timeZone}` then `invalidateQueries(qk.train.today())` (once per tab; a different non-default zone is not overwritten silently, and no settings screen exists yet, D-20) |
| Day rollover | `useLocalDayKey(me.user.timeZone, profile.dayStartHour)` ticks on `visibilitychange` and every 60 s while visible (a pure client clock check, no request); a changed key sets `staleTime 0` → one refetch → plan skeleton in place |
| Release timer | one `setTimeout` to `nextBatch.at` (≤ 24 h, re-armed on refetch) → `invalidateQueries([qk.train.today(), qk.badges()])` only if the tab is visible (else on the next focus) |
| Start plan | `useMutation(createSession)`: `POST /api/train/sessions {kind:"daily", source:"plan"}` with an `Idempotency-Key` UUID v4 (api §2.8 format) generated on the first click and reused for 10 s of repeated clicks; on success `setQueryData(qk.train.session(ref), payload)` and `router.push('/train/bank/session?s='+ref)`; not optimistic (server id) |
| Errors | 429 `rate_limited` (session bucket) → inline countdown on the CTA; 402 → paywall; 5xx → toast with Event ID, CTA re-enabled |

**S3 Mistake Bank**

| Step | Mechanism |
|---|---|
| First paint | `parseBankFilters(searchParams)` → `prefetchInfiniteQuery({queryKey: qk.train.bank(f), queryFn: () => listBank(viewer, f, null), initialPageParam: null})` |
| Small banks (≤ 300 cards, the common case) | the first page carries **every row** and `meta.complete = true`; tab, filter and clear run on the client over the cached rows (instant "Show 4 positions" count inside the popover, as the design implies); the URL updates with `history.replaceState` (no RSC request) |
| Large banks (> 300) | page 1 = 50 rows + `nextCursor`; filters change the key → `useInfiniteQuery` with `placeholderData: keepPreviousData` (old rows dim, hairline after 200 ms); an `IntersectionObserver` sentinel (`rootMargin: 600px`) fetches the next page; `maxPages: 10`; rows use `content-visibility:auto; contain-intrinsic-size:72px` |
| Primary CTA | `createSession {kind:"bank", filter, practice: nothingDue}` → runner |
| Skip (from runner) / Remove (row ⋯) | optimistic: the row moves to "Scheduled later" / leaves the list; Remove commits after the 6 s Undo window (`DELETE /api/train/cards/:ref`), Undo cancels the pending mutation (cdl §3.5) |
| Push | `bank:due_changed` / `mistakes:added` / `analysis:done` / `analysis:batch` → `invalidateThrottled(qk.train.all(), 30_000)`: one trailing refetch of the active bank page per 30 s when visible; stale only when hidden |
| Errors | as hub; `400 validation_failed` with `cursor_filter_mismatch` → drop the cursor and refetch page 1 |

**S4/S5 Runner (bank and puzzles)**

| Step | Mechanism |
|---|---|
| First paint | page resolves the session server-side: `?s=` → `getSession(viewer, ref)` (404 for another user's ref); otherwise `createOrResumeSession(viewer, spec, requestNow())` (the same service as W2, idempotent by `filterKey` + ACTIVE < 2 h, and counted against the same durable `train-session` limit) → `redirect('?s='+ref)`. Because the page writes, links to the creating URLs are never prefetched (§5.1); a `Purpose: prefetch` / `Next-Router-Prefetch` request that still arrives renders the `loading.tsx` shell only and does not call the service. The board renders from the payload **outside** Suspense (cdl §2.2 immersive row); `<TrainerRunner initial={payload}/>` mounts `createTrainerStore(payload)` (Zustand, per instance, cdl §6.3) and `setQueryData(qk.train.session(ref), payload)` |
| Resume | `resumeIndex = max(payload.resumeIndex, highest local outbox index for this session)`; graded items are never repeated (V3 "Persistence", rct-b T3) |
| Prefetch / pre-render | all items (≤ 20) are in the payload; each FEN is pre-parsed with chess.js and the next board is rendered offscreen (`inert`, `aria-hidden`) so the transition is ≤ 16 ms; PUZZLES: when 2 items remain, `POST …/extend` (W3) appends 10 (`setQueryData` append) |
| Move check | local only (`features/train/validate.ts`): `uci === solution[ply]` or (first user ply) `uci ∈ accept`; promotions are 5-char UCI; no network |
| Grade | §5.4 outbox flow: durable enqueue → advance → debounced flush → `AttemptOut` patches |
| Skip for today | `POST /api/train/cards/:ref/skip {sessionRef}` (W5), optimistic advance; the summary lists it as Skipped |
| End session / done | `outbox.flush()` (≤ 3 s, then "Saving…") → `POST /api/train/sessions/:ref/end {reason}` (W4) → `router.push('/train/session/'+ref+'/summary?n='+graded)`; `invalidateQueries([qk.train.today(), qk.home(), qk.badges()], {refetchType:"none"})` + `crossTab.stale(...)` |
| Report | `POST /api/reports {targetType:"mistake"\|"puzzle", targetRef, reason, note?, fen}` with `Idempotency-Key`; optimistic: the item is skipped |
| Theme switch (S6) | `createSession {kind:"puzzles", theme, source:"picker"}` (new `Idempotency-Key`) → `router.replace('?s='+newRef)` |
| Errors | create failure → inline `ErrorState` + Retry; W1 402 → stop the session, keep the outbox, `reactToApiError` (paywall); W1 network/5xx → silent retry (1 s → 4 s → 15 s, then `online`/`visible`/mount); W3 failure → the stream ends at the current batch with "No more puzzles right now." |

**S7 Summary**

| Step | Mechanism |
|---|---|
| First paint | RSC `getSessionSummary(viewer, ref)` (404 for a foreign ref) |
| Saving | if `?n=` > the server's graded count: client `useQuery(sessionSummaryQuery(ref))` with `refetchInterval: (q) => q.state.dataUpdateCount < 5 && short(q) ? 1000 : false` (the only interval in P5, bounded to 5 s) |
| Navigation | Back to Train / Continue with puzzles are plain links; the hub re-renders server-side |

### 5.3 Mutations: optimistic rules and invalidation (extends cdl §3.5)

| Mutation | Optimistic | Response → `setQueryData` | Stale (`refetchType:"none"`) | Cross-tab (`BroadcastChannel("rc-sync")`) |
|---|---|---|---|---|
| Grade attempts (W1, outbox) | **yes** | `train.session(ref)`: `capRemaining`, `header.rating`, `header.solveStreak`; `me.badges.bankDue` | `train.today`, `train.bank(*)`, `home` | yes |
| Create session (W2) | no | `train.session(newRef)` | `train.today` | — |
| Extend (W3) | no (fired 2 items early) | append `items` | — | — |
| End session (W4) | no | — | `train.*`, `home`, `me.badges` | yes |
| Skip card (W5) | **yes** (advance; row moves) | — | `train.today`, `train.bank(*)` | yes |
| Remove card (W6) | **yes**, Undo 6 s, commit after | — | `train.*`, `home`, `me` | yes |
| Report (W7) | **yes** (item skipped) | — | — | — |
| Prefs (W8, time zone) | no (silent) | `me.user.timeZone` | `train.today`, `home` | — |
| Moment bank toggle (A6) | **yes** (cdl §3.6.1) | `review.detail(ref)` moment `inBank`, `card` | `train.bank(*)`, `train.today`, `home` | yes |

Reconnect: when P2's `connect` ack carries `{bootId, useq}` (api-perf AP-25), the client marks `train.today`, `home` and `me` stale only if `bootId` changed or a `useq` gap shows a missed user-room event; otherwise a reconnect costs nothing. Until P2 ships `useq`, the cdl §3.5 rule applies (a gap > 5 s marks the three keys stale, `refetchType: "active"`).

### 5.4 The grade flow and the outbox (`WEB/lib/offline/outbox.ts`, `WEB/features/train/useGrade.ts`)

1. On `graded` the runner builds `AttemptIn` (§7.2 W1) with `clientAttemptId = crypto.randomUUID()`, `cardReps` (optimistic concurrency), `reviewedAt = new Date().toISOString()`, `sessionRef`, `itemId`.
2. `await outbox.enqueue(userRef, "attempts", attempt)` writes to IndexedDB database `rc-outbox`, store `items`, key `u:<userRef>:attempts` (`idb-keyval`, ≈ 0.6 kB gz) **before** the UI advances (durable first).
3. `runner.advance()`; locally: decrement `me.badges.bankDue` for a BANK item graded for the first time today; show the interval toast "Back in 4 days" from `item.preview` (no server needed); for an AGAIN in pass 1, insert the item again at `min(i + 4, items.length)` (the server applies the same deterministic rule, §8.6); for a PUZZLE item, the rating chip already shows the client-computed Glicko delta (§8.7).
4. **Flush policy** (cuts Vercel invocations ≈ 3× against flush-per-grade): flush when ≥ 3 attempts are queued, 4 s after the last enqueue, on session end/done, on `visibilitychange:hidden` and `pagehide` (`keepalive: true`, body < 60 KB), on `online`, and on app mount (`useOutboxSync()` in the `(app)` layout). One tab flushes at a time (`navigator.locks.request('rc-outbox:<ref>', {ifAvailable:true})`). Batches ≤ 50, sorted by `reviewedAt`.
5. Results: `ok` → apply patches (rating, streaks, theme milestone toast "Milestone · forks 70%", `capRemaining`, `planDone`); `duplicate` → drop; `conflict` (card graded in another tab or device) → drop silently + `train_attempt_conflict` event; `rejected` (`too_old`, `not_found`) → drop + Sentry breadcrumb. A whole-batch 402 → stop the session, keep the outbox for when membership resumes (attempts up to 7 days old are accepted), `reactToApiError` → paywall.
6. Retry: 1 s → 4 s → 15 s, then on `online`/`visible`/mount. The outbox caps at 500 items per user; items older than 14 days are sent with `stale: true` and the server answers `rejected/too_old`.
7. Sign-out: `signOutEverywhere()` flushes, then clears `rc-outbox` and `rc-offline` for that user (cdl §6.6).

**Offline continuation** (owner test T8): `useOnline()` (P1) pauses queries; the runner keeps working from the in-memory payload, which is also mirrored to IndexedDB `rc-offline` key `u:<userRef>:session:<sessionRef>` on load. An **online** reload of `/train/bank/session?s=…` resumes from the server (`resumeIndex`) merged with the outbox. An **offline** reload needs a cached document; that arrives with P11's per-user service-worker cache (`rc-pages:u:<ref>`, api-perf AP-34), which then restores the runner from the same IDB key. FSRS interval labels offline come from `item.preview` (computed at session build) and, for an Again re-queue, from `item.previewAfterAgain` (also computed at build), so ts-fsrs never ships to the browser. The server replays attempts in `reviewedAt` order with `now = reviewedAt` (arch §2.3.5); its result is authoritative. P11 adds the daily offline snapshot and the `/offline` row.

### 5.5 Realtime events consumed (`WEB/lib/realtime/handlers/{train,home}.ts`)

| Event (room `user:{ref}`) | Payload (`CT/socket/user.ts`) | Effect |
|---|---|---|
| `bank:due_changed` | `{v:1, bankDue, dueRaw, total, nextAt}` (≤ 120 B) | `setQueryData` of `qk.me().badges.bankDue` and `qk.home().bank.due`; `invalidateThrottled` for `train.today`, `train.all`, `home` |
| `mistakes:added` (backfill path only, ≤ 1 per user per 60 s) | `{v:1, games, added, cardsAdded, total, bankDue}` (≤ 120 B; `games` = games extracted since the last event) | as `bank:due_changed`; an open review (`qk.review.detail`) is **not** invalidated by it (backfill games are old) |
| `analysis:done` (P3, fields added by P5) | `{…P3, bankAdded: {count, plies} \| null, bankDue: int \| null}` (≤ 200 B, P3's size test raised from 160 B) | as P3; `bankAdded` drives the game-over `bank` slot and `setQueryData(qk.review.status(ref).bank)`; `bankDue` → badges/home `setQueryData`; then `invalidateThrottled` for `train.today`, `train.all`, `home` |
| `analysis:batch` (P3, coalesced per user ≤ 1 per 60 s for jobs below priority 80) | `{v:1, done, total, bankAdded: int, bankDue: int}` | `bankDue` → `setQueryData`; `invalidateThrottled` for `train.today`, `train.all`, `home` |
| `analysis:progress` (P3, priority ≥ 80 jobs only) | `{gameRef, gradedPlies, totalPlies, …}` | Home Continue "Analysing · n of m" (`setQueryData`, no fetch) |
| `import:progress` / `import:finished` (P4) | P4 payloads | Home `import_running` row (`setQueryData`) / `invalidateThrottled(qk.home())` |

`WEB/lib/realtime/invalidateThrottled.ts`: `invalidateThrottled(key, ms)` keeps one timer per query-key hash; the first event in a window schedules a trailing `invalidateQueries({queryKey, refetchType: document.hidden ? "none" : "active"})` at the end of the window and later events in the window only coalesce into it. Unit-tested with a fake clock: 100 events in 30 s → 1 invalidation; hidden tab → 0 fetches, 1 stale mark.

### 5.6 Error, 401, 402, 429 handling (P1 `reactToApiError`, cdl §3.7, §4.4)

| Code | Where in P5 | UI |
|---|---|---|
| 401 `unauthorized` | any refetch or mutation | `SessionExpiredModal`; runner keeps the outbox and retries after the silent refresh |
| 402 `subscription_required {reason: trial_available \| trial_used \| expired \| payment_failed}` / `payment_update_required` | pages (server redirect via `requireMemberPage()`), every train/home API | `/pricing?reason=<reason>&redirect_url=<path>`; the runner stops after the outbox keeps its items |
| 404 `not_found` | foreign or missing session/card refs | page → `notFound()` (`V3Error404` `missing_game` style); API → inline `ErrorState` |
| 409 `conflict` | W3 extend on an ended session (`details.reason: "session_ended"`, registered in `CONFLICT_REASONS`) | extend: stop the stream quietly |
| 422 `idempotency_key_reused` | W2/W7 with a reused `Idempotency-Key` and a different body | new key and retry once |
| 429 `rate_limited` | W2 (`train-session`, durable), W1/W3/W5/W6/W8/A6 (`train-write`), daily puzzle cap (`details.reason: "daily_puzzle_limit"`, `retryAfterSec` to the next local day), W7 (`report`, durable) | inline `RetryCountdown`; never auto-retry a mutation except the outbox (which honours `Retry-After`) |
| 403 `forbidden` | a cookie-authenticated mutation with a foreign `Origin` (P1 middleware) | generic error toast (never seen by real users) |
| 502 `upstream_unavailable` | puzzle shard fetch failed (R2) on W2/W3 PUZZLES | inline `ErrorState` "Puzzles are unavailable right now. Your Mistake Bank still works." |
| 503 `maintenance` | any | P1 maintenance banner |
| 5xx | any | toast with the Event ID (`requestId`); queries retry 2× (network/5xx only) |

---

## 6. Data model (migration M5)

Source of truth: `PKG/db/prisma/schema.prisma` (moved there in P2). The blocks below are dm §5.6 with the allocation's table names (B11) and the P5 additions marked `// P5+` (each one justified in §6.4). Conventions (dm §2): BigInt ids, `referenceId` only on rows addressed by URL (Mistake, TrainingSession, Report), composite PKs and no cuid on high-volume child rows, `timestamp(3)` UTC, `@db.Date` for local days, VarChar limits mirrored in zod, `onDelete: Cascade` from `User` for private rows, plain columns (no FK) for history (`TrainingAttempt.cardId/sessionId`, `Mistake.lastGameId`).

### 6.1 Enums

```prisma
enum MistakeSource    { OWN_ERROR MISSED_PUNISH }                       // filter "My blunders" | "Missed punishments"
enum GamePhase        { OPENING MIDDLEGAME ENDGAME }                    // from GameAnalysis.phasePlies
enum TrainingDeck     { BANK PUZZLE OPENING }                           // OPENING is written from P8
enum TrainingItemKind { MISTAKE REVIEW_POSITION LICHESS_PUZZLE OPENING_LINE }
enum CardState        { NEW LEARNING REVIEW RELEARNING }                // ts-fsrs State 0..3
enum FsrsGrade        { AGAIN HARD GOOD EASY }                          // ts-fsrs Rating 1..4
enum SessionKind      { DAILY BANK PUZZLES WEAKNESS PRACTICE }          // WEAKNESS written from P6; declared now to avoid ADD VALUE later
enum SessionStatus    { ACTIVE COMPLETED ABANDONED }
enum ReportTarget     { USER GAME MISTAKE PUZZLE LESSON POSITION COACH_MESSAGE }   // P5 writes MISTAKE, PUZZLE
enum ReportReason     { CHEATING ABUSE INAPPROPRIATE_NAME WRONG_SOLUTION BETTER_MOVE ILLEGAL_MOVE TEXT_WRONG OTHER }
enum ReportStatus     { OPEN ACTIONED DISMISSED }
// existing enum, own migration file (m5a): JobKind + EXTRACT_MISTAKES
```

`Judgement` (P3, 12 values) and `TimeClass` (P2) are reused.

### 6.2 Models

```prisma
/// M5. A trainable position from the user's own games, deduped per (user, position). Lichess-CSV shape (res §7.4).
model Mistake {
  id               BigInt              @id @default(autoincrement())
  referenceId      String              @unique @default(cuid())
  userId           BigInt
  /// fnv1a-64 of the EPD (placement, side, castling, ep) of the position before the user's move, as signed int64
  epdHash          BigInt
  color            String              @db.Char(1)              // user's colour = board orientation
  /// position before the opponent's setup move; equals the position before the user's move when setupUci is null (ply < 1)
  fen              String              @db.VarChar(100)
  setupUci         String?             @db.VarChar(5)           // opponent's previous move (last-move marks in bank mode)
  /// "best reply best …" after the setup move, odd length, space-separated UCI; REVIEW_POSITION rows hold best only
  solution         String              @db.VarChar(120)
  accept           String?             @db.VarChar(60)          // other first moves accepted (within 2 Win% of best; other mates)
  playedUci        String              @db.VarChar(5)
  refuteUci        String?             @db.VarChar(5)           // P5+ opponent's best reply to the played move (coachWrong text, no GameAnalysis read)
  judgement        Judgement
  source           MistakeSource
  isPuzzle         Boolean
  uniquenessGap    Float?              @db.Real                 // wc(best) − wc(second), so the 0.5 threshold can move without engine work
  themes           String[]            @default([])
  primaryTheme     String              @db.VarChar(32)
  phase            GamePhase
  winBefore        Float               @db.Real                 // Win% (user POV) before the move = after the best move
  winAfterPlayed   Float               @db.Real
  cpBest           Int?                                         // user POV, clamped ±1000 like Win%
  mateBest         Int?                @db.SmallInt
  timeClass        TimeClass?
  ecoCode          String?             @db.VarChar(3)
  moveNumber       Int                 @db.SmallInt
  occurrences      Int                 @default(1) @db.SmallInt
  /// most recent occurrence, denormalised so a bank row renders with no join (plain columns, maintained by the worker)
  lastGameId       BigInt?
  lastPly          Int?                @db.SmallInt
  lastPlayedAt     DateTime
  lastOpponentName String              @db.VarChar(40)
  texts            Json?                                        // MistakeTextV1, P7 verified LLM text only
  textVerifiedAt   DateTime?
  hiddenAt         DateTime?                                    // "Remove from bank"
  createdAt        DateTime            @default(now())
  updatedAt        DateTime            @updatedAt               // P5+ (re-analysis updates)
  user             User                @relation(fields: [userId], references: [id], onDelete: Cascade)
  card             TrainingCard?
  occurrenceRows   MistakeOccurrence[]
  // no keyMoments relation: moments live in PlayerReview.content (P3-D3); the link is MistakeOccurrence (gameId, ply)

  @@unique([userId, epdHash])
  @@index([userId, createdAt(sort: Desc)])
  @@map("mistakes")
}

/// M5. Every (game, ply) where a Mistake happened ("seen in 3 games"). Cascades from both sides.
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

/// M5. FSRS state (ts-fsrs Card), one per (user, item). API ref = itemKey: "m_<sqid(epdHash as uint64)>" (known before the mistake id exists,
/// so the worker's HTTP batch needs no RETURNING), "p_<lichessId>", "o_<sqid(openingId)>".
/// = dm §5.6 ReviewCard (renamed per alloc B11).
model TrainingCard {
  id             BigInt           @id @default(autoincrement())
  userId         BigInt
  deck           TrainingDeck
  kind           TrainingItemKind
  itemKey        String           @db.VarChar(40)
  mistakeId      BigInt?          @unique
  puzzleId       String?          @db.VarChar(8)
  openingId      BigInt?                                      // plain column (P8)
  /// snapshot for PUZZLE/OPENING cards so they render without the shards: Lichess FEN + full "setup best reply …" line
  fen            String?          @db.VarChar(100)
  solution       String?          @db.VarChar(120)            // ≤ 15 UCI tokens (shard filter) = ≤ 89 chars
  orient         String?          @db.Char(1)
  puzzleRating   Int?             @db.SmallInt
  theme          String           @db.VarChar(32)             // primary theme, denormalised (filters, facets, mastery)
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
  mastery        Int              @default(0) @db.SmallInt     // 0..5 dots, derived from stability on every write (§8.8)
  suspendedUntil DateTime?                                    // "Skip for today" → next release
  createdAt      DateTime         @default(now())
  updatedAt      DateTime         @updatedAt
  user           User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  mistake        Mistake?         @relation(fields: [mistakeId], references: [id], onDelete: Cascade)

  @@unique([userId, itemKey])
  @@index([userId, deck, due])
  @@map("training_cards")
}

/// M5. One row per graded or practice attempt; the FSRS review log. Append-only. = dm §5.6 ReviewLog (renamed).
model TrainingAttempt {
  id              BigInt           @id @default(autoincrement())
  clientAttemptId String           @unique @db.Uuid           // idempotency + offline outbox replay
  userId          BigInt
  cardId          BigInt?                                     // plain: history outlives cards
  sessionId       BigInt?                                     // plain: history outlives sessions (pruned at 90 d)
  itemId          String?          @db.VarChar(8)             // P5+ session-local item id ("i3", "i3b" for pass 2): resume + summary
  deck            TrainingDeck
  kind            TrainingItemKind
  puzzleId        String?          @db.VarChar(8)
  puzzleRating    Int?             @db.SmallInt
  theme           String           @db.VarChar(32)
  solved          Boolean
  firstTry        Boolean
  hintsUsed       Int              @default(0) @db.SmallInt
  wrongTries      Int              @default(0) @db.SmallInt
  wrongMoves      String?          @db.VarChar(60)            // P5+ up to 10 UCI, space-separated (audits, "repeated the game move")
  solutionShown   Boolean          @default(false)
  timeMs          Int
  grade           FsrsGrade?                                  // null = practice repeat (no FSRS update)
  suggestedGrade  FsrsGrade?
  /// FSRS state AFTER this review (optimiser + audits)
  state           CardState?
  stability       Float?           @db.Real
  difficulty      Float?           @db.Real
  elapsedDays     Int?             @db.SmallInt
  scheduledDays   Int?             @db.SmallInt
  ratingBefore    Float?           @db.Real
  ratingAfter     Float?           @db.Real
  reviewedAt      DateTime                                    // client clock, clamped to [now − 7 d, now + 5 min]
  createdAt       DateTime         @default(now())            // P5+ server receipt (offline lag analytics)
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
  filterKey       String        @db.VarChar(64)               // P5+ hash of the normalised SessionCreate (ACTIVE-session reuse)
  theme           String?       @db.VarChar(32)
  size            Int           @db.SmallInt
  mix             Boolean       @default(false)
  countsTowardCap Boolean       @default(true)
  /// SessionItemsV1 {v:1, items:[{id,key,kind,pass,skipped?,p?:[id,fen,moves,rating,theme]}]} incl. requeued AGAIN items
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

/// M5. One row per user per LOCAL training day: caps, week strip, frozen daily plan.
model TrainingDay {
  userId        BigInt
  day           DateTime @db.Date                            // local date in User.timeZone; the day starts at TrainingProfile.dayStartHour
  bankReviewed  Int      @default(0) @db.SmallInt            // cap counter (first FSRS grade of a BANK card today, counting sessions only)
  newIntroduced Int      @default(0) @db.SmallInt
  puzzlesDone   Int      @default(0) @db.SmallInt
  lessonsDone   Int      @default(0) @db.SmallInt            // P8
  activeMs      Int      @default(0)
  plan          Json?                                         // DailyPlanV1, frozen on the first hub read of the day; nulled after 7 days
  planDone      Int      @default(0) @db.SmallInt            // bitmask of done steps (bit i = step i)
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
  bankCount     Int       @default(0) @db.SmallInt            // live BANK cards with this primary theme
  milestonePct  Int       @default(0) @db.SmallInt
  lastAttemptAt DateTime?
  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([userId, theme])
  @@map("theme_mastery")
}

/// M5. 1:1 with User, created lazily. Counters (dm) + the training prefs (P5+, see §0 and §6.4).
model TrainingProfile {
  userId                  BigInt    @id
  puzzleRating            Float     @default(1500) @db.Real
  puzzleRd                Float     @default(350) @db.Real
  puzzleVol               Float     @default(0.06) @db.Real
  puzzleAttempts          Int       @default(0)                // P5+ "provisional" label below 20
  ratingSeeded            Boolean   @default(false)            // P5+ seed applied once (§8.7)
  solveStreak             Int       @default(0) @db.SmallInt
  solveStreakBest         Int       @default(0) @db.SmallInt
  dayStreak               Int       @default(0) @db.SmallInt
  dayStreakBest           Int       @default(0) @db.SmallInt
  lastActiveDay           DateTime? @db.Date
  lastWeaknessSeenVersion Int       @default(0)               // P6
  dayStartHour            Int       @default(4) @db.SmallInt  // P5+ prefs (P10 Settings writes them)
  releaseHour             Int       @default(8) @db.SmallInt
  bankDailyCap            Int       @default(10) @db.SmallInt // 5..30
  newPerDay               Int       @default(5) @db.SmallInt  // ≤ bankDailyCap
  autoGrade               Boolean   @default(false)
  updatedAt               DateTime  @updatedAt
  user                    User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("training_profiles")
}

/// M5 (content reports). P5 writes MISTAKE and PUZZLE. P10 writes USER and GAME through the same POST /api/reports handler
/// (targetRef = userRef / gameRef; the 24-hour duplicate check and the durable 20/day limit are shared). One admin queue (P12).
model Report {
  id             BigInt       @id @default(autoincrement())
  referenceId    String       @unique @default(cuid())
  reporterId     BigInt?
  targetType     ReportTarget
  targetRef      String       @db.VarChar(64)                 // mistake referenceId | Lichess puzzle id
  reportedUserId BigInt?
  fen            String?      @db.VarChar(100)
  reason         ReportReason
  note           String?      @db.VarChar(500)
  status         ReportStatus @default(OPEN)
  createdAt      DateTime     @default(now())
  resolvedAt     DateTime?
  resolvedById   BigInt?
  reporter       User?        @relation("ReportsMade", fields: [reporterId], references: [id], onDelete: SetNull)

  @@index([status, createdAt])
  @@index([targetType, targetRef])
  @@index([reporterId, createdAt(sort: Desc)])                 // durable "20 a day" count (api-perf AP-11)
  @@map("reports")
}

// Additions to existing models
model User {          // back-relations only; timeZone already exists (P4 M4)
  mistakes         Mistake[]
  trainingCards    TrainingCard[]
  trainingAttempts TrainingAttempt[]
  trainingSessions TrainingSession[]
  trainingDays     TrainingDay[]
  themeMastery     ThemeMastery[]
  trainingProfile  TrainingProfile?
  reportsMade      Report[]          @relation("ReportsMade")
}
model Game       { mistakeOccurrences MistakeOccurrence[] }
model GamePlayer { bankVersion Int @default(0) @db.SmallInt }   // P5+ 0 = not extracted; EXTRACT_VERSION = 1
// PlayerReview is unchanged: P5 reads content.moments[*].ply and reads/writes progress.bankOptOut (P3-D19) with jsonb functions.
```

`TrainingProfile.user` is `@relation(fields: [userId], references: [id], onDelete: Cascade)` (1:1 keyed on `userId`).

### 6.3 JSON column registry (`PKG/db/json/training.ts`, zod, each with `v`)

```ts
export const DailyPlanV1 = z.object({
  v: z.literal(1), createdAt: z.iso.datetime(), basis: z.enum(["bank", "games20", "new"]), focusTheme: z.string().max(32),
  steps: z.array(z.object({
    kind: z.enum(["bank", "puzzles", "lesson", "review", "import"]),
    cardKeys: z.array(z.string().max(40)).max(10).optional(),   // bank step: the frozen card list
    theme: z.string().max(32).optional(), count: z.number().int().max(10).optional(),
    title: z.string().max(80), subtitle: z.string().max(80), estMin: z.number().int(), href: z.string().max(200),
  })).max(3),
});
export const SessionItemsV1 = z.object({
  v: z.literal(1),
  items: z.array(z.object({
    id: z.string().max(8), key: z.string().max(40), kind: z.enum(["MISTAKE","REVIEW_POSITION","LICHESS_PUZZLE","OPENING_LINE"]),
    pass: z.union([z.literal(1), z.literal(2)]), skipped: z.boolean().optional(),
    p: z.tuple([z.string(), z.string(), z.string(), z.number().int(), z.string()]).optional(),  // puzzle snapshot [id, fen, moves, rating, theme]
  })).max(40),
});
export const MistakeTextV1 = z.object({ v: z.literal(1), hint: z.string(), correct: z.string(), wrong: z.string().nullable(), cost: z.string(), model: z.string(), verifiedAt: z.iso.datetime() });  // P7
```

### 6.4 Why the P5 additions to the dm §5.6 schema

| Addition | Reason | Cost |
|---|---|---|
| `Mistake.refuteUci` | the "you repeated the game move" coach line needs the opponent's best reply; storing it avoids reading `GameAnalysis` (≈ 1.2 KB) per item at session build | 6 B/row |
| `Mistake.updatedAt` | re-analysis and recurrence update the row; needed for audits and the drift check | 8 B/row |
| `TrainingAttempt.itemId`, `wrongMoves`, `createdAt` | resume index and summary per session item; rating-integrity audits; offline lag (`createdAt − reviewedAt`) | ≈ 20 B/row |
| `TrainingSession.filterKey` | "return the ACTIVE session of the same kind and filter if < 2 h old" (api TR-7) needs an exact key | ≈ 20 B/row |
| `TrainingProfile` prefs + `puzzleAttempts`, `ratingSeeded` | `UserSettings` starts in P9 (B14); the attempt transaction updates this row anyway | ≈ 20 B/user |
| `GamePlayer.bankVersion` | the backfill predicate and re-extraction after a rules change (`EXTRACT_VERSION`) without a job-table scan | 2 B/row |
| `reports (reporterId, createdAt DESC)` index | the `report` limit is 20 per day, longer than Neon's 5-minute suspend window, so it is counted from the source rows instead of the `UNLOGGED` bucket (api-perf AP-11) | ≈ 30 B/report |

Rev 1's `KeyMoment.mistakeId` is dropped: the moment ↔ bank link is computed by `(gameId, ply)` through `mistake_occurrences_pkey`, which already exists for dedupe, so no extra column or index is needed.

### 6.5 Indexes and the queries they serve

| Index | Query (statement shape) | Served by |
|---|---|---|
| `mistakes_referenceId_key` | `WHERE "referenceId" = $1 AND "userId" = $u` | report target check, bank detail links, P7 coach subject |
| `mistakes_userId_epdHash_key` | worker upsert `INSERT … SELECT … FROM jsonb_to_recordset($m) ON CONFLICT ("userId","epdHash") DO UPDATE SET "lastGameId" = EXCLUDED…, "lastPlayedAt" = … WHERE EXCLUDED."lastPlayedAt" >= mistakes."lastPlayedAt"`; every later J1 statement joins back to `mistakes` on this natural key, so no statement needs another's `RETURNING` (§7.6) | J1 |
| `mistakes_userId_createdAt_idx` | NEW-card intake order fallback; user-delete cascade; P6 scope scans | W2, P6 |
| `mistake_occurrences_pkey (gameId, ply)` | idempotent insert on re-analysis; **the moment ↔ mistake link**: `WHERE "gameId" = $g AND ply = ANY($momentPlies)` (review bank fields, A6, the game-over count); cascade from game deletion | J1, A1/A2 bank fields, A6 |
| `mistake_occurrences_mistakeId_idx` | `count(*)` for `occurrences`; "seen in 3 games" links; cascade from mistake | J1, bank detail |
| `training_cards_userId_itemKey_key` | W1/W5/W6 card lookup by API ref (`"itemKey" = ANY($keys) AND "userId" = $u … FOR UPDATE`); idempotent card creation (`ON CONFLICT ("userId","itemKey") DO NOTHING`) | W1, W5, W6, R3, J1 |
| `training_cards_mistakeId_key` | 1:1 with `Mistake`; A6 toggle; review bank fields (`LEFT JOIN training_cards c ON c."mistakeId" = m.id`); cascade | A6, J1, A1/A2 |
| `training_cards_userId_deck_due_idx` | due summary (counts with FILTER, `min(due) FILTER (WHERE due > $now)`), due preview `ORDER BY due LIMIT 4`, session build `due <= $now ORDER BY due, id LIMIT 50`, bank list keyset `(due, id) > ($d, $id) ORDER BY due, id LIMIT 51`, upcoming histogram over the next 14 days, badge count, PUZZLE due cards of a theme (`deck='PUZZLE' AND due <= $now` + theme filter in-row) | R1, R2, R8, W2, HOME-1, `getMe()` |
| `training_attempts_clientAttemptId_key` | `SELECT "clientAttemptId" … WHERE "clientAttemptId" = ANY($ids)` duplicate pre-check; `INSERT … ON CONFLICT DO NOTHING` race guard | W1 |
| `training_attempts_userId_reviewedAt_idx` | today's attempts (plan-step completion, `reviewedAt >= $dayStartUtc`), session summary (`reviewedAt BETWEEN startedAt AND coalesce(endedAt, now())` + `sessionId` filter), week puzzles count, streak audits, user-delete cascade | W1, R3, W4, HOME-1 |
| `training_attempts_puzzle_idx` (raw, partial `WHERE "puzzleId" IS NOT NULL`) | exclude recently seen puzzles: `SELECT DISTINCT "puzzleId" … WHERE "userId" = $1 AND "puzzleId" = ANY($ids) AND "reviewedAt" > $now - interval '90 days'` (≤ 500 ids) | W2, W3 |
| `training_sessions_referenceId_key` | runner `?s=` resume, summary page, W3/W4 | R3, W3, W4 |
| `training_sessions_userId_startedAt_idx` | ACTIVE reuse **and** the durable `train-session` limit in one statement: `SELECT count(*) FILTER (WHERE "startedAt" > $now - interval '1 hour') AS n1h, (array_agg("referenceId" ORDER BY "startedAt" DESC) FILTER (WHERE status = 'ACTIVE' AND kind = $k AND "filterKey" = $f AND "startedAt" > $now - interval '2 hours'))[1] AS reuse FROM training_sessions WHERE "userId" = $1 AND "startedAt" > $now - interval '2 hours'` (≤ ~30 rows); housekeeping stale sweep per user; cascade | W2, page-level create |
| `training_days_pkey (userId, day)` | week strip `day >= $monday`; today's caps `ON CONFLICT ("userId", day) DO UPDATE SET "bankReviewed" = training_days."bankReviewed" + EXCLUDED."bankReviewed"`; frozen plan | R1, W1, HOME-1 |
| `theme_mastery_pkey (userId, theme)` | hub mastery bars, theme picker, attempt upsert, `bankCount` increments | R1, R4, W1, J1 |
| `training_profiles_pkey` | rating, streaks, prefs (one PK read in R1/W1/W2) | all |
| `reports_status_createdAt_idx`, `reports_targetType_targetRef_idx` | admin queue (P12); "already reported in the last 24 h" check | W7 |
| `reports_reporterId_createdAt_idx` | durable limit: `SELECT count(*) FROM reports WHERE "reporterId" = $u AND "createdAt" > $now - interval '1 day'` (≤ 20 rows read) | W7 (and P10's player reports) |
| `player_reviews_pkey (gameId, color)` (P3) | `jsonb_path_query_array(content, '$.moments[*].ply')` and `progress->'bankOptOut'` for one game side | A6, J1 opt-out filter, review bank fields |

No GIN index on `themes` and no extra index for theme/phase/source filters: one member has at most a few thousand cards, and the `(userId, deck, due)` range already narrows to them (dm §2 rule 9, audit-db §11.6). Plans are asserted in `WEB/scripts/explain-hot-queries.ts` (§9.1), and **every index name in this table is checked to exist in `pg_indexes` after `migrate deploy`** on a throwaway database (api-perf §5 "index existence check"); the names are exported as `P5_INDEXES` in `docs/indexes.json`, generated from this table.

### 6.6 Migrations and safety

| Folder (`PKG/db/prisma/migrations/`) | Contents | Notes |
|---|---|---|
| `<ts>_m5a_jobkind_extract_mistakes` | `ALTER TYPE "JobKind" ADD VALUE IF NOT EXISTS 'EXTRACT_MISTAKES';` | own file (dm §11.1 rule 3). **Two-release rule** (feasibility §9 rule 1): release N ships m5a and Prisma clients (web and worker) that know the value but never write it; release N+1 (a separate deploy, at least one day later) enables the backfill script and the version-bump path that write it. Rolling back from N+1 to N is then safe |
| `<ts>_m5_training` | `SET lock_timeout = '5s';` new enums; 9 tables; `game_players."bankVersion" smallint NOT NULL DEFAULT 0` (metadata-only); generated indexes; raw SQL below. **Nothing touches `users` or `player_reviews`**, and there is no `key_moments` table | additive only; no `DROP`, no `NOT NULL` without a default. New enum types (`MistakeSource`, `TrainingDeck`, …) are created and first written in the same release: no older client reads those tables, so the two-release rule does not apply to them. `ReportTarget` already holds P10's values (`USER`, `GAME`, …), so P10 needs no `ADD VALUE` |

Raw SQL appended to `m5_training` (Prisma cannot express it; listed in `PKG/db/prisma/protected-indexes.txt` so `scripts/db/check-drift.ts` fails CI if a generated migration tries to drop it):

```sql
CREATE INDEX IF NOT EXISTS training_attempts_puzzle_idx ON training_attempts ("userId", "puzzleId") WHERE "puzzleId" IS NOT NULL;
-- the worker role's grants live in P3's DB/scripts/roles/replay_worker.sql (run per branch after the role exists), not here
ALTER TABLE training_days     SET (fillfactor = 80);   -- HOT updates: counters change, the PK does not
ALTER TABLE theme_mastery     SET (fillfactor = 80);
ALTER TABLE training_profiles SET (fillfactor = 80);
ALTER TABLE training_sessions ALTER COLUMN items SET COMPRESSION lz4;
ALTER TABLE training_days     ALTER COLUMN plan  SET COMPRESSION lz4;
```

**Procedure** (dm §11.2; alloc §1.3; CLAUDE.md):

1. Edit `schema.prisma`. Generate SQL against a **local Docker shadow** (no Neon involved): `docker run -d --rm --name rc-shadow -e POSTGRES_PASSWORD=pw -p 55433:5432 postgres:17-alpine`, then `pnpm --filter @repo/db exec prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url postgresql://postgres:pw@localhost:55433/postgres --script > prisma/migrations/<ts>_m5_training/migration.sql`.
2. Hand-add `SET lock_timeout` and the raw SQL. Drift check: `scripts/db/check-drift.ts` + `PKG/db/prisma/protected-indexes.txt` (P2's gate, which replaces P1's raw `migrate diff --exit-code`, consistency R-10).
3. Verify locally: `prisma migrate deploy` from scratch on the Docker Postgres 17, seed, `pnpm --filter web check-types`, unit + contract tests, the index existence check (§6.5).
4. Apply to the **Neon dev branch named in CLAUDE.md** with `prisma migrate deploy` and that branch's `DIRECT_URL`; then run `DB/scripts/roles/replay_worker.sql` (adds the P5 grants). **Never `prisma migrate dev` and never `db push` against any Neon branch** (consistency R-20: `db push` would drop the hand-written partial index and storage settings; CLAUDE.md rule 1 still says `db push` for prod, which is an open owner decision, D-18). M5 contains no destructive statement; if any command ever could reset or drop, stop and ask the owner first ("This command may reset/drop your database. Are you sure?", CLAUDE.md rule 5).
5. Production receives M5 in P13 through `prisma migrate deploy` after a rehearsal on a child branch of `production` (dm §11.2 step 6). P5 does not touch `production`.
6. Rollback = redeploy the previous code; the expand migration stays (dm §11.5). No down-migration.

### 6.7 Backfills and dev seed

| Script | What | Rules |
|---|---|---|
| `WEB/scripts/backfill/enqueue-mistake-extraction.ts` (B-M5-1) | `INSERT INTO jobs (kind, "dedupeKey", priority, "fairSeq", payload, "userId") SELECT 'EXTRACT_MISTAKES', 'extract:' \|\| gp."gameId" \|\| ':' \|\| gp."userId" \|\| ':v1', $JOB_PRIORITY_BACKLOG, row_number() OVER (PARTITION BY gp."userId" ORDER BY gp."endedAt" DESC), jsonb_build_object('v', 1, 'gameId', gp."gameId", 'userId', gp."userId"), gp."userId" FROM game_players gp JOIN games g ON g.id = gp."gameId" WHERE g."analysisStatus" = 'DONE' AND gp."bankVersion" < 1 AND (gp."gameId", gp."userId") > ($lastGameId, $lastUserId) ORDER BY gp."gameId", gp."userId" LIMIT 500 ON CONFLICT ("dedupeKey") DO NOTHING`, repeated per keyset batch, then one kick. `$JOB_PRIORITY_BACKLOG` = `JOB_PRIORITY.BACKLOG` imported from `PKG/db/src/jobs.ts`; `fairSeq` interleaves members (consistency 5.2, R-05) | `--dry-run` default, `--apply` writes; refuses unless the `DATABASE_URL` host is in `BACKFILL_ALLOWED_HOSTS`; writes one `audit_logs` row (`SYSTEM`, `backfill.mistake_extraction`, counts; `AuditLog` ships in M4, consistency R-04). Runs only after P1 has moved dev to its own Neon project (api-perf AP-01), because a backlog drain keeps the compute awake for hours. Verification: 0 rows match the predicate after the queue drains; spot-check 10 games (each key-moment error ply has a `MistakeOccurrence`, the ones not in `bankOptOut` a card) |
| `WEB/scripts/backfill/recount-bank-themes.ts` (B-M5-2, repair tool) | `UPDATE theme_mastery SET "bankCount" = x.n FROM (SELECT "userId", theme, count(*) n FROM training_cards WHERE deck='BANK' GROUP BY 1,2) x …` + zero the missing | idempotent; same guards |
| — | `TrainingProfile`, `TrainingDay` | created lazily; no backfill |

**Dev seed** (`WEB/prisma/seed/fixtures.ts` + `personas.ts`, dm §13.3–13.5; guarded by `SEED_TARGET=dev` + `DEV_DB_HOSTS`, upserts, never `TRUNCATE`). Training state is generated with mulberry32 seed 42 **relative to `now()` at seed time**, so "due today" is due on the day the seed runs:

| Persona | Training data | Boards it exercises |
|---|---|---|
| `member` | 41 bank cards from the design positions (`DR/V3MistakeBank.dc.html` `ALL` rows + `DR/V3BankSession.dc.html` P[]), due spread −3…+14 days, mastery 0–5, 4 due now; attempts for the last 9 days (streak 4, best 9); `theme_mastery` matching (Forks 62 %, Loose pieces 55 %, Back rank 40 %, Pins 18 %); today's frozen plan; puzzle rating 1512 | `V3Home` populated, `V3TrainHub`, `V3MistakeBank` default/filtered, `V3BankSession`, `V3PuzzleSolve`…, `V3SessionSummary` |
| `caughtup` | `training_days.bankReviewed = 10` today, every due card graded, future dues over 7 days (6 / 3 / 5 / 9) | `V3BankCaughtUp`, `V3TrainHubDone` |
| `trial` | P4 import RUNNING 212/480, 6 due cards | `V3Home` `import_running` + `trial` |
| `new` | nothing | `V3HomeNewUser`, `V3BankEmpty`, new-user hub |
| `perfect` (P5 adds) | one COMPLETED 5-item session, all first try, crossing forks 70 % | `V3SessionPerfect` |

E2E does not use the dev personas above. Specs that need an exact state **lease** a pool user (P1 `leasePersona(name)`, testing X4) and P5's writer `WEB/e2e/personas/p5.ts` resets it: `bank-member` (41 cards, 4 due, streak 4), `bank-empty` (no cards, one unreviewed analysed game, no linked account), `bank-caughtup` (cap reached, future dues 6/3/5/9), `puzzles-fresh` (no puzzle attempts, rating seeded 1512), `outbox`, `two-tabs` (one due card each), `train-plan` (3 due cards from one game, plan not yet built today), `day-rollover` (time zone `America/New_York`, 2 cards due at the next 08:00), `home-new` (no games, no cards, no linked account, no import). The writer uses the same fixtures and guards as `seed-training.ts` and runs relative to the spec's `serverNow`. Shared members A–P only gain data (a spec may create a game or grade a card on them, and never asserts an absolute count).

---

## 7. API

All routes use the P1 wrapper `route({ id, auth, params, query, body, response, cache, rateLimit, maxBodyBytes, idempotent }, handler)` from `WEB/lib/api/route.ts` (alloc F1, api §2.5): request id, viewer via `getViewer()` (memoised), zod input (400 `validation_failed` with `fields`), body limit (413), rate limit (429 + `Retry-After`), idempotency, envelope `{ data, meta? }` / `{ error: { code, message, fields?, retryAfterSec?, requestId } }` (B16), BigInt-safe serialiser, Sentry span `api <id>`, `Server-Timing`. Responses are validated against the schema in dev/test (`ROUTE_VALIDATE_RESPONSES=1`) only. Every route exports `maxDuration = 10` and runs on the Node runtime in `iad1` next to Neon (opt §3.1). Every P5 route is **`auth: "member"`** (otherwise 402 `subscription_required` with `details.reason` from `SUBSCRIPTION_REASONS`, or 402 `payment_update_required`); owner-scoped refs answer **404** for another user's resource (api §2.6 mapping rule). Cache tier for every P5 route: **`no-store`** (`Cache-Control: private, no-store`), because due counts must never be stale across tabs (rct-b §4.0); no P5 response ever carries `max-age > 0` (api-perf AP-04), which the registry cache-tier lint enforces. Every handler receives **`ctx.now`** and passes it to the service; services never call `Date.now()` or `new Date()` (ESLint `no-restricted-syntax` on `lib/train/**`, `lib/home/**`, `lib/reports/**`) and SQL binds `$now` (§0): every predicate on `due`, `suspendedUntil`, `startedAt`, `reviewedAt` or `createdAt` windows uses `$now`, and inserts set the business timestamps (`startedAt`, `endedAt`, `reviewedAt` clamping, `lastReview`, `due`, `hiddenAt`) from it; only the audit columns `createdAt`/`updatedAt` keep the database clock. GET routes are side-effect free except R1, whose registry entry declares `sideEffects: ["daily_plan"]`.

### 7.1 Contracts (`CT/http/train.ts`, `home.ts`, `reports.ts`, `CT/socket/user.ts`; zod 4)

```ts
import { z } from "zod";
import { Ref, Uci, DayKey, Cursor, Limit, FenLoose, Color } from "./common";   // P1 primitives

// ── shared ──────────────────────────────────────────────────────────────────
export const ItemKey     = z.string().regex(/^[mpo]_[A-Za-z0-9]{1,24}$/);     // card API ref
export const ThemeKey    = z.string().regex(/^(rc:)?[A-Za-z0-9]{2,30}$/);     // Lichess keys + rc:* (§8.11)
export const Grade       = z.enum(["again", "hard", "good", "easy"]);
export const ItemKind    = z.enum(["mistake", "review_position", "puzzle", "opening_line"]);
export const JudgementW  = z.enum(["inaccuracy", "mistake", "miss", "blunder"]);
export const PhaseW      = z.enum(["opening", "middlegame", "endgame"]);
export const SessionKindW = z.enum(["daily", "bank", "puzzles", "weakness", "practice"]);
export const SessionSource = z.enum(["hub", "plan", "bank", "review_complete", "summary", "nav", "solve_one", "home", "picker", "deeplink"]);
export const IsoDT       = z.iso.datetime();
export const ThemeRef    = z.object({ key: ThemeKey, label: z.string().max(40) });
export const NextBatch   = z.object({ at: IsoDT, atLabel: z.string().max(24), count: z.number().int().min(0) });
export const IntervalPreview = z.object({ label: z.string().max(12) /* "< 10 min", "4 days" */, due: IsoDT, days: z.number() });
export const LessonCard  = z.object({ slug: z.string().max(80), title: z.string().max(80), minutes: z.number().int(), href: z.string().startsWith("/").max(200) });  // slot filled by P8; always null in P5

// ── R1 GET /api/train/today ────────────────────────────────────────────────
export const PlanStep = z.object({
  kind: z.enum(["bank", "puzzles", "lesson", "review", "import"]),
  title: z.string().max(80), subtitle: z.string().max(80), estMin: z.number().int().min(1).max(60),
  status: z.enum(["due", "next", "done"]), href: z.string().startsWith("/").max(200),
});
export const TrainToday = z.object({
  dayKey: DayKey, weekdayLabel: z.string(), plannedMinutes: z.number().int(),
  state: z.enum(["default", "nothingdue"]),
  streak: z.object({ current: z.number().int(), best: z.number().int(), week: z.array(z.boolean()).length(7), aria: z.string() }),
  plan: z.object({
    steps: z.array(PlanStep).max(3), done: z.number().int(), total: z.number().int(),
    basis: z.enum(["bank", "games20", "new"]),
    cta: z.object({ kind: z.enum(["start", "continue", "keep_going"]), label: z.string(), href: z.string().nullable() }),
    footnote: z.string(),
  }),
  due: z.object({
    shown: z.number().int(), raw: z.number().int(), capRemaining: z.number().int(), cap: z.number().int(),
    waitingLine: z.string().nullable(),                                        // "6 more wait for tomorrow. FSRS keeps it to 10 a day."
    preview: z.array(z.object({ cardRef: ItemKey, fen: FenLoose, orient: Color, lastMove: z.tuple([z.string(), z.string()]).nullable(),
                                themeLabel: z.string(), opponent: z.string(), moveNo: z.number().int(), label: z.string() })).max(4),
  }),
  nextBatch: NextBatch.nullable(),
  allTraining: z.object({
    bank: z.object({ due: z.number().int(), total: z.number().int() }),
    puzzles: z.object({ themes: z.array(z.object({ key: ThemeKey, label: z.string(), pct: z.number().int().nullable() })).max(3) }),
  }),
  mastery: z.array(z.object({ key: ThemeKey, label: z.string(), pct: z.number().int() })).max(4),
  keepGoing: z.object({ href: z.string(), label: z.string() }).nullable(),
  puzzleRating: z.object({ value: z.number().int(), provisional: z.boolean() }),
  prefs: z.object({ timeZone: z.string(), dayStartHour: z.number().int(), releaseHour: z.number().int() }),
});

// ── R2 GET /api/train/bank ─────────────────────────────────────────────────
export const BankQuery = z.object({
  view: z.enum(["due", "all"]).default("all"),
  theme: ThemeKey.optional(), phase: PhaseW.optional(), source: z.enum(["own", "missed"]).optional(),
  cursor: Cursor, limit: Limit(50, 50),
});
export const BankRow = z.strictObject({                                       // strict: no bestSan/solution can ever be added by accident
  cardRef: ItemKey, mistakeRef: Ref, fen: FenLoose, orient: Color, lastMove: z.tuple([z.string(), z.string()]).nullable(),
  theme: ThemeRef, judgement: JudgementW, playedSan: z.string().max(10), moveNo: z.number().int(),
  opponent: z.string().max(40), playedAtLabel: z.string(), phase: PhaseW, source: z.enum(["own", "missed"]),
  mastery: z.number().int().min(0).max(5), isDue: z.boolean(), nextLabel: z.string().nullable(), skippedToday: z.boolean(),
  occurrences: z.number().int().min(1), gameRef: Ref, gamePly: z.number().int().nullable(),   // "See It in Your Game" → /review/{gameRef}?ply={gamePly}
});
const Facet = z.object({ key: z.string(), label: z.string(), n: z.number().int() });
export const BankPage = z.object({
  state: z.enum(["empty", "caughtup", "default"]),
  counts: z.object({ due: z.number().int(), dueRaw: z.number().int(), all: z.number().int(), capRemaining: z.number().int() }),
  rows: z.array(BankRow).max(300),
  facets: z.object({ theme: z.array(Facet), phase: z.array(Facet), source: z.array(Facet) }),
  upcoming: z.array(z.object({ label: z.string(), n: z.number().int() })).max(4),
  nextBatch: NextBatch.nullable(),
  focusTheme: ThemeRef,
  emptyCtas: z.object({ lastGame: z.object({ gameRef: Ref, opponent: z.string(), reviewed: z.boolean() }).nullable(), hasLinkedAccount: z.boolean() }).nullable(),
  lesson: LessonCard.nullable(),                                               // caught-up lesson card slot (P8, coverage C-06)
});
export const BankNextPage = z.object({ rows: z.array(BankRow).max(50) });      // pages 2+ (cursor present): rows only, no counts/facets (api-perf AP-38)
// envelope meta: { nextCursor: string | null, complete: boolean }   (complete = every row of the bank is in this page)

// ── W2 POST /api/train/sessions ────────────────────────────────────────────
export const BankFilterIn = z.strictObject({ theme: ThemeKey.optional(), phase: PhaseW.optional(), source: z.enum(["own", "missed"]).optional() });
export const SessionCreate = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("daily"), source: SessionSource.default("plan") }),
  z.strictObject({ kind: z.literal("bank"), source: SessionSource, filter: BankFilterIn.optional(),
                   cardRefs: z.array(ItemKey).min(1).max(20).optional(), gameRef: Ref.optional(), practice: z.boolean().default(false) }),
  z.strictObject({ kind: z.literal("puzzles"), source: SessionSource, theme: ThemeKey.optional(), count: z.number().int().min(1).max(10).optional() }),
  z.strictObject({ kind: z.literal("practice"), fromSessionRef: Ref }),
  // { kind: "weakness", pattern, size: 10|20, mix } is added by P6
]);
export const TrainItem = z.object({
  itemId: z.string().max(8), kind: ItemKind, pass: z.union([z.literal(1), z.literal(2)]),
  cardRef: ItemKey.nullable(), puzzleId: z.string().max(8).nullable(),
  fen: FenLoose,                                       // start position (puzzles: before the setup move)
  setup: z.array(Uci).max(1),                          // puzzles: [opponent move], auto-played 400 ms; bank: []
  lastMove: z.tuple([z.string(), z.string()]).nullable(),
  solution: z.array(Uci).min(1).max(15),               // after setup: user, reply, user…
  accept: z.array(Uci).max(6),                         // alternatives for the first user move
  orient: Color, theme: ThemeRef, rating: z.number().int().nullable(), sourceLabel: z.string().max(80),
  context: z.object({ gameRef: Ref, gamePly: z.number().int().nullable(), gameLabel: z.string(), playedUci: Uci,
                      playedSan: z.string(), judgement: JudgementW, costText: z.string() }).nullable(),
  text: z.object({ hint: z.string(), look: z.string().nullable(), correct: z.string(), wrongGameMove: z.string().nullable(), verified: z.boolean() }),
  preview: z.record(Grade, IntervalPreview).nullable(),   // null = practice item (no FSRS effect)
  previewAfterAgain: z.record(Grade, IntervalPreview).nullable(),   // labels for the pass-2 copy after an Again (computed at build; keeps ts-fsrs off the client)
  cardReps: z.number().int().nullable(), mastery: z.number().int().nullable(),
});
export const ThemeOption = z.object({ key: ThemeKey, label: z.string(), group: z.enum(["recommended", "tactics", "material", "mates", "defence", "special", "endgames"]),
  pct: z.number().int().nullable(), attempts: z.number().int(), available: z.number().int(), recommended: z.boolean() });
export const SessionPayload = z.object({
  ref: Ref, kind: SessionKindW, status: z.enum(["active", "completed", "abandoned"]),
  theme: ThemeRef.nullable(), items: z.array(TrainItem).max(40), resumeIndex: z.number().int(),
  queueLabels: z.array(z.object({ itemId: z.string(), label: z.string() })).max(40),     // "tal_fan_77 · move 17 · Recapture first"
  header: z.object({ title: z.enum(["Mistake Bank", "Puzzles", "Weakness drill", "Practice"]), solveStreak: z.number().int(),
    rating: z.object({ value: z.number(), rd: z.number(), vol: z.number(), provisional: z.boolean() }).nullable() }),
  capRemaining: z.number().int().nullable(), countsTowardCap: z.boolean(),
  stream: z.boolean(), targetCount: z.number().int().nullable(),                         // puzzles: extend while stream && !targetCount
  themes: z.array(ThemeOption).nullable(), widened: z.object({ from: z.number().int(), to: z.number().int() }).nullable(),
  empty: z.enum(["caughtup", "cap_reached", "nothing_matches"]).nullable(),               // 201 with no items instead of an error
});

// ── W3 extend · W4 end · R3 get ────────────────────────────────────────────
export const ExtendBody   = z.strictObject({ after: z.string().max(8) });                 // itemId of the last item the client has
export const ExtendResult = z.object({ items: z.array(TrainItem).max(10), stream: z.boolean() });
export const EndBody      = z.strictObject({ reason: z.enum(["done", "user", "timeout"]) });
export const SessionQuery = z.object({ include: z.enum(["items", "summary"]).default("items") });
export const SessionSummary = z.object({
  ref: Ref, variant: z.enum(["default", "perfect"]), kind: SessionKindW,
  eyebrow: z.string(), title: z.string(), subtitle: z.string(),
  stats: z.object({ solved: z.number().int(), total: z.number().int(), firstTry: z.number().int(), withHint: z.number().int(), skipped: z.number().int() }),
  grades: z.array(z.object({ grade: Grade, n: z.number().int(), intervalLabel: z.string() })).length(4),
  themes: z.array(z.object({ key: ThemeKey, label: z.string(), n: z.number().int() })).max(8),
  milestone: z.object({ kind: z.enum(["theme", "perfect", "streak"]), label: z.string() }).nullable(),
  rating: z.object({ value: z.number().int(), delta: z.number().int() }).nullable(),
  next: z.object({ puzzles: z.object({ href: z.string(), note: z.string() }), lesson: LessonCard.nullable() /* slot: P8 fills, coverage C-05 */ }),
  graded: z.number().int(),                                                                 // the client compares with ?n= for "Saving…"
});

// ── W1 POST /api/train/attempts ────────────────────────────────────────────
export const AttemptIn = z.strictObject({
  clientAttemptId: z.uuid(), sessionRef: Ref.nullable(), itemId: z.string().max(8).nullable(),
  cardRef: ItemKey.nullable(), puzzleId: z.string().regex(/^[A-Za-z0-9]{5,8}$/).nullable(), kind: ItemKind,
  solved: z.boolean(), firstTry: z.boolean(), hintsUsed: z.number().int().min(0).max(2),
  wrongMovesUci: z.array(Uci).max(10), solutionShown: z.boolean(), timeMs: z.number().int().min(0).max(3_600_000),
  grade: Grade.nullable(), suggestedGrade: Grade, cardReps: z.number().int().min(0).nullable(),
  reviewedAt: IsoDT, stale: z.boolean().optional(),
}).refine((a) => a.cardRef !== null || (a.puzzleId !== null && a.sessionRef !== null), { message: "cardRef, or puzzleId with sessionRef" });
export const AttemptsBody = z.strictObject({ attempts: z.array(AttemptIn).min(1).max(50) });
export const AttemptOut = z.object({
  clientAttemptId: z.uuid(), status: z.enum(["ok", "duplicate", "conflict", "rejected"]),
  reason: z.enum(["too_old", "not_found", "bad_item"]).optional(),
  card: z.object({ ref: ItemKey, due: IsoDT, dueLabel: z.string(), mastery: z.number().int(), reps: z.number().int(),
                   scheduled: z.boolean() /* false = practice, no reschedule */, requeued: z.boolean() }).optional(),
  rating: z.object({ value: z.number().int(), delta: z.number().int(), provisional: z.boolean() }).optional(),
  solveStreak: z.number().int().optional(), dayStreak: z.number().int().optional(),
  theme: z.object({ key: ThemeKey, pct: z.number().int().nullable(), milestone: z.union([z.literal(50), z.literal(70), z.literal(90)]).optional() }).optional(),
});
export const AttemptsResult = z.object({ results: z.array(AttemptOut), capRemaining: z.number().int(), planDone: z.number().int(), bankDue: z.number().int() });

// ── W5 skip · W6 remove · W8 prefs · R4 themes · R8 badges ────────────────
export const SkipBody    = z.strictObject({ sessionRef: Ref.nullable() });
export const SkipResult  = z.object({ suspendedUntil: IsoDT, label: z.string() });       // "Tomorrow"
export const TrainPrefsPatch = z.strictObject({                               // the only writer of training prefs (consistency 10.5 a)
  timeZone: z.string().max(64).refine(isIanaTimeZone, "Unknown time zone").optional(),
  dayStartHour: z.number().int().min(0).max(6).optional(), releaseHour: z.number().int().min(5).max(12).optional(),
  bankDailyCap: z.number().int().min(5).max(30).optional(), newPerDay: z.number().int().min(0).max(30).optional(),
  autoGrade: z.boolean().optional(),
}).refine((p) => Object.keys(p).length > 0, "empty patch");                  // newPerDay ≤ bankDailyCap checked against the stored row
export const TrainPrefs  = z.object({ timeZone: z.string(), dayStartHour: z.number().int(), releaseHour: z.number().int(),
  bankDailyCap: z.number().int(), newPerDay: z.number().int(), autoGrade: z.boolean() });
export const ThemesResult = z.object({ options: z.array(ThemeOption), rating: z.number().int() });
export const Badges      = z.object({ bankDue: z.number().int(), trainDot: z.boolean() }); // P6 adds weaknessReady, P10 notificationsUnread

// ── A6 PATCH /api/review/[ref]/moments/[ply] (P3 contract, now live) ───────
export const MomentBankBody = z.strictObject({ inBank: z.boolean() });
export const MomentBankOut  = z.object({ ply: z.number().int(), inBank: z.boolean(),
  card: z.object({ ref: ItemKey, dueAt: IsoDT, dueLabel: z.string() }).nullable() });   // null while the game is not extracted yet, or inBank = false

// ── P3 review DTO fields that P5 fills (P3 owns the schemas; P5 widens the reserved fields) ──
export const MomentBank   = z.object({ inBank: z.boolean(), card: z.object({ ref: ItemKey, dueLabel: z.string() }).nullable() });   // MomentDTO.inBank + MomentDTO.card
export const ReviewBank   = z.object({ count: z.number().int().min(0), plies: z.array(z.number().int()).max(4) });              // ReviewStatusDTO.bank (was z.null())

// CT/socket/user.ts additions
export const BankAdded    = z.object({ count: z.number().int().min(0), plies: z.array(z.number().int()).max(4) });
// AnalysisDone  += { bankAdded: BankAdded.nullable(), bankDue: z.number().int().nullable() }   (null when the flag is off or nothing was extracted)
// AnalysisBatch += { bankAdded: z.number().int(), bankDue: z.number().int() }
export const BankDueChanged = z.object({ v: z.literal(1), bankDue: z.number().int(), dueRaw: z.number().int(), total: z.number().int(), nextAt: IsoDT.nullable() });
export const MistakesAdded  = z.object({ v: z.literal(1), games: z.number().int(), added: z.number().int(), cardsAdded: z.number().int(), total: z.number().int(), bankDue: z.number().int() });

// CT/http/home.ts ── HOME-1 GET /api/home ───────────────────────
export const HomeData = z.object({
  state: z.enum(["populated", "new_user"]),
  greeting: z.object({ part: z.enum(["morning", "afternoon", "evening"]), name: z.string() }),
  stats: z.object({ gamesThisWeek: z.number().int() }),                                   // P9 adds ratingLabel
  continue: z.object({
    kind: z.enum(["moments", "clean", "analysing"]), gameRef: Ref, fen: FenLoose, orient: Color,
    lastMove: z.tuple([z.string(), z.string()]).nullable(), opponent: z.string(), opponentRating: z.number().int().nullable(),
    result: z.enum(["win", "loss", "draw"]), endMove: z.number().int(), openingName: z.string().nullable(), whenLabel: z.string(),
    keyMomentCount: z.number().int(), accuracy: z.number().int().nullable(),
    analysis: z.object({ status: z.enum(["queued", "running", "done", "failed"]), done: z.number().int(), total: z.number().int() }),
  }).nullable(),
  startHere: z.object({ href: z.string(), fen: FenLoose, orient: Color, title: z.string(), blurb: z.string(), ariaLabel: z.string() }).nullable(),
  bank: z.object({ due: z.number().int(), total: z.number().int(), estMin: z.number().int(),
    topTheme: z.object({ label: z.string(), n: z.number().int() }).nullable(),
    thumbs: z.array(z.object({ cardRef: ItemKey, fen: FenLoose, orient: Color, label: z.string() })).max(4), nextBatch: NextBatch.nullable() }),
  week: z.object({ days: z.array(z.boolean()).length(7), games: z.number().int(), puzzles: z.number().int(), aria: z.string() }),
  recent: z.array(z.object({ gameRef: Ref, result: z.enum(["win", "loss", "draw"]), opponent: z.string(),
                             opponentRating: z.number().int().nullable(), chip: z.string().nullable(), dateLabel: z.string() })).max(8),
  import: z.object({ provider: z.enum(["chesscom", "lichess"]), imported: z.number().int(), total: z.number().int().nullable(), etaSec: z.number().int().nullable() }).nullable(),
  hasLinkedAccount: z.boolean(),
});

// CT/http/reports.ts ── W7 POST /api/reports (api SYS-6) ─────────
export const ReportBody = z.strictObject({
  targetType: z.enum(["mistake", "puzzle"]),            // P10 adds "user" and "game" (discriminated branches in the same handler); later phases add coach_answer, lesson, position
  targetRef: z.string().max(64), reason: z.enum(["wrong_solution", "better_move", "illegal_move", "text_wrong", "other"]),
  note: z.string().max(500).optional(), fen: FenLoose,
});
export const ReportResult = z.object({ ref: Ref, duplicate: z.boolean() });
```

`CT/http/train.size.test.ts` serialises fixtures and asserts the gzip budgets of §9.4.

### 7.2 Endpoint catalogue

Columns: RL = rate limit as P1's fixed window `limit / windowSec` (consistency R-13). `burst` = P1's `UNLOGGED` bucket (one statement; allowed only for windows ≤ 60 s); `durable` = counted from the route's own source rows inside a statement the route runs anyway, so a Neon suspend cannot reset it (api-perf AP-11). Idem = idempotency mechanism; Class = opt §2.1 endpoint class and its server-time SLO.

| ID | Method · path | Request → `data` | Errors (beyond the implied 400/401/402/413/429/5xx) | RL | Idem | Body max | Class |
|---|---|---|---|---|---|---|---|
| R1 (TR-1) | `GET /api/train/today` | — → `TrainToday` | — | — | (lazy plan write is `ON CONFLICT`; registry `sideEffects: ["daily_plan"]`) | — | R1 (p95 ≤ 100 ms) |
| R2 (TR-2) | `GET /api/train/bank` | `BankQuery` → first request (no `cursor`): `BankPage` + `meta {nextCursor, complete}`; later pages: `BankNextPage` + `meta {nextCursor}` (no counts, facets or upcoming, api-perf AP-38) | 400 `validation_failed` (`details.reason: "cursor_filter_mismatch"`) | — | — | — | R2 (p95 ≤ 160 ms) |
| R3 (TR-3) | `GET /api/train/sessions/{ref}` | `SessionQuery` → `SessionPayload` \| `SessionSummary` | 404 | — | — | — | R2 |
| R4 (TR-4) | `GET /api/train/themes` | — → `ThemesResult` | — | — | — | — | R1 |
| R8 (ME-2) | `GET /api/me/badges` | — → `Badges` | — | — | — | — | R1 |
| HOME-1 | `GET /api/home` | — → `HomeData` | — | — | — | — | R1 |
| W1 (TR-6) | `POST /api/train/attempts` | `AttemptsBody` → `AttemptsResult` (per-item statuses; a 402 rejects the whole batch) | — | `train-write` 120 / 60 s (burst) | natural: `clientAttemptId` (unique) + `cardReps` guard | 64 KB | W1 (p95 ≤ 150 ms) |
| W2 (TR-7) | `POST /api/train/sessions` | `SessionCreate` → 201 `SessionPayload` (200 when an ACTIVE session is reused or the key is replayed) | 404 (`cardRefs`/`gameRef`/`fromSessionRef` not the viewer's), 422 `idempotency_key_reused`, 429 `rate_limited` (`details.reason: "daily_puzzle_limit"` or the session limit), 502 `upstream_unavailable` (shards) | `train-session` 30 / 3600 s (durable: the `n1h` count in the reuse statement, §6.5; a reuse is not counted) | header `Idempotency-Key` (required) + ACTIVE reuse by `filterKey` < 2 h | 16 KB | W2 (p95 ≤ 250 ms BANK; ≤ 400 ms PUZZLES with a cold shard) |
| W3 (TR-8) | `POST /api/train/sessions/{ref}/extend` | `ExtendBody` → `ExtendResult` | 404; 409 `conflict` (`details.reason: "session_ended"`); 429 daily limit; 502 | `train-write` (burst) + the daily puzzle cap (durable, `training_days.puzzlesDone`) | natural: `after` (a repeat returns the items already appended after it) | 4 KB | W2 |
| W4 (TR-9) | `POST /api/train/sessions/{ref}/end` | `EndBody` → `SessionSummary` | 404 | — | natural (a second call returns the same summary) | 1 KB | W1 |
| W5 (TR-10) | `POST /api/train/cards/{ref}/skip` | `SkipBody` → `SkipResult` | 404 | `train-write` | natural (sets the same `suspendedUntil`) | 1 KB | W1 |
| W6 (TR-11) | `DELETE /api/train/cards/{ref}` | — → 204 | 404 (not the viewer's) | `train-write` | natural (already removed → 204) | — | W1 |
| W7 (SYS-6) | `POST /api/reports` | `ReportBody` → 201 `ReportResult` (200 + `duplicate: true` if the same viewer reported the same target in the last 24 h) | 404 (target not visible to the viewer) | `report-burst` 5 / 60 s (burst) + `report` 20 / 86400 s (durable: `reports_reporterId_createdAt_idx` count) | header `Idempotency-Key` | 4 KB | W1 |
| W8 | `PATCH /api/train/prefs` | `TrainPrefsPatch` → `TrainPrefs` | 400 `validation_failed` (`details.reason: "new_per_day_above_cap"`) | `train-write` | natural | 1 KB | W1 |
| A6 (P3) | `PATCH /api/review/{ref}/moments/{ply}` | `MomentBankBody` → `MomentBankOut` | 404 (not a player, or `ply` is not one of the game side's moments, or the moment is not an error) | P3's `review-write` (unchanged) | natural (set semantics) | 1 KB | W1 |

### 7.3 Server algorithms (services in `WEB/lib/train/*.server.ts`; statements after `getViewer()`)

**R1 `getTrainToday(viewer)`** (`today.server.ts`): compute `dayKey = localDay(now, tz, dayStartHour)`, `monday`, `nextRelease` in TS (`PKG/chess-training/src/release.ts`). Then **one parallel batch** (`Promise.all`, 5 statements, 1 round trip on the pooled connection):

```sql
-- (a) due summary on training_cards_userId_deck_due_idx; $2 = nextRelease instant
SELECT count(*) FILTER (WHERE due <= $now AND state <> 'NEW' AND NOT skipped)::int AS due_review,
       count(*) FILTER (WHERE due <= $now AND state =  'NEW' AND NOT skipped)::int AS due_new,
       count(*)::int                                                         AS total,
       min(due)  FILTER (WHERE due > $now)                                  AS next_at,
       count(*) FILTER (WHERE due > $now AND due <= $2)::int                AS next_batch
FROM (SELECT due, state, ("suspendedUntil" IS NOT NULL AND "suspendedUntil" > $now) AS skipped
      FROM training_cards WHERE "userId" = $1 AND deck = 'BANK') c;
-- (b) week strip + today's caps and frozen plan (PK range, ≤ 7 rows)
SELECT day, "bankReviewed", "newIntroduced", "puzzlesDone", "lessonsDone", plan, "planDone" FROM training_days WHERE "userId" = $1 AND day >= $monday ORDER BY day;
-- (c) due preview (≤ 4) joined to the mistake by PK
SELECT c."itemKey", m.fen, m."setupUci", m.color, m."primaryTheme", m."lastOpponentName", m."moveNumber"
FROM training_cards c JOIN mistakes m ON m.id = c."mistakeId"
WHERE c."userId" = $1 AND c.deck = 'BANK' AND c.due <= $now AND (c."suspendedUntil" IS NULL OR c."suspendedUntil" <= $now)
ORDER BY c.due, c.id LIMIT 4;
-- (d) theme mastery (< 60 rows, PK prefix)      (e) training profile (PK)
```

If today's row has no plan: one extra read (the ≤ 50 due cards of W2's BANK query, with `lastGameId`, `lastPlayedAt`, `lastOpponentName`), `buildDailyPlan()` in TS (§8.10), and one write batch `$transaction([upsertPlan, upsertProfile])`:

```sql
INSERT INTO training_days ("userId", day, plan, "updatedAt") VALUES ($1, $day, $plan::jsonb, now())
ON CONFLICT ("userId", day) DO UPDATE SET plan = COALESCE(training_days.plan, EXCLUDED.plan) RETURNING plan, "planDone";
INSERT INTO training_profiles ("userId", "puzzleRating", "puzzleRd", "ratingSeeded", "updatedAt") VALUES ($1, $seed, 250, true, now())
ON CONFLICT ("userId") DO NOTHING;
```

`COALESCE` keeps the first plan when two tabs race. Round trips: viewer + 1 (+ 2 once a day).

**R2 `listBank(viewer, filter, cursor)`** (`bank.server.ts`): due summary (a) in parallel with

```sql
SELECT c."itemKey", c.due, c.mastery, c.theme, c.phase, c."suspendedUntil", c.state,
       m."referenceId", m.fen, m."setupUci", m.color, m.judgement, m.source, m."playedUci", m."moveNumber",
       m."lastOpponentName", m."lastPlayedAt", m."lastPly", m.occurrences, g."referenceId" AS "gameRef"
FROM training_cards c
JOIN mistakes m ON m.id = c."mistakeId"
LEFT JOIN games g ON g.id = m."lastGameId"          -- PK; no player_reviews / content read (no TOAST detoast per row)
WHERE c."userId" = $1 AND c.deck = 'BANK' AND m."hiddenAt" IS NULL
  [AND c.theme = $theme] [AND c.phase = $phase] [AND m.source = $source] [AND c.due <= $now]   -- only on the paged path
  [AND (c.due, c.id) > ($cursorDue, $cursorId)]
ORDER BY c.due, c.id
LIMIT $n + 1;      -- $n = 300 on the first request, 50 on paged requests
```

`gamePly` = `m."lastPly"`; the "See It in Your Game" link is `/review/{gameRef}?ply={gamePly}&from=bank` and P3's review maps a moment ply to its moment view (rev 1 joined `key_moments` for a `momentOrd`; that table does not exist, and reading `player_reviews.content` per row would detoast ≈ 3 KB of JSON for each of up to 300 rows).

If the first request returns ≤ 300 rows, the page is `complete` (every row, filters applied on the client; facets, upcoming and labels computed in TS from the rows). Otherwise the server pages by 50 with the filters applied in SQL; the **first** request also computes facets with one statement, and requests with a `cursor` return rows only (api-perf AP-38):

```sql
SELECT c.theme, c.phase, m.source, count(*)::int
FROM training_cards c JOIN mistakes m ON m.id = c."mistakeId"
WHERE c."userId" = $1 AND c.deck = 'BANK' AND m."hiddenAt" IS NULL
GROUP BY GROUPING SETS ((c.theme), (c.phase), (m.source));
```

`playedSan` is computed in TS from `fen + setupUci + playedUci` with chess.js (≈ 0.05 ms per row). The cursor is `"v1." + base64url([due, id, filterHash])` (opt §3.4); a filter change with an old cursor → 400. `state`: `empty` if total = 0, `caughtup` if `dueShown = 0`, else `default`. `upcoming`: per local day for the next 6 days (non-zero only), then "Next week" (days 7–13), max 4 rows.

**W2 `createSession(viewer, spec, idemKey)`** (`sessions.server.ts`):

1. Idempotency reservation (P2's `idempotency_keys` table, M2i, through P1's helper; api §2.8) — a replay returns the stored response with `Idempotent-Replayed: true`.
2. `filterKey = sha256(canonical(spec)).slice(0, 32)`; ACTIVE reuse **and** the durable session limit: the one `training_sessions_userId_startedAt_idx` statement of §6.5. A reuse candidate is returned when `resumeIndex < items.length` (200, not counted); otherwise `n1h ≥ 30` → 429 `rate_limited` with `retryAfterSec` until the oldest of those sessions is an hour old. Explicit picks (`cardRefs`, `gameRef`) reuse too, because `filterKey` includes the sorted keys (so pressing Back to `?game=…` resumes instead of creating a second session); `practice` never reuses.
3. Build items (`PKG/chess-training/src/session.ts` `buildSession(kind, inputs)`, §8.6):
   - **BANK / DAILY bank part**: `SELECT c.*, m.* … WHERE c."userId"=$1 AND c.deck='BANK' AND c.due <= $now AND (c."suspendedUntil" IS NULL OR c."suspendedUntil" <= $now) AND m."hiddenAt" IS NULL [filters] ORDER BY c.due, c.id LIMIT 50` + today's `training_days` row + profile (parallel). Sort due review cards by retrievability ascending (ts-fsrs `get_retrievability`), then NEW cards newest game first; take `capRemaining` with NEW ≤ `newPerDay − newIntroduced`. DAILY uses the frozen `plan.steps[0].cardKeys` when present.
   - **Explicit** (`cardRefs`, or `gameRef` → the game's in-bank moment cards): `cardRefs` → `WHERE c."userId"=$1 AND c."itemKey" = ANY($keys)`; `gameRef` → `SELECT c.* FROM games g JOIN game_players gp ON gp."gameId" = g.id AND gp."userId" = $1 JOIN mistake_occurrences mo ON mo."gameId" = g.id JOIN mistakes m ON m.id = mo."mistakeId" AND m."userId" = $1 AND m."hiddenAt" IS NULL JOIN training_cards c ON c."mistakeId" = m.id WHERE g."referenceId" = $ref ORDER BY mo.ply` (PK/unique lookups only); `countsTowardCap = false`.
   - **PUZZLES / DAILY puzzle part**: rating `R` from the profile; candidate shards `{theme}/{floor(R/100)}` and `+1` from `puzzles.server.ts` (module LRU → Next data cache → R2, §9.3); exclusion query on `training_attempts_puzzle_idx` for ≤ 500 candidate ids; widen ±1 band per step until 15 candidates remain, then fall back to `mix` (`widened`); due PUZZLE-deck cards of the theme (≤ 30 % of the batch) interleaved; batch of 10 ordered by rating ascending; fair-use: `training_days.puzzlesDone + n > 400` → 429.
   - **PRACTICE** (`fromSessionRef`): same item keys, `preview = null`, no FSRS effect.
4. Texts per item from `explain.ts` (§8.12), previews from `fsrs.previewAll(card, now, prefs)` (§8.2), and `previewAfterAgain = previewAll(scheduler.next(card, now, Again).card, now + 10 min, prefs)` for every item that can be re-queued (pass 1, not practice).
5. One write: `INSERT INTO training_sessions (…) VALUES (…)` (+ `UPDATE training_sessions SET status='ABANDONED' WHERE "userId"=$1 AND kind='PUZZLES' AND status='ACTIVE' AND id <> $new` on a theme switch) in one `$transaction`.
6. Nothing due/cap reached: still 201 with `items: []` and `empty: "caughtup" | "cap_reached" | "nothing_matches"` (api TR-7: a reached cap is not an error).

**W1 `applyAttempts(viewer, attempts)`** (`attempts.server.ts`) — one interactive transaction (`{ maxWait: 2000, timeout: 5000 }`, tx-scoped client only, opt §3.1 rule 4):

1. Clamp `reviewedAt` to `[now − 7 d, now + 5 min]`; `stale` items older than 14 d → `rejected/too_old`. Sort by `reviewedAt`.
2. `SELECT "clientAttemptId" FROM training_attempts WHERE "clientAttemptId" = ANY($ids)` → those are `duplicate`.
3. `SELECT … FROM training_cards WHERE "userId" = $u AND "itemKey" = ANY($cardKeys) FOR UPDATE` (missing → `rejected/not_found`); PUZZLE items: the session row (`items` JSON, PK) for the puzzle snapshot (rating, theme), and the PUZZLE card if one exists for that puzzle.
4. In TS, per attempt in order (`PKG/chess-training`): decide `scheduled` (§8.5 "once a day" rule); FSRS `next()` + release snapping (§8.4); mastery (§8.8); cap counters; requeue (§8.6); Glicko for puzzles (§8.7); EWMA + milestone (§8.8); streak (§8.9); plan-step completion (§8.10). A card whose `reps ≠ cardReps` → `conflict` (no write for that attempt).
5. Writes (each one statement, 5–7 total):

```sql
UPDATE training_cards c SET due = x.due, stability = x.s, difficulty = x.d, "elapsedDays" = x.ed, "scheduledDays" = x.sd,
       "learningSteps" = x.ls, reps = x.reps, lapses = x.lapses, state = x.state::"CardState", "lastReview" = x.lr, mastery = x.m, "updatedAt" = now()
FROM jsonb_to_recordset($cards::jsonb) AS x(id bigint, "repsBefore" int, due timestamp, s real, d real, ed int, sd int, ls int, reps int, lapses int, state text, lr timestamp, m int)
WHERE c.id = x.id AND c."userId" = $u AND c.reps = x."repsBefore"
RETURNING c.id;                                                      -- an id missing here → conflict (lost a race inside the batch window)
INSERT INTO training_cards (…) SELECT … FROM jsonb_to_recordset($newPuzzleCards::jsonb) … ON CONFLICT ("userId","itemKey") DO NOTHING;   -- PUZZLE misses (D-6)
INSERT INTO training_attempts (…) SELECT … FROM jsonb_to_recordset($attempts::jsonb) … ON CONFLICT ("clientAttemptId") DO NOTHING RETURNING "clientAttemptId";
INSERT INTO training_days ("userId", day, "bankReviewed", "newIntroduced", "puzzlesDone", "activeMs", "planDone", "updatedAt")
SELECT … FROM jsonb_to_recordset($days::jsonb) …
ON CONFLICT ("userId", day) DO UPDATE SET "bankReviewed" = training_days."bankReviewed" + EXCLUDED."bankReviewed",
   "newIntroduced" = training_days."newIntroduced" + EXCLUDED."newIntroduced", "puzzlesDone" = training_days."puzzlesDone" + EXCLUDED."puzzlesDone",
   "activeMs" = training_days."activeMs" + EXCLUDED."activeMs", "planDone" = training_days."planDone" | EXCLUDED."planDone", "updatedAt" = now();
INSERT INTO theme_mastery ("userId", theme, attempts, "firstTry", ewma, "milestonePct", "lastAttemptAt")
SELECT … FROM jsonb_to_recordset($themes::jsonb) …
ON CONFLICT ("userId", theme) DO UPDATE SET attempts = EXCLUDED.attempts, "firstTry" = EXCLUDED."firstTry", ewma = EXCLUDED.ewma,
   "milestonePct" = GREATEST(theme_mastery."milestonePct", EXCLUDED."milestonePct"), "lastAttemptAt" = EXCLUDED."lastAttemptAt";
UPDATE training_profiles SET "puzzleRating" = $r, "puzzleRd" = $rd, "puzzleVol" = $vol, "puzzleAttempts" = "puzzleAttempts" + $np,
   "solveStreak" = $ss, "solveStreakBest" = GREATEST("solveStreakBest", $ss), "dayStreak" = $ds, "dayStreakBest" = GREATEST("dayStreakBest", $ds),
   "lastActiveDay" = GREATEST("lastActiveDay", $day), "updatedAt" = now() WHERE "userId" = $u;
UPDATE training_sessions SET total = total + $t, solved = solved + $sv, "firstTry" = "firstTry" + $ft, "withHint" = "withHint" + $wh,
   items = $itemsWithRequeues::jsonb WHERE id = $sessionId AND "userId" = $u;      -- only when a requeue was added
```

The `theme_mastery` new values are computed in TS from the rows read in step 3 (`SELECT … FROM theme_mastery WHERE "userId"=$u AND theme = ANY($t) ORDER BY theme FOR UPDATE`, in the same read round trip as the cards; the lock order is always cards by id, then mastery by theme, so two devices flushing at once cannot deadlock and cannot lose an EWMA update). The worker's J1 statements touch the same `training_cards` / `theme_mastery` rows only inside P3's one-request HTTP batch (server time well under 50 ms), so a W1 that meets a committing analysis waits at most that long; `attempts.int.test.ts` asserts W1 p95 < 300 ms while an analysis batch for the same user commits in a loop (api-perf AP-27). 6. After commit, in `after()`: the badge count (statement (a)) for the response's `bankDue`, PostHog server event `train_attempts_applied`, and one `/internal/emit` (`{v:1, targets:[{userRef}], event:"bank:due_changed", data, dedupeKey:"bank:"+userRef+":"+minute}`) **only** when the batch touched BANK cards and either the session finished or `bankDue = 0` (keeps OCI calls rare; other tabs get `crossTab`, other devices refresh on focus).

**W3 extend**: `SELECT … FROM training_sessions WHERE "referenceId" = $1 AND "userId" = $u AND status = 'ACTIVE' FOR UPDATE`; if items already exist after `after`, return them (idempotent); else select 10 more puzzles (excluding every id already in the session) and append with one `UPDATE`.

**W4 end**: `UPDATE training_sessions SET status = 'COMPLETED', "endedAt" = $now WHERE id = $1 AND "userId" = $u AND status = 'ACTIVE'` (0 rows → already ended → still return the summary) → `getSessionSummary()`: session row + `SELECT grade, "scheduledDays", theme, "firstTry", "hintsUsed", solved, "ratingBefore", "ratingAfter" FROM training_attempts WHERE "userId" = $u AND "reviewedAt" >= $startedAt AND "sessionId" = $id` (≤ 40 rows) + the session's themes' mastery rows.

**W5 skip**: one `$transaction`: `UPDATE training_cards SET "suspendedUntil" = $nextRelease WHERE "userId" = $u AND "itemKey" = $ref` (0 rows → 404) and, with `sessionRef`, mark the item `skipped` in `items`.

**W6 remove**: one `$transaction`, three statements keyed by the card ref:

```sql
WITH c AS (DELETE FROM training_cards WHERE "userId" = $u AND "itemKey" = $ref AND deck = 'BANK' RETURNING "mistakeId", theme)
UPDATE theme_mastery t SET "bankCount" = GREATEST(0, t."bankCount" - 1) FROM c WHERE t."userId" = $u AND t.theme = c.theme
RETURNING c."mistakeId";                                                     -- 0 rows → already removed → 204
UPDATE mistakes SET "hiddenAt" = $now, "updatedAt" = now() WHERE id = $mid AND "userId" = $u RETURNING "lastGameId", color;
UPDATE player_reviews SET "updatedAt" = now() WHERE "gameId" = $lastGameId AND color = $color;   -- bumps P3's A1 ETag so the "Added" tag refreshes
```

The FSRS history stays in `training_attempts` (plain `cardId`). `hiddenAt` stops any future game from creating a card for this position.

**A6 moment toggle** (`links.server.ts`, inside P3's `setMomentBank` transaction): resolve the game side (viewer must be a player → 404), check that `ply` is one of `content.moments[*].ply` (`jsonb_path_exists(pr.content, '$.moments[*] ? (@.ply == $p)', jsonb_build_object('p', $ply))`, else 404) and that its judgement is an error (else 404). Then:

```sql
-- P3 (unchanged): add or remove the ply in progress.bankOptOut, set semantics; also sets "updatedAt" = now() (A1 ETag)
UPDATE player_reviews SET progress = jsonb_set(COALESCE(progress, '{"v":1}'), '{bankOptOut}', $optOut::jsonb), "updatedAt" = now()
WHERE "gameId" = $g AND color = $color;
-- P5, inBank = true: un-hide and create the card (no-op if the game is not extracted yet: no occurrence row → card null)
WITH m AS (UPDATE mistakes m SET "hiddenAt" = NULL, "updatedAt" = now() FROM mistake_occurrences mo
           WHERE mo."gameId" = $g AND mo.ply = $ply AND m.id = mo."mistakeId" AND m."userId" = $u RETURNING m.*),
     c AS (INSERT INTO training_cards ("userId", deck, kind, "itemKey", "mistakeId", theme, phase, due, state, "createdAt", "updatedAt")
           SELECT $u, 'BANK', CASE WHEN m."isPuzzle" THEN 'MISTAKE' ELSE 'REVIEW_POSITION' END::"TrainingItemKind",
                  'm_' || $sqid, m.id, m."primaryTheme", m.phase, $nextRelease, 'NEW', now(), now() FROM m
           ON CONFLICT ("userId", "itemKey") DO NOTHING RETURNING theme, "itemKey", due)
INSERT INTO theme_mastery ("userId", theme, "bankCount") SELECT $u, theme, 1 FROM c
ON CONFLICT ("userId", theme) DO UPDATE SET "bankCount" = theme_mastery."bankCount" + 1
RETURNING (SELECT row_to_json(c) FROM c);
-- P5, inBank = false: the W6 statements, found by (gameId, ply) instead of the card ref
```

`$sqid` is computed in TS from the mistake's `epdHash`, which the route reads first with the same `(gameId, ply)` join (one indexed lookup; it also yields `card: null` early when the game has no occurrence row yet). The card must go, not just hide, because the due counts (statement (a)) read `training_cards` without joining `mistakes`. Any FSRS history stays in `training_attempts`; switching the moment back on creates a fresh NEW card. Returns `{ply, inBank, card:{ref, dueAt, dueLabel} | null}`. When the game is not extracted yet (`bankVersion = 0`, e.g. `BANK_EXTRACT_ENABLED=false`), only the opt-out is recorded and the worker applies it later (P3-D19).

**Review bank fields** (`reviewBank.server.ts`, called by P3's `getReview()` / `getReviewStatus()` when the `train` flag is on): one statement per game side, served by `mistake_occurrences_pkey` and two PK/unique lookups:

```sql
SELECT mo.ply, c."itemKey", c.due
FROM mistake_occurrences mo
JOIN mistakes m ON m.id = mo."mistakeId" AND m."userId" = $u AND m."hiddenAt" IS NULL
JOIN training_cards c ON c."mistakeId" = m.id
WHERE mo."gameId" = $g AND mo.ply = ANY($momentPlies);
```

`MomentDTO.inBank` = a row exists for that ply (so "Added"/"Not added" reflect real cards, including the effect of W6); `MomentDTO.card = {ref, dueLabel}`; `ReviewStatusDTO.bank = {count: rows, plies}`. A2's probe adds `count(*)` of the same join so its ETag changes when the count does.

**W7 report**: one statement answers both the duplicate check and the durable daily limit (`reports_reporterId_createdAt_idx`): `SELECT count(*) AS n24, bool_or("targetType" = $t AND "targetRef" = $r) AS dup FROM reports WHERE "reporterId" = $u AND "createdAt" > $now - interval '24 hours'`. `dup` → 200 `duplicate: true`; `n24 ≥ 20` → 429 (`retryAfterSec` until the oldest of them is 24 h old); else insert. Target check: a `mistake` ref must belong to the viewer; a `puzzle` id must be in one of the viewer's sessions or cards. P10's `user`/`game` branches reuse the same limit and duplicate rule.

**W8 prefs**: one `$transaction`: `UPDATE users SET "timeZone" = $tz WHERE id = $u` when `timeZone` is present (IANA validated with `Intl.supportedValuesOf("timeZone")` plus `Etc/UTC`), and `INSERT INTO training_profiles ("userId", …) VALUES (…) ON CONFLICT ("userId") DO UPDATE SET <only the fields present>` for the rest; `newPerDay > bankDailyCap` (after merging with the stored row) → 400. A change to `dayStartHour` takes effect from the next local day (today's `TrainingDay` row keeps its key); a change to `releaseHour` re-snaps nothing retroactively (new grades snap to the new hour).

**R8 badges**: statement (a) only, mapped through the cap formula (§8.5).

**HOME-1 `getHomeData(viewer)`** (`WEB/lib/home/home.server.ts`) — one parallel batch:

```sql
-- (h1) newest 3 finished games with the first moment's ply, on game_players_userId_endedAt_gameId_idx (P2)
SELECT gp."gameId", gp.color, gp.result, gp."endedAt", gp."opponentName", gp."opponentRating", gp."momentsCount", gp.accuracy,
       g."referenceId", g."analysisStatus", g."plyCount", g."openingName", g."startingFen", g."startPly", g.moves,
       ga."gradedPlies", ga."totalPlies",
       (pr.content #>> '{moments,0,ply}')::int AS "kPly"            -- one path read on ≤ 3 rows
FROM game_players gp JOIN games g ON g.id = gp."gameId"
LEFT JOIN game_analyses ga ON ga."gameId" = gp."gameId"
LEFT JOIN player_reviews pr ON pr."gameId" = gp."gameId" AND pr.color = gp.color
WHERE gp."userId" = $1 AND gp."endedAt" IS NOT NULL
ORDER BY gp."endedAt" DESC, gp."gameId" DESC LIMIT 3;
-- (h2) due summary (a) + due preview (c) + top theme: SELECT theme, "bankCount" FROM theme_mastery WHERE "userId"=$1 ORDER BY "bankCount" DESC LIMIT 1
-- (h3) this week: training_days PK range (b) ‖ SELECT "endedAt" FROM game_players WHERE "userId"=$1 AND "endedAt" >= $mondayUtc  (≤ 50 rows; local days in TS)
--      ‖ SELECT count(*) FROM training_attempts WHERE "userId"=$1 AND deck='PUZZLE' AND "reviewedAt" >= $mondayUtc
-- (h4) recent 8: the archive keyset query (P3 GET /api/me/games) with LIMIT 8, selecting result, opponent, rating, headline, endedAt
-- (h5) import: P4 getImportStatus(viewer) (one PK/unique read)
-- (h6) only when new_user: the featured Opera Game position via unstable_cache(…, { tags: ["positions"] }) (0 DB on a hit)
```

Continue = the first `h1` row with `g."analysisStatus" = 'DONE' AND momentsCount > 0` (`kind: "moments"`), else the newest row still analysing (`kind: "analysing"`), else the newest analysed (`kind: "clean"`). The board FEN is computed in TS by replaying the first `kPly` UCI moves of `games.moves` from `startingFen` (chess.js on the server, ≈ 0.3 ms; nothing is sent to the client but the FEN); `lastMove` = the squares of move `kPly − 1`. `state = new_user` when `h1` is empty and the bank total is 0 and no import is running. The "this week" and "recent 8" statements use `gp."endedAt"` with the same P2 index (consistency R-01; the wire field stays `playedAtLabel`).

### 7.4 Socket events (emitted through P2's `POST /internal/emit`, B20)

Body: P2's `{ v: 1, targets: [{ userRef }], event, data, dedupeKey? }` (consistency R-07). Auth: the shared helper in `CT/internal/auth.ts`, so P5 inherits whatever P2's receiver accepts (`x-internal-token` + `INTERNAL_API_SECRET` today, R-08; HMAC with per-caller keys if P2/P13 adopt api-perf AP-44). Under AP-44's per-caller allow-list the worker may emit `analysis:*`, `bank:*` and `mistakes:*`; the web emits `bank:due_changed`. The socket server drops an emit early when the target room has no sockets.

| Event | Room | Payload | Emitted by | When |
|---|---|---|---|---|
| `analysis:done` (P3; P5 adds two fields) | `user:{ref}` (each member player, personalised) | `+ bankAdded: {count, plies} \| null, bankDue: int \| null` | worker, P3 timing (jobs at priority ≥ 80) | after P3's final batch commits; the values come from that batch's own results (§7.6), so no extra query and no extra emit |
| `analysis:batch` (P3; P5 adds two fields) | `user:{ref}` | `+ bankAdded: int, bankDue: int` (sums since the last batch event) | worker, P3's coalescer (≤ 1 per user per 60 s for jobs below priority 80) | import backlog |
| `mistakes:added` | `user:{ref}` | `{v:1, games, added, cardsAdded, total, bankDue}` | worker `EXTRACT_MISTAKES` path only (`WK/src/extract/coalesce.ts`, in-memory per user, trailing flush ≤ 1 per 60 s, `dedupeKey: "mistakes:" + userRef + ":" + minute`) | backfill / `EXTRACT_VERSION` re-extraction, when `cardsAdded > 0` |
| `bank:due_changed` | `user:{ref}` | `{v:1, bankDue, dueRaw, total, nextAt}` | web W1/W4/W6/A6 `after()` (throttled as in §7.3) | a member's own grading or removal on another device |

Schemas live in `CT/socket/user.ts` (+ `registry.ts`); consumers in §5.5. The client never sends a training command over the socket. P10 adds the 08:00 release push as a future-dated job per time zone (api-perf AP-08, feasibility F-NEON-2); P5 uses the client timer instead (§5.2) and adds **no** recurring job or timer.

### 7.5 SSE and webhooks

None in P5. Dodo `entitlement:changed` (P1/P4) already flips access; the runner reacts to 402 on the next flush.

### 7.6 Background jobs (worker `WK`, P3 queue; no Vercel cron)

| Job | Trigger | Lane / priority | Dedupe | Work | Budget (1 OCPU, Stage A) | Writes / events |
|---|---|---|---|---|---|---|
| J1 extraction (inline) | end of `ANALYZE_GAME`, per member side | engine lane, inside the analysis job | the job's own key | candidates (§8.1) → reuse pass-2 MultiPV lines from `GameAnalysis.lines` → line extension searches only for `isPuzzle` candidates (≤ 3 searches × 500k nodes, MultiPV 2) → tagger → rows built in TS → **J1's statements appended to P3's final `sql.transaction([...])` HTTP batch** (one request, one commit with `GameAnalysis` and `PlayerReview`; below) | ≤ 6 s extra engine time per game (typical 1–2 puzzle candidates × 3 × 500k nodes at 0.45–0.75 Mnps); +0 round trips | `mistakes`, `mistake_occurrences`, `training_cards`, `theme_mastery`, `game_players."bankVersion"`; `analysis:done.{bankAdded, bankDue}` |
| `EXTRACT_MISTAKES` (new kind) | B-M5-1 backfill; an `EXTRACT_VERSION` bump | engine lane, `JOB_PRIORITY.BACKLOG` (yields to live and opened games) | `extract:<gameId>:<userId>:v<EXTRACT_VERSION>` | the same extraction for an already-analysed game (reads `GameAnalysis` and `PlayerReview.content`, no pass 1); payload `ExtractMistakesPayloadV1 {v:1, gameId, userId}` (readers skip an unknown `v`, feasibility §9 rule 2) | as J1, in its own one-request batch | as J1; `mistakes:added` (coalesced) instead of `analysis:done` |
| `HOUSEKEEPING` (P3, rules added) | daily | I/O lane | `cron:HOUSEKEEPING:<date>` | `UPDATE training_sessions SET status = 'ABANDONED' WHERE status = 'ACTIVE' AND "startedAt" < $now - interval '24 hours'` (batched 1,000); `UPDATE training_days SET plan = NULL WHERE plan IS NOT NULL AND day < current_date - 7`; `DELETE FROM training_sessions WHERE "startedAt" < $now - interval '90 days'` (batched) | seconds | — |
| J6 shard build (script, laptop) | manual, quarterly | — | versioned path | §8.13 | ≈ 10 min | R2 objects |

Kill switch: `BANK_EXTRACT_ENABLED=false` on the worker skips J1 (analysis still completes; the backfill catches up later).

**J1 batch statements** (`WK/src/extract/bankStatements.ts`; api-perf AP-27). The Neon HTTP batch is non-interactive, so no statement may depend on another's `RETURNING`; each one joins back on natural keys (`("userId","epdHash")`, `("gameId", ply)`, `("userId","itemKey")`), and later statements see earlier ones' rows because they run in one transaction. `$m`, `$o`, `$c` are JSON arrays built in TS; `$now` is the job's clock.

```sql
-- 0. best move changed after a newer engine: reset the card BEFORE step 1 overwrites the stored solution (compares old vs new in SQL)
UPDATE training_cards c SET state = 'NEW', reps = 0, lapses = 0, stability = 0, difficulty = 0, due = x.due, "updatedAt" = $now
FROM mistakes m, jsonb_to_recordset($m::jsonb) AS x("userId" bigint, "epdHash" bigint, solution text, "lastPlayedAt" timestamp, due timestamp)
WHERE m."userId" = x."userId" AND m."epdHash" = x."epdHash" AND c."mistakeId" = m.id
  AND split_part(m.solution, ' ', 1) <> split_part(x.solution, ' ', 1) AND x."lastPlayedAt" >= m."lastPlayedAt";
-- 1. mistakes: insert or refresh the "last seen" fields (an older re-analysis never overwrites a newer occurrence)
INSERT INTO mistakes ("referenceId","userId","epdHash",color,fen,"setupUci",solution,accept,"playedUci","refuteUci",judgement,source,"isPuzzle",
                      "uniquenessGap",themes,"primaryTheme",phase,"winBefore","winAfterPlayed","cpBest","mateBest","timeClass","ecoCode","moveNumber",
                      "lastGameId","lastPly","lastPlayedAt","lastOpponentName","createdAt","updatedAt")
SELECT x."referenceId", x."userId", x."epdHash", … , $now, $now FROM jsonb_to_recordset($m::jsonb) AS x(…)      -- referenceId = cuid2 generated in TS
ON CONFLICT ("userId","epdHash") DO UPDATE SET "lastGameId" = EXCLUDED."lastGameId", "lastPly" = EXCLUDED."lastPly",
   "lastPlayedAt" = EXCLUDED."lastPlayedAt", "lastOpponentName" = EXCLUDED."lastOpponentName", solution = EXCLUDED.solution,
   accept = EXCLUDED.accept, "isPuzzle" = EXCLUDED."isPuzzle", "uniquenessGap" = EXCLUDED."uniquenessGap", themes = EXCLUDED.themes,
   "primaryTheme" = EXCLUDED."primaryTheme", "updatedAt" = EXCLUDED."updatedAt"
WHERE EXCLUDED."lastPlayedAt" >= mistakes."lastPlayedAt";
-- 2. occurrences (idempotent on re-analysis) + the occurrence count, by natural key
INSERT INTO mistake_occurrences ("gameId", ply, "mistakeId")
SELECT x."gameId", x.ply, m.id FROM jsonb_to_recordset($o::jsonb) AS x("userId" bigint, "epdHash" bigint, "gameId" bigint, ply int)
JOIN mistakes m ON m."userId" = x."userId" AND m."epdHash" = x."epdHash" ON CONFLICT DO NOTHING;
UPDATE mistakes m SET occurrences = s.n FROM (SELECT o."mistakeId", count(*)::smallint n FROM mistake_occurrences o
  JOIN mistakes mm ON mm.id = o."mistakeId" JOIN jsonb_to_recordset($o::jsonb) AS x("userId" bigint, "epdHash" bigint) ON mm."userId" = x."userId" AND mm."epdHash" = x."epdHash"
  GROUP BY o."mistakeId") s WHERE m.id = s."mistakeId";
-- 3. cards for moment plies: skip hidden mistakes and the member's opt-outs (read in SQL from progress.bankOptOut, P3-D19)
WITH ins AS (
  INSERT INTO training_cards ("userId", deck, kind, "itemKey", "mistakeId", theme, phase, due, state, "createdAt", "updatedAt")
  SELECT m."userId", 'BANK', x.kind::"TrainingItemKind", x."itemKey", m.id, m."primaryTheme", m.phase, x.due, 'NEW', $now, $now
  FROM jsonb_to_recordset($c::jsonb) AS x("userId" bigint, "epdHash" bigint, "gameId" bigint, color char(1), ply int, kind text, "itemKey" text, due timestamp)
  JOIN mistakes m ON m."userId" = x."userId" AND m."epdHash" = x."epdHash" AND m."hiddenAt" IS NULL
  LEFT JOIN player_reviews pr ON pr."gameId" = x."gameId" AND pr.color = x.color
  WHERE NOT (COALESCE(pr.progress->'bankOptOut', '[]'::jsonb) @> to_jsonb(x.ply))
  ON CONFLICT ("userId","itemKey") DO NOTHING
  RETURNING "userId", theme, "mistakeId")
INSERT INTO theme_mastery ("userId", theme, "bankCount") SELECT "userId", theme, count(*)::smallint FROM ins GROUP BY 1, 2
ON CONFLICT ("userId", theme) DO UPDATE SET "bankCount" = theme_mastery."bankCount" + EXCLUDED."bankCount";
-- 4. recurrence: an existing card whose mistake happened again comes back at the next release at the latest (no FSRS log row)
UPDATE training_cards c SET due = LEAST(c.due, x.due), "updatedAt" = $now
FROM jsonb_to_recordset($c::jsonb) AS x("userId" bigint, "itemKey" text, due timestamp)
WHERE c."userId" = x."userId" AND c."itemKey" = x."itemKey" AND c.due > x.due;
-- 5. marker + the raw due counts and today's cap counters for analysis:done.bankDue (the cap formula of §8.5 runs in TS)
UPDATE game_players SET "bankVersion" = 1 WHERE "gameId" = $gameId AND "userId" = ANY($userIds);
SELECT x."userId",
       (SELECT count(*) FILTER (WHERE c.state <> 'NEW')::int FROM training_cards c WHERE c."userId" = x."userId" AND c.deck = 'BANK'
          AND c.due <= $now AND (c."suspendedUntil" IS NULL OR c."suspendedUntil" <= $now)) AS due_review,
       (SELECT count(*) FILTER (WHERE c.state = 'NEW')::int  FROM training_cards c WHERE c."userId" = x."userId" AND c.deck = 'BANK'
          AND c.due <= $now AND (c."suspendedUntil" IS NULL OR c."suspendedUntil" <= $now)) AS due_new,
       d."bankReviewed", d."newIntroduced"
FROM jsonb_to_recordset($days::jsonb) AS x("userId" bigint, day date)            -- each member's local training day, computed in TS
LEFT JOIN training_days d ON d."userId" = x."userId" AND d.day = x.day;
-- 6. analysis:done.bankAdded = the cards that now exist for this game's moment plies (the same rule as A2's bank field)
SELECT m."userId", array_agg(mo.ply ORDER BY mo.ply) AS plies
FROM mistake_occurrences mo JOIN mistakes m ON m.id = mo."mistakeId" AND m."hiddenAt" IS NULL JOIN training_cards c ON c."mistakeId" = m.id
WHERE mo."gameId" = $gameId AND mo.ply = ANY($momentPlies) GROUP BY m."userId";
```

The worker needs each member's `timeZone`, `releaseHour`, `dayStartHour`, `bankDailyCap` and `newPerDay` **before** it builds `$c` (new cards are due at the next local release) and to apply the cap formula afterwards. These come from one `LEFT JOIN training_profiles` added to P3's existing job-load statement (`users` is already read there), so J1 adds no round trip. Defaults apply when the profile row does not exist yet.

The worker cannot know before the batch which `itemKey`s already exist or what solution is stored, so every rule is expressed so that it is correct either way: step 0 compares the stored and the new first move in SQL before step 1 overwrites it; step 3's `ON CONFLICT DO NOTHING` absorbs cards that already exist; step 4 reuses `$c` and only moves an existing card's `due` earlier (a card just inserted in step 3 already has `due = x.due`, so the `c.due > x.due` guard skips it). Because the batch is one HTTP request with server time well under 50 ms, the row locks it takes on `training_cards` and `theme_mastery` are short; W1's `FOR UPDATE` waits at most that long (test in §12.2). If a profiling run ever shows the batch above 100 ms server time, the fallback is a SQL function `rc_apply_bank(p jsonb)` defined in a migration (data-model §7.2), called as one statement in the same batch.

### 7.7 Third-party integrations

| Service | Use in P5 | Notes |
|---|---|---|
| Cloudflare R2 (`replay-chess-media` bucket, account replaychess007) | puzzle shards `puzzles/v1/{theme}/{band}.json`, `puzzles/v1/manifest.json`, `Cache-Control: public, max-age=31536000, immutable`, `Content-Type: application/json` | public CC0 content, so dev and prod share the same versioned objects; uploaded from a laptop by `upload-shards.ts` with the existing `R2_*` credentials |
| Lichess open database | `https://database.lichess.org/lichess_db_puzzle.csv.zst` (CC0; 6,157,341 rows on 2026-10-05) | downloaded only by the build script; never at runtime; credit line "Puzzles from the Lichess open database (CC0)" on the "This puzzle" card |
| PostHog, Sentry | §10 | existing |
| Stockfish (worker) | extension searches | P3 binary and profile |

### 7.8 Environment variables

| Name | Where | Value |
|---|---|---|
| `PUZZLE_SHARD_BASE_URL` | Vercel `replay-chess-dev` (and the future prod project), `WEB/.env.development.local` | public base of the R2 bucket + `/puzzles` (e.g. `https://media.playchess.tech/puzzles` once the owner confirms the custom domain, D-17); unset → `mediaUrl("/puzzles")` |
| `PUZZLES_VERSION` | same | `v1` (must equal the committed manifest's `version`) |
| `TRAIN_PUZZLES_DAILY_LIMIT` | same (optional) | default `400` |
| `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` | same | `/home`, `/onboarding` |
| `BANK_EXTRACT_ENABLED`, `BANK_LINE_NODES` | worker (`deploy/oci` env file, dev box) | `true`, `500000` |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | laptop only (`WEB/.env.local`) | existing names |
| `BACKFILL_ALLOWED_HOSTS` | laptop/CI only | the Neon dev host |

No new secret is introduced. The itemKey sqids alphabet is a constant in `PKG/chess-training/src/items.ts` (obfuscation only; ownership is enforced by the `userId` scope).

### 7.9 Feature flags and switches

| Flag | Kind | Gates | Rollout |
|---|---|---|---|
| `train` | PostHog, server-evaluated (`lib/flags/registry/p5.ts`) | Train destination + subs, `/train/**` pages (off → `notFound()`), Review complete bank lines and Drill CTA, the game-over `bank` slot, the review bank fields (off → `bank: null`, `inBank` from `bankOptOut` only), A6 card behaviour (off → P3's opt-out write only). J1 card creation is **not** flag-gated (data accrues dark) | dev: owner + E2E A–P + pool users 100 %; removed one release after 100 % in prod (alloc §1.6). P1's `flags-off` Playwright project (testing X11) runs the P1–P4 `@smoke` specs with `train` and `home` off until the flags are deleted |
| `home` | PostHog | Home destination, `/home` (off → `redirect('/play')`), logo target, `/` → `/home` middleware rule, sign-in fallback (the env var is set regardless; `/home` itself redirects when off) | same |
| `bank-remove` | PostHog variant of `train` | row ⋯ Remove From Bank (needs the design sign-off, D-2) | owner only until signed off |
| `puzzles_enabled` | Edge Config kill switch (arch §3.5.1) | puzzle sessions and the plan's puzzle step (off → the step is omitted, S5 shows "Puzzles are taking a break.") | default on |

Flags never gate authorisation (arch §3.5.2): every route still checks membership and ownership.

---

## 8. Domain logic (pure TypeScript, unit-tested; constants in `PKG/chess-training/src/constants.ts` unless noted)

All of this is pure code shared by the web routes and the worker; the browser imports only the `/labels`, `/grade` and `/items` subpaths and the `PUZZLE` Glicko preset (interval previews arrive precomputed in the session payload). Every function that depends on time takes `now` as an argument (no hidden `Date.now()`). Win% and accuracy formulas are P3's (`PKG/chess-analysis`, res §3.1): `winningChances(cp) = 2 / (1 + exp(−0.00368208 · clamp(cp, −1000, 1000))) − 1`, `winPct = 50 + 50 · wc`, evaluated from the mover's point of view.

### 8.1 Which positions become bank items (worker J1, `PKG/chess-analysis/src/bank/candidates.ts`, `WK/src/extract/extractMistakes.ts`)

1. **Candidates** — the member side's plies `i` (P3 `GameAnalysis`) where:
   - `judgement ∈ {MISTAKE, BLUNDER, MISS}`, or `judgement = INACCURACY` with `ΔWin = winBefore − winAfterPlayed ≥ 7` **and** `10 ≤ winBefore ≤ 90` (undecided position) — alloc P5, rct-b §3.1, Q23 (owner decision D-1);
   - not a book ply, not in the first 6 plies of the game, not inside a legend-practice prefix (`ply ≥ startPly`), the game not flagged `meta.colorUnknown` (dm §11.6 B1);
   - ranked by `ΔWin` descending; keep the **top 4** per game side (`MAX_BANK_PER_GAME = 4`). Every P3 key-moment ply that is an error is forced into the set (union), so the bank and the review never disagree.
   - `source = MISSED_PUNISH` when `judgement = MISS` (the user failed to punish the opponent's error at `i − 1`), else `OWN_ERROR`.
2. **Uniqueness** (res §7.2 `validAttack`, re-implemented clean-room from the description; the puzzler is AGPL, so the process in `CLEANROOM.md` applies, §11): from P3's pass-2 MultiPV lines for ply `i` (`GameAnalysis.lines[i]`, best and second): `gap = wc(best) − wc(second)`; `validAttack` if there is no second move, or best is mate-in-1 and `wc(second) ≤ 0.6` (every other mate-in-1 joins `accept`), or `gap > T` with **`T = 0.5`** (the looser "find the best move" bound, R-PZL-04). `isPuzzle = validAttack ∧ (cpBest ≥ +200 for the user ∨ mate for the user)` (alloc P5, res §7.2). Store `uniquenessGap = gap`.
3. **Skip as a scored puzzle (keep as a review position)** when the position has fewer than 2 legal moves, or the user was already > +300 cp before the opponent's previous move with no mate near ("too winning", R-PZL-07).
4. **Line** (`PKG/chess-analysis/src/puzzle/line.ts`, res §7.3), only when `isPuzzle`: `line = [best]`; loop while `line.length < 7` (max 7 plies = 4 user moves; `MAX_LINE_PLIES = 7`): defender reply = the engine best from the PV (MultiPV 1); stop on repetition; run one MultiPV-2 search at `BANK_LINE_NODES = 500_000` on the next attacker position; stop if `cp(user) < +200` without mate or `!validAttack`; else push reply + attacker best. **Trim**: drop a trailing defender move; drop the final attacker move if it was an only-move with no real alternative, keeping odd length. One-movers are allowed for own mistakes (R-PZL-06; tagged `oneMove`).
5. **Review positions** (`isPuzzle = false`): `solution = [best]`; `accept` = other first moves within **2 Win%** of best from the MultiPV lines (≤ 5). Any of `accept ∪ {best}` solves.
6. **Record** (Lichess shape, R-PZL-08/09): `fen` = position before the opponent's move `i − 1` (when `i ≥ 1`), `setupUci` = that move; else `fen` = position before ply `i`, `setupUci = null`. `refuteUci` = P3's best move at ply `i + 1` (the opponent's best reply to the played move). `epdHash = fnv1a64(epd(pos_i))` as a signed int64 (`PKG/chess-analysis/src/epd.ts`; EPD = FEN fields 1–4, R-ENG-07).
7. **Themes** (§8.11) on `[best, …line]`, plus the `rc:*` review heuristics for review positions; `primaryTheme` = the highest-priority detected theme.
8. **Upsert** inside P3's final HTTP batch, as the set-based natural-key statements of §7.6 (no statement reads another's `RETURNING`):
   - `mistakes` insert-or-refresh on `("userId","epdHash")`, keeping the newest occurrence's `last*` fields;
   - `mistake_occurrences` insert on `("gameId", ply)` joined back to `mistakes` by the natural key, then the occurrence recount (re-analysis never double-counts);
   - cards: for each **key-moment ply** of this side — the output of P3's pure `selectKeyMoments()` on the same analysis, which is also what P3 writes into `PlayerReview.content.moments`, so cards exist even for imported games whose review has never been opened — that is an error, is not in `PlayerReview.progress.bankOptOut` (filtered in SQL) and whose mistake is not hidden: `INSERT INTO training_cards (…, deck 'BANK', kind MISTAKE|REVIEW_POSITION, itemKey 'm_'||sqid(id), theme, phase, due = nextRelease(user), state 'NEW') ON CONFLICT ("userId","itemKey") DO NOTHING`. The `itemKey` sqid needs the mistake id, which is unknown before the batch for a new mistake; the key is therefore built from `epdHash` instead (`'m_' || sqid(epdHash as uint64)`, 11–13 characters, unique per user because `epdHash` is, and opaque), so the card insert needs no id;
   - **recurrence**: an existing card whose mistake happened again in a newer game gets `due = LEAST(due, nextRelease)` (the real-game lapse brings it back at the next morning batch; no FSRS log row);
   - **best move changed** after re-analysis with a newer engine (`solution` first token differs): reset the card to `NEW`, `reps = 0`, `due = nextRelease` (rct-b T2 edge case);
   - `theme_mastery.bankCount += n` per theme from the inserted cards (one statement with the card insert as a CTE); `game_players."bankVersion" = 1`.
9. **Hidden** (`hiddenAt` set): occurrences still increment; no card is created; the user's removal is respected.

### 8.2 FSRS configuration (`PKG/chess-training/src/fsrs.ts`, wraps `ts-fsrs@^5`)

`ts-fsrs` **5.4.2** (latest 5.x on npm, `engines.node >= 20`, MIT; v6.0.0 needs Node ≥ 24, res §10.1, B11) behind one wrapper so the version can change in one file:

```ts
import { fsrs, generatorParameters, default_w, Rating, State, StrategyMode, createEmptyCard } from "ts-fsrs";
export const W = [...default_w]; W[1] = 2.0; W[2] = 4.0; W[3] = 9.0;   // initial stabilities Hard/Good/Easy (w[0] Again stays 0.212)
export const PARAMS = generatorParameters({
  request_retention: 0.9, maximum_interval: 180, enable_fuzz: true, enable_short_term: true,
  learning_steps: ["10m"], relearning_steps: ["10m"], w: W,
});
/** Only Again uses a learning step; Hard/Good/Easy graduate on a new card ("Hard 2 days" on the board). */
const againOnlySteps = () => ({ [Rating.Again]: { scheduled_minutes: 10, next_step: 0 } });
export const scheduler = fsrs(PARAMS).useStrategy(StrategyMode.LEARNING_STEPS, againOnlySteps);
```

Measured with ts-fsrs 5.4.2, fuzz off, new card graded at 2026-11-05 19:00Z (scratchpad check, before release snapping):

| Configuration | Again | Hard | Good | Easy |
|---|---|---|---|---|
| defaults + one `10m` step | 10 min | 15 min | 2 d | 8 d |
| `w[1..3] = 2, 4, 9` + one `10m` step | 10 min | 15 min | **4 d** | **9 d** |
| `w[1..3] = 2, 4, 9` + no learning step | 1 d | **2 d** | 4 d | 9 d |
| second review of a Good card on its due day (row 2 config) | 10 min | 13 d | 19 d | 32 d |

The design copy is "Again < 10 min · Hard 2 days · Good 4 days · Easy 9 days". The `againOnlySteps` strategy (Again → 10 min step; Hard/Good/Easy graduate with S₀ = 2 / 4 / 9 days) targets exactly that; `fsrs.test.ts` asserts it (D-8: if the custom strategy misbehaves in review states, fall back to row 2 and show "Hard 15 min" — the buttons always show the **real** interval from `scheduler.repeat(card, now)`, never hard-coded strings).

- `previewAll(card, now, prefs)` → `{again, hard, good, easy}` each `{days, due (snapped, §8.4), label}`; labels "< 10 min" (< 1 h: minutes, "< 10 min" when ≤ 10), "{n} h", "1 day", "{n} days", "{n} weeks" (≥ 14 d), "{n} months" (≥ 60 d).
- Card ↔ row mapping: `due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review`.
- Retrievability for queue ordering: `scheduler.get_retrievability(card, now, false)`.
- Offline replay: grade with `now = reviewedAt` (arch §2.3.5).

### 8.3 Suggested grade, objective score and solve streak (`grade.ts`; board logic `_rv0`)

| What happened | Suggested | Note under the grade bar | `firstTry` | Glicko score (PUZZLE only) | Solve streak |
|---|---|---|---|---|---|
| solved, no hint, no wrong move | **Good** | "Solved first time. Pick Easy if it felt instant." | true | 1 | +1 |
| solved after hint step 1 or 2 | **Hard** | "Solved with a hint, so Hard is suggested." | false | 0.5 | unchanged |
| ≥ 1 wrong move, then solved | **Again** | "One wrong try, so Again is suggested." | false | 0 | reset to 0 ("· streak reset") |
| solution shown (menu or after a wrong move) | **Again** | "You saw the solution, so Again is suggested: it comes back in under 10 minutes." | false | 0 | reset |
| review position solved with an accepted non-best move | Good | "Good enough. The engine's best was {bestSan}." | true | — | +1 |

`suggested = shown || wrongs > 0 ? AGAIN : hints > 0 ? HARD : GOOD` (verbatim from the board). The user may pick any grade (D2 in rct-b); `overridden = grade ≠ suggested` is logged. The **puzzle rating always uses the objective score**, never the chosen grade. `autoGrade` (no UI in P5) applies the suggestion after 600 ms.

### 8.4 Local day, release snapping, DST (`tz.ts`, `day.ts`, `release.ts`)

- `localParts(instant, tz)` via `Intl.DateTimeFormat(…, {timeZone, hourCycle: "h23", year, month, day, hour, minute})`.
- `zonedToUtc(y, m, d, h, min, tz)`: two-pass offset correction (guess = UTC wall time; `offset1 = tzOffset(guess)`; `t = guess − offset1`; `offset2 = tzOffset(t)`; if they differ use `guess − offset2`). A wall time inside a spring-forward gap resolves to the first valid instant after it; an ambiguous fall-back time resolves to the **earlier** instant.
- `dayKey(now, tz, dayStartHour) = formatDate(localParts(now − dayStartHour h))` → `YYYY-MM-DD` (Anki-style rollover at 04:00 by default; a session at 02:00 belongs to the previous day).
- `nextRelease(now, tz, releaseHour = 8)` = today's local `releaseHour` if still ahead, else tomorrow's.
- **Snapping (rct-b D7):** if the FSRS interval is ≥ 1 day: `due = zonedToUtc(localDate(dueRaw), releaseHour)`; intervals under a day (Again, learning) are left unsnapped. Result: "The next batch of 6 arrives tomorrow at 08:00" is literally true.
- New BANK cards: `due = nextRelease(createdAt)` ("The first one comes back tomorrow", rct-a §4.6). Skip for today: `suspendedUntil = nextRelease(now)`.
- Test zones: `Europe/London` (DST ends 2026-10-25), `America/New_York` (ends 2026-11-01), `Asia/Kolkata` (+05:30, no DST), `Australia/Lord_Howe` (30-minute DST), `Pacific/Chatham` (+12:45/+13:45), `Etc/UTC`.
- **Clock source**: on the server `now` is `ctx.now` (route) or `requestNow()` (RSC page), both from P1 (testing X5); in the worker it is the job's start time. This is what lets `day-rollover.spec.ts` (§12.4) drive 03:59 → 04:01 → 08:00 local without touching the device clock.

### 8.5 Caps and the due counts shown (`caps.ts`; rct-b D6, §3.5)

- `capRemaining = max(0, bankDailyCap − today.bankReviewed)` (default cap 10, settings range 5–30 in P10).
- `newRemaining = max(0, min(newPerDay − today.newIntroduced, capRemaining))` (default 5 new inside the 10).
- `dueShown = min(dueReview + min(dueNew, newRemaining), capRemaining)`; `waiting = dueReview + dueNew − dueShown`. When `waiting > 0`: "{waiting} more wait for later days. FSRS keeps it to {cap} a day." When `capRemaining = 0 && dueRaw > 0`: caught up with "You reviewed today's {cap} positions."
- **Counted**: +1 `bankReviewed` on the **first FSRS grade of a BANK card today** in a session with `countsTowardCap`; +1 `newIntroduced` when that card was `NEW`. **Bypass**: explicit picks ("Solve this one", "Drill these 3", `?game=`), practice, PUZZLE deck.
- **Once-a-day rule** (`scheduled` flag): an attempt reschedules the card iff the card is due (`due ≤ reviewedAt + 1 h`), or its state is NEW/LEARNING/RELEARNING (short-term steps, the Again re-queue), or it is an explicit pick and `lastReview` is not today; otherwise the attempt is logged with `grade` kept but `scheduledDays = null` and the card is untouched (practice). Practice sessions (`kind PRACTICE`, "Start Again") never reschedule.
- **Fair use**: `puzzlesDone + requested > TRAIN_PUZZLES_DAILY_LIMIT (400)` → 429 at session create/extend; attempts are never rejected for it.

### 8.6 Session composition (`session.ts` `buildSession(kind, inputs)`, rct-b §3.7)

| Kind | Items | Order | Cap | Size |
|---|---|---|---|---|
| `DAILY` | plan step 1 cards (frozen keys, re-filtered to those still due) + step 2 puzzles (`count` 3, focus theme) | bank first, then puzzles | bank part counts | ≤ 10 + 3 |
| `BANK` (due queue) | due review cards by retrievability ascending (most forgotten first, ties by older `due`), then NEW cards newest game first, ≤ `newRemaining` | as built; a hub thumbnail's card goes first | counts | `min(capRemaining, 20)` |
| `BANK` practice ("Drill these {n} · nothing due") | the current filtered list | list order | no; FSRS early review once a day per card | ≤ 20 |
| `BANK` explicit (`cardRefs`, `gameRef`) | the given cards | given | no | ≤ 20 |
| `PUZZLES` | ≤ 30 % due PUZZLE-deck cards of the theme interleaved (every third slot), the rest new shard puzzles with rating in `[R − 100, R + 150]` (widened ±100 per step), excluding ids attempted in the last 90 days and ids already in the session | rating ascending within the batch (warm-up) | no | 10, `extend` +10 when 2 remain (`stream = true` unless `count` given) |
| `PRACTICE` | the same keys as `fromSessionRef` | same | no; never reschedules | same |

**Again re-queue** (deterministic, applied identically by client and server): an item graded AGAIN on pass 1 is inserted again (`pass: 2`, `itemId` + `"b"`) at index `min(i + 4, items.length)` ("3 items later, or at the end if fewer than 3 remain"). Pass 2 is graded normally and does not count toward the cap again; it is never re-queued a second time.

**Time estimates**: 0.75 min per bank item (`round`, min 1), 1.3 min per puzzle, 0.5 min per weakness item (P6), lesson `durationSec/60` (P8). The plan header and CTA show the rounded sum.

### 8.7 Puzzle rating (Glicko-2, `PKG/game-core/src/rating/glicko2.ts` + `presets.ts`)

`glicko2(state: {r, rd, vol}, results: {r, rd, s}[], cfg: {tau, rdFloor, rdCeil, sigmaMax}) → {r, rd, vol}` holds **no constants**; every phase passes a preset (feasibility #11). P5 creates `presets.ts` with `PUZZLE = { tau: 0.5, rdFloor: 50, rdCeil: 350, sigmaMax: 0.1 }`; P9 adds `GAME` (its own τ 0.75 and RD floor 45) without touching the function. Glickman (2012), one rating period per attempt, opponent = the puzzle with fixed `r_j` and `RD_j = 50`; `τ = PUZZLE.tau`; scale `q = 173.7178`.

```
μ = (r − 1500)/q,  φ = RD/q,  μ_j = (r_j − 1500)/q,  φ_j = 50/q
g(φ_j) = 1 / sqrt(1 + 3 φ_j² / π²)
E = 1 / (1 + exp(−g(φ_j) (μ − μ_j)))
v = 1 / (g(φ_j)² E (1 − E))
Δ = v g(φ_j) (s − E)                                           s ∈ {1, 0.5, 0} from §8.3
σ' : Illinois iteration on f(x) = e^x (Δ² − φ² − v − e^x) / (2 (φ² + v + e^x)²) − (x − ln σ²)/τ²,  ε = 1e−6
φ* = sqrt(φ² + σ'²);  φ' = 1 / sqrt(1/φ*² + 1/v);  μ' = μ + φ'² g(φ_j) (s − E)
r' = q μ' + 1500;  RD' = clamp(q φ', cfg.rdFloor, cfg.rdCeil);  σ' = min(σ', cfg.sigmaMax), stored as puzzleVol
```

- **Seed** (once, `ratingSeeded`): `clamp((blitz ?? rapid ?? onboardingRating ?? 1200) + 300, 800, 2200)`, `RD = 250`, `σ = 0.06`. `blitz/rapid` from P4 `LinkedAccount` ratings (Chess.com, else Lichess); `onboardingRating` = P4 `initialRating` or the `ratingBand` midpoint (NEW_TO_CHESS 600, UNDER_800 700, R800_1200 1000, R1200_1600 1400, R1600_2000 1800, R2000_PLUS 2100). A blitz 1184 player starts at 1484 (design shows 1512 after a few puzzles). The +300 offset is owner decision D-3.
- "Provisional" label while `puzzleAttempts < 20`.
- **Client preview**: the runner imports `glicko2` + `PUZZLE` (≈ 1 KB, pure) and computes the same update from `header.rating {value, rd, vol}` and the item's `rating` for instant feedback ("Rating 1524 +12"); the server's `AttemptOut.rating` replaces it on flush (D-13). Own-mistake (BANK) attempts never change the rating (res §10.3 inference, R-LPZ-05).

### 8.8 Mastery dots, theme mastery, milestones (`mastery.ts`, rct-b §3.4)

- **Card mastery** (0–5): 0 = NEW, LEARNING or RELEARNING; 1 = `S < 4 d`; 2 = `4 ≤ S < 10`; 3 = `10 ≤ S < 30`; 4 = `30 ≤ S < 90`; 5 = `S ≥ 90` ("Mastered"). Stored on every card write. `aria-label` "Mastery 2 of 5".
- **Theme mastery**: per attempt in that theme (all decks), `ewma ← ewma + 0.15 · (firstTry − ewma)` (α = 0.15), `attempts += 1`, `firstTry += firstTry`. Shown as `round(100 · ewma)` % once `attempts ≥ 5`, else "New".
- **Milestones**: when `floor(ewma · 10) · 10` first reaches 50, 70 or 90 and `milestonePct` is lower → set it and return `theme.milestone` ("Milestone · forks 70%"). Also: the first perfect session (`kind: perfect`) and a new best day streak (`kind: streak`).

### 8.9 Day streak (`streak.ts`, Q13 / D-4)

- A **trained day** has ≥ 1 graded attempt (any deck; P8 adds lesson checkpoints).
- On an attempt for `day` (from `reviewedAt` in the user's zone): `gap = daysBetween(lastActiveDay, day)`; `gap ≤ 0` → unchanged (also for late offline replays of an earlier day); `gap = 1` or `2` → `dayStreak += 1` (one missed day is forgiven: "resets if you skip 2 days"); `gap ≥ 3` or no `lastActiveDay` → `dayStreak = 1`. `dayStreakBest = max`. `lastActiveDay = max(lastActiveDay, day)`.
- **Displayed** streak = `dayStreak` if `daysBetween(lastActiveDay, today) ≤ 2`, else 0. Week strip = local Mon–Sun rows of `training_days` with `bankReviewed + puzzlesDone + lessonsDone > 0`.

### 8.10 Daily plan (`plan.ts` `buildDailyPlan(inputs)`, frozen in `TrainingDay.plan`)

1. **Bank step** — up to `dueShown` cards from the BANK queue (§8.6 order), keys frozen. Title: all from one game → "Review {n} mistakes from {today's | yesterday's | Oct 27} game", subtitle "Mistake Bank · vs {opp} · ~{0.75n} min"; else "Review {n} due mistakes", subtitle "Mistake Bank · {k} games · ~{m} min". Empty bank → "Review your last game" (`/review/[ref]`, if an unreviewed analysed game exists) or "Import games" (`/settings/connected`). Status `due` → `done` when every frozen key has a graded attempt today.
2. **Puzzle step** — 3 puzzles on the **focus theme**: (P6: the top weakness mapped to a Lichess theme) → the theme with the lowest `ewma` among those with ≥ 5 attempts → the theme with the most BANK cards → `fork`. Title "3 {theme plural lowercase} puzzles at your level", subtitle "Your lowest-mastery theme · rating {R} · ~4 min". Done when ≥ 3 graded PUZZLE attempts today have `theme = focus`.
3. **Lesson step** — P8 (omitted: "0 of 2").
- `planDone` bit `i` is set in the attempt transaction; `done = popcount(planDone)`. Header "{weekday} · {Σ estMin} minutes planned". The plan never reshuffles during the day; a time-zone change keeps the row keyed by the day it was created.

### 8.11 Theme taxonomy and tagger (`PKG/chess-training/src/themes.ts`, `PKG/chess-analysis/src/themes/*`)

Keys are the **Lichess puzzle theme keys** verbatim (R-THM-01), so a bank card tagged `fork` matches CC0 `fork` puzzles; own-mistake patterns with no Lichess key use the `rc:` prefix (rct-b §3.8 table). Display labels live only in this table (R-THM-08), never generated by an LLM.

- **Tier 1 detectors** (R-THM-04; clean-room from the theme descriptions, R-THM-03): `mateIn1..3`, `mate`, `backRankMate`, `smotheredMate`, `fork` (R-THM-05: for each attacker move except the last, if the moved piece is not in a bad spot, count attacked non-pawn enemy pieces worth more than the mover or hanging and not defending the mover's square; > 1 → fork), `pin`, `skewer`, `hangingPiece`, `discoveredAttack`, `doubleCheck`, `trappedPiece`, `promotion`, `sacrifice`, `exposedKing`, `kingsideAttack`/`queensideAttack`, `advancedPawn`, `enPassant`, `castling`, the material-signature endgames (`rookEndgame`, `pawnEndgame`, …), and the eval/length/phase tags (`crushing` cp > 600, `advantage` > 200, else `equality`; `oneMove` 2 plies incl. setup, `short` 4, `veryLong` ≥ 8, else `long`).
- **Review heuristics** (`rc:*`, for review positions): `rc:recapture` (best is a recapture the played move ignored), `rc:defendedTarget` (played capture of a unit defended ≥ attackers), `rc:pawnStructure` (played pawn move creates a doubled/isolated/backward pawn, best does not), `rc:kingSafety`, `rc:development` (opening phase), `rc:missedThreat` (opponent's best reply after the played move wins ≥ 2 pawns).
- **Primary theme priority**: mates > `fork` > `pin` > `skewer` > `discoveredAttack` > `doubleCheck` > `hangingPiece` > `trappedPiece` > `capturingDefender` > other tactics > `rc:*` > endgame > phase. Meta tags (`advantage`, `short`, …) are never primary.
- **Picker set** (order): Forks, Pins, Loose pieces, Back rank, Mate in 2, Discovered attack, then (More Themes) Skewers, Remove the defender, Trapped piece, Sacrifice, Deflection, Attraction, Mate in 1, Mate in 3, Defend the threat, Rook endgame, Pawn endgame. Tier-2 detectors (deflection, attraction, …) ship as shard themes only; own-mistake tagging for them waits for a later release.
- **Bitmask** (shards): 64 bits, key ↔ bit table in the manifest; `rc:*` keys never appear in shards.
- Quality bar: ≥ 85 % recall per Tier-1 theme on 500 CC0 puzzles carrying the tag (nightly), 50 per theme committed for CI (§12.1).

### 8.12 Deterministic explainer (`PKG/chess-training/src/explain.ts`; computed at read time, dm D7)

Inputs: position, the solution line, the played move, `cpBest`, `refuteUci`, theme. Uses chess.js 1.4 (`moves({verbose:true})`, `attackers(square, color)` / `isAttacked` [V], piece values 1/3/3/5/9).

| Text | Template (examples from the boards) | `verified` |
|---|---|---|
| `correct` (fork) | "{SAN} hits the {t1}, the {t2} and the {t3} at once." + mate/material follow-up "After the king moves, {SAN2} wins the queen." | true |
| `correct` (loose piece) | "{SAN} wins the {piece}. Nothing of {opp}'s defends {sq}, and the engine rates the position about {+2.7}." | true |
| `correct` (mate) | "{SAN} is mate." / "{SAN} forces mate in {n}." | true |
| `correct` (review position) | "{SAN} keeps {idea}." from the `rc:*` key ("Qc1 keeps the queen ready to recapture on e3, so you avoid doubled e-pawns.") | true |
| `wrongGameMove` (user repeats `playedUci`) | "{playedSan} is what you played. After {refuteSan} {consequence}." | true |
| wrong, other move (puzzles) | "{SAN} {what it attacks}. Look for the square that hits {k} things." from the attack set of the wrong move | true |
| wrong, nothing specific | "Not the move. {hint}" | **false** (no VERIFIED tag) |
| `hint` | piece-specific: "Look at your {piece} on {from}. What can it see now?"; theme nudge: "Your knight can give check from two squares. One of them also hits the queen." | true |
| `look` (puzzles "This puzzle") | theme look text: "Look for one square where a piece attacks two things." | true |
| `costText` (bank context card) | "{bestSan} won {material} here, about {+2.7} for you. {playedSan} let it go." | true |

Evaluations are worded from the user's side with a sign and one decimal (`cp / 100`); `M{n}` for mate. P7 replaces the strings with verified LLM text stored in `Mistake.texts`.

### 8.13 Puzzle shards (`WEB/scripts/puzzles/build-shards.ts`, B13, rct-b §2.6)

- **Input**: `lichess_db_puzzle.csv.zst` streamed (`zstd -dc | node build-shards.ts`), columns `PuzzleId, FEN, Moves, Rating, RatingDeviation, Popularity, NbPlays, Themes, GameUrl, OpeningTags`.
- **Filter**: `Popularity ≥ 80`, `NbPlays ≥ 300`, `RatingDeviation ≤ 90`, `600 ≤ Rating ≤ 2599`, `moves ≤ 15 tokens` (alloc said 600–2400; 2599 covers members above 2000 for ≈ +4 MB on R2).
- **Buckets**: for each picker theme (≈ 30 + `mix`) × each 100-point band (`floor(rating/100)`, 6…25), keep the top **K = 250** by `Popularity × ln(NbPlays)`; tuple `[id, fen, moves, rating, themesBitmask]`.
- **Output**: `puzzles/v1/{theme}/{band}.json` (≈ 33 KB raw, ≈ 11 KB brotli each; ≈ 620 files, ≈ 20 MB), `puzzles/v1/manifest.json` (`{version:"v1", built:"2026-11-…", source:"2026-10-05", themes:{fork:{"14":250,…}}, bits:{fork:0,…}}`, ≈ 6 KB, also committed as `PKG/chess-training/puzzles/manifest.v1.json` so the server knows counts without a fetch).
- **Upload**: `upload-shards.ts` (S3 API to R2) with `Cache-Control: public, max-age=31536000, immutable`. A new corpus is a new version path (`v2`); old versions are deleted after the switch.
- **Selection at runtime**: §7.3 W2.

### 8.14 Labels (`labels.ts`, server-side in the user's zone)

`dayLabel(due, now, tz)`: same local day → "Today"; +1 → "Tomorrow"; within 6 days → weekday ("Sat"; "Saturday" in the caught-up list); else "Nov 6". `playedAtLabel`: "today", "yesterday", "Oct 27". `greetingPart`: 05:00–11:59 morning, 12:00–17:59 afternoon, else evening. `atLabel` "08:00" in 24-hour `HH:mm` (design).

---

## 9. Performance and optimisation (follows opt §2–§9)

### 9.1 Hot paths, round trips and query plans

Vercel functions run in `iad1` next to Neon `aws-us-east-1` (≈ 1–2 ms per round trip); Prisma on the pooled URL with `connection_limit=5` so a 5-statement `Promise.all` runs in parallel (opt §3.1). "RT" = sequential round trips after `getViewer()` (memoised, 1 statement).

| Path | Statements | RT | DB time target | Expected plan (asserted by `WEB/scripts/explain-hot-queries.ts` on a throwaway branch seeded with 20 members × 2,000 games, 500 mistakes, 3,000 attempts) |
|---|---|---|---|---|
| R1 `/train` (and `GET /api/train/today`) | 5 parallel (+1 read +1 write batch once per day) | 1 (+2 once/day) | < 8 ms | (a) Index Scan `training_cards_userId_deck_due_idx`, < 1 ms; (b) Index Scan `training_days_pkey`; (c) Index Scan due idx + Nested Loop `mistakes_pkey`, < 1 ms; (d) `theme_mastery_pkey`; (e) `training_profiles_pkey` |
| R2 `/train/bank` (≤ 300 cards) | 2 parallel | 1 | < 6 ms | Index Scan due idx (user range) + PK joins to `mistakes`, `games` (no `player_reviews` read) |
| R2 paged (> 300), first request | 3 parallel (rows, facets, due summary) | 1 | < 10 ms | rows: Index Scan due idx with `(due, id) > (…)`; facets: HashAggregate over the user's range, < 5 ms at 2k cards |
| R2 paged, `cursor` present | 1 (rows only) | 1 | < 3 ms | Index Scan due idx with `(due, id) > (…)` LIMIT 51 |
| Review bank fields (A1/A2 under `train`) | +1 statement in P3's read batch | +0 (parallel with P3's statements) | < 1 ms | `mistake_occurrences_pkey` (`gameId`, `ply = ANY`) + `mistakes_pkey` + `training_cards_mistakeId_key` |
| A6 toggle | P3's opt-out write + 1 read + 1–3 writes in one `$transaction` | 2 | < 5 ms | `player_reviews_pkey`, `mistake_occurrences_pkey`, `training_cards_userId_itemKey_key`, `theme_mastery_pkey` |
| W2 BANK | 3 parallel reads + 1 write tx | 2 (+1 idempotency) | < 15 ms | due idx LIMIT 50 + `mistakes_pkey`; session insert |
| W2 PUZZLES | profile + day + due PUZZLE cards ‖ shard fetch (0 ms LRU hit / ≤ 120 ms R2 miss) → exclusion query → insert | 3 | < 15 ms DB | `training_attempts_puzzle_idx` (partial) with `= ANY($500 ids)`, < 2 ms |
| W1 attempts (1–50 items) | interactive tx: dup check, cards `FOR UPDATE`, mastery read, 4–6 writes | ≈ 7 (inside the tx) | < 20 ms | `training_attempts_clientAttemptId_key`, `training_cards_userId_itemKey_key`, PK upserts (HOT on `training_days`, `theme_mastery`, `training_profiles` thanks to `fillfactor 80`) |
| R3 / W4 summary | session PK + attempts range | 1 | < 4 ms | `training_sessions_referenceId_key`; Index Scan `training_attempts_userId_reviewedAt_idx` bounded by `startedAt`, filter `sessionId` |
| HOME-1 `/home` | 6 parallel (h6 cached) | 1 | < 10 ms | `game_players (userId, endedAt DESC, gameId DESC)` LIMIT 3 + LATERAL PKs; due idx; PK ranges |
| `getMe()` badge | +1 count inside the shell CTE | 0 extra | < 1 ms | due idx |
| J1 extraction (worker, Mumbai → Neon ≈ 200 ms/RT) | appended to P3's one-request `sql.transaction([...])` batch: 9 set-based statements (`jsonb_to_recordset`), plus one `LEFT JOIN training_profiles` folded into P3's load statement | **+0 round trips**, +0 transactions | < 50 ms server time for the whole batch at 2 members × 4 mistakes | unique `mistakes_userId_epdHash_key`, `mistake_occurrences_pkey`, `training_cards_userId_itemKey_key`, `player_reviews_pkey`, `theme_mastery_pkey` |
| W1 during a concurrent J1 commit | as W1 | as W1 | W1 p95 < 300 ms (lock wait ≤ the batch's server time) | — (`attempts.int.test.ts` concurrency case) |

The script fails when a hot query shows a `Seq Scan` or a `Sort` on `training_cards`, `training_attempts`, `mistakes`, `mistake_occurrences` or `game_players`, when it exceeds its limit, or when any index named in §6.5 is missing from `pg_indexes` (api-perf §5). It runs on every migration PR in CI against Docker Postgres, and weekly by manual dispatch (opt §3.5.4).

### 9.2 Caching layers

| Layer | P5 use | Invalidation |
|---|---|---|
| CDN (Cloudflare R2 public bucket) | puzzle shards and manifest, `public, max-age=31536000, immutable` | new version path |
| Next data cache (`fetch(url, { cache: "force-cache" })`) | shard fetches from the server, keyed by the versioned URL (shared across Vercel instances) | version path |
| Module-scope LRU (`lru-cache`, 50 shards ≈ 1.6 MB parsed) | `puzzles.server.ts`; allowed because shards are immutable for the life of a deployment (opt §4.5) | process lifetime |
| `unstable_cache` + tag | Home `new_user` featured position (`positions` tag, P8 admin writes revalidate) | `revalidateTag("positions")` |
| React `cache()` | `getViewer()`, `getMe()`, `getTrainingProfile(viewer)` within one request | request |
| Router cache (`staleTimes.dynamic = 30`) | Back/Forward between P5 pages | 30 s |
| TanStack Query | §5.1 keys and stale times | §5.3 |
| HTTP | every P5 JSON route `private, no-store` (rct-b §4.0); no per-user response carries `max-age > 0` (api-perf AP-04) | — |
| Service worker | **none added by P5**; `/api/*` and RSC requests stay NetworkOnly (P1 H8). P11 adds the per-user `rc-pages:u:<ref>` document cache for the two runner paths (api-perf AP-34) | P11: `SET_USER`, other users' caches deleted on ref change, sign-out purge |
| Never cached | due counts, sessions, attempts, Home (opt §4.10) | — |

### 9.3 Puzzle shard loader (`WEB/lib/train/puzzles.server.ts`)

`getShard(theme, band)`: LRU hit → return; else `fetch(\`${PUZZLE_SHARD_BASE_URL}/${PUZZLES_VERSION}/${theme}/${band}.json\`, { cache: "force-cache", signal: AbortSignal.timeout(2500) })`, parse once (tuples → typed objects lazily), insert into the LRU. Two shards are fetched in parallel per session build. Failure → one retry after 200 ms → 502 `upstream_unavailable`. A cold build (2 misses) costs ≈ 60–120 ms (Vercel iad1 → Cloudflare edge); warm ≈ 0 ms. Budget: W2 PUZZLES p95 < 400 ms cold, < 250 ms warm (alloc P5). **Tests never hit R2**: CI and local Playwright runs set `PUZZLE_SHARD_BASE_URL=http://127.0.0.1:4012/puzzles`, served by `WEB/e2e/mocks/puzzle-shards.ts` (a Playwright `webServer` entry) from a committed 6-theme × 3-band subset in `PKG/chess-fixtures/puzzles/shards/v1/`. A browser-level `page.route` would not work here because the fetch runs on the server (feasibility §10.11 item 5, mechanism adjusted). Only the post-deploy smoke (§12.4) reads the real R2 objects.

### 9.4 Payload budgets (asserted by `CT/http/train.size.test.ts`, opt §5.1)

| Payload | Raw | gzip | Notes |
|---|---|---|---|
| `GET /api/train/today` | ≤ 4 KB | ≤ 1.5 KB | 4 preview FENs dominate |
| `GET /api/train/bank` 50 rows / 300 rows | ≤ 14 KB / ≤ 80 KB | ≤ 4 KB / ≤ 25 KB | FEN ≈ 60 B/row; labels precomputed; no solution |
| `POST /api/train/sessions` 10 items / 20 items | ≤ 10 KB / ≤ 20 KB | ≤ 3.5 KB / ≤ 7 KB | solutions + 4 previews + 4 after-Again previews + texts per item |
| `analysis:done` with the bank fields | ≤ 200 B | — | P3's size test raised from 160 B (`bankAdded` ≤ 4 plies) |
| `bank:due_changed`, `mistakes:added`, `analysis:batch` | ≤ 120 B each | — | `CT/socket/user.size.test.ts` |
| `POST /api/train/attempts` body, 50 items | ≤ 16 KB | — | 64 KB route limit |
| `AttemptsResult`, 50 items | ≤ 10 KB | ≤ 2 KB | |
| `GET /api/home` | ≤ 6 KB | ≤ 2.5 KB | |
| `GET /api/me/badges` | ≤ 100 B | — | |
| R2 shard (250 tuples) | ≈ 33 KB | ≈ 11 KB (brotli) | server-side only; the browser never downloads shards |
| RSC flight for `/train`, `/home` | ≤ 12 KB | — | DTOs only, never Prisma rows (opt §3.2) |

### 9.5 Bundles (route-level First Load JS, gzip; budgets from rct-b §5.4 and opt §5.7)

| Route | Budget | How |
|---|---|---|
| `/home`, `/train`, `/train/bank`, summary | ≤ 90–100 KB page-specific, app-list total ≤ 260 KB | no chess.js on these routes: thumbnails are server-rendered SVG `MiniBoard`; `playedSan` computed on the server; filters are plain arrays |
| Runner (`/train/bank/session`, `/train/puzzles`) | ≤ 155 KB page-specific, board-route total ≤ 300 KB | P2 board + chess.js (≈ 40 KB) + `idb-keyval` (≈ 0.6 KB) + `@repo/chess-training/{grade,labels,items}` + `@repo/game-core/rating` (≈ 1 KB); **no ts-fsrs** (previews, including after-Again ones, arrive in the payload), **no zod in production chunks** (`devSchema()`), **no Stockfish WASM, no socket.io-client on the runner** (the user-channel socket loads lazily from the shell) |
| Theme picker, report dialog, sheets | lazy (`next/dynamic`) | |

`scripts/check-bundle-budgets.mjs` fails CI over budget (blocking from P1, api-perf §2.10) and asserts that `ZodError` and `ts-fsrs` strings are absent from the P5 route chunks; a lint `no-restricted-imports` forbids `ChessBoard`, `useStockfish`, `ts-fsrs` and `@repo/chess-training` barrel imports under `app/(app)/train/**`, `app/(app)/(immersive)/train/**`, `app/(app)/home/**`, `components/train/**` and `features/train/**`.

### 9.6 SLOs and how they are measured

| Metric | Target | Measured by |
|---|---|---|
| R1 class (`/api/train/today`, `/api/home`, `/api/me/badges`, `/api/train/themes`) server time | p50 25 ms, **p95 ≤ 100 ms** | route wrapper `Server-Timing: total` → Sentry span `api.duration_ms{route}`; k6 `api-read-mix.ts` (30 RPS) p95 < 250 ms end-to-end from the k6 runner (alloc P5) |
| R2 class (`/api/train/bank`, `/api/train/sessions/:ref`) | p95 ≤ 160 ms | same |
| W1 attempts | p50 40 ms, **p95 ≤ 150 ms** at 20 RPS sustained | k6 `train-session.ts` (20 VUs, 10 attempts per session with 3–6 s think time, 20 % sent as batches of 5) |
| W2 sessions | BANK p95 ≤ 250 ms; **PUZZLES p95 < 400 ms with a cold shard LRU** | k6 `train-session.ts` with a fresh deployment |
| Perceived grade latency | 0 ms (optimistic) | — |
| Move → verdict | ≤ 16 ms desktop, ≤ 33 ms mid-tier phone | `performance.mark("rc:train-move")` → `measure` → **Sentry metric** `train.move_verdict_ms{route_class, device_class}` (no user id; not consent-gated under P11's "essential, no PII" rule, owner decision recorded in P11 §14; api-perf AP-15); Playwright perf smoke with 4× CPU throttle (lab gate) |
| Grade → next board visible | ≤ 50 ms desktop, ≤ 100 ms phone (opt §2.4) | Sentry metric `train.grade_to_next_ms{route_class, device_class}`; the same Playwright perf smoke |
| Hub/Home page DB time | ≤ 15 ms p95 | Sentry `transaction:/train` and `transaction:/home` spans from P1's Prisma timing extension (RSC pages cannot set `Server-Timing`, api-perf AP-14); `tracesSampler` 1.0 on dev, 0.1 on production |
| Hub/Home TTFB | US ≤ 600 ms, India ≤ 900 ms p75 | Vercel Speed Insights with `sampleRate={0.2}` on Hobby (10k events / 30 days, feasibility F-VER-5); PostHog web-vitals as the second source |
| CLS on runner pages | ≤ 0.02 (board size from CSS, never after hydration) | **lab gate** (field data cannot segment by zoom, api-perf AP-35): Playwright layout-shift observer at 80–150 % zoom on the device matrix; Speed Insights for the 100 % field value |
| Review-ready → bank cards and game-over line | cards exist when `analysis:done` arrives (same batch) | worker metric `worker.extract.ms`; server-side review-ready `worker.review_ready_ms{band}` (P3) |
| First paint requests | 0 `/api/*` requests at first paint of `/home`, `/train`, `/train/bank` | `e2e/specs/request-budget.spec.ts` |
| Invocations for a 10-item drill | ≤ 5 (1 page render + ≤ 4 attempt batches; flush policy §5.4) | `request-budget.spec.ts` |
| Home refetches during an import backlog | ≤ 1 `GET /api/home` per 30 s while visible, 0 while hidden | `home-backlog.spec.ts` (emits 50 synthetic `analysis:batch`/`mistakes:added` events through `/internal/emit` in 60 s and counts requests) |
| Invocations per active member per day (P5 share) | ≤ 12 (hub render, 1 W2, 2–4 W1, 1 W4, summary, Home render, 1–2 throttled refetches) | weekly: Vercel usage API `functionInvocations` for `/api/train/*`, `/api/home`, `/train*`, `/home` ÷ members with ≥ 1 server `train_attempts_applied` that day (server event, not consent-gated; api-perf AP-35) |

### 9.7 Free-tier impact (alloc §1.5)

| Resource | P5 effect | Guard |
|---|---|---|
| Vercel invocations (Hobby 1M/month) | a daily session ≈ 1 hub render + 1 W2 + 2–4 W1 + 1 W4 + 1 summary ≈ 7 | debounced flush; no polling; `staleTimes` |
| Neon CU-hours | no timers, no polling (the badge refetches on focus only), no recurring job; the 08:00 refresh is client-side and only for visible tabs; the worker writes inside the existing analysis batch; Home/Train refetches are throttled to 1 per 30 s per visible tab | nothing wakes Neon without a user or an analysis. Dev runs on its own Neon project from P1 (api-perf AP-01), so the B-M5-1 backfill and k6 runs cannot spend production's CU-hours |
| Vercel Hobby quotas on `replay-chess-dev` | E2E: the 40-project matrix runs nightly against `next start` in CI, the deployed dev URL gets the smoke subset only (desktop-1440 and iPhone at 100 %) and one full run a week (feasibility F-VER-3); k6 runs only after checking the usage page | hard stop for test traffic at 60 % of any Hobby quota (feasibility F-VER-2), checked by P1's weekly ops workflow |
| OCI socket box (1 OCPU) | `analysis:progress` only for priority ≥ 80 jobs; backlog bank changes ride on P3's coalesced `analysis:batch` (≤ 1 per user per 60 s); emits to empty rooms are dropped early | api-perf AP-10 |
| Neon storage | ≈ 1.8 MB per typical member-year for P5 tables (dm §10.2: mistakes + occurrences 0.51, cards 0.40 → fewer here because only key moments get cards, attempts 0.79, sessions + days 0.07) | 90-day session prune; `plan` nulled after 7 days; attempts kept (optimiser) — a monthly-aggregate prune after 18 months is P13+ |
| R2 | ≈ 20 MB shards, free egress | versioned paths, old versions deleted |
| OCI worker CPU | ≤ 6 s per analysed game for line extension (puzzle candidates only); backfill at backlog priority | `BANK_LINE_NODES`, `BANK_EXTRACT_ENABLED` kill switch |

---

## 10. Telemetry

### 10.1 PostHog events (snake_case `area_object_action`; consent-gated on the client; `distinct_id = User.referenceId`, arch X14; every client event carries the super-properties `device`, `viewport_w`, `zoom_bucket`, `is_trial`, `app_env`)

Typed helpers in `WEB/lib/analytics/train-events.ts` (one function per event, so property names cannot drift), backed by closed zod schemas in `packages/analytics/src/events/train.ts` and `events/home.ts` (P1's registry, testing X6). No FENs, SAN or UCI moves, opponent names or free text in properties; the P1 PII guard fails a spec on any of them, and P5 specs additionally register every solution SAN they play with `telemetry.forbid(san)`. P5 owns `train_session_started` / `train_session_completed`; P6 reuses them and only adds `kind: "weakness"` (consistency R-18).

| Event | Properties | Fired from |
|---|---|---|
| `home_viewed` | `state` (populated, new_user, import_running), `due`, `has_continue` | Home mount |
| `home_continue_clicked` | `kind` (review, first_legend, analysing) | Continue / Start here |
| `home_bank_cta_clicked` | `due` | Bank card CTA |
| `home_import_clicked` | `surface` | new-user CTAs |
| `train_hub_viewed` | `state`, `due_shown`, `due_raw`, `plan_done`, `plan_total`, `streak` | hub mount |
| `train_hub_link_clicked` | `target` (bank, puzzles, step_1, step_2, thumb) | hub |
| `train_plan_started` | `steps`, `est_min`, `resumed` | Start/Continue Today's Plan |
| `train_plan_step_completed` | `step`, `kind` | from `AttemptOut.planDone` change |
| `train_session_started` | `kind`, `source`, `theme`, `size`, `items`, `counts_toward_cap`, `resumed`, `widened` | runner mount |
| `train_item_shown` | `kind`, `theme`, `rating`, `pass`, `index` | each item |
| `train_hint_used` | `step` | Hint |
| `train_wrong_move` | `kind`, `is_game_move` | wrong |
| `train_solution_shown` | `kind`, `after_wrong` | Solution |
| `train_item_graded` | `grade`, `suggested`, `overridden`, `first_try`, `hints`, `wrongs`, `time_ms`, `interval_days`, `kind`, `pass`, `offline` | grade |
| `train_item_skipped` / `train_item_reported` | `kind` / `kind`, `reason` | menu |
| `train_attempt_conflict` | `kind` | outbox result |
| `train_session_completed` / `train_session_abandoned` | `kind`, `solved`, `total`, `perfect`, `duration_s` | done / unmount with items left |
| `train_summary_next_clicked` | `target` | summary |
| `bank_viewed` | `state`, `due`, `total`, `complete` | bank mount |
| `bank_filter_applied` | `theme`, `phase`, `source`, `results` | Show {n} |
| `bank_solve_one_clicked` / `bank_see_in_game_clicked` / `bank_card_removed` | `mastery` / — / `undo` | bank |
| `puzzle_theme_changed` | `from`, `to`, `pct`, `surface` (picker, url) | S6 |
| `puzzle_rating_changed` | `delta`, `rating`, `provisional` | outbox result |
| `theme_milestone_reached` / `streak_extended` / `streak_reset` | `theme`, `pct` / `days` / `days_before` | outbox result |
| `train_offline_flush` | `items`, `max_age_s`, `duplicates` | outbox flush after offline |
| `game_over_bank_line_shown` | `count`, `mode` (bot, friend, online, tournament) | `GameOverBankSlot` first render with `count > 0` |
| server: `train_attempts_applied` | `n`, `ok`, `duplicates`, `conflicts`, `rejected`, `batch_ms` | W1 `after()` |
| server (worker): `mistakes_extracted` | `candidates`, `puzzles`, `review_positions`, `cards_added`, `recurrences`, `extract_ms`, `source` (live, import, backfill) | J1 |

Rev 1's `perf_train_move_verdict` / `perf_train_grade_to_next` PostHog events are replaced by the Sentry metrics of §9.6, because PostHog is consent-gated after P11 and would bias the SLO sample (api-perf AP-15). PostHog keeps funnels only.

Funnels to build on day one: game over (bank line shown) → Review → Review complete → Drill (`drill_from_review_clicked` P3 → `train_session_started{source:review_complete}` → `train_session_completed`); Home → Train → plan step 1 done; day-7 retention by `train_session_completed`.

### 10.2 Sentry

- **Spans**: the wrapper's `api <id>` per route (`train.today`, `train.bank`, `train.sessions.create`, `train.attempts`, …) tagged `class`, `kind`; child spans `db` (Prisma timing extension, opt A.2), `shard.fetch`, `session.build`, `fsrs.apply`. `tracesSampler`: `train.attempts` 0.05 (volume), other P5 routes 0.1 (api §2.13).
- **Metrics**: `train.attempts.batch_size`, `train.attempts.conflicts`, `train.attempts.duplicates`, `train.session.build_ms{kind}`, `train.shard.cache{hit|miss}`, `train.shard.fetch_ms`, `train.outbox.age_s` (client, on flush), `train.move_verdict_ms` and `train.grade_to_next_ms` (client, `{route_class, device_class}` only), `home.refetch{cause}` (client, throttled refetches by event type), worker `worker.extract.ms`, `worker.extract.candidates`, `worker.extract.line_searches`, `worker.extract.batch_server_ms`.
- **Errors**: 5xx captured with `requestId`; the client captures a stored solution that fails chess.js validation (`train.item_broken`, with `itemKey` but no FEN) and the auto-report is filed; outbox flush failures are breadcrumbs (not exceptions) until 3 consecutive failures; `Sentry.setUser({ id: viewer.ref })`, never the email (`sendDefaultPii: false`).
- **Alerts** (opt §9.8): R1 p95 > 200 ms for 15 min; W1 5xx > 1 % over 15 min; `train.attempts.conflicts` > 5 % of attempts per day (a bug signal, not users); worker `EXTRACT_MISTAKES` failures > 0 for 1 h.

---

## 11. Security, privacy, paywall and authorisation

| Rule | Implementation |
|---|---|
| Members only | pages: `requireMemberPage()` (DB entitlement via cached `getMe()`, cdl §2.4; layouts do not re-run on soft navigation, so every page checks); APIs: `route({ auth: "member" })`; middleware claim gating (P1) as the fast path. Non-member → `/pricing?reason=<trial_available, trial_used, expired or payment_failed>&redirect_url=<path>` (B26 default: hard redirect, data kept) |
| Ownership | every query is scoped by `"userId" = viewer.id`; session refs, card refs (`itemKey`), mistake refs, moment ids from another user → **404** (never 403, api §2.6); A6 additionally requires the viewer to be a player of the game (P3 rule: analysis private to players) |
| Hidden information | `BankRow` is a `strictObject` without `bestSan`/`solution` ("best move hidden until you try"); the session payload must carry solutions for local validation (rct-b D3) — acceptable: the viewer is the only one who can read it and drilling is self-assessment |
| Rating integrity | the puzzle rating uses the server's objective score from the attempt flags; puzzle rating/theme come from the session snapshot, not the client; `wrongMovesUci` must not contain the expected move at the first wrong index (otherwise `rejected/bad_item`); ratings are personal (no leaderboards in P5), so a self-inflating client only fools itself. Bank attempts never touch the rating |
| Input validation | zod `strictObject` on every body; UCI regex; `reviewedAt` clamped to `[now − 7 d, now + 5 min]`; `timeMs ≤ 1 h`; ≤ 50 attempts and ≤ 64 KB per batch; time zone validated against `Intl.supportedValuesOf("timeZone")`; report note ≤ 500 chars, stored as text and rendered escaped (admin queue is P12) |
| Abuse limits | `train-write` 120 / 60 s (burst); `train-session` 30 / 3600 s (durable, counted from `training_sessions`); `report-burst` 5 / 60 s + `report` 20 / 86400 s (durable, counted from `reports`); daily puzzle fair use 400 (durable, `training_days.puzzlesDone`). None of the long windows lives in the `UNLOGGED` bucket, so a Neon suspend cannot reset them (api-perf AP-11) |
| Idempotency | W2 `Idempotency-Key` (P2's `idempotency_keys` table, M2i; 24 h, request-hash check → 422 on reuse); W1 `clientAttemptId` unique; W7 key; the outbox never double-applies (Web Locks + unique index) |
| Cross-site | cookie-authenticated mutations check `Origin` (P1 middleware → 403 `forbidden`); no CORS on P5 routes |
| Internal calls | worker and web → `/internal/emit` through the shared helper in `CT/internal/auth.ts` (P2's scheme; per-caller event allow-list if AP-44 is adopted: the worker may emit only `analysis:*`, `bank:*`, `mistakes:*` among P5's events); the web never trusts a user id from a socket payload |
| GET purity | only R1 writes on a GET (registered `daily_plan`); session-creating **pages** are never prefetched (§5.1), and their create is idempotent (ACTIVE reuse) and rate-limited (durable `train-session`) |
| Privacy | PII stays out of PostHog/Sentry (§10); bank rows hold `lastOpponentName` (a public in-game display name) — P10's account deletion must anonymise it to "Deleted player" when that opponent deletes their account (hand-off note) and must delete every P5 private table (all `onDelete: Cascade` from `User`); the data export (P10) includes `mistake_bank.json` and `training_history.json` (arch §3.3.6); the outbox and `rc-offline` are per user and cleared at sign-out; the SW never stores `/api/*` |
| Lapsed members | outbox items are kept on the device (≤ 500, 14 days) and accepted up to 7 days old after renewal; FSRS cards resume where they were (rct-b Q22) |
| Licences | Lichess puzzles CC0 (credit line shown); the tagger and puzzle-line code are clean-room re-implementations of documented behaviour, not translations of AGPL `lichess-puzzler`/`cook.py` (R-THM-03); ts-fsrs MIT. **Clean-room process written down** (feasibility LIC-4): `PKG/chess-training/CLEANROOM.md` and the P5 section of `PKG/chess-analysis/CLEANROOM.md` list every source used (the theme descriptions on lichess.org/training/themes, `research_notes/implementation.md` formulas, Glickman 2012, the FSRS papers and ts-fsrs docs); constants come from documentation, not code; the implementer of WP-C does not open AGPL source during the work, and the PR template asks them to confirm it. P1's CI licence check (`license-checker --failOn "AGPL;GPL"` over production npm dependencies, `stockfish` allow-listed as a separate asset) covers the new dependencies (`ts-fsrs`, `sqids`, `idb-keyval`, `lru-cache`, all MIT/ISC) |
| Copy that implies data | "We find mistakes in your last 100 games" must be true for the import window P4 ships (50 newest analysed at once, the rest in the backlog); if P4's window differs, the copy uses the real number |

---

## 12. Testing

Runners and layout follow testing X1: `node:test` via `tsx --test` for pure logic (SPEC D13), unit files beside the source as `*.test.ts`, DB-backed files as `*.int.test.ts` or under `WEB/test/api/**` (run by `test:int` against a **Docker Postgres 17** service in CI with `prisma migrate deploy`; arch §5.4; never Neon, to save CU-hours), Playwright for journeys and the P1 device × zoom matrix (`playwright.devices.config.ts`: 8 devices × 80/100/110/125/150 %; PR tier 4 projects, nightly all 40 on `next start` in CI, deployed-dev smoke subset only), k6 against the **dev** deployment only. The E2E suite runs with the paywall **on** (X3), the console/hydration guard (X7) and the telemetry sink (X6) as auto-use fixtures, and server time through `x-rc-now` (X5). Every spec carries `@p5` and the `@state:`/`@demo:` tags of the boards it reaches (X8, X11).

### 12.1 Unit tests

| File | Cases |
|---|---|
| `PKG/chess-training/src/fsrs.test.ts` | new-card previews with fuzz off: Again 10 min, Hard 2 d (custom strategy), Good 4 d, Easy 9 d; fallback config gives Hard 15 min; second review of a Good card on its due day ≈ Hard 13 / Good 19 / Easy 32 d (measured golden values, ±0 with fuzz off); fuzz on stays inside `get_fuzz_range`; `maximum_interval` 180 caps; lapse → RELEARNING with a 10 min step; `previewAll` labels ("< 10 min", "1 day", "4 days", "2 weeks", "3 months") |
| `PKG/chess-training/src/fsrs.property.test.ts` (testing P5 gap) | 1,000 random card states (fixed seed, fuzz on and off): intervals ordered Again < Hard ≤ Good ≤ Easy; `due ≥ reviewedAt`; `maximum_interval` (180 d) never exceeded; the release snap never moves a card **earlier** than its unsnapped due and keeps the local calendar day; `previewAfterAgain` equals `previewAll(next(card, Again))` |
| `release.test.ts`, `tz.test.ts`, `day.test.ts` | `dayKey` with `dayStartHour` 4 (02:00 belongs to yesterday); `nextRelease` before/after 08:00; snapping keeps the calendar day; sub-day intervals unsnapped; `zonedToUtc` across Europe/London 2026-10-25, America/New_York 2026-11-01 (ambiguous 01:30 → earlier instant), a spring-forward gap, Asia/Kolkata, Australia/Lord_Howe (30-min DST), Pacific/Chatham, Etc/UTC |
| `grade.test.ts` | the 5-row table of §8.3 (suggested grade, note, firstTry, Glicko score, solve-streak effect); override flag |
| `caps.test.ts` | `dueShown`/`waiting`/`capRemaining` formulas incl. new-card sub-cap; explicit picks and practice bypass; once-a-day `scheduled` rule (due, learning, explicit pick, already reviewed today) |
| `session.test.ts` | composition per kind; retrievability ordering; NEW intake newest-first; puzzles 30 % due interleave, rating-ascending batch, ±100 widening and `mix` fallback with `widened`; exclusion of recently seen ids; extend dedupe; requeue index `min(i+4, len)` and no second requeue; practice previews null |
| `plan.test.ts` | bank title rules (one game today/yesterday/dated, several games, empty bank → review/import); focus-theme order; estimates sum = header minutes; 2-step plan without lessons ("0 of 2"); frozen plan unaffected by later due changes; step completion rules |
| `streak.test.ts` | gaps 0, 1, 2, 3; best; a late offline attempt for yesterday does not reset today's streak; displayed streak decays after 2 missed days |
| `mastery.test.ts` | dot buckets at S = 3.99/4/9.99/10/29.99/30/89.99/90; EWMA α 0.15; "New" below 5 attempts; milestone 70 fires once and never again after dropping and re-crossing |
| `themes.test.ts` | every key has a label/group; picker order; bitmask round trip; `rc:*` never in shard bits |
| `explain.test.ts` | the fork sentence names the right targets on 10 CC0 fork puzzles; loose-piece, mate, review-position templates on the `V3BankSession` positions (exact design strings for Rxf5, Qc1, Ne2); generic fallback is `verified: false` |
| `labels.test.ts`, `items.test.ts` | day labels in three zones; itemKey sqids round trip; foreign prefixes rejected |
| `PKG/game-core/src/rating/glicko2.test.ts` | Glickman (2012) worked example with `tau: 0.5` (r 1500, RD 200, σ 0.06 vs 1400/30, 1550/100, 1700/300, scores 1, 0, 0 → r′ ≈ 1464.06, RD′ ≈ 151.52, σ′ ≈ 0.05999); per-preset reference vectors for `PUZZLE` (RD floor 50, ceiling 350, σ cap 0.1); the function contains no constants (a test passes a custom config and checks it is honoured); win vs a higher-rated puzzle raises the rating, loss vs a lower one lowers it; seed clamp 800–2200 (in `chess-training`, not the module) |
| `PKG/chess-analysis/src/bank/candidates.test.ts` | judgement set; inaccuracy ≥ 7 Win% and the 10–90 window; book and first-6-ply skip; top-4 by ΔWin; key-moment union; `colorUnknown` games skipped; `MISSED_PUNISH` mapping |
| `PKG/chess-analysis/src/bank/candidates.positions.test.ts` (testing X13) | derives "becomes a bank item" for every row of P3's shared corpus `PKG/chess-fixtures/grades/positions.jsonl` from its expected grade (inaccuracy ≥ 7 Win% inside 10–90, mistakes/blunders/misses, book and first 6 plies skipped) and compares with `selectCandidates()`; the same corpus feeds P3's grades and P6/P7, so labels cannot drift |
| `WEB/lib/realtime/invalidateThrottled.test.ts` | fake clock: 100 events in 30 s → one trailing invalidation; events across two windows → two; hidden document → `refetchType: "none"`; different keys are independent |
| `WEB/lib/train/clock.test.ts` | every exported service accepts `now` and gives the same result for the same `now` regardless of the real clock (runs each service under two different `Date.now()` mocks); the ESLint rule banning `Date.now()`/`new Date()` in `lib/train/**`, `lib/home/**` is active (lint fixture) |
| `PKG/chess-analysis/src/puzzle/*.test.ts` | `validAttack` (no second move, mate-in-1 with other mates, gap > 0.5 vs 0.49), "too winning" skip, < 2 legal moves skip, line trim to odd length, final only-move dropped, one-mover allowed for own mistakes, repetition stop, `MAX_LINE_PLIES` |
| `PKG/chess-analysis/src/themes/*.test.ts` | per Tier-1 detector: 50 committed CC0 puzzles carrying the tag (recall ≥ 85 %) and 50 without (precision tracked); `rc:*` heuristics on the design positions ("Recapture first", "Defended pawn", "Pawn structure") |
| `epd.test.ts` | EPD drops the move counters; transposed move orders hash equal; signed int64 range |
| `WEB/lib/offline/outbox.test.ts` | enqueue → flush → partial results settle; duplicate/conflict/rejected dropped; 402 stops and keeps items; two "tabs" (Web Locks stub) never double-send; cap 500; stale flag after 14 d |
| `WEB/lib/train/dto.test.ts` | every DAL output parses with its contract schema (fixtures from the seed) |
| `WEB/lib/billing/return-url.test.ts` (existing) | `/home` and `/train` allowed |

### 12.2 API contract and integration tests (`WEB/test/api/train/*.test.ts`, run by `test:int` on Docker Postgres, seeded fixtures; time from `ctx.now`)

| Route | Cases |
|---|---|
| auth matrix (every P5 route) | signed out → 401; E2E-style non-member → 402 with `reason`; another member's session/card/mistake/moment ref → 404; malformed JSON → 400 `invalid_json`; unknown field → 400; oversize → 413; 429 carries `Retry-After` (api Appendix D) |
| W1 attempts | same `clientAttemptId` twice → `duplicate`, card unchanged; stale `cardReps` → `conflict`, no attempt row; lapsed member → 402 for the batch; `bankReviewed` increments only on the first grade of a BANK card today and only in counting sessions; `newIntroduced` only for NEW; practice attempt logs with `scheduledDays = null` and leaves the card; offline batch of 3 replayed in `reviewedAt` order with `now = reviewedAt`; `reviewedAt` 10 days old → clamped, 15 days with `stale` → `rejected/too_old`; AGAIN pass 1 appends a pass-2 item to the session; plan bit set when the last frozen card is graded; streak +1 once per day; theme milestone returned once; PUZZLE attempt updates Glicko and creates a PUZZLE card only for AGAIN/HARD (D-6); a 50-item batch < 150 ms on the CI database; **concurrency** (api-perf AP-27): a loop commits J1 batches for the same user's games while 200 W1 batches run → W1 p95 < 300 ms, no deadlock, no lost `theme_mastery` update (two "devices" flushing different cards of the same theme end with `attempts` = the sum) |
| W2 sessions | `Idempotency-Key` replay returns the same body with `Idempotent-Replayed: true`; same key + different body → 422; ACTIVE reuse within 2 h, new session after 2 h or when fully graded; explicit `cardRefs`/`gameRef` reuse only with the same key set and always have `countsTowardCap = false`; `practice` never reuses; cap reached → 201 `items: []`, `empty: "cap_reached"`; PUZZLES with a mocked shard server (cold + warm), widening, 400/day → 429, R2 down → 502; theme switch abandons the previous ACTIVE puzzles session; **durable session limit**: the 31st new session within an hour → 429 with `Retry-After`, a reuse is not counted, and the limit still holds after `TRUNCATE rate_limit_buckets` (simulated Neon suspend, api-perf AP-11); every item has `previewAfterAgain` unless practice |
| W3/W4/R3 | extend idempotent on `after`; extend on an ended session → 409 `session_ended`; end twice → same summary; resume index skips graded items; summary grade table medians, `perfect` rule (≥ 3 items, all first try) |
| R1 today | plan created once and frozen across calls; two concurrent first reads produce one plan (`COALESCE`); with `ctx.now` at 03:59 local an attempt counts for the previous day and at 04:01 a new row is created; `nothingdue` when both steps done; new-user steps; time-zone change keeps today's row; **GET purity**: the statement counter sees only the two registered `daily_plan` writes, and none on the second call |
| R2 bank | ≤ 300 → `complete: true` with every row; 301 → paged 50 with a stable cursor while cards are graded in between (no row skipped or repeated); facets via `GROUPING SETS` equal the in-memory facets; **a request with `cursor` returns `BankNextPage` only and runs one statement** (api-perf AP-38); `state` empty/caughtup/default; `gamePly` = the mistake's `lastPly`; schema test asserts no `solution`/`bestSan`/`bestUci` key anywhere in the JSON |
| Review bank fields (P3 A1/A2 under `train`) | `MomentDTO.inBank` is true exactly for moment plies with a live card; after W6 on one of them the A1 ETag changes (via `player_reviews."updatedAt"`) and the tag reads "Not added"; `ReviewStatusDTO.bank = {count, plies}` matches `analysis:done.bankAdded`; A2's ETag changes when the count does; `train` off → `bank: null` |
| W5/W6/A6/W7/W8 | skip moves the card to "Tomorrow" and out of due counts; remove hides the mistake, deletes the card, decrements `bankCount`, bumps `player_reviews."updatedAt"`; A6 off → ply added to `progress.bankOptOut` (P3 set semantics, idempotent), mistake hidden, card deleted, `bankCount − 1`; A6 on → ply removed from `bankOptOut`, mistake un-hidden, NEW card due at the next release; A6 on a game not extracted yet → `card: null`, opt-out recorded, and a later `EXTRACT_MISTAKES` run respects it; A6 on a non-moment ply or a non-error moment → 404; report dedupe within 24 h; the 21st report in 24 h → 429 even after `TRUNCATE rate_limit_buckets`; report on a foreign mistake → 404; W8: each pref field validated, `newPerDay > bankDailyCap` → 400, an unknown time zone → 400 |
| HOME-1 | populated / new_user / analysing / clean variants from fixtures; `import` block from a P4 fixture |
| Worker (`WK/test/extractMistakes.int.test.ts`, fake engine answering from a fixture map, arch §5.4; the batch runs through the same `sql.transaction([...])` code path as production, against Docker Postgres through P3's worker DB test harness (a local Neon HTTP proxy container), so the "no statement reads another's `RETURNING`" rule is actually exercised) | analysing a fixture game writes the expected `Mistake`, `MistakeOccurrence`, cards (moment plies only) and `bankVersion = 1` **in P3's single batch** (one HTTP request observed); a moment ply listed in `progress.bankOptOut` gets no card; the same position in a second game dedupes (`occurrences = 2`, `last*` updated, card `due` pulled to the next release); hidden mistake gets no card; re-running the job is a no-op; a changed best move resets the card; `analysis:done` carries `bankAdded {count, plies}` and `bankDue`, and **no** `mistakes:added`/`bank:due_changed` is emitted on this path; `EXTRACT_MISTAKES` backfill on a P3-analysed game without pass-1 work emits at most one coalesced `mistakes:added` per user per 60 s (fake clock); a payload with `v: 2` is skipped, not crashed on |
| Index existence (`WEB/scripts/explain-hot-queries.ts --check-indexes`) | after `migrate deploy` from scratch every index of §6.5 exists in `pg_indexes`; every listed hot query has no `Seq Scan`/`Sort` on the P5 tables at the seeded volume |
| Payload sizes | `CT/http/train.size.test.ts` (§9.4) |

### 12.3 Chess-correctness fixtures (`PKG/chess-fixtures/`, arch §5.9)

- `design/v3-bank-session.json`: the three `DR/V3BankSession.dc.html` positions (Recapture first / Loose piece / Defended pawn) with expected `solution`, `accept`, `isPuzzle`, `primaryTheme`, texts. It lives in the shared design-fixture folder that P2 creates (testing X13), and P2's legality test covers it.
- `design/v3-mistake-bank.json`: the 23 `DR/V3MistakeBank.dc.html` rows (seed + labels).
- `grades/positions.jsonl` (P3's shared corpus, reused): drives `candidates.positions.test.ts` (§12.1).
- `puzzles/shards/v1/`: a 6-theme × 3-band shard subset for the CI shard server (§9.3).
- `puzzles/<theme>.json`: 50 CC0 puzzles per Tier-1 theme with the Lichess tags as the oracle (nightly job runs 500 per theme from the shard build).
- `games/*.pgn`: 5 CC0 games with `%eval` whose extracted candidates are hand-checked (the P3 fixture games reused).
- Every fixture's solution replays legally with chess.js; a CI step fails on an illegal line.

### 12.4 End-to-end (Playwright, `WEB/e2e/specs/`)

| Spec | Users / projects | Steps and assertions |
|---|---|---|
| `train/train-plan.spec.ts` (owner journey T4–T6) `@state:V3TrainHub.default @state:V3BankSession.{solve,hint,wrong,correct,solution} @state:V3SessionSummary.default` | leased `train-plan`; `desktop-1440`, `iphone`, `android` | `/train` shows "0 of 2 done" and the streak → Start Today's Plan → solve item 1 first try (Good highlighted), item 2 with one hint (Hard highlighted, override to Good), item 3 wrong then Solution (Again) → item 3 re-appears → finish → summary "Solved", grade table with 4 rows and real labels, themes → Back to Train → "1 of 2 done", streak +1. **Telemetry** (X6): `train_session_started{kind:"daily", source:"plan"}` once; `train_item_graded{grade, suggested, overridden}` exactly 4 times (3 items + 1 re-queue), one with `overridden: true`; `train_session_completed{perfect:false}` once; server `train_attempts_applied` sums to `n = 4` and equals the DB row count; no solution SAN in any property (`telemetry.forbid`) |
| `train/review-to-bank.spec.ts` (T2–T4) | shared member B (adds a game; asserts only on that game) | analysed fixture game with 3 key moments → Review complete shows "3 added" and tags → toggle one off/on (toasts, optimistic, rollback on a mocked 500; the DB shows the ply in and out of `bankOptOut`) → Drill These 3 → runner with exactly those 3 positions |
| `train/game-over-bank-line.spec.ts` (T12, coverage C-01) `@state:V3GameOver.over_checkmate_win` (bank line part) | shared member C (adds a game) | finish a bot fixture game with a known blunder → the card shows the accuracy line (P3) then "+1 position added to your Mistake Bank (move N)." without a reload (driven by `analysis:done`); reload → the same line from the seeded `qk.review.status`; a clean fixture game → no line; flag `train` off (flags-off project) → no line; spectator view → no line; telemetry `game_over_bank_line_shown{count:1}` |
| `train/day-rollover.spec.ts` (testing X5) | leased `day-rollover` (`America/New_York`) | `serverNow` 2026-10-31 03:59 local: grade 1 card → counts for the previous `dayKey` (streak unchanged); 04:01 → `/train` builds a new plan row (skeleton then plan); 07:59 → "Nothing is due"; 08:00 → on focus the 2 released cards appear and the badge updates; streak +1 exactly once; then the same sequence across the 2026-11-01 DST change (01:30 ambiguous → earlier instant). Replaces the manual "change the device clock" step |
| `train/home-backlog.spec.ts` (api-perf AP-10) | shared member D | with Home visible, the test helper emits 50 `analysis:batch` + `mistakes:added` events in 60 s through `/internal/emit` → ≤ 2 `GET /api/home` requests and the bank count updates from the payload without a fetch; with the page hidden → 0 requests until focus, then 1 |
| `train/bank.spec.ts` `@state:V3MistakeBank.{default,filtered}` | leased `bank-member`; desktop + iPhone | Due/All counts; Filter popover (desktop) / sheet (phone): pick Fork → "Show 4 Positions" → list filtered → URL `?theme=fork` → Back restores; "Nothing matches these filters" → Clear Filters; select row → detail board; Solve This One → runner starts at that card; `F` opens the filter, `↑/↓/Enter` work |
| `train/bank-states.spec.ts` `@state:V3BankEmpty.empty @state:V3BankCaughtUp.caughtup` (+ device `empty`/`caughtup`) | leased `bank-empty` and `bank-caughtup` (`test.describe.configure({mode:"serial"})` per persona) | empty CTAs and example card; caught-up "Coming up" rows and copy; no lesson card rendered (slot null) |
| `train/puzzles.spec.ts` (T7) `@state:V3Puzzle{Solve,Hint,Wrong,Correct,Solution,Themes}` | leased `puzzles-fresh`; shards from the CI shard server (§9.3) | setup move animates then solve; rating chip updates after a solve; `T` opens the picker, pick Pins → "1 of 10"; extend fires at item 8 (request observed); daily-limit 429 shows the countdown (forced through the persona's `puzzlesDone = 400`) |
| `train/offline-outbox.spec.ts` (T8) | leased `outbox` | start a bank session → `context.setOffline(true)` → grade 3 → no error UI → `setOffline(false)` → within 15 s the DB (test helper query) has exactly 3 attempts for the session; exactly 3 server `train_attempts_applied` attempts in the sink and no duplicate from a replay; an **online** reload mid-session resumes at the right item. (The offline-reload case moves to P11 with the per-user SW cache) |
| `train/two-tabs.spec.ts` | leased `two-tabs`, two pages | grade the same card in both tabs → one `ok`, one silent `conflict`; counts consistent |
| `train/keyboard.spec.ts` | shared member I, desktop (read-mostly: grades only its own new session's items) | `H`, `H` (arrow), `S`, `1`–`4`, `Enter`, `Esc`, `T`; single-key switch off disables them; focus moves to the next status line after a grade |
| `train/paywall.spec.ts` (T10) | user R (`nonMemberPage`, read-only) with the paywall on | `/train`, `/train/bank`, `/train/puzzles`, `/home` → `/pricing?reason=…&redirect_url=…`; `fetch('/api/train/attempts')` → 402 `subscription_required` |
| `home.spec.ts` (T1, T9) `@state:V3Home.{populated,new_user,import_running}` | leased `bank-member` (`populated`), leased `home-new` (`new_user`), shared member K with a mocked `import:progress` | sign in → lands on `/home`; logo → `/home`; states render; Start Review → `/review/[ref]`; Review 4 → runner; `G H` from `/train`; `home_viewed{state}` once per mount |
| `request-budget.spec.ts` (extended) | shared member A (asserts request counts only) | 0 `/api/*` requests during first paint of `/home`, `/train`, `/train/bank`; a 10-item drill ≤ 5 function invocations (page + attempts + end) |
| `a11y/train.spec.ts` | axe in light and dark | every P5 screen state reachable on `/dev/ui/train/*` and `/dev/ui/home` has no serious violations; grade buttons 48 px; live regions announce "Correct." once |
| `e2e/devices/layout/{train,home}.spec.ts` | all 40 device × zoom projects (nightly, `next start` in CI); PR tier 4 projects | for `/train`, `/train/bank`, `/train/bank/session?s=…`, `/train/puzzles?s=…`, the summary and `/home`: the board's bounding box is inside the viewport, `document.scrollingElement.scrollHeight <= innerHeight`, the grade bar and Hint are visible in `graded`/`solve`, no element overflows horizontally; at 150 % (960×600) the `.tall` sections are hidden. Runs on the real routes signed in **and** on the demo routes with `stress=1` (a 300-row bank, 40-character opponent names, 3-digit move numbers, both colours, testing X9) |
| `e2e/visual/{train,home}.spec.ts` (testing X10; none in rev 1) | `desktop-1440`, `desktop-1280`, `ipad-landscape`, `ipad-portrait`, `iphone`, `android` × light and dark at 100 %; desktop also at 125 % and 150 % | `toHaveScreenshot` of `V3BankSession` solve and graded (grade bar), `V3PuzzleCorrect`, `V3TrainHub` default, `V3MistakeBank` default (phone: with the filter sheet open), `V3Home` populated and new user; `page.clock.install` at a fixed time, `[data-vr-mask]` on avatars and relative dates, `maxDiffPixelRatio 0.002`, baselines regenerated only through the `update-snapshots` label |
| `post-deploy-dev` shard smoke (`WEB/scripts/qa/smoke-puzzle-shards.ts`, run by P1's post-deploy job) | the deployed dev URL and the real R2 | `GET $PUZZLE_SHARD_BASE_URL/v1/manifest.json` → 200 and `version = PUZZLES_VERSION`; one shard's `cache-control` contains `immutable`; 20 random puzzles from 3 random shards replay legally with chess.js and every theme bit maps to a key in the theme registry |

**Regression of earlier phases** (testing X11): the gate is the **entire** main suite plus the entire devices suite on the final SHA with the paywall on, nightly in CI and once against the dev URL, plus the `flags-off` project (P1–P4 `@smoke` with `train`/`home` off). Targeted extras that must stay green: P1 shell specs, `destinations.test.ts` (Home/Train now enabled; Weakness still hidden) and `routes.real.ts` now including `/home` and `/train`; P2 bot game completes and `complete` triggers analysis, and the `GameOverCard` renders with `slots.bank` empty when `train` is off; P3 review → complete → share, the A6 toggle and its rollback test, `analysis:done` payload (now with `bankAdded`/`bankDue`, ≤ 200 B); P4 onboarding end-to-end now finishing on `/home`, import progress; Phase 0 `paid-only.spec.ts`, `membership.spec.ts`, `pricing.spec.ts`. Every bug found in P5 gets a regression test before its fix merges (X14).

### 12.5 Manual checklist on the dev site (ego-browser, `https://replay-chess-dev-replaychess007-1069.vercel.app`, owner account + personas; plus a real iPhone and a real Android phone; close tabs with `task.finish({ keep: [] })` afterwards, CLAUDE.md)

1. Sign in → `/home`; nav has 6 destinations; logo → `/home`; signed-in `/` → `/home`.
2. Home populated: Continue board and Start Review; Bank card 4 thumbnails; This week dots; Recent games chips. Persona `new` → `new_user`; persona `trial` → import row moves live.
3. Bot game → review → toggle a moment → Review complete "3 added" → Drill → T4 grades → summary → Back to Train.
4. `/train`: plan 2 steps, streak, due strip, All training (2 rows), Theme mastery; Start Today's Plan runs bank then puzzles; "Done for today" afterwards. (The 04:00 day start, 08:00 release and streak are covered automatically by `day-rollover.spec.ts`; checking the next batch at real 08:00 local on a phone is an optional extra.)
4b. Game over: finish a bot game with a blunder, wait on the card → "+1 position added to your Mistake Bank (move N)." appears (T12).
5. `/train/bank`: filters, Due/All, detail pane, See It in Your Game (opens the right moment), Skip for Today moves a card to Tomorrow; persona `caughtup` and an empty bank render.
6. `/train/puzzles`: setup move, hint ring then arrow, wrong move red squares, Show Solution 600 ms steps, rating chip, theme picker (desktop popover, phone sheet), "You play Black" on a black puzzle.
7. Offline drill (DevTools offline / airplane mode on the phone) → back online → counts correct.
8. Zoom 80 %, 110 %, 125 %, 150 % on desktop; iPad landscape and portrait (Safari responsive mode + a real iPad if available); nothing scrolls the document; board fully visible.
9. Light and dark theme on every screen; keyboard-only run of one drill; VoiceOver reads the status line and the grade buttons with intervals.
10. `REPO/scripts/qa/error-window.ts --since <last dev deploy>` (testing X6.7) shows 0 new Sentry issues (web, socket, worker) and no Vercel runtime errors for ≥ 24 h, or each one is triaged in the sign-off; PostHog live view shows `train_*` and `home_*` events with the super-properties (the automated sink already proved shapes and exactly-once).
11. Write `REPO/docs/qa/phase-05-signoff.md` (testing X15): SHA, Vercel deployment id, OCI image tags, each owner test T1–T12 with pass/fail and a screenshot path under `docs/qa/phase-05/`, real device models and OS versions, browsers and zoom levels, the state-coverage table for the 35 boards (X8), the error-window output, k6 numbers, defects found with their regression tests.

### 12.6 Performance checks

- k6 (`REPO/perf/k6/src/scenarios/`): new `train-session.ts` (20 VUs, 5 min: create session, 10 attempts with 3–6 s think time, 20 % batched; thresholds W1 p95 < 150 ms, W2 BANK p95 < 250 ms, W2 PUZZLES p95 < 400 ms on a fresh deployment (cold LRU), duplicates rejected idempotently); `api-read-mix.ts` gains `/api/train/today` (15 %) and `/api/home` (10 %) with R1 p95 < 100 ms server (`Server-Timing`) and < 250 ms end to end. Clerk dev users from `.env.test`; never prod; before a run, check the `replay-chess-dev` usage page and skip the run above 60 % of any Hobby quota (feasibility F-VER-2). Results recorded as data (`REPO/perf/results/<sha>.json`, testing X18) and summarised in `REPO/perf/README.md` (opt §9.6); `perf/compare.ts` flags a > 15 % regression of `train-session` against the previous phase.
- `WEB/scripts/explain-hot-queries.ts` P5 queries pass (§9.1).
- Bundle budgets (§9.5) in CI; Playwright perf smoke: move → verdict ≤ 50 ms headless with 4× CPU throttle; no long task > 50 ms after hydration on the runner.
- Worker: `stockfish bench` result recorded; extraction adds ≤ 6 s p95 per game on the dev box (Sentry `worker.extract.ms`).

---

## 13. Work breakdown (28 dev-days + a 5.5-day buffer line)

### 13.1 Order and parallelism

```
WP-A contracts + schema + registries + personas (3 d) ──┬──► WP-B chess-training + Glicko presets (3.5 d) ──┬──► WP-E train API + review bank fields (4.5 d) ──┐
                                                        ├──► WP-C analysis + worker batch (4.5 d) ──────────┤                                               ├──► WP-I QA + deploy (2 d)
                                                        ├──► WP-D puzzle corpus + CI shard server (1.5 d) ──┘                                               │
                                                        ├──► WP-F runner + summary + offline (4 d)   (against contract fixtures, then WP-E)
                                                        ├──► WP-G hub + bank UI (2.5 d)              (same)
                                                        └──► WP-H home + nav + landing + review and game-over lights-up (2.5 d)
```

WP-A merges first (everything imports its contracts, Prisma client, keys, flags and the persona writer). WP-B, WP-C, WP-D, WP-F, WP-G and WP-H then run in parallel; UI packages build against the contract fixtures in `WEB/app/dev/ui/_fixtures/train.ts` (from WP-A) and switch to the real API when WP-E merges. WP-E needs WP-B (domain functions) and WP-D (shard loader interface, which WP-D publishes on day 1 as a typed stub). WP-C needs P3's final-batch builder to expose an "append statements" hook (confirmed on day 1; see the matching risk in §14.2). WP-I closes the phase.

**Ownership rules** (SPEC §4.3 style): a file has exactly one owning package during P5; another package that needs a change asks the owner. "Creates" = new file; "Edits" = existing file (earlier phase). Shared registries are **directories** (feasibility §7), so P5 adds its own files (`lib/api/keys/{train,home}.ts`, `lib/flags/registry/p5.ts`, `lib/routes/classes/{train,home}.ts`, `lib/realtime/handlers/{train,home}.ts`, `e2e/personas/p5.ts`, `CT/http/{train,home,reports}.ts`) and appends one barrel line per file. That lets P8 and P9, which run alongside P5, add theirs without merge conflicts. The few true shared files P5 must edit (`CT/socket/user.ts`, `CT/socket/registry.ts`, `PKG/db/prisma/schema.prisma`, `WEB/package.json` + lockfile, P3's analysis handler) are changed in WP-A or WP-C only, in PRs labelled for the owning phase lead (`REPO/OWNERS.yml`), and the schema file follows the allocation's weekly steward.

### 13.2 Packages

**WP-A · Contracts, schema, registries, personas, scaffolding — 3 d (first, alone)**

| Creates | Edits |
|---|---|
| `CT/http/{train,home,reports}.ts`, `CT/http/train.size.test.ts`, `CT/socket/user.size.test.ts` additions; `PKG/db/json/training.ts` (incl. `ExtractMistakesPayloadV1`); `PKG/db/prisma/migrations/<ts>_m5a_jobkind_extract_mistakes/`, `<ts>_m5_training/`; `PKG/db/prisma/protected-indexes.txt` entry; `WEB/lib/api/keys/{train,home}.ts`; `WEB/lib/flags/registry/p5.ts`; `WEB/lib/routes/classes/{train,home}.ts` (data only; WP-H owns the landing rule's tests); `WEB/e2e/personas/p5.ts` (all nine reset modes); `WEB/e2e/scripts/seed-training.ts`; `WEB/app/dev/ui/_fixtures/train.ts` (contract-valid fixtures for every state, incl. `stress=1`); `WEB/lib/analytics/train-events.ts` + `packages/analytics/src/events/{train,home}.ts`; stub modules `WEB/lib/realtime/handlers/{train,home}.ts` (ownership passes to WP-G/WP-H); `WEB/lib/api/queries/{train,home}.ts` (query options only, `devSchema()`) | `CT/socket/user.ts` + `registry.ts` (`BankDueChanged`, `MistakesAdded`, `AnalysisDone.{bankAdded, bankDue}`, `AnalysisBatch` fields); `CT/http/codes.ts` (`session_ended` in `CONFLICT_REASONS`); `PKG/db/prisma/schema.prisma` (M5, §6); the barrel lines of the registry directories; `WEB/lib/api/endpoints.ts`; `WEB/lib/test-hooks/registry.ts` (P5 hooks); `WEB/prisma/seed/{fixtures,personas}.ts`; `WEB/package.json` (`idb-keyval`, `lru-cache`, `sqids`, the `ts-fsrs` and `@repo/chess-training` workspace deps; no test-glob edit, X1) |

Acceptance: `prisma validate` + `migrate deploy` from scratch on Docker Postgres 17; drift check clean with the protected list; index existence check green; migration applied to the Neon dev branch with `migrate deploy`; personas seeded on dev; every persona reset mode runs twice in a row with the same result; fixtures parse with the contracts; `check-types` green; `check-test-globs` green.

**WP-B · `@repo/chess-training` + Glicko-2 presets — 3.5 d**

| Creates | Edits |
|---|---|
| `PKG/chess-training/**` (every module in §3.3 + tests, incl. `fsrs.property.test.ts`, `CLEANROOM.md`); `PKG/chess-training/puzzles/manifest.v1.json` (placeholder until WP-D replaces it); `PKG/game-core/src/rating/{glicko2,presets}.ts` + `glicko2.test.ts` (config-driven, `PUZZLE` preset; accepts a list of results, P5 calls it with one) | `PKG/game-core/package.json` exports (`./rating`) |

Acceptance: all §12.1 chess-training and Glicko tests green; FSRS golden values recorded; property test green over 1,000 states; DST suite green in CI under `TZ=UTC` and `TZ=Asia/Kolkata`; every time-dependent function takes `now`; the package has no Prisma, no Node built-ins and no ts-fsrs in the subpaths the browser imports (`/grade`, `/labels`, `/items`).

**WP-C · Analysis-side extraction and worker — 4.5 d**

| Creates | Edits |
|---|---|
| `PKG/chess-analysis/src/themes/*` (+ tests), `src/puzzle/{validAttack,line}.ts` (+ tests), `src/bank/candidates.ts` (+ `candidates.test.ts`, `candidates.positions.test.ts`), `src/epd.ts` (+ test); `PKG/chess-fixtures/{puzzles,design}/*` (P5 files); `WK/src/extract/{extractMistakes,lineBuilder,bankStatements,coalesce}.ts`; `WK/src/handlers/extractMistakesJob.ts`; `WK/test/extractMistakes.int.test.ts`; `WEB/scripts/backfill/{enqueue-mistake-extraction,recount-bank-themes,rebuild-cards}.ts` | `WK/src/handlers/analyzeGame.ts` (build J1 rows, append the §7.6 statements to P3's final batch, read `bankAdded`/`bankDue` from the batch results, add them to `analysis:done` / `analysis:batch`); P3's job-load statement (`LEFT JOIN training_profiles`); `WK/src/handlers/index.ts` (register `EXTRACT_MISTAKES`); `WK/src/handlers/housekeeping.ts` (§7.6 rules); `DB/scripts/roles/replay_worker.sql` (P5 grants); `PKG/chess-analysis/CLEANROOM.md` (P5 section); `WK` env template (`BANK_EXTRACT_ENABLED`, `BANK_LINE_NODES`) |

Acceptance: worker integration test with the fake engine passes through the real batch code path (§12.2); on dev, a finished bot game produces ≤ 4 mistakes and ≤ 3 cards in the same HTTP request as the analysis, `analysis:done` carries `bankAdded`/`bankDue`, and no separate bank event is emitted; an opted-out moment gets no card; the backfill (dry-run then apply, after P1's dev-project move) drains on dev and the spot check passes; extraction ≤ 6 s p95 engine time per game and the batch ≤ 50 ms server time on the dev box; Tier-1 recall ≥ 85 % on the committed fixtures.

**WP-D · Puzzle corpus and CI shard server — 1.5 d**

| Creates | Edits |
|---|---|
| `WEB/scripts/puzzles/{build-shards,upload-shards}.ts` (+ a README with the exact commands); `WEB/lib/train/puzzles.server.ts` (shard loader, LRU, selection helpers) + test with a local mock server; the real `PKG/chess-training/puzzles/manifest.v1.json` (ownership transferred from WP-B for this one file); `PKG/chess-fixtures/puzzles/shards/v1/` (6 themes × 3 bands); `WEB/e2e/mocks/puzzle-shards.ts` (+ the `webServer` entry); `WEB/scripts/qa/smoke-puzzle-shards.ts` | Vercel `replay-chess-dev` env (`PUZZLE_SHARD_BASE_URL`, `PUZZLES_VERSION`) and `WEB/.env.development.local` (owner-approved; names only in git); `WEB/.env.test` (`PUZZLE_SHARD_BASE_URL=http://127.0.0.1:4012/puzzles`) |

Acceptance: shards built from the 2026-10-05 dump, uploaded to R2 under `puzzles/v1/` with `immutable` headers (checked with `curl -I` and the smoke script); manifest counts match the files; loader p95 < 120 ms cold from a Vercel preview function, 0 ms warm; selection unit tests (bands, widening, exclusion) green; no CI job reaches R2.

**WP-E · Train API, services and review bank fields — 4.5 d**

| Creates | Edits |
|---|---|
| `WEB/lib/train/{today,bank,sessions,attempts,cards,themes,profile,day,badges,prefs,links,reviewBank,dto}.server.ts` (+ tests, incl. `clock.test.ts`); `WEB/lib/home/home.server.ts` (+ test); `WEB/lib/reports/reports.server.ts`; every route in §7.2 (`WEB/app/api/train/**`, `WEB/app/api/home/route.ts`, `WEB/app/api/me/badges/route.ts`, `WEB/app/api/reports/route.ts`) with their registry entries (`sideEffects` for R1, durable limits); `WEB/test/api/train/*.test.ts`, `WEB/test/api/home.test.ts`; `WEB/scripts/explain-hot-queries.ts` P5 section (+ `--check-indexes`) | `WEB/app/api/review/[ref]/moments/[ply]/route.ts` (A6 card behaviour inside P3's transaction); P3's review DAL (`getReview()`, `getReviewStatus()` call `reviewBank.server.ts`; A2's probe adds the bank count); `WEB/lib/review/complete.server.ts` (bank fields); `WEB/lib/auth/viewer.ts` `getMe()` (`badges.bankDue`, `trainDot`) |

Acceptance: §12.2 contract tests green on Docker Postgres, including the concurrency and durable-limit cases; route responses validate against the schemas in test mode; GET-purity gate green; explain script shows the expected plans; manual curl on dev returns 402 for user R and 404 for a foreign ref.

**WP-F · Runner, summary and offline — 4 d**

| Creates | Edits |
|---|---|
| `WEB/app/(app)/(immersive)/train/bank/session/{page,loading}.tsx`, `(immersive)/train/puzzles/{page,loading}.tsx`; `WEB/app/(app)/train/session/[ref]/page.tsx`, `train/session/[ref]/summary/page.tsx`; `WEB/components/train/runner/**` (§4.4 list + `ThemePicker`, `ReportDialog`); `WEB/components/train/summary/**`; `WEB/components/train/slots/LessonCardSlot.tsx`; `WEB/features/train/{machine,runner-store,validate,useGrade,useSessionExtend,useTrainerKeys,useLocalDayKey}.ts` (+ tests for the machine and validation); `WEB/lib/offline/{outbox,useOutboxSync,snapshots,crossTab}.ts` (+ tests); `WEB/app/dev/ui/train/{runner,puzzles,summary}/page.tsx` | `WEB/components/layout/BoardStage.tsx` + `board-stage.css` (trainer variant, additive); `WEB/lib/shell/keys.ts` + shortcuts registry rows; `WEB/app/(app)/layout.tsx` (mount `useOutboxSync()`, one line); `WEB/eslint.config.js` (restricted imports and the `Date.now()` ban for P5 paths, the session-prefetch rule) |

Acceptance: every runner state of `V3BankSession`, `V3Puzzle*` and the four puzzle device boards reachable on `/dev/ui/train/runner?state=` and `/dev/ui/train/puzzles?state=`; the owner journey T4–T5 and offline T8 pass locally; move → verdict ≤ 16 ms on desktop (perf mark); bundle ≤ 155 KB page-specific with no ts-fsrs and no `ZodError`; device × zoom layout spec green for the runner and summary.

**WP-G · Train hub and Mistake Bank UI — 2.5 d**

| Creates | Edits |
|---|---|
| `WEB/app/(app)/train/{page,loading}.tsx`, `train/bank/{page,loading}.tsx`; `WEB/components/train/hub/**`, `WEB/components/train/bank/**`; `WEB/app/dev/ui/train/{hub,bank}/page.tsx` | `WEB/lib/realtime/handlers/train.ts` (from the WP-A stub); `WEB/lib/realtime/invalidateThrottled.ts` (+ test; WP-G creates it, WP-H uses it) |

Acceptance: every state of the 7 hub boards and 12 bank boards renders from real data or the demo routes; filters instant for ≤ 300 rows, URL state survives Back; 0 `/api` requests at first paint; layout specs green on all 40 projects (nightly) and the PR tier; axe clean.

**WP-H · Home, navigation, landing, review and game-over lights-up — 2.5 d**

| Creates | Edits |
|---|---|
| `WEB/app/(app)/home/{page,loading}.tsx`; `WEB/components/home/**`; `WEB/components/train/slots/GameOverBankSlot.tsx`; `WEB/app/dev/ui/home/page.tsx`; `WEB/e2e/specs/home.spec.ts` | `WEB/lib/nav/destinations.ts` + test; `WEB/components/shell/Brand.tsx` (logo target); `WEB/lib/routes/classes/home.ts` landing-rule tests (or the two-line `middleware.ts` edit if P1's data-driven classes have not merged); `WEB/app/sign-in/[[...sign-in]]/page.tsx:11`; `WEB/lib/billing/return-url.ts:9-24` + test; P4 `WEB/app/onboarding/done/page.tsx` (+ its destination constant); P3 review complete page and key-moment panel components (bank lines, Drill CTA, toggle, `B`); the game screen's slot assembly (pass `slots.bank`, one line, hand-off H-01); `WEB/lib/realtime/handlers/home.ts` (from the WP-A stub); Vercel dev env (Clerk fallback URLs) |

Acceptance: T1, T2 (copy part), T3, T9, T12 pass; Home states from personas and demo routes; nav reachability test green; signed-in `/` → `/home` with no DB call in middleware; the game-over line appears live and after a reload, never for spectators or with `train` off.

**WP-I · QA, performance, deploy, sign-off — 2 d**

| Creates | Edits |
|---|---|
| `WEB/e2e/specs/train/*.spec.ts` (§12.4 list except `home.spec.ts`, incl. `day-rollover`, `game-over-bank-line`, `home-backlog`); `WEB/e2e/devices/layout/{train,home}.spec.ts`; `WEB/e2e/visual/{train,home}.spec.ts` + baselines; `WEB/e2e/specs/a11y/train.spec.ts`; `REPO/perf/k6/src/scenarios/train-session.ts`; `REPO/docs/qa/phase-05-signoff.md` | `WEB/e2e/specs/request-budget.spec.ts`; `REPO/perf/k6/src/scenarios/api-read-mix.ts`; `WEB/playwright.devices.config.ts` (spec globs, tiers); `REPO/docs/qa/design-states.overrides.json` (P5 demo-only reasons); `REPO/perf/README.md` (results); `docs/implementation-plan.md` (pointer to this spec) |

Acceptance: §15 checklist.

### 13.3 Estimates

| WP | Rev 1 | Rev 2 | Why it changed |
|---|---|---|---|
| A contracts, schema, registries, personas | 2.5 | 3 | nine leased-persona writers, registry directories, review DTO and socket additions |
| B chess-training + Glicko presets | 3.5 | 3.5 | presets and the property test fit the existing estimate |
| C analysis + worker | 4 | 4.5 | set-based batch statements, grants, coalescer, clean-room write-up |
| D puzzle corpus + CI shard server | 1.5 | 1.5 | shard subset and smoke script replace ad-hoc mocks |
| E train API + review bank fields | 4 | 4.5 | A6 rewrite on `bankOptOut`, review bank fields, durable limits, full W8 |
| F runner + summary + offline | 4.5 | 4 | no service-worker work (moved to P11); previews precomputed |
| G hub + bank UI | 2.5 | 2.5 | — |
| H home + nav + lights-up | 2 | 2.5 | the game-over `bank` slot (coverage C-01) |
| I QA + deploy + sign-off | 1.5 | 2 | day-rollover, visual baselines, shard smoke, telemetry assertions, sign-off record |
| **Total** | **26** | **28** | +2 over the allocation (alloc §0 says 26) |
| Buffer line (20 %, feasibility §8) | — | 5.5 | not scheduled work; spent only with the owner's agreement, recorded in the sign-off |

Critical path: A → B → E → (F integration) → I ≈ 3 + 3.5 + 4.5 + 1 + 2 = 14 d calendar with two people; ≈ 28 d for one developer. If the owner holds P5 to 26 days (D-21), the first things to defer are the `stress=1` device runs and the iPad visual baselines (keep the phone and desktop ones), then the `home-backlog.spec.ts` request-count spec (keep the unit test of `invalidateThrottled`).

### 13.4 Rollback (feasibility §9)

| Layer | How to roll back | Data effect |
|---|---|---|
| UI and API | flag `train` off hides every P5 surface (Train, bank, runner, game-over line, review bank fields; A6 falls back to P3's opt-out write); flag `home` off sends members back to `/play`; or redeploy the previous web build (Hobby: previous deployment only) | none; data accrues dark |
| Worker | `BANK_EXTRACT_ENABLED=false` skips J1; the analysis still completes; or roll back the worker image, but no further than release N of the two-release rule (§6.6), whose Prisma client already knows `EXTRACT_MISTAKES` | games stay `bankVersion = 0` and the backfill catches up later |
| Schema | M5 is expand-only and stays; no down-migration (dm §11.5) | — |
| FSRS state | cards can be rebuilt from `training_attempts` (append-only, holds the post-review state of every graded attempt): `scripts/backfill/rebuild-cards.ts --user <ref>` replays attempts in `reviewedAt` order through `fsrs.ts` and rewrites the card rows; new cards come from `mistakes` + moment plies as in J1 | a bug in scheduling is repairable without losing history |
| Theme counts | `recount-bank-themes.ts` (B-M5-2) | — |
| Puzzle corpus | point `PUZZLES_VERSION` back at the previous version path (kept until the switch is verified) | — |

---

## 14. Risks, open questions and owner decisions

### 14.1 Decisions needed from the owner (defaults are what this plan builds)

| # | Decision | Default | Consequence if the answer differs |
|---|---|---|---|
| D-1 | Inaccuracies in the bank (rct-b Q23) | yes, when ΔWin ≥ 7 in an undecided position, inside the 4-per-game cap | "no": drop the INACCURACY clause in `candidates.ts`; the design's "Pawn structure · inaccuracy" rows disappear |
| D-2 | "Remove from bank" (rct-b Q6) — no design exists | ship W6 + row ⋯ behind `bank-remove`, Undo toast 6 s | needs a design board before the flag goes to members |
| D-3 | Puzzle rating seed (rct-b Q8) | linked blitz/rapid + 300, clamped 800–2200, RD 250, "provisional" < 20 attempts | change the constant in `glicko2` seed |
| D-4 | Streak definition (rct-b Q13) | ≥ 1 graded item a day; one missed day forgiven ("resets if you skip 2 days") | `streak.ts` constants |
| D-5 | New-user Train hub (rct-b Q4) — no board | step 1 "Review your last game"/"Import games", step 2 puzzles at the seeded rating, EmptyState in the due strip | ask Design for `V3TrainHubNew` |
| D-6 | Puzzle cards only for misses (dm O6) | card only on AGAIN/HARD; clean solves logged | "every attempt": +≈ 60 % PUZZLE rows; one-line change in W1 |
| D-7 | ts-fsrs v5 (Node 22/20) vs Node 24 + v6 (arch X13) | `ts-fsrs@^5.4.2` behind `fsrs.ts` | moving to v6 after Vercel and the worker run Node 24 is a wrapper-only change plus re-running the golden tests |
| D-8 | "Hard 2 days" on new cards | custom again-only learning-step strategy (Hard graduates) | fallback: default steps, the button truthfully shows "15 min" |
| D-9 | Which mistakes get cards | key-moment plies only (≤ 3 per game, A6 controls them); up to 4 `Mistake` rows per game for stats | "all extracted": "{n} added" copy must count cards, not moments |
| D-10 | Grade override policy (rct-b Q7) | allow any grade, track `overridden` | if override-after-solution > 30 %, consider disabling Good/Easy after Show Solution |
| D-11 | Nav due badge (inv-sys Q17) | none (not in the design) | `badges.bankDue` already exists for a later badge |
| D-12 | Home device layouts (no boards) | derived from the Train hub device pattern (§4.1) | design pass before the `home` flag reaches members |
| D-13 | Client-side Glicko preview (deviates from rct-b "never client-guessed") | show the deterministic preview, replace silently on flush | "no": the chip shows "…" until the flush; flush per puzzle grade instead of debounced (+≈ 7 invocations per 10 puzzles) |
| D-14 | Training prefs location | `TrainingProfile` columns, written only through W8 `PATCH /api/train/prefs` (dm D13 put them in `UserSettings.prefs.training`; consistency 10.5 picks option a) | if the owner wants them in `UserSettings`, P10 adds a virtual `train` section to `PreferencesV1Patch` that writes these columns in the same transaction; nothing in P5 changes |
| D-15 | Reports endpoint | one `Report` table + `POST /api/reports` (dm, api SYS-6) instead of `TrainingReport` + `POST /api/train/reports` (alloc P5 list) | — |
| D-16 | **Vercel Hobby is non-commercial.** M2 is "the first release worth charging for" | stay on dev (Hobby) for P5; the move to Pro is the owner's P13 decision (alloc §1.5) — it must happen **before** any customer is charged, and **the P13 preflight fails while the Vercel team is on Hobby and Dodo live mode is enabled** (feasibility §10.11 item 3, F-VER-1). Note: the live site on the old account already charges grandfathered $8 members | charging on Hobby breaks Vercel's terms |
| D-17 | Puzzle shard URL | the existing `replay-chess-media` R2 bucket's public URL now; `media.playchess.tech` custom domain when the owner confirms (Cloudflare zone is already on replaychess007) | env var only |
| D-18 | CLAUDE.md DB rule 1 wording (alloc §1.3, dm O1, consistency R-20) | `migrate deploy` on every Neon branch, never `db push` or `migrate dev` there; `migrate dev` only on a local Docker Postgres | if the owner keeps "db push on shared DBs" for production, the partial index `training_attempts_puzzle_idx` and the `fillfactor`/`lz4` settings are dropped by every push and must be re-applied by hand after it (P13 runbook) |
| D-19 | Lapsed members reading their bank (B26; still open, coverage C-21) | hard redirect, data kept | "read-only": `member_or_lapsed_read` on R1/R2/R3/HOME-1 GETs only; one change per route plus the paywall-soft states owned by P11 |
| D-20 | Settings › Training (coverage C-12) — there is no board for it | **not built**; defaults only (§8.5). W8 already accepts every pref, so a later screen is UI only | approve a kit-built section (no board) and P10 adds it as §4.x calling W8; P6's scope editor follows the same rule |
| D-21 | P5 budget | 28 dev-days (+2 over the allocation) plus a 5.5-day buffer line that is spent only with the owner's agreement (feasibility §8) | hold to 26: defer the `stress=1` device runs and the iPad visual baselines, then `home-backlog.spec.ts` (§13.3) |
| D-22 | Telemetry for SLOs | client timing as anonymous Sentry metrics (`route_class`, `device_class` only), not PostHog (api-perf AP-15) | if the owner treats these as consent-gated too, the client SLOs fall back to the Playwright lab gates and the server-side metrics |

### 14.2 Risks

| Risk | Likelihood / impact | Mitigation |
|---|---|---|
| P3 does not expose MultiPV lines for candidate plies, or key-moment selection is not reusable by the worker | M / H (extraction quality) | WP-C confirms P3's `GameAnalysis.lines` shape on day 1; fallback: run the MultiPV-2 root search in J1 (+≈ 2 s per candidate) |
| P3's final-batch builder has no way to append statements, or the batch grows past 100 ms server time with J1 | M / M | WP-C agrees an `appendStatements(fn)` hook with P3's lead on day 1 (a 10-line change in P3's file, labelled for P3); fallback `rc_apply_bank(p jsonb)` as one statement (§7.6) |
| Cross-document references to the dropped `key_moments` table survive in P7 and P13 (`_m5v_validate_key_moment_fk` in P13's production list) | H / M (a failing production migration step) | consistency 7.3 and P13 L359 must be edited; WP-I greps every plan file and the repo for `key_moments`/`KeyMoment` before sign-off |
| P8 runs alongside P5 and builds on P5's runner, `SessionKind`, the `rc-outbox` and the lesson slots (consistency R-19) | M / M | P5's interfaces P8 consumes are frozen in WP-A: `TrainerRunner` `mode` prop, `SessionKind` (P8 adds `OPENINGS` in M8), outbox stream key `u:<userRef>:lessons`, `LessonCard` slots (`SessionSummary.next.lesson`, `BankPage.lesson`); P8's lessons and openings WPs start after P5 merges |
| Leased persona pool exhausted or a lease leaks (P5 adds 9 personas) | L / M (flaky CI) | leases expire after 15 min; `users.test.ts` fails a spec that leases a persona without `serial` mode; the pool has 24 users |
| Engine time for line extension on 1 OCPU during an import backlog | M / M | extension only for `isPuzzle` candidates at 500k nodes; backfill at backlog priority; `BANK_EXTRACT_ENABLED` kill switch; eval cache |
| Clean-room tagger recall below 85 % on some themes | M / M (wrong theme labels, weak "matched puzzles") | Tier 1 only in P5; nightly recall report; unknown → `rc:*` or the phase tag rather than a wrong tactic name |
| DST and time-zone bugs in release snapping / day keys | M / H (cards "due" at 07:00, streak breaks) | `zonedToUtc` two-pass algorithm, explicit DST fixtures (§12.1), server-side labels only |
| FSRS intervals differ from the design copy | H / L | real intervals always shown; custom strategy + initial stabilities measured (§8.2) |
| Two tabs or two devices grade the same card | M / L | `cardReps` guard + `FOR UPDATE`, `conflict` dropped silently, Web Locks for the outbox |
| iOS evicts IndexedDB after 7 days unused | M / L | the outbox is a buffer, flushed on every mount/visibility; nothing is the source of truth on the device (cdl §7.4) |
| Hobby invocation budget | L / M | debounced flush, RSC seeding (0 client fetches), `staleTimes`, no polling |
| Neon storage growth | L / M | ≈ 1.8 MB per member-year for P5 tables; prunes in housekeeping; fewer cards (key moments only) |
| R2 outage | L / M (puzzles only) | 502 → "Puzzles are unavailable right now. Your Mistake Bank still works."; bank and plan bank step unaffected; `puzzles_enabled` switch |
| Planning-document naming drift | H / M (wasted merge time) | §0 table is the single naming for P5 (revision 2 aligned it with the consistency rulings); registries are directories, so P5 adds files instead of editing shared ones |
| Session payload exposes solutions | certain / negligible | self-assessment drill; ratings are personal |
| The design's "Mistake Bank solves in place" (DS README) vs the static board + "Solve This One" (`V3MistakeBank`) | — | one runner (rct-b Q6); flagged to the design-system owner |
| Board icons | — | the owner's own `public/board_icons` (user memory, B8), not the DS `mq-*` drawings |

### 14.3 Open questions (no default needed to start)

1. Should "Drill These 3" from Review complete count toward the daily cap? (Plan: no — explicit pick.)
2. Should a bank card from a Lichess game imported with `%eval` but without pass 2 wait for pass 2 before becoming a puzzle? (Plan: yes; until then it is a review position.)
3. "Continue with puzzles" after a bank session: the session's top theme or the focus theme? (Plan: the session's top theme.)
4. Should the puzzle stream end (or slow) after N consecutive misses to avoid frustration? (Plan: no in P5; track `train_wrong_move` and revisit.)

---

## 15. Definition of done (alloc §1.1 applied to P5)

- [ ] **Deployed to every dev target**: merged to `dev`; Vercel `replay-chess-dev` green; OCI dev socket and worker redeployed by `.github/workflows/deploy-oci.yml` (worker with J1 + `EXTRACT_MISTAKES`, in two releases per the two-release rule, §6.6); the Neon dev branch (CLAUDE.md) on M5 via `prisma migrate deploy` (no `migrate dev`, no `db push`) and the `replay_worker` grants script re-run; Clerk dev (fallback redirect URLs set) and Dodo test mode unchanged.
- [ ] **Flags** `train` and `home` on for the owner, E2E members A–P and the pool users on dev; `bank-remove` owner-only; `puzzles_enabled` on.
- [ ] **Backfill** B-M5-1 run on dev after P1's dev-project move (dry-run, then apply); 0 analysed `game_players` (joined to `games."analysisStatus" = 'DONE'`) with `bankVersion < 1`; spot check passed.
- [ ] **Puzzle shards** `v1` on R2 with `immutable` headers; manifest committed; `PUZZLE_SHARD_BASE_URL`/`PUZZLES_VERSION` set on dev; the post-deploy shard smoke is green; no CI job reads R2.
- [ ] **CI green**: lint (baseline delta 0 for new files, incl. the `Date.now()` ban and the session-prefetch rule), `check-types`, `check-test-globs`, unit (`node:test`, incl. `fsrs.property.test.ts`), `test:int` on Docker Postgres (incl. the W1-during-J1 concurrency case and the durable-limit cases), migration drift gate (protected index list), the **index existence check** and `explain-hot-queries.ts`, the GET-purity gate (only R1's `daily_plan`), payload and socket-frame size tests, bundle budgets (no `ZodError`, no ts-fsrs in P5 chunks), the registry cache-tier lint, Playwright signed-in specs (§12.4) with the paywall on and the console guard, the device × zoom suite for every P5 page (PR tier and nightly 40 on `next start`), axe, and the visual baselines.
- [ ] **Leased personas**: every P5 spec that needs an exact state leases one; `WEB/e2e/fixtures/users.test.ts` is green; no P5 spec mutates a shared member's absolute state.
- [ ] **Server time**: `day-rollover.spec.ts` is green across the 2026-11-01 DST change.
- [ ] **States reachable** (testing X8): `state-coverage.ts` shows every value of every `data-props` state enum of the 35 boards as `@state` (real data) or `@demo` with a reason in `design-states.overrides.json`, and none missing; undesigned states (saving, cap reached, new-user hub, broken item, analysing Continue) implemented as specified in §4.
- [ ] **No dead links**: later-phase slots (weakness rows, lesson step, the two `LessonCardSlot`s, coach menu item, rating lines, Weakness sub-nav) render nothing; Home links to legacy `/play` and `/position/[ref]` work; no `<Link prefetch>` points at a session-creating URL.
- [ ] **Lights up done**: the game-over `bank` line (T12); Review complete bank lines + Drill CTA + A6 toggle + `B`; the review "Added"/"Not added" tags from real cards; onboarding Done → `/home`; sign-in, logo and signed-in `/` → `/home`; nav Home/Train with subs Today, Mistake Bank, Puzzles; chords `g h`, `g m`.
- [ ] **Owner test script** T1–T12 (§1.3) passes on the dev URL with ego-browser, including a real iPhone and a real Android phone; tabs closed afterwards (`task.finish({ keep: [] })`); results in `docs/qa/phase-05-signoff.md`.
- [ ] **No new errors**: `error-window.ts` shows no new Sentry issues and no Vercel runtime errors for ≥ 24 h after the last dev deploy (or each is triaged in the sign-off); no `train.item_broken` from fixtures.
- [ ] **Performance**: k6 `train-session.ts` and `api-read-mix.ts` thresholds met on dev (W1 p95 < 150 ms at 20 RPS; R1 p95 < 250 ms end to end; W2 PUZZLES p95 < 400 ms cold) with results stored as data; `explain-hot-queries.ts` P5 plans pass; request-budget and home-backlog specs green.
- [ ] **Telemetry**: the §10.1 events are asserted exactly once with closed schemas and the PII guard (no FEN, SAN, names) in the specs listed in §12.4; the PostHog live view on dev shows them with the super-properties; Sentry spans and metrics visible for `train.*` routes, the client timing metrics and the worker.
- [ ] **Docs**: this file is the P5 spec and `docs/implementation-plan.md` points to it; the owner decisions D-1…D-22 are answered or explicitly deferred in the decision register; hand-off notes recorded for:
  - **P3**: `?ply=` that equals a moment ply opens that moment; an `appendStatements` hook on the final batch; `analysis:done` grows to ≤ 200 B with `bankAdded`/`bankDue`; `analysis:batch` carries the same two fields; A2's probe includes the bank count;
  - **P6**: use `training_cards` / `training_attempts` and their index names (consistency 6.1); `train_session_*` are P5 events reused with `kind: "weakness"`;
  - **P7**: delete the `KeyMoment` hedges (consistency 7.3); `Mistake.texts` is the only stored coach text;
  - **P8**: light `LessonCardSlot` on the summary (`SessionSummary.next.lesson`, edge E60) and on the caught-up bank (`BankPage.lesson`) in S13 (coverage C-05, C-06); the frozen runner, `SessionKind`, outbox and slot interfaces (§14.2);
  - **P9**: add the `GAME` preset to `rating/presets.ts` and leave `glicko2.ts` unchanged;
  - **P10**: add `targetType: "user" | "game"` branches to P5's `Report` / `POST /api/reports` (no `UserReport`, consistency 10.1); Settings › Training only if D-20 is approved, calling W8; account deletion anonymises `lastOpponentName` and deletes the P5 private tables; reminders and the release push as future-dated jobs;
  - **P11**: the per-user `rc-pages:u:<ref>` cache allow-lists `/train/bank/session` and `/train/puzzles` for an offline reload (reading `rc-offline`), plus the daily offline snapshot and the `/offline` row; consent fixture keeps the P5 telemetry assertions green;
  - **P12**: the tournament game-over card reuses the `bank` slot of §4.8;
  - **P13**: remove `_m5v_validate_key_moment_fk` from the production migration list (consistency 11, P13 L359); rehearse M5 on a child branch of production; D-16 preflight.

---

## Appendix A. Critique dispositions

Every finding in the five critiques that concerns P5 (`PLAN/critique-coverage.md`, `critique-consistency.md`, `critique-feasibility.md`, `critique-testing.md`, `critique-api-perf.md`) is listed once. **Applied** means this revision implements it in the section named. **Rejected** gives a one-line reason. Findings that name P5 only as the source of a correct name (for example "P6 must use P5's table names") need no P5 change and are listed as **No P5 change**.

### A.1 Coverage critique

| ID | Finding (short) | Disposition | Where |
|---|---|---|---|
| C-01 | The game-over Mistake Bank line is never lit; P5 said "no change" | **Applied**: P5 owns P2's `GameOverCard` `bank` slot (`GameOverBankSlot`), data from `analysis:done.bankAdded` and `ReviewStatusDTO.bank`, hidden while analysing, at 0, for spectators, with the flag off; owner test T12 and `game-over-bank-line.spec.ts` | §0, §1.2 item 0, §1.3 T12, §3.2, §4.8, §7.1, §7.6 step 6, §12.4 |
| C-12 | Settings › Training is handed to P10, which has no such section and no board | **Applied (option "not built")**: no screen in P5 or P10 until the owner approves a kit-built section (D-20); W8 now accepts and validates every pref so a later screen is UI only | §0, §2.2, §7.1 `TrainPrefsPatch`, §7.3 W8, §14.1 D-20 |
| C-05 | Summary lesson card (edge E60) never lit | **Applied on the P5 side**: a typed empty slot `SessionSummary.next.lesson` + `LessonCardSlot`; the fill belongs to P8 S13 (hand-off in §15) | §2.2, §4.7, §7.1 |
| C-06 | Caught-up bank lesson card never lit | **Applied on the P5 side**: `BankPage.lesson` + `LessonCardSlot`; P8 S13 fills it | §2.2, §4.3, §7.1 |
| C-21 | B26 (lapsed read-only) still open, so some states are demo-only | **Applied as far as P5 can**: recorded as still open with the exact P5 change if decided (D-19); the decision itself is the owner's | §2.2, §14.1 D-19 |
| Note | `V3Home` has no device boards; derived layouts need sign-off | **Applied** (already D-12; kept) | §4.1, §14.1 D-12 |

### A.2 Consistency critique

| ID | Finding (short) | Disposition | Where |
|---|---|---|---|
| 5.1 / R-02 / #11 | Conditional `KeyMoment` table, FK, index and `m5v` file; P3 stores moments in `PlayerReview.content` | **Applied**: all removed; link through `MistakeOccurrence (gameId, ply)`, `TrainingCard.mistakeId` and `progress.bankOptOut`; A6, W6, R2, Home, the worker and the review bank fields rewritten | §0, §3.2, §6.2, §6.4–6.6, §7.3, §7.6, §8.1 |
| 5.2 / R-01 / R-05 | Backfill reads `game_players."analysisStatus"`; literal priority | **Applied**: join `games`, `JOB_PRIORITY.BACKLOG`, `fairSeq` per member | §6.7, §7.6 |
| 5.3 / 5.4 / R-03 | `users."timeZone"` "only if P4 did not"; `timezone` spelling | **Applied**: created by P4 (M4); M5 does not touch `users`; spelled `timeZone` | §0, §2.3, §5.2, §5.3, §6.2, §6.6 |
| 5.5 / R-02 | "P9 adds player reports" | **Applied**: P10 adds `user`/`game` branches to P5's handler and table | §0, §6.2, §7.1, §15 |
| 5.6 / R-06 | `origin_mismatch` code | **Applied**: P1 middleware → 403 `forbidden` | §5.6, §11 |
| 5.7 | `IdempotencyKey` called a P1 table | **Applied**: P2 table (M2i), P1 helper | §2.3, §7.3 W2, §11 |
| 5.8 / R-07 | `/internal/emit {room, event, data}` | **Applied**: P2's `{v:1, targets, event, data, dedupeKey?}` | §0, §7.3 W1, §7.4 |
| 5.9 / R-13 | Token-bucket limit wording | **Applied**: `limit / windowSec` fixed windows; long windows durable (with api-perf AP-11) | §0, §7.2, §11 |
| 5.10 / R-10 | Contract paths without `src/` | **Applied**: `CT` = `PKG/contracts/src` everywhere | header, §0, §3, §5.5, §7 |
| 5.11 | `Report` note for P10's targets | **Applied** | §6.2 |
| R-06 | `membership_ended` is not a code; register `session_ended` | **Applied**: 402 `subscription_required {reason}`; `session_ended` in `CONFLICT_REASONS` | §0, §3.2, §5.6, §7 intro |
| R-01 | `endedAt` (P2) is the per-member time column | **Applied** (see also AP-07 below) | §0, §7.3 HOME-1 |
| R-20 | No `db push` on any Neon branch; no hard-coded dev branch id | **Applied** | §0, §1.3, §6.6, §14.1 D-18, §15 |
| R-18 | `train_session_*` owned by P5 | **Applied** (ownership stated) | §10.1 |
| R-16 / R-17 | `rc-outbox`, lowercase wire enums | **No P5 change** (P5 already used them) | §5.4, §7.1 |
| R-19 | P8 builds on P5's runner and outbox | **Applied on the P5 side**: interfaces frozen in WP-A and listed as a risk; P8's scheduling is the allocation's call | §14.2, §15 |
| R-08 | `x-internal-token` vs HMAC | **Applied as "inherit"**: P5 uses the shared helper and builds no header of its own; the scheme is P2's/P13's decision (the critiques disagree) | §0, §7.4, §11 |

### A.3 Feasibility critique

| ID | Finding (short) | Disposition | Where |
|---|---|---|---|
| #11, §10.11.1 | Two phases create `glicko2.ts` with different constants | **Applied**: config-driven function + `presets.ts` (`PUZZLE`); P9 adds `GAME` | §0, §3.2, §8.7, §12.1, WP-B |
| §7, §10.11.2 | Shared registries clash with P8/P9 running alongside | **Applied**: P5 adds files in registry directories; true shared files labelled for their owner | §0, §3.1, §3.2, §13.1 |
| §10.11.3, F-VER-1 | Hobby is non-commercial; preflight must block | **Applied**: D-16 now includes the P13 preflight rule | §14.1 D-16 |
| §9, §10.11.4 | No rollback subsection | **Applied**: §13.4 (flags, worker switch, expand-only schema, card rebuild from `training_attempts`, corpus version) | §13.4 |
| §10.11.5 | E2E should not fetch shards from R2 on every run (`page.route`) | **Applied with a different mechanism**: shards are fetched server-side, which `page.route` cannot intercept, so CI uses a local static shard server and a committed subset | §9.3, WP-D |
| LIC-4 | Clean-room process for AGPL-adjacent code | **Applied**: `CLEANROOM.md` in both packages, PR confirmation, P1's licence check covers P5 deps | §8.1, §11 |
| F-NEON-2 / #4 | No `HOURLY_TICK`; timed work as future-dated jobs | **Applied**: P5 adds no timer or recurring job; P10's release push is a future-dated job | §2.2, §7.4, §9.7 |
| F-NEON-1 | Dev shares production's Neon project | **Applied on the P5 side**: the backfill and k6 runs wait for P1's move; wording uses "the Neon dev branch (CLAUDE.md)" | §6.7, §9.7 |
| §9 rule 1 | Enum values take two releases | **Applied** to `EXTRACT_MISTAKES` | §6.6, §13.4 |
| §9 rule 2 | Versioned job payloads | **Applied**: `ExtractMistakesPayloadV1`, unknown `v` skipped | §7.6, §12.2 |
| §8 | 20 % buffer per phase; estimates realism | **Applied**: re-estimated 28 d + 5.5 d buffer line, D-21 | header, §13.3, §14.1 |
| F-VER-2 / F-VER-3 | Hobby quotas; full matrix against the deployed dev URL | **Applied**: matrix on `next start` in CI, smoke only on the dev URL, 60 % stop rule for k6 | §3.2, §9.7, §12, §12.6 |
| F-VER-5 | Speed Insights 10k events / 30 days | **Applied**: `sampleRate={0.2}`, PostHog web-vitals second | §9.6 |

### A.4 Testing critique

| ID | Finding (short) | Disposition | Where |
|---|---|---|---|
| X4 (P5) | Specs on shared letters C–H collide with P6, P7, P9, P10 | **Applied**: leased personas `bank-member`, `bank-empty`, `bank-caughtup`, `puzzles-fresh`, `outbox`, `two-tabs`, `train-plan`, `day-rollover`, `home-new`; shared members only gain data | §2.1, §3.1, §6.7, §12.4, §15 |
| X5 (P5) | 08:00 release, 04:00 day start and streak checked only by hand | **Applied**: `ctx.now`/`requestNow()`, `$now` in SQL, `day-rollover.spec.ts` across DST | §0, §7 intro, §8.4, §12.4 |
| Shard smoke | No post-deploy check of the R2 corpus | **Applied**: `smoke-puzzle-shards.ts` in post-deploy-dev | §12.4, WP-D |
| X10 (P5) | No visual baselines | **Applied**: `e2e/visual/{train,home}.spec.ts` with the listed states, devices, themes and zooms | §12.4 |
| Property tests | FSRS invariants over random states | **Applied**: `fsrs.property.test.ts` | §12.1 |
| X13 | Bank expectations from the shared corpus; design fixtures in one folder | **Applied**: `candidates.positions.test.ts`; `PKG/chess-fixtures/design/` | §12.1, §12.3 |
| X6 (P5) | Telemetry checked only by hand | **Applied**: exactly-once assertions in `train-plan`, `offline-outbox`, `home`, `game-over-bank-line`; solution SAN forbidden. The critique's names `kind:"plan"`, `train_attempt`, `train_attempts_recorded` are mapped to P5's registered names (`kind:"daily", source:"plan"`, `train_item_graded`, `train_attempts_applied`), because P5 owns them (R-18) | §10.1, §12.4 |
| X8 (P5) | State tags for the 35 boards | **Applied**: `@state`/`@demo` tags and overrides file | §3.2, §12, §15 |
| Regression | Full suite, A6 toggle, onboarding → `/home`, `routes.real.ts` | **Applied** | §12.4 regression paragraph |
| DoD additions | Leased personas, day-rollover, shard smoke, visuals, telemetry | **Applied** | §15 |
| X1, X2, X3, X7, X9, X11, X12, X14, X15, X18 | Cross-cutting P1 plumbing | **Applied as dependencies** (P5 uses them and supplies its parts: test layout, paywall-on specs, console guard, `stress=1` data, flags-off coverage, test-hook registry entries, sign-off record, perf results as data) | §2.3, §12, §12.5, §12.6, §15 |

### A.5 API, data-layer and performance critique

| ID | Finding (short) | Disposition | Where |
|---|---|---|---|
| AP-07 (key moments) | `key_moments` does not exist | **Applied** (same as consistency 5.1); `momentOrd` dropped from the DTOs in favour of `gamePly` | §7.1, §7.3 |
| AP-07 (`playedAt`) | Use one column `game_players."playedAt"` | **Rejected**: P2 shipped `endedAt` and its index first; the consistency ruling R-01 (first shipper names the column) wins, so P5 keeps `endedAt` and only the wire field is `playedAtLabel` | §0 |
| AP-07 (table names) | Keep `training_cards`/`training_attempts`; ask P6 to rename | **No P5 change** (P5's names win; P6 hand-off in §15) | §15 |
| AP-10 | Invalidation storm during an import backlog | **Applied**: bank fields folded into `analysis:done`/`analysis:batch`, no separate emits on the analysis path, coalesced `mistakes:added` for the backfill, one `invalidateThrottled(…, 30 s)` per key with a trailing edge, hidden tabs only mark stale, counts patched from payloads; `home-backlog.spec.ts` | §0, §4.1, §5.1, §5.2, §5.5, §7.4, §12.4 |
| AP-27 | J1 cannot chain `RETURNING` in a non-interactive HTTP batch; W1 lock contention | **Applied**: set-based natural-key statements (itemKey derived from `epdHash`), opt-outs filtered in SQL, due count and `bankAdded` read from the batch results; W1 locks `theme_mastery` in a fixed order; concurrency test with W1 p95 < 300 ms; `rc_apply_bank()` kept as the fallback | §6.2, §7.3 W1, §7.6, §8.1, §12.2 |
| AP-11 | Long rate-limit windows live in an `UNLOGGED` table | **Applied**: `train-session` and `report` are counted from source rows (new `reports (reporterId, createdAt)` index); only ≤ 60 s windows use the bucket | §0, §6.2, §6.5, §7.2, §7.3, §11 |
| AP-34 | `rc-pages` cache can serve user A's runner HTML to user B | **Applied**: P5 adds no SW document cache; the offline reload waits for P11's per-user cache | §2.2, §3.1, §5.4, §9.2 |
| AP-08 item 4 | Badge fallback poll every 5 min keeps Neon awake | **Applied**: no interval poll at all; focus refetch only | §5.1, §9.7 |
| AP-09 / GET purity | GETs with side effects | **Applied**: R1 registers `daily_plan`; session-creating pages are never prefetched (a router prefetch would otherwise create sessions) | §4.1, §4.2, §5.1, §5.2, §11 |
| AP-38 | Counts on every page | **Applied**: pages with a `cursor` return rows only | §7.1, §7.2, §7.3 R2 |
| AP-12 | zod in production client bundles | **Applied**: `devSchema()`; bundle check for `ZodError` | §5.1, §9.5 |
| Bundle watch item | Keep ts-fsrs off the client | **Applied**: `previewAfterAgain` computed at build; ts-fsrs banned in P5 client paths | §5.4, §7.1, §7.3 W2, §9.5 |
| AP-15 | SLOs measured with consent-gated PostHog | **Applied**: anonymous Sentry metrics for client timings, server-side sources, PostHog for funnels only (D-22) | §9.6, §10 |
| AP-14 | RSC pages cannot set `Server-Timing` | **Applied**: page DB time from Sentry spans | §9.6 |
| AP-35 | Budgets without formulas | **Applied**: invocation formula per member; CLS as a lab gate | §9.6 |
| AP-25 | Reconnect resync burst | **Applied conditionally**: `bootId`/`useq` rule once P2 ships it, cdl rule until then | §5.3 |
| AP-04 / AP-22 | Per-user responses with long `max-age`; `no-store` vs `no-cache` | **No P5 change needed**: every P5 route is `private, no-store` with no ETag (due counts must not be stale), and the cache-tier lint is noted | §7 intro, §9.2 |
| AP-44 | HMAC mandatory and per-caller event allow-lists | **Applied as "inherit"** for the scheme (it conflicts with consistency R-08 and is P2/P13's call); P5 lists the events the worker may emit for the allow-list | §7.4, §11 |
| AP-01 | Dev on production's Neon project | **Applied on the P5 side** (see F-NEON-1) | §6.7, §9.7 |
| §5 gates | Index existence check; EXPLAIN fails on Seq Scan or Sort | **Applied** | §6.5, §9.1, §12.2 |
| AP-36 | api-design §9.2 budgets against `training_cards (userId, deck, due)` | **No P5 change** (api-design's to regenerate; P5's index exists with that shape) | — |
| AP-20 | `fallbackInterval` start time reset on every render | **No P5 change**: P5's only interval (the summary "Saving…" refetch) reads `q.state.dataUpdateCount`, not a closure start time, and stops after 5 tries | §5.2 S7 |
| AP-21 | Two `api()` implementations, `x-rc-build`, no `ifNoneMatch` | **No P5 change**: P5 calls P1's single `api()` | §5.1 |
| AP-30 | Optimistic policy is good | Kept | §5.3 |
| "Already fine" list | P5 W1 set-based batch, R1 one parallel batch | Kept | §7.3 |
