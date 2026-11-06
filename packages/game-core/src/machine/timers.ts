// The one per-game deadline (plan 8.1, 8.4; socket F-14): study end, first-move deadline, flag, reconnect grace,
// rematch expiry and restore resume merged into the earliest. The socket keeps one setTimeout(at − now) per game
// and feeds `{type: "timer"}` when it fires; the reducer re-checks every guard, so an early or stale fire is a no-op.

import { lagCredit } from "../clock/clock";
import type { MachineConfig, ServerGame, TimerKind } from "./state";
import { DEFAULT_MACHINE_CONFIG } from "./state";
import type { Side } from "./types";

/**
 * The lag credit a move by `side` sent now would get (plan 8.4). The flag waits for it: a move already in flight that
 * the spend rule would accept must not lose to the timer firing first (FIX-A; T8 and 8.4 read together).
 */
export function flagCredit(s: ServerGame, side: Side, config: MachineConfig = DEFAULT_MACHINE_CONFIG): number {
  if (!s.tc) return 0;
  return lagCredit({ premove: false, rttMs: s.rtt[side], usedMs: s.lagUsed[side], initialMs: s.tc.initialMs, rules: config.clock });
}

export interface Deadline {
  at: number;
  kind: TimerKind;
}

/** Every pending deadline, earliest first. */
export function deadlines(s: ServerGame, config: MachineConfig = DEFAULT_MACHINE_CONFIG): Deadline[] {
  const out: Deadline[] = [];
  if (s.frozen) {
    if (s.frozen.resumeBy !== null) out.push({ at: s.frozen.resumeBy, kind: "resume" });
    return out;
  }
  if (s.phase === "study" && s.study) out.push({ at: s.study.endsAt, kind: "study_end" });
  if (s.phase === "first_move" && s.firstMove) out.push({ at: s.firstMove.deadlineAt, kind: "first_move_deadline" });
  if (s.phase === "playing") {
    if (s.tc && s.clocks.run) {
      const run = s.clocks.run;
      out.push({ at: s.clocks.at + s.clocks[run] + flagCredit(s, run, config) + config.flagSlackMs, kind: "flag" });
    }
    for (const side of ["w", "b"] as const) {
      const g = s.presence[side].graceEndsAt;
      if (g !== null) out.push({ at: g, kind: "grace" });
    }
  }
  if (s.phase === "ended" && s.rematch && !s.rematch.creating) out.push({ at: s.rematch.expiresAt, kind: "rematch" });
  return out.sort((a, b) => a.at - b.at);
}

/** The earliest deadline, or null when nothing is pending. */
export function nextTimer(s: ServerGame, config: MachineConfig = DEFAULT_MACHINE_CONFIG): Deadline | null {
  return deadlines(s, config)[0] ?? null;
}
