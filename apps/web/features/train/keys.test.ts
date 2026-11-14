// The trainer's key rules (phase-05 plan §4.4 keys, SPEC D20 / WCAG 2.1.4 gates) and the local day key (§5.2 S2).
import assert from "node:assert/strict";
import { test } from "node:test";
import { trainerKeyFor, type TrainerKeyContext } from "./useTrainerKeys";
import { safeDayKey } from "./useLocalDayKey";

const ctx: TrainerKeyContext = { coarse: false, singleKeyEnabled: true, editable: false, modalOpen: false, onControl: false };
const key = (k: string, code: string, extra: Record<string, unknown> = {}) => ({
  key: k,
  code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  repeat: false,
  isComposing: false,
  defaultPrevented: false,
  ...extra,
});

test("H, R, S, T and 1–4 map to their actions; Enter is the primary outside controls", () => {
  assert.equal(trainerKeyFor(key("h", "KeyH"), ctx), "hint");
  assert.equal(trainerKeyFor(key("r", "KeyR"), ctx), "retry");
  assert.equal(trainerKeyFor(key("s", "KeyS"), ctx), "solution");
  assert.equal(trainerKeyFor(key("t", "KeyT"), ctx), "themes");
  assert.equal(trainerKeyFor(key("1", "Digit1"), ctx), "grade-1");
  assert.equal(trainerKeyFor(key("4", "Numpad4"), ctx), "grade-4");
  assert.equal(trainerKeyFor(key("Enter", "Enter"), ctx), "primary");
  // A non-Latin layout still has the physical code.
  assert.equal(trainerKeyFor(key("р", "KeyH"), ctx), "hint");
});

test("the single-key gates: coarse pointer, switch off, fields, modals, modifiers, repeats", () => {
  assert.equal(trainerKeyFor(key("h", "KeyH"), { ...ctx, coarse: true }), null);
  assert.equal(trainerKeyFor(key("h", "KeyH"), { ...ctx, singleKeyEnabled: false }), null);
  assert.equal(trainerKeyFor(key("h", "KeyH"), { ...ctx, editable: true }), null);
  assert.equal(trainerKeyFor(key("h", "KeyH"), { ...ctx, modalOpen: true }), null);
  assert.equal(trainerKeyFor(key("h", "KeyH", { metaKey: true }), ctx), null);
  assert.equal(trainerKeyFor(key("h", "KeyH", { shiftKey: true }), ctx), null);
  assert.equal(trainerKeyFor(key("h", "KeyH", { repeat: true }), ctx), null);
  assert.equal(trainerKeyFor(key("h", "KeyH", { defaultPrevented: true }), ctx), null);
  // Enter on a focused button or the board grid belongs to that control.
  assert.equal(trainerKeyFor(key("Enter", "Enter"), { ...ctx, onControl: true }), null);
  assert.equal(trainerKeyFor(key("x", "KeyX"), ctx), null);
});

test("safeDayKey: the day starts at dayStartHour in the member's zone; bad zones give null", () => {
  assert.equal(safeDayKey(new Date("2026-11-13T03:00:00Z"), "UTC", 4), "2026-11-12");
  assert.equal(safeDayKey(new Date("2026-11-13T05:00:00Z"), "UTC", 4), "2026-11-13");
  assert.equal(safeDayKey(new Date("2026-11-12T23:00:00Z"), "Asia/Kolkata", 4), "2026-11-13");
  assert.equal(safeDayKey(new Date("2026-11-13T05:00:00Z"), "Not/AZone", 4), null);
});
