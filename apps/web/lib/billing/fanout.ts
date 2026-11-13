// The entitlement fan-out (phase-04 plan 8.5.4; 7.5.3; D4-07, D4-09). Runs in `after()` once per billing write that
// landed (`applySubscriptionSnapshot` → `applied && changed`, the post-CAS hook in entitlement.ts), never for a stale,
// unchanged or replayed snapshot, so a duplicate webhook delivery fans out nothing.
//
//   1. emit `entitlement:changed` (the wire Entitlement + subscriptionUpdatedAt) to the user room;
//   2. not entitled → entitled: release the WAITING_FOR_MEMBERSHIP import runs in one statement (WP-C
//      releaseWaitingImports, which also queues a DAILY sync of a returning member's auto-import accounts not synced
//      for 12 h) and kick the worker when it queued anything;
//   3. the first trialing snapshot: the trial ledger row (every linked handle) + PostHog `trial_started`;
//   4. the first paid period (trial → paid, or a paid first subscription): release the analysis backlog
//      (`@repo/db/import-backlog`, idempotent) + `subscription_activated`;
//   5. entitled → not entitled: `membershipEndedAt = eventTime` (nothing is cancelled; the worker parks runs);
//   6. entitled: `pendingCheckout* = NULL`.
//
// Every step is independent and idempotent: a failure is logged and the next step still runs (the fan-out never
// throws, it runs after the response). Re-running the whole fan-out for the same change is harmless: the release only
// moves WAITING rows, the ledger write merges, the backlog release finds nothing new, the end date only moves forward.
// Steps need one read of the user (role, email, handles, …); the dependencies are injected for the tests.
import type { EntitlementChangedEvent } from "@repo/contracts/socket/user";
import { entitlementOf, isPaywallEnabled } from "@/lib/auth/membership";
import type { EntitlementSummary } from "./entitlement-rules";
import type { LedgerHandle } from "./trial-ledger";

export type FanoutInput = {
  userId: bigint;
  userRef: string;
  /** null when the caller has no prior state (treated as "nothing, not entitled"). */
  before: EntitlementSummary | null;
  after: EntitlementSummary;
  eventTime: Date;
  source: "webhook" | "api";
};

/** The one read the fan-out needs. */
export type FanoutUser = {
  role: string;
  email: string;
  dodoCustomerId: string | null;
  subscriptionUpdatedAt: Date | null;
  trialStartedAt: Date | null;
  membershipEndedAt: Date | null;
  lastCheckoutSource: string | null;
  handles: LedgerHandle[];
};

export type FanoutStep =
  | "emit"
  | "release_imports"
  | "kick"
  | "ledger"
  | "trial_started"
  | "backlog"
  | "subscription_activated"
  | "membership_ended"
  | "clear_pending";

export interface FanoutDeps {
  readUser(userId: bigint): Promise<FanoutUser | null>;
  /** `entitlement:changed` through POST /internal/emit; false when the socket refused or was unreachable. */
  emit(userRef: string, data: EntitlementChangedEvent): Promise<boolean>;
  /** WP-C `releaseWaitingImports` (one statement: INITIAL runs + a returning member's DAILY syncs). */
  releaseWaitingImports(userId: bigint): Promise<{ released: number; queued: number }>;
  /** WP-C `kickImports("import")` (never throws). */
  kickImports(): Promise<void>;
  recordLedger(input: { email: string; handles: LedgerHandle[]; firstTrialAt: Date | null }): Promise<void>;
  releaseBacklog(userId: bigint): Promise<{ queued: number; slices: number }>;
  setMembershipEnded(userId: bigint, at: Date): Promise<void>;
  clearPendingCheckout(userId: bigint): Promise<void>;
  capture(event: "trial_started" | "subscription_activated", props: { plan_interval: "month" | "year"; source: EventSource }, distinctId: string): Promise<void>;
  /** The wire Entitlement for the emit (membership.ts entitlementOf with the env's paywall switch). */
  toWire(after: EntitlementSummary, user: FanoutUser, now: Date): EntitlementChangedEvent["entitlement"];
  log(level: "info" | "warn", message: string, context: Record<string, string | number>): void;
  now(): Date;
  /** The stored entitlement summary (the payment-failure emit carries the current state). */
  readSummary(userId: bigint): Promise<EntitlementSummary | null>;
}

type EventSource = "pricing" | "onboarding" | "paywall" | "renew" | "unknown";

const DAY_MS = 86_400_000;

/**
 * A paid period: entitled, and either no trial was ever used or the current period ends more than a day after the
 * trial's end (the first charge moved it). Decided from the stored dates, never from "now", so a renewal webhook that
 * arrives after the trial ended is still recognised as the trial → paid transition.
 */
export function isPaidPeriod(s: EntitlementSummary): boolean {
  if (!s.entitled) return false;
  if (!s.trial.used) return true;
  const trialEnd = s.trial.endsAt ? Date.parse(s.trial.endsAt) : NaN;
  const periodEnd = s.currentPeriodEnd ? Date.parse(s.currentPeriodEnd) : NaN;
  if (Number.isNaN(trialEnd) || Number.isNaN(periodEnd)) return false;
  return periodEnd > trialEnd + DAY_MS;
}

const NOTHING: EntitlementSummary = {
  entitled: false,
  plan: null,
  planKey: null,
  interval: null,
  priceCents: null,
  status: null,
  subscriptionId: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  trial: { active: false, used: false, endsAt: null, daysLeft: 0 },
};

/** Which steps a change triggers (pure; fanout.test.ts walks every transition). */
export function fanoutPlan(before: EntitlementSummary | null, after: EntitlementSummary): {
  becameEntitled: boolean;
  lostEntitlement: boolean;
  firstTrial: boolean;
  firstPaid: boolean;
} {
  const b = before ?? NOTHING;
  return {
    becameEntitled: !b.entitled && after.entitled,
    lostEntitlement: b.entitled && !after.entitled,
    firstTrial: after.trial.active && !b.trial.used,
    firstPaid: isPaidPeriod(after) && !isPaidPeriod(b),
  };
}

function eventSource(raw: string | null): EventSource {
  return raw === "pricing" || raw === "onboarding" || raw === "paywall" || raw === "renew" ? raw : "unknown";
}

function intervalOf(s: EntitlementSummary): "month" | "year" {
  return s.interval === "year" ? "year" : "month";
}

/** The fan-out. Never throws; returns the steps that ran (and failed) for logs and tests. */
export async function onEntitlementApplied(
  input: FanoutInput,
  deps?: FanoutDeps,
): Promise<{ ran: FanoutStep[]; failed: FanoutStep[] }> {
  const d = deps ?? (await defaultFanoutDeps());
  const ran: FanoutStep[] = [];
  const failed: FanoutStep[] = [];
  const step = async (name: FanoutStep, fn: () => Promise<unknown>): Promise<void> => {
    try {
      await fn();
      ran.push(name);
    } catch (err) {
      failed.push(name);
      d.log("warn", "[billing] fan-out step failed", { step: name, user: String(input.userId), error: err instanceof Error ? err.name : "unknown" });
    }
  };

  let user: FanoutUser | null = null;
  try {
    user = await d.readUser(input.userId);
  } catch (err) {
    d.log("warn", "[billing] fan-out could not read the user", { user: String(input.userId), error: err instanceof Error ? err.name : "unknown" });
  }
  if (!user) return { ran, failed: ["emit"] };
  const u = user;
  const now = d.now();
  const plan = fanoutPlan(input.before, input.after);

  // 1. The live update every open tab of the member reacts to (activation pages, the shell, the socket's `ent`).
  await step("emit", async () => {
    const ok = await d.emit(input.userRef, {
      v: 1,
      entitlement: d.toWire(input.after, u, now),
      subscriptionUpdatedAt: u.subscriptionUpdatedAt ? u.subscriptionUpdatedAt.toISOString() : null,
    });
    if (!ok) throw new Error("emit_refused");
  });

  // 2. Imports wait for the trial (D4-07): release them (and a returning member's daily syncs), then kick once.
  if (plan.becameEntitled) {
    let queued = 0;
    await step("release_imports", async () => {
      queued = (await d.releaseWaitingImports(input.userId)).queued;
    });
    if (queued > 0) await step("kick", () => d.kickImports());
  }

  // 3. One trial per person, surviving account deletion (8.4.4).
  if (plan.firstTrial) {
    await step("ledger", () => d.recordLedger({ email: u.email, handles: u.handles, firstTrialAt: u.trialStartedAt }));
    await step("trial_started", () =>
      d.capture("trial_started", { plan_interval: intervalOf(input.after), source: eventSource(u.lastCheckoutSource) }, input.userRef),
    );
  }

  // 4. The analysis backlog waits for the first charge (D4-09, 8.9).
  if (plan.firstPaid) {
    await step("backlog", async () => {
      const released = await d.releaseBacklog(input.userId);
      d.log("info", "[billing] import backlog released", { user: String(input.userId), games: released.queued, slices: released.slices });
    });
    await step("subscription_activated", () =>
      d.capture("subscription_activated", { plan_interval: intervalOf(input.after), source: eventSource(u.lastCheckoutSource) }, input.userRef),
    );
  }

  // 5. Lapse: remember when (a later return is a "returning member"); nothing is cancelled.
  if (plan.lostEntitlement) await step("membership_ended", () => d.setMembershipEnded(input.userId, input.eventTime));

  // 6. The pending checkout is done.
  if (input.after.entitled) await step("clear_pending", () => d.clearPendingCheckout(input.userId));

  return { ran, failed };
}

/**
 * The webhook's non-snapshot effects (plan 7.5.3), run in `after()` by the Dodo route:
 * - a recorded payment failure → `entitlement:changed {paymentFailed: true}` so an open activation page refetches and
 *   turns `failed` at once;
 * - a paid charge for a user whose initial import backlog was never released → the backlog release (idempotent).
 * Never throws.
 */
export async function onPaymentEffects(
  input: { userId: bigint; userRef: string; paymentFailed: boolean; releaseBacklog: boolean },
  deps?: FanoutDeps,
): Promise<{ ran: FanoutStep[]; failed: FanoutStep[] }> {
  const d = deps ?? (await defaultFanoutDeps());
  const ran: FanoutStep[] = [];
  const failed: FanoutStep[] = [];
  if (input.paymentFailed) {
    try {
      const [user, summary] = await Promise.all([d.readUser(input.userId), d.readSummary(input.userId)]);
      if (!user || !summary) throw new Error("user_missing");
      const ok = await d.emit(input.userRef, {
        v: 1,
        entitlement: d.toWire(summary, user, d.now()),
        subscriptionUpdatedAt: user.subscriptionUpdatedAt ? user.subscriptionUpdatedAt.toISOString() : null,
        paymentFailed: true,
      });
      if (!ok) throw new Error("emit_refused");
      ran.push("emit");
    } catch (err) {
      failed.push("emit");
      d.log("warn", "[billing] payment-failure emit failed", { user: String(input.userId), error: err instanceof Error ? err.message : "unknown" });
    }
  }
  if (input.releaseBacklog) {
    try {
      const released = await d.releaseBacklog(input.userId);
      d.log("info", "[billing] import backlog released after a paid charge", { user: String(input.userId), games: released.queued, slices: released.slices });
      ran.push("backlog");
    } catch (err) {
      failed.push("backlog");
      d.log("warn", "[billing] backlog release failed", { user: String(input.userId), error: err instanceof Error ? err.name : "unknown" });
    }
  }
  return { ran, failed };
}

// ── Production dependencies ──────────────────────────────────────────────────────────────────────────────────────

/** The fan-out's read: the user and the handles of every link (for the ledger), one statement. */
export const FANOUT_USER_SQL = `SELECT u.role::text AS role, u.email, u."dodoCustomerId", u."subscriptionUpdatedAt", u."trialStartedAt",
       u."membershipEndedAt", u."lastCheckoutSource",
       COALESCE((SELECT json_agg(json_build_object('provider', lower(la.provider::text), 'usernameLower', la."usernameLower",
                                                   'verified', la."verifiedAt" IS NOT NULL) ORDER BY la.id)
                   FROM linked_accounts la WHERE la."userId" = u.id), '[]'::json) AS handles
FROM users u WHERE u.id = $1`;

/** Plan 8.5.4 step 5: the end date only moves forward (a replayed older lapse never rewinds it). */
/**
 * The kick after a backlog release (D1): the analysis lane never polls, so the slices' ANALYZE_GAME rows waited for the
 * lane's next unrelated wake. One kick naming the engine kind, with the earliest slice's time as `runAt` (a future
 * runAt only shortens the lane's sleep, no query until then). Null when nothing was queued.
 */
export function backlogKickBody(released: { queued: number; slots: { runAt: Date }[] }): {
  v: 1;
  reason: "import";
  kinds: ["ANALYZE_GAME"];
  runAt: string;
} | null {
  if (released.queued <= 0 || released.slots.length === 0) return null;
  const first = Math.min(...released.slots.map((s) => s.runAt.getTime()));
  return { v: 1, reason: "import", kinds: ["ANALYZE_GAME"], runAt: new Date(first).toISOString() };
}

export const MEMBERSHIP_ENDED_SQL = `UPDATE users SET "membershipEndedAt" = $2::timestamp(3)
WHERE id = $1 AND ("membershipEndedAt" IS NULL OR "membershipEndedAt" < $2::timestamp(3))`;

/** Plan 8.5.4 step 6. */
export const CLEAR_PENDING_SQL = `UPDATE users SET "pendingCheckoutSessionId" = NULL, "pendingCheckoutPlan" = NULL, "pendingCheckoutAt" = NULL,
  "pendingCheckoutUrl" = NULL
WHERE id = $1 AND ("pendingCheckoutSessionId" IS NOT NULL OR "pendingCheckoutAt" IS NOT NULL OR "pendingCheckoutUrl" IS NOT NULL)`;

/** `$2` as a UTC wall-clock literal for a `timestamp(3)` column. */
function utc(d: Date): string {
  return d.toISOString();
}

async function defaultFanoutDeps(): Promise<FanoutDeps> {
  const [{ prisma }, { logger }, { rawDb }] = await Promise.all([
    import("@/lib/prisma"),
    import("@/lib/logger"),
    import("@/lib/games/snapshot.server"),
  ]);
  const db = rawDb(prisma);
  return {
    async readUser(userId) {
      const rows = await prisma.$queryRawUnsafe<FanoutUser[]>(FANOUT_USER_SQL, userId);
      return rows[0] ?? null;
    },
    async emit(userRef, data) {
      const { emitEntitlementChanged } = await import("./emit");
      return emitEntitlementChanged(userRef, data);
    },
    async releaseWaitingImports(userId) {
      const { releaseWaitingImports } = await import("@/lib/jobs/import");
      return releaseWaitingImports(db, userId);
    },
    async kickImports() {
      const { kickImports } = await import("@/lib/jobs/import");
      await kickImports("import");
    },
    async recordLedger(input) {
      const { recordTrialLedger } = await import("./trial-ledger");
      await recordTrialLedger(prisma, input);
    },
    async releaseBacklog(userId) {
      const { backlogSettingsFromEnv, releaseImportBacklog } = await import("@repo/db/import-backlog");
      const released = await releaseImportBacklog(db, { userId, now: new Date(), ...backlogSettingsFromEnv() });
      const kick = backlogKickBody(released);
      if (kick) {
        const { kickWorker } = await import("@/lib/services/analysis/kick");
        await kickWorker(kick); // never throws; a lost kick waits for the lane's next due wake
      }
      return { queued: released.queued, slices: released.slots.length };
    },
    async setMembershipEnded(userId, at) {
      await prisma.$executeRawUnsafe(MEMBERSHIP_ENDED_SQL, userId, utc(at));
    },
    async clearPendingCheckout(userId) {
      await prisma.$executeRawUnsafe(CLEAR_PENDING_SQL, userId);
    },
    async capture(event, props, distinctId) {
      const { captureBillingServerEvent } = await import("./server-events");
      await captureBillingServerEvent(event, props, distinctId);
    },
    toWire(after, user, now) {
      return wireEntitlement(after, user, now);
    },
    log(level, message, context) {
      try {
        logger[level](message, Object.fromEntries(Object.entries(context).map(([k, v]) => [k, String(v)])));
      } catch {
        // Logging never fails the fan-out.
      }
    },
    now: () => new Date(),
    async readSummary(userId) {
      const { ENTITLEMENT_SELECT, summarizeUserEntitlement } = await import("./entitlement");
      const row = await prisma.user.findUnique({ where: { id: userId }, select: ENTITLEMENT_SELECT });
      return row ? summarizeUserEntitlement(row) : null;
    },
  };
}

/** membership.ts entitlementOf with this deployment's paywall switch (the same DTO GET /api/me sends). */
function wireEntitlement(after: EntitlementSummary, user: FanoutUser, now: Date): EntitlementChangedEvent["entitlement"] {
  return entitlementOf(after, { role: user.role, dodoCustomerId: user.dodoCustomerId, now, paywallEnabled: isPaywallEnabled() });
}
