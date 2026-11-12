// robots.txt rule registry (phase-01 plan 13.3 1B·J, CF §7 "registries as directories"). app/robots.ts reads
// ROBOTS_DISALLOW. Each phase owns one file (`p08.ts`, `p09.ts` …) and adds one import and one PHASES entry here.
//
// Phases apply oldest first: a phase appends its `disallow` paths (a duplicate keeps its first position) and may
// `undisallow` paths an earlier phase listed (P9 drops `/join/`), without editing that phase's file.
import { rules as p01 } from "./p01";
import { rules as p03 } from "./p03";

export type RobotsRuleSet = {
  /** Paths to add to `Disallow`, in output order. */
  readonly disallow?: readonly string[];
  /** Paths an earlier phase disallowed that this phase opens again. */
  readonly undisallow?: readonly string[];
};

/** Oldest first; one line per phase file. */
const PHASES: readonly RobotsRuleSet[] = [p01, p03];

/** Folds the phase rule sets in order. Exported for tests. */
export function foldDisallow(phases: readonly RobotsRuleSet[]): string[] {
  const out: string[] = [];
  for (const phase of phases) {
    const drop = new Set(phase.undisallow ?? []);
    for (let i = out.length - 1; i >= 0; i--) if (drop.has(out[i]!)) out.splice(i, 1);
    for (const path of phase.disallow ?? []) if (!out.includes(path)) out.push(path);
  }
  return out;
}

export const ROBOTS_DISALLOW: readonly string[] = foldDisallow(PHASES);
