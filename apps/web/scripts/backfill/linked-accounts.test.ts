import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { countryCodeOf, linkFromProfile, ratingsFromProfile, type LegacyProfileRow } from "./linked-accounts";

function profile(overrides: Partial<LegacyProfileRow> = {}): LegacyProfileRow {
  return {
    id: 7n,
    userId: 42n,
    chessComHandle: "KnightOwl_88",
    displayName: "Sam Rivera",
    avatar: "https://images.chesscomfiles.com/uploads/v1/user/1.png",
    title: null,
    country: "https://api.chess.com/pub/country/US",
    joined: new Date("2019-03-14T00:00:00Z"),
    createdAt: new Date("2025-06-01T08:00:00Z"),
    rapidRating: 1184,
    rapidBestRating: 1243,
    rapidWins: 160,
    rapidLosses: 141,
    rapidDraws: 11,
    blitzRating: 1032,
    blitzBestRating: 1101,
    blitzWins: 70,
    blitzLosses: 66,
    blitzDraws: 5,
    bulletRating: 871,
    bulletBestRating: 902,
    bulletWins: 13,
    bulletLosses: 13,
    bulletDraws: 1,
    dailyRating: null,
    dailyBestRating: null,
    dailyWins: null,
    dailyLosses: null,
    dailyDraws: null,
    ...overrides,
  };
}

describe("B5 linkFromProfile", () => {
  it("maps the design profile to the V3OnbPreview values (rapid 1184, 480 rated games)", () => {
    const m = linkFromProfile(profile());
    assert.ok(m.ok);
    assert.deepEqual(m.link, {
      userId: "42",
      externalId: "knightowl_88",
      username: "KnightOwl_88",
      usernameLower: "knightowl_88",
      displayName: "Sam Rivera",
      avatarUrl: "https://images.chesscomfiles.com/uploads/v1/user/1.png",
      countryCode: "US",
      title: null,
      joinedAt: "2019-03-14T00:00:00.000Z",
      ratings: {
        v: 1,
        rapid: { rating: 1184, best: 1243, games: 312 },
        blitz: { rating: 1032, best: 1101, games: 141 },
        bullet: { rating: 871, best: 902, games: 27 },
      },
      totalRatedGames: 480,
      linkedAt: "2025-06-01T08:00:00.000Z",
    });
  });

  it("drops pools without a valid rating, keeps a missing best as null, counts null results as 0", () => {
    const { ratings, totalRatedGames } = ratingsFromProfile(
      profile({
        rapidRating: null,
        blitzBestRating: null,
        blitzWins: null,
        bulletRating: 5000,
        dailyRating: 1500,
        dailyBestRating: -3,
        dailyWins: 2,
        dailyLosses: null,
        dailyDraws: 0,
      }),
    );
    assert.deepEqual(ratings, { v: 1, blitz: { rating: 1032, best: null, games: 71 }, daily: { rating: 1500, best: null, games: 2 } });
    assert.equal(totalRatedGames, 73);
    const none = ratingsFromProfile(profile({ rapidRating: null, blitzRating: null, bulletRating: null }));
    assert.deepEqual(none, { ratings: { v: 1 }, totalRatedGames: null });
  });

  it("cleans display fields to the column limits", () => {
    const m = linkFromProfile(
      profile({
        chessComHandle: "  Some-User_1  ",
        displayName: `  ${"x".repeat(100)} `,
        avatar: "http://insecure.example/a.png",
        title: " gm ",
        country: "XE",
        joined: null,
      }),
    );
    assert.ok(m.ok);
    assert.equal(m.link.username, "Some-User_1");
    assert.equal(m.link.usernameLower, "some-user_1");
    assert.equal(m.link.displayName!.length, 80);
    assert.equal(m.link.avatarUrl, null);
    assert.equal(m.link.title, "GM");
    assert.equal(m.link.countryCode, "XE");
    assert.equal(m.link.joinedAt, null);
    const blank = linkFromProfile(profile({ displayName: "   ", title: "CANDIDATE", avatar: `https://x/${"a".repeat(300)}` }));
    assert.ok(blank.ok);
    assert.deepEqual([blank.link.displayName, blank.link.title, blank.link.avatarUrl], [null, null, null]);
  });

  it("skips handles that are not Chess.com usernames", () => {
    for (const h of ["ab", "has space", "x".repeat(26), "émile", ""]) {
      assert.deepEqual(linkFromProfile(profile({ chessComHandle: h })), { ok: false, reason: "invalid_handle" }, h);
    }
  });

  it("reads country codes from a URL or a stored code only", () => {
    assert.equal(countryCodeOf("https://api.chess.com/pub/country/in"), "IN");
    assert.equal(countryCodeOf("us"), "US");
    assert.equal(countryCodeOf("https://api.chess.com/pub/country/USA"), null);
    assert.equal(countryCodeOf("United States"), null);
    assert.equal(countryCodeOf(null), null);
    assert.equal(countryCodeOf("  "), null);
  });
});
