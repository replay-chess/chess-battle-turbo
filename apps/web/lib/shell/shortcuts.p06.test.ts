// P6 shortcut row (phase-06 plan §7.8): G then W opens the Weakness Profile. It shows in the `?` list only while both
// `train` and `weakness` are on (the section is a Train sub, lib/nav/destinations.ts), and collides with nothing.
import assert from "node:assert/strict";
import { test } from "node:test";
import { BANK_SHORTCUTS, findCollisions, SHORTCUT_SECTIONS, shortcutSections, TRAINER_SHORTCUTS } from "./shortcuts";
import { destinationChords } from "../nav/destinations";

const everywhere = (f: Parameters<typeof shortcutSections>[0]) => shortcutSections(f).find((s) => s.scope === "global")!.rows.map((r) => r.id);

test("G W shows only with train and weakness on", () => {
  for (const f of [{}, { train: true }, { weakness: true }, { home: true, weakness: true }, { train: true, weakness: false }]) {
    assert.equal(everywhere(f).includes("go-weakness"), false, JSON.stringify(f));
  }
  assert.ok(everywhere({ train: true, weakness: true }).includes("go-weakness"));
  const row = SHORTCUT_SECTIONS.flatMap((s) => s.rows).find((r) => r.id === "go-weakness")!;
  assert.deepEqual([row.label, row.keys], ["Go to Weakness Profile", [["G", "W"]]]);
});

test("the row matches the chord the shell registers, and nothing collides", () => {
  assert.equal(destinationChords({ train: true, weakness: true }).KeyW, "/train/weakness");
  assert.equal(destinationChords({ train: true }).KeyW, undefined);
  assert.deepEqual(findCollisions(SHORTCUT_SECTIONS), []);
  const global = SHORTCUT_SECTIONS.filter((s) => s.scope === "global");
  assert.deepEqual(findCollisions([...global, TRAINER_SHORTCUTS, BANK_SHORTCUTS]), []);
});
