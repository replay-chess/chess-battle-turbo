import { test } from "node:test";
import assert from "node:assert/strict";
import { ACCOUNTS_TRACE_RATE, DEFAULT_TRACE_RATE, dropNotModifiedPoll, sampleRateForPath, samplingPath, tracesSampler } from "./traces-sampler";
import { sentryScrubOptions } from "./scrub";

test("health checks are never traced", () => {
  assert.equal(sampleRateForPath("/api/health", "dev"), 0);
  assert.equal(sampleRateForPath("/api/healthcheck", "production"), 0);
});

test("billing and webhook routes are always traced", () => {
  for (const path of [
    "/api/webhook/dodo-payments",
    "/api/webhook/clerk",
    "/api/checkout",
    "/api/subscription",
    "/api/subscription/cancel",
    "/api/billing/refresh",
  ]) {
    assert.equal(sampleRateForPath(path, "production"), 1, path);
  }
});

test("/api/me and other API routes sample at the default rate", () => {
  assert.equal(sampleRateForPath("/api/me", "dev"), DEFAULT_TRACE_RATE);
  assert.equal(sampleRateForPath("/api/chess/move", "dev"), DEFAULT_TRACE_RATE);
  // A prefix that only looks like a billing route.
  assert.equal(sampleRateForPath("/api/checkouts", "production"), DEFAULT_TRACE_RATE);
});

test("pages: 1.0 on dev, 0.1 elsewhere", () => {
  assert.equal(sampleRateForPath("/play", "dev"), 1);
  assert.equal(sampleRateForPath("/play", "production"), DEFAULT_TRACE_RATE);
  assert.equal(sampleRateForPath("/play", undefined), DEFAULT_TRACE_RATE);
});

test("unknown path falls back to the default", () => {
  assert.equal(sampleRateForPath(null, "dev"), DEFAULT_TRACE_RATE);
});

test("samplingPath reads the request, attributes or span name", () => {
  assert.equal(samplingPath({ normalizedRequest: { url: "https://x.dev/api/me?x=1" } }), "/api/me");
  assert.equal(samplingPath({ attributes: { "http.target": "/api/health?deep=1" } }), "/api/health");
  assert.equal(samplingPath({ name: "GET /api/checkout" }), "/api/checkout");
  assert.equal(samplingPath({ name: "middleware GET" }), null);
});

test("tracesSampler inherits the parent decision unless the rate is 0", () => {
  const calls: number[] = [];
  const inheritOrSampleWith = (rate: number) => {
    calls.push(rate);
    return 1;
  };
  assert.equal(tracesSampler({ name: "POST /api/chess/move", inheritOrSampleWith }, "production"), 1);
  assert.deepEqual(calls, [DEFAULT_TRACE_RATE]);
  assert.equal(tracesSampler({ name: "GET /api/health", inheritOrSampleWith }, "production"), 0);
  assert.deepEqual(calls, [DEFAULT_TRACE_RATE]);
  assert.equal(tracesSampler({ name: "GET /play" }, "dev"), 1);
});

// regression: p04-trace-rates (FIX-2, review round 2): the P4 rates of phase-04 plan §10.2 were missing, so the Lichess
// callback sampled at 0.1 instead of 1.0, /api/accounts/* at 0.1 instead of 0.2, and import.status 304 polls at 0.1.
test("P4: the Lichess callback at 1.0, other /api/accounts/* at 0.2", () => {
  assert.equal(sampleRateForPath("/api/accounts/lichess/callback", "production"), 1);
  for (const path of ["/api/accounts", "/api/accounts/chesscom/lookup", "/api/accounts/chesscom", "/api/accounts/lichess/start", "/api/accounts/lichess/sync"]) {
    assert.equal(sampleRateForPath(path, "production"), ACCOUNTS_TRACE_RATE, path);
  }
  assert.equal(ACCOUNTS_TRACE_RATE, 0.2);
  assert.equal(sampleRateForPath("/api/accountsx", "production"), DEFAULT_TRACE_RATE, "a prefix that only looks like accounts");
  assert.equal(tracesSampler({ name: "GET /api/accounts/lichess/callback" }, "production"), 1);
});

test("P4: import.status is sampled like any API route, and its 304 polls are dropped after the response", () => {
  assert.equal(sampleRateForPath("/api/import/status", "production"), DEFAULT_TRACE_RATE);
  const tx = (status: number, where: { transaction?: string; url?: string; ctx?: "trace" | "response" }) => ({
    type: "transaction",
    transaction: where.transaction,
    request: where.url ? { url: where.url } : undefined,
    contexts: where.ctx === "response" ? { response: { status_code: status } } : { trace: { data: { "http.response.status_code": status } } },
  });
  assert.equal(dropNotModifiedPoll(tx(304, { transaction: "GET /api/import/status" })), true);
  assert.equal(dropNotModifiedPoll(tx(304, { url: "https://x.dev/api/import/status?since=1", ctx: "response" })), true);
  assert.equal(dropNotModifiedPoll(tx(200, { transaction: "GET /api/import/status" })), false, "a changed status is kept");
  assert.equal(dropNotModifiedPoll(tx(304, { transaction: "GET /api/me" })), false, "only the polled route");
  assert.equal(dropNotModifiedPoll({ type: "transaction", transaction: "GET /api/import/status" }), false, "no status: kept");
  const kept = sentryScrubOptions.beforeSendTransaction(tx(200, { transaction: "GET /api/import/status" }));
  assert.notEqual(kept, null);
  assert.equal(sentryScrubOptions.beforeSendTransaction(tx(304, { transaction: "GET /api/import/status" })), null);
});
