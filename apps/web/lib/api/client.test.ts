import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { onlineManager } from "@tanstack/react-query";
import { z } from "zod";
import { api, buildUrl } from "./client";
import { ApiError, resetApiErrorDeps, setApiErrorDeps } from "./errors";
import { devSchema } from "./schema";

type Call = { url: string; init: RequestInit };
let calls: Call[];
let respond: (call: Call) => Response | Promise<Response>;
const realFetch = globalThis.fetch;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const header = (c: Call, name: string) => new Headers(c.init.headers).get(name);

async function rejects(p: Promise<unknown>, code: string): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof ApiError, `ApiError, got ${String(e)}`);
    assert.equal(e.code, code);
    return e;
  }
  assert.fail(`expected ${code}`);
}

beforeEach(() => {
  calls = [];
  respond = () => json({ data: { ok: true } });
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const call = { url: String(input), init };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  onlineManager.setOnline(true);
  resetApiErrorDeps();
});

describe("requests", () => {
  test("GET with Accept, x-rc-build and same-origin credentials; no Content-Type without a body", async () => {
    const res = await api("/api/me");
    assert.deepEqual(res, { data: { ok: true }, meta: undefined });
    const c = calls[0]!;
    assert.equal(c.url, "/api/me");
    assert.equal(c.init.method, "GET");
    assert.equal(c.init.credentials, "same-origin");
    assert.equal(header(c, "accept"), "application/json");
    assert.ok(header(c, "x-rc-build"));
    assert.equal(header(c, "content-type"), null);
    assert.equal(header(c, "x-client-build"), null);
  });

  test("query params skip null/undefined; body is JSON; Idempotency-Key and keepalive pass through", async () => {
    await api("/api/x", {
      method: "POST",
      query: { a: "1", b: undefined, c: null, d: false, e: 0 },
      body: { hello: "world" },
      idempotencyKey: "k-1",
      keepalive: true,
    });
    const c = calls[0]!;
    assert.equal(c.url, "/api/x?a=1&d=false&e=0");
    assert.equal(c.init.body, JSON.stringify({ hello: "world" }));
    assert.equal(header(c, "content-type"), "application/json");
    assert.equal(header(c, "idempotency-key"), "k-1");
    assert.equal(c.init.keepalive, true);
  });

  test("buildUrl appends to an existing query string", () => {
    assert.equal(buildUrl("/api/x?y=1", { z: 2 }), "/api/x?y=1&z=2");
    assert.equal(buildUrl("/api/x", undefined), "/api/x");
  });

  test("fault adds x-rc-fault and a fresh __rcfault per call", async () => {
    await api("/api/openings", { fault: 500 });
    await api("/api/openings", { fault: 500 });
    const [a, b] = calls;
    assert.equal(header(a!, "x-rc-fault"), "500");
    const ta = new URL(a!.url, "http://x").searchParams.get("__rcfault");
    const tb = new URL(b!.url, "http://x").searchParams.get("__rcfault");
    assert.ok(ta && tb && ta !== tb, `${ta} vs ${tb}`);
  });

  test("fault is ignored when NEXT_PUBLIC_APP_ENV=production", async () => {
    const prev = process.env.NEXT_PUBLIC_APP_ENV;
    process.env.NEXT_PUBLIC_APP_ENV = "production";
    try {
      await api("/api/openings", { fault: 500 });
    } finally {
      if (prev === undefined) delete process.env.NEXT_PUBLIC_APP_ENV;
      else process.env.NEXT_PUBLIC_APP_ENV = prev;
    }
    assert.equal(header(calls[0]!, "x-rc-fault"), null);
    assert.equal(calls[0]!.url, "/api/openings");
  });
});

describe("responses", () => {
  test("envelope meta is returned", async () => {
    respond = () => json({ data: [1], meta: { nextCursor: "abc" } });
    assert.deepEqual(await api("/api/list"), { data: [1], meta: { nextCursor: "abc" } });
  });

  test("legacy { success, data } and raw objects unwrap", async () => {
    respond = () => json({ success: true, data: { openings: [] } });
    assert.deepEqual((await api("/api/openings")).data, { openings: [] });
    respond = () => json({ entitled: true, paywall: true });
    assert.deepEqual((await api("/api/subscription")).data, { entitled: true, paywall: true });
  });

  test("legacy { success: false } with a 200 throws", async () => {
    respond = () => json({ success: false, error: "nope" });
    const e = await rejects(api("/api/x"), "internal");
    assert.equal(e.message, "nope");
  });

  test("204 resolves with undefined data", async () => {
    respond = () => new Response(null, { status: 204 });
    assert.deepEqual(await api("/api/session/clear", { method: "POST" }), { data: undefined });
  });

  test("error envelope → ApiError with requestId, Retry-After and path", async () => {
    respond = () =>
      json(
        { error: { code: "rate_limited", message: "Slow down", requestId: "rq-1" } },
        429,
        { "retry-after": "30", "x-request-id": "rq-1" },
      );
    const e = await rejects(api("/api/health", { query: { deep: "1" } }), "rate_limited");
    assert.equal(e.status, 429);
    assert.equal(e.retryAfterSec, 30);
    assert.equal(e.requestId, "rq-1");
    assert.equal(e.path, "/api/health");
  });

  test("an HTML 502 page → upstream_unavailable with the header request id", async () => {
    respond = () => new Response("<html>Bad gateway</html>", { status: 502, headers: { "x-request-id": "gw-1" } });
    const e = await rejects(api("/api/me"), "upstream_unavailable");
    assert.equal(e.requestId, "gw-1");
  });
});

describe("schemas", () => {
  const Schema = z.object({ n: z.number() });

  test("a matching schema parses", async () => {
    respond = () => json({ data: { n: 1 } });
    const { data } = await api("/api/x", { schema: Schema });
    assert.equal(data.n, 1);
  });

  test("a mismatch throws contract_mismatch and is reported once", async () => {
    const reports: unknown[] = [];
    setApiErrorDeps({
      capture: { message: (m, extra) => reports.push({ m, extra }), exception: () => {}, breadcrumb: () => {} },
    });
    respond = () => json({ data: { n: "1" } }, 200, { "x-request-id": "rq-9" });
    const e = await rejects(api("/api/x?y=1", { schema: Schema }), "contract_mismatch");
    assert.equal(e.requestId, "rq-9");
    assert.equal(reports.length, 1);
    assert.equal((reports[0] as { m: string }).m, "contract_mismatch");
    assert.equal((reports[0] as { extra: { route: string } }).extra.route, "/api/x");
  });

  test("devSchema() returns undefined when NODE_ENV=production", () => {
    const env = process.env as Record<string, string | undefined>;
    const prev = env.NODE_ENV;
    env.NODE_ENV = "production";
    try {
      assert.equal(devSchema(Schema), undefined);
    } finally {
      env.NODE_ENV = prev;
    }
    assert.equal(devSchema(Schema), Schema);
  });

  test("no ifNoneMatch option exists (type test)", () => {
    const typeOnly = () =>
      // @ts-expect-error 304s are handled by the browser cache; api() has no ifNoneMatch (CA AP-21)
      api("/api/me", { ifNoneMatch: '"etag"' });
    assert.equal(typeof typeOnly, "function");
  });
});

describe("failures before a response", () => {
  test("a rejected fetch → network", async () => {
    respond = () => {
      throw new TypeError("Failed to fetch");
    };
    await rejects(api("/api/me"), "network");
  });

  test("the timeout → timeout", async () => {
    respond = (c) =>
      new Promise((_, reject) => {
        c.init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    await rejects(api("/api/me", { timeoutMs: 20 }), "timeout");
  });

  test("the caller's abort → aborted", async () => {
    respond = (c) =>
      new Promise((_, reject) => {
        c.init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    const ctrl = new AbortController();
    const p = api("/api/me", { signal: ctrl.signal });
    setTimeout(() => ctrl.abort(), 5);
    await rejects(p, "aborted");
  });

  test("an already-aborted signal → aborted", async () => {
    respond = (c) =>
      c.init.signal?.aborted ? Promise.reject(new DOMException("aborted", "AbortError")) : json({ data: 1 });
    const ctrl = new AbortController();
    ctrl.abort();
    await rejects(api("/api/me", { signal: ctrl.signal }), "aborted");
  });

  test("a mutation while offline → offline, without sending", async () => {
    onlineManager.setOnline(false);
    await rejects(api("/api/billing/refresh", { method: "POST" }), "offline");
    assert.equal(calls.length, 0);
  });

  test("a GET that fails while offline → offline", async () => {
    onlineManager.setOnline(false);
    respond = () => {
      throw new TypeError("Failed to fetch");
    };
    await rejects(api("/api/me"), "offline");
    assert.equal(calls.length, 1);
  });
});
