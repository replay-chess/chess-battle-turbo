# @repo/chess-fixtures

Shared chess-correctness fixtures (phase-02 plan 12.2, architecture 5.9). Data only: `@repo/game-core`, the socket
tests and the e2e specs load the files by path (`@repo/chess-fixtures/<path>`).

| Path | What | Owner |
|---|---|---|
| `rules/illegal-reasons.json` | One FEN + attempted move + expected reason text per illegal-move reason (plan 8.17), incl. the template's "the knight on d7 blocks the d-file" and "the bishop on e7 is pinned to your king". P9 and P10 reuse it. | WP-B |
| `pgn/rules/*.pgn` | Rule edge cases: castling rights (rook returns, rook captured), en passant (incl. a discovered check), promotion and under-promotion, stalemate, threefold by transposition, fifty-move at halfmove 100, insufficient material, timeout vs insufficient, a Black-to-move start above move 1, the Opera Game mate. Custom tags: `RcExpect` (end detected on the final position), `RcCastling`, `RcCheckAfterPly`, `RcFlag` + `RcFlagOutcome`. | WP-B |
| `perft/positions.json` | Perft node counts (start depth 4 = 197,281; Kiwipete depth 3 = 97,862; three cheap extra positions) guarding chess.js upgrades. | WP-B |
| `design/<Board>.json`, `design/index.json` | Every move line and per-state board mark the V3Game designs use, extracted by `scripts/qa/extract-design-fens.ts` (identical boards share one file; `index.json` maps board → file). `V3Game.json` `lines.MAIN` is the Opera Game to 17.Rd8#. | WP-B (generated) |
| `socket/transcripts/<state>.json` | Golden socket transcripts, one per lit design state (plan 12.3). | WP-C |

`test/design.test.ts` replays every design line with chess.js (a design typo fails there, not in a game test);
`test/fixtures.test.ts` checks the shape of the other files. The behaviour tests that use them live in
`packages/game-core/test` (`explainIllegal`, `fixtures`, `viewState` for the transcripts).

Re-extract the design fixtures after a design change (the design reference is not in the repo):

```
pnpm exec tsx scripts/qa/extract-design-fens.ts --design <dir holding v2/>
```

P3 adds `grades/positions.jsonl`.
