// The P6 → P8 legend-lesson hand-off (phase-06 plan §7.6, critique C-07). P8 replaces the body of
// `resolveLessonForPattern` with a real lookup and must keep this file green:
//   1. the signature: one pattern key in, a Promise of `{slug, title, sub} | null` out (null for every pattern in P6);
//   2. a payload built with a lesson on every row still parses with the TR-5 contract, carries the lesson in the three
//      slots (row, drill config via the row, the week plan's third row) and stays under the 8 KB budget (§9.3), also
//      with the longest strings the contract allows.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WEAKNESS_PAYLOAD_MAX_BYTES, WeaknessLesson, WeaknessPayload } from "@repo/contracts/http/weakness";
import golden from "@repo/chess-training/fixtures/weakness/member-design.golden.json";
import { buildPayload } from "@repo/chess-training/weakness/payload";
import { WEAKNESS_CANDIDATES } from "@repo/chess-training/themes";
import type { WeaknessMetricsV1 } from "@repo/chess-training/weakness/types";
import { resolveLessonForPattern, resolveLessons } from "./weakness-lessons.server";

const metrics = (golden as unknown as { metrics: WeaknessMetricsV1 }).metrics;
const NOW = new Date("2026-11-16T10:00:00.000Z");

function payloadWith(lessons: Record<string, WeaknessLesson | null>) {
  return buildPayload({
    now: NOW,
    timeZone: "Europe/London",
    snapshot: { weekStart: "2026-11-16", algoVersion: 1, status: "READY", gamesInScope: metrics.games.inScope, gamesAnalysed: metrics.games.analysed, metrics, computedAt: NOW },
    profile: { weaknessTimeClasses: [], weaknessMonths: 0, puzzleRating: 1512, weaknessVersion: 3, lastWeaknessSeenVersion: 2 },
    inBank: { fork: 12, hangingPiece: 7, "rc:timePressure": 4 },
    probe: { recompute: "none", lastJobFailed: false, activeAnalyzeJobs: 0, games: null, importRun: null, lastAnalysedAt: null },
    isTrialing: false,
    secPerGame: 45,
    lanes: 1,
    lessons,
  });
}

describe("resolveLessonForPattern (the P8 hand-off)", () => {
  it("takes one pattern key and answers a promise of a lesson or null; null for every weakness candidate in P6", async () => {
    assert.equal(typeof resolveLessonForPattern, "function");
    assert.equal(resolveLessonForPattern.length, 1);
    for (const key of WEAKNESS_CANDIDATES) {
      const out = resolveLessonForPattern(key);
      assert.ok(out instanceof Promise, key);
      const lesson = await out;
      assert.ok(lesson === null || WeaknessLesson.safeParse(lesson).success, key);
      assert.equal(lesson, null, `${key}: P6 ships no lessons`);
    }
  });

  it("resolveLessons asks once per distinct pattern and keys the answers by pattern", async () => {
    const out = await resolveLessons(["fork", "fork", "rc:timePressure"]);
    assert.deepEqual(Object.keys(out).sort(), ["fork", "rc:timePressure"]);
    assert.ok(Object.values(out).every((v) => v === null));
  });
});

describe("a payload with lessons (what P8 turns on)", () => {
  it("parses, fills the row and week-plan slots, and stays under 8 KB, also with the longest lesson strings", () => {
    const rows = metrics.rows.map((r) => r.pattern);
    assert.ok(rows.length >= 3, "the golden profile has rows");
    const typical: Record<string, WeaknessLesson> = Object.fromEntries(
      rows.map((p) => [p, { slug: `legend-${p.replace(/[^a-z]/gi, "").toLowerCase()}`, title: "Tal vs Smyslov, 1959", sub: "A world champion’s forks, then play it out" }]),
    );
    const longest: Record<string, WeaknessLesson> = Object.fromEntries(
      rows.map((p) => [p, { slug: "s".repeat(80), title: "T".repeat(80), sub: "S".repeat(100) }]),
    );
    for (const lessons of [typical, longest]) {
      const p = WeaknessPayload.parse(payloadWith(lessons));
      for (const r of [...p.top, ...p.more]) assert.deepEqual(r.lesson, lessons[r.pattern], r.pattern);
      const plan = p.weekPlan.find((w) => w.kind === "lesson");
      assert.ok(plan, "the week plan's third row");
      assert.equal(p.weekPlan.length, 3);
      assert.ok(plan.href.startsWith(`/learn/lessons/${lessons[p.top[0]!.pattern]!.slug}`));
      assert.ok(plan.href.endsWith("?from=weakness"));
      const bytes = Buffer.byteLength(JSON.stringify({ data: p }), "utf8");
      assert.ok(bytes < WEAKNESS_PAYLOAD_MAX_BYTES, `${bytes} B`);
    }
  });

  it("without lessons the slots are empty: no lesson on any row, two week-plan rows", () => {
    const p = WeaknessPayload.parse(payloadWith({}));
    assert.ok([...p.top, ...p.more].every((r) => r.lesson === null));
    assert.ok(p.weekPlan.every((w) => w.kind !== "lesson"));
  });
});
