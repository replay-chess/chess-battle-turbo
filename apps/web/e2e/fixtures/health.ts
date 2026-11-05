// Fixture health (phase-01 plan §12.0, CT X3). Called from global setup.
//
// 1. Re-entitles the shared members A–P (the idempotent `--entitle` upsert of
//    e2e/scripts/provision-test-users.ts), so their period never silently ends.
// 2. Fails the run with one clear message when:
//    - any of A–P has no row, is not active, or has currentPeriodEnd < now + 30 d;
//    - Q (trial used) has lost trialStartedAt;
//    - R (never trialled) has a subscription or a trial.
//
// `evaluateFixtureHealth` is pure (unit-tested in health.test.ts); the runner
// takes any Prisma-like client, so it also runs against a throwaway Docker DB.
import { SHARED_MEMBER_LETTERS, letterEmail } from "./users";

const DAY = 24 * 3_600_000;
export const MIN_PERIOD_LEFT_MS = 30 * DAY;

export type FixtureRow = {
  email: string;
  subscriptionId: string | null;
  subscriptionStatus: string | null;
  currentPeriodEnd: Date | null;
  trialStartedAt: Date | null;
};

type Env = Record<string, string | undefined>;

export type HealthReport = { problems: string[]; warnings: string[] };

export function evaluateFixtureHealth(rows: FixtureRow[], now: Date, env: Env = process.env): HealthReport {
  const byEmail = new Map(rows.map((r) => [r.email.toLowerCase(), r]));
  const problems: string[] = [];
  const warnings: string[] = [];
  const minEnd = now.getTime() + MIN_PERIOD_LEFT_MS;

  for (const letter of SHARED_MEMBER_LETTERS) {
    const email = letterEmail(letter, env);
    const row = byEmail.get(email.toLowerCase());
    if (!row) {
      problems.push(`${letter} (${email}): no users row`);
      continue;
    }
    if (row.subscriptionStatus !== "active") {
      problems.push(`${letter}: subscriptionStatus is ${row.subscriptionStatus ?? "null"}, expected active`);
    }
    if (!row.currentPeriodEnd || row.currentPeriodEnd.getTime() < minEnd) {
      const end = row.currentPeriodEnd ? row.currentPeriodEnd.toISOString() : "null";
      problems.push(`${letter}: currentPeriodEnd ${end} is less than 30 days away`);
    }
  }

  const q = byEmail.get(letterEmail("Q", env).toLowerCase());
  // Q gets its row on first sign-in. No spec signs in as Q yet, so a missing row
  // is a warning; `provision-test-users.ts --restore-qr` creates it with a used trial.
  if (!q) warnings.push("Q: no users row on this database yet (run provision-test-users.ts --restore-qr)");
  else if (!q.trialStartedAt) problems.push("Q: trialStartedAt is null; Q must keep its used trial (read-only user)");

  const r = byEmail.get(letterEmail("R", env).toLowerCase());
  if (r && (r.subscriptionId || r.subscriptionStatus || r.trialStartedAt)) {
    problems.push("R: has a subscription or a trial; R must never have had one (read-only user)");
  }
  return { problems, warnings };
}

export function formatHealthFailure(problems: string[]): string {
  return [
    `E2E fixture health failed (${problems.length} problem(s)):`,
    ...problems.map((p) => `  - ${p}`),
    "Fix: re-run `npx tsx e2e/scripts/provision-test-users.ts --entitle` with E2E_LETTERS=<letters>,",
    "and restore Q/R with `provision-test-users.ts --restore-qr` (Q: used trial; R: no billing state).",
    "Skip once with E2E_SKIP_HEALTH=1 (never in CI).",
  ].join("\n");
}

/** The subset of PrismaClient the runner needs. */
export type HealthDb = {
  user: {
    findMany(args: {
      where: { email: { in: string[] } };
      select: Record<keyof FixtureRow, true>;
    }): Promise<FixtureRow[]>;
  };
};

export async function readFixtureRows(db: HealthDb, env: Env = process.env): Promise<FixtureRow[]> {
  const emails = [...SHARED_MEMBER_LETTERS, "Q", "R"].map((l) => letterEmail(l, env));
  return db.user.findMany({
    where: { email: { in: emails } },
    select: { email: true, subscriptionId: true, subscriptionStatus: true, currentPeriodEnd: true, trialStartedAt: true },
  });
}

/** Throws with a readable message when the fixtures are unhealthy; returns the warnings. */
export async function assertFixtureHealth(db: HealthDb, now = new Date(), env: Env = process.env): Promise<string[]> {
  const { problems, warnings } = evaluateFixtureHealth(await readFixtureRows(db, env), now, env);
  if (problems.length) throw new Error(formatHealthFailure(problems));
  return warnings;
}
