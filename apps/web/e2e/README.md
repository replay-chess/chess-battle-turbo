# End-to-end tests (`apps/web/e2e`)

Playwright suites for the web app (phase-01 plan §12.0, §12.3, §12.9; CT X1–X18). Two configs:

- `playwright.config.ts`: the spec suite (`e2e/specs/**`, Phase 0 specs, `flags-off`, `play-queue`, `prod-guard`, `webkit-iphone` in CI).
- `playwright.devices.config.ts`: the device × zoom layout suite and the UI/motion projects (`e2e/devices/**`), plus the visual baselines.

```sh
cd apps/web
set -a && source .env.test && set +a
npx playwright test                                   # spec suite (starts the web, socket and sink servers)
PW_REUSE_SERVER=1 npx playwright test e2e/specs/data-layer.spec.ts   # reuse running servers on 3000/3002/4011
E2E_PUBLIC_ONLY=1 npx playwright test                 # signed-out specs only (@public)
E2E_PHASES=1 npx playwright test                      # only @p1 specs
E2E_BASE_URL=https://<dev url> npx playwright test    # against a deployment (@local-only specs skipped)
pnpm test:devices                                     # devices config
```

Hook-dependent specs (the `x-rc-fault` buttons on `/dev/ui/data`, the session broadcast, telemetry) need a server with `NEXT_PUBLIC_APP_ENV=test` (or `dev`) and `ALLOW_TEST_HOOKS=1`. The servers Playwright starts set them; a reused `next dev` must have been started with them too. `shared-device.spec.ts` has a 1.5 s budget for `POST /api/session/clear` that a cold `next dev` compile can miss: run it against a build (CI does).

## Shared tools

| Tool | Where | What it does |
|---|---|---|
| Auth fixture | `fixtures/auth.ts` | `authedPage`, `nonMemberPage`, `playerA…P`: Clerk ticket sign-in (no passwords, no Device Trust prompt), then `GET /api/me` (provisions the row) and onboarding skip. On WebKit at `http://localhost` it stores Clerk's `Domain=localhost` cookies host-only, because Linux WebKit refuses them (CI D3). |
| Console guard | `fixtures/console-guard.ts`, `console-baseline.json` | Fails a test on an uncaught page error, `console.error`, a hydration mismatch, or an `/api/*` 5xx the spec did not inject. Options `consoleGuard: "enforce" \| "report" \| "off"` and `allowConsole: RegExp[]`. Legacy specs listed in `console-baseline.json` only report; the list may only shrink. |
| User registry | `fixtures/users.ts` | Roles: A–P shared members (only ADD data, never assert absolute counts), Q trial used and R never trialled (read-only), S payment persona, admin, pool `E2E_POOL_01…24`, throwaway users. `users.test.ts` enforces the rules. |
| Persona pool and lease | `fixtures/lease.ts`, `personas/pNN.ts`, `scripts/dev/personas.ts` | `leasePersona(name, testInfo)` resets the worker's pool user to an exact account state (slot = parallelIndex × 2 + index + 1). Specs that lease the same persona use `mode: "serial"`. Provision once per Clerk instance: `npx tsx e2e/scripts/provision-test-users.ts --pool --pool-range 1-4`. |
| Server time (`x-rc-now`) | `fixtures/time.ts` | `serverNow.set(iso)` adds `x-rc-now` and `x-e2e-token` (= `E2E_TEST_TOKEN`) to the page's `/api` requests, so `ctx.now` moves; pair it with `page.clock`. Ignored by production builds. |
| Telemetry | `fixtures/telemetry.ts`, `mocks/posthog-sink.ts` | `telemetry.expect(name, props, { source, count })` and `telemetry.forbid(text)`; every captured event is parsed with `@repo/analytics` and PII-checked (see `packages/analytics/README.md`). |
| Fixture health, sweeper, run lock | `global-setup.ts`, `fixtures/health.ts`, `scripts/sweep-throwaway-users.ts` | One E2E run at a time on the shared dev database (advisory lock), A–P re-entitled, Q/R/A–P checked, throwaway Clerk users older than 2 h removed. Local escape hatches: `E2E_SKIP_RUN_LOCK=1`, `E2E_SKIP_ENTITLE=1`, `E2E_SKIP_HEALTH=1`, `E2E_SWEEP=0`. |
| Test-hook guard | `specs/prod-guard.spec.ts`, `lib/test-hooks/` | `PROD_GUARD=1 npx playwright test`: a production-mode build with every hook switched on must 404 every dev route and ignore every hook header (see `lib/test-hooks/README.md`). |
| Quarantine | `quarantine.json` | `{ testId: "<spec path> › <describe> › <title>", reason, owner, expires, issue }`. PR CI skips the entries (`grepInvert`), nightly runs and reports them, an expired entry (more than 14 days) fails CI. Empty at P13. |
| Design-state tags | test titles | `@state:<Board>.<value>` (reached on a real route) and `@demo:<Board>.<value>` (on a `/dev/ui` demo). `scripts/qa/state-coverage.ts` reads them; see `docs/qa/README.md`. |
| Phase tags | test titles | `@p<N>`, `@smoke` (the CI e2e-smoke job), `@public` (signed out), `@local-only` (needs the local sinks or socket). |

## Visual tooling

Baselines live in `e2e/__screenshots__/` (`toHaveScreenshot`, `@visual` tests in the devices config). Update them only through CI: add the `update-snapshots` label to the PR, and `.github/workflows/update-snapshots.yml` regenerates them on Linux and pushes a commit. Local macOS renders differ, so never commit locally made baselines.
