import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findCollisions, SHORTCUT_SECTIONS } from "@/lib/shell/shortcuts";
import type { ReviewKeyContext } from "@/features/review/keys/hotkeys";
import { PRACTICE_SHORTCUTS, practiceKeyFor } from "./keys";

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

describe("practice keys", () => {
  it("Backspace, R, H, F, ←/→", () => {
    assert.equal(practiceKeyFor(key("Backspace", "Backspace"), ctx()), "takeback");
    assert.equal(practiceKeyFor(key("r", "KeyR"), ctx()), "reset");
    assert.equal(practiceKeyFor(key("h", "KeyH"), ctx()), "hint");
    assert.equal(practiceKeyFor(key("f", ""), ctx()), "flip");
    assert.equal(practiceKeyFor(key("ArrowLeft"), ctx({ coarse: true })), "prev");
    assert.equal(practiceKeyFor(key("ArrowRight"), ctx()), "next");
  });

  it("never while typing, in a modal, with a modifier, or on touch for single keys", () => {
    assert.equal(practiceKeyFor(key("Backspace", "Backspace"), ctx({ editable: true })), null);
    assert.equal(practiceKeyFor(key("r", "KeyR"), ctx({ modalOpen: true })), null);
    assert.equal(practiceKeyFor(key("r", "KeyR", { metaKey: true }), ctx()), null);
    assert.equal(practiceKeyFor(key("h", "KeyH"), ctx({ coarse: true })), null);
    assert.equal(practiceKeyFor(key("h", "KeyH"), ctx({ singleKeyEnabled: false })), null);
    assert.equal(practiceKeyFor(key("ArrowLeft"), ctx({ arrowWidget: true })), null);
    assert.equal(practiceKeyFor(key("x", "KeyX"), ctx()), null);
  });

  it("its `?` section collides with no Everywhere key", () => {
    const global = SHORTCUT_SECTIONS.filter((s) => s.scope === "global");
    assert.deepEqual(findCollisions([...global, PRACTICE_SHORTCUTS]), []);
  });
});
