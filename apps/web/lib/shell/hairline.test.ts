import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldStartHairline } from "./hairline";

const here = "https://app.test/legends?x=1#top";

test("the same path with a different hash does not start the hairline", () => {
  assert.equal(shouldStartHairline(here, "https://app.test/legends?x=1#other"), false);
  assert.equal(shouldStartHairline(here, "#other"), false);
});

test("a different search or pathname starts it", () => {
  assert.equal(shouldStartHairline(here, "https://app.test/legends?x=2"), true);
  assert.equal(shouldStartHairline(here, "/openings"), true);
  assert.equal(shouldStartHairline(here, "/legends"), true, "dropping the search counts");
});

test("another origin or a broken URL does not", () => {
  assert.equal(shouldStartHairline(here, "https://other.test/legends"), false);
  assert.equal(shouldStartHairline("not a url", "/play"), false);
});
