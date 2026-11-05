import assert from "node:assert/strict";
import { test } from "node:test";
import { AVATAR_GRADIENTS, gradientBackground, gradientIndex, hashSeed, initials } from "./avatar-gradient";

test("the same seed always gives the same gradient", () => {
  for (const seed of ["user_2abc", "Bobby Fischer", "", "ü"]) {
    assert.equal(gradientIndex(seed), gradientIndex(seed));
    assert.equal(hashSeed(seed), hashSeed(seed));
    assert.equal(gradientBackground(seed), gradientBackground(seed));
  }
});

test("the index is always in range", () => {
  for (let i = 0; i < 500; i++) {
    const idx = gradientIndex(`seed-${i}`);
    assert.ok(Number.isInteger(idx) && idx >= 0 && idx < AVATAR_GRADIENTS.length, `index ${idx}`);
  }
});

test("all six pairs are reachable over 100 seeds", () => {
  const seen = new Set<number>();
  for (let i = 0; i < 100; i++) seen.add(gradientIndex(`user-${i}`));
  assert.equal(seen.size, AVATAR_GRADIENTS.length);
});

test("the gradient background names both ends of the pair", () => {
  const [from, to] = AVATAR_GRADIENTS[gradientIndex("knightowl_88")]!;
  assert.equal(gradientBackground("knightowl_88"), `linear-gradient(135deg, ${from}, ${to})`);
});

test("initials: two words give two letters", () => {
  assert.equal(initials("Bobby Fischer"), "BF");
});

test("initials: one word gives one uppercase letter", () => {
  assert.equal(initials("knightowl_88"), "K");
});

test("initials: at most two letters", () => {
  assert.equal(initials("José Raúl Capablanca"), "JR");
});

test("initials: leading punctuation is skipped", () => {
  assert.equal(initials("_magnus"), "M");
});

test("initials: empty or blank gives a question mark", () => {
  assert.equal(initials(""), "?");
  assert.equal(initials("   "), "?");
  assert.equal(initials("__ --"), "?");
});
