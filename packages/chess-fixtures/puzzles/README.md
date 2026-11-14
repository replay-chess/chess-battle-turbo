# Puzzle fixtures (phase-05 plan §12.3, §9.3)

Chess-correctness fixtures for the Tier-1 theme tagger in `@repo/chess-analysis` (`src/themes/*`), the puzzle shard
loader (`apps/web/lib/train/puzzles.server.ts`) and the CI shard server (`apps/web/e2e/mocks/puzzle-shards.ts`,
`http://127.0.0.1:4012/puzzles`). Data only: nothing here reads the network, and no test or CI job reads R2.

| Path | Content | Owner |
|---|---|---|
| `<theme>.json` | 50 CC0 puzzles per Tier-1 theme from the Lichess open database, with the Lichess tags as the oracle (recall ≥ 85 %), plus 50 without the tag (precision tracked); rows `[id, fen, moves, rating, themes]`, the FEN before the setup move, `moves` = the setup move then the solution | WP-C |
| `shards/v1/<theme>/<band>.json`, `shards/v1/manifest.json` | a 6-theme × 7-band subset (bands 12–18, so a session around any rating from 1300 to 1799 finds its whole ±100 window; WP-I widened it from 14–16) of the real `puzzles/v1/` shards (same tuple shape `[id, fen, moves, rating, themesBitmask]`) served by the CI shard server | WP-D |

**Source and licence.** Every puzzle comes from `https://database.lichess.org/lichess_db_puzzle.csv.zst`
(CC0). The dump is downloaded once, outside the repository, by `apps/web/scripts/puzzles/build-shards.ts`; only the
selected rows are committed here. Every solution line replays legally with chess.js (checked in CI).

**Theme fixtures (WP-C).** Selected by `packages/chess-analysis/scripts/theme-fixtures.ts` without consulting the
tagger: a fixed FNV-1a sample of the puzzle ids (1 in 16), Lichess's own quality counters (popularity ≥ 80, ≥ 200
plays, rating deviation ≤ 100), then per theme the first 50 with and 50 without the tag in an id-and-theme hash order:

```
zstd -dc lichess_db_puzzle.csv.zst | pnpm --filter @repo/chess-analysis exec tsx scripts/theme-fixtures.ts \
  --out ../chess-fixtures/puzzles --source "https://database.lichess.org/lichess_db_puzzle.csv.zst (Last-Modified 2026-11-01)"
```

Checked by `test/puzzles.test.ts` (shape, the tag split, every line legal) and used by
`packages/chess-analysis/src/themes/themes.recall.test.ts` (the recall gate).
