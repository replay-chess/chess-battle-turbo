import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import {
  ApiError,
  codeForLegacyStatus,
  mutationErrorCopy,
  paywallTarget,
  reactToApiError,
  resetApiErrorDeps,
  retryDelay,
  retryQuery,
  setApiErrorDeps,
  shortEventId,
  toApiError,
  type ApiErrorCode,
} from "./errors";

const headers = (h: Record<string, string> = {}) => new Headers(h);
const err = (code: ApiErrorCode, extra: Partial<ConstructorParameters<typeof ApiError>[0]> = {}) =>
  new ApiError({ status: extra.status ?? 0, code, ...extra });

describe("toApiError", () => {
  test("reads the envelope", () => {
    const e = toApiError(
      { status: 402, headers: headers({ "x-request-id": "hdr-id" }) },
      {
        error: {
          code: "subscription_required",
          message: "Membership required",
          details: { reason: "trial_used", upgradeUrl: "/pricing" },
          requestId: "body-id",
        },
      },
    );
    assert.equal(e.status, 402);
    assert.equal(e.code, "subscription_required");
    assert.equal(e.message, "Membership required");
    assert.equal(e.reason, "trial_used");
    assert.equal(e.requestId, "body-id");
  });

  test("an unknown envelope code degrades to internal", () => {
    const e = toApiError({ status: 409, headers: headers() }, { error: { code: "from_the_future", message: "x", requestId: "r" } });
    assert.equal(e.code, "internal");
  });

  test("keeps fields and retryAfterSec, falling back to the Retry-After header", () => {
    const a = toApiError(
      { status: 400, headers: headers() },
      { error: { code: "validation_failed", message: "Bad", fields: { "body.q": "Too long", n: 3 }, requestId: "r" } },
    );
    assert.deepEqual(a.fields, { "body.q": "Too long" });
    const b = toApiError(
      { status: 429, headers: headers({ "retry-after": "12" }) },
      { error: { code: "rate_limited", message: "Slow down", requestId: "r" } },
    );
    assert.equal(b.retryAfterSec, 12);
    const c = toApiError(
      { status: 429, headers: headers({ "retry-after": "12" }) },
      { error: { code: "rate_limited", message: "Slow down", retryAfterSec: 30, requestId: "r" } },
    );
    assert.equal(c.retryAfterSec, 30);
  });

  test("legacy { error: string, code } keeps a ledger code and the message", () => {
    const e = toApiError(
      { status: 402, headers: headers({ "x-request-id": "rid" }) },
      { error: "Subscription required", code: "subscription_required", upgradeUrl: "/pricing", reason: "expired" },
    );
    assert.equal(e.code, "subscription_required");
    assert.equal(e.message, "Subscription required");
    assert.equal(e.reason, "expired");
    assert.equal(e.details?.upgradeUrl, "/pricing");
    assert.equal(e.requestId, "rid");
  });

  test("legacy { error: string } without a code maps from the status", () => {
    assert.equal(toApiError({ status: 401 }, { error: "Unauthorized" }).code, "unauthorized");
    assert.equal(toApiError({ status: 404 }, { error: "Not found" }).code, "not_found");
    assert.equal(toApiError({ status: 500 }, { error: "Boom", code: "NOT_A_CODE" }).code, "internal");
  });

  test("legacy { success: false } maps from the status", () => {
    const e = toApiError({ status: 500 }, { success: false, error: "Failed to fetch openings" });
    assert.equal(e.code, "internal");
    assert.equal(e.message, "Failed to fetch openings");
  });

  test("an empty body maps from the status", () => {
    assert.equal(toApiError({ status: 429, headers: headers({ "retry-after": "5" }) }, null).code, "rate_limited");
    assert.equal(toApiError({ status: 429, headers: headers({ "retry-after": "5" }) }, null).retryAfterSec, 5);
    assert.equal(toApiError({ status: 500 }, null).code, "internal");
  });

  test("an HTML 502 page (non-JSON) maps from the status", () => {
    const e = toApiError({ status: 502, headers: headers({ "x-request-id": "gw" }) }, null);
    assert.equal(e.code, "upstream_unavailable");
    assert.equal(e.requestId, "gw");
  });

  test("bare 503/504 are outages, never the maintenance notice; bare 400 is validation", () => {
    assert.equal(codeForLegacyStatus(503), "unavailable");
    assert.equal(codeForLegacyStatus(504), "unavailable");
    assert.equal(codeForLegacyStatus(400), "validation_failed");
    assert.equal(toApiError({ status: 503 }, "<html>").code, "unavailable");
  });
});

describe("retryQuery", () => {
  test("never retries a 4xx", () => {
    for (const code of ["unauthorized", "subscription_required", "not_found", "rate_limited", "validation_failed"] as const) {
      assert.equal(retryQuery(0, err(code, { status: 400 })), false, code);
    }
    assert.equal(retryQuery(0, err("internal", { status: 405 })), false, "an unmapped 4xx is never retried");
  });

  test("retries network, timeout, internal and unavailable twice", () => {
    for (const code of ["network", "timeout", "internal", "unavailable"] as const) {
      const e = err(code, { status: code === "internal" ? 500 : code === "unavailable" ? 503 : 0 });
      assert.equal(retryQuery(0, e), true, code);
      assert.equal(retryQuery(1, e), true, code);
      assert.equal(retryQuery(2, e), false, code);
    }
  });

  test("retries upstream_unavailable once", () => {
    const e = err("upstream_unavailable", { status: 502 });
    assert.equal(retryQuery(0, e), true);
    assert.equal(retryQuery(1, e), false);
  });

  test("never retries aborted, offline, maintenance or contract_mismatch", () => {
    for (const code of ["aborted", "offline", "contract_mismatch"] as const) assert.equal(retryQuery(0, err(code)), false, code);
    assert.equal(retryQuery(0, err("maintenance", { status: 503 })), false);
  });
});

describe("retryDelay", () => {
  test("honours retryAfterSec", () => {
    assert.equal(retryDelay(0, err("unavailable", { status: 503, retryAfterSec: 2 })), 2000);
    assert.equal(retryDelay(3, err("internal", { status: 500, retryAfterSec: 7 })), 7000);
  });

  test("backs off 1 s, 3 s, 8 s cap, within ±25 % jitter", () => {
    const bases = [1000, 3000, 8000, 8000];
    for (let attempt = 0; attempt < bases.length; attempt++) {
      const base = bases[attempt]!;
      assert.equal(retryDelay(attempt, err("network"), () => 0), base * 0.75);
      assert.equal(retryDelay(attempt, err("network"), () => 1), base * 1.25);
      for (let i = 0; i < 50; i++) {
        const d = retryDelay(attempt, err("network"));
        assert.ok(d >= base * 0.75 && d <= base * 1.25, `${d} within jitter of ${base}`);
      }
    }
  });
});

describe("paywallTarget and copy helpers", () => {
  test("trial_available (or no reason) → reason=required; trial_used/expired/payment_failed → reason=ended", () => {
    assert.equal(paywallTarget("trial_available", "/play"), "/pricing?reason=required&redirect_url=%2Fplay");
    assert.equal(paywallTarget(undefined, "/play"), "/pricing?reason=required&redirect_url=%2Fplay");
    for (const r of ["trial_used", "expired", "payment_failed"]) {
      assert.equal(paywallTarget(r, "/play"), "/pricing?reason=ended&redirect_url=%2Fplay", r);
    }
  });

  test("checkout params never ride into redirect_url", () => {
    assert.equal(
      paywallTarget("expired", "/queue?tc=blitz&checkout=success&subscription_id=sub_1"),
      `/pricing?reason=ended&redirect_url=${encodeURIComponent("/queue?tc=blitz")}`,
    );
  });

  test("mutation copy and event ids", () => {
    assert.equal(mutationErrorCopy(undefined), "Failed to save changes");
    assert.equal(mutationErrorCopy({ verb: "remove", object: "the position" }), "Failed to remove the position");
    assert.equal(mutationErrorCopy({ errorCopy: "Couldn’t reach Dodo", verb: "x" }), "Couldn’t reach Dodo");
    assert.equal(shortEventId("7f3c2a91-e04b-4c1d"), "7f3c2a91");
    assert.equal(shortEventId(undefined), undefined);
  });
});

describe("reactToApiError", () => {
  type Calls = {
    guard: unknown[];
    replace: string[];
    errors: { text: string; opts?: { id?: string; action?: { label: string } } }[];
    warnings: string[];
    exceptions: unknown[];
    breadcrumbs: string[];
  };
  let calls: Calls;
  let path = "/play?tc=blitz";
  const g = globalThis as { window?: unknown };
  let hadWindow = false;

  beforeEach(() => {
    hadWindow = "window" in g;
    if (!hadWindow) g.window = {};
    path = "/play?tc=blitz";
    calls = { guard: [], replace: [], errors: [], warnings: [], exceptions: [], breadcrumbs: [] };
    setApiErrorDeps({
      sessionGuard: { onUnauthorized: (ctx) => calls.guard.push(ctx) },
      navigation: { replace: (href) => calls.replace.push(href) },
      notify: {
        error: (text, opts) => calls.errors.push({ text, opts }),
        warning: (text) => calls.warnings.push(text),
      },
      capture: {
        exception: (e) => calls.exceptions.push(e),
        message: () => {},
        breadcrumb: (m) => calls.breadcrumbs.push(m),
      },
      currentPath: () => path,
    });
  });

  afterEach(() => {
    resetApiErrorDeps();
    if (!hadWindow) delete g.window;
  });

  test("401 → the session guard, once", () => {
    reactToApiError(err("unauthorized", { status: 401 }), { kind: "query" });
    assert.equal(calls.guard.length, 1);
    assert.equal(calls.replace.length, 0);
    assert.equal(calls.errors.length, 0);
  });

  test("402 trial_available → reason=required with the current path; me invalidated", async () => {
    const qc = new QueryClient();
    qc.setQueryData(["me"], { user: {} });
    reactToApiError(err("subscription_required", { status: 402, details: { reason: "trial_available" } }), {
      kind: "query",
      queryClient: qc,
    });
    assert.deepEqual(calls.replace, [`/pricing?reason=required&redirect_url=${encodeURIComponent("/play?tc=blitz")}`]);
    assert.equal(qc.getQueryState(["me"])?.isInvalidated, true);
    qc.clear();
  });

  test("402 trial_used, expired, payment_failed → reason=ended", () => {
    for (const reason of ["trial_used", "expired", "payment_failed"]) {
      calls.replace = [];
      reactToApiError(err("subscription_required", { status: 402, details: { reason } }), { kind: "mutation" });
      assert.deepEqual(calls.replace, [`/pricing?reason=ended&redirect_url=${encodeURIComponent("/play?tc=blitz")}`], reason);
    }
    assert.equal(calls.errors.length, 0, "a 402 never toasts");
  });

  test("402 with meta.paywall = inline does not navigate; on /pricing it never loops", () => {
    reactToApiError(err("subscription_required", { status: 402 }), { kind: "query", meta: { paywall: "inline" } });
    path = "/pricing?reason=required";
    reactToApiError(err("subscription_required", { status: 402 }), { kind: "query" });
    assert.deepEqual(calls.replace, []);
  });

  test("402 payment_update_required invalidates me and stays put", () => {
    const qc = new QueryClient();
    qc.setQueryData(["me"], { user: {} });
    reactToApiError(err("payment_update_required", { status: 402 }), { kind: "mutation", queryClient: qc });
    assert.deepEqual(calls.replace, []);
    assert.equal(qc.getQueryState(["me"])?.isInvalidated, true);
    assert.equal(calls.errors.length, 0);
    qc.clear();
  });

  test("429 → nothing global", () => {
    reactToApiError(err("rate_limited", { status: 429, retryAfterSec: 30 }), { kind: "mutation" });
    reactToApiError(err("rate_limited", { status: 429, retryAfterSec: 30 }), { kind: "query" });
    assert.deepEqual([calls.guard, calls.replace, calls.errors, calls.warnings], [[], [], [], []]);
  });

  test("503 maintenance → breadcrumb + one warning toast", () => {
    reactToApiError(err("maintenance", { status: 503 }), { kind: "query" });
    assert.deepEqual(calls.breadcrumbs, ["maintenance"]);
    assert.deepEqual(calls.warnings, ["Down for maintenance, back soon"]);
  });

  test("mutation 500 → one error toast with the 8-char event id and a Retry action", () => {
    const retry = () => {};
    reactToApiError(err("internal", { status: 500, requestId: "7f3c2a91e04b4c1d" }), {
      kind: "mutation",
      meta: { verb: "save", object: "settings", retry },
    });
    assert.equal(calls.errors.length, 1);
    assert.equal(calls.errors[0]!.text, "Failed to save settings · Event 7f3c2a91");
    assert.equal(calls.errors[0]!.opts?.id, "err:settings");
    assert.equal(calls.errors[0]!.opts?.action?.label, "Retry");
  });

  test("mutation network error without a request id → toast without the event suffix", () => {
    reactToApiError(err("network"), { kind: "mutation" });
    assert.equal(calls.errors[0]!.text, "Failed to save changes");
  });

  test("meta.errorUi = inline → no toast", () => {
    reactToApiError(err("internal", { status: 500, requestId: "abc" }), { kind: "mutation", meta: { errorUi: "inline" } });
    assert.equal(calls.errors.length, 0);
  });

  test("queries and background refetches never toast a 5xx (inline ErrorState or silent)", () => {
    reactToApiError(err("internal", { status: 500 }), { kind: "query" });
    reactToApiError(err("unavailable", { status: 503 }), { kind: "background" });
    assert.equal(calls.errors.length, 0);
  });

  test("aborted and 4xx host codes do nothing", () => {
    for (const code of ["aborted", "validation_failed", "conflict", "forbidden", "not_found", "already_subscribed"] as const) {
      reactToApiError(err(code, { status: 400 }), { kind: "mutation" });
    }
    assert.deepEqual([calls.guard, calls.replace, calls.errors, calls.exceptions], [[], [], [], []]);
  });

  test("a non-ApiError is captured, not toasted", () => {
    reactToApiError(new TypeError("x is undefined"), { kind: "query" });
    assert.equal(calls.exceptions.length, 1);
    assert.equal(calls.errors.length, 0);
  });

  test("never reacts on the server", () => {
    delete g.window;
    reactToApiError(err("unauthorized", { status: 401 }), { kind: "query" });
    assert.equal(calls.guard.length, 0);
    g.window = {};
  });

  test("setApiErrorDeps returns an undo that restores only what it set", () => {
    const before = calls.guard.length;
    const undo = setApiErrorDeps({ sessionGuard: { onUnauthorized: () => {} } });
    reactToApiError(err("unauthorized", { status: 401 }), { kind: "query" });
    assert.equal(calls.guard.length, before);
    undo();
    reactToApiError(err("unauthorized", { status: 401 }), { kind: "query" });
    assert.equal(calls.guard.length, before + 1);
  });
});
