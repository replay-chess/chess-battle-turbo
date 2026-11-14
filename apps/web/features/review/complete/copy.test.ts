// complete/copy.ts: the state of each fixture, the lead, the stat tiles and the moment lines (phase-03 plan §4.2).
import assert from "node:assert/strict";
import { test } from "node:test";
import { reviewCompleteFixture } from "@repo/contracts/http/fixtures/review";
import {
  bankLeadTail,
  bestMonthLine,
  completeLead,
  completePrimary,
  drillLabel,
  momentBankTag,
  completeStateOf,
  completeTitle,
  firstOpenMomentNumber,
  momentPlayedLine,
  momentResultLine,
  statTiles,
} from "./copy";

test("each fixture maps to its board state", () => {
  for (const s of ["default", "nothing", "partial", "noMoments"] as const) assert.equal(completeStateOf(reviewCompleteFixture(s)), s);
  const unfinished = { ...reviewCompleteFixture("default"), reviewed: 2, partial: false };
  assert.equal(completeStateOf(unfinished), "partial", "fewer results than moments is partial even after Finish");
});

test("titles and leads (every number computed)", () => {
  const d = reviewCompleteFixture("default");
  assert.equal(completeTitle("default"), "Review complete");
  assert.equal(completeLead(d, "default"), "3 moments reviewed.");
  assert.equal(completeLead(reviewCompleteFixture("partial"), "partial"), "2 of 3 moments reviewed.");
  assert.equal(completeTitle("nothing"), "Clean game");
  assert.equal(completeLead(reviewCompleteFixture("nothing"), "nothing"), "Your best decision was 16.Qb8+, a sacrifice that forced mate.");
  assert.equal(completeTitle("noMoments"), "No turning points in this game.");
  assert.equal(completeLead({ ...d, moments: d.moments.slice(0, 1), reviewed: 1 }, "default"), "1 moment reviewed.");
});

test("stat tiles: Accuracy · Moments · Found; clean: Accuracy · Brilliant · Best this month only when true", () => {
  const tiles = (s: Parameters<typeof reviewCompleteFixture>[0]) =>
    statTiles(reviewCompleteFixture(s), completeStateOf(reviewCompleteFixture(s))).map((t) => `${t.label}=${t.value}`);
  assert.deepEqual(tiles("default"), ["Accuracy=85", "Moments=3", "Found=2"]);
  assert.deepEqual(tiles("nothing"), ["Accuracy=97", "Brilliant=1", "Best this month=✓"]);
  const notBest = { ...reviewCompleteFixture("nothing"), bestThisMonth: false };
  assert.deepEqual(statTiles(notBest, "nothing").map((t) => t.label), ["Accuracy", "Brilliant"]);
  // regression: no-moments-best-move (FIX-2, review round 2): plan 4.2 noMoments = "Accuracy, Best move"; the tile
  // only showed for a standout, which a game with no moments never had.
  assert.deepEqual(tiles("noMoments"), ["Accuracy=88", "Best move=14.O-O"]);
  assert.deepEqual(statTiles({ ...reviewCompleteFixture("noMoments"), standouts: [] }, "noMoments").map((t) => t.label), ["Accuracy"]);
  assert.equal(statTiles({ ...reviewCompleteFixture("default"), accuracy: null }, "default")[0]!.value, "—");
});

test("moment lines and the resume target", () => {
  const [m1, m2, m3] = reviewCompleteFixture("default").moments;
  assert.equal(momentPlayedLine(m1!), "You played 17.b3 · best was Qc1");
  assert.equal(momentResultLine(m1!), "Inaccuracy · you found it on retry");
  assert.equal(momentResultLine(m2!), "Miss · you found it");
  assert.equal(momentResultLine(m3!), "Blunder · you saw the answer");
  assert.equal(momentResultLine({ ...m3!, result: null }), "Blunder · not reviewed yet");
  assert.equal(firstOpenMomentNumber(reviewCompleteFixture("partial").moments), 3);
  assert.equal(firstOpenMomentNumber(reviewCompleteFixture("default").moments), null);
  assert.equal(bestMonthLine(97), "Accuracy 97 is your best this month.");
  assert.equal(bestMonthLine(null), null);
});

// ── P5 (phase-05 plan §4.8 "Review complete", V3RvComplete; T2) ─────────────────────────────────────────────────────
const LINKS = { playAgain: "/play", home: "/home" };
const withBank = (s: Parameters<typeof reviewCompleteFixture>[0], added: number, extra = {}) => {
  const v = reviewCompleteFixture(s);
  return {
    ...v,
    added,
    nextDueAt: added > 0 ? "2026-11-13T08:00:00.000Z" : null,
    nextDueLabel: added > 0 ? "tomorrow" : null,
    drillHref: added > 0 ? `/train/bank/session?game=${v.ref}` : null,
    moments: v.moments.map((m, i) => ({ ...m, inBank: i < added })),
    ...extra,
  };
};

test("P5 lead: the Mistake Bank line (T2), the opted-out case and the clean game", () => {
  assert.equal(completeLead(withBank("default", 3), "default"), "3 moments reviewed · 3 added to your Mistake Bank. The first one comes back tomorrow.");
  assert.equal(completeLead(withBank("partial", 2), "partial"), "2 of 3 moments reviewed · 2 added to your Mistake Bank. The first one comes back tomorrow.");
  assert.equal(completeLead(withBank("default", 0), "default"), "3 moments reviewed · nothing added to your Mistake Bank.");
  assert.equal(
    completeLead(withBank("nothing", 0), "nothing"),
    "Nothing went into your Mistake Bank. Your best decision was 16.Qb8+, a sacrifice that forced mate.",
  );
  assert.equal(bankLeadTail({ added: 1, nextDueLabel: null }), " · 1 added to your Mistake Bank.");
  // `train` off: exactly P3.
  assert.equal(completeLead(reviewCompleteFixture("default"), "default"), "3 moments reviewed.");
});

test("P5 tiles: Accuracy · To drill · Moments; clean: Accuracy · To drill 0 · Brilliant", () => {
  assert.deepEqual(
    statTiles(withBank("default", 3), "default").map((t) => `${t.label}=${t.value}`),
    ["Accuracy=85", "To drill=3", "Moments=3"],
  );
  assert.deepEqual(
    statTiles(withBank("nothing", 0), "nothing").map((t) => `${t.label}=${t.value}`),
    ["Accuracy=97", "To drill=0", "Brilliant=1"],
  );
  assert.deepEqual(statTiles(withBank("noMoments", 0), "noMoments").map((t) => t.label), ["Accuracy", "Best move"]);
});

test("P5 primary: Drill These n Mistakes (never Play Again) while cards exist; Back to Home when all opted out", () => {
  const v = withBank("default", 3);
  assert.deepEqual(completePrimary(v, "default", LINKS), { kind: "drill", label: "Drill These 3 Mistakes · ~2 min", href: `/train/bank/session?game=${v.ref}` });
  assert.equal(completePrimary(withBank("default", 1), "default", LINKS).label, "Drill This Mistake · ~1 min");
  assert.deepEqual(completePrimary(withBank("default", 0), "default", LINKS), { kind: "home", label: "Back to Home", href: "/home" });
  assert.equal(completePrimary(withBank("nothing", 0), "nothing", LINKS).kind, "play");
  assert.equal(completePrimary(reviewCompleteFixture("default"), "default", LINKS).kind, "play", "train off: P3's Play Again");
  assert.equal(drillLabel(2), "Drill These 2 Mistakes · ~2 min");
  assert.equal(drillLabel(4), "Drill These 4 Mistakes · ~3 min");
});

test("P5 moment tags: Added / Not added, none without the field", () => {
  assert.deepEqual(momentBankTag({ inBank: true }), { label: "Added", added: true });
  assert.deepEqual(momentBankTag({ inBank: false }), { label: "Not added", added: false });
  assert.equal(momentBankTag({}), null);
});
