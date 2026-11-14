// P5 job contracts (phase-05 plan §6.6 m5a, §7.6; feasibility §9 rules 1 and 2): EXTRACT_MISTAKES is the last
// JobKind value, runs on the engine lane at BACKLOG priority, has a versioned payload with decimal-string ids, a
// per-member-side dedupe key carrying the extraction version, and an older reader releases a newer payload.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EXTRACT_VERSION,
  ExtractMistakesPayloadV1,
  JOB_KINDS,
  JOB_MAX_ATTEMPTS,
  JOB_PAYLOADS,
  JOB_PRIORITY,
  P3_JOB_KINDS,
  P4_JOB_KINDS,
  P5_JOB_KINDS,
  RUN_JOB_KINDS,
  extractMistakesDedupeKey,
  regradeExtractDedupeKey,
  readJobPayload,
} from "../jobs";
import { KICK_BODY_MAX_BYTES, KickBodyV1 } from "../kick";

describe("P5 job kinds", () => {
  it("EXTRACT_MISTAKES is appended to JobKind and run by this build with 3 attempts", () => {
    assert.deepEqual([...P5_JOB_KINDS], ["EXTRACT_MISTAKES"]);
    assert.equal(JOB_KINDS.at(-1), "EXTRACT_MISTAKES");
    assert.deepEqual([...RUN_JOB_KINDS], [...P3_JOB_KINDS, ...P4_JOB_KINDS, ...P5_JOB_KINDS]);
    assert.equal(JOB_MAX_ATTEMPTS.EXTRACT_MISTAKES, 3);
    assert.equal(JOB_PAYLOADS.EXTRACT_MISTAKES, ExtractMistakesPayloadV1);
  });

  it("the backfill priority is the BACKLOG name (no literal), below every live band", () => {
    assert.equal(JOB_PRIORITY.BACKLOG, 10);
    assert.ok(JOB_PRIORITY.BACKLOG < JOB_PRIORITY.GAME_ENDED);
    assert.ok(JOB_PRIORITY.BACKLOG > JOB_PRIORITY.HOUSEKEEPING);
  });

  it("the payload is {v:1, gameId, userId} with decimal-string ids; extra keys are stripped", () => {
    const p = { v: 1, gameId: "42", userId: "7" };
    assert.deepEqual(ExtractMistakesPayloadV1.parse(p), p);
    assert.deepEqual(ExtractMistakesPayloadV1.parse({ ...p, extra: true }), p);
    assert.equal(ExtractMistakesPayloadV1.safeParse({ ...p, gameId: 42 }).success, false, "the backfill casts ids to text");
    assert.equal(ExtractMistakesPayloadV1.safeParse({ ...p, userId: "07" }).success, false);
    assert.equal(ExtractMistakesPayloadV1.safeParse({ v: 1, gameId: "42" }).success, false);
  });

  it("an older reader releases a newer payload (v 2) and fails a broken one", () => {
    assert.deepEqual(readJobPayload("EXTRACT_MISTAKES", { v: 2, gameId: "42", userId: "7", more: 1 }), { ok: false, reason: "newer" });
    assert.deepEqual(readJobPayload("EXTRACT_MISTAKES", { v: 1, gameId: "x" }), { ok: false, reason: "invalid" });
    const ok = readJobPayload("EXTRACT_MISTAKES", { v: 1, gameId: "42", userId: "7" });
    assert.equal(ok.ok, true);
  });

  it("dedupe key: extract:<gameId>:<userId>:v<EXTRACT_VERSION>, ≤ 120 characters", () => {
    assert.equal(EXTRACT_VERSION, 1);
    assert.equal(extractMistakesDedupeKey(42n, 7n), "extract:42:7:v1");
    assert.equal(extractMistakesDedupeKey("42", "7", 2), "extract:42:7:v2");
    // A regrade's re-extraction (FIX-1): its own key per analysis version (the worker's SQL builds the same string).
    assert.equal(regradeExtractDedupeKey(42n, 7n, 3), "extract:42:7:v1:a3");
    assert.throws(() => regradeExtractDedupeKey(42n, 7n, 0));
    assert.throws(() => extractMistakesDedupeKey(1, 1, 0));
    const longest = extractMistakesDedupeKey("9223372036854775807", "9223372036854775807", 99);
    assert.ok(longest.length <= 120);
  });

  it("a kick may name every kind, EXTRACT_MISTAKES included, within the body limit", () => {
    const body = { v: 1, reason: "backfill", kinds: [...JOB_KINDS] };
    assert.equal(KickBodyV1.safeParse(body).success, true);
    assert.equal(KickBodyV1.safeParse({ v: 1, reason: "backfill", kinds: ["EXTRACT_MISTAKES"] }).success, true);
    assert.ok(Buffer.byteLength(JSON.stringify(body)) <= KICK_BODY_MAX_BYTES);
  });
});
