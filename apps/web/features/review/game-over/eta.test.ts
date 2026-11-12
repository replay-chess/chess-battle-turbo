// The game-over ETA (phase-03 plan §5.8): the socket finish and the bot `complete` seed `etaSec` through @repo/db's
// finishAnalysisOf; A2 answers through the web's etaSecFor. The card switches from one to the other, so both must use
// the one model in @repo/contracts/internal/jobs (analysisEtaSec).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analysisEtaSec } from "@repo/contracts/internal/jobs";
import { finishAnalysisOf } from "@repo/db/live";
import { etaSecFor } from "@/lib/services/analysis/state";

describe("finish ETA = A2 ETA", () => {
  it("a just-queued job: the finish seed equals A2's answer at every queue depth and length", () => {
    for (const ahead of [0, 1, 2, 7, 30]) {
      for (const plies of [6, 17, 40, 61, 120, 300]) {
        const seed = finishAnalysisOf(
          { finished: true, extra: { analysisQueued: 1, analysisAhead: ahead, analysisStatusBefore: "NONE" } } as never,
          plies,
        )!;
        assert.equal(seed.review.etaSec, etaSecFor({ position: ahead, totalPlies: plies, gradedPlies: 0 }), `${ahead}/${plies}`);
        assert.equal(seed.review.etaSec, analysisEtaSec({ ahead, remainingPlies: plies }), `${ahead}/${plies}`);
      }
    }
  });

  it("A2 counts only the plies still to grade", () => {
    assert.equal(etaSecFor({ position: 0, totalPlies: 60, gradedPlies: 40 }), analysisEtaSec({ ahead: 0, remainingPlies: 20 }));
    assert.equal(etaSecFor({ position: 0, totalPlies: 10, gradedPlies: 30 }), analysisEtaSec({ ahead: 0, remainingPlies: 0 }));
  });
});
