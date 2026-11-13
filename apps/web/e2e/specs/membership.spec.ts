import { test, expect } from "../fixtures";
import { UPSTREAM_URL } from "../mocks/upstream-client";

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
    // P3 (phase-03 plan §12.5): the same rule on the review API (the legacy route above goes at H4).
    const review = await page.request.get("/api/review/cnotarealgameref00000000aa");
    if (sub.entitled || sub.paywall === false) {
      // Members get a plain 404 for games that don't exist or aren't theirs.
      expect(res.status()).toBe(404);
      expect(review.status()).toBe(404);
      expect((await review.json()).error.code).toBe("not_found");
    } else {
      expect(res.status()).toBe(402);
      expect((await res.json()).code).toBe("subscription_required");
      expect(review.status()).toBe(402);
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
    // P3: the review API and the archive answer 402 trial_available (phase-03 plan §11.1, §12.5).
    for (const path of ["/api/review/cnotarealgameref00000000aa", "/api/me/games"]) {
      const p3 = await page.request.get(path);
      expect(p3.status(), path).toBe(402);
      expect(((await p3.json()) as { error: { details?: { reason?: string } } }).error.details?.reason, path).toBe("trial_available");
    }

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

  // Phase 4 (phase-04 plan §7.5.1, §12.7): the checkout body names its `source` and carries an Idempotency-Key; the
  // answer is enveloped and says when the card is charged (`chargeDate`, the trial's end) and to where it returns
  // (/checkout/activating for a pricing checkout). Locally and in CI the Dodo REST API is the upstream mock
  // (DODO_API_BASE_URL, test builds only); against the dev site it is Dodo test mode itself (https).
  test("checkout is created with the free trial (Dodo test mode)", async ({ nonMemberPage: page }) => {
    test.skip(process.env.DODO_PAYMENTS_ENVIRONMENT !== "test_mode", "Only against Dodo test mode");
    const key = crypto.randomUUID();
    const res = await page.request.post("/api/checkout", {
      data: { plan: "monthly", source: "pricing", returnPath: "/pricing" },
      headers: { "Idempotency-Key": key },
    });
    expect(res.status()).toBe(200);
    const { data } = (await res.json()) as {
      data: { checkoutUrl: string; sessionId: string; trial: boolean; chargeDate: string | null; interval: string; currency: string };
    };
    expect(data.trial).toBe(true);
    expect(data.interval).toBe("month");
    expect(data.currency).toBe("USD");
    const days = (Date.parse(data.chargeDate ?? "") - Date.now()) / 86_400_000;
    expect(days, "the card is charged when the 7-day trial ends").toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7.01);
    // A local run's web server talks to the upstream mock (playwright.config.ts); a deployed site to Dodo test mode.
    if (!process.env.E2E_BASE_URL) expect(data.checkoutUrl.startsWith(UPSTREAM_URL), "the upstream mock's hosted checkout").toBe(true);
    else expect(data.checkoutUrl).toMatch(/^https:\/\//);
    // A replay with the same key answers the same checkout (no second session).
    const again = await page.request.post("/api/checkout", {
      data: { plan: "monthly", source: "pricing", returnPath: "/pricing" },
      headers: { "Idempotency-Key": key },
    });
    expect(again.status()).toBe(200);
    expect(((await again.json()) as { data: { checkoutUrl: string } }).data.checkoutUrl).toBe(data.checkoutUrl);
    expect(again.headers()["idempotent-replayed"]).toBe("true");
  });

  // R is read-only (testing X4): the checkout above recorded a pending checkout on R's row; put R back as it was, so
  // no other spec sees a pending checkout (the `/pricing` activating banner, the resolver's abandoned-checkout rule).
  test.afterAll(async () => {
    const email = process.env.E2E_USER_R_EMAIL;
    const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
    if (!email || !url) return;
    const { PrismaClient } = await import("@repo/db");
    const db = new PrismaClient({ datasourceUrl: url });
    try {
      await db.$executeRaw`UPDATE users SET "pendingCheckoutSessionId" = NULL, "pendingCheckoutPlan" = NULL, "pendingCheckoutAt" = NULL,
        "lastCheckoutSource" = NULL, "trialOfferedAt" = NULL WHERE email = ${email}`;
    } finally {
      await db.$disconnect();
    }
  });
});
