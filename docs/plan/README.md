# Replay Chess coaching rebuild: the plan

Status: **assembled plan, revision 2**, 2026-11-02. Branch `dev` @ `0848b76` (Phase 0 done). This folder is the detailed, authoritative plan for rebuilding Replay Chess (playchess.tech) from a "replay legendary positions" game into a paid AI chess-coaching app. It replaces §2 "Phases" and §3 "Order and timeline" of [`docs/implementation-plan.md`](../implementation-plan.md). §1 of that file, the paid-only model, still applies and is now done (Phase 0).

Open questions for the owner are collected, deduplicated and given a recommended answer in **[99-open-decisions.md](99-open-decisions.md)**. Start there if you only have ten minutes.

---

## 1. Purpose

The plan answers six questions for every part of the app, down to file names, line numbers, columns, indexes, endpoints, socket events, design boards and states:

1. **What we build, and in what order.** 13 phases, each a shippable slice that ends on the dev site.
2. **The APIs.** Every route handler, socket command and event, SSE stream, webhook, cron task and internal service call, with its auth class, cache tier, rate limit, error codes and payload budget.
3. **The schema.** Every table, column, enum, index and JSON shape, introduced by migration (M1 to M13), plus the growth budget against Neon's limits and the old-production data copy.
4. **How the UI talks to the APIs.** RSC first paint, one typed `api()` client with TanStack Query, Socket.io v2 for live state and per-user push, SSE for the coach, CDN files for catalogues, puzzles and the engine, and an IndexedDB outbox for offline training.
5. **How the APIs stay fast and cheap.** SLOs and how each is measured, the query and invocation budget per screen, caching tiers, payload budgets, compute offload to the OCI worker, and the free-tier guard rails (Vercel Hobby, Neon Free, OCI Always Free, R2).
6. **How each phase is proven.** Automated tests, ego-browser checks on the dev site, an owner test script on real devices, and a sign-off record before the next phase starts.

The plan was built from a deep read of today's code (five audits, 172 findings, [06-codebase-audit.md](06-codebase-audit.md)), the whole Claude Design canvas (314 authoritative v3 boards and 2,983 state values, [07-design-coverage.md](07-design-coverage.md)), the coaching research in `research_notes/` and `reports/`, and five critiques of a first draft (coverage, consistency, feasibility, testing, API and performance). Each file's appendix lists every critique finding and what was done with it.

---

## 2. How to use this plan

### 2.1 Read in this order

1. This README, then [99-open-decisions.md](99-open-decisions.md) §A (the owner actions needed before Phase 1 starts).
2. [01-architecture.md](01-architecture.md) §0 (the system in twelve lines and the canonical names, CR-01 to CR-37).
3. The phase you are about to build: its §0 (decisions), §1 (goal and owner test), §2.3 (dependencies) and §13 (work breakdown).
4. The cross-cutting file for the topic in hand, using the index in §3.3 below.

### 2.2 Build step by step: the per-phase loop

Phases are built one after another (two streams in parallel after P3, §5). **A phase is not finished, and the next one does not start, until all eight steps below are done.**

| Step | What happens | Where it is specified |
|---|---|---|
| 1. Entry check | The previous phase's sign-off record is committed. Every row of [99-open-decisions.md](99-open-decisions.md) whose "Needed by" is this phase has an answer (or its default stands after 3 days). The phase's dependency checklist (§2.3 of the phase file; P9 and P4 have a scripted preflight) passes on `dev`. | phase §2.3, §14 |
| 2. Build | Work packages from §13 of the phase file, with strict file ownership. Contracts (`packages/contracts`) are written first. Short-lived branches off `dev`, one PR per package into `dev`. | phase §13 |
| 3. Automated tests (CI gates) | `ci.yml` on every PR: types, lint, `node:test` unit and integration tests (Docker Postgres), contract tests from the zod schemas, the migration drift gate, the bundle budget, and the e2e smoke with the paywall on. `nightly.yml`: the whole main suite, the 40-project device × zoom matrix (8 devices × 80/100/110/125/150 %), visual regression, axe, design-state coverage, chess goldens. k6 against dev once per phase. Regression is the **whole suite**, not only the new specs. | phase §12; [01-architecture.md](01-architecture.md#5-testing-strategy) §5 |
| 4. Deploy to dev | Merge to `dev` → `prisma migrate deploy` on the Neon dev database (never `db push` or `migrate dev` on Neon), OCI dev socket (and from P3 the worker) through `deploy-oci.yml`, Vercel `replay-chess-dev`, then the post-deploy smoke against the dev URL. Clerk development instance and Dodo test mode. The phase's flags are on for the owner and E2E users A–P. | phase §15; [01-architecture.md](01-architecture.md#4-environments-and-release-process) §4 |
| 5. ego-browser checks | Claude runs the phase's manual checklist with **ego-browser** on `https://replay-chess-dev-replaychess007-1069.vercel.app`: desktop 1440×900 and 1280×800, iPad landscape 1194×834, iPad portrait 834×1194, iPhone 393×852, Android 412×915, browser zoom 80–150 %; the board never leaves the viewport (one-viewport rule). The Dodo dashboard is checked in Claude in Chrome. Every page opened is closed at the end (`task.finish({ keep: [] })`). | phase §12 "Manual checklist" |
| 6. Owner testing | The owner runs the phase's owner test script (the numbered T-rows in §1) on the dev URL, then on a real iPhone and a real Android phone. The test window is at least 24 hours after the last dev deploy. **Every defect found gets a failing automated test first** (`regression: <slug> (#issue)`), then the fix. | phase §1, §12 |
| 7. Sign-off | `docs/qa/phase-NN-signoff.md` is committed: SHA, Vercel deployment id, OCI image tags, each owner-test row with pass/fail and a screenshot, device models, the state-coverage table, the Sentry/Vercel error window (≥ 24 h, no new 5xx), the PostHog live-view check (`app_env=dev`), k6 results, and the defects with their tests. Every box of the phase's Definition of Done (§15) is ticked. | phase §15; [01-architecture.md](01-architecture.md#5-testing-strategy) §5.12 |
| 8. Next phase | Only after the owner says go. Legacy screens the phase replaced stay one release behind their flag, then are deleted. | §6 below |

Production is not touched until P13, with two exceptions: P1's security hotfix lane (H1–H9 and H12, cherry-picked to `main`) and any fix the live site's v1 socket protocol needs.

### 2.3 When documents disagree

1. The allocation's binding decisions B1–B26 ([allocation.md](allocation.md) §2), unless a row of [01-architecture.md](01-architecture.md#03-canonical-names-and-rulings-binding-for-every-plan) §0.3 records a deliberate deviation.
2. The canonical names and rulings CR-01 to CR-37 in [01-architecture.md](01-architecture.md#03-canonical-names-and-rulings-binding-for-every-plan) §0.3.
3. The phase spec that ships a thing first fixes its name and shape, and a phase spec is authoritative for its own migrations, routes and work packages.
4. The data model decides column types only where no earlier phase fixed them.

The conflicts found while assembling this folder, and the ruling for each, are in [99-open-decisions.md](99-open-decisions.md) §R.

### 2.4 Paths and names used inside the plan files

| Short | Meaning |
|---|---|
| `REPO` | `/Users/rohitpandit/open_source/chess-battle-turbo` |
| `WEB`, `WS`, `WK` | `apps/web`, `apps/web-socket`, `apps/analysis-worker` (created in P3) |
| `PKG`, `CT`, `DB`, `TRN`, `CA`, `CF`, `DOM` | `packages`, `packages/contracts/src`, `packages/db`, `packages/chess-training`, `packages/chess-analysis`, `packages/chess-fixtures`, `packages/domain` (P9) |
| `SP` | the planning session's scratchpad (archived scratch inputs: the design canvas, inventories, audits, critiques and research reports; not in the repo). **It was temporary and may no longer exist** (see [99-open-decisions.md](99-open-decisions.md) A12). |
| `DR`, `DS` | `SP/design-ref/project/v2` (the `.dc.html` boards) and `SP/design-ref/ds/project` (design-system README, tokens, component READMEs); the board index is `SP/design-ref/INDEX.md` |
| ALLOC | [allocation.md](allocation.md) (copied here from `SP/plan/allocation.md`) |
| SPEC | [phase-01a-spec.md](phase-01a-spec.md) (copied here from `SP/phase1/SPEC.md`) |
| `architecture.md`, `data-model.md`, `api-design.md`, `client-data-layer.md`, `optimization.md` | scratch names of `01`–`05` in this folder |
| `phase-NN.md` (or "P2 rev 2") | scratch name of `phase-NN-*.md` in this folder |
| inventories, audits, critiques | `SP/plan/inv-*.md`, `SP/plan/audit-*.md`, `SP/plan/critique-*.md` (not copied; summarised in 06 and 07 and in each file's appendix) |

---

## 3. Document map

### 3.1 Cross-cutting documents

| File | What it fixes | Read it when |
|---|---|---|
| [01-architecture.md](01-architecture.md) | System shape: the four runtimes (Vercel, OCI socket + worker, Neon, R2), transport channels, write ownership, background jobs and the next-due scheduler, security (HMAC between services, CSP, authorisation), privacy and deletion, telemetry, flags, environments, release and rollback, the testing strategy, the canonical names CR-01–CR-37, owner decisions D1–D24 | Before P1; whenever two plans disagree |
| [02-data-model.md](02-data-model.md) | The schema ledger by migration (M1–M13), normalisation decisions, the enum catalogue, relations and `onDelete`, writers and the per-screen DB budget, the index catalogue, the JSON column registry, storage growth against Neon's 1 GB, the migration procedure, the old-prod → new-prod copy, dev seeds | Before each phase's §6 |
| [03-api-design.md](03-api-design.md) | API conventions (route wrapper, envelope, error-code ledger, pagination, idempotency, concurrency, rate limits, auth helpers, cache tiers, logging, OpenAPI), the full endpoint catalogue per phase, keep/change/remove for all 57 existing handlers, socket protocol v2 and server authority, the coach SSE stream, webhooks and cron, API budgets | Before each phase's §7 |
| [04-client-data-layer.md](04-client-data-layer.md) | How the UI talks to the APIs: rendering strategy per route type, TanStack Query v5 and the key factory, the typed `api()` client, realtime (socket connection, rooms, handlers), client state ownership (server state vs Zustand vs URL), offline and PWA (outbox, snapshots), loading/skeleton/empty/error conventions, the per-phase migration from today's fetch patterns | Before each phase's §5 |
| [05-optimization.md](05-optimization.md) | SLOs and how each is measured, database work (indexes, HOT updates, connection use, wake sources), the caching layers, payload budgets, compute offload, cold starts and bundles, rate limiting on free tiers, observability, the prioritised optimisation backlog by phase | Before each phase's §9 |
| [06-codebase-audit.md](06-codebase-audit.md) | Today's code: 172 findings (14 critical, 59 high) with `file:line` evidence, duplicates across audits, keep/rework/remove verdicts, and the phase that fixes each finding | Before touching legacy code |
| [07-design-coverage.md](07-design-coverage.md) | Every v3 board → phase → feature (314 boards, 2,983 state values), the 24 cross-phase gaps and their owners, the 105 flow-map edges, the documented deviations from the boards | Before each phase's §4 |
| [../route-map.md](../route-map.md) | The canonical route table: route → boards → phase → flag → auth class, the Phase 1 middleware class lists that `route-classes.test.ts` reads, the class changes each later phase must make, redirects | Whenever a phase adds, moves or reclassifies a route |
| [99-open-decisions.md](99-open-decisions.md) | Every open owner question across all documents, deduplicated, with a recommended answer and the phase and date it is needed by; the destructive steps that need confirmation; facts to verify; document conflicts and their rulings | Weekly, and at every phase entry |

### 3.2 Phase documents

Every phase file has the same sections: §0 decisions, §1 goal and owner test script, §2 scope and dependencies, §3 current code touched (with line numbers at `0848b76`), §4 screens (every board and state), §5 UI ↔ API data flow, §6 data model (migration SQL), §7 API (routes, socket events, internal calls), §8 domain logic (exact rules and constants), §9 performance and optimisation, §10 telemetry, §11 security, privacy, paywall and authorisation, §12 testing (including the manual ego-browser checklist), §13 work breakdown and estimate, §14 risks, open questions and rollback, §15 definition of done, Appendix A critique dispositions.

| Phase | File |
|---|---|
| P1 | [phase-01-design-system-app-shell-and-api-foundations.md](phase-01-design-system-app-shell-and-api-foundations.md) (tracks 1B and 1Q) + [phase-01a-spec.md](phase-01a-spec.md) (track 1A: UI kit, shell, one-viewport layout) |
| P2 | [phase-02-board-and-live-game.md](phase-02-board-and-live-game.md) |
| P3 | [phase-03-server-analysis-and-game-review.md](phase-03-server-analysis-and-game-review.md) |
| P4 | [phase-04-game-import-and-onboarding-v3.md](phase-04-game-import-and-onboarding-v3.md) |
| P5 | [phase-05-mistake-bank-puzzles-train-and-home.md](phase-05-mistake-bank-puzzles-train-and-home.md) |
| P6 | [phase-06-weakness-profile.md](phase-06-weakness-profile.md) |
| P7 | [phase-07-ai-coach.md](phase-07-ai-coach.md) |
| P8 | [phase-08-learn-legends-legend-practice-openings-lessons.md](phase-08-learn-legends-legend-practice-openings-lessons.md) (split into P8a and P8b) |
| P9 | [phase-09-play-hub-matchmaking-challenges-ratings.md](phase-09-play-hub-matchmaking-challenges-ratings.md) |
| P10 | [phase-10-profile-settings-membership-notifications.md](phase-10-profile-settings-membership-notifications.md) |
| P11 | [phase-11-public-site-auth-system-screens-pwa.md](phase-11-public-site-auth-system-screens-pwa.md) |
| P12 | [phase-12-tournaments-and-admin.md](phase-12-tournaments-and-admin.md) |
| P13 | [phase-13-production-launch.md](phase-13-production-launch.md) |

Source documents copied into this folder so the repo does not depend on the scratchpad: [allocation.md](allocation.md) (binding decisions B1–B26, the original Definition of Done, the first board allocation) and [phase-01a-spec.md](phase-01a-spec.md) (Phase 1 track 1A).

### 3.3 Where to find a topic

| Topic | Cross-cutting | Per phase |
|---|---|---|
| Endpoints, request and response shapes, auth class, cache tier, rate limit | [03](03-api-design.md) §2 conventions, §4 catalogue, §5 existing endpoints | §7 |
| Socket protocol: rooms, commands, events, acks, server authority | [03](03-api-design.md) §6; [01](01-architecture.md) CR-13–CR-15; P2 §7.4 (`CT/socket/registry.ts`) | §7 |
| Coach streaming (SSE) | [03](03-api-design.md) §7; P7 §7 | — |
| Webhooks (Dodo, Clerk), cron, internal service calls | [03](03-api-design.md) §8; [01](01-architecture.md) §2, §3.2 | §7 |
| Schema, migrations, indexes, JSON shapes, storage | [02](02-data-model.md) §5–§11 | §6 |
| Old production data → new production | [02](02-data-model.md) §12; P13 §6, §8 | — |
| How a screen loads and updates (RSC, query keys, invalidation, realtime handlers, optimistic updates, offline) | [04](04-client-data-layer.md) §2–§8; [03](03-api-design.md) §3 | §5 |
| Performance budgets, SLOs, caching, cost guard rails | [05](05-optimization.md); [03](03-api-design.md) §9 | §9 |
| Background jobs, the worker, Stockfish, scheduling | [01](01-architecture.md) §1.8–§1.10, §2 | P3 §7–§8 |
| Security, privacy, deletion, consent | [01](01-architecture.md) §3 | §11 |
| Environments, CI/CD, release, rollback | [01](01-architecture.md) §4 | §15, §14 rollback |
| Testing strategy and shared test tooling | [01](01-architecture.md) §5 | §12 |
| Boards, states and flow-map edges | [07](07-design-coverage.md) | §4 |
| Today's code and its defects | [06](06-codebase-audit.md) | §3 |

---

## 4. The plan at a glance

1. **Four runtimes.** Vercel runs the Next.js app (RSC pages, route handlers, middleware, one daily cron). OCI Always Free A1 runs Caddy, the Socket.io game server and a new analysis worker with native arm64 Stockfish (dev: one 1-OCPU box; prod: the socket box plus a 2-OCPU worker VM, which fills the free pool exactly). Neon Postgres is the only system of record. Cloudflare R2 holds media, puzzle shards, the browser engine, exports and encrypted backups.
2. **Per-move and per-second traffic never touches Vercel.** The socket server owns live games and writes checkpoints and the finish straight to Neon; matchmaking runs in its memory (P9). The worker owns engine work, imports and every scheduled job, woken by signed HTTP kicks, never by polling Neon.
3. **Five client channels with fixed roles:** RSC loaders for first paint; JSON route handlers through one typed `api()` client and TanStack Query; Socket.io v2 for live games and per-user push (`user:{ref}` room); SSE for the coach; immutable CDN files for catalogues, puzzle shards and the engine. No screen polls while its socket is connected.
4. **One server contract:** one `route()` wrapper, one envelope `{ data, meta? }` / `{ error: { code, … } }`, one error-code ledger, six cache tiers (no per-user response is cacheable), Postgres fixed-window rate limits, contracts in `packages/contracts` (zod 4) with a generated OpenAPI file.
5. **The LLM never decides chess.** `claude-sonnet-5-5` answers coach questions through a tool loop whose engine tools call the worker; `claude-haiku-5-5` writes review text in the worker; a deterministic verifier checks every sentence; fair-use caps live in one file.
6. **Authorisation is decided by the database, accelerated by claims.** Middleware redirects from a Clerk session claim (zero DB reads); every API route re-checks membership and ownership; sockets authorise from a signed handshake token; every service-to-service call is HMAC-signed.
7. **Free tiers first.** Vercel Hobby until the first real charge (then Pro), Neon Free with dev in its own project (production on Launch at go-live), OCI Always Free only, R2 free egress. Every phase reports its usage before and after.

The full version, with the reasons, is [01-architecture.md](01-architecture.md#01-the-architecture-in-twelve-lines) §0.1.

---

## 5. Phases

### 5.1 Phase table

Effort is dev-days of one developer working with Claude (tests and the dev deploy included), from each phase file's §13. Every phase also carries a separate 20 % buffer line that is spent only with the owner's agreement. "Alloc" is the first budget from [allocation.md](allocation.md) §0; the phase specs grew after the critiques. Calendar is the elapsed time with parallel Claude agents inside the phase, including the ≥ 24 h owner test window.

| # | Title | Goal | User-visible outcome on dev at the end | Depends on | Effort (+ buffer) | Alloc | Calendar | Boards | Spec |
|---|---|---|---|---|---|---|---|---|---|
| 0 | Paid-only billing, trial, dev environment | **Done** (`8514fea`) | Paid-only Coaching plan with a 7-day card trial; `/try` removed; dev environment live | — | done | — | — | — | [implementation-plan.md](../implementation-plan.md) §1 |
| 1 | Design system, app shell and API foundations | One UI kit in one shell (1A); one route wrapper, error contract, typed client, rate limiter, viewer bootstrap (1B); shared test and ops plumbing (1Q). Live security holes closed first, also on `main`; live DB backed up | Existing signed-in pages run inside the v3 shell on every device and zoom; ⌘K, `?`, toasts, payment banner, session-expired dialog, rate-limit countdown; one viewer read per page instead of the sync waterfall; admin, game-over and PII holes closed | P0 | 33.5 (+6.5) | 17 | ≈ 3 wk | 12 | [P1](phase-01-design-system-app-shell-and-api-foundations.md), [1A](phase-01a-spec.md) |
| 2 | Board and live game | Rebuilt board, socket protocol v2 with restart-safe persistence (journal, checkpoints, direct Neon writes), the v3 game screen in all 55 states, bot games on the device | A full human game on any device; bot game with hint and undo; a socket deploy mid-game resumes at the same ply; spectate, rematch with colour swap, abort, draw offers, reconnect | P1 | 32.25 (+6.5) | 28 | ≈ 3 wk | 33 | [P2](phase-02-board-and-live-game.md) |
| 3 | Server analysis and Game Review | Native Stockfish on OCI grades every finished game with published formulas; guided review replaces `/analysis` | Finish a game → badges in ≈ 10 s → summary → 3 key moments → complete → optional public share; `/games` lists every game; legend compare, practice, How we grade | P2 | 30.75 (+≈6) | 28 | ≈ 5 wk | 20 | [P3](phase-03-server-analysis-and-game-review.md) |
| 4 | Game import and onboarding v3 | Chess.com and Lichess import feed the same pipeline; onboarding through the trial checkout rebuilt | Sign up → welcome → link → confirm → level → goals → trial checkout (Dodo test card) → activating → import progress → first imported review; connected accounts sync and unlink | P3 | 17.5 (+3.5) | 16 | ≈ 4 wk | 27 | [P4](phase-04-game-import-and-onboarding-v3.md) |
| 5 | Mistake Bank, puzzles, Train and Home | Mistakes become FSRS cards; themed Lichess puzzles with a rating; Train hub and Home. **First release worth charging for** | Game-over "+1 position added"; bank drill, grading, theme puzzles, session summary, streak and daily plan; members land on `/home` | P3 (P4 for volume) | 28 (+5.5) | 26 | ≈ 4 wk | 35 | [P5](phase-05-mistake-bank-puzzles-train-and-home.md) |
| 6 | Weakness Profile | Aggregated error patterns against a rating-band baseline, with drills | Insufficient (preliminary from 5 games) → computing with real ETA → profile with a verified headline → drill a weakness | P4, P5 | 9 (+1.8) | 9 | ≈ 2 wk | 8 | [P6](phase-06-weakness-profile.md) |
| 7 | AI coach | Engine-grounded, verified coach chat over SSE with fair-use caps; LLM review text replaces P3's templates | Ask about any move from Review; streaming, stop, engine-line fallback, rate limit and membership-ended states; ⌘K Ask | P3 (P5, P6 add context) | 17.5 (+3.5) | 16 | ≈ 3 wk | 11 | [P7](phase-07-ai-coach.md) |
| 8 | Learn: legends, legend practice, openings, lessons | **P8a:** public SEO catalogues from cached volumes and members-only legend practice. **P8b:** lessons, the opening deck and every lesson slot earlier phases left dark | Browse legends, positions and openings signed out; as a member play a legend position vs the bot → compare → review; lessons with guess and stars; opening drill | P8a: P2, P3. P8b: P5 | 25.5 (+5.1) + ≈ 7 owner-days of content | 24 | ≈ 3 wk + 2 wk | 47 | [P8](phase-08-learn-legends-legend-practice-openings-lessons.md) |
| 9 | Play hub, matchmaking, challenges, ratings | v3 Play hub; matchmaking moves into socket memory (DB polling ends); friend challenges; shared positions; Glicko-2 ratings | Hub tabs Legend/Bot/Friend/Online; quick match with no opponent → bot fallback; a challenge link opened signed out → sign up → trial → game; `/s/<code>`; rating deltas | P2, P3, P4, P8a (P5, P7 with fallbacks) | 17.5 (+3.5) | 15 | ≈ 3 wk | 20 | [P9](phase-09-play-hub-matchmaking-challenges-ratings.md) |
| 10 | Profile, settings, membership, notifications | The account area: profiles with privacy, synced settings, full membership lifecycle, deletion and export, push and email notifications without timers | `/@username` with tabs and other/private/guest views; every settings section; membership in 13 states with plan switch, cancel and pause; delete account; export; push reminders; trial-ending email | P1–P9 (P6, P7 with fallbacks) | 22 (+4.4) | 20 | ≈ 3 wk | 39 | [P10](phase-10-profile-settings-membership-notifications.md) |
| 11 | Public site, auth, system screens, PWA | Static marketing site, Clerk custom auth flows, every system screen, consent, PWA | Landing, pricing, blog, help, contact, legal; v3 sign-in/up/verify/reset; 404/500/global error; offline; maintenance; cookie consent; install and update prompts | P3, P5, P7, P8, P10 | 20 (+4.0) | 20 | ≈ 2 wk | 41 | [P11](phase-11-public-site-auth-system-screens-pwa.md) |
| 12 | Tournaments and admin | Arena pairing and scheduling on the socket; v3 tournament screens; admin tools | List → invite join → lobby → live arena → game → results; admin dashboard, positions, legends, reports, create tournament | P2, P4, P8, P9 | 18.25 (+3.75) | 17 | ≈ 2 wk | 21 | [P12](phase-12-tournaments-and-admin.md) |
| 13 | Production launch | Prod Vercel (Pro), transferred Clerk prod instance, Dodo live, old-prod data migrated and upgraded, DNS cutover, prod worker VM, monitoring, encrypted backups, rehearsed rollback | `playchess.tech` serves the new app; returning users sign in as before and find their games; the rollback has been rehearsed | all (by launch variant) | 11.25 (+2.25) + ≈ 1.25 owner-days | 8 | T−21 d → T+30 d | — | [P13](phase-13-production-launch.md) |
| | **Total** | | | | **283 dev-days (+≈ 56 buffer ≈ 339)** | **244** | | **314** | |

Boards: 314 v3 boards, all assigned to P1–P12; the 47 v1/v2/off-canvas boards are superseded (ideas only).

### 5.2 Milestones

| ID | When | Meaning |
|---|---|---|
| M1 | end of P2 | Every game is played on v3 and survives a deploy |
| M2 | end of P5 | Import → review → Mistake Bank → train: the chargeable core |
| M3 | end of P7, P8b and P9 | Feature-complete coaching, learning and play |
| M4 | end of P12 | Every v3 board built |
| M5 | P13 window | Launch (variant Full, Early or Launch A, [99-open-decisions.md](99-open-decisions.md) A11) |

---

## 6. Roadmap timeline

Assumptions: week 1 starts Monday 2026-11-02; one developer with parallel Claude agents; phase calendars from each §13 including the owner test window; **buffers not scheduled**; after P3 the work runs in two streams (coaching A, play and learn B), as the allocation and the phase files plan it. The owner's test time is the real bottleneck: two streams means the owner tests two phases in the same weeks.

```
Week    1     3     5     7     9     11    13    15    17    19    21    23    25    27    29
Monday  11-02       11-30       12-28       01-25       02-22       03-22       04-19       05-17
Core    [P1     ][P2     ][P3           ]
A                                        [P4        ][P5        ][P6  ][P7     ]
B                                        [P8a    ][P9     ][P10    ][P8b ][P12 ]
Finish                                                                          [P11 ][P13    ]
Gates                   M1                                     M2             M3+M4          M5
Risk                                           ^ domain expires 2027-02-02 (renew in P1 week 1)
```

A = stream A (coaching), B = stream B (play and learn). The P13 window is a Sunday at 04:00 UTC (≈ 2027-05-23).

P10 starts in week 18 while P5 and P6 are still running; it uses the fallbacks its §2.3 lists (reminders without the due predicate, the Training section and the strengths card hidden) until those phases merge. P9 uses its §2.3 fallbacks for P5 and P7 the same way.

| Weeks | Core, then stream A (coaching) | Stream B (play and learn) | Gate at the end |
|---|---|---|---|
| 1–3 | **P1** design system, shell, API foundations (+ hotfixes on `main` in days 1–3, live DB backup) | — | P1 sign-off |
| 4–6 | **P2** board and live game | — | M1 |
| 7–11 | **P3** server analysis and Game Review (Christmas falls in weeks 8–9: expect about a week of slip) | — | P3 sign-off; decide the stream plan and launch variant (A11) |
| 12–15 | **P4** import and onboarding | **P8a** catalogues, SEO, legend practice (weeks 12–14) | |
| 15–19 | **P5** Mistake Bank, puzzles, Train, Home (weeks 16–19) | **P9** play hub, matchmaking, challenges, ratings (weeks 15–17) | M2 (week 19) |
| 18–22 | **P6** Weakness Profile (weeks 20–21) | **P10** account area (weeks 18–20), **P8b** lessons and opening deck (weeks 21–22) | |
| 22–24 | **P7** AI coach | **P12** tournaments and admin (weeks 23–24) | M3, M4 (week 24) |
| 25–26 | **P11** public site, auth, system screens, PWA (needs P7 and P10) | | |
| 27–29 | **P13** launch: T−21 d preflight from week 27, rehearsals, the window on a Sunday at 04:00 UTC (≈ 2027-05-23), retire the old stack at T+30 d (≈ 2027-06-22) | | M5 |

| Variant | Calendar | Launch around |
|---|---|---|
| Full, two streams (above) | ≈ 29 weeks; ≈ 35 with the buffer lines | 2027-05-23 (≈ early July with buffers) |
| Full, one stream (owner tests one phase at a time) | ≈ 42 weeks | ≈ late August 2027 |
| Launch A, one stream: P1–P5, P7, a thin P10 (≈ 6 d) and a thin P11 (≈ 6 d), P13; P6, P8, P9, P12 and the rest of P10/P11 after launch | ≈ 27 weeks for ≈ 183 dev-days | ≈ 2027-05-09, then ≈ 16 more weeks for the rest |

Feasibility evidence: the two phases measured in detail ran 34–46 % over their first estimate. Plan the public launch date from the buffered numbers, not the unbuffered ones.

---

## 7. Global definition of done

A phase is "shippable to dev" when all fourteen rules hold ([allocation.md](allocation.md) §1.1 rules 1–8 and [01-architecture.md](01-architecture.md#512-design-state-coverage-regression-scope-flakes-and-sign-off) §5.12 rules 9–14). Each phase's §15 turns them into a concrete checklist.

1. **Deployed to every dev target:** merged to `dev`; Vercel `replay-chess-dev` green; the OCI dev socket (and from P3 the worker) redeployed by `deploy-oci.yml`; the Neon dev database on the phase's migration through `prisma migrate deploy`; Clerk development instance and Dodo test mode.
2. **Flags:** the phase's PostHog flags are on for the owner and E2E users A–P on dev. Legacy screens stay reachable behind the flag until the parity check passes, then are deleted (one release later).
3. **CI green:** lint, `check-types`, unit tests (`node:test` via `tsx`), integration (Docker Postgres), contract tests, the drift gate, Playwright signed-in specs (members A–P, non-member R) with the paywall on, and the device × zoom suite (8 devices × 80/100/110/125/150 %). Every board page asserts the board's box is inside the viewport and `document.scrollingElement.scrollHeight <= innerHeight`.
4. **States reachable:** every board assigned to the phase has a reachable route, and every value of its `data-props` state enum is reachable from real data or a dev-only demo route (`/dev/ui/...?state=`).
5. **No dead links:** a slot that belongs to a later phase is hidden behind that phase's flag, never a disabled stub.
6. **Owner test script** passes on the dev URL with ego-browser, and on a real iPhone and a real Android phone for phases with boards.
7. **No new errors:** no new 5xx in Vercel runtime errors or Sentry over a ≥ 24 h test window; k6 budgets met where the phase lists them; usage (Neon CU-h, Vercel, OCI) recorded before and after.
8. **Docs:** the phase spec is current, and decisions taken during the phase are recorded in [99-open-decisions.md](99-open-decisions.md).
9. **CI ran it** on the final `dev` SHA with `BILLING_PAYWALL=on`: `ci.yml`, the nightly main and device suites, and the post-deploy smoke; `check-test-globs` proves every new test file ran.
10. **States are covered by machine:** `state-coverage` shows 0 missing states for the phase's boards; every demo-only state has a written reason.
11. **Telemetry is asserted:** every new event is in the registry and asserted through the sink; the PII guard is green; the PostHog live view on dev was checked.
12. **Regression is the whole suite:** all phases' specs are green (main, devices, `flags-off`, `sw-on` from P11).
13. **Hooks and data are clean:** every test hook is registered and proven absent in a production-mode build; no spec mutates a shared letter user; exact states come from leased personas.
14. **Defects have tests, and there is a record:** every defect found by hand has a `regression:` test; `e2e/quarantine.json` has no expired entries; `docs/qa/phase-NN-signoff.md` is committed.

**Release to production** (P13 and every release after it): the latest nightly green on the release SHA; a migration rehearsal on a child branch of production; the owner approves the `prisma migrate deploy` step; expand migrations ship before code and contract migrations a release later with explicit confirmation; enum values are written one release after they ship; `@prod-smoke` (including the production-guard spec) after deploy.

---

## 8. Locked decisions

These are settled. Changing one needs the owner's explicit decision.

### 8.1 Phase 0 (done on `dev`, commit `8514fea`)

| Decision | Detail |
|---|---|
| Paid-only, no free tier | Every logged-in feature needs an active Coaching membership or an active 7-day trial. Logged-out visitors see marketing, pricing, blog, the SEO catalogues, legal pages and auth. |
| 7-day free trial with a card | Dodo checkout with `subscription_data.trial_period_days: 7`; the card is authorised, the first charge is on day 8; trial start and end are recorded from the subscription webhook/API (`trialStartedAt`, `trialEndsAt`). Cancelling during the trial promises no charge; plan switches during a trial take effect at trial end. |
| One trial per person | The trial is offered only while `trialStartedAt` is null; a returning user goes straight to a paid checkout ("Your free trial has been used"). P4/P10 add a hashed trial ledger so deletion cannot reset it. |
| Plan "Coaching" | $4.99 a month or $50 a year (renamed from "Player"). The legacy $8 "Player" plan is grandfathered for existing subscribers. |
| No guest demo | `/try/*` and `api/chess/create-demo-game` removed; `/try/*` redirects to `/pricing`. |
| Analysis is members-only and private | The analysis API requires membership and only the game's players can read it. |
| Processors disclosed | Privacy and cookie pages list Dodo, PostHog, Sentry and R2. |
| Dev environment | Vercel project `replay-chess-dev` (production branch `dev`), OCI dev socket 80.225.200.210 (`wss://ws-dev.80-225-200-210.sslip.io`), Neon dev database, Clerk development instance, Dodo test mode; Sentry and PostHog events tagged with `NEXT_PUBLIC_APP_ENV` / `APP_ENV`; `deploy-oci.yml` sends `dev` → dev server and `main` → prod server. |
| Move-quality icons | `public/board_icons` are the owner's own icons (allocation B8); the DS `mq-*` tokens are used for colours only. |

### 8.2 From CLAUDE.md (repo rules)

| Rule | Detail |
|---|---|
| Never `prisma migrate dev` against production (or any database with real data) | After the 2026-03-08 incident. `prisma migrate deploy` is the safe command for production; drift is fixed with `prisma migrate resolve --applied`, never `migrate dev`. **Before any destructive database command, ask: "This command may reset/drop your database. Are you sure?"** Rule 1's `db push` wording is under review (decision A3); until it is reworded, the plan never runs `db push` on a branch that holds hand-written partial indexes. |
| Never point local dev at the prod database | `apps/web/.env.development.local` → Neon dev, Clerk development, Dodo test mode; `apps/web/.env.test` holds E2E users A–P (members), Q (trial used) and R (non-member). |
| Free tier only on Oracle | Both OCI instances are VM.Standard.A1.Flex 1 OCPU / 6 GB / 50 GB, inside the Always Free 4 OCPU / 24 GB / 200 GB. Never resize or add beyond it; nothing on Oracle should cost money (the prod worker VM in P13 fills the pool exactly; anything more is a paid "Stage C" decision). |
| Branches | Work happens on `dev`; `main` is production. Test on dev, then merge to main. |
| Accounts and browsers | Replay Chess service accounts (Clerk, PostHog, Cloudflare R2, Sentry, Vercel, new Neon) belong to replaychess007 and are used through ego-browser; Dodo belongs to the owner's main email and is used through Claude in Chrome. App testing uses ego-browser; Playwright is the automated regression suite. Close every page and tab opened. |
| Domain and email | `playchess.tech` is reserved for production; dev uses the `.vercel.app` and `sslip.io` addresses. DNS is on the replaychess007 Cloudflare account with every record DNS-only (never proxy the Vercel or Clerk records). `hello@` and `careers@` forward to replaychess007. |
| Neon projects | New account project `withered-cake-82837167`: `production` (the future prod database) and `dev`. Old account project `shy-morning-50748774` still serves the live site until P13. |
| Tech stack | Next.js 15 + React 19 with the React Compiler (no manual memoization), Tailwind CSS 4, Prisma, Clerk, Socket.io, Zustand. |

### 8.3 Binding cross-phase rules from the plan set

The plan files share one vocabulary. The decisions every phase builds on are [allocation.md](allocation.md) §2 (B1–B26) and [01-architecture.md](01-architecture.md#03-canonical-names-and-rulings-binding-for-every-plan) §0.3 (CR-01–CR-37). The ones that most shape the code:

- **B1/CR-02** one `GamePlayer` row per member and game, indexed `(userId, endedAt DESC, gameId DESC)`; **B2/B3/CR-01** typed game columns, moves as UCI text, PGN stored once for games played here.
- **B4/CR-17** the socket server writes live games straight to Neon at checkpoints (≤ 10 writes a game) through `packages/db`; only tournament lifecycle goes through web internal routes.
- **B5/CR-08–CR-11** one Postgres `Job` table claimed with `FOR UPDATE SKIP LOCKED`; higher priority runs first; no hourly tick: a daily `HOUSEKEEPING` + `DAILY_PLAN` writes next-due rows.
- **B6/CR-06** packed `GameAnalysis` plus `PlayerReview` (≤ 3 key moments); **B7** eval cache in SQLite on the worker; **B13** puzzles as immutable R2 shards.
- **B16/CR-18** one envelope and one error-code ledger; **CR-19** fixed-window rate limits with burst and durable stores; **CR-20** six cache tiers, no per-user `max-age > 0`; **CR-22** one `api()` client; **CR-24** a GET never enqueues work or calls a provider.
- **B20/CR-13–CR-15** colon-case socket events from one registry, rooms `game:`, `spectate:`, `user:`, `tournament:`, one fan-out route `/internal/emit`; **CR-16** HMAC on every internal hop from P2.
- **B26** lapsed members are redirected to `/pricing?reason=ended` and their data is kept, unless the owner approves read-only access before P3 (decision D1).
- **CR-33** coach fair use: members 30 a day and 150 a month ($1.50 of model cost), trialists 10 a day and 40 per trial ($0.40), in one file `CT/limits.ts`.
- **CR-35** migration files and `prisma migrate deploy` on every Neon branch; `migrate dev` only against a local Docker Postgres shadow.

---

## 9. Keeping this folder correct

- A phase spec that changes a cross-phase name updates [01-architecture.md](01-architecture.md) §0.3 in the same PR.
- Answers to open questions go into [99-open-decisions.md](99-open-decisions.md) (the "Answer" column), and the affected phase files are edited to match.
- Links inside this folder were checked when it was assembled: every markdown link between files resolves, every phase file P1–P13 exists, and `phase-01a-spec.md` (named by P1 work package 1A·DOC) and `allocation.md` were copied in from the scratchpad. The plan files still name scratch inputs (`SP/...`) in their path tables and evidence; those resolve only while the scratchpad exists (decision A12).
