// Socket → web calls: token on every call, retries with backoff on 5xx, no retry on 4xx,
// envelope error messages, and tolerance of the game-by-ref invite projection
// (plan §7.5 #9 and "+", AS F-08).
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { TEST_SECRET, makeGame, prepareEnv, startMockWebApi, uniqueRef, type MockWebApi } from "./helpers";
import { ApiError, apiClientConfig, completeGame, errorMessageOf, fetchGameByRef, persistMove } from "../utils/apiClient";

describe("apiClient", () => {
  let api: MockWebApi;

  before(async () => {
    prepareEnv();
    api = await startMockWebApi();
    process.env.WEB_APP_URL = api.url;
    apiClientConfig.retryDelaysMs = [5, 5, 5];
  });

  beforeEach(() => {
    process.env.INTERNAL_API_SECRET = TEST_SECRET;
  });

  after(async () => {
    await api.close();
  });

  function moveBody(ref: string, plies = 1) {
    return {
      gameReferenceId: ref,
      userReferenceId: "u",
      from: "e2" as const,
      to: "e4" as const,
      fen: "x",
      moveHistory: Array.from({ length: plies }, () => ({ san: "e4" })),
      whiteTime: 300,
      blackTime: 300,
    };
  }

  test("errorMessageOf reads both the old string and the new envelope", () => {
    assert.equal(errorMessageOf({ error: "old style" }, "fallback"), "old style");
    assert.equal(errorMessageOf({ error: { code: "conflict", message: "new style" } }, "fallback"), "new style");
    assert.equal(errorMessageOf(null, "fallback"), "fallback");
    assert.equal(errorMessageOf({ error: { code: "x" } }, "fallback"), "fallback");
  });

  test("fetchGameByRef sends x-internal-token and gets the full body", async () => {
    const ref = uniqueRef("full");
    api.games.set(ref, makeGame({ ref, creator: "a", opponent: "b", initialTimeSeconds: 180 }));
    api.games.get(ref)!.creatorTimeRemaining = 42;
    const data = await fetchGameByRef(ref);
    assert.equal(data.creatorTimeRemaining, 42);
    const call = api.callsTo(`/api/chess/game-by-ref/${ref}`).at(-1)!;
    assert.equal(call.token, TEST_SECRET);
  });

  test("fetchGameByRef tolerates the invite projection (clocks fall back to the initial time)", async () => {
    const ref = uniqueRef("proj");
    api.games.set(ref, makeGame({ ref, creator: "a", opponent: "b", initialTimeSeconds: 180 }));
    process.env.INTERNAL_API_SECRET = "a-different-secret-of-another-len";
    const data = await fetchGameByRef(ref);
    assert.equal(data.creatorTimeRemaining, 180);
    assert.equal(data.opponentTimeRemaining, 180);
  });

  test("persistMove retries a 5xx with backoff, then succeeds", async () => {
    const ref = uniqueRef("retry");
    api.games.set(ref, makeGame({ ref, creator: "a", opponent: "b" }));
    api.failNext("/api/chess/move", 503, 2);
    await persistMove(moveBody(ref));
    assert.equal(api.callsTo("/api/chess/move", ref).length, 3);
    assert.equal(api.games.get(ref)!.gameData?.moveHistory?.length, 1);
  });

  test("persistMove gives up after 3 retries (4 attempts)", async () => {
    const ref = uniqueRef("down");
    api.games.set(ref, makeGame({ ref, creator: "a", opponent: "b" }));
    api.failNext("/api/chess/move", 500, 10);
    await assert.rejects(persistMove(moveBody(ref)), (error: unknown) => error instanceof ApiError && error.status === 500);
    assert.equal(api.callsTo("/api/chess/move", ref).length, 4);
    api.failNext("/api/chess/move", 500, 0);
  });

  test("a 409 (shorter history) is final: no retry, the message comes from the envelope", async () => {
    const ref = uniqueRef("short");
    api.games.set(ref, makeGame({ ref, creator: "a", opponent: "b" }));
    await persistMove(moveBody(ref, 3));
    await assert.rejects(
      persistMove(moveBody(ref, 2)),
      (error: unknown) => error instanceof ApiError && error.status === 409 && error.message === "A newer move history is already stored.",
    );
    assert.equal(api.callsTo("/api/chess/move", ref).length, 2);
  });

  test("completeGame treats a 409 (already completed) as done", async () => {
    const ref = uniqueRef("twice");
    api.games.set(ref, makeGame({ ref, creator: "a", opponent: "b" }));
    const body = { gameReferenceId: ref, result: "DRAW" as const, method: "draw_agreement" as const, fen: "x", whiteTime: 1, blackTime: 1 };
    await completeGame(body);
    await completeGame(body); // 409 from the second call, swallowed
    assert.equal(api.callsTo("/api/chess/game-over", ref).length, 2);
  });

  test("each attempt times out and is retried; the last timeout is thrown", async () => {
    const ref = uniqueRef("slow");
    api.games.set(ref, makeGame({ ref, creator: "a", opponent: "b" }));
    const previous = apiClientConfig.timeoutMs;
    apiClientConfig.timeoutMs = 50;
    api.slowNext("/api/chess/move", 300, 4); // every attempt answers after its timeout
    const started = Date.now();
    try {
      await assert.rejects(persistMove(moveBody(ref)), (error: unknown) => error instanceof Error && !(error instanceof ApiError));
    } finally {
      apiClientConfig.timeoutMs = previous;
    }
    assert.equal(api.callsTo("/api/chess/move", ref).length, 4, "1 attempt + 3 retries");
    assert.ok(Date.now() - started < 2000);
    // With a normal timeout the same call goes through.
    await new Promise((resolve) => setTimeout(resolve, 350)); // let the slow answers drain
    await persistMove(moveBody(ref, 2));
    assert.equal(api.games.get(ref)!.gameData?.moveHistory?.length, 2);
  });
});
