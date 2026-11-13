// Provider ratings → RatingsV1 buckets (phase-04 plan §6.4).
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { chessComRatings, lichessRatings } from "../ratings";

describe("ratings", () => {
  it("Chess.com: last rating, best and all-time games per class; chess960 left out", () => {
    const r = chessComRatings({
      chess_rapid: { last: { rating: 1184, date: 1 }, best: { rating: 1250, date: 1 }, record: { win: 200, loss: 180, draw: 20 } },
      chess_blitz: { last: { rating: 1032, date: 1 }, record: { win: 30, loss: 25, draw: 5 } },
      chess960_daily: { last: { rating: 1400, date: 1 }, record: { win: 1, loss: 1, draw: 1 } },
    });
    assert.deepEqual(r, {
      blitz: { rating: 1032, best: null, games: 60 },
      rapid: { rating: 1184, best: 1250, games: 400 },
    });
  });

  it("Lichess: ultraBullet folds into bullet, correspondence into daily; empty pools are dropped", () => {
    const r = lichessRatings({
      bullet: { games: 10, rating: 1400, rd: 60, prog: 0 },
      ultraBullet: { games: 40, rating: 1300, rd: 60, prog: 0 },
      blitz: { games: 120, rating: 1510.4, rd: 50, prog: 3 },
      rapid: { games: 0, rating: 1500, rd: 500, prog: 0, prov: true },
      classical: { games: 5, rating: 1600, rd: 90, prog: 0 },
      correspondence: { games: 2, rating: 1700, rd: 120, prog: 0, prov: true },
      puzzle: { games: 900, rating: 2000, rd: 70, prog: 0 },
      storm: { runs: 3, score: 20 },
    });
    assert.deepEqual(r, {
      bullet: { rating: 1300, best: null, games: 50 },
      blitz: { rating: 1510, best: null, games: 120 },
      classical: { rating: 1600, best: null, games: 5 },
      daily: { rating: 1700, best: null, games: 2 },
    });
    assert.deepEqual(lichessRatings(undefined), {});
    assert.deepEqual(lichessRatings({ bullet: { games: 3, rating: 1200 }, ultraBullet: { games: 3, rating: 1100 } }).bullet, {
      rating: 1200,
      best: null,
      games: 6,
    });
  });
});
