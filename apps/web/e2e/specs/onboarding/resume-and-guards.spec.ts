// Resume and guards (phase-04 plan §12.4 `onboarding/resume-and-guards.spec.ts`; §8.1, D4-13, D4-16, D4-29). @p4
//
// - Stop at Goals: a reload and `/onboarding` both land on Goals; Alt+← goes to Level with the chosen band kept.
// - A deep link to /onboarding/done while not entitled → Plan.
// - An abandoned checkout (pending for more than 30 minutes) → Plan with the info banner. The resolver is a server
//   page, which reads the server's own clock (P1's `x-rc-now` reaches route() handlers only), so the spec backdates
//   `pendingCheckoutAt` by 31 minutes instead of moving the clock (testing X5's intent: no real wait).
// - Member A on /onboarding → /games; a fresh persona on /games → /onboarding (Welcome); middleware's own redirect
//   (`?redirect_url=/games` and `rc_onb_next`) needs the claims in the session token.
// - regression: confirm-level-prefetch — That's Me reaches Level in a production build (Confirm used to prefetch
//   Level while the stored step was LINK and the router replayed the cached redirect to Link).
// Projects: desktop-1440 and ipad-portrait.
import { signIn } from "../../fixtures/auth";
import { letterEmail } from "../../fixtures/users";
import {
  DEVICES,
  clickReady,
  expect,
  expectStep,
  gotoStep,
  hideDevOverlay,
  stage,
  test,
  tid,
  uniqueHandle,
  userRow,
  waitHydrated,
} from "./_lib/p04";

test.describe.configure({ mode: "serial" });

for (const variant of [
  { name: "desktop", device: "desktop-1440" as const, boards: "V3" },
  { name: "ipad", device: "ipad-portrait" as const, boards: "V3iPad" },
]) {
  test.describe(`resume and guards · ${variant.name}`, () => {
    test.use(DEVICES[variant.device]);
    // eslint-disable-next-line no-empty-pattern -- Playwright needs a destructuring pattern here
    test.beforeEach(({}, testInfo) => {
      test.skip(testInfo.project.name === "webkit-iphone", "chromium projects only");
    });

    test(
      `stop at Goals: reload, /onboarding and Alt+← keep the place (${variant.name})`,
      { tag: ["@p4", "@local-only", `@state:${variant.boards}OnbGoals.none_selected`, `@state:${variant.boards}OnbRating.manual`] },
      async ({ page, leasePersona, p4db }) => {
      test.setTimeout(180_000);
      const me = await leasePersona("onboarding-fresh");
      await gotoStep(page, "");
      await clickReady(page, "onb-get-started");
      await expectStep(page, "link");
      await clickReady(page, "onb-skip");
      await expectStep(page, "level");
      await expect(stage(page, "level")).toHaveAttribute("data-state", "manual");
      const band = tid(page, "onb-band-picker").getByRole("radio").nth(2);
      await waitHydrated(page, '[data-testid="onb-band-picker"] [role="radio"]');
      await band.click();
      await expect(band).toHaveAttribute("aria-checked", "true");
      const chosen = (await band.textContent())?.trim() ?? "";
      await clickReady(page, "onb-continue");
      await expectStep(page, "goals");
      expect((await userRow(p4db, me.email)).step).toBe("GOALS");

      // No goal picked: the none_selected state (Continue explains instead of advancing).
      await waitHydrated(page, '[data-testid="onb-goal-chips"] button');
      const pressed = tid(page, "onb-goal-chips").locator('button[aria-pressed="true"]');
      for (let n = await pressed.count(); n > 0; n = await pressed.count()) {
        await pressed.first().click();
        await expect(pressed).toHaveCount(n - 1);
      }
      await expect(stage(page, "goals")).toHaveAttribute("data-state", "none_selected");
      await tid(page, "onb-goal-chips").locator("button").first().click();
      await expect(stage(page, "goals")).toHaveAttribute("data-state", "default");

      await page.reload();
      await expectStep(page, "goals");
      await gotoStep(page, "");
      await expectStep(page, "goals");

      await waitHydrated(page, '[data-testid="onb-continue"]');
      await page.locator("body").click({ position: { x: 2, y: 2 } }).catch(() => undefined);
      await page.keyboard.press("Alt+ArrowLeft");
      await expectStep(page, "level");
      await expect(tid(page, "onb-band-picker").getByRole("radio", { checked: true })).toHaveText(chosen);
      },
    );

    test(
      `deep links: Done before the trial → Plan; yearly; an abandoned checkout → Plan with the banner (${variant.name})`,
      { tag: ["@p4", "@local-only", `@state:${variant.boards}OnbPlan.yearly`] },
      async ({ page, leasePersona, p4db, upstream }) => {
      test.setTimeout(180_000);
      const me = await leasePersona("onboarding-plan");
      await gotoStep(page, "done");
      await expectStep(page, "plan");
      // The billing period: yearly, kept in the URL.
      await waitHydrated(page, '[data-testid="onb-plan-period"] [role="radio"]');
      await tid(page, "onb-plan-period").getByRole("radio").filter({ hasText: /year/i }).click();
      await expect(tid(page, "onb-plan-period").getByRole("radio", { checked: true })).toContainText(/year/i);
      await expect(page).toHaveURL(/plan=yearly/);

      // Start a checkout and abandon it at Dodo (the hosted page never returns).
      await upstream.dodoFor(me.email, { webhook: false });
      await page.route("**/dodo/pay/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Dodo</title><p>left here</p>" }));
      await clickReady(page, "onb-start-checkout");
      await expect(page).toHaveURL(/\/dodo\/pay\//, { timeout: 60_000 });
      const pending = await userRow(p4db, me.email);
      expect(pending.pendingCheckoutAt, "the checkout is pending").not.toBeNull();
      // Fresh (< 30 min): Activating is where the member belongs.
      await gotoStep(page, "");
      await expectStep(page, "activating");
      // 31 minutes later: abandoned.
      await p4db.$executeRaw`UPDATE users SET "pendingCheckoutAt" = now() - interval '31 minutes' WHERE email = ${me.email}`;
      await gotoStep(page, "");
      await expect(page).toHaveURL(/\/onboarding\/plan\?(.*&)?resume=abandoned/, { timeout: 60_000 });
      await expect(tid(page, "onb-plan-abandoned")).toBeVisible();
      },
    );
  });
}

test("member A on /onboarding → /home (P5); a fresh persona on /games → /onboarding", { tag: ["@p4"] }, async ({ page, leasePersona, browser }, testInfo) => {
  test.skip(testInfo.project.name === "webkit-iphone", "chromium only");
  test.setTimeout(180_000);
  await leasePersona("onboarding-fresh");
  const res = await page.goto("/games", { waitUntil: "domcontentloaded" });
  expect(res?.ok()).toBe(true);
  await expect(page).toHaveURL(/\/onboarding\/welcome/);

  const member = await browser.newContext(DEVICES["desktop-1440"]);
  const memberPage = await member.newPage();
  try {
    await hideDevOverlay(memberPage);
    await signIn(memberPage, letterEmail("A"), "");
    await memberPage.goto("/onboarding", { waitUntil: "domcontentloaded" });
    // DEFAULT_DESTINATION is Home since P5 (phase-05 plan §4.8).
    await expect(memberPage).toHaveURL(/\/home(\?|$)/, { timeout: 60_000 });
  } finally {
    await member.close();
  }
});

test("regression: confirm-level-prefetch (That's Me reaches Level)", { tag: ["@p4", "@local-only"] }, async ({ page, leasePersona }, testInfo) => {
  test.skip(testInfo.project.name === "webkit-iphone", "chromium only");
  test.setTimeout(180_000);
  await leasePersona("onboarding-fresh");
  await gotoStep(page, "");
  await clickReady(page, "onb-get-started");
  await expectStep(page, "link");
  await tid(page, "onb-username").fill(uniqueHandle("owlreg", testInfo));
  await clickReady(page, "onb-lookup");
  await expect(tid(page, "onb-found")).toBeVisible({ timeout: 30_000 });
  await clickReady(page, "onb-continue");
  await expectStep(page, "confirm");
  await expect(stage(page, "confirm")).toHaveAttribute("data-state", "default", { timeout: 30_000 });
  // Give a prefetch time to land before That's Me (the defect replayed it).
  await page.waitForLoadState("networkidle");
  await clickReady(page, "onb-thats-me");
  await expectStep(page, "level");
});

// D4-29: middleware's onboarding rule redirects with `?redirect_url=` and stores `rc_onb_next`. It reads the claims
// from the session token (`md`, the Clerk session-token template `{"md": "{{user.public_metadata}}"}`, P1 Q-06), so
// the token must carry them: the first assertion says so plainly when the Clerk instance lacks the template.
test("middleware sends a not-onboarded member to /onboarding?redirect_url= and stores rc_onb_next", { tag: ["@p4"] }, async ({ page, leasePersona }, testInfo) => {
  test.skip(testInfo.project.name === "webkit-iphone", "chromium only");
  test.setTimeout(120_000);
  await leasePersona("onboarding-fresh");
  const session = (await page.context().cookies()).find((c) => /^__session/.test(c.name));
  const claims = session ? (JSON.parse(Buffer.from(session.value.split(".")[1] ?? "", "base64url").toString()) as { md?: unknown }) : {};
  expect(claims.md, "the session token carries `md` (Clerk session-token template, P1 Q-06)").toEqual(expect.objectContaining({ onboarded: false }));
  const res = await page.goto("/games", { waitUntil: "domcontentloaded" });
  const chain: string[] = [];
  for (let r = res?.request() ?? null; r; r = r.redirectedFrom()) chain.unshift(new URL(r.url()).pathname + new URL(r.url()).search);
  expect(chain).toContain("/onboarding?redirect_url=%2Fgames");
  const next = (await page.context().cookies()).find((c) => c.name === "rc_onb_next");
  expect(next, "middleware stored where to go after onboarding").toBeTruthy();
  expect(decodeURIComponent(next!.value)).toBe("/games");
  expect(next!.httpOnly).toBe(true);
});
