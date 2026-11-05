import assert from "node:assert/strict";
import { test } from "node:test";
import { fieldA11yProps, fieldIds } from "./field-a11y";

test("ids derive from the control id", () => {
  assert.deepEqual(fieldIds("username"), {
    control: "username",
    label: "username-label",
    hint: "username-hint",
    error: "username-error",
  });
});

test("aria-describedby lists the hint, then the error", () => {
  const p = fieldA11yProps({ id: "u", hasHint: true, hasError: true });
  assert.equal(p["aria-describedby"], "u-hint u-error");
  assert.equal(p["aria-invalid"], true);
});

test("no aria-invalid without an error", () => {
  const p = fieldA11yProps({ id: "u", hasHint: true, hasError: false });
  assert.equal(p["aria-describedby"], "u-hint");
  assert.equal("aria-invalid" in p, false);
});

test("no aria-describedby when there is neither hint nor error", () => {
  const p = fieldA11yProps({ id: "u", hasHint: false, hasError: false });
  assert.deepEqual(p, { id: "u" });
});

test("error alone is described and invalid", () => {
  const p = fieldA11yProps({ id: "u", hasHint: false, hasError: true });
  assert.equal(p["aria-describedby"], "u-error");
  assert.equal(p["aria-invalid"], true);
});

test("aria-required only when required", () => {
  assert.equal(fieldA11yProps({ id: "u", hasHint: false, hasError: false, required: true })["aria-required"], true);
  assert.equal("aria-required" in fieldA11yProps({ id: "u", hasHint: false, hasError: false }), false);
});

test("an existing aria-describedby is kept after the field's ids, without duplicates", () => {
  const p = fieldA11yProps({ id: "u", hasHint: true, hasError: true, describedBy: "extra  u-hint" });
  assert.equal(p["aria-describedby"], "u-hint u-error extra");
});
