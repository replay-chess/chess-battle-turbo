// Test faults (phase-03 plan §7.9 `WORKER_FAULT`, §12.3, TST X12). One grammar for the env hook and the kick body
// (`KickFault` in CT/internal/kick.ts):
//
//   fail_at_ply:12         the ANALYZE_GAME run fails (retryable) when it reaches ply 12
//   stall_at_ply:20        the run stops heart-beating at ply 20 (the reaper / A2 stall rule takes over)
//   engine_crash:1         the engine process is killed before the next N searches
//   hold_queue             the worker claims nothing (the review shows `queued` with real data)
//   pause_at:writing:5000  the run waits 5 s when it enters the named phase
//
// The env hook is honoured only with APP_ENV dev or test, and the worker refuses to boot when it is set anywhere
// else (env.ts). A kick body's fault is honoured only with APP_ENV=test and is one-shot for its `watch` game.
import { KickFault } from "@repo/contracts/internal/kick";

export type Fault =
  | { kind: "fail_at_ply"; ply: number }
  | { kind: "stall_at_ply"; ply: number }
  | { kind: "engine_crash"; count: number }
  | { kind: "hold_queue" }
  | { kind: "pause_at"; phase: string; ms: number };

export class FaultParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FaultParseError";
  }
}

/** Parses one fault. Throws FaultParseError (naming the grammar, not echoing more than the value's shape). */
export function parseFault(raw: string): Fault {
  const value = raw.trim();
  if (!KickFault.safeParse(value).success) {
    throw new FaultParseError(
      "fault must be fail_at_ply:<n>, stall_at_ply:<n>, engine_crash:<n>, hold_queue or pause_at:<phase>:<ms>",
    );
  }
  const [kind, a, b] = value.split(":");
  switch (kind) {
    case "fail_at_ply":
      return { kind, ply: Number(a) };
    case "stall_at_ply":
      return { kind, ply: Number(a) };
    case "engine_crash":
      return { kind, count: Math.max(1, Number(a)) };
    case "hold_queue":
      return { kind };
    case "pause_at":
      return { kind, phase: a!, ms: Number(b) };
    default:
      throw new FaultParseError(`unknown fault ${kind}`);
  }
}

export function formatFault(fault: Fault): string {
  switch (fault.kind) {
    case "fail_at_ply":
    case "stall_at_ply":
      return `${fault.kind}:${fault.ply}`;
    case "engine_crash":
      return `${fault.kind}:${fault.count}`;
    case "hold_queue":
      return fault.kind;
    case "pause_at":
      return `${fault.kind}:${fault.phase}:${fault.ms}`;
  }
}
