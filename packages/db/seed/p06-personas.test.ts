// The P6 persona states and the writer's pure parts (phase-06 plan §6.8): the real CC0 games each state takes, the
// deterministic plan (refs, dates, which games are graded), the fixture the seed writer gets (the game's own clocks, or
// none), and the reuse rule. The database half runs through the e2e personas (scripts/dev/personas.ts) on Postgres.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Chess } from "chess.js";
import {
  getP06PersonaState,
  P06_DEV_SEED_NAMES,
  P06_PERSONA_STATES,
  P06_POOL_PERSONAS,
  personaSourceGames,
  planGames,
  REUSE_MAX_AGE_MS,
  timeControlOf,
} from "./p06-persona-states";
import { canReuse, personaFixture, P06_OPPONENT } from "./p06-personas";
import { seededRef } from "./builders";

const NOW = new Date("2026-11-18T10:17:42.000Z");
const MEMBER = { id: 41n, ref: "cmember00000000000000000", name: "pool_member", rating: null };
const OPP = { id: 42n, ref: "copponent000000000000000", name: P06_OPPONENT.name, rating: 1500 };

describe("P6 persona states", () => {
  it("every state takes real games of the extract: legal moves, a clock per ply, a known result", () => {
    const cells = personaSourceGames();
    for (const [cell, games] of Object.entries(cells)) {
      assert.ok(games.length > 0, cell);
      for (const g of games) {
        const c = new Chess();
        const uci = g.uci.split(" ");
        for (const u of uci) assert.ok(c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }), `${g.k}: ${u} is legal`);
        assert.equal(g.clk.length, uci.length, `${g.k}: one clock per ply`);
        assert.ok(uci.length >= 24, `${g.k}: a real game`);
        assert.match(g.res, /^(1-0|0-1|1\/2-1\/2)$/);
        assert.doesNotThrow(() => timeControlOf(g.tc));
      }
    }
  });

  it("the dev-seed names map to registered states with the pool twins' games", () => {
    for (const name of Object.values(P06_DEV_SEED_NAMES)) assert.ok(P06_PERSONA_STATES[name], name);
    assert.deepEqual(getP06PersonaState("dev-weak-member").games, P06_POOL_PERSONAS["weak-member"].games);
    assert.throws(() => getP06PersonaState("nope"), /unknown P6 persona/);
  });

  it("the plan is deterministic within a minute, newest first, interleaving the time classes", () => {
    const s = getP06PersonaState("weak-member");
    const a = planGames(s, NOW);
    const b = planGames(s, new Date(NOW.getTime() + 15_000));
    assert.deepEqual(a.map((g) => [g.key, g.endedAt.toISOString()]), b.map((g) => [g.key, g.endedAt.toISOString()]));
    assert.equal(a.length, 54);
    assert.equal(new Set(a.map((g) => g.key)).size, 54, "distinct keys");
    for (let i = 1; i < a.length; i++) assert.ok(a[i]!.endedAt <= a[i - 1]!.endedAt, "newest first");
    const first10 = new Set(a.slice(0, 10).map((g) => g.key.split(":").pop()!.split("#")[0]));
    assert.ok(first10.size >= 2, "blitz and rapid alternate");
    const newestAgeDays = (NOW.getTime() - a[0]!.endedAt.getTime()) / 86_400_000;
    assert.ok(newestAgeDays >= 1 && newestAgeDays < 1.01);
    const oldestAgeDays = (NOW.getTime() - a[a.length - 1]!.endedAt.getTime()) / 86_400_000;
    assert.ok(oldestAgeDays < 183, "inside the default 6-month scope");
  });

  it("weak-computing grades its 12 newest games only", () => {
    const plan = planGames(getP06PersonaState("weak-computing"), NOW);
    assert.equal(plan.length, 25);
    assert.deepEqual(
      plan.map((g) => g.analyse),
      Array.from({ length: 25 }, (_, i) => i < 12),
    );
  });

  it("bullet: enough bullet games to fill the gap the blitz games leave (the offer)", () => {
    const s = getP06PersonaState("bullet");
    const bullet = s.games.find((g) => g.cell.endsWith("BULLET"))!.count;
    const inScope = s.games.filter((g) => !g.cell.endsWith("BULLET")).reduce((n, g) => n + g.count, 0);
    assert.ok(inScope < 20 && bullet >= 20 - inScope);
  });
});

describe("P6 persona fixtures", () => {
  const [g] = planGames(getP06PersonaState("weak-member"), NOW);

  it("an online game with the game's own clock record, ref per member", () => {
    const f = personaFixture(MEMBER, OPP, g!, {});
    assert.equal(f.game.ref, seededRef(g!.key, MEMBER.ref));
    assert.equal(f.game.mode, "ONLINE");
    assert.equal(f.game.analysisStatus, "NONE");
    assert.equal(f.analysis, null);
    assert.deepEqual(f.game.moveClocksMs, g!.source.clk);
    assert.equal(f.game.moves.split(" ").length, g!.source.clk.length);
    assert.match(f.game.pgn, /\[%clk \d+:\d\d:\d\d\.\d\]/);
    assert.equal(f.players.find((p) => p.userId === MEMBER.id)!.ratingBefore, g!.source.elo);
    assert.equal(f.game.completedAt.toISOString(), g!.endedAt.toISOString());
  });

  it("noclock: the same game with no clock at all", () => {
    const f = personaFixture(MEMBER, OPP, g!, { noClocks: true });
    assert.deepEqual(f.game.moveClocksMs, []);
    assert.doesNotMatch(f.game.pgn, /%clk/);
    assert.equal(f.game.whiteTimeMs, null);
  });
});

describe("canReuse", () => {
  const at = new Date("2026-11-17T10:00:00.000Z");
  const planned = [
    { ref: "ca", analyse: true, endedAt: at },
    { ref: "cb", analyse: false, endedAt: at },
  ];
  const stored = [
    { ref: "ca", status: "DONE", completedAt: at },
    { ref: "cb", status: "NONE", completedAt: at },
  ];
  it("exactly the planned games, graded as planned, recent", () => assert.equal(canReuse(planned, stored), true));
  it("not with another game, a missing grade or old dates", () => {
    assert.equal(canReuse(planned, [...stored, { ref: "cc", status: "DONE", completedAt: at }]), false);
    assert.equal(canReuse(planned, [{ ...stored[0]!, status: "QUEUED" }, stored[1]!]), false);
    const old = new Date(at.getTime() - REUSE_MAX_AGE_MS - 1);
    assert.equal(canReuse(planned, stored.map((s) => ({ ...s, completedAt: old }))), false);
    assert.equal(canReuse([], []), false, "nothing to keep");
  });
});
