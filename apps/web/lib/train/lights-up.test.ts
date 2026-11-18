// P6 lights up (phase-06 plan §7.1.5, §8.15; WP7), the pure parts: the READY snapshot's top row → the hub row, the
// Home line and the plan focus; nothing without a READY snapshot; and the flag-off reads run P5's statements only.
// The rows themselves come from the engine's golden output (`computeWeakness` over the design member); the same
// reads against real Postgres rows are in test/api/lights-up.int.test.ts.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Prisma } from "@repo/db";
import golden from "@repo/chess-training/fixtures/weakness/member-design.golden.json";
import { focusTheme } from "@repo/chess-training/plan";
import { bankLine } from "../../components/home/copy";
import { weaknessRowSub } from "../../components/train/hub/parts";
import { viewerFixture } from "../../test/helpers/route-harness";
import { getHomeData, homeTopTheme } from "../home/home.server";
import type { TrainDb, TrainDeps } from "./db.server";
import { getTrainToday, topWeaknessOf } from "./today.server";

const READY = { status: "READY", metrics: golden.metrics };
const BANK = [
  { theme: "fork", n: 12 },
  { theme: "hangingPiece", n: 5 },
  { theme: "rc:timePressure", n: 9 },
];

describe("topWeaknessOf (Q-W1 ‖ Q-W2 → the lit slots)", () => {
  it("READY: the top row's label, its live bank count, the drill href and the first matchable row's Lichess theme", () => {
    assert.deepEqual(topWeaknessOf(READY, BANK), {
      pattern: "fork",
      label: "Missed forks",
      inBank: 12,
      href: "/train/weakness/fork?from=hub",
      focusTheme: "fork",
      focusIsTop: true,
    });
  });

  it("the focus skips rows with no matched puzzles (time pressure, development) and the href uses the slug", () => {
    const rows = golden.metrics.rows;
    const tpFirst = { status: "READY", metrics: { ...golden.metrics, rows: [rows[2]!, rows[3]!, rows[1]!] } };
    const top = topWeaknessOf(tpFirst, BANK)!;
    assert.equal(top.pattern, "rc:timePressure");
    assert.equal(top.href, "/train/weakness/time-pressure?from=hub");
    assert.equal(top.inBank, 9);
    assert.equal(top.focusTheme, "hangingPiece", "rc:timePressure and rc:development have no Lichess match");
    // The plan's step-2 rule takes it as the weakness focus (a theme the shards serve). regression:
    // hub-two-weakest (FIX-2): it is a LOWER row's match, so the step never calls it "your weakest" or "top" theme.
    assert.equal(top.focusIsTop, false);
    assert.deepEqual(focusTheme([], top.focusTheme, top.focusIsTop), { key: "hangingPiece", source: "weaknessRow" });
    assert.deepEqual(focusTheme([], "fork", true), { key: "fork", source: "weakness" });
    const mostFrequent = { status: "READY", metrics: { ...golden.metrics, listMode: "most_frequent" } };
    assert.equal(topWeaknessOf(mostFrequent, BANK)!.focusIsTop, false, "a most-frequent list has no weakness to call the top one");
    const noMatch = { status: "READY", metrics: { ...golden.metrics, rows: [rows[2]!, rows[3]!] } };
    assert.equal(topWeaknessOf(noMatch, BANK)!.focusTheme, null);
    assert.equal(focusTheme([], null).source, "default", "no matchable row: P5's focus rules");
  });

  it("no bank card for the top pattern reads 0; a missing, INSUFFICIENT, FAILED, empty or foreign document reads null", () => {
    assert.equal(topWeaknessOf(READY, [])!.inBank, 0);
    assert.equal(topWeaknessOf(undefined, BANK), null);
    assert.equal(topWeaknessOf({ status: "INSUFFICIENT", metrics: golden.metrics }, BANK), null);
    assert.equal(topWeaknessOf({ status: "FAILED", metrics: golden.metrics }, BANK), null);
    assert.equal(topWeaknessOf({ status: "READY", metrics: { ...golden.metrics, rows: [] } }, BANK), null);
    assert.equal(topWeaknessOf({ status: "READY", metrics: { v: 99 } }, BANK), null, "a document another build wrote");
    assert.equal(topWeaknessOf({ status: "READY", metrics: JSON.stringify(golden.metrics) }, BANK)?.pattern ?? null, null, "metrics arrive as jsonb objects, never text");
  });
});

describe("the lit copy", () => {
  it("hub row: 'Missed forks · 12 in your bank'", () => {
    assert.equal(weaknessRowSub({ label: "Missed forks", inBank: 12, href: "/train/weakness/fork?from=hub" }), "Missed forks · 12 in your bank");
  });

  it("Home: the weakness line with a READY profile, P5's line otherwise (no `source` key)", () => {
    const top = topWeaknessOf(READY, BANK);
    assert.deepEqual(homeTopTheme({ theme: "hangingPiece", bankCount: 7 }, top), { label: "Missed forks", n: 12, source: "weakness" });
    assert.deepEqual(homeTopTheme({ theme: "hangingPiece", bankCount: 7 }, null), { label: "Loose pieces", n: 7 });
    assert.equal(homeTopTheme(undefined, null), null);
    const bank = { due: 4, total: 23, estMin: 3, thumbs: [], nextBatch: null };
    assert.equal(bankLine({ ...bank, topTheme: homeTopTheme(undefined, top) }, false), "Missed forks is your top weakness (12 in bank).");
    assert.equal(bankLine({ ...bank, topTheme: homeTopTheme({ theme: "hangingPiece", bankCount: 7 }, null) }, false), "Loose pieces is your most common theme (7 in bank).");
  });
});

// ── Statements: flag off = P5's batch; flag on = + Q-W1 and Q-W2 ───────────────────────────────────────────────
type Recorded = string[];
/** Home's h1 answers one finished game (a populated member: no featured-position read through the data cache). */
const CONTINUE_ROW = {
  ref: "cgame0000000000000000000000",
  color: "w",
  result: "WIN",
  endedAt: new Date("2026-11-12T18:00:00.000Z"),
  opponentName: "opp",
  opponentRating: 1500,
  momentsCount: 0,
  accuracy: 80,
  analysisStatus: "DONE",
  plyCount: 0,
  openingName: null,
  startingFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  startPly: 0,
  moves: "",
  gradedPlies: 0,
  totalPlies: 0,
  kPly: null,
};
function recordingDeps(log: Recorded): TrainDeps {
  const db: TrainDb = {
    $queryRaw: <T>(sql: Prisma.Sql) => {
      log.push(sql.text);
      return Promise.resolve((/"kPly"/.test(sql.text) ? [CONTINUE_ROW] : []) as unknown as T);
    },
    $executeRaw: (sql: Prisma.Sql) => {
      log.push(sql.text);
      return Promise.resolve(0);
    },
  };
  return { db, tx: (fn) => fn(db) };
}
const viewer = viewerFixture({ id: 42n, ref: "cviewer00000000000000000000", user: { name: "lights", timeZone: "Asia/Kolkata" } });
const NOW = new Date("2026-11-12T19:00:00.000Z");
const isWeaknessRead = (t: string) => /FROM weakness_snapshots/.test(t) || /unnest\(m\.themes\)/.test(t);

describe("the lit reads join the existing batch only with the flag on", () => {
  for (const [name, run] of [
    ["getTrainToday", (d: TrainDeps, weakness?: boolean) => getTrainToday(viewer, NOW, d, { weakness })],
    ["getHomeData", (d: TrainDeps, weakness?: boolean) => getHomeData(viewer, NOW, d, { weakness })],
  ] as const) {
    it(`${name}: off (explicit or evaluated, the registry default) runs P5's statements; on adds exactly Q-W1 and Q-W2`, async () => {
      const off: Recorded = [];
      const evaluated: Recorded = [];
      const on: Recorded = [];
      const offData = await run(recordingDeps(off), false);
      await run(recordingDeps(evaluated));
      const onData = await run(recordingDeps(on), true);
      assert.equal(off.some(isWeaknessRead), false);
      assert.deepEqual(evaluated, off, "the flag defaults off: the same statements, in the same order");
      assert.deepEqual(on.filter((t) => !isWeaknessRead(t)), off);
      assert.equal(on.filter(isWeaknessRead).length, 2);
      // No READY row (the stub returns none): the payload is P5's byte for byte.
      assert.equal(JSON.stringify(onData), JSON.stringify(offData));
    });
  }
});
