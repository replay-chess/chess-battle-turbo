// The RECOMPUTE_WEAKNESS SQL builders (phase-06 plan §7.4.1, §7.1.2, Q-W12): their validation and the shape the worker
// and the web rely on. The behaviour on Postgres (coalescing, the durable limit, concurrency, the kick CAS, the seed
// freeze) is apps/analysis-worker/src/weakness/enqueue.int.test.ts.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JOB_MAX_ATTEMPTS, JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import {
  WEAKNESS_DEBOUNCE_SEC,
  enqueueWeaknessManySql,
  enqueueWeaknessSql,
  recomputeRetryAfterSec,
  requestRecomputeSql,
  userIdsLiteral,
  weaknessKickCasSql,
  weaknessPayload,
} from "./weakness-jobs";

const NOW = new Date("2026-11-17T10:00:00.000Z");

describe("weakness-jobs", () => {
  it("the one row per member: weakness:<userId>, maxAttempts 3, the validated payload, UTC timestamps", () => {
    const sql = enqueueWeaknessSql({ userId: 41n, trigger: "analysis", priority: JOB_PRIORITY.WEAKNESS, runAt: NOW, debounceSec: WEAKNESS_DEBOUNCE_SEC });
    assert.ok(sql.values.includes("weakness:41"));
    assert.ok(sql.values.includes(JOB_MAX_ATTEMPTS.RECOMPUTE_WEAKNESS));
    assert.ok(sql.values.includes(JSON.stringify({ v: 1, trigger: "analysis" })));
    assert.match(sql.text, /::timestamptz AT TIME ZONE 'UTC'\)/);
    assert.match(sql.text, /\(now\(\) AT TIME ZONE 'UTC'\)/);
    assert.doesNotMatch(sql.text, /[^(]now\(\) \+/, "never a bare now()");
    assert.match(sql.text, /'\{"rerun":true\}'::jsonb/);
    assert.match(sql.text, /LEAST\(jobs."runAt", EXCLUDED."runAt"\)/);
  });

  it("refuses a priority outside JOB_PRIORITY, a debounce at or above Neon's 300 s suspend, a bad payload", () => {
    assert.throws(() => enqueueWeaknessSql({ userId: 41n, trigger: "user", priority: 55 as never, runAt: NOW, debounceSec: 0 }), /JOB_PRIORITY/);
    assert.throws(() => enqueueWeaknessSql({ userId: 41n, trigger: "user", priority: JOB_PRIORITY.USER_OPENED, runAt: NOW, debounceSec: 300 }), /0\.\.299/);
    assert.throws(() => enqueueWeaknessSql({ userId: 41n, trigger: "nope" as never, priority: JOB_PRIORITY.USER_OPENED, runAt: NOW, debounceSec: 0 }));
    assert.throws(() => enqueueWeaknessSql({ userId: 41n, trigger: "user", priority: JOB_PRIORITY.USER_OPENED, runAt: new Date(Number.NaN), debounceSec: 0 }), /invalid Date/);
    assert.deepEqual(weaknessPayload("user", NOW), { v: 1, trigger: "user", userAt: NOW.toISOString() });
  });

  it("the set form: rows from a subquery, triggers checked against WEAKNESS_TRIGGERS, the database's now + delay", () => {
    const many = enqueueWeaknessManySql({ rows: `SELECT u, 'weekly'::text FROM x`, priority: JOB_PRIORITY.HOUSEKEEPING, runAt: null, delaySec: 0, debounceSec: 0 });
    assert.match(many.text, /FROM \(SELECT u, 'weekly'::text FROM x\) AS r\("userId", trigger\)/);
    assert.match(many.text, /WHERE r.trigger::text = ANY\(/);
    assert.throws(() => enqueueWeaknessManySql({ rows: "SELECT 1, 'x'", priority: JOB_PRIORITY.HOUSEKEEPING, runAt: null, delaySec: -1, debounceSec: 0 }), /delaySec/);
    assert.equal(userIdsLiteral(["41", 42n]), "ARRAY[41, 42]::bigint[]");
    assert.throws(() => userIdsLiteral(["41) OR (1=1"]), /not a user id/);
  });

  it("TR-12: the durable limit from the job row's userAt, the scope written only with the armed job", () => {
    const sql = requestRecomputeSql({
      userId: 41n,
      trigger: "scope",
      priority: JOB_PRIORITY.USER_OPENED,
      runAt: NOW,
      debounceSec: 0,
      now: NOW,
      scope: { timeClasses: ["RAPID", "BULLET"], months: 3 },
    });
    assert.match(sql.text, /\(payload->>'userAt'\)::timestamptz/);
    assert.match(sql.text, /WHERE EXISTS \(SELECT 1 FROM up\)/);
    assert.ok(sql.values.some((v) => Array.isArray(v) && v.join() === "BULLET,RAPID"), "the scope in the enum order");
    assert.throws(() => requestRecomputeSql({ userId: 41n, trigger: "scope", priority: JOB_PRIORITY.USER_OPENED, runAt: NOW, debounceSec: 0, now: NOW, scope: { timeClasses: [], months: 3 } }), /timeClasses/);
    assert.throws(() => requestRecomputeSql({ userId: 41n, trigger: "scope", priority: JOB_PRIORITY.USER_OPENED, runAt: NOW, debounceSec: 0, now: NOW, scope: { timeClasses: ["RAPID"], months: 4 } }), /months/);
    assert.doesNotMatch(requestRecomputeSql({ userId: 41n, trigger: "user", priority: JOB_PRIORITY.USER_OPENED, runAt: NOW, debounceSec: 0, now: NOW }).text, /training_profiles/);
    assert.equal(recomputeRetryAfterSec(NOW.getTime() - 300_000, NOW.getTime()), 300);
    assert.equal(recomputeRetryAfterSec(NOW.getTime() - 599_500, NOW.getTime()), 1);
  });

  it("Q-W12: the kick CAS by the member's dedupe key, 30 s windows", () => {
    const sql = weaknessKickCasSql(41n, NOW);
    assert.ok(sql.values.includes("weakness:41"));
    assert.match(sql.text, /status = 'QUEUED'/);
    assert.match(sql.text, /"lastKickAt" IS NULL OR "lastKickAt" </);
  });
});
