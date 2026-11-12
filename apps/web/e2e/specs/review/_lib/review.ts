// Phase 3 review e2e fixtures (phase-03 plan §12.3; WP-H). Every spec under e2e/specs/review/** imports `test` and
// `expect` from here:
//
//   test("…", async ({ page, member, seeded, telemetry }) => {
//     await member("A");                                   // signs `page` in (console guard + telemetry sink on)
//     await openReview(page, seeded.GAME);
//     await telemetry.expect("review_opened", { source: "deeplink" });
//   });
//
// - `seeded` (worker-scoped) makes sure member A has the P3 review seed (packages/db/seed/review.ts: GAME, CLEAN,
//   LEGEND, LEGEND_KT, UNANALYSED, 35 archive games, the expired/revoked/live shares of GAME) and returns the refs.
//   The seed is idempotent (it writes only what is missing or drifted), so on the dev branch it is a read; on a fresh
//   CI database the first worker writes it under an advisory lock while the others wait. A local database also gets
//   the two legend positions the seed needs (seed-content.ts refuses every host but the Neon dev endpoint).
// - `member(letter | email)` signs the test's own `page` in, so the P1 console guard and the telemetry recorder see it.
// - `userPage(letter | email, device?)` opens a second guarded context (another member in the same test).
// - `persona(name)` leases a P3 persona (e2e/personas/p03.ts) on the worker's pool user and signs `page` in as it.
//
// Specs reset the walkthrough state of the one seeded game they own with `resetProgress(ref)`; no two specs mutate the
// same seeded game's progress (GAME: review-walkthrough, CLEAN: review-clean, archive-05: review-share).
import { mergeTests, type BrowserContext, type BrowserContextOptions, type Page, type TestInfo } from "@playwright/test";
import type { PrismaClient } from "@repo/db";
import { test as authTest, signIn } from "../../../fixtures/auth";
import { finishGuard, guardContext, type ConsoleProblem } from "../../../fixtures/console-guard";
import { leasePersona, type LeasedPersona } from "../../../fixtures/lease";
import { expect, test as telemetryTest } from "../../../fixtures/telemetry";
import { letterEmail, poolEmail, poolSlot } from "../../../fixtures/users";
import { DEVICES, type DeviceName } from "./devices";

export { expect, DEVICES, type DeviceName };

/**
 * The desktop review boards (docs/qa/design-states.json): one screen drawn in five highlighted states, each board
 * enumerating all five (analysing | failed | clean | summary | moment). A desktop spec that reaches a state reaches it
 * on every one of them (the P2 pattern, specs/game/tags.ts).
 */
export const DESKTOP_REVIEW_BOARDS = ["V3ReviewSummary", "V3KeyMoments", "V3ReviewAnalysing", "V3ReviewClean", "V3ReviewFailed"] as const;

/** `@state:` tags of a review state reached with real data on desktop. */
export function reviewStateTags(state: "analysing" | "failed" | "clean" | "summary" | "moment"): string[] {
  return DESKTOP_REVIEW_BOARDS.map((b) => `@state:${b}.${state}`);
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
/** Branch `dev` of Neon project withered-cake-82837167 (the same allow-list as @repo/db/seed-guards). */
const DEV_HOST = /^ep-fancy-dust-b8b3dp81(-pooler)?\.c-14\.us-east-1\.aws\.neon\.tech$/;
const SEED_LOCK = "rc-e2e-p3-review-seed";

export type SeededRefs = {
  /** Member A's users.referenceId. */
  member: string;
  GAME: string;
  CLEAN: string;
  LEGEND: string;
  LEGEND_KT: string;
  UNANALYSED: string;
  /** `archive-01` … `archive-35` (the first 23 analysed). */
  archive: (n: number) => string;
  shares: { live: string; expired: string; revoked: string };
};

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** The e2e database URL: a local Postgres (CI) or the Neon dev branch, never anything else. The URL is never logged. */
export function e2eDatabaseUrl(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const url = env.DIRECT_URL || env.DATABASE_URL;
  if (!url) throw new Error("DIRECT_URL / DATABASE_URL is not set: source apps/web/.env.test (never production)");
  const host = hostOf(url);
  if (!LOCAL_HOSTS.has(host) && !DEV_HOST.test(host)) {
    throw new Error(`refusing to seed P3 review data on ${host}: only a local Postgres or the Neon dev branch`);
  }
  return url;
}

export function isLocalDatabase(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const url = env.DIRECT_URL || env.DATABASE_URL;
  return Boolean(url) && LOCAL_HOSTS.has(hostOf(url!));
}

/** The two legend positions of the content seed (prisma/fixtures/design-legend-positions.ts), on a local database. */
async function ensureLegendPositions(db: PrismaClient): Promise<void> {
  // Relative import: @repo/db exports no prisma/fixtures path (the same rows packages/db/test/seeds.int.test.ts adds).
  const { FIXTURE_POSITIONS } = await import("../../../../../../packages/db/prisma/fixtures/design-legend-positions");
  const { seededRef } = await import("@repo/db/seed/builders");
  for (const p of FIXTURE_POSITIONS.filter((x) => x.key === "mo" || x.key === "kt")) {
    await db.$executeRaw`
      INSERT INTO chess_positions ("referenceId", fen, "sideToMove", pgn, "whitePlayerName", "blackPlayerName", "sourceType", "updatedAt")
      VALUES (${seededRef(`e2e-pos-${p.key}`, "shared")}, ${p.fen}, ${p.sideToMove}, ${p.pgn}, ${p.white}, ${p.black}, 'design-fixture', now())
      ON CONFLICT (fen) DO NOTHING`;
  }
}

/** Runs the review seed for member A (idempotent) under a session advisory lock; returns the refs. */
export async function seedReview(db: PrismaClient): Promise<SeededRefs> {
  const { runReviewSeed } = await import("@repo/db/seed/review");
  const { seededRef, seededShareCode } = await import("@repo/db/seed/builders");
  const { PrismaClient: Client } = await import("@repo/db");
  const email = letterEmail("A");
  // The lock lives on its own one-connection client, so the lock and its release share a session (a pooled client
  // could unlock on another connection, which is a no-op), while the seed runs its own transactions on `db`.
  const lockUrl = new URL(e2eDatabaseUrl());
  lockUrl.searchParams.set("connection_limit", "1");
  const lock = new Client({ datasourceUrl: lockUrl.toString() });
  try {
    await lock.$queryRaw`SELECT pg_advisory_lock(hashtext(${SEED_LOCK}))::text AS locked`;
    try {
      if (isLocalDatabase()) await ensureLegendPositions(db);
      await runReviewSeed(db, { apply: true, memberEmail: email, resetProgress: false });
    } finally {
      await lock.$queryRaw`SELECT pg_advisory_unlock(hashtext(${SEED_LOCK}))`;
    }
  } finally {
    await lock.$disconnect();
  }
  const rows = await db.$queryRaw<{ ref: string }[]>`SELECT "referenceId" AS ref FROM users WHERE email = ${email} LIMIT 1`;
  const member = rows[0]?.ref;
  if (!member) throw new Error(`member A (${email}) has no users row: run the e2e global setup first`);
  const ref = (key: string) => seededRef(key, member);
  return {
    member,
    GAME: ref("GAME"),
    CLEAN: ref("CLEAN"),
    LEGEND: ref("LEGEND"),
    LEGEND_KT: ref("LEGEND_KT"),
    UNANALYSED: ref("UNANALYSED"),
    archive: (n) => ref(`archive-${String(n).padStart(2, "0")}`),
    shares: {
      live: seededShareCode("GAME:live", member),
      expired: seededShareCode("GAME:expired", member),
      revoked: seededShareCode("GAME:revoked", member),
    },
  };
}

/**
 * The seeded refs for suites without the e2e global setup (the device × zoom config): makes sure the shared members'
 * rows exist and are entitled (what global setup does), seeds, and disconnects.
 */
export async function prepareReviewData(): Promise<SeededRefs> {
  const { PrismaClient: Client } = await import("@repo/db");
  const { entitleSharedMembers } = await import("../../../scripts/provision-test-users");
  const db = new Client({ datasourceUrl: e2eDatabaseUrl() });
  try {
    await entitleSharedMembers(db);
    return await seedReview(db);
  } finally {
    await db.$disconnect();
  }
}

function emailOf(who: string): string {
  return who.includes("@") ? who : letterEmail(who);
}

type ReviewFixtures = {
  /** Signs the test's `page` in as a shared letter or an email (pool/persona users). */
  member: (who: string) => Promise<Page>;
  /** A second signed-in, console-guarded context (other members in the same test). */
  userPage: (who: string, device?: DeviceName) => Promise<Page>;
  /** Leases a P3 persona on this worker's pool slot and signs `page` in as it. */
  persona: (name: string) => Promise<LeasedPersona>;
  /** Clears the walkthrough state (progress, started, completed) of seeded games this spec owns. */
  resetProgress: (...refs: string[]) => Promise<void>;
};
type ReviewWorkerFixtures = { reviewDb: PrismaClient; seeded: SeededRefs };

export const test = mergeTests(authTest, telemetryTest).extend<ReviewFixtures, ReviewWorkerFixtures>({
  reviewDb: [
    // eslint-disable-next-line no-empty-pattern -- Playwright needs a destructuring pattern here
    async ({}, provide) => {
      const { PrismaClient } = await import("@repo/db");
      const db = new PrismaClient({ datasourceUrl: e2eDatabaseUrl() });
      await provide(db);
      await db.$disconnect();
    },
    { scope: "worker" },
  ],
  seeded: [
    async ({ reviewDb }, provide) => {
      await provide(await seedReview(reviewDb));
    },
    { scope: "worker", timeout: 300_000 },
  ],

  member: async ({ page }, provide) => {
    await provide(async (who) => {
      await hideDevOverlay(page);
      await signIn(page, emailOf(who), "");
      return page;
    });
  },

  userPage: async ({ browser, allowConsole, consoleGuard }, provide, testInfo: TestInfo) => {
    const opened: { context: BrowserContext; problems: ConsoleProblem[] }[] = [];
    await provide(async (who, device = "desktop-1440") => {
      testInfo.setTimeout(testInfo.timeout + 60_000);
      const context = await browser.newContext(DEVICES[device] as BrowserContextOptions);
      const problems = consoleGuard === "off" ? [] : guardContext(context, allowConsole);
      opened.push({ context, problems });
      const page = await context.newPage();
      await hideDevOverlay(page);
      await signIn(page, emailOf(who), "");
      return page;
    });
    for (const { context, problems } of opened) {
      await context.close().catch(() => undefined);
      await finishGuard(problems, testInfo, consoleGuard);
    }
  },

  persona: async ({ page }, provide, testInfo) => {
    await provide(async (name) => {
      // Sign in first: GET /api/me provisions the pool user's row (a fresh CI database has none), then the reset
      // writes the persona's billing and games onto it.
      const email = poolEmail(poolSlot(testInfo.parallelIndex, 0));
      await hideDevOverlay(page);
      await signIn(page, email, "");
      const leased = await leasePersona(name, testInfo);
      expect(leased.email).toBe(email);
      return leased;
    });
  },

  resetProgress: async ({ reviewDb }, provide) => {
    await provide(async (...refs) => {
      const { resetReviewProgress } = await import("@repo/db/seed/writer");
      await resetReviewProgress(reviewDb, refs);
    });
  },
});

/** next dev's floating dev-tools button sits over phone action bars; production builds have none. */
export async function hideDevOverlay(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const css = "nextjs-portal{display:none!important}";
    const add = () => document.head.append(Object.assign(document.createElement("style"), { textContent: css }));
    if (document.head) add();
    else document.addEventListener("DOMContentLoaded", add, { once: true });
  });
}

/** `page.goto` with one retry: a shared `next dev` sometimes aborts a navigation while it compiles a route. */
export async function gotoOk(page: Page, url: string, opts: { status?: number; timeout?: number } = {}): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await page.goto(url, { timeout: opts.timeout ?? 180_000, waitUntil: "domcontentloaded" });
      expect(res?.status(), `${url} status`).toBe(opts.status ?? 200);
      return;
    } catch (error) {
      if (attempt > 0 || !/ERR_ABORTED|frame was detached|interrupted/i.test(String(error))) throw error;
    }
  }
}

/** Opens `/review/<ref>` and waits for the screen (any status). */
export async function openReview(page: Page, ref: string, query = ""): Promise<void> {
  await gotoOk(page, `/review/${ref}${query}`);
  await expect(page.getByTestId("review-screen")).toBeVisible({ timeout: 120_000 });
}

/** The visible copy of a control rendered in both bars (side footer and phone action bar). */
export const visible = (page: Page, testId: string) => page.getByTestId(testId).filter({ visible: true }).first();

/** A control that is `<id>` on desktop and `bar-<id>` in the phone action bar. */
export const control = (page: Page, id: string) =>
  page.locator(`[data-testid="${id}"]:visible, [data-testid="bar-${id}"]:visible`).first();

/** Moves focus to the page body, so single-key shortcuts act on the screen. */
export async function blur(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

/** One viewport: the document scrolls neither way. */
export async function noDocumentScroll(page: Page): Promise<void> {
  const m = await page.evaluate(() => ({
    sh: document.documentElement.scrollHeight,
    ih: window.innerHeight,
    sw: document.documentElement.scrollWidth,
    iw: window.innerWidth,
  }));
  expect(m.sh, "no vertical document scroll").toBeLessThanOrEqual(m.ih + 1);
  expect(m.sw, "no horizontal document scroll").toBeLessThanOrEqual(m.iw + 1);
}

/** The element is fully inside the viewport and at least 220 px on its short side (squares ≥ 27.5 px). */
export async function boardInView(page: Page, testId: string): Promise<void> {
  const box = await page.getByTestId(testId).filter({ visible: true }).first().boundingBox();
  expect(box, `${testId} is laid out`).not.toBeNull();
  const vp = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.y).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(vp.height + 1);
  expect(Math.min(box!.width, box!.height)).toBeGreaterThanOrEqual(220);
}

/**
 * Clicks until `settled` holds: a click that lands before React hydrates the server-rendered control is lost, so the
 * first click on a freshly loaded page is retried (bounded) instead of slept around.
 */
export async function clickUntil(target: import("@playwright/test").Locator, settled: () => Promise<void>, timeout = 30_000): Promise<void> {
  await retryUntil(() => target.click({ timeout: 5_000 }), settled, timeout);
}

/** Repeats `act` until `settled` holds (keys pressed before hydration are lost, like early clicks). */
export async function retryUntil(act: () => Promise<void>, settled: () => Promise<void>, timeout = 30_000): Promise<void> {
  await expect(async () => {
    // An earlier attempt may have landed late (a slow render): check before acting again.
    try {
      await settled();
      return;
    } catch {
      // not yet
    }
    await act();
    await settled();
  }).toPass({ timeout, intervals: [500, 1_000, 2_000] });
}

/** Pointer drag between two squares of the board on screen. */
export async function dragSquare(page: Page, from: string, to: string): Promise<void> {
  const a = await page.locator(`[data-square="${from}"]`).filter({ visible: true }).first().boundingBox();
  const b = await page.locator(`[data-square="${to}"]`).filter({ visible: true }).first().boundingBox();
  if (!a || !b) throw new Error(`squares ${from}/${to} are not on screen`);
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
}

/** Click-click move on the board on screen. */
export async function clickMove(page: Page, from: string, to: string): Promise<void> {
  await page.locator(`[data-square="${from}"]`).filter({ visible: true }).first().click();
  await page.locator(`[data-square="${to}"]`).filter({ visible: true }).first().click();
}

/** The `{ data }` envelope of a JSON API response. */
export async function dataOf<T>(res: { json(): Promise<unknown> }): Promise<T> {
  return ((await res.json()) as { data: T }).data;
}
