# `lib/api` — the API layer

Two halves live here:

- **Server:** `route()` and its helpers. Every new `app/api/**/route.ts` uses them (plan phase-01 §7.2, P1-05).
- **Client:** `api()`, query keys and queries (`client.ts`, `errors.ts`, `endpoints.ts`, `keys/`, `queries/`, `query-client.ts`, `legacy.ts`, `schema.ts`). They are owned by 1B·F3 and described in plan §7.12 and CDL §4.

This README covers the server half.

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
| 1. Request id | Taken from `x-request-id` (from middleware), else a new UUID. It goes on the response, in every error body, and as the Sentry tag `request_id`. |
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
