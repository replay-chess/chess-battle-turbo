// Analysis priorities for imported games (phase-04 plan §8.9, D4-09; feasibility F-OCI-3). Pure.
//
// Rank = position among this run's NEW, analysable games (≥ ANALYSIS_MIN_PLIES plies; P3 skips shorter ones), newest
// first. Budget per member across both providers: IMPORT_ANALYSE_CAP (200) games analysed without being opened;
// `room` = cap − already used (context.ts budgetUsed).
//
// | rank                 | INITIAL, trialist | INITIAL, paying member | MANUAL / DAILY / RETRY        |
// |----------------------|-------------------|------------------------|-------------------------------|
// | 1                    | USER_OPENED       | USER_OPENED            | IMPORT_NEWEST                 |
// | 2 – eager (20 / 50)  | IMPORT_NEWEST     | IMPORT_NEWEST          | IMPORT_NEWEST                 |
// | eager + 1 – room     | none (released at the first paid charge by the web fan-out) | BACKLOG slices (the finish batch's releaseImportBacklog) | same as the row's member kind |
// | beyond room          | none: analysed when opened (P3 A3)                                                     |
//
// Every queued row carries `fairSeq = rank`, so one member's work interleaves with other members' at the same
// priority (P3's jobs_ready_idx). A run resumed by a later attempt continues its ranks after the games its earlier
// attempts already queued (`ranksUsed`), so the newest game is never queued at USER_OPENED twice.
import { JOB_PRIORITY, type ImportTriggerDb, type JobPriority } from "@repo/contracts/internal/jobs";
import { ANALYSIS_MIN_PLIES } from "./context";

export interface PriorityPlanInput {
  trigger: ImportTriggerDb;
  /** Inside the 7-day trial (context.ts isTrialing). */
  trialing: boolean;
  /** Imported games already queued, running or analysed (both providers). */
  budgetUsed: number;
  /** Games this run's earlier attempts already queued (import_runs."analysisQueued"). */
  ranksUsed: number;
  settings: { eager: number; eagerTrial: number; cap: number };
}

export interface PriorityPlan {
  /** Ranks 1..eager are eager (rank 1 is USER_OPENED on an INITIAL run). */
  eager: number;
  /** New ranks this attempt may still queue (cap − used). */
  room: number;
  initial: boolean;
  /** Ranks this run already used (the first new rank of this attempt is ranksUsed + 1). */
  ranksUsed: number;
  /** Paying members get the rest of their budget as backlog slices after the run (the finish batch). */
  releaseBacklog: boolean;
}

export function planPriorities(input: PriorityPlanInput): PriorityPlan {
  const eager = input.trialing ? input.settings.eagerTrial : input.settings.eager;
  return {
    eager,
    room: Math.max(0, input.settings.cap - input.budgetUsed),
    initial: input.trigger === "INITIAL",
    ranksUsed: Math.max(0, input.ranksUsed),
    releaseBacklog: !input.trialing,
  };
}

/** Whether P3 would analyse a game of this length (shorter games are never queued). */
export function analysable(plyCount: number): boolean {
  return plyCount >= ANALYSIS_MIN_PLIES;
}

/**
 * The priority of the `n`-th analysable new game of this attempt (1-based), or null. The run-wide rank is
 * `ranksUsed + n`; the budget limits `n` (the games this attempt queues) to `room`.
 */
export function priorityOf(n: number, plan: PriorityPlan): { priority: JobPriority | null; rank: number } {
  const rank = plan.ranksUsed + n;
  if (n > plan.room || rank > plan.eager) return { priority: null, rank };
  if (rank === 1 && plan.initial) return { priority: JOB_PRIORITY.USER_OPENED, rank };
  return { priority: JOB_PRIORITY.IMPORT_NEWEST, rank };
}

/** Assigns priorities in place over new games in run order (newest first); returns the next `n` to use. */
export function assignPriorities<T extends { plyCount: number; priority: number | null; fairSeq: number }>(
  games: readonly T[],
  plan: PriorityPlan,
  startN = 1,
): number {
  let n = startN;
  for (const g of games) {
    if (!analysable(g.plyCount)) {
      g.priority = null;
      g.fairSeq = 0;
      continue;
    }
    const p = priorityOf(n, plan);
    g.priority = p.priority;
    g.fairSeq = p.rank;
    n++;
  }
  return n;
}
