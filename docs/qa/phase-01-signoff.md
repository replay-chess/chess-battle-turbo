# Phase 1 sign-off record

<!--
Phase 1 record, from the template docs/qa/phase-NN-signoff.md (plan §12.9, CT X15).
Owner tests are plan §1 T1–T26; manual checks are SPEC §12.5 M1–M11 and plan §12.7
B1–B12. Screenshots go to docs/qa/phase-01/ (ego-browser page.screenshot).
The test window runs from the phase's last dev deploy to sign-off, at least 24 h.
Every defect found here gets a failing automated test first, named
`regression: <slug> (#issue)` (CT X14).
-->

| | |
|---|---|
| Phase | 1 · Design system, app shell and API foundations |
| Tested `dev` SHA | `6497d43` (code under test: `c167c59`; `4ed45a0` and `6497d43` change only a unit test and CI workflows) |
| Vercel deployment (replay-chess-dev) | `dpl_5RFFkG5g3T2RHGXgfz87hkMaSFnL` (6497d43, READY) · https://replay-chess-dev-replaychess007-1069.vercel.app; the browser run hit `dpl_9UjaEwgYp2ifKF3nmJu8FV1wQeFT` / `dpl_CW1FfwkSuzQVyotuyX7qUFAmT74P` (same app code) |
| OCI socket image tag (dev) | `ghcr.io/replay-chess/replay-chess-websocket:c167c596ac55671003fe9a9e72a6258eaed9ad76` (deploy-oci run 42052594425, green) |
| Test window | first dev run 2026-11-05 15:19 UTC (DEV-DEPLOY package). The ≥ 24 h window has **not** elapsed |
| Signed off by | not signed off: this is the first dev-site pass (DEV-DEPLOY, 2026-11-05). Owner items below are open |

## 1. CI evidence

| Run | Link | Result |
|---|---|---|
| `ci.yml` on `c167c59` | run 42052594553 | **red**: `verify` unit step, 7 `flags.test.ts` tests cancelled ("Promise resolution is still pending but the event loop has already resolved"; the cap timer is unref'd). Fixed in `4ed45a0` (test keeps a ref'd handle) |
| `ci.yml` on `4ed45a0` | run 42053783134 | verify green, integration green; **e2e-smoke red** at "Migrate and seed": `prisma:seed` ran before `prisma generate` (`ERR_MODULE_NOT_FOUND app/generated/prisma`). Fixed in `6497d43` (also in nightly and update-snapshots) |
| `ci.yml` on `6497d43` | run 42055085955 | verify green, integration green, authz walker green; **e2e-smoke red: 35 passed, 9 failed**, all 9 on `webkit-iphone` in the signed-in fixture (`GET /api/me failed: 401`). Chromium @smoke is fully green. See §8 D3 |
| `deploy-oci.yml` (dev socket) on `c167c59` | run 42052594425 | green; dev socket `/health` ok and socket.io polling handshake 200 afterwards |
| `nightly.yml` | — | not run: scheduled workflows run only from the default branch (`main`), and the file is not on `main` yet (`gh run list --workflow nightly.yml` → 404) |
| `post-deploy-dev.yml` for the final deployment | — | skipped ×3: the GitHub `deployment_status` events come from an older Vercel project (`chess-battle-turbo`, another account; environment "Preview – chess-battle-turbo", state failure), not from `replay-chess-dev`, so the job's `if` never matches. `workflow_dispatch` also needs the file on `main` |
| Quarantine (`apps/web/e2e/quarantine.json`): entries and expiry | — | unchanged by this pass |

## 2. Owner tests

| # | Check | Result (pass / fail) | Screenshot | Notes |
|---|---|---|---|---|
| T1 | Open `/play`, `/tournaments`, `/legends`, `/openings`, own `/profile/<ref>` at 1440×900, 1194×834, 834×1194, 393×852, 412×915 | pass | `docs/qa/phase-01/t1-*.jpg` | 25/25 route × viewport loads: 1440 → 220 px sidebar; 1194×834 → 64 px rail; 834×1194 → 52 px top bar + 64 px tab bar; 393/412 → 44 px top bar + 56 px tab bar. Current item `aria-current` on the right group (Play+Tournaments, Learn+Legends/Openings, Profile). No horizontal scroll; body font Geist. Emulated viewports in ego-browser (Chromium), not real devices |
| T2 | ⌘K, type "morphy" | pass | `docs/qa/phase-01/t2-palette-morphy.jpg` | First try on a cold function showed "Searching legends…" past 2.5 s; `/api/legends/search?name=morphy` answered 200 in 1.2 s. Second try: "Paul Morphy" row, Enter → `/legends/cmw34pzym0000slzplo9pa49m` |
| T3 | `?` then `g p` | pass | `docs/qa/phase-01/t3-shortcuts.jpg` | Shortcuts dialog opens with the Single-Key Shortcuts switch (on); Esc, then `g p` → `/play` |
| T4 | `/dev/ui/sections/overlays` → toast buttons | pass | t4-toasts-1440x900.jpg, t4-toasts-393x852.jpg | 5 toasts fired: 1440×900 → 3 visible, toaster top-right; 393×852 → 1 visible, bottom-centre |
| T5 | `/dev/ui/shell?user=payment`, `_last_day`, `_expired`; dismiss | pass | `docs/qa/phase-01/t5-*.jpg` | banner: "Your last payment failed. You keep access until Nov 12." + Update Payment + dismiss; last_day: no dismiss; expired: Renew Membership → `/pricing?reason=ended`, no dismiss. Dismiss → toast "Hidden for this session. Membership shows the payment issue." with Undo; Undo brings the banner back |
| T6 | `/dev/ui/stage` at zoom 80/100/110/125/150 % | pass | t6-stage-zoom80.jpg, t6-stage-zoom150.jpg | Zoom emulated as CSS viewport 1440×900 ÷ zoom with matching DPR: board fully in view and no page scroll at all five levels (150 %: 960×600 CSS px, board 496 px) |
| T7 | `/dev/ui/skeletons?variant=game\|review\|profile\|list` | pass | `docs/qa/phase-01/t7-skeleton-*.jpg` | All four compositions render (one `net::ERR_TIMED_OUT` on the first `profile` load, fine on retry) |
| T8 | POST `/api/legends/create` signed out / as A | pass (signed out) | — | Signed out: 401. Signed-in non-admin 403 was not re-run on the dev URL here; covered by `security.spec` (chromium green in CI run 42055085955) |
| T9 | As A, `POST /api/chess/game-over` | pass | — | 403 `forbidden` "This endpoint is only for the game server." for A's own game and for a foreign game; the foreign game's `game-by-ref` body is byte-identical before and after |
| T10 | `/api/user/email/anything@x.com`, `/api/user/<ref>` | pass | — | 404 and 404 |
| T11 | `game-by-ref/<ref of a game A is not in>` | pass | — | Signed-in fetch (curl got a Vercel Security Checkpoint challenge, §8 D5): 200, keys referenceId, creatorId, opponentId, chessPositionId, startingFen, time fields, status, gameData, creator, opponent; no `moveHistory`, no `traceContext`. Note: `creatorId`/`opponentId` are present in the invite projection (see §8 D6) |
| T12 | Hard-load `/play`; hard-load `/game/<ref>` | pass (network part) | — | `/play`: 0 `/api/me`, 0 `/api/user/sync`, 0 `/api/subscription`, 0 `/api/user/email/*` (no `/api/*` at all). `/game/<A's completed game>`: exactly 1 `/api/me` (plus game-by-ref and socket-token; the completed game then routes to `/play`). Sentry db-span part not checked (Sentry MCP not authenticated in this session) |
| T13 | `/dev/ui/data` Force 429, then Check Database ×7 | pass | `docs/qa/phase-01/t13-*.jpg` | Forced 429: "Too many requests. Try again in 0:29", button `aria-disabled=true`; re-enabled at 0:00; next click "3,641 openings loaded". Real limiter: requests 1–6 "Database OK", 7th → "Too many requests. Try again in 0:48"; direct `health?deep=1` → 429 with `Retry-After: 47` |
| T14 | `/too-many-requests?retry=10&from=/play` | pass | `docs/qa/phase-01/t14-countdown.jpg` | "Slow Down a Little"; "Try Again in 0:09" `aria-disabled`, then "Try Again" → `/play`. A direct document load answers 200 (the 429 status comes from the middleware rewrite, which is off: `EDGE_DOC_LIMIT=off`) |
| T15 | Revoke A's session, return to the tab; Simulate 401 | partial | t15-simulate-401-dialog.jpg, t15-revoked.jpg | Simulate 401: "You’ve Been Signed Out" dialog, "Returns to /dev/ui/data", Esc does not close it, Sign In Again → `/sign-in?redirect_url=%2Fdev%2Fui%2Fdata`, and with the session still valid Clerk sends the user straight back to `/dev/ui/data`. Real revoke (done with the Clerk Backend API on the dev instance instead of the dashboard): Clerk dropped the session within ~80 s on `/legends`; the page re-rendered as the signed-out public Legends page with **no dialog**. Same open decision as REGRESSION §4.1 (F4c + plan §4.9) |
| T16 | `/dev/ui/data` → Force 500 | pass (UI part) | `docs/qa/phase-01/t16-force500-toast.jpg` | Toast "Failed to load openings · Event c766dec7" + Retry; the response's `x-request-id` is `c766dec7-93b1-…`. Sentry event check not done (Sentry MCP not authenticated) |
| T17 | Dodo test-mode checkout as a fresh user | partial | — | Not run end to end (needs a fresh user and the Dodo dashboard, owner). Signed out: `POST /api/billing/refresh` 401; unsigned `POST /api/webhook/dodo-payments` 401 "Invalid webhook signature."; `POST /api/webhook/clerk` 503 `not_configured` (no `CLERK_WEBHOOK_SIGNING_SECRET`, owner). Replay/stale behaviour is covered locally by `webhooks.spec` (REGRESSION) |
| T18 | Friend game A vs B; illegal `accept_draw`; socket deploy mid-game | not run | — | Dev socket deployed (image above), `/health` ok, handshake 200. The two-user game and mid-game deploy need two signed-in browsers; not done in this pass |
| T19 | `/api/health` and `?deep=1` | pass | — | `{"data":{"ok":true,"buildId":"c167c59…","env":"dev","time":…}}`; deep adds `"db":{"ok":true,"ms":4.7}` |
| T20 | `curl -sI /api/openings` twice | pass | — | MISS then HIT; `cache-control: public, max-age=0, must-revalidate`; no `set-cookie`; strong etag `"4086e2c0a496c276"` |
| T21 | `/wp-login.php`, `/play` signed out | pass (with note) | — | `/wp-login.php` and any `*.php` → **403** from the Vercel firewall (`x-vercel-mitigated: deny`) before the app; other probe paths (`/.env`, `/.git/config`, `/x.aspx`, `/backup.bak`) → 404, no `x-clerk-*`, `x-robots-tag: noindex`. `/play` → 307 `/sign-in?redirect_url=…` with `x-robots-tag: noindex, nofollow` |
| T22 | Sign out from the account menu, then Back | pass (with note) | t22-account-sheet-phone.jpg, t22-after-back.jpg | Requests in order: `POST /api/session/clear` → 204, then Clerk `POST /v1/client/sessions/…`; lands on `/` with no session dialog; `chess-user-store` absent; Cache Storage = workbox precache + `start-url` (holds `/`, not a member page). `Clear-Site-Data: "cache"` is on the response (curl); Chromium does not expose it to DevTools/fetch. Back → URL `/play` but the signed-out home content stays rendered (no member page); a fresh load of `/play` redirects to sign-in (§8 D7) |
| T23 | CI runs on the final SHA, nightly, post-deploy-dev | fail | — | See §1: `ci.yml` e2e-smoke red on webkit-iphone (D3); nightly cannot run until it is on `main`; post-deploy-dev never triggers (D4) |
| T24 | `backup-live.yml` + `restore-check` | not run | — | Owner: live-DB backup activation and its secrets; scheduled workflows run only from `main` |
| T25 | "ops: weekly usage" issue | not run | — | `ops-weekly.yml` is scheduled, so it runs only from `main`; needs `NEON_API_KEY`, `VERCEL_TOKEN` secrets (owner) |
| T26 | Vercel env names; Neon console | partial | — | Set on `replay-chess-dev` (production target) in this pass: `ALLOW_TEST_HOOKS`, `FLAGS_OVERRIDE=shell-v3:on`, `MIDDLEWARE_MEMBER_GATE=off`, `LEGACY_402_MIRROR=on`, `EDGE_DOC_LIMIT=off`, `NEXT_PUBLIC_SITE_URL`. **Not set** (the secret-store write was refused by this session's permission policy, owner): `E2E_TEST_TOKEN`, `CRON_SECRET`, `RATE_LIMIT_IP_PEPPER`, `PERF_TOKEN`, `POSTHOG_FEATURE_FLAGS_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET`. `DATABASE_URL` still points at Neon branch `dev` of `withered-cake-82837167` (H10 deferred) |

### Manual checks (ego-browser; close every tab afterwards with `task.finish({ keep: [] })`)

| # | Source | Result (pass / fail) | Screenshot | Notes |
|---|---|---|---|---|
| M1 | SPEC §12.5 | | | |
| M2 | SPEC §12.5 | | | |
| M3 | SPEC §12.5 | | | |
| M4 | SPEC §12.5 | | | |
| M5 | SPEC §12.5 | | | |
| M6 | SPEC §12.5 | | | |
| M7 | SPEC §12.5 | | | |
| M8 | SPEC §12.5 | | | |
| M9 | SPEC §12.5 | | | |
| M10 | SPEC §12.5 | | | |
| M11 | SPEC §12.5 | | | |
| B1 | plan §12.7 | | | |
| B2 | plan §12.7 | | | |
| B3 | plan §12.7 | | | |
| B4 | plan §12.7 | | | |
| B5 | plan §12.7 | | | |
| B6 | plan §12.7 | | | |
| B7 | plan §12.7 | | | |
| B8 | plan §12.7 | | | |
| B9 | plan §12.7 | | | |
| B10 | plan §12.7 | | | |
| B11 | plan §12.7 | | | |
| B12 | plan §12.7 | | | |

## 3. Devices, browsers and zoom

| Device (model, OS version) | Browser (version) | Zoom levels | Result |
|---|---|---|---|
| Desktop 1440×900 | ego-browser (Chromium, ego lite 0.6.2.5) | 80, 100, 110, 125, 150 % (emulated, `/dev/ui/stage`) | pass |
| iPad (landscape 1194×834, portrait 834×1194) | ego-browser, Chromium device emulation (touch on) | 100 % | pass (shell layout). Real Safari not tested |
| iPhone 393×852 | ego-browser, Chromium device emulation | 100 % | pass (shell, toasts, account sheet). Real iPhone not tested |
| Android 412×915 | ego-browser, Chromium device emulation | 100 % | pass (shell layout). Real Android not tested |

## 4. Design-state coverage

Paste `pnpm exec tsx scripts/qa/state-coverage.ts --only-phase 1`:

```
<table>
```

Design parity with the `.dc.html` boards (manual side-by-side: canvas board at its `$preview` size next to the route or demo route):

| Board | Route | Matches | Notes |
|---|---|---|---|
| V3Nav | `/dev/ui/shell`, `/play` | | |
| V3CommandPalette | `/dev/ui/shell` (⌘K) | | |
| V3Shortcuts | `/dev/ui/shell` (`?`) | | |
| V3Toasts, V3iPhoneToasts, V3iPadPToasts | `/dev/ui/sections/overlays` | | |
| V3PaymentFailed | `/dev/ui/shell?user=payment…` | | |
| V3Skeletons | `/dev/ui/skeletons?variant=…` | | |
| V3EmptyStates | `/dev/ui/sections/controls` | | |
| V3RateLimited | `/dev/ui/data`, `/too-many-requests` | | |
| V3SessionExpired | `/dev/ui/data` (Simulate 401) | | |

## 5. Error window

Paste `pnpm exec tsx scripts/qa/error-window.ts --since <last dev deploy>`; triage every new issue:

```
<output>
```

| Issue | Triage (fixed in / accepted because) |
|---|---|

## 6. Telemetry

PostHog live view (`app_env=dev`, B10): `shell_*` and `rate_limited_shown` seen; none from local or CI.
Sentry event behind T16's Event id (B11): no email, no request body.

## 7. Performance

| Scenario | Result file (`perf/results/p01-<scenario>-<sha>.json`) | Threshold | Result | `perf/compare.ts` |
|---|---|---|---|---|
| `me` | | p95 < 150 ms, 304 rate > 95 % | | first result (no baseline) |

## 8. Defects found

| Defect | Issue | Regression test | Status |
|---|---|---|---|
| D1 `flags.test.ts` "PostHog timeout" cancelled on CI: the cap timer is unref'd and the never-resolving evaluator holds no handle, so the test process's event loop drained | — | the test itself (now holds a ref'd interval) | fixed in `4ed45a0` |
| D2 e2e-smoke / nightly / update-snapshots seeded before `prisma generate` | — | CI run 42055085955 passes the step | fixed in `6497d43` |
| D3 e2e-smoke `webkit-iphone`: every signed-in test fails in the fixture (`GET /api/me failed: 401`). The trace shows the Clerk ticket sign-in completes but no cookie at all is sent to `http://localhost:3000` afterwards (chromium, same run and same Clerk instance, is green; REGRESSION had 44/44 on macOS WebKit). Likely Linux WebKit cookie handling on `http://localhost`. Also: the GitHub secrets still point at the older Clerk dev instance (`optimal-urchin-38`), not the one `.env.test` and the dev site use | — | — | open |
| D4 `post-deploy-dev.yml` never runs: `replay-chess-dev` posts no GitHub deployment; the deployments on the repo come from an older Vercel project (`chess-battle-turbo`, another account) whose previews fail on every push | — | — | open (owner: Vercel Git settings) |
| D5 `curl` from this laptop gets the Vercel Security Checkpoint (403 `x-vercel-mitigated: challenge`) after a burst of requests; scripts and CI that hit the dev URL without the bypass header can be challenged | — | — | open (owner: Q-16 bypass secret / firewall) |
| D6 Invite projection of `game-by-ref` includes `creatorId` / `opponentId` (internal numeric ids) | — | — | to triage (plan asks only for no moveHistory / traceContext) |
| D7 Back after sign-out: URL shows `/play` while the signed-out home content stays rendered (client router), instead of the sign-in redirect; no member content | — | — | to triage |
| D8 Real session revoke on `/legends` drops to the public page without the "You’ve Been Signed Out" dialog | — | — | open decision (REGRESSION §4.1) |

## 9. Definition of done

Copy plan §15 here and tick each line with its evidence.
