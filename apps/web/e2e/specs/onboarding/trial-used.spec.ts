// A returning sign-up whose free trial was used (phase-04 plan §12.4 `onboarding/trial-used.spec.ts`; §8.4). @p4
//
// Persona `onboarding-trial-used` (at Plan, Chess.com linked and waiting, the trial used 60 days ago and its ledger row
// written; Q stays read-only): Welcome's row 04 says "Start your membership" with no "7 DAYS FREE"; Plan's h1 is
// "Start your membership.", the CTA "Start Coaching", the timeline has no "Day 8" row; the checkout POST answers
// `trial: false` and the session the mock receives has no trial days. Project: desktop-1440.
import {
  DEVICES,
  clickReady,
  expect,
  expectStep,
  gotoStep,
  noDocumentScroll,
  stage,
  test,
  tid,
} from "./_lib/p04";

test.describe.configure({ mode: "serial" });
test.use(DEVICES["desktop-1440"]);

test(
  "trial used: membership copy, no Day 8, a paid checkout",
  { tag: ["@p4", "@local-only", "@state:V3OnbPlan.default", "@state:V3OnbWelcome.default"] },
  async ({ page, leasePersona, upstream, telemetry }, testInfo) => {
    test.skip(testInfo.project.name === "webkit-iphone", "desktop only");
    test.setTimeout(180_000);
    const me = await leasePersona("onboarding-trial-used");
    // The browser must not leave for the mock's hosted page here: the spec reads the checkout answer and stops.
    await upstream.dodoFor(me.email, { webhook: false });

    await gotoStep(page, "welcome");
    await expectStep(page, "welcome");
    const row = tid(page, "onb-welcome-trial-row");
    await expect(row).toContainText("Start your membership");
    await expect(row).not.toContainText("7 DAYS FREE");

    await gotoStep(page, "plan");
    await expectStep(page, "plan");
    await expect(stage(page, "plan")).toHaveAttribute("data-state", "default");
    await expect(page.locator("h1").filter({ visible: true }).first()).toHaveText("Start your membership.");
    await expect(tid(page, "onb-start-checkout")).toHaveText(/Start Coaching/);
    await expect(page.locator('[data-testid^="onb-plan-timeline-"]:visible')).not.toContainText("Day 8");
    await noDocumentScroll(page);
    await telemetry.expect("onb_plan_viewed", { is_trial_eligible: false }, { source: "client" });

    // Stop at Dodo: the checkout answer is what this spec checks.
    await page.route("**/dodo/pay/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Dodo</title><p>held</p>" }));
    // The page leaves for the checkout URL at once, so the answer is read where it passes (route.fetch).
    let resolveBody: (b: { status: number; body: { data?: { trial?: boolean; checkoutUrl?: string } } }) => void = () => {};
    const answered = new Promise<{ status: number; body: { data?: { trial?: boolean; checkoutUrl?: string } } }>((r) => (resolveBody = r));
    await page.route("**/api/checkout", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      const response = await route.fetch();
      resolveBody({ status: response.status(), body: (await response.json()) as never });
      await route.fulfill({ response });
    });
    await clickReady(page, "onb-start-checkout");
    const res = await answered;
    expect(res.status).toBe(200);
    const body = res.body;
    expect(body.data?.trial).toBe(false);
    const state = await upstream.state();
    const session = state.sessions.find((s) => body.data?.checkoutUrl?.endsWith(s.id));
    expect(session, "the mock received the checkout session").toBeTruthy();
    expect(session!.trialDays, "no trial on the session").toBe(0);
    await telemetry.expect("checkout_started", { source: "onboarding", is_trial: false }, { source: "client", count: 1 });
  },
);
