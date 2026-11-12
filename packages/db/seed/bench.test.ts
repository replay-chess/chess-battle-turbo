// The throughput-bench seed (seed/bench.ts; plan §12.7 "enqueue 60 fixture games"; FIX-1): 60 distinct legal games
// averaging about 60 plies, the same on every machine, tagged so the backfill skips them.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { replayUci } from "@repo/chess-analysis/replay";
import { INITIAL_FEN } from "@repo/chess-analysis/board";
import { BENCH_GAMES, BENCH_SEED_TAG, BENCH_USER, benchFixtures, benchMoveLists, randomGame } from "./bench";
import { placeholderMember } from "./writer";

describe("bench seed", () => {
  it("60 distinct legal games of about 60 plies", () => {
    const lists = benchMoveLists();
    assert.equal(lists.length, BENCH_GAMES);
    for (const l of lists) assert.equal(replayUci(INITIAL_FEN, l).uci.length, l.length);
    assert.equal(new Set(lists.map((l) => l.join(" "))).size, BENCH_GAMES);
    const avg = lists.reduce((n, l) => n + l.length, 0) / lists.length;
    assert.ok(avg >= 55 && avg <= 60, `average ${avg}`);
  });

  it("is deterministic", () => {
    assert.deepEqual(randomGame(1_042, 60), randomGame(1_042, 60));
    assert.notDeepEqual(randomGame(1_042, 60), randomGame(1_043, 60));
  });

  it("builds NONE bot games of the synthetic bench member, tagged bench, with stable refs", () => {
    const f = benchFixtures(placeholderMember(BENCH_USER), null, 4);
    assert.equal(f.length, 4);
    for (const x of f) {
      assert.equal(x.game.analysisStatus, "NONE");
      assert.equal((x.game.gameData as Record<string, unknown>).p3Seed, BENCH_SEED_TAG);
    }
    assert.deepEqual(
      f.map((x) => x.game.ref),
      benchFixtures(placeholderMember(BENCH_USER), null, 4).map((x) => x.game.ref),
    );
  });
});
