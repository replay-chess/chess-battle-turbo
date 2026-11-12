// P3's use of the signed internal surface (phase-03 plan §5.11, §7.4, task E2; `emit.analysis.int.test`). No database:
// the HTTP surface is the same for every persistence adapter.
//   - the worker (kid wk) emits every analysis event to the member's user room (202, delivered with `useq`), and the
//     web may too; the per-recipient `analysis:done` dedupeKey delivers once;
//   - the caller allow-list: wk may not emit test:echo (403); ops may not emit analysis events (403); an unknown
//     domain is 422 before the allow-list; wrong data for a live room is 422 invalid_data; unsigned is 401;
//   - analysis events only go to user rooms (a game room target is 400);
//   - GET /internal/load: wk only (web/ops 403, unsigned 401), the LoadResponse shape, `draining` after a restart notice.
import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { parseKeyRing, signInternal } from "@repo/contracts/internal/auth";
import { analysisDoneDedupeKey } from "@repo/contracts/socket/analysis";
import { analysisEventFixtures } from "@repo/contracts/socket/fixtures/analysis";
import { LoadResponse } from "@repo/contracts/socket/internal";
import { ROOM } from "@repo/contracts/socket/rooms";
import { createSocketServer, type SocketServerHandle } from "../src/app";
import { staticLoopLag } from "../src/obs/metrics";
import { SILENT_LOGGER, createMemoryMetrics } from "../src/ports";
import { MemoryPersistence, closeAllClients, connect, delay, testEnv, testTiming, user, waitFor } from "./helpers";

const k = () => randomBytes(32).toString("base64");
const RING = `web:${k()},ops:${k()},wk:${k()}`;
const keys = parseKeyRing(RING);

function signed(path: string, body: unknown, kid: string, method: "POST" | "GET" = "POST") {
  const raw = method === "GET" ? "" : JSON.stringify(body);
  const headers = signInternal({ keys, method, path, body: raw, nowMs: Date.now(), kid });
  return { raw, headers: { ...headers, "content-type": "application/json" } };
}

const EVENTS = analysisEventFixtures();

describe("analysis events through /internal/emit and the /internal/load probe", () => {
  let handle: SocketServerHandle;
  let url: string;
  const metrics = createMemoryMetrics();

  before(async () => {
    handle = createSocketServer({
      env: testEnv({ INTERNAL_API_SECRET: RING }),
      persistence: new MemoryPersistence(),
      log: SILENT_LOGGER,
      metrics,
      timing: testTiming(),
      loopLag: staticLoopLag(3),
      loadLag: staticLoopLag(41.26),
      drainTimeoutMs: 1_000,
    });
    url = `http://127.0.0.1:${await handle.listen(0, "127.0.0.1")}`;
  });
  afterEach(() => closeAllClients());
  after(() => handle.shutdown());

  const post = (path: string, s: { raw: string; headers: Record<string, string> }) =>
    fetch(`${url}${path}`, { method: "POST", headers: s.headers, body: s.raw });
  const emit = (body: Record<string, unknown>, kid = "wk") => post("/internal/emit", signed("/internal/emit", body, kid));

  test("wk delivers every analysis event to the member's user room, with useq", async () => {
    const u = user("member");
    const { socket, hello } = await connect(url, u);
    let useq = hello.useq;
    for (const [event, data] of Object.entries(EVENTS)) {
      const got = waitFor(socket, event);
      const res = await emit({ v: 1, targets: [{ userRef: u.ref }], event, data });
      assert.equal(res.status, 202, event);
      assert.deepEqual(await res.json(), { delivered: 1 }, event);
      const payload = (await got) as Record<string, unknown>;
      useq += 1;
      assert.equal(payload.useq, useq, `${event}: the user's next useq`);
      assert.deepEqual({ ...payload, useq: undefined }, { ...data, useq: undefined }, event);
    }
  });

  test("the web may emit analysis:queued (A3/A4); one call reaches both members", async () => {
    const a = user("a");
    const b = user("b");
    const A = await connect(url, a);
    const B = await connect(url, b);
    const gotA = waitFor(A.socket, "analysis:queued");
    const gotB = waitFor(B.socket, "analysis:queued");
    const res = await emit({ v: 1, targets: [{ userRef: a.ref }, { userRef: b.ref }], event: "analysis:queued", data: EVENTS["analysis:queued"] }, "web");
    assert.equal(res.status, 202);
    assert.deepEqual(await res.json(), { delivered: 2 });
    await Promise.all([gotA, gotB]);
  });

  test("analysis:done dedupes per recipient key: a retried emit is answered without a second delivery", async () => {
    const u = user("done");
    const { socket } = await connect(url, u);
    const seen: unknown[] = [];
    socket.on("analysis:done", (p) => seen.push(p));
    const body = {
      v: 1,
      targets: [{ userRef: u.ref }],
      event: "analysis:done",
      data: EVENTS["analysis:done"],
      dedupeKey: analysisDoneDedupeKey(77n, 1, "w"),
    };
    const first = await emit(body);
    assert.deepEqual(await first.json(), { delivered: 1 });
    await delay(1_050); // a new signature timestamp (the same signature inside the window is a replay)
    const second = await emit(body);
    assert.deepEqual(await second.json(), { delivered: 0, deduped: true });
    await delay(100);
    assert.equal(seen.length, 1);
  });

  test("caller allow-list and shapes: wk test:echo 403, ops analysis 403, unknown domain 422, bad data 422, game room 400, unsigned 401", async () => {
    const u = user("u");
    await connect(url, u);
    const target = [{ userRef: u.ref }];
    assert.equal((await emit({ v: 1, targets: target, event: "test:echo", data: { text: "x" } })).status, 403);
    assert.equal((await emit({ v: 1, targets: target, event: "analysis:queued", data: EVENTS["analysis:queued"] }, "ops")).status, 403);
    assert.equal((await emit({ v: 1, targets: target, event: "import:progress", data: {} })).status, 422, "not registered yet (P4)");
    const bad = await emit({ v: 1, targets: target, event: "analysis:progress", data: { ...EVENTS["analysis:progress"], j: "" } });
    assert.equal(bad.status, 422);
    assert.deepEqual(await bad.json(), { error: { code: "invalid_data" } });
    const gameRoom = await emit({ v: 1, targets: [{ room: ROOM.game("cmwc9p8sjf72avcjm23o4v6rv") }], event: "games:changed", data: { v: 1 } });
    assert.equal(gameRoom.status, 400, "analysis events go to user rooms only");
    const unsigned = await fetch(`${url}/internal/emit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ v: 1, targets: target, event: "games:changed", data: { v: 1 } }),
    });
    assert.equal(unsigned.status, 401);
    assert.ok((metrics.counts.get("ws.internal.auth_fail{reason=event}") ?? 0) >= 1, "wk → test:echo is an event refusal");
    assert.ok((metrics.counts.get("ws.internal.auth_fail{reason=path}") ?? 0) >= 1, "ops may not call /internal/emit at all");
  });

  test("GET /internal/load: wk only, the LoadResponse shape from the windowed monitor, draining after a restart notice", async () => {
    const get = (kid?: string) =>
      fetch(`${url}/internal/load`, kid ? { headers: signed("/internal/load", null, kid, "GET").headers } : {});
    assert.equal((await get()).status, 401);
    assert.equal((await get("web")).status, 403);
    assert.equal((await get("ops")).status, 403);
    const u = user("load");
    await connect(url, u);
    const res = await get("wk");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const body = LoadResponse.parse(await res.json());
    assert.equal(body.loopLagP99Ms, 41.3);
    assert.equal(body.liveGames, 0);
    assert.ok(body.sockets >= 1);
    assert.equal(body.draining, false);
    handle.announceRestart(30);
    await delay(1_050); // a GET has no body: the same second would sign identically (a replay)
    const again = await get("wk");
    assert.equal(again.status, 200);
    const after = LoadResponse.parse(await again.json());
    assert.equal(after.draining, true);
  });
});
