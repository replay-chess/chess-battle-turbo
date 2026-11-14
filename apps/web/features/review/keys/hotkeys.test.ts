// hotkeys.ts: which review action a keydown means, with the shell's single-key gates (SPEC D20, WCAG 2.1.4).
import assert from "node:assert/strict";
import { test } from "node:test";
import { reviewHotkeyFor, type ReviewKeyContext, type ReviewKeyLike } from "./hotkeys";

const ctx: ReviewKeyContext = {
  coarse: false,
  singleKeyEnabled: true,
  editable: false,
  modalOpen: false,
  arrowWidget: false,
  onControl: false,
};

function key(k: string, code = "", extra: Partial<ReviewKeyLike> = {}): ReviewKeyLike {
  return { key: k, code, metaKey: false, ctrlKey: false, altKey: false, repeat: false, isComposing: false, defaultPrevented: false, ...extra };
}

test("arrows step plies, Home/End jump, Shift+arrows move between moments", () => {
  assert.equal(reviewHotkeyFor(key("ArrowLeft", "ArrowLeft"), ctx), "prev");
  assert.equal(reviewHotkeyFor(key("ArrowRight", "ArrowRight"), ctx), "next");
  assert.equal(reviewHotkeyFor(key("Home", "Home"), ctx), "first");
  assert.equal(reviewHotkeyFor(key("End", "End"), ctx), "last");
  assert.equal(reviewHotkeyFor(key("ArrowLeft", "ArrowLeft", { shiftKey: true }), ctx), "prev-moment");
  assert.equal(reviewHotkeyFor(key("ArrowRight", "ArrowRight", { shiftKey: true }), ctx), "next-moment");
  assert.equal(reviewHotkeyFor(key("ArrowRight", "ArrowRight", { repeat: true }), ctx), "next", "holding steps");
});

test("arrows work on touch, but not in fields, modals or widgets that own them", () => {
  assert.equal(reviewHotkeyFor(key("ArrowLeft", "ArrowLeft"), { ...ctx, coarse: true }), "prev");
  assert.equal(reviewHotkeyFor(key("ArrowLeft", "ArrowLeft"), { ...ctx, editable: true }), null);
  assert.equal(reviewHotkeyFor(key("ArrowLeft", "ArrowLeft"), { ...ctx, modalOpen: true }), null);
  assert.equal(reviewHotkeyFor(key("Home", "Home"), { ...ctx, arrowWidget: true }), null);
});

test("letters, Space and Enter need a fine pointer and the single-key switch", () => {
  assert.equal(reviewHotkeyFor(key("f", "KeyF"), ctx), "flip");
  assert.equal(reviewHotkeyFor(key("m", "KeyM"), ctx), "tab-moves");
  assert.equal(reviewHotkeyFor(key("c", "KeyC"), ctx), "tab-coach");
  assert.equal(reviewHotkeyFor(key("d", "KeyD"), ctx), "done");
  assert.equal(reviewHotkeyFor(key("3", "Digit3"), ctx), "plan-3");
  assert.equal(reviewHotkeyFor(key(" ", "Space"), ctx), "narration");
  assert.equal(reviewHotkeyFor(key("Enter", "Enter"), ctx), "primary");
  assert.equal(reviewHotkeyFor(key("f", "KeyF"), { ...ctx, coarse: true }), null);
  assert.equal(reviewHotkeyFor(key("f", "KeyF"), { ...ctx, singleKeyEnabled: false }), null);
  assert.equal(reviewHotkeyFor(key("f", "KeyF", { repeat: true }), ctx), null);
  assert.equal(reviewHotkeyFor(key("а", "KeyF"), ctx), "flip", "physical key on a Cyrillic layout");
  assert.equal(reviewHotkeyFor(key("l", ""), ctx), "show-line", "no code: falls back to the character");
});

test("Space and Enter on a focused control are the control's own", () => {
  assert.equal(reviewHotkeyFor(key(" ", "Space"), { ...ctx, onControl: true }), null);
  assert.equal(reviewHotkeyFor(key("Enter", "Enter"), { ...ctx, onControl: true }), null);
});

test("modifier chords are never review keys (⌘K, Ctrl+F, Alt+T stay with the browser and the shell)", () => {
  assert.equal(reviewHotkeyFor(key("f", "KeyF", { ctrlKey: true }), ctx), null);
  assert.equal(reviewHotkeyFor(key("k", "KeyK", { metaKey: true }), ctx), null);
  assert.equal(reviewHotkeyFor(key("t", "KeyT", { altKey: true }), ctx), null);
  assert.equal(reviewHotkeyFor(key("F", "KeyF", { shiftKey: true }), ctx), null);
  assert.equal(reviewHotkeyFor(key("f", "KeyF", { defaultPrevented: true }), ctx), null);
});

// P5 (phase-05 plan §4.8): B toggles the answered key moment's Mistake Bank checkbox, with the single-key gates.
test("B is the bank toggle, gated like every letter", () => {
  assert.equal(reviewHotkeyFor(key("b", "KeyB"), ctx), "bank");
  assert.equal(reviewHotkeyFor(key("B", "KeyB", { shiftKey: true }), ctx), null);
  assert.equal(reviewHotkeyFor(key("b", "KeyB"), { ...ctx, coarse: true }), null);
  assert.equal(reviewHotkeyFor(key("b", "KeyB"), { ...ctx, singleKeyEnabled: false }), null);
  assert.equal(reviewHotkeyFor(key("b", "KeyB"), { ...ctx, editable: true }), null);
  assert.equal(reviewHotkeyFor(key("b", "KeyB"), { ...ctx, modalOpen: true }), null);
  assert.equal(reviewHotkeyFor(key("b", "KeyB", { metaKey: true }), ctx), null);
});
