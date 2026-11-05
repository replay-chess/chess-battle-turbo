import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CLAIM_KEYS,
  NEW_USER_CLAIMS,
  claimsMatch,
  computeClaims,
  syncClerkClaimsDetailed,
  type ClaimsDeps,
  type ClaimsRecord,
  type RcPublicMetadata,
} from "./claims";

const NOW = new Date("2026-11-05T12:00:00Z");
const FUTURE = new Date("2026-12-05T12:00:00Z");
const PAST = new Date("2026-10-05T12:00:00Z");

function rec(overrides: Partial<ClaimsRecord> = {}): ClaimsRecord {
  return {
    onboarded: false,
    role: "USER",
    subscriptionId: null,
    subscriptionStatus: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    trialStartedAt: null,
    ...overrides,
  };
}

describe("computeClaims (plan §8.4)", () => {
  const cases: Array<[string, Partial<ClaimsRecord>, Partial<RcPublicMetadata>]> = [
    ["fresh user", {}, { entitled: false, lapsed: false, trialUsed: false }],
    ["active member", { subscriptionId: "sub", subscriptionStatus: "active", currentPeriodEnd: FUTURE }, { entitled: true, lapsed: false }],
    [
      "in trial",
      { subscriptionId: "sub", subscriptionStatus: "active", currentPeriodEnd: FUTURE, trialStartedAt: PAST },
      { entitled: true, lapsed: false, trialUsed: true },
    ],
    [
      "grace (on_hold, period not over)",
      { subscriptionId: "sub", subscriptionStatus: "on_hold", currentPeriodEnd: FUTURE },
      { entitled: true, lapsed: false },
    ],
    ["expired member", { subscriptionId: "sub", subscriptionStatus: "expired", currentPeriodEnd: PAST }, { entitled: false, lapsed: true }],
    [
      "trial ended without paying",
      { subscriptionId: null, subscriptionStatus: null, trialStartedAt: PAST },
      { entitled: false, lapsed: true, trialUsed: true },
    ],
    [
      "scheduled cancel still running",
      { subscriptionId: "sub", subscriptionStatus: "cancelled", cancelAtPeriodEnd: true, currentPeriodEnd: FUTURE },
      { entitled: true, lapsed: false },
    ],
    ["admin, onboarded", { role: "ADMIN", onboarded: true }, { role: "ADMIN", onboarded: true, entitled: false, lapsed: false }],
  ];
  for (const [name, overrides, expected] of cases) {
    it(name, () => {
      const claims = computeClaims(rec(overrides), NOW);
      assert.equal(claims.v, 1);
      for (const [k, v] of Object.entries(expected)) assert.equal(claims[k as keyof RcPublicMetadata], v, k);
    });
  }

  it("has exactly the claim keys, and stays small enough for the JWT (< 200 bytes)", () => {
    const claims = computeClaims(rec({ role: "ADMIN" }), NOW);
    assert.deepEqual(Object.keys(claims).sort(), [...CLAIM_KEYS].sort());
    assert.ok(JSON.stringify({ md: claims }).length < 200);
  });

  it("NEW_USER_CLAIMS equals the claims of a fresh row", () => {
    assert.deepEqual(computeClaims(rec(), NOW), { ...NEW_USER_CLAIMS });
  });
});

describe("claimsMatch", () => {
  const claims = computeClaims(rec(), NOW);
  it("ignores keys we do not own", () => {
    assert.equal(claimsMatch({ ...claims, other: "kept" }, claims), true);
  });
  it("detects a difference, a missing key and a non-object", () => {
    assert.equal(claimsMatch({ ...claims, entitled: true }, claims), false);
    const partial: Record<string, unknown> = { ...claims };
    delete partial.lapsed;
    assert.equal(claimsMatch(partial, claims), false);
    assert.equal(claimsMatch(null, claims), false);
    assert.equal(claimsMatch({}, claims), false);
  });
});

function deps(overrides: Partial<ClaimsDeps> & { metadata?: unknown } = {}) {
  const calls = { updates: [] as Array<[string, RcPublicMetadata]>, warnings: [] as Array<[string, Record<string, string>]> };
  const d: ClaimsDeps = {
    readUser: async () => ({ ...rec({ subscriptionId: "sub", subscriptionStatus: "active", currentPeriodEnd: FUTURE }), googleId: "user_1", isActive: true }),
    getMetadata: async () => overrides.metadata ?? {},
    updateMetadata: async (id, md) => void calls.updates.push([id, md]),
    warn: (m, c) => void calls.warnings.push([m, c]),
    now: () => NOW,
    ...overrides,
  };
  return { d, calls };
}

describe("syncClerkClaims", () => {
  it("writes when the claims differ", async () => {
    const { d, calls } = deps();
    assert.equal(await syncClerkClaimsDetailed(1n, d), "updated");
    assert.equal(calls.updates.length, 1);
    assert.equal(calls.updates[0]![0], "user_1");
    assert.equal(calls.updates[0]![1].entitled, true);
  });

  it("does not call updateUserMetadata when they already match", async () => {
    const claims = computeClaims(rec({ subscriptionId: "sub", subscriptionStatus: "active", currentPeriodEnd: FUTURE }), NOW);
    const { d, calls } = deps({ metadata: { ...claims, extra: 1 } });
    assert.equal(await syncClerkClaimsDetailed(1n, d), "unchanged");
    assert.equal(calls.updates.length, 0);
  });

  it("skips a missing or inactive user", async () => {
    assert.equal(await syncClerkClaimsDetailed(1n, deps({ readUser: async () => null }).d), "skipped");
    const inactive = deps({ readUser: async () => ({ ...rec(), googleId: "user_1", isActive: false }) });
    assert.equal(await syncClerkClaimsDetailed(1n, inactive.d), "skipped");
    assert.equal(inactive.calls.updates.length, 0);
  });

  it("never throws: a Clerk failure becomes the warning claims_sync_failed", async () => {
    const { d, calls } = deps({
      getMetadata: async () => {
        throw Object.assign(new Error("Not Found"), { status: 404 });
      },
    });
    assert.equal(await syncClerkClaimsDetailed(5n, d), "failed");
    assert.deepEqual(calls.warnings, [["claims_sync_failed", { user: "5", status: "404" }]]);
  });
});
