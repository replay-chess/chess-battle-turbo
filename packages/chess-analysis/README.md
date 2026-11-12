# `@repo/chess-analysis`

The grading library of Game Review (phase-03 plan §8). Pure TypeScript with one dependency (chess.js 1.4.0): no I/O,
no clock, no randomness. The analysis worker grades with it, the web builds review payloads, PGNs and legend
summaries with it, the seeds write what the worker would write, and the tests pin it.

Import by subpath so a client bundle takes only what it uses: `@repo/chess-analysis/<module>` (e.g. `/codec`,
`/text/reasons`, `/legend/summary`), fixtures as `@repo/chess-analysis/fixtures/<name>`. The barrel (`.`) re-exports
everything except the template helpers in `text/facts`.

## Modules

| Module | What it does |
|---|---|
| `codec` | Storage and wire encodings: JudgementCode (0–12, append-only) and `j` chars, MoveCode, evals (cp / mate), `second`, move numbers, progress deltas (`mergePlies`) |
| `version` | `GRADING_VERSION`, the `sf18-v1` engine profile, `analysisFreshness` (current / regrade / rerun) |
| `winpct`, `accuracy` | Win%, move accuracy, game accuracy, phase accuracy (`phaseBounds`) |
| `board`, `replay`, `see`, `divider` | FEN facts, the game replay, static exchange evaluation, the phase divider (scalachess port) |
| `classify` | The 12 labels, rules 1–6 of §8.4 (11 emitted in v1) |
| `moments` | Key moments (3 at most, spaced), the clean game, the best decision, pass-2 helpers (`trimPv`, `acceptMoves`, `pass2Candidates`) |
| `intent` | The engine's plan (attack / trade / defend / improve) and the chip feedback |
| `text/*` | Template text, engine facts only: `reasons` (the move-list line), `phase`, `summary` (and the turning point), `ask`, `why`, `headline`, `clean` (best decision, clean loss), `coachline`; `facts` holds the chess.js fact finders they share |
| `review` | One member's `ReviewContentV1` document |
| `analysis` | `gradeAnalysis`: the whole grading of a finished game (judgements, counts, accuracy, division, phase accuracy, `lines`, the reviews) |
| `regrade` | `regradeAnalysis`: the same from a stored `game_analyses` row, no engine |
| `legend/slice`, `legend/compare`, `legend/summary` | The legend's continuation from a position (ported from the legacy route), `compareWithLegend` facts, and the comparison texts and tables |
| `pgn` | `buildAnnotatedPgn` (Download PGN, Copy PGN, A8) |
| `book` | The book set from the `openings` lines, keyed by EPD; `deepestOpening` |

## How the worker uses it (WP-C)

1. `replayUci` → pass 1 → `classifyGame` streams labels as evals arrive (`codec` deltas for `analysis:progress`).
2. When pass 1 is complete: `gradePlies` / `classifyGame` once more, then `pass2Candidates({grades, members,
   startMover, fens, uci, reserve})` names the ≤ 6 positions for the 1M-node MultiPV-3 search (reserve 2 for a
   legend divergence).
3. Per pass-2 ply build `LineFacts = { pv, accept: acceptMoves(multipvLines, mover) }`; overwrite the evals pass 2
   refined.
4. `gradeAnalysis({startFen, startPly, moves, evals, second, best, lines, isBook, members})` gives every column of
   the final batch: `judgements`, `counts`, `accuracy`, `division`, `phaseAccuracy`, `lines` (LinesV1) and
   `reviews[side]` (`ReviewContentV1`, validate with `buildReviewContent` from `@repo/db/json` before writing).
   `reviews[side].coachLine.t`, `.headline`, `.isClean`, `.moments.length` feed `analysis:done` and `game_players`.
5. A stored row with an old `version` and the same profile: `regradeAnalysis({stored, game, members, isBook})`.
6. Legend games: `legendLineFrom(pgn, startFen)` + `compareWithLegend(...)` for the facts row;
   `legendSummary`/`comparisonParagraph`/`summaryLine` for the DTOs (web DAL).

## Formulas, with citations

Every number below is re-implemented under the clean-room rules (`CLEANROOM.md`): constants from published
documentation, open points settled by measurement against published results, never from reading AGPL code.

| Quantity | Formula | Where | Source |
|---|---|---|---|
| Win% of a stored eval | `cp` = the eval clamped to ±1000 (a mate counts as ±1000); `Win% = 50 + 50 · (2 / (1 + e^(−0.00368208 · cp)) − 1)`, so Win% ∈ [2.46, 97.54] | `winpct.ts` (`WIN_K`, `WIN_CP_CLAMP`) | The published Lichess "Accuracy" description (plan §8.2, RES §3.1); the clamp is R-ENG-02 |
| Move accuracy | `d = max(0, Win%before − Win%after)` (mover's POV); `100` when `d = 0`, else `clamp(103.1668100711649 · e^(−0.04354415386753951 · d) − 3.166924740191411 + 1, 0, 100)` | `accuracy.ts` `moveAccuracy` (`ACC_A`, `ACC_B`, `ACC_C`, `ACC_BONUS`) | The same description, with its published "+1 uncertainty bonus" (RES §3.1) |
| Game accuracy | The mean of (the volatility-weighted mean of the side's move accuracies, their harmonic mean); window `w = clamp(⌊plies / 10⌋, 2, 8)`, weight = the population standard deviation of each window's Win% clamped to [0.5, 12]; every move accuracy enters the harmonic mean floored at 1; the series starts at position 0 (15 cp when its eval is unknown) | `accuracy.ts` `gameAccuracy`, `volatilityWeights` | RES §3.2–3.3; the three open points (series start, floor, ÷ N) measured on 196 Lichess player accuracies, `accuracy.oracle.test.ts` (all within ±0.5 of Lichess's integer) |
| Phase accuracy | `gameAccuracy` on each phase slice of the series; fewer than 2 moves in a phase = `-1` ("not reached") | `accuracy.ts` `phaseAccuracy` | Plan §8.2, R-ACC-02 |
| Phase division | scalachess `Divider` (majors and minors, backrank sparse, mixedness) | `divider.ts` | scalachess `Divider.scala` at tag 18.1.0, MIT (`NOTICE.md`); 30/30 oracle games match exactly |
| Labels | Rules 1–6 of §8.4, first match wins: FORCED; BOOK; the mate rules; `d ≥ 15 / 10 / 5` → BLUNDER / MISTAKE / INACCURACY; MISS; BRILLIANT / GREAT / BEST / EXCELLENT (`d ≤ 2`) / GOOD (`2 < d < 5`) | `classify.ts` (header lists every threshold) | RES §4.3 (the thresholds from Lichess's public documentation and observed exports); the GREAT band and the BRILLIANT guard are the plan's own |
| Static exchange | Least-valuable-attacker exchange on one square, each side free to stop; values 1/3/3/5/9, promotion to a queen | `see.ts` (`see`, `seeExchange`) | Textbook SEE; chess.js legal moves for pins and x-rays |

The display rule (R-ACC-04): accuracy is shown as `Math.round()` and only once the analysis is DONE.

## Version bump procedure (plan §8.14, P3-D9, P3-D28)

Two numbers describe a stored analysis: `game_analyses.version` (= `GRADING_VERSION`, the classifier) and
`game_analyses.engine` (`<engine build>/<profile id>`, the search). `analysisFreshness` (`version.ts`) reads them:
`current`, `regrade` (same profile, older classifier: no engine work) or `rerun` (another profile).

**A classifier-only change** (a threshold, a label rule, a template, the moments, the texts):

1. Make the change with its tests; regenerate the template snapshots (`templates.test.ts`) and the label fixtures'
   expectations, and review every diff (they are what members will read).
2. Bump `GRADING_VERSION` and set `GRADING_CHANGED_AT` to the release day in `src/version.ts` (How we grade prints it).
3. Update `apps/web/app/how-we-grade/content.ts` if a threshold or a label's wording changed.
4. Ship. Nothing is migrated: an opened review with an older `version` sends A3 `{reason: "regrade"}` (priority
   USER_OPENED) and the worker re-grades it from the stored `evals`, `second`, `best` and `lines`
   (`regradeAnalysis`, about 10 ms of CPU, one final batch); the HOUSEKEEPING `regrade-sweep` slice re-grades up to
   200 more a day, newest first, at HOUSEKEEPING priority. Old reviews stay readable meanwhile (the payload carries
   `version`).
5. Watch the worker's `jobs.failed` metric (`/internal/metrics`) and the `analysis_failed` events for a day.

**A profile change** (nodes, MultiPV, the pass-2 budget, the hash, the Stockfish build):

1. Give `ENGINE_PROFILE` a new `id` (`sf18-v2`, never a reused one) and change the numbers in `src/version.ts`; the
   worker refuses to boot when `ENGINE_PROFILE` / `ENGINE_THREADS` / `ENGINE_HASH_MB` in its env differ from it.
2. Re-run the C1 bench on the dev VM (`apps/analysis-worker/README.md` "Engine profile") and record the numbers.
3. Regenerate the goldens and the eval-cache seed for the new profile (the cache keys on `(engine, nodes, multipv)`,
   so the old rows simply stop matching); run `eval-provenance` on arm64.
4. Bump `GRADING_VERSION` too if labels change because of it.
5. Every stored analysis is now `rerun`: re-analysis is engine work, so it happens only when a review is opened
   (A3) or through an owner-run backfill (`packages/db/scripts/backfill/enqueue-analysis.ts`, newest first, a
   budgeted number a day); never all at once.

## Decisions recorded here (plan §14, P3-D10)

- **Eval cache and label stability (REGRESSION-3, 2026-11-12).** The first local `make-golden.ts --stability` run
  (WP-H, native SF18) kept the warm-cache labels at 100 % but graded 14–24 % of the plies differently after a crash
  and resume at ply 20: the worker sent `ucinewgame` once per run, so the reference run searched ply 20 with a
  transposition table warmed by plies 0–19 and the resumed run searched it cold. The fix is in the engine use, not
  the cache: the worker clears the engine (`ucinewgame` + `isready`) before EVERY search (`WK/src/pipeline/search.ts`),
  so a position's facts depend only on (position, moves since the last irreversible move, budget, build). A cache hit
  then equals a fresh search exactly, so the cache stays on and P3-D10's bypass is not needed. Re-run locally on
  3 games (293 plies): warm cache 100 % / crash + resume 100 % labels, moments identical, accuracy Δ 0.00; `--check`
  byte-identical. Cost: +4 % wall time (30.5 s → 31.7 s for the 3 games, native M4). The nightly `p3-label-stability`
  on arm64 still has to pass one night (stage B).
- **Engine profile.** `sf18-v1` is frozen provisionally with the plan's default (pass 1 = 120k nodes); the dev-VM
  bench of task C1 runs in stage B (`version.ts`).
- **Book set size (confirmed 2026-11-12: the acceptance counts positions).** Task A6's acceptance says "≥ 25k EPDs"; the
  plan's own §9.4 estimate ("~30–40k EPDs from replaying every openings.pgn") counts positions along the lines. The seed
  lines (3,641 on the five openings TSVs) give 34,904 positions and 7,484 distinct EPDs (`book.test.ts` asserts both).
  Reaching 25k distinct EPDs needs more opening lines than the product owns (a new, licensed source), so A6 reads
  "positions". A larger book needs a new licensed source of opening lines and is not part of Phase 3.
- **Three plan expectations the plan's own rules contradict (confirmed 2026-11-12: the rule text wins).** The code
  follows the rule text where the plan disagrees with itself; `fixtures/labels/design-mock.ts` DIFFERENCES records each
  with its numbers:
  1. §8.4 expects CLEAN `26.Rd1` to be GREAT; rule 6's `10 ≤ Wb ≤ 90` excludes it (mock eval +680 → Wb 92.44), so it
     is BEST. Widening the band would change the How we grade numbers.
  2. §8.4 / P3-D15 expect GAME `44.Rxf6` to be INACCURACY; the mock evals give a loss of 3.14 (< 5), so rule 4 does not
     fire and it is GOOD. Forcing INACCURACY would need an eval the mock does not have.
  3. Rule 6 says BRILLIANT needs `cpBefore ≤ +300`, yet §8.4 lists `16.Qb8+` (a position that is already a forced mate,
     +880 in the mock) as BRILLIANT and §8.6's template "a sacrifice that forced mate" needs it. The guard is read as
     applying to centipawn evaluations: a sacrifice after which the mover has a forced mate is exempt; a non-mating
     sacrifice above +300 is still not BRILLIANT (`classify.ts` header).

- **Two rule readings in the source headers (confirmed 2026-11-12).** Both keep the labels
  and the texts closer to what a coach would say; both are pinned by tests, so a change is one rule and its tests.
  1. §8.8 intent rule 1 says a move that "attacks a square next to the enemy king" is `attack`. The code narrows it
     to a square next to the king that **only the king defends** (`intent.ts` `kingZone`): in most middlegames a
     developing move attacks some square next to the king, so the plan's reading would call almost every move an
     attack. Example: `rnbq1rk1/ppppbppp/5n2/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQ - 4 4`, `Bc4` attacks f7, which the
     rook on f8 also covers: the plan says `attack`, the code says `improve` ("brings the bishop to c4"). With 2.Qh5
     against an uncastled king (f7 defended only by the king) both readings say `attack`.
  2. §8.4 BOOK rule 2 says "every earlier ply is BOOK". The code chains on **book membership**: every earlier ply's
     resulting EPD is in the book set (`classify.ts` header). The difference is a FORCED ply inside theory (rule 1
     wins over rule 2): under the plan's text nothing after it can be BOOK. Replaying the seed openings finds 8 such
     plies before ply 30, e.g. Caro-Kann Defense: Endgame Variation ply 8 `Kxd1`, Scotch Game: Sea-Cadet Mate ply 17
     `Ke7`, Hungarian Opening: Pachman Gambit ply 5 `g6`: the plan's reading would grade the rest of those well-known
     lines as engine moves.

## Tests and scripts

- `pnpm --filter @repo/chess-analysis test` runs every `src/**/*.test.ts` and `scripts/**/*.test.ts` (node:test via
  tsx). Corpora: `fixtures/oracle/` (30 Lichess games), `fixtures/labels/` (design mock + constructed edge games),
  `fixtures/legend/` (5 comparison fixtures), `packages/chess-fixtures/grades/positions.jsonl` (94 single positions).
- `pnpm --filter @repo/chess-analysis license-check`: the AGPL/GPL gate over the production trees of this package
  and the worker (see `CLEANROOM.md`).
- `ENGINE_PATH=<stockfish 18> pnpm --filter @repo/chess-analysis eval-provenance [--write] [--report f.json]`: every
  non-constructed stored eval within ±30 cp (or the same mate) of sf18-v1 (nightly on arm64).
- `tsx scripts/fetch-oracle.ts`: re-pulls the oracle games (one Lichess API request).

`NOTICE.md` holds the third-party notices, `CLEANROOM.md` the clean-room record.
