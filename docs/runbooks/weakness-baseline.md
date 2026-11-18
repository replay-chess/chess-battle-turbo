# Runbook: the weakness rating-band baseline (J5)

The Weakness Profile compares a member's error rates with players of the same Lichess rating band. Those band
numbers live in `packages/chess-training/baselines/v1.json` (with `v1.meta.json` saying how it was built). The file is
built on a laptop by `packages/chess-training/scripts/build-baseline.ts` from one Lichess monthly dump, with the
worker's own grading pipeline and the worker's own Stockfish build. The worker bundles the file and refuses it if its
engine profile differs (`baseline_profile_mismatch`). Plan: `docs/plan/phase-06-weakness-profile.md` §7.4.5, §8.4,
§12.1, §12.5.

Nothing here touches a database, Vercel, the OCI boxes or any dashboard. The only download is the Lichess dump
(CC0, database.lichess.org).

## What the build does

| Phase | Command | Output (in the work directory) |
|---|---|---|
| Pin check | `--pin-check` | `pin.json` |
| 1. Sample | `--sample` | `sample.jsonl` (checkpoint), `closed-cells.jsonl` |
| 2. Grade | `--grade` (follows phase 1) | `graded.jsonl`, `start.json` |
| 3. Calibrate | `--grade` (same process) | `calibration.jsonl` |
| 4. Aggregate | `--aggregate` | `baselines/v1.json`, `baselines/v1.meta.json` (in the repo) |
| Fixture | `--sample-fixture` | `packages/chess-fixtures/weakness/baseline-sample.json` (in the repo) |
| Golden | `--golden --update` | `test/fixtures/weakness/member-design.v1.golden.json` (in the repo) |

1. **Sample.** The script reads analysed games from the dump. It keeps games that are standard and rated, have both
   Elo values, no BOT, a bullet, blitz or rapid time control (`initial + 40 × increment`: under 180 s is bullet,
   under 480 s blitz, under 1500 s rapid), at least 20 plies, `%clk` on every ply and `%eval` on every ply (one short
   when the game ends in mate). Abandoned games and games closed for a rules infraction are skipped. Each game gives
   one side, to the rating cell (100 points, 600 to 2400, per time class) that has had fewer offers. Each cell is a
   seeded reservoir, so it holds a uniform sample of the sides offered to it.
2. **Grade.** Each sampled side goes through the worker's pipeline. The importer's eval-hint rules turn `%eval` into
   stored evals. CA `gradeAnalysis` grades the game with the worker's opening book (`apps/web/public/openings`).
   Each MISTAKE, BLUNDER and MISS position, and the position after it, is searched with `sf18-v1` pass 1. CA
   `computeSideInputs` then writes the side's STATS_V1, ERROR_LOG_V1 and P5 tagger themes. These are the same five
   `game_players` columns the worker writes for a member.
3. **Calibrate.** 300 blitz sides per band are graded a second time, with our engine on every position. Then
   `calibration[band][judgement]` = our rate / the `%eval` rate. The weakness engine applies it to members whose
   games our engine graded.
4. **Aggregate.** Each cell is aggregated with the weakness engine's own functions (`decodeGame`, `aggregate`,
   `bookExitOf`, the phase rule), so "you" and "your band" come from one computation.

## Before you start

- About 40 GB free disk for a full month (chunk mode needs only the chunks it reads, about 3–6 GB). Docker running,
  `curl`, Node and pnpm installed.
- **The worker's engine image.** Build the Stockfish stage of the worker image from the repo root:

  ```sh
  docker build --platform linux/arm64 -f apps/analysis-worker/Dockerfile --target stockfish -t rc-p6-stockfish-pin:local .
  ```

  The build compiles the pinned tag and checks both net hashes. Its `/out/doc/BUILD_INFO` records the binary sha256.
- A work directory **outside the repository**, for example `~/.config/replay-chess/build/baseline-YYYY-MM`. The
  script refuses a directory inside the repo.
- Pick the newest complete month on <https://database.lichess.org/#standard_games>. Copy its sha256 from
  `https://database.lichess.org/standard/sha256sums.txt`.

## Environment

```sh
export BASELINE_WORK_DIR=~/.config/replay-chess/build/baseline-2026-10
export LICHESS_DUMP_URL=https://database.lichess.org/standard/lichess_db_standard_rated_2026-10.pgn.zst
export LICHESS_DUMP_SHA256=043906ebfade1bfeb7c00087590fac505370936c028525e4722e2dbd4986ae86
export BASELINE_ENGINE_IMAGE=rc-p6-stockfish-pin:local   # or ENGINE_PATH=<the same Linux binary on a Linux host>
export BASELINE_SAMPLE_PER_CELL=2000                     # the plan's size; 1000 is the floor
export BASELINE_THREADS=10                               # engines; leave cores for everything else
```

Optional: `BASELINE_RESERVOIR` (reservoir size, at least the per-cell sample, so a later build can grow the sample),
`BASELINE_SAMPLE_TARGET` (offers every cell below 2300 must see before chunk sampling stops; default the per-cell
sample), `BASELINE_CHUNK_MB` (96), `BASELINE_DOWNLOADS` (parallel range requests, 3), `BASELINE_MAX_CHUNKS`,
`BASELINE_CLOSE_FACTOR` (4) and `BASELINE_CLOSE_MIN_CHUNKS` (8), `BASELINE_SEED` (20261017). Search nodes and
MultiPV always come from `ENGINE_PROFILE` (CA `version.ts`). They are never read from the environment.

Run every command from `packages/chess-training` as `pnpm exec tsx scripts/build-baseline.ts <flag>`.

## 1. Pin check

```sh
pnpm exec tsx scripts/build-baseline.ts --pin-check
```

The script refuses to go on unless all of these hold:

- the worker's Dockerfile still builds `sf_18` at commit `cb3d4ee9…`;
- the binary's sha256 is the worker image's binary (`f4a308b1…`, linux/arm64 gcc `profile-build`);
- BUILD_INFO names both nets with their sha256 (big `c288c895…`, small `37f18f62…`);
- the engine answers "Stockfish 18" and loads both nets by name;
- its `bench` signature is 2,050,811 nodes;
- `ENGINE_PROFILE` is still `sf18-v1` (pass 1: 120k nodes, MultiPV 2; 1 thread; 64 MB hash).

The same check runs at the start of every engine phase.

## 2. Sample, grade and calibrate

Two processes run side by side. Run each in its own terminal, or in the background with its output appended to a log
in the work directory.

```sh
pnpm exec tsx scripts/build-baseline.ts --sample      # phase 1: chunks of the dump → reservoirs
pnpm exec tsx scripts/build-baseline.ts --grade       # phases 2+3: grades cells as they close, then calibrates
```

- **Chunk mode** (`LICHESS_DUMP_URL`). The dump is a series of independent zstd frames. The script reads 96 MB byte
  ranges in a seeded random order across the whole month and decodes the whole frames inside each range. It stops
  once every cell below 2300 has had `BASELINE_SAMPLE_TARGET` offers. A cell closes early once it has had
  `close factor × reservoir` offers over at least 8 chunks, and the grader starts on it straight away. On a slow link
  this takes hours instead of days.
- **Whole-month mode.** Download the file, check it with `shasum -a 256` against the published value, then run one
  of these:
  - `LICHESS_DUMP_PATH=<file> … --sample`, which reads the local file in the same chunk order;
  - `zstd -dc <file> | LICHESS_DUMP_NAME=<file name> … --sample --stdin`, which samples every game of the month.
    This is the plan's full run.
- **Progress.** Every phase writes timestamped lines to `journal.log` in the work directory. The lines show chunks
  done, GB decoded, the lowest cells, sides graded per hour and searches.
- **Stop sampling early.** `--close-sample` stops after the chunk in progress. Every open cell is closed and the
  shortfalls are recorded.
- **Resume.** If a process dies, run the same command again. Downloads resume byte-exact, the sample resumes from its
  checkpoint, and grading and calibration skip the sides already in their journals. Ten engines run as ten
  `docker run -i` containers named `rc-j5-sf-<pid>-<n>`. They exit when the process ends.
- **Rate limits.** database.lichess.org answers 429 when there are too many range requests. Keep
  `BASELINE_DOWNLOADS` at 6 or below. The script backs off for 10 s to 2 min between retries.

## 3. Aggregate and verify

```sh
pnpm exec tsx scripts/build-baseline.ts --aggregate         # baselines/v1.json + v1.meta.json
pnpm exec tsx scripts/build-baseline.ts --sample-fixture    # FX weakness/baseline-sample.json (re-searched, checked)
pnpm exec tsx scripts/build-baseline.ts --golden --update   # member-design.v1.golden.json
pnpm --filter @repo/chess-training test                     # baselines.test.ts + the J5 script tests
pnpm --filter @repo/chess-training check-types && pnpm --filter @repo/chess-training lint
```

`baselines.test.ts` checks the following:

- the strict schema; the file is not synthetic;
- the profile in the file and in the meta;
- the meta's engine pin equals `scripts/baseline/pin.ts` `ENGINE_PIN`;
- the dump is a 2026 standard rated month;
- every cell has at least 20,000 moves and the per-cell sample (at least 1,000), unless the meta explains a 2300+
  shortfall;
- blunder rates fall with the band (soft check: the inversions are printed, and the test fails only above 20 % of
  adjacent pairs);
- the 1100 blitz fork rate is between 0.5 and 4.0 per 100 moves;
- calibration covers every band;
- the v1 golden matches.

Read `v1.meta.json` before you commit:

- `shortfalls` must list only 2300+ cells;
- `calibration.detail` shows how many events each factor rests on, and `pooled` names the bands that borrowed the
  pooled factor;
- `runtime` shows the hours each phase took.

The dump, the chunks and the journals are never committed. Commit the five repo files through a normal PR:
`v1.json`, `v1.meta.json`, `baseline-sample.json`, `member-design.v1.golden.json`, and the `load.ts` change if this
is the first v1.

## What v1 (2026-11-17) was built from

| | |
|---|---|
| Dump | `lichess_db_standard_rated_2026-10.pgn.zst`: 30,982,323,881 bytes, 95,395,628 games, published sha256 `043906ebfade1bfeb7c00087590fac505370936c028525e4722e2dbd4986ae86` |
| Mode | Chunk mode. The link to database.lichess.org ran at 0.07–4 MB/s and answered 429 above about 6 parallel requests, so the whole file would have taken one to four days. The build read 33 chunks of 96 MiB in a seeded random order across the month: 3.17 GB decoded, 9,779,879 games, 921,054 eligible. The sample stopped when the scarcest cell below 2300, bullet 600–699, had 1,050 offers (it reached 1,069). Chunk indexes are listed in `v1.meta.json` `dump.chunks`. The file was not hashed as a whole (`sha256Verified: false`); the published sha256 names the month. |
| Engine | Worker image binary `f4a308b1…` (linux/arm64), run in Docker on an Apple-silicon Mac. Grading ran as 4 processes with 2 engines each (`BASELINE_SHARD`); calibration as 2 processes with 5 engines each. |
| Per-cell sample | **1,000 sides in every one of the 57 cells, with no shortfall**, including 2300+. The fewest moves were 21,514, in bullet 600. |
| Time | Sample 0.98 h, grade 2.84 h (57,000 sides, about 20k sides/h), calibrate 1.58 h (5,700 sides, every position), 826,453 searches in all (`v1.meta.json` `runtime`). |
| Why 1,000, not 2,000 | Grading is CPU-bound. Each side costs about 0.25 s in the P5 tagger plus 8.3 searches of about 0.12 s, on a machine shared with other builds. 2,000 per cell (114k sides, about 5.7 h) plus the calibration (1.6 h) plus the sample would have exceeded the 8-hour budget. The per-cell order is a seeded permutation of a 2,000-side reservoir, so the same work directory can grow to 2,000 (see below). |
| Reproducibility | Every search starts from a cleared engine at fixed nodes on one thread. Even so, a second search of the same position gave a different PV about 0.4 % of the time, and that changed about 3 % of side records (5 of 171 in a re-run; 49 of 50 fixture sides were identical). The worker has the same property. The FX fixture stores the engine answers it used, so its test is exact. |

**The full run (plan default).** Use a machine with a fast link, or one that already has the month on disk. Set
`BASELINE_SAMPLE_PER_CELL=2000`, use whole-month mode (`--stdin`, or `LICHESS_DUMP_PATH` with
`BASELINE_SAMPLE_TARGET=2100`), and run the same phases with `BASELINE_SHARD` set so that the tagger's CPU is spread
over processes. For example, 4 processes × 2 engines measured about 20k sides/h here, so 114k sides take about 6 h
and the calibration 1.6 h. **Growing this v1 to 2,000.** In the same work directory, run
`BASELINE_SAMPLE_PER_CELL=2000 … --grade` (sharded). It grades the next 1,000 sides of each cell's order. Then run
`--aggregate` with the same setting. The cells whose reservoir holds fewer than 2,000 sides (`offers` in
`v1.meta.json`) need a larger sample first, which means a new work directory.

## Quarterly refresh and version rules

- **Refresh** every quarter, or when the rating pools drift. Use a new month and a new work directory, and run the
  steps above. A refresh is a data change: keep `id: "v1"`. Do **not** bump `ALGO_VERSION` for a data-only refresh,
  because snapshots pick up the new numbers at their next weekly roll.
- **Bump `ALGO_VERSION`** (TRN `src/weakness/constants.ts`) only when a formula changes (aggregation, eligibility,
  ranking, the band rule). That re-enqueues every member through B-W3 and the daily `algo` sweep. Rebuild the
  baseline in the same PR if the formula touches what the baseline measures.
- **Engine changed** (a new Stockfish tag, new nets or a new `ENGINE_PROFILE` id). The worker regrades everything
  first (`rerun`). Then rebuild the image, update `ENGINE_PIN` in `scripts/baseline/pin.ts` (commit, net sha256s,
  binary sha256, build id and bench signature, all read from the new image's BUILD_INFO and `bench`), and rebuild the
  baseline. The worker refuses a baseline whose `profile` differs from its own.
- **Classifier changed** (`GRADING_VERSION` bump, no engine change). Rebuild the baseline, because judgements and
  themes come from the classifier. The `gradingVersion` in v1.json records which classifier built it.
- **Tagger changed** (a new detector, or a Tier-2 theme that passes the recall gate and becomes a candidate). Rebuild
  so the band has the theme's rate.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `engine pin: …` | The image or the profile changed. Rebuild the image from the worker's Dockerfile, or follow "Engine changed" above. Never edit the pin to match an unknown binary. |
| `the checkpoint was made with another dump, seed, chunk size or cap` | Use a new work directory, or restore the original settings. |
| A cell below 2300 is short | The sample stopped before the cell had enough offers. Run `--sample` again with a larger `BASELINE_MAX_CHUNKS`, or use whole-month mode. |
| Calibration factors near the clamp (0.1 or 10) | The two gradings disagree badly. Check `calibration.detail`; usually a classifier change landed without a rebuild. |
| `curl … 429` in the sample log | Too many range requests. Lower `BASELINE_DOWNLOADS`. The script retries on its own. |
