import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SHARE_CODE_RE, ShareCode, buildShareSnapshot, parseShareSnapshot, type ShareSnapshotV1 } from "./share";

function snapshot(over: Partial<ShareSnapshotV1> = {}): ShareSnapshotV1 {
  return {
    v: 1,
    kind: "review",
    players: { w: { name: "knightowl_88", rating: 1540, isYou: true }, b: { name: "tal_fan_77", rating: 1580, isYou: false } },
    result: "0-1",
    endLabel: "Black won by resignation",
    tcLabel: "Rapid 10+0",
    playedOn: "2026-11-02",
    startFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    moves: "e2e4 e7e5 g1f3",
    san: "e4 e5 Nf3",
    j: "666",
    evals: [20, 25, 18, 30],
    accuracy: { you: 81.4, opp: 88.2 },
    moment: { ply: 40, playedSan: "Qd2", bestSan: "Rxf5", judgement: 12, caption: "Rxf5 was winning.", arrow: ["f1", "f5"] },
    summary: ["You were better out of the opening."],
    gradingVersion: 1,
    ...over,
  };
}

describe("ShareSnapshotV1", () => {
  it("accepts a review snapshot, with or without a moment", () => {
    assert.equal(buildShareSnapshot(snapshot()).moment?.bestSan, "Rxf5");
    assert.equal(buildShareSnapshot(snapshot({ moment: null })).moment, null);
  });

  it("keeps the date only and rejects a timestamp (privacy, plan 11.3)", () => {
    assert.throws(() => buildShareSnapshot(snapshot({ playedOn: "2026-11-02T10:22:00Z" })));
  });

  it("rejects a bad arrow square, a 5th summary line and an unknown kind", () => {
    assert.throws(() => buildShareSnapshot(snapshot({ moment: { ...snapshot().moment!, arrow: ["f1", "f9"] } })));
    assert.throws(() => buildShareSnapshot(snapshot({ summary: ["a", "b", "c", "d", "e"] })));
    assert.throws(() => buildShareSnapshot({ ...snapshot(), kind: "position" as "review" }));
  });

  it("parseShareSnapshot is tolerant", () => {
    assert.equal(parseShareSnapshot(null), null);
    assert.equal(parseShareSnapshot({ v: 1, kind: "review" }), null);
    assert.equal(parseShareSnapshot(snapshot())?.players.b.name, "tal_fan_77");
  });
});

describe("share codes", () => {
  it("are 8 chars of lowercase Crockford base32", () => {
    assert.ok(SHARE_CODE_RE.test("8kq2xh4m"));
    for (const bad of ["8kq2xh4", "8kq2xh4mm", "8KQ2XH4M", "8kq2xh4i", "8kq2xh4l", "8kq2xh4o", "8kq2xh4u"]) {
      assert.equal(ShareCode.safeParse(bad).success, false, bad);
    }
  });
});
