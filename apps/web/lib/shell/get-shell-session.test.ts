import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chromeModeFor } from "./get-shell-session";

describe("chromeModeFor (1B·J: member && shell-v3)", () => {
  it("members get the shell only while shell-v3 is on", () => {
    assert.equal(chromeModeFor({ member: true }, { "shell-v3": true }), "shell");
    assert.equal(chromeModeFor({ member: true }, { "shell-v3": false }), "marketing");
  });

  it("non-members and signed-out visitors always get marketing chrome", () => {
    assert.equal(chromeModeFor({ member: false }, { "shell-v3": true }), "marketing");
    assert.equal(chromeModeFor(null, { "shell-v3": true }), "marketing");
    assert.equal(chromeModeFor(null, { "shell-v3": false }), "marketing");
  });
});
