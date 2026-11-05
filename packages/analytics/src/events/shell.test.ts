import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FORBIDDEN_PROPERTY_NAMES } from "../pii";
import { DESTINATION_KEYS, shellEvents } from "./shell";

const valid: { [K in keyof typeof shellEvents]: Record<string, unknown> } = {
  shell_nav_click: { dest: "legends", surface: "sidebar" },
  shell_palette_opened: { via: "shortcut" },
  shell_palette_command: { id: "goto:play", group: "goto", queryLength: 6 },
  shell_shortcuts_opened: { via: "key" },
  shell_shortcuts_toggled: { enabled: false },
  shell_account_action: { action: "signout" },
};

describe("shell events", () => {
  it("registers exactly the six SPEC 3.10 events", () => {
    assert.deepEqual(Object.keys(shellEvents).sort(), [
      "shell_account_action",
      "shell_nav_click",
      "shell_palette_command",
      "shell_palette_opened",
      "shell_shortcuts_opened",
      "shell_shortcuts_toggled",
    ]);
  });

  for (const [name, schema] of Object.entries(shellEvents)) {
    const sample = valid[name as keyof typeof shellEvents];
    it(`${name} accepts its documented shape`, () => {
      assert.equal(schema.safeParse(sample).success, true);
    });
    it(`${name} rejects extra keys`, () => {
      assert.equal(schema.safeParse({ ...sample, extra: "x" }).success, false);
    });
    it(`${name} declares no forbidden property`, () => {
      for (const key of Object.keys(schema.shape)) {
        assert.ok(!(FORBIDDEN_PROPERTY_NAMES as readonly string[]).includes(key), `${name}.${key}`);
      }
    });
  }

  it("rejects free text where an enum is expected", () => {
    assert.equal(shellEvents.shell_nav_click.safeParse({ dest: "morphy", surface: "sidebar" }).success, false);
    assert.equal(
      shellEvents.shell_palette_command.safeParse({ id: "paul morphy", group: "legends", queryLength: 6 }).success,
      false,
    );
  });

  it("mirrors DestinationKey in apps/web/lib/shell/types.ts", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(new URL("../../../../apps/web/lib/shell/types.ts", import.meta.url), "utf8");
    const union = /export type DestinationKey =([^;]+);/.exec(src)?.[1] ?? "";
    const keys = [...union.matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
    assert.deepEqual([...keys].sort(), [...DESTINATION_KEYS].sort());
  });
});
