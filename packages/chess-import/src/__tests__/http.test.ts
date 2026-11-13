// The shared HTTP path (phase-04 plan §7.8): User-Agent with the contact, Retry-After parsing, status → error kind,
// conditional GETs, timeouts on the fake clock, network errors, non-JSON bodies and caller aborts.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { ProviderError } from "../errors";
import { errorForStatus, getJson, normaliseBaseUrl, parseRetryAfter, userAgent, type HttpDeps } from "../http";
import { FakeClock } from "../testing/fake-clock";
import { empty, hang, json, recordingFetch } from "./helpers";

const deps = (fetch: HttpDeps["fetch"], clock = new FakeClock()): HttpDeps => ({
  provider: "chesscom",
  fetch,
  clock,
  userAgent: userAgent(),
});

const kindOf = (kind: string) => (e: unknown) => e instanceof ProviderError && e.kind === kind;

describe("userAgent", () => {
  it("names the product and the contact (R-CC-03)", () => {
    assert.equal(userAgent(), "ReplayChess/1.0 (+https://playchess.tech; hello@playchess.tech)");
    assert.equal(userAgent("ops@playchess.tech"), "ReplayChess/1.0 (+https://playchess.tech; ops@playchess.tech)");
    assert.equal(userAgent("  "), userAgent());
    assert.throws(() => userAgent("a\r\nX-Evil: 1"), RangeError);
  });
});

describe("normaliseBaseUrl", () => {
  it("accepts http(s) and drops the trailing slash; refuses others", () => {
    assert.equal(normaliseBaseUrl("https://api.chess.com/", "X"), "https://api.chess.com");
    assert.equal(normaliseBaseUrl("http://127.0.0.1:4010/chesscom", "X"), "http://127.0.0.1:4010/chesscom");
    assert.throws(() => normaliseBaseUrl("ftp://x", "X"), RangeError);
    assert.throws(() => normaliseBaseUrl("not a url", "X"), RangeError);
    assert.throws(() => normaliseBaseUrl("https://x/?a=1", "X"), RangeError);
  });
});

describe("parseRetryAfter", () => {
  it("reads delta-seconds and HTTP dates", () => {
    const now = Date.UTC(2026, 10, 12, 9, 0, 0);
    assert.equal(parseRetryAfter("30", now), 30);
    assert.equal(parseRetryAfter("Thu, 12 Nov 2026 09:02:00 GMT", now), 120);
    assert.equal(parseRetryAfter("Thu, 12 Nov 2026 08:00:00 GMT", now), 0);
    assert.equal(parseRetryAfter(null, now), null);
    assert.equal(parseRetryAfter("soon", now), null);
  });
});

describe("errorForStatus", () => {
  it("maps 404, 410, 429, 5xx and 403", () => {
    assert.equal(errorForStatus("chesscom", 404, null).kind, "not_found");
    assert.equal(errorForStatus("chesscom", 410, null).kind, "closed");
    const r = errorForStatus("lichess", 429, 42);
    assert.equal(r.kind, "rate_limited");
    assert.equal(r.retryAfterSec, 42);
    assert.equal(r.retryable, true);
    assert.equal(errorForStatus("chesscom", 500, null).kind, "upstream");
    assert.equal(errorForStatus("chesscom", 503, 10).retryAfterSec, 10);
    const forbidden = errorForStatus("chesscom", 403, null);
    assert.equal(forbidden.kind, "upstream");
    assert.equal(forbidden.status, 403, "the web lookup's worker fallback reads the status (D4-23)");
    assert.equal(errorForStatus("chesscom", 404, null).retryable, false);
  });
});

describe("getJson", () => {
  it("sends the User-Agent, Accept and the validators; returns body and new validators", async () => {
    const rf = recordingFetch(() => json({ a: 1 }, 200, { etag: 'W/"e2"', "last-modified": "Sunday, 01-Nov-2026" }));
    const r = await getJson(deps(rf.fetch), "https://x/a", {
      timeoutMs: 5_000,
      validators: { etag: 'W/"e1"', lastModified: "Saturday, 31-Oct-2026" },
    });
    assert.deepEqual(r, { status: 200, body: { a: 1 }, etag: 'W/"e2"', lastModified: "Sunday, 01-Nov-2026" });
    assert.equal(rf.calls[0]!.headers["user-agent"], userAgent());
    assert.equal(rf.calls[0]!.headers.accept, "application/json");
    assert.equal(rf.calls[0]!.headers["if-none-match"], 'W/"e1"');
    assert.equal(rf.calls[0]!.headers["if-modified-since"], "Saturday, 31-Oct-2026");
  });

  it("returns 304 as unchanged", async () => {
    const rf = recordingFetch(() => empty(304, { etag: 'W/"e1"' }));
    const r = await getJson(deps(rf.fetch), "https://x/a", { timeoutMs: 5_000, validators: { etag: 'W/"e1"' } });
    assert.deepEqual(r, { status: 304, etag: 'W/"e1"', lastModified: null });
  });

  it("maps 404 / 410 / 429 with Retry-After / 500", async () => {
    for (const [status, kind] of [
      [404, "not_found"],
      [410, "closed"],
      [500, "upstream"],
      [502, "upstream"],
    ] as const) {
      const rf = recordingFetch(() => empty(status));
      await assert.rejects(getJson(deps(rf.fetch), "https://x", { timeoutMs: 5_000 }), kindOf(kind));
    }
    const rf = recordingFetch(() => empty(429, { "retry-after": "17" }));
    await assert.rejects(
      getJson(deps(rf.fetch), "https://x", { timeoutMs: 5_000 }),
      (e: unknown) => e instanceof ProviderError && e.kind === "rate_limited" && e.retryAfterSec === 17,
    );
  });

  it("times out on the injected clock (a provider that never answers)", async () => {
    const clock = new FakeClock();
    const rf = recordingFetch((_, init) => hang(init));
    const p = getJson(deps(rf.fetch, clock), "https://x", { timeoutMs: 5_000 });
    const check = assert.rejects(p, kindOf("timeout"));
    await clock.advance(4_999);
    let settled = false;
    void p.catch(() => (settled = true));
    await clock.advance(0);
    assert.equal(settled, false);
    await clock.advance(1);
    await check;
  });

  it("times out even when the injected fetch ignores its signal", async () => {
    const clock = new FakeClock();
    const p = getJson(deps(() => new Promise<Response>(() => undefined), clock), "https://x", { timeoutMs: 8_000 });
    const check = assert.rejects(p, kindOf("timeout"));
    await clock.advance(8_000);
    await check;
  });

  it("network errors are upstream; a body that is not JSON is bad_response", async () => {
    await assert.rejects(
      getJson(deps(async () => Promise.reject(new TypeError("fetch failed"))), "https://x", { timeoutMs: 5_000 }),
      kindOf("upstream"),
    );
    await assert.rejects(
      getJson(deps(async () => new Response("<html>", { status: 200 })), "https://x", { timeoutMs: 5_000 }),
      kindOf("bad_response"),
    );
  });

  it("a caller abort is `aborted`, not a timeout or an upstream error", async () => {
    const ctl = new AbortController();
    const rf = recordingFetch((_, init) => hang(init));
    const p = getJson(deps(rf.fetch), "https://x", { timeoutMs: 5_000, signal: ctl.signal });
    ctl.abort();
    await assert.rejects(p, kindOf("aborted"));
    const pre = new AbortController();
    pre.abort();
    await assert.rejects(getJson(deps(rf.fetch), "https://x", { timeoutMs: 5_000, signal: pre.signal }), kindOf("aborted"));
  });
});
