# Grade corpus (`grades/`)

Single positions with expected move grades, shared by phase 3 (grading), phase 5 (Mistake Bank), phase 6 (weakness)
and phase 7 (the coach verifier). Owner: phase-03 work package A (plan §12.4, TST X13).

## `positions.jsonl`

One JSON object per line (94 lines), covering the label rules of plan §8.4: the severity edges at 4.998 / 5.0005,
9.9999 / 10.00004 and 14.999 / 15.00003 Win% (the nearest integer evals on each side of 5, 10 and 15) for both
colours; EXCELLENT/GOOD/BEST bands; mate created (−1000/−999/−800/−701/−700/−500), mate lost and mate delayed; MISS
(the design's 19.Qd2, a missed mate, the cp 200 boundary) and not-MISS; GREAT from `second` (and four ways it is not
GREAT); BRILLIANT (Opera 16.Qb8+, Kasparov 24.Rxd4, Fischer 17…Be6) and the +300 guard; FORCED; the BOOK cap at ply
30, a FEN start, a broken chain; Fool's Mate, Scholar's Mate and Légal's trap; and 29 plies of the oracle games with
Lichess's own Inaccuracy / Mistake / Blunder judgement.

```
{ id, fen, move (SAN), evalBefore, evalAfter (stored encoding, White POV), best (SAN | null), second?,
  legalCount, expected: { label, winPctLossApprox }, source, context?, note? }
```

- `context` carries what one position cannot: `oppPrev` (the opponent's previous ply: stored evals before and after,
  for MISS), `reply` (the opponent's answer, SAN, for the sacrifice check), and the rule-2 premises `ply`,
  `initialStart`, `bookChain`, `inBook` (with `seedBook: true` the membership is checked against the seed book).
- `source` says where the evals come from: `constructed` (placed on a rule boundary on purpose), `design-mock` (the
  design boards' values), `mate-fact` (forced mates, exact), `approx` (hand estimates for real positions),
  `lichess:<game>#<ply>` (Lichess's published engine evals for that ply of an oracle game in
  `packages/chess-analysis/fixtures/oracle/`) and `sf18-v1` (re-sourced by `eval-provenance.ts --write`).
- The corpus test (`packages/chess-analysis/src/classify.positions.test.ts`) is pure: it grades every line from its
  stored evals, checks `legalCount` and the Win% loss, and checks `seedBook` membership against the real book set.

## Eval provenance

Every eval that is not `constructed` or `design-mock` must stay within ±30 cp (or give the same mate distance) of
Stockfish 18 at profile `sf18-v1`. The nightly job runs `packages/chess-analysis/scripts/eval-provenance.ts` on the
arm64 runner; `--write` re-sources drifted lines with the engine's values (source `sf18-v1`) so the expectations can
be re-checked in review. Until the first nightly run, `approx` and `lichess:` lines are unverified against sf18-v1.

Change a line only together with the grading constant or label rule that changed it, and bump `GRADING_VERSION`
when an existing expectation flips.
