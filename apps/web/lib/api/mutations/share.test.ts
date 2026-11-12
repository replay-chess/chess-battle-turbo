// lib/api/mutations/share.ts (phase-03 plan §5.4): the per-game Idempotency-Key kept in sessionStorage, the request
// paths and bodies of A10/A11, and the cache writes (the share key and the review payload's `share` block).
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { reviewFixture } from "@repo/contracts/http/fixtures/review";
import type { ReviewDTO } from "@repo/contracts/http/review";
import type { ShareDTO } from "@repo/contracts/http/share";
import { QueryClient } from "@tanstack/react-query";
import { qk } from "../keys";
import {
  SHARE_KEY_PREFIX,
  createShareRequest,
  forgetShareIdempotencyKey,
  revokeShareRequest,
  shareIdempotencyKey,
  updateShareRequest,
  writeShareCaches,
} from "./share";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function memoryStore() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    m,
  };
}

const REF = "cgame000000000000000000000";
const SHARE: ShareDTO = {
  code: "8kq2xh4m",
  url: "http://localhost:3000/r/8kq2xh4m",
  imageUrl: "http://localhost:3000/r/8kq2xh4m/og?v=1",
  expiresAt: "2026-12-11T12:00:00.000Z",
  showUsername: true,
};

function capture(status: number, body: unknown) {
  const seen: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return seen;
}

describe("share Idempotency-Key", () => {
  it("one UUID v4 per game for the tab session; forgotten after Stop Sharing", () => {
    const store = memoryStore();
    const a = shareIdempotencyKey(REF, store);
    assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(shareIdempotencyKey(REF, store), a);
    assert.equal(store.m.get(`${SHARE_KEY_PREFIX}${REF}`), a);
    assert.notEqual(shareIdempotencyKey("cother00000000000000000000", store), a);
    forgetShareIdempotencyKey(REF, store);
    assert.notEqual(shareIdempotencyKey(REF, store), a);
  });

  it("works without storage (private mode, SSR): a fresh key each time, no throw", () => {
    const broken = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => undefined,
      removeItem: () => {
        throw new Error("SecurityError");
      },
    };
    assert.match(shareIdempotencyKey(REF, broken), /^[0-9a-f-]{36}$/);
    assert.match(shareIdempotencyKey(REF, null), /^[0-9a-f-]{36}$/);
    assert.doesNotThrow(() => forgetShareIdempotencyKey(REF, broken));
  });
});

describe("requests", () => {
  it("A10: POST /api/review/{ref}/share with the key header and the body", async () => {
    const seen = capture(201, { data: SHARE });
    const out = await createShareRequest(REF, { showUsername: false, from: "complete" }, "1b4e28ba-2fa1-4d2b-8f3e-9c2d1e7a6b5c");
    assert.deepEqual(out, SHARE);
    assert.equal(seen[0]!.url, `/api/review/${REF}/share`);
    assert.equal(seen[0]!.init.method, "POST");
    assert.equal(new Headers(seen[0]!.init.headers).get("idempotency-key"), "1b4e28ba-2fa1-4d2b-8f3e-9c2d1e7a6b5c");
    assert.deepEqual(JSON.parse(String(seen[0]!.init.body)), { showUsername: false, from: "complete" });
  });

  it("A11: PATCH and DELETE /api/share/{code}", async () => {
    const patch = capture(200, { data: { ...SHARE, showUsername: false } });
    assert.equal((await updateShareRequest("8kq2xh4m", false)).showUsername, false);
    assert.equal(patch[0]!.url, "/api/share/8kq2xh4m");
    assert.equal(patch[0]!.init.method, "PATCH");
    assert.deepEqual(JSON.parse(String(patch[0]!.init.body)), { showUsername: false });
    const del = capture(204, null);
    await revokeShareRequest("8kq2xh4m");
    assert.equal(del[0]!.init.method, "DELETE");
  });
});

describe("cache writes", () => {
  it("the share key and the review payload's share block move together", () => {
    const qc = new QueryClient();
    qc.setQueryData(qk.review.detail(REF), reviewFixture("done"));
    writeShareCaches(qc, REF, SHARE);
    assert.deepEqual(qc.getQueryData(qk.review.share(REF)), SHARE);
    assert.deepEqual(qc.getQueryData<ReviewDTO>(qk.review.detail(REF))?.share, {
      code: SHARE.code,
      url: SHARE.url,
      expiresAt: SHARE.expiresAt,
      showUsername: true,
    });
    writeShareCaches(qc, REF, null);
    assert.equal(qc.getQueryData(qk.review.share(REF)), null);
    assert.equal(qc.getQueryData<ReviewDTO>(qk.review.detail(REF))?.share, null);
  });

  it("does not create a review payload that was never loaded", () => {
    const qc = new QueryClient();
    writeShareCaches(qc, REF, SHARE);
    assert.equal(qc.getQueryData(qk.review.detail(REF)), undefined);
  });
});
