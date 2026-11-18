// RECOMPUTE_WEAKNESS (phase-06 plan §7.4.2; interface check §5 "WK/src/handlers/weaknessRecompute.ts"): the member's
// weekly Weakness Profile snapshot. I/O lane (CPU only, never behind Stockfish), one coalescing job row per member
// (@repo/db/weakness-jobs), payload `RecomputeWeaknessPayloadV1 {v:1, trigger, userAt?, rerun?}`.
//
//   1. context (1 statement, weakness/context.ts) → lapsed: DONE `skipped: "lapsed"` (no CPU on former members)
//   2. coverage J4 (1 statement, weakness/coverage.ts) → the engine lane is woken when it queued or raised analyses;
//      a member without a READY profile gets a `weakness:progress` frame ("recompute started")
//   3. inputs Q-W5 (1 statement, weakness/load.ts)
//   4. heal: analysed rows at `weaknessInputsV = 0` (1 read when any; the update rides in the final batch)
//   5. band + baseline (bundled JSON, checked against the engine profile; a synthetic baseline never writes READY in
//      production) → 6. computeWeakness (TRN, pure) → 7. examples Q-W6 (1 statement when there are rows)
//   8. the version rule (§8.16) → 9. ONE final batch: lock guard → heal update → snapshot upsert → [version bump]
//      → completion (`rerunIfFlaggedStatement`: QUEUED again after the debounce when a trigger arrived while running)
//   10. after the commit: `weakness:ready` (dedupe key per snapshot write), PostHog `weakness_snapshot_computed`
//      (+ `weakness_first_ready`), the Sentry metrics `worker.weakness.duration_ms` and `worker.weakness.games`.
//
// About 6 round trips without a heal (claim, context, coverage, inputs, examples, the batch): the ≤ 2 s p95 budget
// (bench-weakness.ts). A batch whose response was lost after the commit is recognised by its completion token
// (outcomeByMeStatement) and the emit values are read back.
//
// Failure: maxAttempts 3, back-off 30 s / 2 min / 10 min (the runner's BACKOFF_SEC). The final failed attempt writes a
// FAILED snapshot with `metrics.failure` only when the member has no READY row (a failure never hides a good profile),
// emits `weakness:ready {status: "failed"}`, sends `weakness_recompute_failed` and captures to Sentry with the tags
// {job_kind, algo_version, trigger} and no PII.
//
// WEAKNESS_JOBS_ENABLED off (the kill switch): the job ends DONE `skipped: "disabled"` without reading anything.
import { ENGINE_PROFILE } from "@repo/chess-analysis/version";
import { DEFAULT_BASELINE_ID } from "@repo/chess-training/baselines/load";
import { attachExamples, computeWeakness, failedMetrics } from "@repo/chess-training/weakness/compute";
import { ALGO_VERSION, GAMES_REQUIRED } from "@repo/chess-training/weakness/constants";
import { weekStartOf } from "@repo/chess-training/weakness/scope";
import { weaknessBumped } from "@repo/chess-training/weakness/version";
import { RecomputeWeaknessPayloadV1, type WeaknessTrigger } from "@repo/contracts/internal/jobs";
import { weaknessReadyDedupeKey } from "@repo/contracts/socket/user";
import { num, stmt, wasRetried, type Db, type Statement } from "../db/client";
import type { Telemetry } from "../obs/telemetry";
import type { Clock } from "../scheduler/clock";
import type { EmitSink } from "../socket/emit";
import type { ProductEvents } from "../obs/posthog";
import {
  inputsGuardStatement,
  isInputsChanged,
  isLockLost,
  lockGuardStatement,
  outcomeByMeStatement,
  rerunIfFlaggedStatement,
  rescheduleToken,
  type FailedJob,
} from "../queue/outcome";
import { refusesReady, SYNTHETIC_BASELINE_REFUSED, workerBaseline } from "../weakness/baseline";
import { isWeaknessMember, isWeaknessTrialing, loadWeaknessContext, scopeOf, writeWeekOf, type WeaknessContext } from "../weakness/context";
import { ensureWeaknessCoverage } from "../weakness/coverage";
import { loadExamples } from "../weakness/examples";
import { applyHeal, HEAL_CONTINUE_SEC, healFailedStatement, linesRegradeStatements, planHeal } from "../weakness/heal";
import { sideInputsUpdateStatement } from "../weakness/inputs";
import { loadWeaknessInputs, type LoadedInput } from "../weakness/load";
import { probeStatement, toProbe, type WeaknessProgressEmitter } from "../weakness/progressEmitter";
import type { WeaknessSettings } from "../weakness/settings";
import {
  bumpVersionStatement,
  failedSnapshotStatement,
  snapshotReadBackStatement,
  snapshotUpsertStatement,
  toWrittenSnapshot,
  versionOf,
  writeOf,
  type SnapshotStatusDb,
  type WrittenSnapshot,
} from "../weakness/write";
import type { SpanHandle } from "../obs/telemetry";
import { JobError, throwIfAborted, type JobContext, type JobHandler, type JobOutcome } from "./types";

export interface WeaknessJobDeps {
  settings: WeaknessSettings;
  /** BILLING_PAYWALL (import settings): with it off every user counts as a member (the web's switch). */
  paywall: boolean;
  /** P4's eager analysis budget (import settings): IMPORT_ANALYSE_CAP and IMPORT_ANALYSE_EAGER_TRIAL. */
  eager: { cap: number; eagerTrial: number };
  events: ProductEvents;
  progress: WeaknessProgressEmitter;
  /** The baseline id (tests); default DEFAULT_BASELINE_ID. */
  baselineId?: string;
}

type Ctx = JobContext<"RECOMPUTE_WEAKNESS">;

const MAX_DURATION_MS = 600_000;
const lower = (s: SnapshotStatusDb) => s.toLowerCase() as "ready" | "insufficient" | "failed";
/** `weakness_recompute_failed.code` and `metrics.failure.code`: lower snake case, ≤ 40 characters. */
const CODE_RE = /^[a-z][a-z0-9_]{0,39}$/;

export function weaknessRecomputeHandler(deps: WeaknessJobDeps): JobHandler<"RECOMPUTE_WEAKNESS"> {
  /** The specific code of a job's last thrown JobError (`synthetic_baseline_refused`, …), for the final failure. */
  const lastCodes = new Map<string, string>();
  return {
    kind: "RECOMPUTE_WEAKNESS",
    run: (ctx) =>
      ctx.telemetry.span(
        // §10.2: the transaction `job.RECOMPUTE_WEAKNESS` with {trigger, games, analysed, healed, status, list_mode}.
        "job.RECOMPUTE_WEAKNESS",
        { kind: "RECOMPUTE_WEAKNESS", trigger: ctx.payload.trigger },
        async (span) => {
          try {
            const out = await run(ctx, deps, span);
            lastCodes.delete(ctx.job.id);
            return out;
          } catch (error) {
            const specific = error instanceof JobError ? error.message.split(":")[0]?.trim() : undefined;
            if (specific && CODE_RE.test(specific)) lastCodes.set(ctx.job.id, specific);
            throw error;
          }
        },
        { transaction: true },
      ),
    async onFailed({ ctx, failed, code }) {
      const specific = lastCodes.get(ctx.job.id);
      lastCodes.delete(ctx.job.id);
      if (failed?.status !== "FAILED") return;
      await writeWeaknessFailure({
        db: ctx.db,
        clock: ctx.clock,
        emitter: ctx.emitter,
        telemetry: ctx.telemetry,
        events: deps.events,
        userId: ctx.job.userId,
        trigger: ctx.payload.trigger,
        attempts: ctx.job.attempts,
        code: specific ?? code,
        ...(deps.baselineId ? { baselineId: deps.baselineId } : {}),
      });
    },
  };
}

/**
 * The completion token of THIS run (FIX-1): the P3/P4 form `<me>:<jobId>:<attempt>` plus the claim time. The member's
 * one weakness row is re-armed as a fresh job (attempt 1 again) over and over, and a re-arm now keeps `result` (the
 * last completion's stamp, @repo/db/weakness-jobs), so the plain form would let a later run's lost-response check match
 * an earlier run's completion.
 */
export function runToken(ctx: Pick<Ctx, "me" | "job">): string {
  return `${rescheduleToken(ctx.me, ctx.job.id, ctx.job.attempts)}:${Math.round(ctx.job.claimedAtMs)}`;
}

/** The final batch (lock-guarded, ends in the completion). null = it committed in an attempt whose response was lost. */
async function finalWeaknessBatch(ctx: Ctx, token: string, ss: readonly Statement[]) {
  try {
    return await ctx.db.batch(ss);
  } catch (error) {
    if (isLockLost(error) && wasRetried(error)) {
      const rows = await ctx.db.query(outcomeByMeStatement({ jobId: ctx.job.id, me: ctx.me, token }));
      if (rows.length > 0) return null;
    }
    throw error;
  }
}

/**
 * FIX-1: the heal left rows for the next run. This run committed its rows (above); it writes no snapshot (never one
 * from half-healed inputs) and re-queues itself after HEAL_CONTINUE_SEC, so another I/O job can claim in between.
 */
async function continueHeal(ctx: Ctx, deps: WeaknessJobDeps, healed: number, remaining: number): Promise<JobOutcome> {
  const token = runToken(ctx);
  const out = await finalWeaknessBatch(ctx, token, [
    lockGuardStatement(ctx.job.id, ctx.me),
    rerunIfFlaggedStatement({
      jobId: ctx.job.id,
      me: ctx.me,
      rerunDelaySec: HEAL_CONTINUE_SEC,
      token,
      forceRerun: true,
      result: { healed, healRemaining: remaining },
    }),
  ]);
  const runAtMs = out ? Number(out[1]?.[0]?.runAtMs ?? NaN) : NaN;
  ctx.wakeIo?.(Number.isFinite(runAtMs) ? runAtMs : ctx.clock.now() + HEAL_CONTINUE_SEC * 1000);
  ctx.log.info("weakness heal continues in the next run", { healed, remaining });
  return "done";
}

/**
 * FIX-3 (D-P6-FIX3-1): the final batch's guard, right after the job row's lock. Every game side this run read (Q-W5) is
 * still the member's, and every bank mistake an example points at still exists; both sets are held FOR KEY SHARE until
 * the commit. An IMPORT_PURGE batch deletes game_players rows (then the mistakes seen only in them, in that order:
 * migration m5c), so a purge that removed any of them after this run read its inputs makes the batch roll back
 * (INPUTS_CHANGED_SQLSTATE) and the run start over at once (`inputsChanged`); one that reaches them later waits for this
 * commit, and its final batch then re-arms the member (`removed`) and deletes the snapshot. Updates of non-key columns
 * (an analysis writing inputs, a heal, a card hidden) never wait on these locks.
 */
export function inputsIntactStatement(userId: string, inputs: readonly LoadedInput[], metrics: { rows: readonly { example?: { mistakeRef: string } | null }[] }): Statement {
  const gameIds = inputs.map((g) => g.gameId);
  const refs = [...new Set(metrics.rows.flatMap((r) => (r.example ? [r.example.mistakeRef] : [])))];
  return inputsGuardStatement(
    `(SELECT count(*) FROM (SELECT 1 FROM game_players WHERE "userId" = $1::bigint AND "gameId" = ANY($2::bigint[]) FOR KEY SHARE) s) = $3::int
     AND (SELECT count(*) FROM (SELECT 1 FROM mistakes WHERE "userId" = $1::bigint AND "referenceId" = ANY($4::text[]) FOR KEY SHARE) m) = $5::int`,
    [userId, [...new Set(gameIds)], inputs.length, refs, refs.length],
  );
}

/**
 * FIX-3: the final batch found rows it read purged meanwhile. Nothing of this run is kept (no snapshot, no version bump,
 * no event); the row is QUEUED again at once (a fresh job), so the next run reads what is left.
 */
async function inputsChanged(ctx: Ctx, healed: number): Promise<JobOutcome> {
  const token = runToken(ctx);
  await finalWeaknessBatch(ctx, token, [
    lockGuardStatement(ctx.job.id, ctx.me),
    rerunIfFlaggedStatement({ jobId: ctx.job.id, me: ctx.me, rerunDelaySec: 0, token, forceRerun: true, result: { discarded: "inputs_changed", healed } }),
  ]);
  ctx.heartbeat.noteWrite();
  ctx.telemetry.metric("count", "worker.weakness.discarded", 1, { why: "inputs_changed" });
  ctx.wakeIo?.(ctx.clock.now());
  ctx.log.info("weakness recompute discarded: rows it read were purged meanwhile; it runs again");
  return "done";
}

/** Ends the job without a snapshot (disabled, lapsed, no user). */
async function skip(ctx: Ctx, deps: WeaknessJobDeps, reason: string): Promise<JobOutcome> {
  const token = runToken(ctx);
  await finalWeaknessBatch(ctx, token, [
    lockGuardStatement(ctx.job.id, ctx.me),
    rerunIfFlaggedStatement({ jobId: ctx.job.id, me: ctx.me, rerunDelaySec: deps.settings.debounceSec, token, result: { skipped: reason } }),
  ]);
  ctx.log.info("weakness recompute skipped", { reason });
  return "done";
}

async function run(ctx: Ctx, deps: WeaknessJobDeps, span: SpanHandle): Promise<JobOutcome> {
  const started = ctx.clock.now();
  const trigger = ctx.payload.trigger;
  if (!deps.settings.enabled) return skip(ctx, deps, "disabled");
  const userId = ctx.job.userId;
  if (!userId) return skip(ctx, deps, "no_user");

  // 1. context
  const c = await loadWeaknessContext(ctx.db, userId);
  if (!c) return skip(ctx, deps, "user_gone");
  const nowMs = ctx.clock.now();
  const now = new Date(nowMs);
  if (!isWeaknessMember(c, nowMs, deps.paywall)) return skip(ctx, deps, "lapsed");
  const baseline = workerBaseline(deps.baselineId);
  throwIfAborted(ctx.signal);

  // 2. coverage (J4)
  const { scope, since } = scopeOf(c, now);
  const trialing = isWeaknessTrialing(c, nowMs);
  const coverage = await ensureWeaknessCoverage(ctx.db, {
    userId,
    scope,
    since,
    trialing,
    caps: { member: deps.settings.analyseCap, trial: deps.settings.analyseCapTrial },
    eager: deps.eager,
  });
  if (coverage.created + coverage.raised > 0) ctx.wakeEngine?.();
  if (!c.hadReady) await deps.progress.maybeEmit({ userId, userRef: c.userRef }, "recompute");
  throwIfAborted(ctx.signal);

  // 3. inputs, 4. heal (FIX-1: capped per run, committed on its own, before and outside the job row's lock)
  const inputs = await loadWeaknessInputs(ctx.db, userId, since, scope.timeClasses);
  const heal = await planHeal(
    ctx.db,
    inputs,
    (error) => ctx.log.warn("weakness heal: a row could not be computed", { error }),
    deps.settings.healMaxRows,
    undefined,
    deps.settings.inputsVersion,
  );
  if (heal.failed > 0) {
    ctx.telemetry.metric("count", "worker.weakness.heal_failed", heal.failed);
    // FIX-2: marked −1 on their own (like the heal's update, never under the job row's lock), so no later run picks them.
    await ctx.db.query(healFailedStatement(heal.failedSides, deps.settings.inputsVersion));
  }
  if (heal.rows.length > 0) {
    throwIfAborted(ctx.signal);
    await ctx.db.query(sideInputsUpdateStatement(heal.rows, { onlyMissing: true, version: deps.settings.inputsVersion }));
    ctx.heartbeat.noteWrite();
    ctx.telemetry.metric("count", "worker.weakness.healed_rows", heal.rows.length);
  }
  if (heal.partialGames.length > 0) {
    // FIX-2 (D-P6-FIX2-8): rows healed from stored data were tagged from the best move where J5 tags the band from a
    // full line; a `weakness_lines` refresh of each game rewrites them fully tagged (and re-arms this recompute).
    await ctx.db.batch(linesRegradeStatements(heal.partialGames));
    ctx.telemetry.metric("count", "worker.weakness.lines_regrades", heal.partialGames.length);
    ctx.wakeEngine?.();
  }
  applyHeal(inputs, heal.rows, deps.settings.inputsVersion);
  throwIfAborted(ctx.signal);
  if (heal.remaining > 0) {
    span.setAttributes({ healed: heal.rows.length, status: "healing" });
    return continueHeal(ctx, deps, heal.rows.length, heal.remaining);
  }

  // 5. + 6. compute
  const draft = computeWeakness(inputs, baseline, {
    now,
    timeZone: c.timeZone,
    profile: c.profile,
    ratingBand: c.ratingBand,
    healed: heal.rows.length,
  });
  if (draft.status === "READY" && refusesReady(ctx.appEnv, baseline)) {
    throw new JobError("internal", `${SYNTHETIC_BASELINE_REFUSED}: ${baseline.id} cannot write READY snapshots in production`, {
      terminal: true,
    });
  }

  // 7. examples
  const examples = draft.status === "READY" ? await loadExamples(ctx.db, userId, draft.metrics.rows.map((r) => r.pattern)) : new Map();
  const metrics = attachExamples(draft.metrics, examples);

  // 8. version rule, 9. the batch
  const weekStart = writeWeekOf(weekStartOf(now, c.timeZone), c.latestWeekStart);
  const bumped = weaknessBumped({ status: draft.status, hadReady: c.hadReady, prevTop: c.prevTop, topKeys: metrics.topKeys });
  const token = runToken(ctx);
  const write = writeOf(userId, weekStart, { ...draft, metrics });
  const statements: Statement[] = [
    lockGuardStatement(ctx.job.id, ctx.me),
    // FIX-3 (D-P6-FIX3-1): nothing this run read was purged since (else the batch rolls back and the run starts over).
    inputsIntactStatement(userId, inputs, metrics),
    snapshotUpsertStatement(write),
    ...(bumped ? [bumpVersionStatement(userId)] : []),
    rerunIfFlaggedStatement({
      jobId: ctx.job.id,
      me: ctx.me,
      rerunDelaySec: deps.settings.debounceSec,
      token,
      result: { status: draft.status, analysed: draft.gamesAnalysed, inScope: draft.gamesInScope, healed: heal.rows.length, bumped },
    }),
  ];
  throwIfAborted(ctx.signal);
  let out: Awaited<ReturnType<typeof finalWeaknessBatch>>;
  try {
    out = await ctx.telemetry.span("db.weakness.write", { kind: "RECOMPUTE_WEAKNESS" }, () => finalWeaknessBatch(ctx, token, statements));
  } catch (error) {
    if (!isInputsChanged(error)) throw error;
    return inputsChanged(ctx, heal.rows.length);
  }
  ctx.heartbeat.noteWrite();

  // 10. after the commit
  let written: WrittenSnapshot | null;
  let version: number;
  if (out) {
    const at = 2; // after the lock guard and the inputs guard (FIX-3)
    written = toWrittenSnapshot(out[at]?.[0]);
    version = bumped ? (versionOf(out[at + 1]?.[0]) ?? c.weaknessVersion + 1) : c.weaknessVersion;
  } else {
    const back = (await ctx.db.query(snapshotReadBackStatement(userId)))[0];
    written = toWrittenSnapshot(back);
    version = versionOf(back) ?? c.weaknessVersion;
  }
  if (written) {
    deps.progress.noteSnapshot(userId, written.status === "READY");
    const emit0 = ctx.clock.now();
    await ctx.emitter.emit(
      "weakness:ready",
      {
        v: 1,
        snapshotKey: written.snapshotKey,
        status: lower(written.status),
        version,
        bumped,
        topLabel: written.status === "READY" ? (metrics.rows[0]?.label.slice(0, 40) ?? null) : null,
      },
      [c.userRef],
      { dedupeKey: weaknessReadyDedupeKey(c.userRef, written.snapshotKey) },
    );
    // §9.4 "push latency ≤ 2 s after commit": the emit's own time (worker → socket server → room).
    ctx.telemetry.metric("distribution", "worker.weakness.emit_ms", Math.max(0, ctx.clock.now() - emit0), { status: lower(written.status) });
  }
  const durationMs = Math.min(MAX_DURATION_MS, Math.max(0, ctx.clock.now() - started));
  ctx.telemetry.metric("distribution", "worker.weakness.duration_ms", durationMs, { trigger });
  ctx.telemetry.metric("distribution", "worker.weakness.games", draft.gamesAnalysed, { status: lower(draft.status) });
  span.setAttributes({
    games: draft.gamesInScope,
    analysed: draft.gamesAnalysed,
    healed: heal.rows.length,
    status: lower(draft.status),
    list_mode: draft.status === "READY" ? metrics.listMode : "none",
  });
  deps.events.capture("weakness_snapshot_computed", c.userRef, {
    status: lower(draft.status),
    algo_version: ALGO_VERSION,
    trigger,
    games_in_scope: Math.min(300, draft.gamesInScope),
    games_analysed: Math.min(300, draft.gamesAnalysed),
    list_mode: draft.status === "READY" ? metrics.listMode : null,
    top_patterns: metrics.topKeys.slice(0, 3),
    band_center: metrics.band ? Math.max(0, Math.min(4_000, Math.round(metrics.band.center))) : null,
    band_source: metrics.band?.source ?? null,
    duration_ms: Math.round(durationMs),
    healed_rows: Math.min(300, heal.rows.length),
    bumped,
  });
  if (draft.status === "READY" && !c.everReady) firstReady(deps.events, ctx.telemetry, c, inputs, nowMs);
  ctx.log.info("weakness recomputed", {
    status: draft.status,
    trigger,
    inScope: draft.gamesInScope,
    analysed: draft.gamesAnalysed,
    healed: heal.rows.length,
    coverage: { created: coverage.created, raised: coverage.raised },
    bumped,
    ms: durationMs,
  });
  return "done";
}

/** `weakness_first_ready` (§10.1): the member's first READY profile. */
function firstReady(events: ProductEvents, telemetry: Telemetry, c: WeaknessContext, inputs: readonly LoadedInput[], nowMs: number): void {
  const analysed = inputs.filter((g) => g.accuracy !== null);
  // §9.4 "time to first READY after the 20th in-scope analysis" (p95 ≤ 2 min): the snapshot's computedAt (this run's
  // now) − game_analyses.completedAt of the 20th in-scope game to be analysed.
  const done = analysed.map((g) => g.analysedAtMs).filter((t): t is number => t !== null).sort((a, b) => a - b);
  const twentieth = done[GAMES_REQUIRED - 1];
  if (twentieth !== undefined) telemetry.metric("distribution", "weakness.first_ready_lag_s", Math.max(0, Math.round((nowMs - twentieth) / 1000)));
  const firstAt = analysed.reduce<number | null>((m, g) => (g.analysedAtMs === null ? m : m === null ? g.analysedAtMs : Math.min(m, g.analysedAtMs)), null);
  const n = Math.max(1, analysed.length);
  const share = (src: string) => Math.round((analysed.filter((g) => g.source === src).length / n) * 1000) / 1000;
  events.capture("weakness_first_ready", c.userRef, {
    minutes_since_first_analysis: firstAt === null ? 0 : Math.min(10_000_000, Math.max(0, Math.round((nowMs - firstAt) / 60_000))),
    games_analysed: Math.min(300, analysed.length),
    source_mix: { lichess: share("LICHESS"), chesscom: share("CHESSCOM"), replay: share("REPLAY") },
  });
}

/** What the final-failure write needs (the runner's hook, or the reaper's follow-up for a row it failed for good). */
export interface WeaknessFailureInput {
  db: Db;
  clock: Clock;
  emitter: EmitSink;
  telemetry: Telemetry;
  events: ProductEvents;
  userId: string | null;
  trigger: WeaknessTrigger;
  attempts: number;
  code: string;
  baselineId?: string;
}

/** The final failed attempt (see the header). Errors are logged by the caller (the runner's hook wrapper, the reaper). */
export async function writeWeaknessFailure(i: WeaknessFailureInput): Promise<void> {
  const { trigger } = i;
  const safeCode = CODE_RE.test(i.code) ? i.code : "internal";
  i.telemetry.captureException(new Error(`weakness recompute failed: ${safeCode}`), {
    job_kind: "RECOMPUTE_WEAKNESS",
    algo_version: ALGO_VERSION,
    trigger,
  });
  const userId = i.userId;
  const c = userId ? await loadWeaknessContext(i.db, userId) : null;
  if (!userId || !c) return;
  i.events.capture("weakness_recompute_failed", c.userRef, {
    code: safeCode,
    attempts: Math.min(10, i.attempts),
    trigger,
  });
  if (c.hadReady) return;
  const now = new Date(i.clock.now());
  const { scope, since } = scopeOf(c, now);
  const probe = toProbe((await i.db.query(probeStatement(userId, since, scope)))[0]);
  let baseline: { id: string; profile: string };
  try {
    baseline = workerBaseline(i.baselineId);
  } catch {
    baseline = { id: i.baselineId ?? DEFAULT_BASELINE_ID, profile: ENGINE_PROFILE.id };
  }
  const metrics = failedMetrics({ code: safeCode, at: now, scope, since, inScope: probe.inScope, analysed: probe.analysed, baseline });
  const rows = await i.db.query(
    failedSnapshotStatement({
      userId,
      weekStart: writeWeekOf(weekStartOf(now, c.timeZone), c.latestWeekStart),
      status: "FAILED",
      timeClasses: scope.timeClasses,
      since,
      gamesInScope: probe.inScope,
      gamesAnalysed: probe.analysed,
      ratingBandMin: null,
      ratingBandMax: null,
      metrics,
      headline: null,
    }),
  );
  const written = toWrittenSnapshot(rows[0]);
  if (!written) return;
  await i.emitter.emit(
    "weakness:ready",
    { v: 1, snapshotKey: written.snapshotKey, status: "failed", version: c.weaknessVersion, bumped: false, topLabel: null },
    [c.userRef],
    { dedupeKey: weaknessReadyDedupeKey(c.userRef, written.snapshotKey) },
  );
}

/**
 * The reaper's follow-up (boot.ts `onReaped`): a RECOMPUTE_WEAKNESS row it failed for good (a worker that stopped
 * heart-beating on the last attempt) gets the same final-failure write as a thrown last attempt (`worker_stalled`).
 */
export async function failReapedWeakness(
  deps: Omit<WeaknessFailureInput, "userId" | "trigger" | "attempts" | "code">,
  jobs: readonly FailedJob[],
): Promise<void> {
  const ids = jobs.filter((j) => j.kind === "RECOMPUTE_WEAKNESS" && j.status === "FAILED").map((j) => j.id);
  if (ids.length === 0) return;
  const rows = await deps.db.query(
    stmt(`SELECT id::text AS id, "userId"::text AS "userId", payload, attempts FROM jobs WHERE id = ANY($1::bigint[])`, [ids]),
  );
  for (const r of rows) {
    const payload = RecomputeWeaknessPayloadV1.safeParse(r.payload);
    await writeWeaknessFailure({
      ...deps,
      userId: typeof r.userId === "string" ? r.userId : null,
      trigger: payload.success ? payload.data.trigger : "heal",
      attempts: num(r.attempts),
      code: "worker_stalled",
    });
  }
}
