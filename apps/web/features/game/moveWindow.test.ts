// The move list's windowed slice past 200 plies (plan 4.6.3).
import assert from "node:assert/strict";
import { test } from "node:test";
import { MOVE_WINDOW_ROWS, WINDOW_LEAD_ROWS, windowStart } from "./moveWindow";

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ w: { ply: 2 * i + 1 }, b: { ply: 2 * i + 2 } }));

test("up to 200 plies every row renders", () => {
  assert.equal(windowStart(rows(MOVE_WINDOW_ROWS), 200, false), 0);
});

test("past 200 plies the latest 100 rows render", () => {
  assert.equal(windowStart(rows(150), 300, false), 50);
});

test("an older viewed ply moves the window back; expanding shows everything", () => {
  assert.equal(windowStart(rows(150), 41, false), 20 - WINDOW_LEAD_ROWS); // ply 41 is in row 20
  assert.equal(windowStart(rows(150), 3, false), 0);
  assert.equal(windowStart(rows(150), 300, true), 0);
});
