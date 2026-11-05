import { test as base, type Page, type BrowserContext, type Browser } from "@playwright/test";
import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";

type PlayerFixture = { context: BrowserContext; page: Page };

type AuthFixtures = {
  authedPage: Page;
  /** Signed in as E2E user R, who has no membership and has never had a trial. */
  nonMemberPage: Page;
  playerA: PlayerFixture;
  playerB: PlayerFixture;
  playerC: PlayerFixture;
  playerD: PlayerFixture;
  playerE: PlayerFixture;
  playerF: PlayerFixture;
  playerG: PlayerFixture;
  playerH: PlayerFixture;
  playerI: PlayerFixture;
  playerJ: PlayerFixture;
  playerK: PlayerFixture;
  playerL: PlayerFixture;
  playerM: PlayerFixture;
  playerN: PlayerFixture;
  playerO: PlayerFixture;
  playerP: PlayerFixture;
};

/**
 * GET /api/me (it provisions a first-time user, plan §8.5) and, for a user who
 * has not finished onboarding, POST /api/user/onboarding-skip (stays until P4).
 * Retries 5xx and 429 a few times: a busy `next dev` or Neon wake-up answers
 * 500/502/503 now and then. Replaces the Phase 0 POST /api/user/sync (CT X17).
 */
export async function ensureViewerOnboarded(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    let last = 0;
    for (let attempt = 0; attempt < 4; attempt++) {
      const meRes = await fetch("/api/me", { headers: { Accept: "application/json" }, cache: "no-store" });
      last = meRes.status;
      if (meRes.status >= 500 || meRes.status === 429) {
        await delay(1000 * (attempt + 1));
        continue;
      }
      if (!meRes.ok) throw new Error(`GET /api/me failed: ${meRes.status}`);
      const body = (await meRes.json()) as { data?: { user?: { onboarded?: boolean } } };
      if (body.data?.user?.onboarded === false) {
        const skipRes = await fetch("/api/user/onboarding-skip", { method: "POST" });
        if (!skipRes.ok) throw new Error(`Onboarding skip failed: ${skipRes.status}`);
      }
      return;
    }
    throw new Error(`GET /api/me failed after 4 attempts (last status ${last})`);
  });
}

export async function signIn(page: Page, email: string, password: string) {
  await setupClerkTestingToken({ page });
  // Retry goto once — dev server may be compiling
  try {
    await page.goto("/", { timeout: 60_000, waitUntil: "domcontentloaded" });
  } catch {
    await page.waitForTimeout(2000);
    await page.goto("/", { timeout: 60_000, waitUntil: "domcontentloaded" });
  }
  // Ticket-based sign-in (a sign-in token minted with CLERK_SECRET_KEY). It
  // signs the test user in directly, so Clerk's Device Trust second factor
  // never interrupts automated runs. `password` stays in the signature for
  // callers that still pass it.
  void password;
  await clerk.signIn({ page, emailAddress: email });

  // Make sure the users row exists and onboarding is done, through the API:
  // far more reliable than waiting for UI redirects under parallel load.
  await ensureViewerOnboarded(page);

  // If we landed on onboarding page, navigate away now that it's been skipped via API
  if (page.url().includes("/onboarding")) {
    await page.goto("/", { timeout: 60_000, waitUntil: "domcontentloaded" });
  }
}

function playerFixture(envKey: string) {
  return async ({ browser }: { browser: Browser }, use: (r: PlayerFixture) => Promise<void>) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(page, process.env[`E2E_USER_${envKey}_EMAIL`]!, process.env[`E2E_USER_${envKey}_PASSWORD`]!);
    await use({ context, page });
    await context.close();
  };
}

export const test = base.extend<AuthFixtures>({
  nonMemberPage: async ({ page }, use) => {
    test.skip(!process.env.E2E_USER_R_EMAIL, "E2E_USER_R (non-member) not provisioned");
    await signIn(page, process.env.E2E_USER_R_EMAIL!, process.env.E2E_USER_R_PASSWORD!);
    await use(page);
  },
  authedPage: async ({ page }, use) => {
    await signIn(page, process.env.E2E_USER_A_EMAIL!, process.env.E2E_USER_A_PASSWORD!);
    await use(page);
  },

  playerA: playerFixture("A"),
  playerB: playerFixture("B"),
  playerC: playerFixture("C"),
  playerD: playerFixture("D"),
  playerE: playerFixture("E"),
  playerF: playerFixture("F"),
  playerG: playerFixture("G"),
  playerH: playerFixture("H"),
  playerI: playerFixture("I"),
  playerJ: playerFixture("J"),
  playerK: playerFixture("K"),
  playerL: playerFixture("L"),
  playerM: playerFixture("M"),
  playerN: playerFixture("N"),
  playerO: playerFixture("O"),
  playerP: playerFixture("P"),
});

export { expect } from "@playwright/test";
