// The /dev/ui/weakness demo's states and payloads (phase-06 plan §4.1): WP1's fixtures (`__fixtures__/payloads.ts`,
// built by the real buildPayload) plus the view states the plan names. A plain module (not "use client"), so the
// server page can read the state list. Demo only: never imported by a product route.
import type { WeaknessPayload, WeaknessRow } from "@repo/contracts/http/weakness";
import { weaknessPayloadFixture, WEAKNESS_FIXTURE_STATES, type WeaknessFixtureState } from "./__fixtures__/payloads";
import type { WeaknessTab } from "./copy";
import type { WeaknessDemoState } from "./demo-state-names";

export { WEAKNESS_DEMO_STATES, type WeaknessDemoState } from "./demo-state-names";

/** The design boards' example positions (DR/V3WeaknessProfile `W`), by pattern. */
const DESIGN_EXAMPLES: Readonly<Record<string, NonNullable<WeaknessRow["example"]>>> = {
  fork: { fen: "r2r2k1/p1q2pp1/2p2n1p/5b2/8/1PNNP1bP/P1PQB1P1/R4RK1 b - - 0 1", orient: "w", mistakeRef: "demo-fork" },
  hangingPiece: { fen: "r2r2k1/p1q2pp1/2p2n1p/5b2/8/1PNNP1bP/P1P1B1P1/R2Q1RK1 w - - 1 19", orient: "w", mistakeRef: "demo-hanging" },
  "rc:timePressure": { fen: "r3r1k1/p1q2ppb/2p2n1p/8/8/1PNNPBbP/P1PQ2P1/R4RK1 w - - 5 21", orient: "w", mistakeRef: "demo-tp" },
};

function withExamples(p: WeaknessPayload): WeaknessPayload {
  const add = (rows: WeaknessRow[]) => rows.map((r) => ({ ...r, example: r.example ?? DESIGN_EXAMPLES[r.pattern] ?? null }));
  return { ...p, top: add(p.top), more: add(p.more) };
}

function patchRow(p: WeaknessPayload, pattern: string, patch: Partial<WeaknessRow>): WeaknessPayload {
  const f = (rows: WeaknessRow[]) => rows.map((r) => (r.pattern === pattern ? { ...r, ...patch } : r));
  return { ...p, top: f(p.top), more: f(p.more) };
}

function base(state: WeaknessDemoState): WeaknessFixtureState {
  if ((WEAKNESS_FIXTURE_STATES as readonly string[]).includes(state)) return state as WeaknessFixtureState;
  if (state === "ready_flash") return "ready";
  if (state.startsWith("failed")) return "failed";
  return "ready";
}

/** The payload a demo state shows. */
export function demoPayload(state: WeaknessDemoState, o: { lesson?: boolean; stress?: boolean } = {}): WeaknessPayload {
  let p = withExamples(weaknessPayloadFixture(base(state), o));
  if (state === "drill_unmatched") p = patchRow(p, "fork", { matchable: false });
  if (state === "drill_zero_own") p = patchRow(p, "fork", { inBank: 0 });
  if (state === "drill_empty") p = patchRow(p, "rc:development", { inBank: 0 });
  return p;
}

/** The drill config's pattern for a drill state. */
export function demoSelected(state: WeaknessDemoState, p: WeaknessPayload): string | null {
  if (state === "drill_time_pressure") return "time-pressure";
  if (state === "drill_empty") return p.more.find((r) => r.pattern === "rc:development")?.slug ?? null;
  if (state === "drill_unmatched") return "fork";
  return state.startsWith("drill") ? (p.top[0]?.slug ?? null) : null;
}

export function demoInitialTab(state: WeaknessDemoState): WeaknessTab {
  if (state === "tab_clock") return "clock";
  if (state === "tab_openings") return "open";
  if (state === "tab_strengths") return "str";
  return "phase";
}
