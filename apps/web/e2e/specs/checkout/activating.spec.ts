// Checkout activating (phase-04 plan §12.4 `checkout/activating.spec.ts`; §4.9, §7.5, §8.5). @p4 @local-only
//
// The one flow with a brand-new Clerk user (fixtures/fresh-user.ts): signed up, provisioned onboarded (the row's
// onboarding columns and the Clerk claims, as provision-test-users.ts does it; completing onboarding through its API
// needs a membership, which is what this flow buys), not a member, never trialled. From /pricing the checkout
// (`source: "pricing"`) goes to the mock's hosted page, which returns to /checkout/activating?source=pricing&…; the
// mock's signed `subscription.active` webhook lands → success → the countdown pauses while focus is inside the card
// and resumes when it leaves → the member arrives at the destination. Telemetry: `checkout_started`,
// `checkout_activation_succeeded`. Projects: desktop-1440 and iphone (`@smoke`).
import { markOnboardedForE2E, refreshSessionClaims } from "../../fixtures/auth";
import { DEVICES, FAMILY_DEVICE, expect, gotoOk, noDocumentScroll, skipOtherEngines, test, waitHydrated } from "../onboarding/_lib/p04";

test.describe.configure({ mode: "serial" });

for (const family of ["desktop", "iphone"] as const) {
  test.describe(`checkout activating · ${family}`, () => {
    test.use(DEVICES[FAMILY_DEVICE[family]]);

    test(
      `pricing → hosted checkout → activating → success → destination (${family})`,
      { tag: ["@p4", "@local-only", "@smoke", ...(family === "desktop" ? ["@state:V3CheckoutActivating.polling", "@state:V3CheckoutActivating.success"] : [])] },
      async ({ page, freshUser, upstream, telemetry }, testInfo) => {
        const skip = skipOtherEngines(testInfo, family);
        test.skip(skip !== null, skip ?? "");
        test.setTimeout(240_000);
        const user = await freshUser.create(`checkout-${family}`);
        await freshUser.signIn(page, user);
        await markOnboardedForE2E(user.email);
        await refreshSessionClaims(page);
        // The webhook comes 3 s after the return: `polling` is on screen first.
        await upstream.dodoFor(user.email, { webhookDelayMs: 3_000, pendingUntilWebhook: true });

        await gotoOk(page, "/pricing");
        const cta = page.getByTestId("pricing-subscribe").filter({ visible: true }).first();
        await expect(cta).toHaveText(/start 7-day free trial/i, { timeout: 60_000 });
        await waitHydrated(page, '[data-testid="pricing-subscribe"]');
        await cta.click();

        await expect(page).toHaveURL(/\/checkout\/activating\?(.*&)?source=pricing/, { timeout: 60_000 });
        // Plan §1 step 25: the return names /pricing as the destination (regression: D15, no redirect_url at all).
        expect(new URL(page.url()).searchParams.get("redirect_url")).toBe("/pricing");
        const card = page.getByTestId("activation-card");
        await expect(card).toHaveAttribute("data-state", "polling");
        await noDocumentScroll(page);
        await expect(card).toHaveAttribute("data-state", "success", { timeout: 60_000 });

        // The destination is where Continue (and the countdown) goes: the return path, here /pricing itself (the user is
        // onboarded).
        const cont = page.getByTestId("activation-continue").filter({ visible: true }).first();
        const destination = (await cont.getAttribute("href"))!;
        expect(destination).toBe("/pricing");
        // Focus inside the card holds the countdown; leaving it lets the countdown run out.
        const line = page.getByTestId("activation-state-line");
        await cont.focus();
        const held = await line.textContent();
        await page.waitForTimeout(2_500);
        await expect(page).toHaveURL(/\/checkout\/activating/);
        expect(await line.textContent(), "the countdown does not move while focus is inside").toBe(held);
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await expect(page).toHaveURL((url) => `${url.pathname}${url.search}` === destination || url.pathname === destination.split("?")[0], { timeout: 20_000 });

        await telemetry.expect("checkout_started", { source: "pricing", is_trial: true }, { source: "client", count: 1 });
        await telemetry.expect("checkout_activation_succeeded", { source: "pricing", is_trial: true }, { source: "client", count: 1 });
      },
    );
  });
}
