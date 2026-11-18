// Phase 6 personas (phase-06 plan §6.8; testing X4): the Weakness Profile states e2e specs lease, plus the plan's dev-seed
// states registered as `dev-weak-*` (P1/P4/P5 already own `member`, `trial` and `new`; e2e/scripts/seed-weakness.ts maps
// the plan's names onto these). The states (which real games, how far the pipelines ran) are defined once in
// packages/db/seed/p06-persona-states.ts and written by packages/db/seed/p06-personas.ts (`writeP06Persona`), which
// drives the running analysis worker: scripts/dev/personas.ts applies them after P1's billing UPDATE, P4's clear and
// P5's clear. Pure module: no Prisma import, so unit tests and Playwright can load it.
import { P06_PERSONA_STATES, type P06PersonaName } from "@repo/db/seed/p06-persona-states";
import { P01_PERSONAS, type Persona } from "./p01";

export type P06Persona = Persona & {
  /** The P6 state `writeP06Persona` applies. */
  p06: P06PersonaName;
};

export const P06_PERSONAS = Object.fromEntries(
  Object.values(P06_PERSONA_STATES).map((s) => {
    const name = s.name as P06PersonaName;
    const persona: P06Persona = {
      name,
      phase: 6,
      description: s.description,
      ...(s.states[0] ? { state: s.states[0] } : {}),
      billing: s.billing === "trial" ? P01_PERSONAS.trial5.billing : P01_PERSONAS.member.billing,
      p06: name,
    };
    return [name, persona];
  }),
) as Record<P06PersonaName, P06Persona>;

export function isP06Persona(p: Persona): p is P06Persona {
  return "p06" in p;
}

/**
 * The pool slot (index within the worker's two) a persona leases. The heavy personas (their games are graded by the
 * worker on the first lease, then kept) get slot 1 to themselves, so the light ones on slot 0 never wipe their games.
 */
export function p06PoolIndex(name: string): 0 | 1 {
  return name === "weak-member" ? 1 : 0;
}
