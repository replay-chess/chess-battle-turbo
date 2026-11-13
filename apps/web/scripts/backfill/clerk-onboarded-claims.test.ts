import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeClaims } from "../../lib/auth/claims";
import { CLERK_API, CLERK_SPACING_MS, assertClerkKey, clerkHttpApi, planClaims } from "./clerk-onboarded-claims";

const NOW = new Date("2026-11-12T10:00:00Z");

function row(id: bigint, googleId: string, extra: Partial<Parameters<typeof computeClaims>[0]> = {}) {
  return {
    id,
    googleId,
    onboarded: true,
    role: "USER",
    subscriptionId: null,
    subscriptionStatus: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    trialStartedAt: null,
    ...extra,
  };
}

describe("B12 planClaims", () => {
  it("writes users whose onboarded claim is not true; counts claimed and unknown users", () => {
    const member = row(2n, "user_b", { subscriptionId: "sub_1", subscriptionStatus: "active", currentPeriodEnd: new Date("2026-12-01T00:00:00Z") });
    const plan = planClaims(
      [row(1n, "user_a"), member, row(3n, "user_c"), row(4n, "user_d"), row(5n, "user_gone")],
      [
        { id: "user_a", public_metadata: { onboarded: true, v: 1 } },
        { id: "user_b", public_metadata: { onboarded: false, entitled: true } },
        { id: "user_c", public_metadata: {} },
        { id: "user_d", public_metadata: { onboarded: "true" } },
      ],
      NOW,
    );
    assert.equal(plan.claimed, 1);
    assert.equal(plan.missingInClerk, 1);
    assert.deepEqual(plan.updates.map((u) => u.clerkUserId), ["user_b", "user_c", "user_d"]);
    assert.deepEqual(plan.updates[0]!.claims, { v: 1, onboarded: true, entitled: true, lapsed: false, trialUsed: false, role: "USER" });
    assert.ok(plan.updates.every((u) => u.claims.onboarded === true), "the full claim set, onboarded true");
  });

  it("is idempotent: after the merge nothing is left", () => {
    const first = planClaims([row(1n, "user_a")], [{ id: "user_a", public_metadata: {} }], NOW);
    const merged = { ...first.updates[0]!.claims, other: "kept" };
    assert.equal(planClaims([row(1n, "user_a")], [{ id: "user_a", public_metadata: merged }], NOW).updates.length, 0);
  });
});

describe("B12 Clerk key guard", () => {
  it("development keys anywhere; production keys only in the listed and confirmed P13 window", () => {
    assert.equal(assertClerkKey("sk_test_x", "neon-dev", undefined), "development");
    assert.equal(assertClerkKey("sk_test_x", "local", undefined), "development");
    assert.throws(() => assertClerkKey("sk_live_x", "neon-dev", "production"), /production key/);
    assert.throws(() => assertClerkKey("sk_live_x", "listed", undefined), /CLAIMS_BACKFILL_CONFIRM/);
    assert.equal(assertClerkKey("sk_live_x", "listed", "production"), "production");
    assert.throws(() => assertClerkKey(undefined, "local", undefined), /not set/);
    assert.throws(() => assertClerkKey("", "local", undefined), /not set/);
  });
});

describe("B12 Clerk HTTP client", () => {
  it("looks users up by id, merges metadata with PATCH, spaces calls to 5 per second", async () => {
    const calls: { url: string; method: string; body?: string; auth: string | null }[] = [];
    const waits: number[] = [];
    const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push({ url: String(input), method: init?.method ?? "GET", body: init?.body as string | undefined, auth: headers.get("authorization") });
      const body = String(input).includes("/users?") ? [{ id: "user_a", public_metadata: {} }] : { id: "user_a" };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const api = clerkHttpApi({ key: "sk_test_k", fetchImpl: fakeFetch, sleepImpl: async (ms) => void waits.push(ms) });
    assert.deepEqual(await api.listUsers(["user_a", "user_b"]), [{ id: "user_a", public_metadata: {} }]);
    await api.mergePublicMetadata("user_a", { v: 1, onboarded: true, entitled: false, lapsed: false, trialUsed: false, role: "USER" });
    assert.deepEqual(await api.listUsers([]), []);
    assert.equal(calls.length, 2, "an empty lookup makes no call");
    assert.equal(calls[0]!.url, `${CLERK_API}/users?limit=2&user_id=user_a&user_id=user_b`);
    assert.equal(calls[1]!.url, `${CLERK_API}/users/user_a/metadata`);
    assert.equal(calls[1]!.method, "PATCH");
    assert.deepEqual(JSON.parse(calls[1]!.body!), {
      public_metadata: { v: 1, onboarded: true, entitled: false, lapsed: false, trialUsed: false, role: "USER" },
    });
    assert.ok(calls.every((c) => c.auth === "Bearer sk_test_k"));
    assert.equal(waits.length, 1, "the second call waited");
    assert.ok(waits[0]! > 0 && waits[0]! <= CLERK_SPACING_MS);
  });

  it("errors name the endpoint without the user id or the key", async () => {
    const api = clerkHttpApi({
      key: "sk_test_secret",
      fetchImpl: (async () => new Response("no", { status: 429 })) as typeof fetch,
      sleepImpl: async () => {},
    });
    await assert.rejects(api.mergePublicMetadata("user_2abcDEF", {} as never), (e: Error) => {
      assert.equal(e.message, "Clerk PATCH /users/user_…/metadata: 429");
      return true;
    });
  });
});
