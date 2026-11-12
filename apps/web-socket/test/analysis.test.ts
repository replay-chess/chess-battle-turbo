// P3 socket pieces without a database (phase-03 plan §7.4, §8.17): ANALYSIS_WORKER_URL in the environment, the
// signed worker kick (kid ws, exact bytes, never throws), and the after-end hook (kick + `analysis:queued` +
// `games:changed` to the member players only).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { parseKeyRing, verifyInternal, workerKidMayCall } from "@repo/contracts/internal/auth";
import { KICK_PATH, KickBodyV1 } from "@repo/contracts/internal/kick";
import { AnalysisQueuedEvent, GamesChangedEvent } from "@repo/contracts/socket/analysis";
import type { FinishAnalysis } from "@repo/db/live";
import { createAnalysisHook, memberRefs } from "../src/analysis/afterEnd";
import { createWorkerKicker, type KickResult, type WorkerKicker } from "../src/analysis/kick";
import { EnvError, loadEnv } from "../src/config/env";
import type { LiveSession } from "../src/game/LiveSession";
import { SILENT_LOGGER, createMemoryMetrics } from "../src/ports";
import { SOCKET_TOKEN_SECRET } from "./helpers";

const k = () => randomBytes(32).toString("base64");
const WS_KEY = k();
const SOCKET_RING = parseKeyRing(`web:${k()},ws:${WS_KEY}`);
/** The worker's ring: it accepts `ws` with the same key. */
const WORKER_RING = parseKeyRing(`wk:${k()},ws:${WS_KEY}`);
const GAME_REF = "cmwc9p8sjf72avcjm23o4v6rv";

describe("ANALYSIS_WORKER_URL", () => {
  const dev = { APP_ENV: "dev", ALLOWED_ORIGINS: "https://a.example", SOCKET_TOKEN_SECRET };

  test("required with APP_ENV=dev, optional elsewhere; a trailing slash is dropped", () => {
    assert.throws(() => loadEnv(dev), (e: unknown) => e instanceof EnvError && /ANALYSIS_WORKER_URL is required/.test(e.message));
    assert.equal(loadEnv({ ...dev, ANALYSIS_WORKER_URL: "http://analysis-worker:3003/" }).analysisWorkerUrl, "http://analysis-worker:3003");
    assert.equal(loadEnv({ APP_ENV: "test", SOCKET_TOKEN_SECRET }).analysisWorkerUrl, null);
    assert.equal(loadEnv({ APP_ENV: "local", SOCKET_TOKEN_SECRET }).analysisWorkerUrl, null);
    // Production has no worker until P13: the socket must still boot without it.
    assert.equal(loadEnv({ ...dev, APP_ENV: "production" }).analysisWorkerUrl, null);
  });

  test("must be a bare origin (no path, query or spaces)", () => {
    for (const bad of ["analysis-worker:3003", "http://analysis-worker:3003/internal", "ftp://x", "http://a b", "http://h?x=1"]) {
      assert.throws(() => loadEnv({ ...dev, ANALYSIS_WORKER_URL: bad }), /ANALYSIS_WORKER_URL must be an origin/, bad);
    }
  });
});

type Sent = { url: string; init: RequestInit };

function recordingFetch(status = 202): { fetchImpl: typeof fetch; sent: Sent[] } {
  const sent: Sent[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    sent.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ draining: false, nextRunAt: null }), { status });
  }) as typeof fetch;
  return { fetchImpl, sent };
}

describe("worker kick (socket → worker)", () => {
  test("signs the exact body with kid ws; the worker's verifier and policy accept it", async () => {
    const metrics = createMemoryMetrics();
    const { fetchImpl, sent } = recordingFetch();
    const kicker = createWorkerKicker({ baseUrl: "http://worker:3003", keys: SOCKET_RING, now: Date.now, log: SILENT_LOGGER, metrics, fetchImpl });
    const r = await kicker.kick({ v: 1, reason: "live_end", watch: GAME_REF });
    assert.deepEqual(r, { ok: true, status: 202 });
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.url, `http://worker:3003${KICK_PATH}`);
    const body = sent[0]!.init.body as string;
    assert.deepEqual(KickBodyV1.parse(JSON.parse(body)), { v: 1, reason: "live_end", watch: GAME_REF });
    const headers = sent[0]!.init.headers as Record<string, string>;
    assert.equal(headers["x-rc-kid"], "ws");
    const verified = verifyInternal({ headers, method: "POST", path: KICK_PATH, body, keys: WORKER_RING, nowMs: Date.now() });
    assert.deepEqual(verified, { ok: true, kid: "ws" });
    assert.equal(workerKidMayCall("ws", KICK_PATH), true);
    assert.equal(metrics.counts.get("ws.analysis.kick{reason=live_end,result=ok}"), 1);
  });

  test("never throws: no URL, no ws key, an error status, a network failure, an invalid body", async () => {
    const metrics = createMemoryMetrics();
    const deps = { keys: SOCKET_RING, now: Date.now, log: SILENT_LOGGER, metrics };
    const results: KickResult[] = [];
    results.push(await createWorkerKicker({ ...deps, baseUrl: null }).kick({ v: 1, reason: "live_end" }));
    results.push(await createWorkerKicker({ ...deps, baseUrl: "http://w:3003", keys: parseKeyRing(`web:${k()}`) }).kick({ v: 1, reason: "live_end" }));
    results.push(await createWorkerKicker({ ...deps, baseUrl: "http://w:3003", fetchImpl: recordingFetch(401).fetchImpl }).kick({ v: 1, reason: "live_end" }));
    const failing = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    results.push(await createWorkerKicker({ ...deps, baseUrl: "http://w:3003", fetchImpl: failing }).kick({ v: 1, reason: "live_end" }));
    results.push(
      await createWorkerKicker({ ...deps, baseUrl: "http://w:3003", fetchImpl: recordingFetch().fetchImpl }).kick({
        v: 1,
        reason: "live_end",
        watch: "not a ref!",
      }),
    );
    assert.deepEqual(
      results.map((r) => (r.ok ? "ok" : r.reason)),
      ["not_configured", "no_key", "http_error", "network", "invalid_body"],
    );
  });
});

function fakeSession(w: string | null, b: string | null, mode = "FRIEND"): LiveSession {
  return { ref: GAME_REF, state: { mode, seats: { w: { ref: w }, b: { ref: b } } } } as unknown as LiveSession;
}

type Captured = { event: string; distinctId: string; props: Record<string, unknown> };

function hookWith() {
  const kicks: unknown[] = [];
  const emits: { userRef: string; event: string; data: Record<string, unknown> }[] = [];
  const kicker: WorkerKicker = {
    kick: async (body) => {
      kicks.push(body);
      return { ok: true, status: 202 };
    },
  };
  const captured: Captured[] = [];
  const hook = createAnalysisHook({
    kicker,
    emitToUser: (userRef, event, data) => emits.push({ userRef, event, data }),
    log: SILENT_LOGGER,
    metrics: createMemoryMetrics(),
    telemetry: { capture: (event, distinctId, props) => captured.push({ event, distinctId, props }) },
    appEnv: "test",
  });
  return { hook, kicks, emits, captured };
}

const queued: FinishAnalysis = { review: { status: "queued", etaSec: 19 }, status: "QUEUED", created: true, ahead: 2, kick: true };

describe("after-end hook", () => {
  test("a queued finish: one kick (live_end, watching the game) and analysis:queued + games:changed to both members", () => {
    const { hook, kicks, emits } = hookWith();
    hook(fakeSession("uw", "ub"), { kind: "finish", analysis: queued });
    assert.deepEqual(kicks, [{ v: 1, reason: "live_end", watch: GAME_REF }]);
    assert.deepEqual(
      emits.map((e) => [e.userRef, e.event]),
      [
        ["uw", "analysis:queued"],
        ["ub", "analysis:queued"],
        ["uw", "games:changed"],
        ["ub", "games:changed"],
      ],
    );
    assert.deepEqual(AnalysisQueuedEvent.parse(emits[0]!.data), { v: 1, gameRef: GAME_REF, position: 2, etaSec: 19 });
    assert.deepEqual(GamesChangedEvent.parse(emits[2]!.data), { v: 1, gameRef: GAME_REF });
  });

  test("a skipped finish and an abort: no kick, no analysis:queued, games:changed only", () => {
    const { hook, kicks, emits } = hookWith();
    hook(fakeSession("uw", "ub"), {
      kind: "finish",
      analysis: { review: { status: "skipped", etaSec: null }, status: "SKIPPED", created: false, ahead: 0, kick: false },
    });
    hook(fakeSession("uw", "ub"), { kind: "abort" });
    assert.equal(kicks.length, 0);
    assert.deepEqual(new Set(emits.map((e) => e.event)), new Set(["games:changed"]));
    assert.equal(emits.length, 4);
  });

  test("a replay whose job already runs: no kick and no analysis:queued (the worker's own events follow)", () => {
    const { hook, kicks, emits } = hookWith();
    hook(fakeSession("uw", "ub"), {
      kind: "finish",
      analysis: { review: { status: "queued", etaSec: null }, status: "RUNNING", created: false, ahead: 0, kick: false },
    });
    assert.equal(kicks.length, 0);
    assert.equal(emits.filter((e) => e.event === "analysis:queued").length, 0);
  });

  test("only member seats receive events; a seat without a ref (bot, unjoined) is skipped", () => {
    assert.deepEqual(memberRefs(fakeSession("uw", null)), ["uw"]);
    assert.deepEqual(memberRefs(fakeSession(null, null)), []);
    const { hook, emits, kicks } = hookWith();
    hook(fakeSession(null, null), { kind: "finish", analysis: queued });
    assert.equal(emits.length, 0);
    assert.equal(kicks.length, 1, "the job still needs the worker");
  });

  test("regression: analysis-queued-once: a finish that created the job sends analysis_queued once (plan §10.1)", () => {
    const { hook, captured } = hookWith();
    hook(fakeSession("uw", "ub", "ONLINE"), { kind: "finish", analysis: queued });
    assert.deepEqual(captured, [
      {
        event: "analysis_queued",
        distinctId: "uw",
        props: { app_env: "test", game_mode: "online", source: "replay", reason: "live_end", priority: 80, queue_position: 2 },
      },
    ]);
    // A retried / replayed finish found the job (dedupeKey): no second event, though it still kicks.
    hook(fakeSession("uw", "ub", "ONLINE"), { kind: "finish", analysis: { ...queued, created: false } });
    hook(fakeSession("uw", "ub"), { kind: "abort" });
    assert.equal(captured.length, 1);
  });

  test("analysis_queued names the live mode: friend and tournament games", () => {
    const { hook, captured } = hookWith();
    hook(fakeSession("uw", "ub", "FRIEND"), { kind: "finish", analysis: queued });
    hook(fakeSession(null, "ub", "TOURNAMENT"), { kind: "finish", analysis: queued });
    assert.deepEqual(
      captured.map((c) => [c.props.game_mode, c.distinctId]),
      [
        ["friend", "uw"],
        ["tournament", "ub"],
      ],
    );
  });

  test("never throws when an emit fails", () => {
    const hook = createAnalysisHook({
      kicker: { kick: async () => ({ ok: true, status: 202 }) },
      emitToUser: () => {
        throw new Error("socket.io down");
      },
      log: SILENT_LOGGER,
      metrics: createMemoryMetrics(),
    });
    assert.doesNotThrow(() => hook(fakeSession("uw", "ub"), { kind: "finish", analysis: queued }));
  });
});
