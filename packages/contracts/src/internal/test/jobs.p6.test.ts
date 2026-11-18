// P6 job contracts (phase-06 plan §7.4.1, §7.4.2, §7.5; interface check §0.4–§0.6): RECOMPUTE_WEAKNESS (already a
// JobKind since M3, so no m6a) becomes runnable with 3 attempts, a merged versioned payload, one dedupe key per
// member, the WEAKNESS priority name, and the `weakness` kick reason.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ANALYZE_REASONS,
  AnalyzeGamePayloadV1,
  analyzeDedupeKey,
  weaknessLinesDedupeKey,
  JOB_KINDS,
  JOB_MAX_ATTEMPTS,
  JOB_PAYLOADS,
  JOB_PRIORITY,
  P3_JOB_KINDS,
  P4_JOB_KINDS,
  P5_JOB_KINDS,
  P6_JOB_KINDS,
  RecomputeWeaknessPayloadV1,
  RUN_JOB_KINDS,
  WEAKNESS_TRIGGERS,
  readJobPayload,
  weaknessDedupeKey,
} from "../jobs";
import { KICK_BODY_MAX_BYTES, KICK_REASONS, KickBodyV1 } from "../kick";

describe("P6 job kinds", () => {
  it("RECOMPUTE_WEAKNESS is an M3 kind (no enum migration) that this build runs, after the P5 kinds, with 3 attempts", () => {
    assert.ok((JOB_KINDS as readonly string[]).includes("RECOMPUTE_WEAKNESS"));
    assert.deepEqual([...P6_JOB_KINDS], ["RECOMPUTE_WEAKNESS"]);
    assert.deepEqual([...RUN_JOB_KINDS], [...P3_JOB_KINDS, ...P4_JOB_KINDS, ...P5_JOB_KINDS, ...P6_JOB_KINDS]);
    assert.equal(JOB_MAX_ATTEMPTS.RECOMPUTE_WEAKNESS, 3);
    assert.equal(JOB_PAYLOADS.RECOMPUTE_WEAKNESS, RecomputeWeaknessPayloadV1);
  });

  it("uses the named priorities of plan §7.4.1 (WEAKNESS 20 below IMPORT_NEWEST, above BACKLOG)", () => {
    assert.equal(JOB_PRIORITY.WEAKNESS, 20);
    assert.ok(JOB_PRIORITY.WEAKNESS < JOB_PRIORITY.IMPORT_NEWEST && JOB_PRIORITY.WEAKNESS > JOB_PRIORITY.BACKLOG);
    assert.ok(JOB_PRIORITY.USER_OPENED > JOB_PRIORITY.GAME_ENDED && JOB_PRIORITY.HOUSEKEEPING === 0);
  });

  it("the payload: v 1, one of the eight triggers, an optional ISO userAt and rerun flag; merged extras are stripped", () => {
    assert.deepEqual([...WEAKNESS_TRIGGERS], ["analysis", "first_build", "import", "user", "scope", "heal", "algo", "weekly", "removed"]);
    for (const trigger of WEAKNESS_TRIGGERS) assert.equal(RecomputeWeaknessPayloadV1.safeParse({ v: 1, trigger }).success, true, trigger);
    const merged = { v: 1, trigger: "analysis", userAt: "2026-11-17T09:30:00.000Z", rerun: true, future: 1 };
    assert.deepEqual(RecomputeWeaknessPayloadV1.parse(merged), { v: 1, trigger: "analysis", userAt: "2026-11-17T09:30:00.000Z", rerun: true });
    assert.equal(RecomputeWeaknessPayloadV1.safeParse({ v: 1, trigger: "hourly" }).success, false);
    assert.equal(RecomputeWeaknessPayloadV1.safeParse({ v: 1, trigger: "user", userAt: "yesterday" }).success, false);
    assert.equal(RecomputeWeaknessPayloadV1.safeParse({ trigger: "user" }).success, false);
  });

  it("an older reader releases a newer payload and fails a broken one", () => {
    assert.deepEqual(readJobPayload("RECOMPUTE_WEAKNESS", { v: 2, trigger: "user" }), { ok: false, reason: "newer" });
    assert.deepEqual(readJobPayload("RECOMPUTE_WEAKNESS", { v: 1 }), { ok: false, reason: "invalid" });
    const ok = readJobPayload("RECOMPUTE_WEAKNESS", { v: 1, trigger: "weekly" });
    assert.equal(ok.ok, true);
  });

  it("dedupe key: one row per member, weakness:<userId> (the SQL builds 'weakness:' || $1::text)", () => {
    assert.equal(weaknessDedupeKey(42n), "weakness:42");
    assert.equal(weaknessDedupeKey("9223372036854775807"), "weakness:9223372036854775807");
    assert.ok(weaknessDedupeKey("9223372036854775807").length <= 120);
    assert.throws(() => weaknessDedupeKey("0"));
    assert.throws(() => weaknessDedupeKey("-3"));
  });

  it("a kick may wake RECOMPUTE_WEAKNESS with the weakness reason and a runAt, within the body limit", () => {
    assert.ok((KICK_REASONS as readonly string[]).includes("weakness"));
    const body = { v: 1, reason: "weakness", kinds: ["RECOMPUTE_WEAKNESS"], runAt: "2026-11-17T09:30:00.000Z" };
    assert.equal(KickBodyV1.safeParse(body).success, true);
    assert.ok(Buffer.byteLength(JSON.stringify(body)) <= KICK_BODY_MAX_BYTES);
  });

  it("FIX-2: the weakness lines refresh is an ANALYZE_GAME reason with its own dedupe key", () => {
    assert.ok((ANALYZE_REASONS as readonly string[]).includes("weakness_lines"));
    assert.equal(weaknessLinesDedupeKey(42n), "weaklines:42");
    assert.notEqual(weaknessLinesDedupeKey(42n), analyzeDedupeKey(42n), "never the game's analysis row");
    assert.equal(AnalyzeGamePayloadV1.safeParse({ v: 1, gameId: "42", gameRef: "abc", reason: "weakness_lines" }).success, true);
  });
});
