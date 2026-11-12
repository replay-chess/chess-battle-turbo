# Clean-room record for `@repo/chess-analysis`

Phase-03 plan §8 (LIC-4) and §11.4: the grading formulas are re-implemented from published descriptions, never from
AGPL code. This file records how, so anyone can check it.

## Rules

1. Nobody working on this package opens Lichess's server code (`lichess-org/lila`, AGPL-3.0) or `lichess-puzzler`
   (AGPL-3.0) while doing the work. Searching those repositories, reading their files on GitHub, or copying from
   answers that quote them all count as opening them.
2. Constants and formulas come from published documentation or from measurement against published results (the
   Lichess API's output for public games), never from reading an implementation.
3. MIT/BSD code may be ported with attribution in `NOTICE.md` after its licence file has been read at a pinned tag.
4. The npm production tree of this package and of the analysis worker contains no AGPL or GPL dependency. The gate is
   `pnpm --filter @repo/chess-analysis license-check` (`scripts/license-check.ts`), which reads the whole tree with
   `pnpm licenses list --prod --json` (plain `license-checker` only sees direct dependencies under pnpm). Stockfish
   (GPLv3) is not an npm dependency: it is a separate binary in the worker image, with its own notice (`WK/NOTICE`).

## Sources used

| What | Source | Used for |
|---|---|---|
| Win% curve, move accuracy, game accuracy (volatility-weighted mean + harmonic mean), the +1 bonus | The published Lichess "Accuracy" description, as summarised with its constants in the planning research (plan §8.2, "RES §3.1–3.3") | `winpct.ts`, `accuracy.ts` |
| Judgement thresholds (Win% loss ≥ 5 / 10 / 15, the mate-rule "Advice" thresholds) | The planning research (RES §4.3) from Lichess's public documentation and observed exports | `classify.ts` rules 3–4 |
| The open points of the accuracy formula (series start, harmonic-mean floor, population standard deviation) | **Measurement only**: 196 player accuracies from 98 public Lichess games fetched through the Lichess API (`scripts/fetch-oracle.ts`, data CC0), compared with our numbers | `accuracy.ts` header items 1–3 |
| Phase division | scalachess `Divider.scala` at tag 18.1.0, MIT, licence read first; attribution in `NOTICE.md` | `divider.ts` (a port) |
| Key moments, the clean game, template text, plan intent | The phase-03 plan (§8.5–§8.8) and the design boards (`V3ReviewSummary`, `V3ReviewClean`, `V3KeyMoments`, `V3GamesArchive`, `V3GameOverLegend`, `V3LegendCompare`, `V3TryCompare`) | `moments.ts`, `intent.ts`, `text/*` |
| Legend helpers | This repository's own legacy route `apps/web/app/api/analysis/[gameId]/route.ts` (the owner's code) | `legend/slice.ts` (a port) |
| Annotated PGN conventions (`[%eval]`, `[%clk]`, NAGs) | The PGN standard and the widely documented comment commands | `pgn.ts` |
| Opening book | The Lichess `chess-openings` dataset (CC0), shipped in `apps/web/public/openings/*.tsv` | `book.ts` |
| Fixture games | Lichess public games (CC0); the Opera Game (1858) and Kasparov–Topalov (1999) game scores (facts, public domain) | `fixtures/oracle/`, `fixtures/legend/` |
| Product context | `research_notes/` (market research, UX teardowns): no formulas or code | none in the code |

## What was settled by measurement (WP-A part 1, 2026-11-11)

Recorded in the source headers and the part-1 hand-back:

1. The accuracy series starts at position 0 (the position before White's first move); unknown position-0 evals use
   15 cp. 196/196 players round to Lichess's integer; dropping position 0 misses 39/196.
2. Every move accuracy enters the harmonic mean floored at 1 (the plan's draft said 0.01; that is 7–14 points off on
   four players).
3. The volatility weight is the population standard deviation.
4. The divider's constants were copied from the pinned scalachess tag and reproduce Lichess's division on 30/30
   oracle games.

## Part 2 (moments, text, legend, PGN, book, corpus, regrade)

No external source code was opened. Every rule is from the plan's text; where the plan and its fixtures disagree the
decision is written in the module header (for example the king-zone condition of `intent.ts`, the headline order of
`text/headline.ts`, and the opponent-left fixture in `fixtures/legend/opponent-left.json`). The position corpus's
expectations come from the rule definitions, Lichess's own judgements on public games, or chess facts (forced mates);
none was produced by running this package's classifier and copying its answer. (The 29 Lichess lines were chosen
among the plies where our grader agrees with Lichess; the label on each is Lichess's.) The review-text snapshots in
`src/text/templates.test.ts` are the templates' output, reviewed line by line as copy.
