// Game-page keys (P2 plan 4.6.1): which keydown means which action, and the gates (fields, modals, widgets that
// own arrows, coarse pointers, the Single-Key Shortcuts switch).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { KeyLike } from "@/lib/shell/keys";
import { gameHotkeyFor, type GameKeyContext } from "./hotkeys";

const key = (k: string, code = "", over: Partial<KeyLike> = {}): KeyLike => ({
  key: k,
  code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  repeat: false,
  isComposing: false,
  defaultPrevented: false,
  ...over,
});
const ctx = (over: Partial<GameKeyContext> = {}): GameKeyContext => ({
  coarse: false,
  singleKeyEnabled: true,
  editable: false,
  modalOpen: false,
  arrowWidget: false,
  ...over,
});

test("arrows step through the moves; holding one repeats", () => {
  assert.equal(gameHotkeyFor(key("ArrowLeft"), ctx()), "prev");
  assert.equal(gameHotkeyFor(key("ArrowRight"), ctx()), "next");
  assert.equal(gameHotkeyFor(key("ArrowUp"), ctx()), "first");
  assert.equal(gameHotkeyFor(key("ArrowDown"), ctx()), "last");
  assert.equal(gameHotkeyFor(key("ArrowLeft", "", { repeat: true }), ctx()), "prev");
});

test("arrows work with a coarse pointer and with single keys off, never in a field, a modal or the board grid", () => {
  assert.equal(gameHotkeyFor(key("ArrowLeft"), ctx({ coarse: true, singleKeyEnabled: false })), "prev");
  assert.equal(gameHotkeyFor(key("ArrowLeft"), ctx({ editable: true })), null);
  assert.equal(gameHotkeyFor(key("ArrowLeft"), ctx({ modalOpen: true })), null);
  assert.equal(gameHotkeyFor(key("ArrowLeft"), ctx({ arrowWidget: true })), null);
});

test("letters by physical key: F M D H U", () => {
  assert.equal(gameHotkeyFor(key("f", "KeyF"), ctx()), "flip");
  assert.equal(gameHotkeyFor(key("M", "KeyM", { getModifierState: () => false }), ctx()), "sound");
  assert.equal(gameHotkeyFor(key("d", "KeyD"), ctx()), "draw");
  assert.equal(gameHotkeyFor(key("h", "KeyH"), ctx()), "hint");
  assert.equal(gameHotkeyFor(key("u", "KeyU"), ctx()), "undo");
  assert.equal(gameHotkeyFor(key("а", "KeyF"), ctx()), "flip", "a Cyrillic layout still has code KeyF");
  assert.equal(gameHotkeyFor(key("f", ""), ctx()), "flip", "no code: fall back to the character");
  assert.equal(gameHotkeyFor(key("x", "KeyX"), ctx()), null);
  assert.equal(gameHotkeyFor(key("q", "KeyQ"), ctx()), null, "Q R B N belong to the promotion picker");
});

test("letters follow the shell's single-key gates (WCAG 2.1.4)", () => {
  assert.equal(gameHotkeyFor(key("f", "KeyF"), ctx({ singleKeyEnabled: false })), null);
  assert.equal(gameHotkeyFor(key("f", "KeyF"), ctx({ coarse: true })), null);
  assert.equal(gameHotkeyFor(key("f", "KeyF"), ctx({ editable: true })), null);
  assert.equal(gameHotkeyFor(key("f", "KeyF"), ctx({ modalOpen: true })), null);
  assert.equal(gameHotkeyFor(key("f", "KeyF", { repeat: true }), ctx()), null);
});

test("modifiers, composition and handled events are ignored; AltGr is not a modifier", () => {
  assert.equal(gameHotkeyFor(key("f", "KeyF", { metaKey: true }), ctx()), null);
  assert.equal(gameHotkeyFor(key("f", "KeyF", { ctrlKey: true }), ctx()), null);
  assert.equal(gameHotkeyFor(key("f", "KeyF", { altKey: true }), ctx()), null);
  assert.equal(gameHotkeyFor(key("f", "KeyF", { isComposing: true }), ctx()), null);
  assert.equal(gameHotkeyFor(key("f", "KeyF", { defaultPrevented: true }), ctx()), null);
  assert.equal(gameHotkeyFor(key("Process", "KeyF"), ctx()), null);
  const altGr = key("f", "KeyF", { ctrlKey: true, altKey: true, getModifierState: (k) => k === "AltGraph" });
  assert.equal(gameHotkeyFor(altGr, ctx()), "flip");
});

test("Esc is the premove cancel unless a modal is open", () => {
  assert.equal(gameHotkeyFor(key("Escape", "Escape"), ctx()), "escape");
  assert.equal(gameHotkeyFor(key("Escape", "Escape"), ctx({ coarse: true, singleKeyEnabled: false })), "escape");
  assert.equal(gameHotkeyFor(key("Escape", "Escape"), ctx({ modalOpen: true })), null);
});
