// P5 shortcut sections (phase-05 plan §4.4 keys; V3Shortcuts "Puzzles and lessons"): no collisions with the
// Everywhere keys or inside a section, and they show in the `?` list only while their page is mounted.
import assert from "node:assert/strict";
import { test } from "node:test";
import { BANK_SHORTCUTS, findCollisions, registerPageShortcuts, SHORTCUT_SECTIONS, shortcutSections, TRAINER_SHORTCUTS } from "./shortcuts";

const global = SHORTCUT_SECTIONS.filter((s) => s.scope === "global");

test("the trainer and bank sections collide with nothing", () => {
  assert.deepEqual(findCollisions([...global, TRAINER_SHORTCUTS]), []);
  assert.deepEqual(findCollisions([...global, BANK_SHORTCUTS]), []);
});

test("the trainer section lists H, R, S, 1–4, Enter and T", () => {
  const keys = TRAINER_SHORTCUTS.rows.flatMap((r) => r.keys.map((k) => k.join("+")));
  for (const k of ["H", "R", "S", "1", "2", "3", "4", "Enter", "T"]) assert.ok(keys.includes(k), k);
});

test("a registered page section shows while mounted and leaves on unregister", () => {
  const off = registerPageShortcuts("trainer", TRAINER_SHORTCUTS);
  assert.ok(shortcutSections().some((s) => s.scope === "trainer"));
  off();
  assert.ok(!shortcutSections().some((s) => s.scope === "trainer"));
});

test("a section that reuses an Everywhere key throws", () => {
  assert.throws(() => registerPageShortcuts("bad", { title: "Bad", scope: "bank", rows: [{ id: "x", label: "x", keys: [["?"]] }] }));
});

test("section titles are Title Case and row labels sentence case", () => {
  for (const s of [TRAINER_SHORTCUTS, BANK_SHORTCUTS]) {
    for (const w of s.title.split(" ").filter((w) => !["and", "the", "in", "of"].includes(w))) assert.match(w, /^[A-Z]/, s.title);
    for (const r of s.rows) assert.match(r.label, /^[A-Z][^.]*[^.]$/, r.label);
  }
});

test("G H and G M show only with their flags (home, train)", () => {
  const everywhere = (f: Parameters<typeof shortcutSections>[0]) => shortcutSections(f).find((s) => s.scope === "global")!.rows.map((r) => r.id);
  assert.ok(!everywhere({}).includes("go-home") && !everywhere({}).includes("go-bank"));
  assert.ok(everywhere({ home: true }).includes("go-home"));
  assert.ok(everywhere({ train: true }).includes("go-bank"));
  assert.deepEqual(findCollisions(SHORTCUT_SECTIONS), []);
});
