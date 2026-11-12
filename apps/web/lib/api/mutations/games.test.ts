// lib/api/mutations/games.ts (phase-02 plan §5.3): the per-body Idempotency-Key slot (60 s), the in_flight retry of
// create, and the complete retries (1 s, 4 s, 15 s on network errors and 5xx; 409/422 final).
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { snapshotOf } from "@repo/game-core/snapshot";
import { ApiError } from "../errors";
import { BOT_IDEMPOTENCY_TTL_MS, canonicalBody, completeBotGameRequest, createBotGameRequest, idempotencyKeyFor } from "./games";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function memoryStore() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

function respondWith(...responses: (() => Response)[]) {
  const seen: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    const next = responses.shift();
    if (!next) throw new TypeError("network");
    return next();
  }) as typeof fetch;
  return seen;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => () =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const COMPLETE = { rev: 1, moves: [], clocksMs: [], result: "aborted" as const, method: "aborted" as const, assists: { hints: 0, undos: 0 }, endedAtClient: 0 };
const RESULT = { status: "ABORTED", outcome: "NONE", method: "aborted", analysis: { status: "none", etaSec: null }, comparison: null };

describe("Idempotency-Key per create body", () => {
  it("reuses the key for the same body within 60 s, then mints a new UUID v4; another body gets another key", async () => {
    const store = memoryStore();
    const body = { mode: "BOT", start: { kind: "initial" }, tc: { initialSeconds: 600, incrementSeconds: 0 } };
    const k1 = await idempotencyKeyFor(body, 1_000, store);
    assert.match(k1, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(await idempotencyKeyFor({ tc: body.tc, start: body.start, mode: "BOT" }, 2_000, store), k1);
    assert.notEqual(await idempotencyKeyFor(body, 1_000 + BOT_IDEMPOTENCY_TTL_MS, store), k1);
    assert.notEqual(await idempotencyKeyFor({ ...body, mode: "LEGEND_BOT" }, 2_000, store), k1);
    assert.ok([...store.m.keys()].every((k) => /^rc:idem:bot:[0-9a-f]{40}$/.test(k)));
    assert.equal(canonicalBody({ b: 1, a: undefined, c: [1, { z: 1, y: 2 }] }), '{"b":1,"c":[1,{"y":2,"z":1}]}');
  });

  it("works without storage", async () => {
    assert.match(await idempotencyKeyFor({ a: 1 }, 0, null), /^[0-9a-f-]{36}$/);
  });
});

describe("create request", () => {
  it("retries once on 409 in_flight with the same key", async () => {
    const game = snapshotOf(
      {
        referenceId: "cgame000000000000000000000",
        status: "IN_PROGRESS",
        mode: "BOT",
        rated: false,
        timeClass: "RAPID",
        startingFen: null,
        studySeconds: 0,
        moves: "",
        moveClocksMs: [],
        fen: null,
        initialTimeSeconds: 600,
        incrementSeconds: 0,
        whiteTimeMs: 600000,
        blackTimeMs: 600000,
        clockRunning: null,
        phase: "PLAYING",
        phaseEndsAt: null,
        lastMoveAt: 0,
        endMethod: null,
        outcome: null,
        completedAt: null,
        updatedAt: 0,
        botElo: 1200,
        meta: null,
        white: { ref: "cviewer00000000000000000000", name: "Ann", avatarUrl: null, rating: null },
        black: null,
      },
      { role: "player", color: "w" },
      0,
    );
    const seen = respondWith(
      json(409, { error: { code: "in_flight", message: "x", retryAfterSec: 0, requestId: "r1" } }),
      json(201, { data: { game } }),
    );
    const out = await createBotGameRequest({ mode: "BOT" }, "3f2b8c1e-9d4a-4b6f-8e2d-1a2b3c4d5e6f");
    assert.equal((out as { ref: string }).ref, game.ref);
    assert.equal(seen.length, 2);
    assert.ok(seen.every((s) => (s.init.headers as Record<string, string>)["Idempotency-Key"] === "3f2b8c1e-9d4a-4b6f-8e2d-1a2b3c4d5e6f"));
  });
});

describe("complete request retries", () => {
  it("network errors and 5xx retry at the given delays; then success", async () => {
    const waits: number[] = [];
    const seen = respondWith(() => {
      throw new TypeError("offline");
    }, json(503, { error: { code: "unavailable", message: "x", requestId: "r" } }), json(200, { data: RESULT }));
    const out = await completeBotGameRequest("cgame000000000000000000000", COMPLETE, [1_000, 4_000, 15_000], async (ms) => waits.push(ms));
    assert.deepEqual(out, RESULT);
    assert.deepEqual(waits, [1_000, 4_000]);
    assert.equal(seen[0]!.url, "/api/games/cgame000000000000000000000/complete");
  });

  it("422 and 409 are final (no retry)", async () => {
    for (const status of [422, 409]) {
      const waits: number[] = [];
      respondWith(json(status, { error: { code: status === 422 ? "illegal_moves" : "conflict", message: "x", requestId: "r" } }));
      await assert.rejects(
        completeBotGameRequest("cgame000000000000000000000", COMPLETE, [1, 2, 3], async (ms) => waits.push(ms)),
        (e: unknown) => e instanceof ApiError && e.status === status,
      );
      assert.deepEqual(waits, []);
    }
  });

  it("gives up after the last delay", async () => {
    const waits: number[] = [];
    respondWith(
      json(500, { error: { code: "internal", message: "x", requestId: "r" } }),
      json(500, { error: { code: "internal", message: "x", requestId: "r" } }),
      json(500, { error: { code: "internal", message: "x", requestId: "r" } }),
      json(500, { error: { code: "internal", message: "x", requestId: "r" } }),
    );
    await assert.rejects(completeBotGameRequest("cgame000000000000000000000", COMPLETE, [1, 2, 3], async (ms) => waits.push(ms)), ApiError);
    assert.deepEqual(waits, [1, 2, 3]);
  });
});
