# Test hooks (`lib/test-hooks/`)

Every switch that exists only for tests is listed in `registry.ts` (phase-01 plan §11.6, CT X12): dev routes, request headers, env variables and fixture data. Each entry names its guard, and the guard must be one of four functions:

| Guard | Defined in | True when |
|---|---|---|
| `testHooksEnabled()` | `lib/env-server.ts` | `NEXT_PUBLIC_APP_ENV` is `dev` or `test` **and** `ALLOW_TEST_HOOKS=1` (never `VERCEL_ENV`) |
| `isNonProdApp()` | `lib/billing/products.ts` | `NEXT_PUBLIC_APP_ENV` is `dev` or `test`, or unset outside a production build |
| `devRoutesEnabled()` | `lib/env.ts` | `/dev/**` pages may render (fails closed) |
| `isTestBuild()` | `lib/env.ts` | `NEXT_PUBLIC_APP_ENV=test` (client-side hooks, which cannot read the server-only flag) |

Hooks in P1 include `x-rc-fault` (forced 401/402/429/500/503), `x-rc-now` + `x-e2e-token` (server time), `x-perf-token`, the telemetry sink, the `/dev/**` routes and the E2E fixture product.

## Adding a hook

1. Guard the code with one of the functions above. Never a new guard, never an inline env check.
2. Add one entry to `registry.ts` (route, header, env or data), naming the guard and the file.
3. `registry.test.ts` fails if a file under `app/dev/**`, `app/api/dev/**` or `app/api/test/**` has no entry, or an entry names another guard.

```ts
// registry.ts: one entry per hook; `probe` is what prod-guard.spec.ts sends to prove it is inert
{
  kind: "header",
  id: "x-rc-fault",
  phase: 1,
  guard: "testHooksEnabled",
  description: "route() answers the injected error envelope (401|402|429|500|503)",
  headers: { "x-rc-fault": "500" },
  probe: { method: "GET", path: "/api/health" },
},
```

## Proving production is inert

`e2e/specs/prod-guard.spec.ts` builds the app in production mode, starts it on :3200 with every hook switched on (`ALLOW_TEST_HOOKS=1` and the rest), and checks that every registered route answers 404, every header is ignored (byte-identical response) and every env hook does nothing:

```sh
cd apps/web && set -a && source .env.test && set +a
PROD_GUARD=1 npx playwright test
```
