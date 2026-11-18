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
| `weakness/baseline-sample.json` | 50 sides of the J5 v1 baseline sample (Lichess CC0 2026-10, names/ids/dates removed): movetext with `%eval`/`%clk`, the pinned engine's answers and the expected per-side records. Written by `packages/chess-training/scripts/build-baseline.ts --sample-fixture`; tested by `packages/chess-training/scripts/baseline/side.test.ts`. | P6 WP2 (generated) |
| `weakness/band-sides-1600-blitz.json` | 1,017 sides of the J5 v1 baseline cells `1500:BLITZ` and `1600:BLITZ` with Elo 1550–1649 (the players the 1600 band centre is made of; Lichess CC0 2026-10, graded with the pinned Stockfish 18): the per-side records J5 journalled (inputs, accuracy, result, Elo), ids replaced by ordinals, no names or dates. Read by `packages/chess-training/src/weakness/eligibility.real.test.ts` and `trend.real.test.ts` (FIX-2: the false-positive rate of the eligibility and trend tests on band-average members, and their power on members with a real excess). | P6 FIX-2 (generated from the J5 journals) |
| `weakness/persona-games.json` | 98 real games of the Lichess open database (CC0, 2026-10; the WP2 sample) for the P6 personas: UCI moves, the per-ply `%clk` clocks, the time control, the member's side, both ratings, result, termination, ECO; no ids, names, dates or evals. Cells `1500:BLITZ` 40, `1500:RAPID` 20, `1200:BLITZ` 12, `1200:RAPID` 6, `1200:BULLET` 20. Written by `apps/web/e2e/scripts/build-weakness-games.ts --from <sample>`; read by `packages/db/seed/p06-persona-states.ts` (the games are graded by the running worker, never here) and checked by `packages/db/seed/p06-personas.test.ts`. | P6 WP8 (generated) |

`test/design.test.ts` replays every design line with chess.js (a design typo fails there, not in a game test);
`test/fixtures.test.ts` checks the shape of the other files. The behaviour tests that use them live in
`packages/game-core/test` (`explainIllegal`, `fixtures`, `viewState` for the transcripts).

Re-extract the design fixtures after a design change (the design reference is not in the repo):

```
pnpm exec tsx scripts/qa/extract-design-fens.ts --design <dir holding v2/>
```

P3 adds `grades/positions.jsonl`.
