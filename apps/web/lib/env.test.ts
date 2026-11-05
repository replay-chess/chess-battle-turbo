import assert from "node:assert/strict";
import { test } from "node:test";
import { appEnv, devRoutesEnabled, isProductionApp } from "./env";

test("devRoutesEnabled fails closed", () => {
  assert.equal(devRoutesEnabled("production", "development"), false);
  assert.equal(devRoutesEnabled("dev", "production"), true);
  assert.equal(devRoutesEnabled("test", "production"), true);
  assert.equal(devRoutesEnabled(undefined, "development"), true);
  assert.equal(devRoutesEnabled("", "development"), true);
  assert.equal(devRoutesEnabled(undefined, "production"), false);
  assert.equal(devRoutesEnabled("staging", "development"), false);
  assert.equal(devRoutesEnabled("production"), false);
});

test("appEnv and isProductionApp", () => {
  assert.equal(appEnv(""), null);
  assert.equal(appEnv("dev"), "dev");
  assert.equal(isProductionApp("production"), true);
  assert.equal(isProductionApp("dev"), false);
  assert.equal(isProductionApp(undefined), false);
});
