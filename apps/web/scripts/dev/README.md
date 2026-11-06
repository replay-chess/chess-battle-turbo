# scripts/dev

Tools that write test data to the **dev** database only. Read `CLAUDE.md` "Database Safety Rules" first.

Every tool here takes its URL from the shell (`DIRECT_URL`, else `DATABASE_URL`) or from
`apps/web/.env.development.local`, never `.env.local` (that file can still point at the old production
database). Before writing, each one checks the host against the dev endpoint (`DEV_HOST_ALLOWLIST` in
`packages/db/prisma/seed-guards.ts`) or a local Postgres, and stops when the target has more than 60 users.
Only the host is ever printed.

| Tool | What it does | Phase |
|---|---|---|
| `personas.ts` | Writes a named billing persona onto a pool user (`E2E_POOL_01…24`) or user S | P1 |
| `seed-game-fixtures.ts` | Creates fixture games between two members, in the states the P2 specs and the owner tests need | P2 |

## seed-game-fixtures.ts

```bash
cd apps/web
npx tsx scripts/dev/seed-game-fixtures.ts --list
npx tsx scripts/dev/seed-game-fixtures.ts --white <email|userRef> --black <email|userRef> --fixture G-PROMO
npx tsx scripts/dev/seed-game-fixtures.ts --white … --black … --fixture all        # every fixture below
npx tsx scripts/dev/seed-game-fixtures.ts --white … --black … --fixture stress     # the stress=1 game
npx tsx scripts/dev/seed-game-fixtures.ts --white … --black … --fixture all --dry-run
```

Each fixture prints `/game/<ref>`. The e2e fixture `e2e/fixtures/games.ts` (WP-I) imports
`seedGameFixture(db, name, { white, black })` and `resolveFixtureUser(db, emailOrRef)` from this file.

Fixtures only add games; they never delete or reset anything, so e2e specs must not assert absolute counts.
The live fixtures start `IN_PROGRESS` in phase `WAITING` (both players are set; the socket starts the game
when both attach), with no study phase unless stated.

| Fixture | Start | Time control | Exercises |
|---|---|---|---|
| `G-PROMO` | `8/1P5k/8/8/8/8/6K1/8 w - - 0 41` | 5+3 | promotion picker (T6) |
| `G-LOWTIME` | initial | 0:15 + 0 | `low_time`, `over_timeout_*` (T7) |
| `G-INSUFF` | `8/8/8/4k3/8/8/4P3/4K3 w - - 0 81` | 0:20 + 0 | `over_timeout_insufficient` when White flags |
| `G-THREEFOLD` | initial | 5+0 | `over_threefold` (knight shuffle); first-move abort |
| `G-FIFTY` | `8/8/4k3/8/8/4K3/8/R6r w - - 98 120` | 5+0 | `over_fifty` after one quiet move each |
| `G-STALEMATE` | `7k/4Q3/6K1/8/8/8/8/8 w - - 0 59` | 5+0 | `over_stalemate` (59.Qf7); 59.Qf8# mates |
| `G-STUDY` | the first active featured legend position | 5+3, study 30 s | `study`, `abort`, the rematch flow |
| `G-ENDED` | the Opera Game, finished `17.Rd8#` with a `%clk` PGN | 5+3 | `already_ended` |
| `G-BOT-MID` | bot game (Engine 1200), 20 plies in a server checkpoint, `meta.rev = 20` | 10+0 | resume on another device (T15) |
| `stress` | 120 plies from a move-45 start (moves reach 105), 20-character names, the longest opening header | 15+10 | `stress=1` device run (plan 12.7) |

`G-STUDY` needs the legend content (`pnpm --filter @repo/db seed:content`); the bot fixture uses the
`CHESS_BOT_001` user from `pnpm --filter @repo/db seed` when it exists.

## The play-column backfill

`scripts/backfill-play-columns.ts` (one level up) fills the M2 columns of legacy games. It is dev only
(host allow-list: the dev endpoint or localhost), dry-run by default, `--apply` to write, `--verify` to rerun
the verification queries. See its header.
