// Typed `analysis:*`, `compare:ready` and `games:changed` payloads (phase-03 plan §5.11) for the UI packages (the
// demo routes simulate the socket with them), the worker and socket tests, and the size tests. `worst` fills every
// field to its longest realistic value, P2's convention for the game events (25-character refs, 3-digit plies,
// 4-digit queue positions, the headline and coach line at their schema limits with multi-byte characters, a full
// 8-ply progress frame of mate codes, 20 batch refs), which is what the byte budgets are asserted against.
import type { AnalysisEventName, AnalysisEventPayload } from "../analysis";

export const ANALYSIS_FIXTURE_GAME_REF = "cm3k9x2p10007slzpqa8hd4fe";

/** Typical payloads, as a running review of the design's GAME sees them. */
export function analysisEventFixtures(): { [N in AnalysisEventName]: AnalysisEventPayload<N> } {
  const gameRef = ANALYSIS_FIXTURE_GAME_REF;
  return {
    "analysis:queued": { v: 1, gameRef, position: 2, etaSec: 40 },
    "analysis:progress": {
      v: 1,
      gameRef,
      from: 32,
      gradedPlies: 34,
      totalPlies: 54,
      evals: [-137, -140],
      best: "d1c1 c4e3",
      j: "Ib",
      depthP50: 18,
    },
    "analysis:writing": { v: 1, gameRef },
    "analysis:done": {
      v: 1,
      gameRef,
      analysisVersion: 1,
      accuracy: 85,
      momentsCount: 3,
      headline: "Missed Rxf5 · move 19",
      coachLine: "The game turned on move 19, when Qd2 missed Rxf5.",
      isClean: false,
      bank: null,
      // P5: the design's three moments are all in the bank; 4 due today.
      bankAdded: { count: 3, plies: [24, 36, 46] },
      bankDue: 4,
    },
    "analysis:failed": {
      v: 1,
      gameRef,
      gradedPlies: 20,
      totalPlies: 54,
      failedAtPly: 20,
      retryable: true,
      retryAt: "2026-11-09T18:45:10.000Z",
      code: "engine_failed",
    },
    "analysis:batch": {
      v: 1,
      done: 3,
      failed: 0,
      queued: 12,
      refs: [gameRef, "cm3k9xq7r0009slzpw2e5bn1k", "cm3kb2v4d000bslzp6q1m8r3t"],
      bankAdded: 5,
      bankDue: 6,
    },
    "compare:ready": { v: 1, gameRef: "cm3kb2v4d000bslzp6q1m8r3t", status: "ready" },
    "games:changed": { v: 1, gameRef },
  };
}

/** The largest payload each event can carry in practice (the budget tests serialise these). */
export function worstAnalysisEventFixtures(): { [N in AnalysisEventName]: AnalysisEventPayload<N> } {
  const gameRef = ANALYSIS_FIXTURE_GAME_REF;
  const refs = Array.from({ length: 20 }, (_, i) => `cm3k9x2p1${String(i).padStart(4, "0")}slzpqa8hd4fe`);
  return {
    "analysis:queued": { v: 1, gameRef, position: 9_999, etaSec: 99_999 },
    "analysis:progress": {
      v: 1,
      gameRef,
      from: 190,
      gradedPlies: 198,
      totalPlies: 199,
      // The schema's maximum of nine evals, all mate codes or ±9999 (the widest values).
      evals: [-29_999, 29_998, -9_999, 9_999, -29_997, 29_996, -9_998, 9_997, -29_995],
      best: "e7e8q a7a8n h2h1r b2b1b g7g8q d7d8n c2c1r f7f8b",
      j: "BGbEgkFX",
      depthP50: 99,
    },
    "analysis:writing": { v: 1, gameRef, at: 8, of: 8 },
    "analysis:done": {
      v: 1,
      gameRef,
      analysisVersion: 99,
      accuracy: 100,
      momentsCount: 3,
      // 80 characters, the archive note's limit.
      headline: "Left Kasparov's path · move 125 · dropped a knight after the long forced lines …",
      // 160 characters, the game-over card's limit.
      coachLine:
        "The game turned on move 125, when Rxd4 missed Qxe7+, which wins the queen; after that the rook ending was lost and the last chances went with it in that ending.",
      isClean: false,
      bank: null,
      // P5: the most a frame can carry: four 4-digit plies (ReviewBank's limit) and a 5-digit due count.
      bankAdded: { count: 4, plies: [1_196, 1_197, 1_198, 1_199] },
      bankDue: 99_999,
    },
    "analysis:failed": {
      v: 1,
      gameRef,
      gradedPlies: 198,
      totalPlies: 199,
      failedAtPly: 198,
      retryable: true,
      retryAt: "2026-11-09T18:45:10.000Z",
      code: "worker_stalled",
    },
    "analysis:batch": { v: 1, done: 20, failed: 20, queued: 9_999, refs, bankAdded: 9_999, bankDue: 99_999 },
    "compare:ready": { v: 1, gameRef, status: "failed" },
    "games:changed": { v: 1, gameRef },
  };
}
