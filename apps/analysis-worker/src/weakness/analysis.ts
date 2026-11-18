// The analysis side of P6 (phase-06 plan §7.4.1 `analysis` trigger, §8.2 scope, §8.3.2 inputs): what the ANALYZE_GAME
// final batch adds for each member side (pipeline/final-batch/p06-weakness.ts) and who gets a progress frame after the
// commit (progressEmitter.ts). Pure apart from the injected error hook: it runs after every engine search and before
// planExtensions(), on the arrays the batch is about to write.
import type { Replay } from "@repo/chess-analysis/replay";
import type { SideInputsAnalysis } from "@repo/chess-analysis/weakness-inputs";
import { resolveScope, scopeSince } from "@repo/chess-training/weakness/scope";
import type { WeaknessBatchPlan } from "../pipeline/final-batch/types";
import type { GameMember, LoadedGame } from "../pipeline/types";
import { sideInputsOf, type SideInputsRow } from "./inputs";
import type { WeaknessProgressEmitter } from "./progressEmitter";
import type { WeaknessSettings } from "./settings";

/** What ANALYZE_GAME needs for P6 (AnalyzeDeps.weakness). */
export interface WeaknessAnalyzeDeps {
  settings: WeaknessSettings;
  progress: WeaknessProgressEmitter;
  /** The baseline the recompute compares with (tests); default DEFAULT_BASELINE_ID. */
  baselineId?: string;
}

const BOT_MODES = new Set(["BOT", "LEGEND_BOT"]);

/**
 * Whether this game counts in the member's weakness scope (§8.2, the parts a single game decides): not a bot game, not
 * aborted, a time class of the member's scope, ended inside the window (local midnight of the 1st, `months` back).
 * The imported-BOT-opponent rule and the 300-game cap are the recompute's (they only drop games).
 */
export function inMemberScope(game: Pick<LoadedGame, "mode" | "timeClass">, m: GameMember, now: Date): boolean {
  const w = m.weakness;
  if (!w) return false;
  if (game.mode !== null && BOT_MODES.has(game.mode)) return false;
  if (m.result === "ABORTED") return false;
  const scope = resolveScope({ weaknessTimeClasses: w.weaknessTimeClasses, weaknessMonths: w.weaknessMonths });
  if (!game.timeClass || !(scope.timeClasses as string[]).includes(game.timeClass)) return false;
  if (w.endedAtMs === null) return false;
  return w.endedAtMs >= scopeSince(now, w.timeZone, scope.months).getTime();
}

export function weaknessBatchPlan(input: {
  game: LoadedGame;
  replay: Replay;
  analysis: SideInputsAnalysis;
  settings: WeaknessSettings;
  now: Date;
  /** The pass-1 PV of each searched position (ply offset), for error plies without a stored pass-2 line (FIX-1). */
  pass1Pv?: (ply: number) => readonly string[] | null | undefined;
  onError?: (error: unknown) => void;
}): WeaknessBatchPlan {
  const { game, replay, analysis } = input;
  const sides: SideInputsRow[] = [];
  for (const m of game.members) {
    const row = sideInputsOf(
      game.id,
      {
        startingFen: game.startingFen,
        startPly: game.startPly,
        moves: replay.uci,
        moveClocksMs: game.moveClocksMs ?? [],
        initialTimeSeconds: game.initialTimeSeconds ?? null,
        timeClass: game.timeClass ?? null,
      },
      analysis,
      { color: m.color, result: m.result },
      { replay, ...(input.pass1Pv ? { pass1Pv: input.pass1Pv } : {}), ...(input.onError ? { onError: input.onError } : {}) },
    );
    if (row) sides.push(row);
  }
  const inScope = game.members.filter((m) => inMemberScope({ mode: game.mode, timeClass: game.timeClass ?? null }, m, input.now)).map((m) => m.userId);
  return { sides, inScope, settings: input.settings };
}
