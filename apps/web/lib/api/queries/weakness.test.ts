// The weakness query (phase-06 plan §5.3, §12.1 "WEB/lib/api/queries/weakness.test.ts"): the key and freshness, the
// socket-down fallback poll (re-created options on every render still stop after 15 min: AP-20; a new building episode
// starts a new schedule), the fetchers through api() against a stubbed fetch, and the dev-only schema check that keeps
// zod out of production chunks (the call-site `NODE_ENV === "production" ? undefined : Schema` rule, AP-12).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { weaknessPayloadFixture } from "@/components/train/weakness/__fixtures__/payloads";
import { qk } from "../keys";
import {
  WEAKNESS_FALLBACK,
  WEAKNESS_GC_MS,
  WEAKNESS_STALE_MS,
  fetchWeakness,
  isWeaknessLive,
  postWeaknessRecompute,
  postWeaknessSeen,
  weaknessPollInterval,
  weaknessQuery,
  weaknessStaleTime,
} from "./weakness";

type Call = { url: string; init: RequestInit | undefined };
let calls: Call[] = [];
let replies: { status: number; body: unknown }[] = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  calls = [];
  replies = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = replies.shift() ?? { status: 200, body: null };
    if (r.status === 204) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** A TanStack-like Query as `refetchInterval` sees it: one object per query hash, its state replaced as fetches land. */
function fakeQuery(data: ReturnType<typeof weaknessPayloadFixture>, at: number) {
  return { state: { data, dataUpdatedAt: at, errorUpdatedAt: 0 } };
}

describe("weakness query options", () => {
  it("use qk.train.weakness() with the plan's freshness", () => {
    const q = weaknessQuery();
    assert.deepEqual(q.queryKey, ["train", "weakness"]);
    assert.deepEqual(q.queryKey, qk.train.weakness());
    assert.equal(q.refetchOnWindowFocus, true);
    assert.equal(q.refetchIntervalInBackground, false);
    assert.equal(q.gcTime, WEAKNESS_GC_MS);
  });

  it("is fresh for 10 min when settled and stale at once while building or updating", () => {
    for (const s of ["ready", "insufficient_zero", "failed"] as const) {
      const d = weaknessPayloadFixture(s);
      assert.equal(isWeaknessLive(d), false, s);
      assert.equal(weaknessStaleTime(d), WEAKNESS_STALE_MS, s);
    }
    for (const s of ["computing", "ready_updating", "computing_stalled"] as const) {
      const d = weaknessPayloadFixture(s);
      assert.equal(isWeaknessLive(d), true, s);
      assert.equal(weaknessStaleTime(d), 0, s);
    }
    assert.equal(weaknessStaleTime(undefined), WEAKNESS_STALE_MS);
  });

  it("never polls while the socket is live, nor for a settled profile", () => {
    const t0 = 1_800_000_000_000;
    assert.equal(weaknessPollInterval(fakeQuery(weaknessPayloadFixture("computing"), t0), true, t0), false);
    assert.equal(weaknessPollInterval(fakeQuery(weaknessPayloadFixture("ready"), t0), false, t0), false);
  });
});

describe("the fallback poll (AP-20)", () => {
  afterEach(() => mock.timers.reset());

  it("re-created on every render, it walks 5 s, 3 s × 20, then 10 s, and stops 15 min after it started", () => {
    mock.timers.enable({ apis: ["Date"], now: 1_800_000_000_000 });
    const query = fakeQuery(weaknessPayloadFixture("computing"), Date.now());
    const seen: (number | false)[] = [];
    // Every iteration is a render: a fresh options object, the same Query.
    for (let i = 0; i < 400; i++) {
      const interval = (weaknessQuery({ socketLive: false }).refetchInterval as (q: typeof query) => number | false)(query);
      seen.push(interval);
      if (interval === false) break;
      mock.timers.tick(interval);
      query.state.dataUpdatedAt = Date.now(); // the poll landed (a 304 refreshes dataUpdatedAt too)
    }
    assert.equal(seen[0], WEAKNESS_FALLBACK.delayMs);
    assert.deepEqual(seen.slice(1, 21), Array<number>(20).fill(3_000));
    assert.equal(seen[21], 10_000);
    assert.equal(seen.at(-1), false, "it gives up");
    const polls = seen.filter((x) => x !== false).length;
    // 5 s + 20 × 3 s = 65 s, then 10 s steps until 15 min: 1 + 20 + ceil((900 − 65) / 10) polls.
    assert.equal(polls, 1 + 20 + Math.ceil((WEAKNESS_FALLBACK.stopAfterMs / 1000 - 65) / 10));
    // A later render of the same building episode still does not poll.
    mock.timers.tick(60_000);
    assert.equal(weaknessPollInterval(query, false), false);
  });

  it("a settled answer ends the episode; the next build starts the schedule again", () => {
    mock.timers.enable({ apis: ["Date"], now: 1_800_000_000_000 });
    const query = fakeQuery(weaknessPayloadFixture("computing"), Date.now());
    assert.equal(weaknessPollInterval(query, false), WEAKNESS_FALLBACK.delayMs);
    mock.timers.tick(WEAKNESS_FALLBACK.delayMs);
    query.state.dataUpdatedAt = Date.now();
    assert.equal(weaknessPollInterval(query, false), 3_000);
    // ready: the poller stops and forgets the episode.
    query.state.data = weaknessPayloadFixture("ready");
    query.state.dataUpdatedAt = Date.now();
    assert.equal(weaknessPollInterval(query, false), false);
    // 20 min later a recompute runs behind the READY profile (updating): a new episode, first step again.
    mock.timers.tick(20 * 60_000);
    query.state.data = weaknessPayloadFixture("ready_updating");
    query.state.dataUpdatedAt = Date.now();
    assert.equal(weaknessPollInterval(query, false), WEAKNESS_FALLBACK.delayMs);
    // The socket comes back: no poll, and the schedule resets.
    assert.equal(weaknessPollInterval(query, true), false);
    assert.equal(weaknessPollInterval(query, false), WEAKNESS_FALLBACK.delayMs);
  });
});

describe("weakness fetchers", () => {
  it("TR-5 through api(): the envelope unwrapped and the payload checked against the schema outside production", async () => {
    const payload = weaknessPayloadFixture("ready");
    replies.push({ status: 200, body: { data: payload } });
    const qc = new QueryClient();
    const got = await qc.fetchQuery(weaknessQuery());
    qc.clear(); // no gc timer left behind
    assert.deepEqual(got, payload);
    assert.equal(calls[0]!.url, "/api/train/weakness");
    assert.equal(calls[0]!.init?.method, "GET");

    // A body that does not match the contract is refused in test builds (contract_mismatch), never rendered.
    replies.push({ status: 200, body: { data: { ...payload, status: "almost" } } });
    await assert.rejects(fetchWeakness(), (e: { code?: string }) => e.code === "contract_mismatch");
  });

  it("TR-12 posts the body and reads the 202; a 429 surfaces retryAfterSec", async () => {
    replies.push({ status: 202, body: { data: { status: "computing", queuedAt: "2026-11-17T10:00:00.000Z", scopeChanged: true } } });
    const r = await postWeaknessRecompute({ timeClasses: ["RAPID", "BLITZ", "BULLET"] });
    assert.deepEqual(r, { status: "computing", queuedAt: "2026-11-17T10:00:00.000Z", scopeChanged: true });
    assert.equal(calls[0]!.url, "/api/train/weakness/recompute");
    assert.equal(calls[0]!.init?.method, "POST");
    assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)), { timeClasses: ["RAPID", "BLITZ", "BULLET"] });

    replies.push({ status: 429, body: { error: { code: "rate_limited", message: "Too many requests", retryAfterSec: 412, requestId: "r1" } } });
    await assert.rejects(postWeaknessRecompute(), (e: { code?: string; retryAfterSec?: number }) => e.code === "rate_limited" && e.retryAfterSec === 412);
  });

  it("TR-13 posts the version with keepalive (it survives leaving the page)", async () => {
    replies.push({ status: 204, body: null });
    await postWeaknessSeen(3);
    assert.equal(calls[0]!.url, "/api/train/weakness/seen");
    assert.equal(calls[0]!.init?.keepalive, true);
    assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)), { version: 3 });
  });
});

describe("zod stays out of production chunks (AP-12)", () => {
  it("every schema use is behind the NODE_ENV guard at its call site", () => {
    const src = readFileSync(path.join(import.meta.dirname, "weakness.ts"), "utf8");
    const uses = src.split("\n").filter((l) => /Schema\b/.test(l) && !/^\s*(\/\/|\*|import)/.test(l) && !/^\s*\/\*\*/.test(l));
    assert.ok(uses.length >= 2, "the fetchers check the response in dev and test");
    for (const l of uses) assert.match(l, /process\.env\.NODE_ENV === "production" \? undefined : \w+Schema/, l.trim());
  });
});
