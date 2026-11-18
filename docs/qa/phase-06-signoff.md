# Phase 06 sign-off record

<!--
Template (phase-06 plan §12.7, §15; phase-01 plan §12.9, CT X15), filled during the test window and committed with
the sign-off. Screenshots go to docs/qa/phase-06/ (ego-browser page.screenshot). The test window runs from the phase's
last dev deploy to sign-off, at least 24 h. Every defect found here gets a failing automated test first, named
`regression: <slug> (#issue)` (CT X14).
-->

| | |
|---|---|
| Phase | 06 · Weakness Profile |
| Final `dev` SHA | `<sha>` |
| Vercel deployment (replay-chess-dev) | `<dpl_…>` · https://replay-chess-dev-replaychess007-1069.vercel.app |
| OCI images (dev) | socket `<tag>` · worker `<tag>` |
| Test window | <last dev deploy, ISO time> → <sign-off, ISO time> (≥ 24 h) |
| M6 on the dev branch | `prisma migrate deploy` run at <time>; role scripts `replay_app.p6.sql`, `replay_worker.p6.sql` |
| Backfills on dev | B-W1 <rows>, B-W2 <rows>, B-W3 <members> (dry run, then `--apply`; audit_logs ids) |
| Signed off by | <owner> on <date> |

## 1. CI evidence

| Run | Link | Result |
|---|---|---|
| `ci.yml` on the final SHA (verify, integration, e2e-smoke incl. the P6 step, devices-p5 incl. the P6 steps) | | |
| `nightly.yml` (e2e-full, devices-full, visual incl. `layout/p06.visual.spec.ts`, flags-off, `weakness-recompute-check`) | | |
| `weakness-recompute-check` matched once (0 differences) | | |
| Quarantine (`apps/web/e2e/quarantine.json`): entries and expiry | | |

## 2. Owner tests (plan §1.2, dev site, ego-browser)

| # | Check | Result (pass / fail) | Screenshot | Notes |
|---|---|---|---|---|
| T1 | insufficient: zero and preliminary | | `docs/qa/phase-06/t1-….png` | |
| T2 | link Chess.com / Lichess → computing with a real ETA → the Train dot → the profile | | | |
| T3 | the profile: rows, accordion, See all, tabs, strengths | | | |
| T4 | drill config 10 / 20, mix | | | |
| T5 | the drill in the runner, the summary, the bank cap untouched | | | |
| T6 | the time-pressure drill (own positions only) | | | |
| T7 | failed → Retry → computing; the 10-minute limit | | | |
| T8 | the bullet offer | | | |
| T9 | iPhone, Android, iPad portrait and landscape, desktop 80–150 % | | | |
| T10 | the hub row, the plan footnote, Home's line | | | |
| T11 | a non-member: pricing, 402 | | | |
| T12 | flag off: P5 unchanged | | | |
| T13 | `/weakness` redirect, signed out | | | |

## 3. Devices, browsers and zoom (plan §12.7 items 2–3)

| Device (model, OS version) | Browser (version) | Zoom levels | Result |
|---|---|---|---|
| | | | |

## 4. Design-state coverage

Paste `pnpm exec tsx scripts/qa/state-coverage.ts --only-phase 6 --phase 6` (0 missing; the five `loading` values are
demo-only with their reason in docs/qa/design-states.overrides.json):

```
<table>
```

| Board | Route | Matches | Notes |
|---|---|---|---|
| V3WeaknessProfile / -Insufficient / -Computing / -Drill | /train/weakness, /train/weakness/<slug> | | |
| V3iPhone / V3Android / V3iPadP / V3iPadL WeaknessProfile | /train/weakness | | |

## 5. Error window

Paste `pnpm exec tsx scripts/qa/error-window.ts --since <last dev deploy>`; triage every new issue:

```
<output>
```

## 6. Telemetry

PostHog live view (`app_env=dev`): `weakness_viewed`, `weakness_row_expanded`, `weakness_tab_changed`,
`weakness_drill_*`, `weakness_ready_seen`, `weakness_recompute_clicked`; server `weakness_snapshot_computed`,
`weakness_first_ready`. None from local or CI.

## 7. Performance

| Scenario | Result file | Threshold | Result | `perf/compare.ts` |
|---|---|---|---|---|
| k6 `weakness.js` cold / revalidate / recompute_burst / drill_start (dev) | `perf/results/p06-weakness-<sha>.json` | p95 160 / 80 / one 202 per member / 250 ms | | |
| explain-hot-queries (P6 rows, index check) | CI log | no Seq Scan, indexes present | | |
| `pnpm --filter analysis-worker bench:weakness --users 20 --games 300` | | p95 < 2 s | | |
| `/train/weakness` route JS / RSC flight | bundle budget CI / request-budget.spec | ≤ 90 KB gz / ≤ 12 KB | | |
| Neon CU-h before / after the window | | | | |

## 8. Defects found

| Defect | Issue | Regression test | Status |
|---|---|---|---|

## 9. Definition of done (plan §15)

Copy plan §15 here and tick each line with its evidence.
