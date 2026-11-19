// Pure view helpers of the Weakness Profile (phase-06 plan §4.4–§4.7): the rate-bar scale, the list label, the
// insufficient sub-states, the computing heading and milestones, the URL slug, the top-changed rule, the linked CTA.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { weaknessPayloadFixture } from "./__fixtures__/payloads";
import { parseTab } from "./copy";
import {
  barPct,
  clockHeights,
  computingHeading,
  fmt1,
  insufficientModel,
  linkedIdle,
  listLabel,
  milestoneOf,
  phaseWorse,
  rateAria,
  rateScaleMax,
  rowBySlug,
  slugFromPath,
  topChanged,
  visibleRows,
} from "./model";

describe("weakness model", () => {
  it("rateScaleMax: max(you, band) × 1.15 over every row, at least 1.0", () => {
    const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);
    near(rateScaleMax([{ you: 3.1, band: 1.6 }, { you: 4.0, band: 2.2 }]), 4.6);
    assert.equal(rateScaleMax([{ you: 0.2, band: null }]), 1);
    near(rateScaleMax([{ you: 1, band: 3 }]), 3.45);
    assert.equal(barPct(4.0, 4.6), 87);
    assert.equal(barPct(9, 4.6), 100);
    assert.equal(barPct(1, 0), 0);
  });

  it("fmt1 always prints one decimal; rateAria names the unit and the band", () => {
    assert.equal(fmt1(4), "4.0");
    assert.equal(fmt1(3.14), "3.1");
    assert.equal(rateAria({ you: 3.1, band: 1.6, unit: "per100" }, true), "You 3.1 per 100 moves, rating band 1.6");
    assert.equal(rateAria({ you: 3.1, band: 1.6, unit: "per100" }, false), "You 3.1 per 100 moves");
    assert.equal(rateAria({ you: 4, band: 2.2, unit: "per100_under1min" }, true), "You 4.0 per 100 moves under 1 minute, rating band 2.2");
  });

  it("listLabel per list mode and form", () => {
    // FIX-5 (item E) changed these: the label names the order (points lost; count for a most-frequent list).
    assert.equal(listLabel(weaknessPayloadFixture("ready"), false), "Top 3 by points lost · per 100 moves, you vs players rated 1100–1300");
    assert.equal(listLabel(weaknessPayloadFixture("ready"), true), "Top 3 by points lost · per 100 moves vs 1100–1300");
    assert.equal(listLabel(weaknessPayloadFixture("few_patterns"), false), "Top 2 by points lost · per 100 moves, you vs players rated 1100–1300");
    assert.equal(listLabel(weaknessPayloadFixture("no_band"), false), "Top 3 by points lost · per 100 moves");
    assert.equal(listLabel(weaknessPayloadFixture("none_eligible"), true), "Most frequent in your games, by count · per 100 moves");
  });

  it("visibleRows / rowBySlug / slugFromPath", () => {
    const p = weaknessPayloadFixture("ready");
    assert.equal(visibleRows(p, false).length, 3);
    assert.equal(visibleRows(p, true).length, 5);
    assert.equal(rowBySlug(p, "time-pressure")?.pattern, "rc:timePressure");
    assert.equal(rowBySlug(p, "pin")?.rank, 5);
    assert.equal(rowBySlug(p, "skewer"), null);
    assert.equal(rowBySlug(p, null), null);
    assert.equal(slugFromPath("/train/weakness/hanging-piece"), "hanging-piece");
    assert.equal(slugFromPath("/train/weakness/fork/"), "fork");
    assert.equal(slugFromPath("/train/weakness"), null);
    assert.equal(slugFromPath("/train/weakness/Fork"), null);
    assert.equal(slugFromPath("/train/weakness/fork/x"), null);
    assert.equal(slugFromPath(null), null);
  });

  it("insufficientModel: zero, few, preliminary, the play-more count, the bullet offer", () => {
    const zero = insufficientModel(weaknessPayloadFixture("insufficient_zero"));
    assert.equal(zero.sub, "zero");
    assert.equal(zero.playMore, "Or play 20 more games here");
    const few = insufficientModel(weaknessPayloadFixture("insufficient_few"));
    assert.equal(few.sub, "few");
    assert.equal(few.h2, "17 more games and we can tell you what keeps costing you points");
    assert.equal(few.meterLabel, "3 of 20 games analysed");
    const pre = insufficientModel(weaknessPayloadFixture("insufficient"));
    assert.equal(pre.sub, "preliminary");
    assert.equal(pre.meterCaption, "14 / 20 games analysed");
    assert.equal(pre.meterPct, 70);
    assert.equal(pre.playMore, "Or play 6 more games here");
    assert.equal(pre.bullet, null);
    const bullet = insufficientModel(weaknessPayloadFixture("bullet_offer"));
    assert.deepEqual(bullet.bullet, { games: 64, text: "You have 64 bullet games from the last 6 months. Include them?" });
    const full = insufficientModel({ ...weaknessPayloadFixture("insufficient"), games: { ...weaknessPayloadFixture("insufficient").games, inScope: 20, analysed: 19 } });
    assert.equal(full.playMore, null, "hidden at 20 − inScope ≤ 0");
    assert.equal(full.h2, "1 more game and we can tell you what keeps costing you points");
  });

  it("computing heading and the 25/50/75/100 milestones", () => {
    const c = weaknessPayloadFixture("computing");
    assert.deepEqual(computingHeading(c.progress!, c.games.inScope), { h2: "Analysing 60 games", sub: "Your profile appears after the first 20; the rest keep improving it." });
    const capped = weaknessPayloadFixture("computing_almost");
    assert.equal(computingHeading(capped.progress!, capped.games.inScope).h2, "Analysing your 100 newest games");
    assert.deepEqual(computingHeading({ ...c.progress!, target: 14 }, 14), { h2: "Analysing 14 games", sub: null });
    assert.deepEqual([0, 24, 25, 49, 50, 74, 75, 99, 100].map(milestoneOf), [0, 0, 25, 25, 50, 50, 75, 75, 100]);
  });

  it("clock heights, phase tint", () => {
    assert.deepEqual(clockHeights([{ per100: 0.8 }, { per100: 1.1 }, { per100: 2.6 }, { per100: 4 }]), [20, 28, 65, 100]);
    assert.deepEqual(clockHeights([{ per100: null }, { per100: 0 }]), [0, 0]);
    assert.equal(phaseWorse(71, 76), true);
    assert.equal(phaseWorse(88, 84), false);
    assert.equal(phaseWorse(null, 84), false);
    assert.equal(phaseWorse(71, null), false);
  });

  it("topChanged only between two ready payloads whose top pattern differs", () => {
    const a = weaknessPayloadFixture("ready");
    const b = { ...a, top: [a.top[1]!, a.top[0]!, a.top[2]!] };
    assert.equal(topChanged(a, b), "Missed free pieces");
    assert.equal(topChanged(a, a), null);
    assert.equal(topChanged(undefined, b), null);
    assert.equal(topChanged(weaknessPayloadFixture("computing"), a), null);
  });

  it("linkedIdle: a linked account and no running import", () => {
    assert.equal(linkedIdle(undefined), false);
    assert.equal(linkedIdle({ accounts: [] }), false);
    assert.equal(linkedIdle({ accounts: [{ status: "linked" }], import: null }), true);
    assert.equal(linkedIdle({ accounts: [{ status: "linked" }], import: { status: "done" } }), true);
    assert.equal(linkedIdle({ accounts: [{ status: "linked" }], import: { status: "running" } }), false);
    assert.equal(linkedIdle({ accounts: [{ status: "syncing" }] }), false);
  });

  it("parseTab", () => {
    assert.equal(parseTab("clock"), "clock");
    assert.equal(parseTab(["open", "str"]), "open");
    assert.equal(parseTab("nope"), "phase");
    assert.equal(parseTab(undefined), "phase");
  });
});
