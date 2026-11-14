# Puzzle shards (phase-05 plan §8.13, §9.3, §12.4)

The puzzle trainer serves CC0 puzzles from the [Lichess puzzle database](https://database.lichess.org/#puzzles),
cut into **shards**: the top 250 puzzles (by `Popularity × ln(NbPlays)`) of one theme in one 100-point rating band.

| What | Where | In git |
|---|---|---|
| Full build (31 themes incl. `mix` × bands 6–25: 616 files, 146,156 tuples, 17 MB for the 2026-11-01 dump) | outside the repo, then R2 `puzzles/v1/<theme>/<band>.json` + `puzzles/v1/manifest.json` | no |
| Manifest (counts per shard, theme ↔ bit table) | `packages/chess-training/puzzles/manifest.v1.json` (the server selects with it, no fetch) | yes |
| CI subset (fork, pin, hangingPiece, backRankMate, mateIn2, mix × bands 12–18, 60 each) | `packages/chess-fixtures/puzzles/shards/v1/` (served by `e2e/mocks/puzzle-shards.ts` on 4012) | yes |

Shard file: `{"v":1,"version":"v1","theme":"fork","band":15,"p":[[id, fen, moves, rating, themesMask], …]}`, rating
ascending. `fen` is Lichess's (the position **before** the opponent's setup move, the first token of `moves`);
`themesMask` is the theme bitmask as a JSON number (≤ 53 bits) over `manifest.bits`, which the build copies from
`@repo/chess-training/themes` `SHARD_THEME_BITS` (append-only). Tags without a bit there (`master`, `discoveredCheck`,
the named mates such as `operaMate`) are listed by `build` and left out of the mask. Format helpers:
`lib/train/puzzle-shards.ts`; loader: `lib/train/puzzles.server.ts` (`selectPuzzleBatch` runs
`@repo/chess-training/session` `selectPuzzles` over the shards).

Filter: Popularity ≥ 80, NbPlays ≥ 300, RatingDeviation ≤ 90, 600 ≤ Rating ≤ 2599, ≤ 15 UCI tokens. Every kept line
is replayed with chess.js. A version path is immutable: a new corpus is `v2` (new manifest file, new `PUZZLES_VERSION`),
the old path is deleted after the switch.

All commands run from `apps/web`. `$BUILD` is a folder outside the repository, e.g.
`~/.config/replay-chess/build/phase5/puzzles`.

## 1. Download the dump (once)

```sh
mkdir -p "$BUILD/dump"
curl -fSL -R -o "$BUILD/dump/lichess_db_puzzle.csv.zst" https://database.lichess.org/lichess_db_puzzle.csv.zst
curl -sI https://database.lichess.org/lichess_db_puzzle.csv.zst | grep -i last-modified   # the dump date (--source)
shasum -a 256 "$BUILD/dump/lichess_db_puzzle.csv.zst"
```

(≈ 310 MB; the server answers 429 to more than a few parallel range requests.)

## 2. Build, verify, write the committed manifest

```sh
zstd -dc "$BUILD/dump/lichess_db_puzzle.csv.zst" \
  | npx tsx scripts/puzzles/build-shards.ts build --out "$BUILD" --source <dump date YYYY-MM-DD> \
      --manifest-copy ../../packages/chess-training/puzzles/manifest.v1.json
npx tsx scripts/puzzles/build-shards.ts verify --dir "$BUILD/v1"
```

`build` refuses an `--out` inside the repository, prints the tags that have no bit, and checks that the files match
the manifest. `verify` re-reads every file: counts equal the manifest, no unlisted file, every tuple in its band with
its theme bit, ids unique, rating order, every line legal (`--no-replay` skips chess.js).

## 3. Cut the CI subset

```sh
npx tsx scripts/puzzles/build-shards.ts subset --from "$BUILD/v1" \
  --out ../../packages/chess-fixtures/puzzles/shards/v1 \
  --themes fork,pin,hangingPiece,backRankMate,mateIn2,mix --bands 12,13,14,15,16,17,18 --per-shard 60
pnpm --filter @repo/chess-fixtures test      # test/puzzle-shards.test.ts: counts, bands, bits, legal lines
```

## 4. Upload to R2 (stage B, owner's laptop)

Needs `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` (the `scripts/upload-media.ts` names)
in the environment or `apps/web/.env.local`.

```sh
npx tsx scripts/puzzles/upload-shards.ts --dir "$BUILD" --version v1 --dry-run   # lists 617 objects (616 shards + manifest)
npx tsx scripts/puzzles/upload-shards.ts --dir "$BUILD" --version v1
```

Shards go first and the manifest last (`Content-Type: application/json`,
`Cache-Control: public, max-age=31536000, immutable`). An object that already holds the same bytes is skipped; one
with different bytes stops the upload (versioned paths never change).

## 5. Check the published objects

```sh
curl -sI "$PUZZLE_SHARD_BASE_URL/v1/fork/15.json" | grep -iE '^(HTTP|cache-control|content-type)'
PUZZLE_SHARD_BASE_URL=<public R2 base>/puzzles PUZZLES_VERSION=v1 npx tsx scripts/qa/smoke-puzzle-shards.ts
```

The smoke (also the post-deploy-dev step) checks the manifest equals the committed one, the `immutable` header, and 20
random puzzles from 3 random shards (legal, in band, theme bit set, every bit in `@repo/chess-training/themes`).
`--seed <n>` replays a run.

## 6. Environment

| Name | Where | Value |
|---|---|---|
| `PUZZLE_SHARD_BASE_URL` | Vercel `replay-chess-dev` (later the prod project) | public R2 base + `/puzzles` (unset → `NEXT_PUBLIC_MEDIA_URL` + `/puzzles`) |
| `PUZZLE_SHARD_BASE_URL` | `apps/web/.env.development.local`, `.env.test`, Playwright | `http://127.0.0.1:4012/puzzles` (the CI shard server; tests never reach R2) |
| `PUZZLES_VERSION` | all of the above | `v1` (must equal the committed manifest's `version`) |
| `PUZZLES_ENABLED` | kill switch | `off` disables puzzle sessions |

Local shard server: `npx tsx e2e/mocks/puzzle-shards.ts --port 4012` (Playwright starts it; `/__health`,
`/__requests`, `/__faults`). Note that `next dev`/`next start` keep shard responses in Next's data cache
(`cache: "force-cache"`, keyed by URL), so a fault set on the shard server only affects shards the web server has not
fetched before.
