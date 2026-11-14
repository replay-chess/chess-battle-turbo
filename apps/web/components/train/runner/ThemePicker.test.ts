// The theme picker's arrow keys (phase-05 plan §4.6 "arrows move, Enter picks"; FIX-2): ↓/↑ move between the stops
// and wrap, Home/End jump; other keys are not the list's.
import assert from "node:assert/strict";
import { test } from "node:test";
import { nextStop } from "./ThemePicker";

const stops = ["recommended", "fork", "pin", "more"].map((id) => ({ id }) as unknown as HTMLElement);

test("↓ and ↑ move one stop and wrap; from outside the list ↓ enters at the first, ↑ at the last", () => {
  assert.equal(nextStop(stops, stops[0]!, "ArrowDown"), stops[1]);
  assert.equal(nextStop(stops, stops[3]!, "ArrowDown"), stops[0]);
  assert.equal(nextStop(stops, stops[1]!, "ArrowUp"), stops[0]);
  assert.equal(nextStop(stops, stops[0]!, "ArrowUp"), stops[3]);
  assert.equal(nextStop(stops, null, "ArrowDown"), stops[0]);
  assert.equal(nextStop(stops, null, "ArrowUp"), stops[3]);
});

test("Home / End; other keys and an empty list give nothing", () => {
  assert.equal(nextStop(stops, stops[2]!, "Home"), stops[0]);
  assert.equal(nextStop(stops, stops[0]!, "End"), stops[3]);
  assert.equal(nextStop(stops, stops[0]!, "Enter"), null);
  assert.equal(nextStop([], null, "ArrowDown"), null);
});
