// What the socket does for analysis once a game's end has COMMITTED (phase-03 plan §5.11, §7.4; P3-D13, P3-D24):
//
//   finish → kick the worker {reason: live_end, watch: ref} when a job is waiting (fresh, or a replayed finish whose
//            job is still QUEUED), `analysis:queued` {gameRef, position, etaSec} to both member players when a job
//            is queued, and `games:changed` {gameRef} to both (their archive gained a row);
//   abort  → `games:changed` only (the game left the live lists; aborted games are SKIPPED, no job).
//
// Emits are in-process (the socket server is the emitter): `UserRooms.emitToUser` stamps each user's next `useq`,
// exactly as `/internal/emit` deliveries are stamped. Only the game's member players ever get them (spectators and
// the bot have no seat ref). The socket computes no legend facts (P3-D24: A2 inserts them lazily).
// Telemetry (plan §10.1): `analysis_queued` once per dedupeKey, i.e. only when THIS finish statement created the job
// (`created`; a replayed or retried finish found it already there), `distinct_id` = the first member's ref.
// Called by the outbox after its statement settled (src/persist/outbox.ts `onEndCommitted`), so it covers live
// finishes, retried finishes and the boot restore's finishes. Never throws.
import { JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import { AnalysisQueuedEvent, GamesChangedEvent } from "@repo/contracts/socket/analysis";
import type { FinishAnalysis } from "@repo/db/live";
import type { LiveSession } from "../game/LiveSession";
import type { Logger, Metrics, Telemetry } from "../ports";
import type { WorkerKicker } from "./kick";

export type EndCommitted = { kind: "finish"; analysis: FinishAnalysis | null } | { kind: "abort" };

export interface AnalysisHookDeps {
  kicker: WorkerKicker;
  /** `UserRooms.emitToUser`; null before the server exists (nothing is connected yet). */
  emitToUser(userRef: string, event: string, data: Record<string, unknown>): void;
  log: Logger;
  metrics: Metrics;
  /** Server product events (`analysis_queued`); `appEnv` is stamped on each, as on the game events. */
  telemetry?: Telemetry;
  appEnv?: string;
}

/** `analysis_queued.game_mode` (plan §10.1) of a live game's mode. */
const MODE_WIRE: Record<string, "online" | "friend" | "tournament"> = { ONLINE: "online", FRIEND: "friend", TOURNAMENT: "tournament" };

/** The member players' refs of a session (seats without a ref, e.g. an unjoined seat, are skipped). */
export function memberRefs(session: Pick<LiveSession, "state">): string[] {
  const { w, b } = session.state.seats;
  return [...new Set([w.ref, b.ref].filter((r): r is string => typeof r === "string" && r.length > 0))];
}

export function createAnalysisHook(deps: AnalysisHookDeps): (session: LiveSession, end: EndCommitted) => void {
  const emit = (refs: readonly string[], event: string, data: Record<string, unknown>) => {
    for (const ref of refs) deps.emitToUser(ref, event, data);
    deps.metrics.count("ws.analysis.emit", { event }, refs.length);
  };

  return (session, end) => {
    try {
      const refs = memberRefs(session);
      if (end.kind === "finish" && end.analysis) {
        const a = end.analysis;
        if (a.kick) void deps.kicker.kick({ v: 1, reason: "live_end", watch: session.ref });
        if (a.created && deps.telemetry) {
          deps.telemetry.capture("analysis_queued", refs[0] ?? session.ref, {
            ...(deps.appEnv ? { app_env: deps.appEnv } : {}),
            game_mode: MODE_WIRE[String(session.state.mode)] ?? "online",
            source: "replay",
            reason: "live_end",
            priority: JOB_PRIORITY.GAME_ENDED,
            queue_position: Math.min(100_000, Math.max(0, a.ahead)),
          });
        }
        if (a.status === "QUEUED" && a.review.status === "queued" && a.review.etaSec !== null && refs.length > 0) {
          const queued = AnalysisQueuedEvent.safeParse({ v: 1, gameRef: session.ref, position: a.ahead, etaSec: a.review.etaSec });
          if (queued.success) emit(refs, "analysis:queued", queued.data);
          else deps.log.warn("analysis:queued not sent: invalid payload", { game: session.ref });
        }
      }
      if (refs.length > 0) {
        const changed = GamesChangedEvent.safeParse({ v: 1, gameRef: session.ref });
        if (changed.success) emit(refs, "games:changed", changed.data);
      }
    } catch (error) {
      deps.log.error("analysis hook failed", { game: session.ref }, error);
    }
  };
}
