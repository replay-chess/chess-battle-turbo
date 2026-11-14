// Phase-05 plan §4.2: every string the Train hub prints comes from `TrainToday`; the day word and the training day
// follow the server's label and day rules (§8.4, §8.14); W2's idempotency key is reused for 10 s of repeated clicks.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TrainToday as TrainTodaySchema } from "@repo/contracts/http/train";
import { P5_FIXTURE_NOW, TODAY_STATES, trainTodayFixture } from "@repo/contracts/http/fixtures/p05";
import {
  bankRowSub,
  ctaOf,
  dueStripModel,
  eyebrowOf,
  isSessionCreatingHref,
  nextBatchShort,
  nothingDueLine,
  phoneStreakChip,
  planModel,
  puzzlesRowSub,
  releaseDelayMs,
  stepAccessibleName,
  stepTag,
  stepTarget,
  streakLines,
  viewedState,
} from "./model";
import { IDEMPOTENCY_REUSE_MS, keyFor, runnerHref } from "./session";
import { dayWord, localDayKey, safeTimeZone } from "./when";

const NOW = Date.parse(P5_FIXTURE_NOW); // Thu 2026-11-12 19:00Z

describe("hub model", () => {
  it("default: the plan heading, progress, CTA and footnote", () => {
    const t = trainTodayFixture("default");
    assert.deepEqual(planModel(t, "tomorrow"), { heading: "Today’s plan", progress: "0 of 2 done", complete: false, line: null });
    assert.deepEqual(ctaOf(t), { kind: "start", label: "Start Today's Plan · ~6 min", variant: "primary" });
    assert.equal(eyebrowOf(t), "Thursday · 6 minutes planned");
    assert.equal(eyebrowOf({ weekdayLabel: "Monday", plannedMinutes: 1 }), "Monday · 1 minute planned");
  });

  it("nothing due: Done for today, the next batch line, Keep Going as a secondary link", () => {
    const t = trainTodayFixture("nothingdue");
    const plan = planModel(t, "tomorrow");
    assert.equal(plan.heading, "Done for today");
    assert.equal(plan.progress, "2 of 2 done");
    assert.equal(plan.complete, true);
    assert.equal(plan.line, "Nothing is due. Your next 6 reviews arrive tomorrow at 08:00.");
    assert.deepEqual(ctaOf(t), { kind: "link", label: "Keep Going: Fork Puzzles", href: "/train/puzzles?theme=fork&source=hub", variant: "secondary" });
    assert.equal(nextBatchShort(t, "tomorrow"), "Next 6 reviews arrive tomorrow at 08:00.");
  });

  it("cap reached: the server's waiting line wins; Continue stays primary", () => {
    const t = trainTodayFixture("cap_reached");
    assert.equal(planModel(t, "tomorrow").line, "You reviewed today's 10 positions. 6 more wait for tomorrow.");
    assert.equal(planModel(t, "tomorrow").heading, "Today’s plan", "a step is still open");
    assert.deepEqual(ctaOf(t), { kind: "start", label: "Continue Today's Plan · ~4 min", variant: "primary" });
  });

  it("partial and new-user plans", () => {
    const partial = trainTodayFixture("partial");
    assert.equal(planModel(partial, null).progress, "1 of 2 done");
    assert.equal(ctaOf(partial).kind, "start");
    const fresh = trainTodayFixture("new_user");
    assert.equal(viewedState(fresh), "new_user");
    assert.equal(dueStripModel(fresh), "empty_bank");
    assert.equal(bankRowSub(fresh), "Mistakes from your games land here");
    assert.equal(puzzlesRowSub(fresh), "Pick a theme and start");
    assert.deepEqual(streakLines(fresh), { title: "No streak yet", sub: "Train today to start one" });
  });

  it("step tags and the spoken step name", () => {
    const [s1, s2] = trainTodayFixture("default").plan.steps;
    assert.deepEqual(stepTag(s1!, 0), { text: "Due now", tone: "warn" });
    assert.deepEqual(stepTag(s2!, 1), { text: "Step 2", tone: "neutral" });
    assert.deepEqual(stepTag({ status: "done" }, 0), { text: "Done", tone: "good" });
    assert.equal(
      stepAccessibleName(s1!, 0, 2),
      "Step 1 of 2, due now: Review 3 mistakes from yesterday's game, Mistake Bank, vs tal_fan_77, about 2 minutes",
    );
    assert.equal(stepTarget(0), "step_1");
    assert.equal(stepTarget(2), null);
  });

  it("All training, the streak, the due strip", () => {
    const t = trainTodayFixture("default");
    assert.equal(bankRowSub(t), "4 due · 23 positions from your games");
    assert.equal(puzzlesRowSub(t), "Forks 62% · Pins 18% · Back rank 40%");
    assert.equal(puzzlesRowSub(trainTodayFixture("stress")), "Discovered attack 100% · Remove the defender 0% · Defend the threat New");
    assert.deepEqual(streakLines(t), { title: "4-day streak", sub: "Best 9 · resets if you skip 2 days" });
    assert.deepEqual(phoneStreakChip(t), { title: "4-day streak", minutes: "6 min today" });
    assert.equal(dueStripModel(t), "thumbs");
    assert.equal(dueStripModel(trainTodayFixture("nothingdue")), "nothing_due");
    assert.equal(nothingDueLine({ nextBatch: null }, null), "Nothing is due.");
    assert.equal(nothingDueLine({ nextBatch: { at: P5_FIXTURE_NOW, atLabel: "08:00", count: 1 } }, "Saturday"), "Nothing is due. Your next 1 review arrives Saturday at 08:00.");
  });

  it("step links that create sessions are recognised (never prefetched)", () => {
    for (const s of trainTodayFixture("default").plan.steps) assert.equal(isSessionCreatingHref(s.href), true, s.href);
    assert.equal(isSessionCreatingHref("/review/cm3k9x2p10007slzpqa8hd4fe"), false);
    assert.equal(isSessionCreatingHref("/train/bank"), false);
  });

  it("the release timer fires at nextBatch.at within 24 h, never for a past or far instant", () => {
    assert.equal(releaseDelayMs("2026-11-13T08:00:00.000Z", NOW), 13 * 3_600_000);
    assert.equal(releaseDelayMs("2026-11-12T08:00:00.000Z", NOW), null);
    assert.equal(releaseDelayMs("2026-11-15T08:00:00.000Z", NOW), null);
    assert.equal(releaseDelayMs(null, NOW), null);
  });

  it("every fixture state parses with the contract", () => {
    for (const s of TODAY_STATES) assert.equal(TrainTodaySchema.safeParse(trainTodayFixture(s)).success, true, s);
  });
});

describe("day words and the training day", () => {
  it("today / tomorrow / weekday / date, in the member's zone", () => {
    assert.equal(dayWord("2026-11-13T08:00:00.000Z", NOW, "UTC"), "tomorrow");
    assert.equal(dayWord("2026-11-12T21:00:00.000Z", NOW, "UTC"), "today");
    assert.equal(dayWord("2026-11-14T08:00:00.000Z", NOW, "UTC"), "Saturday");
    assert.equal(dayWord("2026-11-25T08:00:00.000Z", NOW, "UTC"), "Nov 25");
    // 19:00Z is already Friday 00:30 in Kolkata: Friday 08:00 local is "today" there.
    assert.equal(dayWord("2026-11-13T02:30:00.000Z", NOW, "Asia/Kolkata"), "today");
    assert.equal(dayWord("not a date", NOW, "UTC"), null);
  });

  it("the training day starts at dayStartHour (03:00 with a 04:00 start is still yesterday)", () => {
    assert.equal(localDayKey(Date.parse("2026-11-13T03:00:00.000Z"), "UTC", 4), "2026-11-12");
    assert.equal(localDayKey(Date.parse("2026-11-13T04:00:00.000Z"), "UTC", 4), "2026-11-13");
    assert.equal(localDayKey(NOW, "Asia/Kolkata", 4), "2026-11-12", "00:30 local, before the 04:00 start");
    assert.equal(localDayKey(NOW, "America/Los_Angeles", 0), "2026-11-12");
  });

  it("a zone the runtime rejects falls back to UTC (also for the day word and the day)", () => {
    assert.equal(safeTimeZone("Not/AZone"), "UTC");
    assert.equal(safeTimeZone(null), "UTC");
    assert.equal(safeTimeZone("Europe/Berlin"), "Europe/Berlin");
    assert.equal(dayWord("2026-11-13T08:00:00.000Z", NOW, "Not/AZone"), "tomorrow");
    assert.equal(localDayKey(NOW, "Not/AZone", 4), "2026-11-12");
    // Berlin leaves summer time on 2026-10-25: two days later is still "Tuesday", not a date.
    assert.equal(dayWord("2026-10-27T07:00:00Z", Date.parse("2026-10-25T10:00:00Z"), "Europe/Berlin"), "Tuesday");
  });
});

describe("W2 helpers", () => {
  it("the key is reused for the same body within 10 s, renewed after or for another body", () => {
    let n = 0;
    const make = () => `k${++n}`;
    const a = keyFor(null, "{daily}", 1_000, make);
    assert.equal(keyFor(a, "{daily}", 1_000 + IDEMPOTENCY_REUSE_MS - 1, make).key, "k1");
    assert.equal(keyFor(a, "{daily}", 1_000 + IDEMPOTENCY_REUSE_MS, make).key, "k2");
    assert.equal(keyFor(a, "{bank}", 1_500, make).key, "k3");
  });

  it("puzzle sessions run on /train/puzzles, the rest on the bank runner", () => {
    assert.equal(runnerHref({ ref: "cmref", kind: "daily" }), "/train/bank/session?s=cmref");
    assert.equal(runnerHref({ ref: "cmref", kind: "bank" }), "/train/bank/session?s=cmref");
    assert.equal(runnerHref({ ref: "cmref", kind: "puzzles" }), "/train/puzzles?s=cmref");
  });
});
