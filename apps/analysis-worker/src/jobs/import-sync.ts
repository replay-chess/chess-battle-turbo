// IMPORT_SYNC (phase-04 plan §7.7, §8.6–8.11, D4-18, D4-27, D4-28; §9.4 write-path budget). One job row per linked
// account (`import:<linkedAccountId>`), reused forever: INITIAL / MANUAL / RETRY runs are created by the web and point
// the job at their run; after every sync with auto-import on, the row is RESCHEDULED as the account's next DAILY wake
// (`runId: null`) instead of being marked DONE.
//
//   context (1 statement: account, cursor, member, run, budget)
//   → not a member: park the run (WAITING_FOR_MEMBERSHIP), job DONE, no reschedule      [guarded batch]
//   → start the run (QUEUED/WAITING → RUNNING); a DAILY wake creates its run only when it finds new games
//   → read the provider (reading.ts): the newest chunk is saved as soon as it is known (D4-28, phase `reading`)
//   → known filter on the rest (⌈n/500⌉), total, then one statement per 100 games (batch-writer.ts, phase `saving`)
//   → finish: run DONE, account IDLE + next sync, cursor, [paying members: the backlog slices], job rescheduled or
//     DONE                                                                                 [guarded batch]
//   → events: `import:progress` during the run, `games:changed`, `import:finished`.
//
// Failures (§8.11): not_found / closed → FAILED at once (account ERROR); 429 → the gate pauses (60 s Chess.com, 60 s →
// 15 min Lichess), the run waits QUEUED, the account RATE_LIMITED, the job retries at the pause's end without using up
// an attempt (a pause has no terminal case, FIX-2); 5xx / timeout
// → the job back-off (60 s, 5 min, 15 min, 15 min, or a longer Retry-After), the run stays RUNNING until the last
// attempt, then FAILED. Whatever was read before the failure is saved first (so the next attempt, through the known
// filter or the Lichess resume point, reads only the rest). The failure's run/account state and the job's back-off
// commit in ONE guarded batch, then `import:failed` goes out (rate limits and terminal failures only).
//
// Every write after the context checks the job lock (the guard of the final batches; the chunk statement's own
// `held` CTE), so a worker that lost its job to the reaper stops at its next write: two workers never import one
// account at the same time. Lost responses: the chunk statement and the start/progress statements are idempotent;
// a final batch whose resend fails on the guard asks `outcomeByMeStatement` whether its first send committed.
import { JOB_PRIORITY, type ImportSyncPayloadV1, type ImportTriggerDb } from "@repo/contracts/internal/jobs";
import type { ImportedGame } from "@repo/chess-import/types";
import type { ProviderError } from "@repo/chess-import/errors";
import { importErrorCodeOf } from "@repo/chess-import/errors";
import { newGameRef } from "@repo/db/games";
import { releaseImportBacklogSql } from "@repo/db/import-backlog";
import { importError, type ImportErrorV1 } from "@repo/db/json";
import { fromPrisma, wasRetried, type Db, type Row, type Statement } from "../db/client";
import type { Logger } from "../obs/log";
import type { Clock } from "../scheduler/clock";
import type { EmitSink } from "../socket/emit";
import { AccountGone, IMPORT_CHUNK, writeChunk, type ChunkGame } from "../import/batch-writer";
import {
  ACTIVE_RUN_STATUSES,
  isMember,
  isTrialing,
  loadImportContext,
  type ImportContext,
  type ProviderDb,
} from "../import/context";
import { knownExternalIds } from "../import/known";
import { importMetric } from "../import/metrics";
import { noopProductEvents, type ProductEvents } from "../obs/posthog";
import { assignPriorities, planPriorities, type PriorityPlan } from "../import/priorities";
import { ImportEvents, type ProviderSlug } from "../import/progress";
import { readChessCom, readLichess, skippedBefore, type ReadInput, type ReadResult } from "../import/reading";
import {
  createDailyRunStatement,
  failRunOfJobStatement,
  failRunStatement,
  finishRunStatement,
  parkRunStatement,
  readingProgressStatement,
  runSummaryStatement,
  startRunStatement,
  toFinishedRun,
  type FailureState,
  type FinishedRun,
} from "../import/run";
import { nextAutoSyncAt } from "../import/schedule";
import type { ImportSettings } from "../import/settings";
import type { ImportProviders } from "../providers";
import {
  backoffSecFor,
  doneStatement,
  failStatement,
  isLockLost,
  lockGuardStatement,
  outcomeByMeStatement,
  refundedAttempt,
  rescheduleStatement,
  rescheduleToken,
  type FailedJob,
} from "../queue/outcome";
import { throwIfAborted, type JobContext, type JobHandler, type JobOutcome } from "./types";

/** The run's `seen` is written at most this often while reading (§9.4 "reading progress ≈ 1 per 5 s"). */
export const READING_DB_EVERY_MS = 5_000;

export interface ImportDeps {
  providers: ImportProviders;
  settings: ImportSettings;
  /** PostHog (phase-04 plan 10.1 import events); the worker's one ProductEvents. */
  events?: ProductEvents;
}

type Ctx = JobContext<"IMPORT_SYNC">;

const slugOf = (p: ProviderDb): ProviderSlug => (p === "CHESSCOM" ? "chesscom" : "lichess");

/** The account's next DAILY wake as a job payload (§7.7.1: the reused row). */
/** How long an import waits for a pending purge of the same member and provider before it looks again. */
export const PURGE_WAIT_MS = 30_000;

export function dailyPayload(linkedAccountId: string): ImportSyncPayloadV1 {
  return { v: 1, linkedAccountId, runId: null, trigger: "DAILY" };
}

export function importSyncHandler(deps: ImportDeps): JobHandler<"IMPORT_SYNC"> {
  return {
    kind: "IMPORT_SYNC",
    run: (ctx) => new ImportSync(ctx, deps).run(),
    async onFailed({ ctx, failed }) {
      // The runner failed the job (an unexpected error). Only its last attempt ends the run; the earlier ones leave
      // the run RUNNING for the retry (§8.11).
      if (failed?.status !== "FAILED") return;
      const error = importError("internal", "the import stopped on an unexpected error", new Date(ctx.clock.now()));
      const rows = await ctx.db.query(failRunOfJobStatement(ctx.job.id, error));
      await emitRunsFailed({ emitter: ctx.emitter, clock: ctx.clock, log: ctx.log }, rows, error, ctx.job.attempts);
    },
  };
}

/** `import:failed` for the runs a terminal job failure ended (rows of failRunOfJobStatement). */
async function emitRunsFailed(
  deps: { emitter: EmitSink; clock: Clock; log: Logger },
  rows: readonly Row[],
  error: ImportErrorV1,
  attempt: number,
): Promise<void> {
  for (const r of rows) {
    if (typeof r.runRef !== "string" || typeof r.userRef !== "string") continue;
    const events = new ImportEvents({
      emitter: deps.emitter,
      clock: deps.clock,
      log: deps.log,
      userRef: r.userRef,
      provider: r.provider === "LICHESS" ? "lichess" : "chesscom",
      runRef: () => null,
    });
    await events.failed(
      { code: error.code, retryAt: null, imported: Number(r.imported ?? 0), total: r.total === null ? null : Number(r.total) },
      r.runRef,
      attempt,
    );
  }
}

class ImportSync {
  private c!: ImportContext;
  private runRow: { id: string; ref: string } | null = null;
  private plan!: PriorityPlan;
  private events!: ImportEvents;
  private trigger!: ImportTriggerDb;
  private nextN = 1;
  private ord = 0;
  /** Candidates consumed (written or known) from the front of the newest-first list. */
  private consumed = 0;
  private totals = { imported: 0, analysed: 0, analysisQueued: 0 };
  /** The run's `imported` when this attempt started (earlier attempts' games). */
  private startImported = 0;
  private total = 0;
  private taken = 0;
  private newRows = 0;
  private oldestSavedEndMs: number | null = null;
  private lastDbProgressAt = Number.NEGATIVE_INFINITY;
  /** Metrics (§10.2): when this attempt started, and whether its first chunk was written yet. */
  private startedAtMs = 0;
  private firstChunkDone = false;
  private firstChunkMs: number | null = null;
  private readDoneMs: number | null = null;

  constructor(
    private readonly ctx: Ctx,
    private readonly deps: ImportDeps,
  ) {}

  private get source(): ProviderDb {
    return this.c.account.provider;
  }

  private get product(): ProductEvents {
    return this.deps.events ?? noopProductEvents;
  }

  /** `import_started` (plan 10.1): a run's first attempt starts reading. */
  private captureStarted(): void {
    this.product.capture("import_started", this.c.member.userRef, {
      provider: slugOf(this.source),
      trigger: this.trigger.toLowerCase() as Lowercase<ImportTriggerDb>,
    });
  }

  async run(): Promise<JobOutcome> {
    const { ctx } = this;
    const p = ctx.payload;
    const nowMs = ctx.clock.now();
    this.startedAtMs = nowMs;
    const c = await ctx.telemetry.span("db.import.context", { kind: "IMPORT_SYNC" }, () =>
      loadImportContext(ctx.db, p.linkedAccountId, p.runId),
    );
    if (!c) {
      // The account was unlinked: nothing to import, and no next wake.
      ctx.log.info("import: the linked account is gone");
      await this.finalBatch([], "done");
      return "done";
    }
    this.c = c;
    this.trigger = c.run?.trigger ?? p.trigger;
    const provider = slugOf(c.account.provider);
    this.events = new ImportEvents({
      emitter: ctx.emitter,
      clock: ctx.clock,
      log: ctx.log,
      userRef: c.member.userRef,
      provider,
      runRef: () => this.runRow?.ref ?? null,
    });
    const log = ctx.log.child({ provider, trigger: this.trigger, account: c.account.id });

    // A job that points at a run that is gone or already over (unlinked, cancelled, a stale requeue): keep the
    // account's daily wake going and stop.
    if ((p.runId !== null && !c.run) || (c.run && !ACTIVE_RUN_STATUSES.includes(c.run.status))) {
      log.info("import: the job's run is no longer active");
      await this.finalBatch([], this.rescheduleOrDone(nowMs));
      return "done";
    }
    if (!c.run && (!c.account.autoImport || c.account.status !== "ACTIVE")) {
      log.info("import: daily sync off for this account");
      await this.finalBatch([], "done");
      return "done";
    }
    if (c.purgePending) {
      // Unlinked with "delete games" and linked again before the purge ran: import after it, or the purge would
      // remove what this attempt saves. The job keeps its payload and priority; the run stays as it is.
      log.info("import: a purge of this provider's games is pending: waiting for it");
      await this.finalBatch([], { runAt: new Date(nowMs + PURGE_WAIT_MS), keep: true });
      return "done";
    }
    if (!isMember(c.member, nowMs, this.deps.settings.paywall)) {
      log.info("import: not a member: the run waits for the membership");
      await this.finalBatch(
        [
          parkRunStatement({
            runId: c.run?.id ?? null,
            dailyRef: newGameRef(nowMs),
            userId: c.account.userId,
            linkedAccountId: c.account.id,
            provider: c.account.provider,
          }),
        ],
        "done",
      );
      return "done";
    }

    if (c.run) {
      const rows = await ctx.db.query(
        startRunStatement({ runId: c.run.id, linkedAccountId: c.account.id, provider: c.account.provider }),
      );
      if (Number(rows[0]?.started ?? 0) === 0) {
        log.info("import: the run was cancelled before it started");
        await this.finalBatch([], this.rescheduleOrDone(nowMs));
        return "done";
      }
      this.runRow = { id: c.run.id, ref: c.run.ref };
      this.totals = { imported: c.run.imported, analysed: c.run.analysed, analysisQueued: c.run.analysisQueued };
      this.startImported = c.run.imported;
      // Once per run: a rate-limit pause gives the attempt back (FIX-2), so the attempt number cannot tell a retry.
      if (c.run.status === "QUEUED" && ctx.job.attempts <= 1 && !c.run.everStarted) this.captureStarted();
    }
    this.plan = planPriorities({
      trigger: this.trigger,
      trialing: isTrialing(c.member, nowMs),
      budgetUsed: c.budgetUsed,
      ranksUsed: c.run?.analysisQueued ?? 0,
      settings: this.deps.settings,
    });

    const input: ReadInput = {
      account: c.account,
      cursor: c.cursor,
      initial: this.trigger === "INITIAL",
      nowMs,
      windowMonths: this.deps.settings.windowMonths,
      maxGames: this.deps.settings.maxGames,
      alreadyImported: c.run?.imported ?? 0,
    };
    const hooks = {
      signal: ctx.signal,
      early: (games: ImportedGame[]) => this.save(games, "reading", null, null),
      progress: (seen: number) => this.readingProgress(seen),
    };
    let read: ReadResult;
    try {
      read = await ctx.telemetry.span(`upstream.${provider}`, { kind: "IMPORT_SYNC", provider }, () =>
        c.account.provider === "CHESSCOM"
          ? readChessCom(this.deps.providers.chesscom, input, hooks)
          : readLichess(this.deps.providers.lichess, input, hooks),
      );
    } catch (error) {
      if (error instanceof AccountGone) return this.accountGone(log);
      throw error;
    }
    throwIfAborted(ctx.signal);
    this.readDoneMs = ctx.clock.now();

    try {
      // Everything read is saved, also before a failure (the next attempt then reads only the rest).
      const rest = read.candidates.slice(this.consumed);
      // The run's total: what earlier attempts saved + the new games of this attempt (early chunk + the rest).
      this.total = this.startImported + this.pendingTotalAdjust + (await this.freshCount(rest));
      if (rest.length > 0) await this.save(rest, "saving", read.error ? null : this.total, read.seen);
    } catch (error) {
      if (error instanceof AccountGone) return this.accountGone(log);
      throw error;
    }
    if (read.error) return this.fail(read, read.error);
    return this.finish(read);
  }

  // ── saving ────────────────────────────────────────────────────────────────────────────────────────────────────
  /** Fresh games counted by the early chunk's known filter (the total is computed over every candidate). */
  private pendingTotalAdjust = 0;
  /** The fresh games of `rest` (filled by freshCount for the following save, so the known filter runs once). */
  private freshRest: ImportedGame[] | null = null;

  private async freshCount(rest: ImportedGame[]): Promise<number> {
    if (rest.length === 0) {
      this.freshRest = [];
      return 0;
    }
    const known = await this.ctx.telemetry.span("db.import.known", { kind: "IMPORT_SYNC" }, () =>
      knownExternalIds(this.ctx.db, this.c.account.userId, this.source, rest.map((g) => g.externalId), this.c.account.id),
    );
    this.freshRest = rest.filter((g) => !known.has(g.externalId));
    return this.freshRest.length;
  }

  /**
   * Known filter (unless `freshCount` already ran it on these games), priorities, then one statement per 100.
   * `games` are the next candidates in the newest-first order.
   */
  private async save(
    games: ImportedGame[],
    phase: "reading" | "saving",
    total: number | null,
    seen: number | null,
  ): Promise<void> {
    const { ctx } = this;
    let fresh: ImportedGame[];
    if (phase === "saving" && this.freshRest !== null) {
      fresh = this.freshRest;
      this.freshRest = null;
    } else {
      const known = await ctx.telemetry.span("db.import.known", { kind: "IMPORT_SYNC" }, () =>
        knownExternalIds(ctx.db, this.c.account.userId, this.source, games.map((g) => g.externalId), this.c.account.id),
      );
      fresh = games.filter((g) => !known.has(g.externalId));
      if (phase === "reading") this.pendingTotalAdjust += fresh.length;
    }
    this.consumed += games.length;
    if (fresh.length === 0) return;
    if (!this.runRow) await this.createDailyRun();
    const run = this.runRow!;
    const items = fresh.map((g) => ({ plyCount: g.plyCount, priority: null as number | null, fairSeq: 0 }));
    this.nextN = assignPriorities(items, this.plan, this.nextN);
    const rows: ChunkGame[] = fresh.map((g, i) => ({
      game: g,
      referenceId: newGameRef(ctx.clock.now()),
      ord: ++this.ord,
      priority: items[i]!.priority,
      fairSeq: items[i]!.fairSeq,
    }));
    for (let i = 0; i < rows.length; i += IMPORT_CHUNK) {
      throwIfAborted(ctx.signal);
      const chunk = rows.slice(i, i + IMPORT_CHUNK);
      const resumeUntilMs =
        this.source === "LICHESS"
          ? chunk.reduce<number | null>(
              (m, r) => (r.game.createdAtMs === null ? m : m === null ? r.game.createdAtMs : Math.min(m, r.game.createdAtMs)),
              null,
            )
          : null;
      const chunkStartMs = ctx.clock.now();
      const res = await ctx.telemetry.span("db.import.chunk", { kind: "IMPORT_SYNC", phase }, () =>
        writeChunk(ctx.db, {
          jobId: ctx.job.id,
          me: ctx.me,
          source: this.source,
          userId: this.c.account.userId,
          linkedAccountId: this.c.account.id,
          runId: run.id,
          games: chunk,
          phase,
          total: i === 0 ? total : null,
          seen: i === 0 ? seen : null,
          resumeUntilMs,
        }),
      );
      ctx.heartbeat.noteWrite();
      const provider = slugOf(this.source);
      importMetric(ctx, "import.chunk_ms", ctx.clock.now() - chunkStartMs, { provider, phase });
      if (!this.firstChunkDone) {
        this.firstChunkDone = true;
        this.firstChunkMs = ctx.clock.now() - this.startedAtMs;
        importMetric(ctx, "import.first_chunk_ms", this.firstChunkMs, { provider });
      }
      this.totals = { imported: res.imported, analysed: res.analysed, analysisQueued: res.analysisQueued };
      this.taken += res.taken;
      this.newRows += res.newRows;
      for (const r of chunk) {
        const end = r.game.endedAt.getTime();
        this.oldestSavedEndMs = this.oldestSavedEndMs === null ? end : Math.min(this.oldestSavedEndMs, end);
      }
      await this.events.added(res.newRows);
      const numbers = { seen: seen ?? 0, imported: res.imported, total, analysed: res.analysed };
      if (phase === "reading") await this.events.reading({ ...numbers, total: null });
      else await this.events.saving(numbers);
    }
  }

  private async createDailyRun(): Promise<void> {
    const rows = await this.ctx.db.query(
      createDailyRunStatement({
        ref: newGameRef(this.ctx.clock.now()),
        userId: this.c.account.userId,
        linkedAccountId: this.c.account.id,
        provider: this.c.account.provider,
      }),
    );
    const row = rows[0];
    if (!row) throw new Error("another import run of this account is active");
    this.runRow = { id: String(row.id), ref: String(row.ref) };
    this.captureStarted();
  }

  private async readingProgress(seen: number): Promise<void> {
    if (!this.events.readingDue(seen)) return;
    const now = this.ctx.clock.now();
    if (this.runRow && now - this.lastDbProgressAt >= READING_DB_EVERY_MS) {
      this.lastDbProgressAt = now;
      await this.ctx.db.query(readingProgressStatement(this.runRow.id, seen));
    }
    await this.events.reading({ seen, imported: this.totals.imported, total: null, analysed: this.totals.analysed });
  }

  // ── the end of an attempt ─────────────────────────────────────────────────────────────────────────────────────
  private rescheduleOrDone(nowMs: number): "done" | { runAt: Date } {
    const a = this.c?.account;
    if (!a || !a.autoImport || a.status !== "ACTIVE") return "done";
    return {
      runAt: nextAutoSyncAt(
        this.c.member.timeZone,
        new Date(nowMs),
        a.lastSyncOkAtMs === null ? null : new Date(a.lastSyncOkAtMs),
        a.id,
      ),
    };
  }

  /**
   * One batch: P3's lock guard, `statements`, then the job's own end (DONE, or rescheduled as the next DAILY wake).
   * Returns the statements' rows, or null when the batch committed but its response was lost (its resend failed on
   * the guard and the job carries this write's mark).
   */
  private async finalBatch(statements: Statement[], end: "done" | { runAt: Date; keep?: boolean }): Promise<Row[][] | null> {
    const { ctx } = this;
    const token = rescheduleToken(ctx.me, ctx.job.id, ctx.job.attempts);
    const jobStatement =
      end === "done"
        ? doneStatement(ctx.job.id, ctx.me, { trigger: ctx.payload.trigger })
        : rescheduleStatement({
            jobId: ctx.job.id,
            me: ctx.me,
            runAt: end.runAt,
            // `keep`: the same attempt again later (a pending purge), else the account's next DAILY wake.
            priority: end.keep ? ctx.job.priority : JOB_PRIORITY.IMPORT_SYNC_DAILY,
            payload: end.keep ? ctx.payload : dailyPayload(ctx.payload.linkedAccountId),
            token,
          });
    try {
      const out = await ctx.db.batch([lockGuardStatement(ctx.job.id, ctx.me), ...statements, jobStatement]);
      ctx.heartbeat.noteWrite();
      return out.slice(1, 1 + statements.length);
    } catch (error) {
      if (isLockLost(error) && wasRetried(error)) {
        const mine = await ctx.db.query(
          outcomeByMeStatement({ jobId: ctx.job.id, me: ctx.me, ...(end === "done" ? {} : { token }) }),
        );
        if (mine.length > 0) {
          ctx.log.warn("import: the final batch committed but its response was lost");
          return null;
        }
      }
      throw error;
    }
  }

  private async finish(read: ReadResult): Promise<JobOutcome> {
    const { ctx, c } = this;
    const nowMs = ctx.clock.now();
    const end = this.rescheduleOrDoneAfterSync(nowMs);
    const cc = read.chesscom;
    const isChessCom = this.source === "CHESSCOM";
    const runSkipped = read.skipped + this.taken;
    const archiveSkipped = cc?.archives
      ? Object.values(cc.archives.months).reduce((n, m) => n + m.skipped, 0)
      : 0;
    const statements: Statement[] = [
      finishRunStatement({
        runId: this.runRow?.id ?? null,
        linkedAccountId: c.account.id,
        provider: c.account.provider,
        atMs: nowMs,
        nextAutoSyncAtMs: end === "done" ? null : end.runAt.getTime(),
        total: this.total,
        seen: read.seen,
        runSkipped: isChessCom ? { abs: runSkipped } : { add: runSkipped },
        accountSkipped: isChessCom ? { abs: archiveSkipped + this.taken } : { add: runSkipped },
        profile: cc?.profile ?? null,
        cursor: {
          archivesEtag: cc?.archivesEtag ?? null,
          archivesLastModified: cc?.archivesLastModified ?? null,
          archives: cc?.archives ?? null,
          lichessNewestMs: read.lichess && !read.lichess.resumed ? read.lichess.newestCreatedMs : null,
          oldestImportedAtMs: this.oldestSavedEndMs,
          seenAdd: read.seen,
          skippedVariantsAdd: read.variants,
        },
      }),
    ];
    const backlog = this.runRow !== null && this.plan.releaseBacklog && this.totals.imported > 0;
    if (backlog) {
      statements.push(
        fromPrisma(
          releaseImportBacklogSql({
            userId: BigInt(c.account.userId),
            now: new Date(nowMs),
            cap: this.deps.settings.cap,
            spreadDays: this.deps.settings.spreadDays,
          }),
        ),
      );
    }
    const out = await ctx.telemetry.span("db.import.finish", { kind: "IMPORT_SYNC" }, () =>
      this.finalBatch(statements, end),
    );
    const provider = slugOf(this.source);
    const trigger = this.trigger.toLowerCase();
    importMetric(ctx, "import.games", Math.max(0, this.totals.imported - this.startImported), { provider, trigger });
    importMetric(ctx, "import.duration_ms", ctx.clock.now() - this.startedAtMs, { provider, trigger });
    if (read.skipped > 0) importMetric(ctx, "import.skipped", read.skipped, { reason: "unsupported" });
    if (this.taken > 0) importMetric(ctx, "import.skipped", this.taken, { reason: "taken" });
    if (backlog && out) {
      const released = (out[1] ?? []).reduce((n, r) => n + Number(r.games ?? 0), 0);
      if (released > 0) {
        importMetric(ctx, "import.backlog_released", released, {});
        this.product.capture("import_backlog_released", c.member.userRef, {
          games: Math.min(released, 10_000),
          slices: Math.min((out[1] ?? []).length, 60),
          trigger: "paid_initial",
        });
      }
    }
    let finished: FinishedRun | null;
    if (out) finished = toFinishedRun(out[0]?.[0]);
    else finished = this.runRow ? toFinishedRun((await ctx.db.query(runSummaryStatement(this.runRow.id)))[0]) : null;
    await this.events.flushGamesChanged();
    if (finished && this.runRow) {
      const endMs = ctx.clock.now();
      const readDone = this.readDoneMs ?? endMs;
      const cap = (n: number) => Math.max(0, Math.min(Math.round(n), 10_000));
      const capMs = (n: number) => Math.max(0, Math.min(Math.round(n), 3_600_000));
      this.product.capture("import_finished", c.member.userRef, {
        provider,
        trigger: trigger as Lowercase<ImportTriggerDb>,
        imported: cap(finished.imported),
        skipped: cap(finished.skipped),
        total: cap(finished.total ?? finished.imported),
        analysis_queued: cap(finished.analysisQueued),
        duration_ms: capMs(endMs - this.startedAtMs),
        reading_ms: capMs(readDone - this.startedAtMs),
        saving_ms: capMs(endMs - readDone),
        first_chunk_ms: this.firstChunkMs === null ? null : capMs(this.firstChunkMs),
        upstream_requests: Math.min(read.upstream.requests, 1_000),
        upstream_304_count: Math.min(read.upstream.notModified, 1_000),
      });
    }
    if (finished) {
      await this.events.finished(
        {
          imported: finished.imported,
          skipped: finished.skipped,
          total: finished.total,
          newGames: finished.imported,
          analysisQueued: finished.analysisQueued,
          analysed: finished.analysed,
          firstReviewGameRef: finished.firstReviewGameRef,
        },
        finished.runRef,
      );
    }
    ctx.log.info("import done", {
      run: this.runRow?.ref ?? null,
      seen: read.seen,
      imported: finished?.imported ?? 0,
      newRows: this.newRows,
      skipped: runSkipped,
      backlog,
    });
    return "done";
  }

  /** After a sync the account is ACTIVE again (finish sets it), so only the auto-import switch decides. */
  private rescheduleOrDoneAfterSync(nowMs: number): "done" | { runAt: Date } {
    if (!this.c.account.autoImport) return "done";
    return { runAt: nextAutoSyncAt(this.c.member.timeZone, new Date(nowMs), new Date(nowMs), this.c.account.id) };
  }

  private async fail(read: ReadResult, error: ProviderError): Promise<JobOutcome> {
    const { ctx, c } = this;
    if (error.kind === "aborted") throw error;
    const nowMs = ctx.clock.now();
    const attempt = ctx.job.attempts;
    const last = attempt >= ctx.job.maxAttempts;
    const code = importErrorCodeOf(error);
    let state: FailureState;
    let delaySec = 0;
    let retryAtMs: number | null = null;
    if (error.kind === "not_found" || error.kind === "closed") {
      state = { kind: "terminal", linkError: true };
    } else if (error.kind === "rate_limited") {
      const pauseUntil = Math.max(
        this.deps.providers.gates.pauseUntil(slugOf(this.source)),
        nowMs + (error.retryAfterSec ?? 0) * 1000,
      );
      delaySec = Math.max(1, Math.ceil((pauseUntil - nowMs) / 1000));
      retryAtMs = nowMs + delaySec * 1000;
      // A 429 only pauses (plan §8.11: the gate pauses, job runAt = pauseUntil, run RUNNING → QUEUED; no terminal
      // case): the attempt is given back below, so sustained rate limiting never ends the run FAILED (FIX-2).
      state = { kind: "rate_limited", retryAtMs };
    } else {
      delaySec = Math.max(backoffSecFor("IMPORT_SYNC", attempt), error.retryAfterSec ?? 0);
      retryAtMs = nowMs + delaySec * 1000;
      state = last ? { kind: "terminal", linkError: false } : { kind: "retrying", retryAtMs };
    }
    const terminal = state.kind === "terminal";
    const stored = importError(code, error.message, new Date(nowMs), {
      retryAt: terminal || retryAtMs === null ? null : new Date(retryAtMs),
      httpStatus: error.status,
    });
    // Lichess: skips in the part of the stream that is saved now are counted now (the resume reads only older games).
    const skippedAdd = this.source === "LICHESS" ? skippedBefore(read, this.consumed) : 0;
    // A pause's lastError names its own end, so the lost-response check of this very write (the same refunded attempt
    // number) never matches an earlier pause of the same job.
    const paused = state.kind === "rate_limited";
    const message = paused ? `${stored.message} (paused until ${new Date(retryAtMs!).toISOString()})` : stored.message;
    const batch = [
      lockGuardStatement(ctx.job.id, ctx.me),
      failRunStatement({ runId: this.runRow?.id ?? null, linkedAccountId: c.account.id, state, error: stored, skippedAdd }),
      failStatement({
        jobId: ctx.job.id,
        me: ctx.me,
        code,
        message,
        attempt,
        terminal,
        kind: "IMPORT_SYNC",
        delaySec,
        refundAttempt: paused,
      }),
    ];
    let runRow: Row | undefined;
    try {
      const out = await ctx.db.batch(batch);
      runRow = out[1]?.[0];
    } catch (e) {
      const mine =
        isLockLost(e) && wasRetried(e)
          ? await ctx.db.query(
              outcomeByMeStatement({ jobId: ctx.job.id, me: ctx.me, failed: { attempt: refundedAttempt(attempt, paused), code, message } }),
            )
          : [];
      if (mine.length === 0) throw e;
      runRow = this.runRow
        ? { runRef: this.runRow.ref, imported: this.totals.imported, total: null }
        : undefined;
    }
    ctx.metrics.jobFailed(code === "timeout" ? "timeout" : "internal");
    importMetric(ctx, "import.failed", 1, { provider: slugOf(this.source), code, terminal });
    if (error.kind === "rate_limited") importMetric(ctx, "import.rate_limited", 1, { provider: slugOf(this.source) });
    const eventBase = { provider: slugOf(this.source), trigger: this.trigger.toLowerCase() as Lowercase<ImportTriggerDb> };
    if (error.kind === "rate_limited" && delaySec > 0) {
      this.product.capture("import_rate_limited", c.member.userRef, { ...eventBase, pause_sec: Math.min(delaySec, 3_600) });
    }
    if (terminal) {
      this.product.capture("import_failed", c.member.userRef, { ...eventBase, code, attempts: Math.min(Math.max(attempt, 1), 10) });
    }
    ctx.log.warn("import attempt failed", { code, attempt, terminal, retryAt: retryAtMs, kind: error.kind });
    await this.events.flushGamesChanged();
    const runRef = typeof runRow?.runRef === "string" ? runRow.runRef : null;
    if (runRef && (terminal || state.kind === "rate_limited")) {
      await this.events.failed(
        {
          code,
          retryAt: terminal || retryAtMs === null ? null : new Date(retryAtMs).toISOString(),
          imported: Number(runRow?.imported ?? this.totals.imported),
          total: runRow?.total === null || runRow?.total === undefined ? null : Number(runRow.total),
        },
        runRef,
        attempt,
      );
    }
    return "failed";
  }

  /** The account was deleted mid-run (23503, §8.8): its run went with it (cascade); the job ends. */
  private async accountGone(log: Ctx["log"]): Promise<JobOutcome> {
    log.info("import: the account was deleted during the run: stopped");
    await this.finalBatch([], "done");
    return "done";
  }
}

/**
 * The I/O lane's reap hook (queue/lanes.ts `onReaped`): an IMPORT_SYNC the reaper failed for good (its last attempt
 * stopped heart-beating) ends its run and account FAILED, and the member hears `import:failed`.
 */
export async function failReapedImports(
  deps: { db: Db; emitter: EmitSink; clock: Clock; log: Logger },
  jobs: readonly FailedJob[],
): Promise<void> {
  for (const job of jobs) {
    if (job.kind !== "IMPORT_SYNC" || job.status !== "FAILED") continue;
    const error = importError("timeout", "the worker running the import stopped", new Date(deps.clock.now()));
    const rows = await deps.db.query(failRunOfJobStatement(job.id, error));
    await emitRunsFailed(deps, rows, error, job.attempts);
  }
}
