import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { ApiError, resetApiErrorDeps, retryQuery, setApiErrorDeps } from "./errors";
import { DEFAULT_GC_TIME_MS, DEFAULT_STALE_TIME_MS, getQueryClient, makeQueryClient } from "./query-client";
import { meQuery, ME_GC_TIME_MS, ME_STALE_TIME_MS, setMeEntitlement } from "./queries/me";
import { openingsIndexQuery } from "./queries/catalog";

const g = globalThis as { window?: unknown };

afterEach(() => {
  resetApiErrorDeps();
});

test("defaults match plan §5.4", () => {
  const qc = makeQueryClient();
  const q = qc.getDefaultOptions().queries!;
  assert.equal(q.staleTime, DEFAULT_STALE_TIME_MS);
  assert.equal(DEFAULT_STALE_TIME_MS, 30_000);
  assert.equal(q.gcTime, DEFAULT_GC_TIME_MS);
  assert.equal(DEFAULT_GC_TIME_MS, 300_000);
  assert.equal(q.retry, retryQuery);
  assert.equal(q.refetchOnWindowFocus, true);
  assert.equal(q.refetchOnReconnect, true);
  assert.equal(q.networkMode, "online");
  const m = qc.getDefaultOptions().mutations!;
  assert.equal(m.retry, 0);
  assert.equal(m.networkMode, "online");
});

test("getQueryClient() on the server is a fresh client per call", () => {
  // node:test has no window, so TanStack's isServer is true here.
  assert.notEqual(getQueryClient(), getQueryClient());
});

test("query errors reach reactToApiError with kind and meta; mutation errors with kind mutation", async () => {
  const hadWindow = "window" in g;
  if (!hadWindow) g.window = {};
  const seen: { kind: string; object?: unknown }[] = [];
  setApiErrorDeps({
    sessionGuard: {
      onUnauthorized: () => {
        seen.push({ kind: "401" });
      },
    },
    notify: { error: (text) => seen.push({ kind: "toast", object: text }), warning: () => {} },
  });
  try {
    const qc = makeQueryClient();
    await qc
      .fetchQuery({
        queryKey: ["t"],
        queryFn: () => Promise.reject(new ApiError({ status: 401, code: "unauthorized" })),
        retry: false,
      })
      .catch(() => {});
    await qc
      .getMutationCache()
      .build(qc, {
        mutationFn: () => Promise.reject(new ApiError({ status: 500, code: "internal", requestId: "abcdef123" })),
        meta: { verb: "save", object: "notes" },
      })
      .execute(undefined)
      .catch(() => {});
    assert.deepEqual(seen, [{ kind: "401" }, { kind: "toast", object: "Failed to save notes · Event abcdef12" }]);
    qc.clear();
  } finally {
    if (!hadWindow) delete g.window;
  }
});

test("P1 query options: keys and freshness", () => {
  assert.deepEqual(meQuery.queryKey, ["me"]);
  assert.equal(meQuery.staleTime, ME_STALE_TIME_MS);
  assert.equal(ME_STALE_TIME_MS, 5 * 60_000);
  assert.equal(meQuery.gcTime, ME_GC_TIME_MS);
  assert.equal(ME_GC_TIME_MS, 30 * 60_000);
  assert.deepEqual(openingsIndexQuery.queryKey, ["catalog", "openings", "index"]);
  assert.equal(openingsIndexQuery.staleTime, 24 * 60 * 60_000);
  assert.equal(openingsIndexQuery.refetchOnWindowFocus, false);
});

test("setMeEntitlement merges into a cached viewer and leaves an empty cache alone", () => {
  const qc = makeQueryClient();
  setMeEntitlement(qc, { member: true } as never);
  assert.equal(qc.getQueryData(meQuery.queryKey), undefined);
  qc.setQueryData(meQuery.queryKey, { user: { ref: "u1" }, entitlement: { member: false }, flags: {}, buildId: "b" } as never);
  setMeEntitlement(qc, { member: true } as never);
  const me = qc.getQueryData(meQuery.queryKey) as unknown as { user: { ref: string }; entitlement: { member: boolean } };
  assert.equal(me.user.ref, "u1");
  assert.equal(me.entitlement.member, true);
  qc.clear();
});
