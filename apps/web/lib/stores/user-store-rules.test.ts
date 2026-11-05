import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Entitlement, MeData } from "@repo/contracts/http/me";
import {
  USER_STORE_VERSION,
  legacySubscriptionOf,
  migrateUserStore,
  storeUserFromMe,
  subscriptionFromEntitlement,
  type StoreSubscription,
  type StoreUser,
} from "./user-store-rules";

function entitlement(overrides: Partial<Entitlement> = {}): Entitlement {
  return {
    state: "member",
    member: true,
    entitled: true,
    paywall: true,
    planKey: "monthly",
    interval: "month",
    priceCents: 1200,
    status: "active",
    currentPeriodEnd: "2026-12-05T00:00:00.000Z",
    cancelAtPeriodEnd: false,
    trial: { active: false, used: true, endsAt: null, daysLeft: null, eligible: false },
    paymentIssue: null,
    hasBillingPortal: true,
    ...overrides,
  };
}

function me(overrides: { user?: Partial<MeData["user"]>; entitlement?: Partial<Entitlement> } = {}): MeData {
  return {
    user: {
      ref: "usr_ref_1",
      code: "ABC123",
      name: "Ada",
      email: "ada@example.test",
      avatarUrl: null,
      role: "user",
      onboarded: true,
      ratingLabel: null,
      ...overrides.user,
    },
    entitlement: entitlement(overrides.entitlement),
    flags: {},
    buildId: "dev",
  };
}

const V1_USER: StoreUser = {
  referenceId: "usr_ref_1",
  code: "ABC123",
  email: "ada@example.test",
  name: "Ada",
  profilePictureUrl: "https://img.example.test/a.png",
  onboarded: true,
  role: "USER",
  clerkUserId: "user_clerk_1",
  stats: {
    referenceId: "st_1",
    totalGamesPlayed: 3,
    gamesWon: 2,
    gamesLost: 1,
    gamesDrawn: 0,
    currentWinStreak: 1,
    longestWinStreak: 2,
    averageGameDuration: null,
    lastPlayedAt: null,
  },
  chessComProfile: null,
};

describe("storeUserFromMe", () => {
  it("maps MeData.user onto the legacy shape", () => {
    const user = storeUserFromMe(me({ user: { role: "admin", avatarUrl: "https://a" } }), "user_clerk_1", null);
    assert.deepEqual(user, {
      referenceId: "usr_ref_1",
      code: "ABC123",
      email: "ada@example.test",
      name: "Ada",
      profilePictureUrl: "https://a",
      onboarded: true,
      role: "ADMIN",
      clerkUserId: "user_clerk_1",
      stats: null,
      chessComProfile: null,
    });
  });

  it("keeps stats only for the same user", () => {
    assert.deepEqual(storeUserFromMe(me(), "user_clerk_1", V1_USER).stats, V1_USER.stats);
    assert.equal(storeUserFromMe(me({ user: { ref: "usr_other" } }), "user_clerk_2", V1_USER).stats, null);
  });

  it("carries onboarded=false through (UserSync's onboarding redirect reads it)", () => {
    assert.equal(storeUserFromMe(me({ user: { onboarded: false } }), "c", null).onboarded, false);
  });
});

describe("subscriptionFromEntitlement", () => {
  it("mirrors a member's entitlement", () => {
    const sub = subscriptionFromEntitlement(entitlement(), null);
    assert.equal(sub.plan, "player");
    assert.equal(sub.entitled, true);
    assert.equal(sub.paywall, true);
    assert.equal(sub.status, "active");
    assert.equal(sub.trialEligible, false);
    assert.deepEqual(sub.trial, { active: false, used: true, endsAt: null, daysLeft: 0 });
    assert.deepEqual(sub.subscription, {
      id: "",
      status: "active",
      productId: "",
      nextBillingDate: "2026-12-05T00:00:00.000Z",
      planKey: "monthly",
      interval: "month",
      priceCents: 1200,
    });
  });

  it("mirrors a never-paid viewer without a nested subscription", () => {
    const sub = subscriptionFromEntitlement(
      entitlement({
        state: "none",
        member: false,
        entitled: false,
        planKey: null,
        interval: null,
        priceCents: null,
        status: null,
        currentPeriodEnd: null,
        trial: { active: false, used: false, endsAt: null, daysLeft: null, eligible: true },
      }),
      null,
    );
    assert.equal(sub.plan, null);
    assert.equal(sub.entitled, false);
    assert.equal(sub.trialEligible, true);
    assert.equal(sub.subscription, undefined);
  });

  it("keeps the ids the viewer does not carry from the current value", () => {
    const current: StoreSubscription = {
      plan: "player",
      entitled: true,
      subscriptionId: "sub_1",
      customerId: "cus_1",
      subscription: { id: "sub_1", status: "active", productId: "prod_1", nextBillingDate: "x" },
    };
    const sub = subscriptionFromEntitlement(entitlement({ cancelAtPeriodEnd: true }), current);
    assert.equal(sub.subscriptionId, "sub_1");
    assert.equal(sub.customerId, "cus_1");
    assert.equal(sub.subscription?.id, "sub_1");
    assert.equal(sub.subscription?.productId, "prod_1");
    assert.equal(sub.cancelAtPeriodEnd, true);
  });

  it("an admin with the paywall off passes the client gate through paywall=false", () => {
    assert.equal(subscriptionFromEntitlement(entitlement({ entitled: false, paywall: false }), null).paywall, false);
  });
});

describe("legacySubscriptionOf", () => {
  it("accepts the SubscriptionResponse shape", () => {
    const legacy = { plan: "player", entitled: true, paywall: true, trialEligible: false };
    assert.equal(legacySubscriptionOf(legacy), legacy);
    assert.deepEqual(legacySubscriptionOf({ plan: null, entitled: false }), { plan: null, entitled: false });
  });

  it("rejects anything else", () => {
    assert.equal(legacySubscriptionOf(null), null);
    assert.equal(legacySubscriptionOf("x"), null);
    assert.equal(legacySubscriptionOf({ plan: "player" }), null);
    assert.equal(legacySubscriptionOf({ plan: 3, entitled: true }), null);
  });
});

describe("migrateUserStore (persisted v1 → v2)", () => {
  it("is version 2", () => {
    assert.equal(USER_STORE_VERSION, 2);
  });

  it("drops the persisted subscription, including the fake negative a failed fetch wrote (AC #4)", () => {
    const v1 = { user: V1_USER, subscription: { plan: null, entitled: false }, lastSyncedAt: 1_700_000_000_000 };
    const v2 = migrateUserStore(v1, 0);
    assert.deepEqual(Object.keys(v2).sort(), ["lastSyncedAt", "user"]);
    assert.deepEqual(v2.user, V1_USER);
    assert.equal(v2.lastSyncedAt, 1_700_000_000_000);
  });

  it("drops a user that cannot be tied to a Clerk account (fetchUserByEmail wrote clerkUserId '')", () => {
    assert.equal(migrateUserStore({ user: { ...V1_USER, clerkUserId: "" } }, 0).user, null);
    assert.equal(migrateUserStore({ user: { referenceId: "x" } }, 1).user, null);
  });

  it("normalises the role and missing optional fields", () => {
    const { user } = migrateUserStore(
      { user: { ...V1_USER, role: "SUPERUSER", profilePictureUrl: undefined, stats: undefined } },
      0,
    );
    assert.equal(user?.role, "USER");
    assert.equal(user?.profilePictureUrl, null);
    assert.equal(user?.stats, null);
  });

  it("survives garbage and empty snapshots", () => {
    assert.deepEqual(migrateUserStore(undefined, 0), { user: null, lastSyncedAt: null });
    assert.deepEqual(migrateUserStore("nope", 0), { user: null, lastSyncedAt: null });
    assert.deepEqual(migrateUserStore({ user: null, lastSyncedAt: "x" }, 1), { user: null, lastSyncedAt: null });
  });

  it("does not trust a snapshot from a newer version", () => {
    assert.deepEqual(migrateUserStore({ user: V1_USER, lastSyncedAt: 1 }, 3), { user: null, lastSyncedAt: null });
  });
});
