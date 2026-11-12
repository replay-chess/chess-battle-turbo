// kickWorker (phase-03 plan §7.3, §8.17): the kick is HMAC-signed with kid `webwk` over the exact bytes sent, so the
// worker's verifyInternal + WORKER_POLICY accept it; a bad body, a missing ANALYSIS_WORKER_URL, an HTTP error or a
// network failure is reported and never thrown.
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { parseKeyRing, verifyInternal, workerKidMayCall } from "@repo/contracts/internal/auth";
import { KICK_PATH, KickBodyV1 } from "@repo/contracts/internal/kick";
import { installTestDeps } from "../../../test/helpers/route-harness";
import { kickWorker, setKickTransport, workerOrigin } from "./kick";

const KEY = Buffer.alloc(32, 9).toString("base64");
const WEB_KEY = Buffer.alloc(32, 4).toString("base64");
/** The web's ring: `web` signs its socket calls, `webwk` its worker calls. */
const ENV = { ANALYSIS_WORKER_URL: "https://ws-dev.example.test/", INTERNAL_API_SECRET: `web:${WEB_KEY},webwk:${KEY}` };
const NOW_MS = Date.parse("2026-11-11T12:00:00Z");

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0).reverse()) c();
});

function capture(status = 202) {
  const sent: { url: string; init: RequestInit }[] = [];
  cleanups.push(
    setKickTransport(async (url, init) => {
      sent.push({ url, init });
      return new Response(JSON.stringify({ draining: true, nextRunAt: null }), { status });
    }),
  );
  return sent;
}

function deps() {
  const t = installTestDeps();
  cleanups.push(t.restore);
  return t.recorded;
}

describe("kickWorker", () => {
  // regression: worker-holds-web-key (FIX-1): the kick was signed with the web's socket key `web`, so the worker had
  // to hold that key, which the socket accepts for every event.
  it("signs the exact body with kid webwk, never the web's socket key; the worker's verifier and policy accept it", async () => {
    deps();
    const sent = capture();
    const out = await kickWorker({ v: 1, reason: "opened", watch: "cabcdefghijklmnopqrstuvwx", runAt: "2026-11-11T12:00:00.000Z" }, { env: ENV, nowMs: NOW_MS });
    assert.deepEqual(out, { ok: true, status: 202 });
    assert.equal(sent.length, 1);
    const { url, init } = sent[0]!;
    assert.equal(url, `https://ws-dev.example.test${KICK_PATH}`);
    assert.equal(init.method, "POST");
    const body = String(init.body);
    assert.deepEqual(KickBodyV1.parse(JSON.parse(body)).watch, "cabcdefghijklmnopqrstuvwx");
    const headers = new Headers(init.headers);
    const verified = verifyInternal({
      headers,
      method: "POST",
      path: KICK_PATH,
      body,
      keys: parseKeyRing(`webwk:${KEY}`),
      nowMs: NOW_MS,
    });
    assert.deepEqual(verified, { ok: true, kid: "webwk" });
    assert.equal(headers.get("x-rc-kid"), "webwk");
    assert.equal(workerKidMayCall("webwk", KICK_PATH), true);
    assert.equal(workerKidMayCall("web", KICK_PATH), false);
    assert.ok(init.signal, "the kick has a timeout");
  });

  it("a body changed after signing does not verify", async () => {
    deps();
    const sent = capture();
    await kickWorker({ v: 1, reason: "stale_queue" }, { env: ENV, nowMs: NOW_MS });
    const headers = new Headers(sent[0]!.init.headers);
    const forged = verifyInternal({
      headers,
      method: "POST",
      path: KICK_PATH,
      body: JSON.stringify({ v: 1, reason: "test" }),
      keys: parseKeyRing(`webwk:${KEY}`),
      nowMs: NOW_MS,
    });
    assert.deepEqual(forged, { ok: false, reason: "bad_sig" });
  });

  it("a ring without the webwk key → not configured, nothing sent, never a throw", async () => {
    const recorded = deps();
    const sent = capture();
    const out = await kickWorker(
      { v: 1, reason: "opened" },
      { env: { ...ENV, INTERNAL_API_SECRET: `web:${WEB_KEY}` }, nowMs: NOW_MS },
    );
    assert.equal(out.ok, false);
    assert.equal(sent.length, 0);
    assert.ok(recorded.logs.some((l) => l.message === "analysis.kick_skipped"));
  });

  it("no ANALYSIS_WORKER_URL → not_configured, nothing sent, a log line", async () => {
    const recorded = deps();
    const sent = capture();
    const out = await kickWorker({ v: 1, reason: "opened" }, { env: { INTERNAL_API_SECRET: ENV.INTERNAL_API_SECRET } });
    assert.deepEqual(out, { ok: false, reason: "not_configured" });
    assert.equal(sent.length, 0);
    assert.ok(recorded.logs.some((l) => l.message === "analysis.kick_skipped"));
    assert.equal(workerOrigin({ ANALYSIS_WORKER_URL: "  http://localhost:3003// " }), "http://localhost:3003");
  });

  it("an invalid body, an HTTP error or a network failure → a Sentry warning analysis.kick_failed, never a throw", async () => {
    const recorded = deps();
    capture(503);
    assert.deepEqual(await kickWorker({ v: 1, reason: "opened" }, { env: ENV }), { ok: false, reason: "http_error", status: 503 });
    assert.equal((await kickWorker({ v: 1, reason: "nope" } as never, { env: ENV })).ok, false);
    cleanups.push(
      setKickTransport(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    assert.deepEqual(await kickWorker({ v: 1, reason: "opened" }, { env: ENV }), { ok: false, reason: "network" });
    const warnings = recorded.messages.filter((m) => m.message === "analysis.kick_failed");
    assert.equal(warnings.length, 3);
  });
});
