# Clean-room record for `@repo/chess-training`

Phase-05 plan §11 (licences, feasibility LIC-4): the training domain is written from published descriptions and
documented APIs, never from AGPL code. This file records every source, so anyone can check it. The Glicko-2 module
it uses (`packages/game-core/src/rating/`) is covered here too.

## Rules

1. Nobody working on this package opens Lichess's server code (`lichess-org/lila`, AGPL-3.0), `lichess-puzzler`
   (AGPL-3.0) or its tagger (`cook.py`) while doing the work. Searching those repositories, reading their files on
   GitHub, or copying from answers that quote them all count as opening them.
2. Constants and formulas come from published papers, product documentation, the phase plan and the design boards,
   or from measurement against a documented library (the FSRS golden values below), never from reading an AGPL
   implementation.
3. MIT/BSD/Apache libraries are used as dependencies at a pinned version (`ts-fsrs` 5.4.2 MIT, `sqids` 0.3.0 MIT,
   `chess.js` 1.4.0 BSD-2-Clause), not copied into the source.
4. The npm production tree stays free of AGPL/GPL: the web app's and the worker's licence checks cover this package
   as a workspace dependency (`pnpm --filter @repo/chess-analysis license-check` reads the worker's whole tree).

## Sources used

| What | Source | Used for |
|---|---|---|
| FSRS scheduling | The FSRS algorithm papers and the `ts-fsrs` documentation (MIT; used as a dependency at 5.4.2, never copied) | `fsrs.ts` |
| FSRS configuration (retention 0.9, maximum 180 days, w[1..3] = 2/4/9, the again-only learning step) | Phase-05 plan §8.2 and owner decision D-8; values measured with ts-fsrs 5.4.2, fuzz off (golden values in `fsrs.test.ts`) | `fsrs.ts`, `fsrs.test.ts` |
| Glicko-2 | Mark Glickman, "Example of the Glicko-2 system" (2012), the published step-by-step description and its worked example | `game-core/src/rating/glicko2.ts` |
| Puzzle-rating seed, τ, RD floor/ceiling, provisional count | Phase-05 plan §8.7 and owner decision D-3 | `rating.ts`, `game-core/src/rating/presets.ts` |
| Theme keys and their meaning | The public theme descriptions on lichess.org/training/themes (the keys are the CC0 puzzle database's column values) | `themes.ts` (keys and labels only; no detector code lives here) |
| Picker order, labels, plan and summary copy, grade notes | The design boards (`V3TrainHub`, `V3PuzzleThemes`, `V3BankSession`, `V3MistakeBank`, `V3SessionSummary`) and the phase-05 plan §4, §8 | `themes.ts`, `plan.ts`, `grade.ts`, `labels.ts`, `caps.ts` |
| Explainer sentences | The phase-05 plan §8.12 templates and the design boards' coach lines; facts computed with chess.js (`moves`, `attackers`) | `explain.ts` |
| Cap, once-a-day rule, streak, mastery, session composition | Phase-05 plan §8.5–§8.10 (rct-b research notes summarised there) | `caps.ts`, `streak.ts`, `mastery.ts`, `session.ts`, `plan.ts` |
| Local day, release snapping, DST behaviour | Phase-05 plan §8.4 and the ECMAScript `Intl.DateTimeFormat` specification | `tz.ts`, `day.ts`, `release.ts` |
| Item keys | The `sqids` documentation (MIT dependency) and interface check §0.14 | `items.ts` |
| Fork fixture puzzles in tests | The Lichess puzzle database (CC0), ten rows copied verbatim with their ids | `explain.test.ts` |

## What was measured (WP-B, 2026-11-13)

ts-fsrs 5.4.2, fuzz off, a new card graded at 2026-11-05 19:00Z, before release snapping:

| Configuration | Again | Hard | Good | Easy |
|---|---|---|---|---|
| again-only strategy (production) | 10 min | 2 d | 4 d | 9 d |
| default strategy, one `10m` step (D-8 fallback) | 10 min | 15 min | 4 d | 9 d |
| second review of the Good card on its due day | 10 min | 13 d | 19 d | 32 d |
| a new card after one Again (the pass-2 copy, at +10 min) | 10 min | 1 d | 1 d | 1 d |

Glicko-2 worked example (τ 0.5; r 1500, RD 200, σ 0.06 against 1400/30, 1550/100, 1700/300 with scores 1, 0, 0):
r′ 1464.05, RD′ 151.52, σ′ 0.059996 — the paper prints 1464.06 / 151.52 / 0.05999 after rounding intermediate values.

## Confirmation

The implementer of WP-B (phase 5) did not open `lila`, `lichess-puzzler` or `cook.py` while writing this package.
