// Phase 4 e2e fixtures (phase-04 plan §12.4; WP-H). Every spec under e2e/specs/{onboarding,accounts,checkout,archive}
// imports `test` and `expect` from here:
//
//   test("…", async ({ page, leasePersona, telemetry, upstream }) => {
//     const me = await leasePersona("onboarding-fresh");   // pool user, reset to the persona, signed in on `page`
//     await gotoStep(page, "welcome");
//     await telemetry.expect("onb_step_viewed", { step: "welcome" });
//   });
//
// - `leasePersona(name)` (named so P1's users.test.ts lint sees which persona a file leases): signs `page` in as this
//   worker's pool user (GET /api/me provisions a fresh row), resets it to the P4 persona (e2e/personas/p04.ts through
//   scripts/dev/personas.ts: the billing, onboarding, links, runs, imported games and the Clerk claims), then reloads
//   the session's claims, so middleware sees the persona at once. Returns the login, the user ref and the Clerk id.
// - `freshUser` (fixtures/fresh-user.ts): only checkout/activating.spec.ts uses it.
// - `serverNow` (fixtures/time.ts), `telemetry` (fixtures/telemetry.ts; console guard included), `request`.
// - `upstream` (mocks/upstream-client.ts): the mock's state, faults and per-customer Dodo controls.
// - `p4db` (worker): Prisma on the e2e database (a local Postgres or the Neon dev branch, never anything else).
//
// The mock-dependent specs are `@local-only` (skipped against a deployed site, testing X2); the paywall is on in every
// P4 project (playwright.config.ts, testing X3).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { mergeTests, type Locator, type Page, type TestInfo } from "@playwright/test";
import type { PrismaClient } from "@repo/db";
import { test as authTest, pendingViewerReads, refreshSessionClaims, signIn } from "../../../fixtures/auth";
import { test as freshTest } from "../../../fixtures/fresh-user";
import { leasePersona as resetPoolPersona } from "../../../fixtures/lease";
import { expect, test as telemetryTest } from "../../../fixtures/telemetry";
import { test as timeTest } from "../../../fixtures/time";
import { poolEmail, poolSlot } from "../../../fixtures/users";
import { upstream as upstreamClient } from "../../../mocks/upstream-client";
import type { P04PersonaName } from "../../../personas/p04";
import { DEVICES, type DeviceName } from "../../review/_lib/devices";
import { e2eDatabaseUrl, gotoOk, hideDevOverlay } from "../../review/_lib/review";

export { expect, DEVICES, type DeviceName, gotoOk, hideDevOverlay };

// ── Boards and tags (docs/qa/design-states.json, P4; plan §4.12) ────────────────────────────────────────────────────

export type OnbStep = "welcome" | "link" | "confirm" | "level" | "goals" | "plan" | "activating" | "done";
export type Family = "desktop" | "iphone" | "ipad";

const BOARD_SUFFIX: Record<OnbStep, string> = {
  welcome: "OnbWelcome",
  link: "OnbLink",
  confirm: "OnbPreview",
  level: "OnbRating",
  goals: "OnbGoals",
  plan: "OnbPlan",
  activating: "OnbActivating",
  done: "OnbDone",
};
const FAMILY_PREFIX: Record<Family, string> = { desktop: "V3", iphone: "V3iPhone", ipad: "V3iPad" };

/** `V3OnbLink`, `V3iPhoneOnbPreview`, … */
export function onbBoard(family: Family, step: OnbStep): string {
  return `${FAMILY_PREFIX[family]}${BOARD_SUFFIX[step]}`;
}

/** `@state:<Board>.<state>` for real data on a real route. */
export function stateTag(family: Family, step: OnbStep, state: string): string {
  return `@state:${onbBoard(family, step)}.${state}`;
}

/** The device each family's real-route specs run on (the plan's projects column). */
export const FAMILY_DEVICE: Record<Family, DeviceName> = { desktop: "desktop-1440", iphone: "iphone", ipad: "ipad-portrait" };

/**
 * The family a describe runs as, or a skip: in CI the `webkit-iphone` project also runs every `@smoke` spec with an
 * iPhone; a P4 spec with device variants runs only its iphone variant there (the others are chromium's).
 */
export function skipOtherEngines(testInfo: TestInfo, family: Family): string | null {
  if (testInfo.project.name === "webkit-iphone" && family !== "iphone") return "the webkit-iphone project runs the iphone variant only";
  return null;
}

// ── Database ────────────────────────────────────────────────────────────────────────────────────────────────────────

export type UserRow = {
  id: bigint;
  ref: string;
  clerkUserId: string;
  onboarded: boolean;
  step: string;
  band: string | null;
  goals: string[] | null;
  minutes: number | null;
  timeZone: string;
  subscriptionStatus: string | null;
  trialEndsAt: Date | null;
  pendingCheckoutAt: Date | null;
  lastCheckoutSource: string | null;
};

export async function userRow(db: PrismaClient, email: string): Promise<UserRow> {
  const rows = await db.$queryRaw<UserRow[]>`
    SELECT id, "referenceId" AS ref, "googleId" AS "clerkUserId", onboarded, "onboardingStep"::text AS step,
           "ratingBand"::text AS band, goals::text[] AS goals, "dailyMinutes"::int AS minutes, "timeZone",
           "subscriptionStatus", "trialEndsAt", "pendingCheckoutAt", "lastCheckoutSource"
      FROM users WHERE email = ${email}`;
  const row = rows[0];
  if (!row) throw new Error(`no users row for the leased account`);
  return row;
}

export type RunRow = { status: string; trigger: string; provider: string; imported: number; skipped: number; queued: number };

export async function importRuns(db: PrismaClient, email: string): Promise<RunRow[]> {
  return db.$queryRaw<RunRow[]>`
    SELECT r.status::text AS status, r.trigger::text AS trigger, la.provider::text AS provider, r.imported, r.skipped,
           r."analysisQueued" AS queued
      FROM import_runs r JOIN users u ON u.id = r."userId" JOIN linked_accounts la ON la.id = r."linkedAccountId"
     WHERE u.email = ${email}
     ORDER BY r.id`;
}

/** The fixture account's importable games (48 in the archives, 3 skipped: parse_error, unrated, variant). */
export const FIXTURE_IMPORTABLE = (() => {
  const require = createRequire(import.meta.url);
  let n = 0;
  for (const m of ["2026-08", "2026-09", "2026-10"]) {
    const rows = JSON.parse(readFileSync(require.resolve(`@repo/chess-fixtures/import/chesscom/knightowl_88/${m}.expected.json`), "utf8")) as
      | { skip?: string }[]
      | { games: { skip?: string }[] };
    const list = Array.isArray(rows) ? rows : rows.games;
    n += list.filter((r) => !r.skip).length;
  }
  return n;
})();
export const FIXTURE_TOTAL = 48;

// ── Page helpers ────────────────────────────────────────────────────────────────────────────────────────────────────

/** The visible copy of a test id (several layouts render the same control; one is visible). */
export const tid = (page: Page, testId: string): Locator => page.locator(`[data-testid="${testId}"]:visible`).first();

/**
 * Clicks a control once React has hydrated it (its DOM node carries React's props key). A click before hydration
 * submits the step's form natively (a reload of the same step), so specs never click a cold control.
 */
export async function clickReady(page: Page, testId: string): Promise<void> {
  await waitHydrated(page, `[data-testid="${testId}"]`);
  await tid(page, testId).click();
}

/** Waits until a visible element matching `selector` has been hydrated by React. */
export async function waitHydrated(page: Page, selector: string, timeout = 60_000): Promise<void> {
  await page.waitForFunction(
    (s) =>
      [...document.querySelectorAll(s)].some(
        (el) => (el as HTMLElement).offsetParent !== null && Object.keys(el).some((k) => k.startsWith("__reactProps")),
      ),
    selector,
    { timeout },
  );
}

/** The step's stage (OnbStage `data-testid="onb-<step>"`, `data-state`). */
export const stage = (page: Page, step: OnbStep): Locator => page.locator(`[data-testid="onb-${step}"]`).first();

export async function expectStep(page: Page, step: OnbStep, opts: { timeout?: number } = {}): Promise<void> {
  await expect(page).toHaveURL(new RegExp(`/onboarding/${step}(\\?|$)`), { timeout: opts.timeout ?? 60_000 });
  await expect(stage(page, step)).toBeVisible({ timeout: opts.timeout ?? 60_000 });
}

export async function gotoStep(page: Page, step: OnbStep | "", query = ""): Promise<void> {
  await gotoOk(page, `/onboarding${step ? `/${step}` : ""}${query}`);
}

/** One viewport: the document never scrolls (the step body scrolls inside the panel when it must). */
export async function noDocumentScroll(page: Page): Promise<void> {
  const m = await page.evaluate(() => ({
    sh: document.scrollingElement!.scrollHeight,
    ih: window.innerHeight,
    sw: document.scrollingElement!.scrollWidth,
    iw: document.documentElement.clientWidth,
  }));
  expect(m.sh, "the document does not scroll vertically").toBeLessThanOrEqual(m.ih + 1);
  expect(m.sw, "no horizontal page scroll").toBeLessThanOrEqual(m.iw + 1);
}

/**
 * Marks the page's requests to `glob` as fault-injected for P1's console guard (`x-rc-fault` with a value route()
 * ignores): the spec made the upstream fail on purpose (the mock), so a 502 from that route is expected.
 */
export async function markInjected(page: Page, glob: string): Promise<void> {
  await page.route(glob, (route) => route.fallback({ headers: { ...route.request().headers(), "x-rc-fault": "upstream-mock" } }));
}

/** A documentation-range address (RFC 5737 198.51.100.0/24 + 203.0.113.0/24) unique to this worker and test. */
export function testClientIp(testInfo: TestInfo): string {
  const n = (testInfo.parallelIndex * 37 + testInfo.retry * 7 + (Date.now() % 997)) % 254;
  return `${testInfo.parallelIndex % 2 ? "198.51.100" : "203.0.113"}.${n + 1}`;
}

/** Clears every per-user window of one Clerk user, the scoped ones (`…:c:<id>:<scope>`) included, in both stores. */
export async function clearUserRateLimits(db: PrismaClient, clerkUserId: string): Promise<void> {
  const [exact, scoped] = rateLimitKeyPatterns(clerkUserId);
  await db.$executeRaw`DELETE FROM rate_limit_buckets WHERE key LIKE ${exact} OR key LIKE ${scoped}`;
  await db.$executeRaw`DELETE FROM rate_limit_windows WHERE key LIKE ${exact} OR key LIKE ${scoped}`;
}

/** The LIKE patterns of a user's limiter keys: `rl:<bucket>:c:<id>` and `rl:<bucket>:c:<id>:<scope>`. */
export function rateLimitKeyPatterns(clerkUserId: string): [string, string] {
  const id = clerkUserId.replace(/[\\%_]/g, (c) => `\\${c}`);
  return [`rl:%:c:${id}`, `rl:%:c:${id}:%`];
}

/** Clears one user's window of a per-user route bucket (`rl:<bucket>:c:<clerk id>`), so a spec starts from 0. */
export async function resetUserBucket(db: PrismaClient, bucket: string, clerkUserId: string): Promise<void> {
  await db.$executeRaw`DELETE FROM rate_limit_buckets WHERE key = ${`rl:${bucket}:c:${clerkUserId}`}`;
}

/**
 * A Chess.com-shaped handle (3–25 characters, letters, digits, underscore) unique to this run and test. The tag after
 * the underscore starts with a letter: a base-36 timestamp can start with a digit, and "owl_0gi7l10" has the initials
 * "O0" where the specs expect a two-letter avatar (regression: p04-handle-initials, happy-path flaked on the clock).
 */
export function uniqueHandle(prefix: string, testInfo: TestInfo): string {
  const tag = `t${Date.now().toString(36).slice(-5)}${testInfo.workerIndex}${testInfo.retry}`;
  return `${prefix}_${tag}`.slice(0, 25);
}

/** A Lichess-shaped username unique to this run (verified links are owned by one member: never reuse one). */
export function uniqueLichess(prefix: string, testInfo: TestInfo): string {
  return `${prefix}${Date.now().toString(36).slice(-6)}${testInfo.workerIndex}`.slice(0, 20);
}

/** The mock's consent page: types the username and approves (or denies). */
export async function lichessConsent(page: Page, decision: { approve: boolean; username?: string }): Promise<void> {
  await expect(page.getByTestId("mock-lichess-approve")).toBeVisible({ timeout: 30_000 });
  if (decision.username) await page.getByTestId("mock-lichess-username").fill(decision.username);
  await page.getByTestId(decision.approve ? "mock-lichess-approve" : "mock-lichess-deny").click();
}

// ── Fixtures ────────────────────────────────────────────────────────────────────────────────────────────────────────

export type LeasedP4 = { email: string; pool: number; persona: string; ref: string; clerkUserId: string };

type P4Fixtures = {
  /** Resets this worker's pool slot to a P4 persona and signs `page` in as it. */
  leasePersona: (name: P04PersonaName) => Promise<LeasedP4>;
  upstream: typeof upstreamClient;
};
type P4WorkerFixtures = { p4db: PrismaClient };

export const test = mergeTests(authTest, telemetryTest, timeTest, freshTest).extend<P4Fixtures, P4WorkerFixtures>({
  p4db: [
    // eslint-disable-next-line no-empty-pattern -- Playwright needs a destructuring pattern here
    async ({}, provide) => {
      const { PrismaClient } = await import("@repo/db");
      const db = new PrismaClient({ datasourceUrl: e2eDatabaseUrl() });
      await provide(db);
      await db.$disconnect();
    },
    { scope: "worker" },
  ],

  leasePersona: async ({ page, p4db }, provide, testInfo) => {
    await provide(async (name) => {
      const email = poolEmail(poolSlot(testInfo.parallelIndex, 0));
      await hideDevOverlay(page);
      // A client address of its own: the per-IP limits (lookup 30 / 60 s, …) count every local test as 127.0.0.1
      // otherwise, so parallel specs would spend one bucket. route()'s limiter keys on the first x-forwarded-for hop.
      const ip = testClientIp(testInfo);
      await page.context().route("**/api/**", (route) => route.fallback({ headers: { ...route.request().headers(), "x-forwarded-for": ip } }));
      // Sign in first: GET /api/me provisions a fresh pool row (CI), then the reset writes the persona over it.
      await signIn(page, email, "");
      const leased = await resetPoolPersona(name, testInfo);
      // The mock's per-customer Dodo controls belong to the previous lease of this pool user: start clean.
      if (await upstreamClient.healthy()) await upstreamClient.dodoFor(email, { clear: true });
      expect(leased.email).toBe(email);
      // The claims refresh makes the page read the viewer again: let that read finish before the spec navigates
      // (fixtures/auth.ts pendingViewerReads; regression: webkit-lease-me-cut).
      const viewerReads = pendingViewerReads(page);
      await refreshSessionClaims(page);
      await viewerReads.settled();
      const row = await userRow(p4db, email);
      // Its per-user rate-limit windows belong to the previous lease too (a spec run a minute earlier on this pool
      // user would otherwise spend this one's lookups, links or syncs).
      // The scoped buckets too (`rl:sync:c:<clerk id>:chesscom`, scopedRateSubject): without them a spec on the same
      // pool user within 30 s met the previous spec's Sync now window (regression: p04-lease-scoped-buckets).
      await clearUserRateLimits(p4db, row.clerkUserId);
      return { ...leased, ref: row.ref, clerkUserId: row.clerkUserId };
    });
  },

  // eslint-disable-next-line no-empty-pattern -- Playwright needs a destructuring pattern here
  upstream: async ({}, provide) => {
    if (!(await upstreamClient.healthy())) throw new Error("the upstream mock is not running (playwright.config.ts starts it on 4010 + offset)");
    await provide(upstreamClient);
  },
});
