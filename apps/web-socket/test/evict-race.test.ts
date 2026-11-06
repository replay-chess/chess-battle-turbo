// regression: FIX-A (review-rules evict race). An ended session whose finish has not committed yet was evicted by the
// memory sweep (no player sockets), and the next join rebuilt a LIVE game from the still-IN_PROGRESS row, so a
// resigned game could be played on. The sweep now keeps such a session until its finish settles.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { LiveSession } from "../src/game/LiveSession";
import {
  MemoryPersistence,
  closeAllClients,
  cmd,
  connect,
  delay,
  move,
  startGame,
  startServer,
  until,
  user,
  type TestServer,
} from "./helpers";

/** The DB is slow/unreachable for the finish (it retries with backoff); checkpoints did reach the row. */
class SlowFinish extends MemoryPersistence {
  override checkpoint(session: LiveSession, reason: "move" | "phase" | "freeze"): void {
    super.checkpoint(session, reason);
    const r = this.records.get(session.ref)!;
    const s = session.state;
    if (s.phase === "ended") return;
    r.moves = s.moves.join(" ");
    r.plyCount = s.moves.length;
    r.moveClocksMs = [...s.clocksMs];
    r.phase = s.phase === "playing" ? "PLAYING" : s.phase === "first_move" ? "FIRST_MOVE" : r.phase;
    r.whiteTimeMs = s.clocks.w;
    r.blackTimeMs = s.clocks.b;
    r.lastMoveAt = new Date(s.clocks.at);
  }
  override finish(): Promise<{ committed: boolean }> {
    return new Promise(() => undefined); // still retrying (outbox untilCommitted backoff, up to 60 s per step)
  }
}

let server: TestServer;
after(async () => {
  closeAllClients();
  await server?.close();
});

test("a resigned game whose finish is still pending is not evicted, and a rejoin sees it ended", async () => {
  server = await startServer({ persistence: new SlowFinish() });
  const w = user("w");
  const b = user("b");
  const g = await startGame(server, w, b);
  assert.equal((await move(g.W, g.game.ref, 0, "e2e4")).ok, true);
  assert.equal((await move(g.B, g.game.ref, 1, "e7e5")).ok, true);
  assert.equal((await move(g.W, g.game.ref, 2, "g1f3")).ok, true);
  assert.equal((await cmd(g.W, "game:resign", { ref: g.game.ref })).ok, true);
  assert.equal(g.session().phase, "ended");
  g.W.close();
  g.B.close();
  await until(() => !g.session().hasPlayerSockets(), 3_000, "both players gone");
  const evicted = server.handle.registry.sweep();
  assert.equal(evicted, 0, "the ended session stays in memory while its finish is pending");

  const W2 = await connect(server.url, w);
  const B2 = await connect(server.url, b);
  const jw = await cmd(W2.socket, "game:join", { ref: g.game.ref });
  const jb = await cmd(B2.socket, "game:join", { ref: g.game.ref });
  await delay(50);
  const after = await move(B2.socket, g.game.ref, 3, "b8c6");
  assert.equal(jw.state.phase, "ended");
  assert.equal(jb.state.phase, "ended");
  assert.equal(after.ok, false, "no move after the resignation");
});
