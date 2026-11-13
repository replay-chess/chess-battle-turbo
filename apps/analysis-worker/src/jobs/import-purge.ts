// IMPORT_PURGE (phase-04 plan §8.12, §9.4 "Purge 2,000 games", §12.2 test 11). Queued by the web when a member
// disconnects an account with "delete games" (ACC-6, `importpurge:<userId>:<provider>`) and by the rollback tool
// (WEB/scripts/ops/purge-imports.ts). It purges by (userId, source), so it works after the link row is gone.
//
//   1. one read: the member's ref and how many of their game_players rows of that source exist (the `games` figure
//      of the audit row and the metric; a resend of a lost purge response cannot lose it from the count);
//   2. loop: `import_purge_batch(user, source, 500)` (M4, SECURITY DEFINER: the worker role has no DELETE on games or
//      game_players) until a batch deletes nothing. One call = one statement = one batch of the §8.12 SQL: the
//      member's rows, their QUEUED ANALYZE_GAME jobs, one gamesVersion bump, the games nobody else holds (cascading
//      analyses, reviews, shares), and on games another member also imported only this member's player id. A resend
//      after a lost response purges the next batch or nothing, so the loop needs no retry form. After each batch
//      `games:changed {v:1}` (the import's per-member 10 s throttle, import/progress.ts, and one at the end);
//   3. ONE guarded batch: the `account.purged` audit row (meta {provider, games}) + the job DONE. A resend after a
//      lost response fails on the guard; `outcomeByMeStatement` then confirms the first send committed, so the
//      audit row is written exactly once.
//
// The purge does not check the job lock per batch: every batch is idempotent (it removes what is still there), and a
// worker that lost the job stops at its next step (the heartbeat aborts the context). The loop is bounded
// (PURGE_MAX_BATCHES) so a purge racing a re-import cannot spin forever; what is left is purged by the retry.
import { importPurgeDedupeKey } from "@repo/contracts/internal/jobs";
import { auditSql } from "@repo/db/audit";
import { fromPrisma, num, stmt, wasRetried, type Statement } from "../db/client";
import { importMetric } from "../import/metrics";
import { noopProductEvents, type ProductEvents } from "../obs/posthog";
import { ImportEvents } from "../import/progress";
import { doneStatement, isLockLost, lockGuardStatement, outcomeByMeStatement } from "../queue/outcome";
import { JobError, throwIfAborted, type JobContext, type JobHandler, type JobOutcome } from "./types";

/** Rows per `import_purge_batch` call (§8.12; the function accepts 1..1000). */
export const PURGE_BATCH = 500;
/** At most this many batches per attempt (1,000,000 rows): far above IMPORT_MAX_GAMES × 2 providers. */
export const PURGE_MAX_BATCHES = 2_000;

type Ctx = JobContext<"IMPORT_PURGE">;

/** The member's ref and the rows the purge will remove (null when the user is gone). */
export function purgeTargetStatement(userId: string, source: "CHESSCOM" | "LICHESS"): Statement {
  return stmt(
    `SELECT u."referenceId" AS "userRef",
            (SELECT count(*)::int FROM game_players gp WHERE gp."userId" = u.id AND gp.source = $2::"GameSource") AS rows
       FROM users u WHERE u.id = $1::bigint`,
    [userId, source],
  );
}

/** One §8.12 batch through the M4 function (returns the counts, not the ids). */
export function purgeBatchStatement(userId: string, source: "CHESSCOM" | "LICHESS", limit = PURGE_BATCH): Statement {
  return stmt(
    `SELECT deleted_players, deleted_games, cleared_games FROM import_purge_batch($1::bigint, $2::"GameSource", $3::int)`,
    [userId, source, limit],
  );
}

export function importPurgeHandler(deps: { events?: ProductEvents } = {}): JobHandler<"IMPORT_PURGE"> {
  return {
    kind: "IMPORT_PURGE",
    run: (ctx) => purge(ctx, deps.events ?? noopProductEvents),
  };
}

async function purge(ctx: Ctx, product: ProductEvents): Promise<JobOutcome> {
  const { userId, provider: source, requestedAt } = ctx.payload;
  const provider = source === "CHESSCOM" ? "chesscom" : "lichess";
  const log = ctx.log.child({ provider, dedupeKey: importPurgeDedupeKey(userId, source) });

  const [target] = await ctx.db.query(purgeTargetStatement(userId, source));
  if (!target) {
    // The account was deleted (its rows went with it): nothing to purge, nothing to audit.
    log.info("purge: the member is gone");
    await finalBatch(ctx, [], { games: 0, batches: 0 });
    return "done";
  }
  const userRef = String(target.userRef);
  const expected = num(target.rows ?? 0);
  const events = new ImportEvents({
    emitter: ctx.emitter,
    clock: ctx.clock,
    log,
    userRef,
    provider,
    runRef: () => null,
  });

  let batches = 0;
  let removed = 0;
  let gamesDeleted = 0;
  let sidesCleared = 0;
  for (;;) {
    throwIfAborted(ctx.signal);
    if (batches >= PURGE_MAX_BATCHES) {
      throw new JobError("internal", `purge stopped after ${PURGE_MAX_BATCHES} batches (rows kept appearing)`);
    }
    const t0 = ctx.clock.now();
    const [row] = await ctx.telemetry.span("db.import.purge", { kind: "IMPORT_PURGE", provider }, () =>
      ctx.db.query(purgeBatchStatement(userId, source)),
    );
    ctx.heartbeat.noteWrite();
    batches++;
    const players = num(row?.deleted_players ?? 0);
    if (players === 0) break;
    removed += players;
    gamesDeleted += num(row?.deleted_games ?? 0);
    sidesCleared += num(row?.cleared_games ?? 0);
    log.info("purge batch", { players, games: num(row?.deleted_games ?? 0), ms: ctx.clock.now() - t0 });
    await events.added(players);
  }

  // The count read first is the member's whole set; a batch whose response was lost (and whose resend purged the
  // next one) is still in it. More than that means rows arrived during the purge (they were purged too).
  const games = Math.max(expected, removed);
  await finalBatch(
    ctx,
    [
      fromPrisma(
        auditSql(
          {
            category: "ACCOUNT",
            action: "account.purged",
            actorKind: "WORKER",
            actorUserId: BigInt(userId),
            targetType: "user",
            targetId: userRef,
            meta: { provider, games, batches, requestedAt },
          },
          { strict: ctx.appEnv !== "production" },
        ),
      ),
    ],
    { games, batches },
  );
  await events.flushGamesChanged();
  importMetric(ctx, "import.purged_games", games, { provider });
  product.capture("account_purge_completed", userRef, { provider, games: Math.min(games, 10_000) });
  log.info("purge done", { games, gamesDeleted, sidesCleared, batches });
  return "done";
}

/** The guarded end: `statements` + DONE in one transaction; a lost response is recognised, never written twice. */
async function finalBatch(ctx: Ctx, statements: Statement[], result: { games: number; batches: number }): Promise<void> {
  try {
    await ctx.db.batch([lockGuardStatement(ctx.job.id, ctx.me), ...statements, doneStatement(ctx.job.id, ctx.me, result)]);
    ctx.heartbeat.noteWrite();
  } catch (error) {
    if (isLockLost(error) && wasRetried(error)) {
      const mine = await ctx.db.query(outcomeByMeStatement({ jobId: ctx.job.id, me: ctx.me }));
      if (mine.length > 0) {
        ctx.log.warn("purge: the final batch committed but its response was lost");
        return;
      }
    }
    throw error;
  }
}
