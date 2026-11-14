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

## P5: the Mistake Bank extraction, puzzle lines and the theme tagger (phase-05 plan §8.1, §8.11, §11)

Modules: `src/bank/candidates.ts`, `src/puzzle/validAttack.ts`, `src/puzzle/line.ts`, `src/themes/*`, `src/epd.ts`.
The same rules as above apply: nobody working on these opened `lichess-puzzler` (AGPL-3.0, including its `cook.py`
tagger and its `validAttack`/line generator) or Lichess's server code, and no AGPL source was searched or quoted.

| What | Source | Used for |
|---|---|---|
| Which plies are bank items (judgement set, the ≥ 7 Win% inaccuracy in a 10–90 position, top 4 per side, key moments forced in, MISSED_PUNISH) | The phase-05 plan §8.1 step 1 and owner decisions D-1 / D-9 | `bank/candidates.ts` |
| Uniqueness (`validAttack`: no second move; mate in 1 with the second move at wc ≤ 0.6; gap > 0.5), the +200 cp puzzle threshold, the "too winning" and "< 2 legal moves" skips | The published description of how a Lichess puzzle move must be the only good move, as summarised with its constants in the planning research (plan §8.1 step 2–3, R-PZL-04/06/07) | `puzzle/validAttack.ts` |
| Line growth and trimming (defender reply from the PV, one MultiPV-2 search per solver move, ≤ 7 plies, stop on repetition / not winning / not unique, drop a trailing defender move and a forced final solver move) | The plan's §8.1 step 4 and research R-PZL-05 (the published "how a puzzle line is extended" description); the node budget is the plan's §7.6 | `puzzle/line.ts` |
| Theme keys and their meaning | The public theme pages (lichess.org/training/themes): each detector implements the page's one-sentence description; the fork rule is the plan's R-THM-05 text; the eval and length tags use the thresholds stated on those pages; the `rc:*` heuristics are the plan's §8.11 list | `themes/*` |
| Detector tuning | **Measurement only**: recall and precision of our detectors against the `Themes` column of the Lichess puzzle database (`https://database.lichess.org/lichess_db_puzzle.csv.zst`, CC0, Last-Modified 2026-11-01), read from a local copy outside the repository. When a rule missed tagged puzzles, the rule was re-read from the description and widened or narrowed; no rule was copied from code, and the database itself contains no code | `themes/*` thresholds and conditions |
| FNV-1a 64 (offset basis 0xcbf29ce484222325, prime 0x100000001b3) | The public-domain FNV specification by Fowler, Noll and Vo | `epd.ts` |
| The committed CC0 oracle fixtures | Rows of the same CC0 dump, selected by `scripts/theme-fixtures.ts` with a fixed hash sample and Lichess's own popularity / play-count / deviation counters, never by what our tagger says | `@repo/chess-fixtures/puzzles/<theme>.json` |
| The bank design fixtures | The `V3BankSession` and `V3MistakeBank` design boards | `@repo/chess-fixtures/design/v3-bank-session.json`, `v3-mistake-bank.json` |

Settled by measurement (P5 WP-C, 2026-11-13; recall / precision on 15,000–20,000 consecutive puzzles of the dump
for tuning, re-checked on a separate held-out slice, and on the committed 50 + 50 fixtures by
`src/themes/themes.recall.test.ts`): every Tier-1 detector reaches recall ≥ 85 % (held out: 93.6–100 %). Where a
description admits more than one reading, the data chose:
1. a fork target that guards the forker's square still counts when taking the forker would lose material for it
   (R-THM-05's "not defending the mover's square" read as "cannot simply take it back");
2. a discovered attack may be uncovered by the defender's own capture that the line forces (a deflection), but a
   defender piece that steps out of the line on its own is a skewer, not a discovery;
3. a sacrifice is material given up after a defender reply that the solver's next move does not immediately take back
   (an exchange is not a sacrifice);
4. a pin is an absolute pin (to the king) that wins the pinned piece or stops it from taking back; relative pins and
   pins the line never uses fire on ordinary play (precision 15 % → 59 % at 94 % recall);
5. a hanging piece is an undefended knight, bishop, rook or queen (not a pawn, not an under-defended piece);
6. an exposed king has no shelter pawn at all next to it.
Precision is tracked, not gated (plan §8.11). The tags still well above Lichess's rate are `kingsideAttack`,
`queensideAttack`, `exposedKing`, `queenRookEndgame` and `capturingDefender` (18–24 %); they rank below every named
tactic in the primary-theme order, so a card shows them only when nothing more specific was found. On held-out
puzzles the primary theme is one of Lichess's own tags for 79 % of puzzles (66 % before items 4–6).
