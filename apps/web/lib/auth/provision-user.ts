// Request-path user provisioning (plan §8.5). The Clerk `user.created` webhook (lib/webhooks/clerk-events.ts,
// 1B·F4b) usually creates the row first; this is the fallback when the first request beats it.
//
//   1. a row with this googleId → done (no Clerk call);
//   2. load the Clerk user once (Backend API) and take the primary email only when it is verified;
//   3–5. the webhook's own provisioning (one implementation for both paths): relink by email (verified only, also
//        re-activates the row), else create users + user_stats in one transaction with a 6-character code
//        (5 retries), and on a P2002 race re-read;
//   6. no verified email → nothing is written; GET /api/me answers 502 upstream_unavailable { provider: "clerk",
//      kind: "unverified_email" } and the (app) layout falls back to marketing chrome. The next request retries.
import { handleClerkEvent, type ClerkUserPayload, type ClerkUserStore } from "@/lib/webhooks/clerk-events";

export type ProvisionResult =
  | { status: "ok"; userId: bigint; userRef: string; created: boolean; relinked: boolean }
  | { status: "unverified_email" }
  | { status: "clerk_user_missing" }
  | { status: "clerk_unavailable" };

/** Why provisioning could not produce a row (the 502 `details.kind`). */
export type ProvisionFailure = Exclude<ProvisionResult, { status: "ok" }>["status"];

export type ProvisionDeps = {
  /** Step 1 (one indexed read). */
  findByGoogleId(googleId: string): Promise<{ id: bigint; referenceId: string } | null>;
  /** Step 2: the Clerk user as the webhook payload shape; null when Clerk has no such user. Throws when unreachable. */
  loadClerkUser(clerkUserId: string): Promise<ClerkUserPayload | null>;
  /** Steps 3–5. Undefined → the webhook module's Prisma store. */
  store?: ClerkUserStore;
};

/** A Clerk Backend API `User` (the fields we read) as the webhook's `UserJSON` payload shape. */
export type ClerkBackendUser = {
  id: string;
  emailAddresses: ReadonlyArray<{ id: string; emailAddress: string; verification: { status?: string | null } | null }>;
  primaryEmailAddressId: string | null;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  imageUrl: string;
};

export function toClerkPayload(user: ClerkBackendUser): ClerkUserPayload {
  return {
    id: user.id,
    email_addresses: user.emailAddresses.map((e) => ({
      id: e.id,
      email_address: e.emailAddress,
      verification: { status: e.verification?.status ?? null },
    })),
    primary_email_address_id: user.primaryEmailAddressId,
    first_name: user.firstName,
    last_name: user.lastName,
    username: user.username,
    image_url: user.imageUrl || null,
  };
}

function isNotFound(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as { status?: unknown }).status === 404;
}

async function defaultDeps(): Promise<ProvisionDeps> {
  const { prisma } = await import("@/lib/prisma");
  return {
    findByGoogleId: (googleId) =>
      prisma.user.findUnique({ where: { googleId }, select: { id: true, referenceId: true } }),
    async loadClerkUser(clerkUserId) {
      const { clerkClient } = await import("@clerk/nextjs/server");
      const client = await clerkClient();
      try {
        return toClerkPayload(await client.users.getUser(clerkUserId));
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },
  };
}

/** Finds or creates the users row for a Clerk user (plan §8.5). Database errors propagate. */
export async function provisionUser(clerkUserId: string, deps?: ProvisionDeps): Promise<ProvisionResult> {
  const d = deps ?? (await defaultDeps());

  const existing = await d.findByGoogleId(clerkUserId);
  if (existing) return { status: "ok", userId: existing.id, userRef: existing.referenceId, created: false, relinked: false };

  let clerkUser: ClerkUserPayload | null;
  try {
    clerkUser = await d.loadClerkUser(clerkUserId);
  } catch {
    return { status: "clerk_unavailable" };
  }
  if (!clerkUser || clerkUser.id !== clerkUserId) return { status: "clerk_user_missing" };

  const outcome = await handleClerkEvent({ type: "user.created", data: clerkUser }, d.store);
  if (outcome.status === "applied" && outcome.userId != null && outcome.userRef) {
    return {
      status: "ok",
      userId: outcome.userId,
      userRef: outcome.userRef,
      created: outcome.claims === "new",
      relinked: outcome.changed === true && outcome.claims === "sync",
    };
  }
  if (outcome.error === "unverified_email") return { status: "unverified_email" };
  return { status: "clerk_user_missing" };
}
