# API design and catalogue: Replay Chess coaching rebuild

Status: **final plan, revision 2**, 2026-11-02 · branch `dev` (HEAD `0848b76`, Phase 0 done). Revision 2 applies every finding about this file in the five critiques (`SP/plan/critique-{coverage,consistency,feasibility,testing,api-perf}.md`); dispositions are in Appendix E.

**Precedence (revision 2).** Where allocation B1–B26, `01-architecture.md` §0.3 (the canonical names) or an owning phase spec decides an API name or contract, **that wins over this document**. From P1 on, the endpoint registry in `@repo/contracts/registry` (`CT/http/registry/<area>.ts`) is the source of truth, and §4 is regenerated from it. The tables below are the catalogue the phases build from; a phase spec's §7 is authoritative for its own routes.

**What revision 2 changed (summary).**
1. **Live-game writes go from the socket server to Neon directly** (B4); the `/api/internal/live-games/*` routes are withdrawn. Only tournament pairing, start, finalize and the schedule sync remain web internal routes (P12 D12-4), and the schedule sync never polls (§4.14).
2. **Names:** review root `/api/review/[ref]/*`; accounts `/api/accounts/*`; imports `/api/import/*`; worker `apps/analysis-worker` with `/internal/analysis/kick` and `/engine/analyse`; socket rooms `game:`/`spectate:`/`user:`/`tournament:` and the P2 event registry (§6 now points to `CT/socket/registry.ts`).
3. **Error codes** follow the one ledger in `CT/http/codes.ts` (§2.6).
4. **Rate limits** are P1's fixed window; windows longer than 60 s are durable (§2.10).
5. **Internal auth** is HMAC from P2 with per-caller key ids and event allow-lists, under the env name `INTERNAL_API_SECRET` (§2.11.6).
6. **Caching** uses six named tiers; no per-user response has `max-age > 0`; public-plus-viewer routes split into a public path and a `no-store` `/me` path; sign-out clears the browser cache (§2.12).
7. **GETs never write or enqueue** except registered side effects; billing refresh is a POST (§2.2, §4.3, §4.7).
8. **No worker timers against Neon:** next-due job rows (§8.4).
9. **Coach charging and cancellation** follow P7 D5 and Vercel's `supportsCancellation` (§7.7, §7.8).
10. **Phase numbers** are the 13-phase plan; the crosswalk is in §10.

Paths are relative to `apps/web/` unless they start with `apps/`, `packages/`, `docs/` or `/`. `file:N` is a line number in today's code. Design boards are under `…/scratchpad/design-ref/project/v2/`. Inputs: `plan/audit-api.md` (AA), `audit-socket.md` (AS), `audit-db.md` (ADB), `audit-client.md` (AC), `audit-quality.md` (AQ), `inv-pub.md` (IP), `inv-play-a.md` (PA), `inv-play-b.md` (PB), `inv-rct-a.md` (RA), `inv-rct-b.md` (RB), `inv-acct.md` (IA), `inv-sys.md` (IS), `inv-research.md` (RS), `docs/implementation-plan.md` (PLAN).

Contents

- §0 Decisions, conflicts resolved, glossary
- §1 Topology: who talks to whom, and over what
- §2 Conventions (route handlers vs server actions, URLs, versioning, contracts package, route wrapper, errors, pagination, idempotency, concurrency, rate limits, auth helpers, caching, logging and tracing, OpenAPI)
- §3 How the UI talks to the API (client contract, per-screen data map; the full client design is `04-client-data-layer.md`)
- §4 Endpoint catalogue, every phase
- §5 Existing endpoints: keep, change, remove (all 57 handlers)
- §6 Socket protocol: pointer to `CT/socket/registry.ts` (P2) and the server authority rules
- §7 Streaming: the coach SSE endpoint
- §8 Webhooks and cron
- §9 Optimisation plan and budgets (details: `05-optimization.md`)
- §10 Build order (13 phases)
- §11 Open questions for the owner
- Appendices: A tables the API layer needs, B secrets and env vars, C inventory alias map, D test matrix, E critique dispositions

---

## 0. Decisions, conflicts resolved, glossary

### 0.1 The decisions this document makes

| # | Decision | Why |
|---|---|---|
| API-01 | **Route handlers for every mutation and every JSON read that a client fetches.** Server components read through the same service functions directly (never `fetch` their own API). Server actions are allowed only for pre-hydration forms, through a `defineAction` wrapper with the same guards (§2.1). | The socket server, worker, beacons, the service-worker outbox, k6 and Playwright all call HTTP. The 402/429 contract is fetch-based (`lib/billing/client.ts:120-133`). |
| API-02 | **No URL versioning.** Additive changes only; a breaking change ships a new path or field and keeps the old one for one release. The client build header **`x-rc-build`** lets the server answer `426 upgrade_required` to stale tabs. The socket protocol is versioned in the handshake (`proto: 2`). Internal bodies carry `v`. | First-party clients deploy with the API on Vercel; the only skew is open tabs, the PWA cache, and the separately deployed OCI services. |
| API-03 | **One contracts package, `packages/contracts` (`@repo/contracts`), zod 4**: `src/http/*` (from P1), `src/socket/*` and `src/internal/*` (from P2). HTTP schemas, the endpoint registry (`src/http/registry/<area>.ts`, one file per area), `codes.ts`, `limits.ts`, the envelope, socket schemas and rooms, internal bodies and the socket-token claims. Pure TypeScript, no Prisma. | AQ §10.2, AC §11.4, AS §17.1.7 and PA §4.2 each proposed a package; B17 merged them. |
| API-04 | **One route wrapper, `route()` in `apps/web/lib/api/route.ts`** (B18), for every new handler and every touched old one: auth context, zod input, body size, rate limit (`store: burst \| durable`), idempotency, error envelope, cache tier, `ctx.now`, registered GET side effects, request id, Sentry span (§2.5). | AA §7.1 and AQ §10.1 proposed the same thing under two names. |
| API-05 | **Error envelope `{ error: { code, message, details?, retryAfterSec?, requestId } }`** with the closed ledger in `CT/http/codes.ts`, each code bound to exactly one HTTP status. Success is `{ data, meta? }`. The 402 status stays, so `isSubscriptionRequiredResponse` keeps working (§2.6). | Five incompatible shapes today (AA F-15); 29 routes leak `error.message` (AC §6.2). |
| API-06 | **Cursor pagination** (keyset, opaque base64url), `limit` default 20–30, max 50 (admin 100). Counts only on page 1 or with `limit=0` (§2.7). | AA F-19; every list in the designs is an infinite list. |
| API-07 | **`Idempotency-Key` on every POST that creates something or moves money**, stored 24 h; natural keys (`clientAttemptId`, coach `clientId`) where they exist (§2.8). Dodo's checkout takes no idempotency key, so we guard it ourselves. | AA F-06, AQ, RB D4. |
| API-08 | **Rate limits in three layers:** Vercel Firewall per IP at the edge (3 rules on Hobby) with P1's in-isolate `EDGE_DOC_LIMIT` on until a rule exists; P1's **fixed-window** limiter in Postgres for per-user limits on expensive endpoints only (`burst` store for windows ≤ 60 s, `durable` for longer); in-memory buckets on the single socket server. Coach fair use is a quota (`CT/limits.ts`), not a rate limiter (§2.10). | `lib/rate-limit.ts` is per instance (AA F-21); Neon empties UNLOGGED tables at scale-to-zero (api-perf AP-11). |
| API-09 **(r2)** | **The live game never touches Vercel per move, and its writes never go through Vercel at all.** The socket server owns validation, clocks and the in-memory game and writes Neon directly through `DB/src/live/*` (≤ 10 checkpoints, one finish CTE; B4, P2 §6.6). Exception: tournament pairing, start and finalize go through signed web internal routes (P12 D12-4, §4.14). | B4 is binding; one CTE from Mumbai is one round trip, while an internal route would add an invocation and ~250 ms per call. |
| API-10 | **The analysis/import worker writes its own rows directly** to Neon (its own DB role; one HTTP batch per analysed game) and pushes progress through `/internal/emit`. It calls the web only for account-purge steps that need Clerk or Dodo and to revalidate tags. | High-volume writes; 200 ms Mumbai→us-east RTT. |
| API-11 | **Push, never poll.** Every progress signal is a socket event on a room. HTTP polling exists only as a fallback with ETag/304 and backoff, only in visible tabs, only while the socket is down, and it stops after a bound (§6). | AA F-08, AS F-24/F-25. |
| API-12 **(r2)** | **The coach streams SSE from a Vercel route handler** with `maxDuration = 60`, `supportsCancellation: true` in `vercel.json`, a 20 s first-sentence and 45 s total deadline, sentence-level verification, and P7 D5 charging (cost always recorded; a `done` answer counts against the quota; aborts and failures do not) (§7). | RA §2.4.5, RS §13.6, api-perf AP-02/AP-13. |
| API-13 **(r2)** | **Public catalogue data is CDN-cached with tags** (`Vercel-CDN-Cache-Control` + `Vercel-Cache-Tag`, purged with `invalidateByTag()`, or ISR + `revalidateTag` for pages). **Per-user data is `private, no-cache` + strong ETag or `no-store`, never `max-age > 0`**; downloads are `private, no-store` attachments (§2.12). | Shared devices: a long private `max-age` serves user A's data to user B with no auth check (api-perf AP-04). |
| API-14 | **Webhooks keep the existing prefix `/api/webhook/*`** (Dodo at `/api/webhook/dodo-payments`; Clerk at `/api/webhook/clerk`). Every webhook is deduplicated by its delivery id before any side effect (§8). | Avoids reconfiguring the Dodo dashboard. |
| API-15 | **One Vercel cron** (`/api/cron/daily`) for the daily backstops. Everything timed runs as future-dated job rows on the OCI worker, which sends no query while idle (§8.4). | Hobby crons run at most once a day; Neon compute hours. |
| API-16 **(r2)** | **Separate secrets per trust boundary**: `SOCKET_TOKEN_SECRET` (browser socket tokens), `INTERNAL_API_SECRET` (re-purposed as the HMAC **key set** for every internal hop, `kid:base64[,…]`), `CRON_SECRET`, `CLERK_WEBHOOK_SIGNING_SECRET`, `DODO_PAYMENTS_WEBHOOK_KEY`, `SIGNED_COOKIE_SECRET`, `HASH_PEPPER`, and `LINK_TOKEN_KEYS` only if a Lichess token is stored. | Today one secret signs user tokens and lets a server act as any user (`lib/socket-token.ts:5-13`, `lib/auth/resolve-user.ts:21-25`). Names: `01-architecture.md` CR-26. |
| API-17 | **Bot and legend-vs-engine games are client-run** and persisted with `POST /api/games`, rate-limited beacon checkpoints (`bot-checkpoint`, `moves ≤ 400`, suffix-only replay) and an idempotent `complete` that adjudicates server-side. They are unrated. | AS §17.11, PA §2.4, PB §3.3, api-perf AP-32. |
| API-18 | **Names are lowercase snake for codes and request-body enums; camelCase for JSON fields; kebab-case for URL segments** (§2.2). Socket events are `domain:event` (`move:applied`). | B20; CR-31. |

### 0.2 Glossary

| Term | Meaning |
|---|---|
| Viewer | The signed-in caller, loaded once per request by `getViewer()` (React `cache()`), by Clerk user id (`User.googleId`) |
| Member | `isEntitled(user)` true: active, trialing, cancelled-but-in-period, or in Dodo's grace window |
| Lapsed | Not entitled but had a trial or a plan; may get read-only reviews if the owner approves B26 (§11 Q1) |
| Player of a game | The viewer is the game's `whitePlayerId` or `blackPlayerId` (or has a `GamePlayer` row, for imported games) |
| ref | A `referenceId` (cuid). The only id that leaves the server. BigInt ids never do. |
| slug | A human URL key for public catalogue entities (legend, position, opening, tournament) |
| code | An 8-character Crockford base32 key for invites and shares |
| Cache tiers | `public-immutable`, `public-static`, `public-short`, `private-etag`, `no-store`, `sse` (§2.12). Revision 1's T0–T3/NS labels are retired |
| OCI | The Oracle Always-Free A1 VMs: socket server (`apps/web-socket`) and the analysis/import worker (`apps/analysis-worker`; prod on its own VM, P13 D7) |

### 0.3 Conflicts between the inputs and how they are resolved

The full name map is Appendix C. The material ones (revision 2 rulings in bold where they changed):

| Topic | Inputs | Resolution |
|---|---|---|
| Socket persistence | PA §2.1, AA §7.3: direct. AS §18, ADB §5.3, IA §1.4, revision 1: internal web routes | **Direct (B4)**, with the tournament exception (CR-17). Revision 1's INT-1…8 are withdrawn |
| Review API root | RA: `/api/review/:ref`. AA: `/api/games/[ref]/review`. Revision 1: `/api/review/{gameRef}` | **`/api/review/[ref]/*`** (B21); status `GET /api/review/[ref]/status`. The plural form is an alias for one release only if it ever shipped (it did not) |
| Train grading | several | RB's `POST /api/train/attempts` |
| Linked accounts | IP: `/api/accounts/*`. IA, revision 1: `/api/accounts/*` | **`/api/accounts/*`** (B10); Lichess OAuth at `/api/accounts/lichess/{start,callback}` (P4) |
| Import status | several; revision 1: `GET /api/me/imports` | **`/api/import/*`** (P4) |
| Bootstrap | IP, IA: `GET /api/me`. IS: `GET /api/me/shell` | One `GET /api/me` (§4.2); badge counts also have `GET /api/me/badges` |
| Preferences | several | One `GET/PATCH /api/me/preferences` (`PrefsData`, `PrefsPatchBody {patch, baseVersion}`; P9/P10) |
| Openings | several | `GET /api/openings?q&family&cursor` (public, `public-static`, no session read; P1 A4 → P8 CAT-3 shape) |
| Legend positions | PA, PB | `GET /api/positions?collection&theme&q&cursor` and `GET /api/positions/{slug}` |
| Reports | IA: `POST /api/reports`. RB: `POST /api/train/reports` | **One `POST /api/reports {targetType, targetRef, reason, …}`** owned by P5; P10 adds the `user` and `game` targets |
| Coach | several | RA's shape, plus `/api/coach/hint`, `GET /api/coach/messages/{ref}`, and **`POST /api/coach/messages/{ref}/stop`** (beacon) (§4.8, §7) |
| Membership view | IA: `GET /api/me/membership`. AC: `GET /api/billing/membership` | `GET /api/billing/membership` |
| Analysis progress channel | RA: a review room with its own token. Others: the user room | **`user:{ref}`** rooms (only players see a review). No room tokens |
| Socket token gating | PA: 402 for non-members. IP: any signed-in user. IA: `ent` claim | Any signed-in user gets a token with `ent` (entitled-until). The user room works for everyone; game, queue, tournament and spectate commands require `ent > now` |
| Error code casing | AS: `ILLEGAL`. PA: `illegal`. | Lowercase snake everywhere |
| Weakness path | AC/AA: `/api/weakness`. RB: `/api/train/weakness` | `/api/train/weakness` |
| Worker location | RA: same VM. AS F-38, PA: own instance | **Prod: own 2-OCPU VM (P13 D7); dev: co-located** (`01-architecture.md` §1.8). The worker's endpoints are reached through the socket box's Caddy over the VCN |
| Internal auth | revision 1: HMAC (`INTERNAL_API_SECRET`); P2 rev 1 / consistency R-08: static `x-internal-token` | **HMAC from P2 under `INTERNAL_API_SECRET` (key set)**, per-caller kids and allow-lists (CR-16) |

---

## 1. Topology: who talks to whom, and over what

### 1.1 Diagram

```
                    ┌────────────────────────── Browser (Next 15 app, React 19) ──────────────────────────┐
                    │  RSC pages (first paint)   api() + TanStack Query   RealtimeProvider (1 socket/tab)    │
                    │  SSE reader (coach)        IndexedDB outbox (train) sendBeacon (bot checkpoints)      │
                    └───────┬──────────────────────────┬──────────────────────────────┬──────────────────────┘
                 HTML/RSC   │ HTTPS JSON (same origin)  │ wss (socket.io v4, proto 2)  │ HTTPS (CDN)
                            ▼                           │                              ▼
   ┌──────────────── Vercel (Hobby, region iad1) ───────┴───┐            ┌──── Cloudflare R2 / Vercel CDN ────┐
   │ middleware (edge): Clerk session, request id,          │            │ puzzle shards, lesson audio, piece  │
   │   maintenance, public allowlist, CSRF origin           │            │ sprites, explanations, exports      │
   │ route handlers (node): /api/*  ── services ── Prisma ──┼──pooled──► Neon Postgres (us-east-1)         │
   │ /api/internal/* (HMAC)  /api/webhook/* /api/cron/daily │            └─────────────────────────────────────┘
   └───────▲───────────────────────────┬────────────────────┘                      ▲
           │ HMAC HTTPS (tournament    │ HMAC HTTPS: /internal/emit,               │ pooled, own roles:
           │ pairing/start/finalize)   │ /internal/analysis/kick, /engine/analyse   │ socket checkpoints + finish CTE (B4),
           │                           │                                            │ worker one batch per game
   ┌───────┴───────────────────────────▼───────── OCI ap-mumbai-1 (Always Free) ─────┴─────────────────────┐
   │ socket box (1 OCPU): Caddy ─► web-socket:3002 (games, queue, tournaments, user rooms, presence)       │
   │   (dev: the worker runs on this box too)  └──► private VCN ─► prod worker VM (2 OCPU, P13): :3003     │
   │                                              Stockfish 18 native, import queues, scheduler, push/email │
   └───────────────────────────────────────────────────────────────────────────────────────────────────────┘
   Third parties: Clerk (auth, webhooks), Dodo (checkout, portal, webhooks), Anthropic (coach), Chess.com and
   Lichess (import, from the worker only), PostHog (server events in after()), Sentry (all three tiers)
```

### 1.2 Links and their contracts

| From → to | Transport | Auth | Used for | Contract |
|---|---|---|---|---|
| Browser → Vercel pages | HTML/RSC | Clerk cookie | First paint of every screen | Server components call services (§2.1) |
| Browser → Vercel `/api/*` | HTTPS JSON | Clerk cookie (SameSite=Lax) + Origin check | Mutations, client re-reads, fallbacks | §4 |
| Browser → Vercel `/api/coach/messages` | HTTPS SSE (POST) | Clerk cookie | Coach answers | §7 |
| Browser → socket server | wss, socket.io 4.8 | HMAC socket token in handshake `auth` | Live games, queue, tournaments, user room | §6 |
| Socket server → Neon | Postgres (pooled, role `replay_realtime`) | DB role | Restore, checkpoints, the finish CTE, matchmaking and rematch creation (B4) | P2 §6.6 |
| Socket server → Vercel `/api/internal/tournaments/*` | HTTPS JSON | HMAC (kid `ws`) | Tournament pairing, start, finalize (P12 D12-4) | §4.14 |
| Vercel → socket server `/internal/emit` | HTTPS JSON | HMAC | Push to rooms after HTTP mutations and webhooks | §4.15 |
| Vercel → worker `/internal/analysis/kick`, `/engine/analyse` | HTTPS via the socket box's Caddy, then the private VCN | HMAC | Wake the queue after an enqueue; the coach's engine tool | §4.15 |
| Worker → Neon | Postgres (pooled `-pooler` host, role `replay_worker`) | DB role | Jobs (`FOR UPDATE SKIP LOCKED`), analysis rows, import rows | schema plan |
| Worker → socket server `/internal/emit` | HTTP over the private VCN | HMAC | `analysis:*`, `import:*`, `weakness:*`, `bank:due_changed`, `mistakes:added`, `review:text_ready` (kid `wk` allow-list) | §6 |
| Worker → Vercel `/api/internal/revalidate` | HTTPS | HMAC | Cache tags after tournament finalize or content scripts | §4.14 |
| Clerk / Dodo → Vercel `/api/webhook/*` | HTTPS | Svix / Standard Webhooks signatures | User lifecycle, billing | §8 |
| Vercel Cron → `/api/cron/daily` | HTTPS GET | `Authorization: Bearer $CRON_SECRET` | Daily jobs | §8.4 |
| GitHub Actions → socket server drain and broadcast | SSH + `docker compose exec` of the signing CLI (kid `ops`; the paths are blocked at Caddy) | HMAC | Deploy without breaking games | §6.10 |

Region: Vercel functions stay in **`iad1`**, next to Neon `aws-us-east-1` (CLAUDE.md: project `withered-cake-82837167`, AWS us-east-1). PA §2.5 proposed `bom1` next to OCI; that would put every Prisma query 200 ms away from the database, and the browser and Vercel traffic is far heavier than the socket→web traffic after API-09. Add `"regions": ["iad1"]` to the root `vercel.json` (it sets no region today) so the choice is explicit.

### 1.3 Code layout behind the API

```
packages/
  contracts/            @repo/contracts   zod schemas, endpoint registry, error codes, socket events, token claims
    src/http/           common.ts errors.ts envelope.ts cursor.ts  + one file per domain (me.ts games.ts reviews.ts …)
    src/socket/         events.ts (names) game.ts queue.ts tournament.ts user.ts errors.ts acks.ts
    src/internal/       auth.ts emit.ts jobs.ts (JOB payloads, kick body)
    src/auth/           socket-token-claims.ts (types + verify; sign is server-only: src/auth/sign.server.ts)
  game-core/            rules, state machine, clocks, end detection, PGN, legend path (AS §17.1, PA §2.1)
  chess-analysis/       Win%, accuracy, classification, key moments, verifier (RA §2.3)
  chess-training/       ts-fsrs wrapper, grade mapping, session builder rules (RB)
  db/                   Prisma schema + client, shared by apps/web and apps/analysis-worker (ADB §5)
  domain/               server-only use cases called by route handlers, internal routes and the worker:
                        games/finishLiveGame.ts, games/completeLocalGame.ts, tournaments/scoreGame.ts,
                        billing/applySnapshot.ts, accounts/deleteAccount.ts, …
apps/web/lib/api/       route.ts (defineRoute) action.ts (defineAction) respond.ts errors.ts idempotency.ts
                        rate-limit.ts cache.ts cursor.ts client.ts (browser api()) keys.ts (query keys)
apps/web/lib/auth/      viewer.ts guards.ts internal-hmac.ts cron.ts
apps/web/app/api/**     thin route files: one defineRoute per method, no business logic
```

Rule: a route file may import only `@repo/contracts`, `@/lib/api/*`, `@/lib/auth/*` and one `@repo/domain` or `@/lib/services/*` module. No Prisma calls in route files (lint rule `no-restricted-imports` on `@/lib/prisma` under `app/api/**`). That keeps the HTTP layer thin and lets RSC pages, internal routes and the worker reuse the same use case.

---

## 2. Conventions

### 2.1 Route handlers, server actions, and RSC services

| Use | Mechanism | Rule |
|---|---|---|
| First paint of any page | **Server component** calling a service (`lib/services/*`, `@repo/domain`) after `getViewer()` | Never `fetch('/api/…')` from the server. The page and its route handler share the service, so there is one code path and zero extra invocations. Seed TanStack Query with `HydrationBoundary` (AC §11.5). |
| Client reads after first paint (refetch on focus, filters, infinite lists, polling fallback) | **Route handler GET** | Pure (no writes, ever: AA F-22). Cache headers from the tier table. |
| Mutations from the browser | **Route handler POST/PATCH/PUT/DELETE** via `api()` | All of them, including settings and admin forms. Reasons: 402/429/401 global handling, idempotency headers, explicit status codes, callable from tests, k6 and the SW outbox. |
| Calls from OCI, webhooks, cron | Route handler | Always. |
| Streaming | Route handler returning a `ReadableStream` | Coach SSE only (§7). |
| Forms that must work before hydration | **Server action** through `defineAction()` | Allowed for: "Play this position" CTAs on static catalogue pages (PB A5's `startLegendPractice`), the contact form, and the onboarding step forms. `defineAction` runs the same auth, zod, rate-limit and idempotency logic and returns `ActionResult<T> = { ok: true, data } \| { ok: false, error: ErrorBody }`. It calls the same domain function as the route. No action is the only way to reach a capability: each has a route twin. |
| Webhooks | Route handler, signature first | §8 |

Every server action is also a POST function invocation on Vercel, so they save nothing on quotas; the point is progressive enhancement only.

### 2.2 URLs, ids, methods, status codes, JSON style

**Paths**

- `/api/<collection>/<key>/<sub-collection-or-action>`. Collections are plural nouns (`games`, `reviews`, `challenges`, `tournaments`, `players`, `positions`, `openings`, `legends`, `shares`, `shared-positions`). Multi-word segments are kebab-case (`linked-accounts`, `rating-history`, `deletion-preview`).
- Namespaces that are not resources: `me` (the viewer's own data), `train`, `learn`, `coach`, `billing`, `admin`, `internal`, `webhook`, `cron`, `oauth`, `system`.
- Actions that are not CRUD are a verb segment with POST: `/accept`, `/decline`, `/complete`, `/retry`, `/extend`, `/end`, `/sync`, `/verify`. One verb per path. No `?action=` query switches over HTTP (the socket uses `{action}` payloads because it has no paths).
- Keys: `ref` for private entities (games, threads, sessions, cards, runs), `slug` for public catalogue entities (`/api/positions/{slug}`, `/api/tournaments/{slug}`), `code` for invites and shares, `username` for players. A route accepts exactly one key kind; the legacy "referenceId or BigInt" fallbacks (`legends/[id]/route.ts:37-51`, AA F-32 item 7) are not carried over.
- Query parameters are camelCase. Booleans are `true`/`false`. Lists are comma-separated (`?status=live,upcoming`). Unknown query parameters are ignored, unknown body fields are rejected (`z.strictObject`) except in `PATCH /api/me/preferences`, which strips them.

**Methods**

| Method | Semantics |
|---|---|
| GET | Pure read. Cacheable per tier. Never writes, never enqueues, never calls a provider (today four GETs write: `match-status`, `tournament/[ref]`, `subscription`, `customer-portal`; all four are fixed in §5). The only allowed side effects are registered in the endpoint registry (`sideEffects: ["daily_plan" \| "legend_facts" \| "kick_cas"]`); in dev and test the wrapper throws on any other write from a GET. |
| POST | Create (201 + `Location`), start async work (202), or a verb action (200). |
| PATCH | Partial update, returns the updated resource. Deep merge only where documented (preferences). |
| PUT | Full replace of a small document (`/api/consent`). |
| DELETE | Idempotent: deleting a missing or already-deleted resource returns 204, unless the caller is not the owner (404). |

**Success statuses:** 200 (body `{ data }`), 201 (created, `Location` header, body `{ data }`), 202 (accepted async: body `{ data: { status, … } }`), 204 (no body), 304 (ETag hit). Errors in §2.6.

**JSON style**

| Thing | Rule | Example |
|---|---|---|
| Field names | camelCase | `analysisStatus` |
| Enums on the wire | lowercase snake; serialisers map Prisma's UPPER enums | `"in_progress"`, `"fifty_move"` |
| Times | ISO-8601 UTC with `Z` for instants; epoch ms only in socket payloads (`at`, `serverNow`) | `"2026-11-02T08:00:00.000Z"` |
| Durations | explicit unit suffix | `timeMs`, `retryAfterSec`, `initialSeconds` |
| Local days | `YYYY-MM-DD` in the viewer's timezone, field suffix `Key` | `dayKey` |
| Money | integer minor units + ISO currency | `{ priceCents: 499, currency: "USD" }` |
| Ids | string refs only; BigInt never serialised (the wrapper's serializer throws on BigInt) | `"cmvy5lged0001slshphrgntv9"` |
| Nullable | always present as `null` when not applicable (stable shapes for the client store) | `"trial": null` |
| Chess | FEN strings, UCI for machine moves (`e7e8q`), SAN for display; colour `"w" \| "b"` | `"bestUci": "f1f5"` |
| Packed arrays | allowed for large per-ply data (columnar review payload, RA A1) | `plies: { san: [...], cp: [...] }` |

### 2.3 Versioning

1. **Public HTTP API: unversioned, additive.** Allowed without notice: new endpoints, new optional request fields, new response fields, new error codes inside an existing status class, new enum values only where the contract marks the enum `open`. A breaking change ships as a new path or field, and the old one stays one release (≥ 14 days, because PWA tabs live that long).
2. **Client build skew.** `api()` sends `x-rc-build: <BUILD_ID>`. When `MIN_CLIENT_BUILD` (env, set only after a breaking change) is newer than the header, routes answer `426 upgrade_required`; the client shows `V3PwaUpdate` (deferred while a game is running). The SW `pwa_update` prompt already exists in the design (IS §2.7).
3. **Socket protocol.** Handshake `auth: { token, proto: 2, build }`. During rollout the server runs v1 and v2 handlers side by side behind `PROTOCOL_V1=on`; v1 goes after two weeks with no v1 joins (AS §22). An unsupported `proto` gets `connect_error { message: "upgrade_required" }`.
4. **Internal OCI↔web.** Every internal body carries `v: 1`. The receiver accepts `v` and `v-1`, because the socket server and the web deploy separately (`.github/workflows/deploy-oci.yml` vs Vercel). Deploy order for a breaking internal change: receiver first, sender second.
5. **Webhooks** are versioned by the providers; we pin parsers with zod `safeParse` and log unknown event types at `info`.
6. **Payload schema versions inside rows** (review payload `analysisVersion`, prefs `version`, weakness `algoVersion`) are part of the ETag, so a grading change invalidates client caches without a URL change.

### 2.4 The contracts package

```
packages/contracts/
  package.json   "name": "@repo/contracts", "type": "module", "sideEffects": false,
                 "exports": { "./http/*": "./src/http/*.ts", "./socket/*": "./src/socket/*.ts",
                              "./internal/*": "./src/internal/*.ts", "./auth/claims": "./src/auth/claims.ts",
                              "./auth/sign.server": "./src/auth/sign.server.ts", "./registry": "./src/http/registry.ts" }
  src/http/common.ts      Ref, Slug, Code, Username, Cursor, Limit, Fen, Uci, San, Color, TimeControl, IsoDate, DayKey
  src/http/codes.ts       ERROR_STATUS (code → one status), CONFLICT_REASONS, FORBIDDEN_REASONS, SUBSCRIPTION_REASONS
  src/http/envelope.ts    Ok<T>, Err, Paged<T>
  src/http/<domain>.ts    request + response schemas per endpoint, named <Verb><Resource>Body / …Query / …Data
  src/http/registry/<area>.ts  defineEndpoint({ id, method, path, auth, query, body, response, errors, cache, rateLimit, idempotent, sideEffects? })
  src/socket/*.ts         event name constants, payload schemas, ack schemas, error codes
  src/internal/*.ts       HMAC helper (auth.ts), internal bodies (emit, kick, tournaments), job payloads
  src/auth/claims.ts      SocketTokenClaims schema + verify (Web Crypto, works in Node and the browser test harness)
```

Shared primitives (excerpt):

```ts
// packages/contracts/src/http/common.ts
import { z } from "zod";
export const Ref = z.string().regex(/^c[a-z0-9]{20,31}$/);                 // cuid
export const Code = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{8}$/);           // Crockford base32
export const Slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(96);
export const Username = z.string().regex(/^[A-Za-z0-9_-]{3,25}$/);
export const Limit = (def = 20, max = 50) => z.coerce.number().int().min(1).max(max).default(def);
export const Cursor = z.string().max(256).regex(/^[A-Za-z0-9_-]+$/).optional();
export const Uci = z.string().regex(/^[a-h][1-8][a-h][1-8][qrbn]?$/);
export const Color = z.enum(["w", "b"]);
export const Fen = z.string().max(100).refine(isValidFen, "Not a legal position");  // chess.js validateFen + one king each
export const TimeControl = z.strictObject({ initialSeconds: z.number().int().min(15).max(10_800),
                                           incrementSeconds: z.number().int().min(0).max(180) }); // AA F-16
export const DayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
```

Rules:

- **One zod version** across the monorepo (4.x). The package has `zod` as a peer dependency.
- **Requests are always parsed on the server.** Responses are parsed on the server in development and test (`ROUTE_VALIDATE_RESPONSES=1`) so drift fails CI, and never in production (cost). In the browser, `api()` parses responses only in development; production uses the inferred types. Forms parse their own bodies client-side for inline errors.
- **Bundle discipline.** Client code imports per-domain subpaths (`@repo/contracts/http/train`), never a barrel. `Fen`'s refinement imports `chess.js` lazily only on the server; the client version is a cheap regex (`FenLoose`).
- **No Prisma types** in contracts. `packages/domain` maps rows to contract types (`toReviewData(row)`), and that mapping is the only place enum casing changes.
- Inventory types such as `lib/train/types.ts` (RB §4.3), `lib/contracts/*.ts` (IA §1.2) and `packages/game-core/src/protocol.ts` (PA §4.2) move into this package under the same names.

### 2.5 The route wrapper: `route()`

```ts
// apps/web/lib/api/route.ts (sketch)
export function defineRoute<Q, B, R>(spec: {
  id: string;                                   // registry id, e.g. "reviews.get"
  auth: "public" | "optional" | "user" | "member" | "member_or_lapsed_read" | "admin" | "internal" | "cron";
  params?: z.ZodType; query?: z.ZodType<Q>; body?: z.ZodType<B>;
  response?: z.ZodType<R>;                      // dev/test validation + OpenAPI
  maxBodyBytes?: number;                        // default 16 KB; coach 32 KB; train attempts 64 KB; admin uploads n/a
  rateLimit?: RateLimitSpec | RateLimitSpec[];  // §2.10
  idempotency?: "required" | "optional";        // §2.8
  cache?: CacheTier;                            // §2.12; default "no-store"
  maxDuration?: number;                         // exported separately as the segment config
  sample?: number;                              // Sentry trace sample rate override
}, handler: (ctx: { req: NextRequest; viewer: Viewer | null; params; query: Q; body: B;
                    requestId: string; after: typeof after }) => Promise<R | Response>) { … }
```

What it does, in order:

1. **Request id.** Read `x-request-id` (set by middleware, §2.11.4) or create one; echo it on the response.
2. **Auth context** (§2.11). `viewer` is loaded once through `getViewer()` (React `cache()`), so a route that also calls services does not re-query the user.
3. **Maintenance gate.** If the system notice says this route's area is down, answer `503 maintenance` (IS §3.5). Webhooks are exempt.
4. **Body.** Reject `Content-Length` over `maxBodyBytes` with 413 before reading, **and** read the body through a streaming reader that stops at `maxBodyBytes + 1` bytes (Vercel already buffers up to 4.5 MB, and `Content-Length` can lie), then 413. Parse JSON once (`invalid_json` 400 on failure; AA F-14: 26 unguarded `request.json()` today). `sendBeacon` bodies arrive as `text/plain`; routes that accept beacons set `beacon: true` and parse the text as JSON.
5. **Validation** of params, query and body with zod → `400 validation_failed` with `details.issues: [{ path, code, message }]`.
6. **Rate limit** (§2.10) → `429 rate_limited` + `Retry-After`.
7. **Idempotency** (§2.8): replay a stored response, or reserve the key.
8. **Handler.** Domain errors are thrown as `new ApiError(code, { message?, details?, retryAfterSec? })`. Known Prisma errors map centrally: `P2002` → `409 conflict` (with `details.target`), `P2025` → `404 not_found`, `P2024`/`P2028` (pool/transaction timeout) → `503 unavailable` with `retryAfterSec: 2`.
9. **Response.** A non-`Response` return value is wrapped as `{ data }` (or `{ data, meta }` for `Paged`), serialised with a BigInt-safe serializer that throws on BigInt in dev. Cache headers from the tier. ETag computed when the tier asks for it.
10. **Errors.** Anything unknown becomes `500 internal` with only `{ code, message: "Something went wrong", requestId }`; the error goes to `Sentry.captureException` with the route id and request id. `details: error.message` is never sent (fixes 29 routes, AC §6.2).
11. **Telemetry.** One Sentry span `api <id>`, tags `route`, `auth`, `status`, `code`; a distribution metric `api.duration_ms{route}`; a structured log line (§2.13).

Each route file stays a few lines:

```ts
// app/api/review/[ref]/route.ts
export const maxDuration = 10;
export const GET = route({
  id: "review.get", auth: "member_or_lapsed_read", params: GameRefParams,
  response: ReviewData, cache: "private-etag",
}, async ({ viewer, params }) => review.getForPlayer(viewer!, params.ref));
```

`defineAction()` (server actions) wraps the same steps 2, 5, 6, 7, 8 and 10 and returns `ActionResult`.

### 2.6 Errors

Envelope:

```ts
// packages/contracts/src/http/envelope.ts
export type Ok<T> = { data: T; meta?: { nextCursor: string | null; total?: number; version?: string } };
export type ErrorBody = {
  code: ErrorCode;                 // closed list below
  message: string;                 // safe, user-facing English sentence; never an exception message
  details?: Record<string, unknown>; // e.g. { issues }, { reason }, { field }, { resetsAt }
  retryAfterSec?: number;          // 429, 503, sometimes 409 (in_flight)
  requestId: string;               // equals the x-request-id header and the Sentry tag
};
export type Err = { error: ErrorBody };
```

The code list is the **one ledger in `packages/contracts/src/http/codes.ts`** (`ERROR_STATUS`; `codes.test.ts` asserts each code has exactly one status; consistency R-06). Adding a code is a contract change made by the phase that first produces it.

| Code | HTTP | Added by | When | Client reaction (global unless noted) |
|---|---|---|---|---|
| `invalid_json` | 400 | P1 | Body is not JSON | Bug report toast |
| `validation_failed` | 400 | P1 | zod failed (`details.issues[]`), or a valid shape with an invalid combination (`details.reason`, e.g. `mode_not_available`) | Inline field errors (host form) |
| `unauthorized` | 401 | P1 | No or expired Clerk session | `SessionWatcher` → reload session once, else `V3SessionExpired` (in game: silent refresh chip) |
| `subscription_required` | 402 | P1 | Not entitled; `details.reason ∈ SUBSCRIPTION_REASONS` = `trial_available`, `trial_used`, `expired`, `payment_failed`, `paused` (P10) | `trial_available`/`trial_used` → `paywallUrl()`; `expired`/`payment_failed`/`paused` → renew sheet or `/pricing?reason=ended` per B26 |
| `payment_update_required` | 402 | P1 | `on_hold`/`past_due` beyond grace | Update-payment flow (`V3PaymentFailed`) |
| `forbidden` | 403 | P1 | Authenticated but not allowed; also a cookie-authenticated mutation from a foreign origin; `details.reason ∈ FORBIDDEN_REASONS` | Inline "You can't do this" |
| `reverification_required` | 403 | P10 (or P12 if it merges first) | Clerk step-up needed (`DELETE /api/me`, admin deletes) | Clerk `useReverification()` then retry |
| `not_found` | 404 | P1 | Missing, or exists but the viewer may not know | Entity 404 screen |
| `conflict` | 409 | P1 | State conflict; `details.reason ∈ CONFLICT_REASONS` (below) | Host screen decides by reason |
| `in_flight` | 409 | **P2** (first producer `POST /api/games`); P7 reuses it | Same action already running; `retryAfterSec` | Wait |
| `gone` | 410 | P3 | Expired or revoked share, expired challenge, expired export | Host screen's expired state |
| `precondition_failed` | 412 | P12 | `If-Match` version stale (admin edits, tournament settings) | Refetch, "changed elsewhere" |
| `payload_too_large` | 413 | P1 | Body over `maxBodyBytes` (counted while reading) | Toast |
| `idempotency_key_reused` | 422 | P2 | Same `Idempotency-Key`, different body | Bug; new key |
| `illegal_position` | 422 | P2 | FEN parses but is not legal | Inline |
| `illegal_moves` | 422 | P2 | Bot `complete`/`checkpoint` moves don't replay (`details.reason: "claim_mismatch"` when the claimed result disagrees) | Drop the local game, show `rejected` |
| `upgrade_required` | 426 | P1 | Client build too old (§2.3) | `V3PwaUpdate` |
| `rate_limited` | 429 | P1 | A limiter said no; `Retry-After` + `retryAfterSec`; `details.source` (`ours` \| `chesscom` \| `lichess`) | Inline countdown; never auto-retry a mutation (the outbox honours `Retry-After`) |
| `fair_use_limit` | 429 | P7 | Coach quota (`details.resetsAt`, `details.limit`) | `V3CoachRateLimit` |
| `internal` | 500 | P1 | Unknown error | `V3Error500` toast with Retry and the request id |
| `upstream_unavailable` | 502 | P1 | Dodo, Clerk BAPI, Chess.com, Lichess or Anthropic failed; `details.kind ∈ timeout, error, refresh`, `details.provider` | Toast + Retry; the coach shows the engine-line fallback |
| `maintenance` | 503 | P1 | Maintenance notice for this area; `details.retryAt` | `V3Maintenance` |
| `not_configured` | 503 | P1 | Billing or a provider env missing (kept from Phase 0) | Toast |

**Codes that never appear on the wire, and their replacement:** `membership_ended` → `402 subscription_required {reason}`; `origin_mismatch` → `403 forbidden`; `upstream_timeout`, `upstream_error`, `refresh_failed` → `502 upstream_unavailable {kind}`; `upstream_rate_limited` → `429 rate_limited {source}`; `unauthenticated` → `unauthorized`; `bad_request`, `unsupported_media_type` → not used; `already_subscribed` → `409 conflict {reason: "already_subscribed"}`; `unavailable` (pool timeout) → `503 maintenance {details.kind: "db"}` with `retryAfterSec`; `not_member`, `upgrade_required` stay **socket ack codes** (`CT/socket/codes.ts`).

**Registered `conflict` reasons** (`CONFLICT_REASONS`, append-only, each added by the phase that introduces it): P2 `already_started`, `already_completed`, `not_bot_game`, `rev_gap`; P4 `linked_elsewhere`, `already_linked`, `sync_running`, `not_failed`, `plan_required`, `profile_closed`; P5 `session_ended`; P9 `own_link`, `live_game`, `already_in_game`; P10 `username_taken`, `in_game`, `last_admin`, `hosting_tournament`, `already_paused`, `not_active`, `same_plan`, `already_cancelling`; P12 `tournament_full`, `registration_closed`, `already_joined`, `fen_taken`, `slug_taken`, `not_enough_players`, `already_ended`, `not_finished`, `name_taken`; billing `already_subscribed`.

Mapping rules:

- 404 vs 403: a resource the viewer must not learn about (another user's game, review, card, thread) is **404**, as `api/analysis/[gameId]/route.ts:167-174` already does. 403 is only for things the viewer can see but not do.
- Inactive and deleted users answer **404**, not 400 (AA F-40).
- `message` copy follows the DS copy rules: one sentence, no trailing "!".
- Phase 0's 402 body today is `{ error, code, upgradeUrl }` (`lib/auth/require-subscription.ts:47-55`). The new body is the envelope plus `details.upgradeUrl`. `isSubscriptionRequiredResponse` (`lib/billing/client.ts:120-133`) checks the 402 status first, so it keeps working through the migration; it is extended to return `details.reason` so the client can tell a lapsed member (`expired`, `payment_failed`, `paused`) from someone who never subscribed.

### 2.7 Pagination

- **Keyset only.** The cursor encodes the sort key tuple of the last row plus its id: `base64url(JSON.stringify([v, sortKey1, …, id]))` with `v` = cursor format version. Opaque to clients, not signed: every list query is already scoped by the viewer, so a forged cursor can only skip within the viewer's own rows. Decode failures → `400 validation_failed` (`details.issues[0].path = ["cursor"]`).
- Query: `?cursor=&limit=`; `limit` default 20 (lists of cards: 30; bank: 50), max 50 (admin: 100). The server fetches `limit + 1` rows to know whether a next page exists.
- Response: `{ data: T[], meta: { nextCursor: string | null, total?: number } }`. `total` is returned only where a cheap count exists (counts are usually separate: `GET /api/me/games?limit=0` returns counts only, PB A14).
- Sort orders are fixed per endpoint and always end with the unique id as a tie-break (AA F-24 rank mismatch). Filters change the cursor scope: the client drops the cursor when filters change (TanStack infinite query key includes the filters).
- Backward pagination exists only where the design needs it (coach thread history: `?before=<cursor>`).
- Every paginated query has its index named in the catalogue; the schema plan owns the DDL.

```ts
// apps/web/lib/api/cursor.ts
export const encodeCursor = (parts: (string | number | null)[]) =>
  Buffer.from(JSON.stringify([1, ...parts])).toString("base64url");
export function decodeCursor<T extends unknown[]>(c: string | undefined, arity: number): T | null { … }
// usage: WHERE "userId" = $me AND ("playedAt", "gameId") < ($p, $g) ORDER BY "playedAt" DESC, "gameId" DESC LIMIT $n+1
```

### 2.8 Idempotency

**Where it applies**

| Endpoint | Key | Why |
|---|---|---|
| `POST /api/checkout` | header `Idempotency-Key`, plus server-side session reuse (`User.pendingCheckoutSessionId` < 30 min, same plan; IP §1.5) | Double clicks create two Dodo sessions and can double-offer the trial (ADB §8.7) |
| `POST /api/subscription/change-plan` | header (required) | It charges proration through Dodo `changePlan` |
| `POST /api/subscription/payment-method`, `/pause` | header | Creates payment links / changes billing |
| `POST /api/subscription/cancel`, `/resume`, `DELETE /api/subscription/change-plan` | state rules (`subscription-action-rules.ts:118-186` already reject repeats) | Naturally idempotent |
| `POST /api/games` | header (required; the client keeps it in `sessionStorage` per position, PB A5) | Reloads must not create a second bot game |
| `POST /api/games/{ref}/complete` | natural: the game ref (second call returns the stored result) | Retries after a dropped response |
| `POST /api/games/{ref}/checkpoint` | natural: ply guard (`plyCount < $ply`) | Beacons can arrive late or twice |
| `POST /api/challenges`, `/api/shared-positions`, `/api/review/{ref}/shares` | header | Duplicate links |
| `POST /api/train/sessions` | header; and the server returns the ACTIVE session of the same kind and filter if < 2 h old | Double taps |
| `POST /api/train/attempts` | natural: `clientAttemptId` per item (unique index) | Offline outbox replays |
| `POST /api/coach/messages` | natural: `clientId` (unique per user) | A retried POST must not pay the LLM twice |
| `POST /api/learn/lessons/{slug}/progress` | natural: `eventId` | Beacon/outbox |
| `POST /api/me/export`, `POST /api/reports`, `POST /api/contact` | header | Duplicate jobs/emails |
| socket checkpoints and finish (direct, `DB/src/live/*`) | natural: `plyCount` guard / `status = 'IN_PROGRESS'` on the finish | Socket outbox retries |
| Webhooks | provider delivery id (`webhook-id`, `svix-id`) in `WebhookEvent` | Redeliveries |

**Header-key algorithm** (`apps/web/lib/api/idempotency.ts`):

```sql
-- table idempotency_keys (userId BIGINT, key TEXT, route TEXT, requestHash TEXT, status SMALLINT,  -- 0 running, 1 done
--                         responseStatus SMALLINT, responseBody JSONB, createdAt TIMESTAMPTZ, PRIMARY KEY (userId, key))
INSERT INTO idempotency_keys ("userId", key, route, "requestHash", status, "createdAt")
VALUES ($1, $2, $3, $4, 0, now())
ON CONFLICT ("userId", key) DO NOTHING
RETURNING 1;
```

1. Key format: UUID v4, `^[0-9a-f-]{36}$`; else 400.
2. Insert returned a row → run the handler; on success `UPDATE … SET status=1, "responseStatus"=$s, "responseBody"=$b`; on a 4xx, store it too (the same request will fail the same way); on a 5xx or a thrown error, `DELETE` the row so the client may retry.
3. Insert returned nothing → read the row:
   - different `route` or `requestHash` (sha256 of the canonical JSON body) → `422 idempotency_key_reused`;
   - `status=0` and younger than 60 s → `409 in_flight` with `retryAfterSec: 2`; older → treat as abandoned, take it over;
   - `status=1` → replay `responseStatus` + `responseBody` with header `Idempotent-Replayed: true`.
4. TTL 24 h; the daily cron's `prune` task deletes older rows (§8.4).

Cost: one extra statement per keyed request, on endpoints that write anyway.

### 2.9 Concurrency and conditional writes

- **State transitions are conditional updates**: `updateMany({ where: { id, status: <expected>, … } })` and `count === 0` → `409 conflict` with the reason read back in a second query (AA F-06, ADB §8). This applies to: challenge accept/cancel, finish/abort, tournament join/start/end, card grading (`reps = $cardReps`), checkpoints (`plyCount < $ply`), billing snapshots (`subscriptionSourceAt <= $eventTime`, ADB §8.7).
- **Optimistic concurrency for editable documents**: admin entities and tournament settings return `ETag: "<version>"`; PATCH/PUT require `If-Match`; stale → `412 precondition_failed`. Preferences use last-write-wins per leaf (IA §3.0.1) and return the merged document, so they never 412.
- **No interactive transaction reads through the global client** (ADB §8.4): domain functions take a `tx` parameter.
- **Side effects after commit** (socket emits, PostHog, worker wake, Clerk metadata, emails) run in `after()` from `next/server`, never before the response and never fire-and-forget without `after()` (AA F-10: six un-awaited notifies today).

### 2.10 Rate limiting

**Layer 1: the edge (per IP, before any function runs).** Vercel Firewall custom rules (3 on Hobby) and the managed bot protection: public search and catalogue JSON per IP, `/sign-*` bursts, scanner paths. Until a rule exists for `/api/openings*` and `/api/positions*`, P1's in-isolate `EDGE_DOC_LIMIT` is **on** for them (`audit-quality` SEC-09). CDN caching of public reads absorbs most scraping anyway.

**Layer 2: per user, in Postgres, on expensive or abusable endpoints only.** P1's **fixed-window** limiter (P1-09; consistency R-13): `RateLimitSpec = { bucket, limit, windowSec, by: "user" | "ip" | "account", store: "burst" | "durable" }`. One statement per check:

```sql
-- burst store: UNLOGGED rate_limit_buckets (key text PRIMARY KEY, count int, "resetAt" timestamp(3)); windows ≤ 60 s only
INSERT INTO rate_limit_buckets AS b (key, count, "resetAt") VALUES ($1, 1, $now + make_interval(secs => $2))
ON CONFLICT (key) DO UPDATE SET
  count     = CASE WHEN b."resetAt" <= $now THEN 1 ELSE b.count + 1 END,
  "resetAt" = CASE WHEN b."resetAt" <= $now THEN EXCLUDED."resetAt" ELSE b."resetAt" END
RETURNING count, "resetAt";        -- count > $limit → 429, retryAfterSec = ceil(resetAt − now)
```

- **`burst`** uses the `UNLOGGED` table, allowed only for `windowSec ≤ 60`. Neon empties unlogged tables when the compute scales to zero, which is harmless for a 60-second window.
- **`durable`** is for anything longer: the same statement on the LOGGED `rate_limit_windows`, or (preferred) a count over the route's own source rows inside a statement the route runs anyway, for example `SELECT count(*) FROM reports WHERE "reporterId" = $u AND "createdAt" > $now - interval '1 day'` on `reports_reporterId_createdAt_idx`. Otherwise an abuser who pauses five minutes when nobody else is online gets a fresh hour (api-perf AP-11).
- A spec with `windowSec > 300` and `store: "burst"` **throws at module load**.
- Keys: `rl:<bucket>:u:<userRef>` or `rl:<bucket>:ip:<sha256(RATE_LIMIT_IP_PEPPER‖ip)[:16]>`. `HOUSEKEEPING` prunes expired rows. Hot paths (`/api/me`, review reads, train reads, `GET /api/openings`) have no limiter.

| Bucket | `limit / windowSec` · store | Endpoints |
|---|---|---|
| `lookup` | 10 / 60 · burst per user; 30 / 60 per IP | `POST /api/accounts/chesscom/lookup` |
| `link` | 5 / 60 · burst | `POST /api/accounts/chesscom`, `GET /api/accounts/lichess/start` |
| `sync` | 1 / 600 per account · durable (`import_runs`) | `POST /api/accounts/{provider}/sync`, `POST /api/import/{ref}/retry` |
| `checkout` | 6 / 60 · burst | `POST /api/checkout` |
| `billing-refresh` | 1 / 10 · burst | `POST /api/billing/refresh`; `GET /api/billing/activation` (1 / 2 s) |
| `billing-action` | 10 / 60 · burst | `POST /api/subscription/*` |
| `coach-burst` | 5 / 60 · burst | `POST /api/coach/messages`, `/retry` (plus the fair-use quota) |
| `coach-hint` | 60 / 60 · burst | `POST /api/coach/hint` |
| `create-game` | 30 / 60 · burst | `POST /api/games`, `POST /api/challenges` |
| `bot-checkpoint` | 60 / 60 · burst | `POST /api/games/{ref}/checkpoint` (plus `moves ≤ 400`, `rev ≤ stored + 64`) |
| `share-create` | 20 / 86400 · durable (`shares (ownerId, createdAt)`) | `POST /api/review/{ref}/shares`, `POST /api/shared-positions` |
| `train-write` | 120 / 60 · burst | `POST /api/train/attempts` and the other train writes |
| `train-session` | 30 / 3600 · durable (`training_sessions`) | `POST /api/train/sessions`, `/extend` |
| `weakness-recompute` | 1 / 600 · durable (`jobs`) | `POST /api/train/weakness/recompute` |
| `legend-retry` | 3 / 3600 per game · durable | `POST /api/review/{ref}/legend/compute` (retry) |
| `review-batch` | 10 / 3600 · durable | `POST /api/review/batch` |
| `username` | 30 / 60 · burst | `GET /api/usernames/availability` |
| `account-danger` | 5 / 3600 · durable | `DELETE /api/me`, `POST /api/me/export`, `PATCH /api/me/username` |
| `export-pgn`, `export-dl`, `invoice`, `avatar` (10 / 3600), `push-test` (5 / 3600) | durable | P10 routes |
| `search` | 30 / 60 per IP (public), 60 / 60 per user · burst | `GET /api/search`, `GET /api/me/search` |
| `contact` | 5 / 3600 per IP hash, 3 / 3600 per email · durable (`support_requests`) | `POST /api/contact` (plus `checkBotId()`) |
| `report-burst` + `report` | 5 / 60 burst + 20 / 86400 durable (`reports`) | `POST /api/reports` |
| `push` | 10 / 3600 · durable | `POST /api/me/push-subscriptions` |
| `consent` | 20 / 3600 per IP · durable | `PUT /api/consent` |
| `prefs` | 120 / 60 · burst | `PATCH /api/me/preferences` |

**Layer 3: the socket server**, in memory (one authoritative process per environment): per-socket 20 events/s burst, 10/s sustained, plus per-command limits (P2 §7.4.8); handshake limits **per user** (≤ 10 sockets, ≤ 20 handshakes a minute) with a generous per-IP flood guard (≤ 500 sockets, ≤ 300 handshakes a minute) suspended for 120 s after boot (CGNAT, api-perf AP-17). Over the limit → ack `{ ok: false, code: "rate_limited", retryAfterMs }`; a sustained flood disconnects the socket.

**Quotas, not limits.** Coach fair use (`CT/limits.ts`, CR-33), the daily bank cap and the daily puzzle fair use (`training_days`), and the Resend daily budget (counted from `notifications`) are business quotas in logged tables; none uses the limiter table.

**Upstream limits.** Chess.com and Lichess calls happen on the worker through one global serial queue per provider. The web routes that touch Chess.com synchronously (lookup, link) use `AbortSignal.timeout(5000)`, `encodeURIComponent`, a 10-minute shared cache per handle, and fall back to the worker's `POST /internal/provider/chesscom/lookup` on 429/403 from Vercel's shared egress IPs; an upstream 429 maps to `429 rate_limited {source}` with its `Retry-After`.

### 2.11 Auth helpers

#### 2.11.1 `getViewer()`

```ts
// apps/web/lib/auth/viewer.ts
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const { userId, sessionClaims } = await auth();          // local JWT verify, no Clerk Backend API call
  if (!userId) return null;
  const row = await prisma.user.findUnique({ where: { googleId: userId }, select: VIEWER_SELECT }) // ~15 columns
           ?? await upsertUserFromClerk(userId, sessionClaims); // first request can beat the user.created webhook
  if (!row.isActive || row.deletedAt) return null;           // inactive users are signed out (ADB §3.2)
  return toViewer(row);   // { id (bigint, server-only), ref, role, entitlement, onboarding, timezone }
});
```

- One indexed read by `users_googleId_key`; the 5 duplicate indexes go (ADB §13.1).
- It replaces `resolveUser` (full row, `lib/auth/resolve-user.ts:103`), `getSessionUser` (Clerk BAPI + email lookup, `lib/auth/get-session-user.ts:8-13`) and the 10 inline `findUnique({googleId})` calls (AA F-23).
- `upsertUserFromClerk` links an existing row by email only when the primary email is verified (AA F-23, ADB §8.8), and logs every relink.

#### 2.11.2 Guards

| `auth:` value | Check | Failure |
|---|---|---|
| `public` | none; `viewer` not loaded | — |
| `optional` | `viewer` loaded if a session exists | — |
| `user` | `viewer != null` | 401 `unauthorized` |
| `member` | `user` + (`isEntitled(viewer)` or `role=ADMIN` or `BILLING_PAYWALL=off`, the latter refused in production) | 402 `subscription_required {reason}` or `payment_update_required`, chosen by `deriveMembershipState()` (`lib/billing/entitlement-rules.ts`) |
| `member_or_lapsed_read` | as `member`, but GET passes for lapsed users when `LAPSED_READ=on` (§11 Q1) | same |
| `admin` | `user` + `viewer.role === "ADMIN"` (DB role; the Clerk claim is only a middleware fast path) | 403 `forbidden` |
| `internal` | HMAC (§2.11.6) + the route is under `/api/internal/` | 401 `unauthorized` (no detail) |
| `cron` | `Authorization: Bearer ${CRON_SECRET}`, timing-safe | 401 |

Resource guards, called inside handlers (they return the projection the route needs, so they cost no extra query):

| Helper | Signature | Behaviour |
|---|---|---|
| `requirePlayerOf` | `(viewer, gameRef, { select, allowSpectator?: "public" })` | Loads the game with `whitePlayerId`, `blackPlayerId`, `visibility`, plus `select`. Player → `{ game, color }`. Spectator allowed only for `visibility=public` live games. Otherwise `404 not_found`. Admins get read access (RA §8). |
| `requireOwner` | `(viewer, model, ref, select)` | Generic `where: { referenceId, userId: viewer.id }` → 404 otherwise |
| `requireHostOrAdmin` | `(viewer, tournamentSlug)` | Host (`createdByUserId`) or admin → else 403 |
| `requireParticipant` | `(viewer, tournamentSlug)` | Active participant → else 403 (`details.reason: "not_participant"`) |
| `visibleProfile` | `(viewer \| null, username)` | Honours `profileVisibility` and blocks; private → 200 with the private projection (`V4ProfilePrivate`), never 403 |

#### 2.11.3 Perf bypass and test hooks

`PERF_AUTH_BYPASS` (`lib/auth/resolve-user.ts:82-89`) and every other test hook are honoured only when `isNonProd()` (`APP_ENV ∈ {dev, test}`) **and** `ALLOW_TEST_HOOKS=1`, and request hooks additionally need `x-e2e-token` = `E2E_TEST_TOKEN` (the perf bypass also needs `x-perf-token`). **Never gate on `VERCEL_ENV`:** the dev project `replay-chess-dev` deploys with `target: production`, so `VERCEL_ENV !== "production"` would lock hooks out of dev, and deleting the clause would leave nothing (feasibility fix #3). `APP_ENV` is required at boot; a production process with a hook switch set refuses to start. Every hook is listed in `lib/test-hooks/registry.ts` and proven absent by `prod-guard.spec.ts` (`01-architecture.md` §5.11). k6 runs against dev only.

#### 2.11.4 Middleware (edge) responsibilities for `/api`

Middleware never touches the DB. For API paths it:

1. Sets `x-request-id` (`crypto.randomUUID()`) on the request and response when absent.
2. Skips Clerk for `/api/webhook/*`, `/api/internal/*`, `/api/cron/*`, `/api/scraper/*`, `/api/health`, the public catalogue APIs `/api/(legends|openings|positions)*`, and answers scanner paths (`\.(php|env|git|aspx?)$|^/wp-`) with a static 404 (today only Dodo and the scraper are skipped, `middleware.ts:4-7, 29-31`).
3. Rejects cookie-authenticated non-GET requests unless `Sec-Fetch-Site: same-origin` or `Origin` equals the app origin (`403 forbidden`; `same-site` is not enough because `media.playchess.tech` is same-site). `sendBeacon` sends the same-origin `Origin`, so beacons pass.
4. Answers `503 maintenance` for the affected areas from the Edge Config notice (memoised 30 s, IS §3.5).
5. Never redirects an API request; handlers answer 401/402 (IP §1.2 rule 3).

Page gating (members, onboarding, lapsed) is middleware's job through the Clerk custom session claim `md` (IP §1.2); it is not part of the API contract, except that the API never trusts the claim for authorisation: handlers re-check in the DB.

#### 2.11.5 Socket token

`GET /api/socket-token` (kept), and minted inside the `(app)` layout RSC so the first connect needs no round trip:

```ts
// packages/contracts/src/socket/token.ts (P2)
export const SocketTokenClaims = z.strictObject({
  v: z.literal(2),
  sub: Ref,                       // user referenceId; the only identity the socket server trusts
  exp: z.number().int(),          // unix s, ≤ 15 min
  iat: z.number().int(),
  env: z.enum(["dev", "test", "production"]),
  ent: z.number().int(),          // entitled until (unix s), 0 = not a member
  role: z.enum(["user", "admin"]),
  name: z.string().max(40),       // display name for presence, so the socket needs no lookup
  rating: z.number().int().nullable(), // queue pairing seed
  kid: z.string().max(8),         // SOCKET_TOKEN_SECRET key id for rotation
});
// wire: base64url(json) + "." + base64url(HMAC_SHA256(SOCKET_TOKEN_SECRET[kid], payload))
```

- **Refresh is lazy**, at handshake time (the socket.io `auth` callback calls `freshToken()`), never on a timer. `entitlement:changed` updates `ent` on the user's live sockets server-side, so no refresh is needed for billing changes.
- **Minting reads no DB when it can** (api-perf AP-41): `ent`, `role`, `name` and the rating come from the verified Clerk session claims (`md.entitled`, `md.entUntil`, written by `syncClerkClaims`); the viewer row is read only when a claim is missing. After a socket deploy every tab reconnects within ~5 s, so a DB read per token would be a burst of viewer reads.
- Verification lives in `@repo/contracts/socket/token`, ending the byte-for-byte copy in `apps/web-socket/utils/socketAuth.ts`. `SOCKET_TOKEN_SECRET` never verifies service calls, and `INTERNAL_API_SECRET` never verifies user tokens.

#### 2.11.6 Internal HMAC (every internal hop, from P2)

```
x-rc-kid: web | wk | ws | ops      (the caller's key id)
x-rc-ts:  1793563200                (unix s; reject if |now − ts| > 60)
x-rc-sig: base64url(HMAC-SHA256(INTERNAL_API_SECRET[kid], ts + "\n" + METHOD + "\n" + path + "\n" + sha256hex(rawBody)))
```

- One helper, `packages/contracts/src/internal/auth.ts` (sign and verify; ESLint bans it in client code); the web sender is `lib/internal/fetch.ts` (`internalFetch()`).
- `INTERNAL_API_SECRET` holds the key set `kid:base64[,kid:base64]`; the first key of a sender signs. A bare legacy value is read as kid `web`. **Separate keys per caller** (`web`, `wk` worker, `ws` socket, `ops` deploy CLI), so a leaked web key cannot pose as the worker.
- **Per-kid allow-lists.** Paths: each kid may call only its routes. Events on `/internal/emit`: the worker may emit only `analysis:*`, `import:*`, `weakness:*`, `bank:*`, `mistakes:*`, `review:*`, `games:changed`, `export:ready`; the web may emit the rest of the registry.
- Timing-safe compare; a 2-minute in-memory replay set on the receivers; every internal endpoint is also idempotent.
- Applied on every `/api/internal/*` route, the socket server's `/internal/*` and the worker's `/internal/*` and `/engine/*`. **Caddy refuses a request without `X-Rc-Sig` before Node**, and blocks `/internal/broadcast`, `/internal/drain` and `/internal/metrics` outright (they are reached through `docker compose exec` and the signing CLI).
- The static `x-internal-token` is never accepted by the v2 socket server; it survives only in its v1 path until that is deleted (P2 Q5, Q17).
- Rotation: add the new key everywhere, switch signing, drop the old key after 24 h.
- The OCI services send `sentry-trace` and `baggage` so traces join across tiers (§2.13).

#### 2.11.7 CORS, cookies, CSRF

- `/api/*` is same-origin only: no `Access-Control-Allow-Origin` anywhere. The socket server's CORS allowlist is `ALLOWED_ORIGINS` with an `allowRequest` origin check that fails closed in production (AS S7).
- CSRF: the Clerk session cookie is SameSite=Lax, and middleware checks `Origin` on mutations (above). The two cookies we set ourselves (`rc_lichess_pkce`, `rc_act`) are httpOnly, Secure, SameSite=Lax and HMAC-signed with `SIGNED_COOKIE_SECRET`.

### 2.12 Caching

Six named tiers, implemented in P1's wrapper (`01-architecture.md` CR-20). Revision 1's T0–T3/NS labels are retired, because "T1" meant two different things in two documents.

| Tier | Header set | Invalidation | Used for |
|---|---|---|---|
| `public-immutable` | `Cache-Control: public, max-age=31536000, immutable` on a content-hashed or versioned URL | new URL | engine files, puzzle shards, catalogue JSON snapshots, lesson audio |
| `public-static` | Pages: ISR + `unstable_cache(…, { tags })`. JSON: `Cache-Control: public, max-age=0, must-revalidate` + `Vercel-CDN-Cache-Control: public, s-maxage=86400, stale-while-revalidate=604800` + `Vercel-Cache-Tag: <tags>` | `revalidateTag()` for pages and the data cache; `invalidateByTag()` (`@vercel/functions`) for CDN JSON, from admin writes and content scripts | legends, openings (incl. `GET /api/openings`), positions, lessons content, featured sets, weakness baselines, how-we-grade |
| `public-short` | `Vercel-CDN-Cache-Control: public, s-maxage=5..300` | time (+ tag purge on edits) | public projections: `GET /api/players/{u}`, public search, challenge preview, tournament lists and snapshots, return-target (catalogue kinds only) |
| `private-etag` | `Cache-Control: private, no-cache` + **strong** `ETag` (version-derived where a version exists) | client revalidates; 304 costs one probe or none | `/api/me`, reviews (analysing **and** complete), review status, weakness, imports, linked accounts, membership, practice context, legend comparison, coach threads and suggestions, the archive (`ETag = "g<gamesVersion>.<filterHash>"`) |
| `no-store` | `Cache-Control: private, no-store` | — | mutations; per-viewer `/me` sub-resources; train today/bank/sessions, home, socket token, billing actions, internal routes; **downloads** (PGN, invoice PDF, export) with `Content-Disposition: attachment` |
| `sse` | `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform` | — | coach streams |

Rules:

- **`public-*` only with `auth: "public"` and no session read.** The wrapper throws at module load otherwise, and a CI test walks the registry and fails any non-public route that declares a public tier or any `max-age > 0` on a per-user route. The CDN key is the URL and ignores cookies, so a route that varies by session must never be CDN-cached.
- **Public-plus-viewer routes split** (api-perf AP-03): the public path carries only public data; per-viewer bits go on a separate `no-store` path. Players: `GET /api/players/{u}` (public) + `GET /api/players/{u}/me` (`{isSelf, blocked, canChallenge, h2h}`). Search: `GET /api/search` (public) + `GET /api/me/search` (member scope). Challenges: CHL-2 public, `isOwn` computed on the client. Tournaments: TOU-1/2 public, `me` through TOU-7.
- **No per-user response has `max-age > 0`.** `private` only stops shared caches, not the next person on the same browser; a long `max-age` would let user B read user A's review from the HTTP cache with no auth check. The "immutable revisit" win comes from TanStack `staleTime: Infinity` once a review is `done`.
- **Sign-out clears the browser HTTP cache**: `POST /api/session/clear` (auth `optional`, `no-store`) answers `204` with `Clear-Site-Data: "cache"`; `signOutEverywhere()` calls it after the outbox flush and before `clerk.signOut()` (not `"storage"`, which would wipe the outbox). `(app)` documents stay `private, no-store`.
- **OG images only through shares**: `/r/{code}/opengraph-image?v={imageVersion}` with `Cache-Control: public, max-age=3600`, `Vercel-CDN-Cache-Control: public, s-maxage=31536000`, `Vercel-Cache-Tag: share:{code}`; the image route reads `revokedAt`/`expiresAt` from the same tagged loader as the page and returns a generic card when revoked; revoke and update call `invalidateByTag('share:'+code)`. There is no `/og/game/{ref}`.
- **Tags** (one vocabulary for pages, data cache and CDN): `legends`, `legend:<slug>`, `positions`, `position:<slug>`, `openings`, `opening:<slug>`, `lessons`, `lesson:<slug>`, `tournaments:list`, `tournament:<slug>`, `tournament:<slug>:standings`, `share:<code>`, `player:<ref>`, `catalog-version`.
- Query-dependent public JSON is cached per full URL; the RSC passes `v=<catalogVersion>` so a content change also changes the URL.
- **ETags are strong** (no `W/`): version-based where possible (`"<analysisVersion>.<gradedPlies>"`, `"<prefs.version>"`, `"g<gamesVersion>.<filterHash>"`), otherwise a 64-bit hash of the JSON.
- The service worker never caches `/api/*` (NetworkOnly); its page cache is per user (`rc-pages:u:<ref>`) and is cleared at sign-out.

### 2.13 Logging, Sentry, tracing, metrics, analytics

**Logs.** One structured JSON line per request from the wrapper (`lib/logger.ts`, the duplicate `lib/sentry/logger.ts` is deleted, AA F-32):

```json
{"level":"info","msg":"api","route":"reviews.get","method":"GET","status":200,"code":null,"durationMs":23,
 "dbMs":11,"requestId":"…","userRef":"cm…","auth":"member","cache":"private-etag","env":"production"}
```

Never logged: request bodies, emails, tokens, OAuth codes, Dodo payloads beyond ids, coach prompts or answers (counts and hashes only). `logger.error(msg, err, ctx)` calls `Sentry.captureException(err, { extra: ctx })` (fixes AA F-05: `lib/logger.ts:42-52` drops the error object today).

**Sentry.**

- `sendDefaultPii: false` on all three tiers (`sentry.server.config.ts:20`, `sentry.edge.config.ts:21`, `instrumentation-client.ts:31`, `apps/web-socket/instrument.ts:10`).
- `Sentry.setUser({ id: viewer.ref })` in the wrapper and the `ViewerProvider`; never the email.
- `tracesSampler`: 1.0 for `/api/webhook/*`, `/api/checkout`, `/api/subscription/*`, `/api/internal/tournaments/*`; 0.2 for `/api/coach/messages`; 0 for `/api/health` and every polling fallback; 0.1 default (AA F-13).
- 4xx are not exceptions (breadcrumb only), except 402 on an internal route (bug) and 409 `idempotency_key_reused`. 5xx are exceptions. Upstream errors are captured at `warning` with `upstream` tag.
- Request id = Sentry trace id prefix for 5xx, so the "Event ID" shown in `V3Error500` matches the issue.
- Cross-tier traces: the socket server and worker forward `sentry-trace`/`baggage` on internal calls; the old per-game `continueTrace` stored in `gameData.traceContext` is removed (AS F-40, AA F-04).

**Metrics** (Sentry metrics; already wired in `lib/metrics.ts` and `apps/web-socket/utils/sentry.ts`): `api.duration_ms{route}`, `api.status{route,code}`, `api.db_ms{route}`, `api.rate_limited{bucket}`, `idempotency.replayed{route}`, `coach.first_sentence_ms`, `coach.cost_micros`, `webhook.lag_ms{provider,type}`, `internal.finish_ms`. The client-side `trackApiResponseTime` per-call metric is removed (AC §16).

**Server-Timing.** In dev and preview, the wrapper adds `Server-Timing: db;dur=11, app;dur=23` for quick checks in DevTools.

**Product analytics.** Server events (webhook outcomes, analysis timing, coach cost) go to PostHog from `after()` with `distinct_id = viewer.ref`; client events stay consent-gated (IS §9). Event names are `area_object_action` snake case (IA §1.6).

### 2.14 OpenAPI, docs and contract tests

- **Registry.** Each endpoint is declared once in `@repo/contracts/registry` (`defineEndpoint({ id, method, path, auth, query, body, response, errors, cache, rateLimit, idempotent })`). `defineRoute` takes its spec from the registry by `id`, so the doc and the code cannot drift.
- **Generation.** `pnpm --filter @repo/contracts openapi` builds `docs/api/openapi.json` (OpenAPI 3.1) with `zod-openapi` (zod 4 compatible) from the registry; error responses come from `ERROR_CODES`; auth levels become security schemes (`clerkSession`, `internalHmac`, `cronBearer`, `webhookSignature`). CI regenerates and fails on a diff (`git diff --exit-code docs/api/openapi.json`).
- **Socket events.** The same package emits `docs/api/socket-events.md` (event, direction, room, payload JSON Schema via `z.toJSONSchema`, ack, errors). An AsyncAPI document is optional; the markdown table is enough for one team.
- **Viewer.** A dev-only page `/docs/api` (404 in production) renders the OpenAPI file with a static viewer; nothing is public.
- **Contract tests.** `apps/web/test/api/*.test.ts` run every registry entry through: auth matrix (signed out → 401; non-member → 402; non-player → 404; admin-only → 403), malformed JSON → 400, oversize → 413, rate-limit headers on 429, response schema parse. Appendix D lists the matrix.

---
## 3. How the UI talks to the API

The client plan owns component structure. This section fixes the **contract** between screens and the API: which channel each kind of data uses, how errors surface, and which endpoints each screen calls.

### 3.1 Five channels, one rule each

| Channel | Use it for | Never use it for |
|---|---|---|
| **RSC loader** (server component → service) | First paint of every page, including the gated app shell (`getViewer()` + `getShellState()`), review payloads, home, train, profile, tournament snapshots | Data that changes while the page is open (those are seeded from RSC, then updated by the other channels) |
| **`api()` + TanStack Query v5** | Client re-reads (focus, filters, infinite lists), every mutation, polling fallbacks | Live game state, progress streams |
| **Socket.io (one connection per tab)** | Live games, queue, tournaments, presence, and every push signal into `user:{userRef}` | Anything that must survive the socket being down (each push has an HTTP read to resync) |
| **SSE (fetch + ReadableStream)** | Coach answers only | Progress or notifications (they go over the socket) |
| **Beacon / keepalive fetch, IndexedDB outbox** | Bot-game checkpoints on `pagehide`; train attempts and lesson events made offline | Anything that needs a response body |

### 3.2 The `api()` client

There is **one** implementation: P1 §7.12, `apps/web/lib/api/client.ts`, specified in `04-client-data-layer.md` §4.3. Revision 1's sketch here is withdrawn (api-perf AP-21). The contract it honours:

- Sends `x-rc-build: <BUILD_ID>` and `x-request-id`; `credentials: "same-origin"`; a 15 s default timeout through `AbortSignal.any([signal, AbortSignal.timeout(ms)])`.
- **No `ifNoneMatch` option and no `notModified` result.** Conditional GETs are transparent browser revalidation (`private, no-cache` + strong ETag): the browser sends `If-None-Match` and turns a 304 into the cached 200. TanStack Query v5 rejects `undefined` query data, so an explicit "not modified" return would break every query that used it.
- Parses `{ data, meta }` and turns `{ error }` into a typed `ApiError(code, status, details, retryAfterSec, requestId)`.
- **Parses responses with zod only in development and test**, through `devSchema()`: `api(endpoints.me, { schema: devSchema(MeData) })`, where `devSchema = (s) => process.env.NODE_ENV === "production" ? undefined : s`. The minifier removes the branch and the schema import, so zod and the contract modules stay out of production client bundles (api-perf AP-12). Forms that need client validation import `zod/mini`.
- GET retries twice on 5xx or network errors with backoff; mutations never retry automatically except through the outbox.
### 3.3 Query keys and freshness

```ts
// apps/web/lib/api/keys.ts
export const qk = {
  viewer: () => ["viewer"] as const,                       // seeded from the layout, staleTime ∞
  badges: () => ["me", "badges"] as const,                 // 60 s; patched by bank:due / notify:new
  home: () => ["home"] as const,                           // 30 s
  games: (f: GameFilters) => ["me", "games", f] as const,  // infinite, 60 s
  gameStatus: (ref: string) => ["game", ref, "status"] as const,
  review: (ref: string) => ["review", ref] as const,       // ∞ once complete; 0 while analysing
  legendComparison: (ref: string) => ["game", ref, "legend"] as const,
  coachContext: (c: CoachCtx) => ["coach", "context", c] as const,
  coachThread: (ref: string) => ["coach", "thread", ref] as const, // infinite, newest first
  trainToday: () => ["train", "today"] as const,           // 0 (no-store)
  bank: (f: BankFilters) => ["train", "bank", f] as const, // infinite
  session: (ref: string) => ["train", "session", ref] as const,
  weakness: () => ["train", "weakness"] as const,          // ETag
  imports: () => ["me", "imports"] as const,               // ETag
  linkedAccounts: () => ["me", "linked-accounts"] as const,
  prefs: () => ["me", "prefs"] as const,
  membership: () => ["billing", "membership"] as const,    // 5 min
  player: (u: string) => ["player", u] as const,
  playerGames: (u: string, f: object) => ["player", u, "games", f] as const,
  tournament: (slug: string) => ["tournament", slug] as const,  // ∞ while the socket is connected
  standings: (slug: string) => ["tournament", slug, "standings"] as const,
  openings: (q: object) => ["catalog", "openings", q] as const, // 24 h
  positions: (q: object) => ["catalog", "positions", q] as const,
};
```

Socket events write into the cache (`setQueryData`) or invalidate it; the table in §6.6 lists which event touches which key. Mutations write their response into the cache (membership actions return the new DTO; grading returns card patches) instead of refetching (AC §11.11).

### 3.4 Patterns per interaction type

| Interaction | Pattern |
|---|---|
| Open a page | RSC loads through services, `HydrationBoundary` seeds the queries, `loading.tsx` renders the matching `V3Skeletons` variant. No client fetch on first paint. |
| Toggle a setting | Optimistic: Zustand prefs store updates at once, `localStorage['rc-prefs']`, 400 ms debounced `PATCH /api/me/preferences` with `{ patch, baseVersion }`; failure keeps the local value and shows "Saved on this device" (IA §3.0.1). |
| Grade a puzzle | Optimistic advance; `AttemptIn` pushed to the IndexedDB outbox; `POST /api/train/attempts` with `keepalive`; apply `AttemptOut` patches (RB §4.5). |
| Start a bot game | `POST /api/games` with an `Idempotency-Key` kept in `sessionStorage` per position; navigate to `/game/{ref}`; local runner; `sendBeacon('/api/games/{ref}/checkpoint')` on `pagehide`; `POST …/complete` at the end. |
| Live game | `RealtimeProvider` socket → `game:join` ack carries the full `GameState`; moves are commands with acks; the RSC page already rendered the board from a DB snapshot. Zero HTTP calls during the game. |
| Quick match | `queue:join` / `queue:matched` over the socket, then `router.prefetch('/game/'+ref)` and navigate immediately (no fixed 1.5 s delay, AC §11.13). |
| Wait for analysis | Socket `analysis:progress` → `setQueryData(qk.review(ref))`; `analysis:done` → invalidate once. Fallback: `GET /api/games/{ref}/status` with ETag, 3 s → 10 s backoff, only while the socket is down and the tab is visible. |
| Ask the coach | `fetch('/api/coach/messages', { method:'POST', body, signal })` → SSE parser (§7). Stop = `AbortController.abort()`. |
| Checkout | `POST /api/checkout` → Dodo hosted page → `/checkout/activating` (or `/onboarding/activating`) → `GET /api/billing/activation` once, then `entitlement:changed` over the socket; fallback polls at 2 s, 4 s, 8 s, then `stalled` (AC §11.11, IP §2.7). |
| Infinite list | `useInfiniteQuery` on a cursor endpoint, `getNextPageParam: (p) => p.meta.nextCursor`. Filters live in the URL (`router.replace(…, { scroll: false })`) and in the key. |
| Search-as-you-type | 200–250 ms debounce, `signal` from TanStack cancels stale requests (fixes the out-of-order bug in `Leaderboard.tsx:171`, `ParticipantList.tsx:41`). |

### 3.5 Screen → data map

"RSC" is the server loader that renders first paint (no HTTP). "Reads" are client GETs after that. Endpoint ids refer to §4.

| Screen (boards) | RSC loader | Client reads | Mutations | Realtime |
|---|---|---|---|---|
| App shell, nav, banners (`V3Nav`, `V3PaymentFailed` banner, trial tag) | `getShellState()` (`Viewer`) | `ME-1` on focus after 60 s hidden; `ME-2` badges | — | `entitlement:changed`, `bank:due_changed`, `notify:new`, `system:notice`, `session:revoked` |
| Landing, how-we-grade, pricing, legal (`V3Landing`, `V3HowWeGrade`, `V3Pricing`) | static | `ME-1` only in the CTA island (client `useAuth()` first) | `BIL-1` checkout | — |
| Sign in/up, verify, reset (`V3SignIn`…) | static shell | `SYS-4` return target | Clerk JS only | — |
| Onboarding (`V3OnbWelcome` … `V3OnbDone`) | `getViewer()` + step | `ACC-2` lookup | `ME-4` step PATCH, `ACC-3` link, `OAU-1/2`, `BIL-1` | `entitlement:changed`, `import:progress`, `import:finished` |
| Checkout activating (`V3CheckoutActivating`) | viewer | `BIL-2` activation | `BIL-1` (retry) | `entitlement:changed` |
| Home (`V3Home`, `V3HomeNewUser`, `V3HomeLoading`) | `getHomeData()` | `HOME-1` refresh | — | `import:progress`, `analysis:progress`, `analysis:done`, `bank:due_changed`, `entitlement:changed` |
| Play hub (`V3PlayHub`) | featured positions (T0), viewer prefs | `CAT-5` positions search, `CAT-3` openings | `PLAY-1` bot game, `CHL-1` challenge | — |
| Queue, match found (`V3Queue`, `V3NoOpponent`, `V3MatchFound`) | viewer, socket token | — | — | `queue:join/leave` commands; `queue:status`, `queue:matched`, `queue:timeout` |
| Challenge share / accept (`V3ChallengeShare`, accept boards) | `CHL-2` preview via service | `CHL-2` | `CHL-1`, `CHL-3` accept, `CHL-4` decline, `CHL-5` cancel | `challenge:accepted`, `challenge:declined` |
| Game, every state (`V3Game` 55 states, `V3GameBot`) | `getGameSnapshot()` (live) or local-game snapshot (bot) | — | live: socket commands; bot: `PLAY-1/3/4` | `game:*` |
| Game over card (inside `V3Game`) | — | `PLAY-5` status (fallback) | `REV-3` analyse (non-auto games) | `game:over`, `game:result`, `analysis:*`, `game:rematch*` |
| Review (`V3ReviewAnalysing`, `V3ReviewSummary`, `V3KeyMoments`, `V3ReviewClean`, `V3ReviewFailed`) | `getReview()` | `REV-1` (ETag) | `REV-3`, `REV-4` progress, `REV-5` moment bank toggle, `REV-6` complete | `analysis:queued/progress/writing/done/failed` |
| Review complete, share (`V3RvComplete`, `V3RvShare`) | `getReview()` | — | `REV-7` share, `SHR-2/3` | — |
| Public share page `/r/{slug}` | `getShare()` (ISR, tag `share:<slug>`) | — | — | — |
| Legend compare (`V3LegendCompare`) | `getLegendComparison()` | `PLAY-7` | `PLAY-8` retry | `compare:ready` |
| Practice (`V3Practice`) | `getPracticeContext()` | — | `PLAY-1` (mode `bot`, from FEN), `CO-6` hint | — |
| Coach (`V3CoachSuggested` … `V3CoachPaywall`) | `getCoachContext()` | `CO-1`, `CO-2` older messages | `CO-3` (SSE), `CO-4` retry, `CO-5` recover, `CO-7` feedback | — |
| Train hub (`V3TrainHub`, `V3TrainHubDone`) | `getTrainToday()` | `TR-1` on focus | `TR-7` session | `bank:due_changed` |
| Mistake Bank (`V3MistakeBank`, `V3BankEmpty`, `V3BankCaughtUp`) | `getBankPage()` | `TR-2` (infinite) | `TR-7`, `TR-10` skip, `TR-11` remove | `bank:due_changed` |
| Bank drill / puzzle runner (`V3BankSession`, `V3Puzzle*`) | `getSession()` | `TR-3` reload | `TR-6` attempts, `TR-8` extend, `TR-9` end, `SYS-6` report | — |
| Session summary (`V3SessionSummary`) | `getSessionSummary()` | `TR-3?include=summary` | — | — |
| Weakness (`V3WeaknessProfile`, `V3WeaknessInsufficient`, `V3WeaknessComputing`, `V3WeaknessDrill`) | `getWeakness()` | `TR-5` (ETag; poll fallback) | `TR-12` recompute, `TR-7` (kind `weakness`) | `weakness:progress`, `weakness:ready` |
| Legends, openings catalogue and detail (`V3LegendsCatalogue`, `V3LegendDetail`, `V3OpeningsCatalogue`, `V3OpeningDetail`) | ISR loaders | `CAT-3` search, `LRN-1` member progress island | `LRN-3` opening drill | — |
| Lesson player, complete (`V3LessonPlayer`, `V3LessonComplete`) | `getLesson()` (cached content) + progress | — | `LRN-2` events | — |
| Games archive (`V3GamesArchive*`) | first page | `PLAY-10` (infinite) | `REV-8` batch review, `PLAY-11` export | `games:changed`, `import:progress` |
| Profile, own/other/guest/private (`V4Profile*`) | `getPlayer()` | `PLY-2..5` per tab | `ME-6` profile edit, `ME-12` block, `SYS-6` report | `presence:update` |
| Profile edit (`V4ProfileEdit`) | `getMyProfile()` | `SYS-7` username availability | `ME-6`, `ME-7` username, `ME-8` avatar URL | — |
| Settings: board, pieces, sounds, appearance, notifications (`V4Settings*`) | prefs | — | `ME-3` prefs, `ME-9..11` push | `prefs:updated` |
| Connected accounts (`V4SettingsConnected`, `…Error`) | `ACC-1` via service | `ACC-1` (ETag poll while syncing and the socket is down) | `ACC-2..7`, `OAU-1` | `import:progress/finished/failed` |
| Account, delete (`V4SettingsAccount`, `V4DeleteAccount`) | viewer | `ME-14` deletion preview | `ME-15` delete, `ME-13` export | `export:ready` |
| Membership, switch, cancel (`V4Membership*`, `V4PlanSwitch`, `V4CancelSub`) | `BIL-3` via service | `BIL-4` billing details, `BIL-6` change-plan options | `BIL-7..13` | `entitlement:changed` |
| Tournaments list (`V4Tournaments`, `V4TournamentsEmpty`) | `TOU-1` via service | `TOU-1` per tab | — | — |
| Tournament lobby, live, results (`V4TournamentLobby`, `V4TournamentLive`, `V4TournamentResults`) | `TOU-2` snapshot | `TOU-6` standings on a version gap, `TOU-7` me | `TOU-4` join/leave, `TOU-5` invite, `TOU-9` start/end | `tournament:*`, `tournament:find_match` command |
| Admin (`V4Admin*`) | admin loaders | `ADM-*` lists | `ADM-*` writes (`If-Match`) | — |
| System (`V3Offline`, `V3Maintenance`, `V3RateLimited`, `V3SessionExpired`, `V3PwaUpdate`) | static | `SYS-1` health, `SYS-2` notice | `SYS-5` feedback | `system:notice`, `server:restarting` |
| Command palette (`V3CommandPalette`) | — | `SYS-3` search | — | — |

---
## 4. Endpoint catalogue

### 4.0 How to read the tables

- **Auth:** `P` public · `P+` public, viewer optional (shape may add `me`) · `U` signed in (member or not) · `M` member (402 otherwise) · `M/L` member, or lapsed on GET if `LAPSED_READ=on` · `Pl` player of the game (implies `M` or `M/L`) · `O` owner of the resource · `H` tournament host or admin · `A` admin · `I` internal HMAC · `W` webhook signature · `C` cron bearer.
- **Common errors are implied** and not repeated: every route can return `internal`, `maintenance`, `upgrade_required`; `U` adds `unauthorized`; `M` adds `402 subscription_required {reason}` and `402 payment_update_required`; any body adds `invalid_json`, `validation_failed`, `payload_too_large`; any `RL` adds `rate_limited`. The **Errors** column lists only the extra ones.
- **Cache:** the six tiers of §2.12 (`public-immutable`, `public-static`, `public-short`, `private-etag`, `no-store`, `sse`). A `public-*` tier is valid only on `P` routes that read no session; rows marked `P+` in revision 1 are split into a public path and a `no-store` `/me` path (§2.12), and the phase spec is authoritative for the split.
- **RL:** bucket name from §2.10, or `—`.
- **Status:** `NEW`, `CHANGE` (existing path, new contract), `KEEP`, `REPLACES <old>`. **Ph** is the phase that ships it. Rows rewritten in revision 2 use P1–P13; elsewhere the number is revision 1's 10-phase numbering, read through the crosswalk in §10 (0 = the P1 hotfix lane).
- Schemas named in `Code` font live in `@repo/contracts/http/<domain>`. Shapes in the tables are abbreviated; the important DTOs are spelled out after each table.
- Every route sets `export const maxDuration` explicitly: 10 s by default, 30 s for routes that call Dodo or Chess.com, 60 s for the coach stream and the daily cron.

### 4.1 Platform and system

| ID | Method · path | Auth | Request → response `data` | Errors | Cache | RL | Screens | Status · Ph |
|---|---|---|---|---|---|---|---|---|
| SYS-1 | `GET /api/health` | P | → `{ ok, buildId, env, time, db: { ok, ms } }` (`?deep=1` adds the DB probe; the default does no DB call so uptime checks never wake Neon) | — | no-store | edge only | Uptime monitor, `V3Offline` retry, PWA version check | REPLACES `GET /api/healthcheck` · 1 |
| SYS-2 | `GET /api/system/notice` | P | → `{ notice: SystemNotice \| null }` from Edge Config (`notice` key) | — | public-short (30 s, swr 60) | edge | `V3Maintenance` (page, in-game chip), Home banner | NEW · 9 |
| SYS-3 | `GET /api/search` (public scope) · `GET /api/me/search` (member scope) | P · M | `SearchQuery { q (2–64), types?: legend,opening,position,player,help, limit ≤ 10 }` → `{ results: [{ type, ref, title, subtitle, href, fen? }] }`; the member path adds `game` results from the viewer's own archive | — | public path `public-short` (300 s, reads no session); member path `no-store` | `search` | `V3CommandPalette`, 404 search | NEW · P11 |
| SYS-4 | `GET /api/return-target?path=` | P | `path` must pass `safeReturnPath` → `{ label, kind: legend_position\|opening\|legend\|page, fen?, orientation? }` or 204. Catalogue kinds only: for any app path (`/game/…`, `/review/…`, `/t/…`) it returns `{ label: <generic>, kind: "page" }` and **never a FEN** (a ref would otherwise publish a private position). Cache key = the normalised path without a query string | — | `public-short` (3600 s) | edge | Sign-in/up "you'll return to …", pricing banner | NEW · P1/P11 |
| SYS-5 | `POST /api/session/clear` | optional | → 204 with `Clear-Site-Data: "cache"` | — | `no-store` | — | `signOutEverywhere()` step before `clerk.signOut()` (shared devices) | NEW · P1 |
| SYS-5 | `POST /api/feedback` | U | `{ eventId?, message (1–2000), path }` → 204 (Sentry user feedback + `AuditLog`) | — | no-store | `feedback` | `V3Error500` "Report", global error | NEW · 9 |
| SYS-6 | `POST /api/reports` | U | `ReportBody { kind: player\|puzzle\|mistake\|coach_answer\|lesson\|position, targetRef, reason (enum), note? ≤ 500, fen? }` → 201 `{ ref }` | `not_found` (target) | no-store | `report` | Profile ⋯ Report, puzzle ⋯ Report a problem (RB W7), coach answer flag | NEW · 5/9 |
| SYS-7 | `GET /api/usernames/availability?u=` | U | `u: Username` → `{ available, reason?: taken\|reserved\|cooldown, suggestion? }` | — | no-store | `username` | `V4ProfileEdit`, onboarding | NEW · 9 |
| SYS-8 | `POST /api/contact` | P (+viewer) | `{ name, email, topic, message, website (honeypot), context? }` → 202 `{ reference: "RC-20418" }` | `validation_failed` with `fields` | no-store | `contact` + `checkBotId()` + idempotency | `V3Contact` | NEW · 9 |
| SYS-9 | `GET /api/openapi.json` | A (dev/preview only; 404 in production) | → OpenAPI 3.1 document | — | no-store | — | `/docs/api` (dev) | NEW · 1 |

```ts
type SystemNotice = { id: string; mode: "scheduled" | "active" | "resolved"; startsAt: string; endsAt: string;
  message: string; affects: ("all" | "online" | "coach" | "import")[]; restartAt?: string };
```

### 4.2 The viewer (`/api/me/*`), onboarding, preferences, notifications, account

| ID | Method · path | Auth | Request → response `data` | Errors | Cache | RL | Screens | Status · Ph |
|---|---|---|---|---|---|---|---|---|
| ME-1 | `GET /api/me` | U | → `Viewer` (below). One round trip (`getViewer()` with `relationLoadStrategy: "join"`, plus badge counts). **DB-only**: no `?refresh=billing` (billing refresh is `POST /api/billing/refresh`) | `not_found` (deleted) | `private-etag` | — | Shell refresh after focus, after checkout, after settings mutations | NEW · P1 (REPLACES `POST /api/user/sync`, `GET /api/user/email/[email]`, boot-time `GET /api/subscription`) |
| ME-2 | `GET /api/me/badges` | U | → `{ bankDue, trainDot, notificationsUnread, weaknessReady }` (3 index-only counts) | — | `private-etag` | — | Nav dots, Train hub numbers. Fallback when the socket is down: **on focus only, or at most every 10 min** in a visible tab (5 min equals Neon's suspend window, so a dead socket would keep the compute awake) | NEW · P5 |
| ME-3a | `GET /api/me/preferences` | U | → `{ prefs: PreferencesV1, version, updatedAt }` | — | private-etag (ETag = version) | — | Settings shell, board, sounds | NEW · 9 |
| ME-3b | `PATCH /api/me/preferences` | U | `{ patch: DeepPartial<PreferencesV1>, baseVersion }` → `{ prefs, version }`. Server deep-merges, validates with `PreferencesV1.parse`, bumps `version`, recomputes derived columns (`reminderUtcMinute`, quiet hours), then emits `prefs:updated` in `after()`. Last write wins per leaf; never 412 (IA §3.0.1) | — | no-store | — | `V4Settings{Board,Pieces,Sounds,Appearance,Notifications}`, Bot strength slider (PB A18), train prefs (RB W8), theme toggle | NEW · 9 |
| ME-4 | `PATCH /api/me/onboarding` | U | `{ step?: OnboardingStep, ratingBand?, ratingBandSource?, initialRating?, goals?: Goal[], dailyMinutes?: 5\|10\|20, complete?: true }` → `{ onboarding: { step, ratingBand, goals, dailyMinutes, onboardedAt } }`; on `complete` syncs the Clerk `md.onboarded` claim in `after()` | `conflict` (`plan_required`: complete while not entitled) | no-store | — | `V3Onb*` | REPLACES `POST /api/user/onboarding-skip` · 1 |
| ME-5 | `PUT /api/consent` | P (+viewer) | `{ analytics, replay, marketing, version, method: banner\|settings }` → `{ ok }` + `Set-Cookie: rc_consent` (stored on the user when signed in) | — | no-store | `consent` | `V3CookieConsent` bar and preferences | NEW · 9 |
| ME-6a | `GET /api/me/profile` | U | → `{ username, displayName, bio, country, visibility: public\|members\|private, avatarUrl, usernameChangeableAt }` | — | no-store | — | `V4ProfileEdit` | NEW · 9 |
| ME-6b | `PATCH /api/me/profile` | U | partial of the above minus `username` → same; `after()`: emit `profile:updated`, revalidate `player:<username>` | — | no-store | — | `V4ProfileEdit` | NEW · 9 |
| ME-7 | `PATCH /api/me/username` | U | `{ username }` → `{ username, usernameChangeableAt }`; writes `UsernameHistory` (old handle redirects 90 days), 30-day cooldown | `conflict` (`username_taken`), `forbidden` (cooldown, `details.until`) | no-store | `account-danger` | `V4ProfileEdit` | NEW · 9 |
| ME-8 | `POST /api/me/avatar/upload-url` | U | `{ contentType: image/png\|jpeg\|webp, bytes ≤ 2 MB }` → `{ uploadUrl (R2 presigned PUT, 5 min), publicUrl }`; the client then PATCHes `avatarUrl` | — | no-store | `username` | `V4ProfileEdit` | NEW · 9 |
| ME-9a | `GET /api/me/push-subscriptions` | U | → `{ items: [{ id, platform, createdAt, lastOkAt }] }` | — | no-store | — | `V4SettingsNotifications`, `prompt-notifications` | NEW · 9 |
| ME-9b | `POST /api/me/push-subscriptions` | U | `{ endpoint, keys: { p256dh, auth }, platform, userAgent }` → 201 `{ id, nextReminderAt }` (upsert by endpoint) | — | no-store | `push` | same | NEW · 9 |
| ME-10 | `DELETE /api/me/push-subscriptions/{id}` · `POST …/{id}/test` | O | → 204 · → 202 (worker sends a test push) | `not_found` | no-store | `push` | same | NEW · 9 |
| ME-11a | `GET /api/me/notifications?cursor&limit` | U | → `Paged<Notification>` + `meta.unread` | — | no-store | — | Inbox (IS Q13) | NEW · 9 |
| ME-11b | `POST /api/me/notifications/read` | U | `{ ids?: Ref[] ≤ 100, all?: true }` → `{ unread }` | — | no-store | — | same | NEW · 9 |
| ME-12 | `POST /api/me/blocks` · `DELETE /api/me/blocks/{username}` | U | `{ username }` → 201 · → 204 | `not_found` | no-store | `report` | Profile ⋯ Block | NEW · 9 |
| ME-13 | `POST /api/me/export` · `GET /api/me/export` · `GET /api/me/export/download` | U | → 202 `{ jobRef }` · → `{ status: queued\|running\|ready\|expired, readyAt?, expiresAt? }` · → 302 to a signed R2 URL (10 min) | `in_flight` (already running), `gone` (expired) | no-store | `account-danger` + idempotency | `V4SettingsAccount` "Download your data" | NEW · 9 |
| ME-14 | `GET /api/me/deletion-preview` | U | → `{ username, counts: { games, mistakes, linkedAccounts }, membership: { active, inTrial, periodEnd }, blockers: [in_game\|last_admin\|hosting_tournament] }` | — | no-store | — | `V4DeleteAccount` | NEW · 9 |
| ME-15 | `DELETE /api/me` | U + Clerk reverification (`auth().has({ reverification: "strict" })`) | `{ confirm: string }` → `{ deleted: true, emailMasked }`. One transaction (trial ledger, `AccountDeletion` outbox, anonymise shared games, delete private rows, delete user); external clean-up by the `account.purge` worker job (Dodo cancel, Clerk delete, Lichess revoke, R2, PostHog, Sentry, email) (IA §3.8) | `bad_request` (`confirm_mismatch`), `reverification_required`, `conflict` (`in_game`, `last_admin`) | no-store | `account-danger` | `V4DeleteAccount` | NEW · 9 |
| ME-16 | `GET /api/socket-token` | U | → `{ token, expiresAt }` (claims §2.11.5) | — | no-store | — | `RealtimeProvider` refresh (the first token comes from the layout) | CHANGE · 2 (claims v2, own secret) |
| ME-17 | `POST /api/email/unsubscribe?t=` | signed token | RFC 8058 one-click body `List-Unsubscribe=One-Click` → 200 (sets the channel's email flag false) | `gone` (bad/expired token) | no-store | edge | Email footers | NEW · 9 |
| ME-18 | `POST /api/push/clicked` | signed id | `{ notificationId, sig }` (beacon) → 204 | — | no-store | edge | Service worker `notificationclick` | NEW · 9 |

```ts
// @repo/contracts/http/me
type Viewer = {
  user: { ref: string; username: string; displayName: string; initials: string; avatarUrl: string | null;
          role: "user" | "admin"; timezone: string; ratingLabel: string | null /* "BLITZ 1184" */;
          onboarding: { step: OnboardingStep; done: boolean; ratingBand: string | null; goals: Goal[]; dailyMinutes: 5 | 10 | 20 | null } };
  entitlement: {
    state: "member" | "trial" | "grace" | "cancelling" | "lapsed" | "none";   // deriveMembershipState()
    planKey: "monthly" | "yearly" | "legacy" | null; interval: "month" | "year" | null;
    trial: { active: boolean; endsAt: string | null; daysLeft: number | null; eligible: boolean };
    periodEnd: string | null; cancelAtPeriodEnd: boolean;
    paymentIssue: null | { state: "grace" | "last_day" | "expired"; accessEndsAt: string };
    membershipEndedAt: string | null;
  };
  prefs: { version: number; theme: "light" | "dark" | "system"; sound: boolean; reducedMotion: boolean };  // full prefs via ME-3a
  badges: { bankDue: number; trainDot: boolean; notificationsUnread: number };
  accounts: { provider: "chesscom" | "lichess"; username: string; status: LinkedStatus; lastSyncAt: string | null }[];
  import: null | { runRef: string; provider: string; status: ImportStatus; imported: number; total: number | null; analysed: number };
  flags: Record<string, boolean>;          // server-evaluated PostHog flags (consent-aware)
  buildId: string;
};
```

The `(app)` layout calls the same `getShellState()` service that backs `ME-1`, so the API route exists only for client refreshes; a typical session calls it zero to two times.

### 4.3 Billing and membership

Phase 0 built the action routes under `/api/subscription/*` and the client already calls them (`MembershipSection.tsx:243-289`); they keep their paths and adopt the envelope. New reads go under `/api/billing/*`.

| ID | Method · path | Auth | Request → response `data` | Errors | Cache | RL | Screens | Status · Ph |
|---|---|---|---|---|---|---|---|---|
| BIL-1 | `POST /api/checkout` | U | `CheckoutBody { plan: monthly\|yearly, returnPath?, theme?, source: pricing\|onboarding\|paywall\|renew }` + `Idempotency-Key` → `{ checkoutUrl, sessionId, trial: boolean, chargeDate \| null, priceCents, currency, interval }`. Reuses `pendingCheckoutSessionId` < 30 min for the same plan; offers the trial only when `trialStartedAt IS NULL AND trialOfferedAt IS NULL` claimed by a conditional update (ADB §8.7); skips the live `subscriptions.list` guard unless the DB shows a non-terminal subscription (IP §1.5); email from the DB row, not `currentUser()` (`checkout/route.ts:50`) | `already_subscribed` (409), `payment_update_required` (402), `not_configured` (503), `upstream_unavailable` | no-store | `checkout` | `V3Pricing`, `V3OnbPlan`, `V3PaywallHard`, renew sheet | CHANGE · 1 |
| BIL-2 | `GET /api/billing/activation?session_id&subscription_id&status` | U | → `{ state: pending\|active\|failed, reason?: declined\|cancelled, entitlement: Viewer["entitlement"], trial: { active, endsAt, chargeDate }, plan: { interval, priceCents, legacy }, emailMasked, reference, waitedMs }`. Reads the DB; if still pending and `subscription_id` is present, retrieves that one subscription from Dodo once per 5 s and applies the snapshot; on the first `active` sets the `rc_act` cookie (HMAC, 120 s) so middleware lets the user through before the Clerk claim refreshes (IP §1.2 rule 8) | `upstream_unavailable` | no-store | `billing-refresh` (1 per 1.5 s) | `V3CheckoutActivating` (polling, success, stalled, failed), `V3OnbActivating` | NEW · 1 (REPLACES the 2 s × 6 `waitForEntitlement` polling of `/api/subscription`, `lib/billing/client.ts:22-23`) |
| BIL-3 | `GET /api/billing/membership` | U | → `Membership { state (12 V4Membership states), plan, interval, priceCents, periodEnd, trial, cancelAtPeriodEnd, scheduledChange?, pausedUntil?, paymentIssue?, legacy, actions }` from the DB only (no `?refresh=1`) | — | `private-etag` (ETag = `subscriptionUpdatedAt`) | — | `V4Membership*` | NEW · P10 |
| BIL-4 | `GET /api/billing/details` | U | → `{ card: { brand, last4, expMonth, expYear } \| null, invoices: [{ paymentId, date, amountCents, currency, status }] (last 12) }` from Dodo, cached 5 min server-side (`unstable_cache`, tag `billing:<customerId>`) | `upstream_unavailable` → degraded `{ card: null, invoices: [], degraded: true }` with 200 | no-store | — | `V4Membership` billing card | NEW · 9 |
| BIL-5 | `GET /api/billing/invoices/{paymentId}` | O | → PDF stream (ownership checked against `dodoCustomerId`), `Content-Disposition: attachment` | `not_found` | `no-store` (never `max-age`) | `invoice` (durable) | invoice row | NEW · P10 |
| BIL-6 | `GET /api/subscription/change-plan` | U | → plan options for the switch modal (as today) | `upstream_unavailable` | no-store | — | `V4PlanSwitch` | KEEP (envelope) · 1 |
| BIL-7 | `POST /api/subscription/change-plan` | U | `{ plan }` + `Idempotency-Key` (required, it charges proration) → `{ membership: Membership, message }` | `conflict` (rules in `subscription-action-rules.ts:118-186`), `upstream_unavailable` | no-store | `billing-action` | `V4PlanSwitch` | KEEP + idempotency · 1 |
| BIL-8 | `POST /api/subscription/change-plan/preview` | U | `{ plan }` → `{ prorationCents, nextChargeAt, … }` (as today) | `upstream_unavailable` | no-store | `billing-action` | `V4PlanSwitch` | KEEP · 1 |
| BIL-9 | `DELETE /api/subscription/change-plan` | U | → `{ membership }` (cancel a scheduled change) | `conflict` | no-store | `billing-action` | `V4Membership` scheduled change | KEEP · 1 |
| BIL-10 | `POST /api/subscription/cancel` | U | `{ reason?, comment?, offerShown?: pause\|yearly\|none }` → `{ membership }` (forwards `cancel_reason`, `cancellation_feedback` to Dodo `subscriptions.update`) | `conflict` (already cancelling) | no-store | `billing-action` | `V4CancelSub` | KEEP + fields · 9 |
| BIL-11 | `POST /api/subscription/resume` | U | → `{ membership }` | `conflict` | no-store | `billing-action` | `V4Membership` cancelling | KEEP · 1 |
| BIL-12 | `POST /api/subscription/pause` | U | `{ months: 1\|2\|3 }` + idempotency → `{ membership }` (Dodo `subscriptions.update { pause: true }` + `pausedUntil`; the worker's `membership.autoresume` job resumes) | `conflict`, `upstream_unavailable` | no-store | `billing-action` | `V4CancelSub` retention offer | NEW · 9 (if the owner keeps pause, §11 Q6) |
| BIL-13 | `POST /api/subscription/payment-method` | U | idempotency → `{ paymentLink, expiresOn }` (Dodo `subscriptions.updatePaymentMethod(subId, { payment_method: { type: "new", return_url } })`) | `upstream_unavailable` | no-store | `billing-action` | `V3PaymentFailed`, membership card | NEW · 9 |
| BIL-14 | `POST /api/billing/portal` | U | `{ returnPath? }` → `{ url }` (Dodo customer portal session) | `not_found` (no customer) | no-store | `billing-action` | "Manage billing" | NEW · 9 (REPLACES the side-effecting `GET /api/customer-portal`, which stays one release as a 302 alias) |
| BIL-15 | `GET /api/subscription` | U | → `SubscriptionResponse` as today (`subscription/route.ts:22-38`) but **DB-only** | — | `no-store` | — | old clients only | CHANGE · P1, then remove after the shell ships |
| BIL-16 | `POST /api/billing/refresh` | U | → `Membership`; re-reads the subscription from Dodo and applies it with the compare-and-set (Dodo's `updated_at` as the event time) | `upstream_unavailable` | `no-store` | `billing-refresh` | "Refresh" on membership and activation screens; replaces every refresh-by-GET | NEW · P1 |

Billing invariants the routes keep:

- The entitlement columns on `User` are the source of truth; Dodo is read only by the webhook, `BIL-2`, `?refresh` paths and the daily reconcile cron.
- Every applied snapshot (webhook or API) goes through `applySubscriptionSnapshot` with a conditional update on `subscriptionSourceAt` (ADB §8.7), writes nothing when the fields are unchanged, and then in `after()`: syncs the Clerk `md` claim, emits `entitlement:changed`, releases `WAITING_FOR_MEMBERSHIP` import runs.

### 4.4 Linked accounts and import

Paths follow B10 and P4 (authoritative): accounts under **`/api/accounts/*`**, import runs under **`/api/import/*`**. Revision 1's `/api/me/linked-accounts/*` and `/api/me/imports*` names below are aliases for the same contracts (Appendix C). "Sync now" is optimistic: the row flips to `syncing` in `onMutate` and rolls back on `429 rate_limited {source}` with the countdown.

| ID | Method · path | Auth | Request → response `data` | Errors | Cache | RL | Screens | Status · Ph |
|---|---|---|---|---|---|---|---|---|
| ACC-1 | `GET /api/accounts` | U | → `{ items: LinkedAccountView[] }` with the active import job per provider | — | private-etag (ETag = max `updatedAt`) | — | `V4SettingsConnected` (all 10 states), onboarding link | NEW · 4 |
| ACC-2 | `POST /api/accounts/chesscom/lookup` | U | `{ username: /^[A-Za-z0-9_-]{1,25}$/ }` → `{ status: found\|private\|no_games, profile: { username, displayUsername, name, avatar, country, joinedAt, title }, ratings: { rapid, blitz, bullet, daily }, totalRatedGames, recentGames: [{ opponent, opponentRating, result, opening, endedAt, timeClass }] (≤ 5) }`. Calls Chess.com **serially** (profile then stats; fixes the `Promise.all` at `lib/chess-com.ts:52`), `encodeURIComponent`, 5 s timeout, User-Agent with contact, shared 10-min cache per handle | `not_found` (no such player), `conflict` (`linked_elsewhere`), `upstream_rate_limited`, `upstream_unavailable`, `upstream_unavailable` | no-store | `lookup` | `V3OnbLink`, `V3OnbPreview`, `V4SettingsConnected` | REPLACES `POST /api/user/chess-com-profile/preview` · 4 |
| ACC-3 | `POST /api/accounts/chesscom` | U | `{ username }` → 201 `{ account: LinkedAccountView, importRun: { ref, status } }`. Creates the account (status `syncing`) and an `IMPORT_ACCOUNT` job (`WAITING_FOR_MEMBERSHIP` for non-members, IA §3.7 edge case); wakes the worker in `after()` | `conflict` (`linked_elsewhere`, `already_linked`) | no-store | `link` | same | REPLACES `POST /api/user/chess-com-profile` (minus the `onboarded=true` write) · 4 |
| ACC-4 | `POST /api/accounts/{provider}/sync` | M | → 202 `{ job: { ref, status } }` | `upstream_rate_limited` (`nextAllowedSyncAt`), `in_flight` (`sync_running`) | no-store | `sync` | Connected "Sync now" | NEW · 4 |
| ACC-5 | `PATCH /api/accounts/{provider}` | U | `{ autoImport: boolean }` → `LinkedAccountView` | `not_found` | no-store | — | auto-import switch | NEW · 4 |
| ACC-6 | `DELETE /api/accounts/{provider}?deleteGames=true\|false` | U | → `{ removedGames?: number }` (sync part: unlink; with `deleteGames`, an `import.purge` job; Lichess token revoke in the job) | `not_found` | no-store | — | Disconnect confirm | NEW · 4 |
| ACC-7 | `GET /api/me/imports` | U | → `{ runs: [{ ref, provider, status, imported, total, analysed, error, updatedAt }], firstReviewGameRef?, momentsFound? }` (active and last 5) | — | private-etag (ETag) | — | Home `import_running`, `V3OnbDone`, archive banner (fallback to `import:*` events) | NEW · 4 (REPLACES `/api/import/status`, `/api/me/import-status` names in IP, IS, PB) |
| ACC-8 | `POST /api/me/imports/{ref}/retry` | M | → 202 `{ run: { ref, status: "queued" } }` | `not_found`, `conflict` (not failed) | no-store | `sync` | failed import row | NEW · 4 |
| OAU-1 | `GET /api/oauth/lichess/start?returnTo=` | U | → 302 to `https://lichess.org/oauth?response_type=code&client_id=playchess.tech&redirect_uri=<origin>/api/oauth/lichess/callback&code_challenge_method=S256&code_challenge=…&state=…` (no scopes, RS R-LI-04) and sets `rc_lichess_pkce` (httpOnly, Secure, Lax, 10 min, HMAC `{ verifier, state, returnTo }`) | — | no-store | `link` | Connect Lichess (onboarding, settings) | NEW · 4 |
| OAU-2 | `GET /api/oauth/lichess/callback?code&state` · `?error=access_denied` | U | → 302 to `returnTo?lichess=linked\|denied\|error`. Server: `POST https://lichess.org/api/token` (form: `grant_type, code, code_verifier, redirect_uri, client_id`), `GET /api/account`, upsert the account with the AES-256-GCM token (`LINKED_ACCOUNT_KEY`), create the import job | redirect only (no JSON) | no-store | — | `li_connecting`, `li_denied`, linked | NEW · 4 |

```ts
type LinkedAccountView = {
  ref: string; provider: "chesscom" | "lichess"; username: string; displayName: string | null; avatarUrl: string | null;
  ratings: Partial<Record<"bullet" | "blitz" | "rapid" | "daily" | "classical", { rating: number; best: number | null }>>;
  status: "linked" | "syncing" | "error" | "rate_limited" | "revoked" | "waiting_for_membership";
  autoImport: boolean; lastSyncAt: string | null; lastSyncOkAt: string | null; nextAllowedSyncAt: string | null;
  importedCount: number; skippedCount: number;
  lastError: null | { code: "not_found" | "closed" | "upstream" | "timeout" | "rate_limited"; at: string };
  job: null | { ref: string; status: "queued" | "running"; imported: number; total: number | null; startedAt: string };
};
```

Import itself never runs in a Vercel function (RS R-IMP-03): the routes enqueue, wake the worker and return.

### 4.5 Public catalogue and Learn

The public pages (`/legends/**`, `/openings/**`, `/learn/**`, `/legends/positions/**`) are ISR server components reading `unstable_cache` loaders with tags (IP §1.3, RB §5.3); the JSON routes below exist for client islands (search boxes, filters, "load more") and for the Play hub. None of them takes a session, so all of them are CDN-cacheable. Member progress on these pages is a separate private call (`LRN-1`), so the HTML stays static.

| ID | Method · path | Auth | Request → response `data` | Errors | Cache | RL | Screens | Status · Ph |
|---|---|---|---|---|---|---|---|---|
| CAT-1 | `GET /api/legends` | P | `?visible=true` → `LegendCard[] { slug, name, years, country, style, portraitUrl, positionsCount, lessonsCount }` (≤ 60 rows, slim DTO; no `achievements`/`famousGames` JSON) | — | public-static tag `legends` | edge | Play hub Legend tab, legends catalogue islands, admin pickers | CHANGE · 8 (adds CDN cache and a slim select; `api/legends/route.ts:20-42` returns 17 columns uncached) |
| CAT-2 | `GET /api/openings/{slug}` | P | → `{ slug, eco, name, family, fen, plies: { san[], uci[] }, moveNotes?: { ply, text }[], explanationUrl? }` | `not_found` | public-static tag `opening:<slug>` | edge | Opening stepper when switching lines client-side, drill | NEW · 8 |
| CAT-3 | `GET /api/openings` | P | `?q (≥ 2)&family=A..E&cursor&limit ≤ 48&v=` → `Paged<{ slug, eco, name, line, fen }>`; `pg_trgm` on `name` | — | public-static (`s-maxage=86400, swr=604800`, tag `openings`; per-URL because of `q`) | edge (`search` per IP) | Openings catalogue search, Play hub opening picker | CHANGE · 8 (today: auth required, all 3,641 rows per call, in-memory limiter, `api/openings/route.ts:11-34`) |
| CAT-4 | `GET /api/positions/{slug}` | P | → `{ slug, title, white, black, event, year, fen, sideToMove, heroSide, themes, blurb, tc, eco, openingName, legendRefs: { white?, black? }, priorMovesSan[], startPly }` (never the legend's next move) | `not_found` | public-static tag `position:<slug>` | edge | `V3TryPosition` refresh, legend practice prefetch | REPLACES `GET /api/position/[referenceId]` (PB A3) · 8 |
| CAT-5 | `GET /api/positions` | P | `?collection=featured\|legend-practice\|legend:<slug>&theme&q&cursor&limit ≤ 20` → `Paged<PositionCard>` + `meta.themes: [{ key, count }]`, `meta.hint?` ("Capablanca positions arrive in December") | — | public-static tag `positions` (`q` → public-short 600 s) | edge | `V3TryCatalogue`, Play hub Legend tab | REPLACES `GET /api/chess-positions/featured` (dead) and PA's `/api/positions/featured`, `/api/positions/search` · 8 |
| LRN-1 | `GET /api/learn/progress?legend=<slug>\|scope=all` | M | → `LessonProgressSummary { legends: [{ legendSlug, done, total, nextSlug, lessons: [{ slug, status, bestStars }] }] }` | — | no-store | — | Legend detail island "Lessons with Morphy · 2 of 5", Train hub | NEW · 8 |
| LRN-2 | `POST /api/learn/lessons/{slug}/progress` | M | `LessonEvent` (`start`, `checkpoint {ply, result}`, `position {ply}`, `complete {hints, shown, firstTry}`; idempotent on `eventId`; beacon-capable) → `LessonProgressOut { status, stars, bestStars, milestone, next }` | `not_found` | no-store | `train-write` | `V3LessonPlayer`, `V3LessonComplete` | NEW · 8 |
| LRN-3 | `POST /api/learn/openings/{slug}/drill` | M | `{ clientAttemptId, mistakes, hintsUsed, timeMs }` → `{ card: { ref, due, dueLabel } }` (creates or reviews an `OPENING` deck card) | `not_found` | no-store | `train-write` | Opening line drill "Come back tomorrow…" | NEW · 8 |

Lesson content itself is served by the lesson page RSC (`unstable_cache(['lesson', slug, contentVersion])`, tag `lesson:<slug>`); audio and word alignment are immutable R2 files. There is no lesson JSON endpoint.

### 4.6 Play: local games, challenges, shared positions, practice, archive

Live human games (quick match, friend, tournament) are created and played over the socket and the internal routes (§4.14, §6). The HTTP routes here cover the browser-run games (bot and legend-vs-engine), friend challenge links, shared positions, and the reads around games.

| ID | Method · path | Auth | Request → response `data` | Errors | Cache | RL | Screens | Status · Ph |
|---|---|---|---|---|---|---|---|---|
| PLAY-1 | `POST /api/games` | M | `GameCreateBody { mode: bot\|legend_bot, positionSlug? \| sharedCode? \| fen?, color?: w\|b\|hero\|random, botElo: 400..2200, tc?: TimeControl, parentGameRef?, reason?: rematch\|restart\|next }` + `Idempotency-Key` (required) → 201 `{ game: { ref, mode, startFen, startPly, priorMovesSan[], you: w\|b, bot: { elo, name, persona }, tc, clocks: { w, b }, studySeconds: 30\|0, position: { slug, title, header, heroSide, blurb } \| null, next: { slug, title } \| null } }`. Reuses an `in_progress` `legend_bot` game on the same position with < 2 plies; `restart` aborts the parent | `illegal_position` (bad FEN), `not_found` (position/share) | no-store | `create-game` | Play hub Bot tab, `V3TryPosition` Play, legend practice Next/Restart, Practice "Play vs bot" | REPLACES `POST /api/chess/create-ai-game` · 2/8 |
| PLAY-2 | `GET /api/games/{ref}` | Pl (spectator view when `visibility=public` and live) | → `GameSnapshot` (role-aware projection: players, tc, status, mode, `movesUci`, clocks, result, position, `tournamentRef`; never `traceContext`) | `not_found` | no-store | — | Resume a bot game on another device, RSC fallback for the game page | REPLACES the browser use of `GET /api/chess/game-by-ref/[ref]` (public today, AA F-04) · 2 |
| PLAY-3 | `POST /api/games/{ref}/checkpoint` | Pl (bot games only) | `{ ply, movesUci, clocks: { w, b }, startedAt?, assists: { hints, undos } }` as JSON or `text/plain` (sendBeacon) → 204. Ply-guarded (`plyCount < $ply`), replays the moves with chess.js before writing | `illegal_moves`, `conflict` (`version_mismatch`, stale ply: ignored with 204 for beacons) | no-store | `train-write` | Bot game `pagehide`/`visibilitychange` | NEW · 2 |
| PLAY-4 | `POST /api/games/{ref}/complete` | Pl (bot games only) | `{ movesUci, result: w\|b\|draw\|aborted, method, clocks, endedAtClient, assists }` → `{ status: completed\|aborted, outcome, method, comparison: LegendComparisonFacts \| null, analysis: { status: queued\|skipped, etaSec }, bank: { pending: boolean }, next: { slug, title } \| null }`. Server replays from `startFen`; checkmate, stalemate, threefold, fifty-move and insufficient material must match the board; resignation, timeout and agreement are accepted as claimed (unrated). One transaction writes the game, `GamePlayer`, legend comparison facts and the `ANALYZE_GAME` job; `after()` wakes the worker. Idempotent on `ref` | `illegal_moves`, `conflict` (`already_completed` with the stored result → 200 replay) | no-store | `create-game` | Bot / legend game over | NEW · 2/8 |
| PLAY-5 | (superseded) `GET /api/games/{ref}/status` | Pl | use `GET /api/review/{ref}/status` (REV-1s, `qk.review.status(ref)`, P3-D2); bank counts arrive on `analysis:done.bank` | — | — | — | — | superseded · P3 |
| PLAY-6 | `GET /api/games/{ref}/pgn?annotated=true` | Pl | → `text/x-chess-pgn`, `Content-Disposition: attachment; filename="replaychess-<ref>.pgn"`; `annotated` adds `%clk`, `%eval` and NAG comments | `not_found` | **`private, no-store`** (a download; never `immutable`) | `export-pgn` | Review ⋯ Download PGN, game over | NEW · P2/P3 |
| PLAY-7 | (moved) `GET /api/review/{ref}/legend` | Pl | see REV-9 and REV-10 (§4.7): the GET never enqueues; `POST …/legend/compute` does | — | `private-etag` | — | `V3LegendCompare` | moved · P3 |
| PLAY-8 | `POST /api/games/{ref}/legend-comparison/retry` | Pl | → 202 | `conflict` (not failed) | no-store | 3/h per game | compare `failed` | NEW · 8 |
| PLAY-9 | `GET /api/practice/context?game=&ply= \| position= \| share= \| fen=` | M | → `{ fen, sideToMove, humanColor, title, fromLabel, botElo, backHref, coachHint: { text, verified } \| null }`; FEN validated | `illegal_position`, `not_found` | `private-etag` (no `max-age`) | — | `V3Practice` (RSC uses the service) | NEW · P3/P8 |
| PLAY-10 | `GET /api/me/games?source=&result=&tc=&moments=&q=&legend=&tournament=&cursor=&limit ≤ 30` | M/L | → `Paged<UserGameRow>`; `meta.counts: { all, replay, chesscom, lichess }` and `meta.filteredTotal` **only on page 1** (no `cursor`) or with `limit=0`; later pages return `meta: { nextCursor }` only. Keyset over `game_players (userId, endedAt DESC, gameId DESC)` | — | `private-etag` (ETag = `"g<gamesVersion>.<filterHash>"`, free because the viewer is loaded) | — | `V3GamesArchive*`, Home recent games refresh | NEW · P3 |
| PLAY-11 | `GET /api/me/games/export?format=pgn&refs= \| all=true` | M | → streamed PGN (≤ 500 games), `Content-Disposition: attachment` | `bad_request` (> 500) | no-store | `account-danger` | Archive bulk select → Export | NEW · 9 |
| PLAY-12 | `GET /api/games/{ref}/tournament-result` | Pl | → `{ pointsAwarded, fire, rank, of, endsAt, nextAction }` | `not_found` | no-store | — | Tournament game over (fallback when `game:result` was missed) | NEW · 8 |
| PLAY-13 | (withdrawn) `GET /og/game/{ref}` | — | Game images are served **only through shares**: `/r/{code}/opengraph-image?v=` (SHR-1, §2.12). A `public` image on a player-only route would be cached by the CDN and served to anyone with the ref, and a signed URL without expiry cannot be revoked. An in-app share-sheet preview renders on the client (the board is SVG) | — | — | — | — | withdrawn |
| CHL-1 | `POST /api/challenges` | M | `ChallengeCreateBody { startFrom: start\|legend\|shared, positionSlug?, sharedCode?, tc: TimeControl, color: w\|b\|random, rated?: boolean }` + `Idempotency-Key` → 201 `{ code, url: "https://playchess.tech/join/<code>", expiresAt }` (24 h; max 5 open per user, oldest auto-cancelled) | `not_found` | no-store | `create-game` | `V3ChallengeShare`, legend detail Challenge, Review share "Challenge a friend" | REPLACES `POST /api/chess/create-game` (friend mode) · 2 |
| CHL-2 | `GET /api/challenges/{code}` | P | → `{ status: open\|accepted\|expired\|cancelled, creator: { username, displayName, initials, avatarUrl, rating, pool }, tc, rated, youPlay, position \| null, gameRef? }` (no email, no internal ids, **no session read**); `isOwn` is computed on the client from `qk.me()` | `not_found` | `public-short` (10 s) | edge | Challenge accept (signed in/out), share page | REPLACES `GET /api/chess/game-by-ref` on the join page · P9 |
| CHL-3 | `POST /api/challenges/{code}/accept` | M | → `{ gameRef }`. One transaction: conditional `UPDATE challenges … WHERE code=$c AND status='open' AND "expiresAt" > now() AND "creatorId" <> $me RETURNING *` + create the `Game` with colours resolved; `after()`: `/internal/emit` `challenge:accepted { code, gameRef }` to `user:<creator>` | `conflict` (`already_started` + `gameRef`, `own_link`), `gone` (expired, cancelled) | no-store | `create-game` | Challenge accept | REPLACES `POST /api/chess/join` · 2 |
| CHL-4 | `POST /api/challenges/{code}/decline` | U | → 204; emits `challenge:declined` to the creator | `gone` | no-store | `create-game` | Challenge accept "Decline" | NEW · 2 |
| CHL-5 | `DELETE /api/challenges/{code}` | O | → 204 (`status=cancelled` only while `open`) | `conflict` (`already_started`) | no-store | — | Challenge share "Cancel" | REPLACES `POST /api/chess/cancel-game` · 2 |
| SP-1 | `POST /api/shared-positions` | M | `{ positionSlug? \| fen?, sourceGameRef?, sourcePly?, note? ≤ 140 (plain text, URLs stripped) }` + idempotency → 201 `{ code, url: "/s/<code>" }` | `illegal_position` | no-store | `share` | Review, compare, practice, catalogue "Share position" | NEW · 8 |
| SP-2 | `GET /api/shared-positions/{code}` | P | → `{ fen, sideToMove, note, title, source: { kind, label } \| null }` | `gone` (revoked) | public-short (3600 s, tag `shared:<code>`) | edge | `/s/<code>` (`V3PositionShare`) islands | NEW · 8 |
| SP-3 | `DELETE /api/shared-positions/{code}` | O | → 204 (`revokedAt`; purge tag) | — | no-store | — | sharer revokes | NEW · 8 |

Live-game creation paths for completeness: quick match → `queue:join` → socket pairs → `INT-3`; tournament → socket pairer → `INT-10`; friend → `CHL-3`; rematch → `game:rematch accept` → `INT-8`.

### 4.7 Review, analysis and shares

All review routes are player-only (`Pl`, 404 for anyone else), with `M/L` so the owner can approve "past reviews stay readable" (B26) without code changes. The root is **`/api/review/[ref]`** (B21, P3-D1; P3 §7.2 is authoritative for the exact routes). **No GET in this section enqueues work or calls a provider** (api-perf AP-09): `POST …/analyse` and `POST …/legend/compute` are the only enqueues, and a status read may at most re-kick through the `jobs."lastKickAt"` compare-and-set (≤ 1 kick per job per 30 s).

| ID | Method · path | Auth | Request → response `data` | Errors | Cache | RL | Screens | Status · Ph |
|---|---|---|---|---|---|---|---|---|
| REV-1 | `GET /api/review/{ref}` | Pl · M/L | → `ReviewData` (below; ~4 KB, ~1.5 KB brotli). Pure read; no enqueue, no text-step trigger (the review **RSC page** may lazily enqueue `REVIEW_TEXT` in `after()`, never on a prefetch, P7 D24) | `not_found` | `private-etag` (strong ETag `"<analysisVersion>.<gradedPlies>"`); TanStack `staleTime: Infinity` once `done` | — | `V3ReviewAnalysing`, `V3ReviewSummary`, `V3KeyMoments`, `V3ReviewClean`, `V3ReviewFailed`, `V3RvComplete` | REPLACES `GET /api/analysis/[gameId]` · P3 |
| REV-1s | `GET /api/review/{ref}/status` | Pl · M/L | → `{ status: none\|queued\|running\|writing\|done\|failed, progress: { done, total }, etaSec? }`; runs the `lastKickAt` CAS and kicks only when it returns a row | `not_found` | `private-etag` | — | fallback poll while the socket is down (visible tab, stops after 3 min) | NEW · P3 |
| REV-3 | `POST /api/review/{ref}/analyse` | Pl · M | `{ priority?: "now" }` → 202 `{ status, position, etaSec }`. Idempotent upsert of `ANALYZE_GAME` by `dedupeKey = analyze:<gameId>` at `JOB_PRIORITY.USER_OPENED`; re-queues a retryable failure (this is also "Retry") | `gone` (`terminal` after the fourth failure) | `no-store` | 10 / 60 burst | Unanalysed game "Analyse", Retry | NEW · P3 |
| REV-4 | `PATCH /api/review/{ref}/progress` | Pl · M | `{ momentIndex, events: [...] (≤ 50) }` → 204 (keepalive-capable) | — | `no-store` | `train-write` | Key moments walkthrough | NEW · P3 |
| REV-5 | `PATCH /api/review/{ref}/moments/{momentId}` | Pl · M | `{ inBank: boolean }` → `{ inBank, card: { ref, dueAt } \| null }` (optimistic toggle; writes `player_reviews.progress.bankOptOut` with `jsonb_set`, links through `mistake_occurrences`) | `not_found` | `no-store` | `train-write` | Moment "Add to bank" | NEW · P3/P5 |
| REV-6 | `POST /api/review/{ref}/complete` | Pl · M | → `{ accuracy, moments, toDrill, nextDueAt, bestThisMonth, brilliant, drillHref }` (idempotent) | `conflict` (analysis not done) | `no-store` | — | `V3RvComplete` | NEW · P3 |
| REV-7 | `POST /api/review/{ref}/shares` | Pl · M | `{ showUsername, momentId? }` + idempotency → 201 `{ code, url: "/r/<code>", expiresAt (30 d), imageUrl }` | — | `no-store` | `share-create` (durable) | `V3RvShare` | NEW · P3 |
| REV-8 | `POST /api/review/batch` | M | `{ gameRefs: Ref[] (1–50) }` → 202 `{ queued, skipped }` at `JOB_PRIORITY.REVIEW_BATCH` | — | `no-store` | `review-batch` (durable) | Archive bulk "Review selected" | NEW · P10 |
| REV-9 | `GET /api/review/{ref}/legend` | Pl · M/L | → `LegendComparison`; may insert the derived **facts** row (idempotent, no engine time; registered side effect `legend_facts`); **never** enqueues `LEGEND_COMPARE` | `not_found` | `private-etag` | — | `V3LegendCompare`, Review › Legend; hover prefetch allowed | NEW · P3 |
| REV-10 | `POST /api/review/{ref}/legend/compute` | Pl · M | → 202 `{ status }`; the only `LEGEND_COMPARE` enqueue | — | `no-store` | `legend-retry` (durable) | "Compare with the legend" | NEW · P3 |
| REV-11 | `GET /api/review/{ref}/pgn?annotated=true` | Pl | → `text/x-chess-pgn` attachment (P3 A8) | `not_found` | `no-store` (attachment) | `export-pgn` | Review ⋯ Download PGN | NEW · P3 |
| SHR-1 | `GET /r/{code}` (page) · `/r/{code}/opengraph-image?v=` · `/r/{code}/image?download=1` | P | → HTML from a frozen snapshot, `robots: noindex` in `metadata` and `X-Robots-Tag: noindex` from `next.config.js` `headers()` (never `headers()` in the page, which would make it dynamic) · PNG | 404 / 410 | ISR tag `share:<code>`; not-found branch cached ≤ 1 day; image per §2.12 | edge | public share page | NEW · P3 |
| SHR-2 | `PATCH /api/shares/{code}` | O | `{ showUsername }` → `{ code, showUsername }`; `revalidateTag` + `invalidateByTag('share:'+code)` (page and image) | `not_found` | `no-store` | — | share sheet toggle | NEW · P3 |
| SHR-3 | `DELETE /api/shares/{code}` | O | → 204 (revoke; purge page and image) | — | `no-store` | — | share sheet "Stop sharing" | NEW · P3 |

```ts
// @repo/contracts/http/review  (columnar plies: FENs are computed on the client from startFen + uci)
type ReviewData = {
  game: { ref: string; source: "replay" | "chesscom" | "lichess"; mode: GameMode; tc: { label: string; timeClass: TimeClass };
          opening: { eco: string; name: string } | null; result: "1-0" | "0-1" | "1/2-1/2"; method: EndMethod;
          playedAt: string /* game_players."endedAt" */; startFen: string; startPly: number; legend: { slug: string; name: string } | null };
  players: { w: ReviewPlayer; b: ReviewPlayer }; you: "w" | "b";
  analysis: { status: "queued" | "running" | "writing" | "done" | "failed"; version: number; gradedPlies: number;
              totalPlies: number; engine: string; nodes: number; failedAtPly: number | null; retryable: boolean };
  plies: { san: string[]; uci: string[]; cp: (number | null)[]; mate: (number | null)[]; bestUci: (string | null)[];
           j: Judgement[]; acc: (number | null)[]; clockMs: (number | null)[] };
  counts: { you: Record<Judgement, number>; opp: Record<Judgement, number> };
  accuracy: { you: number | null; opp: number | null; phases: { opening: number | null; middlegame: number | null; endgame: number | null } };
  phases: { line: string; middlegamePly: number | null; endgamePly: number | null };
  summary: { status: "pending" | "ready" | "template"; sentences: string[]; verified: boolean };
  moments: { id: string; ord: number; ply: number; judgement: Judgement; playedSan: string; bestSan: string;
             accept: string[]; line: string[]; ask: string; why: string[]; plan: Record<"attack" | "defend" | "trade" | "improve" | "unsure", string>;
             inBank: boolean; attempts: number; result: "found" | "missed" | null }[];
  clean: { isClean: boolean; bestPly: number | null; bestText: string | null };
  progress: { momentIndex: number; startedAt: string | null; completedAt: string | null };
  share: { code: string; expiresAt: string } | null;
};
```

There is no review-specific realtime token and no `review:<ref>` room: progress goes to the players' `user:{ref}` rooms (`analysis:*`, §6).

### 4.8 Coach

Protocol details (SSE frames, verification, cancellation, time budget) are in §7. All coach routes are `M` (the paywall sheet `V3CoachPaywall` handles a 402 mid-session, RA Q1) and player-scoped when a game is in context.

| ID | Method · path | Auth | Request → response `data` | Errors | Cache | RL | Screens | Status · Ph |
|---|---|---|---|---|---|---|---|---|
| CO-1 | `GET /api/coach/context?gameRef=&ply=&mistakeRef=&kind=explain\|ask\|whatif` | M (+Pl when `gameRef`) | → `{ thread: { ref, title } \| null, messages: CoachMessageView[] (last 20), suggestions: { key, label }[] (chips; memoised 10 min per context), quota: { state: ok\|low\|reached, remainingToday, remainingMonth, resetsAt, label }, explain: { cached: CoachMessageView \| null } }` (a key moment's stored verified `why` answers "Explain 19.Qd2" without an LLM call) | `not_found` | no-store | — | `V3CoachSuggested`, `V3CoachExplain`, phone starter line | NEW · 7 (absorbs IS `GET /api/coach/suggestions`) |
| CO-2 | `GET /api/coach/threads/{ref}/messages?before=&limit ≤ 30` | O | → `Paged<CoachMessageView>` (newest first) | `not_found` | no-store | — | scroll-back in a thread | NEW · 7 |
| CO-3 | `POST /api/coach/messages` | M (+Pl) | `CoachAsk { clientId: uuid, gameRef?, ply?, mistakeRef?, threadRef?, kind: chip\|typed\|whatif\|explain, chipKey?, question (1–600), whatIfUci? }` → `200 text/event-stream` (§7). Pre-stream failures are JSON | `in_flight` (one answer streaming per user, 90 s window), `fair_use_limit`, `not_found` | no-store | `coach-burst` + fair-use quota | `V3CoachTyping`, `V3CoachStreaming`, `V3CoachError`, `V3CoachRateLimit` | NEW · 7 |
| CO-4 | `POST /api/coach/messages/{ref}/retry` | O | → SSE (regenerates an `error`, `aborted` or `fallback` answer; charged only on `done`) | `conflict` (already done), `in_flight` | no-store | `coach-burst` | "Try again" | NEW · 7 |
| CO-5 | `GET /api/coach/messages/{ref}` | O | → `CoachMessageView { ref, role, status: streaming\|done\|aborted\|fallback\|error, sentences[], verified, annotations?, engineLine?, createdAt }` | `not_found` | no-store | — | Recovery after a dropped stream (shows what was verified so far) | NEW · 7 |
| CO-6 | `POST /api/coach/hint` | M | `{ fen, level: 1\|2, bestUci, pv: Uci[] (≤ 6) }` → `{ text, verified, highlight: string[] }`; level 1 is a template; answers cached in the Next data cache by `(fen, bestUci, level)` 30 days | `illegal_position`, `validation_failed` (bestUci illegal) | `no-store` (**no `Cache-Control: max-age`**: browsers never reuse POST responses) | `coach-hint` | Practice hint card, bot game assist, puzzle hint | NEW · P7/P8 |
| CO-7 | `POST /api/coach/messages/{ref}/feedback` | O | `{ rating: up\|down, reason?: wrong_move\|wrong_eval\|unclear\|other, note? ≤ 300 }` → 204 (feeds the monthly ACT-Eval audit, RS R-QA-01) | `not_found` | no-store | `report` | thumbs on an answer | NEW · 7 |

### 4.9 Train: Mistake Bank, puzzles, sessions, weakness

From RB §4 with the canonical paths. Moves are validated in the browser against the precomputed solution (RB D3), so the server is called once per item at grade time.

| ID | Method · path | Auth | Request → response `data` | Errors | Cache | RL | Screens | Status · Ph |
|---|---|---|---|---|---|---|---|---|
| TR-1 | `GET /api/train/today` | M | → `TrainToday` (RB §4.3: streak, plan steps, due preview ≤ 4, next batch, all-training cards, mastery bars). Computed lazily once per local day into `daily_plans` (IS §8 item 6) | — | no-store | — | `V3TrainHub`, `V3TrainHubDone` | NEW · 5 |
| TR-2 | `GET /api/train/bank?view=due\|all&theme=&phase=&source=own\|missed&cursor=&limit ≤ 50` | M | → `BankPage` (state, counts, rows (never the solution), facets via `GROUPING SETS`, upcoming, nextBatch, emptyCtas) | — | no-store | — | `V3MistakeBank`, `V3BankEmpty`, `V3BankCaughtUp`, device variants | NEW · 5 |
| TR-3 | `GET /api/train/sessions/{ref}?include=items\|summary` | O | → `SessionPayload` or `SessionSummary` | `not_found` | no-store | — | Runner reload/resume, `V3SessionSummary` | NEW · 5 |
| TR-4 | `GET /api/train/themes` | M | → `ThemeOption[] { key, label, group, pct, attempts, available, recommended }` | — | no-store | — | `V3PuzzleThemes` picker, hub "Puzzles by theme" | NEW · 5 |
| TR-5 | `GET /api/train/weakness` | M | → `WeaknessPayload` (status insufficient\|computing\|ready\|failed, games counts, progress steps, band, top 3, preliminary, week plan, breakdown) | — | private-etag (ETag = `"<snapshotRef>:<algoVersion>:<progressTick>"`; 304 on polls) | — | `V3WeaknessProfile`, `V3WeaknessInsufficient`, `V3WeaknessComputing` | NEW · 6 |
| TR-6 | `POST /api/train/attempts` | M | `{ attempts: AttemptIn[] (1–50) }` → `{ results: AttemptOut[] }` per item `ok\|duplicate\|conflict\|rejected`; idempotent on `clientAttemptId`; FSRS computed server-side (`ts-fsrs`); optimistic concurrency `reps = $cardReps` (two tabs → `conflict`); replays offline batches in `reviewedAt` order | per-item statuses (a 402 rejects the whole batch) | no-store | `train-write` · 64 KB body | Every runner grade, the offline outbox | NEW · 5 (REPLACES the grade endpoints in AA, AC, ADB, IS) |
| TR-7 | `POST /api/train/sessions` | M | `SessionCreate` (`daily`, `bank {filter?, cardRefs?, practice?}`, `puzzles {theme?, count?}`, `weakness {pattern, size: 10\|20, mix}`, `practice {fromSessionRef}`) + `Idempotency-Key` → 201 `SessionPayload` (≤ 20 items, all solutions included because validation is local); returns the ACTIVE session of the same kind and filter if < 2 h old | — (a reached daily cap returns 201 with `capRemaining: 0` and the caught-up payload, not an error) | no-store | `train-session` | Hub "Start", Bank "Review 4", theme picker, Weakness "Start drill" (RB §4.2) | NEW · 5/6 |
| TR-8 | `POST /api/train/sessions/{ref}/extend` | O | `{ after: itemId }` → `{ items: TrainItem[] (10) }` | `gone` (session ended) | no-store | `train-session` | Puzzle stream (fires when 2 items remain) | NEW · 5 |
| TR-9 | `POST /api/train/sessions/{ref}/end` | O | `{ reason: done\|user\|timeout }` → `SessionSummary` | — | no-store | — | ⋯ End session, "See session summary" | NEW · 5 |
| TR-10 | `POST /api/train/cards/{ref}/skip` | O | `{ sessionRef }` → `{ suspendedUntil }` | `not_found` | no-store | `train-write` | "Skip for today" | NEW · 5 |
| TR-11 | `DELETE /api/train/cards/{ref}` | O | → 204 (sets `Mistake.hiddenAt`, deletes the card) | — | no-store | `train-write` | Bank row ⋯ Remove (needs a design, RB Q6) | NEW · 5 |
| TR-12 | `POST /api/train/weakness/recompute` | M | `{ timeClasses?: TimeClass[] }` → 202 `{ status: "computing" }` (job deduped per user per 10 min) | — | no-store | `weakness-recompute` | `V3WeaknessComputing` Retry, scope change in settings | NEW · 6 |

Puzzle content: Lichess CC0 puzzles live as versioned JSON shards on R2 (`/puzzles/v<n>/<theme>/<ratingBucket>.json`, RB D5). The session builder (Vercel) fetches the shards it needs through the CDN (`fetch` with `next: { revalidate: false }` and the versioned URL, so each Vercel instance keeps them in the data cache); the browser never needs a puzzle API. For offline use, the client keeps the last `SessionPayload` in IndexedDB (RB §4.5).

### 4.10 Home

| ID | Method · path | Auth | Request → response `data` | Errors | Cache | RL | Screens | Status · Ph |
|---|---|---|---|---|---|---|---|---|
| HOME-1 | `GET /api/home` | M/L | → `HomeData { greetingPart, ratingLabel, gamesThisWeek, continue: { gameRef, fen, lastMove, opponent, opponentRating, result, endMove, keyMomentCount, analysing?: { done, total } } \| null, newUser: { position: PositionCard } \| null, bank: { due, topTheme, topThemeCount, thumbs: [{ cardRef, fen, label }] (4), estMin }, week: { days: boolean[7], games, puzzles, ratingFrom, ratingTo }, recent: UserGameRow[] (8), import: ImportRunView \| null }` from 5 parallel indexed queries (`Promise.all`, IS §3.18) | — | no-store | — | `V3Home`, `V3HomeNewUser` (`loading` is the skeleton) | NEW · 3 |

### 4.11 Players (public profiles)

Public reads by `username`; old handles resolve through `UsernameHistory` (90 days) with a 308 to the new path. Visibility and blocks are enforced in `visibleProfile()`; a private profile returns the private projection (200), not 403, so `V4ProfilePrivate` renders. **Every public path reads no session** (it is CDN-cached by URL, and the CDN ignores cookies); per-viewer bits live on `/me` paths with `no-store` (api-perf AP-03). P10 §7.1 is authoritative for the exact shapes.

| ID | Method · path | Auth | Request → response `data` | Errors | Cache | RL | Screens | Status · Ph |
|---|---|---|---|---|---|---|---|---|
| PLY-1 | `GET /api/players/{username}` | P | → `PlayerHeader { username, displayName, avatarUrl, country, joinedAt, title?, visibility, ratings, linked, overview }` (no `me`) | `not_found` | `public-short` (60 s, tag `player:<ref>`) | edge | `V4Profile` own/other/guest/private | REPLACES `GET /api/profile/[referenceId]` · P10 |
| PLY-1m | `GET /api/players/{username}/me` | U | → `{ isSelf, blocked, canChallenge, h2h: { w, d, l } }` | `not_found` | `no-store` | — | profile buttons, head-to-head | NEW · P10 |
| PLY-2 | `GET /api/players/{username}/rating-history?pool&days ≤ 365` | P | → `{ points: [{ at, rating }] (≤ 60) }` | `not_found` | as PLY-1 | edge | Profile Overview graph | NEW · P10 |
| PLY-3 | `GET /api/players/{username}/games?result&source&legend&q&pool&cursor&limit ≤ 30` | P | → `Paged<PublicGameRow>`; `meta.total` only on page 1 | `not_found` | `public-short` | — | Profile Games tab | NEW · P10 |
| PLY-4 | `GET /api/players/{username}/stats?pool` | P | → `PlayerStats` (computed on read, P10 D3) | `not_found` | as PLY-1 | — | Profile Stats tab | NEW · P10 |
| PLY-5 | `GET /api/players/{username}/milestones?cursor` | P | → `Paged<Milestone>` | `not_found` | as PLY-1 | — | Profile Milestones tab | NEW · P10 |
| PLY-6 | `GET /api/players/search?q&limit ≤ 8` | P | → `{ items: [{ username, displayName, avatarUrl, rating }] }`; no block filter (the client hides users in `qk.me().blockedBy`); if blocking must hide users server-side, signed-in search goes to `GET /api/me/players/search` (`no-store`) | — | `public-short` (300 s) | `search` | player-not-found suggestions, challenge picker | NEW · P10 |

### 4.12 Tournaments

Tournament reads are public (lists, lobbies, results render read-only for signed-out visitors, IA Q3); joining and pairing need membership. Pairing and timers live in the socket server (`TournamentPairer`, `TournamentScheduler`, IA §5.0); HTTP serves snapshots and a fallback. **No GET writes**: `autoCompleteTournamentIfExpired` (`tournament.service.ts:75-98`) moves into the scheduler.

| ID | Method · path | Auth | Request → response `data` | Errors | Cache | RL | Screens | Status · Ph |
|---|---|---|---|---|---|---|---|---|
| TOU-1 | `GET /api/tournaments?tab=live\|upcoming\|finished&cursor&limit ≤ 20` | P | → `Paged<TournamentCard>` (public projection only; the viewer's joined/rank state comes from TOU-7 and `qk.tournaments.mine()`) | — | `public-short` (15 s, tag `tournaments:list`) | edge | `V4Tournaments`, `V4TournamentsEmpty` | REPLACES `GET /api/tournament` · P12 |
| TOU-2 | `GET /api/tournaments/{slug}` | P | → `TournamentSnapshot { header, rules, positions, status, displayPhase, times, standingsVersion, top: StandingRow[] (20), liveGames, topBoard? }` (no `me`) | `not_found` | `public-short` (5 s) | edge | `V4TournamentLobby`, `V4TournamentLive`, `V4TournamentResults` | REPLACES `GET /api/tournament/[ref]` · P12 |
| TOU-3 | `GET /api/tournaments/{slug}/participants?cursor&q` | P+ | → `Paged<{ username, displayName, initials, rating, seed, joinedAt }>`; `q` escapes `%`/`_` (AA F-24) | `not_found` | public-short (10 s) | `search` | Lobby list and search | REPLACES the `?search=` mode of `tournament/[ref]` · 8 |
| TOU-4 | `POST /api/tournaments/{slug}/participants` · `DELETE …/participants/me` | M · U | `{ inviteCode? }` → 201 `{ participant, rank }` · → 204. Join: transaction with `SELECT … FROM tournaments WHERE id=$1 FOR UPDATE`, conditional `participantCount < maxParticipants`, `INSERT … ON CONFLICT DO NOTHING` (double join → 200 with the existing row); `after()`: `tournament:player_joined` | `conflict` (`tournament_full`, `registration_closed`), `forbidden` (invite-only without a valid code) | no-store | 10/min per user | Join from invite, lobby Join/Leave | REPLACES `POST /api/tournament/join` (TOCTOU, P2002 → 500) · 8 |
| TOU-5 | `POST /api/tournaments/{slug}/invites` | U (participant) | → `{ code, url }` (get-or-create the caller's own code) | `forbidden` | no-store | `share` | Lobby "Invite" | NEW · 8 |
| TOU-6 | `GET /api/tournaments/{slug}/standings?after=<rank>&limit ≤ 50` | P+ | → `{ version, rows: StandingRow[] }` (one `ROW_NUMBER()` query with the deterministic order `score DESC, gamesPlayed ASC, id ASC`) | `not_found` | public-short (5 s, tag `tournament:<slug>:standings`) | edge | Live arena standings, refetch on a version gap | NEW · 8 |
| TOU-7 | `GET /api/tournaments/{slug}/me` | U | → `{ participant, rank, score, streak, fire, state: searching\|in_game\|idle, currentGameRef }` | `not_found` | no-store | — | Arena "you" strip, game strip | NEW · 8 |
| TOU-8 | `GET /api/tournaments/{slug}/top-board` | P+ | → `{ gameRef, white, black, fen, lastMove, clocks, moveNo } \| null` (initial value; live updates via `tournament:top_board`) | — | public-short (2 s) | edge | Arena "Top board · Watch" | NEW · 8 |
| TOU-9 | `POST /api/tournaments/{slug}/start` · `POST …/end` | H | → `{ status, startedAt? \| endsAt? }`; conditional `updateMany({ where: { id, status: "lobby" } })` (a double start no longer overwrites `endsAt`, AA §3.6); `after()`: `/internal/emit` to `t:<slug>` | `conflict` (wrong status) | no-store | — | Lobby host "Start now", admin end | REPLACES `POST /api/tournament/start`, `/end` · 8 |
| TOU-10 | `POST /api/tournaments/{slug}/find-match` · `DELETE …/find-match` | M (participant) | → `{ state: searching \| paired, gameRef? }` | `conflict` (`in_game`) | no-store | 1 per 3 s | **Fallback only** when the socket is down; the normal path is `tournament:find_match` | REPLACES `POST /api/tournament/find-match`, `/cancel-search` (polled every 2–4 s today) · 8 |
| TOU-11 | `GET /api/tournaments/{slug}/results` | P+ | → `{ final: StandingRow[] (frozen), podium, me?: { rank, games, bestGameRef, momentsFlagged } }` | `not_found`, `conflict` (not finished) | public-static tag `tournament:<slug>` once completed | edge | `V4TournamentResults` | NEW · 8 |
| TOU-12 | `GET /api/tournament-invites/{code}` | P+ | → `{ tournament: TournamentCard, invitedBy: { username, displayName } }` | `gone` (revoked or closed) | public-short (30 s) | edge | Join-from-invite landing (works signed out) | NEW · 8 |

Aliases: the old `/api/tournament/*` paths stay one release as thin aliases because `e2e/specs/tournament.spec.ts` calls `/api/tournament/find-match` (IA §1.2). The E2E cleanup `DELETE /api/tournament/[ref]` stays in non-production only (404 when `APP_ENV=production`, timing-safe secret compare, AA §3.6).

### 4.13 Admin

All admin routes: `A`, desktop-only screens (`V4Admin*`), `If-Match` on updates, soft delete only, every write logged to `AuditLog { actorId, action, entity, entityRef, diff, at }` (AA F-01), and `invalidateByTag`/`revalidateTag` for the public catalogue in `after()`. Lists use cursor pagination with `limit ≤ 100` and explicit `select`s (no `explanation` JSON in lists, ADB DB-14).

| ID | Method · path | Request → response `data` | Tags purged | Screens | Status · Ph |
|---|---|---|---|---|---|
| ADM-1 | `GET /api/admin/metrics` | → `{ users, members, trials, mrrCents, games24h, liveGames, socket: { sockets, games, loopLagP99 }, worker: { queueDepth, oldestJobAgeSec }, errors24h }` (socket and worker numbers from `/internal/metrics`, cached 30 s) | — | `V4AdminDashboard` | NEW · 8 |
| ADM-2 | `GET /api/admin/activity?cursor` | → `Paged<AuditLog>` | — | dashboard feed | NEW · 8 |
| ADM-3 | `GET /api/admin/positions?q&legend&status&cursor` · `POST /api/admin/positions` | → `Paged<AdminPositionRow>` · `PositionUpsert` (FEN validated, legends by slug, explanation upload via `ADM-9`) → 201 | `positions`, `position:<slug>` | `V4AdminPositions` | REPLACES `GET /api/chess-positions` (unbounded `limit`, no auth) and `POST /api/chess-positions/create` (no auth) · **0** (auth) / 8 (rework) |
| ADM-4 | `PATCH /api/admin/positions/{slug}` · `DELETE …/{slug}` | partial + `If-Match` → row · → 204 (`isActive=false`) | same | same | REPLACES `PUT/DELETE /api/chess-positions/[id]` (no auth, hard delete) · 0 / 8 |
| ADM-5 | `POST /api/admin/positions/{slug}/verify` | → `{ ok, issues: string[], legendMoveSan, startPly, eco }` (PGN reaches FEN, PB A19) | — | position editor "Check FEN" | NEW · 8 |
| ADM-6 | `GET /api/admin/legends?q&cursor` · `POST /api/admin/legends` | list (`select { slug, name, … }`, `take ≤ 100`) · `LegendUpsert` → 201 | `legends`, `legend:<slug>` | `V4AdminLegends` | REPLACES `GET /api/legends/search` (full rows, unbounded), `POST /api/legends/create` (no auth) · 0 / 8 |
| ADM-7 | `PATCH /api/admin/legends/{slug}` · `DELETE …/{slug}` | partial + `If-Match` · soft delete | same | same | REPLACES `PUT/DELETE /api/legends/[id]` (no auth, BigInt-or-ref lookup) · 0 / 8 |
| ADM-8 | `GET /api/admin/tournaments?status&cursor` · `POST /api/admin/tournaments` · `PATCH …/{slug}` · `POST …/{slug}/cancel` · `POST …/{slug}/duplicate` | `TournamentCreate { name, description ≤ 500, tc, positions[], startsAt, durationMin, visibility, maxParticipants, lateJoinMin }` (nested create of tournament + host participant in one transaction, AA F-24) | `tournaments:list`, `tournament:<slug>` | `V4AdminTournaments`, `V4AdminTournamentCreate` | REPLACES `POST /api/tournament/create` (any member, description ≤ 50) · 8 |
| ADM-9 | `POST /api/admin/uploads` | `{ kind: portrait\|explanation\|audio, contentType, bytes }` → `{ uploadUrl, publicUrl }` (R2 presigned) | — | legend portrait, explanation JSON | NEW · 8 |
| ADM-10 | `POST /api/scraper/positions/import` | `X-API-Key` (timing-safe, AA F-25) or admin; body `{ positions: PositionUpsert[] (≤ 100) }` → `{ created, skipped, errors[] }` (shares `upsertPosition()` with ADM-3) | `positions` | external scraper | KEEP + batch · 0 (compare) / 8 |

**P0 note.** Before any redesign work, the six unauthenticated mutations get `requireAdmin()` as their first line and an e2e spec asserting 401/403 (AA §8 step 1, IA §9.1). The `/api/admin/*` move is the Phase 8 rework.

### 4.14 Internal web routes (called by OCI)

Auth `I` (HMAC with per-kid allow-lists, §2.11.6) on all. `maxDuration = 10`. Every one is idempotent and safe to retry. Bodies carry `v: 1`.

**Revision 1's live-game routes INT-1…INT-8 are withdrawn** (B4): the socket server reads and writes Neon directly through `DB/src/live/*` (P2 §6.6): restore list (was INT-2), live-game creation for matchmaking and rematch (INT-3, INT-8), checkpoints into the packed `games.moves` text (INT-4; there is no `GameMove` table), phase changes (INT-5), the finish CTE (INT-6; scoring through `GamePlayer.tournamentPoints`, there is no `TournamentPairing`), abort (INT-7). The legacy web game routes P2 keeps until P9/P12 call the same `DB/src/live/*` functions.

| ID | Method · path | Caller (kid) | Request → response `data` | Semantics | Ph |
|---|---|---|---|---|---|
| INT-9 | `GET /api/internal/tournaments/schedule?from&to` | socket (`ws`) at **boot**; then **push from web** on every create/move/cancel (`/internal/emit tournament:updated`); an **hourly re-sync served from the Vercel data cache** (`unstable_cache`, tag `tournaments:schedule`), never a DB query every 60 s | → `{ items: [{ slug, status, startsAt, endsAt, lobbyOpensAt, maxGameSec }] }` | Arms the socket scheduler's timers. A 60-second poll would keep Neon awake all month (≈ 180 CU-h against a 100 CU-h cap; P12 D12-10) | P12 |
| INT-10 | `POST /api/internal/tournaments/{slug}/pairings` | socket (`ws`) | `{ v, whiteRef, blackRef, clientPairId }` → `{ gameRef, color: { [ref]: w\|b }, positionLabel, studyEndsAt }` | Verifies participants and `now < endsAt`, resolves the slot position, creates the `Game` (+ `game_players`, `tournamentPositionOrder`) in one transaction; idempotent on `clientPairId` (P12 D12-4) | P12 |
| INT-11 | `POST /api/internal/tournaments/{slug}/start` · `…/finalize` | socket (`ws`) | `{ v, at }` → `{ status }` | Conditional on status; finalize freezes standings, enqueues low-priority analyses, inserts `TOURNAMENT_PODIUM` milestones for `finalRank ≤ 3`; `after()`: `revalidateTag`, `tournament:updated` | P12 |
| INT-12 | `GET /api/internal/blocks?userRefs=` | socket (`ws`) | → `{ pairs: [[a, b]] }` | Pairing exclusions | P9/P12 |
| INT-13 | `POST /api/internal/notifications` | socket (`ws`), worker (`wk`) | `{ v, items: [{ userRef, kind, title, body, url, dedupeKey, channels }] }` → `{ created }` | Inserts `Notification` rows (`dedupeKey @unique`) and kicks the worker's `NOTIFY_DISPATCH` | P10 |
| INT-14 | `POST /api/internal/revalidate` | worker (`wk`), content scripts (`ops`) | `{ v, tags: string[] (≤ 20) }` → 204 | `revalidateTag` + `invalidateByTag` | P8 |
| INT-15 | `POST /api/internal/entitlement-check` | socket (`ws`; rare: token `ent` expired mid-session) | `{ v, userRefs: string[] ≤ 2 }` → `{ [ref]: { entitledUntil } }` | Lets the socket re-validate without waiting for a token refresh | P2 |
| INT-16 | `POST /api/internal/account-purge/{id}/{step}` | worker (`wk`) | `{ v }` → `{ status }` | `dodo` and `clerk` purge steps (the keys stay on web) | P10 |

### 4.15 HTTP endpoints hosted on OCI

Socket server (`apps/web-socket`, public through Caddy at `ws-chess.playchess.tech` / `ws-dev.80-225-200-210.sslip.io`). Every `/internal/*` path requires the HMAC; Caddy refuses unsigned requests first (today `POST /internal/tournament-event` has no auth, `apps/web-socket/index.ts:42-73`). P2 §7.5 is authoritative.

| ID | Method · path | Caller | Body → response | Notes | Ph |
|---|---|---|---|---|---|
| WS-1 | `GET /health` | uptime monitor, compose healthcheck | → `{ ok, loopLagMs }` | Process alive | P1 |
| WS-2 | `GET /ready` | compose healthcheck, deploy | → `{ ready, draining, outboxOldestMs }` | Not draining, outbox oldest < 60 s; Neon-suspend reconnects are not failures | P2 |
| WS-3 | `POST /internal/emit` | web (`web`), worker (`wk`) | `{ v: 1, targets: ({ room } \| { userRef })[] ≤ 50, event, data, dedupeKey? }` → 202 `{ delivered }` | The only body shape (zod `.strict()`). `event` must be in `CT/socket/registry.ts` **and** in the caller kid's allow-list; empty rooms are skipped before parsing `data`; `dedupeKey` remembered 60 s | P2 |
| WS-4 | `POST /internal/broadcast` | deploy and admin (`ops`) through the signing CLI | `{ v: 1, type: "restart", inSeconds }` → 202 | Emits `server:restarting`; blocked at Caddy (reachable via `docker compose exec`) | P2 |
| WS-5 | `POST /internal/drain` | deploy (`ops`) | `{ v, inSeconds }` → 202 | Stop new games, flush outbox and journal, `io.close()`; blocked at Caddy | P2 |
| WS-6 | `GET /internal/metrics` | admin dashboard via web, `ops-weekly.yml` | → `{ sockets, games, queue, outbox, loopLag, rssMb }` | blocked at Caddy; read through the signing CLI or the admin proxy | P2 |
| WS-7 | `POST /internal/tournament-event` | legacy web tournament routes (`web`) | legacy body | alias forwarding to the emit service; removed in P12 | P2 |

Worker (`apps/analysis-worker`; dev: on the dev box; prod: the worker VM `10.42.0.30`, reached through the socket box's Caddy over the VCN, so it needs no public IP):

| ID | Method · path | Caller | Body → response | Notes | Ph |
|---|---|---|---|---|---|
| WK-1 | `POST /internal/analysis/kick` | web (`after()` on every enqueue), socket (after the finish), cron | `{ v: 1, kinds?: JobKind[], runAt?: ISO }` → 202 | Starts a drain; a `runAt` earlier than the armed timer re-arms it. 2 s caller timeout | P3 |
| WK-2 | `POST /engine/analyse` | web coach tools, `CO-6` level 2 | `{ v, fen, moves?: Uci[] ≤ 12, multipv: 1..3, nodes ≤ 400000 }` → `{ fen, depth, nodes, lines: [{ cp, mate, pvUci, pvSan }], cached }` | Interactive lane between batch positions; SQLite eval cache; 2.5 s caller timeout | P7 |
| WK-3 | `POST /internal/live/ply` | socket (`ws`), flag `analysis-live-prewarm` | `{ v, gameRef, ply, fen }` → 202 | Prewarm the eval cache during play | P3 |
| WK-4 | `POST /internal/provider/chesscom/lookup` | web (`web`) on 429/403 from Vercel's shared IPs | `{ v, handle }` → profile | Through the worker's one-at-a-time Chess.com gate; cached 600 s | P4 |
| WK-5 | `GET /health`, `GET /ready` | uptime monitor | → `{ ok, queueDepth, oldestJobAgeSec, engine }` | — | P3 |

There is no `/worker/*` prefix and no coach fallback on OCI: if Vercel limits ever bite, the coach move is a deployment change that adds `/internal/coach/*` to the Caddy allow-list in the same PR.

### 4.16 Webhooks and cron

| ID | Method · path | Auth | Purpose | Status · Ph |
|---|---|---|---|---|
| WH-1 | `POST /api/webhook/dodo-payments` | Standard Webhooks signature (`@dodopayments/nextjs` `Webhooks`) | Billing lifecycle | KEEP + extend · 1 |
| WH-2 | `POST /api/webhook/clerk` | Svix (`verifyWebhook` from `@clerk/nextjs/webhooks`) | User lifecycle, session revocation | NEW · 1 |
| CRON-1 | `GET /api/cron/daily` | `Authorization: Bearer $CRON_SECRET` | All daily jobs | NEW · 1 |

Details in §8.

---

## 5. Existing endpoints: keep, change, remove

All 57 handlers in the 50 route files under `app/api` (AA §2), plus the 3 other route handlers. "When" is the phase in which the old path stops being called; removal happens one release later.

| # | Today | Verdict | Target | Notes | When |
|---|---|---|---|---|---|
| 1 | `GET /api/analysis/[gameId]` | REMOVE | `REV-1` | Keep its participant check and 404 masking; the new route reads precomputed analysis (no PGN parsing per request, `route.ts:95-129`) | 3 |
| 2 | `POST /api/checkout` | CHANGE | `BIL-1` | Envelope, idempotency, session reuse, email from DB, `findUnique` instead of `findFirst` (`route.ts:83`) | 1 |
| 3–6 | `GET/PUT/DELETE /api/chess-positions/[id]`, `POST /api/chess-positions/create` | AUTH NOW, then REPLACE | `ADM-3`, `ADM-4` | `requireAdmin()` in P0 | 0 → 8 |
| 7 | `GET /api/chess-positions/featured` | REMOVE | `CAT-5 ?collection=featured` | No callers | 1 |
| 8 | `GET /api/chess-positions` | AUTH NOW, then REPLACE | `ADM-3` | Cap `limit` at 100 and `select` list fields in P0 | 0 → 8 |
| 9 | `POST /api/chess/cancel-game` | REPLACE | `CHL-5` | Conditional update | 2 |
| 10 | `POST /api/chess/create-ai-game` | REPLACE | `PLAY-1` | Bot user lookup per game goes away (bot = `GamePlayer.userId NULL` + `botElo`) | 2 |
| 11 | `POST /api/chess/create-game` | REPLACE | `CHL-1` (friend), `PLAY-1` (legend/position/opening vs bot) | Dead `userReferenceId` field dropped | 2 |
| 12 | `GET /api/chess/game-by-ref/[ref]` | INTERNAL-ONLY NOW, then REPLACE | `INT-1` (socket), `PLAY-2` / RSC (browser), `CHL-2` (join page) | P0: require the HMAC for the socket and a player session for browsers; strip `traceContext` | 0 → 2 |
| 13 | `POST /api/chess/game-over` | INTERNAL-ONLY NOW, then REPLACE | the finish CTE `DB/src/live/finish.ts` (B4) | P0: reject anything that is not `isInternalServiceRequest` (AA F-02); conditional status update | 0 → 2 |
| 14 | `POST /api/chess/game-state` | INTERNAL-ONLY NOW, then REMOVE | `DB/src/live/checkpoint.ts` (B4) | Spot-only caller, dead on OCI | 0 → 2 |
| 15 | `POST /api/chess/join` | REPLACE | `CHL-3` | Conditional update | 2 |
| 16 | `POST /api/chess/move` | INTERNAL-ONLY NOW, then REMOVE | `DB/src/live/checkpoint.ts` (B4) | 80 invocations per game today | 0 → 2 |
| 17 | `GET /api/customer-portal` | ALIAS | `BIL-14` | 302 alias for one release | 9 |
| 18 | `GET /api/healthcheck` | REPLACE | `SYS-1` | Listed in `public/llms.txt:50`; update that file | 1 |
| 19–21 | `GET/PUT/DELETE /api/legends/[id]` | AUTH NOW (PUT/DELETE), then REPLACE | `CAT-1` (public read), `ADM-7` | | 0 → 8 |
| 22 | `POST /api/legends/create` | AUTH NOW, then REPLACE | `ADM-6` | Stops returning `stack` (`route.ts:99`) | 0 → 8 |
| 23 | `GET /api/legends` | CHANGE | `CAT-1` | Slim DTO, T0 cache | 8 |
| 24 | `GET /api/legends/search` | REPLACE | `ADM-6 ?q=` | Admin-only, `take 10` | 8 |
| 25 | `POST /api/matchmaking/cancel-beacon` | REMOVE | socket `queue:leave` / disconnect | | 2 |
| 26 | `POST /api/matchmaking/cancel-match-request` | REMOVE | socket `queue:leave` | | 2 |
| 27 | `POST /api/matchmaking/cleanup` | REMOVE | — | No caller; internal branch unreachable | 1 |
| 28 | `POST /api/matchmaking/create-match-request` | REMOVE | socket `queue:join` | | 2 |
| 29 | `GET /api/matchmaking/match-status` | REMOVE | socket `queue:matched` | 1 Hz poll that writes (AA F-08, F-22) | 2 |
| 30 | `GET /api/openings` | CHANGE (same path) | `CAT-3` | Public, CDN, paginated; no auth, no in-memory limiter | 8 |
| 31 | `GET /api/position/[referenceId]` | REPLACE | `CAT-4` / RSC props | Fixes the wrong-type first request (`PositionPageClient.tsx:56-62`) | 8 |
| 32 | `GET /api/profile/[referenceId]` | ALIAS → REPLACE | `PLY-1`, `PLY-3` | One release as an alias | 9 |
| 33 | `POST /api/scraper/positions/import` | KEEP + harden | `ADM-10` | Timing-safe key, batch | 0 / 8 |
| 34 | `GET /api/socket-token` | CHANGE | `ME-16` | Claims v2, own secret | 2 |
| 35 | `GET /api/subscription` | CHANGE, then REMOVE | `BIL-15` → `ME-1`, `BIL-3` | DB-first now; removed when no client calls it | 1 → 9 |
| 36 | `POST /api/subscription/cancel` | KEEP | `BIL-10` | + reason fields | 1 |
| 37–39 | `GET/POST/DELETE /api/subscription/change-plan` | KEEP | `BIL-6`, `BIL-7`, `BIL-9` | + idempotency on POST | 1 |
| 40 | `POST /api/subscription/change-plan/preview` | KEEP | `BIL-8` | | 1 |
| 41 | `POST /api/subscription/resume` | KEEP | `BIL-11` | | 1 |
| 42 | `GET /api/tournament/[ref]` | ALIAS → REPLACE | `TOU-2`, `TOU-3` | No writes in GET | 8 |
| 43 | `DELETE /api/tournament/[ref]` | KEEP (non-prod) | — | 404 in production | 0 |
| 44 | `POST /api/tournament/cancel-search` | ALIAS → REPLACE | `TOU-10 DELETE` / socket | | 8 |
| 45 | `POST /api/tournament/create` | AUTH (admin) → REPLACE | `ADM-8` | Owner decision F-26 / IA Q27 on who may host | 0 → 8 |
| 46 | `POST /api/tournament/end` | ALIAS → REPLACE | `TOU-9` | | 8 |
| 47 | `POST /api/tournament/find-match` | ALIAS → REPLACE | socket `tournament:find_match`, `TOU-10` fallback | e2e spec uses it | 8 |
| 48 | `POST /api/tournament/join` | ALIAS → REPLACE | `TOU-4` | | 8 |
| 49 | `GET /api/tournament` | ALIAS → REPLACE | `TOU-1` | | 8 |
| 50 | `POST /api/tournament/start` | ALIAS → REPLACE | `TOU-9` | | 8 |
| 51 | `GET /api/user/[referenceId]` | **DELETE NOW** | — | No callers; leaks email and date of birth (AA F-03) | 0 |
| 52 | `POST /api/user/chess-com-profile/preview` | REPLACE | `ACC-2` | Encode, timeout, cache, rate limit | 4 |
| 53 | `POST /api/user/chess-com-profile` | REPLACE | `ACC-3` (+ `ME-4` for the onboarding flag) | Handle uniqueness dropped (unique per user and provider, AA F-27) | 4 |
| 54 | `GET /api/user/email/[email]` | STRIP NOW, DELETE in 1 | `ME-1` | P0: return only `referenceId`/onboarded for the caller's own email and 404 otherwise; delete with the shell | 0 → 1 |
| 55 | `POST /api/user/onboarding-skip` | REPLACE | `ME-4` | The plan step can't be skipped in paid-only | 1 |
| 56 | `POST /api/user/sync` | REPLACE | `WH-2` + `getViewer()` upsert + `ME-1` | Clerk BAPI call and a write on every boot today | 1 |
| 57 | `POST /api/webhook/dodo-payments` | KEEP + extend | `WH-1` | Event log, Clerk claims, push | 1 |
| — | `app/sitemap-legends.xml/route.ts` | KEEP | — | Read through the tagged loaders | 8 |
| — | `app/sitemap-openings.xml/route.ts` | CHANGE | — | Select `hasExplanation`, not the `explanation` JSON (`route.ts:11`) | 1 |
| — | `app/blog/rss.xml/route.ts` | KEEP | — | | — |

Every row has a target. Fifteen handlers get an auth fix in the P0 pass, before any redesign work: rows 3–6, 8, 12–14, 16, 20–22 (the PUT/DELETE of 19–21 and the create), 45, 51 and 54.

---
## 6. Socket protocol (v2) and server authority rules

**The socket protocol is defined by P2 (`docs/plan/phase-02-board-and-live-game.md` §7.4) and implemented in `packages/contracts/src/socket/*`.** `registry.ts` is the only server→client event registry; `rooms.ts` (`ROOM.game/spectate/user/tournament`) is the only place room names are built (ESLint bans room string literals elsewhere). Revision 1's catalogue in this section (dot or `g:`/`u:` names, `game:draw {action}`, `game:over`, `bank:due`, `notification:new`) is withdrawn; the mapping from those names is P2 §7.4.9. What stays here is the summary and the authority rules (§6.9).

### 6.1 Summary

| Area | Names (owner phase) |
|---|---|
| Connection | handshake `auth: { token, proto: 2, build }`; `session:hello { bootId, useq, serverNow }` on connect; reconnect 0.5–5 s with jitter; the client refetches user-room data only when `bootId` changed or `useq` has a gap |
| Rooms | `game:{ref}` (players, all tabs), `spectate:{ref}` (one ply late), `user:{ref}` (every socket of a user), `tournament:{slug}` |
| Commands (acked, 5 s) | `game:join`, `spectate:join`, `game:leave`, `game:sync`, `study:ready`, `game:move {ref, ply, uci, clientMoveId, premove?}`, `game:abort`, `game:resign`, `draw:offer\|accept\|decline`, `rematch:offer\|accept\|decline\|cancel`, `clock:ping`, `live:list`, `session:refresh_token` (P2); `queue:*` (P9); tournament commands (P12) |
| Game-room events | `game:snapshot`, `game:phase`, `study:ready`, `move:applied` (≤ 200 B: no `fen`, false booleans omitted, `clientMoveId` only in the mover's ack), `clock:sync` (on change and a 15 s drift check, never per second), `presence:update`, `draw:offered\|declined\|cancelled`, `game:ended` (immediate), `game:result` (after persistence), `rematch:*`, `spectators:update`, `game:error`, `server:restarting` (P2) |
| User-room events | `analysis:queued\|progress\|writing\|done\|failed` (progress only for priority ≥ `GAME_ENDED`; `done` carries `bank: {added, plies, due}`), `analysis:batch` (coalesced backlog, ≤ 1 per user per 60 s), `import:progress\|finished` (P3/P4), `weakness:progress\|ready` (P6), `bank:due_changed`, `mistakes:added` (P5), `entitlement:changed` (P4; absorbs `membership:updated`), `review:text_ready` (P7), `queue:matched`, `queue:moved` (P9), `blocks:changed`, `presence:state`, `notify:new`, `export:ready` (P10), `session:revoked` |
| Tournament and system | `tournament:updated`, `tournament:search_ended` and P12's arena events; `system:notice` to all sockets (P11) |
| Ack error codes | `CT/socket/codes.ts` (P2 §7.4.7), including `not_member`, `upgrade_required`, `draining`, `rate_limited` |
| Optimistic UI | the client sets its own state before the ack for draw offers, rematch offers, "I'm ready" and declines, and rolls back on a negative ack (api-perf §2.8) |
| Payload budgets | `move:applied` ≤ 200 B; `GameState` ≤ 2 KB at 80 plies with the longest legend prefix (`prefixSans` as one string); asserted by `size.test.ts` with realistic fixtures |
### 6.9 Server authority rules

The socket server is the only authority for a live game. These rules are implemented in `packages/game-core` (a pure reducer `reduce(state, command, now) → { state, events, effects }`, AS §17.1) and wrapped by `GameSession` for timers and I/O.

**Identity and access**

1. Identity comes only from the verified token (`socket.data.userRef`). Role in a game (player or spectator) is decided by the server from `whiteRef`/`blackRef` in `LiveGameRecord`; nobody claims a role.
2. Commands that start or join play (`game:join` as player in a rated/live game, `queue:join`, `tournament:find_match`, spectating) require `ent > now` from the newest token. A player whose membership lapses mid-game may finish that game.
3. Spectating requires membership and `visibility = public` (friend games are private by default; PA Q8). Spectators never receive draw or rematch internals.
4. Every inbound payload is zod-validated; invalid → ack `{ ok: false, code: "internal" }` and a `ws.invalid_payload{event}` metric (never a crash).

**Moves and clocks**

5. A move is accepted only if: phase is `first_move` (for that side) or `playing`; it is the sender's side to move; `ply === plyCount` (otherwise `stale_ply` with `state`); a promotion piece is given when needed; chess.js accepts it. Duplicate resend of an already applied move (same ply, same uci) acks `ok` with no effect (multi-tab and retry safe).
6. Clocks are server-side only, in ms, on a monotonic clock (`performance.now()`), one `setTimeout(remaining + 20 ms)` per game for the running side (replacing the 100 ms interval and per-second emits, AS §5). On each move: `spent = now − turnStartedAt − lagCredit`, `mover −= max(spent, 0)`, `mover += incMs`; record `clockMs` and `spentMs` on the ply.
7. Lag credit = `min(rttEwma / 2, 250 ms)` from `clock:ping`, not applied to `premove: true` moves (each premove still costs ≥ 100 ms), capped per game at 5 % of the initial time.
8. The server flags; clients never end a game on their own clock. Flag with the opponent unable to mate (bare king, or king + one minor vs a lone king) is `timeout_vs_insufficient` (a draw).
9. After each move the server checks, in order: checkmate, stalemate, insufficient material, threefold (`isThreefoldRepetition()`), fifty-move (`isDrawByFiftyMoves()`). Each ends the game with its own method (today threefold and fifty-move are mislabelled `draw_agreement`, `GameSession.ts:1031-1033`).

**Phases**

10. `waiting` → (both players connected) → `study` (`studySeconds`, default 30; 0 skips; both `game:ready` end it early) → `first_move` for White (30 s, clocks frozen) → `first_move` for Black (30 s) → `playing` (White's clock starts after Black's first move). A missed first-move deadline or `game:abort` → `ended(aborted)`, unrated.
11. Disconnect during `study` or `first_move`: timers keep running ("the study timer keeps running"), no grace ring.
12. Disconnect during `playing`: when the player's last socket leaves, `game:presence { online: false, graceEndsAt: now + 30 s }`. Reconnect within the window clears it. On expiry: ply < 2 → `aborted`, else the absent side loses by `abandoned` (fixes the wrong-winner bug, `GameSession.ts:559-561`). Both offline: clocks decide.
13. `ended` sessions stay 60 s for rematch and late joins (then evicted); later joins get an `ended` state from the DB (fixes "a refresh after mate shows a live board", AS F-09). `waiting` sessions with no player socket for 10 min are evicted (the 24 h challenge expiry in the DB stays authoritative).

**Draws and rematch**

14. Draw offers only in `playing`, stored as `{ by, ply }`; the receiver's move clears it (implicit decline). Accept and decline are valid only from the receiver of a pending offer (fixes "anyone can accept a draw", `GameSession.ts:487-493`, AS F-01). After a decline the offerer may offer again at `ply + 4` ("You can offer again in 2 moves"). Crossing offers are an accept.
15. Rematch: `offer` stores `{ by, expiresAt: now + 30 s }`; `accept` calls `INT-8` (colours swapped, both memberships re-checked), then `game:rematch_started` to both. Either player leaving → `expired` with `reason: left`. Not offered in tournaments.

**Queue and tournaments**

16. Quick-match pools live in memory, keyed `"{initialMs}+{incMs}:{start|legend}"`; pairing tick every 1 s while non-empty (and on join): sort by rating, pair greedily within ±100 for the first 20 s, ±200 after (`V3Queue` copy), timeout at 60 s. One queue entry per user (a second tab gets `queue:moved`). A user with a live rated game cannot queue (`already_in_game` + ref). The opponent of the previous 60 s is skipped unless both requeue. Colour preferences never pair white+white or black+black. On a pair: `INT-3` (idempotent on `clientPairId`), then `queue:matched` to both; on failure both go back into the pool with `queue:status`.
17. Legend pool position: a deterministic "position of the day" per legend pool (`hash(date, poolKey) mod N`) so liquidity is not split (PA §2.3, Q7).
18. Tournament pairing every 1 s per tournament with searchers: window `100 + 25 × floor(waitSec / 3)` capped at 800, no rematch of the last opponent, blocks honoured (`INT-12`), colour to whoever has played fewer whites. `INT-10` creates the game; then `tournament:paired` to both users and `tournament:game_started` to `t:`. Pairing stops at `endsAt`; the arena finalises when the last game ends or at `endsAt + maxGameSec` (`INT-11`).

**Bot games**

19. Bot and legend-vs-engine games are not on the socket. They run in the browser on `packages/game-core` and persist through `PLAY-1/3/4`; the server replays moves on `complete` and accepts only board-verifiable endings as claimed results except resignation, timeout and agreement, which are allowed because these games are unrated (§4.6). This removes the browser-chosen bot moves inside a socket game (AC §7.3, AS F-11, F-22).

### 6.10 Persistence, restore and deploys (socket side)

P2 §7.6 is authoritative: direct checkpoints and the finish CTE through `DB/src/live/*` (no internal web routes), an outbox with backoff, the ndjson journal with a version byte, drain on deploy through the signing CLI, restore by replay with clocks frozen until both players reattach, and Neon-suspend errors (`P1017`, `P1001`, `57P01`, `08006`, `08003`) treated as transient (one immediate retry on a fresh connection, counted as `ws.persist.reconnect`, plus a `SELECT 1` prewarm when a game leaves `waiting`).
### 6.11 v1 → v2 mapping: fate of every existing event

| v1 event (`apps/web-socket`, `GamePageContent.tsx`) | v2 | Verdict |
|---|---|---|
| `join_game {gameReferenceId, userReferenceId}` | `game:join { ref, lastSeq }` (identity from the token) | replaced |
| `spectate_game` | `game:join` (role decided by the server) | replaced |
| `make_move {from, to, promotion}` + `move_error` | `game:move { ref, ply, uci }` + ack | replaced |
| `offer_draw` / `accept_draw` / `decline_draw` + `draw_offered` / `draw_declined` | `game:draw { action }` + `game:draw` | replaced (fixes F-01) |
| `resign` | `game:resign` | replaced |
| `analysis_phase_started` + `analysis_tick` (1/s) | `game:phase { phase: "study", study: { endsAt } }` | replaced (the tick goes) |
| `game_started` (incl. the reconnect overload) | `game:phase { first_move \| playing }` / `game:state` | replaced |
| `clock_update` (1/s) | none; `clocks` ride on `game:move`, `game:phase`, `game:clock` | removed |
| `opponent_disconnected` / `opponent_reconnected` | `game:presence` | replaced |
| `spectator_state` / `spectator_count` | `game:state` (spectator) / `game:spectators` | replaced |
| `waiting_for_opponent` (no client handler) | `game:state { phase: "waiting" }` | removed |
| `server_restarting` (no client handler, Spot only) | `server:restarting` | replaced |
| `game_over` | `game:over` + `game:result` | replaced |
| `error {message}` (free text) | ack codes + `game:error { code }` | replaced |
| `join_tournament_lobby` / `leave_tournament_lobby` | `tournament:watch` / `tournament:unwatch` | replaced (aliases kept one release) |
| `tournament_player_joined`, `tournament_started`, `tournament_game_started`, `tournament_game_ended`, `tournament_ended` | `tournament:*` deltas with payloads | replaced |
| `tournament_match_found` (never emitted, room-wide) | `tournament:paired` to `u:` only | removed |
| HTTP `/api/matchmaking/*` polling | `queue:*` | replaced |
| HTTP `POST /internal/tournament-event` (no auth) | `WS-3 /internal/emit` (HMAC) | replaced |

Rollout: v1 and v2 handlers run side by side behind `PROTOCOL_V1=on`; the client switches with the PostHog flag `live-protocol-v2`; v1 is deleted after two weeks of `ws.socket_event{event=join_game}` = 0 (AS §22).

---
## 7. Streaming: the coach SSE endpoint (`CO-3`, `CO-4`)

### 7.1 Why SSE from a Vercel route, and the limits that shape it

- The coach is request/response with a long tail (first sentence in 2.5–4 s, whole answer 5–12 s at low effort, RS §13.7). A POST that returns `text/event-stream` is the simplest fit: same origin, Clerk cookie auth, no extra connection, works through the service worker (NetworkOnly) and corporate proxies. The socket server is not used for this: it would put LLM orchestration on the 1-OCPU game box.
- **Vercel Hobby with Fluid compute** bills active CPU, not wall time, for I/O waits, but provisioned memory is charged for the time the instance is open. Hobby with Fluid allows up to 300 s per function (verified 2026-11-02); **we cap the coach at 60 s** (`maxDuration = 60`, with `supportsCancellation: true`). Earlier wording about "the old Hobby ceiling (60 s)" (verify the current Hobby numbers on vercel.com/docs/limits before launch), and the server enforces a tighter **45 s hard deadline** of its own (§7.6), so the platform limit is never the thing that ends a stream.
- Rough memory budget: 150 daily active members × 3 questions × 15 s of open stream ≈ 1.9 instance-hours a day if no two streams share an instance, ≈ 3.75 GB-h/day at 2 GB, ≈ 110 GB-h/month. Fluid lets concurrent streams share an instance, so real usage is lower. Check it against the Hobby allowance on the usage page after the first month (estimate, not a measurement).
- **Fallback hosting.** If Hobby limits bite (duration, memory, or the plan's non-commercial terms; Pro is needed before charging anyway), the same handler can run on the OCI worker behind `https://<ws-host>/internal/coach/messages`, added to the Caddy allow-list in the same PR, with the same protocol; the client switches by an env-provided base URL. LLM calls are I/O-bound, so 1 OCPU is fine (RS §13.8). This is a deployment change, not an API change.

### 7.2 Request

`POST /api/coach/messages` (`CO-3`), body `CoachAsk` (§4.8), `Content-Type: application/json`, max 32 KB.

```ts
// @repo/contracts/http/coach
export const CoachAsk = z.strictObject({
  clientId: z.string().uuid(),                 // idempotency: a retried POST with the same clientId re-attaches (§7.8)
  threadRef: Ref.optional(),
  gameRef: Ref.optional(), ply: z.number().int().min(0).max(1000).optional(),
  mistakeRef: Ref.optional(),
  kind: z.enum(["chip", "typed", "whatif", "explain"]),
  chipKey: z.string().max(40).optional(),
  question: z.string().min(1).max(600),
  whatIfUci: Uci.optional(),
});
```

### 7.3 Pre-stream checks (plain JSON errors, no stream opened)

In this order, each failing fast with the envelope (§2.6) so the client can show the right state without parsing a stream:

| Step | Check | DB / cost | Error |
|---|---|---|---|
| 1 | `getViewer()` + member (`V3CoachPaywall` on 402) | 1 indexed read (shared with the rest of the request) | 401, 402 |
| 2 | zod body | — | 400 |
| 3 | `coach-burst` bucket (5 / 1 per 12 s) | 1 upsert | 429 `rate_limited` |
| 4 | Fair use: read today's and this month's `coach_usage_days` sum for the viewer (charging happens at `done`, step 7.7) | 1 read | 429 `fair_use_limit { resetsAt, limit }` (`V3CoachRateLimit`) |
| 5 | Idempotency: `INSERT coach_messages (clientId …) ON CONFLICT ("userId", "clientId") DO NOTHING RETURNING id`. Conflict with a `streaming` message < 90 s old → 409 `in_flight`; with a finished one → replay it as a short stream (`meta`, the stored `sentence`s, `done`) | 1 statement | 409 |
| 6 | One answer at a time per user: any other `streaming` message of the viewer < 90 s old | same statement (partial index `coach_messages (userId) WHERE status='streaming'`) | 409 `in_flight` |
| 7 | Context: player check on `gameRef` (`requirePlayerOf`), load the thread (last 20 messages), the game's analysis facts and the asked ply | 1–2 reads (`Promise.all`) | 404 |
| 8 | Answer reuse: `explain` on a key moment with a stored verified `why`, or a cached chip answer `(gameId, ply, chipKey, color, GRADING_VERSION)` | in step 7's read | — (replay, no LLM call, no quota charge) |

Then the response starts: status 200 with the headers in §7.4. Anything that fails after this point is reported in-stream (`error` or `fallback` events), never as an HTTP status.

### 7.4 Response headers and framing

```
HTTP/1.1 200 OK
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform        ← no-transform stops intermediaries from compressing/buffering
Connection: keep-alive
X-Accel-Buffering: no
x-request-id: <id>
```

Each frame is UTF-8, one JSON object per `data:` line, and carries a monotonically increasing `id:` (the event index within the message) so a client can tell what it has already rendered:

```
id: 3
event: sentence
data: {"i":0,"text":"Qd2 doesn't lose anything by itself, but it lets Rxf5 pass.","verified":true}

```

Comment lines (`: ping`) are sent every 15 s while the model is thinking or a tool runs, so proxies and the browser keep the connection open. There is no `retry:` field: a browser `EventSource` is not used (it cannot POST), and automatic reconnect would double-spend; recovery is explicit (§7.8).

### 7.5 Events

Merged from RA §2.4.5 and RS §13.6. The schema for each `data` payload is in `@repo/contracts/http/coach` (`CoachStreamEvent` discriminated union) and the client parser validates it in development.

| Event | Payload | When | UI state |
|---|---|---|---|
| `meta` | `{ threadRef, userMessageRef, coachMessageRef, model: "sonnet" \| "template", contextChip }` | first frame, always | append the user bubble, open the coach bubble |
| `status` | `{ phase: "thinking" \| "engine" \| "writing", label? }` (e.g. `"Checking Nd5 with the engine"`) | before the first sentence and around each tool round; the client shows each at least 400 ms | `V3CoachTyping` ("ANALYSING…") |
| `sentence` | `{ i, text, verified: true, refs?: { san: string[] } }` | each sentence after it passes the verifier | `V3CoachStreaming`, 120 ms fade-in (none under reduced motion) |
| `annotation` | `{ arrows?: [{ from, to, tone }], squares?: string[], line?: { fen, san: string[] } }` | after the sentence it belongs to | board arrows and "Show on board" |
| `retract` | `{ fromIndex, reason: "unverified" }` | the regenerate path (§7.6 step 5) | clear the bubble from `fromIndex`, back to `status` |
| `fallback` | `{ reason: "unverified" \| "timeout" \| "upstream" \| "refusal", text, engineLine: { moveNo, san: string[], evalText } }` | verification failed twice, deadline hit, or the model refused/errored | `V3CoachError` engine-line fallback, no VERIFIED tag |
| `quota` | `{ state: "ok" \| "low" \| "reached", remainingToday, remainingMonth, resetsAt, label }` | just before `done` | the input footer ("3 LEFT TODAY") |
| `done` | `{ verified: boolean, charged: boolean }` | last frame on success or fallback | input re-enabled |
| `error` | `{ code: "upstream_unavailable" \| "upstream_unavailable" \| "internal", retryable: boolean }` | unrecoverable failure after the stream opened | `V3CoachError` with "Try again" (`CO-4`) |

Ordering guarantees: `meta` first; `sentence.i` strictly increasing from 0, except after a `retract`, which restarts at `fromIndex`; exactly one terminal frame (`done` or `error`), after which the server closes the stream.

### 7.6 Server pipeline

```
route (Node runtime, maxDuration 60)
 ├─ pre-stream checks (§7.3)
 ├─ new ReadableStream({ start(controller) … }) returned immediately
 └─ inside the stream:
     1. send meta, status{thinking}
     2. build the prompt: tools → frozen system (cache_control, 1 h) → game context block (cache_control, 5 min)
        → thread history → per-turn facts (FEN, side to move, eval in words, best line, label, allowed moves) → question
        (RA §2.4.2; volatile content only after the last breakpoint; log usage.cache_read_input_tokens)
     3. call the model with streaming; model and effort from env (COACH_CHAT_MODEL = claude-sonnet-5-5 per PLAN Phase 7,
        effort "low" for chat, max_tokens 4000 as a cost cap, tools strict with eager_input_streaming, tool_choice auto (forced tool choice returns 400
        on this model), server-side refusal fallback as RA §2.4.1 specifies; for a what-if move the play_moves result is pre-computed into the facts so most answers need no tool round)
     4. text deltas → sentence splitter (ignores "19.", "e.g.", decimals) → verifySentence (V1–V8, packages/chess-analysis,
        ~1 ms each) → emit `sentence` only when it passes
     5. a failed sentence: abort the model stream, emit `retract`, regenerate once with the failures listed;
        a second failure → `fallback { reason: "unverified" }` with the engine line
     6. tool calls (analyse_position, play_moves, square_facts, legal_moves, game_ply): zod-validate the input before
        running, emit status{engine}, call WK-2 with a 2.5 s timeout; cap 3 rounds / 20 s; illegal input → is_error result
     7. stop_reason "refusal" → fallback{refusal}; "max_tokens" → keep verified sentences, then fallback
     8. persist: append each verified sentence to coach_messages.content as it is emitted (one UPDATE per ~3 sentences),
        final UPDATE with status, model, tokens, cachedTokens, costMicros
     9. charge (§7.7), send quota, done; close
```

**Time budget** (all server-side timers, started at request receipt):

| Milestone | Target | Hard limit | On breach |
|---|---|---|---|
| Pre-stream checks | p95 < 120 ms | 3 s | `unavailable` (503) before the stream |
| First `status` frame | < 200 ms | — | — |
| First `sentence` | p50 < 3 s, p95 < 6 s | 20 s | `fallback { reason: "timeout" }` |
| Tool rounds | ≤ 3 rounds | 20 s total | stop tools, answer from facts |
| Whole answer | p95 < 15 s | **45 s** | abort the model stream, emit the verified sentences so far + `fallback { reason: "timeout" }` + `done` |
| Platform | — | 60 s (`maxDuration`) | never reached because of the 45 s deadline |

### 7.7 Quota accounting (P7 D5)

- **Before the stream:** a quota **read** (today's `coach_usage_days` row plus the period sum; trial caps for trialists, `CT/limits.ts`), then the one statement that inserts the user message `ON CONFLICT ("userId", "clientId")`. That insert **completes before any model call**, so a double tap or a retry after a dropped response cannot start two paid calls (api-perf AP-46).
- **At the end:** cost is **always recorded** (`coach_spend_days`, per-message tokens and cost). A `done` answer counts against the question quota in one statement: `INSERT INTO coach_usage_days ("userId", day, questions, …) VALUES (…) ON CONFLICT ("userId", day) DO UPDATE SET questions = coach_usage_days.questions + 1, …`, where `day` is the viewer's local day in `User.timeZone`.
- **Not counted against the quota:** aborts, `error`, replays of stored answers, explain-from-stored-`why`, cached chip answers, and a `fallback` (its tokens are still costed). The monthly cost ceiling caps abuse of the abort path.
- **Dependency:** with Vercel's `supportsCancellation` off, an abort cannot be detected and every Stop becomes a counted `done` (api-perf AP-02, AP-13). §7.8 and `01-architecture.md` §4.3 turn it on.
- Caps: `CT/limits.ts` (`01-architecture.md` CR-33): member 30/day, 150/month, $1.50; trial 10/day, 40/trial, $0.40; global breaker `max($5, $0.08 × entitledMembers)`.

### 7.8 Cancellation, disconnects and recovery

**Vercel request cancellation is opt-in per function** (verified 2026-11-02): `vercel.json` sets `"functions": { "app/api/coach/messages/route.ts": { "supportsCancellation": true, "maxDuration": 60 }, "app/api/coach/messages/[ref]/retry/route.ts": { … } }`. Without it `request.signal` never fires. P7 adds an acceptance test on the deployed dev URL: abort after the first `sentence` and assert `coach_messages.status = 'ABORTED'` within 2 s and no quota increment.

| Situation | Client | Server |
|---|---|---|
| User presses **Stop** | `controller.abort()` on the fetch **and** `navigator.sendBeacon('/api/coach/messages/{ref}/stop')` (CO-9) | `request.signal` fires → abort the model stream (≤ 200 ms) → mark `ABORTED` with the verified sentences so far → cost recorded, quota not counted. The beacon sets `ABORTING`, which the stream loop checks with its mid-stream `UPDATE` (no extra statement), covering proxies that hide the disconnect |
| User leaves the screen | the component's `AbortController` aborts on unmount | same |
| Network drop mid-stream | the reader throws; the client shows what it has plus "Connection lost" and calls `CO-5` (`GET /api/coach/messages/{ref}`) once online | aborts upstream the same way. `CO-5` returns what was verified and persisted; "Try again" calls `CO-4` |
| The POST is retried with the same `clientId` | — | the `(userId, clientId)` insert conflicts → an in-flight one answers 409 `in_flight` (`retryAfterSec: 2`); a finished one is replayed as a short stream at no cost |
| Vercel kills the function | the reader throws | the 45 s deadline makes this a bug; the message stays `STREAMING` and is swept to `FAILED` after 90 s |

Resume-without-respend is deliberately not offered: it would keep the model stream running after the client left. `CO-5` + `CO-4` cover the visible cases.
### 7.9 Client reader

```ts
// apps/web/lib/sse.ts (~40 lines; fetch + TextDecoderStream, because EventSource cannot POST)
export async function* readSse(res: Response, signal: AbortSignal) {
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  while (!signal.aborted) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += value;
    let cut: number;
    while ((cut = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, cut); buf = buf.slice(cut + 2);
      if (frame.startsWith(":")) continue;                         // ping
      const event = /^event: (.+)$/m.exec(frame)?.[1] ?? "message";
      const data = /^data: (.+)$/m.exec(frame)?.[1];
      const id = Number(/^id: (\d+)$/m.exec(frame)?.[1] ?? NaN);
      if (data) yield { id, event, data: JSON.parse(data) as CoachStreamEvent["data"] };
    }
  }
}
// useCoachStream(): POST via fetch (not api(): it must not parse JSON on 200), non-2xx → ApiError from the JSON body,
// 2xx → for await (…) dispatch into the coach store; append to qk.coachThread(ref) with setQueryData on `done`.
```

### 7.10 Tests

- Unit: sentence splitter, verifier V1–V8 (true and false claims), event ordering (`retract` resets `i`), quota charge rules.
- Route tests with a mocked model stream: pre-stream error matrix (401/402/409/429), a normal stream, a regenerate, a double failure → fallback, the 45 s deadline (fake timers), client abort → `aborted` and no charge, `clientId` replay.
- Playwright: `V3CoachStreaming`, `V3CoachError`, `V3CoachRateLimit` (countdown), `V3CoachPaywall` with a mocked stream (RA §8).
- k6: 50 concurrent streams with a mocked upstream, measuring time-to-first-sentence and memory per instance.

---

## 8. Webhooks and cron

### 8.1 Shared webhook rules

1. **Verify first, on the raw body**, before any JSON parsing or DB access. Signature failures → 401 with no detail.
2. **Deduplicate by delivery id** before side effects: `INSERT INTO webhook_events (id, provider, type, "receivedAt") VALUES ($deliveryId, …) ON CONFLICT (id) DO NOTHING RETURNING id`. No row → already processed → 200 immediately. (ADB §8.7, AA F-30.)
3. **Do the minimum synchronously** (the state change in one transaction, then mark `processedAt`), and push side effects (Clerk metadata, socket emits, PostHog, emails) into `after()`. Target < 1 s response.
4. **Status codes:** 200 for processed, duplicate, or ignored types; 200 + a `warn` log for payloads that fail zod (redelivery won't fix them); **5xx only for transient failures** (DB unavailable, pool timeout) so the provider retries. A 5xx deletes the `webhook_events` row in the same catch, so the retry is not treated as a duplicate.
5. **Ordering** is never assumed: billing snapshots apply only if newer (`subscriptionSourceAt` comparison); Clerk `user.updated` compares `updated_at`.
6. **Replay tooling:** an admin-only `POST /api/admin/webhooks/{id}/replay` re-runs a stored event's handler from `webhook_events.payload` (Dodo payload kept 180 days, Clerk 30 days, minus PII fields we don't need).
7. Middleware skips Clerk on `/api/webhook/*`; maintenance mode never blocks webhooks (IS §3.5 edge case).

### 8.2 Dodo Payments (`WH-1`, `POST /api/webhook/dodo-payments`)

- **Verification:** the existing `Webhooks({ webhookKey: DODO_PAYMENTS_WEBHOOK_KEY })` adapter from `@dodopayments/nextjs` (Standard Webhooks: `webhook-id`, `webhook-timestamp`, `webhook-signature`) stays (`app/api/webhook/dodo-payments/route.ts:33-34`). The delivery id for dedupe is the `webhook-id` header.
- **Events and handling** (confirm the full event list against Dodo's webhook docs when implementing):

| Event | Handling |
|---|---|
| `subscription.active`, `subscription.renewed`, `subscription.plan_changed`, `subscription.updated`, `subscription.on_hold`, `subscription.cancelled`, `subscription.expired`, `subscription.failed` (and `paused` / `past_due` statuses, which the SDK's status enum includes) | `subscriptionSnapshotSchema.safeParse` (exists, `route.ts:8-22`) → `applySubscriptionSnapshot(…, { source: "webhook", eventTime })` with the conditional update. Resolve the user by `metadata.clerkUserId` first (checkout already sends it, `checkout/route.ts:149`), then `dodoCustomerId`, then the normalised email. First `active`: set `trialStartedAt`, `trialEndsAt` (PLAN §1.5). Entitled → not entitled: set `membershipEndedAt`. `after()`: `syncClerkClaims(user)` (custom session token `md`), `WS-3 entitlement:changed`, release `WAITING_FOR_MEMBERSHIP` imports, PostHog `subscription_<type>` |
| `payment.succeeded` | Link `dodoCustomerId` by normalised email when missing (exists, `route.ts:57-68`, but case-sensitive today) |
| `payment.failed` | Record on `billing_events`; `BIL-2` shows `failed` immediately instead of waiting for a timeout (IP §1.5); `after()`: `entitlement:changed` with `paymentIssue` |
| `refund.*`, `dispute.*` | Record + `AuditLog` + Sentry warning (today only debug-logged, `route.ts:70`) |
| anything else | Record type, 200 |

- **Tables:** `webhook_events` (dedupe, all providers) and `billing_events (id, userId, type, subscriptionId, outcome, payloadHash, at)` for support questions ("did we receive X?").

### 8.3 Clerk (`WH-2`, `POST /api/webhook/clerk`)

- **Verification:** `verifyWebhook(req)` from `@clerk/nextjs/webhooks` with `CLERK_WEBHOOK_SIGNING_SECRET` (one secret per Clerk instance: development for `replay-chess-dev`, production for the future `replay-chess` project). Delivery id = `svix-id`.
- **Events:**

| Event | Handling |
|---|---|
| `user.created` | Upsert `User` + `UserSettings` defaults + `UserStats` (logic moved from `app/api/user/sync/route.ts:86-138`, code generation retried on P2002 instead of the `findUnique` loop); copy `unsafe_metadata` (`signupSource`, `planIntent`, `utm`) into the row; initialise `publicMetadata { onboarded: false, entitled: false }`. Idempotent with the `getViewer()` race upsert |
| `user.updated` | Update `email` (primary **verified** address only), `name`, `avatar` when Clerk's `updated_at` is newer; if the email changed, update the Dodo customer email in `after()`. Never overwrite a display name the user set in our profile (IA #2) |
| `user.deleted` | Run `deleteAccount()` (the same service as `ME-15`, idempotent; anonymise shared games, delete private rows, enqueue `account.purge`) |
| `session.revoked`, `session.ended` | `WS-3 session:revoked` to `user:<ref>` (`V3SessionExpired`) |
| others | 200 |

### 8.4 Cron

**Vercel cron (one entry, daily)** in `apps/web/vercel.json` (Hobby allows at most once a day; a more frequent expression fails the deploy):

```json
{ "crons": [ { "path": "/api/cron/daily", "schedule": "0 9 * * *" } ] }
```

`GET /api/cron/daily` (`CRON-1`): `auth: "cron"` (timing-safe `Authorization: Bearer $CRON_SECRET`), `maxDuration = 60`. Tasks are files in `lib/cron/tasks/<task>.ts`, run in order, each with its own budget and a resumable cursor; the route returns a JSON summary that is also logged:

| Task | Work | Query / index | Budget |
|---|---|---|---|
| `membership-reconcile` | Refresh from Dodo every subscription in a non-terminal state whose `subscriptionSourceAt` is older than 6 h (this replaces any refresh-on-read), 50 per run, oldest first; applied with the compare-and-set using Dodo's `updated_at` | partial index on `subscriptionStatus` non-terminal | 20 s |
| `trial-reminder-backstop` | Enqueue a `TRIAL_ENDING` notification + `NOTIFY_DISPATCH` row for any trial ending in 12–72 h with no `trialReminderSentAt` and no queued row, then kick the worker (P10; architecture X10). The email itself is sent by the worker | `users_trial_reminder_idx` | 10 s |
| `worker-heartbeat` | If the last `HOUSEKEEPING` finished more than 26 h ago, kick the worker and alert | `jobs_user_idx` / a one-row read | 2 s |
| `checkout-cleanup` | Clear stale `pendingCheckout*` > 24 h; cancel `WAITING_FOR_MEMBERSHIP` import runs > 30 days | PKs | 5 s |

Pruning (`webhook_events`, `idempotency_keys`, `rate_limit_buckets`, `rate_limit_windows`) moved to the worker's `HOUSEKEEPING` (P3).

**OCI worker scheduling: future-dated job rows, no timers against Neon** (`01-architecture.md` CR-10 and §2.2). There is no `node-cron`, no advisory lock on the direct connection, and no 15-minute, 30-second or 1-minute timer:

| Kind | When | Created by | Notes |
|---|---|---|---|
| `HOUSEKEEPING` | daily 21:00 UTC | its own successor | retention rules, prunes, reaper; last step `DAILY_PLAN` |
| `DAILY_PLAN` | after `HOUSEKEEPING` | `HOUSEKEEPING` | writes the next 26 h of timed rows below |
| `NOTIFY_REMINDERS` | one row per distinct `reminderUtcMinute` with due members | `DAILY_PLAN`; a settings change inside 26 h enqueues its own row | also the 08:00-local release push (P10) |
| `NOTIFY_DISPATCH` | now | the producer (INT-13, web routes) + a kick | drained until empty; no polling |
| `NOTIFY_WEEKLY` | each zone's Sunday | `DAILY_PLAN` | weekly digest and the weakness week roll |
| `TOURNAMENT_STARTING` | `startsAt − 5 min` | web when a tournament is created or moved; `DAILY_PLAN` backstop | P12 |
| `IMPORT_SYNC` (daily) | 03:00 local + jitter | the previous sync | P4 |
| `BACKUP` | daily 20:00 UTC (prod) | `DAILY_PLAN` | 14 daily + 2 weekly; disabled on dev; until P13 the interim `backup-prod.yml` GitHub workflow runs instead |
| `MILESTONES_EVALUATE`, `R2_SWEEP`, `MEMBERSHIP_PAUSE_EDGE` | as produced | producers / `DAILY_PLAN` | P10 |

When the queue drains, the worker reads `min("runAt")` in the same round trip as its last write and arms one timer; an idle worker sends no query. The socket server keeps its own in-process timers (game deadlines, matchmaking tick, the tournament scheduler armed by INT-9 at boot and by pushes), described in §6.9.
---
## 9. Optimisation plan and budgets

The scarce resources are, in order: **Neon compute hours** (Free plan: 100 CU-h per project per month, and the old project already ran out, ADB DB-01), **Vercel Hobby function usage** (invocations, active CPU, provisioned memory; verify the current allowances), **latency on a cold path** (Neon wakes in ~300–800 ms after 5 idle minutes; Mumbai↔us-east is ~200 ms), and **one OCPU per OCI box**. Every rule below exists to protect one of them.

### 9.1 Request budget per user flow (today → target)

| Flow | Today | Target | Main changes |
|---|---|---|---|
| Hard load of any app page (member) | 3–5 invocations, 1 Clerk BAPI call, 1–2 Dodo calls, 2 DB writes, ~6–10 queries, 0.6–1.5 s before the page is useful (AA §5.1, AC §3.1) | **0 extra invocations** (the page render itself), 1 query (`getShellState` CTE), 0 third-party calls, 0 writes | `getViewer()`/`getShellState()` in the `(app)` layout, Clerk webhook, DB-first entitlement, no persisted stores |
| Quick-match search, 60 s | ~60 invocations, ~400 queries (1 Hz poll with a locking transaction, AA §5.3) | **0 HTTP calls** while searching; 1 invocation (`INT-3`) at match time | in-memory socket queue |
| Friend game, 80 plies | ≈ 88 Vercel invocations, ≈ 250 DB statements, 776 KB of rewritten JSON (AS §6.1) | ≈ 8–10 invocations (1 restore + ~6 checkpoints + 2 phase + 1 finish) and 0 from browsers during play; ~8 KB of move rows | socket checkpoints, `GameMove` rows, snapshot over the socket |
| Bot game | 7–10 RTT to create, then every move over the socket (AA §3.4) | 2 invocations + beacons (`PLAY-1`, `PLAY-4`) | client-run bot |
| Open a finished review | 1 invocation after an auth waterfall; 3–4 sequential queries; PGN parsed per request (AC §3.3) | 0 extra (RSC), 1 round trip (`relationLoadStrategy: "join"` or one CTE); revisits are cache hits (T3) or 304s | precomputed `GameAnalysis`, versioned URL |
| Watch analysis progress | n/a | 0 HTTP while the socket is up; fallback ≤ 1 request / 3–10 s with 304s | `analysis:progress` on `u:` |
| Train session of 10 items | n/a | 1 `POST /train/sessions` + 1–10 `POST /train/attempts` (batched by the outbox when offline) | local move validation, one write per item |
| Coach question | n/a | 1 invocation (SSE), 4–6 statements, 0–3 worker calls | pre-stream checks, stored-answer reuse |
| Tournament arena, 30 players, 10 min | find-match polls every 2–4 s per searcher with a write each; full lobby refetch per event per viewer (AA §5.4) | snapshot once per viewer; deltas over the socket; 1 `INT-10` per pairing, 1 `INT-6` per game | socket pairer, `standings_delta` |
| Checkout return | up to 7 Dodo-backed `/api/subscription` calls, ×2 when `UserSync` overlaps, 3 copies of the poll | 1 `BIL-2`, then the `entitlement:changed` push; fallback polls at 2/4/8 s | activation endpoint + webhook push |
| Import 500 games | n/a | 1 `ACC-3` + 0 polling (socket progress); all provider traffic on the worker | worker queues |

### 9.2 Database budget per hot endpoint

Revision 1's table here listed budgets against tables that will not exist (`rating_events`, `TournamentPairing.gameId`, `GameMove (gameId, ply)`, `training_cards (userId, deck, due)` under a different name). **Each phase spec's §9.2 is authoritative** for its routes' statement budgets and the index each query uses; `02-data-model.md` §7.4 and §8 summarise the cross-phase picture. The CI gates (`05-optimization.md` §9) count statements per screen loader and fail when a listed index is missing or a hot query plans a Seq Scan or Sort on `game_players`, `training_cards` or `training_attempts`.

Cross-cutting rules that keep every budget small:
- `getViewer()` is **one** round trip (`relationLoadStrategy: "join"` over `users` + `chess_com_profiles`), loaded once per request through React `cache()`.
- List ETags come from version columns already on the viewer row (`gamesVersion`), never from a scan of the user's rows.
- Counts (`meta.counts`, `meta.total`, `meta.filteredTotal`) only on page 1 or with `limit=0`.
- The analysis write is one HTTP batch; the live finish is one CTE; the import is one upsert per 100-game chunk with `ON CONFLICT … DO UPDATE … RETURNING`.
### 9.3 Payload budgets

| Response | Budget (brotli) | How |
|---|---|---|
| `Viewer` | < 2 KB | flags only for active experiments; full prefs via `ME-3a` |
| `ReviewData` | < 2 KB (~4 KB raw for a 54-ply game) | columnar plies; FENs computed on the client from `startFen` + `uci`; no PGN, no legend PGN (today both are sent and re-parsed, AC §3.3) |
| `SessionPayload` (20 items) | < 25 KB | precomputed solutions, no engine data |
| `BankPage` (50 rows) | < 9 KB | denormalised rows, SVG mini boards rendered from FEN on the client |
| `GameState` over the socket | < 4 KB at ply 80 | UCI + SAN + clock per ply (~25 B each) instead of verbose chess.js moves (235 B each, AS §6.1) |
| `analysis:progress` | < 300 B per event | deltas only, batched every 2 plies |
| Public catalogue pages | `/openings` from 8.1 MB HTML to < 200 KB | one ECO family per page, no PGN in lists (AC §13) |

### 9.4 Cold start and runtime

- **Region pinned to `iad1`** next to Neon (§1.2). Cross-region would add ~70 ms per query (RB §5.2).
- **Connection string** for Vercel: Neon pooled host with `connection_limit=5&pool_timeout=15&connect_timeout=15` (`connect_timeout` covers a compute wake). Role `replay_app` with `statement_timeout=15s`, `idle_in_transaction_session_timeout=30s`, `lock_timeout=5s` (ADB §5.4), so a runaway query fails in 15 s instead of hanging a function (the 300 s `game-over` hang, AS §6.3).
- **Prisma:** drop the musl `binaryTargets` leftover; evaluate the driver-adapter, Rust-free client (`engineType = "client"` with `@prisma/adapter-neon` or `@prisma/adapter-pg`) on the dev project, measuring cold start on `ME-1` and `REV-1`; with Fluid compute, register the pool with `attachDatabasePool` from `@vercel/functions` so idle clients are released before an instance suspends (Vercel docs).
- **Import hygiene per route:** hot routes (`/api/me`, reviews, train, home) must not import `dodopayments`, `@anthropic-ai/sdk`, `chess.js` (except the FEN validator path), or `@sentry/nextjs` beyond the wrapper. The coach route imports the Anthropic SDK only inside its handler module; billing routes alone import Dodo (AA F-31).
- **`after()` for every side effect** so responses return before socket emits, PostHog, Clerk metadata or worker wakes.
- **Function config:** `maxDuration` explicit on every route (§4.0); `export const dynamic = "force-dynamic"` only where the route reads cookies, so public GETs stay cacheable.

### 9.5 Keeping Neon asleep when nobody is playing

| Source of activity | Rule |
|---|---|
| Uptime checks | `SYS-1` without `?deep=1` touches no DB |
| Worker | wakes on `WK-1` pushes, drains with `SKIP LOCKED`, then idles; one safety sweep only while the socket server reports live sessions (ADB §5.3) |
| Socket server | no DB at all; restore list only at boot |
| Crawlers | catalogue pages ISR/CDN; sitemaps cached 1 h; `/api/health` CDN-excluded but DB-free |
| Polling | none in steady state; fallbacks only while a job runs and the tab is visible, with 304s answered from a cheap version read |
| Dev and E2E | separate Neon project (ADB DB-01), so they do not spend production hours |

### 9.6 Vercel usage estimate (to check against the Hobby allowance)

Assumptions: 300 members, 50 % daily active, per active member per day: 20 page renders, 12 client API calls, 2 live games (**0 Vercel calls**: the socket writes Neon directly, B4), 1 bot game (2 calls), 3 coach questions, 1 review. That is about 150 × (20 + 12 + 2 + 3 + 1) ≈ **5.7k invocations a day, ≈ 171k a month**, well inside Hobby's 1M. The other Hobby quotas matter as much (verified 2026-11-02; an overage pauses the feature for up to 30 days): **CDN requests** 1M a month (≈ 40–60 per page view incl. static assets, so ≈ 120–180k a month for members, plus crawlers on ISR pages), **Fast Data Transfer** 100 GB (the 7.3 MB engine is served from R2, not Vercel), **image transformations** 5,000 (avatars and portraits pre-sized on R2 and rendered `unoptimized`), **Speed Insights** 10,000 events per 30 days team-wide (`sampleRate={0.2}`), **Edge Config** 100k reads (60 s memo per isolate). `ops-weekly.yml` reads all of them from the Vercel usage API from P1, and test traffic stops at 60 % of any quota (`01-architecture.md` §1.13.3).

### 9.7 Service levels and alerts

| Class | p95 server time target | Alert |
|---|---|---|
| Viewer, badges, train reads | < 80 ms | p95 > 200 ms for 15 min |
| Review, home, archive | < 150 ms | p95 > 300 ms for 15 min |
| Train attempts, prefs, small mutations | < 150 ms | p95 > 300 ms |
| Billing actions (Dodo) | < 1.5 s | error rate > 2 % / 15 min |
| Live finish (socket → Neon CTE) | < 400 ms on the socket box | `ws.persist.fail` (excluding `ws.persist.reconnect`) > 0 for 5 min; `ws.outbox.oldest_ms > 60 000` |
| Coach first sentence | < 6 s | fallback rate > 10 % / day; verification failure rate > 5 % |
| Webhooks | processed < 1 s | any signature failure spike; `webhook.lag_ms > 60 000` |

**Measurement sources (api-perf AP-35, AP-15):** server time from the wrapper's `api.duration_ms{route}` and `api.mw_lag_ms` (middleware stamps `x-mw-start`); webhooks from `webhook.handle_ms` (receipt → response) in addition to `webhook.lag_ms` (provider → receipt); the live finish from the socket's `ws.persist.*` metrics; the coach from the server `firstSentenceMs` column; availability includes Vercel `function_timeout`/504 counts from the usage API, because Sentry sees only completed requests. PostHog client events (consent-gated) are funnels, not SLO sources. Uptime monitors watch `SYS-1`, `WS-1` and `WK-5`.

### 9.8 Performance tests (k6, against the dev deployment only)

| Scenario | Load | Thresholds |
|---|---|---|
| `api-reads` (`ME-1`, `REV-1`, `TR-1`, `HOME-1`) | 50 VUs, 5 min | p95 < 200 ms, errors < 0.5 % |
| `train-attempts` | 30 VUs grading every 8 s | p95 < 250 ms, 0 duplicate charges |
| `coach-sse` (mocked upstream) | 50 concurrent streams | first sentence p95 < 1 s (mock), no stream > 45 s |
| `ws-ramp` (exists, `perf/k6/src/scenarios/ws-ramp.ts`) | 250 → 2,000 sockets on the dev OCI box | move ack p95 < 300 ms, loop lag p99 < 100 ms, RSS < 1 GB |
| `checkpoint-storm` | 200 concurrent games checkpointing | socket checkpoint statement p95 < 300 ms (direct to Neon), 0 lost plies |

The k6 scripts import event names and payload schemas from `@repo/contracts` so they cannot drift (AS §21).

---

## 10. Build order (13 phases)

Revision 1 used the 10 phases of `docs/implementation-plan.md`. Crosswalk (old → new): 1 → P1; 2 → P2 (matchmaking moves to P9, arena to P12); 3 → P3; 4 → P4; 5 → P5 (notifications and the release push move to P10); 6 → P6; 7 → P7; 8 → P8 Learn + P9 Play hub + P12 tournaments and admin; 9 → P10 account area + P11 public, auth, system and PWA; 10 → the DoD rules in every phase + P13 launch. The "Status · Ph" column of §4 uses the new numbers where a row was rewritten in revision 2; elsewhere read an old number through this crosswalk.

| Phase | API work |
|---|---|
| P1 (hotfix lane first) | admin auth, game-write lockdown, PII routes removed; `route()`, `CT/http` (`codes.ts`, registry directories), `GET /api/me`, Clerk webhook, `POST /api/session/clear`, `POST /api/billing/refresh`, the billing compare-and-set, `GET /api/openings` public, socket-token claims, CRON-1, test hooks and `x-rc-now` |
| P2 | `POST /api/games`, `GET /api/games/[ref]`, bot checkpoint/complete, PGN (`no-store`), socket protocol v2, `/internal/emit`, HMAC |
| P3 | `/api/review/[ref]/*`, shares and `/r/[code]`, archive `GET /api/me/games`, worker kick |
| P4 | `/api/accounts/*`, `/api/import/*`, onboarding, checkout activation, `entitlement:changed` |
| P5 | `/api/train/*`, `/api/home`, `/api/me/badges`, `POST /api/reports` |
| P6 | `/api/train/weakness*` |
| P7 | `/api/coach/*` (SSE with cancellation, stop beacon, hint, context) |
| P8 | catalogue (`/api/legends`, `/api/openings`, `/api/positions`), lessons |
| P9 | challenges, queue (socket), preferences |
| P10 | players (public + `/me`), settings, membership, notifications, export, deletion, INT-13, INT-16 |
| P11 | public pages, contact, consent, search |
| P12 | tournaments (public + `/me`), admin, INT-9…12 |
| P13 | production cut-over, `@prod-smoke`, the alias removals |
## 11. Open questions for the owner

| # | Question | Default this document assumes |
|---|---|---|
| Q1 | Can lapsed members read their past reviews ("past reviews stay readable", PLAN §1.7)? | Supported by `M/L` + `LAPSED_READ` env; **off** until you decide |
| Q2 | Spectating: members only, public games only? Are friend games private by default? | Members only; quick and tournament games public, friend games private |
| Q3 | Internal ratings (Glicko-2 per pool, shown as "Blitz 1184 → 1186") or imported Chess.com/Lichess ratings? (AS Q4, IS Q16) | Internal Glicko-2 for live rated games, seeded from the imported rating; `game:result.ratings` and `PLY-2` carry it |
| Q4 | Coach fair-use cap: 200/day (PLAN) or ~30/day + ~300/month (RS, RA)? | Both limits configurable; launch with 30/day + 300/month |
| Q5 | Move Vercel to Pro before charging customers (Hobby is non-commercial and has the tighter limits this plan works around)? | Plan fits Hobby; recommend Pro at go-live |
| Q6 | Offer "pause membership" in the cancel flow (`BIL-12`)? | Built only if you keep the retention offer |
| Q7 | Who can create tournaments: admins only, or members with a cap? (AA F-26, IA Q27) | Admin only (`ADM-8`) |
| Q8 | Is Vercel Firewall rate limiting available on the Hobby plan for the edge layer, and are Neon unlogged tables acceptable for limiter state? | Verify both on the dev project; fallbacks in §2.10 |
| Q9 | Should imported Chess.com/Lichess games appear on the public profile? | No: owner-only (`PLAY-10`), public profile shows Replay games only |
| Q10 | Live-game persistence through internal web routes (this plan) vs direct Neon writes from the socket server (PA) | Internal routes now; revisit if Vercel usage or latency becomes the constraint, without a protocol change |
| Q11 | Coach models: Sonnet 5.5 for chat and Haiku 5.5 for review text (PLAN Phase 7), or another model? | Model ids are env (`COACH_CHAT_MODEL`, `COACH_TEXT_MODEL`); PLAN's choice by default |
| Q12 | Public review share page `/r/{slug}`: no design board exists (RA Q3) | Snapshot-only, `noindex`, revocable, opponent masked when "show my username" is off |
| Q13 | Chess.com handle ownership: allow any handle, or verify via a code in the profile location field? (AA F-27) | Allow; uniqueness per user and provider, not global; flag duplicates for review |
| Q14 | CLAUDE.md says `prisma db push` on shared databases; ADB §4.2 recommends `migrate deploy` only. The API deploy order (receiver before sender for internal changes) assumes migrations run before the web deploy | Schema plan decides; this plan only needs "schema first, then web, then OCI" |
| Q15 | Study phase for every game or only legend/opening starts? (AS Q1) | `studySeconds` per game: 30 when `startFen` is not the initial position, else 0 |

---

## Appendix A. Tables the API layer itself needs (hand-off to the schema plan)

| Table | Key columns | Indexes | Retention |
|---|---|---|---|
| `idempotency_keys` | `userId`, `key`, `route`, `requestHash`, `status`, `responseStatus`, `responseBody jsonb`, `createdAt` | PK `(userId, key)` | 24 h (cron `prune`) |
| `rate_limit_buckets` (**UNLOGGED**) | `key text PK`, `tokens real`, `updatedAt`, `allowed` | PK | idle > 2 h |
| `webhook_events` | `id text PK` (delivery id), `provider`, `type`, `receivedAt`, `processedAt`, `payload jsonb` (trimmed) | PK, `(provider, receivedAt)` | 30 d (Clerk), 180 d (Dodo payload) |
| `billing_events` | `id`, `userId`, `type`, `subscriptionId`, `outcome`, `payloadHash`, `at` | `(userId, at DESC)` | 2 years |
| `admin_activity` | `id`, `actorId`, `action`, `entity`, `entityRef`, `diff jsonb`, `at` | `(at DESC)`, `(entity, entityRef)` | 2 years |
| `coach_usage_days` | `userId`, `day date`, `messages`, `inputTokens`, `outputTokens`, `costMicroUsd` | PK `(userId, day)` | 13 months |
| `coach_messages` (API needs) | `+ clientId uuid`, `status enum(streaming, done, aborted, fallback, error)` | unique `(userId, clientId)`, partial `(userId) WHERE status='streaming'` | 180 d |
| `user_settings` | `userId PK`, `prefs jsonb`, `version`, `reminderUtcMinute`, quiet-hour columns, `emailOptIns text[]` | PK, `(reminderUtcMinute)` | life of account |
| `notifications` | `id`, `userId`, `kind`, `title`, `body`, `url`, `dedupeKey unique`, `status`, `readAt`, `createdAt` | `(userId, createdAt DESC)`, partial unread | read > 90 d |
| `push_subscriptions` | `id`, `userId`, `endpoint unique`, `p256dh`, `auth`, `platform`, `failureCount`, `lastOkAt` | `(userId)` | dropped after 3 failures or a 410 |
| `trial_ledger` | `emailHash`, `handleHash?`, `usedAt` | PK `(emailHash)` | permanent (privacy-policy wording, IP Q9) |
| `account_deletions` | `id`, `userRefHash`, `emailHash`, `requestedAt`, `steps jsonb` | `(requestedAt)` | 1 year |
| `username_history` | `userId`, `usernameLower`, `changedAt` | `(usernameLower)` | 90 d |
| `challenges`, `shared_positions`, `game_shares`, `tournament_invites` | `code`/`slug` unique, `status`, `expiresAt`/`revokedAt`, owner | unique code, `(status, expiresAt)` | per inventory |
| `jobs` | as ADB §11.4 (`dedupeKey unique`, `priority`, `runAt`, `status`) | partial `jobs_ready_idx`, `jobs_running_idx` | done > 7 d |
| (withdrawn) `GameMove` — moves are the packed `Game.moves` text (B3) | — | — `(gameId, ply)` | life of game |

## Appendix B. Secrets and environment variables

The canonical list is `01-architecture.md` Appendix A and CR-26. The API-relevant subset:

| Variable | Where | Purpose |
|---|---|---|
| `SOCKET_TOKEN_SECRET` (key set) | web (sign), socket (verify) | browser socket tokens only |
| `INTERNAL_API_SECRET` (key set `kid:base64[,…]`) | web (`web`), socket (`ws`), worker (`wk`), deploy CLI (`ops`) | HMAC on every internal hop (§2.11.6). `INTERNAL_API_SECRET`, `RC_INTERNAL_KEYS` and `INTERNAL_API_TOKEN` are not created |
| `CRON_SECRET` | web | CRON-1 bearer |
| `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET` | web | Clerk |
| `DODO_PAYMENTS_API_KEY`, `DODO_PAYMENTS_WEBHOOK_KEY`, product ids | web | billing |
| `SIGNED_COOKIE_SECRET` | web | `rc_act`, `rc_lichess_pkce` |
| `HASH_PEPPER` | web, worker | email hashes (trial ledger, deletion, contact limits) |
| `RATE_LIMIT_IP_PEPPER` | web | IP hashes in limiter keys |
| `LINK_TOKEN_KEYS` | web (public half), worker | only if a Lichess token is stored (P4 decides; default: not stored) |
| `ANALYSIS_WORKER_URL`, `WS_INTERNAL_URL` | web | internal targets |
| `WEB_APP_URL` | socket, worker | `/api/internal/*` base |
| `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_WEBSOCKET_URL`, `NEXT_PUBLIC_ENGINE_BASE_URL` | web | origins |
| `APP_ENV`, `ALLOW_TEST_HOOKS`, `E2E_TEST_TOKEN`, `PERF_TOKEN` | all | test-hook gating (§2.11.3) |
| `MIN_CLIENT_BUILD` | Edge Config | 426 gate |
| `COACH_SYSTEM_CACHE_TTL`, `COACH_LLM_PROVIDER` (non-prod), `COACH_FAKE_UPSTREAM` (non-prod) | web | coach |
## Appendix C. Inventory alias map

Use this to translate the per-area inventories to the canonical names.

| Inventory name | Canonical |
|---|---|
| IP `GET /api/me`; IS `GET /api/me/shell`; IA #1 `GET /api/me` | `ME-1 GET /api/me` |
| IP `PATCH /api/me/onboarding`; AA `PATCH /api/me {onboardingStep}`; AC `PUT /api/onboarding/{step}` | `ME-4 PATCH /api/me/onboarding` |
| IS `PATCH /api/me/notification-prefs`; RB W8 `PATCH /api/train/prefs`; PB A18 | `ME-3b PATCH /api/me/preferences` |
| IS `PUT /api/me/consent` | `ME-5 PUT /api/consent` |
| IS `POST /api/push/subscriptions`, `DELETE /api/push/subscriptions/:id` | `ME-9b`, `ME-10` under `/api/me/push-subscriptions` |
| IS `GET /api/notifications`, `POST /api/notifications/read` | `ME-11` under `/api/me/notifications` |
| RB R8 `GET /api/me/badges` | `ME-2` |
| IP `POST /api/accounts/chesscom/lookup`; IA #26; AC `POST /api/onboarding/link/preview` | `ACC-2 POST /api/accounts/chesscom/lookup` |
| IP `POST /api/accounts/chesscom`; IA #27; AA `POST /api/accounts/chesscom` | `ACC-3` |
| IP `GET /api/accounts/lichess/start\|callback`; IA #28 `/api/auth/lichess/*`; AA `POST /api/accounts/lichess/oauth/{start,callback}` | `OAU-1`, `OAU-2 /api/oauth/lichess/*` |
| IP/IS `GET /api/import/status`; PB A15 `GET /api/me/import-status`; AA `GET /api/imports/[id]` | `ACC-7 GET /api/me/imports` |
| IP `POST /api/import/:ref/retry` | `ACC-8 POST /api/me/imports/{ref}/retry` |
| AA/AC `POST /api/imports`, `POST /api/import {source}` | `ACC-3` (link) / `ACC-4` (sync) |
| IA #30 `GET /api/me/membership`; AC `GET /api/billing/membership` | `BIL-3 GET /api/billing/membership` |
| IA #31 `GET /api/me/billing` | `BIL-4 GET /api/billing/details` |
| IA #32 `GET /api/me/invoices/{paymentId}` | `BIL-5 GET /api/billing/invoices/{paymentId}` |
| AC/IS `POST /api/billing/refresh`; IP `GET /api/billing/activation` | `BIL-2 GET /api/billing/activation` (+ `ME-1 ?refresh=billing`) |
| AA `POST /api/billing/portal`; IS/IA `GET /api/customer-portal` | `BIL-14` (GET kept as an alias) |
| RA `GET /api/review/:ref`; AA `GET /api/games/[ref]/review`; AC `GET /api/review/:gameId` | `REV-1 GET /api/review/{gameRef}` |
| RA `GET /api/review/:ref/status`; PB A9 `GET /api/games/[ref]/status` | `PLAY-5 GET /api/games/{ref}/status` |
| RA A3 `POST /api/review/:ref/analyse`, A4 `/retry`; AA `POST /api/games/[ref]/analysis` | `REV-3 POST /api/review/{gameRef}/analysis` |
| RA A5–A7, A10 | `REV-4…7` under `/api/review/{gameRef}` |
| RA A8 `/api/review/:ref/pgn`; PA `GET /api/games/[ref]/pgn` | `PLAY-6 GET /api/games/{ref}/pgn?annotated=true` |
| RA A9 `/api/review/:ref/legend`; PB A10 | `PLAY-7 GET /api/games/{ref}/legend-comparison` |
| RA A11 `PATCH\|DELETE /api/share/:slug` | `SHR-2`, `SHR-3 /api/shares/{slug}` |
| IA #12 `POST /api/me/games/review-batch` | `REV-8 POST /api/review/batch` |
| RA A14 `POST /api/coach/messages`; AA/IS `POST /api/coach` | `CO-3 POST /api/coach/messages` |
| RA A13 `GET /api/coach/context`; IS `GET /api/coach/suggestions` | `CO-1 GET /api/coach/context` |
| AC `POST /api/coach/:messageId/resume` | `CO-5 GET /api/coach/messages/{ref}` + `CO-4` retry |
| AC `POST /api/coach/:id/rate` | `CO-7 POST /api/coach/messages/{ref}/feedback` |
| AA `GET /api/train/today`, `GET /api/bank`, `POST /api/train/sessions`, `POST /api/train/cards/[id]/grade`, `GET /api/puzzles/next`; AC `POST /api/train/cards/:id/review`; ADB `POST /api/train/review`; IS `POST /api/train/reviews/batch` | `TR-1`, `TR-2`, `TR-7`, `TR-6 POST /api/train/attempts` (puzzles come through sessions) |
| AA `GET /api/weakness`, `POST /api/weakness/drill`; AC `GET /api/weakness` | `TR-5 GET /api/train/weakness`, `TR-7 {kind: "weakness"}` |
| RB W7 `POST /api/train/reports`; IA #15 `POST /api/reports` | `SYS-6 POST /api/reports` |
| RB R7 `GET /api/learn/openings`; IP `GET /api/openings/search`; AA `GET /api/catalog/openings` | `CAT-3 GET /api/openings` |
| AA `GET /api/catalog/legends` | `CAT-1 GET /api/legends` |
| PA `GET /api/positions/featured`, `GET /api/positions/search`; PB A1, A2 | `CAT-5 GET /api/positions` |
| PB A3 `GET /api/positions/[slug]` | `CAT-4` |
| AA `POST /api/games {mode: bot\|friend\|legend\|position\|opening}` | `PLAY-1` (bot, legend_bot) and `CHL-1` (friend) |
| AA `POST /api/games/[ref]/join`, `DELETE /api/games/[ref]` | `CHL-3`, `CHL-5` |
| AA/AC `GET /api/games/[ref]`, `GET /api/invites/:ref` | `PLAY-2`, `CHL-2` |
| PB A14 `GET /api/me/games` | `PLAY-10` |
| IA #13 `GET /api/me/games/export.pgn` | `PLAY-11 GET /api/me/games/export?format=pgn` |
| IA #50 `POST/DELETE /api/tournaments/{slug}/find-match` | `TOU-10` (fallback) |
| AS `/api/internal/live-games/*`; PA `POST /api/games/[ref]/complete` (live) | direct `DB/src/live/*` (B4; INT-1…8 withdrawn), `PLAY-4` (bot only) |
| IA #60–63 | `INT-10`, `INT-11`, `INT-9`, `INT-12`, `INT-13` |
| AS/IS/IA/PA `POST /internal/tournament-event`, `/internal/user-event`, `/internal/review-event`, `/internal/notify` | `WS-3 POST /internal/emit` |
| RA W1 `POST {ws}/internal/analysis/kick`; ADB `POST <oci>/wake` | `WK-1 POST /internal/analysis/kick` |
| RA W2 `POST {ws}/engine/analyse` | `WK-2 POST /engine/analyse` |
| IS `POST /internal/broadcast`; AS `POST /internal/drain` | `WS-4`, `WS-5` |
| AS `game.join`, `game.move`, `game.draw.offer` …; PA `game:join` … | P2 names (`game:join`, `game:move`, `draw:offer` …; §6.1, P2 §7.4.9) |
| RA `review:join` + room token | none: `analysis:*` on `u:` |
| IS `import_progress`, `analysis_progress`, `entitlement_changed`, `bank_due_changed`, `notification`, `session_revoked`, `notice` | `import:progress`, `analysis:progress`, `entitlement:changed`, `bank:due_changed`, `notify:new`, `session:revoked`, `system:notice` |
| IA `membership:updated`; IP `entitlement_changed` | `entitlement:changed` |
| AS `user.notify {kind}` | the individual `u:` events in §6.6 |
| IA `tournament:join_room` / `leave_room`; v1 `join_tournament_lobby` | `tournament:watch` / `tournament:unwatch` |
| AA `GET /api/health`; IS `GET /api/health` | `SYS-1` |
| IP `GET /api/cron/daily`; IA #40 `GET /api/cron/membership-reconcile`; PLAN `/api/cron/trial-reminders` | `CRON-1 GET /api/cron/daily` (tasks inside) |

**Revision 2 aliases** (so IDs from revision 1 and the inventories still resolve):

| Revision 1 / inventory name | Canonical (revision 2) |
|---|---|
| `/api/review/{gameRef}`, `/api/review/{gameRef}/*`, `/api/games/{ref}/status`, `/api/games/:ref/review` | `/api/review/[ref]`, `/api/review/[ref]/*`, `/api/review/[ref]/status` |
| `GET /api/games/{ref}/legend-comparison` (PLAY-7) | `GET /api/review/[ref]/legend` (REV-9) + `POST …/legend/compute` (REV-10) |
| `/api/accounts/*`, `/api/oauth/lichess/*` | `/api/accounts/*`, `/api/accounts/lichess/{start,callback}` |
| `GET /api/me/imports`, `/api/me/imports/{ref}/retry` | `/api/import/*` |
| `GET /api/me/membership` | `GET /api/billing/membership` |
| `/og/game/{ref}` | `/r/{code}/opengraph-image` (shares only) |
| `/internal/analysis/kick`, `/worker/engine/analyse`, `/worker/health` | `/internal/analysis/kick`, `/engine/analyse`, `/health` |
| `/api/internal/live-games/*` (INT-1…8) | `DB/src/live/*` (direct, B4) |
| `GET /api/subscription?refresh=1`, `GET /api/me?refresh=billing` | `POST /api/billing/refresh` |
| `POST /api/train/reports`, `POST /api/reports {kind:"player"}` | `POST /api/reports {targetType, …}` (P5, extended by P10) |
| socket `u:`, `g:`, `t:` rooms; dot-case events; `game:over`; `bank:due`; `notification:new`; `membership:updated`; `match:found`; `notice` | `user:`, `game:`/`spectate:`, `tournament:`; colon case; `game:ended`/`game:result`; `bank:due_changed`; `notify:new` (P10); `entitlement:changed`; `queue:matched`; `system:notice` |
| `x-client-build` | `x-rc-build` |
| T0, T1, T2, T3, NS | `public-static`, `public-short`, `private-etag`, (withdrawn: no per-user immutable tier), `no-store` |

## Appendix D. Contract test matrix (CI)

Generated from the registry: every endpoint × every applicable row.

| Case | Expectation |
|---|---|
| Signed out on `U`/`M` | 401 `unauthorized`, envelope shape, `x-request-id` header |
| Non-member (test user R, `.env.test`) on `M` | 402 `subscription_required` |
| Trial-used non-member (user Q) on `M` | 402 `subscription_required` (`reason: trial_used`) |
| Member, not the player, on `Pl` | 404 `not_found` (never 403) |
| Member on `A` | 403 `forbidden` |
| Missing/invalid HMAC on `I` | 401, no detail |
| Wrong `Origin` on a cookie mutation | 403 `origin_mismatch` |
| Malformed JSON | 400 `invalid_json` |
| Unknown body field (strict schemas) | 400 `validation_failed` with `details.issues[].path` |
| Body over `maxBodyBytes` | 413 `payload_too_large` |
| Rate limit exceeded | 429 `rate_limited`, `Retry-After` header equals `retryAfterSec` |
| Same `Idempotency-Key` twice | same status and body, `Idempotent-Replayed: true` |
| Same key, different body | 422 `idempotency_key_reused` |
| Unknown server error (fault injection) | 500 `internal`, no stack or message leak, a Sentry event with the request id |
| GET on any route | no DB writes (asserted with a Prisma middleware counter in tests) |
| Response body | parses against the registry's response schema |
| T0/T1 route | `Vercel-CDN-Cache-Control` present, no `Set-Cookie`, no viewer-dependent fields |
| Socket: every command | invalid payload → ack `{ ok: false }` (no crash); non-member → `not_member`; rate limit → `rate_limited` |

## Appendix E. Critique dispositions (revision 2)

| Finding | Disposition | Where |
|---|---|---|
| api-perf §4.3 item 1 (precedence header, registry as source of truth) | Applied | header |
| api-perf AP-21 (two `api()` sketches, `ifNoneMatch`) | Applied: one implementation, no `ifNoneMatch` | §3.2 |
| api-perf AP-40 (body cap by bytes read) | Applied | §2.5 step 4 |
| api-perf AP-11, AP-32 (rate limits: fixed window, durable long windows, `bot-checkpoint`) | Applied | §2.10 |
| api-perf AP-41 (lazy token refresh, mint from claims) | Applied | §2.11.5 |
| api-perf AP-44, feasibility SEC-4 (HMAC mandatory, per-caller keys and allow-lists) | Applied from P2 (the P3 transition window is unnecessary because P2 switches every caller) | §2.11.6 |
| consistency R-08 (keep `x-internal-token`, HMAC unscheduled) | **Rejected**; its one-helper / one-env-name parts applied (`INTERNAL_API_SECRET` as the key set) | §2.11.6, App. B |
| api-perf AP-03, AP-04, AP-05, AP-22, AP-29, AP-34 (cache leaks, P+ split, OG images, return-target) | Applied | §2.12, §4.1 SYS-3/SYS-4, §4.6, §4.7, §4.11, §4.12 |
| api-perf AP-31, AP-06 (billing refresh by GET, CAS) | Applied: `POST /api/billing/refresh`; GETs DB-only | §4.2 ME-1, §4.3 BIL-3/BIL-15/BIL-16 |
| api-perf AP-08 (INT-9 every 60 s, worker timers) | Applied: boot + push + data-cache re-sync; next-due rows | §4.14 INT-9, §8.4 |
| api-perf AP-09 (GETs enqueue) | Applied | §4.7 |
| api-perf AP-38 (counts on every page) | Applied | §2.7 note, §4.6 PLAY-10, §4.11 PLY-3 |
| api-perf AP-37 (max-age on a POST) | Applied: CO-6 carries no cache header | §4.8 CO-6 |
| api-perf AP-02, AP-13, AP-46 (cancellation, charging, insert before the LLM) | Applied | §0.1 API-12, §7.7, §7.8 |
| api-perf AP-36 (§9.2 budgets against missing tables) | Applied: points to the phase specs | §9.2 |
| api-perf AP-35 (measurement sources) | Applied | §9.7 |
| api-perf §1 drift register (names) | Applied | §0, App. C additions |
| consistency R-06 (error ledger) | Applied | §2.6 |
| consistency R-07 (rooms, emit body, events) | Applied | §6, §4.15 WS-3 |
| consistency §3 (`route()`, aliases, `apps/analysis-worker`, `/internal/analysis/kick`) | Applied | §0.1, §4.15, App. C |
| feasibility 10.3 items 1–10 | Applied: worker topology and directory; test-hook gating; review root; kick body; socket names; §7.1 wording ("Hobby with Fluid: 300 s max; we cap at 60 s"); §8.4 job rows, no `node-cron`, 14 + 2 backups, cron table; §9.6 usage lines; crosswalk; Appendix B | §0, §2.11.3, §4.7, §4.15, §6, §7.1, §8.4, §9.6, §10, App. B |
| feasibility F-API-1 (Chess.com lookup fallback) | Applied | §2.10, §4.15 WK-4 |
| testing X5, X12 (server time, test-hook registry) | Applied | §2.11.3 |
