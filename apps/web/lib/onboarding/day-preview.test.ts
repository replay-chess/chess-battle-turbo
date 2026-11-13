// Daily plan preview (phase-04 plan §8.3, §4.5; §12.1 day-preview.test.ts).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DAILY_MINUTES, ONBOARDING_GOALS, fromWire, type DailyMinutes, type OnboardingGoalDb } from "@repo/contracts/http/p04-plain";
import {
  DEFAULT_GOALS,
  DEFAULT_MINUTES,
  GOAL_COPY,
  GOAL_ORDER,
  GOAL_WEIGHTS,
  SKIP_GOALS,
  SKIP_MINUTES,
  goalsState,
  initialGoalsState,
  orderedGoals,
  previewDay,
  splitMinutes,
} from "./day-preview";

const minutesOf = (goals: OnboardingGoalDb[], m: DailyMinutes) => previewDay(goals, m).rows.map((r) => r.minutes);

/** Every non-empty subset of the five goals. */
function subsets(): OnboardingGoalDb[][] {
  const out: OnboardingGoalDb[][] = [];
  for (let mask = 1; mask < 1 << GOAL_ORDER.length; mask += 1) out.push(GOAL_ORDER.filter((_, i) => mask & (1 << i)));
  return out;
}

describe("the table of §8.3", () => {
  it("weights, titles and descriptions", () => {
    assert.deepEqual(GOAL_WEIGHTS, { STOP_BLUNDERING: 0.45, LEARN_OPENINGS: 0.25, IMPROVE_ENDGAMES: 0.25, STUDY_LEGENDS: 0.3, PLAY_FRIENDS: null });
    assert.deepEqual(
      GOAL_ORDER.map((g) => [GOAL_COPY[g].label, GOAL_COPY[g].title, GOAL_COPY[g].desc]),
      [
        ["Stop blundering", "Mistake Bank review", "Positions from your own games"],
        ["Learn openings", "Opening line", "One line you actually play"],
        ["Improve endgames", "Endgame drill", "King and pawn technique"],
        ["Study legends", "Legend position", "Play a famous moment"],
        ["Play friends", "Challenge a friend", "Send a link from any position"],
      ],
    );
  });

  it("covers exactly the contract's goals, in the board's chip order", () => {
    assert.deepEqual([...GOAL_ORDER], ONBOARDING_GOALS.map((g) => fromWire(g)));
  });
});

describe("previewDay", () => {
  it("the spec's example: Stop blundering + Study legends at 10 min → 6 + 4", () => {
    const p = previewDay(["STOP_BLUNDERING", "STUDY_LEGENDS"], 10);
    assert.deepEqual(
      p.rows.map((r) => [r.title, r.label]),
      [
        ["Mistake Bank review", "6 MIN"],
        ["Legend position", "4 MIN"],
      ],
    );
    assert.equal(p.totalLabel, "10 MIN A DAY");
  });

  it("matches the board at 5 and 20 minutes for the default pair", () => {
    assert.deepEqual(minutesOf(["STOP_BLUNDERING", "STUDY_LEGENDS"], 5), [3, 2]);
    assert.deepEqual(minutesOf(["STOP_BLUNDERING", "STUDY_LEGENDS"], 20), [12, 8]);
  });

  it("one goal takes the whole time", () => {
    for (const m of DAILY_MINUTES) assert.deepEqual(minutesOf(["LEARN_OPENINGS"], m), [m]);
  });

  it("Play friends is ANYTIME and takes no minutes (OD-6)", () => {
    const p = previewDay(["STOP_BLUNDERING", "PLAY_FRIENDS"], 10);
    assert.deepEqual(
      p.rows.map((r) => [r.goal, r.minutes, r.label]),
      [
        ["STOP_BLUNDERING", 10, "10 MIN"],
        ["PLAY_FRIENDS", null, "ANYTIME"],
      ],
    );
    const only = previewDay(["PLAY_FRIENDS"], 5);
    assert.deepEqual(only.rows.map((r) => r.label), ["ANYTIME"]);
    assert.equal(only.totalLabel, "5 MIN A DAY");
  });

  it("a half-minute tie is settled on the heavier row, then on the chip order", () => {
    // 5 × 0.25 / 0.5 = 2.5 → 3 + 3 = 6 > 5: the first of the equal weights gives a minute back.
    assert.deepEqual(minutesOf(["LEARN_OPENINGS", "IMPROVE_ENDGAMES"], 5), [2, 3]);
  });

  it("every selection sums to the daily time, each timed row ≥ 1 minute", () => {
    for (const goals of subsets()) {
      for (const m of DAILY_MINUTES) {
        const p = previewDay(goals, m);
        const timed = p.rows.filter((r) => r.minutes !== null);
        if (timed.length === 0) continue;
        const sum = timed.reduce((a, r) => a + r.minutes!, 0);
        assert.equal(sum, m, `${goals.join("+")} @ ${m}`);
        assert.ok(timed.every((r) => r.minutes! >= 1));
        assert.equal(p.totalMinutes, m);
      }
    }
  });

  it("rows keep the chip order whatever order the goals come in, without duplicates", () => {
    const p = previewDay(["STUDY_LEGENDS", "STOP_BLUNDERING", "STUDY_LEGENDS"], 10);
    assert.deepEqual(p.rows.map((r) => r.goal), ["STOP_BLUNDERING", "STUDY_LEGENDS"]);
  });

  it("no goal → no rows", () => {
    assert.deepEqual(previewDay([], 10).rows, []);
  });
});

describe("splitMinutes", () => {
  it("keeps the true sum when the one-minute floor exceeds the time (header shows it)", () => {
    assert.deepEqual(splitMinutes([0.45, 0.25, 0.25, 0.3], 3), [1, 1, 1, 1]);
  });

  it("adds missing minutes to the heaviest row", () => {
    // 10 × 0.45/1.25 = 3.6 → 4; 0.25 → 2, 2; 0.3 → 2.4 → 2: 10 exactly.
    assert.deepEqual(splitMinutes([0.45, 0.25, 0.25, 0.3], 10), [4, 2, 2, 2]);
    // 20: 7.2 → 7, 4, 4, 4.8 → 5 = 20.
    assert.deepEqual(splitMinutes([0.45, 0.25, 0.25, 0.3], 20), [7, 4, 4, 5]);
  });

  it("no timed rows → empty", () => {
    assert.deepEqual(splitMinutes([], 10), []);
  });
});

describe("initial state and state mapping", () => {
  it("defaults to the board's selection when nothing is saved", () => {
    assert.deepEqual(initialGoalsState({ goals: [], dailyMinutes: null }), { goals: [...DEFAULT_GOALS], dailyMinutes: DEFAULT_MINUTES });
    assert.deepEqual([...DEFAULT_GOALS], ["STOP_BLUNDERING", "STUDY_LEGENDS"]);
    assert.equal(DEFAULT_MINUTES, 10);
  });

  it("keeps saved values (ordered); an unknown minute value falls back to 10", () => {
    assert.deepEqual(initialGoalsState({ goals: ["PLAY_FRIENDS", "LEARN_OPENINGS"], dailyMinutes: 20 }), {
      goals: ["LEARN_OPENINGS", "PLAY_FRIENDS"],
      dailyMinutes: 20,
    });
    assert.equal(initialGoalsState({ goals: ["LEARN_OPENINGS"], dailyMinutes: 15 }).dailyMinutes, 10);
  });

  it("Skip saves Stop blundering at 10 minutes", () => {
    assert.deepEqual([...SKIP_GOALS], ["STOP_BLUNDERING"]);
    assert.equal(SKIP_MINUTES, 10);
  });

  it("none_selected only with no goal", () => {
    assert.equal(goalsState([]), "none_selected");
    assert.equal(goalsState(["PLAY_FRIENDS"]), "default");
  });

  it("orderedGoals drops unknown values", () => {
    assert.deepEqual(orderedGoals(["NOPE" as OnboardingGoalDb, "IMPROVE_ENDGAMES"]), ["IMPROVE_ENDGAMES"]);
  });
});
