import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GameRowDTO, GamesListResponse } from "@repo/contracts/http/games";
import { gameRowFixtures } from "@repo/contracts/http/fixtures/review";
import {
  asideHeading,
  asideNote,
  asideOverline,
  contextLine,
  finalPositionLabel,
  isAnalysed,
  openingLabel,
  patchRow,
  ratingDeltaLabel,
  resultTone,
  resultWord,
  rowNote,
} from "./rows";

const rows = gameRowFixtures();
const byStatus = (s: GameRowDTO["analysisStatus"]) => rows.find((r) => r.analysisStatus === s)!;

describe("archive rows", () => {
  it("the fixtures are valid G1 rows covering every analysis status", () => {
    GamesListResponse.parse(rows);
    assert.deepEqual(new Set(rows.map((r) => r.analysisStatus)), new Set(["none", "queued", "running", "done", "failed", "skipped"]));
  });

  it("result word and tone", () => {
    assert.equal(resultWord("win"), "WIN");
    assert.equal(resultWord("loss"), "LOSS");
    assert.equal(resultWord("draw"), "DRAW");
    assert.equal(resultTone("win"), "good");
    assert.equal(resultTone("loss"), "bad");
    assert.equal(resultTone("draw"), "neutral");
  });

  it("note per analysis status (P3-Q14: games before P3 say Not reviewed yet)", () => {
    const done = rows.find((r) => r.headline === "Missed Rxf5 · move 19")!;
    assert.deepEqual(rowNote(done), { text: "Missed Rxf5 · move 19", busy: false, kind: "headline" });
    assert.deepEqual(rowNote(byStatus("running")), { text: "Analysing", busy: true, kind: "analysing" });
    assert.deepEqual(rowNote(byStatus("queued")), { text: "Analysing", busy: true, kind: "analysing" });
    assert.deepEqual(rowNote(byStatus("failed")), { text: "Analysis paused", busy: false, kind: "paused" });
    assert.deepEqual(rowNote(byStatus("none")), { text: "Not reviewed yet", busy: false, kind: "not_reviewed" });
    assert.deepEqual(rowNote(byStatus("skipped")), { text: "Too short to review", busy: false, kind: "too_short" });
    assert.equal(rowNote({ analysisStatus: "done", headline: null, accuracy: 88 }).text, "Reviewed · accuracy 88");
    assert.equal(rowNote({ analysisStatus: "done", headline: null, accuracy: null }).text, "Reviewed");
  });

  it("opening, position and time control", () => {
    const game = rows.find((r) => r.headline === "Missed Rxf5 · move 19")!;
    assert.equal(openingLabel(game), "Two Knights Defense: Main Line · C59");
    assert.equal(contextLine(game), "Two Knights Defense: Main Line · C59 · Rapid 10+0");
    const legend = rows.find((r) => r.hasComparison)!;
    assert.equal(openingLabel(legend), "Opera Game, Paris 1858");
    assert.equal(contextLine({ opening: null, positionTitle: null, tc: { label: "Untimed", timeClass: "untimed" } }), "Untimed");
  });

  it("rating delta: an em dash until P9, a real minus sign", () => {
    assert.equal(ratingDeltaLabel(null), "—");
    assert.equal(ratingDeltaLabel(8), "+8");
    assert.equal(ratingDeltaLabel(-6), "−6");
    assert.equal(ratingDeltaLabel(0), "0");
  });

  it("aside copy follows the board (\"Replay Chess · Rapid 10+0\", \"vs tal_fan_77 · lost\")", () => {
    const game = rows.find((r) => r.headline === "Missed Rxf5 · move 19")!;
    assert.equal(asideOverline(game), "Replay Chess · Rapid 10+0");
    assert.equal(asideHeading(game), "vs tal_fan_77 · lost");
    assert.equal(asideNote(game), "Missed Rxf5 · move 19 · Two Knights Defense: Main Line · C59");
    assert.equal(finalPositionLabel(game), "Final position vs tal_fan_77");
  });

  it("isAnalysed only once done", () => {
    assert.ok(isAnalysed(byStatus("done")));
    for (const s of ["none", "queued", "running", "failed", "skipped"] as const) assert.ok(!isAnalysed(byStatus(s)));
  });

  it("patchRow keeps the identity when nothing changes", () => {
    const r = byStatus("running");
    assert.equal(patchRow(r, { analysisStatus: "running" }), r);
    const done = patchRow(r, { analysisStatus: "done", accuracy: 85, headline: "Missed Rxf5 · move 19", momentsCount: 3 });
    assert.notEqual(done, r);
    assert.equal(done.analysisStatus, "done");
    assert.equal(done.accuracy, 85);
    GameRowDTO.parse(done);
  });
});
