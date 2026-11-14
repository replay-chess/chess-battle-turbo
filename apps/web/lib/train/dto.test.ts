// Every Train DTO the services build parses with its contract schema (phase-05 plan §12.1 dto.test.ts): bank rows
// (strict: no solution), runner items (bank and puzzle), due previews, the session summary, Home's Continue, the
// badges and the labels in the member's zone.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HomeContinue } from "@repo/contracts/http/home";
import { BankRow, Badges, DuePreview, SessionSummary, TrainItem } from "@repo/contracts/http/train";
import { badgesFrom } from "./badges.server";
import { bankRowOf, itemKindDb, itemKindWire, judgementWire, lastMoveOf, phaseWire, positionAfter, sanOf, trainItemOf } from "./dto.server";
import { duePreviewOf } from "./today.server";
import { summaryOf, type SessionRow } from "./sessions.server";
import { continueOf } from "../home/home.server";
import { loadTrainStateFromRows } from "./test-state";
import { cardRow, GAME_REF, MEMBER_FEN, NOW, PRE_SETUP_FEN } from "./test-rows";

describe("Train DTOs", () => {
  it("wire enums and board helpers", () => {
    assert.equal(judgementWire("BLUNDER"), "blunder");
    assert.equal(judgementWire("MISS"), "miss");
    assert.equal(phaseWire("ENDGAME"), "endgame");
    assert.equal(itemKindWire(itemKindDb("review_position")), "review_position");
    assert.equal(itemKindDb("puzzle"), "LICHESS_PUZZLE");
    assert.deepEqual(lastMoveOf("d6g3"), ["d6", "g3"]);
    assert.equal(lastMoveOf(null), null);
    assert.equal(positionAfter(PRE_SETUP_FEN, "d6g3"), MEMBER_FEN);
    assert.equal(sanOf(MEMBER_FEN, "f1f5"), "Rxf5");
  });

  it("a bank row: strict (no solution or best move), the position the member moves in, labels in the zone", () => {
    const row = bankRowOf(cardRow(), NOW, "UTC")!;
    BankRow.parse(row);
    assert.equal(row.fen, MEMBER_FEN);
    assert.deepEqual(row.lastMove, ["d6", "g3"]);
    assert.equal(row.playedSan, "Qd2");
    assert.equal(row.playedAtLabel, "today");
    assert.equal(row.isDue, true);
    assert.equal(row.nextLabel, null);
    assert.equal(row.gameRef, GAME_REF);
    assert.equal(row.gamePly, 36);
    assert.equal(JSON.stringify(row).includes("f1f5"), false, "the answer never reaches the bank list");
    const later = bankRowOf(cardRow({ due: new Date("2026-11-14T08:00:00.000Z") }), NOW, "UTC")!;
    assert.equal(later.isDue, false);
    assert.equal(later.nextLabel, "Sat");
    const skipped = bankRowOf(cardRow({ suspendedUntil: new Date("2026-11-13T08:00:00.000Z") }), NOW, "UTC")!;
    assert.deepEqual([skipped.isDue, skipped.skippedToday, skipped.nextLabel], [false, true, "Tomorrow"]);
    assert.equal(bankRowOf(cardRow({ gameRef: null }), NOW, "UTC"), null, "a row whose game is gone is left out");
  });

  it("a bank runner item: solution, coach texts, the real intervals and the after-Again ones", () => {
    const item = trainItemOf({ itemId: "i1", pass: 1, scheduled: true, source: { kind: "bank", card: cardRow() } }, NOW, "UTC", { timeZone: "UTC" });
    TrainItem.parse(item);
    assert.deepEqual(item.solution, ["f1f5"]);
    assert.deepEqual(item.setup, []);
    assert.equal(item.context!.playedSan, "Qd2");
    assert.ok(item.preview && item.previewAfterAgain);
    assert.equal(item.cardReps, 2);
    const practice = trainItemOf({ itemId: "i1", pass: 1, scheduled: false, source: { kind: "bank", card: cardRow() } }, NOW, "UTC", { timeZone: "UTC" });
    assert.equal(practice.preview, null);
    assert.equal(practice.previewAfterAgain, null);
    const pass2 = trainItemOf({ itemId: "i1b", pass: 2, scheduled: true, source: { kind: "bank", card: cardRow() } }, NOW, "UTC", { timeZone: "UTC" });
    assert.ok(pass2.preview);
    assert.equal(pass2.previewAfterAgain, null, "a pass-2 copy is never re-queued");
  });

  it("a puzzle item from a shard snapshot: Lichess FEN + setup, the solver's orientation, a new card's previews", () => {
    // Lichess: the setup move is the opponent's; here Black plays Bg3 and White (the solver) answers Rxf5.
    const item = trainItemOf(
      { itemId: "i1", pass: 1, scheduled: true, source: { kind: "puzzle", card: null, snapshot: ["00abc", PRE_SETUP_FEN, "d6g3 f1f5", 1512, "hangingPiece"] } },
      NOW,
      "UTC",
      { timeZone: "UTC" },
    );
    TrainItem.parse(item);
    assert.equal(item.kind, "puzzle");
    assert.equal(item.fen, PRE_SETUP_FEN);
    assert.deepEqual(item.setup, ["d6g3"]);
    assert.deepEqual(item.solution, ["f1f5"]);
    assert.equal(item.orient, "w");
    assert.equal(item.rating, 1512);
    assert.equal(item.cardRef, null);
    assert.equal(item.cardReps, null);
    assert.equal(item.preview!.again.label, "< 10 min");
  });

  it("a due preview's accessible name", () => {
    const p = duePreviewOf({ itemKey: "m_card00000001", theme: "hangingPiece", fen: PRE_SETUP_FEN, setupUci: "d6g3", color: "w", lastOpponentName: "tal_fan_77", moveNumber: 19 });
    DuePreview.parse(p);
    assert.equal(p.label, "Due: loose piece vs tal_fan_77, move 19");
    assert.equal(p.fen, MEMBER_FEN);
  });

  it("badges: the capped due count; yesterday's counters do not count today", () => {
    const facts = { r: 7, n: 6, p: { cap: 10, npd: 5, dsh: 4 }, d: { day: "2026-11-12", br: 4, ni: 1 } };
    assert.deepEqual(Badges.parse(badgesFrom(facts, "UTC", NOW)), { bankDue: 6, trainDot: true });
    assert.deepEqual(badgesFrom({ ...facts, d: { day: "2026-11-11", br: 10, ni: 5 } }, "UTC", NOW), { bankDue: 10, trainDot: true });
    assert.deepEqual(badgesFrom(null, "UTC", NOW), { bankDue: 0, trainDot: false });
    assert.deepEqual(badgesFrom(JSON.stringify({ r: 0, n: 0, p: null, d: null }), "Not/AZone", NOW), { bankDue: 0, trainDot: false });
  });

  it("a session summary parses, with the grade table, the themes and the perfect variant", () => {
    const row: SessionRow = {
      id: 1n,
      referenceId: "cm5t9s3ss0001slzpbankdrl1",
      kind: "BANK",
      status: "COMPLETED",
      source: "hub",
      filterKey: "x",
      theme: null,
      size: 3,
      mix: false,
      countsTowardCap: true,
      items: { v: 1, items: [1, 2, 3].map((i) => ({ id: `i${i}`, key: `m_k${i}`, kind: "MISTAKE", pass: 1 })) },
      day: "2026-11-12",
      startedAt: NOW,
      endedAt: NOW,
    };
    const attempt = (itemId: string, grade: string, firstTry: boolean, sd: number) => ({
      itemId,
      grade,
      solved: true,
      firstTry,
      hintsUsed: 0,
      wrongTries: 0,
      solutionShown: false,
      theme: "fork",
      deck: "BANK",
      scheduledDays: sd,
      ratingBefore: null,
      ratingAfter: null,
    });
    const state = loadTrainStateFromRows(NOW);
    const s = summaryOf(row, [attempt("i1", "GOOD", true, 4), attempt("i2", "GOOD", true, 4), attempt("i3", "EASY", true, 9)], [], state);
    SessionSummary.parse(s);
    assert.equal(s.variant, "perfect");
    assert.deepEqual(s.stats, { solved: 3, total: 3, firstTry: 3, withHint: 0, skipped: 0 });
    assert.deepEqual(s.grades.map((g) => [g.grade, g.n, g.intervalLabel]), [["again", 0, "< 10 min"], ["hard", 0, "2 days"], ["good", 2, "4 days"], ["easy", 1, "9 days"]]);
    assert.deepEqual(s.themes, [{ key: "fork", label: "Fork", n: 3 }]);
    assert.equal(s.graded, 3);
    assert.equal(s.next.lesson, null);
  });

  it("Home's Continue: the first key moment's position, the analysing and clean variants", () => {
    const base = {
      ref: GAME_REF,
      color: "w",
      result: "LOSS",
      endedAt: NOW,
      opponentName: "tal_fan_77",
      opponentRating: 1203,
      momentsCount: 3,
      accuracy: 78.4,
      analysisStatus: "DONE",
      plyCount: 4,
      openingName: "Two Knights Defence",
      startingFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      startPly: 0,
      moves: "e2e4 e7e5 g1f3 b8c6",
      gradedPlies: 4,
      totalPlies: 4,
      kPly: 2,
    };
    const c = continueOf([base], NOW, "UTC")!;
    HomeContinue.parse(c);
    assert.equal(c.kind, "moments");
    assert.equal(c.fen, "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2");
    assert.deepEqual(c.lastMove, ["e7", "e5"]);
    assert.equal(c.endMove, 2);
    assert.equal(c.accuracy, 78);
    assert.equal(c.result, "loss");
    assert.equal(continueOf([{ ...base, analysisStatus: "RUNNING", gradedPlies: 1 }], NOW, "UTC")!.kind, "analysing");
    assert.equal(continueOf([{ ...base, momentsCount: 0 }], NOW, "UTC")!.kind, "clean");
    assert.equal(continueOf([{ ...base, analysisStatus: "NONE" }], NOW, "UTC"), null);
  });
});
