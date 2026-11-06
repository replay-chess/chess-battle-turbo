// regression: FIX-A (review-rules rematch-reloaded). A rematch accepted on an ended session that was (re)loaded from the DB row
// (eviction of an ended session with no player sockets, or a restart) failed with `internal`: whenEnded() had no
// finish to wait for. A session built from an already-ended row now counts as committed.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeAllClients, cmd, connect, move, testTiming, waitFor } from "./helpers";
import { DB_SKIP, disconnectAdmin, makeGame, makeUser, startDbServer, type DbServer } from "./db";

let server: DbServer;
after(async () => {
  closeAllClients();
  await server?.close();
  await disconnectAdmin();
});

test("rematch after the ended session was reloaded from the DB", { skip: DB_SKIP }, async () => {
  server = await startDbServer({ timing: testTiming({ rematchMs: 5_000 }) });
  const [w, b] = [await makeUser("w"), await makeUser("b")];
  const game = await makeGame(w, b);
  let W = (await connect(server.url, w)).socket;
  let B = (await connect(server.url, b)).socket;
  await cmd(W, "game:join", { ref: game.ref });
  await cmd(B, "game:join", { ref: game.ref });
  await move(W, game.ref, 0, "e2e4");
  await move(B, game.ref, 1, "e7e5");
  const res = waitFor(W, "game:result", 5_000);
  await cmd(B, "game:resign", { ref: game.ref });
  await res;
  // Both reload the page; the 60 s sweep runs while neither socket is attached → the ended session is evicted.
  W.close();
  B.close();
  await new Promise((r) => setTimeout(r, 100));
  const evicted = server.booted.handle.registry.sweep();
  W = (await connect(server.url, w)).socket;
  B = (await connect(server.url, b)).socket;
  const jw = await cmd(W, "game:join", { ref: game.ref });
  await cmd(B, "game:join", { ref: game.ref });
  const offer = await cmd(W, "rematch:offer", { ref: game.ref });
  const accept = await cmd(B, "rematch:accept", { ref: game.ref });
  assert.equal(evicted, 1);
  assert.equal(jw.state.phase, "ended");
  assert.equal(offer.ok, true);
  assert.equal(accept.ok, true, JSON.stringify(accept));
});
