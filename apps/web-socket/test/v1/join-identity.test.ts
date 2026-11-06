// join_game identity comes only from the verified token (plan §7.5 #2, AS F-02), and join
// errors are codes without ids (plan §7.5 #3, AS F-20).
import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  closeAllClients,
  connectClient,
  expectConnectError,
  makeGame,
  makeSocketToken,
  prepareEnv,
  startMockWebApi,
  startSocketServer,
  uniqueRef,
  waitFor,
  type MockWebApi,
  type RunningSocketServer,
} from "./helpers";

describe("join identity (every socket is authenticated since P2; v1 through PROTOCOL_V1)", () => {
  let api: MockWebApi;
  let server: RunningSocketServer;

  before(async () => {
    prepareEnv();
    api = await startMockWebApi();
    process.env.WEB_APP_URL = api.url;
    server = await startSocketServer();
  });

  afterEach(() => {
    closeAllClients();
  });

  after(async () => {
    await server.close();
    await api.close();
  });

  test("no token → connect_error unauthorized", async () => {
    assert.equal(await expectConnectError(server.url, {}), "unauthorized");
  });

  test("a forged or expired token → connect_error unauthorized", async () => {
    assert.equal(await expectConnectError(server.url, { token: makeSocketToken("alice", "wrong-secret") }), "unauthorized");
    assert.equal(await expectConnectError(server.url, { token: makeSocketToken("alice", undefined, -10) }), "unauthorized");
  });

  test("payload userReferenceId ≠ token sub is ignored: the socket joins as the token's user", async () => {
    const ref = uniqueRef("wait");
    api.games.set(ref, makeGame({ ref, creator: "alice", status: "WAITING_FOR_OPPONENT" }));

    const alice = await connectClient(server.url, "alice");
    const waiting = waitFor(alice, "waiting_for_opponent");
    alice.emit("join_game", { gameReferenceId: ref, userReferenceId: "mallory-claims-to-be-someone" });
    assert.deepEqual(await waiting, { gameReferenceId: ref });
    assert.equal(server.handle.gameManager.getGame(ref)?.isPlayerInGame("alice"), true);
  });

  test("a token for an outsider cannot join as the creator by naming them in the payload", async () => {
    const ref = uniqueRef("imp");
    api.games.set(ref, makeGame({ ref, creator: "alice", opponent: "bob", status: "IN_PROGRESS" }));

    const mallory = await connectClient(server.url, "mallory");
    const error = waitFor<{ code: string; message: string }>(mallory, "error");
    mallory.emit("join_game", { gameReferenceId: ref, userReferenceId: "alice" });
    const payload = await error;
    assert.equal(payload.code, "not_player");
    // Messages carry no ids (AS F-20).
    for (const id of ["alice", "bob", "mallory", ref]) {
      assert.equal(payload.message.includes(id), false, `message leaks ${id}`);
    }
    assert.equal(server.handle.gameManager.getGame(ref)?.isPlayerInGame("alice"), false);
  });

  test("a completed game → error game_completed", async () => {
    const ref = uniqueRef("done");
    api.games.set(ref, makeGame({ ref, creator: "alice", opponent: "bob", status: "COMPLETED" }));

    const alice = await connectClient(server.url, "alice");
    const error = waitFor<{ code: string }>(alice, "error");
    alice.emit("join_game", { gameReferenceId: ref, userReferenceId: "alice" });
    assert.equal((await error).code, "game_completed");
  });

  test("an unknown game → error not_found without the id", async () => {
    const ref = uniqueRef("missing");
    const alice = await connectClient(server.url, "alice");
    const error = waitFor<{ code: string; message: string }>(alice, "error");
    alice.emit("join_game", { gameReferenceId: ref, userReferenceId: "alice" });
    const payload = await error;
    assert.equal(payload.code, "not_found");
    assert.equal(payload.message.includes(ref), false);
  });

  test("the socket sends x-internal-token to game-by-ref (H4 needs it)", async () => {
    const fetches = api.calls.filter((c) => c.path.startsWith("/api/chess/game-by-ref/"));
    assert.ok(fetches.length > 0);
    for (const call of fetches) assert.equal(call.token, process.env.INTERNAL_API_SECRET);
  });
});
