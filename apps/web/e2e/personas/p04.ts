// Phase 4 personas (phase-04 plan 6.7; testing X4): the e2e lease-pool states of onboarding v3, connected accounts
// and import. The states themselves (billing, onboarding columns, links, runs, imported games) are defined once in
// packages/db/seed/p04-persona-states.ts and written by packages/db/seed/p04-personas.ts (`writeP04Persona`);
// scripts/dev/personas.ts applies them. Pure module: no Prisma import, so unit tests and Playwright can load it.
// Only the pool names are registered here: the plan's dev-seed names (`member`, `trial`, …) would clash with P1's.
import { P04_POOL_PERSONAS, type P04PoolPersonaName } from "@repo/db/seed/p04-persona-states";
import type { Persona } from "./p01";

export type P04Persona = Persona & {
  /** The P4 state `writeP04Persona` applies after P1's billing UPDATE. */
  p04: P04PoolPersonaName;
};

export const P04_PERSONAS = Object.fromEntries(
  Object.values(P04_POOL_PERSONAS).map((p) => [
    p.name,
    {
      name: p.name,
      phase: 4,
      description: p.description,
      state: p.states[0],
      billing: p.billing,
      p04: p.name as P04PoolPersonaName,
    } satisfies P04Persona,
  ]),
) as Record<P04PoolPersonaName, P04Persona>;

export type P04PersonaName = P04PoolPersonaName;

export function isP04Persona(p: Persona): p is P04Persona {
  return "p04" in p;
}
