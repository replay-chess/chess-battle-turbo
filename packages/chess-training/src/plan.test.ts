// plan.ts: the daily plan (phase-05 plan §8.10, §12.1): bank titles (one game today/yesterday/dated, several games),
// the empty bank (review/import), the focus-theme order, estimates = header minutes, the 2-step plan without lessons,
// step completion from the frozen keys only, and the stored shape (`DailyPlanV1`, validated with the real schema).
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
// The JSON registry's schema, read by path: this package never depends on @repo/db (it is pure), but its output must
// be exactly what the registry accepts before the write.
import { DailyPlanV1 } from "../../db/src/json/training";
import {
  buildDailyPlan,
  focusTheme,
  keepGoingLabel,
  planCta,
  planDoneBits,
  planDoneCount,
  planFootnote,
  planHeader,
  planMinutes,
  planStepStatuses,
  puzzlesHref,
  type PlanBankCard,
  type PlanInputs,
} from "./plan";

const NOW = new Date("2026-11-12T19:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000);
const card = (key: string, game: string, playedDaysAgo: number, opponent = "tal_fan_77"): PlanBankCard => ({ key, game, playedAt: ago(playedDaysAgo), opponent });

const base: PlanInputs = {
  now: NOW,
  timeZone: "UTC",
  dueShown: 3,
  bankQueue: [card("m_a", "g1", 1), card("m_b", "g1", 1), card("m_c", "g1", 1), card("m_d", "g2", 3)],
  bankTotal: 23,
  lastGame: { ref: "cm3k9x2p10007slzpqa8hd4fe", opponent: "tal_fan_77", reviewed: true, moments: 3 },
  themes: [
    { key: "fork", attempts: 14, ewma: 0.62, bankCount: 6 },
    { key: "pin", attempts: 9, ewma: 0.18, bankCount: 2 },
    { key: "hangingPiece", attempts: 3, ewma: 0.1, bankCount: 5 },
  ],
  puzzleRating: 1512.4,
};

describe("bank step", () => {
  it("names one game: yesterday's (the hub fixture)", () => {
    const plan = buildDailyPlan(base);
    assert.deepEqual(plan.steps[0], {
      kind: "bank",
      cardKeys: ["m_a", "m_b", "m_c"],
      title: "Review 3 mistakes from yesterday's game",
      subtitle: "Mistake Bank · vs tal_fan_77 · ~2 min",
      estMin: 2,
      href: "/train/bank/session?plan=1",
    });
  });

  it("names today's game and a dated game", () => {
    assert.equal(buildDailyPlan({ ...base, bankQueue: [card("m_a", "g1", 0.1)], dueShown: 1 }).steps[0]!.title, "Review 1 mistake from today's game");
    assert.equal(buildDailyPlan({ ...base, bankQueue: [card("m_a", "g1", 16), card("m_b", "g1", 16)], dueShown: 5 }).steps[0]!.title, "Review 2 mistakes from your Oct 27 game");
  });

  it("counts games when the cards come from several", () => {
    const step = buildDailyPlan({ ...base, dueShown: 10 }).steps[0]!;
    assert.equal(step.title, "Review 4 due mistakes");
    assert.equal(step.subtitle, "Mistake Bank · 2 games · ~3 min");
    assert.deepEqual(step.cardKeys, ["m_a", "m_b", "m_c", "m_d"]);
  });

  it("freezes at most dueShown and at most 10 cards", () => {
    const queue = Array.from({ length: 30 }, (_, i) => card(`m_${i}`, `g${i}`, 2));
    const step = buildDailyPlan({ ...base, bankQueue: queue, dueShown: 25 }).steps[0]!;
    assert.equal(step.cardKeys!.length, 10);
    assert.equal(step.title, "Review 10 due mistakes");
    assert.equal(step.subtitle, "Mistake Bank · 10 games · ~8 min");
  });

  it("leaves the bank step out when the bank has cards but none due", () => {
    const plan = buildDailyPlan({ ...base, dueShown: 0, bankQueue: [] });
    assert.deepEqual(plan.steps.map((s) => s.kind), ["puzzles"]);
    assert.equal(plan.basis, "bank");
  });

  it("with an empty bank: review the last game when it is unreviewed, else import games", () => {
    const review = buildDailyPlan({ ...base, bankTotal: 0, dueShown: 0, bankQueue: [], lastGame: { ...base.lastGame!, reviewed: false } });
    assert.deepEqual(review.steps[0], {
      kind: "review",
      title: "Review your last game",
      subtitle: "vs tal_fan_77 · the coach found 3 moments · ~1 min",
      estMin: 1,
      href: "/review/cm3k9x2p10007slzpqa8hd4fe",
    });
    assert.equal(review.basis, "new");
    const imp = buildDailyPlan({ ...base, bankTotal: 0, dueShown: 0, bankQueue: [], lastGame: null });
    assert.deepEqual(imp.steps[0], { kind: "import", title: "Import games", subtitle: "Connect Chess.com or Lichess · ~1 min", estMin: 1, href: "/settings/connected" });
  });
});

describe("puzzle step and the focus theme", () => {
  it("prefers P6's weakness, then the lowest EWMA with ≥ 5 attempts, then the most bank cards, then fork", () => {
    assert.deepEqual(focusTheme(base.themes, "skewer"), { key: "skewer", source: "weakness" });
    assert.deepEqual(focusTheme(base.themes), { key: "pin", source: "lowestMastery" });
    assert.deepEqual(focusTheme([{ key: "fork", attempts: 2, ewma: 0, bankCount: 1 }, { key: "hangingPiece", attempts: 0, ewma: 0, bankCount: 4 }]), {
      key: "hangingPiece",
      source: "bankCount",
    });
    assert.deepEqual(focusTheme([]), { key: "fork", source: "default" });
  });

  it("never focuses a theme the shards do not serve (rc:*, meta, phase)", () => {
    const themes = [
      { key: "rc:recapture", attempts: 20, ewma: 0.05, bankCount: 9 },
      { key: "middlegame", attempts: 20, ewma: 0.01, bankCount: 9 },
      { key: "short", attempts: 20, ewma: 0.02, bankCount: 0 },
    ];
    assert.deepEqual(focusTheme(themes), { key: "fork", source: "default" });
    assert.deepEqual(focusTheme(themes, "rc:missedThreat"), { key: "fork", source: "default" });
  });

  it("titles the step on the focus theme at the member's rating", () => {
    const plan = buildDailyPlan(base);
    assert.equal(plan.focusTheme, "pin");
    assert.deepEqual(plan.steps[1], {
      kind: "puzzles",
      theme: "pin",
      count: 3,
      title: "3 pin puzzles at your level",
      subtitle: "Your lowest-mastery theme · rating 1512 · ~4 min",
      estMin: 4,
      href: "/train/puzzles?theme=pin&n=3&source=plan",
    });
    const fresh = buildDailyPlan({ ...base, themes: [], puzzleRating: 1484 });
    assert.equal(fresh.steps[1]!.title, "3 fork puzzles at your level");
    assert.equal(fresh.steps[1]!.subtitle, "Start here · rating 1484 · ~4 min");
    assert.equal(buildDailyPlan({ ...base, themes: [{ key: "discoveredAttack", attempts: 9, ewma: 0.1, bankCount: 0 }] }).steps[1]!.title, "3 discovered attack puzzles at your level");
  });

  it("builds hrefs with the theme, the count and the source", () => {
    assert.equal(puzzlesHref("fork", { source: "hub" }), "/train/puzzles?theme=fork&source=hub");
    assert.equal(puzzlesHref("rc:recapture", { n: 3, source: "plan" }), "/train/puzzles?theme=rc%3Arecapture&n=3&source=plan");
  });
});

describe("the frozen plan", () => {
  it("has two steps in P5 (no lesson) and minutes that sum to the header", () => {
    const plan = buildDailyPlan(base);
    assert.equal(plan.steps.length, 2);
    assert.equal(planMinutes(plan), plan.steps[0]!.estMin + plan.steps[1]!.estMin);
    assert.equal(planMinutes(plan), 6);
    assert.equal(planHeader("Thursday", planMinutes(plan)), "Thursday · 6 minutes planned");
    assert.equal(planHeader("Friday", 1), "Friday · 1 minute planned");
    assert.equal(planDoneCount(0, 2), 0);
  });

  it("validates against the JSON registry's DailyPlanV1 in every shape", () => {
    const shapes = [
      buildDailyPlan(base),
      buildDailyPlan({ ...base, dueShown: 10 }),
      buildDailyPlan({ ...base, bankTotal: 0, dueShown: 0, bankQueue: [], lastGame: { ...base.lastGame!, reviewed: false } }),
      buildDailyPlan({ ...base, bankTotal: 0, dueShown: 0, bankQueue: [], lastGame: null }),
      buildDailyPlan({ ...base, dueShown: 0, bankQueue: [] }),
      buildDailyPlan({ ...base, bankQueue: Array.from({ length: 30 }, (_, i) => card(`m_${i}`, `g${i}`, 2, "a_really_long_opponent_name_for_stress_x")), dueShown: 10 }),
    ];
    for (const plan of shapes) {
      const parsed = DailyPlanV1.safeParse(plan);
      assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
      assert.deepEqual(parsed.data, plan);
    }
  });

  it("tags the first open step Due and later ones Next; done steps Done", () => {
    assert.deepEqual(planStepStatuses(2, 0), ["due", "next"]);
    assert.deepEqual(planStepStatuses(2, 0b01), ["done", "due"]);
    assert.deepEqual(planStepStatuses(2, 0b10), ["due", "done"]);
    assert.deepEqual(planStepStatuses(3, 0b111), ["done", "done", "done"]);
  });

  it("completes the bank step when every frozen key was graded today, whatever is due later", () => {
    const plan = buildDailyPlan(base);
    const graded = new Set(["m_a", "m_b"]);
    const none = new Map<string, number>();
    assert.equal(planDoneBits(plan, { gradedKeys: graded, puzzlesByTheme: none }), 0);
    graded.add("m_c");
    assert.equal(planDoneBits(plan, { gradedKeys: graded, puzzlesByTheme: none }), 0b01);
    // A card that became due later (m_d) is not part of the frozen step.
    assert.equal(planDoneBits(plan, { gradedKeys: new Set(["m_a", "m_b", "m_c"]), puzzlesByTheme: none }), 0b01);
  });

  it("completes the puzzle step at 3 graded puzzles on the focus theme today", () => {
    const plan = buildDailyPlan(base);
    const g = new Set<string>();
    assert.equal(planDoneBits(plan, { gradedKeys: g, puzzlesByTheme: new Map([["pin", 2], ["fork", 5]]) }), 0);
    assert.equal(planDoneBits(plan, { gradedKeys: g, puzzlesByTheme: new Map([["pin", 3]]) }), 0b10);
  });

  it("completes the review and import steps from their flags", () => {
    const review = buildDailyPlan({ ...base, bankTotal: 0, dueShown: 0, bankQueue: [], lastGame: { ...base.lastGame!, reviewed: false } });
    assert.equal(planDoneBits(review, { gradedKeys: new Set(), puzzlesByTheme: new Map(), reviewDone: true }), 0b01);
    const imp = buildDailyPlan({ ...base, bankTotal: 0, dueShown: 0, bankQueue: [], lastGame: null });
    assert.equal(planDoneBits(imp, { gradedKeys: new Set(), puzzlesByTheme: new Map(), importDone: true }), 0b01);
  });

  it("words the CTA and the footnote", () => {
    const plan = buildDailyPlan(base);
    assert.deepEqual(planCta(plan, 0), { kind: "start", label: "Start Today's Plan · ~6 min" });
    assert.deepEqual(planCta(plan, 0b01), { kind: "continue", label: "Continue Today's Plan · ~4 min" });
    assert.deepEqual(planCta(plan, 0b11), { kind: "keep_going", label: "Keep Going: Pin Puzzles" });
    assert.equal(keepGoingLabel("fork"), "Keep Going: Fork Puzzles");
    assert.equal(keepGoingLabel("hangingPiece"), "Keep Going: Loose Piece Puzzles");
    assert.equal(planFootnote("bank", 10), "Built from your Mistake Bank. Daily cap: 10 reviews.");
    assert.equal(planFootnote("games20", 10), "Built from your last 20 games. Daily cap: 10 reviews.");
  });

  it("depends only on its inputs (the same inputs build the same plan)", () => {
    assert.deepEqual(buildDailyPlan(base), buildDailyPlan({ ...base }));
    assert.equal(buildDailyPlan(base).createdAt, NOW.toISOString());
  });
});
