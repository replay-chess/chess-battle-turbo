// The worker → socket hops (phase-03 plan P3-D8, P3-D13, P3-D21; task C3 "the lag pause holds with a fake
// /internal/load"): a fake socket server verifies every request with the real verifyInternal() and the socket's kid
// policy, and answers emits and load probes.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, describe, it } from "node:test";
import { kidMayCall, kidMayEmit, parseKeyRing, ReplayGuard, verifyInternal } from "@repo/contracts/internal/auth";
import { EmitBody } from "@repo/contracts/socket/internal";
import { silentLogger } from "../obs/log";
import { Metrics } from "../obs/metrics";
import { FakeClock } from "../scheduler/clock";
import { Emitter } from "./emit";
import { buildEvent } from "./events";
import { LagPause, LoadProbe, type LoadSample, type LoadSource } from "./load";

const key = () => randomBytes(32).toString("base64");
const wkKey = key();
/** The worker's ring (signs with wk). */
const workerRing = parseKeyRing(`wk:${wkKey},web:${key()}`);
/** The socket's ring: accepts wk. */
const socketRing = parseKeyRing(`ws:${key()},wk:${wkKey}`);
const metrics = () => new Metrics({ workerId: "w", bootId: "00000001", version: "0", profile: "sf18-v1" }, 0);
const REF_A = "cuseraaaaaaaaaaaaaaaaaaaa";
const REF_B = "cuserbbbbbbbbbbbbbbbbbbbb";
const GAME = "cgamereference0000000001";

describe("socket hops", () => {
  const replay = new ReplayGuard();
  const received: { path: string; kid: string; body: unknown }[] = [];
  let status = 202;
  let load: LoadSample = { loopLagP99Ms: 5, liveGames: 3, sockets: 10, draining: false };
  let base = "";

  const read = (req: IncomingMessage) =>
    new Promise<string>((resolve) => {
      let s = "";
      req.on("data", (d: Buffer) => (s += d.toString()));
      req.on("end", () => resolve(s));
    });
  const server = createServer(async (req, res) => {
    const body = await read(req);
    const v = verifyInternal({ headers: req.headers, method: req.method!, path: req.url!, body, keys: socketRing, nowMs: Date.now(), replay });
    if (!v.ok || !kidMayCall(v.kid, req.url!)) {
      res.writeHead(401).end();
      return;
    }
    received.push({ path: req.url!, kid: v.kid, body: body ? JSON.parse(body) : null });
    if (req.url === "/internal/load") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(load));
      return;
    }
    const parsed = EmitBody.parse(JSON.parse(body));
    if (!kidMayEmit(v.kid, parsed.event)) {
      res.writeHead(403).end();
      return;
    }
    res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify({ delivered: parsed.targets.length }));
  });

  before(async () => {
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => {
    server.close();
  });
  beforeEach(() => {
    received.length = 0;
    status = 202;
  });

  const emitter = (m = metrics(), baseUrl: string | null = base) =>
    new Emitter({ baseUrl, keys: workerRing, log: silentLogger, metrics: m, nowMs: () => Date.now() });

  it("emits a signed P2 body to the members' user rooms (kid wk, allowed event)", async () => {
    const m = metrics();
    const data = buildEvent("analysis:writing", { gameRef: GAME });
    assert.equal(await emitter(m).emit("analysis:writing", data, [REF_A, REF_B, REF_A], { dedupeKey: "w:1" }), "sent");
    assert.equal(received.length, 1);
    assert.equal(received[0]!.kid, "wk");
    assert.deepEqual(received[0]!.body, {
      v: 1,
      targets: [{ userRef: REF_A }, { userRef: REF_B }],
      event: "analysis:writing",
      data: { v: 1, gameRef: GAME },
      dedupeKey: "w:1",
    });
    assert.deepEqual(m.snapshot(0, { draining: false, nextRunAtMs: null, lastDrainAtMs: null }).emits, { "analysis:writing": 1 });
  });

  it("splits more than 50 targets into several calls", async () => {
    const refs = Array.from({ length: 120 }, (_, i) => `cuser${String(i).padStart(20, "0")}`);
    await emitter().emit("games:changed", buildEvent("games:changed", {}), refs);
    assert.deepEqual(received.map((r) => (r.body as { targets: unknown[] }).targets.length), [50, 50, 20]);
  });

  it("retries a 5xx once, a second later (a fresh signature), never a 4xx, and never throws", async () => {
    status = 503;
    assert.equal(await emitter().emit("analysis:writing", buildEvent("analysis:writing", { gameRef: GAME }), [REF_A]), "failed");
    assert.equal(received.length, 2, "one retry");
    received.length = 0;
    status = 422;
    // Another body: the first part's retry signed this one in the same second.
    assert.equal(await emitter().emit("analysis:writing", buildEvent("analysis:writing", { gameRef: "cgamereference0000000002" }), [REF_A]), "failed");
    assert.equal(received.length, 1, "no retry on a 4xx");
  });

  it("skips without a socket URL or without members", async () => {
    assert.equal(await emitter(metrics(), null).emit("games:changed", buildEvent("games:changed", {}), [REF_A]), "skipped");
    assert.equal(await emitter().emit("games:changed", buildEvent("games:changed", {}), []), "skipped");
    assert.equal(received.length, 0);
  });

  it("refuses to build a payload the contract rejects", () => {
    assert.throws(() => buildEvent("analysis:writing", { gameRef: "not a ref" }));
  });

  it("the load probe signs as wk, reads the sample, and polls at most once a second", async () => {
    const clock = new FakeClock(Date.now());
    const probe = new LoadProbe({ baseUrl: base, keys: workerRing, clock, log: silentLogger });
    assert.deepEqual(await probe.read(), load);
    await probe.read();
    assert.equal(received.filter((r) => r.path === "/internal/load").length, 1, "cached within the second");
    await clock.advance(1_000);
    await probe.read();
    assert.equal(received.filter((r) => r.path === "/internal/load").length, 2);
    assert.equal(received[0]!.kid, "wk");
  });

  it("the load probe fails open (null) when the socket is unreachable", async () => {
    const probe = new LoadProbe({ baseUrl: "http://127.0.0.1:1", keys: workerRing, clock: new FakeClock(), log: silentLogger });
    assert.equal(await probe.read(), null);
    const none = new LoadProbe({ baseUrl: null, keys: workerRing, clock: new FakeClock(), log: silentLogger });
    assert.equal(await none.read(), null);
  });

  it("the lag pause holds while the socket's lag p99 is above LAG_PAUSE_MS, in 200 ms steps, and resumes", async () => {
    // Another second than the previous probe test (each probe is signed; the fake socket refuses a replayed signature).
    const clock = new FakeClock(Date.now() + 20_000);
    const m = metrics();
    load = { loopLagP99Ms: 85, liveGames: 40, sockets: 300, draining: false };
    const lag = new LagPause({ source: new LoadProbe({ baseUrl: base, keys: workerRing, clock, log: silentLogger }), thresholdMs: 40, clock, metrics: m });
    let paused: number | null = null;
    void lag.waitForCapacity().then((ms) => (paused = ms));
    await clock.advance(2_000);
    assert.equal(paused, null, "still holding after 2 s of lag");
    load = { ...load, loopLagP99Ms: 12 };
    await clock.advance(1_200);
    assert.ok(paused !== null && paused >= 2_000 && paused <= 3_400, `paused ${paused} ms`);
    assert.equal(m.lagPauseMs, paused);
  });

  it("the lag pause also holds while the socket drains, gives up after 60 s, and stops on abort", async () => {
    const clock = new FakeClock();
    const busy: LoadSource = { read: async () => ({ loopLagP99Ms: 0, liveGames: 0, sockets: 0, draining: true }) };
    const lag = new LagPause({ source: busy, thresholdMs: 40, clock, metrics: metrics() });
    let paused: number | null = null;
    void lag.waitForCapacity().then((ms) => (paused = ms));
    await clock.advance(60_000);
    assert.equal(paused, 60_000);
    const ac = new AbortController();
    let aborted: number | null = null;
    void lag.waitForCapacity(ac.signal).then((ms) => (aborted = ms));
    await clock.advance(400);
    ac.abort();
    await clock.advance(0);
    assert.equal(aborted, 400);
    const idle: LoadSource = { read: async () => ({ loopLagP99Ms: 39, liveGames: 1, sockets: 1, draining: false }) };
    assert.equal(await new LagPause({ source: idle, thresholdMs: 40, clock, metrics: metrics() }).waitForCapacity(), 0);
  });
});
