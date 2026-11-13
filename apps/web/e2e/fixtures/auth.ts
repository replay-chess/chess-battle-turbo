import { test as base, type Page, type BrowserContext, type Browser, type Request } from "@playwright/test";
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

type MeBody = { data?: { user?: { onboarded?: boolean } } };

/**
 * GET /api/me (it provisions a first-time user, plan §8.5) and reports whether the viewer finished onboarding.
 * Retries 5xx and 429 a few times: a busy `next dev` or Neon wake-up answers 500/502/503 now and then. Replaces the
 * Phase 0 POST /api/user/sync (CT X17). Makes no onboarding call (phase-04 plan §3, testing X17): the letter users
 * are provisioned onboarded (e2e/scripts/provision-test-users.ts), pool users get their persona's state, and the
 * fresh-user fixture walks the real onboarding.
 */
export async function ensureViewer(page: Page): Promise<{ onboarded: boolean }> {
  return page.evaluate(async () => {
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
      const body = (await meRes.json()) as MeBody;
      return { onboarded: body.data?.user?.onboarded !== false };
    }
    throw new Error(`GET /api/me failed after 4 attempts (last status ${last})`);
  });
}

/**
 * Mints a fresh session token so it carries the claims Clerk holds now (after a provisioning or persona write changed
 * `publicMetadata`; a session token otherwise keeps its claims until it refreshes, ≤ 60 s). Only `getToken({skipCache})`:
 * a `session.reload()` racing clerk-js's own refresh logs "@clerk/nextjs: Invalid state" (a console-guard failure).
 */
export async function refreshSessionClaims(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const clerk = (window as unknown as { Clerk?: { session?: { getToken?: (o: { skipCache: boolean }) => Promise<unknown> } } }).Clerk;
    await clerk?.session?.getToken?.({ skipCache: true });
  });
}

/**
 * A registered fixture user (letters A–S, the admin, a pool user) whose row says "not onboarded" (a fresh database:
 * the first sign-in just created it) is provisioned onboarded the way provision-test-users.ts does it (the row's
 * onboarding columns and the Clerk claims; `ensureUnentitledRow` creates pool rows onboarded too), then the session
 * reloads its claims. A P4 persona leased afterwards writes its own onboarding state over it. Throwaway users are
 * refused: they walk the real onboarding (fresh-user fixture) or a spec provisions them explicitly.
 */
async function provisionLetterOnboarded(page: Page, email: string): Promise<void> {
  const { roleOfEmail } = await import("./users");
  const role = roleOfEmail(email);
  if (role === null || role === "throwaway") {
    throw new Error(`${email} is not onboarded and is not a registered fixture user: use the fresh-user fixture`);
  }
  await markOnboardedForE2E(email);
  await refreshSessionClaims(page);
}

/**
 * Marks one E2E user onboarded through the database and Clerk (provision-test-users `provisionOnboarded`): for the
 * letter users, and for the throwaway users of flows that need an onboarded account without walking onboarding
 * (tournament joiners). Guarded like the persona tool: a local Postgres or the Neon dev branch only.
 */
export async function markOnboardedForE2E(email: string): Promise<void> {
  const { PrismaClient } = await import("@repo/db");
  const { provisionOnboarded } = await import("../scripts/provision-test-users");
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("DIRECT_URL / DATABASE_URL is not set: source apps/web/.env.test (never production)");
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "::1"].includes(host) && !/^ep-fancy-dust-b8b3dp81(-pooler)?\./.test(host)) {
    throw new Error(`refusing to provision onboarding columns on ${host}: only a local Postgres or the Neon dev branch`);
  }
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    await provisionOnboarded(db, email);
  } finally {
    await db.$disconnect();
  }
}

/**
 * Linux WebKit (WPE/GTK, libsoup) refuses cookies with `Domain=localhost`, and
 * clerk-js writes `__client_uat` with exactly that domain on http://localhost
 * (its cookie-domain probe returns the bare hostname for localhost). The
 * host-only `__session` is stored and `__client_uat` is not, so Clerk's backend
 * sees "session token but no client_uat" and treats every fetch and RSC request
 * as signed out (`GET /api/me` → 401). Chromium and macOS WebKit accept the
 * domain cookie, and no real deployment is served from bare `localhost`, so
 * only the Linux CI runner is affected (sign-off D3).
 *
 * Test-only shim: on WebKit at http://localhost, `document.cookie` writes drop a
 * `Domain=localhost` attribute, so the cookie is stored host-only, which is what
 * Chromium effectively does. Clerk's own writes, refreshes and removals then
 * behave as they do in Chromium. (Adding a host-only `__client_uat` from the
 * test does not work: clerk-js deletes it on its next client update.)
 * Reproduced and verified in the Playwright 1.58.2 Linux image (FIX-B).
 */
export async function allowLocalhostDomainCookies(page: Page): Promise<void> {
  const context = page.context();
  if (context.browser()?.browserType().name() !== "webkit") return;
  if ((context as { __rcLocalhostCookieShim?: boolean }).__rcLocalhostCookieShim) return;
  (context as { __rcLocalhostCookieShim?: boolean }).__rcLocalhostCookieShim = true;
  await context.addInitScript(() => {
    if (location.hostname !== "localhost") return;
    const desc = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");
    if (!desc?.get || !desc.set) return;
    const { get, set } = desc;
    Object.defineProperty(Document.prototype, "cookie", {
      configurable: true,
      enumerable: desc.enumerable,
      get() {
        return get.call(this);
      },
      set(value: string) {
        set.call(this, String(value).replace(/;\s*domain=\.?localhost\s*(?=;|$)/gi, ""));
      },
    });
  });
}

async function waitForClerk(page: Page): Promise<void> {
  const loaded = () =>
    page.waitForFunction(() => (window as unknown as { Clerk?: { loaded?: boolean } }).Clerk?.loaded === true, null, {
      timeout: 45_000,
    });
  try {
    await loaded();
  } catch {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
    await loaded();
  }
}

export type SignInOptions = {
  /**
   * "letter" (default): a registered fixture user (letter, admin, pool) must be onboarded; a fresh row is
   * provisioned onboarded (above).
   * "as-is": leave the account's onboarding state alone (pool personas, the fresh-user fixture, tournament joiners
   * that call markOnboardedForE2E themselves).
   */
  onboarding?: "letter" | "as-is";
  /** Where to land after the sign-in (default "/"; "as-is" users who are not onboarded stay wherever that leads). */
  landing?: string;
};

export async function signIn(page: Page, email: string, password: string, opts: SignInOptions = {}) {
  await allowLocalhostDomainCookies(page);
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
  // @clerk/testing's signIn waits for window.Clerk with a short internal timeout; on a busy `next dev` or a cold
  // Vercel function the script can take longer, which failed the fixture now and then ("window.Clerk undefined",
  // FIX-B). Wait for it here with a real budget, reloading once if it never shows.
  await waitForClerk(page);
  const viewerReads = pendingViewerReads(page);
  await clerk.signIn({ page, emailAddress: email });

  // Make sure the users row exists (GET /api/me provisions it): far more reliable than waiting for UI redirects
  // under parallel load. A letter user whose fresh row is not onboarded is provisioned onboarded (no onboarding call).
  const viewer = await ensureViewer(page);
  if (!viewer.onboarded && (opts.onboarding ?? "letter") === "letter") await provisionLetterOnboarded(page, email);

  // A not-yet-onboarded letter user was sent to /onboarding by middleware before the provisioning: go on.
  const landing = opts.landing ?? "/";
  if (page.url().includes("/onboarding") && (opts.onboarding ?? "letter") === "letter") {
    await page.goto(landing, { timeout: 60_000, waitUntil: "domcontentloaded" });
  } else if (opts.landing && new URL(page.url()).pathname !== opts.landing) {
    await page.goto(landing, { timeout: 60_000, waitUntil: "domcontentloaded" });
  }
  // The signed-in page reads the viewer (UserSync's GET /api/me). A spec that navigates on at once leaves the page
  // while that read is in flight, and WebKit logs the refused load as a page error ("…/api/me due to access control
  // checks."), failing the console guard of a test that did nothing wrong (regression: webkit-signin-me-abort).
  await viewerReads.settled();
}

/**
 * Tracks the page's in-flight GET /api/me; `settled()` waits (≤ 15 s) until none is left, then stops tracking.
 *
 * It first lets the page go quiet (`networkidle`, ≤ 10 s): UserSync's read starts only once Clerk has loaded on the
 * page, so an empty set right after the landing did not mean "no read": the read began a moment later and the spec's
 * next navigation cut it, which WebKit reports as "…/api/me due to access control checks." (lichess.spec on Linux
 * WebKit, about 1 run in 15; Clerk's own FAPI fetches were cut and reported the same way). The app cannot avoid
 * that report: WebKit cuts the loads before the old document sees `beforeunload` or `pagehide` (aborting the reads
 * from those events was tried and changed nothing, 6 of 30 runs still failed).
 */
export function pendingViewerReads(page: Page) {
  const pending = new Set<Request>();
  const isMe = (r: Request) => new URL(r.url()).pathname === "/api/me";
  const onRequest = (r: Request) => void (isMe(r) && pending.add(r));
  const onDone = (r: Request) => void pending.delete(r);
  page.on("request", onRequest);
  page.on("requestfinished", onDone);
  page.on("requestfailed", onDone);
  return {
    async settled(timeoutMs = 15_000) {
      const until = Date.now() + timeoutMs;
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
      while (pending.size > 0 && Date.now() < until) await page.waitForTimeout(50);
      page.off("request", onRequest);
      page.off("requestfinished", onDone);
      page.off("requestfailed", onDone);
    },
  };
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
