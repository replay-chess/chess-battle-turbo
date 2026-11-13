import "server-only";
import type { PrismaClient } from "@repo/db";
import { getRouteDeps } from "@/lib/api/context";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  fieldsFromSnapshot,
  isEntitled,
  providerTimeOf,
  shouldApplySnapshot,
  summarizeEntitlement,
  type EntitlementRecord,
  type EntitlementSummary,
  type SnapshotFields,
  type SubscriptionSnapshot,
} from "./entitlement-rules";
import { getProductCatalog } from "./products";
import { trialFieldsFromSnapshot } from "./trial-rules";

export type { EntitlementRecord, EntitlementSummary, SubscriptionSnapshot };
export { isEntitled } from "./entitlement-rules";

/** Prisma `select` covering everything entitlement needs. */
export const ENTITLEMENT_SELECT = {
  plan: true,
  planInterval: true,
  subscriptionId: true,
  subscriptionStatus: true,
  subscriptionProductId: true,
  currentPeriodEnd: true,
  cancelAtPeriodEnd: true,
  subscriptionUpdatedAt: true,
  trialStartedAt: true,
  trialEndsAt: true,
} as const;

/** What the compare-and-set reads: the entitlement columns plus the match keys and the ordering key. */
export const SNAPSHOT_USER_SELECT = {
  id: true,
  referenceId: true,
  email: true,
  dodoCustomerId: true,
  subscriptionSourceAt: true,
  ...ENTITLEMENT_SELECT,
} as const;

export type SnapshotUser = EntitlementRecord & {
  id: bigint;
  /** Public reference id (telemetry distinct id). */
  referenceId: string;
  email: string;
  dodoCustomerId: string | null;
  subscriptionSourceAt: Date | null;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
};

/** The columns one apply may write (besides `subscriptionUpdatedAt`, the write time). */
export type SnapshotWrite = SnapshotFields & {
  trialStartedAt?: Date;
  trialEndsAt?: Date;
  dodoCustomerId?: string;
  subscriptionSourceAt?: Date;
};

export function summarizeUserEntitlement(
  record: EntitlementRecord & { trialStartedAt?: Date | null; trialEndsAt?: Date | null },
  now?: Date,
): EntitlementSummary {
  return summarizeEntitlement(record, getProductCatalog(), now);
}

/**
 * Result of `applySubscriptionSnapshot` (plan §7.7, §8.11). `changed` is true only when a row was
 * written. The webhook stores `status` and `userId` on its `webhook_events` row; callers sync the
 * Clerk claims only when `changed` is true. `entitlement` is the user's state after the apply.
 */
export type ApplyOutcome =
  | {
      status: "applied";
      changed: boolean;
      userId: bigint;
      userRef: string;
      entitlement: EntitlementSummary;
      /** Phase 4 (8.5.4): the summary of the row the compare-and-set read, i.e. the state before this write. */
      before?: EntitlementSummary;
    }
  | { status: "stale"; changed: false; userId: bigint; userRef: string; entitlement: EntitlementSummary }
  /**
   * FIX-1: a second, different subscription that would grant access while the row holds another entitled one (two
   * checkouts paid at once; FIX-2: trial or paid, from any path). Nothing is written; the webhook cancels it at Dodo
   * (a paid one is listed for a refund, dodo-events.ts). Decided from the compare-and-set's own user read: no extra
   * statement. `entitlement` is the row's (entitled) state.
   */
  | { status: "duplicate"; changed: false; userId: bigint; userRef: string; entitlement: EntitlementSummary; kept: string }
  | { status: "unmatched"; changed: false }
  | { status: "error"; changed: false; userId: bigint; userRef: string; error: "cas_exhausted" };

export interface ApplyOptions {
  /** Provider time of the snapshot (webhook timestamp). Null/absent for an API read without one. */
  eventTime?: Date | null;
  /** Where the snapshot came from, for logs. */
  source: "webhook" | "api";
  /** Prefer this user when the caller already knows them. */
  userId?: bigint;
  /** Write time for `subscriptionUpdatedAt` and the summary clock (tests). Default: now. */
  now?: Date;
}

/** The two statements the compare-and-set needs. Prisma in production; a fake in unit tests. */
export interface SnapshotStore {
  /** One statement: every row matching the user id, the Dodo customer id or the email. */
  findCandidates(keys: { userId?: bigint; customerId?: string; email?: string }): Promise<SnapshotUser[]>;
  /**
   * `UPDATE users SET … WHERE id = $1 AND "subscriptionSourceAt" IS NOT DISTINCT FROM $2`.
   * Returns the number of rows written (0 when another writer won the race).
   */
  compareAndSet(id: bigint, expectedSourceAt: Date | null, data: SnapshotWrite & { subscriptionUpdatedAt: Date }): Promise<number>;
}

type UserDelegateClient = Pick<PrismaClient, "user">;

export function createPrismaSnapshotStore(db: UserDelegateClient): SnapshotStore {
  return {
    async findCandidates({ userId, customerId, email }) {
      const or: Array<{ id: bigint } | { dodoCustomerId: string } | { email: string }> = [];
      if (userId !== undefined) or.push({ id: userId });
      if (customerId) or.push({ dodoCustomerId: customerId });
      if (email) or.push({ email });
      if (or.length === 0) return [];
      return db.user.findMany({ where: { OR: or }, select: SNAPSHOT_USER_SELECT, take: 3 });
    },
    async compareAndSet(id, expectedSourceAt, data) {
      const result = await db.user.updateMany({
        // Prisma renders `subscriptionSourceAt: null` as IS NULL, so this is null-safe equality.
        where: { id, subscriptionSourceAt: expectedSourceAt },
        data,
      });
      return result.count;
    },
  };
}

const prismaStore = createPrismaSnapshotStore(prisma);

export type ApplyLog = (level: "debug" | "info" | "warn", message: string, context: Record<string, string>) => void;
/** Logging must never fail a billing write (a throw here after the UPDATE would report `error`). */
const defaultLog: ApplyLog = (level, message, context) => {
  try {
    logger[level](message, context);
  } catch {
    // ignore
  }
};

/** What the entitlement fan-out (phase-04 plan 8.5.4, lib/billing/fanout.ts) gets after a write that landed. */
export type AppliedChange = {
  userId: bigint;
  userRef: string;
  before: EntitlementSummary;
  after: EntitlementSummary;
  /** The provider time of the snapshot, else the write time. */
  eventTime: Date;
  source: "webhook" | "api";
};

export interface ApplyDeps {
  store: SnapshotStore;
  log: ApplyLog;
  /**
   * Post-CAS hook (phase-04 plan 8.5.4): runs once per write that landed (`applied && changed`), never for a stale,
   * unchanged or lost snapshot. Default: the entitlement fan-out (fanout.ts onEntitlementApplied) queued in
   * route()'s `after()` when the production store is used; a caller that injects its own `store` (tests,
   * scripts) owns its side effects and gets no fan-out unless it passes one.
   */
  afterApplied: (change: AppliedChange) => void;
}

/**
 * The production hook: queues the fan-out in route()'s `after()` SYNCHRONOUSLY (inside the request, so Next keeps the
 * function alive for it); fanout.ts (the socket emit, the import release) loads inside the task. Outside a request
 * scope (a script) the fan-out runs detached.
 */
const scheduleFanout = (change: AppliedChange): void => {
  const run = async (): Promise<void> => {
    const { onEntitlementApplied } = await import("./fanout");
    await onEntitlementApplied(change);
  };
  try {
    getRouteDeps().after(run);
  } catch {
    void run().catch((err: unknown) => defaultLog("warn", "[billing] entitlement fan-out failed", { error: err instanceof Error ? err.name : "unknown" }));
  }
};

/** Today's lookup order (Phase 0): the known user id, then the Dodo customer id, then the email. */
export function pickSnapshotUser(
  candidates: readonly SnapshotUser[],
  keys: { userId?: bigint; customerId?: string; email?: string },
): SnapshotUser | null {
  return (
    (keys.userId !== undefined ? candidates.find((c) => c.id === keys.userId) : undefined) ??
    (keys.customerId ? candidates.find((c) => c.dodoCustomerId === keys.customerId) : undefined) ??
    (keys.email ? candidates.find((c) => c.email === keys.email) : undefined) ??
    null
  );
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }
  return (a ?? null) === (b ?? null);
}

/** True when writing `data` would change any persisted column of `user` (DB-06: no-op snapshots write nothing). */
export function changesAnything(user: object, data: object): boolean {
  const current = user as Record<string, unknown>;
  return Object.entries(data).some(([key, value]) => value !== undefined && !sameValue(current[key], value));
}

/** How many times a lost compare-and-set re-reads before giving up (plan §8.11). */
export const CAS_ATTEMPTS = 3;

/**
 * Writes a Dodo subscription onto the matching user row with an optimistic compare-and-set on
 * `subscriptionSourceAt` (plan §8.11; ADB DB-06/DB-07, CA AP-06).
 *
 * - The user is found by the known id, then the Dodo customer id, then the email (one statement).
 * - A snapshot older than the stored provider time is `stale` and writes nothing.
 * - A snapshot that changes no persisted column is `applied` with `changed: false` and writes nothing.
 * - The write only lands when `subscriptionSourceAt` still holds the value read; otherwise another
 *   writer won, and the row is re-read and the decision made again (up to 3 attempts).
 * - `subscriptionUpdatedAt` is the write time; `subscriptionSourceAt` is only ever a provider time.
 */
export async function applySubscriptionSnapshot(
  snapshot: SubscriptionSnapshot,
  options: ApplyOptions,
  deps: Partial<ApplyDeps> = {},
): Promise<ApplyOutcome> {
  const store = deps.store ?? prismaStore;
  const log = deps.log ?? defaultLog;
  const afterApplied = deps.afterApplied ?? (deps.store ? undefined : scheduleFanout);
  const keys = {
    userId: options.userId,
    customerId: snapshot.customer?.customer_id || undefined,
    email: snapshot.customer?.email || undefined,
  };
  const sourceAt = options.eventTime ?? providerTimeOf(snapshot);
  let firstReadSourceAt: Date | null | undefined;
  let last: SnapshotUser | null = null;

  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
    const user = pickSnapshotUser(await store.findCandidates(keys), keys);
    if (!user) {
      log("warn", "[billing] no user for subscription snapshot", {
        source: options.source,
        subscription: snapshot.subscription_id,
      });
      return { status: "unmatched", changed: false };
    }
    last = user;
    const now = options.now ?? new Date();

    // An untimed snapshot (API read) that lost the race to a timed writer (a webhook) yields: the
    // webhook's state is at least as new as what we read from Dodo before it landed.
    const storedAt = user.subscriptionSourceAt;
    const lostToTimedWriter =
      !sourceAt &&
      firstReadSourceAt !== undefined &&
      storedAt !== null &&
      (firstReadSourceAt === null || storedAt.getTime() > firstReadSourceAt.getTime());
    if (firstReadSourceAt === undefined) firstReadSourceAt = storedAt;

    // A second entitled subscription next to the entitled one the row holds is a duplicate, trial or paid (an
    // entitled member cannot start a checkout, so it can only come from two checkouts opened at once). It is never
    // applied, whichever path brings it: the webhook (which cancels it at Dodo, dodo-events.ts), the activation
    // self-heal or a refresh. FIX-2 (review round 2): trial snapshots were exempt here because the webhook's
    // duplicate-trial guard runs before the apply, so the self-heal and the refresh (which never pass that guard)
    // replaced the member's entitled trial X with the second trial Y; nothing then cancelled X, which charged on day 8.
    if (
      user.subscriptionId &&
      user.subscriptionId !== snapshot.subscription_id &&
      isEntitled(user, now) &&
      isEntitled(fieldsFromSnapshot(snapshot, {}), now)
    ) {
      log("warn", "[billing] duplicate subscription not applied", {
        source: options.source,
        subscription: snapshot.subscription_id,
        kind: snapshot.trial_period_days && snapshot.trial_period_days > 0 ? "trial" : "paid",
      });
      return {
        status: "duplicate",
        changed: false,
        userId: user.id,
        userRef: user.referenceId,
        entitlement: summarizeUserEntitlement(user, now),
        kept: user.subscriptionId,
      };
    }
    if (lostToTimedWriter || !shouldApplySnapshot(user, snapshot, sourceAt, now)) {
      log("debug", "[billing] stale subscription snapshot ignored", {
        source: options.source,
        subscription: snapshot.subscription_id,
        status: snapshot.status,
      });
      return { status: "stale", changed: false, userId: user.id, userRef: user.referenceId, entitlement: summarizeUserEntitlement(user, now) };
    }

    const fields = fieldsFromSnapshot(snapshot, getProductCatalog());
    // Record the first (and only) free trial. Never moves once set.
    const trial = trialFieldsFromSnapshot(user, snapshot);
    const customerId = keys.customerId;
    const data: SnapshotWrite = {
      ...fields,
      ...(trial ?? {}),
      // Backfill the customer link only when the row has none.
      ...(customerId && !user.dodoCustomerId ? { dodoCustomerId: customerId } : {}),
      // Never move the ordering key backwards (same-subscription stale events returned above; a
      // different subscription that wins on access keeps the newer of the two times).
      ...(sourceAt && (!storedAt || sourceAt.getTime() >= storedAt.getTime()) ? { subscriptionSourceAt: sourceAt } : {}),
    };

    if (!changesAnything(user, data)) {
      return { status: "applied", changed: false, userId: user.id, userRef: user.referenceId, entitlement: summarizeUserEntitlement(user, now) };
    }

    const written = await store.compareAndSet(user.id, storedAt, { ...data, subscriptionUpdatedAt: now });
    if (written === 1) {
      log("info", `[billing] ${options.source}: subscription applied`, {
        user: String(user.id),
        status: fields.subscriptionStatus ?? "none",
        interval: fields.planInterval ?? "none",
      });
      const before = summarizeUserEntitlement(user, now);
      const entitlement = summarizeUserEntitlement({ ...user, ...data, subscriptionUpdatedAt: now }, now);
      if (afterApplied) {
        try {
          afterApplied({ userId: user.id, userRef: user.referenceId, before, after: entitlement, eventTime: sourceAt ?? now, source: options.source });
        } catch (err) {
          // The write landed; a failing hook must not turn it into an error (the fan-out is best-effort, §8.5.4).
          log("warn", "[billing] post-apply hook failed", { user: String(user.id), error: err instanceof Error ? err.name : "unknown" });
        }
      }
      return { status: "applied", changed: true, userId: user.id, userRef: user.referenceId, entitlement, before };
    }
    // 0 rows: another writer changed subscriptionSourceAt between our read and write. Re-read.
  }

  log("warn", "[billing] compare-and-set exhausted", {
    source: options.source,
    subscription: snapshot.subscription_id,
  });
  return { status: "error", changed: false, userId: last!.id, userRef: last!.referenceId, error: "cas_exhausted" };
}
