import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CHORD_TIMEOUT_MS,
  SHELL_CHORDS,
  SHORTCUT_SECTIONS,
  classifyKeydown,
  createChordMachine,
  findCollisions,
  isApplePlatform,
  isEditableTarget,
  type KeyContext,
  type KeyLike,
} from "./keys";

function key(partial: Partial<KeyLike> & { key: string }, altGraph = false): KeyLike {
  return {
    code: "",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    repeat: false,
    isComposing: false,
    defaultPrevented: false,
    getModifierState: (k) => k === "AltGraph" && altGraph,
    ...partial,
  };
}

const ctx = (over: Partial<KeyContext> = {}): KeyContext => ({
  coarse: false,
  singleKeyEnabled: true,
  modalOpen: false,
  shellDialogOpen: false,
  editable: false,
  ...over,
});

const cmdK = key({ key: "k", code: "KeyK", metaKey: true });
const slash = key({ key: "/", code: "Slash" });

test("g then p within 1000ms navigates; at 1001ms nothing; g then x disarms", () => {
  const m = createChordMachine({ timeoutMs: CHORD_TIMEOUT_MS, chords: SHELL_CHORDS });
  assert.deepEqual(m.press("KeyG", "g", 0), { armed: true });
  assert.deepEqual(m.press("KeyP", "p", 1000), { navigate: "/play" });

  m.press("KeyG", "g", 5000);
  assert.deepEqual(m.press("KeyP", "p", 6001), {});

  m.press("KeyG", "g", 10_000);
  assert.deepEqual(m.press("KeyX", "x", 10_100), {});
  assert.deepEqual(m.press("KeyP", "p", 10_200), {}, "disarmed after x");

  m.press("KeyG", "g", 20_000);
  assert.deepEqual(m.press("KeyL", "l", 20_010), { navigate: "/legends" });
});

test("chords resolve by code first, then by key", () => {
  const m = createChordMachine({ timeoutMs: 1000, chords: SHELL_CHORDS });
  m.press("KeyG", "п", 0);
  assert.deepEqual(m.press("KeyP", "з", 10), { navigate: "/play" }, "code KeyP on a Russian layout");
  m.press("", "g", 100);
  assert.deepEqual(m.press("", "p", 110), { navigate: "/play" }, "no code: fall back to the key");
  m.press("KeyG", "g", 200);
  assert.deepEqual(m.press("KeyR", "p", 210), { navigate: "/play" }, "Dvorak: code misses, key hits");
});

test("classifyKeydown: repeat, composing and Process are ignored", () => {
  assert.equal(classifyKeydown(key({ key: "/", repeat: true }), ctx()), "ignore");
  assert.equal(classifyKeydown(key({ key: "/", isComposing: true }), ctx()), "ignore");
  assert.equal(classifyKeydown(key({ key: "Process" }), ctx()), "ignore");
  assert.equal(classifyKeydown(key({ key: "/", defaultPrevented: true }), ctx()), "ignore");
});

test("classifyKeydown: ⌘K and Ctrl+K", () => {
  assert.equal(classifyKeydown(cmdK, ctx({ editable: true })), "palette", "in an editable");
  assert.equal(classifyKeydown(cmdK, ctx({ coarse: true })), "palette", "on coarse");
  assert.equal(classifyKeydown(cmdK, ctx({ singleKeyEnabled: false })), "palette", "switch off");
  assert.equal(classifyKeydown(key({ key: "K", code: "KeyK", ctrlKey: true }), ctx()), "palette", "Ctrl+Shift+K");
  assert.equal(classifyKeydown(key({ key: "л", code: "KeyK", ctrlKey: true }), ctx()), "palette", "by code");
  assert.equal(classifyKeydown(cmdK, ctx({ modalOpen: true })), "ignore", "non-shell modal open");
  assert.equal(classifyKeydown(cmdK, ctx({ shellDialogOpen: true })), "palette", "shortcuts dialog open");
  assert.equal(classifyKeydown(key({ key: "k", code: "KeyK" }), ctx()), "chord-key", "plain k");
});

test("classifyKeydown: single keys", () => {
  assert.equal(classifyKeydown(slash, ctx()), "slash");
  assert.equal(classifyKeydown(key({ key: "?", code: "Slash" }), ctx()), "help");
  assert.equal(classifyKeydown(key({ key: "g", code: "KeyG" }), ctx()), "chord-key");
  assert.equal(classifyKeydown(slash, ctx({ editable: true })), "ignore", "in an editable");
  assert.equal(classifyKeydown(slash, ctx({ coarse: true })), "ignore", "on coarse");
  assert.equal(classifyKeydown(slash, ctx({ singleKeyEnabled: false })), "ignore", "switch off");
  assert.equal(classifyKeydown(slash, ctx({ modalOpen: true })), "ignore", "a modal is open");
  assert.equal(classifyKeydown(slash, ctx({ shellDialogOpen: true })), "ignore", "a shell dialog is open");
  assert.equal(classifyKeydown(key({ key: "/", ctrlKey: true }), ctx()), "ignore", "Ctrl+/");
  assert.equal(classifyKeydown(key({ key: "g", altKey: true }), ctx()), "ignore", "Alt+g");
  assert.equal(
    classifyKeydown(key({ key: "/", ctrlKey: true, altKey: true }, true), ctx()),
    "slash",
    "AltGraph+Ctrl+Alt counts as no modifier",
  );
});

test("isEditableTarget", () => {
  assert.equal(isEditableTarget({ tagName: "INPUT" }), true);
  assert.equal(isEditableTarget({ tagName: "textarea" }), true);
  assert.equal(isEditableTarget({ tagName: "SELECT" }), true);
  assert.equal(isEditableTarget({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(
    isEditableTarget({ tagName: "DIV", closest: (s: string) => (s.includes("combobox") ? {} : null) }),
    true,
  );
  assert.equal(isEditableTarget({ tagName: "BUTTON", closest: () => null }), false);
  assert.equal(isEditableTarget(null), false);
});

test("isApplePlatform", () => {
  assert.equal(isApplePlatform({ platform: "MacIntel" }), true);
  assert.equal(isApplePlatform({ userAgentData: { platform: "macOS" } }), true);
  assert.equal(isApplePlatform({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" }), true);
  assert.equal(isApplePlatform({ platform: "Win32" }), false);
  assert.equal(isApplePlatform({ userAgentData: { platform: "Android" }, platform: "Linux armv8l" }), false);
  assert.equal(isApplePlatform(undefined), false);
});

test("findCollisions flags duplicates and passes on the Phase 1 registry", () => {
  assert.deepEqual(findCollisions(SHORTCUT_SECTIONS), []);
  const dup = findCollisions([
    {
      title: "In a Game",
      scope: "board",
      rows: [
        { id: "flip", label: "Flip the board", keys: [["F"]] },
        { id: "x", label: "Other", keys: [["f"]] },
      ],
    },
  ]);
  assert.equal(dup.length, 1);
  assert.deepEqual(dup[0]?.ids, ["flip", "x"]);
  const vsGlobal = findCollisions([
    ...SHORTCUT_SECTIONS,
    { title: "Review", scope: "review", rows: [{ id: "help2", label: "Help", keys: [["?"]] }] },
  ]);
  assert.equal(vsGlobal.length, 1);
  assert.deepEqual(vsGlobal[0]?.ids, ["help", "help2"]);
});

test("the Phase 1 registry has only the Everywhere section", () => {
  assert.deepEqual(
    SHORTCUT_SECTIONS.map((s) => [s.title, s.scope]),
    [["Everywhere", "global"]],
  );
});
