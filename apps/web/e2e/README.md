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
E2E_WEB_BUILD=1 npx playwright test                   # against `pnpm start` (after `pnpm build`): also runs the @prod-build specs
E2E_PORT_OFFSET=300 npx playwright test               # every server +300 (a second worktree; a build needs NEXT_PUBLIC_WEBSOCKET_URL=ws://localhost:3302)
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
| Phase tags | test titles | `@p<N>`, `@smoke` (the CI e2e-smoke job), `@public` (signed out), `@local-only` (needs the local sinks or socket), `@prod-build` (needs a production build: skipped against `next dev`). |

## Phase 3: review specs and the analysis worker

`e2e/specs/review/**` (phase-03 plan §12.3) import `test`/`expect` from `specs/review/_lib/review.ts`: `member(letter)` signs the test's own page in (guarded, telemetry recorded), `seeded` makes sure member A has the P3 review seed (packages/db/seed/review.ts; idempotent, under an advisory lock) and returns its refs, `persona(name)` leases a P3 persona (`e2e/personas/p03.ts`: `review-empty`, `review-terminal`, `review-lapsed`), `resetProgress(ref)` clears the walkthrough of the one seeded game a spec owns. `specs/review/demo/**` run the `/dev/ui` demos.

| Piece | What |
|---|---|
| Analysis worker | `fixtures/analysis-worker.ts`: Playwright starts it on :3003 from source. Against a local database (CI, Docker) it is `APP_ENV=test`, `ENGINE=fake`, role `E2E_WORKER_DATABASE_URL` (replay_worker); against the Neon dev branch `APP_ENV=dev` with the native Stockfish and role of `apps/analysis-worker/.env.local-dev`. |
| Key ring | `INTERNAL_API_SECRET` holds `web`, `ws` and `wk` keys; the web signs with the first, the socket and the worker reorder the ring to sign with `ws` / `wk` (`ringSignedBy`). |
| Worker faults | `kickWorker({ watch, fault })` (`specs/review/_lib/games.ts`) arms `hold_queue`, `pause_at:<phase>:<ms>`, `fail_at_ply:<n>` through the signed kick body; only an `APP_ENV=test` worker honours it, so those tests carry `@worker-faults` and a run on the Neon dev branch leaves them out. A dev-branch run of `review-live.spec.ts` needs the worker started with `E2E_WORKER_FAULT=pause_at:writing:5000`. |
| Serial specs | `specs/review/serial/**` run in the one-worker `game-serial` project: `hold_queue` holds the whole worker, and every leased persona then lands on pool user 1. |
| `lapsed-read` | `--project=lapsed-read` serves the same build with `review-lapsed-read:on` (:3111) and runs the `@lapsed-read-on` test of `serial/review-lapsed.spec.ts`. |
| Another env file | `E2E_ENV_FILE=/abs/path` replaces `.env.test` for both configs, e.g. a copy pointing at a local Docker database for a CI-like run. |

## Visual tooling

Baselines live in `e2e/__screenshots__/` (`toHaveScreenshot`, `@visual` tests in the devices config). Update them only through CI: add the `update-snapshots` label to the PR, and `.github/workflows/update-snapshots.yml` regenerates them on Linux and pushes a commit. Local macOS renders differ, so never commit locally made baselines.

## Phase 4: onboarding, connected accounts, checkout activation, import

`e2e/specs/{onboarding,accounts,checkout,archive}/**` (phase-04 plan §12.4) import `test`/`expect` from
`specs/onboarding/_lib/p04.ts`: `leasePersona(name)` signs `page` in as this worker's pool user, resets it to a P4
persona (`e2e/personas/p04.ts`) and refreshes the session's claims; `freshUser` (fixtures/fresh-user.ts) is only for
checkout/activating.spec.ts; `upstream` drives the mock; `p4db` reads the e2e database.

| Piece | What |
|---|---|
| Upstream mock | `mocks/upstream-server.ts` on 4010 (+ offset), started first by `playwright.config.ts`: Chess.com (handle kinds `knightowl88xx…` 404, `quiet…` 410, `closed…`, `empty…`, `ratelimited…` 429, `blocked…` 403 for the web / found for the worker, `boom…` 503; anything else is the knightowl_88 fixture renamed), Lichess (a consent page with Approve / Deny and a username field, PKCE, token revoke recorded per username, the NDJSON export paced at 20 games/s and refused with an `Authorization` header), Dodo (checkouts, the hosted pay page, signed `subscription.active`; per-customer `decline`, `webhook`, `webhookDelayMs`, `pendingUntilWebhook`). `mocks/upstream-client.ts` is the specs' handle (`fault`, `delay`, `dodoFor`, `revokesFor`, `requestsFor`). The web reads `/chesscom`, `/lichess` (via `localhost`, so the OAuth redirect stays same-site), `/dodo`; the worker `/chesscom-worker`, `/lichess-worker`. |
| Signed webhooks | `fixtures/dodo-webhook.ts`: `trialSubscription`, `paidSubscription`, `paymentData`, `sendDodoWebhook` (Standard Webhooks, `DODO_PAYMENTS_WEBHOOK_KEY`). |
| Onboarded letters | The auth fixture never calls an onboarding endpoint: A–R are provisioned onboarded (`provision-test-users.ts` `onboardedFields`, `syncFixtureClaims`; global setup does A–P every run), a fresh row of a registered user is provisioned on first sign-in, tournament joiners use `markOnboardedForE2E`. |
| Serial | `specs/onboarding/serial/**` runs in `game-serial`: Chess.com's 429 pauses the worker's Chess.com gate for every caller. |
| Devices | `devices/layout/{onboarding,settings-connected,activating}.spec.ts` (one viewport, tap targets, CLS), `devices/layout/routes.real.ts` (P4 pages), `devices/ui/onboarding.a11y.spec.ts`, `devices/layout/p04.visual.spec.ts` (baselines made in the official image through a loopback proxy, so the page origin is `http://localhost`: a secure context). |
| Debugging | `E2E_SERVER_LOGS=1` prints the web and worker servers' stdout; `E2E_WORKER_LOG_LEVEL=info` the worker's claims. |

