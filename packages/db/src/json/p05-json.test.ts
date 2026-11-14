// The P5 JSON column shapes (phase-05 plan 6.3): DailyPlanV1, SessionItemsV1 and MistakeTextV1 validate on write,
// read leniently (an unreadable row is null, never a crash), and the job payload is the contracts' one.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JOB_PAYLOADS } from "@repo/contracts/internal/jobs";
import {
  buildDailyPlan,
  buildSessionItems,
  DailyPlanV1,
  ExtractMistakesPayloadV1,
  MistakeTextV1,
  parseDailyPlan,
  parseMistakeText,
  parseSessionItems,
} from "./index";

const plan = {
  v: 1,
  createdAt: "2026-11-12T07:00:00.000Z",
  basis: "bank",
  focusTheme: "fork",
  steps: [
    {
      kind: "bank",
      cardKeys: ["m_card00000002", "m_card00000003"],
      title: "Review 2 mistakes from yesterday's game",
      subtitle: "Mistake Bank · vs tal_fan_77 · ~2 min",
      estMin: 2,
      href: "/train/bank/session?plan=1",
    },
    { kind: "puzzles", theme: "fork", count: 3, title: "3 fork puzzles at your level", subtitle: "Your lowest-mastery theme · rating 1512 · ~4 min", estMin: 4, href: "/train/puzzles?theme=fork&n=3&source=plan" },
  ],
};

describe("DailyPlanV1", () => {
  it("accepts the hub's two-step plan and refuses a fourth step, a bad key or an outside href", () => {
    assert.deepEqual(buildDailyPlan(plan), plan);
    assert.throws(() => buildDailyPlan({ ...plan, steps: [...plan.steps, plan.steps[1], plan.steps[1]] }));
    assert.throws(() => buildDailyPlan({ ...plan, steps: [{ ...plan.steps[0], cardKeys: ["x_bad"] }] }));
    assert.throws(() => buildDailyPlan({ ...plan, steps: [{ ...plan.steps[0], href: "https://evil.example" }] }));
    assert.throws(() => buildDailyPlan({ ...plan, v: 2 }));
    assert.equal(DailyPlanV1.safeParse({ ...plan, steps: [{ ...plan.steps[0], cardKeys: Array(11).fill("m_a") }] }).success, false);
  });

  it("reads leniently: null, a newer version or garbage → null (the hub rebuilds today's plan)", () => {
    assert.equal(parseDailyPlan(null), null);
    assert.equal(parseDailyPlan({ ...plan, v: 2 }), null);
    assert.equal(parseDailyPlan("x"), null);
    assert.deepEqual(parseDailyPlan(plan), plan);
  });
});

describe("SessionItemsV1", () => {
  const items = {
    v: 1,
    items: [
      { id: "i1", key: "m_card00000002", kind: "MISTAKE", pass: 1 },
      { id: "i2", key: "p_0009B", kind: "LICHESS_PUZZLE", pass: 1, p: ["0009B", "r2qkbnr/pp3ppp/8/1N6/8/8/PPPP1PPP/R1BQKB1R b KQkq - 0 1", "d8d5 b5c7 e8d8 c7d5", 1420, "fork"] },
      { id: "i1b", key: "m_card00000002", kind: "MISTAKE", pass: 2 },
      { id: "i3", key: "m_card00000003", kind: "REVIEW_POSITION", pass: 1, skipped: true },
    ],
  };
  it("accepts bank, puzzle snapshot, requeued and skipped items; refuses duplicates, > 40 items and a bad snapshot", () => {
    assert.deepEqual(buildSessionItems(items), items);
    assert.throws(() => buildSessionItems({ v: 1, items: [items.items[0], items.items[0]] }), /duplicate item id i1/);
    assert.throws(() => buildSessionItems({ v: 1, items: Array.from({ length: 41 }, (_, i) => ({ ...items.items[0], id: `i${i}` })) }));
    assert.throws(() => buildSessionItems({ v: 1, items: [{ ...items.items[1], p: ["0009B", "fen", "moves", 1420.5, "fork"] }] }));
    assert.throws(() => buildSessionItems({ v: 1, items: [{ ...items.items[0], pass: 3 }] }));
  });
  it("reads leniently", () => {
    assert.equal(parseSessionItems({ v: 2, items: [] }), null);
    assert.deepEqual(parseSessionItems(items), items);
  });
});

describe("MistakeTextV1 and the EXTRACT_MISTAKES payload", () => {
  it("P7's verified text, null until then", () => {
    const t = { v: 1, hint: "h", correct: "c", wrong: null, cost: "x", model: "m", verifiedAt: "2026-12-01T00:00:00.000Z" };
    assert.equal(MistakeTextV1.safeParse(t).success, true);
    assert.deepEqual(parseMistakeText(t), t);
    assert.equal(parseMistakeText(null), null);
    assert.equal(parseMistakeText({ ...t, v: 2 }), null);
  });
  it("is the contracts' payload schema", () => {
    assert.equal(ExtractMistakesPayloadV1, JOB_PAYLOADS.EXTRACT_MISTAKES);
  });
});
