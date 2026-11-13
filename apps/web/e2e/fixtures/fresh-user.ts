// A brand-new Clerk user for the one flow that needs it (phase-04 plan §12.4 "Personas, not throwaway users"):
// checkout/activating.spec.ts's fresh sign-up. Everything else leases a persona (fixtures/lease.ts).
//
//   test("…", async ({ page, freshUser }) => {
//     const user = await freshUser.create("checkout");     // e2e-onb-<runId>-<n>+clerk_test@chessbattle.dev
//     await freshUser.signIn(page, user);                  // ticket sign-in, GET /api/me provisions the row
//   });
//
// The `e2e-` prefix is what P1's sweeper (scripts/sweep-throwaway-users.ts) deletes after 2 h, and the unique local
// part means the trial ledger's `+tag` folding cannot collide across runs (the ledger drops `+clerk_test`, so the
// run id sits before it). Teardown deletes the Clerk user, the database user (its P4 state first: links, imported
// games, jobs, ledger rows by email and handle, through @repo/db/seed/p04-personas `clearP04State`) and nothing else.
import { randomBytes } from "node:crypto";
import { test as base, type Page, type TestInfo } from "@playwright/test";
import { E2E_EMAIL_DOMAIN } from "./users";

export type FreshUser = { clerkUserId: string; email: string; label: string };

const RUN_ID = `${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
let counter = 0;

/** `e2e-onb-<runId>-<n>+clerk_test@chessbattle.dev` (n per process; the worker index keeps parallel workers apart). */
export function freshEmail(workerIndex: number): string {
  counter += 1;
  return `e2e-onb-${RUN_ID}-w${workerIndex}n${counter}+clerk_test@${E2E_EMAIL_DOMAIN}`;
}

function clerkKey(): string {
  const key = process.env.CLERK_SECRET_KEY;
  if (!key?.startsWith("sk_test_")) throw new Error("the fresh-user fixture needs the Clerk DEVELOPMENT secret key (sk_test_…)");
  return key;
}

async function clerk(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`https://api.clerk.com/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${clerkKey()}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(20_000),
  });
}

export async function createFreshClerkUser(label: string, workerIndex: number): Promise<FreshUser> {
  const email = freshEmail(workerIndex);
  const res = await clerk("/users", {
    method: "POST",
    body: JSON.stringify({ email_address: [email], skip_password_requirement: true, first_name: "Fresh", last_name: "E2E" }),
  });
  if (!res.ok) throw new Error(`Clerk could not create the fresh user (${res.status})`);
  const body = (await res.json()) as { id: string };
  return { clerkUserId: body.id, email, label };
}

/** Removes the database user (P4 state first) and the Clerk user. Failures are reported, never thrown. */
export async function deleteFreshUser(user: FreshUser, log: (line: string) => void = () => {}): Promise<void> {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (url) {
    const { PrismaClient } = await import("@repo/db");
    const db = new PrismaClient({ datasourceUrl: url });
    try {
      const rows = await db.$queryRaw<{ id: bigint }[]>`SELECT id FROM users WHERE email = ${user.email}`;
      if (rows.length) {
        const { clearP04State } = await import("@repo/db/seed/p04-personas");
        const { trialLedgerEmailHash, handleHash } = await import("../../lib/billing/trial-ledger");
        await clearP04State(db, user.email, {
          now: new Date(),
          ledger: {
            emailHash: (e: string) => trialLedgerEmailHash(e),
            handleHash: (p: "chesscom" | "lichess", u: string, v: boolean) => handleHash(p, u, v),
          },
          log,
        });
        await db.$executeRaw`DELETE FROM users WHERE email = ${user.email}`;
      }
    } catch (error) {
      log(`[fresh-user] database cleanup of ${user.label} failed: ${String(error).slice(0, 200)} (the sweeper removes the Clerk user)`);
    } finally {
      await db.$disconnect();
    }
  }
  const res = await clerk(`/users/${encodeURIComponent(user.clerkUserId)}`, { method: "DELETE" }).catch(() => null);
  if (!res?.ok) log(`[fresh-user] Clerk delete of ${user.label} answered ${res?.status ?? "no response"} (the sweeper retries after 2 h)`);
}

/**
 * Ticket sign-in WITHOUT any onboarding provisioning: the fresh user's row is created by GET /api/me (not onboarded,
 * step WELCOME), exactly as a real sign-up's first request does.
 */
export async function signInFresh(page: Page, user: FreshUser): Promise<void> {
  const { signIn } = await import("./auth");
  await signIn(page, user.email, "", { onboarding: "as-is" });
}

export type FreshUsers = {
  create(label: string): Promise<FreshUser>;
  signIn(page: Page, user: FreshUser): Promise<void>;
};

export const test = base.extend<{ freshUser: FreshUsers }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright needs a destructuring pattern here
  freshUser: async ({}, provide, testInfo: TestInfo) => {
    const made: FreshUser[] = [];
    await provide({
      create: async (label) => {
        const user = await createFreshClerkUser(label, testInfo.workerIndex);
        made.push(user);
        testInfo.annotations.push({ type: "fresh-user", description: label });
        return user;
      },
      signIn: signInFresh,
    });
    const lines: string[] = [];
    for (const user of made) await deleteFreshUser(user, (l) => lines.push(l));
    if (lines.some((l) => l.includes("failed") || l.includes("answered"))) {
      testInfo.annotations.push({ type: "fresh-user cleanup", description: lines.join(" | ").slice(0, 500) });
    }
  },
});
