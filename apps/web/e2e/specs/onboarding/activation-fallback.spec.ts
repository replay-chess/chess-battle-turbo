// Activation without the socket (phase-04 plan §12.4 `onboarding/activation-fallback.spec.ts`; §8.5.3). @p4 @local-only
//
// The socket is unreachable (`routeWebSocket` closes it; its HTTP long-poll transport is aborted too), so only the
// activation poll can see the trial start. The mock's subscription reads `pending` until its webhook arrives
// (`pendingUntilWebhook`), so the app's Dodo self-heal cannot answer early either.
// 1. The webhook after 4 s → success through the poll (`via: "poll"`).
// 2. The webhook after 15 s → `stalled` at 12 s → Check Again → success when the webhook lands.
// Project: desktop-1440.
import type { Page } from "@playwright/test";
import { DEVICES, clickReady, expect, expectStep, gotoStep, stage, stateTag, test } from "./_lib/p04";

test.describe.configure({ mode: "serial" });
test.use(DEVICES["desktop-1440"]);

async function cutSocket(page: Page): Promise<void> {
  await page.routeWebSocket(/socket\.io/, (ws) => ws.close());
  await page.route(/\/socket\.io\//, (route) => route.abort());
}

async function startCheckout(page: Page): Promise<void> {
  await gotoStep(page, "plan");
  await expectStep(page, "plan");
  await clickReady(page, "onb-start-checkout");
  await expect(page).toHaveURL(/\/onboarding\/activating\?/, { timeout: 60_000 });
}

test(
  "the webhook after 4 s: success through the poll (no socket)",
  { tag: ["@p4", "@local-only", stateTag("desktop", "activating", "polling"), stateTag("desktop", "activating", "success")] },
  async ({ page, leasePersona, upstream, telemetry }, testInfo) => {
    test.skip(testInfo.project.name === "webkit-iphone", "desktop only");
    test.setTimeout(180_000);
    const me = await leasePersona("onboarding-plan");
    await upstream.dodoFor(me.email, { webhookDelayMs: 4_000, pendingUntilWebhook: true, webhook: true });
    await cutSocket(page);
    await startCheckout(page);
    await expect(stage(page, "activating")).toHaveAttribute("data-state", "polling");
    await expect(stage(page, "activating")).toHaveAttribute("data-state", "success", { timeout: 30_000 });
    await telemetry.expect("checkout_activation_succeeded", { via: "poll", source: "onboarding" }, { source: "client", count: 1 });
  },
);

test(
  "the webhook after 15 s: stalled at 12 s, Check Again, then success",
  { tag: ["@p4", "@local-only", stateTag("desktop", "activating", "stalled")] },
  async ({ page, leasePersona, upstream, telemetry }, testInfo) => {
    test.skip(testInfo.project.name === "webkit-iphone", "desktop only");
    test.setTimeout(180_000);
    const me = await leasePersona("onboarding-plan");
    await upstream.dodoFor(me.email, { webhookDelayMs: 15_000, pendingUntilWebhook: true, webhook: true });
    await cutSocket(page);
    const started = Date.now();
    await startCheckout(page);
    await expect(stage(page, "activating")).toHaveAttribute("data-state", "polling");
    await expect(stage(page, "activating")).toHaveAttribute("data-state", "stalled", { timeout: 20_000 });
    expect(Date.now() - started, "stalled no earlier than 12 s after the return").toBeGreaterThanOrEqual(11_000);
    await telemetry.expect("checkout_activation_stalled", { source: "onboarding" }, { source: "client", count: 1 });
    await clickReady(page, "onb-check-again");
    await telemetry.expect("checkout_check_again_clicked", { source: "onboarding" }, { source: "client" });
    await expect(stage(page, "activating")).toHaveAttribute("data-state", "success", { timeout: 30_000 });
    await clickReady(page, "onb-activating-continue");
    await expectStep(page, "done");
  },
);
