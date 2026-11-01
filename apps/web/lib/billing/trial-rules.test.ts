import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TRIAL_DAYS,
  isInTrial,
  isTrialEligible,
  trialDaysLeft,
  trialFieldsFromSnapshot,
} from "./trial-rules";

const now = new Date("2026-11-01T12:00:00Z");
const day = 24 * 60 * 60 * 1000;

test("trial is 7 days", () => {
  assert.equal(TRIAL_DAYS, 7);
});

test("a brand-new user is eligible for the trial", () => {
  assert.equal(isTrialEligible({ trialStartedAt: null, trialEndsAt: null, subscriptionId: null }), true);
});

test("a user who started a trial is never eligible again, even after cancelling", () => {
  assert.equal(
    isTrialEligible({ trialStartedAt: new Date(now.getTime() - 30 * day), trialEndsAt: null, subscriptionId: null }),
    false,
  );
});

test("a user who ever held a subscription is not eligible", () => {
  assert.equal(isTrialEligible({ trialStartedAt: null, trialEndsAt: null, subscriptionId: "sub_1" }), false);
});

test("isInTrial is true only inside the window", () => {
  const rec = { trialStartedAt: new Date(now.getTime() - 2 * day), trialEndsAt: new Date(now.getTime() + 5 * day) };
  assert.equal(isInTrial(rec, now), true);
  assert.equal(isInTrial(rec, new Date(now.getTime() + 6 * day)), false);
  assert.equal(isInTrial({ trialStartedAt: null, trialEndsAt: null }, now), false);
});

test("days left rounds up and never goes negative", () => {
  assert.equal(trialDaysLeft(new Date(now.getTime() + 5 * day), now), 5);
  assert.equal(trialDaysLeft(new Date(now.getTime() + 4.2 * day), now), 5);
  assert.equal(trialDaysLeft(new Date(now.getTime() + 60_000), now), 1);
  assert.equal(trialDaysLeft(new Date(now.getTime() - day), now), 0);
  assert.equal(trialDaysLeft(null, now), 0);
});

test("first trial snapshot records start and end from Dodo dates", () => {
  const fields = trialFieldsFromSnapshot(
    { trialStartedAt: null },
    { trial_period_days: 7, created_at: "2026-11-01T00:00:00Z", next_billing_date: "2026-11-08T00:00:00Z" },
  );
  assert.deepEqual(fields, {
    trialStartedAt: new Date("2026-11-01T00:00:00Z"),
    trialEndsAt: new Date("2026-11-08T00:00:00Z"),
  });
});

test("snapshot without a trial records nothing", () => {
  assert.equal(
    trialFieldsFromSnapshot({ trialStartedAt: null }, { trial_period_days: 0, next_billing_date: "2026-12-01T00:00:00Z" }),
    null,
  );
});

test("an already-recorded trial is never moved by later snapshots", () => {
  assert.equal(
    trialFieldsFromSnapshot(
      { trialStartedAt: new Date("2026-10-01T00:00:00Z") },
      { trial_period_days: 7, created_at: "2026-11-01T00:00:00Z", next_billing_date: "2026-11-08T00:00:00Z" },
    ),
    null,
  );
});

test("a subscription is in trial only inside its trial window", async () => {
  const { isSubscriptionInTrial } = await import("./trial-rules");
  const created = "2026-11-01T00:00:00Z";
  assert.equal(isSubscriptionInTrial({ trial_period_days: 7, created_at: created }, new Date("2026-11-05T00:00:00Z")), true);
  assert.equal(isSubscriptionInTrial({ trial_period_days: 7, created_at: created }, new Date("2026-11-08T00:00:01Z")), false);
  assert.equal(isSubscriptionInTrial({ trial_period_days: 0, created_at: created }, new Date("2026-11-02T00:00:00Z")), false);
  assert.equal(isSubscriptionInTrial({ trial_period_days: 7, created_at: null }), false);
});
