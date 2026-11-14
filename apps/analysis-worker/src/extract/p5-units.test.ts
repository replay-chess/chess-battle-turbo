// P5 worker units (phase-05 plan §7.6, §7.8, §12.2): the env switches BANK_EXTRACT_ENABLED / BANK_LINE_NODES, the
// EXTRACT_MISTAKES handler's registration and engine lane, its stored-game reader, the training-hygiene statements,
// the `analysis:batch` bank fields, the line searches' plans, and the load statement following the kill switch.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { INITIAL_FEN } from "@repo/chess-analysis/board";
import { BANK_LINE_NODES } from "@repo/chess-analysis/puzzle/line";
import { ANALYSIS_BATCH_EVERY_MS } from "@repo/contracts/socket/analysis";
import { RUN_JOB_KINDS } from "@repo/contracts/internal/jobs";
import { BANK_LINE_NODES_MAX, loadEnv } from "../config/env";
import { defaultHandlers } from "../jobs";
import { extractLoadStatement, readLoaded } from "../jobs/extract-mistakes";
import { silentLogger } from "../obs/log";
import { RecordingProductEvents } from "../obs/posthog";
import { BatchAccumulator } from "../pipeline/batch-events";
import { OpeningBook } from "../pipeline/openings";
import { loadStatement, SqlAnalysisStore } from "../pipeline/sql-store";
import { reportExtraction } from "../pipeline/final-batch/p05-bank";
import type { Telemetry } from "../obs/telemetry";
import { FakeClock } from "../scheduler/clock";
import {
  abandonStaleSessionsStatement,
  dropOldPlansStatement,
  pruneOldSessionsStatement,
  trainingHygiene,
} from "../scheduler/recurring/training-hygiene";
import { RECURRING_SLICES } from "../scheduler/recurring";
import { RecordingEmitter } from "../socket/emit";
import { MistakesAddedCoalescer } from "./coalesce";
import { linePosition } from "./lineBuilder";

const k = () => randomBytes(32).toString("base64");
const base = {
  APP_ENV: "test",
  WORKER_DATABASE_URL: "postgresql://replay_worker:secretpw@localhost:5432/replay",
  INTERNAL_API_SECRET: `wk:${k()},webwk:${k()},ws:${k()}`,
  ENGINE: "fake",
};

describe("env: BANK_EXTRACT_ENABLED and BANK_LINE_NODES", () => {
  it("defaults: on, 500000 nodes", () => {
    assert.deepEqual(loadEnv(base).bank, { enabled: true, lineNodes: BANK_LINE_NODES });
    assert.equal(BANK_LINE_NODES, 500_000);
  });

  it("the kill switch and a node budget", () => {
    assert.equal(loadEnv({ ...base, BANK_EXTRACT_ENABLED: "off" }).bank.enabled, false);
    assert.equal(loadEnv({ ...base, BANK_EXTRACT_ENABLED: "false" }).bank.enabled, false);
    assert.equal(loadEnv({ ...base, BANK_LINE_NODES: "250000" }).bank.lineNodes, 250_000);
  });

  it("refuses a bad value without echoing it", () => {
    assert.throws(() => loadEnv({ ...base, BANK_EXTRACT_ENABLED: "maybe" }), /BANK_EXTRACT_ENABLED must be on or off/);
    assert.throws(() => loadEnv({ ...base, BANK_LINE_NODES: String(BANK_LINE_NODES_MAX + 1) }), /BANK_LINE_NODES must be within/);
    assert.throws(() => loadEnv({ ...base, BANK_LINE_NODES: "lots" }), /BANK_LINE_NODES must be an integer/);
  });
});

describe("EXTRACT_MISTAKES registration", () => {
  function handlers(enabled: boolean) {
    const clock = new FakeClock(0);
    const emitter = new RecordingEmitter();
    const store = new SqlAnalysisStore({
      query: async () => [],
      batch: async () => [],
      close: async () => undefined,
    });
    return defaultHandlers({
      store,
      book: new OpeningBook(async () => [], silentLogger),
      batch: new BatchAccumulator({ emitter, clock, log: silentLogger, queuedFor: async () => new Map() }),
      events: new RecordingProductEvents(),
      bank: { enabled, lineNodes: 10_000 },
      mistakesAdded: new MistakesAddedCoalescer({ emitter, clock, log: silentLogger }),
    });
  }

  it("runs with the switch on, waits in the queue with it off", () => {
    assert.ok(handlers(true).EXTRACT_MISTAKES);
    assert.equal(handlers(false).EXTRACT_MISTAKES, undefined);
    assert.ok(RUN_JOB_KINDS.includes("EXTRACT_MISTAKES"));
  });
});

describe("the stored-game reader of EXTRACT_MISTAKES", () => {
  const row = {
    id: "5",
    ref: "cgame00000000000000000005",
    startingFen: INITIAL_FEN,
    startPly: 0,
    moves: "e2e4 e7e5",
    analysisStatus: "DONE",
    completedAtMs: 1_700_000_000_000,
    ecoCode: "C20",
    timeClass: "BLITZ",
    colorUnknown: false,
    analysis: {
      evals: [15, 30, 20],
      second: [10, 20, 10],
      best: [0, 0, 0],
      judgements: [3, 3],
      lines: { "0": { pv: "e2e4", alts: [], d: 0 } },
      middlegamePly: null,
      endgamePly: null,
      completed: true,
    },
    member: { color: "w", userId: "7", userRef: "cuser000000000000000000007", result: "WIN", timeZone: "Asia/Kolkata" },
    moments: [],
  };

  it("reads a complete stored analysis", () => {
    const out = readLoaded(row);
    assert.ok(!("skip" in out));
    assert.equal(out.member.training?.timeZone, "Asia/Kolkata");
    assert.equal(out.member.training?.releaseHour, 8, "profile defaults");
    assert.equal(out.replay.uci.length, 2);
  });

  it("FIX-2: reads the member's newest zoned training day (the pinned day of a zone change)", () => {
    const out = readLoaded({ ...row, member: { ...row.member, dayAnchor: { day: "2026-11-12", timeZone: "America/Los_Angeles", dayStartHour: 4 } } });
    assert.ok(!("skip" in out));
    assert.deepEqual(out.member.training?.dayAnchor, { day: "2026-11-12", timeZone: "America/Los_Angeles", dayStartHour: 4 });
    const none = readLoaded(row);
    assert.ok(!("skip" in none));
    assert.equal(none.member.training?.dayAnchor, null);
    assert.match(extractLoadStatement("5", "7").text, /'dayAnchor', \(SELECT json_build_object\('day'/);
    assert.match(loadStatement("5", "j").text, /'dayAnchor', \(SELECT json_build_object\('day'/);
  });

  it("FIX-2: the extraction metrics include worker.extract.batch_server_ms when the batch was timed (§10.2)", () => {
    const seen: [string, string, number][] = [];
    const telemetry = { metric: (kind: string, name: string, value: number) => void seen.push([kind, name, value]) } as unknown as Telemetry;
    const plan = { extractMs: 12, lineSearches: 2, source: "live", members: [] } as unknown as Parameters<typeof reportExtraction>[0];
    const sink = { metrics: {} as never, telemetry, events: new RecordingProductEvents() };
    reportExtraction(plan, new Map(), { ...sink, batchMs: 41 });
    assert.deepEqual(seen.find((x) => x[1] === "worker.extract.batch_server_ms"), ["distribution", "worker.extract.batch_server_ms", 41]);
    seen.length = 0;
    reportExtraction(plan, new Map(), sink);
    assert.equal(seen.some((x) => x[1] === "worker.extract.batch_server_ms"), false);
    assert.ok(seen.some((x) => x[1] === "worker.extract.ms"));
  });

  it("skips what cannot be extracted", () => {
    assert.deepEqual(readLoaded(undefined), { skip: "game_gone" });
    assert.deepEqual(readLoaded({ ...row, analysisStatus: "RUNNING" }), { skip: "not_analysed" });
    assert.deepEqual(readLoaded({ ...row, analysis: { ...row.analysis, completed: false } }), { skip: "not_analysed" });
    assert.deepEqual(readLoaded({ ...row, member: null }), { skip: "not_a_player" });
    assert.deepEqual(readLoaded({ ...row, moves: "e2e5" }), { skip: "unreplayable" });
    assert.deepEqual(readLoaded({ ...row, analysis: { ...row.analysis, evals: [1] } }), { skip: "analysis_shape" });
  });

  it("is one statement keyed by the payload's ids", () => {
    const s = extractLoadStatement("5", "7");
    assert.deepEqual(s.values, ["5", "7"]);
    assert.match(s.text, /LEFT JOIN training_profiles/);
    assert.match(s.text, /moments\[\*\]\.ply/);
  });
});

describe("the job-load statement follows the kill switch", () => {
  it("reads the training inputs only with J1 on", () => {
    assert.match(loadStatement("1", "2").text, /LEFT JOIN training_profiles/);
    assert.match(loadStatement("1", "2").text, /'opponentName', gp."opponentName"/);
    const off = loadStatement("1", "2", { training: false }).text;
    assert.doesNotMatch(off, /training_profiles|timeZone|opponentName/);
    assert.match(off, /colorUnknown/, "games.meta is P3's grant: read either way");
  });
});

describe("training hygiene (HOUSEKEEPING)", () => {
  it("is a recurring slice before the plan", () => {
    const ids = RECURRING_SLICES.map((s) => s.id);
    assert.ok(ids.indexOf("training-hygiene") >= 0 && ids.indexOf("training-hygiene") < ids.indexOf("housekeeping-plan"));
    assert.equal(trainingHygiene.statements?.({} as never).length, 3);
  });

  it("abandons sessions ACTIVE for 24 h, drops plans after 7 days, deletes sessions after 90 days, capped", () => {
    const a = abandonStaleSessionsStatement();
    assert.match(a.text, /status = 'ABANDONED'/);
    assert.deepEqual(a.values, [24, 1000]);
    const p = dropOldPlansStatement();
    assert.match(p.text, /SET plan = NULL/);
    assert.deepEqual(p.values, [7, 1000]);
    const d = pruneOldSessionsStatement(50);
    assert.match(d.text, /DELETE FROM training_sessions/);
    assert.deepEqual(d.values, [90, 50]);
    for (const s of [a, p, d]) assert.match(s.text, /LIMIT \$2/);
  });
});

describe("analysis:batch bank fields", () => {
  function acc() {
    const clock = new FakeClock(Date.UTC(2026, 10, 12));
    const emitter = new RecordingEmitter();
    const b = new BatchAccumulator({ emitter, clock, log: silentLogger, queuedFor: async () => new Map() });
    return { clock, emitter, b };
  }

  it("sums the cards of the frame's games and keeps the latest due count", async () => {
    const { b, emitter } = acc();
    b.add(["cu"], "cgame00000000000000000001", "done", new Map([["cu", { added: 2, due: 4 }]]));
    b.add(["cu"], "cgame00000000000000000002", "done", new Map([["cu", { added: 1, due: 5 }]]));
    await b.flushDue();
    const data = emitter.sent[0]!.data as { bankAdded?: number | null; bankDue?: number | null; done: number };
    assert.deepEqual([data.done, data.bankAdded, data.bankDue], [2, 3, 5]);
  });

  it("an unknown game (lost response) makes the sum unknown; frames without bank values omit the fields", async () => {
    const { b, emitter, clock } = acc();
    b.add(["cu"], "cgame00000000000000000001", "done", new Map([["cu", { added: 2, due: 4 }]]));
    b.add(["cu"], "cgame00000000000000000002", "done", new Map([["cu", { added: null, due: null }]]));
    await b.flushDue();
    const first = emitter.sent[0]!.data as Record<string, unknown>;
    assert.equal(first.bankAdded, null);
    assert.equal(first.bankDue, null);
    await clock.advance(ANALYSIS_BATCH_EVERY_MS);
    b.add(["cu"], "cgame00000000000000000003", "failed");
    await b.flushDue();
    const second = emitter.sent[1]!.data as Record<string, unknown>;
    assert.equal("bankAdded" in second, false);
    assert.equal("bankDue" in second, false);
  });
});

describe("line positions", () => {
  it("a fresh position: no history, searched from its own FEN", () => {
    const fen = "6k1/5ppp/8/8/8/8/5PPP/R5K1 b - - 3 30";
    const p = linePosition(fen);
    assert.deepEqual([p.searchFen, p.searchMoves, p.mover, p.halfmoveClock, p.seenEarlier, p.terminal], [fen, [], "b", 3, false, null]);
  });
});
