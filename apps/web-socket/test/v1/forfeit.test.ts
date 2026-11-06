// End paths: disconnect forfeit picks the winner by creator/opponent (plan §7.5 #6, AS F-10),
// the final move is persisted before the result (#7, AS F-07), ended sessions answer joins
// with the result and are evicted (#8, AS F-09).
import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  closeAllClients,
  connectClient,
  joinBoth,
  makeGame,
  prepareEnv,
  startMockWebApi,
  startSocketServer,
  uniqueRef,
  until,
  waitFor,
  type MockWebApi,
  type RunningSocketServer,
} from "./helpers";
import { MATE_IN_ONE_FEN, MATE_IN_ONE_MOVE, OPERA_GAME_FEN, OPERA_HISTORY } from "./fixtures/histories";

const GRACE_MS = 200;
const EVICT_MS = 400;

describe("game end paths", () => {
  let api: MockWebApi;
  let server: RunningSocketServer;

  before(async () => {
    prepareEnv();
    api = await startMockWebApi();
    process.env.WEB_APP_URL = api.url;
    server = await startSocketServer({
      evictAfterEndMs: EVICT_MS,
      session: { disconnectGraceMs: GRACE_MS, analysisSecondsOverride: 0 },
    });
  });

  afterEach(() => {
    closeAllClients();
  });

  after(async () => {
    await server.close();
    await api.close();
  });

  test("disconnect of White → Black wins via getGameResult (creator plays Black)", async () => {
    const ref = uniqueRef("forfeit");
    const creator = `c-${ref}`; // Black
    const opponent = `o-${ref}`; // White
    api.games.set(
      ref,
      makeGame({ ref, creator, opponent, gameData: { creatorColor: "black", moveHistory: OPERA_HISTORY, fen: OPERA_GAME_FEN } }),
    );
    const creatorSocket = await connectClient(server.url, creator);
    const opponentSocket = await connectClient(server.url, opponent);
    const started = await joinBoth(api, ref, { socket: creatorSocket, ref: creator }, { socket: opponentSocket, ref: opponent });
    assert.equal(started.first.yourColor, "b");
    assert.equal(started.second.yourColor, "w");

    const disconnectedNotice = waitFor(creatorSocket, "opponent_disconnected");
    const over = waitFor<{ result: string; winner: string; method: string }>(creatorSocket, "game_over", 3000);
    opponentSocket.close(); // White leaves and does not come back
    await disconnectedNotice;
    const result = await over;
    assert.deepEqual(
      { result: result.result, winner: result.winner, method: result.method },
      { result: "CREATOR_WON", winner: "b", method: "timeout" },
    );

    await until(() => api.callsTo("/api/chess/game-over", ref).length === 1, 3000, "game-over call");
    const body = api.callsTo("/api/chess/game-over", ref)[0]!.body;
    assert.equal(body.result, "CREATOR_WON");
    assert.equal(body.winnerId, creator);
    assert.equal(body.method, "timeout");
  });

  test("a reconnect within the grace period cancels the forfeit", async () => {
    const ref = uniqueRef("back");
    const white = `w-${ref}`;
    const black = `b-${ref}`;
    api.games.set(ref, makeGame({ ref, creator: white, opponent: black, gameData: { creatorColor: "white", moveHistory: OPERA_HISTORY } }));
    const whiteSocket = await connectClient(server.url, white);
    const blackSocket = await connectClient(server.url, black);
    await joinBoth(api, ref, { socket: whiteSocket, ref: white }, { socket: blackSocket, ref: black });

    blackSocket.close();
    await waitFor(whiteSocket, "opponent_disconnected");
    const back = await connectClient(server.url, black);
    const resumed = waitFor<{ yourColor: string; fen: string }>(back, "game_started");
    back.emit("join_game", { gameReferenceId: ref, userReferenceId: black });
    assert.equal((await resumed).yourColor, "b");

    await new Promise((resolve) => setTimeout(resolve, GRACE_MS * 2));
    assert.equal(server.handle.gameManager.getGame(ref)?.isEnded(), false);
    assert.equal(api.callsTo("/api/chess/game-over", ref).length, 0);
  });

  test("the mating move is persisted before the result, and the result carries the move list", async () => {
    const ref = uniqueRef("mate");
    const white = `w-${ref}`;
    const black = `b-${ref}`;
    api.games.set(
      ref,
      makeGame({ ref, creator: white, opponent: black, startingFen: MATE_IN_ONE_FEN, gameData: { creatorColor: "white" } }),
    );
    const whiteSocket = await connectClient(server.url, white);
    const blackSocket = await connectClient(server.url, black);
    await joinBoth(api, ref, { socket: whiteSocket, ref: white }, { socket: blackSocket, ref: black });

    const over = waitFor<{ result: string; method: string; winner: string }>(blackSocket, "game_over");
    whiteSocket.emit("make_move", { gameReferenceId: ref, from: MATE_IN_ONE_MOVE.from, to: MATE_IN_ONE_MOVE.to });
    const result = await over;
    assert.deepEqual({ result: result.result, method: result.method, winner: result.winner }, {
      result: "CREATOR_WON",
      method: "checkmate",
      winner: "w",
    });

    await until(() => api.callsTo("/api/chess/game-over", ref).length === 1, 3000, "game-over call");
    const moveCalls = api.callsTo("/api/chess/move", ref);
    const overCall = api.callsTo("/api/chess/game-over", ref)[0]!;
    assert.equal(moveCalls.length, 1, "the final move was persisted");
    assert.ok(moveCalls[0]!.at <= overCall.at, "the move is persisted before game-over");
    assert.equal(overCall.body.moveHistory.length, 1);
    assert.equal(overCall.body.moveHistory[0].san, MATE_IN_ONE_MOVE.san);

    const stored = api.games.get(ref)!;
    assert.equal(stored.status, "COMPLETED");
    assert.equal(stored.gameData?.moveHistory?.length, 1);
    assert.equal((stored.gameData?.moveHistory?.[0] as { san: string }).san, MATE_IN_ONE_MOVE.san);
  });

  test("a restored history that already ends in mate is finished on resume", async () => {
    const ref = uniqueRef("lostresult");
    const white = `w-${ref}`;
    const black = `b-${ref}`;
    const mated = [{ color: "w", piece: "r", from: MATE_IN_ONE_MOVE.from, to: MATE_IN_ONE_MOVE.to, san: MATE_IN_ONE_MOVE.san }];
    api.games.set(
      ref,
      makeGame({ ref, creator: white, opponent: black, startingFen: MATE_IN_ONE_FEN, gameData: { creatorColor: "white", moveHistory: mated } }),
    );
    const whiteSocket = await connectClient(server.url, white);
    const blackSocket = await connectClient(server.url, black);
    const over = waitFor<{ result: string; method: string }>(blackSocket, "game_over");
    await joinBoth(api, ref, { socket: whiteSocket, ref: white }, { socket: blackSocket, ref: black });
    const result = await over;
    assert.deepEqual({ result: result.result, method: result.method }, { result: "CREATOR_WON", method: "checkmate" });
    await until(() => api.games.get(ref)?.status === "COMPLETED", 3000, "completed");
  });

  test("a join to an ended session gets game_over with the snapshot, then the session is evicted", async () => {
    const ref = uniqueRef("ended");
    const white = `w-${ref}`;
    const black = `b-${ref}`;
    api.games.set(ref, makeGame({ ref, creator: white, opponent: black, gameData: { creatorColor: "white", moveHistory: OPERA_HISTORY } }));
    const whiteSocket = await connectClient(server.url, white);
    const blackSocket = await connectClient(server.url, black);
    await joinBoth(api, ref, { socket: whiteSocket, ref: white }, { socket: blackSocket, ref: black });

    const over = waitFor(whiteSocket, "game_over");
    blackSocket.emit("resign", { gameReferenceId: ref });
    await over;
    const fetchesAfterEnd = api.callsTo(`/api/chess/game-by-ref/${ref}`).length;

    // Rejoin (a refresh) inside the rematch window: the result, never a live board.
    const again = await connectClient(server.url, black);
    const started: unknown[] = [];
    again.on("game_started", (payload: unknown) => started.push(payload));
    const snapshot = waitFor<{ result: string; method: string; gameReferenceId: string; moveHistory: unknown[] }>(again, "game_over");
    again.emit("join_game", { gameReferenceId: ref, userReferenceId: black });
    const payload = await snapshot;
    assert.equal(payload.result, "CREATOR_WON");
    assert.equal(payload.method, "resignation");
    assert.equal(payload.gameReferenceId, ref);
    assert.equal(payload.moveHistory.length, OPERA_HISTORY.length);
    assert.equal(started.length, 0);
    assert.equal(api.callsTo(`/api/chess/game-by-ref/${ref}`).length, fetchesAfterEnd, "no web call for an ended session");

    // Evicted after the window.
    await until(() => server.handle.gameManager.getGame(ref) === undefined, EVICT_MS * 5, "eviction");
  });

  test("every end path evicts: checkmate and timeout-by-disconnect sessions leave memory too", async () => {
    // The two games above ended by forfeit and by checkmate; both must be gone by now.
    await until(
      () => [...api.games.keys()].filter((ref) => ref.startsWith("forfeit-") || ref.startsWith("mate-")).every((ref) => !server.handle.gameManager.getGame(ref)),
      EVICT_MS * 5,
      "eviction of earlier games",
    );
  });
});
