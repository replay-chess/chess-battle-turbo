import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSingleKeyPref, singleKeyEnabledNow } from "./prefs";

test("parseSingleKeyPref defaults to on", () => {
  assert.equal(parseSingleKeyPref(null), true);
  assert.equal(parseSingleKeyPref("0"), false);
  assert.equal(parseSingleKeyPref("1"), true);
  assert.equal(parseSingleKeyPref("garbage"), true);
});

test("singleKeyEnabledNow is on without a window", () => {
  assert.equal(singleKeyEnabledNow(), true);
});
