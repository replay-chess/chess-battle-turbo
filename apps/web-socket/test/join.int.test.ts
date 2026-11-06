// game:join against Postgres (phase-02 plan 12.4 `join`): a player joins from the DB row (one statement); a second
// join of the same user hits memory (no query, counted with Prisma's `query` event); a non-player gets `forbidden`;
// spectating needs `ent`; a token for another env and a token-less socket are refused at the handshake.
import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { closeAllClients, cmd, connect, connectError, token } from "./helpers";
import { DB_SKIP, disconnectAdmin, makeGame, makeUser, startDbServer, type DbServer } from "./db";

describe("join (Postgres)", { skip: DB_SKIP }, () => {
  let server: DbServer;
  before(async () => {
    server = await startDbServer();
  });
  afterEach(() => closeAllClients());
  after(async () => {
    await server.close();
    await disconnectAdmin();
  });

  test("a player joins from the DB with one query; the second join makes none", async () => {
    const [w, b] = [await makeUser("w"), await makeUser("b")];
    const game = await makeGame(w, b);
    const W = await connect(server.url, w);
    const before = server.sql.queries();
    const ack = await cmd(W.socket, "game:join", { ref: game.ref });
    assert.equal(ack.ok, true, JSON.stringify(ack));
    assert.equal(ack.color, "w");
    assert.equal(server.sql.queries() - before, 1, "loadLiveGame is one statement");
    const W2 = await connect(server.url, w);
    const mid = server.sql.queries();
    const again = await cmd(W2.socket, "game:join", { ref: game.ref });
    assert.equal(again.ok, true);
    assert.equal(server.sql.queries() - mid, 0, "a reconnect makes no query");
  });

  test("a non-player gets forbidden; spectating without ent gets not_member, with ent works", async () => {
    const [w, b, c] = [await makeUser("w"), await makeUser("b"), await makeUser("c")];
    const game = await makeGame(w, b);
    const W = await connect(server.url, w);
    const B = await connect(server.url, b);
    await cmd(W.socket, "game:join", { ref: game.ref });
    await cmd(B.socket, "game:join", { ref: game.ref });
    const C0 = await connect(server.url, c, { ent: 0 });
    assert.deepEqual(await cmd(C0.socket, "game:join", { ref: game.ref }), { ok: false, code: "forbidden" });
    assert.deepEqual(await cmd(C0.socket, "spectate:join", { ref: game.ref }), { ok: false, code: "not_member" });
    const C = await connect(server.url, c);
    const spect = await cmd(C.socket, "spectate:join", { ref: game.ref });
    assert.equal(spect.ok, true);
    assert.equal(spect.role, "spectator");
  });

  test("a token for another env and a token-less socket are refused", async () => {
    const u = await makeUser("u");
    assert.equal(await connectError(server.url, { token: token(u, { env: "dev" }), proto: 2 }), "unauthorized");
    assert.equal(await connectError(server.url, { proto: 2 }), "unauthorized");
  });
});
