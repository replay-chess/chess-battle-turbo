// POST /internal/emit and the other signed endpoints (phase-02 plan 12.4 `emit`, 7.5, 7.5.1). No database needed:
// the HTTP surface is the same for every persistence adapter.
//   unsigned / bad signature / replayed signature → 401; `{room}` or `rooms[]` → 400 (strict); unregistered event →
//   422; an event outside the kid's allow-list → 403; `test:echo` reaches the target (with `useq` in user rooms);
//   `dedupeKey` delivered once; every target empty → 202 {delivered: 0} without parsing `data`; ops-only paths.
import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { parseKeyRing, signInternal } from "@repo/contracts/internal/auth";
import { ROOM } from "@repo/contracts/socket/rooms";
import { createSocketServer, type SocketServerHandle } from "../src/app";
import { staticLoopLag } from "../src/obs/metrics";
import { SILENT_LOGGER, createMemoryMetrics } from "../src/ports";
import { MemoryPersistence, closeAllClients, connect, startGame, testEnv, testTiming, user, waitFor, type TestServer } from "./helpers";

const k = () => randomBytes(32).toString("base64");
const RING = `web:${k()},ops:${k()},wk:${k()}`;
const keys = parseKeyRing(RING);

function signed(path: string, body: unknown, kid = "web", method: "POST" | "GET" = "POST") {
  const raw = method === "GET" ? "" : JSON.stringify(body);
  const headers = signInternal({ keys, method, path, body: raw, nowMs: Date.now(), kid });
  return { raw, headers: { ...headers, "content-type": "application/json" } };
}

describe("signed /internal/* endpoints", () => {
  let handle: SocketServerHandle;
  let url: string;
  const parsed: string[] = [];
  const metrics = createMemoryMetrics();
  const persistence = new MemoryPersistence();

  before(async () => {
    handle = createSocketServer({
      env: testEnv({ INTERNAL_API_SECRET: RING }),
      persistence,
      log: SILENT_LOGGER,
      metrics,
      timing: testTiming(),
      loopLag: staticLoopLag(3),
      onEmitParse: (event) => parsed.push(event),
      drainTimeoutMs: 1_000,
    });
    url = `http://127.0.0.1:${await handle.listen(0, "127.0.0.1")}`;
  });
  afterEach(() => closeAllClients());
  after(() => handle.shutdown());

  const post = (path: string, raw: string, headers: Record<string, string>) =>
    fetch(`${url}${path}`, { method: "POST", headers, body: raw });

  test("auth: unsigned, bad signature and a replay are 401 (counted by reason)", async () => {
    const u = user("u");
    const body = { v: 1, targets: [{ userRef: u.ref }], event: "test:echo", data: { text: "x" } };
    assert.equal((await post("/internal/emit", JSON.stringify(body), { "content-type": "application/json" })).status, 401);
    const s = signed("/internal/emit", body);
    const tampered = { ...s.headers, "x-rc-sig": s.headers["x-rc-sig"].replace(/^./, (c) => (c === "A" ? "B" : "A")) };
    assert.equal((await post("/internal/emit", s.raw, tampered)).status, 401);
    assert.equal((await post("/internal/emit", s.raw, s.headers)).status, 202);
    assert.equal((await post("/internal/emit", s.raw, s.headers)).status, 401, "a replayed signature");
    assert.equal(metrics.counts.get("ws.internal.auth_fail{reason=missing}"), 1);
    assert.equal(metrics.counts.get("ws.internal.auth_fail{reason=bad_sig}"), 1);
    assert.equal(metrics.counts.get("ws.internal.auth_fail{reason=replay}"), 1);
  });

  test("shapes: {room} and rooms[] → 400; unknown event → 422; outside the kid's allow-list → 403", async () => {
    const u = user("u");
    const room = signed("/internal/emit", { v: 1, room: ROOM.user(u.ref), event: "test:echo", data: { text: "x" } });
    assert.equal((await post("/internal/emit", room.raw, room.headers)).status, 400);
    const rooms = signed("/internal/emit", { v: 1, rooms: [ROOM.user(u.ref)], targets: [{ userRef: u.ref }], event: "test:echo", data: {} });
    assert.equal((await post("/internal/emit", rooms.raw, rooms.headers)).status, 400);
    const unknown = signed("/internal/emit", { v: 1, targets: [{ userRef: u.ref }], event: "entitlement:changed", data: {} });
    assert.equal((await post("/internal/emit", unknown.raw, unknown.headers)).status, 422);
    const wk = signed("/internal/emit", { v: 1, targets: [{ userRef: u.ref }], event: "test:echo", data: { text: "x" } }, "wk");
    assert.equal((await post("/internal/emit", wk.raw, wk.headers)).status, 403);
    const ops = signed("/internal/emit", { v: 1, targets: [{ userRef: u.ref }], event: "test:echo", data: { text: "x" } }, "ops");
    assert.equal((await post("/internal/emit", ops.raw, ops.headers)).status, 403, "ops may not emit");
  });

  test("delivery: test:echo reaches the user room with useq; dedupeKey once; empty rooms skip the parse", async () => {
    const u = user("u");
    const { socket, hello } = await connect(url, u);
    const got = waitFor(socket, "test:echo");
    const body = { v: 1, targets: [{ userRef: u.ref }], event: "test:echo", data: { text: "hi" }, dedupeKey: "k1" };
    const s1 = signed("/internal/emit", body);
    const r1 = await post("/internal/emit", s1.raw, s1.headers);
    assert.equal(r1.status, 202);
    assert.deepEqual(await r1.json(), { delivered: 1 });
    const echo = await got;
    assert.equal(echo.text, "hi");
    assert.equal(echo.useq, hello.useq + 1);
    // A retry carries a new timestamp (an identical signature inside the window would be refused as a replay).
    await new Promise((r) => setTimeout(r, 1_050));
    const s2 = signed("/internal/emit", body);
    const r2 = await post("/internal/emit", s2.raw, s2.headers);
    assert.deepEqual(await r2.json(), { delivered: 0, deduped: true });

    const nobody = user("nobody");
    const before = parsed.length;
    const s3 = signed("/internal/emit", { v: 1, targets: [{ userRef: nobody.ref }], event: "test:echo", data: { bad: true } });
    const r3 = await post("/internal/emit", s3.raw, s3.headers);
    assert.equal(r3.status, 202);
    assert.deepEqual(await r3.json(), { delivered: 0 });
    assert.equal(parsed.length, before, "the data parser was not called");

    const s4 = signed("/internal/emit", { v: 1, targets: [{ userRef: u.ref }], event: "test:echo", data: { bad: true } });
    assert.equal((await post("/internal/emit", s4.raw, s4.headers)).status, 422, "invalid data for a live room");
  });

  test("ops: broadcast reaches every game room; web may not broadcast; metrics for ops and web; drain is ops-only", async () => {
    const server = { url, handle, persistence } as unknown as TestServer;
    const { W } = await startGame(server, user("w"), user("b"));
    const notice = waitFor(W, "server:restarting");
    const web = signed("/internal/broadcast", { v: 1, type: "restart", inSeconds: 30 });
    assert.equal((await post("/internal/broadcast", web.raw, web.headers)).status, 403);
    const ops = signed("/internal/broadcast", { v: 1, type: "restart", inSeconds: 30 }, "ops");
    const res = await post("/internal/broadcast", ops.raw, ops.headers);
    assert.equal(res.status, 202);
    const out = (await res.json()) as { restartAt: number; rooms: number };
    assert.ok(out.rooms >= 2);
    assert.equal((await notice).restartAt, out.restartAt);
    for (const kid of ["ops", "web"]) {
      const m = signed("/internal/metrics", null, kid, "GET");
      const r = await fetch(`${url}/internal/metrics`, { headers: m.headers });
      assert.equal(r.status, 200);
      const body = (await r.json()) as { loopLag: { p99: number }; restored: boolean; games: { byPhase: Record<string, number> } };
      assert.equal(body.loopLag.p99, 3);
      assert.equal(body.restored, true);
    }
    const drain = signed("/internal/drain", { v: 1 });
    assert.equal((await post("/internal/drain", drain.raw, drain.headers)).status, 403, "web may not drain");
    const ready = await fetch(`${url}/ready`);
    assert.equal(ready.status, 503, "draining after the restart notice");
  });

  test("tournament-event: signed → 200; unsigned → 401 while v1 is off", async () => {
    const body = { event: "tournament_ended", tournamentReferenceId: "t-1" };
    const s = signed("/internal/tournament-event", body);
    const ok = await post("/internal/tournament-event", s.raw, s.headers);
    assert.equal(ok.status, 200);
    const unsigned = await post("/internal/tournament-event", JSON.stringify(body), { "content-type": "application/json" });
    assert.equal(unsigned.status, 401);
  });
});
