# Replay Chess: API and performance optimization plan

Status: **final plan, revision 2**, 2026-11-02 · repo `/Users/rohitpandit/open_source/chess-battle-turbo`, branch `dev` (HEAD `0848b76`, Phase 0 done) · scope: every request the coaching app makes, from the browser to Vercel, to Neon, to the OCI socket server and analysis worker, and to Anthropic, Dodo, Clerk, Chess.com and Lichess.

**What revision 2 changed** (dispositions in Appendix B):
1. **Socket persistence is direct** (B4): checkpoints and one finish CTE from the socket server to Neon; revision 1's D2 (internal routes) is withdrawn except for tournament pairing/start/finalize (§0.2, §3.7.1).
2. **SLOs are measured server-side first.** PostHog loads only after analytics consent (default deny), so review-ready, coach first sentence and move-ack come from worker, coach and socket timings; client numbers go through anonymous Sentry metrics if the owner allows them (§2.6, §2.7, §9.3).
3. **Every budget has a formula and a source** (§2.8), and the Hobby facts are the verified ones, including "an overage pauses the feature for up to 30 days" (§1.1).
4. **Names and SQL follow the canonical tables** (`01-architecture.md` §0.3): P2 socket events (`move:applied` ≤ 200 B without `fen`), `training_cards`/`training_attempts`, `training_days.plan`, `jobs_ready_idx (priority DESC, "fairSeq", "runAt")`, `coach_messages (userId, clientId)`, strong ETags, `JOB_PRIORITY` names, P1's fixed-window limiter with durable long windows (§3.5, §5.4, §8.3).
5. **Corrected write paths:** the coach's `clientId` insert completes before the LLM call; the import upsert uses `ON CONFLICT … DO UPDATE … RETURNING` so a second member's import is never skipped (§3.7.5, §3.7.6).
6. **No timers against Neon** and **Neon-suspend-proof pools** (§3.1, §3.9).
7. **The backlog uses the 13-phase numbering** (§10).

**How to read this document**

- Paths are relative to `apps/web/` unless they start with `apps/`, `packages/`, `perf/`, `deploy/` or `.github/`. `ws:` means `apps/web-socket/`. Line numbers are from the current files and from the five audits.
- Audit IDs: `API F-nn` = `audit-api.md`; `DB-nn` = `audit-db.md`; `CL §n` = `audit-client.md`; `Q PERF-nn` / `Q SEC-nn` = `audit-quality.md`; `WS F-nn` = `audit-socket.md`. The consolidated audit is `06-codebase-audit.md`.
- Design boards are `design-ref/project/v2/*.dc.html`, and their state names come from each board's `data-props.state.options`.
- Numbers marked **(est.)** are reasoned, not measured. Section 9 says how each one gets measured.
- Endpoint names follow `03-api-design.md` and the phase specs. This plan groups endpoints into **classes** (§2.1), so a rename does not change a budget.

---

## 0. Summary

### 0.1 Where the time and the quota go today

| # | Cost driver | Evidence | Size today (est.) | Target |
|---|---|---|---|---|
| 1 | Every hard page load runs `POST /api/user/sync` (Clerk Backend API call + write) and then `GET /api/subscription` (1–2 Dodo calls + write), one after the other | `app/components/UserSync.tsx:103,138`; `app/api/user/sync/route.ts:26-84`; `app/api/subscription/route.ts:89-137` (API F-07, CL §3.1) | 3–5 invocations, 2 writes, 300–1,000 ms before the page is usable | 0 extra invocations: the server layout reads the viewer once (§3.6.1) |
| 2 | Every chess move is an HTTP call from Mumbai to Vercel to Neon that rewrites the whole verbose move history | `ws:GameSession.ts:440,1097-1111`; `app/api/chess/move/route.ts:73-86` (WS F-18, DB-03) | ≈88 invocations, ≈250 statements and 776 KB rewritten per 80-ply game | ≈8–10 invocations and ≈4 KB per game (§3.7.1) |
| 3 | Matchmaking polls every second, and each poll runs a locking transaction; tournament search polls every 2–4 s with a write | `lib/hooks/useMatchmaking.ts:30,119`; `app/tournament/[tournamentReferenceId]/FindMatchButton.tsx:68-95` (API F-08, DB-05) | 60 invocations and ≈420 statements per searching minute; Neon never scales to zero | 0 HTTP calls: socket push (§6.1) |
| 4 | Catalogue pages are `force-dynamic` and query Neon on every crawler hit; `/openings` ships 8.1 MB of HTML | `app/openings/page.tsx:9`, `app/legends/page.tsx:7` (DB-15, CL §13) | ≈3,700 crawlable URLs × 1 invocation + 2 queries | ISR + CDN: 0 queries per hit (§4.3) |
| 5 | 100 % trace sampling, Replay and PostHog load on every page, and the Sentry tunnel is a function call | `instrumentation-client.ts:14,17,31,38-47`; `sentry.server.config.ts:13,20`; `next.config.js:187` (API F-13, CL §10.7) | 105 kB of JS on every route; about 1 invocation per navigation | Errors at 100 %, traces at 0.1, lazy Replay (§9.2) |
| 6 | The service worker precaches 293 JS chunks (every route, admin included) plus 4.8 MB of assets, and runtime-caches `/api/*` | `next.config.js:13-35`; `public/sw.js` (CL §10.6) | Every deploy re-downloads every chunk for every installed user | Shell-only precache; `/api` NetworkOnly (§4.8) |
| 7 | A 7.3 MB Stockfish WASM loads on every game page, PvP and spectators included, with `max-age=0` | `app/game/[gameId]/GamePageContent.tsx:126`; `lib/hooks/useStockfish.ts:102`; `next.config.js:160-164` (CL §9) | 7.3 MB revalidated per game page | Loaded only for bot, practice and the Review engine panel; hashed and immutable (§7.2) |

### 0.2 The twelve decisions this plan makes

| # | Decision | Why (one line) | Section |
|---|---|---|---|
| D1 | Vercel functions stay in **`iad1`**, next to Neon **us-east-1**. Every DB-backed route runs on the **Node** runtime. Edge runs only middleware, and middleware does no DB work | A DB-backed edge function near an Indian user would pay ~230 ms per query instead of ~1 ms | §1.2, §3.1 |
| D2 **(r2)** | The socket server persists **directly to Neon** through `DB/src/live/*` (B4, P2 §6.6): ≤ 10 one-statement checkpoints per game and **one** data-modifying CTE at the finish. Only tournament pairing, start and finalize go through signed web internal routes (P12 D12-4) | One CTE from Mumbai is one ~220 ms round trip, the same cost as one internal call but without a Vercel invocation; stats, ratings, scoring and the analysis enqueue are named CTE fragments in one shared package | §3.7.1 |
| D3 | The analysis worker talks to Neon **directly over Neon's HTTP driver**: one round trip to claim a job, one round trip to write the whole result as set-based statements | HTTP `transaction([...])` sends a multi-statement batch in a single request; natural keys mean no statement needs another's `RETURNING` | §3.7.3 |
| D4 | Live moves are stored as **packed columns** (`Game.moves`, `moveClocksMs`, `plyCount`) with a ply guard, plus `pgn` once at the end | About 5 bytes per ply, one indexed row, and duplicate or reordered checkpoints are harmless | §3.7.1 |
| D5 | Analysis is stored **packed per game** (`GameAnalysis`), plus `GamePlayer` aggregates, `PlayerReview` and `Mistake` rows. There is no per-ply `MoveEval` table | ~1.6 KB per game instead of ~21.6 KB (DB-10) | §3.5, §5.2 |
| D6 | The **eval cache lives on the worker's disk** (in-process LRU → SQLite → Lichess CC0 seed), never in Neon | No 230 ms lookups, no Neon storage, no compute wake-ups | §4.6 |
| D7 | Lichess puzzles are **static, immutable JSON shards on R2**. Postgres stores only the cards a user has seen | Saves ~350 MB of the Neon storage cap (DB-10) | §4.2, §5.3 |
| D8 | **Push, not poll**: matchmaking, arena pairing, review progress, import progress, bank due count and entitlement changes travel over the socket. HTTP polling is only a fallback when the socket is down, in visible tabs, and it stops | Polling is the largest invocation and compute-hour source | §6.1, §5.4 |
| D9 **(r2)** | **Cache tiers are declared per route** in the route wrapper: `public-immutable`, `public-static`, `public-short`, `private-etag` (`private, no-cache` + **strong** ETag), `no-store`, `sse`. `public-*` only on routes that read no session; **no per-user response has `max-age > 0`**; sign-out clears the browser cache | One rule set prevents both stale CDN copies and cross-user leaks on shared devices | §4.2 |
| D10 **(r2)** | Expensive actions are rate-limited with **P1's one-statement fixed-window limiter**: the `UNLOGGED` burst table for windows ≤ 60 s, durable counts (source rows or a logged table) for longer windows. Cheap traffic is limited by the Vercel Firewall and by in-memory per-socket buckets | No Redis on the free tiers; an UNLOGGED table empties at every Neon scale-to-zero, so long windows must be durable | §8 |
| D11 **(r2)** | The **prod analysis worker gets its own A1 instance** (2 OCPU / 12 GB, P13 D7). Dev keeps a co-located worker in a `cpu.idle` cgroup slice capped at 0.75 CPU (P3-D8; fallback `cpus 0.5` + `nice 10`) | Stockfish on the 1-OCPU socket box would delay clocks (WS F-38). 1 + 1 + 2 OCPU is exactly the Always Free total | §6.2 |
| D12 | The coach streams SSE from a Vercel function (`maxDuration = 60`, **`supportsCancellation: true`**), with prompt caching on a stable prefix (5-minute TTL by default). A **measured budget gate** decides whether it moves to OCI or to Vercel Pro (Pro is needed before charging anyway) | Hobby's provisioned-memory allowance, not CPU, is what a streaming LLM call uses up | §6.4 |

### 0.3 Conflicts between the audits, and how this plan resolves them

| Topic | Audit positions | Resolution here |
|---|---|---|
| Socket → DB path | API F-09 and Q PERF-04: the socket writes Neon directly. DB §5.3 and WS §18: the socket stays DB-free and calls internal routes | **Direct (B4, D2)**, with the tournament exception. Revision 1 chose internal routes because a multi-statement finish from Mumbai would take 1–1.5 s; P2 writes it as **one CTE**, so it costs one round trip |
| Live move storage | DB §7.2: packed `moves` text + `moveClocksMs`. WS §18.2: a `GameMove` row per ply | **Packed** (D4). `spentMs` per ply is derived from consecutive clocks plus the increment |
| Eval cache | inv-rct-a §2.2: a `PositionEval` table in Neon. DB §11.5: worker local disk | **Worker disk** (D6) |
| Worker placement | inv-rct-a §2.2: in the socket box's compose file. WS F-38: its own instance | **Own instance in prod, co-located in dev** (D11) |
| Per-move rows for analysis | Plan Phase 3: `MoveEval`. DB-10: packed `GameAnalysis` | **Packed** (D5) |
| Puzzle store | Plan Phase 5: ~1M `LichessPuzzle` rows. DB §11.6: R2 shards | **R2 shards** (D7) |
| Schema change tool | CLAUDE.md rule 1: `db push` on prod. DB §4.2: `migrate deploy` only | Partial indexes and `NOT VALID` FKs (§3.5) **cannot** survive `db push`. `migrate deploy` on every Neon branch; owner decision OD-6 (= architecture D5) |
| Job priority scale | revision 1 here: lower runs first (0 live, 1 opened, 5, 8). P3-D7, data-model: higher runs first | **Higher runs first**, `JOB_PRIORITY` names only (`USER_OPENED 100`, `GAME_ENDED 80`, `IMPORT_NEWEST 50`, `BACKLOG 10`, `HOUSEKEEPING 0`; full list in architecture CR-9) |
---

## 1. Constraints, topology and budgets

### 1.1 Free-tier ceilings that bind (verified 2026-11-02 unless marked)

Vercel figures come from vercel.com/docs/plans/hobby (2026-09-14) and the functions limitations page (2026-08-24); Neon from the Neon docs; see also `01-architecture.md` §1.13.1.

| Platform | Ceiling | What uses it up in this app | What happens at the limit |
|---|---|---|---|
| Vercel Hobby | Function invocations 1M / month | Page renders (RSC/SSR), API routes, the Sentry tunnel, webhooks, tournament internal routes | **The feature is paused until 30 days have passed** |
| Vercel Hobby | **CDN (edge) requests 1M / month**; every request to the CDN counts, static assets included | Every JS chunk, image, font and RSC prefetch, the `/ingest` PostHog proxy, `/monitoring`, crawler traffic, every SW precache re-download after a deploy, **deployed test runs** | Same |
| Vercel Hobby | Active CPU 4 h / month; provisioned memory 360 GB-h / month | CPU: JSON work and SSR. Memory × wall time: long streams (coach SSE), slow third-party calls | Same |
| Vercel Hobby | Fast Data Transfer 100 GB; Fast Origin Transfer 10 GB | HTML, JS, images (the 7.3 MB Stockfish WASM is served from R2, not Vercel) | Same |
| Vercel Hobby | **Image transformations 5,000 / month**, 300k image cache reads | `next/image` on avatars and portraits (pre-size them on R2 and render `unoptimized`) | Same |
| Vercel Hobby | **Speed Insights 10,000 events / 30 days, team-wide**; Web Analytics 50k events | field Web Vitals | collection stops mid-month |
| Vercel Hobby | **Edge Config 100k reads, 100 writes / month** | ops switches (60 s memo per isolate) | Same |
| Vercel Hobby | Runtime logs kept 1 hour; one function region; crons at most once a day (a more frequent expression fails the deploy); 3 Firewall custom rules; functions up to 300 s with Fluid | Region choice (D1), daily backstops, WAF rules (§8) | — |
| Vercel Hobby | Non-commercial use only | A paid product | **Owner decision OD-1** (Pro before the first charge) |
| Neon Free | **100 CU-hours / project / month**; scale to zero after 5 min with no queries (cannot be disabled; idle connections are closed); 1 GB storage / project; 5 GB egress; 1 manual snapshot; 6 h restore window | Any query in a 5-minute window keeps the compute awake (0.25 CU × 400 h = 100 CU-h, about 13 h of activity a day). Dev, E2E and k6 share production's allowance **until P1 splits the dev project** | **Every compute in the project is suspended for the rest of the month: whole-site outage** (DB §10.1) |
| OCI Always Free | 4 OCPU / 24 GB / 200 GB in total; idle instances can be reclaimed | dev socket+worker 1/6, prod socket 1/6, prod worker 2/12 (D11) | Reclamation of a "quiet" instance (WS F-17), so **OD-5** (PAYG + quotas in P1) |
| Sentry Developer | Monthly error, span and replay quotas; metrics API availability for the v10 SDKs [V] | 100 % traces today | Events dropped |
| PostHog free | ≈ 1M events / month | Autocapture + `pageleave` + custom events (consent-gated) | Ingestion dropped |
| Anthropic | Per-tier rate limits; workspace spend limit | Coach chat (Sonnet 5.5), review text (Haiku 5.5) | 429 / spend cap |

**Consequence:** the design target is **≤ 60 Vercel invocations and ≤ 120 CDN requests per active member per day**, **zero Neon queries from background timers**, and **test traffic against the deployed dev project stops at 60 % of any Hobby quota** (a pause at 100 % would block development for up to 30 days). §7.2 and §4.8 keep edge requests down; §9.4 measures every quota weekly from P1.

### 1.2 Topology and round-trip times

```
 Browser (US / EU / South Asia)
   │  https (HTTP/2) ───────────────► Vercel edge PoP (nearest; TLS ends here)
   │                                      │  CDN HIT → served at the PoP (public tier only)
   │                                      │  MISS / dynamic → Vercel backbone
   │                                      ▼
   │                               Vercel functions iad1 (Node, Fluid) ──1–2 ms──► Neon us-east-1 (pooler)
   │                                      │ ▲                                         ▲
   │                                      │ │ internal https (token)                   │ HTTP SQL (worker only)
   │  wss ────────────────────────────────┼─┼──────────► OCI ap-mumbai-1               │
   │                                      │ └────────── socket server (1 OCPU) ────────┤ (no DB access)
   │                                      └───── kick ► analysis worker (2 OCPU) ──────┘
   │                                                     │ private VCN (≈1 ms) ▲ progress → socket
   │                                                     └─ engine /analyse ◄── Vercel coach tool calls
   └── SSE (coach) ──────────────────► Vercel iad1 ──10–30 ms──► Anthropic API (US)
```

| Hop | RTT (est.) | Notes |
|---|---|---|
| Browser (US East) → Vercel PoP | 10–30 ms | |
| Browser (India) → Vercel PoP (Mumbai) | 10–40 ms | CDN HITs are fast everywhere |
| Vercel PoP (Mumbai) → function in `iad1` | ≈ 200–230 ms | **Every dynamic request from South Asia pays this once** |
| Vercel `iad1` → Neon us-east-1 | 1–2 ms | Same AWS region |
| OCI Mumbai → Neon us-east-1 | ≈ 200–230 ms | Why the worker batches (D3) |
| OCI Mumbai → Vercel (via the Mumbai PoP) → `iad1` | ≈ 220–260 ms | Why the socket server checkpoints (D2) |
| Browser (India) ↔ OCI Mumbai | 10–40 ms | Live play is fast for India |
| Browser (US) ↔ OCI Mumbai | ≈ 200–250 ms | Needs lag credit on the clock (WS §17.9.1) |
| Vercel `iad1` → Anthropic | 10–30 ms | Coach TTFT is dominated by the model |
| Vercel `iad1` → OCI worker `/engine/analyse` | ≈ 220–260 ms | Coach tool call; cached evals return in < 1 ms on the worker |

**Region strategy (OD-4).** If, after 30 days of Speed Insights and PostHog geo data, more than half of member traffic comes from South Asia, the cheapest large win is a new Neon project in Singapore (`aws-ap-southeast-1`; check whether Neon offers an Indian region) with Vercel functions in `sin1`. That cuts the PoP → function hop and the OCI → DB hop to roughly 60–80 ms. It is a migration (dump/restore plus env changes), not a code change. The SLOs in §2 are stated for US-East users with an India column, so the decision can be made from data.

### 1.3 Request budget per active member per day

| Source | Today (est.) | Target | How |
|---|---|---|---|
| App boots (≈3/day) | 3 × (sync + subscription + email fallback + catalogues) ≈ 12 | 3 × 1 (the SSR page itself) | §3.6.1 server viewer |
| Navigations (≈20/day) | 20 RSC + client fetches (≈15 mount fetches, CL §6.1) | ≈20 RSC, plus 0–5 API calls | RSC prefetch + TanStack cache (§4.7); `staleTimes.dynamic: 30` |
| Live games (≈2/day, 80 plies) | 2 × 88 ≈ 176 | 2 × ≈12 (create/join + checkpoints + finish + review read) | §3.7.1 |
| Quick-match search (≈1/day, 30 s) | ≈30 | 0 | socket queue |
| Review opens (≈2/day) | 2 × (analysis API + verbose payload) | 2 × 1 RSC, then socket deltas while analysing | §5.2 |
| Train session (1/day, 10 items) | — | 1 create + 1–3 batched attempt POSTs | §3.7.4 |
| Coach (≈8 messages/day) | — | 1 context read + 8 SSE | §6.4 |
| Sentry tunnel | ≈1 per navigation (100 % traces) | ≈0.1 per navigation | §9.2 |
| **Total invocations** | **≈250–400** | **≈55–65** | |

---

## 2. SLOs and targets

All latency SLOs are **p50 / p95 over a rolling 7 days**, from production field data, unless a row says otherwise. "Server time" is the route wrapper's `Server-Timing: total` (§9.1): from the start of the handler to the response headers, on a warm instance with Neon awake. Cold paths have their own row. User-perceived figures add network time from §1.2.

### 2.1 Endpoint classes (server time)

| Class | What it covers (examples) | Max sequential DB round trips | p50 | p95 | p99 | Timeout / `maxDuration` |
|---|---|---|---|---|---|---|
| **P** public static | `/api/catalog/openings?v=`, `/api/catalog/legends?v=`, puzzle shards, ISR pages (`/legends`, `/openings/[eco]`, `/learn/*`, `/blog/*`) | 0 on a HIT | edge TTFB 30 ms | 100 ms | 250 ms | MISS renders count as **R1** |
| **R1** session reads | `GET /api/me`, `/api/home`, `/api/train/today`, `/api/import/status`, `/api/socket-token`, `/api/games/[ref]` (lobby/participant view), `/api/billing/membership` (DB only) | 2 (viewer + one parallel batch) | 25 ms | 100 ms | 300 ms | 10 s |
| **R2** heavy private reads | `GET /api/review/:ref` (complete), `/api/games?cursor` (archive), `/api/train/bank?cursor`, `/api/train/weakness`, `/api/coach/context`, `/api/players/:u` (+ `/games`), `/api/tournaments/:slug` (snapshot) | 3 | 45 ms | 160 ms | 400 ms | 10 s |
| **W1** small writes | `POST /api/train/attempts` (≤ 50 items), `PATCH /api/me/*`, `POST /api/games/[ref]/join`, `DELETE /api/games/[ref]`, `POST /api/train/cards/:ref/skip` | 2 + one transaction | 40 ms | 150 ms | 400 ms | 10 s |
| **W2** multi-row transactional writes | `POST /api/games` (all modes), `POST /api/train/sessions`, `POST /api/import/:provider`, `POST /api/tournaments/:slug/participants`, `POST /api/review/:ref/retry` | 3 + one transaction | 80 ms | 250 ms | 600 ms | 10 s |
| **X** third-party bound | `POST /api/checkout`, `/api/subscription/*` actions, `POST /api/billing/refresh`, `POST /api/accounts/chesscom/lookup`, Lichess OAuth callback | 3 + ≤ 3 external calls | 500 ms | 1.5 s | 3 s | 15 s; each outbound call 8 s |
| **I** internal (from OCI) | `/api/internal/tournaments/*` (pairing, start, finalize; P12), `/api/internal/notifications`, `/api/internal/revalidate`, account-purge steps. Live-game reads and writes are **not** in this class any more: the socket writes Neon directly (D2) | 2 + one transaction | 15 ms | 80 ms | 250 ms | 1 % |
| **S** streaming | `POST /api/coach/messages` (SSE), `POST /api/coach/messages/:id/retry` | 2 before the stream starts | `ack` frame ≤ 40 ms | ≤ 120 ms | ≤ 300 ms | 60 s; first-token SLO in §2.7 |
| **WH** webhooks | `POST /api/webhook/dodo-payments`, `POST /api/webhook/clerk` | 3 | 40 ms | 200 ms | 500 ms | 15 s; side effects in `after()` |
| **Cold** | First request on a new function instance, or after Neon scaled to zero | — | — | +800 ms (function) / +1 s (Neon wake) | first request ≤ 2.5 s total | `connect_timeout=15` |

Rules that come with the classes:

- A route's class is declared in the route wrapper (`class: "R1"`). The wrapper tags the Sentry span with it, so dashboards group by class (§9.2).
- **R and W routes never call a third party in the request path.** Clerk `currentUser()` and `clerkClient()`, and any Dodo or Chess.com call, are allowed only in class X and in webhooks. An ESLint `no-restricted-imports` / `no-restricted-syntax` rule enforces it (§10, OPT-14).
- **No sequential awaits on independent queries.** After the viewer resolves, every independent read runs in one `Promise.all` (API F-17 table).

### 2.2 User-perceived API latency (field, p95)

| Class | US East | Europe | India | Notes |
|---|---|---|---|---|
| P (HIT) | ≤ 120 ms | ≤ 150 ms | ≤ 150 ms | Served at the PoP |
| R1 / R2 | ≤ 250 ms / ≤ 300 ms | ≤ 350 / 400 ms | ≤ 450 / 500 ms | +≈220 ms from the Mumbai PoP to `iad1` (§1.2) |
| W1 | ≤ 250 ms (and **0 ms perceived**: optimistic UI) | ≤ 350 ms | ≤ 450 ms | Grades and settings never block the UI (§3.7.4) |
| X | ≤ 2 s | ≤ 2.2 s | ≤ 2.4 s | A button spinner after 150 ms |

### 2.3 Core Web Vitals per page type (p75, field data from Speed Insights)

| Page type | Routes | LCP mobile / desktop | INP | CLS | TTFB | LCP element |
|---|---|---|---|---|---|---|
| Marketing (CDN) | `/`, `/pricing`, `/how-we-grade`, `/blog/*`, `/learn/*`, `/legends`, `/legends/[ref]`, `/openings/[eco]`, `/openings/[ref]`, legal | ≤ 2.0 s / ≤ 1.5 s | ≤ 150 ms | ≤ 0.05 | ≤ 400 ms | Hero headline or the hero board image |
| Auth (Clerk) | `/sign-in`, `/sign-up`, verify, reset | ≤ 2.5 s / ≤ 1.8 s | ≤ 150 ms | ≤ 0.05 | ≤ 600 ms | Form card |
| App lists and dashboards (dynamic SSR) | `/home`, `/train`, `/train/bank`, `/games`, `/weakness`, `/profile/*`, `/settings/*`, `/tournaments` | ≤ 2.5 s / ≤ 1.8 s | ≤ 150 ms | ≤ 0.05 | US ≤ 600 ms, India ≤ 900 ms | The first board thumbnail or the h1 |
| Board pages | `/game/[ref]`, `/review/[ref]`, `/train/*/session`, `/train/puzzles`, `/practice`, lesson player, `/play` | ≤ 2.5 s / ≤ 1.8 s | **≤ 100 ms** | **≤ 0.02** | US ≤ 600 ms, India ≤ 900 ms | The board (an SVG or CSS grid with no image on the critical path) |
| Onboarding / checkout return | `/onboarding/[step]`, `/checkout/return` | ≤ 2.5 s / ≤ 1.8 s | ≤ 150 ms | ≤ 0.05 | — | Step card |

The same CLS targets hold at **80–150 % browser zoom** and on all 5 device profiles (desktop 1440 × 900 and 1280 × 800, iPad landscape 1194 × 834, iPad portrait 834 × 1194, iPhone 393 × 852, Android 412 × 915). The board's size comes from one CSS variable (`--board`, plan Phase 2), so it never shifts after hydration. Fonts use `next/font` with `adjustFontFallback`, so a font swap does not move the board (§7.2).

**Lab budgets** (Lighthouse CI, mobile profile, on `/`, `/pricing`, `/openings/a`, `/legends`): Performance ≥ 90, TBT ≤ 200 ms, LCP ≤ 2.5 s, CLS ≤ 0.05.

### 2.4 Board interaction latency budget

Measured with `performance.mark` around the handlers (§9.3), on a mid-tier phone profile (Playwright with 4× CPU throttle) and on desktop.

| Interaction | Desktop | Mid-tier phone | How it is met |
|---|---|---|---|
| Pointer down → selected-square highlight + legal-move dots | ≤ 16 ms (1 frame) | ≤ 33 ms | Square state lives in a small store; only the affected squares re-render. Legal moves come from the client `chess.js` instance (~0.05 ms) |
| Drag | 60 fps, no dropped frames | ≥ 50 fps | The dragged piece is one absolutely positioned element moved with `transform` from a `pointermove` ref handler inside `requestAnimationFrame`. **No React state update per `pointermove`** |
| Drop (or second tap) → piece on the target square (optimistic) | ≤ 16 ms | ≤ 33 ms | The optimistic reducer applies the move before emitting |
| Move sound starts | ≤ 20 ms after drop | ≤ 30 ms | Web Audio `AudioBuffer`s decoded on the first user gesture (CL §11.6) |
| Illegal move → shake starts | ≤ 16 ms | ≤ 33 ms | Local validation |
| Emit `game:move` → server ack (`MoveAck`) | network RTT + ≤ 10 ms of server time | same | The "pending" ring shows only if the ack takes > 400 ms; a negative ack rolls back within 1 frame |
| Opponent move received → rendered | ≤ 16 ms + animation (120–200 ms, per the setting) | ≤ 33 ms + animation | `move:applied` deltas, not snapshots (§5.4) |
| Premove fires after the opponent's move | same frame as the render | same | Client queue (WS §17.9.2) |
| Clock display | rAF interpolation; drift from the server ≤ 100 ms | same | `{w, b, run, at}` + `clock:ping` offset; only the two clock nodes subscribe (`useSyncExternalStore`) |
| Review: arrow key → next ply (board + eval-graph cursor + move-list highlight) | ≤ 16 ms | ≤ 33 ms | Every ply is in the packed payload (§5.2); the graph cursor moves with a CSS transform; no network |
| Puzzle: move → right/wrong verdict | ≤ 16 ms | ≤ 33 ms | Validated locally against `solution[]`, no engine |
| Puzzle: grade → next card visible | ≤ 50 ms | ≤ 100 ms | The next card is already in the session payload; the grade POST is optimistic and batched (§3.7.4) |
| Scripting per applied move (main thread) | ≤ 2 ms | ≤ 4 ms | One `chess.js` instance per game (not per render: `GamePageContent.tsx:55` today); React Compiler; no `transition-all` on 64 squares (Q PERF-07) |
| Long tasks during a live game, after hydration | 0 over 50 ms | 0 over 50 ms | The engine is in a Web Worker; MultiPV output is rAF-throttled (`useMultiPvAnalysis.ts:49-58` today flushes per line) |

### 2.5 Realtime (socket server) SLOs

| Metric | Target | Source |
|---|---|---|
| Server move processing (receive → room emit) | p50 ≤ 1 ms, p99 ≤ 5 ms | `ws.move_latency_ms` |
| Event-loop lag | p99 ≤ 20 ms (prod box with no worker on it) | `ws.loop_lag_ms` |
| Connect → `game:join` ack with snapshot | ≤ 2 RTT + 30 ms | websocket transport first (`transports: ['websocket','polling']`) |
| Reconnect detection | ≤ 18 s (`pingInterval` 10 s + `pingTimeout` 8 s; 45 s today, WS F-28) | |
| Checkpoint outbox: age of the oldest unacked ply | p99 ≤ 30 s; alert above 60 s | `ws.outbox.oldest_ms` |
| Plies lost on deploy, restart or crash | 0 (journal + drain, WS §18.3) | restore metric |
| Clock-flag accuracy | ≤ 25 ms late (one `setTimeout(remaining + 20 ms)` per game, monotonic clock) | WS §17.9.1 |

### 2.6 Review-ready time after a game

**Measured server-side** (api-perf AP-15): `worker.review_ready_ms{band}` = the worker's `analysis:done` emit time − `games."completedAt"`, recorded as a Sentry metric and in `game_analyses."readyMs"` for audits; the stage timings below come from the worker's job spans. The in-browser part (first badge rendered) is an anonymous Sentry client metric only if the owner allows it under the cookie policy (architecture D11); PostHog keeps funnels, not SLOs, because it loads only after consent. The targets assume a 60-ply game, the prod worker with 2 engine lanes (D11), the P3-D9 engine profile, and **no** backlog at `JOB_PRIORITY.GAME_ENDED` or above.

| Stage | Budget p50 | Budget p95 | Notes |
|---|---|---|---|
| t0 (`game:ended`) → finish persisted (one CTE from the socket box, the job row inserted in it) | 0.25 s | 0.6 s | §3.7.1 |
| → worker kicked (`/internal/analysis/kick` over the VCN, 1 s timeout) | +0.05 s | +0.2 s | No polling (§6.2) |
| → job claimed (1 HTTP round trip; the job payload **carries the moves**, so there is no second read) | +0.25 s | +0.5 s | §3.7.3 |
| → **first badges visible** (cache hits on book plies, then the first engine plies; `analysis:progress` every 2 plies) | **≤ 1.5 s from t0** | **≤ 3 s** | `analysis:progress` deltas (§5.4), sent only because priority ≥ `GAME_ENDED` |
| → **all badges visible** (pass 1 done; ~30 % of plies from the eval cache) | **≤ 6 s** | **≤ 10 s** | Matches "Badges and the coach appear as each move is graded, usually in under 10 seconds" |
| → pass 2 on 4–6 candidate plies (2 lanes) | +3 s | +6 s | |
| → coach text (template in P3; Haiku 5.5 in P7) + verifier | +0 / +2 s | +0 / +4 s | Template fallback on error |
| → result written (1 HTTP round trip) + `analysis:done` | +0.3 s | +0.6 s | |
| → **review complete** | **≤ 12 s** | **≤ 22 s** | `V3ReviewAnalysing` → `summary` auto-advance |
| Under an import backlog (`BACKLOG` jobs queued) | the same targets × 1.1 | × 1.3 | The worker yields between positions to priority ≥ `GAME_ENDED` (§6.2) |
| Opened imported game (`USER_OPENED`) | complete ≤ 20 s | ≤ 40 s | |
| First import (newest games at `IMPORT_NEWEST`) | 50 games analysed ≤ 15 min after linking | ≤ 30 min | ≈ 270–450 games/h on 2 lanes (est., architecture §1.9.5) |

### 2.7 Coach first sentence

**Measured server-side**: the `coach_messages."firstSentenceMs"` column (P7) and the coach route's Sentry span stages; the client-observed number is an optional anonymous Sentry metric (as §2.6).

| Stage | Budget | How |
|---|---|---|
| Click → request on the wire | ≤ 20 ms | Same-origin POST, so no CORS preflight; the draft is already in state |
| Server: auth (Clerk JWT, verified locally) | ≤ 3 ms | No Backend API call |
| Server: quota **read** ‖ context load (thread tail + review summary) | ≤ 15 ms | 2 parallel reads (§3.6.8) |
| Server: the `(userId, clientId)` user-message insert, **completed before** the model call | ≤ 3 ms | one round trip in `iad1`; a retry can never start a second paid call (§3.7.5) |
| Server: prompt assembly | ≤ 5 ms | The stable prefix is pre-serialised once per instance |
| **`event: meta {messageId}` flushed** | **server ≤ 45 ms** | The UI moves from `typing` to `streaming` ("Thinking…") at once |
| Anthropic time to first visible text (prefix cached; Sonnet 5.5 at effort `low`) | p50 ≈ 0.8–1.2 s (est.; measure) | §6.4.2 |
| Optional engine tool call | +0.4–1.0 s per call | Prefetched for the current ply when the panel opens (§6.4.3) |
| **First verified sentence, no tool call** | **p50 ≤ 1.5 s, p95 ≤ 3.0 s** (US); +0.25 s India | the hard deadline is 20 s (P7), then the fallback |
| **First verified sentence, with one tool call** | **p95 ≤ 4.5 s** | |
| "Explain this move" on a stored key moment | **first byte ≤ 300 ms** | The verified `why` from `PlayerReview.content.moments[]`, no LLM call |
| Stream throughput | ≥ 40 tokens/s rendered without jank | rAF batches |
| Stop / navigate away → upstream LLM request cancelled | ≤ 200 ms | `request.signal` (needs `supportsCancellation: true` in `vercel.json`) → `stream.abort()`, plus the `stop` beacon (§6.4.4) |

### 2.8 Availability, error and cost budgets (with formulas; api-perf AP-35)

| Budget | Target | Metric, source and computation |
|---|---|---|
| API availability | ≥ 99.5 % per month | non-5xx share, **including** Vercel `function_timeout`/504 counts from the Vercel usage API (Sentry sees only completed requests), excluding announced maintenance |
| 5xx rate per route class | < 0.5 % (alert at 1 % over 15 min) | `api.duration_ms{route,status}` from the wrapper |
| Socket availability | ≥ 99.5 % per month | UptimeRobot on `/ready` |
| Vercel invocations per active member per day | ≤ 65 | weekly: Vercel usage API `functionInvocations` ÷ (7 × DAU), where DAU comes from the **server** event `session_started` emitted by `getViewer()` in `after()` (100 %, carrying only a hashed ref), so non-consenting users are counted |
| CDN (edge) requests per active member per day | ≤ 120 | Vercel usage `edgeRequests`, same denominator |
| Middleware time | ≤ 30 ms p95 | middleware stamps `x-mw-start: <epoch ms>`; the wrapper records `api.mw_lag_ms = handlerStart − mwStart` (includes queueing). Per-request middleware timing is not retained on Hobby (logs are kept 1 hour) |
| Neon CU-hours | ≤ 70 % of the allowance at the pro-rata point; **alert at 50 %** (weekly, from P1) | Neon consumption API for **both** projects (`ops-weekly.yml`) |
| CLS ≤ 0.02 at 80–150 % zoom on board pages | lab gate | Playwright device × zoom matrix; field data cannot segment by zoom |
| Webhook processing | < 1 s | `webhook.handle_ms` (receipt → response) from the wrapper; `webhook.lag_ms` (provider → receipt) separately |
| Neon storage per member-year | ≤ 4.5 MB typical | `pg_database_size` daily in `HOUSEKEEPING` (02-data-model §10) |
| LLM cost per member | typical ≈ $0.25–0.45 a month; **ceiling $1.50 a month (member), $0.40 per trial** | `coach_spend_days` and `CT/limits.ts` (architecture CR-33); global breaker `max($5, $0.08 × entitled)` a day |
| Review analysis cost | $0 (OCI Always Free) | — |
---

## 3. Database

### 3.1 Connections, pooling and runtimes

| Caller | Driver | Endpoint and URL | Pool | Role and timeouts |
|---|---|---|---|---|
| Vercel functions (`iad1`, Node, Fluid) **today** | Prisma 6.17 with the Rust engine (`lib/prisma.ts:9-15`) | `DATABASE_URL` = Neon **pooler** host + `?sslmode=require&channel_binding=require&connection_limit=5&pool_timeout=15&connect_timeout=15` (none of the last three are set today, DB §5.1) | 5 per instance. Fluid serves several requests on one instance, so 5 lets a `Promise.all` of 5 reads run in parallel | `replay_app` (DML only): `statement_timeout 15s`, `idle_in_transaction_session_timeout 30s`, `lock_timeout 5s` (DB §5.4) |
| Vercel functions **target** (OPT-41, measured on the dev project first) | Prisma `engineType = "client"` + `@prisma/adapter-pg` over `pg.Pool` (Rust-free; 6.16+, check the release notes) | same pooler URL | `new Pool({ max: 5, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 15_000 })`, then `attachDatabasePool(pool)` from `@vercel/functions`, so idle clients are released before Fluid suspends the instance | same |
| Analysis worker (OCI) | `@neondatabase/serverless` **HTTP** (`neon()` for single statements, `sql.transaction([...])` for batches) | `WORKER_DATABASE_URL` (pooler host) | none; HTTPS keep-alive | `replay_worker`: `statement_timeout 60s` |
| Socket server (OCI) | Prisma through `DB/src/live/*` (P2 §6.7) | pooler host | `connection_limit=3`; `pool.on('error')`; `idleTimeoutMillis: 60_000` | `replay_realtime`: `statement_timeout 8s`; Neon-suspend errors are transient (§3.7.1) |
| Prisma CLI (`migrate deploy`), `pg_dump` | Prisma / `pg_dump` | `DIRECT_URL` (non-pooled), owner role; only in CI and on the laptop. `pg_dump` runs on the worker with a read-only `replay_backup` role | — | — |

Rules:

1. **Node runtime only for anything that touches the DB.** Edge is for `middleware.ts`, which reads Clerk session claims and makes no DB call (§3.6.1). No route exports `runtime = "edge"`. The reason is in D1: an edge function runs near the user, but Neon is in us-east-1.
2. **One Prisma client per instance.** The module-scope singleton in `lib/prisma.ts` is correct on Vercel. The `globalForPrisma` cache matters only in dev (HMR). Wrap it once with the timing extension (§9.1) and the global `omit` (§3.2).
3. **No `pgbouncer=true`.** Neon's PgBouncer supports protocol-level prepared statements (`max_prepared_statements = 1000`, DB §5.2). Add the flag only if "prepared statement already exists" errors appear.
4. **Transactions.** Use `$transaction([...])` (batch) where the statements do not depend on each other. Use interactive transactions only when a read decides the write, with `{ maxWait: 2000, timeout: 5000 }`. **Never call the global `prisma` inside a transaction** (DB-11: `matchmaking.service.ts:219-226`, `tournament.service.ts:115,144,188`).
5. **Neon wake-up.** The first query after a scale-to-zero takes ~0.3–1 s. `connect_timeout=15` covers it. The route wrapper retries **idempotent GETs once** on P1001/P1017 after 300 ms; writes are never retried by the wrapper.
6. **Fluid compute must be on** for `replay-chess-dev` and the future prod project. It is the default for projects created after 2025-04-23, but check Project → Settings → Functions. Pin the region in `vercel.json`: `"regions": ["iad1"]`. `vercel.json` sits at the repo root today; it must be in the Vercel project's Root Directory to take effect, so check which one the project uses.

### 3.2 Query shaping

| Rule | Implementation | Fixes |
|---|---|---|
| Explicit `select` in every query on `User`, `Game`, `ChessPosition`, `Opening`, `ExternalAccount`. Never `include: { creator: true }` or similar | Shared selects in `lib/db/selects.ts`: `VIEWER_SELECT` (≈15 columns: `id, referenceId, name, profilePictureUrl, role, isActive, onboardingStep, timezone, preferences, statsVersion, plan, planInterval, subscriptionStatus, subscriptionCurrentPeriodEnd, cancelAtPeriodEnd, trialEndsAt, trialStartedAt`), `PLAYER_CARD_SELECT` (`referenceId, name, profilePictureUrl`), `GAME_HEADER_SELECT`. ESLint `no-restricted-syntax` on `Property[key.name=/^(creator\|opponent\|user\|stats\|chessComProfile)$/][value.value=true]` inside `include` | API F-18: `move/route.ts:38-44`, `profile/route.ts:25-31`, and others |
| Global `omit` (Prisma 6.2+ GA) for blobs and secrets | `new PrismaClient({ omit: { opening: { explanation: true }, chessPosition: { explanation: true, gameMetadata: true, sourceMetadata: true, whitePlayerMetadata: true, blackPlayerMetadata: true }, game: { gameData: true }, externalAccount: { accessTokenEnc: true } } })`. Readers that need one opt in with `omit: { explanation: false }` | DB-14, `sitemap-openings.xml/route.ts:11` |
| `findUnique` on unique keys | `checkout/route.ts:83` uses `findFirst` on `googleId` | |
| No `count()` on paginated lists | `hasMore` comes from fetching `limit + 1`. Exact totals only from counters (`ExternalAccount.gamesImported`) or from small tables. Admin uses `?count=only` | `admin/page.tsx:138` |
| No `OR` across `creatorId` / `opponentId` | New reads go through `game_players` (DB §11.2) | `profile/[referenceId]/route.ts:42-61` |
| Random pick in one statement | `SELECT … FROM chess_positions WHERE "isActive" [AND legend filter] ORDER BY random() LIMIT 1` (tables under 10k rows), replacing `count` + `OFFSET` | `chess-position.service.ts:7-46`, `position-selector.ts:36-59,74-106` |
| Hot raw queries are typed | Prisma TypedSQL (`prisma/sql/*.sql`, preview `typedSql`) for the ~8 hot raw queries in §3.6: archive keyset, bank page, due count, weakness counts, standings rank, job claim (worker side: shared SQL in `packages/db-sql`) | API F-24 (unescaped `ILIKE`) |
| One SQL statement for the review payload | Try the `relationJoins` preview with `relationLoadStrategy: "join"` on `games → game_players, game_analyses, mistakes`. If `EXPLAIN` shows no regression, keep it; otherwise run 3 parallel PK reads (§3.6.6) | `analysis/[gameId]/route.ts:145,224,276` (4 round trips) |
| No BigInt or Date objects across the wire | DTO mappers in `lib/api/dto/*.ts`; the route wrapper's serialiser converts BigInt to string and Date to ISO string, and refuses unknown classes in dev | 6 hand-written BigInt mappers (API F-32) |
| JSON columns are parsed with zod on read | The schemas live in `packages/contracts` (Q §10.2). Parsing costs microseconds | `gameData` is cast ad hoc today |
| RSC props carry DTOs only | Server components pass the minimal DTO to client islands, never Prisma rows. The RSC flight payload is budgeted in §5.6 | `/openings` 8.1 MB HTML (CL §13) |

### 3.3 N+1 and sequential awaits

Rules for new code:

- **A list endpoint is one statement**, with joins for display fields: opponent name and rating come from a self-join on `game_players` plus a `LEFT JOIN users`, and thumbnails use `mistakes.fen` from the same row. There are no per-row lookups.
- **Enrichment across rows** uses one `WHERE x = ANY($ids)` query, never a loop of `findUnique`.
- **After the viewer resolves, independent reads go in one `Promise.all`.** The route wrapper's Server-Timing shows `db;desc="q=N, rt=M"` (statements versus sequential round trips), and CI fails a hot route whose `rt` exceeds its class limit (§2.1) in the Playwright smoke run.

Fixes in the existing routes (from API F-17, and kept only while the route survives):

| Route | Change | RTT before → after |
|---|---|---|
| `create-ai-game` (→ `POST /api/games {mode:"bot"}`) | Bot user id cached in module scope (or bot = `GamePlayer.userId NULL`); the viewer query selects the rating; the position pick runs in parallel; `incrementPositionPlayCount` goes into the same `$transaction([create, increment])` | 6–10 → 3 |
| `create-game` | Same shared `startGame()` service | 4–8 → 3 |
| `tournament/[ref]` GET | `Promise.all([getTournament, getViewer])`, then `Promise.all([participant+rank, liveGames])`; rank from the window index | 5–8 → 2 |
| `analysis/[gameId]` (→ `GET /api/review/:ref`) | §3.6.6 | 4 → 1 (304) or 2 |
| `profile/[ref]` | Header and games in parallel through `game_players` | 2 sequential → 1 parallel batch |
| `game-over` (→ internal `finish`) | Winner derived from colour + outcome; one transaction (§3.7.1) | 3 + ≤ 9 → 1 transaction (≤ 6 statements) |
| `onboarding-skip` (→ `PATCH /api/me/onboarding`) | `update({ where: { googleId } })` | 2 → 1 |
| `matchmaking.service.ts:29,454` | Pass the gate's user in (until the route is deleted) | −1 |

### 3.4 Cursor pagination

Every list endpoint uses **keyset pagination**. Nothing uses `OFFSET`.

- **Wire format.** `?cursor=<opaque>&limit=<1..50, default 20>`. The response is `{ data: T[], meta: { nextCursor: string | null } }`.
- **Cursor encoding.** `"v1." + base64url(JSON.stringify([sortKey, tieBreakId, filterHash]))`. `filterHash` is an 8-hex-character hash of the normalised filter set. If the filters change, an old cursor gets a 400 `validation_failed` (`cursor_filter_mismatch`) instead of returning wrong rows. Decoding is a zod schema (`Cursor`) in `lib/api/schemas.ts`.
- **SQL shape** (the tie-break makes the order total, so no row is skipped or repeated):

```sql
WHERE "userId" = $1
  AND ($2::timestamptz IS NULL OR ("playedAt", "gameId") < ($2, $3::bigint))
ORDER BY "playedAt" DESC, "gameId" DESC
LIMIT $4 + 1
```

- **Index alignment.** Each list has an index whose leading columns equal the equality filter and then the sort keys (§3.5). Optional filters that are not in the index (result, time class, source, ECO) are applied as index-range filters. That is cheap because one member's range is at most a few thousand rows.

| List | Sort key | Index |
|---|---|---|
| `GET /api/games` (archive, profile games) | `(playedAt DESC, gameId DESC)` | `game_players_user_played_idx` |
| `GET /api/train/bank?view=all` | `(createdAt DESC, id DESC)` | `mistakes_user_created_idx` |
| `GET /api/train/bank?view=due` | `(due ASC, id ASC)` | `training_cards_userId_deck_due_idx` |
| `GET /api/coach/threads/:id/messages` | `(id DESC)` | `coach_messages_thread_id_idx` |
| `GET /api/coach/threads` | `(lastMessageAt DESC, id DESC)` | `coach_threads_user_last_idx` |
| `GET /api/tournaments?status=` | `(createdAt DESC, id DESC)` | `tournaments_status_created_idx` |
| `GET /api/tournaments/:slug/standings` | `(points DESC, wins DESC, gamesPlayed ASC, id ASC)` | `tournament_participants_rank_idx` |
| `GET /api/players/:u/milestones` | `(at DESC, id DESC)` | owned by the profile plan |
| Admin lists (`/api/admin/{positions,legends,tournaments}`) | `(createdAt DESC, id DESC)` | primary key or `createdAt` index; `limit ≤ 100` |

### 3.5 Index plan (exact)

All index DDL goes into **migration SQL files applied with `prisma migrate deploy`** after a rehearsal on a throwaway Neon branch (DB §4.3). Partial and `INCLUDE` indexes cannot be written in Prisma's schema language, and `prisma db push` would try to drop them. That is why this plan needs owner decision **OD-6**. Below 1M rows, a plain `CREATE INDEX` takes milliseconds; once `games` passes ~1M rows, each `CONCURRENTLY` statement goes in its own one-statement migration file. Every drop needs the owner's confirmation (CLAUDE.md rule 5).

**3.5.1 Drop (contract migration C1, after M1 is live).** These are exact duplicates of unique indexes, or indexes nothing reads (DB §13.1):

```sql
DROP INDEX IF EXISTS "users_googleId_idx";        DROP INDEX IF EXISTS "users_email_idx";
DROP INDEX IF EXISTS "users_code_idx";            DROP INDEX IF EXISTS "users_referenceId_idx";
DROP INDEX IF EXISTS "users_dodoCustomerId_idx";  DROP INDEX IF EXISTS "users_subscriptionStatus_idx";
DROP INDEX IF EXISTS "games_referenceId_idx";     DROP INDEX IF EXISTS "games_status_idx";
DROP INDEX IF EXISTS "games_expiresAt_idx";
DROP INDEX IF EXISTS "user_stats_userId_idx";     DROP INDEX IF EXISTS "user_stats_referenceId_idx";
DROP INDEX IF EXISTS "chess_com_profiles_userId_idx";
DROP INDEX IF EXISTS "chess_com_profiles_chessComHandle_idx";
DROP INDEX IF EXISTS "chess_com_profiles_referenceId_idx";
DROP INDEX IF EXISTS "chess_positions_referenceId_idx";
DROP INDEX IF EXISTS "chess_positions_featured_idx";
DROP INDEX IF EXISTS "chess_positions_isActive_idx";
DROP INDEX IF EXISTS "chess_positions_sourceType_idx";
DROP INDEX IF EXISTS "legends_name_idx";          DROP INDEX IF EXISTS "openings_name_idx";  -- 344 KB, 0 scans
DROP INDEX IF EXISTS "tournaments_referenceId_idx";
DROP INDEX IF EXISTS "tournament_participants_tournamentId_points_idx";  -- replaced by rank_idx
```

The same release removes the matching `@@index` lines (schema:58-63, 99-101, 123-124, 166-168, 222-225, 271, 297, 406, 431). Note that the planner uses `users_googleId_idx` today (41 scans against 0 on `users_googleId_key`, DB §0). After the drop it switches to the unique index with no change in plan cost.

**3.5.2 Add on existing tables (expand migration M1).** From DB §13.2, plus two additions:

```sql
-- correctness
CREATE UNIQUE INDEX matchmaking_queue_one_searching_per_user ON matchmaking_queue ("userId") WHERE status = 'SEARCHING';
ALTER TABLE games ADD CONSTRAINT "games_chessPositionId_fkey" FOREIGN KEY ("chessPositionId")
  REFERENCES chess_positions(id) ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE games VALIDATE CONSTRAINT "games_chessPositionId_fkey";
CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));   -- NEW: case-insensitive linking (API F-23); first check for duplicates
-- legacy profile history, until game_players replaces the OR query
CREATE INDEX games_creator_completed_idx  ON games ("creatorId",  "completedAt" DESC) WHERE status = 'COMPLETED';
CREATE INDEX games_opponent_completed_idx ON games ("opponentId", "completedAt" DESC) WHERE status = 'COMPLETED';
-- live and sweeper
CREATE INDEX games_tournament_live_idx ON games ("tournamentId") WHERE status = 'IN_PROGRESS';
CREATE INDEX games_open_expires_idx    ON games ("expiresAt") WHERE status IN ('WAITING_FOR_OPPONENT', 'IN_PROGRESS');
-- tournaments
CREATE INDEX tournament_participants_rank_idx ON tournament_participants ("tournamentId", points DESC, wins DESC, "gamesPlayed" ASC, id ASC);
CREATE INDEX tournaments_status_created_idx ON tournaments (status, "createdAt" DESC, id DESC);
-- catalogue
CREATE INDEX chess_positions_featured_recent_idx ON chess_positions ("createdAt" DESC) WHERE featured AND "isActive";
CREATE INDEX chess_positions_white_active_idx ON chess_positions ("whitePlayerId") WHERE "isActive";
CREATE INDEX chess_positions_black_active_idx ON chess_positions ("blackPlayerId") WHERE "isActive";
CREATE INDEX openings_active_eco_name_idx ON openings (eco, name) WHERE "isActive";
-- billing cron (after adding users."trialReminderSentAt")
CREATE INDEX users_trial_reminder_idx ON users ("trialEndsAt") WHERE "trialReminderSentAt" IS NULL AND "trialEndsAt" IS NOT NULL;
-- Phase 3: BOOK detection from the worker's in-memory book set; also used by opening pages
CREATE INDEX openings_epd_idx ON openings (epd);
```

`tournament_participants_searching_idx` (DB §13.2) is **not** added: arena pairing moves to the socket server (D8), so nothing will query `isSearching`.

**3.5.3 New coaching tables (expand migrations M2–M7).** Table shapes are in DB §11. Only the indexes matter here, with the read each one serves:

```sql
-- M2 games, game_players, game_analyses, jobs
CREATE UNIQUE INDEX games_source_external_key ON games (source, "externalId");            -- import dedupe; NULL externalId never collides
CREATE INDEX game_players_user_played_idx ON game_players ("userId", "playedAt" DESC, "gameId" DESC)
  INCLUDE (result, "timeClass", source, "ecoCode", accuracy);                             -- archive, Home recent, profile; index-only for filters
CREATE INDEX game_players_user_analysed_idx ON game_players ("userId", "playedAt" DESC)
  WHERE accuracy IS NOT NULL;                                                             -- "Insufficient (14/20)", weakness inputs, week trend
-- PK game_players ("gameId", color); UNIQUE ("gameId", "userId"); PK game_analyses ("gameId")
CREATE UNIQUE INDEX jobs_dedupe_key ON jobs ("dedupeKey");
CREATE INDEX jobs_ready_idx   ON jobs (priority DESC, "fairSeq", "runAt") WHERE status = 'QUEUED';   -- claim (higher runs first: JOB_PRIORITY.USER_OPENED 100 … BACKLOG 10, HOUSEKEEPING 0)
CREATE INDEX jobs_running_idx ON jobs ("lockedAt") WHERE status = 'RUNNING';                   -- stale-lock recovery
CREATE INDEX jobs_user_active_idx ON jobs ("userId", kind) WHERE status IN ('QUEUED','RUNNING'); -- import status, "analysing" chips (adds jobs."userId")
CREATE INDEX jobs_finished_idx ON jobs ("finishedAt") WHERE status IN ('DONE','FAILED');      -- pruning
-- M3 accounts
CREATE UNIQUE INDEX linked_accounts_user_provider_key ON linked_accounts ("userId", provider);
CREATE INDEX linked_accounts_provider_username_idx ON linked_accounts (provider, "usernameLower");
-- M4 training
CREATE UNIQUE INDEX mistakes_game_ply_key ON mistakes ("gameId", ply);
CREATE INDEX mistakes_user_created_idx ON mistakes ("userId", "createdAt" DESC, id DESC);
CREATE UNIQUE INDEX training_cards_mistake_key ON training_cards ("mistakeId");
CREATE UNIQUE INDEX training_cards_user_puzzle_key ON training_cards ("userId", "puzzleId");
CREATE INDEX training_cards_userId_deck_due_idx ON training_cards ("userId", due, id) WHERE NOT suspended;    -- due count, due list, Home thumbnails
CREATE UNIQUE INDEX training_attempts_client_key ON training_attempts ("clientId");                     -- idempotent attempts / offline outbox
CREATE INDEX training_attempts_user_reviewed_idx ON training_attempts ("userId", "reviewedAt" DESC);
CREATE INDEX training_attempts_card_reviewed_idx ON training_attempts ("cardId", "reviewedAt");
-- PK training_days ("userId", day) holds the frozen daily plan (training_days.plan); streaks live on training_profiles (PK "userId")
-- M5 weakness: PK weakness_snapshots ("userId", "weekStart"); "latest" = backward scan of the PK, LIMIT 1
-- M6 coach
CREATE INDEX coach_threads_user_last_idx ON coach_threads ("userId", "lastMessageAt" DESC, id DESC);
CREATE INDEX coach_threads_user_game_idx ON coach_threads ("userId", "gameId");
CREATE INDEX coach_messages_thread_id_idx ON coach_messages ("threadId", id DESC);            -- the last 20 messages
CREATE UNIQUE INDEX coach_messages_client_key ON coach_messages ("userId", "clientId");     -- idempotent send (the first message of a new thread has no thread id yet)
-- PK coach_usage_days ("userId", day)
-- M7 sharing, lessons, ops tables
CREATE INDEX game_shares_game_idx ON game_shares ("gameId");                                  -- PK slug
-- PK lesson_progress ("userId", "lessonKey"); PK rate_limits (key); PK idempotency_keys ("userId", key)
CREATE INDEX webhook_events_received_brin ON webhook_events USING brin ("receivedAt");        -- 30-day pruning of an append-only log
```

TOAST compression for the new JSON columns (DB §7.4). The dev branch default is `pglz`, and `lz4` is faster to read:

```sql
ALTER TABLE game_analyses      ALTER COLUMN lines   SET COMPRESSION lz4;
ALTER TABLE game_analyses      ALTER COLUMN counts  SET COMPRESSION lz4;
ALTER TABLE weakness_snapshots ALTER COLUMN metrics SET COMPRESSION lz4;
ALTER TABLE linked_accounts  ALTER COLUMN ratings SET COMPRESSION lz4;
ALTER TABLE users              ALTER COLUMN preferences SET COMPRESSION lz4;
```

**3.5.4 Verifying the plans.** Add `apps/web/scripts/explain-hot-queries.ts`. It refuses to run unless `DATABASE_URL` points at a throwaway branch. It seeds 20 members with 2,000 games, 500 mistakes and 3,000 review logs each (≈50 MB; per-member plans depend on per-member row counts, not on the total), then runs `EXPLAIN (ANALYZE, BUFFERS)` on every query in §3.6 and asserts:

| Query | Expected plan | Limits |
|---|---|---|
| Archive first page / next page | Index Only Scan on `game_players_user_played_idx` + nested loop to the `games` PK | < 2 ms, shared hits < 200 |
| Due count + 4 thumbnails | Index Scan on `training_cards_userId_deck_due_idx` | < 1 ms |
| Bank page (all) | Index Scan on `mistakes_user_created_idx` + PK join | < 3 ms |
| Review payload (version probe) | `games_referenceId_key` + `game_players` PK + `game_analyses` PK | < 0.5 ms |
| Weakness latest | Index Scan Backward on the `weakness_snapshots` PK | < 0.3 ms |
| Job claim | Index Scan on `jobs_ready_idx` + LockRows | < 1 ms |
| Standings top 50 | Index Scan on `tournament_participants_rank_idx` | < 1 ms |
| No hot query | contains `Seq Scan` on `games`, `game_players`, `mistakes`, `training_cards`, `training_attempts` or `coach_messages` | — |

Run it in CI weekly (manual dispatch) and on every migration PR.

### 3.6 Read patterns for the hot paths

Statement counts include the viewer lookup. "RT" means sequential round trips (each ≈1–2 ms in `iad1`).

#### 3.6.1 Viewer, gating and the app shell

- **Middleware (edge): 0 DB queries.** Clerk session-token claims carry `{ ref, ent, role, onb }`. They are set from `publicMetadata` by the Clerk and Dodo webhooks (plan §1.2; API F-07 step 4) and read through a Clerk session-token template. Middleware redirects non-members away from `(app)` routes and signed-out visitors away from everything outside the public allowlist. Claims can lag by up to one token refresh (~60 s), so they are used for **gating only**. Billing screens read the DB.
- **`getViewer()` (server): 1 statement, memoised per request with React `cache()`.** It runs `prisma.user.findUnique({ where: { googleId }, select: VIEWER_SELECT })`. When the Clerk webhook has not arrived yet (a first sign-in race), it falls back to `create` with the claims, and only then. `auth()` verifies the JWT locally; `currentUser()` is banned outside class X (§2.1).
- The `(app)/layout.tsx` server component renders `<ViewerProvider viewer socketToken>`. The socket token is signed in the same render (`lib/socket-token.ts:48-63`), so `GET /api/socket-token` is called only to refresh it on reconnect.
- **This deletes**: `POST /api/user/sync`, `GET /api/user/email/[email]`, the boot `GET /api/subscription`, `useRequireAuth`, `useRequireSubscription`, and the persisted `chess-user-store` (CL §11.2). Per hard load that is 3–5 invocations, 1 Clerk call, 1–2 Dodo calls and 2 writes, replaced by 1 statement inside the page render.
- `GET /api/me` (R1) exists for client refreshes after mutations and returns the same DTO with an ETag on `users.updatedAt`. `?refresh=billing` (class X) is the **only** path that calls Dodo, and it writes only when the snapshot differs (DB-07; compare fields before the update).

#### 3.6.2 Home (`/home`, `V3Home`: populated, new_user, loading, import_running, payment_failed, trial)

The server loader `getHomeData(viewerId)` makes 1 + 5 statements in 2 RT; the DB time is ≈5–8 ms:

| Block | Statement (all parallel after the viewer) | Index |
|---|---|---|
| Continue (the last analysed game with key moments) | `SELECT g."referenceId", a."keyPlies"[1], a."keyFens"[1], … FROM game_players gp JOIN game_analyses a ON a."gameId"=gp."gameId" JOIN games g ON g.id=gp."gameId" WHERE gp."userId"=$1 AND gp.accuracy IS NOT NULL ORDER BY gp."playedAt" DESC LIMIT 1` | `game_players_user_analysed_idx` |
| Mistake Bank (due + 4 thumbnails) | `SELECT m."referenceId", m.fen, m.themes[1], count(*) OVER () AS due FROM training_cards c JOIN mistakes m ON m.id=c."mistakeId" WHERE c."userId"=$1 AND NOT c.suspended AND c.due <= now() ORDER BY c.due, c.id LIMIT 4` | `training_cards_userId_deck_due_idx` |
| This week | `game_players` range `playedAt >= weekStart(tz)` (≤ 50 rows) ‖ `training_days` PK range of 7 rows (two statements in one `$transaction([...])` batch) | user_played, PK |
| Recent games (8) | the archive keyset query (§3.6.3) with `LIMIT 8` | user_played |
| Import status | `linked_accounts WHERE "userId"=$1` (≤ 2 rows: `importStatus, gamesImported, gamesTotal`) | unique (userId, provider) |

- **Store `keyFens text[]` in `game_analyses`** (the FEN before each key ply, about 60 B each). Home and the review summary can then render the board thumbnail without replaying moves with `chess.js` on the server.
- Streaming: the header and the trial/payment banners render from the viewer at once. `Continue` and `Recent games` are wrapped in `<Suspense>` with the `V3HomeLoading` skeleton blocks (inv-sys §3.18).
- Live updates arrive over the socket and patch the client cache: `analysis:progress`/`analysis:done` → Continue, `import:progress` → the status row, `bank:due_changed` → the due count. When the socket is down, `GET /api/import/status` is polled every 5 s **only while** `import_running` (inv-sys §3.18).

#### 3.6.3 Games archive and profile games (`V3GamesArchive`, `V4ProfileGames`)

1 + 1 statements (the keyset query from §3.4, joined to the opponent):

```sql
SELECT g."referenceId", gp.color, gp.result, gp."timeClass", gp.source, gp."ecoCode", gp.accuracy, gp."playedAt",
       g."plyCount", g."endReason", g."analysisStatus",
       COALESCE(u.name, CASE gp.color WHEN 'w' THEN g."blackName" ELSE g."whiteName" END) AS "oppName",
       COALESCE(opp.rating, CASE gp.color WHEN 'w' THEN g."blackRating" ELSE g."whiteRating" END) AS "oppRating",
       gp.rating AS "myRating"
FROM game_players gp
JOIN games g            ON g.id = gp."gameId"
LEFT JOIN game_players opp ON opp."gameId" = gp."gameId" AND opp.color <> gp.color
LEFT JOIN users u       ON u.id = opp."userId"
WHERE gp."userId" = $1
  AND ($2::timestamptz IS NULL OR (gp."playedAt", gp."gameId") < ($2, $3::bigint))
  AND ($4::text IS NULL OR gp.result::text = $4)
  AND ($5::text IS NULL OR gp."timeClass"::text = $5)
  AND ($6::text IS NULL OR gp.source::text = $6)
  AND ($7::text IS NULL OR gp."ecoCode" LIKE $7 || '%')
ORDER BY gp."playedAt" DESC, gp."gameId" DESC
LIMIT $8 + 1;
```

- The first page is prefetched in the RSC page and handed to TanStack Query through `HydrationBoundary`. Filter changes use `placeholderData: keepPreviousData`, so the list never blanks.
- The "Missed Rxf5 · move 19" chip comes from `game_analyses.counts`/`summary.headline`. It is selected only when the row's `analysisStatus = DONE`, with a `LEFT JOIN game_analyses` that reads `summary->>'headline'` (no full JSON).
- A private profile (`V4ProfilePrivate`) returns the header only and does not run this query.

#### 3.6.4 Mistake Bank (`V3MistakeBank`: default, filtered, loading; `V3BankEmpty`, `V3BankCaughtUp`)

`GET /api/train/bank?view=due|all&theme=&phase=&source=&cursor=&limit=50` makes 1 + 1 statements:

- `view=due`: `training_cards c JOIN mistakes m … WHERE c."userId"=$1 AND NOT c.suspended AND c.due <= now() [AND $theme = ANY(m.themes)] [AND m.phase=$phase] ORDER BY c.due, c.id LIMIT 51`, on `training_cards_userId_deck_due_idx`.
- `view=all`: `mistakes m LEFT JOIN training_cards c ON c."mistakeId"=m.id WHERE m."userId"=$1 … ORDER BY m."createdAt" DESC, m.id DESC LIMIT 51`, on `mistakes_user_created_idx`.
- The filter-chip counts (themes and phases with counts) are a **separate, cached** read: `SELECT t, count(*) FROM mistakes, unnest(themes) t WHERE "userId"=$1 GROUP BY t` (≤ a few thousand rows, ≈2–5 ms). It is cached per user with a versioned key (`users.bankVersion`, bumped by the worker when mistakes are added; §4.3.3), so it costs nothing on most views.
- No GIN index on `themes`: one member's rows are already narrowed by the B-tree prefix (DB §11.6).

#### 3.6.5 Train hub (`V3TrainHub`: default, nothingdue, loading)

`GET /api/train/today` is also the server loader. It makes 1 + 1 batch (4 statements):

1. `INSERT INTO training_days.plan ("userId","localDate",items) SELECT … ON CONFLICT DO NOTHING RETURNING *`, falling back to a `SELECT` by PK. The plan is built **once per local day** (inv-sys §3.19) from the due cards, the latest weakness snapshot's top theme and the next lesson.
2. `training_profiles` (streaks) PK.
3. The due count on `training_cards_userId_deck_due_idx`.
4. `training_days` for the last 7 local days (PK range).

`localDate` is computed from `users."timeZone"` (DB §3.2). No `count(*)` over logs; mastery percentages come from the weakness snapshot.

#### 3.6.6 Review (`V3ReviewAnalysing`/`Summary`: analysing, failed, clean, summary, moment; `V3KeyMoments`, `V3RvComplete`)

`GET /api/review/:ref` (R2), and the same service is used by the RSC page:

1. **Version probe (1 statement, after the viewer).** It also does the participant check. A non-participant gets a 404, which hides whether the game exists (keep that from `analysis/[gameId]/route.ts:167-174`).

```sql
SELECT g.id, g."analysisStatus", g."plyCount", a.version, a."gradingVersion", gp.color
FROM games g
JOIN game_players gp ON gp."gameId" = g.id AND gp."userId" = $viewer
LEFT JOIN game_analyses a ON a."gameId" = g.id
WHERE g."referenceId" = $ref;
```

2. If `If-None-Match` equals `"r:{analysisVersion}.{gradingVersion}.{status}"`, return **304** with no body.
3. Otherwise run **3 PK reads in parallel**: the `games` header (`moves`, `san`, `moveClocksMs`, players, time control, opening, `startFen`, result); the `game_analyses` row (packed arrays, §5.2); `mistakes WHERE "gameId"=$1 AND "userId"=$viewer`. With `relationJoins`, this becomes one statement.
4. **While analysing** the payload is `{ status:'analysing', gradedPlies, totalPlies }` plus the header (progress arrives as `analysis:progress` on the players' `user:{ref}` rooms; there is no `review:<ref>` room). Progress then arrives over the socket (§5.4). There is no fixed-interval poll. A fallback refetch on window focus, and `GET /api/review/:ref` re-kicks the worker when the job has been QUEUED for more than 30 s (inv-rct-a §2.2).
5. Legend comparison (`GET /api/review/:ref/legend`) is lazy: it is fetched only when the Legend tab opens. It is a public-tier read of `chess_positions` (pgn, legend card) and is cached by tag `position:{ref}`.
6. **PGN download** is built in the browser from the payload (moves, clocks, evals as `[%eval]`, NAGs from judgements). `GET /api/review/:ref/pgn` stays only as a fallback for "copy link" flows.

#### 3.6.7 Weakness (`V3WeaknessProfile`, `V3WeaknessInsufficient`/`Computing`/`Drill`)

`GET /api/train/weakness`: 1 + 1 statements, with an ETag of `"w:{weekStart}.{computedAt}.{algoVersion}"`:

- `SELECT … FROM weakness_snapshots WHERE "userId"=$1 ORDER BY "weekStart" DESC LIMIT 1` (backward PK scan).
- `insufficient` state: `SELECT count(*) FROM game_players WHERE "userId"=$1 AND accuracy IS NOT NULL` on the partial index, run only when no snapshot exists or `gamesCount < 20`.
- `computing` state: `jobs_user_active_idx` (`kind = RECOMPUTE_WEAKNESS`), then a `weakness.ready` push.
- The rating-band baselines are a static JSON file in the repo, imported at build time and never queried (plan Phase 6).

#### 3.6.8 Coach context and stream start

- `GET /api/coach/context?gameRef&ply&explain` (R2): thread `(userId, gameId)` ‖ last 20 messages `(threadId, id DESC)` ‖ the review summary slice for the ply (a `game_analyses` PK read with `lines->'<ply>'` and `keyPlies`) ‖ quota (`coach_usage_days` PK). That is 1 + 1 batch of 4 statements.
- `POST /api/coach/messages` (S), before the first byte: the quota upsert (§8.3) ‖ the context load (the same 3 reads). On Fluid, the stable prompt prefix is serialised once per instance and kept in module scope (§4.5). The user message is inserted **in parallel** with the Anthropic call starting; it does not block it.

#### 3.6.9 Profile (`V4Profile`, `V4ProfileStats`, `V4ProfileOther*`)

- Header: `users` by username/referenceId (`PLAYER_CARD_SELECT` + privacy flag) ‖ `linked_accounts.ratings` (≤ 2 rows).
- Stats tab (on the fly, §3.8):

```sql
SELECT "timeClass",
       count(*) FILTER (WHERE result = 'WIN')  AS w,
       count(*) FILTER (WHERE result = 'LOSS') AS l,
       count(*) FILTER (WHERE result = 'DRAW') AS d,
       avg(accuracy) AS acc
FROM game_players
WHERE "userId" = $1 AND "playedAt" > now() - interval '90 days'
GROUP BY 1;
```

  It touches ≤ 2,000 index-only rows (≈2–4 ms) and is cached by a versioned key (`users.statsVersion`, §4.3.3).

#### 3.6.10 Tournaments (`V4Tournaments`, `V4TournamentLobby`/`Live`/`Results`)

- List: `tournaments_status_created_idx`, public tier with `s-maxage=15` (participant counts change).
- Snapshot `GET /api/tournaments/:slug` (R2): header PK ‖ top 50 standings on `tournament_participants_rank_idx` ‖ the viewer's rank as `count(*)` of rows strictly ahead of them (an index range count, using the same deterministic order everywhere; API F-24) ‖ live games on `games_tournament_live_idx` (≤ 50). After that, **`lobby.delta` events patch the cache** and nothing refetches the snapshot (§5.4).
- Lazy auto-complete moves out of the GET into the socket server's tournament timer (API F-22).

#### 3.6.11 Live game page

There are **no** HTTP reads after the page render. The `game:join` ack carries the snapshot (P2 §7.4). The socket server loads the record once, when it creates a session, with one direct read through `DB/src/live/load.ts` (B4).

### 3.7 Write paths

#### 3.7.1 Live game persistence (socket → Neon directly, D2 and D4)

P2 §6.6 is authoritative for the exact statements; `02-data-model.md` §7.1 shows the shapes. Columns: `Game.moves text` (space-separated UCI), `moveClocksMs int[]`, `plyCount`, `fen`, `whiteTimeMs`, `blackTimeMs`, `clockRunning`, `phase`, `phaseEndsAt`, `lastMoveAt`, and `pgn` once at the end.

- **Checkpoint** (`DB/src/live/checkpoint.ts`): ≤ 10 per 80-ply game (every 10 plies or 15 s, on a phase change, and on drain), **1 statement** ≈ 220 ms from Mumbai: `UPDATE games SET moves, "moveClocksMs", "plyCount", fen, clocks, phase, "lastMoveAt" … WHERE id = $1 AND status = 'IN_PROGRESS' AND "plyCount" <= $n`. Duplicates and reordered checkpoints are no-ops. `lastMoveAt` is not indexed (only the partial `games_open_idx` on `status` exists), so every checkpoint is a HOT update on a `fillfactor 90` page.
- **Finish** (`DB/src/live/finish.ts`, `finishGame()`): **one data-modifying CTE**, idempotent on `status = 'IN_PROGRESS'`: the `games` update (outcome, `endMethod`, moves, clocks, `fen`, `pgn`, `completedAt`, `analysisStatus`), the `game_players` results and `endedAt`, `users."gamesVersion"` + 1 and stats, and the `ANALYZE_GAME` enqueue at `JOB_PRIORITY.GAME_ENDED` (`ON CONFLICT ("dedupeKey") DO NOTHING`; the job payload carries the moves, so the worker needs no second read). P9 appends the ratings fragment and P12 the tournament-points fragment. Then `game:result` to the room and `POST /internal/analysis/kick` over the VCN.
- **Connections** (P2 §6.7): a pooled Prisma client with `connection_limit=3`, `pool.on('error')`, `idleTimeoutMillis: 60_000`. Neon closes idle connections when it suspends after 5 minutes, so `P1017`, `P1001`, `57P01`, `08006` and `08003` are **transient**: retry once at once on a fresh connection, count as `ws.persist.reconnect` (not `fail`), then the outbox backoff (1/2/4/8 s up to 60 s, jitter, one in flight per game). A `SELECT 1` prewarm runs when a game leaves `waiting`, so the first checkpoint does not also pay the ~1 s wake.
- **Result:** ≈ 11 statements and 0 Vercel invocations per 80-ply game, against ≈ 88 invocations and 776 KB today.
- **Exception:** tournament pairing, start and finalize are signed calls to `/api/internal/tournaments/*` (P12 D12-4); the schedule is loaded at boot, pushed on change, and re-synced hourly from the Vercel data cache, never polled every 60 s.
#### 3.7.2 Starting a game (`POST /api/games`, W2)

1 (viewer) + 1 (position pick, only for legend/position/opening modes, `ORDER BY random() LIMIT 1`) + 1 transaction `$transaction([game.create({ data: { …, players: { create: [w, b] } } }), chessPosition.update({ timesPlayed: { increment: 1 } })])`. The `Idempotency-Key` header is checked against `idempotency_keys` (§3.7.8). A double click returns the same `{ ref }`, where today it creates two WAITING games (API F-06). Colours are decided **here**, not in the socket server (WS F-04).

#### 3.7.3 Analysis worker writes (Neon HTTP, D3)

```ts
// apps/analysis-worker/src/db.ts
import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.WORKER_DATABASE_URL!);

// 1 RTT: claim, and get the payload in the same statement
const [job] = await sql`
  UPDATE jobs SET status='RUNNING', "lockedBy"=${WORKER_ID}, "lockedAt"=now(), attempts=attempts+1
  WHERE id = (SELECT id FROM jobs WHERE status='QUEUED' AND "runAt" <= now()
              ORDER BY priority, "runAt" LIMIT 1 FOR UPDATE SKIP LOCKED)
  RETURNING id, kind, payload`;

// 1 RTT: the whole result as one batch transaction (the HTTP driver sends it in one request)
await sql.transaction([
  sql`INSERT INTO game_analyses ("gameId", engine, nodes, version, "gradingVersion", evals, "bestUci", judgements,
        accuracy, "keyPlies", "keyFens", "phasePlies", lines, "accuracyWhite", "accuracyBlack", counts, summary)
      VALUES (...) ON CONFLICT ("gameId") DO UPDATE SET ... , version = game_analyses.version + 1`,
  sql`UPDATE game_players gp SET accuracy = x.accuracy, acpl = x.acpl, blunders = x.blunders, mistakes = x.mistakes,
        inaccuracies = x.inaccuracies, "phaseAcc" = x."phaseAcc", "clockBlunders" = x."clockBlunders"
      FROM jsonb_to_recordset(${playersJson}::jsonb) AS x(color char(1), accuracy real, acpl int, blunders int2,
           mistakes int2, inaccuracies int2, "phaseAcc" real[], "clockBlunders" int2[])
      WHERE gp."gameId" = ${gameId} AND gp.color = x.color`,
  sql`INSERT INTO mistakes ("userId","gameId",ply,color,fen,"playedUci","bestUci",pv,judgement,phase,themes,"cpLoss","isPuzzle")
      SELECT * FROM jsonb_to_recordset(${mistakesJson}::jsonb) AS x(...)
      ON CONFLICT ("gameId", ply) DO NOTHING`,
  sql`INSERT INTO training_cards ("userId","mistakeId",due,stability,difficulty,state)
      SELECT m."userId", m.id, now(), 0, 0, 0 FROM mistakes m
      WHERE m."gameId" = ${gameId} AND m."isPuzzle" ON CONFLICT ("mistakeId") DO NOTHING`,
  sql`UPDATE users SET "statsVersion" = "statsVersion" + 1, "bankVersion" = "bankVersion" + 1
      WHERE id IN (SELECT "userId" FROM game_players WHERE "gameId" = ${gameId} AND "userId" IS NOT NULL)`,
  sql`UPDATE games SET "analysisStatus" = 'DONE' WHERE id = ${gameId}`,
  sql`UPDATE jobs SET status = 'DONE', "finishedAt" = now() WHERE id = ${job.id} AND "lockedBy" = ${WORKER_ID}`,
  sql`INSERT INTO jobs (kind, priority, "dedupeKey", "userId", payload, "runAt")
      SELECT 'RECOMPUTE_WEAKNESS', 6, 'weakness:' || "userId" || ':' || to_char(now(), 'YYYYMMDDHH24'), "userId", '{}'::jsonb, now() + interval '2 minutes'
      FROM game_players WHERE "gameId" = ${gameId} AND "userId" IS NOT NULL
      ON CONFLICT ("dedupeKey") DO NOTHING`,
]);
```

- **Two Mumbai → us-east round trips per game** (claim + result). An optional third writes `gradedPlies` at the end of pass 1, for crash resume (inv-rct-a §2.2). Inserting N rows takes one parameter (`jsonb_to_recordset`), not N × columns.
- Progress events go **socket-local** (private VCN, §6.2), never through the DB.
- After the queue drains: stop issuing queries. Neon scales to zero 5 minutes later (§3.9).

#### 3.7.4 Training attempts (`POST /api/train/attempts`, W1)

The body is `{ attempts: [{ clientAttemptId, cardRef, rating, elapsedMs, hintUsed, shownAt }] }` (≤ 50, ≤ 32 KB). The client sends attempts from an outbox: immediately when online, or batched when it reconnects (inv-rct-b W1). Server work: **1 interactive transaction of 4 statements**:

1. `SELECT id, due, stability, difficulty, reps, lapses, state, "lastReview" FROM training_cards WHERE id = ANY($ids) AND "userId" = $u FOR UPDATE`.
2. Compute FSRS in TypeScript (`ts-fsrs`, microseconds per card). Then `UPDATE training_cards c SET … FROM jsonb_to_recordset($next) x WHERE c.id = x.id AND (c."lastReview" IS NULL OR c."lastReview" < x."shownAt")`. The `shownAt` guard stops double submits (DB §11.6).
3. `INSERT INTO training_attempts (...) SELECT … FROM jsonb_to_recordset($logs) … ON CONFLICT ("clientId") DO NOTHING RETURNING "clientId"`. Rows that did not come back are reported as `duplicate`.
4. `INSERT INTO training_days … ON CONFLICT ("userId", day) DO UPDATE SET reviews = training_days.reviews + EXCLUDED.reviews, correct = …, seconds = …`, plus `training_profiles` (streaks) and the `training_days.plan` item progress in the same statement through a CTE.

Server time ≈ 6–10 ms. The UI never waits for it: it advances at once and rolls back only the session counter on failure (CL §11.9).

#### 3.7.5 Coach messages

1. **Before the stream:** the quota **read** (today's `coach_usage_days` row and the period sum, against `CT/limits.ts`) ‖ the context load; then **one statement that completes before `messages.stream()`**: insert the user message `ON CONFLICT ("userId", "clientId") DO NOTHING` together with the assistant placeholder under the one-in-flight partial unique index (409 `in_flight`). Revision 1 started the model call "in parallel" with this insert, which lets a double tap or a retry after a dropped response pay twice before the conflict is seen (api-perf AP-46). The extra round trip is ≈ 2 ms in `iad1`, negligible next to a 1–3 s first token.
2. **During the stream:** verified sentences are persisted with one mid-stream `UPDATE` every 3 sentences, which also reads `status` so a `stop` beacon's `ABORTING` ends the loop.
3. **After the stream** (inside the stream's `finally`, before the response closes): one transaction that writes the assistant message (tokens, cache reads, cost, `firstSentenceMs`), records the cost in `coach_spend_days` (always), and counts the question in `coach_usage_days` only for a `done` answer (P7 D5).

#### 3.7.6 Import batches (worker)

P4 §8 is authoritative. A chunk of 100 games is one upsert plus one `game_players` insert, and **the upsert must return a row for games that already exist**, because another member (the opponent) may have imported the same game first:

```sql
WITH src AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(...)),
up AS (
  INSERT INTO games (source, "externalId", "externalUrl", mode, "timeClass", rated, "completedAt", "expiresAt",
                     "whiteName", "blackName", "whiteRating", "blackRating", outcome, "endMethod", "ecoCode",
                     moves, "moveClocksMs", "plyCount", "startingFen", status, ...)
  SELECT ... FROM src
  ON CONFLICT (source, "externalId") DO UPDATE SET "externalUrl" = EXCLUDED."externalUrl"   -- a no-op touch
  RETURNING id, "externalId", (xmax = 0) AS created)
INSERT INTO game_players ("gameId", "userId", color, mode, "timeClass", rated, result, "endedAt",
                          "opponentName", "opponentRating", "ratingBefore", source, "linkedAccountId")
SELECT up.id, $2, src.color, 'IMPORTED', src."timeClass", false, src.result, src."completedAt",
       src."oppName", src."oppRating", src."myRating", src.source, $3
FROM up JOIN src USING ("externalId")
ON CONFLICT ("gameId", "userId") DO NOTHING;
```

Revision 1's `ON CONFLICT … DO NOTHING RETURNING id` returned no row for an existing game, so the second member never got a `game_players` row and the game was missing from their archive, review and bank (api-perf AP-26). Then one batch inserts the analysis jobs (`IMPORT_NEWEST` for the eager head, `BACKLOG` for the rest, `fairSeq` per user), bumps `users."gamesVersion"`, updates the `import_runs`/`linked_accounts` counters every chunk, and pushes `import:progress {…, analysed}`. A 2,000-game first import is ≈ 40 statements.
#### 3.7.7 Webhooks

`INSERT INTO webhook_events (id, type, "receivedAt") VALUES ($webhookId, $type, now()) ON CONFLICT DO NOTHING RETURNING id`. On a conflict, return 200 straight away. Otherwise apply the **conditional** snapshot update: `UPDATE users … WHERE id=$1 AND ("subscriptionSourceAt" IS NULL OR "subscriptionSourceAt" <= $eventTime)` (DB §8.7). The Clerk `publicMetadata` sync and the `entitlement.changed` socket push run in `after()`.

#### 3.7.8 Idempotency keys (W2 routes, checkout, coach send)

`INSERT INTO idempotency_keys ("userId", key, route, "createdAt") VALUES (...) ON CONFLICT DO NOTHING RETURNING key`.

- On a conflict: when `response` is set, replay it (≤ 4 KB JSON). When it is still null, answer 409 `conflict` with `retryAfterSec: 1`.
- When the handler finishes, store the response.
- Housekeeping prunes rows older than 24 h.

### 3.8 Materialised versus computed on the fly

| Datum (screen) | Decision | Where it is written | Read cost |
|---|---|---|---|
| Per-game accuracy, ACPL, counts, phase and clock-bucket figures (Review, archive chips, Home) | **Write-once materialised** in `game_players` and `game_analyses` | Worker, at analysis time | Columns |
| Key-moment FENs, captions, coach text (Review, Home Continue) | Write-once in `game_analyses` | Worker | PK |
| Weekly games, rating trend, 7-day dots (Home "This week") | **On the fly** | — | ≤ 50 rows from the user_played index |
| Profile stats tab (W/L/D by time class, average accuracy) | **On the fly**, cached by version key `users.statsVersion` | The worker bumps the version | ≈2–4 ms on a miss, 0 on a hit |
| Weakness profile (theme rates against the rating band, phase, clock, openings, trend) | **Materialised** `weakness_snapshots` | `RECOMPUTE_WEAKNESS` job, deduped per user per hour | PK |
| Bank due count (Home, Train, nav badge) | **On the fly** (partial index), plus the `bank:due_changed` push | — | < 1 ms |
| Bank theme counts (filter chips, "Loose pieces … 7 in bank") | On the fly, cached by version key `users.bankVersion` | The worker bumps it | ≈2–5 ms on a miss |
| Streak and best streak | **Materialised** on write, `training_profiles` (streaks) | Attempts transaction | PK |
| Daily plan | **Materialised** per local day, `training_days.plan` | First `GET /api/train/today` of the day | PK |
| Coach daily usage | Counters, `coach_usage_days` | Coach transaction | PK |
| Import progress | Counters on `linked_accounts` | Worker, every chunk | PK |
| Tournament standings | DB is the record (the rank index); live deltas live in the socket server's memory | `finish` transaction | Index |
| Rating-band baselines | Static JSON in the repo | Build | 0 |
| Opening book set (≈30k EPDs) | In memory on the worker, loaded from `openings` at boot | — | 0 |
| Admin dashboard counts | `count(*)` on small tables; `pg_class.reltuples` estimates for large ones | — | — |

### 3.9 Keeping Neon asleep, small and cheap

| Rule | Why |
|---|---|
| **No timers that query the DB.** Not on the worker (push wake-up plus drain-until-empty; DB §5.3), not on the socket server (it has no DB), not in the browser (no polling, D8) | Any query in a 5-minute window keeps the compute up (DB §10.1) |
| Housekeeping, the nightly `pg_dump` and the weekly `pg_stat_statements` snapshot run **in the same daily window** on the worker (for example 03:30 IST) | One wake-up instead of three |
| Crawlers hit ISR and CDN pages only (§4.3) | Was 2 queries per crawler hit (DB-15) |
| Dev, E2E and perf traffic live in a **separate Neon project** (DB-01) | Today they spend production's 100 CU-h |
| Production on Neon Launch with scale-to-zero **off** once paying members exist (OD-2) | A Free-plan compute that runs out suspends the whole site for the rest of the month; Launch for an always-on 0.25 CU is ≈ $15–25 a month (DB §10.3) |
| JSON blobs out of hot rows: `gameData.moveHistory` and `traceContext` are no longer written (C1 strips them in batches); `explanation` JSON moves to R2 behind `explanationUrl` + `hasExplanation` (DB §7.3) | Write amplification, TOAST churn, egress |
| Retention (DB §14): jobs DONE 7 d, FAILED 30 d; webhook events 30 d; idempotency keys 24 h; rate-limit rows 1 d; coach messages 180 d; weakness snapshots 12 weeks; imported games without analysis beyond the newest 2,000 per member | Storage cap of ~1 GB per project |

### 3.10 Schema additions this plan relies on (all additive; owning migration in `02-data-model.md` §5.0)

| Table.column | Type | Used by | Migration |
|---|---|---|---|
| `users."gamesVersion"`, `users.statsVersion`, `users.bankVersion` | `int NOT NULL DEFAULT 0` | Version-key ETags and caches (§4.3.3, §4.9); bumped by the finish CTE, the analysis batch, imports, purges | M1 (`gamesVersion`), the others with their phases |
| `users."timeZone"` | `varchar(64) NOT NULL DEFAULT 'UTC'` | Local day for plans, streaks and Home "this week" (§3.6.2, §3.6.5) | **M4** (P4) |
| `users.trialReminderSentAt`, `users."subscriptionSourceAt"` | `timestamp(3)` | Cron index; the billing compare-and-set (§3.7.7, P1 F4b) | M1 |
| `games` live columns (`moves`, `moveClocksMs`, `plyCount`, `fen`, `whiteTimeMs`, `blackTimeMs`, `clockRunning`, `phase`, `phaseEndsAt`, `pgn`) | P2 §6.2 | Checkpoints and restore (§3.7.1) | M2 |
| `game_analyses.keyFens`, `gradingVersion`, `"readyMs"` | `text[]`, `smallint`, `int` | Thumbnails without a server replay (§3.6.2); ETag (§4.9); the review-ready SLO audit (§2.6) | M3 |
| `jobs.userId`, `jobs."fairSeq"`, `jobs."lastKickAt"` | `bigint`, `int`, `timestamp(3)` | `jobs_user_idx`; fairness; the re-kick compare-and-set | M3 |
| `training_attempts."clientAttemptId"` | `uuid` unique | Idempotent attempts and the offline outbox (§3.7.4) | M5 |
| `coach_messages."clientId"`, `status` | `text`, enum | Idempotent send (`(userId, clientId)` unique); aborted streams (§6.4.4) | M7 |
| `linked_accounts.lastSyncAt`, `import_cursors.archives` | `timestamp(3)`, `jsonb` | Sync limits and conditional Chess.com fetches (§8.2, §8.4) | M4 |
| `openings.epd`, `{openings,chess_positions}.explanationUrl`, `.hasExplanation` | `text`, `text`, `boolean` | BOOK detection; explanations on R2 (§5.3) | M3 / M8 |
| Tables `rate_limit_buckets` (UNLOGGED, ≤ 60 s windows), `rate_limit_windows` (logged), `idempotency_keys`, `webhook_events` | — | §8.3, §3.7.8, §3.7.7 | M1 |
| The daily plan and streak | `training_days.plan` (frozen per local day) and `training_profiles` (streaks) | §3.6.5 | M5. Revision 1's `training_days.plan` and `training_profiles` (streaks) tables are not created (B12) |

## 4. Caching layers

### 4.1 Layer map

| Layer | Where | What it holds | Invalidation |
|---|---|---|---|
| L0 browser HTTP cache | Browser | Hashed JS and CSS (`_next/static`, immutable), fonts, piece sprites, the hashed Stockfish WASM, versioned catalogue JSON, puzzle shards | New hash or URL version |
| L1 service worker | Browser | **Only** the app shell, fonts, pieces, sounds and the offline page (§4.8) | Version bump on deploy |
| L2 Vercel CDN | Edge PoPs | `public-static` responses and ISR pages | `revalidateTag` / time; versioned URLs need no purge |
| L3 Next.js data cache | Vercel Data Cache (persists across deploys) | `unstable_cache` results: catalogue queries, public player stats, versioned per-user aggregates | Tags (`revalidateTag`) or version keys |
| L4 per-request memo | Function memory, one request | React `cache()`: viewer, game header, opening, legend, tournament | End of request |
| L5 module scope (Vercel) | Function instance | Immutable configuration only: ECO index, grading constants, the bot user id, the serialised coach prompt prefix | Deploy |
| L6 worker caches | OCI worker RAM and disk | Eval cache (L1 LRU → SQLite → Lichess seed), opening book set | Engine version in the key |
| L7 client query cache | Browser memory (TanStack Query) | Server state per query key; socket events write into it | `staleTime`, invalidation, socket `setQueryData` |
| L8 Anthropic prompt cache | Anthropic | Tools + system prefix (shared by all users), per-game context | TTL 5 min (refreshed on every read) |

### 4.2 HTTP cache policy (exact headers), declared per route in the route wrapper

| Tier | `Cache-Control` sent | Extra headers | Used by |
|---|---|---|---|
| `public-immutable` (versioned URL `?v=<contentHash>` or a hashed path) | `public, max-age=31536000, immutable` | `ETag` | `/api/catalog/openings?v=`, `/api/catalog/legends?v=`, R2 puzzle shards (`puzzles/v1/<theme>/<band>.json`), `/workers/stockfish-18-lite-single.<hash>.wasm` (on R2 or `/workers`), `/og/review/:slug/:version.png` |
| `public-static` (ISR / static route handler) | Managed by Next ISR: `export const revalidate = 86400` + `unstable_cache` tags. Vercel serves it from the CDN; `revalidateTag` purges both the data cache and the CDN copy | — | `/legends`, `/legends/[ref]`, `/openings`, `/openings/[eco]`, `/openings/[ref]`, `/learn/*`, `/blog/*` (static), sitemaps, `GET /api/catalog/openings` (the unversioned index that returns the current `?v=` hash) |
| `public-short` | `public, max-age=0` + `Vercel-CDN-Cache-Control: max-age=15, stale-while-revalidate=60` | — | `GET /api/tournaments?tab=…` (public projection only), `GET /api/players/:u` (public projection only), public search. **Never on a route that reads a session**: the CDN key is the URL and ignores cookies |
| `private-etag` | `private, no-cache` | strong `ETag: "<version>"`; `304` on a match | `GET /api/review/[ref]` (analysing and complete), `/api/review/[ref]/status`, `/api/train/weakness`, `/api/me`, `/api/me/games` (`"g<gamesVersion>.<filterHash>"`), `/api/coach/threads/:id`, coach suggestions |
| `no-store` | `private, no-store` | — | Billing (`/api/checkout`, `/api/subscription/*`, `/api/billing/*`, `POST /api/billing/refresh`, downloads (PGN, invoice PDF, export; `Content-Disposition: attachment`), `/checkout/return`), `/api/socket-token`, `/api/train/today`, `/api/train/sessions*`, `/api/home`, `/api/import/status`, every `/api/internal/*`, webhooks, admin APIs, **every 4xx/5xx and every 429** (with `Retry-After`) |
| `sse` | `no-cache, no-transform` | `Content-Type: text/event-stream; charset=utf-8`, `X-Accel-Buffering: no`, `Connection: keep-alive` | `/api/coach/messages*` |

Notes:

- **Check every public tier after deploy** with `curl -sI … | grep -i x-vercel-cache` (`HIT`, `STALE`, `MISS`) and add it to the k6 catalogue scenario (§9.6). Header behaviour on Vercel (how it treats `s-maxage` versus `Vercel-CDN-Cache-Control`) is verified on the dev project before relying on it.
- **Exclude public and internal paths from the Clerk middleware matcher** (`middleware.ts:44-46` runs on every `/api` path): `api/catalog`, `api/health`, `api/internal`, `api/webhook`, `monitoring`, `ingest`, `og`, `workers`, `sitemap*.xml`, `robots.txt`. That saves one edge middleware run per request and keeps auth cookies away from cacheable responses.
- **Cacheable responses must never carry `Set-Cookie`.** The route wrapper asserts this for the `public-*` tiers in dev and test builds.
- Static assets: change `next.config.js:160-164` so that `/workers/*` with a content hash is `public, max-age=31536000, immutable` (the unhashed loader JS keeps `max-age=0`). Move board pieces and move-quality icons under a versioned path (`/v1/pieces/*`) with `immutable`; today they are 30 days + SWR (`next.config.js:130-145`).

### 4.3 Next.js data cache, tags and ISR

**4.3.1 Catalogue data (public, shared by all users).** Use `unstable_cache` in Next 15.5. When the app moves to Next 16, switch to `"use cache"` + `cacheTag`/`cacheLife` (Cache Components), which keeps the same tags.

| Function (`lib/catalog/*.ts`) | Tags | `revalidate` | Revalidated by |
|---|---|---|---|
| `getLegends()` (slim card DTO) | `legends` | 86400 | `/api/admin/legends*` writes |
| `getLegend(ref)` | `legends`, `legend:{ref}` | 86400 | same |
| `getOpeningIndex()` (ref, eco, name; also produces the content hash `v`) | `openings` | 86400 | admin opening writes, seed scripts |
| `getOpeningsByEco(letter)` | `openings`, `openings:{letter}` | 86400 | same |
| `getOpening(ref)` | `openings`, `opening:{ref}` | 86400 | same |
| `getPositionsForLegend(ref)` / `getPosition(ref)` | `positions`, `position:{ref}`, `legend:{ref}` | 86400 | `/api/admin/positions*`, scraper import |
| `getFeaturedPositions()` | `featured`, `positions` | 3600 | same |
| `getLessons()` / `getLesson(key)` | `lessons`, `lesson:{key}` | 86400 | content deploy |
| `getTournamentList(status)` | `tournaments:list` | 15 | tournament create/start/end |
| `getPublicPlayer(username)` (header and public stats only) | `player:{ref}` | 300 | profile edit, privacy toggle |

- ISR pages: `export const revalidate = 86400` on `app/(marketing)/legends/page.tsx`, `legends/[referenceId]/page.tsx`, `openings/page.tsx`, `openings/[eco]/page.tsx` and `openings/[referenceId]/page.tsx`. This replaces `force-dynamic` at `app/legends/page.tsx:7` and `app/openings/page.tsx:9`. `generateStaticParams` returns the 51 legends, the 5 ECO volumes and the top 200 openings; the rest render on first request and are then cached.
- The `/openings?q=` search moves to a client island that filters the cached `getOpeningIndex()` JSON in memory (3,641 short rows, about 12 KB brotli per ECO volume). There is no `ILIKE` on `pgn` (`app/openings/page.tsx:25-31`).
- Admin write routes call `revalidateTag(...)` in `after()`, so the response does not wait for the purge.

**4.3.2 What never goes into the shared data cache:** anything per viewer except through the version-key pattern below, billing, entitlement, FSRS state, coach threads and tokens.

**4.3.3 Version-key pattern for per-user aggregates.** This avoids `revalidateTag` calls from OCI, which would each cost an invocation:

```ts
// key includes a version the worker bumps in the same transaction that changes the data (§3.7.3)
const stats = await unstable_cache(
  () => queryProfileStats(userId),
  ["profile-stats", String(userId), String(viewer.statsVersion)],
  { revalidate: 86400, tags: [`user:${userId}`] },
)();
```

`users.statsVersion` and `users.bankVersion` are in `VIEWER_SELECT`, so the version check costs nothing. Old entries age out after `revalidate`. Account deletion calls `revalidateTag('user:'+id)`.

### 4.4 Per-request memoisation (React `cache()`)

These functions are shared by `generateMetadata`, layouts and pages, so each row is read once per request. Today `legends/[referenceId]/layout.tsx:10` and `page.tsx:17` read the same row twice, and so do `openings/[referenceId]/layout.tsx:10` and `page.tsx:25` (Q PERF-05). Only `profile/[referenceId]/layout.tsx:11` uses `cache` today.

`getViewer()`, `getViewerId()`, `getGameForViewer(ref)` (the §3.6.6 version probe), `getReviewPayload(ref)`, `getTournament(slug)`, `getPlayer(username)`, and the catalogue getters above (each wraps its `unstable_cache` call in `cache()`).

### 4.5 Module-scope caches on Vercel functions

Allowed only for data that is immutable for the life of a deployment:

- the ECO → name index (for labelling imported games);
- `GRADING_VERSION` and the classification constants (`packages/chess-analysis`);
- the bot system-user id, looked up once and re-read on error (`create-ai-game/route.ts:84-124` looks it up on every AI game);
- the coach's serialised `tools` + `system` prefix (byte-stable, which matters for the prompt cache);
- Dodo product and price ids from env (`lib/billing/products.ts`).

**Never** user data, entitlement or anything a webhook changes. Fluid instances live for minutes to hours, and two instances would disagree.

### 4.6 Worker caches (eval cache, D6)

| Tier | Store | Key | Value | Size | Latency |
|---|---|---|---|---|---|
| E1 | In-process LRU (`lru-cache`) | `epd` (the first 4 FEN fields) + `":" + engineId` | `{ nodes, multipv, depth, lines:[{cp or mate, pv: uci[≤10]}] }` | 200k entries, ≈ 60–80 MB | < 1 µs |
| E2 | SQLite on the worker's boot volume (`better-sqlite3`, WAL, `synchronous=NORMAL`, `cache_size` 64 MB, `mmap_size` 256 MB), table `evals(epd TEXT, engine TEXT, nodes INT, multipv INT, depth INT, data BLOB, used_at INT, PRIMARY KEY (epd, engine))` | same | same (MessagePack) | cap 5 GB; a weekly `DELETE … ORDER BY used_at LIMIT …` to stay under it | 20–50 µs |
| E3 | Lichess CC0 eval DB subset, preloaded into E2 with `engine = 'lichess-db'` | `epd` | Lichess `evals[]` (depth, PVs) | ≈ 1–5M positions (≈ 0.5–1.5 GB) | as E2 |
| E4 | Imported Lichess games that carry `%eval` | per game | cp/mate per ply (graph + candidate detection) | — | 0 |

- **When a cached result is good enough.** It must have `nodes_cached ≥ nodes_requested` (Lichess rows use `depth ≥ 30`, which counts as satisfying pass 1 and pass 2) **and** `multipv_cached ≥ multipv_requested`. Only the strongest result per `(epd, engine)` is kept.
- **E3 seed.** An offline script (owner's laptop or the worker at low priority, once) builds a file of all positions within the first 20 plies of (a) every line in the `Opening` table and (b) positions seen at least 20 times in one month of Lichess rated games (CC0). It joins those positions to `lichess_db_eval.jsonl.zst`, writes a SQLite file and uploads it to R2. The worker downloads it at boot if it is missing.
- **E4.** For imported Lichess games with `%eval`, the worker takes the evals for the graph and the blunder candidates, and runs the engine only for MultiPV-2 confirmation on candidate plies (plan Phase 4).
- **Lichess cloud-eval API: not in the hot path.** From Mumbai it costs ≈ 250 ms per lookup, which is slower than a 120k-node local search (~0.15 s), and it adds a rate-limited dependency (one request at a time, 60 s back-off on 429).
- **Write-back.** Every engine result goes into E1 synchronously, and into E2 in batches every 2 s inside one SQLite transaction.
- **Invalidation.** `engineId = "sf18-<netHash>"`. A new engine or network gives a new key space; `lichess-db` rows stay valid. A `GRADING_VERSION` change does **not** invalidate evals, because classification is computed from raw evals.
- **Hit-rate targets.** Plies 1–10: ≥ 80 %. Pass 1 overall: ≥ 25 % for live games and ≥ 40 % for bulk imports (a member's own repeated openings). Measured as `worker.cache.hit{tier}` (§9.5).
- **Coach engine tool.** `/engine/analyse` reads E1/E2 first. When the coach panel opens, the web app prefetches the current ply's position into E1 (`after()` → worker), so a later tool call is a cache hit (§6.4.3).
- **Not in Neon.** The `PositionEval` table in inv-rct-a §2.2 is dropped: each lookup from Mumbai would cost ~230 ms, it would grow Neon storage by ~100 B per position, and it would keep the compute awake.

### 4.7 Client query cache (TanStack Query v5)

The provider is `QueryClient({ defaultOptions: { queries: { staleTime: 30_000, gcTime: 5 * 60_000, retry: (n, e) => n < 2 && isRetryable(e), refetchOnWindowFocus: false } } })`. Focus refetch is turned on only for the keys marked below.

| Key (`lib/api/keys.ts`) | Endpoint | `staleTime` | Focus refetch | Written by the socket (`setQueryData`) | Invalidated by |
|---|---|---|---|---|---|
| `qk.viewer()` | seeded from layout props; `GET /api/me` | ∞ | no | `entitlement.changed`, `profile.changed` | settings and billing mutations (their response is the new DTO) |
| `qk.home()` | `GET /api/home` (seeded by RSC) | 30 s | yes | `analysis:done` (Continue), `import:progress`, `bank:due_changed` | — |
| `qk.games.list(filters)` (infinite) | `GET /api/games` | 60 s | no | `import:progress` (invalidate first page on chunk done) | `game.result` |
| `qk.review(ref)` | `GET /api/review/:ref` | 0 while analysing; **∞ once `status=done`** | while analysing only | `analysis:progress` (append plies), `analysis:done` (refetch once) | retry mutation |
| `qk.coach.context(ref, ply)` | `GET /api/coach/context` | 5 min | no | SSE appends to `qk.coach.thread` | — |
| `qk.coach.thread(id)` (infinite) | `GET /api/coach/threads/:id` | ∞ | no | SSE frames | — |
| `qk.train.today()` | `GET /api/train/today` | 30 s | yes | `bank:due_changed`, `card.reviewed` (another tab) | session end |
| `qk.train.session(ref)` | `POST /api/train/sessions` → `GET …/:ref` | ∞ for the session's life | no | — | local grade mutations |
| `qk.train.bank(filters)` (infinite) | `GET /api/train/bank` | 60 s | no | `bank:due_changed` | `mistakes.added` |
| `qk.weakness()` | `GET /api/train/weakness` | 10 min | no | `weakness.ready` (invalidate) | recompute mutation |
| `qk.catalog.openings(letter)` | `GET /api/catalog/openings?v=&eco=` | ∞ | no | — | new `v` from the layout |
| `qk.catalog.legends()` | `GET /api/catalog/legends?v=` | ∞ | no | — | new `v` |
| `qk.tournament(slug)` | `GET /api/tournaments/:slug` | ∞ while the socket is connected | on reconnect | `lobby.delta` (with a `version`; a gap means refetch) | — |
| `qk.membership()` | `GET /api/billing/membership` (DB only) | 5 min | yes | `entitlement.changed` | billing mutation responses |

Patterns:

- **RSC prefetch + `HydrationBoundary`** on Home, Review, the archive, the Bank, the Train hub, Weakness, Profile and the Tournament lobby, so the first HTML carries the data and there is no client fetch on mount (CL §11.5). The server calls the same service function the route uses, never HTTP to itself.
- **Intent prefetch** (at most 3 in flight): hovering or focusing an archive row prefetches `qk.review(ref)`; 2 cards before the end of a session the next session is prefetched; when a match is found, `router.prefetch('/game/'+ref)` runs and the snapshot is seeded from `queue.matched` (CL §11.13).
- **App Router client cache.** Set `experimental.staleTimes = { dynamic: 30, static: 300 }` in `next.config.js`, so back and forward navigation within 30 s reuses the RSC payload with no new invocation. `<Link prefetch>` stays on for the ≈6 primary navigation targets only; list rows use `prefetch={false}`, because each dynamic prefetch is an invocation.
- **Aborts.** Query functions pass the `signal` TanStack provides to `api()` (CL §11.3), which fixes the leaderboard, tournaments-tab and `PositionPageClient` races (CL §6.3).
- **Nothing private is persisted.** No `persistQueryClient`. Only the training outbox (IndexedDB `rc-train-outbox`) and UI preferences (`rc:prefs:v1`) are stored locally (CL §11.12).

### 4.8 Service worker policy

Rewrite `next.config.js:13-35` with explicit `runtimeCaching` and a reduced precache:

| Request | Strategy |
|---|---|
| `/api/*`, authenticated HTML/RSC (`(app)` routes), `/monitoring`, `/ingest/*` | **NetworkOnly** (fixes the cross-user cache leak, CL §10.6 / Q SEC-15) |
| `/_next/static/*` | CacheFirst, **runtime** only (no precache of all 293 chunks), max 200 entries |
| Fonts, `/v1/pieces/*`, `/board_icons/svg/*`, `/sounds/*` (R2 redirect today, `next.config.js:41-46`) | CacheFirst, max-age 1 year |
| Offline fallback (`V3Offline`) | Precached: the shell, the offline page and its assets (≈ 300 KB) |
| Marketing HTML | StaleWhileRevalidate, max 20 entries |

- Sign-out runs `caches.keys()` → delete everything except the shell, clears the TanStack cache and clears the socket token (CL §4.1).
- The update prompt (`V3PwaUpdate`: ready, refreshing, later, in_game) is deferred while a game is live.
- **Effect on quotas.** Every deploy currently makes each installed user re-download about 293 chunks plus 4.8 MB. With runtime-only caching, only the chunks a user actually visits are fetched (§1.1, edge requests).

### 4.9 ETags without paying for the payload

- An ETag is **derived from version columns** that are read in the cheap probe query, never from hashing the full payload: `"r:{analysisVersion}.{gradingVersion}.{status}"` (review), `"w:{weekStart}.{computedAt}.{algoVersion}"` (weakness), `"u:{updatedAt}"` (me), `"t:{messageCount}.{lastMessageId}"` (thread).
- On a match the route returns `304` after 1–2 small statements, and the client keeps its cached body. For the `public-immutable` tier, Next or the CDN computes the ETag.
- The route wrapper provides `etag(versionParts)` and `notModified(req, etag)` helpers (Appendix A.3).

### 4.10 Never cache (anywhere except the request that produced it)

- Billing and entitlement: checkout sessions, subscription actions, the customer-portal URL, `POST /api/billing/refresh`, downloads (PGN, invoice PDF, export; `Content-Disposition: attachment`), the membership DTO beyond a 5-minute in-memory client copy (always invalidated by `entitlement.changed`), the `/checkout/return` page.
- Private review, coach, bank and training data in any **shared** cache (CDN, Next data cache without a per-user version key, the service worker). Private data is cached only in the browser's memory (TanStack) or with `private, no-cache` + ETag.
- FSRS session payloads (they contain solutions; always fresh) and attempt responses.
- Socket tokens, Lichess OAuth tokens (never selected; global `omit`), any response that sets a cookie.
- Internal routes, webhooks, admin APIs, `/api/health`.
- Error responses: every 4xx/5xx is `no-store`, so the CDN never pins an outage. A 429 carries `Retry-After`.
- Share pages after revocation: `GET /api/share/:slug` is `public-short` (15 s) **and** is purged with `revalidateTag('share:'+slug)` on revoke. The OG image URL includes the share version, so a revoked share's image URL is never reused.

### 4.11 How each screen talks to the backend (target)

"Invocations" counts Vercel functions per visit, page render included.

| Screen (boards) | First paint | Client HTTP after paint | Socket | Mutations | Invocations |
|---|---|---|---|---|---|
| Marketing, catalogue (`V3Landing`, `V3Pricing`, `V3LegendsCatalogue`, `V3OpeningsCatalogue`) | ISR/CDN HTML | `/api/catalog/*?v=` (CDN) for search | — | — | 0 on a HIT |
| Sign-in / sign-up (`V3SignIn`, `V3SignUp`) | static shell + Clerk | Clerk only | — | — | 0–1 |
| Onboarding link (`V3OnbLink`: validating, found, not_found, private_profile, rate_limited) | RSC (viewer, step) | `POST /api/accounts/chesscom/lookup` (cached 10 min) | `import:progress` after linking | `PATCH /api/me/onboarding`, `POST /api/accounts/chesscom` | 2–4 |
| Checkout return (`V3CheckoutActivating`: polling, success, stalled, failed) | RSC | `POST /api/billing/refresh` once, then 3 fallback polls (2/4/8 s) | `entitlement.changed` | — | 2–5 |
| Home (`V3Home`) | RSC + `HydrationBoundary(qk.home)` | none | `review.*`, `import:progress`, `bank:due_changed` | — | 1 |
| Play hub (`V3PlayHub`) | RSC (slim legends, ECO volume A) | `qk.catalog.openings(letter)` on demand (CDN) | — | `POST /api/games` | 1–2 |
| Queue (`V3Queue`, `V3MatchFound`) | RSC | none | `queue.join` / `queue.leave` → `queue.matched` | — | 1 |
| Live game (`V3Game`, 55 states) | RSC (viewer, socket token) | none | `game:join` ack (snapshot), `move:applied` and the other P2 deltas | socket commands only | 1 (+ 0 Vercel calls per game: direct writes) |
| Review (`V3ReviewAnalysing`/`Summary`, `V3KeyMoments`, `V3RvComplete`, `V3RvShare`) | RSC + `qk.review` | `GET /api/review/:ref` once on `analysis:done`; legend tab lazily | `analysis:progress`, `analysis:done` | `POST …/retry`, `POST …/share` | 1–2 |
| Coach panel (`V3CoachSuggested`, `Streaming`, `Error`, `RateLimit`) | — (opens over Review or Game) | `GET /api/coach/context` | — | `POST /api/coach/messages` (SSE) | 1 + 1 per message |
| Train hub (`V3TrainHub`) | RSC + `qk.train.today` | none | `bank:due_changed` | `POST /api/train/sessions` | 1 |
| Bank session / puzzles (`V3BankSession`, `V3Puzzle*`, `V3SessionSummary`) | RSC (session payload) | next session prefetched near the end | — | `POST /api/train/attempts` (batched outbox) | 1 + 1–3 |
| Mistake Bank list (`V3MistakeBank`) | RSC first page | `GET /api/train/bank?cursor` on scroll | `bank:due_changed` | skip / remove | 1 + pages |
| Weakness (`V3WeaknessProfile`, `Insufficient`, `Computing`, `Drill`) | RSC + ETag | none (304 on revisit) | `weakness.ready` | `POST /api/train/sessions {theme}` | 1 |
| Games archive (`V3GamesArchive`, `V4ProfileGames`) | RSC first page | `GET /api/games?cursor` on scroll and on a filter change | `import:progress` | — | 1 + pages |
| Profile (`V4Profile*`) | RSC (header + stats, version-cached) | none | — | `PATCH /api/me/profile` | 1 |
| Membership (`V4Membership*`, `V4PlanSwitch`, `V4CancelSub`) | RSC (DB only) | `POST …/change-plan/preview` | `entitlement.changed` | cancel, resume, change-plan (each returns the DTO) | 1 + 1 per action |
| Tournament lobby / live (`V4TournamentLobby`, `V4TournamentLive`) | RSC snapshot | none | `lobby.delta`, `tournament.paired` | join, start, end | 1 |

---

## 5. Payload budgets

### 5.1 HTTP response budgets

Budgets are for the typical case. Vercel compresses compressible responses (brotli or gzip) when the client sends `Accept-Encoding`; the k6 suite checks `content-encoding` (§9.6). Routes never compress responses themselves.

| Endpoint | Raw budget | Compressed budget | Today (for comparison) |
|---|---|---|---|
| `GET /api/me` | ≤ 1.5 KB | ≤ 0.8 KB | `POST /api/user/sync` + `GET /api/subscription` + `GET /api/user/email` |
| `GET /api/home` (RSC-seeded) | ≤ 6 KB | ≤ 2.5 KB | — |
| `GET /api/review/:ref`, complete, 80 plies | ≤ 12 KB | **≤ 5 KB** | `/api/analysis` sends verbose `chess.js` moves (≈ 265 B/ply ⇒ ≈ 21 KB) **plus** `legendPgn` (CL §3.3) |
| `GET /api/review/:ref`, analysing | ≤ 2 KB | ≤ 1 KB | — |
| `GET /api/games?limit=30` | ≤ 10 KB | ≤ 3 KB | `/api/profile` returns 20 games + full stats rows |
| `GET /api/train/today` | ≤ 4 KB | ≤ 1.5 KB | — |
| `POST /api/train/sessions` (10 items) | ≤ 6 KB | ≤ 2.5 KB | — |
| `GET /api/train/bank?limit=50` | ≤ 14 KB | ≤ 4 KB | — |
| `GET /api/train/weakness` | ≤ 8 KB | ≤ 3 KB | — |
| `GET /api/coach/context` | ≤ 8 KB | ≤ 3 KB | — |
| `GET /api/tournaments/:slug` (top 50 + live games) | ≤ 10 KB | ≤ 3 KB | up to 100 participants + unbounded active games on every lobby event (API F-19) |
| `GET /api/catalog/openings?v=&eco=B` (one ECO volume, slim) | ≤ 70 KB | ≤ 14 KB | all 3,641 openings, ≈ 330 KB per request, persisted in localStorage (`useDataStore.ts:90`) |
| `GET /api/catalog/legends?v=` (51 slim cards) | ≤ 12 KB | ≤ 4 KB | full objects with `achievements`/`famousGames` (CL §3.4) |
| R2 puzzle shard (500 puzzles) | ≤ 60 KB | ≤ 20 KB | — |
| Request body `POST /api/train/attempts` (50 items) | ≤ 8 KB | — | — |
| Socket checkpoint statement (80 plies, direct to Neon) | ≤ 2 KB of bound parameters | — | 18.8 KB at ply 80, sent every ply (WS §6.1) |

The route wrapper enforces request limits with a per-route `maxBodyBytes`: 16 KB by default, 32 KB for attempts and coach, 1 MB for the scraper import (API F-14).

### 5.2 Packed review DTO (no move trees)

```ts
// packages/contracts/review.ts — the only review payload the client ever receives
export type ReviewDTO = {
  v: 1; ref: string; status: "analysing" | "done" | "failed";
  game: { startFen: string; startPly: number; tc: { initialMs: number; incMs: number };
          result: "1-0" | "0-1" | "1/2-1/2"; endReason: string; playedAt: string; source: "REPLAY" | "CHESSCOM" | "LICHESS";
          opening: { eco: string; name: string } | null; legend: { ref: string; name: string } | null };
  players: { w: PlayerCard; b: PlayerCard }; you: "w" | "b";
  moves: string;            // "e2e4 e7e5 g1f3 …"   UCI, space-separated (≈5 B/ply)
  san: string;              // "e4 e5 Nf3 …"        so the client needs no chess.js replay to label moves
  clocks: number[];         // ms left after each ply (empty for daily or untimed games)
  analysis?: {
    gradingVersion: number; engine: string;
    evals: number[];        // cp from White after each ply; mate in n encoded as ±(30000 − n)
    best: string;           // best UCI before each ply, space-separated ("-" when forced)
    j: string;              // one char per ply: B brilliant, G great, b best, E excellent, g good, k book,
                            // I inaccuracy, M mistake, X blunder, S miss, F forced, ? not graded yet
    acc: { w: number; b: number; phase: { w: number[]; b: number[] } };
    phasePlies: [number, number];
    moments: { ply: number; fen: string; played: string; best: string; accept: string[];
               line: string; ask: string; why: string[]; plan?: Record<string, string> }[];  // ≤ 3, the viewer's
    counts: { w: Record<string, number>; b: Record<string, number> };
    summary: string[];
  };
  progress?: { graded: number; total: number };
};
```

- Win %, per-move accuracy and the eval-graph points are **computed in the browser** from `evals` with `packages/chess-analysis` (DB §11.5). They are not sent.
- MultiPV alternatives are sent **only** for key moments (`line`, `accept`). Live engine lines in the Review engine panel come from the local WASM engine, and only when the panel is opened.
- The opponent's key moments are not sent by default; `?side=both` adds them (for a profile owner reviewing both sides).
- The legend comparison is a separate, lazy, public-tier request (§3.6.6).
- Size at 80 plies: moves 400 B + SAN 350 B + clocks 400 B + evals 480 B + best 400 B + `j` 80 B + three moments ≈ 1.5 KB + header and summary ≈ 1 KB ⇒ **≈ 4.6 KB raw, ≈ 2.5 KB brotli** (est.). The 12 KB / 5 KB budget leaves room for longer games.

### 5.3 Catalogue, puzzle and media payloads

- **Openings.** The index is sharded by ECO letter A–E: `GET /api/catalog/openings?v=<hash>&eco=B` returns `[ref, eco, name]` tuples (not objects) at about 14 KB brotli per volume. The detail page (`/openings/[ref]`) is ISR and carries the PGN and the moves. `explanation` JSON moves to R2 (`explanationUrl`), and the page fetches it from the CDN only when narration plays (DB §7.3).
- **Legends.** One slim list (`ref, name, years, photoUrl, tagline, positionsCount`) at about 4 KB. The detail page is ISR.
- **Puzzles (D7).** Lichess CC0 puzzles live in `r2://media/puzzles/v1/<theme>/<ratingBand>.json`: about 500 puzzles per shard as `[id, fen, movesUci, rating, themesBitmask]` tuples, served `immutable`. A session builder on Vercel picks the IDs from the shard index (a static JSON manifest bundled at build time), so Postgres stores only `training_cards.puzzleId` for puzzles a member has seen.
- **Engine WASM.** `stockfish-18-lite-single.<hash>.wasm` (7.3 MB) is served from **R2** (`media.playchess.tech/engine/…`, `Content-Type: application/wasm`, CORS for the app origins, `immutable`). The small worker loader JS stays same-origin. This moves 7.3 MB per engine version per user off Vercel's transfer and edge-request quotas (§1.1).
- **Sounds and large images** already redirect to R2 (`next.config.js:37-46`). Board pieces become a single SVG sprite (one cached request, no `/_next/image` per piece; Q PERF-07).

### 5.4 Socket payloads and delta updates

Wire rules: integer milliseconds plus a server epoch `at`; **game-room deltas carry `seq` (and a `ply`)**, user-room events carry `useq`, and a gap triggers a snapshot resync. `perMessageDeflate: false` (the frames are tiny, so compression would only cost CPU) and `maxHttpBufferSize` 16 KB. Names are P2's registry (`CT/socket/registry.ts`).

| Event | Room | Max size | Frequency | Replaces |
|---|---|---|---|---|
| `game:join` ack → `GameState` `{seq, ref, mode, tc, startFen, moves: "uci …", moveClocksMs, phase, phaseEndsAt, clocks:{w,b,run,at}, players, you, drawOffer, rematch, presence, spectators, prefixSans: "…" }` | caller | **≤ 2 KB at 80 plies**, asserted with the longest seeded legend prefix (`prefixSans` is one space-separated string, not an array of up to 400 SANs) | on join, reconnect, `game:sync` | `game-by-ref` + `fetchGameByRef` |
| `move:applied {seq, ref, ply, uci, san, by, clocks}` (+ `check`, `premove`, `drawOfferCleared` only when true) | `game:{ref}` (immediately), `spectate:{ref}` (one ply late) | **≤ 200 B**, asserted by `size.test.ts` with realistic fixtures (a 25-character ref, real clocks) | per ply | `move_made` + `clock_update`. **No `fen`** (56–90 B; every client has chess.js and the move list; `game:sync` repairs a divergence) and **no `clientMoveId`** except in the mover's own ack (other tabs match on `ply` + `uci`) |
| `game:move` ack `MoveAck {seq, ply, san, clocks, clientMoveId}` / `{ok:false, code, state?}` | caller | ≤ 160 B | per move | `move_error` free text |
| `clock:sync {seq, ref, clocks, frozen?}` | `game:`, `spectate:` | ≤ 80 B | presence change, freeze/resume after a restart, and a **15 s drift check** while playing | `clock_update` **every second** to every player and spectator (`ClockManager.ts:189-192`) |
| `presence:update`, `draw:*`, `rematch:*`, `game:phase` | `game:` | ≤ 120 B | on change | — |
| `spectators:update {ref, count}` | `game:`, `spectate:` | ≤ 40 B | **at most 1 per 5 s** | an O(n²) broadcast on every join and leave (WS §8) |
| `analysis:progress {gameRef, gradedPlies, totalPlies, plies:[…]}` | `user:{ref}` | ≤ 120 B | every 2 graded plies, **only for priority ≥ `GAME_ENDED`** | — (would otherwise be a poll) |
| `analysis:done {gameRef, analysisVersion, accuracy, momentsCount, bank:{added, plies, due}}` | `user:` | ≤ 120 B | once | separate `mistakes:added` and `bank:due_changed` emits from the same batch |
| `analysis:batch {done, total, bankAdded, bankDue}` | `user:` | ≤ 80 B | ≤ 1 per user per 60 s for backlog bands | ≈ 30 progress posts per backlog game that no screen displays |
| `import:progress {provider, done, total, analysed, etaSec}` | `user:` | ≤ 80 B | per chunk, at most 1/s | a 5 s poll |
| `bank:due_changed {due}` / `weakness:ready` / `entitlement:changed {ent, status, subscriptionUpdatedAt}` | `user:` | ≤ 60 B | on change | `waitForEntitlement` polling 2 s × 6, three copies (CL §5.3) |
| `queue:matched {gameRef, color, opponent, studyIn}` (P9) | `user:` | ≤ 300 B | once | `match-status` at 1 Hz |
| tournament deltas (P12): `standings` sends **only the changed rows** (≤ 10), with a `version` | `tournament:{slug}` | ≤ 400 B | per game start/end | a full tournament refetch per event per viewer (`useTournamentLobby.ts:136-141`) |

**Fan-out discipline.** The socket server drops an emit early when `io.of("/").adapter.rooms.get(room)?.size` is 0, so the zod parse and fan-out are skipped for users with no open tab. **One socket per tab:** a `RealtimeProvider` in the `(app)` layout owns one connection with the rooms `user:`, `game:`/`spectate:`, `tournament:`. Moving from the lobby to a game does not reconnect. Handshake limits are per user (≤ 10 sockets, ≤ 20 handshakes a minute) with a generous per-IP flood guard and a 120 s boot grace (CGNAT).

### 5.5 SSE frames (coach)

`event: meta {messageId, threadRef, quota}` → `event: sentence {i, text, verified}` (verified sentences only) → optional `event: retract {i}` (one regenerate) → `event: fallback {line}` (engine line, no VERIFIED tag) → `event: done {usage:{in, cacheRead, out}, quota}` | `event: error {code: "upstream_unavailable" | "internal", retryable}`. A `: ping` comment every 15 s keeps proxies open; the client's idle watchdog is 25 s. The response is a `ReadableStream` with `Cache-Control: no-cache, no-transform` (no compression, which is what guarantees flushing on Vercel; `X-Accel-Buffering: no` is harmless there but has no effect). P7 §7.4 is authoritative for the frame schemas.

### 5.6 HTML and RSC budgets

| Page type | Document (HTML + inline RSC flight), compressed | Notes |
|---|---|---|
| Marketing | ≤ 60 KB | `/openings` today is 8.1 MB raw, 286 KB brotli, 58 % flight data (CL §0). Paginating by ECO volume, with no PGN in the list, fixes it |
| App lists | ≤ 50 KB | The dehydrated query state counts toward this; only DTOs go in it |
| Board pages | ≤ 40 KB | The snapshot comes over the socket, not inside the HTML |

Rules: server components render the data. Client islands get only the props they read. No Prisma rows, no `Date`, no BigInt, and nothing serialised twice into both HTML and RSC.

### 5.7 JavaScript budgets (First Load JS, gzip, from `next build`)

| Bucket | Budget | Today (CL §10.1) |
|---|---|---|
| Shared by all routes | ≤ 200 kB | 333 kB |
| Marketing route total | ≤ 180 kB, with no `chess.js`, no `socket.io-client` and no PostHog before consent | `/` 473 kB |
| App list route total | ≤ 260 kB | `/profile` 482 kB |
| Board route total (engine WASM excluded; `socket.io-client` included on `/game`) | ≤ 300 kB | `/game` 490 kB, `/analysis` 497 kB |
| Page-specific chunk | ≤ 50 kB | — |
| Middleware | ≤ 150 kB (the Clerk floor is ≈ 140 kB) | 143 kB |

### 5.8 Enforcement

- **Payload tests.** `packages/contracts/*.size.test.ts` serialise fixtures (an 80-ply review, a 30-row archive page, a 50-row bank page, a 10-item session) and assert the gzip size against §5.1.
- **Socket tests.** `CT/socket` size tests (`size.test.ts`, realistic fixtures) assert the snapshot is ≤ 2 KB at 80 plies with the longest legend prefix and `move:applied` is ≤ 200 B.
- **Bundle budget.** `scripts/check-bundle-budgets.mjs` parses the `next build` route table and fails CI over budget. `@next/bundle-analyzer` reports are attached to the PR.
- **Lighthouse CI**, mobile profile, on the marketing routes (§2.3).

---

## 6. Compute offload

### 6.1 What runs where

| Work | Browser | Vercel function (`iad1`) | Edge middleware | OCI socket (1 OCPU) | OCI worker (2 OCPU) | Third party |
|---|---|---|---|---|---|---|
| Gating (signed in, member, onboarding) | — | `(app)` layout re-check via `getViewer()` | **claims only, 0 DB** | `ent` claim in the socket token | — | Clerk session JWT |
| Viewer, SSR, RSC prefetch | hydrate | ✔ | — | — | — | — |
| Live game rules, clocks, presence, draws, rematch | optimistic preview, premove queue | — | — | **authoritative** (`packages/game-core`) | — | — |
| Matchmaking queue, arena pairing, tournament timers, standings deltas | — | `POST /api/internal/games` creates the game row | — | ✔ in memory | — | — |
| Bot games (`V3GameBot`) | ✔ `game-core` + WASM engine (lazy) | create + finish + validation by replay (WS §17.11) | — | — | — | — |
| Engine review (pass 1/2), classification, themes, mistakes | — | — | — | — | ✔ native Stockfish | — |
| Review text, captions (Haiku 5.5) | — | — | — | — | ✔ | Anthropic |
| Live engine lines (Review engine panel, Practice) | ✔ local WASM (opt-in) | — | — | — | — | — |
| Puzzle and bank answer checking | ✔ against `solution[]` | — | — | — | — | — |
| FSRS scheduling | optimistic counter | ✔ `ts-fsrs` in the attempts transaction | — | — | — | — |
| Weakness aggregation | — | — | — | — | ✔ `RECOMPUTE_WEAKNESS` job | — |
| Chess.com / Lichess import fetch and parse | — | enqueue only | — | — | ✔ serial outbound queue | Chess.com, Lichess |
| Chess.com handle lookup (onboarding preview) | — | ✔ class X, cached 10 min per handle | — | — | — | Chess.com |
| Coach chat stream | render | ✔ SSE (D12) | — | — | engine tool `/engine/analyse` | Anthropic |
| PGN export | ✔ from the review payload | fallback route | — | — | — | — |
| Share OG image | — | ✔ rendered once per share version, `immutable` on the CDN | — | — | — | — |
| Avatar upload | client-side resize | presigned R2 URL (`POST /api/me/avatar/upload-url`) | — | — | — | R2 |
| Trial-reminder email | — | ✔ daily Vercel cron (Hobby: at most daily) | — | — | — | email provider |
| Housekeeping, backups, the daily import sync, quota report | — | — | — | — | ✔ node-cron in the maintenance window | R2 |
| Webhooks (Dodo, Clerk) | — | ✔ quick ack; side effects in `after()` | — | push `entitlement.changed` | — | — |

### 6.2 OCI capacity plan

| Instance | Shape | Runs | Limits |
|---|---|---|---|
| `replay-chess` (prod, 132.226.190.10) | A1 1 OCPU / 6 GB (existing) | Caddy + socket server only. Caddy also reverse-proxies `/internal/analysis/*` and `/engine/*` to the worker's **private IP** (one public TLS endpoint) | socket server `mem_limit 2g` |
| `replay-chess-worker` (prod, **new**, OD-3) | A1 **2 OCPU / 12 GB**, 50 GB boot | Analysis worker: 2 engine lanes (`Threads=1`, `Hash=128` each), E1/E2 eval cache, importers, housekeeping and backup cron | `mem_limit 6g`; SQLite cache ≤ 5 GB on disk |
| `replay-chess-dev` (80.225.200.210) | A1 1 OCPU / 6 GB (existing) | Caddy + dev socket + a **co-located** dev worker with 1 lane in a `worker-idle.slice` (`CPUWeight=idle` → `cpu.idle=1`), `cpus: "0.75"`, pausing on socket loop lag (P3-D8; fallback `cpus: "0.5"` + `nice -n 10`) | Verify `cpu.idle` on the box [V1] |

That is 4 OCPU / 24 GB in total, exactly the Always Free allowance. CLAUDE.md says never to exceed it, so the new instance is an owner decision (OD-3).

**Worker scheduling.**

- Lane A takes only `JOB_PRIORITY.GAME_ENDED` and above (live games just ended, an imported game a member opened) and interactive `/engine/analyse` calls. Lane B takes everything, highest priority first.
- Both lanes check for a waiting job at `GAME_ENDED` or above **between positions**, not between games, so a live game waits at most one position (≈ 0.2 s) behind an import backlog.
- Pass 1 of one game is split across both lanes by ply (positions are independent), which halves the wall time of a review that a user is watching.

**Wake-up path.**

1. `finish`, or `POST /api/import/:provider`, inserts a job in its transaction.
2. `after()` sends `POST /internal/analysis/kick` with a 2 s timeout.
3. The worker drains the queue until it is empty.
4. When the queue drains it reads `min("runAt")` (Neon is awake anyway) and arms one timer; recurring work is future-dated rows planned by the daily `HOUSEKEEPING` + `DAILY_PLAN` (architecture CR-10). The reaper runs at boot and at the end of each drain. An idle worker sends no query.

There is no timer polling Neon (DB §5.3).

**Progress path.** Worker → `POST http://<socket-private-ip>:3002/internal/emit {v:1, targets:[{userRef}], event, data, dedupeKey?}` (HMAC, kid `wk` with its event allow-list; ≈ 1 ms on the VCN) → socket emit. It never goes through Vercel or Neon. `analysis:progress` is sent only for jobs at `GAME_ENDED` or above; backlog bands get one coalesced `analysis:batch` per user per 60 s.

**Benchmark gate (OPT-35).** Run `stockfish bench` and a 60-ply fixture game on the new instance. If pass-1 throughput is below 0.4 Mnps per lane, lower pass 1 to 80k nodes and re-check the §2.6 targets with the classification test fixtures (the label agreement must stay at or above 95 %).

### 6.3 Rules for Vercel functions on Hobby

| Rule | Detail |
|---|---|
| **Cap every route's duration** | Each route file exports `maxDuration`, set by class: R/W/I 10, X and WH 15, S 60, admin import 30, cron 60. A hung request otherwise burns provisioned memory until the platform maximum. A lint rule in the route-wrapper package checks that `app/api/**/route.ts` exports it |
| **Outbound timeouts** (`AbortSignal.timeout`) | Dodo 8 s, Clerk Backend API 5 s (webhooks and admin only), Chess.com lookup 5 s, worker kick 2 s, worker `/engine/analyse` 3 s, Anthropic stream: abort if no chunk arrives for 20 s, and stop the whole stream at 55 s |
| **`after()` for side effects** (from `next/server`) | Worker kick, socket notify, `revalidateTag`, Clerk `publicMetadata` sync, PostHog server events, email sends. This fixes the dropped, fire-and-forget tournament notifications (API F-10) |
| **No waiting on OCI or a third party in R and W classes** | §2.1 |
| **No long polling, no server-side sleeps, no image processing** | Avatars go straight to R2 with a presigned URL; images are resized in the browser |
| **Webhooks acknowledge quickly** | Insert the dedupe row and apply the conditional update, then `after()` for the rest (§3.7.7) |
| **Request safety under Fluid concurrency** | No mutable module state per request. Per-request timing uses `AsyncLocalStorage` (Appendix A.1) |

### 6.4 The coach stream on the Hobby plan

#### 6.4.1 Budget arithmetic (est.; check against the Vercel Usage tab)

| Resource | Per coach message | Hobby allowance | Messages per month |
|---|---|---|---|
| Invocations | 1 (+1 context read per panel open) | ≈ 1M | not binding |
| Active CPU (SSE framing, `chess.js` move checks, JSON) | ≈ 50–100 ms | ≈ 4 h = 14,400 s | ≈ 150k–290k |
| **Provisioned memory** (instance memory × wall time; a 15–25 s stream, 2 GB assumed) | ≈ 30–50 GB·s ≈ 0.008–0.014 GB·h | ≈ 360 GB·h | **≈ 26k–45k if no two streams share an instance**; more with Fluid's in-instance concurrency |
| Expected demand | 300 members × ~8 messages/day × ~20 active days | — | **≈ 48k** |

**Conclusion.** At about 150–300 active coach users, the provisioned-memory allowance, not CPU, becomes the limit, unless Fluid packs concurrent streams onto shared instances. Owner decision OD-1 (Vercel Pro, which commercial use needs anyway) removes the risk. Without it, the fallback is §6.4.5.

#### 6.4.2 Time to first token: prompt layout and model settings

Facts from the Claude API reference used here: `claude-sonnet-5-5` costs $2 / $10 per million input/output tokens, with cache reads at $0.20; `claude-haiku-5-5` costs $0.10 / $0.50 (prompts up to 100K). The minimum cacheable prefix is 512 tokens on both. A request can have at most 4 cache breakpoints. Cache writes cost 1.25× (5-minute TTL) or 2× (1-hour TTL), and every read refreshes the TTL.

- **Prompt order** (cache keys are byte prefixes, rendered as `tools` → `system` → `messages`):
  1. `tools`: `evaluate`, `legalMoves`, `bestLine`, in a fixed, sorted order with frozen descriptions.
  2. `system`: the coaching rules and the grounding contract, a frozen string (≥ 512 tokens). **Breakpoint 1** goes here, and it is shared by every user and every game, so under continuous traffic it is almost always a read.
  3. The game-context block as the first user content: header, moves (SAN), the eval summary, key moments and the current ply's engine facts. **Breakpoint 2** (5-minute TTL; one member's messages on one game are usually less than 5 minutes apart).
  4. Thread history, with top-level automatic `cache_control` for the growing tail.
  5. The new question, after the last breakpoint.
- **No volatile bytes before a breakpoint:** no timestamps, request IDs or unsorted JSON. A dev assertion logs when `usage.cache_read_input_tokens` is 0 on the second message of a thread.
- **Effort and thinking.** Chat runs at `output_config.effort: "low"` (the reference recommends `low` for chat; Sonnet 5.5 defaults to `high`). Sonnet 5.5 cannot disable thinking. To skip thinking before the first visible text, `thinking: {type: "between_tools"}` is the only option, and it is allowed only at effort `high` or below. Run an **A/B test** of adaptive versus `between_tools` behind a PostHog flag (`coach-thinking-mode`), measuring first-token time and answer quality on the coach eval set. With `display` left at its default, thinking streams with empty text, so the UI shows "Thinking…" from the `ack` frame and never a blank pause.
- **Optional pre-warm (flagged, measured).** When the coach panel opens and the thread has had no message for 4 minutes, `GET /api/coach/context` sends, in `after()`, a non-streaming request with `max_tokens: 0` and the same prefix (tools + system + game context). It writes the game-context cache before the user types. It costs one cache write of ≈ 4–6k tokens, ≈ $0.01, which the first message would otherwise pay anyway. Keep it only if p50 first-token time improves by ≥ 300 ms (§9.3).
- **Refusals.** As inv-rct-a §2.4.1 specifies, include the server-side fallback (`fallbacks: "default"` with beta `server-side-fallback-2026-07-01`). Check `stop_reason` before rendering.

#### 6.4.3 Engine tool calls

- When the coach panel opens, `GET /api/coach/context` asks the worker in `after()` to put the current ply's position into E1. A later `evaluate(fen)` call is then ≈ 230 ms of network plus < 1 ms of cache work.
- At most **3 tool calls per message**. Parallel tool calls run concurrently.
- `/engine/analyse` calls are capped at `nodes ≤ 400k` and served on lane A between batch positions (inv-rct-a §2.2).
- Every move the model writes is checked with `chess.js` before it is shown (`event: move_check`, plan Phase 7).

#### 6.4.4 Cancellation

- When the client aborts (Stop button, navigating away, or the request's `req.signal`), the route cancels the upstream Anthropic stream, writes the partial assistant message with `status = 'aborted'`, and counts the tokens already used toward the quota.
- Retrying (`POST /api/coach/messages/:id/retry`) never duplicates spend for an answer that finished (idempotent on `clientId`).

#### 6.4.5 Budget gate and fallback

**Gate.** Read the Vercel Usage tab monthly (§9.4). If coach streams pass **40 %** of the provisioned-memory allowance, or if cold starts push first-token p95 above 3 s, pick one of:

1. **Vercel Pro** (OD-1).
2. **Stream from OCI.** `POST /api/coach/messages` does the auth, quota and context work (≈ 40 ms) and returns `{messageId, streamToken}`. The coach module on the worker box calls Anthropic and streams `coach.token` events over the socket the tab already has open (`u:` room).
   - Vercel then spends one short invocation per message.
   - The cost: about +200 ms first-token time for US users (Mumbai → Anthropic in the US), and the coach code moves into the worker image.

The SSE frame shapes (§5.5) stay the same in both cases, so the client only changes transport.

### 6.5 Scheduled work

| Job | Where | When | Notes |
|---|---|---|---|
| Trial reminders (`/api/cron/trial-reminders`) | Vercel cron (`CRON_SECRET`) | daily, 09:00 UTC | Uses `users_trial_reminder_idx`; idempotent on `trialReminderSentAt` |
| Housekeeping (DB §14 rules, batches of 1,000) | worker node-cron | daily, in the maintenance window (03:30 IST) | The same Neon wake as below |
| `pg_dump` → R2 (14 daily + 8 weekly copies) | worker | the same window | DB §15 |
| Daily Chess.com/Lichess sync for linked accounts | worker | the same window, serial | One wake instead of many spread over the day |
| Stale-lock recovery (`RUNNING` for more than 10 min) | worker | at the start of every drain loop, not on a timer | |
| `pg_stat_statements` snapshot + quota report | worker | weekly, in the same window | §9.4 |

---

## 7. Cold starts and bundle size

### 7.1 Server

| Item | Today | Change | Measure |
|---|---|---|---|
| Prisma engine | Rust engine; two binary targets, `native` + `linux-musl-openssl-3.0.x` (`prisma/schema.prisma:4`, a leftover from Docker/Amplify) | Drop the musl target now. On the dev project, try `engineType = "client"` + `@prisma/adapter-pg` (Rust-free) and compare the cold-start init duration | Vercel function logs (init duration); Sentry span `cold_start` |
| Heavy SDKs in hot routes | `@sentry/nextjs` loaded through both loggers; `dodopayments` in billing; `chess.js` in `analysis` | Hot R1/R2/W routes import only `lib/prisma`, `lib/auth/viewer`, `zod` and the route wrapper. `dodopayments` only in `app/api/{checkout,subscription,billing,webhook}/**`; `@anthropic-ai/sdk` only in `app/api/coach/**` (and the worker); `chess.js` in coach (move checks) and admin. The review route needs none of them (packed payload) | An import-boundary lint (`no-restricted-imports` by path glob) |
| Region and Fluid | Default region; Fluid state unverified | `"regions": ["iad1"]`; confirm Fluid is on | Check the region in `vercel inspect` |
| Middleware | 143 kB, and it runs on `/api/*` and `/monitoring` | Tighter matcher (§4.2); no extra imports | Edge requests and middleware invocations |
| Sentry server init | `tracesSampleRate: 1`, `enableLogs: true` (`sentry.server.config.ts:13,16`) | `tracesSampler` (§9.2); logs at warn and above in production | Sentry quota |
| Neon wake | 300–800 ms on the first query after 5 idle minutes | `connect_timeout=15` + one retry for GETs (§3.1). **No warm-up crons**: a ping every 4 minutes would cost ≈ 180 CU-h a month, more than the whole Free allowance. On Launch, set scale-to-zero off for prod (OD-2) | `db.wake` span |
| Cold-start tagging | — | A module-level `let warm = false` flips on the first request; `Server-Timing: cold;desc="1"`; a Sentry tag | §9.1 |

### 7.2 Client

| Change | Files (current) | Expected effect |
|---|---|---|
| Route groups `(marketing)`, `(auth)`, `(onboarding)`, `(app)`, `(admin)`. The marketing layout has **no ClerkProvider, no UserSync and no Replay**. The marketing nav is static, and a tiny client island reads Clerk's non-HttpOnly `__client_uat` cookie (it is `> 0` when signed in) to switch "Sign in / Start free trial" to "Open app". That keeps marketing pages ISR-cacheable and stops clerk-js (≈ 90 KB) loading there | `app/layout.tsx:155-163`, `app/components/ThemeAwareClerkProvider.tsx` | Marketing ≤ 180 kB; LCP −300–600 ms on mobile (est.) |
| Telemetry. PostHog is a dynamic import after consent and `requestIdleCallback` (`opt_out_capturing_by_default` until `V3CookieConsent`). Sentry client: errors + `browserTracingIntegration` at 0.1; Replay lazy-loaded (`lazyLoadIntegration`) and on-error only; `sendDefaultPii: false`. Delete GA. Keep Speed Insights and drop Vercel Web Analytics (PostHog covers product analytics) | `instrumentation-client.ts:8-48`, `app/components/GoogleAnalytics.tsx`, `app/layout.tsx:156-158` | −105 kB from the shared bundle (Q §3.5); 2 fewer beacons per page |
| Engine. `EngineProvider` singleton created on first use; `useBotMove` takes the engine as an argument (no own worker); content-hashed WASM on R2 (§5.3); `<link rel="prefetch">` when the Bot tab, Practice or the Review engine panel opens. Not loaded for PvP, spectating, puzzles, the Bank, the coach or Weakness | `lib/hooks/useStockfish.ts:102`, `lib/hooks/useBotMove.ts:50-51`, `lib/hooks/usePlayFromPosition.ts:118-125`, `app/game/[gameId]/GamePageContent.tsx:126` | −7.3 MB per PvP game page; no `legalMoves[0]` fallback (CL §9) |
| `next/dynamic` for things shown rarely: `GameEndEffects` (imported by every board, `app/components/ChessBoard.tsx:5`), `AnalysisShareModal`, `ShareLinkModal`, `PromotionPopup`, `MembershipModal`, `ChessComConnectModal`, `IOSInstallModal`, `TwitterShareBanner`, the Practice panel, the coach sheet (SSE + markdown), the command palette (⌘K), the keyboard-shortcut sheet | CL §10.3 | −20–60 kB per board route (est.) |
| `motion`: `LazyMotion features={domAnimation}` + `m.*`, and CSS transitions for the simple design-system motion (button sweep, fades). `experimental.optimizePackageImports: ["motion", "lucide-react"]` | 52 importing files (CL §10.2) | −20–30 kB shared (est.) |
| `socket.io-client` (14.7 kB) only inside `RealtimeProvider` in `(app)`, a dynamic import after the first paint (immediate on `/game`); `transports: ['websocket','polling']` | `GamePageContent.tsx:393`, `lib/hooks/useTournamentLobby.ts:120` | No socket code on marketing; 2–3 fewer handshake round trips |
| Fonts: woff2 from the `geist` package, `display: 'swap'`, `adjustFontFallback`; preload only Geist Sans; Geist Mono and Instrument Serif with `preload: false` (Instrument Serif only on marketing) | `app/layout.tsx:16-31` (WOFF, never applied: Q PERF-01) | −134 KB of unused preloads; correct typeface |
| Images: one SVG piece sprite; `unoptimized` for Clerk and Chess.com avatars (their CDNs already size them); `images.remotePatterns` allowlist (`img.clerk.com`, `images.chesscomfiles.com`, the R2 media host, the Lichess avatar host); footer directory badges `loading="lazy"` and `fetchPriority="low"`, or moved to `/press` | `ChessBoard.tsx:576-606`, `next.config.js:72-79`, `DirectoryBadges.tsx:476-482`, `Footer.tsx:222` | No per-piece optimizer calls; 46 fewer preloads per page; the open-proxy hole closed |
| Sounds: Web Audio buffers fetched on the first gesture, `immutable` on R2 | `lib/hooks/useChessSound.ts:39-51` | No 10 audio downloads at mount |
| Dead code removed: `PWAUpdateBanner` (until rewired), `Testimonials`, `ColorSelector`, `DifficultySelector`, `QueueTimeout`, the `isDemo` branches | CL §10.3 | Smaller build |
| The persisted catalogue store is removed. `chess-data-store` is rehydrated with `JSON.parse` on **every** page through the `lib/stores` barrel (CL §15) | `lib/stores/index.ts:4`, `useDataStore.ts` | No ≈ 0.27 MB parse per page (est.) |

---

## 8. Rate limiting and abuse protection on free tiers

### 8.1 Layers

1. **Vercel Firewall (WAF)**: IP-level limits on broad paths, plus attack challenge mode during an incident. Check how many custom and rate-limit rules Hobby allows; the rules below are ordered by value in case only a few are available.
2. **Route wrapper → fixed-window limiter** (`rate_limit_buckets`, one statement): per-user limits on **expensive** actions only (LLM, third-party calls, job creation, checkout).
3. **In-memory soft limits** per function instance, for cheap writes (best effort; not shared across instances).
4. **Socket server in-memory buckets** per socket and per IP (a single instance per environment, so these are exact).
5. **Outbound politeness** on the worker: serial queues and back-off for Chess.com and Lichess.
6. **Cost caps** on the LLM.

### 8.2 Limits by endpoint

| Endpoint / surface | Key | Limit | Store | Response |
|---|---|---|---|---|
| `/api/*` (WAF rule 1) | IP | 300 requests / 60 s, fixed window | WAF | 429 |
| `/monitoring` (Sentry tunnel) and `/ingest/*` (WAF rule 2) | IP | 60 / 60 s | WAF | 429 (dropped telemetry is fine) |
| `/api/internal/*` (WAF rule 3) | source IP | **deny** unless the source is 132.226.190.10, 80.225.200.210 or the new worker's IP; the route also checks the timing-safe `x-internal-token` | WAF + route | 403 |
| `/sign-in`, `/sign-up` | IP | Clerk bot protection; WAF challenge on bursts | Clerk / WAF | challenge |
| `POST /api/coach/messages` | user | burst 5 / 60 s (burst store); member 30 / day and 150 / month, trial 10 / day and 40 / trial; cost ≤ $1.50 / month (member), $0.40 / trial (`CT/limits.ts`, architecture CR-33) | fixed-window burst + `coach_usage_days` / `coach_spend_days` | 429 `rate_limited` (burst) or `fair_use_limit` (quota) with `retryAfterSec` |
| Coach, global | — | daily spend cap (start at $10 a day; raise with members); Anthropic Console workspace spend limit | `coach_usage_days` total + an env/Edge Config kill switch | 503 `upstream_unavailable` + `fallback: "engine"` (`V3CoachError`) |
| `POST /api/accounts/chesscom/lookup` (onboarding preview) | user | 10 / min, 50 / day; results cached 10 min per lower-cased handle | bucket + data cache | 429 (`V3OnbLink rate_limited`) |
| `POST /api/import/:provider` (manual sync) | account | 1 per 15 min, 6 per day; first import ≤ 2,000 games | `linked_accounts.lastSyncAt` check + bucket | 409 `conflict` (already syncing) / 429 (`V4SettingsConnected rate_limited`) |
| `POST /api/review/:ref/analyse` and `/retry` | user | 10 / h | bucket | 429 |
| `POST /api/games` | user | 20 / 10 min | bucket | 429 |
| `POST /api/train/sessions` | user | 30 / h (inv-rct-b W2) | bucket | 429 |
| `POST /api/train/attempts` | user | 120 / min | in-memory soft limit + `clientAttemptId` idempotency | 429 |
| `POST /api/checkout` | user | 10 / h | bucket | 429 |
| `POST /api/billing/refresh`, `/api/me?refresh=billing` | user | 6 / 10 min | bucket | 429; serve the stored entitlement |
| `PATCH /api/me/*` | user | 60 / min | in-memory soft limit | 429 |
| `POST /api/contact`, `/api/feedback`, `/api/train/reports` | user or IP | 5 / h | bucket | 429 |
| `POST /api/me/export` | user | 1 / day | bucket | 429 |
| `/_next/image` | — | `remotePatterns` allowlist (no open proxy) | config | 400 |
| Socket handshake | IP | ≤ 20 open sockets per IP; ≤ 10 handshakes per IP per minute | in-memory | `connect_error {message:'rate_limited'}` |
| Socket commands | socket | 20 events/s burst, 10/s sustained for all commands, plus per-command limits (P2 §7.4.8: `game:move`, `game:join`, `draw:offer` by cooldown, `rematch:*` 3 per game, `clock:ping` 1/s); handshakes per user ≤ 20 a minute | in-memory | ack `{ok:false, code:"rate_limited", retryAfterMs}`; a sustained flood disconnects |
| Worker `/engine/analyse` | caller | callable only from Vercel (token); per-user limit enforced by the coach (≤ 3 per message, ≤ 60 per day) | route | 429 |

### 8.3 The fixed-window limiter (P1-09; one round trip, race-free)

```sql
-- burst store: CREATE UNLOGGED TABLE rate_limit_buckets (key text PRIMARY KEY, count int NOT NULL, "resetAt" timestamp(3) NOT NULL);
-- $1 key (e.g. 'rl:coach-burst:u:<ref>'), $2 windowSec, $now from ctx.now
INSERT INTO rate_limit_buckets AS b (key, count, "resetAt") VALUES ($1, 1, $now + make_interval(secs => $2))
ON CONFLICT (key) DO UPDATE SET
  count     = CASE WHEN b."resetAt" <= $now THEN 1 ELSE b.count + 1 END,
  "resetAt" = CASE WHEN b."resetAt" <= $now THEN EXCLUDED."resetAt" ELSE b."resetAt" END
RETURNING count, "resetAt";
-- count > limit → 429 rate_limited, retryAfterSec = ceil(resetAt − now)
```

- **Which limits may live in the UNLOGGED table:** only windows of **60 s or less** (bursts). Neon empties unlogged tables whenever the compute restarts or scales to zero, which happens after any 5-minute pause; that is harmless for a 60-second window and fatal for an hour- or day-long one (api-perf AP-11).
- **Which may not:** contact (5/h), reports (20/day), share creation (20/day), legend retry (3/h per game), review batches, avatar uploads, exports, invoices, push tests, the weakness recompute (1 per 600 s), the session limit (30/h), the daily puzzle fair use, the Resend daily budget and every coach budget. These are **durable**: counted from the route's own source rows in a statement it runs anyway (for example `SELECT count(*) FROM reports WHERE "reporterId" = $u AND "createdAt" > $now - interval '1 day'` on `reports_reporterId_createdAt_idx`), or kept in the LOGGED `rate_limit_windows` with the same statement. The coach caps live in `coach_usage_days`/`coach_spend_days`; the email budget is counted from `notifications` (feasibility F-NEON-3).
- The limiter spec carries `store: "burst" | "durable"`; a `windowSec > 300` with `burst` throws at module load.
- Cost: 1 statement, ≈ 1–2 ms in `iad1`. It runs **in parallel** with the route's first read, so it adds no round trip on the critical path. `HOUSEKEEPING` deletes expired rows.

### 8.4 Outbound politeness and circuit breakers

| Service | Rule | Breaker |
|---|---|---|
| Chess.com PubAPI | **One request in flight** per worker; `User-Agent: ReplayChess/1.0 (+https://playchess.tech; hello@playchess.tech)`; `If-None-Match` / `If-Modified-Since` with the stored `archiveEtags`; only the current month and new months are fetched; 5 s timeout; 3 retries with back-off | A 429 pauses the host for 60 s; 5 consecutive failures pause it for 10 min and mark the account sync `rate_limited` |
| Lichess API | **One request at a time globally** (Lichess's rule); ndjson streaming with `since`; OAuth token when linked (higher game-stream rate); a 429 means wait at least 60 s | Same |
| Dodo | SDK with an 8 s timeout; never in R/W classes | 5 failures/min opens the breaker for 60 s, and the stored entitlement is served (the resilience in `app/api/subscription/route.ts:139-142` is kept) |
| Anthropic | Streaming with a 20 s idle timeout; the SDK's default retries apply before the first byte, never after | 429/529 → engine fallback in the UI; alert when the rate exceeds 2 % |
| Clerk Backend API | Webhooks and admin only | — |

### 8.5 Abuse cases particular to this app

| Case | Guard |
|---|---|
| Forged game results feeding Mistake Bank and Weakness data | Result routes are internal only (API F-02); bot games are validated by replay (WS §17.11); bot games are excluded from rated stats |
| Trial farming | One trial per person (Phase 0), card required, `trialOfferedAt` compare-and-set (DB §8.7) |
| Handle squatting or importing someone else's games | Uniqueness on `(userId, provider)`; optional profile-field verification; Lichess OAuth (API F-27) |
| Quota burn through the open image optimizer, the Sentry tunnel or PostHog | §8.2 rows |
| Enumeration | Remove `/api/user/email/[email]` and `/api/user/[referenceId]` (API F-03); inactive users get 404 |
| Load tests against prod | `PERF_AUTH_BYPASS` honoured only when `VERCEL_ENV !== 'production'` **and** with an `x-perf-token` header (API F-11); k6 runs only against dev (§9.6) |

---

## 9. Observability

### 9.1 `Server-Timing` and request IDs (in the route wrapper)

Every API response and every dynamic page carries:

```
Server-Timing: auth;dur=1.1, rl;dur=0.0, db;dur=6.3;desc="q=4 rt=2", ext;dur=0.0, cache;desc="data-hit", app;dur=1.9, total;dur=9.6, cold;desc="0"
x-request-id: 5f1c…                      (the Sentry trace id; also in the error envelope as requestId)
```

- `db` sums the durations from a Prisma client extension (`$allOperations`, Appendix A.2) and counts statements (`q`) and **sequential round trips** (`rt`, increased when a query starts while no other query is in flight, so a `Promise.all` batch counts as one). `ext` covers Dodo, Chess.com, Anthropic (until the first byte) and worker calls.
- Collected in an `AsyncLocalStorage` store per request (safe under Fluid concurrency).
- Public cached responses keep the origin's `total`, and the CDN adds `x-vercel-cache`.
- The k6 scripts read `Server-Timing` into custom trends (`server_total`, `server_db`, `server_rt`), so server time is separated from the runner's network (§9.6).

### 9.2 Sentry (errors, traces, metrics)

| Item | Setting |
|---|---|
| Errors | 100 %; `logger.error` calls `Sentry.captureException(err, { extra })` (API F-05 fix) |
| `tracesSampler` (server and edge) | 1.0: `/api/checkout`, `/api/webhook/*`, `/api/billing/*`, `/api/subscription/*`. 0.5: `/api/coach/messages*`. 0.1: `/api/review/*`, `/api/train/*`, `/api/home`, `/api/me`, `/api/games*`. 0.05: `/api/internal/*`. **0**: `/api/health`, `/api/catalog/*`, `/monitoring`, static. Default 0.1 |
| Client | `tracesSampleRate` 0.1 (0.2 on `/game` and `/review`); Replay on error only, lazy; `sendDefaultPii: false`; `Sentry.setUser({ id: viewer.referenceId })` with no email |
| Socket and worker | 10 % of events; per-game `continueTrace` removed (WS F-40) |
| DB spans | `Sentry.prismaIntegration()` (with `@prisma/instrumentation`), so slow queries show up inside the route span |
| Span attributes | `route.class`, `cache.tier`, `db.statements`, `db.round_trips`, `cold_start`, `user.ref` |
| Server metrics (`Sentry.metrics`, already used in `lib/metrics.ts`) | `api.duration{route,class}` (distribution), `api.status{route,code}`, `db.round_trips{route}`, `ext.duration{service}`, `cache.hit{tier}`, `rate_limited{bucket}`, `coach.first_token_ms`, `coach.cost_micro_usd`, `coach.cache_read_ratio` |
| Remove | `trackApiResponseTime` (a metric per client call, `lib/metrics.ts:7-12`); `enableLogs` on hot paths; `logger.info` on `game-by-ref` (Q PERF-08) |

### 9.3 Field performance: server truth first, then anonymous client metrics

PostHog is **not loaded before analytics consent**, and consent defaults to deny (P11 D6). SLOs therefore never depend on PostHog (api-perf AP-15):

1. **Server-side truth** (always on, no consent needed, no personal data):
   - review-ready: `worker.review_ready_ms{band}` and `game_analyses."readyMs"` (§2.6);
   - coach first sentence: `coach_messages."firstSentenceMs"` and the route's span stages (§2.7);
   - move ack: the socket's receive → emit time (`ws.move_latency_ms`) plus the client RTT reported by `clock:ping` in socket metrics;
   - API time: `api.duration_ms{route}`, `api.mw_lag_ms`, `webhook.handle_ms`.
2. **Client-observed numbers** (the in-browser part of first-badge time, board interaction marks `rc:move-input→render`, `rc:review-step`, `rc:puzzle-verdict`, `rc:card-next`, `rc:clock-frame`) go through **Sentry metrics** with only `{route_class, device_class}` attributes and no user id, if the owner treats anonymous performance metrics as necessary (architecture D11). Without that decision, the SLOs rely on (1) only. The same marks are asserted in Playwright (§9.7).
3. **Speed Insights**: `<SpeedInsights sampleRate={0.2} />` on Hobby (10,000 events per 30 days, team-wide, at ≈ 100 DAU × 5 views would stop mid-month at 1.0); **PostHog web vitals are the primary field source** once consented. Pro pricing for Speed Insights is [V13].
4. **PostHog keeps funnels**, not SLOs: `perf_*` events below are still captured after consent for product analysis.

| Event (after consent) | Properties | Sampling |
|---|---|---|
| `perf_review_ready` | `ms_first_badge`, `ms_all_badges`, `ms_complete`, `plies`, `queue_wait_ms`, `cache_hit_rate`, `lanes`, `source` | 100 % |
| `perf_coach_first_token` | `ms_meta`, `ms_first_sentence`, `ms_total`, `tool_calls`, `cache_read_tokens > 0`, `region` | 100 % |
| `perf_socket_connect` | `ms_to_join_ack`, `transport`, `reconnect` | 10 % |
| `perf_interaction` | the custom marks, p95 per session | 5 % |
| `perf_nav` | `route`, `ms_rsc` | 10 % |

### 9.4 Platform quota dashboard (weekly, `ops-weekly.yml`, from P1)

| Source | How | Alert |
|---|---|---|
| Vercel | Usage API: invocations, **CDN requests**, active CPU, provisioned memory, FDT and FOT, **image transformations**, **Speed Insights events**, **Edge Config reads** | 70 % of any allowance at the pro-rata point; **60 % on `replay-chess-dev` stops deployed test traffic** (nightly dev-URL runs, k6) until the cycle resets, because 100 % pauses the feature for up to 30 days |
| Neon | Consumption API for **both** projects (production and `replay-chess-dev`): `compute_time_seconds`, `active_time_seconds`, storage, data transfer | CU-h > **50 %** pro-rata opens an issue; storage > 70 % |
| Neon queries | `pg_stat_statements` top 20 by `total_exec_time` and by `calls` (exported daily by `HOUSEKEEPING`, because Neon resets it on restart) | A new entry in the top 5 |
| Anthropic | Usage and cost reports or the Console | Daily spend > 80 % of the breaker |
| Sentry / PostHog | Their quota pages | 80 % |
| R2 | bucket sizes | > 7 GB total; backups > 6 GB |
| OCI | CPU p95 per instance (idle-reclamation risk, WS F-17), boot volume usage | CPU p95 < 20 % for 5 days on a box with no PAYG upgrade |

### 9.5 Worker and socket metrics

- **Worker:**
  - `worker.queue.depth{priority}`, `worker.queue.oldest_age_ms{priority}`
  - `worker.games_per_hour`, `worker.nps{lane}`, `worker.stage_ms{claim,pass1,pass2,llm,write}`
  - `worker.cache.hit{E1,E2,E3,E4}`, `worker.cache.size_bytes`
  - `worker.outbound{host,status}`, `worker.db.rtt_ms`
  - `worker.kick.received`, `worker.drain.loops`
- **Socket:** the WS §20 list, notably `ws.loop_lag_ms`, `ws.move_latency_ms`, `ws.outbox.oldest_ms`, `ws.persist.fail{route,code}`, `ws.sockets`, `ws.restore{result}`, `ws.rate_limited{cmd}`.
- Both expose `/internal/metrics` (token) and push to Sentry metrics every 60 s.

### 9.6 Load tests (k6), run against **dev only**

- **Target sizing.** Peak expected load is 300 members with 10 % active at once ⇒ ≈ 30 users ⇒ ≈ 3 RPS of API traffic. The design target is **10× peak**: 30 RPS of API traffic and 2,000 sockets.
- **Users.** Auth uses the Clerk dev users from `.env.test` (provisioned by `e2e/scripts/provision-test-users.ts`), never the perf bypass on prod.
- **Retire the stale perf infrastructure.** `perf/README.md`, `perf/*.sh` (EC2 t3.medium, Neon `royal-math-49660639`, `chess-battle-perf.vercel.app`) describe the old platform. The dev environment (`replay-chess-dev`, OCI dev, Neon dev in its own project) replaces them.

| Scenario (`perf/k6/src/scenarios/`) | Load | Duration | Thresholds | Quota cost per run (est.) |
|---|---|---|---|---|
| `api-read-mix.ts` (**new**): `/api/me` 30 %, `/api/home` 25 %, `/api/games?cursor` 15 %, `/api/train/today` 15 %, `/api/review/:ref` 15 % (half with `If-None-Match`) | constant-arrival-rate **30 RPS** | 5 min | `server_total{class:R1}` p95 < 100 ms, `{class:R2}` p95 < 160 ms; `server_rt` max ≤ 3; 304 share ≥ 45 % on review; errors < 0.5 % | ≈ 9k invocations |
| `train-session.ts` (**new**): create a session, then 10 attempts with 3–6 s think time; 20 % sent as a batch of 5 | 20 VUs | 5 min | W1 p95 < 150 ms; W2 p95 < 250 ms; duplicates rejected idempotently | ≈ 1.5k |
| `catalog-cdn.ts` (**new**): `/api/catalog/*?v=`, `/legends`, `/openings/b`, `/openings/[ref]` | 100 RPS | 2 min | `x-vercel-cache` HIT ≥ 95 %; TTFB p95 < 150 ms | ≈ 12k edge requests, ≈ 0 invocations |
| `coach-sse.ts` (**new**): with `COACH_FAKE_LLM=1` on dev (the server streams canned tokens at 50 tok/s after 800 ms) | 10 concurrent streams | 3 min | `ack` p95 < 120 ms server; frames not buffered (first token arrives ≤ 900 ms); clean abort | ≈ 1k |
| `coach-real.ts` (**new**, approved budget ≤ $1): 20 real messages on 2 games | sequential | — | first token p50 ≤ 1.5 s; cache-read tokens > 0 from the second message | ≈ $0.20 |
| `ws-ramp.ts` (existing) on the dev OCI box | 250 → 2,000 sockets, 1 move per 5 s per game | 15 min | `ws_move_duration` p95 < RTT + 50 ms; loop lag p99 < 20 ms (from `/internal/metrics`); RSS < 1 GB | internal checkpoints ≈ 2.4k invocations |
| `boot-cold.ts` (**new**): 50 VUs boot after 10 idle minutes (Neon asleep, cold instances) | 50 VUs × 1 iteration | — | first-request p99 ≤ 2.5 s | ≈ 100 |
| `perf/analysis/enqueue.ts` (script, not k6): enqueue 50 fixture games at `JOB_PRIORITY.BACKLOG` plus 5 "live" games at `JOB_PRIORITY.GAME_ENDED` | — | — | `GAME_ENDED` review-ready p95 ≤ 1.3 × idle (§2.6); games/hour recorded | ≈ 60 |
| `import-sim.ts` (script): the worker importer against a **local mock** Chess.com server serving recorded fixtures (never the real API) | 2,000 games | — | ≥ 600 games/min ingested; ≤ 12 DB round trips | 0 |

Cadence: before each phase release, run manually from GitHub Actions (`workflow_dispatch`). Results go in `perf/README.md` next to the commit SHA. A full run costs ≈ 30k invocations, ≈ 3 % of a Hobby month, so it is not run on every PR.

### 9.7 CI gates

| Gate | Tool | Fails when |
|---|---|---|
| Bundle budgets | `scripts/check-bundle-budgets.mjs` on the `next build` output | any bucket in §5.7 is over budget |
| Payload budgets | `packages/contracts/*.size.test.ts` | §5.1 / §5.4 budgets are exceeded |
| Lighthouse CI (mobile) | `/`, `/pricing`, `/openings/a`, `/legends` on the preview deployment | the §2.3 lab budgets are missed |
| Playwright perf smoke | Desktop and Android projects; on `/game` (vs bot) and `/review` fixtures, measure `rc:move-input→render` ≤ 50 ms headless; no long task > 50 ms after hydration; the board box stays inside the viewport at 80–150 % zoom (plan Phase 10); hot routes keep `Server-Timing rt` within their class limit | any assertion |
| Query plans | `scripts/explain-hot-queries.ts` (§3.5.4), weekly and on migration PRs | a `Seq Scan` on a hot table, or a time limit exceeded |
| Migration drift | `prisma migrate diff --exit-code` (DB §4.3) | drift |

**Revision 2 gates** (api-perf §5; each runs in the existing P1 `ci.yml` jobs and fails the PR):

| Gate | Catches | How |
|---|---|---|
| Registry cache-tier lint | cross-user leaks (AP-03, AP-04) | a test walks `@repo/contracts/registry`: `public-*` only with `auth: "public"`; per-user routes may use only `private-etag`, `no-store` or `sse`; any `max-age > 0` on a non-public route fails |
| Index existence + plans | name drift (AP-07) | `scripts/explain-hot-queries.ts` parses every phase spec's index table (or a generated `docs/indexes.json`), asserts each name exists in `pg_indexes` after `migrate deploy` on the CI database, then `EXPLAIN`s each listed query and fails on a Seq Scan or Sort over `game_players`, `training_cards` or `training_attempts` |
| Name registry | drift in rooms and priorities | `CT/socket/registry.ts`, `CT/socket/rooms.ts` and `DB/src/jobs.ts` are the only sources; ESLint bans string literals matching `/^(user|game|spectate|tournament):/` and `priority:\s*\d` elsewhere |
| GET purity | GETs that write or enqueue (AP-09, AP-31) | the Prisma timing extension counts write statements per request; in dev and test a GET that runs `INSERT`/`UPDATE`/`DELETE` throws unless its registry entry declares `sideEffects: ["daily_plan" \| "legend_facts" \| "kick_cas"]` |
| Timer audit | Neon wake leaks (AP-08) | boot the worker with a fake clock and a mocked DB for 24 simulated idle hours; assert ≤ 5 DB round trips |
| Bundle | zod and TanStack in the wrong chunks (AP-12, AP-48) | `check-bundle-budgets.mjs` **blocking from P1**; `ZodError` and `@tanstack/query-core` absent from marketing chunks |
| Socket frame size | payload creep (AP-16) | `size.test.ts` with realistic fixtures (25-char ref, real clocks, the longest legend prefix) |
| Abort on the deployed dev URL | `supportsCancellation` missing (AP-02) | Playwright after each dev deploy: abort after the first sentence → `ABORTED` row within 2 s |
| Shared-device cache | AP-04, AP-34 | Playwright: user A opens a review, a PGN and an invoice, signs out; user B signs in in the same context and requests the same URLs; every response comes from the network (`fromServiceWorker() === false`, a server log line exists) and returns 404 for B |
| Neon budget | AP-01, AP-08 | the weekly ops workflow fails and opens an issue when CU-h exceed 50 % pro-rata |

### 9.8 Alerts

| Alert | Condition | Channel |
|---|---|---|
| R1 latency | `api.duration{class:R1}` p95 > 200 ms for 15 min | Sentry → email |
| 5xx | > 1 % over 15 min on any class | Sentry |
| Review pipeline | `worker.queue.oldest_age_ms{band:game_ended}` > 60 s; or `worker.review_ready_ms` p95 > 30 s daily | Sentry |
| Coach | first verified sentence p95 > 4 s (1 h, from `firstSentenceMs`); upstream error rate > 2 %; daily spend > 80 % of the breaker | Sentry |
| Socket | `ws.outbox.oldest_ms` > 60 s; loop lag p99 > 100 ms for 5 min; `ws.persist.fail` (excluding `ws.persist.reconnect`) > 0 for 5 min | Sentry |
| Quotas | §9.4 thresholds | weekly report email |
| Uptime | `/api/health` (**no DB call**: version, region, cold flag), socket `/ready`, worker `/ready`, every 5 min. The DB probe (`SELECT 1` with its latency) is only at `/api/health?deep=1` (token), for manual checks. A DB ping every few minutes would keep Neon awake around the clock (≈ 180 CU-h a month, §3.9) | free uptime monitor (Sentry Uptime or UptimeRobot) |

---

## 10. Prioritised backlog, mapped to phases

Effort: **S** ≤ ½ day, **M** 1–3 days, **L** a week or more. "Metric" is the measurement that closes the item; §9 says where it comes from. The security P0 items in the audits (API §8 steps 1–2, WS §19 P0, Q §10.6) come first and are not repeated here, except where they are also performance work.

**Phase numbering (revision 2).** The headings below keep revision 1's 10-phase names so backlog IDs (OPT-nn) stay stable. Read them through the crosswalk: "Phase 1" → P1; "Phase 2" → P2 (matchmaking items → P9, arena → P12); "Phase 3" → P3; "Phase 4" → P4; "Phase 5" → P5 (notifications → P10); "Phase 6" → P6; "Phase 7" → P7; "Phase 8" → P8 Learn + P9 Play hub + P12 tournaments and admin; "Phase 9" → P10 account area + P11 public, auth, system and PWA; "Phase 10" → the DoD rules in every phase + P13. **Moved earlier by revision 2:** the dev Neon project split, the interim production backup, the weekly quota report and the blocking bundle budget all land in **P1**; HMAC internal auth in **P2**.

### P0: now, on `dev`, before Phase 1 merges (≈ 3–4 days in total)

| ID | Work | Files / anchors | Effort | Metric | Depends |
|---|---|---|---|---|---|
| OPT-01 | Sentry: `tracesSampler` (§9.2), `sendDefaultPii: false`, logs at warn and above in production; exclude `monitoring` from the middleware matcher | `instrumentation-client.ts:17,19,31`; `sentry.server.config.ts:13,16,20`; `sentry.edge.config.ts:14,21`; `middleware.ts:44` | S | Traced transactions per day −90 %; `/monitoring` invocations −90 % | — |
| OPT-02 | Pin `"regions": ["iad1"]`; confirm Fluid compute is on; confirm which `vercel.json` the project reads | `vercel.json` (repo root) | S | `vercel inspect` shows `iad1` | — |
| OPT-03 | `DATABASE_URL` parameters (`connection_limit=5&pool_timeout=15&connect_timeout=15`); the `replay_app` role with timeouts, and `replay_worker` (DB §5.4) | Vercel env; Neon SQL | S | No P2024 errors; queries over 15 s are killed | owner OK for role creation |
| OPT-04 | Stop writes on reads: `/api/user/sync` skips the update when nothing changed; `/api/subscription` reads the DB first, calls Dodo only with `?refresh=1`, and writes only when the snapshot differs | `app/api/user/sync/route.ts:71-84`; `app/api/subscription/route.ts:89-137`; `lib/billing/entitlement.ts:99` | M | Writes per boot 2 → 0; Dodo calls per boot 1–2 → 0 | — |
| OPT-05 | Stopgaps until the socket queue ships: matchmaking poll 1 s → 3 s with back-off; `searchingSince` no longer reset on every poll | `lib/hooks/useMatchmaking.ts:30,119`; `app/api/tournament/find-match/route.ts:105` | S | Invocations per searching minute 60 → 20 | — |
| OPT-06 | Socket API client: `AbortSignal.timeout(8000)`, a keep-alive undici `Agent`, retries with back-off; `maxDuration = 10` on the internal routes | `ws:utils/apiClient.ts:36-189`; `app/api/chess/{move,game-over,game-state}/route.ts` | S | No 300 s hangs (WS §6.3); internal p95 tracked | — |
| OPT-07 | `maxDuration` on every route by class (§6.3) | `app/api/**/route.ts` | S | No function runs past its class cap | — |
| OPT-08 | Service worker: `/api/*` and `(app)` HTML NetworkOnly; drop the 293-chunk precache; clear caches at sign-out | `next.config.js:13-35`; `UserSync.tsx:69-91` | S | Edge requests per deploy per installed user ≈ 300 → ≈ 20; no cross-user API cache | — |
| OPT-09 | `images.remotePatterns` allowlist; `unoptimized` avatars | `next.config.js:72-79` | S | Image-optimization usage stays flat | — |
| OPT-10 | Dev and E2E in a **separate Neon project** (DB-01); a perf branch there | Vercel env for `replay-chess-dev`; `.env.development.local`; `.env.test` | M | Prod CU-h spent only by prod | owner (account work) |
| OPT-11 | `CREATE EXTENSION pg_stat_statements` on dev and prod | Neon SQL | S | Weekly top-20 report exists | — |
| OPT-12 | Health check without a DB call (`/api/health`), with the deep probe behind a token | `app/api/healthcheck/route.ts` → `app/api/health/route.ts` | S | Uptime pings cause no Neon activity | — |

### Phase 1: design system and app shell

| ID | Work | Files / anchors | Effort | Metric | Depends |
|---|---|---|---|---|---|
| OPT-13 | Route groups `(marketing)`, `(auth)`, `(onboarding)`, `(app)`, `(admin)`. A lean marketing layout (no Clerk provider, UserSync or Replay; `__client_uat` island) | `app/layout.tsx:155-163` | L | Marketing First Load ≤ 180 kB; shared ≤ 200 kB | — |
| OPT-14 | Route wrapper `lib/api/route.ts`: auth contexts, class, zod, error envelope, cache tier, `maxBodyBytes`, rate-limit hook, `Server-Timing`, `x-request-id`, ETag helpers; Prisma timing extension; lint rules (no `currentUser()` or `clerkClient()` in R/W, no bare `include: {x: true}` on User/Game, `maxDuration` required) | new `lib/api/*`, `lib/prisma.ts` | M | Every new route uses it; `Server-Timing` present | — |
| OPT-15 | Server viewer bootstrap: `getViewer()` (`cache()`), `ViewerProvider`, the socket token signed in the layout; delete `UserSync`, `useRequireAuth`, `useRequireSubscription` and the persisted stores; Clerk webhook upserts | `app/components/UserSync.tsx`; `lib/hooks/useRequireAuth.ts`; `lib/hooks/useRequireSubscription.ts`; `lib/stores/*` | L | Boot invocations 3–5 → 0 extra; TTFB-to-interactive −0.6–1.5 s (CL §3.1) | OPT-14 |
| OPT-16 | Clerk session claims `{ref, ent, role, onb}` + middleware gating with no DB; the Dodo webhook syncs `publicMetadata` | `middleware.ts:16-38`; `app/api/webhook/dodo-payments/route.ts` | M | 0 DB queries in middleware; gating correct within ~60 s of a change | OPT-15 |
| OPT-17 | TanStack Query + `lib/api/client.ts` + the key factory (§4.7); `HydrationBoundary` pattern; `staleTimes` in `next.config.js`; `V3Skeletons` `loading.tsx` per route | new `lib/api/*` | M | Client fetches on mount for prefetched screens: 0 | OPT-14 |
| OPT-18 | Fonts: woff2, `@theme` font tokens, a codemod for the 891 inline `fontFamily` styles | `app/layout.tsx:16-31`; `app/globals.css` | M | −134 KB of preloads; CLS ≤ 0.05 | — |
| OPT-19 | Telemetry: PostHog lazy after consent; Replay lazy on error; delete GA; drop Vercel Web Analytics | `instrumentation-client.ts:8-48`; `app/components/GoogleAnalytics.tsx`; `app/layout.tsx:156-157` | S | −105 kB shared | `V3CookieConsent` |
| OPT-20 | `motion` → `LazyMotion` / CSS; `optimizePackageImports`; the `next/dynamic` list (§7.2) | 52 files importing `motion`; `ChessBoard.tsx:5` | M | −40–90 kB on board routes (est.) | — |
| OPT-21 | Catalogue to ISR: `revalidate = 86400`, `generateStaticParams`, ECO-volume pages, `cache()` in layouts and pages, tag revalidation in admin writes, the sitemap no longer selects `explanation`, `/openings?q` filtered on the client | `app/legends/page.tsx:7`; `app/openings/page.tsx:9,25-43`; `app/{legends,openings}/[referenceId]/{layout,page}.tsx`; `app/sitemap-openings.xml/route.ts:9-13` | M | 0 Neon queries per crawler hit; `/openings` document ≤ 60 KB compressed | — |
| OPT-22 | `/api/catalog/{openings,legends}` versioned public JSON (`immutable`) replacing `/api/openings` (auth + 3,641 rows) and `/api/legends` (no cache) | `app/api/openings/route.ts`; `app/api/legends/route.ts`; `lib/stores/useDataStore.ts` | S | ≥ 95 % CDN HIT; per-ECO volume ≤ 14 KB | OPT-21 |
| OPT-23 | Prisma global `omit`; shared selects; `findUnique` fixes | `lib/prisma.ts`; `app/api/checkout/route.ts:83` | S | No blob columns in list queries (spot-checked with `Server-Timing`) | — |
| OPT-24 | Index migrations M1 (§3.5.2) and C1 (§3.5.1) through `migrate deploy` | `prisma/migrations/*` | S | `explain-hot-queries` passes | OD-6, owner confirmation for drops |
| OPT-25 | Bundle and payload budgets, Lighthouse CI, Speed Insights sampling | `scripts/check-bundle-budgets.mjs`; `.github/workflows/ci.yml` | M | Gates run on PRs | — |
| OPT-26 | Footer badges lazy or moved; SVG piece sprite; Web Audio sounds | `DirectoryBadges.tsx:476-482`; `Footer.tsx:222`; `ChessBoard.tsx:576-606`; `useChessSound.ts:39-51` | S | −46 preloads per page; no per-piece optimizer calls | — |

### Phase 2: the board and the live game page

| ID | Work | Files / anchors | Effort | Metric | Depends |
|---|---|---|---|---|---|
| OPT-27 | Board rendering: a CSS-grid board sized by `--board`, transform-only animation, pointer handling in refs + rAF, one `chess.js` instance, the clock in an isolated store with rAF interpolation | `app/components/ChessBoard.tsx:441-606`; `GamePageContent.tsx:55,546-555` | L | INP ≤ 100 ms; ≤ 4 ms of scripting per move on a mid-tier phone; CLS ≤ 0.02 | Phase 1 shell |
| OPT-28 | Socket protocol v2 (WS §17): snapshot on join, acks with `clientMoveId`, `move:applied` deltas, no per-second clocks, throttled spectator counts, websocket transport first, ping 10 s / 8 s | `ws:*`; `packages/game-protocol` | L | 0 `game-by-ref` fetches; socket messages per game-minute −90 % | — |
| OPT-29 | Persistence v2 (P2): direct checkpoints + the idempotent finish CTE with packed columns and the enqueue inside it; the kick in `after()`; delete `/api/chess/move`, `/game-state`, and the browser use of `game-by-ref` | `app/api/internal/live-games/*` (new); `ws:utils/apiClient.ts`; `ws:GameSession.ts:429-442` | L | Invocations per 80-ply game ≈ 88 → ≤ 10; bytes 776 KB → ≤ 4 KB; 0 lost final moves | M2 schema |
| OPT-30 | `EngineProvider` (lazy, singleton); hashed WASM on R2 with CORS; prefetch on intent | `lib/hooks/useStockfish.ts:102`; `useBotMove.ts:50-51`; `next.config.js:160-164` | M | −7.3 MB per PvP game page; engine edge requests ≈ 0 after the first download | — |
| OPT-31 | Matchmaking and arena pairing in the socket server (`queue.matched`, `tournament.paired` to `u:`); delete the polling routes | `lib/services/matchmaking/*`; `app/api/matchmaking/*`; `FindMatchButton.tsx`; `ws:TournamentManager.ts` | L | 0 HTTP calls while searching; Neon idle while users queue | OPT-28 |
| OPT-32 | Tournament snapshot + `lobby.delta` (changed rows only); the standings rank index; auto-complete moved to the socket timer | `lib/hooks/useTournamentLobby.ts:136-141`; `lib/services/tournament/tournament.service.ts:20-98,330-415` | M | 0 full refetches per lobby event | OPT-28 |
| OPT-33 | Bot games client-side on `game-core`; debounced checkpoint + `sendBeacon` on `pagehide`; replay validation on finish | WS §17.11 | M | Bot games cost ≤ 3 invocations | OPT-28 |
| OPT-34 | `POST /api/games` single service (≤ 3 round trips, `Idempotency-Key`, colours decided at creation) | `app/api/chess/create-game/route.ts`; `create-ai-game/route.ts` | M | W2 p95 ≤ 250 ms; no duplicate WAITING games | OPT-14 |

### Phase 3: server analysis and Game Review

| ID | Work | Files / anchors | Effort | Metric | Depends |
|---|---|---|---|---|---|
| OPT-35 | Prod worker on its own A1 instance (2 OCPU / 12 GB); 2 lanes; priority preemption between positions; private-VCN notify; Caddy proxy; **`stockfish bench` benchmark gate** | `deploy/oci/*`; `apps/analysis-worker` (new) | M | §2.6 targets met on the fixture game | OD-3 |
| OPT-36 | Neon HTTP data access in the worker: claim in 1 round trip, the result in 1 round-trip batch; the moves in the job payload | `apps/analysis-worker/src/db.ts` | M | 2 DB round trips per game | M2 schema |
| OPT-37 | Push wake-up + drain-until-empty + boot and daily sweep; no polling | worker; `after()` in `finish` | S | Neon active time not increased by the worker when idle | OPT-35 |
| OPT-38 | Eval cache E1/E2, the book set, and the E3 seed from the Lichess CC0 eval DB | worker | M–L | Pass-1 hit rate ≥ 25 % live, ≥ 40 % imports | OPT-35 |
| OPT-39 | Packed `ReviewDTO`, the version-probe ETag, RSC prefetch, client `staleTime` ∞ once done; `analysis:progress` deltas; PGN built on the client; lazy legend tab | `app/api/review/[ref]/route.ts` (new); `packages/contracts/review.ts` | M | Review payload ≤ 5 KB compressed; ≥ 45 % 304s on revisits; first badge ≤ 1.5 s p50 | OPT-36 |
| OPT-40 | Share: OG image rendered once per version and CDN `immutable`; the share snapshot `public-short` + purge on revoke | `app/og/*`; `app/api/share/*` | S–M | 1 render per share version | — |
| OPT-41 | Prisma Rust-free client (`engineType = "client"` + `adapter-pg`) trial on dev; drop the musl `binaryTargets` | `prisma/schema.prisma:1-5`; `lib/prisma.ts` | M | Cold start −X ms (measured); keep only if it is no slower when warm | — |
| OPT-42 | `perf_review_ready` instrumentation (worker stage timings + client receive) | worker; `features/review/*` | S | Dashboard live | OPT-39 |

### Phase 4: game import

| ID | Work | Files / anchors | Effort | Metric | Depends |
|---|---|---|---|---|---|
| OPT-43 | Import in the worker: Chess.com serial + ETag + User-Agent; Lichess ndjson stream with one global request in flight; 200-game single-statement batches; counters + `import:progress` per chunk | `lib/chess-com.ts` → worker `importers/*` | M | A 2,000-game first import is ≈ 10 DB round trips; ≥ 600 games/min ingested (mock) | M3 schema |
| OPT-44 | Analysis priorities for imports (newest 50 at 5, the rest at 8; Lichess `%eval` games skip pass 1) | worker scheduler | S | 50 games analysed ≤ 15 min after linking | OPT-35 |
| OPT-45 | Chess.com lookup: encode the handle, 5 s timeout, 10-minute cache per handle, per-user bucket | `app/api/user/chess-com-profile/preview/route.ts`; `lib/chess-com.ts:13,33` | S | ≤ 1 Chess.com call per handle per 10 min | OPT-48 |

### Phase 5: Mistake Bank and puzzles

| ID | Work | Files / anchors | Effort | Metric | Depends |
|---|---|---|---|---|---|
| OPT-46 | `GET /api/train/today` (1 + 1 batch), `training_days.plan` materialised, due count on the partial index; the next session prefetched 2 cards before the end | `app/api/train/*` (new) | M | R1 p95 ≤ 100 ms | M4 schema |
| OPT-47 | Attempts: an optimistic outbox (IndexedDB), batches of ≤ 50, `clientAttemptId` idempotency, one 4-statement transaction | `features/train/*`; `app/api/train/attempts/route.ts` | M | Perceived grade latency 0 ms; W1 p95 ≤ 150 ms | M4 |
| OPT-48 | The fixed-window limiter + `coach_usage_days` counters (needed before Phases 4 and 7) | `lib/api/rate-limit.ts` (replaces `lib/rate-limit.ts`) | S | Limits enforced across instances | OPT-14 |
| OPT-49 | Lichess puzzles as R2 shards + a manifest; only `training_cards.puzzleId` in Postgres | `scripts/build-puzzle-shards.ts`; R2 | M | Neon storage +0 MB (versus +350 MB planned) | — |

### Phase 6: Weakness Profile

| ID | Work | Files / anchors | Effort | Metric | Depends |
|---|---|---|---|---|---|
| OPT-50 | `weakness_snapshots` materialised by the worker (deduped per user per hour); PK read + ETag; baselines as a static JSON | worker `jobs/weakness.ts`; `app/api/train/weakness/route.ts` | M | R2 p95 ≤ 160 ms; recompute ≤ 2 s per member | M5 |
| OPT-51 | The version-key cache for per-user aggregates (`users.statsVersion`, `users.bankVersion`) | `lib/cache/versioned.ts`; worker transaction | S | Profile stats and bank chips ≈ 0 DB on repeat views | M2 |

### Phase 7: the AI coach

| ID | Work | Files / anchors | Effort | Metric | Depends |
|---|---|---|---|---|---|
| OPT-52 | Coach SSE route: `maxDuration = 60`, the `ack` frame within 40 ms of server time, token batching, heartbeat, `no-transform`, upstream abort, an idempotent `clientId` | `app/api/coach/messages/route.ts` (new) | M | §2.7 targets | OPT-48 |
| OPT-53 | Prompt cache layout (tools + system shared; per-game context; automatic tail); a cache-read assertion; optional `max_tokens: 0` pre-warm behind a flag | `lib/coach/prompt.ts` | S–M | Cache-read share of input tokens ≥ 70 %; first-token p50 ≤ 1.5 s | OPT-52 |
| OPT-54 | Stored key-moment explanations streamed without an LLM call | `app/api/coach/messages/route.ts` | S | Explain first byte ≤ 300 ms | OPT-39 |
| OPT-55 | Engine tools through the worker `/engine/analyse`, with prefetch on panel open and ≤ 3 calls per message | worker `routes/engine.ts`; `lib/coach/tools.ts` | M | Tool round trip p95 ≤ 1 s | OPT-38 |
| OPT-56 | Spend guards: per-user and global caps, a kill switch, cost accounting from `usage`; `COACH_FAKE_LLM` for load tests | `lib/coach/budget.ts` | S | No member over $3 a month; a daily cap alert | OPT-48 |
| OPT-57 | Hobby budget gate review (§6.4.5) | — | S | Decision recorded | 30 days of data |

### Phase 8: legends, lessons and the play hub

| ID | Work | Files / anchors | Effort | Metric | Depends |
|---|---|---|---|---|---|
| OPT-58 | Play hub data from RSC (slim legends; ECO volumes on demand) | `app/(app)/play/*` | S | 0 catalogue fetches on mount | OPT-22 |
| OPT-59 | Explanations JSON to R2 (`explanationUrl`, `hasExplanation`); narration audio `preload="metadata"` | `lib/hooks/useExplanationPlayer.ts:150-151`; `scripts/upload-media.ts` | M | Neon egress for explanations → 0 | — |
| OPT-60 | Admin APIs: cursor pagination, narrow selects, `count=only` | `app/api/admin/*` | S | No unbounded admin queries | OPT-14 |

### Phase 9: profile, settings and system screens

| ID | Work | Files / anchors | Effort | Metric | Depends |
|---|---|---|---|---|---|
| OPT-61 | Archive and profile games on the `game_players` keyset with the `INCLUDE` index; filters with `keepPreviousData`; review prefetch on hover | `app/(app)/games/*`; `app/api/games/route.ts` | M | R2 p95 ≤ 160 ms; a filter change keeps the list on screen | M2 |
| OPT-62 | Membership screen from the DB only; action responses carry the DTO (no refetch); `/checkout/return` makes one refresh + listens for `entitlement.changed`, with 3 fallback polls | `MembershipSection.tsx:142-184`; `lib/billing/client.ts:22-23,87-113` | M | ≤ 4 Dodo-backed calls per checkout return (was up to 14) | OPT-16 |
| OPT-63 | Delete account: anonymise in a worker job, not in the request | worker `jobs/anonymise.ts` | S | `DELETE /api/me` W1 ≤ 150 ms | — |
| OPT-64 | Offline: shell + offline page precache; the training outbox | §4.8 | M | `V3Offline` works with ≤ 300 KB precached | OPT-08 |

### Phase 10: continuous

| ID | Work | Effort | Metric |
|---|---|---|---|
| OPT-65 | The k6 suite against dev (§9.6); retire the EC2 perf scripts and the perf Vercel project references | M | Results committed for each phase release |
| OPT-66 | `scripts/explain-hot-queries.ts` weekly; the `pg_stat_statements` report | S | No hot-table `Seq Scan` |
| OPT-67 | Housekeeping and backup in the single maintenance window (§6.5) | S | One Neon wake per day for background work |
| OPT-68 | Alerts (§9.8) and the weekly quota report (§9.4) | S | Report email every week |
| OPT-69 | A 15-minute weekly perf review: SLO table (§2), the top 5 slow routes from Sentry, quota trends, cache hit rates; file regressions as OPT items | S | Review notes in `docs/perf-log.md` |

---

## 11. Owner decisions

| ID | Decision | Recommendation | Cost |
|---|---|---|---|
| OD-1 | Vercel **Pro** before charging customers (Hobby is non-commercial; Pro also removes the provisioned-memory risk for the coach, §6.4.1) | Yes, at go-live | ≈ $20 a month |
| OD-2 | Neon **Launch** for production, with scale-to-zero off once there are paying members (no cold-start penalty, no outage when CU-hours run out) | Yes, at go-live; dev stays on Free in its own project | ≈ $15–25 a month (DB §10.3) |
| OD-3 | A third OCI A1 instance (2 OCPU / 12 GB) for the prod analysis worker | Yes (it fits the Always Free total exactly) | $0 |
| OD-4 | Region strategy if most members are in South Asia (Neon in Singapore + Vercel `sin1`) | Decide from 30 days of geo data | migration effort |
| OD-5 | Upgrade the OCI tenancy to Pay-As-You-Go to avoid idle reclamation (the resources stay Always Free) | Yes, with a $1 budget alert | $0 expected |
| OD-6 | Change CLAUDE.md rule 1 to "`prisma migrate deploy` only on prod; `db push` only on dev or throwaway branches" (partial indexes, `INCLUDE` indexes and `NOT VALID` FKs do not survive `db push`) | Yes | — |
| OD-7 | Coach fair-use caps | **Decided in revision 2** (architecture CR-33, P7 D6): member 30 a day, 150 a month, $1.50 a month; trial 10 a day, 40 over the trial, $0.40; global breaker `max($5, $0.08 × entitled)` | — |
| OD-8 | Coach thinking mode (adaptive versus `between_tools`), decided by the A/B result | Follow the data | — |

---

## 12. Unknowns to measure before relying on this plan

| Unknown | Why it matters | How to measure | Where it feeds |
|---|---|---|---|
| Stockfish 18 NNUE nps on one A1 core | Every §2.6 number | `stockfish bench` + the fixture game on the new instance | OPT-35 |
| The exact Vercel Hobby allowances, and whether edge requests count cached static assets | §1.1 budgets | Usage tab after a week of dev traffic; the Vercel docs limits page | OPT-08, OPT-19, OD-1 |
| Whether Fluid compute is on for `replay-chess-dev`, and which `vercel.json` it reads | Concurrency and cold starts | Project settings; `vercel inspect` | OPT-02 |
| How Vercel treats `s-maxage` versus `Vercel-CDN-Cache-Control` from route handlers | The §4.2 tiers | `x-vercel-cache` checks on dev | OPT-22 |
| Real coach first-token time on Sonnet 5.5 at effort `low` with a cached prefix | The §2.7 target | `coach-real.ts` (≤ $1) | OPT-53 |
| Live production row counts and JSON sizes (DB Appendix A was blocked) | Migration timings, the backfill size | DB Appendix A queries, with owner approval | M2/B2 |
| User geography | OD-4 | Speed Insights and PostHog after 30 days | OD-4 |
| Prisma Rust-free client cold start and warm latency on Vercel | OPT-41 | A/B on the dev project | OPT-41 |

---

## Appendix A. Code sketches

### A.1 Per-request timing in the route wrapper

```ts
// lib/api/timing.ts
import { AsyncLocalStorage } from "node:async_hooks";
type T = { t0: number; db: number; q: number; rt: number; inflight: number; ext: number; auth: number; cache?: string };
export const timingStore = new AsyncLocalStorage<T>();
let warm = false;

export function startTiming(): T {
  return { t0: performance.now(), db: 0, q: 0, rt: 0, inflight: 0, ext: 0, auth: 0 };
}
export function serverTimingHeader(t: T): string {
  const total = performance.now() - t.t0;
  const cold = warm ? 0 : 1; warm = true;
  const app = Math.max(0, total - t.db - t.ext - t.auth);
  return [
    `auth;dur=${t.auth.toFixed(1)}`, `db;dur=${t.db.toFixed(1)};desc="q=${t.q} rt=${t.rt}"`,
    `ext;dur=${t.ext.toFixed(1)}`, t.cache ? `cache;desc="${t.cache}"` : "",
    `app;dur=${app.toFixed(1)}`, `total;dur=${total.toFixed(1)}`, `cold;desc="${cold}"`,
  ].filter(Boolean).join(", ");
}
// route(): const t = startTiming(); return timingStore.run(t, async () => { …handler…;
//           res.headers.set("Server-Timing", serverTimingHeader(t)); res.headers.set("x-request-id", traceId); });
```

### A.2 Prisma extension that feeds the timing

```ts
// lib/prisma.ts (wrapping the existing singleton)
export const db = prisma.$extends({
  query: {
    async $allOperations({ args, query }) {
      const t = timingStore.getStore();
      const start = performance.now();
      if (t) { if (t.inflight === 0) t.rt++; t.inflight++; }   // nothing in flight → a new sequential round trip
      try { return await query(args); }
      finally {
        if (t) { t.inflight--; t.db += performance.now() - start; t.q++; }  // db = summed query time (parallel queries overlap)
      }
    },
  },
});
```

### A.3 ETag helpers

```ts
// lib/api/etag.ts
export const etag = (...parts: (string | number | null | undefined)[]) => `"${parts.map(p => p ?? "-").join(".")}"`;   // strong (no W/): P1
export const notModified = (req: Request, tag: string) => req.headers.get("if-none-match") === tag;
// in a route: const tag = etag("r", probe.analysisVersion, probe.gradingVersion, probe.status);
//             if (notModified(req, tag)) return new Response(null, { status: 304, headers: { ETag: tag, "Cache-Control": "private, no-cache" } });
```

### A.4 Cursor codec

```ts
// lib/api/cursor.ts
import { z } from "zod";
import { ApiError } from "./errors";
const Payload = z.tuple([z.string(), z.string().regex(/^\d+$/), z.string().length(8)]); // [sortKeyIso, idString, filterHash]
export function encodeCursor(sortKey: string, id: bigint, filterHash: string) {
  return "v1." + Buffer.from(JSON.stringify([sortKey, id.toString(), filterHash])).toString("base64url");
}
export function decodeCursor(raw: string | null, filterHash: string) {
  if (!raw) return null;
  if (!raw.startsWith("v1.")) throw new ApiError("validation_failed", 400, "bad_cursor");
  const [k, id, h] = Payload.parse(JSON.parse(Buffer.from(raw.slice(3), "base64url").toString()));
  if (h !== filterHash) throw new ApiError("validation_failed", 400, "cursor_filter_mismatch");
  return { sortKey: k, id: BigInt(id) };
}
```

### A.5 Rate-limit call site

```ts
// lib/api/rate-limit.ts
export async function take(key: string, capacity: number, refillPerSec: number) {
  const [row] = await prisma.$queryRaw<{ ok: boolean; tokens: number }[]>`
    INSERT INTO rate_limits AS r (key, tokens, updated_at, ok) VALUES (${key}, ${capacity - 1}::real, now(), true)
    ON CONFLICT (key) DO UPDATE SET
      ok = LEAST(${capacity}::real, r.tokens + EXTRACT(EPOCH FROM now() - r.updated_at)::real * ${refillPerSec}::real) >= 1,
      tokens = LEAST(${capacity}::real, r.tokens + EXTRACT(EPOCH FROM now() - r.updated_at)::real * ${refillPerSec}::real)
             - CASE WHEN LEAST(${capacity}::real, r.tokens + EXTRACT(EPOCH FROM now() - r.updated_at)::real * ${refillPerSec}::real) >= 1 THEN 1 ELSE 0 END,
      updated_at = now()
    RETURNING ok, tokens`;
  return { ok: row!.ok, retryAfterSec: row!.ok ? 0 : Math.ceil((1 - row!.tokens) / refillPerSec) };
}
// in the wrapper: const [limit, data] = await Promise.all([take(`coach:burst:${viewer.id}`, 6, 0.1), loadContext()]);
//                 if (!limit.ok) throw new ApiError("rate_limited", 429, undefined, { retryAfterSec: limit.retryAfterSec });
```

### A.6 k6: reading `Server-Timing` into trends

```ts
// perf/k6/src/lib/server-timing.ts
import { Trend } from "k6/metrics";
export const serverTotal = new Trend("server_total", true);
export const serverDb = new Trend("server_db", true);
export const serverRt = new Trend("server_rt");
export function recordServerTiming(res: { headers: Record<string, string> }, tags: Record<string, string>) {
  const h = res.headers["Server-Timing"] || "";
  const dur = (name: string) => Number((h.match(new RegExp(`${name};dur=([\\d.]+)`)) || [])[1] || NaN);
  const rt = Number((h.match(/rt=(\d+)/) || [])[1] || NaN);
  if (!isNaN(dur("total"))) serverTotal.add(dur("total"), tags);
  if (!isNaN(dur("db"))) serverDb.add(dur("db"), tags);
  if (!isNaN(rt)) serverRt.add(rt, tags);
}
```

## Appendix B. Critique dispositions (revision 2)

| Finding | Disposition | Where |
|---|---|---|
| api-perf §4.5 item 1 (D2, §3.7.1: direct socket writes) | Applied | §0.2 D2, §0.3, §3.1, §3.7.1 |
| api-perf §4.5 item 2, AP-16 (P2 event names; `move:applied` ≤ 200 B, no `fen`) | Applied | §2.4, §5.4 |
| api-perf §4.5 item 3, AP-15 (server-side SLO sources; `meta` not `ack`) | Applied | §2.6, §2.7, §5.5, §9.3 |
| api-perf §4.5 item 4, AP-35 (formulas for budgets) | Applied | §2.8 |
| api-perf §4.5 item 5 (`jobs_ready_idx (priority DESC, …)`, `coach_messages (userId, clientId)`, card table names) | Applied | §3.5, §3.10 |
| api-perf §4.5 item 6 (strong ETags; no `review:<ref>` room; no re-kick from GET) | Applied | §3.6.6, §4.2, §4.9, App. A.3 |
| api-perf §4.5 item 7, AP-46 (insert before the LLM; quota read then charge) | Applied | §2.7, §3.6.8, §3.7.5 |
| api-perf §4.5 item 8, AP-26 (import CTE) | Applied | §3.7.6 |
| api-perf §4.5 item 9 (`public-short` never reads a session; `Clear-Site-Data`) | Applied | §4.2 |
| api-perf §4.5 item 10, AP-11 (fixed window, durable long windows) | Applied | §0.2 D10, §8.3 |
| api-perf §5 (CI gates) | Applied | §9.7 |
| consistency §3 rows for this file (`jobs_ready_idx` with `fairSeq`, `training_*`, strong ETags, D2 with the tournament exception, engine files under `public/workers/sf18-<hash>/` as the fallback only) | Applied | §0.2, §3.5, §4.9, §5.3 |
| feasibility 10.5 item 1 (verified Hobby numbers, the 30-day pause) | Applied | §1.1 |
| feasibility 10.5 item 2 (dev worker CPU: one choice) | Applied: `cpu.idle` slice + 0.75 cap (P3-D8); `cpus 0.5` + `nice 10` is the fallback | §0.2 D11, §6.2 |
| feasibility 10.5 item 3, F-OCI-4 (pools and Neon suspends) | Applied | §3.1, §3.7.1 |
| feasibility 10.5 item 4, F-NEON-3 (which limits may be UNLOGGED) | Applied | §8.3 |
| feasibility 10.5 item 5, F-VER-5 (Speed Insights `sampleRate={0.2}`) | Applied | §9.3 |
| feasibility 10.5 item 6, F-VER-2 (60 % stop; `ops-weekly.yml` in P1) | Applied | §1.1, §9.4 |
| feasibility 10.5 item 7 (k6 against dev counts against Hobby; once per phase) | Applied | §9.6 |
| feasibility 10.5 item 8 (crosswalk) | Applied | §10 note |
| feasibility 10.5 item 9 (same-origin engine worker shim) | Applied | §5.3 |
| testing X18 (k6 results as data) | Applied | §9.6 |
