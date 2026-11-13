// Provisioning writes the letter users' Clerk claims only when they differ (e2e/scripts/provision-test-users.ts
// `claimsToWrite`, `syncFixtureClaims`; phase-04 plan §3 "provision-test-users.ts onboarded columns").
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { claimsToWrite, onboardedFields, syncFixtureClaims } from "../scripts/provision-test-users";

const NOW = new Date("2026-11-12T10:00:00Z");
const MEMBER = {
  onboarded: true,
  role: "USER",
  subscriptionId: "e2e_x",
  subscriptionStatus: "active",
  currentPeriodEnd: new Date("2027-11-12T10:00:00Z"),
  cancelAtPeriodEnd: false,
  trialStartedAt: null,
};

describe("provision-test-users: onboarded columns and claims", () => {
  it("onboardedFields: onboarded, DONE, onboardedAt", () => {
    assert.deepEqual(onboardedFields(NOW), { onboarded: true, onboardingStep: "DONE", onboardedAt: NOW });
  });

  it("claimsToWrite: the full claim set when Clerk lacks or differs, null when it matches", () => {
    const claims = claimsToWrite(MEMBER, {}, NOW);
    assert.deepEqual(claims, { v: 1, onboarded: true, entitled: true, lapsed: false, trialUsed: false, role: "USER" });
    assert.equal(claimsToWrite(MEMBER, { ...claims, other: "kept by Clerk's merge" }, NOW), null);
    assert.deepEqual(claimsToWrite(MEMBER, { ...claims, onboarded: false }, NOW)?.onboarded, true);
  });

  it("syncFixtureClaims: development key only; one lookup, PATCH only the users whose claims differ", async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    const rows: Record<string, typeof MEMBER & { googleId: string }> = {
      "a@x.test": { ...MEMBER, googleId: "user_a" },
      "b@x.test": { ...MEMBER, googleId: "user_b" },
    };
    const db = { user: { findUnique: async ({ where }: { where: { email: string } }) => rows[where.email] ?? null } } as never;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET", body: init?.body as string | undefined });
      if (!init?.method) {
        return new Response(
          JSON.stringify([
            { id: "user_a", public_metadata: {}, email_addresses: [{ email_address: "a@x.test" }] },
            { id: "user_b", public_metadata: claimsToWrite(MEMBER, {}, NOW), email_addresses: [{ email_address: "b@x.test" }] },
          ]),
        );
      }
      return new Response("{}");
    }) as typeof fetch;
    assert.equal(await syncFixtureClaims(db, ["a@x.test", "b@x.test"], NOW, { key: "sk_live_x", fetchImpl }), 0, "never a production key");
    assert.equal(calls.length, 0);
    assert.equal(await syncFixtureClaims(db, ["a@x.test", "b@x.test"], NOW, { key: "sk_test_x", fetchImpl }), 1);
    assert.equal(calls.filter((c) => c.method === "GET").length, 1);
    const patches = calls.filter((c) => c.method === "PATCH");
    assert.equal(patches.length, 1);
    assert.match(patches[0]!.url, /\/users\/user_a\/metadata$/);
    assert.equal(JSON.parse(patches[0]!.body!).public_metadata.onboarded, true);
  });
});
