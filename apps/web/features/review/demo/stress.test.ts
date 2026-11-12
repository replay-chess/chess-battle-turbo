// demo/stress.ts: the stress payloads are valid contract shapes, every move and line replays, and the names and
// move numbers stress the layout as testing X9 asks (20-character names, 120 plies, three-digit move numbers).
import assert from "node:assert/strict";
import { test } from "node:test";
import { ReviewCompleteView, ReviewDTO } from "@repo/contracts/http/review";
import { reviewPlies } from "../model";
import { lineOf } from "../moments";
import { STRESS_REVIEW_PLIES, stressComplete, stressReview } from "./stress";

test("the stress review parses as ReviewDTO for both colours and replays to the end", () => {
  for (const side of ["w", "b"] as const) {
    const dto = ReviewDTO.parse(stressReview(side));
    assert.equal(dto.you, side);
    const plies = reviewPlies(dto);
    assert.equal(plies.san.length, STRESS_REVIEW_PLIES);
    assert.ok(Math.floor((dto.game.startPly + STRESS_REVIEW_PLIES - 1) / 2) + 1 >= 100, "three-digit move numbers");
    assert.equal(dto.players.w.name.length, 20);
    assert.equal(dto.players.b.name.length, 20);
    assert.equal(dto.review!.moments.length, 3);
    for (const m of dto.review!.moments) {
      const before = plies.fens[m.ply]!;
      assert.equal(lineOf(before, m.line).length, m.line.split(" ").length, "the best line replays");
      assert.equal(lineOf(before, m.bestUci)[0]?.san, m.bestSan);
      assert.equal(plies.uci[m.ply], m.playedUci);
      const mover = (m.ply % 2 === 0) === (plies.startMover === "w") ? "w" : "b";
      assert.equal(mover, side, "moments are the viewer's moves");
    }
  }
});

test("the stress complete view parses and counts what it shows", () => {
  const v = ReviewCompleteView.parse(stressComplete());
  assert.equal(v.moments.length, 3);
  assert.equal(v.found, v.moments.filter((m) => m.result === "found" || m.result === "found_retry").length);
  assert.equal(v.header.opponentName.length, 20);
});
