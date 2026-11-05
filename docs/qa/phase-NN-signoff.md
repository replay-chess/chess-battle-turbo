# Phase NN sign-off record

<!--
Template (phase-01 plan §12.9, CT X15). Copy to docs/qa/phase-NN-signoff.md when
the phase's test window opens, fill it in during the window, and commit it with
the sign-off. Screenshots go to docs/qa/phase-NN/ (ego-browser page.screenshot).
The test window runs from the phase's last dev deploy to sign-off, at least 24 h.
Every defect found here gets a failing automated test first, named
`regression: <slug> (#issue)` (CT X14).
-->

| | |
|---|---|
| Phase | NN · <name> |
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
| T1 | | | `docs/qa/phase-NN/t1-….png` | |

## 3. Devices, browsers and zoom

| Device (model, OS version) | Browser (version) | Zoom levels | Result |
|---|---|---|---|
| | | | |

## 4. Design-state coverage

Paste `pnpm exec tsx scripts/qa/state-coverage.ts --only-phase NN`:

```
<table>
```

Design parity with the `.dc.html` boards (manual side-by-side: canvas board at its `$preview` size next to the route or demo route):

| Board | Route | Matches | Notes |
|---|---|---|---|

## 5. Error window

Paste `pnpm exec tsx scripts/qa/error-window.ts --since <last dev deploy>`; triage every new issue:

```
<output>
```

| Issue | Triage (fixed in / accepted because) |
|---|---|

## 6. Telemetry

PostHog live view (`app_env=dev`): events seen, none from local or CI.

## 7. Performance

| Scenario | Result file (`perf/results/pNN-<scenario>-<sha>.json`) | Threshold | Result | `perf/compare.ts` |
|---|---|---|---|---|

## 8. Defects found

| Defect | Issue | Regression test | Status |
|---|---|---|---|

## 9. Definition of done

Copy the phase's §15 checklist here and tick each line with its evidence.
