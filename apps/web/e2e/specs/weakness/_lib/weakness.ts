// Phase 6 e2e helpers (phase-06 plan §12.4; testing X4–X8). Every spec under e2e/specs/weakness/** imports `test` and
// `expect` from here: the P5 trainer fixtures (`member`, `userPage`, `persona`, `reviewDb`, the console guard, the
// telemetry recorder, the runner helpers) plus what the weakness specs share:
//
//   - `weak(name)`: leases a P6 persona (e2e/personas/p06.ts) and signs `page` in as it. The persona is REAL data: its
//     CC0 games are graded by the running e2e worker, the bank extracted, the profile built by RECOMPUTE_WEAKNESS
//     (packages/db/seed/p06-personas.ts). `weak-member` leases pool slot 1 of the worker (its graded games are kept
//     between leases), every other persona slot 0;
//   - `weakStep(step)`: a persona step on the leased user (`weak-computing:ready`, `weakfail:crash`), run by the worker;
//   - TR-5 as the member reads it (`tr5`), the page (`openWeakness`, `root`), the user-room push through the test hook
//     (`devEmit`, POST /api/dev/emit), and database reads of the leased user (`weakDb`).
// Values a spec asserts are read from the member's own TR-5 payload (the real profile), never hard-coded.
import type { APIRequestContext, Page, TestInfo } from "@playwright/test";
import type { PrismaClient } from "@repo/db";
import { signIn, signInFresh } from "../../../fixtures/auth";
import { leasePersona, type LeasedPersona } from "../../../fixtures/lease";
import { poolEmail, poolSlot } from "../../../fixtures/users";
import { p06PoolIndex } from "../../../personas/p06";
import { waitHydrated } from "../../onboarding/_lib/p04";
import { expect, hideDevOverlay, test as trainTest } from "../../train/_lib/train";

export * from "../../train/_lib/train";
export { waitHydrated };

// ── Design-state tags ──────────────────────────────────────────────────────────────────────────────────────────
/** The three desktop boards that draw the page's non-profile states, each enumerating all three (design-states.json). */
export const STATE_BOARDS = ["V3WeaknessInsufficient", "V3WeaknessComputing", "V3WeaknessDrill"] as const;
export type BoardState = "insufficient" | "computing" | "drill";

/** `@state:` tags of a non-profile state reached with real data (on each board that enumerates it). */
export function weakStateTags(state: BoardState): string[] {
  return STATE_BOARDS.map((b) => `@state:${b}.${state}`);
}

/** The profile boards: desktop and the four devices. */
export const PROFILE_BOARD = {
  "desktop-1440": "V3WeaknessProfile",
  iphone: "V3iPhoneWeaknessProfile",
  android: "V3AndroidWeaknessProfile",
  "ipad-portrait": "V3iPadPWeaknessProfile",
  "ipad-landscape": "V3iPadLWeaknessProfile",
} as const;

// ── Fixtures ───────────────────────────────────────────────────────────────────────────────────────────────────
export type WeakLease = LeasedPersona & { index: 0 | 1 };

type WeakFixtures = {
  /** Leases P6 persona `name` on this worker's slot for it and signs `page` in as it (minutes on a first lease). */
  weak: (name: string) => Promise<WeakLease>;
  /** Runs a persona step on the user `weak()` leased last. */
  weakStep: (step: "weak-computing:ready" | "weakfail:crash" | "weak-orphaned:again") => Promise<void>;
};

export const test = trainTest.extend<WeakFixtures>({
  weak: async ({ page }, provide, testInfo: TestInfo) => {
    let signedInAs: string | null = null;
    await provide(async (name) => {
      const index = p06PoolIndex(name);
      const email = poolEmail(poolSlot(testInfo.parallelIndex, index));
      // Sign in first: GET /api/me provisions the pool user's row on a fresh database; then the reset. A second lease
      // in the same test re-uses the session (one pool user per persona slot).
      if (signedInAs !== email) {
        await hideDevOverlay(page);
        // Another pool user of this test: a clean sign-in (signInFresh leaves the app before it clears the cookies).
        if (signedInAs) await signInFresh(page, email);
        else await signIn(page, email, "");
        signedInAs = email;
      }
      const leased = await leasePersona(name, testInfo, index);
      expect(leased.email).toBe(email);
      // A session whose token carries the claims the reset just wrote (regression: lease-stale-claims, review/_lib).
      await signInFresh(page, email);
      testInfo.annotations.push({ type: "data", description: `${name}: real CC0 games graded by the e2e worker (pool ${leased.pool})` });
      return { ...leased, index };
    });
  },
  // Playwright reads the fixture dependencies from the first parameter, so it must be a pattern.
  // eslint-disable-next-line no-empty-pattern
  weakStep: async ({}, provide, testInfo: TestInfo) => {
    await provide(async (step) => {
      const target = testInfo.annotations.filter((a) => a.type === "persona").at(-1)?.description?.match(/pool user (\d+)/)?.[1];
      if (!target) throw new Error("weakStep: lease a persona first (weak(name))");
      const { runPersonaStep } = await import("../../../../scripts/dev/personas");
      const lines: string[] = [];
      await runPersonaStep(target, step, { log: (l) => lines.push(l) });
      testInfo.annotations.push({ type: "persona-step", description: lines.at(-1) ?? step });
    });
  },
});

// ── TR-5 and the page ──────────────────────────────────────────────────────────────────────────────────────────
export type Row = { rank: number; pattern: string; slug: string; label: string; inBank: number; matchable: boolean; events: number };
/** The fields of TR-5's payload (CT http/weakness.ts WeaknessPayload) the specs read. */
export type Weakness = {
  status: "insufficient" | "computing" | "ready" | "failed";
  scope: { timeClasses: string[]; months: number };
  scopeLabel: string;
  games: { analysed: number; inScope: number; pending: number; required: number };
  rating: number | null;
  progress: { pct: number; etaSec: number | null; stalled: boolean; orphaned: boolean; analysed: number; target: number } | null;
  top: Row[];
  more: Row[];
  preliminary: { pattern: string; label: string; seenIn: number; of: number }[];
  headline: { text: string } | null;
  breakdown: {
    clock: { sentence: string; ariaLabel: string; buckets: { key: string; label: string; per100: number | null; moves: number }[] } | null;
  } | null;
  offers: { includeBullet: { bulletGames: number } | null };
  failure: { code: string; retryable: boolean } | null;
  version: number;
  seenVersion: number;
  [k: string]: unknown;
};

/** GET /api/train/weakness as the signed-in member (200, the data). */
export async function tr5(request: APIRequestContext): Promise<Weakness> {
  const res = await request.get("/api/train/weakness");
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as { data: Weakness }).data;
}

/** The page's root (its `data-status` is the server-decided status, `computing` while the build runs). */
export const root = (page: Page) => page.getByTestId("weakness").first();

/** Opens /train/weakness (with `query`) and waits for the status and hydration. */
export async function openWeakness(page: Page, status: Weakness["status"], query = ""): Promise<void> {
  const res = await page.goto(`/train/weakness${query}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  expect(res?.status(), "/train/weakness").toBe(200);
  await expect(root(page)).toHaveAttribute("data-status", status, { timeout: 120_000 });
  await waitHydrated(page, '[data-testid="weakness"] button, [data-testid="weakness"] a');
}

/** POST /api/dev/emit: one registered user-room event to the signed-in member's own room (the test hook). */
export async function devEmit(page: Page, event: string, data: unknown): Promise<number> {
  const token = process.env.E2E_TEST_TOKEN;
  if (!token) throw new Error("E2E_TEST_TOKEN is not set (.env.test)");
  const res = await page.request.post("/api/dev/emit", { headers: { "x-e2e-token": token }, data: { v: 1, event, data } });
  expect(res.status(), await res.text()).toBe(202);
  return (((await res.json()) as { data: { delivered: number | null } }).data.delivered ?? 0) as number;
}

/** A `weakness:progress` frame of a 25-game build (the user-room schema, CT socket/user.ts). */
export function progressEvent(pct: number, analysed: number, step: "grade" | "patterns" | "compare", target = 25) {
  return { v: 1, pct, step, etaSec: 240, stalled: false, analysed, target, importDone: null, importTotal: null };
}

/** The member's badges (R8 /api/me/badges): `weaknessReady` is the profile's half of the Train dot. */
export async function badgesOf(page: Page): Promise<{ weaknessReady?: boolean; trainDot?: boolean }> {
  const res = await page.request.get("/api/me/badges");
  expect(res.status()).toBe(200);
  return ((await res.json()) as { data: { weaknessReady?: boolean; trainDot?: boolean } }).data;
}

// ── Database reads of the leased user (reviewDb refuses anything but a local Postgres or the Neon dev branch) ───
export function weakDb(db: PrismaClient) {
  return {
    async userId(email: string): Promise<bigint> {
      const rows = await db.$queryRaw<{ id: bigint }[]>`SELECT id FROM users WHERE lower(email) = lower(${email}) LIMIT 1`;
      if (!rows[0]) throw new Error(`no users row for ${email}`);
      return rows[0].id;
    },
    /** The member's RECOMPUTE_WEAKNESS row (one per member), or null. */
    async recompute(userId: bigint): Promise<{ status: string; attempts: number; trigger: string | null; userAt: string | null } | null> {
      const rows = await db.$queryRaw<{ status: string; attempts: number; trigger: string | null; userAt: string | null }[]>`
        SELECT status::text AS status, attempts, payload->>'trigger' AS trigger, payload->>'userAt' AS "userAt"
          FROM jobs WHERE "dedupeKey" = ${`weakness:${userId}`}`;
      return rows[0] ?? null;
    },
    async snapshots(userId: bigint): Promise<{ status: string; gamesAnalysed: number }[]> {
      return db.$queryRaw<{ status: string; gamesAnalysed: number }[]>`
        SELECT status::text AS status, "gamesAnalysed" FROM weakness_snapshots WHERE "userId" = ${userId} ORDER BY "weekStart" DESC`;
    },
    async seen(userId: bigint): Promise<{ version: number; seen: number } | null> {
      const rows = await db.$queryRaw<{ version: number; seen: number }[]>`
        SELECT "weaknessVersion" AS version, "lastWeaknessSeenVersion" AS seen FROM training_profiles WHERE "userId" = ${userId}`;
      return rows[0] ?? null;
    },
  };
}
