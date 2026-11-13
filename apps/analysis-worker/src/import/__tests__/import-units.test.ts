// Pure parts of the worker import (phase-04 plan §8.9 priorities, §7.9 settings, §8.7 evalHint, §8.10 schedule,
// §7.6 event cadence, §7.7.1 back-off, §8.8 chunk rows).
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import {
  IMPORT_GAMES_CHANGED_MIN_GAP_MS,
  IMPORT_PROGRESS_EVERY_GAMES,
  IMPORT_PROGRESS_MIN_GAP_MS,
} from "@repo/contracts/socket/user";
import { MOVE_UNKNOWN, NO_SECOND } from "@repo/chess-analysis/codec";
import type { ImportedGame } from "@repo/chess-import/types";
import { EnvError, loadEnv } from "../../config/env";
import { silentLogger } from "../../obs/log";
import { backoffSec, backoffSecFor } from "../../queue/outcome";
import { FakeClock } from "../../scheduler/clock";
import { RecordingEmitter } from "../../socket/emit";
import { chunkRow, chunkStatement, IMPORT_CHUNK } from "../batch-writer";
import { coClaimExternalId, EXTERNAL_ID_MAX } from "../co-claim";
import { isEntitledMember, isMember, isTrialing, type ImportMember } from "../context";
import { evalSourceOf, hintedPass1, usableHint } from "../eval-hint";
import { analysable, assignPriorities, planPriorities, priorityOf } from "../priorities";
import { ImportEvents, resetGamesChangedThrottle } from "../progress";
import { nextAutoSyncAt } from "../schedule";
import { parseImportSettings } from "../settings";

const SETTINGS = { eager: 50, eagerTrial: 20, cap: 200 };

describe("priorities (§8.9)", () => {
  it("INITIAL trialist: rank 1 USER_OPENED, 2–20 IMPORT_NEWEST, then nothing", () => {
    const plan = planPriorities({ trigger: "INITIAL", trialing: true, budgetUsed: 0, ranksUsed: 0, settings: SETTINGS });
    assert.equal(plan.releaseBacklog, false);
    assert.deepEqual(priorityOf(1, plan), { priority: JOB_PRIORITY.USER_OPENED, rank: 1 });
    assert.equal(priorityOf(2, plan).priority, JOB_PRIORITY.IMPORT_NEWEST);
    assert.equal(priorityOf(20, plan).priority, JOB_PRIORITY.IMPORT_NEWEST);
    assert.equal(priorityOf(21, plan).priority, null);
  });

  it("INITIAL paying member: 50 eager; the rest is the backlog release's", () => {
    const plan = planPriorities({ trigger: "INITIAL", trialing: false, budgetUsed: 0, ranksUsed: 0, settings: SETTINGS });
    assert.equal(plan.releaseBacklog, true);
    assert.equal(priorityOf(50, plan).priority, JOB_PRIORITY.IMPORT_NEWEST);
    assert.equal(priorityOf(51, plan).priority, null);
  });

  it("MANUAL / DAILY / RETRY never use USER_OPENED", () => {
    for (const trigger of ["MANUAL", "DAILY", "RETRY"] as const) {
      const plan = planPriorities({ trigger, trialing: false, budgetUsed: 0, ranksUsed: 0, settings: SETTINGS });
      assert.equal(priorityOf(1, plan).priority, JOB_PRIORITY.IMPORT_NEWEST, trigger);
    }
  });

  it("the budget: nothing beyond cap − used; a resumed run continues its ranks", () => {
    const full = planPriorities({ trigger: "INITIAL", trialing: false, budgetUsed: 195, ranksUsed: 0, settings: SETTINGS });
    assert.equal(full.room, 5);
    assert.equal(priorityOf(5, full).priority, JOB_PRIORITY.IMPORT_NEWEST);
    assert.equal(priorityOf(6, full).priority, null);
    const resumed = planPriorities({ trigger: "INITIAL", trialing: true, budgetUsed: 12, ranksUsed: 12, settings: SETTINGS });
    assert.deepEqual(priorityOf(1, resumed), { priority: JOB_PRIORITY.IMPORT_NEWEST, rank: 13 }, "no second USER_OPENED");
    assert.equal(priorityOf(9, resumed).priority, null, "rank 21 is past the trial's 20");
  });

  it("assignPriorities skips games P3 would not analyse and gives fairSeq = rank", () => {
    const plan = planPriorities({ trigger: "INITIAL", trialing: true, budgetUsed: 0, ranksUsed: 0, settings: SETTINGS });
    const items = [4, 30, 3, 60].map((plyCount) => ({ plyCount, priority: null as number | null, fairSeq: 0 }));
    const next = assignPriorities(items, plan);
    assert.equal(next, 3);
    assert.equal(analysable(4), false);
    assert.deepEqual(
      items.map((i) => [i.priority, i.fairSeq]),
      [[null, 0], [JOB_PRIORITY.USER_OPENED, 1], [null, 0], [JOB_PRIORITY.IMPORT_NEWEST, 2]],
    );
  });
});

describe("membership (P1's rules, context.ts)", () => {
  const now = Date.UTC(2026, 10, 12);
  const m = (o: Partial<ImportMember>): ImportMember => ({
    userRef: "c",
    timeZone: "UTC",
    role: "USER",
    subscriptionStatus: null,
    currentPeriodEndMs: null,
    cancelAtPeriodEnd: false,
    trialStartedAtMs: null,
    trialEndsAtMs: null,
    ...o,
  });
  it("active, a scheduled cancel inside the period, grace statuses inside the period; admins; the paywall switch", () => {
    assert.equal(isEntitledMember(m({ subscriptionStatus: "active" }), now), true);
    assert.equal(isEntitledMember(m({ subscriptionStatus: "cancelled", cancelAtPeriodEnd: true, currentPeriodEndMs: now + 1 }), now), true);
    assert.equal(isEntitledMember(m({ subscriptionStatus: "cancelled", currentPeriodEndMs: now + 1 }), now), false);
    assert.equal(isEntitledMember(m({ subscriptionStatus: "on_hold", currentPeriodEndMs: now + 1 }), now), true);
    assert.equal(isEntitledMember(m({ subscriptionStatus: "past_due", currentPeriodEndMs: now - 1 }), now), false);
    assert.equal(isEntitledMember(m({ subscriptionStatus: "expired" }), now), false);
    assert.equal(isMember(m({ role: "ADMIN" }), now, true), true);
    assert.equal(isMember(m({}), now, false), true);
    assert.equal(isMember(m({}), now, true), false);
    assert.equal(isTrialing(m({ trialStartedAtMs: now - 1, trialEndsAtMs: now + 1 }), now), true);
    assert.equal(isTrialing(m({ trialStartedAtMs: now - 2, trialEndsAtMs: now }), now), false);
  });
});

describe("import settings (§7.9; TST X12)", () => {
  it("defaults are the plan's numbers", () => {
    const s = parseImportSettings({}, "dev");
    assert.deepEqual(
      [s.windowMonths, s.maxGames, s.eagerTrial, s.eager, s.cap, s.spreadDays, s.paused, s.paywall],
      [12, 2000, 20, 50, 200, 7, false, true],
    );
    assert.equal(s.chesscomBaseUrl, "https://api.chess.com");
    assert.equal(s.lichessBaseUrl, "https://lichess.org");
  });

  it("the provider base URLs are test hooks: refused in production, accepted elsewhere", () => {
    const mock = { CHESSCOM_API_BASE: "http://localhost:4010/chesscom", LICHESS_BASE_URL: "http://localhost:4010/lichess" };
    assert.equal(parseImportSettings(mock, "test").chesscomBaseUrl, "http://localhost:4010/chesscom");
    assert.throws(() => parseImportSettings(mock, "production"), (e: unknown) => e instanceof EnvError && /CHESSCOM_API_BASE/.test(e.message));
    assert.throws(() => parseImportSettings({ LICHESS_BASE_URL: "http://localhost:4010/lichess" }, "production"), /LICHESS_BASE_URL/);
    assert.equal(parseImportSettings({ CHESSCOM_API_BASE: "https://api.chess.com/" }, "production").chesscomBaseUrl, "https://api.chess.com");
  });

  it("regression: test-worker-never-calls-real-providers (FIX-1): with APP_ENV=test an unset provider URL is a closed loopback port", () => {
    const s = parseImportSettings({}, "test");
    for (const url of [s.chesscomBaseUrl, s.lichessBaseUrl]) {
      assert.equal(new URL(url).hostname, "127.0.0.1");
      assert.equal(new URL(url).port, "9");
    }
    assert.equal(parseImportSettings({}, "production").lichessBaseUrl, "https://lichess.org");
    assert.equal(parseImportSettings({}, "local").chesscomBaseUrl, "https://api.chess.com");
  });

  it("bad values refuse the boot, naming the variable and never its value", () => {
    assert.throws(() => parseImportSettings({ IMPORT_MAX_GAMES: "lots" }, "dev"), /IMPORT_MAX_GAMES must be an integer/);
    assert.throws(() => parseImportSettings({ IMPORT_WINDOW_MONTHS: "99" }, "dev"), /IMPORT_WINDOW_MONTHS must be within/);
    assert.throws(() => parseImportSettings({ IMPORT_ANALYSE_EAGER: "300" }, "dev"), /must not exceed IMPORT_ANALYSE_CAP/);
    assert.throws(() => parseImportSettings({ IMPORT_PAUSED: "maybe" }, "dev"), /IMPORT_PAUSED must be on or off/);
    assert.throws(() => parseImportSettings({ UPSTREAM_CONTACT: "a (b)" }, "dev"), /UPSTREAM_CONTACT/);
    assert.equal(parseImportSettings({ IMPORT_PAUSED: "on", BILLING_PAYWALL: "off" }, "dev").paused, true);
    assert.equal(parseImportSettings({ BILLING_PAYWALL: "OFF" }, "dev").paywall, false);
  });

  it("loadEnv carries them", () => {
    const key = () => randomBytes(32).toString("base64");
    const base = {
      APP_ENV: "test",
      WORKER_DATABASE_URL: `postgres://${["replay_worker", "x"].join(":")}@localhost:5432/replay`, // a dummy, built from parts
      ENGINE: "fake",
      INTERNAL_API_SECRET: `wk:${key()},webwk:${key()}`,
    };
    assert.equal(loadEnv({ ...base, IMPORT_ANALYSE_CAP: "300" }).imports.cap, 300);
    assert.throws(() => loadEnv({ ...base, IMPORT_MAX_GAMES: "0" }), (e: unknown) => e instanceof EnvError);
  });
});

describe("evalHint as pass 1 (§8.7, interface check §0.7)", () => {
  const hint = { source: "lichess" as const, cp: [20, -15, 30000] };
  it("usable only when it covers every ply of a fresh run", () => {
    assert.deepEqual(usableHint(hint, 3, 0), hint.cp);
    assert.equal(usableHint(hint, 4, 0), null);
    assert.equal(usableHint(hint, 3, 2), null, "a run resumed from a checkpoint keeps its engine arrays");
    assert.equal(usableHint(undefined, 3, 0), null);
  });
  it("position 0 searched, positions 1..n from the hint (terminal values win), no second / best", () => {
    const out = hintedPass1(hint.cp, { eval: 25, second: 10, best: 123 }, [null, null, null, 30000]);
    assert.deepEqual(out.evals, [25, 20, -15, 30000]);
    assert.deepEqual(out.second, [10, NO_SECOND, NO_SECOND, NO_SECOND]);
    assert.deepEqual(out.best, [123, MOVE_UNKNOWN, MOVE_UNKNOWN, MOVE_UNKNOWN]);
    assert.deepEqual(hintedPass1([7], { eval: 0, second: 0, best: 0 }, [null, 0]).evals, [0, 0]);
  });
  it("the stored eval source", () => {
    assert.equal(evalSourceOf(false, 3), "ENGINE");
    assert.equal(evalSourceOf(true, 0), "LICHESS");
    assert.equal(evalSourceOf(true, 2), "MIXED");
  });
});

describe("daily-sync schedule (§8.10; §12.1 DST cases)", () => {
  const at = (iso: string) => new Date(iso);
  it("next local 03:00 + id % 60 min, snapped to HH:05 UTC", () => {
    // Asia/Kolkata 03:00 = 21:30 UTC the day before; account 17 → +17 min → 21:47 → 21:05.
    assert.equal(nextAutoSyncAt("Asia/Kolkata", at("2026-11-12T09:30:00Z"), null, 17n).toISOString(), "2026-11-12T21:05:00.000Z");
    assert.equal(nextAutoSyncAt("UTC", at("2026-11-12T09:30:00Z"), null, 0n).toISOString(), "2026-11-13T03:05:00.000Z");
  });
  it("across the DST changes of Europe/London and America/New_York", () => {
    // London spring forward 2027-03-28: 03:00 BST = 02:00 UTC.
    assert.equal(nextAutoSyncAt("Europe/London", at("2027-03-27T12:00:00Z"), null, 0n).toISOString(), "2027-03-28T02:05:00.000Z");
    // London fall back 2026-10-25: 03:00 GMT = 03:00 UTC.
    assert.equal(nextAutoSyncAt("Europe/London", at("2026-10-24T12:00:00Z"), null, 0n).toISOString(), "2026-10-25T03:05:00.000Z");
    // New York spring forward 2027-03-14: 03:00 EDT = 07:00 UTC.
    assert.equal(nextAutoSyncAt("America/New_York", at("2027-03-13T12:00:00Z"), null, 0n).toISOString(), "2027-03-14T07:05:00.000Z");
  });
  it("never sooner than 12 h after the last good sync; an unknown zone falls back to UTC", () => {
    const last = at("2026-11-12T20:00:00Z");
    assert.ok(nextAutoSyncAt("Asia/Kolkata", at("2026-11-12T20:00:00Z"), last, 17n).getTime() >= last.getTime() + 12 * 3_600_000);
    assert.equal(nextAutoSyncAt("Mars/Olympus", at("2026-11-12T09:30:00Z"), null, 0n).toISOString(), "2026-11-13T03:05:00.000Z");
  });
});

describe("back-off per kind (§7.7.1)", () => {
  it("IMPORT_SYNC 60 s, 5 min, 15 min, 15 min; IMPORT_PURGE 30 s, 2 min, 10 min; P3 kinds unchanged", () => {
    assert.deepEqual([1, 2, 3, 4, 9].map((a) => backoffSecFor("IMPORT_SYNC", a)), [60, 300, 900, 900, 900]);
    assert.deepEqual([1, 2, 3, 4].map((a) => backoffSecFor("IMPORT_PURGE", a)), [30, 120, 600, 600]);
    assert.deepEqual([1, 2, 3].map((a) => backoffSecFor("ANALYZE_GAME", a)), [1, 2, 3].map(backoffSec));
    assert.equal(backoffSecFor(undefined, 2), 120);
  });
});

describe("import events (§7.6 cadence)", () => {
  function events(clock: FakeClock, emitter = new RecordingEmitter(), userRef = "cuserref000000000000000001") {
    return {
      emitter,
      ev: new ImportEvents({ emitter, clock, log: silentLogger, userRef, provider: "chesscom", runRef: () => "crunref00000000000000000001" }),
    };
  }
  it("progress at most once a second; reading frames every 250 games or 2 s", async () => {
    resetGamesChangedThrottle();
    const clock = new FakeClock();
    const { emitter, ev } = events(clock);
    const n = { seen: 10, imported: 0, total: null, analysed: 0 };
    await ev.reading(n);
    await ev.saving({ ...n, imported: 100 });
    assert.equal(emitter.sent.length, 1, "inside the 1 s gap: dropped");
    await clock.advance(IMPORT_PROGRESS_MIN_GAP_MS);
    await ev.saving({ ...n, imported: 100, total: 200 });
    assert.equal(emitter.sent.length, 2);
    assert.equal(ev.readingDue(10 + IMPORT_PROGRESS_EVERY_GAMES - 1), false);
    assert.equal(ev.readingDue(10 + IMPORT_PROGRESS_EVERY_GAMES), true);
    await clock.advance(2_000);
    assert.equal(ev.readingDue(11), true);
    assert.deepEqual(emitter.sent[1]!.data, {
      v: 1,
      runRef: "crunref00000000000000000001",
      provider: "chesscom",
      phase: "saving",
      seen: 10,
      imported: 100,
      total: 200,
      analysed: 0,
    });
  });
  it("games:changed at most once per member per 10 s across runs, and once more at the end", async () => {
    resetGamesChangedThrottle();
    const clock = new FakeClock();
    const emitter = new RecordingEmitter();
    const a = events(clock, emitter).ev;
    const b = events(clock, emitter).ev;
    await a.added(100);
    await b.added(50);
    await a.added(0);
    assert.equal(emitter.sent.filter((e) => e.event === "games:changed").length, 1);
    await b.flushGamesChanged();
    assert.equal(emitter.sent.filter((e) => e.event === "games:changed").length, 2, "the end of a run that added games");
    await clock.advance(IMPORT_GAMES_CHANGED_MIN_GAP_MS);
    await a.added(1);
    assert.equal(emitter.sent.filter((e) => e.event === "games:changed").length, 3);
    assert.deepEqual(emitter.sent.at(-1)!.data, { v: 1 });
  });
  it("two games:changed sends in one second carry different bodies (the HMAC replay guard refused the second)", async () => {
    resetGamesChangedThrottle();
    const clock = new FakeClock();
    const emitter = new RecordingEmitter();
    const ev = events(clock, emitter).ev;
    await ev.added(100);
    await clock.advance(250);
    await ev.added(10);
    await ev.flushGamesChanged();
    const sent = emitter.sent.filter((e) => e.event === "games:changed");
    assert.equal(sent.length, 2);
    const bodies = sent.map((e) => JSON.stringify({ v: 1, targets: e.userRefs, event: e.event, data: e.data, dedupeKey: e.dedupeKey }));
    assert.notEqual(bodies[0], bodies[1]);
    assert.ok(sent.every((e) => e.dedupeKey && e.dedupeKey.length <= 120));
  });
  it("finished and failed carry their dedupe keys and pass the contract", async () => {
    const clock = new FakeClock();
    const { emitter, ev } = events(clock);
    await ev.finished(
      { imported: 45, skipped: 3, total: 45, newGames: 45, analysisQueued: 20, analysed: 0, firstReviewGameRef: null },
      "crunref00000000000000000001",
    );
    await ev.failed({ code: "rate_limited", retryAt: new Date(0).toISOString(), imported: 0, total: null }, "crunref00000000000000000001", 2);
    assert.deepEqual(emitter.sent.map((e) => [e.event, e.dedupeKey]), [
      ["import:finished", "import:finished:crunref00000000000000000001"],
      ["import:failed", "import:failed:crunref00000000000000000001:2"],
    ]);
    await assert.rejects(ev.failed({ code: "nope" as never, retryAt: null, imported: 0, total: null }, "crunref00000000000000000001", 1));
  });
});

describe("chunk rows (§8.8)", () => {
  const game = (o: Partial<ImportedGame> = {}): ImportedGame => ({
    source: "LICHESS",
    externalId: "abcd1234",
    externalUrl: "https://lichess.org/abcd1234",
    timeClass: "BLITZ",
    rated: true,
    endedAt: new Date("2026-10-14T23:30:00.000Z"),
    createdAtMs: Date.parse("2026-10-14T23:20:00.000Z"),
    whiteName: "a",
    blackName: "b",
    whiteRating: 1500,
    blackRating: 1490,
    whiteTitle: null,
    blackTitle: "BOT",
    outcome: "WHITE",
    endMethod: "RESIGNATION",
    legacyResult: "CREATOR_WON",
    ecoCode: "C50",
    openingName: "Italian Game",
    moves: "e2e4 e7e5",
    moveClocksMs: [1000, 2000],
    plyCount: 2,
    startPly: 0,
    startingFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    fen: "x",
    initialTimeSeconds: 180,
    incrementSeconds: 2,
    creatorTimeRemaining: 1,
    opponentTimeRemaining: 2,
    memberWon: true,
    color: "w",
    result: "WIN",
    ratingBefore: 1500,
    ratingDelta: 6,
    opponentName: "b",
    opponentRating: 1490,
    evalHint: { source: "lichess", cp: [10, 20] },
    ...o,
  });
  it("ISO-UTC times, the provider's creation time, the hint only on a queued game", () => {
    const queued = chunkRow({ game: game(), referenceId: "cref", ord: 1, priority: JOB_PRIORITY.IMPORT_NEWEST, fairSeq: 1 }, "77");
    assert.equal(queued.endedAt, "2026-10-14T23:30:00.000Z");
    assert.equal(queued.createdAt, "2026-10-14T23:20:00.000Z");
    assert.deepEqual(queued.evalHint, { source: "lichess", cp: [10, 20] });
    const unqueued = chunkRow({ game: game({ createdAtMs: null }), referenceId: "cref", ord: 2, priority: null, fairSeq: 0 }, "77");
    assert.equal(unqueued.evalHint, null, "a hint is only useful to a job");
    assert.equal(unqueued.createdAt, null);
  });
  // regression: chesscom-coclaim-squat (FIX-2): every row carries this link's claim copy id.
  it("the claim copy id: <id>~<link>, unique per link, always within games.externalId's 40 characters", () => {
    const row = chunkRow({ game: game(), referenceId: "cref", ord: 1, priority: null, fairSeq: 0 }, "77");
    assert.equal(row.copyExternalId, `${row.externalId}~77`);
    assert.equal(coClaimExternalId("123456789012", "9007199254740993"), "123456789012~9007199254740993");
    assert.notEqual(coClaimExternalId("123", "1"), coClaimExternalId("123", "2"));
    const uuid = "6f0b3c3e-1d2a-11ef-9a8c-6cfe544c0428";
    const long = coClaimExternalId(uuid, "9007199254740993");
    assert.ok(long.length <= EXTERNAL_ID_MAX, long);
    assert.match(long, /^[0-9a-f]+~9007199254740993$/);
    assert.equal(long, coClaimExternalId(uuid, "9007199254740993"), "stable");
    assert.notEqual(long, coClaimExternalId(`${uuid.slice(0, -1)}9`, "9007199254740993"));
    for (const id of ["1", uuid, "x".repeat(40)]) assert.ok(coClaimExternalId(id, "123456").length <= EXTERNAL_ID_MAX);
  });
  it("one statement holds 1..100 games", () => {
    const input = { jobId: "1", me: "m", source: "LICHESS" as const, userId: "1", linkedAccountId: "1", runId: "1", phase: "saving" as const, total: null, seen: null, resumeUntilMs: null };
    assert.throws(() => chunkStatement({ ...input, games: [] }));
    const many = Array.from({ length: IMPORT_CHUNK + 1 }, (_, i) => ({ game: game(), referenceId: `c${i}`, ord: i, priority: null, fairSeq: 0 }));
    assert.throws(() => chunkStatement({ ...input, games: many }));
    assert.equal(chunkStatement({ ...input, games: many.slice(0, IMPORT_CHUNK) }).values.length, 12);
  });
});
