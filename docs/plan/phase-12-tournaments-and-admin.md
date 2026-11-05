# Phase 12: Tournaments and admin, detailed plan

Status: plan, revision 2 (after the five critiques), 2026-11-02. Branch `dev` at `0848b76`. Size: 18.25 dev-days measured (allocation §0 says 17), plus a 20 % buffer line of 3.75 days (§13). 21 boards. Feature flags: `tournaments-v3` (allocation §1.6) and `admin-v3` (new; registered in `WEB/lib/flags/registry/p12.ts` and added to allocation §1.6, critique-consistency R-14).

**Goal in one line.** Tournament scheduling, pairing and standings move onto the socket server, where they are pushed instead of polled. The v3 tournament screens and the admin console ship on authenticated, typed APIs.

**Path shorthands** (as in `allocation.md`; one table for the whole plan set, critique-feasibility §10.6)

| Short | Path |
|---|---|
| `REPO` | `/Users/rohitpandit/open_source/chess-battle-turbo` |
| `WEB` | `REPO/apps/web` |
| `WS` | `REPO/apps/web-socket` (protocol v2 since P2; code lives under `WS/src/`) |
| `WK` | `REPO/apps/analysis-worker` (P3) |
| `PKG` | `REPO/packages` |
| `DB` | `REPO/packages/db` (Prisma schema, migrations, seed and the socket's direct-write module `DB/src/live/*`, moved out of `WEB/prisma` in P2) |
| `CT` | `REPO/packages/contracts/src` (zod 4 contracts, `@repo/contracts/{http,socket,internal}/<file>`) |
| `DOM` | `REPO/packages/domain/src` (server-only use cases; **created by P9**, P12 adds `DOM/tournaments/*`, critique-consistency R-10) |
| `SP` | the planning session's scratchpad, archived scratch inputs that are not in the repo and may no longer exist (see [99-open-decisions.md](99-open-decisions.md) A12) |
| `DR` | `SP/design-ref/project/v2` (board files `*.dc.html`) |

**References.** "acct §5.0" points into `SP/plan/inv-acct.md`. "API §4.12" is `SP/plan/api-design.md`, "DM §5.9" is `SP/plan/data-model.md`, "CDL §5.5" is `SP/plan/client-data-layer.md`, "OPT §3.6" is `SP/plan/optimization.md`, "ARCH" is `SP/plan/architecture.md`, "ALLOC" is `SP/plan/allocation.md`. Phase specs are "P2 §6.6.4" (`SP/plan/phase-02.md`). Audit findings keep their own ids (`AA F-24` audit-api, `ADB DB-05` audit-db, `AS F-24` audit-socket, `AC #8` audit-client, `AQ SEC-05` audit-quality). Critique findings are cited as **CC** (`critique-coverage.md`, C-nn), **CS** (`critique-consistency.md`, R-nn rulings and fix 12.n), **CF** (`critique-feasibility.md`), **CTe** (`critique-testing.md`, X-nn) and **CA** (`critique-api-perf.md`, AP-nn). Appendix A lists every critique finding that concerns this phase and what this revision did with it. Line numbers are from `dev` at `0848b76` unless a later phase owns the file.

**Column names.** All SQL in this plan uses the columns P2's M2 actually creates (CS R-01): `games."whitePlayerId"`/`"blackPlayerId"`, `games."endMethod"` (`GameEndMethod`), `games.outcome` (`GameWinner`), `games.fen`, `game_players."endedAt"`, `game_players."ratingBefore"/"ratingAfter"/"ratingDelta"`, `game_players."opponentUserId"/"opponentName"/"opponentRating"`. There is no "substitute at branch time" step.

---

## 0. Decisions this plan makes (read first)

The sibling plans disagree on several names and mechanisms for this phase. These decisions resolve them for P12. Each one is cross-referenced from the section that uses it; the ones that ask another document to change are repeated in §14.4.

| # | Topic | Inputs that disagree | Decision for P12 | Why |
|---|---|---|---|---|
| D12-1 | Pairing record | ALLOC P12 and API INT-10: `TournamentPairing` table. DM D21: no pairing table | **No `TournamentPairing` table.** A pairing is the `Game` row plus its two `GamePlayer` rows, created at pairing by P2's `createLiveGame(tx, …)` (`DB/src/games/createLiveGame.ts`). Per-side points live in `GamePlayer.tournamentPoints` / `tournamentFire`, which **M12 adds unconditionally** together with `Game.tournamentPositionOrder` and the two partial indexes (CS R-01, fix 12.2; P2 does not ship them). Scoring cannot run twice because it is a clause of P2's one-statement finish, which is guarded by `status = 'IN_PROGRESS'` | DM D21; one table fewer; the finish guard already exists |
| D12-2 | Invites | ALLOC and acct §10.1: `TournamentInvite` table. DM D21: `Tournament.inviteCode` column | **`Tournament.inviteCode`** (8 chars, Crockford base32) plus an optional **signed inviter tag** `i=<sqid(userId)>.<hmac6>` in the link, so "You're invited by vera_b" works with no table | Attribution is display-only; the HMAC tag makes it unforgeable; DM D17 avoids counters that wake Neon |
| D12-3 | Admin activity | ALLOC and API §4.13: `AdminActivity`. DM D15: `AuditLog` | **`AuditLog`**, created in **M4 by P4** with `WEB/lib/audit.ts` (CS R-04, fix 12.3). P12 only writes and reads it. The dashboard feed reads `category IN ('TOURNAMENT','BILLING','CONTENT','ACCOUNT','MODERATION','SYSTEM')` | One audit table for admin, billing and account events; it exists before its first writer |
| D12-4 | Who writes tournament rows | ALLOC B4: the socket writes Neon directly. API API-09, DM D22, OPT D2: through internal web routes | **Scoring is a clause of P2's direct finish statement** (B4; the socket gets the result in the same round trip). **Pairing, start, delay, cancel and finalize go through `/api/internal/tournaments/*`.** This is a recorded exception to B4 (CS R-11, fix 12.14): ALLOC B4 and API §4.14 get one line each (§14.4) | Lifecycle writes need `revalidateTag`/`invalidateByTag`, `audit()`, PostHog and P10's notification producers, which exist only on web. Pairing stays beside them so every tournament-row write other than scoring lives in one module (`DOM/tournaments`) with one test harness. Scoring must be atomic with the game finish |
| D12-5 | HTTP find-match fallback | API TOU-10 and acct #50: keep a DB-pairing fallback | **Not built.** If the socket is down, the arena shows "Reconnecting to the arena" and Find Match is paused. socket.io already falls back to HTTP long-polling | A paired game cannot be played without the socket server, so a DB pairing fallback only creates games nobody can play. It would also bring back the `isSearching` writes behind AA F-08 and ADB DB-05 |
| D12-6 | Rooms and event names | ALLOC §5.2 `tournament:{ref}`; API §6.3 `t:{slug}`; CDL §5.3 `tournament:join_room` | Room **`tournament:{slug}`** through `ROOM.tournament(slug)` in `CT/socket/rooms.ts` (P2), and P2's **`user:{ref}`**. Commands **`tournament:watch` / `unwatch` / `find_match` / `cancel_search`**. Event names go into P2's single server→client registry `CT/socket/registry.ts`; payload schemas into `CT/socket/tournament.ts` (CS R-07, fix 12.9). The new events `tournament:search_ended` and `tournament:updated` are added to ALLOC §5.2 | B20 `domain:event` naming; the slug is immutable and already in the URL |
| D12-7 | Page routes | ALLOC P12: `/t/[slug]`, `/t/[slug]/join`, `/t/[slug]/results`. acct §1.1: `/tournaments/[slug]`, `/join-tournament/[code]` | **ALLOC's routes.** `/tournaments/:slug`, `/tournament/:ref` (legacy) and `/join-tournament/:code` (legacy, and the short share link) redirect to them (§4.0) | ALLOC binds the phase lists; short share URLs |
| D12-8 | Invite-only meaning | acct §5.1 hides invite-only tournaments | **"Invite link only" controls who can join, not who can look.** Invite-only tournaments are unlisted: they are hidden from the list unless you are registered, but the snapshot, standings and results are readable by slug. The invite code itself is never in a public response | It matches the design label "Who can join" and keeps every read cacheable |
| D12-9 | Public read access | Phase 0: non-members are redirected from app routes. acct Q3 and the boards (`free`, `paywalled`): "watching and results stay open" | **Default: lists, lobbies, live arenas (watch only) and results are readable by signed-out visitors and lapsed members.** Joining, Find Match and spectating a game need membership. **Owner decision O12-6** (§14.2) | The `free` and `paywalled` board states only make sense with read access |
| D12-10 | Scheduler timers and reminders | acct §8.3: re-read the schedule every 60 s; API §8.4: a 1-minute `tournament.reminders` timer | **Boot load + push from web (`POST /internal/tournaments/schedule`) + an hourly re-sync served from the Vercel Data Cache.** The T−5 min reminder is **future-dated work**, not a tick (CA AP-08): the push/email reminder is a P10 `Notification` row written at join with `runAt = startsAt − 5 min` plus a `NOTIFY_DISPATCH` job at that minute; the in-app toast comes from the socket's own timer and its in-memory participant list. No query reaches Neon unless a tournament changed | A 60 s poll keeps Neon awake around the clock: 0.25 CU × 720 h = 180 CU-h, over the 100 CU-h Free allowance (OPT §1.1, CA AP-08) |
| D12-11 | Folded and dropped endpoints | API TOU-5 (invites), TOU-8 (top board), acct #52 (`/api/games/{ref}/tournament-result`), API INT-12 (blocks), the first draft's INT-11c (remind) and INT-12 (pool entry) | TOU-5 → `me.inviteUrl` in TOU-7. TOU-8 → the `tournament:watch` ack plus a DB hint in the snapshot. #52 → the `tournament` block of P2's `getGameSnapshot()`. **INT-12 pool entry is dropped:** the searcher's rating and membership come from the socket token's `r` and `ent` claims (P9 §7.7, P2 §7.4.2), colour counts and last opponent from the socket's standings mirror, blocks from P10's socket block loader (P10 §7.4, 60 s cache). **INT-11c remind is dropped** (D12-10) | Fewer invocations; the first Find Match costs no HTTP hop |
| D12-12 | Finalize | acct §8.3: a `tournament.finalize` worker job | **Inline in `POST /api/internal/tournaments/{slug}/finalize`** (≤ 256 rows, 4 statements). The daily cron is a backstop | Every game is already analysed by P3's auto-enqueue at finish; nothing heavy is left |
| D12-13 | Ranking order | acct: `score DESC, gamesPlayed, id`; legacy code: `points DESC, wins DESC, gamesPlayed ASC` | **`score DESC, gamesPlayed ASC, joinOrder ASC`** everywhere (SQL window, socket mirror, finalize). `joinOrder` is a per-tournament counter assigned inside the join transaction under the tournament row lock, so it is unique and equals commit order. Ranks are computed on the server only (SQL for HTTP reads, the socket mirror for deltas); the client places changed rows at the ranks the delta carries and needs no tie-break key | One deterministic order (fixes the rank mismatch, ADB §8.6 / AA F-24). `id` order can differ from commit order across concurrent joins, and the socket learns of joins through `after()` emits that can arrive out of order |
| D12-14 | Match found (flow-map edge E83) | The flow map draws `V3MatchFound` (N84) between the arena and the game | **Built as the `matched` state inside `V4TournamentLive`**, which the board enum supports. Recorded as a deliberate deviation (CC §3 note, §5 table) | The arena keeps standings and the top board on screen while the 5 s count runs |
| D12-15 | Internal service auth | CS R-08: static `x-internal-token`; CA AP-44 and CF SEC-4: HMAC; ARCH §3.2.4 and API §2.11.6: HMAC | **P12 never builds a header itself.** Every internal call uses the shared helper `CT/internal/auth.ts` (`internalFetch()` on the caller, `verifyInternal(req, { caller })` on the receiver). The helper is HMAC (`x-rc-kid`, `x-rc-ts` within ±60 s, `x-rc-sig` over `ts\nMETHOD\npath\nsha256(body)`) per AP-44, keyed from the one env name `INTERNAL_API_SECRET` (CS R-09). If the owner keeps the static token, only the helper changes | Two of three critics and both cross-cutting documents choose HMAC; P12 code is identical either way |
| D12-16 | Arena search vs quick-match queue | API: `already_queued` error both ways. P9 L982: "the newest tab wins", `already_queued` is not used | **The newest search wins, in both directions.** `tournament:find_match` removes the user from P9's queue (`queue:moved` to the old socket); P9's `queue:join` removes the user from every arena pool (`tournament:search_ended { reason: "moved" }`). A user searches in one arena at a time; a new `find_match` in another arena moves the search | Matches P9's shipped behaviour; no new error code |
| D12-17 | Cache tier names | API §2.12 T0–T3; ARCH T1/T2 with other meanings | **OPT §4.2's six names, as P1's wrapper implements them:** `public-static`, `public-short`, `private-etag`, `no-store` (plus `public-immutable`, `sse`, unused here) (CA §1) | "T1" means different things in two documents |
| D12-18 | Arena size cap | O12-11 default 256 players; CF 10.18.1: no Stage B resize after P13 D7 | **`TOURNAMENT_MAX_PLAYERS = 64`** (server-enforced in ADM-8 validation) until the 256-player k6 run passes on the 1-OCPU dev socket box (§9.7); then the env var is raised. The board copy "Between 2 and 256" reads "Between 2 and {cap}" | The socket box cannot be resized for free after P13 D7 |
| D12-19 | "Tell me when one opens" (`V4TournamentsEmpty`) | P12 linked it to `/settings/notifications#tournament_new`; P10 has no such row and neither does the `V4SettingsNotifications` board (CC C-14) | **Not built in P12.** The empty state's second line ends at "New arenas open most evenings." **O12-14** offers the costed alternative (a push-only `tournament_new` channel, about 0.5 d) | The settings design has no row for it; a broadcast alert per tournament needs owner sign-off on volume and the Resend budget |
| D12-20 | Podium milestone and the "Tournament starting" row | P10 says P12 lights `TOURNAMENT_PODIUM` and the notification row (CC C-23, C-24) | **P12 lights both:** finalize enqueues P10's `MILESTONES_EVALUATE` for the podium and P12 adds the `TOURNAMENT_PODIUM` evaluator to `WEB/lib/milestones/definitions.ts`; the "Tournament starting" row in Settings › Notifications and the "Tournament starts" toggle in the push prompt become visible when `tournaments-v3` is on (§2.4) | P10 deferred both to this phase |

---

## 1. Goal and user-visible outcome

### 1.1 What changes for a user

- **Tournaments list** (`/tournaments`): Live, Upcoming and Finished tabs, a selected-tournament aside with the position board and rules, and "YOU'RE IN" markers. Renders for everyone (D12-9).
- **Join from invite** (`/t/{slug}/join`): "You're invited by …", countdown, capacity, then join in one tap. Invite links survive sign-in and checkout (`autojoin=1`).
- **Lobby** (`/t/{slug}` before the start): the countdown runs on its own, and players appear as they join (JUST JOINED) with no reload. A host or admin can Start Now.
- **Live arena** (`/t/{slug}` while live): Find Match → "Finding an opponent near 1184 · 0:07" → match card → auto-navigate into the game. Standings move on their own. The top board streams at up to one update a second.
- **Tournament game**: V3Game with the tournament strip ("Friday Opera Arena · 18:42 LEFT · YOU'RE 3RD · 14 PTS") and a game-over card with "+2 points · 3rd of 24 · 18:42 left in the arena", Find Match and Back to Arena.
- **Results** (`/t/{slug}/results`): podium, your placement, your games with points, and frozen final standings with 2× marks. A podium finish adds "Top 3 in {name}" to the profile Milestones tab (when P10 has shipped).
- **Reminders**: five minutes before a tournament you joined starts, an in-app toast (always) and a push or email (when P10 has shipped and the "Tournament starting" channel is on).
- **Admin console** (`/admin`, desktop): dashboard tiles (live games from the socket), activity feed and health; positions with a live FEN check; legends with portrait upload (source and licence recorded); tournaments list; create and edit tournament with validation; a minimal Reports queue.

### 1.2 What changes underneath

- The 2–4 s `find-match` POST poll (`WEB/app/tournament/[tournamentReferenceId]/FindMatchButton.tsx:68-95`) and its write transaction (`WEB/app/api/tournament/find-match/route.ts:100-183`) are gone. Pairing happens in memory on the socket server every second, and one batched internal call creates the games.
- The "refetch the whole tournament on every socket event" pattern (`WEB/lib/hooks/useTournamentLobby.ts:89-99,137-141`) is replaced by versioned standings deltas of at most 2 rows.
- GETs no longer write: `autoCompleteTournamentIfExpired` (`WEB/lib/services/tournament/tournament.service.ts:75-98`) is replaced by the socket `TournamentScheduler`.
- Join is atomic against capacity (fixes the TOCTOU at `WEB/app/api/tournament/join/route.ts:37-69`). Scoring cannot double-count: it becomes a clause of P2's one-statement finish (`DB/src/live/finish.ts`), replacing P2's interim `tp` clause and the blind increments of `updateTournamentStandings` (`tournament.service.ts:220-280`).
- Admin APIs live under `/api/admin/*` with `auth: "admin"` and the DB role (no more Clerk Backend API lookup by email, `WEB/lib/auth/get-session-user.ts:8-13`). Every admin write is audit-logged and purges the P8 catalogue tags through P8's `revalidateCatalog(tagsFor(entity))`.

### 1.3 Owner test (dev site, ego-browser, at the end of the phase)

Accounts: the owner's admin account, members **A** and **B** (E2E users), member **C** as a watcher, non-member **R**, and a signed-out window. Real iPhone and Android phones for steps 9 and 10. All dev targets are the ones in CLAUDE.md's environments table (no IDs are hard-coded here, CS R-20).

1. **Admin dashboard.** `/admin` as the admin: six tiles (Users, Games, Active members, Positions, Legends, Tournaments) with sub-lines, the Recent activity feed, and the Health card showing "OCI · N games live · Healthy" and "Analysis queue · Median n s · Normal". As member A, `/admin` shows "You need admin access" (HTTP 403).
2. **Positions.** `/admin/positions`: search "Fischer", select Byrne vs Fischer, and add a ninth square to rank 2 of the FEN. The field shows "Not a legal FEN: rank 2 has 9 squares. Each rank needs exactly 8." and Save is disabled. Fix it and Save: toast "Chess position saved successfully", and the public position page shows the new blurb within one revalidation. New Position → toast "New draft position created", and a Draft row appears. Archive it: it disappears from `/legends/positions`.
3. **Legends.** `/admin/legends`: edit Tal's bio, Save. Replace Portrait with a 600×600 colour PNG, pick Licence "Public domain" and paste a source URL: the preview turns grayscale, the upload goes to R2, and `/legends/mikhail-tal` shows the new portrait.
4. **Create tournament.** `/admin/tournaments/new`: Create with empty fields shows four inline errors and "4 fields need attention." Fill it in: start in 12 minutes, 5+3, 30 min, max 8 players, two positions, Invite link only. Then "Created. It is in the Upcoming tab now." → Open Lobby.
5. **Invite and lobby.** Copy the invite link in the lobby ("Invite link copied"). In A's browser, `/join-tournament/<code>?i=…` redirects to `/t/<slug>/join`, shows "You're invited by <admin>" and a countdown → Join Tournament → "You're in" → Go to the Lobby. B joins the same way: **A's lobby shows B with JUST JOINED within 2 s, without a reload.** The countdown runs on its own. Five minutes before the start A and B see the toast "{name} starts in 5 minutes" (and, with P10, a push on a device where push is on). The admin presses Start Now ("Starting the arena…").
6. **Arena.** A's and B's lobbies switch to the live arena without a reload. Both press Find Match → "Finding an opponent near …" → the match card "You play White · study starts in 0:05" → auto-navigate → the game with the tournament strip. They play; B resigns. A's game-over card shows "+2 points · 1st of 2 · mm:ss left in the arena" with Find Match and Back to Arena.
7. **Watcher.** C (a member who has not joined) opens `/t/<slug>`: "You're watching. Late entries are open until hh:mm." with Join the Arena. C's top board follows the A–B game move by move (at most 1 s behind), and C's standings update when the game ends, without a reload.
8. **Results.** The admin ends the arena from the admin list (⋯ → End now). The last game finishes and every open arena page moves to `/t/<slug>/results`: podium, "Your result · 1st of 2 · 2 PTS · 1 GAME · 1W 0D 0L · BLITZ +n", and Your Games → review. With P10: A's profile Milestones tab shows "Top 3 in {name}".
9. **Phones.** `/tournaments` and a live arena on a real iPhone and a real Android phone. Standings | Top Board switch with the segmented control, and the board stays fully on screen. Desktop at 125 % and 150 % browser zoom: same check.
10. **Edges.** R opens the invite: the paywalled state with Renew and Join, which returns to the invite after test checkout and joins automatically. The signed-out window opens the invite: the card with Sign In to Join, and after sign-in it lands back on the join page. A full tournament (cap 2) shows "Tournament Full". A bad code shows "This invite doesn't lead anywhere".
11. **Cost check.** During step 6, the Vercel logs show **no** tournament request while A and B are searching, and the Neon dev branch's `pg_stat_statements` delta shows **≤ 6 tournament statements per game played** beyond P2's own checkpoint and finish statements (pairing share and lifecycle; scoring adds no statement).
12. **Restart.** Redeploy the dev socket during a live arena (`deploy-oci.yml` with `force`): searching players resume their search after the reconnect; standings and the clock are intact. The rollback rule in §14.3 is read back to the owner: no socket image rollback while an arena is live.
13. **Close out.** The manual checklist ends by closing every ego-browser page (`task.finish({ keep: [] })`, CTe X15) and filling `REPO/docs/qa/phase-12-signoff.md` (§12.8).

---

## 2. Scope

### 2.1 In scope

| Area | Items |
|---|---|
| Tournaments, player side | List (3 tabs, empty, error, lapsed `free`), invite join (10 states), lobby (4 states), live arena (6 states) on 5 device classes, tournament game strip and game-over variant, results (2 states), the invite paste dialog, redirects from legacy URLs |
| Tournament engine | Arena scoring with fire streaks and the early-draw rule (as a clause of P2's finish statement), time-sliced position rotation, auto-start with one 10-minute delay, late entry, atomic join, unlisted invite-only, finalize with frozen standings, top-board selection, search exclusivity with quick match (D12-16) |
| Socket server | `TournamentRuntime`, `TournamentScheduler`, `TournamentPairer` (1 s tick), `StandingsMirror` (all participants in memory, server-computed ranks), `TopBoard`, the 4 commands and 14 events, `POST /internal/tournaments/schedule`, tournament counts in `/internal/metrics`, the scoring fragment in `DB/src/live/fragments/tournament.ts`, removal of `TournamentManager.ts`, P2's `/internal/tournament-event` alias and the v1 lobby events |
| Admin | `(admin)` route group with `requireAdmin()` in the layout and in each page; dashboard, positions, legends (with portrait source and licence, CF LIC-6), tournaments list, create and edit; a minimal Reports queue on P5's `reports` table (acct Q10, CS R-02); R2 portrait upload through P10's `WEB/lib/r2/presign.ts`; audit feed |
| API | TOU-1…4, 6, 7, 9, 11, 12, 13 (§7.2); ADM-1…4, 6…14 (§7.3); INT-9, INT-10, INT-11a, INT-11b (§7.4); WS-6 and WS-7 on the socket (§7.5); test hooks TH-1…3 (§7.12) |
| Data | Migration M12 (§6), backfill B7 (18 legacy tournaments), dev seed with every board state reachable, `replay_realtime` grants for the scoring clause |
| Lights up | V3Game `tournament` and `over_tournament`; Play › Tournaments in the shell; the "Tournament starting" rows in P10's notification settings and push prompt; P10's `TOURNAMENT_PODIUM` milestone (§2.4) |
| Removal | Every legacy `/api/tournament/*` route (the E2E cleanup DELETE moves to TH-2), the legacy `chess-positions/*` and `legends/{create,[id],search}` write routes, the legacy pages, `useTournamentLobby`, `TournamentManager.ts`, `notify-websocket.ts`, `tournament.service.ts` |

### 2.2 Explicitly out of scope

- Swiss, round-robin, team battles, berserk, tournament chat, prizes, recurring series generation.
- Member-hosted tournaments (acct Q27: admins only; `hostUserId` is settable through the API only, see O12-1).
- The Lichess draw-streak rule (only the first of consecutive draws scores). Not in the design; listed as an anti-farming option in §14.
- The "New tournaments announced" alert and its "Tell me when one opens" link (D12-19, O12-14).
- A push or email when a tournament is **cancelled**: cancellation shows the socket toast and the redirect, and the pending start reminders are skipped (§7.8).
- "Watch another game" (`live:list`) on the spectator result card: it is P2's (CC C-17; P9 §2.2 should drop "/ P12").
- Admin users list, admin jobs view (ARCH §2.3.9), opening admin, lesson admin.
- An HTTP find-match fallback (D12-5).
- Contract migrations (dropping `isSearching`, `searchingSince`, `points`, the old index). They are listed in §6.7 for P13 + 1 release.

### 2.3 Dependencies on earlier phases

| Phase | What P12 uses | If it is missing |
|---|---|---|
| P1 | `route()` wrapper (`WEB/lib/api/route.ts`) with the six cache tiers and `RateLimitSpec { limit, windowSec, store }` (CS R-13, CA AP-11), `CT/http/{envelope,codes,cursor}.ts`, `api()` client with `devSchema()` (CA AP-12), the `qk` key directory, `QueryProvider` global error reactions, `getViewer()`, `requireAdmin()` on the DB role, the registry directories (CF §7), the test-hook registry and `prod-guard.spec.ts` (CTe X12), `x-rc-now` (CTe X5), the event registry and telemetry sinks (CTe X6), the UI kit, the shell, `ViewportStage`/`BoardStage`/`ScrollRegion`, the device × zoom suite | Blocker |
| P2 | Socket v2 (token with `ent`, `user:{ref}` room, acks, `/internal/emit` with the `targets` body, journal and drain), `CT/socket/{registry,rooms,codes,game}.ts`, `DB/src/live/finish.ts` built from named fragments, `DB/src/games/createLiveGame.ts`, `DB/src/live/loadLiveGame.ts` (`LiveGameRecord`), `DB/sql/roles.sql` (`replay_realtime`), `GameState`, `game:result`, V3Game with the `tour` zone and `GameOverCard`, `GameMode.TOURNAMENT`, `game_players."tournamentId"`, `TIMING_PROFILE` and the per-worker fixture socket server (CTe X5), `CT/socket/test/size.test.ts` | Blocker |
| P3 | Auto-analysis at finish, `GamePlayer.{accuracy, headline, momentsCount}`, `analysis:done` on the user room, `/games` archive (gets a `tournament` filter), worker `/internal/metrics`, `POST /internal/analysis/kick` with `runAt`, the **coach line** slot on `GameOverCard` (CC C-02 fix in P3 §4.7) | Results show "Coach notes arrive when your reviews finish" until analyses land; no coach line |
| P4 | `AuditLog` + `WEB/lib/audit.ts` (M4, CS R-04), `User.timeZone` (CS R-03) | Blocker for the admin feed |
| P5 | `reports` table and `POST /api/reports` (CS R-02); the **bank line** slot on `GameOverCard` (CC C-01 fix) | The Reports page is hidden; no bank line |
| P7 | The LLM swap of the coach line (CC C-02) | The template line stays |
| P8 | `ChessPosition.{slug, title, blurb, year, heroSide, verifiedAt}`, `Legend.slug`, `revalidateCatalog()` and `tagsFor()` (P8 §8.10), ADM-5 verify (`POST /api/admin/positions/{slug}/verify`), ADM-6's GET half | Blocker for the admin positions and legends screens |
| P9 | `packages/domain` (P9 creates it), `PlayerRating`, the token `r` claim (ratings per pool), the `applyRatings` finish fragment with the `GAME` Glicko preset (CF 10.18.3), `poolFor()`, the in-memory queue (`queue:moved`) | Pairing falls back to the token's `rating`, then 1500; games unrated |
| P10 (parallel; "first to merge creates", CS R-19) | `TournamentParticipant.displayName` (M10), `reverification_required`, `WEB/lib/r2/presign.ts` (`aws4fetch`), `Notification` + `NotificationKind.TOURNAMENT_STARTING` + the `tournament_start` channel, `UserMilestone` + `WEB/lib/milestones/definitions.ts`, the socket block loader, `User.username` | Each item is created by whichever phase merges first with `IF NOT EXISTS`/identical code (§6.1); without P10's tables, reminders are socket toasts only, there is no milestone and no block list, and DTOs carry `username: null` |
| P11 (optional) | Maintenance `area: "online"` in the route wrapper and the socket's `system:notice` state (P11 D10); D18 402 routing (`RenewSheet`, `/pricing?reason=ended`); dual chrome for signed-out visitors | Without P11 the 402 reaction is P1's `/pricing?reason=required` redirect, and there is no maintenance gate |

### 2.4 Earlier slots this phase lights up

| Slot | Owner phase and place | What P12 does |
|---|---|---|
| V3Game `tournament`, `over_tournament` (`V4TournamentGame`, `V4TournamentGameOver`) | P2 §4.3 rows 29 and 49 | Tournament strip in the `tour` zone and the tournament result card (§4.6, §4.7) |
| Play › Tournaments in the shell | P1 nav registry | Points at `/tournaments` when `tournaments-v3` is on |
| Settings › Notifications row "Tournament starting" (`V4SettingsNotifications` row `tour`) | P10 §4.10 (P10:381, "hidden until P12") | Visible when `tournaments-v3` is on (one condition in P10's row list, owned by WP-E) (CC C-24) |
| Push prompt toggle "Tournament starts" (`V4NotifPrompt` `ask`) | P10 §4.11 (P10:391) | Same condition |
| Milestone `TOURNAMENT_PODIUM` ("Top 3 in {name}") on `V4Profile` `milestones` | P10 §8.9 (P10:1668, "**P12**") | Evaluator added to `WEB/lib/milestones/definitions.ts`; finalize enqueues the evaluation (§8.7) (CC C-23) |
| Coach line and bank line on the tournament result card | P3 §4.7 (coach, CC C-02), P7 §4.5 (LLM swap), P5 bank slot (CC C-01) | Nothing tournament-specific: the tournament variant renders the same slots in the same order; if those phases drop a slot, the tournament card has no line there |

---

## 3. Current code touched

What exists today (the `dev` snapshot, with the P1 and P2 moves noted) and what P12 does with it.

### 3.1 Web API routes

| File (lines) | Today | Fate in P12 | Replacement |
|---|---|---|---|
| `WEB/app/api/tournament/route.ts` (65) | `GET` list; `status` cast without validation (L8, L16 → Prisma 500, AA F-16); `take: 50`, no cursor | **Remove** | TOU-1 `GET /api/tournaments` |
| `WEB/app/api/tournament/[tournamentReferenceId]/route.ts` (167) | `GET` with 5–8 round trips and **two writes** (`autoComplete…` L41, notify L43); `?search=` mode (L31-38); `DELETE` E2E cleanup (L118-167, `!==` secret compare L130, AA F-25) | **Remove** (GET and DELETE) | TOU-2, TOU-3, TOU-6, TOU-7; the cleanup moves to the registered test hook TH-2 (§7.12) |
| `WEB/app/api/tournament/join/route.ts` (100) | count-then-insert (L37-69), P2002 → 500 | **Remove** | TOU-4 (atomic) |
| `WEB/app/api/tournament/find-match/route.ts` (211) | polled every 2–4 s; locking transaction (L100-183); P2 rewired its insert through `createLiveGame(tx)` | **Remove** | Socket `tournament:find_match` + INT-10 |
| `WEB/app/api/tournament/cancel-search/route.ts` (50) | clears `isSearching` | **Remove** | `tournament:cancel_search` |
| `WEB/app/api/tournament/start/route.ts` (85), `end/route.ts` (82) | creator-only; unconditional update (L47-54); fire-and-forget notify | **Remove** | TOU-9 (host or admin, conditional) |
| `WEB/app/api/tournament/create/route.ts` (120) | any member (L24, admin-only since P1 H1); description ≤ 50 (L9); non-atomic participant insert (L85-90) | **Remove** | ADM-8b `POST /api/admin/tournaments` |
| `WEB/app/api/chess-positions/route.ts` (105), `[id]/route.ts` (389), `create/route.ts` (138) | admin CRUD; auth added in P1 H1; hard delete; BigInt-or-ref lookup (ADB §6, AA F-32); P8 added `revalidateCatalog` in `after()` | **Remove** after the admin pages move | ADM-3, ADM-4 |
| `WEB/app/api/legends/create/route.ts` (104), `[id]/route.ts` (269), `search/route.ts` (63) | admin CRUD + full-row search (AA §3.7) | **Remove** the writes and `search`. P8 owns the public `GET /api/legends` (CAT-1) and the ADM-6 GET | ADM-6b, ADM-7 |
| `WEB/app/api/scraper/positions/import/route.ts` | API key or admin | **Keep**; switch to the shared `upsertPosition()` (§7.3 ADM-10) | — |
| `WEB/app/api/chess/game-over/route.ts:130-139,147-156` | blind standings increment + un-awaited notify | P2 deletes it at its parity gate; nothing for P12 | §8.1 |

### 3.2 Web services, hooks, auth

| File (lines) | Fate |
|---|---|
| `WEB/lib/services/tournament/tournament.service.ts` (433) | **Delete.** `getTournamentByRef` (L20-70) → `WEB/lib/data/tournaments.ts`; `autoCompleteTournamentIfExpired` (L75-98) → scheduler; `resolveStartingPosition` (L103-214, random positions, global client) → `DOM/tournaments/slot.ts` over `TournamentPosition`; `updateTournamentStandings` (L220-280) → the scoring clause (§8.1); `serializeTournament` (L285-325) → `DOM/tournaments/dto.ts`; `getCurrentUserParticipant` (L330-382) → `getMyTournamentState()`; `searchTournamentParticipants` (L387-433, unescaped `ILIKE`, no tie-break at L409) → TOU-3 |
| `WEB/lib/services/tournament/notify-websocket.ts` (23) | **Delete.** Replaced by P2's `WEB/lib/realtime/emit.ts` (WS-3) and the new `WEB/lib/realtime/tournament-schedule.ts` (WS-7), both through `internalFetch()` (D12-15) and called from `after()` |
| `WEB/lib/hooks/useTournamentLobby.ts` (157) | **Delete.** A second socket per page (L120), a full refetch per event (L137-141). Replaced by `WEB/features/tournaments/useTournamentRoom.ts` on P2's shared connection |
| `WEB/lib/hooks/useSocketToken.ts` (153) | P2 kept it only for `useTournamentLobby`; **delete** with it |
| `WEB/lib/auth/get-session-user.ts` (14) | **Delete** once nothing imports it (admin layout and `requireAdmin` move to `getViewer()`) |
| `WEB/lib/auth/require-admin.ts` (16) | Thin wrapper over the route wrapper's `auth: "admin"` for any leftover caller; deleted when its last import goes |
| `WEB/middleware.ts:16-26` | Frozen by P1; P12 adds route classes as data in `WEB/lib/routes/classes/tournaments.ts` and `…/admin.ts` (CF §7; §11.2) |
| `WEB/next.config.js:80` (`redirects()`) | P12's redirects live in `WEB/config/redirects/p12.mjs` (CF §7) |

### 3.3 Web pages and components

| File (lines) | Fate |
|---|---|
| `WEB/app/(app)/tournaments/page.tsx` (225; was `app/tournaments/page.tsx`, moved by P1 P4a) | **Replaced** by the v3 list. Its per-second `setInterval` (L72) and the swallowed tab fetch errors (L86-99, AC §6.3) go |
| `WEB/app/(app)/tournament/[tournamentReferenceId]/{page.tsx 260, ActiveGames.tsx 93, FindMatchButton.tsx 184, Leaderboard.tsx 306, ParticipantList.tsx 138, TournamentHeader.tsx 188}` | **Delete.** `/tournament/:ref` becomes a redirect route handler |
| `WEB/app/(app)/join-tournament/[tournamentReferenceId]/{page.tsx 404, layout.tsx 13}` | **Delete.** `/join-tournament/:code` becomes a redirect route handler |
| `WEB/app/components/NavbarTournaments.tsx` (30) | Delete if P1's shell left it in place (the marketing Navbar still imports it; check at branch time) |
| `WEB/app/admin/{layout.tsx 21, page.tsx 247, chess-positions/page.tsx 1841, legends/page.tsx 744, tournaments/page.tsx 184, tournaments/create/page.tsx 396, tournaments/create/TournamentShareModal.tsx 203}` | **Delete** after parity behind `admin-v3`. Replaced by `WEB/app/(admin)/admin/**`. The layout redirect for non-admins (L14-18) becomes an in-place 403 view. 14 hand-written fetches go (`admin/page.tsx:137-139`, `legends/page.tsx:78,132,182`, `chess-positions/page.tsx:159-160,527,610,733-737`, `tournaments/page.tsx:50`, `tournaments/create/page.tsx:76-77,119`) |
| P2's `WEB/features/game/*` (game screen, `GameOverCard`) | **Edited** (additive): mount `TournamentStrip` in the zone slot and the tournament variant of the result card (§4.6, §4.7) |
| P2's `WEB/lib/games/snapshot.server.ts` (`getGameSnapshot()`) | **Edited** (additive): fill `tournament` (D12-11) |
| P3's `WEB/lib/data/games.ts` `listMyGames()` and `/games` | **Edited** (additive): `?tournament=<slug>` filter for "Review My Games" |
| P2's `WEB/lib/realtime/connection.ts` | **Edited** (additive): a critical hold `arena_search` |
| `WEB/lib/realtime/handlers/tournaments.ts` (new, in P2's handler directory) | `tournament:paired`, `tournament:search_ended`, `tournament:starting_soon`, and the `analysis:done` → `resultsMe` invalidation |
| P10's `WEB/features/notifications/ChannelTable.tsx` and `NotifPromptDialog.tsx` | **Edited** (one condition each): show the tournament rows when `tournaments-v3` is on (§2.4) |

### 3.4 Socket server (paths after P2's rework into `WS/src/*`)

| File | Fate |
|---|---|
| `WS/TournamentManager.ts` (144 today; P2 kept it for the legacy lobby) | **Delete.** Room helpers (L24-46), five broadcast helpers (L51-110), the never-called, room-wide `emitMatchFound` (L115-122, AS F-24) |
| `WS/src/http/tournamentEvent.ts` (P2's alias of today's `WS/index.ts:41-73`) | **Delete** (P2 §7.5: "removed in P12") |
| The legacy lobby aliases P2 kept (`join_tournament_lobby` / `leave_tournament_lobby`, today `WS/index.ts:334-348`) | **Delete**; replaced by `WS/src/tournaments/handlers.ts` registered from `WS/src/index.ts` |
| `WS/types.ts` (277): `TournamentLobbyPayload` | **Delete**; types come from `CT/socket/tournament.ts` |
| P2's `WS/src/game/LiveSession.ts` / `SessionRegistry.ts` | **Edited** (additive): `onGameMove(ref, fn)` and `onGameEnded(ref, fn)` hooks for the top board and the pairer; `GameState.tournament` filled from the runtime in the join ack (§7.7) |
| P2's `WS/src/persist/*` finish path and `DB/src/live/finish.ts` | **Edited**: the `tp` fragment is replaced by `DB/src/live/fragments/tournament.ts`; the `g` fragment's `RETURNING` gains `"whitePlayerId", "blackPlayerId"`; the `gp` fragment's `SET` list gains the two tournament columns (§8.1). The socket handles the tournament block of the result (§8.5) |
| P2's `WS/src/http/{emit,metrics,drain}.ts` | **Edited**: the emit pipeline forwards `tournament:player_joined/left` to the runtime (§8.5); metrics gain tournament counts; drain refuses during a live arena unless `force` |
| P9's `WS/src/queue/*` (join handler) | **Edited** (additive): `queue:join` removes the user from every arena pool (D12-16) |
| `DB/sql/roles.sql` (P2) | **Edited**: column grants for the scoring clause and the participant loader (§6.2) |
| `REPO/deploy/oci/Caddyfile` | Allow-list gains `/internal/tournaments/schedule` (POST) and `/internal/metrics` (GET); both behind the unsigned-request pre-check (CF SEC-8, §11.3) |
| `REPO/.github/workflows/deploy-oci.yml` (P2's drain step) | **Edited**: a `force` input; the drain refuses while a tournament is live unless `force` (ARCH rule) |

### 3.5 Tests and perf

| File | Fate |
|---|---|
| `WEB/e2e/specs/tournament.spec.ts` (303) | **Rewritten** as `WEB/e2e/specs/tournaments/arena.spec.ts` (§12.3). It calls `/api/tournament/find-match` today (L19-29) |
| `WEB/e2e/fixtures/tournament-helpers.ts` | **Rewritten**: create through `POST /api/admin/tournaments` as the E2E admin, start through TOU-9, shift time and clean up through TH-1/TH-2. Its calls to `POST /api/user/sync` and `onboarding-skip` (L46, L54) go (CTe X17) |
| `WEB/e2e/personas/p12.ts` (new, P1's persona directory) | The dedicated admin login `E2E_ADMIN_EMAIL`, provisioned with `--admin` (CTe X4); no letter user is reused |
| `REPO/perf/k6/src/scenarios/tournament.ts` | **Rewritten** for protocol v2: watch, find, play, no HTTP polling (§9.7) |

---

## 4. Screens

### 4.0 Route map, flags and shared rules

| Route | Render | Who | Board(s) | Notes |
|---|---|---|---|---|
| `/tournaments?tab=live\|upcoming\|finished&t=<slug>` | dynamic RSC in `(app)`, dual chrome when signed out | everyone (D12-9) | `V4Tournaments`, `V4TournamentsEmpty`, 4 device boards | Default tab: `live` when any tournament is live, else `upcoming` |
| `/t/[slug]` | dynamic RSC; status router: `upcoming`/`lobby` → Lobby, `live`/`finishing` → Live arena, `finished` → `redirect('/t/[slug]/results')`, `cancelled` → `redirect('/tournaments?cancelled=<slug>')` | everyone | `V4TournamentLobby`, `V4TournamentLive` + 4 device boards | `?view=standings\|board` selects the phone segment |
| `/t/[slug]/join?c=<code>&i=<tag>&autojoin=1` | dynamic RSC | everyone; join needs membership | `V4TournamentJoin` | `c` is required only for invite-only tournaments |
| `/t/[slug]/results` | dynamic RSC; the public part comes from the `public-static`-cached DAL | everyone | `V4TournamentResults` | 307 to `/t/[slug]` while not finished |
| `/game/[ref]` | P2's game page | players, spectators | `V4TournamentGame`, `V4TournamentGameOver` | P12 only adds the tournament strip and result variant |
| `/admin`, `/admin/positions`, `/admin/legends`, `/admin/tournaments`, `/admin/tournaments/new`, `/admin/tournaments/[slug]/edit`, `/admin/reports` | dynamic RSC in the new `(admin)` group | `role = ADMIN` | `V4Admin`, `V4AdminPositions`, `V4AdminLegends`, `V4AdminTournaments`, `V4AdminTournamentCreate` | Reports has no board; built from the kit |
| `/dev/ui/tournaments?screen=&state=` | dev only (`devRoutesEnabled()`, SPEC D11) | dev | all P12 boards | Reaches every enum value that real data cannot (ALLOC §1.1.4) |

**Redirects** (`WEB/config/redirects/p12.mjs`, the P1 redirect directory (CF §7), where static; route handlers where a lookup is needed). Status codes: **307 on dev** and 308 only in production from the P13 cut-over, because browsers and crawlers cache 308s permanently (CF §9, P8 row):

| From | To | How |
|---|---|---|
| `/tournaments/:slug` | `/t/:slug` (308) | `config/redirects/p12.mjs` |
| `/tournament/:ref` (legacy) | `/t/<slug>` (308) | `WEB/app/tournament/[ref]/route.ts`: `SELECT slug FROM tournaments WHERE "referenceId"=$1`; unknown → `/tournaments` |
| `/join-tournament/:code` (legacy ref, or the short share link) | `/t/<slug>/join?c=<inviteCode>&i=<tag>` (307, keeps `i`) | `WEB/app/join-tournament/[code]/route.ts`: match `inviteCode`, else `referenceId` (old shares from `TournamentShareModal.tsx`) |
| `/admin/chess-positions` | `/admin/positions` (308) | `config/redirects/p12.mjs` |
| `/admin/tournaments/create` | `/admin/tournaments/new` (308) | `config/redirects/p12.mjs` |

**Flags.** `tournaments-v3` (server-evaluated, registered in `WEB/lib/flags/registry/p12.ts`) switches `/tournaments`, `/t/*`, the redirects and the game-screen tournament variant. With the flag off, the P1-wrapped legacy pages stay reachable until the parity check passes; then they are deleted in this phase (ALLOC §1.1.2). `admin-v3` switches `/admin/*` the same way.

**Shared layout rules (DS "Layout: one viewport").**

- Every P12 page is a **lock-mode** page (`data-rc-lock`, SPEC D15): the document never scrolls. Long lists (tournament rows, players, standings, final standings, admin tables) scroll inside a `ScrollRegion`.
- Boards: the live top board uses `BoardStage` sizing, `--board: clamp(220px, min(colW − 32px, regionH − 2×barH − headerH), 880px)`. List and aside boards use `MiniBoard` (static SVG, `article-board-*` squares).
- At `max-height: 620px` (150 % zoom on a laptop): the description line, the rules list and the eyebrows are hidden, player bars drop from 34 px to 28 px, and section padding goes from 18 px to 12 px.
- Under 1100 px wide the sidebar becomes the 64 px rail (P1 shell mode). Phones and iPad portrait use the tab bar (Play current).
- Touch targets ≥ 44 CSS px. The phone `Segmented` buttons are 36 px tall inside a 44 px row.

**Copy rules.** Button labels are Title Case per P1 copy rules (SPEC §3.11; checked by `WEB/lib/shell/copy.test.ts`, extended with `WEB/features/tournaments/copy.ts`). The boards write some buttons in sentence case ("Find match"); the shipped labels are "Find Match", "Enter Arena", "Back to Arena", "Go to Game", "Join Tournament", "Open Lobby", "See Results", "Start Now", "Create Tournament". Placeholder domains `replaychess.com` in the boards become `playchess.tech` (acct Q32).

### 4.1 Tournaments list (`/tournaments`)

**Boards.** Desktop `DR/V4Tournaments.dc.html` (enum `default | loading | empty | error | free`), `DR/V4TournamentsEmpty.dc.html` (same file, default `empty`). Devices: `DR/V4iPhoneTournaments.dc.html`, `DR/V4AndroidTournaments.dc.html`, `DR/V4iPadLTournaments.dc.html`, `DR/V4iPadPTournaments.dc.html`.

**Layout per device.**

| Device | Composition | One-viewport mechanics |
|---|---|---|
| Desktop 1440×900, 1280×800 | 220 px sidebar (Play › Tournaments current) · main grid `minmax(0,1fr) minmax(320px,400px)` (from the board). Left: eyebrow "Play", title "Tournaments", the "Have an invite link?" link, tablist, listbox panel. Right: "Selected tournament" aside | The listbox is a `ScrollRegion` (`grid-template-rows: auto minmax(0,1fr)`). The aside has `max-height: 100%` and scrolls internally only at 150 % zoom. Aside board: `min(360px, asideW − 36px)` |
| iPad landscape 1194×834 | 64 px rail with a dedicated Tournaments icon (board) · grid `minmax(0,1fr) 380px` | Same as desktop |
| iPad portrait 834×1194 | 52 px top bar · tabs · listbox (`flex: 1`) above · aside below (fixed height, board 200 px) · 64 px tab bar | The list scrolls; the aside never does |
| iPhone 393×852, Android 412×915 | 44 px top bar with the logo and an invite-link icon button ("Join with an invite link") · title · tabs · compact listbox rows (48 px mini board, grid `48px minmax(0,1fr) auto`) · "Selected tournament" card below (board 96 px, players bar `role=img` "18 of 32 places taken", CTA, watch link) · 56 px tab bar | The rules lines are dropped (board). The listbox takes the remaining height |

**States and transitions.**

| State | Source | UI | Transitions |
|---|---|---|---|
| `loading` | `QueryState` with no data (rare, since the RSC seeds the cache); every tab switch to an unseeded tab | `aria-busy` listbox with 9 `GhostRow`s; aside shows the "Pick a tournament" ghost | → `default` / `empty` / `error` |
| `default` | ≥ 1 row in the tab | rows + selected aside | tab change (`replaceState ?tab`), row select (`?t`) |
| `empty` (`V4TournamentsEmpty`) | 0 rows in the tab | `EmptyState`: "No tournaments right now" (live) / "Nothing scheduled yet" (upcoming) / "No finished tournaments" (finished) + "New arenas open most evenings." | The board's "Turn on tournament alerts…" sentence and [Tell Me When One Opens] are **not built** (D12-19, CC C-14; owner decision O12-14) |
| `error` | the query failed with no data | `ErrorState` `role=alert`: "Failed to fetch tournaments. Check your connection and try again." [Try Again] → `refetch()` | → `loading` |
| `free` | signed in, not entitled, trial used: `qk.me().entitlement.state === "lapsed" && !entitlement.trial.eligible` (P1 `MembershipState`, CS fix 12.11) | The aside CTA is replaced by "Your membership has ended. Your free trial has been used, so renew to join; watching and results stay open." + [Renew to Join · $4.99 a Month] → P11 D18 routing with `returnTo = <join url>&autojoin=1`: the P7 `RenewSheet` on `(app)` pages, else `/pricing?reason=ended&redirect_url=…` (before P11: `paywallUrl(<join url>)`). Watch and results links stay | — |
| (variant) trial-eligible non-member | `state === "none" && trial.eligible` | CTA [Start 7-Day Free Trial and Join] → `paywallUrl(<join url with autojoin=1>)` (P1 `lib/billing/client.ts:43`, one argument) | — |
| (variant) signed out | no session | CTA [Sign In to Join] → `/sign-in?redirect_url=<join url>` | — |
| (variant) no selection | rows exist, none selected (cannot happen by default; `t` falls back to row 0) | "Pick a tournament to see its position and rules." | — |

**Row content.** Mini board (Black-to-move positions flipped), name, "Blitz 5+3 · Opera Game, Paris 1858", "24 PLAYERS · LIVE · ENDS 20:00", status pill (`Tag`: LIVE `good`, LOBBY `warn`, UPCOMING and FINISHED neutral), "YOU'RE IN" when registered, a lock icon for invite-only tournaments you're in.

**Aside CTA by phase.** `live`/`finishing` [Enter Arena] → `/t/{slug}`; `lobby` [Open Lobby] → `/t/{slug}`; `upcoming` not joined [Join] → `/t/{slug}/join`; `upcoming` joined [Open Lobby]; `finished` [See Results] → `/t/{slug}/results`. Secondary link: live → "Watch the Top Board" → `/game/{topBoardHint.gameRef}?spectate=1` when a hint exists, else `/t/{slug}?view=board`; finished → "See Past Results".

**Components.** `PageHeader`, `Tabs` (with `CountBadge`), `TournamentRow` (new), `TournamentAside` (new), `TournamentPill` (new; wraps `Tag`), `MiniBoard` (P2), `Avatar` stack, `Button`, `EmptyState`, `ErrorState`, `GhostRow`, `InvitePasteDialog` (new; `ResponsiveDialog` + `Field`: "Paste the link or code"; accepts a full URL, a `/t/…/join?c=` URL or a bare 8-character code).

**Keyboard.** Tabs ←/→ (roving tabindex). Listbox ↑/↓ move the selection (`aria-activedescendant`, updates `?t` with `replaceState`), Home/End. Enter activates the aside CTA. `I` opens the invite dialog. On phones the first tap selects and the second tap opens. Shortcuts are registered in the P1 `?` sheet under "Tournaments".

**Accessibility.** `role=tablist` / `role=listbox` with `aria-activedescendant`. The mini board's `aria-label` is the source title. Pills carry text. Only the aside heading is `aria-live=polite`.

**Time labels.** API payloads carry ISO timestamps only, so every public response is the same for every viewer (CA AP-03). The page renders labels on the server in the viewer's `User.timeZone` ("Today 19:00", "Sat 1 Nov · 20:00", "Finished 25 Oct", CDL §2.3 rule 6). Signed-out visitors get them after mount from `Intl` (no hydration mismatch: the server renders ISO in a `<time>` and a client island formats it).

### 4.2 Join from invite (`/t/[slug]/join`)

**Board.** `DR/V4TournamentJoin.dc.html` (enum `default | starting_soon | joining | joined | closed | full | paywalled | not_found | error | loading`). There are no device boards: phones use the desktop card stacked in one column (board 200 px, then the details, then the CTA). It fits 393×852 without scrolling.

**Layout.** Desktop: shell + centred card, grid `minmax(220px, 300px) minmax(0, 1fr)` (board left, details right; from the board). iPad portrait: same grid at 300 px. Phones: one column.

**Content.** Eyebrow "Tournament invite"; title "Join the tournament" (or "Tournament not found"); the position board with the caption "BYRNE VS FISCHER · 1956 · BLACK TO MOVE" (`role=img`, label "Byrne vs Fischer, New York 1956, after 16.Bc5. Black to move."); "You're invited by vera_b" (only with a valid `i` tag whose user still exists and is not blocked by the viewer); the name; "Starts in 2h 14m" (`h m` over an hour, `mm:ss` under one, "Started" once live); Format "Arena · 60 min"; Clock "Blitz 5+3"; an avatar stack + "18 of 32 players · 14 places left".

**States and transitions.**

| State | Condition (server `joinState` + viewer overlay) | UI | Next |
|---|---|---|---|
| `loading` | route `loading.tsx` | card skeleton | — |
| `default` | `open`, not joined | [Join Tournament] | click → `joining` |
| `starting_soon` | `open` and `startsAt − now < 10 min` | status "Starting soon. Join now and you go straight to the lobby." + [Join Tournament] | → `joining` |
| `joining` | mutation pending | button "Joining…" (spinner inside the button) | 201/200 → `joined`; 409 → `full` / `closed`; 402 → `paywalled`; other → `error` |
| `joined` | registered | status "You're in. We will notify you five minutes before the start." + [Go to the Lobby] → `/t/{slug}`, "All tournaments" | When `starting_soon`, auto-navigate to the lobby after 1.5 s. Without P10 the copy is "You're in. We'll remind you here five minutes before the start." |
| (late entry) | `late_entry` (live, before `lateJoinUntil`) | [Join the Arena]; on success go straight to `/t/{slug}` | — |
| `closed` | `closed` | "Registration Closed. The arena started 12 minutes ago." + [Watch] → `/t/{slug}` | — |
| `full` | `full` | "Tournament Full. All 32 places are taken." + [Find Another] → `/tournaments` | — |
| `paywalled` | signed in, not entitled (trial used) — known from `qk.me()` before any click, or from a 402 | "Your membership has ended. Your free trial has been used, so renew and you come back to this invite after checkout." + [Renew and Join · $4.99 a Month] → P11 D18 routing (`RenewSheet` or `/pricing?reason=ended`) with `returnTo = /t/{slug}/join?c=…&i=…&autojoin=1` | On return, `autojoin=1` runs the join once (then strips the param with `replaceState`) |
| (trial variant) | `state === "none" && trial.eligible` | [Start 7-Day Free Trial and Join] → `paywallUrl(<the same return URL>)` | — |
| (signed out) | no session | [Sign In to Join] → `/sign-in?redirect_url=<this URL with autojoin=1>` | — |
| `not_found` | no tournament for the code/slug, cancelled, a wrong code for an invite-only tournament, or a rotated code | "This invite doesn't lead anywhere" + "The tournament may have been cancelled, or the link was cut short. Ask vera_b for a fresh one." (the inviter clause only with a valid tag) + [Browse Tournaments] | — |
| `error` | 5xx or network | `role=alert` "Couldn't join. Your place is not reserved yet; try again." + the button reads "Try Again" | → `joining` |

**Interactions.** Enter on the focused primary button. The countdown is `role=timer aria-live=off` with a visually hidden "Starts at 19:00 your time". A polite live region announces "Starting soon" at 10 min and "Started" at 0. When the countdown reaches 0 the page refetches the invite model once (state flips to late entry or closed).

**Components.** `Card`, `MiniBoard`, `CountdownTimer` (new, `useNow(1000)` + server offset), `Avatar` stack, `Banner`/status rows, `Button`, `EmptyState` (not_found).

### 4.3 Lobby (`/t/[slug]` while upcoming or lobby)

**Board.** `DR/V4TournamentLobby.dc.html` (enum `joined | not_joined | host | started`).

**Layout.** Desktop: shell; header row (eyebrow "Tournament lobby", title, "All tournaments" link); a two-column grid. Left: countdown section (label + `role=timer` + a progress bar) and the position card (grid `168px minmax(0,1fr)`: board, then "Round 1 position · Byrne vs Fischer, New York 1956 · Black to move after 16.Bc5. Fischer played 17…Be6!!, giving up his queen. You get 30 seconds to study before the first move."), a facts row (Format, Clock, Scoring "Win 2 · draw 1"), the invite link field with [Copy]. Right: "Players · 18 of 32 · LIVE", a `role=list` scroll panel of rows (grid `32px minmax(0,1fr) auto`: initials avatar, name, rating, tag), and the footer "You're in · seed 9 of 18" + [Leave]. iPad landscape: rail + the same grid. iPad portrait and phones: one column (countdown, position card with a 120 px board, facts, invite field), then the players panel taking the remaining height (scrolls), and the footer pinned above the tab bar.

**States and transitions.**

| State | Condition | UI | Next |
|---|---|---|---|
| `not_joined` | viewer not a participant | [Join Tournament] in the countdown section; footer "You haven't joined yet" | Join (TOU-4) → `joined` + toast "You're in the Sunday Fischer Cup". Not a member → paywall. Signed out → sign-in |
| `joined` | participant | footer "You're in · seed 9 of 18" + [Leave] (only before the start) | Leave (TOU-4 DELETE) → `not_joined` + toast "You left the tournament" |
| `host` | `viewer.id = hostUserId` or `viewer.role = ADMIN` | [Start Now] + banner "You are hosting. Start now to begin early, or let the clock run." (admin hosts see it too) | Start (TOU-9) → toast "Starting the arena…" → `started` when `tournament:started` arrives |
| `started` | `tournament:started` received, or the countdown hit 0 and the refetch says `live` | the countdown section reads "Started · round 1 is pairing now" + [Go to the Arena →]; after 1 s the page swaps to the live arena in place (same route, no navigation) | → §4.4 |
| (upcoming) | phase `upcoming` (before `lobbyOpensAt`) | same screen; the countdown shows "Starts Sat 1 Nov · 20:00" (h m) with no progress bar emphasis | at `lobbyOpensAt` the pill changes to LOBBY (client-derived) |
| (delayed) | `tournament:updated {startsAt, delayed:true}` | status "Not enough players yet. We moved the start to 19:10." | — |
| (cancelled) | `tournament:cancelled {reason}` | `router.replace('/tournaments?cancelled=<slug>')` and the toast "This tournament was cancelled: not enough players joined." | — |

**Player list.** Ordered by seed (rating at join, descending; then join order). Tags: HOST (host row), YOU (own row, pinned first), JUST JOINED (green, from `tournament:player_joined`, fades after 6 s). Over 200 rows the list virtualises (`@tanstack/react-virtual`, loaded through `next/dynamic` only then, CA §2.10); below that it is a plain `ScrollRegion`. Further pages load from TOU-3 when the sentinel is near. The live region announces joins only, never the initial render.

**Interactions.** [Copy] → clipboard, label "Copied" for 2 s, toast "Invite link copied". Keyboard: `C` copies the invite link, `J` joins, `S` starts (host). Leaving marks the viewer's pending start reminder `SKIPPED` (P10 only, §7.8).

**Components.** `PageHeader`, `CountdownTimer`, `Progress`, `PositionCard` (new; `MiniBoard` + text), `InviteLinkField` (new; read-only `Field` + `Button`), `LobbyPlayerList` (new; `Avatar`, `Tag`), `ActionBar` for the footer, `Banner` (host), toasts via `notify.*`.

### 4.4 Live arena (`/t/[slug]` while live or finishing)

**Boards.** Desktop `DR/V4TournamentLive.dc.html` (enum `idle | searching | matched | in_game | ending_soon | not_participant`). Devices: `DR/V4iPhoneTournamentLive.dc.html`, `DR/V4AndroidTournamentLive.dc.html`, `DR/V4iPadLTournamentLive.dc.html`, `DR/V4iPadPTournamentLive.dc.html`.

**Layout per device.**

| Device | Composition (from the boards) | Board size |
|---|---|---|
| Desktop | Header: eyebrow "Live arena · Blitz 5+3 · Opera Game" (current slot label), title, "Ends in 18:42" (`role=timer`; amber "Ends in · last games" under 2 min), [Leave Arena] link. Grid `minmax(0,1fr) minmax(320px,400px)`. Left column, rows `auto minmax(0,1fr)`: the pairing section, then the top-board section (rows `auto minmax(0,1fr)`: "Top board · move 10" + [Watch]; player bar, board, player bar; the pairing-details list "White vera_b · 1st · 19 pts", "Black hypermodern_g · 2nd · 16 pts", "Games 8 · 7", "Time control Blitz 5+3", the streak note "2× vera_b is on a streak: a win here counts double.", [Watch This Game]). Right column: Standings (rows `auto auto minmax(0,1fr)`: heading "Standings · 24 players · LIVE", column header `# PLAYER GP PTS`, list) | `BoardStage` in the top-board region: `min(colW − 32, regionH − 2×34 − 40)`, clamped 220–560 px. At 1440×900 ≈ 520 px |
| iPad landscape | 64 px rail · grid `minmax(0,1fr) 360px`: pairing over top board on the left, standings on the right | ≈ 470 px |
| iPad portrait | 52 px top bar · header (eyebrow, title, ENDS IN) · pairing card at full width · grid `420px minmax(0,1fr)`: top board (fixed 420 px column; the board fills it minus the two 34 px bars) and standings (scrolls) · 64 px tab bar | 388 px |
| iPhone, Android | 44 px header: ‹ Back (→ `/tournaments`), name, "ENDS IN 18:42" · `Segmented` Standings \| Top Board (`radiogroup`) · the selected panel (standings list scrolls; or the top board) · pairing card pinned at the bottom · 56 px tab bar (Play current) | `--board: min(100dvw − 32px, 100dvh − 44 − 44 − pairingH − 56 − 2×28 − safe-area)`. On iPhone 393×852 that is ≈ 361 px with a 132 px pairing card; on `iphone-safari` 393×659 ≈ 220 px (the floor) |

The pairing card is always visible (never in a scrolled region), so Find Match is always reachable. At `max-height: 620px` the pairing details and the streak note are hidden.

**Pairing card states** (client state machine in `WEB/features/tournaments/arenaStore.ts`, §5.4):

| State | Title / meta | Body | Actions | Transitions |
|---|---|---|---|---|
| `idle` | "Your next pairing" · "YOU: 3RD · 14 PTS · 6 GAMES" | the streak line: streak 0 → "Win 2, draw 1. Two wins in a row double the next."; streak 1 → "Win 2, draw 1. You're on a win, so another makes it 2× next game."; fire → "You're on a streak: your next win counts double." | [Find Match] (`F`) | → `searching` on ack `ok` |
| `searching` | same | status "Finding an opponent near 1184 · 0:07" (counts up from `since`). After 60 s it adds "Few players are searching. Keep waiting or come back later." | [Cancel] (`Esc` or `F`) | `tournament:paired` → `matched`; cancel → `idle`; `tournament:search_ended` → `idle` + banner; socket drop → "Reconnecting… your search resumes" (button disabled) |
| `matched` | same | avatar "MK", "vs martin_k 1212", "You play White · study starts in 0:05" | [Go to Game →] (Enter) | auto-navigate to `/game/{ref}` when the 5 s count reaches 0 (O12-2), only if this tab is visible and on this page; other tabs get the toast "Your tournament game is ready" with a link |
| `in_game` | "Your game" | "You're playing opposite_sq · Move 14 · your clock 3:12 · it keeps running" (move number and clock from the top-board stream when it is the top game, else from `GET /me` + the game's last checkpoint) | [Return to Game] | game ends → `idle` |
| `maintenance` | (overlay; P11 `system:notice` with `affects` containing `online` or `all`) | banner `role=status` "Arena pairing is paused for maintenance. Games in progress continue." | Find Match disabled (`aria-describedby` the banner); a running search ends with `search_ended { reason: "maintenance" }` | notice cleared → the previous state |
| `ending_soon` | (overlay on `idle` or `searching`) | banner `role=status` "Under 2 minutes left. Games that start now still count; the arena closes when they finish." | Find Match stays enabled | at `endsAt` (phase `finishing`): Find Match is hidden and the banner reads "Arena closed. Games in progress still count."; searchers get `search_ended` |
| `not_participant` | "Spectating" · "24 PLAYERS · 9 GAMES LIVE" | "You're watching. Late entries are open until 19:50." (after `lateJoinUntil`: "You're watching. Registration is closed.") | [Join the Arena] → TOU-4 (late entry) in place; signed out → sign-in; non-member → P11 D18 routing | join ok → `idle` |

**Top board states.** A live top game → the board with player bars (clock running from `clocks.run`, interpolated by `useClock`); no live game → `EmptyState` (small) "No games in play right now. The top board shows the highest-ranked game." [Watch] and [Watch This Game] → `/game/{ref}?spectate=1` (members; signed-out → sign-in). The board is `role=img` with the label "Top board, vera_b against hypermodern_g, move 10, last move e4 to e5", updated at most every 5 s for screen readers.

**Standings.** Columns `#`, avatar + name (+ the 2× `FireBadge` with `title="Two wins in a row: the next win counts double"`), `GP`, `PTS`. The viewer's row is highlighted and named "knightowl_88 (you)". When the viewer is outside the loaded rows, a pinned "you" row shows under the header. The list is `aria-live=off`; a separate polite line "Your rank: 3rd" announces the viewer's own changes only (acct §5.4). Over 200 rows it virtualises (`next/dynamic`, as the lobby list).

**Arena lifecycle.** `tournament:ended` → the banner "The arena has finished. See the results." and `router.replace('/t/{slug}/results')` after 2 s (immediately when the viewer is not in a game).

**Keyboard.** `F` Find Match / Cancel (only when no input has focus), `Esc` cancel search, Enter on the match card goes to the game, `1`/`2` switch the phone segments, `W` watch the top game. All are listed in the `?` sheet.

**Components.** `ArenaHeader` (new; `CountdownTimer` in "ends" mode), `PairingCard` (new), `TopBoardCard` (new; P2 `Board` in read-only mode + `PlayerBar`), `StandingsList` (new; virtualised), `FireBadge` (new), `Segmented`, `Banner`, `Button`, `EmptyState`, `OfflineChip` (socket state).

### 4.5 Live arena: empty, loading and error

- **Loading:** the RSC renders the snapshot, so the first paint has the header, the pairing card and the standings page 1 (streamed in `<Suspense>` with 9 `GhostRow`s). The top board shows a `Skeleton` square until the `tournament:watch` ack (or the DB hint) arrives.
- **Socket not live:** `useConnection()` is `reconnecting` or `offline` → `OfflineChip` "Reconnecting to the arena"; Find Match disabled with `aria-describedby` "Needs a connection"; standings fall back to the cached snapshot (no polling, D12-5). After 25 s a [Reload] text button appears.
- **Errors:** snapshot 404 → `not-found.tsx` (V3Error404 `missing_tournament` copy "This tournament doesn't exist"); snapshot 5xx → `(app)/error.tsx`. A failed standings refetch keeps the old rows with a "Couldn't refresh standings" inline line + Retry.

### 4.6 Tournament game (`/game/[ref]`, tournament overlay)

**Board.** `DR/V4TournamentGame.dc.html`: the full V3Game state enum (55 states, default `tournament`). P2 owns every state except `tournament` and `over_tournament`, which P12 lights up (ALLOC P2). Rematch states never occur in tournament games ("no rematch"); they stay reachable through P2's `V3Game` demo routes.

**What P12 adds.**

- The header reads "C41 · Philidor · Opera Game 1858" with the right header "Arena · 5+3" (from `GameState.header`, filled by the socket from the tournament position label).
- `TournamentStrip` (new, `WEB/features/game/TournamentStrip.tsx`) in P2's zone slot (`zone: 'tour'` in the board data): "Friday Opera Arena · 18:42 LEFT · YOU'RE 3RD · 14 PTS" + [Standings] → `/t/{slug}`. It uses the zone slot, so it adds no height to the board budget; during `study` the study zone has priority and the strip returns at `first_move`. After `endsAt` it reads "Friday Opera Arena · ARENA CLOSED · THIS GAME STILL COUNTS".
- The actions are P2's `online` set (Offer Draw, Resign). There is no rematch.
- Abort in the first-move window → no points, no streak change ("This game was aborted. No points either way." in the strip).
- Phones: the strip collapses to "18:42 · 3RD · 14 PTS" (one line, 28 px).

**Data.** `GameState.tournament` (API §6.7, extended in §7.7): `{ slug, name, endsAt, arenaClosed, place, of, points, fire }`. Live place and points: the game page watches `tournament:{slug}` (a lightweight hold) and applies `standings_delta` to its own row (§5.5).

### 4.7 Tournament game over

**Board.** `DR/V4TournamentGameOver.dc.html` (same enum, default `over_tournament`).

**Card content** (P2's `GameOverCard`, tournament variant): title "You won by checkmate", method "Checkmate · move 17", rating line "Blitz 1184 → 1192 (+8)" (P9), **the tournament line** "+2 points · 3rd of 24 · 18:42 left in the arena" ("+4 points · 2× streak" on fire; "0 points · early draw (before move 10)" for an early draw), accuracy and moments when the analysis is ready (P3; otherwise the Analysing progress), the coach line (P3 §4.7 template, swapped for P7's verified sentence; CC C-02) and the bank line (P5's bank slot from `analysis:done.bankAdded`; CC C-01). Those two are the same `GameOverCard` slots every result card has; the tournament variant adds nothing to them and renders nothing there if their owners drop them (§2.4). CTAs: [Find Match] → emits `tournament:find_match`, then navigates to `/t/{slug}` in `searching`; [Back to Arena] → `/t/{slug}`; [Review] (P3); [New Game] → `/play` as a text link (the board shows it); share (P2).

**Arena finished** (`arenaClosed` or `tournament:ended`): Find Match is hidden; the CTA is [See Results] → `/t/{slug}/results` once finalized, else "Waiting for the last games".

### 4.8 Results (`/t/[slug]/results`)

**Board.** `DR/V4TournamentResults.dc.html` (enum `default | no_games`).

**Layout.** Desktop: shell; header (eyebrow "Finished · 25 Oct · Blitz 5+3", title, "All tournaments"); grid `minmax(0,1fr) minmax(320px,400px)`. Left: Podium (three columns in visual order 2-1-3, DOM order 1-2-3 with CSS `order`), "Your result", "Your games" (rows grid `58px minmax(0,1fr) 56px`: result tag, "vs tal_fan_77 · Found Rxd4 like Kasparov", points; the list scrolls). Right: "Final standings · 31 players · FINAL" (scrolls). Phones and iPad portrait: podium (compact), your result, then `Segmented` Your Games \| Standings over one scroll panel.

**States.**

| State | Condition | UI |
|---|---|---|
| `default` | the viewer played ≥ 1 game | "3rd of 31 · 14 PTS · 6 GAMES · 4W 1D 1L · BLITZ +11" + "Your best game: {headline} against {opponent}. The coach flagged {n} moments across your {k} games." + [Review My Games →] → `/games?tournament={slug}` + [Next Tournament] → `/tournaments?tab=upcoming`. While analyses are pending: "Coach notes arrive when your reviews finish." |
| `no_games` | the viewer joined and played 0 games | "You joined but didn't play a game, so there is nothing to review." + [Find the Next Tournament] |
| (watcher) | not a participant, or signed out | the "Your result" section is hidden; podium and standings only |

Your Games rows link to `/review/{gameRef}` (P3; a legend-position tournament game may link to compare). Points shown per game come from `GamePlayer.tournamentPoints` ("+4" only for a game played on fire). The board's sample data (+2, +2, 0, +4, +1, +2 summing to 11 against "14 PTS") is inconsistent; the server values are the truth.

**Accessibility.** The podium is a list with `aria-label` per place ("1st, vera_b, 21 points"). Ties never share a rank (D12-13); an `InfoButton` next to "Final standings" explains "Ties are broken by fewer games played, then by who joined first."

### 4.9 Admin shell (shared by §4.10–4.15)

- **Route group** `WEB/app/(admin)/admin/layout.tsx`: `requireAdmin()` (DB role from `getViewer()`); signed out → `/sign-in?redirect_url=/admin…` (middleware); not an admin → the forbidden view in place with HTTP 403 (`forbidden()` from `next/navigation` with `experimental.authInterrupts: true`; if that flag is not acceptable, render `<AdminForbidden/>` with 200 and `noindex`). Every admin page also calls `requireAdminPage()`, because layouts do not re-run on soft navigation (CDL §0.1).
- **Admin nav** (left, 220 px, own layout, no app rail): logo "Admin", Dashboard, Positions, Legends, Tournaments, Reports (only when the `reports` table exists), "Back to the app".
- **Small screens:** under 1100 px wide a `Banner` "Admin works best on a larger screen." sits above the content. Nothing is hidden.
- **Layout:** lock mode; the list+edit pages use the grid `minmax(0,1fr) minmax(320px,380px)` (from the boards): a table panel that scrolls on the left and an edit panel on the right.
- **Shared components (new, `WEB/features/admin/components/`):** `AdminNav`, `AdminTable` (sticky header, row selection with ↑/↓, `aria-selected`), `MetricTile`, `ActivityFeed`, `HealthCard`, `PositionEditor`, `FenField`, `LegendEditor`, `PortraitUploader`, `TournamentForm`, `PositionPicker`, `TournamentPreviewCard`, `ReportsTable`, `ConfirmDialog` (wraps `Dialog`, with Clerk reverification).

### 4.10 Admin dashboard (`/admin`)

**Board.** `DR/V4Admin.dc.html` (enum `default | forbidden`).

**Layout.** Six metric tiles in `repeat(6, minmax(0,1fr))`; below, a grid `minmax(0,1fr) minmax(320px,380px)`: Recent activity (rows `56px 100px minmax(0,1fr)`: time, kind, message; scrolls) on the left; Quick actions and Health on the right.

**States.** `forbidden`: shield icon, "You need admin access", "Signed in as knightowl_88. Ask an owner to make you an admin." (acct Q31 replaces "add you in Clerk"), [Back to the App]. `default`: tiles "Users 104 · +6 this week", "Games 378 · 41 today", "Active members 23 · 2 past due", "Positions 3,641 · 12 drafts", "Legends 51 · 3 need portraits", "Tournaments 18 · 1 live · 3 upcoming"; the activity feed; quick actions [Create Tournament], "Add a position", "Edit legends"; Health "Socket server · OCI · 9 games live · Healthy", "Analysis queue · Median 8 s · Normal".

**Health states:** Healthy / Degraded / Down for the socket, and Normal / Busy / Backed Up for analysis, plus Unknown when the call times out (§8.9). The health card shows a `Skeleton` line until its first query resolves (it is not server-rendered: it calls OCI).

**Activity rows.** "12:41 · Tournament · Friday Opera Arena started · 24 players", "12:30 · Billing · Payment failed for knightowl_88 · retrying", "11:58 · Positions · “Topalov vs Shirov, move 47” published", "11:20 · Users · New sign-up from /legends/positions/kasparov-topalov-1999" (`signupSource`, acct Q32; never `/try`, never an email), "10:05 · Legends · Mikhail Tal bio edited", "09:12 · System · Analysis queue back to normal (median 8 s)". Rows with `href` link to the entity. Infinite scroll inside the panel.

### 4.11 Admin positions (`/admin/positions?q&status&legend&selected=<ref>`)

**Board.** `DR/V4AdminPositions.dc.html` (enum `default | loading | fen_invalid | saving | error`).

**Layout.** Header: search input "Search 3,641 positions" + "6 shown" + [New Position]. Table panel: columns Game (mini board + title + event), Legend, Year, Status (Published `good`, Draft `warn`); grid row `minmax(0,1fr) 96px` for the mini board area. Edit panel: status pill, preview board (live from the FEN field), Title, FEN (`aria-invalid`), Legend `select` (all legends, by name) with a White/Black toggle that sets `heroSide` and writes the matching `whitePlayerId`/`blackPlayerId` legend link (the other side's link is untouched), Year, Blurb (≤ 280, counter), [Delete] and [Save].

**States.**

| State | Trigger | UI |
|---|---|---|
| `loading` | first page while filtering with no cached data | table `aria-busy` with ghost rows; edit panel disabled |
| `default` | a row selected | form filled; preview from the FEN |
| `fen_invalid` | the FEN field fails local validation (debounced 150 ms) | inline error, exact copy for the rank-width case: "Not a legal FEN: rank 2 has 9 squares. Each rank needs exactly 8." Other messages in §8.10. Save disabled. Valid → hint "White to move · checked with chess.js" |
| `saving` | PATCH/POST pending | Save shows "Saving…"; fields read-only |
| `error` | PATCH failed (5xx or network) | `role=alert` "Failed to save chess position. Try again."; edits are kept |
| (conflict) | 412 | banner "This position changed elsewhere. Reload it to see the latest." [Reload] |
| (duplicate) | 409 `fen_taken` | FEN error "This position already exists: Byrne vs Fischer." with a link that selects that row |

**Interactions.** ↑/↓ move the row selection (focus stays in the table; `?selected` via `replaceState`); `/` focuses search; ⌘/Ctrl+S saves; ⌘/Ctrl+Backspace → archive (Delete) with a confirm dialog "Archive this position? It disappears from the public library. Games that used it keep it." (Clerk reverification; archive sets `status = ARCHIVED` **and** `isActive = false`, because P8's catalogue queries and partial indexes filter on `isActive`, CS fix 12.4); `N` = New Position (creates a draft from the start position and selects it; toast "New draft position created"). Saving shows the toast "Chess position saved successfully". Dirty form + navigation → "Discard your changes?" confirm.

### 4.12 Admin legends (`/admin/legends?q&selected=<ref>`)

**Board.** `DR/V4AdminLegends.dc.html` (enum `default | loading | saving | error`).

**Layout.** Search "Search 51 legends" + [New Legend]; table columns Legend (avatar), Era, Style, Positions (count); edit panel: portrait (grid `minmax(0,1fr) minmax(0,1fr)` for the portrait block) with [Replace Portrait] and the hint "Grayscale, square, at least 512 px", Portrait source (URL, required unless the licence is "Own photo"), Licence (`select`: Public domain · CC BY · CC BY-SA · Own photo · Used with permission; CF LIC-6), Name, Era, Style (`playingStyle`), Bio (`shortDescription`, ≤ 500 with a counter), [Save]. A legend with `deathYear = null` (a living player) shows the note "Living player: use a portrait you have permission to publish." under Licence (owner policy O12-16).

**States.** `loading` (ghost rows), `default`, `saving` ("Saving…"), `error` "Failed to save legend. Your edits are still here." Name conflict → field error "Another legend already has this name." Portrait flow: pick a file → the client checks type (jpeg/png/webp), size ≤ 8 MB before processing, width and height ≥ 512 and a square within 2 % → canvas crop to square, resize to 512×512, grayscale, encode JPEG q 0.85 → ADM-9 presign → PUT to R2 with `Progress` → PATCH `profilePhotoUrl`, `portraitSource`, `portraitLicence` → toast "Portrait replaced". Portraits are already 512 px JPEGs, so every `next/image` that shows one uses `unoptimized` and costs no Hobby image transformation (CF F-VER-4). Wrong image: field error "Use a square image at least 512 px wide." The list is the whole legend set (≤ 100 rows), filtered on the client (no search requests).

There is no Delete for legends on the board, so none ships (legend removal stays a database task; P8's visibility rules decide what is public).

### 4.13 Admin tournaments list (`/admin/tournaments?status`)

**Board.** `DR/V4AdminTournaments.dc.html` (enum `default | empty`).

**Content.** [Create Tournament]; table columns Name, Status (LIVE, LOBBY, SCHEDULED, COMPLETED, CANCELLED), Starts, Players "24 / 64", Clock, [Open] → `/t/{slug}` (or results). Row overflow menu ⋯ (DS overflow pattern; not drawn on the board): Edit (before the start) → `/admin/tournaments/{slug}/edit`; Copy Invite Link; Duplicate (opens the create form prefilled with a new start); Start Now (lobby); End Now (live); Cancel (confirm with reverification when it has participants). `empty`: "No tournaments yet" + "Create one from a legend position. Players see it in the Upcoming tab straight away." + [Create Tournament].

### 4.14 Admin create and edit tournament (`/admin/tournaments/new`, `/admin/tournaments/[slug]/edit`)

**Board.** `DR/V4AdminTournamentCreate.dc.html` (enum `default | validation | creating | error | created`).

**Layout.** Grid `minmax(0,1fr) minmax(280px,340px)`: the form (two-column field grid `repeat(2, minmax(0,1fr))` where the board pairs fields) and the "Players will see" preview card.

**Fields and validation** (client zod from `CT/http/admin.ts`, the same schema on the server):

| Field | Control | Rule | Error copy |
|---|---|---|---|
| Name | `Field` | 1–100 chars, trimmed | "Give the tournament a name." |
| Description | textarea | ≤ 280 | "Keep the description under 280 characters." |
| Clock | `radiogroup` chips 3+2 · 5+3 · 10+0 | one of the three | — |
| Duration | `radiogroup` 30 · 60 · 90 min | one of the three | — |
| Start | `datetime-local` in the admin's timezone, shown as "2 Nov 2026 · 19:00" | ≥ now + 10 min (server re-checks with its clock); ≤ now + 60 days | "That time has passed. Pick a start at least 10 minutes from now." |
| Max players | number | integer 2–`TOURNAMENT_MAX_PLAYERS` (64 until the §9.7 run at 256 passes, D12-18) | "Between 2 and {cap}." |
| Positions | `PositionPicker`: a combobox searching published positions (`GET /api/admin/positions?status=published&q=`, debounced 250 ms) above ordered chips (`aria-pressed`), each with ↑/↓ reorder buttons and remove; "played in order, one per round" | 1–10 | "Pick at least one position." |
| Who can join | `radiogroup` Everyone · Invite link only | — | — |

The status note (`role=status`) reads "{n} field(s) need(s) attention." when invalid, "Ready to publish." when valid, and "Published." after creation. On submit with errors, focus moves to the first invalid field (`validation` state) and the note counts them.

**States.** `default` (prefilled defaults: 5+3, 60 min, max 32, start = next round hour ≥ 10 min away, Everyone); `validation`; `creating` (button "Creating…"); `error` "Failed to create tournament. Nothing was published." (button "Try Again"); `created` "Created. It is in the Upcoming tab now." + [Open Lobby] → `/t/{slug}`.

**Preview card.** First-position board, the name (or "Untitled tournament"), "Blitz 5+3 · 60-minute arena · up to 32 players · 5 positions". The board computes "Blitz" for every clock; the shipped label derives the time class (10+0 → "Rapid 10+0", §8.11).

**Edit mode.** The same form, loaded with `If-Match`. Only before the start: name, description, start, max players (≥ current participants), positions, visibility. After the start the page shows a read-only summary with End Now and Cancel.

### 4.15 Admin reports (`/admin/reports?status=open`)

No board (ALLOC P12, acct Q10). Built from the kit: `PageHeader` "Reports", `Tabs` Open · Actioned · Dismissed, `AdminTable` over P5's `reports` table (one table for every report kind, CS R-02) with Reported (target type: `user`, `game`, `mistake`, `puzzle`, `lesson`, `position` or `coach_message`, + link), Reason, Note (truncated), Reporter, Age; the edit panel shows the full note and actions: [Dismiss], [Mark Actioned], and for user targets [Suspend User] / [Unsuspend] (reverification; refuses the viewer (403 `forbidden {reason: "self"}`) and the last admin (409 `conflict {reason: "last_admin"}`, P10's reason)). Rename (`INAPPROPRIATE_NAME`) is offered only when P10's username column exists. Empty state: "No open reports" + "Reports from players appear here." Loading and error: the shared table states.

### 4.16 Dev demo routes (`/dev/ui/tournaments`)

`WEB/app/dev/ui/tournaments/page.tsx` renders each P12 screen component with fixture data from `WEB/features/tournaments/fixtures.ts` (the boards' TT/PL arrays as typed fixtures), selectable by `?screen=list|join|lobby|live|results|admin-*&state=<enum>&device=` with no network. The Playwright device suite uses it for states that real data reaches only briefly (`joining`, `matched`, `saving`, `creating`, `error`) and for `free` when O12-6 is declined.

---

## 5. UI ↔ API data flow

Conventions are CDL's and ALLOC §5.4's: first paint from RSC through the server-only DAL (`WEB/lib/data/*.ts`, `import "server-only"`), seeded into TanStack Query with `HydrationBoundary`; client reads through P1's `api()` with keys from the `qk` directory; mutations through `api()` + `useMutation` with no server actions; pushes over the one socket per tab (`WEB/lib/realtime/connection.ts`) patch the cache with `setQueryData`; polling only where §5.9 allows it. Response schemas are passed as `schema: devSchema(X)`, so zod parses in dev and test only and the schema modules drop out of production bundles (CA AP-12). Socket frames are validated by a dev-only dynamic import, as P2 does.

### 5.1 Query keys added in P12 and their freshness

Keys live in the P1 key directory: `WEB/lib/api/keys/tournaments.ts` and `WEB/lib/api/keys/admin.ts`, re-exported from `keys/index.ts` (CF §7). If P1 kept the single `keys.ts`, WP-E appends the same entries there in one PR.

```ts
// WEB/lib/api/keys/tournaments.ts
export const tournaments = {
  list: (tab: "live" | "upcoming" | "finished") => ["tournaments", "list", tab] as const,   // CDL §3.3 skeleton
  mine: () => ["tournaments", "mine"] as const,                                              // NEW: my registrations (TOU-13)
  detail: (slug: string) => ["tournaments", slug] as const,                                  // snapshot (TOU-2)
  me: (slug: string) => ["tournaments", slug, "me"] as const,                                // NEW: TOU-7
  standings: (slug: string) => ["tournaments", slug, "standings"] as const,                  // infinite (TOU-6)
  participants: (slug: string, q: string) => ["tournaments", slug, "participants", q] as const, // TOU-3
  results: (slug: string) => ["tournaments", slug, "results"] as const,                      // NEW: TOU-11 public part
  resultsMe: (slug: string) => ["tournaments", slug, "results", "me"] as const,              // NEW: TOU-11m
  invite: (code: string, tag: string | null) => ["tournaments", "invite", code, tag] as const, // NEW: TOU-12
};
// WEB/lib/api/keys/admin.ts
export const admin = {
  metrics: () => ["admin", "metrics"] as const,
  health: () => ["admin", "health"] as const,
  activity: (f: Filters) => ["admin", "activity", norm(f)] as const,
  list: (entity: "positions" | "legends" | "tournaments" | "reports", f: Filters) => ["admin", entity, norm(f)] as const,
  detail: (entity: string, ref: string) => ["admin", entity, "detail", ref] as const,
};
```

| Key | Endpoint | DAL (first paint) | `staleTime` | Focus refetch | Realtime updater | Seed |
|---|---|---|---|---|---|---|
| `tournaments.list(tab)` | TOU-1 | `listTournaments(tab, null)` | 30 s | yes | refetch scheduled at the next phase boundary of any visible row (§5.2) | RSC prefetch of the default tab; hover/focus prefetch of the other two tabs |
| `tournaments.mine()` | TOU-13 | `listMyTournaments(viewer)` | 30 s | yes | join/leave mutations → `setQueryData`; `tournament:paired` → invalidate | RSC (signed in only) |
| `tournaments.detail(slug)` | TOU-2 | `getTournamentSnapshot(slug)` | **∞ while the room is watched**, else 30 s | only when not watched | `tournament:started/updated/ended/cancelled` → invalidate; `player_joined/left` → patch `players` | RSC |
| `tournaments.me(slug)` | TOU-7 | `getMyTournamentState(viewer, slug)` | 0 while watched (patched by events), else 10 s | yes | own row from `standings_delta`; join/leave mutation responses | RSC (signed in) |
| `tournaments.standings(slug)` (infinite, rank cursor) | TOU-6 | `listStandings(slug, null, 50)` | ∞ while watched | no | `standings_delta` (versioned reducer, §5.4) | RSC, streamed in `<Suspense>` |
| `tournaments.participants(slug, q)` (infinite) | TOU-3 | `listParticipants(slug, '', null)` | 30 s (∞ while watched for `q=''`) | no | `player_joined/left` → patch page 1 | RSC (lobby) |
| `tournaments.results(slug)` | TOU-11 | `getResults(slug)` | ∞ (immutable after finalize) | no | — | RSC |
| `tournaments.resultsMe(slug)` | TOU-11m | `getMyResults(viewer, slug)` | 60 s; 0 while `pendingAnalyses > 0` | yes | `analysis:done` for one of my tournament games → invalidate | RSC (signed in) |
| `tournaments.invite(code, tag)` | TOU-12 | `getInvite(code, tag)` | 30 s | yes | refetch once when the countdown reaches 0 | RSC |
| `admin.metrics()` | ADM-1 | `getAdminMetrics()` | 60 s | yes | admin mutations → stale | RSC |
| `admin.health()` | ADM-11 | — (client only) | 15 s, `refetchInterval: 30_000` while visible, `refetchIntervalInBackground: false` (§5.9) | yes | — | none |
| `admin.activity(f)` (infinite) | ADM-2 | `listActivity(f, null)` | 30 s | yes | admin mutations → stale | RSC |
| `admin.list(e, f)` (infinite) | ADM-3/6/8/12 | per-entity DAL | 0 | yes | mutation responses patch the row | RSC |

### 5.2 Tournaments list

1. **First paint.** `WEB/app/(app)/tournaments/page.tsx` (server) reads `searchParams.tab`/`t`, calls `getViewerOptional()`, then in `Promise.all`: `listTournaments(tab)` (cached DAL, §9.3; it returns `counts` with page 1) and `listMyTournaments(viewer)` when signed in. Both seed the cache; the page renders the list and the aside with no client fetch.
2. **Merging "YOU'RE IN".** The client merges `tournaments.mine()` into the rows by slug. Invite-only tournaments the viewer is in come from `mine()` with their full `card` and are inserted into their tab (D12-8). TOU-1 stays a public, CDN-cacheable response that never depends on the viewer.
3. **Tabs and selection.** Tab and selection live in the URL (`replaceState`, CDL D8): no RSC round trip. Switching to an unseeded tab runs `useQuery(qk.tournaments.list(tab))` with `placeholderData: keepPreviousData` (old rows dim, hairline after 200 ms). Hovering or focusing a tab prefetches it. `counts` come only with page 1 (no `cursor`); later pages carry `meta.nextCursor` only (CA AP-38).
4. **Phase changes without polling.** Every card carries `startsAt`, `endsAt` and `lobbyOpensAt`, and the client derives the displayed phase with the shared `derivePhase()` (§8.4) on `useNow(1000)`. When a visible row crosses a boundary, the client re-derives its pill immediately and schedules one `invalidateQueries(list(tab))` 3 s later (the server state has caught up by then). Player counts refresh on focus (≤ 30 s stale). No interval polling, no socket hold on the list (OPT D8 and CDL D10; a `tournaments` index room was rejected as not worth a socket per visitor).
5. **CTA navigation.** CTAs are `AppLink`s with intent prefetch (CDL §3.8). The live CTA also warms `qk.tournaments.detail(slug)` with `prefetchQuery` on pointer-enter.
6. **Errors.** `QueryState` maps a failed list with no data to the `error` state; GETs retry twice on network and 5xx (CDL §3.7). 402/401 never occur (public route).

### 5.3 Join from invite

1. **First paint.** `WEB/app/(app)/t/[slug]/join/page.tsx` (server): `getInvite(c, i)` (by code; falls back to slug for public tournaments without a code), `getViewerOptional()`, and when signed in `getMyTournamentState(viewer, slug)`. The page decides the initial state on the server: `not_found`, `closed`, `full`, `joined`, `paywalled` (`viewer.entitlement.state === "lapsed" && !trial.eligible`), the trial variant (`state === "none" && trial.eligible`), signed-out, `starting_soon` or `default`. The model includes `serverNow`, so the client countdown uses `offset = serverNow − Date.now()` captured at hydration.
2. **Join mutation.** `useJoinTournament(slug)` → `api('/api/tournaments/{slug}/participants', { method: 'POST', body: { inviteCode: c } })`. **Not optimistic** (capacity, CDL §3.6). `onSuccess`: `setQueryData(qk.tournaments.me(slug), data.me)`, `setQueryData(mine)`, `invalidateQueries(detail(slug), { refetchType: 'none' })`, `invalidateQueries(list(*), { refetchType: 'none' })`; then the `joined` state, or navigation to `/t/{slug}` for late entry. The response includes the updated `me`, so there is no refetch.
3. **Error mapping** (per-mutation `onError`; the globals handle 401 and 402 first):

| Response | State |
|---|---|
| 201 / 200 (`already_joined` is 200 with the existing row) | `joined` |
| 402 `subscription_required` with `details.reason` `trial_available` / `trial_used` / `expired` (CS fix 12.12) | the global reaction (P11 D18): `trial_available` → `paywallUrl(<this URL with autojoin=1>)`; `trial_used` / `expired` → the `RenewSheet` with `returnTo` = this URL with `autojoin=1`; `payment_failed` → the portal link |
| 409 `conflict` `tournament_full` | `full` (and patch the card's `players`) |
| 409 `conflict` `registration_closed` | `closed` |
| 403 `forbidden` `invite_required` | `not_found` (the code was rotated) |
| 404 | `not_found` |
| 429 `rate_limited` | `RateLimitedInline` countdown on the button |
| 503 `maintenance` (P11 `area: "online"`) | P11's maintenance banner; the button reads "Joining is paused for maintenance" (disabled) |
| 5xx / network | `error` ("Couldn't join…"), button "Try Again" |

4. **`autojoin=1`.** A client effect runs the mutation once when `autojoin=1`, the viewer is signed in and entitled, and the state is joinable; then `history.replaceState` drops the param, so a reload never double-joins (it would be a harmless 200 anyway).

### 5.4 Lobby and live arena (`/t/[slug]`)

**First paint (RSC).** `WEB/app/(app)/t/[slug]/page.tsx`: `getTournamentSnapshot(slug)` (awaited; it decides the view) and, in `Promise.all`, `getMyTournamentState(viewer, slug)`. The standings page 1 (live) or the participants page 1 (lobby) is an async server component inside `<Suspense>` with its own `HydrationBoundary` (CDL §2.4 nested pattern). The top board renders from `snapshot.topBoardHint` (the last checkpoint of the best-ranked live game) so it is never blank.

**One hook owns the realtime side: `useTournamentRoom(slug)`** (`WEB/features/tournaments/useTournamentRoom.ts`):

```ts
import { ROOM } from "@repo/contracts/socket/rooms";

export function useTournamentRoom(slug: string, opts: { mode: "arena" | "strip" }) {
  const qc = useQueryClient();
  useEffect(() => {
    const release = realtime.acquire("lobby");                       // P2 hold; non-critical (disconnects after 5 min hidden)
    const leave = realtime.room(ROOM.tournament(slug),
      async () => {                                                  // runs now and after every (re)connect: snapshot resync
        const ack = await realtime.command("tournament:watch", { slug });
        if (!ack.ok) return;
        applyWatchAck(qc, slug, ack);                                // topBoard, liveCount, me.searching / inGameRef
        const local = qc.getQueryData(qk.tournaments.standings(slug))?.pages[0]?.version ?? -1;
        if (ack.standingsVersion !== local) {
          await sleep(Math.random() * 2000);                         // spread a post-restart crowd (CA AP-25)
          refetchStandings(qc, slug, ack.standingsVersion);          // GET …/standings?minVersion=<n>: one CDN miss per version
        }
      },
      () => void realtime.command("tournament:unwatch", { slug }));
    const on = <E extends TournamentEvent>(e: E, fn: (p: EventPayload<E>) => void) =>
      realtime.on(e, (p) => p.slug === slug && fn(p));
    const offs = opts.mode === "strip"
      ? [on("tournament:standings_delta", (e) => applyStandingsDelta(qc, slug, e)),
         on("tournament:ending_soon", (e) => patchDetail(qc, slug, { endsAt: e.endsAt })),
         on("tournament:ended", (e) => onEnded(qc, slug, e, { navigate: false }))]
      : [on("tournament:player_joined", (e) => patchParticipants(qc, slug, e)),
         on("tournament:player_left", (e) => patchParticipants(qc, slug, e)),
         on("tournament:started", () => qc.invalidateQueries({ queryKey: qk.tournaments.detail(slug) })),
         on("tournament:updated", () => qc.invalidateQueries({ queryKey: qk.tournaments.detail(slug) })),
         on("tournament:standings_delta", (e) => applyStandingsDelta(qc, slug, e)),
         on("tournament:top_board", (e) => topBoardStore.set(slug, e)),
         on("tournament:game_started", (e) => patchLiveCount(qc, slug, e.liveCount)),
         on("tournament:game_ended", (e) => patchLiveCount(qc, slug, e.liveCount)),
         on("tournament:ending_soon", (e) => patchDetail(qc, slug, { endsAt: e.endsAt })),
         on("tournament:ended", (e) => onEnded(qc, slug, e, { navigate: true })),
         on("tournament:cancelled", (e) => onCancelled(slug, e))];
    return () => { offs.forEach((off) => off()); leave(); release(); };
  }, [slug, opts.mode, qc]);
}
```

- **Standings delta reducer** (`WEB/features/tournaments/standings.ts`, pure and unit-tested). Input: the cached infinite pages (the top K loaded rows, `version`) and a delta `{ version, of, rows: StandingRow[≤2] }` whose `rank`/`prevRank` were computed by the socket mirror (D12-13). If `delta.version <= local` → ignore (a duplicate or out-of-order event). If `delta.version > local + 1` → refetch with `minVersion = delta.version` (a gap; the URL differs from the cached one, §9.3). If `delta.version === local + 1` → remove the changed rows by player ref, then insert each at index `rank − 1` in ascending rank order (rows whose score did not change keep their relative order, so this is exact), drop rows beyond K, renumber `rank = index + 1`, set `version`. A changed row whose `rank > K` is not inserted. **The viewer's rank** when outside the loaded prefix: for each changed row, `prevRank < myRank && rank >= myRank` → `myRank − 1`; `prevRank > myRank && rank <= myRank` → `myRank + 1`. The viewer's own row arrives in the delta when the viewer's game ended.
- **Searching state** lives in a Zustand store (`WEB/features/tournaments/arenaStore.ts`, `{ [slug]: { state, since, gameRef, color, opponent, autoNavAt } }`), so it survives client navigation to the game and back. It is not server data, so it is not in the query cache (CDL §6.1).
- **Find Match** is a socket command, not HTTP: `realtime.acquire("arena_search")` (a new **critical** hold: never disconnected while hidden), then `realtime.command("tournament:find_match", { slug })`. Ack `{ ok: true, since }` → `searching`. Ack codes (`CT/socket/codes.ts`): `not_member` (with `reason: "trial_available" | "trial_used" | "expired"` from the token) → the same D18 reaction as a 402, with `returnTo` = the arena URL; `not_participant` → refetch `me`; `phase` → refetch the snapshot; `already_in_game` → navigate to `ack.gameRef`; `maintenance` → the maintenance overlay (§4.4); `rate_limited` → re-enable after `retryAfterMs`. Starting a search here ends a quick-match search in another tab (`queue:moved` there), and vice versa (D12-16). Cancel: `tournament:cancel_search` → `idle`, then release the hold.
- **Paired.** `tournament:paired` arrives on `user:{ref}`; `WEB/lib/realtime/handlers/tournaments.ts` routes it to the arena store. The store sets `matched` with `autoNavAt = receivedAt + 5000`, calls `router.prefetch('/game/' + gameRef)` and writes `usePendingBoard({ ref, fen, orientation })`, so the game route paints the board instantly (P2). It navigates at `autoNavAt` when this tab is visible and on `/t/{slug}`; otherwise it shows a toast with a link.
- **Search ended.** `tournament:search_ended { reason }` → `idle` + a banner per reason: `ended` "The arena has closed. Your final score: {score}."; `cancelled` (handled by the cancelled redirect); `moved` "You started a quick-match search, so this search stopped."; `removed` "You can't search in this arena right now."; `maintenance` (the overlay).
- **Reconnect.** P2's connection re-runs every `room()` join on connect, so `tournament:watch` resyncs the top board, `liveCount` and `me.searching`. When the store says `searching` but the ack's `me.searching` is null (the server restarted and the pool is empty), the client re-emits `find_match` and keeps its original `since` for the on-screen timer.
- **Lobby → live.** `tournament:started` invalidates the snapshot; the refetched snapshot has phase `live`, and the page component swaps `<Lobby/>` for `<LiveArena/>` (same route). Belt and braces: when the client countdown reaches 0 and no `started` event arrives within 5 s, it invalidates the snapshot once.
- **Signed-out viewers** have no socket token (P2 issues tokens to signed-in users only), so they get the RSC snapshot plus focus refetch (staleTime 30 s). The page shows "Sign in to follow the arena live" under the standings heading.
- **No polling while the socket is down** (D12-5): the arena shows the reconnecting chip. The standings stay as last seen and refresh on reconnect through the watch ack's `standingsVersion` check.

**Mutations on this screen.**

| Action | Call | Optimistic | Cache effect |
|---|---|---|---|
| Join (lobby or late entry) | TOU-4a POST | no | `me`, `mine` set from the response; `detail` stale; the socket `player_joined` patches everyone else |
| Leave (lobby only) | TOU-4b DELETE | no | `me` → not participant; `mine` patched |
| Start Now (host) | TOU-9a | no | the response sets `detail.phase = 'live'`; the socket `started` follows |
| Find Match / Cancel | socket commands | the button shows the state at once; on a negative ack it reverts (CA AP-30 already satisfied) | arena store only |

### 5.5 Tournament game and game over

- **First paint.** P2's `getGameSnapshot(viewer, ref)` (`WEB/lib/games/snapshot.server.ts`, RSC) now fills `GameState.tournament` from `games."tournamentId"` (D12-11): `{ slug, name, endsAt, arenaClosed: now >= endsAt, place, of, points, fire }`, with place and points from the participant row and the rank window (§8.5). One extra indexed read on tournament games only.
- **Live.** The socket's `game:join` ack carries the same block (filled from the runtime's mirror, no DB read). The game page acquires a non-critical `lobby` hold and joins `tournament:{slug}` through `useTournamentRoom(slug, { mode: "strip" })`: it consumes only `standings_delta` (for the viewer's own place, using the rank-shift rule in §5.4), `ending_soon` and `ended`.
- **Game over.** P2's post-persistence `game:result` (P2 §7.4) now carries `tournament: { sides: { w: { points, fire, rank }, b: { points, fire, rank } }, of, endsAt, arenaClosed } | null`, which the socket builds from the finish statement's tournament block and its mirror (§8.5), so the card needs no fetch. On a reload after the end, the RSC snapshot carries the same values from `GamePlayer.tournamentPoints` and the rank window.
- **Find Match from the card.** It sets the arena store to `requesting`, sends the command, and navigates to `/t/{slug}` immediately (the arena shows `searching` once the ack lands).

### 5.6 Results

- **RSC.** `getResults(slug)` (cached DAL, tag `tournament:<slug>`; it reads `finalStandings` only) and `getMyResults(viewer, slug)` (uncached: participant row + `game_players` on `game_players_tournament_idx`, with the opponent from `game_players."opponentName"`/`"opponentUserId"`/`"opponentRating"`). Phase not `finished` → `redirect('/t/{slug}')`.
- **Late coach notes.** `resultsMe.pendingAnalyses > 0` → the copy "Coach notes arrive when your reviews finish." `WEB/lib/realtime/handlers/tournaments.ts` listens to P3's `analysis:done {gameRef}` and invalidates `resultsMe(slug)` when `gameRef` is one of the viewer's tournament games (the set comes from the cached `resultsMe`). No `tournament:results_updated` event is needed (allocation listed it; this replaces it at zero cost).

### 5.7 Admin screens

| Screen | First paint (RSC + DAL) | Client reads | Mutations | Cache after a mutation |
|---|---|---|---|---|
| Dashboard | `getAdminMetrics()` (cached 60 s), `listActivity({}, null)` | `admin.health()` (client only, 30 s interval while visible); activity next pages | — (quick actions are links) | — |
| Positions | `listAdminPositions(filters, null)` page 1 (with `meta.total`, page 1 only, CA AP-38) + the selected row | `admin.list('positions', f)` infinite; search debounced 250 ms, `signal` aborts stale requests, `keepPreviousData` | ADM-3b POST (new draft), ADM-4a PATCH (`If-Match: <version>`), ADM-4b DELETE (archive) | `setQueryData` the row into every cached page of `admin.list('positions', *)`; `metrics` stale. Not optimistic (CDL §3.5) |
| Legends | `listAdminLegends()` (P8's ADM-6 GET, all ≤ 100 rows) | client-side filter, no requests while typing | ADM-6b POST, ADM-7 PATCH (`If-Match`), ADM-9 presign + R2 PUT + ADM-7 PATCH | row replaced from the response |
| Tournaments | `listAdminTournaments(filters, null)` | `admin.list('tournaments', f)` | ADM-8e cancel, ADM-8f duplicate; TOU-9 start / end | row replaced; `tournaments.list(*)` stale (same tab) |
| Create / edit | edit: `getAdminTournament(slug)` | `admin.list('positions', {status:'published', q})` for the picker | ADM-8b POST with `Idempotency-Key` (uuid kept in component state for the form's lifetime, so a double click replays) / ADM-8d PATCH with `If-Match` | navigate to the created state; `admin.list('tournaments', *)` stale |
| Reports | `listReports({status:'open'}, null)` | `admin.list('reports', f)` | ADM-13 resolve, ADM-14 suspend | row moves tab; `metrics` stale |

Forms keep their own dirty state in React (no query for drafts). The zod schema from `CT/http/admin.ts` runs on blur and on submit for inline errors (admin routes only, so the schema never reaches a player bundle); the server re-validates and its `validation_failed` `details.issues` map to the same fields.

### 5.8 Error handling per screen (globals from `QueryProvider`)

| Code | Tournament screens | Admin screens |
|---|---|---|
| 401 `unauthorized` | global: session reload, then `V3SessionExpired`. Public reads never return 401 | same; the layout redirects signed-out visitors before any request |
| 402 `subscription_required` (`details.reason` `trial_available` / `trial_used` / `expired`) and `payment_update_required` | join and the socket `not_member` → P11 D18 routing with `returnTo` = the current URL + `autojoin=1`. Reads are never gated | n/a (admins pass the paywall) |
| 403 `forbidden` | `details.reason: "invite_required"` → join `not_found`; `"not_host"` on start/end → toast "Only the host can start this tournament." | forbidden view (pages); toast "You need admin access" (APIs); `"self"` on suspend → inline "You can't suspend yourself." |
| 403 `reverification_required` | — | Clerk `useReverification()` opens, then the mutation is retried once |
| 404 | join `not_found`; `/t/[slug]` → `not-found.tsx` | `notFound()` inside the admin layout |
| 409 `conflict` | `tournament_full`, `registration_closed`, `already_started` (leave after start: toast "The arena has started. You can stop searching, but your score stays."), `not_enough_players` (Start Now: toast "At least 2 players must join before you start."), `already_ended` | `fen_taken`, `name_taken`, `slug_taken` (retried server-side, never surfaced), `already_started` (edit after start), `already_resolved` (reports), `last_admin` (suspend) |
| 412 `precondition_failed` | — | "changed elsewhere" banner + Reload |
| 422 `illegal_position` | — | FEN field error |
| 429 `rate_limited` | join button countdown | upload: "Too many uploads. Try again in {mm:ss}." |
| 503 `maintenance` | P11 banner; join and Start Now disabled | P11 banner (admins pass P11's gate for documents, not for `area: "online"` APIs) |
| 5xx / network | GETs retry ×2 then `ErrorState`; mutations toast "Failed to join the tournament" + Retry with the request id | toast "Failed to save …" + the screen's inline error state |

### 5.9 Polling (all of it)

| Poller | Justification | Schedule | Stops |
|---|---|---|---|
| `admin.health()` | It reads two OCI endpoints that have no push channel to the admin; admin-only, ≤ 1 viewer | 30 s while the tab is visible (`refetchIntervalInBackground: false`, CF §10.4) | hidden tab, unmount |

There is no other polling in P12. The removed pollers: `FindMatchButton.tsx:68-95` (2–4 s), `useTournamentLobby.ts:89-99,137-141` (full refetch per event), and the three countdown `setInterval`s (`(app)/tournaments/page.tsx:72`, `TournamentHeader.tsx:44`, `join-tournament/…/page.tsx:55`), which become the shared `useNow(1000)` ticker (CDL §5.9). A lint rule (`no-restricted-syntax` on `setInterval` in `WEB/features/tournaments/**`) keeps it that way.

### 5.10 Prefetching

| Trigger | Prefetch |
|---|---|
| Hover/focus a list tab | `prefetchQuery(list(tab))` |
| Hover the aside CTA (live or lobby) | `prefetchQuery(detail(slug))` + `router.prefetch('/t/' + slug)` (intent, ≤ 1 invocation per 30 s) |
| `tournament:paired` | `router.prefetch('/game/' + ref)` + `usePendingBoard` |
| Game-over card mounted (tournament) | `router.prefetch('/t/' + slug)` |
| Results "Review My Games" hover | `router.prefetch('/games?tournament=' + slug)` |
| Admin table row hover | none (rows are already in the list payload) |

---

## 6. Data model (migration M12)

Consistent with DM §5.9 (tournament arena, which DM numbered M8 under the old phase plan; ALLOC moves it to M12) and DM §3.21 (D21). `AuditLog` already exists: P4 creates it in M4 (CS R-04). Everything is additive. Prisma 6.17.1, PSL in `DB/prisma/schema.prisma`. Column names are P2's (CS R-01, header note).

### 6.1 Prisma changes

```prisma
/// M12. Who can join (D12-8: invite-only tournaments are unlisted, not secret).
enum TournamentVisibility {
  PUBLIC
  INVITE
}

/// M12. Position lifecycle for the admin console (P12 owns it, CS R-02). Archive = "Delete" in the admin UI.
enum PositionStatus {
  DRAFT
  PUBLISHED
  ARCHIVED
}

model Tournament {
  // …existing columns (schema.prisma:377-397 today)…

  // M12 (Phase 12) arena engine — DM §5.9, plus joinSeq and startDelays
  slug             String?              @unique @db.VarChar(80)   // "sunday-fischer-cup-7q2"; immutable; NOT NULL in contract C12
  inviteCode       String?              @unique @db.VarChar(24)   // 8-char Crockford base32; rotate to revoke every link
  visibility       TournamentVisibility @default(PUBLIC)
  hostUserId       BigInt?                                         // featured host (O12-1); admins can always host
  lobbyOpensAt     DateTime?                                       // startsAt − 60 min (Q29)
  lateJoinUntil    DateTime?                                       // endsAt − 10 min
  participantCount Int                  @default(0)                // incremented in the join transaction with the cap in the WHERE
  /// Per-tournament join counter; the join UPDATE returns it as the participant's joinOrder (D12-13)
  joinSeq          Int                  @default(0)
  standingsVersion Int                  @default(0)                // +1 per scored game; socket deltas carry it
  /// ScoringV1 {"v":1,"win":2,"draw":1,"fire":true,"earlyDrawPly":20}
  scoring          Json                 @default("{\"v\":1,\"win\":2,\"draw\":1,\"fire\":true,\"earlyDrawPly\":20}")
  /// FinalStandingsV1, frozen at finalize (results need no recompute)
  finalStandings   Json?
  finalizedAt      DateTime?
  cancelledReason  String?              @db.VarChar(200)
  /// Number of automatic 10-minute start delays already used (Q29: at most 1)
  startDelays      Int                  @default(0) @db.SmallInt

  host             User?                @relation("TournamentHost", fields: [hostUserId], references: [id], onDelete: SetNull)
  positions        TournamentPosition[]

  @@index([visibility, status, scheduledStartAt])
}

/// M12. Position rotation: one position per time slice of the arena (Q26). DM §5.9 verbatim.
model TournamentPosition {
  tournamentId    BigInt
  order           Int            @db.SmallInt          // 0-based
  chessPositionId BigInt?
  fen             String                               // snapshot: later edits to the position do not change a running arena
  label           String         @db.VarChar(80)       // "Byrne vs Fischer, New York 1956"
  note            String?        @db.VarChar(200)      // lobby blurb ("Black to move after 16.Bc5…")
  tournament      Tournament     @relation(fields: [tournamentId], references: [id], onDelete: Cascade)
  chessPosition   ChessPosition? @relation(fields: [chessPositionId], references: [id], onDelete: SetNull)

  @@id([tournamentId, order])
  @@map("tournament_positions")
}

model TournamentParticipant {
  // …existing columns (schema.prisma:412-425); `points`, `isSearching`, `searchingSince` stay until the contract steps…
  // displayName VarChar(40)? belongs to P10's M10 block (CS R-02/R-19); M12 adds it with IF NOT EXISTS only if P10 has not merged (§6.2)

  // M12 arena fields — DM §5.9, plus joinOrder
  score          Int       @default(0) @db.SmallInt     // arena points (legacy rows: points × 2)
  streak         Int       @default(0) @db.SmallInt     // consecutive wins
  fire           Boolean   @default(false)              // streak >= 2: the next result is doubled
  ratingAtJoin   Int?      @db.SmallInt                 // seed snapshot
  whiteCount     Int       @default(0) @db.SmallInt
  blackCount     Int       @default(0) @db.SmallInt
  lastOpponentId BigInt?                                // plain column, no FK (history)
  withdrawnAt    DateTime?
  finalRank      Int?      @db.SmallInt
  /// 1-based, unique per tournament, = commit order of the join (D12-13). NOT NULL in contract C12 after B7
  joinOrder      Int?      @db.SmallInt

  @@index([tournamentId, score(sort: Desc), gamesPlayed, joinOrder], map: "tournament_participants_rank_idx")
}

model Game {
  // …P2's M2 columns…
  /// M12: slot of the tournament position this game was paired on (TournamentPosition.order)
  tournamentPositionOrder Int? @db.SmallInt
}

model GamePlayer {
  // …P2's M2 columns (game_players."tournamentId" already exists)…
  /// M12: arena points this side earned in this game; NULL = not scored (aborted, cancelled, after finalize)
  tournamentPoints Int?    @db.SmallInt
  /// M12: this side played the game on fire (its points were doubled)
  tournamentFire   Boolean @default(false)
}

model ChessPosition {
  // …existing + P8's M8 columns…
  status              PositionStatus       @default(PUBLISHED)   // archive also sets isActive = false (CS fix 12.4)
  tournamentPositions TournamentPosition[]

  @@index([status])
}

model Legend {
  // …existing + P8's M8 columns…
  /// Where the portrait came from (CF LIC-6). IF NOT EXISTS: P8 may already have added it
  portraitSource  String? @db.VarChar(300)
  /// public_domain | cc_by | cc_by_sa | own | permission
  portraitLicence String? @db.VarChar(20)
}

model User {
  // …
  hostedTournaments Tournament[] @relation("TournamentHost")
}
```

**Conditional parts** (checked by the WP-A owner at branch time with `grep -l` over `DB/prisma/migrations/*/migration.sql`; whatever is already present is dropped from M12):

1. **`tournament_participants."displayName"`** (P10, M10). P10 and P12 run in parallel, so the first to merge creates it and the other uses `ADD COLUMN IF NOT EXISTS` (CS R-19).
2. **`legends."portraitSource"`, `"portraitLicence"`** if P8 already added them under CF LIC-6.
3. **`AuditCategory` values.** DM §5.1's enum already has `TOURNAMENT`, `CONTENT` and `MODERATION`. If P4's M4 shipped a shorter list, the missing values go in their own file `…_m12a_audit_categories` (`ALTER TYPE "AuditCategory" ADD VALUE IF NOT EXISTS …`, DM §2.4) and are written only after the deploy that ships the new client (CF §9 two-release rule).

Already present from earlier phases and only read here: `AuditLog` (M4), `GameMode.TOURNAMENT` and `game_players."tournamentId"` (M2), `PlayerRating` (M9), `Notification`, `UserMilestone`, `UserBlock` (M10, optional), `reports` (M5), `jobs` (M3).

### 6.2 Hand-written SQL in the same migration

```sql
SET lock_timeout = '5s';

-- Partial indexes Prisma cannot model (DM §5.9); both go into DB/prisma/protected-indexes.txt
CREATE INDEX IF NOT EXISTS games_tournament_live_idx
  ON games ("tournamentId") WHERE status = 'IN_PROGRESS';
CREATE INDEX IF NOT EXISTS game_players_tournament_idx
  ON game_players ("tournamentId", "userId") WHERE "tournamentId" IS NOT NULL;

-- Finished tab keyset: ORDER BY "completedAt" DESC, id DESC
CREATE INDEX IF NOT EXISTS tournaments_finished_idx
  ON tournaments ("completedAt" DESC, id DESC) WHERE status = 'COMPLETED';

-- Shared with P10 / P8 (first to merge creates; CS R-19)
ALTER TABLE tournament_participants ADD COLUMN IF NOT EXISTS "displayName" VARCHAR(40);
ALTER TABLE legends ADD COLUMN IF NOT EXISTS "portraitSource" VARCHAR(300);
ALTER TABLE legends ADD COLUMN IF NOT EXISTS "portraitLicence" VARCHAR(20);

-- The host FK is added NOT VALID here and validated in m12v (DM §11.1 rule 3)
ALTER TABLE tournaments ADD CONSTRAINT "tournaments_hostUserId_fkey"
  FOREIGN KEY ("hostUserId") REFERENCES users(id) ON DELETE SET NULL NOT VALID;
```

The three index names go into `DB/prisma/protected-indexes.txt` (DM §11.3), so `scripts/db/check-drift.ts` (P2) fails CI if a later generated migration drops them.

### 6.3 Database role grants (`DB/sql/roles.sql`, P2's file)

The scoring clause runs as the socket's `replay_realtime` role (P2 §6.7: `SELECT (id, "referenceId", name) ON tournaments` today). P12 extends it, and nothing else:

```sql
GRANT SELECT (id, "referenceId", slug, name, status, visibility, "scheduledStartAt", "lobbyOpensAt", "startedAt",
              "endsAt", "lateJoinUntil", "durationMinutes", "initialTimeSeconds", "incrementSeconds",
              "participantCount", "standingsVersion", scoring, "finalizedAt") ON tournaments TO replay_realtime;
GRANT UPDATE ("standingsVersion", "updatedAt") ON tournaments TO replay_realtime;   -- the scoring clause only (D12-4)
-- tournament_participants: SELECT, UPDATE already granted by P2; game_players: SELECT, INSERT, UPDATE already granted
GRANT SELECT (username) ON users TO replay_realtime;                                 -- only once P10's column exists
```

The socket never inserts into `tournaments`, `tournament_participants` or `tournament_positions`, so it gets no INSERT on them. The web runtime role `replay_app` already has DML on every table (P1).

### 6.4 Indexes and the queries they serve

| Index | Query (exact shape) | Served by | Expected plan |
|---|---|---|---|
| `tournaments_slug_key` | `WHERE slug = $1` | TOU-2, TOU-4, TOU-6, TOU-7, TOU-11, INT-10/11, every page | Index Scan, 1 row |
| `tournaments_inviteCode_key` | `WHERE "inviteCode" = $1` | TOU-12, join with a code, `/join-tournament/:code` | Index Scan |
| `tournaments_visibility_status_scheduledStartAt_idx` | `WHERE visibility = 'PUBLIC' AND status = ANY($s) ORDER BY "scheduledStartAt" ASC, id ASC LIMIT 21` | TOU-1 live and upcoming tabs; the page-1 counts `count(*) FILTER (…)` | Index Scan (a seq scan below ~1k rows is equally fine) |
| `tournaments_finished_idx` (raw, partial) | `WHERE status = 'COMPLETED' AND visibility = 'PUBLIC' AND ("completedAt", id) < ($c, $id) ORDER BY "completedAt" DESC, id DESC LIMIT 21` | TOU-1 finished tab | Index Scan + filter |
| `tournament_participants_rank_idx` | `SELECT … FROM tournament_participants WHERE "tournamentId" = $t AND "withdrawnAt" IS NULL ORDER BY score DESC, "gamesPlayed" ASC, "joinOrder" ASC LIMIT 51` and the window `ROW_NUMBER() OVER (ORDER BY score DESC, "gamesPlayed", "joinOrder")` | TOU-6, TOU-7 rank, snapshot hint, finalize | Index Scan, ≤ 256 rows, < 1 ms |
| `tournament_participants_tournamentId_userId_key` (existing) | `WHERE "tournamentId" = $t AND "userId" = $u` / `= ANY($ids) … FOR UPDATE`; `ON CONFLICT DO NOTHING` | join, leave, `me`, scoring clause, INT-10 | Index Scan |
| `tournament_participants_userId_idx` (existing) | `WHERE "userId" = $u AND "tournamentId" = ANY(…)` | TOU-13 `mine` | Index Scan |
| `tournament_positions_pkey (tournamentId, order)` | `WHERE "tournamentId" = $t ORDER BY "order"` | snapshot, INT-9, pairing slot | Index Scan |
| `games_tournament_live_idx` (raw) | `WHERE "tournamentId" = $t AND status = 'IN_PROGRESS'` (+ `"whitePlayerId" = ANY($ids) OR "blackPlayerId" = ANY($ids)`) | snapshot `liveGames` + top-board hint, TOU-7 `in_game`, INT-10 double-booking check | Index Scan over the live set (≤ 128 rows) |
| `game_players_tournament_idx` (raw) | `WHERE "tournamentId" = $t AND "userId" = $u ORDER BY "endedAt"` | TOU-11m "Your games", P3 archive `?tournament=` | Index Scan |
| `audit_logs_category_at_idx` (M4) | `WHERE category = ANY($1) AND (at, id) < ($c, $i) ORDER BY at DESC, id DESC LIMIT 21` | ADM-2 | Index Scan |
| `chess_positions_status_idx` | `count(*) FILTER (WHERE status = 'DRAFT')`; admin list `WHERE status = $s` | ADM-1, ADM-3a | Index / bitmap |
| (none, by design) | admin position search `title ILIKE $q OR "whitePlayerName" ILIKE $q …` over 3,641 rows | ADM-3a `q` | Seq Scan ≈ 2–3 ms (DM §8: no trigram index below 50k rows) |
| (none, by design) | admin metrics counts over `users`, `games` | ADM-1 (cached 60 s) | Seq Scan, few ms (DM §8: no `createdAt` indexes) |

`tournament_participants_searching_idx` (ALLOC, ADB §13.2) and `tournaments_status_created_idx` (OPT §3.5) are **not** created: nothing queries `isSearching` after D12-5, and no list orders by `createdAt`.

### 6.5 Migration files, order and safety

| Order | Folder | Content | Notes |
|---|---|---|---|
| 1 (only if needed) | `DB/prisma/migrations/2026MMDD000000_m12a_audit_categories/` | `ALTER TYPE "AuditCategory" ADD VALUE IF NOT EXISTS …` | own file (DM §2.4); only if P4's enum lacks a value |
| 2 | `…_m12_tournaments_admin/` | the two new enums; `tournaments` columns + `NOT VALID` host FK; `tournament_positions`; `tournament_participants` columns + rank index; `games."tournamentPositionOrder"`; `game_players."tournamentPoints"`, `"tournamentFire"`; `chess_positions.status` + index; `legends` portrait columns; raw SQL §6.2 | starts with `SET lock_timeout = '5s';` |
| 3 | `…_m12v_validate_tournament_host_fk/` | `ALTER TABLE tournaments VALIDATE CONSTRAINT "tournaments_hostUserId_fkey";` | own file (DM §11.1 rule 3) |
| — | `DB/sql/roles.sql` | §6.3 grants | applied by the owner role on the dev branch after `migrate deploy` (P2 §6.7 procedure) |

Procedure (DM §11.2, ALLOC §1.3, CS R-20; **never `prisma migrate dev` and never `prisma db push` against any Neon branch**, CLAUDE.md):

1. Edit the schema; generate with `prisma migrate diff --from-migrations DB/prisma/migrations --to-schema-datamodel DB/prisma/schema.prisma --shadow-database-url postgresql://postgres:pw@localhost:55433/postgres --script` against a **local Docker Postgres 17**.
2. Hand-add §6.2, `SET lock_timeout`, and `NOT VALID` on the new FK. Review that there is **no `DROP`** anywhere.
3. Drift gate in CI (`scripts/db/check-drift.ts`) with the protected-index list.
4. Local: `migrate deploy` from scratch + seed + `check-types` + e2e.
5. The Neon **dev** branch named in CLAUDE.md: `prisma migrate deploy` (DIRECT_URL, owner role), then `roles.sql`. Production gets M12 only through `migrate deploy` after the child-branch rehearsal (P13, or §14.5 if P12 ships after launch).

Safety notes:

- Every new `NOT NULL` column has a constant default (`participantCount 0`, `joinSeq 0`, `standingsVersion 0`, `scoring {...}`, `visibility PUBLIC`, `startDelays 0`, `status PUBLISHED`, `tournamentFire false`, the participant counters), so the metadata-only `ADD COLUMN` is instant and old code keeps inserting (DM §11.1 rule 7).
- `slug`, `inviteCode` and `joinOrder` are nullable until the backfill fills them; readers fall back to `referenceId` for rows without a slug for one release (§6.6). Contract C12 makes them NOT NULL later.
- **Enum two-release rule** (CF §9): both enums are new types, so no `ADD VALUE` on an existing type is involved. `INVITE`, `DRAFT` and `ARCHIVED` are written only through ADM-8 and ADM-3/4, which are behind `admin-v3`; the flag is turned on only after the web deploy that ships the new Prisma client, and the socket never reads either enum (it gets strings from the internal routes). That is the "release N adds, release N+1 writes" order.
- Zero-downtime order (DM §11.5): migrate → `roles.sql` → deploy web (readers tolerate missing slugs) → run B7 → deploy the socket server → turn on `tournaments-v3` and `admin-v3` for the owner and the E2E users.

### 6.6 Backfill B7 (`WEB/scripts/backfill/tournaments.ts`)

Idempotent TypeScript, `--dry-run` by default, `--apply` to write, batches of 500 by id, refuses to run unless the `DATABASE_URL` host is in `BACKFILL_ALLOWED_HOSTS`, writes one `audit_logs` row (`SYSTEM`, `backfill.tournaments`, counts in `meta`). Predicate: `slug IS NULL`.

| Step | SQL / logic |
|---|---|
| `slug` | `slugify(name)` (lowercase, ASCII, `-`, ≤ 72) + `-` + 3 Crockford chars from a `referenceId` hash; on a unique violation, retry with a new suffix |
| `inviteCode` | 8 random Crockford chars (`crypto.randomInt`), retried on P2002 |
| `visibility` | `PUBLIC` (all legacy tournaments were public) |
| `participantCount`, `joinSeq` | `UPDATE tournaments t SET "participantCount" = c.n, "joinSeq" = c.n FROM (SELECT "tournamentId", count(*) n FROM tournament_participants GROUP BY 1) c WHERE c."tournamentId" = t.id` |
| `joinOrder` | `UPDATE tournament_participants p SET "joinOrder" = r.n FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY "tournamentId" ORDER BY "joinedAt", id) n FROM tournament_participants) r WHERE r.id = p.id AND p."joinOrder" IS NULL` |
| `score` | `UPDATE tournament_participants SET score = round(points * 2)` (win 1 → 2, draw 0.5 → 1 maps exactly) |
| `displayName` | from `users.name` (only if the column exists and is NULL) |
| `TournamentPosition(order 0)` | from the legacy `chessPositionId` (FEN + "White vs Black"), else `openingId` (opening FEN + name), else `legendId` (one published position of that legend), else the start position "Standard start" |
| `lobbyOpensAt`, `lateJoinUntil` | for LOBBY / ACTIVE rows: `scheduledStartAt − 60 min`; `coalesce(endsAt, scheduledStartAt + duration) − 10 min` |
| `finalStandings`, `finalRank`, `finalizedAt` | for COMPLETED rows: freeze the ranks by the D12-13 order; `finalizedAt = completedAt` |
| `game_players."tournamentPoints"` | for legacy tournament games (P2's backfill already created the `GamePlayer` rows): win 2, draw 1, loss 0; `tournamentFire = false`; aborted games stay NULL |
| stale LOBBY/ACTIVE legacy rows whose time has passed | mark `COMPLETED` (if they had games) or `CANCELLED` (`cancelledReason = 'legacy_expired'`) — **a data change: the owner confirms the counts from the dry run first** (CLAUDE.md rule 5) |

Verification queries: zero rows with `slug IS NULL` or `"joinOrder" IS NULL`; `joinOrder` unique per tournament; for every COMPLETED tournament the rank order by `score` equals the old order by `points` (with the new tie-break); `participantCount = count(*)` everywhere.

### 6.7 Contract steps (later; each needs the owner's confirmation and a fresh dump)

| Step | When | Content |
|---|---|---|
| C12 (added to ALLOC §5.1, CS fix 12.15) | P13 + 1 release | `tournaments.slug SET NOT NULL`; `tournament_participants."joinOrder" SET NOT NULL`; drop `tournament_participants."isSearching"`, `"searchingSince"` |
| C1 (existing) | DM §5.11 | drops `tournament_participants_tournamentId_points_idx` and `tournaments_referenceId_idx` |
| C7 (existing) | DM §5.11 | drops `tournament_participants.points` (the scoring clause stops writing it in the same PR) |

### 6.8 JSON column registry additions (`DB/src/json/tournament.ts`)

| Column | zod schema | Max | Writer | Reader |
|---|---|---|---|---|
| `tournaments.scoring` | `ScoringV1 { v: 1, win: 2, draw: 1, fire: boolean, earlyDrawPly: 0..40 }` | 100 B | ADM-8b create (defaults only; not editable in the UI) | the scoring clause (§8.1), `DOM/tournaments/scoring.ts` |
| `tournaments.finalStandings` | `FinalStandingsV1 { v: 1, frozenAt, rows: [{ rank, userRef \| null, username \| null, displayName, initials, rating \| null, games, score, w, d, l, fire }] ≤ 256 }` | 40 KB | INT-11b finalize | TOU-11 |
| `games.meta` (P2's `GameMetaV1`) | + `clientPairId?: string(≤ 40)` | — | INT-10 | support / debugging |
| `audit_logs.meta` | per action, e.g. `tournament.started { players }`, `admin.position_updated { fields: string[] }` — never an email or a token | 2 KB | §10.3 | ADM-2 formatter |

### 6.9 Dev seed

`DB/prisma/seed/tournaments.ts`, called by `DB/prisma/seed/index.ts` after `personas.ts` (DM §13.3; refuses unless `SEED_TARGET=dev`). Idempotent by `slug` (upsert). Times are relative to `now()` at seed time so the states are live when the seed runs. It adds 30 synthetic players (`seed+<name>@seed.replaychess.local`, names from the boards' PL array: vera_b, hypermodern_g, martin_k, lucena_now, opposite_sq, tal_fan_77, e4_enjoyer, bishop_pair_bob, pawnstorm22, knightrider, gm_wannabe …) and makes the `admin` persona `role = ADMIN`. `joinOrder` follows the boards' list order.

| Slug | State | Data | Board states it reaches |
|---|---|---|---|
| `friday-opera-arena-<sfx>` | ACTIVE, started 41 min ago, ends in 19 min, 24 players, 5+3, 1 position (Opera Game) | scores, streaks and fire as in the boards (vera_b 19 pts on fire); 9 IN_PROGRESS games between synthetic players (static checkpoints); the `member` persona at 3rd with 14 pts and 6 games | live arena `idle`, `not_participant` (for other personas), list LIVE |
| `sunday-fischer-cup-<sfx>` | LOBBY, starts in 45 min, 18/32, 5 Fischer positions, host `vera_b` | the `member` persona not joined; `trial` persona joined | lobby `joined`, `not_joined`, `host` (as vera_b), join `default`, list LOBBY |
| `tal-attack-night-<sfx>` | LOBBY (upcoming), starts in 26 h, 9/48, 3+2 | — | list UPCOMING, join `default` |
| `endgame-evening-bh3-<sfx>` | LOBBY, starts in 8 min, 4/24, 10+0 | — | join `starting_soon` |
| `invite-only-duel-<sfx>` | LOBBY, INVITE, cap 2, 2/2 joined | — | join `full`; unlisted behaviour |
| `late-entry-closed-<sfx>` | ACTIVE, `lateJoinUntil` 5 min ago | — | join `closed`, arena registration closed copy |
| `october-kasparov-open-<sfx>` | COMPLETED 8 days ago, 31 players | `finalStandings`; the `member` persona 3rd with 14 pts, 4W 1D 1L; 6 `game_players` rows with `tournamentPoints` and headlines from the board ("Found Rxd4 like Kasparov", "Won the queen on move 31", …) | results `default` |
| `morphy-blitz-12-<sfx>` | COMPLETED 15 days ago, 22 players; the `member` persona joined but played 0 games | — | results `no_games`, list FINISHED |
| `cancelled-arena-<sfx>` | CANCELLED (`not_enough_players`) | — | cancelled redirect + toast |

Plus for admin: 12 DRAFT positions, 3 legends without `profilePhotoUrl`, 20 `audit_logs` rows across the six kinds (the dashboard example rows), 3 OPEN reports (if the table exists). Seed caps follow `TOURNAMENT_MAX_PLAYERS` on dev (256 on the perf branch only). E2E users stay untouched (DM §13.6); E2E creates its own tournaments through the admin API as `E2E_ADMIN_EMAIL`.

---

## 7. API

Every route uses P1's wrapper (`WEB/lib/api/route.ts`, API §2.5) with its spec registered in the P1 registry directory (`CT/http/registry/tournaments.ts` and `CT/http/registry/admin.ts`, CF §7), so OpenAPI, the authz matrix and the contract tests pick it up. Route files stay thin: zod spec + one call into `DOM/tournaments/*`, `WEB/lib/data/*` or `WEB/lib/services/admin/*`. Envelope `{ data, meta? }` / `{ error: { code, message, fields?, details?, retryAfterSec?, requestId } }` (P1 §7.1). Ids on the wire are refs, slugs and codes only. Enums on the wire are lowercase snake.

**Auth legend** (API §4.0): `P` public, the response never depends on the viewer · `U` signed in · `M` member (402 otherwise) · `H` host or admin · `A` admin · `I` internal (`verifyInternal()`, D12-15).
**Cache tiers** (OPT §4.2 names, D12-17): `public-static` (long CDN TTL + tags, purged on change) · `public-short` (CDN `s-maxage` 5–30 s + `stale-while-revalidate`) · `private-etag` · `no-store`. A route with `auth` other than `P` may use only `private-etag` or `no-store` (the CA §5 registry lint).
**Maintenance area** (P11 D10): routes that start or join play declare `area: "online"` (TOU-4a, TOU-9a, INT-10); everything else is `"all"`. Internal and admin read routes are exempt as P11 lists.
**Rate limits** are `limit / windowSec` on P1's fixed-window limiter (CS R-13); windows above 300 s use `store: "durable"` (CA AP-11).
**Every route** exports `maxDuration = 10` unless stated.

### 7.1 Error codes and reasons (additive changes to `CT/http/codes.ts`, CS R-06)

| Item | Change | Owner |
|---|---|---|
| `ERROR_STATUS` | + `precondition_failed: 412` | P12 (first producer) |
| `ERROR_STATUS` | + `reverification_required: 403` | P10 or P12, whichever merges first (CS R-19) |
| `ERROR_STATUS` | `illegal_position: 422` | already added by P2 |
| `codes.test.ts` | the allowed status set gains 412 (P2 already added 422) | P12 |
| `CONFLICT_REASONS` | + `tournament_full`, `registration_closed`, `already_joined`, `not_enough_players`, `already_ended`, `not_finished`, `fen_taken`, `slug_taken`, `name_taken`, `already_resolved`. Reused: `already_started` (P2), `last_admin` (P10) | P12 |
| `FORBIDDEN_REASONS` | + `invite_required`, `not_host`, `not_participant`, `self` | P12 |
| 402 | always `subscription_required` with `details.reason ∈ SUBSCRIPTION_REASONS` (`trial_available`, `trial_used`, `expired`, `payment_failed`); `membership_ended` is never a code or a reason (CS fix 12.12) | — |
| Socket ack codes (`CT/socket/codes.ts`, P2) | + `phase` (the tournament is not live), `not_participant`, `maintenance`. Reused: `not_found`, `not_member` (with `reason`), `already_in_game` (+ `gameRef`), `rate_limited` (+ `retryAfterMs`). `already_queued` is **not** used (D12-16) | P12 |

### 7.2 Tournament routes

| ID | Method · path | Auth | Request → `data` | Errors (beyond the implied ones) | Cache | RL | Idempotency |
|---|---|---|---|---|---|---|---|
| TOU-1 | `GET /api/tournaments?tab=live\|upcoming\|finished&cursor&limit≤20` | P | → `{ counts?: { live, upcoming, finished }, items: TournamentCard[] }` (`counts` on page 1 only, CA AP-38), `meta.nextCursor` | — | `public-short`: `s-maxage=15, stale-while-revalidate=60`, tag `tournaments:list` | edge | GET |
| TOU-2 | `GET /api/tournaments/{slug}` | P | → `TournamentSnapshot` | `not_found` (unknown, or cancelled for more than 24 h) | `public-short` `s-maxage=5, swr=30`, tag `tournament:<slug>` | edge | GET |
| TOU-3 | `GET /api/tournaments/{slug}/participants?q&cursor&limit≤50` | P | → `Paged<ParticipantRow>` ordered by seed; `q` (2–32 chars) matches `displayName`/`username` with `%`/`_` escaped (AA F-24) | `not_found` | `public-short` `s-maxage=10` | `search` (P1) when `q` is set | GET |
| TOU-4a | `POST /api/tournaments/{slug}/participants` | M | `JoinBody { inviteCode?: Code }` → 201 `JoinData { me: MyTournamentState, lobbyUrl }`; 200 with the same body when already joined | `conflict` (`tournament_full`, `registration_closed`), `forbidden` (`invite_required`), `not_found`; 503 `maintenance` (`area: "online"`) | `no-store` | `tournament-join` 10 / 60 s per user (burst) | natural: unique `(tournamentId, userId)` |
| TOU-4b | `DELETE /api/tournaments/{slug}/participants/me` | U | → 204 | `conflict` (`already_started`) | `no-store` | `tournament-join` | natural (deleting twice is 204) |
| TOU-6 | `GET /api/tournaments/{slug}/standings?after=<rank>&limit≤50&minVersion` | P | → `{ version, total, rows: StandingRow[] }`, `meta.nextCursor` (= last rank) | `not_found` | `public-short` `s-maxage=5`, tag `tournament:<slug>:standings`. `minVersion` is part of the URL: a value above the Data Cache's version bypasses it, and every client asking for the same version shares one CDN entry | edge | GET |
| TOU-7 | `GET /api/tournaments/{slug}/me` | U | → `MyTournamentState` | `not_found` | `no-store` | — | GET |
| TOU-9a | `POST /api/tournaments/{slug}/start` | H | `{}` → `{ phase: "live", startedAt, endsAt, lateJoinUntil }` | `conflict` (`already_started`, `not_enough_players`), `forbidden` (`not_host`); 503 `maintenance` | `no-store` | — | conditional update (a second call → 409) |
| TOU-9b | `POST /api/tournaments/{slug}/end` | H | `{}` → `{ endsAt }` (pairing stops now; running games finish and count) | `conflict` (`already_ended`) | `no-store` | — | conditional update |
| TOU-11 | `GET /api/tournaments/{slug}/results` | P | → `ResultsData` (frozen) | `not_found`, `conflict` (`not_finished`) | `public-static`: `s-maxage=86400, swr=604800`, tag `tournament:<slug>` (purged at finalize and by admin edits) | edge | GET |
| TOU-11m | `GET /api/tournaments/{slug}/results/me` | U | → `MyResults` | `not_found` | `no-store` | — | GET |
| TOU-12 | `GET /api/tournament-invites/{code}?i=<tag>` | P | → `InviteData` | `not_found` | `public-short` `s-maxage=30` (the URL includes `i`) | edge | GET |
| TOU-13 | `GET /api/me/tournaments?status=lobby,active,completed&limit≤50` | U | → `{ items: MyTournamentItem[] }` | — | `no-store` | — | GET |

Not built (D12-5, D12-11): TOU-5 (invites, folded into `MyTournamentState.inviteUrl`), TOU-8 (top board, folded into the watch ack and `topBoardHint`), TOU-10 (HTTP find-match), `/api/games/{ref}/tournament-result` (folded into P2's game snapshot).

**DTOs (`CT/http/tournaments.ts`).**

```ts
import { z } from "zod";
import { Ref, Slug, Code, Username, Color, IsoDate, Cursor, Limit } from "./common";

export const TournamentPhase = z.enum(["upcoming", "lobby", "live", "finishing", "finished", "cancelled"]);
export const AdminPhase = z.enum(["scheduled", "lobby", "live", "completed", "cancelled"]);
export const ClockSpec = z.strictObject({
  initialSeconds: z.number().int(), incrementSeconds: z.number().int(),
  label: z.string().max(16),                                 // "Blitz 5+3"
  pool: z.enum(["bullet", "blitz", "rapid", "classical"]),
});
export const PersonLite = z.strictObject({
  ref: Ref.nullable(),                                       // null for a deleted account
  username: Username.nullable(),                             // null until P10 ships usernames
  displayName: z.string().max(40), initials: z.string().max(3),
  avatarUrl: z.string().url().nullable(), rating: z.number().int().nullable(),
});
export const PositionView = z.strictObject({
  order: z.number().int().min(0).max(9), label: z.string().max(80),
  fen: z.string().max(100), sideToMove: Color, note: z.string().max(200).nullable(),
});
export const TournamentCard = z.strictObject({
  ref: Ref, slug: Slug, name: z.string().max(100), description: z.string().max(280),
  clock: ClockSpec, durationMinutes: z.number().int(),
  source: PositionView,                                      // order 0 (list, aside, join)
  positionsCount: z.number().int().min(1).max(10),
  players: z.number().int(), cap: z.number().int().nullable(), liveGames: z.number().int(),
  phase: TournamentPhase,                                    // as of the response; the client re-derives it (§8.4)
  startsAt: IsoDate, lobbyOpensAt: IsoDate, endsAt: IsoDate.nullable(),
  lateJoinUntil: IsoDate.nullable(), finishedAt: IsoDate.nullable(),
  scoring: z.strictObject({ win: z.literal(2), draw: z.literal(1), fire: z.boolean() }),
  topAvatars: z.array(PersonLite).max(5),
  visibility: z.enum(["public", "invite"]),
  // no viewer-dependent fields and no formatted labels: the same bytes for every viewer (CA AP-03)
});
export const ListTournamentsQuery = z.object({ tab: z.enum(["live", "upcoming", "finished"]), cursor: Cursor, limit: Limit(20, 20) });
export const ListTournamentsData = z.strictObject({
  counts: z.strictObject({ live: z.number().int(), upcoming: z.number().int(), finished: z.number().int() }).optional(),
  items: z.array(TournamentCard),
});

export const TopBoardView = z.strictObject({
  gameRef: Ref, moveNo: z.number().int(), fen: z.string().max(100),
  lastMove: z.tuple([z.string().length(2), z.string().length(2)]).nullable(),
  clocks: z.strictObject({ w: z.number().int(), b: z.number().int(), run: Color.nullable(), at: z.number().int() }).nullable(), // P2 Clocks
  white: PersonLite.extend({ rank: z.number().int().nullable(), score: z.number().int(), fire: z.boolean() }),
  black: PersonLite.extend({ rank: z.number().int().nullable(), score: z.number().int(), fire: z.boolean() }),
  gamesPlayed: z.strictObject({ w: z.number().int(), b: z.number().int() }),
});
export const TournamentSnapshot = z.strictObject({
  tournament: TournamentCard.extend({
    host: PersonLite.nullable(), positions: z.array(PositionView).min(1).max(10),
    startedAt: IsoDate.nullable(), cancelledReason: z.string().max(200).nullable(),
  }),
  standingsVersion: z.number().int(),
  topBoardHint: TopBoardView.nullable(),                     // from the last checkpoint; the socket replaces it live
  serverNow: z.number().int(),                               // epoch ms, for the countdown offset
});

export const StandingRow = z.strictObject({
  rank: z.number().int(), prevRank: z.number().int().nullable(),   // server-computed (D12-13)
  player: PersonLite, games: z.number().int(), score: z.number().int(),
  w: z.number().int(), d: z.number().int(), l: z.number().int(),
  streak: z.number().int(), fire: z.boolean(),
});
export const StandingsData = z.strictObject({ version: z.number().int(), total: z.number().int(), rows: z.array(StandingRow) });

export const ParticipantRow = z.strictObject({
  player: PersonLite, seed: z.number().int(), joinedAt: IsoDate,
  tags: z.array(z.enum(["host", "you"])),
});

export const MyTournamentState = z.strictObject({
  participant: z.boolean(), isHost: z.boolean(), canLeave: z.boolean(),
  seed: z.number().int().nullable(), of: z.number().int(),
  row: StandingRow.nullable(),                               // live: rank, score, streak, fire
  state: z.enum(["not_participant", "idle", "in_game"]),     // "searching" is socket-only (watch ack)
  currentGameRef: Ref.nullable(),
  inviteUrl: z.string().url().nullable(),                    // participants and admins: NEXT_PUBLIC_SITE_URL/join-tournament/<code>?i=<tag>
  entitled: z.boolean(),
});
export const JoinBody = z.strictObject({ inviteCode: Code.optional() });
export const JoinData = z.strictObject({ me: MyTournamentState, lobbyUrl: z.string() });

export const InviteData = z.strictObject({
  tournament: TournamentCard, format: z.literal("arena"),
  inviter: PersonLite.nullable(),
  joinState: z.enum(["open", "starting_soon", "late_entry", "closed", "full", "cancelled"]),
  serverNow: z.number().int(),
});

export const ResultsData = z.strictObject({
  tournament: z.strictObject({ slug: Slug, name: z.string(), finishedAt: IsoDate, clock: ClockSpec, players: z.number().int() }),
  podium: z.array(StandingRow).max(3),
  standings: z.array(StandingRow).max(256),                  // frozen; prevRank = null, fire as at the end
});
export const MyResults = z.strictObject({
  played: z.boolean(), rank: z.number().int().nullable(), of: z.number().int(),
  score: z.number().int(), games: z.number().int(), w: z.number().int(), d: z.number().int(), l: z.number().int(),
  ratingDelta: z.number().int().nullable(),                  // Σ game_players."ratingDelta" (P9)
  bestGame: z.strictObject({ gameRef: Ref, headline: z.string().max(80), opponent: PersonLite }).nullable(),
  coachMoments: z.number().int().nullable(), pendingAnalyses: z.number().int(),
  rows: z.array(z.strictObject({
    gameRef: Ref, result: z.enum(["win", "loss", "draw"]), opponent: PersonLite,
    note: z.string().max(80).nullable(), points: z.number().int(), fire: z.boolean(), playedAt: IsoDate,  // wire name kept (CS R-01)
  })),
});
export const MyTournamentItem = z.strictObject({
  slug: Slug, phase: TournamentPhase, rank: z.number().int().nullable(), score: z.number().int(),
  card: TournamentCard.nullable(),                           // only for invite-only tournaments (unlisted, D12-8)
});
```

**Handler notes (each route's SQL budget is in §9.2).**

- TOU-1: on page 1, one `count(*) FILTER (WHERE …)` statement over the derived phases (`status`, `scheduledStartAt`, `endsAt` against `now()`); then one keyset page (`liveGames` from a correlated `count(*)` on `games_tournament_live_idx`, `topAvatars` from a `LATERAL` top-5 by rank). Invite-only and cancelled tournaments are excluded. Ordering: live and upcoming by `scheduledStartAt ASC, id ASC`; finished by `completedAt DESC, id DESC`.
- TOU-2: one round trip with `relationLoadStrategy: "join"` (tournament + positions + host), plus the `topBoardHint` read:

  ```sql
  WITH r AS (SELECT "userId", ROW_NUMBER() OVER (ORDER BY score DESC, "gamesPlayed", "joinOrder") AS rank
               FROM tournament_participants WHERE "tournamentId" = $t AND "withdrawnAt" IS NULL)
  SELECT g."referenceId", g.fen, right(g.moves, 9) AS tail, g."plyCount", g."whiteTimeMs", g."blackTimeMs",
         g."clockRunning", g."lastMoveAt", g."whitePlayerId", g."blackPlayerId", least(rw.rank, rb.rank) AS best
    FROM games g LEFT JOIN r rw ON rw."userId" = g."whitePlayerId" LEFT JOIN r rb ON rb."userId" = g."blackPlayerId"
   WHERE g."tournamentId" = $t AND g.status = 'IN_PROGRESS'                       -- games_tournament_live_idx
   ORDER BY best NULLS LAST, g."startedAt" LIMIT 1;
  ```

  The GET **never writes** (AA F-22): expiry is the scheduler's job. The invite code is never in this payload.
- TOU-4a, the join transaction (fixes ADB §8.6 and AA F-24). `auth: "member"` answers 402 `subscription_required` with the P1 reason before anything else. `ratingAtJoin` comes from P9's `getEffectiveRatings(user)[poolFor(clock)]` (`DOM/ratings/getEffectiveRatings.ts`: `PlayerRating` → linked account rating → 1500), read before the transaction.

  ```sql
  BEGIN;
  UPDATE tournaments SET "participantCount" = "participantCount" + 1, "joinSeq" = "joinSeq" + 1, "updatedAt" = now()
   WHERE slug = $slug
     AND (status = 'LOBBY' OR (status = 'ACTIVE' AND now() < "lateJoinUntil"))
     AND ("maxParticipants" IS NULL OR "participantCount" < "maxParticipants")
     AND (visibility = 'PUBLIC' OR "inviteCode" = $code)
  RETURNING id, status, "joinSeq", "scheduledStartAt";
  -- 0 rows → ROLLBACK, then one read decides the error: cancelled/unknown → 404; full → 409 tournament_full;
  --          past lateJoinUntil or finished → 409 registration_closed; invite mismatch → 403 invite_required
  INSERT INTO tournament_participants ("referenceId", "tournamentId", "userId", "ratingAtJoin", "displayName",
                                       "joinOrder", "joinedAt", "updatedAt")
  VALUES ($cuid, $tid, $uid, $rating, $name, $joinSeq, now(), now())
  ON CONFLICT ("tournamentId", "userId") DO NOTHING
  RETURNING id;
  -- no row → already joined: ROLLBACK (undoes both increments) and return 200 with the existing state
  -- P10 present, LOBBY only: the start reminder (§7.8) is inserted here, inside the same transaction
  COMMIT;
  ```

  The tournament row lock serialises joins, so `joinOrder` is unique and equals commit order (D12-13). `after()`: `emit({ v: 1, targets: [{ room: ROOM.tournament(slug) }], event: "tournament:player_joined", data: { slug, player, count, seed, joinOrder } })` (P2's body, CS R-07), `revalidateTag('tournament:<slug>')` only while the phase is `lobby` (the player count is in the snapshot), PostHog `tournament_joined`, and the `NOTIFY_DISPATCH` wake for the reminder (§7.8).
- TOU-4b, leave: `DELETE FROM tournament_participants WHERE "tournamentId" = $t AND "userId" = $u AND EXISTS (SELECT 1 FROM tournaments WHERE id = $t AND status = 'LOBBY')` then `UPDATE tournaments SET "participantCount" = "participantCount" − 1 WHERE id = $t AND "participantCount" > 0` in one transaction, plus the reminder skip (§7.8). `joinSeq` is not decremented. During ACTIVE → 409 `already_started` (the arena has no withdraw; stop searching instead). `after()`: `player_left`.
- TOU-6: `SELECT … , ROW_NUMBER() OVER (ORDER BY score DESC, "gamesPlayed", "joinOrder") AS rank FROM tournament_participants WHERE "tournamentId" = $t AND "withdrawnAt" IS NULL` with `rank > $after LIMIT $limit`, joined to `users` for the display fields (falls back to the `displayName` snapshot when the user is gone). `version` = `tournaments."standingsVersion"` read in the same statement (CTE). `prevRank` is null in snapshots. With `minVersion` above the cached version, the DAL reads Neon directly instead of the Data Cache.
- TOU-7: in `Promise.all`: participant row + rank (one window CTE filtered to the viewer), the live game (`games_tournament_live_idx` with `"whitePlayerId" = $u OR "blackPlayerId" = $u`), host check. `inviteUrl` = `${NEXT_PUBLIC_SITE_URL}/join-tournament/${inviteCode}?i=${inviterTag(viewer.id, tournament.id)}` (§8.8, CS fix 12.13). `entitled` from `getViewer()`.
- TOU-9a: `DOM/tournaments/lifecycle.ts` `startTournament(tx, t, { by })`, shared with INT-11a: `UPDATE tournaments SET status='ACTIVE', "startedAt"=now(), "endsAt"=now() + make_interval(mins => "durationMinutes"), "lateJoinUntil"=now() + make_interval(mins => "durationMinutes" − 10) WHERE slug=$s AND status='LOBBY' AND "participantCount" >= 2 RETURNING …`, plus the reminder skip for a start before `startsAt − 5 min` (§7.8). 0 rows → read the reason. `after()`: WS-7 with the new times (the socket emits `tournament:started` and re-arms its timers), `revalidateTag('tournaments:list', 'tournament:<slug>', 'tournaments:schedule')`, audit `tournament.started { by: host|admin, players, secondsEarly }`.
- TOU-9b: `UPDATE tournaments SET "endsAt" = now(), "lateJoinUntil" = least("lateJoinUntil", now()) WHERE slug = $s AND status = 'ACTIVE' AND "endsAt" > now()`. `after()`: WS-7 (the socket stops pairing, emits `ending_soon {endsAt: now}`, and finalizes when the last game ends), `revalidateTag('tournaments:schedule')`, audit.
- TOU-11: reads `finalStandings` (one PK read). `podium` = rows 1–3.
- TOU-11m: the participant row + `SELECT g."referenceId", gp.result, gp."tournamentPoints", gp."tournamentFire", gp.headline, gp.accuracy, gp."momentsCount", gp."ratingDelta", gp."endedAt", gp."opponentUserId", gp."opponentName", gp."opponentRating" FROM game_players gp JOIN games g ON g.id = gp."gameId" WHERE gp."tournamentId" = $t AND gp."userId" = $u AND gp."tournamentPoints" IS NOT NULL ORDER BY gp."endedAt"` (≤ ~30 rows; `game_players_tournament_idx`). Opponent refs come from one `users` read by `opponentUserId`. Best game: the highest `accuracy` among wins (ties → the latest); `coachMoments` = Σ `momentsCount` when every game is analysed, else null with `pendingAnalyses`. The wire field `playedAt` is `gp."endedAt"`.
- TOU-12: lookup by `inviteCode`; `joinState` from `derivePhase()` + capacity; the inviter from the verified `i` tag (§8.8). Unknown code, cancelled tournament or bad tag → the inviter is null (a bad tag does not 404; a bad code does).
- TOU-13: `tournament_participants_userId_idx` joined to `tournaments` (≤ 50 rows); `card` only for `visibility = 'INVITE'`.

### 7.3 Admin routes

All: `auth: "admin"` (DB role from `getViewer()`; the Clerk `role` claim is only a middleware fast path, ARCH §2), cache `no-store`, `X-Robots-Tag: noindex` (set by the wrapper; route handlers can set headers, unlike RSC pages, CA AP-14), `maxDuration = 10` (uploads 15). Updates require `If-Match: "<version>"` where `version` = `updatedAt` epoch ms (API §2.9) → 412 `precondition_failed` on a stale write. Every write runs `audit()` (P4's `WEB/lib/audit.ts`, §10.3) and purges cache tags in `after()`; catalogue writes go through P8's `revalidateCatalog(tagsFor(entity))` (P8 §8.10: `revalidateTag` for pages and the Data Cache, `invalidateByTag` for CDN JSON, and `catalog-version`). Lists are cursor-paged, `limit ≤ 100` (API API-06), with explicit `select`s (never the `explanation` JSON, ADB DB-14), and return `meta.total` on page 1 only (CA AP-38). ADM-5 and the GET half of ADM-6 are P8's routes, reused unchanged.

| ID | Method · path | Request → `data` | Errors | Tags purged in `after()` | RL |
|---|---|---|---|---|---|
| ADM-1 | `GET /api/admin/metrics` | → `AdminMetrics` | — | — | — |
| ADM-11 | `GET /api/admin/health` | → `AdminHealth` (two OCI calls in parallel, `ADMIN_HEALTH_TIMEOUT_MS` each, memoised 15 s per instance) | — (a timeout yields `status: "unknown"`, never an error) | — | — |
| ADM-2 | `GET /api/admin/activity?category&cursor&limit≤50` | → `Paged<ActivityRow>` | — | — | — |
| ADM-3a | `GET /api/admin/positions?q&status&legend&cursor&limit≤50` | → `Paged<AdminPositionRow>` + `meta.total` on page 1 (cached count, 60 s) | — | — | `search` |
| ADM-3b | `POST /api/admin/positions` | `PositionCreate` → 201 `AdminPositionRow` | `conflict` (`fen_taken`, `details: { ref, title }`), `illegal_position` (422) | `tagsFor(position)` | — |
| ADM-4a | `PATCH /api/admin/positions/{ref}` (`If-Match`) | `PositionPatch` → `AdminPositionRow` | `precondition_failed`, `fen_taken`, `illegal_position`, `not_found` | `tagsFor(position)` for the old and the new legend links | — |
| ADM-4b | `DELETE /api/admin/positions/{ref}` (reverification) | → 204 (`status = ARCHIVED`, `isActive = false`) | `reverification_required` | `tagsFor(position)` | — |
| ADM-5 (P8) | `POST /api/admin/positions/{slug}/verify` | P8's route, unchanged | — | — | — |
| ADM-6a (P8) | `GET /api/admin/legends?cursor&limit≤100` | P8's route; P12 adds `portraitSource`, `portraitLicence`, `version` to its `AdminLegendRow` select | — | — | — |
| ADM-6b | `POST /api/admin/legends` | `LegendCreate` → 201 `AdminLegendRow` | `conflict` (`name_taken`) | `tagsFor(legend)` | — |
| ADM-7 | `PATCH /api/admin/legends/{ref}` (`If-Match`) | `LegendPatch` → `AdminLegendRow` | `precondition_failed`, `name_taken`, `validation_failed` (portrait URL outside the legend's R2 prefix, object missing or too large, licence missing) | `tagsFor(legend)`; `revalidatePath('/legends')`, `('/legends/<slug>')`, `('/sitemap-legends.xml')` | — |
| ADM-9 | `POST /api/admin/uploads` | `UploadRequest` → `UploadTicket` | `validation_failed` (type, size, dimensions) | — | `admin-upload` 20 / 3600 s per admin, `store: "durable"` (CA AP-11) |
| ADM-8a | `GET /api/admin/tournaments?status&cursor&limit≤50` | → `Paged<AdminTournamentRow>` (every visibility and status) | — | — | — |
| ADM-8b | `POST /api/admin/tournaments` (`Idempotency-Key` required) | `TournamentCreate` → 201 `{ slug, ref, url, inviteUrl }` | `validation_failed` (start too soon, positions not published, cap above `TOURNAMENT_MAX_PLAYERS`) | `tournaments:list`, `tournaments:schedule` | — |
| ADM-8c | `GET /api/admin/tournaments/{slug}` | → `AdminTournamentDetail` (form model + `version`) | `not_found` | — | — |
| ADM-8d | `PATCH /api/admin/tournaments/{slug}` (`If-Match`) | `TournamentPatch` → `AdminTournamentDetail` | `conflict` (`already_started`); `validation_failed` (`maxParticipants` below `participantCount`, or above the cap); `precondition_failed` | `tournaments:list`, `tournament:<slug>`, `tournaments:schedule` | — |
| ADM-8e | `POST /api/admin/tournaments/{slug}/cancel` (reverification when `participantCount > 0`) | `{ reason: string ≤ 200 }` → `{ phase: "cancelled" }` | `conflict` (`already_ended`) | same | — |
| ADM-8f | `POST /api/admin/tournaments/{slug}/duplicate` (`Idempotency-Key`) | `{ startsAt }` → 201 `{ slug, ref, url }` | `validation_failed` | `tournaments:list`, `tournaments:schedule` | — |
| ADM-12 | `GET /api/admin/reports?status=open\|actioned\|dismissed&cursor` | → `Paged<ReportRow>` (P5's `reports`) | — | — | — |
| ADM-13 | `POST /api/admin/reports/{ref}/resolve` | `{ action: "dismiss" \| "actioned" }` → `ReportRow` | `conflict` (`already_resolved`) | — | — |
| ADM-14 | `POST /api/admin/users/{ref}/suspend` (reverification) | `{ suspended: boolean, reason: string ≤ 200 }` → `{ ref, suspended }` | `forbidden` (`self`), `conflict` (`last_admin`) | `player:<username>` (P10) | — |
| ADM-10 | `POST /api/scraper/positions/import` | kept (API key or admin); now calls the shared `upsertPosition()` | — | `tagsFor(position)` | — |

**Admin DTOs (`CT/http/admin.ts`, excerpt).**

```ts
export const AdminMetrics = z.strictObject({
  users: z.strictObject({ total: z.number().int(), week: z.number().int() }),
  games: z.strictObject({ total: z.number().int(), today: z.number().int() }),          // platform games (source REPLAY), COMPLETED
  members: z.strictObject({ active: z.number().int(), pastDue: z.number().int() }),
  positions: z.strictObject({ total: z.number().int(), drafts: z.number().int() }),
  legends: z.strictObject({ total: z.number().int(), needPortraits: z.number().int() }),
  tournaments: z.strictObject({ total: z.number().int(), live: z.number().int(), upcoming: z.number().int() }),
  asOf: IsoDate,
});
export const AdminHealth = z.strictObject({
  socket: z.strictObject({ status: z.enum(["healthy", "degraded", "down", "unknown"]), gamesLive: z.number().int().nullable(),
    sockets: z.number().int().nullable(), loopLagP99Ms: z.number().nullable(), outboxOldestMs: z.number().nullable(),
    tournamentsActive: z.number().int().nullable(), checkedAt: IsoDate }),
  analysis: z.strictObject({ status: z.enum(["normal", "busy", "backed_up", "unknown"]), medianWaitSec: z.number().nullable(),
    queued: z.number().int().nullable(), oldestJobAgeSec: z.number().nullable(), checkedAt: IsoDate }),
});
export const ActivityRow = z.strictObject({ at: IsoDate,
  kind: z.enum(["tournament", "billing", "positions", "users", "legends", "system", "moderation"]),
  message: z.string().max(160), href: z.string().nullable() });
export const AdminPositionRow = z.strictObject({ ref: Ref, slug: Slug.nullable(), title: z.string().max(80).nullable(),
  event: z.string().max(80).nullable(),
  legend: z.strictObject({ ref: Ref, slug: Slug.nullable(), name: z.string(), side: Color }).nullable(),   // the heroSide legend
  year: z.number().int().nullable(), status: z.enum(["draft", "published", "archived"]), fen: z.string(), sideToMove: Color,
  blurb: z.string().max(280).nullable(), version: z.number().int() });
export const PositionCreate = z.strictObject({ fen: Fen.optional(),   // API §2.4 `Fen` (server refine = validateFenStrict, §8.10); default: the start position
  title: z.string().trim().max(80).optional(), legendRef: Ref.optional(), heroSide: Color.optional(),
  year: z.number().int().min(1500).max(2100).optional(),
  blurb: z.string().max(280).optional(), status: z.enum(["draft", "published"]).default("draft") });
export const PositionPatch = PositionCreate.partial().extend({ legendRef: Ref.nullable().optional() });
export const PortraitLicence = z.enum(["public_domain", "cc_by", "cc_by_sa", "own", "permission"]);
export const AdminLegendRow = z.strictObject({ ref: Ref, slug: Slug.nullable(), name: z.string().max(80), era: z.string().max(40),
  style: z.string().max(60).nullable(), bio: z.string().max(500), positions: z.number().int(),
  profilePhotoUrl: z.string().url().nullable(), portraitSource: z.string().url().nullable(), portraitLicence: PortraitLicence.nullable(),
  living: z.boolean(), isVisible: z.boolean(), version: z.number().int() });
export const LegendCreate = z.strictObject({ name: z.string().trim().min(2).max(80), era: z.string().trim().min(2).max(40),
  style: z.string().trim().max(60).optional(), bio: z.string().trim().min(1).max(500) });
export const LegendPatch = LegendCreate.partial().extend({
  profilePhotoUrl: z.string().url().nullable().optional(),
  portraitSource: z.string().url().max(300).nullable().optional(), portraitLicence: PortraitLicence.nullable().optional(),
}).refine((p) => p.profilePhotoUrl == null || p.portraitLicence != null, { path: ["portraitLicence"], message: "Pick the portrait's licence." })
  .refine((p) => p.profilePhotoUrl == null || p.portraitLicence === "own" || p.portraitSource != null,
          { path: ["portraitSource"], message: "Add where the portrait came from." });
export const UploadRequest = z.strictObject({ kind: z.literal("legend-portrait"), legendRef: Ref,
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]), bytes: z.number().int().min(1).max(2_000_000),
  width: z.number().int().min(512).max(4096), height: z.number().int().min(512).max(4096) })
  .refine((u) => Math.abs(u.width - u.height) / u.width <= 0.02, { path: ["width"], message: "Use a square image at least 512 px wide." });
export const UploadTicket = z.strictObject({ uploadUrl: z.string().url(), publicUrl: z.string().url(),
  headers: z.strictObject({ "content-type": z.string(), "content-length": z.string() }), expiresAt: IsoDate });
export const TournamentCreate = z.strictObject({
  name: z.string().trim().min(1, "Give the tournament a name.").max(100),
  description: z.string().trim().max(280).default(""),
  clock: z.enum(["3+2", "5+3", "10+0"]), durationMinutes: z.union([z.literal(30), z.literal(60), z.literal(90)]),
  startsAt: IsoDate,                                       // refined server-side: ≥ now + 10 min, ≤ now + 60 days
  maxParticipants: z.number().int().min(2).max(256),       // refined server-side: ≤ TOURNAMENT_MAX_PLAYERS (D12-18); copy "Between 2 and {cap}."
  positionRefs: z.array(Ref).min(1, "Pick at least one position.").max(10),
  visibility: z.enum(["public", "invite"]), hostRef: Ref.optional(),                  // API-only (O12-1)
});
export const TournamentPatch = TournamentCreate.partial().extend({ rotateInviteCode: z.boolean().optional() });
export const AdminTournamentRow = z.strictObject({ ref: Ref, slug: Slug, name: z.string(), phase: AdminPhase,
  startsAt: IsoDate, players: z.number().int(), cap: z.number().int().nullable(), clockLabel: z.string(),
  visibility: z.enum(["public", "invite"]), inviteUrl: z.string().url(), version: z.number().int() });
export const ReportRow = z.strictObject({ ref: Ref,
  targetType: z.enum(["user", "game", "mistake", "puzzle", "lesson", "position", "coach_message"]), // P5's ReportTarget (CS R-02)
  targetRef: z.string(), targetLabel: z.string().max(80),
  reason: z.string(), note: z.string().max(500).nullable(), reporter: PersonLite.nullable(),
  status: z.enum(["open", "actioned", "dismissed"]), createdAt: IsoDate });
```

**Handler notes.**

- **ADM-1** (`WEB/lib/data/admin/metrics.ts`, `unstable_cache(fn, ['admin-metrics'], { revalidate: 60, tags: ['admin:metrics'] })`) is one statement of scalar subqueries:

  ```sql
  SELECT
    (SELECT count(*) FROM users WHERE "isActive")                                               AS users_total,
    (SELECT count(*) FROM users WHERE "createdAt" > now() - interval '7 days')                  AS users_week,
    (SELECT count(*) FROM games WHERE source = 'REPLAY' AND status = 'COMPLETED')                AS games_total,
    (SELECT count(*) FROM games WHERE source = 'REPLAY' AND status = 'COMPLETED'
                                 AND "completedAt" >= date_trunc('day', now() AT TIME ZONE $tz) AT TIME ZONE $tz) AS games_today,
    (SELECT count(*) FROM users WHERE "subscriptionStatus" = 'active'
        OR ("subscriptionStatus" = 'cancelled' AND "cancelAtPeriodEnd" AND "currentPeriodEnd" > now())
        OR ("subscriptionStatus" IN ('on_hold', 'past_due') AND "currentPeriodEnd" > now()))   AS members_active,
    (SELECT count(*) FROM users WHERE "subscriptionStatus" IN ('on_hold', 'past_due'))          AS members_past_due,
    (SELECT count(*) FROM chess_positions WHERE status <> 'ARCHIVED')                           AS positions_total,
    (SELECT count(*) FROM chess_positions WHERE status = 'DRAFT')                               AS positions_drafts,
    (SELECT count(*) FROM legends WHERE "isActive")                                             AS legends_total,
    (SELECT count(*) FROM legends WHERE "isActive" AND "profilePhotoUrl" IS NULL)               AS legends_no_portrait,
    (SELECT count(*) FROM tournaments WHERE status <> 'CANCELLED')                              AS t_total,
    (SELECT count(*) FROM tournaments WHERE status = 'ACTIVE')                                  AS t_live,
    (SELECT count(*) FROM tournaments WHERE status = 'LOBBY')                                   AS t_upcoming;
  ```

  `games.source` is the `GameSource` column CS R-01 adds to M2. The members predicate mirrors `isEntitled()` (`WEB/lib/billing/entitlement-rules.ts:56-74`, `GRACE_STATUSES` at :44-47); a DB-backed test checks that the SQL and the function agree on generated rows (§12.1). `$tz` is the admin's `User.timeZone`.
- **ADM-11**: `internalFetch(WS_INTERNAL_URL + '/internal/metrics')` and `internalFetch(ANALYSIS_WORKER_URL + '/internal/metrics')` (CS R-09 names, D12-15), `AbortSignal.timeout(ADMIN_HEALTH_TIMEOUT_MS)`, in parallel. P2's Caddyfile blocks the socket's `/internal/metrics` from outside today; P12 opens it for signed `GET` only (§7.5). Status rules in §8.9.
- **ADM-2** maps `audit_logs` rows through `WEB/lib/admin/activity-format.ts`: `(category, action, targetType, meta)` → `{ kind, message, href }` (for example `TOURNAMENT/tournament.started` → "Tournament {name} started · {players} players", href `/t/{slug}`; `BILLING/billing.payment_failed` → "Payment failed for {username ?? 'a member'} · retrying"; `ACCOUNT/account.created` → "New sign-up from {signupSource}"). Unknown actions render "{category} · {action}".
- **ADM-3/4** share `WEB/lib/services/admin/positions.ts` `upsertPosition()` with the scraper import. FEN validation: `validateFenStrict()` (§8.10) on the server; a duplicate FEN maps P2002 on `chess_positions_fen_key` to 409 `fen_taken` with the existing row's ref and title. `sideToMove` is derived from the FEN. `legendRef` + `heroSide` write `heroSide` and the matching `whitePlayerId`/`blackPlayerId`. **Status and `isActive` move together** in one statement (CS fix 12.4): publish → `status = PUBLISHED, "isActive" = true`; draft → `DRAFT, false`; archive → `ARCHIVED, false`. P8's `verifiedAt` stays as P8 defines it (only ADM-5 sets it).
- **ADM-9** uses P10's helper `WEB/lib/r2/presign.ts` (`aws4fetch`, SigV4 `signQuery: true`; CS R-12, fix 12.10): `PUT https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com/<R2_BUCKET>/legends/<legendRef>/<uuid>.jpg`, signed headers `content-type` and `content-length` = the declared `bytes`, expiry 300 s. If P12 merges before P10, P12 creates that file with P10's D11/D12 rules and P10 imports it. `publicUrl = NEXT_PUBLIC_MEDIA_URL + '/legends/<legendRef>/<uuid>.jpg'`. There is no AWS SDK in web dependencies (`@aws-sdk/client-s3` stays a devDependency of `WEB/scripts/upload-media.ts` only). ADM-7 accepts `profilePhotoUrl` only under that prefix, `HEAD`s the object first (it must exist, `content-length ≤ 2 MB`, `content-type image/*`, as P10's ME-6b does) and requires `portraitLicence` (and `portraitSource` unless `own`). The media bucket's CORS rule for `PUT` from the dev and prod origins is P10's setup step (P10 §7.9); P12 only checks it exists.
- **ADM-8b** server steps, one transaction: refine `startsAt` (≥ now + 10 min, ≤ now + 60 days) and `maxParticipants ≤ TOURNAMENT_MAX_PLAYERS`; load the positions (`status = PUBLISHED`, in the given order; any missing → `validation_failed` on `positionRefs`); `slug = slugify(name) + '-' + base32(3)` (retry on P2002 up to 3 times); `inviteCode` = 8 random Crockford chars; `mode` = `LEGEND` when every position has a legend, else `FREE` (legacy enum compatibility); `initialTimeSeconds`/`incrementSeconds` from the clock; `lobbyOpensAt = startsAt − 60 min`; `lateJoinUntil = startsAt + duration − 10 min`; `createdByUserId = viewer.id`; create the `TournamentPosition` rows (fen and label snapshot; label = position title or "White vs Black, Event Year"); **no auto-join** (unlike `create/route.ts:84-90`). `after()`: WS-7 schedule upsert, `revalidateTag('tournaments:list', 'tournaments:schedule')`, audit `tournament.created`, PostHog `admin_action { action: "tournament.created" }`.
- **ADM-8d** edit moves the start: the same statement updates `lobbyOpensAt`/`lateJoinUntil`, and the reminder rows move with it (§7.8). `rotateInviteCode: true` writes a new code (every shared link stops working).
- **ADM-8e** cancel: `UPDATE … SET status = 'CANCELLED', "cancelledReason" = $r WHERE slug = $s AND status IN ('LOBBY', 'ACTIVE')`, plus the reminder skip. `after()`: WS-7 (the socket clears its timers and pool and emits `tournament:cancelled`), audit. Running games finish as unscored games (§8.1).
- **ADM-13/14**: resolve sets `reports.status`, `"resolvedAt"` and `"resolvedById"` (P5's columns; there is no resolution note column, and audit `meta` carries only the action). Suspend sets `users."isActive" = false` (P1's viewer answers 401 for inactive users), calls `clerk.users.banUser(clerkId)` in `after()` so live sessions end, and `syncClerkClaims()`; unsuspend reverses all three. Refuses `self` (403) and the last active admin (409 `last_admin`). Audit `moderation.user_suspended { suspended }`.

### 7.4 Internal web routes (called by the socket server)

`auth: "internal"` (`verifyInternal(req, { caller: "socket" })`, D12-15), bodies carry `v: 1`, every route is idempotent and safe to retry (the socket's outbox retries with 1, 2, 4, 8 … 60 s backoff and `AbortSignal.timeout(8000)`). Schemas in `CT/internal/tournaments.ts`.

| ID | Method · path | Request → `data` | Semantics |
|---|---|---|---|
| INT-9 | `GET /api/internal/tournaments/schedule` | → `{ items: ScheduleItem[] }` where `ScheduleItem = { slug, ref, id, status: "lobby" \| "active", startsAt, endsAt, lobbyOpensAt, lateJoinUntil, durationMinutes, positions: { order, fen, label }[], clock, pool, maxGameSec, startDelays, participantCount }` | Every LOBBY tournament starting within 7 days and every ACTIVE one. Wrapped in `unstable_cache(['tournaments-schedule'], { revalidate: 3600, tags: ['tournaments:schedule'] })`; every tournament write calls `revalidateTag('tournaments:schedule')`, so the socket's hourly re-sync is a Data Cache hit (D12-10). `id` is internal-only (the socket uses it for its direct participant read) |
| INT-10 | `POST /api/internal/tournaments/{slug}/pairings` | `{ v, pairs: [{ whiteRef, blackRef, clientPairId }] (1–8) }` → `{ results: [{ clientPairId, ok: true, game: LiveGameRecord } \| { clientPairId, ok: false, code: "not_participant" \| "in_game" \| "ended" \| "not_member" }] }` | One transaction for the batch (§8.3): lock the tournament row (`status = 'ACTIVE' AND now() < "endsAt"`), lock the participant rows ordered by id, check both players' membership from the DB (`isEntitled()`), check no IN_PROGRESS game in this tournament for either (`games_tournament_live_idx`; an existing game between exactly this pair created < 120 s ago is **returned** as the result: the idempotent retry path), resolve the slot position (§8.6), create each game and both `GamePlayer` rows with P2's `createLiveGame(tx, { mode: "TOURNAMENT", tournamentId, tournamentPositionOrder, … })`. Returns P2's `LiveGameRecord` (the type `DB/src/live/loadLiveGame.ts` returns) per game, so the socket creates sessions without a read. `area: "online"` |
| INT-11a | `POST /api/internal/tournaments/{slug}/start` | `{ v, at }` → `{ outcome: "started", startedAt, endsAt, lateJoinUntil } \| { outcome: "delayed", startsAt } \| { outcome: "cancelled", reason } \| { outcome: "noop", status }` | §8.7, through `startTournament()` (shared with TOU-9a). Conditional on `status = 'LOBBY'`; a second call is `noop`. `after()`: audit, `revalidateTag`, reminder moves or skips (§7.8) |
| INT-11b | `POST /api/internal/tournaments/{slug}/finalize` | `{ v, at, forced: boolean }` → `{ finalVersion, podium: StandingRow[] }` | §8.7. Guard `"finalizedAt" IS NULL`; a second call returns the stored result. `after()`: `revalidateTag('tournament:<slug>', 'tournaments:list', 'tournaments:schedule')`, audit `tournament.finalized`, PostHog, the podium milestone jobs (§7.8) |

**Not built:** INT-11c remind (D12-10: the socket toasts from its own participant list; push and email come from P10 rows written at join), INT-12 pool entry (D12-11), and any INT-6 extension: scoring is a clause of P2's direct finish statement (§8.1), so there is no web finish route to extend.

### 7.5 HTTP endpoints on the socket server

| ID | Method · path | Caller | Body → response | Notes |
|---|---|---|---|---|
| WS-7 (new) | `POST /internal/tournaments/schedule` | web `after()` on create, patch, start, end, cancel, duplicate, finalize, and TH-1 | `{ v, items: ScheduleItem[] (1–20), removed?: string[] }` → 202 `{ armed }` | `verifyInternal(req, { caller: "web" })`. Upserts the runtime for each slug, re-arms its timers, and emits `tournament:started` / `tournament:updated` / `tournament:cancelled` / `ending_soon` to the room when the status or times changed |
| WS-6 (extended) | `GET /internal/metrics` | ADM-11, `deploy-oci.yml` | + `tournaments: { active, searching, watchers, pairTickP99Ms, findToPairedP50Ms }` | P2 blocks this path at Caddy; P12 opens it for signed `GET` only (below) |
| WS-3 (P2) | `POST /internal/emit` | web routes | P2's body `{ v: 1, targets: ({ room } \| { userRef })[] ≤ 50, event, data, dedupeKey? }` (CS R-07); used for `player_joined`, `player_left` | the P12 events are in `CT/socket/registry.ts`, so `data` is validated; the emit pipeline also hands `tournament:player_joined/left` to the runtime (§8.5). Per-caller allow-list (CA AP-44): `tournament:*` from `web` only |
| WS-5 (P2, changed) | `POST /internal/drain` | `deploy-oci.yml` | `{ v, inSeconds, force?: boolean }` → 409 `{ activeTournaments }` when a tournament is live and `force` is not set | the workflow waits up to 30 min and retries every 2 min (ARCH rule) |

**Caddy** (`REPO/deploy/oci/Caddyfile`): the allow-list gains `POST /internal/tournaments/schedule` and `GET /internal/metrics`. Both sit behind the pre-check `@unsigned { path /internal/*; not header X-Rc-Sig * }` → `respond 401`, so unsigned requests never reach Node on the 1-OCPU box (CF SEC-8), with the existing 64 KB body cap.

### 7.6 Socket commands (client → server, all with acks; schemas in `CT/socket/tournament.ts`)

| Command | Payload | Allowed when | Ack `ok` | Error codes | Rate limit |
|---|---|---|---|---|---|
| `tournament:watch` | `{ slug }` | any signed-in socket | `{ standingsVersion, liveCount, topBoard: TopBoardView \| null, me: { searching: { since } \| null, inGameRef } \| null }` | `not_found` | 10 per 10 s |
| `tournament:unwatch` | `{ slug }` | any | `{}` | — | — |
| `tournament:find_match` | `{ slug }` | `ent > now` (newest token), participant (mirror, §8.5), phase `live` and `now < endsAt`, not in a live tournament game, no P11 notice affecting `online` | `{ since }` (epoch ms; a second tab gets the same `since`) | `not_member` (+ `reason`), `not_participant`, `phase`, `already_in_game` (+ `gameRef`), `maintenance`, `rate_limited` | 1 per 2 s per user |
| `tournament:cancel_search` | `{ slug }` | any | `{}` | — | — |

Identity is the token's `sub` only; no payload carries a user ref (P2 rule). A user's search survives a page refresh: when their last socket leaves, the pool keeps the entry for 10 s before dropping it. A `find_match` removes the user from P9's queue and from any other arena pool (D12-16).

### 7.7 Socket events (server → client)

Rooms: `tournament:{slug}` (watchers) and `user:{ref}` (P2). Names in `CT/socket/registry.ts`, payload schemas in `CT/socket/tournament.ts`; every payload carries `slug` and `at` (server epoch ms). Size budgets are asserted in P2's `CT/socket/test/size.test.ts` with realistic fixtures (25-char refs, real FENs, 20-character names), as exceptions to P2's 120 B default (CA AP-16).

| Event | Room | Payload | Budget | Emitted by | Client effect |
|---|---|---|---|---|---|
| `tournament:paired` | `user:` (both players) | `{ slug, gameRef, color: "w" \| "b", opponent: PersonLite, positionLabel, studyStartsAt }` | ≤ 300 B | pairer after INT-10 | arena store → `matched`; prefetch the game route |
| `tournament:search_ended` | `user:` | `{ slug, reason: "ended" \| "cancelled" \| "removed" \| "moved" \| "maintenance" }` | ≤ 120 B | pairer at `endsAt`, on cancel, on a failed pairing check, when another search takes over (D12-16), on a maintenance notice | arena store → `idle` + banner |
| `tournament:starting_soon` | `user:` (participants) | `{ slug, name, startsAt }` | ≤ 160 B | the socket's T−5 timer, from the runtime's participant list (D12-10) | toast "Sunday Fischer Cup starts in 5 minutes" + [Open Lobby] |
| `tournament:player_joined` | room | `{ slug, player: PersonLite, count, seed, joinOrder }` | ≤ 260 B | web TOU-4a → WS-3 | lobby list prepend with JUST JOINED; counts |
| `tournament:player_left` | room | `{ slug, playerRef, count }` | ≤ 120 B | web TOU-4b → WS-3 | lobby list remove; counts |
| `tournament:started` | room | `{ slug, startedAt, endsAt, lateJoinUntil }` | ≤ 140 B | socket (scheduler or WS-7) | invalidate the snapshot → arena view |
| `tournament:updated` | room | `{ slug, fields: ("name" \| "startsAt" \| "cap" \| "positions" \| "visibility")[], startsAt?, delayed?: boolean }` | ≤ 160 B | socket (WS-7 or a scheduler delay) | invalidate the snapshot; delay banner |
| `tournament:game_started` | room | `{ slug, gameRef, whiteRef, blackRef, liveCount }` | ≤ 160 B | pairer | live count; standings "playing" dot |
| `tournament:game_ended` | room | `{ slug, gameRef, liveCount }` | ≤ 120 B | socket on game end | live count |
| `tournament:standings_delta` | room | `{ slug, version, of, rows: StandingRow[≤2] }` (ranks from the mirror) | ≤ 450 B | socket after the finish statement, in `version` order (§8.5) | versioned reducer (§5.4) |
| `tournament:top_board` | room | `TopBoardView & { slug, liveCount }`; ≤ 1 per second per tournament | ≤ 350 B | socket | top board card |
| `tournament:ending_soon` | room | `{ slug, endsAt }` | ≤ 100 B | socket timer at `endsAt − 120 s`, or on TOU-9b | banner |
| `tournament:ended` | room | `{ slug, finalVersion }` | ≤ 100 B | socket after INT-11b | navigate to results |
| `tournament:cancelled` | room + `user:` of searchers | `{ slug, reason }` | ≤ 140 B | socket (scheduler or WS-7) | redirect + toast |

**`GameState.tournament`** (P2's type in `CT/socket/game.ts`, extended; `GameState` stays ≤ 2 KB): `{ slug, name, endsAt, arenaClosed, place: number | null, of, points: number | null, fire: boolean } | null`.
**`game:result.tournament`** (P2 §7.4, the post-persistence result): `{ sides: { w: { points, fire, rank }, b: { points, fire, rank } }, of, endsAt, arenaClosed } | null`; `null` for unscored games (aborted, cancelled, after finalize).

**Removed v1 names:** `join_tournament_lobby`, `leave_tournament_lobby`, `tournament_player_joined`, `tournament_started`, `tournament_game_started`, `tournament_game_ended`, `tournament_ended`, `tournament_match_found` (API §6.11). P2 kept the lobby aliases only for the legacy tournament pages; they are deleted together with those pages.

### 7.8 Background work

| Work | Runs on | Trigger | Idempotency |
|---|---|---|---|
| `TournamentScheduler` timers: T−5 min toast (`starting_soon` to every participant's `user:` room), start at `startsAt` (INT-11a), `ending_soon` at `endsAt − 120 s`, stop pairing at `endsAt`, finalize when the last game ends after `endsAt` or at `endsAt + maxGameSec` (INT-11b, `forced: true`) | socket server, in memory | `setTimeout` per tournament; armed at boot from INT-9, on WS-7 pushes, and on the hourly re-sync | the internal routes are conditional on status / `finalizedAt` |
| `TournamentPairer` | socket server | 1 s tick per tournament with ≥ 2 searchers (and immediately on a new search) | INT-10 natural key (§7.4) |
| Start reminder rows (P10 present) | web, inside the TOU-4a transaction | join while LOBBY | `Notification { kind: TOURNAMENT_STARTING, dedupeKey: "tstart:<tournamentRef>:<userRef>", runAt: startsAt − 5 min, url: "/t/<slug>", pushStatus/emailStatus from the `tournament_start` channel }` through P10's producer in `WEB/lib/notify/producers.ts`, `ON CONFLICT ("dedupeKey") DO NOTHING`; plus one `jobs` row `NOTIFY_DISPATCH`, `runAt` = the same minute, `dedupeKey "notify-drain:<runAt minute>"` (P10 §7.8), and `after()` → `POST /internal/analysis/kick { v, kinds: ["NOTIFY_DISPATCH"], runAt }` so the worker arms its next-due timer instead of polling (CA AP-08, CF F-NEON-2). `TOURNAMENT_STARTING` bypasses quiet hours (P10 §8.10) |
| Reminder moves and skips | web, in the transaction that changes the start | delay (INT-11a `delayed`), admin edit of `startsAt` (ADM-8d) → `UPDATE notifications n SET "runAt" = $new FROM tournament_participants p JOIN users u ON u.id = p."userId" WHERE p."tournamentId" = $t AND n."dedupeKey" = 'tstart:' \|\| $tref \|\| ':' \|\| u."referenceId" AND n."sentAt" IS NULL` + a new `NOTIFY_DISPATCH` row for the new minute; leave (TOU-4b, one row), start more than 5 min early (TOU-9a) and cancel (ADM-8e, INT-11a `cancelled`) → the same join with `SET "pushStatus" = 'SKIPPED', "emailStatus" = 'SKIPPED'` | `dedupeKey` per participant; each statement uses the unique index row by row (≤ 256) |
| Podium milestone (P10 present) | web, INT-11b `after()` | finalize | `INSERT INTO jobs (kind, priority, "dedupeKey", payload, "runAt") SELECT 'MILESTONES_EVALUATE', <JOB_PRIORITY.HOUSEKEEPING>, 'ms:' \|\| p."userId", …, now() + interval '60 s' FROM tournament_participants p WHERE p."tournamentId" = $t AND p."finalRank" <= 3 AND p."userId" IS NOT NULL ON CONFLICT ("dedupeKey") DO UPDATE SET "runAt" = GREATEST(jobs."runAt", EXCLUDED."runAt")` (P10's debounce), then one kick. The worker's evaluator reads the new `TOURNAMENT_PODIUM` definition (§8.7) and emits `milestone:awarded` (P10) |
| Daily backstop (`WEB/lib/cron/tasks/tournaments.ts` in P1's ordered task list, `09:00 UTC`) | Vercel cron (Hobby: once a day) | daily | (a) finalize ACTIVE tournaments with `endsAt + maxGameSec + 10 min < now()` and `finalizedAt IS NULL`; (b) cancel LOBBY tournaments whose `scheduledStartAt` passed more than 1 h ago (socket outage); both conditional updates through `DOM/tournaments/lifecycle.ts`, audited as `SYSTEM`, Sentry warning when it acts |

No new worker job kind (D12-12). Every tournament game is analysed by P3's existing `ANALYZE_GAME` enqueue in the finish statement. Cancellation sends no push or email (§2.2).

### 7.9 Third-party integrations

| Service | Use | Details |
|---|---|---|
| Cloudflare R2 (S3 API) | legend portrait upload | P10's `WEB/lib/r2/presign.ts` on `aws4fetch` (≈ 3 KB, server-only); no `@aws-sdk/*` in web runtime dependencies (CS R-12) |
| Clerk | admin reverification; suspend | server: `auth()` `has({ reverification: "strict" })` in the cancel, archive and suspend routes, answering 403 `reverification_required`; client: `useReverification()` from `@clerk/nextjs` wraps the mutation (API §2.6); `users.banUser` / `unbanUser` from `after()` in ADM-14 |
| PostHog | server events from `after()` | §10.1 |
| Sentry | spans, metrics, alerts | §10.2 |

### 7.10 Environment variables and flags

| Name | Where | Default (dev) | Purpose |
|---|---|---|---|
| `TOURNAMENT_INVITE_SECRET` | Vercel dev + prod (new) | 32 random bytes | HMAC for inviter tags (§8.8). Rotating it only drops the "invited by" line on old links |
| `TOURNAMENT_MAX_PLAYERS` | Vercel dev + prod (new) | `64` | the arena cap enforced by ADM-8 (D12-18); raised to `256` only after the §9.7 run at 256 passes |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | Vercel (P10's names, `WEB/.env.example:42-45`) | bucket `replay-chess-media` | presigned portrait uploads (a token scoped to Object Read & Write on the bucket) |
| `NEXT_PUBLIC_MEDIA_URL` | Vercel (existing) | media host | public portrait URL prefix |
| `WS_INTERNAL_URL`, `ANALYSIS_WORKER_URL`, `INTERNAL_API_SECRET` | Vercel (P2/P3, CS R-09 names) | — | WS-7, WS-6, worker metrics and kicks; the secret feeds `CT/internal/auth.ts` (D12-15) |
| `NEXT_PUBLIC_SITE_URL` | Vercel (existing, CS R-09) | the dev URL in CLAUDE.md | absolute invite URLs |
| `ADMIN_HEALTH_TIMEOUT_MS` | Vercel (new) | `2000` | ADM-11 per-call timeout |
| `TOURNAMENT_PAIR_TICK_MS` | socket `WS_DEV_ENV_FILE` / `WS_ENV_FILE` (new) | `1000` | pairing tick |
| `TOURNAMENT_PAIR_BATCH` | socket (new) | `8` | max pairs per INT-10 call |
| `TOURNAMENT_RESYNC_MS` | socket (new) | `3600000` | schedule re-sync |
| `TOURNAMENT_POOL_GRACE_MS` | socket (new) | `10000` | keep a search when the last socket drops |
| `R2_PRESIGN_MODE` | Vercel test builds only (test hook, §7.12) | unset | `fake` signs against the dev-only upload route for E2E |
| Flag `tournaments-v3` | `WEB/lib/flags/registry/p12.ts` (PostHog) | on for the owner, the E2E admin and the E2E members | v3 tournament screens, redirects, game variant, the P10 tournament rows |
| Flag `admin-v3` (ALLOC §1.6 gets a line, CS R-14) | same | on for admins | v3 admin console |

### 7.11 Removed routes

| Route | Removed when | Note |
|---|---|---|
| `GET /api/tournament`, `GET /api/tournament/[ref]`, `POST /api/tournament/{join,find-match,cancel-search,start,end,create}` | in P12, after the v3 parity check | no alias: the only external caller is `e2e/specs/tournament.spec.ts`, which is rewritten in the same PR (API §4.12 suggested one release of aliases; it is not needed) |
| `DELETE /api/tournament/[ref]` | in P12 | replaced by the registered test hook TH-2 |
| `GET/PUT/DELETE /api/chess-positions/[id]`, `POST /api/chess-positions/create`, `GET /api/chess-positions` | in P12, when `admin-v3` reaches 100 % | — |
| `POST /api/legends/create`, `PUT/DELETE /api/legends/[id]`, `GET /api/legends/search` | same | P8 owns `GET /api/legends` (CAT-1) and the ADM-6 GET |
| `POST /internal/tournament-event` (socket) | P2's alias, deleted by P12 | — |

### 7.12 Test hooks (registered in P1's `WEB/lib/test-hooks/registry.ts`, CTe X12)

Every hook is guarded by `testHooksEnabled()` = `isNonProd()` (`APP_ENV ∈ {dev, test}`, validated at boot) **and** `ALLOW_TEST_HOOKS=1`, plus the header `x-e2e-token` equal to `E2E_TEST_TOKEN` for routes. It does not use `VERCEL_ENV`, because the dev project deploys as `production` (CF fix #3, SEC-5). P1's `prod-guard.spec.ts` iterates the registry and proves each one is 404 or ignored in the production-mode build.

| ID | Kind | Hook | Effect |
|---|---|---|---|
| TH-1 | route | `POST /api/test/tournaments/{slug}/time` `{ startsInSec?, endsInSec?, lateJoinInSec? }` | shifts `scheduledStartAt`, `lobbyOpensAt`, `endsAt`, `lateJoinUntil` relative to `now()`, moves the reminder rows, then pushes WS-7 so the socket re-arms (specs never wait 10 minutes) |
| TH-2 | route | `DELETE /api/test/tournaments/{slug}` | deletes a tournament created by E2E (cascade through participants and positions; its games are deleted by ref); timing-safe token compare |
| TH-3 | env | `R2_PRESIGN_MODE=fake` | the presign returns a URL of the dev-only upload route; the web process refuses to boot with it when `APP_ENV=production` (unit test) |
| — | header (P1) | `x-rc-now` | server `ctx.now` for phase and join-state checks in route tests (CTe X5) |
| — | env (P2) | `TIMING_PROFILE=fast` | scales `ending_soon`, the 5 s match card and the 10 s pool grace to 1–2 s in the per-worker fixture socket server (CTe X5) |

---

## 8. Domain logic

Pure functions live in `DOM/tournaments/*.ts` (no Prisma, unit-tested with `node:test`); the transaction wrappers take a `tx` and never touch the global client inside a transaction (ADB DB-11, OPT §3.1 rule 4). The socket server imports the pure parts (`phase`, `slot`, `scoring`, `ranking` constants) from `@repo/domain/tournaments` (server-only package, no Prisma in those files), so the arena rules exist once.

### 8.1 Arena scoring (`DOM/tournaments/scoring.ts` and the finish clause `DB/src/live/fragments/tournament.ts`)

The rules follow the Lichess arena format (the design copy "Win 2 points, draw 1. Two wins in a row double the next.", acct Q25's recommendation, and Lichess's published arena FAQ: base 2/1/0; after two consecutive wins a player is "on fire" and each result is doubled until they fail to win; draws in the first 10 moves score nothing). `ScoringV1` holds the constants per tournament (`win: 2, draw: 1, fire: true, earlyDrawPly: 20`).

**The reference function** (pure; the oracle for the SQL clause and for the socket's optimistic UI preview):

```ts
export type Outcome = "win" | "draw" | "loss";
export interface Before { streak: number; fire: boolean }
export interface Scored { points: number; streak: number; fire: boolean; earlyDraw: boolean }

export function scoreResult(b: Before, o: Outcome, plyCount: number, s: ScoringV1): Scored {
  const earlyDraw = o === "draw" && plyCount < s.earlyDrawPly;            // 20 plies = 10 moves each, counted from the game's start position
  const base = o === "win" ? s.win : o === "draw" && !earlyDraw ? s.draw : 0;
  const points = s.fire && b.fire ? base * 2 : base;                       // on fire: win 4, draw 2, loss 0
  const streak = o === "win" ? b.streak + 1 : 0;                           // any non-win (draws included) resets
  return { points, streak, fire: s.fire && streak >= 2, earlyDraw };
}
```

| Case | Before | Result | Points | After |
|---|---|---|---|---|
| First game, win | streak 0 | win | 2 | streak 1, no fire |
| Second consecutive win | streak 1 | win | 2 | streak 2, **fire** |
| Win on fire | streak 2, fire | win | **4** | streak 3, fire |
| Draw on fire (ply ≥ 20) | fire | draw | **2** | streak 0, fire off |
| Loss on fire | fire | loss | 0 | streak 0, fire off |
| Draw before ply 20 (agreement, repetition, stalemate, insufficient material) | any | draw | **0** (also 0 when on fire) | streak 0, fire off; counted in `gamesPlayed` and `draws` |
| Timeout vs insufficient material (`TIMEOUT_VS_INSUFFICIENT`, outcome `DRAW`) | any | draw | 1 (2 on fire) unless ply < 20 | as a draw |
| Abandoned (P2's 30 s grace expired) | any | win / loss | as a normal win / loss | as a normal result |
| Aborted (no first move within the window) | any | — | 0, **not counted** (P2's `abort.ts` has no scoring clause) | unchanged; `tournamentPoints = NULL` |
| Game finishes after `endsAt` (paired before it) | any | any | **counts** ("Games that start now still count") | normal |
| Game finishes after `finalizedAt` (forced finalize, §8.7) | any | any | **not scored** (the clause's tournament update matches no row) | the game stays a normal rated game |
| Tournament cancelled | any | any | not scored | — |
| Finish sent twice (socket retry) | — | — | P2's `status = 'IN_PROGRESS'` guard makes `g` empty, so every dependent clause is empty; scoring never runs twice | — |

**The finish clause.** P2's finish is one data-modifying CTE sent directly from the socket (P2 §6.6.4, B4), built from named fragments. P12 makes three edits to it and adds one fragment file:

1. P2's `g` fragment's `RETURNING` gains `"whitePlayerId", "blackPlayerId"`.
2. P2's legacy `tp` fragment ("until P12") is **deleted**: it updated the same `tournament_participants` rows, and Postgres applies only one modification per row per statement.
3. P2's `gp` fragment's `SET` list gains the two tournament columns (they cannot be a second `UPDATE game_players` for the same reason): `"tournamentPoints" = (SELECT sc.pts FROM sc WHERE sc."userId" = p."userId")`, `"tournamentFire" = COALESCE((SELECT sc.on_fire FROM sc WHERE sc."userId" = p."userId"), false)`. P9's rating columns go into the same `gp` `SET` list (§14.4 asks P9 to state this).
4. New `DB/src/live/fragments/tournament.ts`:

```sql
, tt AS (                                      -- locks the tournament row for the statement; scores only while scorable
  UPDATE tournaments t
     SET "standingsVersion" = t."standingsVersion" + 1, "updatedAt" = now()
    FROM g
   WHERE t.id = g."tournamentId" AND t.status = 'ACTIVE' AND t."finalizedAt" IS NULL
  RETURNING t.id, t.slug, t."standingsVersion" AS version, t.scoring, t."endsAt", t."participantCount"
), side AS (
  SELECT s.color, s.uid, s.opp,
         CASE WHEN $outcome = 'DRAW' THEN 'DRAW'
              WHEN (s.color = 'w') = ($outcome = 'WHITE') THEN 'WIN' ELSE 'LOSS' END AS res
    FROM g CROSS JOIN LATERAL (VALUES ('w', g."whitePlayerId", g."blackPlayerId"),
                                      ('b', g."blackPlayerId", g."whitePlayerId")) AS s(color, uid, opp)
), sc AS (
  SELECT p.id, p."userId", side.color, side.res, side.opp,
         ((tt.scoring->>'fire')::boolean AND p.fire) AS on_fire,
         (CASE side.res WHEN 'WIN'  THEN (tt.scoring->>'win')::int
                        WHEN 'DRAW' THEN CASE WHEN $plyCount < (tt.scoring->>'earlyDrawPly')::int THEN 0
                                              ELSE (tt.scoring->>'draw')::int END
                        ELSE 0 END)
           * CASE WHEN (tt.scoring->>'fire')::boolean AND p.fire THEN 2 ELSE 1 END AS pts,
         CASE WHEN side.res = 'WIN' THEN p.streak + 1 ELSE 0 END AS streak_after,
         ((tt.scoring->>'fire')::boolean AND side.res = 'WIN' AND p.streak + 1 >= 2) AS fire_after
    FROM tt JOIN side ON true
    JOIN tournament_participants p
      ON p."tournamentId" = tt.id AND p."userId" = side.uid AND p."withdrawnAt" IS NULL
), tpu AS (
  UPDATE tournament_participants p
     SET score = p.score + sc.pts,
         points = p.points + CASE sc.res WHEN 'WIN' THEN 1 WHEN 'DRAW' THEN 0.5 ELSE 0 END,   -- legacy column until C7
         wins = p.wins + (sc.res = 'WIN')::int, draws = p.draws + (sc.res = 'DRAW')::int,
         losses = p.losses + (sc.res = 'LOSS')::int, "gamesPlayed" = p."gamesPlayed" + 1,
         streak = sc.streak_after, fire = sc.fire_after,
         "whiteCount" = p."whiteCount" + (sc.color = 'w')::int, "blackCount" = p."blackCount" + (sc.color = 'b')::int,
         "lastOpponentId" = sc.opp, "updatedAt" = now()
    FROM sc WHERE p.id = sc.id
  RETURNING p."userId", p."joinOrder", p.score, p."gamesPlayed", p.wins, p.draws, p.losses, p.streak, p.fire
)
-- appended to P2's final SELECT:
--   (SELECT row_to_json(tt) FROM tt)                                                      AS t_meta,
--   (SELECT json_agg(json_build_object('userId', sc."userId", 'pts', sc.pts, 'onFire', sc.on_fire)) FROM sc) AS t_awards,
--   (SELECT json_agg(tpu) FROM tpu)                                                       AS t_rows
```

Why this shape:

- **Still one statement and one round trip** from Mumbai (≈ 230–260 ms), so the finish SLO of P2 is unchanged. The extra work inside Neon is three index lookups and two row updates (≈ 1–2 ms).
- **Concurrency.** `tt` takes the tournament row lock for the statement. Two finishes in one tournament serialise on it and get versions N+1 and N+2; their participant rows are different players (a player has at most one live game per tournament), so the `p.score + sc.pts` arithmetic is exact. A concurrent finalize (INT-11b) takes the same lock: if finalize commits first, `tt`'s re-checked `WHERE` fails and `sc`, `tpu` and the two `gp` columns are empty, so the late game is not scored (the forced-finalize rule).
- **Ranks are not computed in SQL here.** The socket's mirror holds every participant and computes `rank`/`prevRank` after applying the returned rows in version order (§8.5). That keeps window queries off the hot finish path.
- **Equivalence test.** `DB/test/live/tournament-score.int.test.ts` (local Postgres 17) replays 1,000 random result sequences through the real finish statement and through `scoreResult()` and asserts identical points, streaks, fire flags and totals (§12.1).

### 8.2 Pairing (`WS/src/tournaments/TournamentPairer.ts`)

**Pool per tournament** (in memory): `Map<userRef, { since, rating, whiteCount, blackCount, lastOpponentRef, blocked: Set<userRef>, sockets }>`. A user enters on `tournament:find_match`. The entry is built with **no HTTP call** (D12-11): `rating` = the newest token's `r[pool]` (P9 §7.7; fallback `rating`, then 1500), membership = `ent > now`, `whiteCount`/`blackCount`/`lastOpponentRef` from the mirror (§8.5), `blocked` from P10's socket block loader (`DB/src/blocks/loadBlocks.ts`, one direct read per user, cached 60 s; empty without P10). A user leaves on cancel, on pairing, at `endsAt`, on cancellation, when another search takes over (D12-16), on a maintenance notice, or 10 s after their last socket disconnects (`TOURNAMENT_POOL_GRACE_MS`).

**Tick** (`TOURNAMENT_PAIR_TICK_MS` = 1000; also run immediately when someone enters): skip when the pool has < 2 entries.

```
window(waitSec) = min(800, 100 + 25 × floor(waitSec / 3))         // rating points; acct §5.0, API §6.9 rule 18
order entries by since ASC (longest wait first)
for each unpaired p:
  candidates = unpaired q ≠ p where
      |p.rating − q.rating| ≤ window(max(waitSec(p), waitSec(q)))
      and q ∉ p.blocked and p ∉ q.blocked
      and not (q = p.lastOpponent or p = q.lastOpponent)          // no immediate rematch …
          or (both waited ≥ 15 s and no other candidate exists)     // … unless the arena would stall (tiny arenas)
  pick the candidate with the smallest |Δrating|; ties → longest wait
colour: the player with the larger (whiteCount − blackCount) gets Black; equal → random (crypto)
send all pairs of this tick (≤ TOURNAMENT_PAIR_BATCH = 8) in one INT-10 call; more pairs → next call immediately
```

**After INT-10** (per pair result): `ok` → create the P2 game session from the returned `LiveGameRecord`, remove both from the pool, mark both `inGame`, emit `tournament:paired` to both `user:` rooms and `tournament:game_started` to the room. `in_game` / `not_participant` / `not_member` → remove that user (emit `search_ended {reason: "removed"}` or route them to their game) and return the other player to the pool with their original `since`. `ended` → clear the pool. A transport failure (timeout, 5xx) → both return to the pool with their `since`; the outbox retries with the same `clientPairId` (INT-10 returns the existing game when the first attempt committed).

**Search display.** "Finding an opponent near 1184" uses the searcher's pool rating. "Few players are searching. Keep waiting or come back later." after 60 s.

**Constraints and edge cases.** A user is never in two live tournament games (INT-10 check under the participant lock). A second tab's `find_match` returns the same `since`. An odd player out at the end keeps searching until `endsAt`, then gets `search_ended {reason: "ended"}` ("Arena closed. Your final score: 14").

### 8.3 Game creation for a pairing (INT-10 transaction)

```sql
BEGIN;
SELECT id, status, "endsAt", "startedAt", "durationMinutes", "initialTimeSeconds", "incrementSeconds"
  FROM tournaments WHERE slug = $s FOR SHARE;                     -- status = 'ACTIVE' AND now() < "endsAt", else every pair → ended
SELECT p.id, p."userId", u."referenceId", p."withdrawnAt", <billing columns for isEntitled()>
  FROM tournament_participants p JOIN users u ON u.id = p."userId"
 WHERE p."tournamentId" = $t AND u."referenceId" = ANY($refs) ORDER BY p.id FOR UPDATE OF p;
SELECT "whitePlayerId", "blackPlayerId", "referenceId", "createdAt"
  FROM games WHERE "tournamentId" = $t AND status = 'IN_PROGRESS'
   AND ("whitePlayerId" = ANY($ids) OR "blackPlayerId" = ANY($ids));   -- games_tournament_live_idx
-- per accepted pair: createLiveGame(tx, { mode: 'TOURNAMENT', white, black, tournamentId, tournamentPositionOrder,
--   startingFen, initial/increment, rated: <P9 rule>, studySeconds: 30, phase: 'WAITING', meta.clientPairId })
-- = one INSERT … RETURNING into games and one multi-row INSERT into game_players per game (P2 §6.6.2)
COMMIT;
```

The position for each game is the current slot (§8.6), copied from `tournament_positions` (fen, label). P2's `createLiveGame` writes both `GamePlayer` rows at pairing (with `tournamentId`), so the finish only updates them.

### 8.4 Derived phase (`DOM/tournaments/phase.ts`)

No new enum (acct §5.0 "Derived display status"); the same function runs on the server, the socket and the client.

```ts
export function derivePhase(t: { status: TournamentStatus; lobbyOpensAt: Date; endsAt: Date | null }, now: Date): TournamentPhase {
  if (t.status === "CANCELLED") return "cancelled";
  if (t.status === "COMPLETED") return "finished";
  if (t.status === "ACTIVE") return t.endsAt && now >= t.endsAt ? "finishing" : "live";
  return now >= t.lobbyOpensAt ? "lobby" : "upcoming";
}
export const adminPhase = (p: TournamentPhase): AdminPhase =>
  ({ upcoming: "scheduled", lobby: "lobby", live: "live", finishing: "live", finished: "completed", cancelled: "cancelled" })[p];
export const listTab = (p: TournamentPhase) =>
  p === "live" || p === "finishing" ? "live" : p === "finished" ? "finished" : p === "cancelled" ? null : "upcoming";
```

**Join state** (`joinStateOf(t, now)`): cancelled → `cancelled`; full (`participantCount >= maxParticipants`) → `full`; `finishing`/`finished`, or `live` with `now >= lateJoinUntil` → `closed`; `live` → `late_entry`; `lobby`/`upcoming` with `startsAt − now < 10 min` → `starting_soon`; else `open`. Server callers pass `ctx.now` (P1, so `x-rc-now` drives it in tests).

### 8.5 Ranks, standings deltas and the socket mirror (`WS/src/tournaments/StandingsMirror.ts`)

- **Order** (D12-13): `score DESC, gamesPlayed ASC, joinOrder ASC` (`DOM/tournaments/ranking.ts` exports the comparator; the SQL windows use the same three columns). Fewer games ranks higher at an equal score (it rewards efficiency, as the board's sort `b.pts − a.pts || a.games − b.games` does); join order breaks the remaining ties. Ranks are unique (no shared podium places).
- **Load.** The mirror holds **every** participant of a running tournament (≤ 256 rows × ≈ 80 B): `{ userId, userRef, displayName, joinOrder, score, games, w, d, l, streak, fire, whiteCount, blackCount, lastOpponentRef }`. It is loaded by one direct read through `DB/src/tournaments/loadParticipants.ts` (role `replay_realtime`, P2's pool rules for Neon suspends: `pool.on('error')`, idle timeout below Neon's, one retry on `57P01`/`P1017`, CF F-OCI-4) at the T−5 timer, at the start, or at boot for an ACTIVE tournament: at most once per tournament per process.
- **Joins after the load** reach the socket through its own `/internal/emit` pipeline (`tournament:player_joined` carries `joinOrder`); events that arrive while the load is in flight are buffered and applied after it, de-duplicated by ref. A `find_match` from a user the mirror does not know triggers one direct read of that participant row before refusing with `not_participant` (covers a lost emit).
- **Apply a finish.** The finish statement returns `t_meta.version` and the two `t_rows`. The mirror keeps `lastApplied` per tournament; a block with `version > lastApplied + 1` waits up to 300 ms for the missing one (two finishes can complete out of order on two pool connections), then the mirror reloads from the DB (one statement) instead of guessing. On apply it records `prevRank` for the two rows, replaces them, re-sorts with the comparator (≤ 256 rows, < 0.1 ms), reads the new ranks, and emits `tournament:standings_delta { version, of, rows }`. Metric `ws.tournament.delta_reordered`.
- **Lost finish response.** When P2's finish reports `finished = 0` for a tournament game (the first attempt committed but its response was lost), the socket reloads that tournament's participants and `standingsVersion` (one statement), sets `lastApplied` to the version it read and emits a delta for the two players of that game, so the mirror never keeps a stale row.
- **Uses.** The mirror feeds the top-board choice, `GameState.tournament.place`, `game:result.tournament.sides.*.rank`, the pool entry (§8.2) and the T−5 toast recipients.

### 8.6 Position rotation (`DOM/tournaments/slot.ts`)

Time slices (acct Q26 recommendation; O12-4): `n = positions.length`, `sliceMs = durationMinutes × 60 000 / n`, `slot(now) = clamp(floor((now − startedAt) / sliceMs), 0, n − 1)`. A game takes the slot of the moment it is paired. A host start moves `startedAt`, so slots follow the real start. The lobby shows slot 0 ("Round 1 position"); the live eyebrow shows the current slot's label; clients compute the slot locally from the snapshot.

### 8.7 Lifecycle: start, delay, cancel, finish, finalize (`DOM/tournaments/lifecycle.ts`)

- `lobbyOpensAt = startsAt − 60 min`; `lateJoinUntil = endsAt − 10 min` (acct §6.5 step 7, "Late entries are open until 19:50" for a 19:00–20:00 arena).
- **Reminder** at T−5 min: the socket toast to every participant's `user:` room (from the mirror) and, with P10, the future-dated `Notification` rows written at join (§7.8).
- **Start** (INT-11a at `startsAt`): with `participantCount ≥ 2` → `ACTIVE`, `startedAt = now`, `endsAt = now + duration`, `lateJoinUntil = endsAt − 10 min`. With < 2 players and `startDelays = 0` → `scheduledStartAt += 10 min`, `lobbyOpensAt` unchanged, `startDelays = 1`, the reminder rows move, outcome `delayed` (the socket emits `tournament:updated { delayed: true }`). With < 2 players after the delay → `CANCELLED`, `cancelledReason = 'not_enough_players'`, reminders skipped; participants get the socket toast and redirect (acct Q29, O12-3).
- **Finish window:** pairing stops at `endsAt`; games paired before it run to completion and count.
- **`maxGameSec`** = `studySec (30) + 2 × firstMoveSec (30) + 2 × (initialSec + 60 × incSec) + 60` → 3+2: 750 s; 5+3: 1,110 s; 10+0: 1,350 s.
- **Finalize** (INT-11b), whichever comes first: (a) at `endsAt` when the socket has no live game for the tournament; (b) when the last live tournament game ends after `endsAt`; (c) the forced fallback at `endsAt + maxGameSec` (games still running then are not scored; logged as `ws.tournament.finalize_forced`). The transaction:

  ```sql
  UPDATE tournaments SET status = 'COMPLETED', "completedAt" = now(), "finalizedAt" = now()
   WHERE id = $t AND status = 'ACTIVE' AND "finalizedAt" IS NULL RETURNING id;   -- 0 rows → return the stored result
  WITH r AS (
    SELECT p.id, u.name,
           ROW_NUMBER() OVER (ORDER BY p.score DESC, p."gamesPlayed", p."joinOrder") AS rank
      FROM tournament_participants p LEFT JOIN users u ON u.id = p."userId"
     WHERE p."tournamentId" = $t AND p."withdrawnAt" IS NULL)
  UPDATE tournament_participants p
     SET "finalRank" = r.rank, "displayName" = coalesce(r.name, p."displayName")
    FROM r WHERE p.id = r.id;                                                      -- ≤ 256 rows
  SELECT … FROM tournament_participants WHERE "tournamentId" = $t
   ORDER BY "finalRank" LIMIT 256;                                                 -- build FinalStandingsV1 in the route
  UPDATE tournaments SET "finalStandings" = $json::jsonb WHERE id = $t;
  ```

  `after()`: the podium milestone jobs (§7.8). P12 adds the evaluator row to P10's `WEB/lib/milestones/definitions.ts`: kind `TOURNAMENT_PODIUM`, key = tournament slug, title "Top 3 in {name}", target 1, evaluator `SELECT t.slug, t.name, p."finalRank" FROM tournament_participants p JOIN tournaments t ON t.id = p."tournamentId" WHERE p."userId" = $u AND p."finalRank" <= 3 AND t."finalizedAt" IS NOT NULL` (≤ tens of rows per user; `tournament_participants_userId_idx`), href `/t/{slug}/results`, mini board = the tournament's position 0.

### 8.8 Invite codes and the inviter tag (`DOM/tournaments/invite.ts`)

- `inviteCode`: 8 characters from Crockford base32 (`0-9A-HJKMNP-TV-Z`), `crypto.randomInt`, unique (P2002 → retry). Admins can rotate it (ADM-8d `rotateInviteCode: true`), which invalidates every shared link.
- **Inviter tag** `i = <sqid(userId)>.<hmac6>` where `hmac6 = base32(HMAC-SHA256(TOURNAMENT_INVITE_SECRET, "t:" + tournamentId + ":u:" + userId))[0..6]`. Verification decodes the sqid, recomputes the HMAC (timing-safe) and loads the user (deleted user, bad tag, or a user the viewer blocked → no inviter line). The tag never grants access; the code does. Participants and admins get their own tagged URL in `MyTournamentState.inviteUrl`.
- Link shape: `${NEXT_PUBLIC_SITE_URL}/join-tournament/7Q2KX9MD?i=k3m9x2.TQ4HZM` → 307 → `/t/sunday-fischer-cup-7q2/join?c=7Q2KX9MD&i=k3m9x2.TQ4HZM`.

### 8.9 Health status rules (ADM-11)

| Service | Healthy / Normal | Degraded / Busy | Down / Backed up | Unknown |
|---|---|---|---|---|
| Socket (P2 `/internal/metrics`: `loopLag.p99`, `outbox.oldestMs`, `games.byPhase`) | reachable, `loopLag.p99 < 100 ms`, `outbox.oldestMs < 60 000` | reachable but either threshold exceeded | HTTP error | timeout (`ADMIN_HEALTH_TIMEOUT_MS`) |
| Analysis (P3 worker `/internal/metrics` queue gauges) | median queue wait over the last hour ≤ 30 s and oldest queued job < 5 min | median ≤ 120 s or oldest < 15 min | worse | timeout |

The dashboard line reads "OCI · {gamesLive} games live · Healthy" and "Median {medianWaitSec} s · Normal".

### 8.10 FEN validation (`WEB/lib/admin/fen.ts`, used by the editor live and by the server)

`validateFenStrict(fen)` returns the first failure, in this order, with the exact copy the editor shows:

| Check | Message |
|---|---|
| 6 space-separated fields | "Not a legal FEN: it needs 6 fields separated by spaces." |
| 8 ranks separated by `/` | "Not a legal FEN: it has {n} ranks. A board needs exactly 8." |
| each rank expands to 8 squares | "Not a legal FEN: rank {r} has {n} squares. Each rank needs exactly 8." (rank numbered 8 → 1 as the board shows; the board example is rank 2 with 9) |
| side to move `w`/`b` | "Not a legal FEN: the side to move must be w or b." |
| exactly one king each | "Not a legal FEN: each side needs exactly one king." |
| no pawns on ranks 1 or 8 | "Not a legal FEN: pawns can't stand on the first or last rank." |
| the side not to move is not in check | "Not a legal position: the side not to move is in check." |
| chess.js `validateFen` (castling, en passant, counters) | chess.js's own error text, prefixed "Not a legal FEN: " |

Valid → the hint "{White|Black} to move · checked with chess.js". The client imports `chess.js` lazily on the positions page only.

### 8.11 Time class, labels and ratings

- **Pool** from the clock with `poolFor()` (`PKG/game-core/src/time-control.ts`, P2/P9; Lichess bands, DM §11.6): `estimate = initial + 40 × increment`; < 180 s bullet, < 480 s blitz, < 1500 s rapid, else classical. 3+2 → 260 s (Blitz), 5+3 → 420 s (Blitz), 10+0 → 600 s (Rapid). Label = "Blitz 5+3".
- **Rating** for the seed (at join) and for pairing (from the token): P9's effective rating for the pool: `PlayerRating(userId, pool).rating` (Glicko-2) → the linked Chess.com/Lichess rating for the pool (P4) → 1500. Tournament games are rated in that pool with P9's **`GAME` Glicko preset** (CF 10.18.3) when P9's rated-by-default rule holds (O12-7); P9's `applyRatings` clause runs in the same finish statement. "BLITZ +11" on results is Σ `game_players."ratingDelta"` over the participant's tournament games.

### 8.12 Top board (`WS/src/tournaments/TopBoard.ts`)

- **Choice:** among the tournament's live games, the one containing the best-ranked player (lowest mirror rank; unknown rank = after everyone known); ties → the higher combined score, then the earlier start. Re-evaluated on `game_started`, `game_ended` and every delta.
- **Emit:** on a change of top game, and on each move of the top game, throttled to ≤ 1 per second (trailing emit so the final position is always sent). Payload `TopBoardView` ≈ 300 B.
- **Hook:** subscribes to P2's `onGameMove(ref)` / `onGameEnded(ref)` for the current top game only.

### 8.13 Search exclusivity and maintenance (`WS/src/tournaments/TournamentRuntime.ts`)

- **Newest search wins** (D12-16): `find_match` calls P9's `queue.leave(userRef, "moved")` (P9 emits `queue:moved` to the queue tab) and removes the user from every other arena pool (`search_ended { reason: "moved" }` there). P9's `queue:join` handler calls `arenaPools.removeUser(userRef, "moved")` (the additive edit in §3.4).
- **Maintenance** (P11 D10): the socket already holds the latest `system:notice` from P11's `POST /internal/broadcast`. While a notice is active with `affects` containing `online` or `all`, `find_match` answers `maintenance`, the pairer pauses, current searchers get `search_ended { reason: "maintenance" }`, and running games continue (P11 D10). INT-10 and TOU-4a also declare `area: "online"`, so the HTTP side agrees.

---

## 9. Performance and optimization

### 9.1 What changes in cost (a 30-player, 60-minute 5+3 arena, ≈ 110 games)

| Item | Today | After P12 |
|---|---|---|
| HTTP while searching | `find-match` POST every 2–4 s per searcher, each a locking write transaction (`find-match/route.ts:100-183`): ≈ 20 requests per searching minute per player → ≈ 4,000 invocations per arena | **0** (socket command) |
| Lobby and leaderboard refresh | every client refetches `GET /api/tournament/[ref]` (5–8 round trips, up to 100 participants + all live games) on every event, debounced 2 s (`useTournamentLobby.ts:89-99,137-141`): 30 clients × ≈ 110 game events ≈ 3,300 invocations | standings deltas ≤ 450 B over the socket; a snapshot refetch only on a version gap |
| DB statements per game | ≈ 4 + 6–9 per find-match poll + ≈ 8 at game over (blind increments) | INT-10 ≈ 4 statements per **batch** of pairs (≈ 2 per game at 2 pairs a batch) + `createLiveGame`'s 2 inserts per game; scoring adds **0 statements** (it is a clause of P2's finish) |
| Neon wake-ups when no tournament runs | GETs write; `autoComplete…` on every view | none: no timer polling (D12-10); the schedule re-sync is a Data Cache hit; reminders are future-dated rows the worker wakes for only when one is due |
| Vercel invocations per arena (est.) | ≈ 7,500 | ≈ 380 (page loads ≈ 150, INT-10 ≤ 110, joins 30, INT-9/11a/11b and WS-7 pushes ≈ 10, TOU-6 gap refetches ≈ 20, admin ≈ 60); no INT-6, INT-11c or INT-12 calls |

### 9.2 Database budget per endpoint (server time targets from OPT §2.1 classes)

| Endpoint | Class | Statements after auth | Index | p50 / p95 target |
|---|---|---|---|---|
| TOU-1 (CDN MISS and Data Cache MISS) | R1 | page 1: 2 (counts, page); later pages: 1 | `tournaments_visibility_status_scheduledStartAt_idx` / `tournaments_finished_idx` | 25 / 100 ms; a HIT costs 0 |
| TOU-2 | R2 | 2 (tournament + positions + host with `relationJoins`; top-board hint) | slug key, `tournament_positions_pkey`, `games_tournament_live_idx`, rank idx | 45 / 160 ms |
| TOU-3 | R1 | 1 | `tournament_participants_tournamentId_userId_key` prefix | 25 / 100 ms |
| TOU-4a join | W2 | 1 read (rating) + 1 transaction (2 statements; + 1 reminder insert with P10) | slug key, unique `(tournamentId, userId)` | 80 / 250 ms |
| TOU-6 | R1 | 1 (window CTE) | `tournament_participants_rank_idx` | 25 / 100 ms |
| TOU-7 | R1 | 3 in `Promise.all` | rank idx, unique, `games_tournament_live_idx` | 25 / 100 ms |
| TOU-11 | P / R1 | 1 PK read (`finalStandings`) | slug key | HIT ≈ 0 |
| TOU-11m | R2 | 2 | unique, `game_players_tournament_idx` | 45 / 160 ms |
| INT-10 (batch ≤ 8) | I | 1 transaction: 3 reads + 2 inserts per game | slug key, unique, `games_tournament_live_idx` | 15 / 80 ms server; ≤ 500 ms end to end from Mumbai |
| Finish clause (socket, direct) | I | +0 statements; +3 index lookups and 2 row updates inside P2's statement | slug PK, unique `(tournamentId, userId)` | +2 ms p95 in Neon; the round trip is unchanged |
| Mirror load (socket, direct) | I | 1 per tournament per process | `tournament_participants_rank_idx` | ≈ 230 ms from Mumbai, once |
| INT-11b finalize | I | 1 transaction, 4 statements (≤ 256 rows) + 1 jobs insert | rank idx | 30 / 150 ms |
| ADM-1 (cache MISS) | R2 | 1 (13 scalar subqueries) | seq scans over small tables | 60 / 250 ms; cached 60 s |
| ADM-3a | R2 | page 1: 2 (page, cached count); later pages: 1 | `chess_positions_status_idx`, seq scan for `q` | 45 / 160 ms |

**Query plan checks.** On the perf branch (DM §13.6: `--scale 100` plus 200 seeded tournaments with 256 participants each), run `EXPLAIN (ANALYZE, BUFFERS)` for TOU-1 (all tabs), TOU-2's hint, TOU-6, TOU-7, the join transaction, INT-10, the finish statement with the tournament clause and the mirror load; record the plans in `REPO/perf/explain/phase-12.md`. Acceptance: no Seq Scan on `tournament_participants` or `games`; standings top 50 < 1 ms execution. The CI index-existence check (CA §5) gets the six P12 index names.

### 9.3 Caching layers

| Layer | What | Key / tag | Invalidation |
|---|---|---|---|
| Vercel CDN (`public-short`, `public-static`) | TOU-1, TOU-2, TOU-3, TOU-6, TOU-11, TOU-12 | full URL; `Vercel-Cache-Tag` per §7.2 | `invalidateByTag()` from `after()` on lifecycle writes; the short TTLs cover counts |
| Next Data Cache (`unstable_cache`) | `listTournaments(tab, cursor)` (15 s, `tournaments:list`), `getTournamentSnapshot(slug)` (30 s, `tournament:<slug>`), `getResults(slug)` (3600 s, `tournament:<slug>`), INT-9 schedule (3600 s, `tournaments:schedule`), admin metrics (60 s, `admin:metrics`) | function key + args | `revalidateTag()` in `after()` |
| React `cache()` | `getViewer()`, `getTournamentSnapshot()` within one request (layout + page) | per request | — |
| Module memo (per instance) | ADM-11 health (15 s), admin position count (60 s) | env | time |
| Socket memory | pool, standings mirror (all participants), top board, timers, P10 block cache (60 s) | per tournament | lifecycle events, emits, finish results |
| TanStack Query | §5.1 | `qk.*` | §5.4, §5.7 |
| Service worker (P11) | never caches `/api/*`; `/admin` chunks excluded from the precache (CDL §7.1) | — | — |

The gap refetch passes `minVersion=<n>`: the DAL bypasses the Data Cache when the cached version is below `n`, and the URL differs from the cached one, so the CDN misses once per version; every other client asking for the same version within 5 s gets the CDN copy (the post-restart crowd costs one origin hit, CA AP-25).

### 9.4 Payload budgets (uncompressed JSON; gzip roughly ÷ 4)

| Payload | Budget | Contents |
|---|---|---|
| TOU-1 page (20 cards) | ≤ 9 KB | ≈ 420 B per card (FEN, names, 5 avatars) |
| TOU-2 snapshot | ≤ 6 KB | card + ≤ 10 positions + hint (no standings) |
| TOU-6 page (50 rows) | ≤ 9 KB | ≈ 170 B per row |
| TOU-11 results (256 rows max) | ≤ 45 KB (typ. 31 rows ≈ 6 KB) | frozen standings |
| TOU-11m | ≤ 6 KB | ≤ 30 game rows |
| Socket events | §7.7 budget column | asserted in `CT/socket/test/size.test.ts` |
| `tournament:watch` ack | ≤ 600 B | — |
| ADM-3a page (50 rows) | ≤ 15 KB | no explanation JSON |
| INT-9 response | ≤ 20 KB | ≤ 30 tournaments × ≤ 10 positions |

### 9.5 Bundles (First Load JS, gzip, from `next build`; CDL budgets, blocking from P1)

| Route | Budget | Notes |
|---|---|---|
| `/tournaments` | shared ≤ 200 kB + route ≤ 25 kB | `MiniBoard` SVG, tabs, listbox. No board engine, no `chess.js`, no zod response schemas (`devSchema()`) |
| `/t/[slug]` | shared + route ≤ 45 kB | P2's `Board` (read-only) is already in a shared chunk with `/game`; `@tanstack/react-virtual` loads through `next/dynamic` only above 200 rows (CA §2.10) |
| `/t/[slug]/join`, `/results` | shared + ≤ 20 kB | — |
| `/admin/*` | not budgeted (admin only), but `chess.js` is a dynamic import on `/admin/positions`, the admin zod schemas stay in admin chunks, and the presign code never ships to the client | excluded from the SW precache |

### 9.6 SLOs and how they are measured (server-side first, CA AP-15 and AP-35)

| SLO | Target | Metric and source |
|---|---|---|
| Find Match ack → `tournament:paired` emitted, with an eligible opponent already searching | p50 ≤ 1.2 s, p95 ≤ 2.0 s (≤ 1 s tick + INT-10 round trip) | socket metric `ws.tournament.find_to_paired_ms` (server clock, both ends on the socket); exposed in `/internal/metrics` as `findToPairedP50Ms`; k6 `tournament_find_to_paired_ms` as the end-to-end check |
| Finish statement commit → `standings_delta` emitted | p95 ≤ 50 ms | `ws.tournament.delta_emit_ms`; k6 `standings_delta_lag_ms` (event `at` vs the game's `result.endedAt`) end to end ≤ 800 ms p95 |
| Top board lag behind the real game | ≤ 1.2 s p95 | `ws.tournament.top_board_lag_ms` (emit time − move apply time) |
| Scheduler timer accuracy (start, `ending_soon`, finalize) | ≤ 1 s late p99 | `ws.tournament.timer_drift_ms{kind}` |
| Pair tick cost | ≤ 2 ms for 100 searchers | `ws.tournament.pair_tick_ms` |
| Socket loop lag with a 64-player arena + its games | p99 ≤ 50 ms on the 1-OCPU dev box | `ws.loop_lag_ms` during the k6 run |
| HTTP requests while searching | 0 | k6 `http_reqs{phase:searching}` and the Vercel logs |
| Neon statements per arena game (tournament share) | ≤ 6 beyond P2's checkpoint and finish statements | `pg_stat_statements` delta on the dev branch before and after the k6 run ÷ games played |
| Arena page CWV (mobile p75) | LCP ≤ 2.5 s, INP ≤ 100 ms, CLS ≤ 0.02 | Speed Insights at P1's sample rate (0.2 on Hobby, CF F-VER-5) + Lighthouse CI on `/t/<seeded live slug>` (lab) |
| List page | LCP ≤ 2.5 s mobile, TTFB ≤ 600 ms US | same |

PostHog carries funnels only (§10.1), because client events are consent-gated after P11 (CA AP-15).

### 9.7 Performance tests

- `REPO/perf/k6/src/scenarios/tournament.ts` (rewritten for protocol v2): `setup()` creates an arena through ADM-8b as the E2E admin and starts it through TOU-9a; 64 VUs join (a thundering herd within 30 s), `watch`, then loop `find_match` → play a short scripted game through P2's commands → repeat until `endsAt`; one extra VU per 8 only watches (checks deltas and the top board). Thresholds: the SLO rows above with `abortOnFail` on the hard ones, `http_req_failed < 1 %`, `ws_errors = 0`, and 0 duplicate pairings (no user in two live games: checked in `teardown()` through the admin API). Results go to `REPO/perf/results/p12-tournament-<sha>.json` and `perf/compare.ts` (CTe X18).
- **The 256-player run** (CF 10.18.1, D12-18): the same scenario at 256 VUs with `TOURNAMENT_MAX_PLAYERS=256` on the dev deployment only for the run. Pass = every SLO row above, loop lag p99 ≤ 50 ms and RSS growth ≤ 150 MB on the 1-OCPU dev socket box. Only then does the production cap go to 256 (owner decision O12-15); until then it stays 64.
- k6 `tournament-join-race.ts`: 50 VUs join a cap-32 arena at the same instant → exactly 32 × 201, 18 × 409 `tournament_full`, `participantCount = 32`, `joinOrder` 1…32 with no gaps or duplicates.
- **Where and how often:** against the dev deployment and the dev OCI box only (never prod), after the Neon dev split (CA AP-01). Each scenario runs once per phase; the Vercel and Neon usage is recorded before and after, and the run stops if any Hobby quota passes 60 % (CF F-VER-2, OPT §9.6).

---

## 10. Telemetry

### 10.1 PostHog events

Names are `area_object_action` and are registered with zod property schemas in P1's event registry (`packages/analytics/src/events/tournaments.ts`, `…/admin.ts`, CTe X6); every client event carries `{ device, member_state, app_env }` (acct §1.6). No PII: usernames are public and allowed; emails, FENs and free text never. Server events use `posthog-node` from `after()` with `distinct_id = viewer.ref`. P9 owns `match_found` and `find_match_*`-style quick-match names, so the arena events are prefixed `arena_` (CS R-18).

| Event | Where | Properties |
|---|---|---|
| `tournaments_viewed` | list mount | `tab`, `count`, `signed_in` |
| `tournament_selected` | list selection | `slug`, `phase` |
| `tournament_cta_clicked` | aside CTA | `cta` (`enter_arena`, `open_lobby`, `join`, `see_results`, `watch`, `renew`), `phase` |
| `tournament_invite_paste_opened` | invite dialog | — |
| `tournament_invite_opened` | join page mount | `state`, `signed_in`, `entitled`, `has_inviter` |
| `tournament_join_clicked` | join button | `from` (`invite`, `lobby`, `arena_late`, `list`) |
| `tournament_joined` (server) | TOU-4a success | `slug`, `via` (`invite`, `lobby`, `arena_late`, `list`), `late_entry`, `players_after`, `visibility` |
| `tournament_join_failed` | client | `code` (`tournament_full`, `registration_closed`, `invite_required`, `paywall`, `maintenance`, `error`) |
| `tournament_invite_paywall_clicked` | paywalled CTA | `variant` (`renew`, `trial`) |
| `tournament_lobby_viewed` | lobby mount | `joined`, `host`, `seconds_to_start` |
| `tournament_invite_copied` | Copy | `from` (`lobby`, `admin`) |
| `tournament_left` | leave or leave arena | `from` (`lobby`, `arena`) |
| `tournament_started` (server) | INT-11a / TOU-9a | `slug`, `players`, `by` (`schedule`, `host`, `admin`), `delayed`, `seconds_early` |
| `tournament_cancelled` (server) | INT-11a / ADM-8e | `slug`, `reason`, `players` |
| `tournament_arena_viewed` | arena mount | `participant`, `phase` |
| `arena_find_match_clicked` | Find Match | `from_game_over` |
| `arena_paired` | `tournament:paired` | `wait_ms`, `rating_gap` |
| `arena_search_cancelled` | cancel | `wait_ms` |
| `arena_search_ended` | `search_ended` | `reason` |
| `tournament_top_board_watch_clicked` | Watch | — |
| `tournament_late_join_clicked` | not_participant CTA | `minutes_left` |
| `tournament_game_finished` | game-over card | `points_awarded`, `fire`, `rank`, `of` |
| `game_over_cta` (P2's event, reused) | card CTAs | `cta` gains `find_match`, `back_to_arena`, `see_results` |
| `tournament_finished` (server) | INT-11b, one per participant who played | `slug`, `rank`, `of`, `games`, `score` |
| `tournament_finalized` (server) | INT-11b | `slug`, `players`, `games`, `forced`, `duration_min` |
| `tournament_results_viewed` | results mount | `placed`, `rank`, `pending_analyses` |
| `tournament_review_games_clicked`, `tournament_next_clicked` | results | — |
| `admin_dashboard_viewed` | admin | `health_socket`, `health_analysis` |
| `admin_quick_action_clicked` | admin | `action` |
| `admin_action` (server) | every ADM write | `action` (the audit action, e.g. `admin.position_updated`, `tournament.created`, `moderation.report_resolved`), `entity`, `fields` (names only), `ok` |
| `admin_position_fen_invalid` | positions editor | `rule` (§8.10 check name) |
| `admin_tournament_create_failed` | client | `code`, `fields` (names only) |

**Funnel:** `tournament_invite_opened` → `tournament_joined` → `tournament_arena_viewed` → `arena_paired` → `tournament_game_finished` → `tournament_results_viewed`.

### 10.2 Sentry

- **Spans:** every route through the wrapper (`api <id>`, tags `route`, `class`, `status`). Internal routes are sampled at 1.0 for INT-10, INT-11a/b (money-like correctness), 0.1 otherwise. Socket spans `tournament.pair_batch` (sampled 0.1), `tournament.scheduler.fire{kind}` (1.0), `tournament.mirror.load` (1.0), joined to web traces through `sentry-trace`/`baggage` on internal calls (API §2.13).
- **Metrics (socket):** `ws.tournament.pool_size{slug}`, `ws.tournament.find_to_paired_ms`, `ws.tournament.pair_tick_ms`, `ws.tournament.pairings{result}`, `ws.tournament.delta_emit_ms`, `ws.tournament.top_board_lag_ms`, `ws.tournament.timer_drift_ms{kind}`, `ws.tournament.delta_reordered`, `ws.tournament.mirror_reload{reason}`, `ws.tournament.finalize_forced`, `ws.tournament.watchers{slug}`. **Metrics (web):** `api.tournament.join{result}`. If the Sentry metrics API is not available on the free plan (CF §2.5 [V]), the same numbers are read from `/internal/metrics` by the weekly ops workflow.
- **Captured errors:** INT-10 failures other than the expected codes, finish statements whose tournament clause errored (with `gameRef` and `slug` tags, never user ids), schedule-push failures (WS-7) after retries, R2 presign failures, `invalid_payload` on any tournament socket command.
- **Alerts:** pairing failure rate > 5 % over 10 min; any `finalize_forced`; scheduler drift p99 > 5 s; `mirror_reload{reason: "gap"}` > 3 in 10 min; an ACTIVE tournament with `endsAt + maxGameSec + 10 min` passed and no `finalizedAt` (the daily backstop logs a warning when it acts); WS-7 push failing 3 times in a row.

### 10.3 Audit log writes (P4's `WEB/lib/audit.ts` `audit(tx | null, entry)`)

| Action (`category`) | Writer | `meta` |
|---|---|---|
| `tournament.created`, `tournament.updated`, `tournament.cancelled`, `tournament.duplicated` (`TOURNAMENT`, actor ADMIN) | ADM-8 | `{ slug, name, fields? }` |
| `tournament.started`, `tournament.delayed`, `tournament.finalized` (`TOURNAMENT`, actor SYSTEM or ADMIN) | INT-11a/b, TOU-9 | `{ slug, name, players, games? }` |
| `admin.position_created`, `admin.position_updated`, `admin.position_archived` (`CONTENT`) | ADM-3/4 | `{ title, fields }` |
| `admin.legend_created`, `admin.legend_updated`, `admin.legend_portrait_replaced` (`CONTENT`) | ADM-6b/7 | `{ name, fields, licence? }` |
| `moderation.report_resolved`, `moderation.user_suspended` (`MODERATION`) | ADM-13/14 | `{ action, targetType }` / `{ suspended }` |
| `account.created` (`ACCOUNT`, actor WEBHOOK) | P1's Clerk webhook `user.created` handler (one added line) | `{ signupSource }` |
| `billing.payment_failed` (`BILLING`, actor WEBHOOK) | the Dodo webhook `payment.failed` branch (one added line) | `{ username? }` |

`targetType`/`targetId` hold a slug or ref, never an email (DM §3.15). Rows are kept 400 days (DM D15).

---

## 11. Security, privacy, paywall and authorization

### 11.1 Authorization matrix

| Action | Anonymous | Signed-in non-member | Member | Lapsed | Participant | Host (`hostUserId`) | Admin | Internal |
|---|---|---|---|---|---|---|---|---|
| List, snapshot, standings, participants, results, invite preview (TOU-1/2/3/6/11/12) | ✓ (D12-9) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| `GET /me`, `/results/me`, `/api/me/tournaments` | 401 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Join (TOU-4a) | 401 | 402 `subscription_required {reason: trial_available}` | ✓ | 402 `subscription_required {reason: trial_used \| expired}` | 200 (already) | ✓ | ✓ (paywall bypass) | — |
| Leave (TOU-4b, lobby) | 401 | ✓ (own row) | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| `tournament:watch` | no socket | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| `tournament:find_match` | no socket | `not_member` | participant only | `not_member` | ✓ | ✓ if participant | ✓ if participant | — |
| Spectate a tournament game | — | — | ✓ (tournament games are public, acct Q11) | — | ✓ | ✓ | ✓ | — |
| Start / End (TOU-9) | 401 | 403 | 403 | 403 | 403 | ✓ | ✓ | — |
| `/admin/*` pages and `/api/admin/*` | redirect / 401 | 403 | 403 | 403 | 403 | 403 | ✓ (DB role) | — |
| Admin archive, cancel with participants, suspend | — | — | — | — | — | — | ✓ + Clerk reverification | — |
| `/api/internal/tournaments/*` | 401 | 401 | 401 | 401 | 401 | 401 | 401 | ✓ `verifyInternal` |
| Socket `/internal/tournaments/schedule`, `/internal/metrics` | 401 (Caddy pre-check) | — | — | — | — | — | — | ✓ `verifyInternal` |
| Test hooks TH-1, TH-2 | 404 in production; `x-e2e-token` elsewhere | | | | | | | |

The generated authz test (`WEB/test/authz/authz-matrix.ts`, CTe X1 layout) gets one row per new route; a route without a row fails CI.

### 11.2 Middleware and pages

- Route classes are data (CF §7): `WEB/lib/routes/classes/tournaments.ts` adds the public paths `/tournaments`, `/t/:slug`, `/t/:slug/join`, `/t/:slug/results`, `/join-tournament/:code`, `/tournament/:ref`, and GET `/api/tournaments(.*)`, `/api/tournament-invites/(.*)`. If the owner declines O12-6, these move to the member class, and the `free`/`paywalled` states become dev-demo-only.
- `WEB/lib/routes/classes/admin.ts`: `/admin(.*)` requires the Clerk claim `role = ADMIN` as a fast path; the layout and every page re-check the DB role (`requireAdminPage()`), and the APIs check it in the wrapper. The claim is never trusted alone (API §2.11.4).
- Lobby, live and join pages set `robots: { index: false }` in `metadata` (no response headers from RSC, CA AP-14); results of public tournaments are indexable (they read like event pages) — the owner may flip this (O12-6).

### 11.3 Specific protections

- **Capacity and double join:** one conditional `UPDATE` with the cap in the `WHERE` plus `ON CONFLICT DO NOTHING` (§7.2); tested with a 50-way race (§9.7, §12.2).
- **Double scoring:** impossible by construction: scoring is a clause of P2's conditional finish (runs once) and is skipped after `finalizedAt` (§8.1).
- **Double booking:** participant row locks + the live-game check in INT-10; the socket also refuses `find_match` for a user with a live game.
- **Spoofed invites:** the code is the access check (exact match in the join `WHERE`); the inviter tag is HMAC-signed, compared timing-safe, and display-only. The code is never in a public payload.
- **Internal endpoints:** every hop goes through `CT/internal/auth.ts` (D12-15); per-caller keys and the per-caller event allow-list on `/internal/emit` (CA AP-44); the Caddy allow-list exposes only the listed `/internal/*` paths and drops unsigned requests before Node (CF SEC-8; closes the class of bug behind AS F-06).
- **No ids in payloads:** socket commands carry only `slug`; identity comes from the token (P2). Events expose user refs and public display names only (`joinOrder` is a small ordinal, not an id).
- **Rate limits:** join 10 / 60 s per user (burst); participant search uses P1's `search` bucket; uploads 20 / 3600 s per admin (`store: "durable"`, CA AP-11); socket `find_match` 1 per 2 s, `watch` 10 per 10 s.
- **Input limits:** names ≤ 100, descriptions ≤ 280, bios ≤ 500, blurbs ≤ 280, FEN ≤ 100 chars, positions ≤ 10, participants ≤ `TOURNAMENT_MAX_PLAYERS`, `maxBodyBytes` 16 KB on all P12 routes.
- **Uploads:** only `image/jpeg|png|webp`, ≤ 2 MB after client processing, signed `content-type` and `content-length`, 5-minute URL expiry, key under `legends/<legendRef>/`, the saved URL must start with that prefix and the object must exist (`HEAD`). The client converts to a grayscale 512 px JPEG; the server does not process images. Every portrait records its source and licence (CF LIC-6).
- **Test hooks:** registered and guarded as in §7.12; `E2E_TEST_TOKEN` and `ALLOW_TEST_HOOKS` must not exist in the production Vercel project (P13 checklist).
- **Admin safety:** suspend refuses self and the last admin; cancel, archive and suspend need reverification within 10 minutes; every write is audit-logged with the actor.

### 11.4 Privacy

- Standings show `displayName` and (from P10) `username`; private profiles still appear in tournament standings and the top board (acct Q11, a public context), but their profile link renders as plain text.
- Account deletion (P10's service): lobby and active participations are deleted (with the warning in the deletion preview; a hosted upcoming tournament blocks deletion with P10's `hosting_tournament`); finished standings keep the `displayName` snapshot and `userId` becomes NULL (P10's FK swap, C3). Finalize writes the snapshot, so it exists before P10's deletion flow runs. The deleted user shows as "Deleted player" (tested end to end, §12.4).
- `audit_logs` and PostHog never contain emails; the activity feed shows usernames or "a member".
- Blocks (P10): blocked pairs are never paired and the inviter line is hidden for a blocked inviter.
- Living legends: the portrait licence policy is an owner decision (O12-16); the admin form records the licence for every portrait.

### 11.5 Paywall rules in this phase

- Read access per D12-9 (owner decision O12-6). Join, Find Match and spectating need `isEntitled()` (or admin). A member whose membership lapses mid-arena may finish the current game (P2 rule) but `find_match` then answers `not_member` (from the refreshed token) and the arena shows the `free` copy in the pairing card.
- 402 routing is P11 D18 everywhere (renew sheet or `/pricing?reason=ended`; `paywallUrl()` for trial-eligible visitors). Checkout returns to the join URL with `autojoin=1` (§5.3), and to the arena for late entry.

---

## 12. Testing

Runners and layout as set up in P1 (CTe X1): `node:test` via `tsx`; unit tests sit beside the source as `*.test.ts`; DB-backed tests are `*.int.test.ts` against a local Docker Postgres 17; route, contract and authz tests live under `WEB/test/{api,integration,authz}/`; every file is picked up by the `test:unit` / `test:int` globs and `check-test-globs` fails CI otherwise. Playwright main config (`WEB/e2e/specs/**`) with the paywall **on** (CTe X3), the console guard (CTe X7) and the telemetry sink (CTe X6); the device × zoom config (`playwright.devices.config.ts`, 8 base devices × 80/100/110/125/150 %). Every spec carries `@p12`, 4 of them carry `@smoke`, and every spec that reaches a design state tags it `@state:<Board>.<value>` (real data) or `@demo:<Board>.<value>` (demo route) for the state-coverage check (CTe X8, X11).

**Where the suites run** (CTe X2, CF F-VER-3): `ci.yml` (unit, integration, contracts, `e2e-smoke`) on every push to `dev`; `nightly.yml` runs the full main and device suites in CI against `next build && next start` with Docker Postgres and the socket server from source; the deployed dev URL gets only the `@smoke` subset (post-deploy) and one weekly full run, so the Hobby quotas are not spent on test traffic.

**Users** (CTe X4): members A–P are shared and only gain data; Q and R are read-only; the dedicated admin login `E2E_ADMIN_EMAIL` (provisioned with `provision-test-users.ts --admin`, persona file `WEB/e2e/personas/p12.ts`) replaces the first draft's letter S, which stays P1's persona user. Each spec creates its own tournament, so arena pools are isolated per test by construction (no shared queue key is needed). Exact states (lapsed, trial-eligible) come from P1's leased persona pool.

### 12.1 Unit and DB-backed tests

| File | Cases |
|---|---|
| `DOM/tournaments/scoring.test.ts` | every row of the §8.1 table; property test over 1,000 random result sequences: total `score` = Σ per-game points, `fire ⇒ streak ≥ 2`, `streak` resets on every non-win |
| `DB/test/live/tournament-score.int.test.ts` (local Postgres) | the real finish statement with the tournament clause against `scoreResult()` on 1,000 random sequences: identical points, streaks, fire flags, `tournamentPoints`/`tournamentFire`; retry with `finished = 0` scores nothing; a cancelled or finalized tournament scores nothing; two concurrent finishes get versions N+1 and N+2; a finalize racing a finish either scores the game or not, never half (rows and version agree) |
| `DOM/tournaments/phase.test.ts` | `derivePhase` at `lobbyOpensAt − 1 ms` / `+ 0`, `endsAt − 1 ms` / `+ 0`, COMPLETED, CANCELLED; `joinStateOf` for open, starting soon (9:59 vs 10:00 before), late entry, closed (at `lateJoinUntil`), full, cancelled; `adminPhase`, `listTab` |
| `DOM/tournaments/slot.test.ts` | n = 1; n = 5 at each slice boundary; a host start 7 min early; `now` past `endsAt` clamps to n − 1 |
| `DOM/tournaments/ranking.test.ts` | the comparator equals the SQL window order on 500 random fixtures (run through local Postgres in the `.int` twin) |
| `DOM/tournaments/invite.test.ts` | code alphabet and length; tag round trip; a flipped tag character → null; a tag for another tournament → null; a malformed sqid → null; timing-safe compare used |
| `DOM/tournaments/dto.test.ts` | every DTO parses with its zod schema from fixture rows; a deleted user → `{ ref: null, displayName: "Deleted player" }`; no DTO of a public route contains `inviteCode` |
| `WS/src/tournaments/TournamentPairer.test.ts` (fake timers) | window at 0, 3, 6, 90, 400 s (cap 800); longest-wait priority; nearest rating chosen; last-opponent avoidance and the 15 s stall exception; blocks in both directions; colour balance and the seeded random tie; odd player out; a second tab's `find_match` returns the same `since`; 10 s disconnect grace; nothing pairs at or after `endsAt`; 9 pairs → 2 INT-10 calls; partial INT-10 failures (`in_game`, `not_member`) return the other player to the pool with the original `since`; a transport failure retries with the same `clientPairId`; the pool entry is built from token claims and the mirror with no HTTP call |
| `WS/src/tournaments/TournamentScheduler.test.ts` (fake clock) | boot arms from INT-9; T−5 toast fires once to every participant; start at T; delayed then cancelled path; WS-7 host start re-arms and emits `started`; `ending_soon` at `endsAt − 120 s`; finalize triggers (a), (b), (c); a boot in the middle of an ACTIVE arena re-arms everything; the hourly re-sync replaces stale timers; drift is reported |
| `WS/src/tournaments/StandingsMirror.test.ts` | load + buffered joins de-duplicated by ref; apply N+1 after N; a held N+2 released when N arrives; a missing version → reload after 300 ms; `finished = 0` path reloads; ranks equal the comparator; `prevRank` correct for both rows |
| `WS/src/tournaments/TopBoard.test.ts` | best-ranked player's game wins; tie rules; ≤ 1 emit per second with a trailing emit; switches when the top game ends |
| `WS/src/tournaments/exclusivity.test.ts` | `find_match` ends a P9 queue search (`queue:moved`); `queue:join` ends an arena search (`search_ended moved`); a second arena moves the search; a maintenance notice ends searches and refuses `find_match` |
| `WEB/features/tournaments/standings.test.ts` | in-order apply by rank insertion; duplicate ignored; gap → refetch with `minVersion`; a changed row ranked beyond K is dropped; the prefix is truncated to K; the viewer's rank shifts by ±1 in both directions |
| `WEB/features/tournaments/arenaStore.test.ts` | idle → searching → matched → in_game → idle; cancel; `search_ended` per reason; reconnect re-emits `find_match` and keeps the original `since`; auto-navigate only in the visible arena tab |
| `WEB/features/tournaments/copy.test.ts` | button labels Title Case (P1 rule), no exclamation marks, no `replaychess.com`, streak line per streak value |
| `WEB/lib/admin/fen.test.ts` | each §8.10 message; the board's broken FEN (`…/1PP4PP/…`) → "Not a legal FEN: rank 2 has 9 squares. Each rank needs exactly 8."; the board FENs (§12.5) are valid with the right side to move |
| `WEB/lib/admin/activity-format.test.ts` | each action → message and href; unknown action fallback; a property test that no output contains `@` |
| `CT/http/admin.test.ts` | `TournamentCreate` produces the exact field messages; `UploadRequest` square refinement (2 % tolerance); `LegendPatch` requires a licence with a portrait and a source unless `own` |
| `CT/socket/test/size.test.ts` (P2's, extended) | every P12 event at its §7.7 budget with realistic fixtures |
| `WEB/lib/data/admin/metrics.int.test.ts` | the entitlement SQL agrees with `isEntitled()` on 500 generated users (every status × period in the past or future × `cancelAtPeriodEnd`) |
| `WEB/lib/milestones/definitions.test.ts` (P10's, extended) | `TOURNAMENT_PODIUM` awarded for `finalRank` 1–3 only, once per tournament, not before finalize |
| `WEB/lib/test-hooks/registry.test.ts` (P1's) | TH-1, TH-2 and TH-3 are registered; `R2_PRESIGN_MODE=fake` with `APP_ENV=production` refuses to boot |

### 12.2 API contract and integration tests (`WEB/test/api/{tournaments,admin,internal-tournaments}.test.ts`)

- **Authz matrix:** every row of §11.1 for every P12 route (anonymous, non-member, member, lapsed, participant, host, admin, valid internal signature, forged signature, expired timestamp).
- **Envelope:** malformed JSON → 400 `invalid_json`; a body over 16 KB → 413; unknown body fields → 400; 429 carries `Retry-After`; responses validated against their schemas (`ROUTE_VALIDATE_RESPONSES=1`); public routes return the same bytes for two different viewers (CA AP-03 guard).
- **Join:** 50 concurrent joins on a cap-32 arena through the service → exactly 32 rows, `participantCount = 32`, `joinOrder` 1…32; double join → 200; invite-only without a code → 403 `invite_required`, with it → 201; late entry before and after `lateJoinUntil` (`x-rc-now`); non-member → 402 `subscription_required` with the right `reason`; with P10 present, one `TOURNAMENT_STARTING` row and one `NOTIFY_DISPATCH` job per join; 503 `maintenance` under an `online` notice.
- **Leave:** decrements in the lobby, skips the reminder; 409 after the start.
- **Start / end:** host vs non-host vs admin; 1 participant → 409 `not_enough_players`; a second start → 409; end twice → 409 `already_ended`; an early start skips the reminders.
- **INT-10:** a batch succeeds and writes `games` + both `game_players` rows; one pair `in_game`; a retry with the same `clientPairId` returns the same game; after `endsAt` → `ended`; a lapsed player → `not_member`; colours and `tournamentPositionOrder` written; the `LiveGameRecord` shape equals `loadLiveGame()`'s.
- **Lifecycle:** INT-11a `started` / `delayed` (reminders moved) / `cancelled` (reminders skipped) / `noop`; INT-11b is idempotent, `finalStandings` equals the final order, and the podium milestone jobs exist; the daily backstop finalizes an overdue arena and cancels a stale lobby.
- **Reads:** TOU-6 order equals the SQL order; TOU-7 `in_game`; TOU-11m best game and rating delta; TOU-12 inviter shown only for a valid tag; TOU-1 never lists invite-only tournaments and returns `counts` only on page 1; no GET issues a write (the wrapper's GET-purity check, CA §5).
- **Admin:** ADM-3/4 FEN invalid → 422 `illegal_position`, duplicate → 409 with the existing ref, stale `If-Match` → 412, archive sets `isActive = false` and removes the position from P8's public list query; ADM-9 signs `content-type` and `content-length`, rejects a wrong type; ADM-7 rejects a portrait URL outside the legend prefix, a missing object and a missing licence; ADM-8b replays on the same `Idempotency-Key`, answers 422 `idempotency_key_reused` for a different body, rejects a start under 10 minutes, unpublished positions and a cap above `TOURNAMENT_MAX_PLAYERS`; ADM-14 refuses self (403) and the last admin (409); ADM-1 numbers on seeded data.
- **Test hooks:** TH-1 and TH-2 answer 404 without `ALLOW_TEST_HOOKS` or without the token, and in the production-mode build (`prod-guard.spec.ts`).
- **Socket integration** (`WS/test/tournaments.int.test.ts`: in-process server, `socket.io-client`, a stub HTTP server for the internal routes, local Postgres for the direct writes): watch ack shape; two clients searching → both receive `tournament:paired` on their own `user:` rooms and **no other socket receives it** (regression for the room-wide `emitMatchFound`, AS F-24); a finished game produces one delta with server ranks; top-board throttle; `find_match` refused for a token with `ent = 0` (`not_member` + reason); drain answers 409 during a live arena unless `force`; killing the server mid-search → the clients reconnect, re-search and pair; suspending the Postgres connection mid-arena (Neon-suspend simulation, CF F-OCI-4) → the next finish retries once and scores once.

### 12.3 End-to-end (Playwright main config, `WEB/e2e/specs/tournaments/` and `WEB/e2e/specs/admin/`)

E2E creates its own data through the admin API as `E2E_ADMIN_EMAIL`, shifts time with TH-1 (and `x-rc-now` for route-level checks), runs the socket with `TIMING_PROFILE=fast` in the per-worker fixture server (P2), and cleans up through TH-2.

| Spec | Steps and assertions |
|---|---|
| `arena.spec.ts` (4 player contexts + admin) `@smoke` | the admin creates an arena; A–D join through the invite UI; A's lobby shows each join within 2 s; the admin starts it; A–B and C–D press Find Match → paired → game pages with the strip; A resigns; C and D agree a draw after 12 moves; a watcher context (the admin) sees two deltas and the top board move; the admin ends the arena; the last game ends → every context lands on results with B 1st (+2), C and D +1, A 0. **Zero requests to any `/api/tournament*` URL while searching** (`page.on('request')`). **Telemetry** (sink): `tournament_joined { via: "invite" }` ×4, `arena_find_match_clicked` ×4, `arena_paired` ×4, `tournament_finished` ×4 with the right `rank`, every event schema-valid and PII-free |
| `arena-fire.spec.ts` | A beats B twice (fast mates from a tactical position) → the third win shows "+4 points · 2× streak" and the 2× badge |
| `early-draw.spec.ts` | a draw by repetition before move 10 → "0 points · early draw (before move 10)"; standings unchanged |
| `join-invite.spec.ts` `@smoke` | `default` → `joined`; `full` (cap 2); `closed` (TH-1); `not_found` (bad code); `paywalled` for user Q (trial used) with the D18 target carrying `autojoin=1`; signed out → sign-in → back to the join page; the inviter line shown only with a valid tag |
| `lobby.spec.ts` | the countdown decreases monotonically; JUST JOINED fades after 6 s; leave; the host starts early; the T−5 toast (TH-1 to 5 min); the admin cancels → redirect with the toast |
| `list.spec.ts` | tab keyboard navigation; selection updates `?t`; empty tabs show the right copy (no alerts link); an invite-only arena is visible only to its participant; a phase flips at the boundary (TH-1) without a reload |
| `game-strip.spec.ts` | strip content; after `endsAt` "ARENA CLOSED · THIS GAME STILL COUNTS"; game-over CTAs; Find Match from the card lands in `searching` |
| `exclusivity.spec.ts` | a quick-match search in tab 1, Find Match in tab 2 → tab 1 shows `queue:moved`; then the reverse |
| `keyboard.spec.ts` (CTe: was manual step 5) | list (tabs, ↑/↓, Enter) → join → lobby (`C`) → arena (`F`, Esc, Enter) → game → results, keyboard only, with focus visible at every step |
| `admin/access.spec.ts` `@smoke` | member A → 403 view; signed out → sign-in; APIs 401/403 |
| `admin/positions.spec.ts` | the invalid-FEN copy and disabled Save; save → toast; New Position → draft row; archive with the confirm (reverification stubbed in the test instance); `admin_action` events carry names only |
| `admin/legends.spec.ts` | edit a bio; portrait upload with TH-3 (`R2_PRESIGN_MODE=fake`); the preview is grayscale; licence required |
| `admin/tournaments.spec.ts` `@smoke` | 4 validation errors and the note "4 fields need attention."; create → created → Open Lobby; the row appears; edit before the start; cancel |
| `admin/dashboard.spec.ts` | the tiles equal the seeded counts; the health card shows a status (or Unknown) |
| `admin/reports.spec.ts` | resolve and dismiss move rows between tabs (skipped when the table is absent) |

**Accessibility (axe, CTe P12 gap):** `@axe-core/playwright` in light and dark on `/tournaments`, `/t/<live>`, the lobby, the join page, results and every `/admin/*` page; zero serious or critical violations. The VoiceOver item stays manual (§12.7).

**Visual baselines (CTe X10):** `toHaveScreenshot` on the `/dev/ui/tournaments` demo routes with a fixed clock, `reducedMotion: "reduce"` and `[data-vr-mask]` on avatars and relative times: `V4Tournaments` `default` and `empty`; `V4TournamentLive` `searching` and `in_game`; `V4TournamentResults` `default`; `V4Admin` `default`; `V4AdminTournamentCreate` `validation` (the 4 errors). Desktop-1440 and iPhone, light and dark (28 images).

**Device × zoom** (`WEB/e2e/devices/layout/tournaments.spec.ts`, all 40 projects in nightly CI; the PR tier runs P1's 4 projects): `/tournaments`, `/t/<live seed>`, `/t/<lobby seed>`, `/t/<finished seed>/results`, `/t/<seed>/join`. Each asserts `document.scrollingElement.scrollHeight <= innerHeight`, the board's bounding box inside the viewport, and the pairing card's primary button visible and ≥ 44 px. Phones also switch the segmented control to Top Board and re-check the board box. At 150 % zoom the secondary lines are hidden. Stress data (`stress=1`: 20-character names, 256 standings rows) runs at `@150` on all devices. Admin pages on `desktop-1440` and `desktop-1280` at 100, 125 and 150 % only. The `/dev/ui/tournaments` demo routes get a smoke render per state on `ui-desktop` and `ui-iphone`. P1's real-route layer adds `/t/<live seed>` signed in as a shared member.

### 12.4 Regression of earlier phases (CTe X11)

The gate is the **whole** main and devices suites on the final SHA with the paywall on (nightly CI plus one run against the dev URL), plus the `flags-off` project with `tournaments-v3` and `admin-v3` off running the earlier phases' `@smoke` specs. Targeted extras:

- P2: the game suite (two-context game, abort, draw, threefold, restart mid-game) green; rematch is never offered in a tournament game; P2's finish integration tests pass with the tournament clause composed in.
- P3: a tournament game is analysed and reviewable; `/games?tournament=<slug>` filters correctly.
- P4: an imported Chess.com/Lichess game never counts toward a tournament (it has no `tournamentId`; asserted on a seeded import).
- P5: if Home lights a "live tournament" slot, it links to `/t/<slug>`; the bank line renders on the tournament result card when P5's slot exists.
- P6: weakness inputs include tournament games like any other rated game (no special case).
- P7: the coach answers on a tournament game's review; the coach line slot renders on the tournament card when P7's swap is on.
- P8: admin position and legend edits show on the public ISR pages after revalidation (`legend:<slug>`, `position:<slug>`); archived positions vanish from the catalogue.
- P9: a quick-match search and an arena search exclude each other (D12-16); quick-match and friend specs green; tournament games update `player_ratings` with the `GAME` preset.
- P10: a deleted user shows as "Deleted player" in finished standings (e2e); the "Tournament starting" row is visible with `tournaments-v3` on and hidden with it off; the podium milestone appears on the profile.
- P11: the maintenance gate with `affects: ["online"]` blocks `tournament:find_match` and arena joins and leaves running games alone; the `sw-on` project is green for the P12 `@smoke` specs.
- P1: the authz matrix, the device suite, `membership.spec.ts` and `paid-only.spec.ts` green (402 on join for R).

### 12.5 Chess-correctness fixtures (`DOM/tournaments/__fixtures__/`, design FENs from `PKG/chess-fixtures/design/`)

- The board FENs, each legal with the side to move the boards claim: Opera Game `rn2kb1r/p3qppp/2p2n2/1p2p1B1/2B1P3/1QN5/PPP2PPP/R3K2R w KQkq - 0 10` (White), Byrne–Fischer `r3r1k1/pp3pbp/1qp3p1/2B5/2BP2b1/Q1n2N2/P4PPP/3R1K1R b - - 3 17` (Black, after 16.Bc5), Tal `rnb1k1nr/p2p1ppp/8/1pbN1N1P/4PBP1/3P1Q2/PqP5/R4KR1 w kq - 0 18` (White), Topalov–Shirov `8/8/4kpp1/3p1b2/p6P/2B5/6P1/6K1 b - - 0 47` (Black, before …Bh3!!), Kasparov–Topalov `b2r3r/k4p1p/p2q1np1/NppP4/3p1Q2/P4PPB/1PP4P/1K1RR3 w - - 1 24` (White, before 24.Rxd4). The admin positions board's broken variant is the invalid fixture.
- Scoring endings as PGN fixtures replayed through `packages/game-core` and then through the finish statement: threefold at ply 12 (early draw, 0), stalemate at ply 18 (early draw, 0), fifty-move at ply 130 (draw, 1), timeout with K+N vs K (`TIMEOUT_VS_INSUFFICIENT`, draw, 1), checkmate at ply 31 on fire (4), abandonment after ply 2 (win, 2).
- The tournament positions used in seeds and the E2E arena are checked by P8's verify route (ADM-5) so the FEN matches the real game score.

### 12.6 Performance checks

The k6 runs in §9.7 (thresholds = the §9.6 SLOs, results as JSON), the `EXPLAIN` set in §9.2 recorded in `REPO/perf/explain/phase-12.md`, the CI bundle report against §9.5, and Lighthouse CI on `/tournaments` and a seeded live arena (mobile profile: Performance ≥ 85, CLS ≤ 0.02).

### 12.7 Manual checklist on the dev site (ego-browser, after the Playwright run)

1. The owner test (§1.3) end to end.
2. Chrome desktop at 80, 110, 125 and 150 % zoom on list, lobby, arena, results and every admin page: nothing scrolls the page; at 150 % the secondary lines are gone.
3. Real iPhone (Safari) and real Android (Chrome): list, join, arena with both segments, a tournament game, results; tap targets; the tab bar never covers the pairing card. Record the device models and OS versions.
4. Dark mode and reduced motion on the arena (the JUST JOINED fade and the top-board move animation respect reduced motion).
5. VoiceOver smoke on the arena: the timer is not read every second; "Your rank: 3rd" is announced once per change; the top board has a label.
6. The Vercel logs show no 5xx and no tournament request during searching; `REPO/scripts/qa/error-window.ts --since <deploy time>` shows no new Sentry issue (CTe X6.7); the PostHog live view shows the §10.1 events with `app_env = dev`; the Neon `pg_stat_statements` delta is recorded.
7. Close every ego-browser page at the end (`task.finish({ keep: [] })`, CTe X15).

### 12.8 Sign-off record and defects (CTe X14, X15)

`REPO/docs/qa/phase-12-signoff.md` is committed with: the SHA, the Vercel deployment id and the OCI image tags; each owner-test row with pass/fail and a screenshot path (`docs/qa/phase-12/`); the device models and zoom levels used; the state-coverage table for the 21 boards; the error-window output for at least 24 h after the last dev deploy; the PostHog live-view result; the k6 result files; and every defect found, each with its failing-first regression test named `regression: <slug> (#issue)`. `WEB/e2e/quarantine.json` has no expired P12 entry.

---

## 13. Work breakdown

Eight work packages. **Strict file ownership:** a file is created or edited by exactly one package. Files owned by an earlier phase are edited **additively only** (new exports, new branches, new rows), and the edit is announced to that file's stream owner for the week (ALLOC §0).

**Shared registries** (CF §7). P12 runs alongside P6/P7 and then P10/P11, so it never edits a shared registry file in place: it adds one file to each registry directory P1 created and appends one line to that directory's barrel. If P1 did not adopt a directory for one of them, the owning WP below edits that single file in one small PR and announces it.

| Registry | P12 file | Owner WP |
|---|---|---|
| query keys | `WEB/lib/api/keys/{tournaments,admin}.ts` | E |
| flags | `WEB/lib/flags/registry/p12.ts` | H |
| route classes (middleware data) | `WEB/lib/routes/classes/{tournaments,admin}.ts` | H |
| redirects | `WEB/config/redirects/p12.mjs` | H |
| cron tasks | `WEB/lib/cron/tasks/tournaments.ts` | C |
| user-room handlers | `WEB/lib/realtime/handlers/tournaments.ts` | E |
| HTTP route registry | `CT/http/registry/{tournaments,admin}.ts` | B |
| E2E personas | `WEB/e2e/personas/p12.ts` | H |
| event registry (analytics) | `packages/analytics/src/events/{tournaments,admin}.ts` | B |
| test hooks | one entry each for TH-1…3 in `WEB/lib/test-hooks/registry.ts` | C |

Estimates are dev-days for one developer working with Claude, tests included. The total is 1.25 days over ALLOC's 17 (scoring clause and mirror work, plus the testing additions the critiques asked for), with a separate 20 % buffer line (CF §8).

| WP | Name | Depends on | Est. |
|---|---|---|---|
| A | Schema, grants, backfill, seed | — | 1.5 |
| B | Contracts and registries | — | 1.0 |
| C | Tournament domain and web API | A, B | 3.0 |
| D | Socket server tournaments and the finish clause | B (C's internal routes for integration) | 3.25 |
| E | Tournament screens | B (fixtures first), C, D for integration | 3.5 |
| F | Game-screen integration | C, D | 1.0 |
| G | Admin console | A, B | 3.0 |
| H | Cutover, E2E, a11y, visual, perf, sign-off | all | 2.0 |
| | **Total** | | **18.25** |
| | Buffer (20 %, not scheduled work) | | 3.75 |

Order: A ∥ B (days 1–2) → C ∥ D ∥ G, with E building against the `/dev/ui/tournaments` fixtures in parallel → F → E integration → H. With parallel agents the calendar is about 9–10 working days; the critical path is A/B → D (finish clause) → E integration → H.

### WP-A · Schema, grants, backfill, seed (1.5 d)

- **Creates:** `DB/prisma/migrations/<ts>_m12a_audit_categories/migration.sql` (only if needed), `DB/prisma/migrations/<ts>_m12_tournaments_admin/migration.sql`, `DB/prisma/migrations/<ts>_m12v_validate_tournament_host_fk/migration.sql`, `DB/src/json/tournament.ts` (+ test), `DB/prisma/seed/tournaments.ts`, `WEB/scripts/backfill/tournaments.ts`.
- **Edits:** `DB/prisma/schema.prisma` (the `Tournament`, `TournamentParticipant`, `TournamentPosition`, `Game`, `GamePlayer`, `ChessPosition`, `Legend` and `User` changes and the two enums; `displayName` only if P10 has not merged), `DB/prisma/protected-indexes.txt` (three names), `DB/sql/roles.sql` (§6.3), `DB/prisma/seed/index.ts` (one call), `DB/prisma/seed/personas.ts` (admin persona role, 30 synthetic players; additive).
- **Acceptance:** `migrate deploy` from scratch on local Postgres 17 and on the Neon dev branch; `roles.sql` applied; the drift gate is green; the generated SQL contains no `DROP`; B7 `--dry-run` on dev prints the counts and the owner confirms the stale-row fix before `--apply`; after the seed, every row of §6.9 exists.

### WP-B · Contracts and registries (1.0 d)

- **Creates:** `CT/http/tournaments.ts`, `CT/http/admin.ts` (+ `admin.test.ts`), `CT/socket/tournament.ts`, `CT/internal/tournaments.ts`, `CT/http/registry/{tournaments,admin}.ts`, `packages/analytics/src/events/{tournaments,admin}.ts`.
- **Edits (additive):** `CT/http/codes.ts` + `codes.test.ts` (§7.1), `CT/socket/codes.ts` (§7.1), `CT/socket/registry.ts` (the 14 event names, CS R-07), `CT/socket/rooms.ts` (`ROOM.tournament` if P2 did not add it), `CT/socket/game.ts` (`GameState.tournament`, `game:result.tournament`), `CT/socket/test/size.test.ts` (budgets), `CT/internal/emit.ts` caller allow-list (`tournament:*` from `web`).
- **Acceptance:** `check-types` across the monorepo; OpenAPI regenerates with no unexpected diff; `docs/api/socket-events.md` lists the new events; ALLOC §5.2 gets `tournament:search_ended` and `tournament:updated`.

### WP-C · Tournament domain and web API (3.0 d)

- **Creates:** `DOM/tournaments/{scoring,ranking,phase,slot,invite,join,pairing,lifecycle,reminders,standings,dto}.ts` with tests and `__fixtures__/`; `WEB/lib/data/tournaments.ts`; `WEB/lib/realtime/tournament-schedule.ts`; route files `WEB/app/api/tournaments/route.ts`, `WEB/app/api/tournaments/[slug]/{route.ts, participants/route.ts, participants/me/route.ts, standings/route.ts, me/route.ts, start/route.ts, end/route.ts, results/route.ts, results/me/route.ts}`, `WEB/app/api/tournament-invites/[code]/route.ts`, `WEB/app/api/me/tournaments/route.ts`, `WEB/app/api/internal/tournaments/schedule/route.ts`, `WEB/app/api/internal/tournaments/[slug]/{pairings,start,finalize}/route.ts`, `WEB/app/api/test/tournaments/[slug]/{route.ts (TH-2), time/route.ts (TH-1)}`; `WEB/lib/cron/tasks/tournaments.ts`; tests `WEB/test/api/{tournaments,internal-tournaments}.test.ts`.
- **Edits:** `WEB/lib/test-hooks/registry.ts` (TH-1…3), `WEB/test/authz/authz-matrix.ts` (rows), P10's `WEB/lib/milestones/definitions.ts` (`TOURNAMENT_PODIUM` row, only if P10 merged; else it lands with P10), P10's `WEB/lib/notify/producers.ts` (no change: P12 calls it).
- **Deletes:** `WEB/lib/services/tournament/{tournament.service.ts, notify-websocket.ts}`, `WEB/app/api/tournament/**` (all of it, including the DELETE).
- **Acceptance:** §12.1 domain units and §12.2 tournament and internal tests pass; §9.2 statement counts verified with Prisma query logging; no GET issues a write; every route has an authz row.

### WP-D · Socket server tournaments and the finish clause (3.25 d)

- **Creates:** `WS/src/tournaments/{TournamentRuntime,TournamentScheduler,TournamentPairer,StandingsMirror,TopBoard,handlers,internalRoutes,internalClient}.ts` and their tests; `DB/src/live/fragments/tournament.ts`; `DB/src/tournaments/loadParticipants.ts`; `DB/test/live/tournament-score.int.test.ts`; `WS/test/tournaments.int.test.ts`.
- **Edits:** `DB/src/live/finish.ts` (compose the clause; delete `tp`; extend `g` `RETURNING` and `gp` `SET`), `WS/src/index.ts` (register the handlers and WS-7), P2's `WS/src/game/{LiveSession,SessionRegistry}.ts` (additive `onGameMove`/`onGameEnded` hooks; `GameState.tournament` in the join ack; `game:result.tournament`), P2's `WS/src/http/{emit,metrics,drain}.ts` (runtime hand-off, tournament counts, `force`), P9's `WS/src/queue/*` join handler (one call, D12-16), `REPO/deploy/oci/Caddyfile` (two paths + the unsigned pre-check), `REPO/.github/workflows/deploy-oci.yml` (`force` input on the drain step), the socket env files documented in `REPO/deploy/oci/README` (the four `TOURNAMENT_*` variables).
- **Deletes:** `WS/TournamentManager.ts`, `WS/src/http/tournamentEvent.ts`, `TournamentLobbyPayload` in `WS/types.ts`, the remaining v1 lobby aliases.
- **Acceptance:** §12.1 socket units, the finish-clause equivalence test and the socket integration test pass; k6 (§9.7) on the dev OCI box meets the §9.6 SLOs at 64 players; a redeploy with `force` during a k6 arena loses no game and every searcher pairs again.

### WP-E · Tournament screens (3.5 d)

- **Creates:** `WEB/app/(app)/tournaments/{page,loading,error}.tsx`; `WEB/app/(app)/t/[slug]/{page,loading,not-found}.tsx`; `WEB/app/(app)/t/[slug]/join/page.tsx`; `WEB/app/(app)/t/[slug]/results/page.tsx`; `WEB/app/tournament/[ref]/route.ts`; `WEB/app/join-tournament/[code]/route.ts`; `WEB/features/tournaments/{queries.ts, useTournamentRoom.ts, arenaStore.ts, standings.ts, copy.ts, fixtures.ts}` + tests; `WEB/features/tournaments/components/{TournamentRow, TournamentAside, TournamentPill, InvitePasteDialog, JoinCard, CountdownTimer, PositionCard, InviteLinkField, LobbyPlayerList, ArenaHeader, PairingCard, TopBoardCard, StandingsList, FireBadge, Podium, ResultSummary, TournamentGamesList}.tsx`; `WEB/lib/api/keys/{tournaments,admin}.ts`; `WEB/lib/realtime/handlers/tournaments.ts`; `WEB/app/dev/ui/tournaments/page.tsx`; `WEB/e2e/devices/layout/tournaments.spec.ts`.
- **Edits (additive):** `WEB/lib/realtime/connection.ts` (the `arena_search` critical hold), P10's `WEB/features/notifications/{ChannelTable,NotifPromptDialog}.tsx` (the `tournaments-v3` condition on the tournament rows).
- **Deletes:** `WEB/app/(app)/tournaments/page.tsx` (legacy content, replaced in place), `WEB/app/(app)/tournament/[tournamentReferenceId]/*`, `WEB/app/(app)/join-tournament/[tournamentReferenceId]/*`, `WEB/lib/hooks/{useTournamentLobby,useSocketToken}.ts`, `WEB/app/components/NavbarTournaments.tsx` (if no other importer).
- **Acceptance:** every state of `V4Tournaments`, `V4TournamentsEmpty`, `V4TournamentJoin`, `V4TournamentLobby`, `V4TournamentLive` (+ 4 device boards), `V4TournamentResults` and the device list boards is reachable from seed data or `/dev/ui/tournaments` and tagged (`@state`/`@demo`); the device × zoom spec is green on all 40 projects; the `setInterval` lint rule passes; keyboard map in the `?` sheet.

### WP-F · Game-screen integration (1.0 d)

- **Creates:** `WEB/features/game/TournamentStrip.tsx`, `WEB/features/game/GameOverTournamentLine.tsx`, `WEB/e2e/specs/tournaments/game-strip.spec.ts`.
- **Edits (additive):** P2's game screen zone slot (render the strip when `state.tournament` is set and no higher-priority zone is active), P2's `GameOverCard` (tournament line and CTAs; hide rematch; the coach and bank slots untouched), P2's `WEB/lib/games/snapshot.server.ts` (`getGameSnapshot` tournament block), P3's `WEB/lib/data/games.ts` (`listMyGames` `tournament` filter).
- **Acceptance:** the `tournament` and `over_tournament` states of `V4TournamentGame` / `V4TournamentGameOver` render from real games; the game-over values equal the `game_players` row; the board stays inside the viewport with the strip on every device project (the strip uses the zone slot).

### WP-G · Admin console (3.0 d)

- **Creates:** `WEB/app/(admin)/admin/{layout,page}.tsx`, `WEB/app/(admin)/admin/{positions,legends,tournaments,reports}/page.tsx`, `WEB/app/(admin)/admin/tournaments/new/page.tsx`, `WEB/app/(admin)/admin/tournaments/[slug]/edit/page.tsx`, `WEB/app/(admin)/admin/forbidden.tsx` (or the component fallback); `WEB/features/admin/components/*` (§4.9); `WEB/lib/data/admin/{metrics,activity,health,positions,legends,tournaments,reports}.ts`; `WEB/lib/services/admin/{positions,legends,tournaments,reports,users,uploads}.ts`; `WEB/lib/admin/{fen,activity-format}.ts` + tests; route files `WEB/app/api/admin/{metrics,health,activity}/route.ts`, `WEB/app/api/admin/positions/{route.ts,[ref]/route.ts}`, `WEB/app/api/admin/legends/[ref]/route.ts` (+ the POST half in P8's `legends/route.ts`), `WEB/app/api/admin/uploads/route.ts`, `WEB/app/api/admin/tournaments/{route.ts,[slug]/route.ts,[slug]/cancel/route.ts,[slug]/duplicate/route.ts}`, `WEB/app/api/admin/reports/{route.ts,[ref]/resolve/route.ts}`, `WEB/app/api/admin/users/[ref]/suspend/route.ts`; `WEB/test/api/admin.test.ts`; `WEB/e2e/specs/admin/*.spec.ts`; `WEB/lib/r2/presign.ts` **only if P10 has not merged** (P10's D11/D12 rules, `aws4fetch`).
- **Edits:** `WEB/app/api/scraper/positions/import/route.ts` (use `upsertPosition()`), P1's Clerk webhook handler and the Dodo webhook (`payment.failed`) (one `audit()` call each), `WEB/next.config.js` only if `experimental.authInterrupts` is adopted (one line, announced).
- **Deletes:** `WEB/app/admin/**` (legacy pages, after parity behind `admin-v3`), `WEB/app/api/chess-positions/{route.ts,[id]/route.ts,create/route.ts}`, `WEB/app/api/legends/{create,[id],search}/route.ts`, `WEB/lib/auth/get-session-user.ts`.
- **Setup task:** confirm P10's R2 token (Object Read & Write on `replay-chess-media`) and CORS rule for `PUT` from the dev and prod origins exist; if P12 merges first, create them (Cloudflare dashboard, through ego-browser). Vercel env vars on the dev project (`TOURNAMENT_INVITE_SECRET`, `TOURNAMENT_MAX_PLAYERS=64`, `ADMIN_HEALTH_TIMEOUT_MS`).
- **Acceptance:** owner test steps 1–4; §12.2 admin tests and §12.3 admin specs green; every admin write produces an `audit_logs` row, an `admin_action` event and the P8 tag purge; the admin chunks are absent from the SW precache.

### WP-H · Cutover, E2E, a11y, visual, perf, sign-off (2.0 d)

- **Creates:** `WEB/e2e/specs/tournaments/{arena,arena-fire,early-draw,join-invite,lobby,list,exclusivity,keyboard}.spec.ts`, the axe and visual specs (`WEB/e2e/specs/tournaments/a11y.spec.ts`, `WEB/e2e/devices/visual/tournaments.spec.ts` + baselines), `REPO/perf/k6/src/scenarios/tournament-join-race.ts`, `REPO/perf/explain/phase-12.md`, `REPO/docs/qa/phase-12-signoff.md`, `WEB/lib/flags/registry/p12.ts`, `WEB/lib/routes/classes/{tournaments,admin}.ts`, `WEB/config/redirects/p12.mjs`, `WEB/e2e/personas/p12.ts`.
- **Edits:** `WEB/e2e/fixtures/tournament-helpers.ts` (rewrite), `WEB/e2e/scripts/provision-test-users.ts` (`--admin` for `E2E_ADMIN_EMAIL`), `REPO/perf/k6/src/scenarios/tournament.ts` (rewrite + the 256-player profile), `REPO/docs/implementation-plan.md` (pointer to this spec), `SP/plan/allocation.md` (§1.6 `admin-v3`, §5.1 C12, §5.2 events, B4 exception), `SP/plan/api-design.md` §4.12–4.14 (pointer to this spec's IDs).
- **Deletes:** `WEB/e2e/specs/tournament.spec.ts`.
- **Acceptance:** the Definition of Done (§15).

---

## 14. Risks, owner decisions, rollback and changes asked of other documents

### 14.1 Risks

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R1 | The sibling plans disagree on tables, rooms and routes; a later reader follows the wrong one | high / medium | §0 is the single resolution for P12; O12-8 asks the owner to approve it; §14.4 lists the edits to the other documents; WP-B encodes the names in contracts, so code cannot drift |
| R2 | P10 has not shipped when P12 starts (no usernames, notifications, milestones or blocks) | medium / low | every P10 dependency is feature-detected (`username: null`, socket-only reminders, no milestone, empty block list); the shared items follow "first to merge creates" (CS R-19) |
| R3 | The 1-OCPU socket box runs games, the queue and tournaments together, and it **cannot be resized for free** after P13 D7 (no Stage B) | medium / high | arenas capped at 64 (D12-18) until the 256-player k6 run passes (§9.7); pairing is O(n log n) per second on ≤ 256 entries; the mirror re-sort is < 0.1 ms; the top board is throttled; a paid step is an owner decision (CF F-OCI-3) |
| R4 | A socket restart or deploy during a live arena | medium / medium | P2's journal and drain; the drain refuses during a live arena without `force`; clients re-emit `find_match`; the scheduler re-arms from INT-9 at boot and the mirror reloads in one statement; the rollback rule in §14.3 |
| R5 | The socket is down at a scheduled start or end | low / medium | the start happens at boot (conditional, so `endsAt` is computed from the real start); the daily backstop finalizes overdue arenas and cancels stale lobbies |
| R6 | Clock skew between Vercel, Neon and OCI | low / low | lifecycle times come from Neon `now()` inside the internal routes; the socket arms timers from returned timestamps; clients use the `serverNow` offset |
| R7 | Neon compute hours burned by tournament traffic, or by dev and test traffic on the shared project | low / high | no polling anywhere (D12-5, D12-10); reminders are future-dated rows; public reads behind the CDN and Data Cache; the statement budget is checked in k6; k6 and E2E start only after the Neon dev split (CA AP-01) |
| R8 | Small arenas stall (2–3 players keep meeting each other) | medium / low | the 15 s rematch exception (§8.2); the "Few players are searching" copy |
| R9 | Score farming (early draws, collusion between friends) | low / medium | the early-draw rule; the optional draw-streak rule (O12-5); admins can cancel; the Reports queue |
| R10 | The 18 legacy tournaments have stale LOBBY/ACTIVE rows | high / low | B7 dry run; the owner confirms the status fix (CLAUDE.md rule 5) |
| R11 | R2 credentials or CORS not ready on dev | medium / low | WP-G setup task on day 1; TH-3 for E2E |
| R12 | `forbidden()` needs `experimental.authInterrupts` | low / low | the component fallback with `noindex` |
| R13 | The finish clause changes P2's hot statement | medium / high | the clause is empty for non-tournament games (`tt` joins nothing); P2's finish integration suite runs with it composed in; the equivalence test against `scoreResult()` (§12.1); `EXPLAIN` recorded (§9.2) |
| R14 | The design data is inconsistent (results points sum, "Blitz 10+0", "Pairing is automatic" next to a Find Match button, sentence-case buttons, the 5-minute notice without P10, the alerts CTA with no settings row) | certain / low | server values and the P1 copy rules win; listed under §4; O12-12, O12-13, O12-14 |
| R15 | Late entry lets a strong player join with 10 minutes left and still win | low / low | Lichess allows the same; `lateJoinUntil` is a per-tournament column the admin can tighten later |
| R16 | The calendar slips (CF §8: phases measured in detail ran 34–46 % over) | medium / medium | the 20 % buffer line in §13; P12 is a candidate to ship after launch under CF's "Launch A" cut (§14.5) |

### 14.2 Decisions needed from the owner

| # | Question (inventory ref) | Default in this plan |
|---|---|---|
| O12-1 | Who can host (acct Q27)? | Admins create and can always start or end; an optional featured host (`hostUserId`) set through the API only; member-hosted, invite-only arenas later behind a flag |
| O12-2 | Auto-navigate into the paired game (acct Q28)? | Yes, when the 5 s "study starts in" count reaches 0 (the board shows 0:05; acct suggested 3 s); Go to Game navigates at once; other tabs get a toast |
| O12-3 | Lobby window and minimum players (acct Q29) | The lobby opens 60 min before the start; with fewer than 2 players the start moves 10 min once, then the arena is cancelled and participants are told in the app |
| O12-4 | Time-sliced positions (acct Q26) | Yes: duration ÷ number of positions; everyone in a slice plays the same position, which keeps the top board meaningful |
| O12-5 | Arena scoring (acct Q25) | Lichess rules: 2/1/0, on fire after two wins (4/2/0), a draw before ply 20 scores 0, ranks by score then fewer games then join order. The Lichess draw-streak rule is **not** included (say yes to add it: about 0.5 d) |
| O12-6 | Public read access (acct Q3) | Signed-out visitors and lapsed members can see lists, lobbies, live arenas and results; join, Find Match and spectating need membership. Lobby, live and join pages are `noindex`; results are indexable |
| O12-7 | Are tournament games rated? | Yes, in the tournament's pool with P9's `GAME` Glicko preset (CF 10.18.3), following P9's rated-by-default decision |
| O12-8 | Approve the deviations from api-design / allocation: no `TournamentPairing`, `TournamentInvite` or `AdminActivity` tables; no HTTP find-match fallback; TOU-5/TOU-8/#52/INT-11c/INT-12 folded or dropped; `/t/[slug]` routes; rooms keyed by slug; the B4 exception for lifecycle writes; the `matched` state instead of `V3MatchFound` | Approve (§0) |
| O12-9 | Reports moderation scope (acct Q10) | Dismiss, mark actioned, suspend/unsuspend (with a Clerk ban so sessions end); rename only once P10 usernames exist |
| O12-10 | Clerk reverification on admin archive, cancel-with-players and suspend | Yes (ARCH: destructive admin actions need reverification within 10 min) |
| O12-11 | Limits | 2–64 players now, 256 after O12-15; 1–10 positions; start at least 10 min and at most 60 days ahead |
| O12-12 | Keep "New Game" on the tournament game-over card while the arena is live? | Keep it as a text link (the board has it) |
| O12-13 | Join copy "We will notify you five minutes before the start" before P10's push and email ship | "We'll remind you here five minutes before the start." until P10 is live |
| O12-14 | "Tell me when one opens" on the empty list (CC C-14) | **Not built.** Alternative (≈ 0.5 d, needs P10): a push-only `tournament_new` channel (off by default), producer at T−5 min of each public tournament for opted-in, entitled non-participants, at most one alert per user per day (`dedupeKey "tnew:<userRef>:<localDate>"`), plus the settings row (not on the `V4SettingsNotifications` board, so it needs design sign-off) |
| O12-15 | Raise the arena cap to 256 | After the §9.7 256-player run passes on the 1-OCPU dev box; otherwise keep 64 or approve a paid socket box (CF F-OCI-3) |
| O12-16 | Legend portraits (CF LIC-6) | Only public-domain, CC (with attribution) or own/permission portraits; living players show initials until a licensed portrait exists; the admin form records source and licence for every upload |

### 14.3 Rollback (CF 10.18.4 and §9)

- **No socket image rollback while an arena is live.** Roll forward, or cancel the arena from the admin console (ADM-8e) and then roll back. `deploy-oci.yml` refuses a drain during a live arena unless `force` is set.
- **Flags:** `tournaments-v3` off brings back the legacy tournament pages until their parity deletion (legacy screens stay one release after the gate, CF §9 rule 3); `admin-v3` off brings back the legacy admin pages the same way. The finish clause keeps writing the legacy `points` column, so the legacy leaderboard stays right while the flag is off.
- **Schema:** M12 is expand-only; nothing is dropped until C12/C1/C7. B7 is idempotent and re-runnable. The two new enums are new types (no `ADD VALUE` on a live type), and their new values are written only behind `admin-v3` (two-release rule, §6.5).
- **Versioned payloads:** every internal body and `ScheduleItem` carries `v: 1`; a socket image that sees a newer `v` from web logs and ignores it instead of crashing.
- **Vercel on Hobby rolls back only to the previous deployment** (dev); production rollbacks before P13 go through a revert commit.

### 14.4 Changes this plan asks of other documents

| Document | Section | Change | Why |
|---|---|---|---|
| `allocation.md` | B4 | "Exception: tournament pairing, start, delay, cancel and finalize go through `/api/internal/tournaments/*` (P12 D12-4); scoring is a clause of the direct finish" | CS R-11 |
| `allocation.md` | §1.6 | add `admin-v3` | CS R-14 |
| `allocation.md` | §5.1 | M12 = the §6.5 list (no `TournamentInvite`/`TournamentPairing`/`AdminActivity`; + per-game tournament columns, `ChessPosition.status`, `joinOrder`/`joinSeq`); contract C12 | CS 12.15, R-02 |
| `allocation.md` | §5.2 | add `tournament:search_ended`, `tournament:updated`; room `tournament:{slug}` | CS R-07 |
| `api-design.md` | §4.12–4.14, §9.2 | point to this spec's TOU/ADM/INT ids; drop INT-6's `TournamentPairing`, INT-11c, INT-12 and the "every 60 s" schedule poll | CA §4.3 items 15–16, AP-08, AP-36 |
| `data-model.md` | §5.9, §3.21 | `joinOrder`, `joinSeq`, `startDelays`; the rank index on `joinOrder`; the per-game columns in M12, not M2 | D12-13, CS R-01 |
| `phase-02.md` | §6.6.4, §6.7, §7.4.6, Caddyfile | finish fragments: every `game_players` column written at finish goes into the one `gp` `UPDATE` (Postgres applies one modification per row per statement); `g` returns `whitePlayerId`/`blackPlayerId`; `roles.sql` grants (§6.3); `size.test.ts` per-event budgets; `/internal/metrics` reachable for signed GETs; export `LiveGameRecord` | §8.1, §7.5 |
| `phase-09.md` | §2.2, finish clause, queue | "Watch another game" is P2's (drop "/ P12"); P9's rating columns go into the same `gp` `SET`; `queue:join` ends arena searches (D12-16) | CC C-17, §8.1, §8.13 |
| `phase-10.md` | §4.10, §8.9 | the tournament rows are lit by `tournaments-v3`; `TOURNAMENT_PODIUM` is implemented by P12; the alerts row stays out unless O12-14 says yes | CC C-14, C-23, C-24 |
| `phase-03.md`, `phase-05.md`, `phase-07.md` | result-card slot tables | the coach line (P3, P7 swap) and the bank line (P5) are owned there; the tournament card reuses them | CC C-01, C-02 |
| `phase-13.md` | migration set | M12 without the conditional `audit_logs`; C12 | CS 13.3 |

### 14.5 If P12 ships after launch (CF §8 "Launch A")

Under Launch A, production keeps the legacy tournament pages inside the P1 shell at launch, and P12 runs after P13. Then this phase carries its own production rollout: a Neon child-branch rehearsal of M12 + B7 with the production dump; `migrate deploy` on production (never `migrate dev` or `db push`); `roles.sql` on production; the deploy order of §6.5; `tournaments-v3` and `admin-v3` on for admins first, then 100 % after one live arena on production; the legacy routes deleted one release later; C12 one release after that. The 308s for `/tournament/:ref` and `/join-tournament/:code` switch on with the 100 % step.

### 14.6 Open questions (no decision needed to start)

- Should `finalStandings` keep more than 256 rows if the cap is ever raised? (Not with today's cap.)
- Should the activity feed include worker queue-health transitions (ARCH)? It needs a P3 worker edit; the health card covers the need for now.
- A public tournament archive page (all past results) for SEO is not in the designs; the Finished tab serves it.

---

## 15. Definition of done

- [ ] **Deployed** to every dev target: merged to `dev`; Vercel dev project green; the OCI dev socket redeployed by `deploy-oci.yml`; the Neon dev branch (CLAUDE.md) on M12 through `prisma migrate deploy` (never `migrate dev`, never `db push`) with `roles.sql` applied; B7 applied on dev after the owner confirmed the dry-run counts.
- [ ] **Flags:** `tournaments-v3` and `admin-v3` on for the owner, admins, `E2E_ADMIN_EMAIL` and the E2E members; the legacy tournament and admin pages deleted after the parity check (§13 WP-E, WP-G); no letter user is used as an admin.
- [ ] **Boards:** all 21 P12 boards have a reachable route, and every `data-props` state is reachable from seed data or `/dev/ui/tournaments`; `state-coverage` shows 0 missing states for them, with a written reason for each demo-only state (`V4Tournaments` ×5 devices, `V4TournamentsEmpty`, `V4TournamentJoin`, `V4TournamentLobby`, `V4TournamentLive` ×5, `V4TournamentGame` `tournament`, `V4TournamentGameOver` `over_tournament`, `V4TournamentResults`, `V4Admin`, `V4AdminPositions`, `V4AdminLegends`, `V4AdminTournaments`, `V4AdminTournamentCreate`).
- [ ] **Lights up:** the V3Game `tournament` and `over_tournament` states; Play › Tournaments opens the v3 list; P10's "Tournament starting" row and push-prompt toggle are visible with `tournaments-v3` on (CC C-24); the `TOURNAMENT_PODIUM` milestone appears after a podium finish (CC C-23); the coach and bank lines on the tournament card come from their owners' slots (CC C-01, C-02).
- [ ] **No polling:** zero tournament HTTP requests while searching (E2E assertion and Vercel logs); the legacy pollers and countdown intervals deleted; only the admin health poll remains (§5.9); reminders are future-dated rows, not a timer.
- [ ] **Correctness:** atomic join (50-way race test with `joinOrder` 1…N), no double scoring (finish-twice and equivalence tests), no double booking (k6 teardown check), deterministic ranks everywhere (SQL = mirror = comparator), finalize idempotent.
- [ ] **Security:** every P12 route in the authz matrix; internal routes and WS-7 through `CT/internal/auth.ts`; unsigned `/internal/*` dropped at Caddy; `/admin` on the DB role with the in-place 403; admin writes audit-logged; TH-1…3 registered and proven absent in production (`prod-guard.spec.ts`); the legacy unauthenticated paths gone.
- [ ] **CI green:** lint, `check-types`, `check-test-globs`, units, integration, contract tests, the migration drift gate, the bundle budgets (§9.5), Playwright main specs (§12.3) with the paywall on, axe on every P12 page, the visual baselines, and the device × zoom suite on all 40 projects (one-viewport assertions on every P12 page); the full regression suite and the `flags-off` project green (§12.4).
- [ ] **Performance:** the k6 tournament (64 players) and join-race runs meet §9.6 on the dev box with results in `perf/results/`; the 256-player run recorded (pass or fail, with O12-15 answered); the `EXPLAIN` set recorded in `REPO/perf/explain/phase-12.md` with no sequential scan on `tournament_participants` or `games`; the Neon tournament statement delta per arena game ≤ 6; Hobby usage stayed under 60 %.
- [ ] **Telemetry:** the §10.1 events asserted through the sink in `arena.spec.ts` and the admin specs (schemas valid, PII guard green); seen in the PostHog dev live view during the owner test; the §10.2 Sentry metrics and alerts created; the error window shows no new Sentry issue and no new 5xx.
- [ ] **Owner test:** §1.3 passes on the dev URL with ego-browser, including a real iPhone and a real Android phone; every ego-browser page closed at the end.
- [ ] **Docs:** `REPO/docs/qa/phase-12-signoff.md` committed (§12.8); this spec linked from `REPO/docs/implementation-plan.md`; the §14.4 edits made or filed; the socket env variables documented; the owner's answers to O12-1…O12-16 recorded at the top of this file.

---

## Appendix A. Critique dispositions

Every finding in the five critiques that concerns this phase, and what this revision did with it. "Accepted" means the plan now does what the finding asks; "Partly" says which part was taken; "Rejected" gives the one-line reason; "No change" means the plan already did it.

### A.1 `critique-coverage.md`

| Finding | Ask | Disposition | Where |
|---|---|---|---|
| C-01 (High) | The tournament result card expects a bank line nobody builds | Accepted: the line is P5's `GameOverCard` slot; the tournament variant reuses it and renders nothing if P5 drops it | §2.4, §4.7, §14.4 |
| C-02 (High) | Same for the coach line | Accepted: owned by P3 §4.7 (template) and P7 (LLM swap) | §2.4, §4.7, §14.4 |
| C-14 (Medium) | "Tell me when one opens" can never work | Accepted, as "drop": the CTA is not built; the costed alternative is O12-14 | D12-19, §4.1, §14.2 |
| C-23 (Medium) | P12 never adds the `TOURNAMENT_PODIUM` milestone | Accepted: evaluator row + jobs enqueued at finalize, with tests | D12-20, §7.8, §8.7, §12.1 |
| C-24 (Medium) | Nothing un-hides P10's "Tournament starting" row | Accepted: lit by `tournaments-v3` (row and push-prompt toggle), with the reminder producer | D12-20, §2.4, §7.8, §15 |
| §3 note (E83) | Record the `matched` state as a deliberate deviation from `V3MatchFound` | Accepted | D12-14, O12-8 |
| C-17 (Low) | "Watch another game" is assigned "P2 / P12" in P9 | Accepted as a note: P12 does not own `live:list`; P9 should drop "/ P12" | §2.2, §14.4 |

### A.2 `critique-consistency.md`

| Finding | Ask | Disposition | Where |
|---|---|---|---|
| 12.1 (S1, R-01) | Use P2's column names, delete the "substitute at branch time" paragraph | Accepted | header note, §6, §7, §8 |
| 12.2 (S1, R-01) | Per-game tournament columns and their indexes are unconditional in M12 | Accepted | D12-1, §6.1, §6.2 |
| 12.3 (S1, R-04) | `AuditLog` is created in M4 by P4 | Accepted | D12-3, §6.1 |
| 12.4 (S1, R-02) | Archive must also set `isActive = false` | Accepted (status and `isActive` move together) | §4.11, §7.3 |
| 12.5 (S2, R-02/R-19) | `displayName` belongs to P10; `IF NOT EXISTS` if P12 merges first | Accepted | §6.1, §6.2 |
| 12.6 (S2, R-10) | The finish lives in `PKG/db/src/live/finish.ts`; scoring is a CTE fragment | Accepted, and redesigned as one clause of the single statement (no INT-6) | D12-4, §8.1 |
| 12.7 (S2, R-08/R-09) | `x-internal-token`, `INTERNAL_API_SECRET`, `ANALYSIS_WORKER_URL` | Partly: env names accepted. The static-token scheme is rejected for P12: P12 calls only the shared helper, which CA AP-44, CF SEC-4, ARCH and API make HMAC; the helper decides | D12-15, §7.10 |
| 12.8 (S2, R-06) | `CT/http/codes.ts`; register every P12 reason; add 412 | Accepted | §7.1 |
| 12.9 (S2, R-07) | `CT/socket/registry.ts` + `CT/socket/tournament.ts` | Accepted | D12-6, §7.7, WP-B |
| 12.10 (S2, R-12) | Use P10's `WEB/lib/r2/presign.ts` on `aws4fetch`; no AWS SDK in web | Accepted | §7.3, §7.9, WP-G |
| 12.11 (S2) | `state === "lapsed" && !trial.eligible` | Accepted | §4.1, §5.3 |
| 12.12 (S2) | No `membership_ended`; `subscription_required` + reason; D18 routing | Accepted | §4.1, §4.2, §5.3, §5.8, §11.1 |
| 12.13 (S3) | `APP_URL` → `NEXT_PUBLIC_SITE_URL` | Accepted | §7.2, §7.10, §8.8 |
| 12.14 (S2, R-11) | Keep internal routes but record the B4 exception | Accepted | D12-4, §14.4 |
| 12.15 (S3) | Add C12 to ALLOC §5.1 | Accepted | §6.7, §14.4 |
| R-02 | One `reports` table (P5) | Accepted (target enum = P5's `ReportTarget`) | §4.15, §7.3 |
| R-07 | `/internal/emit` body uses `targets`; rooms `tournament:{slug}` | Accepted | §7.2, §7.5 |
| R-10 | `packages/domain` is created by P9 | Accepted | header, §2.3 |
| R-13 | Limits as `limit / windowSec` | Accepted | §7.2, §7.3, §11.3 |
| R-14 | Register `admin-v3` in ALLOC §1.6 | Accepted | header, §7.10, §14.4 |
| R-18 | Telemetry names must not collide (P9 owns `match_found`) | Accepted (`arena_*` names) | §10.1 |
| R-19 | P10 ∥ P12 shared items: first to merge creates | Accepted for all four items | §2.3, §6.1, §7.1, §7.3 |
| R-20 | No `db push` on any Neon branch; refer to the dev branch through CLAUDE.md | Accepted | §1.3, §6.5, §15 |

### A.3 `critique-feasibility.md`

| Finding | Ask | Disposition | Where |
|---|---|---|---|
| 10.18.1 (R3) | k6 at 256 players on the 1-OCPU box; cap at 64 until it passes; no Stage B | Accepted | D12-18, §9.7, R3, O12-15 |
| 10.18.2 | File ownership through registries (P12 runs beside P6/P7, P10/P11) | Accepted | §13 registry table |
| 10.18.3 | Tournament games use the `GAME` Glicko preset | Accepted | §8.11, O12-7 |
| 10.18.4 | Rollback rule: no socket image rollback during a live arena | Accepted, plus flag, schema and payload rules | §14.3 |
| Fix #3, SEC-5 | Gate test hooks on `APP_ENV` + `ALLOW_TEST_HOOKS`, not `VERCEL_ENV` | Accepted | §7.12 |
| SEC-4 | HMAC internal auth | Accepted through the shared helper | D12-15 |
| SEC-8 | Drop unsigned `/internal/*` at Caddy | Accepted for P12's two paths | §7.5, §11.3 |
| LIC-6 | Portrait source and licence; policy for living players | Accepted (P12 owns the legend admin) | §4.12, §6.1, §7.3, O12-16 |
| F-VER-2 | Stop test traffic at 60 % of a Hobby quota | Accepted for the k6 runs | §9.7, §15 |
| F-VER-3 | Run the device × zoom matrix in CI, smoke only on the deployed URL | Accepted | §12 intro |
| F-VER-4 | Pre-sized portraits rendered `unoptimized` | Accepted | §4.12 |
| F-VER-5 | Speed Insights sampling | Accepted (P1's 0.2; lab checks via Lighthouse) | §9.6 |
| F-OCI-3 | Capacity ceiling after P13 D7 | Accepted | R3, O12-15 |
| F-OCI-4 | Pools must survive Neon suspends | Accepted for the mirror load and the finish retry | §8.5, §12.2 |
| F-NEON-1 (with CA AP-01) | Split dev from production before heavy test traffic | Accepted as a precondition for k6 and nightly runs | §9.7, R7 |
| F-NEON-2 (with CA AP-08) | Next-due rows instead of ticks | Accepted for reminders | D12-10, §7.8 |
| §8 | Calendar realism: 20 % buffer; Launch A puts P12 after launch | Accepted: buffer line and a post-launch rollout path; the scope cut itself is the owner's call | §13, §14.5, R16 |
| §9 | Enum two-release rule, versioned payloads, legacy kept one release | Accepted | §6.5, §14.3 |
| §10.4 item 4 | `refetchIntervalInBackground: false` | Accepted | §5.1, §5.9 |
| §2.5 (Sentry metrics [V]) | Have a fallback if metrics are unavailable | Accepted | §10.2 |

### A.4 `critique-testing.md`

| Finding | Ask | Disposition | Where |
|---|---|---|---|
| P12 admin user (X4) | A dedicated `E2E_ADMIN_EMAIL`, no letter S | Accepted | §3.5, §12 intro, §15 |
| P12 hook registry (X12) | Register the time route, the cleanup DELETE and `R2_PRESIGN_MODE`; prove 404 in production | Accepted (the DELETE becomes TH-2) | §7.12, §12.2 |
| P12 a11y | axe light/dark; keyboard spec; VoiceOver manual | Accepted | §12.3, §12.7 |
| P12 visual | Baselines for list, arena, results, admin, create with errors | Accepted | §12.3 |
| P12 telemetry (X6) | Assert arena and admin events through the sink | Partly: assertions added with this plan's registered names (`arena_find_match_clicked`, `arena_paired`, `tournament_joined { via }`, `tournament_finished`, `admin_action`); the critique's example names were illustrative | §10.1, §12.3 |
| P12 regression scope (X11) | Whole suite + P4, P5, P6, P7, P10, P11 checks | Accepted | §12.4 |
| P12 DoD additions | Admin user, a11y/visual, telemetry, maintenance gate, full regression | Accepted | §15 |
| X1 | One runner, one layout, no orphan tests | Accepted | §12 intro |
| X2 | CI runs the suites on `dev` | Accepted | §12 intro |
| X3 | Paywall on in E2E | Accepted | §12 intro |
| X4 (queue isolation) | Isolate matchmaking pools per test | No change needed: every spec creates its own tournament, so arena pools are per test | §12 intro |
| X5 | Server-time control (`x-rc-now`, `TIMING_PROFILE`) | Accepted | §7.12, §12.3 |
| X7 | Console guard | No change: P1's global fixture covers P12 specs | §12 intro |
| X8 | State-coverage tags | Accepted | §12 intro, §15 |
| X10 | Visual tooling | Accepted | §12.3 |
| X14, X15 | Sign-off record, regression test per defect, tab hygiene | Accepted | §1.3, §12.7, §12.8 |
| X17 | `tournament-helpers.ts` calls removed user APIs | Accepted (rewritten) | §3.5 |
| X18 | Perf results as data | Accepted | §9.7 |

### A.5 `critique-api-perf.md`

| Finding | Ask | Disposition | Where |
|---|---|---|---|
| §4.17.1 | INT-9…12 HMAC; D12-10 is the model for api-design | No change in P12 (confirmed); api-design edit listed | §14.4 |
| §4.17.2 (AP-08) | Tournament reminders as future-dated work, not a tick | Accepted | D12-10, §7.8 |
| AP-03 | Public payloads must not depend on the viewer | Accepted (`labels` removed; a contract test compares two viewers) | §7.2, §12.2 |
| AP-11 | Long rate-limit windows must be durable | Accepted (`admin-upload`) | §7.3 |
| AP-12 | No zod schemas in production client bundles | Accepted (`devSchema()`, admin-only form schemas) | §5, §9.5 |
| AP-14 | No response headers from RSC pages | No change: `noindex` is set in `metadata`; admin API headers are set by route handlers | §7.3, §11.2 |
| AP-15, AP-35 | Server-side SLO measurement with named metrics and formulas | Accepted | §9.6, §10.2 |
| AP-16 | Realistic socket frame budgets in the size test | Accepted | §7.7, §12.1 |
| AP-25 | Reconnect resync burst | No change in substance (resync is already version-gated); added jitter and the shared `minVersion` CDN entry | §5.4, §9.3 |
| AP-30 | Optimistic Find Match | No change: already optimistic | §5.4 |
| AP-36 | api-design §9.2 budgets against `TournamentPairing` | Accepted (edit listed) | §14.4 |
| AP-38 | Counts on page 1 only | Accepted (TOU-1, ADM-3a, admin lists) | §5.2, §7.2, §7.3 |
| AP-44 | HMAC with per-caller keys and per-caller emit allow-lists | Accepted | D12-15, §7.5 |
| §1 (cache tiers) | Use OPT's six tier names | Accepted | D12-17, §7.2 |
| §2.10 (react-virtual) | Load the virtualiser through `next/dynamic` only above 200 rows | Accepted | §4.3, §4.4, §9.5 |
| AP-07 (`playedAt` rename) | Use one column `playedAt` instead of `endedAt` | Rejected for P12: P12 follows the column P2 ships (`endedAt`, CS R-01); if P2 renames it, P12's two queries follow. The wire field stays `playedAt` | §7.2 TOU-11m |
| AP-22 (`no-store` vs `no-cache`) | Private routes should revalidate | Rejected for P12's three private reads: they are < 2 KB and change on every event, so revalidation saves nothing; `private-etag` remains available | §7.2 |
| AP-17 (per-IP handshake guard) | Raise the per-IP limits | Not P12's: P2's handshake guard; arenas add no extra handshakes | — |
