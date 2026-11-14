// P4 job contracts (phase-04 plan §6.4, §7.7.1, §8.9; D4-02, D4-06): the I/O-lane kinds, their payloads and attempt
// caps, the dedupe keys, the optional ANALYZE_GAME fields an older worker still parses, and the priorities P4 uses
// (all names already in JOB_PRIORITY; no literals).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ANALYZE_REASONS,
  AnalyzeGamePayloadV1,
  IMPORT_BACKOFF_SEC,
  ImportPurgePayloadV1,
  ImportSyncPayloadV1,
  JOB_KINDS,
  JOB_MAX_ATTEMPTS,
  JOB_PAYLOADS,
  JOB_PRIORITY,
  P3_JOB_KINDS,
  P4_JOB_KINDS,
  PAYLOAD_V_MAX,
  RUN_JOB_KINDS,
  importDedupeKey,
  importPurgeDedupeKey,
  readJobPayload,
} from "../jobs";
import { KICK_REASONS, KickBodyV1 } from "../kick";

describe("P4 job kinds", () => {
  it("IMPORT_SYNC and IMPORT_PURGE already exist in M3's JobKind; P4 runs them with 5 attempts each", () => {
    assert.deepEqual([...P4_JOB_KINDS], ["IMPORT_SYNC", "IMPORT_PURGE"]);
    for (const k of P4_JOB_KINDS) assert.ok((JOB_KINDS as readonly string[]).includes(k), k);
    // P5 appends its engine-lane kind after these (jobs.p5.test.ts).
    assert.deepEqual([...RUN_JOB_KINDS].slice(0, P3_JOB_KINDS.length + P4_JOB_KINDS.length), [...P3_JOB_KINDS, ...P4_JOB_KINDS]);
    assert.equal(JOB_MAX_ATTEMPTS.IMPORT_SYNC, 5);
    assert.equal(JOB_MAX_ATTEMPTS.IMPORT_PURGE, 5);
    for (const k of RUN_JOB_KINDS) assert.ok(JOB_PAYLOADS[k], k);
    assert.deepEqual(IMPORT_BACKOFF_SEC.IMPORT_SYNC, [60, 300, 900, 900]);
    assert.deepEqual(IMPORT_BACKOFF_SEC.IMPORT_PURGE, [30, 120, 600]);
  });

  it("the P4 priority names exist with the plan's values (higher runs sooner)", () => {
    assert.equal(JOB_PRIORITY.IMPORT_SYNC_MANUAL, 100);
    assert.equal(JOB_PRIORITY.IMPORT_SYNC_INITIAL, 60);
    assert.equal(JOB_PRIORITY.IMPORT_NEWEST, 50);
    assert.equal(JOB_PRIORITY.IMPORT_PURGE, 20);
    assert.equal(JOB_PRIORITY.IMPORT_SYNC_DAILY, 15);
    assert.equal(JOB_PRIORITY.USER_OPENED, 100);
    assert.equal(JOB_PRIORITY.BACKLOG, 10);
  });
});

describe("P4 payloads", () => {
  it("IMPORT_SYNC: linkedAccountId, runId (null for a DAILY wake), the DB trigger spelling", () => {
    const p = { v: 1, linkedAccountId: "17", runId: "4021", trigger: "INITIAL" };
    assert.deepEqual(readJobPayload("IMPORT_SYNC", p), { ok: true, payload: p });
    assert.equal(ImportSyncPayloadV1.safeParse({ ...p, runId: null, trigger: "DAILY" }).success, true);
    assert.equal(ImportSyncPayloadV1.safeParse({ ...p, trigger: "initial" }).success, false, "job payloads keep the DB spelling");
    assert.equal(ImportSyncPayloadV1.safeParse({ ...p, linkedAccountId: 17 }).success, false);
    assert.deepEqual(readJobPayload("IMPORT_SYNC", { ...p, v: PAYLOAD_V_MAX + 1 }), { ok: false, reason: "newer" });
    assert.deepEqual(readJobPayload("IMPORT_SYNC", { v: 1 }), { ok: false, reason: "invalid" });
  });

  it("IMPORT_PURGE: by (userId, provider), with the request time", () => {
    const p = { v: 1, userId: "9", provider: "CHESSCOM", requestedAt: "2026-11-10T09:30:00.000Z" };
    assert.deepEqual(readJobPayload("IMPORT_PURGE", p), { ok: true, payload: p });
    assert.equal(ImportPurgePayloadV1.safeParse({ ...p, provider: "chesscom" }).success, false);
    assert.equal(ImportPurgePayloadV1.safeParse({ ...p, requestedAt: "yesterday" }).success, false);
  });

  it("ANALYZE_GAME gains the optional importRunId and evalHint, and the reason `import`", () => {
    const base = { v: 1, gameId: "88", gameRef: "cm3k9x2p10007slzpqa8hd4fe", reason: "import" };
    assert.ok((ANALYZE_REASONS as readonly string[]).includes("import"));
    assert.equal(AnalyzeGamePayloadV1.safeParse(base).success, true);
    const full = { ...base, importRunId: "4021", evalHint: { source: "lichess", cp: [18, 25, -30, 29_997, -29_990] } };
    assert.deepEqual(AnalyzeGamePayloadV1.parse(full), full);
    assert.equal(AnalyzeGamePayloadV1.safeParse({ ...base, evalHint: { source: "engine", cp: [1] } }).success, false);
    assert.equal(AnalyzeGamePayloadV1.safeParse({ ...base, evalHint: { source: "lichess", cp: [30_001] } }).success, false);
    assert.equal(AnalyzeGamePayloadV1.safeParse({ ...base, evalHint: { source: "lichess", cp: [1.5] } }).success, false);
    assert.equal(AnalyzeGamePayloadV1.safeParse({ ...base, evalHint: { source: "lichess", cp: [] } }).success, false);
    assert.equal(AnalyzeGamePayloadV1.safeParse({ ...base, importRunId: "0" }).success, false);
  });

  it("a P3-shaped ANALYZE_GAME payload still parses (v stays 1), and unknown keys are stripped", () => {
    const p3 = { v: 1, gameId: "88", gameRef: "cm3k9x2p10007slzpqa8hd4fe", reason: "opened" };
    assert.deepEqual(readJobPayload("ANALYZE_GAME", p3), { ok: true, payload: p3 });
    const later = AnalyzeGamePayloadV1.parse({ ...p3, futureField: 1 });
    assert.equal("futureField" in later, false);
  });
});

describe("P4 dedupe keys and kicks", () => {
  it("one reusable import row per account; one purge row per member and provider", () => {
    assert.equal(importDedupeKey(17n), "import:17");
    assert.equal(importDedupeKey("17"), "import:17");
    assert.equal(importPurgeDedupeKey(9n, "CHESSCOM"), "importpurge:9:chesscom");
    assert.equal(importPurgeDedupeKey(9, "LICHESS"), "importpurge:9:lichess");
  });

  it("kick reasons import and import_retry, with kinds naming the I/O lane", () => {
    assert.ok((KICK_REASONS as readonly string[]).includes("import"));
    assert.ok((KICK_REASONS as readonly string[]).includes("import_retry"));
    assert.equal(KickBodyV1.safeParse({ v: 1, reason: "import", kinds: ["IMPORT_SYNC"] }).success, true);
    assert.equal(KickBodyV1.safeParse({ v: 1, reason: "import_retry", kinds: ["IMPORT_SYNC", "IMPORT_PURGE"], runAt: "2026-11-10T09:30:00.000Z" }).success, true);
  });
});
