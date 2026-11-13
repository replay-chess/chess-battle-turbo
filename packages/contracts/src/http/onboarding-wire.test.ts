// Phase-04 plan §12.1 `onboarding-wire.test.ts` (D4-25): lowercase wire enums round-trip to the uppercase Postgres
// enums over every value; the PATCH body rejects uppercase values; the time-zone check uses the runtime's IANA list.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fromWire,
  Goal,
  ONBOARDING_GOALS,
  ONBOARDING_STEPS,
  ONBOARDING_STEPS_DB,
  OnboardingStep,
  PatchOnboardingBody,
  RATING_BANDS,
  RatingBand,
  TimeZone,
  toWire,
} from "./onboarding";

/** The Postgres enums of M4 (schema.prisma), spelled as the migration creates them. */
const DB_STEPS = ["WELCOME", "LINK", "CONFIRM", "LEVEL", "GOALS", "PLAN", "ACTIVATING", "DONE"];
const DB_BANDS = ["NEW_TO_CHESS", "UNDER_800", "R800_1200", "R1200_1600", "R1600_2000", "R2000_PLUS"];
const DB_GOALS = ["STOP_BLUNDERING", "LEARN_OPENINGS", "IMPROVE_ENDGAMES", "STUDY_LEGENDS", "PLAY_FRIENDS"];

describe("onboarding wire enums (D4-25)", () => {
  it("toWire / fromWire round-trip every OnboardingStep, RatingBand and OnboardingGoal value", () => {
    for (const [db, wire] of [
      [DB_STEPS, ONBOARDING_STEPS],
      [DB_BANDS, RATING_BANDS],
      [DB_GOALS, ONBOARDING_GOALS],
    ] as const) {
      assert.deepEqual(db.map((v) => toWire(v)), [...wire]);
      assert.deepEqual(wire.map((v) => fromWire(v)), [...db]);
      for (const v of db) assert.equal(fromWire(toWire(v)), v);
    }
    assert.equal(toWire("R800_1200"), "r800_1200");
    assert.equal(fromWire("r800_1200"), "R800_1200");
    assert.deepEqual([...ONBOARDING_STEPS_DB], DB_STEPS, "the monotonic PATCH compares positions in this order");
  });

  it("the zod enums accept the wire spelling only", () => {
    for (const v of ONBOARDING_STEPS) assert.equal(OnboardingStep.safeParse(v).success, true, v);
    for (const v of DB_STEPS) assert.equal(OnboardingStep.safeParse(v).success, false, v);
    for (const v of DB_BANDS) assert.equal(RatingBand.safeParse(v).success, false, v);
    for (const v of DB_GOALS) assert.equal(Goal.safeParse(v).success, false, v);
  });

  it("PatchOnboardingBody rejects uppercase values and accepts the lowercase ones", () => {
    assert.equal(PatchOnboardingBody.safeParse({ step: "GOALS" }).success, false);
    assert.equal(PatchOnboardingBody.safeParse({ ratingBand: "R800_1200" }).success, false);
    assert.equal(PatchOnboardingBody.safeParse({ goals: ["STOP_BLUNDERING"] }).success, false);
    const ok = PatchOnboardingBody.safeParse({
      step: "plan",
      ratingBand: "r800_1200",
      ratingBandSource: "chesscom:rapid",
      initialRating: 1184,
      goals: ["stop_blundering", "learn_openings"],
      dailyMinutes: 10,
      timeZone: "Asia/Kolkata",
    });
    assert.equal(ok.success, true);
  });

  it("PatchOnboardingBody: done only via complete, step and complete exclusive, no duplicates, strict", () => {
    assert.equal(PatchOnboardingBody.safeParse({ step: "done" }).success, false);
    assert.equal(PatchOnboardingBody.safeParse({ complete: true }).success, true);
    assert.equal(PatchOnboardingBody.safeParse({ complete: true, step: "plan" }).success, false);
    assert.equal(PatchOnboardingBody.safeParse({ complete: false }).success, false);
    assert.equal(PatchOnboardingBody.safeParse({ goals: ["stop_blundering", "stop_blundering"] }).success, false);
    assert.equal(PatchOnboardingBody.safeParse({ dailyMinutes: 15 }).success, false);
    assert.equal(PatchOnboardingBody.safeParse({ initialRating: 99 }).success, false);
    assert.equal(PatchOnboardingBody.safeParse({ ratingBandSource: "chesscom:classical" }).success, false, "Chess.com has no classical pool");
    assert.equal(PatchOnboardingBody.safeParse({ ratingBandSource: "lichess:classical" }).success, true);
    assert.equal(PatchOnboardingBody.safeParse({ ratingBand: null }).success, true, "clearing the band is allowed");
    assert.equal(PatchOnboardingBody.safeParse({ onboarded: true }).success, false, "strict: unknown keys are a 400");
    assert.equal(PatchOnboardingBody.safeParse({}).success, true);
  });

  it("TimeZone accepts IANA names and UTC, rejects Mars/Olympus", () => {
    for (const tz of ["Asia/Kolkata", "Asia/Calcutta", "Europe/London", "America/New_York", "America/Argentina/Buenos_Aires", "Etc/GMT+5", "UTC"]) {
      assert.equal(TimeZone.safeParse(tz).success, true, tz);
    }
    for (const tz of ["Mars/Olympus", "", "Asia/Kolkata ", "../etc/passwd", "x".repeat(65)]) assert.equal(TimeZone.safeParse(tz).success, false, tz);
  });
});
