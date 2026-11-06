/**
 * Throwaway E2E user sweeper (phase-01 plan §12.0, CT X4, risk R21).
 *
 * Deletes every Clerk dev user whose email marks it as a throwaway E2E user
 * (`e2e-<flow>-<runId>@…`, e.g. tournament temp users `e2e-temp-…`) and that is
 * older than 2 hours, together with its `users` row. Registered users (A–S,
 * the pool, the admin) are never touched: e2e/fixtures/users.ts `roleOfEmail`
 * decides. Then it fails when the Clerk instance is within 20 users of its cap.
 *
 * Runs from global setup (sweepThrowawayUsers) and by hand:
 *   cd apps/web && set -a && source .env.test && set +a
 *   npx tsx e2e/scripts/sweep-throwaway-users.ts [--dry-run]
 *
 * Env: CLERK_SECRET_KEY (must be a development key, sk_test_…), DATABASE_URL
 * (optional; rows are kept when unset), CLERK_USER_CAP (default 500; check the
 * cap in the Clerk dashboard, plan V3).
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { roleOfEmail } from "../fixtures/users";

export const MAX_AGE_MS = 2 * 3_600_000;
export const CAP_HEADROOM = 20;
const CLERK_API = "https://api.clerk.com/v1";

type ClerkUser = {
  id: string;
  created_at: number;
  email_addresses: Array<{ id: string; email_address: string }>;
  primary_email_address_id: string | null;
};

export type SweepResult = { deleted: string[]; kept: number; total: number; cap: number; dryRun: boolean };

/** Pure: which users to delete. */
export function selectThrowaways(users: ClerkUser[], now: number, env: Record<string, string | undefined> = process.env) {
  return users.filter((u) => {
    const email =
      u.email_addresses.find((e) => e.id === u.primary_email_address_id)?.email_address ??
      u.email_addresses[0]?.email_address;
    if (!email) return false;
    return roleOfEmail(email, env) === "throwaway" && now - u.created_at > MAX_AGE_MS;
  });
}

export function capProblem(total: number, cap: number): string | null {
  return total > cap - CAP_HEADROOM
    ? `Clerk dev instance has ${total} users, within ${CAP_HEADROOM} of its cap (${cap}). Delete stale users before running E2E.`
    : null;
}

async function clerk<T>(key: string, pathAndQuery: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${CLERK_API}${pathAndQuery}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Clerk ${init?.method ?? "GET"} ${pathAndQuery.split("?")[0]}: ${res.status}`);
  return (await res.json()) as T;
}

function primaryEmail(u: ClerkUser): string {
  return (
    u.email_addresses.find((e) => e.id === u.primary_email_address_id)?.email_address ??
    u.email_addresses[0]?.email_address ??
    ""
  );
}

export async function sweepThrowawayUsers(opts: { dryRun?: boolean; log?: (l: string) => void } = {}): Promise<SweepResult> {
  const log = opts.log ?? ((l: string) => console.log(l));
  const key = process.env.CLERK_SECRET_KEY;
  if (!key) throw new Error("sweep: CLERK_SECRET_KEY is not set");
  if (!key.startsWith("sk_test_")) throw new Error("sweep: refusing to run against a non-development Clerk key");
  const cap = Number(process.env.CLERK_USER_CAP ?? 500);

  // `query` matches email substrings; page through every e2e- user.
  const candidates: ClerkUser[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await clerk<ClerkUser[]>(key, `/users?query=e2e-&limit=100&offset=${offset}&order_by=created_at`);
    candidates.push(...page);
    if (page.length < 100) break;
  }
  const doomed = selectThrowaways(candidates, Date.now());
  const deleted: string[] = [];

  let db: { user: { deleteMany(args: { where: { email: string } }): Promise<{ count: number }> }; $disconnect(): Promise<void> } | null = null;
  if (!opts.dryRun && doomed.length && process.env.DATABASE_URL) {
    const { PrismaClient } = await import("@repo/db");
    db = new PrismaClient();
  }
  try {
    for (const u of doomed) {
      const email = primaryEmail(u);
      if (opts.dryRun) {
        log(`[sweep] would delete ${email}`);
      } else {
        // Rows first: a crash between the two leaves a Clerk user the next sweep finds again.
        if (db) {
          try {
            await db.user.deleteMany({ where: { email } });
          } catch (err) {
            log(`[sweep] kept the users row of ${email} (${err instanceof Error ? err.message.split("\n")[0] : "error"})`);
          }
        }
        await clerk(key, `/users/${u.id}`, { method: "DELETE" });
        log(`[sweep] deleted ${email}`);
      }
      deleted.push(email);
    }
  } finally {
    await db?.$disconnect();
  }

  const { total_count: total } = await clerk<{ total_count: number }>(key, "/users/count");
  const problem = capProblem(total, cap);
  log(`[sweep] ${deleted.length} throwaway user(s) ${opts.dryRun ? "found" : "deleted"}; instance has ${total}/${cap} users`);
  if (problem) throw new Error(problem);
  return { deleted, kept: candidates.length - doomed.length, total, cap, dryRun: Boolean(opts.dryRun) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  sweepThrowawayUsers({ dryRun: process.argv.includes("--dry-run") }).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
