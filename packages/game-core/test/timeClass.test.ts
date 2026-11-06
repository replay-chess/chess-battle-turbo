import assert from "node:assert/strict";
import { test } from "node:test";
import { DESIGN_TIME_CONTROLS, poolOf, tcLabel, timeClassOf, timeLabel, wireTimeClass } from "../src/rules/timeClass";
import { headerLeft, headerRight, describeMaterial, initialsOf } from "../src/rules/describe";
import { studySecondsFor } from "../src/rules/study";
import { INITIAL_FEN } from "../src/constants";

const tc = (initialSeconds: number, incrementSeconds = 0) => ({ initialSeconds, incrementSeconds });

test("the nine design time controls map to their pools", () => {
  const labels = DESIGN_TIME_CONTROLS.map(timeLabel);
  assert.deepEqual(labels, [
    "Bullet 1+0",
    "Bullet 2+1",
    "Blitz 3+0",
    "Blitz 3+2",
    "Blitz 5+0",
    "Blitz 5+3",
    "Rapid 10+0",
    "Rapid 15+10",
    "Rapid 30+0",
  ]);
  assert.equal(timeClassOf(tc(1800)), "CLASSICAL");
  assert.equal(poolOf("CLASSICAL"), "Rapid");
  assert.equal(wireTimeClass("CLASSICAL"), "classical");
});

test("band edges 179/180, 479/480, 1499/1500 and untimed", () => {
  assert.equal(timeClassOf(tc(179)), "BULLET");
  assert.equal(timeClassOf(tc(180)), "BLITZ");
  assert.equal(timeClassOf(tc(479)), "BLITZ");
  assert.equal(timeClassOf(tc(480)), "RAPID");
  assert.equal(timeClassOf(tc(1499)), "RAPID");
  assert.equal(timeClassOf(tc(1500)), "CLASSICAL");
  assert.equal(timeClassOf(tc(140, 1)), "BLITZ"); // 140 + 40 = 180
  assert.equal(timeClassOf(null), "UNTIMED");
  assert.equal(timeLabel(null), "Untimed");
  assert.equal(poolOf("UNTIMED"), null);
  assert.equal(tcLabel(tc(15)), "15s+0");
});

test("headers and small labels (plan 8.19, 4.8)", () => {
  assert.equal(headerLeft({ kind: "initial" }), "");
  assert.equal(headerLeft({ kind: "opening", eco: "C41", name: "Philidor Defense" }), "C41 · Philidor Defense");
  assert.equal(
    headerLeft({
      kind: "legend",
      eco: "C41",
      opening: "Philidor",
      white: "Morphy",
      black: "Duke Karl / Count Isouard",
      year: 1858,
    }),
    "C41 · Philidor · Morphy vs Duke Karl / Count Isouard 1858",
  );
  assert.equal(headerLeft({ kind: "endgame", moveNo: 41 }), "Endgame · move 41");
  assert.equal(headerRight({ mode: "ONLINE", tc: tc(300, 3), role: "player" }), "Blitz 5+3 · unrated");
  assert.equal(headerRight({ mode: "FRIEND", tc: tc(300, 3), role: "player" }), "Friend game · 5+3");
  assert.equal(headerRight({ mode: "BOT", tc: tc(600), role: "player", botElo: 1400 }), "vs Engine 1400 · unrated");
  assert.equal(headerRight({ mode: "ONLINE", tc: tc(300, 3), role: "spectator" }), "Watching · Blitz 5+3");
  assert.equal(headerRight({ mode: "FRIEND", tc: tc(300, 3), role: "player", rematch: true }), "Rematch · Blitz 5+3");
  assert.equal(describeMaterial("8/8/4k3/8/8/2K5/8/8 w - - 0 1"), "Only kings left");
  assert.equal(describeMaterial("8/8/4k3/8/8/2K5/8/5N2 w - - 0 1"), "King and knight vs king");
  assert.equal(describeMaterial("8/8/4kb2/8/8/2K5/8/8 w - - 0 1"), "King and bishop vs king");
  assert.equal(initialsOf("martin_k"), "MK");
  assert.equal(initialsOf("knightowl_88"), "KN");
  assert.equal(studySecondsFor(INITIAL_FEN), 0);
  assert.equal(studySecondsFor("r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3"), 30);
});

test("study rule ignores the move counters (same as @repo/db derive.ts)", () => {
  assert.equal(studySecondsFor("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 3 7"), 0);
});
