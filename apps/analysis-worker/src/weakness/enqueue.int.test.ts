// The RECOMPUTE_WEAKNESS row's rules against Postgres (phase-06 plan §7.4.1, §7.1.2, Q-W12; §12.3 "Enqueue
// semantics"): the shared SQL of @repo/db/weakness-jobs and the worker's completion (queue/outcome.ts
// rerunIfFlaggedStatement) on the worker's private `jobs` copy, as replay_worker where the worker runs them and as the
// owner where the web does (TR-12's scope write: replay_app's grant, tested by the web's contract suite):
//   - QUEUED keeps the earliest runAt and the higher priority; RUNNING is flagged `rerun` and its completion re-queues
//     it after the debounce; DONE re-arms at finishedAt + 240 s; a `user` trigger with debounce 0 runs now; the
//     priority resets after DONE; payloads merge (an `analysis` trigger keeps `userAt`);
//   - TR-12: one request per 600 s from the job row (a second → queued 0 + the previous instant), two concurrent
//     requests give exactly one, the scope is written only when queued, the window moves with `now`;
//   - the kick CAS stamps at most once per 30 s, only for an overdue QUEUED row;
//   - WEAKNESS_SEED_FREEZE leaves a seeded far-future row alone;
//   - the completion's retry form returns the row it already finished (a lost response), also after another trigger
//     re-armed the row in between (FIX-1: the re-arm keeps `result`, the completion's token).
// Skipped without TEST_DATABASE_URL.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { JOB_MAX_ATTEMPTS, JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import {
  enqueueWeaknessSql,
  recomputeRetryAfterSec,
  requestRecomputeSql,
  weaknessKickCasSql,
} from "@repo/db/weakness-jobs";
import { CountingDb, fromPrisma, pgDriver, stmt, type Statement } from "../db/client";
import { lockGuardStatement, outcomeByMeStatement, rerunIfFlaggedStatement } from "../queue/outcome";
import { NOW, toClaimedJob } from "../queue/claim";
import { runToken } from "../jobs/weakness-recompute";
import { makeUser, setupInt, skipInt, TEST_URL, type IntEnv, type TestUser } from "../testing/pg";

const ME = "int-wkenq-00000001";
const S = 1_000;

describe("RECOMPUTE_WEAKNESS enqueue semantics (Postgres)", { skip: skipInt }, () => {
  let env: IntEnv;
  /** The owner on the same private schema (the web's statements: replay_app's grants are the web suite's). */
  let web: CountingDb;

  before(async () => {
    env = await setupInt("wkenq");
    const url = new URL(TEST_URL!);
    url.searchParams.set("options", `-c search_path=${env.schema},public`);
    web = new CountingDb(pgDriver(url.toString()));
  });
  after(async () => {
    await web?.close();
    await env?.close();
  });

  const run = (s: ReturnType<typeof enqueueWeaknessSql>, db: CountingDb = env.db) => db.query(fromPrisma(s));
  async function row(u: TestUser) {
    return (
      await env.owner.query(
        `SELECT id::text AS id, status::text AS status, priority, payload, attempts, "maxAttempts", "lockedBy", result,
                (extract(epoch FROM "runAt") * 1000)::float8 AS "runAtMs", (extract(epoch FROM "finishedAt") * 1000)::float8 AS "finishedAtMs",
                (extract(epoch FROM (now() AT TIME ZONE 'UTC')) * 1000)::float8 AS "nowMs"
           FROM ${env.schema}.jobs WHERE "dedupeKey" = $1`,
        [`weakness:${u.id}`],
      )
    ).rows[0] as { id: string; status: string; priority: number; payload: Record<string, unknown>; attempts: number; maxAttempts: number; lockedBy: string | null; result: Record<string, unknown> | null; runAtMs: number; finishedAtMs: number | null; nowMs: number };
  }
  const at = (deltaSec: number) => new Date(Date.now() + deltaSec * S);
  const enq = (u: TestUser, trigger: "analysis" | "user" | "import" | "first_build", priority: number, runAt: Date, debounceSec = 240, extra: { userAt?: Date; freezeSeeded?: boolean } = {}) =>
    run(enqueueWeaknessSql({ userId: BigInt(u.id), trigger, priority: priority as never, runAt, debounceSec, ...extra }));

  /** Claims the member's row and finishes it with the worker's completion (the handler's final batch, minus its writes). */
  async function claimOnly(u: TestUser) {
    await env.owner.query(`UPDATE ${env.schema}.jobs SET "runAt" = (now() AT TIME ZONE 'UTC') - interval '1 second' WHERE "dedupeKey" = $1`, [`weakness:${u.id}`]);
    // The member's own row (other tests' rows of this private schema stay where they are), as the claim updates it.
    const claimed = await env.db.query(
      stmt(
        `UPDATE jobs SET status = 'RUNNING', "lockedBy" = $2, "lockedAt" = ${NOW}, "heartbeatAt" = ${NOW},
                "startedAt" = COALESCE("startedAt", ${NOW}), attempts = attempts + 1
          WHERE "dedupeKey" = $1 AND status = 'QUEUED'
      RETURNING id::text AS id, kind::text AS kind, payload, attempts, "maxAttempts", priority, "gameId"::text AS "gameId",
                "userId"::text AS "userId", (extract(epoch FROM "runAt") * 1000)::float8 AS "runAtMs",
                (extract(epoch FROM "createdAt") * 1000)::float8 AS "createdAtMs", (extract(epoch FROM "lockedAt") * 1000)::float8 AS "claimedAtMs"`,
        [`weakness:${u.id}`, ME],
      ),
    );
    const job = claimed[0] ? toClaimedJob(claimed[0]) : null;
    assert.ok(job && job.userId === u.id);
    return job;
  }

  async function claimAndComplete(u: TestUser, between?: () => Promise<void>) {
    const job = await claimOnly(u);
    await between?.();
    const done: Statement = rerunIfFlaggedStatement({ jobId: job.id, me: ME, rerunDelaySec: 240, token: runToken({ me: ME, job }) });
    const out = await env.db.batch([lockGuardStatement(job.id, ME), done]);
    return { job, out: out[1]![0]!, done };
  }

  it("QUEUED keeps the earliest runAt and the higher priority; the payload merges", async () => {
    const u = await makeUser(env.owner, "wkenq");
    await enq(u, "analysis", JOB_PRIORITY.WEAKNESS, at(240));
    const first = await row(u);
    assert.equal(first.status, "QUEUED");
    assert.equal(first.maxAttempts, JOB_MAX_ATTEMPTS.RECOMPUTE_WEAKNESS);
    await enq(u, "analysis", JOB_PRIORITY.WEAKNESS, at(400));
    assert.equal((await row(u)).runAtMs, first.runAtMs, "never pushed back");
    await enq(u, "user", JOB_PRIORITY.USER_OPENED, at(0), 0, { userAt: new Date() });
    const raised = await row(u);
    assert.ok(raised.runAtMs < first.runAtMs, "pulled forward");
    assert.equal(raised.priority, JOB_PRIORITY.USER_OPENED);
    await enq(u, "analysis", JOB_PRIORITY.WEAKNESS, at(240));
    const merged = await row(u);
    assert.equal(merged.priority, JOB_PRIORITY.USER_OPENED, "never lowered while queued");
    assert.equal(merged.payload.trigger, "analysis");
    assert.equal(typeof merged.payload.userAt, "string", "an analysis trigger keeps userAt");
    const count = await env.owner.query(`SELECT count(*)::int AS n FROM ${env.schema}.jobs WHERE "dedupeKey" = $1`, [`weakness:${u.id}`]);
    assert.equal(count.rows[0].n, 1, "one row per member");
  });

  it("RUNNING is flagged rerun; its completion re-queues it at +240 s as a fresh job; DONE re-arms at finishedAt + 240 s", async () => {
    const u = await makeUser(env.owner, "wkenq");
    await enq(u, "first_build", JOB_PRIORITY.GAME_ENDED, at(0), 0);
    const { out } = await claimAndComplete(u, async () => {
      await enq(u, "analysis", JOB_PRIORITY.WEAKNESS, at(240));
      const running = await row(u);
      assert.equal(running.status, "RUNNING");
      assert.equal(running.payload.rerun, true);
      assert.equal(running.priority, JOB_PRIORITY.GAME_ENDED, "the higher priority stays");
    });
    assert.equal(out.status, "QUEUED");
    const requeued = await row(u);
    assert.equal(requeued.status, "QUEUED");
    assert.equal(requeued.payload.rerun, undefined);
    assert.equal(requeued.attempts, 0);
    assert.equal(requeued.lockedBy, null);
    assert.ok(Math.abs(requeued.runAtMs - requeued.nowMs - 240 * S) < 5 * S, "re-queued 240 s out");
    // This time nothing arrives while it runs: DONE (lockedBy kept for the lost-response check).
    const second = await claimAndComplete(u);
    assert.equal(second.out.status, "DONE");
    const done = await row(u);
    assert.equal(done.status, "DONE");
    assert.equal(done.lockedBy, ME);
    // An analysis trigger re-arms the DONE row at max(runAt, finishedAt + 240 s), at its own (lower) priority.
    await enq(u, "analysis", JOB_PRIORITY.WEAKNESS, at(0));
    const rearmed = await row(u);
    assert.equal(rearmed.status, "QUEUED");
    assert.equal(rearmed.priority, JOB_PRIORITY.WEAKNESS, "the priority resets after DONE");
    assert.equal(rearmed.attempts, 0);
    assert.equal(rearmed.lockedBy, null);
    assert.ok(Math.abs(rearmed.runAtMs - (done.finishedAtMs! + 240 * S)) < 2 * S, "finishedAt + the debounce");
    // A `user` trigger (debounce 0) runs now.
    await enq(u, "user", JOB_PRIORITY.USER_OPENED, at(0), 0, { userAt: new Date() });
    const user = await row(u);
    assert.ok(user.runAtMs <= user.nowMs + 2 * S);
    assert.equal(user.priority, JOB_PRIORITY.USER_OPENED);
  });

  it("the completion's retry form returns the row it already finished (a lost response); outcomeByMe sees it", async () => {
    const u = await makeUser(env.owner, "wkenq");
    await enq(u, "first_build", JOB_PRIORITY.GAME_ENDED, at(0), 0);
    const { job, done } = await claimAndComplete(u, () => enq(u, "analysis", JOB_PRIORITY.WEAKNESS, at(240)).then(() => undefined));
    const again = await env.db.query(done.retry as Statement);
    assert.equal(again.length, 1, "the retry form recognises its own requeue by the token");
    const mine = await env.db.query(outcomeByMeStatement({ jobId: job.id, me: ME, token: runToken({ me: ME, job }) }));
    assert.equal(mine.length, 1);
  });

  it("regression: weakness-lost-response-rearmed — a committed completion is still recognised after an enqueue re-armed the row", async () => {
    // DONE completion, then another game's `analysis` trigger re-arms the row before the resend's outcome check.
    const u = await makeUser(env.owner, "wkenq");
    await enq(u, "first_build", JOB_PRIORITY.GAME_ENDED, at(0), 0);
    const { job } = await claimAndComplete(u);
    assert.equal((await row(u)).status, "DONE");
    await enq(u, "analysis", JOB_PRIORITY.WEAKNESS, at(240));
    const rearmed = await row(u);
    assert.equal(rearmed.status, "QUEUED");
    assert.equal(rearmed.lockedBy, null);
    const token = runToken({ me: ME, job });
    assert.equal((rearmed.result as { token?: string } | null)?.token, token, "the completion stamp survives the re-arm");
    assert.equal((await env.db.query(outcomeByMeStatement({ jobId: job.id, me: ME, token }))).length, 1);
    // The re-queued (rerun) completion, then a further trigger: the same.
    const v = await makeUser(env.owner, "wkenq");
    await enq(v, "first_build", JOB_PRIORITY.GAME_ENDED, at(0), 0);
    const second = await claimAndComplete(v, () => enq(v, "analysis", JOB_PRIORITY.WEAKNESS, at(240)).then(() => undefined));
    await enq(v, "import", JOB_PRIORITY.WEAKNESS, at(120));
    const t2 = runToken({ me: ME, job: second.job });
    assert.equal((await env.db.query(outcomeByMeStatement({ jobId: second.job.id, me: ME, token: t2 }))).length, 1);
    // A later run of the same row (attempt 1 again, same worker) whose batch did NOT commit is never taken for the
    // earlier completion: its token carries its own claim time.
    await new Promise((r) => setTimeout(r, 5));
    const third = await claimOnly(v);
    const t3 = runToken({ me: ME, job: third });
    assert.equal(third.attempts, second.job.attempts);
    assert.notEqual(t3, t2);
    assert.equal((await env.db.query(outcomeByMeStatement({ jobId: third.id, me: ME, token: t3 }))).length, 0);
  });

  it("TR-12: one request per 600 s from the job row; concurrent requests give exactly one; the scope only when queued", async () => {
    const u = await makeUser(env.owner, "wkenq");
    const req = (now: Date, scope?: { timeClasses: string[]; months: number }) =>
      web.query(
        fromPrisma(
          requestRecomputeSql({ userId: BigInt(u.id), trigger: scope ? "scope" : "user", priority: JOB_PRIORITY.USER_OPENED, runAt: now, debounceSec: 0, now, ...(scope ? { scope } : {}) }),
        ),
      );
    const t0 = new Date();
    const [a, b] = await Promise.all([req(t0, { timeClasses: ["BULLET", "BLITZ"], months: 3 }), req(t0, { timeClasses: ["RAPID"], months: 12 })]);
    const queued = [a[0]!, b[0]!].map((r) => Number(r.queued));
    assert.deepEqual(queued.sort(), [0, 1], "exactly one of two concurrent requests");
    const winner = Number(a[0]!.queued) === 1 ? a[0]! : b[0]!;
    assert.equal(winner.scopeChanged, true);
    const profile = await env.owner.query(`SELECT "weaknessTimeClasses"::text[] AS tc, "weaknessMonths" AS m FROM ${env.schema}.training_profiles WHERE "userId" = $1`, [u.id]);
    assert.equal(profile.rows.length, 1);
    const wonScope = winner === a[0] ? { tc: ["BULLET", "BLITZ"], m: 3 } : { tc: ["RAPID"], m: 12 };
    assert.deepEqual({ tc: profile.rows[0].tc, m: profile.rows[0].m }, wonScope, "the refused request changed nothing");
    // Inside the window: refused with the previous instant; a request at now + 601 s is accepted.
    const later = new Date(t0.getTime() + 300 * S);
    const refused = (await req(later, { timeClasses: ["RAPID", "CLASSICAL"], months: 6 }))[0]!;
    assert.equal(Number(refused.queued), 0);
    assert.equal(refused.scopeChanged, false);
    assert.equal(recomputeRetryAfterSec(Number(refused.prevUserAtMs), later.getTime()), 300);
    const again = (await req(new Date(t0.getTime() + 601 * S)))[0]!;
    assert.equal(Number(again.queued), 1);
    assert.equal(again.scopeChanged, false);
  });

  it("the kick CAS: an overdue QUEUED row is stamped at most once per 30 s", async () => {
    const u = await makeUser(env.owner, "wkenq");
    await enq(u, "user", JOB_PRIORITY.USER_OPENED, at(-120), 0);
    const now = new Date();
    assert.equal((await web.query(fromPrisma(weaknessKickCasSql(BigInt(u.id), now)))).length, 1);
    assert.equal((await web.query(fromPrisma(weaknessKickCasSql(BigInt(u.id), new Date(now.getTime() + 10 * S))))).length, 0);
    assert.equal((await web.query(fromPrisma(weaknessKickCasSql(BigInt(u.id), new Date(now.getTime() + 31 * S))))).length, 1);
    const fresh = await makeUser(env.owner, "wkenq");
    await enq(fresh, "user", JOB_PRIORITY.USER_OPENED, at(0), 0);
    assert.equal((await web.query(fromPrisma(weaknessKickCasSql(BigInt(fresh.id), new Date())))).length, 0, "not overdue yet");
  });

  it("WEAKNESS_SEED_FREEZE: a seeded far-future QUEUED row is left alone by the worker's triggers", async () => {
    const u = await makeUser(env.owner, "wkenq");
    await enq(u, "user", JOB_PRIORITY.USER_OPENED, at(2 * 365 * 86_400), 0);
    const seeded = await row(u);
    const out = await enq(u, "analysis", JOB_PRIORITY.WEAKNESS, at(240), 240, { freezeSeeded: true });
    assert.equal(out.length, 0);
    assert.equal((await row(u)).runAtMs, seeded.runAtMs);
    await enq(u, "analysis", JOB_PRIORITY.WEAKNESS, at(240), 240);
    assert.ok((await row(u)).runAtMs < seeded.runAtMs, "without the hook the trigger pulls it forward");
  });
});
