import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_TRACE_RATE, sampleRateForPath, samplingPath, tracesSampler } from "./traces-sampler";

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
