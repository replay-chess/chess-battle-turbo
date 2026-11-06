// The persistence budget of plan 15 (DoD "Persistence") and 12.8 ("DB budget"), against Postgres with the REAL
// checkpoint cadence (10 plies / 15 s, CHECKPOINT_PLIES and CHECKPOINT_MAX_AGE_MS): an 80-ply game makes at most 11
// statements in all (1 load + ≤ 8 checkpoints + 1 finish, plus room for one prewarm), no HTTP call leaves the socket
// while the moves are played (0 Vercel calls per move), and the final move and a PGN with %clk are stored.
// regression: REGRESSION-2 (P2 DoD persistence check had no automated test on a real database).
import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { timingFor } from "../src/config/timing";
import { INITIAL_FEN, closeAllClients, cmd, waitFor } from "./helpers";
import { DB_SKIP, disconnectAdmin, gameRow, playLine, startDbGame, startDbServer, type DbServer } from "./db";

/** A deterministic legal line of `plies` plies from the start position with no repetition and no game end. */
function longLine(plies: number): string[] {
  const chess = new Chess(INITIAL_FEN);
  const seen = new Set<string>([chess.fen().split(" ").slice(0, 4).join(" ")]);
  const out: string[] = [];
  for (let i = 0; i < plies; i++) {
    const moves = chess
      .moves({ verbose: true })
      .map((m) => `${m.from}${m.to}${m.promotion ?? ""}`)
      .sort();
    // Rotate the start so the line is not just the alphabetically first move every time (avoids early shuffles).
    const rotated = [...moves.slice(i % moves.length), ...moves.slice(0, i % moves.length)];
    let picked: string | null = null;
    for (const uci of rotated) {
      chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci[4] ? { promotion: uci[4] } : {}) });
      const key = chess.fen().split(" ").slice(0, 4).join(" ");
      const ok = !chess.isGameOver() && !seen.has(key);
      if (ok) {
        seen.add(key);
        picked = uci;
        break;
      }
      chess.undo();
    }
    if (!picked) throw new Error(`no continuation at ply ${i + 1}`);
    out.push(picked);
  }
  return out;
}

describe("persistence budget (Postgres, real cadence)", { skip: DB_SKIP }, () => {
  let server: DbServer;
  const realFetch = globalThis.fetch;
  let fetches: string[] = [];

  before(async () => {
    server = await startDbServer({ timing: timingFor({ timingProfile: "real", overrides: {} }) });
    globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      fetches.push(String(input instanceof Request ? input.url : input));
      return realFetch(input, init);
    }) as typeof fetch;
  });
  afterEach(() => closeAllClients());
  after(async () => {
    globalThis.fetch = realFetch;
    await server.close();
    await disconnectAdmin();
  });

  test("an 80-ply game: ≤ 11 statements, ≤ 8 checkpoints, 0 HTTP calls per move, final ply and %clk stored", async (t) => {
    const line = longLine(80);
    const seen: { query: string; params: string }[] = [];
    server.sql.db.$on("query" as never, ((e: { query: string; params: string }) => seen.push(e)) as never);
    const { game, W, B } = await startDbGame(server, { initialTimeSeconds: 600 });
    // This game's statements: those whose parameters name it (load by ref; checkpoints and the finish by id) and the
    // one prewarm. The 10-minute stale sweep (outbox.ts; its first run follows the first finish after boot) works on
    // other games and is not a per-game cost, so it is left out.
    const mine = () =>
      seen.filter(
        (e) => e.query.trim() === "SELECT 1" || e.params.includes(game.ref) || new RegExp(`(^|[^0-9])${game.id}([^0-9]|$)`).test(e.params),
      );
    fetches = [];
    await playLine(W, B, game.ref, line);
    assert.deepEqual(fetches, [], "no HTTP call leaves the socket while moves are played");
    const ended = waitFor(B, "game:ended", 10_000);
    const result = waitFor(W, "game:result", 10_000);
    await cmd(W, "game:resign", { ref: game.ref });
    assert.equal((await ended).method, "resignation");
    await result; // after the finish committed

    const statements = mine().length;
    const checkpoints = (server.metrics.samples.get("ws.persist.ms{op=checkpoint}") ?? []).length;
    t.diagnostic(`statements=${statements} checkpoints=${checkpoints}`);
    t.diagnostic(mine().map((e) => e.query.replace(/\s+/g, " ").trim().slice(0, 40)).join(" | "));
    assert.ok(checkpoints <= 8, `≤ 8 checkpoints for 80 plies (got ${checkpoints})`);
    assert.ok(statements <= 11, `≤ 11 statements for the whole 80-ply game (got ${statements})`);

    const row = await gameRow(game.id);
    assert.equal(row.status, "COMPLETED");
    assert.equal(row.endMethod, "RESIGNATION");
    assert.equal(row.plyCount, 80);
    assert.equal(row.moves, line.join(" "), "every ply incl. the last is stored");
    assert.equal((row.moveClocksMs as number[]).length, 80, "one clock per ply");
    assert.match(row.pgn as string, /\[%clk \d+:\d\d:\d\d(\.\d)?\]/, "the PGN carries %clk");
    assert.equal(((row.pgn as string).match(/%clk/g) ?? []).length, 80, "a %clk comment on every ply");
  });
});
