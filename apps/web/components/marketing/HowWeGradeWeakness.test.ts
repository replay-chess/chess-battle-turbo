// /how-we-grade#weakness (phase-06 plan §8.1; WP7): the text is built from the engine's constants and the committed
// baseline's metadata, so a product change moves the page with it. These tests pin the wording to those values.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_BASELINE_ID, loadBaseline } from "@repo/chess-training/baselines/load";
import * as K from "@repo/chess-training/weakness/constants";
import { tabOfAnchor } from "../../app/how-we-grade/content";
import { WEAKNESS_ANCHOR, bandExample, baselineLine, weaknessSections } from "./HowWeGradeWeakness";

const text = () => weaknessSections().flatMap((s) => s.paragraphs).join("\n");

describe("how we grade: the Weakness Profile section", () => {
  it("lives under #weakness, which opens its tab; every section anchor does too", () => {
    assert.equal(WEAKNESS_ANCHOR, "weakness");
    assert.equal(tabOfAnchor(WEAKNESS_ANCHOR), "weakness");
    for (const s of weaknessSections()) assert.equal(tabOfAnchor(s.id), "weakness", s.id);
  });

  it("states the thresholds the engine uses", () => {
    const t = text();
    assert.ok(t.includes(`A profile needs ${K.GAMES_REQUIRED} analysed games`));
    assert.ok(t.includes(`From ${K.PRELIMINARY_FROM} games`));
    assert.ok(t.includes(`at least ${K.MIN_EVENTS} times in at least ${K.MIN_GAMES_WITH} different games, over at least ${K.MIN_MOVES} of your moves`));
    assert.ok(t.includes(`at least ${K.RATIO_MIN} times as often as in your rating band, and by a margin that is not chance`));
    assert.ok(t.includes(`no more than ${Math.round(K.FAMILY_ALPHA * 100)}% of the time`));
    assert.ok(t.includes(`at most ${K.EVENTS_PER_GAME_CAP} times per game in this test, for you and for your band alike`));
    assert.ok(t.includes("Time pressure is the one exception: it is counted in full, for you and for your band."), "the cap excepts time pressure");
    assert.ok(t.includes(`the top ${K.TOP_N}, and up to ${K.TOP_N + K.MORE_N} with See all`));
    assert.ok(t.includes(`under ${K.TIME_PRESSURE_MS / 1000} seconds on your clock`));
    assert.ok(t.includes(`at least ${K.MIN_MOVES_TP} such moves`));
    assert.ok(t.includes(`your last ${K.TREND_RECENT_DAYS} days with the ${K.TREND_PRIOR_DAYS} days before them`));
    assert.ok(t.includes(`at least ${K.TREND_MIN_MOVES.toLocaleString("en-US")} of your moves (for time pressure, at least ${K.TREND_MIN_MOVES_TP} moves with under ${K.TIME_PRESSURE_MS / 1000} seconds left)`));
    assert.ok(t.includes(`by at least ${K.TREND_RATIO} times (either way) and the change is clear at the ${Math.round(K.TREND_ALPHA * 100)}% level`));
    assert.ok(t.includes(`once every ${K.RECOMPUTE_LIMIT_SEC / 60} minutes`));
    assert.ok(t.includes(`your last ${K.WHERE_LAST_N} games`));
    assert.ok(t.includes(`last ${K.SCOPE_DEFAULT.months} months, up to the ${K.MAX_GAMES} newest`));
    assert.ok(t.includes("rapid and blitz games"), "the default scope, in words");
    assert.ok(t.includes(`within ${K.BAND_HALF_WIDTH} points of you`));
  });

  it("time pressure: the rising-rate rule (clockRises), no per-game cap, its own trend minimum (FIX-3 review item 6)", () => {
    const t = text();
    const [lt1, lt2, gt5] = K.CLOCK_EDGES_MS.map((ms) => ms / 60_000);
    // candidateKeys needs clockRises: under 2 minutes and under 1 minute each ≥ CLOCK_SENTENCE_RISE_RATIO × the reference
    // (over 5 minutes, else 2–5), each over CLOCK_MIN_MOVES_BUCKET moves.
    assert.ok(
      t.includes(
        `your own blunder rate must rise as your clock runs down, as the Clock tab shows it: under ${lt2} minutes, and under ${lt1} minute alone, it must be at least ${K.CLOCK_SENTENCE_RISE_RATIO} times your rate with more than ${gt5} minutes left (or ${lt2}–${gt5} minutes when you rarely have ${gt5}), each rate over at least ${K.CLOCK_MIN_MOVES_BUCKET} moves`,
      ),
      t,
    );
    assert.ok(t.includes("time pressure is not your weakness"));
    assert.ok(t.includes("The per-game limit above does not apply to it"));
    assert.ok(t.includes(`at least ${K.TREND_MIN_MOVES_TP} moves with under ${K.TIME_PRESSURE_MS / 1000} seconds left`));
    // No stale claim: the cap sentence is never left unqualified.
    assert.doesNotMatch(t, /for your band alike \(one long rook endgame can carry many errors\)\.$/m);
  });

  it("the band example is the rating ± the half width (1100–1300 for a 1200 player, as the profile rows say)", () => {
    assert.equal(bandExample(), `${1200 - K.BAND_HALF_WIDTH}–${1200 + K.BAND_HALF_WIDTH}`);
    assert.equal(bandExample(), "1100–1300");
  });

  it("the drill split is the engine's (6 of 10 from your games), and time pressure is own-only", () => {
    const own = Math.round(K.DRILL_SIZES[0] * K.DRILL_OWN_SHARE);
    assert.ok(text().includes(`${K.DRILL_SIZES.join(" or ")} positions: ${Math.round(K.DRILL_OWN_SHARE * 100)}% from your own games (${own} of ${K.DRILL_SIZES[0]})`));
    assert.equal(own, 6);
    assert.ok(text().includes("a time-pressure drill uses your own positions only"));
  });

  it("the baseline line tells the truth about the committed default (synthetic, or the Lichess month and game count)", () => {
    const b = loadBaseline(DEFAULT_BASELINE_ID);
    const line = baselineLine();
    if (b.synthetic) {
      assert.match(line, /provisional table/);
      assert.doesNotMatch(line, /\d[\d,]* rated games/);
    } else {
      assert.ok(line.includes(`${b.source.games.toLocaleString("en-US")} rated games of the Lichess open database`), line);
      assert.match(line, /CC0/);
    }
  });

  it("no in-app link (the page is public; the profile is behind a flag): plain text only", () => {
    assert.doesNotMatch(text(), /\/train\//);
  });
});
