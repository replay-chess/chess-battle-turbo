// The pure parts of the TR-5 / TR-12 services (phase-06 plan §7.1.1, §7.1.2): the jobs probe read back, the running
// imports, the version ETag (what moves it, what does not), the requested scope and the 429's retry time. The routes
// themselves run on Postgres in test/api/train-weakness.int.test.ts.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { weaknessPayloadFixture } from "@/components/train/weakness/__fixtures__/payloads";
import { analysisLanes, importRunOf, jobsStateOf, secondsPerGame, weaknessEtag, weaknessKickBody } from "./weakness.server";
import { recomputeLimitError, requestedScope, sameScope } from "./weakness-write.server";

const NOW = new Date("2026-11-17T19:00:00.000Z");
const IDLE = { recompute: "none", lastJobFailed: false, activeAnalyzeJobs: 0, importJobs: 0, recomputeQueued: false, paused: false } as const;
const live = (over: Partial<Parameters<typeof weaknessEtag>[1]> = {}) => ({ timeZone: "Europe/London", jobs: { ...IDLE }, windowGames: 0, importDone: 0, importTotal: 0, ...over });

describe("jobsStateOf (Q-W3 jobs part)", () => {
  it("reads the recompute state, the failed row, the active analyses and imports", () => {
    assert.deepEqual(jobsStateOf([]), IDLE);
    const s = jobsStateOf([
      { kind: "ANALYZE_GAME", status: "QUEUED", n: 13 },
      { kind: "ANALYZE_GAME", status: "RUNNING", n: 1 },
      { kind: "RECOMPUTE_WEAKNESS", status: "QUEUED", n: 1 },
      { kind: "IMPORT_SYNC", status: "RUNNING", n: 1 },
    ]);
    assert.deepEqual(s, { recompute: "queued", lastJobFailed: false, activeAnalyzeJobs: 14, importJobs: 1, recomputeQueued: true, paused: false });
    assert.equal(jobsStateOf([{ kind: "RECOMPUTE_WEAKNESS", status: "RUNNING", n: 1 }]).recompute, "running");
    assert.equal(jobsStateOf([{ kind: "RECOMPUTE_WEAKNESS", status: "FAILED", n: 1 }]).lastJobFailed, true);
    // regression: weakness-killswitch-loop (FIX-1): the job row's DONE `skipped: "disabled"` reads as paused.
    assert.equal(jobsStateOf([{ kind: "RECOMPUTE_WEAKNESS", status: "PAUSED", n: 1 }]).paused, true);
  });
});

describe("importRunOf", () => {
  it("no queued or running import run → null (a DAILY wake job alone is not an import)", () => {
    assert.equal(importRunOf(undefined, NOW), null);
    assert.equal(importRunOf({ runs: 0, imported: 0, seen: 0, total: 0, totalUnknown: null, startedAt: null }, NOW), null);
  });
  it("a known total; the rate from the run's start; an unknown total stays one ahead of what was seen", () => {
    const started = new Date(NOW.getTime() - 100_000);
    assert.deepEqual(importRunOf({ runs: 1, imported: 212, seen: 230, total: 480, totalUnknown: false, startedAt: started }, NOW), { done: 212, total: 480, ratePerSec: 2.12 });
    assert.deepEqual(importRunOf({ runs: 1, imported: 0, seen: 57, total: 0, totalUnknown: true, startedAt: null }, NOW), { done: 0, total: 58, ratePerSec: null });
  });
});

describe("weaknessEtag", () => {
  it("a settled READY profile: wk1:{snapshotKey}:{algo}:{bankHash}:0:{seen}", () => {
    const p = weaknessPayloadFixture("ready");
    const tag = weaknessEtag(p, live());
    assert.match(tag, new RegExp(`^wk1:${p.snapshotKey!.replace(".", "\\.")}:1:[0-9a-f]{16}:0:${p.seenVersion}$`));
    assert.equal(weaknessEtag(p, live()), tag, "deterministic");
  });
  it("moves with the bank counts, the rating, the version, the seen version and the zone; not with row order", () => {
    const p = weaknessPayloadFixture("ready");
    const tag = weaknessEtag(p, live());
    const bank = { ...p, top: p.top.map((r, i) => (i === 0 ? { ...r, inBank: r.inBank + 1 } : r)) };
    assert.notEqual(weaknessEtag(bank, live()), tag);
    assert.notEqual(weaknessEtag({ ...p, rating: (p.rating ?? 0) + 7 }, live()), tag);
    assert.notEqual(weaknessEtag({ ...p, version: p.version + 1 }, live()), tag);
    assert.notEqual(weaknessEtag({ ...p, seenVersion: p.seenVersion + 1 }, live()), tag);
    assert.notEqual(weaknessEtag(p, live({ timeZone: "Asia/Kolkata" })), tag);
    assert.notEqual(weaknessEtag({ ...p, snapshotKey: "2026-11-16.zz" }, live()), tag);
    assert.equal(weaknessEtag({ ...p, top: [...p.top].reverse() }, live()), tag);
    // A settled profile ignores the probe's counters (they are not in its body).
    assert.equal(weaknessEtag(p, live({ windowGames: 300 })), tag);
  });
  it("while building, every probe counter is in the tick", () => {
    const p = weaknessPayloadFixture("computing");
    const base = weaknessEtag(p, live({ windowGames: 25 }));
    assert.match(base, /:c\./);
    assert.notEqual(weaknessEtag({ ...p, games: { ...p.games, analysed: p.games.analysed + 1 } }, live({ windowGames: 25 })), base);
    assert.notEqual(weaknessEtag(p, live({ windowGames: 26 })), base);
    assert.notEqual(weaknessEtag(p, live({ windowGames: 25, importDone: 3 })), base);
    assert.notEqual(weaknessEtag(p, live({ windowGames: 25, jobs: { ...IDLE, recompute: "running" } })), base);
    assert.notEqual(weaknessEtag(p, live({ windowGames: 25, jobs: { ...IDLE, activeAnalyzeJobs: 4 } })), base);
    const updating = weaknessPayloadFixture("ready_updating");
    assert.notEqual(weaknessEtag(updating, live()).split(":")[4], "0", "updating is not settled");
  });
});

describe("requestedScope / sameScope (TR-12)", () => {
  it("unspecified fields keep the stored scope; the default (rapid + blitz, 6 months) equals the empty stored columns", () => {
    const none = requestedScope(null, {});
    assert.ok(sameScope(none.current, none.next));
    assert.deepEqual(none.current, { timeClasses: ["RAPID", "BLITZ"], months: 6, maxGames: 300 });
    assert.ok(sameScope(requestedScope(null, { timeClasses: ["BLITZ", "RAPID"] }).next, none.current), "order does not matter");
    const bullet = requestedScope({ weaknessTimeClasses: [], weaknessMonths: 0 }, { timeClasses: ["BULLET", "BLITZ", "RAPID"] });
    assert.deepEqual(bullet.next.timeClasses, ["RAPID", "BLITZ", "BULLET"]);
    assert.equal(sameScope(bullet.current, bullet.next), false);
    const months = requestedScope({ weaknessTimeClasses: ["RAPID", "BLITZ", "BULLET"], weaknessMonths: 6 }, { months: 12 });
    assert.deepEqual(months.next, { timeClasses: ["RAPID", "BLITZ", "BULLET"], months: 12, maxGames: 300 });
  });
});

describe("recomputeLimitError", () => {
  it("429 rate_limited with retryAfterSec within 1…600", () => {
    const e = recomputeLimitError(NOW.getTime() - 240_000, NOW);
    assert.equal(e.code, "rate_limited");
    assert.equal(e.status, 429);
    assert.equal(e.retryAfterSec, 360);
    assert.equal(recomputeLimitError(NOW.getTime() - 599_500, NOW).retryAfterSec, 1);
    // FIX-3 (D-P6-FIX3-5): a hide stamps the instant of the run it armed, up to one window ahead: the answer is that
    // instant + the window, never more than two windows (FIX-2 clamped it to one window, an early retry got a 429 again).
    assert.equal(recomputeLimitError(NOW.getTime() + 5_000, NOW).retryAfterSec, 605, "a run armed 5 s ahead: retry 605 s from now");
    assert.equal(recomputeLimitError(NOW.getTime() + 3_600_000, NOW).retryAfterSec, 1_200, "never more than two windows");
    assert.equal(recomputeLimitError(null, NOW).retryAfterSec, 600);
  });
});

describe("environment and kick body", () => {
  it("ANALYSIS_SECONDS_PER_GAME / ANALYSIS_LANES with their defaults", () => {
    assert.equal(secondsPerGame({}), 45);
    assert.equal(secondsPerGame({ ANALYSIS_SECONDS_PER_GAME: "30" }), 30);
    assert.equal(secondsPerGame({ ANALYSIS_SECONDS_PER_GAME: "x" }), 45);
    assert.equal(analysisLanes({}), 1);
    assert.equal(analysisLanes({ ANALYSIS_LANES: "2" }), 2);
    assert.equal(analysisLanes({ ANALYSIS_LANES: "0" }), 1);
  });
  it("the kick always names RECOMPUTE_WEAKNESS and carries runAt (no replay refusal for two kicks in a second)", () => {
    assert.deepEqual(weaknessKickBody(NOW), { v: 1, reason: "weakness", kinds: ["RECOMPUTE_WEAKNESS"], runAt: NOW.toISOString() });
  });
});
