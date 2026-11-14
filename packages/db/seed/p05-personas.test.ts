// P5 persona states (phase-05 plan 6.7) without a database: every state is internally consistent, the schedules are
// deterministic and land where the plan says (4 due now, caught-up blocks, the next local 08:00), and the bank
// positions come from the member's own analysed games with legal lines.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Chess } from "chess.js";
import { TEST_DEPS } from "../test/p05-deps";
import type { SeedMember } from "./builders";
import {
  daysBefore,
  getP05PersonaState,
  P05_DEV_SEED_NAMES,
  P05_POOL_PERSONAS,
  P05_PERSONA_STATES,
  P05_SEED_PERSONAS,
  scheduleCards,
} from "./p05-persona-states";
import { momentMistakes, personaBank, personaMistakes, seededUuid } from "./p05-personas";
import { archiveFixture, gameFixture, type ReviewSeedContext } from "./review";

const NOW = new Date("2026-11-12T19:00:00.000Z");
const member: SeedMember = { id: 101n, ref: "cmember000000000000000001", name: "pool", rating: 1184 };
const ctx: ReviewSeedContext = {
  member,
  talFan: { id: 102n, ref: "ctalfan000000000000000001", name: "tal_fan_77", rating: 1203 },
  martin: { id: 103n, ref: "cmartin000000000000000001", name: "martin_k", rating: 1212 },
  botUserId: null,
  operaPositionId: null,
  ktPositionId: null,
};

function fixturesFor(name: string) {
  const s = getP05PersonaState(name);
  return [...(s.games.game ? [gameFixture(ctx)] : []), ...Array.from({ length: s.games.archives }, (_, i) => archiveFixture(ctx, i + 1))];
}

describe("P5 persona states", () => {
  it("the lease pool is the plan's nine; the dev seed maps the plan's five names", () => {
    assert.deepEqual(Object.keys(P05_POOL_PERSONAS).sort(), [
      "bank-caughtup", "bank-empty", "bank-member", "day-rollover", "home-new", "outbox", "puzzles-fresh", "train-plan", "two-tabs",
    ]);
    assert.deepEqual(Object.keys(P05_DEV_SEED_NAMES).sort(), ["caughtup", "member", "new", "perfect", "trial"]);
    for (const target of Object.values(P05_DEV_SEED_NAMES)) assert.ok(target in P05_SEED_PERSONAS, target);
    for (const [name, s] of Object.entries(P05_PERSONA_STATES)) {
      assert.equal(s.name, name);
      assert.ok(s.states.length > 0, `${name} names the design states it reaches`);
      assert.ok(s.cards <= s.mistakes, name);
    }
    assert.throws(() => getP05PersonaState("nope"), /unknown P5 persona/);
  });

  it("bank-member: 41 cards, exactly 4 due now, the rest within 14 days at 08:00 UTC, mastery 0–5 used", () => {
    const s = P05_POOL_PERSONAS["bank-member"];
    const sched = scheduleCards(s, NOW, TEST_DEPS);
    assert.equal(sched.length, 41);
    assert.equal(sched.filter((c) => c.due <= NOW).length, 4);
    for (const c of sched.filter((c) => c.due > NOW)) {
      assert.equal(c.due.getUTCHours(), 8);
      assert.ok(c.due.getTime() - NOW.getTime() <= 15 * 86_400_000);
    }
    const mastery = new Set(sched.map((c) => TEST_DEPS.masteryOf(c.state, c.stability)));
    assert.ok(mastery.size >= 4, `mastery spread ${[...mastery]}`);
    assert.deepEqual(scheduleCards(s, NOW, TEST_DEPS), sched, "deterministic (mulberry32 seed 42)");
  });

  it("bank-caughtup: nothing due; Tomorrow 6 · day 2 3 · day 3 5 · next week 9", () => {
    const sched = scheduleCards(P05_POOL_PERSONAS["bank-caughtup"], NOW, TEST_DEPS);
    assert.equal(sched.filter((c) => c.due <= NOW).length, 0);
    const byDay = new Map<string, number>();
    for (const c of sched) byDay.set(c.due.toISOString().slice(0, 10), (byDay.get(c.due.toISOString().slice(0, 10)) ?? 0) + 1);
    assert.deepEqual([...byDay.entries()], [["2026-11-13", 6], ["2026-11-14", 3], ["2026-11-15", 5], ["2026-11-20", 9]]);
    assert.equal(P05_POOL_PERSONAS["bank-caughtup"].today?.bankReviewed, 10, "the cap is reached");
  });

  it("day-rollover: 2 NEW cards due at the next 08:00 in New York (13:00 UTC in November, EST)", () => {
    const s = P05_POOL_PERSONAS["day-rollover"];
    assert.equal(s.timeZone, "America/New_York");
    const sched = scheduleCards(s, NOW, TEST_DEPS);
    assert.equal(sched.length, 2);
    for (const c of sched) {
      assert.equal(c.state, "NEW");
      assert.equal(c.due.toISOString(), "2026-11-13T13:00:00.000Z");
    }
  });

  it("train-plan, outbox and two-tabs: NEW cards already due", () => {
    for (const [name, n] of [["train-plan", 3], ["outbox", 3], ["two-tabs", 1]] as const) {
      const sched = scheduleCards(P05_POOL_PERSONAS[name], NOW, TEST_DEPS);
      assert.equal(sched.length, n, name);
      assert.ok(sched.every((c) => c.state === "NEW" && c.due <= NOW), name);
    }
  });

  it("daysBefore is plain calendar arithmetic", () => {
    assert.equal(daysBefore("2026-11-01", 1), "2026-10-31");
    assert.equal(daysBefore("2026-03-01", 1), "2026-02-28");
  });

  it("seededUuid is a stable v4-shaped UUID", () => {
    assert.equal(seededUuid("a"), seededUuid("a"));
    assert.notEqual(seededUuid("a"), seededUuid("b"));
    assert.match(seededUuid("a"), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("P5 persona bank positions (the member's own key moments)", () => {
  it("every position is the member's to move, its setup and solution are legal, and the played move is the game's", () => {
    const fixtures = fixturesFor("bank-member");
    const mistakes = personaMistakes(fixtures, member.id, member.ref, TEST_DEPS, 41);
    assert.equal(mistakes.length, 41);
    assert.equal(new Set(mistakes.map((m) => m.epdHash)).size, 41, "deduped per position");
    for (const m of mistakes) {
      const chess = new Chess(m.fen);
      if (m.setupUci) assert.ok(chess.move({ from: m.setupUci.slice(0, 2), to: m.setupUci.slice(2, 4), promotion: m.setupUci[4] }), m.referenceId);
      assert.equal(chess.turn(), m.color);
      assert.equal(TEST_DEPS.epdHash(chess.fen()), m.epdHash);
      const played = new Chess(chess.fen());
      assert.ok(played.move({ from: m.playedUci.slice(0, 2), to: m.playedUci.slice(2, 4), promotion: m.playedUci[4] }), "played legal");
      for (const u of m.solution.split(" ")) assert.ok(chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }), `${u} legal`);
      assert.equal(m.solution.split(" ").length % 2, 1, "odd length");
      assert.ok(["INACCURACY", "MISTAKE", "MISS", "BLUNDER"].includes(m.judgement));
      assert.equal(m.source, m.judgement === "MISS" ? "MISSED_PUNISH" : "OWN_ERROR");
    }
    assert.ok(mistakes.some((m) => m.isPuzzle) && mistakes.some((m) => !m.isPuzzle), "puzzles and review positions");
  });

  it("the GAME fixture gives the three design moments (the train-plan / outbox cards)", () => {
    const game = momentMistakes(gameFixture(ctx), member.id, TEST_DEPS, member.ref, 0);
    assert.equal(game.length, 3);
    assert.ok(game.every((m) => m.occurrences[0]!.opponent === "tal_fan_77"));
  });

  it("personaBank: cards on the first mistakes, keys from the codec, every state's game set is large enough", () => {
    for (const name of Object.keys(P05_PERSONA_STATES)) {
      const s = getP05PersonaState(name);
      const bank = personaBank(s, fixturesFor(name), member, NOW, TEST_DEPS);
      assert.equal(bank.mistakes.length, s.mistakes, name);
      assert.equal(bank.cards.length, s.cards, name);
      for (const c of bank.cards) assert.equal(c.itemKey, TEST_DEPS.mistakeItemKey(c.mistake.epdHash));
    }
  });
});
