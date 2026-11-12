import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reviewFixture } from "@repo/contracts/http/fixtures/review";
import { ShareSnapshotV1 } from "@repo/db/json";
import { buildReviewSnapshot } from "@/lib/services/analysis/share-snapshot";
import { accuracyLine, resultLabel, shareFrames, shareMetaText, shareViewOf, startPlyOf } from "./share-view";

const done = () => reviewFixture("done");

describe("share view: what /r/<code> shows from the frozen snapshot", () => {
  it("replays every ply into placements, labels and grades", () => {
    const dto = done();
    const s = buildReviewSnapshot(dto, { showUsername: true });
    const frames = shareFrames(s);
    const plies = dto.moves.split(" ").length;
    assert.equal(frames.length, plies + 1);
    assert.equal(frames[0]!.label, null);
    assert.equal(frames[0]!.last, null);
    assert.match(frames[1]!.label!, /^\d+\.[A-Za-z]/);
    assert.ok(frames.every((f) => f.placement.split("/").length === 8));
    // grades come from the snapshot's j string, one per ply
    const graded = frames.slice(1).filter((f) => f.q !== null).length;
    assert.equal(graded, [...s.j].filter((c) => c !== ".").length);
  });

  it("opens on the key moment with the engine's arrow, sharer first", () => {
    const dto = done();
    const s = buildReviewSnapshot(dto, { showUsername: true });
    const view = shareViewOf(s);
    assert.ok(s.moment, "the done fixture has a card moment");
    assert.equal(view.startIndex, s.moment.ply + 1);
    assert.deepEqual(view.moment?.arrow, s.moment.arrow);
    assert.equal(view.orientation, dto.you);
    assert.equal(view.title.split(" vs ")[0], dto.players[dto.you].name);
    assert.equal(view.players[dto.you].sharer, true);
  });

  it("follows the snapshot's masking: never a name it does not carry", () => {
    const dto = done();
    const s = buildReviewSnapshot(dto, { showUsername: false });
    const view = shareViewOf(s);
    const sharer = dto.players[dto.you].name;
    assert.ok(!view.title.includes(sharer));
    assert.ok(view.title.startsWith("A Replay Chess player"));
    assert.ok(!JSON.stringify(view).includes(sharer));
    assert.ok(!JSON.stringify(view).includes(dto.ref));
  });

  it("falls back to the final position without a moment, and stops at a move that does not replay", () => {
    const s = ShareSnapshotV1.parse({ ...buildReviewSnapshot(done(), { showUsername: true }), moment: null });
    const view = shareViewOf(s);
    assert.equal(view.moment, null);
    assert.equal(view.startIndex, view.frames.length - 1);
    const broken = { ...s, moves: "e2e4 e7e5 a1a8" , startFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", j: "..." };
    assert.equal(shareFrames(broken).length, 3);
  });

  it("labels: results, accuracy, the ply offset of a FEN, the metadata text", () => {
    assert.equal(resultLabel("1-0"), "1–0");
    assert.equal(resultLabel("½-½"), "½–½");
    assert.equal(startPlyOf("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"), 0);
    assert.equal(startPlyOf("r3kb1r/p2nqppp/5n2/1B2p1B1/4P3/1Q6/PPP2PPP/R3K2R w KQkq - 1 12"), 22);
    assert.equal(startPlyOf("8/8/8/8/8/8/8/8 b - - 0 10"), 19);
    assert.equal(accuracyLine({ you: 85, opp: 89 }), "Accuracy 85 · opponent 89");
    assert.equal(accuracyLine({ you: 85, opp: null }), "Accuracy 85");
    assert.equal(accuracyLine({ you: null, opp: null }), null);
    const meta = shareMetaText(shareViewOf(buildReviewSnapshot(done(), { showUsername: true })));
    assert.match(meta.title, / vs .* · Game Review$/);
    const v = shareViewOf(buildReviewSnapshot(done(), { showUsername: true }));
    assert.equal(v.meta, `${done().game.tc.label} · ${done().game.endLabel}`, "the end label carries the result once");
    const bare = shareViewOf(ShareSnapshotV1.parse({ ...buildReviewSnapshot(done(), { showUsername: true }), endLabel: "" }));
    assert.equal(bare.meta, `${done().game.tc.label} · 0–1`);
    assert.match(meta.description, /Accuracy \d+/);
  });
});
