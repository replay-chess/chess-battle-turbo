import crypto from "node:crypto";
import type { Page, Browser } from "@playwright/test";
import { markOnboardedForE2E, refreshSessionClaims, signIn } from "./auth";
import { WEB_PORT } from "./socket-server";

/**
 * Create a tournament via the authenticated API from a signed-in page context.
 * Returns the `tournamentReferenceId`.
 */
export async function createTournamentViaApi(
  page: Page,
  name: string,
): Promise<string> {
  const result = await page.evaluate(async (tournamentName: string) => {
    const res = await fetch("/api/tournament/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: tournamentName,
        description: "E2E test tournament",
        mode: "FREE",
        durationMinutes: 30,
        initialTimeSeconds: 300,
        incrementSeconds: 5,
        scheduledStartAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to create tournament: ${res.status} ${text}`);
    }
    const data = await res.json();
    return data.data.referenceId as string;
  }, name);

  return result;
}

/**
 * Create temporary Clerk users via the REST API, sign each one in via a
 * temporary browser context, join the tournament, then close the context.
 *
 * Returns an array of Clerk user IDs for cleanup.
 */
export async function createTempUsersAndJoin(
  browser: Browser,
  tournamentRefId: string,
  count: number,
): Promise<string[]> {
  const clerkSecretKey = process.env.CLERK_SECRET_KEY;
  if (!clerkSecretKey) {
    throw new Error("CLERK_SECRET_KEY is required in .env.test for creating temp users");
  }

  const clerkUserIds: string[] = [];

  for (let i = 0; i < count; i++) {
    const timestamp = Date.now();
    const email = `e2e-temp-${timestamp}-${i}@chessbattle.dev`;
    // Suffix ensures Clerk password complexity (uppercase, lowercase, digit, special)
    const complexitySuffix = String.fromCharCode(33, 65, 97, 49); // !Aa1
    const password = crypto.randomBytes(12).toString("base64url") + complexitySuffix;

    // Create user via Clerk REST API
    const createRes = await fetch("https://api.clerk.com/v1/users", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${clerkSecretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email_address: [email],
        password,
        first_name: `TempPlayer${i + 1}`,
        last_name: "E2E",
      }),
    });

    if (!createRes.ok) {
      const text = await createRes.text();
      throw new Error(`Failed to create Clerk user: ${createRes.status} ${text}`);
    }

    const userData = await createRes.json();
    const clerkUserId = userData.id as string;
    clerkUserIds.push(clerkUserId);

    // Sign in via a temp browser context, join tournament, close
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      // A throwaway joiner: the sign-in provisions its row (GET /api/me), then the account is marked onboarded through
      // the database and Clerk claims (no onboarding API, phase-04 plan §3 / testing X17) and the session reloads
      // its claims, so middleware lets it through to the join page.
      await signIn(page, email, password, { onboarding: "as-is" });
      await markOnboardedForE2E(email);
      await refreshSessionClaims(page);

      await page.goto(`/join-tournament/${tournamentRefId}`, {
        timeout: 60_000,
        waitUntil: "domcontentloaded",
      });

      // Wait for the join button to appear, then click
      const joinBtn = page.locator('[data-testid="join-tournament-button"]');
      await joinBtn.waitFor({ timeout: 30_000 });
      await joinBtn.click();
      // Wait for redirect to tournament page
      await page.waitForURL(`**/tournament/${tournamentRefId}`, { timeout: 30_000 });
    } finally {
      await context.close();
    }
  }

  return clerkUserIds;
}

/**
 * Delete a tournament and all its associated games/transactions via the
 * cleanup API. Authenticated with E2E_CLEANUP_SECRET (no browser context needed).
 */
export async function deleteTournamentViaApi(
  tournamentRefId: string,
): Promise<void> {
  const secret = process.env.E2E_CLEANUP_SECRET;
  if (!secret) {
    throw new Error("E2E_CLEANUP_SECRET is required for tournament cleanup");
  }

  // The run's own web server (E2E_PORT_OFFSET moves it) or the deployed site.
  const baseUrl = process.env.PLAYWRIGHT_TEST_BASE_URL || process.env.E2E_BASE_URL || `http://localhost:${WEB_PORT}`;
  const res = await fetch(`${baseUrl}/api/tournament/${tournamentRefId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to delete tournament: ${res.status} ${text}`);
  }
}

/**
 * Delete temporary Clerk users created during the test.
 */
export async function cleanupTempUsers(clerkUserIds: string[]): Promise<void> {
  const clerkSecretKey = process.env.CLERK_SECRET_KEY;
  if (!clerkSecretKey) return;

  for (const userId of clerkUserIds) {
    try {
      await fetch(`https://api.clerk.com/v1/users/${userId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${clerkSecretKey}`,
        },
      });
    } catch {
      // Best-effort cleanup — don't fail the test
    }
  }
}
