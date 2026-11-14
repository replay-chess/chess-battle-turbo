// Review complete's Enter (FIX-2): with the P5 Drill primary, the keyboard path reports `drill_from_review_clicked`
// exactly as the click does, before it navigates; the other primaries (Play Again, Home) report nothing.
import assert from "node:assert/strict";
import { test } from "node:test";
import { pressPrimary } from "./CompleteKeys";

test("Enter on a Drill primary tracks the funnel event once, then navigates", () => {
  const order: string[] = [];
  pressPrimary((h) => void order.push(`push:${h}`), "/train/bank/session?game=g1", 3, (n) => void order.push(`track:${n}`));
  assert.deepEqual(order, ["track:3", "push:/train/bank/session?game=g1"]);
});

test("Enter on Play Again or Home navigates without the drill event", () => {
  const order: string[] = [];
  pressPrimary((h) => void order.push(`push:${h}`), "/play", null, (n) => void order.push(`track:${n}`));
  assert.deepEqual(order, ["push:/play"]);
});
