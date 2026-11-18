// Unit checks of the worker's P6 pieces that need no database (phase-06 plan §7.4, §12.1/§12.3): the triggers and the
// kill switch, the in-scope rule of an analysed game, the example FEN, the heal's row mapping, the final-batch
// extension, the daily slice's statements, the lane routing, and the I/O lane's timer audit with RECOMPUTE_WEAKNESS on
// it (24 idle hours after a drain: no query, one timer). The Postgres behaviour is in the *.int.test.ts files.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import { CountingDb } from "../db/client";
import { silentLogger } from "../obs/log";
import { Metrics } from "../obs/metrics";
import { p06WeaknessExtension } from "../pipeline/final-batch/p06-weakness";
import type { GameMember } from "../pipeline/types";
import { IO_KINDS, IoLane, kickTargets } from "../queue/lanes";
import { FakeClock } from "../scheduler/clock";
import { healSweepStatement, pruneSnapshotsStatement, weaknessSlice, weeklyRollStatement } from "../scheduler/recurring/weakness";
import { RecordingEmitter } from "../socket/emit";
import { FakeQueue } from "../testing/fake-queue";
import { inMemberScope } from "./analysis";
import { exampleFen, toExamples } from "./examples";
import { healRows, rowsToHeal } from "./heal";
import type { LoadedInput } from "./load";
import { defaultWeaknessSettings } from "./settings";
import { analysisTriggerStatement, firstBuildStatement, importTriggerStatement } from "./triggers";

const ON = defaultWeaknessSettings();
const OFF = defaultWeaknessSettings({ enabled: false });
const NOW = Date.UTC(2026, 10, 12, 9, 30, 0);

describe("weakness triggers", () => {
  it("the kill switch: no trigger builds a statement", () => {
    assert.equal(analysisTriggerStatement(["41"], OFF), null);
    assert.equal(firstBuildStatement("41", NOW, OFF), null);
    assert.equal(importTriggerStatement("41", NOW, OFF), null);
    assert.equal(analysisTriggerStatement([], ON), null, "no member in scope: nothing");
  });

  it("analysis: READY members only (in SQL), WEAKNESS, the database's now + 240 s, a 240 s debounce", () => {
    const s = analysisTriggerStatement(["41", "42"], ON)!;
    assert.match(s.text, /ws\.status = 'READY'/);
    assert.match(s.text, /ARRAY\[41, 42\]::bigint\[\]/);
    assert.ok(s.values.includes(JOB_PRIORITY.WEAKNESS));
    assert.ok(s.values.includes(240));
    assert.throws(() => analysisTriggerStatement(["41; DROP TABLE jobs"], ON), /not a user id/);
  });

  it("first_build at GAME_ENDED now; import at WEAKNESS now + 120 s; the seed freeze rides along", () => {
    const fb = firstBuildStatement("41", NOW, defaultWeaknessSettings({ seedFreeze: true }))!;
    assert.ok(fb.values.includes(JOB_PRIORITY.GAME_ENDED));
    assert.ok(fb.values.includes(new Date(NOW).toISOString()));
    assert.match(fb.text, /make_interval\(secs => \$\d+::int\)\)/);
    const imp = importTriggerStatement("41", NOW, ON)!;
    assert.ok(imp.values.includes(new Date(NOW + 120_000).toISOString()));
    assert.ok(imp.values.includes(JOB_PRIORITY.WEAKNESS));
  });
});

const member = (over: Partial<GameMember["weakness"]> & { result?: GameMember["result"] } = {}): GameMember => ({
  color: "w",
  userId: "41",
  userRef: "cuser000000000000000000041",
  result: over.result ?? "WIN",
  weakness: {
    timeZone: over.timeZone ?? "Asia/Kolkata",
    weaknessTimeClasses: over.weaknessTimeClasses ?? [],
    weaknessMonths: over.weaknessMonths ?? 0,
    endedAtMs: over.endedAtMs === undefined ? NOW - 86_400_000 : over.endedAtMs,
  },
});

describe("inMemberScope (§8.2)", () => {
  const now = new Date(NOW);
  it("default scope: rapid and blitz of the last 6 months, no bot games, no aborted games", () => {
    assert.equal(inMemberScope({ mode: "IMPORTED", timeClass: "BLITZ" }, member(), now), true);
    assert.equal(inMemberScope({ mode: "ONLINE", timeClass: "RAPID" }, member(), now), true);
    assert.equal(inMemberScope({ mode: "IMPORTED", timeClass: "BULLET" }, member(), now), false);
    assert.equal(inMemberScope({ mode: "BOT", timeClass: "BLITZ" }, member(), now), false);
    assert.equal(inMemberScope({ mode: "LEGEND_BOT", timeClass: "BLITZ" }, member(), now), false);
    assert.equal(inMemberScope({ mode: "IMPORTED", timeClass: "BLITZ" }, member({ result: "ABORTED" }), now), false);
    assert.equal(inMemberScope({ mode: "IMPORTED", timeClass: "BLITZ" }, member({ endedAtMs: null }), now), false);
    const noScope: GameMember = { ...member(), weakness: undefined };
    assert.equal(inMemberScope({ mode: "IMPORTED", timeClass: "BLITZ" }, noScope, now), false, "no scope read: never in scope");
  });

  it("the window starts at local midnight on the 1st, `months` back, in the member's zone", () => {
    // 2026-05-01 00:00 in Kolkata = 2026-04-30 18:30 UTC.
    const start = Date.UTC(2026, 3, 30, 18, 30, 0);
    assert.equal(inMemberScope({ mode: "IMPORTED", timeClass: "BLITZ" }, member({ endedAtMs: start }), now), true);
    assert.equal(inMemberScope({ mode: "IMPORTED", timeClass: "BLITZ" }, member({ endedAtMs: start - 1 }), now), false);
    const bullet = member({ weaknessTimeClasses: ["BULLET"], weaknessMonths: 3 });
    assert.equal(inMemberScope({ mode: "IMPORTED", timeClass: "BULLET" }, bullet, now), true);
    assert.equal(inMemberScope({ mode: "IMPORTED", timeClass: "BLITZ" }, bullet, now), false);
  });
});

describe("examples (§8.19)", () => {
  it("applies the setup move: the member to move", () => {
    const fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
    assert.equal(exampleFen(fen, "e7e5"), "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2");
    assert.equal(exampleFen(fen, null), fen);
    assert.equal(exampleFen(fen, "e2e4"), null, "an illegal setup move gives no example");
    const ex = toExamples([{ pattern: "fork", ref: "cmistake0000000000000001", fen, setupUci: "e7e5", color: "w" }]);
    assert.deepEqual(ex.get("fork"), { fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2", orient: "w", mistakeRef: "cmistake0000000000000001" });
  });
});

describe("heal row mapping", () => {
  const input = (over: Partial<LoadedInput>): LoadedInput => ({
    gameId: "7",
    color: "w",
    endedAt: new Date(NOW),
    timeClass: "BLITZ",
    mode: "IMPORTED",
    result: "WIN",
    ratingBefore: 1200,
    rated: true,
    source: "LICHESS",
    oppTitle: null,
    ecoCode: "C55",
    accuracy: 80,
    phaseAccuracy: [80, 80, -1],
    stats: [],
    errorLog: [],
    errorThemeN: [],
    errorThemes: [],
    weaknessInputsV: 0,
    analysedAtMs: NOW,
    ...over,
  });
  it("only analysed rows without inputs; a missing or unfinished analysis counts as failed, never thrown", () => {
    const rows = [input({}), input({ gameId: "8", accuracy: null }), input({ gameId: "9", weaknessInputsV: 1 })];
    assert.deepEqual(rowsToHeal(rows).map((r) => r.gameId), ["7"]);
    // FIX-2: the failed sides are returned (the caller marks them −1 so no later run picks them again).
    const failed = { rows: [], failed: 1, failedSides: [{ gameId: "7", color: "w" }], partialGames: [] };
    assert.deepEqual(healRows(rowsToHeal(rows), []), failed);
    assert.deepEqual(healRows(rowsToHeal(rows), [{ gameId: "7", done: false }]), failed);
    let errors = 0;
    const bad = healRows(rowsToHeal(rows), [{ gameId: "7", done: true, startingFen: "8/8/8/8/8/8/8/8 w - - 0 1", startPly: 0, moves: "e2e4", evals: [], best: [], judgements: [] }], () => errors++);
    assert.deepEqual(bad, failed);
    assert.equal(errors, 1, "the error is reported");
    // A row whose heal failed (−1) is no candidate any more.
    assert.deepEqual(rowsToHeal([input({ weaknessInputsV: -1 })]), []);
  });
});

describe("the p06-weakness final-batch extension", () => {
  it("adds nothing without a plan or with the kill switch; the columns and the trigger otherwise", () => {
    const ctx = { weakness: null } as never;
    assert.deepEqual(p06WeaknessExtension.statements(ctx), []);
    const side = { gameId: "7", color: "w" as const, stats: Array(30).fill(0), errorLog: [], errorThemeN: [], errorThemes: [] };
    assert.deepEqual(p06WeaknessExtension.statements({ weakness: { sides: [side], inScope: ["41"], settings: OFF } } as never), []);
    const out = p06WeaknessExtension.statements({ weakness: { sides: [side], inScope: ["41"], settings: ON } } as never);
    assert.equal(out.length, 2);
    assert.match(out[0]!.text, /UPDATE game_players gp/);
    assert.match(out[1]!.text, /RECOMPUTE_WEAKNESS/);
    assert.equal(p06WeaknessExtension.statements({ weakness: { sides: [], inScope: [], settings: ON } } as never).length, 0);
  });
});

describe("the daily weakness slice (§7.4.6)", () => {
  it("weekly roll and heal sweep only when enabled; the prune always; parameter-free CTEs before the shared upsert", () => {
    const ctx = (weakness?: typeof ON) => ({ weakness }) as never;
    assert.equal(weaknessSlice.statements!(ctx(ON)).length, 3);
    assert.equal(weaknessSlice.statements!(ctx(OFF)).length, 1);
    assert.equal(weaknessSlice.statements!(ctx(undefined)).length, 1);
    for (const s of [weeklyRollStatement(ON), healSweepStatement(ON)]) {
      const cte = s.text.slice(0, s.text.indexOf("up AS ("));
      assert.doesNotMatch(cte, /\$\d/, "the candidate CTEs carry no parameter of their own");
      assert.match(s.text, /pg_timezone_names/, "an unknown zone counts as UTC, never fails the batch");
    }
    assert.match(weeklyRollStatement(ON).text, /date_trunc\('week'/);
    // FIX-2 (D-P6-FIX2-14): `algo` for an older algorithm's snapshot, else `heal` (no snapshot, or a paused member).
    assert.match(healSweepStatement(ON).text, /THEN 'algo' ELSE 'heal' END/);
    assert.match(healSweepStatement(ON).text, /result->>'skipped' = 'disabled'/, "a member the kill switch paused is re-armed");
    assert.deepEqual(pruneSnapshotsStatement().values, [12, 1_000]);
  });

  it("after(): logs the counts and wakes the I/O lane only when it armed something", async () => {
    let wakes = 0;
    const base = { log: silentLogger, weakness: ON, wakeIo: () => wakes++ } as never;
    await weaknessSlice.after!(base, [[{ rolled: 0 }], [{ healed: 0 }], [{ pruned: 3 }]]);
    assert.equal(wakes, 0);
    await weaknessSlice.after!(base, [[{ rolled: 2 }], [{ healed: 0 }], [{ pruned: 0 }]]);
    assert.equal(wakes, 1);
  });
});

describe("lanes", () => {
  it("RECOMPUTE_WEAKNESS is an I/O kind: its kick wakes the I/O lane only", () => {
    assert.ok(IO_KINDS.includes("RECOMPUTE_WEAKNESS"));
    assert.deepEqual(kickTargets({ kinds: ["RECOMPUTE_WEAKNESS"] }), { engine: false, io: true });
  });

  it("TIMER AUDIT (I/O lane with the weakness kind): one drain, then 24 idle hours without a query or a second timer", async () => {
    const clock = new FakeClock(NOW);
    const queue = new FakeQueue(() => clock.now());
    const db = new CountingDb(queue);
    const lane = new IoLane({
      db,
      clock,
      log: silentLogger,
      metrics: new Metrics({ workerId: "dev-worker", bootId: "abcd1234", version: "0", profile: "sf18-v1" }, clock.now()),
      emitter: new RecordingEmitter(),
      me: "dev-worker-abcd1234",
      workerId: "dev-worker",
      kinds: ["RECOMPUTE_WEAKNESS"],
      payloadVMax: 1,
      runJob: async () => undefined,
    });
    lane.start();
    await clock.advance(0);
    // One claim: the other slot may not claim the one-at-a-time kind while this one holds the turn (FIX-1), and with no
    // import kind on the lane it has nothing else to ask for.
    assert.deepEqual(queue.log, ["claim", "reap", "reap", "summary"]);
    const trips = db.counters.roundTrips;
    await clock.advance(24 * 3_600_000 - 1);
    assert.equal(db.counters.roundTrips, trips, "no polling while idle");
    assert.equal(clock.pending, 1, "only the lane's one sleep");
    // A weakness row armed 240 s out by another lane: the wake names its runAt and re-arms the same sleep.
    lane.kick({ v: 1, reason: "weakness", kinds: ["RECOMPUTE_WEAKNESS"], runAt: new Date(clock.now() + 240_000).toISOString() });
    assert.equal(clock.pending, 1);
    assert.equal(clock.nextDue, clock.now() + 240_000);
  });
});
