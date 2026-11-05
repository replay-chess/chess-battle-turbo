import assert from "node:assert/strict";
import { test } from "node:test";
import { isShellPresent, markShellMounted } from "./presence";

test("markShellMounted makes the shell present until cleanup", () => {
  assert.equal(isShellPresent(), false);
  const release = markShellMounted();
  assert.equal(isShellPresent(), true);
  release();
  assert.equal(isShellPresent(), false);
});

test("two marks need two cleanups, and a cleanup counts once", () => {
  const a = markShellMounted();
  const b = markShellMounted();
  a();
  a();
  assert.equal(isShellPresent(), true);
  b();
  assert.equal(isShellPresent(), false);
});
