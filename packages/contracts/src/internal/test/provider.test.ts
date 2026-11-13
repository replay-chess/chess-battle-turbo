// The worker's P4 endpoints (phase-04 plan §7.1, §7.7.3, §7.7.4; D4-23): the lookup and fault bodies, and who may call
// them (the web as `webwk`; ops as `opswk` for the lookup smoke only; never `web`, `ops`, `ws` or `wk`).
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { parseKeyRing, signInternal, verifyInternal, WORKER_INTERNAL_PATHS, WORKER_POLICY, workerKidMayCall } from "../auth";
import {
  DevFaultBody,
  DevFaultData,
  InternalLookupBody,
  InternalLookupData,
  WORKER_DEV_FAULT_PATH,
  WORKER_PROVIDER_LOOKUP_PATH,
} from "../provider";

describe("provider lookup and dev fault bodies", () => {
  it("InternalLookupBody: v1, a valid handle, the two shapes, a YYYY/MM month", () => {
    assert.equal(InternalLookupBody.safeParse({ v: 1, username: "knightowl_88", what: "profile+stats" }).success, true);
    assert.equal(InternalLookupBody.safeParse({ v: 1, username: "knightowl_88", what: "archives+month", month: "2026/10" }).success, true);
    assert.equal(InternalLookupBody.safeParse({ v: 1, username: "knightowl_88", what: "archives+month", month: "2026/13" }).success, false);
    assert.equal(InternalLookupBody.safeParse({ v: 1, username: "../etc", what: "profile+stats" }).success, false);
    assert.equal(InternalLookupBody.safeParse({ v: 2, username: "knightowl_88", what: "profile+stats" }).success, false);
    assert.equal(InternalLookupBody.safeParse({ v: 1, username: "knightowl_88", what: "profile+stats", x: 1 }).success, false);
  });

  it("InternalLookupData: found (raw bodies), private, not_found, rate_limited with a retry", () => {
    assert.equal(InternalLookupData.safeParse({ kind: "found", profile: { username: "x" }, stats: {} }).success, true);
    assert.equal(InternalLookupData.safeParse({ kind: "found", profile: {}, archives: ["https://api.chess.com/pub/player/x/games/2026/10"] }).success, true);
    assert.equal(InternalLookupData.safeParse({ kind: "private" }).success, true);
    assert.equal(InternalLookupData.safeParse({ kind: "not_found" }).success, true);
    assert.equal(InternalLookupData.safeParse({ kind: "rate_limited", retryAfterSec: 30 }).success, true);
    assert.equal(InternalLookupData.safeParse({ kind: "rate_limited" }).success, false);
    assert.equal(InternalLookupData.safeParse({ kind: "error" }).success, false);
  });

  it("DevFaultBody: provider × mode, ttl ≤ 600 s", () => {
    assert.equal(DevFaultBody.safeParse({ v: 1, provider: "chesscom", mode: "5xx", ttlSec: 300 }).success, true);
    assert.equal(DevFaultBody.safeParse({ v: 1, provider: "lichess", mode: "off", ttlSec: 1 }).success, true);
    assert.equal(DevFaultBody.safeParse({ v: 1, provider: "chesscom", mode: "5xx", ttlSec: 601 }).success, false);
    assert.equal(DevFaultBody.safeParse({ v: 1, provider: "dodo", mode: "5xx", ttlSec: 60 }).success, false);
    assert.equal(DevFaultData.safeParse({ faults: [{ provider: "chesscom", mode: "429", until: "2026-11-10T09:35:00.000Z" }] }).success, true);
    assert.equal(DevFaultData.safeParse({ faults: [{ provider: "chesscom", mode: "off", until: "2026-11-10T09:35:00.000Z" }] }).success, false);
  });
});

describe("worker allow-list for the P4 paths", () => {
  it("lookup: webwk and opswk; fault: webwk only; nobody else", () => {
    assert.ok((WORKER_INTERNAL_PATHS as readonly string[]).includes(WORKER_PROVIDER_LOOKUP_PATH));
    assert.ok((WORKER_INTERNAL_PATHS as readonly string[]).includes(WORKER_DEV_FAULT_PATH));
    assert.equal(workerKidMayCall("webwk", WORKER_PROVIDER_LOOKUP_PATH), true);
    assert.equal(workerKidMayCall("opswk", WORKER_PROVIDER_LOOKUP_PATH), true);
    assert.equal(workerKidMayCall("webwk", WORKER_DEV_FAULT_PATH), true);
    assert.equal(workerKidMayCall("opswk", WORKER_DEV_FAULT_PATH), false);
    for (const kid of ["web", "ops", "ws", "wk", "evil"]) {
      assert.equal(workerKidMayCall(kid, WORKER_PROVIDER_LOOKUP_PATH), false, kid);
      assert.equal(workerKidMayCall(kid, WORKER_DEV_FAULT_PATH), false, kid);
    }
    assert.deepEqual([...WORKER_POLICY.ws], ["/internal/analysis/kick"], "the socket still only kicks");
  });

  it("a webwk-signed lookup verifies on the worker ring; a web-signed one does not", () => {
    const webwk = randomBytes(32).toString("base64");
    const wk = randomBytes(32).toString("base64");
    const worker = parseKeyRing(`wk:${wk},webwk:${webwk}`);
    const body = JSON.stringify(InternalLookupBody.parse({ v: 1, username: "knightowl_88", what: "profile+stats" }));
    const nowMs = 1_793_563_200_000;
    const headers = signInternal({ keys: parseKeyRing(`webwk:${webwk}`), method: "POST", path: WORKER_PROVIDER_LOOKUP_PATH, body, nowMs });
    assert.deepEqual(verifyInternal({ headers, method: "POST", path: WORKER_PROVIDER_LOOKUP_PATH, body, keys: worker, nowMs }), { ok: true, kid: "webwk" });
    const asWeb = signInternal({ keys: parseKeyRing(`web:${randomBytes(32).toString("base64")}`), method: "POST", path: WORKER_PROVIDER_LOOKUP_PATH, body, nowMs });
    assert.deepEqual(verifyInternal({ headers: asWeb, method: "POST", path: WORKER_PROVIDER_LOOKUP_PATH, body, keys: worker, nowMs }), {
      ok: false,
      reason: "unknown_kid",
    });
  });
});
