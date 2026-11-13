// A failed card (phase-04 plan §12.4 `onboarding/checkout-failed.spec.ts`; §4.6, §7.5.3, §8.5). @p4 @local-only
//
// 1. Dodo returns with `status=failed` (the mock declines this customer) → Plan with the bad banner, nothing charged.
// 2. A signed `payment.failed` (fixtures/dodo-webhook.ts) arrives while Activating polls → failed → Plan with the bad
//    banner; the user row records the failure.
// Project: desktop-1440.
import { paymentData, sendDodoWebhook } from "../../fixtures/dodo-webhook";
import { DEVICES, clickReady, expect, expectStep, gotoStep, stage, test, tid } from "./_lib/p04";

test.describe.configure({ mode: "serial" });
test.use(DEVICES["desktop-1440"]);

test("Dodo returns with status=failed → Plan with the bad banner", { tag: ["@p4", "@local-only"] }, async ({ page, leasePersona, upstream, telemetry }, testInfo) => {
  test.skip(testInfo.project.name === "webkit-iphone", "desktop only");
  test.setTimeout(180_000);
  const me = await leasePersona("onboarding-plan");
  await upstream.dodoFor(me.email, { decline: true });
  await gotoStep(page, "plan");
  await clickReady(page, "onb-start-checkout");
  await expect(page).toHaveURL(/\/onboarding\/plan\?(.*&)?status=failed/, { timeout: 60_000 });
  await expect(tid(page, "onb-plan-failed")).toBeVisible();
  await expect(tid(page, "onb-plan-failed")).toContainText("Nothing was charged");
  await expect(stage(page, "plan")).toHaveAttribute("data-state", "default");
  await telemetry.expect("checkout_activation_failed", { source: "onboarding" }, { source: "client" });
});

test("a signed payment.failed while Activating polls → failed → Plan", { tag: ["@p4", "@local-only"] }, async ({ page, leasePersona, upstream, request, p4db }, testInfo) => {
  test.skip(testInfo.project.name === "webkit-iphone", "desktop only");
  test.setTimeout(180_000);
  const me = await leasePersona("onboarding-plan");
  await upstream.dodoFor(me.email, { webhook: false, pendingUntilWebhook: true });
  await gotoStep(page, "plan");
  await expectStep(page, "plan");
  await clickReady(page, "onb-start-checkout");
  await expect(page).toHaveURL(/\/onboarding\/activating\?/, { timeout: 60_000 });
  await expect(stage(page, "activating")).toHaveAttribute("data-state", "polling");
  const subscriptionId = new URL(page.url()).searchParams.get("subscription_id");
  const session = (await upstream.state()).sessions.find((s) => s.subscriptionId === subscriptionId);
  expect(session, "the mock's session for this checkout").toBeTruthy();
  const res = await sendDodoWebhook(
    request,
    "payment.failed",
    paymentData({ clerkUserId: me.clerkUserId, customerId: session!.customerId, email: me.email, subscriptionId, checkoutSessionId: session!.id, totalAmount: 0, errorCode: "CARD_DECLINED" }),
  );
  expect(res.status, res.body).toBe(200);
  await expect(page).toHaveURL(/\/onboarding\/plan\?(.*&)?status=failed/, { timeout: 30_000 });
  await expect(tid(page, "onb-plan-failed")).toBeVisible();
  const [row] = await p4db.$queryRaw<{ reason: string | null }[]>`SELECT "lastPaymentFailureReason" AS reason FROM users WHERE email = ${me.email}`;
  expect(row?.reason).toBe("card_declined");
});
