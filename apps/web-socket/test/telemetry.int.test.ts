// Server-side product events (phase-02 plan 12.4 `telemetry`, 10.1) with a fake posthog-node: one `game_started` and
// one `game_ended` per player (distinct_id = the user ref, no FEN/PGN/moves in the properties), none for spectators,
// none for a duplicate finish.
import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { closeAllClients, cmd, connect, waitFor } from "./helpers";
import { DB_SKIP, disconnectAdmin, makeUser, playLine, startDbGame, startDbServer, type DbServer } from "./db";

describe("telemetry (Postgres)", { skip: DB_SKIP }, () => {
  let server: DbServer;
  before(async () => {
    server = await startDbServer();
  });
  afterEach(() => closeAllClients());
  after(async () => {
    await server.close();
    await disconnectAdmin();
  });

  test("one game_started and one game_ended per player; none for spectators or a duplicate finish", async () => {
    const { w, b, game, W, B, session } = await startDbGame(server);
    const viewer = await makeUser("viewer");
    const V = await connect(server.url, viewer);
    assert.equal((await cmd(V.socket, "spectate:join", { ref: game.ref })).ok, true);
    await playLine(W, B, game.ref, ["e2e4", "e7e5", "d2d4"]);
    const result = waitFor(W, "game:result", 5_000);
    await cmd(W, "game:resign", { ref: game.ref });
    await result;
    await server.booted.persistence.finish(session(), session().state.result!);
    const mine = server.telemetry.events.filter((e) => [w.ref, b.ref, viewer.ref].includes(e.distinctId));
    const count = (event: string, who: string) => mine.filter((e) => e.event === event && e.distinctId === who).length;
    for (const who of [w.ref, b.ref]) {
      assert.equal(count("game_started", who), 1);
      assert.equal(count("game_ended", who), 1);
    }
    assert.equal(mine.filter((e) => e.distinctId === viewer.ref).length, 0, "nothing for the spectator");
    for (const e of mine) {
      const text = JSON.stringify(e.props);
      assert.ok(!/e2e4|rnbqkbnr|\[Event/.test(text), "no move text, FEN or PGN in properties");
      assert.equal(e.props.app_env, "test");
    }
    const ended = mine.find((e) => e.event === "game_ended" && e.distinctId === w.ref)!;
    assert.equal(ended.props.method, "resignation");
  });
});
