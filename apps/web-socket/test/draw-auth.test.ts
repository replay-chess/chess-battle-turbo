// accept_draw requires a player and a pending offer by the opponent (plan §7.5 #1, §8.8,
// AS F-01). Games are restored from the Opera Game so play starts without the study phase.
import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Socket as ClientSocket } from "socket.io-client";
import {
  closeAllClients,
  collect,
  connectClient,
  delay,
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
import { DRAW_SEQUENCE, OPERA_GAME_FEN, OPERA_HISTORY } from "./fixtures/histories";

describe("draw authorisation", () => {
  let api: MockWebApi;
  let server: RunningSocketServer;

  before(async () => {
    prepareEnv({ SOCKET_AUTH_REQUIRED: "true" });
    api = await startMockWebApi();
    process.env.WEB_APP_URL = api.url;
    server = await startSocketServer({ session: { disconnectGraceMs: 60_000 } });
  });

  afterEach(() => {
    closeAllClients();
  });

  after(async () => {
    await server.close();
    await api.close();
  });

  /** White = "w-<n>" (creator), Black = "b-<n>"; position: Opera Game, White to move. */
  async function startGame(): Promise<{ ref: string; white: ClientSocket; black: ClientSocket; whiteRef: string; blackRef: string }> {
    const ref = uniqueRef("draw");
    const whiteRef = `w-${ref}`;
    const blackRef = `b-${ref}`;
    api.games.set(
      ref,
      makeGame({
        ref,
        creator: whiteRef,
        opponent: blackRef,
        gameData: { creatorColor: "white", moveHistory: OPERA_HISTORY, fen: OPERA_GAME_FEN },
      }),
    );
    const white = await connectClient(server.url, whiteRef);
    const black = await connectClient(server.url, blackRef);
    const started = await joinBoth(api, ref, { socket: white, ref: whiteRef }, { socket: black, ref: blackRef });
    assert.equal(started.first.fen, OPERA_GAME_FEN);
    assert.equal(started.first.yourColor, "w");
    assert.equal(started.second.yourColor, "b");
    return { ref, white, black, whiteRef, blackRef };
  }

  function isEnded(ref: string): boolean | undefined {
    return server.handle.gameManager.getGame(ref)?.isEnded();
  }

  test("a non-player's accept_draw is rejected and the game continues", async () => {
    const { ref, white, black } = await startGame();
    const offered = waitFor(black, "draw_offered");
    white.emit("offer_draw", { gameReferenceId: ref });
    await offered;

    const outsider = await connectClient(server.url, "outsider");
    const rejected = waitFor<{ code: string }>(outsider, "error");
    outsider.emit("accept_draw", { gameReferenceId: ref });
    assert.equal((await rejected).code, "no_pending_offer");
    assert.equal(isEnded(ref), false);
    assert.equal(api.callsTo("/api/chess/game-over", ref).length, 0);

    // The real receiver can still accept the pending offer.
    const over = waitFor<{ result: string; method: string }>(white, "game_over");
    black.emit("accept_draw", { gameReferenceId: ref });
    const result = await over;
    assert.equal(result.result, "DRAW");
    assert.equal(result.method, "draw_agreement");
  });

  test("accept without an offer is rejected", async () => {
    const { ref, white, black } = await startGame();
    const rejected = waitFor<{ code: string }>(black, "error");
    black.emit("accept_draw", { gameReferenceId: ref });
    assert.equal((await rejected).code, "no_pending_offer");
    assert.equal(isEnded(ref), false);

    // The game goes on: White can move.
    const moved = waitFor<{ san: string }>(black, "move_made");
    white.emit("make_move", { gameReferenceId: ref, ...DRAW_SEQUENCE.whiteMove });
    assert.equal((await moved).san, "Nxb5");
  });

  test("the offerer cannot accept their own offer", async () => {
    const { ref, white, black } = await startGame();
    const offered = waitFor(black, "draw_offered");
    white.emit("offer_draw", { gameReferenceId: ref });
    await offered;

    const rejected = waitFor<{ code: string }>(white, "error");
    white.emit("accept_draw", { gameReferenceId: ref });
    assert.equal((await rejected).code, "no_pending_offer");
    assert.equal(isEnded(ref), false);
    assert.equal(api.callsTo("/api/chess/game-over", ref).length, 0);
  });

  test("a move clears the offer", async () => {
    const { ref, white, black } = await startGame();
    const offered = waitFor(black, "draw_offered");
    white.emit("offer_draw", { gameReferenceId: ref });
    await offered;

    const moved = waitFor<{ san: string }>(black, "move_made");
    white.emit("make_move", { gameReferenceId: ref, ...DRAW_SEQUENCE.whiteMove });
    await moved;

    const rejected = waitFor<{ code: string }>(black, "error");
    black.emit("accept_draw", { gameReferenceId: ref });
    assert.equal((await rejected).code, "no_pending_offer");
    assert.equal(isEnded(ref), false);

    const replied = waitFor<{ san: string }>(white, "move_made");
    black.emit("make_move", { gameReferenceId: ref, ...DRAW_SEQUENCE.blackReply });
    assert.equal((await replied).san, "cxb5");
  });

  test("a decline clears the offer; only the receiver can decline", async () => {
    const { ref, white, black } = await startGame();
    const offered = waitFor(black, "draw_offered");
    white.emit("offer_draw", { gameReferenceId: ref });
    await offered;

    // The offerer "declining" their own offer changes nothing.
    const declinedToWhite = collect(white, "draw_declined");
    white.emit("decline_draw", { gameReferenceId: ref });
    await delay(100);
    assert.equal(declinedToWhite.length, 0);

    const declined = waitFor(white, "draw_declined");
    black.emit("decline_draw", { gameReferenceId: ref });
    await declined;

    const rejected = waitFor<{ code: string }>(black, "error");
    black.emit("accept_draw", { gameReferenceId: ref });
    assert.equal((await rejected).code, "no_pending_offer");
    assert.equal(isEnded(ref), false);
  });

  test("an accepted draw is persisted once with the move list", async () => {
    const { ref, white, black } = await startGame();
    const offered = waitFor(white, "draw_offered");
    black.emit("offer_draw", { gameReferenceId: ref });
    await offered;

    const over = waitFor<{ result: string }>(black, "game_over");
    white.emit("accept_draw", { gameReferenceId: ref });
    assert.equal((await over).result, "DRAW");
    await until(() => api.callsTo("/api/chess/game-over", ref).length === 1, 3000, "game-over call");
    const body = api.callsTo("/api/chess/game-over", ref)[0]!.body;
    assert.equal(body.result, "DRAW");
    assert.equal(body.moveHistory.length, OPERA_HISTORY.length);

    // A second accept after the end does nothing.
    black.emit("accept_draw", { gameReferenceId: ref });
    await delay(100);
    assert.equal(api.callsTo("/api/chess/game-over", ref).length, 1);
  });
});
