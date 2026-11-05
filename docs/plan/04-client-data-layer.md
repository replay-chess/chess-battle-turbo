# Client data layer: how the UI talks to the APIs (target design)

Status: **final plan, revision 2**, 2026-11-02 · Branch `dev` (Phase 0 done) · Scope: `apps/web` (Next.js 15.5, React 19, React Compiler) and its socket client to `apps/web-socket` on OCI.

**What revision 2 changed** (dispositions in Appendix A):
1. **One `api()`** (P1 §7.12, `lib/api/client.ts`): header `x-rc-build`, no `ifNoneMatch`/`notModified`, zod parsing only in dev and test through `devSchema()` so zod stays out of production bundles (§4.3).
2. **Names from `01-architecture.md` §0.3:** `packages/contracts` (not `packages/contracts`), the `CT/http/codes.ts` error ledger, `bank:due_changed`, `entitlement:changed`, P2 rooms and events, `qk.review.status(ref)` → `GET /api/review/[ref]/status`.
3. **Fewer requests on reconnect and during import backlogs:** user-room resync only on a `bootId` change or a `useq` gap; Home invalidations throttled to 1 per 30 s per visible tab; `analysis:batch` for backlogs (§3.5, §5.6).
4. **Pollers that really stop:** the `fallbackInterval` start time no longer resets on every render; no polling in hidden tabs; the badge fallback is on focus or ≥ 10 min (§5.9).
5. **Shared devices:** sign-out clears the browser HTTP cache (`POST /api/session/clear` → `Clear-Site-Data: "cache"`), the user's outbox keys and the per-user SW page cache (§6.6, §7.1); the SW has an emergency kill switch (§7.6).
6. **GETs never enqueue:** no hover prefetch of anything that would queue engine work; the coach context key has no `ply` (§3.4, §3.8).
7. **The migration plan uses the 13-phase numbering** (§9).

What this document decides: how every v3 screen gets its data on first paint, how it keeps that data fresh, how it writes, how it reacts to errors, sockets, streams and the network going away, and how today's code gets there phase by phase.

What it does not decide: final route paths, payload fields and DB schema (`03-api-design.md`, `02-data-model.md` and the phase specs own those), and socket event semantics (P2 and `CT/socket/registry.ts` own them). Where this document needs a name, it puts it behind **one indirection** (`lib/api/endpoints.ts` for HTTP, `@repo/contracts/socket/*` for events) so a rename touches one file.

**Inputs**
- Audits, all in `scratchpad/plan/`:
  - `audit-client.md` (cited as **AC §n**)
  - `audit-api.md` (**AA**)
  - `audit-socket.md` (**AS**)
  - `audit-db.md`
  - `audit-quality.md`
- Inventories, in the same folder: `inv-pub.md` (**IP**), `inv-play-a.md` (**IPA**), `inv-play-b.md` (**IPB**), `inv-rct-a.md` (**IRA**), `inv-rct-b.md` (**IRB**), `inv-acct.md` (**IAC**), `inv-sys.md` (**IS**), `inv-research.md`.
- `docs/implementation-plan.md` (**PLAN**).
- The design index `design-ref/INDEX.md` and the v3 boards it lists.
- The code.

**Citations.** `file:line` is relative to `apps/web/` unless it says otherwise. Design boards are `design-ref/project/v2/<Name>.dc.html`, and their states come from each board's `data-props` `state` enum.

---

## 0. Decisions at a glance

| # | Decision | One-line reason |
|---|---|---|
| D1 | **First paint comes from React Server Components** that read a **server-only data access layer** (`lib/data/*.ts`, `import "server-only"`). Pages never call their own `/api` over HTTP. | Removes today's boot waterfall: 3–5 invocations, 1 Clerk call and 1–2 Dodo calls per hard load (AA §5.1, AC §3.1). |
| D2 | **Public SEO pages are static or ISR** (`force-static` / `revalidate` + `unstable_cache` tags). **Member pages are dynamic RSC**, streamed with `<Suspense>`. | Crawlers and launch spikes cost CDN hits, not functions (IP §1.3). Member data is per user and time-dependent. |
| D3 | **TanStack Query v5 is the only client cache for server state**: one `QueryClient` per tab, seeded from RSC via `HydrationBoundary`. No SWR. No hand-rolled `fetch` + `useState`. | Optimistic mutations with rollback, infinite lists, `setQueryData` from socket events, serial mutation scopes, a pausable `onlineManager`, and devtools, for about 13 kB gz. |
| D4 | **No Server Actions for data writes.** Every mutation is a route handler called through the typed `api()` client. | One contract for the browser, the socket server, k6 and the offline outbox. Uniform 401/402/429 handling. Idempotency headers. Actions run one at a time per client and can't be replayed by a service worker. |
| D5 | **One typed client, `api()`** (`lib/api/client.ts`): zod-parsed responses, one error envelope (`packages/contracts/src/http/codes.ts` + `envelope.ts`), `AbortSignal` with a timeout, `Idempotency-Key`, `x-request-id`. Global reactions run in one place, `reactToApiError()`: 401 → session flow, 402 → paywall, 429 → inline countdown, 503 → maintenance. | It replaces 16 hand-written 402 checks, 3 envelope shapes and 0 aborts (AC §0). |
| D6 | **The viewer and entitlement live in the query cache under `qk.me()`.** It is seeded by `(app)/layout.tsx` from `getMe()` and never fetched on boot. Sockets, mutation responses and a 5-minute stale focus refetch update it. It is **never persisted**. | One copy. No hydration mismatch (AC finding 12). Shell badges stay current on soft navigations, which don't re-run layouts (§2.3). |
| D7 | **Zustand only for client-owned state:** `usePrefs` (local-first, synced), `useOverlays`, the per-instance game, trainer and review view stores, and `usePendingBoard`. `useUserStore` and `useDataStore` are deleted. | Prefs are read synchronously outside React (sounds, board CSS variables, pre-hydration script). Server data never goes into Zustand. |
| D8 | **The URL holds view state:** tabs, filters, selection, `?modal=`, moment index, `redirect_url`. Pure view changes use `history.replaceState`, which Next 15 syncs with `useSearchParams`. It avoids an RSC round trip, and so a function invocation. | Deep links, Back behaves as expected, and Hobby invocations stay low. |
| D9 | **One socket per tab** (`lib/realtime/connection.ts`), connected lazily and ref-counted. It uses the websocket transport first, the socket.io backoff 0.5–5 s, a layout-minted token, and re-joins rooms on every reconnect. **Recovery is snapshot plus `seq` gap detection only.** `connectionStateRecovery` is optional and never relied on. | Today: 2 creation sites, polling-first transport, no disconnect UI, REST re-hydrate on reconnect (AC §7, AS §15). |
| D10 | **Push, not poll.** Polling is allowed only as a socket-down fallback for checkout activation, analysis status, import status and weakness computing, through `refetchInterval` functions that return `false` while the socket is live or the tab is hidden. All other polls are deleted. | Today's polls: matchmaking 1 s, tournament find-match 2–4 s, lobby full refetch, activation 3 copies (AC §8). |
| D11 | **Coach answers stream as SSE** over `fetch` POST (`lib/sse.ts`, `useCoachStream`). Only **verified `sentence` events** are painted. Stop, unmount or navigation aborts the stream, and the server then neither charges quota nor stores the message. There is no automatic retry mid-stream. | Matches "Every answer is checked against the engine before you see it" (`V3CoachStreaming`) and avoids duplicate LLM spend. |
| D12 | **Puzzle and bank grades are optimistic with an IndexedDB outbox** (`rc-outbox`, idempotent `clientAttemptId`, batch POST, Web Locks so only one tab flushes). | Instant advance, offline drills (`V3Offline` "Mistake Bank · 6 due"), no double grading across tabs. |
| D13 | **The service worker never caches `/api/*` or RSC payloads.** It precaches only the shell, fonts, pieces and `/offline`. Hashed engine files are `CacheFirst`. A short allow-list of documents is `NetworkFirst`. Everything is purged at sign-out. | Today's SW serves one user's `/api/*` JSON to the next, and precaches 4.8 MB (AC finding 11). |
| D14 | **Loading, empty and error UI is a closed set of Phase 1 kit components** (`Skeleton`, `GhostRow`, `Hairline`, `EmptyState`, `ErrorState`, `RateLimitedInline`, `OfflineChip`, `InGameStatusChip`, `notify.*`). A `<QueryState>` helper maps query status to them. A spinner appears only inside a button. | DS rule "never a spinner alone" (`V3Skeletons` `list`), and one look for 41 routes. |
| D15 | **Lint guardrails:** no `fetch("/api` outside `lib/api/**`, no `socket.io-client` import outside `lib/realtime/**`, no `localStorage` or `sessionStorage` outside `lib/storage/**`. | Stops the 73-site sprawl from coming back. |

### 0.1 Conflicts between the inventories, and how this document resolves them

| Topic | Proposals | Decision here | Why |
|---|---|---|---|
| Client cache library | TanStack Query (AC §11.5, IS §2.8, IAC §1.3, IPB §3.10) vs "no React Query, Zustand + `useOptimistic`" for Review and Coach (IRA §2.8) | **TanStack Query everywhere** (D3). Review view state stays in a small Zustand store (§6.3). | Review is the same pattern as every other screen: an RSC payload plus socket deltas plus a few mutations. A second mechanism means two invalidation stories. |
| Where the viewer and shell live | `ViewerProvider` context (AC §11.2), Zustand `useShell` (IS §2.5), Zustand `useUserStore` (IAC §1.3) | **The query cache, `qk.me()`** (D6) | Socket events and mutation responses already write to the query cache. Layouts don't re-render on soft navigation, so a context seeded once would go stale. |
| Analysis progress channel | Per-review room with its own room token (IRA §2.5) vs the user room (IPA §4.4, IPB §3.8, IS §2.6) | **The user room `user:{ref}`** | No second token or room claim is needed. The same events feed Home, the game-over card and the archive rows. Only the two players' user rooms receive them, which keeps the Phase 0 "analysis private to players" rule. |
| Post-game status fallback | `GET /api/review/:ref/status` (IRA A2) vs `GET /api/games/:ref/status` (IPB A9) | **One endpoint: `GET /api/review/[ref]/status`**, covering analysis, comparison, review readiness and bank-added | One poller, one ETag. |
| Checkout return | `/checkout/return` + `POST /api/billing/refresh` (AC §11.11) vs `/checkout/activating` + `GET /api/billing/activation` (IP §2.7) | **`/checkout/activating` and `/onboarding/activating`**, both using `GET /api/billing/activation` | The activation endpoint can self-heal by calling Dodo every 3rd call, and it sets the `rc_act` cookie that middleware needs. |
| Socket event naming | Dotted `game.move` (AS §17) vs `game:move` (IPA §4) vs snake `entitlement_changed` (IP, IS) | **`domain:verb` everywhere**, for example `entitlement:changed`, `import:progress`, `game:move` | The socket plan owns final names. The client maps them in `packages/contracts/src/events.ts`. |
| Gate location | `(app)/layout.tsx` only (AC §11.1) | **Middleware claims + `requireMemberPage()` in every page + `route({auth})` in APIs** | A layout is **not re-run on soft navigation** in the App Router, so a layout-only gate (and a layout-only onboarding redirect) misses in-app navigations. AC §11.2 says the opposite and is wrong on this point. |
| Bot moves | Server-side bot (AC §7.3) vs client-run bot on `packages/game-core` (AS §17.11, IPA §2.4) | **Client-run bot**, unrated, with a server-replayed PGN at completion | The design shows "Play vs bot offline · Still works on this device". Unrated games keep integrity issues out of stats. |

---

## 1. Today vs target, in numbers

| Metric | Today (evidence) | Target |
|---|---|---|
| Client `fetch` sites | 73 in 32 files (AC §0) | 0 outside `lib/api/**` |
| Data library | none (`package.json`) | `@tanstack/react-query@5` |
| `AbortController` on client fetches | 0 | every query (`signal` from Query) and every stream |
| Hand-written 402 handling | 16 sites (`isSubscriptionRequiredResponse`, `lib/billing/client.ts:120-133`) | 1 (`reactToApiError`) |
| Envelope shapes | 3–5 (AA F-15) | 1, plus a legacy adapter during migration |
| Boot calls per hard load | `POST /api/user/sync` → `GET /api/subscription` in sequence (`app/components/UserSync.tsx:103,138`), plus `/api/user/email` when the store is cold | 0 extra (the layout reads the DB once inside the render) |
| Socket creation sites | 2 (`GamePageContent.tsx:393`, `useTournamentLobby.ts:120`) | 1 (`lib/realtime/connection.ts`) |
| Polling loops | 4 kinds, 6 copies (AC §8) | 4 fallbacks, active only while the socket is down |
| Persisted client state | 7 `localStorage` keys, including entitlement, email and role (`lib/stores/useUserStore.ts:150-156`) | `rc:prefs:v1`, `rc:dismissed:v1`; IndexedDB `rc-offline`, `rc-outbox`; never identity or entitlement |
| Stacked spinners | 2–3 per gated page (AC finding 14) | 0; route skeletons per `V3Skeletons` |
| Vercel calls per typical session (boot → queue → game → review) | ≈30–35 (AC §8) | ≈3–5 (§10) |

---

## 2. Rendering strategy per route type

### 2.1 Route groups

```
app/
  layout.tsx                       server: html/body, fonts, ThemeProvider, ClerkProvider (static-compatible, no `dynamic` prop),
                                   <Providers> (client: QueryProvider, NavigationBridge, Toaster, OverlayHost, ServiceWorkerBridge)
  (marketing)/…                    static / ISR; client islands for auth-aware CTAs (Clerk useAuth(), no network)
  (auth)/sign-in, sign-up, …       dynamic server shell (reads redirect_url), client Clerk custom flows
  (onboarding)/onboarding/[step]   dynamic RSC, signed-in (not necessarily member)
  checkout/activating              dynamic RSC shell + client activation engine
  (app)/layout.tsx                 dynamic RSC: getMe() → gate → AppShell → HydrationBoundary(me) → RealtimeBoot(token)
  (app)/home, play, train/**, games, profile/**, settings/**, tournaments/**, coach/**
  (app)/(immersive)/game/[ref], review/[ref], train/bank/session, train/puzzles, learn/lessons/[slug], practice, queue
  (admin)/admin/**                 dynamic RSC behind requireAdmin(); desktop only
  offline, maintenance, too-many-requests   force-static, precached
```

The route map itself belongs to IS §1.5 and IP §1.1. This document only fixes **how each kind renders and talks to data**.

### 2.2 Rendering table

| Route kind | Examples | Render | Cache | First-paint data | Client data after paint | `loading.tsx` / Suspense | Prefetch |
|---|---|---|---|---|---|---|---|
| Marketing, static | `/`, `/how-we-grade`, `/about`, `/help`, legal, `/press`, `/careers` | `export const dynamic = "force-static"` | CDN until deploy | none (static) | none. CTA islands read `useAuth()` locally (no request). Dates such as "Cancel before 6 Nov" render after mount (`<TrialDate/>`, IP §1.3). | none | default `<Link>` viewport prefetch (static, so free) |
| Pricing | `/pricing`, `?reason=required\|ended` | `force-static` shell. `PlanCta` and `PricingBanner` islands use `useSearchParams()` inside `<Suspense>`. | CDN | static | `useMe()` only if signed in (`enabled: isSignedIn`), to switch "Start trial" vs "You're a member" **after** hydration with an identical box size | island fallback = the signed-out CTA | — |
| Public catalogue | `/legends`, `/legends/[slug]`, `/openings`, `/openings/eco/[letter]`, `/openings/[slug]`, `/legends/positions/**`, `/learn/**` | ISR: `revalidate = 86400` + `unstable_cache(loader, key, { tags })`. `generateStaticParams` for the 51 legends, featured positions and the top 300 openings. | CDN + Data Cache; `revalidateTag` from admin writes | DAL (`lib/data/catalog.ts`) | search: `useQuery(catalog.openingsSearch)` → `GET /api/openings/search` (`public, s-maxage=86400`) | catalogue page shell + `GhostRow ×9` for search results | default |
| Blog | `/blog/**` | SSG (exists, `app/blog/[slug]/page.tsx:28`) | CDN | MDX | none | — | default |
| Public share | `/r/[slug]`, `/s/[code]`, `/join/[code]` preview | ISR (`/r`) / dynamic with `s-maxage=10` public shape (`/join`) | CDN | DAL | accept → mutation | — | — |
| Auth | `/sign-in`, `/sign-up`, `/sign-up/verify`, `/reset-password`, `/sso-callback` | dynamic server shell (reads `redirect_url` to name the destination) | none | `resolveReturnTarget()` label | Clerk JS only | — | none |
| Signed-in, not member | `/onboarding/*`, `/checkout/activating`, `/settings/membership`, `/settings/account`, `/settings/connected` | dynamic RSC | none | `getMe()` + step data | step mutations, `useActivation()`, `useImportProgress()` | step skeleton | — |
| Member hub pages | `/home`, `/train`, `/games`, `/profile/**`, `/settings/**`, `/tournaments/**`, `/play` | dynamic RSC, **streamed** | none across requests; `React.cache` per request | `prefetchQuery` (DAL) → `HydrationBoundary` | the same queries (no double fetch), socket patches, focus refetch when stale | `loading.tsx` = the designed skeleton; `<Suspense>` per slow block | `AppLink` intent prefetch (§3.8) |
| Immersive board pages | `/game/[ref]`, `/review/[ref]`, `/train/bank/session`, `/train/puzzles`, `/learn/lessons/[slug]`, `/practice` | dynamic RSC; the **board renders from FEN outside Suspense** | none | snapshot DTO (game), review payload, session payload | game: socket store; review: `reviewQuery` + socket deltas; trainer: runner store + outbox | `game`/`review` skeletons from `V3Skeletons` | `<Link prefetch>` (full) only on "Start review" and Home "Continue" |
| Admin | `/admin/**` | dynamic RSC behind `requireAdmin()` | none | DAL | `useQuery` lists, mutations; `revalidateTag` on writes | list skeleton | none |
| System | `/offline`, `/maintenance`, `/too-many-requests` | `force-static`, precached | SW precache | none | `useOnline()` health ping; IDB reads | — | — |

### 2.3 The server-only data access layer (DAL)

**Layout.** One module per domain. Each exports plain async functions that return **JSON-safe DTOs**: ISO date strings, BigInt as string, no Prisma objects. The same function backs the RSC page and the GET route handler, so the dehydrated query data and the API response are identical.

```
lib/data/
  me.ts            getMe()                  // the one shell query (IP §1.7 select, IS §2.5 badges): cache()
  home.ts          getHome(viewer)
  games.ts         listMyGames(viewer, filters, cursor), getGameSnapshot(viewer, ref), getGameStatus(viewer, ref)
  review.ts        getReview(viewer, ref), getLegendCompare(viewer, ref)
  coach.ts         getCoachContext(viewer, {gameRef, ply}), getThread(viewer, id, cursor)
  train.ts         getTrainToday(viewer), listBank(viewer, filters, cursor), getSession(viewer, ref), listThemes(viewer)
  weakness.ts      getWeakness(viewer)
  learn.ts         getLessonProgress(viewer, scope)
  players.ts       getPlayer(viewerOrNull, username), listPlayerGames(...)
  tournaments.ts   listTournaments(tab, cursor), getTournament(viewerOrNull, slug), listStandings(slug, cursor)
  billing.ts       getMembership(viewer), getActivation(viewer, params)
  catalog.ts       listLegends(), getLegend(slug), listOpenings(letter), getOpening(slug)   // unstable_cache + tags
  admin/*.ts
```

**Rules**

1. `import "server-only"` at the top of every file. Any client import then fails the build.
2. **Per-request dedupe** with `cache()`. Today a layout and its page each query the same legend or opening row (`legends/[referenceId]/layout.tsx:10` + `page.tsx:17`, AC §13). With `cache()` they share one.
3. **Cross-request caching only for public data:** `unstable_cache(fn, [key], { tags, revalidate })`. Per-user data is never cached across requests, because invalidation per user isn't worth it at this scale (IPA §2.1.5).
4. Explicit `select` everywhere (AA F-18). Independent reads run in `Promise.all` (AA F-17).
5. **Errors:** the DAL throws `DataError("not_found" | "forbidden" | …)`. Pages map it to `notFound()`, which masks private games as 404, and the route wrapper maps it to the envelope.
6. **Labels are computed on the server in the viewer's timezone** (`prefs.notifications.timezone`, captured with `Intl` at first load), for example `playedAtLabel: "today"` and `nextLabel: "Tomorrow"` (IRB `BankRow`). The client never runs `toLocaleString` on SSR'd text. Only live countdowns run on the client (`useNow`).
7. Each DTO has one zod schema in `packages/contracts` (or `lib/contracts/*`, per IAC §1.2). The client parses responses with it (§4), and a unit test parses each DAL function's output with the same schema.

### 2.4 Member page pattern: layout, page and streaming

**The gate is in three places, because layouts don't re-render on soft navigation.**

| Layer | Runs on | Checks | Source |
|---|---|---|---|
| `middleware.ts` | every document and RSC request | signed in; `md.onboarded`; `md.entitled` or the `rc_act` cookie | Clerk session claims, no DB (IP §1.2) |
| `requireMemberPage()` in each `page.tsx` | every render of that page, soft navigation included | DB entitlement via `getMe()` (cached) | DB (authority) |
| `route({ auth: "member" })` | every API call | DB entitlement | DB (authority) |

```tsx
// app/(app)/layout.tsx (server)
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();                              // React cache(): one SQL round trip (IS §2.5, target p95 < 25 ms)
  if (!me) redirect("/sign-in");                         // middleware normally catches this first
  const qc = getServerQueryClient();                     // cache(() => new QueryClient()) per request
  qc.setQueryData(qk.me(), me);
  const socket = mintSocketToken(me);                    // { token, exp }; lib/socket-token.ts:48-63 (no HTTP round trip)
  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <AppShell>                                         {/* server markup; nav reads useMe() selectors */}
        <RealtimeBoot url={process.env.NEXT_PUBLIC_WS_URL!} token={socket} buildId={me.buildId} />
        <UserChannel />                                  {/* routes user-room events into the cache (§5.6) */}
        {children}
      </AppShell>
    </HydrationBoundary>
  );
}
```

```tsx
// app/(app)/train/bank/page.tsx (server): awaited critical data + streamed secondary blocks
export default async function BankPage({ searchParams }: { searchParams: Promise<BankSearch> }) {
  const viewer = await requireMemberPage();              // redirect('/pricing?reason=…&redirect_url=…') when not a member
  const filters = parseBankFilters(await searchParams);  // the URL is the filter state (D8)
  const qc = getServerQueryClient();
  await qc.prefetchInfiniteQuery({
    queryKey: qk.train.bank(filters),
    queryFn: () => listBank(viewer, filters, null),      // the DAL, not HTTP
    initialPageParam: null,
  });
  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <BankScreen filters={filters} />                   {/* client: useBankList(filters) reads the seeded cache */}
      <Suspense fallback={<UpcomingSkeleton />}>
        <UpcomingBlock viewer={viewer} />                {/* async server component with its own HydrationBoundary */}
      </Suspense>
    </HydrationBoundary>
  );
}
```

**Streaming rules**

- Await only what the first viewport needs: the board FEN, the header, the first list page. Every other block is its own async server component inside `<Suspense>` with its **designed** skeleton. Each prefetches into its own `QueryClient` and renders its own `HydrationBoundary`. This is the documented nested pattern; it needs no pending-query dehydration.
- On board pages, the board and both player bars render **outside** Suspense from the snapshot DTO. The interactive client (socket, engine) mounts inside.
- `export const dynamic` is never set on member pages. Reading `auth()` / `cookies()` already makes them dynamic.

| Page | Awaited (blocks first byte) | Streamed `<Suspense>` blocks |
|---|---|---|
| `/home` | header, nav, trial or payment banner (from `me`) | Continue card (analysis join, the slowest), Recent games, Today's training (IS §3.18) |
| `/train` | `TrainToday` (the frozen plan in `training_days.plan`, B12) | due previews (FEN thumbnails), theme mastery |
| `/train/bank` | first `BankPage` (50 rows) | `upcoming` and facets |
| `/games` | first page of `GET /api/me/games` | counts per source |
| `/review/[ref]` | the whole `ReviewPayload` (≈4 KB, one read, IRA A1) | legend compare (a query fired when the tab is hovered or opened) |
| `/game/[ref]` | `{fen, orientation, players, mode}` (one indexed read) | the `GameClient` socket island |
| `/profile/[username]` | header, overview | games tab, stats tab |
| `/tournaments/[slug]` | snapshot (status, header, your row) | standings page 1, top board |
| `/settings/*` | settings shell + section data | connected accounts (an upstream status read) |
| `/coach` (P7 D11 routes; no `[threadId]` segment) | context and suggestions | thread history (newest page) |

### 2.5 Public SEO pages

- `force-static` or ISR only, with **no `searchParams` read on the server**, because that makes the page dynamic. Query-dependent bits are client islands inside `<Suspense>` (IP §1.3).
- `/openings` today is **8.1 MB of HTML, `force-dynamic`** (`app/openings/page.tsx:9,33-43`, AC §13). Target: one page per ECO letter (`/openings/eco/[letter]`), no PGN in list rows, and search through `GET /api/openings/search` with a 200 ms debounce and abort (§3.10).
- `/legends` (`app/legends/page.tsx:7`): `force-dynamic` → ISR.
- Admin writes call `revalidateTag("legends" | "legend:<slug>" | "positions" | "position:<slug>" | "openings" | "opening:<slug>")`.
- Signed-in visitors on `/` are redirected to `/home` by middleware (IS §1.5), so the landing page stays static.

### 2.6 What may be a client component

A file gets `"use client"` only if it does one of the following:

1. holds interaction state: board input, forms, menus, sheets;
2. subscribes to the query cache, the socket, the SSE stream or `useOnline`;
3. uses browser APIs: audio, Worker, IndexedDB, `matchMedia`.

Legal and company pages (`about`, `careers`, `cookies`, `privacy`, `terms`) are client components today only for `motion` (AC §10.3). They become server components with a small `<Reveal>` client island.

### 2.7 Next.js router knobs

| Knob | Setting | Effect |
|---|---|---|
| `experimental.staleTimes` | `{ dynamic: 30, static: 300 }` | Back, forward and quick tab switches within 30 s reuse the RSC payload: no invocation. Safe because `HydrationBoundary` only overwrites cached queries with **newer** data, and the queries refresh on their own `staleTime`. |
| `router.refresh()` | only after changes that alter **server-rendered, non-query** output: entitlement flips, onboarding completion, account linking | each call is one invocation |
| `history.replaceState` | every pure view change (tab, moment, ply, selected row, filter when the list is a client query) | Next syncs `useSearchParams`; no RSC fetch |

---

## 3. Client server-state: TanStack Query v5

### 3.1 Choice

| Option | Mutations + rollback | Infinite cursor lists | Seed from RSC | Push updates from the socket | Offline pause and resume | Serial mutations | Size | Verdict |
|---|---|---|---|---|---|---|---|---|
| **TanStack Query v5** | `onMutate` / rollback, `scope` | `useInfiniteQuery` + `maxPages` | `HydrationBoundary` / `dehydrate` | `setQueryData`, `setQueriesData`, `invalidateQueries({refetchType:'none'})` | `onlineManager`, `networkMode` | `scope: { id }` | ≈13 kB gz | **chosen** |
| SWR 2 | `optimisticData` + `rollbackOnError`, less granular | `useSWRInfinite` (page-index based) | `fallback` prop | `mutate(key, data)` | no first-class pause | no | ≈5 kB | lacks scopes, typed key factories and a mutation cache for global error handling |
| RSC + Server Actions only | `useOptimistic` per component | page per URL | native | needs `router.refresh()` per event (an invocation each) | none | actions run one at a time per client | 0 kB | every socket event or filter change costs a server render; no offline story |

**Answer to IRA §2.8's "few mutations, live data from the socket".** The socket deltas still need a home that components subscribe to. The Review screen shares that data with Home, the archive and the game-over card, so a per-screen Zustand store would duplicate it. Query keys give one shared, typed home.

**What TanStack does not hold:**
- the live game (a per-instance store driven by the socket, §5.7);
- clocks (an external store at rAF rate);
- prefs (local-first Zustand, §6.3);
- the trainer runner's step state (a per-session store).

### 3.2 `QueryClient` defaults

```ts
// lib/api/query-client.ts
import { QueryClient, QueryCache, MutationCache, isServer } from "@tanstack/react-query";
import { reactToApiError, retryQuery, retryDelay } from "./errors";

export function makeQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) =>
        reactToApiError(error, { kind: query.state.data === undefined ? "query" : "background", meta: query.meta }),
    }),
    mutationCache: new MutationCache({
      onError: (error, _vars, _ctx, mutation) => reactToApiError(error, { kind: "mutation", meta: mutation.meta }),
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,              // per-resource overrides in §3.4
        gcTime: 5 * 60_000,
        retry: retryQuery,              // §3.7: 2× on network/5xx, never on 4xx
        retryDelay,                     // honours Retry-After; exponential with jitter
        refetchOnWindowFocus: true,     // only refetches queries that are stale
        refetchOnReconnect: true,
        networkMode: "online",          // paused, not failed, while offline
      },
      mutations: { retry: 0, networkMode: "online" },
      // DTOs are JSON-safe (§2.3 rule 1), so dehydrate/hydrate need no custom serializer
    },
  });
}

let browserClient: QueryClient | undefined;
export function getQueryClient() {
  if (isServer) return makeQueryClient();                 // server: use getServerQueryClient() (React cache) in RSC
  return (browserClient ??= makeQueryClient());
}
```

- **Provider:** `app/providers.tsx` mounts `<QueryClientProvider client={getQueryClient()}>`.
- **Devtools:** dev only, via `next/dynamic`.
- **`onlineManager`** is fed by `useOnline()`, which combines `navigator.onLine` with the `/api/health` ping (§7.3). A captive portal therefore pauses queries instead of erroring them.
- **`focusManager`** keeps its default `visibilitychange` listener.

### 3.3 Query-key conventions

```ts
// lib/api/keys.ts: the only place keys are built
type Filters = Record<string, string | number | boolean | null | undefined>;
const norm = (f: Filters) =>
  Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== "" && v !== null).sort(([a], [b]) => a.localeCompare(b)));

export const qk = {
  me: () => ["me"] as const,
  home: () => ["home"] as const,
  games: {
    all: () => ["games"] as const,
    list: (f: GamesFilter) => ["games", "list", norm(f)] as const,
    counts: () => ["games", "counts"] as const,
    status: (ref: string) => ["games", ref, "status"] as const,
    challenge: (code: string) => ["games", "challenge", code] as const,
  },
  review: {
    all: () => ["review"] as const,
    detail: (ref: string) => ["review", ref] as const,
    legend: (ref: string) => ["review", ref, "legend"] as const,
  },
  coach: {
    context: (gameRef: string, ply: number | null) => ["coach", "context", gameRef, ply] as const,
    thread: (threadId: string) => ["coach", "thread", threadId] as const,
  },
  train: {
    all: () => ["train"] as const,
    today: () => ["train", "today"] as const,
    bank: (f: BankFilter) => ["train", "bank", norm(f)] as const,
    session: (ref: string) => ["train", "session", ref] as const,
    themes: () => ["train", "themes"] as const,
    weakness: () => ["train", "weakness"] as const,
  },
  learn: { progress: (scope: string) => ["learn", "progress", scope] as const },
  catalog: {
    openings: (q: string, family?: string) => ["catalog", "openings", norm({ q, family })] as const,
    positions: (q: string) => ["catalog", "positions", q] as const,
  },
  search: (scope: "public" | "member", q: string) => ["search", scope, q] as const,
  players: {
    detail: (username: string) => ["players", username] as const,
    games: (username: string, f: GamesFilter) => ["players", username, "games", norm(f)] as const,
  },
  tournaments: {
    list: (tab: "live" | "upcoming" | "finished") => ["tournaments", "list", tab] as const,
    detail: (slug: string) => ["tournaments", slug] as const,
    standings: (slug: string) => ["tournaments", slug, "standings"] as const,
    participants: (slug: string, q: string) => ["tournaments", slug, "participants", q] as const,
  },
  billing: {
    membership: () => ["billing", "membership"] as const,
    preview: (plan: "monthly" | "yearly") => ["billing", "preview", plan] as const,
    activation: (sessionId: string) => ["billing", "activation", sessionId] as const,
  },
  accounts: () => ["accounts"] as const,
  imports: () => ["imports"] as const,
  notifications: () => ["notifications"] as const,
  admin: { list: (entity: string, f: Filters) => ["admin", entity, norm(f)] as const },
} as const;
```

**Rules**

1. **The first segment is the domain** (`games`, `review`, `train`, …), so a mutation can invalidate a whole domain with a prefix.
2. **IDs are reference IDs or slugs, never DB IDs** (IPA §5).
3. **Filters are one normalised object at the end.** Empty values are dropped and keys sorted, so `{theme:"fork"}` and `{phase:undefined, theme:"fork"}` share a cache entry.
4. **Viewer-scoped keys carry no user ID.** The cache is per tab and cleared at sign-out and account switch (§6.6).
5. **The same key on server and client:** pages import `qk` from `lib/api/keys.ts`, which has no client-only imports.
6. **Query definitions use `queryOptions()`** in `lib/api/queries/<domain>.ts`, so `getQueryData` and `setQueryData` are typed through the key's `DataTag`.

### 3.4 Resources, endpoints and freshness

Paths follow the area inventories. The API plan's final table wins on paths; keys and policies stay the same.

| Key | Endpoint (client refetch) | DAL (first paint) | `staleTime` | Focus refetch | Realtime updater | Prefetch / seed |
|---|---|---|---|---|---|---|
| `qk.me()` | `GET /api/me` (`private-etag`: `private, no-cache` + strong ETag) | `getMe()` | 5 min | yes (when stale) | `entitlement:changed`, `prefs:updated`, `profile:updated`, `bank:due_changed`, `notify:new` (badge), `blocks:changed` | seeded by `(app)/layout` |
| `qk.home()` | `GET /api/home` | `getHome` | 30 s | yes | `import:progress`, `analysis:done`, `analysis:batch`, `bank:due_changed`, `mistakes:added`: all through **one** `invalidateThrottled(qk.home(), 30_000)` (trailing edge; hidden tabs only mark stale) | page prefetch |
| `qk.games.list(f)` (infinite, cursor) | `GET /api/me/games?src&result&tc&moments&q&cursor&limit=30` | `listMyGames` | 60 s | yes | `games:changed` → invalidate (throttled 1 per 10 s) | first page prefetched |
| `qk.games.counts()` | `GET /api/me/games?limit=0` | same | 60 s | yes | `games:changed` | streamed block |
| `qk.review.status(ref)` | `GET /api/review/[ref]/status` (strong ETag, 304; re-kicks only through the `lastKickAt` CAS) | `getReviewStatus` | 0 | — | — (exists only as the fallback poller) | — |
| `qk.games.challenge(code)` | `GET /api/challenges/:code` | `getChallenge` | 10 s | yes | `challenge:accepted` / `:declined` | page prefetch |
| `qk.review.detail(ref)` | `GET /api/review/[ref]` (`private-etag`, strong ETag `analysisVersion.gradedPlies`; never `immutable`) | `getReview` | **∞ when `analysis.status === "done"`, else 0** | only while not complete | `analysis:progress` (ply deltas via `setQueryData`), `analysis:done` and `review:text_ready` → invalidate | page prefetch; `<Link prefetch>` on "Start review" |
| `qk.review.legend(ref)` | `GET /api/review/[ref]/legend` (pure read; may insert derived facts, never enqueues `LEGEND_COMPARE`) | `getLegendCompare` | ∞ once `READY` | no | `compare:ready` → invalidate | `prefetchQuery` on Legend tab hover is allowed because the GET is side-effect free; the engine run is `POST /api/review/[ref]/legend/compute` |
| `qk.coach.context(scope, gameRef)` (no `ply`) | `GET /api/coach/context?scope=game&gameRef` | `getCoachContext` | 60 s | no | — | prefetched when the coach panel opens. Per-ply facts and chips are computed on the client from the cached review (`buildSuggestions()` is browser-safe) or passed as an RSC prop; `ply` travels only in the CO-3 body (api-perf AP-23, P7 D20) |
| `qk.coach.thread(id)` (infinite, newest first) | `GET /api/coach/threads/:id?cursor` | `getThread` | ∞ | no | the SSE `done` appends via `setQueryData` | head page prefetched |
| `qk.train.today()` | `GET /api/train/today` | `getTrainToday` | 30 s | yes | `bank:due_changed`; outbox flush results | page prefetch |
| `qk.train.bank(f)` (infinite) | `GET /api/train/bank?view&theme&phase&source&cursor&limit=50` | `listBank` | 60 s | yes | `bank:due_changed`, `mistakes:added` → invalidate with `refetchType: "none"` | first page prefetched |
| `qk.train.session(ref)` | `GET /api/train/sessions/:ref?include=items` | `getSession` | ∞ (immutable items) | no | outbox results patch `capRemaining` | SSR seeded; IDB snapshot for offline (§7.5) |
| `qk.train.themes()` | `GET /api/train/themes` | `listThemes` | 10 min | no | — | on theme-picker open |
| `qk.train.weakness()` | `GET /api/train/weakness` (ETag) | `getWeakness` | 10 min; 0 while `computing` | yes | `weakness:progress` (`setQueryData`), `weakness:ready` → invalidate | page prefetch |
| `qk.learn.progress(scope)` | `GET /api/learn/progress?legend=\|scope=all` | `getLessonProgress` | 5 min | yes | lesson event responses | island prefetch |
| `qk.catalog.openings(q, f)` | `GET /api/openings?q&family&cursor` (`public-static`, no session read) | — | 24 h | no | — | none (debounced input). Replaces P1's `qk.catalog.openingsIndex()` from P8 |
| `qk.catalog.positions(q)` | `GET /api/positions/search` (`s-maxage=600`) | — | 5 min | no | — | none |
| `qk.search(scope, q)` | `GET /api/search?q` (public, `public-short`) or `GET /api/me/search?q` (member, `no-store`) | — | 5 min public / 30 s member | no | — | palette open → empty query `recent` |
| `qk.players.detail(u)` + `qk.players.me(u)` | `GET /api/players/:username` (public, `public-short`, no session read) + `GET /api/players/:username/me` (`no-store`: `isSelf`, `blocked`, `canChallenge`, `h2h`) | `getPlayer` | 5 min / 0 | yes | `profile:updated` (self), `blocks:changed` | page prefetch |
| `qk.players.games(u, f)` (infinite) | `GET /api/players/:username/games` | `listPlayerGames` | 60 s | yes | — | streamed block |
| `qk.tournaments.list(tab)` + `qk.tournaments.mine()` | `GET /api/tournaments?tab=&cursor` (public) + the viewer's state through TOU-7 | `listTournaments` | 30 s | yes | `tournament:updated` → invalidate | page prefetch |
| `qk.tournaments.detail(slug)` | `GET /api/tournaments/:slug` | `getTournament` | **∞ while the lobby room is joined, else 30 s** | only when not joined | `tournament:*` deltas, versioned (§5.5) | page prefetch |
| `qk.tournaments.standings(slug)` (infinite) | `GET /api/tournaments/:slug/standings?cursor` | `listStandings` | ∞ while joined | no | `tournament:standings_delta` | page 1 streamed |
| `qk.tournaments.participants(slug, q)` | `GET /api/tournaments/:slug/standings?search=` | — | 30 s | no | — | debounced (replaces 2 copies: `Leaderboard.tsx:171`, `ParticipantList.tsx:41`) |
| `qk.billing.membership()` | `GET /api/billing/membership` (DB-only, `private-etag`); **Refresh** is `POST /api/billing/refresh` | `getMembership` | 5 min | yes | `entitlement:changed` → `setQueryData` | page prefetch |
| `qk.billing.preview(plan)` | `POST /api/subscription/change-plan/preview` (read-only, cached as a query) | — | 60 s | no | — | on switch-plan modal open |
| `qk.billing.activation(sid)` | `GET /api/billing/activation?session_id&subscription_id&status` | `getActivation` | 0 | — | `entitlement:changed` → `setQueryData({state:"active"})` | SSR first state |
| `qk.accounts()` | `GET /api/accounts` | from `me.accounts` | 60 s | yes | `import:*` | SSR |
| `qk.imports()` | `GET /api/import/status` (ETag) | — | 0 | — | `import:progress` / `:finished` (`setQueryData`) | fallback poller only |
| `qk.notifications()` (infinite) | `GET /api/notifications?cursor` | — | 30 s | yes | `notify:new` (prepend) | on inbox open |
| `qk.admin.list(e, f)` | `GET /api/admin/{positions,legends,tournaments}` | DAL | 0 | yes | — | page prefetch |

Not in the query cache: live game state (§5.7), clocks, prefs (§6.3), the trainer's in-session progress (§3.6.2), and coach streaming text before `done` (§5.8).

### 3.5 Invalidation map

The legend for the effect columns:
- **set**: `setQueryData` from the response or the event, with no network call.
- **inv**: `invalidateQueries`, which refetches active queries now.
- **stale**: `invalidateQueries({ refetchType: "none" })`, which marks the data stale so it refetches on next use.
- **x-tab**: a `BroadcastChannel("rc-sync")` message that makes the other tabs mark the same keys stale.

**Mutations**

| Mutation (endpoint) | Optimistic | Response → set | inv | stale | x-tab |
|---|---|---|---|---|---|
| Grade attempts, batched (`POST /api/train/attempts`, outbox) | **yes** (§3.6.2) | `train.session(ref)` (`capRemaining`), `me.badges.bankDue` | — | `train.today`, `train.bank(*)`, `train.weakness`, `home` | yes |
| Create session (`POST /api/train/sessions`, `Idempotency-Key`) | no (the runner shows its loading state) | `train.session(newRef)` | — | `train.today` | — |
| Extend session (`POST /api/train/sessions/:ref/extend`) | no (prefetched 2 items early) | append to `train.session(ref).items` | — | — | — |
| End session (`POST /api/train/sessions/:ref/end`) | no | — (the summary RSC reads it) | — | `train.*`, `home` | yes |
| Skip card (`POST /api/train/cards/:ref/skip`) | **yes** (row leaves the list) | — | — | `train.today` | yes |
| Remove from bank (`DELETE /api/train/cards/:ref`) | **yes**, with an Undo toast; **committed after 6 s** | — | — | `train.*`, `home`, `me` | yes |
| Toggle a moment in or out of the bank (`PATCH /api/review/:ref/moments/:id`) | **yes** (§3.6.1) | `review.detail(ref)` moment `inBank` and `card.dueAt` | — | `train.bank(*)`, `train.today`, `home` | yes |
| Queue or retry analysis (`POST /api/review/[ref]/analyse`) | `analysis.status = "queued"` | `review.detail(ref).analysis` | — | `review.status(ref)` | — |
| Review progress (`PATCH /api/review/:ref/progress`, `keepalive`) | fire-and-forget | — | — | — | — |
| Complete review (`POST /api/review/:ref/complete`) | no | `review.detail(ref).progress.completedAt` | — | `train.*`, `home`, `games.list(*)` | yes |
| Share review (`POST /api/review/[ref]/shares`) / toggle or revoke (`PATCH`/`DELETE /api/shares/:code`) | revoke: yes | `review.detail(ref).share` | — | — | — |
| Ask the coach (`POST /api/coach/messages`, SSE) | user bubble appears at once (local) | `done` → append both messages to `coach.thread(id)` | — | `me` (quota label) | — |
| Rate a coach answer (`POST /api/coach/messages/:id/rate`) | yes | `coach.thread(id)` message `rating` | — | — | — |
| Prefs (`PATCH /api/me/preferences`, debounced 400 ms) | **local-first** (§6.3) | `me.prefs` + `version` | — | — | via `prefs:updated` |
| Onboarding step (`PATCH /api/me/onboarding`) | navigate at once | `me.user.onboarding*` | — | — | — (then `session.reload()` on complete) |
| Profile edit (`PATCH /api/me/profile`) | no (form) | `me.user`, `players.detail(username)` | — | `players.games(*)` | yes |
| Chess.com lookup (`POST /api/accounts/chesscom/lookup`) | n/a (a read posed as POST) | form state only | — | — | — |
| Link Chess.com (`POST /api/accounts/chesscom`) / Lichess OAuth return | no | `accounts`, `me.accounts`, `imports` | — | `home`, `games.*` | yes |
| Unlink (`DELETE /api/accounts/:provider`) | no (confirm dialog) | `accounts`, `me.accounts` | — | `games.*` | yes |
| Retry import (`POST /api/import/:ref/retry`) | status → `QUEUED` | `imports` | — | — | — |
| Start checkout (`POST /api/checkout`) | no | — (navigates to Dodo) | — | — | — |
| Cancel, resume or change plan (`POST /api/subscription/*`) | no (money) | **`billing.membership` and `me.entitlement` from the response DTO** (no refetch; today `MembershipSection.tsx:184` refetches) | — | — | yes |
| Create a bot or legend-bot game (`POST /api/games`, `Idempotency-Key` in `sessionStorage`) | no | `usePendingBoard` (FEN for the next route's skeleton) | — | — | — |
| Bot checkpoint (`POST /api/games/:ref/checkpoint`, `sendBeacon`) | fire-and-forget | — | — | — | — |
| Bot complete (`POST /api/games/:ref/complete`) | no | `review.status(ref)` | — | `games.list(*)`, `games.counts`, `home` | yes |
| Create a challenge (`POST /api/challenges`) | no | `games.challenge(code)` | — | — | — |
| Accept, decline or cancel a challenge | no | — (accept navigates) | — | `games.challenge(code)` | — |
| Share position (`POST /api/shared-positions`) / revoke | revoke: yes | — | — | — | — |
| Join a tournament (`POST /api/tournaments/:slug/join`) | **no** (capacity is decided by the server) | `tournaments.detail(slug)` (your row) | — | `tournaments.list(*)` | — |
| Mark notifications read (`POST /api/notifications/read`) | yes | `notifications`, `me.badges.notificationsUnread` | — | — | yes |
| Consent (`PUT /api/me/consent`) | yes (cookie set client-side too) | — | — | — | — |
| Push subscription (`POST`/`DELETE /api/push/subscriptions`) | no | `me.prefs.notifications` | — | — | — |
| Report a problem (`POST /api/reports {targetType}`, `POST /api/feedback`) | yes (the item is skipped) | — | — | — | — |
| Lesson progress (`POST /api/learn/lessons/:slug/progress`, outbox) | yes | `learn.progress(*)` | — | `train.today` | — |
| Delete account (`DELETE /api/me`) | no | → `signOutEverywhere()` (§6.6) | — | — | yes |
| Admin CRUD (`/api/admin/*`) | no | the row in `admin.list(*)` | `admin.list(entity, *)` | — | — |

**Socket events.** §5.6 lists every user-room event and the key it touches. **Reconnect resync (api-perf AP-25):** on reconnect the client compares the new `session:hello {bootId, useq}` with what it last saw. Only when `bootId` changed or `useq` skipped does it mark `me`, `home`, `train.today`, `imports` and any non-complete `review.detail` stale (`refetchType: "active"`); otherwise nothing was missed and no GET is sent. On flaky mobile networks this removes 3–5 GETs per reconnect.

### 3.6 Optimistic updates

**Which writes are optimistic:**
- **Always:** bank membership toggles, skip, remove (with Undo), puzzle grades, prefs, notification read, revokes, coach rating.
- **Never:**
  - anything with money (checkout, plan changes, cancel);
  - anything with capacity or another party (tournament join, challenge accept, matchmaking);
  - anything that creates a server ID the next screen needs (create game, create session);
  - account deletion.

#### 3.6.1 Typical optimistic mutation: toggle a key moment into the Mistake Bank (`V3KeyMoments`)

```ts
// lib/api/mutations/review.ts
export function useToggleMomentInBank(ref: string) {
  const qc = useQueryClient();
  const reviewKey = reviewQuery(ref).queryKey;                     // typed DataTag key
  return useMutation({
    mutationKey: ["review", ref, "bank-toggle"],
    scope: { id: `review:${ref}:bank` },                           // toggles for this review run one after another
    meta: { errorUi: "toast" },
    mutationFn: ({ momentId, inBank }: { momentId: string; inBank: boolean }) =>
      api(endpoints.reviewMoment(ref, momentId), { method: "PATCH", body: { inBank }, schema: MomentBankOut }),
    onMutate: async ({ momentId, inBank }) => {
      await qc.cancelQueries({ queryKey: reviewKey });             // no in-flight refetch may overwrite the optimistic state
      const previous = qc.getQueryData(reviewKey);
      qc.setQueryData(reviewKey, (d) =>
        d && { ...d, moments: d.moments.map((m) => (m.id === momentId ? { ...m, inBank } : m)) });
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(reviewKey, ctx.previous);  // rollback
      // the error toast "Failed to update Mistake Bank" + Retry comes from reactToApiError (meta.errorUi)
    },
    onSuccess: (out, { inBank }) => {
      qc.setQueryData(reviewKey, (d) =>
        d && { ...d, moments: d.moments.map((m) => (m.id === out.momentId ? { ...m, inBank: out.inBank, card: out.card } : m)) });
      if (inBank && out.card) notify.success(`Added to Mistake Bank · next review ${out.card.dueLabel}`); // V3Toasts copy
    },
    onSettled: () => {
      for (const key of [qk.train.all(), qk.home()]) qc.invalidateQueries({ queryKey: key, refetchType: "none" });
      crossTab.stale([qk.train.all(), qk.home()]);
    },
  });
}
```

#### 3.6.2 Puzzle and bank grades: optimistic through the outbox (`V3BankSession`, `V3PuzzleSolve`)

This follows IRB §4.5.

1. Moves are checked **locally** against `TrainItem.solution` / `accept` with chess.js. No network is involved.
2. On the graded state, build an `AttemptIn` with `clientAttemptId = crypto.randomUUID()` and `cardReps` for optimistic concurrency.
3. `outbox.enqueue(attempt)` writes to IndexedDB, then `runner.advance()` runs immediately. The next board was pre-parsed and rendered offscreen, so the transition takes under 16 ms.
4. Locally:
   - decrement `me.badges.bankDue` (`setQueryData`);
   - show the FSRS preview label from `TrainItem.preview` (no server needed for "Back in 4 days");
   - when 2 items remain in a `PUZZLES` session, fire `extend`.
5. Flush (§7.4). `AttemptOut` patches the rating chip ("Rating 1524 +12"), the streaks, the theme milestone toast, `capRemaining` and `planDone`.
6. Statuses:
   - `duplicate` → drop;
   - `conflict` (another tab already reviewed the card) → drop silently and send an analytics event;
   - `rejected` with 402 → stop the session, then `reactToApiError` (paywall).

```ts
// features/train/useGrade.ts
export function useGrade(session: SessionPayload) {
  const qc = useQueryClient();
  const me = useMe();
  return async (item: TrainItem, result: AttemptResult) => {
    const attempt: AttemptIn = toAttempt(session.ref, item, result);     // pure
    await outbox.enqueue(me.user.referenceId, "attempts", attempt);       // durable first
    runner.getState().advance();                                          // optimistic UI
    if (item.cardRef && result.solved)
      qc.setQueryData(qk.me(), (m) => m && { ...m, badges: { ...m.badges, bankDue: Math.max(0, m.badges.bankDue - 1) } });
    void outbox.flush(me.user.referenceId, qc);                           // fire-and-forget; retries itself (§7.4)
  };
}
```

#### 3.6.3 Settings toggles

Prefs are **local-first**: `usePrefs.set()` applies at once. Board CSS variables and sounds react in the same frame. The change is batched (400 ms) into one `PATCH /api/me/preferences`.

| PATCH result | Pill text | Action |
|---|---|---|
| success | "SAVED · SYNCED" | none |
| failure | "Saved on this device · Couldn't sync [Retry]" | **no rollback**: the setting still works locally. Retry with backoff ×3, then again on `online` and on the next boot (IAC §3.0.1). |

`scope: { id: "prefs" }` serialises the PATCHes.

#### 3.6.4 Optimistic socket offers and "Sync now" (api-perf §2.8)

The designs show these states at once; a US player otherwise waits one round trip to Mumbai (≈ 250 ms).

| Interaction | Design state | Optimistic step | Rollback |
|---|---|---|---|
| Offer a draw (P2) | `draw_sent` ("Draw offered") | `store.drawOffer = { by: you, pending: true }` before emitting `draw:offer` | negative ack (`phase`, `draw_cooldown` with `canOfferAtPly`) → remove it and show the cooldown toast |
| Offer a rematch (P2) | `over_rematch_sent` | set the offer locally with an estimated expiry | the ack's `expiresAt` replaces the estimate; a negative ack removes it |
| "I'm ready" in study (P2) | own bar "Ready" | flip your own `ready` locally; the opponent's comes from `study:ready` | negative ack → unset |
| Decline or cancel a draw or rematch | the offer card disappears | remove locally | re-insert on a negative ack |
| Connected accounts "Sync now" (P4 ACC-4) | `syncing` row | flip the row to `syncing` in `onMutate` | `429 rate_limited {source}` → restore the row and show the countdown |
| Tournament "Find match" (P12), notifications "mark all read" | — | already optimistic in their specs | — |

### 3.7 Error and retry policy

`ApiError.code` (§4.2) decides the behaviour. **Queries and mutations never retry a 4xx.**

| Class (codes) | Query retry | Mutation retry | UI (see §4.5 for toasts) |
|---|---|---|---|
| `network`, `timeout` | 2× (1 s, 3 s, ±25 % jitter) | idempotent with a key → 1×; outbox → queued; otherwise none | offline chip if `onlineManager` says offline; inline `ErrorState` if no data; error toast for mutations |
| `offline` (detected before sending) | paused by `networkMode: "online"`, resumes on reconnect | outbox → queued; others are disabled in the UI ("Needs a connection") | `OfflineChip`; disabled controls get `aria-describedby` |
| `internal` (500) | 2× | idempotent → 1× | `ErrorState` with the event ID (`requestId`), as in `V3Error500` `default → retrying → failed_again` |
| `upstream_unavailable` (502) | 1× after 2 s | none | inline, naming the provider (`V4SettingsConnectedError`, `V3OnbLink` `rate_limited`) |
| `maintenance` (503) | none | none | `system.notice` set → maintenance banner, or a middleware rewrite to `/maintenance` |
| `rate_limited`, `fair_use_limit` (429) | none; `refetch` scheduled after `retryAfterSec` | none | `RateLimitedInline` countdown (`V3RateLimited inline → inline_ready`); coach → `ratelimit` state |
| `unauthorized` (401) | none → session flow (§4.4) → refetch after the silent refresh succeeds | after the refresh succeeds: retry 1× if idempotent | `V3SessionExpired` |
| `subscription_required`, `subscription_required {reason}`, `payment_update_required` (402) | none | none | redirect by code (§4.4), or inline when `meta.paywall === "inline"` |
| `forbidden` (403), `not_found` (404), `gone` (410) | none | none | `notFound()` on pages; inline `EmptyState` / `ErrorState` in islands |
| `conflict`, `already_*`, `in_flight`, `version_mismatch` (409, 412) | none | none; a per-mutation `onError` handles it | specific copy (e.g. 409 `already_subscribed` → refresh `me`, go to membership) |
| `validation_failed` (400, 422) | none (it is a bug) → Sentry | none | field errors from `fields`/`details` |
| `contract_mismatch` (client) | none → Sentry with the zod issues | none | `ErrorState` |
| `aborted` | ignored | ignored | none |

```ts
// lib/api/errors.ts (excerpt)
export const retryQuery = (failureCount: number, err: unknown) => {
  if (!(err instanceof ApiError)) return failureCount < 2;
  if (err.code === "upstream_unavailable") return failureCount < 1;
  return (err.code === "network" || err.code === "timeout" || err.code === "internal") && failureCount < 2;
};
export const retryDelay = (attempt: number, err: unknown) =>
  err instanceof ApiError && err.retryAfterSec ? err.retryAfterSec * 1000
  : Math.min(1000 * 3 ** attempt, 8000) * (0.75 + Math.random() * 0.5);
```

### 3.8 Prefetching

Every prefetch of a **dynamic** route renders on Vercel, so it costs an invocation. Prefetching is therefore driven by **intent**, not by the viewport.

| Trigger | What | How | Cost |
|---|---|---|---|
| Links to static or ISR pages (marketing, catalogue, blog) | the RSC payload | default `<Link>` viewport prefetch | CDN, free |
| Nav rail, tab bar and in-app links to member pages | the layout and `loading.tsx` skeleton (partial prefetch) | `AppLink` = `<Link prefetch={false}>` plus `router.prefetch(href)` on `pointerenter` after an 80 ms dwell (only with `pointer: fine`), `touchstart`, and `focus` | ≤ 1 invocation per hovered target per 30 s (router cache) |
| Highly likely next click: game-over "Start review", Home "Continue", Match found → game | the full RSC with data | `<Link prefetch>` (full) / `router.prefetch` | 1 invocation, almost always used |
| Match found (`queue:matched`) | game snapshot + route | write `usePendingBoard({ref, fen, orientation})`, `router.prefetch('/game/'+ref)`, then navigate immediately. The `V3MatchFound` countdown plays **on the game screen**, which removes the fixed 1.5 s delay at `app/queue/page.tsx:55-62`. | 1 |
| Review "Legend" tab hover or focus | `qk.review.legend(ref)` | `qc.prefetchQuery(legendQuery(ref))`: allowed only because REV-9 is side-effect free; a prefetch is a plain fetch, so it must never hit a route that enqueues work | 1 |
| Coach panel open (desktop side panel, phone sheet) | `qk.coach.context(scope, gameRef)` (no `ply`), thread head | `prefetchQuery` on the open button's `pointerenter` | 1 |
| Infinite lists (games archive, bank, standings, notifications) | the next page | an `IntersectionObserver` sentinel with `rootMargin: "600px"` → `fetchNextPage()`; `maxPages: 10` bounds memory | 1 per page |
| Puzzle stream | the next 10 items | `extend` when 2 items remain (IRB W3) | 1 |
| Daily drill (offline readiness) | the next `DAILY` session payload | saved to IndexedDB after the first Train hub render of the day (§7.5) | 1/day |
| Bot tab, Practice, Review engine panel hover | the Stockfish glue + WASM from R2 (`NEXT_PUBLIC_ENGINE_BASE_URL`, hashed, immutable, CORS) through the same-origin worker shim | `<link rel="prefetch" as="fetch" crossorigin>` injected on intent | R2, free |
| Sound files | 10 audio files | fetched on the first user gesture, not on mount (`useChessSound.ts:39-51` today) | CDN |

### 3.9 Lists and pagination

- Cursor format: `?cursor=<opaque>&limit≤50`, response `meta.nextCursor` (AA F-19). The client uses `useInfiniteQuery({ initialPageParam: null, getNextPageParam: (last) => last.meta.nextCursor ?? undefined, maxPages: 10 })`.
- **Filters live in the URL** (D8) and in the key. A filter change uses `placeholderData: keepPreviousData`: the old rows stay dimmed (`aria-busy`) and the region shows a hairline after 200 ms. It never blanks into a skeleton.
- Lists that grow past about 200 rows (games archive, standings in big arenas) get `@tanstack/react-virtual` inside their own scroll panel (DS "only long lists scroll, inside their own panel").

### 3.10 Search inputs

- Debounce: 200 ms for catalogue searches, 250 ms elsewhere (IRB R7, IPA §5).
- `enabled: q.length >= 2`.
- `signal` from the query function, so stale requests are aborted. This fixes the out-of-order results in `Leaderboard.tsx:171` and `PositionPageClient.tsx:55-84`.
- `placeholderData: keepPreviousData`.
- Public scopes are CDN-cached, so repeated terms are free.

---

## 4. Typed API client

### 4.1 Files

| File | Role |
|---|---|
| `packages/contracts/src/http.ts` | the envelope, `ErrorCode`, the `Cursor` meta; shared with route handlers (`lib/api/route.ts`, AA §7.1) |
| `packages/contracts/src/<domain>.ts` | zod request and response schemas (`ReviewPayload`, `BankPage`, `AttemptIn`/`AttemptOut`, `Me`, …), imported by routes, the DAL tests and the client |
| `apps/web/lib/api/client.ts` | `api()`, the fetch wrapper |
| `apps/web/lib/api/errors.ts` | `ApiError`, `retryQuery`, `retryDelay`, `reactToApiError` |
| `apps/web/lib/api/endpoints.ts` | the path registry (the one place a rename happens) |
| `apps/web/lib/api/keys.ts` | `qk` (§3.3) |
| `apps/web/lib/api/queries/*.ts`, `mutations/*.ts` | `queryOptions` definitions and `useXxx` hooks per domain |
| `apps/web/lib/api/legacy.ts` | adapter for today's `{success,data}`, `{error,code}` and raw billing shapes; deleted after the last route migrates (tracked by a Sentry tag `legacy_envelope`) |
| `apps/web/lib/navigation/bridge.tsx` | `NavigationBridge`, which exposes the App Router `router` to non-React code (`reactToApiError`) |

### 4.2 Envelope and the error ledger

Success is `{ data, meta? }`. Failure is `{ error: { code, message, details?, retryAfterSec?, requestId } }`. The HTTP status always matches the code; each code has exactly one status. The list is the ledger in **`packages/contracts/src/http/codes.ts`** (`03-api-design.md` §2.6, `01-architecture.md` CR-18). `Retry-After` is also sent as a header on 429 and 503.

| HTTP | `code` | Client reaction (default) |
|---|---|---|
| 400 | `invalid_json`, `validation_failed` (`details.issues`, `details.reason`) | form fields; Sentry |
| 401 | `unauthorized` | session flow (§4.4) |
| 402 | `subscription_required` with `details.reason` = `trial_available` \| `trial_used` | → `/pricing?reason=required&redirect_url=<current>` (`paywallUrl`, `lib/billing/client.ts:43`), or `/onboarding` if not onboarded |
| 402 | `subscription_required` with `details.reason` = `expired` \| `payment_failed` \| `paused` | → `/pricing?reason=ended&redirect_url=…`, or the inline renew state if the owner adopts lapsed read-only access (B26; GETs then pass) |
| 402 | `payment_update_required` | → `/settings/membership?issue=payment` (`V3PaymentFailed`) |
| 403 | `forbidden`, `reverification_required` | inline or 404 page (privacy masking); Clerk `useReverification()` then retry |
| 404 / 410 | `not_found` / `gone` | entity 404 (`V3Error404 missing_game`), or the host screen's expired state |
| 409 | `conflict` (`details.reason` from `CONFLICT_REASONS`), `in_flight` (`retryAfterSec`) | per-mutation `onError` |
| 412 | `precondition_failed` | refetch, then re-apply |
| 413 | `payload_too_large` | Sentry |
| 422 | `idempotency_key_reused`, `illegal_position`, `illegal_moves` | bug / inline |
| 426 | `upgrade_required` | `V3PwaUpdate` (deferred in a game) |
| 429 | `rate_limited` (`details.source`), `fair_use_limit` | inline countdown from `retryAfterSec`; mutations never auto-retry (the outbox honours `Retry-After`) |
| 502 | `upstream_unavailable` (`details.provider`, `details.kind`) | inline, naming the provider |
| 503 | `maintenance`, `not_configured` | maintenance notice |
| 500 | `internal` | `ErrorState` / toast with `requestId` as the event ID |
| client | `network`, `timeout`, `offline`, `aborted`, `contract_mismatch` (dev and test only) | §3.7 |

### 4.3 `api()` (the one implementation; P1 §7.12)

```ts
// apps/web/lib/api/schema.ts
export const devSchema = <T>(s: T): T | undefined =>
  (process.env.NODE_ENV === "production" ? undefined : s);   // the minifier drops the branch and the import

// apps/web/lib/api/client.ts
import type { ApiErrorCode } from "@repo/contracts/http/codes";   // type-only: no runtime import of zod

export async function api<T>(path: string, init: ApiInit<T> = {}): Promise<T> {
  const url = withQuery(path, init.query);
  const method = init.method ?? "GET";
  if (!onlineManager.isOnline() && method !== "GET") throw new ApiError({ status: 0, code: "offline" });

  const timeout = AbortSignal.timeout(init.timeoutMs ?? DEFAULT_TIMEOUT_MS);   // 15 s
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  const headers: Record<string, string> = { Accept: "application/json", "x-rc-build": BUILD_ID };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.idempotencyKey) headers["Idempotency-Key"] = init.idempotencyKey;

  let res: Response;
  try {
    res = await fetch(url, { method, headers, signal, keepalive: init.keepalive, credentials: "same-origin",
                             body: init.body === undefined ? undefined : JSON.stringify(init.body) });
    // GETs use the browser HTTP cache transparently: `private-etag` routes send `private, no-cache` + a strong
    // ETag, so the browser revalidates (304) and hands us the cached 200. There is no `ifNoneMatch` option and no
    // `notModified` result: TanStack Query v5 rejects `undefined` data.
  } catch {
    if (init.signal?.aborted) throw new ApiError({ status: 0, code: "aborted" });
    if (timeout.aborted) throw new ApiError({ status: 0, code: "timeout" });
    throw new ApiError({ status: 0, code: onlineManager.isOnline() ? "network" : "offline" });
  }

  const requestId = res.headers.get("x-request-id") ?? undefined;
  breadcrumb("api", { path, status: res.status, requestId });
  if (res.status === 204) return undefined as T;
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) throw toApiError(res, json, requestId);
  const data = (json as { data: T }).data;

  if (init.schema) {                                  // only ever set through devSchema(): dev and test builds
    const parsed = init.schema.safeParse(data);
    if (!parsed.success) {
      reportContractMismatch(path, parsed.error.issues, requestId);
      throw new ApiError({ status: res.status, code: "contract_mismatch", requestId });
    }
  }
  return data;
}

// call site: api<MeData>(endpoints.me, { schema: devSchema(MeData) })
```

Rules:
- **Every call site passes its schema through `devSchema()`.** An imported schema object passed as a plain argument is referenced, so tree-shaking keeps it and zod with it (several kB gz, plus every schema module the page imports); `sideEffects: false` only drops unreferenced modules (api-perf AP-12). CI asserts `ZodError` is absent from production chunks outside the form chunks listed in `scripts/check-bundle-budgets.mjs`; forms that validate on the client import `zod/mini` (≈ 2 kB).
- Socket frame validation lives in a module loaded with a dynamic `import()` behind `if (process.env.NODE_ENV !== "production")`.
- Retries: GETs retry twice on network/5xx with backoff, never on 4xx; mutations never retry automatically except through the outbox (§7.4).

```ts
/** For non-JSON success paths (SSE): turn a failed Response into an ApiError. */
export async function readApiError(res: Response): Promise<ApiError> {
  return toApiError(res, await res.json().catch(() => null), res.headers.get("x-request-id") ?? undefined);
}
```
### 4.4 Global reactions: `reactToApiError`

```ts
// apps/web/lib/api/errors.ts (excerpt)
type Ctx = { kind: "query" | "background" | "mutation" | "stream" | "outbox"; meta?: Record<string, unknown> };

export function reactToApiError(err: unknown, ctx: Ctx) {
  if (!(err instanceof ApiError)) return captureUnknown(err);
  switch (err.code) {
    case "aborted": return;
    case "unauthorized": return sessionGuard.onUnauthenticated();            // below
    case "subscription_required":                                           // details.reason picks required vs ended (B26)
    case "payment_update_required":
      if (ctx.meta?.paywall === "inline") return;                           // coach `paywall` state renders itself
      return navigation.replace(paywallTarget(err.code, err.details?.reason, currentAppPath()));  // one place instead of 16
    case "maintenance": return systemNotice.set({ kind: "maintenance_active", retryAfterSec: err.retryAfterSec });
    case "rate_limited":
    case "fair_use_limit": return;                                                 // always inline (RateLimitedInline)
    case "internal":
    case "contract_mismatch": captureApiError(err); break;
  }
  if (ctx.kind === "mutation" && ctx.meta?.errorUi !== "inline") notify.error(mutationErrorCopy(ctx.meta), {
    id: `err:${String(ctx.meta?.object ?? "action")}`,                      // dedupe within 2 s
    action: ctx.meta?.retry ? { label: "Retry", onClick: ctx.meta.retry as () => void } : undefined,
  });
  // queries: inline ErrorState when there's no data; background errors are silent (data stays, Sentry breadcrumb only)
}
```

**Session flow (`sessionGuard`, `V3SessionExpired`, IS §3.7)**

1. On the first 401, run `await window.Clerk?.session?.reload()`. On success, invalidate the active queries that failed and retry pending idempotent mutations.
2. Still 401 → `overlays.request("session_expired")`:
   - on immersive game routes, a chip only (`in_game_refresh` → `in_game_ok`), with retries every 3 s for up to 2 min, while moves keep working on the live socket;
   - elsewhere, the blocking modal (`modal` → `signing_in`).
3. Drafts (coach input, forms) are saved to `sessionStorage["rc.draft.<route>"]` before navigating to `/sign-in?redirect_url=<path+query>`. Today's code drops the query string (`useRequireAuth.ts:89`).
4. `BroadcastChannel("rc-auth")` fans the state out to the other tabs.

### 4.5 Toast policy

Toasts use sonner through `lib/notify.ts`, styled per `V3Toasts`.

| Situation | Toast? | Type / duration | Notes |
|---|---|---|---|
| Query, first load fails | **no** | — | inline `ErrorState` in its region |
| Query, background refetch fails | **no** | — | stale data stays; Sentry breadcrumb |
| Mutation fails | **yes**, unless `meta.errorUi = "inline"` (forms, checkout, lookups, coach) | Error, 8 s, stays while hovered, one **Retry** | "Failed to <verb> <object>", object first, no trailing period |
| Designed success | yes | Success 3 s / Achievement 6 s / With undo 6 s | only copy that exists on a board: "Added to Mistake Bank · next review tomorrow", "Removed from Mistake Bank" + Undo, interval ("Back in 4 days"), milestones, "Link copied" |
| Generic success ("Saved") | **no** | — | use inline state (settings pill, button label) |
| 401 | no | — | modal or chip |
| 402 | no | — | redirect or inline paywall |
| 429 | no | — | inline countdown |
| 503 maintenance | no | — | banner or chip |
| Offline / back online | no | — | `OfflineChip` (`role=status`) |
| Game events (opponent disconnected, draw declined, move not accepted) | yes, **text only, never over the board** | Warning 8 s (notify sound) / Info 3 s | phones: bottom centre above the action bar, one at a time |
| Server-originated (`notify:new` with `toast`, mutation `toasts[]`) | yes | as sent | dedupe by ID |

Rules (V3Toasts, IS §3.13):
- Desktop and tablet: at most 3, top right, below the header row (`--toast-top`).
- Phone: 1, at `--toast-bottom`.
- Dedupe identical text within 2 s.
- Lint: no trailing period, no "!", at most 90 characters.
- Errors use `role=alert`; the others use `role=status`.

### 4.6 Writes that must survive unload

| Write | Mechanism |
|---|---|
| Bot game checkpoint | `navigator.sendBeacon(endpoints.gameCheckpoint(ref), Blob(JSON, "text/plain"))` on `pagehide` / `visibilitychange:hidden` (IPA §2.4) |
| Review walkthrough progress | `api(..., { method:"PATCH", keepalive:true })`, batched every 10 s and on `pagehide` |
| Outbox flush on hide | `keepalive: true` when the body is under 60 KB |
| Lesson resume point | outbox (§7.4), throttled to every 5 plies or `pagehide` |

Matchmaking `sendBeacon` cancels (`app/queue/page.tsx:148,161`) are **deleted**. The queue lives on the socket and is cancelled on disconnect (IPA §2.3).

---

## 5. Realtime

### 5.1 One connection manager

```ts
// apps/web/lib/realtime/connection.ts
import { io, type Socket } from "socket.io-client";
import type { ServerEvents, ClientCommands, Ack } from "@repo/protocol/events";

export type ConnState = "idle" | "connecting" | "live" | "reconnecting" | "offline" | "unauthorized" | "upgrade_required";
type Hold = "user" | "game" | "queue" | "lobby" | "activation" | "review";
const CRITICAL: ReadonlySet<Hold> = new Set(["game", "queue", "activation"]);   // never disconnected for being hidden
const HIDDEN_DISCONNECT_MS = 5 * 60_000;

class RealtimeConnection {
  private socket: Socket<ServerEvents, ClientCommands> | null = null;
  private state: ConnState = "idle";
  private lastLiveAt = 0;
  private readonly listeners = new Set<() => void>();
  private readonly holds = new Map<Hold, number>();
  private readonly rejoin = new Map<string, () => Promise<void>>();   // room key → join command (game:join, lobby:join…)
  private hiddenTimer: ReturnType<typeof setTimeout> | null = null;
  private token: { token: string; exp: number } | null = null;

  constructor(private cfg: { url: string; buildId: string; fetchToken: () => Promise<{ token: string; exp: number } | null> }) {}

  seedToken(t: { token: string; exp: number }) { this.token = t; }   // from (app)/layout (no HTTP round trip)

  /** Ref-counted; the first hold connects, the last release lets the socket idle. */
  acquire(reason: Hold): () => void {
    this.holds.set(reason, (this.holds.get(reason) ?? 0) + 1);
    this.ensure();
    return () => {
      const n = (this.holds.get(reason) ?? 1) - 1;
      if (n <= 0) this.holds.delete(reason); else this.holds.set(reason, n);
      if (this.holds.size === 0) this.disconnect();
    };
  }

  /** Persistent room membership: re-run after every (re)connect; returns a leave function. */
  room(key: string, join: () => Promise<void>, leave: () => void): () => void {
    this.rejoin.set(key, join);
    if (this.state === "live") void join();
    return () => { this.rejoin.delete(key); if (this.state === "live") leave(); };
  }

  /** Registers a handler without connecting; holds (acquire) decide when the socket is up. */
  on<E extends keyof ServerEvents>(event: E, fn: ServerEvents[E]): () => void {
    const s = this.build();
    s.on(event, fn as never);
    return () => { s.off(event, fn as never); };
  }

  /** Commands always use acks with a timeout; a timeout is an error the caller maps to `server_error`. */
  async command<C extends keyof ClientCommands>(name: C, payload: Parameters<ClientCommands[C]>[0], timeoutMs = 5000): Promise<Ack<C>> {
    if (!this.socket || this.state !== "live") throw new RealtimeError("not_connected");
    return (this.socket.timeout(timeoutMs) as any).emitWithAck(name, payload);   // rejects on timeout
  }

  getState = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  isLive = () => this.state === "live";
  liveGapMs = () => (this.lastLiveAt ? Date.now() - this.lastLiveAt : Infinity);

  /** Connects if any hold exists and the socket is neither connected nor already retrying. */
  private ensure() {
    const s = this.build();
    if (!s.connected && !s.active) { this.set("connecting"); s.connect(); }
  }

  /** Creates the socket once (autoConnect: false) and wires the lifecycle handlers. */
  private build(): Socket<ServerEvents, ClientCommands> {
    if (this.socket) return this.socket;
    const s: Socket<ServerEvents, ClientCommands> = io(this.cfg.url, {
      autoConnect: false,
      transports: ["websocket", "polling"],      // OCI serves WS directly; polling only if WS fails
      tryAllTransports: true,
      reconnectionDelay: 500, reconnectionDelayMax: 5000, randomizationFactor: 0.5,
      timeout: 10_000,
      auth: (cb) => void this.freshToken().then((t) => cb({ token: t?.token, proto: 2, build: this.cfg.buildId })),
    });
    s.on("connect", () => {
      const gap = this.liveGapMs();
      this.set("live"); this.lastLiveAt = Date.now();
      for (const join of this.rejoin.values()) void join();     // snapshot resync per room (§5.5)
      resyncCaches(gap);                                         // invalidates keys that may have missed events (§3.5)
    });
    s.on("disconnect", (reason) => {
      this.lastLiveAt = Date.now();
      if (reason === "io server disconnect") { void this.freshToken(true).then(() => s.connect()); }  // server kicked: new token
      this.set(navigator.onLine ? "reconnecting" : "offline");
    });
    s.on("connect_error", (err) => {
      if (err.message === "upgrade_required") return this.set("upgrade_required");       // → V3PwaUpdate `ready`
      if (err.message === "unauthorized") {
        this.token = null;
        if (!s.active) return void retryUnauthorized(s, () => this.set("unauthorized"));  // 1 s, 2 s, 4 s (useSocketToken.ts:96-135)
      }
      this.set(navigator.onLine ? "reconnecting" : "offline");
    });
    window.addEventListener("online", () => { if (this.holds.size && !s.connected) s.connect(); });  // skip the remaining backoff
    document.addEventListener("visibilitychange", () => this.onVisibility());
    this.socket = s;
    return s;
  }

  private onVisibility() {
    if (document.hidden) {
      const critical = [...this.holds.keys()].some((h) => CRITICAL.has(h));
      if (!critical) this.hiddenTimer = setTimeout(() => this.socket?.disconnect(), HIDDEN_DISCONNECT_MS);
    } else {
      if (this.hiddenTimer) clearTimeout(this.hiddenTimer);
      if (this.holds.size && this.socket && !this.socket.connected) this.socket.connect();
    }
  }

  private async freshToken(force = false) {
    const now = Date.now() / 1000;
    if (!force && this.token && this.token.exp - 120 > now) return this.token;   // refresh 2 min before exp (IPA §2.2)
    this.token = await this.cfg.fetchToken();                                     // GET /api/socket-token (402 for non-members)
    return this.token;
  }
  private disconnect() { this.socket?.disconnect(); this.set("idle"); }
  private set(s: ConnState) { if (this.state !== s) { this.state = s; this.listeners.forEach((l) => l()); } }
}

export let realtime: RealtimeConnection;   // created once by <RealtimeBoot>
export const useConnection = () => useSyncExternalStore(realtime.subscribe, realtime.getState, () => "idle" as ConnState);
```

**Rules**

- `<RealtimeBoot>` (in `(app)/layout`) creates the singleton and seeds the token. **It does not connect**: the first `acquire()` does.
  - `UserChannel` acquires `"user"` on member pages. A user tab therefore holds one socket, and game pages reuse it: the user room and the game room share the connection (IS §2.6).
- **Token**:
  - minted in the layout render (`mintSocketToken`);
  - refreshed through `GET /api/socket-token` 2 min before `exp`, on `io server disconnect` and on `unauthorized`;
  - always sent; the unauthenticated path is removed (AS F-02, IPA §2.2);
  - claims `{sub, exp, env, ent, kid}`;
  - an `entitlement:changed` event forces a refresh.
- **Backoff** is socket.io's own (0.5 s → 5 s, jitter 0.5, unlimited). The UI shows `reconnecting` immediately on board pages. After 25 s it adds "Reload game", which calls `game:sync`, then a hard reload if that fails (AS §17.9.6).
- **Hidden tabs** disconnect after 5 min unless a critical hold exists (game, queue, activation), and reconnect on `visible`. This saves 1-OCPU socket capacity on OCI (AS §11).
- **Sign-out:** `realtime.destroy()` + `clearSocketToken()` (§6.6). Today the token survives sign-out (`useSocketToken.ts:32,81`).
- **Protocol version:** the handshake carries `proto: 2`. `connect_error "upgrade_required"` → the `V3PwaUpdate` flow (§7.6).

### 5.2 Connection states and what the UI shows

| `ConnState` | Board pages (`V3Game`) | Elsewhere |
|---|---|---|
| `connecting` (first) | `loading` (before the `game:join` ack); the board is already drawn from the snapshot | nothing |
| `live` | normal | nothing |
| `reconnecting` | `reconnecting`: **the board locks**, at most 1 queued move (ghost), own grace "Reconnect within 0:18" computed locally; then `reconnected` "Back online. Bxd7+ was sent." | nothing for 3 s, then hide realtime-only affordances (live dots) |
| `offline` | as `reconnecting` + `OfflineChip` | `OfflineChip`; disabled "Needs a connection" controls |
| `unauthorized` | `in_game_refresh` chip | session flow (§4.4) |
| `upgrade_required` | chip "Update ready · installs after this game" | `V3PwaUpdate ready` |

### 5.3 Rooms

P2 owns them (`CT/socket/rooms.ts`, `01-architecture.md` CR-13).

| Room | Joined by | Client side |
|---|---|---|
| `user:{ref}` | **server, automatically on connect**, from the token `sub` | `UserChannel` listens through per-domain handler files (`lib/realtime/handlers/<domain>.ts`); no join command |
| `game:{ref}` | `game:join {ref, lastSeq}` with ack → `GameState` (players, every tab) | `useGameSocket(ref)` registers `realtime.room(ROOM.game(ref), join, leave)` |
| `spectate:{ref}` | `spectate:join {ref}` (members, watchable games; one ply late) | `useSpectate(ref)` |
| `tournament:{slug}` | P12's join command with ack → `{version}` | `useTournamentLobby(slug)` |

On connect the server sends **`session:hello {bootId, useq, serverNow}`**. Every user-room event carries `useq` (a per-user counter in the socket server's memory). After a reconnect the client refetches user-room data **only** when `bootId` changed (the server restarted and may have dropped events) or `useq` skipped (api-perf AP-25); otherwise nothing was missed and no GET is sent.
### 5.4 Feature hooks

| Hook (file) | Holds | Uses | Writes to |
|---|---|---|---|
| `UserChannel` (`lib/realtime/UserChannel.tsx`) | `"user"` | user-room events (§5.6) | query cache, `systemNotice`, `overlays`, `notify` |
| `useGameSocket(ref, snapshot)` (`features/game/useGameSocket.ts`) | `"game"` | `game:*` events + commands | the per-game store (§5.7) |
| `useQueue()` (`features/play/useQueue.ts`) | `"queue"` | `queue:join` / `queue:leave` (ack), `queue:status`, `queue:matched`, `queue:timeout`, `queue:moved` | local state for `V3Queue` (`initializing, searching, widened, cancelling, error, offline, timeout, creating`), `usePendingBoard` |
| `useChallengeWatch(code)` | `"user"` | `challenge:accepted` / `:declined` | `qk.games.challenge(code)`, navigation (`V3ChallengeShare` "Your friend joined") |
| `useTournamentLobby(slug)` (`features/tournaments/useLobby.ts`) | `"lobby"` | `tournament:*` deltas, `tournament:paired` | `qk.tournaments.detail/standings` (versioned, §5.5) |
| `useAnalysisProgress(gameRef)` | `"review"` | `analysis:*` from the user room, filtered by `gameRef` | `qk.review.detail`, `qk.review.status`; fallback poller (§5.9) |
| `useImportProgress()` | `"user"` | `import:*` | `qk.imports`, `qk.home`, `qk.me` (`import` summary) |
| `useActivation(params)` (`features/billing/useActivation.ts`) | `"activation"` | `entitlement:changed` + the fallback poller | `qk.billing.activation`, `qk.me`, then `session.reload()` + `router.refresh()` |
| `useWeaknessProgress()` | `"user"` | `weakness:progress` / `:ready` | `qk.train.weakness` |
| `usePresence(userRefs)` (profile header) | `"user"` | `presence:watch` → `presence:update` | local state |

### 5.5 Reconciling with server snapshots

1. **Snapshot first, then deltas.** Every room join returns a full snapshot in its ack: `GameState` with `seq`, the tournament snapshot with `version`. The local copy is **replaced**, never merged.
2. **Gap detection.** Every game event carries `seq`; tournament deltas carry `version`.
   - On `seq !== lastSeq + 1`, call `game:sync` (ack → `GameState`).
   - On `version !== local + 1`, call `invalidateQueries(qk.tournaments.detail(slug))`, which refetches the snapshot.
   - This is the only recovery path (AS §17.1.3, IPA §4.1).
3. **Reconnect.** `connect` → `rejoin` → a snapshot per room. The REST re-hydrate in today's code (`GamePageContent.tsx:414-416`, `hydrateFromDb`) is deleted.
4. **Missed user-room events.** User-room events have no `seq`. When a reconnect follows a gap of more than 5 s, `resyncCaches()` marks `me`, `home`, `train.today`, `imports` and every non-complete `review.detail` stale. Only the active ones refetch.
5. **Optimistic game move vs the server.** `game:move {ref, uci, ply}`:
   - ack `ok` → adopt `clock`;
   - ack `stale_ply` or `illegal` → replace with `ack.state` and show the `rejected` toast "Move not accepted. The board is back in sync with the server.";
   - ack timeout → `game:sync`.
6. **Tournament deltas** use `setQueryData` on `qk.tournaments.detail(slug)` / `standings(slug)` with `version` checks. No full refetch per event; today `useTournamentLobby.ts:136-141` refetches up to 100 participants on every event.

### 5.6 User-room events → client effects

Names are `CT/socket/registry.ts` (P2 registry; `01-architecture.md` CR-14). Every Home-affecting event goes through **one** `invalidateThrottled(qk.home(), 30_000)` with a trailing edge; events that arrive while the tab is hidden only mark data stale (api-perf AP-10).

| Event | Payload (sketch) | Effect |
|---|---|---|
| `session:hello` | `{bootId, useq, serverNow}` | reconnect decision (§5.3); clock offset seed |
| `entitlement:changed` | `EntitlementDTO` (+ `subscriptionUpdatedAt`) | `setQueryData(qk.me …entitlement)`, `setQueryData(qk.billing.membership)`; the socket server updates `ent` on live sockets itself. When it flips to entitled, `await Clerk.session.reload()` so the middleware claims follow; **`router.refresh()` only in the visible tab and only when the current route's gate decision changes** (member ↔ lapsed); hidden tabs refresh on `visibilitychange` if a change happened while hidden (api-perf AP-39) |
| `session:revoked` | `{}` | session flow → modal |
| `prefs:updated` | `{version}` | ignored when the local `prefs.version ≥ version` (the PATCH response and the `BroadcastChannel` message already carried it to this device's tabs); else `GET /api/me/preferences` → `usePrefs.replace()` (api-perf AP-24) |
| `profile:updated` | `{}` | stale `qk.me`, `qk.players.detail(self)` |
| `notify:new` (P10) | `{id, kind, title, body, url, createdAt, toast?}` | prepend to `qk.notifications`, increment `me.badges.notificationsUnread`, toast if `toast` |
| `bank:due_changed` | `{due, total}` | `setQueryData(qk.me … badges.bankDue)`; stale `train.today`, `train.bank(*)`; Home through the throttle |
| `mistakes:added` | `{count}` (backfill only; ≤ 1 per user per 60 s) | stale `train.bank(*)`; Home through the throttle |
| `import:progress` | `{runRef, provider, imported, total, analysed, status}` (≤ 1/s) | `setQueryData(qk.imports)`, `me.import`, Home `import_running` |
| `import:finished` / `import:failed` | `{runRef, status, imported, firstReviewGameRef?, momentsFound?}` / `{code, retryAt?}` | invalidate `games.*`; Home through the throttle; `accounts` |
| `analysis:queued` | `{gameRef, position, etaSec}` | `review.detail(gameRef).analysis` = queued |
| `analysis:progress` | `{gameRef, gradedPlies, totalPlies, plies:[{p,cp,m,j,b}]}` (every 2 plies / 300 ms; **only for games someone is waiting for**, priority ≥ `GAME_ENDED`) | merge the ply deltas into `review.detail(gameRef).plies` (badges appear as they finish); `review.status(gameRef)` |
| `analysis:writing` | `{gameRef}` | progress 95 %, "The coach is writing…" |
| `analysis:done` | `{gameRef, analysisVersion, accuracy, momentsCount, bank: {added, plies, due}}` | invalidate `review.detail(gameRef)` (one GET, then `staleTime: Infinity`); game-over card bank line (P5) and coach line (P3); stale `games.list(*)`, `train.*`; Home through the throttle |
| `analysis:batch` | `{done, total, bankAdded, bankDue}` (backlog bands, ≤ 1 per user per 60 s) | stale `games.list(*)`, `train.*`; Home through the throttle; no per-game work |
| `analysis:failed` | `{gameRef, failedAtPly, retryable, code}` | `review.detail` → `failed` state |
| `review:text_ready` (P7) | `{gameRef, color}` | invalidate `review.detail(gameRef)`; swap the game-over coach line |
| `compare:ready` | `{gameRef, status}` | invalidate `review.legend(gameRef)` |
| `weakness:progress` / `weakness:ready` | `{pct, step, etaSec}` / `{snapshotRef}` | `setQueryData` / invalidate `train.weakness` |
| `games:changed` | `{gameRef?}` | stale `games.*` (throttled to 1 per 10 s) |
| `queue:matched`, `queue:moved` (P9) | `{gameRef, …}` | navigate / update the queue screen |
| `challenge:accepted` / `:declined` (P9) | `{code, ref}` / `{code, by}` | `useChallengeWatch` |
| `blocks:changed`, `presence:state` (P10) | — | stale `qk.me().blockedBy`; presence dots |
| `tournament:updated`, `tournament:search_ended` (P12) | — | tournament lobby and arena |
| `milestone:awarded`, `export:ready` | `{kind, title}` / `{downloadUrl}` | achievement toast / toast with link |
| `system:notice` (all sockets) | `{id, kind, restartAt?, startsAt?, endsAt?, message}` | `systemNotice` → `V3Maintenance` banner / in-game chip |
| `server:restarting` (game rooms) | `{restartAt, resumes}` | in-game chip "Server restarting in …" |
### 5.7 Game socket: store, commands and clocks

The game is **not** in the query cache.
- **Store:** a vanilla Zustand store **per game instance** (`features/game/store.ts`, `createGameStore(snapshot)`), provided by context. Its pure reducer lives in `packages/game-core/src/client-reducer.ts` (IPA §6.2) and is unit-tested.
- **`phase`** follows the 55 `V3Game` states (AS §17.10).
- **Clock:** a separate external store (`useClock`), read with `useSyncExternalStore` by the two `PlayerBar` clocks only. Each clock renders `base − (serverNow() − at)` in one rAF loop that runs while a clock is running and the tab is visible. Today `clock_update` re-renders the 1,437-line tree every second (`GamePageContent.tsx:546-555`).
- **Offset:** from `ping` acks every 10 s, EWMA.

```ts
// features/game/useGameSocket.ts (sketch)
export function useGameSocket(ref: string, store: GameStore) {
  useEffect(() => {
    const release = realtime.acquire("game");
    const offs = [
      realtime.on("game:move", (e) => store.getState().apply(e)),        // reducer checks seq; a gap → sync()
      realtime.on("game:phase", (e) => store.getState().apply(e)),
      realtime.on("game:presence", (e) => store.getState().apply(e)),
      realtime.on("game:draw", (e) => store.getState().apply(e)),
      realtime.on("game:over", (e) => store.getState().apply(e)),
      realtime.on("game:rematch", (e) => store.getState().apply(e)),
      realtime.on("game:rematch_started", (e) => navigation.replace(`/game/${e.newRef}`)),
    ];
    const leaveRoom = realtime.room(`game:${ref}`,
      async () => {                                                          // runs on every (re)connect
        const ack = await realtime.command("game:join", { ref, lastSeq: store.getState().seq });
        if (!ack.ok) return store.getState().fail(ack.code);                 // not_found → already_ended / 404
        store.getState().replace(ack.state);                                 // the snapshot wins
        const queued = store.getState().queuedOffline;                       // at most one own move
        if (queued && ack.state.moves.length === queued.ply - 1) await sendMove(queued);
        else if (queued) store.getState().dropQueued("rejected");
      },
      () => void realtime.command("game:leave", { ref }).catch(() => {}));
    return () => { offs.forEach((off) => off()); leaveRoom(); release(); };
  }, [ref, store]);

  async function sendMove(m: { uci: string; ply: number }) {
    if (!realtime.isLive()) return store.getState().queueOffline(m);        // ghost + "queued" copy
    store.getState().pending(m);                                            // optimistic, already applied locally
    try {
      const ack = await realtime.command("game:move", { ref, uci: m.uci, ply: m.ply });
      ack.ok ? store.getState().confirm(ack) : store.getState().reject(ack); // reject: snapshot + `rejected` toast
    } catch { await sync(); }                                                // ack timeout
  }
  async function sync() {
    try { const ack = await realtime.command("game:sync", { ref }); if (ack.ok) store.getState().replace(ack.state); }
    catch { store.getState().fail("server_error"); }                         // "Lost sync… Reload game"
  }
  return { sendMove, sync };
}
```

**Bot games** (mode `BOT` / `LEGEND_BOT`) never touch the socket:
- the reducer runs locally on `packages/game-core` with a `performance.now()` clock;
- the engine is the lazy `EngineProvider` singleton (AC §11.7), with no `legalMoves[0]` fallback;
- autosave to `localStorage` `rc:bot:{ref}`;
- `sendBeacon` checkpoint;
- `POST /api/games/:ref/complete` at the end (IPA §2.4).

### 5.8 Coach SSE: reader, cancellation and partial rendering

**Protocol** (IRA §2.4.5):
- Errors before the stream opens are plain JSON envelopes (401, 402, 404, 409 `in_flight`, 422, 429 `rate_limited`/`fair_use_limit`).
- The stream emits `meta`, `status`, `sentence {i, text, verified}`, `annotation {arrows, line}`, `retract`, `fallback {reason, engineLine}`, `done {verified, quota}` and `error {code}`.
- A `: ping` comment arrives every 15 s.

```ts
// apps/web/lib/sse.ts: about 40 lines; fetch + TextDecoderStream, idle watchdog
export type SseMessage = { event: string; data: string; id?: string };
export class SseIdleError extends Error { constructor() { super("sse_idle"); } }

export async function* readSse(res: Response, { idleMs = 25_000 }: { idleMs?: number } = {}): AsyncGenerator<SseMessage> {
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "", event = "message", data: string[] = [], id: string | undefined;
  try {
    for (;;) {
      const chunk = await withIdle(reader.read(), idleMs);            // rejects with SseIdleError after 25 s of silence
      if (chunk.done) return;
      buf += chunk.value;
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, ""); buf = buf.slice(nl + 1);
        if (line === "") {                                             // blank line dispatches the event
          if (data.length) yield { event, data: data.join("\n"), id };
          event = "message"; data = []; continue;
        }
        if (line.startsWith(":")) continue;                            // ping comment (it still reset the watchdog)
        const i = line.indexOf(":"); const field = i < 0 ? line : line.slice(0, i);
        const value = i < 0 ? "" : line.slice(i + 1).replace(/^ /, "");
        if (field === "event") event = value; else if (field === "data") data.push(value); else if (field === "id") id = value;
      }
    }
  } finally { reader.cancel().catch(() => {}); }
}

function withIdle<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  return Promise.race([p, new Promise<T>((_, rej) => { t = setTimeout(() => rej(new SseIdleError()), ms); })])
    .finally(() => clearTimeout(t));
}
```

```ts
// features/coach/useCoachStream.ts: state follows V3CoachStreaming
type Phase = "suggested" | "explain" | "typing" | "thinking" | "streaming" | "error" | "ratelimit" | "paywall";
export function useCoachStream(ctx: { threadId: string | null; gameRef: string; ply: number }) {
  const qc = useQueryClient();
  const abortRef = useRef<AbortController | null>(null);
  const [s, setS] = useState<{ phase: Phase; sentences: string[]; status?: string; fallback?: EngineLine; retryAt?: number }>(
    { phase: "suggested", sentences: [] });

  useEffect(() => () => abortRef.current?.abort(), []);                // unmount or route change aborts

  async function ask(q: { kind: "chip" | "typed" | "whatif" | "explain"; question: string; chipKey?: string; whatIfUci?: string }) {
    abortRef.current?.abort();
    const ac = (abortRef.current = new AbortController());
    const clientId = crypto.randomUUID();                              // idempotent: a double click can't double-charge
    setS({ phase: "thinking", sentences: [] });
    let res: Response;
    try {
      res = await fetch(endpoints.coachMessages, {
        method: "POST", signal: ac.signal, headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ ...ctx, ...q, clientId }),
      });
    } catch { if (!ac.signal.aborted) setS((p) => ({ ...p, phase: "error" })); return; }
    if (!res.ok) {                                                     // errors before the stream are JSON envelopes
      const err = await readApiError(res);
      reactToApiError(err, { kind: "stream", meta: { paywall: "inline" } });
      if (err.code === "rate_limited" || err.code === "fair_use_limit") return setS({ phase: "ratelimit", sentences: [], retryAt: Date.now() + (err.retryAfterSec ?? 30) * 1000 });
      if (err.status === 402) return setS({ phase: "paywall", sentences: [] });
      return setS({ phase: "error", sentences: [] });
    }
    try {
      for await (const m of readSse(res)) {
        const d = JSON.parse(m.data);
        switch (m.event) {
          case "status":     setS((p) => ({ ...p, status: d.label ?? "Analysing…" })); break;
          case "sentence":   if (d.verified) setS((p) => ({ ...p, phase: "streaming", sentences: [...p.sentences, d.text] })); break; // paint verified text only
          case "annotation": boardOverlay.set(d); break;                                       // arrows and line on the board
          case "retract":    setS((p) => ({ ...p, phase: "thinking", sentences: [] })); break;  // regenerate once
          case "fallback":   setS((p) => ({ ...p, phase: "error", fallback: d.engineLine })); break; // engine line, no VERIFIED tag
          case "done":
            qc.setQueryData(qk.coach.thread(d.threadId ?? ctx.threadId!), (t) => appendMessages(t, d));
            qc.setQueryData(qk.me(), (me) => me && withQuota(me, d.quota));
            setS((p) => ({ ...p, phase: "suggested" })); return;
          case "error":      setS((p) => ({ ...p, phase: "error" })); return;
        }
      }
    } catch (e) {
      if (!ac.signal.aborted) setS((p) => ({ ...p, phase: "error" }));                      // idle or network drop: "Try again"
    }
  }
  return { ...s, ask, stop: () => { abortRef.current?.abort(); setS((p) => ({ ...p, phase: "suggested" })); } };
}
```

**Policy**

- **Cancellation:** the Stop button, unmount (leaving the screen), a new question (the previous one aborts), and `ConnState`-independent page hide over 60 s. The server sees `request.signal` abort: it aborts the Anthropic stream, marks the message `ABORTED` and charges no quota (IRA §2.4.5).
- **Partial rendering:**
  - Sentences append one at a time with a 120 ms fade-in, none under `prefers-reduced-motion`.
  - The live region is `aria-live="polite"` on the bubble, announcing each sentence once.
  - `retract` clears the bubble.
  - Unverified text is **never** painted.
- **Retries:** none automatically mid-stream, because of cost. A pre-stream network error retries once after 1 s with the **same `clientId`**, which the server dedupes. "Try again" calls `POST /api/coach/messages/:id/retry`, which re-streams stored text if the answer completed or regenerates it if not.
- **Concurrency:** the server's 409 `in_flight` (one question per user at a time) disables the input with "Still answering your last question".
- **Drafts:** `sessionStorage["rc:coach-draft:{threadId}"]`, restored after sign-in (§4.4).
- **Vercel limits:** `maxDuration = 60`. The tool loop is capped at 20 s (IRA §2.4.3). The client's idle watchdog (25 s) is longer than the server ping (15 s).

### 5.9 Polling: only where it is justified

All polling goes through `refetchInterval` **functions**, so it stops by itself. Revision 1's helper captured `startedAt` when it was called; called inline in `useQuery` options it was re-created on every render (and every poll causes a render), so `stopAfterMs` never tripped and a socket outage polled forever (api-perf AP-20). The start time now lives per query hash:

```ts
// lib/realtime/fallbackPoll.ts
const startedByHash = new Map<string, number>();

export function fallbackInterval(opts: {
  schedule: number[];                 // ms per successive poll; the last value repeats
  stopAfterMs: number;                // from the first poll of this query, however often the function is re-created
  done: (q: Query) => boolean;        // terminal state reached
  evenWhenLive?: boolean;             // activation only: money, so poll alongside the socket
  hiddenOk?: boolean;                 // activation only: keep going in a background tab
}) {
  return (q: Query) => {
    if (opts.done(q)) { startedByHash.delete(q.queryHash); return false; }
    if (!opts.evenWhenLive && realtime.isLive()) { startedByHash.delete(q.queryHash); return false; }
    if (!opts.hiddenOk && typeof document !== "undefined" && document.hidden) return false;
    const started = startedByHash.get(q.queryHash) ?? (startedByHash.set(q.queryHash, Date.now()), Date.now());
    if (Date.now() - started > opts.stopAfterMs) return false;           // UI moves to `stalled` / manual Retry
    return opts.schedule[Math.min(q.state.dataUpdateCount, opts.schedule.length - 1)];
  };
}

// usage: review status while the socket is down
useQuery({ ...reviewStatusQuery(ref), refetchIntervalInBackground: false, refetchInterval: fallbackInterval({
  schedule: [2000, 4000, 8000, 15000], stopAfterMs: 180_000,
  done: (q) => ["done", "failed"].includes(q.state.data?.status) }) });
```

A unit test re-creates the function on every call and asserts it still stops after `stopAfterMs`. `refetchIntervalInBackground: false` (TanStack's default) is stated explicitly on every poller, so a socket outage cannot multiply invocations from background tabs.

| Poller | Why it's justified | Endpoint | Schedule | Stops when |
|---|---|---|---|---|
| Checkout activation (`/checkout/activating`, `/onboarding/activating`) | Dodo redirects before the webhook arrives; runs **even with the socket live**, as belt and braces for money | `GET /api/billing/activation` (its Dodo call is rate-limited and writes only a newer snapshot) | 2 s × 6, 5 s × 12, then 15 s | `state !== "pending"`, 3 min |
| Post-game analysis status | socket down, or the room didn't connect within 3 s | `GET /api/review/[ref]/status` (strong ETag → 304; re-kicks only through the `lastKickAt` CAS) | 2 → 4 → 8 → 15 s | socket live, `done`/`failed`, hidden tab, 3 min |
| Import status | socket down while `import_running` | `GET /api/import/…` (ETag) | 5 s → 10 s after 1 min | socket live, done, hidden |
| Weakness computing | socket down while `computing` | `GET /api/train/weakness` (ETag) | 3 s → 10 s after 1 min | socket live, `ready`/`failed`, hidden |
| Nav badges (`qk.me().badges` / ME-2) | socket down | `GET /api/me/badges` | **on focus, or at most every 10 min** in a visible tab (5 min equals Neon's suspend window and would keep the compute awake) | socket live, hidden |

**Deleted pollers:**
- matchmaking `match-status` every 1 s (`lib/hooks/useMatchmaking.ts:30,71-119`);
- tournament `find-match` every 2–4 s (`FindMatchButton.tsx:68-97`);
- the lobby full refetch per event (`useTournamentLobby.ts:136-141`);
- `waitForEntitlement` ×3 (`lib/billing/client.ts:87-113`, `useRequireSubscription.ts:84-90`, `PricingContent.tsx:113-129`, `onboarding/page.tsx:140-160`);
- the `game-by-ref` refetch at game over (`GamePageContent.tsx:560,602`).

Countdown timers share one `useNow(1000)` ticker; there are three `setInterval`s today (`TournamentHeader.tsx:44`, `tournaments/page.tsx:72`, `join-tournament/…/page.tsx:55`). The Train hub's 08:00 release refresh is one client timer in visible tabs (P5 §5.2), not a poll.

## 6. Client state ownership

### 6.1 What lives where

| State | Home | Examples | Never in |
|---|---|---|---|
| Server data for the first paint | RSC props / dehydrated query cache | `me`, review payload, bank page 1 | localStorage |
| Server data after paint | **query cache** | lists, details, statuses, membership | Zustand, context, localStorage |
| Identity | Clerk session (cookie / JWT) | `userId` | any store |
| Viewer, entitlement, badges | `qk.me()` (seeded, never fetched on boot) | `useMe((m) => m.entitlement.trial)` | localStorage (today: `chess-user-store`) |
| Live game | per-game Zustand store + `useClock` external store | moves, phase, pending move, premove | query cache |
| Trainer runner | per-session Zustand store (`useTrainerStore`) + outbox | `index`, `phase`, hints, wrongs | query cache (only the session payload is there) |
| Review view | per-review Zustand store (ply, narration, menu) + URL (`?tab`, `?m`) | current ply while scrubbing | query cache |
| Prefs | **`usePrefs` Zustand, persisted `rc:prefs:v1`, synced** | board theme, sounds, premove count | query cache (server copy only seeds it) |
| Overlays and prompt arbitration | `useOverlays` Zustand (IS §2.7) | session expired, cookie consent, PWA prompts | — |
| Board-from-FEN handoff | `usePendingBoard` Zustand (in memory) | `{ref, fen, orientation}` for `game/[ref]/loading.tsx` | — |
| View state worth sharing or keeping on Back | **URL** | tabs, filters, `?modal=`, `redirect_url`, compare `?tab=&ply=`, archive filters, tournaments `?tab=` | stores |
| Ephemeral UI | component state | inputs, hover, drag, open popover (unless URL-addressable) | — |
| Drafts | `sessionStorage` | `rc:coach-draft:{thread}`, `rc.draft.<route>` | localStorage |
| Dismissals and snoozes | `localStorage rc:dismissed:v1` | banners, install snooze, share prompt (replaces `games_completed`, `twitter_share_*`) | — |
| Offline data and the outbox | IndexedDB `rc-offline`, `rc-outbox` (per-user keys `u:<ref>:*`) | due drill payload, last review, attempts, bot PGNs | localStorage |
| Server-read flags | cookies | `rc_theme` (no flash on a new device), `rc_consent`, `rc_act` (activation lag, httpOnly) | — |

### 6.2 Auth and subscription: sources of truth

| Question | Authority | Copies and their lag | Who refreshes them |
|---|---|---|---|
| Who is signed in? | Clerk session (`auth()` on the server) | clerk-js state (client) | Clerk |
| Is this user a member, trialing, in grace or lapsed? | **Postgres `User` entitlement columns**, written by the Dodo webhook and the activation self-heal | (a) Clerk `publicMetadata` claims `md.entitled/lapsed/onboarded` for middleware: ≤ about 60 s lag, bridged by `rc_act` (120 s) after checkout. (b) Socket token `ent` claim: ≤ 15 min. (c) `qk.me().entitlement` on the client. | (a) `syncClerkClaims()` after each snapshot + `session.reload()` on the client; (b) token refresh on `entitlement:changed`; (c) `entitlement:changed` → `setQueryData`, and the 5-minute stale focus refetch |
| Can this request proceed? | `route({ auth })` / `requireMemberPage()` against the DB | — | every request |
| What does the UI show? | `qk.me()` | — | as above |

**Rules**

1. The client **never decides access**. It only shapes UX (trial tag, payment banner, hidden CTAs). A 402 always wins: invalidate `qk.me()` and react by code (§4.4).
2. **"Unknown" is not "no."** Server-rendered pages always know the answer, because the layout has it. If a client refetch of `me` fails, keep the last known value and show nothing. **Never redirect on an error**; today any failed `/api/subscription` sends paying members to `/pricing` (`useUserStore.ts:101-109` + `useRequireSubscription.ts:91-112`).
3. After checkout, run `entitlement:changed` or poll `active`, then `setQueryData(qk.me)`, then `await Clerk.session.reload()`, then `router.refresh()`, then navigate. Without the reload, middleware still sees `entitled:false` and bounces the user.
4. **Onboarding redirect:** middleware (`md.onboarded`) plus `requireMemberPage()`. It runs on soft navigations too, unlike today's one-shot `UserSync` redirect (`UserSync.tsx:141-148`).
5. **Sentry and PostHog identity:**
   - `Sentry.setUser({ id: me.user.referenceId })`, with no email (AC §4.1.5);
   - PostHog `identify(referenceId)` only after consent.

### 6.3 Zustand stores: the final list

| Store | File | Persisted | Notes |
|---|---|---|---|
| `usePrefs` | `lib/prefs/store.ts` | `localStorage rc:prefs:v1`, plus a pre-hydration inline script that writes board CSS variables and the theme class (IAC §3.0.1) | Seeded from `me.prefs` when the server's `updatedAt` is newer. Debounced sync via mutation `scope:"prefs"`. Migration: `chess-battle-theme`, `chess-sound-muted` → here (once). |
| `useOverlays` | `lib/overlays/store.ts` | no | priority queue per IS §2.7 |
| `createGameStore(snapshot)` | `features/game/store.ts` | no (bot games: `rc:bot:{ref}`) | one instance per game, via context; pure reducer from `packages/game-core` |
| `useClock` | `features/game/clock.ts` | no | external store; rAF; only clocks subscribe |
| `createTrainerStore(session)` | `features/train/runner-store.ts` | no (the outbox is in IDB) | phase machine from IRB §4.5 |
| `createReviewViewStore()` | `features/review/view-store.ts` | no | ply, narration and menu. Tab and moment are in the URL. |
| `usePendingBoard` | `lib/navigation/pending-board.ts` | no | written before `router.push('/game/…')` |
| `systemNotice` | `lib/system/notice.ts` | no | maintenance and restart (`V3Maintenance`) |

**Deleted:**
- `lib/stores/useUserStore.ts`, persisted (`:71`, `:150-156`): user, email, role and entitlement in localStorage;
- `lib/stores/useDataStore.ts`, persisted (`:33`, `:108-116`): 3,641 openings and the full legend objects, likely rehydrated on every page through the barrel `lib/stores/index.ts:4` (AC §15);
- the `devtools` middleware in production (AC §14).

### 6.4 URL state conventions

- `?tab=` (profile, review, compare, tournaments, settings sub-tabs)
- `?modal=` (switch-plan, cancel, delete-account, share; IAC §1.1)
- list filters (`?src&result&tc&moments&q`; bank `?view&theme&phase&source`)
- `?m=` (review moment index)
- `?ply=` (compare)
- `redirect_url` (sanitised by `safeReturnPath`, IP §1.4)
- `?reason=` on pricing

Pure view changes go through `useUrlState(key)`. It is a 20-line helper over `useSearchParams` that writes with `history.replaceState`, or `pushState` for modals, so Back closes them. When the list is RSC-rendered, filters use `router.replace(…, { scroll: false })` instead. Bank and archive filters are client queries, so they use `replaceState`.

### 6.5 Persistence policy and legacy cleanup

On the first load of the new shell, `lib/storage/migrate.ts` runs once (guarded by `rc:migrated:v1`):
- delete `chess-user-store`, `chess-data-store`, `games_completed`, `twitter_share_prompted`, `twitter_share_snoozed_at`;
- move `chess-battle-theme` and `chess-sound-muted` into `rc:prefs:v1` (AC Appendix B).

All storage access goes through `lib/storage/{local,session,idb}.ts`. Each access is wrapped in try/catch, and the app still works if storage throws (private mode).

### 6.6 Sign-out and account switch: `signOutEverywhere()`

1. `sessionStorage["rc.signout"] = "1"`, so `SessionWatcher` doesn't show "session expired".
2. `realtime.destroy(); clearSocketToken();`
3. **Flush the outbox** (3 s budget); anything left is counted in analytics.
4. **`await fetch("/api/session/clear", { method: "POST" })`**: the route answers `204` with `Clear-Site-Data: "cache"`, which empties the browser HTTP cache for the origin, so the next person on a shared browser cannot read this user's review, PGN or invoice from it without an auth check (api-perf AP-04). It sends `"cache"` only, never `"storage"`, which would wipe the outbox before step 3 finishes on slower devices. Browsers without support fall back to the server rule that no per-user response has `max-age > 0`.
5. `queryClient.cancelQueries(); queryClient.clear();`
6. IndexedDB: delete `u:<ref>:*` in `rc-offline` and `rc-outbox` (feasibility 10.4 item 5).
7. Service worker: post `{ type: "PURGE_USER", ref }`; the SW deletes `rc-pages:u:<ref>` (§7.1).
8. Keep only device-level prefs (theme, board, sound). Clear `rc:dismissed:v1` entries scoped to the user.
9. `posthog.reset()`, `Sentry.setUser(null)`.
10. `BroadcastChannel("rc-auth").postMessage({ type: "signed_out" })`; other tabs run steps 2, 5–9 and go to `/`.
11. `await clerk.signOut({ redirectUrl: "/" })`.

"Use a different account" (`V3SessionExpired`) runs the same sequence, then `/sign-in?redirect_url=/home`, never the old URL. `(app)` documents are `private, no-store`, so Back after sign-out does not restore the previous user's page from the bfcache.
---

## 7. Offline and PWA

### 7.1 Service worker rules

Today the SW runtime-caches `/api/*` for 24 h across users, plus HTML, and precaches 531 entries / 4.8 MB (`next.config.js:13-35`, `public/sw.js`; AC §10.6).

| Request | Strategy | Cache | Notes |
|---|---|---|---|
| `/_next/static/**` | precache only the **shell** chunks (layout, `(app)` shell, offline page), plus `CacheFirst` at runtime for the rest | `rc-static` | exclude `/admin` chunks from the precache |
| Fonts (woff2), piece SVG sprite, move-quality SVG icons, app icons | precache | precache | exclude `board_icons/{256x,1024x}`, `*.ps1`, `*.map` |
| `/offline`, `/maintenance` | precache; `fallbacks.document = "/offline"` | precache | static pages |
| `workers/stockfish-<sha8>.{js,wasm}` (hashed names) | `CacheFirst`, at most 4 entries | `rc-engine` | only after first use or intent prefetch; `immutable, max-age=31536000` headers (today `max-age=0`, `next.config.js:158-167`) |
| Sounds | `CacheFirst` | `rc-assets` | after the first gesture |
| Documents `/train/bank`, `/train/bank/session`, `/play` (bot tab) | `NetworkFirst`, `networkTimeoutSeconds: 4` | `rc-pages` | the offline allow-list (IS §3.4); purged at sign-out |
| Lesson audio (`media.playchess.tech/**`) | explicit `cache.add()` from the Download control | `rc-lessons` | never runtime-matched |
| `/api/**`, RSC requests (`RSC: 1` header, `?_rsc=`), everything else | **`NetworkOnly`** | — | authenticated JSON is never stored by the SW |

```js
// next.config.js (sketch; verify option names against @ducanh2912/next-pwa 10.2.9)
const withPWA = withPWAInit({
  dest: "public",
  register: true,
  cacheOnFrontEndNav: false,              // was true
  aggressiveFrontEndNavCaching: false,    // was true: cached signed-in HTML
  reloadOnOnline: false,                  // was true: hard-reloaded mid-game
  cacheStartUrl: false,
  fallbacks: { document: "/offline" },
  extendDefaultRuntimeCaching: false,     // drop the default `apis` / `pages` caches
  publicExcludes: ["!**/*", "fonts/**/*", "pieces/**/*", "board_icons/svg/**/*", "icons/icon-192x192.png", "icons/icon-512x512.png"],
  workboxOptions: {
    skipWaiting: false, clientsClaim: false,      // the update waits for the user (V3PwaUpdate)
    exclude: [/\.wasm$/, /\/admin\//, /\.map$/, /board_icons\/(256x|1024x)\//, /\.ps1$/],
    runtimeCaching: [
      { urlPattern: ({ url }) => url.pathname.startsWith("/api/"), handler: "NetworkOnly" },
      { urlPattern: ({ request }) => request.headers.get("RSC") === "1", handler: "NetworkOnly" },
      { urlPattern: /\/workers\/stockfish-[0-9a-f]{8}\.(js|wasm)$/, handler: "CacheFirst",
        options: { cacheName: "rc-engine", expiration: { maxEntries: 4 } } },
      { urlPattern: /\/sounds\//, handler: "CacheFirst", options: { cacheName: "rc-assets", expiration: { maxEntries: 20 } } },
      { urlPattern: ({ request, url }) => request.mode === "navigate" && ["/train/bank", "/train/bank/session", "/play"].includes(url.pathname),
        handler: "NetworkFirst", options: { cacheName: "rc-pages", networkTimeoutSeconds: 4 } },
    ],
  },
});
```

`worker/index.ts` (custom SW code) handles:
- `SKIP_WAITING`;
- `PURGE_USER` → `caches.delete("rc-pages")`;
- `push` / `notificationclick` (IS §3.12);
- a Background Sync tag `rc-outbox`, which posts a message to clients so they flush. The SW never reads IDB auth state itself.

If the plugin's options fight this config, switch to Serwist (`@serwist/next`). It is the maintained successor of this plugin and has the same runtime-caching model.

**Per-user page cache (api-perf AP-34).** The offline allow-list of `(app)` documents (`NetworkFirst`, `networkTimeoutSeconds: 4`) uses a cache **per user**: `rc-pages:u:<userRef>`. The page posts `{ type: "SET_USER", ref }` to the SW on every boot; the SW serves only from the current user's cache and deletes other `rc-pages:u:*` caches when the ref changes. The SW skips the page cache entirely when the navigation request carries no Clerk `__client_uat` cookie greater than 0 (it can read the `Cookie` header on same-origin navigations). This covers Clerk session expiry followed by another person signing in, and Clerk multi-session switching, which do not go through `signOutEverywhere()`.

### 7.2 Precache budget

The goal is ≤ 600 KB on install, down from 4.8 MB. A CI check parses `public/sw.js` after the build and fails above the budget.

### 7.3 Offline detection

```ts
// lib/offline/useOnline.ts: one source for the chip, onlineManager and disabled controls
const probe = () => fetch("/api/health", { cache: "no-store" }).then((r) => r.ok, () => false);
// navigator.onLine === false → offline immediately.
// "online" events and every 15 s while offline (the V3Offline auto-retry "Retrying on its own in 0:15") → probe().
// Captive portals: onLine === true but the probe fails twice → offline.
onlineManager.setEventListener((setOnline) => subscribeOnline(setOnline));   // pauses queries, holds mutations
```

| State | UI |
|---|---|
| `offline` | `OfflineChip` "Offline · cached pages still work"; network-only entry points (Find opponent, Challenge, Ask coach, Import) render disabled with "Needs a connection"; `/offline` for uncached documents (`V3Offline` `offline`) |
| `checking` | Retry button spinner, "Checking the connection" |
| `back_online` | chip "Back online"; flush outboxes; `queryClient.resumePausedMutations()` + refetch of active stale queries. **No reload** (today `reloadOnOnline: true`, `next.config.js:17`). |

### 7.4 The outbox: retry queue for puzzle results and other unload-safe writes

```ts
// lib/offline/outbox.ts
import { createStore, get, update } from "idb-keyval";
const store = createStore("rc-outbox", "items");
type Kind = "attempts" | "lessonEvents" | "botGames";
const key = (userRef: string, kind: Kind) => `u:${userRef}:${kind}`;
const MAX_ITEMS = 500;

export const outbox = {
  async enqueue<T extends { clientId?: string; clientAttemptId?: string }>(userRef: string, kind: Kind, item: T) {
    await update(key(userRef, kind), (q: T[] = []) => [...q, item].slice(-MAX_ITEMS), store);
    scheduleFlush(userRef);
  },

  /** One tab flushes at a time (Web Locks); batches of 50; idempotent server-side on clientAttemptId. */
  async flush(userRef: string, qc: QueryClient) {
    if (!onlineManager.isOnline()) return;
    await navigator.locks.request(`rc-outbox:${userRef}`, { ifAvailable: true }, async (lock) => {
      if (!lock) return;                                                      // another tab is flushing
      for (;;) {
        const q = (await get<AttemptIn[]>(key(userRef, "attempts"), store)) ?? [];
        if (!q.length) return;
        const batch = q.slice(0, 50);
        let out: AttemptsOut;
        try {
          out = await api(endpoints.trainAttempts, { method: "POST", body: { attempts: batch }, schema: AttemptsOut,
                                                     timeoutMs: 10_000, keepalive: true });
        } catch (e) {
          if (e instanceof ApiError && e.status === 402) { reactToApiError(e, { kind: "outbox" }); return; }  // lapsed: stop the session
          return scheduleRetry(userRef);                                     // 1 s → 4 s → 15 s, then online/visible/mount
        }
        applyAttemptResults(qc, out.results);                                // rating chip, streaks, milestones, capRemaining
        const settled = new Set(out.results.map((r) => r.clientAttemptId)); // ok | duplicate | conflict | rejected all settle
        await update(key(userRef, "attempts"), (cur: AttemptIn[] = []) => cur.filter((a) => !settled.has(a.clientAttemptId)), store);
        crossTab.stale([qk.train.all(), qk.home()]);
      }
    });
  },
};
```

**Flush triggers:**
- right after enqueue;
- `online`;
- `visibilitychange:visible`;
- app mount (`useOutboxSync()` in `(app)/layout`);
- `pagehide` with `keepalive`;
- Background Sync (Chromium).

Before navigating to the session summary, the runner awaits a flush for up to 3 s and shows "Saving…" (IRB §4.5).

**Ordering:** the server replays attempts in `reviewedAt` order, and its FSRS result is authoritative. Client previews are labels only.

**Scope and safety:**
- The outbox is per user.
- `signOutEverywhere()` flushes, then clears it.
- Items older than 14 days are sent with `stale: true`. The server may reject them with `rejected` + `reason: "too_old"`, which the client drops.
- iOS can evict IDB after 7 days without use, so the outbox is a buffer, never a source of truth (IS §3.4).

**The same outbox carries:**
- lesson events (`POST /api/learn/lessons/:slug/progress`, idempotent on `eventId`);
- finished offline bot games (`POST /api/games/offline`, PGN, unrated, gated on sync, IS C4).

### 7.5 Offline data snapshots

Stored in IndexedDB `rc-offline`, under `u:<ref>:*`:

| Key | Written by | Read by |
|---|---|---|
| offline snapshot key `bank:due` (in `rc-offline`; not a socket event) = the next `DAILY`/`BANK` `SessionPayload` (≤ 20 items) + `savedAt` | the Train hub / Bank page after first render of the day (one `POST /api/train/sessions` with the `Idempotency-Key` of the day) | the offline runner, the `V3Offline` row "Mistake Bank · 6 due · saved this morning" |
| `review:last` = `{gameRef, title, opponent, date, keyMoments}` | the review page on view | the `/offline` row "Last review" |
| `lessons:index` + audio in `rc-lessons` | the Download control | the `/offline` row "Legend Lessons · 3 lessons downloaded" |
| `engine:ready` | `EngineProvider` after the first worker load | the `/offline` row "Play vs bot" |

Rows whose data is missing are hidden, not shown empty.

### 7.6 Updates (`V3PwaUpdate`: `ready`, `refreshing`, `later`, `in_game`)

**Detection:**
- the SW's `registration.waiting` / `updatefound`;
- the **version poll** `GET /api/health` → `buildId`, compared with `me.buildId` on `visibilitychange`, at most every 30 min;
- `connect_error "upgrade_required"` from the socket;
- a `ChunkLoadError` on navigation, which is treated as `ready` and triggers a hard navigation to the target URL.

**Apply:**
- `waiting.postMessage({ type: "SKIP_WAITING" })` → `controllerchange` → `location.reload()`.
- **Guard:** if a game store is live, show `in_game` ("Update ready · installs after this game") and apply on `game:over`.
- "Later" applies silently on the next hard navigation, never mid-game.
- Drafts are saved to `sessionStorage` first.

`PWAUpdateBanner` (0 importers today) and `lib/hooks/usePWAUpdate.ts:70-76` (applies immediately) are reworked into this flow.

---

**Emergency kill switch (feasibility §9).** A broken service worker is the slowest thing to roll back, because it keeps serving the old shell. P11 ships an emergency build path: `SW_KILL_SWITCH=1` produces a SW that calls `skipWaiting()`, deletes every cache, and runs `registration.unregister()`, then reloads controlled clients. The procedure is in `docs/runbooks/rollback.md`; the `sw-on` Playwright project (P11) tests both the normal update and the kill switch.

## 8. Loading, skeleton, empty and error conventions (Phase 1 UI kit)

### 8.1 Primitives

These live in `components/ui/`, built in Phase 1 (PLAN §Phase 1, IS §3.13–3.17).

| Primitive | Use | Rule |
|---|---|---|
| `Hairline` | 2 px top bar in `main` during navigation and in-region refetch | appears **200 ms** after start (`V3Skeletons` note); started from `onRouterTransitionStart` (`instrumentation-client.ts:34`, already exported for Sentry), done by a `RouteChangeObserver` |
| `Skeleton`, `GhostRow` | first load of a region with no data | `#f5f3f0`, 1.6 s shimmer (none under reduced motion); lists show **9 ghost rows** (`V3Skeletons list`); `aria-hidden`; region `aria-busy="true"` |
| Route skeletons (`loading.tsx`) | navigation into a segment | variants `game` (the **real board from FEN** via `usePendingBoard`), `review` ("Analysing · 14 of 38 moves"), `profile`, `list`, `V3HomeLoading`, `V3TrainHubLoading`, `V3BankLoading loading` |
| `EmptyState` | a successful query with zero items | ghost of the filled state + serif headline + one line + one primary + at most one text link; centred in its region (`V3EmptyStates`) |
| `ErrorState` | a failed query with no data | variants `inline` (region), `offline` ("Needs a connection"), `rate_limited` (countdown); `requestId` shown as "Event ID" with Copy, Retry → `refetch()` (`V3Error500` `default/retrying/failed_again`) |
| `error.tsx` (route) / `global-error.tsx` | render-time throws | `(app)/error.tsx` = `V3Error500` inside the shell; `reset()` + `router.refresh()`; `global-error` = no shell, system fonts (`V3ErrorGlobal`) |
| `not-found.tsx` | `notFound()` from the DAL | `V3Error404` (signed out / in / `missing_game`) |
| `RateLimitedInline` | 429 on a form or a button | "Too many requests. Try again in 0:30" → `inline_ready` (`V3RateLimited`) |
| `Banner` | persistent page-level conditions | payment failed (`V3PaymentFailed banner/last_day/expired`), maintenance scheduled; in flow, never an overlay; **not on immersive routes** |
| `OfflineChip`, `InGameStatusChip` | connection, session and update states | `role=status`; never covers the board |
| `Spinner` | **only inside a `Button`** (pending mutation, `aria-busy`) or next to text ("Checking with Dodo Payments") | never alone |
| `ProgressBar` | determinate jobs (analysis, import, activation indeterminate) | `aria-valuetext` |
| `notify.*` | toasts (§4.5) | — |

### 8.2 `<QueryState>`: one mapping from query status to UI

```tsx
// components/data/QueryState.tsx
export function QueryState<T>({ q, skeleton, empty, isEmpty, children, errorVariant = "inline" }: {
  q: UseQueryResult<T> | UseInfiniteQueryResult<T>;
  skeleton: React.ReactNode; empty?: React.ReactNode; isEmpty?: (d: T) => boolean;
  errorVariant?: "inline" | "page"; children: (d: T) => React.ReactNode;
}) {
  if (q.isPending) return <>{skeleton}</>;                              // first load only (RSC usually seeds, so this is rare)
  if (q.isError && q.data === undefined) {
    if (errorVariant === "page") throw q.error;                          // → (app)/error.tsx
    return <ErrorState error={q.error as ApiError} onRetry={() => q.refetch()} />;
  }
  const data = q.data as T;
  if (empty && isEmpty?.(data)) return <>{empty}</>;
  return (
    <div aria-busy={q.isFetching && q.isPlaceholderData ? true : undefined}
         data-stale={q.isPlaceholderData || undefined}>                  {/* dimmed rows while filters load */}
      {q.isFetching && q.isPlaceholderData ? <Hairline region /> : null}
      {children(data)}
    </div>
  );
}
```

**Rules**

1. Skeletons appear only when there is **no data**. A refetch with data shows at most a region hairline; with `keepPreviousData` the old rows dim.
2. **Server-decided list states win.** `BankPage.state` is `empty | caughtup | default` (IRB). The client adds only `loading` and `filtered`.
3. A mutation's pending state belongs to its trigger: a button spinner, a disabled control. Optimistic mutations show nothing.
4. **No spinners stacked across layers.** A page has exactly one loading layer: `loading.tsx` during navigation, or a `<Suspense>` fallback for a streamed block. Client queries seeded by RSC never show a second layer.
5. A11y:
   - `main aria-busy="true" aria-label="Loading"`;
   - one polite live message after 2 s ("Still loading…");
   - errors use `role=alert`.

### 8.3 Screen → states map

| Screen (board) | Loading (design) | Empty | Error | Realtime / other states |
|---|---|---|---|---|
| Home (`V3Home`: `populated, new_user, loading, import_running, payment_failed, trial`) | `loading.tsx` = `V3HomeLoading`; Suspense blocks for Continue and Recent | `new_user` (server-decided from `me` + counts) | inline per block | `import_running` (`import:progress`), `payment_failed` (Banner from `me.entitlement.paymentIssue`), `trial` (nav tag) |
| Train hub (`V3TrainHub`: `default, nothingdue, loading`) | `V3TrainHubLoading` | `nothingdue` (server `TrainToday.state`) | inline | `bank:due_changed` |
| Mistake Bank (`V3MistakeBank`: `default, filtered, loading`; `V3BankLoading`: `empty, caughtup, loading`) | 9 ghost rows | `empty` "Your Bank Is Empty", `caughtup` "All Caught Up" + `upcoming` | inline | filter change → `filtered` with dimmed rows |
| Bank / puzzle runner (`V3BankSession`, `V3PuzzleSolve`: `solve, hint, wrong, correct, solution, themes`) | board from the session payload (SSR) | → summary | create failure → inline + Retry; flush failure → silent retry; 402 → paywall | outbox; `V3SessionSummary default/perfect` |
| Weakness (`V3WeaknessProfile: default, loading`; `V3WeaknessInsufficient`, `V3WeaknessComputing`) | skeleton sections | `insufficient` (server) | `failed` + Retry (`POST /api/train/weakness/recompute`) | `computing` (socket progress, fallback poll) |
| Review (`V3ReviewSummary`/`V3KeyMoments`: `analysing, failed, clean, summary, moment`) | `review` skeleton: board from FEN + "Analysing · n of m" | `clean` | `failed` + Retry; 404 for non-participants | `analysis:*` deltas; share `V3RvShare generating/ready` |
| Coach (`V3CoachStreaming`: `suggested, explain, typing, streaming, error, ratelimit, paywall`) | thread head prefetched; "ANALYSING…" row | `suggested` chips | `error` + engine-line fallback | SSE; `ratelimit` countdown; `paywall` inline (if lapsed-read is adopted) |
| Games archive (`V3GamesArchive`: `default, filters_open, empty, loading, import_running, error`) | 9 ghost rows | `empty` "No Games Yet" / "No Games in This Filter" | `error` inline | `import_running`; `games:changed` |
| Play hub (`V3PlayHub`: `default, loading, search_empty, creating, error, limit`) | catalogue tiles (SSR) | `search_empty` | `error` (create failure toast + inline) | `creating` = button pending; `limit` = 409/429 copy |
| Queue (`V3Queue`: `initializing, searching, widened, cancelling, error, offline, timeout, creating`) | `initializing` = before the `queue:join` ack | — | `error` (ack failure) | socket-driven; `offline` from `useOnline` |
| Game (`V3Game`, 55 states) | `game` skeleton: board from FEN | — | `server_error`, `already_ended`, `rejected` | §5.2, §5.7 |
| Challenge share (`V3ChallengeShare`: `waiting, copied, expired, cancelled, error`) | SSR | — | `expired` / `cancelled` (410), `error` | `challenge:accepted` |
| Tournaments list (`V4Tournaments`: `default, loading, empty, error, free`) | 9 ghost rows | `empty` (`V4TournamentsEmpty`) | inline | `free` is obsolete under paid-only (redirects instead) |
| Tournament lobby / live (`V4TournamentLobby: joined, not_joined, host, started`; `V4TournamentLive: idle, searching, matched, in_game, ending_soon, not_participant`) | snapshot SSR; standings streamed | — | inline | `tournament:*` deltas, `tournament:paired` |
| Profile (`V4Profile`/`V4ProfileGames`: `default, loading, new_user, not_linked`) | `profile` skeleton | `new_user`, `not_linked` (server) | 404 / private (`V4ProfilePrivate`) | presence |
| Settings › Connected (`V4SettingsConnected`: `default, syncing, sync_failed, rate_limited, not_found, private_games, li_connecting, li_denied, both_linked, none_linked`) | SSR | `none_linked` | `sync_failed` (502), `rate_limited` (429), `not_found` (404) | `syncing` (`import:*`); `li_*` from the OAuth return query |
| Settings › Board, Pieces, Sounds, Appearance, Notifications | SSR (prefs) | — | pill "Couldn't sync" | local-first |
| Membership (`V4Membership`: `active, active_yearly, trial, cancelling, switching, past_due, legacy, expired, free, loading, error, trial_cancelled`) | `loading` = skeleton card | — | `error` inline + Refresh (`POST /api/billing/refresh`) | `entitlement:changed`; actions write the DTO |
| Onboarding link (`V3OnbLink`: `default, validating, found, not_found, private_profile, rate_limited, lichess_denied`) | SSR | — | `not_found` (404), `rate_limited` (429), `lichess_denied` (query) | `validating` = lookup pending |
| Checkout activating (`V3CheckoutActivating`: `polling, success, stalled, failed`) | `polling` (SSR first state) | — | `failed` | socket + poller (§5.9) |
| System (`V3Offline`, `V3SessionExpired`, `V3Maintenance`, `V3RateLimited`, `V3PwaUpdate`, `V3PaymentFailed`, `V3Error404/500`, `V3ErrorGlobal`) | — | — | — | §4.4, §7 |

---

## 9. Migration plan: today's patterns → target, per phase (13-phase numbering)

Revision 1 used the 10-phase numbering with week numbers. The phases below follow `SP/plan/allocation.md`; week numbers are dropped because the calendar is the allocation's (and `01-architecture.md` §6.2 records the realism caveats). Each phase spec's §5 "UI ↔ API" is authoritative for its screens.

| Phase | Data-layer work |
|---|---|
| **P1** (hotfix lane first: about 1 day) | Delete `GET /api/user/email` callers (`lib/hooks/useRequireAuth.ts:107`, `lib/stores/useUserStore.ts:116`); stop persisting entitlement and user in `localStorage` (`lib/stores/useUserStore.ts:150-156`); SW `NetworkOnly` for `/api/*`; "unknown is not no" for failed subscription reads. **Foundation:** `QueryProvider` (mounted in the `(app)`, `(auth)`, onboarding, checkout, `(admin)` and `(marketing)/pricing` layouts only, not the root, so marketing pages do not ship TanStack, api-perf AP-48); `lib/api/{client,schema,endpoints}.ts`; the `qk` factory as `lib/api/keys/<area>.ts` files plus an index (feasibility §7); `reactToApiError`; `<QueryState>` and the Phase 1 UI kit; the DAL (`lib/data/*`) with `getViewer()` and `getMe()`; `signOutEverywhere()` with `POST /api/session/clear`; the request-budget and bundle specs (blocking budgets) |
| **P2** | `RealtimeProvider` and the connection manager (lazy, ref-counted, `session:hello` resync rule); the game store and controllers replacing `GamePageContent.tsx` (37 `useState`); `EngineProvider` singleton loading the engine from R2 through `NEXT_PUBLIC_ENGINE_BASE_URL` (a **same-origin** worker shim, `importScripts()` of the cross-origin glue with CORS, `locateFile` pointing at the R2 WASM served as `application/wasm`; same-origin `/workers/sf18-<hash>/` as the fallback); bot-game `POST /api/games` + beacons; optimistic offers (§3.6.4); dev-only socket frame validation |
| **P3** | `qk.review.*` (`detail`, `status`, `legend`), `useAnalysisProgress(ref)` (user room + the review-status fallback poller), `useToggleMomentInBank`, review progress `keepalive` PATCH, share mutations, the archive (`qk.games.list`, ETag from `gamesVersion`); no hover prefetch that enqueues (only REV-9's side-effect-free GET may be prefetched) |
| **P4** | `qk.accounts`, `qk.imports`, onboarding mutations, activation poller, "Sync now" optimistic |
| **P5** | `qk.train.*`, `qk.home`, the outbox (`rc-outbox`, keys `u:<userRef>:<stream>`), offline snapshots (`rc-offline`), the Home invalidation throttle, `bank:due_changed`/`mistakes:added` handlers; the 08:00 client timer |
| **P6** | `qk.train.weakness`, `weakness:*` handlers |
| **P7** | SSE reader, `qk.coach.context(scope, gameRef)` **without `ply`** (per-ply facts and chips computed on the client from the cached review, or passed as an RSC prop), coach routes per P7 D11 (no `/coach/[threadId]` page), the `stop` beacon, `review:text_ready` |
| **P8** | catalogue queries (`qk.catalog.openings({})` replaces P1's `qk.catalog.openingsIndex()` and the `OpeningsIndexData` contract), lessons with the outbox, wire enums in lowercase (`kind: "openings"`) |
| **P9** | queue and challenge hooks (`queue:matched`), `qk.prefs` with `PATCH /api/me/preferences` (`baseVersion`) |
| **P10** | players (public query + `/me` query), settings, membership (`setQueryData` from `entitlement:changed`, no refetch), notifications (`notify:new`), `prefs:updated` skip rule |
| **P11** | consent-gated analytics, PWA update flow and the SW kill switch, per-user page caches, offline page |
| **P12** | tournaments (public queries + `qk.tournaments.mine()` and TOU-7), admin lists, `@tanstack/react-virtual` loaded with `next/dynamic` only past 200 rows |
| **P13** | the `sw-on` and `@prod-smoke` runs; remove the legacy shapes `unwrapLegacy` still accepts |

Legacy patterns removed along the way (all phases): the 73 hand-written `fetch` + `useState` sites (`audit-client` Appendix A), `lib/types/socket-events.ts` (replaced by `@repo/contracts/socket/*`), three `waitForEntitlement` loops, the `UserSync` component, and the persisted user store.

## 10. Request budget and how it is measured

| Step (one member session) | Today (AC §8) | Target |
|---|---|---|
| Hard load `/home` | sync 1 + subscription 1–2 (+ catalogues 0–2) | **1** (the page render; `getMe()` + `getHome()` inside it) |
| Hover rail items, then go to `/play` | 0 + 1 (no prefetch today) | 1 prefetch + 1 navigation (or 0 extra with `staleTimes.dynamic` within 30 s) |
| Quick match, 20 s wait | create 1 + status 20 + spurious cancel 1 | **0 HTTP** (socket) |
| Game | socket-token 1 + game-by-ref 2–3 | **1** (game page render; the token is minted in it) |
| Game over → review | analysis 1 | **1** (review page render) + 0–1 `review/[ref]/status` if the socket is down |
| Mistake Bank drill, 10 items | — | session payload in the page render; **1–2** attempt batches |
| Sentry tunnel | ≈1 per navigation (100 % traces) | ≈0.1 per navigation |
| **Total** | **≈30–35** | **≈5–7** |

**Measurement:**
- A Playwright spec (`e2e/specs/request-budget.spec.ts`) counts `page.on("request")` for `/api/*`, document and RSC requests and `/monitoring` over the script above, and fails above 8.
- A second spec asserts **0** `/api/*` requests during first paint of `/home`, `/review/[ref]` and `/train/bank`: everything should be seeded.
- A bundle check: `@next/bundle-analyzer` + `scripts/check-bundle-budgets.mjs`, **blocking from P1** (a report-only gate lets the first regression through). The shared first load is ≤ 200 kB gz. TanStack Query adds about 13 kB and is absent from marketing chunks. `ZodError` is absent from production chunks outside listed form chunks. Removing PostHog-before-consent saves about 105 kB.
- SLO measurement does not depend on analytics consent: server-side sources first (`05-optimization.md` §2).

---

## 11. Tests for the data layer

| Layer | Test (runner: `tsx --test` as in `package.json:13`; Playwright for e2e) |
|---|---|
| `api()` | fake `fetch`: envelope parse; legacy shapes; 204; timeout → `timeout`; abort → `aborted`; offline; `Retry-After`; `contract_mismatch` reported |
| `reactToApiError` | 401 → `sessionGuard` called; each 402 code → the right URL (reuses `lib/billing/client.test.ts` fixtures); `meta.paywall:"inline"` suppresses the redirect; mutation toast copy and dedupe |
| Keys | `norm()` stability; every `qk.*` is a prefix of its children (the invalidation map relies on it) |
| DAL ↔ schema | each `lib/data/*` function's output parses with its `@repo/contracts` schema (seeded Docker Postgres in CI; the Neon dev project only for dev-URL runs; never prod) |
| Outbox | enqueue / flush / partial results / 402 stop / two "tabs" (Web Locks stub) never double-send |
| SSE parser | split chunks, `\r\n`, multi-line data, comments, idle timeout, abort |
| Connection manager | fake socket: lazy connect, ref-count release, rejoin on reconnect, hidden-tab disconnect except critical holds, `upgrade_required`, `io server disconnect` → token refresh |
| Game reducer | `packages/game-core` (owned by the socket plan): seq gaps, ack reject, queued offline move |
| e2e | 402 on any app route → pricing with `redirect_url`; 401 mid-page → modal, and in game → chip; socket kill → `reconnecting` → `reconnected` with the queued move; offline drill → back online → attempts applied once; sign-out → no `rc-pages`, IDB `u:*` or query data left (AC Appendix C) |

---

## 12. Dependencies on sibling plans and open questions

| Needs from | Item |
|---|---|
| API plan | Final paths (they replace `lib/api/endpoints.ts` values only); the `route()` wrapper emits the §4.2 envelope, `x-request-id` and strong ETags on `private-etag` reads; `GET /api/me` = `Me` (§3.4); `POST /api/train/attempts` batch semantics; `GET /api/review/[ref]/status` as the single post-game fallback; `GET /api/billing/activation` |
| Socket plan | Final event names (`domain:verb`); `seq` on game events and `version` on tournament deltas; `user:{ref}` auto-join; `upgrade_required`; ack shapes |
| Schema plan | `Idempotency` storage for `clientAttemptId` / `clientId` / `Idempotency-Key`; `UserSettings.version`; ETag sources (`analysisVersion`, `updatedAt`) |
| Owner | Q1: "Past reviews stay readable" for lapsed members (it decides whether a 402 `subscription_required {reason}` redirects or renders inline). Q2: allow offline bot games under paid-only (synced later, unrated). Q3: Clerk session lifetime (how often `V3SessionExpired` appears; IS Q8). |

## Appendix A. Critique dispositions (revision 2)

| Finding | Disposition | Where |
|---|---|---|
| api-perf AP-12, AP-21 (one `api()`, `x-rc-build`, dev-only parsing, no `notModified`) | Applied | §4.3 |
| api-perf AP-25 (reconnect resync burst) | Applied: `session:hello {bootId, useq}` | §5.3, §3.5 |
| api-perf AP-09, AP-23 (hover prefetch that enqueues; coach key with `ply`) | Applied | §3.4, §3.8, §9 P7 |
| api-perf AP-39 (`router.refresh()` in every tab) | Applied: visible tab, gate change only | §5.6 |
| api-perf AP-24 (`prefs:updated` duplicate refetch) | Applied | §5.6 |
| api-perf AP-10 (invalidation storm) | Applied: throttle, `analysis:batch`, priority-banded progress | §5.6 |
| api-perf AP-20 (`fallbackInterval` never stops), AP-08 item 4 (5-minute badge poll) | Applied | §5.9 |
| api-perf AP-04, AP-34 (shared-device caches) | Applied | §6.6, §7.1 |
| api-perf AP-30 (optimistic offers, Sync now) | Applied | §3.6.4 |
| api-perf AP-48 (TanStack in the root layout) | Applied | §9 P1 |
| consistency R-06 (codes), R-07 (rooms, events, `bank:due_changed`, `notify:new`), R-15 (`qk.review.status`, `qk.catalog.openings`), R-16 (storage names), R-17 (wire enums), §3 rows for this file (`packages/contracts`, coach routes per P7 D11) | Applied | §4.2, §5.3, §5.6, §3.4, §9 |
| feasibility 10.4 item 1 (13-phase renumbering) | Applied | §9 |
| feasibility 10.4 item 2 (engine from R2, same-origin shim) | Applied | §3.8, §9 P2 |
| feasibility 10.4 item 3 (SW kill switch) | Applied | §7.6 |
| feasibility 10.4 item 4 (no polling in hidden tabs) | Applied | §5.9 |
| feasibility 10.4 item 5 (clear the outbox keys at sign-out) | Applied | §6.6 |
| testing X1 (runner) | Consistent (`tsx --test`); layout per `01-architecture.md` §5.1 | §11 |
