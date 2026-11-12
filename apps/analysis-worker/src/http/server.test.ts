// The worker's HTTP surface (phase-03 plan §7.5, §11.1, §11.2 rule 4; C7's "bad signature → 401 from Node, signed →
// 202" at the Node level): HMAC only, per-path caller allow-list, the 1 KB kick body, the strict body, the replay
// guard, health/ready/metrics, 404/405.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { parseKeyRing, restrictKeyRing, signInternal, WORKER_ACCEPTED_KIDS } from "@repo/contracts/internal/auth";
import { KICK_BODY_MAX_BYTES, type KickBodyV1, type WorkerReadyResponse } from "@repo/contracts/internal/kick";
import { silentLogger } from "../obs/log";
import { Metrics } from "../obs/metrics";
import { createHttpServer } from "./server";

const key = () => randomBytes(32).toString("base64");
const ring = parseKeyRing(`wk:${key()},webwk:${key()},ws:${key()},opswk:${key()}`);
const accept = restrictKeyRing(ring, WORKER_ACCEPTED_KIDS);
/** A web key the worker does not hold, and a kid it does not know. */
const wrongWebKey = parseKeyRing(`webwk:${key()}`);
const strangerKid = parseKeyRing(`p13:${key()}`);

describe("worker HTTP server", () => {
  let base = "";
  let ready: WorkerReadyResponse = { ready: true, engine: "ready", evalCache: "open", draining: false };
  const kicks: KickBodyV1[] = [];
  const authFails: string[] = [];
  const metrics = new Metrics({ workerId: "w-00000001", bootId: "00000001", version: "0.1.0", profile: "sf18-v1" }, Date.now());
  const server = createHttpServer({
    acceptKeys: accept,
    nowMs: () => Date.now(),
    log: silentLogger,
    kick: (body) => {
      kicks.push(body);
      return { draining: true, nextRunAt: null };
    },
    metrics: () => metrics.snapshot(Date.now(), { draining: false, nextRunAtMs: null, lastDrainAtMs: null }),
    ready: () => ready,
    onAuthFail: (r) => authFails.push(r),
  });

  before(async () => {
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => {
    server.close();
  });

  const signed = (kid: string, method: string, path: string, body = "", keys = ring) => ({
    ...signInternal({ keys, kid, method, path, body, nowMs: Date.now() }),
    "content-type": "application/json",
  });
  const post = (headers: Record<string, string>, body: string, path = "/internal/analysis/kick") =>
    fetch(`${base}${path}`, { method: "POST", headers, body });
  const kickBody = JSON.stringify({ v: 1, reason: "live_end", watch: "cgamereference0000000001" });
  /** A distinct body per request, so two requests signed in the same second never share a signature. */
  let nonce = 0;
  const freshBody = () => JSON.stringify({ v: 1, reason: "opened", runAt: new Date(Date.UTC(2027, 0, 1) + ++nonce * 1000).toISOString() });

  it("accepts a signed kick from the web (webwk), the socket (ws) and ops (opswk) (202 + the scheduler's answer)", async () => {
    for (const kid of ["webwk", "ws", "opswk"]) {
      const res = await post(signed(kid, "POST", "/internal/analysis/kick", kickBody), kickBody);
      assert.equal(res.status, 202, kid);
      assert.deepEqual(await res.json(), { draining: true, nextRunAt: null });
      assert.equal(res.headers.get("cache-control"), "no-store");
    }
    assert.equal(kicks.length, 3);
    assert.equal(kicks[0]?.watch, "cgamereference0000000001");
  });

  it("refuses an unsigned kick, a bad signature, an unknown key and a body changed after signing (401)", async () => {
    const n = kicks.length;
    assert.equal((await post({ "content-type": "application/json" }, kickBody)).status, 401);
    const forged = signed("webwk", "POST", "/internal/analysis/kick", kickBody);
    forged["x-rc-sig"] = forged["x-rc-sig"].replace(/^./, (c) => (c === "A" ? "B" : "A"));
    assert.equal((await post(forged, kickBody)).status, 401);
    const b1 = freshBody();
    assert.equal((await post(signed("webwk", "POST", "/internal/analysis/kick", b1, wrongWebKey), b1)).status, 401);
    const b2 = freshBody();
    assert.equal((await post(signed("p13", "POST", "/internal/analysis/kick", b2, strangerKid), b2)).status, 401);
    const b3 = freshBody();
    const tampered = b3.replace("opened", "regrade");
    assert.equal((await post(signed("webwk", "POST", "/internal/analysis/kick", b3), tampered)).status, 401);
    assert.equal(kicks.length, n, "nothing reached the scheduler");
    assert.ok(authFails.includes("missing") && authFails.includes("bad_sig") && authFails.includes("unknown_kid"));
  });

  it("refuses a replayed signature and a stale timestamp", async () => {
    const body = freshBody();
    const headers = signed("webwk", "POST", "/internal/analysis/kick", body);
    assert.equal((await post(headers, body)).status, 202);
    assert.equal((await post(headers, body)).status, 401, "replay");
    const old = freshBody();
    const stale = { ...signInternal({ keys: ring, kid: "webwk", method: "POST", path: "/internal/analysis/kick", body: old, nowMs: Date.now() - 61_000 }), "content-type": "application/json" };
    assert.equal((await post(stale, old)).status, 401);
    assert.ok(authFails.includes("replay") && authFails.includes("stale"));
  });

  it("refuses the socket's kid on metrics (403) and never accepts the worker's own kid (not in its accept ring)", async () => {
    const res = await fetch(`${base}/internal/metrics`, { headers: signed("ws", "GET", "/internal/metrics") });
    assert.equal(res.status, 403);
    const body = freshBody();
    assert.equal((await post(signed("wk", "POST", "/internal/analysis/kick", body), body)).status, 401);
  });

  // regression: worker-holds-web-key (FIX-1): the web's socket key `web` and ops' `ops` are not worker callers.
  it("refuses the web's and ops' socket kids (the worker holds no key for them)", async () => {
    const socketKeys = parseKeyRing(`web:${key()},ops:${key()}`);
    for (const kid of ["web", "ops"]) {
      const body = freshBody();
      assert.equal((await post(signed(kid, "POST", "/internal/analysis/kick", body, socketKeys), body)).status, 401, kid);
    }
  });

  it("refuses a kick body over 1 KB (413) before checking anything else", async () => {
    const big = JSON.stringify({ v: 1, reason: "test", pad: "x".repeat(KICK_BODY_MAX_BYTES) });
    assert.equal((await post(signed("webwk", "POST", "/internal/analysis/kick", big), big)).status, 413);
  });

  it("refuses invalid JSON and a body the strict schema rejects (400)", async () => {
    for (const body of ["{", JSON.stringify({ v: 1, reason: "live_end", rooms: ["x"] }), JSON.stringify({ v: 2, reason: "live_end" }), JSON.stringify({ v: 1, reason: "live_end", fault: "rm -rf" })]) {
      assert.equal((await post(signed("webwk", "POST", "/internal/analysis/kick", body), body)).status, 400, body);
    }
  });

  it("serves metrics to webwk and opswk (signed), from memory", async () => {
    for (const kid of ["webwk", "opswk"]) {
      const res = await fetch(`${base}/internal/metrics`, { headers: signed(kid, "GET", "/internal/metrics") });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { v: number; profile: string; workerId: string };
      assert.equal(body.v, 1);
      assert.equal(body.profile, "sf18-v1");
      assert.equal(body.workerId, "w-00000001");
    }
    assert.equal((await fetch(`${base}/internal/metrics`)).status, 401);
  });

  it("health is always 200; ready is 200 or 503 with the same body", async () => {
    assert.deepEqual(await (await fetch(`${base}/health`)).json(), { ok: true });
    assert.equal((await fetch(`${base}/ready`)).status, 200);
    ready = { ready: false, engine: "starting", evalCache: "seeding", draining: false };
    const res = await fetch(`${base}/ready`);
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), ready);
  });

  it("answers 404 for every other path (including the reserved /engine/analyse) and 405 for a wrong method", async () => {
    assert.equal((await fetch(`${base}/engine/analyse`, { method: "POST", body: "{}" })).status, 404);
    assert.equal((await fetch(`${base}/internal/emit`, { method: "POST", body: "{}" })).status, 404);
    assert.equal((await fetch(`${base}/internal/analysis/kick`)).status, 405);
    assert.equal((await fetch(`${base}/health`, { method: "POST" })).status, 405);
  });
});
