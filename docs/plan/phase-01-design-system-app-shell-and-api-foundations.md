# Phase 1 · Design system, app shell and API foundations

Status: **final phase plan, revision 2**, 2026-11-02, branch `dev` @ `0848b76`. Revision 2 addresses every finding about this phase in the five plan critiques (coverage, consistency, feasibility, testing, API/performance); Appendix A lists each finding and what happened to it. Track 1A **is** `SP/phase1/SPEC.md` (revision 2, with its own Appendix A); this document only adds what SPEC.md leaves out. Tracks 1B (security hotfixes, API and data-layer foundation) and 1Q (shared test and ops plumbing) are specified here in full.

**How to read this document**

- Track 1A packages keep SPEC.md's ids and are written **1A·P0 … 1A·P6**. "SPEC §n" points into SPEC.md. Nothing below changes a 1A package's files, contracts or acceptance criteria, except the five requests in §13.2 that 1A·P0 and 1A·P6 have to accept. Two additions run *after* SPEC §12 integration: **1A·P7** (state completion for three boards) and **1A·DOC**.
- Track 1B packages are **1B·H** (hotfix lane, tasks H1–H12), **1B·F1 … 1B·F9** (foundations) and **1B·J** (the one join PR that touches 1A-owned files after 1A merges).
- Track 1Q packages are **1Q·1** (test and ops plumbing that touches no 1A file) and **1Q·2** (the parts that need 1A's integrated tree). 1Q is new in revision 2 (testing critique X1–X18).
- Where the inputs disagree, the binding decisions in `SP/plan/allocation.md` §2 (B1–B26) win, then the critique rulings this document adopts, then this document. Every place where architecture.md, data-model.md, api-design.md, client-data-layer.md, optimization.md or allocation.md is overridden is listed in §0.2.
- The inputs under `SP` are session scratch copies. 1A·DOC commits SPEC.md to `REPO/docs/plan/phase-01a-spec.md` so this file never points at a path that can disappear; the other phase plans live next to this file as `REPO/docs/plan/phase-NN-*.md`.

**Path shorthands**

| Short | Absolute path |
|---|---|
| `REPO` | `/Users/rohitpandit/open_source/chess-battle-turbo` |
| `WEB` | `/Users/rohitpandit/open_source/chess-battle-turbo/apps/web` (a relative path in this document is relative to `WEB` unless it starts with `REPO/`, `WS/` or `SP/`) |
| `WS` | `/Users/rohitpandit/open_source/chess-battle-turbo/apps/web-socket` |
| `SP` | the planning session's scratchpad, archived scratch inputs that are not in the repo and may no longer exist (see [99-open-decisions.md](99-open-decisions.md) A12) |
| `DR` | `SP/design-ref/project/v2` (the `.dc.html` boards) |
| `DS` | `SP/design-ref/ds/project` (design system README, tokens, component READMEs) |
| SPEC | `SP/phase1/SPEC.md` |
| ALLOC, ARCH, API, CDL, OPT, DM | `SP/plan/allocation.md`, `architecture.md`, `api-design.md`, `client-data-layer.md`, `optimization.md`, `data-model.md` |
| AA, AC, ADB, AS, AQ | `SP/plan/audit-api.md`, `audit-client.md`, `audit-db.md`, `audit-socket.md`, `audit-quality.md` |
| IS, IP | `SP/plan/inv-sys.md`, `SP/plan/inv-pub.md` |
| CC, CF, CT, CA, CV | the critiques `SP/plan/critique-consistency.md`, `critique-feasibility.md`, `critique-testing.md`, `critique-api-perf.md`, `critique-coverage.md` |
| P2 … P13 | the other phase plans (`REPO/docs/plan/phase-NN-*.md`; scratch copies `SP/plan/phase-NN.md`) |
| "the Neon dev database" | the dev database named in CLAUDE.md "Environments". After H10 that is the Free project `replay-chess-dev`; before H10 it is branch `dev` of project `withered-cake-82837167`. Plans never hard-code branch ids (CC R-20) |

---

## 0. Decisions in one screen

### 0.1 What this phase decides

| # | Decision | Source / why |
|---|---|---|
| P1-01 | Track 1A ships exactly SPEC.md's seven packages (1A·P0 … 1A·P6) and its §12 integration. | ALLOC §3 P1 "Track 1A (SPEC.md packages P0–P6, unchanged)" |
| P1-02 | Tracks 1B and 1Q each run in their own **git worktree**: `REPO/../cbt-p1b` (branch `p1-track-1b`, web on 3001, socket on 3003) and `REPO/../cbt-p1q` (branch `p1-track-1q`, web on 3004, socket on 3005), each with its own `node_modules`. Both merge to `dev` through small PRs. | SPEC §4.3 forbids `pnpm install`, `prisma generate/migrate`, server restarts and git writes in the shared 1A tree during the parallel phase. 1B and 1Q need all of them. |
| P1-03 | **One lockfile writer.** 1A·P0 installs every 1B and 1Q dependency in its own `pnpm add` step (list in §13.2). 1B and 1Q never run `pnpm add`. | SPEC §3.1 ("`package.json`, `pnpm-lock.yaml`: P0") |
| P1-04 | The hotfix lane (1B·H) merges to `dev` on days 1–3 and is **cherry-picked to `main`**: H1–H9 and H12 (app code), plus the workflow-only commits for H11 and the scheduled 1Q workflows (scheduled GitHub workflows run only from the default branch, `main`). Schema migration M1 is never cherry-picked to `main`. | ALLOC §1.4 ("`main` gets only the P1 security hotfixes"); GitHub runs `schedule:` triggers from the default branch only |
| P1-05 | One route wrapper `route()` in `lib/api/route.ts`; one envelope `{ data, meta? }` / `{ error: { code, message, fields?, details?, retryAfterSec?, requestId } }`; the HTTP status always matches the code. | ALLOC B16, B18 |
| P1-06 | One contracts package `REPO/packages/contracts` (`@repo/contracts`, zod 4). P1 ships `src/http/*` including the endpoint registry directory `src/http/registry/` and the OpenAPI generator. P2 adds `src/socket/*`, P3 adds `src/internal/*`. | ALLOC B17; CC R-10; CT P1 "OpenAPI" |
| P1-07 | TanStack Query v5, one `QueryClient` per tab, key factory **directory** `lib/api/keys/` (one file per domain, import path `@/lib/api/keys` unchanged), RSC prefetch + `HydrationBoundary`. The viewer lives under `qk.me()`. | ALLOC B19, CDL D3/D6; CF §7 (registries as directories) |
| P1-08 | Boot = **one server statement**. `(app)/layout.tsx` reads the viewer once (`getViewer()`, React `cache()`, one `$queryRaw` with a `LEFT JOIN` on `chess_com_profiles`), seeds `qk.me()`, and `UserSync` makes **no** network call when the cache is seeded. Outside `(app)` it makes exactly one `GET /api/me`. `POST /api/user/sync` and the boot-time `GET /api/subscription` leave the hot path. | ALLOC F4, AA §5.1; CA AP-19; CT P1 "query budget" |
| P1-09 | Postgres fixed-window rate limiter with **two stores**: `burst` on the `UNLOGGED` table `rate_limit_buckets` (windows ≤ 300 s) and `durable` on the logged twin `rate_limit_windows` (longer windows). Exposed as `route({ rateLimit })`; a `burst` spec with `windowSec > 300` fails at module load. Used only on non-hot routes. | ALLOC F5, DM D15; CA AP-11; CF F-NEON-3 |
| P1-10 | Schema **M1** = `RateLimitBucket` (UNLOGGED), `RateLimitWindow`, `WebhookEvent`, and two `users` columns: `subscriptionSourceAt` (billing compare-and-set key) and `gamesVersion` (archive ETag key, bumped from P2). Applied to the Neon dev database with `prisma migrate deploy`. Production gets it in P13. | ALLOC §3 P1 "Schema M1", §1.3; CA AP-06, AP-19; DM §5.1 |
| P1-11 | Middleware becomes a **public allow-list** plus a member gate on the Clerk custom claim `md` (`entitled`, `lapsed`), behind the env kill switch `MIDDLEWARE_MEMBER_GATE` (off until the claim backfill has run). Non-members go to `/pricing?reason=required`, lapsed members to `/pricing?reason=ended` (B26 default). A missing claim is "unknown" and passes to the page-level gate. Middleware code is frozen after P1: later phases add route classes as data files. | ALLOC F4, B26, IP §1.2, CDL §6.2 rule 2; CV C-21; CF §7 |
| P1-12 | Flags are evaluated on the server (`lib/flags/index.ts`, posthog-node local evaluation, memoised per request) and shipped to the client inside `qk.me().flags`. `useFlag()` never calls PostHog from the browser. Flag definitions live in `lib/flags/registry/pNN.ts`, one file per phase. P1 flag: `shell-v3`. | ALLOC F6, §1.6; CF §7 |
| P1-13 | **One guard for every test hook:** `testHooksEnabled()` = `NEXT_PUBLIC_APP_ENV ∈ {dev, test}` **and** `ALLOW_TEST_HOOKS=1`. `VERCEL_ENV` is never consulted, because `replay-chess-dev` deploys with `VERCEL_ENV=production`. Hooks in P1: `/dev/**` (SPEC D11), `x-rc-fault: 401\|402\|429\|500\|503`, `x-rc-now` (also needs `x-e2e-token`), `FLAGS_OVERRIDE`, the fenced `PERF_AUTH_BYPASS`, the `e2e-fixture` product, the telemetry sink. All are listed in `lib/test-hooks/registry.ts` and proven absent in a production-mode build by `e2e/specs/prod-guard.spec.ts`. | CF fix #3, SEC-5, 10.7.1; CT X5, X12 |
| P1-14 | `V3PaymentFailed` `last_day` / `dismissed` / `expired` and the four `V3Skeletons` variants become reachable in a post-integration package **1A·P7**, because SPEC §8.2 ships only the `banner` state and SPEC has no route-skeleton compositions. DoD rule ALLOC §1.1.4 needs every enum state reachable. | ALLOC §1.1, coverage matrix rows 292, 300 |
| P1-15 | **P1 builds the shared test and ops plumbing** every later phase relies on (track 1Q): unit globs and an orphan guard, Docker-Postgres integration and paywall-on e2e jobs in CI, `nightly.yml`, `post-deploy-dev.yml`, an E2E user registry with a persona pool, server-time control, a telemetry registry with sinks and a PII guard, a console guard, a design-state coverage manifest, visual baselines, a `flags-off` project, the quarantine file, a sign-off record template, perf results as data, `ops-weekly.yml` and the live-database backup workflow. | CT X1–X18, §4; CF 10.7.8; CA DB-02 |
| P1-16 | **Shared registries are directories**, and `REPO/OWNERS.yml` names which phase owns which globs (report-only CI check in P1, blocking from P4 when two streams run). | CF §7 |
| P1-17 | **Dev is isolated and private:** dev and E2E move to their own Neon Free project (H10, day 0–1); Vercel Authentication with an automation bypass protects `replay-chess-dev` once its webhooks are proven to pass (Q-16); every non-production response carries `X-Robots-Tag: noindex`. | CA AP-01; CF F-NEON-1, SEC-3 |
| P1-18 | **Billing writes are compare-and-set.** `applySubscriptionSnapshot` writes only when the row has not changed since it was read and the snapshot is not older than `subscriptionSourceAt`; no-op snapshots write nothing. `GET /api/subscription` is DB-only; every Dodo read goes through `POST /api/billing/refresh` (bucket `billing-refresh`). A daily `membership-reconcile` cron task heals rows whose period should have rolled. | CA AP-06, AP-31; ADB DB-06, DB-07 |
| P1-19 | **Six cache tiers**, declared per route: `public-immutable`, `public-static`, `public-short`, `private-etag`, `no-store`, `sse`. `public-*` only with `auth: "public"` (asserted at module load and by a registry walk test); no per-user response ever carries `max-age > 0`; sign-out calls `POST /api/session/clear` (`Clear-Site-Data: "cache"`). | CA AP-03, AP-04, AP-22; OPT D9, §4.2 |
| P1-20 | `GET /api/openings` is **public and CDN-cached** (`public-static`, tag `openings`): no viewer read, no limiter, no Clerk middleware. Its index shape is temporary: P8 replaces it and retires `qk.catalog.openingsIndex()`. | CA AP-28; CC R-15 |
| P1-21 | **Internal auth keeps today's `x-internal-token` + `INTERNAL_API_SECRET`** (timing-safe) in P1, isolated in `lib/auth/internal.ts` `verifyInternalRequest(req, routeId)` so the scheme can change in one file. Whether P2 replaces it with HMAC is owner decision Q-18 (recommended: HMAC in P2). P1 adds no internal-auth env var. | CC R-08; CF SEC-4; CA AP-44 |
| P1-22 | **The live database is backed up before anything else moves:** a nightly `pg_dump` of the database the live site reads (old project `shy-morning-50748774`), encrypted with `age`, kept 14 days as a GitHub artifact, with a weekly restore check into Docker Postgres on the runner (H11). | CA DB-02, 4.6.1 |
| P1-23 | **Every estimate carries a 20 % buffer line** (§13.3). | CF §8, 10.7.7 |

### 0.2 Where this document overrides an input (and why)

| Input says | This phase does | Reason |
|---|---|---|
| API §2.5 `defineRoute()` with a registry id | `route()` (ALLOC B18); the `id` comes from the contracts registry entry and is used in logs, spans, metrics and OpenAPI | Binding name |
| API §2.6: 32 codes incl. `membership_ended`, `bad_request`, `gone`, `upstream_error` | ALLOC F2's list plus `not_configured` and `unavailable` (16 codes), plus the append-only reason registries `CONFLICT_REASONS` and `FORBIDDEN_REASONS`. Later codes arrive per the CC R-06 ledger (`in_flight`, `idempotency_key_reused` 422, `illegal_*` 422 in P2; `gone` 410 in P3; `fair_use_limit` in P7; `reverification_required` in P10/P12; `precondition_failed` 412 in P12). `membership_ended` is `subscription_required` + `details.reason` | ALLOC F2; CC R-06 |
| CDL §4.3 code `unauthenticated` | `unauthorized` | ALLOC F2 |
| CDL `packages/protocol` | `packages/contracts` | ALLOC B17 |
| API §2.10, OPT §8.3 token bucket (`tokens`, `updatedAt`, `allowed`) | fixed window (`count`, `resetAt`) with burst and durable stores | ALLOC F5, DM §5.1; CA AP-11 |
| DM §1, D15: an UNLOGGED limiter "is harmless for limits" | UNLOGGED holds only windows ≤ 300 s; anything longer, and any daily or monthly budget, uses `rate_limit_windows` or counts over source rows | CA AP-11; CF F-NEON-3 |
| ALLOC §3 P1 "Schema M1 … Nothing else" | M1 also adds `rate_limit_windows`, `users.subscriptionSourceAt` and `users.gamesVersion` (all additive, nullable or defaulted) | CA AP-06 (DB-07 had no owner), AP-11, AP-19 |
| DM §5.1 M1 also adds the other billing columns, `TrialLedger`, `IdempotencyKey`, `AuditLog`, a matchmaking partial index | Deferred: `TrialLedger`, `trialOfferedAt`, `pendingCheckout*`, `membershipEndedAt` → P4 (M4); **`AuditLog` → P4 (M4)**, its first writer; `IdempotencyKey` → P2 (first consumer `POST /api/games`); the matchmaking index → dropped (matchmaking leaves the DB in P9) | ALLOC §3 P1; CC R-04 |
| DM §5.2 M1b (`users.timezone`, `user_settings`) | Not in P1. **`User.timeZone` (`VarChar(64)`, default `"UTC"`) arrives in M4 (P4)**, its first reader (the trial end label); `UserSettings` is P9 | CC R-03; ALLOC B14 |
| DM §3.15 webhook payload nulled after 7 days | Dodo payloads kept 180 days; **Clerk payloads never stored** (they contain email) | ALLOC B15; privacy |
| CDL §2.4 `(app)/layout.tsx` redirects signed-out visitors | SPEC D1/D2 dual chrome: `(app)` also holds public catalogue pages, so the layout never redirects; it picks the chrome | SPEC wins for track 1A |
| CDL §9.1 converts legends, openings, tournaments, position and profile data fetching in Phase 1 | Not in P1. Those screens are rebuilt in P8, P10 and P12, which convert them. P1 converts only what the boot path and the 401/402/429 contract need | ALLOC P1 scope; SPEC §9.3 |
| API §4.2 `Viewer` with `accounts`, `import`, `badges`, `prefs` | P1 `MeData` (§7.3) has `user`, `entitlement`, `flags`, `buildId`. `accounts`, `import` and `user.timeZone` arrive in P4, `badges` in P5, each additively. **`prefs` are not part of `MeData`**: P9 adds `GET /api/me/preferences` (`qk.prefs()`) | ALLOC F4; CC 1.5 |
| OPT §4.9 and §3.6.6 weak ETags `W/"…"` | strong ETags, version- or hash-derived | API §2.12 ("`W/` is not used") |
| ARCH §1.6.6 T2 "`private, no-store` + strong ETag" | `private, no-cache` + strong ETag (`private-etag`); `no-store` leaves nothing to revalidate | CA AP-22 |
| API §2.12 T0–T3 + NS tier names; OPT D9 `private-revalidate` | OPT's six names with `private-etag` for the revalidating tier | CA §1 "Cache tier names" |
| API §3.2 and CDL §4.3 `api()` sketches (`ifNoneMatch`, `x-client-build`, always `safeParse`) | `lib/api/client.ts` (§7.12) is the only implementation: header `x-rc-build`, no `ifNoneMatch` (TanStack v5 rejects `undefined` data), schemas only through `devSchema()` | CA AP-12, AP-21 |
| API §2.11.6 and ARCH §3.2.4 HMAC on every internal hop; P1 draft "P2 replaces the token with HMAC" | P1 keeps `x-internal-token`; the choice for P2 is Q-18 | CC 1.1, R-08; CF SEC-4; CA AP-44 (the three critiques disagree) |
| API-16 `INTERNAL_HMAC_SECRET` | not introduced; services keep `INTERNAL_API_SECRET`, user tokens get `SOCKET_TOKEN_SECRET` in P2 | CC 1.2, R-09 |
| ALLOC §1.3: `prisma db push` allowed on the dev branch "while iterating" | **No `db push` on any Neon database**: it drops hand-written storage parameters (`UNLOGGED`) and, from P2, partial indexes. `migrate deploy` on Neon; `migrate dev` only against a local Docker Postgres | CC R-20 |
| ALLOC §1.5 and P13 D16: dev and E2E move to their own Neon project before P13 | H10 does it in P1 (day 0–1); P13 drops the task | CA AP-01; CF F-NEON-1 |
| ALLOC §3 P1 F7 and the P1 draft: "E2E stays in `e2e-tests.yml`" (main only) | `ci.yml` gains `integration` and paywall-on `e2e-smoke` jobs on `dev`; `nightly.yml` runs the full suites; `post-deploy-dev.yml` smoke-tests the deployed dev site | CT X2, X3 |
| ARCH §4.3–4.4: nightly device × zoom matrix against the deployed dev environment | Full matrix against `next build && next start` on the GitHub runner with Docker Postgres; only a smoke subset hits the dev URL | CF F-VER-3 (Hobby pauses a feature for 30 days on overage) |
| ARCH §5.1 Vitest | `node:test` via `tsx` everywhere (SPEC D13) | CT X1 |
| ARCH §5.5 six device projects | SPEC D7's 40 projects, tiered: 4 per PR, all 40 nightly, plus a real-route layer | CT X9 |
| ALLOC F4: `GET /api/subscription` calls Dodo on `?refresh=1` or when data is > 6 h old | GET is DB-only; `POST /api/billing/refresh` is the only Dodo read; the 6-hour heal becomes the daily `membership-reconcile` task | CA AP-31 |
| ALLOC owner test "Forcing a 429 on `/api/openings` shows the inline countdown" | Kept via fault injection; `api()` adds a cache-busting `__rcfault` parameter so the faulted request misses the CDN. The real-limiter check moves to `GET /api/health?deep=1` (bucket `health-deep`), because `/api/openings` no longer has a bucket | CA AP-28 |
| P1 draft 402 target `/pricing?reason=required&why=<reason>` | `/pricing?reason=required` (never paid, trial available) or `/pricing?reason=ended` (trial used, expired, payment failed), the B26-default wording P7 D18 and P11 S2/S4 use | CV C-21; ALLOC B26 |
| AA §5, OPT §9.1: measure the page through `Server-Timing` on the document | Server components cannot set response headers. Page and layout DB time come from Sentry spans written by the Prisma timing extension, and statement counts from the CI query-budget harness. `Server-Timing` stays on API responses only | CA AP-14 |
| SPEC §5.2 `test:unit` glob (`app lib components prisma e2e/devices`) | one wider glob (§12.0), requested from 1A·P0 (§13.2) | CT X1 |
| SPEC §11.2 seed guard host regex for `ep-fancy-dust-b8b3dp81` | the regex names the new dev project's endpoint host from the H10 hand-back (§13.2 request to 1A·P6) | H10 |
| AP-48: mount `QueryProvider` outside the root layout | Not in P1 (rejected, Appendix A): no `(marketing)` route group exists until P11, and `UserSync` must run on every page. P11 D2 moves it with `ClerkProvider` | — |

---

## 1. Goal and user-visible outcome

**Goal.** After P1, phases 2–12 only add feature code. Every screen sits in one shell built from one UI kit (track 1A); every endpoint and screen uses one server contract and one client contract (track 1B); every phase inherits the same test, telemetry and ops gates (track 1Q). The live security holes are closed on `dev` and on `main` first, and the live database is backed up.

**What a member sees**

1. Signed-in members get the v3 shell on `/play`, `/queue`, `/challenge/new`, `/join/*`, `/join-tournament/*`, `/position/*`, `/tournaments`, `/tournament/*`, `/legends(/*)`, `/openings(/*)`, `/profile/*`: a 220 px sidebar on desktop, a 64 px rail on iPad landscape and at ≤ 1100 px, a top bar plus tab bar on phones and iPad portrait (SPEC §2.2). Nav shows Play (+ Tournaments), Learn (Legends, Openings) and Profile.
2. ⌘K / Ctrl+K opens the command palette everywhere; `/`, `?` and `g p` / `g l` work on fine pointers; the shortcuts sheet has a "Single-Key Shortcuts" switch.
3. The whole app renders in Geist; toasts use the v3 look (top-right in the shell, bottom-centre above the tab bar on phones, top-centre elsewhere).
4. A member whose card failed sees the payment banner ("Your last payment failed. You keep access until Nov 12.") with Update Payment.
5. An expired session no longer silently breaks a page: a blocking "You’ve Been Signed Out" dialog returns the user to the same URL after sign-in.
6. A rate-limited control shows an inline countdown ("Too many requests. Try again in 0:30") and re-enables itself; a rate-limited document lands on `/too-many-requests`.
7. Pages load with one viewer statement instead of the `user/sync` → `subscription` waterfall; paying members are never bounced to `/pricing` because a refresh failed (AC finding 4).
8. Signing out on a shared computer leaves nothing of the previous member in the browser's HTTP cache, the query cache or the service worker.

**What the owner can test on the dev site at the end** (`https://replay-chess-dev-replaychess007-1069.vercel.app`, ego-browser, signed in as E2E user A unless noted; once Q-16 is on, ego-browser signs in to Vercel first)

| # | Test | Expected |
|---|---|---|
| T1 | Open `/play`, `/tournaments`, `/legends`, `/openings`, own `/profile/<ref>` at 1440×900, 1194×834 (iPad L), 834×1194, 393×852, 412×915 | Sidebar / rail / tab bar per SPEC §2.2; current item highlighted; legacy content intact and scrollable; CTA bars above the tab bar (also automated by `routes.real.ts`, §12.4) |
| T2 | ⌘K, type "morphy" | "Paul Morphy" legend row (needs the 1A·P6 seed); Enter opens `/legends/<ref>` |
| T3 | `?` then `g p` | Shortcuts sheet; `g p` navigates to `/play` |
| T4 | `/dev/ui/sections/overlays` → toast buttons | ≤ 3 toasts top-right on desktop; one bottom-centre on phones |
| T5 | `/dev/ui/shell?user=payment`, `?user=payment_last_day`, `?user=payment_expired`; dismiss on `?user=payment` | Banner states `banner`, `last_day` (no dismiss), `expired` (Renew Membership → `/pricing?reason=ended`); dismiss shows the "Hidden for this session" toast with Undo |
| T6 | `/dev/ui/stage` at browser zoom 80/100/110/125/150 % | Board and both bars always on screen, no page scroll |
| T7 | `/dev/ui/skeletons?variant=game\|review\|profile\|list` | The four V3Skeletons compositions |
| T8 | `curl -s -o /dev/null -w "%{http_code}" -X POST <dev>/api/legends/create -H 'content-type: application/json' -d '{}'` | `401` (signed out); signed in as non-admin A → `403` |
| T9 | As A, `POST /api/chess/game-over` for any game (DevTools fetch) | `403 forbidden`; the game is unchanged |
| T10 | `curl <dev>/api/user/email/anything@x.com` and `curl <dev>/api/user/<ref>` | `404` both |
| T11 | `curl <dev>/api/chess/game-by-ref/<ref of a game A is not in>` | 200 with the invite projection only: no `gameData.moveHistory`, no `traceContext` |
| T12 | Hard-load `/play`, DevTools Network | **zero** requests to `/api/me`, `/api/user/sync`, `/api/subscription`, `/api/user/email/*` (server-seeded); the Sentry transaction for the page shows exactly **one** `db` span for the viewer. Hard-load `/game/<ref>`: exactly **one** `/api/me` |
| T13 | `/dev/ui/data` → "Load Openings (Force 429)" (calls the real `GET /api/openings` with `x-rc-fault: 429` and a cache-busting `__rcfault` parameter); then "Check Database" 7 times within a minute (the real `health-deep` bucket, 6 / 60 s per IP) | Inline "Too many requests. Try again in 0:30" with the button `aria-disabled`; at 0:00 it re-enables (`inline_ready`) and the next click loads 3,641 openings. The real-limiter run shows the same UI with the server's own `Retry-After` |
| T14 | `/too-many-requests?retry=10&from=/play` | 429 page; "Try Again in 0:10" disabled, then "Try Again" goes to `/play` |
| T15 | Revoke user A's session in the Clerk dev dashboard (Users → A → Sessions → Revoke), then return to the tab | "You’ve Been Signed Out" dialog; "Sign In Again" → `/sign-in?redirect_url=<same path>`; after sign-in, back on the same page. `/dev/ui/data` → "Simulate 401" shows the same dialog without revoking |
| T16 | `/dev/ui/data` → "Force 500" | Error toast "Failed to load openings · Event 5f1c2a9b" with Retry; the id matches the response's `x-request-id` and a Sentry event that carries no email and no body |
| T17 | Dodo test-mode checkout with the test card as a fresh user | Activation still works (Phase 0 flow, now through `POST /api/billing/refresh`); the Dodo dashboard shows the webhook delivered once; replaying it returns 200 with no second write (`webhook_events` has one row); replaying an **older** event afterwards leaves the user row unchanged (`webhook_events.status = 'stale'`) |
| T18 | Friend game between A and B on the dev site; B tries `accept_draw` without an offer (DevTools `socket.emit`) | Rejected; game continues. Push a socket deploy mid-game: clients see `server_restarting`, the game resumes after reconnect with the same moves (stopgap H6 #12/#13) |
| T19 | `curl <dev>/api/health` and `?deep=1` | `{ data: { ok: true, buildId, env: "dev", time } }`; `deep` adds `db: { ok, ms }` |
| T20 | `curl -sI <dev>/api/openings` twice | second response `x-vercel-cache: HIT`; `cache-control: public, max-age=0, must-revalidate`; no `set-cookie`; strong `etag` |
| T21 | `curl -sI <dev>/wp-login.php` and `curl -sI <dev>/play` (signed out) | `404` with no `x-clerk-*` headers; `/play` redirects to sign-in and every dev response carries `x-robots-tag: noindex` |
| T22 | Sign out from the shell account menu, then press Back | Network shows `POST /api/session/clear` → `204` with `Clear-Site-Data: "cache"` before Clerk's sign-out; Back shows the sign-in redirect, never the member page |
| T23 | GitHub Actions: the latest `ci.yml` run on the final `dev` SHA, the latest `nightly.yml` run and the `post-deploy-dev.yml` run for the final deployment | all green; `e2e-smoke` ran with `BILLING_PAYWALL=on` |
| T24 | GitHub Actions: `backup-live.yml` (last night) and its weekly `restore-check` job | green; artifact `live-<date>.dump.age` present; restored row counts within 1 % of the dump-time counts |
| T25 | GitHub issue "ops: weekly usage" opened by `ops-weekly.yml` | Neon CU-h for `replay-chess-dev` and the production project, Vercel Hobby usage per metric, each as % of pro-rata; nothing above 60 % |
| T26 | Vercel project `replay-chess-dev` → Settings → Environment Variables (names only) and the Neon console | `DATABASE_URL` / `DIRECT_URL` point at the `replay-chess-dev` Neon project (H10); `ALLOW_TEST_HOOKS`, `E2E_TEST_TOKEN` present on dev only |

---

## 2. Scope

### 2.1 In scope

**Track 1A (SPEC.md, unchanged):** tokens and Geist (SPEC §5.2), `components/ui` kit (§6, §7), app shell (§8), route integration into `app/(app)/` (§9), one-viewport primitives and ChessBoard `fill` (§10), dev-DB content seed (§11), device × zoom suite (§10.6), dev routes `/dev/ui`, `/dev/ui/sections/<id>`, `/dev/ui/shell`, `/dev/ui/stage` (§3.9).

**Track 1A additions (this document):** 1A·P7 state completion (payment banner `last_day`/`dismissed`/`expired`, `/dev/ui/skeletons`), 1A·DOC (route map from V3FlowMap, plan pointer, SPEC.md committed to `REPO/docs/plan/`).

**Track 1B, part H (security hotfixes and safety nets):** H1 admin auth, H2 internal-only game writes, H3 PII routes, H4 game-by-ref projection, H5 committed Clerk secret (rotate first, then delete, then gitleaks), H6 socket P0 set (AS §19 items 1–13), H7 Sentry/logging and PII, H8 service-worker caching, H9 env fences and timing-safe compares, **H10 Neon dev split**, **H11 live-database backup**, **H12 image-optimizer allow-list**.

**Track 1B, part F (foundations):** F1 route wrapper (six cache tiers, test-hook guard, `ctx.now`, GET purity) and reference migrations (`/api/health`, `/api/openings`, `/api/socket-token`, `/api/session/clear`), F2 contracts (codes, reason registries, endpoint registry, OpenAPI), F3 typed client + TanStack Query + `QueryProvider` + `QueryState`, F4 viewer/entitlement (`getViewer`, `requireMember`, `GET /api/me`, `POST /api/billing/refresh`, Clerk webhook, Dodo webhook dedupe + compare-and-set + claims, middleware, legacy client bridge), F5 Postgres rate limiter (burst + durable) + M1 + daily cron tasks, F6 flags, F7 CI (`ci.yml` jobs, gitleaks, blocking bundle budget, OWNERS report), F8 401/429 UI (`RetryCountdown`, `/too-many-requests`, `SessionExpiredModal`, `/dev/ui/data`), F9 DB role on the dev database. 1B·J joins them into 1A-owned files.

**Track 1Q (shared test and ops plumbing):** 1Q·1 (unit globs and orphan guard, test layout, E2E user registry and persona pool, sweeper, fixture health, paywall-on fixtures, `x-rc-now` fixture, telemetry registry package and sinks with PII guard, console guard, test-hook registry and `prod-guard.spec.ts`, design-state manifest and coverage script, quarantine and flake policy, sign-off template, k6 results as data, `nightly.yml`, `post-deploy-dev.yml`, `ops-weekly.yml`, `E2E_BASE_URL` mode); 1Q·2 after 1A·INT (visual baselines, real-route device layer, `flags-off` project, `telemetry.spec.ts`, state tags on the 1A specs).

### 2.2 Explicitly out of scope (and the phase that owns it)

| Out | Phase |
|---|---|
| Home, Train, Review, Settings destinations (hidden, not disabled) | P5, P5, P3, P10 |
| `/game/*` and `/analysis/*` inside the shell; socket protocol v2; `in_game_refresh`/`in_game_ok` session states; `IdempotencyKey`; `TIMING_PROFILE` and the per-worker fixture socket server; the shared chess-fixture corpus | P2 |
| HMAC on internal hops (if Q-18 says yes); socket tokens minted from claims without a DB read (CA AP-41); matchmaking isolation per test through the socket token (CT X4.5) | P2 |
| Palette **Ask** mode (`V3CommandPalette` state `ask`) | P7 |
| The in-place `RenewSheet` for 402 `trial_used`/`expired` on `(app)` pages | P7 D18 / P11 S4 |
| Offline page `/~offline`, 404/500 redesign (static root `not-found.tsx`), maintenance banner, cookie consent, PWA update/install prompts, precache budget, `QueryProvider` moved out of the root layout | P11 |
| Lapsed read-only access (B26) | owner decision before P3 (Q-09) |
| Onboarding gating in middleware (`md.onboarded`), `rc_act` activation cookie, `/checkout/activating`, `GET /api/billing/activation`, `TrialLedger`, `AuditLog`, `User.timeZone` | P4 |
| Socket token claims v2 (`ent`, `kid`), `entitlement:changed` push | P2 / P4 |
| Converting legacy page data fetching (legends, openings, tournaments, leaderboard, position, profile) | P8, P10, P12 |
| Dropping the duplicate `users` indexes (ADB DB-01) | contract step C1 |
| Index-existence and `EXPLAIN` gate over partial indexes; the drift gate rewrite (`scripts/db/check-drift.ts`) | P2 (first partial indexes) |
| Vercel Pro, prod Clerk/Dodo, prod Neon migration, prod `@prod-smoke` schedule | P13 |

### 2.3 Dependencies

- **P0 (done, `8514fea`):** paid-only model, trial, `BILLING_PAYWALL`, `requireSubscribedUser`, `summarizeEntitlement`, dev environment (Vercel `replay-chess-dev`, OCI dev socket 80.225.200.210, Neon project `withered-cake-82837167` branch `dev`, Clerk dev, Dodo test).
- **Owner actions before day 1 (≈ 2 h in total, §14.2):** renew `playchess.tech` with auto-renew and registrar lock (Q-13); rotate the Clerk secret committed in `REPO/k8s/secrets.yaml:12` (Q-02); create the Neon Free project `replay-chess-dev` and restore the dev branch into it with Claude (Q-15 / H10); add the Clerk dev **session-token template** `{"md": "{{user.public_metadata}}"}` and the dev webhook endpoint (Q-06); create a read-only role on the live database and an `age` key pair for H11 (Q-19).
- **Owner actions during P1:** set the new Vercel env vars on `replay-chess-dev` (§7.9) and the GitHub secrets (§13.4); approve `SOCKET_AUTH_REQUIRED=true` on prod (Q-04); approve the `replay_app` role switch (Q-05); decide OCI pay-as-you-go (Q-14), Vercel Authentication on dev (Q-16), the `CLAUDE.md` split (Q-17), the P2 internal-auth scheme (Q-18); create the UptimeRobot monitors (Q-20).

---

## 3. Current code touched

Line numbers are on `dev` @ `0848b76`. "1A" rows are SPEC-owned and summarised; "1B" rows are new in this document.

### 3.1 Track 1A (summary of SPEC §5–§11; see SPEC §3.1 for the full matrix)

| File / route | Today | Fate | Package |
|---|---|---|---|
| `app/globals.css` (tokens, l.1–352) | v1 tokens; shadcn tokens opaque | **rework** (additive tokens, variants, focus rule, cursor rule into `@layer base`) | 1A·P0 |
| `app/layout.tsx:16-23,33-37,80,104,128,152` | `next/font/local` `geistSans` (never applied, AC #10), OS-following theme colour | **rework** (`next/font/google` Geist, `ThemeColorSync`, `TooltipProvider`) | 1A·P0 |
| `next.config.js:13-35` | `reloadOnOnline: true`, front-end nav caching | **rework** (`reloadOnOnline: false`, `distDir`, `devIndicators`; H8 runtime caching, see §3.2) | 1A·P0 (+ H8) |
| `components/ui/button.tsx` | unused shadcn file | **replace** | 1A·P0 |
| `components/ui/label.tsx` | zero consumers | **remove** | 1A·P1 |
| `app/components/ThemeAwareToaster.tsx:10-24` | top-centre, hard-coded hex | **rework** (placement by chrome, v3 classes) | 1A·P2 |
| `instrumentation-client.ts:34` | `onRouterTransitionStart` = Sentry only | **rework** (+ `rc:navigation-start`) | 1A·P3 |
| 40 files under `app/{play,queue,challenge,join,join-tournament,position,tournaments,tournament,legends,openings,profile}` | top-level routes with their own Navbar/Footer | **move** to `app/(app)/…` (P4a) and chrome-gate (P4b) | 1A·P4 |
| `app/play/ShareLinkModal.tsx` | under `app/play` | **move** to `app/components/ShareLinkModal.tsx` | 1A·P4a |
| `app/components/ChessBoard.tsx` | fixed `squareSize` | **rework** (`fill`) | 1A·P5 |
| `prisma/seed-content*.ts` | — | **new** | 1A·P6 |

### 3.2 Track 1B

| File:line (today) | Today | Fate | Package · task |
|---|---|---|---|
| `app/api/legends/create/route.ts:26`, `app/api/legends/[id]/route.ts:27,191`, `app/api/chess-positions/create/route.ts:44`, `app/api/chess-positions/[id]/route.ts:115,167,348`, `app/api/chess-positions/route.ts:5-11` | no auth on 6 writes and 2 reads; `limit` unbounded (`parseInt(searchParams.get("limit") \|\| "50")`) | **rework**: `requireAdmin()` first statement; `limit = clamp(1, 50)`; explicit `select` | 1B·H1 (AA F-01, ADB DB-14) |
| `lib/auth/require-admin.ts:4-16` | `getSessionUser()` → Clerk Backend API + lookup **by email** (AA F-23) | **rework**: `auth()` + `findUnique({ where: { googleId }, select: { id, referenceId, role, isActive } })`; envelope bodies | 1B·H1 |
| `app/api/chess/game-over/route.ts:50-58,83-120` | any signed-in user may end any game; unconditional `tx.game.update` (game over can run twice, ADB DB-04) | **rework**: internal token only (else 401 signed-out / 403 signed-in); inside the transaction `updateMany({ where: { referenceId, status: "IN_PROGRESS" } })`, stop when `count === 0` | 1B·H2 (AA F-02) |
| `app/api/chess/move/route.ts:25-70`, `app/api/chess/game-state/route.ts:18-26` | participants or anyone signed in | **rework**: internal only; `move` keeps the length guard `moveHistory.length >= stored` (H6 #12) | 1B·H2 |
| `app/api/user/[referenceId]/route.ts:6-96` | unauthenticated email + DOB by ref, no callers | **remove** | 1B·H3 (AA F-03) |
| `app/api/user/email/[email]/route.ts:25-77` | unauthenticated email → ref, DOB, role, stats | **rework** now (drop `dateOfBirth`, `role`; 404 for both "missing" and "inactive"), then **remove** at the end of F4d when its two callers are gone | 1B·H3 → 1B·F4d |
| `app/api/chess/game-by-ref/[gameReferenceId]/route.ts:5-97` | full `gameData` to anyone (AA F-04, AC #7) | **rework**: participant or internal token → full; everyone else → invite projection | 1B·H4 |
| `REPO/k8s/**` (6 files, `secrets.yaml:12` Clerk `sk_test_…` secret), root `REPO/docker-compose.yml` (`CLERK_SECRET_KEY` build arg), `REPO/build-and-push.sh` | committed secret in a **public** repo | owner rotates the key **first** (in the instance that issued it); then **remove** `k8s/` and `build-and-push.sh`, drop the build arg; add gitleaks with a full-history baseline (`REPO/.gitleaks.toml`, `REPO/.gitleaks-baseline.json`) | 1B·H5 (AQ SEC-03, CF SEC-1) |
| `WS/GameSession.ts:66,139,197-207,429-442,467-513,559-561,571-673,620-630`, `WS/index.ts:42-73,115-131,367-385`, `WS/utils/apiClient.ts:36-189`, `WS/GameManager.ts`, `WS/spotInterruption.ts`, `lib/services/tournament/notify-websocket.ts:11-23`, `REPO/deploy/oci/docker-compose.yml` | AS F-01…F-11, F-16 | **rework** per AS §19 P0 items 1–13 (§7.5) | 1B·H6 |
| `app/api/chess/create-game/route.ts`, `lib/services/matchmaking/matchmaking.service.ts`, `app/api/analysis/[gameId]/route.ts:199-207` | socket randomises colours (AS F-04) | **rework**: write `gameData.creatorColor` at creation; analysis reads it | 1B·H6 #11 |
| `lib/logger.ts:42-52`, `lib/sentry/logger.ts:42-53` | `error()` drops the error object (AA F-05); two loggers | **rework** `lib/logger.ts` (`Sentry.captureException(err, { extra })`); **remove** `lib/sentry/logger.ts` and repoint its 4 importers | 1B·H7 |
| 25 route files returning `details: error.message` (list in AA F-12) | leaks exception text | **rework**: drop `details`/`stack` from 5xx bodies | 1B·H7 |
| `sentry.server.config.ts:13,20`, `sentry.edge.config.ts:14,21` | `tracesSampleRate: 1`, `sendDefaultPii: true` | **rework**: `sendDefaultPii: false`; `tracesSampler` (§10.2) | 1B·H7 |
| `next.config.js:13-35` (`withPWAInit`) | runtime-caches `/api/*` GETs (NetworkFirst 24 h) and HTML across users (AC #11) | **rework**: `/api/*` and RSC `NetworkOnly`; `cacheOnFrontEndNav: false`, `aggressiveFrontEndNavCaching: false` | 1B·H8 (before 1A·P0, or inside P0) |
| `next.config.js:72-79` (`images.remotePatterns: [{ hostname: "**" }]`) | the image optimizer proxies any host (open proxy; 5,000 transformations a month on Hobby) | **rework**: allow-list `img.clerk.com`, `images.clerk.dev`, `images.chesscomfiles.com`, plus every host found by `rg -o 'https://[^/"]+' app components` that renders through `next/image` at implementation time; third-party directory badges and Clerk/Chess.com avatars render `unoptimized` | 1B·H12 (same edit window as H8; CF F-VER-4, OPT-09) |
| `.env.development.local`, `.env.test` (host `ep-fancy-dust-b8b3dp81…`), Vercel `replay-chess-dev` `DATABASE_URL`/`DIRECT_URL` | dev and E2E share project `withered-cake-82837167` (and its 100 CU-h) with the future production branch; dev is a child of production | **rework**: point every dev consumer at the new Free project `replay-chess-dev` (max 0.5 CU) | 1B·H10 (CA AP-01, CF F-NEON-1) |
| `lib/auth/resolve-user.ts:34-40,82-89` | `PERF_AUTH_BYPASS` trusted with no env fence (AA F-11); `tokenMatchesSecret` private | **rework**: fence on `testHooksEnabled()` (`lib/env-server.ts`, never `VERCEL_ENV`) + `x-perf-token`; move `tokenMatchesSecret` to `lib/auth/secrets.ts` | 1B·H9 |
| `lib/auth/api-key.ts:40`, `app/api/tournament/[tournamentReferenceId]/route.ts:130` | `===` secret compares (AA F-25) | **rework**: `tokenMatchesSecret` | 1B·H9 |
| `lib/rate-limit.ts:13-38` | in-memory per instance (AA F-21) | **remove** (replaced by `lib/rate-limit-db.ts`) | 1B·F5 |
| `app/api/healthcheck/route.ts` (4 lines) | plain 200 | **keep as alias** of `GET /api/health` for one release | 1B·F1 |
| `app/api/openings/route.ts:7-53` | `{ success, data: { openings } }`, in-memory limiter, auth required, full dump per call | **rework** with `route({ auth: "public", cache: "public-static", publicStatic: { sMaxAge: 86400, swr: 604800, tags: ["openings"] } })` + `unstable_cache` (tag `openings`); no viewer read, no bucket, excluded from middleware | 1B·F1 (CA AP-28) |
| `app/api/socket-token/route.ts:16-37` | ad-hoc body | **rework** with `route()`; body `{ data: { token, expiresAt } }` plus a top-level mirror for one release | 1B·F1 |
| `lib/stores/useDataStore.ts:90-100` | requires `data.success` | **rework**: read `data.data?.openings` | 1B·F1 |
| `lib/hooks/useSocketToken.ts:41` | reads the ad-hoc body | **rework**: `json.data ?? json` | 1B·F1 |
| `lib/auth/require-subscription.ts:30-58` | 402 body `{ error, code, upgradeUrl }` | **rework**: `requireMember()` with `details.reason`; legacy mirror `code` + `upgradeUrl` while `LEGACY_402_MIRROR=on` | 1B·F4a |
| `app/api/subscription/route.ts:72-140` | Dodo `customers.list` + `subscriptions.list` and a DB write on **every** GET | **rework**: DB-only read (no Dodo call, no write, no customer self-heal); the Dodo read and the self-heal move to the new `POST /api/billing/refresh` | 1B·F4a (CA AP-31) |
| `app/api/user/sync/route.ts:1-206` | boot write path; links by `emailAddresses[0]` (AA F-23) | **rework** onto `provisionUser()`; no caller after F4d; removed in P2 | 1B·F4a |
| `app/api/webhook/dodo-payments/route.ts:33-72` | `Webhooks()` adaptor, no dedupe, no claims | **rework**: explicit `dodo.webhooks.unwrap()`, `WebhookEvent` insert first, compare-and-set apply, `syncClerkClaims` in `after()` | 1B·F4b |
| `lib/billing/entitlement.ts:89-107` (`applySubscriptionSnapshot`) | read → `shouldApplySnapshot` → unconditional `prisma.user.update` (lost updates, ADB DB-07; writes when nothing changed, DB-06) | **rework**: optimistic compare-and-set on `subscriptionSourceAt` with up to 3 re-reads; skip the write when no persisted field changes; return the matched `userId` (§8.11) | 1B·F4b (CA AP-06) |
| `lib/billing/entitlement-rules.ts:105-118, 156` | `shouldApplySnapshot` orders by `subscriptionUpdatedAt`; `fieldsFromSnapshot` stamps `subscriptionUpdatedAt = eventTime ?? new Date()`, so an API refresh makes later webhooks look stale | **rework**: order by `subscriptionSourceAt ?? subscriptionUpdatedAt`; `subscriptionUpdatedAt` becomes "last written" only; the provider time goes to `subscriptionSourceAt`, never `now()` | 1B·F4b |
| `middleware.ts:1-50` | 9 protected prefixes, no member gate, runs on every `/api` path | **rework** (§7.6) | 1B·F4c |
| `app/components/UserSync.tsx:93-156` | `POST /api/user/sync` → `GET /api/subscription` on every hard load | **rework**: seeded `qk.me()` or one `GET /api/me`; writes the legacy store; keeps the onboarding redirect | 1B·F4d |
| `lib/stores/useUserStore.ts:97-110,112-148,150-156` | failed fetch → `{ entitled: false }` (AC #4); `fetchUserByEmail`; persists `subscription`; `fetchSubscription` = `GET /api/subscription` (which called Dodo) | **rework**: keep the last known value on error; delete `fetchUserByEmail`; persist version 2 without `subscription`; `fetchSubscription` calls `POST /api/billing/refresh` (its remaining callers `useCheckout.ts:44`, `MembershipSection.tsx:145,187,215`, `PricingContent.tsx:119` are all "after an action" and want a fresh Dodo read) | 1B·F4d |
| `lib/hooks/useRequireAuth.ts:84-132` | falls back to `GET /api/user/email` and redirects a signed-in user to `/sign-in` on any failure (AC #5) | **rework**: wait for the store; redirect only when Clerk says signed out | 1B·F4d |
| `lib/hooks/useRequireSubscription.ts:74-112` | redirects after a verified negative that may be an error | **rework**: redirect only on a successful negative answer | 1B·F4d |
| `lib/billing/client.ts:87-113,120-133` | `waitForEntitlement` polls; 402 check reads top-level `code` | **rework**: read `error.code` too; `waitForEntitlement` success → `await Clerk.session?.reload()` before navigating | 1B·F4d |
| `lib/billing/products.ts:15-27` (`getProductCatalog`) | E2E members carry `subscriptionProductId: "e2e-fixture"` (`e2e/scripts/provision-test-users.ts:46,126`), which resolves to no plan | **rework**: `e2e-fixture` resolves to the monthly plan **only** when `isNonProdApp()`; in production it resolves to nothing and logs a Sentry warning | 1Q·1 (CT X3) |
| `e2e/fixtures/auth.ts:51,59`, `e2e/fixtures/tournament-helpers.ts:46,54` | call `POST /api/user/sync` (removed from the hot path in P1) and `POST /api/user/onboarding-skip` | **rework**: `signIn()` calls `GET /api/me` (it provisions); `onboarding-skip` stays until P4 | 1B·F4d (CT X17) |
| `.github/workflows/e2e-tests.yml:3-8,57,79` | runs on `main` only, `BILLING_PAYWALL: "off"` | **rework**: `BILLING_PAYWALL: "on"`; the `dev` jobs live in `ci.yml` and `nightly.yml` | 1Q·1 (CT X2, X3) |
| `playwright.config.ts:12,19,24,34` | `fullyParallel`, fixed `baseURL`, global setup, `webServer` always on | **rework** (after 1A·P0's `reuseExistingServer` edit): `E2E_BASE_URL` mode, Vercel bypass headers, `@p<N>` grep, quarantine `grepInvert`, `flags-off` project, console guard, telemetry fixture | 1Q·1 / 1Q·2 |
| `e2e/global-setup.ts`, `e2e/scripts/provision-test-users.ts:46,118-127` | provisions A–R once; `currentPeriodEnd` = provisioning day + 1 year | **rework**: global setup re-entitles A–P idempotently, runs the fixture health check and the throwaway-user sweeper; provisioning gains the 24 pool users `E2E_POOL_01…24` | 1Q·1 (CT X3, X4) |
| `app/layout.tsx:158` (`<SpeedInsights />`) | default sample rate 1; Hobby allows 10,000 events per 30 days team-wide | **rework**: `sampleRate={0.2}` and `beforeSend` that drops events when `navigator.webdriver` | 1B·J (CF F-VER-5) |
| `.github/workflows/` (no `ci.yml`, no `nightly.yml`) | only `deploy-oci.yml`, `e2e-tests.yml` (main), `indexnow.yml`, `perf-tests.yml` | **new**: `ci.yml`, `nightly.yml`, `post-deploy-dev.yml`, `ops-weekly.yml`, `backup-live.yml` | 1B·F7, 1B·H11, 1Q·1 |

---

## 4. Screens

The coverage matrix assigns 12 boards to P1 (ALLOC §4.2 rows 121, 284, 290–292, 297–301, 305, 312). Every screen below lists its route, boards per device, layout and one-viewport mode, states and transitions, components, interactions, empty/loading/error states and copy.

**Layout reminder (SPEC §2.2–§2.3, D15; DS `README.md` "Layout: one viewport").** Shell modes are CSS-only. Legacy pages inside the shell run in **flow** mode (the document scrolls; bars are sticky). Pages that contain `[data-rc-lock]` run in **lock** mode (`100dvh`, the document never scrolls); only `/dev/ui/shell`, `/dev/ui/stage`, `/dev/ui/skeletons?variant=game` and every future board screen are lock pages in P1. Zoom 80–150 % is covered by the 40-project device suite (SPEC D7).

### 4.1 App shell and navigation (`V3Nav`)

- **Route:** every `app/(app)/**` page for members (SPEC D1/D2); `/dev/ui/shell` demo.
- **Boards:** component `DR/V3Nav.dc.html` (220×720; prop `current: home|play|train|learn|review|profile|settings`). Mode references: desktop `DR/V3PlayHub.dc.html` (sidebar), iPad landscape `DR/V3iPadLPlayHub.dc.html` (rail), iPad portrait `DR/V3iPadPPlayHub.dc.html` (top bar 52 + tab bar 64), iPhone `DR/V3iPhonePlayHub.dc.html`, Android `DR/V3AndroidPlayHub.dc.html` (top bar 44 + tab bar 56; Android heights are owner decision SPEC R7). Offline chip copy from `DR/V3Offline.dc.html` and `DR/V3iPhoneOffline.dc.html`.
- **Layout per device:** desktop 1440×900 / 1280×800: sidebar 220; iPad L 1194×834: rail 64 (coarse pointer); iPad P 834×1194: top bar 52 + tab bar 64; iPhone 393×852 and Android 412×915: top bar 44 + tab bar 56 (+ safe insets). SubNav strip in rail and tab-bar modes when the current destination has subs (Play › Tournaments; Learn › Legends, Openings). Phone detail routes show Back instead of SubNav (SPEC §8.2 `backTarget`).
- **States:** `current ∈ {play, learn, profile}` reachable (with subs `tournaments`, `legends`, `openings`); `home`, `train`, `review`, `settings` are **hidden** and light up in P5/P5/P3/P10 (ALLOC §1.2). Shell user variants: member, trial (`Trial · 5 days left`), admin (Admin item), norating, payment (banner). Transitions: pathname change → `aria-current` moves; hairline shows 200 ms after `rc:navigation-start` and hides on commit (10 s safety).
- **Components:** 1A·P3 `Sidebar`, `TopBar`, `TabBar`, `SubNav`, `AccountMenu` (Menu on desktop, Sheet on phones), `ShellBanners`, `OnlineChip`, `RouteHairline`, `Brand`; 1A·P1 `Avatar`, `Tag`, `Banner`; 1A·P2 `Tooltip`, `Menu`, `Sheet`.
- **Interactions and keys:** SPEC D20 and §8.2 `classifyKeydown`: ⌘K/Ctrl+K everywhere (also in inputs and over shell dialogs), `/`, `?`, `g p`, `g l` only on fine pointers, outside editable fields, with no modal open and the switch on; Esc closes menus/sheets; Tab order skip link → nav → main; Alt+T focuses toasts (sonner).
- **Empty/loading/error:** route hairline during navigation; legacy `loading.tsx` files unchanged (SPEC §9.3); account-menu "Account" disabled until Clerk loads; palette legend search shows "Searching legends…" / "Search needs a connection".
- **Copy:** Title Case labels (SPEC §3.11); trial tag never says "ends today" (days are rounded up, ≥ 1).

### 4.2 Command palette (`V3CommandPalette`)

- **Route:** overlay on every shell route and `/dev/ui/shell`.
- **Board:** desktop `DR/V3CommandPalette.dc.html` (states `open`, `ask`, `closed`). No device boards; on phones the same Dialog renders full-width at `top-[12vh]`.
- **States:** `closed → open` (⌘K, `/`, search button), `open → closed` (Esc, select, ⌘K toggle). `ask` lights up in **P7**; no Ask row or Tab-to-ask exists in P1.
- **Components:** 1A·P2 `Dialog` (`size="lg" align="top" hideTitle hideClose`), `cmdk`, 1A·P0 `Kbd`; the legend rows' loading and offline rows; focus returns to `#main` after a navigation.
- **Rows (P1 only):** Go To (Play, Tournaments, Legends, Openings, Profile, Membership), Actions (Find an Opponent · 5+3, Challenge a Friend, Keyboard Shortcuts, Switch Theme, Admin for admins, Sign Out), Legends (live `GET /api/legends/search?name=` for ≥ 2 chars, ≤ 5 visible rows).
- **Empty / loading / error:** "No pages or actions match.", "Searching legends…", "Search needs a connection".
- Full spec: SPEC §8.2 CommandPalette.

### 4.3 Keyboard shortcuts (`V3Shortcuts`)

- **Board:** `DR/V3Shortcuts.dc.html` (`open`, `closed`). Route: overlay.
- **States:** `closed → open` on `?` or the palette row; ⌘K while open closes it and opens the palette (no stacked modals).
- **Components:** 1A·P2 `Dialog` (`titleVariant="serif"`, size by section count), 1A·P1 `SwitchRow`, 1A·P0 `Kbd`. Keys: `?` opens (fine pointers, switch on), Esc closes, ⌘K swaps to the palette.
- **Copy:** title "Keyboard Shortcuts", description "Press ? any time", section titles Title Case, row labels sentence case (SPEC §3.11).
- **Content:** one "Everywhere" section (SPEC §8.2) and the "Single-Key Shortcuts" switch (`localStorage["rc-single-key-shortcuts"]`). Board and Review sections register in P2/P3 through `SHORTCUT_SECTIONS` (collision test `findCollisions`).

### 4.4 Toast system (`V3Toasts`, `V3iPhoneToasts`, `V3iPadPToasts`)

- **Boards:** desktop `DR/V3Toasts.dc.html`, iPhone `DR/V3iPhoneToasts.dc.html`, iPad portrait `DR/V3iPadPToasts.dc.html` (no enum props: specimen boards).
- **Placement:** inside the shell: top-right (desktop, iPad L; ≤ 3 visible, 380 px, 320 at ≤ 1100), bottom-centre above the tab bar on phones (1 visible, 380 px) and iPad portrait (440 px); outside the shell: today's top-centre (SPEC D16).
- **Types:** success 3 s, info 3 s, error 8 s, warning 8 s, achievement 6 s, undo 6 s (SPEC §7.2 `TOAST_TYPES`). Timer bar pauses on hover/focus/hidden document.
- **Reachable:** `/dev/ui/sections/overlays` buttons `ui-toast-*`.
- **1B use:** `reactToApiError` raises `notify.error("Failed to <verb> <object> · Event <8 hex>", { action: Retry, id: "err:<object>" })` for failed mutations and failed first-load queries without an inline host (CDL §4.5); never for 401/402/429/503.

### 4.5 Payment-failed banner (`V3PaymentFailed`)

- **Route:** banner slot of every shell page (SPEC §8.2 `ShellBanners`); demo `/dev/ui/shell?user=payment|payment_last_day|payment_expired`.
- **Board:** desktop `DR/V3PaymentFailed.dc.html` (states `banner`, `last_day`, `dismissed`, `expired`); the in-page variant in `DR/V3Home.dc.html` state `payment_failed` belongs to P5.
- **States and data (`ShellUser`, computed on the server):**

| State | Condition (server, `lib/shell/shell-user.ts`) | Copy | Controls |
|---|---|---|---|
| `banner` | status ∈ `{past_due, on_hold}`, entitled, `currentPeriodEnd − now > 36 h` | "Your last payment failed. You keep access until Nov 12." | Update Payment (→ `/api/customer-portal` in a new tab, `router.refresh()` on return); dismiss X ("Dismiss for this session") |
| `last_day` (1A·P7) | same, `≤ 36 h` left | "Your last payment failed. Access ends Nov 12 unless the card is updated." | Update Payment; **no dismiss** |
| `dismissed` (1A·P7) | user dismissed `banner` | banner hidden; toast "Hidden for this session. Membership shows the payment issue." with Undo (6 s) | Undo restores the banner |
| `expired` (1A·P7) | grace ended after a failed payment (`status ∈ {on_hold, past_due, failed}`, not entitled) | "Your membership ended on Nov 12 after the payment failed. Renew to get new reviews, puzzles and the coach back. Your saved games stay." | Renew Membership → `/pricing?reason=ended` |

  `expired` users are non-members. Under the B26 default (hard redirect, the wording P7 D18 and P11 S2/S4 use), middleware and the page gate send them to `/pricing?reason=ended`, so they never see the shell and the state is reachable only through the demo user. If the owner approves lapsed read-only access (Q-09, before P3), the banner shows on the read-only pages and its CTA opens P7's `RenewSheet` instead. Until P11 S2 adds the "ended" banner, the legacy pricing page renders its default view for `reason=ended` (plan cards and checkout work, so it is not a dead end). The date label is preformatted on the server in UTC (`Nov 12`, SPEC §3.4) so SSR and hydration agree.
- **Layout:** in flow above the page (52 px), never overlays; one-viewport pages shrink instead of scrolling. Hidden on immersive routes (none in the shell in P1).
- **A11y:** `role="status"` polite on first show; dismiss `aria-label`.

### 4.6 Loading: hairline and route skeletons (`V3Skeletons`)

- **Board:** `DR/V3Skeletons.dc.html` (states `game`, `review`, `profile`, `list`).
- **Route:** the hairline is global in the shell (SPEC §8.2 `RouteHairline`). The four compositions are demoed at `/dev/ui/skeletons?variant=game|review|profile|list` (1A·P7). Real `loading.tsx` files adopt them in the phase that rebuilds each route: `game` (P2), `review` (P3, label "Analysing · 14 of 38 moves"), `profile` (P10), `list` (P3 games archive, P12 tournaments).
- **Compositions (`components/layout/RouteSkeletons.tsx`, built from 1A·P1 `Skeleton*` and 1A·P5 `BoardStage`):**
  - `game`: lock page; real `ChessBoard squareSize="fill"` from a FEN prop (`r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N1PN2/PP3PPP/R2QKB1R w KQ - 0 9`), skeleton player bars (32 px circle, two lines, 84×34 clock block), a 360 px aside of `SkeletonRow`s.
  - `review`: board + "Analysing · 14 of 38 moves" overline + move list of 12 `SkeletonText` rows.
  - `profile`: header (72 px avatar circle, two lines), tab row, 6 rows.
  - `list`: page header + 9 ghost rows ("never a spinner alone").
- **A11y:** `SkeletonRegion` sets `aria-busy="true"` with one sr-only "Loading…"; skeletons `aria-hidden`.

### 4.7 Empty state pattern (`V3EmptyStates`)

- **Board:** `DR/V3EmptyStates.dc.html` (specimen).
- **Route:** gallery `/dev/ui/sections/controls` (`ui-empty-state-page`, `ui-empty-state-card`, SPEC §6.2) and `/dev/ui/shell?content=empty` ("No Tournaments Right Now").
- **Anatomy:** dashed ghost rows (opacity 0.22 → 0.16 → 0.10), serif Title Case headline, one line, one primary + ≤ 1 text link, centred in its region. Instances listed in IS §3.17 are built by their screens' phases.

### 4.8 Rate limited (`V3RateLimited`)

- **Board:** `DR/V3RateLimited.dc.html` (states `inline`, `inline_ready`, `page`). No device boards: the inline form lives in its host; the page stacks on phones.
- **Routes:**
  - inline: any host control that receives `429 rate_limited` (P1 hosts: `/dev/ui/data` "Load Openings" (fault-injected) and "Check Database" (the real `health-deep` bucket); later the Chess.com lookup P4, coach P7, palette search P11);
  - page: `/too-many-requests?retry=<sec>&from=<path>` (public, `force-static`, marketing chrome).
- **States and transitions:**

| State | Entry | UI | Exit |
|---|---|---|---|
| `inline` | `ApiError.code === "rate_limited"` on the host's query or mutation | Field-level error row `role="status"`: "Too many requests. Try again in `0:30`" (`<span role="timer">`), host button `aria-disabled="true"` (still focusable, `aria-describedby` → the row) | countdown hits 0 |
| `inline_ready` | countdown at 0 | row removed, button enabled; queries refetch automatically once, mutations wait for a click | click → request → `inline` again if still limited |
| `page` | document request rewritten to the page (Vercel Firewall rule, or middleware edge limiter when `EDGE_DOC_LIMIT=on`) or a direct visit | mono `429 · Too many requests`, h1 "Slow Down a Little", body "We’ve had a lot of requests from this connection in a short time. The page will be ready again in 0:30.", button "Try Again in 0:30" (disabled) → "Try Again" (→ `from` if it passes `safeReturnPath`, else `/`), link "Why This Happens" → `/help` | Try Again |

- **Countdown rule:** count down from the received seconds with `performance.now()` deltas, never from absolute times (client clock skew, IS §3.6). Format `m:ss`. Per tab; the server stays authoritative.
- **Layout:** page = flow (marketing Navbar/Footer, `main` centred, max-width 560); on phones the stack is one column, the button `block` 48 px. Fits 393×659 at 150 % (checked by `e2e/devices/ui/system.spec.ts`).
- **Copy:** button labels Title Case per SPEC §3.11 ("Try Again in 0:30", "Why This Happens") where the board uses sentence case; recorded as copy deviation S6 (§14).

### 4.9 Session expired (`V3SessionExpired`)

- **Board:** `DR/V3SessionExpired.dc.html` (states `modal`, `signing_in`, `in_game_refresh`, `in_game_ok`). On phones the same content renders as a bottom Sheet (DS "Modal (sheet on phone)").
- **Route:** overlay over the current route (URL unchanged); never on public routes (marketing, `/pricing`, `/legends*`, `/openings*`, `/profile/*` guest, `/sign-in*`).
- **States (P1):** `modal` and `signing_in`. `in_game_refresh` / `in_game_ok` are P2 (socket token refresh during a live game).

| State | Entry | UI | Exit |
|---|---|---|---|
| `modal` | (a) an `api()` call returns 401 and `Clerk.session.reload()` + one retry still returns 401; (b) Clerk `isSignedIn` flips true → false on a non-public route without the local sign-out intent (`sessionStorage["rc.signout"]`), debounced 1.5 s and cancelled if the pathname becomes public; (c) a `BroadcastChannel("rc-auth")` message `session_expired` from another tab | icon, h2 "You’ve Been Signed Out", body "Your session expired. Sign in to continue where you left off; you’ll come back to this page.", mono "Returns to /play" (current path), primary block "Sign In Again", text button "Use a Different Account" | button |
| `signing_in` | "Sign In Again" pressed | button `loading`, label "Opening Sign-In…", `aria-disabled` | navigation to `/sign-in?redirect_url=<path+query>` |

  "Use a Different Account" runs `signOutEverywhere()` (§8.6) and goes to `/sign-in?redirect_url=/play` (never the old URL, which may belong to the other user). A sign-in in another tab (Clerk `isSignedIn` true again, or `rc-auth` `signed_in`) closes the modal.
- **Components:** 1A·P2 `ResponsiveDialog` (Dialog `size="sm"` on desktop, Sheet `height="auto"` on phones), `hideClose`, Esc and outside click prevented (`onEscapeKeyDown`, `onInteractOutside` → `preventDefault`); 1A·P0 `Button` (`loading`, `loadingLabel`).
- **A11y:** `aria-labelledby` = h2; focus starts on "Sign In Again"; Tab is trapped; background inert (Radix).
- **Overlay arbitration (IS §2.7):** priority 1, pre-empts the palette and shortcuts (they close first).

### 4.10 Flow map (`V3FlowMap`)

- **Board:** `DR/V3FlowMap.dc.html` (3200×2000, no enum; 114 nodes, 105 edges, inventoried in IS §1).
- **Route:** none. Deliverable 1A·DOC: `REPO/docs/route-map.md`, the canonical route table (route → boards → phase → flag → auth class), generated from IS §1.5 and ALLOC §4.2, and the source for `lib/auth/route-classes/p01.ts` (§7.6) and `lib/nav/destinations.ts` (SPEC §8.2). A unit test (`lib/auth/route-classes/route-classes.test.ts`) checks that every route listed as "public" in the doc is classified public by middleware and every member route is classified member.

### 4.11 Dev and system routes added by P1

| Route | Owner | Mode | Purpose |
|---|---|---|---|
| `/dev/ui`, `/dev/ui/sections/<id>` | 1A·P0 | flow (gallery) | kit gallery (SPEC §3.7) |
| `/dev/ui/shell?user&content&current&back` | 1A·P3 (+1A·P7 users `payment_last_day`, `payment_expired`) | lock | shell demo |
| `/dev/ui/stage?layout&banner&chrome&flip&debug` | 1A·P5 | lock | board stage demo |
| `/dev/ui/skeletons?variant` | 1A·P7 | lock (`game`) / flow | V3Skeletons |
| `/dev/ui/data` | 1B·F8 | flow | data-layer demo: QueryState states, inline 429 (fault and real limiter), 401 modal, 500 toast, 503 (`maintenance` code, logged only in P1), legacy-envelope adapter |
| `/too-many-requests` | 1B·F8 | flow (marketing chrome) | 429 page |

All `/dev/**` routes fail closed (SPEC D11: `devRoutesEnabled()`) and are entries in the test-hook registry (`lib/test-hooks/registry.ts`, §11.6), so `prod-guard.spec.ts` proves each returns 404 in a production-mode build; `/too-many-requests` is public and `noindex`.

### 4.12 Wrapped legacy route families

The 11 families listed in SPEC §9.3 keep their content and data flows; members get the shell (flow mode), non-members and signed-out visitors keep the marketing chrome. Their remaining client gates (`useRequireAuth`, `useRequireSubscription`) are fixed by 1B·F4d so a failed fetch never redirects (AC #4/#5). Middleware adds the claim gate (P1-11).

---

## 5. UI ↔ API data flow

### 5.1 The five channels in P1 (CDL §0, API §3.1)

| Channel | P1 use | Never in P1 |
|---|---|---|
| RSC loader (server component → service) | `(app)/layout.tsx` → `getViewer()` → `ShellUser` + `qk.me()` seed; `/dev/ui/*` demo data | `fetch("/api/…")` from a server component |
| `api()` + TanStack Query | `qk.me()` refetch outside `(app)`, `/dev/ui/data`, all new code from here on | legacy pages (they keep raw `fetch` until their phase rebuilds them) |
| Socket.io | unchanged v1 game protocol (+ H6 fixes) | user room, `entitlement:changed` (P2/P4) |
| SSE | none | coach (P7) |
| Beacon / outbox | none | P2 checkpoints, P5 outbox |

### 5.2 Viewer bootstrap: the sequence

```
Member hard-loads /play (inside app/(app))
  edge   middleware.ts         scanner paths → 404 before Clerk. Clerk JWT verify (no DB). x-request-id + x-mw-start set.
                               Member gate on md.entitled / md.lapsed (when MIDDLEWARE_MEMBER_GATE=on). X-Robots-Tag on non-prod.
  node   app/layout.tsx        root layout (static parts), <Providers> (after 1B·J)
  node   app/(app)/layout.tsx  getShellSession() → getViewerRecord()   ← React cache(): ONE $queryRaw
                                 SELECT <VIEWER_COLUMNS>, c."blitzRating", c."rapidRating"
                                 FROM users u LEFT JOIN chess_com_profiles c ON c."userId" = u.id
                                 WHERE u."googleId" = $1 LIMIT 1
                               → toShellSession(record)              → AppShellView user prop (1A)
                               → toMeData(record, flags)             → qc.setQueryData(qk.me(), me) → <HydrationBoundary state={dehydrate(qc)}>
                               getFlags(viewer)                      ← posthog-node local evaluation, memoised per request, no network when warm
  client UserSync              getQueryData(qk.me()) present → write legacy useUserStore (user + subscription mirror) → no fetch
                               onboarding redirect (as today) if !me.user.onboarded and path not exempt
  client legacy page           useRequireSubscription reads the store → renders
Network: 1 document request. 0 API calls for identity or entitlement. 1 DB statement. 0 Clerk Backend API, 0 Dodo.

Member hard-loads /game/<ref> (outside app/(app))
  client UserSync              no seed → api(endpoints.me) once (staleTime 5 min) → store → page gate
Network: 1 document + 1 GET /api/me (R1, 1 statement). Before P1: POST /api/user/sync → GET /api/subscription in sequence (+ /api/user/email when the store was cold).

First sign-in ever (no users row yet)
  getViewerRecord()  the SELECT returns no row → provisionUser(clerkUserId) (one Clerk BAPI users.getUser, create row + stats)
                     the Clerk user.created webhook usually wins the race; P2002 → re-read. Declared GET side effect "provision_user" (§7.2 step 8)
```

Until 1B·J lands, `(app)/layout.tsx` does not seed the cache, so `UserSync` makes one `GET /api/me` on every page. That already meets T12's "exactly one" and removes the waterfall; after 1B·J the in-`(app)` count drops to zero.

**Why `$queryRaw` and not `relationLoadStrategy: "join"`.** Prisma 6.17 offers the join strategy only behind the `relationJoins` preview flag, and turning that flag on changes the default load strategy of every existing query in the app. P3 decides on the flag for the review loader (DM §2 rule 10). Until then the viewer read is one hand-written statement whose row type is checked by `lib/auth/viewer.test.ts` against `VIEWER_SELECT` (the same columns), so a schema change that renames a column fails a unit test, not production.

### 5.3 Query keys, stale times and invalidation in P1

`lib/api/keys/` ships the full namespace skeleton from CDL §3.3 as one file per domain (`me.ts`, `catalog.ts`, `billing.ts`, `game.ts`, `review.ts`, `train.ts`, `coach.ts`, `learn.ts`, `play.ts`, `account.ts`, `tournament.ts`, `admin.ts`, `system.ts`) plus `index.ts`, so later phases fill their own file and never rename. P1 reads only these keys:

| Key | Endpoint (client refetch) | First paint | `staleTime` | `gcTime` | Focus refetch | Seeded by | Invalidated / updated by |
|---|---|---|---|---|---|---|---|
| `qk.me()` → `["me"]` | `GET /api/me` (`private, no-cache` + strong ETag) | `getViewer()` in `(app)/layout.tsx` | 5 min | 30 min | yes, when stale | `(app)/layout.tsx` (after 1B·J); otherwise `UserSync`'s first fetch | `router.refresh()` after billing-portal return (re-seeds through `HydrationBoundary`, newer data wins); `setQueryData` from the `POST /api/billing/refresh` response (it returns `MeData.entitlement`); `invalidate(qk.me())` after checkout success; any 402 response (CDL §6.2 rule 1); sign-out → `queryClient.clear()` |
| `qk.catalog.openingsIndex()` → `["catalog","openings","index"]` | `GET /api/openings` (`public-static`: browser revalidates with the strong ETag, the CDN answers) | none | 24 h | 24 h | no | — | admin opening writes `revalidateTag("openings")` + CDN purge by tag (P12). **Temporary:** P8 CAT-3 replaces the endpoint shape, moves the `/dev/ui/data` demo to `qk.catalog.openings({})` and deletes this key and `OpeningsIndexData` (CC R-15) |
| `qk.billing.refresh()` (mutation key only) | `POST /api/billing/refresh` | — | — | — | — | — | on success `setQueryData(qk.me(), merge entitlement)`; the legacy store's `fetchSubscription` calls the same endpoint |

Rules that every later phase inherits (CDL §3.3): the first key segment is the domain; ids are refs or slugs; filters are one normalised object at the end; viewer-scoped keys carry no user id; queries are declared once with `queryOptions()` in `lib/api/queries/<domain>.ts`; a phase adds keys by editing **its own domain file** under `lib/api/keys/` and, for a new domain, one export line in `lib/api/keys/index.ts`.

### 5.4 `QueryClient` defaults (`lib/api/query-client.ts`)

| Option | Value | Why |
|---|---|---|
| `staleTime` | 30 s (per-key overrides above) | CDL §3.2 |
| `gcTime` | 5 min | |
| `retry` | `retryQuery`: 2× on `network`, `timeout`, `internal`, `unavailable`; 1× on `upstream_unavailable`; never on any other 4xx | CDL §3.7 |
| `retryDelay` | `err.retryAfterSec × 1000` when present, else `min(1000 · 3^attempt, 8000) × (0.75 + rand · 0.5)` | jittered, honours `Retry-After` |
| `refetchOnWindowFocus` / `refetchOnReconnect` | true (stale queries only) | |
| `networkMode` | `"online"` (queries pause offline) | CDL §3.2 |
| mutations | `retry: 0`, `networkMode: "online"` | never auto-retry a user action |
| `queryCache.onError` / `mutationCache.onError` | `reactToApiError(err, { kind, meta })` | one global reaction (§5.6) |

Server side, `lib/query/server.ts` exports `getServerQueryClient = cache(() => makeQueryClient())` (one per request) and `dehydrateFor(qc)`. DTOs are JSON-safe (ISO strings, no BigInt), so no custom serializer is needed.

### 5.5 Per-screen data flow

| Screen | First paint | Client reads | Mutations | Push / polling | Errors |
|---|---|---|---|---|---|
| App shell (§4.1) | RSC: `ShellUser` prop from `getShellSession()`; `qk.me()` seed | none on boot; `qk.me()` focus refetch after 5 min stale (only consumers: `UserSync`, `useFlag`, F8 watchers) | none | none in P1 (`entitlement:changed` is P4) | layout render failure → root `error.tsx` (unchanged); a missing users row → marketing chrome (SPEC §9.3) |
| Account menu | from `ShellUser` | — | Theme → next-themes (local); Manage Billing → `window.open("/api/customer-portal")` + `router.refresh()` on return (SPEC §8.2); Sign Out → `signOutEverywhere()` (1B·J), which calls `POST /api/session/clear` first | — | portal 302 failure stays in the new tab; a failed `session/clear` never blocks sign-out |
| Command palette | — | legend rows: raw `fetch("/api/legends/search?name=")`, 150 ms debounce, stale-guard (SPEC §8.2). **Not migrated in P1**: the route keeps `{ success, data: { query, count, legends } }`; a later move to `{ data: {…} }` is compatible because the palette reads `json.data.legends` | — | — | offline/fetch failure → `palette-legends-offline` |
| Payment banner | server-derived in `ShellUser` | — | dismiss → `sessionStorage` (SPEC); Update Payment → portal | — | — |
| Toasts | — | — | — | — | — |
| `/dev/ui/data` | static shell | `useQuery(openingsIndexQuery)` on button press; `useQuery(meQuery)`; "Check Database" = `api(endpoints.health, { query: { deep: "1" } })` | "Simulate 401" = `api(endpoints.me, { fault: 401 })` | — | renders every `QueryState` branch (§5.7) |
| `/too-many-requests` | static HTML | none | none | none | — |
| Session-expired modal | — | — | "Sign In Again" → navigation; "Use a Different Account" → `signOutEverywhere()` | `BroadcastChannel("rc-auth")` | — |
| Legacy pages in `(app)` | legacy client fetches (unchanged) | unchanged except `useDataStore` openings envelope and `useSocketToken` envelope | unchanged; `fetchSubscription` now `POST /api/billing/refresh` | unchanged (P9/P12 remove the polls) | legacy 402 handling via `isSubscriptionRequiredResponse` keeps working: it checks the 402 status first (`lib/billing/client.ts:121`) |
| `/pricing` activation (legacy, `checkout=success`) | unchanged | `waitForEntitlement({ refresh: fetchSubscription })`: 1 + 6 calls of `POST /api/billing/refresh` 2 s apart, inside the `billing-refresh` bucket (10 / 60 s) | — | the 2 s × 6 poll stays until P4's `/checkout/activating` | 429 keeps the last known state and retries on the next tick |
| `/game/*`, `/analysis/*`, `/onboarding` | unchanged | `UserSync` → one `GET /api/me` | unchanged | unchanged | — |

### 5.6 Global error reactions (`reactToApiError`, `lib/api/errors.ts`)

| Code (HTTP) | Global reaction | Host instead |
|---|---|---|
| `aborted` (client) | ignore | — |
| `unauthorized` (401) | `sessionGuard.onUnauthorized()`: `await Clerk.session?.reload()`; on success invalidate failed active queries and retry once; still 401 → `overlays.request("session_expired", { source: "api_401" })` + `BroadcastChannel("rc-auth").postMessage({ type: "session_expired" })` | — |
| `subscription_required` (402) | `invalidate(qk.me())`, then `router.replace(paywallTarget(details.reason, currentAppPath()))`: `trial_available` → `/pricing?reason=required&redirect_url=…`; `trial_used`, `expired`, `payment_failed` → `/pricing?reason=ended&redirect_url=…` (B26 default). P7 D18 and P11 S4 later replace the `ended` branch with the in-place `RenewSheet` on `(app)` pages | host sets `meta.paywall = "inline"` (coach, P7) |
| `payment_update_required` (402, Phase 0 checkout only) | `invalidate(qk.me())`; no navigation (the Phase 0 checkout UI already shows the portal link) | P11 D18 maps it to the `RenewSheet` with `paymentFirst` |
| `rate_limited` (429) | none (never auto-retry a mutation) | `RetryCountdown` on the host |
| `maintenance` (503) | P1: Sentry breadcrumb + toast "Down for maintenance, back soon" (P11 replaces it with the banner) | — |
| `internal` (500), `unavailable` (503), `upstream_unavailable` (502), `network`, `timeout` | queries: retry policy (§5.4), then the inline `ErrorState` if no data, else silent (stale data stays); mutations: `notify.error(mutationErrorCopy(meta) + " · Event " + requestId.slice(0, 8), { action: Retry })` | `meta.errorUi = "inline"` for forms |
| `contract_mismatch` (client) | `Sentry.captureMessage` with the zod issues and route template (dev/test only, where responses are parsed) | `ErrorState` |
| `validation_failed`, `invalid_json`, `payload_too_large`, `conflict`, `already_subscribed`, `forbidden`, `not_found`, `not_configured` | none | host maps `fields` / `details.reason` |

`paywallTarget` reuses `paywallUrl()` (`lib/billing/client.ts:43`) and `stripCheckoutParams()` so checkout params never ride into `redirect_url`. The `why=` parameter of the draft is gone: the pricing page (P11 S2) derives the detail from `qk.me().entitlement`.

### 5.7 `QueryState` (`components/data/QueryState.tsx`)

One mapping from query status to UI for every client-read region (CDL §8.2):

| Query status | Rendered |
|---|---|
| `pending` with no data | the region's designed skeleton (`fallback` prop; default `SkeletonRegion` with 3 `SkeletonRow`s), never a spinner alone |
| `error`, no data, `rate_limited` | `RetryCountdown` + disabled retry control |
| `error`, no data, other | `ErrorState` ("Couldn’t load {object}", body with "Event {8 hex}", Retry button calling `refetch`) |
| `success`, empty (`isEmpty(data)`) | `empty` prop (an `EmptyState`) |
| `success` | children(data) |
| background refetch | children stay; `aria-busy` on the region; no hairline in P1 |

### 5.8 Optimistic updates, prefetching, polling

- **Optimistic updates:** none in P1 (no new mutations with designed instant feedback). The pattern (`onMutate` snapshot + rollback, CDL §3.6) is documented in `lib/api/README.md` for P2+ (CA AP-30 lists the first candidates: draw and rematch offers in P2, "Sync now" in P4).
- **Prefetching:** none added. Nav links keep Next's default `<Link>` behaviour; P2 introduces `AppLink` (intent prefetch, CDL §3.8) when member pages become RSC. A `prefetchQuery` of a route that has side effects is impossible by construction: GETs may only run the side effects their registry entry declares (§7.2 step 8).
- **Polling:** none added. The existing legacy polls (matchmaking 1 s, tournament find-match, activation `waitForEntitlement` 2 s × 6) remain until P4/P9/P12; the activation poll now hits `POST /api/billing/refresh` inside its bucket.

---

## 6. Data model

### 6.1 Prisma changes (migration M1)

`prisma/schema.prisma` (append the three models; add two fields to `User`; models follow DM §5.1 and `SP/plan/schema.target.prisma`):

```prisma
/// M1 (P1). Webhook idempotency for Dodo and Clerk. Clerk rows never store the payload (PII).
/// Dodo payloads are kept 180 days (ALLOC B15), Clerk rows 30 days, then deleted by the daily cron.
model WebhookEvent {
  provider    String    @db.VarChar(16)    // "dodo" | "clerk"
  eventId     String    @db.VarChar(100)   // Dodo `webhook-id`, Clerk `svix-id`
  type        String    @db.VarChar(64)    // "subscription.active", "user.created", …
  eventTime   DateTime?                    // provider timestamp (Dodo payload.timestamp, Clerk event timestamp)
  userId      BigInt?                      // users.id once resolved; no FK (rows outlive deleted users)
  status      String?   @db.VarChar(16)    // "applied" | "ignored" | "stale" | "unmatched" | "error"
  error       String?   @db.VarChar(500)   // safe message, never a stack
  payload     Json?                        // Dodo only
  receivedAt  DateTime  @default(now())
  processedAt DateTime?

  @@id([provider, eventId])
  @@map("webhook_events")
}

/// M1 (P1). Fixed-window counters for BURST limits only (window ≤ 300 s). Created UNLOGGED by hand in the
/// migration SQL: no WAL; Neon empties it when the compute restarts or scales to zero. A window ≤ 300 s cannot be
/// reset by a suspend, because Neon suspends only after 300 s without queries, by which time the window has expired.
/// Never store daily or monthly budgets here (use RateLimitWindow or count the source rows).
model RateLimitBucket {
  key     String   @id @db.VarChar(120)    // "rl:<bucket>:c:<clerkUserId>" | "rl:<bucket>:ip:<sha256(pepper‖ip)[0:16]>"
  count   Int
  resetAt DateTime

  @@map("rate_limit_buckets")
}

/// M1 (P1). The same counters for DURABLE limits (window > 300 s, e.g. 5 per hour, 20 per day). Logged, so they
/// survive a compute restart. Same statement as the burst store; swept daily.
model RateLimitWindow {
  key     String   @id @db.VarChar(120)
  count   Int
  resetAt DateTime

  @@map("rate_limit_windows")
}

model User {
  // … existing fields unchanged …
  /// M1 (P1). Provider-side time of the snapshot last applied (Dodo webhook timestamp or the API object's own
  /// timestamp). The billing compare-and-set key (ADB DB-07, CA AP-06). Never set from now().
  subscriptionSourceAt DateTime?
  /// M1 (P1). Bumped by every write that changes the member's game list (P2 finish, P3 analysis and review
  /// completion, P4 import and purge). P3's archive ETag reads it from the viewer row, at zero extra cost (CA AP-19).
  gamesVersion         Int       @default(0)
}
```

No generator change: `relationJoins` stays off, because enabling it flips the default load strategy of every existing query (DM §2 rule 10; the viewer uses one `$queryRaw` instead, §5.2). P3 revisits the flag.

### 6.2 Migration file

Folder `prisma/migrations/20261103000000_m1_rate_limits_webhook_events/migration.sql`, generated with `prisma migrate diff` (ADB §4.3 step 1) against a throwaway branch of the Neon dev project, then hand-edited:

```sql
SET lock_timeout = '5s';

-- Prisma emits CREATE TABLE; hand-edited to UNLOGGED (Prisma does not model storage parameters, so no drift).
CREATE UNLOGGED TABLE "rate_limit_buckets" (
    "key"     VARCHAR(120) NOT NULL,
    "count"   INTEGER      NOT NULL,
    "resetAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "rate_limit_windows" (
    "key"     VARCHAR(120) NOT NULL,
    "count"   INTEGER      NOT NULL,
    "resetAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "rate_limit_windows_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "webhook_events" (
    "provider"    VARCHAR(16)  NOT NULL,
    "eventId"     VARCHAR(100) NOT NULL,
    "type"        VARCHAR(64)  NOT NULL,
    "eventTime"   TIMESTAMP(3),
    "userId"      BIGINT,
    "status"      VARCHAR(16),
    "error"       VARCHAR(500),
    "payload"     JSONB,
    "receivedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("provider", "eventId")
);

-- Both are metadata-only on PostgreSQL ≥ 11 (nullable column; constant default): a brief ACCESS EXCLUSIVE lock, no rewrite.
ALTER TABLE "users" ADD COLUMN "subscriptionSourceAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "gamesVersion" INTEGER NOT NULL DEFAULT 0;
```

Existing rows keep `subscriptionSourceAt = NULL`; `shouldApplySnapshot` then falls back to today's `subscriptionUpdatedAt` ordering for them (§8.11), so no backfill is needed.

### 6.3 Indexes and the queries they serve

| Index | Query | Plan expectation (`EXPLAIN` on the Neon dev database via Neon MCP `explain_sql_statement`) |
|---|---|---|
| `rate_limit_buckets_pkey (key)`, `rate_limit_windows_pkey (key)` | the limiter upsert (§8.1): `INSERT … ON CONFLICT ("key") DO UPDATE … RETURNING "count", "resetAt"` | `Insert on rate_limit_buckets … Conflict Arbiter Indexes: rate_limit_buckets_pkey`; ≤ 2 ms in-region |
| seq scan (tiny tables: rows only for active windows) | daily sweep of both: `DELETE FROM <table> WHERE "resetAt" < (now() AT TIME ZONE 'UTC') - interval '1 hour'` | seq scan |
| `webhook_events_pkey (provider, eventId)` | the claim statement of both webhooks (§7.7) | `Conflict Arbiter Indexes: webhook_events_pkey` |
| `webhook_events_pkey` | outcome update `UPDATE webhook_events SET status=$3, "userId"=$4, error=$5, "processedAt"=now() WHERE provider=$1 AND "eventId"=$2` | PK index scan |
| none (seq scan, ≤ a few thousand rows) | retention sweep `DELETE FROM webhook_events WHERE ("provider"='dodo' AND "receivedAt" < (now() AT TIME ZONE 'UTC') - interval '180 days') OR ("provider"='clerk' AND "receivedAt" < (now() AT TIME ZONE 'UTC') - interval '30 days')` | daily, cheap; add `(receivedAt)` only if the table passes 50k rows |
| existing `users_googleId_key` (unique) | `getViewerRecord()`: the one `$queryRaw` in §5.2 | `Nested Loop Left Join` → `Index Scan using "users_googleId_key"` + `Index Scan using "chess_com_profiles_userId_key"`; one round trip |
| `users_pkey` | billing compare-and-set (§8.11): `UPDATE users SET … WHERE id = $1 AND "subscriptionSourceAt" IS NOT DISTINCT FROM $2` (Prisma `updateMany` with `subscriptionSourceAt: { equals: <read value> }`) | PK index scan, 1 row |
| existing `users_subscriptionStatus_idx` | daily `membership-reconcile` (§7.8): `SELECT id, "subscriptionId", "subscriptionSourceAt" FROM users WHERE "subscriptionStatus" IN ('active','on_hold','past_due','pending') AND "currentPeriodEnd" < now() - interval '1 hour' AND "dodoCustomerId" IS NOT NULL ORDER BY "currentPeriodEnd" LIMIT 50` | index scan on status, filter on period end; ≤ a few hundred rows scanned |
| existing `users_email_key` (unique) | `provisionUser()` relink: `WHERE email = lower($1)` (verified primary only) | index scan |

The five duplicate `users` indexes (ADB DB-01) stay until contract step C1; they cost write amplification, not reads. `gamesVersion` needs no index (it is only read from the viewer row).

### 6.4 Safety notes (CLAUDE.md applies)

1. **No `prisma db push` and no `prisma migrate dev` against any Neon database** (CC R-20). `db push` would silently recreate `rate_limit_buckets` as a logged table, and from P2 it drops hand-written partial indexes. Generate SQL with `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "$THROWAWAY_DIRECT_URL" --script` against a throwaway branch of the **Neon dev project** (`replay-chess-dev` after H10), created for this and deleted after (Neon MCP `create_branch` / `delete_branch`). `migrate dev` runs only against a local Docker Postgres. Ask before deleting anything.
2. Before applying: `pnpm --filter web exec prisma migrate status` against the dev `DIRECT_URL` (read-only) must show only M1 pending. If it shows drift, stop and ask the owner (ALLOC §1.3; never resolve drift with `migrate dev`).
3. Apply on the dev database: `DIRECT_URL=<dev direct> pnpm --filter web exec prisma migrate deploy`. M1 adds three tables and two metadata-only columns; `lock_timeout` 5 s guards the `ALTER TABLE users`.
4. **Not** applied to production in P1, and **not** cherry-picked to `main`. `.github/workflows/e2e-tests.yml:31-36` runs `migrate deploy` against `secrets.PERF_DATABASE_URL` on `main` pushes; the H cherry-picks contain no `prisma/` paths (verified with `git show --stat` before each pick, and by `main-guard.yml`, §13.4).
5. `replay_app` (F9) is created **after** M1, so the default-privilege grants also cover these tables; the role cannot `TRUNCATE` or `DROP`.
6. Rollback: the three tables and the two columns are unused by any legacy code path; dropping them is a contract step that needs the owner's confirmation (CLAUDE.md rule 5).
7. Verify after apply: `SELECT relname, relpersistence FROM pg_class WHERE relname IN ('rate_limit_buckets','rate_limit_windows')` → `u`, `p`.

### 6.5 Backfills, data scripts and runbooks

| Script / runbook | What | Idempotent | Run |
|---|---|---|---|
| `scripts/db/split-dev-project.md` (1B·H10) | The H10 runbook: (1) the owner creates the Neon Free project `replay-chess-dev` (same region and Postgres major as today's dev branch, autoscaling max 0.5 CU); (2) `pg_dump --format=custom --no-owner --no-privileges "$OLD_DEV_DIRECT_URL" -f dev.dump` on the owner's machine (read-only on the old branch); (3) `pg_restore --no-owner --no-privileges -d "$NEW_DIRECT_URL" dev.dump` into the empty database; (4) compare row counts of `users`, `games`, `openings` (3,641), `legends` and `_prisma_migrations`; `prisma migrate status` clean; (5) repoint `.env.development.local`, `.env.test`, the Vercel `replay-chess-dev` `DATABASE_URL`/`DIRECT_URL`, and any GitHub secret that names the old dev host; (6) hand the new endpoint host to 1A·P6's seed guard (§13.2); (7) the owner updates CLAUDE.md's environment table; (8) the old `dev` branch of `withered-cake-82837167` stays untouched for 14 days and is deleted only after the owner confirms (CLAUDE.md rule 5); (9) the owner gives the Neon MCP a key for the new project | restore into an empty DB only | once, day 0–1, before M1 |
| `scripts/backfill/sync-clerk-claims.ts` (1B·F4b) | For every `users` row with `isActive` (batches of 100 ordered by `id`), compute `RcPublicMetadata` (§8.4) and call `clerkClient().users.updateUserMetadata(googleId, { publicMetadata })` only when it differs from the user's current `publicMetadata`; sleep 120 ms between calls (Clerk BAPI rate limit 100 req / 10 s on dev); `--dry-run` prints the count first | yes (compares before writing) | dev once after F4b deploys; then `MIDDLEWARE_MEMBER_GATE=on` on dev. Prod in P13 |
| `scripts/db/replay-app-role.sql` (1B·F9) | ADB §5.4 role SQL | `CREATE ROLE` guarded by `DO $$ … IF NOT EXISTS` | dev database once, owner confirms (§14.2 Q-05) |
| `scripts/dev/personas.ts` (1Q·1) | Resets a **pool** user (`E2E_POOL_01…24`) or the dedicated persona user S to a named persona by writing the billing columns: `member \| trial5 \| trial_last_day \| payment_banner \| payment_last_day \| payment_expired \| lapsed \| none`. Each later phase adds its personas as a file under `e2e/personas/pNN.ts` (`bank-empty`, `coach-capped`, `onboarding-fresh`, …). Guards: `prisma/seed-guards.ts` from 1A·P6 (dev host allow-list, user-count tripwire, `.env.development.local` only); refuses the shared users A–R | yes | by the E2E lease fixture (§12.0), or by hand on dev |

No schema backfill: the M1 tables start empty and the new columns are nullable or defaulted.

### 6.6 Dev seed data

- 1A·P6's content seed (6 legends, 5 legend positions; SPEC §11) — needed for T2.
- E2E persona user S and the 24-user persona pool (1Q·1) for real-data payment states on the dev site; demo users cover the same states without data (`/dev/ui/shell?user=…`).

### 6.7 Storage rules every later phase inherits

1. `UNLOGGED` tables hold only state that is safe to lose at any moment: burst limit windows ≤ 300 s. Never daily or monthly budgets (P10's Resend daily cap, P7's coach caps), never anything a user paid for (CF F-NEON-3).
2. Every timestamp comparison in raw SQL uses `(now() AT TIME ZONE 'UTC')`, because Prisma's `DateTime` is `timestamp(3)` without zone, stored in UTC.
3. A GET never writes, except the side effects its registry entry declares (§7.2 step 8).
4. Every new table lands with the index for each query that reads it, listed in the phase's §6.3 with the expected plan.

---

## 7. API

### 7.1 Error codes and envelope (`@repo/contracts/http/codes`, `…/envelope`)

```ts
// REPO/packages/contracts/src/http/codes.ts — the one code ledger (CC R-06). Append-only; adding a code is an additive
// contract change, made by the first phase that produces it.
export const ERROR_STATUS = {
  invalid_json: 400, validation_failed: 400,
  unauthorized: 401,
  subscription_required: 402, payment_update_required: 402,
  forbidden: 403, not_found: 404,
  conflict: 409, already_subscribed: 409,
  payload_too_large: 413,
  rate_limited: 429,
  internal: 500,
  upstream_unavailable: 502,
  maintenance: 503, not_configured: 503, unavailable: 503,
} as const;
export type ErrorCode = keyof typeof ERROR_STATUS;
/** Statuses any phase may use. codes.test.ts asserts every code maps to exactly one of these. */
export const ALLOWED_STATUSES = [400, 401, 402, 403, 404, 409, 410, 412, 413, 422, 429, 500, 502, 503] as const;
/** details.reason for 402 subscription_required. P10 appends "paused". */
export const SUBSCRIPTION_REASONS = ["trial_available", "trial_used", "expired", "payment_failed"] as const;
/** details.reason for 409 conflict and 403 forbidden. Append-only; each phase registers the reasons it introduces (CC R-06 list). */
export const CONFLICT_REASONS = [] as const;
export const FORBIDDEN_REASONS = ["cooldown"] as const;

// REPO/packages/contracts/src/http/envelope.ts
export const ErrorBody = z.object({
  code: z.enum(Object.keys(ERROR_STATUS) as [ErrorCode, ...ErrorCode[]]).catch("internal"),
  message: z.string(),                                   // one safe English sentence; never an exception message
  fields: z.record(z.string(), z.string()).optional(),   // validation_failed: path → message
  details: z.record(z.string(), z.unknown()).optional(), // { reason }, { issues }, { provider }, { upgradeUrl }, { retryAt }, { bucket }
  retryAfterSec: z.number().int().nonnegative().optional(),
  requestId: z.string(),
});
export const ErrorEnvelope = z.object({ error: ErrorBody });
export const PageMeta = z.object({ nextCursor: z.string().nullable(), total: z.number().int().optional() });
export const ok = <T extends z.ZodType>(data: T) => z.object({ data, meta: PageMeta.partial().optional() });
```

Codes that later phases add (so nobody adds them twice): `in_flight` 409, `idempotency_key_reused` 422, `illegal_position` 422, `illegal_moves` 422 (P2); `gone` 410 (P3); `fair_use_limit` 429 (P7); `reverification_required` 403 (P10, or P12 if it merges first); `precondition_failed` 412 (P12). Never codes: `membership_ended` (→ 402 `subscription_required` + reason), `origin_mismatch` (→ 403 `forbidden`), `upstream_timeout` / `upstream_error` / `refresh_failed` (→ 502 `upstream_unavailable` + `details.kind`), `upstream_rate_limited` (→ 429 `rate_limited` + `details.source`), `unauthenticated`, `bad_request`, `unsupported_media_type`.

| Code | HTTP | When (P1 producers) | `details` |
|---|---|---|---|
| `invalid_json` | 400 | body is not JSON (wrapper) | — |
| `validation_failed` | 400 | zod failure on params/query/body (wrapper) | `issues: [{ path, code, message }]`; `fields` mirrors them as `path.join(".") → message` |
| `unauthorized` | 401 | no Clerk session; inactive user; bad internal token / cron bearer / webhook signature (no detail) | — |
| `subscription_required` | 402 | `auth: "member"` and not a member | `reason` (§8.3), `upgradeUrl` |
| `payment_update_required` | 402 | Phase 0 checkout when the subscription is `on_hold` beyond grace (kept) | `upgradeUrl` |
| `forbidden` | 403 | signed in but not admin; signed-in caller on an internal-only route (H2); cross-site cookie mutation (middleware) | `reason` from `FORBIDDEN_REASONS` when one applies |
| `not_found` | 404 | missing entity; also any entity the viewer must not learn about (API §2.6 404-vs-403 rule); scanner paths (middleware) | — |
| `conflict` | 409 | Prisma P2002; game no longer in progress (H2) | `target`, `reason` |
| `already_subscribed` | 409 | Phase 0 checkout (kept) | — |
| `payload_too_large` | 413 | `Content-Length` > `maxBodyBytes`, or the streamed body passes it | `limitBytes` |
| `rate_limited` | 429 | `route({ rateLimit })` denied; `Retry-After` header = `retryAfterSec` | `bucket` |
| `internal` | 500 | anything unknown; message always "Something went wrong" | — |
| `upstream_unavailable` | 502 | Dodo/Clerk BAPI/PostHog failure in a class-X route | `provider`, `kind` |
| `maintenance` | 503 | reserved (P11 notice); P1 producer is fault injection only | `retryAt` |
| `not_configured` | 503 | Phase 0 billing env missing (kept) | — |
| `unavailable` | 503 | Prisma `P1001`/`P1017` after the one GET retry, `P2024`/`P2028` pool/transaction timeouts | `retryAfterSec: 2` |

Success: `200 { data }`, `201 { data }` + `Location`, `204` (no body), `304` (ETag hit). Every 4xx/5xx is `Cache-Control: private, no-store`. Every response carries `x-request-id`.

**Legacy compatibility (one release, ≥ 14 days, tracked by the Sentry tag `legacy_envelope`):**
- 402 bodies also carry top-level `code: "subscription_required"` and `upgradeUrl` while `LEGACY_402_MIRROR=on` (default on in P1, removed in P2), for old PWA bundles that read `body.code`.
- `GET /api/socket-token` also carries top-level `token` and `expiresAt`.
- `lib/api/legacy.ts` (`unwrapLegacy`) lets new client code read the three legacy success shapes (`{ success, data }`, raw billing objects, `{ data }`) and the legacy error shapes (`{ error: string, code? }`), mapping status → code when no code exists.

### 7.2 The route wrapper (`lib/api/route.ts`)

Every `route()` call starts from an endpoint entry in the contracts registry (§7.3), so the method, path, auth mode, cache tier, rate limit, schemas and declared side effects exist in one place that the wrapper, the contract tests, the authz walker, the cache-tier lint and the OpenAPI generator all read.

```ts
// REPO/packages/contracts/src/http/endpoint.ts (shared, server and test use only)
export type AuthMode = "public" | "optional" | "user" | "member" | "owner" | "admin" | "internal" | "cron" | "webhook";
export type CacheTier = "public-immutable" | "public-static" | "public-short" | "private-etag" | "no-store" | "sse";
export type RateLimitSpec = {
  bucket: string; limit: number; windowSec: number; by: "user" | "ip" | "user+ip";
  store?: "burst" | "durable";                  // default "burst"; burst with windowSec > 300 throws at module load
};
export type SideEffect = "provision_user" | "cron" | "kick_cas" | "daily_plan" | "legend_facts";   // append-only (CA §5 GET purity)
export type EndpointDef = {
  id: string;                                   // "me.get", "catalog.openings.index", "webhook.dodo"
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;                                 // "/api/me"
  auth: AuthMode;                               // required, no default (lint fails a route file without it)
  class?: "R1" | "R2" | "W1" | "W2" | "X" | "I" | "WH" | "P";   // OPT §2.1 endpoint class; Sentry tag
  cache?: CacheTier;                            // default "no-store"
  publicStatic?: { sMaxAge: number; swr: number; tags: string[] };   // required with "public-static"
  publicShort?: { tags: string[] };             // "public-short": CDN 15 s + swr 60 s
  versionParam?: string;                        // required with "public-immutable" (e.g. "v")
  rateLimit?: RateLimitSpec | RateLimitSpec[];
  sideEffects?: SideEffect[];                   // the only writes a GET may make
  params?: z.ZodType; query?: z.ZodType; body?: z.ZodType; response?: z.ZodType;
};

// apps/web/lib/api/route.ts (server only)
export function route<E extends EndpointDef, R>(spec: E & {
  maxBodyBytes?: number;                        // default 16_384; webhooks 262_144
  rawBody?: boolean;                            // webhooks: handler gets the raw string, no JSON parse
  owner?: (ctx: Ctx) => Promise<boolean>;       // required with auth "owner"; false → 404
  rateLimitWhen?: (ctx: Ctx) => boolean;        // e.g. health: only when deep=1
  etag?: (data: R) => string;                   // default for "private-etag": fnv1a64(JSON)
}, handler: (ctx: Ctx<Infer<E["params"]>, Infer<E["query"]>, Infer<E["body"]>>) => Promise<R | Response>):
  (req: NextRequest, rc: { params: Promise<unknown> }) => Promise<Response>;

type Ctx<P = unknown, Q = unknown, B = unknown> = {
  req: NextRequest; requestId: string; params: P; query: Q; body: B; rawBody?: string;
  now: Date;                                    // Date.now(), or x-rc-now when testHooksEnabled() and x-e2e-token matches (CT X5)
  viewer: Viewer | null;                        // loaded for optional|user|member|owner|admin (React cache, shared with services)
  clerkUserId: string | null;                   // from auth() (local JWT verify); never called for "public"
  after: typeof import("next/server").after;
  timing: { mark(name: string): void };         // Server-Timing segments (API responses only, non-production)
};
```

Order of operations (every step is a unit-tested branch in `lib/api/route.test.ts`):

0. **Module load.** Assertions that throw when the route file is imported (so `next build` and the unit tests fail, never production): `public-*` tier with `auth ≠ "public"`; `public-static` without `publicStatic`; `public-immutable` without `versionParam`; `owner` without `spec.owner`; a `burst` rate limit with `windowSec > 300`; `sideEffects` on a non-GET (pointless) or a non-GET route under `/api/cron` (Vercel cron sends GET).
1. **Request id.** `x-request-id` from middleware, else `crypto.randomUUID()`; set on the response and as the Sentry scope tag `request_id`. The Sentry span is `api <id>` with tags `route`, `auth`, `class`, `cache`. `mwLagMs = start − Number(x-mw-start)` when the header is present (CA AP-35).
2. **Test hooks (non-production only).** `testHooksEnabled()` (`lib/env-server.ts`: `NEXT_PUBLIC_APP_ENV ∈ {dev, test}` and `ALLOW_TEST_HOOKS=1`; never `VERCEL_ENV`). (a) `x-rc-fault: 401|402|429|500|503` → answer that error envelope immediately (`429` uses `retryAfterSec` from `x-rc-fault-retry`, default 30; `402` uses `x-rc-fault-reason`, default `trial_used`). The wrapper strips the cache-busting `__rcfault` query parameter (§7.12) before validation. (b) `x-rc-now: <epoch ms>` with `x-e2e-token` equal to `E2E_TEST_TOKEN` (timing-safe) → `ctx.now`. With hooks off both headers are ignored, and the response is byte-identical to one without them (`prod-guard.spec.ts`).
3. **Auth.**
   - `public`: nothing loaded; `auth()` is never called (the route may be served by the CDN and must not depend on a session).
   - `optional`: `auth()`; `viewer = clerkUserId ? await getViewer() : null`.
   - `user`: as optional; `viewer` null → `401 unauthorized`.
   - `member`: as user; `!viewer.entitlement.member` → `402 subscription_required` with `details.reason` (§8.3).
   - `owner`: as user; then `spec.owner(ctx)` false → `404 not_found`.
   - `admin`: as user; `viewer.role !== "admin"` → `403 forbidden` (DB role, not the Clerk claim).
   - `internal`: `verifyInternalRequest(req, spec.id)` (`lib/auth/internal.ts`): `x-internal-token` timing-safe against `INTERNAL_API_SECRET` **and** `spec.id ∈ INTERNAL_ROUTE_IDS`; else `401`. The scheme for P2 onward is Q-18; changing it changes this one function.
   - `cron`: `Authorization: Bearer ${CRON_SECRET}` timing-safe; else `401`.
   - `webhook`: no Clerk; the handler verifies the provider signature on `rawBody`.
4. **Rate limit** (if declared and `rateLimitWhen` is absent or true): `checkRateLimit(spec.rateLimit, keyFor(ctx))` runs **in parallel** with step 3's viewer read, because the key uses `clerkUserId` (from the JWT, no DB) or the hashed IP. Denied → `429 rate_limited` + `Retry-After`. DB error → fail open, Sentry warning `rate_limit_unavailable`, metric `rate_limited.error{bucket}`.
5. **Body.** `Content-Length` > `maxBodyBytes` → `413` before reading. Otherwise read the stream with a reader that stops at `maxBodyBytes + 1` bytes (never `await req.text()` on an unbounded body; CA AP-40); over → `413`; `rawBody` routes stop here; else `JSON.parse` → `400 invalid_json`.
6. **Validation.** `params` (awaited `rc.params`), `query` (`Object.fromEntries(searchParams)` without `__rc*` keys), `body` with zod → `400 validation_failed` with `fields` and `details.issues`.
7. **Handler.** Throws `new ApiError(code, { message?, details?, retryAfterSec? })` for domain errors. Prisma errors map centrally (`lib/api/prisma-errors.ts`): `P2002 → 409 conflict { target }`, `P2025 → 404 not_found`, `P2024|P2028 → 503 unavailable (retryAfterSec 2)`, `P1001|P1017` → one retry after 300 ms for GETs, else `503 unavailable`.
8. **GET purity (dev and test).** The Prisma timing extension counts write statements per request in an `AsyncLocalStorage` store. A GET whose handler ran an `INSERT`, `UPDATE` or `DELETE` throws `get_wrote` (a 500 in tests) unless the endpoint declares `sideEffects`. P1 declarations: `me.get` and every page that reads the viewer → `provision_user`; `cron.daily` → `cron`. In production the count is logged, never thrown.
9. **Response.** A non-`Response` value is wrapped `{ data }` (or `{ data, meta }` when the handler returns `paged(items, nextCursor, total?)`; `total` is computed only for the first page or `limit=0`, never for later pages, CA AP-38), serialised by `lib/api/serialize.ts` (BigInt → **throws** in dev/test, string in production with a Sentry warning; `Date` → ISO; `undefined` fields dropped). Then cache headers (§7.2.1). In dev/test with `ROUTE_VALIDATE_RESPONSES=1`, `spec.response.parse(data)` (a failure is a 500 in tests).
10. **Errors.** `ApiError` → its envelope; anything else → `500 internal` with `message: "Something went wrong"`, `Sentry.captureException(err, { tags: { route: id }, extra: { requestId } })`. 4xx are breadcrumbs, not exceptions (except 402 on an `internal` route).
11. **Telemetry.** One structured log line (`lib/logger.ts`): `{ level, msg: "api", route, method, status, code, durationMs, dbMs, dbStatements, mwLagMs, requestId, auth, cache, env }` (never bodies, emails or tokens). Metrics `api.duration_ms{route,class}`, `api.status{route,code}`, `api.mw_lag_ms`. When `NEXT_PUBLIC_APP_ENV !== "production"`: `Server-Timing: auth;dur=…, rl;dur=…, db;dur=…, app;dur=…, total;dur=…` (DB time from the Prisma `$extends` query extension that sums durations into the `AsyncLocalStorage` store and writes one Sentry span per statement, OPT §9.1).

#### 7.2.1 Cache tiers

| Tier | Headers | Rules | P1 users |
|---|---|---|---|
| `public-immutable` | `Cache-Control: public, max-age=31536000, immutable`, strong `ETag` | `auth: "public"` only; the URL must carry `versionParam` (a request without it → 400) | none yet (P8 catalogue `?v=`, R2 shards) |
| `public-static` | `Cache-Control: public, max-age=0, must-revalidate`, `Vercel-CDN-Cache-Control: public, s-maxage=<sMaxAge>, stale-while-revalidate=<swr>`, `Vercel-Cache-Tag: <tags>`, strong `ETag` | `auth: "public"` only; no `Set-Cookie` (asserted in dev/test); the route is listed in middleware's `NO_CLERK_API` and excluded from the matcher | `GET /api/openings` |
| `public-short` | `Cache-Control: public, max-age=0`, `Vercel-CDN-Cache-Control: public, s-maxage=15, stale-while-revalidate=60`, `Vercel-Cache-Tag` | `auth: "public"` only | none yet (P12 tournament lists, P3 share snapshots) |
| `private-etag` | `Cache-Control: private, no-cache`, `ETag: "<etag>"`; request `If-None-Match` equal → `304` with no body | per-user data; ETag strong, version- or hash-derived (`fnv1a64` hex of the serialised `data`) | `GET /api/me` |
| `no-store` | `Cache-Control: private, no-store` | default; all errors; billing; downloads add `Content-Disposition: attachment` | everything else |
| `sse` | `Cache-Control: no-cache, no-transform`, `Content-Type: text/event-stream; charset=utf-8`, `X-Accel-Buffering: no` | streaming handlers only | none yet (P7 coach) |

Invariants (CA AP-03, AP-04), each enforced by `test/api/cache-tiers.test.ts`, which walks the whole endpoint registry: a `public-*` tier only with `auth: "public"`; a non-public endpoint may use only `private-etag`, `no-store` or `sse`; no non-public response carries `max-age > 0` (the header builder throws in dev/test if a handler sets one by hand). Per-viewer bits of a public resource always go on a separate non-public path (`/api/players/{u}` public + `/api/players/{u}/me` no-store, as P9 CHL-2 and P12 TOU-1/2 already do).

### 7.3 Contracts package (`REPO/packages/contracts`)

```
packages/contracts/
  package.json        {"name":"@repo/contracts","private":true,"type":"module","sideEffects":false,
                       "exports":{"./http/*":"./src/http/*.ts","./http/registry":"./src/http/registry/index.ts"},
                       "scripts":{"test":"tsx --test \"src/**/*.test.ts\"","check-types":"tsc --noEmit",
                                  "openapi":"tsx scripts/openapi.ts > ../../docs/api/openapi.json"},
                       "peerDependencies":{"zod":"^4.1.12"}}
                      (P2 adds "./socket/*", P3 adds "./internal/*"; CC 1.8)
  tsconfig.json       extends @repo/typescript-config/base.json
  scripts/openapi.ts  walks registry/ → OpenAPI 3.1 via z.toJSONSchema (zod 4 built-in); deterministic key order
  src/http/codes.ts       ERROR_STATUS, ALLOWED_STATUSES, SUBSCRIPTION_REASONS, CONFLICT_REASONS, FORBIDDEN_REASONS (+ codes.test.ts)
  src/http/envelope.ts    ErrorBody, ErrorEnvelope, PageMeta, ok()                 (+ envelope.test.ts)
  src/http/endpoint.ts    EndpointDef, AuthMode, CacheTier, RateLimitSpec, SideEffect, defineEndpoint()
  src/http/cursor.ts      encodeCursor(parts) / decodeCursor(c, arity): base64url(JSON.stringify([1, ...parts])); bad → null
  src/http/common.ts      Ref (/^c[a-z0-9]{20,31}$/), IsoDateTime, Limit(def,max), CursorParam, Uci, Color, FenLoose
  src/http/me.ts          MeData, MembershipState, PaymentIssue
  src/http/system.ts      HealthData
  src/http/openings.ts    OpeningsIndexData (temporary; P8 deletes it, CC R-15)
  src/http/socket-token.ts SocketTokenData
  src/http/billing.ts     BillingRefreshData
  src/http/registry/      one file per area, each exporting EndpointDef objects; index.ts concatenates them into HTTP_ENDPOINTS
                          system.ts (health.get, healthcheck.get, cron.daily, session.clear)
                          me.ts (me.get)
                          catalog.ts (catalog.openings.index)
                          billing.ts (billing.refresh, subscription.get [legacy shape, response: z.unknown()])
                          realtime.ts (socket-token.get)
                          webhooks.ts (webhook.dodo, webhook.clerk)
                          a later phase adds registry/<area>.ts and one line in index.ts (CF §7)
```

- Web imports subpaths only (`@repo/contracts/http/me`), never a barrel, so client bundles pull only what they use. Client code imports **types** from the registry, never the registry object; schemas reach client code only through `devSchema()` (§7.12).
- `next.config.js` `transpilePackages: ["@repo/contracts", "@repo/analytics"]` (requested from 1A·P0, §13.2).
- No Prisma types, no Node built-ins.
- `REPO/docs/api/openapi.json` is committed; `ci.yml` regenerates it and fails on a diff (P6's DoD and P7 §12.3 rely on it).

```ts
// src/http/me.ts
export const MembershipState = z.enum(["member", "trial", "grace", "cancelling", "lapsed", "none"]);   // P10 appends "paused"
export const PaymentIssue = z.object({
  state: z.enum(["banner", "last_day", "expired"]),
  accessEndsAt: IsoDateTime,                  // currentPeriodEnd
  accessEndsAtLabel: z.string(),              // "Nov 12", formatted on the server in UTC
});
export const MeData = z.object({
  user: z.object({
    ref: Ref, code: z.string(), name: z.string().max(120), email: z.string(),   // own email only
    avatarUrl: z.string().nullable(), role: z.enum(["user", "admin"]),
    onboarded: z.boolean(), ratingLabel: z.string().nullable(),               // "Blitz 1184" | "Rapid 1320" | null
  }),                                                                         // P4 adds user.timeZone
  entitlement: z.object({
    state: MembershipState,
    member: z.boolean(),        // what route({auth:"member"}) decides: entitled || admin || paywall off
    entitled: z.boolean(),      // billing truth only
    paywall: z.boolean(),       // BILLING_PAYWALL !== "off"
    planKey: z.enum(["monthly", "yearly", "legacy"]).nullable(),
    interval: z.enum(["month", "year"]).nullable(),
    priceCents: z.number().int().nullable(),
    status: z.enum(["pending", "active", "on_hold", "paused", "cancelled", "failed", "expired", "past_due"]).nullable(),
    currentPeriodEnd: IsoDateTime.nullable(),
    cancelAtPeriodEnd: z.boolean(),
    trial: z.object({ active: z.boolean(), used: z.boolean(), endsAt: IsoDateTime.nullable(),
                      daysLeft: z.number().int().min(1).nullable(), eligible: z.boolean() }),
    paymentIssue: PaymentIssue.nullable(),
    hasBillingPortal: z.boolean(),
  }),
  flags: z.record(z.string(), z.boolean()),
  buildId: z.string(),
});

// src/http/billing.ts
export const BillingRefreshData = z.object({
  entitlement: MeData.shape.entitlement,
  refreshed: z.boolean(),       // false when Dodo was unreachable and the stored state was returned
  legacy: z.unknown(),          // the old SubscriptionResponse shape, for useUserStore until P10 (one release)
});
```

Payload size: `MeData` ≈ 700–900 B JSON (≈ 450 B gzip). P4 adds `accounts`, `import` and `user.timeZone`, P5 `badges`, each as optional fields first. Preferences are not part of `MeData` (P9 `GET /api/me/preferences`).

### 7.4 Endpoint catalogue (every route P1 adds or changes)

"RL" buckets are §8.1. "Idem." = idempotency (P1 routes rely on natural keys; the `Idempotency-Key` store arrives in P2).

| # | Method · path | Auth | Request → response | Errors (beyond the common set) | Cache | RL | Idem. | Status · package |
|---|---|---|---|---|---|---|---|---|
| A1 | `GET /api/health` | public | `query: { deep?: "1" }` → `HealthData { ok: true, buildId, env: "dev"\|"production"\|"test"\|"local", time }`; `deep=1` adds `db: { ok, ms }` from `SELECT 1` (the only path that wakes Neon) | `unavailable` (deep DB failure, still 503 JSON) | no-store | `health-deep` 6 / 60 s per IP, deep only (`rateLimitWhen`) | GET | NEW · F1 |
| A2 | `GET /api/healthcheck` | public | 200 plain `ok` (unchanged body for existing monitors) | — | no-store | — | GET | KEEP (alias; delete in P11) · F1 |
| A3 | `GET /api/me` | user | → `MeData` (§7.3); one `getViewer()` (1 statement) + `getFlags()` (local); side effect `provision_user` | `unauthorized`; `upstream_unavailable { provider: "clerk" }` when provisioning finds no verified email | private-etag | — | GET | NEW · F4a |
| A4 | `GET /api/openings` | **public** | → `OpeningsIndexData { openings: { id: Ref, eco: string, name: string }[] }` (3,641 rows); data from `unstable_cache(listActiveOpenings, ["openings-index:v1"], { tags: ["openings"], revalidate: 86400 })`; ETag precomputed with the cached data | — | public-static (`s-maxage=86400`, `swr=604800`, tag `openings`) | — (CDN absorbs repeats; Firewall rule is Q-08) | GET | CHANGE · F1 |
| A5 | `GET /api/socket-token` | user | → `SocketTokenData { token, expiresAt }` (+ legacy top-level mirror) | `not_configured` (secret missing) | no-store | — | GET | CHANGE · F1 |
| A6 | `GET /api/subscription` | user (legacy handler, not `route()` yet) | → `SubscriptionResponse` unchanged (`subscription/route.ts:22-38`); **DB-only**: no Dodo call, no write; errors in the envelope | — | no-store | — | GET | CHANGE · F4a |
| A7 | `POST /api/webhook/clerk` | webhook (svix via `verifyWebhook` from `@clerk/nextjs/webhooks`) | Clerk events `user.created`, `user.updated`, `user.deleted` → `{ data: { received: true, duplicate: boolean } }` | `unauthorized` (bad signature) | no-store | — | natural: `svix-id` in `webhook_events` | NEW · F4b |
| A8 | `POST /api/webhook/dodo-payments` | webhook (Standard Webhooks via `dodo.webhooks.unwrap(rawBody, { headers, key })`) | Dodo events (`subscription.*`, `payment.succeeded`) → `{ data: { received: true, duplicate: boolean } }` | `unauthorized` | no-store | — | natural: `webhook-id` + compare-and-set | CHANGE · F4b |
| A9 | `GET /api/cron/daily` | cron | runs the ordered task list in `lib/cron/tasks/index.ts` → `{ data: { tasks: { [name]: { ok, ms, count? } }, durationMs } }`; side effect `cron`. P1 tasks: `rate-limit-sweep` (both tables), `webhook-retention`, `membership-reconcile` (§7.8) | `unauthorized` | no-store | — | natural (DELETEs; CAS writes) | NEW · F5 |
| A10 | `POST /api/legends/create`, `PUT/DELETE /api/legends/[id]`, `POST /api/chess-positions/create`, `PUT/DELETE /api/chess-positions/[id]` | admin (legacy handlers + `requireAdmin()`) | unchanged bodies | `401` signed out, `403` non-admin | no-store | — | — | CHANGE · H1 |
| A11 | `GET /api/chess-positions?page&limit`, `GET /api/chess-positions/[id]` | admin | `limit` clamped to 1–50; explicit `select` without `explanation`, `sourceMetadata`, player metadata | 401/403 | no-store | — | GET | CHANGE · H1 |
| A12 | `POST /api/chess/move`, `/game-over`, `/game-state` | internal (`verifyInternalRequest`, legacy body shape kept for the socket) | unchanged bodies; `game-over` conditional transition (§8.7) | `401` no session, `403` signed-in browser, `409 conflict` game no longer in progress (was 400) | no-store | — | natural: `status = IN_PROGRESS` guard / move length guard | CHANGE · H2 |
| A13 | `GET /api/chess/game-by-ref/[ref]` | optional + internal | participant (creator/opponent ref = viewer ref) or valid internal token → current full body; anyone else (incl. signed out) → **invite projection**: same top-level fields, `gameData` reduced to the allow-listed keys `{ creatorColor, isAIGame, difficulty }`, no `moveHistory`, `traceContext`, `fen`, `playerReferenceId`; `creatorTimeRemaining`/`opponentTimeRemaining` null | `404` | no-store | — | GET | CHANGE · H4 |
| A14 | `GET /api/user/[referenceId]` | — | removed → `404` | — | — | — | — | REMOVE · H3 |
| A15 | `GET /api/user/email/[email]` | — | H3: fields `dateOfBirth`, `role` removed; "not found" and "inactive" both `404` (no enumeration via 400). F4d: route removed → `404` | — | no-store | — | — | CHANGE → REMOVE · H3, F4d |
| A16 | `POST /api/user/sync` | user (legacy) | unchanged response; body now built by `provisionUser()` (verified primary email only); no caller after F4d (the E2E fixtures move to `GET /api/me`) | — | no-store | — | natural (upsert) | DEPRECATED · F4a (delete in P2 after 14 days with no traffic in Sentry `legacy_envelope`) |
| A17 | every route in AA F-12 (25 files) | as today | 5xx bodies lose `details`/`stack`; `logger.error(msg, err)` | — | — | — | — | CHANGE · H7 |
| A18 | `POST /api/session/clear` | optional | no body → `204` with `Clear-Site-Data: "cache"` (never `"storage"`, which would wipe outboxes from P5) and `Cache-Control: private, no-store`; called by `signOutEverywhere()` before `clerk.signOut()` | — | no-store | — | natural (no state) | NEW · F8 (CA AP-04) |
| A19 | `POST /api/billing/refresh` | user | no body → `BillingRefreshData`: links the Dodo customer by verified email if missing (the self-heal moved out of A6), lists the customer's subscriptions, picks the primary (`pickPrimarySubscription`), applies it with the compare-and-set (§8.11), returns the entitlement; Dodo unreachable → stored state with `refreshed: false` | `rate_limited`; `not_configured` | no-store | `billing-refresh` 10 / 60 s per user (fits the activation poll: 1 + 6 calls in ≈ 12 s) | natural (CAS) | NEW · F4a (CA AP-31) |

Shapes for A1/A4/A5:

```ts
export const HealthData = z.object({ ok: z.literal(true), buildId: z.string(), env: z.enum(["dev", "production", "test", "local"]),
  time: IsoDateTime, db: z.object({ ok: z.boolean(), ms: z.number() }).optional() });
export const OpeningsIndexData = z.object({ openings: z.array(z.object({ id: Ref, eco: z.string().max(3), name: z.string().max(200) })) });
export const SocketTokenData = z.object({ token: z.string(), expiresAt: z.number().int() });
```

Legacy route files that are not `route()` yet (A6, A10–A17, and every other `app/api/**/route.ts`) are listed with their expected anonymous status in `test/authz/legacy-routes.ts`; the authz walker (§12.2) fails when a route file is neither a `route()` export nor listed there.

### 7.5 Socket server changes (1B·H6, protocol v1 stays)

Event names and payloads stay v1 (protocol v2 is P2). Behaviour changes, each from AS §19 "P0":

| # | Change | Files | Wire effect |
|---|---|---|---|
| 1 | `accept_draw` requires the caller to be a player **and** a pending draw offer by the **opponent** (`session.drawOfferBy = <ref>` set by `offer_draw`, cleared by any move, decline or timeout) | `WS/GameSession.ts:467-513`, `WS/index.ts:280-300` | invalid accept → `error { code: "no_pending_offer" }`, game continues |
| 2 | `SOCKET_AUTH_REQUIRED=true` (dev first via the `WS_DEV_ENV_FILE` secret, prod via `WS_ENV_FILE` after owner OK); `join_game` derives identity only from the verified token (`getVerifiedUserReferenceId`) and ignores `payload.userReferenceId` | `WS/index.ts:92-131` | unauthenticated handshake → `connect_error { message: "unauthorized" }` |
| 3 | error codes instead of id-bearing messages (`not_player`, `game_completed`, `not_found`); the web client stops substring matching | `WS/GameSession.ts:139`; `app/game/[gameId]/GamePageContent.tsx:653-666` (**edit after 1A·P4a**; it stays outside `(app)`, so only the error mapping lines change) | `error { code, message }` |
| 4 | `move`, `game-over`, `game-state` web routes internal-only | = H2 | — |
| 5 | `/internal/tournament-event` requires `x-internal-token` (timing-safe); `notify-websocket.ts` sends it and is called through `after()` | `WS/index.ts:42-73`; `lib/services/tournament/notify-websocket.ts:11-23` + its 6 callers | unauthenticated → 401 |
| 6 | disconnect forfeit winner via `getGameResult` (method stays `timeout`) | `WS/GameSession.ts:559-561` | correct winner |
| 7 | persist the final move before `handleGameOver`; send `moveHistory` in `completeGame` | `WS/GameSession.ts:429-442`; `app/api/chess/game-over/route.ts` | final position stored |
| 8 | evict sessions 60 s after every end path; a join to an ended session replies `game_over` + snapshot | `WS/GameManager.ts`; `WS/GameSession.ts:571-673` | no zombie sessions |
| 9 | `AbortSignal.timeout(8000)` + 3 retries (0.5 s, 1 s, 2 s) on `persistMove` / `completeGame` / `updateGameState`; `export const maxDuration = 10` on the 3 routes | `WS/utils/apiClient.ts:36-189`; routes | fewer lost writes |
| 10 | reconnect `game_started` includes `isAIGame` / `difficulty` | `WS/GameSession.ts:620-630` | bot games survive reconnect |
| 11 | colours fixed at creation: the web writes `gameData.creatorColor`; the socket stops randomising; analysis reads it | `WS/GameSession.ts:197-207`; `app/api/chess/create-game/route.ts`, `lib/services/matchmaking/matchmaking.service.ts`, `app/api/analysis/[gameId]/route.ts:199-207` | stable colours (stopgap for B2) |
| 12 | restore an `IN_PROGRESS` game by replaying `gameData.moveHistory`; `move` route refuses a shorter history than stored | `WS/GameSession.ts:66`; `app/api/chess/move/route.ts` | resume after restart |
| 13 | SIGTERM: emit `server_restarting` to every room, flush pending persists (≤ 20 s), `io.close()`; compose `stop_grace_period: 30s`; remove the Spot watcher | `WS/index.ts:367-385`; `REPO/deploy/oci/docker-compose.yml`; `WS/spotInterruption.ts` | deploys don't lose games |
| + | `fetchGameByRef` sends `x-internal-token` (needed by H4) | `WS/utils/apiClient.ts:41-48` | — |

**Deploy order (dev, then prod):** (1) socket build that sends `x-internal-token` on `fetchGameByRef` and tolerates both response shapes; (2) web H2 + H4; (3) `SOCKET_AUTH_REQUIRED=true`. Reversing (1) and (2) would make the socket receive the invite projection and break restores.

**Internal auth in P1.** Every web ↔ socket hop keeps `x-internal-token` compared timing-safe against `INTERNAL_API_SECRET` (web: `lib/auth/internal.ts`; socket: one `verifyInternalToken()` helper in `WS/utils/internalAuth.ts` used by `/internal/tournament-event`). This closes the unauthenticated route (AS F-06) without choosing the long-term scheme. The critiques disagree on that scheme (CC R-08: keep the token; CF SEC-4: HMAC in P2; CA AP-44: HMAC mandatory from P3), so it is owner decision Q-18; whichever wins replaces the two helpers in one PR.

**Rollback.** Each H6 change ships in its own commit. The socket rolls back by re-running `deploy-oci.yml` on the previous commit (dev: push the revert to `dev`; prod: revert on `main`); `SOCKET_AUTH_REQUIRED=false` in `WS_DEV_ENV_FILE` / `WS_ENV_FILE` plus a redeploy undoes #2 alone.

### 7.6 Middleware (`middleware.ts`, 1B·F4c)

**Route classes are data, middleware code is frozen after P1** (CF §7). `lib/auth/route-classes/` holds one file per phase (`p01.ts`, later `p02.ts` …), each exporting `{ publicPages, memberPages, signedInPages, noClerkApi }` pattern lists; `index.ts` merges them and exports `classify()`. A later phase that adds a route adds its own file and one import line; it never edits `middleware.ts`.

```ts
// lib/auth/route-classes/p01.ts (generated from REPO/docs/route-map.md by 1A·DOC, then hand-maintained; pure)
export const publicPages = ["/", "/about", "/blog(.*)", "/careers", "/community", "/contact", "/cookies", "/docs(.*)",
  "/help(.*)", "/learn(.*)", "/legends(.*)", "/openings(.*)", "/og(.*)", "/press", "/pricing", "/privacy", "/terms",
  "/profile/(.*)", "/sign-in(.*)", "/sign-up(.*)", "/too-many-requests", "/dev(.*)",
  "/sitemap(.*)", "/sitemap-legends.xml", "/sitemap-openings.xml", "/robots.txt", "/manifest.json"];
export const memberPages = ["/play(.*)", "/queue(.*)", "/challenge(.*)", "/join(.*)", "/join-tournament(.*)",
  "/position(.*)", "/tournaments(.*)", "/tournament(.*)", "/game(.*)", "/analysis(.*)"];
export const signedInPages = ["/onboarding(.*)", "/admin(.*)", "/checkout(.*)"];
export const noClerkApi = ["/api/webhook(.*)", "/api/cron(.*)", "/api/health", "/api/healthcheck", "/api/scraper(.*)", "/api/openings"];

// lib/auth/route-classes/index.ts
export function classify(pathname: string): "scanner" | "public" | "member" | "signed_in" | "api" | "api_no_clerk";
export const SCANNER = /\.(php|env|git|aspx?|bak|sql)$|^\/(wp-|wordpress|\.git|\.env|cgi-bin|phpmyadmin)/i;   // CA AP-33
```

Behaviour (replaces `middleware.ts:16-38`). The exported function checks the cheap cases **before** handing the request to `clerkMiddleware`, so scanner probes and provider callbacks never pay for Clerk:

1. **Scanner probe** (`classify() === "scanner"`) → `new NextResponse(null, { status: 404 })`, nothing else.
2. **Every other request:** if `x-request-id` is absent, set `crypto.randomUUID()` on the forwarded request headers and on the response; set `x-mw-start: <Date.now()>` on the forwarded request (the wrapper logs the lag, CA AP-35). When `NEXT_PUBLIC_APP_ENV !== "production"`, add `X-Robots-Tag: noindex, nofollow` to the response (CF SEC-3).
3. `api_no_clerk` → `NextResponse.next()` without Clerk (webhooks, cron and health verify themselves; `/api/openings` is public and CDN-cached).
4. **API mutations** (non-GET/HEAD `/api/*` carrying a Clerk session cookie): reject with `403 { error: { code: "forbidden", message: "Cross-site request blocked", requestId } }` when `Sec-Fetch-Site` is present and not `same-origin`, or when `Origin` is present and is neither `req.nextUrl.origin` nor `NEXT_PUBLIC_SITE_URL` (CF SEC-9: `same-site` subdomains such as a future media host are not trusted). `navigator.sendBeacon` sends `same-origin`. Middleware never redirects an API request; handlers answer 401/402.
5. **Pages:** `public` → pass. Otherwise signed out → `redirectToSignIn({ returnBackUrl: req.url })` (today's rule, now for every non-public page, e.g. `/onboarding`, `/admin`).
6. **Member gate** (only when `MIDDLEWARE_MEMBER_GATE=on` and `BILLING_PAYWALL !== "off"`): on `member` pages, when `sessionClaims.md?.entitled === false` and `md.role !== "ADMIN"`: `md.lapsed === true` → `302 /pricing?reason=ended&redirect_url=<path+query>`; otherwise → `302 /pricing?reason=required&redirect_url=<path+query>` (checkout params stripped; B26 default). `md` missing or `entitled` undefined → pass (the page-level gate decides; "unknown is not no").
7. **Optional document limiter** (only when `EDGE_DOC_LIMIT=on`; shipped disabled): a per-isolate in-memory bucket of 120 document requests / 60 s per IP on `/legends(.*)` and `/openings(.*)`; over the limit → `NextResponse.rewrite("/too-many-requests?retry=<sec>&from=<path>", { status: 429, headers: { "Retry-After": sec } })`. Best effort only (isolates don't share memory, IS §3.6); the Vercel Firewall is the real layer (Q-08).
8. **Matcher:** today's matcher plus negative look-aheads for `monitoring`, `ingest`, `og`, `workers`, `api/health`, `api/webhook`, `api/cron`, `api/openings` (OPT §4.2: one edge invocation less per request; no auth cookies on cacheable responses). Scanner paths stay inside the matcher so step 1 can answer them.

Claims type: `REPO/apps/web/types/clerk.d.ts` declares `CustomJwtSessionClaims { md?: RcPublicMetadata }`. The Clerk dev instance needs the session token template `{"md": "{{user.public_metadata}}"}` (owner action Q-06; the claim stays < 200 bytes).

### 7.7 Webhooks

**Shared rules (API §8.1):** verify the signature on the raw body first. The first DB statement is the `webhook_events` claim; no row returned → `200 { duplicate: true }` with no other work. Side effects (Clerk metadata, PostHog) run in `after()`. The outcome is written back (`status`, `userId`, `processedAt`, `error`). A handler exception → `status = 'error'` and a 500, so the provider retries. The claim re-admits only failed or stuck deliveries (`lib/webhooks/record.ts`):

```sql
INSERT INTO webhook_events (provider, "eventId", type, "eventTime", payload)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (provider, "eventId") DO UPDATE
  SET "receivedAt" = (now() AT TIME ZONE 'UTC'), status = NULL, error = NULL
  WHERE webhook_events.status = 'error'
     OR (webhook_events.status IS NULL AND webhook_events."receivedAt" < (now() AT TIME ZONE 'UTC') - interval '2 minutes')
RETURNING 1;
```

A concurrent redelivery inside the 2-minute window is answered as a duplicate; processing twice would be harmless anyway because `applySubscriptionSnapshot` drops stale or equal snapshots.

**Dodo (`app/api/webhook/dodo-payments/route.ts`):**

```ts
export const maxDuration = 15;
export const POST = route({ id: "webhook.dodo", auth: "webhook", class: "WH", rawBody: true, maxBodyBytes: 262_144 },
  async ({ req, rawBody, after }) => {
    const event = dodo.webhooks.unwrap(rawBody!, { headers: Object.fromEntries(req.headers), key: env.DODO_PAYMENTS_WEBHOOK_KEY });  // throws → 401
    const id = req.headers.get("webhook-id")!;
    if (!(await recordWebhook("dodo", id, event.type, eventTime(event), event))) return { received: true, duplicate: true };
    const outcome = await handleDodoEvent(event);            // today's onPayload body (route.ts:36-70) moved to lib/billing/dodo-events.ts
    await finishWebhook("dodo", id, outcome);                // { status: applied|stale|unmatched|ignored, userId }
    if (outcome.userId && outcome.changed !== false) after(() => syncClerkClaims(outcome.userId!));   // §8.4; outcome per §8.11
    return { received: true, duplicate: false };
  });
```

Event handling keeps today's rules (`shouldApplySnapshot` keeps the record that grants the most access; `payment.succeeded` links `dodoCustomerId`), but every write now goes through the compare-and-set of §8.11 with `eventTime` from the webhook payload as `subscriptionSourceAt`. An older event that arrives late finds `subscriptionSourceAt > eventTime`, writes nothing and finishes with `status = 'stale'`; a snapshot that changes no persisted field writes nothing and finishes `applied` with `changed: false`.

**Clerk (`app/api/webhook/clerk/route.ts`):**

| Event | Action |
|---|---|
| `user.created` | `provisionUser({ clerkUserId, primaryEmail (verified only), name, imageUrl })` (create with code + `UserStats`, or relink an existing row by verified primary email); `after()`: `updateUserMetadata(id, { publicMetadata: { v: 1, onboarded: false, entitled: false, lapsed: false, trialUsed: false, role: "USER" } })` unless the row already exists (then `syncClerkClaims`) |
| `user.updated` | update `name`, `profilePictureUrl`, and `email` only when the new primary is verified and not used by another row (else Sentry warning `email_conflict`) |
| `user.deleted` | `isActive = false` (soft; hard deletion flows are P10); viewer reads then treat the user as signed out |
| other | `status: "ignored"` |

`webhook_events.payload` is `NULL` for Clerk. Endpoint registered in the Clerk dev instance at `<dev>/api/webhook/clerk` with those three events; signing secret → `CLERK_WEBHOOK_SIGNING_SECRET`. Today `replay-chess-dev` has no deployment protection, so both providers reach it. When Vercel Authentication is turned on (Q-16), both webhook URLs gain `?x-vercel-protection-bypass=<VERCEL_AUTOMATION_BYPASS_SECRET>` (Vercel's documented bypass for automation [V2: verify on Hobby with `curl` with and without the parameter]), and T17 plus `webhooks.spec.ts` are re-run against the dev URL before the switch is left on.

### 7.8 Background jobs

| Job | Trigger | Work | Budget |
|---|---|---|---|
| `GET /api/cron/daily` | Vercel cron `0 4 * * *` (Hobby allows daily crons only, ±59 min) in the `vercel.json` the project actually reads (check the project's Root Directory with the Vercel MCP `get_project`; today `REPO/vercel.json` exists and `apps/web/vercel.json` does not) | the ordered task list `lib/cron/tasks/index.ts`, one file per task (`lib/cron/tasks/<name>.ts`, each `{ name, run(ctx) → { count } }`, a failure in one task is logged and the next runs): **`rate-limit-sweep`** (both limiter tables, §6.3), **`webhook-retention`** (§6.3), **`membership-reconcile`** (≤ 50 users whose non-terminal subscription period ended more than 1 h ago: Dodo `subscriptions.retrieve` 200 ms apart, compare-and-set apply, claims sync in `after()`; this replaces the draft's "refresh on GET after 6 h"; P10 §7.7 extends the same task) | 1 Neon wake per day; < 15 s (`maxDuration = 60`) |
| `backup-live.yml` (1B·H11, GitHub Actions on `main`) | `schedule: "0 22 * * *"` + `workflow_dispatch` | `pg_dump --format=custom --no-owner --no-privileges "$LIVE_DB_DUMP_URL"` (read-only role on the live project `shy-morning-50748774`, Q-19) piped through `age -r "$BACKUP_AGE_RECIPIENT"` → artifact `live-<yyyy-mm-dd>.dump.age`, retention 14 days; plus `counts-<date>.json` (`SELECT relname, n_live_tup FROM pg_stat_user_tables`). Weekly job `restore-check` (Sundays): download the latest artifact, decrypt with `BACKUP_AGE_IDENTITY`, `pg_restore` into a `postgres` service container of the same major version, compare row counts within 1 %, fail and open an issue otherwise | ≈ 2 min a night; the live compute is awake for the dump only |
| `ops-weekly.yml` (1Q·1, on `main`) | `schedule: "30 3 * * 1"` + `workflow_dispatch` | Neon consumption API (CU-h, storage, egress) for `replay-chess-dev` and `withered-cake-82837167`; Vercel usage for `replay-chess-dev` (CDN requests, function invocations, Fast Data Transfer, image transformations, Speed Insights events, Edge Config reads) [V14: endpoint and fields]; Anthropic usage from P7. Writes `ops/usage-<date>.json` as an artifact and opens or updates the issue "ops: weekly usage" with each metric as % of pro-rata; labels it `quota-alert` when any Hobby metric passes 60 % or Neon CU-h passes 50 % (CF F-VER-2, CA AP-01) | < 1 min |
| `nightly.yml` (1Q·1, on `main`, checks out `ref: dev`) | `schedule: "30 21 * * *"` + `workflow_dispatch` | full e2e, full devices, visual, state coverage, a dev-URL smoke subset (§13.4) | runner minutes only; the deployed dev site sees only the smoke subset |
| `post-deploy-dev.yml` (1Q·1) | `deployment_status` with `state == "success"` for `replay-chess-dev` | `/api/health` `buildId` equals the deployment SHA; a socket.io handshake from `Origin: https://replay-chess-dev-replaychess007-1069.vercel.app` to `wss://ws-dev.80-225-200-210.sslip.io` succeeds; `@smoke` against the dev URL | ≈ 5 min per deploy |
| Claims backfill | manual, once per environment | §6.5 | ≤ 2 min on dev |
| UptimeRobot (Q-20) | every 5 min (free plan) | `GET https://ws-dev.80-225-200-210.sslip.io/health` and `GET <dev>/api/health` (no DB, so the monitor never wakes Neon); alert by email when down for 10 min, so an OCI idle reclamation is noticed the same day (CA F-17) | 0 Neon wakes |

Scheduled GitHub workflows run from the default branch only, so `backup-live.yml`, `ops-weekly.yml` and `nightly.yml` are committed to `main` as workflow-only commits (they contain no app code) and to `dev`; `main-guard.yml` (§13.4) allows `main` commits that touch only those workflow files or the H-lane file list.

### 7.9 Environment variables (new or changed in P1)

| Var | Where | Value / purpose | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_APP_ENV` | every Vercel project, CI | `dev` on `replay-chess-dev`, `test` in CI and the devices build, `production` on prod | already exists (Sentry tag); now also the base of `testHooksEnabled()`. 1B·J adds a build-time assertion in `next.config.js`: `VERCEL=1` and the variable unset → the build fails (dev only; not cherry-picked to `main`) |
| `ALLOW_TEST_HOOKS` | Vercel `replay-chess-dev`, CI, `.env.test`, `.env.development.local` | `1` | the second half of the test-hook guard; never set on a production project (checked by `prod-guard.spec.ts`, which sets it **on** with `NEXT_PUBLIC_APP_ENV=production` and expects every hook off) |
| `E2E_TEST_TOKEN` | Vercel dev, CI, `.env.test` | random 32 bytes | `x-e2e-token` for `x-rc-now` |
| `CLERK_WEBHOOK_SIGNING_SECRET` | Vercel dev (Preview + Production envs of `replay-chess-dev`), `.env.development.local` | Clerk dev webhook secret | read by `verifyWebhook` |
| `CRON_SECRET` | Vercel dev | random 32 bytes | Vercel sends it as `Authorization: Bearer` |
| `POSTHOG_FEATURE_FLAGS_KEY` | Vercel dev (server only) | PostHog "feature flags secure API key" for local evaluation | never `NEXT_PUBLIC_` (CC R-09 name) |
| `FLAGS_OVERRIDE` | Vercel dev, `.env.test`, the CI `flags-off` server | e.g. `shell-v3:on`; `shell-v3:off` for the `flags-off` project | honoured only when `testHooksEnabled()` |
| `MIDDLEWARE_MEMBER_GATE` | Vercel dev | `off` → `on` after the claims backfill | kill switch |
| `LEGACY_402_MIRROR` | Vercel dev | `on` (default) | removed in P2 |
| `PERF_TOKEN` | Vercel dev, k6 runner | random; required with `PERF_AUTH_BYPASS=true` (H9) | never on production |
| `ROUTE_VALIDATE_RESPONSES` | CI, `.env.test` | `1` | response schema checks |
| `RATE_LIMIT_IP_PEPPER` | Vercel dev | random | hashes IPs for `by: "ip"` buckets (CC R-09 name) |
| `EDGE_DOC_LIMIT` | Vercel dev | `off` | optional middleware document limiter (P1 ships the code path disabled) |
| `NEXT_PUBLIC_SITE_URL` | every Vercel project | the web origin | middleware Origin check; share links later (CC R-09) |
| `NEXT_PUBLIC_TELEMETRY_SINK` | CI test builds only | `1` | client telemetry sink (§10.1); refused unless `NEXT_PUBLIC_APP_ENV=test` |
| `POSTHOG_HOST` | CI only | `http://127.0.0.1:4011` | the server-side PostHog sink (§10.1) |
| `TEST_DATABASE_URL` | CI `integration` job, local | Docker Postgres | `*.int.test.ts` run only when it is set |
| `E2E_BASE_URL`, `VERCEL_AUTOMATION_BYPASS_SECRET` | CI dev-URL jobs, the owner's laptop | dev URL; Vercel bypass secret (after Q-16) | `playwright.config.ts` adds `x-vercel-protection-bypass` and `x-vercel-set-bypass-cookie: true` |
| `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA` | Vercel system env (enable "Automatically expose System Environment Variables") | build id for `x-rc-build` and `buildId` | — |
| `DATABASE_URL`, `DIRECT_URL` (dev) | Vercel dev, `.env.development.local`, `.env.test` | the `replay-chess-dev` Neon project after H10; `DATABASE_URL` switched to the `replay_app` role by F9 (owner confirms) | `DIRECT_URL` stays the owner role, local/CI only |
| `SOCKET_AUTH_REQUIRED` | GitHub secret `WS_DEV_ENV_FILE`, later `WS_ENV_FILE` | `true` | H6 #2 |
| GitHub secrets (not app env) | repository | `LIVE_DB_DUMP_URL`, `BACKUP_AGE_RECIPIENT`, `BACKUP_AGE_IDENTITY` (H11); `NEON_API_KEY` (read-only), `VERCEL_TOKEN` (read scope) (ops-weekly); `VERCEL_AUTOMATION_BYPASS_SECRET`, `E2E_TEST_TOKEN`, the Clerk dev keys (CI e2e) | added by the owner (§13.4) |

Not introduced: `INTERNAL_HMAC_SECRET`, `RC_INTERNAL_KEYS`, `INTERNAL_API_TOKEN` (CC R-08/R-09). `REPO/turbo.json` `globalEnv` gains every server var above plus the existing undeclared ones (AQ B-03) so the turbo cache never serves a build made with another environment's keys.

### 7.10 Feature flags (`lib/flags/`)

```ts
// lib/flags/registry/p01.ts (client-safe data; one file per phase, CF §7)
export const P01_FLAGS = { "shell-v3": { default: { dev: true, test: true, production: false, local: true } } } as const;
// lib/flags/registry/index.ts
export const FLAGS = { ...P01_FLAGS /* , ...P02_FLAGS (P2 adds one line) */ } as const;
export type FlagKey = keyof typeof FLAGS;

// lib/flags/index.ts (server-only; import path "@/lib/flags" as every phase cites it)
export const getFlags = cache(async (viewer: Viewer | null): Promise<Record<FlagKey, boolean>> => { … });
// precedence: FLAGS_OVERRIDE (testHooksEnabled() only) > PostHog local evaluation (distinctId = viewer.ref or "anon",
// personProperties { app_env, role, member }) > FLAGS[key].default[env]. PostHog timeout 300 ms; any failure → defaults.

// lib/flags/client.ts
export function useFlag(key: FlagKey): boolean;   // reads qk.me().flags[key]; signed out → registry default for NEXT_PUBLIC_APP_ENV
```

- posthog-node client is module-scope (`featureFlagsPollingInterval: 30_000`, `personalApiKey: POSTHOG_FEATURE_FLAGS_KEY`), never imported by middleware or client code.
- P1 flag `shell-v3`: `(app)/layout.tsx` (via 1B·J) renders the shell only when `member && flags["shell-v3"]`. On for the owner and E2E users A–P on dev (`FLAGS_OVERRIDE=shell-v3:on` on `replay-chess-dev`); off in production until P13. The `flags-off` Playwright project (§12.3) proves the legacy chrome still works with it off.
- References to `lib/flags.ts` / `lib/flags-registry.ts` in other phase plans mean `lib/flags/index.ts` and `lib/flags/registry/pNN.ts` (CC R-14 names; flag mechanism exceptions for P11's three flags stay as P11 states).
- Kill switches that are env vars, not flags: `MIDDLEWARE_MEMBER_GATE`, `LEGACY_402_MIRROR`, `EDGE_DOC_LIMIT`, `BILLING_PAYWALL`.

### 7.11 Third-party integrations touched

| Service | P1 change | Failure behaviour |
|---|---|---|
| Clerk (dev instance) | session-token template (`md`), webhook endpoint, BAPI `users.updateUserMetadata` (claims), `users.getUser` (first-request provisioning only); 24 permanent pool users for E2E | webhook retries by Svix; claims sync failure → Sentry warning, the gate treats the claim as unknown; provisioning failure → `/api/me` 502 `upstream_unavailable { provider: "clerk" }`, layout falls back to marketing chrome |
| Dodo (test mode) | webhook verification via SDK `webhooks.unwrap`; `/api/subscription` DB-only; `POST /api/billing/refresh`; daily reconcile | as today; dedupe makes redeliveries free; refresh failure returns stored state |
| PostHog | server flag evaluation (posthog-node), new client and server events (§10) | defaults on failure |
| Sentry | `sendDefaultPii: false`, `tracesSampler`, `captureException` from the logger, DB spans | — |
| Neon | H10 project split, M1, role (F9), consumption API (ops-weekly) | — |
| Vercel | cron, env vars, Firewall rule for `/too-many-requests` and `/api/openings` (owner, if Hobby allows a rate-limit rule; Q-08), deployment protection with automation bypass (Q-16), usage API (ops-weekly) | — |
| GitHub Actions | `ci.yml` jobs, `nightly.yml`, `post-deploy-dev.yml`, `ops-weekly.yml`, `backup-live.yml`, gitleaks | the repo is public, so minutes are free; artifacts are readable by anyone, which is why dumps are `age`-encrypted |
| UptimeRobot (free) | two monitors (Q-20) [V5: free-plan terms] | email alert only |

### 7.12 Typed client (`lib/api/client.ts`) — the only `api()` implementation

```ts
export async function api<S extends z.ZodType>(path: string, init: {
  schema?: S;                                   // pass devSchema(Schema): parsed in dev/test only, undefined in production builds
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown; signal?: AbortSignal;
  timeoutMs?: number;                           // default 15_000
  idempotencyKey?: string;                      // header Idempotency-Key (stored server-side from P2)
  keepalive?: boolean;
  fault?: 401 | 402 | 429 | 500 | 503;          // sends x-rc-fault + a cache-busting __rcfault=<random>; stripped in production builds
}): Promise<{ data: z.infer<S>; meta?: PageMeta }>;

// lib/api/schema.ts (CA AP-12)
export const devSchema = <T>(s: T): T | undefined => (process.env.NODE_ENV === "production" ? undefined : s);
// call site: api(endpoints.me, { schema: devSchema(MeData) }) — the literal NODE_ENV replacement lets the minifier drop the
// branch, the import becomes unused and the schema module leaves the production chunk.
```

- Headers: `Accept: application/json`, `x-rc-build: NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? "dev"` (the name P2's `upgrade_required` gate reads; never `x-client-build`), `Content-Type` when a body exists, `credentials: "same-origin"`.
- **No `ifNoneMatch` option and no `notModified` result** (CA AP-21): 304s are handled by the browser's HTTP cache transparently (`private, no-cache` + ETag revalidates on every request), so a query never receives `undefined` data, which TanStack v5 rejects.
- `AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)])` with a fallback for Safari < 17.4.
- Throws `ApiError { status, code, message, fields?, details?, retryAfterSec?, requestId? }`; client-only codes `network`, `timeout`, `offline` (mutation while `onlineManager` says offline), `aborted`, `contract_mismatch`.
- Unknown server codes degrade to `internal` (`.catch("internal")` in `ErrorBody`).
- Legacy shapes go through `unwrapLegacy` (§7.1).
- Endpoint paths live in `lib/api/endpoints.ts` (`endpoints.me = "/api/me"`, `endpoints.openings = "/api/openings"`, `endpoints.billingRefresh = "/api/billing/refresh"`, `endpoints.sessionClear = "/api/session/clear"`, `endpoints.health = "/api/health"`), generated from the contracts registry paths so a rename happens in one place.
- `fault` exists only when `NEXT_PUBLIC_APP_ENV !== "production"` (literal comparison, so production bundles drop it); the `__rcfault` parameter makes the request miss the CDN on `public-*` routes, where a cached HIT would otherwise never reach the wrapper.
- Lint (via 1B·J): no `fetch("/api` in new directories (`components/data`, `components/system`, `lib/api/queries`, `lib/api/mutations`, `app/dev/ui/data`); legacy files are exempt until their phase converts them (CDL D15); `no-restricted-syntax` bans passing a schema to `api()` without `devSchema()`.
- api-design §3.2 and CDL §4.3 sketches are superseded by this file and link to it.

---

## 8. Domain logic (exact rules and constants)

### 8.1 Rate limiter (`lib/rate-limit-db.ts`)

Fixed window, one statement, race-free under concurrency (the row lock taken by `ON CONFLICT DO UPDATE` serialises concurrent hits on the same key). The same statement runs against `rate_limit_buckets` (store `burst`) or `rate_limit_windows` (store `durable`):

```sql
-- $1 key, $2 window seconds; <table> is a constant chosen by spec.store, never user input
INSERT INTO <table> AS b ("key", "count", "resetAt")
VALUES ($1, 1, (now() AT TIME ZONE 'UTC') + make_interval(secs => $2::int))
ON CONFLICT ("key") DO UPDATE SET
  "count"   = CASE WHEN b."resetAt" <= (now() AT TIME ZONE 'UTC') THEN 1 ELSE b."count" + 1 END,
  "resetAt" = CASE WHEN b."resetAt" <= (now() AT TIME ZONE 'UTC')
                   THEN (now() AT TIME ZONE 'UTC') + make_interval(secs => $2::int) ELSE b."resetAt" END
RETURNING "count", "resetAt";
```

- `allowed = count ≤ limit`; `retryAfterSec = max(1, ceil((resetAt − now) / 1000))` when denied.
- **Store rule (CA AP-11, CF F-NEON-3):** `burst` (UNLOGGED) for `windowSec ≤ 300`; `durable` for anything longer. Neon suspends a compute only after 300 s without queries, so a burst window can never be reset by a suspend before it would have expired anyway; a 1-hour or 1-day window on the UNLOGGED table would reset after any quiet 5 minutes. A `burst` spec with `windowSec > 300` throws at module load. Daily or monthly **budgets** (emails sent, coach spend) are not rate limits: count the source rows or use a logged budget table (P7, P10).
- `now() AT TIME ZONE 'UTC'` because Prisma's `DateTime` is `timestamp(3)` without zone, stored in UTC (§6.7 rule 2).
- Keys: `rl:<bucket>:c:<clerkUserId>` (`by: "user"`, available from the JWT before the viewer read, so the check runs in parallel with it), `rl:<bucket>:ip:<hex(sha256(RATE_LIMIT_IP_PEPPER ‖ ip))[0:16]>` (`by: "ip"`, IP from `x-forwarded-for`'s first hop on Vercel). `user+ip` checks both and denies when either denies.
- Pure helper `decideWindow(row, now, limit, windowSec)` mirrors the SQL for unit tests.
- Fail open on DB errors (logged, metered). Burst behaviour of a fixed window (up to 2 × limit across a boundary) is accepted.
- Limits are always written `limit / windowSec` (CC R-13), never as token-bucket burst/refill.

| Bucket | Limit / window | By | Store | Route |
|---|---|---|---|---|
| `billing-refresh` | 10 / 60 s | user | burst | `POST /api/billing/refresh` |
| `health-deep` | 6 / 60 s | ip | burst | `GET /api/health?deep=1` |

Later phases add buckets from API §2.10 (lookup, link, sync, checkout, coach-burst, contact, report, share-create, …) with the store rule above. Hot paths (`/api/me`, review, train reads) never get one; public CDN-cached reads never get one either (the CDN absorbs repeats).

### 8.2 Viewer derivation (`lib/auth/viewer.ts`, `lib/auth/membership.ts`, pure parts unit-tested)

```ts
// The columns of the one viewer statement (§5.2). ENTITLEMENT_COLUMNS mirrors ENTITLEMENT_SELECT (lib/billing/entitlement.ts:19-30)
export const VIEWER_COLUMNS = ["id", "referenceId", "code", "googleId", "email", "name", "profilePictureUrl", "role",
  "isActive", "onboarded", "dodoCustomerId", "subscriptionSourceAt", "gamesVersion", ...ENTITLEMENT_COLUMNS] as const;
export type ViewerRecord = { [K in (typeof VIEWER_COLUMNS)[number]]: … } & { blitzRating: number | null; rapidRating: number | null };

export const getViewerRecord = cache(async (): Promise<ViewerRecord | null> => {
  const { userId } = await auth();
  if (!userId) return null;
  const rows = await prisma.$queryRaw<ViewerRecord[]>(Prisma.sql`
    SELECT ${Prisma.join(VIEWER_COLUMNS.map((c) => Prisma.raw(`u."${c}"`)))}, c."blitzRating", c."rapidRating"
    FROM users u LEFT JOIN chess_com_profiles c ON c."userId" = u.id
    WHERE u."googleId" = ${userId} LIMIT 1`);
  const row = rows[0] ?? (await provisionUser(userId));      // §8.5; null when Clerk has no verified email
  return row && row.isActive ? row : null;
});
export const getViewer = cache(async () => { const r = await getViewerRecord(); return r && toViewer(r, requestNow(), env); });
// requestNow(): Date.now(), or the x-rc-now header when testHooksEnabled() and x-e2e-token matches (React cache per request)
```

`lib/auth/viewer.test.ts` asserts that `VIEWER_COLUMNS` equals the keys of the Prisma `VIEWER_SELECT` object used by `provisionUser()` (one source of truth for the column list), and the integration test `lib/auth/viewer.int.test.ts` runs the statement against Docker Postgres after `migrate deploy`, so a renamed column fails CI.

`toViewer` (and `toMeData`, which adds flags and buildId) uses `summarizeEntitlement(record, getProductCatalog(), now)` (`lib/billing/entitlement-rules.ts:209`) and then:

| Field | Rule |
|---|---|
| `entitlement.member` | `!isPaywallEnabled() \|\| role === "ADMIN" \|\| summary.entitled` (same as SPEC §9.3 `toShellSession` and `requireSubscribedUser` minus the internal/perf bypasses) |
| `entitlement.state` | `trial` if `summary.trial.active`; else `grace` if entitled and status ∈ `GRACE_STATUSES` (`on_hold`, `past_due`); else `cancelling` if entitled and `cancelAtPeriodEnd`; else `member` if entitled; else `lapsed` if `summary.trial.used \|\| subscriptionId != null`; else `none` |
| `trial.daysLeft` | `summary.trial.active ? ceil((trialEndsAt − now) / 86 400 000) : null` (`trialDaysLeft`, `lib/billing/trial-rules.ts:37`), so ≥ 1 while active |
| `trial.eligible` | `!summary.trial.used && !summary.subscriptionId` (same as `subscription/route.ts:49`) |
| `paymentIssue` | status ∈ `{past_due, on_hold}` and entitled → `{ state: (currentPeriodEnd − now ≤ 36 h) ? "last_day" : "banner", … }`; status ∈ `{on_hold, past_due, failed}` and not entitled and `currentPeriodEnd` within the last 30 days → `expired`; else `null` |
| `accessEndsAtLabel` | `currentPeriodEnd.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })` ("Nov 12"); P4 switches to `user.timeZone` |
| `ratingLabel` | `blitzRating ? "Blitz " + blitz : rapidRating ? "Rapid " + rapid : null` |
| `hasBillingPortal` | `Boolean(dodoCustomerId)` |
| `role` | `"admin"` when `Role.ADMIN`, else `"user"` |
| `planKey` | from the catalog; `e2e-fixture` → `"monthly"` only when `isNonProdApp()` (§3.2, CT X3) |

`lib/shell/shell-user.ts` (1A·P4b) keeps computing `ShellUser` from the same record (SPEC §9.3); 1A·P7 adds the optional `paymentIssueState` with the same thresholds. A table test in `lib/shell/shell-user.test.ts` runs every record fixture of `lib/auth/viewer.test.ts` through both mappers and asserts that, for member records, `toShellSession(record).user.paymentIssueState` equals `toMeData(record).entitlement.paymentIssue?.state ?? null`, so the shell and `/api/me` can't disagree.

### 8.3 402 reasons (`requireMember()`, `lib/auth/require-subscription.ts`)

| `details.reason` | Condition | Client target in P1 (B26 default) | Later |
|---|---|---|---|
| `trial_available` | `state === "none"` and `trial.eligible` | `/pricing?reason=required&redirect_url=…` | P11 S2/S3 `required` banner |
| `trial_used` | `state === "lapsed"`, trial used, never paid (`subscriptionId` null or only a trial subscription that ended) | `/pricing?reason=ended&redirect_url=…` | P7 D18 / P11 S4: in-place `RenewSheet` on `(app)` pages |
| `payment_failed` | `paymentIssue?.state === "expired"` | `/pricing?reason=ended&redirect_url=…` | `RenewSheet` with "Update payment method" first |
| `expired` | any other lapsed member | `/pricing?reason=ended&redirect_url=…` | `RenewSheet` |

The legacy pricing page reads only `reason=required` today (`app/pricing/PricingContent.tsx:89`) and shows its default view for `reason=ended` until P11 S2. Admins, `BILLING_PAYWALL=off`, the internal token and the fenced perf bypass skip the check exactly as `requireSubscribedUser` does today (`require-subscription.ts:38-46`). The same mapping drives the middleware member gate (§7.6 step 6) through the claim `md.lapsed`.

### 8.4 Clerk claims (`lib/auth/claims.ts`)

```ts
export interface RcPublicMetadata { v: 1; onboarded: boolean; entitled: boolean; lapsed: boolean; trialUsed: boolean; role: "ADMIN" | "USER" }
export function computeClaims(record, now): RcPublicMetadata   // pure: entitled = isEntitled(record, now); lapsed = !entitled && (trialUsed || subscriptionId != null)
export async function syncClerkClaims(userId: bigint): Promise<void>
  // re-reads VIEWER_SELECT by id, computes claims, compares with clerkClient().users.getUser(googleId).publicMetadata,
  // calls updateUserMetadata only when different; failure → Sentry warning "claims_sync_failed" (never throws into the webhook)
```

Writers in P1: the Dodo webhook (after each applied snapshot), `POST /api/billing/refresh` and the `membership-reconcile` cron task (when their compare-and-set wrote), the Clerk `user.created` webhook, the backfill script. P4 adds onboarding completion and `/api/billing/activation`. `entitled` and `lapsed` in the claim are **gate hints only**; every API decides from the DB (CDL §6.2).

Lag: a session JWT lives ≤ 60 s, so a fresh member can be bounced once by the middleware gate after checkout. `waitForEntitlement`'s success path (`lib/billing/client.ts:87-113`) therefore runs `await window.Clerk?.session?.reload()` before navigating (CDL §6.2 rule 3); P4 adds the `rc_act` cookie.

### 8.5 User provisioning (`lib/auth/provision-user.ts`)

1. `findUnique({ googleId })` → found: return.
2. Load the Clerk user once (`clerkClient().users.getUser(id)`); take `primaryEmailAddress` **only if** `verification.status === "verified"`; normalise `trim().toLowerCase()`.
3. `findUnique({ email })` with a different `googleId` → relink (`update googleId`), Sentry breadcrumb `user.relinked` (AA F-23 fix: today `user/sync` uses `emailAddresses[0]`, verified or not).
4. Else create in one transaction: `users` (code = 6 chars from `[A-Z0-9]`, retried on P2002 up to 5 times, same alphabet as `user/sync/route.ts:52`) + `user_stats`.
5. P2002 on `googleId`/`email` (the webhook won the race) → re-read and return.
6. No verified email → do not create; `/api/me` answers `502 upstream_unavailable { provider: "clerk", kind: "unverified_email" }` and the layout uses marketing chrome (the next request retries).

### 8.6 Session flow (`components/system/session-guard.ts`, `SessionWatcher.tsx`, `lib/auth/sign-out.ts`)

- `onUnauthorized()` is single-flight (one reload in progress per tab): `await Clerk.session?.reload()` → if `Clerk.session` exists, invalidate active queries whose last error was 401 and resolve "recovered"; else open the modal. Repeated 401s within 10 s while the modal is open are ignored.
- Clerk flip detection: `useAuth().isSignedIn` true → false, not on a public route (`classify(pathname) === "public"` → ignore), and `sessionStorage["rc.signout"] !== "1"`; wait 1500 ms; still on a non-public route → modal (`source: "clerk"`).
- `visibilitychange` → visible on a non-public route with `isSignedIn === false` → modal (`source: "visibility"`).
- `signOutEverywhere()` (CDL §6.6 steps that exist in P1, in this order): set `sessionStorage["rc.signout"]="1"`; `queryClient.cancelQueries(); queryClient.clear()`; `useUserStore.getState().clearStore()`; `purgeRuntimeCaches()` (1A·P3 `lib/shell/pwa.ts`); **`await fetch("/api/session/clear", { method: "POST", keepalive: true })` with a 1.5 s timeout, errors ignored** (`Clear-Site-Data: "cache"` empties the browser HTTP cache, so a second person on the same browser cannot reach the first member's responses through history or autocomplete; CA AP-04); `posthog.reset()`; `Sentry.setUser(null)`; `BroadcastChannel("rc-auth").postMessage({ type: "signed_out" })`; `await clerk.signOut({ redirectUrl: "/" })`. Other tabs on `signed_out` run the local steps and `location.assign("/")`. From P5 the outbox flush runs before `session/clear`, which is why it never sends `"storage"`.
- `(app)` documents are dynamic and keep Next's `Cache-Control: private, no-store`, so Back after sign-out does not restore the member page from bfcache.
- Drafts: `/dev/ui/data`'s demo input is saved to `sessionStorage["rc.draft./dev/ui/data"]` before navigating to sign-in and restored after (the pattern P7's coach input reuses).

### 8.7 Game-over transition (H2, ADB DB-04)

```ts
await prisma.$transaction(async (tx) => {
  const r = await tx.game.updateMany({
    where: { referenceId, status: "IN_PROGRESS" },
    data: { status: "COMPLETED", result, winnerId: winnerDbId, completedAt: new Date(),
            creatorTimeRemaining: whiteTime, opponentTimeRemaining: blackTime },
  });
  if (r.count === 0) throw new GameNotInProgress();       // → 409, stats untouched
  await tx.game.update({ where: { referenceId }, data: { gameData: { ...prevGameData, fen, method, moveHistory } } });
  await updateUserStats(tx, creatorId, opponentId, result);   // existing helper, now only after a won transition
  if (tournamentId) await updateTournamentStandings(tx, …);   // inside tx (today's global-client call inside tx is DB-11)
});
after(() => notifyTournamentEvent(…));                      // was un-awaited (AA F-10)
```

### 8.8 Socket rules (H6, chess correctness)

- **Draw:** `offer_draw` sets `drawOfferBy = caller` (only a player; one pending offer); `accept_draw` succeeds only if the caller is the **other** player and `drawOfferBy` is set; any move by either side clears `drawOfferBy`.
- **Forfeit on disconnect:** the winner is the connected player via `getGameResult(colourOfDisconnected, "timeout")`; method stays `timeout` until v2 adds `abandoned`.
- **Restore:** `new Chess(startingFen)` then replay `moveHistory` SAN/UCI in order; any illegal move → refuse the restore (log, keep the DB row, tell clients `error { code: "restore_failed" }`) instead of starting from the start position. The `move` route accepts a write only when `incoming.length >= stored.length`.
- **Colours:** `creatorColor ∈ {"white","black"}` is written once at creation; `random` is resolved on the server at creation; the socket reads it and never re-randomises.

### 8.9 Timing constants

| Constant | Value | Where |
|---|---|---|
| Hairline delay / safety | 200 ms / 10 s | SPEC §8.2 |
| Chord timeout | 1000 ms | SPEC §8.2 |
| Palette debounce | 150 ms | SPEC §8.2 |
| `api()` timeout | 15 s | §7.12 |
| `qk.me()` stale / gc | 5 min / 30 min | §5.3 |
| Countdown tick | 250 ms (render), label `m:ss` from received seconds | §4.8 |
| Session flip debounce | 1500 ms | §8.6 |
| `session/clear` timeout on sign-out | 1.5 s | §8.6 |
| Toast durations | 3 / 3 / 8 / 8 / 6 / 6 s | SPEC §7.2 |
| `last_day` threshold | 36 h | IS §3.8 |
| Burst limiter window ceiling | 300 s | §8.1 |
| Billing compare-and-set retries | 3 re-reads, then `status = 'error'` (webhook retried by Dodo) | §8.11 |
| `membership-reconcile` batch | 50 users, 200 ms between Dodo calls | §7.8 |
| Activation poll (legacy) | 1 + 6 calls, 2 s apart, inside `billing-refresh` 10 / 60 s | §5.5 |

### 8.10 Research grounding

- Navigation model (4–5 destinations, rail at ~1100 px, bottom tab bar on phones, ⌘K and `/` palette, settings and help in the account menu): `REPO/research_notes/Chesscom UX teardown/home-nav-profile.md:39-40,155`.
- One-viewport board sizing from the height budget, snap to whole pixels, accept a document scroll only below ≈ 450 px of viewport height: `REPO/research_notes/Chesscom UX teardown/one-viewport-patterns.md:30,86,129-148` (SPEC D6 implements it with container-query units).
- Upstream politeness (one request at a time, wait 60 s after a Lichess 429; Chess.com parallel requests get 429): `REPO/research_notes/Chess coaching app market research/implementation.md:145,153`. P1 builds only the generic 429 contract; P4 applies it to imports.

### 8.11 Billing compare-and-set (`lib/billing/entitlement.ts`, 1B·F4b; ADB DB-06/DB-07, CA AP-06)

```ts
export async function applySubscriptionSnapshot(snapshot, { eventTime, source, userId }): Promise<ApplyOutcome> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const user = await findUserForSnapshot(snapshot, userId);              // today's lookup order (entitlement.ts:61-77)
    if (!user) return { status: "unmatched" };
    const sourceAt = eventTime ?? providerTimeOf(snapshot);                // webhook timestamp, or the API object's own
                                                                           // update time [V: field name in the Dodo SDK]; never now()
    if (!shouldApplySnapshot(user, snapshot, sourceAt)) return { status: "stale", userId: user.id };
    const fields = fieldsFromSnapshot(snapshot, getProductCatalog(), sourceAt);
    const trial = trialFieldsFromSnapshot(user, snapshot);
    const link = customerLinkFields(user, snapshot);                       // today's dodoCustomerId backfill rule
    const data = { ...fields, ...(trial ?? {}), ...link, ...(sourceAt ? { subscriptionSourceAt: sourceAt } : {}) };
    if (!changesAnything(user, data)) return { status: "applied", changed: false, userId: user.id };   // DB-06: no write
    const r = await prisma.user.updateMany({
      where: { id: user.id, subscriptionSourceAt: { equals: user.subscriptionSourceAt } },   // null-safe equality
      data: { ...data, subscriptionUpdatedAt: new Date() },               // "last written", no longer the ordering key
    });
    if (r.count === 1) return { status: "applied", changed: true, userId: user.id };
    // count 0: another writer won between the read and the write → re-read and decide again
  }
  return { status: "error", error: "cas_exhausted" };                    // the webhook answers 500 and Dodo retries
}
```

- `shouldApplySnapshot` orders by `user.subscriptionSourceAt ?? user.subscriptionUpdatedAt` (the fallback keeps today's behaviour for rows written before M1) and keeps the "prefer the subscription that grants access" rule for different subscription ids (`entitlement-rules.ts:122-133`).
- API-sourced snapshots without a provider timestamp never advance `subscriptionSourceAt`; they write only through the optimistic check, so any later webhook still applies.
- Unit tests (`lib/billing/entitlement.test.ts`, fake Prisma): a webhook older than an applied refresh does not overwrite it; a refresh older than an applied webhook does not overwrite it; two concurrent webhooks for the same user end with the newer one stored (the loser re-reads); a no-op snapshot issues no `UPDATE`; three lost races → `cas_exhausted`. Integration test (`lib/billing/entitlement.int.test.ts`, Docker Postgres): 10 concurrent applies with shuffled event times → the row holds the newest.
- P4 keeps its own additions (`lastPaymentFailedAt`, `membershipEndedAt`, …) and relies on this function; P4 §7.6's "P1 already applies snapshots with the compare-and-set" is now true.

---

## 9. Performance and optimisation

### 9.1 Hot paths in P1 and their budgets (OPT §2.1 classes)

| Path | Class | DB statements / round trips | Server p50 / p95 | Measured by |
|---|---|---|---|---|
| `(app)/layout.tsx` viewer read | R1 (inside the page render) | **1** (`$queryRaw` with `LEFT JOIN`); flags 0 | 6 ms / 30 ms | Sentry `db` span inside the page transaction (Prisma timing extension); statement count by the query-budget harness (§12.2) |
| `GET /api/me` | R1 | 1 | 20 ms / 80 ms; **k6 end to end p95 < 150 ms** | `perf/k6/src/scenarios/me.ts`; wrapper log `dbStatements` |
| `GET /api/me` revalidation (`If-None-Match` sent by the browser) | R1 | 1 (the ETag is a hash of the result) | same; saves the body | k6 |
| `GET /api/openings` | R1 (public) | **0** on a CDN HIT (no function invocation); on a MISS 0 with a warm `unstable_cache`, 1 when cold | CDN HIT ≈ edge latency; MISS 15 ms / 60 ms | `x-vercel-cache` (T20); Vercel function count in `ops-weekly` |
| `POST /api/billing/refresh` | X | 2–4 (limiter, read, CAS write, maybe re-read) + 1–2 Dodo calls | 400 ms / 1.5 s (Dodo-bound) | wrapper log; Sentry span `dodo.*` |
| Rate-limit check | — | 1 statement on an UNLOGGED table, in parallel with the viewer read | +0 ms on the critical path, 1–3 ms alone | `Server-Timing: rl` (non-production) |
| Dodo / Clerk webhook | WH | 3–4 (claim, read, CAS write, finish); Clerk BAPI in `after()` | 40 ms / 200 ms (`webhook.handle_ms`) | wrapper log `durationMs`; Sentry span |
| Middleware | edge | 0 | ≤ 30 ms p95 (Clerk verify) | `api.mw_lag_ms` (= handler start − `x-mw-start`, includes queueing) in the wrapper log and Sentry; Hobby keeps runtime logs only 1 h, so Sentry is the record (CF F-VER-7) |
| `GET /api/health` | P | 0 (deep: 1 + limiter) | 5 ms / 20 ms | UptimeRobot |

### 9.2 Request budget per hard load (AA §5.1 → target)

| Hard load | Today | After P1 |
|---|---|---|
| Member `/play` | document + `POST /api/user/sync` (Clerk BAPI + 2–3 queries + 1 write) → `GET /api/subscription` (1–2 Dodo calls + 1 write) + maybe `GET /api/user/email` + `GET /api/openings`/`/api/legends` when the 24 h store copy is stale | document only (1 viewer statement inside it); `/api/openings` from the CDN |
| Member `/game/<ref>` | same waterfall + `/api/socket-token` + `game-by-ref` | document + `GET /api/me` + `/api/socket-token` + `game-by-ref` |
| Signed-out `/legends` | document | document (now dynamic because the `(app)` layout calls `auth()`, SPEC R4) |
| Third-party calls on boot | 1 Clerk + 1–2 Dodo | 0 |
| DB writes on boot | 2 | 0 (asserted by the GET-purity check, §7.2 step 8) |

### 9.3 Caching layers used in P1

| Layer | Use | Never |
|---|---|---|
| React `cache()` | `getViewerRecord`, `getViewer`, `getFlags`, `getShellSession`, `getServerQueryClient`, `requestNow` (per request) | across requests |
| Next data cache (`unstable_cache`) | openings index (public data, tag `openings`, 24 h) | user data |
| Module scope | posthog-node client and its flag definitions (30 s poll), Dodo/Clerk clients, product catalog | user data, entitlement |
| HTTP `private-etag` | `/api/me` (browser revalidates every time, 304 saves the body) | anything with `Set-Cookie`; never `max-age > 0` |
| CDN (`public-static`) | `/api/openings` (`s-maxage=86400`, `swr=604800`, tag `openings`) | anything that reads a session |
| TanStack Query | `qk.me()`, openings index | across sign-outs (cleared) |
| Browser HTTP cache | revalidation only (`no-cache`); emptied at sign-out by `Clear-Site-Data: "cache"` | per-user bodies with a lifetime |
| Service worker | precache + static assets only; `/api/*` and RSC `NetworkOnly` (H8) | authenticated JSON or HTML |

H8 config (merged before 1A·P0 starts, or applied by P0 in the same edit), with H12's image allow-list in the same window:

```js
const withPWA = withPWAInit({
  dest: "public",
  cacheOnFrontEndNav: false,             // was true: cached signed-in HTML per user
  aggressiveFrontEndNavCaching: false,   // was true
  reloadOnOnline: false,                 // SPEC D18 (P0 makes the same change)
  disable: process.env.NODE_ENV === "development",
  publicExcludes: [/* unchanged */],
  extendDefaultRuntimeCaching: true,
  workboxOptions: {
    disableDevLogs: true, exclude: [/\.wasm$/],
    runtimeCaching: [
      { urlPattern: ({ url }) => url.pathname.startsWith("/api/"), handler: "NetworkOnly" },
      { urlPattern: ({ request, url }) => request.headers.get("RSC") === "1" || url.searchParams.has("_rsc"), handler: "NetworkOnly" },
    ],
  },
});
// H12 (next.config.js:72-79)
images: { remotePatterns: [
  { protocol: "https", hostname: "img.clerk.com" }, { protocol: "https", hostname: "images.clerk.dev" },
  { protocol: "https", hostname: "images.chesscomfiles.com" } /* + hosts found at implementation time */ ] },
```

Acceptance: after `pnpm --filter web build`, `grep -n "NetworkOnly" public/sw.js` shows both routes registered **before** the plugin's default `apis` and `pages` routes (Workbox matches the first registered route); if the order is wrong, set `extendDefaultRuntimeCaching: false` and re-add the static-asset defaults explicitly (CDL §7.1 sketch). Checked on the production build in SPEC §12.3 step 4 with DevTools → Application → Cache Storage: no `apis` entries after visiting `/play` and `/api/me`. For H12, a crawl of every page with images (the SPEC dead-link crawl) shows no `400` from `/_next/image`, and `/_next/image?url=https://example.com/x.png&w=64&q=75` returns `400`.

### 9.4 Payload sizes

| Response | Budget (gzip) | Expected |
|---|---|---|
| `GET /api/me` | ≤ 1 KB | ≈ 0.45 KB |
| `GET /api/openings` | ≤ 60 KB (P8 replaces it with a paged search) | ≈ 35–40 KB (3,641 × `{id, eco, name}`) |
| `POST /api/billing/refresh` | ≤ 1.5 KB (until the `legacy` mirror goes) | ≈ 0.8 KB |
| `GET /api/health` | ≤ 0.3 KB | 0.1 KB |
| error envelope | ≤ 0.4 KB | 0.15 KB |
| RSC flight for the `qk.me()` seed | ≤ 1.5 KB | ≈ 1 KB (dehydrated state) |

### 9.5 Bundle impact

| Addition | gzip | Loaded |
|---|---|---|
| `@tanstack/react-query` | ≈ 13 kB | every page (root `Providers`; P11 D2 moves it out of marketing pages) |
| `@tanstack/react-query-devtools` | 0 in production | dev only via `next/dynamic` |
| `lib/api/*`, contracts envelope types | ≈ 3 kB | every page |
| zod response schemas | **0 in production only because every call site uses `devSchema()`** (§7.12); a schema passed directly would be retained by tree-shaking (CA AP-12) | dev/test |
| `@repo/analytics` event registry | types only on the client; schemas are parsed in the e2e fixture, never in the browser | — |
| `posthog-node` | 0 client | server only |
| SessionExpiredModal, RetryCountdown | ≈ 2 kB, `next/dynamic` on first need | lazily |

Budget rule (`scripts/check-bundle-budgets.mjs`), **blocking from P1** (CA AP-12): shared First Load JS must not grow more than **+25 kB gzip** over the `0848b76` baseline (333 kB, AC §10.1) from 1A + 1B together; and `ZodError` must not appear in any `.next/static/chunks/**/*.js` outside the chunks the script allow-lists (none in P1). The long-term targets (shared ≤ 200 kB, OPT §5.7) are P2–P11 work. Measured from the `next build` route table on CI and attached to the PR.

### 9.6 Neon and Vercel quota guards

- **Dev and E2E have their own Neon project** (H10), so a busy dev week can no longer suspend the project that holds the future production branch; autoscaling max 0.5 CU. CI never touches Neon (Docker Postgres, §13.4); only the dev-URL smoke jobs and the owner use the dev database.
- `/api/health` default does no DB call (uptime monitors never wake Neon); `deep=1` is rate-limited.
- One daily cron = one Neon wake per day; no timers anywhere in P1.
- `/api/openings` is served by the CDN, so repeat reads cost neither a function invocation nor a Neon wake.
- Rate limiter on two non-hot buckets only.
- Middleware returns early for scanner paths and excludes webhooks, cron, health, openings, `monitoring`, `ingest`, `og`, `workers` from Clerk processing.
- `tracesSampler` cuts Sentry server spans from 100 % to ≈ 10 % on production (dev keeps 1.0 for page transactions while dev traffic stays under the Sentry quota [V4]).
- Speed Insights `sampleRate={0.2}` and no events from automated browsers (`navigator.webdriver`), because Hobby allows 10,000 events per 30 days team-wide (CF F-VER-5).
- `UserSync` no longer writes to Neon on every hard load (−2 writes per boot).
- `ops-weekly.yml` reports every Hobby metric and Neon CU-h as % of pro-rata and raises `quota-alert` at 60 % (Hobby pauses an exceeded feature for up to 30 days, CF F-VER-2) and at 50 % for CU-h; at the alert, test traffic against the dev URL stops until the week resets.
- The nightly full suites run against `next start` on the runner, never the deployed dev site (CF F-VER-3).

### 9.7 How the SLOs are measured

1. **k6** `perf/k6/src/scenarios/me.ts`: 20 VUs, 2 min, against the dev deployment with Clerk session tokens from `perf/k6/setup/generate-clerk-tokens.ts`; thresholds `http_req_duration{name:me}: p(95)<150` with `abortOnFail: true`, `checks>0.99`; custom trends `server_total`, `server_db` parsed from `Server-Timing` (API responses carry it outside production); a second stage sends `If-None-Match` and asserts 304s. The JSON summary goes to `REPO/perf/results/p01-me-<sha>.json`; `REPO/perf/compare.ts` flags a regression > 15 % against the previous phase's file (CT X18). Run from GitHub Actions `workflow_dispatch` (`perf-tests.yml`) or locally, after H10 so it never hits the old shared project.
2. **Query-budget harness** (`test/helpers/query-counter.ts`, a Prisma `$extends` counter; CT P1): the `(app)` layout viewer read is exactly 1 statement, `GET /api/me` is 1, a CDN-MISS `GET /api/openings` with a warm data cache is 0, `POST /api/billing/refresh` is ≤ 4.
3. **Playwright request counter** (`e2e/specs/data-layer.spec.ts`): asserts the hard-load request counts in §9.2.
4. **Neon:** `EXPLAIN (ANALYZE, BUFFERS)` of the viewer statement, the limiter upsert and the CAS update on the dev database (Neon MCP `explain_sql_statement`), recorded in the sign-off; `pg_stat_statements` top-10 before/after the test window (Neon MCP `list_slow_queries`).
5. **Sentry:** page transactions with `db` spans for the layout read; `api.duration_ms`, `api.mw_lag_ms`, `webhook.handle_ms` [V4: Sentry metrics availability on SDK v10; fallback: span attributes and Sentry Logs at info].
6. **Vercel:** `get_runtime_errors` for 5xx within the 1-hour Hobby log window right after each test run; durations come from Sentry, not Vercel logs.
7. **Web Vitals:** Speed Insights on dev (sampled); members' CLS on `/play` and `/legends` ≤ 0.1; lock pages ≤ 0.02 as a **lab** gate on the device × zoom matrix (field data cannot be segmented by zoom, CA AP-35).

---

## 10. Telemetry

### 10.1 Event registry and PostHog events

All events are declared once in **`REPO/packages/analytics`** (`@repo/analytics`, new in 1Q·1; CT X6): `src/events/<area>.ts` exports a zod schema per event with a closed property set (`.strict()`, enum-typed strings) and `src/index.ts` exports the `EventName` union and `EventProps<N>` types. Client helpers are typed against it and import **types only** (no zod in the browser bundle); the schemas are parsed by the e2e telemetry fixture in Node. A static test fails on any `trackShell(`, `trackSystem(` or `track(` call whose event is not registered, and on any declared property named `email`, `q`, `query`, `fen`, `pgn` or `name`. P8's planned `packages/analytics/src/events.ts` and P11's folder layout move here.

Track 1A's shell events are SPEC §3.10 (`trackShell`: `shell_nav_click`, `shell_palette_opened`, `shell_palette_command`, `shell_shortcuts_opened`, `shell_shortcuts_toggled`, `shell_account_action`), registered in `src/events/shell.ts` (1Q·2 retypes `trackShell` against the registry after 1A·INT). Track 1B adds `src/events/system.ts` and `lib/analytics/system-events.ts` (`trackSystem()`, no-op when PostHog is not loaded or on `/dev/**`, never sends query text, emails or ids other than refs):

| Event | Properties | Fired when |
|---|---|---|
| `rate_limited_shown` | `route_id`, `bucket`, `retry_after_sec`, `surface: "inline" \| "page"` | `RetryCountdown` mounts; `/too-many-requests` renders |
| `rate_limited_retry` | `route_id`, `waited_sec`, `result: "ok" \| "limited_again"` | first request after `inline_ready` |
| `session_expired_shown` | `source: "api_401" \| "clerk" \| "visibility" \| "broadcast"`, `route_template` | modal opens |
| `session_expired_action` | `action: "sign_in" \| "different_account"` | button pressed |
| `payment_banner_shown` | `state: "banner" \| "last_day" \| "expired"` | first render per session (1A·P7 adds the call in `ShellBanners`) |
| `payment_banner_cta` | `state` | Update Payment / Renew Membership |
| `payment_banner_dismissed` / `payment_banner_undo` | — | dismiss / Undo |
| `api_error_toast` | `route_id`, `code`, `status` | `reactToApiError` raises a toast (sampled 100 %; low volume) |

Server-side PostHog (posthog-node `capture` in `after()`, `distinct_id = viewer.ref`): `webhook_processed { provider, type, outcome: "applied" \| "duplicate" \| "stale" \| "unmatched" \| "ignored" \| "error", changed: boolean, lag_ms }` where `lag_ms = receivedAt − eventTime`; `billing_refreshed { result: "changed" \| "unchanged" \| "upstream_down", source: "activation" \| "membership" \| "checkout" }`. All events carry `app_env` (super property set from `NEXT_PUBLIC_APP_ENV`; the server sets it per capture).

**Sinks for automated checks (CT X6).** When `NEXT_PUBLIC_TELEMETRY_SINK=1` (accepted only in `NEXT_PUBLIC_APP_ENV=test` builds), every client `track()` also pushes `{ event, props, ts }` to `window.__rcTelemetry` and sampling is forced to 100 %. Server events go to `POSTHOG_HOST=http://127.0.0.1:4011`, the mock `e2e/mocks/posthog-sink.ts` (started by Playwright's `webServer`), which records `/capture`, `/batch` and `/e` bodies and serves `GET /__events?since=&distinct_id=`. The fixture `e2e/fixtures/telemetry.ts` provides `telemetry.expect(name, match, { count })`, `telemetry.none(name)` and `telemetry.forbid(text)`, and an auto-use `afterEach` that parses **every** captured event with its registry schema (unknown events and extra keys fail) and runs the **PII guard**: any property value that matches an email, a FEN prefix `^([prnbqkPRNBQK1-8]{1,8}/){7}`, a PGN move run `\b\d+\.(\.\.)?\s?[KQRBNO]?[a-h1-8x=+#-]{2,}`, the test user's name or email, or text registered with `forbid()` fails the test. When P11's consent gate lands, the fixture sets the consent cookie by default (only `consent.spec.ts` covers the reject path).

### 10.2 Sentry

| Item | Setting |
|---|---|
| PII | `sendDefaultPii: false` in `sentry.server.config.ts`, `sentry.edge.config.ts` (H7) and `instrumentation-client.ts` (1B·J); `Sentry.setUser({ id: me.user.ref })` in `UserSync`, never the email |
| Server `tracesSampler` | 1.0 for `/api/webhook/*`, `/api/checkout`, `/api/subscription*`, `/api/billing/*`; 0 for `/api/health*`; `/api/me` 0.1; page transactions 1.0 when `NEXT_PUBLIC_APP_ENV=dev`, 0.1 on production; 0.1 default |
| Client | `tracesSampleRate: 0.1` (1B·J); Replay on error only (unchanged config otherwise) |
| Exceptions | `logger.error(msg, err, ctx)` → `Sentry.captureException(err, { extra: ctx })` (H7); `route()` captures unknown errors with `route` and `request_id` tags; 4xx are breadcrumbs |
| Spans | `api <id>` per route with tags `route`, `auth`, `class`, `cache`, `status`, `code`; one `db` span per Prisma statement (timing extension) |
| Metrics [V4] | `api.duration_ms{route,class}`, `api.status{route,code}`, `api.mw_lag_ms`, `rate_limited{bucket}`, `rate_limited.error{bucket}`, `webhook.lag_ms{provider,type}`, `webhook.handle_ms{provider}`, `viewer.provisioned`, `claims_sync{result}`, `billing.cas{result}` |
| Tags | `legacy_envelope` on every response served through a legacy mirror or adapter (tracks when they can be deleted) |
| Removed | `trackApiResponseTime` calls in `UserSync.tsx:102-109` and `useDataStore.ts:89-91` (OPT §9.2) |
| Socket (H6) | `sendDefaultPii: false` in `WS/instrument.ts`; events for `restore_failed`, `persist_retry`, `draw_rejected` |
| Error window | `REPO/scripts/qa/error-window.ts --since <deploy time>` prints new Sentry issues per project for `environment:dev` (Sentry API, `SENTRY_AUTH_TOKEN`) and Vercel runtime errors; its output goes into the sign-off record (CT X6.7) |

### 10.3 Logs

One JSON line per API request from `route()` (§7.2 step 11). The socket logs `{ game, ply, user, phase }` at info for lifecycle events only. Hobby keeps Vercel runtime logs for 1 hour, so anything needed later goes to Sentry (warn and above, plus the wrapper's metrics).

---

## 11. Security, privacy, paywall and authorisation

### 11.1 Access matrix after P1

| Surface | Signed out | Signed in, non-member | Member | Admin | Internal token |
|---|---|---|---|---|---|
| Public pages (`publicPages`) | yes | yes (marketing chrome) | yes (shell on `(app)` pages) | yes | — |
| Member pages (`memberPages`) | → sign-in | → `/pricing?reason=required` or `?reason=ended` (middleware when the claim says so, else the client gate) | yes | yes | — |
| Other signed-in pages (`/onboarding`, `/admin/**`, `/checkout/**`) | → sign-in | yes (`/admin` also checks the DB role in `app/admin/layout.tsx`) | yes | yes | — |
| `/dev/**` | only when `devRoutesEnabled()` (SPEC D11) | same | same | same | — |
| Scanner paths (`/wp-*`, `*.php`, `/.env`, …) | 404 | 404 | 404 | 404 | — |
| `GET /api/openings`, `GET /api/health`, `POST /api/session/clear` | 200 / 204 | 200 / 204 | 200 / 204 | 200 / 204 | — |
| `GET /api/me`, `/api/socket-token`, `/api/subscription`, `POST /api/billing/refresh` | 401 | 200 | 200 | 200 | — |
| Admin content APIs (A10, A11) | 401 | 403 | 403 | 200 | — |
| `POST /api/chess/{move,game-over,game-state}` | 401 | 403 | 403 | 403 | 200 |
| `GET /api/chess/game-by-ref/[ref]` | invite projection | invite projection | participant: full; else projection | projection (admins get full reads via P12 admin routes) | full |
| `/api/user/[ref]`, `/api/user/email/[email]` | 404 | 404 | 404 | 404 | — |
| Cookie-authenticated API mutation from another site | — | 403 | 403 | 403 | — |
| Webhooks | signature only | — | — | — | — |
| `/api/cron/daily` | bearer only | — | — | — | — |
| Socket `join_game`, moves, `accept_draw` | handshake refused (`SOCKET_AUTH_REQUIRED=true`) | as today (entitlement on sockets is P2 `ent` claim) | player rules (§8.8) | — | — |
| Socket `/internal/tournament-event` | 401 | — | — | — | 200 |

`test/authz/access-matrix.test.ts` encodes this table against `classify()` and the `auth` of every registry entry; `test/authz/walker.test.ts` covers every other `app/api/**/route.ts` through `test/authz/legacy-routes.ts` (§12.2).

### 11.2 Secrets and identity

- **H5, in this order** (CF SEC-1): (1) the owner rotates the Clerk secret found in `REPO/k8s/secrets.yaml:12` in the instance that issued it (its `sk_test_` prefix points at a development instance; confirm in the Clerk dashboard which one); (2) delete `REPO/k8s/`, `REPO/build-and-push.sh` and the `CLERK_SECRET_KEY` build arg in `REPO/docker-compose.yml`; (3) add gitleaks to `ci.yml` (`gitleaks detect --log-opts=--all` against `REPO/.gitleaks-baseline.json`, which records the rotated key so history scans stay green; any new finding fails). Git history keeps the old value, which is why rotation is mandatory; a history rewrite is optional and not planned.
- **H9:** `PERF_AUTH_BYPASS` honoured only when `testHooksEnabled()` and `x-perf-token === PERF_TOKEN` (timing-safe); a startup `logger.warn` when it is on; `perf/k6/src/lib/config.ts` sends the header. `lib/env-server.ts` is self-contained (reads `process.env.NEXT_PUBLIC_APP_ENV` and `ALLOW_TEST_HOOKS` directly) so the `main` cherry-pick does not depend on SPEC's `lib/env.ts`; with neither variable set, as on the live project today, every hook is off.
- Timing-safe compares everywhere a secret is compared (`lib/auth/secrets.ts` `tokenMatchesSecret`).
- Identity is always `googleId` (= Clerk user id); email linking only for a verified primary address (§8.5).
- Separate secrets per boundary: P1 adds `CRON_SECRET`, `CLERK_WEBHOOK_SIGNING_SECRET`, `E2E_TEST_TOKEN`; `SOCKET_TOKEN_SECRET` (user tokens) starts in P2; services keep `INTERNAL_API_SECRET` until Q-18 is decided (CC 1.2).
- **Repository exposure** (CF SEC-2): the repo is public and `CLAUDE.md` carries the registrar account, domain expiry, server IPs, dev URLs and the SSH user. Moving the environment and account sections to a gitignored `CLAUDE.local.md` is the owner's call (Q-17); Claude does not edit `CLAUDE.md` without that instruction.

### 11.3 Privacy

- `/api/me` returns only the caller's own data; date of birth is never returned anywhere after H3.
- Clerk webhook payloads (emails) are not stored; Dodo payloads are kept 180 days for billing disputes, then deleted.
- Sentry without default PII; PostHog events carry refs only and are checked by the PII guard in CI; logs never contain bodies, emails or tokens.
- Entitlement is no longer persisted in `localStorage` (`useUserStore` persist version 2 drops `subscription`; `migrate` deletes it from old snapshots). The persisted `user` object no longer includes `email`.
- The service worker never stores `/api/*` or RSC responses (H8); sign-out purges runtime caches (1A·P3), the query cache and the browser HTTP cache (§8.6).
- The live-database backups are `age`-encrypted before they reach GitHub (artifacts of a public repository are downloadable by any signed-in GitHub user); only the owner holds the identity outside the `BACKUP_AGE_IDENTITY` secret used by the restore check.

### 11.4 Paywall rules in P1

- APIs: `route({ auth: "member" })` and the legacy `requireSubscribedUser` decide from the DB; 402 with `details.reason`.
- Pages: middleware claim gate (when enabled) + the existing client gate; neither redirects on an error (F4d). Targets: `reason=required` for never-paid, `reason=ended` for lapsed (B26 default, §8.3).
- Chrome: shell only for members with `shell-v3` on (SPEC D2 + flag).
- Lapsed users: hard redirect (B26 default) until the owner decides Q-09.
- No free tier anywhere in copy or links (SPEC §1). E2E runs with `BILLING_PAYWALL=on` (§12.3), so the gates are exercised end to end.

### 11.5 Abuse protection

- Rate-limit buckets (§8.1); Vercel Firewall rules are an owner check (API §2.10 layer 1; Hobby includes 3 custom WAF rules, rate-limit rule availability unverified, Q-08).
- CSRF: Clerk cookie SameSite=Lax plus the middleware `Sec-Fetch-Site` / `Origin` check on cookie-authenticated API mutations (same-origin only).
- Request bodies capped by `maxBodyBytes` with a streaming reader before parsing.
- Scanner probes answered 404 in middleware before any Clerk or function work.
- `/api/openings` is CDN-cached; repeated scraping costs CDN requests (watched by `ops-weekly`), not functions or Neon.
- The dev site is not a free copy of the product once Vercel Authentication is on (Q-16); until then every dev response is `noindex`.

### 11.6 Test hooks (`lib/test-hooks/registry.ts`, 1Q·1; CT X12)

| Hook | Kind | Guard | Production proof |
|---|---|---|---|
| `/dev/**` | route | `devRoutesEnabled()` (SPEC D11) | 404 |
| `x-rc-fault` | header | `testHooksEnabled()` | response identical to one without the header |
| `x-rc-now` | header | `testHooksEnabled()` + `x-e2e-token` | ignored |
| `FLAGS_OVERRIDE` | env | `testHooksEnabled()` | ignored; startup `logger.error` + Sentry when set on production |
| `PERF_AUTH_BYPASS` | env | `testHooksEnabled()` + `x-perf-token` | ignored; startup error log |
| `NEXT_PUBLIC_TELEMETRY_SINK` | env (build) | `NEXT_PUBLIC_APP_ENV=test` | no `window.__rcTelemetry` |
| `e2e-fixture` product | data | `isNonProdApp()` | resolves to no plan + Sentry warning |
| `BILLING_PAYWALL=off` | **kill switch**, not a hook | — | allowed in production (Phase 0 ops switch); a startup warning when off |

`lib/test-hooks/registry.test.ts` fails when any file under `app/dev/**`, `app/api/dev/**` or `app/api/test/**` has no registry entry, and when an entry's guard is not `testHooksEnabled()`, `isNonProdApp()` or `devRoutesEnabled()` (later phases' "`APP_ENV=dev` only" hooks become `testHooksEnabled()` so they also work in CI's `test` builds). `e2e/specs/prod-guard.spec.ts` builds with `NEXT_PUBLIC_APP_ENV=production` **and** `ALLOW_TEST_HOOKS=1`, starts it on port 3200 and iterates the registry. In production a misconfigured env hook is ignored and reported, never a refused boot (that would be an outage).

---

## 12. Testing

Track 1A's full test plan is SPEC §5.4, §6.4, §7.4, §8.4, §9.5, §10.6–10.7, §11.4 and the integration run §12. It is not repeated here. Tracks 1B and 1Q add the following, and 1Q builds the shared tools every later phase uses (§12.9).

### 12.0 Conventions (CT X1, X4, X11, X14)

- **Runner:** `node:test` via `tsx` in every package (SPEC D13). No Vitest anywhere (architecture §5.1, P11 and P13 wording are corrected to this).
- **Layout:** unit tests beside the source as `*.test.ts`; DB-backed tests `*.int.test.ts` (they call `test.skip` unless `TEST_DATABASE_URL` is set); route, contract and authz tests under `WEB/test/{api,integration,authz}/`; fixtures under `WEB/e2e/fixtures/`; personas under `WEB/e2e/personas/pNN.ts`. `WEB/tests/` is never used.
- **Scripts** (the `apps/web/package.json` lines are requested from 1A·P0, §13.2):
  - `"test:unit": "tsx --test \"app/**/*.test.ts\" \"lib/**/*.test.ts\" \"components/**/*.test.ts\" \"features/**/*.test.ts\" \"scripts/**/*.test.ts\" \"worker/**/*.test.ts\" \"prisma/**/*.test.ts\" \"test/**/*.test.ts\" \"e2e/devices/**/*.test.ts\" \"e2e/fixtures/**/*.test.ts\""` (int tests self-skip);
  - `"test:int": "tsx --test \"**/*.int.test.ts\""` (CI `integration` job, Docker Postgres);
  - every package and `WS` gets `"test"` and `"test:int"` with the same pattern.
- **Orphan guard:** `REPO/scripts/qa/check-test-globs.mjs` lists `git ls-files '*.test.ts' '*.test.tsx'`, expands every package's test globs with `node:path` `matchesGlob` (Node 22) and fails CI on any file no script runs.
- **Tags:** every spec carries `@p<N>` for its owning phase; 3–6 specs per phase carry `@smoke`; design states are tagged `@state:<Board>.<value>` (real data) or `@demo:<Board>.<value>` (demo route); specs that need local-only fixtures (sinks, mocks, the local socket) carry `@local-only` and are skipped against `E2E_BASE_URL`.
- **E2E users (CT X4):** `WEB/e2e/fixtures/users.ts` is the registry. A–P are **shared members**: specs may only add data to them and never assert absolute counts. Q (trial used) and R (never trialled) are read-only. S is the dedicated payment-persona user. `E2E_ADMIN_EMAIL` is the admin login (not a letter). Every exact state comes from the **persona pool** `E2E_POOL_01…24` (permanent Clerk dev users, so no Clerk churn): `leasePersona(name)` takes a deterministic slot from `testInfo.parallelIndex` and resets it with `scripts/dev/personas.ts --reset <pool user> --persona <name>`. Cross-run exclusivity on the shared dev database comes from a run-level lock: global setup takes `pg_try_advisory_lock(hashtext('rc-e2e-dev'))` on the dev `DIRECT_URL` and fails fast ("another E2E run holds the dev database") when the owner, nightly and post-deploy runs overlap; CI jobs on Docker Postgres skip the lock. Truly destructive flows (P10 deletion, P11 sign-up) create one throwaway `e2e-<flow>-<runId>@…+clerk_test` user. `e2e/scripts/sweep-throwaway-users.ts` (global setup) deletes `e2e-*` Clerk users older than 2 h with their rows and fails when the instance is within 20 users of its cap. `e2e/fixtures/users.test.ts` fails when a spec mutates a shared letter or two spec files lease the same persona without serial mode. Queue specs run in a `play-queue` project with `workers: 1` until P2's token-based isolation.
- **Fixture health (CT X3):** `e2e/fixtures/health.ts`, called from global setup, re-runs the idempotent `--entitle` upsert for A–P and fails the run with a clear message when any of A–P has `currentPeriodEnd < now + 30 d`, Q lost `trialUsedAt`, or R has a subscription.
- **Server time (CT X5):** `e2e/fixtures/time.ts` `serverNow.set(iso)` sets `x-rc-now` and `x-e2e-token` on the page's requests; specs assert server deadlines with it, not with `page.clock` alone.
- **Console guard (CT X7):** auto-use `e2e/fixtures/console-guard.ts` fails on `pageerror`, `console.error`, hydration mismatch messages, and any `/api/*` response ≥ 500 the spec did not inject with `x-rc-fault`. New specs are enforced; legacy specs listed in `e2e/console-baseline.json` report only (the file may only shrink); per-spec `test.use({ allowConsole: [/ResizeObserver loop/] })`.
- **Regression rule (CT X14):** every defect found by the owner test, the ego-browser checklist or a real-device pass gets a failing test first, named `regression: <slug> (#issue)`. `e2e/quarantine.json` holds `{ testId, reason, owner, expires ≤ 14 d }`; PR CI skips those tests through `grepInvert`, nightly still runs and reports them, and CI fails on an expired entry. `retries: 1` in CI; a test that passes only on retry is listed as flaky, and two flaky nights quarantine it automatically with an issue.

### 12.1 Unit tests

| File | Cases |
|---|---|
| `REPO/packages/contracts/src/http/codes.test.ts` | every `ErrorCode` has exactly one status, and it is in `ALLOWED_STATUSES`; `SUBSCRIPTION_REASONS`, `CONFLICT_REASONS`, `FORBIDDEN_REASONS` have no duplicates |
| `REPO/packages/contracts/src/http/envelope.test.ts` | unknown code parses as `internal`; missing `requestId` fails; `ok(schema)` accepts `{ data }` and `{ data, meta }` |
| `REPO/packages/contracts/src/http/cursor.test.ts` | round trip; tampered base64 → null; wrong arity → null; version ≠ 1 → null |
| `REPO/packages/contracts/src/http/registry/registry.test.ts` | ids unique; `method + path` unique; every `public-*` entry has `auth: "public"`; `public-static` has `publicStatic`; `sideEffects` only on GETs; burst limits ≤ 300 s |
| `REPO/packages/analytics/src/events/{shell,system}.test.ts` | each schema rejects extra keys; no property named `email`, `q`, `query`, `fen`, `pgn`, `name`; the static scan finds no unregistered `trackShell(` / `trackSystem(` / `track(` event |
| `lib/env-server.test.ts` | `testHooksEnabled()`: `VERCEL_ENV=production` + `NEXT_PUBLIC_APP_ENV=dev` + `ALLOW_TEST_HOOKS=1` → on; `NEXT_PUBLIC_APP_ENV=production` + `ALLOW_TEST_HOOKS=1` → off; unset → off; `dev` without `ALLOW_TEST_HOOKS` → off; `test` + `1` → on |
| `lib/api/route.test.ts` | (module load) each §7.2 step-0 assertion throws; (auth) public/optional/user/member/owner/admin/internal/cron/webhook allow and deny paths with injected `getAuth`/`getViewer` (`lib/api/context.ts` test seam); `public` never calls `auth()`; member denial carries `details.reason`; internal token on a route not in `INTERNAL_ROUTE_IDS` → 401; (body) 413 by header and by streamed size without reading past `maxBodyBytes + 1`; `invalid_json`; `validation_failed` with `fields` and `issues`; `__rcfault` stripped before validation; (response) `{ data }` wrapping; `paged()` meta with `total` only on the first page; BigInt throws in test; `Date` → ISO; (cache) each tier's exact headers; `private-etag` → ETag + 304 on match; errors are `no-store`; a hand-set `max-age` on a non-public route throws in test; (GET purity) a GET that writes throws `get_wrote` unless it declares the side effect; (errors) `ApiError` mapping; Prisma P2002/P2025/P2024/P1001 mapping incl. one GET retry; unknown error → 500 with generic message and `captureException` called; (headers) `x-request-id` echoed or generated; `Retry-After` on 429; `mwLagMs` from `x-mw-start`; (hooks) `x-rc-fault` honoured only with `testHooksEnabled()`; `x-rc-now` needs the token as well |
| `lib/api/now.test.ts` | `x-rc-now` honoured with the token in dev and test, ignored without the token, ignored in production (CT X5) |
| `lib/api/serialize.test.ts` | nested BigInt, Dates, `undefined` dropped, `null` kept, Decimal-like objects rejected in dev |
| `lib/api/etag.test.ts` | stable `fnv1a64` for equal JSON; key order matters only through `JSON.stringify`, so DTO builders produce fixed key order |
| `lib/api/errors.test.ts` | `toApiError` for the envelope, legacy `{ error: string, code }`, legacy `{ success: false }`, empty body, HTML 502 page; `retryQuery` (never 4xx, 2× 5xx/network, 1× upstream); `retryDelay` honours `retryAfterSec` and stays within jitter bounds; `reactToApiError` dispatch table with fake `sessionGuard`, `navigation`, `notify` (401 → guard once; 402 `trial_available` → `reason=required`, `trial_used`/`expired`/`payment_failed` → `reason=ended`; 429 → nothing; mutation 500 → one toast with the 8-char event id; `meta.errorUi = "inline"` → no toast) |
| `lib/api/client.test.ts` | `fault` adds the header and a fresh `__rcfault` per call; `devSchema()` returns `undefined` when `NODE_ENV=production`; no `ifNoneMatch` option exists (type test) |
| `lib/api/keys/keys.test.ts` | `norm()` drops empty values and sorts keys; every factory's first segment is its file's domain |
| `lib/api/legacy.test.ts` | `unwrapLegacy` for the three success shapes |
| `lib/rate-limit-db.test.ts` | `decideWindow`: first hit, hit within window, hit after `resetAt`, exactly `limit`, `limit + 1` → denied with `retryAfterSec ≥ 1`; key builders (`by: user/ip/user+ip`), IP hash never contains the raw IP; table choice by store; the SQL text snapshot (guards accidental edits); DB error → fail open |
| `lib/rate-limit-db.int.test.ts` | 50 concurrent upserts on one key → counts 1..50 with no duplicates; window rollover; both tables |
| `lib/auth/viewer.test.ts` | `toViewer`/`toMeData` with fixed `now` and the catalog `{ monthly: "pdt_m", yearly: "pdt_y", legacy: ["pdt_old"] }` (built like `lib/billing/entitlement-rules.test.ts`): active member; trial 5 days → `daysLeft` 5, 3 h → 1; cancelling; past_due 4 days left → `banner`; 30 h left → `last_day`; failed after period → `expired`; admin without plan → `member: true`; paywall off → `member: true`; `ratingLabel` blitz/rapid/null; `eligible`; `e2e-fixture` → monthly in dev/test and no plan in production; `VIEWER_COLUMNS` equals the `VIEWER_SELECT` keys |
| `lib/auth/viewer.int.test.ts` | the raw viewer statement against Docker Postgres after `migrate deploy`: one row with the profile ratings, no row for an unknown `googleId` |
| `lib/auth/require-subscription.test.ts` | `reasonFor()` for the four reasons; legacy mirror present iff `LEGACY_402_MIRROR=on` |
| `lib/auth/claims.test.ts` | `computeClaims` for member, trial, lapsed after trial, lapsed after paid, admin |
| `lib/auth/provision-user.test.ts` | (with a fake Prisma and a fake Clerk user) unverified primary → no relink, no create; verified → relink by email; P2002 race → re-read; code retry |
| `lib/auth/route-classes/route-classes.test.ts` | every path in `REPO/docs/route-map.md`'s public list → `public`; `/play`, `/game/x`, `/tournaments` → `member`; `/onboarding`, `/admin` → `signed_in`; `/playlist` is not `/play`; `/join-tournament/x` → member (not `/join`); `/api/webhook/dodo-payments`, `/api/openings` → `api_no_clerk`; `/wp-login.php`, `/x/.env`, `/index.php`, `/legends/x.php` → `scanner` (no real route ends in `.php`, `.env` or `.git`) |
| `lib/auth/secrets.test.ts` | `tokenMatchesSecret`: equal, different length, empty, undefined secret |
| `lib/billing/entitlement.test.ts` | the §8.11 cases (older webhook vs refresh, refresh vs webhook, concurrent writers, no-op skip, `cas_exhausted`) |
| `lib/billing/entitlement.int.test.ts` | 10 concurrent applies with shuffled event times → the newest wins |
| `lib/cron/tasks/tasks.test.ts` | task order; one failing task does not stop the next; `membership-reconcile` picks ≤ 50 rows and spaces calls (fake clock) |
| `lib/flags/flags.test.ts` | precedence (override > PostHog > default); override ignored when hooks are off; PostHog timeout → defaults; unknown key in override ignored; registry merge has no duplicate keys across `pNN.ts` files |
| `lib/webhooks/record.test.ts` | outcome decision table for the claim SQL's result rows (new, duplicate, re-admitted error, re-admitted stuck) via a fake `$queryRaw` |
| `lib/test-hooks/registry.test.ts` | §11.6 cases |
| `components/system/countdown.test.ts` | `formatMmSs` (0 → `0:00`, 65 → `1:05`, 3600 → `60:00`); countdown from received seconds with a fake clock |
| `lib/shell/shell-user.test.ts` (1A·P7 additions) | `paymentIssueState` thresholds identical to `toMeData` |
| `e2e/fixtures/users.test.ts` | §12.0 user-registry rules |
| `WS/test/draw-auth.test.ts` | in-process server + `socket.io-client`: non-player `accept_draw` rejected; accept without offer rejected; the offerer can't accept their own offer; a move clears the offer |
| `WS/test/join-identity.test.ts` | with `SOCKET_AUTH_REQUIRED=true`: no token → `connect_error unauthorized`; payload `userReferenceId` ≠ token `sub` is ignored |
| `WS/test/restore.test.ts` | restore replays `moveHistory` to the stored FEN (Opera Game prefix from `prisma/fixtures/design-legend-positions.ts`); an illegal history → `restore_failed`, no overwrite |
| `WS/test/forfeit.test.ts` | disconnect of white → black wins via `getGameResult` |
| `WS/test/internal-auth.test.ts` | `/internal/tournament-event` without token → 401, with token → 200, wrong-length token → 401 without throwing |

### 12.2 API contract tests (`WEB/test/api/`, `WEB/test/authz/`)

`test/api/contract.test.ts` imports `HTTP_ENDPOINTS` from the registry and each route module's handler, and runs the matrix with the injected auth seam (API §2.14):

| Check | Applies to |
|---|---|
| signed out → 401 | every `user`/`member`/`admin` endpoint |
| non-member → 402 with `details.reason` | `member` endpoints. No P1 user-facing route is `member`, so the test registers a throwaway `test.member` endpoint inside the test file and checks all four reasons |
| non-admin → 403 | admin endpoints |
| malformed JSON → 400 `invalid_json`; oversize → 413 | every endpoint with a body |
| 429 has `Retry-After` and `retryAfterSec` equal | every endpoint with `rateLimit` |
| response parses with `spec.response` | every endpoint with a response schema (`ROUTE_VALIDATE_RESPONSES=1`) |
| every error body parses with `ErrorEnvelope` | all |

Plus:

- **Authz walker** (`test/authz/walker.test.ts`, CT P1): globs **every** `app/api/**/route.ts`. A file without a `route()` export must have a row in `test/authz/legacy-routes.ts` (`{ path, method, anonymous: 401 | 404 | 200, signedInNonAdmin? }`), and the walker calls each legacy handler signed out and asserts that status. A new unwrapped route therefore cannot land silently.
- **Cache-tier lint** (`test/api/cache-tiers.test.ts`, CA §5): §7.2.1 invariants over the whole registry.
- **OpenAPI diff:** `ci.yml` runs `pnpm --filter @repo/contracts openapi` and `git diff --exit-code docs/api/openapi.json`.
- **Query budget** (`test/integration/query-budget.int.test.ts` with `test/helpers/query-counter.ts`): the `(app)` layout viewer read = 1 statement; `GET /api/me` = 1; CDN-miss `GET /api/openings` with a warm data cache = 0; `POST /api/billing/refresh` ≤ 4; the webhook happy path ≤ 4.
- **GET purity:** every GET endpoint is called once in the contract run; any write without a declared side effect fails.

Legacy handlers changed by H (they are not `route()` yet) are also covered end to end by the Playwright security spec.

### 12.3 End-to-end (Playwright)

All specs run with **`BILLING_PAYWALL=on`** (CT X3); a spec that needs it off says so with `test.use({ paywall: "off" })` in a separate project. Locally and in CI they run against `next start` on Docker Postgres with the socket server from source; against the dev site they run through `E2E_BASE_URL` (`webServer` disabled, Vercel bypass headers added when `VERCEL_AUTOMATION_BYPASS_SECRET` is present, `@local-only` skipped).

| Spec | Config / projects | Steps and assertions |
|---|---|---|
| `e2e/specs/security.spec.ts` (1B·H; `@p1 @smoke`, `@public` where signed out) | main config; members A, B; non-member R | (1) signed out `POST /api/legends/create`, `PUT/DELETE /api/legends/<ref>`, `POST /api/chess-positions/create`, `PUT/DELETE /api/chess-positions/<id>`, `GET /api/chess-positions` → 401; (2) as A → 403 each; (3) as A, `POST /api/chess/game-over` for a game between B and C (created via the friend flow fixture) → 403, and `GET game-by-ref` as B shows status still `IN_PROGRESS`; (4) `GET /api/user/email/<A's email>` → 404, `GET /api/user/<A ref>` → 404; (5) A opens `game-by-ref` of the B–C game → no `moveHistory`, no `traceContext`; B (participant) → full body; (6) `/api/healthcheck` 200, `/api/health` 200 with `data.ok`; (7) `/wp-login.php` → 404 with no `x-clerk-*` header; (8) a cookie-authenticated `POST /api/billing/refresh` with `Origin: https://evil.example` → 403 |
| `e2e/specs/data-layer.spec.ts` (1B·F8; `@p1 @smoke`) | main config | (1) hard-load member `/play`: count requests by URL; `/api/user/sync`, `/api/subscription`, `/api/user/email/*` = 0; `/api/me` ≤ 1 (= 0 after 1B·J, asserted by `EXPECT_SEEDED_ME=1` once J merges); (2) hard-load `/game/<ref>` (bot game fixture) → `/api/me` = 1; (3) `/dev/ui/data` → "Load Openings (Force 429)" → `role=timer` text matches `/0:[23]\d/`, button `aria-disabled=true`; `page.clock` fast-forward 30 s → enabled; click → openings count > 3000; (4) "Check Database" × 7 → the 7th shows the inline countdown with the server's `Retry-After`; (5) "Simulate 401" → dialog named "You’ve Been Signed Out", Esc does not close it, focus on "Sign In Again", click → URL `/sign-in?redirect_url=%2Fdev%2Fui%2Fdata`; (6) "Force 500" → toast `toast-error` contains `Event ` + 8 hex chars equal to the response `x-request-id` prefix; (7) `/too-many-requests?retry=5&from=/play` → status text, button disabled, after 5 s "Try Again" → `/play`; (8) `from=https://evil.example` → Try Again goes to `/`; (9) persona S (`payment_banner`) → `shell-payment-banner` visible on `/play` (`@state:V3PaymentFailed.banner`); (10) persona `lapsed` with `MIDDLEWARE_MEMBER_GATE=on` → `/play` redirects to `/pricing?reason=ended&redirect_url=%2Fplay` |
| `e2e/specs/session.spec.ts` (1B·F8; `@p1`) | main config, member A in an isolated context | revoke A's session through the Clerk Backend API (`clerkClient.sessions.revokeSession`) in the test, then focus the page → modal; sign in again via `@clerk/testing` → back on the same URL; a second tab receives the broadcast |
| `e2e/specs/shared-device.spec.ts` (1B·F8; `@p1`, CA §5) | main config, one browser context for two users | A loads `/api/me` and `/play`, signs out from the account menu (asserts `POST /api/session/clear` → 204 with `Clear-Site-Data`); B signs in in the same context; `/api/me` returns B's ref from the network (`response.fromServiceWorker() === false`, server log shows the request); Back never shows A's page. Later phases add their per-user URLs (review, PGN, invoice) to this spec |
| `e2e/specs/webhooks.spec.ts` (1B·F4b; `@p1`) | main config, no browser | POST a signed Dodo test payload (signed with `DODO_PAYMENTS_WEBHOOK_KEY` using `standardwebhooks`) twice → first `duplicate:false`, second `duplicate:true`, one `webhook_events` row; then an older event for the same subscription → `status = 'stale'`, user row unchanged; bad signature → 401; same for Clerk with a Svix-signed payload |
| `e2e/specs/telemetry.spec.ts` (1Q·2; `@p1 @smoke @local-only`) | main config with the sinks | ⌘K → `telemetry.expect("shell_palette_opened")`; type "morphy" with `telemetry.forbid("morphy")`; nav click → `shell_nav_click{dest:"legends"}`; `/dev/ui/data` Force 429 → `rate_limited_shown{surface:"inline"}`; Simulate 401 → `session_expired_shown{source:"api_401"}`; Force 500 → `api_error_toast{status:500}`; the Dodo webhook replay → server `webhook_processed{outcome:"duplicate"}` exactly once in the sink |
| `e2e/specs/flags-off.spec.ts` (1Q·2; `@p1`) | `flags-off` project (its own server on :3100 with `FLAGS_OVERRIDE=shell-v3:off`) | `/play` shows no `[data-rc-nav]` and has the marketing Navbar; the previous phases' `@smoke` specs (P0 and the game specs) pass in this project |
| `e2e/specs/prod-guard.spec.ts` (1Q·1; `@p1`) | production-mode build on :3200 (`NEXT_PUBLIC_APP_ENV=production`, `ALLOW_TEST_HOOKS=1`) | iterates `lib/test-hooks/registry.ts`: every route 404, every header ignored (same status and body as without it), env hooks inert; replaces the curl list in SPEC §12.3 step 4 |
| `e2e/devices/ui/system.spec.ts` (1B·F8) | `playwright.devices.config.ts` UI projects (`ui-desktop`, `ui-iphone`, `ui-android`, `ui-ipad`) | `/too-many-requests` and the session modal fit the viewport at zoom 100 % and on `iphone-safari@150` (`expectTapTargets(all44)`, no horizontal scroll); on phones the modal renders as a bottom sheet; axe light and dark (`a11y system light\|dark`) |
| `e2e/devices/ui/states.spec.ts` (1A·P7) | UI projects | `/dev/ui/shell?user=payment_last_day` → no dismiss button, copy contains "Access ends"; `?user=payment_expired` → "Renew Membership" linking `/pricing?reason=ended`; `?user=payment` dismiss → toast with Undo → Undo restores; `/dev/ui/skeletons?variant=game` passes `expectOneViewport`; each variant has `aria-busy="true"` |
| SPEC suites | SPEC §12.3 | unchanged, including the 40-project layout matrix and `e2e/specs/shell.spec.ts`; 1Q·2 adds the `@p1` and state tags |

**State tags (CT X8).** V3Nav, V3CommandPalette, V3Shortcuts, V3Toasts, V3iPhoneToasts, V3iPadPToasts, V3PaymentFailed, V3Skeletons, V3EmptyStates, V3RateLimited and V3SessionExpired: persona-S `banner` and the real 401/429 paths are `@state`; the rest are `@demo` with a reason in `REPO/docs/qa/design-states.overrides.json`. `REPO/scripts/qa/state-coverage.ts` (nightly and on PRs that touch specs) compares the tags with `REPO/docs/qa/design-states.json` (generated once by `REPO/scripts/qa/extract-design-states.ts` from `DR/*.dc.html`; regenerated when the design changes, since `DR/` is not in the repo), filtered to `phase ≤ REPO/docs/qa/phase.txt`; a missing state fails CI.

### 12.4 Devices, zoom and visual (CT X9, X10)

- **One matrix:** SPEC D7 (8 base devices × 80/100/110/125/150 % = 40 projects + 4 UI + 2 motion); architecture §5.5 points here.
- **Tiers:** PRs run `desktop-1440@100`, `desktop-1280@125`, `iphone@100`, `ipad-portrait@100` for changed areas; nightly runs all 40 against `next start` on the runner.
- **Real-route layer** (`e2e/devices/layout/routes.real.ts`, 1Q·2): `/play`, `/tournaments`, `/legends`, `/openings`, `/profile/<A>` signed in as a shared member on `desktop-1440@100/150`, `iphone@100/125`, `ipad-portrait@100`; asserts `expectedShellMode`, no horizontal scroll and the CTA bars above the tab bar (automates T1).
- **Stress data:** `/dev/ui/shell` and `/dev/ui/stage` accept `stress=1` (20-character usernames, long legend and opening names, max list lengths); the one-viewport assertion runs on it at `@150` on all devices.
- **Visual baselines** (1Q·2): `toHaveScreenshot` in the official `mcr.microsoft.com/playwright:v<same version as @playwright/test>-noble` image; `snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{testFilePath}/{arg}{ext}"`; `page.clock.install({ time: FIXED_NOW })`, `reducedMotion: "reduce"`; mask `[data-vr-mask]` (avatars, relative dates); `maxDiffPixelRatio: 0.002`; baselines for `/dev/ui/sections/{foundations,controls,overlays,shell,layout}` and `/dev/ui/shell` × the 4 UI projects × light and dark (48 images); an `update-snapshots` PR label workflow regenerates baselines in CI. Design parity with the `.dc.html` boards stays a manual side-by-side in the sign-off (the boards need the Claude Design runtime, which CI does not have).
- Manual zoom checks in ego-browser stay: emulated zoom does not reproduce font hinting or every media query.

### 12.5 Chess-correctness fixtures

- `prisma/fixtures/design-legend-positions.ts` (1A·P6): FENs validated with `chess.js`; the Opera Game PGN replays to its FEN. Reused by `WS/test/restore.test.ts`.
- New `WS/test/fixtures/histories.ts`: a 40-ply legal history (Kasparov–Topalov 1999 prefix from the same fixture file) and an illegal one (a knight move from an empty square at ply 7) for restore; a draw-offer sequence; a checkmate-in-one position (`6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1`, `Ra8#`) for the final-move persistence test (H6 #7).
- The shared graded corpus (`packages/chess-fixtures`) is P2/P3 (CT X13).

### 12.6 Regression of earlier phases (CT X11)

- The regression gate is the **entire** main suite plus the entire devices suite on the final `dev` SHA, with the paywall on: `ci.yml` smoke, the nightly full run, and the post-deploy dev-URL smoke. The lists below are targeted extras.
- Phase 0: `e2e/specs/{membership,paid-only,pricing}.spec.ts` green with `BILLING_PAYWALL=on`; Dodo test checkout with the test card on the dev site (T17): trial starts, `/pricing` activation completes through `POST /api/billing/refresh`, the webhook row exists once, the Clerk claim `md.entitled` becomes `true` within one webhook.
- Game flows touched by H2/H4/H6: `play-with-bot`, `play-with-friend`, `quick-match` (in the `play-queue` project), `tournament` specs green with the paywall on, against the local socket built from the worktree, then against the dev socket after its deploy; and again in the `flags-off` project.
- `lib/billing/*.test.ts` green (the existing tests plus the §8.11 cases).

### 12.7 Manual ego-browser checklist (dev site)

SPEC §12.5 M1–M11 locally and §12.6 on the dev site, plus:

| # | Check | Viewports |
|---|---|---|
| B1 | Owner tests T8–T26 (§1) | 1440×900 |
| B2 | Network tab on member `/play`, `/legends/<ref>`, `/profile/<own>`: no `/api/me`, `/api/user/sync`, `/api/subscription` on hard load; on `/game/<ref>` one `/api/me` | 1440×900, 393×852 |
| B3 | DevTools → Application → Cache Storage after browsing `/play`, `/api/me`: no `apis`/`pages` runtime caches (prod build) | 1440×900 |
| B4 | Sign out from the shell account menu: lands on `/` without the session dialog; localStorage `chess-user-store` has no `subscription`; Cache Storage holds only precache; `session/clear` returned 204 | 1440×900, 393×852 (sheet) |
| B5 | Session dialog at 393×852 and 834×1194 renders as a sheet, at 1440×900 as a dialog; Tab cycles inside; Esc does nothing | 393×852, 834×1194, 1440×900 |
| B6 | `/too-many-requests` at 150 % zoom on 1280×800 and on 393×659 | as listed |
| B7 | Admin user: `/admin/legends` create/edit/delete still works (H1 did not lock out admins) | 1440×900 |
| B8 | Friend game A vs B to checkmate; final position and result stored (`/analysis/<ref>` shows the last move) | 1440×900 + 393×852 |
| B9 | Clerk dashboard: user A's `publicMetadata` shows `{ v: 1, entitled: true, … }` after the backfill; a decoded session JWT (jwt.io in a private tab, dev only) shows `md` | — |
| B10 | PostHog live view shows `shell_*` and `rate_limited_shown` with `app_env=dev`, and none from local or CI | — |
| B11 | The Sentry event behind T16's Event id has no email and no request body | — |
| B12 | From the laptop: `E2E_BASE_URL=<dev URL> pnpm --filter web exec playwright test --grep @smoke` passes (proves the bypass header and the dev-URL mode) | — |

Close every tab opened during the checks (`task.finish({ keep: [] })`).

### 12.8 Performance checks

- k6 `me.ts` p95 < 150 ms and 304 rate > 95 % on the conditional stage (§9.7), result file committed under `REPO/perf/results/`.
- `EXPLAIN (ANALYZE, BUFFERS)` of the viewer statement (index scans on `users_googleId_key` and `chess_com_profiles_userId_key`), the limiter upsert and the CAS update on the dev database; each < 2 ms execution.
- Query-budget harness green (§12.2).
- Bundle report: shared First Load JS delta ≤ +25 kB gzip vs `0848b76`, no `ZodError` in client chunks (§9.5), blocking.
- Sentry over the test window: `/api/me` p95 server time ≤ 80 ms; no 5xx from `(app)/layout.tsx`, webhooks or `/api/me`.

### 12.9 Shared tools P1 builds (used by every later phase; CT §4)

| Tool | Package | Where |
|---|---|---|
| Unit globs, `check-test-globs.mjs`, `WEB/test/` layout | 1Q·1 (script lines via 1A·P0) | `WEB/package.json`, `REPO/scripts/qa/` |
| `ci.yml` `integration`, `e2e-smoke`, gitleaks, bundle and OWNERS jobs; `nightly.yml`; `post-deploy-dev.yml`; `E2E_BASE_URL` + Vercel bypass | 1B·F7 (ci.yml), 1Q·1 (the rest) | `REPO/.github/workflows/`, `WEB/playwright.config.ts` |
| Paywall on, fixture-product rule, `health.ts` | 1Q·1 | `WEB/e2e/global-setup.ts`, `lib/billing/products.ts` |
| User registry, persona pool and lease, sweeper | 1Q·1 (each phase adds personas) | `WEB/e2e/fixtures/{users,lease}.ts`, `WEB/e2e/personas/`, `WEB/scripts/dev/personas.ts`, `WEB/e2e/scripts/sweep-throwaway-users.ts` |
| `x-rc-now` and `ctx.now` | 1B·F1 (server), 1Q·1 (fixture) | `WEB/lib/api/route.ts`, `WEB/e2e/fixtures/time.ts` |
| Event registry, client and server sinks, PII guard, `error-window.ts` | 1Q·1 (consent-aware in P11) | `REPO/packages/analytics/src/events/`, `WEB/e2e/mocks/posthog-sink.ts`, `WEB/e2e/fixtures/telemetry.ts`, `REPO/scripts/qa/error-window.ts` |
| Console guard + legacy baseline | 1Q·1 | `WEB/e2e/fixtures/console-guard.ts`, `WEB/e2e/console-baseline.json` |
| `design-states.json`, overrides, `state-coverage.ts` | 1Q·1 | `REPO/docs/qa/`, `REPO/scripts/qa/` |
| Visual tooling and the `update-snapshots` label workflow | 1Q·2 | `WEB/playwright.devices.config.ts`, `WEB/e2e/__screenshots__/`, `REPO/.github/workflows/update-snapshots.yml` |
| `flags-off` and `play-queue` projects, `@p<N>` tags | 1Q·1 / 1Q·2 | `WEB/playwright.config.ts` |
| Test-hook registry and `prod-guard.spec.ts` | 1Q·1 | `WEB/lib/test-hooks/registry.ts`, `WEB/e2e/specs/prod-guard.spec.ts` |
| `quarantine.json` and the flake policy | 1Q·1 | `WEB/e2e/quarantine.json` |
| k6 result files and `compare.ts` | 1Q·1 | `REPO/perf/results/`, `REPO/perf/compare.ts` |
| Sign-off record template + P1's record | 1Q·1 | `REPO/docs/qa/phase-NN-signoff.md`, `REPO/docs/qa/phase-01-signoff.md` |
| Query-budget harness, authz walker, cache-tier lint, OpenAPI | 1B·F1 / F2 | `WEB/test/`, `REPO/packages/contracts/scripts/openapi.ts`, `REPO/docs/api/openapi.json` |

**Sign-off record** (`REPO/docs/qa/phase-01-signoff.md`, committed; CT X15): the SHA, the Vercel deployment id and the OCI image tag; each owner-test row with pass/fail and the screenshot path (`docs/qa/phase-01/`); the real devices (model and OS), browsers and zoom levels; the state-coverage table; the `error-window.ts` output for ≥ 24 h after the last dev deploy; the PostHog live-view result; the k6 result file links; defects found with their regression tests. The test window runs from the last dev deploy to sign-off, at least 24 h.

---

## 13. Work breakdown

### 13.1 Timeline (working days; three streams)

```
Day 0   Owner (≈ 2 h): Q-13 domain renewal + lock · Q-02 Clerk key rotation · Q-15 Neon project replay-chess-dev + H10 dump/restore
        with Claude · Q-06 Clerk session template + dev webhook · Q-19 read-only role on the live DB + age key pair
Day 1   1B·H8+H12 first (next.config.js, before P0) · H1–H4, H7, H9 · H5 (after the rotation) · H10 repoint + verify
        1B·F2 contracts package.json · 1Q·1 @repo/analytics package.json          1A·P0 (deps incl. the §13.2 list, after H8/H12 merge)
Day 2   1B·H6 socket · H11 backup-live.yml   1B·F5 M1 + limiter + cron tasks      1Q·1 globs, users registry, hook registry    1A·P0 → gate A
Day 3   1B·H6 deploy dev → H cherry-picks to main (+ workflow-only commits)       1B·F1 wrapper      1Q·1 fixtures, sinks
        1A·P4a → dev server → gate B → 1A·P1 P2 P3 P4b P5 P6 start
Day 4   1B·F3 client · F4a viewer, /api/me, billing refresh · F6 flags            1Q·1 analytics package, PII and console guards    1A parallel
Day 5   1B·F4b webhooks, claims, CAS · F4c middleware · F8 401/429 UI             1Q·1 nightly, post-deploy, ops-weekly, state manifest   1A parallel
Day 6   1B·F4d legacy bridge · F7 CI · F9 role (owner OK)                         1Q·1 prod-guard, persona pool, quarantine, sign-off template → hand-back   1A → hand-backs
Day 7   1B and 1Q rebase on dev; integration of 1B                                1A·INT (SPEC §12.1–12.4)
Day 8   1B·J join PR                                                              1A·P7 state completion, 1A·DOC
Day 9   1Q·2 visual baselines, routes.real, flags-off project, telemetry.spec, state tags on the 1A specs
Day 10  Full regression (§12.6) incl. one nightly run on the dev SHA · dev deploy · telemetry checks · claims backfill · MIDDLEWARE_MEMBER_GATE=on
Day 11  Owner test (§1) and real iPhone/Android pass · fixes · Q-16 Vercel Authentication on (after T17 and webhooks.spec re-run with the bypass)
Day 12  Sign-off record, Definition of Done
Day 13–14  Buffer (20 %, §13.3)
```

Critical path: 1A·P0 → P4a → parallel 1A packages → 1A·INT → 1B·J → 1Q·2 → regression. 1B's H lane and H10/H11 are independent and ship first. 1B uses two agents in its worktree (H/F5 and F1/F3/F4) with the file ownership of §13.5; 1Q uses one.

### 13.2 Cross-track agreements (requests the 1A packages accept)

| To | Request | Why |
|---|---|---|
| 1A·P0 | In the dependency step, also run `pnpm --filter web add --save-exact @tanstack/react-query@<v5 latest> posthog-node@<latest> standardwebhooks@<latest>`, `pnpm --filter web add -D --save-exact @tanstack/react-query-devtools@<same minor>`, `pnpm --filter web-socket add -D --save-exact socket.io-client@4.8.1 tsx@4.20.6`, and add `"@repo/contracts": "workspace:*"` and `"@repo/analytics": "workspace:*"` to `apps/web` dependencies (1B·F2 and 1Q·1 create both `package.json` files on day 1, before P0's install) | one lockfile writer (P1-03) |
| 1A·P0 | `package.json` scripts: the `test:unit` glob of §12.0 instead of SPEC §5.2's, plus `"test:int"` | CT X1; one edit of a P0 file |
| 1A·P0 | In `next.config.js`: `transpilePackages: ["@repo/contracts", "@repo/analytics"]`; the H8 `withPWAInit` block and the H12 `images` block (§9.3) if they have not merged when P0 starts | P0 owns `next.config.js` |
| 1A·P3 | Keep `useAccountActions.ts`'s Sign Out in one function (`runSignOut`) so 1B·J can replace its body with `signOutEverywhere()` | one-line join |
| 1A·P4b | `lib/shell/get-shell-session.ts` keeps `toShellSession(record, …)` pure and the Prisma read in one place, so 1B·J can swap the read for `getViewerRecord()` | single DB statement per render |
| 1A·P6 | Export the guard functions from `prisma/seed-guards.ts` (already pure, SPEC §11.2); the dev host allow-list regex names the **new** dev project's endpoint host from the H10 hand-back, not `ep-fancy-dust-b8b3dp81` | reused by `scripts/dev/personas.ts`; H10 moves the dev database |
| 1A·P5 | None during the parallel phase; 1Q·2 adds `e2e/devices/layout/routes.real.ts` (new file) and the visual settings in `playwright.devices.config.ts` after 1A·INT | file ownership |

### 13.3 Work packages

Strict file ownership: a file appears under exactly one package. The files SPEC §3.1 assigns to "nobody" (`middleware.ts`, `app/components/UserSync.tsx`, `prisma/schema.prisma`, `REPO/turbo.json`) belong to track 1B (ALLOC §3 P1 "Track coordination"); `tailwind.config.ts` stays untouched by everyone. Where two packages touch the same file, §13.5 states the order (the second package starts only after the first has merged). Estimates are effort in dev-days for one developer working with Claude, including tests.

#### Track 1A (SPEC.md; files per SPEC §14)

| WP | Files (SPEC §14) | Acceptance | Estimate |
|---|---|---|---|
| 1A·P0 Foundation | SPEC §5.1 list, plus the §13.2 requests | SPEC §5.3; gate A and gate B (SPEC §4.1) | 1.5 |
| 1A·P4a Route moves | SPEC §9.1 | `check-types` green after `next typegen` | 0.25 |
| 1A·P1 UI kit controls | SPEC §6.1 | SPEC §6.3 | 1.5 |
| 1A·P2 Overlays + toasts | SPEC §7.1 | SPEC §7.3 | 1.25 |
| 1A·P3 App shell | SPEC §8.1 | SPEC §8.3 | 2.0 |
| 1A·P4b Route chrome | SPEC §9.2 | SPEC §9.4 | 1.0 |
| 1A·P5 Layout + device suite | SPEC §10.1 | SPEC §10.7 | 1.5 |
| 1A·P6 Dev-DB seed | SPEC §11.1 (with the new host regex) | SPEC §11.3–11.4 (dry run, apply, idempotent rerun) on the new dev project | 0.5 |
| 1A·INT Integration | — (fixes go to owning packages) | SPEC §12.1–12.4 green | 1.0 |
| **1A·P7 State completion** (after 1A·INT; takes ownership of the listed 1A files) | edit `components/shell/ShellBanners.tsx` (states `last_day`, `dismissed` toast + Undo via `notify.undo`, `expired` + Renew → `/pricing?reason=ended`), `app/dev/ui/shell/demo-users.ts` (users `payment_last_day`, `payment_expired`), `lib/shell/types.ts` (additive optional `paymentIssueState?: "banner" \| "last_day" \| "expired"`), `lib/shell/shell-user.ts` + `shell-user.test.ts` (compute it, §8.2), `e2e/devices/layout/routes.ts` (add `/dev/ui/skeletons?variant=game`, `/dev/ui/shell?user=payment_last_day`); create `components/layout/RouteSkeletons.tsx`, `app/dev/ui/skeletons/page.tsx`, `e2e/devices/ui/states.spec.ts`; add `trackSystem` calls for the `payment_banner_*` events | every `V3PaymentFailed` and `V3Skeletons` state reachable; `states.spec.ts` green on the 4 UI projects; `/dev/ui/skeletons?variant=game` passes the 40-project one-viewport suite | 0.5 |
| **1A·DOC** | create `REPO/docs/route-map.md` (from IS §1.5 + ALLOC §4.2: route, boards, phase, flag, auth class); copy `SP/phase1/SPEC.md` to `REPO/docs/plan/phase-01a-spec.md`; edit `REPO/docs/implementation-plan.md` (point Phase 1 at SPEC and this file; replace §2–§3 per ALLOC once approved) | `route-classes.test.ts` reads the doc's public list and passes; no repo doc links into `/private/tmp` | 0.25 |

Track 1A effort ≈ 11.25 dev-days; elapsed ≈ 8 days because P1–P6 run in parallel.

#### Track 1B

| WP | Creates | Edits / deletes | Acceptance | Estimate |
|---|---|---|---|---|
| **1B·H** Hotfix lane H1–H9 (ships first; cherry-picked to `main` except tests that need M1) | `lib/auth/secrets.ts`, `lib/env-server.ts` + test, `e2e/specs/security.spec.ts`, `WS/test/{draw-auth,join-identity,restore,forfeit,internal-auth}.test.ts`, `WS/test/fixtures/histories.ts`, `WS/utils/internalAuth.ts`, `REPO/.gitleaks.toml`, `REPO/.gitleaks-baseline.json` | **H1** `app/api/legends/create/route.ts`, `app/api/legends/[id]/route.ts`, `app/api/chess-positions/create/route.ts`, `app/api/chess-positions/[id]/route.ts`, `app/api/chess-positions/route.ts`, `lib/auth/require-admin.ts`. **H2** `app/api/chess/{move,game-over,game-state}/route.ts`. **H3** delete `app/api/user/[referenceId]/route.ts`; edit `app/api/user/email/[email]/route.ts`. **H4** `app/api/chess/game-by-ref/[gameReferenceId]/route.ts`. **H5** (after the owner's rotation) delete `REPO/k8s/**` and `REPO/build-and-push.sh`; edit `REPO/docker-compose.yml`. **H6** `WS/GameSession.ts`, `WS/index.ts`, `WS/GameManager.ts`, `WS/utils/apiClient.ts`, `WS/spotInterruption.ts` (delete), `WS/instrument.ts`, `WS/package.json` (test script), `lib/services/tournament/notify-websocket.ts` and its 6 call sites (`app/api/tournament/{join,start,end,find-match}/route.ts`, `app/api/tournament/[tournamentReferenceId]/route.ts`, `app/api/chess/game-over/route.ts`), `app/api/chess/create-game/route.ts`, `lib/services/matchmaking/matchmaking.service.ts`, `app/api/analysis/[gameId]/route.ts`, `app/game/[gameId]/GamePageContent.tsx` (error-code mapping lines only, **after 1A·P4a**), `REPO/deploy/oci/docker-compose.yml`. **H7** `lib/logger.ts`; delete `lib/sentry/logger.ts`; the 25 files of AA F-12; `sentry.server.config.ts`, `sentry.edge.config.ts`. **H8** `next.config.js` (`withPWAInit` block only; before 1A·P0). **H9** `lib/auth/resolve-user.ts`, `lib/auth/api-key.ts`, `app/api/tournament/[tournamentReferenceId]/route.ts:130` (same file as H6 call site; one commit), `perf/k6/src/lib/config.ts` | T8–T11, T18, T21 (scanner part after F4c) pass on dev; `security.spec.ts` and the WS tests green; gitleaks green on full history with the baseline; prod socket deployed with H6 and `SOCKET_AUTH_REQUIRED=true` after the owner's OK; `main` cherry-picks contain no `prisma/` paths; owner confirms the Clerk key rotation | 3.75 |
| **1B·H10** Neon dev split | `scripts/db/split-dev-project.md` | `.env.development.local`, `.env.test` (hosts only), Vercel `replay-chess-dev` env (owner confirms), GitHub secrets that name the old host | §6.5 runbook steps 1–9 done; row counts match; `prisma migrate status` clean on the new project; dev site, local dev and `pnpm e2e` work against it; old branch untouched | 0.25 |
| **1B·H11** Live-database backup | `REPO/.github/workflows/backup-live.yml` (on `main` and `dev`), `REPO/scripts/db/restore-check.sh` | — | T24: one nightly artifact, one green `restore-check`; the dump is unreadable without the `age` identity | 0.5 |
| **1B·H12** Image optimizer allow-list | — | `next.config.js` `images` block (with H8), image call sites that switch to `unoptimized` | §9.3 H12 acceptance | 0.25 |
| **1B·F2** Contracts | `REPO/packages/contracts/**` (package.json day 1, then §7.3 files, `src/http/registry/*`, `scripts/openapi.ts`, tests), `REPO/docs/api/openapi.json` | — | `pnpm --filter @repo/contracts test` and `check-types` green; web imports `@repo/contracts/http/me`; OpenAPI regenerates without diff | 1.0 |
| **1B·F5** Rate limiter + M1 + cron | `prisma/migrations/20261103000000_m1_rate_limits_webhook_events/migration.sql`, `lib/rate-limit-db.ts` + tests, `app/api/cron/daily/route.ts`, `lib/cron/tasks/{index,rate-limit-sweep,webhook-retention,membership-reconcile}.ts` + `tasks.test.ts` | `prisma/schema.prisma` (three models, two `User` fields); delete `lib/rate-limit.ts` (**after** F1 switches `/api/openings`); `REPO/vercel.json` or `apps/web/vercel.json` (crons, whichever the project reads) | `migrate status` clean on dev after `migrate deploy`; §6.4 step 7 shows `u`/`p`; cron returns per-task counts with the bearer and 401 without | 1.25 |
| **1B·F1** Route wrapper + reference routes | `lib/api/{route,context,respond,serialize,etag,cache,request-id,prisma-errors,timing,api-error,now,paged}.ts` + tests, `lib/auth/internal.ts`, `app/api/health/route.ts`, `app/api/session/clear/route.ts`, `lib/api/README.md`, `test/api/{contract,cache-tiers}.test.ts`, `test/authz/{walker,access-matrix}.test.ts`, `test/authz/legacy-routes.ts`, `test/helpers/query-counter.ts`, `test/integration/query-budget.int.test.ts` | `app/api/healthcheck/route.ts`, `app/api/openings/route.ts`, `app/api/socket-token/route.ts`, `lib/stores/useDataStore.ts` (envelope read, drop `trackApiResponseTime`), `lib/hooks/useSocketToken.ts`, `lib/prisma.ts` (timing and write-count `$extends`, Sentry `db` spans) | `route.test.ts`, contract, authz and cache-tier tests green; A1, A2, A4, A5, A18 live on dev with `x-request-id`, `Server-Timing` (non-production); T20 (CDN HIT on openings); Play page legend/opening pickers still load | 1.75 |
| **1B·F3** Client data layer | `lib/api/{client,schema,errors,endpoints,query-client,legacy}.ts` + tests, `lib/api/keys/*.ts` + `keys.test.ts`, `lib/api/queries/{me,catalog}.ts`, `lib/query/server.ts`, `app/providers.tsx` (`QueryClientProvider`, devtools, `NavigationBridge`, `SessionWatcher` mount point), `lib/navigation/bridge.tsx`, `components/data/{QueryState,ErrorState}.tsx` | — | unit tests green; `/dev/ui/data` (wrapped in `<Providers>` locally until 1B·J) shows every `QueryState` branch | 1.25 |
| **1B·F4a** Viewer, `/api/me`, billing refresh, member guard | `lib/auth/{viewer,membership,guards,provision-user,viewer-dto}.ts` + tests (incl. `viewer.int.test.ts`), `app/api/me/route.ts`, `app/api/billing/refresh/route.ts`, `lib/auth/require-member-page.ts` (for P2+ server pages) | `lib/auth/require-subscription.ts`, `app/api/subscription/route.ts`, `app/api/user/sync/route.ts` | A3, A19 live; k6 p95 < 150 ms; first-time user provisioned once (webhook or request, no duplicate row); `GET /api/subscription` makes no Dodo call and no write (Sentry spans) | 1.25 |
| **1B·F4b** Webhooks, claims, compare-and-set | `app/api/webhook/clerk/route.ts`, `lib/webhooks/record.ts` + test, `lib/billing/dodo-events.ts`, `lib/auth/claims.ts` + test, `scripts/backfill/sync-clerk-claims.ts`, `e2e/specs/webhooks.spec.ts`, `types/clerk.d.ts`, `lib/billing/entitlement.test.ts`, `lib/billing/entitlement.int.test.ts` | `app/api/webhook/dodo-payments/route.ts`, `lib/billing/entitlement.ts` (§8.11, returns the outcome with `userId`), `lib/billing/entitlement-rules.ts` (ordering key, no `now()` as source time) | T17 incl. the stale replay; duplicates answered 200 with one row; Clerk payloads stored as NULL; claims backfill run on dev with a dry-run count first | 1.5 |
| **1B·F4c** Middleware | `lib/auth/route-classes/{index,p01}.ts` + `route-classes.test.ts` | `middleware.ts` | unit tests green; signed-out `/onboarding` → sign-in; member gate on with a non-member → `/pricing?reason=required&redirect_url=…`, lapsed → `?reason=ended`; claim missing → page loads; webhooks, health and openings skip Clerk (no `x-clerk-*` headers); scanner → 404; cross-site cookie POST → 403; `X-Robots-Tag` on dev; `EDGE_DOC_LIMIT=on` locally rewrites the 121st `/legends` request in a minute to `/too-many-requests` with status 429 | 0.75 |
| **1B·F4d** Legacy client bridge | — | `app/components/UserSync.tsx`, `lib/stores/useUserStore.ts`, `lib/hooks/useRequireAuth.ts`, `lib/hooks/useRequireSubscription.ts`, `lib/billing/client.ts`, `e2e/fixtures/auth.ts`, `e2e/fixtures/tournament-helpers.ts`; delete `app/api/user/email/[email]/route.ts` (last step) | T12 (1 `/api/me` before J); a forced 500 on `/api/me` never redirects a member; old persisted stores migrate (manual: load with a v1 snapshot in localStorage); the E2E fixtures no longer call `/api/user/sync` | 1.0 |
| **1B·F6** Flags | `lib/flags/{index,client}.ts`, `lib/flags/registry/{index,p01}.ts`, `lib/flags/flags.test.ts` | — | `getFlags` returns `shell-v3: true` on dev with `FLAGS_OVERRIDE`, defaults when PostHog is unreachable (test), never called from middleware | 0.5 |
| **1B·F8** 401 / 429 / system UI | `components/system/{RetryCountdown,useRetryCountdown,countdown,SessionExpiredModal,SessionWatcher,session-guard}.ts(x)` + `countdown.test.ts`, `lib/auth/sign-out.ts`, `lib/analytics/system-events.ts`, `app/too-many-requests/{page.tsx,TooManyRequestsClient.tsx}`, `app/dev/ui/data/{page.tsx,DataDemo.tsx}`, `e2e/specs/{data-layer,session,shared-device}.spec.ts`, `e2e/devices/ui/system.spec.ts` | — | T13–T16, T22; `data-layer.spec.ts`, `session.spec.ts`, `shared-device.spec.ts`, `system.spec.ts` green; axe clean in both themes | 1.5 |
| **1B·F7** CI | `REPO/.github/workflows/ci.yml`, `REPO/.github/workflows/main-guard.yml` (committed to `main` with the first H pick), `scripts/lint-delta.mjs` (repo copy of SPEC's `SP/phase1/scripts/lint-delta.mjs`), `.lint-baseline.json` (copy of `SP/phase1/lint-baseline.json`), `scripts/check-bundle-budgets.mjs`, `REPO/perf/k6/src/scenarios/me.ts`, `REPO/OWNERS.yml`, `REPO/scripts/qa/check-owners.mjs` | `REPO/turbo.json` (`globalEnv`), `REPO/.github/workflows/perf-tests.yml` (add the `me` scenario and the results file) | CI green on a `dev` push: every job of §13.4; bundle budget **blocking**; OWNERS report attached | 1.5 |
| **1B·F9** DB role (dev database) | `scripts/db/replay-app-role.sql`, `scripts/db/README.md` | Vercel env `DATABASE_URL` on `replay-chess-dev` (owner confirms) | after the switch, `/api/me`, a bot game and the webhook work; `SELECT current_user` from the app = `replay_app`; `DROP TABLE` as `replay_app` fails | 0.25 |
| **1B·J** Join PR (after 1A·INT and 1A·P7; owner of these 1A files for this one PR) | `config/redirects/{index,p00-legacy}.mjs`, `lib/seo/robots-rules/{index,p01}.ts` | `app/layout.tsx` (wrap children in `<Providers>`; `UserSync` inside it; `<SpeedInsights sampleRate={0.2} beforeSend=…>`), `next.config.js` (anything P0 did not take from §13.2; `redirects()` reads `config/redirects/`; the `NEXT_PUBLIC_APP_ENV` build assertion), `app/robots.ts` (reads `lib/seo/robots-rules/`), `instrumentation-client.ts` (`sendDefaultPii: false`, `tracesSampleRate: 0.1`), `eslint.config.js` (restricted `fetch("/api`, `localStorage` and `socket.io-client` imports in the new directories; `api()` schema only through `devSchema()`; `new Date()` / `Date.now()` banned in `lib/services/**` and `lib/data/**` for new code, with an allow-list), `lib/shell/get-shell-session.ts` (read through `getViewerRecord()`), `app/(app)/layout.tsx` (seed `qk.me()` + `HydrationBoundary`; `mode = member && flags["shell-v3"] ? "shell" : "marketing"`), `components/shell/useAccountActions.ts` (`runSignOut` → `signOutEverywhere()`) | T12 hard-load `/play` = 0 `/api/me`; `EXPECT_SEEDED_ME=1` data-layer spec green; SPEC §9.5 shell spec still green; turning `shell-v3` off renders marketing chrome for members; redirects and robots output byte-identical before and after the move | 1.0 |

Track 1B effort ≈ 19.25 dev-days.

#### Track 1Q (CT X1–X18)

| WP | Creates | Edits | Acceptance | Estimate |
|---|---|---|---|---|
| **1Q·1** Test and ops plumbing (no 1A file; `playwright.config.ts` only after 1A·P0 merges) | `REPO/packages/analytics/**` (package.json day 1; `src/events/{shell,system}.ts`, `src/index.ts`, tests), `REPO/scripts/qa/{check-test-globs.mjs,extract-design-states.ts,state-coverage.ts,error-window.ts}`, `REPO/docs/qa/{design-states.json,design-states.overrides.json,phase.txt,phase-NN-signoff.md,phase-01-signoff.md}`, `WEB/e2e/fixtures/{users,lease,telemetry,console-guard,time,health}.ts` + `users.test.ts`, `WEB/e2e/personas/p01.ts`, `WEB/e2e/mocks/posthog-sink.ts`, `WEB/e2e/scripts/sweep-throwaway-users.ts`, `WEB/e2e/quarantine.json`, `WEB/e2e/console-baseline.json`, `WEB/lib/test-hooks/registry.ts` + test, `WEB/e2e/specs/prod-guard.spec.ts`, `WEB/scripts/dev/personas.ts`, `REPO/.github/workflows/{nightly,post-deploy-dev,ops-weekly}.yml`, `REPO/perf/compare.ts`, `REPO/perf/results/.gitkeep` | `WEB/playwright.config.ts` (`E2E_BASE_URL`, bypass headers, `@p` grep, quarantine `grepInvert`, `play-queue` project, console guard, telemetry fixture), `WEB/e2e/global-setup.ts` (entitle, health, sweeper, run lock), `WEB/e2e/scripts/provision-test-users.ts` (pool users), `lib/billing/products.ts` (fixture product rule) + `products.test.ts`, `REPO/.github/workflows/e2e-tests.yml` (paywall on) | `check-test-globs` green; `prod-guard.spec.ts` green; one green `nightly.yml` and one green `post-deploy-dev.yml` run; `ops-weekly` opened its first issue; global setup fails clearly on an expired fixture (tested by setting one user's period end in a throwaway DB) | 2.0 |
| **1Q·2** After 1A·INT (owner of the listed 1A files for this PR) | `WEB/e2e/specs/{telemetry,flags-off}.spec.ts`, `WEB/e2e/devices/layout/routes.real.ts`, `WEB/e2e/__screenshots__/**` (baselines), `REPO/.github/workflows/update-snapshots.yml` | `WEB/playwright.devices.config.ts` (visual settings, PR tier), `WEB/playwright.config.ts` (`flags-off` project), SPEC spec files (`@p1` and state tags only), `components/shell/telemetry.ts` (`trackShell` typed against `@repo/analytics`) | `state-coverage` shows 0 missing for P1's 12 boards; visual baselines committed and stable over two runs; `routes.real.ts` green on its 5 projects | 1.0 |

Track 1Q effort ≈ 3.0 dev-days.

**Total: ≈ 33.5 dev-days of effort; with the 20 % buffer ≈ 40 dev-days planned; ≈ 12 working days elapsed + 2 buffer days**, with three streams plus parallel 1A agents. ALLOC §0 budgets 17 dev-days (1A 9 ∥ 1B 8). The difference: 1A·P7 and 1A·DOC (+0.75), the H6 socket set once tests are counted (+0.5), H9 (+0.25), legacy compatibility in F1/F4d (+1.5), the critique additions (H10–H12, billing compare-and-set, durable limiter, six tiers, registries as directories, OWNERS, CI jobs: +5.25) and track 1Q (+3.0). Owner time ≈ 5 h (day-0 actions, env vars and secrets, approvals, the owner test, real devices). Q-07 lists the cheapest trims.

### 13.4 CI workflows (1B·F7 and 1Q·1)

```yaml
# .github/workflows/ci.yml
on: { push: { branches: [dev] }, pull_request: { branches: [dev] } }
concurrency: { group: "ci-${{ github.ref }}", cancel-in-progress: true }
jobs:
  verify:
    runs-on: ubuntu-latest
    services:
      shadow: { image: "postgres:17", env: { POSTGRES_PASSWORD: shadow }, ports: ["5432:5432"],
                options: "--health-cmd pg_isready --health-interval 5s --health-retries 10" }
    steps:
      - checkout (fetch-depth 0); pnpm/action-setup; setup-node 22 (cache pnpm); pnpm install --frozen-lockfile
      - gitleaks: docker run zricethezav/gitleaks:v8 detect --source . --log-opts=--all --baseline-path .gitleaks-baseline.json
      - pnpm --filter web exec prisma generate
      - pnpm --filter web check-types && pnpm --filter @repo/contracts check-types && pnpm --filter @repo/analytics check-types
      - node scripts/qa/check-test-globs.mjs
      - pnpm --filter web test:unit && pnpm --filter @repo/contracts test && pnpm --filter @repo/analytics test && pnpm --filter web-socket test
      - node apps/web/scripts/lint-delta.mjs --all          # warnings ≤ baseline, 0 errors (SPEC D19)
      - pnpm --filter web exec prisma migrate diff --from-migrations prisma/migrations
          --to-schema-datamodel prisma/schema.prisma
          --shadow-database-url postgresql://postgres:shadow@localhost:5432/postgres --exit-code
        # drift gate (ADB §4.3 step 6). P2 replaces this step with scripts/db/check-drift.ts +
        # packages/db/prisma/protected-indexes.txt, because a raw diff fails once partial indexes exist (CC 1.7)
      - pnpm --filter @repo/contracts openapi && git diff --exit-code docs/api/openapi.json
      - pnpm --filter web build (NEXT_PUBLIC_APP_ENV=test, ALLOW_TEST_HOOKS=1, blank telemetry keys, dummy Clerk publishable key)
      - node apps/web/scripts/check-bundle-budgets.mjs      # blocking: +25 kB shared, no ZodError in client chunks
      - node scripts/qa/check-owners.mjs --report           # report-only until P4
  integration:
    needs: verify
    services: { db: { image: "postgres:17-alpine", … } }
    steps: migrate deploy → prisma/seed.ts, opening-seed.ts, seed-content.ts → TEST_DATABASE_URL=… pnpm -r test:int
  e2e-smoke:
    needs: verify
    services: { db: { image: "postgres:17-alpine", … } }
    env: { BILLING_PAYWALL: "on", NEXT_PUBLIC_APP_ENV: "test", ALLOW_TEST_HOOKS: "1", NEXT_PUBLIC_TELEMETRY_SINK: "1",
           POSTHOG_HOST: "http://127.0.0.1:4011", E2E_TEST_TOKEN: "${{ secrets.E2E_TEST_TOKEN }}", … Clerk dev keys }
    steps: migrate deploy + seeds → global setup provisioning → socket server from source (SOCKET_AUTH_REQUIRED=true)
           → playwright test --project=chromium --project=webkit-iphone --grep @smoke (quarantine excluded)
           → upload the HTML report
```

`nightly.yml` (committed to `main`, checks out `ref: dev`; `schedule: "30 21 * * *"` + `workflow_dispatch`; `concurrency: e2e-dev-shared` for its dev-URL job): `e2e-full` (main config, sharded × 4, paywall on, Docker Postgres), `devices-full` (all 40 + UI projects, sharded × 4, against `next start`), `visual`, `state-coverage`, `flags-off`, `quarantine-report`, and `dev-url` (the `@smoke` subset against the dev URL with the bypass header). Later phases append jobs (P2 resilience, P3 arm64 goldens, P4 provider canary, P6 weakness recompute).

`main-guard.yml` (committed to `main` only; `on: push` and `pull_request` to `main`): fails when a commit touches `prisma/**`, or any path outside the H-lane file list (§13.3) and `.github/workflows/{backup-live,ops-weekly,nightly,main-guard}.yml`. `ci.yml` does not run on `main`, whose tree has none of the new packages until P13.

`post-deploy-dev.yml`: `on: deployment_status`; runs when `state == "success"` and the deployment belongs to `replay-chess-dev` [V: the environment name Vercel's GitHub integration reports]; steps per §7.8; `concurrency: e2e-dev-shared`.

GitHub secrets the owner adds (names only): `E2E_TEST_TOKEN`, `VERCEL_AUTOMATION_BYPASS_SECRET` (after Q-16), `LIVE_DB_DUMP_URL`, `BACKUP_AGE_RECIPIENT`, `BACKUP_AGE_IDENTITY`, `NEON_API_KEY` (read-only), `VERCEL_TOKEN` (read scope), `SENTRY_AUTH_TOKEN` (read scope), plus the Clerk dev keys the existing `e2e-tests.yml` already uses. The old `e2e-tests.yml` keeps running on `main` with the paywall now on.

### 13.5 Ownership overlaps, their order, and `OWNERS.yml`

| File | First | Then |
|---|---|---|
| `next.config.js` | H8 + H12 (day 1, `withPWAInit` and `images` only) | 1A·P0 (its SPEC edits + `transpilePackages`) → 1B·J (leftovers, redirects import, build assertion) |
| `app/api/chess/game-over/route.ts` | H2 (auth + transition) | H6 #7 and the notify `after()` (same lane, same PR) |
| `app/api/tournament/[tournamentReferenceId]/route.ts` | H6 (notify `after()`) | H9 (timing-safe compare), same PR |
| `app/game/[gameId]/GamePageContent.tsx` | 1A·P4a (import + safe-area) | H6 #3 (error-code mapping) |
| `app/api/user/email/[email]/route.ts` | H3 (strip) | F4d (delete) |
| any of the 25 AA F-12 files that an F package also edits (`app/api/subscription/route.ts`, `app/api/user/sync/route.ts`, `app/api/openings/route.ts`, `app/api/webhook/dodo-payments/route.ts`, …) | H7 (drop `details`, logger) | the F package (F1, F4a, F4b), after H merges |
| `lib/rate-limit.ts` | F1 (stops importing it) | F5 (delete) |
| `lib/billing/entitlement.ts`, `lib/billing/entitlement-rules.ts` | F4b | — (F4a's refresh route calls F4b's function; F4a merges after F4b) |
| `apps/web/package.json` | 1A·P0 (deps + scripts, §13.2) | — (1B and 1Q never edit it) |
| `playwright.config.ts` | 1A·P0 (`reuseExistingServer`) | 1Q·1 → 1Q·2 (`flags-off` project) |
| `e2e/global-setup.ts`, `e2e/scripts/provision-test-users.ts` | 1Q·1 | — |
| `scripts/dev/personas.ts` | 1Q·1 (creates it; F4b no longer does) | — |
| `app/layout.tsx`, `instrumentation-client.ts`, `eslint.config.js`, `lib/shell/get-shell-session.ts`, `app/(app)/layout.tsx`, `components/shell/useAccountActions.ts`, `app/robots.ts` | 1A owner (SPEC) | 1B·J only, after 1A·INT |
| `components/shell/ShellBanners.tsx`, `app/dev/ui/shell/demo-users.ts`, `lib/shell/types.ts`, `lib/shell/shell-user.ts`, `e2e/devices/layout/routes.ts` | 1A·P3/P4b/P0/P5 (SPEC) | 1A·P7 after 1A·INT |
| `playwright.devices.config.ts`, SPEC spec files, `components/shell/telemetry.ts` | 1A·P5 / P3 (SPEC) | 1Q·2 after 1A·INT |

**`REPO/OWNERS.yml`** (CF §7): one entry per phase with `weeks`, `globs` it owns while active, and the shared directories where it may only **add** files (`lib/api/keys/`, `lib/flags/registry/`, `lib/auth/route-classes/`, `lib/cron/tasks/`, `packages/contracts/src/http/registry/`, `e2e/personas/`, `config/redirects/`, `lib/seo/robots-rules/`). `scripts/qa/check-owners.mjs` lists, for a PR, every touched file owned by another active phase; report-only in P1 (one stream of feature work), blocking from P4 when two streams run, where a PR that touches another phase's globs needs the label `owner-ok:<phase>`. Later registries follow the same shape when their phase creates them (`lib/realtime/handlers/<domain>.ts` in P2/P4, `WK/src/scheduler/recurring/<kind>.ts` in P3).

---

## 14. Risks, open questions and decisions for the owner

### 14.1 Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Turning `SOCKET_AUTH_REQUIRED=true` on prod disconnects clients whose bundle never fetched a token (old PWA bundles) | Prod web already sends tokens (`useSocketToken.ts`); check prod socket logs for "token missing" counts over 48 h with the flag off before flipping; flip at a low-traffic hour |
| R2 | H4 hides `gameData` from non-participants, so any legacy spectating of friend games stops showing moves | Spectate is a P2 state (v2 `visibility`); note in release notes; participants unaffected |
| R3 | The member gate bounces a fresh member during the ≤ 60 s claim lag after checkout | `session.reload()` before navigating (§8.4); gate behind `MIDDLEWARE_MEMBER_GATE` (off until verified); missing claim = pass |
| R4 | UNLOGGED `rate_limit_buckets` is emptied whenever Neon scales to zero | Only burst windows ≤ 300 s live there, which a suspend cannot shorten (§8.1); longer windows and every budget use the logged store or source rows (§6.7) |
| R5 | posthog-node local evaluation adds ~100–300 ms to the first request on a cold instance while definitions load | `getFlags` has a 300 ms cap and falls back to defaults/overrides; definitions cached at module scope |
| R6 | The Clerk webhook and the first request both provision a user | P2002 → re-read (§8.5); unique `googleId`/`email` make duplicates impossible |
| R7 | `@dodopayments/nextjs` `Webhooks()` adaptor replaced by `dodo.webhooks.unwrap`: header names or timestamp parsing could differ | `webhooks.spec.ts` signs real payloads with `standardwebhooks`; test-mode redelivery from the Dodo dashboard on dev (T17) |
| R8 | Workbox route order: if the plugin registers its default `apis` route first, `/api/*` stays cached | Acceptance check on the generated `sw.js` (§9.3); fallback `extendDefaultRuntimeCaching: false` |
| R9 | 1B and 1Q in separate worktrees drift from 1A's tree | Rebase daily on `dev`; the only shared files are listed in §13.5; neither edits 1A files before 1B·J / 1Q·2 |
| R10 | `/legends/[ref]`, `/openings/[ref]`, `/profile/[ref]` become dynamic (SPEC R4), and getViewer now also runs flags | Viewer read is one statement cached per request; flags are local; monitor TTFB in Speed Insights |
| R11 | Legacy 402 mirror, socket-token mirror and the `legacy` field of the billing refresh linger | Sentry tag `legacy_envelope`; delete in P2 (mirrors) and P10 (billing `legacy`) after 14 days with zero tagged events |
| R12 | Admin pages expect more than 50 positions from `GET /api/chess-positions` | The route already paginates (`page`); the admin UI shows page 1; v3 admin is P12 |
| R13 | Effort above ALLOC's 17 dev-days (§13.3: 33.5 + 20 % buffer) | Decision Q-07 |
| R14 | Vercel Authentication on `replay-chess-dev` (Q-16) blocks the Dodo or Clerk webhooks, the OCI socket's calls to web, or the E2E runs | Turned on only after V2 is verified and T17 plus `webhooks.spec.ts` pass through the bypass; it can be switched off in one click; the socket → web calls send `x-vercel-protection-bypass` |
| R15 | Workflow-only commits to `main` (scheduled workflows) trigger a production redeploy of the live site | They are batched with the H cherry-picks, so there is one redeploy per pick window; `deploy-oci.yml` has path filters and is not triggered |
| R16 | The first H6 deploy to prod restarts the socket with the **old** shutdown code (no drain yet), ending live games | Deploy at the lowest-traffic hour from the prod socket metrics; announce in-app the day before if any tournament is scheduled; from then on #13 drains |
| R17 | The console guard fails many legacy specs at once | Legacy specs start in `console-baseline.json` (report-only); the file may only shrink |
| R18 | `/api/openings` on the CDN serves a stale index after an admin edit | No opening writer exists before P12; P12's writers call `revalidateTag("openings")` and purge the CDN tag; `s-maxage` 24 h bounds the staleness |
| R19 | H10's restore misses objects (sequences, the `_prisma_migrations` table) or the old dev branch gets deleted too early | Runbook verification step (row counts, `migrate status`); the old branch is kept 14 days and deleted only with the owner's confirmation (CLAUDE.md rule 5) |
| R20 | The backup role on the live database is misused, or the dump leaks | Read-only role (`pg_read_all_data`), used only by the GitHub secret; dumps are `age`-encrypted before upload; artifacts expire after 14 days |
| R21 | The persona pool (24 permanent users) plus throwaway users approach the Clerk dev instance's user cap | The sweeper deletes `e2e-*` users older than 2 h and fails the run within 20 users of the cap [V3: check the cap in the Clerk dashboard] |

### 14.2 Open questions and decisions

| # | Decision | Recommendation | Blocks |
|---|---|---|---|
| Q-01 | Change CLAUDE.md rule 1 to: migration files + `prisma migrate deploy` on every Neon database (dev and prod); **no `db push` on any Neon database**; `migrate dev` only on a local Docker Postgres (CC R-20; stricter than ALLOC §1.3, which allowed `db push` on dev while iterating) | Approve; the owner edits CLAUDE.md | M1 apply on dev |
| Q-02 | Rotate the Clerk secret committed in `REPO/k8s/secrets.yaml:12` (H5) | Today, before H5 deletes the file | H5 |
| Q-03 | Pull `IdempotencyKey` into M1, or keep it in M2 with `POST /api/games` | Keep in M2 (ALLOC) | — |
| Q-04 | Flip `SOCKET_AUTH_REQUIRED=true` on prod (`WS_ENV_FILE`) after 48 h of clean dev and the R1 log check | Yes | H6 prod |
| Q-05 | Switch the dev `DATABASE_URL` to the DML-only `replay_app` role (F9) | Yes; prod in P13 | F9 |
| Q-06 | Configure the Clerk **dev** session-token template `{"md": "{{user.public_metadata}}"}` and the webhook endpoint (or let Claude do it in the Clerk dashboard via ego-browser while you watch) | Yes, day 0 | F4b, F4c |
| Q-07 | Accept ≈ 33.5 dev-days (+ 20 % buffer ≈ 40; ≈ 14 working days elapsed) instead of 17, or trim: defer 1Q·2's visual baselines (−0.5), F9 (−0.25), the k6 scenario (−0.25) and the weekly restore check (−0.25) to P2. Never trim H10, H11's nightly dump or the CAS | Accept; the plumbing is reused by 12 phases and each later phase saves ≈ 0.5 d | schedule |
| Q-08 | Vercel Firewall: is a rate-limit rule (with a redirect to `/too-many-requests`) available on Hobby's 3 custom rules? If not, keep `EDGE_DOC_LIMIT=off` and rely on CDN caching of public reads | Check in the dashboard | `/too-many-requests` page trigger |
| Q-09 | Lapsed read-only access (B26) | Decide before P3; P1 keeps the hard redirect to `/pricing?reason=ended`, so `V3PaymentFailed expired` is demo-only (CV C-21) | P3, P7, P11 |
| Q-10 | Copy deviation S6: Title Case buttons on system screens ("Sign In Again", "Try Again in 0:30", "Why This Happens", "Use a Different Account") where boards use sentence case; payment `last_day` copy drops "tomorrow" (time zone unknown until P4) | Accept (SPEC §3.11 rule) | — |
| Q-11 | SPEC §13 open items U1–U8 and S1–S5 (iOS status bar, PWA start URL, Android bar heights, old-prod content copy, `reloadOnOnline`, design deviations) | As SPEC recommends | 1A |
| Q-12 | Where the payment banner's "Update Payment" goes for `on_hold` trials whose grace end differs from `currentPeriodEnd` (IS §3.8 edge case) | Dodo portal; copy "You keep access until …" uses `currentPeriodEnd` until P10 verifies Dodo's grace semantics | — |
| Q-13 | Renew `playchess.tech` (Hostinger, auto-renew OFF, expires 2027-02-02, before the planned launch): turn on auto-renew and the registrar lock, enable 2FA on the registrar account; optionally transfer to Cloudflare Registrar | Today | launch (P13); the Clerk production instance and Email Routing depend on the domain |
| Q-14 | Upgrade the OCI tenancy to pay-as-you-go with a $1 budget alert and compartment quotas that cap A1 at 4 OCPU / 24 GB (moved from P2 Q13 / P13 D18). PAYG accounts are not subject to Always Free idle reclamation; the quotas keep the bill at $0 | Yes | dev and prod socket availability |
| Q-15 | Move dev and E2E to a new Neon Free project `replay-chess-dev` now (H10; moved from P13 A2) | Yes, day 0 (≈ 1 h of owner time with Claude) | M1 apply, every later phase's dev load |
| Q-16 | Turn on Vercel Authentication for `replay-chess-dev` with a Protection Bypass for Automation secret (CF SEC-3: open Clerk dev sign-up plus Dodo test cards make the dev site a free copy of the product) | Yes, on day 11 after V2 is verified; also consider restricted sign-up on the Clerk dev instance [V3] | — |
| Q-17 | Move the "Environments" and "Accounts" sections of the public `CLAUDE.md` (registrar account, domain expiry, IPs, dev URLs, SSH user) to a gitignored `CLAUDE.local.md` and keep only the rules in `CLAUDE.md` (CF SEC-2) | Yes; the owner makes the edit | — |
| Q-18 | Internal auth from P2: build HMAC (`x-rc-kid`, `x-rc-ts` ± 60 s, `x-rc-sig` over method, path and body hash; separate keys per caller) or keep the static `x-internal-token` | HMAC in P2 (ARCH §3.2.4, API §2.11.6, CF SEC-4, CA AP-44); keeping the token (CC R-08) is the fallback if P2 runs out of time. P1 is unaffected either way (P1-21) | P2 WP-C/D/E |
| Q-19 | Live-database backups (H11): create a read-only role (`pg_read_all_data`) on project `shy-morning-50748774`, generate an `age` key pair, keep the identity offline and in the `BACKUP_AGE_IDENTITY` secret for the restore check | Yes, day 0 | H11 |
| Q-20 | Create a free UptimeRobot account with the two monitors of §7.8 [V5: free-plan terms for a commercial site] | Yes | — |

### 14.3 Rollback

| Change | How to undo | Data impact |
|---|---|---|
| H1–H9, H12 on `main` | revert the commit on `main` (the old Vercel account's Instant Rollback reaches only the previous deployment on Hobby, so a revert commit is the reliable path) | none |
| H6 on the prod socket | re-run `deploy-oci.yml` on the previous `main` commit (revert push); `SOCKET_AUTH_REQUIRED=false` in `WS_ENV_FILE` + redeploy undoes #2 alone | none; restored games keep their stored history |
| H8 service worker | revert; the next `sw.js` replaces the old one on the users' next visit | none |
| H10 Neon split | point the dev env vars back at the old `dev` branch (kept 14 days) | changes made on the new project during the window stay there |
| M1 (dev only) | nothing to undo for legacy code (the tables and columns are unused by it); dropping them is a contract step with the owner's confirmation | none |
| Billing CAS (F4b) | revert to the unconditional write; `subscriptionSourceAt` stays and is ignored | none |
| Middleware gate | `MIDDLEWARE_MEMBER_GATE=off` (env change + redeploy) | none |
| Shell for members | `FLAGS_OVERRIDE=shell-v3:off` on dev (env change) | none |
| Legacy envelope readers | `LEGACY_402_MIRROR=on` (default) | none |
| Vercel Authentication | switch off in the project settings | none |
| 1Q CI jobs | a failing new job is moved to `continue-on-error` for at most 48 h with an issue, never deleted | none |

---

## 15. Definition of done

**Deployed (ALLOC §1.1.1)**
- [ ] All P1 PRs merged to `dev`; Vercel `replay-chess-dev` deployment READY (checked with the Vercel MCP); `NEXT_PUBLIC_APP_ENV=dev`, `ALLOW_TEST_HOOKS=1` and every §7.9 variable present (names only, never values).
- [ ] Dev and E2E on the Neon project `replay-chess-dev` (H10); the old `dev` branch untouched; CLAUDE.md's environment table updated by the owner.
- [ ] OCI dev socket redeployed by `deploy-oci.yml` with H6; `SOCKET_AUTH_REQUIRED=true` on dev; prod socket redeployed with H6 and, after Q-04, the flag on.
- [ ] Neon dev database on M1 (`prisma migrate status` clean); `rate_limit_buckets` UNLOGGED and `rate_limit_windows` logged; production untouched.
- [ ] Clerk dev: session-token template and webhook endpoint configured; claims backfill run; `MIDDLEWARE_MEMBER_GATE=on` on dev after B9 passes.
- [ ] H1–H9 and H12 cherry-picked to `main` and deployed (prod web via the existing prod pipeline, prod socket via `deploy-oci.yml`); no `prisma/` paths in the picks (`main-guard.yml` green); Clerk key rotated before H5; gitleaks green on full history.
- [ ] `backup-live.yml`, `ops-weekly.yml` and `nightly.yml` on `main`; one green nightly dump and one green restore check (T24).

**Flags (ALLOC §1.1.2)**
- [ ] `shell-v3` on for the owner and E2E users A–P on dev (`FLAGS_OVERRIDE=shell-v3:on`); off by default in production; the `flags-off` project proves the marketing chrome still works.

**CI (ALLOC §1.1.3 + CT §3 rules 9–14)**
- [ ] `ci.yml` green on `dev`: gitleaks, `check-types`, `check-test-globs`, `test:unit` (web, contracts, analytics, web-socket), lint delta, drift gate, OpenAPI diff, build, **blocking** bundle budget, OWNERS report; `integration` (Docker Postgres) and `e2e-smoke` (paywall on) jobs green.
- [ ] `nightly.yml` and `post-deploy-dev.yml` exist, and one run of each on the final `dev` SHA is green; `e2e-tests.yml` runs with `BILLING_PAYWALL=on`.
- [ ] SPEC §12.2–12.4 green (incl. the 40-project device × zoom suite and the 6 UI/motion projects); `e2e/specs/{security,data-layer,session,shared-device,webhooks,telemetry,flags-off,prod-guard}.spec.ts` and `e2e/devices/ui/{system,states}.spec.ts` green; `routes.real.ts` green; Phase 0 specs and the game specs green with the paywall on and in the `flags-off` project.
- [ ] Global setup runs the fixture health check, the sweeper and the run lock; no spec mutates a shared letter user (`users.test.ts`).
- [ ] Shared tools committed with a README each: telemetry registry and sinks with the PII guard, console guard, user registry and persona pool, `x-rc-now`, test-hook registry plus `prod-guard.spec.ts`, `design-states.json` plus `state-coverage.ts`, visual tooling, `quarantine.json` (no expired entries), perf results and `compare.ts`, sign-off template.
- [ ] `e2e/fixtures/auth.ts` and `tournament-helpers.ts` no longer call `/api/user/sync`.

**States reachable (ALLOC §1.1.4), with `state-coverage` showing 0 missing for P1's boards**
- [ ] V3Nav `play`, `learn`, `profile` (+ subs) on real routes; hidden destinations absent everywhere.
- [ ] V3CommandPalette `open`, `closed`; V3Shortcuts `open`, `closed`.
- [ ] V3Toasts, V3iPhoneToasts, V3iPadPToasts via `/dev/ui/sections/overlays`.
- [ ] V3PaymentFailed `banner`, `last_day`, `dismissed`, `expired` via `/dev/ui/shell?user=…` (and `banner` with persona S on a real route).
- [ ] V3Skeletons `game`, `review`, `profile`, `list` via `/dev/ui/skeletons`.
- [ ] V3EmptyStates via the gallery; V3RateLimited `inline`, `inline_ready` (`/dev/ui/data`, fault and real limiter), `page` (`/too-many-requests`); V3SessionExpired `modal`, `signing_in`.
- [ ] V3FlowMap → `REPO/docs/route-map.md` committed and used by `route-classes.test.ts`.
- [ ] Deferred states listed with their phase: palette `ask` (P7), session `in_game_refresh`/`in_game_ok` (P2), nav `home`/`train`/`review`/`settings` (P5/P5/P3/P10); V3PaymentFailed `expired` on real data waits on Q-09.

**No dead links (ALLOC §1.1.5)**
- [ ] SPEC §8.4/§9.5 dead-link crawls green; `/dev/ui/data` and `/too-many-requests` link only to existing routes; `reason=ended` lands on a working pricing page.

**Owner test (ALLOC §1.1.6)**
- [ ] T1–T26 (§1) pass on the dev URL with ego-browser; shell and toasts checked on a real iPhone and a real Android phone; results in `REPO/docs/qa/phase-01-signoff.md` with screenshots and device models.

**No new errors (ALLOC §1.1.7)**
- [ ] `scripts/qa/error-window.ts` over ≥ 24 h after the last dev deploy shows no new Sentry issues (web, socket) and no new Vercel 5xx, or each is triaged in the sign-off; k6 `me.ts` p95 < 150 ms with its result file committed; bundle delta ≤ +25 kB gzip.
- [ ] PostHog shows the SPEC §3.10 shell events and the §10.1 system events from the dev site with `app_env=dev`, none from local or CI; the telemetry spec asserts them through the sinks with the PII guard green.
- [ ] Every defect found in the owner test or the device pass has a `regression:` test.

**Contracts in place for P2–P12**
- [ ] `route()` (six tiers, test-hook guard, `ctx.now`, GET purity), the envelope and code ledger with reason registries, the contracts endpoint registry and `docs/api/openapi.json`, `@repo/contracts/http/*`, `@repo/analytics`, `api()` + `devSchema()`, `qk` (directory), `QueryState`, `RetryCountdown`, `SessionExpiredModal`, `getViewer()`, `requireMember()`, `requireMemberPage()`, the rate limiter (burst + durable), `getFlags()`/`useFlag()` (registry directory), `WebhookEvent` dedupe, the billing CAS, `syncClerkClaims`, cron tasks, route classes and `OWNERS.yml` documented in `lib/api/README.md` with one example each.
- [ ] No caller of `POST /api/user/sync`, `GET /api/user/email/*`, `GET /api/user/[ref]` or `lib/rate-limit.ts` remains (`rg` returns nothing outside the deprecated route file); no GET calls Dodo.

**Docs (ALLOC §1.1.8)**
- [ ] This file, `REPO/docs/plan/phase-01a-spec.md` (SPEC.md) and `REPO/docs/route-map.md` linked from `REPO/docs/implementation-plan.md`; SPEC §13 and §14 decisions and Q-01…Q-20 recorded with the owner's answers.

---

## Appendix A. Critique dispositions

Every finding in the five critiques that concerns P1, and what this revision did with it. "Accepted" means the fix is in the section named. "Partly" means the goal is met by a different mechanism, with the reason. "Rejected" and "Deferred" give a one-line reason.

### A.1 Coverage critique (`critique-coverage.md`)

| Finding | Disposition | Where |
|---|---|---|
| C-21 B26 still open; P1 §4.5 wording must match P7 D18 and P11 S4 | Accepted: `expired` CTA and every lapsed target use `/pricing?reason=ended` (the B26-default wording); the decision itself stays owner question Q-09, due before P3 | §4.5, §5.6, §7.6 step 6, §8.3, Q-09 |

### A.2 Consistency critique (`critique-consistency.md`)

| Finding | Disposition | Where |
|---|---|---|
| 1.1 "P2 replaces the token with HMAC" contradicts P2 | Accepted: P1 keeps `x-internal-token`; the P2 scheme is Q-18 (the critiques disagree with each other, so the owner decides) | P1-21, §7.2 step 3, §7.5, Q-18 |
| 1.2 `SOCKET_TOKEN_SECRET`, `INTERNAL_HMAC_SECRET` in P2 | Accepted: only `SOCKET_TOKEN_SECRET` is named for P2; services keep `INTERNAL_API_SECRET` | §11.2, §7.9 |
| 1.3 `AuditLog` → P4 (M4) | Accepted | §0.2 |
| 1.4 `User.timeZone` in M4 (P4) | Accepted | §0.2, §7.3 |
| 1.5 `prefs` are not part of `MeData`; `user.timeZone` in P4 | Accepted | §0.2, §7.3 |
| 1.6 reason registries in `codes.ts` | Accepted: `CONFLICT_REASONS`, `FORBIDDEN_REASONS`, `ALLOWED_STATUSES`, and the R-06 ledger note | §7.1 |
| 1.7 drift gate breaks once partial indexes exist | Accepted: comment and P2 hand-over in the CI step | §13.4 |
| 1.8 contracts `exports` only map `./http/*` | Accepted: note that P2 adds `./socket/*`, P3 `./internal/*` | §7.3 |
| 1.9 `MembershipState` gains `paused` in P10 | Accepted: noted as an additive P10 change | §7.3, §7.1 |
| R-06 code statuses (422, 410, 412) | Accepted: `ALLOWED_STATUSES` includes them; ledger of later codes listed | §7.1 |
| R-09 env names (`RATE_LIMIT_IP_PEPPER`, `POSTHOG_FEATURE_FLAGS_KEY`, `NEXT_PUBLIC_SITE_URL`, no `INTERNAL_HMAC_SECRET`) | Accepted | §7.9 |
| R-13 limits as `limit / windowSec` | Already compliant; restated | §8.1 |
| R-14 flag registry and names | Accepted: `lib/flags/registry/pNN.ts`; other phases' `lib/flags.ts` references map to `lib/flags/index.ts` | §7.10 |
| R-15 P8 retires `qk.catalog.openingsIndex()` and `OpeningsIndexData` | Accepted: marked temporary | §5.3, §7.3, P1-20 |
| R-20 no `db push` on any Neon branch; phases name "the Neon dev branch (CLAUDE.md)" not IDs | Accepted: §6.4 rule 1, Q-01 reworded, path shorthand "the Neon dev database" | §6.4, Q-01, shorthands |

### A.3 Feasibility critique (`critique-feasibility.md`)

| Finding | Disposition | Where |
|---|---|---|
| #1 renew the domain | Accepted as owner task Q-13 (day 0) | Q-13, §2.3 |
| #3 / SEC-5 / 10.7.1 replace `VERCEL_ENV` gates; `APP_ENV ∈ {dev,test}` + `ALLOW_TEST_HOOKS=1`; unit test for the dev-project case | Accepted (on `NEXT_PUBLIC_APP_ENV`, the variable the code already reads) | P1-13, §7.2 step 2, §11.2, `lib/env-server.test.ts` |
| 10.7.1 "unset → build fails" | Partly: a build-time assertion lands in 1B·J on `dev` only, because the live project's env on `main` is unverified and a failing prod build would be an outage; at runtime unset fails closed | §7.9 |
| #5 / SEC-4 / §6 "HMAC from P2" | Deferred to the owner (Q-18) with HMAC recommended; CC R-08 rules the opposite, and P1 does not depend on the choice | P1-21, Q-18 |
| #8 / F-VER-3 test traffic off the dev quotas | Accepted: full matrices on the runner against `next start`; dev URL gets a smoke subset | §0.2, §9.6, §13.4 |
| #13 pools must survive Neon suspends | Not applicable to P1 (no pooled socket or worker DB client until P2/P3); left to those phases | — |
| #14 / SEC-1 rotate first, then delete `k8s/`, the build arg and `build-and-push.sh`; gitleaks with a full-history baseline | Accepted | §3.2, §11.2, §13.3 H, §13.4 |
| #14 / SEC-2 `CLAUDE.md` exposes the attack surface | Accepted as owner decision Q-17 (Claude does not edit `CLAUDE.md` unasked) | §11.2, Q-17 |
| #14 / SEC-3 dev is a free copy of the product | Accepted: Vercel Authentication + automation bypass (Q-16, after V2), `X-Robots-Tag: noindex` on non-prod now | P1-17, §7.6 step 2, Q-16, R14 |
| SEC-9 same-site CSRF gap | Accepted: `Sec-Fetch-Site: same-origin` or exact `Origin` required on cookie mutations | §7.6 step 4 |
| #15 / §8 / 10.7.7 calendar and 20 % buffer | Accepted | P1-23, §13.1, §13.3, Q-07 |
| F-NEON-1 split dev into its own project in P1 | Accepted as H10 / Q-15 | §6.5, §13.3 |
| F-NEON-3 / 10.7.5 UNLOGGED holds bursts only, never budgets | Accepted | §6.1, §6.7, §8.1, R4 |
| F-NEON-5 backups on dev | Not applicable to P1 (no `BACKUP` job yet) | — |
| F-VER-1 Hobby is non-commercial | Already a P13 launch blocker (D17); nothing changes in P1 | — |
| F-VER-2 / 10.7.8 overage pauses features; move `ops-weekly.yml` to P1 | Accepted: `ops-weekly.yml` with 60 % / 50 % alerts | §7.8, §9.6 |
| F-VER-4 close the image optimizer | Accepted as H12 (P11:159 assumed P1 did it; the draft had not) | §3.2, §9.3, §13.3 |
| F-VER-5 Speed Insights quota | Accepted: `sampleRate={0.2}`, no webdriver events | §3.2, §9.6, 1B·J |
| F-VER-7 runtime logs kept 1 h | Accepted: measurements come from Sentry | §9.1, §9.7, §10.3 |
| §7 / 10.7.4 registries as directories + `OWNERS.yml` | Accepted (keys, flags, route classes, cron tasks, contracts registry, personas, redirects, robots); OWNERS report-only until P4 | P1-16, §5.3, §7.6, §7.8, §7.10, §13.5 |
| §9 / 10.7.6 rollback subsection | Accepted | §14.3 |
| 10.7.3 owner tasks Q-13…Q-17 | Accepted (plus Q-18…Q-20) | §14.2 |
| [V2], [V3], [V4], [V5], [V14] | Kept as explicit verification marks where they are relied on | §7.7, §7.8, §9.7, R21 |

### A.4 Testing critique (`critique-testing.md`)

| Finding | Disposition | Where |
|---|---|---|
| X1 one runner, one layout, globs, orphan guard | Accepted (int tests self-skip instead of an extglob, which `node --test` patterns may not support) | §12.0, §13.2 |
| X2 CI e2e on `dev`, `nightly.yml`, `post-deploy-dev.yml`, `E2E_BASE_URL` + bypass | Accepted; scheduled workflows also committed to `main` because GitHub runs schedules from the default branch only | §7.8, §13.4 |
| X3 paywall on; entitle in global setup; fixture product rule; fixture health | Accepted (the rule lives in `lib/billing/products.ts`; there is no `catalog.ts`) | §3.2, §12.0, §12.3 |
| X4 user registry, leased personas, sweeper, lint test, matchmaking isolation | Partly: the critique's dev-only `e2e_leases` table would be schema drift on a migrated database, so leases are deterministic pool slots plus a run-level advisory lock; token-based queue isolation moves to P2 (socket tokens v2), P1 uses a `play-queue` project with one worker | §12.0, §2.2 |
| X5 `x-rc-now` and `ctx.now`; services take `now` | Accepted; the `new Date()` lint ban applies to new code through the lint-delta baseline | §7.2, §12.0, 1B·J |
| X6 event registry, sinks, PII guard, error window | Accepted; the registry stays out of client bundles (types only) | §10.1, §10.2 |
| X7 console guard | Partly: enforced for new specs; legacy specs start in a shrink-only baseline, or the first run would fail wholesale | §12.0, R17 |
| X8 design-state manifest and coverage | Accepted | §12.3 |
| X9 one tiered matrix, real-route layer, stress data | Accepted | §12.4 |
| X10 visual regression tooling | Accepted (1Q·2) | §12.4 |
| X11 whole-suite regression, `flags-off` project, `@p` tags | Accepted | §12.0, §12.3, §12.6 |
| X12 test-hook registry and production proof | Accepted; `BILLING_PAYWALL=off` is registered as a production kill switch, not a hook; in production a misconfigured env hook is ignored and reported rather than refusing to boot (a refused boot is an outage) | §11.6 |
| X14 regression test per defect, quarantine, flake policy | Accepted | §12.0 |
| X15 sign-off record, test window ≥ 24 h, tab hygiene | Accepted | §12.9, §15 |
| X16 CI on Docker Postgres; split Neon | Accepted; the split happens in P1 (H10), earlier than the critique's P2 | §13.4, H10 |
| X17 fixtures call `/api/user/sync` | Accepted (F4d rewrites `auth.ts` and `tournament-helpers.ts`) | §3.2, §13.3 |
| X18 perf results as data, `compare.ts`, `abortOnFail` | Accepted | §9.7 |
| P1 unit additions (analytics, now, hooks, catalog, users) | Accepted | §12.1 |
| P1 contract additions (authz walker, OpenAPI, query budget) | Accepted | §12.2 |
| P1 e2e additions (telemetry, flags-off, prod-guard, state tags) | Accepted | §12.3 |
| P1 device and visual additions | Accepted | §12.4 |
| P1 regression with the paywall on | Accepted | §12.6 |
| P1 manual B10–B12 | Accepted | §12.7 |
| P1 DoD additions | Accepted | §15 |
| Architecture §5.1 Vitest, P11/P13 wording | Accepted for P1 (node:test everywhere); the other files are edited by their own revisions | §0.2, §12.0 |

### A.5 API and performance critique (`critique-api-perf.md`)

| Finding | Disposition | Where |
|---|---|---|
| AP-01 dev shares the production project's CU-h | Accepted as H10. Correction: the live site reads the old project `shy-morning-50748774`, so the risk is to dev availability and the future production branch, not the live site | H10, §9.6 |
| DB-02 / 4.6.1 no backups for ≈ 13 weeks | Accepted as H11 (encrypted GitHub artifact instead of R2, which P1 does not have yet; restore check on the runner, so no live data enters a dev project) | §7.8, H11 |
| AP-03 `P+` routes on the CDN; registry walk test | Accepted (module-load assertion + `cache-tiers.test.ts`) | §7.2.1, §12.2 |
| AP-04 no `max-age > 0` on per-user responses; `Clear-Site-Data` at sign-out | Accepted (`POST /api/session/clear`, shared-device spec) | §7.2.1, §7.4 A18, §8.6, §12.3 |
| AP-06 / DB-07 / DB-06 billing compare-and-set has no owner | Accepted in F4b with `subscriptionSourceAt` in M1 | §6.1, §8.11 |
| AP-11 long windows on the UNLOGGED table | Accepted with a 300 s threshold (the critique's 4.6.7 says ≤ 60 s and AP-11 says > 300 s fails; 300 s is the exact bound, because a suspend needs 300 s of silence) | §8.1 |
| AP-12 zod in client bundles; blocking bundle budget | Accepted (`devSchema()`, `ZodError` check, blocking) | §7.12, §9.5 |
| AP-14 headers from RSC pages | Accepted: Sentry spans and the query harness measure the layout | §9.1, §9.7 |
| AP-19 `gamesVersion`; one round trip for the viewer | Partly: `gamesVersion` added in M1; the single round trip uses `$queryRaw` with a join instead of `relationLoadStrategy: "join"`, because enabling `relationJoins` changes the load strategy of every existing query | §5.2, §6.1 |
| AP-21 one `api()`: `x-rc-build`, no `ifNoneMatch`, dev-only parsing | Accepted | §7.12 |
| AP-22 `no-store` + ETag | Already compliant (`private-etag` = `no-cache`) | §0.2 |
| AP-28 `/api/openings` is not DB-free | Accepted: public, CDN-cached, no viewer, no bucket, no middleware | §7.4 A4, P1-20 |
| AP-31 billing refresh through GET | Accepted: `POST /api/billing/refresh`; GET is DB-only; the 6 h heal is the daily `membership-reconcile` | §7.4 A6/A19, §7.8 |
| AP-33 scanner probes cost functions | Accepted for middleware (early 404 before Clerk); the static root `not-found.tsx` stays P11's | §7.6 step 1 |
| AP-35 middleware SLO without a method | Accepted (`x-mw-start` → `api.mw_lag_ms`); per-member invocation formulas deferred to P13, when member counts make them meaningful (ops-weekly reports the raw numbers from P1) | §9.1, §7.8 |
| AP-38 counts on every page | Accepted in `paged()` | §7.2 step 9 |
| AP-40 body cap with a streaming reader | Accepted | §7.2 step 5 |
| AP-41 socket-token minting reads the DB | Deferred to P2, which rewrites socket tokens (v2 claims) | §2.2 |
| AP-44 / F-10 / SEC-05 static internal token | Deferred to the owner (Q-18); P1 closes the unauthenticated route with the token and isolates the helper | P1-21, §7.5 |
| AP-48 TanStack in the root layout | Rejected for P1: there is no `(marketing)` route group to mount it in until P11, and `UserSync` must run on every page; P11 D2 moves it | §0.2, §9.5 |
| SEC-09 turn `EDGE_DOC_LIMIT` on for `/api/openings*` | Rejected: `/api/openings` is CDN-cached and excluded from middleware, so an in-isolate limiter would neither run nor protect anything; the Firewall rule is Q-08 | §11.5 |
| F-07 refresh-by-GET remains | Accepted (AP-31) | §7.4 |
| F-17 OCI idle reclamation noticed late | Accepted: UptimeRobot monitors (Q-20) and PAYG (Q-14) | §7.8, Q-14 |
| §5 gates: cache-tier lint, GET purity, bundle, shared-device cache, Neon budget | Accepted | §7.2 step 8, §9.5, §12.2, §12.3, §7.8 |
| §5 gates: index-existence and `EXPLAIN` check, name registry lint, timer audit, socket frame size, abort test | Deferred to P2/P3/P7, the phases that create the first partial indexes, socket registry, worker timers and SSE streams | §2.2 |
