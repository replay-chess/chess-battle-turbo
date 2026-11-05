# `lib/api` — the API layer

Two halves live here:

- **Server:** `route()` and its helpers. Every new `app/api/**/route.ts` uses them (plan phase-01 §7.2, P1-05).
- **Client:** `api()`, query keys and queries (`client.ts`, `errors.ts`, `endpoints.ts`, `keys/`, `queries/`, `query-client.ts`, `legacy.ts`, `schema.ts`). They are owned by 1B·F3 and described in plan §7.12 and CDL §4.

The first part covers the server half (`route()`, tiers, the viewer). [Contracts for P2–P12](#contracts-for-p2p12) at the end lists every Phase 1 contract later phases build on, client half included, with one example each (plan §15 "Contracts in place").

## Writing a route

1. **Declare the endpoint** in `packages/contracts/src/http/registry/<area>.ts` with `defineEndpoint({...})`. Give it the id, method, path, auth, class, cache tier, rate limit, schemas and side effects. Then regenerate OpenAPI with `pnpm --filter @repo/contracts openapi`.
2. **Wrap the handler** in `route()`, starting from that entry:

```ts
// app/api/health/route.ts
import { systemEndpoints } from "@repo/contracts/http/registry";
import { route } from "@/lib/api/route";

export const dynamic = "force-dynamic";

export const GET = route(
  { ...systemEndpoints.health, rateLimitWhen: (ctx) => ctx.rawQuery.deep === "1" },
  async (ctx) => ({ ok: true, buildId: serverBuildId(), env: appEnvName(), time: ctx.now.toISOString() }),
);
```

The handler gets `ctx`, with these fields:

- `req`, `requestId`
- `params`, `query`, `body`: already validated with the entry's zod schemas
- `rawBody`: webhooks only
- `now`: use this, never `new Date()`, so `x-rc-now` works in tests
- `viewer`, `clerkUserId`
- `after()`
- `timing.mark(name)`: adds a Server-Timing segment

The handler returns one of these:

- **Plain data**, which `route()` wraps as `{ data }`.
- **`paged(items, nextCursor, total?)`**, which becomes `{ data, meta }`. `total` is sent only on the first page or when `limit=0`.
- **`respondWith(data, { etag, headers, status, location, legacyMirror })`**, when the handler knows something extra.
- **`created(data, location)`** for a 201.
- **A raw `Response`** for streams and files. The tier headers are still applied.

To fail, throw `new ApiError(code, { message?, details?, fields?, retryAfterSec? })`. Prisma errors are mapped centrally (`prisma-errors.ts`), so never catch them just to rethrow:

| Prisma error | Response |
|---|---|
| P2002 | 409 `conflict { target }` |
| P2025 | 404 |
| P2024 / P2028 | 503 `unavailable` |
| P1001 / P1017 | one retry after 300 ms for GETs, then 503 |

Anything else becomes `500 internal` "Something went wrong", reported to Sentry with the route tag and the request id.

Exports a route file may have: the HTTP methods plus Next's segment config (`dynamic`, `runtime`, `maxDuration`). Nothing else, because Next rejects other exports.

## What the wrapper does (in order)

| Step | What happens |
|---|---|
| 0. Module load | A bad spec throws on import (`routeSpecProblems`), so `next build` and the unit tests fail before production can. Checked: a public tier on a non-public route, `public-static` without `publicStatic`, `public-immutable` without `versionParam`, `owner` without `owner()`, a burst window over 300 s, side effects on a non-GET, a non-GET cron route, `rawBody` on a non-webhook route. |
| 1. Request id | Taken from `x-request-id` (from middleware), else a new UUID. It goes on the response, in every error body, and as the Sentry tag `request_id`. Exception: a successful `public-*` response (and its 304) carries no `x-request-id` and no `Server-Timing`, because the CDN replays it to every later client; the `api` log line still has the id. |
| 2. Test hooks | Only when `testHooksEnabled()`: `NEXT_PUBLIC_APP_ENV` is `dev` or `test` **and** `ALLOW_TEST_HOOKS=1`. `x-rc-fault: 401\|402\|429\|500\|503` answers that error at once. The 429 reads `x-rc-fault-retry`; the 402 reads `x-rc-fault-reason`. `x-rc-now: <epoch ms>` together with `x-e2e-token = E2E_TEST_TOKEN` sets `ctx.now`. With hooks off, both headers are ignored and the response is byte-identical. `__rc*` query keys are always stripped. |
| 3. Auth | `public` never calls `auth()`. `optional`, `user`, `member`, `owner` and `admin` read the Clerk JWT, then the viewer (one statement). The answers are 401 when there is no viewer, 402 with `details.reason` and `upgradeUrl` for a non-member (plus the top-level legacy mirror unless `LEGACY_402_MIRROR=off`), 404 when `owner()` is false, and 403 for a non-admin. `internal` checks `verifyInternalRequest(req, id)` (`lib/auth/internal.ts`). `cron` checks `Bearer CRON_SECRET`, timing-safe. `webhook` has no Clerk step; the handler verifies the signature on `ctx.rawBody`. |
| 4. Rate limit | `checkRateLimit()` (`lib/rate-limit-db.ts`) runs in parallel with the viewer read. A denial is a 429 `rate_limited` with `Retry-After` equal to `retryAfterSec`. When the database fails, the limiter fails open. The limiter's own upsert is not counted as a GET write. |
| 5. Body | Over `maxBodyBytes` (default 16 KiB, webhooks 256 KiB) is a 413, checked from `Content-Length` and again while streaming; the body is never fully buffered. Malformed JSON is a 400 `invalid_json`. |
| 6. Validation | `params`, `query` and `body` are checked with zod. A failure is a 400 `validation_failed` with `fields` (`path → message`) and `details.issues`. |
| 7. Handler | Errors are mapped as described above. |
| 8. GET purity | The Prisma extension in `lib/prisma.ts` counts writes per request. A GET that writes without declaring `sideEffects` is a 500 `get_wrote` in dev and test; in production it is logged. |
| 9. Response | The body is serialised by `serialize.ts`: Date becomes ISO, `undefined` is dropped, BigInt and Decimal throw in dev and test. Then the cache tier's headers are set (below). The ETag tiers answer 304 on `If-None-Match`. With `ROUTE_VALIDATE_RESPONSES=1` (dev and test), the response is parsed with `spec.response`. |
| 10. Errors | Every error uses the envelope `{ error: { code, message, fields?, details?, retryAfterSec?, requestId } }` with `Cache-Control: private, no-store`. 4xx responses are Sentry breadcrumbs; 5xx are captured. |
| 11. Telemetry | One `api` log line (route, status, code, durationMs, dbMs, dbStatements, mwLagMs, requestId, auth, cache, env), plus the metrics `api.duration_ms`, `api.status` and `api.mw_lag_ms`. Outside production, the response carries `Server-Timing: auth, rl, app, db, total`. |

## Cache tiers (`cache.ts`, plan §7.2.1)

| Tier | Headers | Use |
|---|---|---|
| `public-immutable` | `public, max-age=31536000, immutable` + ETag; the URL must carry `versionParam` | versioned catalogues (P8) |
| `public-static` | `public, max-age=0, must-revalidate` + `Vercel-CDN-Cache-Control: s-maxage, swr` + `Vercel-Cache-Tag` + ETag; never `Set-Cookie` | `GET /api/openings` |
| `public-short` | CDN 15 s, stale-while-revalidate 60 s | tournament lists (P12), share snapshots (P3) |
| `private-etag` | `private, no-cache` + ETag, 304 on match | `GET /api/me` |
| `no-store` (default) | `private, no-store` | everything else, and every error |
| `sse` | `no-cache, no-transform`, `text/event-stream`, `X-Accel-Buffering: no` | coach (P7) |

A `public-*` tier is allowed only with `auth: "public"`. Handlers never set `Cache-Control`; the tier owns it. A lifetime on a non-public response throws in dev and test. Per-viewer parts of a public resource go on a separate non-public path. `test/api/cache-tiers.test.ts` walks the whole registry.

## Files

| File | What |
|---|---|
| `route.ts` | `route()`, `Ctx`, `RouteSpec`, `readBodyBounded`, `routeSpecProblems` |
| `context.ts` | dependencies and the test seam (`getRouteDeps`/`setRouteDeps`), the default viewer loader (`lib/auth/viewer.ts` `getRouteViewer()`) and 402 reason (`reasonFor()`), `cachedData()`, `serverBuildId()`, `appEnvName()` |
| `respond.ts` | `respondWith`, `created`, `errorResponse`, `apiErrorResponse` |
| `api-error.ts` | server `ApiError` and the default messages |
| `serialize.ts` | JSON rules |
| `etag.ts` | `fnv1a64`, `strongEtag`, `ifNoneMatchHit` |
| `cache.ts` | tier headers, lifetime checks |
| `request-id.ts` | `requestIdFrom`, `mwLagMs` |
| `now.ts` | `resolveNow` (`x-rc-now`), `requestNow()` for server components |
| `timing.ts` | per-request DB store (AsyncLocalStorage), write classification, Server-Timing |
| `prisma-errors.ts` | Prisma code mapping, one GET retry |
| `paged.ts` | `paged()`, `shouldCountTotal()` |

## The viewer and the member gate (`lib/auth/`, 1B·F4a)

| Need | Use | Example |
|---|---|---|
| An API route for members | `route({ ...entry, auth: "member" })`: 401 / 402 `{ reason, upgradeUrl }` from the wrapper | `export const GET = route(trainEndpoints.bank, async (ctx) => listBank(ctx.viewer!))` |
| The viewer in a server component | `getViewer()` (React `cache()`, one `$queryRaw` with a `LEFT JOIN` on `chess_com_profiles`; provisions a first-time user) | `const viewer = await getViewer(); if (!viewer) return <SignedOut />;` |
| A member page (P2+) | `requireMemberPage()` (`lib/auth/require-member-page.ts`): signed out → `/sign-in`, not onboarded → `/onboarding`, non-member → `/pricing?reason=required\|ended&redirect_url=…` | `const viewer = await requireMemberPage({ returnTo: "/train/bank" });` |
| A server action or service | `requireMember()` / `requireViewer()` (`lib/auth/guards.ts`): throw `ApiError` 401 / 402 | `const viewer = await requireMember();` |
| A legacy handler (not `route()` yet) | `requireSubscribedUser(req)` (`lib/auth/require-subscription.ts`): same 402 body and reasons | `const { user, response } = await requireSubscribedUser(req); if (response) return response;` |

`Viewer` = `{ id, ref, clerkUserId, role, user (MeData.user), entitlement (MeData.entitlement), billing (server-only facts), gamesVersion }`. `toViewer()` / `toMeData()` are pure (`lib/auth/viewer.ts`); the rules live in `lib/auth/membership.ts` (`membershipStateOf`, `paymentIssueOf`, `reasonFor`, `upgradeUrlFor`). `GET /api/me` returns `meDataOf(viewer, flags, buildId)`; `POST /api/billing/refresh` is the only viewer-triggered Dodo read (`lib/billing/refresh.ts`). Tests build viewers with `viewerFixture()` (`test/helpers/route-harness.ts`).

## Tests

- `lib/api/*.test.ts`: unit tests. `route.test.ts` covers every branch above.
- `test/api/contract.test.ts`: the registry against every `route()` handler, as an auth and contract matrix.
- `test/api/cache-tiers.test.ts`: the tier invariants over the registry.
- `test/authz/walker.test.ts`: every `app/api/**/route.ts` must be `route()` or listed in `test/authz/legacy-routes.ts`. With `AUTHZ_BASE_URL` set, the signed-out statuses are checked over HTTP.
- `test/authz/access-matrix.test.ts`: plan §11.1.
- `test/integration/query-budget.int.test.ts`: statement budgets against `TEST_DATABASE_URL`.
- Helpers in `test/helpers/`: `route-harness.ts` (`installTestDeps`, `request`, `viewerFixture`), `route-modules.ts`, `query-counter.ts`.

Test env: `installTestDeps()` sets `NEXT_PUBLIC_APP_ENV=test`, which is strict mode. Turn hooks on with `env: { ALLOW_TEST_HOOKS: "1" }`.

## Contracts for P2–P12

One example each. "Where" is the file to read for the full API; "Add" is how a later phase extends it without editing Phase 1 files (registries are directories, `OWNERS.yml` `shared_add_only`).

### `api()` and `devSchema()` (`lib/api/client.ts`, `lib/api/schema.ts`)

The only client fetch for `/api/*`: JSON in and out, `{ data, meta? }` unwrapped, every failure an `ApiError` (`lib/api/errors.ts`) with `code`, `status`, `requestId` and `retryAfterSec`. 15 s timeout, caller `signal`, `idempotencyKey`, and `fault` (dev and test builds only) for the `x-rc-fault` hook. Response schemas are parsed in dev and test only. In client code write the condition at the call site so zod stays out of production chunks; `devSchema()` is for `/dev/**` pages and tests.

```ts
const schema = process.env.NODE_ENV === "production" ? undefined : MeData;
const { data } = await api(endpoints.me, { schema, signal });            // GET
await api(endpoints.billingRefresh, { method: "POST", idempotencyKey });  // POST
```

### `qk`, the query-key directory (`lib/api/keys/`)

One file per domain (`me.ts`, `catalog.ts`, `game.ts`, …), spread into `qk` by `index.ts`. `keys.test.ts` rejects a key in two files. Add: a new `keys/<domain>.ts` and one spread line.

```ts
useQuery({ queryKey: qk.me(), queryFn: ({ signal }) => fetchMe(signal) });   // or useQuery(meQuery)
queryClient.invalidateQueries({ queryKey: qk.me() });
```

### `QueryState` (`components/data/QueryState.tsx`)

Renders a region from a TanStack result: the designed skeleton while pending, `ErrorState` (inline error with Event ID + Try Again, offline, or the rate-limited countdown) on error without data, `empty` when `isEmpty(data)`, else `children(data)`. Never a spinner alone.

```tsx
<QueryState query={useQuery(openingsIndexQuery)} object="openings" fallback={<OpeningsSkeleton />}
  isEmpty={(d) => d.openings.length === 0} empty={<EmptyState title="No Openings Yet" />}>
  {(d) => <OpeningsList openings={d.openings} />}
</QueryState>
```

### `RetryCountdown` and `useRetryCountdown` (`components/system/`)

The V3RateLimited `inline` row for a `429 rate_limited`: "Too many requests. Try again in 0:30", counted with `performance.now()` deltas, `aria-disabled` on the host control until it ends, `rate_limited_shown` / `rate_limited_retry` telemetry. `ErrorState` uses it for queries; mutations use the hook.

```tsx
const save = useMutation({ mutationFn, meta: { errorUi: "inline" } });
const rl = useRetryCountdown(save, { routeId: "train.bank.save" });
<Button {...rl.controlProps} onClick={() => { if (!rl.limited) save.mutate(); }}>Save</Button>
<RetryCountdown countdown={rl} />
```

### `SessionExpiredModal`, `SessionWatcher` and `signOutEverywhere()` (`components/system/`, `lib/auth/sign-out.ts`)

Mounted once in the root layout (`<Providers sessionWatcher={<SessionWatcher />}>`). It opens "You’ve Been Signed Out" over any non-public route on an `api()` 401 that a Clerk reload does not fix, on a Clerk sign-out that was not ours (debounced 1.5 s; Clerk's route refresh is skipped so the member page stays put), on returning to the tab, or on an `rc-auth` broadcast. Any sign-out of your own goes through `signOutEverywhere()`.

```ts
openSessionExpired("api_401");                        // rarely needed: reactToApiError does it for api() 401s
await signOutEverywhere(clerk, { queryClient });       // account menu, "Use a Different Account", account deletion
```

### `@repo/analytics` (`packages/analytics/`, sinks in `lib/analytics/`)

The event registry (zod schema per event, one file per area in `src/events/`), the PII guard (`findPii`, `FORBIDDEN_PROPERTY_NAMES`) and `parseEvent()`. Client events go through `trackShell()` / `trackSystem()`; tests read them through the sinks (`e2e/fixtures/telemetry.ts`). See `packages/analytics/README.md`.

```ts
trackSystem("rate_limited_shown", { route_id: "health.get", bucket: "health-deep", retry_after_sec: 30, surface: "inline" });
```

### Rate limiter, burst and durable (`lib/rate-limit-db.ts`)

Declared on the registry entry (`rateLimit: { bucket, limit, windowSec, by, store? }`); `route()` runs it in parallel with the viewer read and answers 429 with `Retry-After`. `burst` (UNLOGGED `rate_limit_buckets`, windows ≤ 300 s) is the default; `durable` (`rate_limit_windows`, logged) is for quotas that must survive a crash (coach messages, P7). Fails open when the database fails. A non-route caller uses `checkRateLimit()` directly.

```ts
export const coachDaily = defineRateLimit({ bucket: "coach-daily", limit: 50, windowSec: 86_400, by: "user", store: "durable" });
const d = await checkRateLimit(coachDaily, { clerkUserId, ip });
if (!d.allowed) throw new ApiError("rate_limited", { retryAfterSec: d.retryAfterSec });
```

### `getFlags()` / `useFlag()` (`lib/flags/`)

Server: `getFlags(viewer)` (React `cache()`, PostHog with a 300 ms cap, registry defaults otherwise, `FLAGS_OVERRIDE` outside production). Client: `useFlag(key)` reads the values the server seeded. Add: `lib/flags/registry/pNN.ts` plus one spread line; each flag also needs a PostHog flag of the same key.

```ts
const flags = await getFlags(viewer);          // server component or route
if (!flags["shell-v3"]) return <MarketingChrome />;
const on = useFlag("shell-v3");                 // client component
```

### Webhook dedupe, `processWebhook()` (`lib/webhooks/record.ts`)

Claim → handle → record → side effects in `after()`. The claim is an insert into `webhook_events` on `(provider, eventId)`, so a replay returns `{ duplicate: true }` and does nothing else; a handler error marks the row `error` and answers 500 so the provider retries.

```ts
const { duplicate } = await processWebhook({
  provider: "dodo", eventId: msgId, type: event.type, eventTime, payload: event, receivedAt: ctx.now,
  handle: () => applyEvent(event), after: ctx.after, onProcessed: (o) => syncClerkClaims(o.userId),
});
```

### Billing compare-and-set (`lib/billing/entitlement.ts`)

`applySubscriptionSnapshot(snapshot, { source, userId?, now })` writes the billing columns only when the row has not changed since it was read and the snapshot is not older than `subscriptionSourceAt`; a no-op snapshot writes nothing. Outcomes: `applied`, `stale`, `unmatched`, or `error` with `cas_exhausted`. Every Dodo read for a viewer goes through `POST /api/billing/refresh` (no GET reads Dodo; its response also carries the scheduled plan change).

```ts
const outcome = await applySubscriptionSnapshot(subscription, { source: "webhook", now: ctx.now });
if (outcome.status === "applied" && outcome.changed) ctx.after(() => syncClerkClaims(outcome.userId));
```

### `syncClerkClaims()` (`lib/auth/claims.ts`)

Writes `{ v, onboarded, entitled, lapsed, trialUsed, role }` to the user's Clerk `publicMetadata` (the session token's `md` claim the middleware member gate reads) when they differ. Call it after any write that changes those columns, inside `after()`.

```ts
ctx.after(() => syncClerkClaims(viewer.id));
```

### Cron tasks (`lib/cron/tasks/`)

`GET /api/cron/daily` (Bearer `CRON_SECRET`) runs the ordered list in `tasks/index.ts`; a task that throws is reported `ok: false` and the next one still runs. Add: `tasks/<name>.ts` exporting `{ name, run(ctx) → { count } }` and one line in the list.

```ts
export const sessionSweep: CronTask = {
  name: "session-sweep",
  async run(ctx) { return { count: await deleteExpiredSessions(ctx.now) }; },
};
```

### Route classes (`lib/auth/route-classes/`, `docs/route-map.md`)

The middleware is frozen after P1; a route changes class through data. `classify(pathname)` returns `scanner | public | member | signed_in | api | api_no_clerk`. Add: `route-classes/pNN.ts` (`publicPages`, `memberPages`, `signedInPages`, `noClerkApi`) and one `PHASES` line; `route-classes.test.ts` checks it against the route map.

```ts
// lib/auth/route-classes/p05.ts
export const memberPages = ["/train(.*)", "/home"];
```

### `OWNERS.yml` (repo root)

Which phase owns which globs while it is active; `scripts/qa/check-owners.mjs` reports cross-phase touches (report-only until P4, then a PR needs `owner-ok:<phase>`). Registry directories are `shared_add_only`: any phase may add a file there.

```yaml
phases:
  p05:
    name: Train
    status: active        # planned → active at the first PR → done at sign-off
    globs:
      - apps/web/app/(app)/train/**
```
