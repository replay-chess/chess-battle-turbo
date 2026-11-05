// `/internal/tournament-event` requires `x-internal-token` (plan §7.5 #5, AS F-06).
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { TEST_SECRET, prepareEnv, startSocketServer, type RunningSocketServer } from "./helpers";
import { verifyInternalToken } from "../utils/internalAuth";

describe("verifyInternalToken", () => {
  test("accepts only the exact secret", () => {
    assert.equal(verifyInternalToken("s3cret", "s3cret"), true);
    assert.equal(verifyInternalToken("s3creT", "s3cret"), false);
  });

  test("refuses missing, empty, non-string and wrong-length tokens without throwing", () => {
    assert.equal(verifyInternalToken(undefined, "s3cret"), false);
    assert.equal(verifyInternalToken("", "s3cret"), false);
    assert.equal(verifyInternalToken(["s3cret"], "s3cret"), false);
    assert.equal(verifyInternalToken("s3cret-longer", "s3cret"), false);
    assert.equal(verifyInternalToken("s3", "s3cret"), false);
  });

  test("refuses everything when no secret is configured", () => {
    assert.equal(verifyInternalToken("", ""), false);
    assert.equal(verifyInternalToken("anything", undefined), false);
  });
});

describe("POST /internal/tournament-event", () => {
  let server: RunningSocketServer;

  before(async () => {
    prepareEnv();
    server = await startSocketServer();
  });

  after(async () => {
    await server.close();
  });

  function post(headers: Record<string, string>, body: unknown = { event: "tournament_ended", tournamentReferenceId: "t-1" }) {
    return fetch(`${server.url}/internal/tournament-event`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  }

  test("without a token → 401", async () => {
    const res = await post({});
    assert.equal(res.status, 401);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, "unauthorized");
  });

  test("with the token → 200", async () => {
    const res = await post({ "x-internal-token": TEST_SECRET });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { success: true });
  });

  test("wrong-length token → 401 without throwing", async () => {
    const res = await post({ "x-internal-token": `${TEST_SECRET}x` });
    assert.equal(res.status, 401);
    const short = await post({ "x-internal-token": "x" });
    assert.equal(short.status, 401);
    // The server is still healthy afterwards.
    const health = await fetch(`${server.url}/health`);
    assert.equal(health.status, 200);
  });

  test("same-length wrong token → 401", async () => {
    const wrong = TEST_SECRET.slice(0, -1) + (TEST_SECRET.endsWith("f") ? "e" : "f");
    const res = await post({ "x-internal-token": wrong });
    assert.equal(res.status, 401);
  });

  test("valid token but missing fields → 400", async () => {
    const res = await post({ "x-internal-token": TEST_SECRET }, { event: "game_ended" });
    assert.equal(res.status, 400);
  });
});
