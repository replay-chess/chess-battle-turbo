// Payload budgets (phase-02 plan §7.4.6, §9.4) with realistic fixtures: 25-character refs, real FENs, 3-digit plies,
// 20-character names, epoch-ms times and the longest seeded legend prefix (the Opera Game, 18 plies).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { COMMANDS } from "../commands";
import { GAME_EVENTS } from "../events";
import {
  DEFAULT_EVENT_BUDGET,
  eventBudget,
  GAME_STATE_BUDGET,
  MOVE_ACK_BUDGET,
  MOVE_APPLIED_BUDGET,
} from "../limits";
import { GAME_EVENT_SPECS } from "../registry";
import { CLOCKS, eventFixtures, gameStateFixture } from "./fixtures";

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");

describe("payload budgets", () => {
  it(`GameState ≤ ${GAME_STATE_BUDGET} B at 80 plies from the initial position`, () => {
    const state = gameStateFixture();
    assert.equal(state.moves.split(" ").length, 80);
    const size = bytes(state);
    assert.ok(size <= GAME_STATE_BUDGET, `GameState is ${size} B`);
  });

  it(`GameState ≤ ${GAME_STATE_BUDGET} B with the longest legend prefix and 80 plies after it`, () => {
    const state = gameStateFixture({ start: "opera" });
    assert.equal(state.prefix.sans.split(" ").length, 18);
    const size = bytes(state);
    assert.ok(size <= GAME_STATE_BUDGET, `GameState is ${size} B`);
  });

  it(`GameState stays ≤ ${GAME_STATE_BUDGET} B as a spectator (no offers)`, () => {
    const state = { ...gameStateFixture({ start: "opera" }), you: { role: "spectator" as const } };
    assert.ok(bytes(state) <= GAME_STATE_BUDGET);
  });

  it(`move:applied ≤ ${MOVE_APPLIED_BUDGET} B with every optional flag set`, () => {
    const event = eventFixtures()["move:applied"];
    assert.ok(event.ply >= 100, "3-digit ply");
    const size = bytes(event);
    assert.ok(size <= MOVE_APPLIED_BUDGET, `move:applied is ${size} B`);
  });

  it(`MoveAck ≤ ${MOVE_ACK_BUDGET} B including the ack's ok: true and a 16-character clientMoveId`, () => {
    const ack = { ok: true, seq: 187, ply: 123, san: "exd8=Q+", clocks: CLOCKS, clientMoveId: "m7k2x9q4w1z8p3r5" };
    assert.equal(COMMANDS["game:move"].ack.safeParse(ack).success, true);
    const size = bytes(ack);
    assert.ok(size <= MOVE_ACK_BUDGET, `MoveAck is ${size} B`);
  });

  it(`every other event ≤ its budget (default ${DEFAULT_EVENT_BUDGET} B)`, () => {
    const fixtures = eventFixtures() as Record<string, unknown>;
    const report: string[] = [];
    for (const name of Object.keys(GAME_EVENTS)) {
      const size = bytes(fixtures[name]);
      const budget = eventBudget(name);
      assert.equal(GAME_EVENT_SPECS[name as keyof typeof GAME_EVENT_SPECS].budget, budget);
      if (size > budget) report.push(`${name}: ${size} B > ${budget} B`);
    }
    assert.deepEqual(report, []);
  });

  it("game:ended stays within its budget for an aborted game (abortedBy set)", () => {
    const event = { ...eventFixtures()["game:ended"], winner: null, method: "aborted" as const, abortedBy: "timeout" as const };
    assert.equal(GAME_EVENTS["game:ended"].safeParse(event).success, true);
    const size = bytes(event);
    assert.ok(size <= eventBudget("game:ended"), `aborted payload is ${size} B`);
  });

  it("only the events the plan's fields cannot fit get a budget above the default", () => {
    const above = Object.keys(GAME_EVENTS).filter((n) => eventBudget(n) > DEFAULT_EVENT_BUDGET).sort();
    assert.deepEqual(above, [
      "clock:sync", "game:ended", "game:error", "game:phase", "game:snapshot", "move:applied", "rematch:started",
    ]);
  });
});
