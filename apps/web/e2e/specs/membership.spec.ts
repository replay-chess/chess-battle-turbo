import { test, expect } from "../fixtures";

/**
 * Phase 0 regression, signed in: the subscription API reports the trial
 * state, and member-only APIs respond according to entitlement.
 *
 * Test users may or may not be entitled depending on how they were
 * provisioned (see e2e/scripts/provision-test-users.ts --entitle), so each
 * assertion checks the branch that applies to the current user.
 */
test.describe("Membership and trial", () => {
  test("subscription API reports trial eligibility and trial state", async ({ authedPage: page }) => {
    const res = await page.request.get("/api/subscription");
    expect(res.ok()).toBeTruthy();
    const sub = await res.json();

    expect(typeof sub.trialEligible).toBe("boolean");
    expect(sub.trial).toEqual(
      expect.objectContaining({
        active: expect.any(Boolean),
        used: expect.any(Boolean),
        daysLeft: expect.any(Number),
      }),
    );
    // Someone who used a trial, or ever subscribed, never gets another one.
    if (sub.trial.used || sub.subscriptionId) expect(sub.trialEligible).toBe(false);
    if (sub.trial.active) {
      expect(sub.entitled).toBe(true);
      expect(sub.trial.daysLeft).toBeGreaterThanOrEqual(1);
      expect(sub.trial.daysLeft).toBeLessThanOrEqual(7);
    }
  });

  test("pricing CTA matches the user's trial eligibility", async ({ authedPage: page }) => {
    const sub = await (await page.request.get("/api/subscription")).json();
    test.skip(sub.entitled, "Members see the subscriber view, not the offer");

    await page.goto("/pricing");
    const cta = page.getByTestId("pricing-subscribe");
    await expect(cta).toBeVisible({ timeout: 30_000 });
    if (sub.trialEligible) {
      await expect(cta).toHaveText(/start 7-day free trial/i);
      await expect(page.getByTestId("pricing-trial-terms")).toContainText("you won't be charged");
    } else {
      await expect(cta).toHaveText(/start coaching/i);
      await expect(page.getByTestId("pricing-trial-terms")).toContainText("free trial has been used");
    }
  });

  test("game reviews are members-only and private to the players", async ({ authedPage: page }) => {
    const sub = await (await page.request.get("/api/subscription")).json();
    const res = await page.request.get("/api/analysis/not-a-real-game");
    if (sub.entitled || sub.paywall === false) {
      // Members get a plain 404 for games that don't exist or aren't theirs.
      expect(res.status()).toBe(404);
    } else {
      expect(res.status()).toBe(402);
      expect((await res.json()).code).toBe("subscription_required");
    }
  });
});

test.describe("Non-member (never had a trial)", () => {
  test("is offered the 7-day trial and blocked from member APIs", async ({ nonMemberPage: page }) => {
    const sub = await (await page.request.get("/api/subscription")).json();
    expect(sub.entitled).toBe(false);
    expect(sub.trialEligible).toBe(true);
    expect(sub.trial.used).toBe(false);

    const review = await page.request.get("/api/analysis/not-a-real-game");
    expect(review.status()).toBe(402);
    expect((await review.json()).code).toBe("subscription_required");

    // P2: bot games are created through POST /api/games (create-ai-game is gone); member-only, Idempotency-Key required.
    const play = await page.request.post("/api/games", {
      data: { mode: "BOT", start: { kind: "initial" } },
      headers: { "Idempotency-Key": crypto.randomUUID() },
    });
    expect(play.status()).toBe(402);
  });

  test("pricing shows the trial CTA with the cancel-by date", async ({ nonMemberPage: page }) => {
    await page.goto("/pricing");
    await expect(page.getByTestId("pricing-subscribe")).toHaveText(/start 7-day free trial/i, {
      timeout: 30_000,
    });
    await expect(page.getByTestId("pricing-trial-terms")).toContainText("you won't be charged");
  });

  test("checkout is created with the free trial (Dodo test mode)", async ({ nonMemberPage: page }) => {
    test.skip(process.env.DODO_PAYMENTS_ENVIRONMENT !== "test_mode", "Only against Dodo test mode");
    const res = await page.request.post("/api/checkout", { data: { plan: "monthly", returnPath: "/pricing" } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.trial).toBe(true);
    expect(body.checkoutUrl).toMatch(/^https:\/\//);
  });
});
