// EXTRACT_MISTAKES (phase-05 plan §7.6): the Mistake Bank extraction of one member side of an already-analysed game,
// for the B-M5-1 backfill and an EXTRACT_VERSION bump. Engine lane, JOB_PRIORITY.BACKLOG (live and opened games go
// first); payload `ExtractMistakesPayloadV1 {v:1, gameId, userId}` (a newer `v` is released by the runner).
//
//   load (1 statement: the game, the stored analysis, the member with its zone and training prefs, the side's
//   key-moment plies) → the same extraction as J1 (extract/extractMistakes.ts; no pass 1: the stored arrays) → ONE
//   batch: lock guard → the game's game_analyses and games rows (FOR KEY SHARE, m4t's order) → the §7.6 statements →
//   DONE → `mistakes:added`, coalesced per user (extract/coalesce.ts), and `mistakes_extracted`.
//
// The game lock (extractGameLockStatements): an import purge (m4t) locks the game's game_analyses and games rows FOR
// UPDATE, then deletes the member's game_players row and, through the cascade, the player_reviews row. The §7.6
// statements lock player_reviews first (statement L) and update game_players later (statement 5); J1 is safe because
// P3's final batch has already updated games, but this batch had no games lock, so a purge of the same game could
// hold game_players and wait for player_reviews while this batch held player_reviews and waited for game_players
// (40P01). Taking the game rows first, in the purge's order, makes one wait for the other instead (regression:
// extract-purge-deadlock, extract-purge-lock-order.int.test.ts). FOR KEY SHARE conflicts only with the purge's
// FOR UPDATE / DELETE, not with the analysis or a live game's row updates.
//
// A game that is gone, not analysed (yet) or whose member is no longer a player ends DONE `{skipped: …}` (the
// backfill's predicate only enqueues analysed games; an analysis that completes later runs J1 itself). A batch whose
// response was lost after the commit is DONE by this worker (`finalBatch`): no event then (the counts are unknown).
import type { StoredLine } from "@repo/chess-analysis/analysis";
import { replayUci, type Replay } from "@repo/chess-analysis/replay";
import { stmt, type Statement } from "../db/client";
import { bankStatements } from "../extract/bankStatements";
import { MistakesAddedCoalescer } from "../extract/coalesce";
import { buildBankPlan } from "../extract/extractMistakes";
import { lineSearchers } from "../extract/lineBuilder";
import { bankOutcome } from "../extract/outcome";
import type { BankExtractSettings } from "../pipeline/analyze-game";
import { reportExtraction } from "../pipeline/final-batch/p05-bank";
import { Searcher } from "../pipeline/search";
import { finalBatch, toMember } from "../pipeline/sql-store";
import type { GameMember } from "../pipeline/types";
import type { ProductEvents } from "../obs/posthog";
import { doneStatement, lockGuardStatement } from "../queue/outcome";
import { JobError, type JobContext, type JobHandler, type JobOutcome } from "./types";

export interface ExtractJobDeps {
  settings: BankExtractSettings;
  events: ProductEvents;
  coalescer: MistakesAddedCoalescer;
}

/** The batch's first locks after the lock guard: the game's analysis row, then its games row (m4t's purge order). */
export function extractGameLockStatements(gameId: string): Statement[] {
  return [
    stmt(`SELECT count(*)::int AS locked FROM (SELECT 1 FROM game_analyses WHERE "gameId" = $1::bigint FOR KEY SHARE) l`, [gameId]),
    stmt(`SELECT count(*)::int AS locked FROM (SELECT 1 FROM games WHERE id = $1::bigint FOR KEY SHARE) l`, [gameId]),
  ];
}

/** The job's whole read: one statement. */
export function extractLoadStatement(gameId: string, userId: string): Statement {
  return stmt(
    `SELECT g.id::text AS id, g."referenceId" AS ref, g."startingFen", g."startPly", g.moves,
       g."analysisStatus"::text AS "analysisStatus", (extract(epoch FROM g."completedAt") * 1000)::float8 AS "completedAtMs",
       g."ecoCode", g."timeClass"::text AS "timeClass", COALESCE(g.meta ? 'colorUnknown', false) AS "colorUnknown",
       (SELECT json_build_object('evals', a.evals, 'second', a.second, 'best', a.best, 'judgements', a.judgements,
                                 'lines', a.lines, 'middlegamePly', a."middlegamePly", 'endgamePly', a."endgamePly",
                                 'totalPlies', a."totalPlies", 'completed', a."completedAt" IS NOT NULL)
          FROM game_analyses a WHERE a."gameId" = g.id) AS analysis,
       (SELECT json_build_object('color', gp.color, 'userId', gp."userId"::text, 'userRef', u."referenceId",
                                 'result', gp.result::text, 'timeZone', u."timeZone", 'dayStartHour', tp."dayStartHour",
                                 'releaseHour', tp."releaseHour", 'bankDailyCap', tp."bankDailyCap",
                                 'newPerDay', tp."newPerDay",
                                 'endedAtMs', (extract(epoch FROM gp."endedAt") * 1000)::float8,
                                 'opponentName', gp."opponentName",
                                 'dayAnchor', (SELECT json_build_object('day', to_char(td.day, 'YYYY-MM-DD'), 'timeZone', td."timeZone",
                                                                        'dayStartHour', td."dayStartHour")
                                                 FROM training_days td WHERE td."userId" = gp."userId" AND td."timeZone" IS NOT NULL
                                                ORDER BY td.day DESC LIMIT 1))
          FROM game_players gp JOIN users u ON u.id = gp."userId"
          LEFT JOIN training_profiles tp ON tp."userId" = gp."userId"
         WHERE gp."gameId" = g.id AND gp."userId" = $2::bigint) AS member,
       (SELECT COALESCE(jsonb_path_query_array(pr.content, '$.moments[*].ply'), '[]'::jsonb)
          FROM player_reviews pr JOIN game_players gp ON gp."gameId" = pr."gameId" AND gp.color = pr.color
         WHERE pr."gameId" = g.id AND gp."userId" = $2::bigint) AS moments
  FROM games g
 WHERE g.id = $1::bigint`,
    [gameId, userId],
  );
}

interface Loaded {
  replay: Replay;
  member: GameMember;
  evals: number[];
  second: number[];
  best: number[];
  judgements: number[];
  lines: Record<string, StoredLine>;
  division: { middlegamePly: number | null; endgamePly: number | null };
  moments: number[];
  startPly: number;
  completedAtMs: number | null;
  ecoCode: string | null;
  timeClass: string | null;
  colorUnknown: boolean;
  gameRef: string;
}

const nums = (v: unknown): number[] => (Array.isArray(v) ? v.map((x) => Number(x)) : []);
const intOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);

/** The stored game, or why it cannot be extracted. */
export function readLoaded(row: Record<string, unknown> | undefined): Loaded | { skip: string } {
  if (!row) return { skip: "game_gone" };
  if (row.analysisStatus !== "DONE") return { skip: "not_analysed" };
  const a = row.analysis as Record<string, unknown> | null;
  if (!a || a.completed !== true) return { skip: "not_analysed" };
  if (!row.member) return { skip: "not_a_player" };
  const moves = typeof row.moves === "string" && row.moves.trim() !== "" ? row.moves.trim().split(/\s+/) : [];
  let replay: Replay;
  try {
    replay = replayUci(String(row.startingFen), moves);
  } catch {
    return { skip: "unreplayable" };
  }
  const n = replay.uci.length;
  const evals = nums(a.evals);
  const second = nums(a.second);
  const best = nums(a.best);
  const judgements = nums(a.judgements);
  if (evals.length !== n + 1 || judgements.length !== n) return { skip: "analysis_shape" };
  return {
    replay,
    member: toMember(row.member),
    evals,
    second,
    best,
    judgements,
    lines: a.lines && typeof a.lines === "object" ? (a.lines as Record<string, StoredLine>) : {},
    division: { middlegamePly: intOrNull(a.middlegamePly), endgamePly: intOrNull(a.endgamePly) },
    moments: nums(row.moments),
    startPly: Number(row.startPly ?? 0),
    completedAtMs: typeof row.completedAtMs === "number" ? row.completedAtMs : null,
    ecoCode: typeof row.ecoCode === "string" ? row.ecoCode : null,
    timeClass: typeof row.timeClass === "string" ? row.timeClass : null,
    colorUnknown: row.colorUnknown === true,
    gameRef: String(row.ref),
  };
}

export function extractMistakesHandler(deps: ExtractJobDeps): JobHandler<"EXTRACT_MISTAKES"> {
  return {
    kind: "EXTRACT_MISTAKES",
    run: (ctx) => ctx.telemetry.span("job.extract_mistakes", { kind: "EXTRACT_MISTAKES" }, () => run(ctx, deps), { transaction: true }),
  };
}

async function run(ctx: JobContext<"EXTRACT_MISTAKES">, deps: ExtractJobDeps): Promise<JobOutcome> {
  const { gameId, userId } = ctx.payload;
  const rows = await ctx.db.query(extractLoadStatement(gameId, userId));
  const loaded = readLoaded(rows[0]);
  if ("skip" in loaded) {
    await finalBatch(ctx.db, ctx.job.id, ctx.me, [
      lockGuardStatement(ctx.job.id, ctx.me),
      doneStatement(ctx.job.id, ctx.me, { skipped: loaded.skip }),
    ]);
    ctx.log.info("extraction skipped", { gameId, reason: loaded.skip });
    return "done";
  }
  if (!ctx.engine) throw new JobError("internal", "no engine in this worker", { terminal: true });
  const searcher = new Searcher({
    engine: ctx.engine,
    cache: ctx.evalCache,
    lag: ctx.lag,
    signal: ctx.signal,
    fromInitial: false,
  });
  const lines = lineSearchers(searcher, deps.settings.lineNodes, ctx.signal);
  const plan = await buildBankPlan(
    {
      gameId,
      startPly: loaded.startPly,
      replay: loaded.replay,
      evals: loaded.evals,
      second: loaded.second,
      best: loaded.best,
      judgements: loaded.judgements,
      lines: loaded.lines,
      division: loaded.division,
      moments: { [loaded.member.color]: loaded.moments },
      members: [loaded.member],
      completedAtMs: loaded.completedAtMs,
      timeClass: loaded.timeClass,
      ecoCode: loaded.ecoCode,
      colorUnknown: loaded.colorUnknown,
      now: new Date(ctx.clock.now()),
    },
    {
      search: lines.search,
      reply: lines.reply,
      onLineError: (error) => {
        ctx.log.warn("bank line extension failed: the puzzle keeps its first move", { gameId, error });
        ctx.telemetry.metric("count", "worker.extract.line_failed", 1);
      },
    },
    { source: "backfill", clockMs: () => ctx.clock.now() },
  );
  const statements = bankStatements(plan);
  const batchMs0 = ctx.clock.now();
  const gameLocks = extractGameLockStatements(gameId);
  const out = await finalBatch(ctx.db, ctx.job.id, ctx.me, [
    lockGuardStatement(ctx.job.id, ctx.me),
    ...gameLocks,
    ...statements,
    doneStatement(ctx.job.id, ctx.me, {
      candidates: plan.members[0]?.candidates ?? 0,
      cards: plan.cards.length,
      version: plan.version,
    }),
  ]);
  ctx.evalCache?.flush();
  ctx.heartbeat.noteWrite();
  if (!out) return "done"; // committed in an earlier attempt whose response was lost: counts unknown, no event
  const head = 1 + gameLocks.length;
  const outcome = bankOutcome(plan, out.slice(head, head + statements.length));
  reportExtraction(plan, outcome, { metrics: ctx.metrics, telemetry: ctx.telemetry, events: deps.events, batchMs: ctx.clock.now() - batchMs0 });
  for (const o of outcome.values()) {
    await deps.coalescer.add(o.userRef, {
      games: 1,
      added: o.touched,
      cardsAdded: o.cardsAdded,
      total: o.total,
      bankDue: o.bankDue,
    });
  }
  ctx.log.info("mistakes extracted", { gameRef: loaded.gameRef, candidates: plan.members[0]?.candidates ?? 0 });
  return "done";
}
