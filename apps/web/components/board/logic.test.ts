import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsePlacement } from "./geometry";
import { decideClick, decideDrop, drawColor, toggleArrow, toggleMark, type InputContext } from "./logic";
import type { Side, Sq } from "./types";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/** Tiny dests table for the cases (the board never computes chess rules itself). */
function ctxFor(
  fen: string,
  {
    mover = "w",
    premover = null,
    dests = {},
    premoveDests,
    premove = null,
    canReportLocked = true,
  }: {
    mover?: Side | null;
    premover?: Side | null;
    dests?: Partial<Record<Sq, Sq[]>>;
    premoveDests?: Partial<Record<Sq, Sq[]>>;
    premove?: { from: Sq; to: Sq } | null;
    canReportLocked?: boolean;
  } = {},
): InputContext {
  return {
    placement: parsePlacement(fen),
    mover,
    premover,
    dests: (sq) => dests[sq] ?? [],
    premoveDests: premoveDests ? (sq) => premoveDests[sq] ?? [] : undefined,
    premove,
    canReportLocked,
  };
}

describe("click-click (§4.5.3 rule 3)", () => {
  const ctx = ctxFor(START, { dests: { e2: ["e3", "e4"], g1: ["f3", "h3"] } });

  it("selects a piece of the mover", () => {
    assert.deepEqual(decideClick(ctx, null, "e2"), { type: "select", sel: { sq: "e2", mode: "move" } });
  });

  it("ignores the other side's pieces and empty squares with nothing selected", () => {
    assert.deepEqual(decideClick(ctx, null, "e7"), { type: "none" });
    assert.deepEqual(decideClick(ctx, null, "e4"), { type: "none" });
  });

  it("moves to a target", () => {
    assert.deepEqual(decideClick(ctx, { sq: "e2", mode: "move" }, "e4"), {
      type: "move",
      from: "e2",
      to: "e4",
      mode: "move",
      promotion: false,
    });
  });

  it("deselects on the selected piece and on an empty non-target", () => {
    assert.deepEqual(decideClick(ctx, { sq: "e2", mode: "move" }, "e2"), { type: "deselect" });
    assert.deepEqual(decideClick(ctx, { sq: "e2", mode: "move" }, "e5"), { type: "deselect" });
  });

  it("switches to another own piece", () => {
    assert.deepEqual(decideClick(ctx, { sq: "e2", mode: "move" }, "g1"), { type: "select", sel: { sq: "g1", mode: "move" } });
  });

  it("shakes on an enemy piece that is not a target", () => {
    assert.deepEqual(decideClick(ctx, { sq: "e2", mode: "move" }, "e7"), { type: "illegal", from: "e2", to: "e7" });
  });

  it("drops a stale selection whose piece is gone", () => {
    const after = ctxFor("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1", { dests: {} });
    assert.deepEqual(decideClick(after, { sq: "e2", mode: "move" }, "e3"), { type: "none" });
  });
});

describe("drag and drop (§4.5.3 rule 2)", () => {
  const ctx = ctxFor(START, { dests: { g1: ["f3", "h3"] } });
  const sel = { sq: "g1" as Sq, mode: "move" as const };

  it("moves on a target", () => {
    assert.equal(decideDrop(ctx, sel, "f3").type, "move");
  });

  it("is illegal anywhere else on the board", () => {
    assert.deepEqual(decideDrop(ctx, sel, "g4"), { type: "illegal", from: "g1", to: "g4" });
  });

  it("snaps back on its own square or outside the board", () => {
    assert.deepEqual(decideDrop(ctx, sel, "g1"), { type: "none" });
    assert.deepEqual(decideDrop(ctx, sel, null), { type: "none" });
  });
});

describe("promotion (§4.5.3 rule 4)", () => {
  it("flags a pawn move onto the last rank", () => {
    const ctx = ctxFor("8/1P3k2/8/8/8/8/8/4K3 w - - 0 1", { dests: { b7: ["b8"] } });
    const a = decideClick(ctx, { sq: "b7", mode: "move" }, "b8");
    assert.equal(a.type, "move");
    assert.equal(a.type === "move" && a.promotion, true);
  });
});

describe("premove (§4.5.3 rule 5)", () => {
  const ctx = ctxFor(START, {
    mover: null,
    premover: "w",
    premoveDests: { g1: ["f3", "h3", "e2"] },
  });

  it("selects the premover's pieces in premove mode", () => {
    assert.deepEqual(decideClick(ctx, null, "g1"), { type: "select", sel: { sq: "g1", mode: "premove" } });
  });

  it("queues a premove on a pseudo-legal target", () => {
    const a = decideClick(ctx, { sq: "g1", mode: "premove" }, "f3");
    assert.equal(a.type === "move" && a.mode, "premove");
  });

  it("cancels the queued premove with a click on its from-square", () => {
    const queued = ctxFor(START, { mover: null, premover: "w", premoveDests: {}, premove: { from: "g1", to: "f3" } });
    assert.deepEqual(decideClick(queued, null, "g1"), { type: "cancel-premove" });
  });

  it("turns a premove selection into a move selection when the turn arrives", () => {
    const mine = ctxFor(START, { mover: "w", dests: { g1: ["f3"] } });
    const a = decideClick(mine, { sq: "g1", mode: "premove" }, "f3");
    assert.equal(a.type === "move" && a.mode, "move");
  });

  it("needs premoveDests to premove", () => {
    const none = ctxFor(START, { mover: null, premover: "w" });
    assert.deepEqual(decideClick(none, null, "g1"), { type: "none" });
  });
});

describe("locked board (study)", () => {
  it("reports a press on a piece", () => {
    const ctx = ctxFor(START, { mover: null });
    assert.deepEqual(decideClick(ctx, null, "e2"), { type: "locked" });
    assert.deepEqual(decideClick(ctx, null, "e4"), { type: "none" });
  });

  it("stays silent without a handler", () => {
    const ctx = ctxFor(START, { mover: null, canReportLocked: false });
    assert.deepEqual(decideClick(ctx, null, "e2"), { type: "none" });
  });
});

describe("drawing (§4.5.3 rule 6)", () => {
  it("picks the colour from the modifiers", () => {
    assert.equal(drawColor({ shiftKey: false, altKey: false }), "green");
    assert.equal(drawColor({ shiftKey: true, altKey: false }), "red");
    assert.equal(drawColor({ shiftKey: false, altKey: true }), "blue");
  });

  it("toggles arrows: same colour removes, another colour replaces", () => {
    const one = toggleArrow([], { from: "e2", to: "e4", color: "green" });
    assert.equal(one.length, 1);
    assert.deepEqual(toggleArrow(one, { from: "e2", to: "e4", color: "green" }), []);
    assert.deepEqual(toggleArrow(one, { from: "e2", to: "e4", color: "red" }), [{ from: "e2", to: "e4", color: "red" }]);
  });

  it("toggles square marks", () => {
    const m = toggleMark({}, "e4", "green");
    assert.deepEqual(m, { e4: "green" });
    assert.deepEqual(toggleMark(m, "e4", "green"), {});
    assert.deepEqual(toggleMark(m, "e4", "red"), { e4: "red" });
  });
});
