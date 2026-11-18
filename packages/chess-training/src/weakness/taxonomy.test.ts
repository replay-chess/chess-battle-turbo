// The weakness half of the theme taxonomy (phase-06 plan §8.6, §8.11, §8.12; TRN/src/themes.ts edits): every
// candidate is a Tier-1 tagger theme (CA TIER1_THEMES, recall-gated) or an rc: heuristic; labels are the plan's and
// fit the contracts; the Lichess matches; `rc:timePressure` is a known key that is never primary and has no shard bit.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeMate } from "@repo/chess-analysis/codec";
import { META_THEMES, RC_THEMES, TIER1_THEMES, tagErrorPly } from "@repo/chess-analysis/themes/index";
import { PatternKey } from "@repo/contracts/http/weakness";
import {
  isKnownTheme,
  isWeaknessCandidate,
  lichessMatch,
  primaryTheme,
  SHARD_THEME_BITS,
  themeBit,
  themeLabel,
  TIME_PRESSURE_THEME,
  WEAKNESS_CANDIDATES,
  weaknessLabel,
  weaknessNoun,
  weaknessPhaseNamed,
  weaknessPhrase,
  weaknessThemeInfo,
} from "../themes";

describe("weakness taxonomy", () => {
  it("candidates are recall-gated Tier-1 themes (no meta, phase or `mate`) and the rc: heuristics", () => {
    const tier1 = new Set(TIER1_THEMES);
    const rc = new Set<string>([...RC_THEMES, TIME_PRESSURE_THEME]);
    for (const key of WEAKNESS_CANDIDATES) {
      assert.ok(tier1.has(key) || rc.has(key), `${key} is neither Tier 1 nor rc:`);
      assert.ok(!META_THEMES.includes(key) && key !== "mate", key);
      assert.ok(isKnownTheme(key), key);
      assert.equal(PatternKey.safeParse(key).success, true, key);
    }
    for (const key of RC_THEMES) assert.ok(isWeaknessCandidate(key), key);
    for (const key of ["capturingDefender", "defensiveMove", "deflection", "mateIn4", "endgame", "opening", "mate", "advantage"]) {
      assert.equal(isWeaknessCandidate(key), false, key);
    }
  });

  it("labels: the plan's row labels, ≤ 40 characters", () => {
    const expected: Record<string, string> = {
      fork: "Missed forks",
      pin: "Missed pins",
      skewer: "Missed skewers",
      discoveredAttack: "Missed discovered attacks",
      hangingPiece: "Missed free pieces",
      trappedPiece: "Missed piece traps",
      capturingDefender: "Missed 'remove the defender'",
      backRankMate: "Missed back-rank mates",
      mateIn1: "Missed mate in 1",
      mateIn2: "Missed mate in 2",
      mateIn3: "Missed mate in 3",
      defensiveMove: "Missed threats",
      promotion: "Missed promotions",
      advancedPawn: "Missed advanced-pawn pushes",
      rookEndgame: "Rook endgames",
      "rc:recapture": "Missed recaptures",
      "rc:defendedTarget": "Taking defended pieces",
      "rc:pawnStructure": "Pawn structure damage",
      "rc:kingSafety": "King safety",
      "rc:development": "Slow development",
      "rc:missedThreat": "Missed threats",
      "rc:timePressure": "Time-pressure blunders",
    };
    for (const [key, label] of Object.entries(expected)) assert.equal(weaknessLabel(key), label, key);
    for (const key of WEAKNESS_CANDIDATES) assert.ok(weaknessLabel(key).length <= 40, key);
    assert.equal(weaknessLabel("bodenMate"), "Missed boden mate", "an unlisted key gets 'Missed {plural}'");
    assert.equal(weaknessThemeInfo("bodenMate").candidate, false);
  });

  it("regression: backrank-label-reversed — the detector mates the OPPONENT's back rank: 'Missed back-rank mates' (FIX-2)", () => {
    // White (the member) has Rd8# against a king boxed in by its own pawns and plays h3: the tagger's backRankMate row
    // is a mate the member missed, never the member's own back rank.
    const themes = tagErrorPly({
      fenBefore: "6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 30",
      bestLine: ["d1d8"],
      playedUci: "h2h3",
      refuteUci: null,
      evalBest: encodeMate("w", 1),
      phase: "ENDGAME",
      setupUci: null,
      setupCaptured: false,
    });
    assert.ok(themes.includes("backRankMate"), JSON.stringify(themes));
    assert.equal(weaknessLabel("backRankMate"), "Missed back-rank mates");
    assert.equal(weaknessPhrase("backRankMate"), "missed back-rank mates");
  });

  it("regression: headline-phrases — every candidate reads as a noun phrase in 'You lose most points to {phrase}' (FIX-2)", () => {
    const want: Record<string, string> = {
      "rc:recapture": "missed recaptures",
      promotion: "missed promotions",
      rookEndgame: "rook endgames",
      mateIn1: "missed mates in 1",
      "rc:kingSafety": "weakening your king's shelter",
      "rc:pawnStructure": "damaging your pawn structure",
      "rc:timePressure": "blunders with under a minute on your clock",
      hangingPiece: "missed free pieces",
    };
    for (const [key, phrase] of Object.entries(want)) assert.equal(weaknessPhrase(key), phrase, key);
    for (const key of WEAKNESS_CANDIDATES) {
      const p = weaknessPhrase(key);
      assert.match(p, /^[a-z]/, `${key}: lower-case in running text`);
      assert.ok(!/ first$|chances$/.test(p), `${key}: "${p}" reads as advice or a cause`);
    }
    // The endgame tags name their phase: no "rook endgames in the endgame".
    for (const key of ["rookEndgame", "pawnEndgame", "bishopEndgame", "knightEndgame", "queenEndgame", "queenRookEndgame"]) assert.equal(weaknessPhaseNamed(key), true, key);
    assert.equal(weaknessPhaseNamed("fork"), false);
  });

  it("regression: zero-own-noun — the zero-own copy's noun is the weakness's, never P5's puzzle label (FIX-2)", () => {
    assert.equal(weaknessNoun("hangingPiece"), "free-piece");
    assert.equal(weaknessNoun("trappedPiece"), "piece-trap");
    assert.equal(weaknessNoun("fork"), "fork");
    for (const key of WEAKNESS_CANDIDATES) assert.ok(!/loose/i.test(weaknessNoun(key)), key);
  });

  it("Lichess matches are shard themes (or null)", () => {
    assert.equal(lichessMatch("fork"), "fork");
    assert.equal(lichessMatch("hangingPiece"), "hangingPiece");
    assert.equal(lichessMatch("rc:defendedTarget"), "hangingPiece");
    assert.equal(lichessMatch("rc:missedThreat"), "defensiveMove");
    assert.equal(lichessMatch("rc:kingSafety"), "kingsideAttack");
    assert.equal(lichessMatch("rc:pawnStructure"), null);
    assert.equal(lichessMatch("rc:timePressure"), null);
    for (const key of WEAKNESS_CANDIDATES) {
      const m = lichessMatch(key);
      if (m !== null) assert.ok(SHARD_THEME_BITS.includes(m), `${key} → ${m} has no shard`);
    }
  });

  it("rc:timePressure is a known tag, never primary, with no shard bit", () => {
    assert.equal(isKnownTheme(TIME_PRESSURE_THEME), true);
    assert.equal(themeLabel(TIME_PRESSURE_THEME), "Time pressure");
    assert.equal(themeBit(TIME_PRESSURE_THEME), null);
    assert.equal(primaryTheme([TIME_PRESSURE_THEME, "rc:development"]), "rc:development");
    assert.equal(primaryTheme([TIME_PRESSURE_THEME, "fork"]), "fork");
    assert.equal(primaryTheme([TIME_PRESSURE_THEME]), null);
  });
});
