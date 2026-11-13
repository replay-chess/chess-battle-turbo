// Real Dodo hosted checkout, test mode (phase-04 plan §12.4 `checkout/dodo-hosted.spec.ts`; owner test §1.1). @p4
// @dodo-hosted
//
// Nightly only (`nightly.yml` job `dodo-hosted`, `--grep @dodo-hosted`, retries 2, quarantinable): against the
// deployed dev site (E2E_BASE_URL) whose web app talks to Dodo TEST mode (never live; never DODO_API_BASE_URL, which
// a non-test build refuses) and whose dev webhook endpoint Dodo calls. Persona `onboarding-plan` (at Plan, the trial
// available) → Start trial → Dodo's hosted checkout → the test card 4242 4242 4242 4242 (Dodo test mode's success
// card, `testing-and-go-live` guide) → back on /onboarding/activating → `success` through the real webhook (or the
// poll / Dodo self-heal) → Continue → Done.
//
// Every other spec skips it (`grepInvert` in the main config's default runs does not include @dodo-hosted, see
// playwright.config.ts), and it skips itself unless E2E_BASE_URL names a deployed site and DODO_HOSTED=1.
import type { Frame, Locator, Page } from "@playwright/test";
import { DEVICES, clickReady, expect, expectStep, gotoStep, stage, test } from "../onboarding/_lib/p04";

test.describe.configure({ mode: "serial", retries: 2 });
test.use(DEVICES["desktop-1440"]);

const BASE = process.env.E2E_BASE_URL ?? "";
const REMOTE = /^https:\/\//.test(BASE);

/** The first visible match of `name` (a label or placeholder) on the page or in any of its frames. */
async function field(page: Page, name: RegExp): Promise<Locator> {
  const scopes: (Page | Frame)[] = [page, ...page.frames()];
  for (let attempt = 0; attempt < 30; attempt++) {
    for (const scope of scopes) {
      for (const loc of [scope.getByLabel(name), scope.getByPlaceholder(name)]) {
        if ((await loc.count()) > 0 && (await loc.first().isVisible())) return loc.first();
      }
    }
    await page.waitForTimeout(1_000);
    scopes.splice(0, scopes.length, page, ...page.frames());
  }
  throw new Error(`Dodo checkout: no field matching ${name}`);
}

test(
  "Dodo test-mode hosted checkout with 4242 activates the trial on the dev site",
  { tag: ["@p4", "@dodo-hosted"] },
  async ({ page, leasePersona }) => {
    test.skip(!REMOTE || process.env.DODO_HOSTED !== "1", "nightly dodo-hosted job only (E2E_BASE_URL=https://… and DODO_HOSTED=1)");
    test.setTimeout(300_000);
    await leasePersona("onboarding-plan");
    await gotoStep(page, "plan");
    await expectStep(page, "plan");
    await clickReady(page, "onb-start-checkout");
    await page.waitForURL((url) => /dodopayments\.com$/.test(url.hostname) || url.hostname.endsWith(".dodopayments.com"), { timeout: 60_000 });

    await (await field(page, /card number/i)).fill("4242 4242 4242 4242");
    await (await field(page, /expir|MM ?\/ ?YY/i)).fill("12 / 34");
    await (await field(page, /cvc|cvv|security code/i)).fill("123");
    const holder = await field(page, /cardholder|name on card|full name/i).catch(() => null);
    if (holder) await holder.fill("Replay Chess E2E");
    await page.getByRole("button", { name: /pay|subscribe|start trial|confirm/i }).first().click();

    await page.waitForURL(/\/onboarding\/activating\?/, { timeout: 120_000 });
    await expect(stage(page, "activating")).toHaveAttribute("data-state", "success", { timeout: 120_000 });
    await clickReady(page, "onb-activating-continue");
    await expectStep(page, "done");
  },
);
