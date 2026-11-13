// The worker's Chess.com lookup fallback (phase-04 plan §7.7.2, §7.3.1 step 5, §12.1 gate row; D4-23) and the two P4
// routes on the worker's HTTP surface (§7.7.3, §11.1 last row: HMAC only, the per-path allow-list, the 1 KB body).
// The real ChessComClient over the in-process upstream mock, on the process's gates and a FakeClock.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { parseKeyRing, restrictKeyRing, signInternal, WORKER_ACCEPTED_KIDS } from "@repo/contracts/internal/auth";
import {
  DevFaultData,
  InternalLookupData,
  PROVIDER_BODY_MAX_BYTES,
  PROVIDER_LOOKUP_GATE_WAIT_MS,
  WORKER_DEV_FAULT_PATH,
  WORKER_PROVIDER_LOOKUP_PATH,
} from "@repo/contracts/internal/provider";
import { FaultTable, faultingFetch } from "../../../dev/faults";
import { CHESSCOM_BASE, FakeUpstream, LICHESS_BASE } from "../../../import/__tests__/upstream";
import { silentLogger } from "../../../obs/log";
import { Metrics } from "../../../obs/metrics";
import { RecordingTelemetry } from "../../../obs/telemetry";
import { ProviderGates } from "../../../providers/gate";
import { FakeClock } from "../../../scheduler/clock";
import { createHttpServer } from "../../server";
import { devFaultRoute } from "../dev-fault";
import { LOOKUP_CACHE_TTL_MS, LOOKUP_MONTH_GAMES_MAX, ProviderLookup } from "../provider-lookup";

const T0 = Date.UTC(2026, 10, 12, 9, 30, 0);
const BASES = { chesscom: CHESSCOM_BASE, lichess: LICHESS_BASE };

function world(tag: string) {
  const clock = new FakeClock(T0);
  const upstream = new FakeUpstream(tag);
  const gates = new ProviderGates(clock);
  const metrics = new Metrics({ workerId: "w", bootId: "00000001", version: "0", profile: "sf18-v1" }, clock.now());
  const telemetry = new RecordingTelemetry();
  const faults = new FaultTable(() => clock.now());
  const lookup = new ProviderLookup({
    gates,
    settings: { chesscomBaseUrl: CHESSCOM_BASE, contact: "hello@playchess.tech" },
    clock,
    fetch: faultingFetch(upstream.fetch, faults, BASES),
    log: silentLogger,
    sink: { metrics, telemetry },
  });
  return { clock, upstream, gates, metrics, telemetry, faults, lookup };
}

describe("ProviderLookup", () => {
  it("profile+stats: found, through the Chess.com gate, serially, then served from the 600 s cache", async () => {
    const w = world("1");
    w.upstream.addChessComFixture();
    const a = await w.lookup.lookup({ v: 1, username: "KnightOwl_88", what: "profile+stats" });
    assert.equal(a.status, 200);
    assert.ok(a.status === 200 && a.body.kind === "found");
    assert.equal(InternalLookupData.safeParse(a.body).success, true);
    assert.deepEqual(
      w.upstream.to("chesscom").map((r) => r.path),
      ["/pub/player/knightowl_88", "/pub/player/knightowl_88/stats"],
    );
    assert.equal(w.gates.chesscom.stats.calls, 2, "both calls held the process's Chess.com gate");
    assert.equal(w.gates.chesscom.stats.maxInFlight, 1);
    assert.equal(w.upstream.maxActive.chesscom, 1);
    assert.match(w.upstream.requests[0]!.headers["user-agent"]!, /^ReplayChess\/1\.0 \(\+https:\/\/playchess\.tech; hello@playchess\.tech\)$/);
    assert.equal(w.upstream.requests[0]!.headers.authorization, undefined, "anonymous");

    const b = await w.lookup.lookup({ v: 1, username: "knightowl_88", what: "profile+stats" });
    assert.deepEqual(b, a);
    assert.equal(w.upstream.requests.length, 2, "the second lookup was a cache hit");
    assert.equal(w.metrics.imports.total("lookup.cache_hit"), 1);
    assert.equal(w.metrics.imports.total("import.lookup_source", { source: "worker", result: "found" }), 2);

    await w.clock.advance(LOOKUP_CACHE_TTL_MS + 1);
    await w.lookup.lookup({ v: 1, username: "knightowl_88", what: "profile+stats" });
    assert.equal(w.upstream.requests.length, 4, "after 600 s the cache entry expired");
  });

  it("a missing account is not_found and a closed one private; both are cached", async () => {
    const w = world("2");
    const acc = w.upstream.addChessComFixture("closed_one");
    acc.profile = { ...acc.profile, status: "closed:fair_play_violations" };
    assert.deepEqual(await w.lookup.lookup({ v: 1, username: "nobody_here", what: "profile+stats" }), {
      status: 200,
      body: { kind: "not_found" },
    });
    assert.deepEqual(await w.lookup.lookup({ v: 1, username: "closed_one", what: "profile+stats" }), {
      status: 200,
      body: { kind: "private" },
    });
    const n = w.upstream.requests.length;
    await w.lookup.lookup({ v: 1, username: "nobody_here", what: "profile+stats" });
    await w.lookup.lookup({ v: 1, username: "closed_one", what: "profile+stats" });
    assert.equal(w.upstream.requests.length, n);
    assert.equal(w.lookup.size, 2);
  });

  it("archives+month: month keys and the newest month (or the one asked for), capped to its newest games", async () => {
    const w = world("3");
    w.upstream.addChessComMany("bulk_member", T0, 3, 150);
    const newest = await w.lookup.lookup({ v: 1, username: "bulk_member", what: "archives+month" });
    assert.ok(newest.status === 200 && newest.body.kind === "found");
    const body = newest.body as Extract<InternalLookupData, { kind: "found" }>;
    assert.deepEqual(body.archives, ["2026/08", "2026/09", "2026/10"]);
    const games = (body.month as { games: { end_time: number }[] }).games;
    assert.equal(games.length, LOOKUP_MONTH_GAMES_MAX);
    const all = w.upstream.chesscom.get("bulk_member")!.months.get("2026/10")!;
    assert.deepEqual(
      games.map((g) => g.end_time),
      all.slice(-LOOKUP_MONTH_GAMES_MAX).map((g) => g.end_time),
      "the newest games of the month",
    );
    assert.deepEqual(
      w.upstream.to("chesscom").map((r) => r.path),
      ["/pub/player/bulk_member/games/archives", "/pub/player/bulk_member/games/2026/10"],
    );
    const older = await w.lookup.lookup({ v: 1, username: "bulk_member", what: "archives+month", month: "2026/09" });
    assert.ok(older.status === 200 && older.body.kind === "found");
    assert.equal(w.upstream.to("chesscom").at(-1)!.path, "/pub/player/bulk_member/games/2026/09");
    assert.ok(Buffer.byteLength(JSON.stringify(older.body)) < 600_000);
  });

  it("a Chess.com 429 → rate_limited {retryAfterSec}, the gate paused for every caller, never cached", async () => {
    const w = world("4");
    w.upstream.addChessComFixture();
    w.upstream.faults.push({ provider: "chesscom", status: 429, retryAfterSec: 90 });
    const a = await w.lookup.lookup({ v: 1, username: "knightowl_88", what: "profile+stats" });
    assert.deepEqual(a, { status: 200, body: { kind: "rate_limited", retryAfterSec: 90 } });
    assert.ok(w.gates.pauseUntil("chesscom") >= T0 + 90_000, "Retry-After lengthened the 60 s pause");
    // While the gate is paused past the 5 s cap, a lookup is refused at once, without an upstream call.
    const before = w.upstream.requests.length;
    const b = await w.lookup.lookup({ v: 1, username: "knightowl_88", what: "profile+stats" });
    assert.ok(b.status === 200 && b.body.kind === "rate_limited");
    assert.ok(b.status === 200 && b.body.kind === "rate_limited" && b.body.retryAfterSec >= 89);
    assert.equal(w.upstream.requests.length, before);
    assert.equal(w.metrics.imports.total("import.rate_limited", { provider: "chesscom" }), 1, "one 429 from Chess.com");
    // After the pause the lookup goes through (the rate limit was not cached).
    await w.clock.advance(91_000);
    const c = await w.lookup.lookup({ v: 1, username: "knightowl_88", what: "profile+stats" });
    assert.ok(c.status === 200 && c.body.kind === "found");
  });

  it("waits at most 5 s behind an import holding the gate, then answers rate_limited", async () => {
    const w = world("5");
    w.upstream.addChessComFixture();
    const release = await w.gates.chesscom.acquire(); // an import's request in flight
    let answered: unknown = null;
    const pending = w.lookup.lookup({ v: 1, username: "knightowl_88", what: "profile+stats" }).then((r) => (answered = r));
    await w.clock.advance(PROVIDER_LOOKUP_GATE_WAIT_MS - 1);
    assert.equal(answered, null, "still waiting inside the cap");
    await w.clock.advance(2);
    await pending;
    assert.ok(
      answered !== null && (answered as { body: InternalLookupData }).body.kind === "rate_limited",
      "refused after the cap",
    );
    assert.equal(w.upstream.requests.length, 0);
    release();
  });

  it("a 5xx or a timeout is a 502 for the web (not cached); a fault-table 503 too", async () => {
    const w = world("6");
    w.upstream.addChessComFixture();
    w.upstream.faults.push({ provider: "chesscom", status: 503 });
    assert.deepEqual(await w.lookup.lookup({ v: 1, username: "knightowl_88", what: "profile+stats" }), {
      status: 502,
      body: { error: "upstream", kind: "error" },
    });
    w.faults.apply({ provider: "chesscom", mode: "timeout", ttlSec: 60 });
    const pending = w.lookup.lookup({ v: 1, username: "knightowl_88", what: "profile+stats" });
    await w.clock.advance(5_001); // the web timeouts (5 s): the answer fits the web's 6 s budget
    assert.deepEqual(await pending, { status: 502, body: { error: "upstream", kind: "timeout" } });
    w.faults.apply({ provider: "chesscom", mode: "off", ttlSec: 1 });
    const ok = await w.lookup.lookup({ v: 1, username: "knightowl_88", what: "profile+stats" });
    assert.ok(ok.status === 200 && ok.body.kind === "found");
    assert.ok(w.metrics.imports.count("import.upstream_ms") === 0, "the stopwatch is boot's wrapper, not the lookup's");
  });
});

// ── the routes on the worker's HTTP surface ─────────────────────────────────────────────────────────────────────
const key = () => randomBytes(32).toString("base64");
const ring = parseKeyRing(`wk:${key()},webwk:${key()},ws:${key()},opswk:${key()}`);
const accept = restrictKeyRing(ring, WORKER_ACCEPTED_KIDS);

describe("worker routes: lookup and dev fault", () => {
  let base = "";
  let bare = "";
  const w = world("7");
  w.upstream.addChessComFixture();
  const table = new FaultTable(() => Date.now());
  const common = {
    acceptKeys: accept,
    nowMs: () => Date.now(),
    log: silentLogger,
    kick: () => ({ draining: false, nextRunAt: null }),
    metrics: () => w.metrics.snapshot(Date.now(), { draining: false, nextRunAtMs: null, lastDrainAtMs: null }),
    ready: () => ({ ready: true, engine: "fake" as const, evalCache: "off" as const, draining: false }),
  };
  const server = createHttpServer({
    ...common,
    lookup: (b) => w.lookup.lookup(b),
    devFault: devFaultRoute(table, silentLogger),
  });
  // A production-like worker: no fault table (IMPORT_FAULTS_ALLOWED off).
  const plain = createHttpServer({ ...common, lookup: (b) => w.lookup.lookup(b) });

  before(async () => {
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    await new Promise<void>((r) => plain.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    bare = `http://127.0.0.1:${(plain.address() as AddressInfo).port}`;
  });
  after(() => {
    server.close();
    plain.close();
  });

  const signed = (kid: string, method: string, path: string, body = "") => ({
    ...signInternal({ keys: ring, kid, method, path, body, nowMs: Date.now() }),
    "content-type": "application/json",
  });
  const lookupBody = () => JSON.stringify({ v: 1, username: "knightowl_88", what: "profile+stats" });

  it("lookup: signed by the web (webwk) or ops (opswk) → 200 InternalLookupData", async () => {
    for (const kid of ["webwk", "opswk"]) {
      const body = lookupBody();
      const res = await fetch(`${base}${WORKER_PROVIDER_LOOKUP_PATH}`, {
        method: "POST",
        headers: signed(kid, "POST", WORKER_PROVIDER_LOOKUP_PATH, body),
        body,
      });
      assert.equal(res.status, 200, kid);
      const data = InternalLookupData.parse(await res.json());
      assert.equal(data.kind, "found");
    }
  });

  it("lookup: unsigned 401, the socket's kid 403, oversized 413, a bad body 400, GET 405", async () => {
    const body = lookupBody();
    assert.equal((await fetch(`${base}${WORKER_PROVIDER_LOOKUP_PATH}`, { method: "POST", body })).status, 401);
    const ws = await fetch(`${base}${WORKER_PROVIDER_LOOKUP_PATH}`, {
      method: "POST",
      headers: signed("ws", "POST", WORKER_PROVIDER_LOOKUP_PATH, body),
      body,
    });
    assert.equal(ws.status, 403);
    const big = JSON.stringify({ v: 1, username: "knightowl_88", what: "profile+stats", pad: "x".repeat(PROVIDER_BODY_MAX_BYTES) });
    const tooBig = await fetch(`${base}${WORKER_PROVIDER_LOOKUP_PATH}`, {
      method: "POST",
      headers: signed("webwk", "POST", WORKER_PROVIDER_LOOKUP_PATH, big),
      body: big,
    });
    assert.equal(tooBig.status, 413);
    for (const bad of ['{"v":1,"username":"a b","what":"profile+stats"}', '{"v":1,"username":"knightowl_88","what":"profile+stats","x":1}', "nope"]) {
      const res = await fetch(`${base}${WORKER_PROVIDER_LOOKUP_PATH}`, {
        method: "POST",
        headers: signed("webwk", "POST", WORKER_PROVIDER_LOOKUP_PATH, bad),
        body: bad,
      });
      assert.equal(res.status, 400, bad);
    }
    assert.equal((await fetch(`${base}${WORKER_PROVIDER_LOOKUP_PATH}`, { headers: signed("webwk", "GET", WORKER_PROVIDER_LOOKUP_PATH) })).status, 405);
  });

  it("dev fault: webwk only; POST changes the table, GET reads it", async () => {
    const body = JSON.stringify({ v: 1, provider: "lichess", mode: "429", ttlSec: 120 });
    const res = await fetch(`${base}${WORKER_DEV_FAULT_PATH}`, { method: "POST", headers: signed("webwk", "POST", WORKER_DEV_FAULT_PATH, body), body });
    assert.equal(res.status, 200);
    const data = DevFaultData.parse(await res.json());
    assert.deepEqual(data.faults.map((f) => [f.provider, f.mode]), [["lichess", "429"]]);
    assert.equal(table.active("lichess"), "429");
    const read = await fetch(`${base}${WORKER_DEV_FAULT_PATH}`, { headers: signed("webwk", "GET", WORKER_DEV_FAULT_PATH) });
    assert.deepEqual(DevFaultData.parse(await read.json()), data);
    // ops may call the lookup, never the fault table.
    const ops = await fetch(`${base}${WORKER_DEV_FAULT_PATH}`, { method: "POST", headers: signed("opswk", "POST", WORKER_DEV_FAULT_PATH, body), body });
    assert.equal(ops.status, 403);
    for (const bad of ['{"v":1,"provider":"lichess","mode":"429","ttlSec":601}', '{"v":1,"provider":"x","mode":"429","ttlSec":1}']) {
      const r = await fetch(`${base}${WORKER_DEV_FAULT_PATH}`, { method: "POST", headers: signed("webwk", "POST", WORKER_DEV_FAULT_PATH, bad), body: bad });
      assert.equal(r.status, 400, bad);
    }
    const off = JSON.stringify({ v: 1, provider: "lichess", mode: "off", ttlSec: 1 });
    await fetch(`${base}${WORKER_DEV_FAULT_PATH}`, { method: "POST", headers: signed("webwk", "POST", WORKER_DEV_FAULT_PATH, off), body: off });
    assert.equal(table.active("lichess"), null);
  });

  it("dev fault: a worker without IMPORT_FAULTS_ALLOWED answers 404, even signed, like an unknown path", async () => {
    const body = JSON.stringify({ v: 1, provider: "chesscom", mode: "5xx", ttlSec: 60 });
    const res = await fetch(`${bare}${WORKER_DEV_FAULT_PATH}`, { method: "POST", headers: signed("webwk", "POST", WORKER_DEV_FAULT_PATH, body), body });
    assert.equal(res.status, 404);
    assert.equal((await fetch(`${bare}${WORKER_DEV_FAULT_PATH}`)).status, 404);
  });

  it("metrics carries the import series next to the P3 contract", async () => {
    const res = await fetch(`${base}/internal/metrics`, { headers: signed("webwk", "GET", "/internal/metrics") });
    assert.equal(res.status, 200);
    const json = (await res.json()) as { v: number; imports: { v: number; series: { name: string }[] } };
    assert.equal(json.v, 1);
    assert.equal(json.imports.v, 1);
    assert.ok(json.imports.series.some((s) => s.name === "import.lookup_source"));
  });
});
