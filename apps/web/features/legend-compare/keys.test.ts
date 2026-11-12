import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findCollisions, SHORTCUT_SECTIONS } from "@/lib/shell/shortcuts";
import type { ReviewKeyContext } from "@/features/review/keys/hotkeys";
import { COMPARE_SHORTCUTS, compareKeyFor } from "./keys";

const ctx = (o: Partial<ReviewKeyContext> = {}): ReviewKeyContext => ({
  coarse: false,
  singleKeyEnabled: true,
  editable: false,
  modalOpen: false,
  arrowWidget: false,
  onControl: false,
  ...o,
});
const key = (k: string, code = "", extra: Record<string, unknown> = {}) => ({
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

describe("compare keys", () => {
  it("arrows step and jump, any pointer", () => {
    assert.equal(compareKeyFor(key("ArrowLeft"), ctx({ coarse: true })), "prev");
    assert.equal(compareKeyFor(key("ArrowRight"), ctx()), "next");
    assert.equal(compareKeyFor(key("ArrowUp"), ctx()), "first");
    assert.equal(compareKeyFor(key("ArrowDown"), ctx()), "last");
  });

  it("never inside a field, a modal or a widget that owns its arrows (the tablist)", () => {
    assert.equal(compareKeyFor(key("ArrowLeft"), ctx({ editable: true })), null);
    assert.equal(compareKeyFor(key("ArrowLeft"), ctx({ modalOpen: true })), null);
    assert.equal(compareKeyFor(key("ArrowRight"), ctx({ arrowWidget: true })), null);
  });

  it("1–4 pick the tabs; Space the narration unless a button has focus", () => {
    assert.deepEqual(compareKeyFor(key("1", "Digit1"), ctx()), { tab: "explanation" });
    assert.deepEqual(compareKeyFor(key("4", ""), ctx()), { tab: "practice" });
    assert.equal(compareKeyFor(key("5", "Digit5"), ctx()), null);
    assert.equal(compareKeyFor(key(" ", "Space"), ctx()), "narration");
    assert.equal(compareKeyFor(key(" ", "Space"), ctx({ onControl: true })), null);
  });

  it("single keys respect the coarse pointer, the switch, repeats and modifiers", () => {
    assert.equal(compareKeyFor(key("2", "Digit2"), ctx({ coarse: true })), null);
    assert.equal(compareKeyFor(key("2", "Digit2"), ctx({ singleKeyEnabled: false })), null);
    assert.equal(compareKeyFor(key("2", "Digit2", { repeat: true }), ctx()), null);
    assert.equal(compareKeyFor(key("2", "Digit2", { metaKey: true }), ctx()), null);
    assert.equal(compareKeyFor(key("ArrowLeft", "", { shiftKey: true }), ctx()), null);
  });

  it("its `?` section collides with no Everywhere key", () => {
    const global = SHORTCUT_SECTIONS.filter((s) => s.scope === "global");
    assert.deepEqual(findCollisions([...global, COMPARE_SHORTCUTS]), []);
  });
});
