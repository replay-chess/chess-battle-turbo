// Phase 3 personas (phase-03 plan §12.3, §6.9; TST X4). Each is an exact account state on a pool user (or S) that
// `leasePersona(name)` asks for: the billing columns (as P1's personas) plus the user's games, written by the P3 seed
// writers in packages/db/seed/{review,writer}.ts (`clearMemberGames`, `writePersonaFixtures`). scripts/dev/personas.ts
// applies both. Pure module: no Prisma import, so unit tests and Playwright can load it.
import { P01_PERSONAS, type Persona } from "./p01";

/** The named review fixtures a persona can own (packages/db/seed/review.ts `PersonaFixtureName`). */
export type P03GameFixture = "GAME" | "CLEAN" | "UNANALYSED" | "TERMINAL";

export type P03Persona = Persona & {
  /** The user's games after the reset: every game deleted first (`clear`), then these fixtures written. */
  games: { clear: boolean; fixtures: readonly P03GameFixture[] };
};

export const P03_PERSONAS = {
  "review-empty": {
    name: "review-empty",
    phase: 3,
    description: "Active member with no finished game: /games shows `empty`",
    state: "V3GamesArchiveEmpty.empty",
    billing: P01_PERSONAS.member.billing,
    games: { clear: true, fixtures: [] },
  },
  "review-terminal": {
    name: "review-terminal",
    phase: 3,
    description: "Active member whose only game failed for good (30 plies graded, out of attempts): no Retry, Report a Problem",
    state: "V3ReviewFailed.failed",
    billing: P01_PERSONAS.member.billing,
    games: { clear: true, fixtures: ["TERMINAL"] },
  },
  "review-lapsed": {
    name: "review-lapsed",
    phase: 3,
    description: "Paid member whose subscription ended 10 days ago, with one reviewed game: 402 expired (review-lapsed-read off)",
    billing: P01_PERSONAS.lapsed.billing,
    games: { clear: true, fixtures: ["GAME"] },
  },
} satisfies Record<string, P03Persona>;

export type P03PersonaName = keyof typeof P03_PERSONAS;

export function isP03Persona(p: Persona): p is P03Persona {
  return "games" in p;
}
