# Replay Chess: consolidated audit of today's code

Status: **final, revision 2**, 2026-11-02, against branch `dev` @ `0848b76` (Phase 0 done). This file consolidates the five deep audits in `SP/plan/` (`audit-api.md`, `audit-db.md`, `audit-socket.md`, `audit-client.md`, `audit-quality.md`; `inv-code.md` was not produced) into one register: every finding by severity with its `file:line` evidence, the phase that fixes it, its status after the five critiques, the cross-audit duplicates, and each audit's keep / rework / remove verdicts. `SP` = `/private/tmp/claude-501/-Users-rohitpandit-open-source-chess-battle-turbo/8433de47-73d2-466e-945c-3c2450748123/scratchpad`. Paths in evidence are relative to `apps/web/` unless they start with `apps/`, `packages/`, `deploy/`, `k8s/` or `.github/`; socket evidence is relative to `apps/web-socket/`.

**How to read it.** IDs keep their source audit's numbering with a prefix: `API F-nn` (audit-api), `DB-nn` (audit-db), `WS F-nn` (audit-socket), `CL #n` / `CL Ln` (audit-client top 15 / smaller items), `Q SEC-nn`, `Q PERF-nn`, `Q A-nn`, `Q PLAT-nn`, `Q B/T/Q-nn` (audit-quality). The full reasoning for each finding stays in its audit; this register is the index. "Fix" names the phase and work package from the phase specs (`docs/plan/phase-NN-*.md`, `SP/plan/phase-NN.md`); "P1 Hn" is the P1 hotfix lane, which ships before more members arrive. Status comes from critique-api-perf §3 (Covered / Late / Gap / Partial) as revised by this plan set.

## 1. Numbers

| Audit | Critical | High | Medium | Low | Total |
|---|---|---|---|---|---|
| audit-api | 2 | 11 | 18 | 10 | 41 |
| audit-db | 2 | 8 | 7 | 1 | 18 |
| audit-socket | 5 | 12 | 15 | 9 | 41 |
| audit-client | 2 | 10 | 3 | 8 | 23 |
| audit-quality | 3 | 18 | 22 | 6 | 49 |
| **All** | **14** | **59** | **65** | **34** | **172** |

The same defect is often found by several audits (§7); the unique count of critical defects is about 9: open admin writes, open game-result writes, socket draw acceptance, socket impersonation, restart resets, unpersisted colours, a committed Clerk secret, dev sharing production's Neon compute, and no backups beyond a 6-hour window.

## 2. What revision 2 changed in the fix plan

The critiques found that most critical and high findings had an owner, and that a few were late, partial or unowned. Revision 2 closes them:

| Finding | Was | Now |
|---|---|---|
| DB-01 dev and E2E spend production's 100 CU-h | late (P13) | **P1 1B·H10**: Free project `replay-chess-dev`, max 0.5 CU; weekly CU-h report from P1 |
| DB-02 6-hour history, no backups | late (P13) | **P1 1B·H11**: nightly `pg_dump` of live production to R2 (`backup-prod.yml`) with a weekly restore check; P13's worker `BACKUP` replaces it |
| DB-07 billing compare-and-set | gap (P1 deferred to P4, P4 assumed P1) | **P1 F4b**: `users."subscriptionSourceAt"` (provider event time), conditional `UPDATE … WHERE "subscriptionSourceAt" <= $eventTime AND ROW(…) IS DISTINCT FROM ROW(…)`, unit tests both ways |
| DB-06 writes on every boot / API F-07 third-party calls on boot | partial (refresh-by-GET remained) | GETs are DB-only; `POST /api/billing/refresh`; the 6-hour heal moves to the daily `membership-reconcile` cron |
| API F-10 / WS F-06 / Q SEC-05 open socket internal route | partial (static token) | **HMAC from P2** with per-caller kids, event allow-lists, a replay set and a Caddy pre-check |
| WS F-17 OCI idle reclamation | late for the dev box | **P1**: UptimeRobot on the dev socket `/health`; OCI Pay-As-You-Go with quotas |
| Q SEC-09 scraping and unbounded lists | partial (edge limits unverified) | P1's in-isolate `EDGE_DOC_LIMIT` **on** for `/api/openings*` and `/api/positions*` until a Firewall rule exists |
| Q PERF-02 first-load JS | partial (zod and TanStack could undo it) | `devSchema()` keeps zod out of production chunks; TanStack mounted only in app layouts; the bundle budget is **blocking from P1** |
| Q SEC-03 Clerk secret in a public repo | covered | unchanged, with the order made explicit: **rotate first**, then delete `k8s/`, then gitleaks with a full-history baseline |
| (new) `CLAUDE.md` in a public repo maps servers, accounts and an expiring domain | — | P1 owner task: move environments and accounts to a gitignored `CLAUDE.local.md`; renew `playchess.tech` (expires 2027-02-02, auto-renew off) |
| (new) the dev site is a free public copy of the paid product | — | P1: Vercel Authentication on `replay-chess-dev` + an automation bypass secret |

## 3. Critical findings

| ID | Area | Finding | Evidence | Fix (phase) | Status |
|---|---|---|---|---|---|
| API F-01 | API routes | Admin content APIs are unauthenticated | `app/api/legends/create/route.ts:26`; `legends/[id]/route.ts:27, 191` | P1 H1 (`requireAdmin()`), P12 `/api/admin/*` | Covered |
| API F-02 | API routes | Game-result, clock and move writes are open to browsers | `game-over/route.ts:50-58`; `game-state/route.ts:18-26` | P1 H2 (internal-only + conditional transition); P2 removes the routes | Covered |
| DB-01 | Database | The Neon Free plan gives 100 CU-hours per project. Dev, E2E and production all live in one project (`withered-cake-82837167`), so dev and test traffic spends production's… | `docs/implementation-plan.md:70` | P1 1B·H10 (dev project split; moved earlier in r2) | Was **late**; fixed in r2 (moved to P1) |
| DB-02 | Database | The Free plan keeps only 6 hours of history (point-in-time restore) and 1 manual snapshot. The only backup is `/tmp/chess_battle_data_fixed.sql`. | — | P1 1B·H11 interim `backup-prod.yml` (r2); P13 worker `BACKUP` | Was **late**; fixed in r2 (moved to P1) |
| WS F-01 | Socket server | `accept_draw` has no player or offer check | `GameSession.ts:487-493`; `GameManager.ts:178-195` | P1 H6 #1; P2 `draw:*` rules | Covered |
| WS F-02 | Socket server | Impersonation while `SOCKET_AUTH_REQUIRED=false` | `socketAuth.ts:126-129` | P1 H6 #2; P2 handshake | Covered |
| WS F-03 | Socket server | Restart resets games to `startingFen`, re-randomises colours, re-runs study, overwrites history | `GameSession.ts:66,198,210`; `deploy-oci.yml:111-112` | P1 H6 #12, #13; P2 journal, restore, drain | Covered |
| WS F-04 | Socket server | Colours not persisted; creator = White assumed downstream | `GameSession.ts:197-207`; `schema.prisma:67-106` | P1 H6 #11; P2 `whitePlayerId`/`blackPlayerId` | Covered |
| WS F-05 | Socket server | Game-write routes not internal-only | `game-over/route.ts:50-58`; `game-state/route.ts:18-26` | P1 H2 | Covered |
| CL #1 | Client | The admin write APIs have no auth: `POST /api/legends/create`, `PUT/DELETE /api/legends/[id]`, `POST /api/chess-positions/create`, `PUT/DELETE /api/chess-positions/[id]`.… | `app/api/legends/create/route.ts:26`; `app/api/legends/[id]/route.ts:27,191` | P1 H1 | Covered |
| CL #2 | Client | `GET /api/user/email/[email]` is unauthenticated: anyone can map an email to `referenceId`, `code`, name, role and date of birth. The client calls it as an auth fallback. | `app/api/user/email/[email]/route.ts:6-62`; `lib/hooks/useRequireAuth.ts:107` | P1 H3/F4d | Covered |
| Q SEC-01 | Quality/security | unauthenticated admin write APIs | `app/api/chess-positions/create/route.ts:44`; `app/api/chess-positions/[id]/route.ts:167` | P1 H1 | Covered |
| Q SEC-02 | Quality/security | game result and state forgery | `app/api/chess/game-over/route.ts:50-58`; `app/api/chess/game-state/route.ts:18-26` | P1 H2 | Covered |
| Q SEC-03 | Quality/security | Clerk secret key committed to a public repository | `k8s/secrets.yaml:12`; `git rm -r k8s docker-compose.yml apps/web/Dockerfile` | P1 H5 + owner rotation (rotate first) | Covered |

## 4. High findings

| ID | Area | Finding | Evidence | Fix (phase) | Status |
|---|---|---|---|---|---|
| API F-03 | API routes | PII exposure and account enumeration | `user/email/[email]/route.ts:25-77`; `user/[referenceId]/route.ts:46-55` | P1 H3 → F4d removal | Covered |
| API F-04 | API routes | Any game's full data is public | `game-by-ref/[gameReferenceId]/route.ts:24-95`; `apps/web-socket/utils/apiClient.ts:41-48` | P1 H4 (invite projection); P2 role-aware `GET /api/games/[ref]` | Covered |
| API F-10 | API routes | Tournament notifications: unauthenticated receiver, dropped sends | `apps/web-socket/index.ts:42-49`; `lib/services/tournament/notify-websocket.ts:14-19` | P1 H6 #5; HMAC from P2 (r2) | Was **partial**; completed in r2 |
| API F-11 | API routes | `PERF_AUTH_BYPASS` has no environment fence | `lib/auth/resolve-user.ts:82-89`; `require-subscription.ts:41` | P1 H9 (`isNonProd() && ALLOW_TEST_HOOKS`) | Covered |
| API F-06 | API routes | Read-then-write races across core flows | `matchmaking.service.ts:43-53` | P1 H2, P2 §7.2, P9 CHL-3, P12 TOU-4 | Covered |
| API F-09 | API routes | Move persistence: cross-continent, O(n²), unordered | `apps/web-socket/GameSession.ts:440`; `move/route.ts:73-86` | P2 B4 checkpoints + finish CTE | Covered |
| API F-12 | API routes | Internal error text, stacks and upstream messages leak to clients | `legends/create/route.ts:99`; `chess-com-profile/route.ts:156-158` | P1 H7 | Covered |
| API F-05 | API routes | Exceptions are swallowed before Sentry | `lib/logger.ts:42-52`; `lib/sentry/logger.ts:42-53` | P1 H7 | Covered |
| API F-13 | API routes | Sentry samples 100% of traces and sends default PII | `sentry.server.config.ts:13, 20`; `sentry.edge.config.ts:14, 21` | P1 H7 | Covered |
| API F-07 | API routes | Third-party calls and writes on every app boot | `user/sync/route.ts:26-27, 71-84`; `subscription/route.ts:89-134` | P1 F4; refresh-by-GET → `POST /api/billing/refresh` (r2) | Was **partial**; completed in r2 |
| API F-08 | API routes | Polling where a socket already exists | `useMatchmaking.ts:30, 119`; `matchmaking.service.ts:415-425` | P9 (queue), P12 (pairing, lobby) | Covered |
| DB-03 | Database | Moves are stored as a JSON array of verbose chess.js moves inside `Game.gameData` (`apps/web/app/api/chess/move/route.ts:73-86`). | `apps/web/app/api/chess/move/route.ts:73-86`; `apps/web-socket/GameSession.ts:429-432` | P1 H6 #7, #12; P2 D1 columns | Covered |
| DB-04 | Database | `game-over` checks status outside the transaction, and its update has no status predicate (`apps/web/app/api/chess/game-over/route.ts:83-120`). | `apps/web/app/api/chess/game-over/route.ts:83-120` | P1 H2; P2 finish CTE | Covered |
| DB-05 | Database | Matchmaking polls every 1 s (`apps/web/lib/hooks/useMatchmaking.ts:30`). | `apps/web/lib/hooks/useMatchmaking.ts:30`; `apps/web/lib/services/matchmaking/matchmaking.service.ts:136-323` | P9, P12 | Covered |
| DB-06 | Database | Every app load runs `POST /api/user/sync`, which always does an `UPDATE users` (`apps/web/app/api/user/sync/route.ts:71-84`), and `GET /api/subscription`, which always do… | `apps/web/app/api/user/sync/route.ts:71-84`; `apps/web/lib/billing/entitlement.ts:99` | P1 F4 + `IS DISTINCT FROM` guard (r2) | Was **partial**; completed in r2 |
| DB-07 | Database | Billing snapshots are applied read → decide → write with no compare-and-set (`entitlement.ts:61-110`). | `entitlement.ts:61-110`; `apps/web/lib/billing/entitlement-rules.ts:156` | P1 F4b compare-and-set on `subscriptionSourceAt` (r2; was a gap) | Was a **gap**; fixed in r2 (P1 F4b) |
| DB-08 | Database | `/api/user/email/[email]` and `/api/user/[referenceId]` are unauthenticated and return email and `dateOfBirth` (`apps/web/app/api/user/email/[email]/route.ts:25-60`, `app… | `apps/web/app/api/user/email/[email]/route.ts:25-60`; `apps/web/app/api/user/[referenceId]/route.ts:19-55` | P1 H3 | Covered |
| DB-09 | Database | Deleting a user cascades to every game they played (`schema:90-91`, `onDelete: Cascade`), which erases the opponent's history too, and in future their reviews and Mistake… | `schema:90-91`; `schema:399` | P10 M10 `SET NULL` FKs + anonymise | Covered |
| DB-10 | Database | The plan's per-ply `MoveEval` (`docs/implementation-plan.md:101-104`) costs ~270 B per ply once row overhead and indexes are counted. | `docs/implementation-plan.md:101-104`; `implementation-plan.md:245` | P3 packed analysis; P5 R2 shards | Covered |
| WS F-06 | Socket server | Public unauthenticated `/internal/tournament-event` | `index.ts:42-73`; `Caddyfile:7-9` | P1 H6 #5; HMAC + Caddy pre-check from P2 (r2) | Was **partial**; completed in r2 |
| WS F-07 | Socket server | Final move never persisted | `GameSession.ts:429-432`; `game-over/route.ts:114-118` | P1 H6 #7; P2 finish | Covered |
| WS F-08 | Socket server | No timeout, retry, ordering or idempotency on persistence | `GameSession.ts:440-442,1092-1094`; `move/route.ts:73-86` | P1 H6 #9; P2 outbox + Neon-suspend handling (r2) | Covered |
| WS F-09 | Socket server | Ended sessions not evicted; reopening shows the game live | `GameManager.ts:156-158,192-194`; `GameSession.ts:607-631` | P1 H6 #8; P2 §7.6 | Covered |
| WS F-10 | Socket server | Disconnect forfeit result assumes creator = White | `GameSession.ts:559-561` | P1 H6 #6 | Covered |
| WS F-11 | Socket server | Bot game hangs after a refresh | `GameSession.ts:620-630`; `GamePageContent.tsx:477-482,750` | P1 H6 #10; P2 client-run bots | Covered |
| WS F-12 | Socket server | End methods wrong or missing | `GameSession.ts:1031-1037`; `types.ts:68` | P2 `GameEndMethod` | Covered |
| WS F-13 | Socket server | No first-move window or abort; study disconnect untracked | `GameSession.ts:929-937,552` | P2 `first_move` phases | Covered |
| WS F-14 | Socket server | Clock precision and sync | §5 | P2 clocks (§5.2.7, §6.9) | Covered |
| WS F-17 | Socket server | OCI Always Free idle reclamation risk | §11 | P1 UptimeRobot on the dev socket + OCI PAYG (r2); P13 D18 | Was **late**; fixed in r2 (moved to P1) |
| WS F-23 | Socket server | Rematch wrong (time control, colours, no notification) | `GamePageContent.tsx:308-338` | P2 `rematch:*` | Covered |
| WS F-38 | Socket server | Stockfish planned on the 1-OCPU socket box | `implementation-plan.md:109,244`; `CLAUDE.md:73` | P3 dev co-location in a `cpu.idle` slice; P13 D7 prod worker VM | Covered |
| CL #3 | Client | Every hard page load runs `POST /api/user/sync` (Clerk Backend API call plus 2–3 queries plus 1 write) and then `GET /api/subscription` (1–2 Dodo API calls plus 1 write).… | `app/components/UserSync.tsx:93-156`; `app/api/user/sync/route.ts:26-84` | P1 F4 | Covered |
| CL #4 | Client | Any failed `/api/subscription` (a Neon cold start, a 500, or a 404 before sync finishes) is stored as `{entitled:false}`, and `useRequireSubscription` then redirects payi… | `lib/stores/useUserStore.ts:101-109`; `lib/hooks/useRequireSubscription.ts:91-112` | P1-11 ("unknown is not no"), F4 | Covered |
| CL #5 | Client | First-run race: when the persisted store is empty, `useRequireAuth` asks `/api/user/email` in parallel with `UserSync`'s create. | `lib/hooks/useRequireAuth.ts:84-132`; `UserSync.tsx:103` | P1 F4 viewer bootstrap | Covered |
| CL #6 | Client | The game page always spins up a Stockfish worker (7.3 MB WASM) through `useBotMove`, even for human-vs-human games and spectators. Practice mode runs two workers. | `app/game/[gameId]/GamePageContent.tsx:126-130`; `lib/hooks/useBotMove.ts:50-51,140-145` | P2 `EngineProvider` | Covered |
| CL #7 | Client | `GET /api/chess/game-by-ref/[ref]` is unauthenticated and returns the full `gameData` (move history) of any game. | `app/api/chess/game-by-ref/[gameReferenceId]/route.ts:5-97`; `GamePageContent.tsx:355,560,602` | P1 H4 | Covered |
| CL #8 | Client | Polling where the socket already exists. Matchmaking polls `match-status` every 1 s (3+ queries per poll). | `lib/hooks/useMatchmaking.ts:30,71-119`; `app/tournament/[tournamentReferenceId]/FindMatchButton.tsx:68-97` | P9, P12 | Covered |
| CL #9 | Client | `GamePageContent.tsx` is one 1,437-line component holding 37 `useState` hooks and 7 refs. | `GamePageContent.tsx:55-121,405-721,653-666,546-555`; `design-ref/project/v2/V3Game.dc.html` | P2 store + controllers | Covered |
| CL #10 | Client | The Geist font is never applied. `next/font/local` registers family `geistSans`, but 669 inline styles ask for `'Geist'`, so the app renders in the system sans-serif. | `app/layout.tsx:16-23` | P1 DS tokens, P11 | Covered |
| CL #11 | Client | The service worker runtime-caches `/api/*` GET responses (NetworkFirst, 24 h, 10 s timeout) and HTML pages. | `next.config.js:13-35`; `public/sw.js` | P1 H8; P11 per-user page caches (r2) | Covered |
| CL #12 | Client | Entitlement and user are persisted in localStorage and read during the first render. | `lib/stores/useUserStore.ts:150-156`; `app/pricing/PricingContent.tsx:108,180` | P1 §11 | Covered |
| Q SEC-04 | Quality/security | unauthenticated PII endpoints and user enumeration | `app/api/user/email/[email]/route.ts:6-62`; `app/api/user/[referenceId]/route.ts:6-55` | P1 H3 | Covered |
| Q SEC-05 | Quality/security | socket server `/internal/tournament-event` is public | `apps/web-socket/index.ts:42-74`; `deploy/oci/Caddyfile:7-9` | P1 H6 #5; HMAC from P2 (r2) | Was **partial**; completed in r2 |
| Q SEC-06 | Quality/security | socket identity is optional | `apps/web-socket/utils/socketAuth.ts:73`; `apps/web-socket/index.ts:79-89` | P1 H6 #2 | Covered |
| Q SEC-07 | Quality/security | bot games trust the browser for the bot's moves | `apps/web-socket/GameSession.ts:248`; `app/game/[gameId]/GamePageContent.tsx:773-784` | P2 server adjudication (§7.1.4) | Covered |
| Q SEC-08 | Quality/security | game data is public, though the decision is "private to players" | `app/api/chess/game-by-ref/[gameReferenceId]/route.ts:5-97`; `apps/web-socket/utils/apiClient.ts:40-48` | P1 H4 | Covered |
| Q SEC-09 | Quality/security | premium content scraping and unbounded list endpoints | `app/api/chess-positions/route.ts:5-58`; `app/api/legends/route.ts:9-21` | P1 H1 clamp; `EDGE_DOC_LIMIT` on until a Firewall rule exists (r2); P8 CDN | Was **partial**; completed in r2 |
| Q SEC-10 | Quality/security | `PERF_AUTH_BYPASS` is a full impersonation switch with no production guard | `lib/auth/resolve-user.ts:82-89`; `lib/auth/require-subscription.ts:41` | P1 H9 | Covered |
| Q PLAT-01 | Quality/security | Vercel Hobby is non-commercial | — | P13 D17 (Pro) | Covered |
| Q PERF-01 | Quality/security | Geist is never applied, and 134 KB of fonts are preloaded unused | `app/layout.tsx:16-23`; `app/error.tsx:89,119` | P1 DS tokens, P11 | Covered |
| Q PERF-02 | Quality/security | heavy first-load JS | `app/layout.tsx:155` | blocking bundle budgets from P1; every phase | Was **partial**; completed in r2 |
| Q PERF-03 | Quality/security | authentication and data waterfall on every app page | `app/game/[gameId]/page.tsx:1-25`; `app/analysis/[gameId]/page.tsx` | P1 F4 | Covered |
| Q PERF-04 | Quality/security | realtime over serverless | `apps/web-socket/utils/apiClient.ts:75`; `app/api/chess/move/route.ts:73-86` | P2 | Covered |
| Q A-01 | Quality/security | text contrast fails WCAG AA | — | P1 tokens (contrast unit test) | Covered |
| Q A-02 | Quality/security | the board can't be used without a mouse or sight | `app/components/ChessBoard.tsx:441` | P2 keyboard board | Covered |
| Q B-01 | Quality/security | Lint is broken and enforces nothing; CI runs no lint | `eslint.config.mjs`; `package.json` | P1 CI | Covered |
| Q T-01 | Quality/security | No quality gate: CI runs no lint, type-check or unit tests, and nothing at all on `dev` | `.github/workflows/e2e-tests.yml:3-8` | P1 CI (`ci.yml`, `nightly.yml`) | Covered |
| Q T-02 | Quality/security | The risky code (API authz, matchmaking, socket server) has no tests | — | every phase §12; shared tools in P1 | Covered |
| Q Q-01 | Quality/security | Component complexity (`GamePageContent.tsx` 1,437 lines, 37 `useState`) | `app/game/[gameId]/GamePageContent.tsx` | P2 | Covered |

## 5. Medium findings

| ID | Area | Finding | Evidence | Fix (phase) | Status |
|---|---|---|---|---|---|
| API F-23 | API routes | Identity is resolved three different ways; email linking is unchecked | `resolve-user.ts:103`; `get-session-user.ts:8-13` | P1 `getViewer()` + Clerk webhook | Planned |
| API F-25 | API routes | Non-timing-safe secret comparisons | `lib/auth/api-key.ts:40`; `tournament/[ref]/route.ts:130` | P1 H9 | Planned |
| API F-26 | API routes | Any member can create tournaments | `tournament/create/route.ts:24-26`; `chess-com-profile/route.ts:108-113` | P12 (admin-only creation) | Planned |
| API F-27 | API routes | Chess.com handle claimed without proof, under a unique constraint | `chess-com-profile/route.ts:108-113`; `schema.prisma:132` | P4 (verified ownership) | Planned |
| API F-14 | API routes | Malformed JSON returns 500 | `checkout/route.ts:34-39`; `cancel/route.ts:35-43` | P1 route wrapper | Planned |
| API F-16 | API routes | Missing or weak validation | `chess-positions/route.ts:10-11`; `tournament/route.ts:8, 16` | P1 wrapper zod; P2 `TimeControl` | Planned |
| API F-15 | API routes | Five incompatible error shapes | `create-match-request/route.ts:63-77`; `cancel-match-request/route.ts:47-60` | P1 envelope + `codes.ts` | Planned |
| API F-17 | API routes | Sequential awaits that could be parallel or merged | — | P1 `getViewer()`; each phase §9.2 | Planned |
| API F-18 | API routes | Over-fetching | `move/route.ts:38-44`; `game-over/route.ts:68-73` | P8 catalogue selects; P1 explicit `select` | Planned |
| API F-19 | API routes | Unbounded or unpaginated lists | `position-selector.ts:36-59`; `tournament.service.ts:55-67` | P3 cursor pagination; P8 catalogue | Planned |
| API F-20 | API routes | No HTTP caching anywhere | `next.config.js:101-177`; `app/openings/page.tsx:9` | P1 cache tiers; P8 ISR | Planned |
| API F-21 | API routes | Rate limiting is effectively absent | `lib/rate-limit.ts:13-37`; `openings/route.ts:7, 19` | P1 fixed-window limiter (durable long windows) | Planned |
| API F-22 | API routes | GETs with side effects | `tournament.service.ts:75-98` | P1 GET purity; P9/P12 delete polling routes | Planned |
| API F-31 | API routes | Cold start and bundle weight | `lib/prisma.ts`; `prisma/schema.prisma:1-5` | P1 (blocking bundle budgets, SDK placement) | Planned |
| API F-24 | API routes | Tournament service correctness | `create/route.ts:66-90`; `join/route.ts:37-69` | P12 | Planned |
| API F-28 | API routes | Two definitions of bullet, blitz and rapid | `create-ai-game/route.ts:47-63, 163-164`; `lib/services/matchmaking/types.ts:70-75` | P2 `game-core` time-control classifier | Planned |
| API F-29 | API routes |  | `schema.prisma:75, 90-94` | P2/P3 migrations (`migrate deploy`, never `db push`) | Planned |
| API F-30 | API routes | Billing and audit gaps | `entitlement-rules.ts:159` | P1 F4b compare-and-set; P4 `AuditLog` | Planned |
| DB-11 | Database | `tryFindMatch` and tournament `find-match` call the global `prisma` inside an interactive transaction (`matchmaking.service.ts:219-226` → `position-selector.ts:23,36,75,8… | `matchmaking.service.ts:219-226`; `position-selector.ts:23,36,75,85,122` | P9, P12 (`tx` passed explicitly) | Planned |
| DB-12 | Database | Join, cancel and matchmaking all have check-then-act races (§8). There is no partial unique index for "one SEARCHING entry per user" | — | P2 atomic joins; P9 queue in memory | Planned |
| DB-13 | Database | There are 14 duplicate indexes (each `@unique` is repeated as a `@@index`) and 8 low-value single-column indexes. They add write and storage cost with no read benefit | — | P2 contract step C1 (owner confirmation) | Planned |
| DB-14 | Database | The opening sitemap selects the full `explanation` JSON for all 3,641 openings only to test whether it is null (`apps/web/app/sitemap-openings.xml/route.ts:9-13`). | `apps/web/app/sitemap-openings.xml/route.ts:9-13`; `apps/web/app/api/chess-positions/route.ts:10-11,31-60` | P8 (explanations to R2) | Planned |
| DB-15 | Database | Public catalogue pages are `force-dynamic` (`apps/web/app/legends/page.tsx:7`, `apps/web/app/openings/page.tsx:9`), and detail pages query twice without caching (layout a… | `apps/web/app/legends/page.tsx:7`; `apps/web/app/openings/page.tsx:9` | P8 ISR | Planned |
| DB-16 | Database | There is no sweeper. Expired `WAITING_FOR_OPPONENT` games, abandoned `IN_PROGRESS` AI games and old `matchmaking_queue` rows live forever. | `apps/web/lib/auth/resolve-user.ts:21-25` | P2 sweeps; P3 `HOUSEKEEPING` | Planned |
| DB-17 | Database | `statement_timeout = 0`, a 5-minute idle-in-transaction timeout, and a single owner role used at runtime | — | P1 `replay_app`; P2 `replay_realtime`; P3 `replay_worker` | Planned |
| WS F-15 | Socket server | Spectating open to everyone | `index.ts:158-184` | P2 spectate rules (members, watchable games) | Planned |
| WS F-16 | Socket server | Shutdown neither flushes nor closes sockets; Spot code dead | `index.ts:367-385` | P2 drain + `stop_grace_period` | Planned |
| WS F-18 | Socket server | Per-move HTTP with full verbose history | §6.1 | P2 checkpoints | Planned |
| WS F-19 | Socket server | Every join waits on Vercel (`fetchGameByRef`), even for in-memory sessions | `GameManager.ts:42,82` | P2 (in-memory sessions; direct load) | Planned |
| WS F-20 | Socket server | Free-text errors; ids leaked | `GameSession.ts:139` | P1 H7; P2 ack codes | Planned |
| WS F-21 | Socket server | No validation or rate limits | `index.ts` | P2 zod + rate limits | Planned |
| WS F-22 | Socket server | AI path: duplicate emits to the same socket; client authority | `GameSession.ts:275-289,832-839,371-380` | P2 (AI path deleted) | Planned |
| WS F-24 | Socket server | Matchmaking 1 s polling; tournament pairing 2-4 s polling; `emitMatchFound` dead | `useMatchmaking.ts:30,119`; `FindMatchButton.tsx:68-95` | P9, P12 | Planned |
| WS F-25 | Socket server | Lobby events → full refetch per client | `useTournamentLobby.ts:137-141` | P12 deltas | Planned |
| WS F-26 | Socket server | Draw offers stateless, no expiry or rate limit | `GameSession.ts:467-513` | P2 `draw:*` with cooldown | Planned |
| WS F-28 | Socket server | Default ping 25 s / 20 s | `index.ts:83-89` | P2 ping 10 s / 8 s | Planned |
| WS F-30 | Socket server | Observability gaps | §13 | P2 metrics | Planned |
| WS F-32 | Socket server | Secret reuse; no `env` claim | §12 S6 | P2 `SOCKET_TOKEN_SECRET` + `env` claim | Planned |
| WS F-34 | Socket server | 0 tests; production tsconfig `strict: false` | `tsconfig.production.json:14` | P2 tests + strict tsconfig | Planned |
| WS F-37 | Socket server | Client: no reconnect UI, DB re-hydration, extra fetches | §15 C5-C7 | P2 client store + reconnect UI | Planned |
| CL #13 | Client | There is no data layer: 73 hand-written `fetch` + `useState` sites, no dedupe, no cache, no abort (races in the leaderboard search, the tournaments tabs and `PositionPage… | — | P1 `api()` + TanStack | Planned |
| CL #14 | Client | Gated pages render on the client behind 2–3 spinners in a row: route `loading.tsx`, then the page gate spinner, then a component spinner. | `app/game/[gameId]/loading.tsx`; `game/[gameId]/page.tsx:12-23` | P1 `(app)` layout + skeletons | Planned |
| CL #15 | Client | Third-party weight on every page: PostHog (≈109 kB gz), Sentry with Replay and `tracesSampleRate: 1`, GA, Vercel Analytics, Speed Insights and clerk-js (90 KB), all loade… | `instrumentation-client.ts:8-48`; `app/layout.tsx:156-158` | P1 (Sentry sampling); P11 consent | Planned |
| Q SEC-11 | Quality/security | no durable rate limiting | `lib/rate-limit.ts:13-37`; `app/api/openings/route.ts:7,19` | P1 fixed window; durable long windows (r2) | Planned |
| Q SEC-12 | Quality/security | internal error details leak to clients | `app/api/chess/move/route.ts:124`; `app/api/user/sync/route.ts:200` | P1 H7 | Planned |
| Q SEC-13 | Quality/security | no Content-Security-Policy | `next.config.js:101-130`; `lib/seo.ts:6-8` | P1 report-only CSP; enforce behind `csp-enforce` (P13) | Planned |
| Q SEC-14 | Quality/security | open image optimizer | `next.config.js:72-79`; `UserSync.tsx:70-77` | P1 image allowlist | Planned |
| Q SEC-15 | Quality/security | service worker caches authenticated API responses | `UserSync.tsx:70-77`; `lib/auth/get-session-user.ts:4-13` | P1 H8; P11 | Planned |
| Q SEC-16 | Quality/security | two ways to identify the user | `lib/auth/get-session-user.ts:4-13`; `lib/auth/resolve-user.ts:100-103` | P1 `getViewer()` | Planned |
| Q SEC-17 | Quality/security | check-then-act races | `app/api/chess/join/route.ts:34`; `user/sync/route.ts:87-100` | P1 H2, P2, P9, P12 | Planned |
| Q SEC-18 | Quality/security | billing webhook hardening | `app/api/webhook/dodo-payments/route.ts:34`; `lib/billing/entitlement-rules.ts:135-158` | P1 webhook hardening (catalogue check, CAS) | Planned |
| Q PERF-05 | Quality/security | catalogue SSR without caching | `app/openings/page.tsx:9`; `app/legends/page.tsx:7` | P8 ISR | Planned |
| Q PERF-06 | Quality/security | unbounded and expensive queries | `app/api/openings/route.ts:26-34`; `app/openings/page.tsx:25-31` | P1 clamps; P8 catalogue | Planned |
| Q PERF-07 | Quality/security | board rendering cost and sizing | `app/components/ChessBoard.tsx:441-460` | P2 board | Planned |
| Q PERF-08 | Quality/security | observability overhead | `instrumentation-client.ts:17`; `sentry.server.config.ts:13` | P1 (sampling, tunnel excluded from middleware) | Planned |
| Q PERF-09 | Quality/security | media | — | P1 media clean-up; P11 | Planned |
| Q A-03 | Quality/security | dialogs lack semantics | `app/profile/[referenceId]/MembershipModal.tsx`; `app/components/AnalysisMoveList.tsx:235,396` | P1 UI kit dialogs | Planned |
| Q A-04 | Quality/security | clickable non-buttons | `app/components/AnalysisMoveList.tsx:235,396`; `app/components/SearchableDropdown.tsx:250` | P1 UI kit | Planned |
| Q A-05 | Quality/security | zoom, motion and focus | — | P1 (zoom, motion, focus rules) | Planned |
| Q B-03 | Quality/security | `turbo.json` `globalEnv` misses `NEXT_PUBLIC_*` and 24 undeclared env uses; `PERF_AUTH_BYPASS` sits in it | `turbo.json:4` | P1 `turbo.json` | Planned |
| Q T-03 | Quality/security | E2E reality gap: desktop-only, paywall off | `.github/workflows/e2e-tests.yml:57,79` | P1 (paywall on, device matrix) | Planned |
| Q Q-02 | Quality/security | API layer inconsistency (five error shapes, three identity paths) | — | P1 | Planned |
| Q Q-03 | Quality/security | Duplication (time control classes, position-info builders, loggers) | — | P1–P3 | Planned |
| Q Q-04 | Quality/security | Styling and design-system drift (891 inline font styles) | `app/layout.tsx:16-23` | P1, P11 | Planned |
| Q Q-05 | Quality/security | Dead code, unused exports, unused dependencies, dead assets | — | P1 and each parity deletion | Planned |

## 6. Low findings

| ID | Area | Finding | Evidence | Fix (phase) | Status |
|---|---|---|---|---|---|
| API F-37 | API routes | Stats streaks are a read-modify-write | `game-over/route.ts:208-238`; `checkout/route.ts:34-39` | P2 finish CTE | Planned |
| API F-36 | API routes | `console.*` bypasses the logger | `checkout/route.ts:70, 138, 173`; `chess-position.service.ts:103, 119` | P1 logger | Planned |
| API F-38 | API routes | The beacon cancel hides failures | `matchmaking/cancel-beacon/route.ts:46-50`; `user/sync/route.ts:26-27, 71-84` | P9 (queue on the socket) | Planned |
| API F-35 | API routes | The analysis payload is rebuilt every time | `analysis/route.ts:95-129` | P3 packed `GameAnalysis` | Planned |
| API F-34 | API routes | Position page waterfall and double fetch | `create/route.ts:66-90`; `join/route.ts:37-69` | P8 | Planned |
| API F-41 | API routes | Vercel Hobby plan as host for a paid product | `create/route.ts:66-90`; `join/route.ts:37-69` | P13 D17 (Pro before charging) | Planned |
| API F-32 | API routes | Duplicated logic (count: 9 clusters) | `lib/logger.ts`; `lib/sentry/logger.ts` | P1–P3 as files are touched | Planned |
| API F-33 | API routes | Dead code and dead endpoints | `lib/services/user-validation.service.ts`; `matchmaking.service.ts:12, 38-40` | P1 and each phase's parity deletion | Planned |
| API F-39 | API routes | `onboarding-skip` uses two queries where one would do | `profile/route.ts:37-39`; `schema.prisma:75, 90-94` | P4 | Planned |
| API F-40 | API routes | Inactive users answer 400 instead of 404 | `profile/route.ts:37-39`; `schema.prisma:75, 90-94` | P1 (`not_found` for inactive users) | Planned |
| DB-18 | Database | `games.chessPositionId` has an index but no FK (`schema:75`; dev probe). | `schema:75`; `implementation-plan.md:121` | P2 FK `NOT VALID`; P3 `openings.epd` | Planned |
| WS F-27 | Socket server | Multi-tab: last socket wins silently | `GameSession.ts:586-604` | P2 multi-tab rooms | Planned |
| WS F-29 | Socket server | WAITING sessions never expire in memory | `GameManager.ts` | P2 | Planned |
| WS F-31 | Socket server | Hand-copied types; duplicated token verifier | `lib/types/socket-events.ts`; `lib/socket-token.ts` | P2 `CT/socket/*` | Planned |
| WS F-33 | Socket server | CORS `"*"` fallback; upgrade not origin-checked | `index.ts:79-89` | P1/P2 `ALLOWED_ORIGINS` fail closed | Planned |
| WS F-35 | Socket server | Legacy deploy artefacts | `apps/web-socket/deploy/*`, `docker-compose.yml` | P2 (delete `WS/deploy/*`) | Planned |
| WS F-36 | Socket server | Study time 15/20/30 s by time control; no "I'm ready" | `GameSession.ts:851-856` | P2 study phase | Planned |
| WS F-39 | Socket server | `startGame` re-entry and timer overwrite | `GameSession.ts:192,862-895` | P2 | Planned |
| WS F-40 | Socket server | Per-game long Sentry trace; trace headers public | `game-by-ref/route.ts:79` | P1 H7; P2 tracing | Planned |
| WS F-41 | Socket server | Env var name drift (`NEXT_PUBLIC_WS_URL` vs `…WEBSOCKET_URL`) | §14 | P1 (`NEXT_PUBLIC_WEBSOCKET_URL`) | Planned |
| CL L1 | Client | `useState<Chess>(new Chess())` builds a chess instance on every render (`GamePageContent.tsx:55`). Use the lazy initializer. | `GamePageContent.tsx:55` | P2 (game screen rewrite) | Planned |
| CL L2 | Client | 123 manual `useCallback`/`useMemo` calls under React Compiler. Remove them while splitting components (the compiler handles memoization; | `GamePageContent.tsx:405-721` | P2 (game screen rewrite) | Planned |
| CL L3 | Client | `useExplanationPlayer` creates `new Audio(url)` with `preload='auto'` on mount even when the user never plays it (`lib/hooks/useExplanationPlayer.ts:1… | `lib/hooks/useExplanationPlayer.ts:150-151` | P3/P8 (review and lessons) | Planned |
| CL L4 | Client | `useDataStore` is re-exported from the `lib/stores` barrel that `UserSync` imports (`lib/stores/index.ts:4`), so the persisted catalogue (*estimate* ~… | `lib/stores/index.ts:4` | P1 data layer | Planned |
| CL L5 | Client | `fetchUserByEmail` and `fetchSubscription` share one `isSyncing` flag (`useUserStore.ts:99,113`). | `useUserStore.ts:99,113` | P1 data layer | Planned |
| CL L6 | Client | `AnalysisPageContent` autoplays narration after 2 s on the first visit (`:226-233`); browsers without a prior gesture reject it silently. | — | P3/P8 (review and lessons) | Planned |
| CL L7 | Client | Game over during the study phase: one more `game-by-ref` call just to route back (`GamePageContent.tsx:559-573`). | `GamePageContent.tsx:559-573` | P2 (game screen rewrite) | Planned |
| CL L8 | Client | `loading.tsx` spinners (`game`, `analysis`, `profile`) and the page spinners use different styles (h-8 border-2 vs w-10 border). | — | P1 UI kit | Planned |
| Q SEC-19 | Quality/security | no CSRF Origin check on route handlers | `api/matchmaking/cancel-beacon/route.ts:25-36`; `lib/auth/api-key.ts:40` | P1 middleware (`Sec-Fetch-Site: same-origin`) | Planned |
| Q SEC-20 | Quality/security | secret comparisons and test-only endpoints | `lib/auth/api-key.ts:40`; `app/api/tournament/[ref]/route.ts:129-131` | P1 timing-safe compares; test-hook registry | Planned |
| Q SEC-21 | Quality/security | input bounds and Chess.com handles | `chess/create-ai-game/route.ts:17-18`; `chess/create-game/route.ts:15-16` | P1 zod bounds; P4 handle validation | Planned |
| Q SEC-22 | Quality/security | telemetry before consent, PII to Sentry | `instrumentation-client.ts:31`; `sentry.server.config.ts:20` | P1 Sentry PII off; P11 consent | Planned |
| Q PERF-10 | Quality/security | duplicate client fetches | — | P2 | Planned |
| Q PERF-11 | Quality/security | build and install time | — | P1 install filter | Planned |

## 7. The same defect, found by several audits

| Defect | IDs | One fix |
|---|---|---|
| Admin content writes have no auth | API F-01, CL #1, Q SEC-01 | P1 H1 `requireAdmin()`; P12 `/api/admin/*` through `route()` |
| Any signed-in user can end or rewrite any game | API F-02, WS F-05, Q SEC-02, DB-04 | P1 H2 internal-only + conditional transition; P2 finish CTE; routes removed in P2 |
| PII by email or ref, account enumeration | API F-03, DB-08, CL #2, Q SEC-04 | P1 H3; the routes are deleted (F4d) |
| Any game's full data is public | API F-04, CL #7, Q SEC-08 | P1 H4 invite projection; P2 role-aware snapshot |
| Socket `/internal/tournament-event` is public | API F-10, WS F-06, Q SEC-05 | P1 H6 #5; HMAC + Caddy allow-list and unsigned pre-check from P2 |
| `PERF_AUTH_BYPASS` has no production fence | API F-11, Q SEC-10, Q B-03 | P1 H9; `isNonProd() && ALLOW_TEST_HOOKS` (never `VERCEL_ENV`) |
| Errors swallowed or leaked; Sentry PII and 100 % traces | API F-05, API F-12, API F-13, Q SEC-12, Q SEC-22, WS F-20, WS F-40 | P1 H7 |
| Boot-time third-party calls and writes | API F-07, DB-06, CL #3, CL #5, Q PERF-03 | P1 F4 (`getViewer()`, `GET /api/me`, Clerk webhook); GETs DB-only |
| Polling where a socket exists | API F-08, DB-05, CL #8, WS F-24, WS F-25 | P9 queue on the socket; P12 arena deltas |
| Moves as a JSON blob over per-move HTTP; final move lost | API F-09, DB-03, WS F-07, WS F-18, Q PERF-04 | P2: packed `moves`, checkpoints and one finish CTE, direct to Neon (B4) |
| Read-then-write races | API F-06, DB-12, Q SEC-17, WS F-01 | conditional updates and unique keys in P1 H2, P2, P9, P12 |
| No durable rate limiting | API F-21, Q SEC-11 | P1 fixed-window limiter; durable long windows |
| Restart resets games; colours not persisted | WS F-03, WS F-04, WS F-16 | P1 H6 #11–#13; P2 journal, restore, drain, `whitePlayerId` |
| Stockfish on the 1-OCPU socket box | WS F-38 | dev: `cpu.idle` slice, 0.75 cap, lag pause; prod: own worker VM (P13 D7) |
| Hobby is non-commercial | API F-41, Q PLAT-01 | P13 D17 Pro before the first charge |
| Geist never applied; design-system drift | CL #10, Q PERF-01, Q Q-04 | P1 DS tokens; P11 |
| Service worker caches authenticated `/api/*` | CL #11, Q SEC-15 | P1 H8 `NetworkOnly`; P11 per-user page caches |
| Dev shares production's Neon compute; no backups | DB-01, DB-02 | P1 1B·H10 and 1B·H11 |
| Dead code and duplicated logic | API F-32, API F-33, Q Q-03, Q Q-05 | removed as each phase touches the files and at each parity deletion |
| No tests or gates on the risky code | Q T-01, Q T-02, Q T-03, Q B-01, WS F-34 | P1 CI and the shared test tools (`01-architecture.md` §5) |

## 8. Keep / rework / remove (verbatim from each audit)

Each audit closes with a per-file verdict. They are reproduced here unchanged so this file is the one place to look; where a verdict mentions revision 1 names (`MoveEval`, `/api/games/[ref]/review`, `GameMove`, internal live-game routes, `db push`), read it through `01-architecture.md` §0.3: packed `GameAnalysis`, `/api/review/[ref]`, packed `Game.moves`, direct socket writes, and `migrate deploy`.

### 8.1 API routes (audit-api §9)

| File | Verdict | Why / target |
|---|---|---|
| `app/api/analysis/[gameId]/route.ts` | **Rework** | Becomes `GET /api/games/[ref]/review` reading `GameAnalysis`/`MoveEval`; keep its participant check and 404 masking |
| `app/api/checkout/route.ts` | **Keep** | `findUnique`, logger, email from the DB; best-practice zod and 409 codes |
| `app/api/customer-portal/route.ts` | **Rework** (small) | `POST /api/billing/portal` → `{url}` |
| `app/api/subscription/route.ts` | **Rework** | DB-first; Dodo only on explicit refresh; write only on change |
| `app/api/subscription/cancel/route.ts` | **Keep** | Model route; adopt the envelope |
| `app/api/subscription/resume/route.ts` | **Keep** | — |
| `app/api/subscription/change-plan/route.ts` | **Keep** | — |
| `app/api/subscription/change-plan/preview/route.ts` | **Keep** | — |
| `app/api/webhook/dodo-payments/route.ts` | **Keep + extend** | `BillingEvent` log, Clerk metadata sync, normalised-email match |
| `app/api/user/sync/route.ts` | **Remove** | Clerk webhook + `GET /api/me` |
| `app/api/user/email/[email]/route.ts` | **Remove** | PII and enumeration; replaced by `/api/me` |
| `app/api/user/[referenceId]/route.ts` | **Remove** | Dead, leaks PII |
| `app/api/user/onboarding-skip/route.ts` | **Remove** | `PATCH /api/me` (no skippable plan step in paid-only) |
| `app/api/user/chess-com-profile/route.ts` | **Rework** | `POST /api/accounts/chesscom` + import enqueue; drop handle uniqueness |
| `app/api/user/chess-com-profile/preview/route.ts` | **Rework** | Encode, timeout, cache, rate limit |
| `app/api/profile/[referenceId]/route.ts` | **Rework** | `/api/players/[ref]` + paginated games; privacy |
| `app/api/socket-token/route.ts` | **Keep** | Optionally claims-based (no DB) |
| `app/api/chess/create-game/route.ts` | **Rework** | Merge into `POST /api/games` |
| `app/api/chess/create-ai-game/route.ts` | **Rework** | Merge into `POST /api/games {mode:"bot", elo}` |
| `app/api/chess/join/route.ts` | **Rework** | Atomic join → `POST /api/games/[ref]/join` |
| `app/api/chess/cancel-game/route.ts` | **Rework** | Atomic → `DELETE /api/games/[ref]` |
| `app/api/chess/game-by-ref/[gameReferenceId]/route.ts` | **Rework** | Split internal and browser; role projection |
| `app/api/chess/move/route.ts` | **Remove** (after step 5) | The socket server writes `GameMove` directly |
| `app/api/chess/game-state/route.ts` | **Remove** (after step 5) | The socket server writes clocks directly |
| `app/api/chess/game-over/route.ts` | **Rework → internal**, then **remove** | Internal-only now; later the socket server writes it in a transaction and enqueues analysis |
| `app/api/matchmaking/create-match-request/route.ts` | **Remove** (after step 6) | Socket `queue:join` |
| `app/api/matchmaking/match-status/route.ts` | **Remove** (after step 6) | Socket push |
| `app/api/matchmaking/cancel-match-request/route.ts` | **Remove** (after step 6) | Socket `queue:leave` / disconnect |
| `app/api/matchmaking/cancel-beacon/route.ts` | **Remove** (after step 6) | Socket disconnect |
| `app/api/matchmaking/cleanup/route.ts` | **Remove** | Dead |
| `app/api/tournament/route.ts` | **Rework** | Validated filters, cursor, cache |
| `app/api/tournament/[tournamentReferenceId]/route.ts` (GET) | **Rework** | Pure GET; snapshot + standings pagination |
| `app/api/tournament/[tournamentReferenceId]/route.ts` (DELETE) | **Keep** (non-prod only) | E2E cleanup |
| `app/api/tournament/create/route.ts` | **Rework** | Role decision, nested create; move to `/api/admin/tournaments` if admin-only |
| `app/api/tournament/join/route.ts` | **Rework** | Atomic capacity, `ON CONFLICT` |
| `app/api/tournament/start/route.ts` | **Keep** (atomic fix) | — |
| `app/api/tournament/end/route.ts` | **Keep** | — |
| `app/api/tournament/find-match/route.ts` | **Remove** (after step 6) | Socket arena pairing |
| `app/api/tournament/cancel-search/route.ts` | **Remove** (after step 6) | Socket |
| `app/api/legends/route.ts` | **Keep** (cache) | → `/api/catalog/legends`, T0 |
| `app/api/legends/search/route.ts` | **Rework** | Admin, narrow select, `take 10` |
| `app/api/legends/create/route.ts` | **Rework** | `/api/admin/legends`, admin + audit |
| `app/api/legends/[id]/route.ts` | **Rework** | Admin; referenceId only; soft delete |
| `app/api/chess-positions/route.ts` | **Rework** | Admin; bounded cursor; select |
| `app/api/chess-positions/[id]/route.ts` | **Rework** | Admin; validate before read; soft delete |
| `app/api/chess-positions/create/route.ts` | **Rework** | Admin; share `upsertPosition()` with the scraper |
| `app/api/chess-positions/featured/route.ts` | **Remove** | Dead |
| `app/api/openings/route.ts` | **Rework** | Public T0 JSON, no auth, no in-memory limiter |
| `app/api/position/[referenceId]/route.ts` | **Rework** | Server props; or public T0 |
| `app/api/scraper/positions/import/route.ts` | **Keep** (harden) | Timing-safe key, batch |
| `app/api/healthcheck/route.ts` | **Rework** | `/api/health` with a DB probe |
| `app/sitemap-openings.xml/route.ts` | **Rework** (tiny) | Drop the `explanation` JSON select |
| `app/sitemap-legends.xml/route.ts` | **Keep** | — |
| `app/blog/rss.xml/route.ts` | **Keep** | — |
| `middleware.ts` | **Rework** | Add entitled-claim paywall for app pages (plan §1.2); still no DB |
| `lib/auth/resolve-user.ts` | **Rework** | Fold into `getViewer()`; fence the perf bypass |
| `lib/auth/require-subscription.ts` | **Keep** (absorbed) | Becomes `auth: "member"` |
| `lib/auth/get-session-user.ts` | **Remove** | Replaced by `getViewer()` (googleId) |
| `lib/auth/require-admin.ts` | **Rework** | `auth: "admin"` via `getViewer()` |
| `lib/auth/api-key.ts` | **Rework** | Timing-safe |
| `lib/rate-limit.ts` | **Replace** | Postgres token bucket |
| `lib/logger.ts` | **Rework** | `captureException` |
| `lib/sentry/logger.ts` | **Remove** | Duplicate |
| `lib/billing/*` | **Keep** | Tested, pure-rules pattern to copy |
| `lib/chess-com.ts` | **Rework** | Encode, timeout, ETag; archives for Phase 4 |
| `lib/services/chess-position.service.ts` | **Rework** | Single random-pick implementation; logger |
| `lib/services/matchmaking/*` | **Move** to `apps/web-socket` | Keep the `SKIP LOCKED` SQL |
| `lib/services/tournament/tournament.service.ts` | **Rework** | Deterministic rank, transaction-aware, socket-owned lifecycle |
| `lib/services/tournament/notify-websocket.ts` | **Rework**, then shrink | HMAC + `after()` |
| `lib/services/user-validation.service.ts` | **Remove** | Dead |
| `lib/services/opening.service.ts` | **Keep** | — |
| `lib/featured-positions.ts` | **Keep** | Used by the landing page directly if needed |
| `lib/socket-token.ts` | **Keep** → `packages/shared` | Single implementation for web and the socket server |

Tally over the 50 API route files:
- **Keep:** 11 (checkout, 4 subscription action routes, webhook, socket-token, tournament start and end, legends list, scraper import);
- **Rework:** 25;
- **Remove:** 14 (user/sync, user/email, user/[ref], onboarding-skip, move, game-state, 4 matchmaking polling routes, matchmaking/cleanup, featured, tournament find-match, tournament cancel-search).

`chess/game-over` is counted as rework now, then removed. `tournament/[ref]` is counted once, under rework.

### 8.2 Database (audit-db §17)

| Item | Decision | Reason |
|---|---|---|
| `User` identity and billing fields | **Keep** | Sound. Entitlement logic is centralised and unit-tested |
| `User.dateOfBirth` | Remove (later) | Never written; leaked by DB-08 routes |
| `User.googleId` name | Keep the column; map it as `clerkUserId` in Prisma | A rename would break things for no gain |
| `Game` table | **Rework** (additive columns, §11.1) | Becomes the record for REPLAY, CHESSCOM and LICHESS games |
| `Game.gameData` | **Rework** into typed columns + a small `options` | Quadratic writes, lost moves, unqueryable |
| `gameData.moveHistory` / `traceContext` | **Remove** | Replaced by `moves` and `moveClocksMs`; trace headers are not data |
| `creatorId`/`opponentId` colour convention | Rework → `whiteUserId`/`blackUserId` + `GamePlayer` | Imported games, explicit colour, no OR queries |
| `GameResult` enum | Keep for legacy; add `GameOutcome` + `GameEndReason` | Threefold and fifty-move are mislabelled today |
| `UserStats` | **Rework, then remove** | Derive from `GamePlayer`; the bot hot row |
| `ChessComProfile` | **Rework** → `ExternalAccount` | Unverified unique handle; no Lichess; 26 rating columns |
| `ChessPosition` | Keep | Legend positions; move `explanation` to R2 |
| `Legend` | Keep | |
| `Opening` | Keep, add `epd` | Needed for BOOK classification |
| `explanation` JSON columns | Rework → R2 URL + `hasExplanation` | Egress and payload size |
| `MatchmakingQueue` + `/api/matchmaking/*` (5 routes) | **Remove** after the socket queue | 1 s polling, compute and races |
| `Tournament` | Keep; creator FK → SET NULL | |
| `TournamentParticipant` | Keep; fix indexes, `searchingSince` and the pairing race; move pairing to the socket | |
| `/api/chess/move` and `/api/chess/game-state` | Remove / replace with internal checkpoint | §7.2 |
| `/api/chess/game-over` | Keep, internal-only, idempotent | DB-04 |
| `/api/chess/game-by-ref` | Rework: internal token or participant only | Privacy |
| `/api/user/email/[email]`, `/api/user/[referenceId]` | **Remove** → `/api/me` | DB-08 |
| `/api/chess-positions` (GET list) | Rework: admin-only, `limit ≤ 50`, no blobs | DB-14 |
| `/api/analysis/[gameId]` | Replace with `/api/review/:ref` | 4 round trips; parses PGN each call |
| `lib/prisma.ts` singleton | Keep; add global `omit`, URL params, drop the musl target | |
| `lib/rate-limit.ts` (in-memory) | Keep for per-instance abuse only; coach cap goes in `coach_usage_days` | Not shared across instances |
| `prisma/seed.ts` demo user | Remove | `/try` is gone |
| `prisma/opening-seed.ts` | Keep | Idempotent through `skipDuplicates` |
| 14 duplicate + 8 low-value indexes | **Remove** | §13.1 |
| Migrations 1-17 | Keep as history; never edit | |
| "`db push` on prod" rule (CLAUDE.md item 1, `implementation-plan.md:94`) | **Rework** → `migrate deploy` only | §4.2; owner sign-off |
| Planned per-ply `MoveEval` (`implementation-plan.md:101-104`) | **Rework** → packed `GameAnalysis` + `GamePlayer` aggregates + `Mistake` | 14× smaller; one read per Review |
| Planned 1M-row `LichessPuzzle` (`implementation-plan.md:155`) | **Rework** → R2 shards (or a ≤150k compact table) | ~350 MB of the 1 GB cap |
| Planned eval cache by FEN in Postgres | **Rework** → worker local disk | Free, no egress |
| Planned job polling (`implementation-plan.md:110`) | Rework → push wake-up + SKIP LOCKED drain | Scale to zero |

### 8.3 Socket server (audit-socket §24)

| Item | Verdict | Why / how |
|---|---|---|
| socket.io 4.8 + Express on an OCI A1 box via GHCR + Docker + Caddy (`deploy-oci.yml`, `deploy/oci/*`) | **keep** | Free, simple, fast enough (§11). Add a drain step and `stop_grace_period` |
| Server-authoritative chess.js validation | **keep** | Correct model; moves into `packages/game-core` |
| HMAC socket token + `useSocketToken` refresh-on-reconnect + `retryOnUnauthorized` | **keep** | Good design. Separate secret, add claims, make it mandatory |
| `GameSession` (1,113 lines) | **rework** | Becomes a thin I/O shell over the core reducer: phases, presence, draws, rematch, end methods |
| `ClockManager` | **rework** | ms, one timeout, monotonic, lag credit; no per-second emits |
| `GameManager` | **rework** | Rooms, multi-tab, eviction on every end, boot restore, no Vercel call on joins to existing sessions |
| `utils/apiClient.ts` | **rework** | Outbox, timeouts, retries, v2 internal routes |
| `index.ts` handlers | **rework** | zod validation, acks, rate limits, `/internal/*` auth, `/ready`, `/internal/drain`, `/internal/notify` |
| `TournamentManager` | **rework** | Delta events, user-room pairing push; drop dead `emitMatchFound` |
| `types.ts` + `apps/web/lib/types/socket-events.ts` | **rework** | Replace with `packages/game-protocol` |
| `utils/socketAuth.ts` + `apps/web/lib/socket-token.ts` | **rework** | One shared package; separate secret; `env`/`ent`/`kid` claims |
| `instrument.ts`, `utils/sentry.ts`, `utils/logger.ts` | **rework** | 10% sampling, PII off, new metrics, structured logs; drop 5 unused helpers |
| Spectator snapshot concept | **keep** | Becomes the general `Snapshot` used by players too |
| Study phase ("analysis phase") | **rework** | `studySeconds` per game + `game.ready`; renamed STUDY |
| `GamePageContent.tsx` socket code | **rework** | `useGameSocket`, `useClock`, outbox, premove; snapshot-only history |
| Client rematch via `create-game` | **remove** | Replaced by the socket rematch (§17.9.8) |
| `hydrateFromDb` on reconnect | **remove** | Snapshot carries the move list |
| Web routes `/api/chess/move`, `/game-over`, `/game-state` | **rework → remove** | P0: internal-only. v2: replaced by idempotent `/api/internal/live-games/*` |
| Public `GET /api/chess/game-by-ref` | **rework** | Participant-only, minimal fields; the socket uses the internal record |
| `gameData.moveHistory` JSON blob writes | **remove** | `GameMove` rows (§18.2) |
| AI/bot path inside the socket server | **remove** | Bot games run client-side (§17.11) |
| `spotInterruption.ts` + `flushAllGames` Spot wiring | **remove** | AWS-only; replaced by drain |
| Per-second `clock_update` and `analysis_tick` | **remove** | `at`-stamped clocks and `endsAt` |
| `waiting_for_opponent`, `server_restarting`, `game_started` reconnect overload, string `error` events | **remove** | Replaced by `game.snapshot`, `game.phase`, `server.restarting`, error codes |
| Per-game Sentry `continueTrace` from creation (`traceContext.ts`, `gameData.traceContext`) | **remove** | Long traces, public leak |
| Legacy `apps/web-socket/deploy/*`, `apps/web-socket/docker-compose.yml`, `deploy/SPOT_MIGRATION.md` | **remove** | Not used by the OCI deploy |
| 12 dead functions (§1.2) | **remove** | Unused |
| Matchmaking 1 s polling, tournament find-match 2-4 s polling | **rework** | `user.notify` push with a 5 s fallback poll |
| k6 socket-io lib + `ws-*` scenarios | **keep** | Point at the dev OCI box; record the results |

### 8.4 Client (audit-client §16)

| Item | Verdict | Why / target |
|---|---|---|
| `middleware.ts` (Clerk) | **rework** | invert to a public allowlist; read the member claim from the session; exclude `monitoring`, `workers` |
| `ThemeAwareClerkProvider` (client wrapper) | **rework** | server `ClerkProvider` in the root layout with appearance from the `next-themes` cookie, or keep the wrapper but pass `initialState` |
| `UserSync.tsx` + `POST /api/user/sync` | **remove** | Clerk webhook + `getViewer()` |
| `GET /api/user/email/[email]` | **remove** | PII leak; no remaining callers after §11.2 |
| `lib/hooks/useRequireAuth.ts`, `useRequireSubscription.ts` | **remove** | server gate in `(app)/layout.tsx` |
| `lib/stores/useUserStore.ts` (persisted) | **remove** | `ViewerProvider` + `qk.viewer()` |
| `lib/stores/useDataStore.ts` (persisted catalogues) | **remove** | `qk.catalog.*` with a 24 h staleTime |
| `lib/billing/client.ts` helpers (`paywallUrl`, `stripCheckoutParams`, `checkoutReturnPath`, `isEntitledClient`) | **keep** (move into `lib/api` + billing feature) | well tested (`lib/billing/*.test.ts`) |
| `waitForEntitlement` polling | **rework** | refresh once + socket event + 3 fallback polls, in one `CheckoutActivating` screen |
| `app/components/billing/useCheckout.ts` | **keep, adapt** | wrap in `useMutation`; same 409 handling |
| `GET /api/subscription` read-through to Dodo | **rework** | DB read only; Dodo only in webhook and refresh |
| `lib/hooks/useSocketToken.ts` | **keep, simplify** | token comes from the layout; keep `socketAuth` refresh and `retryOnUnauthorized`; clear at sign-out |
| socket client in `GamePageContent.tsx` | **rework** | `RealtimeProvider` + `useGameSocket` + `gameMachine` |
| `lib/hooks/useTournamentLobby.ts` | **rework** | snapshot + deltas into `qk.tournament(ref)` |
| `lib/types/socket-events.ts` | **rework** | move to `packages/protocol` (zod, shared with `apps/web-socket`) |
| `lib/hooks/useMatchmaking.ts` + `/api/matchmaking/match-status` polling | **remove** | socket queue (`queue_join`, `match_found`) |
| `FindMatchButton` polling | **remove** | `match_found` to `user:{ref}` |
| `lib/hooks/useStockfish.ts` | **keep, rework** | becomes the worker inside `EngineProvider` (queue with request ids, ready promise, rAF-throttled info) |
| `lib/hooks/useBotMove.ts` | **rework** | engine injected (no internal engine), no `legalMoves[0]` fallback; later the bot runs server-side |
| `lib/hooks/useMultiPvAnalysis.ts` | **keep, throttle** | Practice and the Review engine panel |
| `lib/hooks/usePlayFromPosition.ts` | **keep, fix** | remove the double engine |
| `lib/hooks/useAnalysisBoard.ts`, `useExplanationPlayer.ts` | **keep** | legend compare and narration (plan Phase 8); `preload='metadata'` |
| `lib/hooks/useChessSound.ts` | **keep, rework** | app-level singleton, preload on first gesture, prefs from `rc:prefs:v1` |
| `lib/hooks/usePWAInstall.ts` | **keep** | `V3PwaInstall` |
| `lib/hooks/usePWAUpdate.ts` + `PWAUpdateBanner` | **rework** | wire to `V3PwaUpdate` with the in-game deferral; today it is unused |
| next-pwa config (`aggressiveFrontEndNavCaching`, default runtime caching) | **rework** | `/api` NetworkOnly, small precache, offline page, cache purge at sign-out |
| `app/game/[gameId]/GamePageContent.tsx` | **rework (split)** | plan Phase 2 file list (§11.6) |
| `app/analysis/[gameId]/*` | **rework → `/review/[gameId]`** | keep `PracticeView`, `NarrationDisplay`, `SegmentList`, `EvalBar`, `MultiPvDisplay` as parts |
| `GET /api/analysis/[gameId]` | **rework** | compact columnar review DTO, one query with includes, no duplicate PGN |
| `GET /api/chess/game-by-ref` | **rework** | public invite preview + participant-only snapshot over the socket |
| `app/play/page.tsx`, `app/queue/page.tsx` | **rework** | Play hub and Queue designs on the new data layer |
| `app/profile/[referenceId]/page.tsx` (client) | **rework** | server-rendered profile; `MembershipSection` moves to `/settings/membership` |
| `MembershipSection.tsx` logic (`viewFromStore`, actions, preview) | **keep the logic, rework the UI** | 12 `V4Membership` states |
| `app/onboarding/page.tsx` | **rework** | 8-step server-tracked flow |
| `app/pricing/PricingContent.tsx` | **keep the marketing view, rework** | server decides the subscriber branch; activation moves to `/checkout/return` |
| `ChessBoard.tsx` | **rework** | CSS-variable sizing (DS "one viewport" rule 1, `ds/project/README.md:52`), SVG pieces, dynamic game-over effects |
| `GameEndEffects.tsx` | **keep, lazy-load** | `next/dynamic` on game over only |
| `instrumentation-client.ts` (Sentry + PostHog) | **rework** | sampling, lazy Replay, consent-gated PostHog |
| `GoogleAnalytics.tsx` | **remove** (or consent-gate) | duplicate of PostHog |
| `@vercel/analytics`, `@vercel/speed-insights` | **keep** (Speed Insights); **decide** on Analytics vs PostHog | |
| `lib/metrics.ts` `trackApiResponseTime` | **remove** | Sentry spans cover it |
| `DirectoryBadges` in `Footer` | **rework** | move to `/press` or lazy outside the marquee |
| `next.config.js` `images.remotePatterns: '**'` | **rework** | allowlist |
| Fonts in `app/layout.tsx` + 816 inline `fontFamily` styles | **rework** | woff2, `@theme` font tokens, no inline font styles |
| `/openings` and `/legends` `force-dynamic` | **rework** | ISR, paginated catalogue |
| Dead code: `Testimonials`, `ColorSelector`, `DifficultySelector`, `QueueTimeout`, `isDemo` branches, `/try` comments | **remove** | |
| Admin pages (`app/admin/*`) | **keep, rework later** | add `requireAdmin()` to their APIs **now** (critical) |
| `lib/socket-token.ts` signing | **keep** | used for the layout-embedded token |
| Optimistic move pattern (`GamePageContent.tsx:239-259, 499-544`) | **keep the idea, rework** | `clientMoveId` + ack/reject |

### 8.5 Code quality and build (audit-quality §11)

| Item | Decision | Why / how |
|---|---|---|
| `lib/billing/*` (rules, entitlement, trial, subscription actions, copy, return URL) + 7 test files | **Keep** | Best-tested code in the repo. Add the catalog check, the period-end guard and the webhook event log (SEC-18); rename plan `"player"` → `"coaching"` |
| `app/api/webhook/dodo-payments/route.ts` | **Keep, harden** | SEC-18 |
| `app/api/checkout`, `customer-portal`, `subscription/*` | **Keep, rework** | Move to `defineRoute`; `/api/subscription` reads the DB and refreshes from Dodo only when stale (PERF-03) |
| `lib/socket-token.ts` + `apps/web-socket/utils/socketAuth.ts` | **Rework** | Merge into `packages/contracts`; token always required (SEC-06) |
| `lib/auth/resolve-user.ts`, `require-subscription.ts`, `require-admin.ts`, `get-session-user.ts`, `api-key.ts` | **Rework** | Collapse into `defineRoute` auth modes; drop the email-based lookup; prod guard on the perf bypass |
| `lib/rate-limit.ts` (in-memory) | **Remove → replace** | Postgres token bucket plus the Vercel Firewall (SEC-11) |
| `middleware.ts` | **Rework** | Default-deny `/api`, admin/internal prefixes, Origin check, exclude `/monitoring`, member redirect from the session claim (plan §1.2) |
| `api/chess-positions/*`, `api/legends/*` (writes) | **Rework** | Move under `/api/admin/*` with `requireAdmin` (SEC-01) |
| `api/user/email/[email]`, `api/user/[referenceId]` | **Remove** | Replace with `/api/me` (SEC-04) |
| `api/user/sync` + `UserSync.tsx` | **Rework** | Clerk webhook upsert; client component only for sign-out cleanup |
| `api/chess/move`, `game-state`, `game-over` | **Rework → internal**, then **remove** | Internal-only now (SEC-02); later the socket server writes Neon directly (PERF-04) |
| `api/chess/game-by-ref` | **Rework** | Split internal / participant / invite (SEC-08) |
| `api/chess/create-game`, `create-ai-game`, `join`, `cancel-game` | **Keep, rework** | Bounds, atomic join, seeded bot user; AI moves server-side (SEC-07) |
| `api/matchmaking/*`, `lib/services/matchmaking/*` | **Keep, rework** | Good row locking; switch polling to socket push; add tests |
| `api/tournament/*`, `lib/services/tournament/*` | **Keep, rework** | In the v3/v4 designs; authenticated WS notify (SEC-05); E2E cleanup only off-prod |
| `api/analysis/[gameId]` + `app/analysis/[gameId]/*` | **Remove at Phase 3** | Replaced by `/review/[gameId]` and server analysis; keep the legend-compare logic (`parsePgnFromMoveNumber`, `:95-130`) |
| `api/scraper/positions/import` | **Keep** | Constant-time key compare |
| `apps/web-socket` core (`GameSession`, `GameManager`, `ClockManager`, `TournamentManager`) | **Keep, rework** | Authoritative chess.js is right; add the DB writer, server bot, zod payloads and tests; add `threefold`/`fifty_move`/`abort` (plan Phase 2) |
| `apps/web-socket/spotInterruption.ts` | **Remove** | EC2-only, dead on OCI |
| `app/game/[gameId]/GamePageContent.tsx` | **Rework (split)** | §4.2 |
| `app/components/ChessBoard.tsx` | **Rework (rewrite)** | PERF-07, A-02; keep the `ResizeObserver` arrow overlay and the drag threshold logic |
| `lib/hooks/useStockfish.ts`, `useMultiPvAnalysis.ts`, `public/workers/stockfish-18-lite-single.*` | **Keep** | Client-side "try a line" analysis and practice; the server worker does the full review |
| `lib/hooks/useExplanationPlayer.ts` + explanation components | **Keep** | Legend narration stays (plan Phase 7); fix the `segments` dependency warning |
| `app/admin/*` | **Rework** | V4Admin* rebuild; shared table and form |
| `app/profile/[referenceId]/MembershipSection.tsx` (1,069 lines) | **Rework** | Becomes Settings › Membership states (Phase 9) |
| Catalogue pages (`/openings`, `/legends`, `/learn`, `/blog`) | **Keep, rework** | ISR, `cache()`, server search (PERF-05/06) |
| `next.config.js` PWA block | **Keep, rework** | `NetworkOnly` for `/api`, mount the update prompt, or drop aggressive navigation caching |
| `next.config.js` images `hostname: "**"` | **Rework** | Allowlist (SEC-14) |
| Security headers | **Keep, extend** | CSP (Report-Only first), `poweredByHeader: false` |
| Sentry config | **Keep, tune** | Sampling, `sendDefaultPii: false`, lazy Replay |
| PostHog, Vercel Analytics, Speed Insights | **Keep** (behind consent) | — |
| Google Analytics (`GoogleAnalytics.tsx`) | **Remove** | Duplicates PostHog; another pre-consent tracker |
| ESLint config (`only-warn`, no ignores, `next lint`) | **Rework** | B-01 |
| `.github/workflows/e2e-tests.yml` | **Keep, rework** | Run on `dev` too, paywall on, device projects; separate DB branch |
| `.github/workflows/deploy-oci.yml` | **Keep** | Gate on `ci.yml` |
| `.github/workflows/perf-tests.yml`, `perf/k6` | **Keep** | Add coach SSE and analysis-job scenarios (plan Phase 10) |
| `.github/workflows/indexnow.yml` | **Keep** | — |
| Unit tests (12 files) | **Keep** | Run in CI |
| `k8s/` (incl. a committed secret), root `docker-compose.yml`, `apps/web/Dockerfile` | **Remove** (keep a web Dockerfile only if PLAT-01 picks self-hosting) | SEC-03 |
| `packages/ui` (empty) | **Remove**, or fill with the DS components | §3.4 |
| `components/ui/button.tsx`, `label.tsx` + `@radix-ui/react-slot`, `@radix-ui/react-label`, `class-variance-authority` | **Remove**, or adopt as the Phase 1 base | Unreferenced today |
| `ColorSelector`, `DifficultySelector`, `Testimonials`, `ChessComRatings`, `user-validation.service`, `lib/types/index.ts` | **Remove** | Unreferenced (§4.4) |
| `PWAUpdateBanner` + `usePWAUpdate` | **Rework (mount)**, or remove with aggressive caching | §3.3 |
| `isDemo` paths (12 refs) | **Remove** | `/try` is gone |
| `botid`, `stockfish` (npm) deps | **Remove** | 0 imports |
| `public/chess_logo_share.png`, `public/mobile_icon_perfect.png` | **Remove** | Unused, 7.3 MB |
| `public/rohit-pandit.jpeg` | **Rework** | Compress to < 30 KB |
| `public/board_icons` | **Keep (decide the set)** | The user's own icons; ship only the rendered sizes |
| Two loggers | **Rework** | Keep `lib/logger.ts` |
| Schema redundant indexes (14) | **Remove** | DB-01, with explicit confirmation per CLAUDE.md |
| `Game` cascade deletes, missing `chessPosition` relation | **Rework** | DB-02/03 |
| Inline `fontFamily` (891) and `text-[Npx]` (256) | **Rework (codemod)** | PERF-01, A-05 |
| `--cb-text-muted` / `--cb-text-faint` as text colours | **Rework** | A-01, in the DS token port |
| Root clutter (`test-mx-auto.html`, `reddit_post.txt`, `intro_content.md`, `important_commands.md`, `directory-submission-kit.md`, `TODO.md`) | **Remove** or move to `docs/` | Public repo hygiene |

## 9. Findings by the phase that fixes them

A finding appears under every phase its fix names; the hotfix lane (P1 H1–H11) ships first.

| Phase | Findings |
|---|---|
| P1 | API F-01, API F-02, API F-03, API F-04, API F-10, API F-11, API F-23, API F-25, API F-06, API F-14, API F-16, API F-15, API F-12, API F-05, API F-13, API F-36, API F-07, API F-17, API F-18, API F-20, API F-21, API F-22, API F-31, API F-32, API F-33, API F-40, API F-30, DB-01, DB-02, DB-03, DB-04, DB-06, DB-07, DB-08, DB-17, WS F-01, WS F-02, WS F-03, WS F-04, WS F-05, WS F-06, WS F-07, WS F-08, WS F-09, WS F-10, WS F-11, WS F-17, WS F-20, WS F-33, WS F-40, WS F-41, CL #1, CL #2, CL #3, CL #4, CL #5, CL #7, CL #10, CL #11, CL #12, CL #13, CL #14, CL #15, CL L4, CL L5, CL L8, Q SEC-01, Q SEC-02, Q SEC-03, Q SEC-04, Q SEC-05, Q SEC-06, Q SEC-08, Q SEC-09, Q SEC-10, Q SEC-11, Q SEC-12, Q SEC-13, Q SEC-14, Q SEC-15, Q SEC-16, Q SEC-17, Q SEC-18, Q SEC-19, Q SEC-20, Q SEC-21, Q SEC-22, Q PERF-01, Q PERF-02, Q PERF-03, Q PERF-06, Q PERF-08, Q PERF-09, Q PERF-11, Q A-01, Q A-03, Q A-04, Q A-05, Q B-01, Q B-03, Q T-01, Q T-02, Q T-03, Q Q-02, Q Q-03, Q Q-04, Q Q-05 |
| P2 | API F-02, API F-04, API F-10, API F-06, API F-09, API F-37, API F-16, API F-28, API F-29, DB-03, DB-04, DB-12, DB-13, DB-16, DB-17, DB-18, WS F-01, WS F-02, WS F-03, WS F-04, WS F-06, WS F-07, WS F-08, WS F-09, WS F-11, WS F-12, WS F-13, WS F-14, WS F-15, WS F-16, WS F-18, WS F-19, WS F-20, WS F-21, WS F-22, WS F-23, WS F-26, WS F-27, WS F-28, WS F-29, WS F-30, WS F-31, WS F-32, WS F-33, WS F-34, WS F-35, WS F-36, WS F-37, WS F-39, WS F-40, CL #6, CL #9, CL L1, CL L2, CL L7, Q SEC-05, Q SEC-07, Q SEC-17, Q PERF-04, Q PERF-07, Q PERF-10, Q A-02, Q Q-01 |
| P3 | API F-19, API F-35, API F-32, API F-29, DB-10, DB-16, DB-17, DB-18, WS F-38, CL L3, CL L6, Q Q-03 |
| P4 | API F-27, API F-39, API F-30, Q SEC-21 |
| P5 | DB-10 |
| P8 | API F-18, API F-19, API F-20, API F-34, DB-14, DB-15, CL L3, CL L6, Q SEC-09, Q PERF-05, Q PERF-06 |
| P9 | API F-06, API F-38, API F-08, API F-22, DB-05, DB-11, DB-12, WS F-24, CL #8, Q SEC-17 |
| P10 | DB-09 |
| P11 | CL #10, CL #11, CL #15, Q SEC-15, Q SEC-22, Q PERF-01, Q PERF-09, Q Q-04 |
| P12 | API F-01, API F-26, API F-06, API F-08, API F-22, API F-24, DB-05, DB-11, WS F-24, WS F-25, CL #8, Q SEC-17 |
| P13 | API F-41, DB-02, WS F-17, WS F-38, Q SEC-13, Q PLAT-01 |

## 10. Sources and dispositions

| Input | Used for |
|---|---|
| `SP/plan/audit-api.md` (41 findings, §8 fix order, §9 verdicts) | §3–§6, §8.1 |
| `SP/plan/audit-db.md` (DB-01…DB-18, §17 verdicts) | §3–§6, §8.2 |
| `SP/plan/audit-socket.md` (§16 register F-01…F-41, §24 verdicts) | §3–§6, §8.3 |
| `SP/plan/audit-client.md` (§1 top 15, §15 smaller items, §16 verdicts) | §3–§6, §8.4 |
| `SP/plan/audit-quality.md` (SEC, PERF, A, PLAT, B, T, Q findings; §11 verdicts) | §3–§6, §8.5 |
| `SP/plan/inv-code.md` | not produced; nothing to merge |
| `SP/plan/critique-api-perf.md` §3 (cross-check of every critical and high finding) | the Status column and §2 |
| `SP/plan/critique-feasibility.md` §5 (SEC-1…SEC-10) | §2 (repo leak, `CLAUDE.md`, dev gate) |

**Correction to audit-api §8 step 9:** schema hygiene ships as migration files applied with `prisma migrate deploy`, never with `prisma db push` (CR-35; `db push` would drop the hand-written partial indexes).
