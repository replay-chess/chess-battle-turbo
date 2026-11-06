import assert from "node:assert/strict";
import { test } from "node:test";
import { ServerClock } from "./serverClock";

test("a ping sample sets the offset to s + rtt/2 − recv", () => {
  const c = new ServerClock();
  c.sample(1_000, 6_100, 1_200); // rtt 200 → offset = 6_100 + 100 − 1_200
  assert.equal(c.getOffset(), 5_000);
});

test("later samples are smoothed with α = 0.2", () => {
  const c = new ServerClock();
  c.sample(0, 1_000, 0); // offset 1000
  c.sample(0, 2_000, 0); // sample 2000 → 1000 + 0.2·1000
  assert.equal(c.getOffset(), 1_200);
});

test("a snapshot seed applies only before the first ping", () => {
  const c = new ServerClock();
  c.seed(10_000, 0, 100); // rtt 100 → offset 10_000 + 50 − 100
  assert.equal(c.getOffset(), 9_950);
  c.sample(0, 500, 0);
  c.seed(99_999, 0, 0);
  assert.equal(c.getOffset(), 500);
});
