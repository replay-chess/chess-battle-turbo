// discoveredAttack and doubleCheck (phase-05 plan §8.11 Tier 1), from the published descriptions:
//   discoveredAttack  "Moving a piece (such as a knight), that previously blocked an attack by a long range piece (such
//                     as a rook), out of the way of that piece." A move of the line (the solver's own, or a defender
//                     capture the line forces with a piece) leaves a square that stood between a solver bishop/rook/queen and an enemy
//                     piece; the uncovered piece now attacks it, and the line uses it: a solver move uncovers a check,
//                     or that slider later captures on the uncovered target's square (a pawn target counts only when
//                     the solver's own move uncovered it);
//   doubleCheck       "Checking with two pieces at once": after a solver move the enemy king is attacked twice.
import {
  BISHOP_DIRS,
  boardOf,
  chessAt,
  firstTwo,
  kingSquareOf,
  ROOK_DIRS,
  slidesAlong,
  sqIndex,
  sqName,
  type ThemeContext,
} from "./context";

export function discoveredThemes(ctx: ThemeContext): string[] {
  const out: string[] = [];
  if (isDiscoveredAttack(ctx)) out.push("discoveredAttack");
  if (isDoubleCheck(ctx)) out.push("doubleCheck");
  return out;
}

function isDiscoveredAttack(ctx: ThemeContext): boolean {
  const steps = ctx.steps;
  for (let k = 0; k < steps.length; k++) {
    const step = steps[k]!;
    const before = boardOf(chessAt(step.fenBefore));
    const after = boardOf(chessAt(step.fenAfter));
    const from = sqIndex(step.move.from);
    const to = sqIndex(step.move.to);
    for (let s = 0; s < 64; s++) {
      const p = before[s];
      if (!p || p.color !== ctx.solver || s === from || (p.type !== "b" && p.type !== "r" && p.type !== "q")) continue;
      if (after[s]?.color !== ctx.solver || after[s]?.type !== p.type) continue;
      for (const dir of [...ROOK_DIRS, ...BISHOP_DIRS]) {
        if (!slidesAlong(p.type, dir)) continue;
        if (firstTwo(before, s, dir).first !== from) continue;
        const target = firstTwo(after, s, dir).first;
        if (target === null || target === to) continue;
        const t = after[target]!;
        if (t.color !== ctx.defender) continue;
        if (t.type === "k") {
          if (step.solver) return true;
          continue;
        }
        // A pawn uncovered by the defender's own move is an ordinary capture, not the motif.
        if (t.type === "p" && !step.solver) continue;
        // A defender piece stepping out of the line on its own (a king or queen escaping) is a skewer; the motif needs
        // the blocker lured away by a capture, and a pawn's recapture is ordinary.
        if (!step.solver && (!step.move.captured || step.move.piece === "p")) continue;
        // Uncovered by the defender's move: only when the slider takes the target at once (the line forced the
        // blocker away); uncovered by the solver's own move: whenever the slider takes it later.
        if (slider(steps, k + 1, s, target, step.solver ? Infinity : 1)) return true;
      }
    }
  }
  return false;
}

/** The slider on `at` captures on `target` within its next `within` solver moves (before the target moves away). */
function slider(steps: ThemeContext["steps"], from: number, at: number, target: number, within: number): boolean {
  let solverMoves = 0;
  for (let j = from; j < steps.length; j++) {
    const later = steps[j]!;
    if (!later.solver) {
      if (sqIndex(later.move.from) === target) return false;
      continue;
    }
    if (sqIndex(later.move.from) === at) return sqIndex(later.move.to) === target && !!later.move.captured;
    if (++solverMoves >= within) return false;
  }
  return false;
}

function isDoubleCheck(ctx: ThemeContext): boolean {
  for (const step of ctx.steps) {
    if (!step.solver) continue;
    const chess = chessAt(step.fenAfter);
    const king = kingSquareOf(boardOf(chess), ctx.defender);
    if (king !== null && chess.attackers(sqName(king), ctx.solver).length >= 2) return true;
  }
  return false;
}
