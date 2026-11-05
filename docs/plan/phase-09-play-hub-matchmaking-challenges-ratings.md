# Phase 9 detailed plan: Play hub, matchmaking, challenges, ratings

Status: **final plan (revision 2)**, 2026-11-02, branch `dev` @ `0848b76`. Allocation: `SP/plan/allocation.md` §3 "P9" (15 dev-days, 20 boards, schema M9, contract C2). This file is the phase spec that allocation §1.1 item 8 asks for. Once approved, `docs/implementation-plan.md` links to it.

Revision 2 folds in the five critiques (`SP/plan/critique-{coverage,consistency,feasibility,testing,api-perf}.md`). Every finding that concerns P9 is applied in place or rejected with a one-line reason in **Appendix A "Critique dispositions"**. Where the critiques disagree with each other (for example `endedAt` vs `playedAt`, static token vs HMAC), this spec follows the decision that **P2 revision 2** (`SP/plan/phase-02.md`, the shipping owner of those contracts) already took, and says so in §0.1.

The final copy of this spec lives at `REPO/docs/plan/phase-09-play-hub-matchmaking-challenges-ratings.md`. `SP/…` paths below point at the working inputs (critiques, design boards, the other phase specs) in the planning scratchpad, which may not survive a reboot; the board names and IDs are enough to find them again in the Claude Design canvas.

**Path shorthands** (same as allocation.md)

| Short | Path |
|---|---|
| `REPO` | `/Users/rohitpandit/open_source/chess-battle-turbo` |
| `WEB`, `WS`, `WK` | `REPO/apps/web`, `REPO/apps/web-socket`, `REPO/apps/analysis-worker` |
| `PKG` | `REPO/packages`. `contracts` and `game-core` are created in P1–P2, `db` in P2. **`domain` is created by this phase** (WP-A) |
| `SP` | `/private/tmp/claude-501/-Users-rohitpandit-open-source-chess-battle-turbo/8433de47-73d2-466e-945c-3c2450748123/scratchpad` |
| `DR` | `SP/design-ref/project/v2` (board files `*.dc.html`) |
| `DS` | `SP/design-ref/ds/project` (design-system README, tokens, components) |

Line numbers in `WEB/…` and `WS/…` are at `0848b76`. Files that earlier phases create (P1–P8) are named by the path their phase spec gives them; for P2 that is revision 2. Where P9 depends on such a file, §2.3 lists a check that fails loudly if it is missing.

---

## 0. The phase on one screen

| | |
|---|---|
| **Goal** | Ship the v3 Play hub (Legend · Bot · Friend · Online). Matchmaking moves into the socket server's memory, so nothing polls Vercel or Neon while searching. Friend challenges can be accepted signed in or signed out (through sign-up and the trial). Positions can be shared at `/s/<code>`. Glicko-2 ratings per pool (Bullet, Blitz, Rapid) land, the rating slots that earlier phases left dark light up, and the bot ladder is calibrated (P2 handoff H-06). |
| **Owner can test** | Hub tabs and states; two browsers queue → match found → game; one browser queues alone → 20 s widened → 60 s → "Play a bot"; a challenge link opened signed out → sign up → trial → accept → game; a profile-style link `/play?tab=friend&opponent=martin_k`; `/s/<code>` from a review moment, with the paywalled variant for user R; "Blitz 1184 → 1192 (+8)" after a rated game on the result card, Home and the archive. |
| **Depends on** | P1 (shell, kit, `route()`, `api()`, `qk`, flags, rate limiter, test tooling X1–X18), P2 rev 2 (socket v2, `user:` room, `ROOM`, event registry, `internalFetch()`, `finish.ts` fragments, `GamePlayer.ratingBefore/After/Delta`, `games_open_idx`, `TIMING_PROFILE`, `e2eRun`, `poolOf()`, bot ladder), P3 (`Share` table, `HOUSEKEEPING` job, review ⋯ menu), P4 (`LinkedAccount.ratings`, `initialRating`/`ratingBand`, sign-up → onboarding → trial return path), P5 (`glicko2.ts`, `getHomeData()` and its `stats` slot), P7 (`RenewSheet`), P8 (CAT-4/CAT-5, `positionsVolume()`, `/play/legend/[slug]`, the `/position/*` 308s). |
| **Boards** | 20 (§4): `V3PlayHub`, `V3Queue`, `V3NoOpponent`, `V3MatchFound`, `V3ChallengeShare`, `V3ChallengeAccept`, `V3ChallengeAcceptGuest`, `V3PositionShare`, plus `V3{iPhone,Android,iPadL,iPadP}{PlayHub,Queue,MatchFound}`. |
| **Schema** | M9 expand migration: `challenges`, `player_ratings` (with two recompute-anchor columns), `user_settings`; indexes `challenges_open_idx`, `user_settings_reminder_idx`, `game_players_h2h_idx`, `shares_owner_created_idx`; grants for `replay_realtime` and `replay_worker`. `shares` already exists from P3. Contract step **C2** (drop `matchmaking_queue`) ships one release later, after the owner confirms. |
| **New API** | 5 challenge routes, 3 shared-position routes, `GET/PATCH /api/me/preferences`, 2 OG image routes; socket commands `queue:join`, `queue:leave` and 6 events. |
| **Removed** | 5 `/api/matchmaking/*` routes, `/api/chess/{create-game,join,cancel-game}`, the 1 Hz poll, `lib/services/matchmaking/*` (778 lines), and the legacy `/play`, `/queue`, `/challenge/new` and `/join/[gameReferenceId]` pages (about 4,400 lines in total). `/position/[referenceId]` was already redirected by P8 (D8-12). |
| **Flags** | `play-hub-v3` (PostHog, server-evaluated by P1's flags module). On for the owner and E2E users A–P and R on dev. The legacy pages stay reachable with the flag off until the parity check in §15 passes, then they are deleted inside this phase in one isolated, revertable PR (§14.3). New: `online-legend-pool` (default on): when off, the Online tab hides "Legend Position" and everybody queues from the standard start (the feasibility critique's launch configuration, D21). |
| **Estimate** | **17.5 dev-days** in 10 work packages (§13), plus a 20 % buffer line (3.5 d). Allocation budget 15; §13.3 explains the +2.5 (bot calibration moved in from P2/P8, test plumbing, rating recompute tool). The critical path is WP-A → WP-C → WP-E → WP-I. |
| **Schedule note** | If the owner takes the feasibility critique's "Launch A" cut (P9 after launch), nothing in this spec changes except §6.5: M9 then reaches production in P9's own release (rehearsed on a child branch of `production`), and the flag rollout replaces live legacy pages (risk K10 then applies to real users). |

### 0.1 Reconciliations this spec applies

The input documents sometimes disagree. This table records the choice made here, so the work packages don't have to decide again. Rows R17–R31 are new in revision 2.

| # | Topic | Inputs say | This spec | Why |
|---|---|---|---|---|
| R1 | Match event name | allocation §5.2: `match:found`; api-design §6.6 and inv-play-a §4.4: `queue:matched` | **`queue:matched`** (PostHog keeps the analytics name `match_found_viewed`) | api-design owns event names; consistency R-07 and R-18 |
| R2 | User room string | allocation B20: `user:{ref}`; api-design §6.3: `u:{ref}` | **`ROOM.user(ref)` from `PKG/contracts/src/socket/rooms.ts`** (P2 creates it, consistency fix 2.6). P9 never writes a literal room name; the lint rule of api-perf §5 enforces it | One source of truth |
| R3 | Per-game rating history | allocation M9: a `RatingEvent` table; data-model D16: rating and delta on `GamePlayer` | **No `RatingEvent`.** `GamePlayer.ratingBefore`, `ratingAfter`, `ratingDelta` (P2 M2 columns). The finish guard (`status='IN_PROGRESS'` conditional update) makes them idempotent. With the seed anchor columns on `player_ratings` (R23) they are the recompute source for a rollback (§6.10) | data-model D16; feasibility §9 P9 row |
| R4 | Shared positions table | allocation M9: `SharedPosition`; data-model D17: one `Share` table | **`Share` (kind `POSITION`), created by P3.** The API keeps api-design's paths (SP-1…3). No view counters and no view beacon: views are PostHog events | A per-view `UPDATE` would wake Neon on every crawler hit (D17) |
| R5 | Challenge ↔ game link | allocation: `Game.challengeId`; data-model: `Challenge.gameId @unique` | **`Challenge.gameId @unique`** | data-model |
| R6 | Colour columns | data-model `whiteUserId`; allocation B2 `whitePlayerId` | **`whitePlayerId` / `blackPlayerId`** (P2 shipped them) | consistency R-01 |
| R7 | Rating pool column | allocation: `ratingPool`; data-model: `Game.timeClass`, `PlayerRating.pool: TimeClass` | **`timeClass` / `pool: TimeClass`** (BULLET, BLITZ, RAPID for rated play); the pool of a time control is P2's `poolOf()` (R20) | data-model, P2 §8.11 |
| R8 | Route wrapper | allocation B18: `route()`; api-design: `defineRoute()` | **`route()` from `WEB/lib/api/route.ts`** | B18 is binding |
| R9 | Queue URL | allocation: `/play/online`; inv-play-a §7.3: `/play/queue` | **`/play/online`**. `/play/queue` and the legacy `/queue` redirect to it with 308 | allocation |
| R10 | Where "Match found" renders | client-data-layer §3.8: on the game screen; inv-play-a §7.4 and allocation: a state of the queue route | **A state of `/play/online`**, with `router.prefetch('/game/<ref>')` and `usePendingBoard` written the moment `queue:matched` arrives | The design gives it its own board with "Go to the Board". Study start is anchored to the server's `startsAt`, so there is no added latency (§8.2.6). P2's game files stay untouched |
| R11 | Who writes the quick-match game row | architecture X2 / allocation B4: the socket writes Neon directly; api-design API-09 and data-model D22: internal routes | **Direct writes through `PKG/db`** (B4, P2 §0.2): one new single-statement file `PKG/db/src/live/createMatchedGame.ts` (R22). Tournament writes stay P12's internal routes (consistency R-11) | P2 settled it; consistency fix 9.5 removes the old hedge |
| R12 | Where `botStrength` lives | data-model §3.13: `prefs.training.botStrength`; api-design §0.3: a `play` section | **`prefs.play.botStrength`**, with the other hub defaults. `PreferencesV1` has **no `train` section**: Settings › Training keeps writing P5's `PATCH /api/train/prefs` (consistency fix 10.5 option a) | Hub defaults belong together |
| R13 | Challenge expiry sweep | inv-play-a §3.3: hourly on the socket server | **Derived on every read and accept (GETs never write), plus a slice of P3's daily `HOUSEKEEPING` job** | An hourly write wakes Neon 24 times a day (≈ 15 CU-h a month of 100, §9.8); feasibility #4, api-perf AP-08 |
| R14 | Position search for the Legend tab | allocation P9 HTTP list: `GET /api/positions/featured`; P9 rev 1: `/api/positions/search` | **Not built.** P8's CAT-5 `GET /api/positions?collection=legend-practice&q=` covers it | No duplicate catalogue route |
| R15 | `UserSettings` | data-model: Phase 1 (M1b); allocation B14: P9 first | **Created in M9** with data-model §5.2's exact shape, `consent Json?` included (P11 D7 writes it). P9 adds the `play` section; P10 adds `pushOptIns` and the settings UI | allocation decides when; data-model decides the shape |
| R16 | `player_ratings (pool, rating)` index | allocation M9 lists it | **Not created** (no leaderboard board in v3) | Saves write cost; add it with a leaderboard |
| R17 | Per-member end-time column and the archive index | api-perf AP-07: rename to `playedAt`; consistency R-01: keep P2's `endedAt` | **`game_players."endedAt"`** and `game_players_userId_endedAt_gameId_idx`, the names P2 rev 2 ships (P2 §0.2). Wire DTOs may still call the value `playedAt` | P2 rev 2 already ruled; one column either way |
| R18 | Internal service auth | consistency R-08: static `x-internal-token`; api-perf AP-44 and feasibility #5: HMAC | **HMAC through P2's helper**: P9 calls `internalFetch(url, body)` (`WEB/lib/internal/fetch.ts`, P2 §7.5.1) with kid `web`; the receiver checks the kid's event allow-list. P9 never writes an auth header. Env name `INTERNAL_API_SECRET` (key set); `INTERNAL_HMAC_SECRET` does not exist | P2 rev 2 took this decision; if the owner overrules it there, only P2's helper changes |
| R19 | Error-code ledger | P9 rev 1: `PKG/contracts/src/http/errors.ts` | **`PKG/contracts/src/http/codes.ts`** (P1). `gone` (P3) and `illegal_position` (P2) already exist. P9 appends to `CONFLICT_REASONS` (`own_link`, `live_game`, `already_in_game`; `already_started` is P2's) and creates `GONE_REASONS = ["expired","cancelled","declined","creator_unavailable","revoked"]` next to it (append-only) | consistency R-06 |
| R20 | Time control → pool | P9 rev 1: a new `time-control.ts` `poolFor()` | **P2's `poolOf()` in `PKG/game-core/src/rules/timeClass.ts`**. P9 adds only `TC_PRESETS` and `presetLabel()` to that file if P2 did not ship them | One rule, P2 §8.11 |
| R21 | Spectating a challenge game | P9 rev 1: a `watch` code on `game:join` | **P2's rule unchanged**: FRIEND, ONLINE and TOURNAMENT games are watchable by members through `spectate:join { ref }` (P2 §7.4.4). "Watch the Game" links to `/game/{ref}`. No watch code, no edit to P2's access rules | P2 rev 2 already makes FRIEND games watchable |
| R22 | Quick-match game creation | P9 rev 1: an insert into `games` only, `phase 'waiting'`, no `expiresAt` | **One CTE that inserts `games` and both `game_players` rows** (P2's `createRematch` pattern), `phase = 'WAITING'`, `"expiresAt" = now() + 24 h` (the column stays `NOT NULL`, consistency R-01), the display snapshot columns, `meta` (`GameMetaV1` + `source`, `notBefore`) | P2 needs the `GamePlayer` rows from creation (live-game lookups, finish CTE) |
| R23 | Glicko-2 module | feasibility #11: P5 (τ 0.5, RD floor 50) and P9 (τ 0.75, RD floor 45) both "create" `glicko2.ts` | **One parameterised module** `glicko2(state, results, cfg)` (P5's file); presets in `PKG/game-core/src/rating/presets.ts`: P5's `PUZZLE`, P9's `GAME`. P9 does not edit the update formula. Constants come from Glickman's paper and our own choices, never from AGPL code (feasibility LIC-4) | One implementation, two documented presets |
| R24 | Usernames | P9 rev 1 selected `users.username` | **`User.username` arrives in P10 (M10).** P9's `PlayerCard.username` is `null` until then and the display uses `users.name` and `"profilePictureUrl"` (the real column names) | The column does not exist in P9 |
| R25 | Code formats | P9 rev 1: one code module for challenges and shares | **Challenge codes**: 8 Crockford characters, upper case (`/join/8KQ2XM7P`, the design's style). **Share codes**: P3's generator, lower case (`/r/8kq2xh4m`, `/s/…`). `normaliseCode(kind, input)` handles both | P3 created the `shares` code format first |
| R26 | `/position/[referenceId]` | P9 rev 1: a 308 route handler | **P8 owns it** (D8-12 deletes the page and 308s to `/legends/positions/<slug>`). P9 only keeps it in `legacy-redirects.spec.ts` | No double ownership |
| R27 | Home rating lines | P9 rev 1: `WEB/lib/data/home.ts` | **P5's `getHomeData()` in `WEB/lib/home/home.server.ts`**: P9 fills `HomeData.stats.ratingLabel` (the field P5's contract reserves: `{ headline: "Blitz 1184", week: "Blitz 1176 → 1184 since Monday" \| null } \| null`) and adds two columns to P5's existing "this week" read, so Home gains **0 statements** | P5 L1170 |
| R28 | Return-target labels on auth screens | P9 rev 1: edit P4's `lib/navigation/return-to.ts` | **P9 ships `WEB/lib/data/return-targets/play.ts`** (`challengeTarget(code)`, `shareTarget(code)`, built on the same tagged loaders and P11's D23 kinds) and registers them in `resolveReturnTarget()` if that file exists when P9 starts; otherwise P11 (S11, `GET /api/return-target`) registers them | P4 and P11 disagree on who creates `return-to.ts`; P9 works either way |
| R29 | Cache tier names | P9 rev 1: "T0/T1/T2/NS" | **P1's wrapper tiers** `public-static`, `private-etag`, `no-store`; OG route handlers set their headers explicitly (§7.1). No T-numbers | api-perf §1 "Cache tier names" |
| R30 | Rate-limit specs | P9 rev 1: token-bucket "30, 1 per 2 s" | **P1's fixed window `{bucket, limit, windowSec, by, store}`**. Bursts (≤ 300 s) use P1's `burst` store; the two daily caps are **counted from the source rows** (`challenges`, `shares`) inside the statement the route runs anyway, which survives Neon suspends and costs no extra write (P1's `durable` store would add an upsert per request) | consistency R-13, api-perf AP-11, P1-09 |
| R31 | Profile "Challenge" button target | P10: `/play/friend?opponent=@{u}`; P9 rev 1: no such route | **Canonical `/play?tab=friend&opponent=<username>`**. `/play/friend` (no code) 308s there with the query kept, so P10's link works either way. The challenge stays an open link; the username only labels it | coverage C-11 |

---

## 1. Goal and user-visible outcome

### 1.1 Goal

1. Replace the 682-line client `/play` page with the v3 Play hub: an RSC first paint with no client fetch on load, the URL holding every selection, and one primary CTA per tab.
2. Move quick-match matchmaking off HTTP polling and the `matchmaking_queue` table onto the socket server's memory. A searching member costs 0 Vercel invocations and 0 Neon statements until a pair is found; then exactly one write creates the game.
3. Friend challenges with short codes, 24 h expiry, QR, a public accept page with link previews, and the sign-in / sign-up → trial → back-to-the-challenge loop.
4. Shared positions at `/s/<code>`: public preview, members play them against a friend or the bot, owners revoke them.
5. Glicko-2 ratings per pool, seeded from linked Chess.com or Lichess ratings or from the onboarding level. Rated games update both players inside P2's single end-of-game statement, and the deltas reach the game-over card, the resign confirm, Home, the archive and the shell. Every rating can be rebuilt from stored inputs (§6.10).
6. Calibrate the bot ladder that P2 shipped uncalibrated, so the hub's strength numbers and captions are honest (§8.12).

### 1.2 What the user sees at the end of P9

- **Play** in the nav opens the hub. Tabs: Legend (search the legend positions, play one against the engine), Bot (strength 400–2000+ with captions, remembered across devices, calibrated so "1200" plays like a 1200), Friend (create a link from the start or from a legend position, rated or casual), Online (legend position of the day or the standard start, rated).
- **Find opponent** shows a searching card with a live timer and the rating window. At 0:20 it widens from ±100 to ±200 and also accepts the other time controls of the same group (Blitz with Blitz); at 1:00 it gives up with "No opponent found" and **Play Against Bot** on the same position. A found match shows a 3-2-1 countdown with the opponent's name and rating, then opens the game.
- **Create challenge link** opens a share page with the link, Copy, QR and Share…. The page switches to "Your friend joined" by itself the moment the friend accepts, from any device.
- **A challenge link** (`/join/8KQ2XM7P`) previews nicely in chat apps. Signed out, it shows who is challenging and offers sign-in or the 7-day trial, then comes back to the same card. Members accept with one click.
- **"Challenge" on a profile** (P10) opens the Friend tab labelled "Send this link to @martin_k"; the link itself still works for whoever opens it.
- **"Share position"** in a review moment or a legend position menu creates `/s/<code>` with an optional note. Anyone can open it; members play it.
- **Ratings**: "Blitz 1184" in the shell and on Home, "Blitz 1184 → 1192 (+8)" on the result card, "+8" on archive rows, "martin_k wins and you lose about 8 rating points." in the resign confirm, and "1184?" while a rating is provisional (fewer than 5 rated games in that pool).

### 1.3 Owner test script (dev: `https://replay-chess-dev-replaychess007-1069.vercel.app`, ego-browser)

Users: A and B (shared members from A–P), R (non-member, never trialled), a throwaway `e2e-signup-<date>+clerk_test` email for the sign-up path (`E2E_CLERK_TEST_CODE`), Dodo test card `4242 4242 4242 4242`. The results go into `REPO/docs/qa/phase-09-signoff.md` (§12.0).

1. **Hub.** Sign in as A → `/play`. The Online tab is selected by default. Switch Legend → Bot → Friend → Online with the mouse, then with keys `1`–`4`. On Legend, type "Kasparov": the list filters as you type. Type "zzz": "No legends match “zzz”" with **Clear Search**. On Bot, set the strength to 1600, reload, and it is still 1600. Open `/play` on a second device as A: still 1600 (synced prefs). Hover the bot chip: no "≈ · not yet calibrated" tooltip (WP-J).
2. **Quick match.** Browser 1 = A, browser 2 = B. Both go to Online, 5+3, Legend position → **Find Opponent**. Both see "Searching", then "Match found · vs …", a 3-2-1 ring, then the game in the study phase on the same position with opposite colours. Open DevTools on A: no request to `/api/matchmaking/*`, and only one `/game/<ref>` document request.
3. **Rating.** In that game B resigns after two moves each. A sees "Blitz 1184 → 1192 (+8)" (numbers vary) on the result card. Go to `/home`: the header shows the new Blitz rating. `/games`: the row shows the delta. Start a new rated game (A and B pair again after about 20 s, because the previous opponent is skipped until the range widens) and open the resign confirm: it states the points at stake.
4. **No opponent.** A alone: Online, 3+2 → **Find Opponent**. At 0:20 the card says the range widened to ±200 and other Blitz time controls are accepted. At 1:00: "No opponent found" → **Play Against Bot** → a bot game from the same legend position.
5. **Merge.** A queues 5+3, B queues 3+2 (both Legend). Nothing happens before 0:20; just after it, both get "Match found", and the card says "Blitz 5+3" plus "Matched on your opponent's time control" for B (A joined first, so A's preset wins).
6. **Challenge, signed out.** A: Friend tab, 5+3, colour Black, Rated on → **Create Challenge Link**. Copy the link. In a private window (signed out) open it: the guest card with a marketing header, "martin_k challenges you" (A's name), **Sign In to Accept** and **New Here? Start a 7-Day Free Trial**. Pick the trial → sign up with the throwaway email → onboarding → Dodo test checkout → you land back on the same challenge card, signed in, as a member → **Accept Challenge**. Both windows open the game; A plays Black. A's share page switched to "Your friend joined" by itself.
7. **Challenge states.** As A, open your own link: "Share this link with a friend" (own link). As B, open an accepted link: "Someone else joined first" with **Watch the Game** (opens the game as a spectator). As A, create a link and cancel it; B opens it: "This game doesn't exist". Open a seeded expired code (`/join/SEEDEXP1`): unavailable. As R open any open link: the paywalled card with the trial copy.
8. **Profile link.** As A open `/play/friend?opponent=@martin_k`: it lands on `/play?tab=friend&opponent=martin_k`, the opponent bar reads "? @martin_k · joins from your link", and the created share page says "Send this link to @martin_k".
9. **Shared position.** As A open a reviewed game → a key moment → ⋯ → **Share Position** → note "Find what I missed" → **Create Link** → copy. As B open it: **Challenge a Friend** and **Play vs Bot** both work. As R: paywalled, no play buttons. Signed out: a public preview with the trial CTA. As A open your own share → **Stop Sharing** → B reloads: "This position isn't available" (HTTP 404), and the old OG image URL returns the generic image.
10. **Edges.** A queues in tab 1, then queues in tab 2: tab 1 says "Searching in another tab" with **Search Here Instead**. Turn the network off while searching: "You're offline". Turn it on: it rejoins and the timer continues.
11. **Devices.** Repeat 1, 2 and 6 on a real iPhone and a real Android phone, and on desktop at 80 %, 125 % and 150 % browser zoom. Nothing scrolls the page; boards stay fully visible.
12. **Cost.** While A and B search for 60 s, the Neon dev branch's monitoring shows no queries from the app role. Vercel's function log shows no invocation during the search.
13. **Close** every ego-browser page you opened (`task.finish({ keep: [] })`, CLAUDE.md tab hygiene).

---

## 2. Scope

### 2.1 In scope

| Area | Items |
|---|---|
| Screens | Play hub (4 tabs × 6 states), matchmaking queue (8 states), match found (2 states), challenge share (5 states + joined), challenge accept signed in (7 states) and signed out (`logged_out`), shared position (5 states + signed-out and owner variants), the share-position dialog (undesigned, built from the kit), dev demo routes for every state |
| Realtime | Socket matchmaker (time-class buckets with preset merging after 20 s, widening, colour balancing, position of the day, timeouts, two-tab and reconnect handling, abort abuse limit, bot fallback, `e2eRun` isolation in tests), `queue:*` events, `challenge:accepted` / `challenge:declined` to the creator's user room, an online no-show window |
| HTTP | Challenges CHL-1…5, shared positions SP-1…3, preferences ME-3a/3b, OG images for challenges and shares, redirects for the legacy routes and `/play/friend`, the `opponent` hint on the Friend tab, middleware allow-list changes, `robots.txt` change |
| Ratings | Glicko-2 `GAME` preset in `game-core`, seeding, the provisional rule, stakes, the rated-game rules, a pair farming cap, the rating fragment inside P2's single-statement finish, socket token rating claims, the lit slots in P1/P2/P3/P5 screens, a recompute tool for rollback (§6.10) |
| Bot | Ladder calibration (`WEB/scripts/calibrate-bots.ts`, P2 handoff H-06 / coverage C-15) and removal of the "≈ · not yet calibrated" tooltip (§8.12) |
| Data | M9 migration, the rating seed backfill, role grants, dev seed fixtures, contract C2 prepared (it runs one release later) |
| Quality | Unit, contract, socket integration, E2E with isolated queue pools and the fast timing profile, device × zoom, visual baselines, chess-correctness fixtures, k6 queue scenario, telemetry asserted through P1's sink, sign-off record |

### 2.2 Explicitly out of scope

| Out | Where it goes |
|---|---|
| Tournament pairing on the socket, arena screens | P12 (tournament games use the `GAME` preset and P9's rating fragment) |
| Offline bot play from the queue's `offline` state ("Play vs bot offline", `botHref`) | **P11** (coverage C-10; P11 §2.4 row, WP-E): a link to `/play?tab=bot` (the cached Play document), shown only when `engine:ready` and P11 Q15 = yes. P9 builds the slot: `QueueCard` takes an optional `offlineAction` prop and renders nothing when it is absent, so P11 only passes it (§4.2) |
| "Watch another game" (`live:list`, second CTA of `over_spectator`) | **P2** builds it. P2's final spec withdrew its trim 13.4, so there is no conditional work left in P9 (coverage C-17) |
| Rating history chart, leaderboards, public profile ratings | P10 (`GET /api/players/{username}/rating-history`, read from `game_players` rated rows; there is no `RatingEvent`) |
| Resolving `opponent=<username>` to an avatar and rating | P10 (it adds `User.username`); P9 shows the validated handle as text |
| Push or email notification when a challenge is accepted | P10 (`Notification`, job kind `NOTIFY_DISPATCH`). P9 uses an in-app toast through the user room |
| Player blocks honoured in pairing | P10 creates `UserBlock`; P9 ships an `isBlocked(a, b)` hook that returns false until then |
| Direct challenge to a named player (a challenge only that user can accept), friend lists | Not planned. The `opponent` hint labels an open link; it does not restrict it |
| Rematch, draw offers and every in-game state | P2 (P9 only fills `stakes`, `rated`, `provisional` and `ratings` in P2's payloads) |
| `/play/legend/[slug]` and the legend practice game | P8 (the hub's Legend tab links to it) |
| `/position/[referenceId]` redirects | P8 (D8-12); P9 regression-tests them only |
| Review share links `/r/<code>` | P3 |
| v3 sign-in / sign-up screens and `resolveReturnTarget()` | P11. P9 uses whatever sign-in and sign-up routes exist, with `redirect_url`, and hands P11 its resolvers (R28) |
| Ratings for bot games or puzzles | Never for bot games (unrated by design). Puzzle rating is P5's `TrainingProfile` (preset `PUZZLE`) |

### 2.3 Dependencies on earlier phases (checked by `WEB/scripts/p9-preflight.ts`, WP-A day 1)

The preflight fails loudly, with the missing item named, before any P9 code is written.

| From | Needed | Check | If missing |
|---|---|---|---|
| P1 | `route()` (tiers `public-static`, `private-etag`, `no-store`; `RateLimitSpec {bucket, limit, windowSec, by}`), `api()` + `devSchema()`, `qk`, `QueryProvider` error mapping, `RateLimitBucket`, flags, `getViewer()`, `requireMember()`, `requireMemberPage()`, middleware allow-list, shell modes, `BoardStage`, `ScrollRegion`, kit components, `playwright.devices.config.ts`, `/dev/ui` gallery; test tooling: `isNonProd()`, `WEB/lib/test-hooks/registry.ts`, `WEB/e2e/fixtures/{users,lease,telemetry,console-guard,time}.ts`, `packages/analytics/src/events/`, `docs/qa/design-states.json`, the visual-regression setup, `ci.yml` `integration` and `e2e-smoke` jobs, `nightly.yml` (testing X1–X18) | files exist and their exports type-check | Missing kit or wrapper: stop, P1 must finish first. Missing test tooling: P9 uses the nearest equivalent and lists the gap in its sign-off; it never builds a second copy |
| P1 | Registries as directories (feasibility §7): `lib/api/keys/`, `lib/flags/registry/`, `lib/routes/classes/`, `config/redirects/`, `lib/seo/robots-rules/`, `lib/realtime/handlers/`, `PKG/contracts/src/http/registry/`, `e2e/personas/` | `ls` | P9 makes one additive edit per single-file registry and records it in `REPO/OWNERS.yml` (P1) |
| P1/P2 | `IdempotencyKey` table and `WEB/lib/api/idempotency.ts` | `idempotency_keys` exists on Neon dev | WP-A adds data-model's M1 block to M9 |
| P1/P2 | Neon dev and E2E on their own Free project (api-perf AP-01, testing X16) | `DATABASE_URL` host of `replay-chess-dev` ≠ the production project | k6 and the nightly e2e runs in §12 wait until the split lands; unit, contract and CI e2e (Docker Postgres) do not |
| P2 rev 2 | `PKG/contracts/src/socket/{rooms,registry,game,token,codes,limits}.ts` (`ROOM.user`, the server→client registry, `GameState`, `PlayerView`, `SocketTokenClaims` with `e2eRun`), `WEB/lib/realtime/connection.ts` (`acquire`, `room`, `command`), `UserChannel`, `WEB/lib/internal/fetch.ts` `internalFetch()`, `PKG/db/src/live/{finish,loadLiveGame}.ts` with named fragments, `PKG/db/src/games/createLiveGame.ts`, `PKG/db/src/json/game-meta.ts` (`GameMetaV1`), `PKG/game-core/src/{rules/timeClass,machine/reduce,machine/timers,bot/strength}.ts`, `WS/src/config/timing.ts` (`TIMING_PROFILE`), `POST /api/games` (`WEB/lib/games/create-bot-game.server.ts`), `game:result.ratings` slot, columns `Game.mode/rated/timeClass/whitePlayerId/blackPlayerId/startPly/phase/whiteName/blackName/whiteRating/blackRating/meta/expiresAt`, `GamePlayer.rated/timeClass/result/endedAt/opponentUserId/ratingBefore/ratingAfter/ratingDelta`; `games_open_idx`, `game_players_userId_endedAt_gameId_idx`; `usePendingBoard`; `Board` static mode, `MiniBoard`, `PlayerBar`; role `replay_realtime` | grep the exports; `\d games`, `\d game_players` on Neon dev | `rooms.ts` missing → WP-A adds it (consistency fix 2.6 names P2 as owner; P9 only fills the gap). `sharedCode` missing in `POST /api/games` → WP-G adds it. Any other gap stops the phase |
| P3 | `shares` table (kind REVIEW, P3 code generator), the review key-moment ⋯ menu, archive rows reading `ratingDelta`, the worker `HOUSEKEEPING` job with the `WK/src/scheduler/recurring/` slice directory (`RecurringSlice`), role `replay_worker` | `\d shares`; `SELECT 1 FROM pg_roles WHERE rolname='replay_worker'` | `shares` missing → M9 creates it with P3's block |
| P4 | `LinkedAccount.ratings` (`RatingsV1 {v, bullet?, blitz?, rapid?, …: {rating, best, games}}`), `User.initialRating` / `ratingBand`, `WEB/lib/accounts/link-service.ts`, `WEB/lib/onboarding/steps.ts`, onboarding keeping `redirect_url` (`rc_onb_next`), the checkout return to `redirect_url`, `safeReturnPath` | grep | Without the return path the signed-out acceptance loop breaks. Then WP-F adds the `/join` and `/s` prefixes and checks the onboarding Done redirect |
| P5 | `PKG/game-core/src/rating/glicko2.ts` (+ `presets.ts` if P5 took feasibility #11), `getHomeData()` in `WEB/lib/home/home.server.ts`, `HomeData.stats` in `PKG/contracts/src/http/home.ts` | grep | `glicko2.ts` missing → WP-B creates the parameterised module with both presets. Not parameterised → WP-B moves its constants into `PUZZLE` with no behaviour change (P5's tests must pass unchanged) |
| P7 | `RenewSheet` (the 402 in-place sheet) | grep `RenewSheet` | Use a link to `/pricing?reason=…&redirect_url=` instead |
| P8 | `positionsVolume()` (the practice set), `getPosition(slug)`, `getPositionForPlay(slug)` (`WEB/lib/data/catalog.ts`, tags `positions`, `position:<slug>`), `/play/legend/[slug]`, CAT-5 `GET /api/positions?collection=legend-practice&q=`, verified practice positions with slugs and hero sides, the `/position/*` 308s | grep; `SELECT count(*) FROM chess_positions WHERE "practiceOrder" IS NOT NULL AND "verifiedAt" IS NOT NULL` | The Legend tab cannot ship without P8 |

---

## 3. Current code touched

"At P9 start" is the state the earlier phase specs leave behind (allocation §5.3, the per-phase "Kept until P9" lists and P2 rev 2 §7.2). "P9 action" is what this phase does to it.

### 3.1 Pages and components

| File (lines today) | Today (`0848b76`) | At P9 start | P9 action |
|---|---|---|---|
| `WEB/app/play/page.tsx` (682) | Client page behind `useRequireSubscription` (`:11`, `:57`). Modes quick/friend/ai; pushes `/queue?…` (`:143`); `create-ai-game` (`:155`); `create-game` (`:193`); `ShareLinkModal` (`:649-660`); catalogue from the persisted `useDataStore`; full-screen spinner (`:222-252`, audit-client) | Wrapped in the v3 shell (P1); bot creation re-pointed to `POST /api/games` (P2 WP-E); legend picker links to `/play/legend/<slug>` (P8) | **Replace.** Move it to `WEB/features/play/legacy/LegacyPlayPage.tsx`, rendered only when `play-hub-v3` is off. New RSC hub (§4.1). Delete after parity (§15) |
| `WEB/app/play/layout.tsx` (13) | Metadata only | same | **Remove** (metadata moves into the page) |
| `WEB/app/play/ShareLinkModal.tsx` (341) | Invite modal used by 6 callers: `play/page.tsx:17,649`, `challenge/new/page.tsx:7,145`, `game/[gameId]/GamePageContent.tsx:21,1413`, `analysis/[gameId]/AnalysisShareModal.tsx:10,370`, `legends/[referenceId]/ChallengeLegendButton.tsx:13,99`, `position/[referenceId]/PositionPageClient.tsx:13,503` | P2 deleted `GamePageContent.tsx` at its gate; P3 replaced `/analysis`; P8 deleted the legend button and `/position`. Callers left: the legacy play page and `/challenge/new` | **Remove** with the legacy pages. Acceptance: `grep -r ShareLinkModal WEB/app WEB/features` returns nothing |
| `WEB/app/queue/page.tsx` (405) + `layout.tsx` (13) | `useMatchmaking` 1 Hz poll (`:206`), create (`:71`), `sendBeacon` cancel (`:148`), keepalive cancels (`:161`, `:185`, `:218`, `:244`), fixed 1.5 s redirect delay (`:55-62`), spurious cancels on state change (audit-client §8.1) | `create-ai-game` caller switched (P2) | **Replace** with `/play/online` (§4.2). `WEB/app/queue/route.ts` becomes a 308 handler that maps `?time=&increment=&legend=` to `?tc=&pos=` |
| `WEB/app/components/matchmaking/{MatchFound,NoOpponentPopup,QueueSearching,QueueTimeout,index}.tsx` (526) | Legacy queue UI | Unchanged | **Remove** |
| `WEB/app/challenge/new/page.tsx` (181) | `create-game` (`:36`) + `ShareLinkModal` (`:145`); cancel on close (`:153`) | Unchanged | **Remove**; static 308 `/challenge/new` → `/play?tab=friend` |
| `WEB/app/join/[gameReferenceId]/page.tsx` (465) + `layout.tsx` | Client page; public `game-by-ref` (`:70`); `chess/join` (`:98`); `?autojoin=true` (`:133-140`); sign-in gated by `middleware.ts:21`, so the guest board can't render (inv-play-a B17) | Unchanged (P2 rev 2 keeps the browser use of `game-by-ref` until P9) | **Replace** with `WEB/app/(shared)/join/[code]/page.tsx`. One dynamic segment serves both link formats (§7.6): 8-char codes → challenge; a legacy cuid → `/game/<ref>` or "This link is from an older version" |
| `WEB/app/position/[referenceId]/*` | Member-gated client page | **Gone**: P8 D8-12 deleted it and 308s to `/legends/positions/<slug>` | None (regression test only, R26) |
| `WEB/app/components/Breadcrumbs.tsx:88-90,104` | Queue and join crumbs | P1's shell may have removed breadcrumbs | **Remove** those branches if the file still exists |
| `WEB/lib/stores/useDataStore.ts` | Persisted catalogue (client-data-layer §6.3 deletes it) | P8 dropped `persist`; its last consumer is the legacy play page | **Delete** with the legacy page if P8 has not |

### 3.2 API routes

| File (lines) | Today | At P9 start | P9 action |
|---|---|---|---|
| `WEB/app/api/matchmaking/create-match-request/route.ts` (89) | 6–10 statements incl. a transaction; duplicate entries from two tabs (audit-api §3.5) | Made atomic by P2 (`createLiveGame(tx)`, partial unique index `matchmaking_queue_one_searching_per_user`) | **Remove** after the parity check |
| `…/match-status/route.ts` (90) | GET that writes; polled at 1 Hz (`lib/hooks/useMatchmaking.ts:30,119`) | same | **Remove** |
| `…/cancel-match-request/route.ts` (72), `…/cancel-beacon/route.ts` (51) | Cancels, also spurious | same | **Remove** |
| `…/cleanup/route.ts` (40) | Never called (not in `INTERNAL_ROUTE_PATHS`, `WEB/lib/auth/resolve-user.ts:21`, audit-api #27; P1 renames the constant `INTERNAL_ROUTE_IDS` in `lib/auth/internal.ts`) | same | **Remove** |
| `WEB/app/api/chess/create-game/route.ts` (208) | Friend game row created up front, `WAITING_FOR_OPPONENT`, 1 h expiry (`:25`, `:120`); `gameData.creatorColor` (`:99-117`) | Through `createLiveGame()`, atomic, fixed colours (P2 §7.2) | **Remove**; replaced by `POST /api/challenges` |
| `WEB/app/api/chess/join/route.ts` (183) | Update without a status condition (`:82-88`, F-06) | Conditional (P2) | **Remove**; replaced by `POST /api/challenges/{code}/accept` |
| `WEB/app/api/chess/cancel-game/route.ts` (86) | Unconditional update (`:47-50`) | Conditional (P2) | **Remove**; replaced by `DELETE /api/challenges/{code}` |
| `WEB/app/api/chess/game-by-ref/[gameReferenceId]/route.ts` (108) | Public projection (P1 H4) | Kept for the legacy `/join` page | **Remove** with the legacy `/join` page (its last caller) |
| `WEB/app/api/socket-token/route.ts` | HMAC `{sub, exp}` (`lib/socket-token.ts:16`) | `route()`, claims `{v: 2, sub, iat, exp, env, ent, role, name, kid, e2eRun?}`, `SOCKET_TOKEN_SECRET` (P2 §7.4.2) | **Edit**: add the optional `r` claim (ratings per pool, §7.7) |
| `WEB/app/og/route.tsx` (151) | Generic OG text card | same | **Keep.** Add `WEB/app/og/challenge/[code]/route.tsx` and `WEB/app/og/position/[code]/route.tsx` |

### 3.3 Libraries, hooks and config

| File | Today | P9 action |
|---|---|---|
| `WEB/lib/hooks/useMatchmaking.ts` (242) | `POLL_INTERVAL_MS = 1000` (`:30`), `setInterval` (`:119`), create (`:203`), keeps polling forever on network errors (audit-client) | **Remove** |
| `WEB/lib/services/matchmaking/{index,matchmaking.service,position-selector,types}.ts` (778) | Constants `QUEUE_TIMEOUT_SECONDS = 60`, ±200 / ±400 (`matchmaking.service.ts:13-15`); `FOR UPDATE SKIP LOCKED` (`:136-198`); rating from Chess.com (`:57`, `:518-540`); global `prisma` inside a transaction (`:219-226`, DB-11, fixed by P2); pool by initial time only (`types.ts:70-75`, B19) | **Remove.** Pool classification is P2's `poolOf()` (R20) |
| `WEB/middleware.ts:16-26` | `isProtectedRoute` gates `/play`, `/queue`, `/challenge`, `/join`, `/position` | P1 F4 inverted it into a public allow-list with route classes. **Edit** (in `lib/routes/classes/play.ts` when P1 made route classes data, else one additive edit): public `/join/(.*)`, `/s/(.*)`; exclude `/og/` from the matcher (optimization §4.2); `/play/(.*)` stays member-only |
| `WEB/lib/billing/return-url.ts:10-25` | `RETURN_PATH_PREFIXES` includes `/queue`, `/challenge`, `/join`, `/position` | **Edit:** add `/s/` (with the slash, so `/settings` is not matched) and `/play`; keep `/join`; remove `/queue`, `/challenge` in WP-I once the redirects are live (`/position` is P8's) |
| `WEB/lib/seo.ts:3` | `BASE_URL = "https://www.playchess.tech"` (hard-coded; used by `metadataBase`, robots, sitemaps) | **Keep.** Add `WEB/lib/site-url.ts` `appOrigin()` = `NEXT_PUBLIC_SITE_URL ?? BASE_URL`, so dev links point at the dev deployment |
| `WEB/app/robots.ts:18,20,21` | Disallows `/join/`, `/queue`, `/position/` | **Edit** (`lib/seo/robots-rules/p9.ts` if P1 made it a registry): remove `/join/` (link unfurlers such as Twitterbot obey robots.txt; the pages carry `noindex` headers instead); do not add `/s/` (it is unfurled too and carries `noindex`); add `/play/`; keep the rest |
| `WEB/next.config.js` `redirects()` and `headers()` | — | **Edit** (`config/redirects/p9.mjs` if a registry): 308 `/challenge/new` → `/play?tab=friend`, `/play/queue` → `/play/online`, `/play/friend` → `/play?tab=friend` (query kept); `headers()`: `X-Robots-Tag: noindex` on `/join/:code` and `/s/:code` (api-perf AP-14: a page cannot set response headers) |
| `WEB/lib/api/keys.ts` (P1) | `qk.games.challenge(code)` exists | **Edit** (`lib/api/keys/play.ts` if a registry): add `qk.prefs()`, `qk.shares.detail(code)` (§5.2) |
| `turbo.json` `globalEnv` | 13 names | **Edit:** add `NEXT_PUBLIC_SITE_URL` |

### 3.4 Socket server (`WS/`, protocol v2 from P2 rev 2)

| Area | After P2 | P9 action |
|---|---|---|
| Matchmaking | None on the v2 socket (audit-socket §9); P2 built sessions, rooms and the `user:` room | **Add** `WS/src/queue/*` (§7.3, §8.2) |
| Game creation for quick match | — | **Add** `PKG/db/src/live/createMatchedGame.ts` (one CTE, R22), called from the matchmaker |
| End of game | `finishGame()` in `PKG/db/src/live/finish.ts`: one data-modifying CTE built from named fragments; `game:result.ratings = null` | **Edit:** append the `ratings` fragment and extend the `gp` fragment's SET list (§8.6); fill `game:result.ratings`; update the in-memory rating cache |
| Game state | `GameState.rated`, `header.right` "· unrated", `PlayerView.rating` (displayed rating), no `stakes` | **Edit** (additive fields): `GameState.stakes?`, `PlayerView.provisional?`; real `rated` and "· rated"/"· casual" headers; ratings from the pool |
| Study start for online games | `machine/reduce.ts` T1: `waiting → study` when both sides are online | **Edit:** T1 also requires `now ≥ notBefore`; new timer kind `no_show` at `notBefore + 15 s` (§8.2.6) |
| Session load for challenge games | `loadLiveGame()` reads the game row on the first `game:join` | **Edit:** for `rated` games the same statement joins both players' `player_ratings` rows (no extra round trip) |
| Spectating | `spectate:join { ref }` for members on FRIEND/ONLINE/TOURNAMENT games (P2 §7.4.4) | **No change** (R21) |
| `WS/TournamentManager.ts` | v1 tournament relay | Untouched (P12) |

### 3.5 Schema, tests and perf

| File | Today | P9 action |
|---|---|---|
| `PKG/db/prisma/schema.prisma` (`MatchmakingStatus`, `MatchmakingQueue`; today `WEB/prisma/schema.prisma:319-359`) and `User.matchmakingRequests` | Live (moved into `PKG/db` by P2) | **Keep** in M9. Drop in **C2**, one release later, owner-confirmed (§6.7) |
| `PKG/db/sql/roles.sql` (P2) | `replay_realtime` grants on `games`, `game_players`, … | **Edit** (additive): §6.3 grants |
| `WEB/e2e/specs/quick-match.spec.ts` (75), `play-with-friend.spec.ts` (68) | DB-queue and `create-game` flows | **Replace** with the specs in §12.4 |
| `REPO/perf/k6/src/scenarios/matchmaking.ts`, `quick-match.ts`; `perf/k6/src/lib/metrics.ts` (`matchmakingPollCount`) | HTTP queue stress | **Replace** with `queue-socket.ts` (§12.10); remove the poll metric |

---

## 4. Screens

### 4.0 Layout rules shared by every P9 screen

- **Stage.** Every board screen renders inside P1's `ViewportStage` in **lock** mode (`data-rc-lock`): the document never scrolls. The board sits in `BoardStage` (`[data-rc-board-slot]`, `[data-rc-bar="top"|"bottom"]` for the player bars), and the panel is `[data-rc-aside]` with a `ScrollRegion` inside it. Only the aside's option list scrolls, inside its own panel (DS README "Layout: one viewport", rule 2).
- **Shell modes** come from P1 `expectedShellMode(vw, vh, touch)`: sidebar 220 px (desktop > 1100 px wide), rail 64 px (≤ 1100 px, or touch landscape such as iPad L), tab bar (≤ 600 px wide, or portrait ≤ 900 px: phones and iPad P).
- **Desktop and rail geometry** (from the boards' CSS, `DR/V3PlayHub.dc.html` `.bcol`/`.side`, shared by `V3Queue`, `V3MatchFound`, `V3ChallengeShare`, `V3ChallengeAccept`, `V3PositionShare`): aside 400 px (320 px at ≤ 1100 px wide), gap 20 px, stage padding 16/24 px (8/16 px at ≤ 620 px tall). Board side = `max(220px, min(100vh − 140px, 100vw − 688px, 880px))`. With the rail: `100vw − 452px`. At ≤ 620 px tall: `100vh − 104px`, and the secondary lines (`.short-hide`, `.tall` in the boards) are hidden.
- **Golden board sides** (soft assertions, `toBeCloseTo(x, -1)`; P1 §10.6 style):

| Project | Viewport | Shell | Board (px) |
|---|---|---|---|
| `desktop-1440@80` | 1800 × 1125 | sidebar | 880 (cap) |
| `desktop-1440@100` | 1440 × 900 | sidebar | 752 |
| `desktop-1440@110` | 1309 × 818 | sidebar | 621 |
| `desktop-1440@125` | 1152 × 720 | sidebar | 464 |
| `desktop-1440@150` | 960 × 600 | rail | 496 |
| `desktop-1280@100` | 1280 × 800 | sidebar | 592 |
| `desktop-1280@125` | 1024 × 640 | rail | 500 |
| `desktop-1280@150` | 853 × 533 | rail | 401 |
| `ipad-landscape@100` | 1194 × 834 | rail | 644 (design) |
| `ipad-portrait@100` | 834 × 1194 | tab bar | hub preview 360; queue and match found 560 (design) |
| `iphone@100` | 393 × 852 | tab bar | hub: 96 px thumbnail card, no large board; queue and match found 300 (design) |
| `android@100` | 412 × 915 | tab bar | hub thumbnail 96; queue and match found 330 (design) |
| `iphone-safari@100` | 393 × 659 | tab bar | queue ≥ 240 (computed from the slot) |

- **Phone game-like pages** (queue, match found, accept, share, position share) never show the tab bar together with a bottom action bar (DS README "Phones": either one, never both). Hub pages show the tab bar.
- **Every state of every board is reachable** from real data or from the dev demo routes in §4.10 (allocation §1.1 item 4).

### 4.1 Play hub (`/play`)

**Boards.** Desktop `DR/V3PlayHub.dc.html` (1440 × 900). iPhone `DR/V3iPhonePlayHub.dc.html` (393 × 852). Android `DR/V3AndroidPlayHub.dc.html` (412 × 915). iPad landscape `DR/V3iPadLPlayHub.dc.html` (1194 × 834). iPad portrait `DR/V3iPadPPlayHub.dc.html` (834 × 1194). Enums: `state` ∈ {`default`, `loading`, `search_empty`, `creating`, `error`, `limit`} × `tab` ∈ {`legend`, `bot`, `friend`, `online`} (board default `online`).

**Route.** `WEB/app/(app)/play/page.tsx` (RSC, member-only; `requireMemberPage()`). URL state (all optional, written with `history.replaceState` through `useUrlState`, client-data-layer §6.4):

| Param | Values | Default (in this order: URL → `prefs.play` → constant) |
|---|---|---|
| `tab` | `legend`, `bot`, `friend`, `online` | `prefs.play.lastTab` → `online` |
| `position` | a practice position slug | first practice position (`practiceOrder`) |
| `tc` | `1+0`, `2+1`, `3+0`, `3+2`, `5+0`, `5+3`, `10+0`, `15+10`, `30+0` | `prefs.play.tc` → `5+3` |
| `color` | `white`, `random`, `black` | Legend: the position's hero side; Bot and Friend: `white`; Online: `random` (owner decision D10) |
| `strength` | 400, 800, 1200, 1600, 2000 | `prefs.play.botStrength` → the ladder step nearest the viewer's Blitz rating → 1200 |
| `from` (Friend) | `start`, `legend` | `prefs.play.friendStart` → `start` |
| `rated` (Friend) | `1`, `0` | `prefs.play.friendRated` → `1` |
| `pos` (Online) | `legend`, `start` | `prefs.play.onlinePosition` → `legend`; forced to `start` when `online-legend-pool` is off |
| `opponent` (Friend; R31, coverage C-11) | a username, with or without a leading `@` (`/^@?[A-Za-z0-9_]{3,20}$/`, lower-cased) | none. Implies `tab=friend` when `tab` is absent. Never persisted to prefs |

`URLSearchParams` writes `tc` as `5%2B3`. The parser (`hub-state.ts`, shared with `/play/online`) also maps a space back to `+`, because a hand-typed `?tc=5+3` decodes to `5 3`. Unknown values fall back to the default without an error; an `opponent` value that fails the pattern is dropped silently (it is never echoed).

**Layout per device** (one viewport everywhere):

| Device | Layout |
|---|---|
| Desktop 1440 × 900 | Sidebar 220 · board column (opponent bar "E Engine · plays Brunswick & Isouard's side · 5+3", board, own bar "KO knightowl_88 1184 · 5+3") · aside 400: `h1` "New Game" (serif 2.75rem; 28–36 px per DS rule 3 at ≤ 760 px tall), tablist, the tab's options inside a `ScrollRegion`, then a fixed footer with the CTA (48 px) and the note line. The board updates live from the selection (legend FEN, or the start position for Bot and Friend-from-start). |
| Desktop ≤ 1100 px or zoom ≥ 125 % on 1280 | Rail 64; aside 320; board shrinks by the formula. At ≤ 620 px tall the note under the Online segment (`.short-hide`) and the CTA note (`.tall`) hide. |
| iPad landscape 1194 × 834 | Rail 64 · preview section 684 px (bars 48 px, board 644) · aside with tabs, options and CTA. |
| iPad portrait 834 × 1194 | Top bar 52 (logo, avatar) · preview card: board 360 + "Preview · 5+3", position name (serif 1.625rem), sub-line, rows Opponent / Time Control / Colour · options in a scroll region · CTA bar · bottom tab bar. |
| iPhone 393 × 852, Android 412 × 915 | Top bar 44 (logo, wordmark, avatar) · opponent strip "vs Engine 5+3 / plays …" · scroll region: label "New Game", tablist, options, then the **summary card** (96 px thumbnail, "Starting Position", name, sub-line, "Blitz 5+3 · White") · CTA bar (48 px button) · tab bar 56 (Home, Play, Train, Learn, Review, Profile). There is no large board on phone hubs; the CTA bar and tab bar never scroll. |

**States and transitions**

| State | Entered when | What shows | Leaves when |
|---|---|---|---|
| `loading` | Navigation to `/play` before the RSC streams (`WEB/app/(app)/play/loading.tsx`) | Board slot: the start position from `usePendingBoard` or a static start board; aside: `SkeletonRegion` with blocks of 40, 120 and 84 px (the design's `.sk`); CTA hidden | RSC payload arrives → `default` |
| `default` | Data ready | The selected tab's options and preview | CTA → `creating`; Legend search with no hits → `search_empty` |
| `search_empty` | Legend tab, query ≥ 2 characters matches 0 positions | The list is replaced by "No legends match “{q}”", "Try a player, an event or a year." (plus CAT-5's `meta.hint`, e.g. "Capablanca positions arrive in December.", only when P8 returns one) and **Clear Search**. The board keeps the last selection; the CTA stays enabled for it. | Clear Search, or a query with hits → `default` |
| `creating` | CTA pressed on Bot or Friend (a POST), or on Legend (navigating to P8's `/play/legend/[slug]`) | CTA `Button loading` "Creating game…"; tabs and options `aria-disabled`; for Online the CTA navigates immediately (no POST), so `creating` is not used there | 2xx → navigate; error → `error`; 402 → `limit` |
| `error` | The create request fails: network, timeout (15 s), 5xx, or 404 "position not found" | `Banner tone="bad" live="assertive"` "Failed to create game. Check your connection and try again." For 404: "That position is no longer available." and `router.refresh()` reloads the list. Selections are kept. | Any option change or CTA → `default` / `creating` |
| `limit` | The create request returns 402 (membership ended or lapsed since the page rendered; middleware normally stops lapsed users at the door, inv-play-a C1) | `Banner tone="warn"` with copy by `reason`: `trial_available` → "Start your 7-day free trial to play." + **Start Free Trial**; `trial_used` / `expired` → "Your membership has ended. Your free trial has been used, so renew to play legend positions and get new reviews." + **Renew** (opens P7's `RenewSheet`; price from `WEB/lib/billing/plans.ts`). CTA disabled. | `entitlement:changed` (entitled) → `default` |

**Per-tab content** (copy from the board; `{…}` is data)

| Tab | Options (aside) | Preview (board and bars) | CTA → effect | Note line |
|---|---|---|---|---|
| Legend | `Field` "Legendary Positions" with a search `Input` (leading search icon, placeholder "Search legends…"); `role="listbox"` of practice positions: 40 px `MiniBoard`, "Morphy vs Brunswick & Isouard", "Paris 1858 · White to move", theme `Tag` "Attack". The selected row has a 2 px accent left border and the elevated fill. Then the time-control chips and the colour control. | The selected legend FEN; opponent bar "E Engine · plays {other side}'s side" (it updates when the colour flips) | **Play This Position** → `router.push('/play/legend/{slug}?color=&tc=&from=playhub')` (P8 creates the game idempotently) | "vs Engine at your level · you can also queue online from the Online tab." |
| Bot | "Strength" label + mono value; `Slider` min 400, max 2000, step 400 (ticks 400, 800, 1200, 1600, 2000+); caption (§8.11 list); the values are the calibrated ladder rows (§8.12) | Start position; opponent bar "B {persona name} · “{persona quote}”" | **Play the Bot** → `POST /api/games {mode:'bot', color, botElo: strength, tc}` → `/game/{ref}` | "Unlimited bot games. Unrated, but the coach still reviews them." |
| Friend | "Start From" `Segmented`: Start Position / A Legend Position (uses the Legend selection, shown as a one-line chip "Opera Game, Paris 1858 · Change" that switches to the Legend tab); `SwitchRow` "Rated" (on by default, D1; disabled with "Casual: shared and legend positions are never rated" when the start is not rated-eligible, §8.5); "You get a link and a QR code. The game starts when your friend opens it." With `opponent`: an `OpponentHint` line "Send this link to @martin_k. Anyone with the link can accept." (not designed; kit `Field` hint style) | Start position or the legend FEN; opponent bar "? Your friend · joins from your link", or "? @martin_k · joins from your link" with `opponent` (text only until P10 resolves the avatar and rating) | **Create Challenge Link** → `POST /api/challenges` → `/play/friend/{code}` (`?to=martin_k` appended when `opponent` is set, so the share page can repeat the name) | "Your friend picks up the link; no account needed to view." |
| Online | "Position" `Segmented`: Legend Position / Standard Start; "Both players get the same famous position and a 30 s look before the first move." (`.short-hide`). With `online-legend-pool` off the segment is hidden and the line reads "Everyone starts from the standard position for now." | Legend: the **position of the day** (§8.3); Standard: the start position. Opponent bar "? Opponent · about your rating · {r−100}–{r+100}" | **Find Opponent** → `router.push('/play/online?tc=&pos=&color=')` (prefetched on hover or focus) | "Rated · {Pool} pool · you play {white \| black \| a random colour}" |

All tabs also show the time-control fieldset ("Time Control · {Group}", 9 chips in a 3-column mono `ChipGroup`, grouped Bullet 1+0 2+1 · Blitz 3+0 3+2 5+0 5+3 · Rapid 10+0 15+10 30+0) and the colour `Segmented` (White / Random / Black). The group label follows the selected chip (§8.1).

**"Game in progress" banner** (inv-play-a Q15, not designed): if the viewer has a live human game, a `Banner tone="info"` above the tabs reads "You have a game in progress vs {name}." with **Return to Game** (`/game/{ref}`). Online's CTA is disabled while it shows ("Finish your current game first.").

**Components.** P1 kit: `Tabs variant="segmented"` + `TabsList fit="fill"` (the design's `role=tablist` segmented buttons), `ChipGroup type="single" columns={3}` mono, `Segmented`, `Field`/`Input`/`Slider`, `SwitchRow`, `Banner`, `Button variant="primary" size="lg" block loading`, `Tag`, `Avatar`, `SkeletonRegion`, `ScrollRegion`, `BoardStage`. P2: `Board` (static mode, no input, no chess.js), `MiniBoard`, `PlayerBar` (static preview variant). New in `WEB/features/play/hub/`: `PlayHub.tsx` (client root), `HubTabs.tsx`, `LegendPicker.tsx`, `BotStrength.tsx`, `FriendOptions.tsx`, `OnlineOptions.tsx`, `TimeControlPicker.tsx`, `ColourPicker.tsx`, `HubCta.tsx`, `HubPreview.tsx`, `HubSummaryCard.tsx` (phones), `HubPreviewCard.tsx` (iPad P), `LiveGameBanner.tsx`, `OpponentHint.tsx`, `hub-state.ts` (pure: URL + prefs + flags → selection), `hub-copy.ts`.

**Interactions and keys** (registered in P1's shortcut registry so `?` lists them):

| Key | Action |
|---|---|
| `G P` | Go to the hub (P1 chord) |
| `1` `2` `3` `4` | Legend, Bot, Friend, Online (single-letter keys respect the Settings "single-letter keys" switch and are ignored inside inputs) |
| `←` `→` inside the tablist | Previous / next tab (Radix roving focus) |
| `/` | Focus the legend search (Legend tab) |
| `↑` `↓`, `Home` `End` in the listbox | Move the selection; the preview follows |
| `Esc` in the search | Clear the query |
| `←` `→` on the slider | ±400; `aria-valuetext` "1200, Knows tactics, slips under pressure. Close to your rating." |
| `Enter` (focus not in an input) | The CTA |
| `F` | Flip the preview board |

Touch targets are ≥ 44 px (chips 40 px with the P1 `tap-target` extension on coarse pointers).

**Empty, loading, offline and error.** Loading is above. No practice positions at all (P8 data missing): the Legend tab shows `EmptyState size="card"` "No Legend Positions Yet" + "Browse Legends" (`/legends`), and the Online tab hides the Legend Position option. Offline (`useOnline()`, client-data-layer §7): every CTA is disabled with the note "Needs a connection" (bot play offline is P11's). Search empty and create errors are above.

**Copy notes.** Buttons are Title Case (DS): "Play This Position", "Play the Bot", "Create Challenge Link", "Find Opponent", "Clear Search", "Return to Game". The design's lower-case CTAs ("Play this position") are typeset in Title Case by the kit. No exclamation marks. The strength captions and persona lines are in §8.11. Only the 1200 persona has design copy; the other four are drafted in §8.11 for the owner to approve.

### 4.2 Matchmaking queue and No opponent (`/play/online`)

**Boards.** Desktop `DR/V3Queue.dc.html` (default `searching`) and `DR/V3NoOpponent.dc.html` (default `timeout`); iPhone `DR/V3iPhoneQueue.dc.html`; Android `DR/V3AndroidQueue.dc.html`; iPad L `DR/V3iPadLQueue.dc.html`; iPad P `DR/V3iPadPQueue.dc.html`. Enum: `initializing`, `searching`, `widened`, `cancelling`, `error`, `offline`, `timeout`, `creating`.

**Route.** `WEB/app/(app)/play/online/page.tsx` (RSC, member-only), `?tc=5+3&pos=legend|start&color=white|random|black`. Invalid params → `redirect('/play?tab=online')`. A live game → `redirect('/game/{ref}')`.

**Layout.**

| Device | Layout |
|---|---|
| Desktop | Sidebar · board column: opponent bar "? Opponent · Searching" (pulsing dot) "5:00", the queued position (board pulses while searching, `boardCls: pulse`; no pulse under reduced motion), own bar "KO knightowl_88 1184 · You play White · 5:00" · aside 400: the status card (eyebrow, serif title, rows Time / Position / Rating, note) and the action stack (Cancel Search). |
| iPad L | Rail · board 644 · aside. |
| iPad P | Top bar 52: back arrow (→ `/play`), centred "Blitz 5+3 · rated" · bars 48 · board 560 · card · actions. No tab bar. |
| iPhone / Android | Header 44: back, "Blitz 5+3 · rated" · bars 44 · board 300 / 330 · card in a scroll region · bottom action bar (Cancel Search). No tab bar. |

**States** (the reducer is `WEB/features/play/queue/queue-machine.ts`, unit-tested)

| State | Entered when | UI (copy from the board) | Leaves when |
|---|---|---|---|
| `initializing` | Mount: the socket is connecting or the `queue:join` ack is pending | Eyebrow "Connecting", title "Joining the {Pool} pool…", rows Time "{Pool} {tc} · rated", Position ("Opera Game, Paris 1858" or "Standard start"), Rating (blank); Cancel Search | ack ok → `searching`; ack error, 5 s ack timeout or 10 s without a connection → `error`; offline → `offline` |
| `searching` | `queue:join` ack `ok` | Eyebrow "Searching · 0:07" (elapsed from the ack's `joinedAt`, corrected by `serverNow`; `useNow(250)` drives only this node), title "Finding an Opponent", rows (Rating "1084–1284 · ±100"), note on the legend pool: "Study the position while you wait. You'll get another 30 s once you're matched." Cancel Search | `queue:status {widened}` → `widened`; `queue:matched` → match found (§4.3); `queue:timeout` → `timeout`; Cancel or `Esc` → `cancelling`; offline → `offline`; `queue:moved` → `error` (moved) |
| `widened` | `queue:status {widened: true, range, merged}` (the server sends it once at 20 s) | As searching, plus `Banner tone="info"` "Still looking. We widened the range to ±200 so you get a game sooner." With `merged` (D20 on) the banner adds " Other {Group} time controls can match you now." (a documented copy addition to the board); Rating "984–1384 · ±200"; Time row "{Group} · {tc} or similar" | as `searching` |
| `cancelling` | Cancel Search | Eyebrow "Cancelling…", title "Leaving the Queue", link **Back to Play** | `queue:leave` ack, or 2 s → `router.replace('/play?tab=online&tc=…&pos=…')` |
| `error` | ack `{ok:false}`, ack timeout, `connect_error` for 10 s, `queue:moved`, or three failed game creations in a row | Default: eyebrow "Error", "Couldn't Join Matchmaking", "The game server didn't answer. No game was started." (D13 replaces "Nothing was charged") + **Try Again**. Variants by code: `already_in_game` → "You Have a Game in Progress" + **Return to Game**; `rate_limited` → "You aborted several games. You can queue again in 4:32." (live countdown from `retryAfterMs`; **Try Again** enables at 0); moved → "Searching in Another Tab" + **Search Here Instead** | Try Again / Search Here Instead → `initializing` |
| `offline` | `useOnline()` reports offline (P1/P11 `onlineManager`) | Eyebrow "Offline", "You're Offline", "Matchmaking needs a connection. We'll rejoin the queue when you're back." + **Back to Play**. The board's "Play vs bot offline" CTA is P11's (coverage C-10): `QueueCard` takes an optional `offlineAction: { label, href }` and renders it as the primary button when present; P9 passes nothing, so the button is absent until P11 passes `{ "Play vs Bot Offline", "/play?tab=bot" }` (when `engine:ready` and its Q15 = yes) | Back online → `initializing` with `since` (the timer continues) |
| `timeout` | `queue:timeout {searchedMs}` | Eyebrow "Searched for 1:00", "No Opponent Found", "Nobody near your rating is queuing for {Pool} {tc} right now. Play the same position against the engine, or try again." (after a merged search: "…queuing for {Pool} right now…") **Play Against Bot** (primary), **Try Again**, **Back to Play** | Bot → `creating`; Try Again → `initializing` (new search) |
| `creating` | Play Against Bot | Eyebrow (spinner) "Creating game…", title "Setting Up the Engine" | 201 → `/game/{ref}`; error → `error` ("Couldn't start the bot game." + Try Again) |

The board's prototype-only links ("Opponent joins in ~13 s · skip", "Opponent found · Go to match", "Open the board") are not built; the found moment is §4.3.

**Interactions.** `Esc` = Cancel Search. Back / route change / tab close leave the queue (unmount sends `queue:leave`; a dropped socket is removed after the server's 3 s grace). The status line is `aria-live="polite"` and announces state changes only, never the seconds. The spinner is `aria-hidden`. Cancel Search is the first focusable control.

**Components.** Kit: `Card`, `Overline`, `Banner`, `Button`, `Spinner` (inside buttons and eyebrows only), `BoardStage`. P2: `Board` static + pulse class, `PlayerBar`. New `WEB/features/play/queue/`: `QueueScreen.tsx`, `QueueCard.tsx`, `QueueRows.tsx`, `useQueue.ts`, `queue-machine.ts`, `useCountdown.ts`, `MatchFoundCard.tsx`.

### 4.3 Match found (a state of `/play/online`)

**Boards.** Desktop `DR/V3MatchFound.dc.html`; iPhone `DR/V3iPhoneMatchFound.dc.html`; Android `DR/V3AndroidMatchFound.dc.html`; iPad L `DR/V3iPadLMatchFound.dc.html`; iPad P `DR/V3iPadPMatchFound.dc.html`. Enum: `countdown`, `ready`.

**Layout.** As the queue. The opponent bar slides in (`slidein`, none under reduced motion): "MK martin_k 1212 · Black · joined · 5:00"; own bar "KO knightowl_88 1184 · White · you · 5:00". The aside card: eyebrow "Match Found", serif "vs martin_k" + mono rating "1212", "You play **White** · Blitz 5+3 · rated" (after a merge the preset is the game's, and the player whose preset was not used sees the extra line "Matched on your opponent's time control"), a position block (label "Position", "Morphy vs Brunswick & Isouard", "Paris Opera, 1858 · White to move after 9…b5"; hidden for the standard start), then the countdown block.

**States.**

| State | Entered when | UI | Leaves when |
|---|---|---|---|
| `countdown` | `queue:matched` arrives (`startsAt` = server time + 3 s) | "Study Phase Starts In" + the number 3 → 2 → 1 inside an SVG ring (`stroke-dashoffset` animated; static under reduced motion). Standard start: "Game Starts In". **Go to the Board** (focused). Note "Opens the board by itself a second after the countdown." | `startsAt` reached → `ready`; Go to the Board → navigate now |
| `ready` | Countdown reached 0 | "Starting" + "30 s to study. Clocks start once both sides have moved." (standard start: "White moves first. Clocks start once both sides have moved.") | 1 s later → `router.replace('/game/{ref}')` |

**Data.** The opponent, colour, preset and `startsAt` come from `queue:matched`; the position card, study length and pool come from the `queue:join` ack the client already holds (§7.3). On arrival the client writes `usePendingBoard({ref, fen, orientation})` and calls `router.prefetch('/game/{ref}')`, so the game route paints its board at once. The server does not start the study timer before `startsAt` and waits up to 15 s for both players to join (§8.2.6), so the countdown and the page load never eat study time.

**Edge cases.** The opponent never opens the game: after the 15 s join window the game ends `aborted` ("Opponent didn't join · not rated"). That is P2's `over_aborted` state, with **Find Another Opponent** → `/play/online?{same params}`. The phone back arrow on this screen goes to `/play`; the game then ends as a no-show and counts toward the abort limit (D17). Announced once to screen readers: "Match found. Study phase starts in 3 seconds."

### 4.4 Challenge a friend: share link (`/play/friend/[code]`)

**Boards.** Desktop `DR/V3ChallengeShare.dc.html` only. Enum: `waiting`, `copied`, `expired`, `cancelled`, `error`; plus the board's "Your friend joined · Go to the board" link, built as the `joined` sub-state. No phone or tablet boards; the responsive rules below follow inv-play-a §7.5.

**Route.** `WEB/app/(app)/play/friend/[code]/page.tsx` (RSC, member-only), optional `?to=<username>` (the hub's `opponent` hint, validated with the same pattern). Not the creator → `redirect('/join/{code}')`. Already accepted → `redirect('/game/{gameRef}')`.

**Layout.**

| Device | Layout |
|---|---|
| Desktop, iPad L | Sidebar or rail · board column: dimmed board (the start or legend FEN, `opacity: .55`), opponent bar "? Your friend · Not joined yet · 5:00", own bar "KO knightowl_88 1184 · White · you · 5:00" · aside: eyebrow "Friend game · Blitz 5+3 · from the start" (or "from the Opera Game"; with `?to=`: "… · for @martin_k"), serif "Challenge a Friend", `Field` "Your Link" (read-only input with the full URL) + **Copy Link**, QR (160 px) + "Scan to join on a phone.", **Share…**, the waiting line "Waiting for your friend · 0:42" + "The board opens for both of you when they join.", text button **Cancel Challenge**. |
| iPad P, phones | Header (back → `/play?tab=friend`, "Friend game · {tc}"), the dimmed board `min(100vw − 32px, 38vh)`, then the card: link field + Copy, **Share…** (the main action on phones), waiting line, Cancel. QR hidden at ≤ 600 px wide (you can't scan your own phone). No tab bar. |

**States.**

| State | Entered when | UI | Leaves when |
|---|---|---|---|
| `waiting` | Status `open` and `now < expiresAt` | As above; elapsed counter from `createdAt` (`useNow(1000)`) | Copy → `copied`; `challenge:accepted` → `joined`; `expiresAt` passes (client timer) → `expired`; Cancel → `cancelled`; `challenge:declined` → toast, stays `waiting` (D3) |
| `copied` | Copy Link succeeded (`navigator.clipboard.writeText`; fallback: select the field and show "Press ⌘C to copy") | Button reads "Copied"; inline "Link copied. Send it in any chat."; polite live region | 2 s → `waiting` |
| `joined` | `challenge:accepted {code, gameRef}` on the user room, or a refetch that finds `accepted` | "Your friend joined" + **Go to the Board**; navigates by itself after 1 s | → `/game/{gameRef}` |
| `expired` | `expiresAt` passed, or the server says `expired` | Eyebrow "Link expired", "Challenge links last 24 hours. Nobody used this one." + **Create a New Link** | New link → `POST /api/challenges` with the same options → `router.replace('/play/friend/{new}')`; failure → `error` |
| `cancelled` | Cancel Challenge (no confirmation: cheap to recreate), or the server says `cancelled` (including the auto-cancel of the 6th open link, §8.9) | Eyebrow "Cancelled", "The link no longer works. Your friend will see “This game is no longer available”." + **New Link**, **Back to Play** | New link as above |
| `error` | Create a New Link / New Link failed | Eyebrow "Error", "Couldn't create the challenge. Nothing was sent." + **Try Again** | Retry |

**Components.** Kit: `Field` + `Input readOnly`, `Button` (Copy: `variant="secondary"`, pressed → "Copied"), `Card`, `Banner`. New `WEB/features/play/challenge/`: `ChallengeShareScreen.tsx`, `CopyLinkField.tsx`, `QrCode.tsx` (SVG from `uqr`, dynamically imported; `role="img"` with the URL as its label), `ShareButton.tsx` (Web Share API; hidden when `navigator.share` is missing; text "{name} challenges you to a {tc} game on ReplayChess"), `useChallengeWatch.ts`, `challenge-copy.ts`.

**Keys.** `C` copies the link (single-letter rule applies); `Esc` does nothing here (no popover).

### 4.5 Challenge accept, signed in (`/join/[code]`)

**Boards.** Desktop `DR/V3ChallengeAccept.dc.html` (default `default`). Enum: `default`, `loading`, `joining`, `unavailable`, `already_started`, `own_link`, `paywalled`, `logged_out`. Phones and tablets: no boards; they use the stacked layout from §4.7.

**Route.** `WEB/app/(shared)/join/[code]/page.tsx`. The `(shared)` route group has its own `layout.tsx`: signed-in visitors get the app shell without the member gate; signed-out visitors get the marketing header (`WEB/app/components/Navbar.tsx` until P11 ships `MarketingTopNav`). The page is public in middleware. `generateMetadata`: title "{name} challenges you · ReplayChess", description "{Pool} {tc} from {position or "the start"}. You play {colour}.", `openGraph.images` `/og/challenge/{code}` (absolute, from `appOrigin()`), `robots: {index: false}`; the `X-Robots-Tag: noindex` header comes from `next.config.js` (§7.6).

**Layout (desktop).** App shell · board column: board from `startFen` (orientation = the invitee's colour; for random, White at the bottom), creator bar "MK martin_k 1212 · Black · waiting for you · 5:00", own bar "KO knightowl_88 1184 · White · 5:00" · aside: eyebrow "Challenge · Blitz 5+3 · rated" (or "· casual"), `h1` (serif) "martin_k challenges you", body "From the Opera Game position, Paris 1858. You play White. 30 s to study before the first move." (standard start: "From the standard start. You play White."), key-value rows **From** (avatar, name, rating), **Time** "5 min + 3 s per move", **Colour** "You play White" (random: "Random, decided when you accept"), then the actions.

**States.**

| State | Decided by | UI | Exits |
|---|---|---|---|
| `loading` | `loading.tsx` while the RSC streams | Board from the cached FEN if known, else a start-position skeleton; card `SkeletonRegion` | → server-decided state |
| `default` | Member, not the creator, challenge `open` and unexpired | **Accept Challenge** (primary), **Decline** (secondary). Focus moves to Accept only when the page was opened from a link (`document.referrer` is not this site) | Accept → `joining`; Decline → `POST …/decline` → `/play` + toast "Challenge declined." |
| `joining` | Accept pressed | Primary disabled, "Joining…" | 200 → `router.replace('/game/{gameRef}')`; 409 / 410 → `router.refresh()` (the server re-decides the state); 402 → `paywalled`; 409 `already_in_game` → banner "Finish your current game first." + **Return to Game** |
| `unavailable` | Unknown code, `cancelled`, `declined` (if D3 closes), `expired`, or the creator is no longer a member (public status `unavailable`; the reason is never shown) | Eyebrow "Unavailable", "This Game Doesn't Exist", "It may have been cancelled, or the link is mistyped." + **Find Another Game** (`/play?tab=online`) | — |
| `already_started` | Status `accepted` by someone else | Eyebrow "Already started", "Someone Else Joined First", "martin_k's challenge is being played. You can watch it." + **Watch the Game** (`/game/{ref}`, opened as a spectator through P2's `spectate:join`, R21) and **Play Someone Else** (`/play?tab=online`). If the viewer is one of the two players → server redirect to `/game/{ref}` | — |
| `own_link` | The viewer created it | Eyebrow "Your own link", "Share This Link With a Friend", "You created this challenge. It opens for whoever you send it to." + **Back to the Link** (`/play/friend/{code}`) | — |
| `paywalled` | Signed in, not entitled (C2: under the paid-only model there is no free start-position game, so the design's "Ask for a game from the start instead" is dropped) | Never trialled (`trial_available`): "Start your 7-day free trial to accept martin_k's challenge." + **Start Free Trial** (→ `/pricing?reason=required&redirect_url=/join/{code}`, or `/onboarding?redirect_url=…` when not onboarded). Trial used or ended: "Your membership has ended. Renew to play martin_k." + **Renew · {price}** (`RenewSheet`; the price comes from `plans.ts`, so legacy $8 members see their own price) | After the trial or renewal the return lands here in `default` |
| `logged_out` | No session | §4.6 | — |

### 4.6 Challenge accept, signed out (`/join/[code]`, no session)

**Board.** `DR/V3ChallengeAcceptGuest.dc.html` (default `logged_out`; same enum as §4.5).

**Layout.** Marketing header (ReplayChess · Coaching · Learn · Blog · Pricing · **Sign In** · **Start Free Trial**), then the same board column and card as §4.5. The own bar reads "KO You · White · 5:00" with a neutral avatar.

**`logged_out` UI.** **Sign In to Accept martin_k's Challenge** (primary) → `/sign-in?redirect_url=/join/{code}`; **New Here? Start a 7-Day Free Trial** (secondary) → `/sign-up?redirect_url=/join/{code}&source=challenge`; note "You'll come straight back to this challenge." The return path: sign-up → onboarding (P4 keeps `redirect_url` in `sessionStorage['rc_onb_next']`) → plan step → Dodo trial checkout → `/checkout/activating` (P4) → Done forwards to `redirect_url` → this page in `default`. **The page never accepts automatically on return**: the challenge may have been taken meanwhile, and the invitee confirms.

Guest variants: `unavailable` links **Find Another Game** to `/` (the landing page); `already_started` hides **Watch the Game** (members only) and shows **Sign In** instead.

**Data shown to guests**: creator display name, initials, avatar, rating, time control, colour and position. Never an email or a database id. Link unfurlers (WhatsApp, iMessage, Slack, Twitterbot) receive the same HTML with OG tags; they do not run JavaScript, so they never trigger analytics.

### 4.7 Shared position (`/s/[code]`)

**Board.** Desktop `DR/V3PositionShare.dc.html`. Enum: `default`, `loading`, `not_found`, `creating`, `paywalled`. Variants that P9 adds (inv-play-b F10): signed out, owner, never subscribed.

**Route.** `WEB/app/(shared)/s/[code]/page.tsx` (public; `noindex` in metadata and as a header from `next.config.js`; OG image `/og/position/{code}?v={imageVersion}`, purged on revoke), `not-found.tsx` (HTTP 404). Codes are lower case (P3's share format); the page normalises upper-case input.

**Layout.**

| Device | Layout |
|---|---|
| Desktop, iPad L | Shell or marketing header · board column: board from the share's FEN (orientation: side to move), top bar "? Opponent · Friend or engine · 5:00", bottom bar the viewer "KO knightowl_88 1184 · White · 5:00" (signed out: "You") · aside: eyebrow "Shared position · from lucena_now", serif title "Kasparov vs Topalov, 1999", tags (White to move · After 23…Qd6 · Sacrifice), the note as a `blockquote` "“Find what Kasparov played here. I couldn't.”" with "Play it out from this exact position against a friend or the engine.", actions |
| iPad P, phones | Header (back), full-width board `min(100vw − 32px, 52vh)`, bars 44, card (title, tags, note), actions pinned in a bottom bar. No tab bar. |

**States.**

| State | Decided by | UI | Exits |
|---|---|---|---|
| `loading` | `loading.tsx` | Board skeleton from the FEN when known; card skeleton | → state |
| `default` | Member | **Challenge a Friend** (primary), **Play vs Bot** (secondary) | Friend → `creating` → `POST /api/challenges {startFrom:'shared', sharedCode}` → `/play/friend/{code}`; Bot → `creating` → `POST /api/games {mode, sharedCode, botElo, tc: 5+0}` → `/game/{ref}` |
| `creating` | A CTA is pending | That button `loading` "Creating game…", the other disabled | 2xx → navigate; error → inline `Banner tone="bad"` "Couldn't create the game. Try again." |
| `not_found` | Unknown or revoked code | Start position, dimmed and `aria-hidden`; eyebrow "Not found", "This Position Isn't Available", "The link may be old, or the person who shared it removed it." + **Browse Legend Positions** (`/legends/positions`). HTTP 404. The FEN of a revoked share is never shown. | — |
| `paywalled` | Signed in, not entitled | Trial used or ended: eyebrow "Membership ended", "Your free trial has been used. Renew to play this position against a friend or the engine." + **Renew · {price}**. Never trialled: "Start your 7-day free trial to play this position." + **Start Free Trial**. **Play vs Bot is hidden** (C3) | Trial or renew returns here |
| signed out (variant of `default`) | No session | **Start 7-Day Free Trial** (primary → `/sign-up?redirect_url=/s/{code}&source=share`), **Sign In** (secondary) | — |
| owner (variant) | The viewer owns the share | Eyebrow "Shared by you", plus **Copy Link** and text button **Stop Sharing** (optimistic → `not_found` with toast "Link stopped working.") | — |

**Edge cases.** The sharer deleted their account → "Shared position · from a Replay Chess player" (`ownerId` is `SetNull`, D17). A share whose `showUsername` is false → the same anonymous line. A share from a catalogue position without a note → the quote block is hidden.

### 4.8 Share-position dialog (not designed; built from the kit)

**Entry points** (P9 lights them up, §4.9): Review key moment ⋯ (P3), legend compare and practice ⋯ (P8), legend position detail ⋯ (P8).

**UI.** Desktop: `Dialog size="sm" title="Share This Position"`. Phones and iPad P: `Sheet height="auto"`. Content: a 96 px `MiniBoard` + title and subtitle preview (§8.10), `Field` "Note (optional)" `Textarea` with a 140-character counter and the hint "Links and contact details are removed.", **Create Link** (primary). After success the body swaps to the link field + **Copy Link** + **Share…** + "Anyone with the link can see this position. You can stop sharing it at any time.". Errors inline: 409 `live_game` → "You can share this position after the game ends."; 429 → `RateLimitedInline`.

### 4.9 Slots P9 lights up in earlier phases' screens, and handoffs to later phases

| Screen (owning phase) | Slot | Data | Change made in P9 |
|---|---|---|---|
| Game over `over_*` card (P2 `V3Game`, handoff H-07) | Rating line "Blitz 1184 → 1192 (+8)" (`r.rating`, `r.ratingOn`) | `game:result.ratings[you]` | Fill the payload; render the line in P2's `rating` slot (P2 left it dark) |
| Resign confirm (P2) | "martin_k wins and you lose about 8 rating points. The coach will still review it." | `GameState.stakes.loss` | Fill `stakes` for rated games; casual games read "This game isn't rated. The coach will still review it." |
| Game header (P2) | "Blitz 5+3 · rated" / "· casual" | `GameState.rated`, `header.right` | Real value instead of P2's "· unrated" |
| Player bars (P2) | Rating, "1184?" while provisional | `PlayerView.rating`, `provisional` | Filled from `player_ratings` |
| Bot chip tooltip (P2 §8.13, handoff H-06) | "≈1400 · strength not yet calibrated" | `CALIBRATED` export of `bot/strength.ts` | Removed once WP-J ships the calibrated ladder (§8.12) |
| Game over **New Game** / "Find match again" (P2, flow map) | Link target | ONLINE → `/play/online?{same tc,pos}`; others → `/play?tab={same}` | Link change |
| Games archive rows (P3, `V3GamesArchive`) | "+8" next to the result | `game_players.ratingDelta` | Written at finish; nothing else to change |
| Home header (P5, `V3Home`) | "Blitz 1184" | `viewer.ratings`: the pool with the most rated games (ties → Blitz); provisional → "1184?"; no row → hidden | `HomeData.stats.ratingLabel.headline` filled in `getHomeData()` from the viewer (0 statements) |
| Home "This week" (P5) | "Blitz 1176 → 1184 since Monday" | `ratingBefore` of the first rated row of the headline pool this local week, and the current rating | Two columns added to P5's existing (h3) "this week" read (0 extra statements, R27) |
| Home CTAs (P5) | Quick match, Play a friend, Play a bot | `/play?tab=online`, `/play?tab=friend`, `/play?tab=bot` | Link targets |
| Shell rating (P1 `shell-rating`) | Rating chip | `viewer.ratings` headline | Source switches from the Chess.com rating to ours |
| Review key moment ⋯ (P3), legend compare / practice ⋯ and position detail ⋯ (P8) | "Share Position" | SP-1 | Menu item + §4.8 dialog |
| Legend detail ⋯ (P8, inv-pub Q15) | "Challenge a Friend From Here" | — | → `/play?tab=friend&from=legend&position={slug}` |
| **Handoff to P10** (coverage C-11): `V4ProfileOther` "Challenge", `V4ProfilePrivate` "Challenge martin_k" | Button target | — | P10 links to `/play?tab=friend&opponent=<username>` (or keeps `/play/friend?opponent=@<username>`, which 308s there). P10 may add the avatar/rating lookup for the hint (`users.usernameKey`) to its lights-up list |
| **Handoff to P11** (R28): sign-in / sign-up aside, pricing banner | "You'll return to · Accept martin_k's challenge" + board | `challengeTarget(code)`, `shareTarget(code)` from `WEB/lib/data/return-targets/play.ts` | Registered in `resolveReturnTarget()` (`lib/navigation/return-to.ts`): by WP-F if the file exists when P9 starts, else by P11. They use P11's kinds (P11 D23): `challengeTarget` → `kind: "challenge"` with the start FEN for an open challenge; `shareTarget` → `kind: "legend_position"` with the FEN when the live share came from a catalogue position, else `kind: "page"` ("Play a shared position", no FEN). Unknown, closed or revoked codes → `kind: "page"`, no FEN (api-perf AP-29). They read the tagged loaders (`challenge:<code>`, `share:<code>`), so the cached `GET /api/return-target` response must carry the same `Vercel-Cache-Tag` to be purged on revoke |
| **Handoff to P11** (coverage C-10): `V3Queue offline` | "Play vs bot offline" | `QueueCard` `offlineAction` prop | P11 passes `{ label: "Play vs Bot Offline", href: "/play?tab=bot" }` when `engine:ready` and its Q15 = yes (P11 §2.4) |
| **Handoff to P11** (B26 read-only, only if approved): `V3PaywallSoft` `limit_reached` | ended-membership row on the hub | `viewer.membership` | the hub's `PlayHub` takes an optional `notice` slot above the tabs; P11 renders its row there and every CTA opens `RenewSheet`. Under the B26 default (hard redirect) nothing renders |

### 4.10 Dev demo routes (every state reachable)

`WEB/app/dev/ui/play/[screen]/page.tsx`, guarded by P1's `isNonProd()` (dev and test) and listed in `WEB/lib/test-hooks/registry.ts`, so `prod-guard.spec.ts` proves the 404 in a production build. Each renders the real screen component with fixture props, inside the real shell. Specs that reach a state only here tag it `@demo:<Board>.<state>` with a reason (testing X8):

| Route | Params |
|---|---|
| `/dev/ui/play/hub` | `tab=legend\|bot\|friend\|online`, `state=default\|loading\|search_empty\|creating\|error\|limit`, `reason=trial_available\|trial_used`, `live=1`, `opponent=<name>`, `legendPool=0`, `offline=1`, `stress=1` |
| `/dev/ui/play/queue` | `state=initializing\|searching\|widened\|cancelling\|error\|offline\|timeout\|creating`, `variant=in_game\|rate_limited\|moved`, `pos=legend\|start`, `merged=1` |
| `/dev/ui/play/match` | `state=countdown\|ready`, `pos=legend\|start`, `merged=1` |
| `/dev/ui/play/challenge` | `state=waiting\|copied\|joined\|expired\|cancelled\|error`, `to=<name>` |
| `/dev/ui/play/accept` | `state=default\|loading\|joining\|unavailable\|already_started\|own_link\|paywalled\|logged_out`, `guest=1`, `reason=…` |
| `/dev/ui/play/share` | `state=default\|loading\|not_found\|creating\|paywalled`, `variant=member\|guest\|owner\|anonymous` |

---

## 5. UI ↔ API data flow

### 5.1 Rules inherited from client-data-layer.md and allocation §5.4

First paint comes from RSC calling the server-only DAL (`WEB/lib/data/*.ts`, `import "server-only"`). No page fetches its own API on load. Client reads use TanStack Query with keys from P1's key factory (`WEB/lib/api/keys.ts` or its `keys/` directory). Every mutation goes through `api()` + `useMutation`, with paths from the endpoint registry and response schemas wrapped in `devSchema()`. Live changes come over the one socket per tab (`WEB/lib/realtime/connection.ts`); HTTP only serves snapshots. P9 adds **no polling at all**: the challenge share page recovers missed events through refetch on focus and after a reported reconnect gap, not through a poller (client-data-layer D10 allows polling only for activation, analysis, import and weakness).

### 5.2 Query keys and query options added (`WEB/lib/api/keys/play.ts` or `keys.ts`, `WEB/features/play/api/*.ts`)

```ts
// keys (additions; one file in P1's keys/ directory, or one additive edit to keys.ts)
prefs: () => ["prefs"] as const,                                   // GET /api/me/preferences
shares: { detail: (code: string) => ["shares", code] as const },   // GET /api/shared-positions/:code
// existing: games.challenge(code) → ["games", "challenge", code]  // GET /api/challenges/:code (client-data-layer §3.3)
// existing (P8): catalog.positions({collection, q})                // CAT-5

// features/play/api/challenges.ts
export const challengeQuery = (code: string) => queryOptions({
  queryKey: qk.games.challenge(code),
  queryFn: ({ signal }) => api(endpoints.challenge(code), { schema: devSchema(ChallengePublic), signal }),
  staleTime: 10_000,                // matches the 10 s CDN window
  refetchOnWindowFocus: true,       // the creator returns to the tab after the friend joined
});
// features/play/api/shares.ts
export const shareQuery = (code: string) => queryOptions({
  queryKey: qk.shares.detail(code),
  queryFn: ({ signal }) => api(endpoints.share(code), { schema: devSchema(SharePublic), signal }),
  staleTime: 5 * 60_000, refetchOnWindowFocus: false,
});
// features/play/api/prefs.ts
export const prefsQuery = () => queryOptions({
  queryKey: qk.prefs(),
  queryFn: ({ signal }) => api(endpoints.prefs, { schema: devSchema(PrefsData), signal }),
  staleTime: 5 * 60_000,
});
```

`devSchema()` (P1, api-perf AP-12) returns `undefined` in production builds, so the zod schemas never reach the production client bundle; responses are parsed in dev and test only. Paths come from the endpoint registry (`endpoints.*`), never string literals.

The live game, the queue state and clocks are **not** in the query cache (client-data-layer §3.4): the queue lives in `useQueue`'s reducer.

### 5.3 Per-screen flow

| Screen | First paint (RSC → DAL) | Client queries | Mutations | Socket | Prefetch |
|---|---|---|---|---|---|
| Hub `/play` | `requireMemberPage()` → `Promise.all([positionsVolume()` (P8; `unstable_cache`, tag `positions`; ≤ 50 `PositionCard`s; items flagged `upcoming` are left out of the picker and only feed the search hint), `getLiveGameFor(viewer)` (`games_open_idx`), `getPlayPrefs(viewer)` (`user_settings` PK, zod defaults when no row)`])`; `positionOfTheDay(now)` is a pure function (0 DB); ratings come from `viewer.ratings` (already in the viewer read); flags `online-legend-pool` from P1's server flags (0 DB). Props: `HubInitial` (≤ 25 kB gzip with the RSC payload). | **None on mount.** Legend search filters the shipped list in memory (accent-insensitive, `Intl.Collator`). Only when the loader reports more rows (`meta.nextCursor` not null) does it switch to `useQuery(qk.catalog.positions({collection: "legend-practice", q}))` → CAT-5 (`enabled: q.length ≥ 2`, 200 ms debounce, `placeholderData: keepPreviousData`, `staleTime` 5 min; CDN-cached per URL by P8) | Bot: P2's `useCreateGame()` → `POST /api/games` with an `Idempotency-Key` kept in `sessionStorage['rc:idem:bot:<hash(options)>']` (try/catch), cleared on success. Friend: `useCreateChallenge()` (same key pattern). Legend: navigation only (P8 creates). Online: navigation only. Prefs: `usePrefs.set('play.*')` → 500 ms debounced `PATCH /api/me/preferences` (mutation scope `prefs`) | None. The shell's `UserChannel` hold keeps the user room for toasts | Online CTA `pointerenter`/`focus` → `router.prefetch('/play/online?…')`. Legend CTA intent → prefetch `/play/legend/{slug}`. Bot tab visible → P2's `prefetchEngine()` |
| Queue `/play/online` | `requireMemberPage()` → zod-parse `tc,pos,color` → `getLiveGameFor(viewer)` (redirect if live) → preview (`positionOfTheDay(now)` or the start FEN) and the viewer's pool rating. The board and bars paint before the socket connects | None | Bot fallback: `useCreateGame()` → `POST /api/games {mode: pos==='legend' ? 'legend_bot' : 'bot', positionSlug?, color, botElo: nearestLadderStep(rating), tc}` | `useQueue()` acquires the `"queue"` hold (critical: never disconnected while hidden) and registers `realtime.room(queueSub(poolKey), join, leave)` (`queueSub` from `PKG/contracts/src/socket/queue.ts`; it names a client re-subscription, not a server room), so a reconnect re-sends `queue:join {…, since}`. Listens to `queue:status`, `queue:matched`, `queue:timeout`, `queue:moved`, `server:restarting` | `queue:matched` → `usePendingBoard.set({ref, fen, orientation})` + `router.prefetch('/game/'+ref)` |
| Match found | — (from the event and the join ack) | None | None | — | as above |
| Share `/play/friend/[code]` | `requireMemberPage()` → `getChallengeForCreator(viewer, code)` (by `challenges_code_key`, then a creator check; not cached) → redirects (not creator, accepted) → `HydrationBoundary` seeds `qk.games.challenge(code)` | `challengeQuery(code)` (stale 10 s, refetch on focus) | `useCancelChallenge(code)` → `DELETE /api/challenges/{code}`; `useCreateChallenge()` for New Link | `useChallengeWatch(code)` holds `"user"`, listens to `challenge:accepted` / `challenge:declined` filtered by `code`; after a reconnect it invalidates `qk.games.challenge(code)` only when P2's resync rule reports a gap (`bootId` changed or a `useq` gap, api-perf AP-25), else after any disconnect longer than 5 s | `challenge:accepted` → `router.prefetch('/game/'+gameRef)` |
| Accept `/join/[code]` | `getViewerOrNull()` (Clerk `auth()` verifies the cookie; the DB viewer read only when signed in) + `getChallengePublic(code)` (`unstable_cache(['challenge', code], {revalidate: 10, tags: ['challenge:'+code]})`, one round trip with joins). The state (§4.5) is decided on the server, outside the cache. `generateMetadata` reuses the same loader through React `cache()` | None (state is server-rendered) | `useAcceptChallenge(code)` → `POST …/accept`; `useDeclineChallenge(code)` → `POST …/decline` | None | `router.prefetch('/game/'+ref)` after the 200 |
| Shared `/s/[code]` | `getViewerOrNull()` + `getSharePublic(code)` (`unstable_cache(['share', code], {revalidate: 86400, tags: ['share:'+code]})`) → `notFound()` when missing or revoked; else the state | None | `useCreateChallenge({startFrom:'shared', sharedCode})`, `useCreateGame({mode, sharedCode, botElo, tc})`, `useRevokeShare(code)` (optimistic) | None | — |
| Share dialog (§4.8) | — | — | `useCreatePositionShare()` → `POST /api/shared-positions` (Idempotency-Key created when the dialog opens) | — | — |

### 5.4 Mutations: optimistic rules, responses and invalidation

| Mutation | Optimistic | On success (set) | Invalidate / stale | Cross-tab | Notes |
|---|---|---|---|---|---|
| `POST /api/challenges` | No (creates a server id the next screen needs) | `setQueryData(qk.games.challenge(code), data.challenge)` then `router.push('/play/friend/'+code)` | — | — | Idempotency-Key required |
| `POST /api/challenges/{code}/accept` | No (another party, capacity) | `router.replace('/game/'+gameRef)` | stale `qk.games.challenge(code)`, `qk.home()` | — | Natural idempotency (§7.5) |
| `POST …/decline` | No | toast "Challenge declined." → `/play` | — | — | |
| `DELETE /api/challenges/{code}` | No (could race an accept) | `setQueryData(…, {status:'cancelled'})` | — | — | 409 `already_started` → navigate to the game |
| `POST /api/shared-positions` | No | dialog shows the link | — | — | |
| `DELETE /api/shared-positions/{code}` | **Yes** (owner view → `not_found` at once) | — | — | — | Rollback on error with toast "Couldn't stop sharing. Try again." |
| `PATCH /api/me/preferences` | **Local-first** (`usePrefs`) | `setQueryData(qk.prefs(), data)` | — | Sibling tabs on the same device get the new prefs and version over `BroadcastChannel('rc-prefs')` before the socket event arrives; `prefs:updated {version}` from the server makes a tab refetch **only** when its local version is lower (api-perf AP-24), so the PATCHing device never refetches | Failure keeps the local value; the hub shows nothing (prefs are a convenience) |
| `POST /api/games` (bot from hub, queue or share) | No | `usePendingBoard.set(...)` → `router.push('/game/'+ref)` | — | — | P2's mutation |

### 5.5 Socket holds and user-room effects

| Event | Who listens | Effect |
|---|---|---|
| `queue:status` | `useQueue` | `searching` → `widened` |
| `queue:matched` | `useQueue` (the tab that joined); `UserChannel` in every other tab of that user | Queue tab: match found. Other tabs: toast "Match found in another tab" with **Open Game** |
| `queue:timeout`, `queue:moved` | `useQueue` | `timeout`; `error` (moved) |
| `challenge:accepted {code, gameRef, by}` | `useChallengeWatch(code)` on the share page; `UserChannel` everywhere else | Share page: `joined` → navigate in 1 s. Elsewhere: toast "{by.displayName} accepted your challenge" with **Go to the Board** (`/game/{gameRef}`); stale `qk.games.challenge(code)` |
| `challenge:declined {code, by}` | same | Share page: toast "{by.displayName} declined. The link still works for someone else." |
| `server:restarting` | `useQueue` | `searching` keeps its UI with "Server update · rejoining in a few seconds"; the reconnect re-joins with `since` |
| `entitlement:changed` | P1/P4 handlers | `setQueryData(qk.me())` from the payload in every tab; hub `limit` → `default`; the accept and shared-position pages call `router.refresh()` **only in the visible tab and only when the viewer's gate changes** (member ↔ not), and hidden tabs refresh on `visibilitychange` if a change happened meanwhile (api-perf AP-39) |

### 5.6 Error handling per status

| Status / code | Hub | Queue | Share page | Accept | Shared position |
|---|---|---|---|---|---|
| 401 `unauthorized` | `SessionExpiredModal` (P1), then retry once (idempotent) | socket `unauthorized` → token refresh (connection manager) | modal | modal | modal |
| 402 `subscription_required` | `limit` (mutation `meta: {paywall: 'inline'}`) | ack `not_member` → `router.replace('/pricing?reason=…&redirect_url=/play/online?…')` | modal-free redirect to `/pricing` | `paywalled` (refresh) | `paywalled` (refresh) |
| 404 `not_found` | `error` (position gone) + refresh | — | page 404 | `unavailable` | `not_found` |
| 409 `conflict` (`details.reason` from `CONFLICT_REASONS`) | — | — | `already_started` → go to the game | `router.refresh()` → `already_started` / `own_link`; `already_in_game` → banner | 409 `live_game` (dialog) |
| 410 `gone` (`details.reason` from `GONE_REASONS`) | — | — | `expired` / `cancelled` | `unavailable` | `not_found` |
| 422 `illegal_position` | `error` | — | — | — | dialog error "This position can't be shared." |
| 429 `rate_limited` | `RateLimitedInline` countdown under the CTA; the daily challenge cap (`details.window: "day"`) reads "You've created a lot of links today. Try again tomorrow." | ack `rate_limited` → `error` variant with the countdown | inline countdown | inline countdown | dialog countdown; the daily share cap reads "You've shared 20 positions today. Try again tomorrow." |
| 5xx / network / 15 s timeout | `error` banner (retry twice only for idempotent requests) | `error` | `error` | inline `Banner bad` "Couldn't accept. Try again." | inline banner |

### 5.7 Sequences

**Quick match** (both members on `/play/online`):

```
A browser          socket (OCI)                               Neon                     B browser
 queue:join ─────► validate token ent, live game, rate limit
                   (ratings from RatingCache / token r claim: 0 DB)
            ◄───── ack {joinedAt, range ±100, preview, widenAt, timeoutAt}
                   (bucket blitz:legend:<slug>: [A])                                   ◄── queue:join
                   ack ─────────────────────────────────────────────────────────────────►
                   join or tick → pair (A, B) within ±100, same preset
                   createMatchedGame() ───────────────────► 1 statement (CTE: games + 2 game_players)
                                              ◄─────────── {gameId, rated}
 queue:matched ◄── emit to ROOM.user(A) and ROOM.user(B) (startsAt = now + 3 s) ───────► queue:matched
 prefetch /game/ref                                                                       prefetch
 countdown 3-2-1 → navigate /game/ref → game:join ──► both joined, now ≥ startsAt → game:phase {study}
```

**Signed-out accept**:

```
guest → GET /join/CODE (RSC, data cache hit, 0 DB) → logged_out
      → /sign-up?redirect_url=/join/CODE → Clerk → /onboarding?redirect_url=… (P4 keeps rc_onb_next)
      → plan step → POST /api/checkout {returnPath:/join/CODE} → Dodo (test card) → /checkout/activating
      → entitlement:changed → Done → /join/CODE (default) → POST /api/challenges/CODE/accept
      → 200 {gameRef} → /game/ref ;  after(): internalFetch(WS/internal/emit, challenge:accepted → user:creator)
creator share page ← challenge:accepted → "Your friend joined" → /game/ref
```

**Rated finish** (P2's single-statement finish plus P9's fragment):

```
socket: game ends → emit game:ended (immediately, P2) → finishGame() = one CTE, one round trip:
   g   UPDATE games … WHERE status='IN_PROGRESS'            (0 rows → already finished: idempotent)
   gp  UPDATE game_players … result, endedAt, "ratingAfter", "ratingDelta"   ← P9 extends gp's SET list
   pr  INSERT INTO player_ratings … SELECT … FROM g … ON CONFLICT DO UPDATE … WHERE games = EXCLUDED.games − 1
                                                            ← P9 fragment (2 rows expected)
   us, tp, jobs …                                           (P2, P3 fragments)
 → pr returned 2 rows: emit game:result {ratings: {w:{pool,before,after,delta,provisional}, b:{…}}}
   pr returned < 2 rows (concurrent change): repairRatings() in its own transaction, then emit (§8.6)
 → RatingCache.update(white, black)                         (the next queue:join pairs with the new rating)
```

---

## 6. Data model

### 6.1 What M9 changes

| Object | Change | Shape from |
|---|---|---|
| enum `ChallengeStatus` | new: OPEN, ACCEPTED, DECLINED, CANCELLED, EXPIRED | data-model §4 |
| enum `ChallengeStart` | new: START, LEGEND, SHARED | data-model §4 |
| `challenges` | new table | data-model §5.3 `Challenge` |
| `player_ratings` | new table (owner decision O3 = yes, D1), plus two nullable recompute-anchor columns `seedRating`, `seedRd` (feasibility §9, R3) | data-model §5.3 `PlayerRating` + §6.10 |
| `user_settings` | new table, `consent Json?` included | data-model §5.2 `UserSettings` |
| `users` | relations only (`challengesCreated`, `challengesAccepted`, `ratings`, `settings`); **no new columns** | — |
| `games` | relation only (`challenge`). `mode`, `rated`, `timeClass`, `whitePlayerId`, `blackPlayerId`, `startPly`, `phase`, display columns, `meta` exist from M2 (P2) | — |
| `game_players` | **new index** `game_players_h2h_idx` (consistency fix 9.3; it is not in M2). P9 starts **writing** `ratingBefore` (Glicko values), `ratingAfter`, `ratingDelta` (M2 columns) | P2 §6.2 |
| `shares` | **new index** `shares_owner_created_idx`; P9 starts writing `kind = POSITION` rows (P3's columns) | P3 §6.2 |
| `GameMetaV1` (JSON) | two optional keys: `source` (`"queue"` \| `"challenge"`), `notBefore` (epoch ms) | P2 `PKG/db/src/json/game-meta.ts` |
| roles (`PKG/db/sql/roles.sql`, not in the migration) | grants for `replay_realtime` and `replay_worker` (§6.3) | P2 §6.7, P3 §6.4 |
| `matchmaking_queue`, `MatchmakingStatus` | untouched; stop being written after the parity check; dropped by **C2** | §6.7 |

No new value on an **existing** enum, so the two-release enum rule (feasibility §9 rule 1) does not apply to M9; the two new enums are new types that only P9 code reads.

### 6.2 Prisma (in `PKG/db/prisma/schema.prisma`)

```prisma
enum ChallengeStatus {
  OPEN
  ACCEPTED
  DECLINED
  CANCELLED
  EXPIRED
}

enum ChallengeStart {
  START
  LEGEND
  SHARED
}

/// M9 (P9). Friend challenge links: /join/<code> (invitee), /play/friend/<code> (creator).
model Challenge {
  id               BigInt          @id @default(autoincrement())
  /// 8 chars Crockford base32, upper case (PKG/game-core/src/codes/challenge.ts)
  code             String          @unique @db.VarChar(10)
  creatorId        BigInt
  startFrom        ChallengeStart
  /// LEGEND: the practice position (no FK; startFen is the source of truth for the game)
  chessPositionId  BigInt?
  /// SHARED: the Share it came from (no FK; a share may be revoked later)
  shareId          BigInt?
  startFen         String
  initialSeconds   Int
  incrementSeconds Int
  /// "white" | "black" | "random" (random is resolved at accept)
  creatorColor     String          @db.VarChar(6)
  /// requested by the creator AND eligible at creation (§8.5); the pair cap is applied at accept
  rated            Boolean         @default(false)
  status           ChallengeStatus @default(OPEN)
  /// createdAt + 24 h
  expiresAt        DateTime
  acceptedById     BigInt?
  acceptedAt       DateTime?
  /// last decline (the link stays OPEN unless D3 says otherwise)
  declinedAt       DateTime?
  gameId           BigInt?         @unique
  createdAt        DateTime        @default(now())
  creator          User            @relation("ChallengesCreated", fields: [creatorId], references: [id], onDelete: Cascade)
  acceptedBy       User?           @relation("ChallengesAccepted", fields: [acceptedById], references: [id], onDelete: SetNull)
  game             Game?           @relation(fields: [gameId], references: [id], onDelete: SetNull)

  @@index([creatorId, status])
  @@map("challenges")
}

/// M9 (P9; owner decision O3/D1). Glicko-2 per pool for REPLAY rated games (BULLET, BLITZ, RAPID), preset GAME (§8.6).
/// Rows with games = 0 are seed rows (§8.7).
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
  /// Recompute anchor (§6.10): the rating and RD this pool started from. Written once, with the first row; never updated.
  seedRating Float?    @db.Real
  seedRd     Float?    @db.Real
  /// last rating change or seed; drives the inactivity RD increase (§8.6)
  updatedAt  DateTime  @updatedAt
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([userId, pool])
  @@map("player_ratings")
}

/// M9 (P9; data-model §5.2 shape). Synced preferences, zod PreferencesV1 in PKG/db/src/json/preferences.ts.
/// Created lazily on the first PATCH; reads fall back to the zod defaults.
model UserSettings {
  userId              BigInt   @id
  prefs               Json     @default("{}")
  prefsVersion        Int      @default(0)
  reminderUtcMinute   Int?     @db.SmallInt
  quietStartUtcMinute Int?     @db.SmallInt
  quietEndUtcMinute   Int?     @db.SmallInt
  emailOptIns         String[] @default([])
  /// P11 D7 writes it; P10 keeps it when it adds pushOptIns
  consent             Json?
  updatedAt           DateTime @updatedAt
  user                User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("user_settings")
}

model User {
  // …existing…
  challengesCreated  Challenge[]    @relation("ChallengesCreated")
  challengesAccepted Challenge[]    @relation("ChallengesAccepted")
  ratings            PlayerRating[]
  settings           UserSettings?
}

model Game {
  // …existing (M2)…
  challenge Challenge?
}
```

`PreferencesV1` (`PKG/db/src/json/preferences.ts`, re-exported by `@repo/contracts/http/preferences`) gains the `play` section. It has no `train` section (R12).

```ts
export const TcPreset = z.enum(["1+0", "2+1", "3+0", "3+2", "5+0", "5+3", "10+0", "15+10", "30+0"]);
export const PlayPrefs = z.object({
  lastTab: z.enum(["legend", "bot", "friend", "online"]).optional(),
  tc: TcPreset.optional(),
  botStrength: z.union([z.literal(400), z.literal(800), z.literal(1200), z.literal(1600), z.literal(2000)]).optional(),
  friendStart: z.enum(["start", "legend"]).optional(),
  friendRated: z.boolean().optional(),
  onlinePosition: z.enum(["legend", "start"]).optional(),
  colorBot: z.enum(["white", "random", "black"]).optional(),
  colorOnline: z.enum(["white", "random", "black"]).optional(),
}).default({});
// PreferencesV1 = z.object({ board, pieces, sound, appearance, notifications, play: PlayPrefs }) — the other sections are inv-acct §3.0.1's.
```

`GameMetaV1` (P2) gains, additively: `source: z.enum(["queue", "challenge"]).optional()` and `notBefore: z.number().int().optional()` (epoch ms; online games only, §8.2.6). A restored session reads `notBefore` from the row, so a socket restart during the countdown keeps the same start time.

### 6.3 Hand-written SQL appended to the generated migration, and role grants

```sql
SET lock_timeout = '5s';
-- Daily expiry sweep and "is this link still open" checks on the small OPEN set
CREATE INDEX IF NOT EXISTS challenges_open_idx ON challenges ("expiresAt") WHERE status = 'OPEN';
-- data-model §5.2 (the reminder planner arrives in P10; the index is cheap and avoids a later migration)
CREATE INDEX IF NOT EXISTS user_settings_reminder_idx ON user_settings ("reminderUtcMinute") WHERE "reminderUtcMinute" IS NOT NULL;
-- Pair farming cap (§8.5); not created by M2 (consistency fix 9.3)
CREATE INDEX IF NOT EXISTS game_players_h2h_idx ON game_players ("userId", "opponentUserId", "endedAt" DESC)
  WHERE "opponentUserId" IS NOT NULL;
-- SP-1 durable daily cap (§7.1) and the ownerId SET NULL on account deletion (all kinds)
CREATE INDEX IF NOT EXISTS shares_owner_created_idx ON shares ("ownerId", "createdAt" DESC) WHERE "ownerId" IS NOT NULL;
ALTER TABLE user_settings SET (fillfactor = 80);
-- rating updates touch only non-indexed columns, so leave room for HOT updates
ALTER TABLE player_ratings SET (fillfactor = 90);
```

`game_players_h2h_idx` is built on a table that already holds the legacy and imported games. A plain `CREATE INDEX` takes a `SHARE` lock that blocks writes to `game_players` for the build time: about 1–3 s per 100k rows (the dev branch and, at P13, production hold tens of thousands of rows once P4 imports run). The migration therefore runs inside P2's deploy order with the socket drained (P2 §6.5 step 6), so no checkpoint or finish waits on the lock. P9 does not use `CREATE INDEX CONCURRENTLY` inside a migration file, because whether Prisma runs a file inside a transaction is listed as unverified (feasibility V10). If production has grown past 500k rows by then, the index moves to its own folder `m9b_h2h_index`: the owner runs its `CREATE INDEX CONCURRENTLY` with `psql`, then marks it with `prisma migrate resolve --applied` (CLAUDE.md rule 4).

All four index names go into `PKG/db/prisma/protected-indexes.txt` so the drift gate (`scripts/db/check-drift.ts`, P2) never drops them (data-model §11.3).

**Role grants** (additive lines in `PKG/db/sql/roles.sql`; run by the owner role on the Neon dev branch, repeated on production in P13; never in the migration, because the shadow and CI databases have no such roles, P3 §6.4):

```sql
GRANT SELECT, INSERT, UPDATE ON player_ratings TO replay_realtime;                  -- finish fragment, session load, repair
GRANT SELECT (id, status, "expiresAt", "createdAt"), UPDATE (status), DELETE ON challenges TO replay_worker;  -- HOUSEKEEPING slice
```

The socket needs no access to `challenges` or `user_settings` (R21: no watch code). Web keeps its owner role.

### 6.4 Indexes and the queries they serve

| Index | Columns / predicate | Query (exact shape) | Caller |
|---|---|---|---|
| `challenges_code_key` | unique `code` | Accept: `UPDATE challenges SET status='ACCEPTED', "acceptedById"=$me, "acceptedAt"=now() WHERE code=$c AND status='OPEN' AND "expiresAt" > now() AND "creatorId" <> $me RETURNING id, "creatorId", "startFen", "startFrom", "chessPositionId", "initialSeconds", "incrementSeconds", "creatorColor", rated` (0 rows → `SELECT status, "expiresAt", "creatorId", "acceptedById", "gameId" FROM challenges WHERE code=$c` to report the reason). Public read: the projection below. Decline, cancel | CHL-2…5, `/join`, `/play/friend` |
| `challenges_creatorId_status_idx` | `(creatorId, status)` | Create, one statement before the insert: `SELECT count(*) FILTER (WHERE "createdAt" > now() - interval '24 hours') AS day, array_agg(id ORDER BY "createdAt" DESC) FILTER (WHERE status='OPEN' AND "expiresAt" > now()) AS open FROM challenges WHERE "creatorId"=$me` (rows per creator are bounded by the daily cap × the 30-day prune); then `UPDATE challenges SET status='CANCELLED' WHERE id = ANY($open[5:])`; the user-delete cascade | CHL-1 |
| `challenges_gameId_key` | unique `gameId` | "Watch the game" (`gameId` → game ref, joined in the projection) | `/join` already_started |
| `challenges_open_idx` (raw) | `(expiresAt) WHERE status='OPEN'` | Daily: `UPDATE challenges SET status='EXPIRED' WHERE status='OPEN' AND "expiresAt" < now()`; prune (data-model P14): `DELETE FROM challenges WHERE status IN ('EXPIRED','DECLINED','CANCELLED') AND "createdAt" < now() - interval '30 days'` (small table, seq scan acceptable) | `HOUSEKEEPING` |
| `player_ratings_pkey` | `(userId, pool)` | Viewer: `… LEFT JOIN LATERAL (SELECT json_agg(…) FROM player_ratings WHERE "userId" = u.id) r ON true` (Prisma `relationLoadStrategy: "join"`, one round trip); finish fragment `INSERT … ON CONFLICT ("userId", pool) DO UPDATE … WHERE player_ratings.games = EXCLUDED.games - 1`; seed `INSERT … ON CONFLICT DO NOTHING`; session load for challenge games (LATERAL in `loadLiveGame`); the cold-cache read on `queue:join` (§7.7); the public challenge projection | `getViewer`, finish, seeding, socket, CHL-2 |
| `user_settings_pkey` | `userId` | `GET /api/me/preferences`, hub RSC read; PATCH upsert | ME-3a/b |
| `games_open_idx` (M2, P2) | `(status) WHERE status IN ('WAITING_FOR_OPPONENT','IN_PROGRESS')` | Live game check: `SELECT "referenceId" FROM games WHERE status IN ('WAITING_FOR_OPPONENT','IN_PROGRESS') AND ("whitePlayerId"=$me OR "blackPlayerId"=$me) AND mode IN ('ONLINE','FRIEND','TOURNAMENT') ORDER BY "createdAt" DESC LIMIT 1` (the live set is tens of rows) | hub, `/play/online`, accept |
| `game_players_h2h_idx` (M9) | `(userId, opponentUserId, endedAt DESC) WHERE opponentUserId IS NOT NULL` | Pair farming cap (§8.5): `SELECT count(*) FROM game_players WHERE "userId"=$w AND "opponentUserId"=$b AND rated AND result IN ('WIN','LOSS','DRAW') AND "endedAt" > now() - interval '24 hours'` (aborted games do not count) | quick-match CTE, accept |
| `game_players_userId_endedAt_gameId_idx` (M2, P2) | `(userId, endedAt DESC, gameId DESC)` | Home "since Monday": P5's existing (h3) read `SELECT "endedAt" FROM game_players WHERE "userId"=$1 AND "endedAt" >= $mondayUtc` gains the columns `rated, "timeClass", "ratingBefore"`; the first rated row of the headline pool is picked in TypeScript (≤ 50 rows) | `getHomeData` (P5 slot) |
| `shares_code_key` (M3) | unique `code` | `/s/<code>`: `SELECT s.code, s.fen, s.title, s.subtitle, s.themes, s.note, s."showUsername", s."imageVersion", s."chessPositionId", s."createdAt", s."revokedAt", u."referenceId", u.name FROM shares s LEFT JOIN users u ON u.id = s."ownerId" WHERE s.code=$c AND s.kind='POSITION'` (`revokedAt IS NOT NULL` → 404 in TypeScript, so the row is never cached as live) | SP-2, page |
| `shares_owner_created_idx` (M9) | `(ownerId, createdAt DESC) WHERE ownerId IS NOT NULL` | SP-1 durable cap: `SELECT count(*) FROM shares WHERE "ownerId"=$me AND kind='POSITION' AND "createdAt" > now() - interval '24 hours'`; the `SET NULL` on account deletion | SP-1, P10 deletion |

Public challenge projection (one round trip):

```sql
SELECT c.code, c.status, c."startFrom", c."startFen", c."initialSeconds", c."incrementSeconds", c."creatorColor",
       c.rated, c."expiresAt", c."createdAt", g."referenceId" AS "gameRef", p.slug AS "positionSlug",
       u."referenceId" AS "creatorRef", u.name, u."profilePictureUrl",
       u."subscriptionStatus", u."currentPeriodEnd", u."trialEndsAt",      -- entitlement, evaluated in TS, never returned
       r.ratings
FROM challenges c
JOIN users u            ON u.id = c."creatorId"
LEFT JOIN LATERAL (SELECT json_agg(json_build_object('pool', pool, 'rating', rating, 'games', games)) AS ratings
                   FROM player_ratings WHERE "userId" = c."creatorId") r ON true          -- ≤ 3 PK rows
LEFT JOIN games g       ON g.id = c."gameId"
LEFT JOIN chess_positions p ON p.id = c."chessPositionId"
WHERE c.code = $1;
```

The DAL picks the creator's rating for the challenge's pool (`poolOf(initialSeconds, incrementSeconds)`) in code and evaluates the creator's entitlement with P1's `entitlementOf()`; a lapsed creator turns the public status into `unavailable` without saying why. The position card (name, event, year, side to move, "after" label) comes from P8's cached `getPosition(slug)` (tag `position:<slug>`), so it costs nothing on a warm cache. The Prisma form is `prisma.challenge.findUnique({ relationLoadStrategy: "join", where: { code }, select: { …, creator: { select: { referenceId, name, profilePictureUrl, subscriptionStatus, currentPeriodEnd, trialEndsAt, ratings: { select: { pool, rating, games } } } }, game: { select: { referenceId } }, … } })`.

### 6.5 Migration files, procedure and safety

| Folder (`PKG/db/prisma/migrations/`) | Contents | Applied |
|---|---|---|
| `<ts>_m9_play_challenges_ratings` | `CREATE TYPE "ChallengeStatus"`, `CREATE TYPE "ChallengeStart"`, `CREATE TABLE challenges`, `player_ratings`, `user_settings`, their FKs and Prisma indexes, then §6.3 | dev in P9; production in P13 (or in P9's own release under Launch A) |
| `<ts>_c2_drop_matchmaking_queue` | §6.7 | one release after P9 reaches production, after the owner confirms |

Procedure (allocation §1.3, data-model §11.2, consistency R-20; CLAUDE.md rules 2, 3 and 5):

1. Edit `PKG/db/prisma/schema.prisma`.
2. Generate the SQL against a **local** Docker shadow database: `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url postgresql://postgres:pw@localhost:55433/postgres --script > …/migration.sql`.
3. Append §6.3 by hand. Check: every statement is additive (`CREATE TYPE`, `CREATE TABLE`, `CREATE INDEX`, FKs on the new tables only).
4. Drift gate locally and in CI (`scripts/db/check-drift.ts` with the protected-index list).
5. `prisma migrate deploy` on a fresh local Postgres 17, run the seed, `pnpm --filter web check-types`, the unit and contract suites. The CI index-existence check (api-perf §5) asserts every index named in §6.4 exists after `migrate deploy`.
6. Apply to the Neon **dev** branch named in CLAUDE.md with `prisma migrate deploy`, after printing and checking the host. Never `migrate dev` against Neon, and **no `db push` on any Neon branch** (it would drop the hand-written partial indexes).
7. Run the §6.3 grants on the dev branch as the owner role.
8. Production gets M9 only through `prisma migrate deploy` after a rehearsal on a child branch of `production` (P13; under Launch A, in P9's own release with the same rehearsal).

Safety notes: no table rewrite; the only lock on an existing hot table is the `game_players_h2h_idx` build (above). FKs point **from** the new tables to `users` and `games`; adding them takes a `SHARE ROW EXCLUSIVE` lock on `users`/`games` for milliseconds, bounded by `lock_timeout = 5s`. New `NOT NULL` columns exist only on new tables.

### 6.6 Backfill: rating seed rows (`WEB/scripts/backfill/seed-player-ratings.ts`)

Idempotent TypeScript script, batches of 500 users by id, `--dry-run` (counts only) and `--apply`, refuses hosts outside `BACKFILL_ALLOWED_HOSTS` (P2):

```ts
for (const batch of usersInBatches(500)) {
  // sources: LinkedAccount.ratings (P4 RatingsV1: {v, bullet?, blitz?, rapid?: {rating, best, games}}) and
  //          User.initialRating / ratingBand (P4 onboarding)
  const rows = batch.flatMap((u) => seedRows(u)); // §8.7 rules; at most 3 rows per user
  await prisma.$executeRaw`INSERT INTO player_ratings ("userId", pool, rating, rd, volatility, games, "seededFrom", "seedRating", "seedRd", "updatedAt")
    SELECT * FROM unnest(${ids}::bigint[], ${pools}::"TimeClass"[], ${ratings}::real[], ${rds}::real[], ${vols}::real[],
                         ${zeros}::int[], ${sources}::varchar[], ${ratings}::real[], ${rds}::real[], ${nows}::timestamp[])
    ON CONFLICT ("userId", pool) DO NOTHING`;
}
```

Verification: `SELECT pool, count(*), round(avg(rating)) FROM player_ratings GROUP BY pool` against the script's dry-run counts. The same `seedPlayerRatings(tx, userId)` domain function (`PKG/domain/src/ratings/seedPlayerRatings.ts`) is called from P4's link service (`WEB/lib/accounts/link-service.ts`, after a successful link) and the onboarding Level step (`WEB/lib/onboarding/steps.ts`, `advance("GOALS")`) going forward (WP-B edits them), so new users get seed rows when they link or pick a level. Seeding never overwrites a row (`DO NOTHING`), so a user who links Chess.com after five rated games keeps the earned rating.

### 6.7 Contract step C2 (one release after P9 reaches production; owner-confirmed)

Preconditions: `play-hub-v3` has been at 100 % on production for one release; `SELECT max("createdAt") FROM matchmaking_queue` is older than 7 days; the legacy routes are deleted. Before running, ask the owner with the CLAUDE.md wording: "This command drops the `matchmaking_queue` table and the `MatchmakingStatus` type. Are you sure?" Take `pg_dump --table=matchmaking_queue` to R2 first.

```sql
SET lock_timeout = '5s';
DROP TABLE IF EXISTS "matchmaking_queue";
DROP TYPE IF EXISTS "MatchmakingStatus";
```

The schema loses `model MatchmakingQueue`, `enum MatchmakingStatus` and `User.matchmakingRequests` in the same PR.

### 6.8 Dev seed data and E2E personas

Personas (data-model §13.3–13.4; `WEB/prisma/seed/personas.ts` and `fixtures.ts`, upserts, dev only):

| Persona | P9 data | Exercises |
|---|---|---|
| `member` | `player_ratings`: BLITZ 1184 (RD 62, 42 games, peak 1231), RAPID 1231 (12 games), BULLET 1102 (3 games: provisional); 5 rated Blitz `game_players` rows since Monday with deltas (+8, −6, +2, +7, −3) vs `trial`; `user_settings.prefs.play = {botStrength: 1200, tc: "5+3", lastTab: "online"}`; challenges OPEN `SEEDAAA1` (5+3, legend Opera, random), EXPIRED `SEEDEXP1`, CANCELLED `SEEDCAN1`, ACCEPTED `SEEDACC1` (linked to a completed FRIEND game vs `trial`); shares POSITION `seedshr1` (Kasparov–Topalov 1999 after 23…Qd6, note "Find what Kasparov played here. I couldn't.") and revoked `seedrev1` | hub defaults, Home rating lines, accept `unavailable` / `already_started` / `own_link`, share `default` / `not_found`, provisional "1102?" |
| `trial` | BLITZ 1212 (20 games) | the opponent for the rating history |
| `new` | none | "no rating yet" (headline hidden) |
| `lapsed` | BLITZ 1150 | accept `paywalled` (renew copy); a lapsed creator → `unavailable` |

Challenge codes avoid I, L, O and U (Crockford). E2E users A–P (shared members) and R (non-member) are only ever **added to** by P9 specs, never asserted on absolute counts (testing X4). Exact states come from leased personas that P9 adds to `WEB/scripts/dev/personas.ts` (P1): `challenge-cap` (no open links), `ratings-fresh` (no `player_ratings` rows and no games of its own, so the pair cap starts at 0), `share-cap` (no shares in the last 24 h). The reset refuses any account that is not an `E2E_POOL_*` user (P1 `seed-guards.ts`).

### 6.9 Storage

`challenges` ≈ 220 B per row, pruned 30 days after closing: well under 1 MB at any realistic volume. `player_ratings` ≈ 80 B × ≤ 3 rows per user. `user_settings` ≈ 0.5–4 KB per user (only users who changed something). `game_players_h2h_idx` ≈ 40 B per member game row. Against data-model §10's 4.4 MB per member per year this adds under 0.2 %.

### 6.10 Rating recompute (the rollback path for a rating bug)

There is no append-only rating log (R3). Ratings can still be rebuilt exactly, because every input is stored: the pool's start values (`player_ratings.seedRating`, `seedRd`, `seededFrom`; null anchors mean the default 1500 / 350), every rated result (`games.rated`, `status = 'COMPLETED'`, `outcome`, `completedAt`, `timeClass`, `chessPositionId`), and the position handicap (the committed `LEGEND_POOL` file, §8.3).

`WEB/scripts/ratings/recompute.ts --pool BLITZ|BULLET|RAPID|all --dry-run|--apply`:

1. Refuse to run while any rated game is live: `SELECT 1 FROM games WHERE rated AND status = 'IN_PROGRESS' LIMIT 1` → exit, unless `--force-after-drain` is given while the socket is drained (P2 `/internal/drain`).
2. Load the anchors for every user with a row in the pool.
3. Stream the pool's rated, completed games in `("completedAt", id)` order, 1,000 at a time, with both `game_players` rows; replay them in memory with the same `updateAfterGame()` and `GAME` preset the socket uses (deterministic: same inputs, same bits).
4. `--dry-run` prints: users whose rating would change by more than 1 point, game rows whose `ratingBefore/After/Delta` would change, the largest difference.
5. `--apply` first writes a CSV of the current `player_ratings` rows and of `(gameId, userId, ratingBefore, ratingAfter, ratingDelta)` for the pool's rated rows to `REPO/backups/ratings-<date>.csv.gz` (local, never committed), then updates in batches of 500 rows: `UPDATE game_players gp SET "ratingBefore" = v.b, "ratingAfter" = v.a, "ratingDelta" = v.d FROM (VALUES …) v(gid, uid, b, a, d) WHERE gp."gameId" = v.gid AND gp."userId" = v.uid`, then one `UPDATE player_ratings … FROM (VALUES …)` per batch of users.

On production `--apply` overwrites data, so it is only run after the owner confirms (CLAUDE.md rule 5 wording: "This command rewrites every rating in the {pool} pool. Are you sure?"). Unit test: `recompute.test.ts` replays a seeded set of 200 random games and reproduces the values the live finish path wrote.

---

## 7. API

Conventions (api-design §2, P1 §7.2): every handler is a thin `route()` file that calls one `@repo/domain` function; zod 4 schemas live in `@repo/contracts`; success `{ data, meta? }`, errors `{ error: { code, message, details?, retryAfterSec?, requestId } }` with the HTTP status bound to the code in `PKG/contracts/src/http/codes.ts`; ids leaving the server are refs or codes, never BigInts; mutations check `Origin` (P1 middleware); side effects run in `after()`. **GETs never write** (api-perf §5 GET-purity gate): challenge expiry is derived on read, never stored by a GET.

### 7.1 HTTP endpoints

Auth column: P = public (the handler never reads the session), U = signed in, M = member (`requireMember()` → 402 with `reason`), O = owner of the resource. Cache tiers are P1's (`public-static`, `private-etag`, `no-store`). Rate limits are P1 fixed windows `limit / windowSec` per user on the `burst` store; the daily caps are **durable**, counted inside the domain function from the rows the route writes (api-perf AP-11), so a Neon suspend cannot reset them.

| ID | Method · path | Auth | Request → `data` | Errors | Cache | Rate limit | Idempotency | Class |
|---|---|---|---|---|---|---|---|---|
| CHL-1 | `POST /api/challenges` | M | `ChallengeCreateBody` → 201 `ChallengeCreateData` | 400 `validation_failed`; 404 `not_found` (slug or share); 422 `illegal_position`; 402; 429 `rate_limited` (`details.window: "minute" \| "day"`) | `no-store` | `challenge-create` 10 / 60 s; durable 50 created per 24 h (§6.4 count) | `Idempotency-Key` required | W2 |
| CHL-2 | `GET /api/challenges/{code}` | P | → `ChallengePublic` | 404 `not_found` | `public-static` `{ sMaxAge: 10, swr: 30, tags: ["challenge:" + code] }` → `Cache-Control: public, max-age=0, must-revalidate` + `Vercel-CDN-Cache-Control: public, s-maxage=10, stale-while-revalidate=30` + `Vercel-Cache-Tag`. The CDN copy is the same for everyone; `isOwn` is computed on the client from `creator.ref` | edge WAF 60/min per IP | — | R1 |
| CHL-3 | `POST /api/challenges/{code}/accept` | M | `{}` → `ChallengeAcceptData` | 409 `conflict` (`details.reason`: `already_started` + `gameRef` \| `own_link` \| `already_in_game` + `gameRef`); 410 `gone` (`details.reason`: `expired` \| `cancelled` \| `declined` \| `creator_unavailable`); 404; 402 | `no-store` | `challenge-accept` 10 / 60 s | natural: a repeat by the user who accepted returns 200 with the same `gameRef` | W2 |
| CHL-4 | `POST /api/challenges/{code}/decline` | U | `{}` → 204 | 409 `own_link`; 410 `gone`; 404 | `no-store` | `play-write` 30 / 60 s | natural (a repeat is 204) | W1 |
| CHL-5 | `DELETE /api/challenges/{code}` | O (creator) | → 204 | 403 `forbidden` (not the creator); 409 `conflict` (`already_started` + `gameRef`); 404 | `no-store` | `play-write` 30 / 60 s | natural (cancelled again → 204) | W1 |
| SP-1 | `POST /api/shared-positions` | M | `SharePositionCreateBody` → 201 `SharePositionCreateData` | 400; 403 (`sourceGameRef` not the viewer's game); 404; 409 `conflict` (`live_game`); 422 `illegal_position`; 429 | `no-store` | `share-burst` 5 / 60 s; durable 20 per 24 h (`shares_owner_created_idx` count) | `Idempotency-Key` required | W2 |
| SP-2 | `GET /api/shared-positions/{code}` | P | → `SharePublic` | 404 (unknown); 410 `gone` (`revoked`) | `public-static` `{ sMaxAge: 3600, swr: 86400, tags: ["share:" + code] }`; purged with `revalidateTag` + `invalidateByTag` on revoke | edge WAF 60/min per IP | — | R1 |
| SP-3 | `DELETE /api/shared-positions/{code}` | O | → 204 | 403; 404 | `no-store` | `play-write` 30 / 60 s | natural | W1 |
| ME-3a | `GET /api/me/preferences` | U | → `PrefsData` | — | `private-etag` (`ETag: "<prefsVersion>"`, 304 on match) | — | — | R1 |
| ME-3b | `PATCH /api/me/preferences` | U | `PrefsPatchBody` → `PrefsData` | 400 (invalid leaf; unknown keys are stripped, not rejected) | `no-store` | `prefs` 120 / 60 s (P10 reuses this bucket, consistency fix 9.8) | last write wins per leaf; never 412 | W1 |
| OG-1 | `GET /og/challenge/{code}` | P | → 1200 × 630 PNG | unknown code → the generic `/og` image with `Cache-Control: public, max-age=60` | `Cache-Control: public, max-age=86400` + `Vercel-CDN-Cache-Control: public, s-maxage=31536000` + `Vercel-Cache-Tag: challenge:{code},user:{creatorRef}` (the image never changes after creation; P10 purges `user:{ref}` on a rename or deletion) | edge WAF | — | P |
| OG-2 | `GET /og/position/{code}?v={imageVersion}` | P | → 1200 × 630 PNG | unknown or revoked → generic image, `max-age=60` | `Cache-Control: public, max-age=300` + `Vercel-CDN-Cache-Control: public, s-maxage=31536000` + `Vercel-Cache-Tag: share:{code}`. Revoke purges it with the page and SP-2 (api-perf AP-05: a revoked share's image must stop serving, so the browser copy lives 5 minutes at most) | edge WAF | — | P |

**Clerk and cacheable GETs.** P1's `public-static` tier requires the route to be listed in middleware's `NO_CLERK_API` and excluded from the matcher, so CHL-2 and SP-2 are added there (in `lib/routes/classes/play.ts`): Clerk never touches them and they never set a cookie. The route wrapper still asserts in dev and test that a `public-*` response carries no `Set-Cookie` (optimization §4.2), and P1's registry lint fails CI if any route with `auth ≠ public` declares a `public-*` tier (api-perf AP-03 gate).

P9 also relies on, without changing their contracts: PLAY-1 `POST /api/games` (P2/P8; P9 needs its `positionSlug` input and adds `sharedCode` in `WEB/lib/games/create-bot-game.server.ts` if missing, WP-G), P8's CAT-5 `GET /api/positions?collection=legend-practice&q=`, and `GET /api/socket-token` (claims change, §7.7).

### 7.2 Request and response schemas (`PKG/contracts/src/http/challenges.ts`, `shares.ts`, `preferences.ts`)

```ts
import { z } from "zod";
import { Code, Ref, Slug, Fen, Color, IsoDate, Username } from "./common";
import { TcPreset } from "./preferences";

export const ChallengeCreateBody = z.strictObject({
  startFrom: z.enum(["start", "legend", "shared"]),
  positionSlug: Slug.optional(),          // required when startFrom = legend
  sharedCode: Code.optional(),            // required when startFrom = shared
  tc: TcPreset,                           // the 9 hub presets only (no arbitrary clocks)
  color: z.enum(["white", "random", "black"]),
  rated: z.boolean().default(true),       // downgraded to casual by the server when not eligible (§8.5)
}).superRefine((b, ctx) => {
  if (b.startFrom === "legend" && !b.positionSlug) ctx.addIssue({ code: "custom", path: ["positionSlug"], message: "Required" });
  if (b.startFrom === "shared" && !b.sharedCode) ctx.addIssue({ code: "custom", path: ["sharedCode"], message: "Required" });
  if (b.startFrom === "start" && (b.positionSlug || b.sharedCode)) ctx.addIssue({ code: "custom", message: "Unexpected position" });
});

export const PlayerCard = z.object({
  ref: Ref,
  username: Username.nullable(),          // null until P10 adds User.username (R24)
  displayName: z.string().max(40), initials: z.string().max(2),
  avatarUrl: z.string().url().nullable(), rating: z.number().int().nullable(), provisional: z.boolean(),
});

export const PositionPreview = z.object({
  slug: Slug.nullable(), name: z.string().max(80), event: z.string().max(80).nullable(), year: z.number().int().nullable(),
  sideToMove: Color, afterLabel: z.string().max(24).nullable(), fen: Fen,
});

export const ChallengePublic = z.object({
  code: Code,
  // "expired" is derived when OPEN and past expiresAt; "unavailable" = OPEN but the creator can no longer play (reason never exposed)
  status: z.enum(["open", "accepted", "expired", "cancelled", "declined", "unavailable"]),
  creator: PlayerCard,
  tc: z.object({ preset: TcPreset, initialSeconds: z.number().int(), incrementSeconds: z.number().int(),
                 label: z.string(), long: z.string(), group: z.enum(["bullet", "blitz", "rapid"]) }), // "5+3", "5 min + 3 s per move"
  rated: z.boolean(),
  creatorColor: z.enum(["white", "random", "black"]),   // the invitee plays the other side ("random" stays random)
  startFrom: z.enum(["start", "legend", "shared"]),
  position: PositionPreview.nullable(),                 // null for the standard start
  studySeconds: z.union([z.literal(0), z.literal(30)]), // 30 when startFen ≠ the initial position (P2 rule)
  expiresAt: IsoDate, createdAt: IsoDate,
  gameRef: Ref.nullable(),                              // accepted only ("Watch the game")
});
export const ChallengeCreateData = z.object({ code: Code, url: z.string().url(), expiresAt: IsoDate, challenge: ChallengePublic });
export const ChallengeAcceptData = z.object({ gameRef: Ref, you: Color, rated: z.boolean() });

// shares.ts (api-design SP-1 shape)
export const SharePositionCreateBody = z.strictObject({
  positionSlug: Slug.optional(),
  fen: Fen.optional(),
  sourceGameRef: Ref.optional(),
  sourcePly: z.number().int().min(0).max(1000).optional(),
  note: z.string().max(400).optional(),                 // sanitised to ≤ 140 on the server (§8.10)
}).refine((b) => [b.positionSlug, b.fen, b.sourceGameRef].filter(Boolean).length === 1, "Exactly one source")
  .refine((b) => !b.sourceGameRef || b.sourcePly !== undefined, { path: ["sourcePly"], message: "Required with sourceGameRef" });
export const SharePositionCreateData = z.object({ code: Code, url: z.string().url() });
export const SharePublic = z.object({
  code: Code, fen: Fen, sideToMove: Color,
  title: z.string().max(80).nullable(), subtitle: z.string().max(40).nullable(), themes: z.array(z.string().max(24)).max(4),
  note: z.string().max(140).nullable(),
  sharer: z.object({ displayName: z.string(), username: Username.nullable(), ref: Ref }).nullable(), // null: deleted or showUsername=false
  positionSlug: Slug.nullable(),                        // practice position → Play vs Bot uses LEGEND_BOT
  defaultTc: z.object({ initialSeconds: z.number().int(), incrementSeconds: z.number().int() }),   // 300+0
  imageVersion: z.number().int(), createdAt: IsoDate,
});

// preferences.ts
export const PrefsData = z.object({ prefs: PreferencesV1, version: z.number().int(), updatedAt: IsoDate.nullable() });
export const PrefsPatchBody = z.object({ patch: PreferencesV1Patch /* deep partial, unknown keys stripped */, baseVersion: z.number().int().min(0) });
```

**Error codes and reasons** (`PKG/contracts/src/http/codes.ts`, R19): P9 adds no new code. It uses `validation_failed` 400, `unauthorized` 401, `subscription_required` 402, `forbidden` 403, `not_found` 404, `conflict` 409, `in_flight` 409 and `idempotency_key_reused` 422 (P2), `gone` 410 (P3), `illegal_position` 422 (P2), `rate_limited` 429. It appends `own_link`, `live_game`, `already_in_game` to `CONFLICT_REASONS`, and creates `GONE_REASONS = ["expired", "cancelled", "declined", "creator_unavailable", "revoked"] as const` beside it. `codes.test.ts` asserts every `details.reason` a P9 route returns is registered.

### 7.3 Socket protocol additions (`PKG/contracts/src/socket/queue.ts`, `user.ts`, `game.ts`; registered in `registry.ts`)

Conventions from P2 §7.4: commands always use acks with a 5 s client timeout; every inbound payload is zod-validated on the server; codes are lowercase snake. Every server→client event below is added to P2's single registry `PKG/contracts/src/socket/registry.ts` (consistency R-07), with its schema in `socket/queue.ts` (queue events) or `socket/user.ts` (user-room events); `/internal/emit` refuses anything not registered.

**Commands (client → server)**

| Command | Payload | Allowed when | Ack `ok` | Ack error codes |
|---|---|---|---|---|
| `queue:join` | `{ tc: TcPreset, position: "legend" \| "start", color: "w" \| "b" \| "random", since?: number }` (`since` = the original `joinedAt`, honoured when within the last 70 s and the bucket key is unchanged) | token `ent > now`; no live rated game; 1 join per 2 s per user; not in an abort cooldown; not draining | `{ ok: true, poolKey, pool, preset, joinedAt, serverNow, rating: { value, provisional }, range: { min, max, plusMinus: 100 }, widenAt, mergeAt, timeoutAt, studySeconds, preview: PositionPreview \| null }` (≤ 400 B) | `not_member`, `already_in_game` (+ `gameRef`), `rate_limited` (+ `retryAfterMs`), `draining`, `invalid`, `internal` |
| `queue:leave` | `{}` | always | `{ ok: true }` | — |

A second `queue:join` from another socket of the same user replaces the entry and sends `queue:moved` to the old socket (the newest tab wins, which is what "Search here instead" needs; api-design's `already_queued` error is not used).

**Events (server → client)**

| Event | Room | Payload | Size | UI |
|---|---|---|---|---|
| `queue:status` | the joining socket | `{ widened: true, range: { min, max, plusMinus: 200 }, merged: boolean, group: "bullet" \| "blitz" \| "rapid" }` (once, at 20 s; `merged` is false when preset merging is switched off, D20) | ≤ 120 B | `widened` |
| `queue:matched` | `ROOM.user(ref)` of both players | `{ gameRef, you: "w" \| "b", opponent: PlayerView, preset, merged, rated, startsAt, serverNow }`. The position, study length and pool are already in the join ack (the bucket fixes them); the clock values follow from `preset` | ≤ 300 B | match found |
| `queue:timeout` | the joining socket | `{ searchedMs, poolKey }` | ≤ 120 B | `timeout` |
| `queue:moved` | the replaced socket | `{}` | ≤ 120 B | `error` (moved) |
| `challenge:accepted` | `ROOM.user(creatorRef)` | `{ code, gameRef, by: { displayName } }` | ≤ 120 B | share page `joined`; toast elsewhere |
| `challenge:declined` | `ROOM.user(creatorRef)` | `{ code, by: { displayName } }` | ≤ 120 B | toast |

P2's size test (`PKG/contracts/src/socket/test/size.test.ts`, "every other event ≤ 120 B") gets two named exceptions: the `queue:join` ack (≤ 400 B, with the longest `LEGEND_POOL` name and FEN) and `queue:matched` (≤ 300 B, with a 40-character display name and an avatar URL).

**Test isolation.** With `APP_ENV=test` the matchmaker prefixes every bucket key with the token's `e2eRun` claim (P2 §7.4.2), so only sockets of the same Playwright test can pair (testing X4.5). Without the claim, or outside test, the prefix is empty.

**Changes to P2's game protocol** (additive; `GameState.v` stays 2):

- `GameState.stakes?: { win: number; draw: number; loss: number } | null` for the viewer (§8.8); absent or null on casual games.
- `PlayerView.provisional?: boolean`; `PlayerView.rating` comes from the game's pool.
- `GameState.rated` is real, and `header.right` reads "Blitz 5+3 · rated" or "· casual".
- `game:result.ratings` is filled after the finish commits: `{ w: RatingChange, b: RatingChange }` with `RatingChange = { pool, before, after, delta, provisional }`.
- `game:phase` for an `ONLINE` game never moves to `study` before `startsAt` (`meta.notBefore`). A player missing at `startsAt + 15 s` ends the game `aborted`; `game:ended` gains the optional `abortReason: "no_show"` and `meta.abortedBy` the value `"no_show"`, so P2's `over_aborted` card shows "Opponent didn't join · not rated".

### 7.4 Internal calls

| Call | Direction | Body | Notes |
|---|---|---|---|
| `POST {WS_INTERNAL_URL}/internal/emit` (P2 §7.5) | web → socket | `{ v: 1, targets: [{ userRef: creatorRef }], event: "challenge:accepted" \| "challenge:declined", data, dedupeKey: "chl:<code>:<event>" }` | Sent with `internalFetch()` (`WEB/lib/internal/fetch.ts`, P2 §7.5.1), which signs with kid `web`; P9 writes no header itself (R18). Called in `after()` from CHL-3 / CHL-4; 2 s timeout, no retry (the share page also refetches on focus and after a reconnect gap). The socket skips the parse when the creator has no open socket (P2, api-perf AP-10) |
| Quick-match game creation | socket → Neon directly (B4) | `createMatchedGame(db, { ref, white, black, preset, start, rated, startsAt })` (`PKG/db/src/live/createMatchedGame.ts`) | One CTE (§8.2.7); idempotent on the socket-generated `ref` (a retried insert hits the unique `referenceId` and reads the row back) |
| Ratings in the finish | inside P2's `finishGame()` (`PKG/db/src/live/finish.ts`) | the `ratings` fragment and the `gp` SET extension (§8.6) | No new transport, no new round trip |

### 7.5 Idempotency and concurrency

| Write | Mechanism |
|---|---|
| CHL-1, SP-1 | `Idempotency-Key` (UUID v4) through `WEB/lib/api/idempotency.ts`: same key + same body → stored response with `Idempotent-Replayed: true`; same key + other body → 422 `idempotency_key_reused`; in flight → 409 `in_flight` (`retryAfterSec: 2`). The client keeps the key in `sessionStorage` per option hash, so a reload or double click never creates two links |
| CHL-3 accept | Conditional update on `status='OPEN'`. Two parallel accepts: one wins, the other re-reads and gets 409 `already_started`. The winner retrying after a dropped response re-reads `acceptedById = me` and gets 200 with the same `gameRef` |
| CHL-5 cancel | `UPDATE … SET status='CANCELLED' WHERE code=$c AND "creatorId"=$me AND status='OPEN'`; 0 rows → re-read: accepted → 409, already cancelled → 204 |
| Quick-match create | Socket-generated `ref` + unique `referenceId` (`ON CONFLICT DO NOTHING`, then read back); entries are marked `pairing` in memory so a tick never pairs them twice. A transient Neon error (P1017, 57P01, 08006, 08003: the compute suspended and closed the pooled connection) is retried once at once on a fresh connection and does not count toward `CREATE_RETRIES` (P2 §7.6 rule, api-perf AP-18) |
| Rating update | Only inside the finish statement, whose first fragment is the conditional `UPDATE games … WHERE status='IN_PROGRESS'` (a second finish matches 0 rows, so the rating fragment inserts nothing). The upsert's `WHERE player_ratings.games = EXCLUDED.games - 1` guard detects a concurrent change; fewer than 2 returned rows triggers `repairRatings()` (§8.6) |
| Prefs PATCH | Per-leaf last write wins; `prefsVersion = prefsVersion + 1` in the same `UPDATE`; upsert on the first write |

### 7.6 Pages, middleware, redirects and robots

| Path | File | Render | Middleware |
|---|---|---|---|
| `/play` | `WEB/app/(app)/play/page.tsx` + `loading.tsx` | dynamic RSC; flag off → `LegacyPlayPage` | member |
| `/play/online` | `WEB/app/(app)/play/online/page.tsx` + `loading.tsx` | dynamic RSC + client socket | member |
| `/play/friend/[code]` | `WEB/app/(app)/play/friend/[code]/page.tsx` | dynamic RSC | member |
| `/join/[code]` | `WEB/app/(shared)/join/[code]/{page,loading,not-found}.tsx` | dynamic RSC (shell chosen by session), data cache 10 s | **public** |
| `/s/[code]` | `WEB/app/(shared)/s/[code]/{page,loading,not-found}.tsx` | dynamic RSC, data cache 1 day + tag | **public** |
| `/og/challenge/[code]`, `/og/position/[code]` | `WEB/app/og/…/route.tsx` (`ImageResponse`, Node runtime, PNG pieces from `public/chess-icons`) | — | excluded from the matcher |
| `/queue` | `WEB/app/queue/route.ts` | 308 → `/play/online?tc={time/60}+{increment}&pos={legend ? 'legend' : 'start'}` | public (it only redirects) |
| `/challenge/new`, `/play/queue`, `/play/friend` (no code) | `WEB/next.config.js` `redirects()` (or `config/redirects/p9.mjs`) | 308 → `/play?tab=friend`, `/play/online`, `/play?tab=friend` (Next passes the incoming query through, so `?opponent=@martin_k` survives; `hub-state.ts` strips the `@`) | — |

`/position/[referenceId]` is P8's 308 (R26).

**Legacy `/join/<cuid>` links** (the segment is shared, so one page serves both formats): if the param matches the cuid pattern (`^c[a-z0-9]{20,31}$`) the page looks the game up by `referenceId`. `IN_PROGRESS` or `COMPLETED` → `redirect('/game/{ref}')`. A legacy `WAITING_FOR_OPPONENT` game while the flag is off → the legacy join component. Otherwise → `unavailable` with the copy "This link is from an older version of ReplayChess. Ask your friend for a new one." Codes are normalised before lookup (§8.9).

**Robots and indexing.** `WEB/app/robots.ts`: remove `/join/` from `disallow` (Twitterbot and others obey robots.txt, and their previews are the growth loop); add `/play/`. `/join/*` and `/s/*` pages set `robots: { index: false }` in `generateMetadata`, and `X-Robots-Tag: noindex` comes from `next.config.js` `headers()` for `/join/:code` and `/s/:code`. Pages never call `headers()` or try to set response headers (api-perf AP-14).

### 7.7 Socket token claims (`PKG/contracts/src/socket/token.ts`, P2's file)

```ts
const RatingTuple = z.tuple([z.number().int(), z.number().int(), z.number().int()]); // [rating, rd, games]
// P2's strictObject gains one optional field (additive; v stays 2):
r: z.object({ bullet: RatingTuple.optional(), blitz: RatingTuple.optional(), rapid: RatingTuple.optional() }).optional(),
//  the effective rating per pool (row, or the seed rule of §8.7 when there is no row)
```

The `(app)` layout's `RealtimeBoot` (P2) mints the first token from `viewer.ratings` with no extra read (the viewer select already joins `player_ratings`). The socket's in-memory `RatingCache` (`WS/src/game/ratingCache.ts`) holds `userRef → pool → {rating, rd, vol, games, at}`; a value written after a rated game wins over an older token (`at > iat`). So `queue:join` costs **no database read** in the normal case.

If P1/P2 take api-perf AP-41 (refresh tokens minted from Clerk session claims without a DB read), refreshed tokens carry no `r`. Then the first `queue:join` with a cold cache runs one primary-key read `SELECT pool, rating, rd, volatility, games, "updatedAt" FROM player_ratings WHERE "userId" = $1` (≤ 3 rows). It doubles as the Neon prewarm (§7.8), so the match insert still does not pay the cold start. The integration test covers both paths.

### 7.8 Background jobs and scheduled work

| Job | Where | Schedule | Statement |
|---|---|---|---|
| `challenges.expire` | a slice of P3's `HOUSEKEEPING` job on the worker: `WK/src/scheduler/recurring/challenges.ts` implementing P3's `RecurringSlice` (`id: "challenges"`, `run(ctx)` only, no `plan`), exported from the directory's `index.ts` barrel (P3-D22) | daily, inside P3's `HOUSEKEEPING` run that `DAILY_PLAN` schedules (21:00 UTC); no new wake | `UPDATE challenges SET status='EXPIRED' WHERE status='OPEN' AND "expiresAt" < now()` (`challenges_open_idx`) |
| `challenges.prune` | same | daily | `DELETE FROM challenges WHERE status IN ('EXPIRED','DECLINED','CANCELLED') AND "createdAt" < now() - interval '30 days'` (data-model P14) |
| Matchmaking tick | socket, in memory | every 1 s **only while a bucket is non-empty**, plus one attempt on every join | none until a pair |
| Neon prewarm | socket | on the first `queue:join` after ≥ 4 min without a DB statement | `SELECT 1`, or the cold-cache rating read of §7.7 when that runs anyway (one statement per search session at most) |

Both statements run in the same slice, well inside P3's 60 s per-slice budget, and need the `replay_worker` grants of §6.3. No hourly sweeper (R13), no `HOURLY_TICK` (P3 has none either), no new Vercel cron.

### 7.9 Environment variables, flags and test hooks

| Name | Where | Value | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | Vercel `replay-chess-dev` (and later `replay-chess`) | dev: `https://replay-chess-dev-replaychess007-1069.vercel.app`; prod: `https://playchess.tech` | `WEB/lib/site-url.ts` `appOrigin()`; challenge and share URLs, OG absolute URLs. Add to `turbo.json` `globalEnv` |
| `TIMING_PROFILE` (P2) | socket | `fast` only with `APP_ENV=test` | P9 adds its constants to `WS/src/config/timing.ts`: `fast` = widen and merge at 2 s, timeout at 6 s, countdown 1 s, online join window 3 s (testing X5). There are no separate `QUEUE_*` env overrides |
| `RATINGS_APPLY` | socket | `on` (default) \| `off` | kill switch for the rating fragment (§14.3): `off` finishes rated games without touching `player_ratings` and sends `ratings: null`; the recompute tool catches up later |
| `SOCKET_TOKEN_SECRET`, `INTERNAL_API_SECRET`, `WS_INTERNAL_URL` | existing (P2) | — | unchanged; `INTERNAL_API_SECRET` is P2's HMAC key set |

**Flags** (`lib/flags/registry/p9.ts`, or one additive edit to P1's flags module):

- `play-hub-v3` gates the new `/play`, `/play/online`, `/play/friend/*`, `/s/*` (404 when off), the new `/join/[code]` behaviour (legacy cuid flow when off), the Home and game-over link targets, the "Share Position" menu items, and the hub's shortcuts. Ratings are applied regardless of the flag, because only v3-created games carry `rated = true`. During the rollout the legacy DB queue and the socket queue do not see each other; on dev everyone is on the flag. The flag is removed one release after it reaches 100 % in production (allocation §1.6).
- `online-legend-pool` (default on). Off → the Online tab hides "Legend Position", the hub forces `pos=start`, and the copy under the segment reads "Everyone starts from the standard position for now." The socket still accepts `position: "legend"` (an old URL keeps working); the flag only steers new searches. Owner decision D21 says when to turn it off.

**Test hooks** (registered in P1's `WEB/lib/test-hooks/registry.ts` and covered by `prod-guard.spec.ts`, testing X12): the `/dev/ui/play/*` demo routes (`isNonProd()`, 404 in production), the P9 fields of `TIMING_PROFILE` (P2's entry, extended), the `e2eRun` bucket prefix (P2's claim), and the `ratings-fresh` / `challenge-cap` / `share-cap` persona resets.

### 7.10 Removed in this phase (after the parity check)

`WEB/app/api/matchmaking/{create-match-request,match-status,cancel-match-request,cancel-beacon,cleanup}/route.ts`, `WEB/app/api/chess/{create-game,join,cancel-game}/route.ts`, `WEB/app/api/chess/game-by-ref/[gameReferenceId]/route.ts`, `WEB/lib/hooks/useMatchmaking.ts`, `WEB/lib/services/matchmaking/*`, `WEB/app/components/matchmaking/*`, `WEB/app/queue/page.tsx` + `layout.tsx`, `WEB/app/challenge/new/page.tsx`, `WEB/app/join/[gameReferenceId]/*`, `WEB/app/play/ShareLinkModal.tsx`, `WEB/app/play/layout.tsx`, `WEB/features/play/legacy/LegacyPlayPage.tsx`, the k6 `matchmaking.ts` and `quick-match.ts` scenarios. Each deletion is checked with a repo grep for the path and its imports (§15). All of them land in one PR, merged last in the phase, so a single revert restores them (§14.3).

### 7.11 Third-party additions

- `uqr` (unjs, MIT; pin an exact version at install and record the licence in `WEB/THIRD_PARTY.md`) for the QR SVG, dynamically imported on the share page only (≈ 5 kB gzip). If P1 adds the licence gate (`license-checker --failOn "AGPL;GPL"`, feasibility LIC-4), `uqr` passes it.
- The Glicko-2 test vectors come from a permissively licensed Python implementation run offline; its name, version and licence are written in the fixture's header (§12.7). No code is copied from it, and no AGPL source (lila) is consulted (§8.6).
- No new Clerk, Dodo, PostHog or Sentry configuration. The Clerk dev instance already accepts relative `redirect_url` paths.

---

## 8. Domain logic

All pure logic lives in `PKG/game-core` (no I/O, unit-tested, used by the socket, the web server and the browser). Use cases that touch the database live in `PKG/domain` (created by WP-A: `package.json` with `"name": "@repo/domain"`, `"exports": {"./play": …, "./ratings": …, "./shares": …, "./prefs": …}`, `tsconfig.json`, an `import "server-only"` guard on every entry, and `@repo/domain` added to `WEB/next.config.js` `transpilePackages`) and take a `db` or `tx`. Single-statement live-game writes that the socket runs from Mumbai live in `PKG/db/src/live/*` next to P2's.

### 8.1 Time control → pool (P2's `PKG/game-core/src/rules/timeClass.ts`)

P9 adds no second classifier (R20). P2's rule: `estimated = initial + 40 × increment`; `BULLET < 180 ≤ BLITZ < 480 ≤ RAPID < 1500 ≤ CLASSICAL`, and `poolOf()` maps `CLASSICAL` to the **Rapid** pool (the design groups 30+0 under Rapid). P9 adds, only if P2 did not ship them:

```ts
export const TC_PRESETS = { "1+0": [60, 0], "2+1": [120, 1], "3+0": [180, 0], "3+2": [180, 2], "5+0": [300, 0],
  "5+3": [300, 3], "10+0": [600, 0], "15+10": [900, 10], "30+0": [1800, 0] } as const;
export const presetLabel = (p: TcPreset) => ({ label: p, long: longLabel(TC_PRESETS[p]) }); // "5 min + 3 s per move"; "1 min per side"
```

So the design's grouping holds: 1+0, 2+1 Bullet; 3+0, 3+2, 5+0, 5+3 Blitz; 10+0, 15+10, 30+0 Rapid. **Stored `games.timeClass` and the rating pool can differ**: a 30+0 game is stored `CLASSICAL` (P2) and rated in `RAPID`. Every P9 query that filters a pool uses `poolOf(timeClass)` in TypeScript or `"timeClass" IN ('RAPID','CLASSICAL')` in SQL for the Rapid pool (P10's rating chart must do the same).

### 8.2 Matchmaking (`PKG/game-core/src/matchmaking/pairing.ts` + `WS/src/queue/Matchmaker.ts`)

**8.2.1 Constants** (`PKG/game-core/src/matchmaking/config.ts`; the `fast` column is P2's `TIMING_PROFILE=fast`, test only)

| Constant | Value | `fast` | Source |
|---|---|---|---|
| `RANGE_TIGHT` | ±100 | ±100 | `V3Queue` logic: "1084–1284 · ±100" |
| `RANGE_WIDE` | ±200 | ±200 | `V3Queue`: "984–1384 · ±200" |
| `WIDEN_AT_MS` | 20 000 | 2 000 | `V3Queue` logic (`el >= 20` → widened) |
| `MERGE_PRESETS_AT_MS` | 20 000 (`null` = off) | 2 000 | owner decision D20 (default on), feasibility K1/D1 |
| `TIMEOUT_MS` | 60 000 | 6 000 | `V3Queue` (`el >= 60` → timeout), "Searched for 1:00" |
| `TICK_MS` | 1 000, only while a bucket is non-empty | 250 | inv-play-a §2.3 |
| `DISCONNECT_GRACE_MS` | 3 000 | 1 000 | reloads keep the entry |
| `RECENT_OPPONENT_MS` | 60 000 | 6 000 | avoid instant re-pairing after a game |
| `JOIN_RATE` | 1 `queue:join` per 2 s per user | same | api-design §2.10 layer 3 |
| `ABORT_LIMIT` | 3 aborts or no-shows in 10 min → queue refused for 5 min | same | inv-play-a §4.5; P2 records aborts in `meta` |
| `MATCH_COUNTDOWN_MS` | 3 000 | 1 000 | `V3MatchFound` ("Study phase starts in 3") |
| `ONLINE_JOIN_WINDOW_MS` | 15 000 after `startsAt` | 3 000 | inv-play-a §7.4 |
| `CREATE_RETRIES` | 3 failed creations for the same pair → both get `error` (transient Neon errors do not count, §7.5) | same | — |

**8.2.2 Buckets, presets and merging.** Entries live in one bucket per time class and start: key `"{ns}{group}:std"` for the standard start and `"{ns}{group}:legend:{slug}"` for the legend start, where `group` is `bullet`, `blitz` or `rapid` (`poolOf` of the preset), `slug` is the position of the day at join time (§8.3), and `ns` is the `e2eRun` prefix in test (§7.3), else empty. Two entries can pair when:

1. they have the **same preset** (5+3 with 5+3): at any time; or
2. they have **different presets of the same group** (5+3 with 3+2) and **both** have waited at least `MERGE_PRESETS_AT_MS`. The game uses the preset of the entry that joined first (entries are visited oldest first, so that is always `a` below), and both players see "Matched on your opponent's time control" when it is not theirs (§4.3).

Different groups never pair (a Bullet and a Blitz player never meet), and legend and standard buckets never mix (they are different games). Including the slug means two players who joined either side of the UTC day rollover are never paired on a position only one of them previewed. With merging the 18 preset × start combinations collapse to at most 6 buckets after 20 s, and to 3 when `online-legend-pool` is off (feasibility K1).

**8.2.3 Entry.** `{ userRef, socketId, name, initials, avatarUrl, rating, rd, games, provisional, preset, group, color: "w"|"b"|"random", joinedAt, widenedSent, connected, disconnectedAt, pairing, failures }`. One entry per user across all buckets: a join from another socket replaces it and sends `queue:moved` to the old socket.

**8.2.4 Tick** (per non-empty bucket; also run once for the bucket on every join):

```ts
function tick(bucket: Entry[], now: number, cfg: QueueConfig,
              deps: { recentlyPlayed(a: Entry, b: Entry): number | null; isBlocked(a: Entry, b: Entry): boolean }) {
  const waited = (e: Entry) => now - e.joinedAt;
  const range = (e: Entry) => (waited(e) < cfg.WIDEN_AT_MS ? cfg.RANGE_TIGHT : cfg.RANGE_WIDE);
  const canMerge = (e: Entry) => cfg.MERGE_PRESETS_AT_MS !== null && waited(e) >= cfg.MERGE_PRESETS_AT_MS;
  const out: Effect[] = [];
  for (const e of bucket) {                                         // 1. timeouts and widening notices
    if (waited(e) >= cfg.TIMEOUT_MS) out.push({ kind: "timeout", e, searchedMs: waited(e) });
    else if (!e.widenedSent && waited(e) >= cfg.WIDEN_AT_MS) out.push({ kind: "widened", e, range: cfg.RANGE_WIDE, merged: canMerge(e) });
  }
  const live = bucket.filter((e) => e.connected && !e.pairing && waited(e) < cfg.TIMEOUT_MS)
                     .sort((a, b) => a.joinedAt - b.joinedAt);      // 2. oldest first: fairness
  const taken = new Set<string>();
  for (const a of live) {
    if (taken.has(a.userRef)) continue;
    let best: { b: Entry; gap: number; same: boolean } | null = null;
    for (const b of live) {
      if (b.userRef === a.userRef || taken.has(b.userRef)) continue;
      const same = a.preset === b.preset;
      if (!same && !(canMerge(a) && canMerge(b))) continue;         // presets merge only when both have waited
      if (!colorsCompatible(a.color, b.color)) continue;            // w+w and b+b never pair
      const gap = Math.abs(a.rating - b.rating);
      if (gap > Math.min(range(a), range(b))) continue;             // mutual acceptance
      const last = deps.recentlyPlayed(a, b);                       // ms since their last game ended, or null
      if (last !== null && last < cfg.RECENT_OPPONENT_MS && (waited(a) < cfg.WIDEN_AT_MS || waited(b) < cfg.WIDEN_AT_MS)) continue;
      if (deps.isBlocked(a, b)) continue;                           // P10 hook; false until then
      const better = !best || (same && !best.same)
        || (same === best.same && (gap < best.gap || (gap === best.gap && b.joinedAt < best.b.joinedAt)));
      if (better) best = { b, gap, same };                          // same preset first, then the closest rating, then the longest wait
    }
    if (best) {
      taken.add(a.userRef); taken.add(best.b.userRef);
      out.push({ kind: "pair", a, b: best.b, preset: a.preset, merged: !best.same });
    }
  }
  return out;
}
```

The cost is O(n²) per bucket; buckets hold a handful of entries (n < 50 → < 0.2 ms). If any bucket passes 500 entries the tick switches to a rating-sorted window scan (a documented follow-up; not needed at this scale).

**8.2.5 On a pair.**

1. Mark both entries `pairing = true` (no other tick can take them).
2. Colours (§8.4), `ref = createId()` (cuid2, the game's `referenceId`), `startsAt = now + MATCH_COUNTDOWN_MS`.
3. `createMatchedGame()` (§8.2.7) with an 8 s budget.
4. Success → remove both entries; emit `queue:matched` to `ROOM.user(a)` and `ROOM.user(b)`; create the in-memory session with both `PlayerView`s and ratings from the entries (the first `game:join` needs no read); PostHog server event `queue_matched`; Sentry metric `ws.match_create_ms`. `recentOpponent[a,b]` is recorded when the game ends (finish hook).
5. Failure → `pairing = false`, `failures += 1` (transient Neon errors are retried once first and not counted); at 3 → both get `error` (internal) and leave the bucket; Sentry `captureException` with tag `bucket`.

**8.2.6 Study start and no-shows for online games** (edit to P2's `PKG/game-core/src/machine/reduce.ts` and `machine/timers.ts`). The game is created with `phase = 'WAITING'`, `meta.notBefore = startsAt` and `"phaseEndsAt" = startsAt + ONLINE_JOIN_WINDOW_MS`. Transition T1 (`waiting → study` or `first_move`) gains the guard `notBefore === undefined || now ≥ notBefore`; when both sides are online early, the reducer arms `timer(start)` at `notBefore`. A new timer kind `no_show` is armed at `phaseEndsAt`: if it fires while `phase = waiting` and a side has never attached, the game ends `aborted` (winner null, `meta.abortedBy = "no_show"`, effect `abortPersist`: P2's `abort.ts`, so no stats and no ratings), `game:ended` carries `abortReason: "no_show"`, and the absent player's abort counter increases by one. Restore re-arms both timers from the row. Friend games keep P2's rule (no `notBefore`; study when both are in; the 10-minute waiting eviction).

**8.2.7 Game creation statement** (`PKG/db/src/live/createMatchedGame.ts`; one statement, so one round trip from Mumbai, about 200 ms). It follows P2's `createRematch` pattern so `games` and both `game_players` rows appear atomically:

```sql
WITH cap AS (
  SELECT count(*)::int AS n FROM game_players
  WHERE "userId" = $whiteId AND "opponentUserId" = $blackId AND rated
    AND result IN ('WIN','LOSS','DRAW') AND "endedAt" > now() - interval '24 hours'      -- game_players_h2h_idx
), ng AS (
  INSERT INTO games ("referenceId", mode, rated, "timeClass", "whitePlayerId", "blackPlayerId", "creatorId", "opponentId",
                     "startingFen", fen, "startPly", "studySeconds", "chessPositionId",
                     "initialTimeSeconds", "incrementSeconds", "creatorTimeRemaining", "opponentTimeRemaining",
                     "whiteTimeMs", "blackTimeMs", status, phase, "phaseEndsAt",
                     "whiteName", "blackName", "whiteRating", "blackRating", meta,
                     "startedAt", "lastMoveAt", "expiresAt", "createdAt", "updatedAt")
  SELECT $ref, 'ONLINE', $ratedEligible AND (SELECT n FROM cap) < 3, $timeClass::"TimeClass", $whiteId, $blackId, $whiteId, $blackId,
         $fen, $fen, $startPly, $studySeconds, $positionId,
         $initial, $inc, $initial, $initial,
         $initial * 1000, $initial * 1000, 'IN_PROGRESS', 'WAITING'::"LivePhase", $joinDeadline,
         $wName, $bName, $wRating, $bRating, $meta::jsonb,
         now(), now(), now() + interval '24 hours', now(), now()
  ON CONFLICT ("referenceId") DO NOTHING
  RETURNING id, rated, "whitePlayerId", "blackPlayerId"
)
INSERT INTO game_players ("gameId", "userId", color, mode, "timeClass", rated, "opponentUserId", "opponentName",
                          "opponentRating", "ratingBefore", source, "createdAt", "updatedAt")
SELECT ng.id, x.uid, x.color, 'ONLINE', $timeClass::"TimeClass", ng.rated, x.opp, x."oppName", x."oppRating", x."myRating",
       'REPLAY', now(), now()
FROM ng CROSS JOIN LATERAL (VALUES (ng."whitePlayerId", 'w', ng."blackPlayerId", $bName, $bRating, $wRating),
                                   (ng."blackPlayerId", 'b', ng."whitePlayerId", $wName, $wRating, $bRating))
     AS x(uid, color, opp, "oppName", "oppRating", "myRating")
RETURNING "gameId", rated;
-- 0 rows → the ref already exists (a retry after a lost response): SELECT id, rated FROM games WHERE "referenceId" = $ref
```

Column names are the ones P2 shipped (R6, R17, R22). The legacy `NOT NULL` columns (`creatorId`, `creatorTimeRemaining`, `opponentTimeRemaining`) are still filled because legacy readers use them until C1; `expiresAt` stays `NOT NULL` (consistency R-01), so it is set; `updatedAt` is explicit because raw SQL bypasses Prisma's `@updatedAt`. `$wRating`/`$bRating` are the rounded pool ratings, written to both the display columns and `ratingBefore`. `$meta` = `GameMetaV1` with `header`, `prefixSan`, `prefixStartMoveNo` and `position` from the `LEGEND_POOL` entry (empty for the standard start), `source: "queue"` and `notBefore`. `studySeconds = startFen ≠ initial ? 30 : 0` (P2 rule). The socket role `replay_realtime` already has `INSERT` on both tables (P2 §6.7).

### 8.3 Position of the day and the legend pool (`PKG/game-core/src/matchmaking/position-of-day.ts`, `legend-pool.ts`)

- `LEGEND_POOL` is a generated, committed TypeScript array: `{ slug, fen, name, event, year, sideToMove, afterLabel, startPly, header, prefixSan, prefixStartMoveNo, legendSide, balanceCp }[]`. It is built by `WEB/scripts/build-legend-pool.ts` from P8's verified practice positions (`"practiceOrder" IS NOT NULL AND "verifiedAt" IS NOT NULL`, read through P8's `getPositionForPlay(slug)`), each evaluated once with local Stockfish 18 at depth 24 on the owner's laptop (`balanceCp` from White's side). Only positions with |`balanceCp`| ≤ 150 are kept (D6). The script fails if fewer than 3 remain; then the Online tab hides "Legend Position" and the bucket key falls back to the standard start.
- `positionOfTheDay(now) = LEGEND_POOL[fnv1a32("rc-pod:" + now.toISOString().slice(0, 10)) % LEGEND_POOL.length]` (UTC day). Everyone in every legend bucket studies the same position that day, so liquidity is not split by position (inv-play-a Q7 default).
- The hub's Online preview, the queue's board and the `queue:join` ack all call the same function, so the preview never disagrees with the game.
- The pool file is data, not code: it is regenerated whenever P8 adds or re-verifies practice positions (P12's admin "verify" flow calls the script). A redeploy of web and socket ships it.

### 8.4 Colour assignment

```ts
export const colorsCompatible = (a: Pref, b: Pref) => !(a === "w" && b === "w") && !(a === "b" && b === "b");
export function assignColors(a: Entry, b: Entry, hist: ColorHistory, ref: string): { white: Entry; black: Entry } {
  if (a.color === "w" || b.color === "b") return { white: a, black: b };
  if (a.color === "b" || b.color === "w") return { white: b, black: a };
  const ba = hist.balance(a.userRef), bb = hist.balance(b.userRef); // whites − blacks over the last 10 rated games
  if (ba !== bb) return ba < bb ? { white: a, black: b } : { white: b, black: a };
  return (fnv1a32(ref) & 1) === 0 ? { white: a, black: b } : { white: b, black: a };
}
```

`ColorHistory` is in memory on the socket (fed by game starts; lost on restart, which is acceptable). Friend challenges: `white`/`black` are honoured; `random` is a coin flip at accept (`crypto.randomInt(2)`).

### 8.5 Which games are rated (`PKG/game-core/src/rating/rules.ts`)

A game is rated when **all** of these hold:

1. `mode` is `ONLINE`, or `FRIEND` with `challenge.rated = true` (D1), or `TOURNAMENT` (P12).
2. Both sides are human members, and they are different users.
3. The start is the standard position, or a `LEGEND_POOL` position (balanced, §8.3). Shared positions and unbalanced legend positions are always casual.
4. The pool is BULLET, BLITZ or RAPID (CLASSICAL-stored 30+0 games are rated in RAPID, §8.1).
5. The pair has finished fewer than 3 rated, non-aborted games in the last 24 h (`game_players_h2h_idx`; inv-play-a Q14, D9). The 4th and later are casual and the header says "casual". Aborted games do not count, so a no-show cannot use up a pair's rated games.
6. At the end: the game was not aborted. P2's machine already guarantees that a `COMPLETED` game reached `playing` (ply ≥ 2): first-move timeouts, aborts and no-shows go through `abort.ts`, which never touches ratings.

Rules 1–5 are decided at creation and stored in `Game.rated` and `GamePlayer.rated`. Rule 6 is structural. Bot and legend-practice games (`BOT`, `LEGEND_BOT`) are never rated (API-17).

### 8.6 Glicko-2 (`PKG/game-core/src/rating/glicko2.ts` from P5, preset `GAME` in `rating/presets.ts`)

Glickman, "Example of the Glicko-2 system" (2012). Each rated game is one rating period with one opponent. Both players are updated from the **pre-game** values of the other. P5 owns the module and its update formula; P9 adds the `GAME` preset and the handicap and inactivity helpers around it (R23). **Clean-room rule** (feasibility LIC-4): the constants below come from Glickman's paper or are our own documented choices; nobody working on WP-B opens lila or any other AGPL rating code, and `PKG/game-core/src/rating/CLEANROOM.md` lists the sources used.

```ts
// PKG/game-core/src/rating/presets.ts (P5 creates PUZZLE; P9 adds GAME)
export const GAME: GlickoConfig & GameRatingExtras = {   // P5's GlickoConfig = { tau, rdFloor, rdCeil, sigmaMax }
  tau: 0.75,           // inside Glickman's recommended 0.3–1.2; higher than PUZZLE's 0.5 so volatility follows members who improve quickly while training
  rdFloor: 45, rdCeil: 350, sigmaMax: 0.1,
  idlePeriodDays: 7,   // inactivity: one rating period per 7 idle days (read by P9's inflateForIdle, not by P5's update)
  clamp: [100, 3200],  // read by P9's updateAfterGame wrapper
};
```

| Constant | Value | Source / note |
|---|---|---|
| Scale `q` | 173.7178 | Glickman |
| Defaults r / RD / σ | 1500 / 350 / 0.06 | Glickman; data-model `PlayerRating` defaults |
| τ (system constant) | 0.75 | our choice inside Glickman's range 0.3–1.2 (P5 rev 2 expects this value for `GAME`); `PUZZLE` keeps 0.5 |
| ε (convergence) | 1e-6 | Glickman |
| RD floor / ceiling | 45 / 350 | ours: the floor keeps a frequent player's rating responsive (P5 uses 50 for puzzles); the ceiling is the default RD |
| σ ceiling | 0.1 | ours: one upset streak cannot make a rating jumpy |
| Inactivity | one rating period per 7 idle days | ours: a player at RD 45 idle for a year returns at RD ≈ 88, idle for three years at ≈ 138 |
| Rating clamp | 100 … 3200 | ours |
| Provisional | `games < 5` | allocation P9; inv-acct profile spec ("provisional rating (< 5 games): show `1184?`") |

Algorithm, for a player (r, RD, σ, games, updatedAt) against one opponent (rⱼ, RDⱼ) with score s ∈ {1, ½, 0}:

0. **Inactivity** (`inflateForIdle`, P9). If `games > 0`: t = max(0, days since `updatedAt`) / 7; φ = min(√(φ² + t·σ²), 350/q). Seed rows (`games = 0`) are not inflated.
1. μ = (r − 1500)/q, φ = RD/q; μⱼ, φⱼ likewise.
2. g(φⱼ) = 1 / √(1 + 3φⱼ²/π²).
3. E = 1 / (1 + exp(−g(φⱼ)·(μ − μⱼ))).
4. v = 1 / (g(φⱼ)²·E·(1 − E)).
5. Δ = v·g(φⱼ)·(s − E).
6. New volatility σ′ by the Illinois iteration (Glickman step 5): a = ln σ²; f(x) = eˣ(Δ² − φ² − v − eˣ) / (2(φ² + v + eˣ)²) − (x − a)/τ². A = a; if Δ² > φ² + v then B = ln(Δ² − φ² − v), else k = 1, while f(a − kτ) < 0: k += 1, then B = a − kτ. f_A = f(A), f_B = f(B). While |B − A| > ε: C = A + (A − B)·f_A/(f_B − f_A); f_C = f(C); if f_C·f_B ≤ 0 then A = B, f_A = f_B, else f_A = f_A/2; B = C, f_B = f_C. σ′ = min(e^(A/2), σmax).
7. φ* = √(φ² + σ′²).
8. φ′ = 1 / √(1/φ*² + 1/v); μ′ = μ + φ′²·g(φⱼ)·(s − E).
9. r′ = clamp(q·μ′ + 1500, 100, 3200); RD′ = clamp(q·φ′, 45, 350).
10. `games += 1`; `peak = max(peak, round(r′))` (set `peakAt` when it changes).

**Position handicap** (legend positions only, `handicap.ts`). The pool's `balanceCp` (White's view) becomes an equivalent rating edge with the win-percent curve from the research notes (`REPO/research_notes/…/implementation.md` line 8: `winningChances(cp) = 2/(1 + exp(−0.00368208·cp)) − 1`, cp clamped to ±1000): p = 0.5 + 0.5·winningChances(cp); edgeElo = 400·log₁₀(p / (1 − p)), clamped to ±300, positive for the side the position favours. It is applied by **shifting the opponent's rating** passed to the P5 module: `rⱼ′ = rⱼ − edgeElo(mySide)`. That is exactly the E = 1/(1 + exp(−g(φⱼ)(μ + h − μⱼ))) form with h = edgeElo/q, and it needs no change to P5's formula. Examples: 100 cp → p ≈ 0.591 → +64 Elo; 150 cp → p ≈ 0.635 → +96 Elo. Winning a favourable position earns fewer points; with |balanceCp| ≤ 150 the edge is at most ≈ ±96 Elo.

**Reference vector** (Glickman's example, τ = 0.5, three games in one period; the unit-test oracle for the shared module, run with a test config `{...GAME, tau: 0.5}` so the `GAME` code path is the one checked): r = 1500, RD = 200, σ = 0.06 vs (1400, 30) win, (1550, 100) loss, (1700, 300) loss → v = 1.7785, Δ = −0.4834, σ′ = 0.05999, r′ = 1464.06, RD′ = 151.52. P9's production path is `updateAfterGame(player, opponent, score, edgeElo, GAME)` (one game, handicap applied).

**Write in the finish statement** (P2's `PKG/db/src/live/finish.ts`, named fragments; P9 adds two pieces, present only when the game is `rated`):

1. **`gp` SET extension.** P2's `gp` fragment (`UPDATE game_players p SET result, "endedAt" … FROM g`) gains `"ratingAfter" = CASE p.color WHEN 'w' THEN $wAfter ELSE $bAfter END, "ratingDelta" = CASE p.color WHEN 'w' THEN $wDelta ELSE $bDelta END`. This has to be an extension of P2's SET list, not a second CTE: two data-modifying CTEs may not update the same `game_players` row in one statement (Postgres applies only one of them). `ratingBefore` was written at creation.
2. **`pr` fragment:**

```sql
, pr AS (
  INSERT INTO player_ratings ("userId", pool, rating, rd, volatility, games, peak, "peakAt", "seededFrom", "seedRating", "seedRd", "updatedAt")
  SELECT v.uid, $pool::"TimeClass", v.r, v.rd, v.vol, v.games, v.peak, v."peakAt", v.seed, v."seedR", v."seedRd", $endedAt
  FROM g CROSS JOIN (VALUES ($wId::bigint, $wR::real, $wRd::real, $wVol::real, $wGames::int, $wPeak::smallint, $wPeakAt::timestamp, $wSeed::varchar, $wSeedR::real, $wSeedRd::real),
                            ($bId,         $bR,       $bRd,       $bVol,       $bGames,     $bPeak,           $bPeakAt,            $bSeed,          $bSeedR,       $bSeedRd))
       AS v(uid, r, rd, vol, games, peak, "peakAt", seed, "seedR", "seedRd")
  ON CONFLICT ("userId", pool) DO UPDATE
     SET rating = EXCLUDED.rating, rd = EXCLUDED.rd, volatility = EXCLUDED.volatility, games = EXCLUDED.games,
         peak = GREATEST(COALESCE(player_ratings.peak, 0), EXCLUDED.peak),
         "peakAt" = CASE WHEN EXCLUDED.peak > COALESCE(player_ratings.peak, 0) THEN EXCLUDED."peakAt" ELSE player_ratings."peakAt" END,
         "updatedAt" = EXCLUDED."updatedAt"                              -- seededFrom, seedRating, seedRd are never overwritten
   WHERE player_ratings.games = EXCLUDED.games - 1                       -- optimistic guard: the values the socket computed from are current
  RETURNING "userId"
)
```

`FROM g` means the fragment inserts nothing when the game was already finished (a retried finish), so ratings are applied exactly once. The final `SELECT` of the statement adds `(SELECT count(*) FROM pr)::int AS rated_rows`. The socket computes the new values from the ratings it holds for both players (loaded at game creation or session load). `rated_rows < 2` means a concurrent change (practically impossible: one live rated game per user, enforced at `queue:join` and accept, and by P12 for tournaments): the socket then runs `repairRatings(db, gameId)` (`PKG/db/src/live/repairRatings.ts`, one interactive transaction: `SELECT … FROM player_ratings WHERE "userId" = ANY($ids) AND pool = $pool FOR UPDATE`, recompute from those rows, `UPDATE player_ratings …`, `UPDATE game_players SET "ratingBefore", "ratingAfter", "ratingDelta" WHERE "gameId" = $g`), counts `ratings.guard_retry` and only then emits `game:result`. If the repair fails too, `game:result.ratings` is sent as `null` and the recompute tool (§6.10) is the fix.

If P2 or P3 add a `users."gamesVersion"` bump to the finish (api-perf AP-19), the rating write sits in the same statement, so archive ETags change with it.

### 8.7 Seeding (`PKG/game-core/src/rating/seed.ts`, `PKG/domain/src/ratings/seedPlayerRatings.ts`)

Per pool, the first matching rule wins. Inputs: P4's `RatingsV1` (`{v, bullet?, blitz?, rapid?, daily?, classical?: {rating, best, games}}`) of each linked account, and P4's onboarding level.

| Source (P4 data) | Seed rating | RD | `seededFrom` |
|---|---|---|---|
| Chess.com linked, ≥ 10 games in that pool | the Chess.com pool rating | 200 | `chesscom` |
| Chess.com linked, 1–9 games in that pool | the Chess.com pool rating | 250 | `chesscom` |
| Lichess linked, ≥ 1 game in that pool | Lichess rating − offset (Bullet 250, Blitz 200, Rapid 150; D8, recalibrated after 4 weeks of data) | 250 | `lichess` |
| Onboarding level (`User.initialRating`, else the midpoint of `ratingBand`: NEW_TO_CHESS 600, UNDER_800 700, R800_1200 1000, R1200_1600 1400, R1600_2000 1800, R2000_PLUS 2100, the same table as P5) | that value | 300 | `self` |
| Nothing known | 1500 | 350 | null (no row written; the defaults apply in code) |

Clamp 400 … 2800. Chess.com is preferred because the product's import, copy and users centre on it. Seed rows are written with `games = 0`, `seedRating = rating`, `seedRd = rd` by the backfill (§6.6) and by P4's link and onboarding steps; they are never inflated for inactivity, and a later seed never overwrites an existing row. The socket token carries the effective value per pool (row or rule), so pairing works before any rated game.

### 8.8 Display, provisional and stakes

- Display `round(rating)`; provisional (`games < 5`) appends "?" ("1184?"). Delta format "(+8)", "(−8)" with U+2212, "(0)" for no change; the line is "Blitz 1184 → 1192 (+8)" (`V3Game` result card copy).
- Headline pool (shell, Home): the pool with the most rated games; ties → Blitz; no rows and no seed → hidden.
- **Stakes** (`PKG/game-core/src/rating/stakes.ts`): when the session starts (both sides attached), the socket computes, for each side, `win/draw/loss = round(updateAfterGame(me, opp, s, edge, GAME).rating) − round(me.rating)` for s = 1, ½, 0, using the same function as the finish, so the resign confirm's "lose about 8 rating points" matches the result exactly. Casual games: `stakes = null`.

### 8.9 Challenge codes and lifecycle

- **Challenge code** (`PKG/game-core/src/codes/challenge.ts`): 5 random bytes from `crypto.getRandomValues` (40 bits) → 8 Crockford base32 characters from `0123456789ABCDEFGHJKMNPQRSTVWXYZ`. Insert retries on a unique violation up to 3 times. The design's 4-character `/join/8KQ2` is guessable (inv-play-a Q1); 8 characters at 60 requests a minute per IP would take about 35,000 years to sweep.
- **Share code**: P3's generator (8 lower-case Crockford characters, `shares.code`), unchanged (R25).
- `normaliseCode(kind, input)` (`PKG/game-core/src/codes/normalise.ts`): strip `-` and spaces; map `O → 0`, `I`/`L → 1`; upper-case for `challenge`, lower-case for `share`; reject `U` and any length ≠ 8.
- **Lifecycle** (`PKG/domain/src/play/challengeState.ts`):

```
            create (CHL-1; the 6th open link auto-cancels the oldest)
                 │
               OPEN ──accept (CHL-3)──► ACCEPTED (gameId set) ──(game plays out)
                 │ ├──creator DELETE (CHL-5)──► CANCELLED
                 │ ├──decline (CHL-4)──► stays OPEN, declinedAt set   [D3 = "closes" → DECLINED]
                 │ └──now ≥ expiresAt──► EXPIRED (derived on read and accept; written by the daily HOUSEKEEPING slice)
                 └──creator account deleted──► row deleted (Cascade)
```

- **Accept use case** (`acceptChallenge(tx, viewer, code)`, one interactive transaction on Vercel next to Neon, `{ maxWait: 2000, timeout: 5000 }`): (1) the conditional `UPDATE … RETURNING` from §6.4; 0 rows → re-read and map: missing → 404; `creatorId = me` → 409 `own_link`; `ACCEPTED` and `acceptedById = me` → 200 with the stored `gameRef` (replay); `ACCEPTED` → 409 `already_started` + `gameRef`; `CANCELLED`/`DECLINED` → 410; OPEN but expired → 410 `expired`. (2) The creator must still be entitled (`entitlementOf(creator)`), else roll back → 410 `creator_unavailable`. (3) If the challenge is rated-eligible and either player has a live rated game (`games_open_idx`) → roll back → 409 `already_in_game`. (4) Resolve colours. (5) Insert the game through P2's `createLiveGame(tx, { mode: "FRIEND", white, black, … })` (`PKG/db/src/games/createLiveGame.ts`): both sides at once, `IN_PROGRESS`, phase `WAITING`, `rated` per §8.5 with the pair cap, `timeClass`, `startingFen = startFen`, `startPly`, `chessPositionId` and `meta` (`source: "challenge"`, header and prefix from P8's `getPositionForPlay`) for legend starts, both `GamePlayer` rows with `ratingBefore` = pool ratings. (6) `UPDATE challenges SET "gameId" = $g`. Commit. `after()`: `internalFetch` emit `challenge:accepted`, `revalidateTag('challenge:' + code)` + `invalidateByTag('challenge:' + code)`, PostHog `challenge_accepted`.
- **Create use case** (`createChallenge`): resolve the start (standard; P8 position by slug → its FEN, `startPly`, hero side; share by code → its FEN, refuse revoked → 404); compute `rated = body.rated && ratedEligible(start)`; run the §6.4 cap statement (durable daily limit, then auto-cancel beyond 5 open links); insert with `expiresAt = now + 24 h`; return the public DTO and `url = appOrigin() + "/join/" + code`.

### 8.10 Shared position rules (`PKG/domain/src/shares/*`)

- **FEN validation**: chess.js `validateFen`, exactly one king per side, the side not to move is not in check, at most 32 pieces → else 422 `illegal_position`.
- **Live-game guard**: `sourceGameRef` must be a game the viewer played (`game_players` PK lookup, else 403), and its status must not be `IN_PROGRESS` (409 `live_game`), so a position cannot be shared to get help during a game.
- **Stored columns** (P3's `Share`): `kind = POSITION`, `fen`, `chessPositionId` (catalogue shares), `gameId`, `ply`, `color` (shares from the viewer's game: kept for the owner's own reference, **never** returned by SP-2), `title`, `subtitle`, `note`, `themes`, `showUsername`, `imageVersion = 1`. `expiresAt` stays null (position shares do not expire).
- **Title and subtitle**: from a practice position → "Kasparov vs Topalov, 1999" / "After 23…Qd6" plus its themes (≤ 4). From the viewer's own game → title "From {displayName}'s game", subtitle "Move {n} · {White|Black} to move"; the opponent's name and the game link are **never** included. From a raw FEN → null / "{White|Black} to move".
- **Note sanitising** (`sanitizeNote.ts`): NFKC normalise; strip control and zero-width characters; collapse whitespace; remove URLs and bare domains (`/(https?:\/\/|www\.)\S+|\b[\w-]+\.(com|net|org|io|gg|tv|me|ly|app|xyz)\b\S*/gi`), e-mail addresses and phone-number-like runs (≥ 8 digits); replace words on a small blocklist (`PKG/contracts/src/moderation/blocklist.ts`) with "…"; trim to 140; empty → null. The note renders as plain text (React escapes; no Markdown).
- `imageVersion` starts at 1; the OG URL carries it, and revoke purges the tag (§7.1), so a revoked share's image is never served again.
- `showUsername` defaults to true; P10 sets it false for private profiles.
- **Revoke**: `UPDATE shares SET "revokedAt" = now() WHERE code = $c AND kind = 'POSITION' AND "ownerId" = $me AND "revokedAt" IS NULL`; `after()`: `revalidateTag('share:' + code)` and `invalidateByTag('share:' + code)` (page data, SP-2 and OG-2 together).

### 8.11 Bot fallback and the strength ladder

- Fallback strength: the hub step (400, 800, 1200, 1600, 2000) nearest the player's pool rating; ties go to the lower step. It maps onto P2's ladder rows (`PKG/game-core/src/bot/strength.ts`, 400…2200 in steps of 200). Colour: the player's queue preference, `random` resolved at random. Position: the same legend position (mode `LEGEND_BOT`, `positionSlug`) or the start (mode `BOT`). Time control: the same preset.
- Captions (design `strCap`): 400 "Learning the moves. Leaves pieces hanging."; 800 "Knows the basics, misses two-move tactics."; 1200 "Knows tactics, slips under pressure. Close to your rating." (the "Close to your rating" clause only when |strength − rating| ≤ 200); 1600 "Solid club player. Punishes loose pieces."; 2000 "Strong. Plays near engine level in sharp positions."
- Personas (only 1200 is designed; the rest are drafts for the owner, D18): 400 "New bot · “I'm still learning how the knight moves.”"; 800 "Casual bot · “I like simple plans. Watch your loose pieces.”"; 1200 "Club bot · “I know my tactics. I get nervous when you attack.”"; 1600 "Strong club bot · “Leave a piece hanging and I'll take it.”"; 2000 "Expert bot · “Bring your best preparation.”"

### 8.12 Bot ladder calibration (P2 handoff H-06, coverage C-15; WP-J)

P2 ships the ladder uncalibrated with the tooltip "≈1400 · strength not yet calibrated". P9 calibrates it, because the hub's strength slider and its "Close to your rating" caption only make sense once the numbers mean something.

- **Harness** `WEB/scripts/calibrate-bots.ts`: Node 22, run on the owner's laptop (never on the OCI boxes, which host the live socket on 1 OCPU). It loads the **same** `stockfish-18-lite-single` WASM build the browser uses (from `public/workers/sf18-<hash>/`), and plays each ladder row with P2's exact settings (`UCI_LimitStrength`/`UCI_Elo` or `Skill Level`, node budget, MultiPV, the weakening layer with its seeded PRNG). Node budgets make strength independent of hardware (P2 §8.13), so a laptop result holds on a phone.
- **Openings**: 50 balanced start positions (`PKG/chess-fixtures/calibration/openings.epd`, |eval| ≤ 50 cp), each played with both colours.
- **Adjudication**: P2's end rules (mate, stalemate, insufficient, threefold, fifty-move); resign when the stronger side's search reports |eval| > 1000 cp for 6 consecutive plies; draw at ply 200.
- **Schedule**: the 9 adjacent pairs (400–600 … 2000–2200) × 200 games, plus three cross-checks (400–800, 800–1200, 1200–1600) × 100 games: ≈ 2,100 games, about 15–25 CPU-hours, so 2–3 hours with 8 worker threads.
- **Fit**: Elo maximum likelihood over all results (draws as half points) with the 1400 row pinned at 1400, so the low rows are placed on Stockfish's own `UCI_Elo` scale, which anchors the rows from 1400 up. Output per row: the estimate and a 95 % interval.
- **Tune**: a row more than 75 points from its shown number gets its knobs adjusted (node budget, weakening share) and only its matches are replayed; at most 3 rounds. A row that still misses after 3 rounds keeps "≈" in its tooltip (per row, not global).
- **Output**: updated rows in `PKG/game-core/src/bot/strength.ts`, `PKG/game-core/src/bot/calibration.json` (`{ build: "sf18-lite-<hash>", date, rows: [{ shown, measured, ci95, games }] }`) and `export const CALIBRATED: Record<number, boolean>`; P2's tooltip reads it.
- **Human check later** (D23): after 4 weeks of P9 data, fit a logistic curve of member score against `pool rating − botElo` from bot games. That is a follow-up, not a P9 gate.
- **Test**: `calibrate-bots.test.ts` runs the pairing, adjudication and fit code against a fake engine with known strength gaps and recovers them within ±20.

---

## 9. Performance and optimisation

### 9.1 Request and database budget per flow (today → after P9)

| Flow | Vercel invocations | Neon statements | Neon compute |
|---|---|---|---|
| Quick match with a 20 s wait | **≈ 25** today: hub (1) + `/queue` (1) + create (1) + 20 status polls + 1–2 spurious cancels (audit-client §8.1) + game (1). **3** after: hub RSC + `/play/online` RSC (often prefetched on hover) + game RSC | **≈ 150** today: ≈ 7 per poll second (audit-db §8.5) + 6–10 for the create. **1** after: the `createMatchedGame` CTE (+ P2's finish later, which carries the rating fragment at no extra statement); +1 only on a cold rating cache with a claims-only token (§7.7) | Today: never idles while anyone searches (DB-05). After: idle during the search |
| Friend challenge, both members | ≈ 7 today (create, join page, `game-by-ref`, join, 2 game pages, cancel on unmount). **6** after: create, share RSC, accept RSC, accept POST, 2 game RSC; no polling | create: 4 (idempotency insert, cap statement, insert, idempotency update); accept: 5 in one transaction | woken only by user actions |
| Link preview fetched 3–5 times by chat apps | 3–5 client-page loads today, generic OG text. After: 3–5 RSC renders with a **data-cache hit (0 DB)**, plus one OG render per challenge, then CDN hits | 1 per 10 s per code at most | negligible |
| Shared position view | 1 RSC; data-cache hit (tag `share:<code>`, 1 day) | 0 on a hit | — |
| Bot slider / colour / time-control changes | 0 today (not persisted). After: 1 debounced PATCH per burst (500 ms) | 1 upsert | — |
| Home with the rating lines | — | **+0** (two columns on P5's existing read; the headline comes from the viewer read) | — |

Hobby check (allocation §1.5, with api-perf AP-35's formula): invocations per member-day = Vercel usage API `functionInvocations` for the play routes ÷ the number of members who opened `/play` that day (the server event `play_hub_rendered`, sent from `after()` in the hub RSC with only a hashed ref, as api-perf AP-35 proposes; P11's consent rules decide whether it is sent for members who declined analytics; §10.2). A member who quick-matches 10 times a day costs about 30 invocations, against about 600 today.

### 9.2 Hot-path queries and the plans expected

Checked with `EXPLAIN (ANALYZE, BUFFERS)` on the perf branch seeded with `--scale 100` (data-model §13.6) before the phase closes (§15). `scripts/explain-hot-queries.ts` (P1/P3, api-perf §5) gets these queries and fails on a Seq Scan or Sort over `game_players`, and on any index name in §6.4 that `pg_indexes` lacks.

| Query | Expected plan | Target |
|---|---|---|
| `createMatchedGame` CTE (§8.2.7) | `Insert on games`; the cap subquery is an `Index Scan using game_players_h2h_idx` (≤ 5 rows); `ON CONFLICT` on `games_referenceId_key`; `Insert on game_players` (2 rows) | ≤ 3 ms server; ≈ 200 ms from Mumbai |
| Live-game check | `Bitmap Index Scan on games_open_idx` (tens of rows) + filter on players and mode | ≤ 1 ms |
| Accept transaction (5 statements) | `Index Scan using challenges_code_key`; `createLiveGame` inserts; `Index Scan using challenges_pkey` | ≤ 10 ms total on Vercel `iad1` |
| Create challenge (cap statement + insert) | `Index Scan using challenges_creatorId_status_idx` | ≤ 5 ms |
| Public challenge projection | `Index Scan using challenges_code_key` + `users_pkey` + lateral `player_ratings_pkey` (≤ 3 rows) + `games_pkey` + `chess_positions_pkey` | ≤ 2 ms, one round trip |
| Viewer read with ratings | `users` by `googleId` (existing unique) + lateral `player_ratings_pkey` (`relationLoadStrategy: "join"`) | +0.3 ms to `getViewer()`, still one round trip |
| Finish statement with the rating fragment | P2's plan + `Insert on player_ratings` with `ON CONFLICT` on `player_ratings_pkey`; HOT update (fillfactor 90, no indexed column changes) | still 1 statement; ≤ 3 ms server |
| Home "this week" read (P5 h3 + two columns) | `Index Scan using game_players_userId_endedAt_gameId_idx`, ≤ 50 rows | ≤ 1 ms |
| SP-1 daily cap | `Index Scan using shares_owner_created_idx` | ≤ 1 ms |
| Daily expiry | `Index Scan using challenges_open_idx` | ms |

Transactions follow optimization §3 rule 4: no global `prisma` inside a transaction (the DB-11 bug disappears with `matchmaking.service.ts`), interactive transactions only for accept and the never-path `repairRatings` (`maxWait 2000`, `timeout 5000`).

### 9.3 Caching layers per resource (optimization §4.1)

| Resource | L2 CDN | L3 data cache | L4 request memo | L7 client | Invalidation |
|---|---|---|---|---|---|
| Practice positions list (hub) | — | `positionsVolume()` (P8), tag `positions` | yes | not in the query cache (props) | P8 admin writes → `revalidateTag('positions')` |
| Legend search beyond the shipped list | CAT-5 per URL (P8) | P8 | — | `qk.catalog.positions` 5 min | P8 |
| Position of the day | — | — (pure function over a bundled array) | — | — | redeploy |
| Challenge public shape (page, metadata, OG, return target) | CHL-2: `s-maxage=10`, swr 30, tag `challenge:<code>` | `unstable_cache` 10 s, tag `challenge:<code>` | `cache()` shares it between `generateMetadata` and the page | `qk.games.challenge(code)` stale 10 s | accept, decline, cancel → `revalidateTag` + `invalidateByTag` in `after()` |
| Share public shape | SP-2: `s-maxage=3600`, swr 86400, tag `share:<code>` | `unstable_cache` 1 day, tag `share:<code>` | yes | `qk.shares.detail` 5 min | revoke → `revalidateTag` + `invalidateByTag` |
| OG images | CDN 1 year, tags `challenge:<code>,user:<ref>` / `share:<code>` | — | — | browser 1 day (challenge) / 5 min (share) | revoke purges the share tag; P10 purges `user:<ref>` on rename or deletion |
| Preferences | — | — | `cache()` | `qk.prefs()` 5 min; `usePrefs` local-first | PATCH response + `prefs:updated` (skip rule §5.4) |
| Ratings | — | — | in `getViewer()` | in `qk.me()` | `router.refresh()` after a game (visible tab); socket `RatingCache` for pairing |
| Live queue state | — | — | — | `useQueue` reducer | socket events |

Never cached anywhere: accept/decline/cancel responses, `GET /api/socket-token`, queue state, any per-viewer projection of a challenge or share (the viewer-specific bits are computed in the page from the session, outside the cache). No per-user response carries `max-age > 0` (api-perf AP-04).

### 9.4 Payload budgets

| Payload | Budget |
|---|---|
| Hub HTML + RSC payload | ≤ 25 kB gzip (≤ 50 positions × ≈ 160 B card) |
| `queue:join` ack | ≤ 400 B (P2 size-test exception) |
| `queue:matched` | ≤ 300 B (P2 size-test exception; no FEN, no position card, no clock block) |
| other `queue:*` and `challenge:*` events | ≤ 120 B (P2's rule) |
| `GameState` with `stakes` and `provisional` | still ≤ 2 KB at 80 plies (P2's test, re-run with the fields set) |
| `GET /api/challenges/{code}` | ≤ 1.2 kB |
| `GET /api/shared-positions/{code}` | ≤ 1 kB |
| `PATCH /api/me/preferences` response | ≤ 4 kB |
| OG PNG | ≤ 120 kB |

### 9.5 JavaScript budgets (`next build` First Load JS, gzip; CI bundle report from P1 F7, blocking)

| Route | Today | Budget | How |
|---|---|---|---|
| `/play` | 488 kB (audit-client) | **≤ 230 kB** (200 shared + ≤ 30 route) | No chess.js (the static `Board` renders from FEN with P2's FEN parser), no socket.io-client, no engine (engine only prefetched as a hashed file on Bot-tab intent), no `useDataStore` catalogue, no zod in production (`devSchema()`) |
| `/play/online` | `/queue` ≈ 480 kB | ≤ 250 kB | socket.io-client (≈ 16 kB) loaded by the connection manager's dynamic import |
| `/play/friend/[code]` | — | ≤ 240 kB | `uqr` (≈ 5 kB) dynamic on mount |
| `/join/[code]`, `/s/[code]` signed out | — | ≤ 200 kB | No Clerk UI components, no socket, no PostHog before consent, no TanStack Query in the signed-out tree (optimization §5.7 marketing rule, api-perf AP-48) |

CI also asserts `ZodError` does not appear in the `/play*`, `/join` and `/s` chunks (api-perf §5 bundle gate).

### 9.6 Socket server budget (1 OCPU box)

- Memory: a queue entry is ≈ 300 B; 1,000 searchers ≈ 0.3 MB. The rating cache is ≈ 100 B per active user.
- CPU: one 1 s interval only while a bucket is non-empty; each tick is O(n²) per bucket with n < 50 → < 0.2 ms. Target: < 2 % of the core at 200 concurrent searchers; event-loop lag p99 unchanged (≤ 20 ms on the prod box, optimization §2.5).
- No timer per entry (timeouts, widening and merging are computed in the tick).

### 9.7 SLOs and how they are measured

Server-side numbers are the source of truth (api-perf AP-15): PostHog client events depend on analytics consent (P11 D6) and are used for funnels only.

| Metric | Target | Measured by |
|---|---|---|
| `queue:join` ack, server time | p95 ≤ 5 ms | Sentry metric `ws.queue.join_ms` |
| Socket round trip for queue members | p95 ≤ 150 ms India, ≤ 400 ms US | P2's `clock:ping` RTT metric `ws.rtt_ms`, tagged `route=queue` |
| Pair → `queue:matched` emitted (incl. the insert from Mumbai) | p95 ≤ 600 ms | `ws.match_create_ms` |
| `queue:matched` → both players' `game:join` received | p95 ≤ 4 s | `ws.match_to_join_ms` (socket timestamps of the emit and of each `game:join`) |
| Wait to match when ≥ 2 compatible searchers are in a bucket | p50 ≤ 2 s | `ws.queue.wait_ms{outcome="matched"}` |
| `POST /api/challenges`, `…/accept` | W2: p95 ≤ 250 ms server | Sentry span `api` class W2 (route wrapper) |
| `/join/[code]`, `/s/[code]` TTFB (p75) | US ≤ 600 ms, India ≤ 900 ms | Sentry transaction duration for the page; Speed Insights only at its Hobby sample rate (10k events per 30 days per team, feasibility §1) |
| `/play` (board page) | LCP ≤ 2.5 s mobile / 1.8 s desktop; INP ≤ 100 ms; CLS ≤ 0.02 | Speed Insights (sampled); CLS as a lab gate in the Playwright device × zoom suite (field data cannot split by zoom, api-perf AP-35) |
| OG image | first render ≤ 1.5 s; then `x-vercel-cache: HIT` | `curl -sI` in the k6 catalogue check |
| Neon statements while two members search for 60 s | 0 | `pg_stat_statements` delta on the perf branch; Neon monitoring during the owner test |
| Ratings in the finish | +0 statements; `ratings.apply_ms` p95 ≤ 50 ms of added server time | Sentry metric |

### 9.8 Keeping Neon asleep

The search itself is DB-free; the only wake-ups are user actions (create, accept, the match insert), the cold-cache rating read when it replaces the prewarm, and the existing daily `HOUSEKEEPING` run, which P9 joins without adding a wake. An hourly expiry sweeper would have cost 24 wake-ups a day × 5 min minimum active time ≈ 2 h of compute a day at 0.25 CU ≈ 15 CU-h a month (15 % of the Free allowance), which is why expiry is derived on read (R13). P9's k6 and nightly e2e runs start only after dev and E2E moved to their own Neon project (§2.3, api-perf AP-01), so they never spend production's 100 CU-h.

---

## 10. Telemetry

Naming `area_object_verb` snake case (api-design §2.13). Every event below is declared with a closed zod schema in `packages/analytics/src/events/play.ts` (P1's registry, testing X6), and `track(name, props)` is typed against it; specs assert them through P1's sink (§12.0). Client events go through `track()` (consent-gated, no-op when declined); server events go to PostHog from `after()` on Vercel or from `posthog-node` on the socket (batched, flushed on shutdown) with `distinct_id = viewer.ref`. Server events are the source for SLOs and budgets (§9.7); client events serve funnels only. Common properties on every event: `app_env`, `device` (`desktop`, `ipad_l`, `ipad_p`, `phone`), `member_state` (`trial`, `active`, `past_due`). **Never** sent: FENs, PGNs, share notes, challenge codes on client events (use `code_hash` = first 8 hex characters of sha256), emails.

### 10.1 Client events

| Event | Properties | Fired |
|---|---|---|
| `play_hub_viewed` | `tab`, `source` (`nav`, `home`, `game_over`, `deeplink`), `has_live_game` | hub mount |
| `play_tab_changed` | `from`, `to`, `input` (`click`, `key`) | tab change |
| `legend_search` | `q_len`, `results`, `mode` (`local`, `api`) | debounced, on change |
| `play_cta_clicked` | `tab`, `tc`, `pool`, `color`, `position_mode`, `strength`, `rated`, `position_slug` | CTA |
| `play_create_failed` | `tab`, `code` | create error |
| `bot_strength_changed` | `from`, `to`, `surface` (`hub`) | slider commit |
| `queue_joined` | `pool`, `tc`, `position_mode`, `color`, `rating_bucket` (100-wide), `provisional`, `ack_ms` | ack ok |
| `queue_widened` | `elapsed_ms` | `queue:status` |
| `queue_cancelled` | `elapsed_ms`, `state` | Cancel |
| `queue_timeout` | `pool`, `tc` | `queue:timeout` |
| `queue_fallback_bot` | `pool`, `position_mode`, `bot_elo` | Play Against Bot |
| `queue_error` | `code` (`timeout`, `connect`, `already_in_game`, `rate_limited`, `moved`, `internal`) | `error` |
| `match_found_viewed` | `wait_ms`, `rated`, `pool`, `rating_gap` | match found |
| `match_go_clicked_early` | `remaining_ms` | Go to the Board |
| `challenge_created` | `start_from`, `tc`, `color`, `rated_requested`, `rated` | CHL-1 success |
| `challenge_link_copied` / `challenge_shared` | — / `method` (`native`) | Copy / Share |
| `challenge_cancelled` | `elapsed_ms` | Cancel |
| `challenge_expired_seen` | — | `expired` shown |
| `challenge_viewed` | `signed_in`, `member`, `state`, `code_hash` | accept page mount (bots never run JS) |
| `challenge_accept_clicked`, `challenge_declined`, `challenge_signin_clicked`, `challenge_trial_clicked`, `challenge_watch_clicked` | `code_hash` | buttons |
| `shared_position_created` | `from` (`review`, `compare`, `practice`, `legend`), `has_note` | SP-1 success |
| `shared_position_viewed` | `signed_in`, `member`, `is_owner`, `state` | page mount (replaces any view counter, D17) |
| `shared_position_play` | `mode` (`friend`, `bot`) | CTA |
| `shared_position_revoked` | — | Stop Sharing |

### 10.2 Server events

| Event | Properties | Source |
|---|---|---|
| `queue_matched` | `pool`, `tc`, `position_mode`, `wait_ms_a`, `wait_ms_b`, `rating_gap`, `widened`, `rated` | socket |
| `queue_no_show` | `pool` | socket (join window expired) |
| `game_created` | `mode` (`online`, `friend`), `rated`, `pool`, `source` (`queue`, `challenge`) | socket / CHL-3 |
| `challenge_accepted` | `ms_since_created`, `rated`, `start_from`, `signed_up_from_link` (the accepting user was created < 1 h ago) | CHL-3 `after()` |
| `rating_changed` | `pool`, `delta`, `before_bucket`, `provisional`, `games` (one per player) | finish |
| `play_hub_rendered` | `tab`, `has_live_game` (hashed ref only) | hub RSC `after()`; the denominator of the §9.1 budget |
| `ratings_repaired` | `pool` | `repairRatings()` (should never fire) |

### 10.3 Funnels and dashboards (PostHog)

1. **Hub → game**: `play_hub_viewed` → `play_cta_clicked` → `game_joined` (P2) → `game_ended` (P2), split by tab.
2. **Queue health**: `queue_joined` → `queue_matched` vs `queue_timeout`, wait p50/p90 per pool, timeout rate per pool, `queue_fallback_bot` share (the input for the liquidity decision in §14).
3. **Challenge growth loop**: `challenge_created` → `challenge_viewed {signed_in: false}` → `challenge_trial_clicked` → `trial_started` (P4) → `challenge_accepted {signed_up_from_link: true}` → `game_created`.
4. **Shares**: `shared_position_created` → `shared_position_viewed` → `shared_position_play`.

### 10.4 Sentry

- Spans: `play.hub.load` (RSC), `api.challenges.create|accept|decline|cancel`, `api.shares.create|revoke`, `api.prefs.patch` (route wrapper spans, tagged with the class), socket `queue.join`, `queue.tick`, `queue.create_game`, `game.finish.ratings`.
- Metrics: `ws.queue.size{bucket}` (gauge every 10 s while non-empty), `ws.queue.join_ms`, `ws.queue.wait_ms{group,outcome,merged}`, `ws.match_create_ms`, `ws.match_to_join_ms`, `ws.queue.create_failures`, `ws.queue.create_transient` (Neon reconnects, not failures), `ratings.apply_ms`, `ratings.guard_retry` (count of the rare repair path), `api.duration_ms{route}`.
- Alerts: `ws.match_create_ms` p95 > 1,500 ms for 15 min; `ws.queue.create_failures` > 3 in 10 min; any 5xx on CHL-3 for 5 min; `ratings.guard_retry` > 0 in a day (investigate; it should never fire).
- Captured as exceptions: create failures on the socket, accept 5xx, OG render errors. 409/410 outcomes are breadcrumbs, not exceptions. `sendDefaultPii: false`; share notes are never attached.

---

## 11. Security, privacy, paywall and authorisation

### 11.1 Access matrix

| Route / action | Signed out | Signed in, never subscribed | Lapsed | Member | Creator / owner |
|---|---|---|---|---|---|
| `/play`, `/play/online`, `/play/friend/*` | middleware → sign-in | middleware → `/onboarding?redirect_url=…` (not onboarded) or `/pricing?reason=required&redirect_url=…` | `/pricing?reason=ended&redirect_url=…` (B26 default) | yes | `/play/friend/{code}` only for the creator; others → `/join/{code}` |
| `/join/[code]` page | `logged_out` | `paywalled` (trial copy) | `paywalled` (renew copy) | `default` | `own_link` |
| CHL-1 create | 401 | 402 `trial_available` | 402 `trial_used`/`expired` | 201 | — |
| CHL-3 accept | 401 | 402 | 402 | 200 | 409 `own_link` |
| CHL-4 decline | 401 | 204 | 204 | 204 | 409 `own_link` |
| CHL-5 cancel | 401 | 403 unless creator | creator allowed (even lapsed) | creator only | 204 |
| `/s/[code]` page | public preview + trial CTA | `paywalled` (trial copy) | `paywalled` (renew copy) | `default` | owner variant |
| SP-1 create | 401 | 402 | 402 | 201 | — |
| SP-3 revoke | 401 | owner only | owner only (even lapsed) | owner only | 204 |
| ME-3a/b prefs | 401 | yes | yes | yes | — |
| socket `queue:join` | no token | `not_member` | `not_member` | ok | — |
| Spectate a challenge game | — | no | no | yes, through P2's `spectate:join` (FRIEND games are watchable, R21) | — |

Decisions behind it: the invitee must be a member (D2, paid-only Phase 0); decline needs only a session (it changes nothing for the invitee); revoking and cancelling never need membership, because they only remove data.

### 11.2 Threats and controls

| Threat | Control |
|---|---|
| Guessing challenge or share codes | 40-bit CSPRNG codes; edge WAF 60 req/min per IP on `/api/challenges/*`, `/api/shared-positions/*`, `/join/*`, `/s/*` (api-design §2.10 layer 1); public projections contain nothing private |
| Acting on someone else's challenge or share (IDOR) | Ownership checked by viewer id inside the conditional `UPDATE` (`"creatorId" = $me`, `"ownerId" = $me`), never by code alone |
| Socket identity spoofing | Identity only from the verified token `sub` (P2; `SOCKET_AUTH_REQUIRED` removed); no payload carries a user id; every payload zod-validated |
| CSRF on mutations | Same-origin API, Clerk SameSite=Lax cookie, middleware `Origin` check on non-GET (api-design §2.11.7) |
| XSS through notes or names | Plain-text rendering (React escaping); notes sanitised (§8.10); OG images render text only, with length limits |
| Open redirect through `redirect_url` | `safeReturnPath()` allow-list (`/join/`, `/s/` added); off-list values are ignored, never echoed |
| Injection through the `opponent` hint | Pattern-checked (`/^@?[A-Za-z0-9_]{3,20}$/`), rendered as plain text, never sent to the server, never persisted; anything else is dropped |
| Rating farming and sandbagging | Rated-pair cap (3 finished games per 24 h); aborts and no-shows never rated, not counted in the cap, but counted toward the abort limit; bot games unrated; one live rated game per user. Deliberate losing on an alt account is out of scope (needs moderation, P12) |
| Queue flooding | `queue:join` 1 per 2 s; per-socket token bucket (P2); one entry per user |
| Challenge spam | `challenge-create` 10 / 60 s plus a durable 50 per 24 h counted from the rows; at most 5 open links per user (the oldest is auto-cancelled); members only |
| Live-game help through shares | Shares from a live game are refused (409 `live_game`) |
| Private-game data leaking through shares | Only the FEN and the sharer's note leave; never the opponent's name, the game ref or the moves |
| Internal emit abuse | P2's `/internal/emit`: HMAC signed by `internalFetch()` with kid `web`, a 60 s timestamp window and a replay set (P2 §7.5.1); the event must be in the registry and in the kid's allow-list, and its data must parse |
| Cache poisoning across users | Public tiers only on routes with `auth: public` that never read the session (the route wrapper refuses otherwise, and the registry lint test fails CI); `Set-Cookie` asserted absent on cacheable responses; OG images and public projections are tagged and purged on revoke |

### 11.3 Privacy

- Public projections expose the display name, username (from P10 on), initials, avatar URL, rating and user ref (refs are the external id, api-design §0.2). No emails, no internal ids, no birthdates, no billing state (a lapsed creator shows as `unavailable` without a reason).
- `challenges` rows cascade with the creator; closed rows are pruned after 30 days. `shares` become ownerless on account deletion (`SetNull`, "from a Replay Chess player").
- PostHog: hashed codes, no positions or notes (§10). Sentry: notes never attached.
- `noindex` on `/join/*` and `/s/*` (meta and header); OG previews are deliberate.

### 11.4 Paywall copy rules

Prices come from `WEB/lib/billing/plans.ts` and `copy.ts` (legacy $8 members see their own plan). Trial wording follows Phase 0: "Start your 7-day free trial", "Your free trial has been used". The design's "Ask for a game from the start instead" (accept `paywalled`) and the visible "Play vs Bot" on the paywalled share board are dropped, because no free play exists (inv-play-a C2, C3).

---

## 12. Testing

### 12.0 Conventions and plumbing (P1's shared test tools, testing critique X1–X18)

P9 builds no test infrastructure of its own; it uses P1's (and P2's socket fixture) and adds its personas, tags and hooks.

| Rule | What P9 does |
|---|---|
| Runner and layout (X1) | `node:test` via `tsx`. Unit tests beside the source (`*.test.ts`), DB-backed tests `*.int.test.ts`, route and contract tests in `WEB/test/api/`. `check-test-globs` must report every P9 test file as run |
| CI (X2) | Unit, integration (Docker Postgres 17) and `e2e-smoke` on every PR; the full main and device suites nightly (`nightly.yml`); `@smoke` against the dev URL after each dev deploy (`post-deploy-dev.yml`). P9 tags 5 specs `@smoke`: `play-hub`, `queue-match`, `challenge`, `challenge-paywall`, `shared-position` |
| Paywall on (X3) | Every P9 spec runs with `BILLING_PAYWALL=on`; members A–P are entitled in global setup |
| Users (X4) | A–P are shared members that specs only add data to; R is the read-only non-member. Exact states come from leased personas (`leasePersona("challenge-cap" \| "ratings-fresh" \| "share-cap")`, §6.8). The sign-up flow uses a throwaway `e2e-signup-<runId>+clerk_test` user, removed by P1's sweeper |
| Server time (X5) | Socket timers use `TIMING_PROFILE=fast` on P2's per-worker fixture socket server (port 3102); challenge expiry is compared with the database clock, so its spec moves `expiresAt` with the e2e DB fixture instead of `x-rc-now`; specs assert the server's `widenAt`/`timeoutAt`/`startsAt`, not literal "0:20". One `@slow` real-timing copy per timer runs nightly |
| Telemetry (X6) | Every §10 event is in `packages/analytics/src/events/play.ts` and asserted through P1's sink (`telemetry.expect`); the PII guard runs on every spec, and P9 specs register the challenge code, the share note and the FEN with `telemetry.forbid()` |
| Console guard (X7) | Auto-use; no allow-list entries needed for P9 |
| State coverage (X8) | Specs tag `@state:V3Queue.searching` (real data) or `@demo:V3Queue.offline` (demo route, with a reason in `design-states.overrides.json`); `state-coverage` must show 0 missing P9 states |
| Device × zoom (X9) | PR: 4 projects on the changed play routes; nightly: all 40 projects against a CI-local `next start` build (not the deployed dev site, feasibility #8); plus the real-route layer |
| Visual (X10) | Baselines in §12.6 |
| Regression (X11) | Every P9 spec carries `@p9`; the `flags-off` project turns `play-hub-v3` off and runs the earlier phases' `@smoke` specs until the legacy pages are deleted |
| Test hooks (X12) | Registered in `WEB/lib/test-hooks/registry.ts` (§7.9) and proven 404 or ignored by `prod-guard.spec.ts` |
| Defects (X14) | Every defect from the owner test, the ego-browser pass or a real device gets a failing test first, named `regression: <slug> (#issue)` |
| Databases (X16) | CI e2e and integration run on Docker Postgres; only the dev-URL jobs touch the Neon dev branch, after the Neon split (§2.3) |
| Perf results (X18) | k6 summaries go to `REPO/perf/results/p09-<scenario>-<sha>.json`; `perf/compare.ts` flags > 15 % regressions on shared scenarios |
| Sign-off (X15) | `REPO/docs/qa/phase-09-signoff.md`: SHA, Vercel deployment id, OCI image tags, the §1.3 rows with pass/fail and screenshot paths (`docs/qa/phase-09/`), device models and OS versions, the state-coverage table, the `error-window.ts` output for ≥ 24 h after the last dev deploy, the PostHog live-view check, k6 result links, defects and their regression tests |

### 12.1 Unit tests

| File | Cases |
|---|---|
| `PKG/game-core/src/rules/timeClass.test.ts` (P2's file, P9 cases added) | the 9 presets → `poolOf` (30+0 stored `CLASSICAL`, pool `RAPID`); `presetLabel` long strings ("5 min + 3 s per move", "1 min per side") |
| `PKG/game-core/src/rating/glicko2.test.ts` (P5's file) | P9 adds cases with `GAME`: Glickman's vector (with τ overridden to 0.5) to 2 decimals (r′ 1464.06, RD′ 151.52, σ′ 0.05999, v 1.7785, Δ −0.4834); the committed vectors at τ = 0.75; equal players 1500/350: win and loss are symmetric (+d / −d), a draw changes nothing; RD shrinks after every game; σ ≤ 0.1; clamps (100, 3200, RD 45); determinism (same inputs → same bits). P5's `PUZZLE` cases run unchanged |
| `PKG/game-core/src/rating/presets.test.ts` | `GAME` and `PUZZLE` differ only in the documented fields; each preset's floor is honoured |
| `PKG/game-core/src/rating/inactivity.test.ts` | 7 idle days = one period; RD 45 → ≈ 88 after 52 weeks; capped at 350; seed rows (`games = 0`) never inflated |
| `PKG/game-core/src/rating/handicap.test.ts` | edge 0 at 0 cp; +64 at 100 cp, +96 at 150 cp; clamp ±300; **the opponent-shift form equals the h-term form of the expected score** for 1,000 random inputs (to 1e-9) |
| `PKG/game-core/src/rating/stakes.test.ts` | win > draw > loss; each stake equals the delta `updateAfterGame` produces for that result |
| `PKG/game-core/src/rating/seed.test.ts` | rule order (Chess.com ≥ 10 → < 10 → Lichess → self → none) on `RatingsV1` fixtures; Lichess offsets; clamps 400/2800; band midpoints; `seedRating`/`seedRd` equal the seed |
| `PKG/game-core/src/rating/rules.test.ts` | the rated matrix: mode × start kind (start, balanced legend, unbalanced legend, shared) × pair count (2 → rated, 3 → casual) × aborted games in the window (not counted) |
| `PKG/game-core/src/matchmaking/pairing.test.ts` | ±100 before 20 s, ±200 after; mutual acceptance (one side widened, the other not → no pair at gap 150); **different presets never pair before both waited 20 s, do pair after, and the older entry's preset wins**; same-preset candidates win over closer cross-preset ones; different groups and legend vs standard never pair; `MERGE_PRESETS_AT_MS = null` disables merging; w+w and b+b never pair; w+random → the w player is White; random+random uses the colour balance, then the ref hash; oldest-first fairness with three entries; disconnected and `pairing` entries skipped; the previous opponent is skipped for the first 20 s only; timeout at exactly 60 000 ms; the widened notice once, with `merged`; property test (1,000 random buckets): nobody is paired twice, every pair is within both ranges and the merge rule, no pair violates the colour rule |
| `PKG/game-core/src/matchmaking/bucket-key.test.ts` | group and start in the key; the `e2eRun` prefix only when given; the legend slug from the position of the day |
| `PKG/game-core/src/matchmaking/position-of-day.test.ts` | deterministic per UTC day; rotates across days; fails when the pool has fewer than 3 entries |
| `PKG/game-core/src/matchmaking/legend-pool.test.ts` | every FEN is legal (chess.js), the side to move matches the FEN, the absolute `balanceCp` ≤ 150, slugs are unique, `prefixSan` ≤ 120 |
| `PKG/game-core/src/codes/challenge.test.ts`, `normalise.test.ts` | 8 characters from the alphabet; 100,000 codes contain no I, L, O or U; `normaliseCode("challenge", …)` upper-cases, `normaliseCode("share", …)` lower-cases; hyphens, O→0, I/L→1; rejects U and wrong lengths |
| `PKG/game-core/src/machine/reduce.test.ts` (P2's file, P9 cases added) | T1 waits for `notBefore` when both join early; `no_show` fires at `phaseEndsAt` and ends `aborted` with `abortedBy = "no_show"`; friend games without `notBefore` keep P2's T1 |
| `PKG/domain/src/play/challengeState.test.ts` | (row, viewer) → accept page state for every combination in §4.5 (including replay by the accepter, a lapsed creator → `unavailable`) |
| `PKG/domain/src/shares/sanitizeNote.test.ts` | URLs, bare domains, e-mails, phone runs, zero-width characters, blocklist words, NFKC, 140 trim, empty → null |
| `WEB/features/play/queue/queue-machine.test.ts` | every transition in §4.2 including `moved`, offline → online with `since`, `server:restarting`, ack timeout, three create failures, the merged banner copy |
| `WEB/features/play/hub/hub-state.test.ts` | URL > prefs > constants precedence; the legend tab defaults the colour to the hero side; invalid params fall back; `opponent` accepts `@martin_k`, `martin_k`, `%40martin_k` and rejects `<script>`, 2-character and 21-character values; `online-legend-pool` off forces `pos=start` |
| `WEB/lib/site-url.test.ts` | `appOrigin()` prefers `NEXT_PUBLIC_SITE_URL` |
| `WEB/scripts/ratings/recompute.test.ts` | 200 random rated games through the live finish code path, then `recompute --dry-run` reports 0 differences; one corrupted row is reported |
| `WEB/scripts/calibrate-bots.test.ts` | pairing schedule, adjudication rules and the Elo fit recover known gaps from synthetic results within ±20 |

### 12.2 API contract tests (`WEB/test/api/`, Docker Postgres)

| File | Cases |
|---|---|
| `challenges.test.ts` | Auth matrix (signed out 401, non-member 402 with `reason`, non-creator DELETE 403); body validation (bad preset, legend without slug, start with a slug → 400; unknown slug or share → 404); idempotency (same key → replay header; same key + other body → 422; parallel same key → one 201 + one 409 `in_flight`); the 6th open link auto-cancels the oldest (fresh DB user); **the 51st create in 24 h → 429 `details.window: "day"`**, and the limit survives truncating `rate_limit_buckets` (durable); GET public shape has no email or entitlement fields, carries the `public-static` headers and `Vercel-Cache-Tag`, and never sets a cookie; **two parallel accepts → one 200, one 409 `already_started`**; own link → 409; expired → 410 `expired`; cancelled → 410; accepter replay → 200 with the same `gameRef`; creator lapsed → GET status `unavailable`, accept 410 `creator_unavailable`; rated downgraded to casual at the 4th finished rated game of the pair in 24 h, while three aborted games do not count; decline keeps the link OPEN and calls the `internalFetch` stub with kid `web` and `dedupeKey`; DELETE after accept → 409 with `gameRef`; every `details.reason` is in `CONFLICT_REASONS` or `GONE_REASONS`; the response parses with the contract schema |
| `shared-positions.test.ts` | Create from a slug, a FEN and the viewer's finished game; a live game → 409 `live_game`; someone else's game → 403; illegal FEN → 422; the note is sanitised; SP-2 never returns `gameId`, `ply` or the opponent; GET revoked → 410; revoke calls `revalidateTag` and `invalidateByTag` with `share:<code>`; DELETE by a non-owner → 403; the 21st create in 24 h → 429 (durable); idempotency |
| `preferences.test.ts` | GET with no row → the zod defaults and `version 0`; PATCH deep merge per leaf; the version increments; unknown keys stripped; invalid `botStrength` → 400; `prefs:updated` emitted through the stub; ETag 304; the `prefs` bucket returns 429 at the 121st PATCH in 60 s |
| `og.test.ts` | OG-1 and OG-2 return `content-type: image/png` and 1200 × 630 (read from the PNG IHDR bytes); the cache headers of §7.1 (browser `max-age` 86400 / 300, CDN `s-maxage=31536000`, the tags); a revoked share's OG URL returns the generic image with `max-age=60` |
| `socket-token.test.ts` | The `r` claim matches `player_ratings` (and the seed rule when there is no row); the token still verifies with P2's `verifySocketToken` |
| `redirects.test.ts` | `/queue?time=300&increment=3&legend=x` → `/play/online?tc=5%2B3&pos=legend`; `/challenge/new`; `/play/queue`; `/play/friend?opponent=%40martin_k` → `/play?tab=friend&opponent=%40martin_k`; `/join/<code>` and `/s/<code>` responses carry `X-Robots-Tag: noindex` |
| `registry-lint.test.ts` (P1's, P9 rows) | no P9 route with `auth ≠ public` declares a `public-*` tier; no per-user P9 route carries `max-age > 0` |

### 12.3 Socket integration (`WS/test/queue.int.test.ts`; in-process server + `socket.io-client` + Docker Postgres; `TIMING_PROFILE=fast`)

1. Two members join the same bucket → both receive `queue:matched` with the same `gameRef` and opposite colours; one `games` row with `mode = ONLINE`, `rated = true`, the right `timeClass`, `phase = WAITING`, `expiresAt` set, the display columns filled, and **two** `game_players` rows with `ratingBefore`; exactly 1 SQL statement ran during the whole search (`pg_stat_statements` reset before the test).
2. 5+3 and 3+2 in the same group do not pair before `mergeAt`, pair after it on 5+3 (the older entry), and `queue:matched.merged` is true for both; 5+3 and 10+0 never pair.
3. Two Playwright-style tokens with different `e2eRun` claims never pair, even with equal ratings; with `APP_ENV=production` the claim is refused at verify (P2).
4. A non-member token → `not_member`.
5. The same user from a second socket → the first gets `queue:moved`; only one entry remains.
6. Disconnect → the entry is removed after the grace; a reconnect within it keeps it; a reconnect with `since` keeps the elapsed time.
7. Widen and timeout fire at the fast-profile times; one `queue:status` with `merged: true`.
8. A user with a live rated game → `already_in_game` with its ref.
9. Abort limit: three no-shows → `rate_limited` with `retryAfterMs`.
10. The insert fails (fault injected) → both entries go back to the bucket; three failures → `error`. A simulated `57P01` on the first attempt is retried at once and the pair still matches (not counted as a failure).
11. No-show: one player never sends `game:join` → at `phaseEndsAt` the game is `aborted` with `abortedBy = "no_show"`, unrated, and `game:ended.abortReason = "no_show"`.
12. A rated game played to resignation → both `player_ratings` rows updated **in the finish statement** (still one statement), both `game_players` rows carry `ratingAfter` and `ratingDelta`, `game:result.ratings` emitted, the rating cache updated; a second finish call changes nothing.
13. Guard failure: bump one player's `games` between creation and finish → `rated_rows = 1` → `repairRatings` writes consistent values and counts `ratings.guard_retry`.
14. A token without `r` and a cold cache → `queue:join` runs exactly one `player_ratings` read and no `SELECT 1`.
15. A challenge game (created through the accept use case) loads both ratings in the same statement as the game row on the first `game:join`.

### 12.4 End-to-end (Playwright, `WEB/e2e/specs/play/`)

Queue specs run on P2's per-worker fixture socket server with `TIMING_PROFILE=fast` and tokens carrying `testInfo.testId` as `e2eRun`, so only users of the same test can pair (testing X4.5). Against the dev URL (where tokens cannot be customised) they run in the serial `play-queue` project with `workers: 1`. E2E users without linked accounts have no seed (effective 1500), so they pair.

| Spec | Users | Steps | Asserts |
|---|---|---|---|
| `play-hub.spec.ts` `@smoke @p9` | A | open `/play`; switch tabs by click and `1`–`4`; search "Kasparov", then "zzz", Clear; Bot slider → 1600, reload; Bot CTA | default tab Online; filtered list; `search_empty` copy; the slider is still 1600 after reload (prefs); the URL carries `tab`, `tc`, `color`; the Bot CTA lands on `/game/<ref>` in P2's `bot` state; with `page.route` forcing 402 on `POST /api/games` → the `limit` banner; forcing 500 → the `error` banner with selections kept; telemetry `play_cta_clicked{tab:"bot"}` once |
| `play-friend-hint.spec.ts` `@p9` | A | open `/play/friend?opponent=@martin_k`; create a link | lands on `/play?tab=friend&opponent=martin_k`; opponent bar "? @martin_k · joins from your link"; the share page eyebrow names @martin_k; `?opponent=<script>` is ignored |
| `queue-match.spec.ts` `@smoke @p9` | B, C (two contexts) | both open `/play/online?tc=5%2B3&pos=legend&color=random` | both see match found with each other's names; both land on the same `/game/<ref>` in `study`; colours opposite; **no request to `/api/matchmaking`** (`page.on('request')`); the countdown runs from the server `startsAt`; telemetry `queue_joined{pool:"blitz", color:"random"}` per user and the server event `queue_matched` exactly once with `wait_ms_a`/`wait_ms_b` |
| `queue-merge.spec.ts` `@p9` | D, E | D queues 5+3, E queues 3+2 | no match before `mergeAt`; match after it on 5+3; E's card shows "Matched on your opponent's time control" |
| `queue-timeout.spec.ts` `@p9` | F | queue alone in 3+2 | `widened` at the fast-profile `widenAt` with the merged copy; `timeout` at `timeoutAt`; Play Against Bot → `/game/<ref>` with the legend position's FEN |
| `queue-timeout.real.spec.ts` `@slow @p9` (nightly) | F | the same with real timings | widened at ≈ 20 s, timeout at ≈ 60 s |
| `queue-edge.spec.ts` `@p9` | G | two tabs queue → the first shows "Searching in Another Tab"; `context.setOffline(true)` → `offline` (no "Play vs bot offline" until P11 passes `offlineAction`); back online → `searching` with the timer continuing; `Esc` → `/play?tab=online` | as stated |
| `challenge.spec.ts` `@smoke @p9` | H (creator), I | H creates (Friend, 3+2, Black, rated) → share page; Copy (grant `clipboard-read`) → the clipboard holds `/join/<code>`; I opens it → `default` → Accept | both on the same game; H plays Black; H's share page navigates within 2 s of the accept (socket); I re-opens the link → redirected to the game; a second challenge by H: H opens it → `own_link`; H cancels a third → I sees `unavailable`; I declines a fourth → H sees the decline toast and the link stays open; telemetry `challenge_created{rated:true, start_from:"start"}` |
| `challenge-cap.spec.ts` `@p9` | leased `challenge-cap` | create 6 links | the oldest shows `cancelled`; the API shows 5 open |
| `challenge-expiry.spec.ts` `@p9` | J | create through the API; move `expiresAt` into the past with the e2e DB fixture (`WEB/e2e/fixtures/db.ts`: Docker Postgres in CI, refuses any host outside `DEV_DB_HOSTS`) **before** the first view (expiry is compared with the database clock, so `x-rc-now` would not move it) | `/join/<code>` → `unavailable`; `/play/friend/<code>` → `expired` → Create a New Link → a new code |
| `challenge-guest.spec.ts` `@p9` | K (creator), signed-out context, then L | the guest opens K's link | marketing header; `logged_out` CTAs with `redirect_url`; Sign In as L → back on `/join/<code>` in `default` (not auto-accepted) → Accept → game |
| `challenge-signup-trial.spec.ts` `@slow @p9` (nightly) | throwaway `e2e-signup-<runId>+clerk_test` | guest → New Here? Start Trial → sign-up (code `E2E_CLERK_TEST_CODE`) → P4 onboarding fast path → Dodo test checkout (P4's `completeTrialCheckout()` helper) | lands on `/join/<code>` in `default`; Accept → game; the sink records `challenge_accepted{signed_up_from_link: true}` exactly once |
| `challenge-paywall.spec.ts` `@smoke @p9` | R | open a member's link | `paywalled` with the trial copy and no Accept button; `POST …/accept` with R's cookie → 402 |
| `og-challenge.spec.ts` `@p9` | A | create a challenge and a share; fetch `/og/challenge/<code>`, `/og/position/<code>?v=1`; fetch `/join/<code>` HTML | PNG 1200 × 630; the §7.1 cache headers; `og:image` is absolute to `NEXT_PUBLIC_SITE_URL`; `X-Robots-Tag: noindex`. The manual Slack and WhatsApp check stays in §12.9 |
| `shared-position.spec.ts` `@smoke @p9` | M (owner), N, R, signed out | M creates a share through the API from a slug and through the UI from a review key moment (P3's reviewed-game fixture, tag `@review-fixture`); N opens it → Play vs Bot → game; Challenge a Friend → share page; R → `paywalled` without Play vs Bot; signed out → the preview with the trial CTA; M → Stop Sharing → N reloads | 404 status and the `not_found` copy after the revoke; telemetry never contains the note or the FEN |
| `ratings.spec.ts` `@p9` | leased pair `ratings-fresh` ×2 (quick match, Blitz) | play 2 moves each, the second user resigns; then a second rated game opened to the resign popover and aborted at the first move | the result card shows "Blitz x → y (+d)" for the winner and the negative line for the loser; Home header updates; the `/games` row shows the delta; the resign popover shows the stake; the aborted game changes nothing. **Integrity check** afterwards (DB fixture): per user and pool, `player_ratings.games` = the count of rated `game_players` rows with result WIN, LOSS or DRAW; RD in [45, 350]; for each game row, `ratingAfter − ratingBefore = ratingDelta`, and the user's current `round(rating)` equals the latest `ratingAfter`. (Glicko deltas are not zero-sum, so there is no sum check) |
| `legacy-redirects.spec.ts` `@p9` | O | `/queue?time=300&increment=3`, `/challenge/new`, `/position/<ref>` (P8's 308), `/join/<cuid of a finished game>` | 308s to the new routes |

### 12.5 Device × zoom (`WEB/e2e/devices/layout/play.spec.ts`)

Tiering (testing X9, feasibility #8): PR runs `desktop-1440@100`, `desktop-1280@125`, `iphone@100`, `ipad-portrait@100` when a play route changed; nightly runs all 40 projects against a CI-local production build, never the deployed dev site (Hobby quotas). `ROUTES` additions (P1 `routes.ts` pattern), run through `expectOneViewport` and `expectTapTargets`:

- `/dev/ui/play/hub?tab={legend,bot,friend,online}&state={default,search_empty,creating,error,limit,loading}` (24 URLs; board: true on non-tab-bar projects), plus `stress=1` (40-character names, 50 positions, the longest legend title).
- `/dev/ui/play/queue?state={initializing,searching,widened,cancelling,error,offline,timeout,creating}` (board: true), plus `merged=1`.
- `/dev/ui/play/match?state={countdown,ready}` (board: true), plus `merged=1`.
- `/dev/ui/play/challenge?state={waiting,copied,joined,expired,cancelled,error}` (board: true), plus `opponent=martin_k`.
- `/dev/ui/play/accept?state=…&guest={0,1}` (board: true).
- `/dev/ui/play/share?state=…&variant={member,guest,owner,anonymous}` (board: true).

Extra assertions: the CTA (or the action bar) is visible without scrolling on every project; at `*@150` the aside's `ScrollRegion` scrolls internally and the page does not; the board side matches §4.0's golden sizes (soft); on tab-bar projects the queue, match found, accept and share pages show **no** tab bar. Real-route layer (`e2e/devices/layout/routes.real.ts`, P1): `/play`, `/play/online`, `/join/<seed code>`, `/s/<seed code>` on `desktop-1440@100/150`, `iphone@100/125` and `ipad-portrait@100`, signed in as A. Axe in both themes on the demo routes (tablist and listbox roles, slider `aria-valuetext`, polite live region on the queue status, the countdown announced once).

### 12.6 Visual regression (P1's `toHaveScreenshot` setup, testing X10)

Baselines on `desktop-1440@100` and `iphone@100`, light and dark (`reducedMotion: "reduce"`, fixed clock, avatars and relative dates masked with `[data-vr-mask]`): `V3PlayHub` each of the 4 tabs (`default`), `V3Queue` `searching` and `widened`, `V3MatchFound` `countdown`, `V3ChallengeShare` `waiting`, `V3ChallengeAccept` `default`, `V3PositionShare` `default`. 9 states × 2 projects × 2 themes = 36 images under `WEB/e2e/__screenshots__/`. Design parity against the canvas boards stays a manual side-by-side in the sign-off (the `.dc.html` boards need the design runtime).

### 12.7 Chess-correctness fixtures

- `PKG/game-core/test/fixtures/glicko2-vectors.json`: Glickman's example plus 20 single-game vectors produced once, offline, by an independent permissively licensed Python implementation at τ = 0.75 with our clamps disabled; the header records the package name, version and licence; `glicko2.test.ts` checks every vector to 0.01.
- `legend-pool.test.ts` (above): FEN legality, `prefixSan` legality from the source position and the balance threshold for the generated pool.
- Challenge start FEN for a legend start equals the P8 position's FEN at `startPly`; a share's FEN round-trips through `validateFen`.
- The pool classification table (§8.1) is a fixture shared with P3's archive filter (`timeClass`).
- `PKG/chess-fixtures/calibration/openings.epd`: 50 positions, each legal and |eval| ≤ 50 cp (checked once with the eval provenance job of P3, testing X13).

### 12.8 Regression of earlier phases

The regression gate is the whole main and device suites on the final SHA (testing X11), plus these targeted extras:

- P2 game suite. Its spec "create a friend game from the legacy `/play` page" is rewritten to create the friend game through `POST /api/challenges` + accept (WP-I). Rematch, abort, draw, reconnect and spectate run unchanged; spectating a challenge game uses P2's `spectate:join`.
- P3 archive and review (the rating column now has values); P4 onboarding with a `redirect_url` to `/join/<code>`; P5 Home (header and week line, still the same statement count: P5's query-count test); P8 legend practice started from the hub's Legend tab (`/play/legend/<slug>?from=playhub`) and the `/position/*` 308s.
- P1 shell: Play is the active nav item on `/play/*`, `/join/*` (signed in) and `/s/*` (signed in); `paid-only.spec.ts`, `membership.spec.ts`, `pricing.spec.ts`.
- `flags-off`: with `play-hub-v3` off, the legacy `/play`, `/queue` and `/join/<cuid>` flows still pass their P2-era specs until the deletion PR.

### 12.9 Manual checklist on dev (ego-browser, then a real iPhone and Android)

1. §1.3 steps 1–13.
2. Paste a `/join/<code>` link into Slack web and WhatsApp web: the preview shows the board image, "martin_k challenges you" and the time control. Repeat with a `/s/<code>` link, revoke it, and check that a fresh paste no longer shows the board.
3. `curl -sI <dev>/og/challenge/<code>` twice: the §7.1 headers, and the second response `x-vercel-cache: HIT`.
4. `curl -sI <dev>/api/challenges/<code>`: `vercel-cdn-cache-control` with `s-maxage=10`; no `set-cookie`.
5. Desktop at 80, 100, 125 and 150 % on `/play`, `/play/online`, `/join/<code>`, `/s/<code>`: no page scroll, the board fully visible, the CTA visible.
6. iPad (landscape and portrait) and the two phones: the hub summary card, the queue board size, no tab bar on the queue.
7. Keyboard only: tabs, the listbox, the slider, `Enter` for the CTA, `Esc` to cancel a search.
8. Screen reader (VoiceOver on iPhone): the queue status changes are announced, the seconds are not.
9. Network panel during a search: only the websocket frames.
10. PostHog live events show the §10 names with no FEN, note or raw code; `error-window.ts` shows no new Sentry issues.
11. Close every ego-browser page opened (`task.finish({ keep: [] })`, CLAUDE.md).

### 12.10 Performance checks

Run once per phase, only after the Neon dev split, against the dev OCI box and the dev Vercel project; record Vercel and Neon usage before and after each run (feasibility §10.5 item 7) and stop if any Hobby quota passes 60 %.

| Check | Tool | Threshold |
|---|---|---|
| `REPO/perf/k6/src/scenarios/queue-socket.ts` (new; replaces `matchmaking.ts` and `quick-match.ts`): 200 VUs connect with perf tokens, join 3 buckets (same and mixed presets), pair, receive `queue:matched`, leave; 10 min | k6 + the socket.io helper in `perf/k6/src/lib/protocol-v2.ts` (P2) | `queue:join` ack p95 < 300 ms from the runner; matched within 1.5 s of the second join (p95); loop lag p99 < 50 ms; RSS growth < 50 MB; Neon statements during the run = the number of matches (`pg_stat_statements` delta); `abortOnFail` on the first three |
| `api-challenges`: 50 VUs create → GET → accept | k6 | p95 < 300 ms; 0 duplicate games under parallel accepts |
| Bundle report | P1 F7 CI step (blocking) | §9.5 budgets |
| `EXPLAIN (ANALYZE, BUFFERS)` | perf branch, `scripts/explain-hot-queries.ts` | the §9.2 plans |
| Lighthouse (mobile) on `/join/<code>` signed out | Lighthouse CI | Performance ≥ 90, CLS ≤ 0.05 |

---

## 13. Work breakdown

### 13.1 Order and parallelism

```
day  1    2    3    4    5    6    7    8    9    10   11   12   13
WP-A █████████                                                          schema, contracts, domain package, pure modules (blocks everyone)
WP-H    ████                                                            preferences endpoint + store
WP-J    █████                                                           bot calibration (owner's laptop runs overnight)
WP-B          ███████████                                               Glicko GAME preset, finish fragment, viewer/token, lit slots, recompute
WP-C          ██████████████                                            socket matchmaker, createMatchedGame, machine edits
WP-D          █████████████                                             Play hub UI
WP-F          █████████████                                             challenges API + pages + OG
WP-E                        ████████                                    queue + match found UI (needs WP-C running on dev)
WP-G                             █████                                  shared positions (needs WP-F's (shared) layout)
WP-I                                       █████████                    routing, legacy removal PR, perf, visual, sign-off
```

With one developer working with Claude the packages run as parallel sub-tasks inside the same weeks, and each one merges to `dev` behind `play-hub-v3`. P9 runs in stream B (P8 → P9 → P12) while stream A (P4 → P7) is active, so shared files follow §13.2's registry rule.

### 13.2 Packages, file ownership, acceptance and estimates

A file is edited by exactly one package. Files owned by earlier phases get **one** additive edit from the package named here; nobody else in P9 touches them. Where P1 turned a shared registry into a directory (feasibility §7), P9 adds a file instead of editing: `lib/api/keys/play.ts`, `lib/flags/registry/p9.ts`, `lib/routes/classes/play.ts`, `config/redirects/p9.mjs`, `lib/seo/robots-rules/p9.ts`, `lib/realtime/handlers/{challenge,queue}.ts`, `PKG/contracts/src/http/registry/play.ts`, `e2e/personas/p9.ts`. The P9 globs go into `REPO/OWNERS.yml` (P1) for the phase's weeks. `PKG/db/prisma/schema.prisma` and the lockfile are edited only through their weekly stewards (P1-03).

**WP-A · Schema, contracts, domain package and pure foundations (1.75 d)**

| Creates | Edits |
|---|---|
| `PKG/db/prisma/migrations/<ts>_m9_play_challenges_ratings/migration.sql`; `PKG/domain/{package.json,tsconfig.json,src/index.ts}` (new package, §8); `PKG/contracts/src/http/{challenges,shares,preferences}.ts`; `PKG/contracts/src/socket/queue.ts` (`queueSub`, schemas); `PKG/game-core/src/codes/{challenge,normalise}.ts` + tests; `PKG/game-core/src/matchmaking/{config,bucket-key}.ts` + tests; `PKG/db/src/json/preferences.ts` (`PreferencesV1` with `PlayPrefs`, if no earlier phase created it); `WEB/scripts/p9-preflight.ts`; `PKG/contracts/src/socket/rooms.ts` **only if P2 did not ship it** | `PKG/db/prisma/schema.prisma` (§6.2); `PKG/db/src/json/game-meta.ts` (`source`, `notBefore`, `abortedBy: "no_show"`); `PKG/db/prisma/protected-indexes.txt`; `PKG/db/sql/roles.sql` (§6.3 grants); `PKG/contracts/src/socket/{user,game,token,registry}.ts` (challenge events; `stakes`, `provisional`, `ratings`, `abortReason`; the `r` claim; registry entries); `PKG/contracts/src/socket/test/size.test.ts` (two named exceptions); `PKG/contracts/src/http/codes.ts` (reasons); the HTTP endpoint registry (CHL-1…5, SP-1…3, ME-3a/b); keys (`prefs`, `shares`); flags (`play-hub-v3`, `online-legend-pool`); `PKG/game-core/src/rules/timeClass.ts` (`TC_PRESETS`, `presetLabel` if missing); `WEB/next.config.js` (`transpilePackages: "@repo/domain"`); `docs/api/openapi.json` and `docs/api/socket-events.md` (regenerated) |

Acceptance: the preflight passes; `prisma migrate deploy` succeeds on a fresh Docker Postgres and on the Neon dev branch; the drift gate and the index-existence check are green; the grants run on dev; `pnpm check-types` passes across the monorepo; the OpenAPI diff contains only the new endpoints; P2's size test passes with the two exceptions.

**WP-H · Preferences (0.5 d)**

| Creates | Edits |
|---|---|
| `WEB/app/api/me/preferences/route.ts` (GET, PATCH; bucket `prefs` 120 / 60 s); `PKG/domain/src/prefs/{getPreferences,patchPreferences,deriveColumns}.ts` + tests; `WEB/lib/data/prefs.ts` (`getPlayPrefs`); `WEB/features/play/api/prefs.ts`; `WEB/lib/prefs/store.ts` and `WEB/lib/prefs/sync.ts` **if they do not exist yet** (client-data-layer §6.3: local-first Zustand, debounced PATCH, `prefs:updated` handling with the version skip rule and the `BroadcastChannel` sibling update, api-perf AP-24) | — |

Acceptance: `preferences.test.ts` green; a slider change on one device appears on another after reload; the PATCH emits `prefs:updated`; a sibling tab on the same device does not refetch.

**WP-B · Ratings (2.25 d)**

| Creates | Edits |
|---|---|
| `PKG/game-core/src/rating/{inactivity,handicap,stakes,seed,rules,display}.ts` + tests; the `GAME` preset in `rating/presets.ts` (or the file with both presets if P5 did not create it); `rating/CLEANROOM.md`; `PKG/game-core/test/fixtures/glicko2-vectors.json`; `PKG/db/src/live/repairRatings.ts` + int test; `PKG/domain/src/ratings/{seedPlayerRatings,getEffectiveRatings}.ts` + tests; `WEB/scripts/backfill/seed-player-ratings.ts`; `WEB/scripts/ratings/recompute.ts` + test; `WEB/lib/home/rating-line.ts` (pure: the week line from the (h3) rows) | `PKG/game-core/src/rating/glicko2.ts` (P5: only to move constants into `PUZZLE` if P5 left them inline; behaviour unchanged); `PKG/db/src/live/finish.ts` (P2: the `gp` SET extension and the `pr` fragment, `rated_rows` in the final `SELECT`); `PKG/db/src/live/loadLiveGame.ts` (P2: the ratings LATERAL for rated games); `WEB/lib/auth/viewer.ts` (P1: select `ratings` with `relationLoadStrategy: "join"`); `WEB/lib/socket-token.ts` + `WEB/app/api/socket-token/route.ts` (the `r` claim); `WEB/lib/accounts/link-service.ts` and `WEB/lib/onboarding/steps.ts` (P4: call `seedPlayerRatings`); `WEB/lib/home/home.server.ts` (P5: two columns on (h3), `stats.ratingLabel` via `rating-line.ts`; one import and one field, coordinated with P6's edit to the same file) and `PKG/contracts/src/http/home.ts` (P5: `stats.ratingLabel`); `WEB/components/shell/RatingChip.tsx` or the P1 equivalent (source); `WEB/features/game/screen/*` result card and resign popover (P2: render the line and stakes in P2's slots) |

Acceptance: the Glicko vectors pass for both presets; the backfill dry-run counts match; a rated game updates both rows inside the one finish statement; the guard-retry path is covered; the recompute dry-run on dev reports 0 differences; the shell, Home (same statement count), archive, result card and resign confirm show the values; the seed appears in the token for a new linked user.

**WP-C · Socket matchmaker (2.75 d)**

| Creates | Edits |
|---|---|
| `WS/src/queue/{Matchmaker,bucket,handlers,colorHistory,abortLimiter,prewarm,metrics}.ts`; `WS/src/game/ratingCache.ts`; `PKG/game-core/src/matchmaking/{pairing,position-of-day,legend-pool}.ts` + tests; `PKG/db/src/live/createMatchedGame.ts` + int test; `WEB/scripts/build-legend-pool.ts`; `WS/test/queue.int.test.ts` | `WS/src/index.ts` (register the queue handlers and the tick); `WS/src/config/timing.ts` (P2: the P9 fields of the fast profile); `PKG/game-core/src/machine/{reduce,timers}.ts` (P2: `notBefore`, `timer(start)`, `no_show`); `WS/src/game/LiveSession.ts` (P2: `stakes`, pool ratings in `PlayerView`, `game:result.ratings`, rating-cache update and `recentOpponent` after finish); `WS/src/persist/drain.ts` (P2: pause new `queue:join` while draining) |

Acceptance: §12.3 green; on the dev OCI box two browsers match and play; `pg_stat_statements` shows one statement per match; k6 `queue-socket.ts` meets §12.10; the deploy drain also pauses new joins.

**WP-D · Play hub UI (2.5 d)**

| Creates | Edits / moves |
|---|---|
| `WEB/app/(app)/play/page.tsx` (new RSC), `WEB/app/(app)/play/loading.tsx`; `WEB/features/play/hub/*` (the files in §4.1, including `OpponentHint.tsx`); `WEB/lib/data/play.ts` (`getLiveGameFor`, `getPlayHub`); `WEB/app/dev/ui/play/hub/page.tsx`; `WEB/e2e/specs/play/{play-hub,play-friend-hint}.spec.ts` | Move the old page to `WEB/features/play/legacy/LegacyPlayPage.tsx` (flag off); the P1 shortcuts registry (`1`–`4`, `/`, `Enter`, `F` on the hub); P5's Home CTAs and P2's game-over **New Game** target (`/play?tab=…`, `/play/online?…`) |

Acceptance: every hub state reachable from real data or the demo route; one-viewport on the PR projects and nightly on all 40; `/play` ≤ 230 kB; no client fetch on mount (network panel); the Legend CTA hands off to P8's route; the Bot CTA creates a bot game; the `opponent` hint renders and is sanitised.

**WP-E · Queue and match found UI (1.5 d)**

| Creates | Edits |
|---|---|
| `WEB/app/(app)/play/online/{page,loading}.tsx`; `WEB/features/play/queue/{QueueScreen,QueueCard,QueueRows,MatchFoundCard,useQueue,queue-machine,useCountdown}.ts(x)` + tests; `WEB/app/dev/ui/play/{queue,match}/page.tsx`; `WEB/e2e/specs/play/{queue-match,queue-merge,queue-timeout,queue-timeout.real,queue-edge,ratings}.spec.ts` | — |

Acceptance: all 8 + 2 states reachable; two-browser match on dev; merging after 20 s; the 60 s timeout → bot; reconnect continues the timer; no tab bar on phone queue pages; one-viewport; `QueueCard` renders nothing for a missing `offlineAction`.

**WP-F · Challenges (2.5 d)**

| Creates | Edits |
|---|---|
| `WEB/app/api/challenges/route.ts`, `[code]/route.ts`, `[code]/accept/route.ts`, `[code]/decline/route.ts`; `PKG/domain/src/play/{createChallenge,acceptChallenge,declineChallenge,cancelChallenge,challengeState,getChallengePublic}.ts` + tests; `WEB/lib/data/challenges.ts`; `WEB/lib/data/return-targets/play.ts` (P11 handoff); `WEB/app/(app)/play/friend/[code]/page.tsx`; `WEB/app/(shared)/layout.tsx`; `WEB/app/(shared)/join/[code]/{page,loading,not-found}.tsx`; `WEB/features/play/challenge/*`; `WEB/features/play/api/challenges.ts`; `WEB/app/og/challenge/[code]/route.tsx`; `WEB/lib/site-url.ts` + test; `WEB/lib/internal/fetch.ts` **only if P2 did not ship it**; `WEB/app/dev/ui/play/{challenge,accept}/page.tsx`; `WEB/test/api/{challenges,og}.test.ts`; `WEB/e2e/specs/play/{challenge,challenge-cap,challenge-expiry,challenge-guest,challenge-signup-trial,challenge-paywall,og-challenge}.spec.ts`; `WEB/e2e/fixtures/db.ts` (if P1 has no DB fixture) | `WEB/lib/realtime/UserChannel.tsx` or `lib/realtime/handlers/challenge.ts` (the `challenge:*` and the other-tab `queue:matched` toasts); `WEB/lib/billing/return-url.ts` (add `/s/`, `/play`); `WEB/package.json` (`uqr`); `WEB/THIRD_PARTY.md` |

Acceptance: §12.2 challenge contract tests green, including the parallel-accept race and the durable daily cap; the signed-out → trial → accept loop works on dev; link previews render in Slack and WhatsApp; the share page flips to `joined` within 2 s of the accept.

**WP-G · Shared positions (1 d)**

| Creates | Edits |
|---|---|
| `WEB/app/api/shared-positions/route.ts`, `[code]/route.ts`; `PKG/domain/src/shares/{createPositionShare,revokeShare,sanitizeNote,getSharePublic,shareTitle}.ts` + tests; `WEB/lib/data/shares.ts`; `WEB/app/(shared)/s/[code]/{page,loading,not-found}.tsx`; `WEB/features/play/share/{SharedPositionScreen,ShareActions,SharePositionDialog}.tsx`; `WEB/features/play/api/shares.ts`; `WEB/app/og/position/[code]/route.tsx`; `WEB/app/dev/ui/play/share/page.tsx`; `WEB/test/api/shared-positions.test.ts`; `WEB/e2e/specs/play/shared-position.spec.ts`; `PKG/contracts/src/moderation/blocklist.ts` | Menu items: P3 `WEB/features/review/KeyMomentMenu.tsx`, P8 `WEB/features/learn/PositionActions.tsx` and the compare/practice ⋯ menus; P2 `WEB/lib/games/create-bot-game.server.ts` and `PKG/contracts/src/http/games.ts` (`sharedCode` resolution, only if missing) |

Acceptance: create from a review moment; member, non-member, guest and owner variants; revoke → 404, the CDN copy and the OG image purged (`x-vercel-cache: MISS`, then the 404 and the generic image); no view counter writes.

**WP-I · Routing, legacy removal, perf, visual and sign-off (1.75 d)**

| Creates | Edits / deletes |
|---|---|
| `WEB/app/queue/route.ts` (308 handler); `REPO/perf/k6/src/scenarios/{queue-socket,api-challenges}.ts`; `WEB/e2e/specs/play/legacy-redirects.spec.ts`; `WEB/e2e/devices/layout/play.spec.ts` + the `ROUTES` additions; the visual baselines (§12.6); `WEB/test/api/redirects.test.ts`; `REPO/docs/qa/phase-09-signoff.md` | Middleware route classes (public `/join/(.*)`, `/s/(.*)`; matcher excludes `/og`); redirects (`/challenge/new`, `/play/queue`, `/play/friend`) and `headers()` (`X-Robots-Tag`); robots rules; `turbo.json` (`NEXT_PUBLIC_SITE_URL`); `.github/workflows/ci.yml` (bundle budgets for the new routes); `WK/src/scheduler/recurring/challenges.ts` + its line in the directory's `index.ts` (P3's slice contract: `challenges.expire`, `challenges.prune`); P2's friend-game E2E spec (rewritten to use challenges); `WEB/scripts/dev/personas.ts` (the three P9 personas); `docs/implementation-plan.md` (link to this spec). **Deletion PR, merged last** (after §15's parity check): every path in §7.10, `WEB/e2e/specs/quick-match.spec.ts`, `play-with-friend.spec.ts`, `perf/k6/src/scenarios/{matchmaking,quick-match}.ts`, `matchmakingPollCount` in `perf/k6/src/lib/metrics.ts`, the queue/join branches of `Breadcrumbs.tsx` (if present) |

Acceptance: the redirect tests pass; `grep -rE "api/matchmaking|chess/(create-game|join|cancel-game|game-by-ref)|useMatchmaking|ShareLinkModal" WEB/app WEB/lib WEB/features WEB/components perf` returns nothing after the deletion PR; CI green; the k6 thresholds met; the sign-off record committed.

**WP-J · Bot ladder calibration (1 d of work; the matches run unattended)**

| Creates | Edits |
|---|---|
| `WEB/scripts/calibrate-bots.ts` + test; `PKG/chess-fixtures/calibration/openings.epd`; `PKG/game-core/src/bot/calibration.json` | `PKG/game-core/src/bot/strength.ts` (P2: tuned rows, `CALIBRATED`); P2's bot chip tooltip (reads `CALIBRATED` per row) |

Acceptance: every row within ±75 of its shown number, or marked "≈" with the measured value in `calibration.json`; the tooltip gone for calibrated rows; the run's build hash equals the shipped engine's.

### 13.3 Estimate summary

| WP | Days |
|---|---|
| A Schema, contracts, domain package, pure foundations | 1.75 |
| H Preferences | 0.5 |
| B Ratings | 2.25 |
| C Socket matchmaker | 2.75 |
| D Play hub UI | 2.5 |
| E Queue + match found UI | 1.5 |
| F Challenges | 2.5 |
| G Shared positions | 1.0 |
| I Routing, removal, perf, visual, sign-off | 1.75 |
| J Bot calibration | 1.0 |
| **Total** | **17.5** |
| Buffer (20 %, feasibility #15) | 3.5 |

Against the allocation's 15 days: +1.0 for the bot calibration that P2 handed over (H-06), +0.5 for the test plumbing the testing critique asks of every phase (tags, personas, telemetry assertions, visual baselines, sign-off), +0.25 for the rating recompute tool, +0.25 for creating `PKG/domain`, +0.5 for preset merging, `createMatchedGame` and the finish-fragment work that rev 1 under-specified. Trim options if the owner wants 15: defer WP-J to P12 (−1.0; the "≈" tooltip stays), and defer the visual baselines to P13 (−0.25).

---

## 14. Risks, open questions and decisions for the owner

### 14.1 Risks

| # | Risk | Likelihood · impact | Mitigation |
|---|---|---|---|
| K1 | **Liquidity.** 9 presets × 2 position modes split a small, paid-only member base, so most searches time out. | High · medium | Time-class buckets with preset merging after 20 s (§8.2.2: at most 6 effective buckets, 3 with `online-legend-pool` off); defaults steer everyone to 5+3 · legend; the position of the day keeps all legend searchers on one position; the bot fallback on the same position keeps the session useful; `queue_timeout` rate per bucket is on the dashboard (§10.3) and drives D21 |
| K2 | **Too few balanced legend positions** for the rated legend pool (legend moments are often winning for one side). | Medium · medium | The handicap (§8.6) allows positions up to ±150 cp; the build script fails with fewer than 3, and then the Online tab hides "Legend Position" (D6) |
| K3 | **Neon cold start** (≈ 1 s) and closed pooled connections on the first match insert after a quiet period. | Medium · low | `SELECT 1` prewarm on the first `queue:join` after ≥ 4 min of DB silence (§7.8); transient errors retried once on a fresh connection (§7.5) |
| K4 | **Socket deploys** drop the in-memory buckets. | Certain on deploy · low | Clients rejoin with `since`; P2's drain shows "Server update" and pauses new joins; deploys happen when the queue is empty (deploy runbook) |
| K5 | **Rating bug** (wrong constant, wrong guard) corrupts ratings. | Low · medium | One statement with an idempotent guard; the integrity check in `ratings.spec.ts`; `ratings.guard_retry` alert; the recompute tool rebuilds every rating from stored inputs (§6.10) |
| K6 | **The sign-up → onboarding → checkout loop loses `redirect_url`.** | Medium · high (it is the growth loop) | `challenge-signup-trial.spec.ts` nightly; `/join/` and `/s/` on the allow-list; P4's `rc_onb_next` |
| K7 | **Link previews blocked** by robots or by the auth middleware. | Medium · medium | `/join/` removed from robots disallow; pages public with `noindex` headers; the OG route outside the matcher; `og-challenge.spec.ts`; manual Slack/WhatsApp check |
| K8 | **Rating scale mismatch** between Chess.com seeds and our pool (users expect their Chess.com number). | Medium · low | RD 200–250 lets ratings move to their level in about 10 games; copy says "Replay Chess rating"; Lichess offsets are recalibrated after 4 weeks (D8) |
| K9 | **Edits to P1/P2/P3/P5/P8 files** collide with stream A's parallel work (feasibility §7: middleware, keys, next.config, schema, ci.yml, robots, `UserChannel`, `home.server.ts`). | Medium · medium | Registry directories where P1 made them; one owner per file (§13.2); `OWNERS.yml` labels; the P2 edits are small and additive; the `home.server.ts` edit is one import and one field, merged in a week with no P6 work on that file |
| K10 | **Two queues during rollout** (legacy DB queue with the flag off, socket queue with it on) never see each other. | Certain during rollout · low | Dev runs with the flag on for everyone; production gets the flag at P13 with no legacy users mid-search. Under Launch A it happens on live production: flip the flag at a quiet hour and keep it at 100 % from the start |
| K11 | **`/join/[gameReferenceId]` vs `/join/[code]`** cannot coexist as two dynamic segments. | Certain · low | One page dispatches by format (§7.6) |
| K12 | **Clipboard and Web Share quirks** (iOS Safari requires a user gesture; some desktop browsers lack `navigator.share`). | Medium · low | Copy runs inside the click handler; Share is hidden when unsupported; a select-the-field fallback |
| K13 | **Bot calibration does not converge** for the lowest rows (the weakening layer is noisy). | Medium · low | Per-row "≈" stays for rows outside ±75 after 3 rounds; the human check (D23) refines later |
| K14 | **P1 test tooling late** (personas, sink, state coverage, visual setup). | Medium · medium | §2.3 preflight names the gap; P9 uses the nearest equivalent and lists it in the sign-off; it never builds a second copy |

### 14.2 Decisions needed from the owner (defaults are what this plan builds)

| # | Question | Default |
|---|---|---|
| D1 | Rated by default, and which pools? (allocation owner decision 1; socket Q4; sys Q16) | Online always rated; Friend rated by default with a Rated switch; pools Bullet / Blitz / Rapid by `initial + 40 × increment` (30+0 is Rapid) |
| D2 | Must the invitee be a member? (allocation decision 2) | Yes (paid-only); the guest path goes through the 7-day trial |
| D3 | Does Decline close the link? (allocation decision 3; play-a Q3) | No: notify the creator, keep it open for someone else |
| D4 | Code length (the design shows 4 characters) | 8 Crockford characters |
| D5 | Online legend pool: one position of the day for every bucket, or one per time control? | One per UTC day for every bucket |
| D6 | Balanced-position threshold for rated legend games | ±150 cp with the handicap; positions beyond are never rated |
| D7 | Default rating when nothing is known | 1500 / RD 350 (Glicko default; onboarding normally provides a level) |
| D8 | Lichess → Replay offsets | Bullet −250, Blitz −200, Rapid −150, recalibrated after 4 weeks |
| D9 | Rated games per pair per 24 h | 3 finished, non-aborted games |
| D10 | Default colour | White on Legend (hero side), Bot and Friend; Random on Online |
| D11 | Public preview of `/s/<code>` for signed-out visitors | Yes, with the trial CTA |
| D12 | View counts on the owner's share view | None (no counters, D17); PostHog has the numbers |
| D13 | Queue error copy "Nothing was charged" | "No game was started." |
| D14 | "Play vs bot offline" in the queue's offline state | P11 owns it (C-10): `/play?tab=bot` when `engine:ready` and P11 Q15 = yes; P9 ships the slot |
| D15 | Match found on its own screen or on the game page | Its own state of `/play/online` (R10) |
| D16 | Who can watch a challenge game? | Any member, by P2's spectator rule (R21) |
| D17 | Phone back arrow on match found | Goes to `/play`; the game ends as a no-show and counts toward the abort limit |
| D18 | Persona names and quotes for 400, 800, 1600 and 2000 | The drafts in §8.11 |
| D19 | C2 timing | One release after `play-hub-v3` reaches 100 % in production (after P13, or after P9's own release under Launch A) |
| D20 | Merge time controls of the same group after 20 s of waiting | **On** (changed in revision 2, feasibility K1/D1); the widened banner and the match card say so. `MERGE_PRESETS_AT_MS = null` turns it off |
| D21 | Legend pool at launch (`online-legend-pool`) | On, because "Both players get the same famous position" is the product's designed default. Turn it off for a week when the legend buckets' `queue_timeout` rate stays above 50 % while the standard buckets' is below it; turn it back on when the member base grows (feasibility §10.15 item 2) |
| D22 | P9 before or after launch (feasibility "Launch A") | Before launch (allocation order); under Launch A only §6.5's production timing changes |
| D23 | Human check of the bot ladder | After 4 weeks of P9 data, as a follow-up (§8.12) |
| D24 | `GAME` preset τ = 0.75, RD floor 45, one inactivity period per 7 days | As in §8.6 (our choices inside Glickman's guidance, not copied from any other site's code) |

### 14.3 Rollback (feasibility §9)

| What | Rollback path |
|---|---|
| UI and routes | `play-hub-v3` off brings back the legacy `/play`, `/queue`, `/challenge/new` and `/join/<cuid>` pages until the deletion PR. The deletion is one PR merged last in the phase, so `git revert` of that single commit restores them. On Hobby, Vercel Instant Rollback reaches only the previous deployment, so the revert is the real tool after more deploys |
| Socket matchmaker | The queue is in memory: rolling the socket image back drops searches (clients see "Server update" and fall back to the hub). P9 adds no journal format, so P2's journal compatibility is unchanged |
| Ratings | `rated` stays true on new games, but a bad rating fragment can be neutralised by setting `RATINGS_APPLY=off` on the socket (the finish then omits the `pr` fragment and sends `ratings: null`); the recompute tool (§6.10) then rebuilds every pool from stored inputs. Seed rows can be re-run (the backfill is idempotent) |
| Schema | M9 is expand-only; the previous code ignores the new tables and columns. Nothing is dropped until C2, which needs the owner's confirmation |
| Flags | `online-legend-pool` off steers everyone to the standard start without a deploy; `MERGE_PRESETS_AT_MS = null` needs a socket redeploy |
| Data written | Challenges and position shares are user data; a rollback keeps them (the old code never reads them). Legacy rows in `matchmaking_queue` are untouched |

---

## 15. Definition of done

**Deployed and flagged**
- [ ] Merged to `dev`; Vercel `replay-chess-dev` green; the OCI dev socket redeployed by `deploy-oci.yml`; the Neon dev branch on M9 through `prisma migrate deploy`; the §6.3 grants run; `NEXT_PUBLIC_SITE_URL` set on the dev project.
- [ ] `play-hub-v3` on for the owner and E2E users A–P and R on dev; `online-legend-pool` on.
- [ ] The rating seed backfill run on dev (`--dry-run`, then `--apply`), with the verification query recorded in the PR; `recompute --dry-run` on dev reports 0 differences.

**Screens**
- [ ] All 20 boards have a reachable route; `state-coverage` shows 0 missing P9 states, and every demo-only state has a written reason (§4.10, testing X8).
- [ ] One-viewport and tap-target assertions pass on the 4 PR projects and nightly on all 40 device × zoom projects for every P9 route, plus the real-route layer; the golden board sizes hold (soft).
- [ ] The lit slots in §4.9 show real values (result card, resign confirm, game header, player bars, archive, Home, shell), the bot chip tooltip is gone for calibrated rows, and the new menu items appear behind the flag.
- [ ] Visual baselines (§12.6) committed.

**Behaviour**
- [ ] No request to `/api/matchmaking/*` anywhere; zero Neon statements while searching (verified with `pg_stat_statements`); exactly one statement per match.
- [ ] Presets of one group merge only after both searchers waited 20 s; the older searcher's preset is used.
- [ ] Parallel accepts produce exactly one game; a repeat accept by the winner returns the same game.
- [ ] Ratings: both players updated inside the one finish statement; the stake shown in the resign confirm equals the delta applied; aborted and no-show games leave ratings untouched; the `ratings.spec.ts` integrity check passes.
- [ ] The signed-out → sign-up → trial → back to `/join/<code>` loop works on dev with the Dodo test card.
- [ ] `/play/friend?opponent=@<name>` and `/play?tab=friend&opponent=<name>` both open the labelled Friend tab (coverage C-11; P10 informed of the URL).
- [ ] Revoking a share returns 404 and purges the CDN copy and the OG image.
- [ ] The durable limits (daily challenge and share caps) hold after `rate_limit_buckets` is emptied.

**Quality gates**
- [ ] CI green on the final `dev` SHA with `BILLING_PAYWALL=on`: lint, `check-types`, unit (§12.1), contract (§12.2), socket integration (§12.3), the drift gate and index-existence check, the bundle budgets (§9.5), `check-test-globs`, `prod-guard.spec.ts` for the P9 hooks.
- [ ] Playwright §12.4 specs green: the `@smoke` set in `ci.yml` and against the dev URL after deploy; the full set and the `@slow` real-timing and sign-up specs in the nightly run. Queue specs isolated by `e2eRun` (or the serial `play-queue` project on the dev URL); timers on the fast profile; no shared letter user mutated.
- [ ] Every §10 event is registered and asserted through the sink (exactly once for server events); the PII guard is green (no FEN, note or raw code).
- [ ] k6 `queue-socket.ts` and `api-challenges.ts` meet §12.10, with their JSON results in `perf/results/`; `EXPLAIN` plans match §9.2 on the perf branch.
- [ ] `error-window.ts` shows no new Sentry issues and no new Vercel 5xx for at least 24 h after the last dev deploy, or each one is triaged in the sign-off.
- [ ] Every defect found in the owner test or on a device has a `regression:` test; `quarantine.json` has no expired entries.

**Owner test and devices**
- [ ] §1.3 passes on the dev URL with ego-browser, and on a real iPhone and a real Android phone (steps 1, 2, 6 and 11).
- [ ] Link previews verified in Slack and WhatsApp (§12.9 item 2).
- [ ] `REPO/docs/qa/phase-09-signoff.md` committed (SHA, deployment id, image tags, screenshots, devices, the coverage table, the error window, k6 links, defects).

**Clean-up (parity check, then delete inside this phase)**
- [ ] Parity checklist signed off: quick match, friend challenge from the start and from a legend position, accept signed in and out, bot from the hub, legacy link redirects.
- [ ] The deletion PR merged last: every path in §7.10 deleted; the WP-I grep returns nothing; `RETURN_PATH_PREFIXES` no longer lists `/queue` or `/challenge`.
- [ ] C2 prepared as a migration file in a separate PR, **not** merged, with the owner-confirmation note (§6.7).

**Docs and handoffs**
- [ ] `docs/implementation-plan.md` links to this spec; `docs/api/openapi.json` and `docs/api/socket-events.md` regenerated; the owner decisions D1–D24 recorded with their answers.
- [ ] Handoffs recorded in the receiving specs: P10 (profile Challenge URL, `opponent` lookup, `user:<ref>` OG purge, rating history reads `game_players` with the Rapid/Classical rule), P11 (`offlineAction` row, return-target resolvers and their cache tag), P12 (`GAME` preset and the finish fragment for tournament games; one live rated game per user).

---

## Appendix A. Critique dispositions

Every finding in the five critiques that concerns P9. "Applied" names the section that now carries the fix. "Rejected" gives the one-line reason. IDs are the critiques' own; `cons` = critique-consistency, `cov` = critique-coverage, `feas` = critique-feasibility, `test` = critique-testing, `perf` = critique-api-perf.

### A.1 Coverage (`critique-coverage.md`)

| Finding | Disposition |
|---|---|
| C-11 (High) profile [Challenge] → undefined `/play/friend?opponent=@{u}` | **Applied**: canonical `/play?tab=friend&opponent=<username>`, `/play/friend` 308s there keeping the query (R31, §4.1, §7.6, §4.9 handoff, `play-friend-hint.spec.ts`) |
| C-10 (High) queue `offline` "Play vs bot offline" orphaned in P11 | **Applied on P9's side**: the P11 row and target are spelled out (§2.2, §4.9) and `QueueCard` ships the `offlineAction` slot (§4.2). The rendering stays P11's, conditional on its Q15 |
| C-17 (Low) "Watch another game" deferred both ways | **Applied**: P2's final spec builds it and withdrew trim 13.4; §2.2 records that P9 has no conditional work |
| C-15 (Medium) bot calibration has no owner | **Applied**: P2 rev 2 handed it to P9 (H-06); §8.12 and WP-J |
| C-21 (Medium) B26 open, so the `V3PlayHub` ended-membership row is demo-only | **Rejected for P9**: B26 is an owner decision P9 cannot take; the hub's `limit` state is reachable from a real 402 mid-session and from `/dev/ui/play/hub?state=limit`, which the state-coverage reason records |
| §5 documented deviations (P9:410 accept `paywalled` "Ask for a game from the start", P9:341 queue prototype links) | **Kept** as recorded deviations (§4.2, §4.5, §11.4); no change |
| Flow edges E27–E31, E44–E45, E52 | Confirmed OK; links unchanged |

### A.2 Consistency (`critique-consistency.md`)

| Finding | Disposition |
|---|---|
| 9.1 `playedAt`, `SELECT rating`, `…playedAt…` index | **Applied** with `endedAt` and `game_players_userId_endedAt_gameId_idx` (R17, §6.4). One part **rejected**: the "since Monday" start value is `ratingBefore` of the first rated game of the week, not `ratingAfter`, because "1176 → 1184 since Monday" starts before that game |
| 9.2 R3 column names | **Applied** (R3) |
| 9.3 `game_players_h2h_idx` missing from M2 | **Applied**: created in M9 on `endedAt`, in `protected-indexes.txt` (§6.3) |
| 9.4 `packages/domain` not created by P1–P3 | **Applied**: WP-A creates it with `package.json`, `tsconfig.json` and the `transpilePackages` entry (§8, §13.2) |
| 9.5 R11 hedge | **Applied** (R11, §7.4) |
| 9.6 HMAC headers → `x-internal-token` | **Rejected**: P2 rev 2, the receiver's owner, chose HMAC through one helper (P2 §0.2, §7.5.1), as api-perf AP-44 and feasibility #5 also ask; P9 calls `internalFetch()` and writes no header, so it follows whatever P2 ships. The env-name part is **applied** (`INTERNAL_API_SECRET`, no `INTERNAL_HMAC_SECRET`) (R18) |
| 9.7 `http/errors.ts`, codes "added if P1 has not", reasons | **Applied** (R19, §7.2) |
| 9.8 no limit on `PATCH /api/me/preferences` | **Applied**: `prefs` 120 / 60 s (§7.1) |
| 9.9 `queue:matched` in the allocation | No P9 change (allocation edit); R1 stands |
| 9.10 "A–R" users | **Applied**: "A–P and R" (§0, §6.8, §15) |
| 9.11 `INTERNAL_ROUTE_PATHS` → `INTERNAL_ROUTE_IDS` | **Rejected**: that line describes today's code, where the constant really is `INTERNAL_ROUTE_PATHS` (`WEB/lib/auth/resolve-user.ts:21`); P1's new name is added in brackets (§3.2) |
| R-05 dotted `notify.dispatch` | **Applied**: `NOTIFY_DISPATCH` (§2.2) |
| R-07 `rooms.ts` owner, registry, `queue:matched`/`queue:moved` in the catalogue | **Applied**: preflight check, registry entries (§2.3, §7.3) |
| R-10 finish module path | **Applied**: `PKG/db/src/live/finish.ts` fragments (§8.6) |
| R-13 limits as `limit / windowSec` | **Applied** (R30, §7.1) |
| 10.4 keep `consent Json?` | Already in M9; comment added (§6.2) |
| 10.5 no `train` section in `PreferencesV1` | **Applied**: stated in R12 and §6.2 |
| 10.6 `RatingEvent` in P10's dependencies | P10's edit; P9 states the rating history source in §2.2 |
| 1.5 `prefs` not in `MeData` | Consistent already (ME-3a, `qk.prefs()`) |
| R-18 `match_found` analytics name | Consistent (`match_found_viewed`) |
| R-20 no `db push` on any Neon branch | **Applied** wording (§6.5) |

### A.3 API, data layer and performance (`critique-api-perf.md`)

| Finding | Disposition |
|---|---|
| AP-44 internal auth split; note the P2 receiver dependency | **Applied**: P2 rev 2's HMAC helper and kid allow-list (R18, §7.4) |
| AP-41 token minting reads the DB | **Applied**: the `r` claim when the layout mints; a one-statement cold-cache read on `queue:join` when a refreshed token has no `r` (§7.7, §12.3 item 14) |
| §4.14 item 3 / AP-07 "since Monday uses the `playedAt` index" | **Rejected**: P2 rev 2 kept `endedAt` (P2 §0.2, consistency R-01), so P9 uses `game_players_userId_endedAt_gameId_idx`; the live-game check keeps `games_open_idx`, as AP-07 asks |
| AP-03 public-plus-viewer caching | Already compliant (CHL-2, SP-2 public only, `isOwn` on the client); the registry lint test is added (§12.2) |
| AP-04 private caching | Compliant: per-user P9 responses are `private-etag` or `no-store` (§9.3) |
| AP-05 immutable OG images that cannot be purged | **Applied**: OG-2 tagged `share:<code>`, purged on revoke, browser copy 5 min; OG-1 tagged with the creator for P10 (§7.1) |
| AP-11 long windows on the UNLOGGED table | **Applied**: durable daily caps counted from `challenges` and `shares` rows (R30, §6.4, §7.1) |
| AP-12 zod in client bundles | **Applied**: `devSchema()` and the `ZodError` bundle check (§5.2, §9.5) |
| AP-14 headers from RSC pages | **Applied**: `X-Robots-Tag` from `next.config.js` `headers()` (§7.6) |
| AP-15 consent-gated SLOs | **Applied**: server-side metrics as the source (§9.7) |
| AP-16 socket payload sizes | **Applied** by analogy: `queue:matched` slimmed to ≤ 300 B, named size-test exceptions (§7.3, §9.4) |
| AP-18 Neon closes idle connections | **Applied**: transient retry for `createMatchedGame`, prewarm kept (§7.5) |
| AP-24 duplicate `prefs:updated` refetch | **Applied** (WP-H, §5.4) |
| AP-25 reconnect resync burst | **Applied**: the share page refetches only on a reported gap (§5.3) |
| AP-29 return-target leaks | **Applied**: P9's resolvers return no FEN for revoked or unknown codes and share the cache tags (§4.9) |
| AP-35 budgets without formulas | **Applied** for P9's own budgets (§9.1, §9.7) |
| AP-39 `entitlement:changed` refresh in every tab | **Applied** (§5.5) |
| AP-01 dev on the production Neon project | **Applied** as a precondition for P9's k6 and nightly runs (§2.3, §9.8) |
| AP-08 timers that keep Neon awake | Compliant (no timers; daily `HOUSEKEEPING` slice) |
| AP-09 side-effecting GETs | Compliant; stated as a rule (§7) |
| AP-19 archive ETag misses rating deltas | Covered if P2/P3 bump `gamesVersion` in the finish, because the rating write is in the same statement (§8.6) |
| AP-36 `rating_events` in api-design §9.2 | Not a P9 document change; R3 stands |
| §5 CI gates (index existence, name registry lint, GET purity, bundle) | **Applied** for P9's indexes, rooms, GETs and routes (§6.5, §7, §9.2, §9.5) |

### A.4 Feasibility and risk (`critique-feasibility.md`)

| Finding | Disposition |
|---|---|
| #11 / §10.15.1 two `glicko2.ts` creators | **Applied**: one parameterised module, `GAME` preset (R23, §8.6) |
| §10.15.2 K1/D1 launch with 3 pools, open the legend pool later | **Partly applied**: preset merging after 20 s (D20 now on) and the `online-legend-pool` flag, which gives exactly the 3-pool configuration as an owner switch with the 50 % rule (D21). **Rejected** as the default: turning the legend pool off at launch removes the designed default Online mode, and with a small paid base the standard buckets may also stay above 50 %, so the legend pool would never open |
| §10.15.3 append-only `rating_events` or documented recompute source | **Applied**: seed anchors plus the recompute tool (§6.10) |
| §10.15.4 rollback subsection | **Applied** (§14.3) |
| LIC-4 "verify against lila before coding" | **Applied**: clean-room rule, constants from Glickman and our own choices, `CLEANROOM.md` (§8.6) |
| LIC-5 `THIRD_PARTY.md` | Kept (§7.11) |
| #4 `HOURLY_TICK` | Compliant (§7.8) |
| #5 / §6 canonical names, HMAC from P2 | **Applied** (R2, R18) |
| #8 device matrix against the deployed dev site | **Applied**: nightly matrix on a CI-local build (§12.5) |
| #15 calendar, buffer, Launch A | **Applied**: 20 % buffer line and the Launch A note (§0, §6.5, §13.3, D22) |
| §7 shared registries edited by concurrent phases | **Applied**: registry files or one additive edit with `OWNERS.yml` (§13.2, K9) |
| §9 rule 1 enum values take two releases | Not needed: M9 adds no value to an existing enum (§6.1) |
| §9 rule 3 legacy screens stay one release | **Partly applied**: deletion stays inside P9 as the allocation's DoD requires, but as one isolated PR merged last, so a single revert restores the legacy pages (§7.10, §14.3) |
| #13 Neon suspends close idle pool connections | Covered by P2's pool rules plus the transient retry (§7.5) |
| F-NEON-2 daily planner instead of fixed ticks | **Applied**: P9's two statements are one `RecurringSlice` in P3's directory, run by the `HOUSEKEEPING` row that P3's `DAILY_PLAN` schedules (§7.8) |
| #3 `VERCEL_ENV` gates | Compliant: P9 hooks use `isNonProd()` / `APP_ENV` (§7.9) |

### A.5 Testing and DoD (`critique-testing.md`)

| Finding | Disposition |
|---|---|
| Queue pool isolation | **Applied**: `e2eRun` bucket prefix, serial `play-queue` project on the dev URL (§7.3, §12.4) |
| Timers wait a real 60 s | **Applied**: `TIMING_PROFILE=fast` values plus nightly `@slow` real-timing copies (§7.9, §12.4) |
| Persona collisions; the open-link cap needs a leased user | **Applied**: shared letters only add data; `challenge-cap`, `ratings-fresh`, `share-cap` personas (§6.8, §12.4) |
| Telemetry "test proxy" | **Applied**: P1 sink assertions with `telemetry.forbid()` for code, note and FEN (§12.0, §12.4) |
| `og-challenge.spec.ts` with `immutable` in `cache-control` | **Applied**, except the `immutable` assertion, **rejected**: api-perf AP-05 needs purgeable OG images, so the spec asserts the §7.1 headers instead |
| Rating integrity check ("the sum of deltas equals the change") | **Applied** with a corrected formula: per-user `ratingAfter − ratingBefore = ratingDelta` and the latest `ratingAfter` equals the stored rating; Glicko deltas are not zero-sum, so a sum check would fail on correct data (§12.4) |
| Visual baselines | **Applied** (§12.6) |
| DoD additions (isolation, fast timers, telemetry, OG spec, visual) | **Applied** (§15) |
| X1 test layout and globs | **Applied** (§12.0) |
| X2 CI on `dev`, `@smoke` tags | **Applied** (§12.0) |
| X3 paywall on | **Applied** (§12.0, §15) |
| X7 console guard | **Applied** (§12.0) |
| X8 state-coverage tags | **Applied** (§12.0, §15) |
| X9 tiering, stress data, real routes | **Applied** (§12.5) |
| X11 `@p9` tags and `flags-off` | **Applied** (§12.0, §12.8) |
| X12 test-hook registry | **Applied** (§7.9) |
| X14 regression tests per defect, quarantine | **Applied** (§12.0, §15) |
| X15 sign-off record | **Applied** (§12.0, §15) |
| X16 Docker Postgres in CI | **Applied** (§12.0) |
| X18 k6 results as data | **Applied** (§12.10) |

### A.6 Corrections found while revising, and alignment with the other phases' final specs

| Was | Now | Why |
|---|---|---|
| Quick-match insert wrote only `games`, with `phase 'waiting'` and no `expiresAt` | One CTE with both `game_players` rows, `'WAITING'::"LivePhase"`, `expiresAt` set (§8.2.7) | P2's model needs the player rows from creation; the enum is upper case; `expiresAt` is `NOT NULL` |
| Rating write as a second statement with a `FOR UPDATE` re-read inside the finish | A fragment of P2's single-statement finish, plus an extension of P2's `gp` SET list; a separate `repairRatings()` for the never-path (§8.6) | P2's finish is one statement; two CTEs cannot update the same row |
| `u.username`, `u."profileImageUrl"` in the public projection | `u.name`, `u."profilePictureUrl"`; `username` null until P10 (R24) | The columns do not exist in P9 |
| A `watch` code on `game:join` | P2's `spectate:join` rule (R21) | P2 already lets members watch FRIEND games |
| `GET /api/positions/search`, `getPracticePosition(id)` | CAT-5 and `getPosition(slug)` (R14, §6.4) | P8's real interfaces |
| `/position/[referenceId]` 308 created by P9 | P8's (R26) | P8 D8-12 |
| `WEB/lib/data/home.ts`, `lib/navigation/return-to.ts` as P4/P5 files | P5's `home.server.ts`; P11's resolver with P9's `return-targets/play.ts` (R27, R28) | The real owners |
| Shares and challenges with one upper-case code format | Two formats (R25) | P3's `shares.code` is lower case |
| `shares_owner_idx` assumed to exist | `shares_owner_created_idx` created in M9 (§6.3) | P3 has no such index |
| The pair cap counted aborted games | Only WIN, LOSS, DRAW (§8.5) | No-shows must not use up a pair's rated games |
| `timeClass` and the rating pool treated as the same value | 30+0 is stored `CLASSICAL` and rated in `RAPID` (§8.1) | P2's classifier |
| No socket and worker grants for the new tables | §6.3 grants | P2's `replay_realtime` and P3's `replay_worker` are least-privilege roles |
| `listPracticePositions()` | `positionsVolume()`, with `upcoming` items left out of the picker | P8's final spec renamed the loader |
| Housekeeping statements in a P3 task list | A `RecurringSlice` file in `WK/src/scheduler/recurring/`, run by the `HOUSEKEEPING` row that `DAILY_PLAN` schedules | P3's final spec (P3-D22) |
| `HomeData.stats.rating` | `HomeData.stats.ratingLabel` | the name P5's final contract reserves |
| `public-static` GETs left under Clerk's middleware with a fallback path | CHL-2 and SP-2 listed in `NO_CLERK_API` | P1's final tier rule for `public-static` |
| Return-target entries edited into a P4 file | registered by WP-F when `return-to.ts` exists, else by P11; P11's D23 kinds | P4 and P11 disagree on who creates the file |
| Queue offline CTA target `/play?tab=bot&offline=1` | `/play?tab=bot`, shown when `engine:ready` and P11 Q15 = yes | P11's final §2.4 row |
