// Server timings (phase-02 plan 7.9, 8.20). `real` uses the plan constants (optionally tuned through env);
// `fast` is the TIMING_PROFILE test hook (testing X5, X12): study, first move, reconnect grace, rematch TTL, the
// restore resume wait and the post-boot per-IP handshake grace shrink to 2–5 s, so e2e specs (fixture socket server on
// :3102) see real server deadlines without waiting 30 s. `loadEnv` already refused `fast` outside APP_ENV=test.
import { DEFAULT_MACHINE_CONFIG, type MachineConfig } from "@repo/game-core";
import {
  CHECKPOINT_MAX_AGE_MS,
  CHECKPOINT_PLIES,
  IP_GUARD_BOOT_GRACE_MS,
  POST_GAME_RETENTION_MS,
  SPECTATORS_UPDATE_MIN_MS,
  WAITING_RETENTION_MS,
} from "@repo/contracts/socket/limits";
import type { ServerEnv } from "./env";

export interface Timing {
  profile: "real" | "fast";
  /** Handed to every `reduce()` call. */
  machine: MachineConfig;
  /** Ended sessions stay this long for late joins and rematch (plan 7.6 eviction). */
  postGameRetentionMs: number;
  /** Waiting sessions with no player socket are evicted after this long. */
  waitingRetentionMs: number;
  /** Eviction sweep cadence (memory only, no DB). */
  evictEveryMs: number;
  /** The per-IP handshake guard is off this long after boot. */
  ipGuardBootGraceMs: number;
  /** `spectators:update` at most once per this interval per game. */
  spectatorsUpdateMinMs: number;
  checkpointPlies: number;
  checkpointMaxAgeMs: number;
}

/** The fast profile: every timer the plan names in 7.9, scaled to a few seconds. */
const FAST = {
  studyScale: 0.1, // 30 s → 3 s
  firstMoveMs: 3_000,
  graceMs: 3_000,
  graceFlappingMs: 2_000,
  rematchMs: 3_000,
  resumeMaxWaitMs: 5_000,
  ipGuardBootGraceMs: 2_000,
  postGameRetentionMs: 5_000,
  waitingRetentionMs: 20_000,
  evictEveryMs: 1_000,
} as const;

export function timingFor(env: Pick<ServerEnv, "timingProfile" | "overrides">): Timing {
  const o = env.overrides;
  if (env.timingProfile === "fast") {
    return {
      profile: "fast",
      machine: {
        ...DEFAULT_MACHINE_CONFIG,
        studyScale: FAST.studyScale,
        firstMoveMs: FAST.firstMoveMs,
        graceMs: FAST.graceMs,
        graceFlappingMs: FAST.graceFlappingMs,
        rematchMs: FAST.rematchMs,
        resumeMaxWaitMs: FAST.resumeMaxWaitMs,
      },
      postGameRetentionMs: FAST.postGameRetentionMs,
      waitingRetentionMs: FAST.waitingRetentionMs,
      evictEveryMs: FAST.evictEveryMs,
      ipGuardBootGraceMs: FAST.ipGuardBootGraceMs,
      spectatorsUpdateMinMs: 500,
      checkpointPlies: o.checkpointPlies ?? CHECKPOINT_PLIES,
      checkpointMaxAgeMs: o.checkpointMaxAgeMs ?? 2_000,
    };
  }
  return {
    profile: "real",
    machine: {
      ...DEFAULT_MACHINE_CONFIG,
      ...(o.firstMoveMs !== undefined ? { firstMoveMs: o.firstMoveMs } : {}),
      ...(o.graceMs !== undefined ? { graceMs: o.graceMs } : {}),
      ...(o.rematchMs !== undefined ? { rematchMs: o.rematchMs } : {}),
      ...(o.resumeMaxWaitMs !== undefined ? { resumeMaxWaitMs: o.resumeMaxWaitMs } : {}),
    },
    postGameRetentionMs: POST_GAME_RETENTION_MS,
    waitingRetentionMs: WAITING_RETENTION_MS,
    evictEveryMs: 60_000,
    ipGuardBootGraceMs: IP_GUARD_BOOT_GRACE_MS,
    spectatorsUpdateMinMs: SPECTATORS_UPDATE_MIN_MS,
    checkpointPlies: o.checkpointPlies ?? CHECKPOINT_PLIES,
    checkpointMaxAgeMs: o.checkpointMaxAgeMs ?? CHECKPOINT_MAX_AGE_MS,
  };
}
