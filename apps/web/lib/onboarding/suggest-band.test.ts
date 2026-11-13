// Rating band suggestion (phase-04 plan §8.2, §12.1 suggest-band.test.ts).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RATING_BAND_SOURCE_RE } from "@repo/contracts/http/p04-plain";
import {
  BAND_MIDPOINT,
  LICHESS_OFFSET,
  MIN_GAMES,
  bandOfRating,
  levelChoice,
  parseBandSource,
  providerLabel,
  puzzleStart,
  suggestBand,
  timeClassLabel,
} from "./suggest-band";

const one = (rating: number, games = 50) => ({ rapid: { rating, games } });

describe("bands at each edge", () => {
  const cases: [number, string][] = [
    [799, "UNDER_800"],
    [800, "R800_1200"],
    [1199, "R800_1200"],
    [1200, "R1200_1600"],
    [1599, "R1200_1600"],
    [1600, "R1600_2000"],
    [1999, "R1600_2000"],
    [2000, "R2000_PLUS"],
    [100, "UNDER_800"],
  ];
  for (const [rating, band] of cases) {
    it(`${rating} → ${band}`, () => {
      assert.equal(bandOfRating(rating), band);
      assert.equal(suggestBand(one(rating), "chesscom")?.band, band);
    });
  }

  it("NEW_TO_CHESS is never suggested", () => {
    for (let r = 0; r <= 3500; r += 50) assert.notEqual(bandOfRating(r), "NEW_TO_CHESS");
  });
});

describe("which time class", () => {
  it("MIN_GAMES is 10: a class with 9 games loses to one with 10", () => {
    assert.equal(MIN_GAMES, 10);
    const s = suggestBand({ blitz: { rating: 1500, games: 9 }, rapid: { rating: 1000, games: 10 } }, "chesscom");
    assert.equal(s?.timeClass, "rapid");
  });

  it("the class with the most games wins among those with ≥ 10", () => {
    const s = suggestBand(
      { rapid: { rating: 1184, games: 120 }, blitz: { rating: 1032, games: 300 }, bullet: { rating: 871, games: 40 } },
      "chesscom",
    );
    assert.equal(s?.timeClass, "blitz");
    assert.equal(s?.displayRating, 1032);
    assert.equal(s?.band, "R800_1200");
  });

  it("rapid wins ties, then blitz, bullet, daily, classical", () => {
    assert.equal(suggestBand({ blitz: { rating: 1500, games: 40 }, rapid: { rating: 1000, games: 40 } }, "chesscom")?.timeClass, "rapid");
    assert.equal(suggestBand({ bullet: { rating: 1500, games: 40 }, blitz: { rating: 1000, games: 40 } }, "lichess")?.timeClass, "blitz");
    assert.equal(suggestBand({ classical: { rating: 1500, games: 40 }, daily: { rating: 1000, games: 40 } }, "lichess")?.timeClass, "daily");
  });

  it("falls back to any class with games when none has 10", () => {
    const s = suggestBand({ daily: { rating: 1300, games: 3 }, blitz: { rating: 900, games: 2 } }, "chesscom");
    assert.equal(s?.timeClass, "daily");
    assert.equal(s?.band, "R1200_1600");
  });

  it("no games at all → null; null ratings → null", () => {
    assert.equal(suggestBand({ rapid: { rating: 1200, games: 0 } }, "chesscom"), null);
    assert.equal(suggestBand({}, "lichess"), null);
    assert.equal(suggestBand(null, "chesscom"), null);
  });

  it("Chess.com never suggests classical (it has no such pool)", () => {
    assert.equal(suggestBand({ classical: { rating: 1500, games: 99 } }, "chesscom"), null);
  });
});

describe("Lichess offsets and the clamp", () => {
  it("offsets per class", () => {
    assert.deepEqual(LICHESS_OFFSET, { bullet: -50, blitz: -100, rapid: -100, classical: -100, daily: 0 });
    const blitz = suggestBand({ blitz: { rating: 1650, games: 100 } }, "lichess");
    assert.equal(blitz?.band, "R1200_1600", "1650 − 100 = 1550");
    assert.equal(blitz?.initialRating, 1550);
    assert.equal(blitz?.displayRating, 1650, "the banner shows the provider's own number");
    assert.equal(blitz?.source, "lichess:blitz");
    assert.equal(suggestBand({ bullet: { rating: 1240, games: 100 } }, "lichess")?.band, "R800_1200", "1240 − 50 = 1190");
  });

  it("the same number on Chess.com has no offset", () => {
    assert.equal(suggestBand({ blitz: { rating: 1650, games: 100 } }, "chesscom")?.band, "R1600_2000");
  });

  it("initialRating is clamped to 400…2400; a 2400+ player is R2000_PLUS", () => {
    const gm = suggestBand(one(2950), "chesscom");
    assert.equal(gm?.band, "R2000_PLUS");
    assert.equal(gm?.initialRating, 2400);
    assert.equal(suggestBand(one(250), "chesscom")?.initialRating, 400);
    assert.equal(suggestBand(one(1184), "chesscom")?.initialRating, 1184);
  });

  it("every source matches the contract regex", () => {
    for (const tc of ["rapid", "blitz", "bullet", "daily"] as const) {
      const s = suggestBand({ [tc]: { rating: 1200, games: 20 } }, "chesscom");
      assert.match(s!.source, RATING_BAND_SOURCE_RE);
    }
    for (const tc of ["rapid", "blitz", "bullet", "daily", "classical"] as const) {
      const s = suggestBand({ [tc]: { rating: 1200, games: 20 } }, "lichess");
      assert.match(s!.source, RATING_BAND_SOURCE_RE);
    }
  });
});

describe("puzzleStart and the saved choice", () => {
  it("puzzleStart(1184) = 1150 (the board copy)", () => {
    assert.equal(puzzleStart(1184), 1150);
    assert.equal(puzzleStart(1000), 1000);
    assert.equal(puzzleStart(1449), 1400);
  });

  it("keeping the suggestion saves its source and rating; changing it saves self + the midpoint", () => {
    const s = suggestBand(one(1184), "chesscom")!;
    assert.deepEqual(levelChoice("R800_1200", s), { ratingBand: "R800_1200", ratingBandSource: "chesscom:rapid", initialRating: 1184 });
    assert.deepEqual(levelChoice("R1200_1600", s), { ratingBand: "R1200_1600", ratingBandSource: "self", initialRating: 1400 });
    assert.deepEqual(levelChoice("NEW_TO_CHESS", null), { ratingBand: "NEW_TO_CHESS", ratingBandSource: "self", initialRating: 400 });
    for (const [band, mid] of Object.entries(BAND_MIDPOINT)) {
      assert.equal(levelChoice(band as keyof typeof BAND_MIDPOINT, null).initialRating, mid);
    }
  });

  it("parseBandSource", () => {
    assert.deepEqual(parseBandSource("chesscom:rapid"), { provider: "chesscom", timeClass: "rapid" });
    assert.deepEqual(parseBandSource("lichess:classical"), { provider: "lichess", timeClass: "classical" });
    assert.equal(parseBandSource("self"), null);
    assert.equal(parseBandSource(null), null);
    assert.equal(parseBandSource("chesscom:rapid; drop"), null);
  });

  it("labels", () => {
    assert.equal(timeClassLabel("rapid"), "Rapid");
    assert.equal(providerLabel("chesscom"), "Chess.com");
    assert.equal(providerLabel("lichess"), "Lichess");
  });
});
