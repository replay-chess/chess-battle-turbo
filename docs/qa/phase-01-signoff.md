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
| Final `dev` SHA | `<sha>` |
| Vercel deployment (replay-chess-dev) | `<dpl_…>` · <url> |
| OCI socket image tag (dev) | `<tag>` |
| Test window | <last dev deploy, ISO time> → <sign-off, ISO time> (≥ 24 h) |
| Signed off by | <owner> on <date> |

## 1. CI evidence

| Run | Link | Result |
|---|---|---|
| `ci.yml` on the final SHA (verify, integration, e2e-smoke) | | |
| `nightly.yml` (e2e-full, devices-full, visual, state-coverage, flags-off, dev-url) | | |
| `post-deploy-dev.yml` for the final deployment | | |
| Quarantine (`apps/web/e2e/quarantine.json`): entries and expiry | | |

## 2. Owner tests

| # | Check | Result (pass / fail) | Screenshot | Notes |
|---|---|---|---|---|
| T1 | Open `/play`, `/tournaments`, `/legends`, `/openings`, own `/profile/<ref>` at 1440×900, 1194×834 (iPad … | | | |
| T2 | ⌘K, type "morphy" | | | |
| T3 | `?` then `g p` | | | |
| T4 | `/dev/ui/sections/overlays` → toast buttons | | | |
| T5 | `/dev/ui/shell?user=payment`, `?user=payment_last_day`, `?user=payment_expired`; dismiss on `?user=payment` | | | |
| T6 | `/dev/ui/stage` at browser zoom 80/100/110/125/150 % | | | |
| T7 | `/dev/ui/skeletons?variant=game\|review\|profile\|list` | | | |
| T8 | `curl -s -o /dev/null -w "%{http_code}" -X POST <dev>/api/legends/create -H 'content-type: … | | | |
| T9 | As A, `POST /api/chess/game-over` for any game (DevTools fetch) | | | |
| T10 | `curl <dev>/api/user/email/anything@x.com` and `curl <dev>/api/user/<ref>` | | | |
| T11 | `curl <dev>/api/chess/game-by-ref/<ref of a game A is not in>` | | | |
| T12 | Hard-load `/play`, DevTools Network | | | |
| T13 | `/dev/ui/data` → "Load Openings (Force 429)" (calls the real `GET /api/openings` with `x-rc-fault: 429` … | | | |
| T14 | `/too-many-requests?retry=10&from=/play` | | | |
| T15 | Revoke user A's session in the Clerk dev dashboard (Users → A → Sessions → Revoke), then return to the tab | | | |
| T16 | `/dev/ui/data` → "Force 500" | | | |
| T17 | Dodo test-mode checkout with the test card as a fresh user | | | |
| T18 | Friend game between A and B on the dev site; B tries `accept_draw` without an offer (DevTools `socket.emit`) | | | |
| T19 | `curl <dev>/api/health` and `?deep=1` | | | |
| T20 | `curl -sI <dev>/api/openings` twice | | | |
| T21 | `curl -sI <dev>/wp-login.php` and `curl -sI <dev>/play` (signed out) | | | |
| T22 | Sign out from the shell account menu, then press Back | | | |
| T23 | GitHub Actions: the latest `ci.yml` run on the final `dev` SHA, the latest `nightly.yml` run and the … | | | |
| T24 | GitHub Actions: `backup-live.yml` (last night) and its weekly `restore-check` job | | | |
| T25 | GitHub issue "ops: weekly usage" opened by `ops-weekly.yml` | | | |
| T26 | Vercel project `replay-chess-dev` → Settings → Environment Variables (names only) and the Neon console | | | |

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
| Desktop 1440×900 | | 80, 100, 110, 125, 150 % | |
| iPad (landscape 1194×834, portrait 834×1194) | Safari | 100, 110 % | |
| iPhone 393×852 | Safari | 100, 110 % | |
| Android 412×915 | Chrome | 100, 110 % | |

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

## 9. Definition of done

Copy plan §15 here and tick each line with its evidence.
