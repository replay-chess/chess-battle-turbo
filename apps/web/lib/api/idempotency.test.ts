// lib/api/idempotency.ts (api-design §2.8): header parsing, the canonical body hash, and the claim / replay /
// reuse / in-flight / take-over / failure paths over an in-memory idempotency_keys table. games.int.test.ts runs the
// same statements on Postgres.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Prisma } from "@repo/db";
import { ApiError } from "./api-error";
import {
  IDEMPOTENCY_IN_FLIGHT_MS,
  canonicalJson,
  readIdempotencyKey,
  requestHash,
  withIdempotency,
  type IdempotencyDb,
} from "./idempotency";

type Row = { route: string; requestHash: string; status: number; responseStatus: number | null; responseBody: unknown; createdAt: Date };

function memoryDb() {
  const rows = new Map<string, Row>();
  const k = (v: unknown[]) => `${String(v[0])}:${String(v[1])}`;
  const db: IdempotencyDb = {
    $queryRaw: <T>(q: Prisma.Sql) => {
      const text = q.strings.join("?");
      const v = q.values;
      if (text.includes("INSERT INTO idempotency_keys")) {
        const key = k(v);
        if (rows.has(key)) return Promise.resolve([] as T);
        rows.set(key, { route: v[2] as string, requestHash: v[3] as string, status: 0, responseStatus: null, responseBody: null, createdAt: v[4] as Date });
        return Promise.resolve([{ claimed: 1 }] as T);
      }
      if (text.includes("SELECT route")) {
        const row = rows.get(k(v));
        return Promise.resolve((row ? [row] : []) as T);
      }
      throw new Error(`unexpected query ${text}`);
    },
    $executeRaw: (q: Prisma.Sql) => {
      const text = q.strings.join("?");
      const v = q.values;
      if (text.includes("SET status = 1")) {
        const row = rows.get(`${String(v[2])}:${String(v[3])}`)!;
        row.status = 1;
        row.responseStatus = v[0] as number;
        row.responseBody = JSON.parse(v[1] as string);
        return Promise.resolve(1);
      }
      if (text.includes("DELETE FROM idempotency_keys")) {
        rows.delete(k(v));
        return Promise.resolve(1);
      }
      if (text.includes(`SET "createdAt"`)) {
        const row = rows.get(`${String(v[1])}:${String(v[2])}`);
        if (row && row.status === 0 && row.createdAt.getTime() === (v[3] as Date).getTime()) {
          row.createdAt = v[0] as Date;
          return Promise.resolve(1);
        }
        return Promise.resolve(0);
      }
      throw new Error(`unexpected statement ${text}`);
    },
  };
  return { db, rows };
}

const KEY = "3f2b8c1e-9d4a-4b6f-8e2d-1a2b3c4d5e6f";
const scope = (over: Partial<{ hash: string; now: Date; route: string }> = {}) => ({
  userId: 5n,
  key: KEY,
  route: over.route ?? "games.create",
  hash: over.hash ?? requestHash({ a: 1 }),
  now: over.now ?? new Date(1_000_000),
});

describe("Idempotency-Key header", () => {
  it("accepts a UUID v4 (case-insensitive), refuses anything else, and enforces required", () => {
    const h = (v?: string) => new Headers(v === undefined ? {} : { "Idempotency-Key": v });
    assert.equal(readIdempotencyKey(h(KEY.toUpperCase()), { required: true }), KEY);
    assert.equal(readIdempotencyKey(h(), { required: false }), null);
    assert.throws(() => readIdempotencyKey(h(), { required: true }), (e: unknown) => e instanceof ApiError && e.code === "validation_failed");
    assert.throws(() => readIdempotencyKey(h("not-a-uuid"), { required: false }), (e: unknown) => e instanceof ApiError && e.status === 400);
    assert.throws(() => readIdempotencyKey(h("3f2b8c1e-9d4a-1b6f-8e2d-1a2b3c4d5e6f"), { required: true }), ApiError); // v1
  });

  it("the body hash ignores key order and undefined fields", () => {
    assert.equal(canonicalJson({ b: 1, a: [2, { d: 1, c: null }], u: undefined }), '{"a":[2,{"c":null,"d":1}],"b":1}');
    assert.equal(requestHash({ a: 1, b: 2 }), requestHash({ b: 2, a: 1 }));
    assert.notEqual(requestHash({ a: 1 }), requestHash({ a: 2 }));
  });
});

describe("withIdempotency", () => {
  it("runs once and replays the stored response", async () => {
    const { db } = memoryDb();
    let runs = 0;
    const run = async () => ({ status: 201, body: { game: { ref: `r${++runs}` } } });
    const first = await withIdempotency(db, scope(), run);
    const second = await withIdempotency(db, scope(), run);
    assert.deepEqual(first, { status: 201, body: { game: { ref: "r1" } }, replayed: false });
    assert.deepEqual(second, { status: 201, body: { game: { ref: "r1" } }, replayed: true });
    assert.equal(runs, 1);
  });

  it("the same key with another body or route → 422 idempotency_key_reused", async () => {
    const { db } = memoryDb();
    await withIdempotency(db, scope(), async () => ({ status: 201, body: {} }));
    await assert.rejects(withIdempotency(db, scope({ hash: requestHash({ a: 2 }) }), async () => ({ status: 201, body: {} })), (e: unknown) => e instanceof ApiError && e.code === "idempotency_key_reused");
    await assert.rejects(withIdempotency(db, scope({ route: "other" }), async () => ({ status: 201, body: {} })), (e: unknown) => e instanceof ApiError && e.code === "idempotency_key_reused");
  });

  it("a request still running → 409 in_flight (retry after 2 s); an abandoned one (> 60 s) is taken over", async () => {
    const { db, rows } = memoryDb();
    let release!: () => void;
    const slow = withIdempotency(db, scope(), () => new Promise<{ status: number; body: { n: number } }>((resolve) => (release = () => resolve({ status: 201, body: { n: 1 } }))));
    await new Promise((r) => setImmediate(r));
    await assert.rejects(withIdempotency(db, scope(), async () => ({ status: 201, body: {} })), (e: unknown) => e instanceof ApiError && e.code === "in_flight" && e.retryAfterSec === 2);
    release();
    await slow;

    rows.clear();
    rows.set(`5:${KEY}`, { route: "games.create", requestHash: requestHash({ a: 1 }), status: 0, responseStatus: null, responseBody: null, createdAt: new Date(0) });
    const later = new Date(IDEMPOTENCY_IN_FLIGHT_MS + 1);
    const out = await withIdempotency(db, scope({ now: later }), async () => ({ status: 201, body: { n: 2 } }));
    assert.deepEqual(out, { status: 201, body: { n: 2 }, replayed: false });
  });

  it("a 4xx ApiError is stored and replayed; a 5xx or a crash frees the key", async () => {
    const { db, rows } = memoryDb();
    await assert.rejects(withIdempotency(db, scope(), async () => Promise.reject(new ApiError("not_found", { message: "Nope." }))), ApiError);
    await assert.rejects(
      withIdempotency(db, scope(), async () => ({ status: 201, body: {} })),
      (e: unknown) => e instanceof ApiError && e.code === "not_found" && e.details?.replayed === true,
    );
    rows.clear();
    await assert.rejects(withIdempotency(db, scope(), async () => Promise.reject(new Error("boom"))), /boom/);
    assert.equal(rows.size, 0);
    const retried = await withIdempotency(db, scope(), async () => ({ status: 201, body: { ok: true } }));
    assert.equal(retried.replayed, false);
  });
});
