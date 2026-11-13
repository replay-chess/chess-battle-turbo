/**
 * Phase-04 plan 12.2 (`fanout.int.test.ts`; 8.5.4, 7.5.3, AP-06) on a real Postgres after `prisma migrate deploy`,
 * through the Dodo webhook route with signed test deliveries:
 *
 *   subscription.active (trial) for a user with a waiting import run → the run and its account QUEUED, the
 *   IMPORT_SYNC job inserted at IMPORT_SYNC_INITIAL, the worker kicked, `entitlement:changed` sent to a fake
 *   /internal/emit with `{v: 1, targets: [{userRef}], …}`, the trial-ledger row written (email + every handle), the
 *   pending checkout cleared, `trial_started`;
 *   the same delivery again → `duplicate`, no second job, no second emit;
 *   a stale snapshot (an older event time than the stored subscriptionSourceAt) → the CAS writes nothing and NO fan-out
 *   runs;
 *   trialing → paid (the first charge) → the analysis backlog released once at BACKLOG priority; a later renewal
 *   releases nothing more;
 *   entitled → lapsed → membershipEndedAt = the event time.
 *
 * Skipped unless TEST_DATABASE_URL is set (a throwaway local Postgres; never Neon).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import { billingWorld, dodoSubscription, installFakes, makeFakes, primeEnv, signedDodo, TEST_URL, type Handlers } from "../helpers/billing-world";
import { jsonOf } from "../helpers/route-harness";

primeEnv();

const DAY = 86_400_000;

describe("entitlement fan-out through the Dodo webhook (Postgres)", { skip: TEST_URL ? false : "TEST_DATABASE_URL not set" }, () => {
  const w = billingWorld();
  const fakes = makeFakes();
  let restore: () => void = () => {};
  let WEBHOOK!: Handlers;
  let ledger!: typeof import("@/lib/billing/trial-ledger");

  before(async () => {
    restore = await installFakes(fakes);
    WEBHOOK = (await import("@/app/api/webhook/dodo-payments/route")) as Handlers;
    ledger = await import("@/lib/billing/trial-ledger");
  });
  after(async () => {
    restore();
    await w.teardown();
  });

  async function deliver(type: string, data: unknown, opts: { id?: string; at?: Date } = {}) {
    const signed = signedDodo(type, data, opts);
    const { res, recorded } = await w.call(WEBHOOK.POST!, null, {
      method: "POST",
      path: "/api/webhook/dodo-payments",
      headers: signed.headers,
      body: signed.body,
      now: Date.now(),
    });
    assert.equal(res.status, 200, await res.clone().text());
    await w.runAfter(recorded);
    return (await jsonOf(res)).data as { received: true; duplicate: boolean };
  }

  const q = <T>(sql: string, ...values: unknown[]) => w.db.$queryRawUnsafe<T[]>(sql, ...values);

  it("trial start → release, kick, emit, ledger; duplicate → nothing; stale → nothing; first charge → backlog once; lapse → membershipEndedAt", async () => {
    const u = await w.makeUser({ onboardingStep: "ACTIVATING" });
    await w.db.$executeRawUnsafe(
      `UPDATE users SET "pendingCheckoutSessionId" = 'cks_fan', "pendingCheckoutPlan" = 'monthly', "pendingCheckoutAt" = (now() AT TIME ZONE 'UTC'),
                        "lastCheckoutSource" = 'onboarding' WHERE id = $1`,
      u.id,
    );
    const handle = `owl_${randomUUID().slice(0, 6)}`;
    const accountId = await w.linkAccount(u.id, "CHESSCOM", handle, false);
    const runId = await w.waitingRun(u.id, accountId);
    await w.seedImportedGames(u.id, 12);

    // 1. The trial starts.
    const t0 = new Date(Date.now() - 5 * 60_000);
    const sub = dodoSubscription({
      email: u.email,
      clerkUserId: u.googleId,
      created_at: new Date(t0.getTime() - 1_000).toISOString(),
      next_billing_date: new Date(t0.getTime() + 7 * DAY).toISOString(),
    });
    const activeId = `msg_${randomUUID()}`;
    assert.equal((await deliver("subscription.active", sub, { id: activeId, at: t0 })).duplicate, false);

    const [run] = await q<{ status: string }>(`SELECT status::text FROM import_runs WHERE id = $1`, runId);
    assert.equal(run!.status, "QUEUED");
    const [acc] = await q<{ importState: string }>(`SELECT "importState"::text FROM linked_accounts WHERE id = $1`, accountId);
    assert.equal(acc!.importState, "QUEUED");
    const jobs = await q<{ kind: string; priority: number; payload: { v: number; linkedAccountId: string; runId: string; trigger: string } }>(
      `SELECT kind::text, priority, payload FROM jobs WHERE "dedupeKey" = $1`,
      `import:${accountId}`,
    );
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]!.kind, "IMPORT_SYNC");
    assert.equal(jobs[0]!.priority, JOB_PRIORITY.IMPORT_SYNC_INITIAL);
    assert.deepEqual(jobs[0]!.payload, { v: 1, linkedAccountId: String(accountId), runId: String(runId), trigger: "INITIAL" });
    assert.equal(fakes.kicks.length, 1);
    assert.deepEqual((fakes.kicks[0] as { kinds: string[] }).kinds, ["IMPORT_SYNC", "IMPORT_PURGE"]);

    const emits = fakes.emits.filter((e) => e.event === "entitlement:changed");
    assert.equal(emits.length, 1);
    const emitted = emits[0] as unknown as { v: number; targets: unknown; data: { v: number; entitlement: { entitled: boolean; state: string } } };
    assert.equal(emitted.v, 1);
    assert.deepEqual(emitted.targets, [{ userRef: u.ref }]);
    assert.deepEqual([emitted.data.v, emitted.data.entitlement.entitled, emitted.data.entitlement.state], [1, true, "trial"]);

    const rows = await q<{ handleHashes: string[] }>(`SELECT "handleHashes" FROM trial_ledger WHERE "emailHash" = $1`, ledger.trialLedgerEmailHash(u.email));
    assert.equal(rows.length, 1, "the ledger row for the email");
    assert.deepEqual(rows[0]!.handleHashes, [ledger.handleHash("chesscom", handle, false)], "every linked handle, unverified ones as u:");

    const [userAfter] = await q<{ pendingCheckoutSessionId: string | null; trialStartedAt: Date | null }>(
      `SELECT "pendingCheckoutSessionId", "trialStartedAt" FROM users WHERE id = $1`,
      u.id,
    );
    assert.equal(userAfter!.pendingCheckoutSessionId, null);
    assert.ok(userAfter!.trialStartedAt);
    assert.deepEqual(fakes.events.map((e) => [e.event, e.props.plan_interval, e.props.source]), [["trial_started", "month", "onboarding"]]);
    const backlogBefore = await q<{ n: number }>(`SELECT count(*)::int AS n FROM jobs WHERE "userId" = $1 AND kind = 'ANALYZE_GAME'`, u.id);
    assert.equal(backlogBefore[0]!.n, 0, "no backlog during the trial (D4-09)");

    // 2. The same delivery again: webhook_events says duplicate; nothing else happens.
    fakes.reset();
    assert.equal((await deliver("subscription.active", sub, { id: activeId, at: t0 })).duplicate, true);
    assert.equal((await q<{ n: number }>(`SELECT count(*)::int AS n FROM jobs WHERE "dedupeKey" = $1`, `import:${accountId}`))[0]!.n, 1);
    assert.equal(fakes.emits.length, 0);
    assert.equal(fakes.kicks.length, 0);

    // 3. A stale snapshot (older provider time, a new delivery id): the CAS writes nothing, no fan-out.
    const stale = await deliver("subscription.on_hold", { ...sub, status: "on_hold" }, { at: new Date(t0.getTime() - 60_000) });
    assert.equal(stale.duplicate, false);
    const [event] = await q<{ status: string }>(`SELECT status FROM webhook_events WHERE type = 'subscription.on_hold' ORDER BY "receivedAt" DESC LIMIT 1`);
    assert.equal(event!.status, "stale");
    assert.equal(fakes.emits.length, 0, "a stale snapshot fans out nothing (AP-06)");
    const [still] = await q<{ subscriptionStatus: string }>(`SELECT "subscriptionStatus" FROM users WHERE id = $1`, u.id);
    assert.equal(still!.subscriptionStatus, "active");

    // 4. The first charge: the period moves a month past the trial end → the backlog is released once.
    const t1 = new Date(t0.getTime() + 60_000);
    const renewed = { ...sub, next_billing_date: new Date(t0.getTime() + 37 * DAY).toISOString() };
    await deliver("subscription.renewed", renewed, { at: t1 });
    const backlog = await q<{ priority: number; payload: { reason: string } }>(
      `SELECT priority, payload FROM jobs WHERE "userId" = $1 AND kind = 'ANALYZE_GAME'`,
      u.id,
    );
    assert.equal(backlog.length, 12, "every unanalysed imported game, within the cap");
    assert.ok(backlog.every((j) => j.priority === JOB_PRIORITY.BACKLOG && j.payload.reason === "import"));
    assert.ok(fakes.events.some((e) => e.event === "subscription_activated"));
    const next = { ...renewed, next_billing_date: new Date(t0.getTime() + 67 * DAY).toISOString() };
    await deliver("subscription.renewed", next, { at: new Date(t1.getTime() + 60_000) });
    assert.equal((await q<{ n: number }>(`SELECT count(*)::int AS n FROM jobs WHERE "userId" = $1 AND kind = 'ANALYZE_GAME'`, u.id))[0]!.n, 12);

    // 5. The lapse: entitled → not entitled sets membershipEndedAt to the event time.
    const t2 = new Date(t1.getTime() + 120_000);
    await deliver("subscription.expired", { ...next, status: "expired" }, { at: t2 });
    const [ended] = await q<{ membershipEndedAt: Date | null }>(`SELECT "membershipEndedAt" FROM users WHERE id = $1`, u.id);
    assert.equal(ended!.membershipEndedAt?.toISOString(), t2.toISOString());
  });

  // regression: ledger-no-backstop (FIX-2, billing review round 2): a fan-out whose ledger step failed (it only logs,
  // and the webhook was already answered) never recorded the trial; the daily sweep writes it.
  it("the cron trial-ledger sweep records a trial the fan-out lost, merges handles, and is idempotent", async () => {
    const { createTrialLedgerSweep, LEDGER_SWEEP_CANDIDATES_SQL, LEDGER_SWEEP_WRITE_SQL, LEDGER_SWEEP_DAYS, LEDGER_SWEEP_LIMIT } = await import(
      "@/lib/cron/tasks/trial-ledger-sweep"
    );
    const u = await w.makeUser({});
    const started = new Date(Date.now() - 2 * DAY);
    await w.db.$executeRawUnsafe(
      `UPDATE users SET "trialStartedAt" = $2::timestamp(3), "trialEndsAt" = $2::timestamp(3) + interval '7 days' WHERE id = $1`,
      u.id,
      started.toISOString(),
    );
    const handle = `swp_${randomUUID().slice(0, 6)}`;
    await w.linkAccount(u.id, "LICHESS", handle, true);
    const old = await w.makeUser({});
    await w.db.$executeRawUnsafe(`UPDATE users SET "trialStartedAt" = (now() AT TIME ZONE 'UTC') - interval '40 days' WHERE id = $1`, old.id);
    const hashOf = (email: string) => ledger.trialLedgerEmailHash(email);
    assert.equal((await q(`SELECT 1 FROM trial_ledger WHERE "emailHash" = $1`, hashOf(u.email))).length, 0, "the fan-out's write was lost");

    const db = {
      candidates: (now: Date) => q<{ email: string; trialStartedAt: Date; handles: never[] }>(LEDGER_SWEEP_CANDIDATES_SQL, now.toISOString(), LEDGER_SWEEP_DAYS, LEDGER_SWEEP_LIMIT),
      async write(rows: unknown[]) {
        const out = await q<{ inserted: number; swept: number }>(LEDGER_SWEEP_WRITE_SQL, JSON.stringify(rows));
        return { inserted: Number(out[0]!.inserted), swept: Number(out[0]!.swept) };
      },
    };
    const sweep = createTrialLedgerSweep(db);
    const ctx = { now: new Date(), clock: () => Date.now(), sleep: async () => {}, after: () => {}, deadlineMs: Date.now() + 45_000 };
    const first = await sweep.run(ctx);
    assert.ok((first.detail?.recovered ?? 0) >= 1, "the lost trial is recovered");
    const [row] = await q<{ handleHashes: string[]; firstTrialAt: Date }>(
      `SELECT "handleHashes", "firstTrialAt" FROM trial_ledger WHERE "emailHash" = $1`,
      hashOf(u.email),
    );
    assert.deepEqual(row!.handleHashes, [ledger.handleHash("lichess", handle, true)]);
    assert.equal(row!.firstTrialAt.toISOString(), started.toISOString(), "the trial's own start");
    assert.equal((await q(`SELECT 1 FROM trial_ledger WHERE "emailHash" = $1`, hashOf(old.email))).length, 0, "outside the window");
    // A dot variant of the email now hits the ledger (the second trial the backstop prevents).
    if (u.email.includes("@")) {
      const hit = await ledger.checkTrialLedger(w.db as never, { email: u.email.toUpperCase(), handles: [] });
      assert.deepEqual(hit, { hit: true, kind: "email" });
    }
    const again = await sweep.run(ctx);
    assert.equal(again.detail?.recovered, 0, "idempotent: nothing new the second time");
    assert.equal((await q(`SELECT 1 FROM trial_ledger WHERE "emailHash" = $1`, hashOf(u.email))).length, 1);
  });
});
