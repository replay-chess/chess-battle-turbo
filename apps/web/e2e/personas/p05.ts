// Phase 5 personas (phase-05 plan 6.7; testing X4): the Mistake Bank, Train and Home states e2e specs lease, plus the
// plan's dev-seed states registered as `dev-*` (P1 and P4 already own `member`, `trial` and `new`; seed-training.ts
// maps the plan's names onto these). The states themselves (games, bank, schedules, profile, days, mastery) are
// defined once in packages/db/seed/p05-persona-states.ts and written by packages/db/seed/p05-personas.ts
// (`writeP05Persona`); scripts/dev/personas.ts applies them after P1's billing UPDATE, P3's game clear and P4's state.
// Pure module: no Prisma import, so unit tests and Playwright can load it.
import { P04_POOL_PERSONAS, type P04PoolPersonaName } from "@repo/db/seed/p04-persona-states";
import { P05_PERSONA_STATES, type P05PersonaName } from "@repo/db/seed/p05-persona-states";
import { P01_PERSONAS, type Persona } from "./p01";
import type { P03Persona } from "./p03";

export type P05Persona = P03Persona & {
  /** The P5 state `writeP05Persona` applies (after P3 cleared the user's games). */
  p05: P05PersonaName;
  /** A P4 state written first (dev-trial: the running import). */
  p04?: P04PoolPersonaName;
};

/** The P4 state a P5 dev persona builds on. */
const P04_BASE: Partial<Record<P05PersonaName, P04PoolPersonaName>> = { "dev-trial": "import-trial" };

export const P05_PERSONAS = Object.fromEntries(
  Object.values(P05_PERSONA_STATES).map((s) => {
    const name = s.name as P05PersonaName;
    const p04 = P04_BASE[name];
    const persona: P05Persona = {
      name,
      phase: 5,
      description: s.description,
      state: s.states[0],
      billing: p04 ? P04_POOL_PERSONAS[p04].billing : P01_PERSONAS.member.billing,
      // Every P5 reset starts from no games; the writer then puts the state's analysed games back (deterministic refs).
      games: { clear: true, fixtures: [] },
      p05: name,
      ...(p04 ? { p04 } : {}),
    };
    return [name, persona];
  }),
) as Record<P05PersonaName, P05Persona>;

export function isP05Persona(p: Persona): p is P05Persona {
  return "p05" in p;
}
