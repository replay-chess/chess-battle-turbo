// lib/internal/fetch.ts (phase-02 plan §7.5.1): every /internal/* call is HMAC-signed over the exact bytes sent, a
// receiver's verifyInternal() accepts it, and the static x-internal-token is never sent.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { ReplayGuard, parseKeyRing, verifyInternal } from "@repo/contracts/internal/auth";
import { InternalFetchConfigError, internalFetch, socketHttpOrigin, withEmitDedupeKey } from "./fetch";

const WEB = randomBytes(32).toString("base64");
const NOW = Date.parse("2026-11-06T12:00:00.000Z");

function capture() {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(null, { status: 202 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe("internalFetch", () => {
  it("signs method, path + query and the body; the receiver verifies it once (replay refused)", async () => {
    const { calls, fetchImpl } = capture();
    const env = { INTERNAL_API_SECRET: `web:${WEB}`, NEXT_PUBLIC_WEBSOCKET_URL: "wss://ws-dev.example.test/" };
    const res = await internalFetch("/internal/tournament-event?x=1", { body: { event: "player_joined", tournamentReferenceId: "t" }, env, nowMs: NOW, fetchImpl });
    assert.equal(res.status, 202);
    const { url, init } = calls[0]!;
    assert.equal(url, "https://ws-dev.example.test/internal/tournament-event?x=1");
    assert.equal(init.method, "POST");
    const headers = init.headers as Record<string, string>;
    assert.equal(headers["x-rc-kid"], "web");
    assert.equal(headers["x-internal-token"], undefined);
    assert.equal(headers["content-type"], "application/json");
    const keys = parseKeyRing(`web:${WEB},ops:${randomBytes(32).toString("base64")}`);
    const replay = new ReplayGuard();
    const verify = () =>
      verifyInternal({ headers, method: "POST", path: "/internal/tournament-event?x=1", body: init.body as string, keys, nowMs: NOW + 5_000, replay });
    assert.deepEqual(verify(), { ok: true, kid: "web" });
    assert.deepEqual(verify(), { ok: false, reason: "replay" });
    assert.deepEqual(
      verifyInternal({ headers, method: "POST", path: "/internal/tournament-event?x=1", body: `${init.body as string} `, keys, nowMs: NOW }),
      { ok: false, reason: "bad_sig" },
    );
  });

  it("regression: emit-same-second-replay — two identical emits in one second are two signatures; a caller's key stays", async () => {
    const { calls, fetchImpl } = capture();
    const env = { INTERNAL_API_SECRET: `web:${WEB}`, NEXT_PUBLIC_WEBSOCKET_URL: "ws://localhost:3002" };
    const body = { v: 1, targets: [{ userRef: "cuser" }], event: "entitlement:changed", data: { v: 1 } };
    await internalFetch("/internal/emit", { body, env, nowMs: NOW, fetchImpl });
    await internalFetch("/internal/emit", { body, env, nowMs: NOW, fetchImpl });
    const sent = calls.map((c) => JSON.parse(c.init.body as string) as { dedupeKey?: string });
    assert.ok(sent.every((b) => b.dedupeKey?.startsWith("entitlement:changed:")));
    assert.notEqual(sent[0]!.dedupeKey, sent[1]!.dedupeKey);
    const sigs = calls.map((c) => (c.init.headers as Record<string, string>)["x-rc-sig"] ?? JSON.stringify(c.init.headers));
    assert.notEqual(sigs[0], sigs[1]);
    assert.deepEqual(withEmitDedupeKey({ event: "x", dedupeKey: "mine" }), { event: "x", dedupeKey: "mine" });
    assert.equal(Object.hasOwn(body, "dedupeKey"), false, "the caller's object is not changed");
  });

  it("a bare legacy secret signs as kid web; GET without a body", async () => {
    const { calls, fetchImpl } = capture();
    await internalFetch("/internal/metrics", { env: { INTERNAL_API_SECRET: "legacy-shared-secret" }, nowMs: NOW, fetchImpl });
    const { url, init } = calls[0]!;
    assert.equal(url, "http://localhost:3002/internal/metrics");
    assert.equal(init.method, "GET");
    assert.equal(init.body, undefined);
    assert.equal((init.headers as Record<string, string>)["x-rc-kid"], "web");
    assert.ok(verifyInternal({ headers: init.headers as Record<string, string>, method: "GET", path: "/internal/metrics", body: "", keys: parseKeyRing("legacy-shared-secret"), nowMs: NOW }).ok);
  });

  it("refuses non-internal paths and a missing or malformed key set (without echoing it)", async () => {
    await assert.rejects(internalFetch("/api/x", { env: { INTERNAL_API_SECRET: "s" } }), /not an \/internal/);
    await assert.rejects(internalFetch("/internal/emit", { env: {} }), InternalFetchConfigError);
    await assert.rejects(internalFetch("/internal/emit", { env: { INTERNAL_API_SECRET: "web:QUJDREVG" } }), (e: unknown) => e instanceof InternalFetchConfigError && !String(e.message).includes("QUJDREVG"));
  });

  it("socket origin: ws → http, wss → https, no trailing slash, localhost:3002 by default", () => {
    assert.equal(socketHttpOrigin({ NEXT_PUBLIC_WEBSOCKET_URL: "ws://localhost:3002" }), "http://localhost:3002");
    assert.equal(socketHttpOrigin({ NEXT_PUBLIC_WEBSOCKET_URL: "wss://ws-dev.example.test/" }), "https://ws-dev.example.test");
    assert.equal(socketHttpOrigin({}), "http://localhost:3002");
  });
});
