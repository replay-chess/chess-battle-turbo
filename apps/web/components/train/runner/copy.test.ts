// The runner's and the summary's copy rules (phase-05 plan §4.4, §4.5, §4.7; design strings of V3BankSession,
// V3PuzzleCorrect, V3SessionSummary): the label line, the rule line, the done line, the stat tiles, the grade bars and
// the summary's saving state.
import assert from "node:assert/strict";
import { test } from "node:test";
import { NEW_CARD_PREVIEW, sessionSummaryFixture } from "@repo/contracts/http/fixtures/p05";
import { barWidth, savingState, statTiles, SAVING_POLLS } from "../summary/model";
import { doneLine } from "./DoneBlock";
import { ruleText } from "./RuleLine";
import { sessionPayloadFixture } from "@repo/contracts/http/fixtures/p05";
import { phoneRatingLine, ratingLine, seeInGameHref } from "./TrainerLabelBar";
import { sessionErrorCopy } from "./SessionError";
import { sessionErrorKindOf } from "./session-error-kind";
import { scrollToReveal } from "./GradeBar";

test("label line: bank shows the streak, puzzles the rating with its delta (V3PuzzleCorrect / Solution)", () => {
  assert.equal(ratingLine("bank", 4, null, null), "Streak 4");
  const r = { value: 1524.4, rd: 80, vol: 0.06, provisional: false };
  assert.equal(ratingLine("puzzles", 5, r, 12), "Rating 1524 +12 · Streak 5");
  assert.equal(ratingLine("puzzles", 0, { ...r, value: 1504 }, -8), "Rating 1504 −8 · Streak 0");
  assert.equal(ratingLine("puzzles", 4, { ...r, value: 1512 }, null), "Rating 1512 · Streak 4");
});

test("rule line from the item's own previews", () => {
  assert.equal(ruleText(NEW_CARD_PREVIEW), `Solved first try: back in ${NEW_CARD_PREVIEW.good.label}. Missed: back in under 10 minutes.`);
});

test("done line", () => {
  assert.equal(doneLine(3, 3, false), "Session done · 3 of 3 graded. Next reviews are scheduled.");
  assert.equal(doneLine(12, 20, true), "Session done · 12 graded. Next reviews are scheduled.");
});

test("summary tiles, grade bars (1 → 30 %, 2 → 60 %, 3 → 90 %), saving", () => {
  const def = sessionSummaryFixture("default");
  assert.deepEqual(statTiles(def).map((t) => t.label).slice(0, 3), ["Solved", "First try", "With a hint"]);
  assert.equal(statTiles(sessionSummaryFixture("perfect"))[2]!.label, "Hints");
  const rows = def.grades;
  assert.equal(barWidth(1, [{ grade: "good", n: 2, intervalLabel: "4 days" }]), 30);
  assert.equal(barWidth(2, [{ grade: "good", n: 2, intervalLabel: "4 days" }]), 60);
  assert.equal(barWidth(3, [{ grade: "good", n: 3, intervalLabel: "4 days" }]), 90);
  assert.ok(rows.every((r) => barWidth(r.n, rows) <= 90));
  assert.equal(savingState(def, null, 0), "none");
  assert.equal(savingState(def, def.graded, 0), "none");
  assert.equal(savingState(def, def.graded + 1, 0), "saving");
  assert.equal(savingState(def, def.graded + 1, SAVING_POLLS), "partial");
});

test("FIX-1: the puzzle kill switch says \"Puzzles are taking a break.\", a shard outage says unavailable (plan §7.9)", () => {
  const off = sessionErrorKindOf({ code: "upstream_unavailable", details: { provider: "puzzles", kind: "disabled" } });
  assert.deepEqual(off, { kind: "puzzles_disabled", retryAfterSec: null });
  assert.match(sessionErrorCopy("puzzles_disabled", null, 400).body, /^Puzzles are taking a break\./);
  const down = sessionErrorKindOf({ code: "upstream_unavailable", details: { provider: "puzzles" } });
  assert.equal(down?.kind, "upstream_unavailable");
  assert.equal(sessionErrorCopy("upstream_unavailable", null, 400).body, "Puzzles are unavailable right now. Your Mistake Bank still works.");
  assert.equal(sessionErrorKindOf({ code: "rate_limited", retryAfterSec: 30, details: { reason: "daily_puzzle_limit" } })?.kind, "daily_puzzle_limit");
  assert.equal(sessionErrorKindOf({ code: "not_found" }), null);
});

test("FIX-1: the grade bar is scrolled into view inside the panel body, never above the body's top", () => {
  assert.equal(scrollToReveal({ top: 100, bottom: 200 }, { top: 0, bottom: 400 }), 0, "in view: no scroll");
  assert.equal(scrollToReveal({ top: 940, bottom: 1045 }, { top: 735, bottom: 955 }), 98, "iPad portrait 125 %: 1045 + 8 − 955");
  assert.equal(scrollToReveal({ top: 500, bottom: 900 }, { top: 300, bottom: 600 }), 200, "taller than the area: its top stays in view");
});

test("FIX-2: the phone rating line says the reset once, so it fits 393 px; See It in Your Game links the item's game", () => {
  assert.deepEqual(phoneRatingLine("Rating 1512 · Streak 0", true), { lead: "Rating 1512", reset: true });
  assert.deepEqual(phoneRatingLine("Rating 1483 −29 · Streak 0", true), { lead: "Rating 1483 −29", reset: true });
  assert.deepEqual(phoneRatingLine("Streak 0", true), { lead: "", reset: true });
  assert.deepEqual(phoneRatingLine("Rating 1512 · Streak 4", false), { lead: "Rating 1512 · Streak 4", reset: false });
  const bank = sessionPayloadFixture("bank").items[0]!;
  assert.equal(seeInGameHref(bank, false), `/review/${bank.context!.gameRef}?ply=${bank.context!.gamePly}&from=bank`);
  assert.equal(seeInGameHref(bank, true), "#see-in-game");
  assert.equal(seeInGameHref(sessionPayloadFixture("puzzles").items[0]!, false), null, "a puzzle has no game");
});

