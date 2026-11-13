# Import fixtures (phase-04 plan §12.5, WP-B)

Chess-correctness fixtures for `@repo/chess-import` (the Chess.com and Lichess mappers), the worker's import
integration tests and the e2e upstream mock (`apps/web/e2e/mocks/upstream-server.ts`). Data only: nothing here reads
the network. The checks live in `packages/chess-import/src/__tests__/fixtures.test.ts` (every `*.expected.json` row
against the mappers, an independent chess.js replay of every stored move string, case coverage, strict provider
schemas) and `packages/chess-import/scripts/canary.test.ts`.

| Path | Content |
|---|---|
| `chesscom/knightowl_88/{profile,stats,archives}.json` | the fixture account (stats: rapid 1184 with the most games, blitz 1032, bullet 871, no daily; the `V3OnbPreview` values; archives list 2026/08–2026/10) |
| `chesscom/knightowl_88/2026-08.json`, `2026-09.json`, `2026-10.json` | 48 games (14 / 16 / 18) in Chess.com's archive shape, oldest first: checkmated, resigned, timeout, agreed, repetition, stalemate, insufficient, 50move, timevsinsufficient, abandoned, two daily games, a chess960 game (skipped `variant`), an unrated game (skipped `unrated`), a custom `initial_setup` with Black to move (startPly 19), under-promotion, both castlings and en passant |
| `chesscom/knightowl_88/*.expected.json` | per game, in archive order: externalId, colour, outcome, endMethod, plyCount, fen, timeClass, clocksLength, startPly, endedAt (or `skip`) |
| `lichess/knightowl88/games.ndjson` | 30 export lines (`pgnInJson=false`), newest first, plus one malformed line after the 7th: evals with mate scores (incl. a mate game whose analysis stops one ply short), clocks, a BOT opponent, `fromPosition` with Black to move (odd startPly), correspondence, ultraBullet, classical, stalemate, draws upgraded to THREEFOLD and FIFTY_MOVE, outoftime without a winner, an aborted game |
| `lichess/knightowl88/games.expected.json` | per valid line: the fields above plus evalHintLength, ratingDelta, opponentTitle; `invalidLines: 1` |
| `lichess/knightowl88/account.json` | `GET /api/account` for the OAuth mock (perfs fold into RatingsV1) |
| `chesscom/recorded/2026-10.json`, `2026-11.json` (+ `.meta.json`) | real public Chess.com months, recorded and anonymised by `packages/chess-import/scripts/record-fixture.ts` on 2026-11-12 (V-3: every game carries `%clk` on every ply; field names as served) |
| `source/cc0-pool.json` | the source pool for the generated games (below) |

Revision-2 cases (§12.5), all present: an archive `fen` that disagrees with the PGN on the last ply (→ `parse_error`);
a daily game ending 23:30 UTC on 2026-10-14 (2026-10-15 in Asia/Kolkata, 2026-10-14 in America/New_York); a
Lichess `fromPosition` game with Black to move and an odd `startPly`.

**Regenerate** (deterministic; the expected values come from chess.js, not from the mappers):

```
pnpm --filter @repo/chess-import build-fixtures                 # rebuilds chesscom/knightowl_88 and lichess/knightowl88
pnpm --filter @repo/chess-import record-fixture --user <handle>  # records one more real month (polite, ≤ 4 requests)
```

**Sources and licence.** `source/cc0-pool.json` holds 75 rated standard games from the Lichess export (Lichess game
data is CC0), reduced to moves, clocks, evals, status and opening: no ids, usernames, ratings or dates. The fixture
games re-encode them with synthetic ids, names (`KnightOwl_88` / `KnightOwl88`, `opponent_NN`) and dates. The endings
that short real games rarely reach come from constructed lines: Sam Loyd's ten-move stalemate, the
threefold-by-transposition line of `pgn/rules/`, a Black-to-move setup, and seeded random play (insufficient material,
fifty-move rule, time vs insufficient material, under-promotion). The recorded months are real public games with
usernames, game ids, uuids and links replaced.

**Dates.** The fixture games end in August–October 2026, so they fall inside the 12-month import window until
2027-08. A test that imports them later must pin the clock (or shift `end_time` / `lastMoveAt`).
