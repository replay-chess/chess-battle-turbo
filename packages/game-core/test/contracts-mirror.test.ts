// game-core mirrors the wire contract without depending on it at runtime (plan 8.20: the constants are mirrored
// in @repo/contracts/socket/limits). This test pins the mirror: every shared constant has the same value, and the
// machine's wire types stay assignable to the contract's zod types. @repo/contracts is a dev dependency only.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { z } from "zod";
import * as limits from "@repo/contracts/socket/limits";
import type * as wireGame from "@repo/contracts/socket/game";
import type * as wireEvents from "@repo/contracts/socket/events";
import * as core from "../src/constants";
import type * as machine from "../src/machine/types";

test("every constant shared with @repo/contracts/socket/limits has the same value", () => {
  const L = limits as Record<string, unknown>;
  const C = core as Record<string, unknown>;
  const shared = Object.keys(L).filter((k) => k in C);
  assert.ok(shared.length >= 20, `only ${shared.length} shared names; did one side rename?`);
  const diffs = shared.filter((k) => JSON.stringify(L[k]) !== JSON.stringify(C[k])).map((k) => `${k}: ${String(C[k])} vs ${String(L[k])}`);
  assert.deepEqual(diffs, []);
});

// Compile-time: `pnpm --filter @repo/game-core check-types` fails if a machine type drifts from the wire schema.
type Assignable<A, B extends A> = B;
export type _GameState = Assignable<z.infer<typeof wireGame.GameState>, machine.GameState>;
export type _MoveApplied = Assignable<z.infer<typeof wireGame.MoveApplied>, machine.MoveApplied>;
export type _GameEnded = Assignable<z.infer<typeof wireEvents.GameEndedEvent>, machine.GameEndedEvent>;

test("the 55 design states and the 50 lit ones match @repo/contracts/socket/test/transcript", async () => {
  const wire = await import("@repo/contracts/socket/test/transcript");
  const { DESIGN_STATES, LIT_STATES } = await import("../src/client/viewState");
  assert.deepEqual([...DESIGN_STATES].sort(), wire.DESIGN_STATES.map(([name]) => name).sort());
  assert.deepEqual([...LIT_STATES].sort(), [...wire.LIT_STATES].sort());
});
