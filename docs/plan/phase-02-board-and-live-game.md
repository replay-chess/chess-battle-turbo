# Phase 2 · Board and live game: detailed plan

Status: **final plan (revision 2)**, 2026-11-02, written against branch `dev` @ `0848b76`. Revision 2 folds in the five critiques (`SP/plan/critique-{coverage,consistency,feasibility,testing,api-perf}.md`); every finding that concerns P2 is either applied in place or rejected with a reason in Appendix A "Critique dispositions". P2 starts after P1 (track 1A + 1B) is merged to `dev`. Estimate **32.25 dev-days** plus a 20 % buffer line (allocation budget 28; §13.4 explains the delta and lists the trims).

**What this file is.** The build spec for P2 in `SP/plan/allocation.md` §3 "P2 · Board and live game". It turns the allocation's build list into files, schemas, endpoints, socket events, states, tests and work packages with strict file ownership. Where the input documents disagree, §0.2 records the choice; the allocation's binding decisions (B1–B26) always win.

**Path shorthands** (same as the allocation)

| Short | Path |
|---|---|
| `REPO` | `/Users/rohitpandit/open_source/chess-battle-turbo` |
| `WEB`, `WS` | `REPO/apps/web`, `REPO/apps/web-socket` |
| `PKG` | `REPO/packages` |
| `SP` | the planning session's scratchpad, archived scratch inputs that are not in the repo and may no longer exist (see [99-open-decisions.md](99-open-decisions.md) A12) |
| `DR` | `SP/design-ref/project/v2` (board files `*.dc.html`) |
| `DS` | `SP/design-ref/ds/project` (design system README, tokens, component READMEs) |
| docs | `SP/plan/{allocation,architecture,data-model,api-design,client-data-layer,optimization}.md` |
| audits / inventories | `SP/plan/audit-{api,db,client,socket,quality}.md`, `SP/plan/inv-{play-a,play-b,sys,…}.md` |
| P1 spec | `SP/phase1/SPEC.md` (+ `SP/phase1/04-viewport.md` for `BoardStage`) |

References like "socket F-03" are findings in `audit-socket.md`; "play-a §7.26" points into `inv-play-a.md`; "B4" is a binding decision in `allocation.md` §2.

---

## 0. The phase on one screen

### 0.1 Summary

| | |
|---|---|
| **Goal** | Rebuild the board, replace the socket server's game core with protocol v2 and restart-safe checkpoint persistence, and ship the v3 game screen (`/game/[ref]`) in all 55 `V3Game` states for human games (friend, quick match, tournament) and client-run bot games. |
| **Milestone** | M1: every game is played on v3 and survives a socket deploy. |
| **Boards** | 33 (21 desktop incl. the `V3MoveBoard` component, 12 device boards). States P2 does not light: `over_analysing`, `over_legend` (P3), `tournament`, `over_tournament` (P12), rating deltas inside `over_*` (P9), `over_guest` (dropped, no guests under Phase 0). |
| **Schema** | M2a (`GameStatus += ABORTED`), M2 (`Game` play columns, `GamePlayer`, enums, indexes), M2i (`idempotency_keys`, only if P1 did not create it). Expand-only. |
| **New packages** | `PKG/db` (Prisma schema + client + socket-side live-game store), `PKG/game-core` (rules, clocks, reducers, local runner, PGN, illegal-move reasons, bot ladder), `PKG/contracts/src/socket` (protocol v2 in zod). |
| **Socket** | Protocol v2 (`proto: 2`): rooms `game:{ref}`, `spectate:{ref}`, `user:{ref}`; acked commands with `ply`/`clientMoveId`; `seq`-numbered events; direct Neon writes at checkpoints only (B4) plus an ndjson journal on the OCI volume; drain on deploy; restore by replay; `POST /internal/emit` fan-out (B20 shape `targets[]`); every `/internal/*` call HMAC-signed with per-caller kids (§7.5.1); per-user handshake limits; `session:hello {bootId, useq}`. v1 handlers kept behind `proto` until the P2 parity gate and one release after it (Q5). |
| **HTTP** | `POST /api/games` (bot), `GET /api/games/[ref]`, `POST /api/games/[ref]/checkpoint`, `POST /api/games/[ref]/complete`, `GET /api/games/[ref]/pgn`; `GET /api/socket-token` gains `ent` (no game image route: images of games are served only through P3's shares, §7.1.6). Removed at the parity gate: `chess/move`, `chess/game-state`, `chess/game-over`, `chess/create-ai-game`. |
| **Client** | `WEB/app/(app)/game/[ref]/page.tsx` (RSC snapshot), `WEB/features/game/**` (store, live and local controllers, clocks, outbox, premove, all components), `WEB/components/board/**` (`V3MoveBoard`), `WEB/features/engine/EngineProvider.tsx`, `WEB/lib/realtime/connection.ts`. `GamePageContent.tsx` (1,437 lines) deleted at the parity gate. |
| **Flags** | `live-protocol-v2` (client speaks v2), `game-v3` (new screen for live human games). Bot games always use v3 (the v1 AI path is deleted). |
| **Work packages** | A data · B game-core · C contracts · D socket server · E web HTTP · F board · G game screen · H bot and engine · I QA, perf, deploy, parity gate (§13). |

### 0.2 Reconciliation of the inputs (binding for this phase)

| Topic | Inputs say | P2 uses | Why |
|---|---|---|---|
| Who writes live games | data-model D22 and api-design INT-1…INT-8: socket → internal web routes. B4: socket → Neon directly | **B4.** The INT-* routes become in-process functions in `PKG/db/src/live/*` called by the socket server | B4 is binding; it saves ~10 Vercel invocations and a Mumbai→iad1 hop per game |
| Room names | api-design §6.3 `g:{ref}`, `g:{ref}:w`, `u:{ref}` | **`game:{ref}`, `spectate:{ref}`, `user:{ref}`** (allocation P2, client-data-layer §5.3) | allocation's P2 build list |
| Event and command names | api-design §6.4–6.5 (`game:draw {action}`, `game:rematch {action}`, `game:ready`, `game:over`, `game:presence`) | **allocation names**: `draw:offer\|accept\|decline`, `rematch:offer\|accept\|decline\|cancel`, `study:ready`, `game:ended`, `presence:update`, `move:applied`, `clock:sync`, plus `game:phase`, `game:sync`, `game:leave`, `live:list`, `session:refresh_token` (needed but not listed). §7.4.9 maps every api-design name | allocation is the newer, binding list |
| `move:rejected` | allocation lists it as an event; api-design returns rejections in the ack | **Ack result** `{ok:false, code, state}`; no separate event | every command already has an ack; a second path would race it |
| PGN | data-model D1: not stored. B3: written once at game end with `%clk` | **Stored for games played on Replay Chess only** (`Game.pgn`, B3); never written for imports (P4 rebuilds from `moves`) | binding; data-model must re-measure §10.1 with the column (feasibility F-NEON-4, tracked in §14.3) |
| `GamePlayer` key | data-model `(gameId, color)`; B1 `(gameId, userId)` | **PK `(gameId, userId)`** + unique `(gameId, color)` | B1; the unique index keeps the data-model FK option open for P3 |
| Colour columns | data-model `whiteUserId`; B2 `whitePlayerId` | **`whitePlayerId` / `blackPlayerId`** (null side = bot) | B2 |
| End fields | data-model `endReason GameEndReason` (12), `outcome GameOutcome` | **`endMethod GameEndMethod` (11), `outcome GameWinner`** | allocation P2 schema list |
| Pool column | allocation `ratingPool`; data-model/B1 `timeClass` | **`Game.timeClass TimeClass`** (data-model enum); rating pool is derived (`poolOf(tc)`, §8.11) | one name on `Game` and `GamePlayer`; imports (P4) need `DAILY`/`CLASSICAL`, which are not rating pools |
| `LivePhase` values | data-model `RUNNING` | **`WAITING, STUDY, FIRST_MOVE, PLAYING, ENDED`** | same word as the wire protocol |
| `Challenge`, `Share`, `PlayerRating` | data-model M2 | **Not in P2** (allocation M9/P9, M8) | allocation |
| Unit test runner | architecture §5.1, audits: Vitest | **`node:test` via `tsx`** | allocation §1.1, P1 SPEC D13 |
| Shared protocol package | `packages/game-protocol` (socket audit), `packages/protocol` (client-data-layer) | **`PKG/contracts/src/socket`** | B17 |
| Ping settings | play-a: 5 s / 5 s; api-design: 10 s / 8 s | **10 s / 8 s** (dead link noticed ≤ 18 s) | api-design; less CPU on the 1-OCPU box |
| Spectator delay | play-a: 3 s for rated games | **One ply** (allocation) | binding |
| Study length | code 15/20/30 s; design 30 s | **30 s when `startFen ≠ initial`, else 0** (owner Q1, §14) | allocation |
| Internal auth on `/internal/*` | api-design §2.11.6 and architecture §3.2.4: HMAC with timestamp and key ids; B20 text: `x-internal-token`; consistency R-08: keep the token | **HMAC from P2** (`x-rc-kid`, `x-rc-ts`, `x-rc-sig`, §7.5.1), one helper `PKG/contracts/src/internal/auth.ts` used by every sender and receiver, key set in the one env var `INTERNAL_API_SECRET` (`kid:base64[,kid:base64]`), per-caller kids and per-caller event allow-lists. The static token is never shipped by the v2 server | a static bearer shared by three services has no replay protection and lets a leak push fake `entitlement:changed` to any user room (feasibility SEC-4, api-perf AP-44); P9/P12/P13 already sign with HMAC. Recorded as a B20 deviation for owner sign-off (§14.3); if the owner refuses, only the helper changes |
| Per-member end-time column and archive index | api-perf AP-07: rename to `playedAt`; consistency R-01: keep P2's `endedAt` | **`game_players."endedAt"`** + `game_players_userId_endedAt_gameId_idx`; wire DTOs may call it `playedAt` | one column either way; R-01 already sends seven phases to `endedAt` (Appendix A) |
| Live-game sweep index | P2 rev 1: `games (status, "lastMoveAt")`; data-model: partial `games_open_idx` | **`games_open_idx ON games (status) WHERE status IN ('WAITING_FOR_OPPONENT','IN_PROGRESS')`** | an index on `lastMoveAt` blocks HOT updates on every checkpoint (data-model §8, api-perf AP-07) |
| Columns later phases read from `games` | data-model M2 has display names, ratings, titles, `source`, `externalId`; P2 rev 1 omitted them | **Added to M2** (§6.2), with `GameMode.IMPORTED`, `GameEndMethod.OTHER`, `enum GameSource` | consistency R-01 / fix 2.1–2.4: P3, P4, P10 and P12 read them |
| Checkpoint cadence | api-design 8 plies; B4 10 plies / 15 s | **B4**: 10 plies, or 15 s after the first unflushed change, on phase change (journal only), finish, abort, drain | binding |
| Engine hosting | optimization OPT-30: R2 with CORS; play-b: hashed path in `public/` | **R2 from P2**: `NEXT_PUBLIC_ENGINE_BASE_URL=https://media.playchess.tech/engine/sf18-<hash>/` serves the glue `.js` and the `.wasm` (`Content-Type: application/wasm`, CORS for the app origins, `immutable`). A tiny **same-origin** worker shim `public/workers/engine-shim.js` (`new Worker()` needs same origin) `importScripts()` the cross-origin glue and points `locateFile` at the R2 WASM. If R2 fails to load, the shim falls back to the same files under `public/workers/sf18-<hash>/`. `COPYING` (GPL-3.0) and `SOURCE.txt` ship next to the files in both places | 7.3 MB per cold load counts against Vercel Hobby Fast Data Transfer; the GPL notice is missing today (feasibility fix 9, LIC-2) |
| Error codes P2 introduces | P2 rev 1 used codes without adding them | **Added to `PKG/contracts/src/http/codes.ts` in WP-C:** `in_flight 409`, `idempotency_key_reused 422`, `illegal_position 422`, `illegal_moves 422`; `CONFLICT_REASONS += already_started, already_completed, not_bot_game`. `mode_not_available` is `400 validation_failed {details.reason}`; `claim_mismatch` is `422 illegal_moves {details.reason}`; `validation_failed` is always 400 | consistency R-06 |
| `idempotency_keys` | data-model M1 (Phase 0.5); allocation M1 omits it | **Created by P2's M2i unless P1 shipped it** (check at WP-A start) | `POST /api/games` requires an `Idempotency-Key` (B23) |
| Flag names | architecture `new-shell`, … | **`live-protocol-v2`, `game-v3`** | allocation §1.6 |
| Game-room presence vs P10 user presence | both named `presence:update` | P2's `presence:update` is `{seq, ref, side, online, graceEndsAt}` in `game:{ref}` only. **P10's watcher event is `presence:state`** (`{userRef, online, activity?}`), registered in the same `registry.ts` (handoff H-09) | one registry cannot hold two schemas under one name (consistency R-07) |
| `/internal/emit` body | P3 `rooms[]`; P4/P5/P10 `{room, event, data}` | **Only** `{ v: 1, targets: ({ room } \| { userRef })[] ≤ 50, event, data, dedupeKey? }`; zod `.strict()`, so `{room}` and `rooms[]` are rejected with 400 | consistency R-07 |
| Package paths | P2 rev 1: `PKG/contracts/socket/*` | **`PKG/contracts/src/{http,socket,internal}/*.ts`**, imported as `@repo/contracts/{http,socket,internal}/<file>`. P2 adds the `./socket/*` and `./internal/*` entries to the package `exports` | consistency R-10 |
| Neon procedure | CLAUDE.md allows `db push` on the dev branch | **No `db push` on any Neon branch** (it drops the hand-written partial indexes); `migrate deploy` on dev and prod, `migrate dev` only on local Docker Postgres | consistency R-20 |

---

## 1. Goal and user-visible outcome

### 1.1 What changes for the user

1. **One game screen** at `/game/[ref]` inside the v3 shell for every game type: the board is always fully on screen (desktop, iPad landscape and portrait, iPhone, Android, 80–150 % zoom). Player bars sit directly above and below the board; the side panel (desktop, iPad L) or the zone, move strip and bottom action bar (phones, iPad P) hold everything else.
2. **A board that feels like a real chess site.** Click-click and drag with parity, 180 ms slides, legal dots and capture rings, premove (one queued move), a promotion picker with Esc, an illegal-move shake with a plain-English reason, check glow, arrows by right-drag, keyboard move entry and a screen-reader grid.
3. **Live games that behave correctly.** A 30 s study phase on legend and opening positions with "I'm ready", a 30 s first-move window with abort, clocks that start after both first moves, tenths under 10 s, lag credit, draw offers with a cooldown, resign confirm, 30 s reconnect grace with a ring, abandon, all automatic draws (threefold, fifty-move, insufficient material, timeout vs insufficient material), rematch with colours swapped, spectating with a one-move delay.
4. **Deploys no longer break games.** A socket deploy shows "Server restarting in 0:30 · Games in progress will resume" and the game resumes at the same ply, colours and clocks (today it resets to the start position, socket F-03).
5. **Bot games run on the device.** Hint (twice for the arrow), undo, resign, draw offer; reloads resume; nothing touches the socket server.
6. **Correct records.** Colours, every move (including the mate, socket F-07), per-move clocks, end method and a PGN with `%clk` are stored for every game, which P3's analysis needs.

### 1.2 What the owner can test on dev at the end (`https://replay-chess-dev-replaychess007-1069.vercel.app`, socket `wss://ws-dev.80-225-200-210.sslip.io`)

Use the E2E members A–P from `WEB/.env.test`, Clerk dev, Dodo test mode. Flags `live-protocol-v2` and `game-v3` on for the owner and A–P.

| # | Step | Expected |
|---|---|---|
| T1 | Browser 1 (member A): `/play` (legacy page inside the shell) → Friend → pick a **legend position** (so the study phase applies, §14 Q1) → 5+3 → Create. Copy the link | Lands on `/game/<ref>` in `waiting`: dimmed board, "Waiting for opponent · Not joined yet", link field, Copy, Cancel challenge |
| T2 | Browser 2 (member B): open the link → Join | Both screens enter `study`: 30 s ring, legend card, "Moves are locked…". Click "I'm ready" in both: study ends early |
| T3 | First-move window | The side to move sees `abort` ("Make your first move 0:30"); the other side sees "Clock not started". Clocks start only after both first moves |
| T4 | While it is B's turn, A drags a piece to a target | Premove ghost + "Premove set: … Right-click or Esc to cancel." It fires as soon as B moves |
| T5 | Try an illegal move (e.g. a pinned piece) | Shake + "That move isn't legal: the bishop on e7 is pinned to your king." |
| T6 | Push a pawn to promotion (use fixture game G-PROMO, §6.8) | Picker on the file (Q R B N), Esc puts the pawn back; choosing sends the move |
| T7 | Let one clock fall under 10 s (fixture G-LOWTIME, 0:15 + 0) | Tenths ("0:09.6"), red chip, "Low time", one beep |
| T8 | A offers a draw; B declines | B sees "martin_k offers a draw · Decline · Accept"; after decline A sees "…declined the draw. You can offer again in 2 moves." and Offer draw is disabled for 2 own moves |
| T9 | A: ⋯ → Resign… | Popover "Resign this game? … Keep playing / Resign", focus on Keep playing; Resign → `over_resign_loss` / `over_resign_win` |
| T10 | New game; during play close browser 2's tab | Browser 1: toast "…disconnected. They have 30 seconds to reconnect.", ring on B's chip counting down; after 30 s `over_abandoned` "You won · … left the game" |
| T11 | New game; mid-game run the dev socket deploy (`gh workflow run deploy-oci.yml --ref dev`) | Both players see "Server restarting in 0:30 · Games in progress will resume. Keep playing."; after the restart both reconnect, the board is at the same ply with the same colours, clocks paused until both are back, then running |
| T12 | After a finished game: Rematch in browser 1, Accept in browser 2 | Both navigate to a new `/game/<ref>`; toast "…accepted. Colours swapped: you play Black." (`rematch_study`) |
| T13 | Browser 3 (member C) opens the live game URL | `spectate`: "N watching · Moves only · sound quiet", only Flip and the move steppers; moves arrive one ply late; at the end `over_spectator` with "Watch another game" (opens the live list) |
| T14 | `/play` → vs Computer (any time control) | Bot game: "vs Engine 1400 · unrated"; Hint once (piece named), Hint again (arrow + SAN), Undo (takes back your move and the reply), finish or resign |
| T15 | In a bot game, reload mid-game; then open the same URL on a phone | Reload resumes at the same ply instantly; the phone resumes from the last checkpoint (≤ 10 plies or the last `pagehide`) |
| T16 | Real iPhone and real Android phone | Tap-to-move (tap piece, tap target) and drag both work; the board is never cut off; no tab bar during a game |
| T17 | Non-member R opens a game URL | Redirect to `/pricing?reason=…&redirect_url=/game/<ref>` |
| T18 | Zoom the desktop browser to 150 % on a live game | Board, both clocks and the action row stay visible; the move list scrolls inside its panel; the page never scrolls |

---

## 2. Scope

### 2.1 In scope

| Area | Items |
|---|---|
| Board | `WEB/components/board/Board.tsx` (`V3MoveBoard`) with the full input contract of `V3GamePrototype` (play-a §7.30), SVG arrow layer on a fixed `viewBox`, badge layer with the owner's icons (B8, `WEB/public/board_icons`), ring/highlight/thumb props, keyboard grid, text move entry, `MiniBoard` (static SVG). |
| Rules and clocks | `PKG/game-core`: chess.js wrapper, end detection incl. full-history threefold and timeout vs insufficient, millisecond clocks with lag credit, the live reducer (server), the client reducer and the 55-state view derivation, the local runner for bot games, PGN with `%clk`, `explainIllegal`, time-class classification, bot strength ladder, draw policy. |
| Protocol | `PKG/contracts/src/socket`: commands, events, payload schemas, error codes, rate-limit constants, socket token claims v2, the `ROOM` builders (`rooms.ts`). `PKG/contracts/src/internal/auth.ts`: HMAC signing for every internal hop. `PKG/contracts/src/http/codes.ts`: the P2 rows of the error-code ledger. |
| Socket server v2 | Handshake `{proto:2, token}`, rooms, all commands and events (§7.4), presence and grace, study and first-move windows, abort, draws, rematch, spectators with a one-ply delay, `live:list`, per-socket rate limits, direct checkpoint writes, the end-of-game single-statement transaction, journal, restore, drain, `/internal/emit`, `/internal/broadcast`, `/health`, `/ready`, `/internal/metrics`, legacy tournament lobby events kept. |
| Web HTTP | §7.1–7.3. Legacy creators (`chess/create-game`, `chess/join`, `chess/cancel-game`, `matchmaking.service`, `tournament/find-match`) made atomic and writing the new columns; `api/analysis/[gameId]` reads the new columns. |
| Client | `/game/[ref]` RSC, realtime connection manager, live controller, local controller, game store, clock store, outbox, premove, sounds, hotkeys, every component of the game screen on every device, the in-game silent auth refresh (`V3SessionExpired` `in_game_refresh`/`in_game_ok`), the `server:restarting` chip, `/dev/ui/game?state=` demo route. |
| Engine | `WEB/features/engine/EngineProvider.tsx`: lazy singleton Stockfish 18 lite worker, content-hashed and immutable, **served from R2** through a same-origin shim with an origin fallback, shipped with `COPYING` and `SOURCE.txt` (GPL-3.0), used only by bot games (never PvP or spectators, client #6). |
| Data | M2a, M2, M2i; backfill `WEB/scripts/backfill-play-columns.ts` (dev only); dev seed fixtures for the states. |
| Ops | `deploy-oci.yml` drain step (signed CLI), journal volume, `stop_grace_period: 30s`, `/ready` health check, the Caddy unsigned-request pre-check, Sentry metrics, PostHog server events, k6 `ws-ramp` on protocol v2, `check-drift.ts` in CI, the engine upload to R2. |

### 2.2 Explicitly out of scope (and who owns it)

| Item | Owner |
|---|---|
| Play hub, socket matchmaking (`queue:*`), friend challenges (`/api/challenges`, `/join/[code]`), shared positions, Glicko-2 ratings, rating deltas and resign stakes, `rated = true` | P9 (P2 games are all `rated = false`; the legacy `/play`, `/queue`, `/join` pages stay as entry points) |
| Review, analysis, accuracy, key moments, the template coach line on the result card, `over_analysing`, `analysis:*` events, the `jobs` table | P3 (P2 shows "Analyse game" → legacy `/analysis/[ref]` instead of "See what the coach thinks"). One owner per result-card slot: §2.4 |
| The Mistake Bank line on the result card ("+1 position added to your Mistake Bank (move 13).") | P5 (slot `bank`, §2.4) |
| The LLM version of the result-card coach line | P7 (swaps P3's template sentence, slot `coach`, §2.4) |
| Legend practice (`LEGEND_BOT` mode, stars, next position) | P8 (P2's `POST /api/games` returns `400 validation_failed {details.reason: "mode_not_available"}` for `LEGEND_BOT`) |
| Legend comparison block on the result card (`over_legend`: "Compare with …", "Replay from move N") | P3 §4.7 (slot `legend`, §2.4) |
| Tournament strip and tournament game over (`tournament`, `over_tournament`), socket pairing | P12 (tournament games play on the v3 screen without the strip; standings still update, §6.6.3) |
| `V3Maintenance` page and Edge Config, `V3PwaUpdate` | P11 (P2 only builds the `server:restarting` variant of the in-game chip) |
| Bot strength calibration (`scripts/calibrate-bots.ts`) | P9, next to bot-strength persistence and the `GAME` Glicko preset (P2 ships the uncalibrated ladder, labelled "≈"; handoff H-06 in §2.5) |
| Offline bot play with client-generated ids | later (play-a Q12) |
| Private profiles hiding games from spectators | P10 |
| Contract steps (drop `gameData.moveHistory`, duplicate indexes) | C1 (P13 + 30 d) |

### 2.3 Dependencies on earlier phases

| From | What P2 consumes | Where |
|---|---|---|
| P0 | Paid-only model, `requireSubscribedUser` 402 with `reason`, dev environment (Vercel `replay-chess-dev` at `https://replay-chess-dev-replaychess007-1069.vercel.app`, OCI dev socket, the Neon dev branch named in CLAUDE.md, Clerk dev, Dodo test). Branch and project ids are not repeated in this spec, because P1 moves dev and E2E to their own Neon project (1B·H10) and the ids change | `WEB/lib/auth/require-subscription.ts:30-58`; `REPO/CLAUDE.md` "Environments" |
| P1 1B·H10 | **Entry precondition:** dev and E2E run on their own Neon project, not on the production project's 100 CU-h. If H10 has not landed when P2 starts, WP-I does it before the first k6, resilience or nightly run (owner confirms the CLAUDE.md update) | P1 §13; critique AP-01 / X16 |
| P1 track 1A | UI kit (`components/ui/*`: Button, IconButton, Kbd, Spinner, Tag, Banner, Avatar, Skeleton, Tooltip, Popover, Menu, Sheet, ResponsiveDialog, Toast/`notify`, ActionBar), shell (`AppShellView` with `hideTabBar`, top bar Back, rail, sidebar), `ViewportStage`, `BoardStage` (`components/layout/BoardStage.tsx`, 04-viewport §4.4), `ScrollRegion`, the device × zoom suite (`playwright.devices.config.ts`, 40 projects, `expectOneViewport`), shortcuts registry and `?` sheet, `useHotkeys` scope stack, `/dev/ui/*` fail-closed routes (D11) | P1 SPEC §3, §10 |
| P1 track 1B | `route()` wrapper (`WEB/lib/api/route.ts`) with `auth`, `body`, `cache`, `rateLimit`, `maxBodyBytes`, `idempotent`; envelope and codes (`PKG/contracts/src/http`); `api()` client, `qk` factory, `QueryProvider` error routing (401 modal, 402 pricing, 429 countdown); `getViewer()`; `requireMember()`; `RateLimitBucket`; flags (`WEB/lib/flags.ts`, `useFlag()`); CI (`ci.yml`); hotfixes H2 (chess routes internal-only), H4 (`game-by-ref` projection), H6 (socket P0 set incl. `SOCKET_AUTH_REQUIRED=true` on dev, `creatorColor` stopgap, SIGTERM drain stub); `RealtimeBoot` stub in `(app)/layout` (client-data-layer §9.1); `InGameStatusChip`, `SessionExpiredModal` | allocation P1 F1–F9, H1–H8 |

If a P1 item slips, the P2 package that needs it carries a stub task (§13.3) rather than a hidden dependency.

### 2.4 Lights up later (slots that are not rendered in P2)

Each slot has exactly one owner. `GameOverCard` (§4.4) exposes named slots, `slots: Partial<Record<"accuracy" | "coach" | "bank" | "rating" | "legend" | "tournament", ReactNode>>`, so a later phase adds a slot component and never edits the card.

| Slot on the game screen | Owner (one per slot) | What the owner renders | P2 behaviour |
|---|---|---|---|
| `accuracy`: accuracy · moments line, `Analysing · N%`, "See what the coach thinks" CTA | **P3** §4.7 | from `qk.review.status(ref)` and `analysis:*` | not rendered; CTA "Analyse game" → `/analysis/[ref]` (legacy, members, players only) |
| `coach`: the coach line (e.g. "17.Rd8# finished it the way Morphy did in 1858…") in the 21 `over_*` states that carry `result.coach` | **P3** §4.7 renders the template sentence `PlayerReview.content.summary[0]` once `status = done` (`aria-live=polite`, hidden while analysing); **P7** §4.5 swaps in the verified LLM sentence on `review:text_ready` | — | not rendered |
| `bank`: "+{n} position(s) added to your Mistake Bank (move{s} {plies})" (`r.bankOn`, 10 states) | **P5** | `analysis:done.bankAdded {count, plies}` (live) or `qk.review.status(ref)` (seed); hidden while analysing, when the count is 0, or when the player opted out | not rendered |
| `rating`: "Blitz 1184 → 1192 (+8)", resign stakes, "rated" header | **P9** | `game:result.rating` | header says "· unrated"; no rating line; resign copy without points |
| `legend`: legend block, "Compare with …", "Replay from move N" (`over_legend`) | **P3** §4.7 ("Replay from move N" → `/practice?game=<ref>&ply=<divergence ply>`) | legend comparison facts | not rendered |
| `tournament`: strip, points line, Find match / Back to arena | **P12** | tournament events | not rendered; tournament games end with "Back to tournament" (link to the legacy `/tournament/[ref]`) |
| Coach card in the bot zone ("C · Morphy castled long here… VERIFIED") | **P7** §4.7 for `BOT` games (verified, from CO-6 on the last move pair, flag `coach`); **P8** S3 for `LEGEND_BOT` games (authored `CoachLine`) | — | bot zone shows hint text only |
| ⋯ menu "Board settings" | **P10** §2.4 (opens `/settings/board`; the sheet on phones) | — | item hidden |
| "Watch another game" (`live:list` sheet, second CTA of `over_spectator`) | **P2** builds it; not part of any trim (§13.4) | — | built |

### 2.5 Handoff ledger (slots and work P2 hands to other phases)

The receiving phase must list each row in its own "lights up" or scope table. Rows marked **add** were missing from the receiving doc when the coverage critique ran (C-01, C-02, C-03, C-09, C-15, C-16); the receiving phase's revision adds them.

| # | Item | Receiver | Receiver section | Status |
|---|---|---|---|---|
| H-01 | `bank` slot on `GameOverCard` (also on `V4TournamentGameOver`) | P5 | replaces P5:435 "no change" with a slot row | **add** (C-01) |
| H-02 | `coach` slot: template line (P3) and LLM swap (P7) | P3, P7 | P3 §4.7 slot table; P7 §4.5 | **add** (C-02) |
| H-03 | `legend` slot incl. "Replay from move N" | P3 | P3 §4.7 legend block | **add** (C-03) |
| H-04 | Bot-zone coach card in `BOT` games | P7 | P7 §4.7 | **add** (C-09) |
| H-05 | "Board settings" ⋯ item | P10 | P10 §2.4 "Earlier slots P10 turns on" | **add** (C-16) |
| H-06 | Bot ladder calibration (`scripts/calibrate-bots.ts`), removing the "≈" tooltip | P9 | P9 §2 scope and WBS | **add** (C-15) |
| H-07 | `rating` slot | P9 | P9 lights-up list | listed |
| H-08 | `tournament` slot, `over_tournament` | P12 | P12 §4.6 | listed (P12:382 points its coach and bank lines at H-01/H-02) |
| H-09 | P10's watcher presence event is **`presence:state`** (`{userRef, online, activity?}`), never `presence:update` | P10 | P10 §7.4 | **add** (consistency 10.12) |
| H-10 | Account deletion overwrites `games."whiteName"`/`"blackName"` (and titles) of the deleted user's games and `game_players."opponentName"` of their opponents' rows with the anonymised label | P10 | P10 account-deletion statement list | **add** (new with the M2 display columns) |

---

## 3. Current code touched (from the audits)

Line numbers are at `0848b76` and may shift by P1's edits; the anchor text is given where it helps.

### 3.1 Socket server (`WS`)

| File (lines) | Today | Fate in P2 |
|---|---|---|
| `WS/index.ts` (394) | Express + socket.io bootstrap; 9 handlers `:115-348`; `/health` static `:37-39`; `/internal/tournament-event` `:42-73` (token added in P1 H6); io options with default ping `:79-89`; SIGTERM destroys games without flush `:367-385` | **Rework** into `WS/src/server/*` + `WS/src/commands/*` (§13 WP-D). `/internal/tournament-event` kept as an alias that calls the emit service (removed in P12). v1 handlers move to `WS/src/v1/` |
| `WS/GameSession.ts` (1,113) | One game: study `:209-243,851-960`, moves `:335-443` (final move not persisted `:429-432`), draws `:467-513` (accept unchecked `:487-493`, fixed in H6), disconnect `:518-566`, reconnect `:571-673`, spectators `:740-795`, AI path (≈200 lines: `:38-42,71-81,165-176,250-330,369-387,420-425,436-438,532-546,646-647,714-718,816-822,906-911,965-1003`) | **Move** to `WS/src/v1/GameSession.ts` minus the AI path (deleted now). **Replaced** by `WS/src/game/LiveSession.ts` over `@repo/game-core`. v1 copy deleted at the parity gate |
| `WS/GameManager.ts` (349) | Session map; join always calls Vercel `game-by-ref` `:42,82`; eviction only on resign/draw `:156-158,192-194` | v1 copy; replaced by `WS/src/game/SessionRegistry.ts` |
| `WS/ClockManager.ts` (220) | 100 ms interval, 1 s emits, whole seconds `:26,63-65,125-128,189-192` | v1 only; replaced by game-core clocks + one `setTimeout` per game |
| `WS/TournamentManager.ts` (144) | `tournament:{ref}` rooms, 6 helpers, dead `emitMatchFound` `:115-122` | **Keep** for the legacy lobby until P12; called in-process after a tournament game finishes; dead helper removed |
| `WS/types.ts` (277) | Hand-copied payload types | v1 only; replaced by `@repo/contracts/socket` |
| `WS/utils/apiClient.ts` (189) | 4 HTTP calls to Vercel, no timeout or retry | v1 only (with H6's `AbortSignal.timeout(8000)` + retries); deleted at the parity gate |
| `WS/utils/socketAuth.ts` (129) | HMAC verify; `socketMayActAs` lets token-less sockets act `:126-129` | **Rework**: verification from `@repo/contracts/socket/token`; claims v2; unauthenticated path deleted; `SOCKET_AUTH_REQUIRED` removed |
| `WS/utils/{sentry,logger,traceContext}.ts`, `WS/instrument.ts` | 100 % traces, PII on (`instrument.ts:10`), per-game `continueTrace` | **Rework**: 10 % traces, `sendDefaultPii: false`, metrics of §10.2, structured JSON logs; `traceContext.ts` deleted |
| `WS/spotInterruption.ts` (67) | AWS Spot IMDS poller (~17k requests a day, no-op on OCI) | **Delete** |
| `WS/Dockerfile` (71) | 3-stage `node:22-alpine`, copies only `typescript-config` | **Rework**: copies `packages/{db,game-core,contracts}`, runs `prisma generate` for `linux-musl-arm64-openssl-3.0.x`, creates `/data/journal` owned by uid 1001 |
| `WS/package.json`, `WS/tsconfig*.json` | `strict: false` in production config | deps `@repo/db`, `@repo/game-core`, `@repo/contracts`, `posthog-node`, `zod`; one strict tsconfig; `test` script (node:test) |
| `WS/deploy/*`, `WS/docker-compose.yml` | Legacy EC2/nginx/systemd/Docker Hub | **Delete** |
| `REPO/deploy/oci/docker-compose.yml` | No grace period, healthcheck on `/health` | `stop_grace_period: 30s`, volume `ws_journal:/data/journal`, healthcheck `/ready`, env `APP_ENV`, `DRAIN_NOTICE_SECONDS` |
| `REPO/deploy/oci/Caddyfile` | Proxies every path incl. `/internal/*` | `respond 404` for `/internal/broadcast`, `/internal/drain`, `/internal/metrics` from outside (ops calls go through `docker compose exec`) |
| `REPO/.github/workflows/deploy-oci.yml` (`:19-24` paths, `:111-112` restart) | Restart without drain; triggers only on `apps/web-socket/**`, `deploy/oci/**` | Paths add `packages/{db,game-core,contracts}/**`; steps pre-pull → broadcast restart notice → wait → `up -d` → poll `/ready` (§7.11) |

### 3.2 Web (`WEB`)

| File (lines) | Today | Fate in P2 |
|---|---|---|
| `WEB/app/game/[gameId]/page.tsx` (28) | Client page; `useRequireAuth` waterfall (`/api/user/email/{email}`, PII in URL) | **Replace** with `WEB/app/(app)/game/[ref]/page.tsx` (RSC). The old folder is removed (Next.js cannot have both routes) |
| `WEB/app/game/[gameId]/GamePageContent.tsx` (1,437) | Socket effect `:387-727`, io options `:393-402`, `hydrateFromDb` `:352-385`, `game-by-ref` ×3 `:355,560,602`, 37 `useState` `:55-121`, `clock_update` re-render `:546-555`, optimistic move with a boolean `:239-259,528-544`, rematch via `create-game` `:308-338`, bot via socket `:749-797`, engine for every game `:126-130`, board container `:812` (`min-h-screen`, not one-viewport) | **Move** to `WEB/features/game/legacy/GamePageContent.tsx` (rendered only when `game-v3` is off for a live human game; it uses protocol v1). **Delete** at the parity gate with `GameActionButtons.tsx` (75), `PlayerInfoCard.tsx` (142), `AnalysisPhaseBanner.tsx` (174) |
| `WEB/app/game/[gameId]/layout.tsx` (13), `loading.tsx` (7) | `noIndex` metadata; spinner | Move to `(app)/game/[ref]/`; `loading.tsx` becomes the board-shaped skeleton (`V3Skeletons` game variant) |
| `WEB/app/components/ChessBoard.tsx` (863) | Legacy board (PNG pieces through `next/image` `:576-606`, `GameEndEffects` import `:5`), P1 `fill` mode | **Keep** for legacy surfaces (analysis, openings, admin, position, join, play preview). Not used by the v3 game screen |
| `WEB/app/components/PromotionPopup.tsx` (97), `GameEndEffects.tsx` (496) | Legacy overlays | Legacy only; untouched |
| `WEB/lib/hooks/useChessSound.ts` (130) | 11 `.webm` sounds loaded at mount `:39-51` | Legacy keeps it; v3 uses `WEB/features/game/sound/sounds.ts` (Web Audio buffers decoded on the first gesture) |
| `WEB/lib/hooks/useBotMove.ts` (181), `useStockfish.ts` (worker at `:102`) | Depth ladder easy/medium/hard/expert; `legalMoves[0]` fallback | Kept for analysis/practice until P3/P8; bot games use `EngineProvider` |
| `WEB/lib/hooks/useSocketToken.ts` (153) | Module cache; `retryOnUnauthorized` `:96-135` (good) | Logic folded into `WEB/lib/realtime/connection.ts`; file kept for `useTournamentLobby` until P12 |
| `WEB/lib/socket-token.ts` (104) | `{sub, exp}` signed with `INTERNAL_API_SECRET`, TTL 15 min `:16` | Signs claims v2 via `@repo/contracts/socket/token` with `SOCKET_TOKEN_SECRET` (falls back to `INTERNAL_API_SECRET` for one release) |
| `WEB/app/api/socket-token/route.ts` (P1 migrated it to `route()`) | Any signed-in user gets `{sub, exp}` | Adds `ent`, `env`, `role`, `name`, `kid`, `v: 2` (§7.1.7) |
| `WEB/lib/types/socket-events.ts` (148) | Client copy of v1 types (drifted, socket §3.4) | Legacy only; deleted at the parity gate |
| `WEB/app/api/chess/create-ai-game/route.ts` (357) | Bot user as a player, random legend position by default, difficulty from Chess.com rating | **Removed** in WP-E once its 3 callers use `POST /api/games`: `WEB/app/play/page.tsx:155`, `WEB/app/queue/page.tsx:262`, `WEB/app/position/[referenceId]/PositionPageClient.tsx:105` |
| `WEB/app/api/chess/move/route.ts` (130), `game-state/route.ts` (101), `game-over/route.ts` (276) | Internal-only since P1 H2; used by v1 only | **Deleted at the parity gate** (§13 WP-I), together with the v1 handlers |
| `WEB/app/api/chess/game-by-ref/[gameReferenceId]/route.ts` (108) | P1 H4: participants get the snapshot, others an invite projection | Kept for `WEB/app/join/[gameReferenceId]/page.tsx:71` until P9; v1 socket path removed at the gate |
| `WEB/app/api/chess/create-game/route.ts` (208) | Friend game `WAITING_FOR_OPPONENT`; `creatorColor` `:100-115`; create `:121-132` | **Change**: writes `mode`, `whitePlayerId`/`blackPlayerId` (creator side), `studySeconds`, `timeClass`, `phase = WAITING`, `meta` and the creator's `GamePlayer` through `createLiveGame()` (`PKG/db/src/games/createLiveGame.ts`) |
| `WEB/app/api/chess/join/route.ts` (183) | Unconditional update `:82-88` (two joiners race, play-a B13) | **Change**: conditional `updateMany` on `status = 'WAITING_FOR_OPPONENT' AND opponentId IS NULL`, fills the empty colour, inserts the joiner's `GamePlayer`; 409 `already_started` on `count = 0` |
| `WEB/app/api/chess/cancel-game/route.ts` (86) | Unconditional update `:47` | Conditional on `WAITING_FOR_OPPONENT` |
| `WEB/lib/services/matchmaking/matchmaking.service.ts` (541) | Creator = White by construction `:258-270`; global `prisma` inside the transaction (DB-11) | Writes the new columns and both `GamePlayer` rows through `createLiveGame(tx)`; `tx` passed through (DB-11) |
| `WEB/app/api/tournament/find-match/route.ts` (`:144-156`) | Colours random, creator = White | Same as matchmaking |
| `WEB/app/api/analysis/[gameId]/route.ts` (`:177-208`) | Reads `gameData.moveHistory`, guesses colour three ways | **Adapter**: when `game.moves <> ''` build the `Move[]` by replaying `moves` with chess.js and take the colour from `whitePlayerId`/`blackPlayerId`; deleted in P3 |
| `WEB/lib/prisma.ts` + 12 importers of `app/generated/prisma` | Client generated into `WEB/app/generated/prisma` | Re-export of `@repo/db`; imports switched (WP-A) |
| `WEB/prisma/schema.prisma`, `WEB/prisma/migrations/*`, `WEB/prisma/seed.ts`, `opening-seed.ts` | Schema lives in the web app | **Move** to `PKG/db/prisma/` (`_prisma_migrations` stores names only, so moving the folder is safe, data-model §2.11) |
| `WEB/package.json` (`build`, `prisma:*` scripts) | `prisma generate && next build` | `pnpm --filter @repo/db generate && next build`; scripts delegate to `@repo/db` |
| `WEB/next.config.js` (`:101-185` headers; `:160-164` `/workers` no-cache) | WASM `max-age=0` (7.3 MB re-validated on every game page, client #6) | `transpilePackages` += `@repo/db`, `@repo/game-core`; `/workers/sf18-:hash/*` → `public, max-age=31536000, immutable` |
| `WEB/e2e/fixtures/chess-board.ts` (156) | Relies on `[data-square]`, `.rounded-full` dots, capture `rgba(220, 80, 80`, `game-board-container` `data-game-started`/`data-player-color`/`data-current-turn` | Keeps those selectors (the new board renders them, §4.5.6) and adds `data-phase`, `data-ply`, `data-role` |
| `WEB/e2e/specs/{play-with-bot,play-with-friend,quick-match,tournament}.spec.ts` | v1 flows | Updated to v3 (WP-I) |
| `REPO/perf/k6/src/scenarios/{ws-ramp,ws-games}.ts` | v1 events | Protocol v2 (`perf/k6/src/lib/protocol-v2.ts`) |
| `WEB/app/api/cron/daily/route.ts` (P1 CRON-1) | Daily sweeps | Adds the stale bot-game sweep (§7.7) |

---

## 4. Screens

P2 has one route with one template (`V3Game`, 55 states) and one shared component (`V3MoveBoard`). All 26 game boards are the same template with a different default state; desktop and device boards share the per-state data (`D().C`), only layout differs (play-a intro). The per-state data was re-extracted for this plan with `SP/p2tools/extract.js` (output `SP/p2tools/v3game-states.txt`).

### 4.1 Route and boards

**Route:** `/game/[ref]` (`WEB/app/(app)/game/[ref]/page.tsx`), for live human games, bot games, spectating and finished games. `ref` is `Game.referenceId` (cuid). Middleware already protects `/game(.*)` (`WEB/middleware.ts:18`); the page itself requires a member (§5.1). `noindex`.

| Device | Board files (all under `DR/`) | Default state |
|---|---|---|
| Desktop 1440 × 900 (+1280 × 800) | `V3Game.dc.html` (all states as a tweak), `V3StudyPhase.dc.html`, `V3GameTheirMove.dc.html`, `V3GameBot.dc.html`, `V3Spectate.dc.html`, `V3GamePremove.dc.html`, `V3GameCheck.dc.html`, `V3GameIllegal.dc.html`, `V3GamePromotion.dc.html`, `V3GameLowTime.dc.html`, `V3GameDrawOffer.dc.html`, `V3GameResign.dc.html`, `V3GameOppDisconnected.dc.html`, `V3GameReconnecting.dc.html`, `V3GameOver.dc.html`, `V3GameOverLoss.dc.html`, `V3GameOverDraw.dc.html`, `V3GameOverTimeout.dc.html`, `V3RematchOffer.dc.html` | `your_move`, `study`, `their_move`, `bot`, `spectate`, `premove`, `check`, `illegal`, `promotion`, `low_time`, `draw_received`, `resign_confirm`, `opp_disconnected`, `reconnecting`, `over_checkmate_win`, `over_resign_loss`, `over_agreement`, `over_timeout_loss`, `over_rematch_received` |
| Desktop, interaction contract | `V3GamePrototype.dc.html` (playable vs Engine 1000, Blitz 3+2) | — |
| Component | `V3MoveBoard.dc.html` (props `fen`, `orient: w\|b`, `mover: ''\|w\|b`, `label`, `thumb`, `dimmed`, `onMove`, `last`, `hl`, `ring`, `arrows`, `badge`) | — |
| iPhone 393 × 852 | `V3iPhoneGame.dc.html`, `V3iPhoneGameDrawOffer.dc.html`, `V3iPhoneGameOver.dc.html` | `your_move`, `draw_received`, `over_checkmate_win` |
| Android 412 × 915 | `V3AndroidGame.dc.html`, `V3AndroidGameDrawOffer.dc.html`, `V3AndroidGameOver.dc.html` | same |
| iPad landscape 1194 × 834 | `V3iPadLGame.dc.html`, `V3iPadLGameDrawOffer.dc.html`, `V3iPadLGameOver.dc.html` | same |
| iPad portrait 834 × 1194 | `V3iPadPGame.dc.html`, `V3iPadPGameDrawOffer.dc.html`, `V3iPadPGameOver.dc.html` | same |
| Referenced, owned elsewhere | `V3SessionExpired.dc.html` (`in_game_refresh`, `in_game_ok`: P1 board, P2 lights the in-game variant), `V3Maintenance.dc.html` (`in_game`: P11 board, P2 builds the `server:restarting` chip), `V3Shortcuts.dc.html` (P1 sheet; P2 adds the game rows), `V3Skeletons.dc.html` (P1; the game skeleton variant), `V3Nav.dc.html` (P1) | — |

### 4.2 Layout per device (one-viewport compliance)

The DS rule (`DS/README.md` "Layout: one viewport", rule 1): during a game the board, both player bars (avatar, name, rating, clock, material) and the essential controls are on screen at once and the player never scrolls. Only the move list and the zone scroll, inside their own regions.

The page renders inside P1's `ViewportStage` in **lock mode** (`BoardStage` sets `data-rc-lock`, SPEC D15). The board size comes from `BoardStage`'s container-query formula (04-viewport §4.4):

```
--rc-board = min( 100cqw − 2·px − asideRoom,  100cqh − 2·py − nbars·(barH + barGap),  880px )   (floor 220px from the stage min-height)
```

which reproduces the design's `max(220px, min(100vh − 140px, 100vw − 648px, 880px))` (`V3Game.dc.html` `.bcol`) without subtraction constants.

| Device / mode | Shell | Board region | Panel / zone | Controls | Expected board side (P1 goldens, 04-viewport §5.4) |
|---|---|---|---|---|---|
| Desktop 1440 × 900 | Sidebar 220 px (`V3Nav`) | `BoardStage` side mode: px 24, py 16, gap 20; bars 48 px + 6 px gap | Aside 300–360 px, height = board + 108 px (edges align with the bars): header (`header` / `headerR`), zone, status line, move list (`ScrollRegion`, "Game starts here" divider), offer bars, in-panel toast, action row | Action row at the panel bottom: `‹` `›`, Offer draw, `⋯`, Share | 760 px |
| Desktop 1280 × 800 | Sidebar | same | same | same | ≈ 660 px |
| Desktop at 125 % (1152 × 720) | Sidebar | same; `@media (max-height: 760px)` hides `.tall` lines (study body text, legend sub-line) | same | same | ≈ 564 px |
| Desktop at 150 % (960 × 600), any ≤ 1100 px wide | Rail 64 px | `max-height: 620px` density step: py 8, bars 40 px, clock 17 px type, zone padding 8/12, `.short-hide` lines hidden | Aside 300 px | same | ≈ 496 px |
| iPad landscape 1194 × 834 | Rail 64 px (coarse pointer forces rail, SPEC D5) | side mode | Aside (design: rail · 644 board · panel) | Action row in the panel | ≈ 644–670 px |
| iPad portrait 834 × 1194 | Top bar 52 px with **Back** + `headerR` label; **no tab bar** (`hideTabBar`) | `BoardStage` stack mode, board full width minus 37 px side padding | Below the board: zone (`ScrollRegion`), horizontal **move strip** (last 8 plies, tap → full list in a bottom `Sheet`) | `BoardStage` footer = bottom action bar 64 px + safe area: Back, draw label, More (or Hint/Undo, Abort, Flip, Moves locked by state) | 760 px |
| iPhone 393 × 852 | Top bar 44 px (+ 54 px safe top) with Back + `headerR` | stack mode, board 393 px (49 px squares), bars 48 px | zone + strip in the remaining ≈ 160 px; the zone scrolls | footer 56 px + 34 px safe bottom | 393 px |
| Android 412 × 915 | same as iPhone | board 412 px | ≈ 220 px for zone + strip | same | 412 px |
| Phones at 125–150 % | same | `max-height: 620px` step: bars 40 px, sub-lines hidden, zone collapses to one line (`StatusLine` only) | strip only | same | 314 px (125 %), ≈ 259 px (150 %) |

Rules every layout keeps:

1. The result card **replaces the top of the panel** (desktop, iPad L) or renders in the zone under the board (phones, iPad P). It never covers the board (v3 section note; play-a C7 overrides the DS README's "centred card" line; the DS README line is updated in WP-G).
2. Offer bars (draw received, rematch in/out) sit above the action bar on phones and above the action row on desktop; never over the board.
3. Popovers (resign) anchor to the `⋯` trigger (desktop) or open as a bottom `Sheet` (phones). The promotion picker is drawn inside the board over the promotion file (a board child, so `container-type` does not break `position: fixed`; P1 SPEC §10.2 note).
4. The in-game chips (`InGameStatusChip`: server restarting, auth refreshing, signed in again) sit at the top right of the board region, `z 20`, and never cover a square (they render in the top player bar's trailing slot on phones).
5. Toasts for game events render **inside the panel** (desktop) or above the action bar (phones) as the template does (`.toast` inside `.side`), not in the global Sonner stack, so they never cover the board or the clocks.
6. No `transition-all` on squares; all motion respects `prefers-reduced-motion` (§4.6.4).

### 4.3 The 55 states

Column key: **Zone** is the swappable block at the top of the panel (desktop) or under the board (phones): `loading`, `waiting`, `study`, `coach` (bot), `viewing`, `reconnect`, `disc`, `abort`, `tour`, `error`, `ended`, `spect`, `result`. **Actions** is the template's `actions` variant (`online`: steppers + Offer draw + `⋯` + Share; `bot`: Hint, Undo; `abort`: Abort game; `spect`: Flip only; `study`: "Moves locked" disabled; `waiting`/`disabled`: Offer draw disabled; `over`: result CTAs; `none`). Copy is from the boards unless §4.8 changes it. "P2" = lit in this phase.

| # | State | Entered when (source of truth) | Zone · status · bar/toast | Player bars | Actions | Exits | P2 |
|---|---|---|---|---|---|---|---|
| 1 | `loading` | Page rendered from the RSC snapshot; `game:join`/`spectate:join` ack pending | zone "Loading game" + 2 skeleton lines; board drawn from the snapshot FEN | skeleton chips | `disabled` | join ack → any | ✓ |
| 2 | `waiting` | `phase = waiting` (friend game, the other player not connected) | zone "Waiting for opponent · Send this link. The game starts with a 30 s study phase when they join." link field + Copy + Cancel challenge; board dimmed | opponent "Not joined yet" (pulse) | `waiting` | `game:phase study`; Cancel → `POST /api/chess/cancel-game` → `/play` | ✓ |
| 3 | `study` | `phase = study` | zone: ring + "Study the position 0:30", legend card ("Morphy vs Brunswick & Isouard · Paris Opera, 1858 · White to move after 9…b5"), "Moves are locked. Draw arrows with right-drag to plan. Then each side gets 30 s for a first move; clocks start once both have moved.", **I'm ready · start when both are** | sub "Study · moves locked" / "Study"; clocks read `STUDY` | `study` | both ready or `study.endsAt` → `abort`/`their_move` first-move window | ✓ |
| 4 | `study_last5` | client: `study.endsAt − serverNow ≤ 5 s` | countdown enlarged (`big5`), red | same | `study` | same | ✓ |
| 5 | `study_reconnect` | own connection down during `study` | toast warn "Reconnecting… the study timer keeps running." | own chip "RECONNECTING…" | `study` | reconnect → `study` | ✓ |
| 6 | `abort` | `phase = first_move`, `firstMove.side = you` | zone ring "Make your first move 0:30" + abort note "No move by then and the game is aborted, unrated."; status "Clocks start once both sides have made a first move." | "Your move · clock not started" / "Clock not started" | `abort` | your move → other side's window; deadline or Abort → `over_aborted` | ✓ |
| 7 | `rematch_study` | `phase = study` on a game with `rematchOfId` | toast good "martin_k accepted. Colours swapped: you play Black."; zone label "Rematch · study as Black"; header "Rematch · Blitz 5+3" | "Black · moves locked" / "White · study" | `study` | → `rematch_first` or `rematch_your` | ✓ |
| 8 | `rematch_first` | rematch game, `phase = first_move`, `firstMove.side = opponent` | zone "martin_k's first move 0:30"; status "Clocks start once both sides have made a first move." | opponent "Thinking" | `disabled` (abort only for the side to move, §14 Q2) | their first move → `rematch_your` | ✓ |
| 9 | `rematch_your` | rematch game, `phase = first_move`, you are the second mover | status "Your first move as Black starts both clocks." | "Your move · clock not started" / "Clock starts after your move" | `abort` | your move → `playing` | ✓ |
| 10 | `your_move` | `phase = playing`, `turn = you` | status hint on selection ("King selected · castling long is legal") | "Your move · +4 material" (material from FEN) | `online` | your move → `their_move` | ✓ |
| 11 | `their_move` | `phase = playing`, `turn = opponent` | — | opponent "Thinking" (pulse) | `online` | `move:applied` → `your_move` | ✓ |
| 12 | `premove` | local premove queued | toast warn "Premove set: Rxd7. Right-click or Esc to cancel."; ghost piece (dashed amber outline) | "Premove queued" | `online` | executes on the next `move:applied` or is cancelled | ✓ |
| 13 | `premove_cancelled` | premove illegal after the opponent's move, or Esc / right-click / click on its from-square | toast info "Premove cancelled." | — | `online` | — | ✓ |
| 14 | `check` | `inCheck` and your turn | status (red) "Check · block, capture or move the king"; king-square radial | "Check" | `online` | legal reply | ✓ |
| 15 | `illegal` | local validation fails (no network) | toast bad "That move isn't legal: the knight on d7 blocks the d-file." (reason from `explainIllegal`); piece shakes back | "Your move" | `online` | next attempt | ✓ |
| 16 | `promotion` | pawn dropped on the last rank | picker on the file (Q ringed, R, B, N, ESC); status "Choose a piece · Esc puts the pawn back" | "Promote" | `online` | pick → move sent; Esc → status "Promotion cancelled · the pawn is back on b7" | ✓ |
| 17 | `rejected` | move ack `{ok:false, code: illegal \| stale_ply}` | toast bad "Move not accepted. The board is back in sync with the server." | "Your move" | `online` | — | ✓ |
| 18 | `low_time` | your clock running and < 10 s | clock shows tenths, red chip, sub "Low time", `tenseconds` sound once | — | `online` | move, or `game:ended timeout` → `over_timeout_loss` | ✓ |
| 19 | `viewing` | local `view.ply < live ply` | zone (dark) "Viewing 11.Bxb5+ · clock running · Back to live"; board at that ply, 0.9 opacity, no marks | — | `online` | Back to live, `→`/`↓` to the end; a new opponent move flashes Back to live and plays the sound but stays (§14 Q9 default) | ✓ |
| 20 | `draw_sent` | emit of `draw:offer` (optimistic, §5.2.8; confirmed by the ack, rolled back on a negative one) | button "Offer sent" (disabled) | opponent "Thinking" | `online` | `draw:declined` → `draw_declined`; `game:ended agreement` | ✓ |
| 21 | `draw_received` | `draw:offered` from the opponent | bar "martin_k offers a draw · Decline · Accept" (Decline first in DOM) | — | `online` | Accept → `over_agreement`; Decline or your move (implicit) → toast | ✓ |
| 22 | `draw_declined` | `draw:declined` for your offer | toast info "martin_k declined the draw. You can offer again in 2 moves."; Offer draw disabled until `canOfferAtPly` | — | `online` | cooldown passes | ✓ |
| 23 | `resign_confirm` | `⋯` → Resign… | popover "Resign this game? martin_k wins." (§4.8) Keep playing (focused) / Resign | — | `online` | Resign → `over_resign_loss`; Esc / Keep playing → back | ✓ |
| 24 | `reconnecting` | own socket down while `playing` | zone "Reconnecting… · RECONNECT WITHIN 0:18 · Your clock is running. Bxd7+ is queued and will be sent when you're back." + Reload game (after 25 s); variant during a server restart: "Server update · back in a few seconds · clocks are paused" | own chip "RECONNECTING…" (pulse); ghost of the queued move | `online` (moves queue, max 1) | reconnect → `reconnected`; grace ends server-side → `over_abandoned` (loss) | ✓ |
| 25 | `reconnected` | rejoin ack applied, outbox flushed | toast good "Back online. Bxd7+ was sent." (or "Back online." with nothing queued) | — | `online` | — | ✓ |
| 26 | `opp_disconnected` | `presence:update {online:false, graceEndsAt}` for the opponent | toast warn "martin_k disconnected. They have 30 seconds to reconnect."; zone "Opponent disconnected · martin_k has 0:30 to return" + body (§4.8, owner Q4); ring on their chip (text countdown) | opponent chip opacity 0.55, "Disconnected" | `online` | `opp_reconnected`; grace end → `over_abandoned` (win) | ✓ |
| 27 | `opp_reconnected` | `presence:update {online:true}` | toast good "martin_k reconnected." | opponent "Thinking" if their turn | `online` | — | ✓ |
| 28 | `bot` | `mode = BOT` (local controller) | zone `coach`: hint text only in P2 ("Hint 1 of 2: look at your king." then "Hint 2 of 2: castle long, O-O-O." + arrow); header "vs Engine 1400 · unrated" | bot chip "Thinking" while searching | `bot` (Hint, Undo, `⋯`) | `over_*` | ✓ |
| 29 | `tournament` | `mode = TOURNAMENT` | zone `tour` "Friday Opera Arena · 18:42 LEFT · YOU'RE 3RD · 14 PTS · Standings" | — | `online` | — | P12 (P2 renders tournament games as `your_move`/`their_move` without the strip) |
| 30 | `already_ended` | join ack with `phase = ended` on a game you did not just finish (or RSC sees `status ∈ {COMPLETED, ABORTED}`) | toast info "This game has already ended."; zone "This game has already ended · knightowl_88 won by checkmate on move 17." Open review → P2: **Analyse game** (§2.4), Back to Play | — | `none` | — | ✓ |
| 31 | `server_error` | ack timeout + failed `game:sync` ×3, or `game:error {code: internal}` | toast bad "Something went wrong on the game server."; zone (alert) "Server error · Lost sync with the game server · Your last move is safe. Reload to fetch the current position." Reload game | — | `online` (board viewable) | Reload game → `game:sync` (then a hard reload if that fails) | ✓ |
| 32 | `spectate` | join role `spectator` | zone "12 watching · Moves only · sound quiet"; header "Watching · Blitz 5+3"; board one ply behind | no "You" | `spect` (Flip, steppers) | `over_spectator` | ✓ |
| 33 | `over_checkmate_win` | `game:ended {method: checkmate, winner: you}` | result: Victory · "You won by checkmate" · "Checkmate · move 17"; badges: `mate` on the mated king, `win` crown on the winner | tags WON/LOST | `over` | rematch states | ✓ |
| 34 | `over_checkmate_loss` | checkmate, winner opponent | Defeat · "martin_k won by checkmate" · "Checkmate · move 30" | | `over` | | ✓ |
| 35 | `over_resign_win` | resignation by opponent | Victory · "martin_k resigned" · "Resignation · move 16"; `flag` badge on the resigning king | | `over` | | ✓ |
| 36 | `over_resign_loss` | you resigned | Defeat · "You resigned" · "Resignation · move 15" | | `over` | | ✓ |
| 37 | `over_timeout_win` | timeout, opponent flagged | Victory · "You won on time" · "martin_k ran out of time · move 14" | | `over` | | ✓ |
| 38 | `over_timeout_loss` | timeout, you flagged | Defeat · "You lost on time" · "Your clock ran out · move 14" | | `over` | | ✓ |
| 39 | `over_timeout_insufficient` | flag while the other side cannot mate | Draw · "Draw · timeout vs insufficient material" · "Your clock ran out · move 81" (or "martin_k ran out of time") | DRAW tags | `over` | | ✓ |
| 40 | `over_stalemate` | stalemate | Draw · "Draw by stalemate" · "Stalemate · move 59"; `½` badges on both kings | | `over` | | ✓ |
| 41 | `over_threefold` | threefold (auto) | Draw · "Draw by repetition" · "Threefold repetition · move 17" | | `over` | | ✓ |
| 42 | `over_fifty` | fifty-move rule (auto) | Draw · "Draw by 50-move rule" · "50 moves without a capture or pawn move · move 92" | | `over` | | ✓ |
| 43 | `over_insufficient` | insufficient material | Draw · "Draw · insufficient material" · "Only kings left · move 70" (method line names the material: "King and bishop vs king") | | `over` | | ✓ |
| 44 | `over_agreement` | draw accepted | Draw · "Draw agreed" · "Draw by agreement · move 13" | | `over` | | ✓ |
| 45 | `over_abandoned` | grace expired for the opponent | Victory · "You won · martin_k left the game" · "Opponent did not reconnect within 30 s" (loser side sees Defeat · "You left the game") | opponent "Disconnected" | `over` | | ✓ |
| 46 | `over_aborted` | first-move deadline, Abort, or grace with < 2 plies | Result (neutral) · "Game aborted" · "No first move within 30 s · not rated" ("Game aborted by martin_k" when a player aborted); only **New game**; no review CTA | | `over` | | ✓ |
| 47 | `over_analysing` | `game:result.review.status = queued` + `analysis:progress` | "Analysing · 64%" disabled CTA | | | | P3 |
| 48 | `over_legend` | `game:ended` on a legend start + comparison facts | legend block, Compare, Replay from move N (slot `legend`, handoff H-03) | | | | P3 §4.7 |
| 49 | `over_tournament` | `mode = TOURNAMENT` ended | points line, Find match, Back to arena | | | | P12 (P2: normal result + "Back to tournament") |
| 50 | `over_guest` | — | — | | | | dropped (Phase 0 §1.6) |
| 51 | `over_spectator` | `game:ended` with role spectator | Result (neutral) · "White wins by checkmate" · "lucena_now vs martin_k · 17.Rd8#"; **Watch another game** (live list sheet), New game; no accuracy or coach lines ever (analysis is private to players) | | `over` | | ✓ |
| 52 | `over_rematch_sent` | emit of `rematch:offer` (optimistic, §5.2.8; the ack's `expiresAt` replaces the local estimate) | bar "Rematch offered · colours swap, you'll play Black · Cancel" | | `over` | `rematch:started` → navigate (`rematch_study`) | ✓ |
| 53 | `over_rematch_received` | `rematch:offered` | bar "martin_k wants a rematch · you'd play Black · 0:30 · Decline · Accept" | | `over` | Accept → `rematch:started`; Decline; expiry | ✓ |
| 54 | `over_rematch_declined` | `rematch:declined` | toast info "martin_k declined the rematch." | | `over` | | ✓ |
| 55 | `over_rematch_expired` | `rematch:expired {reason}` | toast info "Rematch offer expired: martin_k left." / "Rematch offer expired." (`reason: timeout`) | | `over` | | ✓ |

**Result card fields** (template `result`, play-a §7.26): kind label (Victory / Defeat / Draw / Result / "Spectating · result"), title, method line, the named slots of §2.4 in this order: `rating` (P9), `tournament` (P12), `accuracy` (P3), `bank` (P5), `coach` (P3 template, P7 LLM), `legend` (P3), then the CTA row, Share (Copy link / Download PGN; no image until P3's shares), and the move list below it. CTA rules in P2: **Rematch** for `FRIEND`/`ONLINE` when not aborted, not spectating, both players still on the page; **New game** (→ `/play` with the same options, `?again=<ref>`) except tournaments; **Analyse game** (→ `/analysis/[ref]`) for players of non-aborted games; **Watch another game** for spectators; **Back to tournament** for tournament games. Bot games: "Rematch · as Black" (creates a new bot game with colours swapped, `reason: rematch`), Restart (same colour, `reason: restart`), New game.

**Board badges at game end** (`M.badge` in the template, rendered by the board's badge layer): `mate` (`#`, `#a3412e`) on the mated king; `win` (crown path, `#4f6b3a`) on the winner's king; `flag` (`#3d3229`) on the resigning king; `draw` (`½`, `#6b6b6b`) on both kings. Each has an `aria-label` ("Checkmated king", "Winning king", "Resigned", "Draw"). The owner's icons (`WEB/public/board_icons/svg/{checkmate_white,checkmate_black,winner,resign_white,resign_black,draw_white,draw_black}.svg`) are used for these (B8 and the user memory: the icons are the owner's own); the `mq-*` tokens are colours only.

**How the 55 states map onto code.** The client store holds protocol state; `deriveViewState(store)` (`PKG/game-core/src/client/viewState.ts`) returns `{ primary: DesignState, modifiers: Set<'check'|'premove'|'low_time'|'viewing'|'promotion'|'draw_received'|'reconnecting'|…>, zone, actions, bars, toast }`. The primary state is exposed as `data-phase` on `[data-testid="game-board-container"]` for tests; modifiers combine (for example `check` + `premove`), with a fixed precedence for the zone: `result` > `error` > `reconnect` > `disc` > `viewing` > `waiting` > `study` > `abort` > `spect` > `coach` > none.

### 4.4 Component tree

All new files are client components unless marked RSC. P1 kit components are named in brackets.

```
WEB/app/(app)/game/[ref]/page.tsx (RSC)           getViewer · requireMemberPage · getGameSnapshot · mintSocketToken
└─ <GameScreen snapshot token flags>               WEB/features/game/screen/GameScreen.tsx
   ├─ GameControllerProvider                        live (useLiveGame) | local (useLocalGame) | legacy (flag off)
   ├─ <BoardStage label="Board" asideWidth="game"   [P1 components/layout/BoardStage]
   │     top={<PlayerBar side=top/>} bottom={<PlayerBar side=bottom/>}
   │     board={<GameBoardArea/>} aside={<GamePanel/>} footer={<GameActionBar/>}>
   │  ├─ PlayerBar            features/game/screen/PlayerBar.tsx   [Avatar, Tag (WON/LOST/DRAW)]
   │  │   └─ ClockChip        features/game/clock/ClockChip.tsx    (subscribes to the clock store only)
   │  │   └─ DisconnectRing   features/game/screen/DisconnectRing.tsx (SVG ring, text countdown)
   │  ├─ GameBoardArea        features/game/screen/GameBoardArea.tsx
   │  │   ├─ Board            components/board/Board.tsx (V3MoveBoard)
   │  │   └─ InGameChips      features/game/screen/InGameChips.tsx [P1 InGameStatusChip]
   │  ├─ GamePanel            features/game/screen/GamePanel.tsx (desktop/iPad L aside; stack: zone + strip)
   │  │   ├─ GameHeader       header / headerR
   │  │   ├─ PanelZone        features/game/screen/zones/{Loading,Waiting,Study,Coach,Viewing,Reconnect,
   │  │   │                    Disconnected,Abort,ServerError,Ended,Spectating}Zone.tsx
   │  │   ├─ GameOverCard     features/game/screen/GameOverCard.tsx (zone `result`; ResultSheet = same card in stack mode)
   │  │   ├─ StatusLine       role=status
   │  │   ├─ MoveList         features/game/screen/MoveList.tsx [ScrollRegion] (side mode)
   │  │   ├─ MoveStrip        features/game/screen/MoveStrip.tsx + MovesSheet.tsx [Sheet] (stack mode)
   │  │   ├─ OfferBar         draw | rematch_in | rematch_out
   │  │   └─ GameToast        in-panel toast (aria-live polite)
   │  └─ GameActions / GameActionBar  features/game/screen/GameActions.tsx [IconButton, Button, Kbd]
   │      ├─ GameMenu         [Menu]: Resign… / Abort game, Flip board, Sound · on/off, Board settings (hidden; P10 lights it, handoff H-05)
   │      ├─ ResignPopover    [Popover] (desktop) / [Sheet] (phones)
   │      └─ ShareMenu        [Menu]: Copy link, Download PGN (P3 adds Share image)
   ├─ LiveGamesSheet          [ResponsiveDialog] (spectator "Watch another game")
   ├─ LiveRegions             polite (moves) + assertive (check, 10 s, offers, disconnects, game over)
   └─ useGameHotkeys          [P1 useHotkeys scope "page"]
```

### 4.5 The board (`V3MoveBoard`, `WEB/components/board/`)

#### 4.5.1 Files

| File | Content |
|---|---|
| `Board.tsx` | Public component; composes the layers; owns the input state machine through `useBoardInput` |
| `board.css` | Square colours from DS tokens (`board-light-*`, `board-dark-*`, `board-last-move`, `board-capture`, highlight set), piece shadow, ghost, shake keyframes, slide transition, reduced-motion overrides; in `@layer components` |
| `SquareLayer.tsx` | 64 static `[data-square]` cells (CSS grid, `role="gridcell"` buttons, roving tabindex); rendered once per orientation |
| `PieceLayer.tsx` | Absolutely positioned `<img>` pieces (`/chess-icons/{wk,…}.png`, plain `<img decoding="async">`, not `next/image`), keyed by a stable piece id, placed with `transform: translate(x·100%, y·100%)`; slide 180 ms ease-out, capture fade 120 ms |
| `OverlayLayer.tsx` | Last move, selection (amber wash + inset ring), legal dots (`.rounded-full`, kept for the e2e fixture), capture corners (inline `rgba(220, 80, 80, 0.45)`, kept), check radial, premove from/to (red tint), `hl` map, `ring` map |
| `ArrowLayer.tsx` | One SVG with `viewBox="0 0 800 800"` (square = 100 units), arrows `{from, to, color}` from props plus right-drag arrows (local, not sent), knight arrows as an L; colours `arrow-default`, `pv-*` at 50 % shaft / 65 % head (DS ChessBoard README) |
| `BadgeLayer.tsx` | Move-quality and end-of-game badges at the top-right corner of a square, 34 % of the square, offset −9 % clamped inside the board on the top rank and the h-file (relative to orientation); owner icons from `public/board_icons/svg/*.svg` |
| `PromotionPicker.tsx` | Column of Q, R, B, N on the promotion file (towards the centre of the board), queen ringed, ESC button; `role="menu"`, four `menuitem`s "Promote to queen" …; keys `Q R B N`, `Esc` |
| `Ghost.tsx` | Dashed amber outline + 50 % piece for a premove or a queued move |
| `useBoardInput.ts` | Pointer down/move/up with pointer capture, 4 px drag threshold, drag lift 1.06 + shadow + z 30; click-click; right-click/right-drag arrows; Esc; touch long-press (350 ms) then drag draws an arrow during study; drag position applied with `transform` from a ref inside `requestAnimationFrame` (no React state per `pointermove`, optimization §2.4) |
| `useKeyboardBoard.ts` | Arrow keys move focus over the grid, Enter/Space selects and drops, Esc cancels |
| `MoveInput.tsx` | Desktop-only text input under the board ("Type a move, for example Nf3"), same validation and reasons; hidden visually unless focused or enabled in settings later (P10) |
| `geometry.ts` | Square ↔ index ↔ % position for both orientations; `diffPieces(prevFen, nextFen, move)` → stable ids for animation (castling moves the rook, en passant removes the right pawn, promotion swaps the piece at the end of the slide) |
| `MiniBoard.tsx` | Static SVG board for lists (56 px default, warm `article-board-*` squares, no coordinates), used by P3+ and the live games sheet |
| `types.ts` | Props below |

#### 4.5.2 Props

```ts
export type Side = "w" | "b";
export type Sq = `${"a"|"b"|"c"|"d"|"e"|"f"|"g"|"h"}${1|2|3|4|5|6|7|8}`;
export interface BoardMove { from: Sq; to: Sq; promotion?: "q" | "r" | "b" | "n"; uci: string }
export interface BoardProps {
  fen: string;                                   // position to show (live or viewed ply)
  orientation: Side;                             // "orient" in V3MoveBoard
  mover: Side | null;                            // which colour may move now; null = no input
  premover?: Side | null;                        // colour that may queue a premove (opponent's turn)
  dests: (from: Sq) => Sq[];                     // legal targets for the mover (from game-core)
  premoveDests?: (from: Sq) => Sq[];             // pseudo-legal targets after a null move
  onMove: (m: BoardMove) => void;                // validated move (promotion already chosen)
  onPremove?: (m: BoardMove | null) => void;     // set (null = cancel)
  onIllegal?: (from: Sq, to: Sq) => void;        // parent asks game-core for the reason
  onLockedAttempt?: () => void;                  // drag during study → "Moves are locked during the study phase"
  lastMove?: [Sq, Sq] | null;
  check?: Sq | null;                             // king square in check
  highlights?: Record<Sq, string>;               // "hl": token name or CSS colour
  rings?: Record<Sq, string>;                    // "ring": inset ring colour
  arrows?: { from: Sq; to: Sq; color?: string }[];
  allowDrawArrows?: boolean;                     // right-drag (study, play) — local only
  badges?: { sq: Sq; kind: BadgeKind; label: string }[];   // BadgeKind = 12 move-quality labels | "mate" | "win" | "flag" | "draw"
  ghost?: { sq: Sq; piece: string } | null;      // premove / queued move
  dimmed?: boolean;                              // waiting, viewing (0.9 opacity)
  thumb?: boolean;                               // static, no input, no coordinates
  coordinates?: boolean;                         // default true
  animationMs?: number;                          // default 180; 0 when reduced motion or snapping to a resync
  label: string;                                 // aria-label of the grid
  testId?: string;                               // default "chess-board"
}
```

Shape (`DS/components/ChessBoard/README.md`): neutral bevelled squares (never brand-tinted), 1 px white/20 % border and `shadow-board`; coordinates rank top-left on the a-file and file bottom-right on the first rank, `clamp(7px, 2cqw, 12px)`; legal dot `clamp(10px, 3cqw, 18px)`.

#### 4.5.3 Input contract (from `V3GamePrototype`, play-a §7.30)

1. **Pointer down** on a piece of `mover` (or `premover`): select it, capture the pointer, show targets (dot on empty squares, corner triangles on captures). Status line hint for the selection comes from the parent ("King selected · castling long is legal": `game-core` `describeSelection()`).
2. **Drag** after 4 px: the piece follows the pointer at scale 1.06 above other pieces; **drop** on a target moves with no slide; drop elsewhere shakes the piece back (2 × 180 ms keyframes) and calls `onIllegal` (toast "That move isn't legal. The piece went back." when no specific reason applies).
3. **Click-click:** pointer up without drag keeps the selection; a click on a target moves with the 180 ms slide; a click on the selected piece deselects; a click on an enemy piece that is not a target shakes (illegal); a click on an empty non-target deselects.
4. **Promotion:** a pawn move onto the last rank opens the picker; the move is not emitted until a piece is picked (the server requires the piece, play-a B12).
5. **Premove** (opponent's turn, live games only, §14 Q10): select and drop on any `premoveDests` square; red-tinted from/to + ghost; Esc, right-click or a click on its from-square cancels.
6. **Right-drag** draws an arrow (green; Shift = red, Alt = blue); right-click on a square toggles a highlight; a left click anywhere clears them (arrows are local and cleared at the first move after study).
7. **Touch:** tap-tap is the primary path (tap targets ≥ 44 CSS px: squares are 49 px on a 393 px phone); drag works with `touch-action: none` on the board; long-press then drag draws an arrow during study.
8. **Keyboard:** grid focus with arrows, Enter/Space to pick up and drop; `MoveInput` accepts SAN or UCI.

#### 4.5.4 Performance rules

- One `chess.js` instance per game lives in the controller, not in the board (today `GamePageContent.tsx:55` creates one per render path).
- The square layer never re-renders on a move; the piece layer re-renders only the moved pieces (stable keys); the overlay layer re-renders on selection and last-move changes.
- No `transition-all`; only `transform` and `opacity` animate (audit-quality PERF-07).
- Sizes are relative (`%`, `cqw`), so the board never measures itself; the ResizeObserver path of the legacy board is not used.

#### 4.5.5 Accessibility

`role="grid"` with 8 `row`s and 64 `gridcell` buttons labelled "e4, white knight" / "e4, empty", `aria-describedby` "legal move" on targets; the grid's `aria-label` is the `label` prop ("Board. You are White."). Pieces are `aria-hidden` images; the cell label carries the meaning. Focus outline 2 px `#1a1a1a` (DS `:focus-visible`).

#### 4.5.6 Test hooks kept

`[data-square="e4"]` on every cell, `.rounded-full` legal dots, capture corners with the inline `rgba(220, 80, 80, …)` style, `data-testid="chess-board"` + `data-size="fill"` on the board root, and the container `[data-testid="game-board-container"]` (rendered by `GameBoardArea`) with `data-game-started`, `data-player-color`, `data-current-turn` (kept for `WEB/e2e/fixtures/chess-board.ts:93-139`) plus the new `data-phase` (primary design state), `data-ply`, `data-role` (`player`/`spectator`) and `data-mode`.

### 4.6 Interactions and keyboard shortcuts

#### 4.6.1 Keys (`useGameHotkeys`, P1 `useHotkeys` scope `page`; rows added to the `V3Shortcuts` "In a game" section)

| Key | Action | Where |
|---|---|---|
| `←` `→` | previous / next ply (`viewing`) | all games |
| `↑` `↓` | first / latest ply | all games |
| `F` | flip board | all |
| `Esc` | cancel premove, then promotion, then close the top popover/menu/sheet | all |
| `D` | offer draw (live, `playing`) | live |
| `M` | sound on/off | all |
| `H` | hint (twice for the arrow) | bot |
| `U` | undo | bot |
| `Q` `R` `B` `N` | pick in the promotion picker | promotion |
| `Enter` | activates the focused button (resign popover defaults to Keep playing) | — |

Single-letter keys are ignored inside inputs and when P1's "Single-key shortcuts" switch is off (SPEC D20). `⌘K` and `?` stay global.

#### 4.6.2 Sounds (`WEB/features/game/sound/sounds.ts`)

The 11 existing files in `WEB/public/sounds/*.webm` (84 KB total) are fetched and decoded into Web Audio `AudioBuffer`s **on the first user gesture** on the game page (not at mount), with `immutable` caching. Events: move-self, move-opponent (same file, lower gain), capture, castle, check, promote, premove, illegal, tenseconds (once when your clock crosses 10 s), game-start (at `playing`), game-end, notify (draw offer, rematch offer, opponent disconnected). Spectators: quiet by default ("sound quiet"), only game-end. `M` and the menu toggle persist in `localStorage` `rc:sound:v1` (try/catch).

#### 4.6.3 Move list and history

Cells are buttons with `aria-current="true"` on the viewed ply; legend prefix moves (from `GameState.prefix`) render muted and are not clickable as yours, followed by the dashed amber divider **"Game starts here"** (DS: legend's moves sky, yours neutral). Viewing history never pauses the clock. After 200 plies the list virtualises (`@tanstack/react-virtual` if P1 added it, else a windowed slice). Phones show the last 8 plies in the strip; tap opens the full list in a `Sheet`.

#### 4.6.4 Motion

180 ms slides, 120 ms capture fade, 200 ms toast entry, 1.2 s pulse, ring countdown. Under `prefers-reduced-motion: reduce`: instant moves, outline flash instead of shake, no ring animation (text countdown stays), no pulsing chips.

### 4.7 Loading, empty and error states

| Case | What renders | Source |
|---|---|---|
| Route loading (navigation) | `loading.tsx`: `BoardStage` with skeleton bars, a skeleton board (8 × 8 neutral grid, no pieces) and a skeleton panel (`V3Skeletons` game variant) | P1 `Skeleton` |
| RSC snapshot rendered, socket connecting | state `loading` (board already drawn from the snapshot; no layout shift: the board size is CSS-only) | §5.1 |
| Game not found or not visible | `not-found.tsx` inside the shell: "This game doesn't exist · It may have been cancelled, or the link is wrong." Back to Play | `notFound()` from the RSC |
| Non-member | redirect `/pricing?reason=<trial_available\|trial_used\|expired\|payment_failed>&redirect_url=/game/<ref>` (exception: a player of an `IN_PROGRESS` game whose membership lapsed mid-game may load and finish it, §11) | `requireMemberPage({allowLivePlayer: ref})` |
| Signed out | middleware → sign-in with `redirect_url` | P1 |
| Socket token 401 | `in_game_refresh` chip ("Auth… refreshing sign-in · retry in 0:03"), retry every 3 s up to 2 min; success → `in_game_ok` ("Signed in · game continues", fades after 3 s); still failing → the game continues on the open socket; the session-expired modal opens after the game ends | `V3SessionExpired` |
| Socket `upgrade_required` (old bundle) | chip "Update ready · installs after this game"; reload after `game:ended` | P11 owns the full flow; P2 shows the chip |
| Engine failed to load (bot) | zone error "The engine couldn't start on this device. This browser may block WebAssembly." Try again (clears the cache entry) | §5.3 |
| Second tab of the same bot game | zone "This game is open in another tab" + Use this tab (BroadcastChannel `rc-game-<ref>`) | §5.3 |
| Legacy flag off | `WEB/features/game/legacy/GamePageContent.tsx` for live human games | §7.10 |

### 4.8 Copy notes (differences from the mocks, all deliberate)

| Mock copy | P2 copy | Why |
|---|---|---|
| headerR "Blitz 5+3 · rated" | "Blitz 5+3 · unrated" (friend: "Friend game · 5+3"; bot: "vs Engine 1400 · unrated") | no ratings until P9 |
| Resign: "martin_k wins and you lose about 8 rating points. The coach will still review it." | "Resign this game? martin_k wins." (bot: "Resign this game? The engine wins.") | stakes are P9; review is P3 |
| Opponent disconnected body: "If they don't reconnect, you win on time. Keep thinking; your clock is paused." | Opponent to move: "If they don't come back in time, you win. Their clock keeps running." · You to move: "Your clock is running. If they don't come back, you win." | clocks are never paused for a disconnect (§8.6); owner Q4 |
| Result CTA "See what the coach thinks" | "Analyse game" → `/analysis/[ref]` | P3 replaces it |
| Rating line "Blitz 1184 → 1192 (+8)" | not rendered | P9 |
| `already_ended` "Open review" | "Analyse game" | P3 |
| Insufficient "Only kings left" | names the actual material ("King and knight vs king") | correctness |
| `over_aborted` "No first move within 30 s" | also "Aborted by martin_k" / "You aborted the game" when a player aborted | the design has one reason only |
| Reconnecting during a deploy | "Server update · back in a few seconds · clocks are paused" | clocks are frozen during a drain (§7.6) |

All copy follows P1's rules (`lib/shell/copy.test.ts`): Title Case on buttons, sentence case for toasts and descriptions, no emoji, uppercase only through CSS. Strings live in `WEB/features/game/copy.ts` (one module, unit-tested for the per-state table above).

### 4.9 Dev demo route (all 55 states without a server)

`WEB/app/dev/ui/game/page.tsx` (fails closed outside dev/test, SPEC D11): `?state=<one of the 55>&device=auto&flip=0&side=w&mode=live|bot|spectate&debug=1`. It renders the real `GameScreen` with a `DemoController` fed by `WEB/features/game/demo/fixtures.ts` (one `GameState` + store patch per state, reusing the Opera Game line of the template, `L.MAIN`). Every state in the enum is reachable here (DoD §1.1 rule 4); states that need real time (study countdown, grace ring, low time) run on `page.clock` in tests. The device × zoom suite and visual baselines use this route.

---

## 5. UI ↔ API data flow

Conventions inherited from P1 (`client-data-layer.md` §2–§5, allocation §5.4): first paint from server components calling service functions; TanStack Query v5 with keys from `WEB/lib/api/keys.ts`; one error envelope (B16) and one `QueryProvider` error router; the socket `user:{ref}` room patches caches; no polling except as a visible-tab fallback. **The live game is not in the query cache**: it lives in a per-game Zustand store fed by the socket (client-data-layer §5.7).

### 5.1 First paint: the RSC page

```tsx
// WEB/app/(app)/game/[ref]/page.tsx (server component)
export const dynamic = "force-dynamic";                         // per-user, never cached
export const metadata = { title: "Game", robots: { index: false } };

export default async function GamePage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const viewer = await getViewer();                              // React cache(); already read by (app)/layout → 0 extra queries
  const snap = await getGameSnapshot(ref, viewer);               // 1 query, React cache() (WEB/lib/games/snapshot.server.ts)
  if (!snap) notFound();
  await requireMemberPage(viewer, {                              // redirect /pricing?reason=…&redirect_url=/game/<ref>
    allowLapsedLivePlayer: snap.you.role === "player" && snap.status === "IN_PROGRESS",
  });
  if (snap.you.role === "spectator" && !snap.watchable) notFound();
  const flags = await getFlags(viewer, ["game-v3", "live-protocol-v2"]);   // memoised per request (P1 F6)
  return <GameScreen snapshot={snap} flags={flags} />;           // the socket token is already seeded by RealtimeBoot in (app)/layout
}
```

- **Database cost:** 1 query after the viewer (budget class R1, ≤ 2 sequential round trips). `getGameSnapshot` selects `games` by `referenceId` (unique) with a `LEFT JOIN` of both players' `users` (referenceId, name, profilePictureUrl) and their `chess_com_profiles` ratings, never `gameData` (explicit `select`). The role comes from comparing `viewer.id` with `whitePlayerId`/`blackPlayerId`.
- **Payload:** `GameSnapshot` = `GameState` (§7.4.6) + `status`, `watchable`, `updatedAt`, `rev` (bot). ≤ 2 KB at 80 plies; the page HTML stays ≤ 40 KB (optimization §5.6). Dates are epoch ms, ids are refs, no BigInt.
- **Freshness:** for a live game the DB row lags the socket by at most one checkpoint (≤ 10 plies or 15 s). The board paints from it immediately in `loading`, then the `game:join` ack **replaces** the state with animation disabled for that one update (no slide storm, no layout shift since the board size is CSS-only). For a bot game the local journal may be newer (§5.3).
- **Finished games** render the result card straight from the row (`already_ended` when the viewer did not just finish it, i.e. `endedAt` older than 2 minutes or no live store in memory), with no socket connection at all.
- **No client fetches on mount.** Today's page makes up to five (`/api/user/email/{email}`, `/api/socket-token`, 3 × `game-by-ref`; play-a B24).

### 5.2 Live human games (friend, quick match, tournament)

#### 5.2.1 Pieces

| Piece | File | Role |
|---|---|---|
| Connection manager | `WEB/lib/realtime/connection.ts` | One socket per tab (client-data-layer §5.1): lazy, ref-counted holds (`game` is critical, never disconnected while hidden), `room(key, join, leave)` re-joins after every reconnect, token seeded from the layout and refreshed 2 min before `exp`, `retryOnUnauthorized` (from `WEB/lib/hooks/useSocketToken.ts:96-135`), `connect_error "upgrade_required"` → update chip, `navigator.onLine` handling. P1 shipped `RealtimeBoot` as a stub; P2 makes it real |
| Connection hook | `WEB/lib/realtime/useConnection.ts` | `useSyncExternalStore` over `ConnState` (`idle, connecting, live, reconnecting, offline, unauthorized, upgrade_required`) |
| Game store | `WEB/features/game/store.ts` | `createGameStore(snapshot)`: vanilla Zustand per game instance, provided by context; reducer from `@repo/game-core/client` (pure, unit-tested) |
| Clock store | `WEB/features/game/clock/clockStore.ts` | Separate external store; one rAF loop while a clock runs and the tab is visible; only the two `ClockChip`s subscribe |
| Live controller | `WEB/features/game/live/useLiveGame.ts` | Implements `GameController` (§5.2.6) over the socket |
| Socket binding | `WEB/features/game/live/useGameSocket.ts` | Handlers, join/sync, commands with acks |
| Outbox | `WEB/features/game/live/outbox.ts` | At most one own move while not `live` |
| Premove | `WEB/features/game/live/premove.ts` | One queued move, validated on the next `move:applied` |

#### 5.2.2 Join, gap detection and resync

```
GameScreen mounts ─► realtime.acquire("game")
                 ─► realtime.room(`game:${ref}`, join, leave)       // join runs now and after every reconnect
join(): ack = await command(role === "player" ? "game:join" : "spectate:join", { ref, lastSeq: store.seq })
        ok  → store.replace(ack.state)            // the snapshot wins; animation off for this update
              outbox.flush(ack.state)             // §5.2.4
        err → map code (§5.5)
events  → store.apply(event)                      // reducer checks event.seq === store.seq + 1
          gap (seq > store.seq + 1) → command("game:sync", { ref }) → store.replace(ack.state)
          stale (seq ≤ store.seq)   → ignored (duplicate after a resync)
```

- `seq` is per game and per room (players and spectators have independent sequences, because spectators get delayed events).
- `game:sync` is the **only** recovery path (socket §17.1.3). The REST re-hydrate (`GamePageContent.tsx:352-385,414-416`) is deleted.
- After three failed syncs (ack timeout or `internal`), the store enters `server_error`; "Reload game" retries `game:sync`, then `router.refresh()`.

#### 5.2.3 Making a move

```
Board.onMove(m)
 └─ controller.move(m):
     1. local validation (game-core rules) — illegal → `illegal` toast + shake, nothing sent
     2. store.applyOptimistic(m)                          // board updates in the same frame, move sound
     3. pending = { clientMoveId: crypto.randomUUID(), uci: m.uci, ply: store.ply }   // ply = plies already played
     4. if !realtime.isLive() → outbox.queue(pending)       // ghost + "queued" copy, state `reconnecting`
        else ack = await command("game:move", { ref, ...pending, premove: false }, 5000)
     5. ack.ok            → store.confirm(ack)              // adopt { ply, san, clocks, seq }; fen stays the locally derived one
        ack.ok === false  → store.replace(ack.state) + `rejected` toast (codes illegal, stale_ply, not_your_turn, phase)
        timeout (5 s)     → command("game:sync")            // the ack was lost; the snapshot decides
```

- A move ack that arrives after `move:applied` for the same ply is idempotent: the mover's reducer matches the pending move on `ply` + `uci` (the broadcast carries no `clientMoveId`); the ack's `clientMoveId` clears the outbox entry.
- Multi-tab: every socket of the player is in `game:{ref}`; the other tab receives `move:applied` like the opponent does and replays it (no optimistic state there).
- The "pending" ring on the moved piece appears only if the ack takes > 400 ms (optimization §2.4).

#### 5.2.4 Reconnect and the outbox

- On `disconnect`/`offline`, the store enters `reconnecting` immediately (the UI does not wait for socket.io's own timeout). The own grace countdown ("Reconnect within 0:18") is local: `30 s − (now − lastServerMessageAt)`. "Reload game" appears after 25 s.
- While not live, one own move may be queued (shown as a ghost). Further drops are refused with the toast "One move is already queued."
- On rejoin: if `ack.state.moves.length === queued.ply` and it is still your turn, send it (`game:move`) → `reconnected` "Back online. Bxd7+ was sent."; otherwise drop it with the `rejected` toast.
- If the reconnect follows a `server:restarting` notice, the zone shows the restart variant and no countdown (clocks are frozen server-side, §7.6).

#### 5.2.5 Premove

Set only while `phase = playing`, `turn ≠ you`, live games only. On `move:applied` from the opponent the reducer applies their move, then `premove.tryFire(state)`: if legal in the new position → `game:move { premove: true }` in the same task (the server charges at least 100 ms, §8.4); else clear it → `premove_cancelled`. Esc, right-click, a click on its from-square, `viewing`, or a resync clears it.

#### 5.2.6 The controller interface (shared by live, local and demo)

```ts
// WEB/features/game/controller.ts (WP-G writes it on day 1; WP-H implements it for bots)
export interface GameController {
  kind: "live" | "local" | "demo";
  store: GameStore;                                 // view state comes from deriveViewState(store)
  move(m: BoardMove): void;
  setPremove(m: BoardMove | null): void;
  ready(): void;                                    // study:ready
  abort(): void; resign(): void;
  offerDraw(): void; answerDraw(accept: boolean): void;
  offerRematch(): void; answerRematch(accept: boolean): void; cancelRematch(): void;
  hint?(): void; undo?(): void; restart?(): void;   // local only
  sync(): void;                                     // "Reload game"
  destroy(): void;
}
```

#### 5.2.7 Clocks on the client

- Server clock state `{w, b, run, at}` (ms, server epoch) rides on `move:applied`, `game:phase`, `clock:sync` and every snapshot.
- Offset: `clock:ping {c}` every 10 s while the game page is visible and `phase ∈ {study, first_move, playing}`; ack `{c, s}`; `rtt = now − c`, `offset = s + rtt/2 − now`; EWMA α = 0.2. `serverNow() = Date.now() + offset`.
- Display: `remaining(side) = clocks[side] − (clocks.run === side ? serverNow() − clocks.at : 0)`, clamped at 0. The client never ends a game on its own flag; it shows `0:00` and waits for `game:ended` (the server flags within ~20 ms).
- Countdowns (study, first move, grace, rematch) render from absolute `endsAt` values the same way.

#### 5.2.8 Other live flows

| Flow | Client call | Server reply | UI |
|---|---|---|---|
| Study ready | `study:ready {ref}` | ack `{ready:{w,b}}`; `study:ready` to the room; `game:phase first_move` when both | **optimistic:** own bar flips to "Ready" and the button to "Waiting for martin_k…" before the emit; a negative ack (`phase`) rolls back. Opponent bar "Ready" comes from `study:ready` |
| Abort | `game:abort {ref}` | `game:ended {method: aborted}` | `over_aborted` |
| Resign | `game:resign {ref}` | `game:ended {method: resignation}` | `over_resign_loss` |
| Draw | `draw:offer` / `draw:accept` / `draw:decline` | `draw:offered` / `game:ended agreement` / `draw:declined {canOfferAtPly}` | `draw_sent`, `draw_received`, `draw_declined`. **Optimistic:** `store.drawOffer = {by: you, pending: true}` is set before the emit, so `draw_sent` shows at once (a US player otherwise waits one Mumbai RTT, ≈ 250 ms); a negative ack (`phase`, `draw_cooldown`) rolls back and shows the cooldown toast. Decline removes the offer card locally and re-inserts it on a negative ack |
| Rematch | `rematch:offer` / `accept` / `decline` / `cancel` | `rematch:offered {expiresAt, youPlay}`; `rematch:started {newRef, yourColor}`; `rematch:declined`; `rematch:expired {reason}` | `over_rematch_*`; **optimistic** `over_rematch_sent` with a local `expiresAt` estimate, replaced by the server value from the ack; decline/cancel remove the bar locally and roll back on a negative ack; on `rematch:started` → `router.replace('/game/' + newRef)` (RSC render of the new game, then `rematch_study`) |
| Spectator count | — | `spectators:update {count}` ≤ 1 per 5 s | "12 watching" |
| Live list | `live:list {}` (ack ≤ 20 cards) | from memory | `LiveGamesSheet` (cached as query `qk.games.live()`, staleTime 15 s, queryFn = the socket command) |
| Restart notice | — | `server:restarting {restartAt, resumes: true}` | chip "Server restarting in 0:30 · Games in progress will resume. Keep playing." |
| Token refresh | `session:refresh_token {token}` after a refresh | ack `{ent}` | none (silent) |

#### 5.2.9 After the game

On `game:ended` for a player: `router.prefetch('/analysis/' + ref)` (P3 switches this to `/review/[ref]`), `queryClient.invalidateQueries({ queryKey: qk.games.all(), refetchType: "none" })` (lists refetch when next viewed; P3's `games:changed` event takes over), PostHog `game_over_viewed`. Reloading the page renders the card from the DB (§5.1).

### 5.3 Bot games (client-run, never on the socket)

#### 5.3.1 Create

```
Entry point (legacy /play "vs Computer", /queue no-opponent fallback, /position "Play vs bot", bot Rematch/Restart)
 └─ useCreateBotGame().mutate(body)                       // WEB/lib/api/mutations/games.ts
     headers: Idempotency-Key = sessionStorage["rc:idem:bot:" + sha1(canonical(body))] (new UUID, kept 60 s)
     POST /api/games  → 201 { game: GameSnapshot }
     onSuccess: queryClient.setQueryData(qk.games.detail(ref), game); router.push(`/game/${ref}`)
     402 → QueryProvider routes to /pricing?reason=…&redirect_url=<current page>
     409 in_flight → retry after retryAfterSec (2 s) once; 422 → inline error on the entry page
```

The engine WASM is prefetched (`<link rel="prefetch" as="fetch" crossorigin>`) when the "vs Computer" option gets focus or hover on `/play`, so the game page usually starts with a cached engine.

#### 5.3.2 Play

| Concern | Mechanism |
|---|---|
| Rules, clocks, end detection | `@repo/game-core/local` runner (`createLocalGame`), monotonic `performance.now()` clock, clocks start after two plies, no study and no first-move abort timer (Abort button available before 2 plies) |
| Engine | `EngineProvider` (lazy singleton worker, `WEB/features/engine/EngineProvider.tsx`): `uci` → `uciok` (8 s timeout) → options from the strength ladder (§8.13) → `go nodes N` with a 3 s `stop` cap; bot "thinks" 450–850 ms minimum (prototype `botMove`) |
| Hint | `H`: full-strength search (`UCI_LimitStrength false`, `go movetime 300`), level 1 names the piece, level 2 draws the arrow and the SAN (§8.14); `meta.hints++` |
| Undo | `U`: takes back your last move and the bot's reply (or only yours while the bot is thinking), restores the clocks recorded before your move; `meta.undos++`; toast "Took back 11.Bxb5+ and 11…Nbd7." |
| Draw offer | bot answers after 1.5–2.5 s with `drawPolicy` (§8.15) |
| Journal | after every move: `localStorage["rc:bot:<ref>"] = {v:1, rev, moves, clocksMs, startedAt, assists:{hints, undos}, updatedAt}` (try/catch; ~1 KB) |
| Checkpoint | `navigator.sendBeacon('/api/games/<ref>/checkpoint', Blob(JSON, "text/plain"))` on `pagehide` and `visibilitychange: hidden`; `fetch(..., {keepalive:true})` every 10 plies while visible. Body carries `rev` (monotonic, increments on undo too) so an undo is not shadowed by an older longer line |
| Resume order | on load: the journal if `journal.rev > snapshot.rev`, else the server snapshot (other device) |
| Two tabs | `BroadcastChannel("rc-game-<ref>")`: the newest tab takes the lock; the other shows "This game is open in another tab · Use this tab" |
| Visibility | the human's clock pauses while the page is hidden (default, §14 Q6); the bot never moves while hidden |

#### 5.3.3 Complete

```
end detected locally (or resign / abort / draw accepted by the bot / flag)
 └─ useCompleteBotGame().mutate({ moves, clocksMs, result, method, assists, endedAtClient, rev })
     POST /api/games/<ref>/complete → 200 { status, outcome, method, analysis: { status: "none" } }
     retries: 1 s, 4 s, 15 s (only on network errors and 5xx; 409/422 are final)
     still failing → journal keeps { pendingComplete: body }; `useFlushPendingBotCompletes()` (mounted once
                     in (app)/layout) retries on the next app load or `online` event
     onSuccess: setQueryData(qk.games.detail(ref), …); invalidate qk.games.all() (refetchType none); remove the journal
     422 illegal_moves (incl. reason claim_mismatch) → toast "This game couldn't be saved." + Sentry error with the ref (no PGN in the event)
```

### 5.4 Query keys, mutations, invalidation and prefetching in P2

| Key / mutation | Endpoint | `staleTime` | Seeded by | Invalidated by |
|---|---|---|---|---|
| `qk.games.detail(ref)` (new in `WEB/lib/api/keys.ts`) | `GET /api/games/[ref]` | `0` while `status = IN_PROGRESS`; `Infinity` once completed (immutable in P2) | the RSC snapshot (`HydrationBoundary` not needed: the store owns live state; the key is seeded with `setQueryData` from `useCreateBotGame` and on `game:ended`) | `useCompleteBotGame` success |
| `qk.games.live()` (new) | socket `live:list` | 15 s | — | `LiveGamesSheet` open |
| `qk.games.all()` (prefix, exists from P1 keys) | — | — | — | `game:ended`, `useCompleteBotGame` (refetchType `none`) |
| `useCreateBotGame()` | `POST /api/games` | — | — | sets `qk.games.detail(ref)` |
| `useCompleteBotGame()` | `POST /api/games/[ref]/complete` | — | — | as above |
| `useCancelLegacyChallenge()` | `POST /api/chess/cancel-game` (legacy, until P9) | — | — | `router.push('/play')` |
| Checkpoint | `sendBeacon` / `fetch keepalive` (not a TanStack mutation) | — | — | — |
| PGN | plain link: `<a href="/api/games/<ref>/pgn" download>` (`private, no-store`). No image link until P3's shares (§7.1.6) | — | — | — |

Prefetching: `router.prefetch('/game/' + ref)` after a create; `/analysis/[ref]` on `game:ended`; `/play` on hover of New game; the engine WASM on bot intent. No polling anywhere in P2.

### 5.5 Error handling

#### 5.5.1 HTTP (one envelope, B16; global reactions from P1's `QueryProvider`)

| Status · code | Where in P2 | UI |
|---|---|---|
| 401 `unauthorized` | any `/api/games*` | P1 `SessionExpiredModal` (returns to the same URL). In a live game the modal is deferred until `game:ended` |
| 402 `subscription_required` (+`reason`) | `POST /api/games`; `/game/[ref]` RSC (redirect) | `/pricing?reason=<reason>&redirect_url=<path>` |
| 403 `forbidden` | checkpoint/complete by a non-player; PGN of someone else's game | toast "You can't change this game." |
| 404 `not_found` | unknown ref | `not-found.tsx` |
| 400 `validation_failed` (incl. `details.reason: "mode_not_available"`) | create, checkpoint, complete | inline error on the entry page, or "This game couldn't be saved." |
| 409 `conflict` (`details.reason`: `already_completed` with the stored result → treated as success; `already_started`; `not_bot_game`; `not_finished` for PGN; `rev_gap` for checkpoint) | complete; create; PGN; checkpoint | silent / toast |
| 409 `in_flight` (`retryAfterSec`) | create | one silent retry |
| 413 `payload_too_large` | checkpoint > 8 KB, complete > 16 KB | Sentry (a bug) |
| 422 `illegal_moves` (incl. `details.reason: "claim_mismatch"`) / `illegal_position` / `idempotency_key_reused` | create, checkpoint, complete | inline error or "This game couldn't be saved." |
| 429 `rate_limited` | create (`create-game` bucket), checkpoint (`bot-checkpoint` bucket) | create: P1 `RetryCountdown` inline on the entry page; checkpoint: silent, the next checkpoint carries the state |
| 5xx | any | toast with the request id (P1) |

#### 5.5.2 Socket codes → UI

| Ack/error code | Meaning | UI |
|---|---|---|
| `unauthorized` (connect_error) | bad or expired token | `in_game_refresh` chip, retry `GET /api/socket-token` every 3 s for 2 min |
| `not_member` | `ent` expired and the command needs membership (spectate, rematch accept, new live game) | `/pricing?reason=expired&redirect_url=…` (players of a live game are never refused) |
| `paywall` | the *other* player is not a member (rematch) | toast "martin_k can't play a rematch right now." |
| `forbidden` | `game:join` by a non-player, spectating a non-watchable game | `not-found` view |
| `not_found` | unknown ref | `not-found` view |
| `phase`, `ended` | command not allowed now | `ended` → `already_ended`; others: silent resync |
| `not_your_turn`, `illegal`, `promotion_required`, `stale_ply` | move refused | `rejected` toast + snapshot from the ack |
| `draw_cooldown` (`canOfferAtPly`) | offer too soon | button stays disabled with the tooltip "You can offer again in 2 moves" |
| `no_offer`, `not_allowed`, `expired` | stale draw or rematch answer | bar removed, toast for `expired` |
| `rate_limited` (`retryAfterMs`) | over the per-socket bucket | toast "Slow down a little." (never for a single move) |
| `draining` | server is restarting; no new games/rematches | toast "The server is restarting. Try again in a minute." |
| `internal` / ack timeout | server fault | `game:sync`; after 3 failures `server_error` |
| `upgrade_required` (connect_error) | old bundle | chip "Update ready · installs after this game" |

### 5.6 Entry points that lead to `/game/[ref]` in P2

| Entry (legacy page, file:line) | Today | P2 |
|---|---|---|
| `/play` friend (`WEB/app/play/page.tsx:193`) | `POST /api/chess/create-game` | unchanged call; the route writes the new columns; navigates to `/game/<ref>` (`waiting`) |
| `/play` vs computer (`WEB/app/play/page.tsx:155`) | `POST /api/chess/create-ai-game` | `useCreateBotGame()` with `{mode:"BOT", start, color, botElo, tc}` mapped from the page's selectors |
| `/play` cancel (`:654`), `/challenge/new` (`:36,153`), legend challenge (`WEB/app/legends/[referenceId]/ChallengeLegendButton.tsx:55,107`), analysis share (`WEB/app/analysis/[gameId]/AnalysisShareModal.tsx:180,378`), position friend (`WEB/app/position/[referenceId]/PositionPageClient.tsx:147,512`) | `create-game` / `cancel-game` | unchanged calls (P9 replaces them with `/api/challenges`) |
| `/position` vs bot (`PositionPageClient.tsx:105`) | `create-ai-game` | `useCreateBotGame()` with `start: {kind:"position", positionRef}` |
| `/queue` (`WEB/app/queue/page.tsx:61,285`) | legacy DB queue → game; bot fallback `:262` | matched games come from `matchmaking.service` (now writing colours); the fallback uses `useCreateBotGame()` |
| `/join/[gameReferenceId]` (`WEB/app/join/[gameReferenceId]/page.tsx:71,98,120`) | `game-by-ref` (H4 projection) then `chess/join` | unchanged calls; `join` is now atomic and fills the colour |
| Tournament (`WEB/app/tournament/[ref]/FindMatchButton.tsx:58-90`, `ActiveGames.tsx:70`) | `find-match` → `/game/<ref>` | `find-match` writes the new columns; `ActiveGames` links open the spectator view |
| Rematch | client `create-game` with the remaining clock (`GamePageContent.tsx:308-338`, socket F-23) | `rematch:*` over the socket |

### 5.7 Sequences

**A. Friend game from creation to the end (happy path)**

```
A /play ──POST /api/chess/create-game──► Vercel ── createLiveGame(): INSERT games(WAITING, whitePlayerId=A, mode=FRIEND,
                                                    studySeconds=30, meta) + INSERT game_players(A, 'w') ──► Neon
A /game/<ref> RSC (1 query) ─► GameScreen ─► socket game:join ─► WS: no session → loadLiveGame(ref) (1 query) → session
                                                                ack {role:'player', state: phase=waiting}
B /join/<ref> ──POST /api/chess/join──► UPDATE games … WHERE status='WAITING_FOR_OPPONENT' AND "opponentId" IS NULL
                                       (blackPlayerId=B, IN_PROGRESS) + INSERT game_players(B,'b')
B /game/<ref> RSC ─► game:join ─► WS session: B online → both online → reducer: study(endsAt=now+30 s)
                                  emit game:phase{study} (journal line; no DB write)
both study:ready ─► first_move(w, 30 s) ─► A moves (clocks frozen) ─► first_move(b) ─► B moves ─► playing (A's clock runs)
… moves: move:applied per ply; checkpoint UPDATE every 10 plies or 15 s (1 statement, plyCount guard)
mate ─► game:ended {checkmate, winner:w} to game:{ref} and spectate:{ref} (immediately)
     ─► finishGame(): one data-modifying CTE (status, moves, pgn, game_players, user_stats, tournament) ─► Neon (1 round trip)
     ─► game:result {ratings:null, review:{status:'none'}}
POST_GAME 60 s (rematch window) ─► session evicted; journal deleted 1 h later
```

**B. Socket deploy mid-game**

```
deploy-oci.yml: docker compose pull (old container keeps serving)
  → docker compose exec websocket wget POST /internal/broadcast {type:'restart', inSeconds:30}
      WS: draining=true (no new sessions, no rematch create), emit server:restarting{restartAt} to every game room
  → sleep 30
  → docker compose up -d → SIGTERM → drain(): freeze every clock at `at`, journal fsync, flush every outbox
      (checkpoint UPDATE per dirty game), io.close(), exit 0 (within stop_grace_period 30 s)
new container boot → restore(): read /data/journal/*.ndjson + SELECT live games (status IN_PROGRESS, live modes,
      lastMoveAt > now() − 2 h) → per game: longer move list wins (journal wins ties) → push missing plies
      → replay from startFen with chess.js → phase + clocks restored FROZEN → arm resume timer (60 s)
clients: disconnect → reconnecting (restart variant) → reconnect with a fresh token → game:join → snapshot (frozen)
both players attached (or 60 s) → resume: run = side to move, at = now → clock:sync → play continues
```

**C. Opponent disconnect**

```
B's last socket leaves (transport close, or ping timeout ≤ 18 s)
  WS reducer: presence.b = {online:false, graceEndsAt: now+30 s} (10 s if B dropped ≥ 3 times in 120 s)
  emit presence:update to game:{ref} and spectate:{ref}; arm grace timer
B returns inside 30 s → presence online → emit; grace cleared
grace fires → plies < 2 ? ended(aborted) : ended(abandoned, winner w)   (if A is also offline: no grace; clocks decide)
```

**D. Bot game**

```
/play vs computer → POST /api/games (Idempotency-Key) → INSERT games(mode=BOT, IN_PROGRESS) + game_players(human) → 201
/game/<ref> RSC (1 query) → GameScreen(local) → EngineProvider.init (cached WASM) → play locally
every move → localStorage journal; pagehide → sendBeacon checkpoint (1 UPDATE, rev guard)
end → POST /api/games/<ref>/complete → server replays with chess.js, checks the claim → 1 transaction → 200
total: 2 invocations + ≤ 1 beacon per 10 plies or per tab hide
```

---

## 6. Data model

### 6.1 Overview

| Migration | Contents | Applied to |
|---|---|---|
| (move) | `WEB/prisma/*` → `PKG/db/prisma/*`; generator output `PKG/db/generated/client`; `binaryTargets` += `linux-musl-arm64-openssl-3.0.x`. **No schema change** | nothing to apply (`_prisma_migrations` stores folder names only, data-model §2.11) |
| M2a `…_m2a_game_status_aborted` | `ALTER TYPE "GameStatus" ADD VALUE IF NOT EXISTS 'ABORTED';` (own file: a new enum value cannot be used in the same transaction) | Neon `dev` only |
| M2 `…_m2_play_model` | 6 enums; 20 `games` columns; 3 FKs on `games`; `game_players`; indexes (§6.4) | Neon `dev` only |
| M2i `…_m2i_idempotency_keys` | `idempotency_keys` (only if P1 did not create it; WP-A checks `PKG/db/prisma/schema.prisma` on day 1) | Neon `dev` only |

Production gets none of this in P2 (allocation §1.3: prod migrates in P13 through `prisma migrate deploy` after a rehearsal). Timestamps in folder names are set when the files are written (data-model §11.4).

### 6.2 Prisma changes (`PKG/db/prisma/schema.prisma`)

```prisma
generator client {
  provider        = "prisma-client-js"
  output          = "../generated/client"
  binaryTargets   = ["native", "linux-musl-openssl-3.0.x", "linux-musl-arm64-openssl-3.0.x"]   // x64 Vercel/CI + arm64 OCI alpine
}

enum GameStatus {          // existing (schema:303) + M2a
  WAITING_FOR_OPPONENT
  IN_PROGRESS
  COMPLETED
  CANCELLED
  EXPIRED
  ABORTED                  // M2a. Written only by v2 code paths, after web and socket both run the new client (data-model §11.1.6)
}

enum GameMode      { LEGEND_BOT BOT FRIEND ONLINE TOURNAMENT IMPORTED } // LEGEND_BOT written from P8, IMPORTED from P4
enum GameSource    { REPLAY CHESSCOM LICHESS }                          // REPLAY = played here; others written from P4
enum TimeClass     { BULLET BLITZ RAPID CLASSICAL DAILY UNTIMED }      // data-model enum; DAILY/CLASSICAL written from P4
enum GameEndMethod { CHECKMATE RESIGNATION TIMEOUT TIMEOUT_VS_INSUFFICIENT STALEMATE THREEFOLD FIFTY_MOVE
                     INSUFFICIENT_MATERIAL AGREEMENT ABANDONED ABORTED OTHER }   // OTHER: imports only (P4)
enum GameWinner    { WHITE BLACK DRAW NONE }                            // NONE = aborted; named outcome because Game.winner is a relation
enum LivePhase     { WAITING STUDY FIRST_MOVE PLAYING ENDED }
enum PlayerResult  { WIN LOSS DRAW ABORTED }

model Game {
  // ...existing fields unchanged (creatorId, opponentId, status, result, winnerId, startingFen, initialTimeSeconds,
  //    incrementSeconds, creatorTimeRemaining, opponentTimeRemaining, lastMoveAt, gameData, expiresAt, …)

  // ── M2 (Phase 2): typed play columns ──
  mode          GameMode?                          // null only on legacy rows until the backfill
  rated         Boolean        @default(false)     // false until P9
  timeClass     TimeClass?                         // from initial + 40 × increment (§8.11); UNTIMED for untimed bot games
  whitePlayerId BigInt?                            // fixed at creation (B2); null side = bot (or not joined yet)
  blackPlayerId BigInt?
  botElo        Int?           @db.SmallInt        // BOT / LEGEND_BOT: 400..2200
  startPly      Int            @default(0) @db.SmallInt   // ply number of startingFen: 2·(fullmove−1) + (side=b ? 1 : 0)
  studySeconds  Int            @default(0) @db.SmallInt   // 30 when startingFen ≠ initial (owner Q1), decided at creation
  /// Space-separated UCI from startingFen (~5 B/ply). Source of truth for the move list (B3).
  moves         String         @default("") @db.Text
  /// Mover's remaining ms after each ply (increment included). Empty for untimed games.
  moveClocksMs  Int[]          @default([])
  /// Checkpoint guard: UPDATE … WHERE "plyCount" <= $n (B3)
  plyCount      Int            @default(0) @db.SmallInt
  fen           String?                            // position after the last persisted ply (replaces gameData.fen)
  whiteTimeMs   Int?                               // remaining ms at the last checkpoint (replaces creator/opponent seconds, play-a B9)
  blackTimeMs   Int?
  clockRunning  String?        @db.Char(1)         // 'w' | 'b' | null; running since lastMoveAt
  phase         LivePhase?                         // live rehydration (§7.6)
  phaseEndsAt   DateTime?                          // study end or first-move deadline
  endMethod     GameEndMethod?
  outcome       GameWinner?
  /// Built once at game end with %clk (B3); immutable afterwards
  pgn           String?        @db.Text
  rematchOfId   BigInt?
  // ── M2: display snapshot read by P3, P4, P10, P12 (consistency R-01). Filled at creation and join;
  //    finish fills any that are still NULL. Bots get the ladder label "Engine {botElo}" and no title.
  whiteName     String?        @db.VarChar(40)
  blackName     String?        @db.VarChar(40)
  whiteRating   Int?           @db.SmallInt
  blackRating   Int?           @db.SmallInt
  whiteTitle    String?        @db.VarChar(4)
  blackTitle    String?        @db.VarChar(4)
  // ── M2: source and external identity (P4 writes CHESSCOM/LICHESS rows; P2 writes REPLAY only)
  source        GameSource     @default(REPLAY)
  externalId    String?        @db.VarChar(40)
  externalUrl   String?        @db.VarChar(120)
  /// GameMetaV1 (PKG/db/src/json/game-meta.ts): header, prefix, position card, assists, rev, drawOffers, client
  meta          Json?

  whitePlayer   User?        @relation("WhiteGames", fields: [whitePlayerId], references: [id], onDelete: SetNull)
  blackPlayer   User?        @relation("BlackGames", fields: [blackPlayerId], references: [id], onDelete: SetNull)
  rematchOf     Game?        @relation("Rematches", fields: [rematchOfId], references: [id], onDelete: SetNull)
  rematches     Game[]       @relation("Rematches")
  players       GamePlayer[]

  @@unique([source, externalId], map: "games_source_externalId_key")   // P4 import upsert; NULLs never collide
  // restore list and sweeps use the partial games_open_idx (§6.3), not an index on lastMoveAt, so the
  // ≈ 10 checkpoint UPDATEs per game stay HOT (lastMoveAt changes on every one of them)
  // existing @@index([status]) becomes redundant → dropped in contract step C1 (owner confirmation)
}

/// M2 (Phase 2, B1). One row per member side of a game; bots have no row.
/// The per-user game index for Home, the archive, profile and weakness (filled further by P3, P4, P9).
model GamePlayer {
  gameId         BigInt
  userId         BigInt
  color          String        @db.Char(1)       // 'w' | 'b'
  mode           GameMode
  timeClass      TimeClass?
  rated          Boolean       @default(false)
  result         PlayerResult?                   // null while the game is live
  endedAt        DateTime?                       // null while live → "my live games" = WHERE "endedAt" IS NULL
  opponentUserId BigInt?                         // no FK (history column, data-model §2.8)
  opponentName   String        @default("") @db.VarChar(40)   // display snapshot: member name, "Engine 1400", "" until a friend joins
  opponentRating Int?          @db.SmallInt
  ratingBefore   Int?          @db.SmallInt      // P2: the displayed rating at start (Chess.com-derived); P9 writes Glicko values
  ratingAfter    Int?          @db.SmallInt      // P9
  ratingDelta    Int?          @db.SmallInt      // P9
  tournamentId   BigInt?                         // denormalised, no FK
  source         GameSource    @default(REPLAY)  // P3 and P4 select it; P4 writes the provider value
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt
  game           Game          @relation(fields: [gameId], references: [id], onDelete: Cascade)
  user           User          @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([gameId, userId])
  @@unique([gameId, color])
  @@index([userId, endedAt(sort: Desc), gameId(sort: Desc)])
  @@map("game_players")
}

model User {
  // ...existing
  gamesVersion  Int          @default(0)      // only if P1 did not add it: bumped by every write that changes the user's game list (finish CTE here; P3 analysis, P4 import/purge); P3's archive ETag reads it (api-perf AP-19)
  gamesAsWhite  Game[]       @relation("WhiteGames")
  gamesAsBlack  Game[]       @relation("BlackGames")
  gamePlayers   GamePlayer[]
}

/// M2i (only if P1 did not ship it; shape from api-design §2.8)
model IdempotencyKey {
  userId         BigInt
  key            String   @db.VarChar(36)
  route          String   @db.VarChar(64)
  requestHash    String   @db.Char(64)
  status         Int      @db.SmallInt         // 0 running, 1 done
  responseStatus Int?     @db.SmallInt
  responseBody   Json?
  createdAt      DateTime @default(now())

  @@id([userId, key])
  @@index([createdAt])                          // daily prune (P1 CRON-1: DELETE … WHERE "createdAt" < now() − 24 h)
  @@map("idempotency_keys")
}
```

Columns later phases add are **not** created here; each is a nullable or defaulted column added by its owner (metadata-only `ALTER TABLE … ADD COLUMN`), per consistency R-01: `game_players.accuracy, headline, "momentsCount", counts, "phaseAccuracy"` and `games."analysisStatus"`, `games."ecoCode"`, `games."openingName"`, `game_players."ecoCode"` (M3, P3); `game_players."linkedAccountId"` (M4, P4); `game_players.stats`, `"errorThemes"` (M6, P6); `games."seriesNo"` (M8, P8); `game_players_h2h_idx` (M9, P9); `games."tournamentPositionOrder"`, `game_players."tournamentPoints"`, `"tournamentFire"` (M12, P12). There is no `game_players."analysisStatus"` and no `hasComparison` column (P3 uses `games."analysisStatus"` and the `LegendComparison` table). The enum values `GameMode.IMPORTED`, `GameEndMethod.OTHER` and the `GameSource` values exist from M2 but P2 never writes the first two, which satisfies the two-release rule for enum values (feasibility §9) when P4 starts writing them.

**JSON column registry entry** (`PKG/db/src/json/game-meta.ts`, zod 4, data-model §2.6):

```ts
export const GameMetaV1 = z.object({
  v: z.literal(1),
  header: z.string().max(80),                       // left header: "C41 · Philidor · Opera Game 1858" | "Endgame" | ""
  prefixSan: z.array(z.string().max(8)).max(120),   // legend/opening moves before startingFen ("Game starts here")
  prefixStartMoveNo: z.number().int().min(1),
  position: z.object({ name: z.string().max(80), event: z.string().max(80).nullable(), year: z.number().int().nullable(),
                       afterLabel: z.string().max(16).nullable(), legendSide: z.enum(["w","b"]).nullable() }).nullable(),
  rev: z.number().int().min(0).default(0),          // bot games: monotonic journal revision (undo-safe checkpoints)
  assists: z.object({ hints: z.number().int().min(0), undos: z.number().int().min(0) }).default({ hints: 0, undos: 0 }),
  drawOffers: z.object({ w: z.number().int(), b: z.number().int() }).default({ w: 0, b: 0 }),
  premoves: z.object({ w: z.number().int(), b: z.number().int() }).default({ w: 0, b: 0 }),
  abortedBy: z.enum(["w","b","timeout","stale"]).nullable().default(null),
  client: z.object({ build: z.string().max(40) }).optional(),
});
```

The header and prefix are computed **once at creation** from `chess_positions`/`openings`, so neither the socket session nor the RSC snapshot joins those tables (and `explanation` JSON is never read on a game path, DB-14).

### 6.3 Raw SQL appended to M2

```sql
SET lock_timeout = '5s';
-- Sparse FK columns followed by ON DELETE SET NULL from users/games get partial indexes (data-model §2.9)
CREATE INDEX IF NOT EXISTS games_white_player_idx ON games ("whitePlayerId") WHERE "whitePlayerId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS games_black_player_idx ON games ("blackPlayerId") WHERE "blackPlayerId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS games_rematch_of_idx   ON games ("rematchOfId")   WHERE "rematchOfId"   IS NOT NULL;
-- Open games only (dozens of rows): restore list and sweeps (§6.6.8). Not on lastMoveAt, which every checkpoint
-- changes; an index on it would turn each of the ≈ 10 checkpoint UPDATEs per game into a non-HOT update.
CREATE INDEX IF NOT EXISTS games_open_idx ON games (status) WHERE status IN ('WAITING_FOR_OPPONENT', 'IN_PROGRESS');
-- Leave room on each page for HOT updates of the checkpointed row (affects new pages only; no rewrite)
ALTER TABLE games SET (fillfactor = 90);
-- Storage parameters Prisma does not model (no drift)
ALTER TABLE games ALTER COLUMN moves SET COMPRESSION lz4;
ALTER TABLE games ALTER COLUMN pgn   SET COMPRESSION lz4;
```

The four partial index names go into `PKG/db/prisma/protected-indexes.txt`. **P2 creates** `REPO/scripts/db/check-drift.ts` and `protected-indexes.txt` (they did not exist in P1) and replaces P1's raw `prisma migrate diff --exit-code` step in `ci.yml` (P1 L1493), which would fail as soon as the first partial index exists (consistency R-10). The script runs `migrate diff --script`, ignores `DROP INDEX` lines for protected names and the storage-parameter lines above, and fails on anything else. Later phases append names to the same file; there is no `protected-indexes.json`. The FKs Prisma generates on `games` reference brand-new all-NULL columns, so validation is instant and `NOT VALID` is not needed.

### 6.4 Indexes and the queries they serve

| Index | Columns | Query (who, how often) |
|---|---|---|
| `games_referenceId_key` (exists) | unique `referenceId` | `getGameSnapshot` (RSC, every game page load); socket `loadLiveGame` (once per session creation); `POST /api/games/[ref]/*` |
| `games_pkey` (exists) | `id` | checkpoint `UPDATE … WHERE id = $1` (≤ 10 per game), finish CTE, abort |
| `games_open_idx` (new, partial) | `(status) WHERE status IN ('WAITING_FOR_OPPONENT','IN_PROGRESS')` | socket boot restore: `WHERE status = 'IN_PROGRESS' AND mode IN (…) AND "lastMoveAt" > now() − '2 h'`; boot/opportunistic stale sweep `… AND "lastMoveAt" < now() − '30 min'`; daily bot sweep `… AND mode = 'BOT' AND "lastMoveAt" < now() − '7 days'`; stale waiting-game expiry. The index holds only open games (dozens of rows), so the `lastMoveAt` filter is applied to a handful of heap rows. Replaces revision 1's `games_status_lastMoveAt_idx` (HOT, §6.3) |
| `games_source_externalId_key` (new, unique) | `(source, "externalId")` | P4's import upsert `ON CONFLICT (source, "externalId") DO UPDATE … RETURNING id, (xmax = 0) AS created`; REPLAY rows have `externalId` NULL and never collide |
| `games_white_player_idx`, `games_black_player_idx` (new, partial) | `"whitePlayerId"` / `"blackPlayerId"` | `SET NULL` on user deletion (P10) without a scan; anonymisation |
| `games_rematch_of_idx` (new, partial) | `"rematchOfId"` | `SET NULL` when a game is deleted; rematch chain length (analytics) |
| `game_players_pkey` (new) | `(gameId, userId)` | participant check on `GET /api/games/[ref]`, checkpoint, complete, PGN (≤ 2 rows); finish CTE join |
| `game_players_gameId_color_key` (new) | unique `(gameId, color)` | guarantees one row per side (a join race inserts the second black row → unique violation → 409); P3 FK option |
| `game_players_userId_endedAt_gameId_idx` (new; the canonical archive and Home index for every phase, consistency R-01; wire DTOs may name the value `playedAt`) | `(userId, endedAt DESC, gameId DESC)` | "my live games" `WHERE "userId" = $1 AND "endedAt" IS NULL` (NULLs sort first in DESC, so it is an index prefix scan: P9's "one live game per user", Home "Continue" in P5); P3 archive keyset `WHERE "userId" = $1 AND ("endedAt", "gameId") < ($c1, $c2) ORDER BY "endedAt" DESC, "gameId" DESC LIMIT 31`; user-delete cascade |

### 6.5 Migration procedure and safety (CLAUDE.md + allocation §1.3 + data-model §11.2)

1. Edit `PKG/db/prisma/schema.prisma`.
2. Generate SQL against a **local** shadow database, never Neon:
   ```bash
   docker run -d --rm --name rc-shadow -e POSTGRES_PASSWORD=pw -p 55433:5432 postgres:17-alpine
   pnpm --filter @repo/db exec prisma migrate diff --from-migrations prisma/migrations \
     --to-schema-datamodel prisma/schema.prisma \
     --shadow-database-url postgresql://postgres:pw@localhost:55433/postgres --script \
     > prisma/migrations/<ts>_m2_play_model/migration.sql
   ```
   M2a is written by hand (one line). Append §6.3 to M2 and start each hand-edited file with `SET lock_timeout = '5s';`.
3. Drift check: `pnpm tsx scripts/db/check-drift.ts` (created by P2, §6.3) reports nothing except `DROP INDEX` lines for names in `protected-indexes.txt`; it replaces P1's `--exit-code` step in `ci.yml`.
4. Verify locally: `prisma migrate deploy` on a fresh local Postgres 17, run the seed, `pnpm --filter web check-types`, the unit and integration suites.
5. Apply to the Neon dev branch named in CLAUDE.md (after P1 1B·H10 it lives in its own project): `DATABASE_URL=<dev direct URL> pnpm --filter @repo/db exec prisma migrate deploy`. Print and check the host before running. **Never `prisma migrate dev` against Neon** (CLAUDE.md rule 2; the 2026-03-08 incident). `prisma db push` is not used on **any** Neon branch, dev included, because it would drop the partial indexes and storage parameters (data-model §11.1, consistency R-20; this overrides the CLAUDE.md wording that allows it on dev, recorded in §14.3).
6. Deploy order (data-model §11.5, architecture §4.5.1): migrate → web (new client, tolerant readers) → socket (new client) → flip `live-protocol-v2` / `game-v3` → run the backfill.
7. None of these steps is destructive; the backfill writes data, so it runs `--dry-run` first and prints its counts (CLAUDE.md rule 5 applies to C1 later, not here).

### 6.6 Writes per game (exact statements)

#### 6.6.1 Create a bot game (web, `POST /api/games`, `WEB/lib/games/create-bot-game.server.ts`)

Round trips from Vercel `iad1` (1–2 ms each): viewer (cached) → position pick (only for `legend`/`random_position`: `SELECT … FROM chess_positions WHERE "isActive" AND … ORDER BY random() LIMIT 1`, a few hundred rows) → idempotency insert → one batch transaction:

```ts
await prisma.$transaction([
  prisma.game.create({ data: {
    referenceId: cuid(), creatorId: me.id, opponentId: botUser.id,          // legacy columns kept for legacy readers
    status: "IN_PROGRESS", mode: "BOT", rated: false, timeClass, botElo,
    whitePlayerId: you === "w" ? me.id : null, blackPlayerId: you === "b" ? me.id : null,
    startingFen, startPly, studySeconds: 0, fen: startingFen, chessPositionId, openingId,
    initialTimeSeconds, incrementSeconds, creatorTimeRemaining: initialTimeSeconds, opponentTimeRemaining: initialTimeSeconds,
    whiteTimeMs: initialMs, blackTimeMs: initialMs, phase: "PLAYING", lastMoveAt: now, startedAt: now,
    expiresAt: addHours(now, 24), meta: GameMetaV1.parse({...}),
    whiteName: you === "w" ? me.name : `Engine ${botElo}`, blackName: you === "b" ? me.name : `Engine ${botElo}`,
    whiteRating: you === "w" ? myDisplayedRating : botElo, blackRating: you === "b" ? myDisplayedRating : botElo,
    source: "REPLAY",
    players: { create: [{ userId: me.id, color: you, mode: "BOT", timeClass, opponentName: `Engine ${botElo}`,
                          opponentRating: botElo, ratingBefore: myDisplayedRating }] },
  }}),
  ...(chessPositionId ? [prisma.chessPosition.update({ where: { id: chessPositionId }, data: { timesPlayed: { increment: 1 } } })] : []),
]);
```

#### 6.6.2 Create a live human game (web, legacy routes → `PKG/db/src/games/createLiveGame.ts`)

One helper for `chess/create-game` (friend, creator side only, `WAITING_FOR_OPPONENT`, `phase = WAITING`), `chess/join` (fills the other side), `matchmaking.service.ts` and `tournament/find-match` (both sides, `IN_PROGRESS`). It writes `mode`, `timeClass`, `whitePlayerId`/`blackPlayerId`, the display snapshot of each joined side (`whiteName`/`blackName`, `whiteRating`/`blackRating`, `whiteTitle`/`blackTitle`), `studySeconds` (`studySecondsFor(startingFen)`), `startPly`, `fen`, `whiteTimeMs`/`blackTimeMs = initial`, `phase`, `lastMoveAt = now` when `IN_PROGRESS`, `meta`, and the `GamePlayer` rows, inside the caller's `tx` (fixes DB-11, which used the global client inside a transaction). Join is conditional:

```sql
UPDATE games SET "opponentId" = $me, status = 'IN_PROGRESS', "startedAt" = now(), "lastMoveAt" = now(),
       "blackPlayerId" = CASE WHEN "whitePlayerId" IS NOT NULL THEN $me ELSE "blackPlayerId" END,
       "whitePlayerId" = CASE WHEN "whitePlayerId" IS NULL THEN $me ELSE "whitePlayerId" END,
       "blackName"   = CASE WHEN "whitePlayerId" IS NOT NULL THEN $myName   ELSE "blackName"   END,
       "whiteName"   = CASE WHEN "whitePlayerId" IS NULL     THEN $myName   ELSE "whiteName"   END,
       "blackRating" = CASE WHEN "whitePlayerId" IS NOT NULL THEN $myRating ELSE "blackRating" END,
       "whiteRating" = CASE WHEN "whitePlayerId" IS NULL     THEN $myRating ELSE "whiteRating" END
WHERE "referenceId" = $ref AND status = 'WAITING_FOR_OPPONENT' AND "opponentId" IS NULL AND "creatorId" <> $me;
-- count = 0 → re-read and answer 409 conflict {reason: already_started}; the legacy expired / own-game answers are unchanged until P9 replaces these routes (play-a B13)
INSERT INTO game_players ("gameId", "userId", color, mode, …) VALUES (…);   -- unique (gameId, color) backs it up
UPDATE game_players SET "opponentUserId" = $me, "opponentName" = $myName, "opponentRating" = $myRating
WHERE "gameId" = $id AND "userId" = $creator;
```

#### 6.6.3 Socket checkpoint (`PKG/db/src/live/checkpoint.ts`, ≤ 10 per 80-ply game, 1 statement, ~220 ms from Mumbai)

```sql
UPDATE games SET moves = $2, "moveClocksMs" = $3::int[], "plyCount" = $4, fen = $5,
       "whiteTimeMs" = $6, "blackTimeMs" = $7, "clockRunning" = $8, phase = $9::"LivePhase", "phaseEndsAt" = $10,
       "lastMoveAt" = $11, "updatedAt" = now()
WHERE id = $1 AND status = 'IN_PROGRESS' AND "plyCount" <= $4
RETURNING "plyCount";
```

The full move list is sent each time (≈ 400 B UCI + ≈ 350 B clocks at 80 plies), so a checkpoint is an idempotent overwrite; `<=` allows a same-ply write that only changes clocks or phase (drain freeze). The per-game outbox keeps one write in flight, so writes from one process never reorder; a restored process starts only after the old one exited.

#### 6.6.4 Socket finish: one data-modifying CTE (`PKG/db/src/live/finish.ts`)

One statement, so one round trip from Mumbai (≈ 220–260 ms end to end), atomic, and idempotent through the `status = 'IN_PROGRESS'` predicate (fixes DB-04 double counting, socket F-07 lost final move).

```sql
WITH g AS (
  UPDATE games SET status = 'COMPLETED', phase = 'ENDED', "phaseEndsAt" = NULL, "clockRunning" = NULL,
         moves = $moves, "moveClocksMs" = $clocks::int[], "plyCount" = $n, fen = $fen,
         "whiteTimeMs" = $wMs, "blackTimeMs" = $bMs,
         "endMethod" = $method::"GameEndMethod", outcome = $outcome::"GameWinner", pgn = $pgn,
         result = $legacyResult::"GameResult", "winnerId" = $winnerUserId,                -- legacy readers (profile, stats)
         "creatorTimeRemaining" = $creatorSecs, "opponentTimeRemaining" = $opponentSecs,
         meta = $meta::jsonb, "completedAt" = $endedAt, "lastMoveAt" = $endedAt, "updatedAt" = now(),
         "whiteName" = COALESCE("whiteName", $wName), "blackName" = COALESCE("blackName", $bName),     -- legacy rows only
         "whiteRating" = COALESCE("whiteRating", $wRating), "blackRating" = COALESCE("blackRating", $bRating)
  WHERE id = $id AND status = 'IN_PROGRESS'
  RETURNING id, "tournamentId"
), gp AS (
  UPDATE game_players p
     SET result = CASE WHEN $outcome = 'DRAW' THEN 'DRAW'::"PlayerResult"
                       WHEN (p.color = 'w') = ($outcome = 'WHITE') THEN 'WIN'::"PlayerResult"
                       ELSE 'LOSS'::"PlayerResult" END,
         "endedAt" = $endedAt, "updatedAt" = now()
    FROM g WHERE p."gameId" = g.id
  RETURNING p."userId", p.result
), us AS (                                                    -- legacy user_stats until P10 derives stats from game_players
  UPDATE user_stats s
     SET "totalGamesPlayed" = s."totalGamesPlayed" + 1, "lastPlayedAt" = $endedAt,
         "gamesWon"   = s."gamesWon"   + (gp.result = 'WIN')::int,
         "gamesLost"  = s."gamesLost"  + (gp.result = 'LOSS')::int,
         "gamesDrawn" = s."gamesDrawn" + (gp.result = 'DRAW')::int,
         "currentWinStreak" = CASE WHEN gp.result = 'WIN' THEN s."currentWinStreak" + 1 ELSE 0 END,
         "longestWinStreak" = CASE WHEN gp.result = 'WIN' THEN GREATEST(s."longestWinStreak", s."currentWinStreak" + 1)
                                   ELSE s."longestWinStreak" END
    FROM gp WHERE s."userId" = gp."userId"
  RETURNING s."userId"
), tp AS (                                                    -- legacy arena standings until P12
  UPDATE tournament_participants t
     SET points = t.points + CASE gp.result WHEN 'WIN' THEN 1 WHEN 'DRAW' THEN 0.5 ELSE 0 END,
         wins = t.wins + (gp.result = 'WIN')::int, draws = t.draws + (gp.result = 'DRAW')::int,
         losses = t.losses + (gp.result = 'LOSS')::int, "gamesPlayed" = t."gamesPlayed" + 1
    FROM gp, g WHERE g."tournamentId" IS NOT NULL AND t."tournamentId" = g."tournamentId" AND t."userId" = gp."userId"
  RETURNING t."userId"
), uv AS (                                                    -- archive/Home ETag version (api-perf AP-19)
  UPDATE users u SET "gamesVersion" = u."gamesVersion" + 1
    FROM gp WHERE u.id = gp."userId"
  RETURNING u.id
)
SELECT (SELECT count(*) FROM g)::int AS finished, (SELECT count(*) FROM tp)::int AS standings;
```

- `finished = 0` → the game was already finished (retry after a lost response): read back `status, "endMethod", outcome` and treat it as success if they match; a mismatch is logged as `ws.persist.conflict` and the DB wins.
- `$legacyResult` maps to the existing `GameResult` from the winner's colour and `creatorId`: winner = creator → `CREATOR_WON` (or `OPPONENT_TIMEOUT` when the method is `TIMEOUT`), winner = opponent → `OPPONENT_WON` (or `CREATOR_TIMEOUT`), draw → `DRAW` (fixes the wrong-winner forfeit, socket F-10).
- P3 adds one clause (`INSERT INTO jobs … ON CONFLICT ("dedupeKey") DO NOTHING`) and P9 adds the rating clause; the CTE is built from named fragments in `finish.ts` so each phase appends one.
- After the commit: tournament games emit the legacy `tournament_game_ended` to `tournament:{ref}` in-process (`TournamentManager`), replacing the web → socket notify that `chess/game-over` made.

#### 6.6.5 Abort (`PKG/db/src/live/abort.ts`)

Same shape with `status = 'ABORTED'`, `"endMethod" = 'ABORTED'`, `outcome = 'NONE'`, `result = NULL`, `game_players.result = 'ABORTED'`, **no** `user_stats` or standings clause, `meta.abortedBy`.

#### 6.6.6 Rematch (`PKG/db/src/live/createRematch.ts`)

```sql
WITH parent AS (SELECT * FROM games WHERE id = $parentId AND status = 'COMPLETED' AND mode IN ('FRIEND','ONLINE')),
     ng AS (
  INSERT INTO games ("referenceId", "creatorId", "opponentId", status, mode, rated, "timeClass",
                     "whitePlayerId", "blackPlayerId", "startingFen", "startPly", "studySeconds", fen,
                     "initialTimeSeconds", "incrementSeconds", "creatorTimeRemaining", "opponentTimeRemaining",
                     "whiteTimeMs", "blackTimeMs", phase, "chessPositionId", "openingId", "rematchOfId", meta,
                     "startedAt", "lastMoveAt", "expiresAt", "createdAt", "updatedAt")
  SELECT $newRef, $offererId, $accepterId, 'IN_PROGRESS', p.mode, p.rated, p."timeClass",
         p."blackPlayerId", p."whitePlayerId",                                   -- colours swapped
         p."startingFen", p."startPly", p."studySeconds", p."startingFen",
         p."initialTimeSeconds", p."incrementSeconds", p."initialTimeSeconds", p."initialTimeSeconds",
         p."initialTimeSeconds" * 1000, p."initialTimeSeconds" * 1000, 'WAITING', p."chessPositionId", p."openingId", p.id,
         jsonb_set(COALESCE(p.meta, '{}'::jsonb), '{assists}', '{"hints":0,"undos":0}') - 'abortedBy', now(), now(), now() + interval '24 hours', now(), now()
  FROM parent p RETURNING id, "whitePlayerId", "blackPlayerId"
)
INSERT INTO game_players ("gameId", "userId", color, mode, "timeClass", rated, "opponentUserId", "opponentName", "opponentRating",
                          "ratingBefore", "createdAt", "updatedAt")
SELECT ng.id, x.uid, x.color, $mode, $timeClass, false, x.opp, x.oppName, x.oppRating, x.myRating, now(), now()
FROM ng CROSS JOIN LATERAL (VALUES (ng."whitePlayerId", 'w', ng."blackPlayerId", $bName, $bRating, $wRating),
                                   (ng."blackPlayerId", 'b', ng."whitePlayerId", $wName, $wRating, $bRating))
     AS x(uid, color, opp, oppName, oppRating, myRating)
RETURNING "gameId";
```

The socket checks both players' `ent` from their newest tokens before running it (no extra read; §11).

#### 6.6.7 Bot checkpoint and complete (web)

```sql
-- POST /api/games/[ref]/checkpoint (rev guard, so an undo is never shadowed by an older, longer line)
UPDATE games SET moves = $moves, "moveClocksMs" = $clocks, "plyCount" = $n, fen = $fen,
       "whiteTimeMs" = $w, "blackTimeMs" = $b, meta = jsonb_set(jsonb_set(meta, '{rev}', to_jsonb($rev::int)), '{assists}', $assists::jsonb),
       "lastMoveAt" = now(), "updatedAt" = now()
WHERE "referenceId" = $ref AND status = 'IN_PROGRESS' AND mode = 'BOT'
  AND ("whitePlayerId" = $me OR "blackPlayerId" = $me)
  AND COALESCE((meta->>'rev')::int, 0) < $rev;
```

Before this statement the route reads the stored `moves`, `fen` and `rev` (same row, one indexed read): `rev > stored + 64` → 409 `rev_gap`; if the stored `moves` string is a prefix of the new one, only the suffix is replayed from the stored `fen`, so a long game costs a few chess.js moves per beacon instead of a 400-ply replay (api-perf AP-32).

Complete runs on Vercel next to Neon, so a short interactive transaction is fine (≈ 5 statements × 1–2 ms): the idempotency check (`status <> 'IN_PROGRESS'` → return the stored result), the game update (status, moves, clocks, `endMethod`, `outcome`, `pgn`, legacy `result`/`winnerId`), the human's `game_players` row, and the human's `user_stats` (the bot user's row is never touched: today it is a hot row, data-model D2).

#### 6.6.8 Restore list and sweeps

```sql
-- socket boot (once)
SELECT "referenceId" FROM games
WHERE status = 'IN_PROGRESS' AND mode IN ('FRIEND','ONLINE','TOURNAMENT') AND "lastMoveAt" > now() - interval '2 hours';

-- socket: at boot, and opportunistically right after a finish (Neon is awake then), at most once per 10 min.
-- Never on a timer: a timer would keep the Neon compute awake (any query within 5 min resets scale-to-zero).
SELECT id, "referenceId", "plyCount", fen FROM games
WHERE status = 'IN_PROGRESS' AND mode IN ('FRIEND','ONLINE','TOURNAMENT')
  AND "lastMoveAt" < now() - interval '30 minutes' AND NOT ("referenceId" = ANY($liveRefs::text[]))
LIMIT 50;
-- each row: plyCount < 2 → abort(reason 'stale'); else finish(ABANDONED, loser = side to move from split_part(fen,' ',2))

-- web daily cron (P1 CRON-1): stale bot games
WITH g AS (UPDATE games SET status = 'ABORTED', phase = 'ENDED', "endMethod" = 'ABORTED', outcome = 'NONE',
                            "completedAt" = now(), "updatedAt" = now()
           WHERE status = 'IN_PROGRESS' AND mode = 'BOT' AND "lastMoveAt" < now() - interval '7 days' RETURNING id),
     gp AS (UPDATE game_players SET result = 'ABORTED', "endedAt" = now() FROM g WHERE game_players."gameId" = g.id
            RETURNING game_players."userId")
UPDATE users u SET "gamesVersion" = u."gamesVersion" + 1 FROM (SELECT DISTINCT "userId" FROM gp) x WHERE u.id = x."userId";
```

All three statements are served by the partial `games_open_idx` (§6.4).

#### 6.6.9 Budget per game (target vs today)

| | Today (socket §6.1) | P2 |
|---|---|---|
| Vercel invocations, 80-ply human game | ≈ 88 | 2 RSC renders (one per player) + 1 create/join each; **0 per move** |
| DB statements, 80-ply human game | ≈ 250 | create 1 tx + socket load 1 + checkpoints ≤ 8 + finish 1 ≈ **11** |
| Bytes written for moves | 776 KB (rewritten JSON) | ≈ 8 × 0.8 KB + PGN ≈ 1.5 KB ≈ **8 KB** |
| Bot game | socket session + Vercel call per move | 2 invocations + ≤ 1 beacon per 10 plies or tab hide; 0 socket traffic |

### 6.7 Database role for the socket server

`PKG/db/sql/roles.sql` adds (run by the owner role on the Neon `dev` branch; P13 repeats it on production):

```sql
CREATE ROLE replay_realtime LOGIN;                         -- password set in the Neon console, stored only in WS_DEV_ENV_FILE
ALTER ROLE replay_realtime SET statement_timeout = '5s';
ALTER ROLE replay_realtime SET lock_timeout = '3s';
ALTER ROLE replay_realtime SET idle_in_transaction_session_timeout = '10s';
GRANT USAGE ON SCHEMA public TO replay_realtime;
GRANT SELECT (id, "referenceId", name, "profilePictureUrl", role, "gamesVersion") ON users TO replay_realtime;   -- no email, no billing
GRANT UPDATE ("gamesVersion") ON users TO replay_realtime;                -- finish CTE bump only
GRANT SELECT ("userId", "bulletRating", "blitzRating", "rapidRating") ON chess_com_profiles TO replay_realtime;
GRANT SELECT, INSERT, UPDATE ON games, game_players TO replay_realtime;
GRANT SELECT, UPDATE ON user_stats, tournament_participants TO replay_realtime;
GRANT SELECT (id, "referenceId", name) ON tournaments TO replay_realtime;
```

The socket's `DATABASE_URL` uses the **pooled** host with `?pgbouncer=true&connection_limit=3&pool_timeout=10&connect_timeout=15` (architecture App. A). The role cannot read emails, billing columns or `gameData`.

**Surviving Neon scale-to-zero** (feasibility F-OCI-4, api-perf AP-18). Neon suspends the compute after 5 minutes without queries and closes every client connection; the next statement then fails once. Rules for `PKG/db/src/live/*`:

1. The socket uses Prisma 6's query engine (repo `@prisma/client ^6.17`), which reconnects on its own; no raw `pg` pool runs on the socket box. If one is ever added (for example `LISTEN`), it must set `pool.on('error', log)` and `idleTimeoutMillis: 60_000`, or an idle-socket error crashes the process and drops every live game.
2. `isTransientDbError(e)` in `PKG/db/src/live/errors.ts` classifies Prisma `P1017`, `P1001` and SQLSTATE `57P01`, `08006`, `08003`, plus `ECONNRESET`, as **transient**. A transient failure is retried **once immediately** on a fresh connection, then falls back to the outbox backoff (1 s, 2 s, 4 s … 30 s). Every live statement is idempotent (`plyCount <=` guard, `status = 'IN_PROGRESS'` predicate), so the retry is safe.
3. Transient failures count as `ws.persist.reconnect`, not `ws.persist.fail`; `/ready` and the `ws.persist.fail > 0 for 5 min` alert (P13 §10.2) ignore them.
4. **Prewarm:** when a game leaves `waiting` or `study`, the outbox sends a fire-and-forget `SELECT 1`, so the first checkpoint does not also pay the ≈ 1 s compute wake (the same idea as P9's queue prewarm).
5. No transaction is ever left open across an `await` that waits on a socket event (an idle transaction counts as activity and keeps the compute awake; the role's `idle_in_transaction_session_timeout = 10s` backs this up).
6. Resilience test: §12.9 suspends the dev compute in the middle of a game.

### 6.8 Backfill and dev seed

**Backfill** `WEB/scripts/backfill-play-columns.ts` (allocation name; data-model B1 + B2 rules), **dev only**: refuses unless the `DATABASE_URL` host is in `BACKFILL_ALLOWED_HOSTS`; `--dry-run` default, `--apply` writes; batches of 500 `WHERE mode IS NULL AND id > $cursor ORDER BY id`; idempotent; writes one `audit_logs` row if P1 created that table (else logs counts).

| Target | Rule |
|---|---|
| `mode` | `gameData.gameMode` `AI`/`ai` → `BOT`; `friend` → `FRIEND`; `quick` → `ONLINE`; `tournament` or `tournamentId` set → `TOURNAMENT`; unknown → `FRIEND` |
| colours | AI: `gameData.playerColor` gives the human; the bot side null. Matchmaking and tournament: creator = White by construction (`matchmaking.service.ts:258-261`, `find-match/route.ts:146-147`). Friend: `gameData.creatorColor` (P1 H6 stopgap) when present. Otherwise both null and `meta.colorUnknown = true` (excluded from P6 Weakness) |
| `moves`, `plyCount`, `fen` | `gameData.moveHistory[].lan` (or `from+to+promotion`) replayed with chess.js from `startingFen`; stop at the first illegal move and flag `meta.backfillTruncated` |
| missing mating move (DB-03) | when `gameData.method = 'checkmate'` and the replay is not mate: try each legal move whose FEN equals `gameData.fen`, append it, count the fixes |
| `endMethod`, `outcome` | map `gameData.method`; a stored `draw_agreement` whose final position is a threefold or fifty-move position becomes `THREEFOLD`/`FIFTY_MOVE` (socket F-12) |
| `timeClass`, `startPly`, `studySeconds = 0`, `phase = ENDED` for finished rows | §8.11 |
| `game_players` | one row per member side of `COMPLETED` games with a known colour (`ON CONFLICT DO NOTHING`) |
| verification | every backfilled `moves` replays legally; `plyCount` = token count; checkmate rows end in mate; `count(game_players)` = completed games × member sides with known colour |

**Dev seed fixtures** (`WEB/scripts/dev/seed-game-fixtures.ts`, also imported by the e2e fixture `WEB/e2e/fixtures/games.ts`; refuses outside dev/test hosts): creates live games between two given users in `WAITING` with `studySeconds = 0` unless stated:

| Fixture | Start | Time control | Exercises |
|---|---|---|---|
| `G-PROMO` | `8/1P5k/8/8/8/8/6K1/8 w - - 0 41` ("Endgame · move 41", b7–b8) | 5+3 | `promotion` (T6) |
| `G-LOWTIME` | initial | 0:15 + 0 (`initialTimeSeconds = 15`) | `low_time`, `over_timeout_*` (T7) |
| `G-INSUFF` | `8/8/8/4k3/8/8/4P3/4K3 w - - 0 81` (White K+P vs a bare king) | 0:20 + 0 | `over_timeout_insufficient` when White flags (Black has only a king) |
| `G-THREEFOLD` | initial | 5+0 | `over_threefold` (knight shuffle) |
| `G-FIFTY` | `8/8/4k3/8/8/4K3/8/R6r w - - 98 120` | 5+0 | `over_fifty` after one quiet move each |
| `G-STALEMATE` | `7k/4Q3/6K1/8/8/8/8/8 w - - 0 59` | 5+0 | `over_stalemate` (59.Qf7 stalemates; 59.Qf8# mates, the design's coach line) |
| `G-STUDY` | an active featured legend position (`studySeconds = 30`) | 5+3 | `study`, `abort`, rematch flow |
| `G-ENDED` | completed checkmate game with a PGN | — | `already_ended` |
| `G-BOT-MID` | bot game with 20 plies and a journal-free server checkpoint | 10+0 | resume on another device (T15) |

The legend positions and openings come from P1's `WEB/prisma/seed-content.ts` (moved to `PKG/db/prisma/seed-content.ts`); the bot user `CHESS_BOT_001` from the existing seed.

### 6.9 The `packages/db` move (WP-A, first PR of the phase)

| Step | Detail |
|---|---|
| Layout | `PKG/db/package.json` (`name: @repo/db`, `exports: {".": "./src/index.ts", "./live": "./src/live/index.ts", "./games": "./src/games/index.ts", "./json": "./src/json/index.ts"}`, scripts `generate`, `migrate:deploy`, `seed`, `test`), `prisma/schema.prisma`, `prisma/migrations/**` (moved with `git mv`), `prisma/protected-indexes.txt`, `prisma/seed.ts`, `prisma/opening-seed.ts`, `prisma/seed-content.ts`, `src/client.ts` (`createPrismaClient({ log, datasourceUrl })` + the dev-only global cache now in `WEB/lib/prisma.ts`), `src/index.ts` (re-exports the generated client types), `sql/roles.sql` |
| Web | `WEB/lib/prisma.ts` becomes `export { prisma } from "@repo/db"`; the 12 importers of `app/generated/prisma` switch to `@repo/db`; `WEB/package.json` scripts `build: "pnpm --filter @repo/db generate && next build"`, `prisma:*` delegate; `transpilePackages` += `@repo/db`, `@repo/game-core`; `outputFileTracingIncludes` keeps the query engine for `linux-musl`/`rhel` targets in the Vercel bundle (check the Vercel build log on day 1) |
| Socket | `WS/package.json` depends on `@repo/db`; the Dockerfile copies `packages/db`, runs `pnpm --filter @repo/db generate` in the builder and copies `packages/db/generated` into the runner |
| Turbo | `turbo.json` task `generate` (outputs `generated/**`), `build` depends on `^generate`; `globalEnv` += `SOCKET_TOKEN_SECRET`, `NEXT_PUBLIC_WEBSOCKET_URL`, `NEXT_PUBLIC_ENGINE_BASE_URL` (audit-quality B-03) |
| Check | `pnpm --filter web build`, `pnpm --filter web check-types`, the existing e2e suite and a Vercel preview build all pass before anything else lands |

---

## 7. API

All new web routes use P1's `route()` wrapper (`WEB/lib/api/route.ts`, B18): input parsed once (400 `invalid_json` / `validation_failed` with `fields`, 413 on size), the B16 envelope `{ data } | { error: { code, message, fields?, retryAfterSec?, requestId } }`, `Server-Timing`, a Sentry span tagged with the endpoint class, and `x-request-id`. Schemas live in `PKG/contracts/src/http/games.ts` and `PKG/contracts/src/socket/*` (zod 4). Ids on the wire are refs; times are epoch ms; no BigInt.

Shared schema fragments:

```ts
// PKG/contracts/src/http/games.ts
export const Ref = z.string().regex(/^c[a-z0-9]{20,30}$/);              // cuid
export const Uci = z.string().regex(/^[a-h][1-8][a-h][1-8][qrbn]?$/);
export const Side = z.enum(["w", "b"]);
export const TimeControl = z.object({
  initialSeconds: z.number().int().min(15).max(10_800),               // 15 s fixtures … 3 h
  incrementSeconds: z.number().int().min(0).max(180),
}).nullable();                                                         // null = untimed (bot games only)
export const GameStart = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("initial") }),
  z.object({ kind: z.literal("random_position") }),                    // legacy default of create-ai-game
  z.object({ kind: z.literal("legend"), legendRef: Ref }),             // random featured position of that legend
  z.object({ kind: z.literal("position"), positionRef: Ref }),         // ChessPosition.referenceId
  z.object({ kind: z.literal("opening"), openingRef: Ref }),
]);
```

### 7.1 New HTTP routes

#### 7.1.1 `POST /api/games` (create a bot game; replaces `POST /api/chess/create-ai-game`)

| | |
|---|---|
| File | `WEB/app/api/games/route.ts` → service `WEB/lib/games/create-bot-game.server.ts` |
| Auth | `member` (402 `subscription_required` with `reason` otherwise) |
| Class | W2 (p95 ≤ 250 ms server time) |
| Idempotency | `Idempotency-Key` header **required** (UUID v4); `idempotency_keys` algorithm of api-design §2.8 (replay with `Idempotent-Replayed: true`; 409 `in_flight` with `retryAfterSec: 2`; 422 `idempotency_key_reused`) |
| Rate limit | P1 `RateLimitBucket`, key `rl:create-game:u:<ref>`, 20 per 10 min (optimization §8.2) |
| Body limit | 4 KB |
| Cache | `no-store` |

```ts
export const GameCreateBody = z.object({
  mode: z.enum(["BOT", "LEGEND_BOT"]),                // LEGEND_BOT → 400 validation_failed {reason: mode_not_available} until P8's flag
  start: GameStart.default({ kind: "random_position" }),
  color: z.enum(["w", "b", "random", "auto"]).default("auto"),   // auto = legacy rule: opening side / legend side / side to move
  botElo: z.number().int().min(400).max(2200).multipleOf(100).optional(),   // default from the viewer's rating (§8.13)
  tc: TimeControl.default({ initialSeconds: 600, incrementSeconds: 0 }),
  parentGameRef: Ref.optional(),
  reason: z.enum(["new", "rematch", "restart"]).default("new"),  // rematch: colours swapped vs the parent; restart: same colour, parent aborted if < 2 plies
});
export const GameCreateResponse = z.object({ game: GameSnapshot });   // 201
```

Errors: 400 `validation_failed` (including `{details.reason: "mode_not_available"}` for `LEGEND_BOT`); 402; 404 `not_found` (position, legend, opening, parent); 409 `in_flight`; 422 `illegal_position` (a stored FEN that chess.js rejects; logged), 422 `idempotency_key_reused`; 429 `rate_limited`. Every code is in `PKG/contracts/src/http/codes.ts` with exactly one status (`codes.test.ts`).

Behaviour: resolves the start (same rules as `create-ai-game` `:150-232`: opening → the opening's side; legend → the legend's side; otherwise the side to move), the colour, `botElo`, `timeClass`, `startPly`, `meta` (header, prefix, position card), then §6.6.1. PostHog server event `bot_game_started` in `after()`.

#### 7.1.2 `GET /api/games/[ref]` (role-aware snapshot)

| | |
|---|---|
| File | `WEB/app/api/games/[ref]/route.ts` → `getGameSnapshot()` (the same function the RSC calls) |
| Auth | `member`; players always; other members only when the game is watchable (live modes `FRIEND`, `ONLINE`, `TOURNAMENT`; bot games are private to their player). A lapsed player of an `IN_PROGRESS` game is allowed |
| Class | R1 |
| Cache | live: `private, no-store`; `COMPLETED`/`ABORTED`: `private-etag` tier (`ETag: "g-<ref>-<updatedAt>"`, `Cache-Control: private, max-age=0, must-revalidate`, 304 on match) |
| Response | `{ snapshot: GameSnapshot }` |
| Errors | 401, 402, 404 `not_found` (also for a game the viewer may not see, so existence is not leaked) |

```ts
export const GameSnapshot = GameState.extend({          // GameState from PKG/contracts/src/socket/game.ts (§7.4.6)
  status: z.enum(["WAITING_FOR_OPPONENT", "IN_PROGRESS", "COMPLETED", "ABORTED", "CANCELLED", "EXPIRED"]),
  watchable: z.boolean(),
  updatedAt: z.number().int(),
  rev: z.number().int(),                                 // bot journal revision
});                                                      // no shareSig: game images come only from P3 shares (§7.1.6)
```

Spectators get the spectator projection: no `drawOffer`/`rematch`, moves cut one ply behind for live games (§8.10), `you.role = "spectator"`.

#### 7.1.3 `POST /api/games/[ref]/checkpoint` (bot games)

| | |
|---|---|
| File | `WEB/app/api/games/[ref]/checkpoint/route.ts` |
| Auth | `user` + player of this `BOT` game (membership is not re-checked: a beacon from a tab that outlived the session must still save) |
| Class | W1 |
| Body | JSON or `text/plain` (sendBeacon), ≤ 8 KB: `{ rev: int ≥ 1, moves: Uci[] ≤ 400, clocksMs: int[] (same length or empty), assists: { hints, undos } }` |
| Validation | `rev > stored + 64` → 409 `conflict {details.reason: "rev_gap"}` (a scripted client cannot skip the guard). **Suffix-only replay:** when the stored `moves` string is a prefix of the new one, only the new suffix is replayed with chess.js, starting from the stored `fen`; otherwise the whole list is replayed from `startingFen`. Illegal → 422 `illegal_moves` (logged once per game) |
| Response | 204 always on success **and** when the `rev` guard skips the write (a late or duplicate beacon) |
| Idempotency | natural: `meta.rev` guard (§6.6.7) |
| Rate limit | bucket **`bot-checkpoint` = 60 / 60 s per user** (P1 fixed window; a ≤ 60 s window is safe on the UNLOGGED table, api-perf AP-11/AP-32) + the 8 KB body cap. Over the limit → 429 `rate_limited`; the client keeps the newer state locally and the next checkpoint carries it (nothing is lost, the `rev` guard makes the late write correct) |

#### 7.1.4 `POST /api/games/[ref]/complete` (bot games)

| | |
|---|---|
| File | `WEB/app/api/games/[ref]/complete/route.ts` → `WEB/lib/games/complete-bot-game.server.ts` → `@repo/game-core/adjudicate` |
| Auth | `user` + player of this `BOT` game |
| Class | W2 |
| Body (≤ 16 KB) | `{ rev, moves: Uci[], clocksMs: int[], result: "w" \| "b" \| "draw" \| "aborted", method: EndMethod, assists: { hints, undos }, endedAtClient: int }` |
| Response 200 | `{ status: "COMPLETED" \| "ABORTED", outcome: "WHITE" \| "BLACK" \| "DRAW" \| "NONE", method, analysis: { status: "none" } }` (P3 returns `queued`) |
| Idempotency | natural on `ref`: an already finished game returns the stored result with `Idempotent-Replayed: true` |
| Errors | 403 not a player; 404; 409 `conflict {details.reason: "not_bot_game"}`; 422 `illegal_moves` (a move does not replay); 422 `illegal_moves {details.reason: "claim_mismatch"}` (claimed method/winner not consistent with the board, §8.16) |

Server-side adjudication is the fix for "bot games trust the browser" (audit-quality SEC-07): the board-verifiable endings must match; resignation, timeout, agreement and abort are accepted as claimed only within the constraints of §8.16, since these games are unrated.

#### 7.1.5 `GET /api/games/[ref]/pgn`

| | |
|---|---|
| File | `WEB/app/api/games/[ref]/pgn/route.ts` |
| Auth | `member` + player (bot or live) |
| Response | `text/x-chess-pgn; charset=utf-8`, `Content-Disposition: attachment; filename="replaychess-<ref>.pgn"`; body = `games.pgn` (built once at the end) |
| Cache | **`private, no-store`** (a download; never kept in the browser HTTP cache, where the next user of a shared device could reach it without an auth check, api-perf AP-04); 409 `conflict {details.reason: "not_finished"}` for a live game. The body is built once at game end, so a repeat download costs one indexed read |

#### 7.1.6 Game images: not built in P2

Revision 1 planned `GET /og/game/[ref]?ply=&sig=` with a never-expiring signature and `public, immutable` caching. It is **dropped** (api-perf AP-05): a signed URL that names both players stays valid and cached for a year, and neither "stop sharing" nor "hide my username" (P3, P10) can reach it. Images of games are served only through P3's shares (`/r/{code}/opengraph-image?v=`, cache-tagged `share:{code}`, purged on revoke). Consequences in P2:

- `GameSnapshot` has no `shareSig` field.
- The result card's Share menu offers **Copy link** and **Download PGN** only. P3 adds "Share image" when it ships shares.
- `OG_SIGNING_SECRET` is not created; `WEB/app/og/game/` does not exist.
- If an in-app "image of my game" is wanted before P3, it is rendered on the client from the SVG board (no server route).

#### 7.1.7 `GET /api/socket-token` (changed)

| | |
|---|---|
| Auth | `user` (any signed-in user still gets a token: P4's activation screen needs the `user:` room before entitlement, pub G23) |
| Response | `{ token, expiresAt }`, `no-store` |
| Claims | `SocketTokenClaims` (§7.4.2): `ent` = entitled-until (unix s), `env`, `role`, `name`, `kid`, TTL ≤ 15 min. **Source of `ent`:** the verified Clerk session claims (`md.entitled` + `md.entUntil`, written by P1's `syncClerkClaims`) when both are present, so minting reads no DB; otherwise `getViewer().entitlement` (trial end or `currentPeriodEnd`; 0 when not a member), one viewer read. This keeps the post-deploy reconnect burst (every client re-mints within ≈ 5 s) off Neon (api-perf AP-41) |
| Signing | `SOCKET_TOKEN_SECRET` (new). The fallback to the old shared secret exists **only on dev during the WP-D rollout** and is removed before the P2 DoD; production never has it, because `INTERNAL_API_SECRET` is now the service HMAC key set (§7.5.1) and must never verify user tokens (architecture X16) |
| Minted also | inside the `(app)/layout` render by `RealtimeBoot` (no round trip on first connect) |

### 7.2 Changed legacy routes (kept until P9/P12, made atomic)

| Route | Change |
|---|---|
| `POST /api/chess/create-game` | Through `createLiveGame()`: writes `mode = FRIEND`, the creator's colour column, `studySeconds`, `timeClass`, `startPly`, `fen`, `phase = WAITING`, `meta`, the creator's `GamePlayer`; still `WAITING_FOR_OPPONENT`; **`Idempotency-Key` accepted** (optional, to stop double-click duplicates, audit-api F-06) |
| `POST /api/chess/join` | Conditional update (§6.6.2); fills the empty colour; inserts the joiner's `GamePlayer`; 409 `conflict {reason: already_started}` |
| `POST /api/chess/cancel-game` | `updateMany({ where: { referenceId, creatorId: me, status: "WAITING_FOR_OPPONENT" } })`; `count = 0` → 409 |
| `matchmaking.service.ts` `tryFindMatch` | `createLiveGame(tx, { mode: "ONLINE", white: creator, black: opponent, … })`; uses `tx` everywhere (DB-11) |
| `POST /api/tournament/find-match` | `createLiveGame(tx, { mode: "TOURNAMENT", tournamentId, … })` |
| `GET /api/analysis/[gameId]` | Reads `moves` + colours when present (adapter, §3.2) |
| `GET /api/cron/daily` (P1 CRON-1) | Adds the stale bot-game sweep (§6.6.8) and the `idempotency_keys` prune if P1 did not |

### 7.3 Removed routes and their removal point

| Route | Callers today | Removed when |
|---|---|---|
| `POST /api/chess/create-ai-game` | `play/page.tsx:155`, `queue/page.tsx:262`, `PositionPageClient.tsx:105` | WP-E, as soon as the callers use `useCreateBotGame()` |
| `POST /api/chess/move`, `/api/chess/game-state`, `/api/chess/game-over` | v1 socket handlers only (internal-only since P1 H2) | **Parity gate** (end of P2, WP-I): deleted with `WS/src/v1/`, `GamePageContent.tsx` and `lib/types/socket-events.ts` |
| Socket use of `GET /api/chess/game-by-ref` | v1 `GameManager.ts:42,82` | parity gate; the browser use by `/join` stays until P9 |

### 7.4 Socket protocol v2

#### 7.4.1 Connection

```ts
// client (WEB/lib/realtime/connection.ts)
io(process.env.NEXT_PUBLIC_WEBSOCKET_URL, {
  autoConnect: false, transports: ["websocket", "polling"], upgrade: false, tryAllTransports: true,
  reconnectionDelay: 500, reconnectionDelayMax: 5000, randomizationFactor: 0.5, timeout: 10_000,
  auth: (cb) => void freshToken().then((t) => cb({ token: t?.token, proto: 2, build: BUILD_ID })),
});

// server (WS/src/server/io.ts)
new Server(http, {
  cors: { origin: ALLOWED_ORIGINS, credentials: false },
  allowRequest: (req, cb) => cb(null, originAllowed(req.headers.origin)),   // fails closed when ALLOWED_ORIGINS is unset in dev/production
  pingInterval: 10_000, pingTimeout: 8_000,       // dead link noticed in ≤ 18 s (today ≤ 45 s, socket F-28)
  maxHttpBufferSize: 16 * 1024, perMessageDeflate: false,
  // no connectionStateRecovery: memory-only, useless across restarts; snapshot resync is the one path (socket §17.1.3)
});
io.use(handshake);   // WS/src/server/handshake.ts
```

Handshake (`WS/src/server/handshake.ts`):
1. Abuse guards (in memory; api-perf AP-17, because Indian mobile carriers, campuses and offices put thousands of users behind a few CGNAT IPs):
   - **per user** (token `sub`, checked after step 3): ≤ 10 open sockets and ≤ 20 handshakes per minute;
   - **per IP**, a flood guard only: ≤ 500 open sockets and ≤ 300 handshakes per minute, **suspended for 120 s after boot** (the restore window, when every tab reconnects within the 0.5–5 s backoff).
   Over a limit → `connect_error {message: "rate_limited"}`; the client backs off to `reconnectionDelayMax`.
2. `proto === 2` → v2 handlers. Missing `proto` → v1 handlers while `PROTOCOL_V1=on` (until the parity gate), else `connect_error "upgrade_required"`.
3. Verify the token with `verifySocketToken()` from `@repo/contracts/socket/token`: HMAC (`SOCKET_TOKEN_SECRET[kid]`), `exp > now`, `env === APP_ENV`, `v === 2`. Failure → `connect_error "unauthorized"`. `SOCKET_AUTH_REQUIRED` no longer exists: every socket is authenticated (socket F-02).
4. `socket.data = { userRef: claims.sub, name, role, ent, tokenExp }`; `socket.join(ROOM.user(sub))`.
5. A live socket stays connected after its token expires (the handshake is what is authenticated); `ent` checks use the newest token, refreshed through `session:refresh_token`.
6. The server emits `session:hello { bootId, useq, serverNow }` to the new socket. `bootId` is a random id per process start; `useq` is the user's per-process user-room event counter (every `user:` room event carries the next `useq`). On reconnect the client refetches the user-level queries only if `bootId` changed or a `useq` gap shows a missed event (api-perf AP-25: the per-game `seq` rule applied to user rooms), instead of marking 3–5 queries stale on every flaky-network reconnect.

#### 7.4.2 Token claims (`PKG/contracts/src/socket/token.ts`)

```ts
export const SocketTokenClaims = z.strictObject({
  v: z.literal(2),
  sub: Ref,                                         // user referenceId; the only identity the socket trusts
  iat: z.number().int(), exp: z.number().int(),     // TTL ≤ 15 min
  env: z.enum(["local", "ci", "dev", "production"]),
  ent: z.number().int().min(0),                     // entitled until (unix s); 0 = not a member
  role: z.enum(["user", "admin"]),
  name: z.string().max(40),                         // display name for PlayerView without a DB read
  kid: z.string().max(8),
  e2eRun: z.string().max(64).optional(),            // APP_ENV=test only (refused at verify otherwise): isolates the
                                                    // legacy matchmaking pool per Playwright test (testing X4.5); P9 reuses it
});
// wire: base64url(JSON(claims)) + "." + base64url(HMAC_SHA256(secret[kid], payload)); timing-safe compare
export function signSocketToken(claims: SocketTokenClaims, keys: KeyRing): string;
export function verifySocketToken(token: string, keys: KeyRing, now: number, env: Env): SocketTokenClaims | null;
```

#### 7.4.3 Rooms

Room names are built only by `ROOM` in **`PKG/contracts/src/socket/rooms.ts`** (created by P2; P9 R2 and P12 import it): `ROOM.game(ref)` = `game:{ref}`, `ROOM.spectate(ref)` = `spectate:{ref}`, `ROOM.user(ref)` = `user:{ref}`, `ROOM.tournament(slug)` = `tournament:{slug}`. An ESLint `no-restricted-syntax` rule bans string literals matching `/^(user|game|spectate|tournament):/` outside `rooms.ts` and `registry.ts` (api-perf §5 "name registry").

| Room | Members | Carries |
|---|---|---|
| `game:{ref}` | every socket of both players (multi-tab aware) | all game events, offers, rematch, presence, clock sync, restart notice |
| `spectate:{ref}` | spectators (members, watchable games) | delayed moves (one ply), phases, presence, end, spectator count, restart notice; never offers or rematch internals |
| `user:{ref}` | every socket of a user, joined at connect | P2: nothing game-specific yet (rematch start goes to `game:{ref}`); the spine for P3+ (`/internal/emit`) |
| `tournament:{ref}` (legacy) | lobby viewers | legacy `tournament_*` events until P12 |

#### 7.4.4 Client → server commands (all acked; 5 s client timeout)

Ack shape: `{ ok: true, ...result } | { ok: false, code: SocketErrorCode, message?: string, state?: GameState, retryAfterMs?: number, canOfferAtPly?: number }`.

| Command | Payload | Allowed when | Ack `ok` result | Error codes | Limit |
|---|---|---|---|---|---|
| `game:join` | `{ ref, lastSeq? }` | caller is White or Black of the game (any phase; a lapsed player is allowed) | `{ role: "player", color, state: GameState }` | `not_found`, `forbidden` (not a player → use `spectate:join`), `draining` (no new sessions during a drain; existing sessions join fine) | 5 / 10 s per socket |
| `spectate:join` | `{ ref }` | `ent > now`, game watchable, not a player (a player is answered as `game:join`) | `{ role: "spectator", state }` | `not_member`, `forbidden`, `not_found` | 5 / 10 s |
| `game:leave` | `{ ref }` | any | `{}` | — | — |
| `game:sync` | `{ ref }` | any | `{ state }` | `not_found` | 2 / s |
| `study:ready` | `{ ref }` | `phase = study`, player | `{ ready: { w, b } }` | `phase` | 2 / s |
| `game:move` | `{ ref, ply, uci, clientMoveId, premove?: boolean }` (`ply` = plies already played; the move becomes `ply + 1`) | `phase = first_move` for your side, or `playing` on your turn | `MoveAck { seq, ply, san, clocks, clientMoveId }` | `phase`, `ended`, `not_your_turn`, `stale_ply` (+`state`), `promotion_required`, `illegal` (+`state`), `rate_limited` | 10 / s, burst 20 |
| `game:abort` | `{ ref }` | `phase = first_move`, caller is `firstMove.side` (default rule, owner Q2) | `{}` | `phase`, `not_allowed` | 1 / s |
| `game:resign` | `{ ref }` | `playing`; in `first_move` treated as abort if you have not moved | `{}` | `phase`, `ended` | 1 / s |
| `draw:offer` | `{ ref }` | `playing`, no own open offer, `plyCount ≥ canOfferAtPly[you]`; if the opponent's offer is open this **accepts** | `{ drawOffer }` | `phase`, `draw_cooldown` (+`canOfferAtPly`) | by cooldown |
| `draw:accept` / `draw:decline` | `{ ref }` | `playing`, an open offer **from the opponent** (socket F-01) | `{}` | `no_offer` | 2 / s |
| `rematch:offer` | `{ ref }` | `ended`, mode `FRIEND`/`ONLINE`, not aborted, ≤ 3 offers per game, both players still attached | `{ expiresAt }` (an open opponent offer → accept) | `not_allowed`, `expired`, `draining` | 3 per game |
| `rematch:accept` | `{ ref }` | open offer from the opponent, `ent > now` for **both** players (newest tokens) | `{ newRef }` | `no_offer`, `expired`, `paywall`, `not_member`, `internal` (DB insert failed) | 1 / s |
| `rematch:decline` / `rematch:cancel` | `{ ref }` | open offer from the opponent / own open offer | `{}` | `no_offer` | 2 / s |
| `clock:ping` | `{ c: clientEpochMs }` | any | `{ c, s: serverEpochMs }` | — | 1 / s |
| `live:list` | `{ timeClass?: "bullet" \| "blitz" \| "rapid" }` | `ent > now` | `{ games: LiveGameCard[] (≤ 20, from memory) }` | `not_member` | 1 / 2 s |
| `session:refresh_token` | `{ token }` | any | `{ ent }` | `unauthorized` (bad token → socket closed) | 1 / 10 s |

`LiveGameCard = { ref, mode, timeClass, tcLabel, white: { name, rating }, black: { name, rating }, ply, spectators, startedAt }` (watchable games in `playing`, ordered by average rating, then spectators).

#### 7.4.5 Server → client events

Every event in `game:{ref}` and `spectate:{ref}` carries `seq` (per room, +1 per event) and `ref`.

| Event | Room(s) | Payload | When | Design states |
|---|---|---|---|---|
| `game:snapshot` | sender | `GameState` (also inside `game:join`, `spectate:join`, `game:sync` acks) | resync pushed by the server after a restore resume or an internal correction | `loading` → any |
| `game:phase` | game, spectate | `{ seq, ref, phase, study?: { endsAt, ready }, firstMove?: { side, deadlineAt }, clocks }` | waiting → study → first_move (each side) → playing | `waiting`, `study`, `abort`, `rematch_first`, `rematch_your`, `your_move`/`their_move` |
| `study:ready` | game | `{ seq, ref, side }` | a player clicked "I'm ready" | opponent bar "Ready" |
| `move:applied` | game (immediately), spectate (one ply late) | `{ seq, ref, ply, uci, san, by, clocks, check?, premove?, drawOfferCleared? }`; **no `fen`** (every client has chess.js and the move list and derives it; `game:sync` repairs a divergence), **no `clientMoveId`** (it is echoed only in the mover's ack; the mover's other tabs match on `ply` + `uci`), and the three booleans are **omitted when false** (api-perf AP-16) | every accepted move | `your_move` ↔ `their_move`, `check`, premove execution |
| `clock:sync` | game, spectate | `{ seq, ref, clocks, frozen?: { since, reason: "restart" } }` | presence change, freeze/resume after a restart, and a 15 s drift check while `playing` (never every second) | `low_time` is client-derived |
| `presence:update` | game, spectate | `{ seq, ref, side, online, graceEndsAt? }` | a player's last socket left / first socket returned | `opp_disconnected`, `opp_reconnected` |
| `draw:offered` / `draw:declined` / `draw:cancelled` | game | `{ seq, ref, by }` / `{ seq, ref, by, canOfferAtPly, implicit }` / `{ seq, ref }` | offer, decline (explicit or by moving), offer cleared | `draw_received`, `draw_sent` → `draw_declined` |
| `game:ended` | game, spectate | `{ seq, ref, winner: w\|b\|null, method: EndMethod, ply, endedAt, finalFen, clocks, rated: false }` | immediately on the end, before persistence | every `over_*` |
| `session:hello` | sender (connect) | `{ bootId, useq, serverNow }` | once per connect (§7.4.1 step 6) | — (reconnect resync decision) |
| `game:result` | game | `{ seq, ref, ratings: null, tournament: null, review: { status: "none" } }` (P3/P9/P12 fill the fields) | after `finishGame()` committed | — (P3 `over_analysing`, P9 rating line) |
| `rematch:offered` / `rematch:declined` / `rematch:cancelled` / `rematch:expired` | game | `{ seq, ref, by, expiresAt?, youPlay? }`; `expired` adds `reason: timeout \| left` | offer lifecycle | `over_rematch_*` |
| `rematch:started` | game | `{ seq, ref, newRef, colors: { w: userRef, b: userRef } }` | new game created | navigate → `rematch_study` |
| `spectators:update` | game, spectate | `{ ref, count }` (no `seq`; ≤ 1 per 5 s) | count changed | "12 watching" |
| `game:error` | sender | `{ ref, code, message }` | an unrecoverable server error for this game | `server_error` |
| `server:restarting` | all game and spectate rooms | `{ restartAt, resumes: true }` | drain notice | in-game restart chip |

#### 7.4.6 Payload types (`PKG/contracts/src/socket/game.ts`)

```ts
export type Side = "w" | "b";
export type Phase = "waiting" | "study" | "first_move" | "playing" | "ended";
export type EndMethod = "checkmate" | "resignation" | "timeout" | "timeout_vs_insufficient" | "stalemate"
  | "threefold" | "fifty_move" | "insufficient_material" | "agreement" | "abandoned" | "aborted";
export interface Clocks { w: number; b: number; run: Side | null; at: number }          // ms; at = server epoch ms
export interface PlayerView {
  ref: string | null; displayName: string; initials: string; avatarUrl: string | null;
  rating: number | null; isBot: boolean; online: boolean; graceEndsAt: number | null; ready?: boolean;
}
export interface GameState {
  v: 2; ref: string; seq: number; serverNow: number;
  mode: "BOT" | "FRIEND" | "ONLINE" | "TOURNAMENT"; rated: boolean;
  timeClass: "bullet" | "blitz" | "rapid" | "classical" | "untimed";
  tc: { initialMs: number; incrementMs: number; label: string } | null;     // "5+3"; null = untimed
  header: { left: string; right: string };                                   // "C41 · Philidor · Opera Game 1858" | "Blitz 5+3 · unrated"
  position: { name: string; event: string | null; year: number | null; sideToMove: Side;
              afterLabel: string | null; legendSide: Side | null } | null;
  startFen: string; startPly: number;
  prefix: { sans: string; startMoveNo: number; startsBlack: boolean };     // "Game starts here"; space-separated SAN like `moves`
                                                   // (a legend prefix can hold up to 400 SAN, ≈ 2.4 KB as a JSON array)
  moves: string;                                   // space-separated UCI (≈ 400 B at 80 plies); SAN derived on the client
  clocksMs: number[];                              // mover's remaining ms after each ply
  fen: string; turn: Side; inCheck: boolean;
  phase: Phase;
  study: { endsAt: number; ready: { w: boolean; b: boolean } } | null;
  firstMove: { side: Side; deadlineAt: number } | null;
  clocks: Clocks; frozen: { since: number; reason: "restart" } | null;
  players: { w: PlayerView; b: PlayerView };
  you: { role: "player" | "spectator"; color?: Side };
  drawOffer: { by: Side; ply: number } | null;     // players only
  canOfferAtPly: { w: number; b: number };
  rematch: { by: Side; expiresAt: number; offersUsed: number } | null;   // players only
  spectators: number;
  result: { winner: Side | null; method: EndMethod; ply: number; endedAt: number } | null;
  bot?: { elo: number; name: string };             // BOT games
}
export interface MoveApplied {                     // ≤ 200 B serialised (realistic fixture: 25-char ref, 3-digit ply)
  seq: number; ref: string; ply: number; uci: string; san: string; by: Side; clocks: Clocks;
  check?: true; premove?: true; drawOfferCleared?: true;          // omitted when false
}
export interface MoveAck {                          // ack of game:move, to the mover only
  seq: number; ply: number; san: string; clocks: Clocks; clientMoveId: string;
}
```

Size budgets (asserted in `PKG/contracts/src/socket/test/size.test.ts` with **realistic** fixtures: a 25-character cuid ref, a real FEN, 3-digit plies, 20-character names and the longest seeded legend prefix, not only a standard start): `GameState` ≤ 2 KB serialised at 80 plies **and** with the longest legend prefix; `move:applied` ≤ 200 B; `MoveAck` ≤ 160 B; every other event ≤ 120 B (optimization §5.4).

#### 7.4.7 Error codes (`PKG/contracts/src/socket/codes.ts`)

`unauthorized`, `not_member`, `paywall`, `forbidden`, `not_found`, `phase`, `ended`, `not_your_turn`, `illegal`, `promotion_required`, `stale_ply`, `no_offer`, `draw_cooldown`, `not_allowed`, `expired`, `rate_limited`, `draining`, `internal`, plus the connect errors `upgrade_required` and `rate_limited`. Messages are for logs only and never contain user ids or emails (today `GameSession.ts:139` prints both players' ids). Every inbound payload is zod-validated; an invalid one gets `{ok:false, code:"internal"}` and the metric `ws.invalid_payload{event}`, never a crash.

#### 7.4.8 Rate limits and abuse rules (in memory, per socket unless noted)

Token bucket 20 events/s burst, 10/s sustained for all commands together, plus the per-command limits in §7.4.4. Over the limit → ack `rate_limited` with `retryAfterMs`; 5 s of sustained flooding disconnects the socket. Per user: one queue entry (P9), at most 3 rematch offers per game, draw offers by cooldown, abort abuse (3 aborts in 10 minutes) is recorded in `meta` for P9's queue ban. Connection limits are per user first and per IP only as a flood guard (§7.4.1); the constants `SOCKETS_PER_USER = 10`, `HANDSHAKES_PER_USER_PER_MIN = 20`, `SOCKETS_PER_IP = 500`, `HANDSHAKES_PER_IP_PER_MIN = 300`, `IP_GUARD_BOOT_GRACE_MS = 120_000` live in `PKG/contracts/src/socket/limits.ts`.

#### 7.4.9 Name mapping (for readers of api-design §6 and the v1 code)

| api-design §6 name | P2 name | v1 event (`WS/index.ts`, `GameSession.ts`) |
|---|---|---|
| `game:join` (role decided by the server) | `game:join` (players) + `spectate:join` | `join_game {gameReferenceId, userReferenceId}`, `spectate_game` |
| `game:ready` / event `game:ready` | `study:ready` (command and event) | — |
| `game:move` + ack | `game:move` + ack (adds `clientMoveId`) | `make_move {from,to,promotion}` + `move_error` |
| `game:draw {action}` / `game:draw {kind}` | `draw:offer\|accept\|decline` / `draw:offered\|declined\|cancelled` | `offer_draw`, `accept_draw`, `decline_draw`, `draw_offered`, `draw_declined` |
| `game:rematch {action}` / `game:rematch {kind}` / `game:rematch_started` | `rematch:offer\|accept\|decline\|cancel` / `rematch:offered\|declined\|cancelled\|expired` / `rematch:started` | client `create-game` (no event) |
| `game:move` event | `move:applied` | `move_made` |
| `game:clock` | `clock:sync` | `clock_update` (1/s, removed) |
| `game:presence` | `presence:update` | `opponent_disconnected`, `opponent_reconnected` |
| `game:over` | `game:ended` | `game_over` |
| `game:state` | `game:snapshot` | `spectator_state`, `game_started` (reconnect overload), `waiting_for_opponent` |
| `game:phase` | `game:phase` | `analysis_phase_started` + `analysis_tick` (1/s, removed), `game_started` |
| `game:spectators` | `spectators:update` | `spectator_count` |
| `server:restarting {at}` | `server:restarting {restartAt}` | `server_restarting` (no client handler) |
| ack codes, `game:error` | ack codes, `game:error` | `error {message}` free text |

### 7.5 HTTP endpoints on the socket server (`WS/src/http/*`)

| Path | Caller | Auth | Body → response | Notes |
|---|---|---|---|---|
| `GET /health` | uptime monitor, compose | none | `{ ok, loopLagMs }` | 200 while the process is alive and loop lag < 1 s |
| `GET /ready` | compose healthcheck, deploy | none | `{ ready, draining, restored, outboxOldestMs, dbOkAt }` | 503 while draining, before restore finished, if the oldest unflushed ply is > 60 s old, or if no DB write succeeded in the last 5 min **while games are live** (no DB probe when idle: it would wake Neon) |
| `POST /internal/emit` | web (kid `web`; P2 legacy tournament routes, P3+), worker (kid `wk`, P3+) | HMAC (§7.5.1) + per-kid event allow-list | `{ v: 1, targets: ({ room } \| { userRef })[] ≤ 50, event, data, dedupeKey? }` → 202 `{ delivered }`. **This is the only body shape:** the zod schema is `.strict()`, so `{room}` and `rooms[]` bodies get 400 | B20 fan-out. `event` must be in the server→client registry (`PKG/contracts/src/socket/registry.ts`) **and** in the caller kid's allow-list, and `data` must parse against its schema; `dedupeKey` remembered 60 s. **Empty rooms are skipped before the parse:** a target whose room has no sockets (`io.of("/").adapter.rooms.get(room)?.size` is 0) is dropped first, and when every target is empty the server answers 202 `{delivered: 0}` without parsing `data` (api-perf AP-10). P2 registers only `test:echo` (dev) |
| `POST /internal/tournament-event` | legacy web tournament routes (kid `web`) | HMAC | legacy body | alias that forwards to the emit service; removed in P12 |
| `POST /internal/broadcast` | deploy workflow, admin (kid `ops`) | HMAC; blocked at Caddy, reached via `docker compose exec websocket node dist/cli/internal.js broadcast --in 30`, a CLI that signs with the `ops` key | `{ v: 1, type: "restart", inSeconds: 5..600 }` → 202 | sets `draining`, emits `server:restarting {restartAt}` |
| `POST /internal/drain` | ops (kid `ops`) | same | `{ v: 1 }` → 202 | runs the SIGTERM drain without exiting the container's restart policy (manual use only) |
| `GET /internal/metrics` | ops, P12 admin tile (kid `ops`, or `web` for the admin tile) | same | `{ sockets, games: { byPhase }, outbox: { depth, oldestMs }, loopLag: { p50, p99 }, rssMb, restored, bootId }` | uses `io.engine.clientsCount` |

#### 7.5.1 Internal request signing (`PKG/contracts/src/internal/auth.ts`, every hop)

One helper, imported as `@repo/contracts/internal/auth` (server-only; an ESLint rule bans it from client components). Every sender calls `signInternal()` (web: `WEB/lib/internal/fetch.ts` wraps it as `internalFetch(url, body)`), every receiver calls `verifyInternal()`. Nobody writes the headers by hand, so if the owner overrules this choice (§14.3) only the helper changes.

```
x-rc-kid: web                                   (key id; also selects the caller's event allow-list)
x-rc-ts:  1793563200                            (unix seconds; rejected if |now − ts| > 60)
x-rc-sig: base64url(HMAC-SHA256(key[kid], ts + "\n" + METHOD + "\n" + path + "\n" + sha256hex(rawBody)))
```

- **Keys:** the one env var `INTERNAL_API_SECRET` holds a key set `kid:base64[,kid:base64]` (consistency R-09 name, architecture X16 format); a sender signs with the first entry, a receiver accepts every listed kid. A bare value without `kid:` is read as kid `web` so existing env files keep working during the rollout. Kids in P2: `web` (Vercel → socket), `ops` (CLI and deploy workflow inside the container). P3 adds `wk` (worker); P12 adds the socket's own kid for `/api/internal/*` if it needs one. Each service holds only the keys it signs with plus, on a receiver, the keys it accepts, so a leaked worker env cannot sign as web.
- **Allow-lists per kid** (`WS/src/http/allow.ts`): `web` may emit every registered event; `wk` (from P3) only `analysis:*`, `import:*`, `weakness:*`, `bank:*`, `compare:*`, `review:*`, `games:changed`, `export:ready`; `ops` may call only `/internal/broadcast`, `/internal/drain` and `/internal/metrics`. A forged `entitlement:changed` therefore needs the web key.
- **Replay:** OCI receivers keep a 2-minute in-memory set of seen `x-rc-sig` values and reject repeats; every internal endpoint is idempotent anyway.
- **Compare:** `crypto.timingSafeEqual` on equal-length buffers; unknown kid, stale ts, bad sig and replay all answer 401 with no detail, and are counted as `ws.internal.auth_fail{reason}`.
- **Caddy pre-check** (`deploy/oci/Caddyfile`, feasibility SEC-8): `@unsigned { path /internal/* /engine/*; not header X-Rc-Sig * }` → `respond 401`, so unsigned junk never reaches Node on the 1-OCPU box; `request_body max_size 64KB` stays.
- **Rotation:** add the new kid to every receiver, deploy, move it to the front of the sender's set, remove the old kid after 24 h.
- **Never the static token:** the v2 server does not read `x-internal-token`; all P2 callers (the legacy tournament routes included) switch to `internalFetch()` in WP-E. The static-token check survives only inside `WS/src/v1/` behind `PROTOCOL_V1=on` and is deleted with the v1 code (Q5).

### 7.6 Persistence, restore and deploys (socket side)

**Outbox per game** (`WS/src/persist/outbox.ts`): plies and phase/clock changes not yet written. Flush when 10 plies are queued, 15 s after the first unflushed change, on finish/abort, and on drain (B4). One write in flight per game; `AbortSignal`-style 8 s statement budget (`statement_timeout` 5 s on the role); a transient error (Neon suspend, §6.7) is retried once at once on a fresh connection, then the backoff 1, 2, 4, 8 … 60 s with ±20 % jitter applies. The finish CTE carries every unflushed ply. Metrics `ws.outbox.depth`, `ws.outbox.oldest_ms`.

**Journal** (`WS/src/persist/journal.ts`): `/data/journal/{ref}.ndjson` on the Docker volume `ws_journal`, one line per event, `fsync` batched every 200 ms. The `open` line carries the format version `v`; a reader that meets a `v` newer than it knows **skips that file and restores the game from the DB row only** (Sentry warning `ws.restore{result:"journal_newer"}`) instead of crashing, so rolling the socket image back across a journal format change is safe (§14.4):

```
{"t":"open","v":1,"at":…,"startFen":"…","tc":{"i":300000,"inc":3000},"colors":{"w":"<userRef>","b":"<userRef>"},"studyS":30}
{"t":"phase","at":…,"phase":"study","endsAt":…}
{"t":"ply","n":1,"uci":"e2e4","san":"e4","clk":300000,"spent":0,"at":…}
{"t":"draw","at":…,"by":"w","ply":24}            {"t":"drawx","at":…,"by":"b","canAt":28}
{"t":"freeze","at":…}                             {"t":"end","at":…,"method":"checkmate","winner":"w","ply":33}
{"t":"flushed","n":30}                            (DB acknowledged up to ply 30)
```

≈ 100 B per line; deleted 1 h after the finish is acknowledged; files older than 24 h are deleted at boot.

**Restore at boot** (`WS/src/persist/restore.ts`, socket §18.4):
1. Read every journal file and run the restore list query (§6.6.8).
2. Per game, take the longer move list (the journal wins ties) and push missing plies with one checkpoint.
3. `new Chess(startFen)` and **replay** every ply (keeps threefold history; never load a FEN). An illegal ply → mark the game for abort with `meta.abortedBy = "stale"`, Sentry error, metric `ws.restore{result:"corrupt"}`.
4. Restore phase, deadlines, draw offer, presence (all offline) and clocks **frozen** (`frozen = {since: restoreAt, reason: "restart"}`). A study or first-move deadline that passed during the downtime is extended by the downtime.
5. Resume when both players are attached, or 60 s after boot (then the normal presence rules apply: grace for the absent side).
6. `/ready` turns 200; the boot stale sweep runs once.

**Drain** (`WS/src/persist/drain.ts`, on SIGTERM/SIGINT and `/internal/drain`): set `draining` (no new sessions, no rematch creation: ack `draining`), freeze every running clock at `at`, journal `freeze` + fsync, flush every outbox (checkpoints in parallel, ≤ 8 at a time), `io.close()`, exit 0. Budget ≤ 20 s inside `stop_grace_period: 30s`. The AWS Spot watcher (`spotInterruption.ts`) is deleted.

**Eviction and sweeps (memory only, every 60 s):** ended sessions 60 s after the end (or after the rematch closes); waiting sessions with no player socket for 10 min (the DB row stays; legacy expiry still applies); spectator-only sessions of ended games immediately. Ended-session joins then get the `ended` state from the DB (socket F-09).

### 7.7 Background work

| Job | Where | Trigger | DB cost |
|---|---|---|---|
| Per-game timer (study end, first-move deadline, flag, grace, rematch expiry, restore resume) | socket, one `setTimeout(at − now + 20 ms)` per game, re-armed on every state change | state changes | none |
| Checkpoint flush | socket outbox | 10 plies / 15 s / finish / drain | 1 UPDATE |
| Session eviction | socket | every 60 s | none |
| Boot restore + stale sweep | socket | boot | 2 SELECTs + rare writes |
| Opportunistic stale sweep | socket | right after a successful finish, ≤ 1 per 10 min | 1 SELECT (Neon is already awake) |
| Journal cleanup | socket | hourly (filesystem only) | none |
| Metrics push | socket → Sentry | every 60 s | none |
| PostHog flush | socket (`posthog-node`, `flushAt: 20`, `flushInterval: 10 s`, flushed on drain) | batched | none |
| Stale bot games + `idempotency_keys` prune | web `GET /api/cron/daily` (P1 CRON-1, Hobby daily cron) | daily | 2 statements |

No timer anywhere queries Neon: with no live games, the socket server makes zero database queries, so the compute can scale to zero (Neon: any query within 5 minutes keeps it active).

### 7.8 Third-party integrations

| Service | Use in P2 | Notes |
|---|---|---|
| Neon Postgres | web (pooled, `replay_app` from P1) and socket (pooled, `replay_realtime`) | socket → Neon us-east-1 ≈ 200–230 ms per statement from Mumbai, hence one-statement checkpoints and the one-statement finish |
| Sentry | web routes and client (P1 config), socket (`@sentry/node` 10.38: errors 100 %, traces 10 %, metrics) | `sendDefaultPii: false` on the socket (today `instrument.ts:10`) |
| PostHog | client events through P1's `track()` (consent-aware); socket server events with `posthog-node` (`POSTHOG_PROJECT_KEY`, `distinct_id` = user ref) | server events are not blocked by ad blockers |
| Clerk | unchanged (sessions for the RSC and HTTP routes) | the socket never calls Clerk |
| Stockfish 18 lite (WASM, GPL-3.0, already shipped in `public/workers`) | bot games and hints, in the browser | served from **R2** (`NEXT_PUBLIC_ENGINE_BASE_URL`) through the same-origin shim, with the same-origin copy as fallback (§0.2). Licence (LIC-2): today `public/workers/` has no licence file, so WP-H adds `COPYING` (GPL-3.0 text) and `SOURCE.txt` (the upstream tag URL of the exact `stockfish` npm 18.0.x build, the NNUE net hash, and a written offer of source) next to the hashed files in both places. The engine stays a separate file and is never bundled. P11's legal pages add a "Third-party licences" section that links them |

No new paid service.

### 7.9 Environment variables

| Variable | web | socket | New? | Notes |
|---|---|---|---|---|
| `SOCKET_TOKEN_SECRET` (`kid:base64,kid:base64`, first signs) | sign | verify | new | replaces `INTERNAL_API_SECRET` for user tokens (socket S6); the fallback to the old secret exists only on dev during the WP-D rollout (§7.1.7) |
| `INTERNAL_API_SECRET` (`kid:base64[,kid:base64]`, first signs) | ✓ (`web:` key; signs `/internal/*` calls, §7.5.1) | ✓ (`web:` and `ops:` keys it accepts; `ops` signs the CLI) | kept, new format | the one name for service keys (consistency R-09). `INTERNAL_HMAC_SECRET`, `RC_INTERNAL_KEYS` and `INTERNAL_API_TOKEN` are **not** created; a bare legacy value is read as kid `web` |
| `WEB_APP_URL` | — | ✓ | socket: new | origin for socket → web calls (none in P2; P12 tournament routes use it, consistency R-11). No `NEXT_PUBLIC_` on OCI |
| `DATABASE_URL` | `replay_app` pooled | `replay_realtime` pooled (`connection_limit=3&pool_timeout=10&connect_timeout=15&pgbouncer=true`) | socket: new | the socket box gets DB credentials for the first time (B4); stored only in `WS_DEV_ENV_FILE` |
| `APP_ENV` / `NEXT_PUBLIC_APP_ENV` | ✓ | ✓ | socket: new | token `env` check |
| `ALLOWED_ORIGINS` | — | ✓ | kept, now required | `https://replay-chess-dev-replaychess007-1069.vercel.app,http://localhost:3000` on dev (the dev URL from CLAUDE.md; the post-deploy handshake check in §12.6 catches a wrong value) |
| `PROTOCOL_V1` | — | ✓ | new | `on` until the parity gate |
| `JOURNAL_DIR` | — | ✓ (`/data/journal`) | new | |
| `CHECKPOINT_PLIES` (10), `CHECKPOINT_MAX_AGE_MS` (15000), `GRACE_MS` (30000), `FIRST_MOVE_MS` (30000), `REMATCH_MS` (30000), `RESUME_MAX_WAIT_MS` (60000) | — | ✓ | new | defaults from §8; env only for tests and tuning |
| `TIMING_PROFILE` (`real` \| `fast`) | — | ✓ | new | **test hook** (testing X5, X12): `fast` scales study, first move, reconnect grace, rematch TTL, the 120 s post-boot handshake grace and (from P9/P12) queue widen and timeout, tournament `ending_soon` and `no_show` down to 2–5 s. Read in `WS/src/config/timing.ts`; allowed only when `APP_ENV=test`: the process **exits at boot** if it is set with any other `APP_ENV`. Registered in `WEB/lib/test-hooks/registry.ts` |
| `DRAIN_NOTICE_SECONDS` | — | deploy workflow | new | 30 on dev, 120 on production (P13) |
| `POSTHOG_PROJECT_KEY`, `POSTHOG_HOST` | (`NEXT_PUBLIC_POSTHOG_KEY` exists) | ✓ | socket: new | optional; events skipped when unset. In CI and local e2e `POSTHOG_HOST` points at P1's telemetry sink (`WEB/e2e/mocks/posthog-sink.ts`, port 4011), so socket server events are asserted exactly-once (testing X6) |
| `SENTRY_DSN` | ✓ | ✓ | kept | |
| `NEXT_PUBLIC_WEBSOCKET_URL` | ✓ | — | kept (play-a C9: not `NEXT_PUBLIC_WS_URL`) | |
| `NEXT_PUBLIC_ENGINE_BASE_URL` | ✓ | — | new | the R2 engine folder (`https://media.playchess.tech/engine/sf18-<hash>/` on production; the dev bucket URL on dev); unset → same-origin `/workers/sf18-<hash>/` (local, CI and the fallback). §0.2, §9.3 |
| `BACKFILL_ALLOWED_HOSTS`, `DEV_DB_HOSTS` | scripts | — | new | dev-only safety |

Every web variable is added to `turbo.json` `globalEnv` (audit-quality B-03) and to the Vercel `replay-chess-dev` project; the socket variables to the `WS_DEV_ENV_FILE` GitHub secret. Test hooks are never gated on `VERCEL_ENV` (the dev project deploys with `VERCEL_ENV=production`): they use `APP_ENV` (required at boot, validated in `lib/env.ts` and `WS/src/config/env.ts`) plus `ALLOW_TEST_HOOKS=1` where P1 requires it (feasibility fix 3).

### 7.10 Feature flags and rollout

| Flag (PostHog, server-evaluated by `WEB/lib/flags.ts`) | Gates | Default | Removed |
|---|---|---|---|
| `live-protocol-v2` | the client connects with `proto: 2` (otherwise no `proto`, v1 handlers) | on for the owner and E2E users A–P on dev | at the parity gate |
| `game-v3` | `/game/[ref]` renders `GameScreen` for live human games (otherwise `features/game/legacy/GamePageContent.tsx`, which requires `live-protocol-v2` off) | same | at the parity gate |

Bot games always render v3 (the v1 AI path is deleted). Flags never gate security (architecture §3.5.2). **Parity gate** (WP-I, last 2 days of P2): every owner test in §1.2 passes with both flags on, the e2e suite is green, and one week-equivalent of dev use (≥ 30 games across the E2E users and the owner) shows `ws.socket_event{proto=1} = 0`; then the flags, `WS/src/v1/`, `PROTOCOL_V1`, `features/game/legacy/`, `lib/types/socket-events.ts` and the three internal chess routes are deleted in one PR. By default (Q5) the deletion PR is prepared at the gate and merged in P3 week 1, so the legacy path survives one release for rollback (§14.4).

### 7.11 Deploy workflow (`REPO/.github/workflows/deploy-oci.yml`)

```yaml
on:
  push:
    branches: [main, dev]
    paths: ["apps/web-socket/**", "packages/db/**", "packages/game-core/**", "packages/contracts/**",
            "deploy/oci/**", ".github/workflows/deploy-oci.yml"]
# … build job unchanged except the Dockerfile context …
      - name: Restart stack with drain
        with:
          script: |
            cd /opt/replay-chess && chmod 600 .env
            echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin
            docker compose pull websocket                                   # old container keeps serving
            N="${DRAIN_NOTICE_SECONDS:-30}"
            if docker compose ps --status running websocket | grep -q websocket; then
              # the CLI signs with the container's `ops` key (§7.5.1); no secret ever expands in the CI log
              docker compose exec -T websocket node dist/cli/internal.js broadcast --in "$N" || true
              sleep "$N"
            fi
            docker compose up -d --remove-orphans                           # SIGTERM → drain (stop_grace_period 30s)
            for i in $(seq 1 30); do docker compose exec -T websocket wget -qO- http://127.0.0.1:3002/ready && break; sleep 2; done
            docker logout ghcr.io && docker image prune -f && docker compose ps
```

`deploy/oci/docker-compose.yml` gains `stop_grace_period: 30s`, `volumes: ["ws_journal:/data/journal"]`, the healthcheck on `/ready`, and `ws_journal:` under `volumes:`. `deploy/oci/Caddyfile` gains the unsigned-request pre-check of §7.5.1. After every dev deploy, `post-deploy-dev.yml` (P1) opens a socket.io handshake from `Origin: https://replay-chess-dev-replaychess007-1069.vercel.app` and fails the run if it is refused (testing X2.3). Pushes to `main` keep deploying the **prod** socket with the old code until P13 (allocation §1.4): none of the P2 socket work merges to `main`.

---

## 8. Domain logic (`PKG/game-core`)

`PKG/game-core` is pure TypeScript with one dependency (`chess.js` 1.4): no timers, no I/O, deterministic for a given `now`. The socket server wraps it with timers and persistence; the browser uses the client reducer and the local runner; the web server uses `adjudicate`. Layout:

```
PKG/game-core/src/
  rules/   chess.ts (wrapper: replay, dests, premoveDests, san), end.ts, insufficient.ts, explainIllegal.ts,
           material.ts, describe.ts (selection hints), timeClass.ts
  clock/   clock.ts (spend, increment, lag credit), format.ts (display, colour thresholds)
  machine/ types.ts, reduce.ts (server authoritative reducer), timers.ts (next deadline)
  client/  reducer.ts (store reducer for events + optimistic moves), viewState.ts (55-state derivation)
  local/   runner.ts (bot games), drawPolicy.ts, journal.ts
  bot/     strength.ts (ladder), hints.ts
  pgn.ts · adjudicate.ts · snapshot.ts (DB record → GameState) · constants.ts · index.ts
```

### 8.1 Server state machine (`machine/reduce.ts`)

`reduce(state, input, now) → { state, events, effects }`. Inputs: `attach(side, socketId)`, `detach(side, socketId)`, `ready(side)`, `move(side, ply, uci, clientMoveId, premove, rttMs)`, `abort(side)`, `resign(side)`, `drawOffer|drawAccept|drawDecline(side)`, `rematchOffer|rematchAccept|rematchDecline|rematchCancel(side)`, `timer(kind)`, `freeze(at)`, `resume(at)`, `rematchCreated(newRef)`, `rematchFailed(code)`. Effects: `checkpoint`, `finish`, `abortPersist`, `createRematch`, `armTimer(at, kind)`, `track(event)`.

| # | From | Input | Guard | To / effect |
|---|---|---|---|---|
| T1 | `waiting` | both sides online | — | `studySeconds > 0` → `study {endsAt: now + studySeconds·1000}`; else `first_move {side: turn(startFen), deadlineAt: now + 30 s}`; emit `game:phase`; journal |
| T2 | `study` | `ready(side)` | — | `ready[side] = true`, emit `study:ready`; both ready → T3 |
| T3 | `study` | `timer(study_end)` or both ready | — | `first_move {side: turn(startFen), deadlineAt: now + 30 s}` |
| T4 | `first_move` | `move` by `firstMove.side` | legal, `ply === plyCount` | apply; clocks stay frozen (no spend, no increment); if it was the first of the two first moves → `first_move {side: other, deadlineAt: now + 30 s}`; else → `playing`, `clocks.run = turn`, `turnStartedAt = now`; emit `move:applied` + `game:phase` |
| T5 | `first_move` | `timer(first_move_deadline)` | — | `ended(aborted, winner null)`, `meta.abortedBy = "timeout"`; effect `abortPersist` |
| T6 | `first_move` | `abort(side)` | `side === firstMove.side` (default; owner Q2 may widen to "either player until both have moved") | `ended(aborted)`, `abortedBy = side` |
| T7 | `playing` | `move` by the side to move | §8.4 spend; legal; promotion piece present | apply; `mover −= spent; mover += inc`; flag check (remaining ≤ 0 before the move → T8 instead); record `clockMs`, `spentMs`; clear the opponent's open draw offer (implicit decline, `canOfferAtPly[offerer] = ply + 4`); end detection §8.5; emit `move:applied` (players now, spectators delayed §8.10); outbox +1 |
| T8 | `playing` | `timer(flag)` | remaining(run) ≤ 0 | winner side has insufficient mating material (§8.9) → `ended(timeout_vs_insufficient, null)`; else `ended(timeout, other)` |
| T9 | `playing` | `resign(side)` | — | `ended(resignation, other)` |
| T9b | `first_move` | `resign(side)` | side has not moved yet | treated as T6 abort; if the side already made its first move → `not_allowed` |
| T10 | `playing` | `detach` of the side's last socket | the opponent is online | `presence[side] = {online: false, graceEndsAt: now + grace}` where grace = 30 s, or 10 s if the side detached ≥ 3 times in the last 120 s; emit `presence:update`; arm `timer(grace)` |
| T10b | `playing` | `detach` of the last socket while the opponent is already offline | — | cancel both grace timers ("both offline: clocks decide", api-design rule 12) |
| T11 | `playing` | `attach` of an offline side | — | clear its grace; emit `presence:update`; if the opponent is offline too, start the opponent's grace fresh |
| T12 | `playing` | `timer(grace)` for side S | S still offline | `plyCount < 2` → `ended(aborted)`; else `ended(abandoned, other)` |
| T13 | `study`, `first_move` | `detach` | — | presence updated, **no grace**; timers keep running ("the study timer keeps running") |
| T14 | `playing` | `drawOffer(side)` | no own open offer; `plyCount ≥ canOfferAtPly[side]` | opponent offer open → `ended(agreement)`; else `drawOffer = {by: side, ply}`; emit `draw:offered`; `meta.drawOffers[side]++` |
| T15 | `playing` | `drawAccept(side)` / `drawDecline(side)` | open offer by the other side | accept → `ended(agreement)`; decline → clear, `canOfferAtPly[offerer] = plyCount + 4`, emit `draw:declined` |
| T16 | `ended` | `rematchOffer(side)` | mode `FRIEND`/`ONLINE`, not aborted, both attached, `offersUsed < 3`, not draining | opponent offer open → T17; else `rematch = {by, expiresAt: now + 30 s}`; emit; arm `timer(rematch)` |
| T17 | `ended` | `rematchAccept(side)` | open opponent offer; both `ent > now` | effect `createRematch`; on `rematchCreated` emit `rematch:started` |
| T18 | `ended` | `timer(rematch)` / last socket of either player detaches / decline / cancel | — | emit `rematch:expired {reason: timeout\|left}` / `declined` / `cancelled` |
| T19 | any live | `freeze(at)` (drain or restore) | — | `clocks.run` remembered, remaining computed at `at`, `frozen = {since: at}`; deadlines suspended |
| T20 | frozen | `resume(at)` | both attached, or `timer(resume)` 60 s after restore | deadlines shifted by the frozen duration; `clocks.at = at`; emit `clock:sync` |

Every transition increments `seq` and produces exactly one journal line. `ended` → the session stays 60 s (`POST_GAME`) for late joins and rematch, then it is evicted (socket F-09).

### 8.2 Study phase (owner Q1)

`studySecondsFor(startFen) = startFen === INITIAL_FEN ? 0 : 30`, decided by the web at creation and stored in `Game.studySeconds` (so a policy change never affects games already created). Moves are locked; arrows and highlights are local; "I'm ready" from both ends it early. A reconnect during study keeps the same `endsAt` (resync).

### 8.3 First-move window

30 s for the side to move in `startFen` (Black in "Byrne vs Fischer"), then 30 s for the other side; clocks start after both first moves (the approved default in `docs/implementation-plan.md` Phase 2). No first move → `aborted`, unrated, no review, `GamePlayer.result = ABORTED` (excluded from stats). Bot games: no deadline (nobody waits); Abort is available before 2 plies.

### 8.4 Clocks (`clock/clock.ts`)

- Server state per game `{w, b, run, turnStartedAt}` on a monotonic clock (`performance.now()`), wire values `{w, b, run, at}` with `at` in server epoch ms.
- On an accepted move by side S at time `t`:
  - `lagCredit = premove ? 0 : min(rttEwma[S] / 2, 250 ms)`, and `Σ lagCredit[S] ≤ 0.05 × initialMs` per game.
  - `spent = max(premove ? 100 : 0, t − turnStartedAt − lagCredit)` (a premove still costs at least 100 ms, never free).
  - if `clocks[S] − spent ≤ 0` → flag instead of the move (T8).
  - `clocks[S] = clocks[S] − spent + incMs`; `clockMs[ply] = clocks[S]`; `spentMs[ply] = spent`; `run = other`; `turnStartedAt = t`.
- One `setTimeout(remaining(run) + 20 ms)` per game for the running side (with the other deadlines merged into one timer by `machine/timers.ts`); it replaces the 100 ms interval and the 1 Hz broadcasts (socket F-14). Flag accuracy ≤ 25 ms late.
- `rttEwma[S]`: from `clock:ping` acks of that player's sockets, α = 0.2, starting value 150 ms.
- Time spent per move for reviews is derived later: `spent_i = clock_{i−2} − clock_i + increment`.
- **Display** (`clock/format.ts`, from the template's `fmt()`): `s ≤ 0` → `0:00`; `s < 10` → `0:0` + `(floor(s·10)/10).toFixed(1)` (e.g. `0:09.6`); otherwise `m:ss` (floor seconds). Running chip colours: default `#3d3229`, `≤ 60 s` amber `#8a5a12`, `≤ 20 s` red `#a3412e` (tokens `cb-accent`, `cb-amber-*`, `cb-defeat-*`); idle at zero: red text. Study shows `STUDY`; first-move phases show the frozen value with "clock not started".

### 8.5 End detection (`rules/end.ts`), in this order after every move

1. Checkmate (`isCheckmate`) → `checkmate`, winner = mover.
2. Stalemate (`isStalemate`) → `stalemate`, draw.
3. Insufficient material (`isInsufficientMaterial`: K–K, K+minor–K, K+B–K+B with same-coloured bishops) → `insufficient_material`, draw.
4. Threefold repetition (`isThreefoldRepetition`, position key = placement + side + castling + en passant) → `threefold`, draw. Needs the full history, so sessions are always rebuilt by **replaying** moves (socket §10: `new Chess(fen)` loses it).
5. Fifty-move rule (`isDrawByFiftyMoves`, halfmove clock ≥ 100) → `fifty_move`, draw.

All of them end the game automatically (the design shows "Draw by repetition · Threefold repetition · move 17"). Today threefold and fifty-move are mislabelled `draw_agreement` (`GameSession.ts:1031-1033`).

### 8.6 Presence and disconnects

- A player is online while at least one of their sockets is attached to `game:{ref}`. Disconnect detection: immediate on a clean close; ≤ 18 s on a dead link (ping 10 s + timeout 8 s).
- Grace 30 s (10 s for a flapping player: ≥ 3 detaches in 120 s); only while the opponent is online; never in `study`/`first_move`; never while frozen.
- The connected player's clock is never paused for a disconnect; the disconnected player's clock keeps running if it is their turn (they can flag before the grace ends: normal timeout).
- Abandon → the absent side loses (`abandoned`), or `aborted` if fewer than 2 plies were played (fixes the wrong forfeit winner, socket F-10).

### 8.7 Draw offers

Allowed only in `playing`; stored `{by, ply}`; cleared when the receiver moves (implicit decline, counts as a decline for the cooldown); a counter-offer while an offer is open is an accept; accept/decline only by the receiver (socket F-01); after a decline the offerer may offer again at `canOfferAtPly = plyCount + 4` ("You can offer again in 2 moves"). An offer made while the opponent is disconnected stays open and is shown on reconnect.

### 8.8 Rematch

Offer from `ended` (FRIEND/ONLINE, not aborted, not tournament), 30 s expiry, ≤ 3 offers per game, crossing offers accept, either player leaving expires it (`reason: left`). Accept creates the new game with colours swapped, the same time control, start position, mode and `rated` flag, `rematchOfId`, `studySeconds` by the same rule (§6.6.6); both memberships are re-checked from the newest tokens (`paywall` if the other player lapsed). Bot games: "Rematch · as Black" is a new `POST /api/games {reason: rematch, parentGameRef}`.

### 8.9 Timeout vs insufficient material (`rules/insufficient.ts`)

When side S flags, the game is a draw if the **other** side has only: a king; king + one knight; or king + one bishop (no pawns, rooks or queens), regardless of S's material (Chess.com's rule and api-design rule 8). Otherwise the other side wins on time. Finer Lichess cases (for example K+N vs K+P, where a helpmate exists) are flagged in the tests as known differences, not implemented.

### 8.10 Spectators (one-ply delay)

The spectator room receives `move:applied` for ply `n` when ply `n + 1` is played (or immediately at `game:ended`, which releases every withheld ply in order). Spectator snapshots cut the move list one ply short while `playing`. Clocks in a spectator `move:applied` are the values recorded at that ply with `run` = the side to move in the shown position and `at` = the receipt time, so the spectator clock replays the timeline shifted by one move (small jumps are corrected at each event). Spectators never receive offers or rematch events. Sound quiet by default.

### 8.11 Time class, pool and labels (`rules/timeClass.ts`)

`estimated = initialSeconds + 40 × incrementSeconds` (play-a B19, data-model B1).

| `timeClass` (stored) | Rule | Pool for labels and P9 ratings (`poolOf`) |
|---|---|---|
| `BULLET` | estimated < 180 | Bullet |
| `BLITZ` | 180 ≤ estimated < 480 | Blitz |
| `RAPID` | 480 ≤ estimated < 1500 | Rapid |
| `CLASSICAL` | estimated ≥ 1500 | Rapid (the design groups 30+0 under Rapid) |
| `UNTIMED` | bot games with `tc = null` | — |

The design's nine time controls map exactly: 1+0, 2+1 Bullet; 3+0, 3+2, 5+0, 5+3 Blitz; 10+0, 15+10, 30+0 Rapid. Label: `"{Pool} {m}+{inc}"` ("Blitz 5+3"); untimed: "Untimed".

### 8.12 PGN (`pgn.ts`)

Built once at the end, from `startFen`, `moves` and `moveClocksMs`:

```
[Event "Replay Chess · Friend game"]  [Site "https://playchess.tech/game/<ref>"]  [Date "2026.11.20"]
[White "knightowl_88"] [Black "martin_k"] [Result "1-0"] [TimeControl "300+3"] [Termination "Normal"|"Time forfeit"|"Abandoned"]
[SetUp "1"] [FEN "<startFen>"]            ← only when startFen ≠ initial
[ECO "C41"] [Opening "Philidor Defense"]  ← when known
[WhiteElo] [BlackElo]                     ← only when a rating is shown
10. Nxb5 {[%clk 0:04:58.3]} 10... Nbd7 {[%clk 0:04:51.0]} … 1-0
```

Move numbering starts from the FEN's fullmove number; a Black-to-move start begins with `10...`. Round-trip test: `chess.js loadPgn(pgn)` reproduces the move list and the final FEN.

### 8.13 Bot strength ladder (`bot/strength.ts`; uncalibrated in P2, calibrated in P9, handoff H-06)

| Shown | `UCI_LimitStrength` | `UCI_Elo` | `Skill Level` | Search | Weakening layer |
|---|---|---|---|---|---|
| 400 | false | — | 0 | `go nodes 400`, MultiPV 4 | 35 % of moves: uniform pick among PV 2–4 whose loss < 300 cp; 10 %: a random legal non-mating move; never misses a mate-in-1 against it |
| 600 | false | — | 1 | `nodes 800`, MultiPV 4 | 28 % / < 250 cp; 7 % random |
| 800 | false | — | 2 | `nodes 1500`, MultiPV 4 | 20 % / < 200 cp; 5 % random |
| 1000 | false | — | 3 | `nodes 3000`, MultiPV 3 | 15 % / < 150 cp; 3 % random |
| 1200 | false | — | 5 | `nodes 6000`, MultiPV 3 | 10 % / < 120 cp |
| 1400 | true | 1400 | — | `nodes 20000` | none |
| 1600 | true | 1600 | — | `nodes 40000` | none |
| 1800 | true | 1800 | — | `nodes 70000` | none |
| 2000 | true | 2000 | — | `nodes 120000` | none |
| 2200 | true | 2200 | — | `nodes 250000` | none |

- Nodes, not depth or time, so strength is the same on a phone and a desktop; a `stop` after 3 s caps slow devices (inv-play-b §3.4).
- Floor check at init: read the `UCI_Elo` option's `min` from the `uci` output (Stockfish 16+ clamps to 1320); if 1400 is below the floor, the 1400 row falls back to `Skill Level 7`, `nodes 12000`.
- The weakening layer uses a seeded PRNG (`mulberry32(hash(ref) + ply)`) so a reload replays the same choice.
- **Default Elo** when the body omits `botElo`: the viewer's displayed rating for the time class (Chess.com profile, as `create-ai-game` does today, `:150-161`) rounded to the nearest 100 and clamped to 400–2200; otherwise 1200. The legacy difficulty selector maps easy 800, medium 1400, hard 1800, expert 2200 (`useBotMove.ts:20-23`).
- The header keeps the design's "vs Engine 1400"; the bot chip's tooltip says "≈1400 · strength not yet calibrated" until P9 calibrates the ladder (`scripts/calibrate-bots.ts`, handoff H-06). If P9 does not pick it up, the tooltip stays; the ladder itself is usable as shipped.

### 8.14 Hints and undo (`bot/hints.ts`, `local/runner.ts`)

- **Hint level 1:** full-strength search (`setoption UCI_LimitStrength false`, `Skill Level 20`, `go movetime 300`), take the best move's from-square piece → "Hint 1 of 2: look at your {king|queen|rook|bishop|knight|pawn on e4}." (pawns name the square).
- **Hint level 2:** arrow from → to in `#0369a1` + "Hint 2 of 2: {words}." where `O-O` → "castle short, O-O", `O-O-O` → "castle long, O-O-O", otherwise "play {SAN}". Two levels per position; a new position resets the level. `meta.assists.hints` counts both levels.
- **Undo:** on your turn, take back your last move and the bot's reply; while the bot is thinking, cancel the search and take back your move only; restore both clocks to the values journalled before your move; not after the game ended; `meta.assists.undos++`; toast "Took back 11.Bxb5+ and 11…Nbd7."

### 8.15 Bot draw policy and think time (`local/drawPolicy.ts`)

- Accept a draw offer iff `plies ≥ 60` and `|evalCp| < 30` from a quick `go nodes 20000` search; otherwise decline after a random 1.5–2.5 s ("The engine declined the draw."). Offers need ≥ 2 plies.
- Think time: `delay = clamp(450 + rand·400 + 150·(legalMoves > 30), 300, min(2000, 0.02 × remaining))` ms after the search returns (prototype `botMove` 450–850 ms; Chess.com uses 0.6–2 s, research `game-internals.md:214`). Untimed games use 450–850 ms.

### 8.16 Adjudication of `complete` (`adjudicate.ts`)

`adjudicate({ startFen, moves, clocksMs, initialMs, incMs, claim: { result, method } }) → { ok: true, outcome, method, pgn } | { ok: false, code }`:

1. Replay every move from `startFen`; an illegal move → `illegal_moves`.
2. No position **before** the last one may be terminal (mate, stalemate, insufficient, threefold, fifty): the runner auto-ends there, so a longer list is a tampered list → `claim_mismatch`.
3. Board-verifiable methods (`checkmate`, `stalemate`, `insufficient_material`, `threefold`, `fifty_move`) must hold on the final position, and the winner must be the mover for checkmate and none for the draws.
4. Claimed methods: `resignation` (any ply, winner = the bot side when the human resigned, or the human side if the client says the bot resigned: rejected; bots never resign in P2), `timeout` (the flagging side's last recorded clock must be ≤ its prior clock + increment and the final remaining must be < 1 s), `agreement` (≥ 2 plies), `aborted` (< 2 plies).
5. Clocks: `clocksMs.length ∈ {0, moves.length}`, every value in `[0, initialMs + incMs × plies]`, and per side non-increasing except for the increment (+50 ms tolerance).

### 8.17 Illegal-move reasons (`rules/explainIllegal.ts`, client only)

Checked in order; the first match wins; the toast is "That move isn't legal: {reason}."

| Check | Reason text |
|---|---|
| not the mover's turn | "it's {opponent}'s move." |
| moving the opponent's piece | "that's {opponent}'s piece." |
| target holds an own piece | "your {piece} is already on {sq}." |
| piece pattern | knight "a knight moves in an L shape."; bishop "a bishop moves diagonally."; rook "a rook moves along ranks and files."; king "the king moves one square at a time."; pawn "a pawn moves straight ahead and captures diagonally." |
| path blocked (sliders, pawn double step) | "the {piece} on {sq} blocks the {d-file \| 4th rank \| diagonal}." |
| own king in check and the move does not answer it | "your king is in check." |
| pinned piece | "the {piece} on {sq} is pinned to your king." |
| move exposes the king otherwise | "that would leave your king in check." |
| castling | "you can't castle out of check." / "you can't castle through check." / "your king has already moved." / "that rook has already moved." / "there are pieces between your king and rook." |
| en passant | "en passant is only possible right after the pawn moves two squares." |
| fallback | "the piece went back." (the prototype's copy) |

### 8.18 Premove (`live/premove.ts` + `rules/chess.ts premoveDests`)

One premove (a setting for up to 3 arrives with P10's board settings, socket §17.9.2). Targets are pseudo-legal moves for the player's pieces after a null move by the opponent (checks ignored, captures of any square allowed). Live human games only (off vs the bot, §14 Q10). Executed with `premove: true` when legal after the opponent's move, else cancelled (`premove_cancelled`).

### 8.19 Small rules

- **Material** ("+4 material"): sum of P1 N3 B3 R5 Q9 per side from the FEN, shown on the side ahead.
- **Selection hint** (`describe.ts`): king with castling available → "King selected · castling long is legal" (or "short" / "both ways"); otherwise none.
- **`startPly`** = `2·(fullmove − 1) + (side === "b" ? 1 : 0)` from `startingFen`.
- **Header left**: legend position → "{eco} · {opening} · {white} vs {black} {year}" or the position title; opening → "{eco} · {name}"; initial → "" (headerR only); endgame fixtures → "Endgame · move {n}".

### 8.20 Constants (`PKG/game-core/src/constants.ts`, mirrored in `PKG/contracts/src/socket/limits.ts`)

| Name | Value | Source |
|---|---|---|
| `STUDY_SECONDS_NON_INITIAL` | 30 | design, owner Q1 |
| `FIRST_MOVE_MS` | 30 000 | design (`abort` state) |
| `GRACE_MS` / `GRACE_FLAPPING_MS` | 30 000 / 10 000 (≥ 3 detaches in 120 s) | design, play-a §7.21 |
| `DRAW_COOLDOWN_PLIES` | 4 | design ("again in 2 moves") |
| `REMATCH_MS` / `REMATCH_MAX_OFFERS` | 30 000 / 3 | design, api-design |
| `POST_GAME_RETENTION_MS` | 60 000 | api-design rule 13 |
| `WAITING_RETENTION_MS` | 600 000 | socket §17.8 |
| `RESUME_MAX_WAIT_MS` | 60 000 | socket §17.9.10 |
| `LAG_CREDIT_MAX_MS` / `LAG_CREDIT_GAME_CAP` | 250 / 5 % of initial | api-design rule 7 |
| `PREMOVE_MIN_SPEND_MS` | 100 | api-design rule 7 |
| `FLAG_TIMER_SLACK_MS` | 20 | socket §17.9.1 |
| `CHECKPOINT_PLIES` / `CHECKPOINT_MAX_AGE_MS` | 10 / 15 000 | B4 |
| `RESTORE_WINDOW_MS` | 2 h | allocation P2 |
| `STALE_LIVE_MS` / `STALE_BOT_DAYS` | 30 min (< 2 plies), 2 h (≥ 2 plies) / 7 days | this plan, §14 Q7 |
| `PING_INTERVAL_MS` / `PING_TIMEOUT_MS` | 10 000 / 8 000 | api-design §6.1 |
| `CLIENT_PING_EVERY_MS` | 10 000 | client-data-layer §5.7 |
| `ACK_TIMEOUT_MS` | 5 000 | api-design §6.2 |
| `RELOAD_BUTTON_AFTER_MS` | 25 000 | socket §17.9.6 |
| `LOW_TIME_MS` / `AMBER_MS` / `RED_MS` | 10 000 / 60 000 / 20 000 | template `fmt`/chip |
| `SLIDE_MS` / `CAPTURE_FADE_MS` / `DRAG_THRESHOLD_PX` / `DRAG_SCALE` | 180 / 120 / 4 / 1.06 | `V3MoveBoard`, `V3GamePrototype` |

---

## 9. Performance and optimisation

### 9.1 Hot paths and their budgets

| Path | Budget | How it is met | Measured by |
|---|---|---|---|
| Move: drop → piece on target (optimistic) | ≤ 16 ms desktop, ≤ 33 ms mid-tier phone (4× CPU) | local chess.js validation (~0.05 ms), reducer applies before emitting; only moved pieces re-render | `performance.mark('move:drop')`→`'move:painted'` in a Playwright perf spec |
| Drag | 60 fps desktop, ≥ 50 fps phone | `transform` from a ref inside rAF; no React state per `pointermove` | Chrome trace in the perf spec |
| Server move processing (receive → room emit) | p50 ≤ 1 ms, p99 ≤ 5 ms | reducer only; no I/O in the move path (persistence is async in the outbox) | `ws.move_latency_ms` |
| Emit → ack (RTT) | network RTT + ≤ 10 ms | same | **server-side first** (api-perf AP-15: PostHog is consent-gated from P11 and the sample would be small and biased): `ws.move_latency_ms` (receive → room emit) plus the client RTT reported in each `clock:ping` (`ws.client_rtt_ms`, socket metrics, no user id). PostHog `game.move.ack_ms` stays a funnel-side diagnostic only |
| Clock display drift | ≤ 100 ms vs the server | `{w,b,run,at}` + ping offset; rAF interpolation | e2e assertion on two contexts |
| Event-loop lag on the 1-OCPU box | p99 ≤ 20 ms (no worker on the box) | one timer per game, no intervals, no per-second emits, `perMessageDeflate: false` | `ws.loop_lag_ms` (`monitorEventLoopDelay`) |
| Game page load | LCP ≤ 2.5 s mobile / 1.8 s desktop; INP ≤ 100 ms; CLS ≤ 0.02 (the zoom part is a **lab gate**: field data cannot segment by zoom) | RSC snapshot in the first HTML, CSS-only board size, no client fetch on mount, fonts with `adjustFontFallback` (P1) | Speed Insights (field, `sampleRate` per P1/optimization on Hobby), Lighthouse CI on `/dev/ui/game?state=your_move` (lab), the device × zoom matrix for CLS at 80–150 % (lab) |
| Connect → `game:join` ack | ≤ 2 RTT + 30 ms | websocket transport first, `upgrade: false`, token seeded by the layout (no `/api/socket-token` round trip) | `game.join.ms` span |
| Finish → `game:result` | ≤ 500 ms from Mumbai | one-statement CTE | `ws.persist.ms{op:"finish"}` |
| `POST /api/games` | W2 p95 ≤ 250 ms | ≤ 3 round trips + one batch transaction in `iad1` | the P1 wrapper's per-route timing (Sentry span + `Server-Timing` on the API response; API routes can set headers, unlike RSC pages) |
| Reconnect detection | ≤ 18 s dead link, immediate on close | ping 10/8 s | integration test |
| Plies lost on deploy, crash or Neon outage | 0 | journal + drain + replay restore | resilience test (§12.9) |

### 9.2 Database

- **Writes per 80-ply human game: ≈ 11 statements** (§6.6.9), against ≈ 250 today. No Vercel invocation per move (B4), which also removes the Mumbai → `iad1` → Neon hop per move and the O(n²) JSON rewrites (DB-03).
- **Reads:** the RSC page makes 1 query after the viewer; the socket loads a game once per session (a reconnect to an in-memory session makes **no** query, socket F-19); spectators never cause a query once the session exists.
- **Query plans** to check with `EXPLAIN (ANALYZE, BUFFERS)` on the dev branch with the backfilled data (WP-A acceptance): `getGameSnapshot` (index scan on `games_referenceId_key` + 2 PK lookups on `users` + 2 on `chess_com_profiles`), the restore list (index scan on the partial `games_open_idx`, a few dozen rows), the checkpoint and finish (PK), `game_players` live lookup (index prefix `(userId, endedAt)`). Each must stay < 5 ms server time.
- **Neon compute hours:** no timer queries; with zero live games the socket makes zero queries; the stale sweep runs only at boot and right after a finish. A live game keeps the compute awake while it runs (≤ 4 checkpoints per minute), which is inherent. CU-hours for 100 games/day of 10 min each at 0.25 CU ≈ 0.25 × (100 × 10 / 60) ≈ 4.2 CU-h/day worst case if the games never overlap; overlapping games share the same awake time.
- **Connections:** socket `connection_limit=3` via the pooler; web unchanged (P1). Scale-to-zero closes them; §6.7 lists the transient-error rules and the prewarm.
- **Index existence gate:** every index named in §6.4 is listed in `REPO/docs/indexes.json` (P2 creates the file; later phases append), and `scripts/explain-hot-queries.ts` (optimization §3.5.4) fails CI when a listed name is missing from `pg_indexes` after `migrate deploy` on a throwaway database, or when a listed query plans a Seq Scan or a Sort over `game_players` (api-perf §5).
- **Storage:** ≈ 1.2 KB per finished game row growth (moves 0.4 KB + clocks 0.35 KB + PGN ≈ 1.5 KB lz4-compressed when over the TOAST threshold) + one `game_players` row ≈ 120 B per member side (data-model §10.1). The PGN figure is an estimate on random-looking text; WP-A measures it on 200 real CC0 games after the backfill and sends the number to data-model §10.1 (feasibility F-NEON-4, V9). PGN is written only for games played here, never for imports.

### 9.3 Caching layers in P2

| Layer | What | Policy |
|---|---|---|
| Browser HTTP cache | engine `sf18-<hash>/*.{js,wasm}` (7.3 MB, **served from R2**, so it never counts against Vercel Fast Data Transfer), pieces `/chess-icons/*.png` (340 KB for 12), sounds (84 KB), board icons | `public, max-age=31536000, immutable` for the hashed engine (set as object metadata at upload, with `Content-Type: application/wasm` for the `.wasm` and CORS for the app origins); pieces/sounds/icons keep the 30-day policy (`next.config.js:129-157`). Per-user API responses never get `max-age > 0` (PGN is `no-store`, finished snapshots `private-etag`), so a shared browser never serves one user's game to the next (api-perf AP-04) |
| Service worker (P1 H8 rules) | engine runtime route `CacheFirst` cache `rc-engine-v18`, max 2 entries (old hashes evicted); `/api/*` NetworkOnly | no precache of the engine (precaching made every install download ~90 MB, play-b §3.5) |
| `private-etag` | `GET /api/games/[ref]` for finished games | 304 on match |
| React `cache()` | `getViewer`, `getGameSnapshot` per request | layout + page share one read |
| TanStack | `qk.games.detail(ref)` (∞ once finished), `qk.games.live()` 15 s | §5.4 |
| Socket memory | sessions (no DB on reconnect), live list (from memory, never the DB) | eviction §7.6 |
| Never cached | live snapshots, socket tokens, checkpoints, complete | `no-store` |

### 9.4 Payloads

| Payload | Budget | Note |
|---|---|---|
| `GameState` (join/sync ack, RSC prop) | ≤ 2 KB at 80 plies | UCI string + clock array; SAN derived on the client (~1 ms) |
| `move:applied` | ≤ 200 B | no `fen`, no `clientMoveId`, false booleans omitted (AP-16) |
| `MoveAck` | ≤ 160 B | carries `clientMoveId` |
| other game events | ≤ 120 B | |
| Checkpoint body (socket → DB) | ≈ 0.8 KB at 80 plies | full list each time (idempotent overwrite) |
| Bot checkpoint beacon | ≤ 8 KB (cap) | ≈ 1 KB typical |
| Game page HTML + RSC flight | ≤ 40 KB compressed | the snapshot is ~2 KB |
| Socket messages per game-minute (2 players) | −90 % vs today | no `clock_update`/`analysis_tick` (today ≈ 120 per minute) |

### 9.5 JavaScript budget (`next build` route table, gzip)

| Bucket | Budget | Today | How |
|---|---|---|---|
| `/game/[ref]` route total (engine excluded, `socket.io-client` included) | ≤ 600 kB (owner-approved 2026-11-06; was 300 kB) | 490 kB (audit-client §10.1) | the legacy screen is a `next/dynamic` import only when the flag is off; `GameEndEffects` not imported; `socket.io-client` (≈ 15 kB) and `chess.js` (≈ 12 kB) once; zod validation of socket frames only in development and test builds: the validator lives in `WEB/lib/realtime/validate.dev.ts` and is loaded with a dynamic `import()` inside `if (process.env.NODE_ENV !== "production")`, because a schema passed as an argument is a reference and is **not** tree-shaken (api-perf AP-12); HTTP responses use P1's `devSchema()` wrapper for the same reason; CI asserts that `ZodError` does not appear in the `/game/[ref]` chunks; `ResultSheet`, `MovesSheet`, `LiveGamesSheet`, `ShareMenu`, `PromotionPicker` via `next/dynamic` |
| Game-specific chunk | ≤ 50 kB | — | |
| Engine | 0 kB for PvP and spectators | 7.3 MB on every game page (client #6) | `EngineProvider` is created only when `mode = BOT` |

Enforced by P1's `scripts/check-bundle-budgets.mjs` in CI.

### 9.6 Socket server capacity (1 OCPU / 6 GB, dev box)

Target: 2,000 sockets / 1,000 concurrent games at one move per 5 s per game with loop lag p99 < 20 ms and RSS < 1 GB (optimization §9.6). The per-move cost is the reducer (~36 µs chess.js move measured, socket §11) plus two room emits; persistence is ≤ 1 statement per 10 plies. Memory ≈ 30–60 KB per socket + session. Measured with k6 (§12.8); results recorded in `perf/README.md`.

---

## 10. Telemetry

### 10.1 PostHog events

Common properties on every event (P1 `track()` helper; client events no-op when consent is declined): `app_env`, `device` (`desktop`, `ipad_l`, `ipad_p`, `phone`), `member_state` (`trial`, `active`, `past_due`), `mode` (`bot`, `friend`, `online`, `tournament`), `time_class`. Properties never include FEN, PGN or move text.

| Event | Sent from | Properties | Notes |
|---|---|---|---|
| `game_viewed` | client | `role` (player, spectator), `entry` (create, link, rematch, resume, reload), `phase` | once per page view |
| `game_board_ready` | client (sampled 20 %) | `ms_to_board` (navigation → board painted), `ms_to_join_ack` | perf funnel |
| `game_started` | socket (posthog-node) | `rated`, `tc`, `study_s`, `start` (initial, position, opening) | at `playing`, one per player |
| `game_ended` | socket | `method`, `result` (win, loss, draw), `plies`, `duration_ms`, `draw_offers`, `premoves` | one per player |
| `game_aborted` | socket | `reason` (timeout, player, stale), `by` (self, opponent) | |
| `bot_game_started` | web (`POST /api/games`, `after()`) | `elo`, `color`, `start_kind`, `reason` | |
| `bot_game_completed` | web (`complete`) | `result`, `method`, `plies`, `hints`, `undos` | |
| `hint_used` | client | `level` (1, 2) | |
| `undo_used` | client | — | |
| `engine_init` | client | `cached`, `ms`, `ok`, `elo_floor`, `source` (`r2` \| `origin`) | owner event (consistency R-18); P3 and P8 reuse it under this name, mapping "failed" to `ok: false` |
| `move_rejected` | client | `code` | should be near zero |
| `illegal_move` | client (sampled 10 %) | `reason` (enum of §8.17) | |
| `premove_set` (10 %), `premove_dropped` | client | `reason` (illegal, cancelled) | |
| `promotion_picked` | client | `piece` | |
| `draw_offered`, `draw_answered` | client | `accepted`, `implicit` | |
| `resign_opened`, `resign_confirmed`, `resign_cancelled` | client | `ply` | |
| `rematch_offered`, `rematch_answered`, `rematch_expired` | client / socket | `accepted`, `reason` | |
| `reconnect` | client | `duration_ms`, `success`, `cause` (offline, ping, server_restart) | |
| `server_restart_notice_shown` | client | `in_game` | |
| `in_game_auth_refresh` | client | `result` (ok, failed) | |
| `game_server_error` | client | `code` | |
| `game_over_viewed` | client | `method`, `result` | |
| `game_over_cta` | client | `cta` (rematch, new_game, analyse, watch_another, back_to_tournament, restart) | |
| `share_game` | client | `method` (`link`, `pgn`; P3 adds `image` with shares) | |
| `spectate_started`, `spectate_left` | client | `source` (link, live_list), `duration_ms` | |
| `shortcut_used` | client (sampled 10 %) | `key` | |
| `flip_board`, `sound_toggled` | client | `on` | |

Funnels set up in PostHog by WP-I: create → `game_started` → `game_ended` → `game_over_cta`; `game_viewed(entry=link)` → join → `game_started`; bot `bot_game_started` → `bot_game_completed`.

### 10.2 Sentry

- **Web:** route spans from the P1 wrapper (class tags R1/W1/W2); custom spans `games.create`, `games.complete.adjudicate`, `games.snapshot`; client spans `game.join` (connect → ack), `engine.init` (`{cached, bytes, ms, ua}`); `captureException` for adjudication failures (game ref only, no PGN), engine failures and `server_error` entries.
- **Socket** (`WS/src/obs/metrics.ts`, pushed every 60 s): `ws.loop_lag_ms` (p50/p99), `ws.move_latency_ms`, `ws.games{phase}`, `ws.sockets` (`io.engine.clientsCount`), `ws.outbox.depth`, `ws.outbox.oldest_ms`, `ws.persist.ms{op}`, `ws.persist.fail{op,code}`, `ws.persist.conflict`, `ws.game.end{method,mode}`, `ws.abort{reason}`, `ws.abandon`, `ws.reconnect{phase}`, `ws.disconnect{reason}`, `ws.restore{result}`, `ws.rate_limited{cmd}`, `ws.invalid_payload{event}`, `ws.lag_credit_ms`, `ws.socket_event{proto}`, RSS. Traces 10 % for commands, 100 % for errors; the per-game `continueTrace` goes (socket F-40). Logs are JSON with `game`, `ply`, `user`, `phase`; clock internals at debug only.
- **Alerts** (owner email, architecture §3.4.4): persist failures > 0 for 5 min; outbox oldest > 60 s; loop lag p99 > 100 ms for 5 min; any restore failure; container restart loop; uptime monitor (UptimeRobot or Sentry Uptime) on both `/health` URLs.

---

## 11. Security, privacy, paywall and authorisation

### 11.1 Access matrix

| Actor | `/game/[ref]` page | `POST /api/games` | `GET /api/games/[ref]` | checkpoint / complete | PGN | socket `game:join` | `spectate:join` | `rematch:accept` |
|---|---|---|---|---|---|---|---|---|
| Anonymous | sign-in redirect | 401 | 401 | 401 | 401 | no socket (no token) | — | — |
| Signed in, not a member | `/pricing?reason=…` | 402 | 402 | 401/403 (not a player) | 402 | `forbidden` (not a player) | `not_member` | — |
| Member, not a participant | spectator view if watchable, else 404 | ✓ | spectator projection if watchable, else 404 | 403 | 403 | `forbidden` | ✓ if watchable | — |
| Member player | ✓ | ✓ | ✓ | ✓ (own `BOT` game) | ✓ | ✓ | answered as `game:join` | ✓ if the other player is a member |
| Lapsed member who is a player of an `IN_PROGRESS` game | ✓ (finish the game) | 402 | ✓ | ✓ | 402 | ✓ | — | `not_member` |
| Admin | as member | as member | as member (no special read in P2) | as member | as member | as member | as member | as member |
| Internal (HMAC, kid `web` / `ops`; `wk` from P3) | — | — | — | — | — | — | — | — (socket `/internal/*` only, each kid limited to its allow-list, §7.5.1) |

"Watchable" = live modes `FRIEND`, `ONLINE`, `TOURNAMENT` (default, owner Q3); bot games are private to their player. A ref is a cuid, so a friend game is effectively watchable only by people given the URL.

### 11.2 Rules

1. **Identity on the socket comes only from the verified token** (`socket.data.userRef`); no payload carries a user id (closes the impersonation chain of socket §12: public ids + token-less sockets). `SOCKET_AUTH_REQUIRED` is removed.
2. **Roles are decided by the server** from `whitePlayerId`/`blackPlayerId`; nobody claims a role.
3. **Only the receiver of a pending offer can accept a draw** (socket F-01); rematch accept re-checks both memberships.
4. **Move authority:** phase, turn, `ply === plyCount`, explicit promotion piece (no default queen, `GameSession.ts:392`), chess.js legality; duplicate resends with the same `clientMoveId` are no-ops.
5. **Bot games are adjudicated server-side** (§8.16; audit-quality SEC-07). A forged mate gets 422.
6. **Validation everywhere:** zod on every socket payload and HTTP body; `maxHttpBufferSize` 16 KB; body caps 4/8/16 KB on the HTTP routes.
7. **Rate limits:** §7.4.8 on the socket; `create-game` bucket on `POST /api/games`; per-IP handshake limits.
8. **Origin check** on the socket upgrade (`allowRequest`, fails closed; socket S7).
9. **Internal endpoints:** HMAC (`x-rc-kid`, `x-rc-ts` within ±60 s, `x-rc-sig`, a 2-minute replay set, timing-safe compare) on every `/internal/*`, per-kid event and path allow-lists, and a Caddy pre-check that refuses unsigned requests before Node (§7.5.1); `/internal/broadcast`, `/internal/drain`, `/internal/metrics` are additionally blocked at Caddy (reachable only through `docker compose exec` and the signing CLI).
10. **Secrets:** `SOCKET_TOKEN_SECRET` (user tokens) separate from `INTERNAL_API_SECRET` (service key set) (socket S6, architecture X16), both with `kid` rotation; each service holds only the kids it signs with or accepts; the socket's DB role is least-privilege (§6.7: it may update only `users."gamesVersion"` on `users`) and cannot read emails or billing columns.
11. **Paywall (Phase 0):** members only for creating games, spectating and rematches; a player whose membership lapses mid-game may finish that game (api-design rule 2); 402 responses carry `reason` (`trial_available`, `trial_used`, `expired`, `payment_failed`) and the client sends the user to `/pricing?reason=…&redirect_url=…`.
12. **Spectators** are delayed one ply and never get offers, rematch internals or (from P3) analysis; they are counted but not named.
13. **Shared devices:** no per-user response from a P2 route carries `max-age > 0` (PGN `private, no-store`, finished snapshots `private-etag`, live snapshots `no-store`), and P1's sign-out calls `POST /api/session/clear` (`Clear-Site-Data: "cache"`) before `clerk.signOut()`, so the next person on the same browser cannot reach a cached game (api-perf AP-04; `shared-device.spec.ts`).
14. **Game images:** none in P2 (§7.1.6). The players-only game page sets `robots: noindex`, and no route renders a board image that names players.

### 11.3 Privacy

- No email, date of birth or internal id anywhere in a game payload, URL, socket error or log line (`/api/user/email/{email}` is gone from the game page path, play-a B24).
- `gameData` (trace headers, legend internals) is never sent; new games write `gameData = null` (data-model D1).
- Sentry `sendDefaultPii: false` on the socket server (today `instrument.ts:10` sends IPs); PostHog uses refs as `distinct_id` and no move data.
- No game image exists in P2 (§7.1.6); P3's share images honour "stop sharing" and "hide my username".
- Account deletion (P10) sets `whitePlayerId`/`blackPlayerId` to null through the new FKs and the partial indexes; `GamePlayer` rows cascade. The display snapshot (`whiteName`/`blackName`, `whiteTitle`/`blackTitle`) is a copy of the public display name, so P10's deletion must also overwrite those columns ("Deleted player") on the deleted user's games; P10 owns that statement (handoff H-10, §2.5).

---

## 12. Testing

Tooling follows allocation §1.1 and P1 SPEC D13: unit tests on `node:test` via `tsx` (no new runner), Playwright for behaviour, k6 for load. CI is P1's `.github/workflows/ci.yml` (jobs `unit`, `integration` on a `postgres:17-alpine` service, `e2e-smoke` with `BILLING_PAYWALL=on`) plus P1's `nightly.yml` and `post-deploy-dev.yml` (testing X2). P2 relies on P1's shared test tools and adds the ones listed below.

**Layout and conventions (testing X1, X4, X8, X11, X12):** unit tests sit beside the source as `*.test.ts` (P1's widened `test:unit` glob covers `features/**`, so `WEB/features/game/copy.test.ts` runs; `check-test-globs` proves it); DB-backed tests are `*.int.test.ts`; route, contract and authz tests live under `WEB/test/{api,integration,authz}/`. Every P2 spec carries `@p2`; 5 specs carry `@smoke` (`friend-full`, `bot-game`, `paywall-game`, `restart-resume`, `spectate`); every spec tags the design states it reaches with `@state:V3Game.<state>` (real data) or `@demo:V3Game.<state>` (the `/dev/ui/game` route). Specs use only the shared members A–P for **additive** data (they create games and never assert absolute counts) and lease personas from P1's pool for exact states; no spec deletes or resets a shared letter user.

**Test hooks P2 adds** (registered in `WEB/lib/test-hooks/registry.ts`, each proven absent or refused in the production-mode build by P1's `prod-guard.spec.ts`): `TIMING_PROFILE` (§7.9, socket refuses to boot with it outside `APP_ENV=test`), the per-worker fixture socket server `WEB/e2e/fixtures/socket-server.ts` (port 3102, started with `TIMING_PROFILE=fast`), the `e2eRun` token claim (§7.4.2), and `/dev/ui/game` (already under P1's `/dev/ui/**` guard).

### 12.1 Unit tests

| File | Cases |
|---|---|
| `PKG/game-core/test/machine.test.ts` | every transition T1–T20 with a fake `now`; study early-ready; study timeout; first-move order for a Black-to-move start; first-move timeout → aborted; abort by the side to move allowed, by the other side refused (`not_allowed`); resign during `first_move` = abort; flag → timeout; flag vs insufficient → draw; grace 30 s and the 10 s flapping grace; both offline cancels grace; disconnect during study has no grace; draw offer/accept/decline/implicit decline/cooldown at `ply + 4`/crossing offers accept; accept without an offer refused (F-01 regression); rematch offer/accept/decline/cancel/expiry/leave/max 3/crossing; freeze and resume shift the deadlines; `seq` increments by one per event; duplicate `clientMoveId` is a no-op; `stale_ply` returns the state |
| `PKG/game-core/test/clock.test.ts` | spend with and without lag credit; lag credit cap at 250 ms and at 5 % of the initial time; premove minimum 100 ms and no lag credit; increment after the move; flag when spend ≥ remaining; `format()` at 600 s, 61 s, 60 s, 10.0 s, 9.96 s → `0:09.9`, 0.04 s → `0:00.0`, 0 → `0:00`; colour thresholds at 60 s and 20 s |
| `PKG/game-core/test/end.test.ts` | order checkmate > stalemate > insufficient > threefold > fifty; threefold by transposition; threefold survives a replay restore (the socket §10 bug); fifty-move at halfmove 100 exactly; insufficient table (K–K, KB–K, KN–K, KB–KB same colour, KB–KB opposite colours = not insufficient) |
| `PKG/game-core/test/insufficient.test.ts` | timeout vs insufficient: the other side has K, K+N, K+B → draw; K+N+N, K+P, K+R → win; the known Lichess differences listed as `test.todo` |
| `PKG/game-core/test/explainIllegal.test.ts` | loads `PKG/chess-fixtures/rules/illegal-reasons.json` (one FEN + attempted move + expected text per reason row of §8.17, including the template's "the knight on d7 blocks the d-file" and "the bishop on e7 is pinned to your king"); the JSON lives in the fixtures package so P9 and P10's premove setting reuse it |
| `PKG/game-core/test/pgn.test.ts` | round trip through `chess.js loadPgn`; `%clk` formatting (`0:04:58.3`); `SetUp`/`FEN` only for non-initial starts; Black-to-move numbering (`10...`); termination headers per method |
| `PKG/game-core/test/timeClass.test.ts` | the nine design time controls and the band edges (179/180, 479/480, 1499/1500); labels |
| `PKG/game-core/test/client-reducer.test.ts` | optimistic move then confirm; reject → replace + toast flag; gap → sync request; duplicate event ignored; premove fires/cancels; outbox send/drop on rejoin; the mover matches its own `move:applied` on `ply` + `uci` (no `clientMoveId` in the broadcast); **optimistic draw offer, rematch offer, study ready, decline and cancel**, each rolled back by a negative ack (`phase`, `draw_cooldown`) with the right toast flag |
| `PKG/game-core/test/viewState.test.ts` | the **55 golden transcripts** (§12.3) produce the expected `primary` state, zone, actions and toast; modifier combinations (check + premove, low_time + viewing) |
| `PKG/game-core/test/local-runner.test.ts` | bot game start colours; clocks start after two plies; undo while thinking vs on your turn; hint levels reset per position; journal (de)serialisation and `rev` increments on undo; resume chooses the newer of journal and snapshot |
| `PKG/game-core/test/adjudicate.test.ts` | genuine mate/stalemate/threefold/fifty/insufficient accepted; a claimed mate that is not on the board → `claim_mismatch`; moves after a terminal position → `claim_mismatch`; an illegal move → `illegal_moves`; timeout with impossible clocks → `claim_mismatch`; aborted with ≥ 2 plies → `claim_mismatch` |
| `PKG/game-core/test/strength.test.ts` | ladder rows; default Elo from a rating (rounding, clamping); the floor fallback |
| `PKG/game-core/test/property.test.ts` | 1,000 seeded random games (mulberry32, seed in the test name): game-core's legal moves, SAN, end detection and PGN agree with chess.js at every ply |
| `PKG/contracts/src/socket/test/token.test.ts` | sign/verify; wrong `env`; expired; tampered signature; unknown `kid`; key rotation (two kids); an `e2eRun` claim is refused unless `env` is the test env |
| `PKG/contracts/src/socket/test/size.test.ts` | realistic fixtures (25-char ref, real FEN, 3-digit plies, 20-character names, the longest seeded legend prefix): `GameState` ≤ 2 KB at 80 plies and with the longest prefix; `move:applied` ≤ 200 B; `MoveAck` ≤ 160 B; other events ≤ 120 B |
| `PKG/contracts/src/internal/test/auth.test.ts` | a valid signature passes; unknown kid, `\|now − ts\| > 60 s`, a changed method, path or body, and a replayed signature each fail with 401; a bare legacy secret is read as kid `web`; the allow-list refuses `entitlement:changed` from kid `wk` and `/internal/broadcast` from kid `web` |
| `PKG/contracts/src/http/test/codes.test.ts` (P1 file, P2 rows) | `in_flight` 409, `idempotency_key_reused` 422, `illegal_position` 422, `illegal_moves` 422; each code has exactly one status; `CONFLICT_REASONS` contains `already_started`, `already_completed`, `not_bot_game`, `not_finished`, `rev_gap` |
| `PKG/db/src/live/errors.test.ts` | `P1017`, `P1001`, `57P01`, `08006`, `08003`, `ECONNRESET` are transient; a unique violation or `22P02` is not |
| `WS/test/timing-profile.test.ts` | the process refuses to start with `TIMING_PROFILE` set and `APP_ENV=production` (or `dev`); with `APP_ENV=test` each timer of §7.9 is scaled; unset → real values |
| `WS/test/handshake-limits.test.ts` | per-user limits (11th socket, 21st handshake in a minute refused); per-IP flood guard; the per-IP limit is off for 120 s after boot |
| `WEB/lib/realtime/resync.test.ts` | reconnect with the same `bootId` and no `useq` gap → no refetch; a new `bootId` or a gap → the user-level queries are marked stale once |
| `PKG/contracts/src/socket/test/schemas.test.ts` | every command and event schema accepts its fixture and rejects a mutated one |
| `WEB/components/board/geometry.test.ts` | square ↔ % in both orientations; `diffPieces` for normal moves, captures, castling (rook moves), en passant (captured pawn), promotion (piece swap) |
| `WEB/lib/games/create-bot-game.test.ts` | colour resolution (`auto` for opening/legend/position/initial), default Elo, `startPly`, `meta` header/prefix from fixtures |
| `WEB/features/game/copy.test.ts` | every state's strings exist; Title Case buttons, sentence-case toasts, no emoji (P1 copy rules) |

### 12.2 Chess-correctness fixtures (`PKG/chess-fixtures/`, architecture §5.9)

P2 creates the package (testing X13 makes P2 its builder; P3 adds `grades/positions.jsonl`) with `rules/illegal-reasons.json` (§12.1), `design/*.json` and `pgn/rules/*.pgn` (castling-rights edge cases, en passant including the discovered-check case, promotion and under-promotion, stalemate, threefold by transposition, fifty-move, insufficient material set, timeout vs insufficient, FEN starts with Black to move and move numbers above 1) and `perft/` (start position depth 4 = 197,281; Kiwipete depth 3 = 97,862) to guard chess.js upgrades. `game-core` tests load them; P3 adds the analysis corpora.

**Design-embedded positions** (testing X13): `REPO/scripts/qa/extract-design-fens.ts` reads the `DR/` boards (they are not in the repo, so the script runs on the owner's machine and its output is committed) and writes every FEN and SAN sequence the designs use as fixtures into `PKG/chess-fixtures/design/<board>.json`, starting with the `V3Game` move line `L.MAIN` (the Opera Game to `17.Rd8#`) and the state-specific positions of the 55 states. `PKG/chess-fixtures/test/design.test.ts` replays each with chess.js and fails on an illegal move or FEN, so a design typo never becomes a test expectation. `friend-full.spec.ts` and the golden transcripts read `L.MAIN` from this file instead of a hand copy.

### 12.3 Contract tests

- **Socket golden transcripts** (`PKG/chess-fixtures/socket/transcripts/<state>.json`, one per lit state of §4.3): the commands sent, the expected event sequence (time-normalised) and the expected design state per role. The server test replays the commands against an in-process socket server and compares the emitted events; the client test (`viewState.test.ts`) feeds the same events to the client reducer. Changing either side alone fails a test (architecture §5.3.2).
- **HTTP**: route tests call each new handler with mocked auth contexts and parse the responses with the `PKG/contracts/src/http/games.ts` schemas, including every documented error code.
- **Authorisation matrix**: P1's authz walker (`WEB/test/authz/`) gets rows for `POST /api/games`, `GET /api/games/[ref]`, checkpoint, complete, PGN and `GET /api/socket-token` for each actor of §11.1; a new route without a row fails CI.
- **Cache-tier lint** (api-perf §5): a test walks the route registry and fails if any P2 route with `auth ≠ public` declares a `public-*` tier or a `max-age > 0` (PGN is `no-store`, the finished snapshot `private-etag`).
- **Protocol compatibility** (`PKG/contracts/src/socket/test/compat.test.ts`, run against the in-process server): a connect without `proto` while `PROTOCOL_V1=off` gets `connect_error "upgrade_required"`; with `PROTOCOL_V1=on` it is accepted, until the parity gate.
- **Payload budgets**: §12.1 size tests.

### 12.4 Socket integration tests (`WS/test/*.int.test.ts`)

In-process server on a random port, `socket.io-client`, real Postgres (CI service or local Docker), tokens minted with a test key, `@repo/db` against the test database (migrations applied with `migrate deploy`).

| Test | Asserts |
|---|---|
| `join.int.test.ts` | player join from the DB; second join hits memory (no query, counted with Prisma's `$on('query')`); non-player `game:join` → `forbidden`; spectator join needs `ent`; wrong `env` token refused; token-less socket refused |
| `play.int.test.ts` | two clients play the Opera Game line to mate: study, ready, first moves, clocks start after both first moves, every `move:applied` has `seq + 1`, the final move is in `moves` and the PGN (F-07), `game_players` results, `user_stats` counted once |
| `finish-idempotent.int.test.ts` | the finish runs twice (simulated lost ack) → `finished = 0` the second time, stats counted once (DB-04) |
| `draw.int.test.ts` | offer/decline/cooldown/accept; accept with no offer refused |
| `presence.int.test.ts` | disconnect → `presence:update` with `graceEndsAt`; reconnect clears; grace expiry → `abandoned` with the right winner (F-10); < 2 plies → aborted |
| `reconnect-outbox.int.test.ts` | a client disconnects, the server keeps state, the client rejoins with `lastSeq` and gets a snapshot; a queued move is accepted when the ply matches and refused when it does not |
| `multitab.int.test.ts` | two sockets of one player; a move from either; presence stays online until both leave |
| `rematch.int.test.ts` | offer/accept creates a game with swapped colours and `rematchOfId`; `paywall` when the other token has `ent = 0`; expiry and leave |
| `spectate.int.test.ts` | spectators receive ply n when ply n+1 is played; no offers or rematch events; all withheld plies at the end |
| `restart.int.test.ts` | drain (SIGTERM path) freezes clocks and flushes; a new server instance restores from the journal + DB, replays (threefold history intact), resumes when both attach; a journal longer than the DB pushes the missing plies; corrupt journal → abort + metric |
| `rate-limit.int.test.ts` | 25 moves in one second → `rate_limited`; sustained flood disconnects |
| `emit.int.test.ts` | `/internal/emit` without or with a bad signature → 401; a replayed signature → 401; a `{room}` or `rooms[]` body → 400 (strict schema); an unregistered event → 422; an event outside the kid's allow-list → 403; `test:echo` reaches the target room; `dedupeKey` delivered once; every target room empty → 202 `{delivered: 0}` and the `data` parser is not called (spy) |
| `neon-suspend.int.test.ts` | mid-game, `pg_terminate_backend()` every connection of the socket role (what Neon does on suspend): the next checkpoint fails once, is retried at once, succeeds, and counts as `ws.persist.reconnect`, not `fail`; the process stays up; the finish persists every ply |
| `telemetry.int.test.ts` | with a fake `posthog-node`: one `game_started` and one `game_ended` per player, none for spectators, none on a duplicate finish (`finish-idempotent`) |
| `hello.int.test.ts` | `session:hello` carries `bootId` and `useq`; `useq` increments by one per user-room event; a restarted server has a new `bootId` |
| `no-idle-queries.int.test.ts` | with no live games, zero DB queries over a simulated 24 hours of timers (fake clock), so the socket never keeps Neon awake (api-perf §5 "timer audit") |

### 12.5 Web route integration tests (`WEB/lib/games/*.int.test.ts`, local Postgres)

`POST /api/games` (201; replay with the same `Idempotency-Key` returns the same ref and `Idempotent-Replayed`; a different body with the same key → 422; 402 for a non-member; 429 after 20 in 10 min); checkpoint (`rev` guard: an older rev is a 204 no-op; `rev` more than 64 ahead → 409 `rev_gap`; illegal moves → 422; non-player → 403; the 61st call in 60 s → 429; a prefix-extending body replays only the suffix, asserted with a chess.js spy; > 400 moves → 400); complete (valid mate; forged mate → 422 `illegal_moves {reason: claim_mismatch}`; second call returns the stored result); PGN (`Cache-Control: private, no-store` and `Content-Disposition: attachment`; 409 `not_finished` while live); legacy `join` race (two concurrent joins → exactly one 200, one 409 `already_started`); the finish bumps `users."gamesVersion"` once per player and a duplicate finish does not.

### 12.6 End-to-end (Playwright, `WEB/e2e/specs/game/`)

Two or three browser contexts with the E2E members (A–P members, R non-member) from P1's user registry, `BILLING_PAYWALL=on` (P1 turns it on in every e2e job, testing X3). A new fixture `WEB/e2e/fixtures/socket-server.ts` starts the socket server from source on port 3102 per worker with **`TIMING_PROFILE=fast`** (so a spec can restart it and server deadlines run in 2–5 s), and `WEB/e2e/fixtures/games.ts` creates fixture games through `@repo/db` (§6.8). **Server timers are never faked with `page.clock`**, which moves only the browser clock: timer specs assert the server-sent `deadlineAt`/`graceEndsAt` and the state change, not a literal "0:30" (testing X5). Each timer spec has a nightly `@slow` copy with real timings (`*.real.spec.ts`). Every spec runs with P1's console guard (no `pageerror`, `console.error`, hydration warning or unexpected 5xx) and telemetry fixture (every captured event parses against the registry; the PII guard forbids FENs, PGN move runs, emails and typed text). Runs on Chromium desktop by default; the specs marked † also run on the WebKit iPhone and Chromium Android projects.

| Spec | Steps | Asserts |
|---|---|---|
| `friend-full.spec.ts` † `@smoke` | A creates a friend game from `/play` on a legend position; B joins via the link; both "I'm ready"; first moves; play the `L.MAIN` line (from `chess-fixtures/design/V3Game.json`) to `17.Rd8#` | states `waiting` → `study` → `abort`/`their_move` → … → `over_checkmate_win`/`loss`; badges `mate` + `win`; PGN download contains `%clk` and 33 plies. **Telemetry:** B gets `game_viewed{role:"player", entry:"link"}`; both get `game_over_viewed{method:"checkmate"}`; `share_game{method:"pgn"}`; the sink holds exactly two server `game_started` and two `game_ended{method:"checkmate", plies:33}` and none for a spectator; `telemetry.forbid("Rd8#")` and the final FEN |
| `first-move-abort.spec.ts` (+ nightly `first-move-abort.real.spec.ts` `@slow`) | fixture `G-THREEFOLD` (initial position, study 0) on the fast-profile socket server; nobody moves until the server's `firstMove.deadlineAt` | `over_aborted` "No first move within 30 s · not rated" on both (the copy shows the real 30 s; the fast profile only shortens the wait); DB `status = ABORTED`; two `game_aborted{reason:"timeout"}` with `by` = `self` and `opponent` |
| `premove.spec.ts` † | during the opponent's turn A sets a premove; B moves | the premove is sent with `premove: true` and applied; a premove made illegal by B's move shows `premove_cancelled` |
| `promotion.spec.ts` | fixture `G-PROMO`; drag b7→b8; Esc; again; pick a knight | Esc restores the pawn with the status line; the move is `b7b8n` |
| `illegal.spec.ts` | try a pinned piece and a blocked rook | the reason text of §8.17 appears; no network call (request listener) |
| `low-time.spec.ts` | fixture `G-LOWTIME`; let White's clock run under 10 s | tenths format, `data-phase="low_time"`, then `over_timeout_loss` / `over_timeout_win` |
| `timeout-insufficient.spec.ts` | fixture `G-INSUFF`; White flags | `over_timeout_insufficient` |
| `draw-offer.spec.ts` † | offer → decline → button disabled for 2 own moves → offer → accept | `draw_received`, `draw_declined` copy, `over_agreement` |
| `resign.spec.ts` | `⋯` → Resign… → Keep playing → Resign… → Resign | focus on Keep playing; `over_resign_loss`/`win`; `flag` badge |
| `opponent-offline.spec.ts` (+ nightly `opponent-offline.real.spec.ts` `@slow`) | B's context `setOffline(true)` past the server's `graceEndsAt` (fast profile: ≈ 3 s) | A sees the toast, the ring counting down to `graceEndsAt`, then `over_abandoned` |
| `reconnect-queued-move.spec.ts` | A goes offline on their turn, makes a move (ghost), comes back after 5 s | `reconnecting` zone with the queued copy, then `reconnected` "Back online. … was sent." and the move on B's board |
| `restart-resume.spec.ts` `@smoke` | mid-game: broadcast restart (5 s), SIGTERM the fixture socket server, start it again | restart chip; both resume at the same ply, same colours; clocks frozen until both are back; no ply lost; the new `bootId` triggers exactly one user-level resync |
| `rematch-swap.spec.ts` | after a finished game A offers, B accepts | both navigate to the new ref; `rematch_study` toast; colours swapped in the DB |
| `rematch-expire.spec.ts` | A offers; B leaves the page; a second run lets the fast-profile TTL expire | `over_rematch_expired` "…left." and "…timed out." |
| `threefold.spec.ts` | fixture `G-THREEFOLD`; knights out and back twice | `over_threefold` automatically |
| `stalemate-fifty.spec.ts` | fixtures `G-STALEMATE` (59.Qf7) and `G-FIFTY` | `over_stalemate`; `over_fifty` |
| `spectate.spec.ts` `@smoke` | C opens the live game URL; R (non-member) opens it | C sees `spectate`, moves one ply late, only Flip and steppers; `over_spectator` with Watch another game listing the live games; R is redirected to `/pricing` |
| `multi-tab.spec.ts` | A opens the game in two tabs and moves in the second | both tabs show the move; presence stays online until both close |
| `already-ended.spec.ts` | open fixture `G-ENDED` | `already_ended` zone, Analyse game link |
| `bot-game.spec.ts` † `@smoke` | `/play` → vs Computer → Hint ×2 → Undo → play to the end or resign; reload mid-game | hint copy and arrow; undo toast; reload resumes at the same ply; exactly one `complete` call; `status = COMPLETED`; server events `bot_game_started{color, elo}` and `bot_game_completed{hints:2, undos:1}` once each, even after the reload; the engine loads from the R2 base URL (or the origin fallback) and `engine_init{ok:true}` fires once |
| `bot-resume-other-device.spec.ts` | fixture `G-BOT-MID` opened in a fresh context (no journal) | resumes from the server checkpoint |
| `bot-complete-tamper.spec.ts` | API-level `POST /api/games/<ref>/complete` with a fake mate | 422 `illegal_moves {reason: "claim_mismatch"}` |
| `paywall-game.spec.ts` `@smoke` | R: `/game/<ref>`, `POST /api/games`, `spectate:join` | `/pricing?reason=…`, 402, `not_member` |
| `upgrade-required.spec.ts` | a page script opens a socket.io client without `proto` (with `PROTOCOL_V1=off` on the fixture server); then the same during a bot game | the chip "Update ready · installs after this game"; during the bot game the reload waits for `game:ended` |
| `in-game-auth.spec.ts` | during a live A–B game, revoke A's Clerk session with the Backend API; keep playing | `V3SessionExpired` `in_game_refresh` then `in_game_ok` (the states P1 deferred to P2); the board keeps accepting moves; `telemetry.expect("in_game_auth_refresh", {result:"ok"})` |
| `optimistic-offers.spec.ts` | with a 300 ms network delay on A's socket (CDP), A offers a draw, then a rematch after the end | `draw_sent` and `over_rematch_sent` render before the ack arrives; a forced negative ack (draw cooldown) rolls back with the cooldown toast |
| `shared-device.spec.ts` | A downloads a PGN and opens a finished game, signs out; B signs in in the same browser context and requests the same URLs | every response comes from the network (no HTTP-cache hit), PGN 403 and snapshot 404 for B (api-perf §5 "shared-device cache") |
| `keyboard-board.spec.ts` | play three moves with the keyboard only (grid focus + Enter) and with the text move input | moves applied; focus outline visible; axe has no serious violations |
| Updated legacy specs | `play-with-bot.spec.ts`, `play-with-friend.spec.ts`, `quick-match.spec.ts`, `tournament.spec.ts` | pass on the v3 screen with the flags on (the fixture's `data-*` attributes are kept); `quick-match.spec.ts` mints tokens with `e2eRun = testInfo.testId`, so only users of the same test pair (testing X4.5) |

**State coverage report** (P1's `state-coverage.ts`): the `@state` tags of these specs must show real-data coverage for `over_checkmate_*`, `over_resign_*`, `over_timeout_*`, `over_timeout_insufficient`, `over_agreement`, `over_threefold`, `over_stalemate`, `over_fifty`, `over_abandoned` and `over_aborted`; every state that only `/dev/ui/game` reaches (for example `low_time` at exactly 9.9 s) is `@demo` with a written reason in `design-states.overrides.json`. The 55 `/dev/ui/game?state=` runs in `one-viewport.spec.ts` are tagged `@demo`.

### 12.7 Device × zoom (P1's `playwright.devices.config.ts`, 40 projects)

- `WEB/e2e/devices/game/one-viewport.spec.ts`: `/dev/ui/game?state=<s>` for **all lit states on 4 projects** (`desktop-1440@100`, `desktop-1280@125`, `iphone@100`, `ipad-portrait@100`) and **12 key states on all 40 projects** (`your_move`, `study`, `abort`, `premove`, `promotion`, `draw_received`, `resign_confirm`, `reconnecting`, `opp_disconnected`, `bot`, `spectate`, `over_checkmate_win`). Each runs `expectOneViewport` (board inside the viewport, `scrollHeight ≤ innerHeight + 1`, both bars, both clocks and the primary controls in view, squares ≥ 27.5 px, controls ≥ 44 px, no tab bar on phones during a game, no toast over the board).
- `WEB/e2e/devices/game/live-route.spec.ts`: a real fixture game at 100 % and 150 % on the 8 base devices, plus the **`stress=1`** fixture game (120 plies, 20-character names, a 3-digit move number, the longest opening header) at 150 % on every device (testing X9).
- `WEB/e2e/devices/game/tap-to-move.spec.ts`: touch projects (iPhone WebKit, Android Chromium, iPad): tap-tap moves, drag moves, promotion picker taps; hit targets ≥ 44 px.
- Visual baselines (P1's `toHaveScreenshot` tooling, testing X10): `your_move`, `check`, `over_checkmate_win`, `promotion`, `draw_received`, `reconnecting`, `spectate` and `over_threefold` on `desktop-1440` and iPhone, **light and dark**, reduced motion, `page.clock` fixed (the browser clock is fine here: these are static demo states), avatars masked with `[data-vr-mask]`.
- Tiering: PR CI runs the 4 projects above for changed game files; nightly runs all 40 projects. The full matrix runs against a CI-local `next build && next start` with the socket server in a container, never against the deployed dev URL; the deployed dev URL gets the `@smoke` subset only (feasibility F-VER-3: an overage pauses the Hobby project for up to 30 days).

### 12.8 Performance checks

| Check | Tool | Pass |
|---|---|---|
| `perf/k6/src/scenarios/ws-ramp.ts` on the dev OCI box (protocol v2 helper `perf/k6/src/lib/protocol-v2.ts`; perf tokens minted on dev only) | k6 from a GitHub runner | 250 → 2,000 sockets, one move per 5 s per game, 15 min: server `ws.move_latency_ms` p95 < 5 ms, `ws.loop_lag_ms` p99 < 20 ms, RSS < 1 GB, 0 persist failures, ≤ 1 checkpoint per 10 plies per game |
| `perf/k6/src/scenarios/ws-games.ts` (move RTT) | k6 | `ws_move_duration` p95 < RTT + 50 ms |
| Interaction latency | Playwright perf spec with 4× CPU throttle on `/dev/ui/game?state=your_move` | drop → painted ≤ 33 ms; drag ≥ 50 fps; ≤ 4 ms scripting per applied move |
| Bundle | `scripts/check-bundle-budgets.mjs` | `/game/[ref]` ≤ 600 kB gz (owner-approved 2026-11-06); no engine chunk on the PvP path |
| Lighthouse CI (mobile) | `/dev/ui/game?state=your_move` | LCP ≤ 2.5 s, CLS ≤ 0.02, TBT ≤ 200 ms |
| DB budget | integration test counting Prisma queries | RSC page: 1 query after the viewer; socket: 1 load per session, ≤ 8 checkpoints + 1 finish for the 80-ply fixture |

k6 runs **once per phase**, before the release, and only after the P1 Neon split (§2.3): ≈ 2.4k checkpoint statements, ~15 min of compute. The run records Vercel usage (function invocations, edge requests, Fast Data Transfer) and Neon CU-h before and after through the usage APIs, and writes the k6 JSON summary to `REPO/perf/results/p02-ws-ramp-<sha>.json`; hard thresholds use `abortOnFail` (testing X18, feasibility fix 10.8.7).

### 12.9 Resilience (nightly on dev or CI, architecture §5.10)

`kill -9` the socket mid-game → journal restore, no ply lost; block the database for 2 minutes (iptables in the CI container) → games continue, the outbox buffers, `/ready` turns 503 after 60 s, everything flushes on recovery; duplicate finish → counted once. **Neon suspend on dev** (feasibility F-OCI-4, weekly in `nightly.yml` and once in the P2 manual pass): start a fixture game on the dev socket, suspend the dev compute with the Neon API (`suspend endpoint`) after ply 6, play on to a finish, and assert in the DB that every ply, the clocks and the result are stored and that Sentry shows `ws.persist.reconnect` but no `ws.persist.fail`. This runs on the separate dev Neon project only.

### 12.10 Regression of earlier phases

- **The whole suite is the regression gate** (testing X11): the entire main and devices suites on the final P2 SHA with the paywall on, in CI nightly and once against the dev URL. The lists below are targeted extras.
- `flags-off` project: with `live-protocol-v2` and `game-v3` off, the legacy `play-with-friend` and `quick-match` specs pass over protocol v1 until the parity gate.
- P1 `data-layer.spec.ts` step (2): exactly one `/api/me` on a hard load of `/game/<ref>` (now the v3 page); P1's `routes.real.ts` set stays green.
- P0: billing unit tests (125), `paid-only.spec.ts`, `membership.spec.ts`, `pricing.spec.ts` unchanged and green.
- P1: shell specs, device × zoom suite for `/dev/ui/shell` and `/dev/ui/stage`, authz matrix, `/api/me` budget, security hotfix tests (draw accept by a non-player rejected, game-over internal-only) all green.
- Legacy pages that use the old board (`/analysis/[id]`, `/openings/[ref]`, admin positions, `/position/[ref]`, `/join/[ref]`) render as before; `/analysis/[ref]` works for a game played on v2 (adapter).

### 12.11 Manual checks on the dev site (ego-browser) and on real devices

Run with ego-browser against `https://replay-chess-dev-replaychess007-1069.vercel.app` (CLAUDE.md tab hygiene: one tab per user context), then on a real iPhone and a real Android phone:

1. The owner test script T1–T18 (§1.2), recording each step's screenshot.
2. Every lit state on `/dev/ui/game?state=…` at 1440 × 900, 1280 × 800, iPad L, iPad P and iPhone sizes, compared side by side with the `DR/` boards (design parity review, not a gate).
3. Zoom 80, 110, 125, 150 % on a live game: nothing scrolls, the board stays whole.
4. Tap-to-move, drag, premove, promotion, arrows by long-press during study on both phones; sound after the first tap; screen lock and unlock during a game (reconnect).
5. A dev socket deploy during a game (T11) while watching the Sentry metrics `ws.restore{result}`, `ws.persist.fail` and `ws.persist.reconnect`.
6. Leave the dev site idle for 10 minutes (Neon suspends), then start and finish a game: no error toast, the game is stored (the scale-to-zero path).
7. Vercel runtime errors and Sentry show no new 5xx during the session; P1's `scripts/qa/error-window.ts --since <deploy time>` output for at least 24 h after the last dev deploy shows 0 new issues or each is triaged (DoD rule 7).
8. PostHog live view shows the §10.1 events with `app_env=dev` and none from the local server.
9. Record everything in `REPO/docs/qa/phase-02-signoff.md` (SHA, Vercel deployment id, OCI image tag, each owner-test row with its screenshot under `docs/qa/phase-02/`, device models and OS versions, browsers and zoom levels, the state-coverage table, the error-window output, k6 result files, and each defect with its `regression:` test). The test window runs from the last dev deploy to sign-off, at least 24 h.
10. Close every ego-browser page at the end (`task.finish({ keep: [] })`): two contexts per user means many tabs (CLAUDE.md tab hygiene).

---

## 13. Work breakdown

### 13.1 Packages, file ownership, tasks and acceptance

**Strict ownership:** a file is created or edited only by its package. Shared files have exactly one owner in P2 (listed). Another package that needs a change files it as a request in the owner's PR. Deletions at the parity gate are owned by WP-I after the owning packages are done.

| WP | Owns (create / edit / delete) | Tasks | Acceptance | Estimate |
|---|---|---|---|---|
| **A · Data and `@repo/db`** | Create `PKG/db/**` (package, `prisma/schema.prisma` (moved), `prisma/migrations/**` (moved + M2a, M2, M2i), `prisma/protected-indexes.txt`, `prisma/seed*.ts` (moved), `src/client.ts`, `src/index.ts`, `src/json/game-meta.ts`, `src/live/{index,loadLiveGame,checkpoint,finish,abort,createRematch,restoreList,staleSweep,errors}.ts`, `src/games/{index,createLiveGame}.ts`, `sql/roles.sql`, `test/*.int.test.ts`); `REPO/scripts/db/check-drift.ts`; `REPO/docs/indexes.json`; `WEB/scripts/backfill-play-columns.ts`; `WEB/scripts/dev/seed-game-fixtures.ts` (incl. the `stress=1` game). Edit `WEB/lib/prisma.ts`, the 12 importers of `app/generated/prisma`, `WEB/package.json`, `WEB/next.config.js` (transpilePackages; `/workers/sf18-*` headers for WP-H), `REPO/turbo.json`, `WEB/.gitignore`. Delete `WEB/prisma/**` (moved) | A1 move the schema and client into `@repo/db` with no schema change (0.75 d); A2 M2a/M2/M2i incl. the display, source and `gamesVersion` columns + raw SQL (`games_open_idx`, fillfactor) + `check-drift.ts` and `protected-indexes.txt` + `docs/indexes.json` + apply to Neon dev (0.75 d); A3 `live/*` (finish CTE with the `uv` bump, transient-error classification and retry, prewarm) and `createLiveGame` (display snapshot) with integration tests on local Postgres (1 d); A4 backfill (dry run, review, apply on dev; fills the display columns of legacy rows) + fixture seeder + `roles.sql` + the real-PGN size measurement for data-model (0.5 d) | web build, `check-types`, existing e2e and a Vercel preview build pass after A1; an arm64 Docker build of the socket with the Prisma engine starts (R-01); `migrate deploy` clean on a fresh local Postgres and on Neon dev; drift check clean; `EXPLAIN` plans of §9.2 attached to the PR; finish CTE idempotent and counts once, bumps `gamesVersion` once; `neon-suspend.int.test.ts` green; backfill verification queries return 0 failures | **3.0 d** |
| **B · `@repo/game-core`** | Create `PKG/game-core/**` (all of §8's layout) and `PKG/chess-fixtures/**` (incl. `rules/illegal-reasons.json`, `design/*.json`, `test/design.test.ts`), `REPO/scripts/qa/extract-design-fens.ts` | B1 rules (wrapper, end detection, insufficient, timeClass, material, describe, explainIllegal) (1 d); B2 clocks + server reducer + timers (1 d); B3 client reducer + `viewState` (55 states) (0.75 d); B4 local runner, strength ladder, hints, draw policy, PGN, adjudicate, snapshot mapper (0.75 d); B5 design-FEN extraction and the illegal-reasons fixture (0.25 d) | all §12.1 game-core tests green incl. the 1,000-game property test and the perft fixtures; 100 % of T1–T20 covered; the 55 golden transcripts (with C) produce the expected states; every design fixture replays legally | **3.75 d** |
| **C · `@repo/contracts/socket` + HTTP games + internal auth** | Create `PKG/contracts/src/socket/{game,commands,events,codes,limits,token,internal,registry,rooms}.ts` + tests, `PKG/contracts/src/internal/auth.ts` + `test/auth.test.ts`, `PKG/contracts/src/http/games.ts`, `PKG/chess-fixtures/socket/transcripts/*.json` (with B). Edit `PKG/contracts/package.json` (`exports` += `./socket/*`, `./internal/*`), `PKG/contracts/src/http/codes.ts` + `codes.test.ts` (P2 rows of §0.2), the shared ESLint config (room-literal ban, `internal/auth` banned in client code) | C1 schemas and types of §7.4 incl. `MoveAck` and `session:hello` (0.5 d); C2 token sign/verify + key ring, emit registry, `rooms.ts`, golden transcripts skeleton (0.5 d); C3 HMAC helper, kid allow-list types, error-code ledger rows (0.5 d) | schema, size (realistic fixtures), token, auth and codes tests green; consumed by D, E, G without local copies of the types | **1.5 d** |
| **D · Socket server v2** | `WS/**`: create `WS/src/{index.ts, server/{io,handshake,rooms,rateLimit}.ts, commands/{game,study,draw,rematch,spectate,live,clock,session}.ts, game/{LiveSession,SessionRegistry,timers,presence,spectators}.ts, persist/{outbox,journal,restore,drain}.ts, http/{health,ready,emit,broadcast,drain,metrics,tournamentEvent,allow}.ts, config/{env,timing}.ts, cli/internal.ts, obs/{metrics,logger,sentry,posthog}.ts}`, `WS/test/**`; move the v1 files to `WS/src/v1/` (AI path deleted); edit `WS/package.json`, `WS/tsconfig*.json` (one strict config), `WS/Dockerfile`, `WS/utils/socketAuth.ts` (→ `server/handshake.ts`), `WS/instrument.ts`; delete `WS/spotInterruption.ts`, `WS/utils/traceContext.ts`, `WS/deploy/**`, `WS/docker-compose.yml`. Also `REPO/deploy/oci/{docker-compose.yml,Caddyfile}`, `REPO/.github/workflows/deploy-oci.yml` | D1 bootstrap, handshake, rooms, v1 coexistence (1 d); D2 `LiveSession` over the reducer, the single timer, presence and grace (1.5 d); D3 commands: study, moves, draws, rematch (with `createRematch`), spectators with the one-ply delay, `live:list`, sync, rate limits (1 d); D4 persistence: outbox, journal, restore, drain, sweeps, eviction (1.5 d); D5 HTTP endpoints with HMAC verify, kid allow-lists, nonce set, empty-room skip, the signing CLI, metrics, PostHog, legacy tournament alias (0.75 d); D6 per-user and per-IP handshake limits with the boot grace, `session:hello` / `useq`, `TIMING_PROFILE` (0.5 d); D7 integration tests, Dockerfile, compose, Caddy (incl. the unsigned pre-check), deploy workflow, first dev deploy with drain (1 d) | §12.4 suite green in CI; a dev deploy during a live game shows the restart chip and resumes (T11); `/ready` gates the healthcheck; `ws.socket_event{proto=1}` visible for legacy tabs; an unsigned `/internal/*` request is refused by Caddy; k6 smoke (50 sockets) passes | **7.25 d** |
| **E · Web HTTP and legacy writers** | Create `WEB/app/api/games/route.ts`, `WEB/app/api/games/[ref]/{route,checkpoint/route,complete/route,pgn/route}.ts`, `WEB/lib/games/{snapshot.server,create-bot-game.server,complete-bot-game.server,checkpoint.server,access.server}.ts` + tests, `WEB/lib/internal/fetch.ts` (`internalFetch()` over the HMAC helper), `WEB/lib/api/queries/games.ts`, `WEB/lib/api/mutations/games.ts`. Edit `WEB/lib/api/keys.ts` (`games.detail`, `games.live`), `WEB/lib/socket-token.ts`, `WEB/app/api/socket-token/route.ts`, `WEB/app/api/chess/{create-game,join,cancel-game}/route.ts`, `WEB/lib/services/matchmaking/matchmaking.service.ts`, `WEB/app/api/tournament/find-match/route.ts`, `WEB/app/api/analysis/[gameId]/route.ts`, `WEB/app/api/cron/daily/route.ts`, the legacy tournament routes that post to `/internal/tournament-event` (switched to `internalFetch()`), P1's authz walker rows under `WEB/test/authz/`, the three `create-ai-game` callers (`WEB/app/play/page.tsx`, `WEB/app/queue/page.tsx`, `WEB/app/position/[referenceId]/PositionPageClient.tsx`). Delete `WEB/app/api/chess/create-ai-game/` | E1 socket token v2 + legacy writers through `createLiveGame` + analysis adapter (1 d); E2 `POST /api/games`, `GET /api/games/[ref]`, snapshot service (shared with the RSC) (1 d); E3 checkpoint (bucket, `rev_gap`, suffix replay), complete (adjudicate), PGN (`no-store`), cron sweep (with the `gamesVersion` bump), caller switch, `create-ai-game` removal (1 d); E4 socket-token minting from session claims, `internalFetch()` for the legacy tournament callers, the codes of §0.2 on every route (0.25 d). No game-image route (§7.1.6) | §12.5 suite green; authz and cache-tier rows pass; existing legacy specs (`play-with-friend`, `quick-match`, `tournament`) still pass after E1 (tolerant readers); `create-ai-game` has no callers | **3.25 d** |
| **F · Board** | Create `WEB/components/board/**` (§4.5.1) + tests, `WEB/app/dev/ui/board/page.tsx` (standalone dev page; P1's gallery index untouched) | F1 square/piece/overlay layers, geometry, animation diff (1 d); F2 input: pointer, drag, click-click, premove, promotion picker, illegal shake, arrows, touch (1.5 d); F3 badges (owner icons), keyboard grid, move input, `MiniBoard`, a11y, reduced motion (1 d) | the §4.5.3 contract passes on desktop Chromium and the WebKit/Android projects on `/dev/ui/board`; drag trace ≥ 50 fps at 4× throttle; the existing `chess-board.ts` fixture selectors work on the new board; axe clean | **3.5 d** |
| **G · Game screen** | Create `WEB/app/(app)/game/[ref]/{page,layout,loading,not-found}.tsx`, `WEB/features/game/**` except `local/` (incl. `controller.ts` on day 1, `store.ts`, `viewState.ts`, `copy.ts`, `live/*`, `clock/*`, `sound/*`, `keys/*`, `screen/**`, `demo/*`), `WEB/lib/realtime/{connection,useConnection,RealtimeBoot,resync,validate.dev}.ts(x)` (makes P1's stub real), `WEB/app/dev/ui/game/page.tsx`. Move `WEB/app/game/[gameId]/*` to `WEB/features/game/legacy/` (`git mv`) and delete the old route folder. Edit the P1 shortcuts registry (game rows) | G1 realtime connection, store, controller interface, clock store (1 d); G2 layout on every device, player bars, panel, zones, move list/strip, action bar, menus, popovers (1.5 d); G3 live flows: join/sync, moves and acks, outbox, premove, study, first move, offers, presence, reconnect, restart chip, auth refresh chip, rematch, spectating, live list (1.5 d); G4 result card with the named slots of §2.4 and share (Copy link, Download PGN), hotkeys, sounds, live regions, demo route with all states (and `stress=1`), flag switch to the legacy screen (1 d); G5 optimistic study-ready, draw and rematch with ack rollback, `bootId`/`useq` resync, dev-only frame validation (0.25 d) | every lit state of §4.3 reachable on `/dev/ui/game` and with real data; one-viewport suite green; T1–T13, T16–T18 pass on dev; no client fetch on mount (network log); no `ZodError` in the `/game/[ref]` chunks | **5.25 d** |
| **H · Bot games and engine** | Create `WEB/features/engine/{EngineProvider.tsx,uci.ts,manifest.ts,prefetch.ts}`, `WEB/features/game/local/{useLocalGame.ts,persist.ts,useBotEngine.ts,hints.ts,lock.ts,pendingCompletes.ts}`, `WEB/scripts/build-engine-assets.mjs` (copies `public/workers/stockfish-18-lite-single.{js,wasm}` into `public/workers/sf18-<hash>/` with `COPYING` and `SOURCE.txt`, and writes `manifest.json`; run in `prebuild`), `WEB/scripts/upload-engine-r2.mjs` (owner-run once per engine hash: uploads the folder to R2 with `Content-Type` and `Cache-Control: public, max-age=31536000, immutable`; the R2 CORS rule allows the app origins), `WEB/public/workers/engine-shim.js` (same-origin worker: `importScripts(<base>/stockfish-18-lite-single.js)` with `locateFile` → `<base>/…wasm`; falls back to `/workers/sf18-<hash>/` on a load error and reports `engine_init {ok, source: "r2" | "origin"}`) | H1 engine provider (init, options per ladder row, queue, hint search, failure UI, prefetch) (1 d); H2 local controller (journal, beacons, resume, two-tab lock, complete with retries and the pending queue) (1 d) | T14/T15 pass; the WASM is served immutable from R2 (fallback: the hashed same-origin path) and cached by the SW; `COPYING` and `SOURCE.txt` reachable next to both copies; no engine request on a PvP or spectator page; a forged complete is refused by E | **2.25 d** |
| **I · QA, perf, deploy, parity gate** | Create `WEB/e2e/specs/game/**` (incl. `upgrade-required`, `in-game-auth`, `optimistic-offers`, `shared-device` and the `*.real.spec.ts` `@slow` copies), `WEB/e2e/fixtures/{games,socket-server}.ts`, `WEB/e2e/devices/game/**`, `WEB/e2e/__screenshots__/` P2 baselines, `perf/k6/src/lib/protocol-v2.ts`, `REPO/docs/qa/phase-02-signoff.md`, `REPO/perf/results/p02-*.json`. Edit `WEB/e2e/fixtures/chess-board.ts`, `WEB/e2e/specs/{play-with-bot,play-with-friend,quick-match,tournament}.spec.ts`, `WEB/playwright.config.ts` (socket fixture env), `WEB/lib/test-hooks/registry.ts` (P2 rows), `REPO/docs/qa/design-states.overrides.json` (P2 demo-only reasons), `perf/k6/src/scenarios/{ws-ramp,ws-games}.ts`, `perf/README.md`, `.github/workflows/ci.yml` (replace P1's `--exit-code` drift step with `check-drift.ts`), `.github/workflows/nightly.yml` (P2 `@slow` specs, the weekly Neon-suspend job). At the gate: delete `WS/src/v1/`, `WEB/features/game/legacy/`, `WEB/lib/types/socket-events.ts`, `WEB/app/api/chess/{move,game-state,game-over}/`, the two flags and `PROTOCOL_V1` | I1 e2e specs and fixtures (written alongside G, 1 d of its own); I2 the critique additions: fast-profile timer specs and their `@slow` copies, telemetry assertions, state tags, the new specs, the extra visual baselines (0.75 d); I3 k6 v2 run with usage capture, resilience runs incl. the Neon suspend, manual ego-browser pass, real devices, sign-off record, parity gate PR (0.75 d) | §12.6–12.11 green; DoD §15 checked; the parity-gate PR merged | **2.5 d** |
| **Total** | | | | **32.25 d** (+ a 20 % buffer line ≈ 6.5 d, feasibility §8) |

### 13.2 Order, parallel streams and merges

```
Day:      1     2     3     4     5     6     7     8     9    10    11    12
Stream S  A1 ── A2 ── A3 ─ A4 ┐
          C1 ─ C2 ┐           │
          B1 ── B2 ── B3 ─ B4 ┘
                D1 ── D2 ──── D3 ── D4 ──── D5 ─ D6 ───────────┐
Stream W        E1 ── E2 ── E3 ┘(needs A3, C, B4 adjudicate)   │
Stream C  F1 ── F2 ──── F3                                     │
                G1 ── G2 ──── G3 ──── G4 ┐                     │
                            H1 ── H2 ────┘                     │
Stream Q              I1 (specs written as features land) ───── I2 ── parity gate
```

With one developer and Claude running packages in parallel (three streams), the calendar is about 13–14 working days; strictly sequential it is the 32.25 dev-days above. Owner review and the real-device pass are the bottleneck, not build time (feasibility §8).

**Merge order to `dev`** (each merge green on CI and deployed, allocation §1.1):

1. A1 `@repo/db` move (no behaviour change).
2. C + B packages (no runtime effect).
3. A2–A3 migrations applied to Neon dev; `live/*`. **M2a (`GameStatus += ABORTED`) lands in this PR, one deploy before any writer of `ABORTED`** (D's abort path, E's sweep), and the new enum values `IMPORTED`/`OTHER` are never written in P2, so every enum value obeys the two-release rule (feasibility §9).
4. E1 legacy writers + socket token v2 + analysis adapter (tolerant readers; old screens still work).
5. D socket v2 with v1 compat → first dev socket deploy (with the drain step).
6. F board, then G game screen and E2–E3 HTTP, then H bot client; `create-ai-game` removed in the same PR as the caller switch.
7. A4 backfill on dev; flags on for the owner and A–P.
8. I e2e + perf + manual pass.
9. Parity-gate PR (deletions).

### 13.3 Stubs if P1 slips

| Missing P1 item | Stub owned by | Stub |
|---|---|---|
| `BoardStage` / `ScrollRegion` | G | `WEB/features/game/screen/StageFallback.tsx` with the same props and the 04-viewport CSS, replaced when P1 lands |
| `route()` wrapper | E | the four routes use a local `withEnvelope()` helper with the same envelope and codes; switched in one PR |
| `RealtimeBoot` stub | G | G creates it (already in G's ownership) |
| `idempotency_keys` | A | M2i |
| P1 kit components (Popover, Menu, Sheet) | G | Radix primitives directly, with the DS classes |

### 13.4 Estimate delta and trim options

**Delta against the allocation (28 d): +4.25 d.** Revision 1 was 28.5 d. The critiques added: HMAC signing with kid allow-lists, the CLI and the Caddy pre-check (+0.75 d, C3 and D5); the M2 display, source and `gamesVersion` columns, `games_open_idx`, the drift script and the index list (+0.25 d, A2); scale-to-zero handling and the display snapshot in the writers (+0.25 d, A3); R2 engine hosting and the licence files (+0.25 d, H); the bot-checkpoint hardening, socket-token claims, `internalFetch()` and the error-code ledger (+0.5 d, E3–E4); per-user handshake limits, `session:hello`/`useq` and `TIMING_PROFILE` (+0.5 d, D6); optimistic offers, resync and dev-only validation (+0.25 d, G5); design fixtures (+0.25 d, B5); the test-plumbing additions (+1.0 d, I2–I3); minus the dropped game-image route (−0.25 d, E3). Net +3.75 d over revision 1. Feasibility §8 also asks for a 20 % buffer line per phase; it is shown in §13.1 and is not spent by default.

**No trim removes a designed state or CTA.** Revision 1's trim (deferring "Watch another game" and `live:list` to P9) is withdrawn, because P9 lists that CTA as "P2 / P12" and the second CTA of `over_spectator` would have no owner (coverage C-17). Optional trims, owner's choice (§14.1 Q16):

| Trim | Saves | Cost |
|---|---|---|
| Dark-theme visual baselines move to P10 (appearance settings) | 0.25 d | dark regressions on the game screen are caught by the manual pass only until P10 |
| `session:hello`/`useq` resync moves to P3 (first phase with many user-room events) | 0.25 d | reconnects in P2 keep marking the user-level queries stale (3–5 GETs per reconnect) |
| The `docs/indexes.json` existence gate moves to P3 | 0.25 d | P2's indexes are checked by the `EXPLAIN` review in WP-A only |

---

## 14. Risks, open questions and owner decisions

### 14.1 Owner decisions (defaults used by this plan)

| # | Question | Default in this plan | Impact if different |
|---|---|---|---|
| Q1 | Study-phase scope (allocation owner decision 1) | 30 s only when `startingFen ≠ initial`; 0 otherwise. The owner test T1 therefore uses a legend position | a different rule changes one function (`studySecondsFor`) and new games only |
| Q2 | Abort rights during the first-move window (allocation 2) | Only the side whose first move is pending (matches `rematch_first` disabling actions) | "Either player until both have moved" (Lichess) is one guard in T6 |
| Q3 | Spectating rules (allocation 3) | Members only; any live human game is watchable by URL; bot games private; private profiles arrive in P10 | stricter rules add a `watchable` predicate; no schema change |
| Q4 | Opponent-disconnected copy (allocation 4) | §4.8: two variants by side to move; clocks never paused for a disconnect | copy only |
| Q5 | Keep the legacy fallback after the parity gate? | **Yes, one release** (feasibility §9 rule 3): the gate turns the flags on for everyone and removes them from the UI; the deletion PR is prepared at the gate and merged in P3 week 1, so a web or socket rollback in that window still finds the v1 path | delete at the end of P2 → no rollback path once the PR merges |
| Q6 | Bot games: pause the human's clock while the page is hidden? | Yes (unrated, friendly) | one runner option |
| Q7 | Stale games | live: abort after 30 min with < 2 plies, abandon (side to move loses) after 2 h; bot: abort after 7 days | constants only |
| Q8 | Spectator delay for friend games too | yes, one ply for every spectator | — |
| Q9 | Viewing history when your turn comes (play-a Q13) | stay on the viewed ply, flash Back to live, play the sound | one reducer branch |
| Q10 | Premove against the bot (play-a Q10) | off | one flag in the local runner |
| Q11 | Bot draw acceptance | plies ≥ 60 and \|eval\| < 30 cp | constants |
| Q12 | Drain notice length | 30 s on dev; 120 s on production (P13) | env |
| Q13 | OCI dev box idle reclamation (socket F-17) | **moved to P1** (feasibility F-OCI-5: P1 owner task, PAYG with a $1 budget alert and compartment quotas capping A1 at 4/24). P2 only checks that it is done before the k6 week | without it the dev box may be reclaimed after 7 idle days |
| Q14 | Game images (`/og/game`) | **dropped** (§7.1.6): images come only from P3's shares | — |
| Q15 | CLAUDE.md DB rule wording | **no `db push` on any Neon branch** (consistency R-20); the owner updates CLAUDE.md line 19, which still allows it on the dev branch | if `db push` stays allowed on dev, it drops P2's partial indexes and storage parameters; the raw SQL would have to be re-applied after every push |
| Q16 | Estimate: 32.25 d against the allocation's 28 d (§13.4) | accept; no trim | take any of the three trims in §13.4 (−0.25 d each) |
| Q17 | Internal auth deviates from B20's `x-internal-token` wording | HMAC with kid allow-lists from P2 (§7.5.1), as architecture §3.2.4 and api-design §2.11.6 specify | keep the static token: change only `PKG/contracts/src/internal/auth.ts`; accept the replay and forged-event exposure (feasibility SEC-4) |
| Q18 | The handoff ledger (§2.5) | each receiving phase adds its row | an unpicked row leaves a designed slot unrendered (coverage C-01 … C-16) |

### 14.2 Risks

| # | Risk | Likelihood · impact | Mitigation |
|---|---|---|---|
| R-01 | Prisma's query engine on `node:22-alpine` arm64 fails to load (`linux-musl-arm64-openssl-3.0.x`) | medium · high | WP-A day 1 builds the socket image on the arm runner and runs one query; fallback: the socket's 7 statements through `@prisma/adapter-pg` (driver adapter) or plain `pg` with the same SQL |
| R-02 | Moving the Prisma client breaks Vercel's file tracing (engine missing at runtime) | medium · high | A1 ships alone with a preview deploy check; `outputFileTracingIncludes` for the engine |
| R-03 | P1 slips (shell, `BoardStage`, `route()`, contracts) | medium · medium | stubs in §13.3 |
| R-04 | Mumbai → Neon latency (≈ 220 ms) plus a Neon wake (≈ 1 s) on the first write after idle | high · low | all writes are asynchronous to play; one-statement finish; the journal covers outages |
| R-05 | Dev and production share one Neon project (DB-01): load tests and fixtures spend production's 100 CU-h | **closed by P1 1B·H10** (dev and E2E in their own project) | P2 entry precondition (§2.3); if H10 slipped, WP-I does it before the first k6, resilience or nightly run |
| R-06 | iOS Safari pointer and audio quirks (drag, long-press menu, audio unlock) | medium · medium | WebKit device projects, `touch-action: none`, `-webkit-touch-callout: none` on the board, audio unlocked on the first gesture, real-device pass (DoD) |
| R-07 | The one-ply spectator delay and its clock replay are fiddly | medium · low | isolated in `game/spectators.ts`; fallback: spectators live with a 3 s delay (play-a) behind a constant |
| R-08 | Legacy flows (quick match, tournaments, `/join`) depend on the new columns | medium · high | E1 lands with the old specs green before any v2 code reads the columns |
| R-09 | `/analysis/[ref]` breaks for v2 games before P3 | medium · medium | adapter + a regression e2e on a v2 game |
| R-10 | Stockfish WASM (7.3 MB) on low-end phones | medium · medium | one worker, Hash 16 MB on phones, `nodes` budgets, engine failure UI, prefetch on intent |
| R-11 | React Compiler with external stores and rAF loops | low · medium | `useSyncExternalStore` for stores; refs for rAF; a Playwright perf spec |
| R-12 | A leaked internal key pushes forged events (`entitlement:changed`, toasts with links) to user rooms | low · high | **mitigated in P2:** HMAC with timestamps, a 2-minute replay set, per-caller kids and event allow-lists, the Caddy pre-check (§7.5.1); rotation without downtime |
| R-13 | GPL: Stockfish is GPL-3.0; **today `public/workers/` has no licence file or source pointer** (feasibility LIC-2); chessground (GPL-3.0) is not used | medium · medium | WP-H ships `COPYING` and `SOURCE.txt` next to the engine files on R2 and on the origin; the engine stays a separate file, never bundled; P11 links them from a "Third-party licences" section; no GPL code in the JS bundle |
| R-14 | The single 1-OCPU socket box is also the dev box for k6 | low · low | k6 at low hours; prod is untouched until P13 |
| R-15 | Large refactor of the 1,437-line page hides behaviour that e2e relies on | medium · medium | keep the `data-*` hooks; the legacy screen stays reachable by flag until the gate |
| R-16 | Lag credit lets US players gain up to 250 ms per move | low · low | per-game cap of 5 % of the initial time; metric `ws.lag_credit_ms` |
| R-17 | Name collision `presence:update` with P10's user presence | resolved | P10's event is `presence:state` (handoff H-09) |
| R-18 | Neon scale-to-zero closes the socket's connections; the first write after a quiet period fails | high · low | transient-error classification, one immediate retry, the prewarm and `ws.persist.reconnect` (§6.7); the Neon-suspend resilience test (§12.9) |
| R-19 | R2 serves the WASM with the wrong `Content-Type` or without CORS, so the engine fails on some browsers | medium · medium | metadata set by `upload-engine-r2.mjs`, the shim's same-origin fallback, `engine_init{source}` shows which copy loaded; `bot-game.spec.ts` asserts it |
| R-20 | A receiving phase does not pick up a P2 handoff (bank line, coach line, legend CTA, bot-zone card, Board settings, calibration) | medium · medium | §2.5 ledger with the receiving section named; Q18; the P2 sign-off record lists the ledger status |
| R-21 | The per-IP handshake limit is set too low for CGNAT networks | low · medium | per-user limits carry the abuse control; the IP guard is a flood guard (500 / 300 per minute) with a 120 s boot grace (§7.4.1) |

### 14.3 Conflicts recorded for the owner

- data-model D22 (socket writes through internal web routes) is superseded by B4 (direct writes); api-design INT-1…INT-8 become functions in `PKG/db/src/live/*`. The P3 and P12 specs should call those functions, not HTTP routes.
- data-model D1 ("PGN is not stored") is superseded by B3 (`Game.pgn` written once).
- data-model's `endReason`/`GameOutcome`/`whiteUserId`/`LivePhase.RUNNING` names are superseded by the allocation's `endMethod`/`GameWinner`/`whitePlayerId` and `PLAYING`.
- The DS README line "Game over is a centred card on the final board" conflicts with the v3 boards ("result card replaces the panel top, never covers the board", play-a C7). P2 follows the boards; the owner may want to update the DS README on the design canvas.
- Architecture §5.1 says Vitest; P2 uses `node:test` (allocation, SPEC D13).
- Allocation B20 specifies `/internal/emit {room, event, data}` with `x-internal-token`, and consistency R-08 keeps the token. P2 ships the `targets[]` body (R-07) and **HMAC** (architecture §3.2.4, api-design §2.11.6, feasibility SEC-4, api-perf AP-44). Owner sign-off: Q17.
- api-perf AP-07 asks to rename `game_players."endedAt"` to `playedAt`; consistency R-01 keeps `endedAt`. P2 keeps `endedAt` (one column either way; the DTO may say `playedAt`).
- CLAUDE.md allows `prisma db push` on the Neon dev branch; P2 forbids it on every branch (R-20). Owner updates CLAUDE.md: Q15.
- data-model §10.1 storage figures leave out `Game.pgn`; WP-A measures the real size and sends it to data-model (feasibility F-NEON-4).
- api-design PLAY-13 (`/og/game/{ref}`) and P2 revision 1's signed image route are both dropped in favour of P3's share images (api-perf AP-05).

### 14.4 Rollback

Revision 1 had no rollback plan (feasibility §9). P2's rollback paths, in the order they would be used:

| Layer | How to roll back | Safe because |
|---|---|---|
| Client protocol and screen | turn `live-protocol-v2` / `game-v3` off (PostHog) until the parity gate; for one release after the gate (Q5) the v1 path still exists | the v2 server accepts v1 clients while `PROTOCOL_V1=on` |
| Socket image | `deploy-oci.yml` `workflow_dispatch` with the previous image tag (input `image_tag`), with the normal drain | the journal carries a format version and an older reader skips newer files and restores from the DB (§7.6); never roll back during a P12 live arena |
| Socket image older than WP-D | also roll the web back past E4, because a pre-WP-D socket expects `x-internal-token` | documented in the deploy workflow header |
| Database | nothing to undo: M2a, M2 and M2i are expand-only; the backfill is idempotent and re-runnable (`--dry-run` first) | no column is dropped or renamed in P2; C1 (contract step) runs at P13 + 30 d with owner confirmation |
| Enum values | `ABORTED` is added one deploy before its first writer; `IMPORTED`, `OTHER` and the `GameSource` values beyond `REPLAY` are not written in P2 | an older Prisma client never reads a value it does not know (two-release rule) |
| Web (Vercel `replay-chess-dev`, Hobby) | Instant Rollback reaches only the previous deployment; otherwise revert the commit on `dev` | the routes added in P2 are additive; `create-ai-game` is removed in the same PR as its callers, so a revert restores both |
| Engine hosting | unset `NEXT_PUBLIC_ENGINE_BASE_URL` | the shim falls back to the same-origin copy |

---

## 15. Definition of done

**Shippable to dev** (allocation §1.1) plus the P2 specifics:

- [ ] Merged to `dev`; Vercel `replay-chess-dev` green; the dev OCI socket redeployed by `deploy-oci.yml` **with the drain step**; the Neon dev branch (its own project after P1 1B·H10) on M2a + M2 (+ M2i); Clerk dev and Dodo test unchanged.
- [ ] `@repo/db`, `@repo/game-core`, `@repo/contracts/socket` exist and are the only source of the schema, the rules and the protocol types (no hand-copied types left in `WS` or `WEB`).
- [ ] Flags `live-protocol-v2` and `game-v3` on for the owner and E2E users A–P; the parity gate passed; the deletion PR for the legacy screen, v1 handlers, `PROTOCOL_V1`, `lib/types/socket-events.ts` and `chess/{move,game-state,game-over}` is ready and merges in P3 week 1 (Q5).
- [ ] `chess/create-ai-game` deleted; `create-game`, `join`, `cancel-game`, `matchmaking`, `find-match` atomic and writing the new columns.
- [ ] CI green on the final `dev` SHA with `BILLING_PAYWALL=on`: lint (baseline delta, incl. the room-literal ban), `check-types`, unit (game-core, contracts, board, web), integration (socket + web routes on Postgres), `check-drift.ts`, the index-existence gate, bundle budget (`/game` ≤ 600 kB gz, owner-approved 2026-11-06, no engine on PvP, no `ZodError` in the game chunks), authz and cache-tier rows, `ci.yml` `e2e-smoke`, the nightly full main and device suites, and the post-deploy smoke against the dev URL; `check-test-globs` confirms every P2 test file ran.
- [ ] Every internal hop is HMAC-signed through `PKG/contracts/src/internal/auth.ts`; an unsigned `/internal/*` request is refused by Caddy and a forged or replayed one by the server; no service reads `x-internal-token` outside the v1 path.
- [ ] The error codes of §0.2 are in `codes.ts` with one status each; the `ROOM` builders are the only source of room names.
- [ ] `TIMING_PROFILE`, the fixture socket server and the `e2eRun` claim are registered test hooks, and P1's `prod-guard.spec.ts` is green against the production-mode build.
- [ ] `upgrade-required.spec.ts`, `in-game-auth.spec.ts` (`V3SessionExpired` `in_game_refresh`/`in_game_ok`), `optimistic-offers.spec.ts` and `shared-device.spec.ts` are green; the socket telemetry events are asserted exactly-once through the sink.
- [ ] Every lit state of §4.3 is reachable from real data or `/dev/ui/game?state=`; `state-coverage` shows 0 missing states for the 33 P2 boards and a written reason for every demo-only one; the not-lit states are listed with their owner in §2.4, and every row of the §2.5 handoff ledger is acknowledged in the receiving phase's doc.
- [ ] One viewport: board, both bars, both clocks and the controls in view on all 8 devices at 80–150 % zoom; no page scroll; no tab bar during a game; no toast over the board.
- [ ] Owner test T1–T18 passes on the dev URL with ego-browser; T16 on a real iPhone and a real Android phone.
- [ ] Persistence: an 80-ply game makes ≤ 11 DB statements and 0 Vercel calls per move; the final move and the PGN with `%clk` are stored; a socket deploy mid-game loses no ply and resumes with the same colours.
- [ ] Neon stays idle with no live games (no timer queries; verified by `no-idle-queries.int.test.ts` and the Neon console); a game survives a Neon suspend in the middle (§12.9) with `ws.persist.reconnect` and no `ws.persist.fail`.
- [ ] k6 `ws-ramp` budgets met on the dev box (one run, after the Neon split); Vercel and Neon usage recorded before and after; interaction latency budgets met in the perf spec; results in `perf/results/p02-*.json` and summarised in `perf/README.md`.
- [ ] The engine loads from R2 with the same-origin fallback working; `COPYING` and `SOURCE.txt` sit next to both copies.
- [ ] The post-deploy socket handshake from `https://replay-chess-dev-replaychess007-1069.vercel.app` is green.
- [ ] Sentry: socket metrics and alerts configured (`ws.persist.fail` excludes `ws.persist.reconnect`); `error-window.ts` shows no new issue over the ≥ 24 h test window, or each is triaged. PostHog: the §10.1 events arrive with their properties on dev; the three funnels exist.
- [ ] Every defect found in the owner test, the ego-browser pass or the real-device pass has a `regression:` test; `REPO/docs/qa/phase-02-signoff.md` is committed with the SHA, screenshots, device models, the coverage table, the error-window output and the k6 result files; the ego-browser pages are closed.
- [ ] Backfill run on dev with its verification queries at 0 failures; fixture seeder documented in `WEB/scripts/dev/README.md`.
- [ ] Docs: this plan linked from `docs/implementation-plan.md`; `perf/README.md` updated; `deploy/oci/README` (or the workflow header comment) documents the drain; open questions Q1–Q18 answered or defaulted in writing.

---

## Appendix A. Critique dispositions

Revision 2 read the five critiques in `SP/plan/` (coverage, consistency, feasibility, testing, api-perf) and took every finding that names P2 or a contract P2 creates. "Applied" means the change is in the section named. Findings about other phases are fixed in those phases; the ones P2 hands over are in the §2.5 ledger.

### A.1 Applied

| Critique · ID | Finding | Where in this plan |
|---|---|---|
| coverage C-01 | Mistake Bank line on the result card has no owner; P2 said P3 in one place and P5 in another | §2.2, §2.4 slot `bank` → P5; §2.5 H-01; §4.3 result-card fields |
| coverage C-02 | Coach line on the result card owned by nobody | §2.4 slot `coach`: P3 template, P7 LLM swap; H-02 |
| coverage C-03 | "Replay from move N" assigned to "P3/P8" | §2.4 slot `legend` → P3 §4.7 with the `/practice?game&ply` target; §4.3 row 48; H-03 |
| coverage C-09 | Bot-zone coach card handed to "P7/P8" | §2.4: P7 for `BOT`, P8 for `LEGEND_BOT`; H-04 |
| coverage C-15 | Bot calibration handed to P8, which never mentions it | §2.2, §8.13 → P9; H-06; R-20 |
| coverage C-16 | "Board settings" ⋯ item missing from P10's light-up list | §2.4, §4.4; H-05 |
| coverage C-17 | The trim orphaned "Watch another game" | §13.4: trim withdrawn; §2.4 last row |
| consistency 2.1–2.4 | `games` display, title, source and external-id columns; `GameMode.IMPORTED`, `GameEndMethod.OTHER`, `GameSource`; `GamePlayer.source`; the unique index | §0.2, §6.2, §6.4, §6.6.1, §6.6.2, §6.6.4 |
| consistency 2.5 / R-06 | Error codes used but never added; wrong statuses | §0.2 row, §5.5.1, §7.1.1, §7.1.4, §7.1.5, §12.1 `codes.test.ts` |
| consistency 2.6 / R-07 | `rooms.ts` not created | §7.4.3, WP-C |
| consistency 2.7 / R-10 | `check-drift.ts` is not a P1 gate | §6.3, §6.5, WP-A, WP-I |
| consistency 2.8 | Keep P2's `jobs` fragment wording | unchanged (§6.6.4) |
| consistency 2.9 / R-07 | Only one `/internal/emit` body | §0.2, §7.5 (`.strict()`), §12.4 |
| consistency 2.10 / R-07 | `presence:state` for P10 | §0.2, §2.5 H-09, R-17 |
| consistency R-01 | One column contract for `games` / `game_players`; what later phases add | §6.2 paragraph after the models |
| consistency R-09 | One env name per secret; `WEB_APP_URL`, PostHog names | §7.9 |
| consistency R-10 | `src/` in contract paths, `exports` entries | whole file (paths), §0.2, WP-C |
| consistency R-13 | Limits as fixed `limit / windowSec` | §7.1.3 `bot-checkpoint = 60 / 60 s` |
| consistency R-18 | `engine_init` is P2's event | §10.1 (adds `source`) |
| consistency R-20 | No `db push` on any branch; no hard-coded Neon ids | §0.2, §2.3, §6.5, Q15 |
| feasibility fix 9 / LIC-2 | Engine on R2 from P2; GPL notice missing | §0.2, §7.8, §7.9, §9.3, WP-H, R-13, R-19 |
| feasibility SEC-4, SEC-8 | HMAC instead of the static token; Caddy refuses unsigned requests | §0.2, §7.5, §7.5.1, §7.11, §11.2, Q17 |
| feasibility F-OCI-4 | Pools and statements must survive Neon suspends; suspend test | §6.7, §7.6, §12.4, §12.9 |
| feasibility F-NEON-1 / F-OCI-5 | Dev Neon split and OCI PAYG belong in P1 | §2.3 precondition, R-05, Q13 |
| feasibility F-NEON-4 | PGN only for platform games; re-measure | §0.2, §9.2, WP-A A4 |
| feasibility fix 3 | Test hooks must not depend on `VERCEL_ENV` | §7.9 note |
| feasibility §9 | No rollback plan; enum two-release rule; journal version; legacy one release | §14.4, §7.6, §13.2 step 3, Q5 |
| feasibility §8 | 20 % buffer line | §13.1 total, §13.4 |
| feasibility F-VER-3 | Full device matrix must not run against the deployed dev URL | §12.7 tiering |
| feasibility 10.8 #7 | k6 records Vercel and Neon usage; one run per phase | §12.8 |
| testing (P2) dev URL | Wrong dev URL in three places (one would break `ALLOWED_ORIGINS`) | §1.2, §7.9, §12.11 |
| testing X5 | Server timers faked with `page.clock` | §7.9 `TIMING_PROFILE`, §12 intro, §12.6 timer specs and `@slow` copies |
| testing X1, X4, X8, X11, X12 | Test layout, persona rules, state tags, whole-suite regression, test-hook registry | §12 intro, §12.6 coverage report, §12.10 |
| testing X4.5 | Matchmaking isolation in e2e | §7.4.2 `e2eRun`, §12.6 `quick-match.spec.ts` |
| testing X6 | Telemetry asserted through the sink, exactly-once server events, PII guard | §7.9 `POSTHOG_HOST`, §12.4 `telemetry.int.test.ts`, §12.6 rows |
| testing X9, X10 | `stress=1` real-route run; more visual baselines in both themes | §12.7 |
| testing X13 | P2 builds `chess-fixtures` incl. design-embedded FENs | §12.2, WP-B B5 |
| testing X15, X18 | Sign-off record, error window, k6 results as data, tab hygiene | §12.8, §12.11, §15 |
| testing (P2) unit, contract, e2e additions | `timing-profile`, `explainIllegal` fixture file, `compat.test.ts`, `upgrade-required`, `in-game-auth` | §12.1, §12.3, §12.6 |
| testing (P2) DoD additions | five DoD lines | §15 |
| api-perf AP-01 | Neon project shared with production | §2.3, R-05 |
| api-perf AP-04 | PGN `immutable`; shared-device cache | §7.1.5, §9.3, §11.2 rule 13, `shared-device.spec.ts` |
| api-perf AP-05 | Public, never-expiring game images | §7.1.6 (route dropped), §0.1, ShareMenu, §9.3, Q14 |
| api-perf AP-07 (index part) | `games_status_lastMoveAt_idx` blocks HOT updates | §0.2, §6.2, §6.3 (`games_open_idx`, fillfactor), §6.4, §6.6.8, §9.2 |
| api-perf AP-10 item 3 | Emits to empty rooms still parsed and fanned out | §7.5, §12.4 |
| api-perf AP-12 | zod schemas kept in production bundles | §9.5, WP-G G5 |
| api-perf AP-15 | Move-ack SLO measured through consent-gated PostHog | §9.1 |
| api-perf AP-16 | `move:applied` budget unrealistic; `fen` and `clientMoveId` in the broadcast; `prefix` array | §7.4.4–7.4.6, §9.4, §12.1 size test |
| api-perf AP-17 | Per-IP handshake limits block CGNAT users | §7.4.1, R-21, §12.1 |
| api-perf AP-18 | Neon-suspend errors counted as failures; no prewarm | §6.7, §7.6 |
| api-perf AP-19 | Archive ETag needs `users."gamesVersion"` | §6.2 `User`, §6.6.4 `uv` CTE, §6.6.8, §6.7 grant |
| api-perf AP-25 | Reconnect resync burst on user rooms | §7.4.1 step 6, §7.4.5 `session:hello`, §12.1, §12.4 |
| api-perf AP-30 | Draw, rematch and ready wait one RTT | §5.2.8, §4.3 rows 20 and 52, `optimistic-offers.spec.ts` |
| api-perf AP-32 | Bot checkpoint has no durable limiter; full replays | §7.1.3, §6.6.7, §12.5 |
| api-perf AP-35 | CLS at zoom cannot be a field SLO | §9.1 |
| api-perf AP-41 | Socket-token minting reads the DB on every reconnect | §7.1.7 |
| api-perf AP-44 | Static internal token; per-caller keys and event allow-lists | §7.5.1 |
| api-perf §5 gates | cache-tier lint, index-existence gate, room-literal lint, 24 h timer audit, realistic size test, shared-device spec | §12.3, §9.2, §7.4.3, §12.4, §12.1, §12.6 |

### A.2 Rejected or changed (one-line reasons)

| Critique · ID | Finding | Disposition and reason |
|---|---|---|
| consistency R-08 | Keep `x-internal-token` everywhere; HMAC unscheduled | **Rejected:** architecture §3.2.4 and api-design §2.11.6 (which this plan must stay consistent with) specify HMAC, and a static bearer shared by three services lets one leak forge `entitlement:changed` with unlimited replays (SEC-4, AP-44). R-08's "one helper, one env name" part is kept (§7.5.1). |
| api-perf AP-07 (rename part) | Rename `game_players."endedAt"` to `playedAt` and its index | **Rejected:** consistency R-01 already moves seven phases to `endedAt`; the semantics are identical and only one column may exist, so the name P2 ships stays; DTOs may say `playedAt`. |
| api-perf AP-44 (transition part) | Receiver accepts both the token and HMAC during P3 | **Rejected:** WP-E switches every P2 caller to `internalFetch()`, so no caller needs the token, and accepting it would keep the replay hole open; the token survives only in the v1 path. |
| api-perf AP-32 (status) | Reject `rev > stored + 64` with 422 | **Changed to 409 `conflict {reason: "rev_gap"}`:** the R-06 ledger has no generic 422 code, and a revision gap is a state conflict, not an illegal move. |
| consistency 2.1 (bot label) | Bots get the name "Stockfish {botElo}" | **Changed to "Engine {botElo}":** the designs say "vs Engine 1400", and the same string is already `GamePlayer.opponentName`; one label everywhere. |
| feasibility SEC-4 (location) | Build a new `packages/internal-auth` | **Changed:** the helper is `PKG/contracts/src/internal/auth.ts` (the file R-08 and R-10 name), which avoids a sixth package; the behaviour is the same. |
| testing X16 | Split the Neon project in P2 | **Changed:** feasibility F-NEON-1 and api-perf AP-01 both put the split in P1 (1B·H10, day 1); P2 makes it an entry precondition and does it only if P1 slipped. |
| coverage C-15 (owner choice) | Calibration in P8 or P9 | **P9 chosen:** P9 owns rated play, the `GAME` Glicko preset and bot-strength persistence, so the calibrated scale lives next to the ratings it must match. |
| coverage C-21 | B26 decision blocks 6 states | **No P2 change:** none of P2's 55 states or the flow-map edges from `/game/[ref]` depends on B26. |
| consistency R-10 (`./internal/*` by P3) | P3 adds the `./internal/*` export | **Changed:** P2 adds it, because the HMAC helper lives there and P2 is its first user; P3 imports it. |
| feasibility F-OCI-4 (pool listener) | Add `pool.on('error')` to the socket's `pg` pool | **Not applicable as written:** the socket uses Prisma's query engine, not a raw `pg` pool, so an idle close surfaces as `P1017` on the next query rather than a crash; the rule is kept for any future raw pool (§6.7 rule 1). |
