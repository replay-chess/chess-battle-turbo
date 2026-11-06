// Restore by replay (plan §7.5 #12, §8.8, AS F-03), shutdown drain (#13), and the reconnect
// payload of bot games (#10).
import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import {
  closeAllClients,
  collect,
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
import {
  ILLEGAL_HISTORY,
  ILLEGAL_PLY,
  KASPAROV_TOPALOV_FEN,
  LEGAL_HISTORY_40,
  LEGAL_HISTORY_40_FEN,
  LEGAL_HISTORY_46,
  OPERA_GAME_FEN,
  OPERA_GAME_SAN,
  OPERA_HISTORY,
} from "./fixtures/histories";
import { RestoreError, replayMoveHistory } from "../../src/v1/GameSession";

describe("replayMoveHistory", () => {
  const start = new Chess().fen();

  test("the Opera Game replays to the fixture FEN", () => {
    assert.equal(replayMoveHistory(start, OPERA_HISTORY).fen(), OPERA_GAME_FEN);
  });

  test("Kasparov–Topalov: 40 plies, then all 46 to the fixture FEN", () => {
    assert.equal(LEGAL_HISTORY_40.length, 40);
    assert.equal(replayMoveHistory(start, LEGAL_HISTORY_40).fen(), LEGAL_HISTORY_40_FEN);
    assert.equal(replayMoveHistory(start, LEGAL_HISTORY_46).fen(), KASPAROV_TOPALOV_FEN);
  });

  test("SAN strings and UCI strings replay too", () => {
    assert.equal(replayMoveHistory(start, OPERA_GAME_SAN).fen(), OPERA_GAME_FEN);
    const uci = OPERA_HISTORY.map((m) => `${m.from}${m.to}${(m.promotion as string | undefined) ?? ""}`);
    assert.equal(replayMoveHistory(start, uci).fen(), OPERA_GAME_FEN);
  });

  test("keeps the move list, so repetition detection still works", () => {
    const chess = replayMoveHistory(start, ["Nf3", "Nf6", "Ng1", "Ng8", "Nf3", "Nf6", "Ng1", "Ng8"]);
    assert.equal(chess.history().length, 8);
    assert.equal(chess.isThreefoldRepetition(), true);
  });

  test("an illegal ply throws RestoreError with its number", () => {
    assert.throws(
      () => replayMoveHistory(start, ILLEGAL_HISTORY),
      (error: unknown) => error instanceof RestoreError && error.ply === ILLEGAL_PLY && error.code === "restore_failed",
    );
    assert.throws(() => replayMoveHistory(start, [42]), RestoreError);
  });
});

describe("restoring sessions over the socket", () => {
  let api: MockWebApi;
  let server: RunningSocketServer;

  before(async () => {
    prepareEnv();
    api = await startMockWebApi();
    process.env.WEB_APP_URL = api.url;
    server = await startSocketServer({ session: { analysisSecondsOverride: 0, disconnectGraceMs: 60_000 } });
  });

  afterEach(() => {
    closeAllClients();
  });

  after(async () => {
    await server.close();
    await api.close();
  });

  test("an IN_PROGRESS game resumes at the replayed position with its stored colours, without a study phase", async () => {
    const ref = uniqueRef("kt");
    const creator = `c-${ref}`;
    const opponent = `o-${ref}`;
    api.games.set(
      ref,
      makeGame({
        ref,
        creator,
        opponent,
        gameData: { creatorColor: "black", moveHistory: LEGAL_HISTORY_40, fen: LEGAL_HISTORY_40_FEN },
      }),
    );
    const creatorSocket = await connectClient(server.url, creator);
    const opponentSocket = await connectClient(server.url, opponent);
    const studies = collect(creatorSocket, "analysis_phase_started");

    const started = await joinBoth(api, ref, { socket: creatorSocket, ref: creator }, { socket: opponentSocket, ref: opponent });
    assert.equal(started.first.fen, LEGAL_HISTORY_40_FEN);
    assert.equal(started.first.yourColor, "b", "creatorColor black is honoured");
    assert.equal(started.second.yourColor, "w");
    assert.equal(studies.length, 0);
    assert.equal(server.handle.gameManager.getGame(ref)?.getRestoredPlies(), 40);

    // The next move is persisted with the full history (41 plies), never a shorter one.
    const moved = waitFor<{ san: string }>(creatorSocket, "move_made");
    opponentSocket.emit("make_move", { gameReferenceId: ref, from: "h1", to: "e1" }); // 21.Rhe1
    assert.equal((await moved).san, "Rhe1");
    await until(() => api.callsTo("/api/chess/move", ref).length === 1, 3000, "move persisted");
    assert.equal(api.callsTo("/api/chess/move", ref)[0]!.body.moveHistory.length, 41);
  });

  test("an illegal stored history → restore_failed, no session, nothing overwritten", async () => {
    const ref = uniqueRef("bad");
    const creator = `c-${ref}`;
    const opponent = `o-${ref}`;
    api.games.set(ref, makeGame({ ref, creator, opponent, gameData: { creatorColor: "white", moveHistory: ILLEGAL_HISTORY } }));

    const socket = await connectClient(server.url, creator);
    const error = waitFor<{ code: string; message: string }>(socket, "error");
    socket.emit("join_game", { gameReferenceId: ref, userReferenceId: creator });
    const payload = await error;
    assert.equal(payload.code, "restore_failed");
    assert.equal(payload.message.includes(ref), false);
    assert.equal(server.handle.gameManager.getGame(ref), undefined);
    assert.equal(api.callsTo("/api/chess/move", ref).length, 0);
    assert.equal(api.games.get(ref)?.gameData?.moveHistory?.length, ILLEGAL_HISTORY.length);
  });

  test("bot game (gameMode AI): refused, the AI path moved to the client-run v3 screen", async () => {
    const ref = uniqueRef("ai");
    const human = `h-${ref}`;
    api.games.set(
      ref,
      makeGame({
        ref,
        creator: human,
        opponent: `bot-${ref}`,
        gameData: { gameMode: "AI", difficulty: "hard", playerColor: "white", playerReferenceId: human },
      }),
    );
    const socket = await connectClient(server.url, human);
    const error = waitFor<{ code: string }>(socket, "error");
    socket.emit("join_game", { gameReferenceId: ref, userReferenceId: human });
    assert.equal((await error).code, "game_unavailable");
    assert.equal(server.handle.gameManager.getGame(ref), undefined);
  });
});

describe("drain on shutdown, then restore on the next server", () => {
  let api: MockWebApi;

  before(async () => {
    prepareEnv();
    api = await startMockWebApi();
    process.env.WEB_APP_URL = api.url;
  });

  afterEach(() => {
    closeAllClients();
  });

  after(async () => {
    await api.close();
  });

  test("clients hear server_restarting, clocks and moves are saved, and the game resumes with the same moves", async () => {
    const options = { session: { analysisSecondsOverride: 0, disconnectGraceMs: 60_000 } };
    const first = await startSocketServer(options);
    const ref = uniqueRef("drain");
    const white = `w-${ref}`;
    const black = `b-${ref}`;
    api.games.set(ref, makeGame({ ref, creator: white, opponent: black, gameData: { creatorColor: "white" } }));

    let whiteSocket = await connectClient(first.url, white);
    let blackSocket = await connectClient(first.url, black);
    await joinBoth(api, ref, { socket: whiteSocket, ref: white }, { socket: blackSocket, ref: black });

    const m1 = waitFor(blackSocket, "move_made");
    whiteSocket.emit("make_move", { gameReferenceId: ref, from: "e2", to: "e4" });
    await m1;
    const m2 = waitFor(whiteSocket, "move_made");
    blackSocket.emit("make_move", { gameReferenceId: ref, from: "c7", to: "c5" });
    await m2;

    const restarting = waitFor<{ gameReferenceId: string }>(whiteSocket, "server_restarting");
    const disconnected = waitFor<string>(blackSocket, "disconnect");
    await first.close();
    assert.equal((await restarting).gameReferenceId, ref);
    // A transport close: socket.io clients reconnect on their own (not "io server disconnect").
    assert.equal(await disconnected, "transport close");

    // Every move write landed before the server closed, plus a clock flush.
    const stored = api.games.get(ref)!;
    assert.equal(stored.status, "IN_PROGRESS");
    assert.equal(stored.gameData?.moveHistory?.length, 2);
    assert.ok(api.callsTo("/api/chess/game-state", ref).length >= 1, "clocks flushed on drain");
    assert.equal(api.callsTo("/api/chess/game-over", ref).length, 0, "nobody forfeits on a restart");

    // The next server restores the game by replay.
    const second = await startSocketServer(options);
    try {
      whiteSocket = await connectClient(second.url, white);
      blackSocket = await connectClient(second.url, black);
      const studies = collect(whiteSocket, "analysis_phase_started");
      const started = await joinBoth(api, ref, { socket: whiteSocket, ref: white }, { socket: blackSocket, ref: black });
      const expected = new Chess();
      expected.move("e4");
      expected.move("c5");
      assert.equal(started.first.fen, expected.fen());
      assert.equal(started.first.yourColor, "w");
      assert.equal(started.second.yourColor, "b");
      assert.equal(studies.length, 0);

      const m3 = waitFor<{ san: string }>(blackSocket, "move_made");
      whiteSocket.emit("make_move", { gameReferenceId: ref, from: "g1", to: "f3" });
      assert.equal((await m3).san, "Nf3");
      await until(() => api.games.get(ref)?.gameData?.moveHistory?.length === 3, 3000, "third move persisted");
    } finally {
      closeAllClients();
      await second.close();
    }
  });
});
